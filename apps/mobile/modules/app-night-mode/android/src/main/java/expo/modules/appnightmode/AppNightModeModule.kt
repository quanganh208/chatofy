package expo.modules.appnightmode

import android.app.UiModeManager
import android.content.Context
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
 * `setNavigationBarDark` restyles the navigation bar's buttons (and with them the
 * contrast scrim Android draws behind three-button navigation) for the scheme the
 * app is drawing now, on every Android version.
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

    Function("setNavigationBarDark") { dark: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        WindowCompat.getInsetsController(activity.window, activity.window.decorView)
          .isAppearanceLightNavigationBars = !dark
      }
    }
  }
}
