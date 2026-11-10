package de.familienkalender.widget

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
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
// Vibrationsmodus zu hören. Ist die Wecker-Lautstärke niedrig, wird sie beim Klingeln angehoben und danach zurückgestellt.
// Ausschalten: großer „Aus“-Knopf im Wecker-Bildschirm, „Aus“ in der Meldung, Meldung antippen oder
// wegwischen, Lautstärketaste im Wecker-Bildschirm. Spätestens nach 3 Minuten ist von selbst Ruhe.
class AlarmService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val stopLater = Runnable { quiet(); stopForegroundCompat(false); stopSelf() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            handler.removeCallbacks(stopLater)
            quiet()
            stopForegroundCompat(true)
            cancelAll(this)
            stopSelf()
            return START_NOT_STICKY
        }
        val n: Notification? = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_N, Notification::class.java)
            else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_N)
        if (n == null) { stopSelf(); return START_NOT_STICKY }
        val nid = intent!!.getIntExtra(EXTRA_NID, 0)
        val kind = intent.getStringExtra(EXTRA_KIND) ?: "ev"
        if (Build.VERSION.SDK_INT >= 29) startForeground(nid, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(nid, n)
        quiet()
        sound(this, kind)
        handler.removeCallbacks(stopLater)
        handler.postDelayed(stopLater, RING_MS)
        return START_NOT_STICKY
    }

    @Suppress("DEPRECATION")
    private fun stopForegroundCompat(remove: Boolean) = stopForeground(if (remove) STOP_FOREGROUND_REMOVE else STOP_FOREGROUND_DETACH)

    override fun onDestroy() {
        handler.removeCallbacks(stopLater)
        quiet()
        super.onDestroy()
    }

    override fun onTimeout(startId: Int, fgsType: Int) { quiet(); stopSelf() }

    companion object {
        const val ACTION_STOP = "de.familienkalender.widget.ALARM_STOP"
        private const val EXTRA_N = "n"
        private const val EXTRA_NID = "nid"
        private const val EXTRA_KIND = "kind"
        private const val RING_MS = 3 * 60_000L
        private val NIDS = intArrayOf(4711, 4712)

        // Ton und Vibration liegen hier (nicht im Dienst), damit jeder Weg zum Ausschalten sie sicher findet
        private var player: MediaPlayer? = null
        // Solange es klingelt, landen die Lautstärketasten hier und schalten den Wecker aus (auch bei gesperrtem Handy)
        private var session: android.media.session.MediaSession? = null
        private var vibrator: Vibrator? = null
        private val main = Handler(Looper.getMainLooper())
        private val autoQuiet = Runnable { quiet() }
        private val attrs: AudioAttributes get() = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()

        // Wecker-Lautstärke des Handys vor dem Klingeln, um sie danach zurückzustellen (-1 = nicht geändert)
        private var oldVolume = -1
        private var audio: android.media.AudioManager? = null

        @Synchronized private fun sound(ctx: Context, kind: String) {
            quiet()
            val app = ctx.applicationContext
            // Steht die Wecker-Lautstärke niedrig, beim Klingeln auf 85 % anheben (wie ein Wecker, der nicht überhört werden soll)
            try {
                val am = app.getSystemService(android.media.AudioManager::class.java)
                val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM)
                val cur = am.getStreamVolume(android.media.AudioManager.STREAM_ALARM)
                val want = Math.ceil(max * 0.85).toInt()
                if (cur < want) { am.setStreamVolume(android.media.AudioManager.STREAM_ALARM, want, 0); oldVolume = cur; audio = am }
            } catch (e: Exception) { }
            player = try { play(app, Tones.uri(app, kind)) } catch (e: Exception) {
                // Gewählter Ton nicht (mehr) da: Weckton des Handys
                try { play(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)) } catch (x: Exception) { null }
            }
            try {
                session = android.media.session.MediaSession(app, "famto-wecker").apply {
                    setPlaybackToRemote(object : android.media.VolumeProvider(android.media.VolumeProvider.VOLUME_CONTROL_RELATIVE, 100, 50) {
                        override fun onAdjustVolume(direction: Int) { main.post { stop(app) } }
                    })
                    setPlaybackState(android.media.session.PlaybackState.Builder()
                        .setState(android.media.session.PlaybackState.STATE_PLAYING, 0, 1f).build())
                    isActive = true
                }
            } catch (e: Exception) { }
            try {
                val v = app.getSystemService(Vibrator::class.java)
                if (v != null && v.hasVibrator()) {
                    @Suppress("DEPRECATION")
                    v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600, 400, 600, 1200), 0), attrs)
                    vibrator = v
                }
            } catch (e: Exception) { }
        }

        private fun play(ctx: Context, uri: android.net.Uri) = MediaPlayer().apply {
            setAudioAttributes(attrs)
            setDataSource(ctx, uri)
            isLooping = true
            prepare()
            start()
        }

        @Synchronized fun quiet() {
            main.removeCallbacks(autoQuiet)
            try { player?.stop() } catch (e: Exception) { }
            try { player?.release() } catch (e: Exception) { }
            player = null
            try { vibrator?.cancel() } catch (e: Exception) { }
            vibrator = null
            try { session?.isActive = false; session?.release() } catch (e: Exception) { }
            session = null
            if (oldVolume >= 0) try { audio?.setStreamVolume(android.media.AudioManager.STREAM_ALARM, oldVolume, 0) } catch (e: Exception) { }
            oldVolume = -1; audio = null
        }

        private fun cancelAll(ctx: Context) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            NIDS.forEach { try { nm.cancel(it) } catch (e: Exception) { } }
        }

        // Ausschalten-Intent, der direkt beim Wecker ankommt (für „Aus“ und Wegwischen)
        private fun stopIntent(ctx: Context, code: Int) = PendingIntent.getService(ctx, code,
            Intent(ctx, AlarmService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        // Wecker klingeln lassen: Meldung mit „Aus“, Wecker-Bildschirm (auch auf dem Sperrbildschirm), Ton und Vibration
        fun ring(ctx: Context, nid: Int, kind: String, title: String, text: String, open: String, timeoutMs: Long) {
            val screen = Intent(ctx, AlarmActivity::class.java)
                .putExtra(AlarmActivity.EXTRA_TITLE, title).putExtra(AlarmActivity.EXTRA_TEXT, text).putExtra(AlarmActivity.EXTRA_OPEN, open)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            val full = PendingIntent.getActivity(ctx, nid + 100, screen, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            // Meldung antippen: Wecker aus und den Termin öffnen
            val tap = PendingIntent.getActivity(ctx, nid + 200, Intent(ctx, OpenActivity::class.java)
                .putExtra(OpenActivity.EXTRA_OPEN, open).putExtra(OpenActivity.EXTRA_ALARM_OFF, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val off = stopIntent(ctx, nid + 300)
            val n = Notification.Builder(ctx, Tones.channel(ctx, kind))
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(text)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(tap)
                .setFullScreenIntent(full, true)
                .setDeleteIntent(off)
                .setTimeoutAfter(timeoutMs)
                .addAction(Notification.Action.Builder(null, "Aus", off).build())
                .build()
            try {
                val i = Intent(ctx, AlarmService::class.java).putExtra(EXTRA_N, n).putExtra(EXTRA_NID, nid).putExtra(EXTRA_KIND, kind)
                ctx.startForegroundService(i)
                // Wecker-Bildschirm auch dann zeigen, wenn das Handy gerade benutzt wird
                // (die Vollbild-Meldung erscheint sonst nur bei gesperrtem Handy); verbietet Android es, bleibt die Meldung
                try { ctx.startActivity(screen) } catch (x: Exception) { }
            } catch (e: Exception) {
                // Dienst darf gerade nicht starten: Meldung zeigen und selbst klingeln, nach 3 Minuten Ruhe
                val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                try { nm.notify(nid, n) } catch (x: Exception) { }
                sound(ctx, kind)
                main.postDelayed(autoQuiet, RING_MS)
            }
        }

        // Damit der Wecker-Bildschirm mit „Aus“ auch bei entsperrtem Handy erscheint, braucht FamTO die Erlaubnis
        // „Über anderen Apps einblenden“ (sonst verbietet Android das Öffnen aus dem Hintergrund).
        // Für den Sperrbildschirm braucht Android 14+ zusätzlich „Vollbild-Benachrichtigungen“.
        // Beim Stellen eines Weckers wird jeweils einmal danach gefragt, eins nach dem anderen.
        fun askFullScreen(act: android.app.Activity) {
            val prefs = act.getSharedPreferences("familien-widget", Context.MODE_PRIVATE)
            fun open(action: String) { try { act.startActivity(Intent(action, android.net.Uri.parse("package:" + act.packageName))) } catch (e: Exception) { } }
            if (!android.provider.Settings.canDrawOverlays(act) && !prefs.getBoolean("overlayAsked", false)) {
                prefs.edit().putBoolean("overlayAsked", true).apply()
                android.widget.Toast.makeText(act, "Bitte „Über anderen Apps einblenden“ für FamTO erlauben. Dann erscheint beim Wecker immer ein großer Aus-Knopf.", android.widget.Toast.LENGTH_LONG).show()
                open(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                return
            }
            if (Build.VERSION.SDK_INT < 34) return
            if (act.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()) return
            if (prefs.getBoolean("fsiAsked", false)) return
            prefs.edit().putBoolean("fsiAsked", true).apply()
            android.widget.Toast.makeText(act, "Bitte für FamTO einschalten, damit der Wecker auch auf dem Sperrbildschirm einen Aus-Knopf zeigt.", android.widget.Toast.LENGTH_LONG).show()
            open(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
        }

        // Wecker ausschalten, egal auf welchem Weg er klingelt
        fun stop(ctx: Context) {
            quiet()
            try { ctx.stopService(Intent(ctx, AlarmService::class.java)) } catch (e: Exception) { }
            cancelAll(ctx)
        }
    }
}
