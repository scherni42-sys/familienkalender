package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// Eigenes Symbol „Familie sprechen“ (z. B. für die Seitentaste): öffnet den Familienkalender direkt mit Spracheingabe
class MicActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = Feed.config(this)?.app?.takeIf { it.isNotEmpty() }
        val target = if (app != null) Intent(Intent.ACTION_VIEW, Uri.parse(app).buildUpon().appendQueryParameter("mic", "1").build())
            else Intent(this, SetupActivity::class.java)
        try { startActivity(target) } catch (e: Exception) { startActivity(Intent(this, SetupActivity::class.java)) }
        finish()
    }
}
