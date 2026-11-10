package de.familienkalender.widget

import android.content.Context
import android.widget.RemoteViews

// Deckkraft des Widget-Hintergrunds (0 = ganz durchsichtig, 100 = voll deckend), in 5er-Schritten
object Look {
    private const val KEY = "bgalpha"
    const val DEFAULT = 95

    private val drawables = intArrayOf(
        R.drawable.bg_0, R.drawable.bg_5, R.drawable.bg_10, R.drawable.bg_15, R.drawable.bg_20,
        R.drawable.bg_25, R.drawable.bg_30, R.drawable.bg_35, R.drawable.bg_40, R.drawable.bg_45,
        R.drawable.bg_50, R.drawable.bg_55, R.drawable.bg_60, R.drawable.bg_65, R.drawable.bg_70,
        R.drawable.bg_75, R.drawable.bg_80, R.drawable.bg_85, R.drawable.bg_90, R.drawable.bg_95,
        R.drawable.bg_100,
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("familien-widget", Context.MODE_PRIVATE)

    fun alpha(ctx: Context): Int = prefs(ctx).getInt(KEY, DEFAULT).coerceIn(0, 100)

    fun setAlpha(ctx: Context, percent: Int) {
        prefs(ctx).edit().putInt(KEY, (percent.coerceIn(0, 100) / 5) * 5).apply()
    }

    // Hintergrund auf die Wurzel des Widgets legen
    fun applyBg(ctx: Context, v: RemoteViews, rootId: Int) {
        v.setInt(rootId, "setBackgroundResource", drawables[alpha(ctx) / 5])
    }
}
