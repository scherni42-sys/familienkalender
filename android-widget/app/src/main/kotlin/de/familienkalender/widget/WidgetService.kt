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
        val (feed, loadErr) = Feed.load(ctx, 20_000)
        var err = loadErr
        rows = try {
            if (feed == null) emptyList() else if (Feed.bdMode(ctx)) Feed.bdRows(ctx, feed) else Feed.rows(feed, if (Feed.weekMode(ctx)) Feed.weekOff(ctx) else null, Flights.lines(ctx, feed), Feed.boardMode(ctx), Feed.chatMode(ctx))
        } catch (e: Throwable) {
            err = "Anzeige-Fehler: ${e.message}"
            emptyList()
        }
        if (err != null) rows = listOf(Row(Kind.NOTE, err)) + rows

        // Im Aktualisieren-Knopf steht klein die Versionsnummer
        val stamp = "${BuildConfig.VERSION_CODE}"
        val mgr = AppWidgetManager.getInstance(ctx)
        val head = RemoteViews(ctx.packageName, R.layout.widget)
        head.setTextViewText(R.id.stamp, stamp)
        // Blättern nur in der Geburtstagsliste und nur bei mehr als einer Seite
        val bd = Feed.bdMode(ctx) && Feed.bdPages(ctx) > 1
        head.setViewVisibility(R.id.bdnav, if (bd) View.VISIBLE else View.GONE)
        head.setTextViewText(R.id.bdpage, "${Feed.bdPage(ctx) + 1} / ${Feed.bdPages(ctx)}")
        TodayWidget.weekBar(ctx, head)
        head.setTextViewText(R.id.empty, if (err != null && feed == null) err else "Keine Einträge")
        for (id in mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java))) mgr.partiallyUpdateAppWidget(id, head)
    }

    override fun getCount() = rows.size
    override fun getViewTypeCount(): Int = 7
    override fun getItemId(position: Int) = position.toLong()
    override fun hasStableIds() = false
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val r = rows.getOrNull(position) ?: return RemoteViews(ctx.packageName, R.layout.note)
        val v = when (r.kind) {
            // Tag-Überschrift und „frei“ öffnen in der Wochenvorschau einen neuen Termin an diesem Tag
            // Board-Überschrift als Knopf wie KW: antippen macht das Board groß (grün) bzw. wieder klein
            Kind.SECTION -> if (r.toggle != null) RemoteViews(ctx.packageName, R.layout.section_pill).apply {
                setTextViewText(R.id.text, r.text)
                setInt(R.id.text, "setBackgroundResource", if (r.toggle) R.drawable.bar_on else R.drawable.kw_off)
                setOnClickFillInIntent(R.id.text, Intent().putExtra(OpenActivity.EXTRA_ACT, r.open.removePrefix("toggle:")))
            } else RemoteViews(ctx.packageName, R.layout.section).apply {
                setTextViewText(R.id.text, r.text)
                if (r.open.isNotEmpty()) setOnClickFillInIntent(R.id.row, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
            Kind.NOTE -> RemoteViews(ctx.packageName, R.layout.note).apply {
                setTextViewText(R.id.text, r.text)
                if (r.open.isNotEmpty()) setOnClickFillInIntent(R.id.text, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
            // 👍 und erledigt: über OpenActivity an den Widget-Empfänger, die App bleibt zu.
            // Antworten: öffnet die Nachricht in der App mit dem Feld für eine Kurzantwort
            Kind.ACTIONS -> RemoteViews(ctx.packageName, R.layout.actions).apply {
                for ((id, act) in listOf(R.id.a_like to "like", R.id.a_done to "done"))
                    setOnClickFillInIntent(id, Intent().putExtra(OpenActivity.EXTRA_ACT, act).putExtra(OpenActivity.EXTRA_MSG, r.msg))
                setOnClickFillInIntent(R.id.a_take, Intent().putExtra(OpenActivity.EXTRA_OPEN, "msg:${r.msg}:reply"))
            }
            Kind.PHOTO -> RemoteViews(ctx.packageName, R.layout.photo).apply {
                val bmp = Photos.thumb(ctx, r.text)
                if (bmp != null) setImageViewBitmap(R.id.img, bmp) else setImageViewResource(R.id.img, R.drawable.btn_photo)
                setOnClickFillInIntent(R.id.row, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
            Kind.REPLY -> RemoteViews(ctx.packageName, R.layout.reply).apply {
                setTextViewText(R.id.who, r.time)
                setTextColor(R.id.who, r.color)
                setTextViewText(R.id.text, r.text)
                setOnClickFillInIntent(R.id.row, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
            else -> RemoteViews(ctx.packageName, R.layout.row).apply {
                // Privat: Schloss-Emoji als grünes Symbol vor dem Titel
                val priv = r.text.contains("🔒 ")
                setTextViewText(R.id.text, if (priv) r.text.replace("🔒 ", "") else r.text)
                setViewVisibility(R.id.lock, if (priv) View.VISIBLE else View.GONE)
                setTextViewText(R.id.sub, r.sub)
                setTextViewText(R.id.drive, r.drive)
                setViewVisibility(R.id.drive, if (r.drive.isNotEmpty()) View.VISIBLE else View.GONE)
                setInt(R.id.bar, "setBackgroundColor", r.color)
                if (r.kind == Kind.EVENT) {
                    setTextViewText(R.id.time, r.time)
                    setViewVisibility(R.id.time, View.VISIBLE)
                } else {
                    setViewVisibility(R.id.time, View.GONE)
                }
                setViewVisibility(R.id.pin, if (r.pinned) View.VISIBLE else View.GONE)
                // Avatar nur bei Board-Nachrichten
                val av = if (r.kind == Kind.MESSAGE && r.avatar.isNotEmpty()) Photos.avatar(ctx, r.avatar, r.color) else null
                if (av != null) setImageViewBitmap(R.id.av, av)
                setViewVisibility(R.id.av, if (av != null) View.VISIBLE else View.GONE)
                if (r.faded) {
                    // Vergangene Termine blass: Textfarbe mit Transparenz statt setAlpha (nicht in RemoteViews erlaubt)
                    val faded = (ctx.getColor(R.color.fg) and 0x00FFFFFF) or 0x73000000
                    setTextColor(R.id.text, faded)
                    setTextColor(R.id.time, faded)
                    setTextColor(R.id.drive, faded)
                    setInt(R.id.bar, "setBackgroundColor", (r.color and 0x00FFFFFF) or 0x73000000)
                } else {
                    // Zeilen werden wiederverwendet: normale Farben ausdrücklich zurücksetzen, sonst bleibt eine Zeile blass
                    setTextColor(R.id.text, ctx.getColor(R.color.fg))
                    setTextColor(R.id.time, ctx.getColor(R.color.fg))
                    setTextColor(R.id.drive, ctx.getColor(R.color.muted))
                }
                setOnClickFillInIntent(R.id.row, Intent().putExtra(OpenActivity.EXTRA_OPEN, r.open))
            }
        }
        return v
    }
}
