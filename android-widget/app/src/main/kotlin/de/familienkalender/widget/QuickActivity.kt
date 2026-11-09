package de.familienkalender.widget

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import kotlin.concurrent.thread

// Schnelleingabe ohne den Familienkalender zu öffnen: zuhören, Claude erkennt den Termin,
// speichern, Fenster schließt sich. Braucht den persönlichen Widget-Code.
class QuickActivity : Activity() {
    companion object {
        const val EXTRA_MODE = "mode"
        // Stichwort am Satzanfang, wie in der App
        private val PREFIX = Regex("^\\s*(privat|familie|pinnwand|board|bord)\\b[\\s,.:;!-]*", RegexOption.IGNORE_CASE)
    }

    private var mode = "board"
    private var preset = false
    private var rec: SpeechRecognizer? = null
    private var busy = false
    private lateinit var status: TextView
    private lateinit var text: EditText
    private val modeButtons = HashMap<String, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.quick)
        status = findViewById(R.id.q_status)
        text = findViewById(R.id.q_text)
        // Knopf im Widget legt die Art fest; Seitentaste ohne Stichwort geht ans Board
        intent?.getStringExtra(EXTRA_MODE)?.takeIf { it in listOf("private", "family", "board") }?.let { mode = it; preset = true }
        modeButtons["private"] = findViewById(R.id.m_private)
        modeButtons["family"] = findViewById(R.id.m_family)
        modeButtons["board"] = findViewById(R.id.m_board)
        for ((k, b) in modeButtons) b.setOnClickListener { mode = k; preset = true; showMode() }
        showMode()
        findViewById<Button>(R.id.q_mic).setOnClickListener { listen() }
        findViewById<Button>(R.id.q_save).setOnClickListener { go(text.text.toString()) }
        findViewById<Button>(R.id.q_app).setOnClickListener { openApp() }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) listen()
        else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        if (res.firstOrNull() == PackageManager.PERMISSION_GRANTED) listen() else status.text = "Ohne Mikrofon-Erlaubnis bitte tippen."
    }

    override fun onDestroy() {
        rec?.destroy()
        super.onDestroy()
    }

    private fun showMode() {
        val colors = mapOf("private" to Color.parseColor("#5E6B63"), "family" to Color.parseColor("#1D8657"), "board" to Color.parseColor("#D9822B"))
        for ((k, b) in modeButtons) {
            if (k == mode) { b.setBackgroundColor(colors[k]!!); b.setTextColor(Color.WHITE) }
            else { b.setBackgroundColor(Color.TRANSPARENT); b.setTextColor(colors[k]!!) }
        }
    }

    private fun listen() {
        if (busy) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { status.text = "Spracherkennung nicht verfügbar, bitte tippen."; return }
        rec?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        rec = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) { status.text = "Ich höre zu …" }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() { status.text = "Einen Moment …" }
            override fun onEvent(t: Int, p: Bundle?) {}
            override fun onError(e: Int) {
                status.text = if (e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) "Nichts verstanden. 🎤 antippen oder tippen." else "Spracherkennung gestört ($e). Bitte tippen."
            }
            override fun onPartialResults(p: Bundle?) {
                p?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { text.setText(it) }
            }
            override fun onResults(p: Bundle?) {
                val said = p?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                text.setText(said)
                if (said.isNotBlank()) go(said)
            }
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // Wie in der App: 3 Sekunden Pause beenden die Eingabe
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L)
        })
    }

    private fun go(raw: String) {
        var v = raw.trim()
        if (v.isEmpty() || busy) return
        var m = mode
        PREFIX.find(v)?.let { p ->
            m = when (p.groupValues[1].lowercase()) { "privat" -> "private"; "familie" -> "family"; else -> "board" }
            v = v.substring(p.range.last + 1).trim().replaceFirstChar { it.uppercase() }
        }
        if (v.isEmpty()) return
        mode = m; showMode()
        busy = true
        rec?.cancel()
        status.text = if (m == "board") "Hänge ans Board …" else "Claude trägt ein …"
        thread {
            val msg = try { if (m == "board") post(v) else saveEvent(v, m) } catch (e: Exception) { null to (e.message ?: "Fehler") }
            runOnUiThread {
                busy = false
                if (msg.second != null) { status.text = msg.second; return@runOnUiThread }
                Toast.makeText(this, msg.first, Toast.LENGTH_LONG).show()
                sendBroadcast(Intent(this, TodayWidget::class.java).setAction(TodayWidget.REFRESH))
                finish()
            }
        }
    }

    // Ergebnis: (Erfolgsmeldung, Fehler)
    private fun post(v: String): Pair<String?, String?> {
        val err = rpc("widget_post", JSONObject().put("p_text", v)).second
        return if (err == null) "Hängt jetzt am Board: $v" to null else null to err
    }

    private fun saveEvent(v: String, m: String): Pair<String?, String?> {
        val c = Feed.config(this) ?: return null to "Kein Widget-Code"
        val feed = Feed.load(this, 300_000).first ?: return null to "Keine Verbindung"
        val me = Feed.me(feed) ?: return null to "Bitte den persönlichen Widget-Code eintragen (Einstellungen → Displays → Mein Handy-Widget)."
        val members = feed.optJSONArray("members") ?: JSONArray()
        // Claude erkennt den Termin (dieselbe Funktion wie in der App)
        val body = JSONObject().put("text", v).put("today", LocalDate.now().toString()).put("me", me).put("members", members).put("widget_token", c.token)
        val (code, res) = http("${c.url}/functions/v1/parse-event", c.key, body)
        val ev = try { JSONObject(res).optJSONObject("event") } catch (e: Exception) { null }
            ?: return null to "Claude konnte das nicht lesen ($code). „In App“ öffnet die Eingabe dort."
        val allDay = ev.optBoolean("all_day")
        val date = ev.optString("date").ifEmpty { LocalDate.now().toString() }
        val ids = (0 until members.length()).map { members.getJSONObject(it).optString("id") }.toSet()
        val persons = JSONArray((0 until (ev.optJSONArray("persons")?.length() ?: 0)).map { ev.getJSONArray("persons").optString(it) }.filter { it in ids }.ifEmpty { listOf(me) })
        val p = JSONObject()
            .put("title", ev.optString("title").ifEmpty { v })
            .put("date", date)
            .put("end_date", if (allDay) ev.optString("end_date").ifEmpty { date } else date)
            .put("all_day", allDay)
            .put("start_min", if (allDay) 0 else ev.optInt("start_min"))
            .put("end_min", if (allDay) 1440 else ev.optInt("end_min", ev.optInt("start_min") + 60))
            .put("persons", persons)
            .put("driver", ev.optString("driver").takeIf { it in ids } ?: JSONObject.NULL)
            // Wie in der App: privat wird anderen als „belegt“ angezeigt
            .put("vis", if (m == "family") "family" else "busy")
            .put("place", ev.optString("place"))
            .put("addr", ev.optString("addr"))
            .put("bring", ev.optJSONArray("bring") ?: JSONArray())
            .put("discreet", m == "family" && ev.optBoolean("discreet"))
        val err = rpc("widget_save_event", JSONObject().put("p", p)).second
        if (err != null) return null to err
        val d = LocalDate.parse(date)
        val time = if (allDay) "ganztägig" else "%d:%02d".format(p.getInt("start_min") / 60, p.getInt("start_min") % 60)
        return "${if (m == "family") "Familientermin" else "Privater Termin"} gespeichert: ${p.getString("title")}, ${Feed.dateLabel(d)} $time" to null
    }

    private fun rpc(fn: String, body: JSONObject): Pair<String, String?> {
        val c = Feed.config(this) ?: return "" to "Kein Widget-Code"
        val (code, res) = http("${c.url}/rest/v1/rpc/$fn", c.key, body.put("p_token", c.token))
        if (code in 200..299) return res to null
        val msg = try { JSONObject(res).optString("message") } catch (e: Exception) { "" }
        return res to msg.ifEmpty { "Server meldet $code" }
    }

    private fun http(url: String, key: String, body: JSONObject): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 10000
        conn.readTimeout = 45000
        conn.doOutput = true
        conn.setRequestProperty("apikey", key)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = conn.responseCode
        val res = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        return code to res
    }

    // Ausweg: Eingabe im Familienkalender wie bisher
    private fun openApp() {
        try { startActivity(Intent(this, AppActivity::class.java)) } catch (e: Exception) {}
        finish()
    }
}
