package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.concurrent.thread

// Ein Tipp auf „Update“ im Widget: Erlaubnis prüfen, laden, installieren. Kleines Fenster mit Fortschritt.
class UpdateActivity : Activity() {
    private lateinit var status: TextView
    private var started = false
    private var askedPermission = false

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(20), dp(22), dp(20)) }
        root.addView(TextView(this).apply { text = "FamTO aktualisieren"; textSize = 19f; setTypeface(typeface, Typeface.BOLD) })
        status = TextView(this).apply { textSize = 15f; setPadding(0, dp(10), 0, 0) }
        root.addView(status)
        setContentView(root)
        setFinishOnTouchOutside(false)
    }

    override fun onResume() {
        super.onResume()
        if (started) return
        // Einmalig: FamTO darf Apps installieren
        if (!packageManager.canRequestPackageInstalls()) {
            if (askedPermission) { status.text = "Ohne die Erlaubnis „Unbekannte Apps installieren“ geht das Update nicht. Du kannst es jederzeit wieder antippen."; return }
            askedPermission = true
            status.text = "Einmalig: Bitte „Von dieser Quelle zulassen“ einschalten und zurückkommen."
            try { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) } catch (e: Exception) { }
            return
        }
        started = true
        status.text = "Suche neue Version …"
        thread {
            Updater.check(this, force = true)
            if (!Updater.available(this)) { runOnUiThread { status.text = "Du hast schon die neueste Version (v${BuildConfig.VERSION_CODE})."; status.postDelayed({ finish() }, 1800) }; return@thread }
            try {
                Updater.install(this) { s -> runOnUiThread { status.text = "Version ${Updater.latest(this)}: $s" } }
                runOnUiThread { status.postDelayed({ finish() }, 1500) }
            } catch (e: Exception) {
                runOnUiThread { status.text = "Update ging nicht: ${e.message ?: "keine Verbindung"}"; started = false }
            }
        }
    }
}
