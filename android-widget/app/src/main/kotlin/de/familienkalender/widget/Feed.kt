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

enum class Kind { SECTION, EVENT, MESSAGE, REPLY, NOTE, ACTIONS, PHOTO }

data class Row(
    val kind: Kind,
    val text: String,
    val time: String = "",
    val sub: String = "",
    val color: Int = Color.GRAY,
    val faded: Boolean = false,
    val pinned: Boolean = false,
    // Überschrift als Knopf (Board): an = grün hinterlegt
    val toggle: Boolean? = null,
    val open: String = "",
    // Board-Knöpfe: Nachricht und ob „Mach ich“ noch frei ist
    val msg: String = "",
    val canTake: Boolean = false,
    // Board-Nachricht: Avatar-Foto des Absenders (Pfad im Speicher), leer = keins
    val avatar: String = "",
    // Termin mit Fahrer: zweite Zeile, z. B. „🚗 Matthias fährt · ETA 13:58“
    val drive: String = "",
    // Board-Überschrift: offene Artikel auf dem Einkaufszettel (0 = kein Zettel-Symbol)
    val shop: Int = 0,
    // Board-Knöpfe: 👍 nur mit Schnellantworten, „Antworten“ nicht bei privaten Nachrichten
    val quick: Boolean = true,
    val priv: Boolean = false,
    // SOS am Board: rot hervorgehoben; „erledigt“ darf nur der Absender
    val alert: Boolean = false,
    val canDone: Boolean = true
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
    fun toggleBd(ctx: Context) = cache(ctx).edit().putBoolean("bd", !bdMode(ctx)).putInt("bdPage", 0).putBoolean("week", false).putBoolean("board", false).putBoolean("chat", false).apply()
    // Board groß: Termine ausblenden, das Board nimmt das ganze Widget ein
    fun boardMode(ctx: Context) = cache(ctx).getBoolean("board", false)
    fun toggleBoard(ctx: Context) = cache(ctx).edit().putBoolean("board", !boardMode(ctx)).putBoolean("chat", false).putBoolean("week", false).putBoolean("bd", false).apply()
    // Chat groß: nur die eigenen Chats (Person zu Person), Termine und Board ausgeblendet
    fun chatMode(ctx: Context) = cache(ctx).getBoolean("chat", false)
    fun toggleChat(ctx: Context) = cache(ctx).edit().putBoolean("chat", !chatMode(ctx)).putBoolean("board", false).putBoolean("week", false).putBoolean("bd", false).apply()

    // Wochenvorschau: blättert ab dieser Woche bis ein Jahr voraus (so weit liefert der Server Termine)
    const val MAX_WEEKS = 52
    // Rückwärts bis 12 Wochen (so weit zurück liefert der Server Termine)
    const val MIN_WEEKS = -12
    fun weekMode(ctx: Context) = cache(ctx).getBoolean("week", false)
    fun weekOff(ctx: Context) = cache(ctx).getInt("weekOff", 0)
    fun toggleWeek(ctx: Context) = cache(ctx).edit().putBoolean("week", !weekMode(ctx)).putInt("weekOff", 0).putBoolean("bd", false).putBoolean("board", false).putBoolean("chat", false).apply()
    fun turnWeek(ctx: Context, by: Int) = cache(ctx).edit().putInt("weekOff", (weekOff(ctx) + by).coerceIn(MIN_WEEKS, MAX_WEEKS)).apply()
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

    // Geburtstagsfarbe: private in der Farbe des Besitzers, gemeinsame in Torten-Gold (nicht in der Farbe eines Mitglieds)
    private val BD_GOLD = Color.parseColor("#D9A441")
    fun bdColor(feed: JSONObject, b: JSONObject): Int {
        if (b.isNull("owner")) return BD_GOLD
        val ms = feed.optJSONArray("members") ?: return BD_GOLD
        for (i in 0 until ms.length()) { val m = ms.optJSONObject(i) ?: continue; if (m.optString("id") == b.optString("owner")) return parseColor(m.optString("color")) }
        return BD_GOLD
    }

    // Tage bis zum nächsten Geburtstag, nur wenn er in der Erinnerungszeit liegt (Einstellung bdLead, wie in der App)
    fun nextBdDays(feed: JSONObject): Int? {
        val lead = feed.optJSONObject("family")?.optJSONObject("settings")?.optInt("bdLead", 14) ?: 14
        if (lead <= 0) return null
        val today = LocalDate.now()
        val bds = feed.optJSONArray("birthdays") ?: return null
        val min = (0 until bds.length()).mapNotNull { i ->
            val b = bds.optJSONObject(i) ?: return@mapNotNull null
            val t = try { LocalDate.of(today.year, b.optInt("month"), b.optInt("day")) } catch (e: Exception) { return@mapNotNull null }
            java.time.temporal.ChronoUnit.DAYS.between(today, if (t.isBefore(today)) t.plusYears(1) else t).toInt()
        }.minOrNull() ?: return null
        return if (min <= lead) min else null
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
        out += Row(Kind.NOTE, "＋ Geburtstag eintragen", open = "bdadd")
        if (list.isEmpty()) out += Row(Kind.NOTE, "Keine Geburtstage eingetragen")
        val pages = maxOf(1, (list.size + BD_PER_PAGE - 1) / BD_PER_PAGE)
        val page = minOf(bdPage(ctx), pages - 1)
        cache(ctx).edit().putInt("bdPages", pages).putInt("bdPage", page).apply()
        for ((b, next, days) in list.drop(page * BD_PER_PAGE).take(BD_PER_PAGE)) {
            val year = b.optInt("year", 0)
            val age = if (year > 0) " · wird ${next.year - year}" else ""
            val left = when (days) { 0L -> "heute 🎉"; 1L -> "morgen"; else -> "in $days T." }
            out += Row(
                // Private Geburtstage (nur im persönlichen Widget) mit Schloss
                Kind.EVENT, (if (b.isNull("owner")) "" else "🔒 ") + b.optString("name"),
                time = "${next.dayOfMonth}.${next.monthValue}.",
                sub = left + age,
                color = if (days <= 14) bdColor(feed, b) else Color.GRAY,
                open = "bday:" + b.optString("id")
            )
        }
        return out
    }

    // Lädt den Display-Feed; bei Fehlern bleibt der letzte Stand aus dem Zwischenspeicher
    // maxAgeMs > 0: eine gerade erst geladene Antwort wiederverwenden (Widget, Mini-Widget und Erinnerungen laden gleichzeitig)
    fun load(ctx: Context, maxAgeMs: Long = 0): Pair<JSONObject?, String?> {
        val c = config(ctx) ?: return null to "Bitte die Widget-App öffnen und den Code eintragen."
        if (maxAgeMs > 0 && System.currentTimeMillis() - loadedAt(ctx) < maxAgeMs) {
            cache(ctx).getString("feed", null)?.let { return home(ctx, JSONObject(it)) to null }
        }
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
            val feed = JSONObject(body)
            // Eigene Chats dazu (nur mit persönlichem Code; ohne Chat-Tabelle einfach keine)
            chats(c)?.let { feed.put("chats", it) }
            // Einkaufszettel: Zahl der offenen Artikel (ohne Tabelle oder Funktion einfach keiner)
            shop(c)?.let { feed.put("shop", it) }
            val e = cache(ctx).edit().putString("feed", feed.toString()).putLong("at", System.currentTimeMillis())
            // Tarif: FamTO Pro (mit KI) oder Basis; ohne Antwort bleibt der letzte Stand
            plan(c)?.let { e.putBoolean("pro", it) }
            e.apply()
            home(ctx, feed) to null
        } catch (e: Exception) {
            val old = cache(ctx).getString("feed", null)
            val at = cache(ctx).getLong("at", 0)
            val stand = if (old != null && at > 0) ", Stand " + java.text.SimpleDateFormat("HH:mm", java.util.Locale.GERMANY).format(java.util.Date(at)) else ""
            // Kein Netz (WLAN-Wechsel, Funkloch): kurz und verständlich statt Technik-Meldung
            val msg = if (e is java.io.IOException) "Gerade kein Internet$stand" else "Offline: ${e.message ?: "keine Verbindung"}"
            (old?.let { home(ctx, JSONObject(it)) }) to msg
        }
    }

    private fun chats(c: Config): JSONArray? = try {
        val conn = URL("${c.url}/rest/v1/rpc/widget_chats").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"; conn.connectTimeout = 8000; conn.readTimeout = 10000; conn.doOutput = true
        conn.setRequestProperty("apikey", c.key); conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("p_token", c.token).toString().toByteArray()) }
        if (conn.responseCode in 200..299) JSONArray(conn.inputStream.bufferedReader().use { it.readText() }) else null
    } catch (e: Exception) { null }

    // Darf diese Familie die KI nutzen? Persönlicher Widget-Code oder Display-Code
    private fun plan(c: Config): Boolean? {
        var answered = false
        for (arg in listOf("p_widget", "p_display")) {
            try {
                val conn = URL("${c.url}/rest/v1/rpc/ai_allowed").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"; conn.connectTimeout = 8000; conn.readTimeout = 10000; conn.doOutput = true
                conn.setRequestProperty("apikey", c.key); conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(JSONObject().put(arg, c.token).toString().toByteArray()) }
                if (conn.responseCode in 200..299) {
                    answered = true
                    if (conn.inputStream.bufferedReader().use { it.readText() }.trim() == "true") return true
                }
            } catch (e: Exception) { }
        }
        return if (answered) false else null
    }
    fun pro(ctx: Context): Boolean = cache(ctx).getBoolean("pro", true)
    private fun shop(c: Config): Int? = try {
        val conn = URL("${c.url}/rest/v1/rpc/widget_shop").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"; conn.connectTimeout = 8000; conn.readTimeout = 10000; conn.doOutput = true
        conn.setRequestProperty("apikey", c.key); conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("p_token", c.token).toString().toByteArray()) }
        if (conn.responseCode in 200..299) conn.inputStream.bufferedReader().use { it.readText() }.trim().toIntOrNull() else null
    } catch (e: Exception) { null }

    fun loadedAt(ctx: Context): Long = cache(ctx).getLong("at", 0)
    fun cached(ctx: Context): JSONObject? = try { cache(ctx).getString("feed", null)?.let { home(ctx, JSONObject(it)) } } catch (e: Exception) { null }

    // Home-Modus: Termine aus beruflichen Handy-Kalendern (ext_id beginnt mit „w:“) ausblenden
    fun homeMode(ctx: Context) = cache(ctx).getBoolean("home", false)
    fun toggleHome(ctx: Context) = setHome(ctx, !homeMode(ctx))
    fun setHome(ctx: Context, on: Boolean) = cache(ctx).edit().putBoolean("home", on).apply()
    fun isWork(e: JSONObject) = e.optString("ext_id").startsWith("w:")
    private fun home(ctx: Context, feed: JSONObject): JSONObject {
        if (!homeMode(ctx)) return feed
        val evs = feed.optJSONArray("events") ?: return feed
        val keep = JSONArray()
        for (i in 0 until evs.length()) evs.optJSONObject(i)?.let { if (!isWork(it)) keep.put(it) }
        return feed.put("events", keep)
    }

    // Eigene Person (nur mit persönlichem Widget-Code), sonst null
    fun me(feed: JSONObject): String? = feed.optString("me").takeIf { it.isNotEmpty() && it != "null" }

    // Board-Knopf im Widget ausführen: like, take oder done; liefert eine Fehlermeldung oder null
    // Fahrer unterwegs: neue voraussichtliche Ankunft an den Server (sieht die Familie auf dem Display)
    fun eta(ctx: Context, event: String, iso: String?): Boolean {
        val c = config(ctx) ?: return false
        return try {
            val conn = URL("${c.url}/rest/v1/rpc/widget_eta").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("apikey", c.key)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(JSONObject().put("p_token", c.token).put("p_event", event).put("p_eta", iso ?: JSONObject.NULL).toString().toByteArray()) }
            conn.responseCode in 200..299
        } catch (e: Exception) { false }
    }

    // Allgemeiner RPC-Aufruf mit dem Widget-Code; liefert eine Fehlermeldung oder null
    private fun rpc(ctx: Context, fn: String, body: JSONObject): String? {
        val c = config(ctx) ?: return "Kein Widget-Code"
        return try {
            val conn = URL("${c.url}/rest/v1/rpc/$fn").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("apikey", c.key)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.put("p_token", c.token).toString().toByteArray()) }
            val code = conn.responseCode
            if (code in 200..299) null else {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                (try { JSONObject(err).optString("message") } catch (e: Exception) { "" }).ifEmpty { "Server meldet $code" }
            }
        } catch (e: Exception) { "Keine Verbindung" }
    }

    // Eingetragener Fahrer sagt zu (ok) oder ab
    fun answer(ctx: Context, event: String, ok: Boolean): String? =
        rpc(ctx, "widget_driver_answer", JSONObject().put("p_event", event).put("p_ok", ok))

    // Google Maps beendet: Fahrt beenden, am Ziel als angekommen
    fun etaStop(ctx: Context, event: String, arrived: Boolean): String? =
        rpc(ctx, "widget_eta_stop", JSONObject().put("p_event", event).put("p_arrived", arrived))

    // Feld als ID oder null (JSON-null kommt als "null")
    fun id(e: JSONObject, k: String): String? = if (e.isNull(k)) null else e.optString(k).takeIf { it.isNotEmpty() && it != "null" }

    fun act(ctx: Context, action: String, msg: String): String? {
        val c = config(ctx) ?: return "Kein Widget-Code"
        return try {
            val conn = URL("${c.url}/rest/v1/rpc/widget_act").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("apikey", c.key)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(JSONObject().put("p_token", c.token).put("p_msg", msg).put("p_action", action).toString().toByteArray()) }
            val code = conn.responseCode
            if (code in 200..299) null else {
                val body = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                (try { JSONObject(body).optString("message") } catch (e: Exception) { "" }).ifEmpty { "Server meldet $code" }
            }
        } catch (e: Exception) {
            "Keine Verbindung"
        }
    }

    fun dateLabel(d: LocalDate): String =
        "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.GERMAN).removeSuffix(".")} ${d.dayOfMonth}. ${d.month.getDisplayName(TextStyle.FULL, Locale.GERMAN)}"

    // Kopfzeile immer kurz wie in der App: „Do, 12. Nov.“ (gleich bei kleiner und großer Schrift)
    // Kopfzeile: Datum und dahinter die Familie, an der das Widget hängt (wichtig, wenn man in mehreren Familien ist)
    fun headLabel(ctx: Context, d: LocalDate): String {
        val date = "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.GERMAN).removeSuffix(".").take(2)}, ${d.dayOfMonth}. ${d.month.getDisplayName(TextStyle.FULL, Locale.GERMAN).take(3)}."
        val fam = try { cache(ctx).getString("feed", null)?.let { JSONObject(it).optJSONObject("family")?.optString("name") } } catch (e: Exception) { null }
        return if (fam.isNullOrBlank()) date else "$date · $fam"
    }

    fun headLabel(d: LocalDate): String =
        "${d.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.GERMAN)}, ${d.dayOfMonth}. ${d.month.getDisplayName(TextStyle.FULL, Locale.GERMAN)}"

    private fun hm(min: Int) = "%d:%02d".format(min / 60, min % 60)

    private fun parseColor(hex: String?): Int = try {
        Color.parseColor(hex ?: "#7a8590")
    } catch (e: Exception) {
        Color.GRAY
    }

    // Baut die Zeilen: heutige und morgige Familientermine, dann die Pinnwand (wie die Web-Ansicht ?v=mini)
    // Fahrer unterwegs: Ankunftszeit als „13:58“, nur wenn sie noch sinnvoll ist
    private fun etaOf(e: JSONObject): String? {
        if (e.isNull("eta")) return null
        return try {
            val t = java.time.OffsetDateTime.parse(e.optString("eta")).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDateTime()
            val now = java.time.LocalDateTime.now()
            if (t.isBefore(now.minusMinutes(30)) || t.isAfter(now.plusHours(12))) null else "%d:%02d".format(t.hour, t.minute)
        } catch (x: Exception) { null }
    }

    // Ankunftszeit liegt über 30 Minuten zurück: Fahrt ist vorbei, auch wenn niemand „Angekommen“ getippt hat
    private fun etaGone(e: JSONObject): Boolean {
        if (e.isNull("eta")) return false
        return try { java.time.OffsetDateTime.parse(e.optString("eta")).toInstant().isBefore(java.time.Instant.now().minusSeconds(1800)) } catch (x: Exception) { false }
    }

    fun rows(feed: JSONObject, week: Int? = null, flights: Map<String, String> = emptyMap(), board: Boolean = false, chat: Boolean = false): List<Row> {
        val today = LocalDate.now().toString()
        val nowMin = LocalTime.now().let { it.hour * 60 + it.minute }
        val settings = feed.optJSONObject("family")?.optJSONObject("settings") ?: JSONObject()
        val hidePast = settings.optString("pastMode") == "hide"
        val ttlHours = settings.optInt("ttlHours", 24)
        val members = feed.optJSONArray("members") ?: JSONArray()
        val color = HashMap<String, Int>()
        val name = HashMap<String, String>()
        val avatar = HashMap<String, String>()
        for (i in 0 until members.length()) {
            val m = members.getJSONObject(i)
            color[m.getString("id")] = parseColor(m.optString("color"))
            name[m.getString("id")] = m.optString("name")
            // „off:“ = Avatar ausgeschaltet
            m.optString("avatar").takeIf { it.isNotEmpty() && it != "null" && !it.startsWith("off:") }?.let { avatar[m.getString("id")] = it }
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
                    Kind.EVENT, "🎂 " + (if (b.isNull("owner")) "" else "🔒 ") + b.optString("name") + if (year > 0) " wird ${date.year - year}" else "",
                    time = "Geb.", color = bdColor(feed, b), faded = d < today, open = "bday:" + b.optString("id")
                )
                shown++
            }
            val list = all
                .filter { it.optString("date") <= d && d <= it.optString("end_date", it.optString("date")) }
                .sortedWith(compareBy({ !it.optBoolean("all_day") }, { it.optInt("start_min") }))
            for (e in list) {
                val allDay = e.optBoolean("all_day")
                // Vergangene Tage (beim Blättern) und heute schon vorbei: blass
                val past = d < today || (isToday && !allDay && e.optInt("end_min") <= nowMin)
                if (isToday && past && hidePast) continue
                val persons = e.optJSONArray("persons")
                val first = if (persons != null && persons.length() > 0) persons.getString(0) else null
                val driver = id(e, "driver")
                val trip = e.optString("trip", "hin")
                val eta = etaOf(e)
                // Unterwegs ist, wer die Ankunftszeit gesetzt hat (bei „beides“ auch der Abholer)
                // Nach „Angekommen“ ist die Fahrt erledigt: keine Fahrer-Zeile mehr (bei „beides“ bleibt das Abholen)
                val arrived = eta == null && ((!e.isNull("arrived_at") && e.optString("arrived_at").isNotEmpty() && trip != "beides") || etaGone(e) || past)
                val drv = if (arrived) null else if (eta != null) id(e, "eta_by") ?: driver else driver
                val d2 = if (trip == "beides") id(e, "driver2") else null
                out += Row(
                    // Eigene private Termine (nur mit persönlichem Widget-Code) mit Schloss kennzeichnen
                    Kind.EVENT, (if (e.optString("vis", "family") != "family") "🔒 " else "") + e.optString("title") + if ((e.optJSONArray("files")?.length() ?: 0) > 0) " 📎" else "",
                    time = if (allDay) "ganzt." else hm(e.optInt("start_min")),
                    drive = drv?.let { who0 ->
                        val who = name[who0] ?: ""
                        val tr = if (e.isNull("travel_min")) 0 else e.optInt("travel_min")
                        val at = if (trip == "ab") e.optInt("end_min") else e.optInt("start_min")
                        when {
                            eta != null -> "🚗 $who fährt · ETA $eta"
                            else -> "🚗 $who " + (if (trip == "ab") "holt ab" else if (trip == "beides") "bringt" else "fährt") +
                                (if (isToday && !allDay && tr > 0 && at > nowMin) " · los ${hm(at - tr)}" else "") +
                                (d2?.let { " · ${name[it] ?: ""} holt ab" } ?: "")
                        }
                    }.let { dl -> flights[e.optString("id")]?.let { fl -> "✈ $fl" + (dl?.let { " · $it" } ?: "") } ?: dl }
                        // Ohne Fahrer: Ort darunter, wie auf der Startseite der App
                        // Aus einem Kinder-Bereich: dessen Name vor dem Ort, Farbe des Bereichs
                        ?: listOf(e.optString("area"), e.optString("place")).filter { it.isNotEmpty() && it != "null" }.joinToString(" · "),
                    color = e.optString("color").takeIf { it.startsWith("#") }?.let { parseColor(it) } ?: first?.let { color[it] } ?: Color.GRAY,
                    faded = past,
                    open = "event:" + e.optString("id") + ":" + d
                )
                shown++
            }
            // Vergangener Tag beim Blättern: nur „frei“, ohne Eintragen
            if (d < today) { if (shown == 0) out += Row(Kind.NOTE, "frei"); return }
            if (shown == 0) out += Row(Kind.NOTE, none ?: if (isToday) "Keine Familientermine mehr" else "Keine Familientermine", open = "new:$d")
            // Wochenvorschau: an Tagen mit Terminen eine eigene Zeile für einen weiteren Termin
            else if (none != null) out += Row(Kind.NOTE, "＋ Termin", open = "new:$d")
        }
        // Wochenvorschau: Montag bis Sonntag der gewählten Woche, ohne Pinnwand
        if (week != null) {
            val mon = LocalDate.now().with(java.time.DayOfWeek.MONDAY).plusWeeks(week.toLong())
            for (i in 0L until 7L) {
                val d = mon.plusDays(i)
                out += Row(Kind.SECTION, dateLabel(d) + if (d.toString() == today) " · heute" else "", open = "new:$d")
                day(d.toString(), d.toString() == today, "＋ Termin")
            }
            return out
        }
        if (!board && !chat) {
            out += Row(Kind.SECTION, "Heute")
            day(today, true)
            // Vorschau wie beim Display: Anzahl Tage und ab welcher Uhrzeit (Grundeinstellungen)
            val ahead = settings.optInt("wAhead", 1).coerceIn(1, 7)
            val split = settings.optInt("wSplit", 0)
            if (split > 0 && nowMin < split) {
                out += Row(Kind.NOTE, "Ab ${hm(split)} Uhr: " + if (ahead == 1) "Vorschau auf morgen" else "Vorschau auf $ahead Tage")
            } else for (i in 1L..ahead.toLong()) {
                val d = LocalDate.now().plusDays(i)
                out += Row(Kind.SECTION, (if (i == 1L) "Morgen · " else "") + dateLabel(d))
                day(d.toString(), false)
            }
        }

        val msgs = feed.optJSONArray("messages") ?: JSONArray()
        val now = System.currentTimeMillis()
        val live = (0 until msgs.length()).map { msgs.getJSONObject(it) }.filter { m ->
            if (m.optBoolean("done")) return@filter false
            if (m.optBoolean("pinned")) return@filter true
            val at = try { OffsetDateTime.parse(m.optString("created_at")).toInstant().toEpochMilli() } catch (e: Exception) { now }
            now - at < ttlHours * 3_600_000L
        }.sortedWith(compareBy({ !it.optBoolean("pinned") }, { -(try { OffsetDateTime.parse(it.optString("created_at")).toInstant().toEpochMilli() } catch (e: Exception) { 0L }) }))
        if (!chat) out += Row(Kind.SECTION, "Board", open = "toggle:board", toggle = board, shop = feed.optInt("shop", 0))
        if (!chat && live.isEmpty()) out += Row(Kind.NOTE, "Keine Nachrichten")
        for (m in if (chat) emptyList() else live) {
            val from = m.optString("from_member")
            val open = "msg:" + m.optString("id")
            out += Row(Kind.MESSAGE, (if (m.optString("image").let { it.isNotEmpty() && it != "null" } && !m.optString("text").startsWith("📷")) "📷 " else "") + m.optString("text"), sub = name[from] ?: "", color = color[from] ?: Color.GRAY, pinned = m.optBoolean("pinned"), open = open, avatar = avatar[from] ?: "")
            // Foto als kleines Vorschaubild unter der Nachricht (r.text = Pfad im Speicher)
            m.optString("image").takeIf { it.isNotEmpty() && it != "null" }?.let { out += Row(Kind.PHOTO, it, open = open) }
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
            // Knöpfe direkt im Widget, nur mit persönlichem Code (der Server weiß dann, wer drückt)
            if (me(feed) != null) out += Row(Kind.ACTIONS, "", msg = m.optString("id"), canTake = taker == null && m.optString("image").let { it.isEmpty() || it == "null" })
        }
        // Chat: je Person die letzte Nachricht; antippen öffnet den Chat in der App
        val myId = me(feed)
        if (myId != null && !board) {
            val cs = feed.optJSONArray("chats") ?: JSONArray()
            val last = LinkedHashMap<String, JSONObject>()
            val unread = HashMap<String, Int>()
            for (i in 0 until cs.length()) {
                val c = cs.getJSONObject(i)
                val w = if (c.optString("from") == myId) c.optString("to") else c.optString("from")
                last.remove(w); last[w] = c
                if (c.optString("to") == myId && c.isNull("read_at")) unread[w] = (unread[w] ?: 0) + 1
            }
            val threads = last.entries.map { it.key to it.value }.asReversed()
            val n = unread.values.sum()
            out += Row(Kind.SECTION, if (n > 0 && !chat) "Chat · $n neu" else "Chat", open = "toggle:chat", toggle = chat)
            if (threads.isEmpty()) out += Row(Kind.NOTE, if (chat) "Noch keine Chats. Antippen startet einen neuen Chat." else "Keine Chats", open = "chat:")
            for ((w, c) in if (chat) threads else threads.take(3)) {
                val k = c.optString("kind")
                val txt = when (k) { "image" -> "📷 " + c.optString("text").ifEmpty { "Foto" }; "voice" -> "🎤 Sprachnachricht"; "place" -> "📍 Standort"; else -> c.optString("text") }
                val u = unread[w] ?: 0
                out += Row(Kind.MESSAGE, (if (c.optString("from") == myId) "Du: " else "") + txt, sub = (name[w] ?: "") + if (u > 0) " · $u neu" else "",
                    color = color[w] ?: Color.GRAY, open = "chat:$w", avatar = avatar[w] ?: "")
            }
            if (chat && threads.isNotEmpty()) out += Row(Kind.NOTE, "＋ Neuer Chat", open = "chat:")
        }
        return out
    }
}
