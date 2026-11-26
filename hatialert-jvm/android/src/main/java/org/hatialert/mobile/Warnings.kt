package org.hatialert.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.hatialert.client.HatiClient
import org.hatialert.client.app.AlertNotice
import org.hatialert.client.app.AlertWatch
import org.hatialert.client.app.PollOutcome
import org.hatialert.client.app.SeenAlertStore
import org.hatialert.client.app.Translator

/**
 * Warning notifications while the app is closed. Android runs periodic background work at
 * most every 15 minutes (and may delay it to save battery), so text messages stay the fast
 * channel; this is a second one for people with data but no SMS alerts. What counts as a new
 * warning for this person is decided in :client ([AlertWatch], tested against the real server).
 */
object Warnings {
    private const val WORK = "warning-check"
    const val CHANNEL = "warnings"
    const val EXTRA_OPEN = "org.hatialert.mobile.OPEN"
    const val OPEN_ALERTS = "alerts"

    /** Starts or stops the background check: on only when switched on and someone is signed in. */
    fun schedule(context: Context, on: Boolean) {
        val wm = WorkManager.getInstance(context)
        if (!on) {
            wm.cancelUniqueWork(WORK)
            return
        }
        val request = PeriodicWorkRequestBuilder<WarningWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        // KEEP: re-scheduling on every app start must not push the next check further away.
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Android 13+ asks the person before an app may notify; older versions allow it by default. */
    fun mayNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun createChannel(context: Context, name: String, description: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_HIGH).apply {
            this.description = description
            enableVibration(true)
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    /** Shows one warning; tapping it opens the app on Alerts. */
    fun show(context: Context, notice: AlertNotice, translator: Translator) {
        if (!mayNotify(context)) return
        createChannel(context, translator.tr("Elephant warning"), translator.tr("Warnings from forest staff for your village"))
        val open = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_OPEN, OPEN_ALERTS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(
            context, notice.alertId.toInt(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(context).setPriority(Notification.PRIORITY_HIGH)
        }
        val n = builder
            .setSmallIcon(R.drawable.ic_stat_warning)
            .setContentTitle(translator.tr(notice.title))
            .setContentText(notice.message)
            .setStyle(Notification.BigTextStyle().bigText(notice.message))
            .setWhen(notice.sentAt)
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        context.getSystemService(NotificationManager::class.java)?.notify(notice.alertId.toInt(), n)
    }
}

/** Warning ids already shown, so a warning notifies at most once, also across restarts. */
class PrefsSeenAlertStore(context: Context) : SeenAlertStore {
    private val prefs = context.applicationContext.getSharedPreferences("hatialert-warnings", Context.MODE_PRIVATE)

    override fun load(): List<Long> =
        prefs.getString(KEY, "").orEmpty().split(',').mapNotNull { it.trim().toLongOrNull() }

    override fun save(ids: List<Long>) = prefs.edit { putString(KEY, ids.joinToString(",")) }

    private companion object {
        const val KEY = "seen"
    }
}

/** One background check: fetch the overview with the saved session and notify what is new. */
class WarningWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val settings = PrefsSettingsStore(applicationContext).load()
        val token = settings.token
        if (!settings.notifications || token == null) return@withContext Result.success()
        val client = HatiClient(settings.serverUrl, token = token)
        when (val outcome = AlertWatch(PrefsSeenAlertStore(applicationContext)).poll(client)) {
            is PollOutcome.Notices -> {
                val translator = Translator.forLanguage(settings.language)
                outcome.notices.forEach { Warnings.show(applicationContext, it, translator) }
                Result.success()
            }
            is PollOutcome.TryLater -> Result.retry()
            else -> Result.success() // signed out or refused: nothing to show; the next check tries again
        }
    }
}
