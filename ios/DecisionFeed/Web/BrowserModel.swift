import AVFoundation
import AudioToolbox
import AuthenticationServices
import Combine
import CoreLocation
import CryptoKit
import Network
import OSLog
import Photos
import SwiftUI
import WebKit
import UserNotifications

@MainActor
final class BrowserModel: NSObject, ObservableObject, UIGestureRecognizerDelegate {
    enum AuthenticationProvider: String { case google, apple }
    enum AuthenticationIntent { case signIn, signUp }
    enum State: Equatable {
        case starting
        case loading
        case signedOut
        case onboarding
        case ready
        case offline
        case failed(String)
        case incompatible
    }

    struct BrowserLink: Identifiable {
        let id = UUID()
        let url: URL
    }

    struct ShareItem: Identifiable {
        let id = UUID()
        let url: URL
    }

    private struct MobileOnboardingState: Decodable {
        let completed: Bool
        let needsProfileSetup: Bool?
    }

    private struct InitialSignupScanResponse: Decodable {
        let requested: Bool
    }

    private struct AuthenticatedSessionIdentity {
        let email: String
        let provider: AuthenticationProvider?
    }

    @Published private(set) var state: State = .starting
    /// A loaded page stays on screen through signal drops; only a small bar shows.
    @Published private(set) var connectionLost = false
    @Published private(set) var onboardingInitialPage = 0
    @Published private(set) var onboardingProfileSetupOnly = false
    @Published private(set) var onboardingGoogleConnected = false
    @Published private(set) var onboardingPreviewTargetPage: Int?
    @Published private(set) var isModalOverlayVisible = false
    @Published private(set) var keepsBackgroundChrome = false
    @Published private(set) var modalPrefersDarkAppearance = false
    @Published private(set) var isBrowserViewerVisible = false
    var hidesBackgroundChrome: Bool { (isBrowserViewerVisible || isModalOverlayVisible) && !keepsBackgroundChrome }
    @Published private(set) var sheetCoverage: SheetCoverage?
    @Published private(set) var authenticatingProvider: AuthenticationProvider?
    @Published private(set) var preferredColorScheme: ColorScheme?
    static let appearancePreferenceKey = "dash.appearancePreference"

    private static func cachedAppearanceScheme() -> ColorScheme? {
        switch UserDefaults.standard.string(forKey: appearancePreferenceKey) {
        case "light": return .light
        case "dark": return .dark
        default: return nil // System follows the device from the first frame.
        }
    }
    @Published var browserLink: BrowserLink?
    @Published var shareItem: ShareItem?
    @Published var documentPreview: ShareItem?
    private var savingPhotos = false

    func savePhotos(_ payload: [String: Any]) {
        guard let requestID = payload["requestId"] as? String else { return }
        func finish(_ ok: Bool, _ error: String? = nil) {
            let result: [String: Any] = ["requestId": requestID, "ok": ok, "error": error ?? ""]
            guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:photosSaved',{detail:\(json)}));")
        }
        guard !savingPhotos else { finish(false, "Photos are already being saved."); return }
        guard let paths = payload["paths"] as? [String], !paths.isEmpty, paths.count <= 10,
              paths.allSatisfy({ path in
                  let parts = path.split(separator: "/")
                  return parts.count == 5 && parts[0] == "api" && parts[1] == "runs" && UUID(uuidString: String(parts[2])) != nil && parts[3] == "artifacts" && UUID(uuidString: String(parts[4])) != nil
              }) else { finish(false, "These photos can’t be saved."); return }
        savingPhotos = true
        Task {
            defer { savingPhotos = false }
            let access = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard access == .authorized || access == .limited else { finish(false, "Allow Dash to add photos in Settings, then try again."); return }
            do {
                var images: [Data] = []
                for path in paths {
                    let data = try await authenticatedData(path: String(path.drop(while: { $0 == "/" })))
                    guard data.count <= 20_000_000, UIImage(data: data) != nil else { finish(false, "A photo couldn’t be loaded or is too large to save."); return }
                    images.append(data)
                }
                let savedImages = images
                try await PHPhotoLibrary.shared().performChanges {
                    for data in savedImages { PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil) }
                }
                finish(true)
            } catch { finish(false, "Couldn’t save the photos. Please try again.") }
        }
    }
    @Published var signInRequest: SignInRequest?

    @Published var isRenamingConversation = false
    @Published var conversationRenameText = ""
    private var conversationRenameKey: String?
    lazy var messageMenus = NativeMessageMenus(webView: webView)
    private var conversationMenuItems: [NativeConversationMenuItem] = []
    private var conversationMenuPreview: UITargetedPreview?
    private var pendingConversationAction: (() -> Void)?

    @Published var homeHeader: NativeHomeHeaderState?
    @Published var departingHomeHeader: NativeHomeHeaderState?
    private var cachedHomeHeader: NativeHomeHeaderState?
    @Published var glassButtons: [String: NativeGlassButtonState] = [:]
    @Published var browserClose: NativeBrowserCloseState?
    @Published var chatHeader: NativeChatHeaderState?
    @Published var departingChatHeader: NativeChatHeaderState?
    @Published var composer: NativeComposerState?
    @Published var navigationPushing = true
    @Published var departingComposer: NativeComposerState?
    @Published private(set) var chromeFrame = NativeChromeFrame()
    var departingComposerOffset: CGFloat {
        get { chromeFrame.departingComposerOffset }
        set { if chromeFrame.departingComposerOffset != newValue { chromeFrame.departingComposerOffset = newValue } }
    }
    @Published var navigationFromLeft = false
    var composerClip: CGFloat {
        get { chromeFrame.composerClip }
        set { if chromeFrame.composerClip != newValue { chromeFrame.composerClip = newValue } }
    }
    var departingComposerClip: CGFloat {
        get { chromeFrame.departingComposerClip }
        set { if chromeFrame.departingComposerClip != newValue { chromeFrame.departingComposerClip = newValue } }
    }
    @Published var departingComposerOnTop = false
    var composerOpacity: Double {
        get { chromeFrame.composerOpacity }
        set { if chromeFrame.composerOpacity != newValue { chromeFrame.composerOpacity = newValue } }
    }
    var departingComposerOpacity: Double {
        get { chromeFrame.departingComposerOpacity }
        set { if chromeFrame.departingComposerOpacity != newValue { chromeFrame.departingComposerOpacity = newValue } }
    }
    private var navigationInFlight = false
    private var homeComposer: NativeComposerState?
    private var sentComposer: (id: String, text: String)?
    var composerOffset: CGFloat {
        get { chromeFrame.composerOffset }
        set { if chromeFrame.composerOffset != newValue { chromeFrame.composerOffset = newValue } }
    }
    @Published var composerDismissal = 0
    @Published var composerFocusRequest = 0
    @Published var focusNextThreadComposer = false
    var preserveSendKeyboard = false
    @Published var composerKeyboardVisible = false

    func updateHomeHeader(_ payload: [String: Any]) {
        if payload["hidden"] as? Bool == true {
            if payload["id"] as? String == homeHeader?.id { homeHeader = nil }
            return
        }
        guard let header = NativeHomeHeaderState(payload: payload) else { return }
        let needsReady = homeHeader?.registrationId != header.registrationId
        if homeHeader != header { homeHeader = header }
        if !header.archived { cachedHomeHeader = header }
        if needsReady { homeHeaderAction(id: header.id, action: "ready") }
    }

    func homeHeaderAction(id: String, action: String) {
        guard homeHeader?.id == id,
              let data = try? JSONSerialization.data(withJSONObject: ["id": id, "action": action, "registrationId": homeHeader?.registrationId ?? ""]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:homeHeaderAction',{detail:\(json)}));")
    }

    func updateGlassButton(_ payload: [String: Any]) {
        guard let id = payload["id"] as? String else { return }
        if payload["hidden"] as? Bool == true { glassButtons.removeValue(forKey: id); return }
        guard let state = NativeGlassButtonState(payload: payload) else { return }
        let needsReady = glassButtons[id] == nil
        if glassButtons[id] != state { glassButtons[id] = state }
        if needsReady { glassButtonAction(id: id, action: "ready") }
    }

    func glassButtonAction(id: String, action: String) {
        guard let state = glassButtons[id], action == "ready" || (!state.disabled && state.control.opacity > 0),
              let data = try? JSONSerialization.data(withJSONObject: ["id": id, "action": action]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:glassButtonAction',{detail:\(json)}));")
    }

    func updateBrowserClose(_ payload: [String: Any]) {
        if payload["hidden"] as? Bool == true {
            if payload["id"] as? String == browserClose?.id { browserClose = nil }
            return
        }
        guard let state = NativeBrowserCloseState(payload: payload) else { return }
        let needsReady = browserClose?.id != state.id
        if browserClose != state { browserClose = state }
        if needsReady { browserCloseAction(id: state.id, action: "ready") }
    }

    func browserCloseAction(id: String, action: String) {
        guard browserClose?.id == id,
              let data = try? JSONSerialization.data(withJSONObject: ["id": id, "action": action]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:browserCloseAction',{detail:\(json)}));")
    }

    private var dismissedChatHeaderIDs: [String] = []

    private func rememberDismissedChatHeader(_ id: String) {
        dismissedChatHeaderIDs.removeAll { $0 == id }
        dismissedChatHeaderIDs.append(id)
        if dismissedChatHeaderIDs.count > 64 { dismissedChatHeaderIDs.removeFirst() }
    }

    func hideChatHeader(id: String) {
        rememberDismissedChatHeader(id)
        if chatHeader?.id == id { chatHeader = nil }
        // Keep the departing copy until the swipe's animation finishes.
    }

    func updateChatHeader(_ payload: [String: Any]) {
        guard let header = NativeChatHeaderState(payload: payload),
              !dismissedChatHeaderIDs.contains(header.id) else { return }
        if navigationInFlight && !navigationPushing && departingChatHeader?.id == header.id {
            departingChatHeader = header
            return
        }
        let needsReady = chatHeader?.registrationId != header.registrationId
        if chatHeader != header { chatHeader = header }
        if needsReady { chatHeaderAction(id: header.id, action: "ready") }
    }

    func chatHeaderAction(id: String, action: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["id": id, "action": action, "registrationId": chatHeader?.registrationId ?? ""]), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:chatHeaderAction',{detail:\(json)}));")
    }

    func updateComposer(_ payload: [String: Any]) {
        guard let id = payload["id"] as? String else { return }
        if payload["variant"] as? String == "home", !(payload["error"] as? String ?? "").isEmpty {
            preserveSendKeyboard = false; focusNextThreadComposer = false
        }
        var incomingText = payload["value"] as? String ?? ""
        if let sent = sentComposer, sent.id == id {
            if !incomingText.isEmpty && incomingText == sent.text && (payload["error"] as? String ?? "").isEmpty {
                // The web composer briefly publishes its outgoing draft during
                // the send animation. Do not cache that draft for a back swipe.
                incomingText = ""
            } else {
                // An empty value confirms the send; an error or a new value is
                // an intentional draft that should be shown again.
                sentComposer = nil
            }
        }
        if composer?.id != id && !navigationInFlight { composerOffset = 0 }
        var next = NativeComposerState(id: id, variant: payload["variant"] as? String ?? "home", text: incomingText, placeholder: payload["placeholder"] as? String ?? "Message Dash…", disabled: payload["disabled"] as? Bool ?? false, sending: payload["sending"] as? Bool ?? false, attachments: payload["attachments"] as? Bool ?? false, fileCount: payload["fileCount"] as? Int ?? 0, error: payload["error"] as? String ?? "", voice: payload["voice"] as? String ?? "idle", location: payload["location"] as? String ?? "", locating: payload["locating"] as? Bool ?? false, voiceLevels: Array((payload["voiceLevels"] as? [Double] ?? []).prefix(40)).map { $0.isFinite ? min(1, max(0, $0)) : 0 }, voiceElapsed: min(300, max(0, payload["voiceElapsed"] as? Int ?? 0)))
        next.replyName = payload["replyName"] as? String ?? ""
        next.replyText = payload["replyText"] as? String ?? ""
        next.stoppable = payload["stoppable"] as? Bool ?? false
        next.sendFlightSupported = payload["sendFlightSupported"] as? Bool ?? false
        if let samples = payload["sendMotionSamples"] as? [[Double]], samples.count >= 2,
           samples.allSatisfy({ $0.count == 3 && $0.allSatisfy(\.isFinite) }) {
            next.sendMotionSamples = samples
        }
        next.draftFiles = Array((payload["draftFiles"] as? [[String: Any]] ?? []).prefix(6)).compactMap(NativeDraftFile.init(payload:))
        if composer != next { composer = next }
        if next.variant == "home" { homeComposer = next }
    }

    private var navigationDragging = false

    func updateNavigationFrame(_ payload: [String: Any]) {
        guard let phase = payload["phase"] as? String else { return }
        // One clock owns the page and both native bars. No second SwiftUI spring.
        var next = chromeFrame
        switch phase {
        case "begin":
            // An interactive pop changes which slot owns Home and Chat. Preserve
            // both surfaces and their geometry now: React's replacement state and
            // the next web animation frame can arrive in later bridge messages.
            let returningFromDrag = navigationDragging && !navigationPushing
            let revealedHomeHeader = returningFromDrag ? departingHomeHeader : nil
            let revealedComposer = returningFromDrag ? departingComposer : nil
            let revealedOffset = next.departingComposerOffset
            let revealedClip = next.departingComposerClip
            let outgoingClip = next.composerClip
            departingHomeHeader = homeHeader
            homeHeader = revealedHomeHeader
            departingChatHeader = chatHeader
            chatHeader = nil
            if preserveSendKeyboard && navigationPushing {
                // Keep the same native editor mounted as Home becomes a chat.
                departingComposer = nil
            } else {
                departingComposer = composer
                departingComposerOnTop = !navigationPushing
                next.departingComposerOffset = next.composerOffset
                composer = revealedComposer
            }
            if returningFromDrag {
                next.composerOffset = revealedOffset
                next.composerClip = revealedClip
                next.departingComposerClip = outgoingClip
            }
            navigationDragging = false
            next.composerOpacity = 1
            next.departingComposerOpacity = 1
            navigationInFlight = true
            if !preserveSendKeyboard { composerDismissal += 1 }
        case "frame", "drag":
            if phase == "drag" {
                navigationDragging = true
                departingHomeHeader = cachedHomeHeader
                departingComposerOnTop = false
                if composer?.variant == "thread" || (navigationFromLeft && composer == nil) { departingComposer = homeComposer }
                else { departingComposer = nil }
            }
            next.composerOffset = preserveSendKeyboard ? 0 : payload["incoming"] as? Double ?? 0
            next.departingComposerOffset = payload["outgoing"] as? Double ?? 0
            next.composerClip = preserveSendKeyboard || phase == "drag" || navigationPushing ? 10000 : abs(next.departingComposerOffset)
            next.departingComposerClip = phase == "drag" || navigationPushing ? abs(next.composerOffset) : 10000
            if payload["opacity"] != nil { next.composerClip = 10000; next.departingComposerClip = 10000 }
            next.composerOpacity = payload["opacity"] as? Double ?? 1
            next.departingComposerOpacity = payload["opacity"] == nil ? 1 : 1 - next.composerOpacity
        case "end":
            if !navigationPushing, let header = departingChatHeader { rememberDismissedChatHeader(header.id) }
            navigationDragging = false
            navigationInFlight = false
            next.composerClip = 10000
            next.departingComposerClip = 10000
            departingComposer = nil
            departingChatHeader = nil
            departingHomeHeader = nil
            next.composerOffset = 0
            next.composerOpacity = 1
            preserveSendKeyboard = false
        default: break
        }
        if chromeFrame != next { chromeFrame = next }
    }

    func requestSharedLocation(requestID: String) {
        sharedLocationProvider.request(id: requestID) { [weak self] result in
            guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
            self?.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:locationResult',{detail:\(json)}));")
        }
    }

    func updateComposerKeyboard(_ notification: Notification) {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let window = webView.window else { return }
        let localFrame = webView.convert(window.convert(frame, from: nil), from: window)
        let overlap = webView.bounds.intersection(localFrame).height
        let height = overlap > 80 ? overlap : 0
        composerKeyboardVisible = height > 0
        if height > 0 { Self.configureKeyboardDismissal(in: webView) }
        let reportedDuration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        // Some dismissal paths report zero; don't snap the message viewport closed.
        // Keep zero-duration intermediate frames responsive during interactive dragging.
        let duration = height == 0 && reportedDuration <= 0 ? 0.25 : reportedDuration
        let script = "{const root=document.querySelector('.wd');root?.style.setProperty('--native-keyboard-duration','\(duration)s');root?.style.setProperty('--native-keyboard-height','\(height)px');}"
        webView.evaluateJavaScript(script)
    }

    // CSS overflow creates nested WebKit scroll views. Each scrolling surface
    // needs the system dismissal mode, not only the outer WKWebView scroll view.
    static func configureKeyboardDismissal(in view: UIView) {
        if let scroll = view as? UIScrollView { scroll.keyboardDismissMode = .interactive }
        for child in view.subviews { configureKeyboardDismissal(in: child) }
    }

    func composerAction(_ action: String, value: String? = nil, expectedID: String? = nil) {
        guard expectedID == nil || expectedID == composer?.id else { return }
        if action == "change", let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            prepareSendFeedback()
        }
        dispatchComposerAction(action, value: value)
    }

    func sendComposer(_ text: String, origin: CGRect) {
        guard composer?.disabled != true, composer?.sending != true else { return }
        if composer?.variant == "home" { focusNextThreadComposer = true; preserveSendKeyboard = true }
        sendFlight?.removeFromSuperview(); sendFlight = nil
        if composer?.sendFlightSupported == true, composer?.fileCount == 0, composer?.location.isEmpty != false, !UIAccessibility.isReduceMotionEnabled, let host = sendFlightHost {
            let flight = MessageSendFlightView(frame: host.bounds, text: text.trimmingCharacters(in: .whitespacesAndNewlines), source: host.convert(origin, from: webView.window), samples: composer?.sendMotionSamples ?? [])
            host.addSubview(flight)
            if let textHost = sendFlightTextHost { flight.presentText(in: textHost) }
            sendFlight = flight
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self, weak flight] in
                guard let flight, self?.sendFlight === flight else { return }
                flight.removeFromSuperview(); self?.sendFlight = nil
            }
        }
        playMessageFeedback(kind: "send", fromNativeTap: true)
        if let id = composer?.id {
            sentComposer = (id, text)
            composer?.text = ""
            if homeComposer?.id == id { homeComposer?.text = "" }
        }
        let frame = webView.convert(origin, from: nil)
        dispatchComposerAction("send", value: text, origin: ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height, "nativeFlight": sendFlight != nil, "nativeFlightId": sendFlight?.token ?? "", "feedbackPlayed": true])
    }

    func completeComposerFocusHandoff() { focusNextThreadComposer = false }

    private var sendFlight: MessageSendFlightView?
    weak var sendFlightHost: UIView?
    weak var sendFlightTextHost: UIView?

    func updateSendFlight(_ payload: [String: Any]) {
        guard let flight = sendFlight, payload["token"] as? String == flight.token else { return }
        if payload["cancel"] as? Bool == true { flight.removeFromSuperview(); sendFlight = nil; return }
        guard let id = payload["id"] as? String,
              let x = payload["x"] as? Double, let y = payload["y"] as? Double,
              let width = payload["width"] as? Double, let height = payload["height"] as? Double,
              [x,y,width,height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return }
        let target = webView.convert(CGRect(x: x, y: y, width: width, height: height), to: sendFlightHost)
        if payload["retarget"] as? Bool == true { flight.retarget(to: target); return }
        guard let samples = payload["samples"] as? [[Double]], samples.count >= 2,
              samples.allSatisfy({ $0.count == 3 && $0.allSatisfy(\.isFinite) }) else { return }
        flight.fly(to: target, padding: payload["padding"] as? Double ?? 14, fontSize: payload["fontSize"] as? Double ?? 17, lineHeight: payload["lineHeight"] as? Double ?? 22, samples: samples, colors: payload["colors"] as? [[Double]] ?? [], duration: 0.55) { [weak self, weak flight] in
            guard let self, let flight, self.sendFlight === flight,
                  let data = try? JSONSerialization.data(withJSONObject: ["id": id]),
                  let json = String(data: data, encoding: .utf8) else { return }
            self.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:sendFlightFinished',{detail:\(json)}));") { [weak self, weak flight] _, error in
                // WebKit acknowledges after presenting the DOM bubble. Removing
                // this overlay on JS evaluation alone can expose one blank frame.
                guard error != nil else { return }
                flight?.removeFromSuperview()
                if self?.sendFlight === flight { self?.sendFlight = nil }
            }
        }
    }

    private func dispatchComposerAction(_ action: String, value: String?, origin: [String: Any]? = nil) {
        guard let composer else { return }
        var detail: [String: Any] = ["id": composer.id, "action": action]
        if let value { detail["value"] = value }
        if let origin { detail["origin"] = origin }
        guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:composerAction',{detail:\(json)}));")
    }

    let configuration: AppConfiguration
    let webView: WKWebView
    let sharedLocationProvider = SharedLocationProvider()
    let appleConnections = AppleConnections()
    private var appleActionsInFlight = Set<String>()
    private let coordinator: WebCoordinator
    private let pathMonitor = NWPathMonitor()
    private var authenticationSession: ASWebAuthenticationSession?
    private var hasLoadedWorkspace = false
    private var authenticatedEmail: String?
    private var authenticatedProvider: AuthenticationProvider?
    private var shouldResolveOnboardingAfterAuthentication = false
    private var isResolvingAuthenticatedDestination = false
    private var pendingAuthenticationIntent: AuthenticationIntent?
    private var isOnboardingPreview = false
    private var pendingNativeChoice: NativeDecisionChoice?
    private var dispatchedNativeChoice: NativeDecisionChoice?
    private var latestPushToken: NativePushDeviceToken?
    private var registeredPushToken: NativePushDeviceToken?
    private var isRegisteringPushToken = false
    private var pendingRunningRunID: String?
    private var pendingFeedDecisionID: String?
    private var pendingGoogleReconnect = false
    private var isWorkspacePreview = false
#if DEBUG
    var isDesignPreview: Bool { ProcessInfo.processInfo.arguments.contains("-DesignPreview") || ProcessInfo.processInfo.arguments.contains("-OnboardingPreview") }
    private var designPreviewScan = "first"
    private var previewConnections: [String: String] = [:]

    func showDesignPreview(_ destination: String) {
        guard isDesignPreview else { return }
        onboardingPreviewTargetPage = nil
        onboardingInitialPage = 0
        isOnboardingPreview = true
        browserLink = nil
        switch destination {
        case "signin": state = .signedOut
        case "onboarding": state = .onboarding
        default:
            designPreviewScan = ["empty", "arriving"].contains(destination) ? destination : "first"
            isWorkspacePreview = true
            state = .loading
            start()
        }
    }
#endif
    private let deviceCalendar = DeviceCalendarManager()
    private let deviceVault = DeviceVault()
    private let appGroup = "group.com.example.dash"
    private let pendingSharedIntakeKey = "wdyt.pendingSharedIntake"
    private var pendingSharedIntake: Data?
    private var sharedIntakeDispatchInFlight = false
    private let workspaceLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "DecisionFeed", category: "WorkspaceLoad")
    private var workspaceLoadWatchdog: Task<Void, Never>?
    private var workspaceLoadAttempt = 0
    private var workspaceReadyReceived = false
    /// The current page can switch conversations without a reload. Reset on every navigation.
    var pageOpensConversationsInPlace = false
    private var workspaceBackSwipeRecognizer: UIPanGestureRecognizer?
    private var workspaceBackFromRight = false
    private var workspaceBackEnabled = false
    private var workspaceSwipeDirection: CGFloat = 1
    private var conversationSwipeActive = false

    override init() {
        configuration = AppConfiguration.load()
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .default()
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.applicationNameForUserAgent = "DecisionFeed-iOS/1"

        let bridgeCoordinator = WebCoordinator()
        let userContentController = WKUserContentController()
        userContentController.addUserScript(WKUserScript(
            source: BrowserTakeoverTouch.script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        userContentController.add(bridgeCoordinator, name: WebCoordinator.bridgeName)
        userContentController.addUserScript(WKUserScript(
            source: WebCoordinator.nativeShellScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        userContentController.addUserScript(WKUserScript(
            source: NativeActivitySymbols.webScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        userContentController.addUserScript(WKUserScript(
            source: WebCoordinator.diagnosticsBridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        webConfiguration.userContentController = userContentController

        coordinator = bridgeCoordinator
        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        // The hosted page applies safe-area insets; UIKit must not shrink it again.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        super.init()
        preferredColorScheme = Self.cachedAppearanceScheme()

#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-DesignPreview") {
            isWorkspacePreview = true
            isOnboardingPreview = true
            state = .loading
        } else if arguments.contains("-InAppBrowserPreview") {
            state = .ready
            browserLink = BrowserLink(url: URL(string: "https://www.lartusi.com/")!)
        } else if arguments.contains("-ShareSheetPreview") {
            state = .ready
            shareItem = ShareItem(url: URL(string: "https://example.com/family-waiver")!)
        } else if arguments.contains("-LaunchPreview") {
            isWorkspacePreview = true
            state = .loading
        } else if let previewIndex = arguments.firstIndex(of: "-OnboardingPreview"),
           arguments.indices.contains(previewIndex + 1),
           let page = Int(arguments[previewIndex + 1]) {
            let previewPage = min(max(page, 0), 2)
            onboardingInitialPage = previewPage
            onboardingPreviewTargetPage = arguments.contains("-OnboardingInteractive") ? nil : previewPage
            isOnboardingPreview = true
            state = .onboarding
        } else if arguments.contains("-AuthenticationPreview") {
            state = .signedOut
        }
#endif

        coordinator.model = self
        NativeExperienceManager.shared.setChoiceHandler { [weak self] choice in
            self?.enqueueNativeChoice(choice)
        }
        NativeExperienceManager.shared.setPushTokenHandler { [weak self] token in
            self?.receivePushToken(token)
        }
        NativeExperienceManager.shared.setDecisionFocusHandler { [weak self] decisionID in
            self?.enqueueFeedDecision(decisionID: decisionID)
        }
        NativeExperienceManager.shared.setRunAttentionHandler { [weak self] runID in
            self?.enqueueRunningTask(runID: runID)
        }
        NativeExperienceManager.shared.setRunCompletionHandler { [weak self] runID in
            self?.enqueueRunningTask(runID: runID)
        }
        NativeExperienceManager.shared.setGoogleReconnectHandler { [weak self] in
            self?.pendingGoogleReconnect = true
            self?.dispatchGoogleReconnectIfPossible()
        }
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.decelerationRate = .normal
        webView.allowsBackForwardNavigationGestures = false
        webView.addInteraction(UIContextMenuInteraction(delegate: self))
        let backSwipeRecognizer = UIPanGestureRecognizer(
            target: self,
            action: #selector(handleWorkspaceBackSwipe(_:))
        )
        backSwipeRecognizer.maximumNumberOfTouches = 1
        backSwipeRecognizer.cancelsTouchesInView = true
        backSwipeRecognizer.delegate = self
        webView.addGestureRecognizer(backSwipeRecognizer)
        webView.scrollView.panGestureRecognizer.require(toFail: backSwipeRecognizer)
        workspaceBackSwipeRecognizer = backSwipeRecognizer
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.networkChanged(isOnline: path.status == .satisfied) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "DecisionFeed.NetworkMonitor"))
    }

    deinit {
        workspaceLoadWatchdog?.cancel()
        pathMonitor.cancel()
    }

    func start() {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-LoadingScreenPreview") { return }
        if isWorkspacePreview {
            var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false)
            components?.queryItems = [
                URLQueryItem(name: "uiPreview", value: "1"),
                URLQueryItem(name: "scanPreview", value: isDesignPreview ? designPreviewScan : ProcessInfo.processInfo.arguments.contains("-FirstUsePreview") ? "empty" : ProcessInfo.processInfo.arguments.contains("-ScanStopPreview") ? "confirm" : "idle"),
                ProcessInfo.processInfo.arguments.contains("-SendMotionPreview") ? URLQueryItem(name: "sendMotionPreview", value: ProcessInfo.processInfo.arguments.contains("-ReplyMotionPreview") ? "reply" : "1") : nil,
                ProcessInfo.processInfo.arguments.contains("-SendReferencePreview") ? URLQueryItem(name: "task", value: "preview-send-reference") : nil,
                ProcessInfo.processInfo.arguments.contains("-SettingsPreview") ? URLQueryItem(name: "view", value: "settings") : nil,
            ].compactMap { $0 }
            if let url = components?.url {
                // Preview replays must fetch edited scripts and styles too.
                webView.configuration.websiteDataStore.removeData(
                    ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache],
                    modifiedSince: .distantPast
                ) { [weak self] in
                    self?.webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
                }
            }
            return
        }
#endif
        guard state == .starting else { return }
        Task { await bootstrap() }
    }

    func retry() {
        workspaceLoadWatchdog?.cancel()
        if hasLoadedWorkspace {
            hasLoadedWorkspace = false
            loadWorkspace(reason: "manual_retry", resetAttempts: true)
        } else {
            state = .starting
            Task { await bootstrap() }
        }
    }

    func navigationStarted(url: URL?) {
        dismissedChatHeaderIDs.removeAll()
        sharedLocationProvider.cancelPending()
        conversationMenuItems = []
        messageMenus.reset()
        chatHeader = nil
        browserClose = nil
        glassButtons = [:]
        homeHeader = nil
        departingHomeHeader = nil
        cachedHomeHeader = nil
        departingChatHeader = nil
        isRenamingConversation = false
        composer = nil
        homeComposer = nil
        sentComposer = nil
        updateNavigationFrame(["phase": "end"])
        if !hasLoadedWorkspace && state != .onboarding { state = .loading }
        recordClientEvent("navigation_started", details: ["url": diagnosticURL(url)])
    }

    func navigationCommitted(url: URL?) {
        pageOpensConversationsInPlace = false
        recordClientEvent("navigation_committed", details: ["url": diagnosticURL(url)])
    }

    func navigationFinished(url: URL?) {
        recordClientEvent("navigation_finished", details: ["url": diagnosticURL(url)])
        if shouldResolveOnboardingAfterAuthentication && !isResolvingAuthenticatedDestination {
            isResolvingAuthenticatedDestination = true
            Task {
                await resolveAuthenticatedDestination()
                shouldResolveOnboardingAfterAuthentication = false
                isResolvingAuthenticatedDestination = false
            }
        }
    }

    func workspaceDidBecomeReady(payload: [String: Any]) {
        workspaceReadyReceived = true
        workspaceLoadWatchdog?.cancel()
        recordClientEvent("workspace_ready", details: diagnosticDetails(payload))
        guard !shouldResolveOnboardingAfterAuthentication,
              !isResolvingAuthenticatedDestination else { return }
        finishWorkspaceLoad()
    }

    private func finishWorkspaceLoad() {
        hasLoadedWorkspace = true
        workspaceLoadAttempt = 0
        workspaceLoadWatchdog?.cancel()
        registerPushTokenIfPossible()
        if state != .onboarding && state != .signedOut {
            state = .ready
        }
        if pendingGoogleReconnect { dispatchGoogleReconnectIfPossible(); return }
        if pendingRunningRunID != nil {
            dispatchPendingRunningTaskIfPossible()
            return
        }
        if pendingFeedDecisionID != nil {
            dispatchPendingFeedDecisionIfPossible()
            return
        }
        receivePendingSharedIntake()
        dispatchPendingSharedIntakeIfPossible()
    }

    func completeOnboarding(profile: OnboardingProfileDraft) async throws {
        guard state == .onboarding else { return }
        if isOnboardingPreview {
#if DEBUG
            if isDesignPreview { showDesignPreview("home"); return }
#endif
            state = .ready
            return
        }

        guard let authenticatedEmail else { throw URLError(.userAuthenticationRequired) }
        try await persistLifeProfile(profile)
        try await persistOnboardingCompletion(true, for: authenticatedEmail)

        state = hasLoadedWorkspace ? .ready : .loading
        if !hasLoadedWorkspace {
            loadWorkspace(reason: "onboarding_completed", resetAttempts: true)
        }
    }

    func onboardingConnectionStatuses() async -> [String: String] {
#if DEBUG
        if isOnboardingPreview { return previewConnections }
#endif
        guard let email = authenticatedEmail else { return [:] }
        var result = Dictionary(uniqueKeysWithValues: appleConnections.snapshot(email).compactMap { item -> (String, String)? in
            guard let id = item["id"] as? String, let status = item["status"] as? String else { return nil }
            return (id, status)
        })
        let calendar = await deviceCalendar.snapshot(requestAccess: false)
        result["calendar"] = calendar["status"] as? String == "authorized" ? "connected" : calendar["status"] as? String == "denied" ? "denied" : "disconnected"
        if let data = try? await authenticatedData(path: "api/connections"),
           let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let accounts = payload["accounts"] as? [[String: Any]] {
            onboardingGoogleConnected = authenticatedProvider == .google || accounts.contains { $0["enabled"] as? Bool == true }
        }
        if let data = try? await authenticatedData(path: "api/connections/icloud"),
           let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let accounts = payload["accounts"] as? [[String: Any]] {
            result["icloud"] = accounts.contains { $0["needsReconnect"] as? Bool == true } ? "reconnect_required" : accounts.isEmpty ? "disconnected" : "connected"
        }
        result["google"] = onboardingGoogleConnected ? "connected" : "disconnected"
        return authenticatedEmail == email ? result : [:]
    }

    func connectOnboardingICloud(email: String, password: String) async throws {
#if DEBUG
        if isOnboardingPreview { previewConnections["icloud"] = "connected"; return }
#endif
        guard let owner = authenticatedEmail else { throw AppleConnectionFailure("Sign in to Dash first.") }
        let body = try JSONSerialization.data(withJSONObject: ["ownerEmail": owner, "email": email, "password": password])
        _ = try await authenticatedData(path: "api/connections/icloud", method: "POST", body: body)
        guard authenticatedEmail == owner else { throw AppleConnectionFailure("Your account changed. Open setup again.") }
        _ = try? await webView.evaluateJavaScript("window.decisionFeedInitialSignupScanRequested=true;window.dispatchEvent(new CustomEvent('decisionFeed:initialSignupScan'));")
    }

    func connectOnboardingSource(_ service: String) async throws {
#if DEBUG
        if isOnboardingPreview { previewConnections[service] = "connected"; return }
#endif
        guard let email = authenticatedEmail else { throw AppleConnectionFailure("Sign in to Dash first.") }
        if service == "google" {
            try await connectOnboardingGoogle()
            guard authenticatedEmail == email else { throw AppleConnectionFailure("Your account changed. Open setup again.") }
            onboardingGoogleConnected = true
            await beginInitialSignupScan()
        } else if service == "calendar" {
            let snapshot = await deviceCalendar.snapshot(requestAccess: true)
            guard snapshot["status"] as? String == "authorized" else {
                throw AppleConnectionFailure("Calendar access was not allowed. You can change it in iPhone Settings.")
            }
            await publishDeviceCalendarSnapshot(snapshot)
        } else {
            try await appleConnections.connect(email, service)
        }
        guard authenticatedEmail == email else { throw AppleConnectionFailure("Your account changed. Open setup again.") }
    }

    private func connectOnboardingGoogle() async throws {
        guard authenticationSession == nil else { throw AppleConnectionFailure("Finish the current sign-in first.") }
        let data = try await authenticatedData(path: "api/mobile/onboarding/google")
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let authorization = payload["authorizationUrl"] as? String, let url = URL(string: authorization),
              url.scheme == "https", url.host == "accounts.google.com",
              let connectionID = payload["connectionId"] as? String
        else { throw AppleConnectionFailure("Google connection could not be started.") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: configuration.callbackScheme) { [weak self] callbackURL, error in
                Task { @MainActor in
                    guard let self else { continuation.resume(throwing: CancellationError()); return }
                    self.authenticationSession = nil
                    if let error { continuation.resume(throwing: error); return }
                    guard let callbackURL, callbackURL.scheme == self.configuration.callbackScheme,
                          callbackURL.host == "auth",
                          let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                          components.queryItems?.first(where: { $0.name == "googleReconnectRun" })?.value == connectionID,
                          components.queryItems?.contains(where: { $0.name == "error" }) != true
                    else { continuation.resume(throwing: AppleConnectionFailure("Google wasn’t connected. Try again.")); return }
                    do {
                        try await self.completeGoogleConnection(components, runID: connectionID)
                        continuation.resume()
                    } catch { continuation.resume(throwing: error) }
                }
            }
            session.presentationContextProvider = coordinator
            session.prefersEphemeralWebBrowserSession = false
            authenticationSession = session
            if !session.start() {
                authenticationSession = nil
                continuation.resume(throwing: AppleConnectionFailure("Google connection could not be started."))
            }
        }
    }

    func prepareOnboardingSources(requestAppleCalendar: Bool, enableNotifications: Bool) async {
#if DEBUG
        if isOnboardingPreview { return }
#endif
        if requestAppleCalendar {
            let snapshot = await deviceCalendar.snapshot(requestAccess: true)
            await publishDeviceCalendarSnapshot(snapshot)
        }
        if enableNotifications {
            _ = await NativeExperienceManager.shared.requestNotificationAuthorization()
        }
    }

    func requestOnboardingNotifications() async -> Bool {
#if DEBUG
        if isOnboardingPreview { return true }
#endif
        return await NativeExperienceManager.shared.requestNotificationAuthorization()
    }

    func navigationFailed(_ error: Error, stage: String = "request") {
        let nsError = error as NSError
        recordClientEvent("navigation_failed", details: [
            "stage": stage,
            "domain": nsError.domain,
            "code": nsError.code,
            "message": nsError.localizedDescription,
            "url": diagnosticURL(webView.url),
        ])
        if nsError.domain == NSURLErrorDomain && [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost].contains(nsError.code) {
            if keepsPageWhileOffline { connectionLost = true } else { state = .offline }
        } else if !hasLoadedWorkspace {
            state = .failed(error.localizedDescription)
        }
    }

    func webContentProcessTerminated(url: URL?) {
        recordClientEvent("web_content_process_terminated", details: ["url": diagnosticURL(url)])
        guard authenticatedEmail != nil, state != .signedOut, state != .onboarding else {
            state = .failed("The secure web view stopped unexpectedly. Try again.")
            return
        }
        hasLoadedWorkspace = false
        workspaceReadyReceived = false
        loadWorkspace(reason: "web_content_process_terminated", resetAttempts: true)
    }

    func handleClientDiagnostic(_ payload: [String: Any]) {
        recordClientEvent("javascript", details: diagnosticDetails(payload))
    }

    func presentDownload(at url: URL) {
        documentPreview = ShareItem(url: url)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    func startAuthentication(provider: AuthenticationProvider = .google, intent: AuthenticationIntent = .signIn) {
#if DEBUG
        if isDesignPreview { showDesignPreview("onboarding"); return }
#endif
        guard authenticationSession == nil else { return }
        var url = configuration.baseURL.appending(path: "api/mobile/auth/start")
        url.append(queryItems: [URLQueryItem(name: "provider", value: provider.rawValue)])
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: configuration.callbackScheme) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.authenticationSession = nil
                self.authenticatingProvider = nil
                if let error {
                    self.pendingAuthenticationIntent = nil
                    let authError = error as? ASWebAuthenticationSessionError
                    if authError?.code != .canceledLogin { self.state = .failed(error.localizedDescription) }
                    return
                }
                guard
                    let callbackURL,
                    callbackURL.scheme == self.configuration.callbackScheme,
                    callbackURL.host == "auth",
                    let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                    let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
                    code.range(of: "^[A-Za-z0-9_-]{40,64}$", options: .regularExpression) != nil
                else {
                    self.state = .failed("The sign-in response was invalid.")
                    return
                }
                var consume = self.configuration.baseURL.appending(path: "api/mobile/auth/consume")
                consume.append(queryItems: [URLQueryItem(name: "code", value: code)])
                self.shouldResolveOnboardingAfterAuthentication = true
                self.state = .loading
                self.webView.load(URLRequest(url: consume, cachePolicy: .reloadIgnoringLocalCacheData))
            }
        }
        session.presentationContextProvider = coordinator
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        authenticatingProvider = provider
        pendingAuthenticationIntent = intent
        if !session.start() {
            authenticationSession = nil
            authenticatingProvider = nil
            pendingAuthenticationIntent = nil
            state = .failed("Sign-in could not be started.")
        }
    }

    func startGoogleReconnect(requestID: String, runID: String, authorizationURL: String) {
        guard authenticationSession == nil,
              !requestID.isEmpty,
              !runID.isEmpty,
              let url = URL(string: authorizationURL),
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "accounts.google.com"
        else {
            dispatchGoogleReconnectResult(requestID: requestID, runID: runID, error: "Google reconnect could not be started.")
            return
        }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: configuration.callbackScheme) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.authenticationSession = nil
                self.authenticatingProvider = nil
                if let error {
                    let authError = error as? ASWebAuthenticationSessionError
                    self.dispatchGoogleReconnectResult(
                        requestID: requestID,
                        runID: runID,
                        error: authError?.code == .canceledLogin ? "Google reconnect was cancelled." : error.localizedDescription
                    )
                    return
                }
                guard let callbackURL,
                      callbackURL.scheme == self.configuration.callbackScheme,
                      callbackURL.host == "auth",
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                      components.queryItems?.first(where: { $0.name == "googleReconnectRun" })?.value == runID
                else {
                    self.dispatchGoogleReconnectResult(requestID: requestID, runID: runID, error: "The Google reconnect response was invalid.")
                    return
                }
                if let reconnectError = components.queryItems?.first(where: { $0.name == "error" })?.value {
                    self.dispatchGoogleReconnectResult(requestID: requestID, runID: runID, error: reconnectError == "cancelled" ? "Google reconnect was cancelled." : "Google reconnect failed.")
                    return
                }
                do {
                    try await self.completeGoogleConnection(components, runID: runID)
                    self.dispatchGoogleReconnectResult(requestID: requestID, runID: runID)
                } catch {
                    self.dispatchGoogleReconnectResult(requestID: requestID, runID: runID, error: "Google wasn’t connected. Start again from your Dash account.")
                }
            }
        }
        session.presentationContextProvider = coordinator
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        authenticatingProvider = .google
        if !session.start() {
            authenticationSession = nil
            authenticatingProvider = nil
            dispatchGoogleReconnectResult(requestID: requestID, runID: runID, error: "Google reconnect could not be started.")
        }
    }

    private func completeGoogleConnection(_ components: URLComponents, runID: String) async throws {
        guard let completion = components.queryItems?.first(where: { $0.name == "completion" })?.value,
              !completion.isEmpty else { throw AppleConnectionFailure("Google wasn’t connected. Try again.") }
        let body = try JSONSerialization.data(withJSONObject: ["completion": completion, "runId": runID])
        _ = try await authenticatedData(path: "api/connections/google/complete", method: "POST", body: body)
    }

    private func dispatchGoogleReconnectResult(requestID: String, runID: String, error: String? = nil) {
        var result: [String: Any] = ["requestId": requestID, "runId": runID, "ok": error == nil]
        if let error { result["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:googleReconnectResult',{detail:\(json)}));")
    }

    func handleAppleConnections(_ payload: [String: Any]) {
        guard let requestID = payload["requestId"] as? String, UUID(uuidString: requestID) != nil,
              let kind = payload["kind"] as? String else { return }
        Task { @MainActor in
            do {
                guard let email = authenticatedEmail else { throw AppleConnectionFailure("Sign in to Dash first.") }
                if kind == "execute" {
                    guard let runID = payload["runId"] as? String, UUID(uuidString: runID) != nil,
                          let actionID = payload["actionId"] as? String, UUID(uuidString: actionID) != nil,
                          !appleActionsInFlight.contains(actionID) else { throw AppleConnectionFailure("This iPhone action is already running.") }
                    appleActionsInFlight.insert(actionID)
                    defer { appleActionsInFlight.remove(actionID) }
                    let data = try await AppleActionRunner.run(
                        runID: runID, actionID: actionID, journal: try AppleActionJournal(owner: email), expectedOwner: email,
                        connections: appleConnections, isCurrent: { [weak self] in self?.authenticatedEmail == email },
                        fetch: { [weak self] path, method, body in
                            guard let self else { throw AppleConnectionFailure("Reopen this conversation.") }
                            return try await self.authenticatedData(path: path, method: method, body: body)
                        })
                    dispatchAppleConnections(["requestId": requestID, "ok": true, "snapshot": try JSONSerialization.jsonObject(with: data)])
                    return
                }
                if kind == "connect" || kind == "disconnect" {
                    guard let service = payload["service"] as? String, AppleConnections.services.contains(service) else { throw AppleConnectionFailure("Unknown Apple source.") }
                    if kind == "connect" { try await appleConnections.connect(email, service) }
                    else { appleConnections.disconnect(email, service) }
                } else if kind != "status" { throw AppleConnectionFailure("Unsupported connection request.") }
                guard authenticatedEmail == email else { throw AppleConnectionFailure("Your account changed. Open Settings again.") }
                if (kind == "connect" || kind == "disconnect"), let service = payload["service"] as? String {
                }
                dispatchAppleConnections(["requestId": requestID, "ok": true, "connections": appleConnections.snapshot(email)])
            } catch {
                dispatchAppleConnections(["requestId": requestID, "ok": false, "error": (error as? AppleConnectionFailure)?.message ?? "Couldn't finish on this iPhone. Reopen the conversation and try again."])
            }
        }
    }

    private func dispatchAppleConnections(_ result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:appleConnectionsResult',{detail:\(json)}));")
    }

    func publishDeviceCalendar(requestAccess: Bool) {
        Task {
            let snapshot = await deviceCalendar.snapshot(requestAccess: requestAccess)
            await publishDeviceCalendarSnapshot(snapshot)
        }
    }

    private func publishDeviceCalendarSnapshot(_ snapshot: [String: Any]) async {
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot),
              let json = String(data: data, encoding: .utf8) else { return }
        _ = try? await webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:calendarSnapshot',{detail:\(json)}));")
    }

    enum LinkDestination: Equatable { case browser, external, blocked }

    static func linkDestination(for url: URL) -> LinkDestination {
        let scheme = url.scheme?.lowercased() ?? ""
        if ["tel", "mailto", "sms", "maps", "comgooglemaps", "itms-apps"].contains(scheme) { return .external }
        guard ["http", "https"].contains(scheme), let host = url.host?.lowercased(), !host.isEmpty else { return .blocked }
        if host == "maps.apple.com" || host == "maps.google.com" || host == "apps.apple.com" { return .external }
        return .browser
    }

    func openLink(_ url: URL) {
        switch Self.linkDestination(for: url) {
        case .browser:
            webView.endEditing(true)
            browserLink = BrowserLink(url: url)
        case .external:
            UIApplication.shared.open(url)
        case .blocked:
            break
        }
    }

    /// Only dismiss the exact hosted connector flow that the app verified.
    func closeConnectorBrowser(url: String) {
        guard let current = browserLink?.url,
              current.absoluteString == url,
              current.scheme == "https", current.user == nil, current.password == nil,
              let host = current.host?.lowercased(),
              host == "composio.dev" || host.hasSuffix(".composio.dev") else { return }
        browserLink = nil
    }

    func openExternalPage(path: String) {
        openLink(configuration.baseURL.appending(path: path))
    }

    private let sendHaptic = UIImpactFeedbackGenerator(style: .light)
    private let receiveHaptic = UIImpactFeedbackGenerator(style: .soft)
    private var sentSound: AVAudioPlayer?
    private var receivedSound: AVAudioPlayer?
    private var lastNativeSendFeedback = Date.distantPast
    private var lastMessageReceive = Date.distantPast

    private func prepareSendFeedback() {
        sendHaptic.prepare()
        let session = AVAudioSession.sharedInstance()
        if session.category != .ambient && session.category != .playAndRecord {
            try? session.setCategory(.ambient, mode: .default)
        }
        if sentSound == nil {
            sentSound = systemMessageSound(named: "SentMessage")
        }
        sentSound?.prepareToPlay()
    }

    private func systemMessageSound(named name: String) -> AVAudioPlayer? {
        let path = "/System/Library/Audio/UISounds/\(name).caf"
        guard FileManager.default.fileExists(atPath: path),
              let player = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        player.prepareToPlay()
        return player
    }

    func playMessageFeedback(kind: String, fromNativeTap: Bool = false) {
        guard UIApplication.shared.applicationState == .active,
              kind == "send" || kind == "receive" else { return }
        // New shells play on the native tap. The later WebKit acknowledgement
        // remains for older shells, but must not double-play on this one.
        if kind == "send", !fromNativeTap, Date().timeIntervalSince(lastNativeSendFeedback) < 1 { return }
        if kind == "send", fromNativeTap { lastNativeSendFeedback = Date() }
        if kind == "receive" {
            guard Date().timeIntervalSince(lastMessageReceive) > 2 else { return }
            lastMessageReceive = Date()
        }
        let haptic = kind == "send" ? sendHaptic : receiveHaptic
        haptic.impactOccurred(intensity: kind == "send" ? 0.55 : 0.65)
        haptic.prepare()
        // Ambient mixes with existing audio and obeys the phone's Silent switch.
        let session = AVAudioSession.sharedInstance()
        guard session.category != .playAndRecord else { return }
        do {
            if session.category != .ambient { try session.setCategory(.ambient, mode: .default) }
            if kind == "send" {
                if sentSound == nil { sentSound = systemMessageSound(named: "SentMessage") }
                sentSound?.currentTime = 0
                if sentSound?.play() != true { AudioServicesPlaySystemSound(1004) }
            } else {
                if receivedSound == nil { receivedSound = systemMessageSound(named: "ReceivedMessage") }
                receivedSound?.currentTime = 0
                if receivedSound?.play() != true { AudioServicesPlaySystemSound(1003) }
            }
        } catch { /* Feedback must never interrupt a message. */ }
    }

    func confirmArchive(_ payload: [String: Any]) {
        guard let requestID = payload["requestId"] as? String, UUID(uuidString: requestID) != nil else { return }
        let reply: (Bool) -> Void = { [weak self] confirmed in
            guard let self, let data = try? JSONSerialization.data(withJSONObject: ["requestId": requestID, "confirmed": confirmed]), let json = String(data: data, encoding: .utf8) else { return }
            self.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:archiveConfirmation',{detail:\(json)}));")
        }
        guard let root = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController else { reply(false); return }
        var presenter = root
        while let presented = presenter.presentedViewController { presenter = presented }
        guard !(presenter is UIAlertController) else { reply(false); return }
        let alert = UIAlertController(title: nil, message: "This conversation will be moved to Archived. You can restore it later.", preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Archive", style: .destructive) { _ in reply(true) })
        alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in reply(false) })
        if let popover = alert.popoverPresentationController {
            popover.sourceView = webView
            let supplied = (payload["y"] as? NSNumber)?.doubleValue ?? Double(webView.bounds.midY)
            let y = supplied.isFinite ? min(max(CGFloat(supplied) + 10, 0), webView.bounds.height) : webView.bounds.midY
            popover.sourceRect = CGRect(x: webView.bounds.midX, y: y, width: 1, height: 1)
            popover.permittedArrowDirections = [.up, .down]
        }
        presenter.present(alert, animated: true)
    }

    func handleHaptic(action: String) {
        switch action {
        case "hapticSuccess": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "hapticWarning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "hapticError": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "hapticSelection": UISelectionFeedbackGenerator().selectionChanged()
        default: break
        }
    }

    func openSignInSheet(runID: String, urlString: String, host: String) {
        guard !runID.isEmpty else { return }
        guard signInRequest == nil,
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              let urlHost = url.host, !urlHost.isEmpty
        else {
            dispatchSignInResult(runID: runID, detail: ["ok": false])
            return
        }
        let displayHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        signInRequest = SignInRequest(runID: runID, url: url, host: displayHost.isEmpty ? urlHost : displayHost)
    }

    func finishSignInHandoff(_ request: SignInRequest, outcome: SignInOutcome) {
        guard signInRequest == request else { return }
        signInRequest = nil
        switch outcome {
        case .cancelled:
            dispatchSignInResult(runID: request.runID, detail: ["ok": false])
        case .completed(let cookies, let finalURL, let login):
            let owner = authenticatedEmail
            SignInCompletion.deliver(login: login, transfer: {
                dispatchSignInResult(runID: request.runID, detail: [
                    "ok": true,
                    "cookies": cookies,
                    "finalUrl": finalURL,
                ])
            }, save: { [weak self] login in
                guard let self, let owner, self.authenticatedEmail == owner else { return }
                try await self.saveDeviceVaultItem([
                    "requestId": UUID().uuidString,
                    "kind": "login",
                    "label": login.host,
                    "siteHost": login.host,
                    "username": login.username,
                    "password": login.password,
                ])
            })
        }
    }

    /// The only place captured cookies go: one CustomEvent into the page.
    /// Nothing here is logged or persisted.
    private func dispatchSignInResult(runID: String, detail: [String: Any]) {
        var result = detail
        result["runId"] = runID
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:signInResult',{detail:\(json)}));")
    }

    func setWorkspaceBackEdge(fromRight: Bool, enabled: Bool) {
        workspaceBackEnabled = enabled
        workspaceBackFromRight = fromRight
    }

    @objc private func handleWorkspaceBackSwipe(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: webView)
        let velocity = gesture.velocity(in: webView)
        let direction = workspaceSwipeDirection
        let progress = min(1, max(0, direction * translation.x / max(webView.bounds.width, 1)))
        switch gesture.state {
        case .began:
            navigationFromLeft = workspaceBackFromRight
            dispatchWorkspaceBackSwipe(phase: "began", progress: 0, commit: false)
        case .changed:
            dispatchWorkspaceBackSwipe(phase: "changed", progress: progress, commit: false)
        case .ended:
            let horizontal = direction * translation.x > abs(translation.y) * 1.15
            let commit = horizontal && (progress >= 0.32 || direction * velocity.x >= 650)
            dispatchWorkspaceBackSwipe(phase: "ended", progress: progress, commit: commit)
        case .cancelled, .failed:
            dispatchWorkspaceBackSwipe(phase: "cancelled", progress: progress, commit: false)
        default:
            break
        }
    }

    private func dispatchWorkspaceBackSwipe(phase: String, progress: Double, commit: Bool) {
        let eventName = "decisionFeed:nativeBackSwipe"
        let script = "window.dispatchEvent(new CustomEvent('\(eventName)',{detail:{phase:'\(phase)',progress:\(progress),commit:\(commit)}}));"
        webView.evaluateJavaScript(script)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === workspaceBackSwipeRecognizer else { return true }
        // Web modals and the sign-in handoff own the screen; the edge swipe
        // must not reach the page underneath them.
        guard workspaceBackEnabled && !conversationSwipeActive && state == .ready && !isModalOverlayVisible && signInRequest == nil,
              let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
        let velocity = pan.velocity(in: webView)
        workspaceSwipeDirection = workspaceBackFromRight ? -1 : 1
        return Self.shouldBeginWorkspaceBackSwipe(x: velocity.x, y: velocity.y, fromRight: workspaceSwipeDirection < 0)
    }

    static func shouldBeginWorkspaceBackSwipe(x: CGFloat, y: CGFloat, fromRight: Bool) -> Bool {
        let towardBack = (fromRight ? -1 : 1) * x
        return towardBack > 0 && towardBack > abs(y) * 1.3
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === workspaceBackSwipeRecognizer || otherGestureRecognizer === workspaceBackSwipeRecognizer else { return false }
        let other = gestureRecognizer === workspaceBackSwipeRecognizer ? otherGestureRecognizer : gestureRecognizer
        // WebKit's touch-delivery recognizers must be allowed to coexist. Blocking
        // all of them prevents back navigation on non-scrolling question pages.
        // Scroll pans still yield to the directional back recognizer below.
        return !(other is UIPanGestureRecognizer)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === workspaceBackSwipeRecognizer,
              let scrollView = otherGestureRecognizer.view as? UIScrollView,
              otherGestureRecognizer === scrollView.panGestureRecognizer else { return false }
        // Overflow conversations have nested WK scroll views, not just the root
        // webView.scrollView. Let back decide direction before any of them scroll.
        return scrollView.isDescendant(of: webView)
    }

    func handleSheetCoverage(_ payload: [String: Any]) {
        if payload["ended"] as? Bool == true {
            // Keep the final uncovered frame until the visibility messages clear.
            sheetCoverage = isModalOverlayVisible || isBrowserViewerVisible
                ? SheetCoverage(rect: .zero, radius: 0, opacity: 0, dimming: 0) : nil
            return
        }
        let next = SheetCoverage(payload: payload, webView: webView)
        if sheetCoverage != next { sheetCoverage = next }
    }

    func handleModalOverlayVisibility(_ payload: [String: Any]) {
        let visible = payload["visible"] as? Bool ?? false
        if visible && !isModalOverlayVisible && !isBrowserViewerVisible { composerDismissal += 1 }
        keepsBackgroundChrome = visible && payload["keepsBackgroundChrome"] as? Bool == true
        isModalOverlayVisible = visible
        modalPrefersDarkAppearance = visible && payload["appearance"] as? String == "dark"
        if !visible && !isBrowserViewerVisible { sheetCoverage = nil }
    }

    func handleBrowserViewerVisibility(_ payload: [String: Any]) {
        let visible = payload["visible"] as? Bool ?? false
        if visible && !isBrowserViewerVisible && !isModalOverlayVisible { composerDismissal += 1 }
        isBrowserViewerVisible = visible
        if !visible && !isModalOverlayVisible { sheetCoverage = nil }
    }

    func handleAppearanceState(_ payload: [String: Any]) {
        // The web store reports its temporary default before hydration. Do not
        // let that value replace the saved theme during the loading animation.
        guard let preference = payload["preference"] as? String,
              ["system", "light", "dark"].contains(preference) else { return }
        UserDefaults.standard.set(preference, forKey: Self.appearancePreferenceKey)
        switch preference {
        case "light": preferredColorScheme = .light
        case "dark": preferredColorScheme = .dark
        default: preferredColorScheme = nil
        }
    }

    func signedOutFromWorkspace() {
        URLCache.shared.removeAllCachedResponses()
        webView.configuration.websiteDataStore.removeData(
            ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache],
            modifiedSince: .distantPast,
            completionHandler: {}
        )
        NotificationReplySessionStore.clear(baseURL: configuration.baseURL)
        authenticationSession?.cancel()
        authenticationSession = nil
        authenticatingProvider = nil
        authenticatedEmail = nil
        authenticatedProvider = nil
        onboardingGoogleConnected = false
        registeredPushToken = nil
        shouldResolveOnboardingAfterAuthentication = false
        isResolvingAuthenticatedDestination = false
        pendingAuthenticationIntent = nil
        hasLoadedWorkspace = false
        workspaceReadyReceived = false
        workspaceLoadWatchdog?.cancel()
        isModalOverlayVisible = false
        keepsBackgroundChrome = false
        modalPrefersDarkAppearance = false
        isBrowserViewerVisible = false
        sheetCoverage = nil
        signInRequest = nil
        webView.stopLoading()
        state = .signedOut
    }

    func publishNotificationSettings(error: String? = nil) {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .ephemeral: status = "on"
            case .provisional: status = "quiet"
            case .denied: status = "off"
            case .notDetermined: status = "notDetermined"
            @unknown default: status = "off"
            }
            var payload = ["status": status]
            if let error { payload["error"] = error }
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            _ = try? await webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:notificationSettings',{detail:\(json)}));")
        }
    }

    func manageNotifications() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = await requestOnboardingNotifications()
                publishNotificationSettings()
            } else {
                guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return }
                let opened = await UIApplication.shared.open(url)
                publishNotificationSettings(error: opened ? nil : "Couldn’t open notification settings. Try again.")
            }
        }
    }

    func unregisterPushToken() {
        let token = latestPushToken
        Task {
            if let token,
               let body = try? JSONSerialization.data(withJSONObject: ["token": token.value]) {
                _ = try? await authenticatedData(path: "api/mobile/push-tokens", method: "DELETE", body: body)
            }
            registeredPushToken = nil
            _ = try? await webView.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('decisionFeed:pushTokenUnregistered'));"
            )
        }
    }

    func handleDeviceVaultAction(_ action: String, payload: [String: Any]) {
        Task {
            do {
                switch action {
                case "vaultSave": try await saveDeviceVaultItem(payload)
                case "vaultDelete": try await deleteDeviceVaultItem(payload)
                case "vaultDeleteAll": try await deleteAllDeviceVaultItems(payload)
                case "vaultRelease": try await releaseDeviceVaultItem(payload)
                default: return
                }
            } catch {
                dispatchDeviceVaultResult(requestID: payload["requestId"] as? String, error: error.localizedDescription)
            }
        }
    }

    private func saveDeviceVaultItem(_ payload: [String: Any]) async throws {
        guard let email = authenticatedEmail,
              let requestID = payload["requestId"] as? String,
              let kind = payload["kind"] as? String,
              let label = payload["label"] as? String,
              !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { throw DeviceVaultError.invalidPayload }
        let siteHost = (payload["siteHost"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let secret: DeviceVaultSecret
        let metadata: [String: Any]
        if kind == "login" {
            guard let username = payload["username"] as? String, let password = payload["password"] as? String else { throw DeviceVaultError.invalidPayload }
            secret = try .login(username: username, password: password)
            metadata = ["kind": kind, "label": label, "siteHost": siteHost, "usernameHint": usernameHint(username)]
        } else if kind == "payment_card" {
            guard let cardholderName = payload["cardholderName"] as? String,
                  let cardNumber = payload["cardNumber"] as? String,
                  let expiryMonth = payload["expiryMonth"] as? String,
                  let expiryYear = payload["expiryYear"] as? String
            else { throw DeviceVaultError.invalidPayload }
            secret = try .payment(
                cardholderName: cardholderName,
                cardNumber: cardNumber,
                expiryMonth: expiryMonth,
                expiryYear: expiryYear,
                billingPostalCode: payload["billingPostalCode"] as? String ?? ""
            )
            let digits = cardNumber.filter(\.isNumber)
            metadata = ["kind": kind, "label": label, "siteHost": "", "cardBrand": cardBrand(digits), "cardLast4": String(digits.suffix(4))]
        } else { throw DeviceVaultError.invalidPayload }

        let existingID = (payload["itemId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let metadataBody = try JSONSerialization.data(withJSONObject: metadata)
        let responseData = try await authenticatedData(
            path: existingID.flatMap { $0.isEmpty ? nil : "api/vault/\($0)" } ?? "api/vault",
            method: existingID?.isEmpty == false ? "PUT" : "POST",
            body: metadataBody
        )
        guard let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any],
              let item = response["item"] as? [String: Any],
              let itemID = item["id"] as? String
        else { throw URLError(.cannotParseResponse) }
        do {
            guard authenticatedEmail == email else { throw DeviceVaultError.unavailable }
            try deviceVault.save(ownerEmail: email, itemID: itemID, secret: secret)
        } catch {
            if existingID?.isEmpty != false { _ = try? await authenticatedData(path: "api/vault/\(itemID)", method: "DELETE") }
            throw error
        }

        var result: [String: Any] = ["requestId": requestID, "ok": true, "item": item]
        if let runID = payload["runId"] as? String, let actionID = payload["actionId"] as? String {
            let completionBody = try JSONSerialization.data(withJSONObject: ["actionId": actionID, "itemId": itemID])
            let snapshotData = try await authenticatedData(path: "api/runs/\(runID)/vault", method: "POST", body: completionBody)
            result["snapshot"] = try JSONSerialization.jsonObject(with: snapshotData)
        }
        dispatchDeviceVaultResult(result)
    }

    private func deleteDeviceVaultItem(_ payload: [String: Any]) async throws {
        guard let email = authenticatedEmail,
              let requestID = payload["requestId"] as? String,
              let itemID = payload["itemId"] as? String
        else { throw DeviceVaultError.invalidPayload }
        try deviceVault.delete(ownerEmail: email, itemID: itemID)
        _ = try await authenticatedData(path: "api/vault/\(itemID)", method: "DELETE")
        dispatchDeviceVaultResult(["requestId": requestID, "ok": true, "deleted": true, "itemId": itemID])
    }

    private func deleteAllDeviceVaultItems(_ payload: [String: Any]) async throws {
        guard let email = authenticatedEmail,
              let requestID = payload["requestId"] as? String
        else { throw DeviceVaultError.invalidPayload }
        try deviceVault.deleteAll(ownerEmail: email)
        appleConnections.disconnectAll(email)
        try? AppleActionJournal(owner: email).clear()
        dispatchDeviceVaultResult(["requestId": requestID, "ok": true, "deleted": true])
    }

    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    func openCalendar(timestamp: TimeInterval?) {
        let reference = timestamp.map { Date(timeIntervalSince1970: $0).timeIntervalSinceReferenceDate }
            ?? Date().timeIntervalSinceReferenceDate
        guard let url = URL(string: "calshow:\(reference)") else { return }
        UIApplication.shared.open(url)
    }

    private func prepareDeviceVaultSelection(runID: String, actionID: String, itemID: String) async throws -> [String: Any] {
        let body = try JSONSerialization.data(withJSONObject: ["actionId": actionID, "itemId": itemID])
        let data = try await authenticatedData(path: "api/runs/\(runID)/vault", method: "POST", body: body)
        guard let challenge = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DeviceVaultError.invalidPayload }
        return challenge
    }

    private func releaseDeviceVaultItem(_ payload: [String: Any]) async throws {
        guard let email = authenticatedEmail,
              let requestID = payload["requestId"] as? String,
              let runID = payload["runId"] as? String,
              let actionID = payload["actionId"] as? String,
              let itemID = payload["itemId"] as? String,
              let kind = payload["kind"] as? String,
              ["login", "payment_card"].contains(kind)
        else { throw DeviceVaultError.invalidPayload }
        let selection = payload["prepareSelection"] as? Bool == true
        // Only recipient preparation overlaps authentication. It cannot approve,
        // release secrets or resume the run. Cancellation sends no envelope.
        async let prepared: [String: Any] = selection
            ? prepareDeviceVaultSelection(runID: runID, actionID: actionID, itemID: itemID)
            : payload
        var secret = try await deviceVault.read(ownerEmail: email, itemID: itemID, reason: "Allow Dash to fill this \(kind == "login" ? "login" : "payment card") once")
        guard secret.kind == kind, authenticatedEmail == email else { throw DeviceVaultError.invalidPayload }
        if selection { dispatchDeviceVaultResult(["requestId": requestID, "ok": true, "phase": "authenticated"]) }
        let challenge = try await prepared
        guard challenge["kind"] as? String == kind,
              let recipientPublicKey = challenge["recipientPublicKey"] as? String,
              authenticatedEmail == email else { throw DeviceVaultError.invalidPayload }
        if challenge["needSecurityCode"] as? Bool == true {
            secret.securityCode = try await requestSecurityCode()
        }
        guard authenticatedEmail == email else { throw DeviceVaultError.invalidPayload }
        let envelope = try DeviceVaultEncryption.seal(secret, recipientPublicKey: recipientPublicKey)
        let envelopeData = try JSONEncoder().encode(envelope)
        guard let envelopeObject = try JSONSerialization.jsonObject(with: envelopeData) as? [String: Any] else { throw DeviceVaultError.encryption }
        let body = try JSONSerialization.data(withJSONObject: ["actionId": actionID, "itemId": itemID, "envelope": envelopeObject])
        let snapshotData = try await authenticatedData(path: "api/runs/\(runID)/vault-release", method: "POST", body: body)
        dispatchDeviceVaultResult([
            "requestId": requestID,
            "ok": true,
            "snapshot": try JSONSerialization.jsonObject(with: snapshotData),
        ])
    }

    private func requestSecurityCode() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let alert = UIAlertController(title: "Security code", message: "Used for this purchase only and never saved.", preferredStyle: .alert)
            alert.addTextField { field in
                field.placeholder = "CVC"
                field.keyboardType = .numberPad
                field.isSecureTextEntry = true
                // A CVC is not a card number and must never trigger iOS card-
                // number AutoFill inside this one-time, unsaved prompt.
                field.textContentType = nil
                field.autocorrectionType = .no
                field.spellCheckingType = .no
            }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(throwing: CancellationError()) })
            alert.addAction(UIAlertAction(title: "Continue", style: .default) { _ in
                let code = alert.textFields?.first?.text?.filter(\.isNumber) ?? ""
                guard (3...4).contains(code.count) else {
                    continuation.resume(throwing: DeviceVaultError.invalidPayload)
                    return
                }
                continuation.resume(returning: code)
            })
            guard let presenter = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?.rootViewController else {
                continuation.resume(throwing: DeviceVaultError.unavailable)
                return
            }
            var visible = presenter
            while let presented = visible.presentedViewController { visible = presented }
            visible.present(alert, animated: true)
        }
    }

    private func dispatchDeviceVaultResult(requestID: String?, error: String) {
        dispatchDeviceVaultResult(["requestId": requestID ?? "", "ok": false, "error": error])
    }

    private func dispatchDeviceVaultResult(_ result: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:vaultResult',{detail:\(json)}));")
    }

    private func usernameHint(_ username: String) -> String {
        let cleaned = username.trimmingCharacters(in: .whitespacesAndNewlines)
        if let at = cleaned.firstIndex(of: "@"), at > cleaned.startIndex {
            return "\(cleaned.prefix(2))•••\(cleaned[at...])"
        }
        return cleaned.count <= 2 ? "••" : "\(cleaned.prefix(2))•••"
    }

    private func cardBrand(_ digits: String) -> String {
        if digits.hasPrefix("4") { return "Visa" }
        if let prefix = Int(digits.prefix(2)), (51...55).contains(prefix) { return "Mastercard" }
        if digits.hasPrefix("34") || digits.hasPrefix("37") { return "Amex" }
        if digits.hasPrefix("6011") || digits.hasPrefix("65") { return "Discover" }
        return "Card"
    }

    func handleWorkspaceState(_ payload: [String: Any]) {
        workspaceDidBecomeReady(payload: ["source": "workspace_state"])
        guard JSONSerialization.isValidJSONObject(payload) else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: payload)
            let snapshot = try JSONDecoder().decode(NativeWorkspaceSnapshot.self, from: data)
            NativeExperienceManager.shared.synchronize(snapshot)
            dispatchPendingNativeChoiceIfPossible()
        } catch {
            // Ignore malformed bridge payloads instead of destabilizing the wrapper.
        }
    }

    func handleNativeChoiceResult(_ payload: [String: Any]) {
        guard
            let decisionID = payload["decisionId"] as? String,
            let optionID = payload["optionId"] as? String,
            let started = payload["started"] as? Bool
        else { return }
        let choice = NativeDecisionChoice(decisionID: decisionID, optionID: optionID)
        NativeExperienceManager.shared.nativeChoiceCompleted(decisionID: decisionID, optionID: optionID, started: started)
        if started, pendingNativeChoice == choice {
            pendingNativeChoice = nil
            dispatchedNativeChoice = nil
        } else if !started, dispatchedNativeChoice == choice {
            dispatchedNativeChoice = nil
        }
    }

    func handleDeepLink(_ url: URL) {
        guard url.scheme?.lowercased() == configuration.callbackScheme else { return }
        if url.host?.lowercased() == "share" {
            receiveSharedDraft()
            return
        }
        if url.host?.lowercased() == "task",
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let runID = components.queryItems?.first(where: { $0.name == "id" })?.value,
           !runID.isEmpty {
            enqueueRunningTask(runID: runID)
        }
    }

    private func dispatchGoogleReconnectIfPossible() {
        guard state == .ready, pendingGoogleReconnect else { return }
        pendingGoogleReconnect = false
        browserLink = nil
        webView.evaluateJavaScript("window.__dashPendingGoogleReconnect = true; window.dispatchEvent(new Event('decisionFeed:googleReconnectNeeded'));")
    }

    func enqueueRunningTask(runID: String) {
        browserLink = nil
        pendingFeedDecisionID = nil
        pendingRunningRunID = runID
        dispatchPendingRunningTaskIfPossible()
    }

    private func dispatchPendingRunningTaskIfPossible() {
        guard state == .ready,
              let runID = pendingRunningRunID,
              !runID.isEmpty
        else { return }
        pendingRunningRunID = nil
        openRunningTask(runID: runID)
    }

    func enqueueFeedDecision(decisionID: String) {
        browserLink = nil
        pendingRunningRunID = nil
        pendingFeedDecisionID = decisionID
        dispatchPendingFeedDecisionIfPossible()
    }

    private func dispatchPendingFeedDecisionIfPossible() {
        guard state == .ready, let decisionID = pendingFeedDecisionID, !decisionID.isEmpty else { return }
        pendingFeedDecisionID = nil
        openFeedDecision(decisionID: decisionID)
    }

    // A share can finish while Dash is already suspended, without a deep link.
    func receiveSharedDraft() {
        receivePendingSharedIntake()
        guard pendingSharedIntake != nil else { return }
        browserLink = nil
        shareItem = nil
        documentPreview = nil
        pendingRunningRunID = nil
        pendingFeedDecisionID = nil
        dispatchPendingSharedIntakeIfPossible()
    }

    private func receivePendingSharedIntake() {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = defaults.data(forKey: pendingSharedIntakeKey)
        else { return }
        pendingSharedIntake = data
    }

    private func dispatchPendingSharedIntakeIfPossible() {
        guard !sharedIntakeDispatchInFlight, state == .ready,
              let data = pendingSharedIntake,
              let object = try? JSONSerialization.jsonObject(with: data),
              JSONSerialization.isValidJSONObject(object),
              let normalized = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: normalized, encoding: .utf8)
        else { return }
        sharedIntakeDispatchInFlight = true
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:sharedIntake',{detail:\(json),cancelable:true}));") { [weak self] accepted, error in
            guard let self else { return }
            self.sharedIntakeDispatchInFlight = false
            guard error == nil, accepted as? Bool != false else { return }
            if self.pendingSharedIntake == data { self.pendingSharedIntake = nil }
            let defaults = UserDefaults(suiteName: self.appGroup)
            if defaults?.data(forKey: self.pendingSharedIntakeKey) == data { defaults?.removeObject(forKey: self.pendingSharedIntakeKey) }
            self.dispatchPendingSharedIntakeIfPossible()
        }
    }

    private func enqueueNativeChoice(_ choice: NativeDecisionChoice) {
        if pendingNativeChoice != choice {
            pendingNativeChoice = choice
            dispatchedNativeChoice = nil
        }
        dispatchPendingNativeChoiceIfPossible()
    }

    private func receivePushToken(_ token: NativePushDeviceToken) {
        latestPushToken = token
        if registeredPushToken != token { registeredPushToken = nil }
        registerPushTokenIfPossible()
    }

    private func registerPushTokenIfPossible() {
        guard authenticatedEmail != nil,
              let token = latestPushToken,
              registeredPushToken != token,
              !isRegisteringPushToken
        else { return }
        isRegisteringPushToken = true
        Task {
            defer { isRegisteringPushToken = false }
            guard let body = try? JSONSerialization.data(withJSONObject: [
                "token": token.value,
                "environment": token.environment,
            ]) else { return }
            do {
                _ = try await authenticatedData(path: "api/mobile/push-tokens", method: "POST", body: body)
                guard latestPushToken == token, authenticatedEmail != nil else { return }
                registeredPushToken = token
            } catch {
                // Authentication and network availability can lag APNs token
                // delivery. The next page readiness or network recovery retries.
            }
        }
    }

    private func dispatchPendingNativeChoiceIfPossible() {
        guard state == .ready,
              let choice = pendingNativeChoice,
              dispatchedNativeChoice != choice,
              let data = try? JSONSerialization.data(withJSONObject: [
                "decisionId": choice.decisionID,
                "optionId": choice.optionID,
              ]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        dispatchedNativeChoice = choice
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:nativeChoice', { detail: \(json) }));")
    }

    /// Returns true when the loaded page opened the conversation itself, avoiding a full reload.
    private func openConversationInPlace(_ id: String) -> Bool {
        guard state == .ready, hasLoadedWorkspace, pageOpensConversationsInPlace,
              let data = try? JSONSerialization.data(withJSONObject: ["id": id]),
              let json = String(data: data, encoding: .utf8) else { return false }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:openConversation', { detail: \(json) }));")
        return true
    }

    private func openRunningTask(runID: String) {
        if openConversationInPlace(runID) { return }
        var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "view", value: "running"),
            URLQueryItem(name: "task", value: runID),
        ]
#if DEBUG
        if isWorkspacePreview {
            components?.queryItems?.append(URLQueryItem(name: "uiPreview", value: "1"))
            components?.queryItems?.append(URLQueryItem(name: "scanPreview", value: "idle"))
        }
#endif
        guard let url = components?.url else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private func openFeedDecision(decisionID: String) {
        if openConversationInPlace(decisionID) { return }
        var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "view", value: "feed"),
            URLQueryItem(name: "decision", value: decisionID),
        ]
        guard let url = components?.url else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private func bootstrap() async {
        state = .loading
        do {
            // These checks are independent, so they run at the same time; the decisions below are unchanged.
            async let configData = mobileConfigurationData()
            async let sessionIdentity = authenticatedSessionIdentity()
            async let onboardingState = remoteOnboardingState()
            let mobileConfig = try JSONDecoder().decode(MobileWebConfiguration.self, from: try await configData)
            guard MobileCompatibility.supports(wrapperVersion: configuration.wrapperVersion, configuration: mobileConfig) else {
                state = .incompatible
                return
            }
            // The web route authenticates independently. Load it as soon as
            // compatibility is known, while the native destination checks finish.
            // The ready event remains gated until identity/onboarding resolve.
            isResolvingAuthenticatedDestination = true
            loadWorkspace(reason: "bootstrap", resetAttempts: true)
            if let identity = await sessionIdentity {
                authenticatedEmail = identity.email
                authenticatedProvider = identity.provider
                onboardingGoogleConnected = identity.provider == .google
                registerPushTokenIfPossible()
                let completed = await resolvedOnboardingCompletion(for: identity.email, prefetched: await onboardingState)
                isResolvingAuthenticatedDestination = false
                if completed {
                    if workspaceReadyReceived { finishWorkspaceLoad() }
                } else {
                    workspaceLoadWatchdog?.cancel()
                    state = .onboarding
                    if workspaceReadyReceived { finishWorkspaceLoad() }
                    if identity.provider == .google {
                        await beginInitialSignupScan()
                    }
                }
            } else {
                isResolvingAuthenticatedDestination = false
                workspaceLoadWatchdog?.cancel()
                webView.stopLoading()
                state = .signedOut
            }
        } catch {
            isResolvingAuthenticatedDestination = false
            navigationFailed(error)
        }
    }

    private func authenticatedSessionIdentity() async -> AuthenticatedSessionIdentity? {
        do {
            let data = try await authenticatedData(path: "api/auth/session")
            guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let user = payload["user"] as? [String: Any],
                  let email = user["email"] as? String
            else { return nil }
            let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !normalizedEmail.isEmpty else { return nil }
            let provider = (payload["authProvider"] as? String).flatMap(AuthenticationProvider.init(rawValue:))
            return AuthenticatedSessionIdentity(email: normalizedEmail, provider: provider)
        } catch {
            return nil
        }
    }

    private func authenticatedData(path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        let sessionGeneration = NotificationReplySessionStore.generation
        let cookies = await withCheckedContinuation { continuation in
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies {
                continuation.resume(returning: $0)
            }
        }
        guard let host = configuration.baseURL.host?.lowercased() else { throw URLError(.badURL) }
        let matchingCookies = cookies.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return host == domain || host.hasSuffix(".\(domain)")
        }
        guard !matchingCookies.isEmpty else { throw URLError(.userAuthenticationRequired) }

        var request = URLRequest(
            url: configuration.baseURL.appending(path: path),
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData
        )
        request.httpMethod = method
        request.setValue("1", forHTTPHeaderField: "X-Dash-Google-Connection-Completion")
        request.httpBody = body
        request.timeoutInterval = 15
        request.setValue(HTTPCookie.requestHeaderFields(with: matchingCookies)["Cookie"], forHTTPHeaderField: "Cookie")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            if path.hasSuffix("/apple"), let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let message = payload["error"] as? String, message.count <= 500 { throw AppleConnectionFailure(message) }
            throw URLError(.badServerResponse)
        }
        if path == "api/auth/session", sessionGeneration == NotificationReplySessionStore.generation, let session = NotificationReplySession.verified(data: data, cookies: matchingCookies, baseURL: configuration.baseURL) {
            try? NotificationReplySessionStore.save(session, baseURL: configuration.baseURL)
        }
        return data
    }

    private func mobileConfigurationData() async throws -> Data {
        var request = URLRequest(url: configuration.baseURL.appending(path: "api/mobile/config"), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    private func remoteOnboardingState() async -> MobileOnboardingState? {
        guard let data = try? await authenticatedData(path: "api/mobile/onboarding") else { return nil }
        return try? JSONDecoder().decode(MobileOnboardingState.self, from: data)
    }

    private func resolvedOnboardingCompletion(for email: String, prefetched: MobileOnboardingState?? = .none) async -> Bool {
        let legacyKey = onboardingCompletionKey(for: email)
        let legacyCompleted = UserDefaults.standard.bool(forKey: legacyKey)
        do {
            let fetched: MobileOnboardingState?
            if case .some(let value) = prefetched { fetched = value } else { fetched = await remoteOnboardingState() }
            guard let remote = fetched else { throw URLError(.cannotParseResponse) }
            if legacyCompleted && !remote.completed {
                do {
                    try await persistOnboardingCompletion(true, for: email)
                    return true
                } catch {
                    return false
                }
            }
            UserDefaults.standard.removeObject(forKey: legacyKey)
            return remote.completed
        } catch {
            return legacyCompleted
        }
    }

    private func persistOnboardingCompletion(_ completed: Bool, for email: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["completed": completed])
        _ = try await authenticatedData(path: "api/mobile/onboarding", method: "PATCH", body: body)
        UserDefaults.standard.removeObject(forKey: onboardingCompletionKey(for: email))
    }

    private func persistLifeProfile(_ profile: OnboardingProfileDraft) async throws {
        let body = try JSONEncoder().encode(profile)
        _ = try await authenticatedData(path: "api/mobile/life-profile", method: "PATCH", body: body)
    }

    private func resolveAuthenticatedDestination() async {
        guard let identity = await authenticatedSessionIdentity() else {
            pendingAuthenticationIntent = nil
            state = .signedOut
            return
        }
        authenticatedEmail = identity.email
        authenticatedProvider = identity.provider
        onboardingGoogleConnected = identity.provider == .google
        registerPushTokenIfPossible()
        let completed = await resolvedOnboardingCompletion(for: identity.email)
        pendingAuthenticationIntent = nil
        if completed {
            if workspaceReadyReceived {
                finishWorkspaceLoad()
            } else {
                state = .loading
                workspaceLoadAttempt = max(workspaceLoadAttempt, 1)
                startWorkspaceLoadWatchdog(for: workspaceLoadAttempt)
            }
        } else {
            workspaceLoadWatchdog?.cancel()
            state = .onboarding
            if identity.provider == .google {
                await beginInitialSignupScan()
            }
        }
    }

    private func loadWorkspace(reason: String, resetAttempts: Bool) {
        if resetAttempts { workspaceLoadAttempt = 0 }
        workspaceLoadAttempt += 1
        workspaceReadyReceived = false
        state = .loading
        recordClientEvent("workspace_load_requested", details: [
            "reason": reason,
            "attempt": workspaceLoadAttempt,
            "url": diagnosticURL(configuration.baseURL),
        ])
        // The page itself is never cached (force-dynamic); hashed scripts and styles are reused.
        webView.load(URLRequest(url: configuration.baseURL, cachePolicy: workspaceLoadAttempt > 1 ? .reloadIgnoringLocalCacheData : .useProtocolCachePolicy))
        startWorkspaceLoadWatchdog(for: workspaceLoadAttempt)
    }

    private func startWorkspaceLoadWatchdog(for attempt: Int) {
        workspaceLoadWatchdog?.cancel()
        workspaceLoadWatchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: WorkspaceLoadRecovery.readyTimeoutNanoseconds)
            guard !Task.isCancelled, let self,
                  self.state == .loading,
                  !self.workspaceReadyReceived,
                  !self.hasLoadedWorkspace,
                  self.workspaceLoadAttempt == attempt
            else { return }

            self.recordClientEvent("workspace_ready_timeout", details: [
                "attempt": attempt,
                "url": self.diagnosticURL(self.webView.url),
                "estimatedProgress": self.webView.estimatedProgress,
                "isLoading": self.webView.isLoading,
            ])
            if WorkspaceLoadRecovery.action(afterAttempt: attempt) == .retry {
                self.webView.stopLoading()
                self.loadWorkspace(reason: "automatic_timeout_retry", resetAttempts: false)
            } else {
                self.state = .failed("The workspace page arrived, but the app could not finish opening it. Try again.")
            }
        }
    }

    private func recordClientEvent(_ event: String, details: [String: Any]) {
        let safeDetails = diagnosticDetails(details)
        workspaceLogger.notice("\(event, privacy: .public) \(String(describing: safeDetails), privacy: .public)")

    }

    private func diagnosticDetails(_ values: [String: Any]) -> [String: Any] {
        Dictionary(uniqueKeysWithValues: values.prefix(20).map { key, value in
            let normalized: Any
            switch value {
            case let string as String: normalized = String(string.prefix(800))
            case let number as NSNumber: normalized = number
            case is NSNull: normalized = NSNull()
            default: normalized = String(String(describing: value).prefix(800))
            }
            return (String(key.prefix(80)), normalized)
        })
    }

    private func diagnosticURL(_ url: URL?) -> String {
        guard let url else { return "" }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        components?.fragment = nil
        return components?.url?.absoluteString ?? url.absoluteString
    }

    private func requestInitialSignupScan() async throws -> Bool {
        let body = try JSONSerialization.data(withJSONObject: ["action": "request"])
        let data = try await authenticatedData(
            path: "api/mobile/onboarding/initial-scan",
            method: "POST",
            body: body
        )
        return try JSONDecoder().decode(InitialSignupScanResponse.self, from: data).requested
    }

    private func beginInitialSignupScan() async {
        guard !onboardingProfileSetupOnly, authenticatedProvider == .google || onboardingGoogleConnected else { return }
        do {
            let requested = try await requestInitialSignupScan()
            if requested {
                let body = try JSONSerialization.data(withJSONObject: [
                    "forceFullScan": true,
                    "userTimeZone": TimeZone.current.identifier,
                ])
                _ = try await authenticatedData(path: "api/manual-scans", method: "POST", body: body)
            }
            _ = try? await webView.evaluateJavaScript(
                "window.decisionFeedInitialSignupScanRequested=true;window.dispatchEvent(new CustomEvent('decisionFeed:initialSignupScan'));"
            )
        } catch {
            recordClientEvent("initial_signup_scan_request_failed", details: [
                "provider": authenticatedProvider?.rawValue ?? "unknown",
                "message": error.localizedDescription,
            ])
        }
    }

    private func onboardingCompletionKey(for email: String) -> String {
        let digest = SHA256.hash(data: Data(email.utf8))
        let accountID = digest.map { String(format: "%02x", $0) }.joined()
        return "wdyt.mobileOnboarding.completed.\(accountID)"
    }

    private func networkChanged(isOnline: Bool) {
        if !isOnline {
            if keepsPageWhileOffline { connectionLost = true } else { state = .offline }
        } else {
            connectionLost = false
            if state == .offline { retry() } else { registerPushTokenIfPossible() }
        }
    }

    /// The loaded workspace, sign-in and onboarding keep their screen and typed input while offline.
    private var keepsPageWhileOffline: Bool {
        (state == .ready && hasLoadedWorkspace) || state == .signedOut || state == .onboarding
    }
}


/// One location fix, requested only by the person's attachment action.
@MainActor
final class SharedLocationProvider: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager: CLLocationManager
    private var requestID: String?
    private var completion: (([String: Any]) -> Void)?
    private var timeout: Task<Void, Never>?

    init(manager: CLLocationManager = CLLocationManager()) {
        self.manager = manager
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func cancelPending() {
        if let requestID { cancel(id: requestID) }
    }

    func request(id: String, completion: @escaping ([String: Any]) -> Void) {
        if requestID != nil { finish(error: "Location sharing was cancelled.") }
        requestID = id
        self.completion = completion
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: locate()
        case .denied, .restricted: denied()
        @unknown default: finish(error: "Location is not available on this device.")
        }
    }

    func cancel(id: String) {
        guard requestID == id else { return }
        timeout?.cancel(); timeout = nil
        manager.stopUpdatingLocation()
        requestID = nil; completion = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard requestID != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: locate()
        case .denied, .restricted: denied()
        default: break
        }
    }

    private func locate() {
        timeout?.cancel()
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(30)) } catch { return }
            self?.finish(error: "Finding your location took too long. Try again.")
        }
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              CLLocationCoordinate2DIsValid(location.coordinate), abs(location.timestamp.timeIntervalSinceNow) < 60 else {
            finish(error: "A current location could not be found. Try again.")
            return
        }
        finish(location: ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude,
                          "accuracy": location.horizontalAccuracy, "capturedAt": ISO8601DateFormatter().string(from: location.timestamp)])
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied { denied() }
        else { finish(error: "Your location could not be found. Try again.") }
    }

    private func denied() {
        finish(error: "Location access is off. Allow location for Dash in iPhone Settings, then try again.")
    }

    private func finish(location: [String: Any]? = nil, error: String? = nil) {
        guard let requestID else { return }
        var result: [String: Any] = ["requestId": requestID]
        if let location { result["location"] = location }
        if let error { result["error"] = error }
        let callback = completion
        cancel(id: requestID)
        callback?(result)
    }
}


struct NativeConversationMenuItem {
    let key: String
    let title: String
    let unread: Bool
    let through: String?
    let runID: String?
    let messages: [[String: String]]
    let pinned: Bool
    let archived: Bool
    let enabled: Bool
    let rect: CGRect

    init?(_ payload: [String: Any], scale: CGFloat) {
        guard let key = payload["key"] as? String, !key.isEmpty, key.count <= 600,
              let title = payload["title"] as? String,
              let x = payload["x"] as? Double, let y = payload["y"] as? Double,
              let width = payload["width"] as? Double, let height = payload["height"] as? Double,
              [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
        self.key = key
        self.title = title
        unread = payload["unread"] as? Bool ?? false
        through = payload["through"] as? String
        runID = payload["runId"] as? String
        messages = (payload["preview"] as? [[String: String]] ?? []).filter { ["user", "agent"].contains($0["kind"] ?? "") && $0["text"] != nil }
        pinned = payload["pinned"] as? Bool ?? false
        archived = payload["archived"] as? Bool ?? false
        enabled = payload["enabled"] as? Bool ?? false
        rect = CGRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale)
    }
}

extension BrowserModel: UIContextMenuInteractionDelegate {
    func showMessageMenu(_ payload: [String: Any]) {
        guard state == .ready, !isModalOverlayVisible, !isBrowserViewerVisible, let key = payload["key"] as? String else { return }
        composerDismissal += 1
        messageMenus.show(key: key)
    }

    func updateConversationMenuItems(_ payload: [String: Any]) {
        conversationSwipeActive = payload["swipeActive"] as? Bool == true
        guard let width = payload["viewportWidth"] as? Double, width.isFinite, width > 0,
              let items = payload["items"] as? [[String: Any]] else { conversationMenuItems = []; return }
        let scale = webView.bounds.width / width
        conversationMenuItems = items.prefix(1000).compactMap { NativeConversationMenuItem($0, scale: scale) }
    }

    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
        guard state == .ready, !isModalOverlayVisible, !isBrowserViewerVisible else { return nil }
        if let configuration = messageMenus.configuration(at: location, interaction: interaction) {
            composerDismissal += 1
            return configuration
        }
        guard let item = conversationMenuItems.first(where: { $0.rect.contains(location) && $0.enabled }) else { return nil }
        composerDismissal += 1
        let rect = item.rect.intersection(webView.bounds)
        if let snapshot = webView.resizableSnapshotView(from: rect, afterScreenUpdates: false, withCapInsets: .zero) {
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(roundedRect: CGRect(origin: .zero, size: rect.size), cornerRadius: 20)
            conversationMenuPreview = UITargetedPreview(view: snapshot, parameters: parameters,
                target: UIPreviewTarget(container: webView, center: CGPoint(x: rect.midX, y: rect.midY)))
        }
        return UIContextMenuConfiguration(identifier: item.key as NSString, previewProvider: { [weak self] in
            let preview = ConversationPreviewController(title: item.title, messages: item.messages)
            if let runID = item.runID, let self {
                self.webView.callAsyncJavaScript("""
                    const response = await fetch('/api/runs/' + encodeURIComponent(runID) + '/messages', {cache: 'no-store'});
                    if (!response.ok) throw new Error('Preview unavailable');
                    const data = await response.json();
                    return data.items.filter(item => (item.kind === 'user' || item.kind === 'agent') && typeof item.text === 'string').slice(-12).map(item => ({kind: item.kind, text: item.text}));
                    """, arguments: ["runID": runID], in: nil, in: .page) { [weak preview] result in
                        switch result {
                        case .success(let value):
                            if let messages = value as? [[String: String]] { preview?.show(messages: messages) }
                        case .failure: preview?.showRefreshError()
                        }
                    }
            }
            return preview
        }) { [weak self] _ in
            let read = UIAction(title: item.unread ? "Mark as read" : "Mark as unread", image: UIImage(systemName: item.unread ? "envelope.open" : "envelope.badge")) { [weak self] _ in
                self?.pendingConversationAction = { [weak self] in self?.sendConversationAction(key: item.key, action: item.unread ? "read" : "unread", through: item.through ?? ISO8601DateFormatter().string(from: Date())) }
            }
            let pin = UIAction(title: item.pinned ? "Unpin" : "Pin", image: UIImage(systemName: item.pinned ? "pin.slash" : "pin")) { [weak self] _ in
                self?.pendingConversationAction = { [weak self] in self?.sendConversationAction(key: item.key, action: item.pinned ? "unpin" : "pin") }
            }
            let rename = UIAction(title: "Rename", image: UIImage(systemName: "pencil")) { [weak self] _ in
                self?.pendingConversationAction = { [weak self] in
                    self?.conversationRenameKey = item.key
                    self?.conversationRenameText = item.title
                    self?.isRenamingConversation = true
                }
            }
            let archive = UIAction(title: item.archived ? "Unarchive" : "Archive", image: UIImage(systemName: item.archived ? "tray.and.arrow.up" : "archivebox")) { [weak self] _ in
                self?.pendingConversationAction = { [weak self] in self?.sendConversationAction(key: item.key, action: item.archived ? "unarchive" : "archive") }
            }
            return UIMenu(children: [read, pin, rename, archive])
        }
    }

    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration) -> UITargetedPreview? { NativeMessageMenus.owns(configuration) ? messageMenus.preview : conversationMenuPreview }
    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration) -> UITargetedPreview? { NativeMessageMenus.owns(configuration) ? messageMenus.preview : conversationMenuPreview }
    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration, animator: (any UIContextMenuInteractionAnimating)?) {
        if NativeMessageMenus.owns(configuration) { messageMenus.willEnd(animator: animator); return }
        let completion = { [weak self] in
            let action = self?.pendingConversationAction
            self?.pendingConversationAction = nil
            self?.conversationMenuPreview = nil
            action?()
        }
        if let animator { animator.addCompletion(completion) } else { completion() }
    }
    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willPerformPreviewActionForMenuWith configuration: UIContextMenuConfiguration, animator: any UIContextMenuInteractionCommitAnimating) {
        guard !NativeMessageMenus.owns(configuration), let key = configuration.identifier as? String else { return }
        animator.addCompletion { [weak self] in self?.sendConversationAction(key: key, action: "open") }
    }
    func saveConversationName() {
        let title = conversationRenameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let key = conversationRenameKey, !title.isEmpty, title.count <= 120 else { return }
        sendConversationAction(key: key, action: "rename", title: title)
        conversationRenameKey = nil
        isRenamingConversation = false
    }
    private func sendConversationAction(key: String, action: String, title: String? = nil, through: String? = nil) {
        var payload: [String: Any] = ["key": key, "action": action]
        if let title { payload["title"] = title }
        if action == "read", let through { payload["through"] = through }
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('decisionFeed:conversationAction',{detail:\(json)}));")
    }
}


/// A read-only peek: loading messages never changes navigation or read receipts.
@MainActor
final class ConversationPreviewController: UIViewController {
    private let heading: String
    private var messages: [[String: String]]
    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private var previousSize = CGSize.zero

    init(title: String, messages: [[String: String]]) {
        heading = title
        self.messages = messages
        super.init(nibName: nil, bundle: nil)
        preferredContentSize = CGSize(width: 350, height: 390)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let header = UILabel()
        header.text = heading
        header.font = .preferredFont(forTextStyle: .headline)
        header.adjustsFontForContentSizeCategory = true
        header.textAlignment = .center
        header.numberOfLines = 2
        header.translatesAutoresizingMaskIntoConstraints = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 8
        view.addSubview(header)
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.topAnchor, constant: 18),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 18),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -18),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32)
        ])
        show(messages: messages)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if scroll.bounds.size != previousSize {
            previousSize = scroll.bounds.size
            scroll.setContentOffset(CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height)), animated: false)
        }
    }
    func show(messages: [[String: String]]) {
        self.messages = messages
        guard isViewLoaded else { return }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for message in messages.suffix(12) {
            guard let text = message["text"], ["user", "agent"].contains(message["kind"] ?? "") else { continue }
            let user = message["kind"] == "user"
            let row = UIView()
            let bubble = UIView()
            bubble.backgroundColor = user ? UIColor(red: 66 / 255, green: 179 / 255, blue: 250 / 255, alpha: 1) : .secondarySystemBackground
            bubble.layer.cornerRadius = 19
            let label = UILabel()
            label.text = text
            label.numberOfLines = 0
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
            label.textColor = user ? .white : .label
            bubble.translatesAutoresizingMaskIntoConstraints = false
            label.translatesAutoresizingMaskIntoConstraints = false
            row.addSubview(bubble)
            bubble.addSubview(label)
            NSLayoutConstraint.activate([
                bubble.topAnchor.constraint(equalTo: row.topAnchor), bubble.bottomAnchor.constraint(equalTo: row.bottomAnchor),
                bubble.widthAnchor.constraint(lessThanOrEqualTo: row.widthAnchor, multiplier: 0.9),
                user ? bubble.trailingAnchor.constraint(equalTo: row.trailingAnchor) : bubble.leadingAnchor.constraint(equalTo: row.leadingAnchor),
                label.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 11), label.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -11),
                label.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 14), label.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -14)
            ])
            stack.addArrangedSubview(row)
        }
        view.layoutIfNeeded()
        scroll.setContentOffset(CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height)), animated: false)
    }
    func showRefreshError() {
        loadViewIfNeeded()
        let label = UILabel()
        label.text = "Couldn’t refresh preview. Open conversation to try again."
        label.font = .preferredFont(forTextStyle: .caption1)
        label.textColor = .secondaryLabel
        label.numberOfLines = 0
        stack.addArrangedSubview(label)
    }
}

/// The web panel's presentation geometry in window points, shared with native chrome.
struct SheetCoverage: Equatable {
    let rect: CGRect
    let radius: CGFloat
    let opacity: Double
    let dimming: Double
    var headerOpacity: Double = 1

    init(rect: CGRect, radius: CGFloat, opacity: Double, dimming: Double) {
        self.rect = rect; self.radius = radius; self.opacity = opacity; self.dimming = dimming
    }

    init?(payload: [String: Any], webView: WKWebView) {
        func number(_ key: String) -> Double? {
            guard let value = payload[key] as? Double, value.isFinite else { return nil }
            return value
        }
        guard let x = number("x"), let y = number("y"),
              let width = number("width"), let height = number("height"),
              let viewport = number("viewportWidth"), viewport > 0, width >= 0, height >= 0,
              let radius = number("radius"), let opacity = number("opacity"), let dimming = number("dimming") else { return nil }
        let scale = webView.bounds.width / viewport
        rect = webView.convert(CGRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale), to: nil)
        self.radius = max(0, radius * scale)
        self.opacity = min(1, max(0, opacity))
        self.dimming = min(1, max(0, dimming))
        if let value = number("headerOpacity") { headerOpacity = min(1, max(0, value)) }
    }
}

/// Paints the departing text beneath native Liquid Glass. Geometry comes from the
/// actual destination bubble; timing samples are shared with the web renderer.
@MainActor
final class MessageSendFlightView: UIView {
    let token = UUID().uuidString
    private let surface = CAShapeLayer()
    private let gradient = CAGradientLayer()
    private let label = UILabel()
    private let source: CGRect
    private var target = CGRect.zero
    private var samples: [[Double]] = []
    private var padding: CGFloat = 14
    private var clock: CADisplayLink?
    private var startedAt: CFTimeInterval = 0
    private var verticalStartedAt: CFTimeInterval?
    private var lastFrameAt: CFTimeInterval?
    private var horizontalElapsed: Double = 0
    private var verticalElapsed: Double = 0
    private var duration: Double = 0.55
    private var completion: (() -> Void)?

    init(frame: CGRect, text: String, source: CGRect, samples: [[Double]] = []) {
        let height = max(44, source.height + 18)
        self.source = CGRect(x: source.minX - 16, y: source.midY - height / 2, width: source.width + 74, height: height)
        super.init(frame: frame)
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        surface.fillColor = UIColor.white.cgColor
        gradient.colors = [UIColor(BrandColor.send).cgColor, UIColor(BrandColor.send).cgColor]
        gradient.frame = bounds
        gradient.mask = surface
        layer.addSublayer(gradient)
        label.text = text
        label.font = .preferredFont(forTextStyle: .body)
        label.textColor = .white
        label.numberOfLines = 0
        addSubview(label)
        surface.path = UIBezierPath(roundedRect: self.source, cornerRadius: 22).cgPath
        label.frame = source
        if samples.count >= 2 {
            self.samples = samples
            let textWidth = (text as NSString).size(withAttributes: [.font: label.font!]).width
            let width = min(self.source.width, textWidth + padding * 2)
            target = CGRect(x: self.source.maxX - width, y: self.source.minY, width: width, height: self.source.height)
            startedAt = CACurrentMediaTime()
            startClock()
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // Keep the moving text crisp above the composer material while its blue
    // surface refracts underneath, as in the reference takeoff.
    func presentText(in host: UIView) {
        host.addSubview(label)
    }

    func fly(to target: CGRect, padding: Double, fontSize: Double, lineHeight: Double = 22, samples: [[Double]], colors: [[Double]], duration: Double, completion: @escaping () -> Void) {
        guard verticalStartedAt == nil, !samples.isEmpty else { return }
        self.target = target
        self.padding = padding
        self.samples = samples
        self.duration = duration
        self.completion = completion
        label.font = .systemFont(ofSize: fontSize)
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = lineHeight
        paragraph.maximumLineHeight = lineHeight
        paragraph.lineBreakMode = .byWordWrapping
        label.attributedText = NSAttributedString(string: label.text ?? "", attributes: [.font: label.font!, .foregroundColor: UIColor.white, .paragraphStyle: paragraph])
        // The sampled flight owns all motion. Core Animation's default color
        // interpolation otherwise adds a separate 250 ms transition at takeoff.
        CATransaction.begin(); CATransaction.setDisableActions(true)
        if colors.count == 2, colors.allSatisfy({ $0.count >= 3 && $0.allSatisfy(\.isFinite) }) {
            gradient.colors = colors.map { UIColor(red: $0[0] / 255, green: $0[1] / 255, blue: $0[2] / 255, alpha: 1).cgColor }
        }
        CATransaction.commit()
        let now = CACurrentMediaTime()
        if startedAt == 0 { startedAt = now }
        // The first 50 ms of vertical travel are stationary in the reference.
        // Consume that interval during the bridge round trip, without jumping
        // ahead if WebKit takes longer to mount the destination.
        verticalStartedAt = now
        verticalElapsed = min(horizontalElapsed, 0.05)
        if clock == nil { startClock() }
    }

    // Layout/scroll changes can move the DOM destination after takeoff. Keep
    // the current clock and completion; never land at the old screen position.
    func retarget(to target: CGRect) {
        guard verticalStartedAt != nil else { return }
        self.target = target
        paint(min(1, horizontalElapsed / duration), vertical: min(1, verticalElapsed / duration))
    }

    private func startClock() {
        let clock = CADisplayLink(target: self, selector: #selector(tick))
        clock.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        self.clock = clock
        clock.add(to: .main, forMode: .common)
        tick()
    }

    @objc private func tick() {
        let now = CACurrentMediaTime()
        // Keyboard/WebKit transactions can postpone presentation. Count the
        // frames we can display rather than jumping across unseen takeoff
        // samples when the main thread resumes after a stall.
        let delta = lastFrameAt.map { min(0.020, max(0, now - $0)) } ?? 0
        lastFrameAt = now
        horizontalElapsed += delta
        if verticalStartedAt != nil { verticalElapsed += delta }
        let horizontal = min(1, horizontalElapsed / duration)
        let vertical = min(1, verticalElapsed / duration)
        paint(horizontal, vertical: vertical)
        if verticalStartedAt != nil && vertical >= 1 {
            clock?.invalidate(); clock = nil
            let done = completion; completion = nil; done?()
        }
    }

    private func paint(_ progress: Double, vertical: Double) {
        func sample(_ column: Int) -> CGFloat {
            let index = (column == 0 ? progress : vertical) * Double(samples.count - 1)
            let lo = min(samples.count - 1, Int(index)), hi = min(samples.count - 1, lo + 1)
            let mix = index - Double(lo)
            return CGFloat(samples[lo][column] + (samples[hi][column] - samples[lo][column]) * mix)
        }
        let x = sample(0), y = min(1, max(0, sample(1))), squash = sample(2)
        let deltaY = target.minY - source.minY
        let top = source.minY + deltaY * y
        let rect = CGRect(x: source.minX + (target.minX - source.minX) * x,
                          y: top,
                          width: max(target.width * 0.6, source.width + (target.width - source.width) * x),
                          height: (source.height + (target.height - source.height) * y) * squash)
        let path = UIBezierPath(roundedRect: rect, cornerRadius: min(20, rect.height / 2))
        if vertical > 0.18 {
            let tail = UIBezierPath()
            tail.move(to: CGPoint(x: 7, y: 0))
            tail.addLine(to: CGPoint(x: 14, y: 0))
            tail.addLine(to: CGPoint(x: 14, y: 12))
            tail.addCurve(to: CGPoint(x: 0, y: 16), controlPoint1: CGPoint(x: 10, y: 14), controlPoint2: CGPoint(x: 6, y: 16))
            tail.addCurve(to: CGPoint(x: 5, y: 8), controlPoint1: CGPoint(x: 4, y: 14), controlPoint2: CGPoint(x: 5, y: 12))
            tail.addCurve(to: CGPoint(x: 7, y: 0), controlPoint1: CGPoint(x: 5, y: 4), controlPoint2: CGPoint(x: 6, y: 2))
            tail.apply(CGAffineTransform(a: -0.85, b: 0, c: 0, d: 0.85, tx: rect.maxX + 1.95, ty: rect.maxY - 13.6))
            tail.close()
            // Mirroring flips the tail winding. Match the rounded body's winding
            // so the nonzero mask fills their overlap instead of punching a hole.
            path.append(tail.reversing())
        }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        surface.path = path.cgPath
        gradient.startPoint = CGPoint(x: 0.5, y: rect.minY / max(1, bounds.height))
        gradient.endPoint = CGPoint(x: 0.5, y: rect.maxY / max(1, bounds.height))
        label.transform = .identity
        let textWidth = max(1, target.width - padding * 2)
        label.bounds = CGRect(x: 0, y: 0, width: textWidth, height: target.height)
        let scaleX = min(1, max(0.6, (rect.width - padding * 2) / textWidth))
        label.center = CGPoint(x: rect.minX + padding + textWidth * scaleX / 2, y: rect.midY)
        label.transform = CGAffineTransform(scaleX: scaleX, y: squash)
        CATransaction.commit()
    }

    override func removeFromSuperview() {
        clock?.invalidate(); clock = nil; completion = nil
        label.removeFromSuperview()
        super.removeFromSuperview()
    }
}

struct NativeChromeFrame: Equatable {
    var departingComposerOffset: CGFloat = 0
    var composerClip: CGFloat = 10000
    var departingComposerClip: CGFloat = 10000
    var composerOpacity: Double = 1
    var departingComposerOpacity: Double = 1
    var composerOffset: CGFloat = 0
}
