package expo.modules.meetingforegroundservice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps a meeting's microphone open while the app is in the background.
 *
 * Android silences every recording of a backgrounded app unless it runs a
 * foreground service of type `microphone` — both the call's WebRTC capture and the
 * translation recorder. This service does nothing else: it exists so the process
 * counts as foreground, and its ongoing notification is the user-visible proof
 * that the microphone is live. The camera is not covered, by design.
 */
class MeetingForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(intent?.getStringExtra(EXTRA_TITLE) ?: "")
      .setContentText(intent?.getStringExtra(EXTRA_TEXT) ?: "")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(openAppIntent())
      .build()
    try {
      val type =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    } catch (e: Exception) {
      // Refused (e.g. microphone permission revoked): the call goes on, it just
      // loses its microphone in the background, as before this service existed.
      Log.w(TAG, "could not enter the foreground", e)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  /** Swiping the app away ends the call; the notification must not outlive it. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Meetings", NotificationManager.IMPORTANCE_LOW)
    )
  }

  /** Tapping the notification brings the app back to the call. */
  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE)
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "meeting"
    private const val NOTIFICATION_ID = 4210
    private const val TAG = "MeetingForegroundService"
  }
}
