package de.familienkalender.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit
import kotlin.concurrent.thread

// Mini-Widget (2×1): nur der nächste Termin mit Countdown
class NextWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        // Erst sofort aus dem Zwischenspeicher, dann frisch laden
        Feed.cached(ctx)?.let { updateAll(ctx, it) }
        val done = goAsync()
        thread {
            try { Feed.load(ctx, 20_000).first?.let { updateAll(ctx, it) } } finally { done.finish() }
        }
        TodayWidget.schedule(ctx)
    }

    override fun onDisabled(ctx: Context) = TodayWidget.unscheduleIfUnused(ctx)

    companion object {
        private fun hm(t: LocalDateTime) = "%d:%02d".format(t.hour, t.minute)

        fun updateAll(ctx: Context, feed: JSONObject) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, NextWidget::class.java))
            if (ids.isEmpty()) return
            val v = views(ctx, feed)
            for (id in ids) mgr.updateAppWidget(id, v)
        }

        private fun views(ctx: Context, feed: JSONObject): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.next)
            val now = LocalDateTime.now()
            val u = Reminders.mine(feed).firstOrNull { it.end.isAfter(now) }
            if (u == null) {
                v.setTextViewText(R.id.n_when, "")
                v.setTextViewText(R.id.n_title, "Keine Termine")
                v.setViewVisibility(R.id.n_lock, android.view.View.GONE)
                v.setTextViewText(R.id.n_sub, "in den nächsten Wochen")
            } else {
                val mins = ChronoUnit.MINUTES.between(now, u.start)
                val days = ChronoUnit.DAYS.between(LocalDate.now(), u.date)
                v.setTextViewText(R.id.n_when, when {
                    mins <= 0 -> "läuft bis ${hm(u.end)}"
                    mins < 60 -> "in $mins Min"
                    days == 0L -> "in ${mins / 60} Std" + if (mins % 60 > 0) " ${mins % 60} Min" else ""
                    days == 1L -> "morgen"
                    else -> "in $days Tagen"
                })
                v.setTextViewText(R.id.n_title, u.e.optString("title"))
                v.setViewVisibility(R.id.n_lock, if (u.e.optString("vis", "family") != "family") android.view.View.VISIBLE else android.view.View.GONE)
                val leave = u.start.minusMinutes(u.travel.toLong())
                v.setTextViewText(R.id.n_sub, Feed.dateLabel(u.date) + " · " + hm(u.start) + if (u.travel > 0) " · los ${hm(leave)}" else "")
            }
            val open = Intent(ctx, OpenActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (u != null) open.putExtra(OpenActivity.EXTRA_OPEN, "event:${u.e.optString("id")}:${u.date}")
            v.setOnClickPendingIntent(R.id.n_root, PendingIntent.getActivity(ctx, 40, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            return v
        }
    }
}
