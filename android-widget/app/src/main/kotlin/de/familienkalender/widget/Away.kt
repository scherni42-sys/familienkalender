package de.familienkalender.widget

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

// Sicherheits-Check für Fahrer: Bin ich kurz vor einer Fahrt weit weg von zu Hause,
// rechnet die App die Fahrzeit vom aktuellen Standort (OpenStreetMap: Photon und OSRM, ohne Schlüssel).
object Away {
    private const val PREFS = "familien-widget"
    private const val UA = "FamTO-Familienkalender/1.0 (https://app.famto.example/)"
    const val FAR_KM = 15.0 // ab so weit Luftlinie von zu Hause wird nachgerechnet

    // Fahrzeit, die der Fahrer per Knopf übernommen hat (gilt nur auf diesem Handy, nur für diesen Termin)
    fun override(ctx: Context, key: String): Int? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("away:$key", -1).takeIf { it > 0 }
    fun setOverride(ctx: Context, key: String, min: Int) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("away:$key", min).apply()

    @SuppressLint("MissingPermission")
    fun here(ctx: Context): Location? {
        if (Looper.myLooper() == Looper.getMainLooper()) return null
        if (!Geo.hasFine(ctx) && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) return null
        return try {
            val client = LocationServices.getFusedLocationProviderClient(ctx)
            val last = Tasks.await(client.lastLocation, 5, TimeUnit.SECONDS)
            if (last != null && System.currentTimeMillis() - last.time < 30 * 60_000) last
            else Tasks.await(client.getCurrentLocation(com.google.android.gms.location.Priority.PRIORITY_BALANCED_POWER_ACCURACY, null), 15, TimeUnit.SECONDS) ?: last
        } catch (e: Exception) { null }
    }

    private fun get(url: String): JSONObject? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 10000
        c.setRequestProperty("User-Agent", UA)
        if (c.responseCode == 200) JSONObject(c.inputStream.bufferedReader().readText()) else null
    } catch (e: Exception) { null }

    // Ziel-Adresse in Koordinaten (lon, lat); ohne Treffer ohne Hausnummer, zuletzt nur PLZ und Ort
    fun geocode(addr: String): Pair<Double, Double>? {
        val tries = listOf(addr, addr.replace(Regex("(\\D)\\s*\\d+\\s*[a-zA-Z]?\\s*,"), "$1,"), addr.split(",").last().trim()).filter { it.isNotBlank() }.distinct()
        for (t in tries) {
            val f = get("https://photon.komoot.io/api/?limit=1&lang=de&q=" + URLEncoder.encode(t, "UTF-8"))?.optJSONArray("features")?.optJSONObject(0) ?: continue
            val c = f.optJSONObject("geometry")?.optJSONArray("coordinates") ?: continue
            return c.getDouble(0) to c.getDouble(1)
        }
        return null
    }

    // Fahrzeit in Minuten mit dem Auto vom Standort zur Adresse: erst über FamTO (Google mit Verkehr, falls eingerichtet), sonst direkt OSRM
    fun minutes(ctx: Context, from: Location, addr: String): Int? = viaServer(ctx, from, addr) ?: minutes(from, addr)

    private fun viaServer(ctx: Context, from: Location, addr: String): Int? = try {
        val c = Feed.config(ctx) ?: throw Exception()
        val conn = URL("${c.url}/functions/v1/travel-time").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"; conn.connectTimeout = 10000; conn.readTimeout = 20000; conn.doOutput = true
        conn.setRequestProperty("apikey", c.key)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("widget_token", c.token).put("from", "%.5f,%.5f".format(java.util.Locale.US, from.latitude, from.longitude)).put("to", addr).toString().toByteArray()) }
        if (conn.responseCode == 200) JSONObject(conn.inputStream.bufferedReader().readText()).optInt("minutes", 0).takeIf { it > 0 } else null
    } catch (e: Exception) { null }

    fun minutes(from: Location, addr: String): Int? {
        val to = geocode(addr) ?: return null
        val r = get("https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.first},${to.second}?overview=false")
            ?.optJSONArray("routes")?.optJSONObject(0) ?: return null
        return Math.ceil(r.getDouble("duration") / 60.0).toInt().coerceAtLeast(1)
    }

    fun kmFromHome(ctx: Context, loc: Location): Double? {
        val h = Geo.home(ctx) ?: return null
        val out = FloatArray(1)
        Location.distanceBetween(loc.latitude, loc.longitude, h.first, h.second, out)
        return out[0] / 1000.0
    }
}
