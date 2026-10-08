import ActivityKit
import Foundation
import UIKit
import UserNotifications

struct NativeDecisionChoice: Equatable {
    let decisionID: String
    let optionID: String
}

struct NativePushDeviceToken: Equatable {
    let value: String
    let environment: String
}

struct NativeWorkspaceSnapshot: Decodable {
    struct Decision: Decodable {
        struct Option: Decodable {
            let id: String
            let label: String
        }

        let id: String
        let title: String
        let subtitle: String
        let urgency: String
        let options: [Option]
    }

    struct RunningTask: Decodable {
        struct Step: Decodable {
            let label: String
            let detail: String
            let status: String
        }

        let id: String
        let decisionId: String
        let runId: String?
        let title: String
        let subtitle: String
        let estimate: String?
        let status: String
        let approvalKind: String?
        let question: String?
        let steps: [Step]
    }

    let needsUserAttention: Bool?
    let decisions: [Decision]
    let tasks: [RunningTask]
}

@MainActor
final class NativeExperienceManager {
    static let shared = NativeExperienceManager()
    var visibleConversationID: String?

    static let firstChoiceAction = "decision.option.first"
    static let secondChoiceAction = "decision.option.second"

    private let center = UNUserNotificationCenter.current()
    private var choiceHandler: ((NativeDecisionChoice) -> Void)?
    private var decisionFocusHandler: ((String) -> Void)?
    private var runAttentionHandler: ((String) -> Void)?
    private var runCompletionHandler: ((String) -> Void)?
    private var googleReconnectHandler: (() -> Void)?
    private var pendingGoogleReconnect = false
    private var pushTokenHandler: ((NativePushDeviceToken) -> Void)?
    private var pendingChoice: NativeDecisionChoice?
    private var pendingDecisionID: String?
    private var pendingAttentionRunID: String?
    private var pendingCompletionRunID: String?
    private var latestPushToken: NativePushDeviceToken?

    private init() {
        Task { await endExistingLiveActivities() }
    }

    func setChoiceHandler(_ handler: @escaping (NativeDecisionChoice) -> Void) {
        choiceHandler = handler
        flushPendingChoice()
    }

    func setPushTokenHandler(_ handler: @escaping (NativePushDeviceToken) -> Void) {
        pushTokenHandler = handler
        if let latestPushToken { handler(latestPushToken) }
    }

    func setDecisionFocusHandler(_ handler: @escaping (String) -> Void) {
        decisionFocusHandler = handler
        flushPendingDecisionFocus()
    }

    func setRunAttentionHandler(_ handler: @escaping (String) -> Void) {
        runAttentionHandler = handler
        flushPendingRunAttention()
    }

    func setRunCompletionHandler(_ handler: @escaping (String) -> Void) {
        runCompletionHandler = handler
        flushPendingRunCompletion()
    }

    func setGoogleReconnectHandler(_ handler: @escaping () -> Void) {
        googleReconnectHandler = handler
        if pendingGoogleReconnect { pendingGoogleReconnect = false; handler() }
    }

    func receiveRemoteNotificationDeviceToken(_ data: Data) {
        let value = data.map { String(format: "%02x", $0) }.joined()
#if DEBUG
        let environment = "sandbox"
#else
        let environment = "production"
#endif
        let token = NativePushDeviceToken(value: value, environment: environment)
        latestPushToken = token
        pushTokenHandler?(token)
    }

    func synchronize(_ snapshot: NativeWorkspaceSnapshot) {
        Task {
            await endExistingLiveActivities()
        }
    }

    func receiveNotificationResponse(_ response: UNNotificationResponse) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           response.notification.request.content.userInfo["notificationKind"] as? String == "google_reconnect" {
            if let googleReconnectHandler { googleReconnectHandler() }
            else { pendingGoogleReconnect = true }
            return
        }
        if [UNNotificationDefaultActionIdentifier, NotificationReplyActions.open].contains(response.actionIdentifier),
           response.notification.request.content.userInfo["notificationKind"] as? String == "decision",
           let decisionID = response.notification.request.content.userInfo["decisionId"] as? String,
           !decisionID.isEmpty {
            pendingDecisionID = decisionID
            flushPendingDecisionFocus()
            return
        }
        if [UNNotificationDefaultActionIdentifier, NotificationReplyActions.open].contains(response.actionIdentifier),
           response.notification.request.content.userInfo["notificationKind"] as? String == "run_attention",
           let runID = response.notification.request.content.userInfo["runId"] as? String,
           !runID.isEmpty {
            pendingAttentionRunID = runID
            flushPendingRunAttention()
            return
        }
        if [UNNotificationDefaultActionIdentifier, NotificationReplyActions.open].contains(response.actionIdentifier),
           response.notification.request.content.userInfo["notificationKind"] as? String == "run_completion",
           let runID = response.notification.request.content.userInfo["runId"] as? String,
           !runID.isEmpty {
            pendingCompletionRunID = runID
            flushPendingRunCompletion()
            return
        }
        let index: Int?
        switch response.actionIdentifier {
        case Self.firstChoiceAction: index = 0
        case Self.secondChoiceAction: index = 1
        default: index = nil
        }
        guard
            let index,
            let decisionID = response.notification.request.content.userInfo["decisionId"] as? String,
            let optionID = response.notification.request.content.userInfo["option\(index)Id"] as? String
        else { return }

        pendingChoice = NativeDecisionChoice(decisionID: decisionID, optionID: optionID)
        flushPendingChoice()
    }

    func nativeChoiceCompleted(decisionID: String, optionID: String, started: Bool) {
        guard pendingChoice == NativeDecisionChoice(decisionID: decisionID, optionID: optionID) else { return }
        if started { pendingChoice = nil }
    }

    private func flushPendingChoice() {
        guard let pendingChoice, let choiceHandler else { return }
        choiceHandler(pendingChoice)
    }

    private func flushPendingDecisionFocus() {
        guard let pendingDecisionID, let decisionFocusHandler else { return }
        self.pendingDecisionID = nil
        decisionFocusHandler(pendingDecisionID)
    }

    private func flushPendingRunAttention() {
        guard let pendingAttentionRunID, let runAttentionHandler else { return }
        self.pendingAttentionRunID = nil
        runAttentionHandler(pendingAttentionRunID)
    }

    private func flushPendingRunCompletion() {
        guard let pendingCompletionRunID, let runCompletionHandler else { return }
        self.pendingCompletionRunID = nil
        runCompletionHandler(pendingCompletionRunID)
    }

    // Live Activities are retired. Clear activities left by earlier builds,
    // including when the app opens before a workspace snapshot is available.
    private func endExistingLiveActivities() async {
        for activity in Activity<TaskActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    func requestNotificationAuthorization() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
            return true
        case .notDetermined:
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true
            if granted { UIApplication.shared.registerForRemoteNotifications() }
            return granted
        case .denied:
            return false
        @unknown default:
            return false
        }
    }

}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
