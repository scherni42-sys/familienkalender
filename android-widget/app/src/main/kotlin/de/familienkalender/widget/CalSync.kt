package de.familienkalender.widget

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

// Termine in den Kalender des Handys (Samsung-, Google-Kalender …) als eigenen Kalender „Familienkalender“ schreiben.
// Nur in eine Richtung: der Familienkalender bleibt die Quelle, der Handy-Kalender zeigt ihn an (nur lesbar).
object CalSync {
    private const val PREFS = "familien-widget"
    private const val ACCOUNT = "Familienkalender"

    fun enabled(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("calsync", false)
    fun setEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("calsync", on).putString("calhash", "").apply()

    private fun allowed(ctx: Context) =
        ctx.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
            ctx.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    // Als „Sync-Adapter“ schreiben dürfen wir in unseren eigenen lokalen Kalender
    private fun asSync(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(android.provider.CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT)
        .appendQueryParameter(Calendars.ACCOUNT_TYPE, android.provider.CalendarContract.ACCOUNT_TYPE_LOCAL)
        .build()

    private fun calendarId(ctx: Context): Long? {
        val cr = ctx.contentResolver
        cr.query(Calendars.CONTENT_URI, arrayOf(Calendars._ID),
            "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?",
            arrayOf(ACCOUNT, android.provider.CalendarContract.ACCOUNT_TYPE_LOCAL), null)?.use { if (it.moveToFirst()) return it.getLong(0) }
        val v = ContentValues().apply {
            put(Calendars.ACCOUNT_NAME, ACCOUNT)
            put(Calendars.ACCOUNT_TYPE, android.provider.CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(Calendars.NAME, ACCOUNT)
            put(Calendars.CALENDAR_DISPLAY_NAME, "Fam-TO")
            put(Calendars.CALENDAR_COLOR, 0xFF1D8657.toInt())
            put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_READ)
            put(Calendars.OWNER_ACCOUNT, ACCOUNT)
            put(Calendars.VISIBLE, 1)
            put(Calendars.SYNC_EVENTS, 1)
            put(Calendars.CALENDAR_TIME_ZONE, ZoneId.systemDefault().id)
        }
        return cr.insert(asSync(Calendars.CONTENT_URI), v)?.let { ContentUris.parseId(it) }
    }

    // Kalender wieder entfernen (Schalter aus)
    fun remove(ctx: Context) {
        if (!allowed(ctx)) return
        ctx.contentResolver.delete(asSync(Calendars.CONTENT_URI),
            "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?", arrayOf(ACCOUNT, android.provider.CalendarContract.ACCOUNT_TYPE_LOCAL))
    }

    fun sync(ctx: Context, feed: JSONObject) {
        if (!enabled(ctx) || !allowed(ctx)) return
        val evs = feed.optJSONArray("events") ?: JSONArray()
        val bds = feed.optJSONArray("birthdays") ?: JSONArray()
        // Nur schreiben, wenn sich etwas geändert hat
        val hash = (evs.toString() + bds.toString()).hashCode().toString()
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString("calhash", "") == hash) return
        val cal = calendarId(ctx) ?: return
        val cr = ctx.contentResolver
        val zone = ZoneId.systemDefault()

        // Gewünschter Stand: sync_id -> Werte
        val want = LinkedHashMap<String, ContentValues>()
        for (i in 0 until evs.length()) {
            val e = evs.getJSONObject(i)
            if (e.optString("ext_id").isNotEmpty() && e.optString("ext_id") != "null") continue  // stammt schon aus dem Handy-Kalender
            val date = try { LocalDate.parse(e.optString("date")) } catch (x: Exception) { continue }
            val end = try { LocalDate.parse(e.optString("end_date")) } catch (x: Exception) { date }
            val v = ContentValues()
            val priv = e.optString("vis", "family") != "family"
            v.put(Events.TITLE, (if (priv) "🔒 " else "") + e.optString("title"))
            v.put(Events.EVENT_LOCATION, listOf(e.optString("place"), e.optString("addr")).filter { it.isNotBlank() }.joinToString(", "))
            v.put(Events.DESCRIPTION, e.optString("notes"))
            if (e.optBoolean("all_day")) {
                v.put(Events.ALL_DAY, 1)
                v.put(Events.EVENT_TIMEZONE, "UTC")
                v.put(Events.DTSTART, date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
                v.put(Events.DTEND, end.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            } else {
                val s = date.atStartOfDay(zone).plusMinutes(e.optInt("start_min").toLong())
                val en = date.atStartOfDay(zone).plusMinutes(e.optInt("end_min").toLong()).let { if (it.isAfter(s)) it else s.plusHours(1) }
                v.put(Events.ALL_DAY, 0)
                v.put(Events.EVENT_TIMEZONE, zone.id)
                v.put(Events.DTSTART, s.toInstant().toEpochMilli())
                v.put(Events.DTEND, en.toInstant().toEpochMilli())
            }
            want["ev:" + e.optString("id")] = v
        }
        // Geburtstage als jährlich wiederkehrende ganztägige Termine
        for (i in 0 until bds.length()) {
            val b = bds.getJSONObject(i)
            val year = b.optInt("year", 0).takeIf { it > 1900 } ?: 2000
            val d = try { LocalDate.of(year, b.optInt("month"), b.optInt("day")) } catch (x: Exception) { continue }
            val v = ContentValues()
            v.put(Events.TITLE, "🎂 " + (if (b.isNull("owner")) "" else "🔒 ") + b.optString("name"))
            v.put(Events.ALL_DAY, 1)
            v.put(Events.EVENT_TIMEZONE, "UTC")
            v.put(Events.DTSTART, d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            v.put(Events.DURATION, "P1D")
            v.put(Events.RRULE, "FREQ=YEARLY")
            want["bd:" + b.optString("id")] = v
        }

        // Vorhandene Einträge abgleichen
        val have = HashMap<String, Long>()
        cr.query(asSync(Events.CONTENT_URI), arrayOf(Events._ID, Events._SYNC_ID, Events.DTSTART), "${Events.CALENDAR_ID}=?", arrayOf(cal.toString()), null)?.use { c ->
            // Ältere Termine (vor Montag dieser Woche) liefert der Server nicht mehr; die bleiben stehen
            val from = LocalDate.now().with(java.time.DayOfWeek.MONDAY).minusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            while (c.moveToNext()) {
                val sid = c.getString(1) ?: continue
                have[sid] = c.getLong(0)
                if (sid !in want && (sid.startsWith("bd:") || c.getLong(2) >= from))
                    cr.delete(asSync(ContentUris.withAppendedId(Events.CONTENT_URI, c.getLong(0))), null, null)
            }
        }
        for ((sid, v) in want) {
            val id = have[sid]
            if (id != null) {
                cr.update(asSync(ContentUris.withAppendedId(Events.CONTENT_URI, id)), v, null, null)
            } else {
                v.put(Events.CALENDAR_ID, cal)
                v.put(Events._SYNC_ID, sid)
                cr.insert(asSync(Events.CONTENT_URI), v)
            }
        }
        prefs.edit().putString("calhash", hash).apply()
    }
}
