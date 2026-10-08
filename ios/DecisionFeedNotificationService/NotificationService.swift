import Intents
import UserNotifications

/// Uses bundled conversation characters, so avatars also work offline and on first delivery.
final class NotificationService: UNNotificationServiceExtension {
    private let completionLock = NSLock()
    private var handler: ((UNNotificationContent) -> Void)?
    private var fallback: UNNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        fallback = request.content
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
              let conversationID = content.userInfo["conversationId"] as? String,
              let index = content.userInfo["avatarIndex"] as? Int, (0..<6).contains(index),
              let url = Bundle.main.url(forResource: "agent-\(index)", withExtension: "png", subdirectory: "Avatars"),
              let data = try? Data(contentsOf: url) else { finish(request.content); return }
        content.subtitle = ""
        content.threadIdentifier = conversationID
        let sender = INPerson(personHandle: INPersonHandle(value: conversationID, type: .unknown),
                              nameComponents: nil, displayName: content.title,
                              image: INImage(imageData: data), contactIdentifier: nil,
                              customIdentifier: conversationID, isMe: false, suggestionType: .none)
        let intent = INSendMessageIntent(recipients: nil, outgoingMessageType: .outgoingMessageText,
                                        content: content.body, speakableGroupName: nil,
                                        conversationIdentifier: conversationID, serviceName: nil,
                                        sender: sender, attachments: nil)
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { [weak self] _ in
            do { self?.finish(try content.updating(from: intent)) }
            catch { self?.finish(content) }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let fallback { finish(fallback) }
    }

    private func finish(_ content: UNNotificationContent) {
        completionLock.lock()
        let completion = handler
        handler = nil
        completionLock.unlock()
        completion?(content)
    }
}
