package co.pango.pangogo

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Pango GO — thin WebView wrapper around the hosted AR game.
 *
 * The game needs: a secure (HTTPS) origin for the camera, the CAMERA runtime
 * permission forwarded to the WebView, DOM storage (dex/coins/scores), and
 * autoplay without a gesture. Android's WebView keeps the camera far more
 * stable than mobile Safari, so the iOS "blue flash" does not occur here.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingPermission: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        setContentView(web)
        goImmersive()

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true                       // localStorage: Pangodex, coins, scores
            mediaPlaybackRequiresUserGesture = false        // let the camera/audio start
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        web.webViewClient = WebViewClient()                 // keep navigation inside the WebView
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = runOnUiThread {
                val wantsCamera = request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                if (wantsCamera &&
                    checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                ) {
                    pendingPermission = request
                    requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
                } else {
                    request.grant(request.resources)
                }
            }
        }

        web.loadUrl(GAME_URL)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_CAMERA) return
        val req = pendingPermission ?: return
        pendingPermission = null
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            req.grant(req.resources)
        } else {
            req.deny()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goImmersive()
    }

    @Suppress("DEPRECATION")
    private fun goImmersive() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    companion object {
        private const val REQ_CAMERA = 1001

        /** The hosted game. Swap to your own HTTPS domain for production. */
        const val GAME_URL = "https://doringber.github.io/creativity/"
    }
}
