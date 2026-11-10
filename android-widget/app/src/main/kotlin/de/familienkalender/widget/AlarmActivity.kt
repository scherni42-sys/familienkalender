package de.familienkalender.widget

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

// Wecker-Bildschirm: erscheint beim Klingeln (auch auf dem Sperrbildschirm) mit einem großen „Aus“-Knopf.
// Auch die Lautstärketasten und der Zurück-Knopf schalten den Wecker aus.
class AlarmActivity : Activity() {
    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_OPEN = "open"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        show(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); show(intent) }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun show(i: Intent) {
        val accent = Color.parseColor("#1D8657")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1B2420"))
            setPadding(dp(24), dp(48), dp(24), dp(48))
        }
        root.addView(TextView(this).apply {
            text = i.getStringExtra(EXTRA_TITLE) ?: "Wecker"
            setTextColor(Color.WHITE); textSize = 30f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = i.getStringExtra(EXTRA_TEXT) ?: ""
            setTextColor(Color.parseColor("#C9D4CE")); textSize = 20f; gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(48))
        })
        root.addView(Button(this).apply {
            text = "Aus"
            textSize = 26f; isAllCaps = false; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply { setColor(accent); cornerRadius = dp(40).toFloat() }
            setOnClickListener { off() }
        }, LinearLayout.LayoutParams(dp(240), dp(80)))
        val open = i.getStringExtra(EXTRA_OPEN)
        if (!open.isNullOrEmpty()) root.addView(Button(this).apply {
            text = "Aus und Termin öffnen"
            textSize = 16f; isAllCaps = false; setTextColor(Color.parseColor("#C9D4CE"))
            background = null
            setOnClickListener {
                off()
                startActivity(Intent(this@AlarmActivity, OpenActivity::class.java).putExtra(OpenActivity.EXTRA_OPEN, open).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })
        setContentView(root)
    }

    private fun off() { AlarmService.stop(this); finish() }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_BACK) { off(); return true }
        return super.onKeyDown(keyCode, event)
    }
}
