import ImageIO
import UniformTypeIdentifiers
import UIKit

final class ShareViewController: UIViewController, UITextViewDelegate {
    private let appGroup = "group.com.example.dash"
    private let pendingKey = "wdyt.pendingSharedIntake"
    private let maxFileBytes = 3 * 1024 * 1024

    private var collecting = false
    private let requestID = UUID().uuidString
    private var shared: SharedPayload?

    private let loading = UIStackView()
    private let content = UIStackView()
    private let preview = UILabel()
    private let thumbnail = UIImageView()
    private let message = UITextView()
    private let placeholder = UILabel()
    private let sendButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let status = UILabel()

    private struct SharedPayload {
        var text: String
        var url: String?
        var files: [[String: Any]]
        var image: UIImage?
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildLoading()
        buildContent()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !collecting else { return }
        collecting = true
        Task { await collect() }
    }

    // MARK: Layout

    private func buildLoading() {
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        let label = UILabel()
        label.text = "Getting it ready…"
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .secondaryLabel
        loading.axis = .vertical
        loading.spacing = 10
        loading.alignment = .center
        loading.addArrangedSubview(spinner)
        loading.addArrangedSubview(label)
        loading.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(loading)
        NSLayoutConstraint.activate([
            loading.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loading.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    private func buildContent() {
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        cancelButton.addAction(UIAction { [weak self] _ in self?.cancel() }, for: .touchUpInside)
        sendButton.setTitle("Send", for: .normal)
        sendButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        sendButton.addAction(UIAction { [weak self] _ in self?.send() }, for: .touchUpInside)
        let title = UILabel()
        title.text = "Dash"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textAlignment = .center
        let bar = UIStackView(arrangedSubviews: [cancelButton, title, sendButton])
        bar.distribution = .equalCentering
        bar.alignment = .center

        thumbnail.contentMode = .scaleAspectFill
        thumbnail.clipsToBounds = true
        thumbnail.layer.cornerRadius = 8
        thumbnail.isHidden = true
        thumbnail.widthAnchor.constraint(equalToConstant: 48).isActive = true
        thumbnail.heightAnchor.constraint(equalToConstant: 48).isActive = true
        preview.numberOfLines = 3
        preview.font = .preferredFont(forTextStyle: .subheadline)
        preview.adjustsFontForContentSizeCategory = true
        preview.textColor = .secondaryLabel
        let card = UIStackView(arrangedSubviews: [thumbnail, preview])
        card.spacing = 12
        card.alignment = .center
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 14

        message.font = .preferredFont(forTextStyle: .body)
        message.adjustsFontForContentSizeCategory = true
        message.backgroundColor = .clear
        message.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        message.textContainer.lineFragmentPadding = 0
        message.delegate = self
        message.heightAnchor.constraint(greaterThanOrEqualToConstant: 96).isActive = true
        message.accessibilityLabel = "What should Dash do with this?"
        placeholder.text = "What should Dash do with this? (optional)"
        placeholder.font = .preferredFont(forTextStyle: .body)
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.textColor = .placeholderText
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        message.addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.topAnchor.constraint(equalTo: message.topAnchor, constant: 8),
            placeholder.leadingAnchor.constraint(equalTo: message.leadingAnchor),
            placeholder.trailingAnchor.constraint(equalTo: message.frameLayoutGuide.trailingAnchor),
        ])

        status.numberOfLines = 0
        status.font = .preferredFont(forTextStyle: .footnote)
        status.adjustsFontForContentSizeCategory = true
        status.textColor = .secondaryLabel
        status.isHidden = true

        content.axis = .vertical
        content.spacing = 16
        content.isHidden = true
        [bar, card, message, status].forEach(content.addArrangedSubview)
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            content.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
    }

    func textViewDidChange(_ textView: UITextView) { placeholder.isHidden = !textView.text.isEmpty }

    private func showContent(_ payload: SharedPayload) {
        shared = payload
        let photos = payload.files.filter { ($0["mimeType"] as? String)?.hasPrefix("image/") == true }.count
        let otherFiles = payload.files.count - photos
        var lines: [String] = []
        if let url = payload.url, let host = URL(string: url)?.host { lines.append(host) }
        let text = payload.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { lines.append(text) }
        if photos > 0 { lines.append(photos == 1 ? "1 photo" : "\(photos) photos") }
        if otherFiles > 0 { lines.append(otherFiles == 1 ? "1 file" : "\(otherFiles) files") }
        preview.text = lines.joined(separator: "\n")
        thumbnail.image = payload.image
        thumbnail.isHidden = payload.image == nil
        loading.isHidden = true
        content.isHidden = false
        message.becomeFirstResponder()
    }

    // MARK: Collect

    private func collect() async {
        var textParts: [String] = []
        var sharedURL: String?
        var files: [[String: Any]] = []
        var image: UIImage?
        let providers = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []

        for provider in providers.prefix(8) {
            // Photos may also expose a file URL or filename. Prefer its actual image.
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                guard files.count < 6,
                      let data = try? await provider.imageData(),
                      files.reduce(0, { $0 + ($1["size"] as? Int ?? 0) }) + data.count <= maxFileBytes
                else { showShareError(); return }
                if image == nil { image = UIImage(data: data) }
                files.append(["name": "\(((provider.suggestedName ?? "Photo") as NSString).deletingPathExtension).jpg", "mimeType": "image/jpeg", "size": data.count, "dataBase64": data.base64EncodedString()])
                continue
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), sharedURL == nil,
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier),
               let url = value as? URL, !url.isFileURL {
                sharedURL = url.absoluteString
                continue
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) {
                if let string = value as? String { textParts.append(string); continue }
                else if let attributed = value as? NSAttributedString { textParts.append(attributed.string); continue }
                // Files can advertise plain text but return a file URL. Keep
                // collecting those as attachments instead of dropping them.
            }
            guard files.count < 6 else { showShareError(); return }
            let supported = [UTType.image, .pdf, .plainText, .data]
            guard let type = supported.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }),
                  let value = try? await provider.loadItem(forTypeIdentifier: type.identifier)
            else { continue }
            let fileURL = value as? URL
            let data: Data?
            if let fileURL { data = try? Data(contentsOf: fileURL, options: .mappedIfSafe) }
            else { data = value as? Data ?? (value as? UIImage)?.jpegData(compressionQuality: 0.9) }
            guard let data, !data.isEmpty, files.reduce(0, { $0 + ($1["size"] as? Int ?? 0) }) + data.count <= maxFileBytes else { showShareError(); return }
            files.append([
                "name": fileURL?.lastPathComponent ?? "Shared item",
                "mimeType": fileURL.flatMap { UTType(filenameExtension: $0.pathExtension)?.preferredMIMEType } ?? type.preferredMIMEType ?? "application/octet-stream",
                "size": data.count,
                "dataBase64": data.base64EncodedString(),
            ])
        }
        showContent(SharedPayload(text: textParts.joined(separator: "\n\n"), url: sharedURL, files: files, image: image))
    }

    // MARK: Send

    private func send() {
        guard let shared else { return }
        let note = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
        sendButton.isEnabled = false
        message.isEditable = false
        status.isHidden = false
        status.text = "Sending…"
        Task {
            let outcome = await startConversation(shared, message: note)
            switch outcome {
            case .sent: finish(title: "Sent to Dash", detail: "You’ll get a notification when Dash replies.")
            case .signIn: saveForApp(shared, message: note); finish(title: "Saved for Dash", detail: "Open Dash and sign in to send it.")
            case .failed: showRetry(shared, message: note)
            }
        }
    }

    private enum Outcome { case sent, signIn, failed }

    private struct SharedSession: Decodable {
        let origin: String
        let cookieHeader: String
        let expiresAt: Date
    }

    private func sharedSession() -> SharedSession? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.example.dash.share-session.v1",
            kSecAttrAccount as String: "current",
            kSecAttrAccessGroup as String: appGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data,
              let session = try? JSONDecoder().decode(SharedSession.self, from: data), session.expiresAt > Date() else { return nil }
        return session
    }

    private func startConversation(_ shared: SharedPayload, message: String) async -> Outcome {
        guard let session = sharedSession(), let base = URL(string: session.origin) else { return .signIn }
        let body: [String: Any] = [
            "requestId": requestID.lowercased(),
            "message": message,
            "text": shared.text,
            "url": shared.url ?? "",
            "sourceApp": sourceApplicationName(),
            "timeZone": TimeZone.current.identifier,
            // The server accepts only these keys for each file.
            "files": shared.files.map { ["name": $0["name"] ?? "Shared item", "mimeType": $0["mimeType"] ?? "application/octet-stream", "dataBase64": $0["dataBase64"] ?? ""] },
        ]
        guard JSONSerialization.isValidJSONObject(body), let data = try? JSONSerialization.data(withJSONObject: body) else { return .failed }
        var request = URLRequest(url: base.appending(path: "api/mobile/share"), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.httpMethod = "POST"
        request.httpBody = data
        request.timeoutInterval = 25
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        guard let (_, response) = try? await URLSession.shared.data(for: request), let http = response as? HTTPURLResponse else { return .failed }
        if http.statusCode == 401 || http.statusCode == 403 { return .signIn }
        return (200..<300).contains(http.statusCode) ? .sent : .failed
    }

    /// The app picks this up as a draft the next time it opens.
    private func saveForApp(_ shared: SharedPayload, message: String) {
        let payload: [String: Any] = [
            "requestId": requestID,
            "text": [message, shared.text].filter { !$0.isEmpty }.joined(separator: "\n\n"),
            "url": shared.url ?? "",
            "sourceApp": sourceApplicationName(),
            "files": shared.files,
        ]
        if JSONSerialization.isValidJSONObject(payload), let data = try? JSONSerialization.data(withJSONObject: payload) {
            UserDefaults(suiteName: appGroup)?.set(data, forKey: pendingKey)
        }
    }

    private func finish(title: String, detail: String) {
        view.endEditing(true)
        let check = UIImageView(image: UIImage(systemName: title == "Sent to Dash" ? "checkmark.circle.fill" : "tray.and.arrow.down.fill"))
        check.tintColor = .label
        check.preferredSymbolConfiguration = .init(pointSize: 40, weight: .regular)
        let heading = UILabel()
        heading.text = title
        heading.font = .preferredFont(forTextStyle: .headline)
        let body = UILabel()
        body.text = detail
        body.numberOfLines = 0
        body.textAlignment = .center
        body.font = .preferredFont(forTextStyle: .subheadline)
        body.textColor = .secondaryLabel
        let done = UIStackView(arrangedSubviews: [check, heading, body])
        done.axis = .vertical
        done.spacing = 8
        done.alignment = .center
        done.translatesAutoresizingMaskIntoConstraints = false
        content.isHidden = true
        view.addSubview(done)
        NSLayoutConstraint.activate([
            done.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            done.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            done.leadingAnchor.constraint(greaterThanOrEqualTo: view.layoutMarginsGuide.leadingAnchor),
        ])
        UIAccessibility.post(notification: .announcement, argument: "\(title). \(detail)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
    }

    private func showRetry(_ shared: SharedPayload, message note: String) {
        status.isHidden = true
        let alert = UIAlertController(title: "Couldn’t send to Dash", message: "Check your connection and try again, or save it and send from Dash later.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Try Again", style: .default) { [weak self] _ in self?.send() })
        alert.addAction(UIAlertAction(title: "Save for Later", style: .default) { [weak self] _ in
            self?.saveForApp(shared, message: note)
            self?.finish(title: "Saved for Dash", detail: "It’ll be in your message box next time you open Dash.")
        })
        present(alert, animated: true)
        sendButton.isEnabled = true
        message.isEditable = true
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    private func showShareError() {
        let alert = UIAlertController(title: "Item couldn’t be shared", message: "Try up to 6 files or photos, 3 MB total.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.extensionContext?.completeRequest(returningItems: nil) })
        present(alert, animated: true)
    }

    private func sourceApplicationName() -> String {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let identifier = item.userInfo?["NSExtensionItemSourceApplicationBundleIdentifier"] as? String
        else { return "iPhone" }
        return identifier.split(separator: ".").last.map(String.init)?.capitalized ?? "iPhone"
    }
}

private extension NSItemProvider {
    func imageData() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, error in
                guard let url,
                      let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 2048,
                      ] as CFDictionary),
                      let data = UIImage(cgImage: thumbnail).jpegData(compressionQuality: 0.82)
                else { continuation.resume(throwing: error ?? NSError(domain: "SharePhoto", code: 1)); return }
                // Consume the temporary URL inside its provider callback.
                continuation.resume(returning: data)
            }
        }
    }

    func loadItem(forTypeIdentifier typeIdentifier: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: item) }
            }
        }
    }
}
