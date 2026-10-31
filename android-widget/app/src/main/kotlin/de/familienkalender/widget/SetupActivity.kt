package de.familienkalender.widget

import android.Manifest
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import kotlin.concurrent.thread

// Einrichtung: Widget-Code aus der Familienkalender-App einfügen, prüfen, speichern
class SetupActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.setup)
        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Abbrechen soll beim Anlegen kein leeres Widget hinterlassen
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))

        // Erinnerungen: Schalter und (ab Android 13) Erlaubnis für Benachrichtigungen
        val remind = findViewById<CheckBox>(R.id.remind)
        remind.isChecked = Reminders.enabled(this)
        remind.setOnCheckedChangeListener { _, on ->
            Reminders.setEnabled(this, on)
            if (on && Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            thread { Feed.cached(this)?.let { Reminders.process(this, it) } }
        }
        if (remind.isChecked && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)

        // Handy-Kalender: Schalter, Erlaubnis, beim Ausschalten den Kalender wieder entfernen
        val cal = findViewById<CheckBox>(R.id.calsync)
        cal.isChecked = CalSync.enabled(this)
        cal.setOnCheckedChangeListener { _, on ->
            CalSync.setEnabled(this, on)
            if (on) requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR), 2)
            else thread { CalSync.remove(this) }
        }

        // Handy-Kalender in den Familienkalender übernehmen (nur mit persönlichem Code)
        val imp = findViewById<CheckBox>(R.id.calimport)
        imp.isChecked = CalImport.enabled(this)
        imp.setOnCheckedChangeListener { _, on ->
            if (on && Feed.cached(this)?.let { Feed.me(it) } == null) {
                imp.isChecked = false
                findViewById<TextView>(R.id.impstatus).text = "Dafür brauchst du deinen persönlichen Code: in der Familienkalender-App unter Einstellungen → „Mein Handy-Widget“ kopieren und oben speichern."
                return@setOnCheckedChangeListener
            }
            CalImport.setEnabled(this, on)
            if (on && !CalImport.allowed(this)) requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR), 3)
            if (!on) thread { CalImport.clear(this) }
            showCalendars()
        }
        showCalendars()

        val code = findViewById<EditText>(R.id.code)
        val status = findViewById<TextView>(R.id.status)
        val saved = getSharedPreferences("familien-widget", MODE_PRIVATE).getString("code", null)
        if (saved != null) {
            code.setText(saved)
            status.text = "Ein Code ist bereits gespeichert."
        }

        findViewById<Button>(R.id.save).setOnClickListener {
            val raw = code.text.toString()
            if (Feed.parseCode(raw) == null) {
                status.text = "Das ist kein gültiger Widget-Code. Er beginnt mit FK1:"
                return@setOnClickListener
            }
            Feed.saveCode(this, raw)
            status.text = "Prüfe Verbindung …"
            thread {
                val (feed, err) = Feed.load(this)
                runOnUiThread {
                    if (feed == null) {
                        status.text = err ?: "Keine Verbindung."
                    } else {
                        val fam = feed.optJSONObject("family")?.optString("name") ?: ""
                        status.text = "Verbunden mit $fam. Du kannst das Widget jetzt auf den Startbildschirm legen."
                        TodayWidget.refreshAll(this)
                        NextWidget.updateAll(this, feed)
                        thread { Reminders.process(this, feed); CalSync.sync(this, feed) }
                        TodayWidget.schedule(this)
                        if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                            finish()
                        }
                    }
                }
            }
        }
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        // Erlaubnis für den Kalender erteilt: gleich eintragen
        if (code == 2 && res.isNotEmpty() && res.all { it == PackageManager.PERMISSION_GRANTED })
            thread { Feed.load(this).first?.let { CalSync.sync(this, it) } }
        if (code == 3) showCalendars()
    }

    // Liste der Handy-Kalender zum Ankreuzen
    private fun showCalendars() {
        val box = findViewById<android.widget.LinearLayout>(R.id.impcals)
        val status = findViewById<TextView>(R.id.impstatus)
        box.removeAllViews()
        if (!CalImport.enabled(this)) { status.text = ""; return }
        if (!CalImport.allowed(this)) { status.text = "Bitte den Zugriff auf den Kalender erlauben."; return }
        val cals = CalImport.calendars(this)
        val sel = CalImport.selected(this).toMutableSet()
        for (c in cals) {
            val cb = CheckBox(this)
            cb.text = if (c.account.isNotBlank() && c.account != c.name) "${c.name}  (${c.account})" else c.name
            cb.isChecked = c.id in sel
            cb.setOnCheckedChangeListener { _, on ->
                if (on) sel += c.id else sel -= c.id
                CalImport.setSelected(this, sel)
                syncNow()
            }
            box.addView(cb)
        }
        status.text = when {
            cals.isEmpty() -> "Keine Kalender auf dem Handy gefunden."
            sel.isEmpty() -> "Bitte ankreuzen, welche Kalender übernommen werden sollen."
            else -> CalImport.lastResult(this).ifEmpty { "Wird übernommen …" }
        }
    }

    private fun syncNow() {
        val status = findViewById<TextView>(R.id.impstatus)
        status.text = "Wird übernommen …"
        thread {
            CalImport.maybeSync(this, force = true)
            runOnUiThread { status.text = CalImport.lastResult(this).ifEmpty { "Keine Verbindung, ich versuche es später wieder." } }
        }
    }

    override fun onResume() {
        super.onResume()
        // Code aus der Zwischenablage übernehmen, wenn das Feld leer ist
        val field = findViewById<EditText>(R.id.code)
        if (field.text.isNullOrBlank()) {
            val clip = (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
            if (text != null && text.trim().startsWith("FK1:")) field.setText(text.trim())
        }
    }
}
