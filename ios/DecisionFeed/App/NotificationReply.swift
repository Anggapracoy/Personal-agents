import CryptoKit
import Foundation
import Security
import UserNotifications
import WebKit

enum NotificationReplyActions {
    static let category = "conversation.reply"
    static let failureCategory = "conversation.reply.failed"
    static let reply = "conversation.reply.send"
    static let retry = "conversation.reply.retry"
    static let open = "conversation.reply.open"

    static func categories() -> Set<UNNotificationCategory> {
        let replyAction = UNTextInputNotificationAction(
            identifier: reply, title: "Reply", options: [.authenticationRequired],
            textInputButtonTitle: "Send", textInputPlaceholder: "Message…"
        )
        let retryAction = UNNotificationAction(identifier: retry, title: "Try Again", options: [.authenticationRequired])
        let openAction = UNNotificationAction(identifier: open, title: "Open Chat", options: [.foreground])
        return [
            UNNotificationCategory(identifier: category, actions: [replyAction], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: failureCategory, actions: [retryAction, openAction], intentIdentifiers: [], options: []),
        ]
    }
}

struct NotificationReply: Codable, Equatable {
    let eventId: String
    let accountKey: String
    let text: String
    let runId: String?
    let decisionId: String?

    init?(userInfo: [AnyHashable: Any], text: String, notificationID: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf16.count <= 16_000,
              let accountKey = userInfo["replyAccountKey"] as? String,
              accountKey.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        let kind = userInfo["notificationKind"] as? String
        let runID = userInfo["runId"] as? String
        let decisionID = userInfo["decisionId"] as? String
        if kind == "run_completion" || kind == "run_attention" {
            guard let runID, UUID(uuidString: runID) != nil else { return nil }
            self.runId = runID
            self.decisionId = nil
        } else if kind == "decision" {
            guard let decisionID, !decisionID.isEmpty, decisionID.utf16.count <= 200 else { return nil }
            self.runId = nil
            self.decisionId = decisionID
        } else { return nil }
        self.accountKey = accountKey
        self.text = text
        // The same system response or a failed-send retry has one durable server receipt.
        self.eventId = SHA256.hash(data: Data("\(notificationID)\n\(accountKey)\n\(runID ?? decisionID ?? "")\n\(text)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }
}

enum NotificationReplyError: Error, Equatable {
    case signIn, unavailable
}

/// The verified session is available without starting WebKit on a background launch.
/// It remains device-local, expires with the session, and is cleared on sign-out.
struct NotificationReplySession: Codable {
    let origin: String
    let accountKey: String
    let cookieHeader: String
    let expiresAt: Date

    static func origin(for url: URL) -> String { "\(url.scheme ?? "")://\(url.host ?? ""):\(url.port ?? (url.scheme == "https" ? 443 : 80))" }

    static func verified(data: Data, cookies: [HTTPCookie], baseURL: URL) -> Self? {
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = payload["user"] as? [String: Any], let email = user["email"] as? String,
              let expiry = payload["expires"] as? String else { return nil }
        let owner = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expires = formatter.date(from: expiry) ?? ISO8601DateFormatter().date(from: expiry)
        let matching = NotificationReplyService.sessionCookies(cookies, baseURL: baseURL)
        guard !owner.isEmpty, let expires, expires > Date(), !matching.isEmpty,
              let header = HTTPCookie.requestHeaderFields(with: matching)["Cookie"] else { return nil }
        return Self(origin: origin(for: baseURL), accountKey: SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined(),
                    cookieHeader: header, expiresAt: min(expires, matching.compactMap(\.expiresDate).min() ?? expires))
    }

    func matches(_ reply: NotificationReply, baseURL: URL) -> Bool {
        origin == Self.origin(for: baseURL) && accountKey == reply.accountKey && expiresAt > Date()
    }
}

@MainActor
enum NotificationReplySessionStore {
    private(set) static var generation = 0
    private static func query(_ baseURL: URL) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.example.dash.notification-session.v1",
         kSecAttrAccount as String: NotificationReplySession.origin(for: baseURL)]
    }
    static func save(_ session: NotificationReplySession, baseURL: URL) throws {
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(session),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let match = query(baseURL)
        let updated = SecItemUpdate(match as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { saveShared(attributes); return }
        guard updated == errSecItemNotFound else { throw NotificationReplyError.unavailable }
        guard SecItemAdd(match.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw NotificationReplyError.unavailable }
        saveShared(attributes)
    }
    /// The share extension starts conversations with this copy. It lives in the app group's keychain group.
    private static let sharedQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.example.dash.share-session.v1",
        kSecAttrAccount as String: "current",
        kSecAttrAccessGroup as String: "group.com.example.dash"]
    private static func saveShared(_ attributes: [String: Any]) {
        if SecItemUpdate(sharedQuery as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(sharedQuery.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
    }
    static func read(baseURL: URL) -> NotificationReplySession? {
        var match = query(baseURL)
        match[kSecReturnData as String] = true
        match[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(match as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(NotificationReplySession.self, from: data)
    }
    static func clear(baseURL: URL) { generation += 1; SecItemDelete(query(baseURL) as CFDictionary); SecItemDelete(sharedQuery as CFDictionary) }
}

/// A silent push asks this iPhone to answer one waiting read-only request (Reminders, Contacts,
/// Maps, Weather, Motion) so scheduled and background tasks don't stall until Dash is opened.
@MainActor
enum BackgroundAppleActions {
    private static let connections = AppleConnections()
    private static var inFlight = Set<String>()
    /// Changes always wait for the open app.
    static let backgroundReads: Set<String> = ["reminders.lists", "reminders.list", "contacts.search", "maps.search", "maps.directions", "weather.forecast", "motion.summary"]

    static func handle(_ userInfo: [AnyHashable: Any]) async -> Bool {
        guard let wake = userInfo["dashAppleAction"] as? [String: Any],
              let runID = wake["runId"] as? String, UUID(uuidString: runID) != nil,
              let actionID = wake["actionId"] as? String, UUID(uuidString: actionID) != nil,
              let operation = wake["operation"] as? String, backgroundReads.contains(operation),
              !inFlight.contains(actionID) else { return false }
        let baseURL = AppConfiguration.load().baseURL
        guard let session = NotificationReplySessionStore.read(baseURL: baseURL),
              session.origin == NotificationReplySession.origin(for: baseURL), session.expiresAt > Date() else { return false }
        inFlight.insert(actionID)
        defer { inFlight.remove(actionID) }
        do {
            _ = try await AppleActionRunner.run(
                runID: runID, actionID: actionID, journal: try AppleActionJournal(ownerKey: session.accountKey),
                expectedOwner: nil, expectedOwnerKey: session.accountKey, onlyOperation: operation, connections: connections,
                fetch: { path, method, body in
                    var request = URLRequest(url: baseURL.appending(path: path), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
                    request.httpMethod = method
                    request.httpBody = body
                    request.timeoutInterval = 15
                    request.httpShouldHandleCookies = false
                    request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
                    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
                    let (data, response) = try await URLSession.shared.data(for: request)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
                    return data
                })
            return true
        } catch {
            return false
        }
    }
}

@MainActor
enum NotificationReplyService {
    /// Independent of BrowserModel and page readiness, including a cold background launch.
    static func handle(_ response: UNNotificationResponse) async -> Bool {
        let content = response.notification.request.content
        let reply: NotificationReply?
        if response.actionIdentifier == NotificationReplyActions.reply {
            guard let input = response as? UNTextInputNotificationResponse else { return true }
            reply = NotificationReply(userInfo: content.userInfo, text: input.userText, notificationID: response.notification.request.identifier)
        } else if response.actionIdentifier == NotificationReplyActions.retry {
            reply = (content.userInfo["savedReply"] as? String).flatMap { $0.data(using: .utf8) }
                .flatMap { try? JSONDecoder().decode(NotificationReply.self, from: $0) }
        } else { return false }

        guard let reply else {
            await showFailure(reply: nil, original: content, signIn: false)
            return true
        }
        do {
            try await sendInBackground(reply, baseURL: AppConfiguration.load().baseURL)
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["reply-failed-\(reply.eventId)"])
        } catch {
            await showFailure(reply: reply, original: content, signIn: (error as? NotificationReplyError) == .signIn)
        }
        return true
    }

    nonisolated static func sessionCookies(_ cookies: [HTTPCookie], baseURL: URL) -> [HTTPCookie] {
        guard let host = baseURL.host?.lowercased() else { return [] }
        return cookies.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let isSession = cookie.name == "decision-feed.session-token" || cookie.name.range(of: "^decision-feed\\.session-token\\.[0-9]+$", options: .regularExpression) != nil
            return isSession && (host == domain || host.hasSuffix(".\(domain)"))
                && (cookie.expiresDate.map { $0 > Date() } ?? true)
                && (!cookie.isSecure || baseURL.scheme == "https")
                && "/api/mobile/notification-reply".hasPrefix(cookie.path)
        }
    }

    static func sendInBackground(_ reply: NotificationReply, baseURL: URL,
                                cookies: () async -> [HTTPCookie] = {
        await withCheckedContinuation { continuation in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
    }, transport: (URLRequest) async throws -> (Data, URLResponse) = { try await URLSession.shared.data(for: $0) }) async throws {
        let session = NotificationReplySessionStore.read(baseURL: baseURL)
        if let session, session.matches(reply, baseURL: baseURL) {
            // No WebKit dependency when iOS launches us solely for a notification action.
            do {
                try await send(reply, baseURL: baseURL, cookies: [], session: session, transport: transport)
                return
            } catch NotificationReplyError.signIn {
                // A foreground session may have changed since the last verified snapshot.
            }
        }
        try await send(reply, baseURL: baseURL, cookies: await cookies(), transport: transport)
    }

    static func request(_ reply: NotificationReply, baseURL: URL, cookies: [HTTPCookie], session: NotificationReplySession? = nil) throws -> URLRequest {
        let header: String?
        if let session {
            guard session.matches(reply, baseURL: baseURL) else { throw NotificationReplyError.signIn }
            header = session.cookieHeader
        } else {
            let matching = sessionCookies(cookies, baseURL: baseURL)
            guard !matching.isEmpty else { throw NotificationReplyError.signIn }
            header = HTTPCookie.requestHeaderFields(with: matching)["Cookie"]
        }
        var request = URLRequest(url: baseURL.appending(path: "api/mobile/notification-reply"), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(reply)
        request.timeoutInterval = 15
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(header, forHTTPHeaderField: "Cookie")
        return request
    }

    static func send(_ reply: NotificationReply, baseURL: URL, cookies: [HTTPCookie], session: NotificationReplySession? = nil,
                     transport: (URLRequest) async throws -> (Data, URLResponse) = { try await URLSession.shared.data(for: $0) }) async throws {
        let (data, response) = try await transport(request(reply, baseURL: baseURL, cookies: cookies, session: session))
        guard let http = response as? HTTPURLResponse else { throw NotificationReplyError.unavailable }
        if http.statusCode == 401 || http.statusCode == 403 { throw NotificationReplyError.signIn }
        guard http.statusCode == 202,
              let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              receipt["accepted"] as? Bool == true else { throw NotificationReplyError.unavailable }
    }

    private static func showFailure(reply: NotificationReply?, original: UNNotificationContent, signIn: Bool) async {
        let content = UNMutableNotificationContent()
        content.title = original.title.isEmpty ? "Dash" : original.title
        content.body = signIn ? "Open Dash to sign in, then try sending your reply again."
            : reply == nil ? "Your reply couldn’t be sent. Open this conversation to reply."
            : "Your reply couldn’t be confirmed. Tap Try Again to send it safely."
        content.sound = .default
        content.threadIdentifier = original.threadIdentifier
        content.userInfo = original.userInfo
        content.userInfo["replyFailed"] = true
        if let reply, let data = try? JSONEncoder().encode(reply), let json = String(data: data, encoding: .utf8) {
            content.userInfo["savedReply"] = json
            content.categoryIdentifier = NotificationReplyActions.failureCategory
        }
        let request = UNNotificationRequest(identifier: "reply-failed-\(reply?.eventId ?? UUID().uuidString)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}
