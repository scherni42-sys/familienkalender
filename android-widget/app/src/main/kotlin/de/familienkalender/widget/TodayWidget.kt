package de.familienkalender.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import java.time.LocalDate

// Das Widget: Kopf mit Datum und Aktualisieren-Knopf, darunter die Liste aus WidgetService
class TodayWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, views(ctx, id))
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.list)
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == REFRESH) refreshAll(ctx)
    }

    companion object {
        const val REFRESH = "de.familienkalender.widget.REFRESH"

        fun refreshAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java))
            for (id in ids) mgr.updateAppWidget(id, views(ctx, id))
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.list)
        }

        fun views(ctx: Context, id: Int): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            v.setTextViewText(R.id.date, Feed.dateLabel(LocalDate.now()))

            val svc = Intent(ctx, WidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            v.setRemoteAdapter(R.id.list, svc)
            v.setEmptyView(R.id.list, R.id.empty)

            val refresh = PendingIntent.getBroadcast(
                ctx, 0, Intent(ctx, TodayWidget::class.java).setAction(REFRESH),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            v.setOnClickPendingIntent(R.id.refresh, refresh)

            // Antippen öffnet die Familienkalender-App (oder ohne Code die Einrichtung), immer über OpenActivity
            val open = Intent(ctx, OpenActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setOnClickPendingIntent(R.id.head, PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            return v
        }
    }
}
