package com.ilovetrains.app

internal enum class TravelTrackerSuppression { Dismissed, Completed }

internal data class TravelTrackerSession(
    val activeIdentity: TravelTrackerIdentity? = null,
    val generation: Long = 0,
    val suppressedIdentity: TravelTrackerIdentity? = null,
    val suppression: TravelTrackerSuppression? = null,
    val notificationPrompted: Boolean = false,
)

internal interface TravelTrackerSessionStore {
    fun load(): TravelTrackerSession
    fun save(session: TravelTrackerSession)
}

internal interface TravelTrackerRuntime {
    fun notificationsAllowed(): Boolean
    fun startService(revision: TravelTrackerRevision): Boolean
    fun stopService()
}

internal class TravelTrackerLifecycle(
    private val store: TravelTrackerSessionStore,
    private val runtime: TravelTrackerRuntime,
) {
    private var session = store.load()
    private var foreground = false
    private var serviceRunning = false
    private var surfaceRequested = false
    private var permissionRequest: (() -> Unit)? = null

    fun attachActivity(requestPermission: () -> Unit) {
        permissionRequest = requestPermission
    }

    fun detachActivity(requestPermission: () -> Unit) {
        if (permissionRequest === requestPermission) permissionRequest = null
    }

    fun activityResumed() {
        foreground = true
    }

    fun activityStopped() {
        foreground = false
    }

    fun serviceAttached() {
        serviceRunning = true
        surfaceRequested = true
    }

    fun serviceDetached() {
        serviceRunning = false
        surfaceRequested = false
    }

    fun reconcile(focus: FocusedJourney?, visibleFocus: FocusedJourney?, now: Long, recordedComplete: Boolean = false): TravelTrackerState? {
        val identity = focus?.trackerIdentity
        var changed = false

        if (identity == null) {
            if (session.activeIdentity != null) {
                session = session.copy(activeIdentity = null)
                changed = true
            }
            if (changed) store.save(session)
            stopSurface()
            return null
        }

        if (session.activeIdentity != null && session.activeIdentity != identity) {
            session = session.copy(activeIdentity = identity, generation = session.generation + 1)
            changed = true
        } else if (session.activeIdentity == null) {
            val resumableCompletion = session.suppressedIdentity == identity &&
                session.suppression == TravelTrackerSuppression.Completed &&
                TravelTrackerState.derive(focus, now, session.generation + 1) != null
            val newInference = !focus.pinned && session.suppressedIdentity != identity
            if (resumableCompletion || newInference) {
                session = session.copy(activeIdentity = identity, generation = session.generation + 1)
                changed = true
            }
        }

        if (session.activeIdentity != identity) {
            if (changed) store.save(session)
            stopSurface()
            return null
        }


        if (recordedComplete) {
            session = session.copy(
                activeIdentity = null,
                suppressedIdentity = identity,
                suppression = TravelTrackerSuppression.Completed,
            )
            store.save(session)
            stopSurface()
            return null
        }

        val projection = TravelTrackerState.derive(focus, now, session.generation)
        if (projection == null) {
            session = session.copy(
                activeIdentity = null,
                suppressedIdentity = identity,
                suppression = TravelTrackerSuppression.Completed,
            )
            store.save(session)
            stopSurface()
            return null
        }

        if (changed) store.save(session)
        if (visibleFocus?.trackerIdentity != identity) {
            stopSurface()
            return null
        }

        if (!runtime.notificationsAllowed()) {
            stopSurface()
            requestPermissionOnce()
            return projection
        }

        if (!surfaceRequested) {
            if (serviceRunning) surfaceRequested = true
            else if (foreground) {
                surfaceRequested = runtime.startService(projection.revision)
            }
        }
        return projection
    }

    fun permissionResult() {
        if (!runtime.notificationsAllowed()) stopSurface()
    }

    fun dismiss(revision: TravelTrackerRevision): Boolean {
        if (session.activeIdentity != revision.identity || session.generation != revision.generation) return false
        session = session.copy(
            activeIdentity = null,
            suppressedIdentity = revision.identity,
            suppression = TravelTrackerSuppression.Dismissed,
        )
        store.save(session)
        stopSurface()
        return true
    }

    fun accepts(revision: TravelTrackerRevision): Boolean =
        session.activeIdentity == revision.identity && session.generation == revision.generation

    fun activeRevision(): TravelTrackerRevision? = session.activeIdentity?.let {
        TravelTrackerRevision(it, session.generation)
    }

    private fun requestPermissionOnce() {
        val request = permissionRequest ?: return
        if (!foreground || session.notificationPrompted) return
        session = session.copy(notificationPrompted = true)
        store.save(session)
        request()
    }

    private fun stopSurface() {
        if (!surfaceRequested && !serviceRunning) return
        surfaceRequested = false
        runtime.stopService()
    }
}

internal val FocusedJourney.trackerIdentity: TravelTrackerIdentity
    get() = TravelTrackerIdentity(tripId, reverse, journey.key)

internal object DisabledTravelTrackerRuntime : TravelTrackerRuntime {
    override fun notificationsAllowed() = false
    override fun startService(revision: TravelTrackerRevision) = false
    override fun stopService() = Unit
}

internal sealed interface TravelTrackerServiceState {
    data object Pending : TravelTrackerServiceState
    data object Stop : TravelTrackerServiceState
    data class Active(val focus: FocusedJourney, val presentation: TravelTrackerState) : TravelTrackerServiceState
}

internal class MemoryTravelTrackerSessionStore : TravelTrackerSessionStore {
    private var value = TravelTrackerSession(notificationPrompted = true)
    override fun load() = value
    override fun save(session: TravelTrackerSession) { value = session }
}
