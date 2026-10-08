import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories(NotificationReplyActions.categories())
        application.registerForRemoteNotifications()
        // Location relaunches and Health background delivery both land here; signals re-arm each launch.
        Task { @MainActor in
            ProactiveSignals.shared.start()
            NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
                Task { @MainActor in ProactiveSignals.shared.start() }
            }
        }
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-NotificationReplyPreview") {
            Task { @MainActor in _ = await NativeExperienceManager.shared.requestNotificationAuthorization() }
        }
#endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in
            NativeExperienceManager.shared.receiveRemoteNotificationDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task { @MainActor in
            let handled = await BackgroundAppleActions.handle(userInfo)
            let eta = handled ? false : await ProactiveSignals.shared.handleRemote(userInfo)
            completionHandler(handled || eta ? .newData : .noData)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // The simulator and devices without an APNs entitlement can land here.
        // Registration is retried by iOS on a future launch once configuration is valid.
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in
            let info = notification.request.content.userInfo
            let kind = info["notificationKind"] as? String
            let runID = info["runId"] as? String
            if info["replyFailed"] as? Bool == true {
                completionHandler([.banner, .sound])
            } else if let runID, runID == NativeExperienceManager.shared.visibleConversationID {
                // The open conversation supplies its own arrival feedback.
                completionHandler([])
            } else if kind == "run_attention" || kind == "run_completion" || kind == "google_reconnect" {
                completionHandler([.banner, .sound])
            } else {
                completionHandler([])
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            defer { completionHandler() }
            if await NotificationReplyService.handle(response) { return }
            NativeExperienceManager.shared.receiveNotificationResponse(response)
        }
    }
}
