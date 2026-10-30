package de.familienkalender.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class WidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)
}

// Lädt die Daten (läuft im Hintergrund, Netzwerk ist hier erlaubt) und liefert die Zeilen
private class Factory(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<Row> = emptyList()

    override fun onCreate() {}
    override fun onDestroy() {}

    override fun onDataSetChanged() {
        val (feed, loadErr) = Feed.load(ctx)
        var err = loadErr
        rows = try {
            if (feed != null) Feed.rows(feed) else emptyList()
        } catch (e: Exception) {
            err = "Anzeige-Fehler: ${e.message}"
            emptyList()
        }
        if (err != null) rows = listOf(Row(Kind.NOTE, err)) + rows

        // Zeitstempel im Kopf zeigt, wie aktuell die Anzeige ist
        val at = Feed.loadedAt(ctx)
        val stamp = (if (at > 0) SimpleDateFormat("HH:mm", Locale.GERMAN).format(Date(at)) + " · " else "") + "v${BuildConfig.VERSION_CODE}"
        val mgr = AppWidgetManager.getInstance(ctx)
        val head = RemoteViews(ctx.packageName, R.layout.widget)
        head.setTextViewText(R.id.stamp, stamp)
        head.setTextViewText(R.id.empty, if (err != null && feed == null) err else "Keine Einträge")
        for (id in mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java))) mgr.partiallyUpdateAppWidget(id, head)
    }

    override fun getCount() = rows.size
    override fun getViewTypeCount() = 4
    override fun getItemId(position: Int) = position.toLong()
    override fun hasStableIds() = false
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val r = rows.getOrNull(position) ?: return RemoteViews(ctx.packageName, R.layout.note)
        val v = when (r.kind) {
            Kind.SECTION -> RemoteViews(ctx.packageName, R.layout.section).apply { setTextViewText(R.id.text, r.text) }
            Kind.NOTE -> RemoteViews(ctx.packageName, R.layout.note).apply { setTextViewText(R.id.text, r.text) }
            Kind.REPLY -> RemoteViews(ctx.packageName, R.layout.reply).apply {
                setTextViewText(R.id.who, r.time)
                setTextColor(R.id.who, r.color)
                setTextViewText(R.id.text, r.text)
                setOnClickFillInIntent(R.id.row, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
            else -> RemoteViews(ctx.packageName, R.layout.row).apply {
                setTextViewText(R.id.text, r.text)
                setTextViewText(R.id.sub, r.sub)
                setInt(R.id.bar, "setBackgroundColor", r.color)
                if (r.kind == Kind.EVENT) {
                    setTextViewText(R.id.time, r.time)
                    setViewVisibility(R.id.time, View.VISIBLE)
                } else {
                    setViewVisibility(R.id.time, View.GONE)
                }
                setViewVisibility(R.id.pin, if (r.pinned) View.VISIBLE else View.GONE)
                if (r.faded) {
                    // Vergangene Termine blass: Textfarbe mit Transparenz statt setAlpha (nicht in RemoteViews erlaubt)
                    val faded = (ctx.getColor(R.color.fg) and 0x00FFFFFF) or 0x73000000
                    setTextColor(R.id.text, faded)
                    setTextColor(R.id.time, faded)
                    setInt(R.id.bar, "setBackgroundColor", (r.color and 0x00FFFFFF) or 0x73000000)
                }
                setOnClickFillInIntent(R.id.row, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
        }
        return v
    }
}
