package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import kotlin.concurrent.thread

// „Teilen“ → Familie sprechen: Screenshot, Foto oder Text wird von Claude gelesen und als Termin vorgeschlagen.
// Ein Tipp auf Privat oder Familie speichert, das Fenster schließt sich.
// Stehen mehrere Termine auf dem Bild (z. B. Abfuhrkalender), erscheint eine Liste zum Abhaken;
// Termine, die schon im Kalender stehen, sind markiert und abgewählt.
class ShareActivity : Activity() {
    private var event: JSONObject? = null
    private var members = JSONArray()
    private var me = ""
    private var known = JSONArray()
    private val picks = mutableListOf<Pair<JSONObject, CheckBox>>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.share)
        findViewById<Button>(R.id.s_cancel).setOnClickListener { finish() }
        findViewById<Button>(R.id.s_private).setOnClickListener { save("private") }
        findViewById<Button>(R.id.s_family).setOnClickListener { save("family") }
        buttons(false)

        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty() +
            (intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { "\n$it" } ?: "")
        @Suppress("DEPRECATION")
        val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        if (uri == null && text.isBlank()) { status("Hier ist nichts zum Eintragen dabei."); return }
        status(if (uri != null) "Claude liest den Termin vom Bild …" else "Claude liest den Termin …")
        thread {
            val r = try { parse(text.take(500), uri) } catch (e: Exception) { e.message ?: "Fehler" }
            runOnUiThread { if (r != null) status(r) else show() }
        }
    }

    private fun status(t: String) { findViewById<TextView>(R.id.s_status).text = t }
    private fun buttons(on: Boolean) {
        findViewById<View>(R.id.s_private).isEnabled = on
        findViewById<View>(R.id.s_family).isEnabled = on
    }

    // Bild verkleinern (lange Seite höchstens 1600 px) und als JPEG verschicken
    private fun imageJson(uri: Uri): JSONObject? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
        val bmp = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val scale = 1600f / maxOf(bmp.width, bmp.height)
        val img = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
        val out = ByteArrayOutputStream()
        img.compress(Bitmap.CompressFormat.JPEG, 82, out)
        return JSONObject().put("type", "image/jpeg").put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
    }

    // Liefert eine Fehlermeldung oder null
    private fun parse(text: String, uri: Uri?): String? {
        val c = Feed.config(this) ?: return "Bitte zuerst „Widget einrichten“ und den Code eintragen."
        val feed = Feed.load(this, 300_000).first ?: return "Keine Verbindung."
        me = Feed.me(feed) ?: return "Dafür brauchst du deinen persönlichen Code (Einstellungen → „Mein Handy-Widget“)."
        members = feed.optJSONArray("members") ?: JSONArray()
        known = feed.optJSONArray("events") ?: JSONArray()
        val body = JSONObject().put("text", text).put("today", LocalDate.now().toString()).put("me", me)
            .put("members", members).put("widget_token", c.token)
        if (uri != null) body.put("image", imageJson(uri) ?: return "Das Bild ließ sich nicht öffnen.")
        val (code, res) = http("${c.url}/functions/v1/parse-event", c.key, body)
        event = try { JSONObject(res).optJSONObject("event") } catch (e: Exception) { null }
        return if (event == null) "Claude hat darin keinen Termin gefunden ($code)." else null
    }

    // Titel vergleichbar machen: klein, ohne Klammerzusätze und Satzzeichen
    private fun norm(t: String) = t.lowercase().replace(Regex("\\([^)]*\\)"), " ").replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

    // Steht der Termin schon im Kalender? Gleicher Tag, ähnlicher Titel (bei Uhrzeit auch gleicher Beginn)
    private fun twin(e: JSONObject): JSONObject? {
        val t = norm(e.optString("title"))
        if (t.isEmpty()) return null
        val d = e.optString("date")
        for (i in 0 until known.length()) {
            val k = known.optJSONObject(i) ?: continue
            val kd = k.optString("date")
            if (kd > d || k.optString("end_date", kd).ifEmpty { kd } < d) continue
            if (!e.optBoolean("all_day") && !k.optBoolean("all_day") && e.optInt("start_min") != k.optInt("start_min")) continue
            val o = norm(k.optString("title"))
            if (o.isNotEmpty() && (o == t || o.contains(t) || t.contains(o))) return k
        }
        return null
    }

    // Alle Termine vom Bild: der erste plus „more“ (gleiche Personen und Art wie der erste)
    private fun all(): List<JSONObject> {
        val ev = event ?: return emptyList()
        val out = mutableListOf(ev)
        val more = ev.optJSONArray("more") ?: return out
        for (i in 0 until minOf(more.length(), 60)) {
            val m = more.optJSONObject(i) ?: continue
            if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(m.optString("date")) || m.optString("title").isBlank()) continue
            val x = JSONObject(ev.toString()).put("more", JSONArray())
            for (k in listOf("title", "date", "end_date", "all_day", "start_min", "end_min", "place")) if (m.has(k)) x.put(k, m.get(k))
            x.put("addr", "").put("bring", JSONArray())
            out += x
        }
        return out
    }

    private fun whenText(e: JSONObject): String {
        val d = try { LocalDate.parse(e.optString("date")) } catch (x: Exception) { LocalDate.now() }
        return Feed.dateLabel(d) + if (e.optBoolean("all_day")) "" else ", %d:%02d Uhr".format(e.optInt("start_min") / 60, e.optInt("start_min") % 60)
    }

    // Liste zum Abhaken statt eines einzelnen Termins
    private fun showList(list: List<JSONObject>) {
        findViewById<TextView>(R.id.s_title).visibility = View.GONE
        findViewById<TextView>(R.id.s_when).visibility = View.GONE
        val box = findViewById<LinearLayout>(R.id.s_list)
        box.removeAllViews()
        picks.clear()
        var twins = 0
        for (e in list) {
            val tw = twin(e)
            if (tw != null) twins++
            val cb = CheckBox(this)
            cb.text = "${e.optString("title")}\n${whenText(e)}" + (if (tw != null) "\nSteht schon drin: ${tw.optString("title")}" else "")
            cb.textSize = 16f
            cb.isChecked = tw == null
            cb.setPadding(0, 10, 0, 10)
            cb.setOnCheckedChangeListener { _, _ -> count() }
            box.addView(cb)
            picks += e to cb
        }
        // Lange Listen scrollen statt das Fenster zu sprengen
        if (list.size > 5) findViewById<View>(R.id.s_scroll).layoutParams.height = (resources.displayMetrics.heightPixels * 0.5).toInt()
        findViewById<View>(R.id.s_scroll).visibility = View.VISIBLE
        status("${list.size} Termine gefunden" + when (twins) { 0 -> ""; 1 -> ", einer steht schon drin"; else -> ", $twins stehen schon drin" } + ". Abhaken, dann Privat oder Familie.")
        count()
    }

    private fun count() { buttons(picks.any { it.second.isChecked }) }

    private fun show() {
        val list = all()
        if (list.size > 1 || (list.isNotEmpty() && twin(list[0]) != null)) { showList(list); return }
        val ev = event ?: return
        val allDay = ev.optBoolean("all_day")
        val d = try { LocalDate.parse(ev.optString("date")) } catch (e: Exception) { LocalDate.now() }
        val time = if (allDay) "ganztägig" else "%d:%02d–%d:%02d Uhr".format(ev.optInt("start_min") / 60, ev.optInt("start_min") % 60, ev.optInt("end_min") / 60, ev.optInt("end_min") % 60)
        val place = listOf(ev.optString("place"), ev.optString("addr")).filter { it.isNotBlank() }.joinToString(", ")
        findViewById<TextView>(R.id.s_title).text = ev.optString("title")
        findViewById<TextView>(R.id.s_when).text = "${Feed.dateLabel(d)}, $time" + (if (place.isNotEmpty()) "\n$place" else "")
        status("Als was eintragen?")
        buttons(true)
        // Vorschlag von Claude hervorheben
        (if (ev.optString("vis") == "family") findViewById<Button>(R.id.s_family) else findViewById<Button>(R.id.s_private)).requestFocus()
    }

    private fun save(m: String) {
        val ev = event ?: return
        val todo = if (picks.isEmpty()) listOf(ev) else picks.filter { it.second.isChecked }.map { it.first }
        if (todo.isEmpty()) return
        buttons(false)
        status("Speichere …")
        thread {
            var done = 0
            var err: String? = null
            for (one in todo) {
                err = saveOne(one, m)
                if (err != null) break
                done++
            }
            runOnUiThread {
                if (err != null) {
                    // Schon Gespeichertes nicht doppelt anlegen: aus der Liste nehmen
                    if (done > 0 && picks.isNotEmpty()) todo.take(done).forEach { s -> picks.firstOrNull { it.first === s }?.second?.let { cb -> cb.isChecked = false; cb.isEnabled = false } }
                    status(if (done > 0) "$done gespeichert, dann: $err" else err!!); buttons(true); return@runOnUiThread
                }
                val what = if (m == "family") "Familientermin" else "Privater Termin"
                Toast.makeText(this, if (todo.size == 1) "$what gespeichert: ${todo[0].optString("title")}" else "${todo.size} ${if (m == "family") "Familientermine" else "private Termine"} gespeichert", Toast.LENGTH_LONG).show()
                sendBroadcast(Intent(this, TodayWidget::class.java).setAction(TodayWidget.REFRESH))
                finish()
            }
        }
    }

    // Einen Termin speichern; liefert eine Fehlermeldung oder null
    private fun saveOne(ev: JSONObject, m: String): String? =
            try {
                val allDay = ev.optBoolean("all_day")
                val date = ev.optString("date").ifEmpty { LocalDate.now().toString() }
                val ids = (0 until members.length()).map { members.getJSONObject(it).optString("id") }.toSet()
                val pa = ev.optJSONArray("persons") ?: JSONArray()
                val persons = JSONArray((0 until pa.length()).map { pa.optString(it) }.filter { it in ids }.ifEmpty { listOf(me) })
                val p = JSONObject()
                    .put("title", ev.optString("title").ifEmpty { "Termin" })
                    .put("date", date)
                    .put("end_date", if (allDay) ev.optString("end_date").ifEmpty { date } else date)
                    .put("all_day", allDay)
                    .put("start_min", if (allDay) 0 else ev.optInt("start_min"))
                    .put("end_min", if (allDay) 1440 else ev.optInt("end_min", ev.optInt("start_min") + 60))
                    .put("persons", persons)
                    .put("driver", ev.optString("driver").takeIf { it in ids } ?: JSONObject.NULL)
                    .put("vis", if (m == "family") "family" else "busy")
                    .put("place", ev.optString("place"))
                    .put("addr", ev.optString("addr"))
                    .put("bring", ev.optJSONArray("bring") ?: JSONArray())
                    .put("discreet", m == "family" && ev.optBoolean("discreet"))
                val c = Feed.config(this)!!
                val (code, res) = http("${c.url}/rest/v1/rpc/widget_save_event", c.key, JSONObject().put("p_token", c.token).put("p", p))
                if (code in 200..299) null else (try { JSONObject(res).optString("message") } catch (e: Exception) { "" }).ifEmpty { "Server meldet $code" }
            } catch (e: Exception) { e.message ?: "Keine Verbindung" }

    private fun http(url: String, key: String, body: JSONObject): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 10000
        conn.readTimeout = 60000
        conn.doOutput = true
        conn.setRequestProperty("apikey", key)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = conn.responseCode
        val res = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        return code to res
    }
}
