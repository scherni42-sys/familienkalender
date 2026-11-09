import SwiftUI
import WidgetKit

// FamTO auf dem iPhone: die Web-App läuft in der App (wie auf Android), das Widget liest dieselben Daten
@main
struct FamTOApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 0.114, green: 0.525, blue: 0.341).ignoresSafeArea()
                WebView(model: model)
                    .ignoresSafeArea(.container, edges: .bottom)
                if model.listening { ListenOverlay(model: model) }
            }
            // Tipp im Widget: famto://open?x=… bzw. famto://mic
            .onOpenURL { model.handle($0) }
        }
        .onChange(of: phase) { _, p in
            if p == .active { model.resume() }
            if p == .background { WidgetCenter.shared.reloadAllTimelines() }
        }
    }
}

final class AppModel: ObservableObject {
    @Published var listening = false
    @Published var heard = ""
    weak var web: WebBridge?
    let speech = Speech()

    func startURL(open: String? = nil, mic: String? = nil) -> URL {
        var c = URLComponents(string: Config.appURL) ?? URLComponents(string: FamTO.defaultApp)!
        var q: [URLQueryItem] = []
        if let open, !open.isEmpty { q.append(URLQueryItem(name: "open", value: open)) }
        if let mic, !mic.isEmpty { q.append(URLQueryItem(name: "mic", value: mic)) }
        if !q.isEmpty { c.queryItems = q }
        return c.url!
    }

    func handle(_ url: URL) {
        guard url.scheme == "famto" else { return }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let x = q.first { $0.name == "x" }?.value
        switch url.host {
        case "mic": web?.event("famto-mic", detail: x ?? "new")
        case "open": web?.load(startURL(open: x))
        default: break
        }
    }

    func resume() { web?.event("famto-resume", detail: "") }

    // Spracheingabe für das Eingabefenster der Web-App
    func listen() {
        heard = ""
        speech.start(onText: { [weak self] t in self?.heard = t }, onEnd: { [weak self] t in self?.finish(t) }) { [weak self] ok in
            if ok { self?.listening = true } else { self?.web?.event("famto-speech", detail: ""); self?.web?.alert("Bitte erlaube Mikrofon und Spracherkennung in den Einstellungen für FamTO.") }
        }
    }
    func stopListening() { speech.stop() }
    private func finish(_ text: String) {
        listening = false
        web?.event("famto-speech", detail: text)
    }
}

struct ListenOverlay: View {
    @ObservedObject var model: AppModel
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            VStack(spacing: 14) {
                Image(systemName: "mic.fill").font(.system(size: 36)).foregroundStyle(.white)
                    .frame(width: 84, height: 84).background(Circle().fill(Color.red))
                Text(model.heard.isEmpty ? "Ich höre zu …" : model.heard)
                    .font(.title3).multilineTextAlignment(.center).padding(.horizontal)
                Button("Fertig") { model.stopListening() }
                    .buttonStyle(.borderedProminent).tint(Color(red: 0.114, green: 0.525, blue: 0.341))
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 24).fill(.regularMaterial))
            .padding()
        }
        .background(Color.black.opacity(0.25).ignoresSafeArea())
        .onTapGesture { model.stopListening() }
    }
}
