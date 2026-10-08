import QuickLook
import PhotosUI
import SafariServices
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var model = BrowserModel()
    @State private var onboardingPreviewRevision = 0

    var body: some View {
        ZStack {
            Group {
                if model.state == .ready, model.isBrowserViewerVisible {
                    BrandColor.browserSurface
                } else {
                    BrandColor.canvas
                }
            }
            .ignoresSafeArea()

            // The web page owns every pixel, including the status bar and home
            // indicator areas, and lays itself out with env(safe-area-inset-*).
            WebViewContainer(
                webView: model.webView,
                interfaceColorScheme: model.preferredColorScheme
            )
            .opacity(model.state == .ready ? 1 : 0)
            .ignoresSafeArea()

            switch model.state {
            case .starting, .loading:
                LaunchOverlay()
                    .transition(.opacity)
                    .zIndex(1)
            case .signedOut:
                AuthenticationView(
                    authenticatingProvider: model.authenticatingProvider,
                    authenticateGoogle: { model.startAuthentication(provider: .google, intent: .signIn) },
                    authenticateApple: { model.startAuthentication(provider: .apple, intent: .signIn) },
                    openPrivacy: { model.openExternalPage(path: "privacy") },
                    openTerms: { model.openExternalPage(path: "terms") }
                )
            case .onboarding:
                OnboardingView(
                    initialPage: model.onboardingInitialPage,
                    googleConnected: model.onboardingGoogleConnected,
                    previewTargetPage: model.onboardingPreviewTargetPage,
                    connectionStatuses: model.onboardingConnectionStatuses,
                    connectSource: model.connectOnboardingSource,
                    connectICloud: model.connectOnboardingICloud,
                    prepareSources: model.prepareOnboardingSources,
                    requestNotifications: model.requestOnboardingNotifications,
                    complete: model.completeOnboarding
                ).id(onboardingPreviewRevision)
            case .offline:
                StatusOverlay(
                    title: "You’re offline",
                    message: "Dash will open when you’re back online.",
                    symbol: "wifi.slash",
                    retry: model.retry
                )
            case .failed(let message):
                StatusOverlay(
                    title: "Dash couldn’t load",
                    message: message,
                    symbol: "exclamationmark.triangle",
                    retry: model.retry
                )
            case .incompatible:
                StatusOverlay(
                    title: "Update required",
                    message: "This web release needs a newer version of the Dash app.",
                    symbol: "arrow.down.app",
                    retry: nil
                )
            case .ready:
                EmptyView()
            }

            if model.connectionLost {
                ConnectionLostBar()
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 4)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.connectionLost)
        .overlay {
            SendFlightHost(model: model).ignoresSafeArea().allowsHitTesting(false)
        }
        .overlay(alignment: .bottom) {
            if model.state == .ready {
                ZStack(alignment: .bottom) {
                    if let departing = model.departingComposer {
                        NativeComposer(state: departing, dismissal: model.composerDismissal, action: { _, _ in })
                            .padding(.horizontal, 16).padding(.bottom, model.composerKeyboardVisible ? 10 : -4)
                            .offset(x: model.departingComposerOffset)
                            .opacity(model.departingComposerOpacity)
                            .modifier(ComposerTransitionClip(width: model.departingComposerClip, fromLeft: model.navigationFromLeft))
                            .zIndex(model.departingComposerOnTop ? 1 : 0)
                            .allowsHitTesting(false).accessibilityHidden(true)
                    }
                    if let composer = model.composer {
                        NativeComposer(state: composer, dismissal: model.composerDismissal, focusRequest: model.composerFocusRequest, focusOnAppear: model.focusNextThreadComposer && composer.variant == "thread", action: { model.composerAction($0, value: $1, expectedID: composer.id) }, sendAction: model.sendComposer, onFocusHandoff: model.completeComposerFocusHandoff)
                            .padding(.horizontal, 16).padding(.bottom, model.composerKeyboardVisible ? 10 : -4)
                            .offset(x: model.composerOffset)
                            .opacity(model.composerOpacity)
                            .modifier(ComposerTransitionClip(width: model.composerClip, fromLeft: model.navigationFromLeft))
                    }
                }
                // Navigation offsets are already animated by the web coordinator.
                // Keep the keyboard safe-area transaction intact in both directions.
                .animation(nil, value: model.composerOffset)
                .animation(nil, value: model.departingComposerOffset)
                .modifier(SheetChromeCoverage(coverage: model.sheetCoverage, covered: model.hidesBackgroundChrome))
                .allowsHitTesting(!model.isBrowserViewerVisible && !model.isModalOverlayVisible)
                .accessibilityHidden(model.isBrowserViewerVisible || model.isModalOverlayVisible)
                .animation(nil, value: model.isBrowserViewerVisible)
                .animation(nil, value: model.isModalOverlayVisible)
            }
        }
        .overlay {
            SendFlightHost(model: model, textOnly: true).ignoresSafeArea().allowsHitTesting(false)
        }
        .overlay(alignment: .topLeading) {
            if model.state == .ready {
                ZStack(alignment: .topLeading) {
                    if let header = model.departingHomeHeader {
                        NativeHomeHeader(state: header, action: { _ in })
                            .offset(x: model.departingComposerOffset)
                            .opacity(model.departingComposerOpacity)
                            .modifier(ComposerTransitionClip(width: model.departingComposerClip, fromLeft: model.navigationFromLeft))
                            .allowsHitTesting(false).accessibilityHidden(true)
                    }
                    if let header = model.homeHeader {
                        NativeHomeHeader(state: header, action: { model.homeHeaderAction(id: header.id, action: $0) })
                            .offset(x: model.composerOffset)
                            .opacity(model.composerOpacity)
                            .modifier(ComposerTransitionClip(width: model.composerClip, fromLeft: model.navigationFromLeft))
                    }
                    if let header = model.departingChatHeader {
                        NativeChatHeader(state: header, action: { _ in })
                            .offset(x: model.departingComposerOffset)
                            .opacity(model.departingComposerOpacity)
                            .modifier(ComposerTransitionClip(width: model.departingComposerClip, fromLeft: model.navigationFromLeft))
                            .allowsHitTesting(false).accessibilityHidden(true)
                    }
                    if let header = model.chatHeader {
                        NativeChatHeader(state: header, action: { model.chatHeaderAction(id: header.id, action: $0) })
                            .offset(x: model.composerOffset)
                            .opacity(model.composerOpacity)
                            .modifier(ComposerTransitionClip(width: model.composerClip, fromLeft: model.navigationFromLeft))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .ignoresSafeArea()
                .modifier(SheetChromeCoverage(coverage: model.sheetCoverage, covered: model.hidesBackgroundChrome))
                .opacity(model.sheetCoverage?.headerOpacity ?? 1)
                .allowsHitTesting(!model.isBrowserViewerVisible && !model.isModalOverlayVisible)
                .accessibilityHidden(model.isBrowserViewerVisible || model.isModalOverlayVisible)
                .animation(nil, value: model.composerOffset)
                .animation(nil, value: model.departingComposerOffset)
            }
        }
        .overlay(alignment: .topLeading) {
            // The exposed strip includes the status-bar safe area. Give it a
            // native hit target alongside the native close control.
            if model.state == .ready, let close = model.browserClose,
               close.label == "Close Settings", close.opacity > 0, let coverage = model.sheetCoverage,
               coverage.rect.minY > 0 {
                Color.clear
                    .frame(height: coverage.rect.minY)
                    .contentShape(Rectangle())
                    .onTapGesture { model.browserCloseAction(id: close.id, action: "close") }
                    .accessibilityLabel("Dismiss Settings")
                    .accessibilityAddTraits(.isButton)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .ignoresSafeArea()
                    .animation(nil, value: coverage.rect)
            }
        }
        .overlay(alignment: .topLeading) {
            if model.state == .ready, let close = model.browserClose {
                Button { model.browserCloseAction(id: close.id, action: "close") } label: {
                    Image(systemName: "xmark").font(.system(size: 20, weight: .regular))
                        .frame(width: close.frame.width, height: close.frame.height)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .modifier(NativeSheetCloseSurface(isBrowser: close.label == "Hide browser"))
                .accessibilityLabel(close.label)
                .position(x: close.frame.midX, y: close.frame.midY)
                .opacity(close.opacity)
                .allowsHitTesting(close.opacity > 0)
                .accessibilityHidden(close.opacity == 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .ignoresSafeArea()
                .animation(nil, value: close.frame)
                .animation(nil, value: close.opacity)
            }
        }
        .overlay(alignment: .topLeading) {
            if model.state == .ready {
                ForEach(model.glassButtons.values.sorted { $0.id < $1.id }) { button in
                    Button { model.glassButtonAction(id: button.id, action: "press") } label: {
                        Group {
                            if let text = button.text { Text(text).font(.system(size: 17, weight: .semibold)) }
                            else { Image(systemName: button.symbol).font(.system(size: 20, weight: .regular)) }
                        }
                            .frame(width: button.visualSize ?? button.control.frame.width, height: button.visualSize ?? button.control.frame.height)
                            .modifier(ComposerGlass())
                            .frame(width: button.control.frame.width, height: button.control.frame.height)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(BrandColor.ink)
                    .disabled(button.disabled)
                    .accessibilityLabel(button.control.label)
                    .accessibilityHidden(button.control.opacity == 0)
                    .allowsHitTesting(button.control.opacity > 0)
                    .opacity(button.control.opacity * (button.disabled ? 0.4 : 1))
                    .position(x: button.control.frame.midX, y: button.control.frame.midY)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .ignoresSafeArea()
            }
        }
        .overlay(alignment: .topTrailing) {
#if DEBUG
            if model.isDesignPreview {
                Menu {
                    Button("Home · first scan") { model.showDesignPreview("home") }
                    Button("Home · decisions arriving") { model.showDesignPreview("arriving") }
                    Button("Home · no tasks found") { model.showDesignPreview("empty") }
                    Button("Sign in") { model.showDesignPreview("signin") }
                    Button("Onboarding") { onboardingPreviewRevision += 1; model.showDesignPreview("onboarding") }
                    if model.state == .onboarding {
                        Button("Restart animation", systemImage: "arrow.counterclockwise") {
                            onboardingPreviewRevision += 1
                            model.showDesignPreview("onboarding")
                        }
                    }
                } label: {
                    Image(systemName: "eye").font(.caption)
                        .padding(10).modifier(ComposerGlass())
                }
                .accessibilityLabel("Design preview")
                .padding(.trailing, 12).offset(y: -24)
            }
#endif
        }
        .alert("Rename Conversation", isPresented: $model.isRenamingConversation) {
            TextField("Conversation name", text: $model.conversationRenameText)
            Button("Cancel", role: .cancel) {}
            Button("Save") { model.saveConversationName() }
                .disabled(model.conversationRenameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.conversationRenameText.count > 120)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification), perform: model.updateComposerKeyboard)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: model.state == .ready)
        .task { model.start() }
        .preferredColorScheme(model.modalPrefersDarkAppearance ? .dark : model.preferredColorScheme)
        .onOpenURL(perform: model.handleDeepLink)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.receiveSharedDraft(); model.publishNotificationSettings() }
        }
        .sheet(item: $model.browserLink) { link in
            InAppBrowser(url: link.url, onDone: { model.browserLink = nil })
                .ignoresSafeArea()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
        .sheet(item: $model.documentPreview) { item in
            DocumentPreview(url: item.url)
        }
        .sheet(item: $model.shareItem) { item in
            ShareSheet(items: [item.url])
        }
        .sheet(item: $model.signInRequest) { request in
            SignInSheet(request: request, finish: model.finishSignInHandoff)
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
                .presentationCornerRadius(28)
        }
    }
}

enum BrandColor {
    static let send = Color(red: 0, green: 139 / 255, blue: 1)
    /// Product canvas: white in light mode, black in dark mode.
    static let canvas = adaptiveColor(light: (255, 255, 255), dark: (0, 0, 0))
    static let ink = adaptiveColor(light: (17, 17, 17), dark: (244, 244, 244))
    static let ink2 = adaptiveColor(light: (95, 95, 95), dark: (170, 170, 170))
    static let ink3 = adaptiveColor(light: (102, 102, 102), dark: (158, 158, 158))
    static let messageBlue = Color(red: 66 / 255, green: 179 / 255, blue: 250 / 255)
    static let hairline = adaptiveColor(light: (237, 237, 237), dark: (30, 30, 30))
    static let soft = adaptiveColor(light: (243, 243, 243), dark: (22, 22, 22))
    /// Needs-you accent.
    static let amber = Color(red: 232 / 255, green: 163 / 255, blue: 61 / 255)
    static let green = Color(red: 52 / 255, green: 199 / 255, blue: 89 / 255)
    static let browserSurface = Color(red: 22 / 255, green: 20 / 255, blue: 20 / 255)

    static func canvasUIColor(isDark: Bool) -> UIColor {
        isDark ? UIColor(red: 0, green: 0, blue: 0, alpha: 1) : UIColor(red: 1, green: 1, blue: 1, alpha: 1)
    }

    private static func adaptiveColor(
        light: (CGFloat, CGFloat, CGFloat),
        dark: (CGFloat, CGFloat, CGFloat)
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255, alpha: 1)
        })
    }
}

extension View {
    @ViewBuilder
    func brandInkGlass() -> some View {
        if #available(iOS 26, *) {
            glassEffect(.regular.tint(BrandColor.ink).interactive(), in: Capsule())
        } else {
            background(BrandColor.ink, in: Capsule())
        }
    }

    /// Liquid Glass on iOS 26, a plain material below it. Only for tappable surfaces.
    @ViewBuilder
    func brandGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else {
            background(.ultraThinMaterial, in: shape)
        }
    }
}

private struct ConditionalInkGlass: ViewModifier {
    let enabled: Bool
    func body(content: Content) -> some View {
        if enabled { content.brandInkGlass() } else { content }
    }
}

/// 44pt round glass control used for back, close, and confirm affordances.
struct BrandRoundButton: View {
    let symbol: String
    let label: String
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(prominent ? BrandColor.canvas : BrandColor.ink)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .modifier(RoundGlassIfNeeded(enabled: !prominent))
        .accessibilityLabel(label)
    }

    private struct RoundGlassIfNeeded: ViewModifier {
        let enabled: Bool

        func body(content: Content) -> some View {
            if enabled {
                content.modifier(ComposerGlass())
            } else {
                content.brandInkGlass()
            }
        }
    }
}

private struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    let interfaceColorScheme: ColorScheme?

    func makeUIView(context: Context) -> WKWebView {
        applyAppearance(to: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        applyAppearance(to: uiView)
    }

    private func applyAppearance(to webView: WKWebView) {
        let background: UIColor
        switch interfaceColorScheme {
        case .dark:
            webView.overrideUserInterfaceStyle = .dark
            background = BrandColor.canvasUIColor(isDark: true)
        case .light:
            webView.overrideUserInterfaceStyle = .light
            background = BrandColor.canvasUIColor(isDark: false)
        default:
            // Unspecified keeps the web view's prefers-color-scheme tied to the device.
            webView.overrideUserInterfaceStyle = .unspecified
            background = UIColor { BrandColor.canvasUIColor(isDark: $0.userInterfaceStyle == .dark) }
        }

        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.underPageBackgroundColor = background
    }
}

private struct LaunchOverlay: View {
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                BrandColor.canvas.ignoresSafeArea()
                ZStack {
                    Image("WelcomeCharacter0")
                        .resizable().scaledToFit()
                        .frame(width: 76.5, height: 76.5)
                        .offset(x: -104, y: 18)
                    Image("BrandMascotBlack")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .foregroundStyle(BrandColor.ink)
                        .frame(width: 132, height: 132)
                    Image("WelcomeCharacter5")
                        .resizable().scaledToFit()
                        .frame(width: 72, height: 72)
                        .offset(x: 102, y: 25)
                }
                .frame(width: 300, height: 150)
                .scaleEffect(min(1, geometry.size.width / 393))
                .position(x: geometry.size.width / 2, y: geometry.size.height * 0.47)
                .accessibilityHidden(true)
            }
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Dash is loading")
    }
}

private struct AuthenticationView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let authenticatingProvider: BrowserModel.AuthenticationProvider?
    let authenticateGoogle: () -> Void
    let authenticateApple: () -> Void
    let openPrivacy: () -> Void
    let openTerms: () -> Void

    var body: some View {
        GeometryReader { proxy in
            let compact = proxy.size.height < 760
            if typeSize.isAccessibilitySize {
                ScrollView {
                    VStack(spacing: 24) {
                        Text("Dash").font(.title2.weight(.semibold))
                        AuthenticationMascot().frame(width: 100, height: 100)
                        Text("Meet your assistant. Less on your plate.")
                            .font(.title.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        Text("Sign in or create an account.").font(.body).foregroundStyle(BrandColor.ink2)
                        googleButton
                        appleButton
                        legalLine
                    }
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(24)
                }
            } else {
            VStack(spacing: 0) {
                Text("Dash")
                    .font(.system(size: 24, weight: .semibold)).tracking(-0.8)
                    .padding(.top, 12)
                    .frame(height: 56)
                ScrollView {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0,
                                            paused: reduceMotion || scenePhase != .active)) { context in
                        let time = context.date.timeIntervalSinceReferenceDate
                        ZStack {
                            if !typeSize.isAccessibilitySize {
                                welcomeCharacter(0, size: compact ? 72 : 94, rotation: -12, time: time)
                                    .position(x: 15, y: proxy.size.height * 0.10)
                                welcomeCharacter(2, size: compact ? 74 : 94, rotation: 64, time: time)
                                    .position(x: proxy.size.width - 43, y: proxy.size.height * 0.16)
                                welcomeCharacter(3, size: compact ? 76 : 94, rotation: -8, time: time)
                                    .position(x: 20, y: proxy.size.height * 0.30)
                                welcomeCharacter(1, size: compact ? 68 : 86, rotation: -18, time: time)
                                    .position(x: proxy.size.width - 8, y: proxy.size.height * 0.40)
                                welcomeCharacter(5, size: compact ? 74 : 92, rotation: -12, time: time)
                                    .position(x: 38, y: proxy.size.height * 0.57)
                            }
                            VStack(spacing: 18) {
                                AuthenticationMascot().scaledToFit()
                                    .frame(width: compact ? 110 : 128, height: compact ? 110 : 128)
                                Text("Meet your assistant.\nLess on your plate.")
                                    .font(.title.weight(.semibold)).tracking(-0.7)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityAddTraits(.isHeader)
                                Text("Sign in or create an account.")
                                    .font(.body).foregroundStyle(BrandColor.ink2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 44)
                            .padding(.top, compact ? 5 : 17)
                            .offset(y: -10)
                        }
                        .frame(minHeight: max(350, proxy.size.height - (compact ? 246 : 264)))
                    }
                }
                .scrollIndicators(.hidden)
                .scrollDisabled(!typeSize.isAccessibilitySize)
                .scrollBounceBehavior(.basedOnSize)
                VStack(spacing: 12) {
                    googleButton
                    appleButton
                    legalLine.padding(.top, 14)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .foregroundStyle(BrandColor.ink)
            .background(BrandColor.canvas)
            .clipped()
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
    }

    private func welcomeCharacter(_ index: Int, size: CGFloat, rotation: Double, time: Double) -> some View {
        AuthenticationWelcomeCharacter(index: index, time: time, reduceMotion: reduceMotion)
            .frame(width: size, height: size)
            .rotationEffect(.degrees(rotation))
            .allowsHitTesting(false).accessibilityHidden(true)
    }

    private var googleButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            authenticateGoogle()
        } label: {
            HStack(spacing: 12) {
                if authenticatingProvider == .google {
                    ProgressView()
                        .controlSize(.small)
                        .tint(BrandColor.ink)
                        .frame(width: 20, height: 20)
                } else {
                    Image("GoogleG")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 20, height: 20)
                        .accessibilityHidden(true)
                }
                Text("Continue with Google")
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(BrandColor.ink)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, typeSize.isAccessibilitySize ? 16 : 0)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 56)
            .background(BrandColor.canvas, in: Capsule())
            .overlay {
                Capsule().strokeBorder(BrandColor.hairline, lineWidth: 1)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(authenticatingProvider != nil)
        .opacity(authenticatingProvider == nil || authenticatingProvider == .google ? 1 : 0.52)
        .accessibilityHint("Continue using your Google account")
    }

    /// Apple logo and title on the shared dark glass authentication pill.
    private var appleButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            authenticateApple()
        } label: {
            HStack(spacing: 10) {
                if authenticatingProvider == .apple {
                    ProgressView()
                        .controlSize(.small)
                        .tint(BrandColor.canvas)
                        .frame(width: 20, height: 20)
                } else {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 19, weight: .medium))
                        .frame(width: 20, height: 20)
                }
                Text("Continue with Apple")
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(BrandColor.canvas)
            .padding(.horizontal, 16)
            .padding(.vertical, typeSize.isAccessibilitySize ? 16 : 0)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 56)
            .brandInkGlass()
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(authenticatingProvider != nil)
        .opacity(authenticatingProvider == nil || authenticatingProvider == .apple ? 1 : 0.52)
        .accessibilityHint("Continue using your Apple Account")
    }

    private var legalLine: some View {
        VStack(spacing: 3) {
            Text("By continuing, you agree to our")
                .fixedSize(horizontal: false, vertical: true)
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(alignment: .top, spacing: 4))
            layout {
                Button("Terms of Service", action: openTerms).underline()
                    .fixedSize(horizontal: false, vertical: true).frame(minHeight: 44, alignment: .top)
                Text("and")
                Button("Privacy Policy", action: openPrivacy).underline()
                    .fixedSize(horizontal: false, vertical: true).frame(minHeight: 44, alignment: .top)
            }
        }
        .font(.footnote).foregroundStyle(BrandColor.ink2)
        .buttonStyle(.plain)
        .multilineTextAlignment(.center)
    }

}

private struct ConnectionLostBar: View {
    var body: some View {
        Label("No connection", systemImage: "wifi.slash")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(BrandColor.canvas)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(BrandColor.ink, in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel("No connection. Dash will reconnect automatically.")
            .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct StatusOverlay: View {
    let title: String
    let message: String
    let symbol: String
    let retry: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(message)
        } actions: {
            if let retry {
                Button(action: retry) {
                    Text("Try Again").font(.body.weight(.semibold))
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .foregroundStyle(BrandColor.canvas).brandInkGlass()
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
    }
}

private struct DocumentPreview: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismiss
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url, close: { dismiss() }) }
    func makeUIViewController(context: Context) -> UINavigationController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { _ in context.coordinator.close() })
        return UINavigationController(rootViewController: controller)
    }
    func updateUIViewController(_ controller: UINavigationController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        let close: () -> Void
        init(url: URL, close: @escaping () -> Void) { self.url = url; self.close = close }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

/// The sign-in mascot keeps the approved silhouette still while its eyes occasionally glance and blink.
private struct AuthenticationWelcomeCharacter: View {
    let index: Int
    let time: Double
    let reduceMotion: Bool

    private var eyes: [CGPoint] {
        switch index {
        case 0: return [CGPoint(x: 20, y: 22), CGPoint(x: 28, y: 19)]
        case 1: return [CGPoint(x: 18, y: 22), CGPoint(x: 27, y: 22)]
        case 2: return [CGPoint(x: 17, y: 21)]
        case 5: return [CGPoint(x: 18, y: 24), CGPoint(x: 27, y: 24)]
        default: return []
        }
    }

    private var phaseOffset: Double {
        switch index {
        case 1: return 2.1
        case 2: return 4.4
        case 3: return 6.5
        case 5: return 8.6
        default: return 0
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = geometry.size.width / 44
            let phase = (time + phaseOffset).truncatingRemainder(dividingBy: 10.8)
            let blink = reduceMotion ? 1 : 1 - 0.92 * max(0, 1 - abs(phase - 8.1) / 0.11)
            let gaze = reduceMotion ? 0 : gazePosition(at: phase)
            let ink = Color(red: 32 / 255, green: 35 / 255, blue: 43 / 255)

            ZStack(alignment: .topLeading) {
                Image("LoadingCharacter\(index)")
                    .resizable().scaledToFit()

                ForEach(eyes.indices, id: \.self) { eye in
                    let center = eyes[eye]
                    ZStack {
                        Ellipse().fill(.white)
                        Ellipse().fill(ink)
                            .frame(width: 2.6 * 1.159 * scale, height: 3.6 * 1.159 * scale)
                            .offset(x: (0.1 + gaze * 0.65) * scale, y: 0.6 * scale)
                    }
                    .frame(width: 5.6 * 1.159 * scale, height: 7.4 * 1.159 * scale)
                    .scaleEffect(x: 1, y: blink)
                    .position(x: (22 + (center.x - 22) * 1.159) * scale,
                              y: (22 + (center.y - 22) * 1.159) * scale)
                }

                if index == 3 {
                    cloudEyes(scale: scale, squint: 1 - blink)
                        .stroke(ink, style: StrokeStyle(lineWidth: 1.3 * 1.159 * scale,
                                                        lineCap: .round))
                }
            }
        }
    }

    private func gazePosition(at phase: Double) -> Double {
        switch phase {
        case 1.8..<2.1: return -smoothstep((phase - 1.8) / 0.3)
        case 2.1..<2.9: return -1
        case 2.9..<3.2: return -(1 - smoothstep((phase - 2.9) / 0.3))
        case 5.6..<5.9: return smoothstep((phase - 5.6) / 0.3)
        case 5.9..<6.7: return 1
        case 6.7..<7.0: return 1 - smoothstep((phase - 6.7) / 0.3)
        default: return 0
        }
    }

    private func smoothstep(_ value: Double) -> Double {
        let t = min(1, max(0, value))
        return t * t * (3 - 2 * t)
    }

    private func cloudEyes(scale: CGFloat, squint: Double) -> Path {
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: (22 + (x - 22) * 1.159) * scale,
                    y: (22 + (y - 22) * 1.159) * scale)
        }
        let controlY = 19.5 + 2.2 * squint
        var path = Path()
        path.move(to: point(14.5, 23))
        path.addQuadCurve(to: point(19.5, 23), control: point(17, controlY))
        path.move(to: point(25.5, 23))
        path.addQuadCurve(to: point(30.5, 23), control: point(28, controlY))
        return path
    }
}

private struct AuthenticationMascot: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var tappedBlinkAt: Date?

    var body: some View {
        Button {
            // A tap is recognized on release, so the blink starts after the finger lifts.
            tappedBlinkAt = Date()
        } label: {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0,
                                    paused: scenePhase != .active)) { context in
                let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 12)
                let gaze = reduceMotion || scenePhase != .active ? 0 : gazePosition(at: phase)
                let idleBlink = reduceMotion || scenePhase != .active ? 1 : eyeHeight(at: phase)
                let blink = min(idleBlink, tapEyeHeight(at: context.date))

                GeometryReader { proxy in
                    let unit = min(proxy.size.width, proxy.size.height) / 896
                    let origin = CGPoint(x: (proxy.size.width - 896 * unit) / 2,
                                         y: (proxy.size.height - 896 * unit) / 2)
                    let ink = Color(red: 30 / 255, green: 30 / 255, blue: 29 / 255)

                    ZStack(alignment: .topLeading) {
                        BrandMascot()
                            .frame(width: 896 * unit, height: 896 * unit)
                            .offset(x: origin.x, y: origin.y)

                        eye(center: CGPoint(x: 308, y: 493), radius: CGSize(width: 85, height: 103),
                            pupil: CGPoint(x: 344, y: 467), pupilRadius: CGSize(width: 32, height: 34),
                            gaze: gaze, blink: blink, ink: ink, unit: unit, origin: origin)
                        eye(center: CGPoint(x: 615, y: 532), radius: CGSize(width: 107, height: 119),
                            pupil: CGPoint(x: 661, y: 504), pupilRadius: CGSize(width: 35, height: 36),
                            gaze: gaze, blink: blink, ink: ink, unit: unit, origin: origin)
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .rotationEffect(.degrees(gaze * 8))
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .contentShape(Rectangle())
        }
        .buttonStyle(AuthenticationMascotButtonStyle())
        .accessibilityLabel("Make Dash blink")
    }

    private func eye(center: CGPoint, radius: CGSize, pupil: CGPoint, pupilRadius: CGSize,
                     gaze: Double, blink: Double, ink: Color, unit: CGFloat, origin: CGPoint) -> some View {
        ZStack {
            if blink < 1 {
                // Cover the raster eye completely while its eyelids close, then restore it unchanged.
                Ellipse()
                    .fill(ink)
                    .frame(width: (radius.width * 2 + 12) * unit,
                           height: (radius.height * 2 + 12) * unit)
                    .position(x: radius.width * unit, y: radius.height * unit)
                Ellipse()
                    .fill(.white)
                    .frame(width: radius.width * 2 * unit, height: radius.height * 2 * unit)
                    .scaleEffect(x: 1, y: blink)
                    .position(x: radius.width * unit, y: radius.height * unit)
                pupilView(center: center, pupil: pupil, radius: pupilRadius,
                          gaze: gaze, blink: blink, ink: ink, unit: unit,
                          eyeRadius: radius)
            } else {
                // Erase just the pupil baked into the original image.
                Ellipse()
                    .fill(.white)
                    .frame(width: (pupilRadius.width * 2 + 8) * unit,
                           height: (pupilRadius.height * 2 + 8) * unit)
                    .position(x: (pupil.x - center.x) * unit + radius.width * unit,
                              y: (pupil.y - center.y) * unit + radius.height * unit)
                pupilView(center: center, pupil: pupil, radius: pupilRadius,
                          gaze: gaze, blink: 1, ink: ink, unit: unit,
                          eyeRadius: radius)
            }
        }
        .frame(width: radius.width * 2 * unit, height: radius.height * 2 * unit)
        .position(x: origin.x + center.x * unit, y: origin.y + center.y * unit)
    }

    private func pupilView(center: CGPoint, pupil: CGPoint, radius: CGSize,
                           gaze: Double, blink: Double, ink: Color, unit: CGFloat,
                           eyeRadius: CGSize) -> some View {
        Ellipse()
            .fill(ink)
            .frame(width: radius.width * 2 * unit, height: radius.height * 2 * unit)
            .scaleEffect(x: 1, y: blink)
            .position(x: (pupil.x - center.x + gaze * 12) * unit + eyeRadius.width * unit,
                      y: (pupil.y - center.y + abs(gaze) * 2) * blink * unit + eyeRadius.height * unit)
    }

    private func gazePosition(at phase: Double) -> Double {
        switch phase {
        case 2.0..<2.25: return -smoothstep((phase - 2.0) / 0.25)
        case 2.25..<3.3: return -1
        case 3.3..<3.55: return -(1 - smoothstep((phase - 3.3) / 0.25))
        case 5.7..<6.0: return smoothstep((phase - 5.7) / 0.3)
        case 6.0..<7.0: return 1
        case 7.0..<7.3: return 1 - smoothstep((phase - 7.0) / 0.3)
        default: return 0
        }
    }

    private func eyeHeight(at phase: Double) -> Double {
        for center in [1.4, 8.9] {
            let distance = abs(phase - center)
            if distance < 0.12 { return 1 - 0.94 * (1 - distance / 0.12) }
        }
        return 1
    }

    private func tapEyeHeight(at date: Date) -> Double {
        guard let tappedBlinkAt else { return 1 }
        let elapsed = date.timeIntervalSince(tappedBlinkAt)
        guard elapsed >= 0, elapsed < 0.24 else { return 1 }
        return 1 - 0.94 * (1 - abs(elapsed - 0.12) / 0.12)
    }

    private func smoothstep(_ value: Double) -> Double {
        let t = min(1, max(0, value))
        return t * t * (3 - 2 * t)
    }
}

private struct AuthenticationMascotButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
    }
}

/// Keep the existing transparent silhouette while giving its eye cutouts white backing.
struct BrandMascot: View {
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Ellipse()
                    .fill(.white)
                    .frame(width: proxy.size.width * 0.68, height: proxy.size.height * 0.50)
                    .offset(y: proxy.size.height * 0.09)
                Image("BrandMascotBlack")
                    .resizable()
                    .scaledToFit()
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}


struct NativeDraftFile: Equatable, Identifiable {
    let id: String
    let name: String
    let mimeType: String
    let detail: String
    let thumbnailBase64: String

    init?(payload: [String: Any]) {
        guard let id = payload["id"] as? String, !id.isEmpty,
              let name = payload["name"] as? String, !name.isEmpty else { return nil }
        self.id = id; self.name = name
        mimeType = payload["mimeType"] as? String ?? ""
        detail = payload["description"] as? String ?? "File"
        thumbnailBase64 = payload["thumbnailBase64"] as? String ?? ""
    }
}

struct NativeComposerState: Equatable {
    let id: String
    let variant: String
    var text: String
    let placeholder: String
    let disabled: Bool
    let sending: Bool
    let attachments: Bool
    let fileCount: Int
    let error: String
    let voice: String
    let location: String
    let locating: Bool
    var voiceLevels: [Double] = []
    var voiceElapsed: Int = 0
    var draftFiles: [NativeDraftFile] = []
    var replyName = ""
    var replyText = ""
    var stoppable = false
    var sendFlightSupported = false
    var sendMotionSamples: [[Double]] = []
}

// Handle the keyboard action independently from text changes, so pasted lines
// and input-method composition are never mistaken for a send action.
final class ComposerTextView: UITextView {
    var send: (() -> Void)?
    var pasteFiles: ((String) -> Void)?
    var pasteFailure: (() -> Void)?
    private var pasting = false

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), isEditable, pasteFiles != nil,
           UIPasteboard.general.hasImages || UIPasteboard.general.contains(pasteboardTypes: ["public.file-url", "com.adobe.pdf"]) { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    func pastedFiles(from items: [[String: Any]]) throws -> String? {
        var files: [[String: String]] = []
        var total = 0
        for item in items {
            var data: Data?
            var name = ""
            var type = "application/octet-stream"
            if let rawURL = item["public.file-url"] {
                let url = (rawURL as? URL) ?? (rawURL as? String).flatMap(URL.init(string:)) ?? (rawURL as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                if let url, url.isFileURL {
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 30 * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
                    data = try Data(contentsOf: url)
                    name = url.lastPathComponent
                    type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? type
                }
            } else {
                let candidates = item.keys.sorted { a, b in
                    let imageA = item[a] is UIImage || UTType(a)?.conforms(to: .image) == true
                    let imageB = item[b] is UIImage || UTType(b)?.conforms(to: .image) == true
                    return imageA == imageB ? a < b : imageA
                }
                for identifier in candidates {
                    // UIKit's own image object is not always advertised as a
                    // public image/data UTI. Handle it before testing raw bytes.
                    if let image = item[identifier] as? UIImage {
                        data = try NativeAttachmentPicker.photoData(image, budget: max(1, (3 * 1024 * 1024 - total) / max(1, items.count - files.count))); type = "image/jpeg"; name = "Pasted image.jpg"
                        if data != nil { break }
                    }
                    if ["com.apple.webarchive", "com.apple.flat-rtfd", "com.apple.rtfd"].contains(identifier) { continue }
                    guard let kind = UTType(identifier), kind.conforms(to: .data), !kind.conforms(to: .text), !kind.conforms(to: .url) else { continue }
                    if let bytes = item[identifier] as? Data {
                        data = bytes; type = kind.preferredMIMEType ?? type
                        name = "Pasted file.\(kind.preferredFilenameExtension ?? "bin")"
                    }
                    if data != nil { break }
                }
            }
            if var data {
                if type.hasPrefix("image/"), data.count > 2 * 1024 * 1024, let image = UIImage(data: data) {
                    data = try NativeAttachmentPicker.photoData(image, budget: max(1, (3 * 1024 * 1024 - total) / max(1, items.count - files.count)))
                    type = "image/jpeg"; name = (name as NSString).deletingPathExtension + ".jpg"
                }
                total += data.count
                guard total <= 3 * 1024 * 1024, files.count < 6 else { throw CocoaError(.fileReadTooLarge) }
                files.append(["name": name, "type": type, "dataBase64": data.base64EncodedString()])
            }
        }
        guard !files.isEmpty else { return nil }
        return String(data: try JSONSerialization.data(withJSONObject: files), encoding: .utf8)
    }

    override func insertText(_ text: String) {
        if text == "\n", !pasting, markedTextRange == nil {
            send?()
            return
        }
        super.insertText(text)
    }

    override func paste(_ sender: Any?) {
        guard isEditable else { return }
        if let pasteFiles {
            do {
                if let files = try pastedFiles(from: UIPasteboard.general.items) { pasteFiles(files); return }
            } catch { pasteFailure?(); return }
        }
        pasting = true
        defer { pasting = false }
        super.paste(sender)
    }
}

private struct ComposerTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    let disabled: Bool
    let placeholder: String
    let send: () -> Void
    let pasteFiles: ((String) -> Void)?
    let pasteFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = UIColor(BrandColor.ink)
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.returnKeyType = .send
        view.tintColor = UIColor(BrandColor.send)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: ComposerTextView, context: Context) {
        context.coordinator.parent = self
        view.send = send
        view.pasteFiles = pasteFiles
        view.pasteFailure = pasteFailure
        view.isEditable = !disabled
        view.accessibilityLabel = placeholder
        if view.text != text, view.markedTextRange == nil { view.text = text }
        if focused && !disabled && !view.isFirstResponder { view.becomeFirstResponder() }
        if !focused && view.isFirstResponder { view.resignFirstResponder() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let line = uiView.font?.lineHeight ?? 21
        let natural = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let height = min(max(line, natural), line * 5)
        uiView.isScrollEnabled = natural > line * 5
        return CGSize(width: width, height: height)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextEditor
        init(_ parent: ComposerTextEditor) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) { parent.text = textView.text }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.focused = true }
        func textViewDidEndEditing(_ textView: UITextView) { parent.focused = false }
    }
}

// Present pickers directly from the native composer. Clicking a hidden WebKit
// input creates a second context menu anchored to the invisible web composer.
struct NativeAttachmentPicker: UIViewControllerRepresentable {
    enum Kind: String, Identifiable { case photos, files; var id: String { rawValue } }
    let kind: Kind
    let completion: (Result<String?, Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UIViewController {
        if kind == .photos {
            var configuration = PHPickerConfiguration()
            configuration.filter = .images
            configuration.selectionLimit = 6
            configuration.preferredAssetRepresentationMode = .compatible
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = context.coordinator
            return picker
        }
        let types: [UTType] = [.image, .pdf, .plainText, .commaSeparatedText, .json] +
            ["md", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].compactMap { UTType(filenameExtension: $0) }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    static func photoData(_ image: UIImage, budget: Int = 2 * 1024 * 1024) throws -> Data {
        for side in [2048, 1600, 1280, 1024, 768] {
            let scale = min(1, CGFloat(side) / max(image.size.width, image.size.height))
            let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
            let resized = UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            for quality in [0.85, 0.72, 0.58] {
                if let data = resized.jpegData(compressionQuality: quality), data.count <= budget { return data }
            }
        }
        throw CocoaError(.fileReadTooLarge)
    }

    static func file(at url: URL) throws -> [String: String] {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        let imageFile = type?.conforms(to: .image) == true
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= (imageFile ? 30 : 3) * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
        var data = try Data(contentsOf: url)
        var name = url.lastPathComponent
        var mime = type?.preferredMIMEType ?? "application/octet-stream"
        if imageFile, let image = UIImage(data: data) {
            data = try photoData(image)
            name = url.deletingPathExtension().lastPathComponent + ".jpg"; mime = "image/jpeg"
        }
        guard data.count <= 3 * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
        return ["name": name, "type": mime, "dataBase64": data.base64EncodedString()]
    }
    static func encode(_ files: [[String: String]]) throws -> String? {
        guard files.count <= 6, files.reduce(0, { $0 + (Data(base64Encoded: $1["dataBase64"] ?? "")?.count ?? 0) }) <= 3 * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
        guard !files.isEmpty else { return nil }
        return String(data: try JSONSerialization.data(withJSONObject: files), encoding: .utf8)
    }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
        let completion: (Result<String?, Error>) -> Void
        init(completion: @escaping (Result<String?, Error>) -> Void) { self.completion = completion }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { completion(.success(nil)) }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            completion(Result { try NativeAttachmentPicker.encode(urls.map(NativeAttachmentPicker.file)) })
        }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else { completion(.success(nil)); return }
            Task { @MainActor in
                do {
                    var files: [[String: String]] = []
                    for result in results {
                        let provider = result.itemProvider
                        guard let identifier = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) else { throw CocoaError(.fileReadUnknown) }
                        let file: [String: String] = try await withCheckedThrowingContinuation { continuation in
                            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
                                // The provider deletes its temporary file when this callback returns.
                                do {
                                    guard let url else { throw error ?? CocoaError(.fileReadUnknown) }
                                    continuation.resume(returning: try NativeAttachmentPicker.file(at: url))
                                } catch { continuation.resume(throwing: error) }
                            }
                        }
                        files.append(file)
                        _ = try NativeAttachmentPicker.encode(files)
                    }
                    completion(.success(try NativeAttachmentPicker.encode(files)))
                } catch { completion(.failure(error)) }
            }
        }
    }
}

private struct SendFlightHost: UIViewRepresentable {
    let model: BrowserModel
    var textOnly = false
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.backgroundColor = .clear
        if textOnly { model.sendFlightTextHost = view } else { model.sendFlightHost = view }
        return view
    }
    func updateUIView(_ view: UIView, context: Context) {
        if textOnly { model.sendFlightTextHost = view } else { model.sendFlightHost = view }
    }
}

private struct NativeComposer: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let state: NativeComposerState
    let dismissal: Int
    var focusRequest = 0
    var focusOnAppear = false
    let action: (String, String?) -> Void
    var sendAction: ((String, CGRect) -> Void)? = nil
    var onFocusHandoff: (() -> Void)? = nil
    @State private var attachmentPicker: NativeAttachmentPicker.Kind?
    @State private var retainedPhotos: [NativeDraftFile] = []
    private var photos: [NativeDraftFile] { state.draftFiles.filter { $0.mimeType.hasPrefix("image/") } }
    @State private var textFrame = CGRect.zero
    @State private var text = ""
    @State private var focused: Bool = false

    private var canSend: Bool { !voiceBusy && !state.disabled && !state.sending && !state.locating && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state.fileCount > 0 || !state.location.isEmpty) }
    private var voiceBusy: Bool { ["requesting", "recording", "transcribing"].contains(state.voice) }
    private var canStop: Bool { state.stoppable && !voiceBusy && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && state.fileCount == 0 && state.location.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !state.error.isEmpty {
                Text(state.error).font(.footnote).foregroundStyle(.red).lineLimit(2).padding(.horizontal, 12)
            }
            if !state.location.isEmpty || state.locating {
                HStack(spacing: 10) {
                    Image(systemName: "location.fill").foregroundStyle(BrandColor.ink)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(state.locating ? "Finding your location…" : "Current location").font(.subheadline.weight(.semibold))
                        Text(state.locating ? "A one-time location" : "\(state.location) · Attached to this message").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    Button { action("removeLocation", nil) } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).frame(width: 44, height: 44)
                    }
                    .disabled(state.sending)
                    .accessibilityLabel(state.locating ? "Cancel location sharing" : "Remove location")
                }
                .padding(.leading, 14)
                .padding(.trailing, 2)
                .padding(.vertical, 4)
                .background(BrandColor.soft, in: RoundedRectangle(cornerRadius: 16))
            }
            HStack(alignment: .bottom, spacing: 10) {
                    if voiceBusy {
                        Button { action("cancelVoice", nil) } label: {
                            Image(systemName: "xmark").font(.system(size: 18, weight: .medium)).frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .modifier(ComposerGlass())
                        .accessibilityLabel("Cancel dictation")
                    } else {
                    Menu {
                        if !state.draftFiles.isEmpty {
                            Section("Attached files") {
                                ForEach(state.draftFiles) { file in
                                    Menu {
                                        Text(file.detail)
                                        Button("Remove attachment", role: .destructive) { action("removeFile", file.id) }
                                    } label: {
                                        Label(file.name, systemImage: file.mimeType.hasPrefix("image/") ? "photo" : "doc")
                                    }
                                }
                            }
                        }
                        if state.attachments {
                            Button { focused = false; attachmentPicker = .photos } label: { Label("Photo library", systemImage: "photo") }
                            Button { focused = false; attachmentPicker = .files } label: { Label("Attach a file", systemImage: "paperclip") }
                        }
                        Button { focused = false; action("location", nil) } label: { Label("Share location", systemImage: "location") }
                    } label: {
                        Image(systemName: "plus").font(.system(size: 21, weight: .regular))
                            .frame(width: 44, height: 44)
                            .overlay(alignment: .topTrailing) {
                                if state.fileCount > 0 && !state.draftFiles.contains(where: { $0.mimeType.hasPrefix("image/") }) { Text("\(state.fileCount)").font(.caption2.bold()).padding(4).background(BrandColor.ink, in: Circle()).foregroundStyle(BrandColor.canvas) }
                            }
                    }
                    .buttonStyle(.plain)
                    .modifier(ComposerGlass())
                    .disabled(state.disabled || state.sending || state.locating)
                    .accessibilityLabel("Add attachment")
                    .accessibilityHint(state.fileCount > 0 ? "Hold to view attached files" : "")
                    }
                VStack(spacing: 0) {
                    if !state.replyName.isEmpty {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Replying to \(state.replyName)").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                                Text(state.replyText).font(.system(size: 15)).lineLimit(1)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            Button { action("cancelReply", nil) } label: {
                                Image(systemName: "xmark").font(.system(size: 16, weight: .medium)).frame(width: 44, height: 44)
                            }.buttonStyle(.plain).accessibilityLabel("Cancel reply")
                        }
                        .padding(.leading, 10).padding(.trailing, 4).padding(.vertical, 4)
                        .background(BrandColor.soft, in: RoundedRectangle(cornerRadius: 19))
                        .padding(6)
                    }
                    VStack(spacing: 0) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(photos.isEmpty ? retainedPhotos : photos) { file in
                                    ZStack(alignment: .topTrailing) {
                                        Group {
                                            if let data = Data(base64Encoded: file.thumbnailBase64), let image = UIImage(data: data) {
                                                Image(uiImage: image).resizable().scaledToFill()
                                            } else { Color.gray.opacity(0.12).overlay { ProgressView() } }
                                        }
                                        .frame(width: 96, height: 112).clipShape(RoundedRectangle(cornerRadius: 16))
                                        Button { action("removeFile", file.id) } label: {
                                            Image(systemName: "xmark").font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(BrandColor.canvas).frame(width: 26, height: 26)
                                                .brandInkGlass().frame(width: 44, height: 44)
                                        }
                                        .buttonStyle(.plain).disabled(state.sending).accessibilityLabel("Remove \(file.name)")
                                    }
                                }
                            }.padding(8)
                        }.frame(height: 128)
                        Divider().padding(.horizontal, 12)
                    }
                    .frame(height: photos.isEmpty ? 0 : 129, alignment: .top)
                    .clipped()
                    .opacity(photos.isEmpty ? 0 : 1)
                    .allowsHitTesting(!photos.isEmpty)
                    .accessibilityHidden(photos.isEmpty)
                    HStack(alignment: .bottom, spacing: 4) {
                        if voiceBusy {
                            HStack(spacing: 8) {
                                if state.voice == "recording" {
                                    DictationWaveform(levels: state.voiceLevels)
                                        .frame(maxWidth: .infinity).frame(height: 28)
                                    Text(String(format: "%d:%02d", state.voiceElapsed / 60, state.voiceElapsed % 60))
                                        .font(.system(size: 12).monospacedDigit()).foregroundStyle(.secondary)
                                        .accessibilityLabel("Recording, \(state.voiceElapsed) seconds")
                                } else {
                                    Text(state.voice == "requesting" ? "Starting…" : "Transcribing…")
                                        .font(.system(size: 15)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }.frame(height: 44)
                            .animation(.easeOut(duration: 0.16), value: state.voice)
                        } else {
                            ComposerTextEditor(text: $text, focused: $focused, disabled: state.disabled, placeholder: state.placeholder, send: send, pasteFiles: state.attachments && !state.sending ? { action("pasteFiles", $0) } : nil, pasteFailure: { action("pasteError", nil) })
                                .overlay(alignment: .topLeading) {
                                    if text.isEmpty {
                                        Text(state.placeholder).font(.body).foregroundStyle(BrandColor.ink3).lineLimit(1).allowsHitTesting(false)
                                    }
                                }
                                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { textFrame = $0 }
                                .padding(.vertical, 7)
                                .frame(minHeight: 44, alignment: .center)
                                .onChange(of: text) { _, value in
                                    let limited = String(value.prefix(4000))
                                    if limited != value { text = limited }
                                    action("change", limited)
                                }
                        }
                        Button {
                            if canSend { send() } else { focused = false; action("voice", nil) }
                        } label: {
                            Group {
                                if state.voice == "requesting" || state.voice == "transcribing" {
                                    ProgressView().tint(BrandColor.ink)
                                } else {
                                    Image(systemName: canSend ? "arrow.up" : state.voice == "recording" ? "checkmark" : "mic.fill")
                                        .font(.system(size: canSend ? 17 : state.voice == "recording" ? 19 : 17, weight: canSend ? .medium : .regular))
                                }
                            }
                            .foregroundStyle(canSend ? .white : state.voice == "recording" ? BrandColor.canvas : BrandColor.ink)
                            .frame(width: canSend ? 36 : 40, height: canSend ? 27 : 40)
                            .background(canSend ? BrandColor.send : .clear, in: Capsule())
                            .modifier(ConditionalInkGlass(enabled: !canSend && state.voice == "recording"))
                            .frame(width: 44, height: 44)
                            // Preserve a generous target around the smaller visible button.
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(state.disabled || state.sending || state.locating || state.voice == "requesting" || state.voice == "transcribing")
                        .accessibilityLabel(canSend ? "Send" : state.voice == "recording" ? "Finish dictation" : "Use voice input")
                        if canStop {
                            Button { focused = false; action("stop", nil) } label: {
                                RoundedRectangle(cornerRadius: 2).fill(BrandColor.ink2).frame(width: 10, height: 10)
                                    .frame(width: 36, height: 27).background(BrandColor.ink.opacity(0.08), in: Capsule())
                                    .frame(width: 44, height: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(state.disabled || state.sending)
                            .accessibilityLabel("Stop task")
                        }
                    }
                    .padding(.leading, 16)
                    .padding(.trailing, 6)
                    // Keep the 44pt action target inside a slimmer 48pt pill.
                    .padding(.vertical, 2)
                    .frame(minHeight: 48)
                }
                .modifier(ComposerGlass(cornerRadius: 24, frosted: true))
                .background {
                    // Glass paints the padding but does not make it tappable.
                    // Focus only the editor side. Reserve the trailing 50pt
                    // (button + spacing + inset) for voice/send interaction.
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(.clear)
                        .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .onTapGesture {
                            guard !state.disabled, !voiceBusy else { return }
                            focused = true
                        }
                        .padding(.trailing, 50)
                }
            }
            .foregroundStyle(BrandColor.ink)
        }
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 1), value: state.draftFiles.map(\.id))
        .task(id: photos.map(\.id)) {
            if !photos.isEmpty { retainedPhotos = photos }
            else {
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 350))
                if !Task.isCancelled { retainedPhotos = [] }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            action("height", String(Double(max(0, height - 48))))
        }
        .sheet(item: $attachmentPicker) { kind in
            NativeAttachmentPicker(kind: kind) { result in
                attachmentPicker = nil
                switch result {
                case .success(let files): if let files { action("pickedFiles", files) }
                case .failure: action("pickError", nil)
                }
            }.ignoresSafeArea()
        }
        .onAppear {
            text = state.text
            if focusOnAppear { focused = true; onFocusHandoff?() }
        }
        .onChange(of: state.id) { _, _ in
            text = state.text
            if focusOnAppear { focused = true; onFocusHandoff?() }
            else { focused = false }
        }
        .onChange(of: dismissal) { _, _ in focused = false }
        .onChange(of: focusRequest) { _, _ in text = state.text; focused = true }
        .onChange(of: state.text) { _, value in
            // Do not replay delayed web echoes over native typing or marked text.
            if !focused || value.isEmpty || (text.isEmpty && !state.error.isEmpty) { text = value }
        }
    }

    private func send() {
        guard canSend else { return }
        let origin = textFrame
        // Send preserves first responder while the departing text is animated
        // above the composer. Only an explicit dismissal closes the keyboard.
        if let sendAction { sendAction(text, origin) } else { action("send", text) }
    }
}

// A permanent full-row mask flattens Liquid Glass into a rectangular surface.
// Only clip while two pages overlap; idle glass renders in its own capsule.
private struct ComposerTransitionClip: ViewModifier {
    let width: CGFloat
    let fromLeft: Bool

    func body(content: Content) -> some View {
        if width < 10000 {
            // Clip only at the moving horizontal page boundary. Negative bottom
            // padding and glass/shadows extend beyond the row's layout height.
            content.mask(alignment: fromLeft ? .trailing : .leading) {
                Rectangle().padding(.vertical, -64).frame(width: max(0, width))
            }
        } else {
            content
        }
    }
}

private struct ComposerGlass: ViewModifier {
    var cornerRadius: CGFloat = 23
    var interactive = true
    var frosted = false
    var enabled = true
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if !enabled {
            content
        } else if reduceTransparency {
            content.background(BrandColor.soft, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else if #available(iOS 26, *) {
            if frosted {
                content.glassEffect(.regular.tint(colorScheme == .dark ? .clear : .white.opacity(0.15)).interactive(interactive), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            } else {
                content.glassEffect(.regular.interactive(interactive), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            }
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }
}

private struct NativeSheetCloseSurface: ViewModifier {
    let isBrowser: Bool

    func body(content: Content) -> some View {
        if isBrowser {
            content
                .modifier(ComposerGlass())
                .foregroundStyle(Color(red: 244.0 / 255, green: 244.0 / 255, blue: 244.0 / 255))
                .environment(\.colorScheme, .dark)
        } else {
            content.modifier(ComposerGlass()).foregroundStyle(BrandColor.ink)
        }
    }
}


struct NativeHomeHeaderState: Equatable {
    struct Control: Equatable, Identifiable {
        let id: String
        let label: String
        let frame: CGRect
    }
    let id: String
    let registrationId: String
    let archived: Bool
    let searching: Bool
    let buttons: [Control]
    let avatarImage: String
    let avatarInitial: String

    init?(payload: [String: Any]) {
        guard let id = payload["id"] as? String, !id.isEmpty,
              let buttons = payload["buttons"] as? [[String: Any]], (2...3).contains(buttons.count) else { return nil }
        let archived = payload["archived"] as? Bool == true
        var parsed: [Control] = []
        for button in buttons {
            guard let action = button["action"] as? String,
                  [archived ? "back" : "archive", "search", "you"].contains(action),
                  !parsed.contains(where: { $0.id == action }),
                  let label = button["label"] as? String,
                  let x = button["x"] as? Double, let y = button["y"] as? Double,
                  let width = button["width"] as? Double, let height = button["height"] as? Double,
                  [x, y, width, height].allSatisfy({ $0.isFinite }),
                  width >= 44, width <= 100, height >= 44, height <= 100 else { return nil }
            parsed.append(Control(id: action, label: label, frame: CGRect(x: x, y: y, width: width, height: height)))
        }
        self.registrationId = payload["registrationId"] as? String ?? id
        self.id = id; self.archived = archived
        self.searching = payload["searching"] as? Bool == true
        self.buttons = parsed
        avatarImage = payload["avatarImage"] as? String ?? ""
        avatarInitial = String((payload["avatarInitial"] as? String ?? "").prefix(2))
    }
}

private struct NativeHomeHeader: View {
    let state: NativeHomeHeaderState
    let action: (String) -> Void
    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(state.buttons) { control in
                Button { action(control.id) } label: {
                    Group {
                        if control.id == "you" {
                            NativeHomeAvatar(image: state.avatarImage, initial: state.avatarInitial)
                        } else {
                            Image(systemName: control.id == "back" ? "chevron.left" : control.id == "archive" ? "archivebox" : state.searching ? "xmark" : "magnifyingglass")
                                .font(.system(size: 20, weight: .regular))
                        }
                    }
                        .frame(width: control.frame.width, height: control.frame.height)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .modifier(ComposerGlass(enabled: control.id != "you"))
                .shadow(color: control.id == "you" ? .black.opacity(0.12) : .clear, radius: 12, x: 0, y: 6)
                .accessibilityLabel(control.label)
                .position(x: control.frame.midX, y: control.frame.midY)
            }
        }
        .foregroundStyle(BrandColor.ink)
    }
}

@MainActor
final class HomeAvatarPhotoCache {
    private static let photos = NSCache<NSString, UIImage>()
    private static var loading: [String: Task<UIImage?, Never>] = [:]
    static func cached(_ source: String) -> UIImage? { photos.object(forKey: source as NSString) }
    static func load(_ url: URL, session: URLSession = .shared) async -> UIImage? {
        let source = url.absoluteString
        if let photo = cached(source) { return photo }
        if let task = loading[source] { return await task.value }
        let task = Task<UIImage?, Never> {
            guard let (data, response) = try? await session.data(from: url),
                  let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                  data.count <= 3_000_000, let image = UIImage(data: data) else { return nil }
            let photo = image.preparingThumbnail(of: CGSize(width: 132, height: 132)) ?? image
            photos.countLimit = 32
            photos.setObject(photo, forKey: source as NSString)
            return photo
        }
        loading[source] = task
        let photo = await task.value
        loading[source] = nil
        return photo
    }
}

@MainActor
private struct CachedHomeAvatarPhoto: View {
    let url: URL
    let initial: String
    @State private var photo: UIImage?
    init(url: URL, initial: String) {
        self.url = url; self.initial = initial
        _photo = State(initialValue: HomeAvatarPhotoCache.cached(url.absoluteString))
    }
    var body: some View {
        Group {
            if let photo { Image(uiImage: photo).resizable().scaledToFill() }
            else { Text(initial).font(.system(size: 14, weight: .semibold)).frame(width: 44, height: 44).foregroundStyle(BrandColor.canvas).background(BrandColor.ink) }
        }.task(id: url) {
            let loaded = await HomeAvatarPhotoCache.load(url)
            if !Task.isCancelled, let loaded { photo = loaded }
        }
    }
}

@MainActor
private struct NativeHomeAvatar: View {
    let image: String
    let initial: String
    private static var cachedSource = ""
    private static var cachedPhoto: UIImage?
    private var embeddedImage: UIImage? {
        guard image.hasPrefix("data:image/") else { return nil }
        if Self.cachedSource == image { return Self.cachedPhoto }
        Self.cachedSource = image
        guard let comma = image.firstIndex(of: ","),
              let data = Data(base64Encoded: String(image[image.index(after: comma)...])),
              let photo = UIImage(data: data) else { Self.cachedPhoto = nil; return nil }
        // Navigation and sheet updates redraw the header every frame. Decode
        // and downsample a changed photo once, not during each of those redraws.
        Self.cachedPhoto = photo.preparingThumbnail(of: CGSize(width: 132, height: 132)) ?? photo
        return Self.cachedPhoto
    }
    var body: some View {
        Group {
            if let photo = embeddedImage {
                Image(uiImage: photo).resizable().scaledToFill()
            } else if let url = URL(string: image), url.scheme == "https" {
                CachedHomeAvatarPhoto(url: url, initial: initial).id(image)
            } else { initials }
        }
        .frame(width: 44, height: 44).clipShape(Circle())
    }
    private var initials: some View {
        Text(initial).font(.system(size: 14, weight: .semibold))
            .frame(width: 44, height: 44).foregroundStyle(BrandColor.canvas).background(BrandColor.ink)
    }
}

struct NativeGlassButtonState: Equatable, Identifiable {
    let visualSize: CGFloat?
    let text: String?
    let control: NativeBrowserCloseState
    let symbol: String
    let disabled: Bool
    var id: String { control.id }
    init?(payload: [String: Any]) {
        guard let control = NativeBrowserCloseState(payload: payload),
              let symbol = payload["symbol"] as? String,
              ["chevron.left", "chevron.right", "xmark", "square.and.arrow.down", "pencil", "checkmark"].contains(symbol) else { return nil }
        self.control = control
        self.symbol = symbol
        if let size = payload["visualSize"] as? Double, size.isFinite {
            self.visualSize = CGFloat(min(44, max(32, size)))
        } else { self.visualSize = nil }
        self.text = (payload["text"] as? String).map { String($0.prefix(20)) }
        self.disabled = payload["disabled"] as? Bool ?? false
    }
}

struct NativeBrowserCloseState: Equatable {
    let id: String
    let label: String
    let frame: CGRect
    let opacity: Double

    init?(payload: [String: Any]) {
        guard let id = payload["id"] as? String, !id.isEmpty,
              let x = payload["x"] as? Double, let y = payload["y"] as? Double,
              let width = payload["width"] as? Double, let height = payload["height"] as? Double,
              let opacity = payload["opacity"] as? Double,
              [x, y, width, height, opacity].allSatisfy({ $0.isFinite }),
              width >= 44, width <= 100, height >= 44, height <= 100 else { return nil }
        self.id = id
        self.label = payload["label"] as? String ?? "Hide browser"
        self.frame = CGRect(x: x, y: y, width: width, height: height)
        self.opacity = min(1, max(0, opacity))
    }
}

struct NativeChatHeaderState: Equatable {
    let id: String
    let registrationId: String
    let title: String
    let unreadCount: Int
    let activity: String?
    let activitySymbol: String
    var showsActivityIcon: Bool { activity != nil && activity != "Thinking" && activity != "Typing" }
    let back: CGRect
    let label: CGRect
    let browser: CGRect?
    let browserExiting: Bool

    init?(payload: [String: Any]) {
        func rect(_ key: String) -> CGRect? {
            guard let value = payload[key] as? [String: Any],
                  let x = value["x"] as? Double, let y = value["y"] as? Double,
                  let width = value["width"] as? Double, let height = value["height"] as? Double,
                  [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0,
                  width <= 2000, height <= 500 else { return nil }
            return CGRect(x: x, y: y, width: width, height: height)
        }
        guard let id = payload["id"] as? String, let title = payload["title"] as? String,
              let back = rect("back"), let label = rect("label") else { return nil }
        self.registrationId = payload["registrationId"] as? String ?? id
        self.id = id; self.title = title
        self.activity = payload["activity"] as? String
        let symbol = payload["activitySymbol"] as? String ?? "ellipsis.bubble"
        self.activitySymbol = UIImage(systemName: symbol) != nil ? symbol : "ellipsis.bubble"
        self.unreadCount = max(0, payload["unreadCount"] as? Int ?? 0)
        self.back = back; self.label = label; self.browser = rect("browser")
        self.browserExiting = payload["browserExiting"] as? Bool ?? false
    }
}

private struct ChatActivityText: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(text)
            .lineLimit(1).truncationMode(.tail)
            .font(.system(size: 13)).foregroundStyle(BrandColor.ink2)
            .overlay {
                if !reduceMotion {
                    TimelineView(.animation(minimumInterval: 1 / 30)) { context in
                        GeometryReader { geometry in
                            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.8) / 2.8
                            LinearGradient(stops: [.init(color: BrandColor.ink2, location: 0.35), .init(color: BrandColor.ink, location: 0.48), .init(color: BrandColor.ink2, location: 0.61)], startPoint: .leading, endPoint: .trailing)
                                .frame(width: geometry.size.width * 2.5)
                                .offset(x: geometry.size.width * (phase * 3.3 - 2.4))
                        }
                    }
                    .mask(Text(text).lineLimit(1).truncationMode(.tail).font(.system(size: 13)))
                    .accessibilityHidden(true)
                }
            }
    }
}

private struct NativeChatHeader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let state: NativeChatHeaderState
    let action: (String) -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Button { action("back") } label: {
                HStack(spacing: 2) {
                    Image(systemName: "chevron.left").font(.system(size: 20, weight: .regular))
                    if state.unreadCount > 0 {
                        Text(state.unreadCount > 99 ? "99+" : String(state.unreadCount))
                            .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                            .padding(.horizontal, 5).frame(minWidth: 24, minHeight: 24)
                            .background(BrandColor.ink, in: Capsule()).foregroundStyle(BrandColor.canvas)
                    }
                }
                .frame(width: state.back.width, height: state.back.height)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .modifier(ChatHeaderGlass(interactive: true))
            .accessibilityLabel(state.unreadCount > 0 ? "Back, \(state.unreadCount) unread messages" : "Back")
            .position(x: state.back.midX, y: state.back.midY)

            Button { action("details") } label: {
                VStack(spacing: 0) {
                    HStack(spacing: 5) {
                        Text(state.title)
                            .font(.system(size: 17, weight: .semibold))
                            .lineLimit(1).truncationMode(.tail)
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(BrandColor.ink2)
                    }
                    // Web publishes the interpolated label bounds during collapse.
                    // Keep the shrinking row's space so the title never recenters abruptly.
                    HStack(spacing: 6) {
                        if state.showsActivityIcon {
                            Image(uiImage: NativeActivitySymbols.image(state.activitySymbol)).renderingMode(.template)
                                .frame(width: 15, height: 15).foregroundStyle(BrandColor.ink2).accessibilityHidden(true)
                        }
                        ChatActivityText(text: state.activity ?? "")
                    }
                        .frame(height: max(0, min(19, state.label.height - 30)))
                        .clipped()
                        .accessibilityHidden(state.activity == nil)
                }
                    .padding(.horizontal, 12)
                    .frame(width: state.label.width, height: state.label.height)
                    .modifier(ChatHeaderGlass(interactive: true, cornerRadius: max(14, min(18, 18 - (state.label.height - 30) * 4 / 25))))
            }
                .buttonStyle(.plain)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
                .accessibilityLabel("Chat details for \(state.title)")
                .position(x: state.label.midX, y: state.label.midY)

            ZStack {
                if let frame = state.browser {
                    Button { action("browser") } label: {
                        Image(systemName: "desktopcomputer").font(.system(size: 20))
                            .frame(width: max(44, frame.width), height: max(44, frame.height))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .modifier(ChatHeaderGlass(interactive: true))
                    .accessibilityLabel("Open browser")
                    .accessibilityHidden(state.browserExiting)
                    .opacity(state.browserExiting ? 0 : 1)
                    .allowsHitTesting(!state.browserExiting)
                    .position(x: frame.midX, y: frame.midY)
                    .transition(.asymmetric(insertion: .opacity, removal: .identity))
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: state.browser != nil)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: state.browserExiting)
        }
        .foregroundStyle(BrandColor.ink)
    }
}

private struct ChatHeaderGlass: ViewModifier {
    let interactive: Bool
    var cornerRadius: CGFloat = 100
    func body(content: Content) -> some View {
        content.modifier(ComposerGlass(cornerRadius: cornerRadius, interactive: interactive))
    }
}

/// Native controls sit above WKWebView. Cut out the panel's actual moving area
/// so they appear behind it, with the same scrim dimming as the web content.
private struct SheetChromeCoverage: ViewModifier {
    let coverage: SheetCoverage?
    let covered: Bool

    func body(content: Content) -> some View {
        if coverage == nil {
            content.opacity(covered ? 0 : 1)
        } else {
        content
            .colorMultiply(Color(white: 1 - (coverage?.dimming ?? 0)))
            .mask {
                GeometryReader { geometry in
                    ZStack(alignment: .topLeading) {
                        Rectangle().fill(.white)
                        if let coverage {
                            UnevenRoundedRectangle(topLeadingRadius: coverage.radius, topTrailingRadius: coverage.radius)
                                .fill(.black.opacity(coverage.opacity))
                                .frame(width: coverage.rect.width, height: coverage.rect.height)
                                .offset(x: coverage.rect.minX - geometry.frame(in: .global).minX,
                                        y: coverage.rect.minY - geometry.frame(in: .global).minY)
                                .blendMode(.destinationOut)
                        }
                    }
                    .compositingGroup()
                }
            }
            // Full modal overlays hide background chrome even after their
            // animated coverage arrives. Settings and browser sheets retain the
            // uncovered area behind the same coverage mask.
            .opacity(covered ? 0 : 1)
            .transaction { $0.animation = nil }
        }
    }
}

/// A system browser presented above the mounted workspace, so closing it never reloads the conversation.
struct InAppBrowser: UIViewControllerRepresentable {
    let url: URL
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .done
        controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}

    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        let onDone: () -> Void
        init(onDone: @escaping () -> Void) { self.onDone = onDone }
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onDone() }
    }
}

/// Recorded amplitude history, shared with the web input; silence stays flat.
struct DictationWaveform: View {
    let levels: [Double]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { geometry in
            let samples = levels.isEmpty ? Array(repeating: 0.0, count: 40) : levels
            HStack(spacing: 0) {
                ForEach(samples.indices, id: \.self) { index in
                    Capsule()
                        .fill(BrandColor.ink)
                        .frame(width: 2, height: max(2, min(1, max(0, samples[index])) * geometry.size.height))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .animation(reduceMotion ? nil : .linear(duration: 0.08), value: samples)
        }
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.12), .init(color: .black, location: 0.88), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
        .accessibilityHidden(true)
    }
}
