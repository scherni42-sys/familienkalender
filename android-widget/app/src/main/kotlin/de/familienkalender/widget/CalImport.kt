package de.familienkalender.widget

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Instances
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

// Termine aus dem Kalender des Handys (z. B. Samsung-Kalender) als private Termine in den Familienkalender übernehmen.
// Ganztägige Termine mit „Geburtstag“ in Beschreibung oder Titel werden private Geburtstage.
// Braucht den persönlichen Widget-Code. Der eigene Kalender „Familienkalender“ (Export) wird nie gelesen.
object CalImport {
    private const val PREFS = "familien-widget"
    private const val OWN_ACCOUNT = "Familienkalender"
    private const val READ_EVERY_MS = 10 * 60_000L       // Handy-Kalender höchstens alle 10 Minuten lesen
    private const val SEND_ANYWAY_MS = 6 * 3600_000L     // ohne Änderung trotzdem alle 6 Stunden abgleichen
    private val BDAY = Regex("geburtstag", RegexOption.IGNORE_CASE)

    // synced: Termine liegen auf dem Handy (SYNC_EVENTS). Geteilte/abonnierte Kalender sind oft nur gelistet, aber nicht synchronisiert.
    data class Cal(val id: Long, val name: String, val account: String, val type: String, val synced: Boolean = true, val visible: Boolean = true)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun enabled(ctx: Context) = prefs(ctx).getBoolean("calimport", false)
    fun setEnabled(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("calimport", on).putString("imphash", "").putLong("impread", 0).apply()
    fun selected(ctx: Context): Set<Long> = prefs(ctx).getStringSet("impcals", emptySet())!!.mapNotNull { it.toLongOrNull() }.toSet()
    fun setSelected(ctx: Context, ids: Set<Long>) =
        prefs(ctx).edit().putStringSet("impcals", ids.map { it.toString() }.toSet()).putString("imphash", "").putLong("impread", 0).apply()
    // Berufliche Kalender: im Home-Modus ausgeblendet. Outlook/Exchange sind anfangs vorgeschlagen.
    fun work(ctx: Context): Set<Long> = prefs(ctx).getStringSet("impwork", emptySet())!!.mapNotNull { it.toLongOrNull() }.toSet()
    fun setWork(ctx: Context, ids: Set<Long>) =
        prefs(ctx).edit().putStringSet("impwork", ids.map { it.toString() }.toSet()).putBoolean("impworkinit", true).putString("imphash", "").putLong("impread", 0).apply()
    fun hasWork(ctx: Context) = enabled(ctx) && work(ctx).any { it in selected(ctx) }
    fun suggestWork(ctx: Context, cals: List<Cal>) {
        if (prefs(ctx).getBoolean("impworkinit", false)) return
        setWork(ctx, cals.filter { val t = (it.type + " " + it.account).lowercase(); "exchange" in t || "outlook" in t || "office" in t }.map { it.id }.toSet())
    }
    fun lastResult(ctx: Context): String = prefs(ctx).getString("impresult", "") ?: ""

    fun allowed(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    // Alle Kalender des Handys außer unserem eigenen
    fun calendars(ctx: Context): List<Cal> {
        if (!allowed(ctx)) return emptyList()
        val out = ArrayList<Cal>()
        ctx.contentResolver.query(Calendars.CONTENT_URI,
            arrayOf(Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE,
                Calendars.SYNC_EVENTS, Calendars.VISIBLE), null, null,
            "${Calendars.ACCOUNT_NAME}, ${Calendars.CALENDAR_DISPLAY_NAME}")?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(2) == OWN_ACCOUNT && c.getString(3) == CalendarContract.ACCOUNT_TYPE_LOCAL) continue
                out += Cal(c.getLong(0), c.getString(1) ?: "Kalender", c.getString(2) ?: "", c.getString(3) ?: "",
                    c.isNull(4) || c.getInt(4) != 0, c.isNull(5) || c.getInt(5) != 0)
            }
        }
        return out
    }

    // Wie viele Termine je Kalender im Übernahme-Zeitraum auf dem Handy liegen (zur Anzeige in den Einstellungen)
    fun counts(ctx: Context): Map<Long, Int> {
        if (!allowed(ctx)) return emptyMap()
        val zone = ZoneId.systemDefault()
        val begin = LocalDate.now().minusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val end = LocalDate.now().plusDays(366).atStartOfDay(zone).toInstant().toEpochMilli()
        val uri = Instances.CONTENT_URI.buildUpon().also { ContentUris.appendId(it, begin); ContentUris.appendId(it, end) }.build()
        val out = HashMap<Long, Int>()
        try {
            ctx.contentResolver.query(uri, arrayOf(Instances.CALENDAR_ID), null, null, null)?.use { c ->
                while (c.moveToNext()) out[c.getLong(0)] = (out[c.getLong(0)] ?: 0) + 1
            }
        } catch (e: Exception) { }
        return out
    }

    // Kalender, der nur gelistet ist, auf dem Handy synchronisieren lassen (darf jede App mit Schreibrecht)
    fun enableSync(ctx: Context, cal: Cal): Boolean {
        if (ctx.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) != PackageManager.PERMISSION_GRANTED) return false
        return try {
            val v = android.content.ContentValues().apply { put(Calendars.SYNC_EVENTS, 1) }
            ctx.contentResolver.update(ContentUris.withAppendedId(Calendars.CONTENT_URI, cal.id), v, null, null)
            if (cal.account.isNotBlank() && cal.type.isNotBlank() && cal.type != CalendarContract.ACCOUNT_TYPE_LOCAL) {
                val extras = android.os.Bundle().apply {
                    putBoolean(android.content.ContentResolver.SYNC_EXTRAS_MANUAL, true)
                    putBoolean(android.content.ContentResolver.SYNC_EXTRAS_EXPEDITED, true)
                }
                android.content.ContentResolver.requestSync(android.accounts.Account(cal.account, cal.type), CalendarContract.AUTHORITY, extras)
            }
            true
        } catch (e: Exception) { false }
    }

    // Aus dem Hintergrund (Widget-Aktualisierung) aufrufen; liest und sendet nur bei Bedarf
    fun maybeSync(ctx: Context, force: Boolean = false) {
        if (!enabled(ctx) || !allowed(ctx)) return
        val p = prefs(ctx)
        val now = System.currentTimeMillis()
        if (!force && now - p.getLong("impread", 0) < READ_EVERY_MS) return
        p.edit().putLong("impread", now).apply()
        val (events, bdays) = read(ctx, selected(ctx), work(ctx))
        val hash = (events.toString() + bdays.toString()).hashCode().toString()
        if (!force && p.getString("imphash", "") == hash && now - p.getLong("impsent", 0) < SEND_ANYWAY_MS) return
        val res = send(ctx, events, bdays) ?: return
        p.edit().putString("imphash", hash).putLong("impsent", now).putString("impresult", res).apply()
    }

    // Import abschalten: bisher übernommene Einträge im Familienkalender wieder entfernen
    fun clear(ctx: Context) {
        send(ctx, JSONArray(), JSONArray())
        prefs(ctx).edit().putString("imphash", "").putString("impresult", "").apply()
    }

    private fun read(ctx: Context, cals: Set<Long>, work: Set<Long>): Pair<JSONArray, JSONArray> {
        val events = JSONArray()
        val bdays = JSONArray()
        if (cals.isEmpty()) return events to bdays
        val zone = ZoneId.systemDefault()
        val from = LocalDate.now().minusDays(1)
        val begin = from.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = LocalDate.now().plusDays(366).atStartOfDay(zone).toInstant().toEpochMilli()
        val uri = Instances.CONTENT_URI.buildUpon().also { ContentUris.appendId(it, begin); ContentUris.appendId(it, end) }.build()
        val seenBd = HashSet<Long>()
        val ids = cals.joinToString(",")
        ctx.contentResolver.query(uri,
            arrayOf(Instances.EVENT_ID, Instances.BEGIN, Instances.END, Instances.TITLE, Instances.EVENT_LOCATION,
                Instances.DESCRIPTION, Instances.ALL_DAY, Instances.STATUS, Instances.CALENDAR_ID),
            "${Instances.CALENDAR_ID} IN ($ids)", null, Instances.BEGIN)?.use { c ->
            while (c.moveToNext()) {
                if (!c.isNull(7) && c.getInt(7) == CalendarContract.Events.STATUS_CANCELED) continue
                val evId = c.getLong(0)
                val pre = if (c.getLong(8) in work) "w:" else ""
                val b = c.getLong(1)
                val e = c.getLong(2)
                val title = (c.getString(3) ?: "").trim()
                // Abgesagte Besprechungen (Outlook lässt sie mit „Abgesagt:“ stehen) nicht übernehmen
                if (Regex("(?i)^(abgesagt|canceled|cancelled)\\s*:").containsMatchIn(title)) continue
                val desc = notes(c.getString(5) ?: "")
                val allDay = c.getInt(6) == 1
                if (allDay) {
                    val d = Instant.ofEpochMilli(b).atZone(ZoneOffset.UTC).toLocalDate()
                    if (BDAY.containsMatchIn(desc) || BDAY.containsMatchIn(title)) {
                        if (seenBd.add(evId)) {
                            val name = bdayName(title)
                            if (name.isNotEmpty()) bdays.put(JSONObject().put("ext_id", "$evId").put("name", name)
                                .put("day", d.dayOfMonth).put("month", d.monthValue))
                        }
                        continue
                    }
                    val last = Instant.ofEpochMilli(e).atZone(ZoneOffset.UTC).toLocalDate().minusDays(1).let { if (it.isBefore(d)) d else it }
                    events.put(JSONObject().put("ext_id", "$pre$evId:$b").put("title", title).put("date", d.toString())
                        .put("end_date", last.toString()).put("all_day", true)
                        .put("place", c.getString(4) ?: "").put("notes", desc.take(500)))
                } else {
                    val s = Instant.ofEpochMilli(b).atZone(zone)
                    val en = Instant.ofEpochMilli(maxOf(e, b)).atZone(zone)
                    var endMin = en.hour * 60 + en.minute
                    var endDate = en.toLocalDate()
                    // Ende genau um Mitternacht: als 24:00 des Vortags speichern
                    if (endMin == 0 && en.toLocalDate().isAfter(s.toLocalDate())) { endDate = endDate.minusDays(1); endMin = 1440 }
                    events.put(JSONObject().put("ext_id", "$pre$evId:$b").put("title", title).put("date", s.toLocalDate().toString())
                        .put("end_date", endDate.toString()).put("all_day", false)
                        .put("start_min", s.hour * 60 + s.minute).put("end_min", endMin)
                        .put("place", c.getString(4) ?: "").put("notes", desc.take(500)))
                }
            }
        }
        return events to bdays
    }

    // Outlook liefert Notizen oft als Word-HTML: in schlichten Text umwandeln
    private val MEET = Regex("(?i)https://(teams\\.microsoft\\.com/(l/meetup-join|meet)/|teams\\.live\\.com/meet/|[\\w.-]*zoom\\.us/j/|meet\\.google\\.com/|[\\w.-]*webex\\.com/)[^\\s\"'<>]+")

    // Link zur Online-Besprechung (Teams, Zoom, Meet, Webex) nach vorn holen, damit er nicht abgeschnitten wird
    fun notes(raw: String): String {
        val link = MEET.find(raw.replace("&amp;", "&"))?.value
        val text = plain(raw)
        return if (link == null) text else ("Online-Besprechung: $link\n" + text.replace(link, "").trim()).trim()
    }

    fun plain(raw: String): String {
        if (!Regex("(?i)<(html|body|div|p|br|span|meta|table)\\b").containsMatchIn(raw)) return raw.trim()
        val cleaned = raw
            .replace(Regex("(?is)<head\\b.*?</head>"), " ")
            .replace(Regex("(?is)<style\\b.*?</style>"), " ")
            .replace(Regex("(?is)<script\\b.*?</script>"), " ")
            .replace(Regex("(?s)<!--.*?-->"), " ")
            .replace(Regex("(?s)<!\\[if.*?<!\\[endif\\]>"), " ")
        val text = android.text.Html.fromHtml(cleaned, android.text.Html.FROM_HTML_MODE_COMPACT).toString()
        return text.replace('\u00A0', ' ').replace('\uFFFC', ' ')
            .lines().map { it.replace(Regex("[ \\t]+"), " ").trim() }
            .filter { it.isNotEmpty() && !Regex("^_{5,}$").matches(it) }
            .joinToString("\n").trim()
    }

    // „Geburtstag Oma“, „🎂 Geburtstag von Lena“, „Max Geburtstag“ → Oma, Lena, Max
    fun bdayName(title: String): String {
        val n = title.replace("🎂", " ")
            .replace(Regex("(?i)\\b(geburtstag(e|s)?|geb\\.|geb|bday)(?![\\p{L}])\\s*(von\\b|:|-)?"), " ")
            .replace(Regex("(?i)^\\s*(von|:|-)\\s+"), " ")
            .replace(Regex("\\s+"), " ").trim(' ', ':', '-', ',', '\'', '’')
        return (n.ifEmpty { title }).take(100)
    }

    // An den Server: widget_import; liefert eine kurze Rückmeldung oder null bei Fehler
    private fun send(ctx: Context, events: JSONArray, bdays: JSONArray): String? {
        val c = Feed.config(ctx) ?: return null
        return try {
            val conn = URL("${c.url}/rest/v1/rpc/widget_import").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 10000
            conn.readTimeout = 30000
            conn.doOutput = true
            conn.setRequestProperty("apikey", c.key)
            conn.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("p_token", c.token).put("p_from", LocalDate.now().minusDays(1).toString())
                .put("p_events", events).put("p_bdays", bdays)
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                prefs(ctx).edit().putString("impresult", "Fehler: " + ((try { JSONObject(err).optString("message") } catch (x: Exception) { "" }).ifEmpty { "Server meldet ${conn.responseCode}" })).apply()
                return null
            }
            val r = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val t = java.time.LocalTime.now().let { "%d:%02d".format(it.hour, it.minute) }
            "Zuletzt übernommen um $t: ${events.length()} Termine, ${bdays.length()} Geburtstage" +
                (r.optInt("events_deleted").takeIf { it > 0 }?.let { ", $it gelöschte entfernt" } ?: "")
        } catch (e: Exception) {
            null
        }
    }
}
