// The web view showing http://localhost:<port>/, plus the browser duties a bare
// WKWebView lacks: camera access, file pickers, downloads, new windows, print and dialogs.

import AppKit
import WebKit

final class WebViewController: NSViewController {
    private var webView: WKWebView!
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    override func loadView() {
        let contentController = WKUserContentController()
        // window.print() does nothing in a WKWebView, so route it to the native print panel.
        // (The controller keeps this handler alive; both live as long as the app.)
        contentController.addUserScript(WKUserScript(
            source: "window.print = function () { window.webkit.messageHandlers.print.postMessage(''); };",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        contentController.add(self, name: "print")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.websiteDataStore = .default()

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isHidden = true // until the first page has painted, so the window never flashes white

        let container = NSView(frame: webView.frame)
        container.addSubview(webView)
        view = container
    }

    func loadHub(port: Int) {
        guard let url = URL(string: "http://localhost:\(port)/") else { return }
        webView.load(URLRequest(url: url))
    }

    func showStartError(logFile: String) {
        webView.loadHTMLString(startErrorPage(logFile: (logFile as NSString).abbreviatingWithTildeInPath), baseURL: nil)
    }

    @objc func reloadPage(_ sender: Any?) { webView.reload() }

    @objc func goBack(_ sender: Any?) { webView.goBack() }

    private func isHub(_ url: URL) -> Bool { url.host == "localhost" }
}

// MARK: - Navigation and downloads

extension WebViewController: WKNavigationDelegate, WKDownloadDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload {
            decisionHandler(.download)
        } else if action.navigationType == .linkActivated, let url = action.request.url, opensElsewhere(url) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
        let isAttachment = disposition?.lowercased().hasPrefix("attachment") ?? false
        decisionHandler(isAttachment || !response.canShowMIMEType ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.isHidden = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let destination = Self.unusedURL(in: folder, for: suggestedFilename)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        NSWorkspace.shared.activateFileViewerSelecting([file])
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        NSLog("Hub: download failed: \(error.localizedDescription)")
    }

    /// Links off the hub (and mailto:) open in the default browser or mail app.
    private func opensElsewhere(_ url: URL) -> Bool {
        switch url.scheme {
        case "mailto": return true
        case "http", "https": return !isHub(url)
        default: return false
        }
    }

    /// `name.ext`, or `name (2).ext` and so on when that is taken.
    private static func unusedURL(in folder: URL, for suggestedFilename: String) -> URL {
        let name = (suggestedFilename as NSString).lastPathComponent
        let filename = name.isEmpty ? "download" : name
        let base = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension
        var candidate = folder.appendingPathComponent(filename)
        var number = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let numbered = "\(base) (\(number))" + (ext.isEmpty ? "" : ".\(ext)")
            candidate = folder.appendingPathComponent(numbered)
            number += 1
        }
        return candidate
    }
}

// MARK: - Camera, file pickers, new windows and dialogs

extension WebViewController: WKUIDelegate {
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "localhost" ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        guard let window = view.window else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
            return
        }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    /// `window.open` and `target=_blank` open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}

// MARK: - Print

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "print", let window = view.window else { return }
        let operation = webView.printOperation(with: NSPrintInfo.shared)
        operation.view?.frame = webView.bounds // without a frame WebKit prints blank pages
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }
}

// MARK: - Start error page

/// Shown when the server never answers. Inline, so it needs nothing from the server.
private func startErrorPage(logFile: String) -> String {
    let path = logFile
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
    return """
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <title>Hub</title>
    <style>
      :root { color-scheme: dark; }
      html, body { height: 100%; margin: 0; }
      body {
        display: grid; place-items: center; padding: 32px;
        background: oklch(17.5% 0.014 268); color: oklch(96% 0.006 75);
        font: 400 1rem/1.5 "Wix Madefor Text", ui-sans-serif, system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .panel {
        max-width: 560px; padding: 32px 36px; border-radius: 18px;
        background: oklch(22% 0.018 268 / 0.58);
        box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.10), inset 0 0 0 1px oklch(100% 0 0 / 0.06),
          0 40px 80px -32px oklch(8% 0.02 268 / 0.7);
      }
      h1 {
        margin: 0 0 12px; font: 500 1.5rem/1.3 "Wix Madefor Display", ui-sans-serif, system-ui, sans-serif;
        letter-spacing: -0.022em; text-wrap: balance;
      }
      .path { color: oklch(85% 0.010 262); overflow-wrap: anywhere; }
      p { margin: 0; color: oklch(70% 0.016 262); }
    </style>
    </head>
    <body>
    <main class="panel">
      <h1>Hub couldn't start — see <span class="path">\(path)</span></h1>
      <p>Quit Hub and open it again once the problem in the log is fixed.</p>
    </main>
    </body>
    </html>
    """
}
