package com.ilovetrains.app

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

val Sydney: ZoneId = ZoneId.of("Australia/Sydney")
val AllModes = setOf("train", "metro", "ferry")
const val TransferLimitFlag = "transferLimit"
const val TinyTrainFlag = "tiny_train"

enum class TransferLimit(val wire: String, val label: String, val maxTransfers: Int?) {
    Direct("direct", "Direct only", 0), Two("two", "Up to 2", 2), Any("any", "No limit", null);
    val next get() = when (this) { Direct -> Two; Two -> Any; Any -> Direct }
}
fun transferLimitOf(value: String?): TransferLimit = TransferLimit.entries.find { it.wire == value } ?: TransferLimit.Two

data class Station(val id: String, val name: String, val lat: Double = 0.0, val lon: Double = 0.0, val modes: Set<String> = AllModes) {
    val shortName: String get() = name.removeSuffix(" Station").removeSuffix(" Railway Station")
}
data class SavedTrip(val id: String, val from: Station, val to: Station, val createdAt: Long = System.currentTimeMillis(), val lastViewed: Long = 0, val lines: List<String> = emptyList())
data class TripIdentity(
    val source: String,
    val tripId: String,
    val serviceDate: String,
    val fromStopId: String,
    val toStopId: String,
    val fromSequence: Int? = null,
    val toSequence: Int? = null,
)
data class Leg(val line: String, val mode: String, val headsign: String, val from: Station, val to: Station,
    val departure: Long, val arrival: Long, val estimatedDeparture: Long? = null, val estimatedArrival: Long? = null,
    val fromPlatform: String? = null, val toPlatform: String? = null, val cancelled: Boolean = false,
    val identity: TripIdentity? = null) {
    val effectiveDeparture get() = estimatedDeparture ?: departure
    val effectiveArrival get() = estimatedArrival ?: arrival
}
data class Journey(val legs: List<Leg>, val retained: Boolean = false) {
    val key get() = legs.joinToString("|") { "${it.line}:${it.departure}" }
    val departure get() = legs.first().departure
    val arrival get() = legs.last().arrival
    val effectiveDeparture get() = legs.first().effectiveDeparture
    val effectiveArrival get() = legs.last().effectiveArrival
    val cancelled get() = legs.any { it.cancelled }
    val realtime get() = legs.any { it.estimatedDeparture != null || it.estimatedArrival != null }
    val mode get() = legs.first().mode
}
data class TransferConstraint(val maxTransfers: Int?)
data class BoardData(val from: Station, val to: Station, val journeys: List<Journey>, val generatedAt: Long,
    val source: String = "schedule", val offline: Boolean = false, val serverStale: Boolean = false,
    val coverage: String = "", val error: String? = null, val homeJourneyKey: String? = null,
    val fetchConstraint: TransferConstraint? = null,
    val recommendationPages: List<RecommendationPage> = emptyList(),
    val recommendation: RecommendationResult? = null) {
    fun isLive(now: Long) = source == "live" && !offline && !serverStale && now - generatedAt in 0..90_000
}
data class RecommendationPage(val at: Long, val body: BoardData, val serverStale: Boolean, val constraint: TransferConstraint)
data class RecommendationResult(val journey: Journey, val source: BoardData)
val UserData.maxTransfers get() = if (flags[TransferLimitFlag] == true) transferLimit.maxTransfers else null
val UserData.offlineMaxTransfers get() = if (flags[TransferLimitFlag] == true) transferLimit.maxTransfers ?: 4 else 2
fun Journey.withinTransferCap(maxTransfers: Int?) = maxTransfers == null || legs.size - 1 <= maxTransfers
fun BoardData.withinTransferCap(maxTransfers: Int?) = copy(
    journeys = journeys.filter { it.withinTransferCap(maxTransfers) },
    recommendation = recommendation?.takeIf { it.journey.withinTransferCap(maxTransfers) },
)
enum class Screen { Home, Board, Detail, Setup, Settings }
enum class Appearance { System, Dark, Light }
data class FocusedJourney(
    val tripId: String,
    val reverse: Boolean,
    val journey: Journey,
    val board: BoardData,
    val pinned: Boolean = true,
    val alternatives: BoardData? = null,
    val arrivalGuard: ArrivalGuard? = null,
)
data class ViewEvent(val tripId: String, val reverse: Boolean, val at: Long)
data class Ride(val tripId: String, val reverse: Boolean, val departure: Long, val arrival: Long,
    val from: Station? = null, val to: Station? = null)
data class HomeVote(val day: String, val station: Station)
data class AppState(
    val ready: Boolean = false, val screen: Screen = Screen.Home, val trips: List<SavedTrip> = emptyList(),
    val totalTrips: Int = trips.size,
    val selectedTripId: String? = null, val reverse: Boolean = false, val board: BoardData? = null,
    val homeBoard: BoardData? = null, val detail: Journey? = null, val focus: FocusedJourney? = null,
    val now: Long = System.currentTimeMillis(), val refreshing: Boolean = false,
    val appearance: Appearance = Appearance.System, val enabledModes: Set<String> = AllModes,
    // Null while the transferLimit flag is off, which is when Settings offers no choice.
    val transferLimit: TransferLimit? = null,
    val useLocation: Boolean = true, val locationGranted: Boolean = false, val locationDenied: Boolean = false,
    val distanceMetres: Int? = null, val receipt: String? = null, val home: Station? = null, val homeIsManual: Boolean = false,
    val automaticHome: Station? = null, val focusComplete: Boolean = false,
    val arrival: ArrivalResult? = null,
    val stations: List<Station> = emptyList(), val recentFrom: List<Station> = emptyList(), val recentTo: List<Station> = emptyList(),
    val setupFrom: Station? = null, val setupTo: Station? = null, val selectingHome: Boolean = false,
    val setupLocationStatus: SetupLocationStatus = SetupLocationStatus.Idle,
    val nearbyStations: List<Station> = emptyList(),
    val nearestStation: Station? = null, val justAddedTripId: String? = null,
    val timetableStatus: String = "Opening offline timetable", val timetableUpdating: Boolean = false,
    val tripMetadata: Map<String, String> = emptyMap(),
    val feedbackDraft: String = "", val feedbackCategory: String = "problem",
    val feedbackSubmitting: Boolean = false, val feedbackSucceeded: Boolean = false,
    val message: String? = null, val messageAutoDismiss: Boolean = false,
    val undoAvailable: Boolean = false, val version: String = BuildConfig.VERSION_NAME,
    val tinyTrain: Boolean = false
) {
    val selectedTrip get() = trips.find { it.id == selectedTripId }
    val shownBoard get() = if (screen == Screen.Home) homeBoard ?: board else board
}
interface UiActions {
    fun back()
    fun openTrip(id: String, reverse: Boolean = false)
    fun openJourney(journey: Journey)
    fun pinJourney(journey: Journey)
    fun unpinJourney()
    fun showReturn()
    fun newTrip()
    fun chooseSetupFrom(station: Station)
    fun setupOriginQueryChanged() {}
    fun clearSetupFrom()
    fun chooseSetupTo(station: Station)
    fun clearSetupTo()
    fun saveTrip(from: Station, to: Station)
    fun deleteTrip(id: String)
    fun undoDelete()
    fun openSettings()
    fun setAppearance(value: Appearance)
    fun setMode(mode: String, enabled: Boolean)
    fun setTransferLimit(value: TransferLimit)
    fun setUseLocation(enabled: Boolean)
    fun requestLocation()
    fun chooseHome()
    fun setHome(station: Station?)
    fun refresh()
    fun earlier()
    fun updateTimetable()
    fun setFeedbackDraft(text: String)
    fun setFeedbackCategory(category: String)
    fun feedback(text: String, category: String = "problem")
    fun dismissMessage()
}
fun clockTime(time: Long): String = DateTimeFormatter.ofPattern("HH:mm").withZone(Sydney).format(Instant.ofEpochMilli(time))
