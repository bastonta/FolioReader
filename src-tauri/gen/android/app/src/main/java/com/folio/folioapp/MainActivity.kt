package com.folio.folioapp

import android.Manifest
import android.app.SearchManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File

class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = false
  private var disableSystemActionMode = false
  private var isShowingExplicitActionMode = false
  private var currentExplicitActionMode: ActionMode? = null
  private var mainWebView: WebView? = null

  private val folderPickerLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) { result ->
    if (result.resultCode == RESULT_OK) {
      val uri = result.data?.data ?: return@registerForActivityResult
      val takeFlags = (result.data?.flags ?: 0) and
        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      try {
        contentResolver.takePersistableUriPermission(uri, takeFlags)
      } catch (_: Exception) {}

      val path = getPathFromTreeUri(uri)
      if (path != null) {
        val escapedPath = path.replace("\\", "\\\\").replace("'", "\\'")
        mainWebView?.post {
          mainWebView?.evaluateJavascript(
            "if (typeof window.onAndroidFolderSelected === 'function') { window.onAndroidFolderSelected('$escapedPath'); }",
            null
          )
        }
      }
    }
  }

  companion object {
    private const val STORAGE_PERMISSION_REQUEST_CODE = 9902
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Ensure status bar icons are dark by default (for light theme background)
    val insetsController = WindowCompat.getInsetsController(window, window.decorView)
    insetsController.isAppearanceLightStatusBars = true
    insetsController.isAppearanceLightNavigationBars = true

    // Intercept hardware/gesture Back button and forward to web application
    val backPressedCallback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (currentExplicitActionMode != null) {
          currentExplicitActionMode?.finish()
          currentExplicitActionMode = null
          isShowingExplicitActionMode = false
          return
        }

        val webView = mainWebView
        if (webView != null) {
          webView.evaluateJavascript(
            "if (typeof window.handleAndroidBack === 'function') { window.handleAndroidBack(); } else { false; }",
            ValueCallback { result ->
              val isHandled = result == "true"
              if (!isHandled) {
                runOnUiThread {
                  if (!moveTaskToBack(true)) {
                    finish()
                  }
                }
              }
            }
          )
        } else {
          runOnUiThread {
            if (!moveTaskToBack(true)) {
              finish()
            }
          }
        }
      }
    }
    onBackPressedDispatcher.addCallback(this, backPressedCallback)
  }

  private fun wrapActionModeCallback(callback: ActionMode.Callback?): ActionMode.Callback? {
    if (callback == null) return null
    return object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
        if (disableSystemActionMode && !isShowingExplicitActionMode) {
          return false
        }
        return callback.onCreateActionMode(mode, menu)
      }

      override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
        if (disableSystemActionMode && !isShowingExplicitActionMode) {
          return false
        }
        return callback.onPrepareActionMode(mode, menu)
      }

      override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
        return callback.onActionItemClicked(mode, item)
      }

      override fun onDestroyActionMode(mode: ActionMode?) {
        if (mode == currentExplicitActionMode) {
          currentExplicitActionMode = null
          isShowingExplicitActionMode = false
        }
        callback.onDestroyActionMode(mode)
      }

      override fun onGetContentRect(
        mode: ActionMode?,
        view: View?,
        outRect: Rect?
      ) {
        if (callback is ActionMode.Callback2) {
          callback.onGetContentRect(mode, view, outRect)
        } else {
          super.onGetContentRect(mode, view, outRect)
        }
      }
    }
  }

  override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? {
    val wrapped = wrapActionModeCallback(callback)
    return super.onWindowStartingActionMode(wrapped)
  }

  override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
    val wrapped = wrapActionModeCallback(callback)
    return super.onWindowStartingActionMode(wrapped, type)
  }

  override fun onActionModeStarted(mode: ActionMode?) {
    if (disableSystemActionMode && !isShowingExplicitActionMode) {
      mode?.finish()
    }
    super.onActionModeStarted(mode)
  }

  override fun onActionModeFinished(mode: ActionMode?) {
    if (mode == currentExplicitActionMode) {
      currentExplicitActionMode = null
      isShowingExplicitActionMode = false
    }
    super.onActionModeFinished(mode)
  }

  override fun onWebViewCreate(webView: WebView) {
    mainWebView = webView
    super.onWebViewCreate(webView)

    // Propagate system bar insets (status bar, navigation bar) directly to CSS variables
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val density = resources.displayMetrics.density
      val topDp = (systemBars.top / density).toInt()
      val bottomDp = (systemBars.bottom / density).toInt()
      val leftDp = (systemBars.left / density).toInt()
      val rightDp = (systemBars.right / density).toInt()

      webView.post {
        webView.evaluateJavascript(
          """
          document.documentElement.style.setProperty('--safe-area-top', '${topDp}px');
          document.documentElement.style.setProperty('--safe-area-bottom', '${bottomDp}px');
          document.documentElement.style.setProperty('--safe-area-left', '${leftDp}px');
          document.documentElement.style.setProperty('--safe-area-right', '${rightDp}px');
          """.trimIndent(),
          null
        )
      }
      insets
    }

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun setDisableSystemActionMode(disable: Boolean) {
        runOnUiThread {
          disableSystemActionMode = disable
        }
      }

      @JavascriptInterface
      fun showOriginalContextMenu(text: String, xDp: Float, yDp: Float, widthDp: Float, heightDp: Float) {
        runOnUiThread {
          try {
            // Dismiss existing explicit action mode if any
            currentExplicitActionMode?.finish()

            val density = resources.displayMetrics.density
            val left = (xDp * density).toInt()
            val top = (yDp * density).toInt()
            val right = ((xDp + widthDp) * density).toInt()
            val bottom = ((yDp + heightDp) * density).toInt()

            val intent = Intent(Intent.ACTION_PROCESS_TEXT).setType("text/plain")
            val pm = packageManager
            val activities = pm.queryIntentActivities(intent, 0)

            isShowingExplicitActionMode = true

            val callback = object : ActionMode.Callback2() {
              override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                mode?.title = null
                if (menu == null) return false

                menu.add(Menu.NONE, 1, 1, android.R.string.copy)?.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                menu.add(Menu.NONE, 2, 2, "Share")?.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                menu.add(Menu.NONE, 3, 3, "Web search")?.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)

                for ((idx, info) in activities.withIndex()) {
                  menu.add(Menu.NONE, 100 + idx, 10 + idx, info.loadLabel(pm))
                    ?.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
                }
                return true
              }

              override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean = true

              override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
                when (item?.itemId) {
                  1 -> {
                    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("text", text))
                    mode?.finish()
                    return true
                  }
                  2 -> {
                    val sendIntent = Intent(Intent.ACTION_SEND).apply {
                      type = "text/plain"
                      putExtra(Intent.EXTRA_TEXT, text)
                    }
                    startActivity(Intent.createChooser(sendIntent, null))
                    mode?.finish()
                    return true
                  }
                  3 -> {
                    val searchIntent = Intent(Intent.ACTION_WEB_SEARCH).apply {
                      putExtra(SearchManager.QUERY, text)
                    }
                    try {
                      startActivity(searchIntent)
                    } catch (e: Exception) {
                      val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(text)))
                      startActivity(browserIntent)
                    }
                    mode?.finish()
                    return true
                  }
                  else -> {
                    val idx = (item?.itemId ?: 0) - 100
                    if (idx >= 0 && idx < activities.size) {
                      val info = activities[idx]
                      val processIntent = Intent(Intent.ACTION_PROCESS_TEXT).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
                        putExtra(Intent.EXTRA_PROCESS_TEXT, text)
                        setClassName(info.activityInfo.packageName, info.activityInfo.name)
                      }
                      try {
                        startActivity(processIntent)
                      } catch (e: Exception) {
                        e.printStackTrace()
                      }
                      mode?.finish()
                      return true
                    }
                  }
                }
                return false
              }

              override fun onDestroyActionMode(mode: ActionMode?) {
                if (mode == currentExplicitActionMode) {
                  currentExplicitActionMode = null
                  isShowingExplicitActionMode = false
                }
              }

              override fun onGetContentRect(mode: ActionMode?, view: View?, outRect: Rect?) {
                outRect?.set(left, top, right, bottom)
              }
            }

            val actionMode = startActionMode(callback, ActionMode.TYPE_FLOATING)
            currentExplicitActionMode = actionMode
            if (actionMode == null) {
              isShowingExplicitActionMode = false
            }
          } catch (e: Exception) {
            isShowingExplicitActionMode = false
            currentExplicitActionMode = null
            e.printStackTrace()
          }
        }
      }

      @JavascriptInterface
      fun dismissOriginalContextMenu() {
        runOnUiThread {
          currentExplicitActionMode?.finish()
          currentExplicitActionMode = null
          isShowingExplicitActionMode = false
        }
      }

      @JavascriptInterface
      fun setStatusBarVisible(visible: Boolean) {
        runOnUiThread {
          val insetsController = WindowCompat.getInsetsController(window, window.decorView)
          insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          if (visible) {
            insetsController.show(WindowInsetsCompat.Type.statusBars())
          } else {
            insetsController.hide(WindowInsetsCompat.Type.statusBars())
          }
        }
      }

      @JavascriptInterface
      fun setStatusBarIconsDark(darkIcons: Boolean) {
        runOnUiThread {
          val insetsController = WindowCompat.getInsetsController(window, window.decorView)
          insetsController.isAppearanceLightStatusBars = darkIcons
          insetsController.isAppearanceLightNavigationBars = darkIcons
        }
      }

      @JavascriptInterface
      fun setStatusBarTheme(theme: String) {
        runOnUiThread {
          val insetsController = WindowCompat.getInsetsController(window, window.decorView)
          val isDarkIcons = when (theme.lowercase()) {
            "dark", "gray", "black" -> false
            else -> true
          }
          insetsController.isAppearanceLightStatusBars = isDarkIcons
          insetsController.isAppearanceLightNavigationBars = isDarkIcons
        }
      }

      @JavascriptInterface
      fun hasStoragePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          Environment.isExternalStorageManager()
        } else {
          ContextCompat.checkSelfPermission(
            this@MainActivity,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
          ) == PackageManager.PERMISSION_GRANTED
        }
      }

      @JavascriptInterface
      fun requestStoragePermission() {
        runOnUiThread {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
              try {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                  data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
              } catch (e: Exception) {
                val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                startActivity(intent)
              }
            }
          } else {
            ActivityCompat.requestPermissions(
              this@MainActivity,
              arrayOf(
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
              ),
              STORAGE_PERMISSION_REQUEST_CODE
            )
          }
        }
      }

      @JavascriptInterface
      fun openFolderPicker() {
        runOnUiThread {
          try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
              addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
              )
            }
            folderPickerLauncher.launch(intent)
          } catch (e: Exception) {
            e.printStackTrace()
          }
        }
      }

      @JavascriptInterface
      fun getDefaultDownloadDir(): String {
        return try {
          val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
          val folioDir = File(downloadsDir, "FolioBooks")
          if (!folioDir.exists()) {
            folioDir.mkdirs()
          }
          folioDir.absolutePath
        } catch (e: Exception) {
          "/storage/emulated/0/Download/FolioBooks"
        }
      }

      @JavascriptInterface
      fun minimizeApp() {
        runOnUiThread {
          moveTaskToBack(true)
        }
      }

      @JavascriptInterface
      fun exitApp() {
        runOnUiThread {
          finish()
        }
      }
    }, "AndroidBridge")
  }

  private fun getPathFromTreeUri(uri: Uri): String? {
    val docId = try {
      DocumentsContract.getTreeDocumentId(uri)
    } catch (_: Exception) {
      uri.lastPathSegment
    } ?: return null

    val split = docId.split(":")
    if (split.isEmpty()) return null
    val type = split[0]
    val relativePath = if (split.size > 1) split[1] else ""

    return if ("primary".equals(type, ignoreCase = true)) {
      val extDir = Environment.getExternalStorageDirectory()?.absolutePath ?: "/storage/emulated/0"
      if (relativePath.isNotEmpty()) {
        "$extDir/$relativePath"
      } else {
        extDir
      }
    } else {
      if (relativePath.isNotEmpty()) {
        "/storage/$type/$relativePath"
      } else {
        "/storage/$type"
      }
    }
  }
}
