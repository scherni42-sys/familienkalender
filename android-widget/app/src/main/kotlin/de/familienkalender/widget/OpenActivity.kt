package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.os.Bundle

// Unsichtbarer Zwischenschritt: Android 14 verbietet veränderbare PendingIntents mit offenem Ziel,
// daher zeigen Klicks im Widget hierher und wir öffnen von hier den Familienkalender.
class OpenActivity : Activity() {
    companion object {
        const val EXTRA_OPEN = "open"
        const val EXTRA_ACT = "act"
        const val EXTRA_MSG = "msg"
        const val EXTRA_ALARM_OFF = "alarmOff"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Wecker-Meldung angetippt: zuerst den Wecker ausschalten
        if (intent?.getBooleanExtra(EXTRA_ALARM_OFF, false) == true) AlarmService.stop(this)
        // Board-Knopf im Widget: nur ausführen, nichts öffnen
        val act = intent?.getStringExtra(EXTRA_ACT)
        if (act != null) {
            sendBroadcast(Intent(this, TodayWidget::class.java).setAction(TodayWidget.ACT)
                .putExtra(EXTRA_ACT, act).putExtra(EXTRA_MSG, intent.getStringExtra(EXTRA_MSG)))
            finish()
            return
        }
        // Angetippter Eintrag: FamTO in der App öffnet direkt diesen Termin bzw. diese Nachricht
        val open = intent?.getStringExtra(EXTRA_OPEN)?.takeIf { it.isNotEmpty() }
        val target = if (Feed.config(this) != null) Intent(this, AppActivity::class.java).putExtra(AppActivity.EXTRA_OPEN, open ?: "").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            else Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { startActivity(target) } catch (e: Exception) { startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        finish()
    }
}
