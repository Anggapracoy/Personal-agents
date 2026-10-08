import Combine
import CoreLocation
import CryptoKit
import Security
import XCTest
import UIKit
import UserNotifications
import WebKit
@testable import DecisionFeed

final class CompatibilityTests: XCTestCase {
    @MainActor
    func testDarkPhotoOverlayPreservesAndRestoresTheSelectedAppearance() {
        let key = BrowserModel.appearancePreferenceKey
        let previous = UserDefaults.standard.object(forKey: key)
        defer {
            if let previous { UserDefaults.standard.set(previous, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        let model = BrowserModel()
        model.handleAppearanceState(["appearance": "light", "preference": "light"])
        model.handleModalOverlayVisibility(["visible": true, "appearance": "dark"])
        XCTAssertTrue(model.modalPrefersDarkAppearance)
        XCTAssertEqual(model.preferredColorScheme, .light)
        model.handleModalOverlayVisibility(["visible": false])
        XCTAssertFalse(model.modalPrefersDarkAppearance)
        XCTAssertEqual(model.preferredColorScheme, .light)
        model.handleAppearanceState(["appearance": "dark", "preference": "dark"])
        model.handleModalOverlayVisibility(["visible": true])
        XCTAssertFalse(model.modalPrefersDarkAppearance)
        XCTAssertEqual(model.preferredColorScheme, .dark)
    }

    @MainActor
    func testLoadingAppearanceRestoresSavedPreferenceBeforeWebHydration() {
        let key = BrowserModel.appearancePreferenceKey
        let previous = UserDefaults.standard.object(forKey: key)
        defer {
            if let previous { UserDefaults.standard.set(previous, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }

        UserDefaults.standard.set("dark", forKey: key)
        let model = BrowserModel()
        XCTAssertEqual(model.preferredColorScheme, .dark)
        model.handleAppearanceState(["appearance": "light"])
        XCTAssertEqual(model.preferredColorScheme, .dark)
        model.handleAppearanceState(["appearance": "light", "preference": "system"])
        XCTAssertNil(model.preferredColorScheme)
        XCTAssertNil(BrowserModel().preferredColorScheme)
    }

    func testNotificationReplyUsesSystemTextInputWithoutForegrounding() throws {
        let category = try XCTUnwrap(NotificationReplyActions.categories().first { $0.identifier == "conversation.reply" })
        let action = try XCTUnwrap(category.actions.first as? UNTextInputNotificationAction)
        XCTAssertEqual(action.title, "Reply")
        XCTAssertEqual(action.textInputButtonTitle, "Send")
        XCTAssertEqual(action.textInputPlaceholder, "Message…")
        XCTAssertFalse(action.options.contains(.foreground))
        XCTAssertTrue(action.options.contains(.authenticationRequired))
        let failure = try XCTUnwrap(NotificationReplyActions.categories().first { $0.identifier == NotificationReplyActions.failureCategory })
        XCTAssertEqual(failure.actions.map(\.identifier), [NotificationReplyActions.retry, NotificationReplyActions.open])
    }

    func testNotificationReplyValidatesTargetAndRetainsRetryIdentity() throws {
        let info: [AnyHashable: Any] = ["notificationKind": "run_completion", "runId": UUID().uuidString, "replyAccountKey": String(repeating: "a", count: 64)]
        let reply = try XCTUnwrap(NotificationReply(userInfo: info, text: "  Dinner for two  ", notificationID: "delivery-1"))
        XCTAssertEqual(reply.text, "Dinner for two")
        XCTAssertEqual(reply.runId, info["runId"] as? String)
        XCTAssertNil(reply.decisionId)
        XCTAssertEqual(reply, NotificationReply(userInfo: info, text: "Dinner for two", notificationID: "delivery-1"))
        XCTAssertEqual(reply, try JSONDecoder().decode(NotificationReply.self, from: JSONEncoder().encode(reply)))
        XCTAssertNotEqual(reply.eventId, NotificationReply(userInfo: info, text: "Dinner for three", notificationID: "delivery-1")?.eventId)
        XCTAssertNil(NotificationReply(userInfo: info, text: "  ", notificationID: "delivery-1"))
        XCTAssertNil(NotificationReply(userInfo: info, text: String(repeating: "a", count: 16_001), notificationID: "delivery-1"))
        var invalid = info
        invalid["runId"] = "../other"
        XCTAssertNil(NotificationReply(userInfo: invalid, text: "Hello", notificationID: "delivery-1"))
        let suggestion = try XCTUnwrap(NotificationReply(userInfo: ["notificationKind": "decision", "decisionId": "dinner-suggestion", "replyAccountKey": String(repeating: "a", count: 64)], text: "Tomorrow", notificationID: "delivery-2"))
        XCTAssertEqual(suggestion.decisionId, "dinner-suggestion")
        XCTAssertNil(suggestion.runId)
    }

    @MainActor
    func testNotificationReplySendsAuthenticatedRequestAndRequiresServerReceipt() async throws {
        let baseURL = URL(string: "https://dash.example")!
        let reply = try XCTUnwrap(NotificationReply(userInfo: ["notificationKind": "run_attention", "runId": UUID().uuidString, "replyAccountKey": String(repeating: "b", count: 64)], text: "Tomorrow please", notificationID: "delivery-3"))
        let session = try XCTUnwrap(HTTPCookie(properties: [.domain: "dash.example", .path: "/", .name: "decision-feed.session-token", .value: "owned-session", .secure: "TRUE"]))
        let unrelated = try XCTUnwrap(HTTPCookie(properties: [.domain: "other.example", .path: "/", .name: "other", .value: "do-not-send"]))
        let expired = try XCTUnwrap(HTTPCookie(properties: [.domain: "dash.example", .path: "/", .name: "old", .value: "expired", .expires: Date(timeIntervalSince1970: 1)]))
        try await NotificationReplyService.send(reply, baseURL: baseURL, cookies: [session, unrelated, expired]) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://dash.example/api/mobile/notification-reply")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "decision-feed.session-token=owned-session")
            XCTAssertEqual(try JSONDecoder().decode(NotificationReply.self, from: XCTUnwrap(request.httpBody)), reply)
            return (Data("{\"accepted\":true}".utf8), HTTPURLResponse(url: baseURL, statusCode: 202, httpVersion: nil, headerFields: nil)!)
        }
        XCTAssertThrowsError(try NotificationReplyService.request(reply, baseURL: baseURL, cookies: [unrelated]))
        for status in [200, 401, 403, 503] {
            do {
                try await NotificationReplyService.send(reply, baseURL: baseURL, cookies: [session]) { _ in
                    (Data("{}".utf8), HTTPURLResponse(url: baseURL, statusCode: status, httpVersion: nil, headerFields: nil)!)
                }
                XCTFail("HTTP \(status) must not silently accept a failed send")
            } catch {
                XCTAssertEqual(error as? NotificationReplyError, status == 401 || status == 403 ? .signIn : .unavailable)
            }
        }
    }

    @MainActor
    func testNotificationReplySurvivesColdBackgroundLaunchWithoutWebKit() async throws {
        let baseURL = URL(string: "https://notification-test.example")!
        defer { NotificationReplySessionStore.clear(baseURL: baseURL) }
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.domain: "notification-test.example", .path: "/", .name: "decision-feed.session-token", .value: "test-session", .secure: "TRUE"]))
        let expires = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
        let data = try JSONSerialization.data(withJSONObject: ["user": ["email": "Test@Example.com"], "expires": expires])
        let session = try XCTUnwrap(NotificationReplySession.verified(data: data, cookies: [cookie], baseURL: baseURL))
        try NotificationReplySessionStore.save(session, baseURL: baseURL)
        let restored = try XCTUnwrap(NotificationReplySessionStore.read(baseURL: baseURL))
        let reply = try XCTUnwrap(NotificationReply(userInfo: ["notificationKind": "run_attention", "runId": UUID().uuidString, "replyAccountKey": restored.accountKey], text: "Tomorrow", notificationID: "cold-start"))
        try await NotificationReplyService.sendInBackground(reply, baseURL: baseURL, cookies: {
            XCTFail("Background reply must not require WebKit or opening the app")
            return []
        }, transport: { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "decision-feed.session-token=test-session")
            return (Data("{\"accepted\":true}".utf8), HTTPURLResponse(url: baseURL, statusCode: 202, httpVersion: nil, headerFields: nil)!)
        })
        XCTAssertFalse(restored.matches(reply, baseURL: URL(string: "https://other.example")!))
        let otherReply = try XCTUnwrap(NotificationReply(userInfo: ["notificationKind": "run_attention", "runId": UUID().uuidString, "replyAccountKey": String(repeating: "a", count: 64)], text: "Hello", notificationID: "other-account"))
        XCTAssertFalse(restored.matches(otherReply, baseURL: baseURL))
        let expired = NotificationReplySession(origin: restored.origin, accountKey: restored.accountKey, cookieHeader: restored.cookieHeader, expiresAt: .distantPast)
        XCTAssertThrowsError(try NotificationReplyService.request(reply, baseURL: baseURL, cookies: [], session: expired))
        NotificationReplySessionStore.clear(baseURL: baseURL)
        XCTAssertNil(NotificationReplySessionStore.read(baseURL: baseURL))
        do {
            try await NotificationReplyService.sendInBackground(reply, baseURL: baseURL, cookies: { [] }, transport: { _ in
                XCTFail("Signing out must prevent sending with the saved session")
                throw NotificationReplyError.unavailable
            })
            XCTFail("Signed-out replies require authentication")
        } catch { XCTAssertEqual(error as? NotificationReplyError, .signIn) }
    }

    func testHomeHeaderValidatesControlFramesAndActions() throws {
        let search: [String: Any] = ["action": "search", "label": "Search conversations", "x": 300.0, "y": 64.0, "width": 44.0, "height": 44.0]
        var archive = search; archive["action"] = "archive"
        var payload: [String: Any] = ["id": "home", "buttons": [archive, search]]
        let state = try XCTUnwrap(NativeHomeHeaderState(payload: payload))
        XCTAssertEqual(state.buttons.map(\.id), ["archive", "search"])
        payload["buttons"] = [search, search]
        XCTAssertNil(NativeHomeHeaderState(payload: payload))
        archive["x"] = Double.nan
        payload["buttons"] = [archive, search]
        XCTAssertNil(NativeHomeHeaderState(payload: payload))
        archive["x"] = 16.0; archive["action"] = "back"
        payload["buttons"] = [archive, search]; payload["archived"] = true
        XCTAssertNotNil(NativeHomeHeaderState(payload: payload))
    }

    func testCameraPermissionDescriptionIsBundled() {
        let description = Bundle(for: BrowserModel.self).object(forInfoDictionaryKey: "NSCameraUsageDescription") as? String
        XCTAssertFalse(description?.isEmpty ?? true, "iOS terminates camera capture without a purpose string")
    }

    @MainActor
    func testBackSwipeCoexistsWithTouchDeliveryButOwnsNestedScrollPans() throws {
        let model = BrowserModel()
        let back = try XCTUnwrap(model.webView.gestureRecognizers?.first { $0 is UIPanGestureRecognizer })
        let nested = UIScrollView()
        model.webView.scrollView.addSubview(nested)
        let touchDelivery = UIGestureRecognizer()
        XCTAssertTrue(model.gestureRecognizer(back, shouldRecognizeSimultaneouslyWith: touchDelivery))
        XCTAssertFalse(model.gestureRecognizer(back, shouldRecognizeSimultaneouslyWith: nested.panGestureRecognizer))
        XCTAssertTrue(model.gestureRecognizer(back, shouldBeRequiredToFailBy: nested.panGestureRecognizer))
        XCTAssertFalse(model.gestureRecognizer(back, shouldBeRequiredToFailBy: UIScrollView().panGestureRecognizer))
    }

    @MainActor
    func testKeyboardDismissalReachesNestedConversationScrollViews() {
        let webView = WKWebView()
        let content = UIView()
        let conversation = UIScrollView()
        let nestedContent = UIView()
        let codeBlock = UIScrollView()
        webView.scrollView.addSubview(content)
        content.addSubview(conversation)
        conversation.addSubview(nestedContent)
        nestedContent.addSubview(codeBlock)
        conversation.isScrollEnabled = true
        conversation.alwaysBounceVertical = true

        BrowserModel.configureKeyboardDismissal(in: webView)

        XCTAssertEqual(webView.scrollView.keyboardDismissMode, .interactive)
        XCTAssertEqual(conversation.keyboardDismissMode, .interactive)
        XCTAssertEqual(codeBlock.keyboardDismissMode, .interactive)
        XCTAssertTrue(conversation.isScrollEnabled)
        XCTAssertTrue(conversation.alwaysBounceVertical)
    }

    @MainActor
    func testConnectorCompletionOnlyClosesMatchingSignInSheet() {
        let model = BrowserModel()
        let signIn = URL(string: "https://connect.composio.dev/link/one")!
        model.openLink(signIn)
        model.closeConnectorBrowser(url: "https://connect.composio.dev/link/other")
        XCTAssertEqual(model.browserLink?.url, signIn)
        model.closeConnectorBrowser(url: signIn.absoluteString)
        XCTAssertNil(model.browserLink)
        for value in ["https://example.com", "https://composio.dev.evil.com/link", "http://connect.composio.dev/link"] {
            let url = URL(string: value)!
            model.openLink(url)
            model.closeConnectorBrowser(url: value)
            XCTAssertEqual(model.browserLink?.url, url)
        }
    }

    @MainActor
    func testOrdinaryLinksStayInAppAndSpecialLinksKeepNativeDestinations() throws {
        XCTAssertEqual(BrowserModel.linkDestination(for: URL(string: "https://www.lartusi.com/menu")!), .browser)
        XCTAssertEqual(BrowserModel.linkDestination(for: URL(string: "http://example.com/")!), .browser)
        for value in ["tel:+14165550123", "mailto:hello@example.com", "https://maps.apple.com/?q=dinner", "https://apps.apple.com/app/id123"] {
            XCTAssertEqual(BrowserModel.linkDestination(for: URL(string: value)!), .external)
        }
        for value in ["javascript:alert(1)", "data:text/html,test", "file:///private/test"] {
            XCTAssertEqual(BrowserModel.linkDestination(for: URL(string: value)!), .blocked)
        }
        let model = BrowserModel()
        let webView = model.webView
        let url = URL(string: "https://www.lartusi.com/")!
        model.openLink(url)
        XCTAssertEqual(model.browserLink?.url, url)
        XCTAssertTrue(model.webView === webView)
        XCTAssertNil(model.webView.url, "Opening a browser must not navigate the workspace web view")
        model.browserLink = nil
        XCTAssertTrue(model.webView === webView)
        XCTAssertNil(model.webView.url)
    }

    @MainActor
    func testSameHostLinksOpenBrowserWithoutReplacingWorkspace() async throws {
        let model = BrowserModel()
        let coordinator = try XCTUnwrap(model.webView.navigationDelegate as? WebCoordinator)
        let loaded = expectation(description: "Workspace fixture loaded")
        let observer = LinkNavigationObserver(coordinator: coordinator, loaded: loaded)
        model.webView.navigationDelegate = observer
        let baseURL = model.configuration.baseURL
        model.webView.loadHTMLString("""
        <html><body><p id="workspace">Conversation stays here</p>
        <a id="privacy" href="/privacy" target="_blank">Privacy</a>
        <a id="terms" href="/terms">Terms</a></body></html>
        """, baseURL: baseURL)
        await fulfillment(of: [loaded], timeout: 10)
        let workspaceURL = model.webView.url
        XCTAssertNil(model.browserLink, "Initial programmatic loading must stay in the workspace")
        for path in ["privacy", "terms"] {
            let opened = expectation(description: "Browser opened for \(path)")
            let target = baseURL.appending(path: path)
            let subscription = model.$browserLink.dropFirst().sink { link in
                if link?.url == target { opened.fulfill() }
            }
            _ = try await model.webView.evaluateJavaScript("document.getElementById('\(path)').click()")
            await fulfillment(of: [opened], timeout: 10)
            subscription.cancel()
            XCTAssertEqual(model.browserLink?.url, target)
            XCTAssertEqual(model.webView.url, workspaceURL)
            let text = try await model.webView.evaluateJavaScript("document.getElementById('workspace').textContent") as? String
            XCTAssertEqual(text, "Conversation stays here")
            model.browserLink = nil
        }
    }

    @MainActor
    func testNotificationConversationWaitsForWorkspaceAndUsesRawRunID() async {
        let model = BrowserModel()
        let opened = expectation(description: "Notification opens its conversation after startup")
        let observer = NotificationNavigationObserver { url in
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "task" })?.value, "notification-run")
            XCTAssertNil(query?.first(where: { $0.name == "entry" }))
            opened.fulfill()
        }
        model.webView.navigationDelegate = observer
        model.enqueueRunningTask(runID: "notification-run")
        XCTAssertNil(model.webView.url, "A cold-start tap must not race bootstrap")
        model.workspaceDidBecomeReady(payload: [:])
        await fulfillment(of: [opened], timeout: 5)
    }

    @MainActor
    func testLatestNotificationDestinationWinsDuringStartup() async {
        let model = BrowserModel()
        let opened = expectation(description: "Latest notification opens")
        let observer = NotificationNavigationObserver { url in
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "decision" })?.value, "latest-decision")
            XCTAssertNil(query?.first(where: { $0.name == "task" }))
            opened.fulfill()
        }
        model.webView.navigationDelegate = observer
        model.enqueueRunningTask(runID: "older-run")
        model.enqueueFeedDecision(decisionID: "latest-decision")
        XCTAssertNil(model.webView.url)
        model.workspaceDidBecomeReady(payload: [:])
        await fulfillment(of: [opened], timeout: 5)
    }

    @MainActor
    func testSheetCoverageConvertsViewportToWindowAndRejectsInvalidGeometry() throws {
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        var payload: [String: Any] = ["x": 0.0, "y": 200.0, "width": 200.0, "height": 300.0,
                                      "viewportWidth": 200.0, "radius": 24.0, "opacity": 1.0, "dimming": 0.2]
        let coverage = try XCTUnwrap(SheetCoverage(payload: payload, webView: webView))
        XCTAssertEqual(coverage.rect.minY, 400)
        XCTAssertEqual(coverage.rect.width, 400)
        XCTAssertEqual(coverage.radius, 48)
        XCTAssertEqual(coverage.dimming, 0.2)
        XCTAssertEqual(coverage.headerOpacity, 1)
        payload["headerOpacity"] = 0.25
        XCTAssertEqual(try XCTUnwrap(SheetCoverage(payload: payload, webView: webView)).headerOpacity, 0.25)
        payload["headerOpacity"] = 2.0
        XCTAssertEqual(try XCTUnwrap(SheetCoverage(payload: payload, webView: webView)).headerOpacity, 1)
        payload["y"] = Double.nan
        XCTAssertNil(SheetCoverage(payload: payload, webView: webView))
        payload["y"] = 200.0
        payload["viewportWidth"] = 0.0
        XCTAssertNil(SheetCoverage(payload: payload, webView: webView))
    }

    @MainActor
    func testBrowserSheetRetainsUncoveredChromeButFullModalHidesIt() {
        let model = BrowserModel()
        model.handleModalOverlayVisibility(["visible": true, "keepsBackgroundChrome": true])
        model.handleBrowserViewerVisibility(["visible": true])
        XCTAssertFalse(model.hidesBackgroundChrome)
        model.handleModalOverlayVisibility(["visible": true, "keepsBackgroundChrome": false])
        XCTAssertTrue(model.hidesBackgroundChrome)
        model.handleBrowserViewerVisibility(["visible": false])
        model.handleModalOverlayVisibility(["visible": false])
        XCTAssertFalse(model.hidesBackgroundChrome)
    }

    @MainActor
    func testSheetCoverageClearsAfterEitherVisibilityMessageOrder() {
        for browserFirst in [true, false] {
            let model = BrowserModel()
            model.handleModalOverlayVisibility(["visible": true])
            model.handleBrowserViewerVisibility(["visible": true])
            model.handleSheetCoverage(["ended": true])
            XCTAssertNotNil(model.sheetCoverage)
            if browserFirst {
                model.handleBrowserViewerVisibility(["visible": false])
                model.handleModalOverlayVisibility(["visible": false])
            } else {
                model.handleModalOverlayVisibility(["visible": false])
                model.handleBrowserViewerVisibility(["visible": false])
            }
            XCTAssertNil(model.sheetCoverage)
            model.handleSheetCoverage(["ended": true])
            XCTAssertNil(model.sheetCoverage)
        }
    }

    @MainActor
    func testBackSwipeKeepsVerticalScrollingAndOppositeGestures() {
        XCTAssertTrue(BrowserModel.shouldBeginWorkspaceBackSwipe(x: 700, y: 80, fromRight: false))
        XCTAssertFalse(BrowserModel.shouldBeginWorkspaceBackSwipe(x: 80, y: 700, fromRight: false))
        XCTAssertFalse(BrowserModel.shouldBeginWorkspaceBackSwipe(x: -700, y: 0, fromRight: false))
        XCTAssertTrue(BrowserModel.shouldBeginWorkspaceBackSwipe(x: -700, y: 80, fromRight: true))
        XCTAssertFalse(BrowserModel.shouldBeginWorkspaceBackSwipe(x: 0, y: 0, fromRight: false))
    }

    func testWrapperVersionWithinSupportedRange() {
        let configuration = MobileWebConfiguration(minWrapperVersion: 1, maxWrapperVersion: 2, webBuildId: "test")
        XCTAssertTrue(MobileCompatibility.supports(wrapperVersion: 1, configuration: configuration))
        XCTAssertTrue(MobileCompatibility.supports(wrapperVersion: 2, configuration: configuration))
    }

    func testWrapperVersionOutsideSupportedRange() {
        let configuration = MobileWebConfiguration(minWrapperVersion: 2, maxWrapperVersion: 3, webBuildId: "test")
        XCTAssertFalse(MobileCompatibility.supports(wrapperVersion: 1, configuration: configuration))
        XCTAssertFalse(MobileCompatibility.supports(wrapperVersion: 4, configuration: configuration))
    }

    func testWorkspaceLoadRetriesOnceThenFailsClosed() {
        XCTAssertEqual(WorkspaceLoadRecovery.action(afterAttempt: 1), .retry)
        XCTAssertEqual(WorkspaceLoadRecovery.action(afterAttempt: 2), .fail)
        XCTAssertEqual(WorkspaceLoadRecovery.maximumAttempts, 2)
        XCTAssertEqual(WorkspaceLoadRecovery.readyTimeoutNanoseconds, 15_000_000_000)
    }

    func testMockDeviceVaultEnvelopeCanOnlyBeOpenedWithRecipientPrivateKey() throws {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 3072,
        ]
        var keyError: Unmanaged<CFError>?
        let privateKey = try XCTUnwrap(SecKeyCreateRandomKey(attributes as CFDictionary, &keyError))
        let publicKey = try XCTUnwrap(SecKeyCopyPublicKey(privateKey))
        var exportError: Unmanaged<CFError>?
        let publicData = try XCTUnwrap(SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data?)
        let mock = try DeviceVaultSecret.login(username: "mock@example.test", password: "mock-password-never-for-the-model")

        let envelope = try DeviceVaultEncryption.seal(mock, recipientPublicKey: publicData.base64EncodedString())
        var decryptError: Unmanaged<CFError>?
        let wrappedKey = try XCTUnwrap(Data(base64Encoded: envelope.encryptedKey))
        let rawKey = try XCTUnwrap(SecKeyCreateDecryptedData(privateKey, .rsaEncryptionOAEPSHA256, wrappedKey as CFData, &decryptError) as Data?)
        let combined = try XCTUnwrap(Data(base64Encoded: envelope.sealed))
        let clear = try AES.GCM.open(try AES.GCM.SealedBox(combined: combined), using: SymmetricKey(data: rawKey))

        XCTAssertEqual(try JSONDecoder().decode(DeviceVaultSecret.self, from: clear), mock)
        XCTAssertFalse(envelope.sealed.contains("mock-password"))
    }
}


private final class TestLocationManager: CLLocationManager {
    var permission: CLAuthorizationStatus = .authorizedWhenInUse
    var requestedFixes = 0
    override var authorizationStatus: CLAuthorizationStatus { permission }
    override func requestLocation() { requestedFixes += 1 }
    override func stopUpdatingLocation() {}
}

extension CompatibilityTests {
    @MainActor
    func testSharedLocationReturnsOneFixWithCoordinatesAccuracyAndTime() async {
        let manager = TestLocationManager()
        let provider = SharedLocationProvider(manager: manager)
        var results: [[String: Any]] = []
        provider.request(id: "one-shot") { results.append($0) }
        XCTAssertEqual(manager.requestedFixes, 1)
        let fix = CLLocation(coordinate: CLLocationCoordinate2D(latitude: 43.6532, longitude: -79.3832), altitude: 0, horizontalAccuracy: 25, verticalAccuracy: -1, timestamp: Date())
        provider.locationManager(manager, didUpdateLocations: [fix])
        provider.locationManager(manager, didUpdateLocations: [fix])
        XCTAssertEqual(results.count, 1)
        let location = results.first?["location"] as? [String: Any]
        XCTAssertEqual(location?["latitude"] as? Double, 43.6532)
        XCTAssertEqual(location?["accuracy"] as? Double, 25)
        XCTAssertNotNil(location?["capturedAt"] as? String)
    }

    @MainActor
    func testCancelledLocationIgnoresLateFixAndDeniedAccessDoesNotLocate() async {
        let manager = TestLocationManager()
        let provider = SharedLocationProvider(manager: manager)
        var results: [[String: Any]] = []
        provider.request(id: "cancelled") { results.append($0) }
        provider.cancel(id: "cancelled")
        provider.locationManager(manager, didUpdateLocations: [CLLocation(latitude: 43, longitude: -79)])
        XCTAssertTrue(results.isEmpty)
        manager.permission = .denied
        provider.request(id: "denied") { results.append($0) }
        XCTAssertEqual(manager.requestedFixes, 1)
        XCTAssertNotNil(results.first?["error"] as? String)
        XCTAssertNil(results.first?["location"])
    }

    @MainActor
    func testSharedLocationRejectsStaleFix() async {
        let manager = TestLocationManager()
        let provider = SharedLocationProvider(manager: manager)
        var result: [String: Any]?
        provider.request(id: "stale") { result = $0 }
        let fix = CLLocation(coordinate: CLLocationCoordinate2D(latitude: 43, longitude: -79), altitude: 0, horizontalAccuracy: 10, verticalAccuracy: -1, timestamp: Date(timeIntervalSinceNow: -120))
        provider.locationManager(manager, didUpdateLocations: [fix])
        XCTAssertNotNil(result?["error"])
        XCTAssertNil(result?["location"])
    }
}

extension CompatibilityTests {
    @MainActor
    func testNativeSendContractsBeforeDestinationArrives() async throws {
        let flight = MessageSendFlightView(frame: CGRect(x: 0, y: 0, width: 402, height: 874), text: "Heyyy", source: CGRect(x: 88, y: 500, width: 240, height: 22), samples: [[0, 0, 1], [1, 1, 1]])
        defer { flight.removeFromSuperview() }
        let mask = try XCTUnwrap(flight.layer.sublayers?.first?.mask as? CAShapeLayer)
        let initial = try XCTUnwrap(mask.path).boundingBoxOfPath
        try await Task.sleep(for: .milliseconds(120))
        let contracted = try XCTUnwrap(mask.path).boundingBoxOfPath
        XCTAssertLessThan(contracted.width, initial.width - 1, "Even one presented frame must start contraction without a web round trip")
        XCTAssertEqual(contracted.minY, initial.minY, accuracy: 0.1, "Vertical travel waits for a real destination")
        var landed = false
        flight.fly(to: CGRect(x: 300, y: 250, width: 76, height: 40), padding: 12, fontSize: 17, samples: [[0, 0, 1], [1, 1, 1]], colors: [], duration: 0.55) { landed = true }
        try await Task.sleep(for: .milliseconds(650))
        XCTAssertTrue(landed)
        let final = try XCTUnwrap(mask.path).boundingBoxOfPath
        XCTAssertEqual(final.minY, 250, accuracy: 0.1)
        XCTAssertEqual(final.maxX, 377.95, accuracy: 0.1, "The restored tail extends 1.95 pt past the destination bubble body")
    }

    @MainActor
    func testSendRetargetsWithoutRestartingOrLandingAboveMovedMessage() async throws {
        let flight = MessageSendFlightView(frame: CGRect(x: 0, y: 0, width: 402, height: 874), text: "Reply", source: CGRect(x: 88, y: 600, width: 240, height: 22))
        defer { flight.removeFromSuperview() }
        let mask = try XCTUnwrap(flight.layer.sublayers?.first?.mask as? CAShapeLayer)
        var completions = 0
        flight.fly(to: CGRect(x: 300, y: 250, width: 76, height: 40), padding: 12, fontSize: 17, samples: [[0,0,1],[1,1,1]], colors: [], duration: 0.3) { completions += 1 }
        try await Task.sleep(for: .milliseconds(100))
        flight.retarget(to: CGRect(x: 300, y: 340, width: 76, height: 40))
        for _ in 0..<25 {
            try await Task.sleep(for: .milliseconds(16))
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(mask.path).boundingBoxOfPath.minY, 340 - 0.1)
        }
        XCTAssertEqual(completions, 1)
        XCTAssertEqual(try XCTUnwrap(mask.path).boundingBoxOfPath.minY, 340, accuracy: 0.1)
    }

    @MainActor
    func testDelayedFirstDisplayFrameDoesNotSkipSendTakeoff() throws {
        let flight = MessageSendFlightView(frame: CGRect(x: 0, y: 0, width: 402, height: 874), text: "Heyyy", source: CGRect(x: 88, y: 500, width: 240, height: 22), samples: [[0, 0, 1], [1, 1, 1]])
        defer { flight.removeFromSuperview() }
        let mask = try XCTUnwrap(flight.layer.sublayers?.first?.mask as? CAShapeLayer)
        let initial = try XCTUnwrap(mask.path).boundingBoxOfPath
        // Reproduce a keyboard transaction blocking the first presentation.
        Thread.sleep(forTimeInterval: 0.2)
        flight.perform(NSSelectorFromString("tick"))
        let next = try XCTUnwrap(mask.path).boundingBoxOfPath
        XCTAssertGreaterThan(next.width, initial.width * 0.9, "An unseen 200 ms interval must not consume the takeoff")
        XCTAssertLessThan(next.width, initial.width, "The first presented frame must still advance")
    }

    @MainActor
    func testComposerMovesWithNavigationBeforeDestinationMounts() {
        let model = BrowserModel()
        model.updateComposer(["id": "home", "variant": "home", "value": "Draft"])
        model.navigationPushing = true
        model.updateNavigationFrame(["phase": "begin"])
        model.updateNavigationFrame(["phase": "frame", "incoming": 200.0, "outgoing": -56.0])
        XCTAssertNil(model.composer)
        XCTAssertEqual(model.departingComposer?.text, "Draft")
        XCTAssertEqual(model.departingComposerOffset, -56)
        XCTAssertEqual(model.departingComposerClip, 200)
        model.updateComposer(["id": "task", "variant": "thread"])
        XCTAssertEqual(model.composerOffset, 200, "Mounting must not reset the animated position")
        model.updateNavigationFrame(["phase": "end"])
        XCTAssertNil(model.departingComposer)
        XCTAssertEqual(model.composerOffset, 0)
    }

    @MainActor
    func testRapidNativeSendsDoNotLetOldFlightCancellationRemoveNewFlight() throws {
        let model = BrowserModel()
        let host = UIView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        model.sendFlightHost = host
        let textHost = UIView(frame: host.bounds)
        model.sendFlightTextHost = textHost
        model.updateComposer(["id": "chat", "variant": "thread", "value": "First", "sendFlightSupported": true])
        model.sendComposer("First", origin: CGRect(x: 88, y: 500, width: 240, height: 22))
        let first = try XCTUnwrap(host.subviews.first as? MessageSendFlightView)
        model.sendComposer("Second", origin: CGRect(x: 88, y: 500, width: 240, height: 22))
        let second = try XCTUnwrap(host.subviews.first as? MessageSendFlightView)
        XCTAssertNotEqual(first.token, second.token)
        XCTAssertEqual(host.subviews.count, 1)
        XCTAssertEqual(textHost.subviews.count, 1)
        XCTAssertEqual((textHost.subviews.first as? UILabel)?.text, "Second")
        model.updateSendFlight(["cancel": true, "token": first.token])
        XCTAssertTrue(host.subviews.first === second)
        model.updateSendFlight(["cancel": true, "token": second.token])
        XCTAssertTrue(host.subviews.isEmpty)
        XCTAssertTrue(textHost.subviews.isEmpty)
    }

    @MainActor
    func testSentHomeDraftDoesNotReturnDuringBackSwipe() {
        let model = BrowserModel()
        model.updateComposer(["id": "home", "variant": "home", "value": "Find Omer Adam tickets"])
        model.sendComposer("Find Omer Adam tickets", origin: .zero)
        XCTAssertEqual(model.composer?.text, "")

        // The web send animation can echo the outgoing text before publishing
        // its empty value or mounting the new conversation.
        model.updateComposer(["id": "home", "variant": "home", "value": "Find Omer Adam tickets", "sending": true])
        model.updateComposer(["id": "task", "variant": "thread", "value": ""])
        model.updateNavigationFrame(["phase": "drag", "incoming": 140.0, "outgoing": -60.0])
        XCTAssertEqual(model.departingComposer?.text, "")

        model.updateComposer(["id": "home", "variant": "home", "value": "", "sending": false])
        XCTAssertEqual(model.composer?.text, "")
    }

    @MainActor
    func testFailedSendRestoresNativeDraft() {
        let model = BrowserModel()
        model.updateComposer(["id": "home", "variant": "home", "value": "Find tickets"])
        model.sendComposer("Find tickets", origin: .zero)
        model.updateComposer(["id": "home", "variant": "home", "value": "Find tickets", "error": "Couldn’t send. Try again."])
        XCTAssertEqual(model.composer?.text, "Find tickets")
    }

    @MainActor
    func testCommittedSwipeKeepsBothBarsVisibleBeforeNextBridgeFrame() {
        let model = BrowserModel()
        model.updateComposer(["id": "home", "variant": "home", "value": "Home draft"])
        model.updateComposer(["id": "task", "variant": "thread", "value": "Reply draft"])
        let rect: [String: Any] = ["x": 20.0, "y": 60.0, "width": 44.0, "height": 44.0]
        model.updateHomeHeader(["id": "home-header", "buttons": [
            rect.merging(["action": "archive", "label": "Archive"]) { _, new in new },
            rect.merging(["action": "search", "label": "Search"]) { _, new in new }
        ]])
        model.updateHomeHeader(["id": "home-header", "hidden": true])
        model.updateChatHeader(["id": "chat-header", "title": "Conversation", "back": rect, "label": rect])
        model.updateNavigationFrame(["phase": "drag", "incoming": 156.0, "outgoing": -65.52])
        model.navigationPushing = false
        model.updateNavigationFrame(["phase": "begin"])
        // The bridge may deliver the first spring frame later. The role swap
        // itself must preserve exactly the pixels visible at finger release.
        XCTAssertEqual(model.homeHeader?.id, "home-header")
        XCTAssertEqual(model.departingChatHeader?.id, "chat-header")
        XCTAssertNil(model.chatHeader)
        XCTAssertEqual(model.composer?.id, "home")
        XCTAssertEqual(model.composerOffset, -65.52, accuracy: 0.001)
        XCTAssertEqual(model.composerClip, 156)
        XCTAssertEqual(model.departingComposer?.id, "task")
        XCTAssertEqual(model.departingComposerOffset, 156)
        XCTAssertEqual(model.departingComposerClip, 10000)
        model.updateNavigationFrame(["phase": "frame", "incoming": -60.0, "outgoing": 175.0])
        XCTAssertEqual(model.composer?.id, "home", "Home cannot disappear while waiting for React to republish it")
        model.updateNavigationFrame(["phase": "end"])
        XCTAssertEqual(model.composer?.id, "home")
        XCTAssertNil(model.departingComposer)
    }

    @MainActor
    func testComposerSwipeCancellationAndPopRetainCorrectBars() {
        let model = BrowserModel()
        model.updateComposer(["id": "home", "variant": "home", "value": "Home draft"])
        model.updateComposer(["id": "task", "variant": "thread", "value": "Reply draft"])
        model.updateNavigationFrame(["phase": "drag", "incoming": 120.0, "outgoing": -75.6])
        XCTAssertEqual(model.composer?.text, "Reply draft")
        XCTAssertEqual(model.departingComposer?.text, "Home draft")
        XCTAssertEqual(model.departingComposerClip, 120)
        model.updateNavigationFrame(["phase": "end"])
        XCTAssertEqual(model.composer?.id, "task")
        XCTAssertNil(model.departingComposer)
        model.navigationPushing = false
        model.updateNavigationFrame(["phase": "begin"])
        model.updateNavigationFrame(["phase": "frame", "incoming": -56.0, "outgoing": 200.0])
        model.updateComposer(["id": "home", "variant": "home", "value": "Home draft"])
        XCTAssertEqual(model.departingComposer?.text, "Reply draft")
        XCTAssertTrue(model.departingComposerOnTop)
        XCTAssertEqual(model.composerOffset, -56)
        XCTAssertEqual(model.composerClip, 200)
    }
}

extension CompatibilityTests {
    func testConversationMenuHitTargetsUseViewportScaleAndRejectInvalidBounds() {
        let payload: [String: Any] = ["key": "decision:trip", "title": "My trip", "pinned": true, "archived": false, "enabled": true, "x": 20.0, "y": -10.0, "width": 350.0, "height": 74.0]
        let item = NativeConversationMenuItem(payload, scale: 2)
        XCTAssertEqual(item?.key, "decision:trip")
        XCTAssertEqual(item?.rect, CGRect(x: 40, y: -20, width: 700, height: 148))
        XCTAssertTrue(item?.rect.contains(CGPoint(x: 100, y: 50)) == true)
        XCTAssertFalse(item?.rect.contains(CGPoint(x: 100, y: 150)) == true)
        XCTAssertTrue(item?.pinned == true)
        var invalid = payload; invalid["y"] = Double.nan
        XCTAssertNil(NativeConversationMenuItem(invalid, scale: 1))
        invalid = payload; invalid["height"] = 0.0
        XCTAssertNil(NativeConversationMenuItem(invalid, scale: 1))
    }
}


extension CompatibilityTests {
    @MainActor
    func testConversationPeekRendersOnlyVisibleMessagesAndUpdatesAfterLoading() {
        let preview = ConversationPreviewController(title: "Dinner", messages: [
            ["kind": "user", "text": "Book for two"],
            ["kind": "agent", "text": "Which time?"],
            ["kind": "activity", "text": "PRIVATE TOOL DATA"]
        ])
        preview.loadViewIfNeeded()
        preview.view.frame = CGRect(x: 0, y: 0, width: 350, height: 390)
        preview.view.layoutIfNeeded()
        func labels(_ view: UIView) -> [String] {
            (view as? UILabel).flatMap { $0.text }.map { [$0] } ?? view.subviews.flatMap(labels)
        }
        XCTAssertEqual(labels(preview.view), ["Dinner", "Book for two", "Which time?"])
        preview.show(messages: [["kind": "agent", "text": "Booked for 7 pm"]])
        XCTAssertEqual(labels(preview.view), ["Dinner", "Booked for 7 pm"])
        preview.showRefreshError()
        XCTAssertTrue(labels(preview.view).contains("Booked for 7 pm"), "Refresh failure retains the saved messages")
    }
}


extension CompatibilityTests {
    func testNativeChatHeaderValidatesFramesAndPreservesUnreadCount() throws {
        let frame: [String: Any] = ["x": 22.0, "y": 68.0, "width": 70.0, "height": 40.0]
        var payload: [String: Any] = ["id": "chat-1", "title": "Dinner plans", "unreadCount": 3, "back": frame, "label": frame]
        let header = try XCTUnwrap(NativeChatHeaderState(payload: payload))
        XCTAssertEqual(header.unreadCount, 3)
        XCTAssertEqual(header.activitySymbol, "ellipsis.bubble")
        for activity in ["Thinking", "Typing"] {
            payload["activity"] = activity
            XCTAssertEqual(NativeChatHeaderState(payload: payload)?.showsActivityIcon, false)
        }
        payload["activity"] = "Using browser"
        XCTAssertEqual(NativeChatHeaderState(payload: payload)?.showsActivityIcon, true)
        payload["activitySymbol"] = "desktopcomputer"
        XCTAssertEqual(NativeChatHeaderState(payload: payload)?.activitySymbol, "desktopcomputer")
        payload["activitySymbol"] = "not.a.real.symbol"
        XCTAssertEqual(NativeChatHeaderState(payload: payload)?.activitySymbol, "ellipsis.bubble")
        XCTAssertEqual(header.back, CGRect(x: 22, y: 68, width: 70, height: 40))
        XCTAssertNil(header.browser)
        payload["back"] = ["x": Double.nan, "y": 0.0, "width": 40.0, "height": 40.0]
        XCTAssertNil(NativeChatHeaderState(payload: payload))
        payload["back"] = ["x": 0.0, "y": 0.0, "width": -1.0, "height": 40.0]
        XCTAssertNil(NativeChatHeaderState(payload: payload))
    }
}


extension CompatibilityTests {
    @MainActor
    func testComposerKeyboardSendDoesNotInsertNewline() {
        let editor = ComposerTextView()
        editor.text = "Hello"
        var sends = 0
        editor.send = { sends += 1 }
        editor.insertText("\n")
        XCTAssertEqual(sends, 1)
        XCTAssertEqual(editor.text, "Hello")
        editor.insertText("first\nsecond")
        XCTAssertEqual(sends, 1)
        XCTAssertTrue(editor.text.contains("first\nsecond"))
    }
}

@MainActor
private final class NotificationNavigationObserver: NSObject, WKNavigationDelegate {
    let opened: (URL) -> Void
    init(opened: @escaping (URL) -> Void) { self.opened = opened }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url { opened(url) }
        decisionHandler(.cancel)
    }
}


extension CompatibilityTests {
    @MainActor
    func testDictationMeterReachesNativeComposerWithoutChangingDraft() {
        let model = BrowserModel()
        model.updateComposer(["id": "chat", "value": "Keep my draft", "voice": "recording", "voiceLevels": [-1.0, 0.25, 2.0, Double.nan], "voiceElapsed": 12])
        XCTAssertEqual(model.composer?.text, "Keep my draft")
        XCTAssertEqual(model.composer?.voice, "recording")
        XCTAssertEqual(model.composer?.voiceLevels, [0, 0.25, 1, 0])
        XCTAssertEqual(model.composer?.voiceElapsed, 12)
        model.updateComposer(["id": "chat", "value": "Keep my draft", "voice": "idle"])
        XCTAssertEqual(model.composer?.voiceLevels, [])
        XCTAssertEqual(model.composer?.voiceElapsed, 0)
        XCTAssertEqual(model.composer?.text, "Keep my draft")
    }
}

@MainActor
private final class LinkNavigationObserver: NSObject, WKNavigationDelegate {
    let coordinator: WebCoordinator
    let loaded: XCTestExpectation
    init(coordinator: WebCoordinator, loaded: XCTestExpectation) {
        self.coordinator = coordinator
        self.loaded = loaded
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        coordinator.webView(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded.fulfill() }
}


extension CompatibilityTests {
    @MainActor
    func testComposerPastedFilesKeepPDFBytesAndIgnorePlainText() throws {
        let editor = ComposerTextView()
        XCTAssertNil(try editor.pastedFiles(from: [["public.utf8-plain-text": "first\nsecond", "com.apple.webarchive": Data("rich text representation".utf8), "com.apple.flat-rtfd": Data()]]))
        let bytes = Data("%PDF-dummy-paste-test".utf8)
        let payload = try XCTUnwrap(editor.pastedFiles(from: [["com.adobe.pdf": bytes]]))
        let files = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [[String: String]])
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files[0]["type"], "application/pdf")
        XCTAssertEqual(files[0]["dataBase64"], bytes.base64EncodedString())
        let image = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }
        let imagePayload = try XCTUnwrap(editor.pastedFiles(from: [["com.apple.uikit.image": image]]))
        let imageFiles = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(imagePayload.utf8)) as? [[String: String]])
        XCTAssertEqual(imageFiles[0]["type"], "image/jpeg")
        XCTAssertNotNil(UIImage(data: try XCTUnwrap(Data(base64Encoded: imageFiles[0]["dataBase64"] ?? ""))))
        XCTAssertThrowsError(try editor.pastedFiles(from: [["com.adobe.pdf": Data(count: 3 * 1024 * 1024 + 1)]]))
        XCTAssertThrowsError(try editor.pastedFiles(from: Array(repeating: ["com.adobe.pdf": bytes], count: 7)))
    }

    @MainActor
    func testComposerPastedFileURLPreservesFilenameAndDoesNotSend() throws {
        let editor = ComposerTextView()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("paste-\(UUID().uuidString).txt")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("file contents".utf8).write(to: url)
        let payload = try XCTUnwrap(editor.pastedFiles(from: [["public.file-url": url]]))
        let files = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [[String: String]])
        XCTAssertEqual(files[0]["name"], url.lastPathComponent)
        XCTAssertEqual(files[0]["type"], "text/plain")
        XCTAssertEqual(files[0]["dataBase64"], Data("file contents".utf8).base64EncodedString())
    }
}


extension CompatibilityTests {
    func testNativePickerPreservesFileAndRejectsOversizedSelection() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("Menu test.txt")
        let bytes = Data("attachment picker check".utf8)
        try bytes.write(to: url)
        let file = try NativeAttachmentPicker.file(at: url)
        XCTAssertEqual(file["name"], "Menu test.txt")
        XCTAssertEqual(file["type"], "text/plain")
        XCTAssertEqual(Data(base64Encoded: file["dataBase64"]!), bytes)
        XCTAssertNotNil(try NativeAttachmentPicker.encode([file]))
        XCTAssertNil(try NativeAttachmentPicker.encode([]))
        XCTAssertThrowsError(try NativeAttachmentPicker.encode(Array(repeating: file, count: 7)))
        try Data(count: 3 * 1024 * 1024 + 1).write(to: url)
        XCTAssertThrowsError(try NativeAttachmentPicker.file(at: url))

        let image = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 10)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 10, height: 10))
        }
        var largePhoto = try XCTUnwrap(image.pngData())
        largePhoto.append(Data(count: 3 * 1024 * 1024))
        let photoURL = directory.appendingPathComponent("Pizza.png")
        try largePhoto.write(to: photoURL)
        let prepared = try NativeAttachmentPicker.file(at: photoURL)
        XCTAssertEqual(prepared["type"], "image/jpeg")
        XCTAssertLessThan(try XCTUnwrap(Data(base64Encoded: prepared["dataBase64"] ?? "")).count, 3 * 1024 * 1024)
    }

    @MainActor
    func testComposerDraftFileMenuMetadata() {
        let model = BrowserModel()
        model.updateComposer(["id": "draft-menu", "fileCount": 2, "draftFiles": [
            ["id": "one", "name": "My report.pdf", "mimeType": "application/pdf", "description": "PDF file · 24 KB"],
            ["id": "two", "name": "Photo.png", "mimeType": "image/png", "description": "Image · 8 KB"]
        ]])
        XCTAssertEqual(model.composer?.draftFiles.map(\.name), ["My report.pdf", "Photo.png"])
        XCTAssertEqual(model.composer?.draftFiles.first?.id, "one")
        model.updateComposer(["id": "draft-menu", "fileCount": 0])
        XCTAssertEqual(model.composer?.draftFiles.count, 0)
    }
}


extension CompatibilityTests {
    @MainActor
    func testHoldAdapterInjectsIntoEncryptedViewerRoute() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: BrowserTakeoverTouch.script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 393, height: 852), configuration: configuration)
        webView.loadHTMLString("<html><body><canvas id='browserless-screen'></canvas></body></html>",
            baseURL: URL(string: "https://production-sfo.browserless.io/e/53616c7465645f5f0123456789abcdef/live/index.html")!)
        var ready = false
        for _ in 0..<100 {
            ready = (try? await webView.evaluateJavaScript("!!document.querySelector('canvas')")) as? Bool == true
            if ready { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertTrue(ready)
        let selection = try await webView.evaluateJavaScript("getComputedStyle(document.querySelector('canvas')).webkitUserSelect") as? String
        XCTAssertEqual(selection, "none")
        _ = try await webView.evaluateJavaScript("""
        window.holdEvents=[];
        const c=document.querySelector('canvas');
        for(const type of ['pointerdown','pointerup'])c.addEventListener(type,e=>{if(e.pointerType==='mouse')holdEvents.push(type)});
        c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true,clientX:20,clientY:20}));true
        """)
        try await Task.sleep(for: .milliseconds(400))
        let held = try await webView.evaluateJavaScript("holdEvents") as? [String]
        XCTAssertEqual(held, ["pointerdown"])
        _ = try await webView.evaluateJavaScript("document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true}));true")
        let released = try await webView.evaluateJavaScript("holdEvents") as? [String]
        XCTAssertEqual(released, ["pointerdown", "pointerup"])
    }

    func testLiveBrowserEmbeddingIsLimitedToProviderSubframes() {
        for host in ["production-sfo.browserless.io", "production-lon.browserless.io", "production-ams.browserless.io"] {
            let url = URL(string: "https://\(host)/live/index.html?i=test-viewer")!
            XCTAssertTrue(WebCoordinator.isEmbeddedBrowserURL(url, isMainFrame: false))
            XCTAssertFalse(WebCoordinator.isEmbeddedBrowserURL(url, isMainFrame: true))
            XCTAssertFalse(WebCoordinator.isEmbeddedBrowserURL(url, isMainFrame: nil))
        }
        for path in ["/e/53616c7465645f5f0123456789abcdef/live/index.html", "/chromium/live/index.html", "/live", "/live/"] {
            let url = URL(string: "https://production-sfo.browserless.io\(path)?i=test-viewer")!
            XCTAssertTrue(WebCoordinator.isEmbeddedBrowserURL(url, isMainFrame: false), path)
            XCTAssertFalse(WebCoordinator.isEmbeddedBrowserURL(url, isMainFrame: true), path)
            XCTAssertFalse(WebCoordinator.isEmbeddedBrowserURL(url, isMainFrame: nil), path)
        }
        XCTAssertTrue(WebCoordinator.isEmbeddedBrowserURL(URL(string: "https://session.e2b.app/view")!, isMainFrame: false))
        for value in ["http://production-sfo.browserless.io/live/", "https://production-sfo.browserless.io/settings", "https://production-sfo.browserless.io/e/not-a-route/live/index.html", "https://production-sfo.browserless.io/e/abcdef/settings", "https://production-sfo.browserless.io/live-other", "https://production-sfo.browserless.io.evil.test/live/", "https://evil.test/live/", "https://user@production-sfo.browserless.io/live/", "https://production-sfo.browserless.io:444/live/"] {
            XCTAssertFalse(WebCoordinator.isEmbeddedBrowserURL(URL(string: value)!, isMainFrame: false), value)
        }
    }

    @MainActor
    func testLiveBrowserIframeDoesNotOpenBrowserTab() async throws {
        let model = BrowserModel()
        let coordinator = try XCTUnwrap(model.webView.navigationDelegate as? WebCoordinator)
        let embedded = expectation(description: "Live stream allowed inside iframe")
        let observer = EmbeddedStreamObserver(coordinator: coordinator, embedded: embedded)
        model.webView.navigationDelegate = observer
        model.webView.loadHTMLString("<html><body><iframe src='https://production-sfo.browserless.io/e/53616c7465645f5f0123456789abcdef/live/index.html?i=test-viewer'></iframe></body></html>", baseURL: model.configuration.baseURL)
        await fulfillment(of: [embedded], timeout: 10)
        XCTAssertNil(model.browserLink, "The embedded live stream must not open a browser tab")
    }
}

@MainActor
private final class EmbeddedStreamObserver: NSObject, WKNavigationDelegate {
    let coordinator: WebCoordinator
    let embedded: XCTestExpectation
    init(coordinator: WebCoordinator, embedded: XCTestExpectation) {
        self.coordinator = coordinator
        self.embedded = embedded
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        coordinator.webView(webView, decidePolicyFor: action) { policy in
            if action.request.url?.host == "production-sfo.browserless.io" {
                XCTAssertEqual(action.targetFrame?.isMainFrame, false)
                XCTAssertEqual(policy, .allow)
                self.embedded.fulfill()
                decisionHandler(.cancel) // Verify routing without contacting a real stream.
            } else { decisionHandler(policy) }
        }
    }
}

extension CompatibilityTests {
    func testActivitySymbolsAreAvailableInNativeHeader() {
        for symbol in NativeActivitySymbols.names {
            XCTAssertNotNil(UIImage(systemName: symbol), symbol)
            XCTAssertEqual(NativeActivitySymbols.image(symbol).size, CGSize(width: 15, height: 15))
        }
    }

    @MainActor
    func testFeedUsesTheExactNativeHeaderSymbolImage() async throws {
        let model = BrowserModel()
        let loaded = expectation(description: "Activity symbol fixture loaded")
        let observer = ActivitySymbolLoadObserver(loaded: loaded)
        model.webView.navigationDelegate = observer
        model.webView.loadHTMLString("<html><body><span class='wd-tool-activity-icon' data-activity-symbol='photo'><svg></svg></span></body></html>", baseURL: model.configuration.baseURL)
        await fulfillment(of: [loaded], timeout: 10)
        let mask = try await model.webView.evaluateJavaScript("getComputedStyle(document.querySelector('[data-activity-symbol]')).webkitMaskImage") as? String
        let png = try XCTUnwrap(NativeActivitySymbols.image("photo").pngData()).base64EncodedString()
        XCTAssertTrue(mask?.contains(png) == true, "Home must use the same image bytes as the native chat header")
        let fallback = try await model.webView.evaluateJavaScript("getComputedStyle(document.querySelector('[data-activity-symbol] > svg')).display") as? String
        XCTAssertEqual(fallback, "none")
    }
}

@MainActor
private final class ActivitySymbolLoadObserver: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation
    init(loaded: XCTestExpectation) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded.fulfill() }
}


extension CompatibilityTests {
    func testBrowserCloseRejectsInvalidGeometryAndClampsOpacity() throws {
        var payload: [String: Any] = ["id": "browser-1", "x": 16.0, "y": 68.0, "width": 44.0, "height": 44.0, "opacity": 1.0]
        let close = try XCTUnwrap(NativeBrowserCloseState(payload: payload))
        XCTAssertEqual(close.frame, CGRect(x: 16, y: 68, width: 44, height: 44))
        payload["opacity"] = 2.0
        XCTAssertEqual(NativeBrowserCloseState(payload: payload)?.opacity, 1)
        payload["y"] = Double.nan
        XCTAssertNil(NativeBrowserCloseState(payload: payload))
        payload["y"] = 68.0
        payload["width"] = 0.0
        XCTAssertNil(NativeBrowserCloseState(payload: payload))
    }
}


@MainActor
final class MessageMenuTests: XCTestCase, UIContextMenuInteractionDelegate {
    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? { nil }

    func testMessageTargetsScaleAndExcludeInteractiveContent() throws {
        let payload: [String: Any] = ["key": "message-1", "text": "hello", "canReply": true, "canReact": true,
            "x": 10.0, "y": 20.0, "width": 120.0, "height": 60.0,
            "excluded": [["x": 80.0, "y": 20.0, "width": 40.0, "height": 30.0]]]
        let item = try XCTUnwrap(NativeMessageMenuItem(payload, scale: 2))
        XCTAssertEqual(item.rect, CGRect(x: 20, y: 40, width: 240, height: 120))
        XCTAssertTrue(item.contains(CGPoint(x: 40, y: 50)))
        XCTAssertFalse(item.contains(CGPoint(x: 180, y: 50)))
        XCTAssertFalse(item.contains(CGPoint(x: 0, y: 0)))
        var invalid = payload; invalid["width"] = Double.nan
        XCTAssertNil(NativeMessageMenuItem(invalid, scale: 1))
        XCTAssertNil(NativeMessageMenuItem(payload, scale: .infinity))
    }

    func testNativeHoldBuildsMessagePreviewAndClearsItWhenTargetLeaves() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        let web = WKWebView(frame: controller.view.bounds)
        controller.view.addSubview(web)
        controller.view.layoutIfNeeded()
        // Let UIKit commit the source layer before asking for a targeted snapshot.
        try await Task.sleep(nanoseconds: 100_000_000)
        let menus = NativeMessageMenus(webView: web)
        menus.update(["viewportWidth": Double(web.bounds.width), "keys": ["message-1"], "items": [[
            "key": "message-1", "text": "hello", "canReply": true, "x": 20.0, "y": 100.0, "width": 180.0, "height": 60.0,
            "previewRects": [["x": 20.0, "y": 100.0, "width": 180.0, "height": 60.0],
                             ["x": 172.0, "y": 80.0, "width": 36.0, "height": 32.0]]]]])
        let interaction = UIContextMenuInteraction(delegate: self)
        let configuration = try XCTUnwrap(menus.configuration(at: CGPoint(x: 40, y: 120), interaction: interaction))
        XCTAssertTrue(NativeMessageMenus.owns(configuration))
        let preview = try XCTUnwrap(menus.preview)
        XCTAssertEqual(preview.view.bounds.size, CGSize(width: 188, height: 80))
        XCTAssertEqual(preview.target.center, CGPoint(x: 114, y: 120))
        let mask = try XCTUnwrap((preview.view.subviews.first?.layer.mask as? CAShapeLayer)?.path)
        XCTAssertTrue(mask.contains(CGPoint(x: 170, y: 4)), "Top of reaction must remain visible")
        XCTAssertTrue(mask.contains(CGPoint(x: 184, y: 16)), "Overhanging badge edge must remain visible")
        XCTAssertFalse(mask.contains(CGPoint(x: 10, y: 4)), "Do not lift unrelated content above the message")
        menus.update(["viewportWidth": Double(web.bounds.width), "keys": [], "items": []])
        XCTAssertNil(menus.preview)
    }

    func testNativeActionsAndSelectedReactionUseSystemMenuElements() throws {
        let item = try XCTUnwrap(NativeMessageMenuItem(["key": "message-1", "text": "hello", "selected": "❤️",
            "canReply": true, "canReact": true, "x": 10.0, "y": 20.0, "width": 120.0, "height": 60.0], scale: 1))
        let menus = NativeMessageMenus(webView: WKWebView())
        let menu = menus.menu(for: item)
        let quick = try XCTUnwrap(menu.children.first as? UIMenu)
        XCTAssertEqual(quick.preferredElementSize, .small)
        XCTAssertEqual((quick.children.first as? UIAction)?.state, .on)
        XCTAssertEqual(menu.children.suffix(2).map(\.title), ["Reply", "Copy"])
        let more = try XCTUnwrap(menu.children[1] as? UIAction)
        XCTAssertEqual(more.title, "More reactions")
        XCTAssertTrue(menu.children.contains { $0.title == "Remove reaction" })
    }

    func testEmojiEntryAcceptsSingleEmojiAndRejectsText() {
        for value in ["❤️", "👍🏽", "👨‍👩‍👧‍👦", "🇨🇦", "1️⃣", "☺", "©️", "®️"] { XCTAssertTrue(NativeMessageMenus.isEmoji(value), value) }
        for value in ["", "hi", "1", "a", "❤️👍", "\u{FE0F}", "\u{20E3}"] { XCTAssertFalse(NativeMessageMenus.isEmoji(value), value) }
    }
}

final class ProactiveBatchTests: XCTestCase {
    @MainActor
    func testBirthdaySyncDeduplicationIsPerAccountAndDay() {
        let today = Date()
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: today)!
        let key = ProactiveSignals.birthdayKey(accountKey: "account-a", date: today)
        XCTAssertEqual(key, ProactiveSignals.birthdayKey(accountKey: "account-a", date: today))
        XCTAssertNotEqual(key, ProactiveSignals.birthdayKey(accountKey: "account-b", date: today))
        XCTAssertNotEqual(key, ProactiveSignals.birthdayKey(accountKey: "account-a", date: tomorrow))
    }


}


final class SignInCaptureTests: XCTestCase {
    @MainActor
    func testCookieTransferSurvivesMissingCaptureAndSaveFailure() async {
        var transfers = 0
        var saves = 0
        let missing = SignInCompletion.deliver(login: nil, transfer: { transfers += 1 }, save: { _ in saves += 1 })
        XCTAssertNil(missing)
        XCTAssertEqual(transfers, 1)
        XCTAssertEqual(saves, 0)
        let login = CapturedSignInLogin(host: "example.com", username: "fixture@example.com", password: "synthetic-password")
        let failed = SignInCompletion.deliver(login: login, transfer: { transfers += 1 }, save: { _ in
            XCTAssertEqual(transfers, 2, "Cookies must be dispatched before saving starts")
            saves += 1
            throw DeviceVaultError.unavailable
        })
        await failed?.value
        XCTAssertEqual(transfers, 2)
        XCTAssertEqual(saves, 1)
        let saved = SignInCompletion.deliver(login: login, transfer: { transfers += 1 }, save: { captured in
            XCTAssertEqual(captured, login)
            saves += 1
        })
        await saved?.value
        XCTAssertEqual(transfers, 3)
        XCTAssertEqual(saves, 2)
    }

    @MainActor
    func testActualCookiesTransferWhenCaptureIsUnavailable() async throws {
        let controller = SignInWebController(url: URL(string: "https://example.com/login")!)
        controller.webView.configuration.userContentController.removeAllUserScripts()
        try await page(controller, html: "<input autocomplete='username' value='fixture'><input type='password' value='synthetic-password'>")
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "session", .value: "synthetic-session", .domain: "example.com", .path: "/", .secure: "TRUE"]))
        await controller.webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
        let (cookies, finalURL) = await withCheckedContinuation { continuation in
            controller.collectCookies(for: URL(string: "https://example.com/login")!) { continuation.resume(returning: ($0, $1)) }
        }
        XCTAssertNil(controller.capturedLogin)
        XCTAssertEqual(cookies.first?["value"] as? String, "synthetic-session")
        XCTAssertTrue(finalURL.contains("example.com"))
        var transferred = false
        SignInCompletion.deliver(login: controller.capturedLogin, transfer: { transferred = true }, save: { _ in XCTFail("No credentials to save") })
        XCTAssertTrue(transferred)
        await withCheckedContinuation { continuation in controller.wipe { continuation.resume() } }
        let remaining = await withCheckedContinuation { continuation in
            controller.webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
        XCTAssertTrue(remaining.isEmpty)
    }

    func testCapturedLoginCanBeStoredInDeviceVaultWithoutReadingOrPrompting() throws {
        let vault = DeviceVault()
        let id = UUID().uuidString
        let owner = "signin-fixture@example.invalid"
        defer { try? vault.delete(ownerEmail: owner, itemID: id) }
        try vault.save(ownerEmail: owner, itemID: id, secret: .login(username: "fixture", password: "synthetic-password"))
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.example.dash.device-vault.v1",
            kSecAttrAccount as String: "\(owner):\(id)",
            kSecReturnAttributes as String: true,
            kSecUseDataProtectionKeychain as String: true,
        ]
        var attributes: CFTypeRef?
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &attributes), errSecSuccess)
        XCTAssertNotNil(attributes)
    }

    @MainActor
    private func page(_ controller: SignInWebController, html: String, host: String = "example.com") async throws {
        controller.webView.loadHTMLString(html, baseURL: URL(string: "https://\(host)/login")!)
        for _ in 0..<100 {
            try await Task.sleep(for: .milliseconds(50))
            if !controller.webView.isLoading,
               (try? await controller.webView.evaluateJavaScript("document.readyState")) as? String == "complete" { return }
        }
        XCTFail("Fixture did not load")
    }

    @MainActor
    private func settle() async throws { try await Task.sleep(for: .milliseconds(400)) }

    @MainActor
    func testRealWebKitCaptureTypingAutofillAndTwoStepLogin() async throws {
        let controller = SignInWebController(url: URL(string: "https://example.com/login")!)
        try await page(controller, html: "<input autocomplete='username' id='u'>")
        _ = try await controller.webView.evaluateJavaScript("u.value='fixture@example.com';u.dispatchEvent(new Event('input',{bubbles:true}))")
        try await settle()
        XCTAssertNil(controller.capturedLogin)
        try await page(controller, html: "<input type='password' autocomplete='current-password' id='p'>")
        // Autofill may change the value without an input event.
        _ = try await controller.webView.evaluateJavaScript("p.value='synthetic-password'")
        try await settle()
        XCTAssertEqual(controller.capturedLogin, CapturedSignInLogin(host: "example.com", username: "fixture@example.com", password: "synthetic-password"))
        await withCheckedContinuation { continuation in controller.wipe { continuation.resume() } }
        XCTAssertNil(controller.capturedLogin)
    }

    @MainActor
    func testRejectsOAuthOriginAndNewPasswordAndOTP() async throws {
        let controller = SignInWebController(url: URL(string: "https://example.com/login")!)
        try await page(controller, html: "<input autocomplete='username' value='someone'><input type='password' value='synthetic-password'>", host: "provider.example")
        try await settle()
        XCTAssertNil(controller.capturedLogin)
        try await page(controller, html: "<input autocomplete='username' value='someone'><input type='password' autocomplete='new-password' value='synthetic-password'>")
        try await settle()
        XCTAssertNil(controller.capturedLogin)
        try await page(controller, html: "<input autocomplete='username' value='someone'><input type='password' autocomplete='one-time-code' value='123456'>")
        try await settle()
        XCTAssertNil(controller.capturedLogin)
        await withCheckedContinuation { continuation in controller.wipe { continuation.resume() } }
    }
}

private final class AvatarImageProtocol: URLProtocol {
    static var requests = 0
    static var bytes = Data()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests += 1
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.bytes)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

extension CompatibilityTests {
    @MainActor
    func testRemoteHomeAvatarSurvivesViewRecreationWithoutAnotherFetch() async {
        AvatarImageProtocol.requests = 0
        AvatarImageProtocol.bytes = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }.pngData()!
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AvatarImageProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let url = URL(string: "https://avatar.example.invalid/\(UUID().uuidString).png")!
        let first = await HomeAvatarPhotoCache.load(url, session: session)
        XCTAssertNotNil(first)
        XCTAssertTrue(HomeAvatarPhotoCache.cached(url.absoluteString) === first)
        let second = await HomeAvatarPhotoCache.load(url, session: session)
        XCTAssertTrue(first === second)
        XCTAssertEqual(AvatarImageProtocol.requests, 1)
    }
}
