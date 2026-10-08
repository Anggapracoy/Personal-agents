import Contacts
import CoreLocation
import Foundation
import MapKit
import UIKit

/// Signed requests that work with the app in the background, using the verified session copy.
@MainActor
enum BackgroundAPI {
    static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        let baseURL = AppConfiguration.load().baseURL
        guard let session = NotificationReplySessionStore.read(baseURL: baseURL),
              session.origin == NotificationReplySession.origin(for: baseURL), session.expiresAt > Date() else { throw URLError(.userAuthenticationRequired) }
        var request = URLRequest(url: baseURL.appending(path: path), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.httpShouldHandleCookies = false
        request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        return data
    }

    static var accountKey: String? {
        let baseURL = AppConfiguration.load().baseURL
        guard let session = NotificationReplySessionStore.read(baseURL: baseURL), session.expiresAt > Date() else { return nil }
        return session.accountKey
    }
}

@MainActor
final class ProactiveSignals: NSObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = ProactiveSignals()

    private let manager = CLLocationManager()
    private let contacts = CNContactStore()
    private var enabled = false
    private var locationWaits: [CheckedContinuation<CLLocation, Error>] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        // Retire registrations left by an older installed version.
        manager.stopMonitoringVisits()
        manager.stopMonitoringSignificantLocationChanges()
    }

    private func connected(_ service: String, _ accountKey: String) -> Bool {
        UserDefaults.standard.bool(forKey: "apple.connections.\(accountKey).\(service)")
    }

    /// Called at launch and whenever Dash becomes active. Everything is off unless the account has proactive v2.
    func start() {
        Task {
            guard let data = try? await BackgroundAPI.request("api/mobile/proactive"),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            enabled = payload["enabled"] as? Bool == true
            guard enabled, let accountKey = BackgroundAPI.accountKey else { return }
            // Background ETA requests still need location permission, but there
            // is no passive place monitoring or notification release signal.
            if connected("location", accountKey), manager.authorizationStatus == .authorizedWhenInUse {
                manager.requestAlwaysAuthorization()
            }
            await syncBirthdays()
        }
    }

    static func birthdayKey(accountKey: String, date: Date) -> String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return "proactive.birthdays.\(accountKey).\(components.year ?? 0)-\(components.month ?? 0)-\(components.day ?? 0)"
    }

    private func syncBirthdays() async {
        guard enabled, let accountKey = BackgroundAPI.accountKey,
              connected("contacts", accountKey), CNContactStore.authorizationStatus(for: .contacts) == .authorized else { return }
        let key = Self.birthdayKey(accountKey: accountKey, date: Date())
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        let birthdays = await upcomingBirthdays()
        guard BackgroundAPI.accountKey == accountKey else { return }
        if (try? await BackgroundAPI.request("api/mobile/birthdays", method: "POST", body: ["birthdays": birthdays])) != nil {
            UserDefaults.standard.set(true, forKey: key)
        }
    }

    /// Names and dates only, for birthdays today or tomorrow.
    private func upcomingBirthdays() async -> [[String: String]] {
        guard CNContactStore.authorizationStatus(for: .contacts) == .authorized else { return [] }
        let store = contacts
        return await Task.detached {
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: Date())
            let targets = [0, 1].compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactBirthdayKey] as [CNKeyDescriptor]
            var found: [[String: String]] = []
            try? store.enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { contact, stop in
                guard let birthday = contact.birthday, let month = birthday.month, let day = birthday.day else { return }
                for target in targets where calendar.component(.month, from: target) == month && calendar.component(.day, from: target) == day {
                    let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                    guard !name.isEmpty else { continue }
                    let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian); formatter.dateFormat = "yyyy-MM-dd"
                    found.append(["name": name, "date": formatter.string(from: target)])
                }
                if found.count >= 20 { stop.pointee = true }
            }
            return found
        }.value
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        let waits = locationWaits
        locationWaits = []
        waits.forEach { $0.resume(returning: latest) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let waits = locationWaits
        locationWaits = []
        waits.forEach { $0.resume(throwing: error) }
    }

    // MARK: Leave-now travel time

    /// A silent push asks for travel time to an event. Only the minutes leave the phone.
    func handleRemote(_ userInfo: [AnyHashable: Any]) async -> Bool {
        guard let check = userInfo["dashEta"] as? [String: Any], let checkID = check["checkId"] as? String, UUID(uuidString: checkID) != nil,
              let destination = check["destination"] as? String, !destination.isEmpty else { return false }
        let minutes = try? await travelMinutes(to: destination)
        _ = try? await BackgroundAPI.request("api/mobile/eta", method: "POST", body: ["checkId": checkID, "minutes": minutes.map { $0 as Any } ?? NSNull()])
        return true
    }

    private func travelMinutes(to destination: String) async throws -> Int {
        guard manager.authorizationStatus == .authorizedAlways || UIApplication.shared.applicationState == .active else { throw CLError(.denied) }
        let here: CLLocation = try await withCheckedThrowingContinuation { continuation in
            locationWaits.append(continuation)
            manager.requestLocation()
        }
        guard let place = try await CLGeocoder().geocodeAddressString(destination).first, let target = place.location else { throw CLError(.geocodeFoundNoResult) }
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: here.coordinate))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: target.coordinate))
        request.transportType = .automobile
        request.departureDate = Date()
        let eta = try await MKDirections(request: request).calculateETA()
        return Int((eta.expectedTravelTime / 60).rounded(.up))
    }
}
