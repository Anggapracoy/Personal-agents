import SwiftUI
import UIKit

/// Only records completion; optional life preferences are edited in Settings.
/// Omitting those keys preserves any preferences already stored on the account.
struct OnboardingProfileDraft: Encodable {
    let source = "onboarding"
}

struct OnboardingView: View {
    fileprivate enum Step: Int, CaseIterable, Identifiable {
        case promise, signals, notifications
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .promise: "Bantuan kecil,\nsebelum kamu meminta."
            case .signals: "Biarkan Anakbuah\nmenangkap yang penting."
            case .notifications: "Kamu tidak perlu\nterus mengecek."
            }
        }
        var copy: String? {
            switch self {
            case .promise: "Kamu selalu bisa meminta bantuan Anakbuah."
            case .signals: "Hubungkan aplikasi agar Anakbuah bisa membantu."
            case .notifications: "Anakbuah memberi tahu saat kamu dibutuhkan."
            }
        }
        var primaryTitle: String {
            switch self {
            case .promise: "Mulai"
            case .signals: "Lanjutkan"
            case .notifications: "Beri tahu saya"
            }
        }
        var skipTitle: String {
            switch self {
            case .promise: "Lewati"
            case .signals: "Nanti saja"
            case .notifications: "Jangan sekarang"
            }
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var exampleStage = 0
    @State private var selection: Step
    @State private var sourceConnecting: String?
    @State private var requestAppleCalendar = false
    @State private var isCompleting = false
    @State private var completionError: String?
    @State private var sourcePreparation: Task<Void, Never>?
    private let googleConnected: Bool
    private let previewTarget: Step?
    let connectionStatuses: () async -> [String: String]
    let connectSource: (String) async throws -> Void
    let connectICloud: (String, String) async throws -> Void
    let prepareSources: (Bool, Bool) async -> Void
    let requestNotifications: () async -> Bool
    let complete: (OnboardingProfileDraft) async throws -> Void

    init(initialPage: Int = 0, googleConnected: Bool = true, previewTargetPage: Int? = nil,
         connectionStatuses: @escaping () async -> [String: String] = { [:] },
         connectSource: @escaping (String) async throws -> Void = { _ in },
         connectICloud: @escaping (String, String) async throws -> Void = { _, _ in },
         prepareSources: @escaping (Bool, Bool) async -> Void = { _, _ in },
         requestNotifications: @escaping () async -> Bool = { false },
         complete: @escaping (OnboardingProfileDraft) async throws -> Void) {
        _selection = State(initialValue: Step(rawValue: initialPage) ?? .promise)
        self.googleConnected = googleConnected
        self.previewTarget = previewTargetPage.flatMap(Step.init(rawValue:))
        self.connectionStatuses = connectionStatuses
        self.connectSource = connectSource
        self.connectICloud = connectICloud
        self.prepareSources = prepareSources
        self.requestNotifications = requestNotifications
        self.complete = complete
    }

    var body: some View {
        Group {
            if let previewTarget { page(previewTarget) }
            else {
                TabView(selection: Binding(get: { selection }, set: { target in
                    guard target != selection else { return }
                    guard !isCompleting, sourceConnecting == nil else { return }
                    let leavingSources = selection == .signals && target == .notifications
                    // The pager already animated this swipe. Commit its selection
                    // synchronously instead of replaying a second transition.
                    selection = target
                    if leavingSources { prepareInBackground() }
                })) {
                    ForEach(Step.allCases) { step in page(step).tag(step) }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .background(FirstPageBackSwipeBlocker(isEnabled: selection == .promise))
            }
        }
        .background(BrandColor.canvas)
        .ignoresSafeArea(.container)
        .alert("Couldn’t save your setup", isPresented: Binding(
            get: { completionError != nil }, set: { if !$0 { completionError = nil } }
        )) { Button("Try again") { completionError = nil } }
        message: { Text(completionError ?? "Check your connection and try again.") }
    }

    private func page(_ step: Step) -> some View {
        OnboardingPageShell(step: step, exampleStage: exampleStage, busy: isCompleting || sourceConnecting != nil,
                            primary: { advance(step) }, skip: { skip(step) }, back: goBack) {
            switch step {
            case .promise: OnboardingExamples(isActive: previewTarget == .promise || selection == .promise, onReveal: { exampleStage = $0 })
            case .signals:
                SignalsOnboardingContent(googleConnected: googleConnected,
                    requestAppleCalendar: $requestAppleCalendar,
                    connectionStatuses: connectionStatuses, connectSource: connectSource, connectICloud: connectICloud,
                    connecting: $sourceConnecting)
            case .notifications: NotificationsOnboardingContent(isActive: previewTarget == .notifications || selection == .notifications)
            }
        }.ignoresSafeArea(.container)
    }

    private func move(to step: Step) {
        guard !isCompleting, sourceConnecting == nil else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        withAnimation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.9)) { selection = step }
    }

    private func goBack() {
        guard let previous = Step(rawValue: selection.rawValue - 1) else { return }
        move(to: previous)
    }

    private func advance(_ step: Step) {
        guard !isCompleting, sourceConnecting == nil else { return }
        switch step {
        case .promise: move(to: .signals)
        case .signals: prepareAndAdvance()
        case .notifications:
            isCompleting = true
            Task {
                _ = await requestNotifications()
                await finish()
            }
        }
    }

    private func skip(_ step: Step) {
        guard !isCompleting, sourceConnecting == nil else { return }
        if step == .promise { move(to: .signals) }
        else if step == .signals { prepareAndAdvance() }
        else {
            isCompleting = true
            Task { await finish() }
        }
    }

    private func prepareAndAdvance() {
        guard !isCompleting, sourceConnecting == nil else { return }
        prepareInBackground()
        move(to: .notifications)
    }

    private func prepareInBackground() {
        let previous = sourcePreparation
        sourcePreparation = Task {
            await previous?.value
            await prepareSources(requestAppleCalendar, false)
        }
    }

    @MainActor private func finish() async {
        await sourcePreparation?.value
        do { try await complete(OnboardingProfileDraft()) }
        catch {
            isCompleting = false
            completionError = "Dash couldn’t save your setup. Check your connection and try again."
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}

private struct FirstPageBackSwipeBlocker: UIViewRepresentable {
    let isEnabled: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> InstallerView {
        let view = InstallerView()
        view.isUserInteractionEnabled = false
        view.install = { [weak coordinator = context.coordinator, weak view] in
            guard let view else { return }
            coordinator?.installIfNeeded(from: view)
        }
        return view
    }

    func updateUIView(_ uiView: InstallerView, context: Context) {
        context.coordinator.setEnabled(isEnabled)
        DispatchQueue.main.async { [weak uiView, weak coordinator = context.coordinator] in
            guard let uiView else { return }
            coordinator?.installIfNeeded(from: uiView)
        }
    }

    static func dismantleUIView(_ uiView: InstallerView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class InstallerView: UIView {
        var install: (() -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            DispatchQueue.main.async { [weak self] in self?.install?() }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            install?()
        }
    }

    final class Coordinator: NSObject {
        private weak var pagingScrollView: UIScrollView?
        private var blocker: BackPanBlocker?
        private var isEnabled = true

        func setEnabled(_ isEnabled: Bool) {
            self.isEnabled = isEnabled
            blocker?.isEnabled = isEnabled
        }

        func installIfNeeded(from marker: UIView) {
            guard pagingScrollView == nil else { return }
            var ancestor = marker.superview
            while let root = ancestor {
                if let scrollView = pagingScrollView(in: root, excluding: marker) {
                    let blocker = BackPanBlocker()
                    blocker.cancelsTouchesInView = false
                    blocker.isEnabled = isEnabled
                    scrollView.addGestureRecognizer(blocker)
                    scrollView.panGestureRecognizer.require(toFail: blocker)
                    pagingScrollView = scrollView
                    self.blocker = blocker
                    return
                }
                ancestor = root.superview
            }
        }

        func uninstall() {
            if let blocker {
                pagingScrollView?.removeGestureRecognizer(blocker)
            }
            blocker = nil
            pagingScrollView = nil
        }

        private func pagingScrollView(in root: UIView, excluding marker: UIView) -> UIScrollView? {
            for subview in root.subviews where subview !== marker {
                if let scrollView = subview as? UIScrollView, scrollView.isPagingEnabled {
                    return scrollView
                }
                if let match = pagingScrollView(in: subview, excluding: marker) {
                    return match
                }
            }
            return nil
        }
    }

    final class BackPanBlocker: UIGestureRecognizer {
        private var origin: CGPoint?

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            guard touches.count == 1, let touch = touches.first, let view else {
                state = .failed
                return
            }
            origin = touch.location(in: view)
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
            guard state == .possible,
                  let origin,
                  let touch = touches.first,
                  let view else { return }
            let location = touch.location(in: view)
            let horizontalDistance = location.x - origin.x
            let verticalDistance = location.y - origin.y
            guard max(abs(horizontalDistance), abs(verticalDistance)) >= 8 else { return }

            if horizontalDistance > 0, abs(horizontalDistance) > abs(verticalDistance) {
                state = .began
            } else {
                state = .failed
            }
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
            state = state == .began || state == .changed ? .ended : .failed
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
            state = .cancelled
        }

        override func reset() {
            origin = nil
            super.reset()
        }
    }
}

private struct OnboardingPageShell<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let step: OnboardingView.Step
    let exampleStage: Int
    let busy: Bool
    let primary: () -> Void
    let skip: () -> Void
    let back: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { proxy in
            let insets = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows).first(where: \.isKeyWindow)?.safeAreaInsets ?? .zero
            let compact = proxy.size.height < 760
            VStack(spacing: 0) {
                Color.clear.frame(height: 0)
                .padding(.top, max(insets.top, proxy.safeAreaInsets.top) + 12)
                .padding(.bottom, compact ? 16 : 20)

                VStack(spacing: 10) {
                    Text(step.title).font(.title.weight(.semibold)).tracking(-0.5)
                        .padding(.top, 6)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let copy = step.copy {
                        Text(copy).font(.subheadline).foregroundStyle(BrandColor.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.bottom, step == .signals ? 16 : 12)

                if step == .promise {
                    content.padding(.top, 16)
                } else {
                ScrollView {
                    VStack(spacing: 0) {
                        if !typeSize.isAccessibilitySize && step == .notifications {
                            HStack {
                                if step == .signals { Spacer() }
                                Image(step == .promise ? "WelcomeCharacter0" : step == .signals ? "WelcomeCharacter2" : "WelcomeCharacter5")
                                    .resizable().scaledToFit().frame(width: step == .signals ? 44 : 60, height: step == .signals ? 44 : 60)
                                    .rotationEffect(.degrees(step == .signals ? -12 : 8))
                                if step != .signals { Spacer() }
                            }
                            .padding(.horizontal, step == .signals ? 14 : 26)
                            .padding(.bottom, -12)
                            .accessibilityHidden(true).allowsHitTesting(false)
                        }
                        content

                    }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: step == .notifications ? max(0, proxy.size.height * 0.38) : 0, alignment: .top)
                        .padding(.top, step == .notifications ? 21 : 0)
                        .padding(.bottom, 12)
                }
                .scrollIndicators(.hidden)

                }
                Spacer(minLength: 0)
                Group {
                    HStack(spacing: 7) {
                        ForEach(OnboardingView.Step.allCases) { dot in
                            Circle().fill(dot == step ? BrandColor.ink : BrandColor.ink2.opacity(0.3))
                                .frame(width: 7, height: 7)
                        }
                    }
                    .accessibilityLabel("Step \(step.rawValue + 1) of 3")
                    .padding(.vertical, 12)
                }
                VStack(spacing: 4) {
                    Button(action: primary) {
                        HStack(spacing: 10) {
                            if busy { ProgressView().tint(BrandColor.canvas) }
                            Text(step.primaryTitle)
                        }
                        .font(.body.weight(.semibold)).foregroundStyle(BrandColor.canvas)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .brandInkGlass()
                        .contentShape(Capsule())
                    }.buttonStyle(.plain).disabled(busy)
                    Button(action: skip) {
                        Text(step.skipTitle)
                            .font(.subheadline).foregroundStyle(BrandColor.ink2)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).disabled(busy)
                }
                .padding(.top, 12)
                .padding(.bottom, max(8, insets.bottom, proxy.safeAreaInsets.bottom))
            }
            .padding(.horizontal, 24)
            .frame(width: proxy.size.width, height: proxy.size.height)
            .foregroundStyle(BrandColor.ink)
            .background(BrandColor.canvas)
            .overlay(alignment: .topLeading) {
                if step != .promise {
                    BrandRoundButton(symbol: "chevron.left", label: "Previous step", action: back)
                        .disabled(busy)
                        .padding(.leading, 24)
                        .padding(.top, max(insets.top, proxy.safeAreaInsets.top) - 10)
                }
            }
        }
    }
}

/// Examples are illustrative, not controls that start real tasks.
private struct OnboardingExamples: View {
    let isActive: Bool
    let onReveal: (Int) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var stage = 0
    @State private var played = false
    private let messages = [
        "Anniversary on Friday! Find a dinner spot?",
        "Yes, somewhere Italian.",
        "Italian for two at 7. Want me to book it?",
        "Yes, book it.",
        "Booked! Friday at 7, for two."
    ]

    var body: some View {
        VStack(spacing: 18) {
            ForEach(0..<(reduceMotion ? messages.count : stage), id: \.self) { index in
                message(index).id("onboarding-example-\(index)")
                    .transition(.opacity.combined(with: .scale(scale: 0.3, anchor: index == 1 || index == 3 ? .trailing : .leading)))
            }
        }
        .font(.body)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Example conversation")
        .task(id: "\(isActive)-\(reduceMotion)-\(scenePhase == .active)") {
            guard isActive else { return }
            if reduceMotion || played || stage >= messages.count { stage = messages.count; onReveal(stage); return }
            guard scenePhase == .active else { return }
            do {
                while stage < messages.count {
                    try await Task.sleep(for: .milliseconds(stage == 0 ? 333 : 800))
                    try Task.checkCancellation()
                    withAnimation(.easeOut(duration: 0.2)) {
                        stage += 1
                        onReveal(stage)
                    }
                }
                played = true
            } catch { /* Leaving the page cancels remaining example messages. */ }
        }
    }

    @ViewBuilder private func message(_ index: Int) -> some View {
        let outgoing = index == 1 || index == 3
        HStack(alignment: .bottom) {
            if outgoing { Spacer(minLength: 24) }
            VStack(alignment: .leading, spacing: -2) {
                if index == 0 && !typeSize.isAccessibilitySize {
                    Image("WelcomeCharacter0").resizable().scaledToFit().frame(width: 28, height: 28)
                        .padding(.leading, 24).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text(messages[index])
                        .accessibilityLabel("\(outgoing ? "You" : "Dash"): \(messages[index])")
                    if index == 4 {
                        Group {
                            HStack(spacing: 12) {
                                Image("OnboardingRestaurant").resizable().scaledToFill()
                                    .frame(width: 64, height: 64).clipped().accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Willow & Vine").font(.system(size: 16, weight: .semibold))
                                    Text("Example restaurant").font(.system(size: 13)).foregroundStyle(BrandColor.ink2)
                                }.padding(.vertical, 8)
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: 280, alignment: .leading)
                            .background(BrandColor.canvas)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Example restaurant preview: Willow & Vine, illustrative photo")
                    }
                }
                .foregroundStyle(outgoing ? .white : BrandColor.ink)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(outgoing ? BrandColor.messageBlue : BrandColor.soft, in: RoundedRectangle(cornerRadius: 20))
            }
            if !outgoing { Spacer(minLength: 12) }
        }
    }
}

private struct SignalsOnboardingContent: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let googleConnected: Bool
    @Binding var requestAppleCalendar: Bool
    let connectionStatuses: () async -> [String: String]
    let connectSource: (String) async throws -> Void
    let connectICloud: (String, String) async throws -> Void
    @State private var showsICloud = false
    @State private var statuses: [String: String] = [:]
    @Binding var connecting: String?
    @State private var connectionError: String?
    @Environment(\.scenePhase) private var scenePhase

    private struct Source: Identifiable {
        let id: String
        let title: String
        let detail: String
    }
    private let sources: [Source] = [
        .init(id: "google", title: "Google", detail: "Find things to handle in email and calendar"),
        .init(id: "icloud", title: "iCloud Mail", detail: "Let Dash check your iCloud inbox"),
        .init(id: "calendar", title: "Apple Calendar", detail: "Keep plans from clashing"),
        .init(id: "reminders", title: "Reminders", detail: "Help with things on your list"),
        .init(id: "contacts", title: "Contacts", detail: "Find the right person to reach"),
        .init(id: "files", title: "Files & iCloud Drive", detail: "Use files you choose"),
        .init(id: "photos", title: "Photos", detail: "Photos you choose"),
        .init(id: "health", title: "Apple Health", detail: "Fitness and activity"),
        .init(id: "home", title: "Apple Home", detail: "Your home and accessories"),
        .init(id: "music", title: "Apple Music", detail: "Your music library"),
        .init(id: "location", title: "Location", detail: "Help at the right place and time"),
        .init(id: "maps", title: "Maps", detail: "Places and directions"),
        .init(id: "weather", title: "Weather", detail: "Local forecasts"),
        .init(id: "alarms", title: "Alarms & timers", detail: "Wake-ups and countdowns"),
        .init(id: "motion", title: "Motion & activity", detail: "Steps and movement"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(sources) { source in
                let status = statuses[source.id] ?? (source.id == "google" && googleConnected ? "connected" : "disconnected")
                Button {
                    guard connecting == nil else { return }
                    if source.id == "icloud" { showsICloud = true; return }
                    connecting = source.id
                    Task {
                        do {
                            try await connectSource(source.id)
                        } catch { connectionError = error.localizedDescription }
                        statuses = await connectionStatuses()
                        requestAppleCalendar = statuses["calendar"] == "connected"
                        connecting = nil
                    }
                } label: {
                    let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 10))
                    layout {
                        sourceIcon(source).frame(width: 44, height: 44).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(source.title).font(.subheadline.weight(.medium)).foregroundStyle(BrandColor.ink)
                            Text(status == "limited" ? "Limited access" : status == "denied" ? "Review iPhone Settings" : source.detail)
                                .font(.caption).foregroundStyle(BrandColor.ink2)
                        }
                        if !typeSize.isAccessibilitySize { Spacer(minLength: 4) }
                        if connecting == source.id { ProgressView() }
                        else {
                            Text(status == "reconnect_required" ? "Reconnect" : status == "connected" ? "Connected" : status == "limited" ? "Enabled" : status == "unavailable" ? "Unavailable" : "Connect")
                                .font(.subheadline).foregroundStyle(status == "connected" || status == "limited" ? BrandColor.ink2 : BrandColor.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(connecting != nil || ["connected", "limited", "unavailable"].contains(status))
                .accessibilityLabel("\(source.title), \(status)")
                Divider()
            }
            Text("When used, relevant source data is shared with Dash and the providers that power your assistant.")
                .font(.footnote).foregroundStyle(BrandColor.ink2).padding(.top, 16)
        }
        .task { statuses = await connectionStatuses(); requestAppleCalendar = statuses["calendar"] == "connected" }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { statuses = await connectionStatuses() } }
        }
        .sheet(isPresented: $showsICloud) {
            ICloudOnboardingConnection(connect: connectICloud, connected: { Task { statuses = await connectionStatuses() } })
        }
        .alert("Couldn’t connect", isPresented: Binding(get: { connectionError != nil }, set: { if !$0 { connectionError = nil } })) {
            Button("OK") { connectionError = nil }
        } message: { Text(connectionError ?? "Try again.") }
    }

    @ViewBuilder private func sourceIcon(_ source: Source) -> some View {
        if source.id == "icloud" {
            Image(systemName: "envelope.fill")
                .font(.system(size: 20)).foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(.blue, in: RoundedRectangle(cornerRadius: 7))
        } else if source.id == "google" {
            Image("GoogleG").resizable().scaledToFit().frame(width: 30, height: 30)
        } else if let icon = UIImage(named: "Source-\(source.id)") {
            Image(uiImage: icon).resizable().scaledToFit().frame(width: 30, height: 30)
        } else {
            Image(systemName: source.id == "location" ? "location.fill" : source.id == "alarms" ? "alarm.fill" : "figure.walk")
                .font(.system(size: 20)).foregroundStyle(.blue)
                .frame(width: 30, height: 30)
                .background(BrandColor.soft, in: RoundedRectangle(cornerRadius: 7))
        }
    }
}

private struct NotificationsOnboardingContent: View {
    let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var revealed = 0
    private let examples = [
        ("Your table is booked", "Friday at 7, for two. You’re all set."),
        ("Ready for your okay", "Your email is written. Take a look before I send it."),
        ("Your refund came through", "$35 is back in your account."),
        ("A little heads-up", "Rain tomorrow. Want an indoor plan?")
    ]
    private let fades = [1.0, 0.72, 0.44, 0.2]
    var body: some View {
        VStack(spacing: -42) {
            ForEach(examples.indices, id: \.self) { index in
                notification(examples[index].0, copy: examples[index].1, time: "now")
                    .opacity(fades[index])
                    .background(BrandColor.canvas, in: RoundedRectangle(cornerRadius: 22))
                    .opacity(reduceMotion || revealed > index ? 1 : 0)
                    .scaleEffect(reduceMotion || revealed > index ? 1 : 0.3, anchor: .top)
                    .zIndex(Double(4 - index))
            }
        }
        .padding(.vertical, 12)
        .task(id: isActive) {
            guard isActive else { return }
            guard !reduceMotion else { revealed = examples.count; return }
            do {
                while revealed < examples.count {
                    try await Task.sleep(for: .milliseconds(revealed == 0 ? 333 : 500))
                    try Task.checkCancellation()
                    withAnimation(.easeOut(duration: 0.16)) { revealed += 1 }
                }
            } catch { }
        }
    }

    private func notification(_ title: String, copy: String, time: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            BrandMascot().scaledToFit().frame(width: 34, height: 34)
                .padding(5).background(.white, in: RoundedRectangle(cornerRadius: 11))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Dash").font(.footnote.weight(.semibold))
                    Spacer()
                    Text(time).font(.caption).foregroundStyle(BrandColor.ink2)
                }
                Text(title).font(.subheadline.weight(.semibold))
                Text(copy).font(.subheadline).foregroundStyle(BrandColor.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .background(BrandColor.soft, in: RoundedRectangle(cornerRadius: 22))
        .accessibilityElement(children: .combine)
    }
}

private struct ICloudOnboardingConnection: View {
    let connect: (String, String) async throws -> Void
    let connected: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Create a password just for Dash in your Apple account, then paste it below.")
                    Link("Open Apple account settings", destination: URL(string: "https://account.apple.com/")!)
                    TextField("Primary iCloud email", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("App-specific password", text: $password).textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: { Text("Use Apple’s app-specific password, not your usual password. Dash checks your inbox and asks before sending email.") }
                if let error { Text(error).foregroundStyle(.red) }
                Button {
                    busy = true; error = nil
                    Task { do { try await connect(email, password); password = ""; connected(); dismiss() }
                        catch { self.error = error.localizedDescription }; busy = false }
                } label: { HStack { if busy { ProgressView() }; Text(busy ? "Connecting…" : "Connect iCloud Mail") }.frame(maxWidth: .infinity, minHeight: 50).foregroundStyle(BrandColor.canvas).brandInkGlass() }
                .buttonStyle(.plain)
                .disabled(busy || email.isEmpty || password.isEmpty)
            }
            .navigationTitle("iCloud Mail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { password = ""; dismiss() }.disabled(busy) } }
        }
    }
}
