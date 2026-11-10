package de.familienkalender.widget

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator

// Klingeln der Wecker (Termin und Geburtstag) wie ein echter Wecker:
// Der Ton läuft über den Wecker-Kanal des Handys (USAGE_ALARM) und ist deshalb auch im Leise- oder
// Vibrationsmodus zu hören, solange die Wecker-Lautstärke nicht auf null steht.
// Er läuft, bis man „Aus“ tippt, die Meldung wegwischt oder 5 Minuten vorbei sind.
class AlarmService : Service() {
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private val stopLater = Runnable { quiet(); stopForegroundCompat(false); stopSelf() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n: Notification? = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_N, Notification::class.java)
            else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_N)
        if (n == null) { stopSelf(); return START_NOT_STICKY }
        val nid = intent!!.getIntExtra(EXTRA_NID, 0)
        val kind = intent.getStringExtra(EXTRA_KIND) ?: "ev"
        if (Build.VERSION.SDK_INT >= 29) startForeground(nid, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(nid, n)
        quiet()
        ring(this, kind)
        handler.removeCallbacks(stopLater)
        handler.postDelayed(stopLater, RING_MS)
        return START_NOT_STICKY
    }

    private fun ring(ctx: Context, kind: String) {
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        player = try { start(ctx, Tones.uri(ctx, kind), attrs) } catch (e: Exception) {
            // Gewählter Ton nicht (mehr) da: Weckton des Handys
            try { start(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), attrs) } catch (x: Exception) { null }
        }
        try {
            val v = getSystemService(Vibrator::class.java)
            if (v != null && v.hasVibrator()) {
                @Suppress("DEPRECATION")
                v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600, 400, 600, 1200), 0), attrs)
                vibrator = v
            }
        } catch (e: Exception) { }
    }

    private fun start(ctx: Context, uri: android.net.Uri, attrs: AudioAttributes) = MediaPlayer().apply {
        setAudioAttributes(attrs)
        setDataSource(ctx, uri)
        isLooping = true
        prepare()
        start()
    }

    private fun quiet() {
        try { player?.stop() } catch (e: Exception) { }
        try { player?.release() } catch (e: Exception) { }
        player = null
        try { vibrator?.cancel() } catch (e: Exception) { }
        vibrator = null
    }

    @Suppress("DEPRECATION")
    private fun stopForegroundCompat(remove: Boolean) {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(if (remove) STOP_FOREGROUND_REMOVE else STOP_FOREGROUND_DETACH)
        else stopForeground(remove)
    }

    override fun onDestroy() {
        handler.removeCallbacks(stopLater)
        quiet()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_N = "n"
        private const val EXTRA_NID = "nid"
        private const val EXTRA_KIND = "kind"
        private const val RING_MS = 5 * 60_000L

        // Wecker klingeln lassen; klappt der Dienst nicht, wenigstens die Meldung mit kurzem Weckton
        fun ring(ctx: Context, nid: Int, n: Notification, kind: String) {
            try {
                val i = Intent(ctx, AlarmService::class.java).putExtra(EXTRA_N, n).putExtra(EXTRA_NID, nid).putExtra(EXTRA_KIND, kind)
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                try { nm.notify(nid, n) } catch (x: Exception) { }
                try {
                    val r = RingtoneManager.getRingtone(ctx, Tones.uri(ctx, kind)) ?: return
                    r.audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                    if (Build.VERSION.SDK_INT >= 28) r.isLooping = true
                    r.play()
                    Handler(Looper.getMainLooper()).postDelayed({ try { r.stop() } catch (x: Exception) { } }, 60_000)
                } catch (x: Exception) { }
            }
        }

        fun stop(ctx: Context) { try { ctx.stopService(Intent(ctx, AlarmService::class.java)) } catch (e: Exception) { } }
    }
}
