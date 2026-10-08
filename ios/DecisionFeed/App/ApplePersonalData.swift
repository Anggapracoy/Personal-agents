import Contacts
import EventKit
import Foundation
import PDFKit
import Photos
import UIKit
import Vision

extension AppleConnections {
    func reminderValue(_ reminder: EKReminder) -> [String: Any] {
        var value: [String: Any] = ["id": reminder.calendarItemIdentifier, "title": reminder.title ?? "", "text": reminder.notes ?? "", "completed": reminder.isCompleted, "listId": reminder.calendar.calendarIdentifier]
        if let date = reminder.dueDateComponents?.date { value["date"] = ISO8601DateFormatter().string(from: date) }
        return value
    }
    func reminderAction(_ operation: String, _ p: [String: Any]) async throws -> [String: Any] {
        if operation == "reminders.lists" {
            return ["lists": reminders.calendars(for: .reminder).map { ["id": $0.calendarIdentifier, "title": $0.title, "writable": $0.allowsContentModifications] as [String: Any] }]
        }
        if operation == "reminders.list" {
            let calendars: [EKCalendar]?
            if let id = p["listId"] as? String {
                guard let calendar = reminders.calendar(withIdentifier: id), calendar.allowedEntityTypes.contains(.reminder) else { throw AppleConnectionFailure("That reminder list no longer exists.") }
                calendars = [calendar]
            } else { calendars = nil }
            let fetched: [EKReminder] = try await withCheckedThrowingContinuation { continuation in
                reminders.fetchReminders(matching: reminders.predicateForReminders(in: calendars)) { values in
                    if let values { continuation.resume(returning: values) } else { continuation.resume(throwing: AppleConnectionFailure("Reminders could not be loaded. Check access in iPhone Settings.")) }
                }
            }
            let query = (p["query"] as? String) ?? ""
            let matching = fetched.filter { reminder in
                (query.isEmpty || (reminder.title ?? "").localizedCaseInsensitiveContains(query) || (reminder.notes ?? "").localizedCaseInsensitiveContains(query)) && ((p["completed"] as? Bool).map { reminder.isCompleted == $0 } ?? true)
            }.sorted { ($0.dueDateComponents?.date ?? .distantFuture) < ($1.dueDateComponents?.date ?? .distantFuture) }
            return ["reminders": matching.prefix(Self.limit(p)).map(reminderValue), "hasMore": matching.count > Self.limit(p)]
        }
        let reminder: EKReminder
        if operation == "reminders.create" {
            reminder = EKReminder(eventStore: reminders)
            reminder.title = try Self.string(p, "title")
            let calendar = (p["listId"] as? String).flatMap { reminders.calendar(withIdentifier: $0) } ?? reminders.defaultCalendarForNewReminders()
            guard let calendar, calendar.allowsContentModifications else { throw AppleConnectionFailure("No writable reminder list is available.") }
            if let requested = p["listId"] as? String, calendar.calendarIdentifier != requested { throw AppleConnectionFailure("That reminder list no longer exists.") }
            reminder.calendar = calendar
        } else {
            guard let found = reminders.calendarItem(withIdentifier: try Self.string(p, "id")) as? EKReminder, found.calendar.allowsContentModifications else { throw AppleConnectionFailure("That reminder is unavailable or read-only.") }
            reminder = found
        }
        switch operation {
        case "reminders.create", "reminders.update":
            if let title = p["title"] as? String { guard !title.isEmpty else { throw AppleConnectionFailure("A reminder needs a title.") }; reminder.title = title }
            if let text = p["text"] as? String { reminder.notes = text }
            if p["date"] is NSNull { reminder.dueDateComponents = nil }
            else if p["date"] != nil {
                var components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: try Self.date(p["date"]))
                components.calendar = Calendar.current; components.timeZone = TimeZone.current
                reminder.dueDateComponents = components
            }
        case "reminders.complete":
            guard let completed = p["completed"] as? Bool else { throw AppleConnectionFailure("Specify whether the reminder is complete.") }
            reminder.isCompleted = completed
        default: throw AppleConnectionFailure("Unsupported reminder action.")
        }
        try reminders.save(reminder, commit: true)
        guard let saved = reminders.calendarItem(withIdentifier: reminder.calendarItemIdentifier) as? EKReminder else { throw AppleConnectionFailure("The reminder was saved but could not be read back. Verify before repeating.") }
        return ["reminder": reminderValue(saved)]
    }

    var contactKeys: [CNKeyDescriptor] { [CNContactIdentifierKey, CNContactGivenNameKey, CNContactFamilyNameKey, CNContactEmailAddressesKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor] }
    func contactValue(_ contact: CNContact) -> [String: Any] {
        ["id": contact.identifier, "givenName": contact.givenName, "familyName": contact.familyName, "emails": contact.emailAddresses.map { $0.value as String }, "phones": contact.phoneNumbers.map { $0.value.stringValue }]
    }
    func contactAction(_ operation: String, _ p: [String: Any]) throws -> [String: Any] {
        if operation == "contacts.search" {
            let query = (p["query"] as? String) ?? ""
            let request = CNContactFetchRequest(keysToFetch: contactKeys)
            request.sortOrder = .userDefault
            var result = [[String: Any]]()
            try contacts.enumerateContacts(with: request) { contact, stop in
                let match = query.isEmpty || "\(contact.givenName) \(contact.familyName)".localizedCaseInsensitiveContains(query) || contact.emailAddresses.contains { ($0.value as String).localizedCaseInsensitiveContains(query) } || contact.phoneNumbers.contains { $0.value.stringValue.contains(query) }
                if match { result.append(self.contactValue(contact)) }
                if result.count > Self.limit(p) { stop.pointee = true }
            }
            return ["contacts": Array(result.prefix(Self.limit(p))), "hasMore": result.count > Self.limit(p)]
        }
        let contact: CNMutableContact
        if operation == "contacts.create" { contact = CNMutableContact(); contact.givenName = try Self.string(p, "givenName") }
        else if operation == "contacts.update" {
            guard let editable = try contacts.unifiedContact(withIdentifier: Self.string(p, "id"), keysToFetch: contactKeys).mutableCopy() as? CNMutableContact else { throw AppleConnectionFailure("That contact cannot be edited.") }
            contact = editable
        } else { throw AppleConnectionFailure("Unsupported contact action.") }
        if let value = p["givenName"] as? String { contact.givenName = value }
        if let value = p["familyName"] as? String { contact.familyName = value }
        if let value = p["email"] as? String { contact.emailAddresses = value.isEmpty ? [] : [CNLabeledValue(label: CNLabelHome, value: value as NSString)] }
        if let value = p["phone"] as? String { contact.phoneNumbers = value.isEmpty ? [] : [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: value))] }
        let request = CNSaveRequest()
        if operation == "contacts.create" { request.add(contact, toContainerWithIdentifier: nil) } else { request.update(contact) }
        try contacts.execute(request)
        return ["contact": contactValue(try contacts.unifiedContact(withIdentifier: contact.identifier, keysToFetch: contactKeys))]
    }

    static func safeRelativePath(_ path: String) -> Bool {
        !path.isEmpty && path.count <= 500 && !path.hasPrefix("/") && !path.contains("\\") && !path.contains("\0") && path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    static func containedFile(root: URL, path: String) throws -> URL {
        guard safeRelativePath(path) else { throw AppleConnectionFailure("Use a relative path inside the connected folder.") }
        let base = root.resolvingSymlinksInPath().standardizedFileURL
        var componentURL = base
        for component in path.split(separator: "/") {
            componentURL.appendPathComponent(String(component))
            if (try? FileManager.default.attributesOfItem(atPath: componentURL.path)[.type]) as? FileAttributeType == .typeSymbolicLink {
                throw AppleConnectionFailure("Symbolic links are not supported inside the connected folder.")
            }
        }
        let target = componentURL.resolvingSymlinksInPath().standardizedFileURL
        guard target.path.hasPrefix(base.path + "/") else { throw AppleConnectionFailure("That file is outside the connected folder.") }
        return target
    }
    func fileAction(_ owner: String, _ operation: String, _ p: [String: Any]) throws -> [String: Any] {
        guard let bookmark = defaults.data(forKey: key(owner, "files") + ".folder") else { throw AppleConnectionFailure("Choose a folder in Settings first.") }
        var stale = false
        let root = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        let scoped = root.startAccessingSecurityScopedResource()
        guard !stale, scoped || root.standardizedFileURL.path.hasPrefix(NSHomeDirectory() + "/") else { throw AppleConnectionFailure("Folder access expired. Reconnect Files in Settings.") }
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        if operation == "files.list" {
            let urls = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey], options: [.skipsHiddenFiles]).sorted { $0.lastPathComponent < $1.lastPathComponent }
            return ["files": try urls.prefix(100).map { url -> [String: Any] in
                let values = try url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
                return ["path": url.lastPathComponent, "directory": values.isDirectory ?? false, "bytes": values.fileSize ?? 0]
            }, "hasMore": urls.count > 100]
        }
        let target = try Self.containedFile(root: root, path: Self.string(p, "path"))
        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var operationError: Error?
        var result: [String: Any] = [:]
        if operation == "files.write" {
            guard let text = p["text"] as? String else { throw AppleConnectionFailure("Text is required to save a file.") }
            guard text.utf8.count <= 100_000 else { throw AppleConnectionFailure("This text file is too large.") }
            coordinator.coordinate(writingItemAt: target, options: [], error: &coordinationError) { url in
                do {
                    guard !FileManager.default.fileExists(atPath: url.path) || p["overwrite"] as? Bool == true else { throw AppleConnectionFailure("That file already exists. Explicitly approve overwrite to replace it.") }
                    try Data(text.utf8).write(to: url, options: .atomic)
                    result = ["path": p["path"] as? String ?? "", "bytes": text.utf8.count, "saved": true]
                } catch { operationError = error }
            }
        } else if operation == "files.read" {
            coordinator.coordinate(readingItemAt: target, options: [], error: &coordinationError) { url in
                do {
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 10_000_000 else { throw AppleConnectionFailure("Choose a file smaller than 10 MB.") }
                    let text: String
                    if url.pathExtension.lowercased() == "pdf" {
                        guard let document = PDFDocument(url: url) else { throw AppleConnectionFailure("That PDF could not be read.") }
                        guard !document.isLocked else { throw AppleConnectionFailure("Unlock the PDF before sharing it.") }
                        text = document.string ?? ""
                    } else {
                        guard let value = String(data: try Data(contentsOf: url), encoding: .utf8) else { throw AppleConnectionFailure("This file needs to be shared as an attachment. Direct reading supports UTF-8 text and PDFs.") }
                        text = value
                    }
                    result = ["path": p["path"] as? String ?? "", "text": String(text.prefix(80_000)), "truncated": text.count > 80_000]
                } catch { operationError = error }
            }
        } else { throw AppleConnectionFailure("Unsupported file action.") }
        if let error = coordinationError ?? operationError as NSError? { throw error }
        return result
    }

    func photoAction(_ operation: String, _ p: [String: Any]) async throws -> [String: Any] {
        if operation == "photos.save" {
            guard let data = p["imageData"] as? Data, data.count <= 10_000_000, let image = UIImage(data: data) else { throw AppleConnectionFailure("That artifact is not a supported image.") }
            var id: String?
            try await PHPhotoLibrary.shared().performChanges { id = PHAssetChangeRequest.creationRequestForAsset(from: image).placeholderForCreatedAsset?.localIdentifier }
            guard let id else { throw AppleConnectionFailure("The photo result is unknown. Check Photos before repeating.") }
            return ["id": id, "saved": true]
        }
        if operation == "photos.albums" {
            let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
            var values = [[String: Any]]()
            albums.enumerateObjects { album, _, stop in
                values.append(["id": album.localIdentifier, "title": album.localizedTitle ?? "Album"])
                if values.count >= 100 { stop.pointee = true }
            }
            return ["albums": values, "access": PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited ? "selected_photos" : "library"]
        }
        if operation == "photos.list" {
            let options = PHFetchOptions(); options.fetchLimit = Self.limit(p) + 1
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            var predicates = [NSPredicate(format: "mediaType = %d", PHAssetMediaType.image.rawValue)]
            if p["start"] is String { predicates.append(NSPredicate(format: "creationDate >= %@", try Self.date(p["start"]) as NSDate)) }
            if p["end"] is String { predicates.append(NSPredicate(format: "creationDate < %@", try Self.date(p["end"]) as NSDate)) }
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            let assets = PHAsset.fetchAssets(with: options)
            var values = [[String: Any]]()
            assets.enumerateObjects { asset, index, stop in
                if index >= Self.limit(p) { stop.pointee = true; return }
                values.append(["id": asset.localIdentifier, "date": asset.creationDate.map { ISO8601DateFormatter().string(from: $0) } ?? "", "width": asset.pixelWidth, "height": asset.pixelHeight, "favorite": asset.isFavorite])
            }
            return ["photos": values, "hasMore": assets.count > Self.limit(p), "access": PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited ? "selected_photos" : "library"]
        }
        if operation == "photos.createAlbum" {
            let title = try Self.string(p, "title")
            var id: String?
            try await PHPhotoLibrary.shared().performChanges { id = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title).placeholderForCreatedAssetCollection.localIdentifier }
            guard let id else { throw AppleConnectionFailure("The album result is unknown. Check Photos before repeating.") }
            return ["id": id, "title": title]
        }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [try Self.string(p, "id")], options: nil).firstObject else { throw AppleConnectionFailure("That photo is unavailable. It may not be included in your selected photos.") }
        if operation == "photos.addToAlbum" {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [try Self.string(p, "albumId")], options: nil).firstObject, album.canPerform(.addContent) else { throw AppleConnectionFailure("That album cannot be changed.") }
            var submitted = false
            try await PHPhotoLibrary.shared().performChanges {
                if let change = PHAssetCollectionChangeRequest(for: album) { change.addAssets([asset] as NSArray); submitted = true }
            }
            guard submitted else { throw AppleConnectionFailure("The album could not be changed.") }
            let members = PHAsset.fetchAssets(in: album, options: nil)
            var found = false
            members.enumerateObjects { candidate, _, stop in
                if candidate.localIdentifier == asset.localIdentifier { found = true; stop.pointee = true }
            }
            guard found else { throw AppleConnectionFailure("The album change could not be verified. Check Photos before repeating.") }
            return ["added": true, "id": asset.localIdentifier, "albumId": album.localIdentifier]
        }
        guard operation == "photos.read" else { throw AppleConnectionFailure("Unsupported photo action.") }
        let image: UIImage = try await withCheckedThrowingContinuation { continuation in
            let options = PHImageRequestOptions(); options.isNetworkAccessAllowed = true; options.deliveryMode = .highQualityFormat
            PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 1200, height: 1200), contentMode: .aspectFit, options: options) { image, info in
                if info?[PHImageResultIsDegradedKey] as? Bool == true { return }
                if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: AppleConnectionFailure("That photo could not be downloaded from Photos.")) }
            }
        }
        guard let cg = image.cgImage, let bytes = image.jpegData(compressionQuality: 0.65), bytes.count <= 1_000_000 else { throw AppleConnectionFailure("That image could not be prepared for sharing.") }
        let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: cg).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        return ["id": asset.localIdentifier, "text": String(text.prefix(40_000)), "imageBase64": bytes.base64EncodedString(), "imageMimeType": "image/jpeg", "width": image.size.width, "height": image.size.height]
    }
}
