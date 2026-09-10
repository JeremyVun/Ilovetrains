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
    fun haptic()
}

private data class TravelTrackerObservation(
    val stage: TravelTrackerStage,
    val legIndex: Int,
    val cancelled: Boolean,
)

private enum class TravelTrackerCueKind { Final, Transfer, MissedTransfer, Cancellation }

private data class TravelTrackerCue(val kind: TravelTrackerCueKind, val legIndex: Int)

internal class TravelTrackerLifecycle(
    private val store: TravelTrackerSessionStore,
    private val runtime: TravelTrackerRuntime,
) {
    private var session = store.load()
    private var foreground = false
    private var serviceRunning = false
    private var surfaceRequested = false
    private var permissionRequest: (() -> Unit)? = null
    private var observedRevision: TravelTrackerRevision? = null
    private var observed: TravelTrackerObservation? = null
    private val cued = mutableSetOf<TravelTrackerCue>()
    private var pendingCue = false

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

    fun reconcile(focus: FocusedJourney?, visibleFocus: FocusedJourney?, now: Long, recordedComplete: Boolean = false,
                  arrival: ArrivalResult? = null, journeyAlerts: Boolean = true): TravelTrackerState? {
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
                TravelTrackerState.derive(focus, now, session.generation + 1, arrival) != null
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

        val projection = TravelTrackerState.derive(focus, now, session.generation, arrival)
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

        val allowed = runtime.notificationsAllowed()
        observe(projection, journeyAlerts, allowed)

        if (!allowed) {
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

    fun consumeCue(): Boolean {
        val value = pendingCue
        pendingCue = false
        return value
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

    private fun observe(projection: TravelTrackerState, journeyAlerts: Boolean, notificationsAllowed: Boolean) {
        val previous = observed.takeIf { observedRevision == projection.revision }
        if (previous == null) {
            observedRevision = projection.revision
            cued.clear()
            pendingCue = false
        }
        val current = TravelTrackerObservation(projection.stage, projection.activeLegIndex,
            projection.event.kind == TravelTrackerEventKind.Cancellation)
        observed = current
        if (previous == null || !journeyAlerts) return
        val fired = cues(previous, current).filter { cued.add(it) }
        if (fired.isEmpty()) return
        if (foreground) runtime.haptic() else if (notificationsAllowed) pendingCue = true
    }

    private fun cues(previous: TravelTrackerObservation, current: TravelTrackerObservation): List<TravelTrackerCue> = buildList {
        if (current.stage != previous.stage || current.legIndex != previous.legIndex) {
            when (current.stage) {
                TravelTrackerStage.Final -> add(TravelTrackerCue(TravelTrackerCueKind.Final, current.legIndex))
                TravelTrackerStage.Transfer -> add(TravelTrackerCue(TravelTrackerCueKind.Transfer, current.legIndex))
                TravelTrackerStage.MissedTransfer -> add(TravelTrackerCue(TravelTrackerCueKind.MissedTransfer, current.legIndex))
                TravelTrackerStage.Boarding, TravelTrackerStage.Ride -> Unit
            }
        }
        if (current.cancelled && !previous.cancelled) {
            add(TravelTrackerCue(TravelTrackerCueKind.Cancellation, current.legIndex))
        }
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
    override fun haptic() = Unit
}

internal sealed interface TravelTrackerServiceState {
    data object Pending : TravelTrackerServiceState
    data object Stop : TravelTrackerServiceState
    data class Active(val focus: FocusedJourney, val presentation: TravelTrackerState, val alert: Boolean = false) : TravelTrackerServiceState
}

internal class MemoryTravelTrackerSessionStore : TravelTrackerSessionStore {
    private var value = TravelTrackerSession(notificationPrompted = true)
    override fun load() = value
    override fun save(session: TravelTrackerSession) { value = session }
}
