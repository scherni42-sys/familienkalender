package de.familienkalender.widget

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri

// Klingeltöne der Wecker: „bd“ (Geburtstag) und „ev“ (Termin). Eigene Töne von FamTO oder ein Ton vom Handy.
// Android legt den Ton im Benachrichtigungskanal fest; bei einem neuen Ton gibt es deshalb einen neuen Kanal.
object Tones {
    private const val PREFS = "familien-widget"
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun raw(ctx: Context, name: String) = Uri.parse("android.resource://${ctx.packageName}/raw/$name")
    private fun default(kind: String) = if (kind == "bd") "birthday" else "beep"

    // which: birthday | beep | alarm | Inhalt-URI eines Handy-Klingeltons
    fun which(ctx: Context, kind: String) = prefs(ctx).getString("tone_$kind", null) ?: default(kind)
    fun set(ctx: Context, kind: String, which: String) = prefs(ctx).edit().putString("tone_$kind", which).apply()

    fun uri(ctx: Context, kind: String): Uri = when (val w = which(ctx, kind)) {
        "birthday" -> raw(ctx, "famto_birthday")
        "beep" -> raw(ctx, "famto_beep")
        "alarm" -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        else -> Uri.parse(w)
    }

    fun title(ctx: Context, kind: String): String = when (val w = which(ctx, kind)) {
        "birthday" -> "Happy Birthday (FamTO)"
        "beep" -> "Piepen (FamTO)"
        "alarm" -> "Weckton des Handys"
        else -> try { RingtoneManager.getRingtone(ctx, Uri.parse(w))?.getTitle(ctx) ?: "Eigener Ton" } catch (e: Exception) { "Eigener Ton" }
    }

    // Kurz anspielen, damit man hört, was man gewählt hat
    private var playing: android.media.Ringtone? = null
    fun preview(ctx: Context, kind: String) {
        try {
            playing?.stop()
            val r = RingtoneManager.getRingtone(ctx, uri(ctx, kind)) ?: return
            r.audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            r.play(); playing = r
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ try { r.stop() } catch (e: Exception) { } }, 6000)
        } catch (e: Exception) { }
    }

    // Kanal mit dem gewählten Ton; alte Kanäle desselben Weckers werden entfernt
    fun channel(ctx: Context, kind: String): String {
        val base = if (kind == "bd") "geburtstagswecker" else "terminwecker"
        val u = uri(ctx, kind)
        val id = "$base-" + Integer.toHexString(u.toString().hashCode())
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notificationChannels.filter { (it.id == base || it.id.startsWith("$base-")) && it.id != id }.forEach { nm.deleteNotificationChannel(it.id) }
        if (nm.getNotificationChannel(id) == null) nm.createNotificationChannel(NotificationChannel(id, if (kind == "bd") "Geburtstags-Wecker" else "Termin-Wecker", NotificationManager.IMPORTANCE_HIGH).apply {
            description = if (kind == "bd") "Klingelt am Geburtstag zur eingestellten Uhrzeit" else "Klingelt vor wichtigen Terminen"
            setSound(u, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        return id
    }
}
