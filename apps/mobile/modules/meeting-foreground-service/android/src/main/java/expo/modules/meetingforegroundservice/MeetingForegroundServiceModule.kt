package expo.modules.meetingforegroundservice

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS entry points for [MeetingForegroundService]: start on join, stop on leave. */
class MeetingForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MeetingForegroundService")

    /** True when the service was asked to start; false when Android refused at once. */
    Function("start") { title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, MeetingForegroundService::class.java)
        .putExtra(MeetingForegroundService.EXTRA_TITLE, title)
        .putExtra(MeetingForegroundService.EXTRA_TEXT, text)
      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: Exception) {
        // Android 12+ refuses a start from the background; the next join retries.
        Log.w("MeetingForegroundService", "could not start", e)
        false
      }
    }

    /** True when a running service was stopped. */
    Function("stop") {
      appContext.reactContext?.let { it.stopService(Intent(it, MeetingForegroundService::class.java)) } ?: false
    }
  }
}
