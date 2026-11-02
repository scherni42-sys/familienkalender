package de.familienkalender.widget

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

// FamTO komplett in der App: die Web-App läuft hier ohne Browser. Die Web-App bleibt die Grundlage
// (auch für iPhone, PC und Display); diese Hülle ergänzt nur, was auf Android nativ geht.
class AppActivity : Activity() {
    companion object {
        const val EXTRA_OPEN = "open"
        const val EXTRA_MIC = "mic"
        const val DEFAULT_APP = "https://scherni42-sys.github.io/familienkalender/"
        private const val FILES = 7
        private const val SPEECH = 8
        private const val GEO = 9
    }

    private lateinit var web: WebView
    private var upload: ValueCallback<Array<Uri>>? = null
    private var shot: Uri? = null

    // „Foto aufnehmen“ öffnet direkt die Kamera, sonst Galerie/Dateien
    private fun chooser(params: WebChromeClient.FileChooserParams): Intent {
        if (!params.isCaptureEnabled) return params.createIntent()
        val dir = java.io.File(cacheDir, "cam").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = java.io.File(dir, "foto-${System.currentTimeMillis()}.jpg")
        val u = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.files", f)
        shot = u
        return Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, u)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    private fun base(): Uri = Uri.parse(Feed.config(this)?.app?.takeIf { it.isNotEmpty() } ?: DEFAULT_APP)

    private fun target(i: Intent?): String {
        val open = i?.getStringExtra(EXTRA_OPEN)?.takeIf { it.isNotEmpty() }
        val b = base().buildUpon()
        if (open != null) b.appendQueryParameter("open", open)
        i?.getStringExtra(EXTRA_MIC)?.takeIf { it.isNotEmpty() }?.let { b.appendQueryParameter("mic", it) }
        return b.build().toString()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        @Suppress("DEPRECATION") web.settings.setGeolocationEnabled(true)
        web.settings.userAgentString = web.settings.userAgentString + " FamTO-Android/" + BuildConfig.VERSION_CODE
        web.addJavascriptInterface(Bridge(), "FamTO")
        val host = base().host
        web.webViewClient = object : WebViewClient() {
            // Fremde Seiten (Karten, Teams, Fotos) im passenden Programm öffnen, FamTO selbst bleibt hier
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == host && (u.scheme == "https" || u.scheme == "http")) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
                // Navigation gestartet: nach kurzer Zeit die Ankunftszeit vom Standort aus berechnen (die Seite pausiert, solange Maps vorne ist)
                if ((u.host ?: "").contains("google") && u.path?.contains("maps") == true) etaSoon()
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // Foto aufnehmen oder aus der Galerie (Board, Termin vom Foto)
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                upload?.onReceiveValue(null)
                upload = cb
                shot = null
                return try { startActivityForResult(chooser(params), FILES); true } catch (e: Exception) {
                    // Keine Kamera-App: auf die normale Auswahl ausweichen
                    try { shot = null; startActivityForResult(params.createIntent(), FILES); true } catch (e2: Exception) { upload = null; false }
                }
            }
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            // Standort für „Fahrzeit von hier“: Android-Berechtigung einmal erfragen
            override fun onGeolocationPermissionsShowPrompt(origin: String, cb: GeolocationPermissions.Callback) {
                if (Geo.hasFine(this@AppActivity) || checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED) { cb.invoke(origin, true, false); return }
                geoAsk = origin to cb
                requestPermissions(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION), GEO)
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(target(intent))
        askSoon(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val mic = intent.getStringExtra(EXTRA_MIC)
        // App schon offen: Eingabefenster per Ereignis öffnen statt die Seite neu zu laden
        if (mic != null && !intent.hasExtra(EXTRA_OPEN) && web.url != null) {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('famto-mic',{detail:" + org.json.JSONObject.quote(mic) + "}))", null)
            return
        }
        if (intent.hasExtra(EXTRA_OPEN) || mic != null) web.loadUrl(target(intent))
        askSoon(intent)
    }

    // Zaubertaste im Widget: Mikrofon sicher starten, auch wenn die Seite noch lädt
    private fun askSoon(i: Intent?) {
        if (i?.getStringExtra(EXTRA_OPEN) != "ask") return
        val before = listens
        web.postDelayed({ if (listens == before && !pendingListen) startListen() }, 2500)
    }

    private var geoAsk: Pair<String, GeolocationPermissions.Callback>? = null

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(code, perms, res)
        if (code == GEO) { geoAsk?.let { (o, cb) -> cb.invoke(o, res.any { it == android.content.pm.PackageManager.PERMISSION_GRANTED }, false) }; geoAsk = null }
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

    @Deprecated("Activity API")
    override fun onActivityResult(code: Int, result: Int, data: Intent?) {
        if (code == SPEECH) {
            listening = false
            val text = if (result == RESULT_OK) data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: "" else ""
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('famto-speech',{detail:" + org.json.JSONObject.quote(text) + "}))", null)
            return
        }
        if (code == FILES) {
            val cam = shot
            shot = null
            upload?.onReceiveValue(if (cam != null) (if (result == RESULT_OK) arrayOf(cam) else null) else WebChromeClient.FileChooserParams.parseResult(result, data))
            upload = null
            return
        }
        @Suppress("DEPRECATION") super.onActivityResult(code, result, data)
    }

    @Deprecated("Activity API")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onPause() { super.onPause(); resumed = false }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (pendingListen) web.postDelayed({ startListen() }, 300)
        // Nach einer Eingabe in der Schnelleingabe sofort den neuen Stand zeigen
        web.evaluateJavascript("window.dispatchEvent(new Event('famto-resume'))", null)
    }

    private fun etaSoon() {
        val ctx = applicationContext
        Thread {
            try {
                Thread.sleep(8000)
                val prefs = ctx.getSharedPreferences("familien-widget", MODE_PRIVATE)
                val e = prefs.edit(); prefs.all.keys.filter { it.startsWith("etachk:") }.forEach { e.remove(it) }; e.apply()
                Feed.load(ctx).first?.let { Reminders.process(ctx, it) }
                Feed.load(ctx).first?.let { feed -> TodayWidget.refreshData(ctx); NextWidget.updateAll(ctx, feed) }
            } catch (x: Exception) { }
        }.start()
    }

    // Für die Web-App erreichbar als window.FamTO
    inner class Bridge {
        // Persönlicher Widget-Code, damit die App sich ohne Einladung mit dem eigenen Konto verbindet
        @JavascriptInterface fun code(): String = getSharedPreferences("familien-widget", MODE_PRIVATE).getString("code", "") ?: ""
        @JavascriptInterface fun version(): Int = BuildConfig.VERSION_CODE
        // Mikrofon: native Schnelleingabe (Spracherkennung im eingebetteten Browser gibt es nicht)
        @JavascriptInterface fun mic(mode: String) {
            runOnUiThread {
                val i = Intent(this@AppActivity, QuickActivity::class.java)
                if (mode.isNotEmpty()) i.putExtra(QuickActivity.EXTRA_MODE, mode)
                startActivity(i)
            }
        }
        // Spracheingabe im Eingabefenster: Spracherkennung des Handys, Ergebnis kommt als Ereignis „famto-speech“ zurück
        @JavascriptInterface fun listen() { runOnUiThread { startListen() } }
        @JavascriptInterface fun setup() { runOnUiThread { startActivity(Intent(this@AppActivity, SetupActivity::class.java)) } }
    }

    // Spracherkennung starten: nur einmal gleichzeitig und erst, wenn die App wirklich vorne ist
    // (aus dem Widget heraus läuft der Start sonst ins Leere)
    private var listening = false
    private var pendingListen = false
    private var resumed = false
    private var listens = 0
    private fun startListen() {
        if (listening) return
        if (!resumed) { pendingListen = true; return }
        pendingListen = false
        listening = true
        listens++
        run {
            run {
                val i = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
                    .putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Termin oder Nachricht sprechen")
                try { @Suppress("DEPRECATION") startActivityForResult(i, SPEECH) } catch (e: Exception) {
                    listening = false
                    web.evaluateJavascript("window.dispatchEvent(new CustomEvent('famto-speech',{detail:''}))", null)
                    android.widget.Toast.makeText(this@AppActivity, "Keine Spracherkennung auf diesem Handy gefunden", android.widget.Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
