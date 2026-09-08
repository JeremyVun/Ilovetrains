package com.ilovetrains.app

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max

enum class TravelTrackerStage { Boarding, Ride, Transfer, Final, MissedTransfer }
enum class TravelTrackerEventKind { Departure, Arrival, Cancellation, MissedConnection }
enum class TravelTrackerPlatformRole { Alight, Board }
enum class TravelTrackerFreshness { Live, Retained, Offline, Stale, Scheduled }
enum class TravelTrackerSegmentKind { Ride, Gap }

data class TravelTrackerIdentity(
    val tripId: String,
    val reverse: Boolean,
    val serviceKey: String,
)

data class TravelTrackerRevision(val identity: TravelTrackerIdentity, val generation: Long) {
    fun canReplace(current: TravelTrackerRevision): Boolean = identity == current.identity && generation >= current.generation
}

data class TravelTrackerHeadline(val lead: String, val emphasis: String? = null, val tail: String = "") {
    val text get() = lead + (emphasis ?: "") + tail
}

data class TravelTrackerEvent(
    val kind: TravelTrackerEventKind,
    val name: String,
    val deadline: Long,
    val countdownMinutes: Int?,
)

data class TravelTrackerPlatform(
    val role: TravelTrackerPlatformRole,
    val legIndex: Int,
    val mode: String,
    val stationId: String,
    val stationName: String,
    val label: String,
)

data class TravelTrackerMissedConnection(
    val fromLegIndex: Int,
    val toLegIndex: Int,
    val line: String,
    val arrival: Long,
    val departure: Long,
    val arrivalStationId: String,
    val arrivalStationName: String,
    val departureStationId: String,
    val departureStationName: String,
)

data class TravelTrackerSegment(
    val kind: TravelTrackerSegmentKind,
    val legIndex: Int,
    val line: String?,
    val mode: String?,
    val start: Long,
    val end: Long,
    val startFraction: Double,
    val endFraction: Double,
) {
    val lengthFraction get() = max(0.0, endFraction - startFraction)
}

data class TravelTrackerState(
    val revision: TravelTrackerRevision,
    val stage: TravelTrackerStage,
    val activeLegIndex: Int,
    val event: TravelTrackerEvent,
    val headline: TravelTrackerHeadline,
    val instruction: String,
    val platforms: List<TravelTrackerPlatform>,
    val connection: String?,
    val tightConnection: Boolean,
    val missedConnection: TravelTrackerMissedConnection?,
    val destination: String,
    val eta: Long,
    val etaText: String,
    val segments: List<TravelTrackerSegment>,
    val progress: Double,
    val freshness: TravelTrackerFreshness,
    val provenance: String,
    val retained: Boolean,
    val cancelled: Boolean,
    val arrivalCancelled: Boolean,
    val nextBoundary: Long,
    val freshUntil: Long?,
) {
    companion object {
        fun derive(focus: FocusedJourney, now: Long, generation: Long): TravelTrackerState? {
            val legs = focus.journey.legs
            if (legs.isEmpty()) return null
            val projectionEnd = legs.maxOf { it.effectiveArrival }
            if (now >= projectionEnd) return null

            val identity = TravelTrackerIdentity(focus.tripId, focus.reverse, focus.journey.key)
            val revision = TravelTrackerRevision(identity, generation)
            val missedIndex = (0 until legs.lastIndex).firstOrNull {
                legs[it].effectiveArrival > legs[it + 1].effectiveDeparture
            }
            val missed = missedIndex?.let { trackerMissedConnection(legs, it) }
            val position = trackerPosition(legs, now, missedIndex, projectionEnd)
            val last = legs.last()
            val destination = last.to.shortName
            val cancelledIndex = legs.indexOfFirst { it.cancelled }.takeIf { it >= 0 }
            val cancelledLeg = cancelledIndex?.let(legs::get)
            val platformRoles = trackerPlatforms(legs, position, missedIndex)
            val event: TravelTrackerEvent
            val headline: TravelTrackerHeadline
            val instruction: String
            val connection: String?
            val tight: Boolean

            if (cancelledLeg != null) {
                val name = cancelledLeg.line.ifBlank { trackerVehicle(cancelledLeg.mode) }
                event = TravelTrackerEvent(TravelTrackerEventKind.Cancellation, name, cancelledLeg.effectiveDeparture, null)
                headline = TravelTrackerHeadline("$name cancelled")
                instruction = "${trackerClock(cancelledLeg.effectiveDeparture)} from ${cancelledLeg.from.shortName} cancelled."
                connection = null
                tight = false
            } else {
                val built = trackerCopy(legs, position, now, missed)
                event = built.event
                headline = built.headline
                instruction = built.instruction
                connection = built.connection
                tight = built.tight
            }

            val source = trackerFreshness(focus, now)
            return TravelTrackerState(
                revision = revision,
                stage = position.stage,
                activeLegIndex = position.legIndex,
                event = event,
                headline = headline,
                instruction = instruction,
                platforms = platformRoles,
                connection = connection,
                tightConnection = tight,
                missedConnection = missed,
                destination = destination,
                eta = last.effectiveArrival,
                etaText = (if (missed == null) "about " else "Planned ") + trackerClock(last.effectiveArrival),
                segments = trackerSegments(legs, projectionEnd),
                progress = trackerProgress(legs, now, projectionEnd),
                freshness = source.first,
                provenance = trackerProvenance(focus, source.first),
                retained = focus.journey.retained,
                cancelled = cancelledLeg != null,
                arrivalCancelled = last.cancelled,
                nextBoundary = position.boundary,
                freshUntil = source.second,
            )
        }
    }
}

private data class TrackerPosition(val stage: TravelTrackerStage, val legIndex: Int, val boundary: Long)

private fun trackerPosition(legs: List<Leg>, now: Long, missedIndex: Int?, projectionEnd: Long): TrackerPosition {
    if (now < legs.first().effectiveDeparture) {
        return TrackerPosition(TravelTrackerStage.Boarding, 0, legs.first().effectiveDeparture)
    }
    legs.forEachIndexed { index, leg ->
        if (now < leg.effectiveArrival) {
            return TrackerPosition(
                if (index == legs.lastIndex) TravelTrackerStage.Final else TravelTrackerStage.Ride,
                index,
                leg.effectiveArrival,
            )
        }
        if (index == missedIndex) {
            return TrackerPosition(TravelTrackerStage.MissedTransfer, index, projectionEnd)
        }
        val next = legs.getOrNull(index + 1)
        if (next != null && now < next.effectiveDeparture) {
            return TrackerPosition(TravelTrackerStage.Transfer, index + 1, next.effectiveDeparture)
        }
    }
    return TrackerPosition(TravelTrackerStage.Final, legs.lastIndex, legs.last().effectiveArrival)
}

private data class TrackerCopy(
    val event: TravelTrackerEvent,
    val headline: TravelTrackerHeadline,
    val instruction: String,
    val connection: String?,
    val tight: Boolean,
)

private fun trackerCopy(
    legs: List<Leg>,
    position: TrackerPosition,
    now: Long,
    missed: TravelTrackerMissedConnection?,
): TrackerCopy {
    val leg = legs[position.legIndex]
    val countdown = max(0, trackerMinutes(now, position.boundary))
    val emphasis = trackerCountdownText(countdown)
    return when (position.stage) {
        TravelTrackerStage.Boarding -> {
            val name = leg.line.ifBlank { trackerVehicle(leg.mode) }
            TrackerCopy(
                TravelTrackerEvent(TravelTrackerEventKind.Departure, name, position.boundary, countdown),
                TravelTrackerHeadline("$name leaves in ", emphasis),
                trackerBoardInstruction(leg),
                "Departs ${trackerClock(leg.effectiveDeparture)}",
                false,
            )
        }
        TravelTrackerStage.Ride -> {
            val next = legs[position.legIndex + 1]
            val changeMinutes = trackerMinutes(leg.effectiveArrival, next.effectiveDeparture)
            if (missed?.fromLegIndex == position.legIndex) {
                return TrackerCopy(
                    TravelTrackerEvent(TravelTrackerEventKind.Arrival, leg.to.shortName, position.boundary, countdown),
                    TravelTrackerHeadline("${leg.to.shortName} in ", emphasis),
                    trackerAlightInstruction(leg),
                    "${missed.line} departs ${trackerClock(missed.departure)} before arrival",
                    false,
                )
            }
            val tight = changeMinutes < 5
            TrackerCopy(
                TravelTrackerEvent(TravelTrackerEventKind.Arrival, leg.to.shortName, position.boundary, countdown),
                TravelTrackerHeadline("${leg.to.shortName} in ", emphasis),
                trackerRideInstruction(leg, next),
                when {
                    changeMinutes < 0 -> "${next.line.ifBlank { trackerVehicle(next.mode) }} departs ${trackerClock(next.effectiveDeparture)} before arrival"
                    changeMinutes < 5 -> "Tight change · ${next.line.ifBlank { trackerVehicle(next.mode) }} departs ${trackerClock(next.effectiveDeparture)}"
                    else -> "$changeMinutes min to change"
                },
                tight,
            )
        }
        TravelTrackerStage.Transfer -> {
            val name = leg.line.ifBlank { trackerVehicle(leg.mode) }
            val prior = legs[position.legIndex - 1]
            val changeMinutes = trackerMinutes(prior.effectiveArrival, leg.effectiveDeparture)
            val tight = changeMinutes < 5
            TrackerCopy(
                TravelTrackerEvent(TravelTrackerEventKind.Departure, name, position.boundary, countdown),
                TravelTrackerHeadline("$name leaves in ", emphasis),
                trackerBoardInstruction(leg),
                (if (tight) "Tight change · departs " else "Departs ") + trackerClock(leg.effectiveDeparture),
                tight,
            )
        }
        TravelTrackerStage.Final -> TrackerCopy(
            TravelTrackerEvent(TravelTrackerEventKind.Arrival, leg.to.shortName, position.boundary, countdown),
            TravelTrackerHeadline("${leg.to.shortName} in ", emphasis),
            trackerFinalInstruction(leg),
            null,
            false,
        )
        TravelTrackerStage.MissedTransfer -> {
            requireNotNull(missed)
            TrackerCopy(
                TravelTrackerEvent(TravelTrackerEventKind.MissedConnection, missed.line, missed.departure, null),
                TravelTrackerHeadline("${missed.line} connection unavailable"),
                "${missed.line} departure ${trackerClock(missed.departure)} is before the ${trackerClock(missed.arrival)} arrival.",
                null,
                false,
            )
        }
    }
}

private fun trackerPlatforms(legs: List<Leg>, position: TrackerPosition, missedIndex: Int?): List<TravelTrackerPlatform> {
    val roles = mutableListOf<TravelTrackerPlatform>()
    when (position.stage) {
        TravelTrackerStage.Boarding, TravelTrackerStage.Transfer -> {
            val leg = legs[position.legIndex]
            trackerPlatform(leg.fromPlatform, leg.mode)?.let {
                roles += TravelTrackerPlatform(TravelTrackerPlatformRole.Board, position.legIndex, leg.mode, leg.from.id, leg.from.shortName, it)
            }
        }
        TravelTrackerStage.Ride -> {
            val leg = legs[position.legIndex]
            val next = legs[position.legIndex + 1]
            trackerPlatform(leg.toPlatform, leg.mode)?.let {
                roles += TravelTrackerPlatform(TravelTrackerPlatformRole.Alight, position.legIndex, leg.mode, leg.to.id, leg.to.shortName, it)
            }
            if (position.legIndex != missedIndex) {
                trackerPlatform(next.fromPlatform, next.mode)?.let {
                    roles += TravelTrackerPlatform(TravelTrackerPlatformRole.Board, position.legIndex + 1, next.mode, next.from.id, next.from.shortName, it)
                }
            }
        }
        TravelTrackerStage.Final -> {
            val leg = legs[position.legIndex]
            trackerPlatform(leg.toPlatform, leg.mode)?.let {
                roles += TravelTrackerPlatform(TravelTrackerPlatformRole.Alight, position.legIndex, leg.mode, leg.to.id, leg.to.shortName, it)
            }
        }
        TravelTrackerStage.MissedTransfer -> Unit
    }
    return roles
}

private fun trackerBoardInstruction(leg: Leg): String {
    val destination = leg.headsign.ifBlank { leg.to.shortName }
    val place = trackerPlatform(leg.fromPlatform, leg.mode)
    return if (place == null) "Go to ${leg.from.shortName} for $destination."
    else "Go to $place for $destination."
}

private fun trackerRideInstruction(leg: Leg, next: Leg): String {
    val alight = trackerPlatform(leg.toPlatform, leg.mode)
    val board = trackerPlatform(next.fromPlatform, next.mode)
    val first = if (alight == null) "Get off at ${leg.to.shortName}" else "Get off ${trackerPlacePreposition(leg.mode)} $alight"
    val service = next.line.ifBlank { trackerVehicle(next.mode) }
    val crossHub = leg.to.id != next.from.id
    val second = if (board == null) "then take $service from ${next.from.shortName}"
        else if (crossHub) "then take $service from $board at ${next.from.shortName}"
        else "then take $service from $board"
    return "$first, $second."
}

private fun trackerFinalInstruction(leg: Leg): String {
    val place = trackerPlatform(leg.toPlatform, leg.mode)
    if (place != null) return "Get off ${trackerPlacePreposition(leg.mode)} $place."
    return "Get off at ${leg.to.shortName}."
}

private fun trackerAlightInstruction(leg: Leg): String {
    val place = trackerPlatform(leg.toPlatform, leg.mode)
    return if (place == null) "Get off at ${leg.to.shortName}."
    else "Get off ${trackerPlacePreposition(leg.mode)} $place."
}

private fun trackerMissedConnection(legs: List<Leg>, index: Int): TravelTrackerMissedConnection {
    val before = legs[index]
    val after = legs[index + 1]
    return TravelTrackerMissedConnection(
        fromLegIndex = index,
        toLegIndex = index + 1,
        line = after.line.ifBlank { trackerVehicle(after.mode) },
        arrival = before.effectiveArrival,
        departure = after.effectiveDeparture,
        arrivalStationId = before.to.id,
        arrivalStationName = before.to.shortName,
        departureStationId = after.from.id,
        departureStationName = after.from.shortName,
    )
}

private fun trackerPlacePreposition(mode: String) = if (mode.equals("ferry", true)) "at" else "on"

private fun trackerPlatform(raw: String?, mode: String): String? {
    val value = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val place = if (mode.equals("ferry", true)) "Wharf" else "Platform"
    if (Regex("\\b$place\\b", RegexOption.IGNORE_CASE).containsMatchIn(value)) return value
    if (place == "Wharf" && value.startsWith("Side", ignoreCase = true)) return value
    return "$place $value"
}

private fun trackerVehicle(mode: String): String = when (mode.lowercase(Locale.ENGLISH)) {
    "ferry" -> "Ferry"
    "metro" -> "Metro"
    else -> "Train"
}

private fun trackerSegments(legs: List<Leg>, projectionEnd: Long): List<TravelTrackerSegment> {
    val start = legs.first().effectiveDeparture
    val duration = max(1L, projectionEnd - start).toDouble()
    fun fraction(time: Long) = ((time - start) / duration).coerceIn(0.0, 1.0)
    return buildList {
        legs.forEachIndexed { index, leg ->
            add(TravelTrackerSegment(
                TravelTrackerSegmentKind.Ride, index, leg.line, leg.mode,
                leg.effectiveDeparture, leg.effectiveArrival,
                fraction(leg.effectiveDeparture), fraction(leg.effectiveArrival),
            ))
            legs.getOrNull(index + 1)?.let { next ->
                add(TravelTrackerSegment(
                    TravelTrackerSegmentKind.Gap, index, null, null,
                    leg.effectiveArrival, next.effectiveDeparture,
                    fraction(leg.effectiveArrival), fraction(next.effectiveDeparture),
                ))
            }
        }
    }
}

private fun trackerProgress(legs: List<Leg>, now: Long, projectionEnd: Long): Double {
    val start = legs.first().effectiveDeparture
    val duration = max(1L, projectionEnd - start).toDouble()
    return ((now - start) / duration).coerceIn(0.0, 1.0)
}

private fun trackerFreshness(focus: FocusedJourney, now: Long): Pair<TravelTrackerFreshness, Long?> {
    val board = focus.board
    val retained = focus.journey.retained
    val eligible = board.source == "live" && !board.offline && !board.serverStale && !retained && board.generatedAt <= now
    val until = board.generatedAt.takeIf { eligible && now - it in 0..90_000 }?.plus(90_000)
    val freshness = when {
        board.offline -> TravelTrackerFreshness.Offline
        retained -> TravelTrackerFreshness.Retained
        board.source != "live" -> TravelTrackerFreshness.Scheduled
        board.serverStale || board.generatedAt > now || now - board.generatedAt > 90_000 -> TravelTrackerFreshness.Stale
        else -> TravelTrackerFreshness.Live
    }
    return freshness to until
}

private fun trackerProvenance(focus: FocusedJourney, freshness: TravelTrackerFreshness): String = when (freshness) {
    TravelTrackerFreshness.Live -> "Live"
    TravelTrackerFreshness.Offline -> if (focus.board.source == "live") {
        "Offline · Last updated ${trackerClock(focus.board.generatedAt)}"
    } else "Offline · timetable"
    TravelTrackerFreshness.Retained -> "Last known · Last updated ${trackerClock(focus.board.generatedAt)}"
    TravelTrackerFreshness.Stale -> "Last updated ${trackerClock(focus.board.generatedAt)}"
    TravelTrackerFreshness.Scheduled -> "Scheduled"
}

private fun trackerMinutes(from: Long, to: Long): Int = ((to / 60_000) - (from / 60_000)).toInt()

private fun trackerCountdownText(minutes: Int): String = if (minutes > 99) {
    "${kotlin.math.round(minutes / 60.0).toInt()} hr."
} else "$minutes min."

private fun trackerClock(time: Long): String = DateTimeFormatter.ofPattern("HH:mm")
    .withZone(Sydney).format(Instant.ofEpochMilli(time))
