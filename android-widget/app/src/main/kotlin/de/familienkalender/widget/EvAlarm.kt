package de.familienkalender.widget

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

// Termin-Wecker: für wichtige Termine klingelt das Handy 15 Min. bis 2 Std. vorher.
// Gespeichert auf diesem Handy: Termin-ID → Vorlauf, dazu Datum, Beginn und Titel (falls der Termin noch nicht im Abgleich ist).
object EvAlarm {
    const val FIRE = "de.familienkalender.widget.EV_ALARM"
    const val OFF = "de.familienkalender.widget.EV_ALARM_OFF"
    private const val PREFS = "familien-widget"
    private const val NID = 4712

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun all(ctx: Context): JSONObject = try { JSONObject(prefs(ctx).getString("evAlarms", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    private fun store(ctx: Context, o: JSONObject) = prefs(ctx).edit().putString("evAlarms", o.toString()).apply()

    fun lead(ctx: Context, id: String) = all(ctx).optJSONObject(id)?.optInt("lead") ?: 0

    fun set(ctx: Context, id: String, lead: Int, date: String, start: Int, title: String) {
        val o = all(ctx)
        if (lead <= 0) o.remove(id)
        else o.put(id, JSONObject().put("lead", lead).put("date", date).put("start", start).put("title", title).put("added", System.currentTimeMillis()))
        store(ctx, o)
    }

    private fun fireIntent(ctx: Context, id: String, title: String, at: String) = PendingIntent.getBroadcast(ctx, 44,
        Intent(ctx, TodayWidget::class.java).setAction(FIRE).putExtra("id", id).putExtra("title", title).putExtra("at", at),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    // Nächsten Termin-Wecker stellen; verschobene Termine werden aus dem Abgleich übernommen, gelöschte fallen weg
    fun schedule(ctx: Context, feed: JSONObject?) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val o = all(ctx)
        val evs = feed?.optJSONArray("events")
        val byId = HashMap<String, JSONObject>()
        if (evs != null) for (i in 0 until evs.length()) evs.optJSONObject(i)?.let { byId[it.optString("id")] = it }
        val now = LocalDateTime.now()
        var best: Triple<LocalDateTime, String, JSONObject>? = null
        for (id in o.keys().asSequence().toList()) {
            val a = o.optJSONObject(id) ?: continue
            val e = byId[id]
            if (e != null) { a.put("date", e.optString("date")).put("start", e.optInt("start_min")).put("title", e.optString("title")) }
            else if (feed != null && System.currentTimeMillis() - a.optLong("added") > 10 * 60_000) { o.remove(id); continue }
            val start = try { LocalDate.parse(a.optString("date")).atStartOfDay().plusMinutes(a.optInt("start").toLong()) } catch (x: Exception) { o.remove(id); continue }
            if (start.isBefore(now.minusHours(2))) { o.remove(id); continue }
            val at = start.minusMinutes(a.optInt("lead").toLong())
            if (at.isAfter(now) && (best == null || at.isBefore(best.first))) best = Triple(at, id, a)
        }
        store(ctx, o)
        val b = best ?: run { am.cancel(fireIntent(ctx, "", "", "")); return }
        val ms = b.first.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val st = b.third.optInt("start")
        val pi = fireIntent(ctx, b.second, b.third.optString("title"), "%d:%02d".format(st / 60, st % 60))
        val show = PendingIntent.getActivity(ctx, 45, Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, "event:" + b.second)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setAlarmClock(AlarmManager.AlarmClockInfo(ms, show), pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, pi)
    }

    fun fire(ctx: Context, id: String, title: String, at: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val a = all(ctx).optJSONObject(id)
        val lead = a?.optInt("lead") ?: 0
        val tap = PendingIntent.getActivity(ctx, 46, Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, "event:$id")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val off = PendingIntent.getBroadcast(ctx, 47, Intent(ctx, TodayWidget::class.java).setAction(OFF),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val soon = when { lead >= 120 -> "in 2 Stunden"; lead >= 60 -> "in 1 Stunde"; lead > 0 -> "in $lead Minuten"; else -> "gleich" }
        val n = Notification.Builder(ctx, Tones.channel(ctx, "ev"))
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("⏰ $title")
            .setContentText("$soon, um $at Uhr")
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setTimeoutAfter(((lead.coerceAtLeast(15)) * 60_000L))
            .addAction(Notification.Action.Builder(null, "Aus", off).build())
            .build()
        n.flags = n.flags or Notification.FLAG_INSISTENT
        val allowed = Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (allowed) nm.notify(NID, n)
        // Erledigt: diesen Wecker austragen und den nächsten stellen
        all(ctx).let { it.remove(id); store(ctx, it) }
        schedule(ctx, Feed.cached(ctx))
    }

    fun off(ctx: Context) = (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NID)
}
