import SwiftUI
import WidgetKit

// iPhone-Widget: Heute, Morgen und das Board, wie das Android-Widget
@main
struct FamTOWidgets: WidgetBundle {
    var body: some Widget { TodayWidget() }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FamTOToday", provider: Provider()) { entry in
            WidgetView(entry: entry).containerBackground(Color(.systemBackground), for: .widget)
        }
        .configurationDisplayName("FamTO")
        .description("Heutige Familientermine, morgen und das Board.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct Row: Identifiable {
    let id: String
    let time: String
    let text: String
    let color: Color
    let past: Bool
    let link: String
}

struct BoardRow: Identifiable { let id: String; let text: String; let who: String; let color: Color; let pinned: Bool }

struct Entry: TimelineEntry {
    let date: Date
    let today: [Row]
    let tomorrow: [Row]
    let board: [BoardRow]
    let note: String?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry.sample }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { completion(.sample); return }
        Task { completion(await Entry.load()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let e = await Entry.load()
            // Alle 15 Minuten neu laden, kurz nach Mitternacht sowieso
            let next = min(Date().addingTimeInterval(15 * 60), Calendar.current.startOfDay(for: Date().addingTimeInterval(86400)).addingTimeInterval(60))
            completion(Timeline(entries: [e], policy: .after(next)))
        }
    }
}

extension Color {
    init(hex: String?) {
        var s = (hex ?? "#7a8590").trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let v = UInt64(s, radix: 16) ?? 0x7a8590
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

extension Entry {
    static let sample = Entry(date: Date(),
        today: [Row(id: "1", time: "15:30", text: "Zahnarzt", color: .purple, past: false, link: ""),
                Row(id: "2", time: "17:00", text: "Fußballtraining", color: .orange, past: false, link: "")],
        tomorrow: [Row(id: "3", time: "ganzt.", text: "Gelbe Tonne", color: .gray, past: false, link: "")],
        board: [BoardRow(id: "4", text: "Wer holt Ben von der Kita?", who: "Anna", color: .teal, pinned: false)], note: nil)

    static func load() async -> Entry {
        let (feed, err) = await FeedLoader.load()
        guard let f = feed else { return Entry(date: Date(), today: [], tomorrow: [], board: [], note: err) }
        let cal = Calendar.current
        let iso = DateFormatter(); iso.dateFormat = "yyyy-MM-dd"; iso.locale = Locale(identifier: "en_US_POSIX")
        let now = Date()
        let today = iso.string(from: now), tomorrow = iso.string(from: cal.date(byAdding: .day, value: 1, to: now)!)
        let nowMin = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        let color = Dictionary(uniqueKeysWithValues: f.members.map { ($0.id, Color(hex: $0.color)) })
        let name = Dictionary(uniqueKeysWithValues: f.members.map { ($0.id, $0.name) })
        func hm(_ m: Int) -> String { String(format: "%d:%02d", m / 60, m % 60) }

        func rows(_ d: String, isToday: Bool) -> [Row] {
            let date = iso.date(from: d)!
            var out: [Row] = (f.birthdays ?? []).filter { $0.month == cal.component(.month, from: date) && $0.day == cal.component(.day, from: date) }.map { b in
                let age = b.year.map { " wird \(cal.component(.year, from: date) - $0)" } ?? ""
                return Row(id: "bd" + b.id, time: "Geb.", text: "🎂 \(b.name)\(age)", color: Color(hex: "#C2477A"), past: false, link: "bdays")
            }
            let evs = f.events.filter { $0.date <= d && d <= ($0.end_date ?? $0.date) }
                .sorted { (($0.all_day ?? false) ? -1 : ($0.start_min ?? 0)) < (($1.all_day ?? false) ? -1 : ($1.start_min ?? 0)) }
            for e in evs {
                let allDay = e.all_day ?? false
                let lock = (e.vis ?? "family") != "family" ? "🔒 " : ""
                out.append(Row(id: e.id + d, time: allDay ? "ganzt." : hm(e.start_min ?? 0), text: lock + e.title,
                               color: e.persons?.first.flatMap { color[$0] } ?? .gray,
                               past: isToday && !allDay && (e.end_min ?? 0) <= nowMin, link: "event:\(e.id):\(d)"))
            }
            return out
        }

        let fmt = ISO8601DateFormatter(); fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fmt2 = ISO8601DateFormatter()
        let board = f.messages.filter { !($0.done ?? false) }
            .sorted { a, b in
                if (a.pinned ?? false) != (b.pinned ?? false) { return a.pinned ?? false }
                let da = a.created_at.flatMap { fmt.date(from: $0) ?? fmt2.date(from: $0) } ?? .distantPast
                let db = b.created_at.flatMap { fmt.date(from: $0) ?? fmt2.date(from: $0) } ?? .distantPast
                return da > db
            }
            .prefix(4)
            .map { m in BoardRow(id: m.id, text: (m.image != nil && !m.text.hasPrefix("📷") ? "📷 " : "") + m.text,
                                 who: m.from_member.flatMap { name[$0] } ?? "", color: m.from_member.flatMap { color[$0] } ?? .gray, pinned: m.pinned ?? false) }
        return Entry(date: now, today: rows(today, isToday: true), tomorrow: rows(tomorrow, isToday: false), board: Array(board), note: err)
    }
}

struct WidgetView: View {
    let entry: Entry
    @Environment(\.widgetFamily) var family

    private var head: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = family == .systemSmall ? "EEE d. MMM" : "EEEE, d. MMMM"
        return f.string(from: entry.date)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(head).font(.headline).lineLimit(1)
                Spacer()
                if family != .systemSmall {
                    Link(destination: URL(string: "famto://mic")!) {
                        Image(systemName: "plus").font(.headline).foregroundStyle(Color(hex: "#34A86E"))
                            .frame(width: 28, height: 28).overlay(Circle().stroke(Color(hex: "#34A86E"), lineWidth: 2))
                    }
                }
            }
            if let n = entry.note { Text(n).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
            section("Heute", entry.today, empty: "Keine Familientermine mehr", max: family == .systemLarge ? 5 : family == .systemMedium ? 3 : 3)
            if family == .systemLarge {
                section("Morgen", entry.tomorrow, empty: "Keine Familientermine", max: 3)
                Text("Board").font(.caption.bold()).foregroundStyle(.secondary).padding(.top, 4)
                if entry.board.isEmpty { Text("Keine Nachrichten").font(.caption).foregroundStyle(.secondary) }
                ForEach(entry.board.prefix(3)) { m in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Circle().fill(m.color).frame(width: 8, height: 8)
                        Text((m.pinned ? "📌 " : "") + m.text).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(m.who).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "famto://open"))
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [Row], empty: String, max: Int) -> some View {
        if family != .systemSmall || title != "Heute" {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary).padding(.top, 2)
        }
        if rows.isEmpty { Text(empty).font(.caption).foregroundStyle(.secondary) }
        ForEach(rows.prefix(max)) { r in
            Link(destination: URL(string: "famto://open?x=\(r.link)")!) {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(r.color).frame(width: 4, height: 16)
                    Text(r.time).font(.subheadline.bold()).monospacedDigit().frame(width: family == .systemSmall ? 40 : 48, alignment: .leading)
                    Text(r.text).font(.subheadline).lineLimit(1)
                }
                .opacity(r.past ? 0.45 : 1)
            }
        }
        if rows.count > max { Text("+ \(rows.count - max) weitere").font(.caption2).foregroundStyle(.secondary) }
    }
}
