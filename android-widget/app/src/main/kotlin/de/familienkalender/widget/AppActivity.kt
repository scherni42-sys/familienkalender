package de.familienkalender.widget

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
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
    }

    private lateinit var web: WebView
    private var upload: ValueCallback<Array<Uri>>? = null

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
        web.settings.userAgentString = web.settings.userAgentString + " FamTO-Android/" + BuildConfig.VERSION_CODE
        web.addJavascriptInterface(Bridge(), "FamTO")
        val host = base().host
        web.webViewClient = object : WebViewClient() {
            // Fremde Seiten (Karten, Teams, Fotos) im passenden Programm öffnen, FamTO selbst bleibt hier
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == host && (u.scheme == "https" || u.scheme == "http")) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // Foto aufnehmen oder aus der Galerie (Board, Termin vom Foto)
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                upload?.onReceiveValue(null)
                upload = cb
                return try { startActivityForResult(params.createIntent(), FILES); true } catch (e: Exception) { upload = null; false }
            }
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(target(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra(EXTRA_OPEN) || intent.hasExtra(EXTRA_MIC)) web.loadUrl(target(intent))
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

    @Deprecated("Activity API")
    override fun onActivityResult(code: Int, result: Int, data: Intent?) {
        if (code == FILES) {
            upload?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data))
            upload = null
            return
        }
        @Suppress("DEPRECATION") super.onActivityResult(code, result, data)
    }

    @Deprecated("Activity API")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        // Nach einer Eingabe in der Schnelleingabe sofort den neuen Stand zeigen
        web.evaluateJavascript("window.dispatchEvent(new Event('famto-resume'))", null)
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
        @JavascriptInterface fun setup() { runOnUiThread { startActivity(Intent(this@AppActivity, SetupActivity::class.java)) } }
    }
}
