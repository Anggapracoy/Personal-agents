import AlarmKit
import Contacts
import CoreLocation
import CoreMotion
import CryptoKit
import EventKit
import HealthKit
import HomeKit
import MusicKit
import Photos
import UIKit
import UniformTypeIdentifiers

struct AppleConnectionFailure: LocalizedError {
    let message: String
    let retryable: Bool
    var errorDescription: String? { message }
    init(_ message: String, retryable: Bool = false) { self.message = message; self.retryable = retryable }
}

@MainActor
final class AppleConnections: NSObject, @preconcurrency CLLocationManagerDelegate, @preconcurrency HMHomeManagerDelegate, UIDocumentPickerDelegate {
    static let services = ["reminders", "contacts", "files", "photos", "health", "home", "music", "location", "maps", "weather", "alarms", "motion"]
    let defaults: UserDefaults
    let reminders = EKEventStore()
    let contacts = CNContactStore()
    let health = HKHealthStore()
    let location = CLLocationManager()
    let pedometer = CMPedometer()
    let activity = CMMotionActivityManager()
    var home: HMHomeManager?
    var homeLoaded = false
    var homeWaitID = UUID()
    var locationWaitID = UUID()
    var homeWait: CheckedContinuation<Void, Error>?
    var locationAccessWait: CheckedContinuation<Void, Error>?
    var locationWait: CheckedContinuation<CLLocation, Error>?
    var folderWait: CheckedContinuation<URL, Error>?
    var connecting = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }
    nonisolated static func ownerKey(_ owner: String) -> String {
        SHA256.hash(data: Data(owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().utf8)).map { String(format: "%02x", $0) }.joined()
    }
    func key(_ owner: String, _ service: String) -> String { "apple.connections.\(Self.ownerKey(owner)).\(service)" }
    func enabled(_ owner: String, _ service: String) -> Bool { defaults.bool(forKey: key(owner, service)) }
    func disconnect(_ owner: String, _ service: String) {
        defaults.removeObject(forKey: key(owner, service))
        defaults.removeObject(forKey: key(owner, service) + ".folder")
    }
    func disconnectAll(_ owner: String) { for service in Self.services { disconnect(owner, service) } }
    func status(_ owner: String, _ service: String) -> [String: Any] {
        let on = enabled(owner, service)
        var state = on ? "connected" : "disconnected"
        var detail: String?
        if on {
            switch service {
            case "reminders":
                let authorization = EKEventStore.authorizationStatus(for: .reminder)
                if authorization != .fullAccess { state = "denied" }
            case "contacts":
                let authorization = CNContactStore.authorizationStatus(for: .contacts)
                if #available(iOS 18, *), authorization == .limited { state = "limited" }
                else if authorization != .authorized { state = "denied" }
            case "photos":
                let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                state = authorization == .limited ? "limited" : authorization == .authorized ? "connected" : "denied"
            case "health":
                state = "limited"; detail = "Enabled · read access is private; choose data in Health"
            case "home":
                if let home, !home.authorizationStatus.contains(.authorized) { state = "denied" }
            case "music": if MusicAuthorization.currentStatus != .authorized { state = "denied" }
            case "location":
                if ![.authorizedAlways, .authorizedWhenInUse].contains(location.authorizationStatus) { state = "denied" }
            case "motion": if CMPedometer.authorizationStatus() != .authorized { state = "denied" }
            case "files": if defaults.data(forKey: key(owner, service) + ".folder") == nil { state = "disconnected" }
            case "alarms":
                if #available(iOS 26, *), AlarmManager.shared.authorizationState != .authorized { state = "denied" }
            default: break
            }
        }
        // A refused permission remains actionable even when Connect never completed.
        switch service {
        case "reminders": if [.denied, .restricted].contains(EKEventStore.authorizationStatus(for: .reminder)) { state = "denied" }
        case "contacts": if [.denied, .restricted].contains(CNContactStore.authorizationStatus(for: .contacts)) { state = "denied" }
        case "photos": if [.denied, .restricted].contains(PHPhotoLibrary.authorizationStatus(for: .readWrite)) { state = "denied" }
        case "location": if [.denied, .restricted].contains(location.authorizationStatus) { state = "denied" }
        case "music": if [.denied, .restricted].contains(MusicAuthorization.currentStatus) { state = "denied" }
        case "motion": if [.denied, .restricted].contains(CMPedometer.authorizationStatus()) { state = "denied" }
        case "alarms": if #available(iOS 26, *), AlarmManager.shared.authorizationState == .denied { state = "denied" }
        default: break
        }
        if service == "health" && !HKHealthStore.isHealthDataAvailable() { state = "unavailable"; detail = "Health is unavailable on this device" }
        if service == "motion" && !CMPedometer.isStepCountingAvailable() { state = "unavailable"; detail = "Step counting is unavailable on this device" }
        if service == "alarms" { if #available(iOS 26, *) {} else { state = "unavailable"; detail = "Requires iOS 26 or later" } }
        return ["id": service, "enabled": on, "status": state, "detail": detail ?? (state == "limited" ? "Selected items only" : state == "denied" ? "Access changed · review iPhone Settings" : state == "connected" ? "Connected on this iPhone" : "Not connected")]
    }
    func snapshot(_ owner: String) -> [[String: Any]] { Self.services.map { status(owner, $0) } }

    func connect(_ owner: String, _ service: String) async throws {
        guard Self.services.contains(service), !connecting else { throw AppleConnectionFailure("Finish the current connection first.") }
        connecting = true
        defer { connecting = false }
        switch service {
        case "reminders": guard try await reminders.requestFullAccessToReminders() else { throw AppleConnectionFailure("Reminders access was not allowed. You can change it in iPhone Settings.") }
        case "contacts": guard try await contacts.requestAccess(for: .contacts) else { throw AppleConnectionFailure("Contacts access was not allowed.") }
        case "photos":
            let result = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
            guard result == .authorized || result == .limited else { throw AppleConnectionFailure("Photos access was not allowed.") }
        case "files":
            let url = try await chooseFolder()
            guard url.startAccessingSecurityScopedResource() else { throw AppleConnectionFailure("That folder is not accessible. Choose it again.") }
            defer { url.stopAccessingSecurityScopedResource() }
            let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            defaults.set(bookmark, forKey: key(owner, service) + ".folder")
        case "health":
            guard HKHealthStore.isHealthDataAvailable() else { throw AppleConnectionFailure("Health is unavailable on this device.") }
            try await health.requestAuthorization(toShare: [HKQuantityType(.dietaryWater)], read: [HKQuantityType(.stepCount), HKQuantityType(.activeEnergyBurned), HKQuantityType(.dietaryWater), HKCategoryType(.sleepAnalysis), HKObjectType.workoutType()])
        case "home": try await loadHome()
        case "music": guard await MusicAuthorization.request() == .authorized else { throw AppleConnectionFailure("Apple Music access was not allowed.") }
        case "location": try await requestLocationPermission()
        case "motion":
            guard CMPedometer.isStepCountingAvailable() else { throw AppleConnectionFailure("Step counting is unavailable on this device.") }
            _ = try await stepData(from: Date().addingTimeInterval(-3600), to: Date())
        case "alarms":
            if #available(iOS 26, *) {
                guard try await AlarmManager.shared.requestAuthorization() == .authorized else { throw AppleConnectionFailure("Alarms access was not allowed.") }
            } else { throw AppleConnectionFailure("Alarms require iOS 26 or later.") }
        case "maps", "weather": break
        default: throw AppleConnectionFailure("Unknown connection.")
        }
        defaults.set(true, forKey: key(owner, service))
    }
    func execute(owner: String, operation: String, parameters: [String: Any], actionID: String) async throws -> [String: Any] {
        let service = String(operation.split(separator: ".").first ?? "")
        guard Self.services.contains(service), enabled(owner, service) else { throw AppleConnectionFailure("Connect \(service) in Settings → Connected sources on this iPhone first.", retryable: true) }
        let current = status(owner, service)["status"] as? String
        guard current == "connected" || current == "limited" else { throw AppleConnectionFailure("Access to \(service) is unavailable. Review its connection in Settings.", retryable: true) }
        switch service {
        case "reminders": return try await reminderAction(operation, parameters)
        case "contacts": return try contactAction(operation, parameters)
        case "files": return try fileAction(owner, operation, parameters)
        case "photos": return try await photoAction(operation, parameters)
        case "health": return try await healthAction(operation, parameters)
        case "home": return try await homeAction(operation, parameters)
        case "music": return try await musicAction(operation, parameters)
        case "location":
            let value = try await currentLocation()
            return ["latitude": value.coordinate.latitude, "longitude": value.coordinate.longitude, "accuracyMeters": value.horizontalAccuracy, "observedAt": ISO8601DateFormatter().string(from: value.timestamp)]
        case "maps": return try await mapsAction(operation, parameters)
        case "weather": return try await weatherAction(parameters)
        case "alarms":
            if #available(iOS 26, *) { return try await alarmAction(owner, operation, parameters, actionID: actionID) }
            throw AppleConnectionFailure("Alarms require iOS 26 or later.")
        case "motion": return try await motionAction(parameters)
        default: throw AppleConnectionFailure("Unsupported Apple action.")
        }
    }
    static func string(_ p: [String: Any], _ name: String) throws -> String {
        guard let value = p[name] as? String, !value.isEmpty else { throw AppleConnectionFailure("Missing \(name).") }
        return value
    }
    static func date(_ value: Any?) throws -> Date {
        guard let value = value as? String else { throw AppleConnectionFailure("An ISO date with timezone is required.") }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        guard let date = formatter.date(from: value) else { throw AppleConnectionFailure("Invalid date.") }
        return date
    }
    static func limit(_ p: [String: Any]) -> Int { min(100, max(1, (p["limit"] as? Int) ?? 30)) }
    static func interval(_ p: [String: Any]) throws -> (Date, Date) {
        let start = try date(p["start"]), end = try date(p["end"])
        guard end > start, end.timeIntervalSince(start) <= 366 * 86400 else { throw AppleConnectionFailure("Choose a date range of at most one year.") }
        return (start, end)
    }
    static func presenter() throws -> UIViewController {
        guard var controller = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController else { throw AppleConnectionFailure("Open Dash on your iPhone to continue.") }
        while let presented = controller.presentedViewController { controller = presented }
        return controller
    }
    func chooseFolder() async throws -> URL {
        guard folderWait == nil else { throw AppleConnectionFailure("A folder picker is already open.") }
        let presenter = try Self.presenter()
        return try await withCheckedThrowingContinuation { continuation in
            folderWait = continuation
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            presenter.present(picker, animated: true)
        }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { let wait = folderWait; folderWait = nil; wait?.resume(throwing: AppleConnectionFailure("Folder selection cancelled.")) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let wait = folderWait; folderWait = nil
        if let url = urls.first { wait?.resume(returning: url) } else { wait?.resume(throwing: AppleConnectionFailure("No folder was selected.")) }
    }
    func requestLocationPermission() async throws {
        if [.authorizedAlways, .authorizedWhenInUse].contains(location.authorizationStatus) { return }
        guard location.authorizationStatus == .notDetermined, locationAccessWait == nil else { throw AppleConnectionFailure("Allow location in iPhone Settings to connect it.") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            locationAccessWait = continuation
            location.requestWhenInUseAuthorization()
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined, let wait = locationAccessWait else { return }
        locationAccessWait = nil
        if [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) { wait.resume() }
        else { wait.resume(throwing: AppleConnectionFailure("Location access was not allowed.")) }
    }
    func currentLocation() async throws -> CLLocation {
        guard [.authorizedAlways, .authorizedWhenInUse].contains(location.authorizationStatus), locationWait == nil else { throw AppleConnectionFailure("Location is unavailable. Check iPhone Settings.") }
        return try await withCheckedThrowingContinuation { continuation in
            locationWait = continuation
            let waitID = UUID(); locationWaitID = waitID
            location.requestLocation()
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard let self, self.locationWaitID == waitID, let wait = self.locationWait else { return }
                self.locationWait = nil
                wait.resume(throwing: AppleConnectionFailure("Couldn't get a current location. Try again outdoors."))
            }
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let value = locations.last, value.horizontalAccuracy >= 0, abs(value.timestamp.timeIntervalSinceNow) < 120 else { return }
        let wait = locationWait; locationWait = nil; wait?.resume(returning: value)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let wait = locationWait; locationWait = nil; wait?.resume(throwing: AppleConnectionFailure("Location could not be read. Check device location services."))
    }
    func loadHome() async throws {
        if let home, homeLoaded, home.authorizationStatus.contains(.authorized) { return }
        guard homeWait == nil else { throw AppleConnectionFailure("Home is still loading.") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            homeWait = continuation
            let waitID = UUID(); homeWaitID = waitID
            let manager = HMHomeManager(); homeLoaded = false; home = manager; manager.delegate = self
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(90))
                guard let self, self.homeWaitID == waitID, let wait = self.homeWait else { return }
                self.homeWait = nil
                wait.resume(throwing: AppleConnectionFailure("Home could not be loaded. Check access in iPhone Settings."))
            }
        }
    }
    func homeManagerDidUpdateHomes(_ manager: HMHomeManager) { guard manager === home else { return }; homeLoaded = true; finishHomeLoading(manager) }
    func homeManager(_ manager: HMHomeManager, didUpdate status: HMHomeManagerAuthorizationStatus) { finishHomeLoading(manager) }
    private func finishHomeLoading(_ manager: HMHomeManager) {
        guard manager === home else { return }
        guard !manager.authorizationStatus.contains(.determined) || manager.authorizationStatus.contains(.authorized) else {
            let wait = homeWait; homeWait = nil; wait?.resume(throwing: AppleConnectionFailure("Home access was not allowed.")); return
        }
        if homeLoaded && manager.authorizationStatus.contains(.authorized) { let wait = homeWait; homeWait = nil; wait?.resume() }
    }
}
