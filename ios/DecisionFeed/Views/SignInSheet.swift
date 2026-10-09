import SwiftUI
import UIKit
import WebKit

/// A web-initiated request to sign in to a third-party site on the agent's behalf.
struct SignInRequest: Identifiable, Equatable {
    let id = UUID()
    let runID: String
    let url: URL
    let host: String
}

/// What the sheet hands back. Cookies live only in this value until the model
/// dispatches them to the page as one CustomEvent.
enum SignInOutcome {
    case cancelled
    case completed(cookies: [[String: Any]], finalURL: String, login: CapturedSignInLogin? = nil)
}

/// Large-sheet sign-in handoff. The embedded WKWebView uses a fresh
/// non-persistent data store so nothing it collects can leak into the app's
/// main session, and the store is wiped before the sheet is torn down.
struct SignInSheet: View {
    let request: SignInRequest
    let finish: (SignInRequest, SignInOutcome) -> Void

    @StateObject private var controller: SignInWebController
    @State private var isFinishing = false

    init(request: SignInRequest, finish: @escaping (SignInRequest, SignInOutcome) -> Void) {
        self.request = request
        self.finish = finish
        _controller = StateObject(wrappedValue: SignInWebController(url: request.url))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            progressBar
            SignInWebViewContainer(webView: controller.webView)
                .ignoresSafeArea(edges: .bottom)
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .onAppear { controller.loadIfNeeded() }
        .interactiveDismissDisabled()
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            BrandRoundButton(symbol: "xmark", label: "Cancel sign-in") {
                complete(.cancelled)
            }
            .disabled(isFinishing)

            VStack(spacing: 2) {
                Text(request.host)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("Login aman di sini. Anakbuah melanjutkan setelahnya.")
                    .font(.footnote)
                    .foregroundStyle(BrandColor.ink2)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
            .accessibilityElement(children: .combine)

            BrandRoundButton(symbol: "checkmark", label: "Done signing in", prominent: true) {
                guard !isFinishing else { return }
                isFinishing = true
                controller.collectCookies(for: request.url) { cookies, finalURL in
                    complete(.completed(cookies: cookies, finalURL: finalURL, login: controller.capturedLogin))
                }
            }
            .disabled(isFinishing)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(BrandColor.canvas)
    }

    @ViewBuilder private var progressBar: some View {
        ZStack(alignment: .leading) {
            BrandColor.hairline
            if controller.isLoading {
                GeometryReader { proxy in
                    BrandColor.ink
                        .frame(width: max(0, proxy.size.width * controller.progress))
                        .animation(.easeOut(duration: 0.2), value: controller.progress)
                }
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }

    private func complete(_ outcome: SignInOutcome) {
        controller.wipe {
            finish(request, outcome)
        }
    }
}

@MainActor
final class SignInWebController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    @Published private(set) var isLoading = false
    @Published private(set) var progress = 0.0

    let webView: WKWebView
    private let initialURL: URL
    private var capturedUsername = ""
    private var capturedPassword = ""
    private var captureClosed = false
    static let captureWorld = WKContentWorld.world(name: "DashSignInCredentials")

    var capturedLogin: CapturedSignInLogin? {
        guard !capturedUsername.isEmpty, !capturedPassword.isEmpty, let host = initialURL.host else { return nil }
        return CapturedSignInLogin(host: host, username: capturedUsername, password: capturedPassword)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !captureClosed, message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host.lowercased() == initialURL.host?.lowercased(),
              let fields = message.body as? [String: String] else { return }
        if let username = fields["username"], !username.isEmpty, username != capturedUsername {
            capturedUsername = username
            capturedPassword = ""
        }
        if let password = fields["password"] { capturedPassword = password }
    }
    private var hasLoaded = false
    private var progressObservation: NSKeyValueObservation?

    init(url: URL) {
        initialURL = url
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(SignInCaptureProxy(self), contentWorld: Self.captureWorld, name: "credentials")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.captureScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Self.captureWorld))
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            let value = change.newValue ?? 0
            Task { @MainActor in self?.progress = value }
        }
    }

    func loadIfNeeded() {
        guard !hasLoaded else { return }
        hasLoaded = true
        webView.load(URLRequest(url: initialURL))
    }

    /// Reads every cookie the isolated store holds and keeps only the ones that
    /// belong to the target site (or wherever its login flow landed).
    func collectCookies(for url: URL, completion: @escaping ([[String: Any]], String) -> Void) {
        let candidates = Set(
            [url.host, webView.url?.host]
                .compactMap { $0 }
                .map(Self.registrableDomain(of:))
        )
        let finalURL = webView.url?.absoluteString ?? url.absoluteString
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            let matching = cookies.filter { cookie in
                let domain = Self.normalizedDomain(cookie.domain)
                return candidates.contains { candidate in
                    domain == candidate || domain.hasSuffix(".\(candidate)")
                }
            }
            let payload = matching.map(Self.serialize)
            Task { @MainActor in completion(payload, finalURL) }
        }
    }

    /// Drops everything the isolated store collected. Called before the sheet
    /// releases its WKWebView and configuration.
    func wipe(completion: @escaping () -> Void) {
        captureClosed = true
        capturedUsername = ""
        capturedPassword = ""
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "credentials", contentWorld: Self.captureWorld)
        webView.stopLoading()
        let store = webView.configuration.websiteDataStore
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
            Task { @MainActor in completion() }
        }
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        // Login flows hop across https hosts freely; anything else is refused.
        decisionHandler(scheme == "https" || scheme == "about" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Keep popup-based logins inside the isolated view instead of opening Safari.
        if navigationAction.targetFrame == nil,
           navigationAction.request.url?.scheme?.lowercased() == "https" {
            webView.load(navigationAction.request)
        }
        return nil
    }

    // MARK: Helpers

    private static func normalizedDomain(_ domain: String) -> String {
        var value = domain.lowercased()
        while value.hasPrefix(".") { value.removeFirst() }
        return value
    }

    /// Best-effort registrable domain: the last two labels, or three when the
    /// second-level label looks like a country-code second level (co.uk, com.au).
    private static func registrableDomain(of host: String) -> String {
        let labels = normalizedDomain(host).split(separator: ".").map(String.init)
        guard labels.count > 2 else { return labels.joined(separator: ".") }
        let secondLevel = labels[labels.count - 2]
        let topLevel = labels[labels.count - 1]
        let keep = secondLevel.count <= 3 && topLevel.count == 2 ? 3 : 2
        return labels.suffix(keep).joined(separator: ".")
    }

    private static func serialize(_ cookie: HTTPCookie) -> [String: Any] {
        let sameSite: Any
        switch cookie.sameSitePolicy {
        case .some(.sameSiteStrict): sameSite = "Strict"
        case .some(.sameSiteLax): sameSite = "Lax"
        default: sameSite = NSNull()
        }
        let expires: Any = cookie.expiresDate.map { $0.timeIntervalSince1970 as Any } ?? NSNull()
        return [
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path,
            "secure": cookie.isSecure,
            "httpOnly": cookie.isHTTPOnly,
            "expires": expires,
            "sameSite": sameSite,
        ]
    }
}


struct CapturedSignInLogin: Equatable {
    let host: String
    let username: String
    let password: String
}

private final class SignInCaptureProxy: NSObject, WKScriptMessageHandler {
    weak var target: SignInWebController?
    init(_ target: SignInWebController) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

extension SignInWebController {
    // Runs in an isolated content world. No credential values enter page globals,
    // the app's web bridge, logs, or server metadata. Observe autofill as well as typing.
    static let captureScript = #"""
    (() => {
      const scan = () => {
        const inputs = [...document.querySelectorAll('input')];
        const visible = el => !el.disabled && el.getClientRects().length > 0;
        const hint = el => [el.name, el.id, el.autocomplete, el.placeholder].join(' ').toLowerCase();
        const passwords = inputs.filter(el => el.type === 'password' && visible(el));
        const fields = {};
        const username = inputs.find(el => visible(el) && el.autocomplete === 'username')
          || inputs.find(el => visible(el) && el.type === 'email')
          || inputs.find(el => visible(el) && ['text', 'tel'].includes(el.type)
            && /user|email|login/.test(hint(el)) && !/code|otp|token/.test(hint(el)));
        if (username && username.value.trim()) fields.username = username.value.trim();
        if (passwords.length) {
          const password = passwords[0];
          // Signup/reset and one-time codes are not reusable logins.
          fields.password = passwords.length === 1 && !/new-password|one-time-code|confirm|reset|otp/.test(hint(password))
            ? password.value : '';
        }
        if (Object.keys(fields).length) window.webkit.messageHandlers.credentials.postMessage(fields);
      };
      ['input', 'change', 'submit', 'click', 'pagehide'].forEach(event =>
        addEventListener(event, scan, true));
      addEventListener('DOMContentLoaded', scan);
      setInterval(scan, 250);
    })();
    """#
}

private struct SignInWebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Transfer is synchronous; the optional save is independent and cannot fail the handoff.
@MainActor
enum SignInCompletion {
    @discardableResult
    static func deliver(
        login: CapturedSignInLogin?,
        transfer: () -> Void,
        save: @escaping @MainActor (CapturedSignInLogin) async throws -> Void
    ) -> Task<Void, Never>? {
        transfer()
        guard let login else { return nil }
        return Task { try? await save(login) }
    }
}
