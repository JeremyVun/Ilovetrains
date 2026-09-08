package com.ilovetrains.app

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent

internal class AndroidTravelTrackerSessionStore(context: Context) : TravelTrackerSessionStore {
    private val preferences = context.getSharedPreferences("tracker-v1", Context.MODE_PRIVATE)

    override fun load(): TravelTrackerSession = TravelTrackerSession(
        activeIdentity = identity("active"),
        generation = preferences.getLong("generation", 0),
        suppressedIdentity = identity("suppressed"),
        suppression = preferences.getString("suppression", null)?.let {
            runCatching { TravelTrackerSuppression.valueOf(it) }.getOrNull()
        },
        notificationPrompted = preferences.getBoolean("notificationPrompted", false),
    )

    @SuppressLint("ApplySharedPref")
    override fun save(session: TravelTrackerSession) {
        // Commit suppression before Android can restart the service.
        preferences.edit().apply {
            putLong("generation", session.generation)
            putBoolean("notificationPrompted", session.notificationPrompted)
            putIdentity("active", session.activeIdentity)
            putIdentity("suppressed", session.suppressedIdentity)
            if (session.suppression == null) remove("suppression")
            else putString("suppression", session.suppression.name)
        }.commit()
    }

    private fun identity(prefix: String): TravelTrackerIdentity? {
        val tripId = preferences.getString("${prefix}TripId", null) ?: return null
        val serviceKey = preferences.getString("${prefix}ServiceKey", null) ?: return null
        return TravelTrackerIdentity(tripId, preferences.getBoolean("${prefix}Reverse", false), serviceKey)
    }

    private fun android.content.SharedPreferences.Editor.putIdentity(prefix: String, identity: TravelTrackerIdentity?) {
        if (identity == null) {
            remove("${prefix}TripId").remove("${prefix}Reverse").remove("${prefix}ServiceKey")
        } else {
            putString("${prefix}TripId", identity.tripId)
            putBoolean("${prefix}Reverse", identity.reverse)
            putString("${prefix}ServiceKey", identity.serviceKey)
        }
    }
}

internal class AndroidTravelTrackerRuntime(private val context: Context) : TravelTrackerRuntime {
    override fun notificationsAllowed(): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        return manager.getNotificationChannel(TravelTrackerNotification.ChannelId)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    override fun startService(revision: TravelTrackerRevision): Boolean {
        return try {
            context.startForegroundService(
                Intent(context, TravelTrackerService::class.java)
                    .setAction(TravelTrackerService.ActionStart)
                    .putTrackerRevision(revision),
            )
            true
        } catch (_: SecurityException) {
            false
        } catch (_: IllegalStateException) {
            false
        }
    }

    override fun stopService() {
        context.stopService(Intent(context, TravelTrackerService::class.java))
    }
}

internal fun Intent.putTrackerRevision(revision: TravelTrackerRevision): Intent =
    putExtra(TravelTrackerService.ExtraTripId, revision.identity.tripId)
        .putExtra(TravelTrackerService.ExtraReverse, revision.identity.reverse)
        .putExtra(TravelTrackerService.ExtraServiceKey, revision.identity.serviceKey)
        .putExtra(TravelTrackerService.ExtraGeneration, revision.generation)

internal fun Intent.trackerRevision(): TravelTrackerRevision? {
    val tripId = getStringExtra(TravelTrackerService.ExtraTripId) ?: return null
    val serviceKey = getStringExtra(TravelTrackerService.ExtraServiceKey) ?: return null
    if (!hasExtra(TravelTrackerService.ExtraGeneration)) return null
    return TravelTrackerRevision(
        TravelTrackerIdentity(tripId, getBooleanExtra(TravelTrackerService.ExtraReverse, false), serviceKey),
        getLongExtra(TravelTrackerService.ExtraGeneration, -1),
    )
}
