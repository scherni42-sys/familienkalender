package de.familienkalender.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.widget.Button
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
