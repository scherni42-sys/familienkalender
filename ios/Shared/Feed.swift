import Foundation

// Gemeinsam für App und Widget: Verbindungsdaten (Widget-Code „FK1:…“) und das Laden der Familiendaten
enum FamTO {
    static let group = "group.de.famto.app"
    static let defaultApp = "https://app.famto.example/"
    static var store: UserDefaults { UserDefaults(suiteName: group) ?? .standard }
}

struct Config: Codable {
    let u: String   // Supabase-Adresse
    let k: String   // öffentlicher Schlüssel
    let t: String   // persönlicher Widget-Code
    let a: String?  // Adresse der Web-App

    // „FK1:“ + Base64-JSON, wie ihn die App unter Einstellungen erzeugt
    static func parse(_ code: String) -> Config? {
        var s = code.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("FK1:") { s.removeFirst(4) }
        while s.count % 4 != 0 { s += "=" }
        guard let data = Data(base64Encoded: s) else { return nil }
        return try? JSONDecoder().decode(Config.self, from: data)
    }

    static var current: Config? { FamTO.store.string(forKey: "code").flatMap(parse) }
    static var code: String { FamTO.store.string(forKey: "code") ?? "" }
    static func save(_ code: String) { FamTO.store.set(code, forKey: "code") }
    static var appURL: String { current?.a.flatMap { $0.isEmpty ? nil : $0 } ?? FamTO.defaultApp }
}

struct FeedMember: Decodable { let id: String; let name: String; let color: String?; let avatar: String? }
struct FeedEvent: Decodable {
    let id: String; let title: String; let date: String; let end_date: String?
    let all_day: Bool?; let start_min: Int?; let end_min: Int?
    let persons: [String]?; let driver: String?; let vis: String?
}
struct FeedMessage: Decodable {
    let id: String; let from_member: String?; let text: String; let pinned: Bool?; let done: Bool?
    let created_at: String?; let image: String?
}
struct FeedBirthday: Decodable { let id: String; let name: String; let day: Int; let month: Int; let year: Int? }
struct FeedData: Decodable {
    let me: String?
    let members: [FeedMember]
    let events: [FeedEvent]
    let messages: [FeedMessage]
    let birthdays: [FeedBirthday]?
}

enum FeedLoader {
    // Familiendaten über den persönlichen Code laden; bei Fehler der letzte Stand aus dem Zwischenspeicher
    static func load() async -> (FeedData?, String?) {
        guard let c = Config.current, let url = URL(string: "\(c.u)/rest/v1/rpc/display_feed") else {
            return (nil, "Öffne einmal die FamTO-App, dann verbindet sich das Widget.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue(c.k, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(c.k)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["p_token": c.t])
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode ?? 0 < 300 else { throw URLError(.badServerResponse) }
            let feed = try JSONDecoder().decode(FeedData.self, from: data)
            FamTO.store.set(data, forKey: "feed")
            return (feed, nil)
        } catch {
            if let old = FamTO.store.data(forKey: "feed"), let feed = try? JSONDecoder().decode(FeedData.self, from: old) {
                return (feed, "Gerade kein Internet")
            }
            return (nil, "Keine Verbindung")
        }
    }
}
