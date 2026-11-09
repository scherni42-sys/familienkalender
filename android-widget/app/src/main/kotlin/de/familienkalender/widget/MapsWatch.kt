package de.familienkalender.widget

import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import kotlin.concurrent.thread

// Erkennt an der Benachrichtigung von Google Maps, ob eine Navigation läuft.
// Navigation beginnt: Ankunftszeit für meine heutige Fahrt setzen. Navigation endet: Fahrt beenden (am Ziel = angekommen).
// Sieht nur, ob Maps eine Navigation zeigt; Inhalte anderer Apps werden nicht gelesen.
class MapsWatch : NotificationListenerService() {
    companion object {
        private const val MAPS = "com.google.android.apps.maps"
        private const val PREFS = "familien-widget"

        fun allowed(ctx: Context): Boolean {
            val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
            val me = ComponentName(ctx, MapsWatch::class.java)
            return flat.split(":").any { ComponentName.unflattenFromString(it) == me }
        }

        // Meine Fahrt, die gerade ansteht oder läuft (heute, Ziel zwischen jetzt −30 Min. und +4 Std.)
        private fun myTrip(feed: JSONObject): Pair<Upcoming, LocalDateTime>? {
            val me = Feed.me(feed) ?: return null
            val now = LocalDateTime.now()
            return Reminders.mine(feed)
                .filter { Reminders.iDrive(it.e, me) && it.date == LocalDate.now() && it.e.optString("addr").isNotBlank() }
                .map { it to Reminders.myTarget(it, me) }
                .filter { (_, t) -> t.isAfter(now.minusMinutes(30)) && t.isBefore(now.plusHours(4)) }
                .minByOrNull { (_, t) -> t }
        }

        private fun refresh(ctx: Context) {
            Feed.load(ctx).first?.let { Reminders.process(ctx, it); NextWidget.updateAll(ctx, it) }
            TodayWidget.refreshData(ctx)
        }
    }

    private fun isNav(sbn: StatusBarNotification) = sbn.packageName == MAPS && sbn.isOngoing

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!isNav(sbn)) return
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        // Maps aktualisiert die Benachrichtigung ständig; nur beim Start reagieren
        if (prefs.getBoolean("maps_nav", false)) return
        prefs.edit().putBoolean("maps_nav", true).apply()
        val ctx = applicationContext
        thread {
            val feed = Feed.load(ctx).first ?: return@thread
            val (u, _) = myTrip(feed) ?: return@thread
            if (!u.e.isNull("eta")) { refresh(ctx); return@thread }
            val loc = Away.here(ctx) ?: return@thread
            val m = Away.minutes(ctx, loc, u.e.optString("addr")) ?: return@thread
            Feed.eta(ctx, u.e.optString("id"), java.time.OffsetDateTime.now().plusMinutes(m.toLong()).toString())
            refresh(ctx)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (!isNav(sbn)) return
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putBoolean("maps_nav", false).apply()
        val ctx = applicationContext
        thread {
            val feed = Feed.load(ctx).first ?: return@thread
            val me = Feed.me(feed) ?: return@thread
            val evs = feed.optJSONArray("events") ?: return@thread
            var any = false
            for (i in 0 until evs.length()) {
                val e = evs.optJSONObject(i) ?: continue
                if (e.isNull("eta") || Feed.id(e, "eta_by") != me) continue
                // Am Ziel (höchstens 3 Min. entfernt)? Dann „angekommen“, sonst nur die Fahrt beenden
                val near = Away.here(ctx)?.let { Away.minutes(ctx, it, e.optString("addr")) }?.let { it <= 3 } ?: false
                if (Feed.etaStop(ctx, e.optString("id"), near) != null) Feed.eta(ctx, e.optString("id"), null)
                any = true
            }
            if (any) refresh(ctx)
        }
    }

    override fun onListenerConnected() {
        // Läuft gerade keine Navigation, Merker zurücksetzen
        val nav = try { activeNotifications?.any { isNav(it) } ?: false } catch (e: Exception) { false }
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("maps_nav", nav).apply()
    }
}
