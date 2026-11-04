package de.familienkalender.widget

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import kotlin.concurrent.thread

// SOS: Notruf an die Familie. Empfänger: Daueralarm im Vollbild, bis jemand „Ich kümmere mich“ tippt.
// Absender: Standort sofort und dann 30 Minuten lang laufend.
object Sos {
    private const val PREFS = "familien-widget"
    const val CH_ALARM = "sos_alarm"
    const val CH_INFO = "sos_info"
    const val CH_RUN = "sos_run"
    const val ALARM_ID = 7701
    const val RUN_ID = 7702
    const val CHANGED = "de.familienkalender.widget.SOS_CHANGED"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun incoming(ctx: Context): JSONObject? = prefs(ctx).getString("sosIn", null)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
    fun outgoing(ctx: Context): String? = prefs(ctx).getString("sosOut", null)

    private fun nm(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    fun channels(ctx: Context) {
        val n = nm(ctx)
        n.createNotificationChannel(NotificationChannel(CH_ALARM, "SOS-Alarm", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Notruf aus der Familie: klingelt laut, bis jemand reagiert"
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true); vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
            setBypassDnd(true); lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        n.createNotificationChannel(NotificationChannel(CH_INFO, "SOS-Rückmeldungen", NotificationManager.IMPORTANCE_HIGH).apply { description = "Wer sich kümmert, Entwarnung" })
        n.createNotificationChannel(NotificationChannel(CH_RUN, "SOS läuft", NotificationManager.IMPORTANCE_LOW).apply { description = "Eigener Notruf ist aktiv, Standort wird geteilt" })
    }

    // Was noch fehlt, damit der Alarm sicher durchkommt (für die Einrichtung im SOS-Fenster)
    fun canFullScreen(ctx: Context) = Build.VERSION.SDK_INT < 34 || nm(ctx).canUseFullScreenIntent()
    fun canBypassDnd(ctx: Context) = nm(ctx).isNotificationPolicyAccessGranted
    fun canNotify(ctx: Context) = Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    // ---------- Empfänger ----------
    fun alarm(ctx: Context, d: Map<String, String>) {
        val me = Feed.cached(ctx)?.let { Feed.me(it) }
        if (me != null && d["from"] == me) return
        val o = JSONObject(d as Map<*, *>).put("acks", org.json.JSONArray())
        prefs(ctx).edit().putString("sosIn", o.toString()).apply()
        channels(ctx)
        val open = Intent(ctx, SosAlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val full = PendingIntent.getActivity(ctx, 71, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val ack = PendingIntent.getActivity(ctx, 72, Intent(open).putExtra("ack", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, CH_ALARM).setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("🆘 SOS von ${d["from_name"] ?: "jemandem"}")
            .setContentText(if (d["lat"].isNullOrEmpty()) "Braucht Hilfe. Standort folgt." else "Braucht Hilfe. Tippen für Standort.")
            .setCategory(Notification.CATEGORY_ALARM).setOngoing(true).setAutoCancel(false)
            .setFullScreenIntent(full, true).setContentIntent(full)
            .addAction(Notification.Action.Builder(null, "Ich kümmere mich", ack).build())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build().apply { flags = flags or Notification.FLAG_INSISTENT }
        if (canNotify(ctx)) nm(ctx).notify(ALARM_ID, n)
        ctx.sendBroadcast(Intent(CHANGED).setPackage(ctx.packageName))
    }
    fun location(ctx: Context, d: Map<String, String>) {
        val o = incoming(ctx) ?: return
        if (o.optString("id") != d["id"]) return
        o.put("lat", d["lat"] ?: "").put("lon", d["lon"] ?: "").put("acc", d["acc"] ?: "").put("loc_at", System.currentTimeMillis())
        prefs(ctx).edit().putString("sosIn", o.toString()).apply()
        ctx.sendBroadcast(Intent(CHANGED).setPackage(ctx.packageName))
    }
    fun acked(ctx: Context, d: Map<String, String>) {
        val who = d["who_name"] ?: "Jemand"
        val me = Feed.cached(ctx)?.let { Feed.me(it) }
        if (d["from"] == me) {
            // Ich habe den Notruf ausgelöst: Bescheid, wer kommt
            channels(ctx)
            if (canNotify(ctx)) nm(ctx).notify(("ack" + d["who"]).hashCode(), Notification.Builder(ctx, CH_INFO).setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("✓ $who kümmert sich").setContentText("Dein SOS ist angekommen.").setAutoCancel(true).build())
            prefs(ctx).edit().putString("sosOutAck", (prefs(ctx).getString("sosOutAck", "") ?: "").let { if (it.contains(who)) it else if (it.isEmpty()) who else "$it, $who" }).apply()
        } else incoming(ctx)?.let { o ->
            if (o.optString("id") == d["id"]) { o.getJSONArray("acks").put(who); prefs(ctx).edit().putString("sosIn", o.toString()).apply() }
        }
        ctx.sendBroadcast(Intent(CHANGED).setPackage(ctx.packageName))
    }
    fun ended(ctx: Context, d: Map<String, String>) {
        val o = incoming(ctx)
        if (o != null && o.optString("id") == d["id"]) {
            prefs(ctx).edit().remove("sosIn").apply()
            nm(ctx).cancel(ALARM_ID)
            channels(ctx)
            if (canNotify(ctx)) nm(ctx).notify(("end" + d["id"]).hashCode(), Notification.Builder(ctx, CH_INFO).setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("Entwarnung von ${d["from_name"] ?: ""}").setContentText("Der Notruf ist beendet.").setAutoCancel(true).build())
        }
        ctx.sendBroadcast(Intent(CHANGED).setPackage(ctx.packageName))
    }
    // „Ich kümmere mich“: Alarm aus, Absender und die anderen bekommen Bescheid
    fun ack(ctx: Context) {
        nm(ctx).cancel(ALARM_ID)
        val o = incoming(ctx) ?: return
        if (o.optBoolean("mine")) return
        o.put("mine", true); prefs(ctx).edit().putString("sosIn", o.toString()).apply()
        val id = o.optString("id")
        thread { Push.rpc(ctx, "widget_sos_ack", JSONObject().put("p_id", id)); Push.send(ctx, JSONObject().put("kind", "sos_ack").put("sos_id", id)) }
    }
    // Nur den Ton aus (z. B. wenn man den Alarm gesehen hat, aber jemand anderes sich kümmert)
    fun silence(ctx: Context) = nm(ctx).cancel(ALARM_ID)
    fun dismiss(ctx: Context) { silence(ctx); prefs(ctx).edit().remove("sosIn").apply() }

    // ---------- Absender ----------
    fun hasLoc(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun start(ctx: Context) {
        prefs(ctx).edit().putString("sosOut", "…").remove("sosOutAck").putLong("sosOutAt", System.currentTimeMillis()).apply()
        // Ohne Standort-Erlaubnis kein Standort-Dienst (Android lässt ihn sonst nicht starten): Alarm trotzdem senden
        if (!hasLoc(ctx)) { thread { begin(ctx, null, null, null) }; return }
        ctx.startForegroundService(Intent(ctx, SosService::class.java))
    }
    // Notruf anlegen und die Familie alarmieren; liefert die Notruf-ID
    fun begin(ctx: Context, lat: Double?, lon: Double?, acc: Double?): String? {
        val body = JSONObject().put("p_lat", lat ?: JSONObject.NULL).put("p_lon", lon ?: JSONObject.NULL).put("p_acc", acc ?: JSONObject.NULL)
        val (code, res) = Push.rpc(ctx, "widget_sos_start", body)
        if (code !in 200..299) { prefs(ctx).edit().putString("sosOut", "Fehler: " + res.take(120)).apply(); ctx.sendBroadcast(Intent(CHANGED).setPackage(ctx.packageName)); return null }
        val id = res.trim().trim('"')
        prefs(ctx).edit().putString("sosOut", id).apply()
        val (pc, pr) = Push.send(ctx, JSONObject().put("kind", "sos").put("sos_id", id))
        val sent = try { JSONObject(pr).optInt("sent", 0) } catch (e: Exception) { 0 }
        prefs(ctx).edit().putInt("sosOutSent", if (pc in 200..299) sent else -1).apply()
        ctx.sendBroadcast(Intent(CHANGED).setPackage(ctx.packageName))
        return id
    }
    fun stop(ctx: Context) { ctx.startService(Intent(ctx, SosService::class.java).setAction("stop")) }
}

// Läuft beim Absender: Notruf anlegen, Familie alarmieren, Standort 30 Minuten teilen
class SosService : Service() {
    private var cb: LocationCallback? = null
    private var id: String? = null
    private var lastPush = 0L
    private val until = System.currentTimeMillis() + 30 * 60_000L

    override fun onBind(i: Intent?): IBinder? = null

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ctx = applicationContext
        if (intent?.action == "stop") { end(); return START_NOT_STICKY }
        Sos.channels(ctx)
        val stop = PendingIntent.getService(ctx, 73, Intent(ctx, SosService::class.java).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(ctx, 74, Intent(ctx, SosActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, Sos.CH_RUN).setSmallIcon(R.drawable.ic_notify).setOngoing(true)
            .setContentTitle("SOS läuft").setContentText("Deine Familie ist alarmiert und sieht deinen Standort.")
            .setContentIntent(open).addAction(Notification.Action.Builder(null, "Entwarnung", stop).build()).build()
        val hasLoc = Sos.hasLoc(ctx)
        try {
            if (Build.VERSION.SDK_INT >= 29 && hasLoc) startForeground(Sos.RUN_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else if (Build.VERSION.SDK_INT < 34) startForeground(Sos.RUN_ID, n)
        } catch (e: Exception) { }
        if (id != null) return START_NOT_STICKY
        val fused = LocationServices.getFusedLocationProviderClient(ctx)
        fun begin(lat: Double?, lon: Double?, acc: Double?) = thread { id = Sos.begin(ctx, lat, lon, acc) }
        if (hasLoc) {
            fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { l -> begin(l?.latitude, l?.longitude, l?.accuracy?.toDouble()) }
                .addOnFailureListener { begin(null, null, null) }
            cb = object : LocationCallback() {
                override fun onLocationResult(r: LocationResult) {
                    val l = r.lastLocation ?: return
                    val sid = id ?: return
                    if (System.currentTimeMillis() > until) { end(); return }
                    thread {
                        Push.rpc(ctx, "widget_sos_loc", JSONObject().put("p_id", sid).put("p_lat", l.latitude).put("p_lon", l.longitude).put("p_acc", l.accuracy.toDouble()))
                        if (System.currentTimeMillis() - lastPush > 60_000L) { lastPush = System.currentTimeMillis(); Push.send(ctx, JSONObject().put("kind", "sos_loc").put("sos_id", sid)) }
                    }
                }
            }
            fused.requestLocationUpdates(LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 20_000L).setMinUpdateIntervalMillis(10_000L).build(), cb!!, Looper.getMainLooper())
        } else begin(null, null, null)
        return START_NOT_STICKY
    }

    private fun end() {
        val ctx = applicationContext
        cb?.let { LocationServices.getFusedLocationProviderClient(ctx).removeLocationUpdates(it) }; cb = null
        val sid = id ?: Sos.outgoing(ctx)?.takeIf { it.length > 20 }
        Sos.prefs(ctx).edit().remove("sosOut").remove("sosOutAck").apply()
        ctx.sendBroadcast(Intent(Sos.CHANGED).setPackage(ctx.packageName))
        if (sid != null) thread { Push.rpc(ctx, "widget_sos_end", JSONObject().put("p_id", sid)); Push.send(ctx, JSONObject().put("kind", "sos_end").put("sos_id", sid)) }
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
}
