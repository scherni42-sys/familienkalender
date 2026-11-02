package de.familienkalender.widget

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

// Ein Termin mit Uhrzeit, der mich betrifft (für Erinnerungen und das Mini-Widget)
data class Upcoming(val e: JSONObject, val date: LocalDate, val start: LocalDateTime, val end: LocalDateTime, val travel: Int)

// Erinnerungen als echte Handy-Benachrichtigung: 30 Minuten vor Termin bzw. Abfahrt, Geburtstage am Vorabend und morgens.
// Ohne Server-Push: nach jedem Laden prüfen und einen Wecker für die nächste Erinnerung stellen.
object Reminders {
    private const val CHANNEL = "erinnerungen"
    private const val PREFS = "familien-widget"
    const val LEAD_MIN = 30L
    const val AWAY_MIN = 120 // so lange vor der Abfahrt beginnt der Sicherheits-Check
    const val AWAY_OK = "de.familienkalender.widget.AWAY_OK"
    const val REMIND = "de.familienkalender.widget.REMIND"

    fun enabled(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("remind", true)
    fun setEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("remind", on).apply()

    // Termine, die mich betreffen: mit persönlichem Code meine (dabei, fahre, angelegt), sonst alle Familientermine
    fun mine(feed: JSONObject): List<Upcoming> {
        val me = Feed.me(feed)
        val evs = feed.optJSONArray("events") ?: JSONArray()
        val out = ArrayList<Upcoming>()
        for (i in 0 until evs.length()) {
            val e = evs.getJSONObject(i)
            if (e.optBoolean("all_day")) continue
            if (me != null) {
                val persons = e.optJSONArray("persons") ?: JSONArray()
                val inIt = (0 until persons.length()).any { persons.optString(it) == me }
                if (!inIt && e.optString("driver") != me && e.optString("owner") != me) continue
            }
            val date = try { LocalDate.parse(e.optString("date")) } catch (x: Exception) { continue }
            val start = date.atStartOfDay().plusMinutes(e.optInt("start_min").toLong())
            val end = date.atStartOfDay().plusMinutes(e.optInt("end_min").toLong()).let { if (it.isAfter(start)) it else start.plusHours(1) }
            out += Upcoming(e, date, start, end, if (e.isNull("travel_min")) 0 else e.optInt("travel_min"))
        }
        return out.sortedBy { it.start }
    }

    private fun hm(t: LocalDateTime) = "%d:%02d".format(t.hour, t.minute)

    fun process(ctx: Context, feed: JSONObject) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val alarm = PendingIntent.getBroadcast(ctx, 30, Intent(ctx, TodayWidget::class.java).setAction(REMIND),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (!enabled(ctx)) { am.cancel(alarm); return }
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val sent = HashSet(prefs.getStringSet("sent", emptySet()) ?: emptySet())
        val now = LocalDateTime.now()
        var next: LocalDateTime? = null

        val me = Feed.me(feed)
        val lead = feed.optJSONObject("family")?.optJSONObject("settings")?.optInt("remind", 10) ?: 10
        fun due(key: String, at: LocalDateTime, until: LocalDateTime, title: String, text: String, open: String, nav: String = "") {
            if (key in sent || !now.isBefore(until)) return
            if (now.isBefore(at)) { val n = next; if (n == null || at.isBefore(n)) next = at; return }
            notify(ctx, key.hashCode(), title, text, open, nav)
            sent += key
        }

        for (u in mine(feed)) {
            val key = "${u.e.optString("id")}:${u.start}"
            val iDrive = me != null && u.e.optString("driver") == me
            val travel = (if (iDrive) Away.override(ctx, key) else null) ?: u.travel
            val leave = u.start.minusMinutes(travel.toLong())
            val at = leave.minusMinutes(LEAD_MIN)
            val mins = ChronoUnit.MINUTES.between(now, u.start).coerceAtLeast(0)
            val title = u.e.optString("title")
            val text = "um ${hm(u.start)}" + (if (travel > 0) " · los um ${hm(leave)}" else "") + (if (mins in 1..120) " · in $mins Min" else "")
            due("ev:${u.e.optString("id")}:${u.start}", at, u.start, title, text, "event:${u.e.optString("id")}")
            val addr = u.e.optString("addr")
            // Fahrer: Fahrzeit plus Vorlauf (Einstellung „Erinnerung an den Fahrer“, Standard 10 Min.) vor Beginn
            if (travel > 0 && iDrive && lead > 0) {
                due("go:$key", leave.minusMinutes(lead.toLong()), leave, "🚗 In $lead Min. losfahren: $title",
                    "Fahrt $travel Min. · los um ${hm(leave)} · Beginn ${hm(u.start)}" + (if (addr.isNotBlank()) " · $addr" else ""),
                    "event:${u.e.optString("id")}", addr)
            }
            // Unterwegs (Navigation aus der App gestartet): Ankunftszeit alle 10 Minuten vom Standort aus nachführen
            val etaIso = if (u.e.isNull("eta")) "" else u.e.optString("eta")
            if (iDrive && etaIso.isNotBlank() && addr.isNotBlank() && now.isBefore(u.start.plusMinutes(30))) {
                val etaAt = try { java.time.OffsetDateTime.parse(etaIso).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime() } catch (x: Exception) { null }
                if (etaAt != null && now.isBefore(etaAt.plusMinutes(15))) {
                    val last = prefs.getLong("etachk:$key", 0)
                    if (System.currentTimeMillis() - last > 9 * 60_000) {
                        prefs.edit().putLong("etachk:$key", System.currentTimeMillis()).apply()
                        Away.here(ctx)?.let { loc ->
                            val m = Away.minutes(loc, addr)
                            if (m != null) Feed.eta(ctx, u.e.optString("id"), java.time.OffsetDateTime.now().plusMinutes(m.toLong()).toString())
                        }
                    }
                    val again = now.plusMinutes(10)
                    val n = next; if (n == null || again.isBefore(n)) next = again
                }
            }
            // Sicherheits-Check: zwei Stunden vor der Abfahrt prüfen, ob ich weit weg bin und es vom Standort länger dauert
            if (iDrive && addr.isNotBlank()) {
                val from = u.start.minusMinutes((u.travel + AWAY_MIN).toLong())
                val until = leave.minusMinutes(lead.toLong().coerceAtLeast(0))
                if (now.isBefore(from)) { val n = next; if (n == null || from.isBefore(n)) next = from }
                else if (now.isBefore(until)) {
                    val last = prefs.getLong("awaychk:$key", 0)
                    if (System.currentTimeMillis() - last > 25 * 60_000) {
                        prefs.edit().putLong("awaychk:$key", System.currentTimeMillis()).apply()
                        val loc = Away.here(ctx)
                        val km = loc?.let { Away.kmFromHome(ctx, it) }
                        if (loc != null && (km == null || km > Away.FAR_KM)) {
                            val m = Away.minutes(loc, addr)
                            if (m != null && m > travel + 10) {
                                val go = u.start.minusMinutes(m.toLong())
                                notifyAway(ctx, "away:$key".hashCode(), "⚠️ Fahrt steht bevor: $title",
                                    "Du bist gerade weiter weg. Von hier brauchst du etwa $m Min. statt $travel Min. Los spätestens um ${hm(go)}, Beginn ${hm(u.start)}." +
                                        " Mit „Übernehmen“ erinnert dich die App passend dazu.", "event:${u.e.optString("id")}", addr, key, m)
                            }
                        }
                    }
                    // In 30 Minuten noch einmal nachsehen
                    val again = now.plusMinutes(30)
                    if (again.isBefore(until)) { val n = next; if (n == null || again.isBefore(n)) next = again }
                }
            }
        }

        val bds = feed.optJSONArray("birthdays") ?: JSONArray()
        val today = LocalDate.now()
        for (i in 0 until bds.length()) {
            val b = bds.getJSONObject(i)
            for (d in listOf(today, today.plusDays(1))) {
                if (b.optInt("month") != d.monthValue || b.optInt("day") != d.dayOfMonth) continue
                val year = b.optInt("year", 0)
                val age = if (year > 0) " (wird ${d.year - year})" else ""
                // Vorabend 18 Uhr und am Tag selbst 8 Uhr
                val eve = d.minusDays(1).atTime(18, 0)
                val morning = d.atTime(8, 0)
                due("bd:${b.optString("id")}:$d:eve", eve, d.atStartOfDay(), "🎂 Morgen: ${b.optString("name")}$age", "Geburtstag nicht vergessen", "bdays")
                due("bd:${b.optString("id")}:$d:day", morning, d.plusDays(1).atStartOfDay(), "🎂 Heute: ${b.optString("name")}$age", "Hat heute Geburtstag", "bdays")
            }
        }

        // Alte Einträge nicht ewig sammeln
        prefs.edit().putStringSet("sent", if (sent.size > 400) emptySet() else sent).apply()
        next?.let { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, it.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(), alarm) }
            ?: am.cancel(alarm)
    }

    private fun notify(ctx: Context, id: Int, title: String, text: String, open: String, nav: String = "") {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Erinnerungen", NotificationManager.IMPORTANCE_HIGH))
        val tap = PendingIntent.getActivity(ctx, id, Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, open)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = android.app.Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setStyle(android.app.Notification.BigTextStyle().bigText(text))
        if (nav.isNotBlank()) {
            // Knopf „Navigation“: Google Maps startet die Route vom aktuellen Standort
            val go = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("google.navigation:q=" + android.net.Uri.encode(nav))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val pi = PendingIntent.getActivity(ctx, id + 1, go, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            n.addAction(android.app.Notification.Action.Builder(null, "Navigation", pi).build())
        }
        nm.notify(id, n.build())
    }

    // Sicherheits-Hinweis mit „Übernehmen“ (neue Fahrzeit für die Erinnerung) und „Navigation“
    private fun notifyAway(ctx: Context, id: Int, title: String, text: String, open: String, nav: String, key: String, min: Int) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Erinnerungen", NotificationManager.IMPORTANCE_HIGH))
        val tap = PendingIntent.getActivity(ctx, id, Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, open)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val ok = PendingIntent.getBroadcast(ctx, id + 2, Intent(ctx, TodayWidget::class.java).setAction(AWAY_OK)
            .putExtra("key", key).putExtra("min", min).putExtra("nid", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val go = PendingIntent.getActivity(ctx, id + 1, Intent(Intent.ACTION_VIEW, android.net.Uri.parse("google.navigation:q=" + android.net.Uri.encode(nav)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = android.app.Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(android.app.Notification.BigTextStyle().bigText(text))
            .setContentIntent(tap)
            .addAction(android.app.Notification.Action.Builder(null, "Übernehmen", ok).build())
            .addAction(android.app.Notification.Action.Builder(null, "Navigation", go).build())
            .build()
        nm.notify(id, n)
    }
}
