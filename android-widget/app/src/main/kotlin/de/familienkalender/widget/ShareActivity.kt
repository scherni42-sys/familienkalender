package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import java.io.File

// „Teilen mit FamTO“: PDF-Rechnung oder Foto aus Mail, Dateien, Galerie wird ein neuer Beleg im Kassenbuch.
// Die Datei landet kurz im Cache; die Web-App holt sie über FamTO.takeShared() ab.
class ShareActivity : Activity() {
    companion object {
        fun pending(ctx: android.content.Context): File = File(File(ctx.cacheDir, "share").apply { mkdirs() }, "pending")
        const val PREF = "famto-share"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            @Suppress("DEPRECATION")
            val uri: Uri? = if (intent?.action == Intent.ACTION_SEND) intent.getParcelableExtra(Intent.EXTRA_STREAM) else intent?.data
            if (uri != null) {
                var name = "beleg"
                contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0)?.let { name = it } }
                val mime = contentResolver.getType(uri) ?: intent.type ?: if (name.endsWith(".pdf", true)) "application/pdf" else "image/jpeg"
                contentResolver.openInputStream(uri)?.use { inp -> pending(this).outputStream().use { inp.copyTo(it) } }
                getSharedPreferences(PREF, MODE_PRIVATE).edit().putString("name", name).putString("mime", mime).putLong("at", System.currentTimeMillis()).apply()
                val target = if (Feed.config(this) != null) Intent(this, AppActivity::class.java).putExtra(AppActivity.EXTRA_OPEN, "cash:share")
                    else Intent(this, SetupActivity::class.java)
                startActivity(target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            }
        } catch (e: Exception) {
            android.widget.Toast.makeText(this, "Die Datei ließ sich nicht übernehmen.", android.widget.Toast.LENGTH_LONG).show()
        }
        finish()
    }
}
