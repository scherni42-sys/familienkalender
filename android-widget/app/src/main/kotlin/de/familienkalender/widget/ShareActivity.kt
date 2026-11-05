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
class ShareActivity : Activity() {
    private var event: JSONObject? = null
    private var members = JSONArray()
    private var me = ""

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
        val body = JSONObject().put("text", text).put("today", LocalDate.now().toString()).put("me", me)
            .put("members", members).put("widget_token", c.token)
        if (uri != null) body.put("image", imageJson(uri) ?: return "Das Bild ließ sich nicht öffnen.")
        val (code, res) = http("${c.url}/functions/v1/parse-event", c.key, body)
        event = try { JSONObject(res).optJSONObject("event") } catch (e: Exception) { null }
        return if (event == null) "Claude hat darin keinen Termin gefunden ($code)." else null
    }

    private fun show() {
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
        buttons(false)
        status("Speichere …")
        thread {
            val err = try {
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
            runOnUiThread {
                if (err != null) { status(err); buttons(true); return@runOnUiThread }
                Toast.makeText(this, "${if (m == "family") "Familientermin" else "Privater Termin"} gespeichert: ${ev.optString("title")}", Toast.LENGTH_LONG).show()
                sendBroadcast(Intent(this, TodayWidget::class.java).setAction(TodayWidget.REFRESH))
                finish()
            }
        }
    }

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
