package de.familienkalender.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.Toast
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import kotlin.concurrent.thread

// Das Widget: Kopf mit Datum und Aktualisieren-Knopf, darunter die Liste aus WidgetService
class TodayWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, views(ctx, id))
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.list)
        schedule(ctx)
    }

    override fun onDisabled(ctx: Context) = unscheduleIfUnused(ctx)

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        when (intent.action) {
            REFRESH, Reminders.REMIND -> { refreshData(ctx); background(ctx) }
            // Sicherheits-Hinweis bestätigt: Fahrzeit vom Standort für die Abfahrts-Erinnerung übernehmen
            // Geburtstags-Wecker klingelt bzw. wird ausgeschaltet
            BdAlarm.FIRE -> BdAlarm.fire(ctx, intent.getStringExtra("names") ?: "")
            BdAlarm.OFF -> BdAlarm.off(ctx)
            Reminders.AWAY_OK -> {
                val key = intent.getStringExtra("key") ?: return
                Away.setOverride(ctx, key, intent.getIntExtra("min", 0))
                (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancel(intent.getIntExtra("nid", 0))
                Toast.makeText(ctx, "Übernommen: ${intent.getIntExtra("min", 0)} Min. Fahrt", Toast.LENGTH_SHORT).show()
                background(ctx)
            }
            // Fahrer-Anfrage beantwortet: „Okay“ oder „Kann nicht“
            Reminders.ANSWER -> {
                val event = intent.getStringExtra("event") ?: return
                val ok = intent.getBooleanExtra("ok", true)
                (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancel(intent.getIntExtra("nid", 0))
                val done = goAsync()
                thread {
                    try {
                        val err = Feed.answer(ctx, event, ok)
                        Handler(Looper.getMainLooper()).post {
                            Toast.makeText(ctx, err ?: if (ok) "Danke, die Familie weiß Bescheid." else "Abgesagt. Wer dich eingetragen hat, bekommt Bescheid.", Toast.LENGTH_LONG).show()
                        }
                        Feed.load(ctx).first?.let { Reminders.process(ctx, it); NextWidget.updateAll(ctx, it) }
                        refreshData(ctx)
                    } finally { done.finish() }
                }
            }
            // Board-Knopf aus dem Widget: ausführen, kurz melden, neu laden
            ACT -> {
                val act = intent.getStringExtra(OpenActivity.EXTRA_ACT) ?: return
                val msg = intent.getStringExtra(OpenActivity.EXTRA_MSG) ?: return
                val done = goAsync()
                thread {
                    try {
                        val err = Feed.act(ctx, act, msg)
                        Handler(Looper.getMainLooper()).post {
                            Toast.makeText(ctx, err ?: when (act) { "like" -> "👍 gesendet"; "take" -> "Du übernimmst das"; else -> "Erledigt" }, Toast.LENGTH_SHORT).show()
                        }
                        Feed.load(ctx).first?.let { Reminders.process(ctx, it); NextWidget.updateAll(ctx, it); CalSync.sync(ctx, it) }
                        refreshData(ctx)
                    } finally { done.finish() }
                }
            }
            TOGGLE_BD -> { Feed.toggleBd(ctx); refreshData(ctx) }
            BD_PREV -> { Feed.turnBdPage(ctx, -1); refreshData(ctx) }
            BD_NEXT -> { Feed.turnBdPage(ctx, 1); refreshData(ctx) }
            TOGGLE_WEEK -> { Feed.toggleWeek(ctx); refreshData(ctx) }
            TOGGLE_HOME -> { Feed.toggleHome(ctx); refreshData(ctx); background(ctx) }
            WEEK_PREV -> { Feed.turnWeek(ctx, -1); refreshData(ctx) }
            WEEK_NEXT -> { Feed.turnWeek(ctx, 1); refreshData(ctx) }
            // Nach einem App-Update: Alarm neu setzen und das Widget mit dem neuen Code neu aufbauen
            Intent.ACTION_MY_PACKAGE_REPLACED -> { refreshAll(ctx); schedule(ctx); background(ctx); Geo.register(ctx) }
        }
    }

    companion object {
        const val REFRESH = "de.familienkalender.widget.REFRESH"
        const val ACT = "de.familienkalender.widget.ACT"
        const val TOGGLE_BD = "de.familienkalender.widget.TOGGLE_BD"
        const val BD_PREV = "de.familienkalender.widget.BD_PREV"
        const val BD_NEXT = "de.familienkalender.widget.BD_NEXT"
        const val TOGGLE_WEEK = "de.familienkalender.widget.TOGGLE_WEEK"
        const val TOGGLE_HOME = "de.familienkalender.widget.TOGGLE_HOME"
        const val WEEK_PREV = "de.familienkalender.widget.WEEK_PREV"
        const val WEEK_NEXT = "de.familienkalender.widget.WEEK_NEXT"

        private fun broadcast(ctx: Context, action: String, code: Int): PendingIntent = PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, TodayWidget::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Wochenvorschau-Knopf: aus = „KW“, an = grün „KW 45“ mit großen Pfeilen links und rechts
        fun weekBar(ctx: Context, v: RemoteViews) {
            val on = Feed.weekMode(ctx)
            v.setTextViewText(R.id.weeklabel, if (on) "KW ${Feed.weekNumber(ctx)}" else "KW")
            v.setInt(R.id.weeklabel, "setBackgroundResource", if (on) R.drawable.bar_on else R.drawable.kw_off)
            v.setTextColor(R.id.weeklabel, 0xFFFFFFFF.toInt())
            val year = if (on) Feed.weekYear(ctx) else null
            v.setTextViewText(R.id.weekyear, year?.toString() ?: "")
            v.setViewVisibility(R.id.weekyear, if (year != null) View.VISIBLE else View.GONE)
            v.setViewVisibility(R.id.weekprev, if (on && Feed.weekOff(ctx) > 0) View.VISIBLE else View.INVISIBLE)
            v.setViewVisibility(R.id.weeknext, if (on && Feed.weekOff(ctx) < Feed.MAX_WEEKS) View.VISIBLE else View.INVISIBLE)
        }

        private fun refreshIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
            ctx, 0, Intent(ctx, TodayWidget::class.java).setAction(REFRESH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Im Hintergrund laden: Erinnerungen prüfen, Mini-Widgets und Handy-Kalender aktualisieren (die Liste lädt selbst)
        private fun background(ctx: Context) {
            thread {
                Feed.load(ctx, 20_000).first?.let { Reminders.process(ctx, it); NextWidget.updateAll(ctx, it); CalSync.sync(ctx, it) }
                try { CalImport.maybeSync(ctx) } catch (e: Exception) { }
            }
        }

        // Minuten-Alarm nur abstellen, wenn kein Widget dieser App mehr liegt
        fun unscheduleIfUnused(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val any = mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java)).isNotEmpty() ||
                mgr.getAppWidgetIds(ComponentName(ctx, NextWidget::class.java)).isNotEmpty()
            if (!any) (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(refreshIntent(ctx))
        }

        // Jede Minute neu laden, aber nur solange das Handy wach ist (kein Wecken, schont den Akku)
        fun schedule(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 60_000, 60_000, refreshIntent(ctx))
        }

        // Nur Datum und Liste neu laden, ohne das Widget neu aufzubauen; sonst ist es kurz ohne Tipp-Belegung
        // und der Startbildschirm öffnet bei schnellem Mehrfachtippen die App
        fun refreshData(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java))
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            v.setTextViewText(R.id.date, Feed.headLabel(ctx, LocalDate.now()))
            bdButton(ctx, v)
            weekBar(ctx, v)
            homeButton(ctx, v)
            for (id in ids) mgr.partiallyUpdateAppWidget(id, v)
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.list)
        }

        // Gedrückte Torte hell hinterlegt, damit man sieht, dass die Geburtstage gezeigt werden
        private fun bdButton(ctx: Context, v: RemoteViews) =
            v.setImageViewResource(R.id.q_bdring, if (Feed.bdMode(ctx)) R.drawable.ring_bd_on else R.drawable.ring_bd)

        // Home-Knopf nur zeigen, wenn berufliche Kalender übernommen werden; eingeschaltet grün hinterlegt
        private fun homeButton(ctx: Context, v: RemoteViews) {
            v.setViewVisibility(R.id.home, if (CalImport.hasWork(ctx) || Feed.homeMode(ctx) || Geo.enabled(ctx)) android.view.View.VISIBLE else android.view.View.GONE)
            v.setImageViewResource(R.id.home, if (Feed.homeMode(ctx)) R.drawable.ring_home_on else R.drawable.ring_home_off)
        }

        fun refreshAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java))
            for (id in ids) mgr.updateAppWidget(id, views(ctx, id))
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.list)
        }

        fun views(ctx: Context, id: Int): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            v.setTextViewText(R.id.date, Feed.headLabel(ctx, LocalDate.now()))

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
            v.setOnClickPendingIntent(R.id.root, refreshIntent(ctx))
            // ＋: Schnelleingabe (Sprechen, Tippen, Foto; Privat/Familie/Board wählt man dort)
            val add = Intent(ctx, MicActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setOnClickPendingIntent(R.id.q_add, PendingIntent.getActivity(ctx, 10, add, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            // Torte: schaltet die Liste auf Geburtstage um und wieder zurück
            val bd = Intent(ctx, TodayWidget::class.java).setAction(TOGGLE_BD)
            v.setOnClickPendingIntent(R.id.q_bdays, PendingIntent.getBroadcast(ctx, 21, bd, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            bdButton(ctx, v)
            v.setOnClickPendingIntent(R.id.weeklabel, broadcast(ctx, TOGGLE_WEEK, 24))
            v.setOnClickPendingIntent(R.id.home, broadcast(ctx, TOGGLE_HOME, 27))
            // Zaubertaste: App mit „Frag Claude“ öffnen
            val ask = Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, "ask").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setOnClickPendingIntent(R.id.ask, PendingIntent.getActivity(ctx, 29, ask, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            // Zahnrad: App direkt in den Einstellungen öffnen
            val gear = Intent(ctx, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, "settings").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setOnClickPendingIntent(R.id.settings, PendingIntent.getActivity(ctx, 28, gear, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            homeButton(ctx, v)
            v.setOnClickPendingIntent(R.id.weekprev, broadcast(ctx, WEEK_PREV, 25))
            v.setOnClickPendingIntent(R.id.weeknext, broadcast(ctx, WEEK_NEXT, 26))
            weekBar(ctx, v)
            v.setOnClickPendingIntent(R.id.bdprev, PendingIntent.getBroadcast(ctx, 22, Intent(ctx, TodayWidget::class.java).setAction(BD_PREV), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            v.setOnClickPendingIntent(R.id.bdnext, PendingIntent.getBroadcast(ctx, 23, Intent(ctx, TodayWidget::class.java).setAction(BD_NEXT), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            val open = Intent(ctx, OpenActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            return v
        }
    }
}
