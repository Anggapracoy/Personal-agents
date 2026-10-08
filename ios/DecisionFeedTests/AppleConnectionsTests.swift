import Contacts
import CoreLocation
import EventKit
import HealthKit
import Photos
import UIKit
import XCTest
@testable import DecisionFeed

@MainActor
final class AppleConnectionsTests: XCTestCase {
    func manager() -> AppleConnections { AppleConnections(defaults: UserDefaults(suiteName: "apple-test-\(UUID().uuidString)")!) }
    func testAllConnectionsStartOffAndCannotReadWithoutOptIn() async throws {
        let manager = manager()
        for service in AppleConnections.services {
            XCTAssertEqual(manager.status("first@example.test", service)["enabled"] as? Bool, false)
            do { _ = try await manager.execute(owner: "first@example.test", operation: "\(service).list", parameters: [:], actionID: UUID().uuidString); XCTFail("Must reject disconnected source \(service)") }
            catch { XCTAssertTrue(error.localizedDescription.contains("Connect")) }
        }
        try await manager.connect("first@example.test", "maps")
        XCTAssertTrue(manager.enabled("first@example.test", "maps"))
        XCTAssertFalse(manager.enabled("second@example.test", "maps"))
        manager.disconnect("first@example.test", "maps")
        XCTAssertFalse(manager.enabled("first@example.test", "maps"))
    }
    func testAllPermissionDescriptionsAreBundled() throws {
        for key in ["NSRemindersFullAccessUsageDescription", "NSContactsUsageDescription", "NSPhotoLibraryUsageDescription", "NSHealthShareUsageDescription", "NSHealthUpdateUsageDescription", "NSHomeKitUsageDescription", "NSAppleMusicUsageDescription", "NSLocationWhenInUseUsageDescription", "NSMotionUsageDescription", "NSAlarmKitUsageDescription"] {
            XCTAssertFalse((Bundle(for: BrowserModel.self).object(forInfoDictionaryKey: key) as? String)?.isEmpty ?? true, key)
        }
    }
    func testJournalPreservesUncertainActionsAndSeparatesAccounts() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try AppleActionJournal(owner: "first@example.test", root: root)
        let second = try AppleActionJournal(owner: "second@example.test", root: root)
        let action = UUID().uuidString, token = UUID().uuidString
        try first.save(action, ["token": token, "runId": UUID().uuidString])
        XCTAssertNil(try first.read(action)?["result"], "A started record without a result must remain distinguishable after a crash")
        XCTAssertEqual(try first.read(action)?["token"] as? String, token)
        XCTAssertNil(try second.read(action))
        try first.save(action, ["token": token, "result": ["ok": true, "id": "saved-reminder"]])
        XCTAssertEqual((try first.read(action)?["result"] as? [String: Any])?["id"] as? String, "saved-reminder")
        XCTAssertThrowsError(try first.read("../outside"))
        try first.clear()
    }
    func testFolderPathsCannotTraverseOrEscapeViaSymlink() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: outside) }
        for path in ["../private", "/private", "a/../b", "a//b", "a\\b", "a\0b"] { XCTAssertThrowsError(try AppleConnections.containedFile(root: root, path: path)) }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside)
        XCTAssertThrowsError(try AppleConnections.containedFile(root: root, path: "escape/private.txt"))
        XCTAssertEqual(try AppleConnections.containedFile(root: root, path: "notes.txt").lastPathComponent, "notes.txt")
    }
    func testOverlappingSleepSourcesAreNotCountedTwice() {
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(AppleConnections.mergedDuration([(start, start.addingTimeInterval(60)), (start.addingTimeInterval(30), start.addingTimeInterval(90)), (start.addingTimeInterval(120), start.addingTimeInterval(180))]), 150)
        XCTAssertEqual(AppleConnections.mergedDuration([]), 0)
    }
    func testMissingHealthQuantityDoesNotFailSummary() throws {
        let missing = NSError(domain: HKErrorDomain, code: HKError.Code.errorNoData.rawValue)
        XCTAssertNil(try AppleConnections.healthQuantityResult(nil, error: missing))
        XCTAssertEqual(try AppleConnections.healthQuantityResult(1200, error: nil), 1200)
        XCTAssertNil(try AppleConnections.healthQuantityResult(nil, error: nil))
        let locked = NSError(domain: HKErrorDomain, code: HKError.Code.errorDatabaseInaccessible.rawValue)
        XCTAssertThrowsError(try AppleConnections.healthQuantityResult(nil, error: locked))
        XCTAssertThrowsError(try AppleConnections.healthQuantityResult(nil, error: NSError(domain: "Other", code: missing.code)))
    }
    func testCoordinateAndDateValidation() throws {
        XCTAssertThrowsError(try AppleConnections.coordinate(["latitude": 91.0, "longitude": 0.0]))
        XCTAssertThrowsError(try AppleConnections.interval(["start": "2026-09-12T00:00:00Z", "end": "2026-09-11T00:00:00Z"]))
        XCTAssertThrowsError(try AppleConnections.date("tomorrow"))
        XCTAssertEqual(try AppleConnections.date("2026-09-11T10:00:00.000Z"), try AppleConnections.date("2026-09-11T10:00:00Z"))
    }
    func testRealFileWriteReadAndOverwriteProtection() async throws {
        let manager = manager(), owner = "files-fixture@example.test"
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        manager.defaults.set(try root.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil), forKey: manager.key(owner, "files") + ".folder")
        manager.defaults.set(true, forKey: manager.key(owner, "files"))
        _ = try await manager.execute(owner: owner, operation: "files.write", parameters: ["path": "test.txt", "text": "Original"], actionID: UUID().uuidString)
        let first = try await manager.execute(owner: owner, operation: "files.read", parameters: ["path": "test.txt"], actionID: UUID().uuidString)
        XCTAssertEqual(first["text"] as? String, "Original")
        do { _ = try await manager.execute(owner: owner, operation: "files.write", parameters: ["path": "test.txt", "text": "Unapproved overwrite"], actionID: UUID().uuidString); XCTFail("Must refuse overwrite") } catch { }
        _ = try await manager.execute(owner: owner, operation: "files.write", parameters: ["path": "test.txt", "text": "Approved", "overwrite": true], actionID: UUID().uuidString)
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("test.txt"), encoding: .utf8), "Approved")
        manager.disconnect(owner, "files")
        XCTAssertNil(manager.defaults.data(forKey: manager.key(owner, "files") + ".folder"))
    }
    func testRealContactsCreateReadUpdate() async throws {
        guard CNContactStore.authorizationStatus(for: .contacts) == .authorized else { throw XCTSkip("Grant simulator Contacts access before the integration test.") }
        let manager = manager(), owner = "contacts-fixture@example.test"
        try await manager.connect(owner, "contacts")
        let created = try await manager.execute(owner: owner, operation: "contacts.create", parameters: ["givenName": "DashFixture", "familyName": UUID().uuidString, "email": "fixture@example.test"], actionID: UUID().uuidString)
        let id = try XCTUnwrap((created["contact"] as? [String: Any])?["id"] as? String)
        defer {
            if let contact = try? manager.contacts.unifiedContact(withIdentifier: id, keysToFetch: manager.contactKeys).mutableCopy() as? CNMutableContact { let request = CNSaveRequest(); request.delete(contact); try? manager.contacts.execute(request) }
        }
        let updated = try await manager.execute(owner: owner, operation: "contacts.update", parameters: ["id": id, "phone": "+14165550123"], actionID: UUID().uuidString)
        XCTAssertEqual((updated["contact"] as? [String: Any])?["phones"] as? [String], ["+14165550123"])
        let found = try await manager.execute(owner: owner, operation: "contacts.search", parameters: ["query": "fixture@example.test"], actionID: UUID().uuidString)
        XCTAssertTrue((found["contacts"] as? [[String: Any]])?.contains { $0["id"] as? String == id } ?? false)
    }
    func testRealReminderCreateUpdateComplete() async throws {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { throw XCTSkip("Grant simulator Reminders access before the integration test.") }
        let manager = manager(), owner = "reminders-fixture@example.test"
        try await manager.connect(owner, "reminders")
        let calendar = EKCalendar(for: .reminder, eventStore: manager.reminders)
        guard let source = manager.reminders.sources.first(where: { $0.sourceType == .local }) ?? manager.reminders.defaultCalendarForNewReminders()?.source else { throw XCTSkip("Simulator has no Reminders source.") }
        calendar.title = "Dash fixture \(UUID().uuidString)"; calendar.source = source
        try manager.reminders.saveCalendar(calendar, commit: true)
        defer { try? manager.reminders.removeCalendar(calendar, commit: true) }
        let created = try await manager.execute(owner: owner, operation: "reminders.create", parameters: ["title": "Fixture", "listId": calendar.calendarIdentifier], actionID: UUID().uuidString)
        let id = try XCTUnwrap((created["reminder"] as? [String: Any])?["id"] as? String)
        _ = try await manager.execute(owner: owner, operation: "reminders.update", parameters: ["id": id, "title": "Changed", "text": "Fixture notes"], actionID: UUID().uuidString)
        let completed = try await manager.execute(owner: owner, operation: "reminders.complete", parameters: ["id": id, "completed": true], actionID: UUID().uuidString)
        XCTAssertEqual((completed["reminder"] as? [String: Any])?["completed"] as? Bool, true)
        let found = try await manager.execute(owner: owner, operation: "reminders.list", parameters: ["listId": calendar.calendarIdentifier, "completed": true], actionID: UUID().uuidString)
        XCTAssertEqual((found["reminders"] as? [[String: Any]])?.first?["title"] as? String, "Changed")
    }
    func testRealPhotosReadAndAlbumActions() async throws {
        let manager = manager(), owner = "photos-fixture@example.test"
        try await manager.connect(owner, "photos")
        let image = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 200)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 400, height: 200))
            ("DASH TEST" as NSString).draw(at: CGPoint(x: 35, y: 65), withAttributes: [.font: UIFont.systemFont(ofSize: 42), .foregroundColor: UIColor.black])
        }
        let saved = try await manager.execute(owner: owner, operation: "photos.save", parameters: ["imageData": image.jpegData(compressionQuality: 0.9)!], actionID: UUID().uuidString)
        let id = try XCTUnwrap(saved["id"] as? String)
        var albumID: String?
        defer {
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil))
                if let albumID { PHAssetCollectionChangeRequest.deleteAssetCollections(PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID], options: nil)) }
            }
        }
        let read = try await manager.execute(owner: owner, operation: "photos.read", parameters: ["id": id], actionID: UUID().uuidString)
        XCTAssertTrue((read["text"] as? String)?.contains("DASH") ?? false)
        XCTAssertNotNil(read["imageBase64"])
        let album = try await manager.execute(owner: owner, operation: "photos.createAlbum", parameters: ["title": "Dash test \(UUID().uuidString)"], actionID: UUID().uuidString)
        albumID = try XCTUnwrap(album["id"] as? String)
        _ = try await manager.execute(owner: owner, operation: "photos.addToAlbum", parameters: ["id": id, "albumId": albumID!], actionID: UUID().uuidString)
        let collection = try XCTUnwrap(PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID!], options: nil).firstObject)
        XCTAssertEqual(PHAsset.fetchAssets(in: collection, options: nil).count, 1)
    }
    func testRealMapsSearchAndDirections() async throws {
        let manager = manager(), owner = "maps-fixture@example.test"
        try await manager.connect(owner, "maps")
        let result = try await manager.execute(owner: owner, operation: "maps.search", parameters: ["query": "CN Tower Toronto", "limit": 3], actionID: UUID().uuidString)
        XCTAssertFalse((result["places"] as? [[String: Any]])?.isEmpty ?? true)
        let directions = try await manager.execute(owner: owner, operation: "maps.directions", parameters: ["latitude": 43.6426, "longitude": -79.3871, "destinationLatitude": 43.6453, "destinationLongitude": -79.3806, "transport": "walking"], actionID: UUID().uuidString)
        XCTAssertFalse((directions["routes"] as? [[String: Any]])?.isEmpty ?? true)
    }
}
