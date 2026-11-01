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
    companion object { const val EXTRA_UPDATED = "updated" }
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

        // Automatischer Home-Modus per Standort
        val geo = findViewById<CheckBox>(R.id.geo)
        val radius = findViewById<EditText>(R.id.georadius)
        geo.isChecked = Geo.enabled(this)
        radius.setText(Geo.radius(this).toString())
        geo.setOnCheckedChangeListener { _, on ->
            Geo.setEnabled(this, on)
            if (on && !Geo.hasFine(this)) requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 4)
            else if (on && !Geo.hasBackground(this)) askBackground()
            if (!on) { Feed.setHome(this, false); TodayWidget.refreshData(this) }
            showGeo()
        }
        findViewById<Button>(R.id.geohere).setOnClickListener {
            findViewById<TextView>(R.id.geostatus).text = "Suche Standort …"
            Geo.setHereAsHome(this) { msg -> runOnUiThread { showGeo(); findViewById<TextView>(R.id.geostatus).text = msg + "\n" + Geo.status(this) } }
        }
        radius.setOnFocusChangeListener { _, has -> if (!has) radius.text.toString().toIntOrNull()?.let { Geo.setRadius(this, it); showGeo() } }
        showGeo()

        // Alles sofort neu laden: Familienkalender, Widgets, Erinnerungen, Handy-Kalender in beide Richtungen
        findViewById<Button>(R.id.syncnow).setOnClickListener {
            val st = findViewById<TextView>(R.id.status)
            st.text = "Gleiche ab …"
            thread {
                CalImport.maybeSync(this, force = true)
                getSharedPreferences("familien-widget", MODE_PRIVATE).edit().putString("calhash", "").apply()
                val (feed, err) = Feed.load(this)
                if (feed != null) { Reminders.process(this, feed); NextWidget.updateAll(this, feed); CalSync.sync(this, feed) }
                runOnUiThread {
                    TodayWidget.refreshData(this)
                    showCalendars()
                    st.text = if (feed == null) (err ?: "Keine Verbindung.") else
                        "Abgeglichen um " + java.time.LocalTime.now().let { "%d:%02d".format(it.hour, it.minute) } +
                            CalImport.lastResult(this).takeIf { CalImport.enabled(this) && it.isNotEmpty() }?.let { "\n$it" }.orEmpty()
                }
            }
        }
        // Neueste Widget-App herunterladen (installiert sich über die alte)
        val upd = findViewById<Button>(R.id.update)
        upd.text = "Neue Version laden (jetzt v${BuildConfig.VERSION_CODE})"
        upd.setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/scherni42-sys/familienkalender/releases/download/widget-latest/familien-widget.apk")))
        }

        val code = findViewById<EditText>(R.id.code)
        val status = findViewById<TextView>(R.id.status)
        val saved = getSharedPreferences("familien-widget", MODE_PRIVATE).getString("code", null)
        if (saved != null) {
            code.setText(saved)
            status.text = if (intent?.getBooleanExtra(EXTRA_UPDATED, false) == true)
                "Version ${BuildConfig.VERSION_CODE} ist installiert. Alles bleibt eingerichtet, du kannst dieses Fenster schließen."
            else "Ein Code ist bereits gespeichert."
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
        if (code == 4 && Geo.hasFine(this) && !Geo.hasBackground(this)) askBackground()
        if (code == 4 || code == 5) { Geo.register(this); showGeo() }
    }

    // „Immer erlauben“ muss ab Android 11 separat angefragt werden (öffnet die Einstellungsseite)
    private fun askBackground() {
        if (Build.VERSION.SDK_INT >= 29) requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 5)
    }

    private fun showGeo() {
        findViewById<android.view.View>(R.id.geobox).visibility = if (Geo.enabled(this)) android.view.View.VISIBLE else android.view.View.GONE
        findViewById<TextView>(R.id.geostatus).text = Geo.status(this)
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
        CalImport.suggestWork(this, cals)
        val work = CalImport.work(this).toMutableSet()
        for (c in cals) {
            val row = android.widget.LinearLayout(this).apply { orientation = android.widget.LinearLayout.HORIZONTAL }
            val cb = CheckBox(this)
            cb.text = if (c.account.isNotBlank() && c.account != c.name) "${c.name}  (${c.account})" else c.name
            cb.isChecked = c.id in sel
            cb.layoutParams = android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            val wb = CheckBox(this)
            wb.text = "beruflich"
            wb.isChecked = c.id in work
            wb.isEnabled = cb.isChecked
            cb.setOnCheckedChangeListener { _, on ->
                if (on) sel += c.id else sel -= c.id
                wb.isEnabled = on
                CalImport.setSelected(this, sel)
                syncNow()
            }
            wb.setOnCheckedChangeListener { _, on ->
                if (on) work += c.id else work -= c.id
                CalImport.setWork(this, work)
                syncNow()
            }
            row.addView(cb); row.addView(wb)
            box.addView(row)
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

    override fun onPause() {
        super.onPause()
        findViewById<EditText>(R.id.georadius).text.toString().toIntOrNull()?.let { if (it != Geo.radius(this)) Geo.setRadius(this, it) }
    }

    override fun onResume() {
        super.onResume()
        if (Geo.enabled(this)) { Geo.register(this); showGeo() }
        // Code aus der Zwischenablage übernehmen, wenn das Feld leer ist
        val field = findViewById<EditText>(R.id.code)
        if (field.text.isNullOrBlank()) {
            val clip = (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
            if (text != null && text.trim().startsWith("FK1:")) field.setText(text.trim())
        }
    }
}
