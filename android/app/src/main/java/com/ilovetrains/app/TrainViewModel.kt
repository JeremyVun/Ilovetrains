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

class TrainViewModel @JvmOverloads constructor(application: Application, private val undoWindowMillis: Long = UndoWindowMillis) : AndroidViewModel(application), UiActions {
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
    private var initialized = CompletableDeferred<Unit>()
    var onLocationRequest: (() -> Unit)? = null
    var onSilentLocation: (() -> Unit)? = null
    var onLocationDisabled: (() -> Unit)? = null
    private var settingsBack = Screen.Home
    private var setupOriginEdited = false
    private var setupLocationRequested = false
    private var setupLocationResolved = false
    private var redirect: FocusedJourney? = null
    private var redirectTargetId: String? = null
    private var suppressNextLastAnswer = false
    private var hasResumed = false

    init {
        viewModelScope.launch {
            for (snapshot in writes) runCatching { store.save(snapshot) }.onFailure { message("Couldn’t save changes on this phone. Free some storage and try again.") }
        }
        viewModelScope.launch {
            data = store.load(); stations = runCatching { store.stations() }.getOrDefault(emptyList())
            syncPersonal(); choosePrediction()
            mutable.value = mutable.value.copy(ready = true, screen = if (data.trips.isEmpty()) Screen.Setup else Screen.Home, stations = stations)
            refresh()
            refreshSharedData()
            if (data.useLocation) onSilentLocation?.invoke()
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
    private fun message(text: String?, autoDismiss: Boolean = false) {
        mutable.value = mutable.value.copy(message = text, messageAutoDismiss = autoDismiss, undoAvailable = false)
    }
    private fun visibleFocus(): FocusedJourney? = visibleFocus(data, mutable.value.now)
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
            home = data.home ?: automaticHome(data), automaticHome = automaticHome(data), homeIsManual = data.home != null,
            recentFrom = data.recentFrom, recentTo = data.recentTo,
            tripMetadata = savedTripMetadata(data, fix, mutable.value.selectedTripId, mutable.value.reverse, mutable.value.now),
            homeBoard = focus?.board ?: mutable.value.board)
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
        mutable.value = mutable.value.copy(now = System.currentTimeMillis())
        refreshLoop = viewModelScope.launch {
            var ticks = 0
            if (mutable.value.ready) { choosePrediction(); refreshSharedData(); refresh(); if (data.useLocation) onSilentLocation?.invoke() }
            while (isActive) {
                delay(1000); mutable.value = mutable.value.copy(now = System.currentTimeMillis())
                if (++ticks % 30 == 0 && mutable.value.ready) { refreshSharedData(); refresh() }
                else if (data.focus != null && mutable.value.now >= data.focus!!.journey.effectiveArrival && !mutable.value.focusComplete
                    && data.focus!!.board.isLive(mutable.value.now)) settleFocus()
            }
        }
    }
    fun pause() {
        refreshLoop?.cancel(); refreshLoop = null; boardJob?.cancel(); earlierJob?.cancel(); focusJob?.cancel(); historyJob?.cancel(); realtimeJob?.cancel(); generation++
        mutable.value = mutable.value.copy(refreshing = false, distanceMetres = null, nearestStation = null)
        fix = null
    }
    private fun refreshSharedData() {
        val now = mutable.value.now
        if (now - lastRealtimeAttempt < 25_000 || realtimeJob?.isActive == true) return
        lastRealtimeAttempt = now
        realtimeJob = viewModelScope.launch {
            try {
                initialized.await()
                val fetched = try { planner.refreshRealtime(api.baseUrl); true }
                    catch (e: CancellationException) { throw e } catch (_: Exception) { false }
                val request = generation; val pair = ends(); val modes = data.modes.toSet()
                // Replanning on a failed fetch would republish the same rows from the realtime the app already had.
                if (fetched && pair != null && modes.isNotEmpty() && mutable.value.board?.isLive(mutable.value.now) != true) {
                    val local = planner.plan(pair.first, pair.second, mutable.value.now - 900_000, modes, 24)
                    if (local.journeys.isNotEmpty()) {
                        val prior = mutable.value.board?.takeIf { it.from.id == pair.first.id && it.to.id == pair.second.id }
                        publishBoard(mergeBoardResults(prior, local, null, mutable.value.now, requestFailed = false), request)
                    }
                }
                data.focus?.takeIf { it.journey.legs.all { l -> l.identity != null } }?.let { focus ->
                    val updated = try { planner.refreshFocused(focus.journey) }
                        catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                    if (data.focus?.let { it.tripId == focus.tripId && it.reverse == focus.reverse && it.journey.key == focus.journey.key } == true) {
                        val alternatives = try { planner.plan(focus.board.from, focus.board.to, mutable.value.now - 900_000, AllModes, 24) }
                            catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                        if (data.focus?.let { it.tripId == focus.tripId && it.reverse == focus.reverse && it.journey.key == focus.journey.key } != true) {
                            return@let
                        }
                        // The overlay demotes only a focus it still owns; refreshFocus may have handed it to the API.
                        val subject = if (updated?.live == true) focus else data.focus?.demotedForLostOverlay()
                        if (subject != null) data = data.copy(focus = focusAfterRefresh(subject, updated, alternatives))
                        settleFocus(judgeClock = updated?.live == true); persist(); syncPersonal()
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
        if (!mutable.value.ready) return
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
            val cached = store.cached(from, to, modes)
            if (request != generation) return@launch
            val previous = mutable.value.board?.takeIf { it.from.id == from.id && it.to.id == to.id } ?: cached
            if (mutable.value.board !== previous) {
                publishBoard(cached?.lastKnown(), request)
            }
            supervisorScope {
                val local = async {
                    try { initialized.await(); planner.plan(from, to, mutable.value.now - 15 * 60_000, modes, 24) }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { null }
                }
                val live = async {
                    try { api.departures(from, to, modes) }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { null }
                }
                val first = select<Pair<Boolean, BoardData?>> {
                    local.onAwait { false to it }
                    live.onAwait { true to it }
                }
                if (request != generation) return@supervisorScope
                if (first.second != null && (previous == null || !previous.isLive(mutable.value.now))) {
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
                val now = mutable.value.now
                val lead = nextHomeJourney(final, now)
                if (lead != null && selectedId != null) {
                    var changed = false
                    val orderedLines = lead.legs.map { it.line }.distinct()
                    data = data.copy(trips = data.trips.map {
                        if (it.id == selectedId && it.lines != orderedLines) { changed = true; it.copy(lines = orderedLines) } else it
                    })
                    val evidence = shownLeadEvidence(final, listOfNotNull(result, localResult), now,
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
    private fun publishBoard(board: BoardData?, request: Long) {
        if (generation != request) return
        val detail = mutable.value.detail?.let { old -> board?.journeys?.find { it.key == old.key } ?: old.copy(retained = true) }
        val remembered = board?.copy(homeJourneyKey = nextHomeJourney(board, mutable.value.now)?.key)
        mutable.value = mutable.value.copy(board = remembered, homeBoard = visibleFocus()?.board ?: remembered, detail = detail)
    }
    private fun refreshFocus() {
        val focus = data.focus ?: return
        focusJob?.cancel()
        focusJob = viewModelScope.launch {
            val pair = ends(focus.tripId, focus.reverse) ?: return@launch
            val at = focus.journey.departure.takeIf { it < mutable.value.now }
            val result = try { api.departures(pair.first, pair.second, AllModes, at) } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            if (data.focus?.journey?.key != focus.journey.key || data.focus?.tripId != focus.tripId || data.focus?.reverse != focus.reverse) return@launch
            val match = result?.journeys?.find { it.key == focus.journey.key }
            if (match != null) data = data.copy(focus = focus.copy(journey = match, board = result, alternatives = null))
            else focus.demotedForUnmatchedBoard()?.let { data = data.copy(focus = it) }
            settleFocus(); persist(); syncPersonal()
        }
    }
    private fun settleFocus(judgeClock: Boolean = true) {
        val now = mutable.value.now
        var focus = data.focus ?: return
        if (!focus.board.isLive(now) && !focus.journey.retained && (focus.journey.realtime || focus.journey.cancelled)) {
            focus = focus.lastKnown()
            data = data.copy(focus = focus)
            persist()
        }
        if (!focus.journey.cancelled) settleRide(focus, (judgeClock && now >= focus.journey.effectiveArrival) || arrivedByFix(focus, now))
        if (now > focus.journey.effectiveArrival + 1_800_000) { data = data.copy(focus = null); persist() }
        syncPersonal()
    }
    private fun arrivedByFix(focus: FocusedJourney, now: Long): Boolean {
        val destination = ends(focus.tripId, focus.reverse)?.second ?: return false
        val at = fix ?: return false
        return now >= focus.journey.effectiveArrival - 300_000 && distanceMetres(at, destination) <= 200
    }
    private fun settleRide(focus: FocusedJourney, arrived: Boolean) {
        val rides = data.rides.settled(focus, arrived, ends(focus.tripId, focus.reverse))
        if (rides === data.rides) return
        data = data.copy(rides = rides); persist()
    }
    fun permission(granted: Boolean, denied: Boolean) {
        mutable.value = mutable.value.copy(locationGranted = granted, locationDenied = denied,
            setupLocationStatus = if (granted && setupLocationRequested) SetupLocationStatus.Locating else mutable.value.setupLocationStatus)
    }
    fun location(value: Fix) {
        // A fix can be newer than the last one-second render tick.
        val receivedAt = System.currentTimeMillis()
        if (!data.useLocation || mutable.value.screen !in setOf(Screen.Home, Screen.Setup)) return
        if (receivedAt - value.at !in 0..300_000) { locationFailed(SetupLocationStatus.Unavailable); return }
        mutable.value = mutable.value.copy(now = receivedAt)
        fix = value
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
        val inferred = inferredFocus(data, value, mutable.value.now)
        if (inferred != null) { data = data.copy(focus = inferred); persist() }
        data.focus?.let { f -> if (arrivedByFix(f, mutable.value.now)) settleRide(f, arrived = true) }
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
        if (mutable.value.screen == Screen.Home) {
            val focus = visibleFocus()
            val source = boardForOpenedJourney(focus, mutable.value.homeBoard, mutable.value.board, journey)
            val focused = focus?.takeIf { source?.from?.id == it.board.from.id && source.to.id == it.board.to.id }
            mutable.value = mutable.value.copy(board = source, selectedTripId = focused?.tripId ?: mutable.value.selectedTripId, reverse = focused?.reverse ?: mutable.value.reverse)
        }
        recordHistory(); mutable.value = mutable.value.copy(screen = Screen.Detail, detail = journey)
    }
    override fun pinJourney(journey: Journey) {
        val id = mutable.value.selectedTripId ?: return; val board = mutable.value.board ?: return
        val pair = ends(id, mutable.value.reverse) ?: return
        if (board.from.id != pair.first.id || board.to.id != pair.second.id) return
        val source = board.copy(journeys = (listOf(journey) + board.journeys).distinctBy { it.key })
        var focus = FocusedJourney(id, mutable.value.reverse, journey, source)
        if (!source.isLive(mutable.value.now) && (journey.realtime || journey.cancelled)) focus = focus.lastKnown()
        data = data.copy(focus = focus, lastAnswer = null)
        persist(); historyRecorded = false; mutable.value = mutable.value.copy(screen = Screen.Home, detail = null); syncPersonal(); refresh()
    }
    override fun unpinJourney() { data = data.copy(focus = null, lastAnswer = null); persist(); syncPersonal(); refresh() }
    override fun showReturn() {
        val focus = data.focus ?: return
        data = data.copy(focus = null, lastAnswer = null); persist(); explicit = true; historyRecorded = false
        mutable.value = mutable.value.copy(selectedTripId = focus.tripId, reverse = !focus.reverse, screen = Screen.Home, board = null, homeBoard = null,
            receipt = "You rode out at ${clockTime(focus.journey.effectiveDeparture)}. Here’s the way back.")
        syncPersonal(); refresh()
    }
    override fun newTrip() {
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
        mutable.value = mutable.value.copy(screen = Screen.Home)
        persist(); syncPersonal()
    }
    override fun deleteTrip(id: String) {
        val (remaining, pending) = data.beginDeletion(id) ?: return
        undoJob?.cancel(); expireDeletion()
        data = remaining; pendingDeletion = pending; persist()
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
        settingsBack = mutable.value.screen
        mutable.value = mutable.value.copy(screen = Screen.Settings, feedbackSucceeded = false)
    }
    override fun setAppearance(value: Appearance) { data = data.copy(appearance = value); persist(); syncPersonal() }
    override fun setMode(mode: String, enabled: Boolean) {
        if (mode !in AllModes) return
        data = data.copy(modes = if (enabled) data.modes + mode else data.modes - mode); persist()
        mutable.value = mutable.value.copy(board = null, homeBoard = null)
        choosePrediction(); syncPersonal(); suppressNextLastAnswer = true; refresh()
    }
    override fun setUseLocation(enabled: Boolean) {
        data = data.copy(useLocation = enabled)
        if (!enabled) { cancelSetupLocation(); fix = null; mutable.value = mutable.value.copy(distanceMetres = null, nearestStation = null) }
        persist(); syncPersonal(); if (enabled) onLocationRequest?.invoke() else { onLocationDisabled?.invoke(); choosePrediction(); refresh() }
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
                    val online = async { runCatching { api.departures(board.from, board.to, modes, at) } }
                    val local = async { runCatching { initialized.await(); planner.plan(board.from, board.to, at, modes, 30) } }
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
    if (arrival == this[index].arrival) return this
    return if (arrived) mapIndexed { i, ride -> if (i == index) ride.copy(arrival = arrival) else ride }
    else filterIndexed { i, _ -> i != index }
}
