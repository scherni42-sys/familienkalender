package de.familienkalender.widget

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

// Geburtstags-Wecker: am Geburtstag klingelt zur eingestellten Uhrzeit ein echter Wecker
// („Geburtstag Carlos Malveira“), mit Weckton und so lange, bis man ihn ausschaltet.
object BdAlarm {
    const val FIRE = "de.familienkalender.widget.BD_ALARM"
    const val OFF = "de.familienkalender.widget.BD_ALARM_OFF"
    private const val PREFS = "familien-widget"
    private const val CHANNEL = "geburtstagswecker"
    private const val NID = 4711

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // „all“: für alle Geburtstage; sonst nur die ausgewählten (Schlüssel „Name|Tag|Monat“, bleibt bei neuem Abgleich gleich)
    fun all(ctx: Context) = prefs(ctx).getBoolean("bdAlarm", false)
    fun keys(ctx: Context): Set<String> = prefs(ctx).getStringSet("bdAlarmKeys", emptySet()) ?: emptySet()
    fun enabled(ctx: Context) = all(ctx) || keys(ctx).isNotEmpty()
    fun save(ctx: Context, all: Boolean, keys: Set<String>, min: Int) =
        prefs(ctx).edit().putBoolean("bdAlarm", all).putStringSet("bdAlarmKeys", HashSet(keys)).putInt("bdAlarmMin", min.coerceIn(0, 1439)).apply()
    fun key(b: JSONObject) = "${b.optString("name")}|${b.optInt("day")}|${b.optInt("month")}"
    fun minute(ctx: Context) = prefs(ctx).getInt("bdAlarmMin", 9 * 60)
    fun setMinute(ctx: Context, m: Int) = prefs(ctx).edit().putInt("bdAlarmMin", m).apply()
    fun label(ctx: Context) = minute(ctx).let { "%d:%02d".format(it / 60, it % 60) }

    private fun fireIntent(ctx: Context, names: String) = PendingIntent.getBroadcast(ctx, 40,
        Intent(ctx, TodayWidget::class.java).setAction(FIRE).putExtra("names", names),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    // Nächsten Geburtstags-Wecker stellen (nach jedem Laden und nach dem Klingeln)
    fun schedule(ctx: Context, feed: JSONObject) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!enabled(ctx)) { am.cancel(fireIntent(ctx, "")); return }
        val now = LocalDateTime.now()
        val today = LocalDate.now()
        val bds = feed.optJSONArray("birthdays") ?: JSONArray()
        val m = minute(ctx).toLong()
        val all = all(ctx)
        val keys = keys(ctx)
        val byTime = sortedMapOf<LocalDateTime, MutableList<String>>()
        for (i in 0 until bds.length()) {
            val b = bds.optJSONObject(i) ?: continue
            if (!all && key(b) !in keys) continue
            for (y in listOf(today.year, today.year + 1)) {
                val d = try { LocalDate.of(y, b.optInt("month"), b.optInt("day")) } catch (e: Exception) { continue }
                val at = d.atStartOfDay().plusMinutes(m)
                if (at.isAfter(now)) { byTime.getOrPut(at) { mutableListOf() } += b.optString("name"); break }
            }
        }
        val first = byTime.entries.firstOrNull() ?: run { am.cancel(fireIntent(ctx, "")); return }
        val ms = first.key.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val pi = fireIntent(ctx, first.value.joinToString(" und "))
        val show = PendingIntent.getActivity(ctx, 41, Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, "bdays")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Als echter Wecker (Symbol in der Statusleiste); ohne Erlaubnis für genaue Wecker wenigstens ungefähr
        if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setAlarmClock(AlarmManager.AlarmClockInfo(ms, show), pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, pi)
    }

    // Klingeln: Benachrichtigung mit Weckton, die so lange läutet, bis man „Aus“ tippt oder sie wegwischt
    fun fire(ctx: Context, names: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Geburtstags-Wecker", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Klingelt am Geburtstag zur eingestellten Uhrzeit"
            setSound(sound, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        val tap = PendingIntent.getActivity(ctx, 42, Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, "bdays")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val off = PendingIntent.getBroadcast(ctx, 43, Intent(ctx, TodayWidget::class.java).setAction(OFF),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("🎂 Geburtstag $names")
            .setContentText("Heute gratulieren nicht vergessen!")
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Aus", off).build())
            .build()
        n.flags = n.flags or Notification.FLAG_INSISTENT
        val allowed = Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (allowed) nm.notify(NID, n)
        // Den nächsten stellen
        Feed.cached(ctx)?.let { schedule(ctx, it) }
    }

    fun off(ctx: Context) = (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NID)
}
