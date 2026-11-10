package de.familienkalender.widget

// Nach Neustart des Handys oder einem App-Update sind gestellte Wecker gelöscht (so macht es Android).
// Hier werden sie sofort aus dem gespeicherten Stand neu gestellt, auch ohne Internet.
object Alarms {
    fun restore(ctx: android.content.Context) {
        val feed = Feed.cached(ctx)
        try { EvAlarm.schedule(ctx, feed) } catch (e: Exception) { }
        try { feed?.let { BdAlarm.schedule(ctx, it) } } catch (e: Exception) { }
    }
}
