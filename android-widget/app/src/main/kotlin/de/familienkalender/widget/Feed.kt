package de.familienkalender.widget

import android.content.Context
import android.graphics.Color
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.format.TextStyle
import java.util.Locale

// Zugang aus dem Widget-Code der App: Supabase-Adresse, öffentlicher Schlüssel, Display-Token, App-Adresse
data class Config(val url: String, val key: String, val token: String, val app: String)

enum class Kind { SECTION, EVENT, MESSAGE, REPLY, NOTE }

data class Row(
    val kind: Kind,
    val text: String,
    val time: String = "",
    val sub: String = "",
    val color: Int = Color.GRAY,
    val faded: Boolean = false,
    val pinned: Boolean = false,
    val open: String = ""
)

object Feed {
    private const val PREFS = "familien-widget"

    fun parseCode(raw: String): Config? = try {
        val code = raw.trim().removePrefix("FK1:").trim()
        val o = JSONObject(String(Base64.decode(code, Base64.DEFAULT), Charsets.UTF_8))
        Config(o.getString("u").trimEnd('/'), o.getString("k"), o.getString("t"), o.optString("a"))
    } catch (e: Exception) {
        null
    }

    fun config(ctx: Context): Config? =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("code", null)?.let(::parseCode)

    fun saveCode(ctx: Context, code: String) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("code", code.trim()).apply()

    private fun cache(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // Torten-Knopf: Widget zeigt statt Heute/Pinnwand die Geburtstage, bis er nochmal gedrückt wird
    fun bdMode(ctx: Context) = cache(ctx).getBoolean("bd", false)
    fun toggleBd(ctx: Context) = cache(ctx).edit().putBoolean("bd", !bdMode(ctx)).putInt("bdPage", 0).putBoolean("week", false).apply()

    // Wochenvorschau: blättert ab dieser Woche bis ein Jahr voraus (so weit liefert der Server Termine)
    const val MAX_WEEKS = 52
    fun weekMode(ctx: Context) = cache(ctx).getBoolean("week", false)
    fun weekOff(ctx: Context) = cache(ctx).getInt("weekOff", 0)
    fun toggleWeek(ctx: Context) = cache(ctx).edit().putBoolean("week", !weekMode(ctx)).putInt("weekOff", 0).putBoolean("bd", false).apply()
    fun turnWeek(ctx: Context, by: Int) = cache(ctx).edit().putInt("weekOff", (weekOff(ctx) + by).coerceIn(0, MAX_WEEKS)).apply()
    // Jahr der gezeigten Woche, nur wenn es nicht das aktuelle ist (z. B. 2027 über dem KW-Knopf)
    fun weekYear(ctx: Context): Int? {
        val y = LocalDate.now().with(java.time.DayOfWeek.MONDAY).plusWeeks(weekOff(ctx).toLong()).get(java.time.temporal.IsoFields.WEEK_BASED_YEAR)
        return y.takeIf { it != LocalDate.now().get(java.time.temporal.IsoFields.WEEK_BASED_YEAR) }
    }
    fun weekNumber(ctx: Context): Int =
        LocalDate.now().with(java.time.DayOfWeek.MONDAY).plusWeeks(weekOff(ctx).toLong()).get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR)
    fun weekLabel(ctx: Context): String {
        val mon = LocalDate.now().with(java.time.DayOfWeek.MONDAY).plusWeeks(weekOff(ctx).toLong())
        val kw = mon.get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR)
        return "KW $kw · ${mon.dayOfMonth}.${mon.monthValue}.–${mon.plusDays(6).dayOfMonth}.${mon.plusDays(6).monthValue}."
    }

    // Geburtstage seitenweise, damit sie auch bei großer Schrift ohne Scrollen passen
    const val BD_PER_PAGE = 5
    fun bdPage(ctx: Context) = cache(ctx).getInt("bdPage", 0)
    fun bdPages(ctx: Context) = cache(ctx).getInt("bdPages", 1)
    fun turnBdPage(ctx: Context, by: Int) {
        val n = maxOf(1, bdPages(ctx))
        cache(ctx).edit().putInt("bdPage", ((bdPage(ctx) + by) % n + n) % n).apply()
    }

    fun bdRows(ctx: Context, feed: JSONObject): List<Row> {
        val today = LocalDate.now()
        val bds = feed.optJSONArray("birthdays") ?: JSONArray()
        val list = (0 until bds.length()).map { bds.getJSONObject(it) }.mapNotNull { b ->
            val m = b.optInt("month"); val d = b.optInt("day")
            val thisYear = try { LocalDate.of(today.year, m, d) } catch (e: Exception) { LocalDate.of(today.year, m, 28) }
            val next = if (thisYear.isBefore(today)) thisYear.plusYears(1) else thisYear
            Triple(b, next, java.time.temporal.ChronoUnit.DAYS.between(today, next))
        }.sortedBy { it.third }
        val out = ArrayList<Row>()
        out += Row(Kind.SECTION, "Geburtstage · nächste 12 Monate")
        if (list.isEmpty()) out += Row(Kind.NOTE, "Keine Geburtstage eingetragen")
        val pages = maxOf(1, (list.size + BD_PER_PAGE - 1) / BD_PER_PAGE)
        val page = minOf(bdPage(ctx), pages - 1)
        cache(ctx).edit().putInt("bdPages", pages).putInt("bdPage", page).apply()
        for ((b, next, days) in list.drop(page * BD_PER_PAGE).take(BD_PER_PAGE)) {
            val year = b.optInt("year", 0)
            val age = if (year > 0) " · wird ${next.year - year}" else ""
            val left = when (days) { 0L -> "heute 🎉"; 1L -> "morgen"; else -> "in $days T." }
            out += Row(
                Kind.EVENT, b.optString("name"),
                time = "${next.dayOfMonth}.${next.monthValue}.",
                sub = left + age,
                color = if (days <= 14) Color.parseColor("#C2477A") else Color.GRAY,
                open = "bdays"
            )
        }
        return out
    }

    // Lädt den Display-Feed; bei Fehlern bleibt der letzte Stand aus dem Zwischenspeicher
    fun load(ctx: Context): Pair<JSONObject?, String?> {
        val c = config(ctx) ?: return null to "Bitte die Widget-App öffnen und den Code eintragen."
        return try {
            val conn = URL("${c.url}/rest/v1/rpc/display_feed").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("apikey", c.key)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(JSONObject().put("p_token", c.token).toString().toByteArray()) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw Exception("Server meldet $code")
            if (body.trim() == "null") return null to "Dieses Display wurde entfernt. Bitte neuen Widget-Code eintragen."
            cache(ctx).edit().putString("feed", body).putLong("at", System.currentTimeMillis()).apply()
            JSONObject(body) to null
        } catch (e: Exception) {
            val old = cache(ctx).getString("feed", null)
            (old?.let { JSONObject(it) }) to "Offline: ${e.message ?: "keine Verbindung"}"
        }
    }

    fun loadedAt(ctx: Context): Long = cache(ctx).getLong("at", 0)

    fun dateLabel(d: LocalDate): String =
        "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.GERMAN).removeSuffix(".")} ${d.dayOfMonth}. ${d.month.getDisplayName(TextStyle.FULL, Locale.GERMAN)}"

    private fun hm(min: Int) = "%d:%02d".format(min / 60, min % 60)

    private fun parseColor(hex: String?): Int = try {
        Color.parseColor(hex ?: "#7a8590")
    } catch (e: Exception) {
        Color.GRAY
    }

    // Baut die Zeilen: heutige und morgige Familientermine, dann die Pinnwand (wie die Web-Ansicht ?v=mini)
    fun rows(feed: JSONObject, week: Int? = null): List<Row> {
        val today = LocalDate.now().toString()
        val nowMin = LocalTime.now().let { it.hour * 60 + it.minute }
        val settings = feed.optJSONObject("family")?.optJSONObject("settings") ?: JSONObject()
        val hidePast = settings.optString("pastMode") == "hide"
        val ttlHours = settings.optInt("ttlHours", 24)
        val members = feed.optJSONArray("members") ?: JSONArray()
        val color = HashMap<String, Int>()
        val name = HashMap<String, String>()
        for (i in 0 until members.length()) {
            val m = members.getJSONObject(i)
            color[m.getString("id")] = parseColor(m.optString("color"))
            name[m.getString("id")] = m.optString("name")
        }

        val out = ArrayList<Row>()
        val evs = feed.optJSONArray("events") ?: JSONArray()
        val all = (0 until evs.length()).map { evs.getJSONObject(it) }
        val bds = feed.optJSONArray("birthdays") ?: JSONArray()
        fun day(d: String, isToday: Boolean, none: String? = null) {
            // Geburtstage an diesem Tag zuerst, wie im Kalender der App
            val date = LocalDate.parse(d)
            var shown = 0
            for (i in 0 until bds.length()) {
                val b = bds.getJSONObject(i)
                if (b.optInt("month") != date.monthValue || b.optInt("day") != date.dayOfMonth) continue
                val year = b.optInt("year", 0)
                out += Row(
                    Kind.EVENT, "🎂 " + b.optString("name") + if (year > 0) " wird ${date.year - year}" else "",
                    time = "Geb.", color = Color.parseColor("#C2477A"), open = "bdays"
                )
                shown++
            }
            val list = all
                .filter { it.optString("date") <= d && d <= it.optString("end_date", it.optString("date")) }
                .sortedWith(compareBy({ !it.optBoolean("all_day") }, { it.optInt("start_min") }))
            for (e in list) {
                val allDay = e.optBoolean("all_day")
                val past = isToday && !allDay && e.optInt("end_min") <= nowMin
                if (past && hidePast) continue
                val persons = e.optJSONArray("persons")
                val first = if (persons != null && persons.length() > 0) persons.getString(0) else null
                val driver = e.optString("driver").takeIf { it.isNotEmpty() && it != "null" }
                out += Row(
                    // Eigene private Termine (nur mit persönlichem Widget-Code) mit Schloss kennzeichnen
                    Kind.EVENT, (if (e.optString("vis", "family") != "family") "🔒 " else "") + e.optString("title"),
                    time = if (allDay) "ganzt." else hm(e.optInt("start_min")),
                    sub = driver?.let { "${name[it] ?: ""} fährt" } ?: "",
                    color = first?.let { color[it] } ?: Color.GRAY,
                    faded = past,
                    open = "event:" + e.optString("id")
                )
                shown++
            }
            if (shown == 0) out += Row(Kind.NOTE, none ?: if (isToday) "Keine Familientermine mehr" else "Keine Familientermine", open = "new:$d")
        }
        // Wochenvorschau: Montag bis Sonntag der gewählten Woche, ohne Pinnwand
        if (week != null) {
            val mon = LocalDate.now().with(java.time.DayOfWeek.MONDAY).plusWeeks(week.toLong())
            for (i in 0L until 7L) {
                val d = mon.plusDays(i)
                out += Row(Kind.SECTION, dateLabel(d) + if (d.toString() == today) " · heute" else "", open = "new:$d")
                day(d.toString(), d.toString() == today, "frei")
            }
            return out
        }
        day(today, true)
        val tomorrow = LocalDate.now().plusDays(1)
        out += Row(Kind.SECTION, "Morgen · ${dateLabel(tomorrow)}")
        day(tomorrow.toString(), false)

        val msgs = feed.optJSONArray("messages") ?: JSONArray()
        val now = System.currentTimeMillis()
        val live = (0 until msgs.length()).map { msgs.getJSONObject(it) }.filter { m ->
            if (m.optBoolean("done")) return@filter false
            if (m.optBoolean("pinned")) return@filter true
            val at = try { OffsetDateTime.parse(m.optString("created_at")).toInstant().toEpochMilli() } catch (e: Exception) { now }
            now - at < ttlHours * 3_600_000L
        }.sortedWith(compareBy({ !it.optBoolean("pinned") }, { -(try { OffsetDateTime.parse(it.optString("created_at")).toInstant().toEpochMilli() } catch (e: Exception) { 0L }) }))
        out += Row(Kind.SECTION, "Pinnwand")
        if (live.isEmpty()) out += Row(Kind.NOTE, "Keine Nachrichten")
        for (m in live) {
            val from = m.optString("from_member")
            val open = "msg:" + m.optString("id")
            out += Row(Kind.MESSAGE, m.optString("text"), sub = name[from] ?: "", color = color[from] ?: Color.GRAY, pinned = m.optBoolean("pinned"), open = open)
            // Reaktionen darunter: wer übernimmt, dann die letzten Antworten
            val taker = m.optString("taker").takeIf { it.isNotEmpty() && it != "null" }
            if (taker != null) out += Row(Kind.REPLY, "übernimmt das", time = "✓ ${name[taker] ?: ""}", color = color[taker] ?: Color.GRAY, open = open)
            val replies = m.optJSONArray("replies") ?: JSONArray()
            val first = maxOf(0, replies.length() - 3)
            if (first > 0) out += Row(Kind.REPLY, "$first ältere Antwort${if (first > 1) "en" else ""}", time = "…", color = Color.GRAY, open = open)
            for (i in first until replies.length()) {
                val r = replies.getJSONObject(i)
                val who = r.optString("from_member")
                if (taker != null && who == taker && r.optString("text") == "Mach ich") continue
                out += Row(Kind.REPLY, r.optString("text"), time = "↳ ${name[who] ?: ""}:", color = color[who] ?: Color.GRAY, open = open)
            }
        }
        return out
    }
}
