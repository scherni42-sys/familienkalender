package de.familienkalender.widget

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate

// Flugstatus im Widget: für Flüge heute und morgen alle 15 Minuten über die Edge Function „flight“ nachsehen
// und als Kurzzeile („✈ Gate B12 · +25 Min. · ab 07:05“) unter dem Termin zeigen.
object Flights {
    private const val PREFS = "familien-widget"
    private val KEYWORD = Regex("(?i)flug|flight|✈|abflug|airline|boarding")
    private val EXPLICIT = Regex("(?i)\\b(?:Flugnummer|Flug-Nr\\.?|Flight)\\s*:?\\s*([A-Z0-9]{2})\\s?(\\d{1,4}[A-Z]?)\\b")
    private val LOOSE = Regex("\\b(?!KW)([A-Z]{2}|[A-Z]\\d|\\d[A-Z])\\s?(\\d{2,4})\\b")

    fun number(e: JSONObject): String? {
        val text = "${e.optString("title")} ${e.optString("place")} ${e.optString("notes")}"
        if (!KEYWORD.containsMatchIn(text)) return null
        val m = EXPLICIT.find(text) ?: LOOSE.find(text) ?: return null
        return (m.groupValues[1] + m.groupValues[2]).uppercase()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // Im Hintergrund: Flüge von heute und morgen auffrischen
    fun refresh(ctx: Context, feed: JSONObject) {
        val c = Feed.config(ctx) ?: return
        val evs = feed.optJSONArray("events") ?: return
        val days = setOf(LocalDate.now().toString(), LocalDate.now().plusDays(1).toString())
        val p = prefs(ctx)
        for (i in 0 until evs.length()) {
            val e = evs.optJSONObject(i) ?: continue
            val d = e.optString("date"); if (d !in days) continue
            val n = number(e) ?: continue
            val key = "flight:$n:$d"
            if (System.currentTimeMillis() - p.getLong("$key:t", 0) < 15 * 60_000L) continue
            try {
                val conn = URL("${c.url}/functions/v1/flight").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"; conn.connectTimeout = 10000; conn.readTimeout = 20000; conn.doOutput = true
                conn.setRequestProperty("apikey", c.key); conn.setRequestProperty("Authorization", "Bearer ${c.key}")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(JSONObject().put("widget_token", c.token).put("number", n).put("date", d).toString().toByteArray()) }
                p.edit().putLong("$key:t", System.currentTimeMillis()).apply()
                if (conn.responseCode in 200..299) {
                    val f = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                    if (f.optBoolean("found")) p.edit().putString(key, short(f)).apply()
                }
            } catch (x: Exception) { }
        }
    }

    private fun short(f: JSONObject): String {
        if (f.optBoolean("canceled")) return "annulliert"
        val dep = f.optJSONObject("dep") ?: JSONObject()
        val parts = ArrayList<String>()
        val gate = dep.optString("gate").takeIf { it.isNotEmpty() && it != "null" }
        val term = dep.optString("terminal").takeIf { it.isNotEmpty() && it != "null" }
        if (gate != null) parts += "Gate $gate" else if (term != null) parts += "Terminal $term"
        val delay = if (dep.isNull("delay")) 0 else dep.optInt("delay")
        if (delay >= 5) parts += "+$delay Min."
        val rev = dep.optString("revised"); val sched = dep.optString("sched")
        if (rev.isNotEmpty() && rev != "null" && rev != sched) parts += "ab $rev"
        if (parts.isEmpty()) f.optString("status").takeIf { it.isNotEmpty() }?.let { parts += it }
        return parts.joinToString(" · ")
    }

    // Zeilen fürs Widget: Termin-ID → Kurztext
    fun lines(ctx: Context, feed: JSONObject): Map<String, String> {
        val evs = feed.optJSONArray("events") ?: return emptyMap()
        val p = prefs(ctx); val out = HashMap<String, String>()
        for (i in 0 until evs.length()) {
            val e = evs.optJSONObject(i) ?: continue
            val n = number(e) ?: continue
            p.getString("flight:$n:${e.optString("date")}", null)?.takeIf { it.isNotEmpty() }?.let { out[e.optString("id")] = it }
        }
        return out
    }
}
