package com.ilovetrains.app

import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import kotlin.math.min

class TravelTrackerService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val model get() = (application as TrainApplication).model
    private var foreground = false
    private var lastRefreshAt = 0L

    override fun onCreate() {
        super.onCreate()
        TravelTrackerNotification.createChannel(this)
        model.trackerServiceAttached()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val dismissal = intent?.action == ActionDismiss
        if (dismissal && intent?.trackerRevision()?.let(model::dismissTracker) == true) {
            end()
            return START_NOT_STICKY
        }

        if (!foreground) {
            try {
                val opening = TravelTrackerNotification.opening(this)
                if (Build.VERSION.SDK_INT >= 34) {
                    startForeground(TravelTrackerNotification.NotificationId, opening, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                } else startForeground(TravelTrackerNotification.NotificationId, opening)
                foreground = true
            } catch (_: SecurityException) {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_STICKY
    }

    private val tick = object : Runnable {
        override fun run() {
            when (val value = model.trackerServiceState()) {
                TravelTrackerServiceState.Pending -> Unit
                TravelTrackerServiceState.Stop -> {
                    end()
                    return
                }
                is TravelTrackerServiceState.Active -> {
                    getSystemService(NotificationManager::class.java).notify(
                        TravelTrackerNotification.NotificationId,
                        TravelTrackerNotification.build(this@TravelTrackerService, value.focus, value.presentation),
                    )
                    val elapsed = SystemClock.elapsedRealtime()
                    if (lastRefreshAt == 0L || elapsed - lastRefreshAt >= 30_000) {
                        lastRefreshAt = elapsed
                        model.trackerBackgroundRefresh()
                    }
                    handler.postDelayed(this, nextTickDelay(value.presentation))
                    return
                }
            }
            handler.postDelayed(this, 100)
        }
    }

    private fun nextTickDelay(state: TravelTrackerState): Long {
        val now = System.currentTimeMillis()
        var delay = 5_000L
        listOfNotNull(state.nextBoundary, state.freshUntil).forEach { boundary ->
            if (boundary > now) delay = min(delay, boundary - now + 50)
        }
        return delay.coerceAtLeast(250)
    }

    private fun end() {
        handler.removeCallbacksAndMessages(null)
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        model.trackerServiceDetached()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ActionStart = "com.ilovetrains.app.tracker.START"
        const val ActionDismiss = "com.ilovetrains.app.tracker.DISMISS"
        const val ActionOpen = "com.ilovetrains.app.tracker.OPEN"
        const val ExtraTripId = "trackerTripId"
        const val ExtraReverse = "trackerReverse"
        const val ExtraServiceKey = "trackerServiceKey"
        const val ExtraGeneration = "trackerGeneration"
    }
}
