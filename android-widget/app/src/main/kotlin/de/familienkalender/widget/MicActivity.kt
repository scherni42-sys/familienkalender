package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// App-Symbol „Familie sprechen“ (auch für die Seitentaste): Schnelleingabe oder Familienkalender mit Spracheingabe
class MicActivity : Activity() {
    companion object { const val EXTRA_MODE = "mode" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Mit persönlichem Widget-Code: kleine Schnelleingabe der Widget-App, der Familienkalender bleibt zu
        val m = intent?.getStringExtra(EXTRA_MODE)
        // Erster Start nach Installation oder Update („Öffnen“ im Installer): Einrichtung statt Mikrofon zeigen
        val prefs = getSharedPreferences("familien-widget", MODE_PRIVATE)
        // Zeitpunkt der letzten Installation (ändert sich auch, wenn dieselbe Version erneut installiert wird)
        val installed = try { packageManager.getPackageInfo(packageName, 0).lastUpdateTime } catch (e: Exception) { 0L }
        if (m == null && prefs.getLong("seenInstall", 0L) != installed) {
            prefs.edit().putLong("seenInstall", installed).apply()
            startActivity(Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_UPDATED, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }
        if (m != "photo" && Feed.cached(this)?.let { Feed.me(it) } != null) {
            startActivity(Intent(this, QuickActivity::class.java).putExtra(QuickActivity.EXTRA_MODE, m).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }
        val app = Feed.config(this)?.app?.takeIf { it.isNotEmpty() }
        val target = if (app != null) Intent(Intent.ACTION_VIEW, Uri.parse(app).buildUpon().appendQueryParameter("mic", intent?.getStringExtra(EXTRA_MODE) ?: "1").build())
            else Intent(this, SetupActivity::class.java)
        try { startActivity(target) } catch (e: Exception) { startActivity(Intent(this, SetupActivity::class.java)) }
        finish()
    }
}
