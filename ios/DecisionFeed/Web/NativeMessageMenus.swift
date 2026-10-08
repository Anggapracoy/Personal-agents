import UIKit
import WebKit

struct NativeMessageMenuItem {
    let key: String
    let text: String
    let canReply: Bool
    let canReact: Bool
    let selected: String?
    let rect: CGRect
    let excluded: [CGRect]
    let previewRects: [CGRect]

    init?(_ payload: [String: Any], scale: CGFloat) {
        guard let key = payload["key"] as? String, !key.isEmpty, key.count <= 200,
              let text = payload["text"] as? String, let rect = Self.rect(payload, scale: scale),
              scale.isFinite, scale > 0 else { return nil }
        self.key = key; self.text = text; self.rect = rect
        let shapes = (payload["previewRects"] as? [[String: Any]] ?? []).prefix(4).compactMap { Self.rect($0, scale: scale) }
        previewRects = shapes.isEmpty ? [rect] : shapes
        canReply = payload["canReply"] as? Bool == true
        canReact = payload["canReact"] as? Bool == true
        selected = payload["selected"] as? String
        excluded = (payload["excluded"] as? [[String: Any]] ?? []).compactMap { Self.rect($0, scale: scale) }
    }

    private static func rect(_ payload: [String: Any], scale: CGFloat) -> CGRect? {
        guard let x = payload["x"] as? Double, let y = payload["y"] as? Double,
              let width = payload["width"] as? Double, let height = payload["height"] as? Double,
              [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
        return CGRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale)
    }
    func contains(_ point: CGPoint) -> Bool { rect.contains(point) && !excluded.contains { $0.contains(point) } }
}

/// The feed's context-menu interaction delegates message targets here. UIKit owns
/// the hold recognition, preview, material, haptic, action rows and dismissal.
@MainActor
final class NativeMessageMenus: NSObject {
    private weak var webView: WKWebView?
    private var items: [NativeMessageMenuItem] = []
    private var registeredKeys: Set<String> = []
    private(set) var preview: UITargetedPreview?
    private var activeKey: String?
    private var pendingAction: (() -> Void)?
    private weak var interaction: UIContextMenuInteraction?
    private var menuButton: MessageMenuButton?
    private weak var emojiPicker: UIViewController?

    init(webView: WKWebView) { self.webView = webView; super.init() }
    static func owns(_ configuration: UIContextMenuConfiguration) -> Bool {
        (configuration.identifier as? String)?.hasPrefix("message:") == true
    }
    func update(_ payload: [String: Any]) {
        guard let webView, let width = payload["viewportWidth"] as? Double, width.isFinite, width > 0,
              let values = payload["items"] as? [[String: Any]] else { reset(); return }
        let scale = webView.bounds.width / width
        items = values.prefix(1000).compactMap { NativeMessageMenuItem($0, scale: scale) }
        registeredKeys = Set((payload["keys"] as? [String] ?? items.map(\.key)).prefix(1000))
        if let activeKey, !registeredKeys.contains(activeKey) { dismiss() }
    }
    func reset() { items = []; registeredKeys = []; dismiss() }
    private func dismiss() {
        pendingAction = nil; activeKey = nil; preview = nil
        interaction?.dismissMenu(); interaction = nil
        menuButton?.contextMenuInteraction?.dismissMenu()
        menuButton?.removeFromSuperview(); menuButton = nil
        emojiPicker?.dismiss(animated: false)
    }
    func configuration(at point: CGPoint, interaction: UIContextMenuInteraction) -> UIContextMenuConfiguration? {
        guard let webView, let item = items.first(where: { $0.contains(point) }) else { return nil }
        self.interaction = interaction; activeKey = item.key; pendingAction = nil
        let shapes = item.previewRects.map { $0.intersection(webView.bounds) }.filter { !$0.isEmpty && !$0.isNull }
        let rect = shapes.reduce(CGRect.null) { $0.union($1) }
        guard !rect.isEmpty, let snapshot = webView.resizableSnapshotView(from: rect, afterScreenUpdates: false, withCapInsets: .zero) else { return nil }
        let parameters = UIPreviewParameters()
        parameters.backgroundColor = .clear
        let path = UIBezierPath()
        for shape in shapes {
            let radius = min(20, shape.height / 2)
            path.append(UIBezierPath(cgPath: CGPath(roundedRect: shape.offsetBy(dx: -rect.minX, dy: -rect.minY), cornerWidth: radius, cornerHeight: radius, transform: nil)))
        }
        // UIKit may normalize the preview path; mask the snapshot itself too so
        // content between the badge and bubble cannot enter the lifted preview.
        let mask = CAShapeLayer()
        mask.path = path.cgPath
        snapshot.layer.mask = mask
        let container = UIView(frame: CGRect(origin: .zero, size: rect.size))
        snapshot.frame = container.bounds
        container.addSubview(snapshot)
        parameters.visiblePath = path
        preview = UITargetedPreview(view: container, parameters: parameters,
            target: UIPreviewTarget(container: webView, center: CGPoint(x: rect.midX, y: rect.midY)))
        return UIContextMenuConfiguration(identifier: "message:\(item.key)" as NSString, previewProvider: nil) { [weak self] _ in
            self?.menu(for: item)
        }
    }
    func willEnd(animator: UIContextMenuInteractionAnimating?) {
        let action = pendingAction
        pendingAction = nil
        let complete = { [weak self] in
            self?.preview = nil; self?.activeKey = nil; self?.interaction = nil
            self?.menuButton?.removeFromSuperview(); self?.menuButton = nil
            action?()
        }
        if let animator { animator.addCompletion(complete) } else { complete() }
    }
    /// Public UIButton menu presentation also covers keyboard, VoiceOver and
    /// explicit reaction-badge taps without invoking a private context-menu API.
    func show(key: String) {
        guard #available(iOS 17.4, *) else { return }
        guard let webView, let item = items.first(where: { $0.key == key }), webView.window != nil else { return }
        menuButton?.removeFromSuperview()
        let button = MessageMenuButton(type: .custom)
        button.frame = item.rect
        button.isAccessibilityElement = false
        button.showsMenuAsPrimaryAction = true
        button.menu = menu(for: item)
        button.didEnd = { [weak self] animator in self?.willEnd(animator: animator) }
        webView.addSubview(button)
        menuButton = button; activeKey = key
        button.performPrimaryAction()
    }

    func menu(for item: NativeMessageMenuItem) -> UIMenu {
        func action(_ title: String, symbol: String? = nil, emoji: String? = nil, work: @escaping () -> Void) -> UIAction {
            let image = symbol.flatMap { UIImage(systemName: $0) }
            return UIAction(title: title, image: image, state: emoji != nil && emoji == item.selected ? .on : .off) { [weak self] _ in
                guard let self, self.items.contains(where: { $0.key == item.key && $0.text == item.text }) else { return }
                self.pendingAction = work
            }
        }
        func reaction(_ emoji: String, _ label: String, symbol: String? = nil) -> UIAction {
            action(label, symbol: symbol, emoji: emoji) { [weak self] in self?.send(item, action: "react", emoji: item.selected == emoji ? nil : emoji) }
        }
        var children: [UIMenuElement] = []
        if item.canReact {
            let quick = UIMenu(options: .displayInline, children: [reaction("❤️", "Heart", symbol: "heart.fill"), reaction("👍", "Thumbs up", symbol: "hand.thumbsup.fill"), reaction("👎", "Thumbs down", symbol: "hand.thumbsdown.fill"), reaction("😂", "Laugh", symbol: "face.smiling")])
            quick.preferredElementSize = .small
            children.append(quick)
            children.append(action("More reactions", symbol: "face.smiling") { [weak self] in self?.chooseEmoji(for: item) })
            if item.selected != nil {
                children.append(action("Remove reaction", symbol: "minus.circle") { [weak self] in self?.send(item, action: "react") })
            }
        }
        if item.canReply { children.append(action("Reply", symbol: "arrowshape.turn.up.left") { [weak self] in self?.send(item, action: "reply") }) }
        children.append(action("Copy", symbol: "doc.on.doc") {
            UIPasteboard.general.string = item.text
        })
        return UIMenu(children: children)
    }
    private func send(_ item: NativeMessageMenuItem, action: String, emoji: String? = nil) {
        guard let webView, registeredKeys.contains(item.key) else { return }
        webView.callAsyncJavaScript("""
            if (!window.__decisionFeedMessageAction) throw new Error('This message is no longer available.');
            await window.__decisionFeedMessageAction(key, action, emoji);
            """, arguments: ["key": item.key, "action": action, "emoji": emoji as Any? ?? NSNull()], in: nil, in: .page) { [weak self] result in
                if case .failure = result, let self, self.registeredKeys.contains(item.key) { self.showError(action == "react" ? "Reaction couldn’t send. Please try again." : "This message is no longer available.") }
            }
    }
    private func chooseEmoji(for item: NativeMessageMenuItem) {
        guard let presenter = presenter else { return }
        activeKey = item.key
        let picker = MessageEmojiPicker()
        picker.selected = { [weak self, weak picker] emoji in
            self?.activeKey = nil; self?.emojiPicker = nil
            picker?.dismiss(animated: true)
            self?.send(item, action: "react", emoji: item.selected == emoji ? nil : emoji)
        }
        picker.modalPresentationStyle = .pageSheet
        if let sheet = picker.sheetPresentationController {
            sheet.detents = [.medium()]
            sheet.prefersGrabberVisible = true
        }
        emojiPicker = picker
        presenter.present(picker, animated: true)
    }
    static func isEmoji(_ value: String) -> Bool {
        value.utf16.count <= 32 && value.count == 1
            && value.range(of: #"\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3"#, options: .regularExpression) != nil
    }
    private var presenter: UIViewController? {
        var controller = webView?.window?.rootViewController
        while let presented = controller?.presentedViewController, !presented.isBeingDismissed { controller = presented }
        return controller
    }
    private func showError(_ text: String) {
        guard let presenter else { return }
        let alert = UIAlertController(title: text, message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
    }

}

/// A presentation anchor only; never intercept the web message's taps or links.
private final class MessageMenuButton: UIButton {
    var didEnd: ((UIContextMenuInteractionAnimating?) -> Void)?
    override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration, animator: UIContextMenuInteractionAnimating?) {
        super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
        didEnd?(animator)
    }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? { nil }
}

/// Uses the system emoji keyboard for categories, search, skin tones and recents.
private final class MessageEmojiPicker: UIViewController, UITextFieldDelegate {
    var selected: ((String) -> Void)?
    private let field = EmojiTextField()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel()
        title.text = "Choose a reaction"
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        close.accessibilityLabel = "Close reactions"
        close.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .touchUpInside)
        field.placeholder = "Choose an emoji"
        field.accessibilityLabel = "Reaction emoji"
        field.font = .systemFont(ofSize: 32)
        field.textAlignment = .center
        field.autocorrectionType = .no
        field.delegate = self
        field.addTarget(self, action: #selector(changed), for: .editingChanged)
        for child in [title, close, field] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
        }
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            title.trailingAnchor.constraint(lessThanOrEqualTo: close.leadingAnchor, constant: -12),
            close.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            close.widthAnchor.constraint(equalToConstant: 44), close.heightAnchor.constraint(equalToConstant: 44),
            field.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 20),
            field.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            field.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            field.heightAnchor.constraint(equalToConstant: 52)
        ])
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        field.becomeFirstResponder()
    }
    @objc private func changed() {
        guard field.markedTextRange == nil else { return }
        let value = field.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if NativeMessageMenus.isEmoji(value) {
            field.isEnabled = false
            selected?(value)
        } else { field.text = "" }
    }
}

private final class EmojiTextField: UITextField {
    override var textInputContextIdentifier: String? { "message-reaction" }
    override var textInputMode: UITextInputMode? {
        UITextInputMode.activeInputModes.first { $0.primaryLanguage == "emoji" } ?? super.textInputMode
    }
}
