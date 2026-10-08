import AlarmKit
import Foundation
import HomeKit
import MusicKit
import SwiftUI

extension AppleConnections {
    func homeAction(_ operation: String, _ p: [String: Any]) async throws -> [String: Any] {
        try await loadHome()
        guard let home, home.authorizationStatus.contains(.authorized) else { throw AppleConnectionFailure("Home access is unavailable.") }
        if operation == "home.list" {
            var homes = [[String: Any]]()
            for value in home.homes {
                var accessories = [[String: Any]]()
                for accessory in value.accessories.prefix(100) {
                    var characteristics = [[String: Any]]()
                    for characteristic in accessory.services.flatMap(\.characteristics) where characteristic.properties.contains(HMCharacteristicPropertyReadable) {
                        var item: [String: Any] = ["id": characteristic.uniqueIdentifier.uuidString, "name": characteristic.localizedDescription, "type": characteristic.characteristicType, "writable": characteristic.properties.contains(HMCharacteristicPropertyWritable)]
                        if let value = characteristic.value, JSONSerialization.isValidJSONObject(["value": value]) { item["value"] = value }
                        if let metadata = characteristic.metadata {
                            item["format"] = metadata.format; item["unit"] = metadata.units
                            item["minimum"] = metadata.minimumValue; item["maximum"] = metadata.maximumValue
                            item["validValues"] = metadata.validValues
                        }
                        characteristics.append(item)
                    }
                    accessories.append(["id": accessory.uniqueIdentifier.uuidString, "name": accessory.name, "reachable": accessory.isReachable, "characteristics": characteristics])
                }
                homes.append(["id": value.uniqueIdentifier.uuidString, "name": value.name, "accessories": accessories, "scenes": value.actionSets.map { ["id": $0.uniqueIdentifier.uuidString, "name": $0.name] }])
            }
            return ["homes": homes, "stateFreshness": "Values are cached. Use home.read with a characteristic id to verify current state."]
        }
        let id = try Self.string(p, "id")
        if operation == "home.read" {
            let characteristics = home.homes.flatMap(\.accessories).flatMap(\.services).flatMap(\.characteristics)
            guard let characteristic = characteristics.first(where: { $0.uniqueIdentifier.uuidString == id }), characteristic.properties.contains(HMCharacteristicPropertyReadable) else { throw AppleConnectionFailure("That characteristic cannot be read.") }
            try await characteristic.readValue()
            guard let value = characteristic.value, JSONSerialization.isValidJSONObject(["value": value]) else { throw AppleConnectionFailure("This characteristic does not expose a supported value.") }
            return ["id": id, "value": value, "observedAt": ISO8601DateFormatter().string(from: Date())]
        }
        if operation == "home.scene" {
            for value in home.homes {
                if let scene = value.actionSets.first(where: { $0.uniqueIdentifier.uuidString == id }) {
                    try await value.executeActionSet(scene)
                    return ["id": id, "scene": scene.name, "executed": true]
                }
            }
            throw AppleConnectionFailure("That scene no longer exists.")
        }
        guard operation == "home.set", let value = p["value"], !(value is NSNull), value is String || value is NSNumber else { throw AppleConnectionFailure("A valid accessory value is required.") }
        let characteristics = home.homes.flatMap(\.accessories).flatMap(\.services).flatMap(\.characteristics)
        guard let characteristic = characteristics.first(where: { $0.uniqueIdentifier.uuidString == id }), characteristic.properties.contains(HMCharacteristicPropertyWritable) else { throw AppleConnectionFailure("That characteristic is unavailable or read-only.") }
        if let number = value as? NSNumber, let metadata = characteristic.metadata {
            if let minimum = metadata.minimumValue, number.doubleValue < minimum.doubleValue { throw AppleConnectionFailure("Value is below this accessory's minimum.") }
            if let maximum = metadata.maximumValue, number.doubleValue > maximum.doubleValue { throw AppleConnectionFailure("Value is above this accessory's maximum.") }
            if let valid = metadata.validValues, !valid.contains(number) { throw AppleConnectionFailure("That value is not supported by this accessory.") }
        }
        try await characteristic.writeValue(value)
        if characteristic.properties.contains(HMCharacteristicPropertyReadable) { try await characteristic.readValue() }
        return ["id": id, "value": characteristic.value ?? value, "written": true]
    }
    func songValue(_ song: Song) -> [String: Any] { ["id": song.id.rawValue, "title": song.title, "artist": song.artistName, "album": song.albumTitle ?? "", "url": song.url?.absoluteString ?? ""] }
    func catalogSongs(_ ids: [String]) async throws -> [Song] {
        guard !ids.isEmpty, ids.count <= 100 else { throw AppleConnectionFailure("Choose between 1 and 100 catalog songs.") }
        let request = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: ids.map { MusicItemID($0) })
        let items = try await request.response().items
        let indexed = Dictionary(uniqueKeysWithValues: items.map { ($0.id.rawValue, $0) })
        return try ids.map { id in guard let song = indexed[id] else { throw AppleConnectionFailure("A song is unavailable in your Apple Music storefront.") }; return song }
    }
    func musicAction(_ operation: String, _ p: [String: Any]) async throws -> [String: Any] {
        switch operation {
        case "music.search":
            var request = MusicCatalogSearchRequest(term: try Self.string(p, "query"), types: [Song.self]); request.limit = min(25, Self.limit(p))
            return ["songs": try await request.response().songs.map(songValue)]
        case "music.library":
            var songs = MusicLibraryRequest<Song>(); songs.limit = Self.limit(p)
            var playlists = MusicLibraryRequest<Playlist>(); playlists.limit = Self.limit(p)
            let songResult = try await songs.response(), playlistResult = try await playlists.response()
            return ["songs": songResult.items.map(songValue), "playlists": playlistResult.items.map { ["id": $0.id.rawValue, "title": $0.name] }, "note": "Library song IDs can differ from catalog IDs. Search the catalog before playback or adding songs."]
        case "music.createPlaylist":
            let ids = (p["songIds"] as? [String]) ?? []
            let songs = ids.isEmpty ? [] : try await catalogSongs(ids)
            let playlist = try await MusicLibrary.shared.createPlaylist(name: Self.string(p, "title"), description: p["text"] as? String, items: songs)
            return ["id": playlist.id.rawValue, "title": playlist.name, "created": true]
        case "music.addToLibrary":
            let songs = try await catalogSongs([Self.string(p, "id")])
            try await MusicLibrary.shared.add(songs[0])
            return ["added": true, "song": songValue(songs[0])]
        case "music.addToPlaylist":
            let id = try Self.string(p, "id")
            var request = MusicLibraryRequest<Playlist>(); request.filter(matching: \.id, equalTo: MusicItemID(id))
            guard var playlist = try await request.response().items.first else { throw AppleConnectionFailure("That playlist is unavailable.") }
            let songs = try await catalogSongs((p["songIds"] as? [String]) ?? [])
            var added = [String]()
            for song in songs {
                do { playlist = try await MusicLibrary.shared.add(song, to: playlist); added.append(song.id.rawValue) }
                catch { return ["ok": false, "error": "Some songs could not be added. Do not repeat songs listed in addedSongIds.", "id": id, "addedSongIds": added] }
            }
            return ["id": id, "addedSongIds": added]
        case "music.play":
            guard try await MusicSubscription.current.canPlayCatalogContent else { throw AppleConnectionFailure("An active Apple Music subscription is needed for catalog playback.") }
            let songs = try await catalogSongs([Self.string(p, "id")])
            ApplicationMusicPlayer.shared.queue = ApplicationMusicPlayer.Queue(for: songs)
            try await ApplicationMusicPlayer.shared.play()
            return ["playing": true, "song": songValue(songs[0])]
        case "music.pause":
            ApplicationMusicPlayer.shared.pause(); return ["paused": true]
        default: throw AppleConnectionFailure("Unsupported Music action.")
        }
    }
}

@available(iOS 26, *)
private struct DashAlarmMetadata: AlarmMetadata { var title: String }

@available(iOS 26, *)
extension AppleConnections {
    func alarmAction(_ owner: String, _ operation: String, _ p: [String: Any], actionID: String) async throws -> [String: Any] {
        let metadataKey = key(owner, "alarms") + ".created"
        var saved = defaults.dictionary(forKey: metadataKey) as? [String: [String: String]] ?? [:]
        let manager = AlarmManager.shared
        if operation == "alarms.list" {
            return ["alarms": try manager.alarms.filter { saved[$0.id.uuidString] != nil }.map { alarm in ["id": alarm.id.uuidString, "title": saved[alarm.id.uuidString]?["title"] ?? "Alarm", "date": saved[alarm.id.uuidString]?["date"] ?? "", "repeat": saved[alarm.id.uuidString]?["repeat"] ?? "", "state": String(describing: alarm.state)] }, "note": "Only alarms created by Dash for this account on this iPhone are included."]
        }
        if operation == "alarms.cancel" {
            let value = try Self.string(p, "id")
            guard let id = UUID(uuidString: value), saved[id.uuidString] != nil else { throw AppleConnectionFailure("That alarm does not belong to this account.") }
            try manager.cancel(id: id)
            saved.removeValue(forKey: id.uuidString); defaults.set(saved, forKey: metadataKey)
            return ["id": id.uuidString, "cancelled": true]
        }
        guard operation == "alarms.create" || operation == "alarms.timer", let id = UUID(uuidString: actionID) else { throw AppleConnectionFailure("Unsupported alarm action.") }
        let title = try Self.string(p, "title")
        let date: Date
        var schedule: Alarm.Schedule?
        if let weekdays = p["weekdays"] as? [String], !weekdays.isEmpty, operation == "alarms.create" {
            let days: [String: Locale.Weekday] = ["monday": .monday, "tuesday": .tuesday, "wednesday": .wednesday, "thursday": .thursday, "friday": .friday, "saturday": .saturday, "sunday": .sunday]
            guard let hour = p["hour"] as? Int, let minute = p["minute"] as? Int, (0...23).contains(hour), (0...59).contains(minute), weekdays.count <= 7, weekdays.allSatisfy({ days[$0.lowercased()] != nil }) else { throw AppleConnectionFailure("Choose weekdays, an hour from 0–23 and a minute from 0–59.") }
            schedule = .relative(.init(time: .init(hour: hour, minute: minute), repeats: .weekly(weekdays.compactMap { days[$0.lowercased()] })))
            date = .distantFuture
        } else if operation == "alarms.timer" {
            guard let seconds = p["seconds"] as? Double, seconds >= 1, seconds <= 7 * 86400 else { throw AppleConnectionFailure("Set a timer between one second and seven days.") }
            date = Date().addingTimeInterval(seconds)
        } else { date = try Self.date(p["date"]) }
        guard date > Date() else { throw AppleConnectionFailure("Choose a future alarm time.") }
        let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title), stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle"))
        let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert), metadata: DashAlarmMetadata(title: title), tintColor: Color(red: 0.15, green: 0.62, blue: 0.91))
        // A scheduled alert also backs a timer's end, without requiring a separate Live Activity extension.
        let configuration = AlarmManager.AlarmConfiguration.alarm(schedule: schedule ?? .fixed(date), attributes: attributes)
        let dateText = schedule == nil ? ISO8601DateFormatter().string(from: date) : ""
        let repeatText = (p["weekdays"] as? [String])?.joined(separator: ", ") ?? ""
        saved[id.uuidString] = ["title": title, "date": dateText, "repeat": repeatText]
        defaults.set(saved, forKey: metadataKey)
        let alarm = try await manager.schedule(id: id, configuration: configuration)
        guard try manager.alarms.contains(where: { $0.id == alarm.id }) else { throw AppleConnectionFailure("The alarm was scheduled but could not be verified. Check before repeating.") }
        return ["id": alarm.id.uuidString, "title": title, "date": dateText, "repeat": repeatText, "hour": p["hour"] ?? NSNull(), "minute": p["minute"] ?? NSNull(), "timeZone": TimeZone.current.identifier, "scheduled": true]
    }
}
