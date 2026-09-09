package com.ilovetrains.app

import android.app.Application
import android.os.Build
import android.view.accessibility.AccessibilityManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.selects.select
import java.time.Instant
import java.util.UUID
import kotlin.math.roundToInt

class TrainViewModel private constructor(
    application: Application,
    private val undoWindowMillis: Long = UndoWindowMillis,
    trackerStore: TravelTrackerSessionStore = MemoryTravelTrackerSessionStore(),
    trackerRuntime: TravelTrackerRuntime = DisabledTravelTrackerRuntime,
) : AndroidViewModel(application), UiActions {
    @JvmOverloads constructor(application: Application, undoWindowMillis: Long = UndoWindowMillis) :
        this(application, undoWindowMillis, MemoryTravelTrackerSessionStore(), DisabledTravelTrackerRuntime)

    internal constructor(
        application: Application,
        trackerStore: TravelTrackerSessionStore,
        trackerRuntime: TravelTrackerRuntime,
    ) : this(application, UndoWindowMillis, trackerStore, trackerRuntime)
    private val store = DeviceStore(application)
    private val api = TransitApi()
    private val planner = OfflinePlanner(application)
    private val mutable = MutableStateFlow(AppState())
    val state = mutable.asStateFlow()
    private var data = UserData()
    private val writes = Channel<UserData>(Channel.UNLIMITED)
    private var stations = emptyList<Station>()
    private var fix: Fix? = null
    private var explicit = false
    private var generation = 0L
    private var boardJob: Job? = null
    private var earlierJob: Job? = null
    private var focusJob: Job? = null
    private var historyJob: Job? = null
    private var historyRecorded = false
    private var refreshLoop: Job? = null
    private var realtimeJob: Job? = null
    private var feedbackJob: Job? = null
    private var pendingDeletion: PendingDeletion? = null
    private var undoJob: Job? = null
    private var lastRealtimeAttempt = 0L
    private var lastTimetableCheck = 0L
    private val recommendationSearches = mutableMapOf<String, Long>()
    private var initialized = CompletableDeferred<Unit>()
    var onLocationRequest: (() -> Unit)? = null
    var onSilentLocation: (() -> Unit)? = null
    var onLocationDisabled: (() -> Unit)? = null
    var onArrivalMonitoring: (((() -> Unit) -> Boolean))? = null
    private var settingsBack = Screen.Home
    private var setupOriginEdited = false
    private var setupLocationRequested = false
    private var setupLocationResolved = false
    private var redirect: FocusedJourney? = null
    private var redirectTargetId: String? = null
    private var suppressNextLastAnswer = false
    private var hasResumed = false
    private val tracker = TravelTrackerLifecycle(trackerStore, trackerRuntime)
    private var trackerRefreshJob: Job? = null
    private var activityCallbacksOwner: Any? = null
    private var pendingTrackerOpen: TravelTrackerRevision? = null
    private var activityForeground = false
    private var arrivalWindow: ArrivalWindow? = null
    private var arrivalResult: ArrivalResult? = null
    private var arrivalMonitoring = false
    private var arrivalPermissionPending = true
    private var arrivalResumeWaitUntil: Long? = null
    private var trackerPublicationGeneration = 0L
    @Volatile private var debugTrackerClock: Long? = null
    @Volatile private var debugTrackerCaptureMode = false

    init {
        viewModelScope.launch {
            for (snapshot in writes) runCatching { store.save(snapshot) }.onFailure { message("Couldn’t save changes on this phone. Free some storage and try again.") }
        }
        viewModelScope.launch {
            data = store.load(); stations = runCatching { store.stations() }.getOrDefault(emptyList())
            if (data.useLocation && arrivalPermissionPending && arrivalResumeWaitUntil == null) {
                arrivalResumeWaitUntil = System.currentTimeMillis() + 15_000
            }
            syncPersonal()
            ensureArrivalMonitoring()
            evaluateArrival(sync = false)
            syncPersonal(); choosePrediction()
            mutable.value = mutable.value.copy(ready = true, screen = if (data.trips.isEmpty()) Screen.Setup else Screen.Home, stations = stations)
            syncTracker()
            pendingTrackerOpen?.let { revision -> pendingTrackerOpen = null; openTrackedJourney(revision) }
            if (activityForeground) startForegroundWork()
        }
        viewModelScope.launch {
            try {
                planner.initialize(); initialized.complete(Unit)
                mutable.value = mutable.value.copy(timetableStatus = planner.coverageDescription)
            } catch (_: Exception) {
                initialized.completeExceptionally(IllegalStateException("Offline timetable unavailable"))
                mutable.value = mutable.value.copy(timetableStatus = "Offline timetable unavailable. Download it in Settings.")
            }
        }
    }
    private fun persist() { writes.trySend(data) }
    private fun readFlags() {
        if (debugTrackerCaptureMode) return
        viewModelScope.launch {
            val flags = runCatching { api.flags() }.getOrNull()
            if (debugTrackerCaptureMode) return@launch
            mutable.value = mutable.value.copy(tinyTrain = flags?.get(TinyTrainFlag) == true)
            if (flags == null || flags == data.flags) return@launch
            val before = data.maxTransfers
            data = data.copy(flags = flags); persist()
            if (data.maxTransfers != before) {
                resetArrivalTracking()
                mutable.value = mutable.value.copy(board = null, homeBoard = null)
                choosePrediction(); syncPersonal(); suppressNextLastAnswer = true; refresh()
            } else syncPersonal()
        }
    }
    private fun message(text: String?, autoDismiss: Boolean = false) {
        mutable.value = mutable.value.copy(message = text, messageAutoDismiss = autoDismiss, undoAvailable = false)
    }
    private fun visibleFocus(now: Long = mutable.value.now): FocusedJourney? = visibleFocus(data, now, arrivalResumeWaitUntil)
        ?.takeIf { it.journey.withinTransferCap(data.maxTransfers) }?.let {
            it.copy(board = it.board.withinTransferCap(data.maxTransfers), alternatives = it.alternatives?.withinTransferCap(data.maxTransfers))
        }
    private fun syncPersonal() {
        val focus = visibleFocus()
        val selection = mutable.value.selectedTripId
        val ranked = data.trips.filter { compatible(it, data.modes) }.sortedWith(
            compareByDescending<SavedTrip> { it.id == (focus?.tripId ?: selection) }.thenByDescending {
                maxOf(historyScore(data.history, it.id, false, mutable.value.now), historyScore(data.history, it.id, true, mutable.value.now))
            })
        mutable.value = mutable.value.copy(trips = ranked, totalTrips = data.trips.size, focus = focus,
            focusComplete = focus?.let { f -> data.rides.any { it.tripId == f.tripId && it.reverse == f.reverse && it.departure == f.journey.departure } } == true,
            appearance = data.appearance, enabledModes = data.modes, useLocation = data.useLocation,
            transferLimit = if (data.flags[TransferLimitFlag] == true) data.transferLimit else null,
            home = data.home ?: automaticHome(data), automaticHome = automaticHome(data), homeIsManual = data.home != null,
            recentFrom = data.recentFrom, recentTo = data.recentTo,
            tripMetadata = savedTripMetadata(data, fix, mutable.value.selectedTripId, mutable.value.reverse, mutable.value.now),
            homeBoard = focus?.board ?: mutable.value.board, arrival = arrivalResult)
        syncTracker()
    }

    private fun syncTracker(): TravelTrackerState? {
        val now = trackerNow()
        val focus = data.focus
        val recordedComplete = focus?.let { subject ->
            data.rides.any { it.tripId == subject.tripId && it.reverse == subject.reverse && it.departure == subject.journey.departure }
        } == true
        return tracker.reconcile(focus, visibleFocus(now), now, recordedComplete, arrivalResult)
    }

    fun attachActivity(
        owner: Any,
        locationRequest: () -> Unit,
        silentLocation: () -> Unit,
        locationDisabled: () -> Unit,
        arrivalMonitoring: (() -> Unit) -> Boolean,
        notificationPermissionRequest: () -> Unit,
    ) {
        activityCallbacksOwner = owner
        onLocationRequest = locationRequest
        onSilentLocation = silentLocation
        onLocationDisabled = locationDisabled
        onArrivalMonitoring = arrivalMonitoring
        tracker.attachActivity(notificationPermissionRequest)
    }

    fun detachActivity(owner: Any, notificationPermissionRequest: () -> Unit) {
        if (activityCallbacksOwner !== owner) return
        activityCallbacksOwner = null
        onLocationRequest = null
        onSilentLocation = null
        onLocationDisabled = null
        onArrivalMonitoring = null
        tracker.detachActivity(notificationPermissionRequest)
    }

    fun activityResumed() {
        activityForeground = true
        arrivalPermissionPending = true
        arrivalResumeWaitUntil = System.currentTimeMillis() + 15_000
        trackerRefreshJob?.cancel()
        trackerPublicationGeneration++
        tracker.activityResumed()
        syncTracker()
    }

    fun activityStopped() {
        activityForeground = false
        stopArrivalMonitoring(clearWindow = true)
        arrivalPermissionPending = false
        arrivalResumeWaitUntil = null
        tracker.activityStopped()
    }

    fun notificationPermissionResult() {
        tracker.permissionResult()
        syncTracker()
    }

    internal fun trackerServiceAttached() {
        if (!activityForeground && activityCallbacksOwner == null) arrivalPermissionPending = false
        tracker.serviceAttached()
    }

    internal fun trackerActiveRevision(): TravelTrackerRevision? = tracker.activeRevision()

    internal fun trackerServiceDetached() {
        tracker.serviceDetached()
        trackerRefreshJob?.cancel()
        trackerPublicationGeneration++
    }

    internal fun trackerServiceState(): TravelTrackerServiceState {
        if (!mutable.value.ready) return TravelTrackerServiceState.Pending
        mutable.value = mutable.value.copy(now = trackerNow())
        evaluateArrival(sync = false)
        val presentation = syncTracker() ?: return TravelTrackerServiceState.Stop
        val focus = visibleFocus()?.takeIf { it.trackerIdentity == presentation.revision.identity }
            ?: return TravelTrackerServiceState.Stop
        if (!tracker.accepts(presentation.revision)) return TravelTrackerServiceState.Stop
        return TravelTrackerServiceState.Active(focus, presentation)
    }

    internal fun trackerBackgroundRefresh() {
        if (debugTrackerCaptureMode || activityForeground || !mutable.value.ready || trackerRefreshJob?.isActive == true) return
        val revision = tracker.activeRevision() ?: return
        val focus = data.focus?.takeIf { it.trackerIdentity == revision.identity } ?: return
        val pair = ends(focus.tripId, focus.reverse) ?: return
        val publication = ++trackerPublicationGeneration
        trackerRefreshJob = viewModelScope.launch {
            supervisorScope {
                val apiResult = async {
                    runCatching { api.focusedDepartures(pair.first, pair.second, focus.journey.departure.takeIf { it < System.currentTimeMillis() }) }.getOrNull()
                }
                val overlayResult = async {
                    runCatching {
                        initialized.await()
                        val sources = focus.journey.legs.mapNotNull { it.identity?.source }.toSet()
                        if (sources.isNotEmpty()) planner.refreshRealtime(api.baseUrl, sources)
                        planner.refreshFocused(focus.journey)
                    }.getOrNull()
                }
                val board = apiResult.await()
                val overlay = overlayResult.await()
                if (debugTrackerCaptureMode || publication != trackerPublicationGeneration || !tracker.accepts(revision)) return@supervisorScope
                val current = data.focus?.takeIf { it.trackerIdentity == revision.identity } ?: return@supervisorScope
                val match = board?.journeys?.find { it.key == revision.identity.serviceKey }
                val updated = when {
                    match != null -> current.copy(journey = match, board = board, alternatives = null)
                    overlay != null -> focusAfterRefresh(current, overlay, current.alternatives)
                    current.journey.legs.all { it.identity != null } -> current.demotedForLostOverlay()
                    else -> current.demotedForUnmatchedBoard()
                } ?: current
                if (updated != current) {
                    data = data.copy(focus = updated)
                    persist()
                }
                settleFocus(matchingRefresh = match != null || overlay?.canJudgeClock == true)
                syncPersonal()
            }
        }
    }

    fun openTrackedJourney(revision: TravelTrackerRevision) {
        if (!mutable.value.ready) {
            pendingTrackerOpen = revision
            return
        }
        if (!tracker.accepts(revision)) return
        val focus = visibleFocus()?.takeIf { it.trackerIdentity == revision.identity } ?: return
        if (ends(focus.tripId, focus.reverse)?.let { it.first.id == focus.board.from.id && it.second.id == focus.board.to.id } != true) return
        explicit = true
        historyRecorded = false
        mutable.value = mutable.value.copy(
            selectedTripId = focus.tripId,
            reverse = focus.reverse,
            board = focus.board,
            homeBoard = focus.board,
            screen = Screen.Detail,
            detail = focus.journey,
            receipt = null,
            justAddedTripId = null,
        )
        recordHistory()
        refreshFocus()
    }

    internal fun dismissTracker(revision: TravelTrackerRevision): Boolean = tracker.dismiss(revision)

    internal fun debugSetTrackerFocus(focus: FocusedJourney) {
        check(BuildConfig.DEBUG)
        val trip = SavedTrip(focus.tripId, focus.board.from, focus.board.to, lines = focus.journey.legs.map { it.line }.distinct())
        data = data.copy(trips = data.trips.filterNot { it.id == trip.id } + trip, focus = focus)
        mutable.value = mutable.value.copy(now = trackerNow())
        persist()
        syncPersonal()
    }

    internal fun debugSetTrackerClock(now: Long?) {
        check(BuildConfig.DEBUG)
        debugTrackerClock = now
        mutable.value = mutable.value.copy(now = trackerNow())
        syncTracker()
    }

    internal fun debugSetTrackerCaptureMode(enabled: Boolean) {
        check(BuildConfig.DEBUG)
        debugTrackerCaptureMode = enabled
        if (!enabled) return
        boardJob?.cancel()
        earlierJob?.cancel()
        focusJob?.cancel()
        realtimeJob?.cancel()
        trackerRefreshJob?.cancel()
        generation++
        trackerPublicationGeneration++
        mutable.value = mutable.value.copy(refreshing = false)
    }

    private fun trackerNow(): Long = if (BuildConfig.DEBUG) debugTrackerClock ?: System.currentTimeMillis() else System.currentTimeMillis()

    internal fun debugBrowseWithoutChangingTracker(trip: SavedTrip, board: BoardData) {
        check(BuildConfig.DEBUG)
        data = data.copy(trips = data.trips.filterNot { it.id == trip.id } + trip)
        explicit = true
        mutable.value = mutable.value.copy(
            selectedTripId = trip.id,
            reverse = board.from.id == trip.to.id,
            board = board,
            screen = Screen.Board,
            detail = null,
        )
        syncPersonal()
    }
    private fun choosePrediction() {
        if (explicit && data.trips.any { it.id == mutable.value.selectedTripId && compatible(it, data.modes) }) return
        val focus = visibleFocus()
        val selection = focus?.let { Selection(it.tripId, it.reverse) } ?: predict(data, stations, fix, mutable.value.now)
        mutable.value = mutable.value.copy(selectedTripId = selection?.tripId, reverse = selection?.reverse ?: false, receipt = selection?.receipt)
        syncPersonal()
    }
    private fun ends(id: String? = mutable.value.selectedTripId, reverse: Boolean = mutable.value.reverse): Pair<Station, Station>? {
        val trip = data.trips.find { it.id == id } ?: return null
        return if (reverse) trip.to to trip.from else trip.from to trip.to
    }
    fun resume() {
        if (refreshLoop != null) return
        if (hasResumed) mutable.value = mutable.value.copy(justAddedTripId = null)
        hasResumed = true
        mutable.value = mutable.value.copy(now = trackerNow())
        refreshLoop = viewModelScope.launch {
            var ticks = 0
            if (mutable.value.ready) startForegroundWork()
            while (isActive) {
                delay(1000); mutable.value = mutable.value.copy(now = trackerNow())
                ensureArrivalMonitoring()
                if (++ticks % 30 == 0 && mutable.value.ready) { refreshSharedData(); refresh(); readFlags() }
                else if (data.focus != null) evaluateArrival()
            }
        }
    }
    private fun startForegroundWork() {
        choosePrediction()
        refreshSharedData()
        refresh()
        readFlags()
        ensureArrivalMonitoring()
        if (data.useLocation) onSilentLocation?.invoke()
    }
    fun pause() {
        refreshLoop?.cancel(); refreshLoop = null; boardJob?.cancel(); earlierJob?.cancel(); focusJob?.cancel(); historyJob?.cancel(); realtimeJob?.cancel(); generation++
        mutable.value = mutable.value.copy(refreshing = false, distanceMetres = null, nearestStation = null)
        fix = null
        stopArrivalMonitoring(clearWindow = true)
    }
    private fun refreshSharedData() {
        if (debugTrackerCaptureMode) return
        val now = mutable.value.now
        if (now - lastRealtimeAttempt < 25_000 || realtimeJob?.isActive == true) return
        lastRealtimeAttempt = now
        realtimeJob = viewModelScope.launch {
            try {
                initialized.await()
                val fetched = try { planner.refreshRealtime(api.baseUrl); true }
                    catch (e: CancellationException) { throw e } catch (_: Exception) { false }
                if (debugTrackerCaptureMode) return@launch
                val request = generation; val pair = ends(); val modes = data.modes.toSet()
                // Replanning on a failed fetch would republish the same rows from the realtime the app already had.
                if (fetched && pair != null && modes.isNotEmpty() && mutable.value.board?.isLive(mutable.value.now) != true) {
                    val local = planner.planWithRecommendation(pair.first, pair.second, mutable.value.now - 900_000, modes, 24, data.offlineMaxTransfers, recommendationAt = mutable.value.now).board
                    if (local.journeys.isNotEmpty()) {
                        val prior = mutable.value.board?.takeIf { it.from.id == pair.first.id && it.to.id == pair.second.id }
                        publishBoard(mergeBoardResults(prior, local, null, mutable.value.now, requestFailed = false), request)
                    }
                }
                data.focus?.takeIf { it.journey.legs.all { l -> l.identity != null } }?.let { focus ->
                    val updated = try { planner.refreshFocused(focus.journey) }
                        catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                    if (data.focus?.let { it.tripId == focus.tripId && it.reverse == focus.reverse && it.journey.key == focus.journey.key } == true) {
                        val alternatives = try { planner.plan(focus.board.from, focus.board.to, mutable.value.now - 900_000, AllModes, 24, data.offlineMaxTransfers) }
                            catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                        if (data.focus?.let { it.tripId == focus.tripId && it.reverse == focus.reverse && it.journey.key == focus.journey.key } != true) {
                            return@let
                        }
                        // The overlay demotes only a focus it still owns; refreshFocus may have handed it to the API.
                        data.focus?.let { subject -> data = data.copy(focus = focusAfterRefresh(subject, updated, alternatives)) }
                        settleFocus(matchingRefresh = updated?.canJudgeClock == true); persist(); syncPersonal()
                    }
                }
                if (fetched && now - lastTimetableCheck > 6 * 3_600_000) {
                    lastTimetableCheck = now
                    planner.update(api.baseUrl)
                    mutable.value = mutable.value.copy(timetableStatus = planner.coverageDescription)
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { /* The working generation remains installed. */ }
        }
    }
    override fun refresh() {
        if (debugTrackerCaptureMode || !mutable.value.ready) return
        boardJob?.cancel(); earlierJob?.cancel(); generation++
        val request = generation
        val suppressLastAnswer = suppressNextLastAnswer
        suppressNextLastAnswer = false
        val pair = ends(); val modes = data.modes.toSet()
        if (pair == null || modes.isEmpty()) {
            mutable.value = mutable.value.copy(board = null, homeBoard = visibleFocus()?.board, refreshing = false)
            refreshFocus(); return
        }
        val selectedId = mutable.value.selectedTripId; val reversed = mutable.value.reverse
        mutable.value = mutable.value.copy(refreshing = true)
        boardJob = viewModelScope.launch {
            val (from, to) = pair
            val cached = store.cached(from, to, modes)?.withinTransferCap(data.maxTransfers)?.let { saved ->
                val recommendation = selectRecommendation(saved.recommendationCandidates(mutable.value.now,
                    TransferConstraint(data.maxTransfers)), mutable.value.now, modes, data.maxTransfers)
                    ?.let { RecommendationResult(it.journey, it.source) }
                saved.copy(recommendation = recommendation)
            }
            if (request != generation) return@launch
            val previous = mutable.value.board?.takeIf { it.from.id == from.id && it.to.id == to.id } ?: cached
            if (mutable.value.board !== previous) {
                publishBoard(cached?.lastKnown(), request)
            }
            supervisorScope {
                var onlineCompletedAt = 0L
                val local = async {
                    try { initialized.await(); planner.planWithRecommendation(from, to, mutable.value.now - 15 * 60_000, modes, 24, data.offlineMaxTransfers, recommendationAt = mutable.value.now).board }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { null }
                }
                val live = async {
                    val response = try { api.departures(from, to, modes, transferLimit = data.maxTransfers) }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { null }
                    onlineCompletedAt = System.currentTimeMillis()
                    response
                }
                val first = select<Pair<Boolean, BoardData?>> {
                    local.onAwait { false to it }
                    live.onAwait { true to it }
                }
                if (request != generation) return@supervisorScope
                if (first.second != null && (first.first || previous == null || !previous.isLive(mutable.value.now))) {
                    publishBoard(mergeBoardResults(previous, first.second.takeUnless { first.first }, first.second.takeIf { first.first },
                        mutable.value.now, requestFailed = false), request)
                }
                val localResult = if (first.first) local.await() else first.second
                val result = if (first.first) first.second else live.await()
                if (request != generation) return@supervisorScope
                val final = mergeBoardResults(previous, localResult, result, mutable.value.now, requestFailed = result == null)
                    ?: BoardData(from, to, emptyList(), 0, offline = true, error = "No saved board for this trip yet")
                publishBoard(final, request)
                resolveRedirect(final)
                mutable.value = mutable.value.copy(refreshing = false)
                runCatching { store.cache(mutable.value.board ?: final, modes) }
                if (result != null && data.focus == null && mutable.value.screen == Screen.Home) {
                    searchRecommendationPages(from, to, modes, data.maxTransfers, result, request, onlineCompletedAt)
                }
                val now = mutable.value.now
                val displayed = mutable.value.board?.takeIf { it.from.id == from.id && it.to.id == to.id } ?: final
                val lead = nextHomeJourney(displayed, now)
                if (lead != null && selectedId != null) {
                    var changed = false
                    val evidence = shownLeadEvidence(displayed,
                        listOfNotNull(result, localResult, displayed.recommendation?.source), now,
                        suppressLastAnswer || data.focus != null || mutable.value.screen != Screen.Home)
                    if (evidence != null) {
                        val here = stationHere(data, stations, fix, mutable.value.now)
                        data = data.copy(lastAnswer = LastAnswer(selectedId, reversed, mutable.value.now,
                            here?.id?.takeIf { fix != null && distanceMetres(fix!!, here) <= 200 }, evidence.board, evidence.journey))
                        changed = true
                    }
                    if (changed) { persist(); syncPersonal() }
                }
            }
        }
        refreshFocus()
    }
    private suspend fun searchRecommendationPages(
        from: Station,
        to: Station,
        modes: Set<String>,
        maxTransfers: Int?,
        first: BoardData,
        request: Long,
        firstCompletedAt: Long,
    ) {
        val key = "${from.id}\u0000${to.id}\u0000${modes.sorted().joinToString(",")}\u0000${maxTransfers ?: "any"}"
        val started = System.currentTimeMillis()
        if (recommendationSearches[key]?.let { started - it < 60_000 } == true) return
        val deadline = firstCompletedAt + 12_000
        if (started >= deadline) return
        recommendationSearches[key] = started
        withTimeoutOrNull(deadline - started) {
            var previousAt = mutable.value.now
            var source = first.copy(recommendationPages = emptyList())
            val seen = source.journeys.mapTo(mutableSetOf(), Journey::key)
            repeat(2) {
                if (request != generation || data.focus != null || mutable.value.screen != Screen.Home) return@withTimeoutOrNull
                val best = selectRecommendation(source.recommendationCandidates(mutable.value.now), mutable.value.now,
                    modes, maxTransfers)?.journey
                val cursor = nextRecommendationCursor(if (source.recommendationPages.isEmpty()) source else source.recommendationPages.last().body,
                    previousAt, mutable.value.now, best) ?: return@withTimeoutOrNull
                val page = try { api.departures(from, to, modes, cursor, maxTransfers) }
                catch (error: CancellationException) { throw error }
                catch (_: Exception) { return@withTimeoutOrNull }
                if (request != generation || data.focus != null || mutable.value.screen != Screen.Home ||
                    System.currentTimeMillis() >= deadline) return@withTimeoutOrNull
                if (page.journeys.isEmpty()) return@withTimeoutOrNull
                val newIdentities = page.journeys.map(Journey::key).filter(seen::add)
                source = source.copy(recommendationPages = source.recommendationPages + RecommendationPage(
                    cursor, page, page.serverStale, TransferConstraint(maxTransfers)))
                val recommendation = selectRecommendation(source.recommendationCandidates(mutable.value.now), mutable.value.now,
                    modes, maxTransfers)?.let { RecommendationResult(it.journey, it.source) }
                source = source.copy(recommendation = recommendation)
                val current = mutable.value.board?.takeIf { it.from.id == from.id && it.to.id == to.id } ?: return@withTimeoutOrNull
                val published = current.copy(recommendationPages = source.recommendationPages, recommendation = recommendation,
                    homeJourneyKey = nextHomeJourney(current.copy(recommendationPages = source.recommendationPages,
                        recommendation = recommendation), mutable.value.now)?.key)
                publishBoard(published, request)
                store.cache(published, modes)
                if (newIdentities.isEmpty()) return@withTimeoutOrNull
                previousAt = cursor
            }
        }
    }
    private fun publishBoard(board: BoardData?, request: Long) {
        if (generation != request) return
        // Cached and local boards can paint long before the network request finishes.
        val selectedId = mutable.value.selectedTripId
        val lead = board?.let { nextHomeJourney(it, mutable.value.now) }
        var linesChanged = false
        if (lead != null) {
            val lines = lead.legs.map { it.line }.distinct()
            data = data.copy(trips = data.trips.map {
                if (it.id == selectedId && it.lines != lines) { linesChanged = true; it.copy(lines = lines) } else it
            })
        }
        val detail = mutable.value.detail?.let { old -> board?.journeys?.find { it.key == old.key } ?: old.copy(retained = true) }
        val remembered = board?.copy(homeJourneyKey = nextHomeJourney(board, mutable.value.now)?.key)
        val trips = if (linesChanged) mutable.value.trips.map { trip -> data.trips.first { it.id == trip.id } } else mutable.value.trips
        mutable.value = mutable.value.copy(board = remembered, homeBoard = visibleFocus()?.board ?: remembered, detail = detail, trips = trips)
        if (linesChanged) persist()
    }
    private fun refreshFocus() {
        if (debugTrackerCaptureMode) return
        val focus = data.focus ?: return
        focusJob?.cancel()
        focusJob = viewModelScope.launch {
            val pair = ends(focus.tripId, focus.reverse) ?: return@launch
            val at = focus.journey.departure.takeIf { it < mutable.value.now }
            val result = try { api.focusedDepartures(pair.first, pair.second, at) } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            if (debugTrackerCaptureMode) return@launch
            if (data.focus?.journey?.key != focus.journey.key || data.focus?.tripId != focus.tripId || data.focus?.reverse != focus.reverse) return@launch
            val current = data.focus ?: return@launch
            val match = result?.journeys?.find { it.key == focus.journey.key }
            if (match != null) data = data.copy(focus = current.copy(journey = match, board = result, alternatives = null))
            else current.demotedForUnmatchedBoard()?.let { data = data.copy(focus = it) }
            settleFocus(matchingRefresh = match != null); persist(); syncPersonal()
        }
    }
    private fun settleFocus(matchingRefresh: Boolean = false) {
        val now = mutable.value.now
        var focus = data.focus ?: return
        if (!focus.board.isLive(now) && !focus.journey.retained && (focus.journey.realtime || focus.journey.cancelled)) {
            focus = focus.lastKnown()
            data = data.copy(focus = focus)
            persist()
        }
        evaluateArrival(matchingRefresh = matchingRefresh)
    }
    private fun settleRide(focus: FocusedJourney, arrived: Boolean) {
        val rides = data.rides.settled(focus, arrived, ends(focus.tripId, focus.reverse))
        if (rides === data.rides) return
        data = data.copy(rides = rides); persist()
    }
    private fun focusIdentity(focus: FocusedJourney): String =
        "${focus.tripId}\u0000${focus.reverse}\u0000${focus.journey.key}"

    private fun evaluateArrival(
        sample: ArrivalSample? = null,
        matchingRefresh: Boolean = false,
        monitoringOverride: Boolean? = null,
        sync: Boolean = true,
    ) {
        val focus = data.focus
        if (focus == null) {
            arrivalResult = null
            arrivalWindow = null
            if (sync) syncPersonal()
            return
        }
        val identity = focusIdentity(focus)
        if (arrivalWindow?.identity != identity) arrivalWindow = null
        val completed = data.rides.any {
            it.tripId == focus.tripId && it.reverse == focus.reverse && it.departure == focus.journey.departure
        }
        val result = reduceArrival(ArrivalInput(
            identity = identity,
            departureMs = focus.journey.effectiveDeparture,
            arrivalMs = focus.journey.effectiveArrival,
            nowMs = mutable.value.now,
            destination = ends(focus.tripId, focus.reverse)?.second,
            guard = focus.arrivalGuard,
            window = arrivalWindow,
            sample = sample,
            monitoring = monitoringOverride ?: arrivalMonitoring,
            permissionPending = arrivalPermissionPending && data.useLocation,
            legacyCompleted = completed,
            cancelled = focus.journey.cancelled,
            matchingRefresh = matchingRefresh,
            resumeWaitUntilMs = arrivalResumeWaitUntil,
        ))
        arrivalWindow = result.window
        arrivalResult = result
        var updatedFocus = focus
        var changed = false
        if (result.guard != focus.arrivalGuard) {
            updatedFocus = focus.copy(arrivalGuard = result.guard)
            data = data.copy(focus = updatedFocus)
            changed = true
        }
        when (result.action) {
            ArrivalAction.Record, ArrivalAction.Correct -> {
                val rides = data.rides.settled(updatedFocus, true, ends(updatedFocus.tripId, updatedFocus.reverse))
                if (rides !== data.rides) { data = data.copy(rides = rides); changed = true }
            }
            ArrivalAction.Withdraw -> {
                val rides = data.rides.settled(updatedFocus, false, ends(updatedFocus.tripId, updatedFocus.reverse))
                if (rides !== data.rides) { data = data.copy(rides = rides); changed = true }
            }
            ArrivalAction.Expire -> {
                data = data.copy(focus = null, lastAnswer = data.lastAnswer?.takeUnless {
                    it.tripId == updatedFocus.tripId && it.reverse == updatedFocus.reverse
                })
                arrivalResult = null
                changed = true
                stopArrivalMonitoring(clearWindow = true)
            }
            ArrivalAction.None -> Unit
        }
        if (result.state == ArrivalState.Arrived) stopArrivalMonitoring(clearWindow = true)
        if (changed) persist()
        if (sync) syncPersonal()
    }

    private fun ensureArrivalMonitoring() {
        val focus = data.focus ?: return
        if (data.rides.any { it.tripId == focus.tripId && it.reverse == focus.reverse && it.departure == focus.journey.departure }) return
        if (arrivalMonitoring || !activityForeground || !data.useLocation || !mutable.value.locationGranted ||
            focus.journey.cancelled || mutable.value.now < focus.journey.effectiveDeparture ||
            arrivalResult?.state == ArrivalState.Arrived) return
        val identity = focusIdentity(focus)
        val started = onArrivalMonitoring?.invoke {
            if (data.focus?.let(::focusIdentity) != identity) return@invoke
            evaluateArrival(monitoringOverride = true)
        } == true
        if (data.focus?.let(::focusIdentity) != identity) return
        arrivalMonitoring = started
        if (!started) evaluateArrival()
    }

    fun arrivalLookupComplete() {
        arrivalResumeWaitUntil = null
        evaluateArrival()
    }

    fun arrivalLocation(value: Fix) {
        val receivedAt = System.currentTimeMillis()
        if (!data.useLocation || !arrivalMonitoring) return
        mutable.value = mutable.value.copy(now = receivedAt)
        evaluateArrival(ArrivalSample(value.lat, value.lon, value.at,
            value.accuracyMetres ?: Double.POSITIVE_INFINITY, value.speed))
        if (receivedAt - value.at in 0..300_000) fix = value
    }

    fun arrivalMonitoringFailed(status: SetupLocationStatus) {
        stopArrivalMonitoring(clearWindow = true)
        locationFailed(status)
        evaluateArrival()
    }

    private fun stopArrivalMonitoring(clearWindow: Boolean) {
        if (arrivalMonitoring) onLocationDisabled?.invoke()
        arrivalMonitoring = false
        if (clearWindow) {
            arrivalWindow = null
            arrivalResult = arrivalResult?.let { it.copy(window = ArrivalWindow(it.window.identity, emptyList())) }
        }
    }

    private fun resetArrivalTracking() {
        stopArrivalMonitoring(clearWindow = true)
        arrivalResult = null
        arrivalResumeWaitUntil = null
        if (activityForeground && mutable.value.locationGranted) ensureArrivalMonitoring()
    }
    fun permission(granted: Boolean, denied: Boolean) {
        mutable.value = mutable.value.copy(locationGranted = granted, locationDenied = denied,
            setupLocationStatus = if (granted && setupLocationRequested) SetupLocationStatus.Locating else mutable.value.setupLocationStatus)
        arrivalPermissionPending = false
        if (granted) ensureArrivalMonitoring() else {
            stopArrivalMonitoring(clearWindow = true)
            evaluateArrival()
        }
    }
    fun location(value: Fix) {
        // A fix can be newer than the last one-second render tick.
        val receivedAt = System.currentTimeMillis()
        if (!data.useLocation) return
        if (receivedAt - value.at !in 0..300_000) { locationFailed(SetupLocationStatus.Unavailable); return }
        mutable.value = mutable.value.copy(now = receivedAt)
        fix = value
        if (arrivalMonitoring) evaluateArrival(ArrivalSample(value.lat, value.lon, value.at,
            value.accuracyMetres ?: Double.POSITIVE_INFINITY, value.speed))
        if (mutable.value.screen !in setOf(Screen.Home, Screen.Setup)) return
        val choice = setupLocationChoice(stations, data.modes, value)
        mutable.value = mutable.value.copy(nearestStation = choice.stations.firstOrNull())
        if (mutable.value.screen == Screen.Setup) {
            if (mutable.value.selectingHome) return
            mutable.value = mutable.value.copy(nearbyStations = choice.stations)
            if (mutable.value.setupFrom == null && !setupOriginEdited && (setupLocationRequested || (data.trips.isEmpty() && !setupLocationResolved))) {
                mutable.value = mutable.value.copy(setupFrom = choice.automatic,
                    setupLocationStatus = when {
                        choice.automatic != null -> SetupLocationStatus.Idle
                        choice.stations.isEmpty() -> SetupLocationStatus.NoNearby
                        else -> SetupLocationStatus.ChooseStation
                    })
            }
            setupLocationRequested = false; setupLocationResolved = true
            return
        }
        val here = stationHere(data, stations, fix, mutable.value.now)
        val day = Instant.ofEpochMilli(mutable.value.now).atZone(Sydney).toLocalDate().toString()
        if (shouldCastHomeVote(mutable.value.screen, data.trips.isNotEmpty(), here, data.votes.any { it.day == day })) {
            data = data.copy(votes = (data.votes + HomeVote(day, requireNotNull(here))).takeLast(7)); persist()
        }
        val inferred = inferredFocus(data, value, mutable.value.now)?.takeIf { it.journey.withinTransferCap(data.maxTransfers) }
        if (inferred != null) { data = data.copy(focus = inferred); resetArrivalTracking(); persist(); ensureArrivalMonitoring() }
        if (!explicit && data.focus == null && here != null) {
            val home = data.home ?: automaticHome(data)
            val fromHere = data.trips.filter { compatible(it, data.modes) }.any { it.from.id == here.id || it.to.id == here.id }
            if (!fromHere && home != null && home.id != here.id && home.modes.any { it in data.modes }) {
                val trip = SavedTrip(UUID.randomUUID().toString(), here, home)
                data = data.copy(trips = data.trips + trip); persist()
                mutable.value = mutable.value.copy(justAddedTripId = trip.id)
            }
        }
        choosePrediction(); syncPersonal()
        val origin = visibleFocus()?.journey?.legs?.firstOrNull()?.from ?: ends()?.first
        mutable.value = mutable.value.copy(distanceMetres = origin?.let { distanceMetres(value, it).takeIf { d -> d.isFinite() }?.roundToInt() })
        refresh()
    }
    override fun back() {
        if (mutable.value.screen == Screen.Setup) cancelSetupLocation()
        historyJob?.cancel()
        val leavingSettings = mutable.value.screen == Screen.Settings
        val screen = when (mutable.value.screen) {
            Screen.Detail -> Screen.Board
            Screen.Settings -> settingsBack
            Screen.Setup -> if (mutable.value.selectingHome) Screen.Settings else Screen.Home
            else -> Screen.Home
        }
        if (mutable.value.screen == Screen.Setup) { redirect = null; redirectTargetId = null }
        mutable.value = mutable.value.copy(screen = screen, selectingHome = false,
            detail = if (screen == Screen.Detail) mutable.value.detail else null,
            feedbackSucceeded = if (leavingSettings) false else mutable.value.feedbackSucceeded)
        if (screen == Screen.Home) { historyRecorded = false; choosePrediction(); syncPersonal(); onSilentLocation?.invoke(); refresh() }
        if (screen == Screen.Board) scheduleHistory()
    }
    private fun cancelBoardSearch() {
        boardJob?.cancel(); earlierJob?.cancel(); generation++
        mutable.value = mutable.value.copy(refreshing = false)
    }
    override fun openTrip(id: String, reverse: Boolean) {
        val trip = data.trips.find { it.id == id } ?: return
        if (!compatible(trip, data.modes)) return
        explicit = true
        val direction = if (id == mutable.value.selectedTripId && !reverse) mutable.value.reverse else reverse
        mutable.value = mutable.value.copy(selectedTripId = id, reverse = direction, screen = Screen.Board,
            detail = null, receipt = null, justAddedTripId = null)
        syncPersonal(); historyRecorded = false; scheduleHistory(); refresh()
    }
    private fun scheduleHistory() {
        historyJob?.cancel(); historyJob = viewModelScope.launch { delay(5000); if (mutable.value.screen == Screen.Board) recordHistory() }
    }
    private fun recordHistory() {
        if (historyRecorded) return
        val id = mutable.value.selectedTripId ?: return; val reverse = mutable.value.reverse
        data = data.copy(history = (data.history + ViewEvent(id, reverse, mutable.value.now)).takeLast(500), lastTripId = id, lastReverse = reverse,
            trips = data.trips.map { if (it.id == id) it.copy(lastViewed = mutable.value.now) else it })
        historyRecorded = true; persist()
    }
    override fun openJourney(journey: Journey) {
        if (!journeyAllowed(journey, data.modes) || !journey.withinTransferCap(data.maxTransfers)) return
        cancelBoardSearch()
        if (mutable.value.screen == Screen.Home) {
            val focus = visibleFocus()
            val source = boardForOpenedJourney(focus, mutable.value.homeBoard, mutable.value.board, journey)
            val focused = focus?.takeIf { source?.from?.id == it.board.from.id && source.to.id == it.board.to.id }
            mutable.value = mutable.value.copy(board = source, selectedTripId = focused?.tripId ?: mutable.value.selectedTripId, reverse = focused?.reverse ?: mutable.value.reverse)
        }
        recordHistory(); mutable.value = mutable.value.copy(screen = Screen.Detail, detail = journey)
    }
    override fun pinJourney(journey: Journey) {
        if (!journeyAllowed(journey, data.modes) || !journey.withinTransferCap(data.maxTransfers)) return
        val id = mutable.value.selectedTripId ?: return; val board = mutable.value.board ?: return
        val pair = ends(id, mutable.value.reverse) ?: return
        if (board.from.id != pair.first.id || board.to.id != pair.second.id) return
        val source = board.copy(journeys = (listOf(journey) + board.journeys).distinctBy { it.key })
        var focus = FocusedJourney(id, mutable.value.reverse, journey, source)
        if (!source.isLive(mutable.value.now) && (journey.realtime || journey.cancelled)) focus = focus.lastKnown()
        data = data.copy(focus = focus, lastAnswer = null)
        resetArrivalTracking()
        persist(); historyRecorded = false; mutable.value = mutable.value.copy(screen = Screen.Home, detail = null); syncPersonal(); refresh()
    }
    override fun unpinJourney() { data = data.copy(focus = null, lastAnswer = null); resetArrivalTracking(); persist(); syncPersonal(); refresh() }
    override fun showReturn() {
        val focus = data.focus ?: return
        data = data.copy(focus = null, lastAnswer = null); resetArrivalTracking(); persist(); explicit = true; historyRecorded = false
        mutable.value = mutable.value.copy(selectedTripId = focus.tripId, reverse = !focus.reverse, screen = Screen.Home, board = null, homeBoard = null,
            receipt = "You rode out at ${clockTime(focus.journey.effectiveDeparture)}. Here’s the way back.")
        syncPersonal(); refresh()
    }
    override fun newTrip() {
        cancelBoardSearch()
        cancelSetupLocation(); setupOriginEdited = false; setupLocationResolved = false
        redirect = visibleFocus()?.takeIf { !it.pinned }
        redirectTargetId = null
        mutable.value = mutable.value.copy(screen = Screen.Setup, setupFrom = redirect?.let { redirectOrigin(it, data.trips) },
            setupTo = null, selectingHome = false)
    }
    override fun chooseSetupFrom(station: Station) { setupOriginQueryChanged(); mutable.value = mutable.value.copy(setupFrom = station) }
    override fun clearSetupFrom() { setupOriginQueryChanged(); mutable.value = mutable.value.copy(setupFrom = null, setupTo = null) }
    override fun chooseSetupTo(station: Station) { mutable.value = mutable.value.copy(setupTo = station) }
    override fun clearSetupTo() { mutable.value = mutable.value.copy(setupTo = null) }
    override fun saveTrip(from: Station, to: Station) {
        if (from.id == to.id) return
        val existing = data.trips.find { setOf(it.from.id, it.to.id) == setOf(from.id, to.id) }
        val trip = existing ?: SavedTrip(UUID.randomUUID().toString(), from, to)
        val reverse = existing?.to?.id == from.id
        data = data.copy(trips = if (existing == null) data.trips + trip else data.trips,
            recentFrom = (listOf(from) + data.recentFrom.filter { it.id != from.id }).take(3),
            recentTo = (listOf(to) + data.recentTo.filter { it.id != to.id }).take(3), lastTripId = trip.id, lastReverse = reverse)
        persist(); explicit = true; historyRecorded = false
        redirectTargetId = redirect?.let { trip.id }
        mutable.value = mutable.value.copy(screen = if (redirect == null) Screen.Home else Screen.Board,
            selectedTripId = trip.id, reverse = reverse, setupFrom = null, setupTo = null, board = null, receipt = null)
        syncPersonal(); refresh()
    }
    private fun resolveRedirect(board: BoardData) {
        val old = redirect ?: return
        val id = mutable.value.selectedTripId?.takeIf { it == redirectTargetId } ?: return
        redirect = null; redirectTargetId = null
        val match = board.journeys.firstOrNull { sameDeparture(old.journey, it) } ?: return
        data = data.copy(focus = FocusedJourney(id, mutable.value.reverse, match, board, pinned = false))
        resetArrivalTracking()
        mutable.value = mutable.value.copy(screen = Screen.Home)
        persist(); syncPersonal()
    }
    override fun deleteTrip(id: String) {
        val (remaining, pending) = data.beginDeletion(id) ?: return
        undoJob?.cancel(); expireDeletion()
        data = remaining; pendingDeletion = pending; persist()
        resetArrivalTracking()
        if (mutable.value.selectedTripId == id) { explicit = false; mutable.value = mutable.value.copy(board = null) }
        choosePrediction(); syncPersonal(); refresh()
        mutable.value = mutable.value.copy(message = deletionMessage(pending.trip), messageAutoDismiss = false, undoAvailable = true)
        undoJob = viewModelScope.launch { delay(undoTimeoutMillis()); expireDeletion() }
    }
    override fun undoDelete() {
        val pending = pendingDeletion ?: return
        undoJob?.cancel(); undoJob = null; pendingDeletion = null
        data = data.restore(pending); persist()
        mutable.value = mutable.value.copy(message = null, messageAutoDismiss = false, undoAvailable = false)
        choosePrediction(); syncPersonal(); refresh()
    }
    private fun expireDeletion() {
        val pending = pendingDeletion ?: return
        pendingDeletion = null
        viewModelScope.launch { store.removeCache(pending.trip) }
        if (mutable.value.message == deletionMessage(pending.trip)) message(null)
    }
    private fun undoTimeoutMillis(): Long {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return undoWindowMillis
        val manager = getApplication<Application>().getSystemService(AccessibilityManager::class.java) ?: return undoWindowMillis
        return manager.getRecommendedTimeoutMillis(undoWindowMillis.toInt(),
            AccessibilityManager.FLAG_CONTENT_TEXT or AccessibilityManager.FLAG_CONTENT_CONTROLS).toLong()
    }
    override fun openSettings() {
        cancelBoardSearch()
        settingsBack = mutable.value.screen
        mutable.value = mutable.value.copy(screen = Screen.Settings, feedbackSucceeded = false)
    }
    override fun setAppearance(value: Appearance) { data = data.copy(appearance = value); persist(); syncPersonal() }
    override fun setMode(mode: String, enabled: Boolean) {
        if (mode !in AllModes) return
        data = data.copy(modes = if (enabled) data.modes + mode else data.modes - mode); persist()
        resetArrivalTracking()
        mutable.value = mutable.value.copy(board = null, homeBoard = null)
        choosePrediction(); syncPersonal(); suppressNextLastAnswer = true; refresh()
    }
    override fun setTransferLimit(value: TransferLimit) {
        data = data.copy(transferLimit = value); persist()
        resetArrivalTracking()
        mutable.value = mutable.value.copy(board = null, homeBoard = null)
        choosePrediction(); syncPersonal(); suppressNextLastAnswer = true; refresh()
    }
    override fun setUseLocation(enabled: Boolean) {
        data = data.copy(useLocation = enabled)
        if (!enabled) { cancelSetupLocation(); stopArrivalMonitoring(clearWindow = true); fix = null; mutable.value = mutable.value.copy(distanceMetres = null, nearestStation = null) }
        persist(); syncPersonal(); if (enabled) { onLocationRequest?.invoke(); ensureArrivalMonitoring() } else { onLocationDisabled?.invoke(); choosePrediction(); refresh() }
    }
    override fun requestLocation() {
        if (mutable.value.screen == Screen.Setup && !mutable.value.selectingHome && mutable.value.setupFrom == null) {
            if (mutable.value.setupLocationStatus == SetupLocationStatus.Locating) return
            setupOriginEdited = false; setupLocationRequested = true
            mutable.value = mutable.value.copy(setupLocationStatus = SetupLocationStatus.Locating, nearbyStations = emptyList())
            if (!data.useLocation) { data = data.copy(useLocation = true); persist(); syncPersonal() }
        }
        if (data.useLocation) onLocationRequest?.invoke()
    }
    fun locationFailed(status: SetupLocationStatus) {
        if (setupLocationRequested && mutable.value.screen == Screen.Setup && !mutable.value.selectingHome && mutable.value.setupFrom == null) {
            mutable.value = mutable.value.copy(setupLocationStatus = status)
            if (status == SetupLocationStatus.Unavailable) { setupLocationRequested = false; setupLocationResolved = true }
        }
    }
    override fun setupOriginQueryChanged() {
        setupOriginEdited = true
        cancelSetupLocation()
    }
    private fun cancelSetupLocation() {
        setupLocationRequested = false
        mutable.value = mutable.value.copy(setupLocationStatus = SetupLocationStatus.Idle, nearbyStations = emptyList())
        onLocationDisabled?.invoke()
    }
    override fun chooseHome() { mutable.value = mutable.value.copy(screen = Screen.Setup, selectingHome = true, setupFrom = null, setupTo = null) }
    override fun setHome(station: Station?) { data = data.copy(home = station); persist(); mutable.value = mutable.value.copy(screen = Screen.Settings, selectingHome = false); syncPersonal() }
    override fun earlier() {
        if (earlierJob?.isActive == true) return
        val board = mutable.value.board ?: return
        val request = generation; val modes = data.modes.toSet()
        val earliest = board.journeys.minOfOrNull { it.departure } ?: mutable.value.now
        val bound = mutable.value.now - 24 * 60 * 60_000
        if (earliest <= bound || modes.isEmpty()) return
        val at = (earliest - 60 * 60_000).coerceAtLeast(bound)
        earlierJob = viewModelScope.launch {
            try {
                val past = supervisorScope {
                    val online = async { runCatching { api.departures(board.from, board.to, modes, at, data.maxTransfers) } }
                    val local = async { runCatching { initialized.await(); planner.plan(board.from, board.to, at, modes, 30, data.offlineMaxTransfers) } }
                    val onlineResult = online.await()
                    if (onlineResult.isSuccess) {
                        local.cancel()
                        onlineResult.getOrThrow()
                    } else local.await().getOrNull() ?: return@supervisorScope null
                } ?: return@launch
                if (request != generation || mutable.value.screen != Screen.Board) return@launch
                val current = mutable.value.board?.takeIf { it.from.id == board.from.id && it.to.id == board.to.id } ?: return@launch
                publishBoard(current.copy(journeys = mergeEarlier(current.journeys, past.journeys)), request)
            } catch (e: CancellationException) { throw e }
        }
    }
    override fun updateTimetable() {
        if (mutable.value.timetableUpdating) return
        mutable.value = mutable.value.copy(timetableUpdating = true)
        viewModelScope.launch {
            try {
                runCatching { initialized.await() }
                planner.update(api.baseUrl)
                if (!initialized.isCompleted || initialized.isCancelled) initialized = CompletableDeferred(Unit).also { it.complete(Unit) }
                mutable.value = mutable.value.copy(timetableStatus = planner.coverageDescription)
                refresh()
            }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { message("Couldn’t update timetables. Your saved timetable is still available. Try again when you’re online.") }
            finally { mutable.value = mutable.value.copy(timetableUpdating = false) }
        }
    }
    override fun feedback(text: String, category: String) {
        if (feedbackJob?.isActive == true) return
        feedbackJob = viewModelScope.launch {
            mutable.value = mutable.value.copy(feedbackSubmitting = true, feedbackSucceeded = false, message = null, undoAvailable = false)
            try {
                api.feedback(text, category)
                mutable.value = mutable.value.copy(feedbackSucceeded = true, feedbackDraft = "")
                message("Feedback sent. Thank you.", autoDismiss = true)
            }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { message("Couldn’t send feedback. Check your connection and try again.") }
            finally { mutable.value = mutable.value.copy(feedbackSubmitting = false) }
        }
    }
    override fun setFeedbackDraft(text: String) {
        if (mutable.value.feedbackSubmitting) return
        mutable.value = mutable.value.copy(feedbackDraft = text, feedbackSucceeded = false)
    }
    override fun setFeedbackCategory(category: String) {
        if (mutable.value.feedbackSubmitting) return
        if (category in setOf("problem", "suggestion", "other")) {
            mutable.value = mutable.value.copy(feedbackCategory = category, feedbackSucceeded = false)
        }
    }
    override fun dismissMessage() { message(null) }
}

internal fun List<Ride>.settled(focus: FocusedJourney, arrived: Boolean, ends: Pair<Station, Station>? = null): List<Ride> {
    val arrival = focus.journey.effectiveArrival
    val index = indexOfFirst { it.tripId == focus.tripId && it.reverse == focus.reverse && it.departure == focus.journey.departure }
    // A refreshed journey carries wire stations, so the endpoints come from the saved trip.
    if (index < 0) return if (!arrived) this else (this + Ride(focus.tripId, focus.reverse, focus.journey.departure, arrival,
        ends?.first ?: focus.journey.legs.first().from, ends?.second ?: focus.journey.legs.last().to)).takeLast(100)
    if (!arrived) return filterIndexed { i, _ -> i != index }
    if (arrival == this[index].arrival) return this
    return mapIndexed { i, ride -> if (i == index) ride.copy(arrival = arrival) else ride }
}
