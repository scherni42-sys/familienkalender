package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// Unsichtbarer Zwischenschritt: Android 14 verbietet veränderbare PendingIntents mit offenem Ziel,
// daher zeigen Klicks im Widget hierher und wir öffnen von hier den Familienkalender.
class OpenActivity : Activity() {
    companion object { const val EXTRA_OPEN = "open" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = Feed.config(this)?.app?.takeIf { it.isNotEmpty() }
        // Angetippter Eintrag: App öffnet direkt diesen Termin bzw. diese Nachricht
        val open = intent?.getStringExtra(EXTRA_OPEN)?.takeIf { it.isNotEmpty() }
        val url = if (app != null && open != null) Uri.parse(app).buildUpon().appendQueryParameter("open", open).build() else app?.let(Uri::parse)
        val target = if (url != null) Intent(Intent.ACTION_VIEW, url) else Intent(this, SetupActivity::class.java)
        try { startActivity(target) } catch (e: Exception) { startActivity(Intent(this, SetupActivity::class.java)) }
        finish()
    }
}
