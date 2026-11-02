package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import kotlin.concurrent.thread

// „Teilen → FamTO: Anhängen“: ein Dokument (PDF, Bild, Office …) an einen Termin oder als Datei ans Board hängen.
class AttachActivity : Activity() {
    private var uri: Uri? = null
    private var name = "Datei"
    private var type = "application/octet-stream"
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var note: EditText
    private var busy = false

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        type = intent.type?.takeIf { it.contains('/') && !it.contains('*') } ?: contentResolver.getType(uri ?: Uri.EMPTY) ?: type
        uri?.let { u ->
            try { contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0)?.let { name = it } } } catch (e: Exception) { }
        }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(18), dp(20), dp(14)) }
        root.addView(TextView(this).apply { text = "📎 Dokument anhängen"; textSize = 20f; setTypeface(typeface, Typeface.BOLD) })
        root.addView(TextView(this).apply { text = name; textSize = 15f; setPadding(0, dp(4), 0, dp(10)); maxLines = 2 })
        status = TextView(this).apply { textSize = 14f; visibility = View.GONE; setPadding(0, 0, 0, dp(8)) }
        root.addView(status)

        if (uri == null || Feed.config(this) == null) {
            status.visibility = View.VISIBLE
            status.text = if (uri == null) "Hier ist keine Datei dabei." else "Bitte zuerst in der FamTO-App deinen persönlichen Code eintragen."
            root.addView(Button(this).apply { text = "Schließen"; setOnClickListener { finish() } })
            setContentView(root); return
        }

        // Ans Board, optional mit kurzem Text
        note = EditText(this).apply { hint = "Text fürs Board (freiwillig)"; textSize = 15f; maxLines = 3 }
        root.addView(note)
        root.addView(bigButton("📌 Ans Board hängen", "#1D8657", Color.WHITE) { upload(null, "Board") })

        root.addView(TextView(this).apply { text = "Oder an einen Termin:"; textSize = 15f; setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(16), 0, dp(6)) })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply { addView(list) }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(320)))
        root.addView(Button(this).apply { text = "Abbrechen"; setOnClickListener { finish() } }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        setContentView(root)

        Feed.cached(this)?.let { fill(it) }
        thread { Feed.load(this, 5 * 60_000).first?.let { f -> runOnUiThread { fill(f) } } }
    }

    private fun bigButton(label: String, bg: String, fg: Int, go: () -> Unit) = TextView(this).apply {
        text = label; textSize = 16f; setTextColor(fg); gravity = Gravity.CENTER_VERTICAL
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(14), dp(14), dp(14), dp(14))
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.parseColor(bg)) }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
        setOnClickListener { if (!busy) go() }
    }

    // Termine der letzten 7 Tage und des nächsten Jahres, nächste zuerst
    private fun fill(feed: JSONObject) {
        list.removeAllViews()
        val evs = feed.optJSONArray("events") ?: return
        val from = LocalDate.now().minusDays(7).toString()
        val to = LocalDate.now().plusDays(365).toString()
        // Familientermine und alle eigenen (auch private und aus dem Handy-Kalender)
        val me = Feed.me(feed)
        val today = LocalDate.now().toString()
        val items = (0 until evs.length()).mapNotNull { evs.optJSONObject(it) }
            .filter { it.optString("end_date", it.optString("date")) >= from && it.optString("date") <= to && (it.optString("vis") == "family" || it.optString("owner") == me) }
            .sortedWith(compareBy({ it.optString("end_date", it.optString("date")) < today }, { it.optString("date") }, { it.optInt("start_min") }))
        if (items.isEmpty()) { list.addView(TextView(this).apply { text = "Keine Termine gefunden."; textSize = 14f }); return }
        for (e in items.take(150)) {
            val d = try { LocalDate.parse(e.optString("date")) } catch (x: Exception) { continue }
            val time = if (e.optBoolean("all_day")) "ganztägig" else "%d:%02d".format(e.optInt("start_min") / 60, e.optInt("start_min") % 60)
            val clips = e.optJSONArray("files")?.length() ?: 0
            val lock = if (e.optString("vis") != "family") "🔒 " else ""
            list.addView(bigButton("${Feed.dateLabel(d)}, $time\n$lock${e.optString("title")}" + if (clips > 0) "  📎$clips" else "", "#F1F3F4", Color.parseColor("#1B1F23")) {
                upload(e.optString("id"), e.optString("title"))
            })
        }
    }

    private fun upload(event: String?, label: String) {
        val u = uri ?: return
        val c = Feed.config(this) ?: return
        busy = true
        status.visibility = View.VISIBLE
        status.text = "Wird hochgeladen …"
        val text = note.text.toString().trim()
        thread {
            val err = try {
                val bytes = contentResolver.openInputStream(u)?.use { it.readBytes() } ?: throw Exception("Datei ließ sich nicht lesen")
                if (bytes.size > 15 * 1024 * 1024) throw Exception("Die Datei ist zu groß (höchstens 15 MB).")
                val body = JSONObject().put("action", "upload").put("widget_token", c.token).put("name", name).put("type", type)
                    .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                if (event != null) body.put("event_id", event) else if (text.isNotEmpty()) body.put("text", text)
                val conn = URL("${c.url}/functions/v1/files").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 15000
                conn.readTimeout = 60000
                conn.doOutput = true
                conn.setRequestProperty("apikey", c.key)
                conn.setRequestProperty("Authorization", "Bearer ${c.key}")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = conn.responseCode
                if (code in 200..299) null else {
                    val r = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    (try { JSONObject(r).optString("error") } catch (x: Exception) { "" }).ifEmpty { "Server meldet $code" }
                }
            } catch (e: Exception) { e.message ?: "Keine Verbindung" }
            runOnUiThread {
                busy = false
                if (err != null) { status.text = err; return@runOnUiThread }
                Toast.makeText(this, if (event != null) "📎 Angehängt an: $label" else "📎 Hängt jetzt am Board", Toast.LENGTH_LONG).show()
                thread { Feed.load(applicationContext).first?.let { NextWidget.updateAll(applicationContext, it) }; TodayWidget.refreshData(applicationContext) }
                finish()
            }
        }
    }
}
