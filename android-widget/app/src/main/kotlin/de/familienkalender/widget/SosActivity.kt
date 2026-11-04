package de.familienkalender.widget

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// Eigener Notruf: großer roter Knopf (3 Sekunden halten), danach Status, Entwarnung, 112.
// Unten: Einrichtung, damit ein SOS der anderen auch hier laut ankommt.
class SosActivity : Activity() {
    private lateinit var big: TextView
    private lateinit var status: TextView
    private lateinit var endBtn: Button
    private lateinit var setup: LinearLayout
    private val h = Handler(Looper.getMainLooper())
    private var holdStart = 0L
    private val rx = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = render() }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun btn(t: String, bg: Int, fg: Int = Color.WHITE, on: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 16f; setTextColor(fg)
        background = GradientDrawable().apply { setColor(bg); cornerRadius = dp(14).toFloat() }
        setPadding(dp(14), dp(12), dp(14), dp(12)); setOnClickListener { on() }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(28), dp(22), dp(28)); gravity = Gravity.CENTER_HORIZONTAL }
        root.addView(TextView(this).apply { text = "SOS an die Familie"; textSize = 22f; setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER })
        root.addView(TextView(this).apply { text = "Alle bekommen einen lauten Alarm und deinen Standort, bis jemand „Ich kümmere mich“ tippt."; textSize = 14f; gravity = Gravity.CENTER; setPadding(0, dp(6), 0, dp(18)) })
        big = TextView(this).apply {
            textSize = 30f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.WHITE); gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#D32F2F")) }
            layoutParams = LinearLayout.LayoutParams(dp(210), dp(210))
            setOnTouchListener { _, e -> hold(e); true }
        }
        root.addView(big)
        status = TextView(this).apply { textSize = 16f; gravity = Gravity.CENTER; setPadding(0, dp(16), 0, 0) }
        root.addView(status)
        endBtn = btn("Entwarnung: Mir geht es gut", Color.parseColor("#2E7D32")) { Sos.stop(this); h.postDelayed({ render() }, 400) }
        root.addView(endBtn)
        root.addView(btn("112 anrufen", Color.parseColor("#455A64")) { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112"))) })
        setup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(24), 0, 0) }
        root.addView(setup)
        setContentView(ScrollView(this).apply { addView(root) })
        Sos.channels(this)
    }

    private fun hold(e: MotionEvent) {
        if (Sos.outgoing(this) != null) return
        when (e.action) {
            MotionEvent.ACTION_DOWN -> { holdStart = System.currentTimeMillis(); tick() }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { holdStart = 0; h.removeCallbacksAndMessages(null); render() }
        }
    }
    private fun tick() {
        if (holdStart == 0L) return
        val left = 3 - ((System.currentTimeMillis() - holdStart) / 1000).toInt()
        if (left <= 0) {
            holdStart = 0
            Sos.start(this); render(); return
        }
        big.text = "$left"
        h.postDelayed({ tick() }, 200)
    }

    private fun render() {
        val out = Sos.outgoing(this)
        val p = Sos.prefs(this)
        if (out == null) {
            big.text = "SOS\nhalten"; big.alpha = 1f
            status.text = if (!Push.available(this)) "Hinweis: Push ist in dieser Version noch nicht eingerichtet." else "3 Sekunden gedrückt halten."
            endBtn.visibility = android.view.View.GONE
        } else {
            big.text = "SOS\naktiv"; big.alpha = 0.85f
            val sent = p.getInt("sosOutSent", -2)
            val ack = p.getString("sosOutAck", "") ?: ""
            status.text = when {
                out.startsWith("Fehler") -> out
                out == "…" -> "Wird gesendet …"
                ack.isNotEmpty() -> "✓ $ack kümmert sich.\nDein Standort wird weiter geteilt."
                sent == -1 -> "Gespeichert, aber der Alarm ging nicht raus. Bitte zusätzlich anrufen."
                sent == 0 -> "Gesendet, aber kein Handy der Familie ist für Alarme angemeldet. Bitte anrufen."
                else -> "Alarm an $sent Handy${if (sent == 1) "" else "s"} gesendet. Warte auf Antwort …"
            }
            endBtn.visibility = android.view.View.VISIBLE
        }
        renderSetup()
    }

    // Einrichtung: was fehlt, damit der Alarm durchkommt
    private fun renderSetup() {
        setup.removeAllViews()
        val todo = ArrayList<Pair<String, () -> Unit>>()
        if (!Sos.canNotify(this)) todo += "Benachrichtigungen erlauben" to { if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            todo += "Standort erlauben (für dein eigenes SOS)" to { requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 2) }
        if (!Sos.canFullScreen(this)) todo += "Alarm im Vollbild erlauben" to {
            try { startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))) } catch (e: Exception) { openAppSettings() }
        }
        if (!Sos.canBypassDnd(this)) todo += "Alarm auch bei „Nicht stören“" to {
            try { startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)) } catch (e: Exception) { openAppSettings() }
        }
        setup.addView(TextView(this).apply {
            textSize = 15f; setTypeface(typeface, Typeface.BOLD)
            text = if (todo.isEmpty()) "✓ Dieses Handy ist bereit für Alarme der Familie." else "Damit ein SOS der Familie hier laut ankommt:"
        })
        for ((t, f) in todo) setup.addView(btn(t, Color.parseColor("#ECEFF1"), Color.parseColor("#263238"), f))
    }
    private fun openAppSettings() = startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))

    override fun onResume() {
        super.onResume()
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, IntentFilter(Sos.CHANGED), Context.RECEIVER_NOT_EXPORTED) else registerReceiver(rx, IntentFilter(Sos.CHANGED))
        render()
        Push.register(applicationContext)
    }
    override fun onPause() { super.onPause(); try { unregisterReceiver(rx) } catch (e: Exception) { } }
    override fun onRequestPermissionsResult(rc: Int, p: Array<out String>, r: IntArray) { super.onRequestPermissionsResult(rc, p, r); render() }
}

// Alarm beim Empfänger: auch über dem Sperrbildschirm
class SosAlarmActivity : Activity() {
    private lateinit var title: TextView
    private lateinit var info: TextView
    private lateinit var ackBtn: Button
    private lateinit var mapBtn: Button
    private lateinit var navBtn: Button
    private val rx = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = render() }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun btn(t: String, bg: Int, on: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 17f; setTextColor(Color.WHITE)
        background = GradientDrawable().apply { setColor(bg); cornerRadius = dp(14).toFloat() }
        setPadding(dp(14), dp(14), dp(14), dp(14)); setOnClickListener { on() }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else @Suppress("DEPRECATION") window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(40), dp(22), dp(28)); setBackgroundColor(Color.parseColor("#B71C1C")) }
        title = TextView(this).apply { textSize = 30f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.WHITE); gravity = Gravity.CENTER }
        info = TextView(this).apply { textSize = 17f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, dp(14), 0, dp(10)) }
        root.addView(title); root.addView(info)
        ackBtn = btn("Ich kümmere mich", Color.parseColor("#2E7D32")) { Sos.ack(this); render() }
        mapBtn = btn("Auf der Karte zeigen", Color.parseColor("#1565C0")) { geo(false) }
        navBtn = btn("Navigation starten", Color.parseColor("#0D47A1")) { geo(true) }
        root.addView(ackBtn); root.addView(mapBtn); root.addView(navBtn)
        root.addView(btn("Anrufen", Color.parseColor("#37474F")) { call() })
        root.addView(btn("Nur Ton aus", Color.parseColor("#5D4037")) { Sos.silence(this) })
        root.addView(btn("Schließen", Color.parseColor("#424242")) { Sos.silence(this); finish() })
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#B71C1C")); addView(root) })
        handle(intent)
    }
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); handle(i) }
    private fun handle(i: Intent?) { if (i?.getBooleanExtra("ack", false) == true) Sos.ack(this); render() }

    private fun render() {
        val o = Sos.incoming(this)
        if (o == null) { title.text = "Kein Notruf aktiv"; info.text = "Entwarnung: Der Notruf ist beendet."; listOf(ackBtn, mapBtn, navBtn).forEach { it.visibility = android.view.View.GONE }; return }
        title.text = "🆘 SOS von ${o.optString("from_name", "jemandem")}"
        val at = o.optString("at").let { try { java.time.OffsetDateTime.parse(it).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalTime().toString().take(5) } catch (e: Exception) { "" } }
        val hasLoc = o.optString("lat").isNotEmpty()
        val acks = o.optJSONArray("acks")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        info.text = buildString {
            if (at.isNotEmpty()) append("Ausgelöst um $at Uhr\n")
            append(if (hasLoc) "Standort bekannt" + (o.optString("acc").takeIf { it.isNotEmpty() }?.let { " (± $it m)" } ?: "") else "Standort kommt noch …")
            if (o.optBoolean("mine")) append("\n\n✓ Du kümmerst dich. Die anderen wissen Bescheid.")
            if (acks.isNotEmpty()) append("\n\n✓ ${acks.joinToString(", ")} kümmert sich.")
        }
        ackBtn.visibility = if (o.optBoolean("mine")) android.view.View.GONE else android.view.View.VISIBLE
        mapBtn.visibility = if (hasLoc) android.view.View.VISIBLE else android.view.View.GONE
        navBtn.visibility = mapBtn.visibility
    }
    private fun geo(nav: Boolean) {
        val o = Sos.incoming(this) ?: return
        val ll = "${o.optString("lat")},${o.optString("lon")}"
        val u = if (nav) Uri.parse("google.navigation:q=$ll") else Uri.parse("geo:$ll?q=$ll(SOS)")
        try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$ll"))) } catch (e2: Exception) { }
        }
    }
    // Telefonnummer des Absenders, falls im Familien-Feed hinterlegt; sonst Wähltastatur
    private fun call() {
        val from = Sos.incoming(this)?.optString("from") ?: ""
        val m = Feed.cached(this)?.optJSONArray("members")
        var tel = ""
        if (m != null) for (i in 0 until m.length()) m.getJSONObject(i).let { if (it.optString("id") == from) tel = it.optString("phone") }
        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + tel.filter { it.isDigit() || it == '+' })))
    }

    override fun onResume() {
        super.onResume()
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, IntentFilter(Sos.CHANGED), Context.RECEIVER_NOT_EXPORTED) else registerReceiver(rx, IntentFilter(Sos.CHANGED))
        render()
    }
    override fun onPause() { super.onPause(); try { unregisterReceiver(rx) } catch (e: Exception) { } }
}
