import EventKit
import Foundation

@MainActor
final class DeviceCalendarManager {
    private let store = EKEventStore()

    func snapshot(requestAccess: Bool) async -> [String: Any] {
        var status = EKEventStore.authorizationStatus(for: .event)
        if requestAccess && status == .notDetermined {
            do { _ = try await store.requestFullAccessToEvents() } catch { }
            status = EKEventStore.authorizationStatus(for: .event)
        }
        let statusName: String
        switch status {
        case .fullAccess, .authorized: statusName = "authorized"
        case .writeOnly: statusName = "writeOnly"
        case .denied, .restricted: statusName = "denied"
        case .notDetermined: statusName = "notDetermined"
        @unknown default: statusName = "unavailable"
        }
        guard status == .fullAccess || status == .authorized else {
            return ["status": statusName, "events": []]
        }
        let start = Date().addingTimeInterval(-86_400)
        let end = Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date().addingTimeInterval(7_776_000)
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
        let formatter = ISO8601DateFormatter()
        return [
            "status": statusName,
            "events": events.prefix(500).map { event in
                [
                    "id": event.eventIdentifier ?? UUID().uuidString,
                    "summary": event.title ?? "Event",
                    "description": event.notes ?? "",
                    "location": event.location ?? "",
                    "calendar": event.calendar.title,
                    "start": ["dateTime": formatter.string(from: event.startDate)],
                    "end": ["dateTime": formatter.string(from: event.endDate)],
                    "attendees": (event.attendees ?? []).map { ["displayName": $0.name ?? ""] },
                    "htmlLink": "",
                ] as [String: Any]
            },
        ]
    }
}
