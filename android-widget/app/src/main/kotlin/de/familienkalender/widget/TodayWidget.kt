package de.familienkalender.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.widget.RemoteViews
import java.time.LocalDate

// Das Widget: Kopf mit Datum und Aktualisieren-Knopf, darunter die Liste aus WidgetService
class TodayWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, views(ctx, id))
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.list)
        schedule(ctx)
    }

    override fun onDisabled(ctx: Context) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(refreshIntent(ctx))
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        when (intent.action) {
            REFRESH -> refreshAll(ctx)
            // Nach einem App-Update: Alarm neu setzen und das Widget mit dem neuen Code neu aufbauen
            Intent.ACTION_MY_PACKAGE_REPLACED -> { refreshAll(ctx); schedule(ctx) }
        }
    }

    companion object {
        const val REFRESH = "de.familienkalender.widget.REFRESH"

        private fun refreshIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
            ctx, 0, Intent(ctx, TodayWidget::class.java).setAction(REFRESH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Jede Minute neu laden, aber nur solange das Handy wach ist (kein Wecken, schont den Akku)
        fun schedule(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 60_000, 60_000, refreshIntent(ctx))
        }

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
                // Version in der Adresse, damit der Startbildschirm nach einem Update keine alten Zeilen weiterverwendet
                putExtra("v", BuildConfig.VERSION_CODE)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            v.setRemoteAdapter(R.id.list, svc)
            v.setEmptyView(R.id.list, R.id.empty)

            v.setOnClickPendingIntent(R.id.refresh, refreshIntent(ctx))

            // Die ganze Kopfzeile aktualisiert (der Knopf allein ist schwer zu treffen); Einträge öffnen die App
            v.setOnClickPendingIntent(R.id.head, refreshIntent(ctx))
            val open = Intent(ctx, OpenActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            return v
        }
    }
}
