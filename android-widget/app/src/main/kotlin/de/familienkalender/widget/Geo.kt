package de.familienkalender.widget

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

// Automatischer Home-Modus: Geofence um „Zuhause“. Betreten → Home an, Verlassen → Home aus.
// Der Knopf im Widget übersteuert das bis zum nächsten Betreten oder Verlassen.
object Geo {
    private const val PREFS = "familien-widget"
    private const val FENCE = "zuhause"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun enabled(ctx: Context) = prefs(ctx).getBoolean("geo", false)
    fun setEnabled(ctx: Context, on: Boolean) { prefs(ctx).edit().putBoolean("geo", on).apply(); if (on) register(ctx) else unregister(ctx) }
    fun radius(ctx: Context) = prefs(ctx).getInt("georadius", 500)
    fun setRadius(ctx: Context, m: Int) { prefs(ctx).edit().putInt("georadius", m.coerceIn(100, 5000)).apply(); register(ctx) }
    fun home(ctx: Context): Pair<Double, Double>? {
        val p = prefs(ctx)
        if (!p.contains("geolat")) return null
        return java.lang.Double.longBitsToDouble(p.getLong("geolat", 0)) to java.lang.Double.longBitsToDouble(p.getLong("geolng", 0))
    }

    fun hasFine(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun hasBackground(ctx: Context) = Build.VERSION.SDK_INT < 29 ||
        ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun pending(ctx: Context): PendingIntent = PendingIntent.getBroadcast(ctx, 40,
        Intent(ctx, GeoReceiver::class.java).setAction("de.familienkalender.widget.GEOFENCE"),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))

    // Aktuellen Standort als Zuhause speichern
    @SuppressLint("MissingPermission")
    fun setHereAsHome(ctx: Context, done: (String) -> Unit) {
        if (!hasFine(ctx)) { done("Bitte zuerst den Standort erlauben."); return }
        LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener { loc ->
                if (loc == null) { done("Standort nicht gefunden. Bitte GPS einschalten und nochmal versuchen."); return@addOnSuccessListener }
                prefs(ctx).edit().putLong("geolat", java.lang.Double.doubleToRawLongBits(loc.latitude))
                    .putLong("geolng", java.lang.Double.doubleToRawLongBits(loc.longitude)).apply()
                register(ctx)
                done("Zuhause gespeichert (Genauigkeit etwa ${loc.accuracy.toInt()} m).")
            }
            .addOnFailureListener { done("Standort nicht gefunden: ${it.message}") }
    }

    @SuppressLint("MissingPermission")
    fun register(ctx: Context) {
        val h = home(ctx) ?: return
        if (!enabled(ctx) || !hasFine(ctx) || !hasBackground(ctx)) return
        val fence = Geofence.Builder().setRequestId(FENCE)
            .setCircularRegion(h.first, h.second, radius(ctx).toFloat())
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()
        val req = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_EXIT)
            .addGeofence(fence).build()
        val client = LocationServices.getGeofencingClient(ctx)
        client.removeGeofences(pending(ctx)).addOnCompleteListener { try { client.addGeofences(req, pending(ctx)) } catch (e: Exception) { } }
    }

    fun unregister(ctx: Context) { try { LocationServices.getGeofencingClient(ctx).removeGeofences(pending(ctx)) } catch (e: Exception) { } }

    fun status(ctx: Context): String = when {
        !enabled(ctx) -> ""
        !hasFine(ctx) -> "Bitte den Standort erlauben."
        !hasBackground(ctx) -> "Bitte beim Standort „Immer erlauben“ wählen, sonst merkt die App nicht, wenn du nach Hause kommst."
        home(ctx) == null -> "Bitte zu Hause auf „Hier ist Zuhause“ tippen."
        else -> "Aktiv: Home-Modus im Umkreis von ${radius(ctx)} m um Zuhause. Jetzt: " + (if (Feed.homeMode(ctx)) "Home" else "unterwegs")
    }
}

class GeoReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) { Geo.register(ctx); Alarms.restore(ctx); return }
        val ev = GeofencingEvent.fromIntent(intent) ?: return
        if (ev.hasError()) return
        val home = when (ev.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> true
            Geofence.GEOFENCE_TRANSITION_EXIT -> false
            else -> return
        }
        if (Feed.homeMode(ctx) != home) {
            Feed.setHome(ctx, home)
            TodayWidget.refreshData(ctx)
            Feed.cached(ctx)?.let { NextWidget.updateAll(ctx, it) }
        }
    }
}
