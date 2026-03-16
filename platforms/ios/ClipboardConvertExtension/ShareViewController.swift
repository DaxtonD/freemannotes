import Social
import UIKit
import WebKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let markdownButton = UIButton(type: .system)
    private let richTextButton = UIButton(type: .system)
    private let webView = WKWebView(frame: .zero)
    private var sharedText: String = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        configureButtons()
        loadSharedText()
        bootstrapConverter()
    }

    private func configureButtons() {
        markdownButton.setTitle("Copy Markdown", for: .normal)
        richTextButton.setTitle("Copy Rich Text", for: .normal)
        markdownButton.addTarget(self, action: #selector(copyMarkdown), for: .touchUpInside)
        richTextButton.addTarget(self, action: #selector(copyRichText), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [markdownButton, richTextButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    private func bootstrapConverter() {
        webView.isHidden = true
        view.addSubview(webView)
        webView.loadHTMLString("<html><body></body></html>", baseURL: nil)
        if let bundlePath = Bundle.main.path(forResource: "clipboard-converter", ofType: "bundle.js"),
           let script = try? String(contentsOfFile: bundlePath) {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func loadSharedText() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let provider = item.attachments?.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) else {
            return
        }

        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
            DispatchQueue.main.async {
                self?.sharedText = item as? String ?? ""
            }
        }
    }

    @objc private func copyMarkdown() {
        convert(target: "markdown")
    }

    @objc private func copyRichText() {
        convert(target: "rich-text")
    }

    private func convert(target: String) {
        let escaped = sharedText
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        let script = "JSON.stringify(globalThis.FreemanClipboardConverter.prepareConvertedClipboardPayload({ text: \"\(escaped)\" }, \"\(target)\"))"
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            guard let jsonString = result as? String,
                  let data = jsonString.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let text = object["text"] as? String else {
                self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                return
            }

            if let html = object["html"] as? String {
                UIPasteboard.general.setItems([[UTType.plainText.identifier: text, UTType.html.identifier: html]], options: [:])
            } else {
                UIPasteboard.general.string = text
            }
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}