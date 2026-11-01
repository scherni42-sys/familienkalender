package de.familienkalender.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// Vorschaubilder der Board-Fotos: einmal laden, verkleinert im Cache-Ordner ablegen
object Photos {
    private const val MAX = 320

    fun thumb(ctx: Context, path: String): Bitmap? {
        val name = path.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val f = File(ctx.cacheDir, "board_$name")
        if (!f.exists()) {
            val c = Feed.config(ctx) ?: return null
            try {
                val conn = URL("${c.url}/storage/v1/object/public/board/$path").openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 15000
                if (conn.responseCode !in 200..299) return null
                val bytes = conn.inputStream.use { it.readBytes() }
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var s = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (s * 2) >= MAX) s *= 2
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = s }) ?: return null
                val k = MAX.toFloat() / maxOf(bmp.width, bmp.height)
                val small = if (k < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * k).toInt(), (bmp.height * k).toInt(), true) else bmp
                f.outputStream().use { small.compress(Bitmap.CompressFormat.JPEG, 80, it) }
                return small
            } catch (e: Exception) { return null }
        }
        return BitmapFactory.decodeFile(f.absolutePath)
    }
}
