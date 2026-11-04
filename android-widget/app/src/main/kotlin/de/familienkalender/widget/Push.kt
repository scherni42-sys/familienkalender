package de.familienkalender.widget

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// Push-Nachrichten über Firebase: nur wenn die App mit google-services.json gebaut wurde; sonst passiert hier nichts
object Push {
    private const val PREFS = "familien-widget"
    fun available(ctx: Context) = try { FirebaseApp.getApps(ctx).isNotEmpty() || FirebaseApp.initializeApp(ctx) != null } catch (e: Throwable) { false }

    // Dieses Handy beim Server anmelden (einmal am Tag oder wenn sich die Adresse ändert)
    fun register(ctx: Context) {
        if (Feed.config(ctx) == null || !available(ctx)) return
        try { FirebaseMessaging.getInstance().token.addOnSuccessListener { t -> if (!t.isNullOrEmpty()) thread { save(ctx, t, false) } } } catch (e: Throwable) { }
    }
    fun save(ctx: Context, token: String, force: Boolean) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = token + "|" + (Feed.config(ctx)?.token ?: "")
        if (!force && p.getString("fcm", "") == key && System.currentTimeMillis() - p.getLong("fcmAt", 0) < 86_400_000L) return
        val (code, _) = rpc(ctx, "widget_push_register", JSONObject().put("p_fcm", token))
        if (code in 200..299) p.edit().putString("fcm", key).putLong("fcmAt", System.currentTimeMillis()).apply()
    }

    fun rpc(ctx: Context, fn: String, body: JSONObject): Pair<Int, String> {
        val c = Feed.config(ctx) ?: return 0 to "Kein Widget-Code"
        return post("${c.url}/rest/v1/rpc/$fn", c.key, body.put("p_token", c.token))
    }
    // Edge Function „push“: verschickt an die anderen Handys der Familie
    fun send(ctx: Context, body: JSONObject): Pair<Int, String> {
        val c = Feed.config(ctx) ?: return 0 to "Kein Widget-Code"
        return post("${c.url}/functions/v1/push", c.key, body.put("widget_token", c.token))
    }
    fun post(url: String, key: String, body: JSONObject): Pair<Int, String> = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"; conn.connectTimeout = 10000; conn.readTimeout = 20000; conn.doOutput = true
        conn.setRequestProperty("apikey", key); conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = conn.responseCode
        code to ((if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: "")
    } catch (e: Exception) { 0 to (e.message ?: "keine Verbindung") }
}

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { thread { Push.save(applicationContext, token, true) } }
    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        val ctx = applicationContext
        when (d["type"]) {
            "sos" -> Sos.alarm(ctx, d)
            "sos_loc" -> Sos.location(ctx, d)
            "sos_ack" -> Sos.acked(ctx, d)
            "sos_end" -> Sos.ended(ctx, d)
            "chat" -> Reminders.chatPush(ctx, d)
        }
        try { TodayWidget.refreshData(ctx) } catch (e: Exception) { }
    }
}
