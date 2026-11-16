package expo.modules.appnightmode

import android.app.UiModeManager
import android.content.Context
import android.graphics.Color
import android.os.Build
import androidx.core.view.WindowCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hands the app's theme to Android itself.
 *
 * React Native's `Appearance.setColorScheme` sets AppCompat's night mode, which
 * lives only as long as the process: the next cold start draws the native splash
 * and the system bars in the phone's scheme. `UiModeManager.setApplicationNightMode`
 * (API 31) is stored by the system per app and applied before the first frame, so
 * the splash, the navigation bar and the window background follow the choice.
 *
 * The bars of a window already open were styled when it was created, so
 * `setSystemBarsDark` restyles them for the scheme the app is drawing now: the
 * status bar's icons and the navigation bar's buttons, which on Android 10+ also
 * pick the contrast scrim drawn behind three-button navigation. Below Android 10
 * React Native paints the navigation bar an opaque colour instead, so that colour
 * is repainted to match, with React Native's own values. Android 7 (API 24-25) has
 * no light navigation bar, so there only the status bar changes.
 */
class AppNightModeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppNightMode")

    // `light`, `dark` or `system`. Returns whether Android stored the choice.
    Function("set") { choice: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      val context = appContext.reactContext ?: return@Function false
      val manager = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      manager.setApplicationNightMode(
        when (choice) {
          "dark" -> UiModeManager.MODE_NIGHT_YES
          "light" -> UiModeManager.MODE_NIGHT_NO
          // For an app, AUTO drops its own setting and follows the phone.
          else -> UiModeManager.MODE_NIGHT_AUTO
        }
      )
      true
    }

    Function("setSystemBarsDark") { dark: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        val window = activity.window
        val bars = WindowCompat.getInsetsController(window, window.decorView)
        bars.isAppearanceLightStatusBars = !dark
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@runOnUiThread
        bars.isAppearanceLightNavigationBars = !dark
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          @Suppress("DEPRECATION")
          window.navigationBarColor = if (dark) DARK_NAVIGATION_BAR else LIGHT_NAVIGATION_BAR
        }
      }
    }
  }

  private companion object {
    // React Native's own bar colours below Android 10 (WindowUtil.kt).
    val LIGHT_NAVIGATION_BAR = Color.argb(0xE6, 0xFF, 0xFF, 0xFF)
    val DARK_NAVIGATION_BAR = Color.argb(0x80, 0x1B, 0x1B, 0x1B)
  }
}
