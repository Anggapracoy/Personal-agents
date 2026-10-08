import AuthenticationServices
import UIKit
import WebKit

/// Adapt only Browserless's streamed canvas; never inject into destination websites.
enum BrowserTakeoverTouch {
    static let script = #"""
    (() => {
      // Match the hosted stream routes accepted by isEmbeddedBrowserURL below.
      const viewer = new URL(location.href);
      if (viewer.protocol !== 'https:' || viewer.username || viewer.password || viewer.port ||
          !/^production-(sfo|lon|ams)\.browserless\.io$/.test(viewer.hostname) ||
          !/^\/(?:e\/[0-9a-fA-F]+\/|chromium\/)?live(?:\/|$)/.test(viewer.pathname)) return;
      const selector = '#browserless-screen';
      const style = document.createElement('style');
      style.textContent = `${selector} { -webkit-touch-callout:none!important; -webkit-user-select:none!important; user-select:none!important; -webkit-user-drag:none!important; }`;
      const mount = () => (document.head || document.documentElement).append(style);
      if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount, {once:true});
      let press = null;
      const mouse = (p, type) => p.node.dispatchEvent(new PointerEvent(type, {bubbles:true, cancelable:true, pointerId:p.id, pointerType:'mouse', isPrimary:true, button:0, buttons:type === 'pointerup' ? 0 : 1, clientX:p.x, clientY:p.y}));
      const release = () => {
        if (!press) return;
        clearTimeout(press.timer);
        if (press.held) mouse(press, 'pointerup');
        press = null;
      };
      document.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch') return;
        if (!event.isPrimary) { release(); return; }
        if (!(event.target instanceof Element) || !event.target.matches(selector)) return;
        release();
        const p = {node:event.target, id:event.pointerId, x:event.clientX, y:event.clientY, held:false, timer:0};
        press = p;
        // Preserve ordinary taps and scrolling. Once a finger rests, forward
        // an actual down/up interval instead of the viewer's release-only click.
        p.timer = setTimeout(() => { if (press === p && p.node.isConnected) { p.held = true; mouse(p, 'pointerdown'); } }, 250);
      }, true);
      document.addEventListener('pointermove', event => {
        const p = press;
        if (event.pointerType !== 'touch' || !p || event.pointerId !== p.id) return;
        if (Math.hypot(event.clientX-p.x, event.clientY-p.y) > 5) { release(); return; }
        if (p.held) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, {capture:true, passive:false});
      for (const type of ['pointerup','pointercancel','lostpointercapture']) document.addEventListener(type, event => {
        const p = press;
        if (event.pointerType !== 'touch' || !p || event.pointerId !== p.id) return;
        if (p.held) {
          event.preventDefault(); event.stopImmediatePropagation();
          release();
          // Clear the provider's stored touch without its synthetic tap.
          p.node.dispatchEvent(new PointerEvent('pointercancel', {bubbles:true, pointerId:p.id, pointerType:'touch', isPrimary:true}));
        }
        release();
      }, {capture:true, passive:false});
      for (const type of ['contextmenu','selectstart','dragstart']) document.addEventListener(type, event => {
        if (event.target instanceof Element && event.target.matches(selector)) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      window.addEventListener('blur', release);
      window.addEventListener('pagehide', release);
      document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    })();
    """#
}

/** Shared SF Symbol artwork for the native chat header and hosted Home rows. */
enum NativeActivitySymbols {
    static let names = ["desktopcomputer", "chevron.left.forwardslash.chevron.right", "magnifyingglass", "globe", "link", "envelope", "doc", "calendar", "lock", "questionmark.bubble", "cloud.sun", "clock", "phone", "photo", "video", "checklist", "checkmark.circle", "brain.head.profile", "iphone", "text.bubble", "person.crop.circle", "heart", "house", "music.note", "map", "location", "figure.walk", "ellipsis.bubble", "pencil"]

    static let images: [String: UIImage] = {
        let configuration = UIImage.SymbolConfiguration(pointSize: 13, weight: .regular)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        format.opaque = false
        return Dictionary(uniqueKeysWithValues: names.compactMap { name in
            guard let symbol = UIImage(systemName: name, withConfiguration: configuration)?.withTintColor(.black, renderingMode: .alwaysOriginal) else { return nil }
            let scale = min(1, 15 / max(symbol.size.width, symbol.size.height))
            let size = CGSize(width: symbol.size.width * scale, height: symbol.size.height * scale)
            let image = UIGraphicsImageRenderer(size: CGSize(width: 15, height: 15), format: format).image { _ in
                symbol.draw(in: CGRect(x: (15 - size.width) / 2, y: (15 - size.height) / 2, width: size.width, height: size.height))
            }
            return (name, image)
        })
    }()

    static func image(_ name: String) -> UIImage {
        images[name] ?? images["ellipsis.bubble"]!
    }

    static let webScript: String = {
        let css = names.compactMap { name -> String? in
            guard let data = images[name]?.pngData() else { return nil }
            let selector = ".decision-feed-native .wd-tool-activity-icon[data-activity-symbol=\"\(name)\"]"
            return "\(selector){background-color:currentColor;-webkit-mask:url(data:image/png;base64,\(data.base64EncodedString())) center/15px 15px no-repeat;mask:url(data:image/png;base64,\(data.base64EncodedString())) center/15px 15px no-repeat}\(selector)>svg{display:none}"
        }.joined()
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: [css]), encoding: .utf8)!
        return """
        (() => {
          const install = () => {
            if (!document.documentElement || document.getElementById('dash-native-activity-symbols')) return;
            const style = document.createElement('style');
            style.id = 'dash-native-activity-symbols';
            style.textContent = \(encoded)[0];
            document.documentElement.appendChild(style);
          };
          install();
          document.addEventListener('DOMContentLoaded', install, { once: true });
        })();
        """
    }()
}

final class WebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate, ASWebAuthenticationPresentationContextProviding {
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let cardDismissal = message == "Stop choosing a card?\n\nKeep going to finish choosing and unlocking your card, or choose Not now to skip this request."
        let questionDismissal = message == "Dismiss these questions?\n\nDash will continue without these answers. Keep going to answer them instead."
        let suggestionDismissal = message == "Dismiss this suggestion?\n\nNo action will be taken. Keep going to choose an option instead."
        let requestDismissals: [String: (title: String, body: String, action: String)] = [
            "Decline this purchase?\n\nDash will not place this order. Keep going to review it instead.": ("Decline this purchase?", "Dash will not place this order.", "Decline"),
            "Skip signing in?\n\nDash will try to continue without this sign-in. Keep going to sign in instead.": ("Skip signing in?", "Dash will try to continue without this sign-in.", "Not now"),
            "Skip connecting?\n\nDash will try to continue without this connection. Keep going to connect instead.": ("Skip connecting?", "Dash will try to continue without this connection.", "Not now"),
            "Skip this login?\n\nDash will try to continue without your saved login. Keep going to unlock it instead.": ("Skip this login?", "Dash will try to continue without your saved login.", "Not now")
        ]
        let requestDismissal = requestDismissals[message]
        let dismissal = cardDismissal || questionDismissal || suggestionDismissal || requestDismissal != nil
        guard let model, frame.isMainFrame, let host = frame.request.url?.host?.lowercased(),
              model.configuration.allowedHosts.contains(host),
              (dismissal || message == "Take over the browser?\n\nDash will pause while you use the browser. Tap Continue to hand control back.") else {
            completionHandler(false)
            return
        }
        var presenter = webView.window?.rootViewController
        while let presented = presenter?.presentedViewController, !presented.isBeingDismissed { presenter = presented }
        guard let presenter, !presenter.isBeingDismissed else { completionHandler(false); return }
        let alert = UIAlertController(title: cardDismissal ? "Stop choosing a card?" : "Take over the browser?", message: cardDismissal ? "You can keep choosing and unlocking your card, or skip this request for now." : "Dash will pause while you use the browser. Tap Continue to hand control back.", preferredStyle: .alert)
        if questionDismissal { alert.title = "Dismiss these questions?"; alert.message = "Dash will continue without these answers." }
        if suggestionDismissal { alert.title = "Dismiss this suggestion?"; alert.message = "No action will be taken." }
        if let requestDismissal { alert.title = requestDismissal.title; alert.message = requestDismissal.body }
        let cancel = UIAlertAction(title: dismissal ? "Keep going" : "Cancel", style: .cancel) { _ in completionHandler(false) }
        alert.addAction(cancel)
        alert.addAction(UIAlertAction(title: requestDismissal?.action ?? (cardDismissal ? "Not now" : dismissal ? "Dismiss" : "Take over"), style: dismissal ? .destructive : .default) { _ in completionHandler(true) })
        if dismissal { alert.preferredAction = cancel }
        presenter.present(alert, animated: true)
    }

    static func isEmbeddedBrowserURL(_ url: URL, isMainFrame: Bool?) -> Bool {
        guard isMainFrame == false, url.scheme?.lowercased() == "https",
              url.user == nil, url.password == nil, url.port == nil || url.port == 443,
              let host = url.host?.lowercased() else { return false }
        if host == "e2b.app" || host.hasSuffix(".e2b.app") { return true }
        let streamHosts = ["production-sfo.browserless.io", "production-lon.browserless.io", "production-ams.browserless.io"]
        guard streamHosts.contains(host) else { return false }
        // Browserless also returns encrypted session routes, not just /live/.
        // Keep these in their existing iframe instead of opening Safari.
        return url.path.range(
            of: #"^/(?:e/[0-9a-fA-F]+/|chromium/)?live(?:/|$)"#,
            options: .regularExpression
        ) != nil
    }

    static let bridgeName = "decisionFeedNative"
    private static var supportsNativeMessageMenus: Bool {
        if #available(iOS 17.4, *) { return true }
        return false
    }
    static let nativeShellScript = #"""
    (() => {
      window.__decisionFeedNativeShell = true;
      window.__decisionFeedNativeArchiveConfirmation = true;
      window.__decisionFeedNativeNotificationSettings = true;
      window.__decisionFeedNativeGoogleConnectionCompletion = true;
      window.__decisionFeedNativeMessageFeedback = true;
      window.__decisionFeedNativeSendFlight = true;
      window.__decisionFeedNativeComposer = true;
      window.__decisionFeedNativeReplyComposer = true;
      window.__decisionFeedNativeHomeHeader = true;
      window.__decisionFeedNativeHomeAvatar = true;
      window.__decisionFeedNativeChromeBatch = true;
      window.__decisionFeedNativeChatHeader = true;
      window.__decisionFeedNativeBrowserClose = true;
      window.__decisionFeedNativeGlassButtons = true;
      window.__decisionFeedNativeConversationMenus = true;
      window.__decisionFeedNativeMessageMenus = \#(supportsNativeMessageMenus ? "true" : "false");
      window.__decisionFeedNativeLocation = true;
      window.__decisionFeedNativeSavePhotos = true;
      window.__decisionFeedNativeAppleConnections = true;
      window.__decisionFeedNativeVaultSelection = true;
      const markNativeShell = () => document.documentElement?.classList.add('decision-feed-native');
      markNativeShell();
      document.addEventListener('DOMContentLoaded', markNativeShell, { once: true });
    })();
    """#
    static let diagnosticsBridgeScript = #"""
    (() => {
      if (window.__decisionFeedDiagnosticsInstalled) return;
      window.__decisionFeedDiagnosticsInstalled = true;
      const report = (kind, detail = {}) => {
        try {
          window.webkit?.messageHandlers?.decisionFeedNative?.postMessage({
            version: 1,
            action: 'clientDiagnostic',
            payload: {
              kind,
              href: window.location.href,
              readyState: document.readyState,
              ...detail,
            },
          });
        } catch { /* Diagnostics must never destabilize the page. */ }
      };
      window.addEventListener('error', event => report('javascript_error', {
        message: String(event.message || 'Unknown JavaScript error'),
        source: String(event.filename || ''),
        line: Number(event.lineno || 0),
        column: Number(event.colno || 0),
      }), true);
      window.addEventListener('unhandledrejection', event => report('unhandled_rejection', {
        message: event.reason instanceof Error
          ? `${event.reason.name}: ${event.reason.message}`
          : String(event.reason || 'Unknown rejected promise'),
      }));
      report('document_script_started');
    })();
    """#

    weak var model: BrowserModel?
    private var destinations: [ObjectIdentifier: URL] = [:]

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        Task { @MainActor in model?.navigationStarted(url: webView.url) }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        Task { @MainActor in model?.navigationCommitted(url: webView.url) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in model?.navigationFinished(url: webView.url) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in model?.navigationFailed(error, stage: "navigation") }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in model?.navigationFailed(error, stage: "provisional_navigation") }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Task { @MainActor in model?.webContentProcessTerminated(url: webView.url) }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let model, let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        if Self.isEmbeddedBrowserURL(url, isMainFrame: navigationAction.targetFrame?.isMainFrame) {
            decisionHandler(.allow)
            return
        }
        guard let host = url.host?.lowercased(), model.configuration.allowedHosts.contains(host) else {
            model.openLink(url)
            decisionHandler(.cancel)
            return
        }
        if url.path == "/api/auth/signin/google" || url.path == "/api/auth/signin/apple" {
            let provider: BrowserModel.AuthenticationProvider = url.path.hasSuffix("apple") ? .apple : .google
            Task { @MainActor in model.startAuthentication(provider: provider) }
            decisionHandler(.cancel)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        // A tapped content link is a browser destination even on our own host.
        // Programmatic workspace loads and authentication stay in this web view.
        if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
            model.openLink(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        decisionHandler(disposition.contains("attachment") || !navigationResponse.canShowMIMEType ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            model?.openLink(url)
        }
        return nil
    }

    @MainActor
    private func applyChromeMessage(_ action: String, payload: [String: Any], isMainFrame: Bool, model: BrowserModel) -> Bool {
        switch action {
            case "navigationFrame":
                if isMainFrame { model.updateNavigationFrame(payload) }
            case "navigationMotion":
                if isMainFrame {
                    model.navigationPushing = payload["direction"] as? String == "push"
                    model.navigationFromLeft = payload["fromLeft"] as? Bool == true
                    model.setWorkspaceBackEdge(fromRight: payload["backFromRight"] as? Bool == true, enabled: payload["backEnabled"] as? Bool ?? true)
                    if !model.preserveSendKeyboard { model.composerDismissal += 1 }
                }
            case "chatHeaderState":
                if isMainFrame { model.updateChatHeader(payload) }
            case "chatHeaderHide":
                if isMainFrame, let id = payload["id"] as? String { model.hideChatHeader(id: id) }
            case "composerState":
                if isMainFrame {
                    model.updateComposer(payload)
                }
            case "composerBlur":
                if isMainFrame, payload["id"] as? String == model.composer?.id {
                    model.composerDismissal += 1
                }
            case "composerFocus":
                if isMainFrame, payload["id"] as? String == model.composer?.id {
                    model.composerFocusRequest += 1
                }
            case "composerHide":
                if isMainFrame, payload["id"] as? String == model.composer?.id {
                    if !model.preserveSendKeyboard { model.composer = nil }
                }
            case "homeHeaderState":
                if isMainFrame { model.updateHomeHeader(payload) }
            case "glassButtonState":
                if isMainFrame { model.updateGlassButton(payload) }
            case "browserCloseState":
                if isMainFrame { model.updateBrowserClose(payload) }
            case "sheetCoverage":
                if isMainFrame {
                    model.handleSheetCoverage(payload)
                }
            case "modalOverlayVisibility": model.handleModalOverlayVisibility(payload)
            case "browserViewerVisibility": model.handleBrowserViewerVisibility(payload)
            default: return false
        }
        return true
    }

    @MainActor
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == Self.bridgeName,
            let model,
            let host = message.webView?.url?.host?.lowercased(),
            model.configuration.allowedHosts.contains(host),
            let body = message.body as? [String: Any],
            body["version"] as? Int == 1,
            let action = body["action"] as? String
        else { return }
        if action == "chromeBatch" {
            guard message.frameInfo.isMainFrame,
                  let payload = body["payload"] as? [String: Any],
                  let packets = payload["messages"] as? [[String: Any]], packets.count <= 128 else { return }
            // One callback owns the whole visual snapshot. Only the visual
            // allowlist above is accepted; no permissions or actions are batched.
            for packet in packets {
                guard packet["version"] as? Int == 1,
                      let kind = packet["action"] as? String,
                      let value = packet["payload"] as? [String: Any] else { continue }
                _ = applyChromeMessage(kind, payload: value, isMainFrame: true, model: model)
            }
            return
        }
        // WKScriptMessageHandler delivers on MainActor. Apply geometry and
        // keyboard ownership now, before the next native display pass.
        if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any],
           applyChromeMessage(action, payload: payload, isMainFrame: true, model: model) { return }
        Task { @MainActor in
            if let payload = body["payload"] as? [String: Any], applyChromeMessage(action, payload: payload, isMainFrame: message.frameInfo.isMainFrame, model: model) { return }
            switch action {
            case "focusBrowserKeyboard":
                guard let url = message.frameInfo.request.url,
                      url.scheme == "https" || url.scheme == "http",
                      let sourceHost = url.host?.lowercased(),
                      model.configuration.allowedHosts.contains(sourceHost),
                      url.path.hasPrefix("/api/runs/"), url.path.hasSuffix("/browser"),
                      URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "control" && $0.value == "1" }) == true,
                      let webView = message.webView else { return }
                // Native-origin evaluation lets WebKit open its keyboard even
                // when the remote text-focus event arrives after the local tap.
                _ = try? await webView.callAsyncJavaScript(
                    "const input = document.querySelector('[data-browser-text]'); if (input && !input.hidden) input.focus({preventScroll:true});",
                    arguments: [:], in: message.frameInfo, contentWorld: .page
                )
            case "closeConnectorBrowser":
                if message.frameInfo.isMainFrame,
                   let payload = body["payload"] as? [String: Any], let url = payload["url"] as? String {
                    model.closeConnectorBrowser(url: url)
                }
            case "visibleConversation":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] {
                    NativeExperienceManager.shared.visibleConversationID = payload["runId"] as? String
                }
            case "messageFeedback":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any], let kind = payload["kind"] as? String {
                    model.playMessageFeedback(kind: kind)
                }
            case "messageSendFlight":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] {
                    model.updateSendFlight(payload)
                }
            case "confirmArchive":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] { model.confirmArchive(payload) }
            case "hapticSuccess", "hapticWarning", "hapticError", "hapticSelection":
                model.handleHaptic(action: action)
            case "requestLocation", "cancelLocation":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any], let requestID = payload["requestId"] as? String {
                    if action == "requestLocation" { model.requestSharedLocation(requestID: requestID) }
                    else { model.sharedLocationProvider.cancel(id: requestID) }
                }
            case "messageMenuItems":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] { model.messageMenus.update(payload) }
            case "showMessageMenu":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] { model.showMessageMenu(payload) }
            case "conversationMenuItems":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] { model.updateConversationMenuItems(payload) }
            case "settingsSwipeEnabled":
                break // Compatibility with older web clients; Home no longer opens Settings by swipe.
            case "workspaceState":
                if let payload = body["payload"] as? [String: Any] {
                    model.handleWorkspaceState(payload)
                }
            case "workspaceReady":
                model.workspaceDidBecomeReady(payload: body["payload"] as? [String: Any] ?? [:])
            case "openConversationSupported":
                if message.frameInfo.isMainFrame { model.pageOpensConversationsInPlace = true }
            case "clientDiagnostic":
                if let payload = body["payload"] as? [String: Any] {
                    model.handleClientDiagnostic(payload)
                }
            case "nativeChoiceResult":
                if let payload = body["payload"] as? [String: Any] {
                    model.handleNativeChoiceResult(payload)
                }
            case "openSignInSheet":
                if let payload = body["payload"] as? [String: Any],
                   let runID = payload["runId"] as? String,
                   let url = payload["url"] as? String {
                    model.openSignInSheet(runID: runID, urlString: url, host: payload["host"] as? String ?? "")
                }
            case "savePhotos":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] { model.savePhotos(payload) }
            case "appearanceState":
                if let payload = body["payload"] as? [String: Any] {
                    model.handleAppearanceState(payload)
                }
            case "appleConnections":
                if message.frameInfo.isMainFrame, let payload = body["payload"] as? [String: Any] {
                    model.handleAppleConnections(payload)
                }
            case "requestCalendarStatus":
                model.publishDeviceCalendar(requestAccess: false)
            case "requestCalendarAccess":
                model.publishDeviceCalendar(requestAccess: true)
            case "notificationSettingsStatus":
                if message.frameInfo.isMainFrame { model.publishNotificationSettings() }
            case "manageNotifications":
                if message.frameInfo.isMainFrame { model.manageNotifications() }
            case "openSystemSettings":
                model.openSystemSettings()
            case "openCalendar":
                let timestamp = (body["payload"] as? [String: Any])?["timestamp"] as? TimeInterval
                model.openCalendar(timestamp: timestamp)
            case "unregisterPushToken":
                model.unregisterPushToken()
            case "signedOut":
                model.signedOutFromWorkspace()
            case "reconnectGoogle":
                if let payload = body["payload"] as? [String: Any],
                   let requestID = payload["requestId"] as? String,
                   let runID = payload["runId"] as? String,
                   let authorizationURL = payload["authorizationUrl"] as? String {
                    model.startGoogleReconnect(requestID: requestID, runID: runID, authorizationURL: authorizationURL)
                }
            case "vaultSave", "vaultDelete", "vaultDeleteAll", "vaultRelease":
                if let payload = body["payload"] as? [String: Any] {
                    model.handleDeviceVaultAction(action, payload: payload)
                }
            default:
                break
            }
        }
    }

    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        guard type == .microphone,
              let model,
              let host = webView.url?.host?.lowercased(),
              model.configuration.allowedHosts.contains(host),
              origin.host.lowercased() == host
        else {
            decisionHandler(.deny)
            return
        }
        decisionHandler(.grant)
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let safeName = suggestedFilename.replacingOccurrences(of: "/", with: "-")
        let destination = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
            .appending(path: safeName)
        do {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            destinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } catch {
            completionHandler(nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destination = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        Task { @MainActor in model?.presentDownload(at: destination) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        Task { @MainActor in model?.navigationFailed(error, stage: "download") }
    }
}
