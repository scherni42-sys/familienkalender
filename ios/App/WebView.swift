import SwiftUI
import WebKit
import WidgetKit

// Die Web-App in der App. window.FamTO verbindet sie mit dem iPhone (Code fürs Widget, Spracheingabe)
struct WebView: UIViewRepresentable {
    @ObservedObject var model: AppModel

    func makeCoordinator() -> WebBridge { WebBridge(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let bridge = context.coordinator
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.applicationNameForUserAgent = "FamTO-iOS/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1")"
        let ucc = WKUserContentController()
        ucc.add(bridge, name: "famto")
        ucc.addUserScript(WKUserScript(source: WebBridge.script(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = ucc
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = bridge
        web.uiDelegate = bridge
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = .clear
        bridge.web = web
        model.web = bridge
        web.load(URLRequest(url: model.startURL()))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class WebBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    weak var web: WKWebView?
    let model: AppModel
    init(model: AppModel) { self.model = model }

    static func script() -> String {
        let code = jsString(Config.code)
        let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return """
        window.__famtoCode = \(code);
        window.FamTO = {
          platform: 'ios',
          code: function () { return window.__famtoCode || ''; },
          version: function () { return \(Int(ver) ?? 1); },
          listen: function () { window.webkit.messageHandlers.famto.postMessage({ a: 'listen' }); },
          mic: function (m) { window.webkit.messageHandlers.famto.postMessage({ a: 'mic', m: m || '' }); },
          setup: function () { window.webkit.messageHandlers.famto.postMessage({ a: 'setup' }); },
          setCode: function (c) { window.__famtoCode = c; window.webkit.messageHandlers.famto.postMessage({ a: 'code', c: c }); }
        };
        """
    }

    static func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    func load(_ url: URL) { web?.load(URLRequest(url: url)) }

    func event(_ name: String, detail: String) {
        web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)', { detail: \(WebBridge.jsString(detail)) }))")
    }

    func alert(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        top()?.present(a, animated: true)
    }

    private func top() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var vc = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }

    // Nachrichten aus der Web-App
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let a = body["a"] as? String else { return }
        DispatchQueue.main.async {
            switch a {
            case "listen": self.model.listen()
            case "mic": self.event("famto-mic", detail: body["m"] as? String ?? "new")
            case "code":
                // Persönlicher Code für das Widget, kommt nach der Anmeldung von der Web-App
                if let c = body["c"] as? String, Config.parse(c) != nil, c != Config.code {
                    Config.save(c)
                    WidgetCenter.shared.reloadAllTimelines()
                }
            case "setup":
                self.alert("Widget hinzufügen: Startbildschirm lange drücken, oben links auf „+“ tippen und „FamTO“ wählen.")
            default: break
            }
        }
    }

    // Fremde Seiten (Karten, Teams, Fotos) in Safari bzw. der passenden App öffnen
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let home = URL(string: Config.appURL)?.host
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" || ((url.scheme == "https" || url.scheme == "http") && (url.host == home || action.targetFrame?.isMainFrame == false)) {
            return decisionHandler(.allow)
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // Links mit target=_blank
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // alert() und confirm() der Web-App als iPhone-Dialog
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        if let t = top() { t.present(a, animated: true) } else { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Abbrechen", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        if let t = top() { t.present(a, animated: true) } else { completionHandler(false) }
    }

    // Mikrofon für die Web-App erlauben (z. B. Sprachaufnahme im Browser-Teil)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}
