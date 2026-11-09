package de.familienkalender.widget

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast
import java.net.HttpURLConnection
import java.net.URL

// Selbst-Update: neue Version erkennen (Versionsnummer neben der APK im Download-Ordner der Web-App),
// im Hintergrund laden und über den Paket-Installer einspielen. Ab Android 12 ohne Rückfrage,
// sobald FamTO sich einmal selbst installiert hat.
object Updater {
    private const val BASE = "https://app.famto.example/download/"
    private const val PREFS = "familien-widget"
    const val DONE = "de.familienkalender.widget.UPDATE_DONE"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun latest(ctx: Context) = prefs(ctx).getInt("latestVer", 0)
    fun available(ctx: Context) = latest(ctx) > BuildConfig.VERSION_CODE

    private fun get(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15000; readTimeout = 60000; instanceFollowRedirects = true
    }

    // Höchstens alle 30 Minuten nachsehen (oder sofort mit force); gibt true zurück, wenn sich etwas geändert hat
    fun check(ctx: Context, force: Boolean = false): Boolean {
        val p = prefs(ctx)
        if (!force && System.currentTimeMillis() - p.getLong("latestChk", 0) < 30 * 60_000L) return false
        return try {
            val v = get(BASE + "familien-widget-version.txt").inputStream.bufferedReader().use { it.readText().trim().toInt() }
            val before = latest(ctx)
            p.edit().putInt("latestVer", v).putLong("latestChk", System.currentTimeMillis()).apply()
            v != before
        } catch (e: Exception) { false }
    }

    // Laden und installieren (läuft im Hintergrund-Thread)
    fun install(ctx: Context, progress: (String) -> Unit) {
        val pi = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            val c = get(BASE + "familien-widget.apk")
            val total = c.contentLengthLong
            c.inputStream.use { inp ->
                s.openWrite("famto.apk", 0, if (total > 0) total else -1).use { out ->
                    val buf = ByteArray(64 * 1024); var done = 0L; var shown = -1
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n
                        if (total > 0) { val pct = (done * 100 / total).toInt(); if (pct / 10 != shown) { shown = pct / 10; progress("Lädt … $pct %") } }
                    }
                    s.fsync(out)
                }
            }
            progress("Wird installiert …")
            val cb = PendingIntent.getBroadcast(ctx, 60, Intent(ctx, UpdateReceiver::class.java).setAction(DONE),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            s.commit(cb.intentSender)
        }
    }
}

// Rückmeldung des Installers: Rückfrage nötig → Bestätigungsfenster zeigen; Fehler → kurz melden
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> { }
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
                if (!msg.contains("abort", true)) Toast.makeText(ctx, "Update ging nicht: $msg", Toast.LENGTH_LONG).show()
            }
        }
    }
}
