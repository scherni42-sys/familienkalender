package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// Unsichtbarer Zwischenschritt: Android 14 verbietet veränderbare PendingIntents mit offenem Ziel,
// daher zeigen Klicks im Widget hierher und wir öffnen von hier den Familienkalender.
class OpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = Feed.config(this)?.app?.takeIf { it.isNotEmpty() }
        val target = if (app != null) Intent(Intent.ACTION_VIEW, Uri.parse(app)) else Intent(this, SetupActivity::class.java)
        try { startActivity(target) } catch (e: Exception) { startActivity(Intent(this, SetupActivity::class.java)) }
        finish()
    }
}
