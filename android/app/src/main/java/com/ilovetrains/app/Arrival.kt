package com.ilovetrains.app

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object ArrivalConstants {
    const val SampleInterval = 5_000L
    const val MaxAge = 30_000L
    const val FutureAllowance = 5_000L
    const val Window = 120_000L
    const val MaxSamples = 24
    const val MaxGap = 30_000L
    const val Checking = 180_000L
    const val Retention = 7_200_000L
    const val Expiry = 1_800_000L
}

enum class ArrivalState { Travelling, CheckingArrival, ArrivalUnconfirmed, Arrived, ExpiredUnconfirmed }
enum class ArrivalBasis { Location, Estimate }
enum class ArrivalAction { None, Record, Correct, Withdraw, Expire }

data class ArrivalGuard(
    val armed: Boolean? = null,
    val retainedAt: Long? = null,
    val basis: ArrivalBasis? = null,
    val confirmedAt: Long? = null,
)

data class ArrivalSample(
    val lat: Double,
    val lon: Double,
    val at: Long,
    val accuracy: Double,
    val speed: Double? = null,
)

data class ArrivalWindow(val identity: String, val samples: List<ArrivalSample>)

data class ArrivalInput(
    val identity: String?,
    val departureMs: Long,
    val arrivalMs: Long,
    val nowMs: Long,
    val destination: Station? = null,
    val guard: ArrivalGuard? = null,
    val window: ArrivalWindow? = null,
    val sample: ArrivalSample? = null,
    val monitoring: Boolean = false,
    val permissionPending: Boolean = false,
    val legacyCompleted: Boolean = false,
    val cancelled: Boolean = false,
    val matchingRefresh: Boolean = false,
    val resumeWaitUntilMs: Long? = null,
)

data class ArrivalResult(
    val state: ArrivalState,
    val basis: ArrivalBasis?,
    val guard: ArrivalGuard?,
    val window: ArrivalWindow,
    val away: Boolean,
    val moving: Boolean,
    val action: ArrivalAction,
)

fun validateArrivalSample(raw: ArrivalSample?, now: Long): ArrivalSample? {
    if (raw == null || !validPosition(raw) || raw.at > now + ArrivalConstants.FutureAllowance || raw.at < now - ArrivalConstants.MaxAge) return null
    val speed = raw.speed?.takeIf { it.isFinite() && it in 0.0..100.0 }
    return raw.copy(speed = speed)
}

fun reduceArrival(input: ArrivalInput): ArrivalResult {
    val identity = input.identity.orEmpty()
    var guard = normalizeArrivalGuard(input.guard)
    var samples = if (input.window?.identity == identity) input.window.samples.asSequence()
        .mapNotNull(::normalizeWindowSample)
        .filter { it.at >= input.nowMs - ArrivalConstants.Window && it.at <= input.nowMs + ArrivalConstants.FutureAllowance }
        .toList().takeLast(ArrivalConstants.MaxSamples) else emptyList()
    var accepted: ArrivalSample? = null
    validateArrivalSample(input.sample, input.nowMs)?.let { next ->
        if (samples.isEmpty() || next.at - samples.last().at >= ArrivalConstants.SampleInterval) {
            accepted = next
            samples = (samples + next).takeLast(ArrivalConstants.MaxSamples)
        }
    }
    val window = ArrivalWindow(identity, samples)
    fun result(
        state: ArrivalState,
        basis: ArrivalBasis? = null,
        action: ArrivalAction = ArrivalAction.None,
        away: Boolean = false,
        moving: Boolean = false,
    ) = ArrivalResult(state, basis, guard, window, away, moving, action)
    if (identity.isEmpty() || input.arrivalMs < input.departureMs) return result(ArrivalState.Travelling)

    var confirmed = guard?.basis == ArrivalBasis.Location && guard.confirmedAt?.let {
        it <= input.nowMs + ArrivalConstants.FutureAllowance
    } == true
    if (guard?.basis == ArrivalBasis.Location && !confirmed) {
        guard = guard.copy(basis = null, confirmedAt = null)
    }
    val legacy = input.legacyCompleted && guard == null
    if (!legacy && !confirmed && input.nowMs >= input.departureMs && (input.monitoring || accepted != null) && guard?.armed != true) {
        guard = (guard ?: ArrivalGuard()).copy(armed = true, retainedAt = input.nowMs)
    }
    if (guard?.armed == true) {
        val retained = guard.retainedAt ?: minOf(input.arrivalMs, input.nowMs)
        guard = guard.copy(retainedAt = minOf(retained, input.nowMs))
    }

    val last = samples.lastOrNull()
    val fresh = last != null && input.nowMs - last.at <= ArrivalConstants.MaxAge
    val distance = if (fresh) distance(last, input.destination) else null
    val away = distance != null && distance - last!!.accuracy >= 300
    val moving = away && (meanSpeed(samples, input.nowMs) ?: -1.0) >= 8
    fun near(sample: ArrivalSample): Boolean {
        val metres = distance(sample, input.destination) ?: return false
        return sample.accuracy <= 50 && metres + sample.accuracy <= 200
    }
    val useful = accepted?.let { sample -> near(sample) || ((distance(sample, input.destination) ?: Double.NEGATIVE_INFINITY) - sample.accuracy >= 300) } == true
    val retainedAt = guard?.retainedAt
    if (guard?.armed == true && retainedAt != null &&
        (useful || input.matchingRefresh && input.arrivalMs > input.nowMs) && input.nowMs - retainedAt >= 60_000) {
        guard = guard.copy(retainedAt = input.nowMs)
    }
    val expiryDeadline = if (guard?.armed == true && !confirmed && !legacy) {
        max(input.arrivalMs + ArrivalConstants.Expiry, requireNotNull(guard.retainedAt) + ArrivalConstants.Retention)
    } else input.arrivalMs + ArrivalConstants.Expiry
    val expired = input.nowMs > expiryDeadline && !(input.resumeWaitUntilMs?.let { input.nowMs < it } == true)
    if (input.cancelled) return result(if (expired) ArrivalState.ExpiredUnconfirmed else ArrivalState.Travelling,
        action = if (expired) ArrivalAction.Expire else if (input.legacyCompleted) ArrivalAction.Withdraw else ArrivalAction.None)
    if ((confirmed || legacy) && input.nowMs > input.arrivalMs + ArrivalConstants.Expiry) {
        return result(ArrivalState.ExpiredUnconfirmed, action = ArrivalAction.Expire)
    }
    if (confirmed) return result(ArrivalState.Arrived, ArrivalBasis.Location,
        if (input.legacyCompleted) ArrivalAction.Correct else ArrivalAction.Record)
    if (legacy && (!input.matchingRefresh || input.nowMs >= input.arrivalMs)) {
        return result(ArrivalState.Arrived, ArrivalBasis.Estimate, ArrivalAction.Correct)
    }

    val earliest = max(input.departureMs, input.arrivalMs - 300_000)
    val near = suffix(samples) { it.at >= earliest && near(it) }
    val speed = meanSpeed(near, input.nowMs)
    val lowSpeed = speed != null && speed <= 2
    var still = suffix(near) { it.speed == null || it.speed <= 2 }
    val boundary = still.indexOfLast { it.at <= (still.lastOrNull()?.at ?: 0) - 60_000 }
    if (boundary >= 0) still = still.drop(boundary)
    val stationary = fresh && still.size >= 4 && still.last().at - still.first().at >= 60_000 &&
        still.indices.all { index ->
            still.drop(index + 1).all { other -> (distance(still[index], other) ?: Double.POSITIVE_INFINITY) <= 50 }
        }
    if (guard?.armed == true && fresh && (lowSpeed || stationary)) {
        guard = guard.copy(basis = ArrivalBasis.Location, confirmedAt = input.nowMs)
        return result(ArrivalState.Arrived, ArrivalBasis.Location,
            if (input.legacyCompleted) ArrivalAction.Correct else ArrivalAction.Record)
    }

    if (input.nowMs < input.arrivalMs) {
        if (guard?.basis == ArrivalBasis.Estimate) guard = guard.copy(basis = null)
        return result(ArrivalState.Travelling, action = if (input.legacyCompleted) ArrivalAction.Withdraw else ArrivalAction.None,
            away = away, moving = moving)
    }
    if (expired) {
        return result(ArrivalState.ExpiredUnconfirmed, action = ArrivalAction.Expire)
    }
    if (guard?.armed != true && !input.permissionPending) {
        guard = (guard ?: ArrivalGuard()).copy(basis = ArrivalBasis.Estimate)
        return result(ArrivalState.Arrived, ArrivalBasis.Estimate,
            if (input.legacyCompleted) ArrivalAction.Correct else ArrivalAction.Record)
    }
    val state = if (away || input.nowMs >= input.arrivalMs + ArrivalConstants.Checking) {
        ArrivalState.ArrivalUnconfirmed
    } else ArrivalState.CheckingArrival
    return result(state, away = away, moving = moving)
}

private fun normalizeArrivalGuard(raw: ArrivalGuard?): ArrivalGuard? {
    raw ?: return null
    val basis = when {
        raw.basis == ArrivalBasis.Location && raw.confirmedAt != null -> ArrivalBasis.Location
        raw.basis == ArrivalBasis.Estimate -> ArrivalBasis.Estimate
        else -> null
    }
    val normalized = ArrivalGuard(raw.armed, raw.retainedAt, basis,
        raw.confirmedAt.takeIf { basis == ArrivalBasis.Location })
    return normalized.takeIf { it.armed != null || it.retainedAt != null || it.basis != null || it.confirmedAt != null }
}

private fun normalizeWindowSample(raw: ArrivalSample): ArrivalSample? {
    if (!validPosition(raw)) return null
    return raw.copy(speed = raw.speed?.takeIf { it.isFinite() && it in 0.0..100.0 })
}

private fun validPosition(sample: ArrivalSample): Boolean = sample.lat.isFinite() && sample.lon.isFinite() &&
    sample.accuracy.isFinite() && sample.lat in -90.0..90.0 && sample.lon in -180.0..180.0 && sample.accuracy > 0 && sample.accuracy <= 100

private fun suffix(samples: List<ArrivalSample>, predicate: (ArrivalSample) -> Boolean): List<ArrivalSample> {
    var start = samples.size
    for (index in samples.lastIndex downTo 0) {
        if (!predicate(samples[index]) || index < samples.lastIndex && samples[index + 1].at - samples[index].at > ArrivalConstants.MaxGap) break
        start = index
    }
    return samples.subList(start, samples.size)
}

private fun meanSpeed(samples: List<ArrivalSample>, now: Long): Double? {
    val valid = suffix(samples) { it.speed != null }
    if (valid.size < 3 || now - valid.last().at > ArrivalConstants.MaxAge || valid.last().at - valid.first().at < 30_000) return null
    var area = 0.0
    valid.zipWithNext().forEach { (first, second) ->
        area += (requireNotNull(first.speed) + requireNotNull(second.speed)) / 2 * (second.at - first.at)
    }
    return area / (valid.last().at - valid.first().at)
}

private fun distance(sample: ArrivalSample, station: Station?): Double? {
    if (station == null || station.lat == 0.0 && station.lon == 0.0) return null
    return distance(sample.lat, sample.lon, station.lat, station.lon)
}

private fun distance(first: ArrivalSample, second: ArrivalSample): Double? =
    distance(first.lat, first.lon, second.lat, second.lon)

private fun distance(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double? {
    if (!listOf(aLat, aLon, bLat, bLon).all(Double::isFinite)) return null
    val radians = Math.PI / 180
    val latitude = (bLat - aLat) * radians
    val longitude = (bLon - aLon) * radians
    val h = sin(latitude / 2).pow(2) + cos(aLat * radians) * cos(bLat * radians) * sin(longitude / 2).pow(2)
    return 6_371_000 * 2 * atan2(sqrt(h.coerceIn(0.0, 1.0)), sqrt((1 - h).coerceIn(0.0, 1.0)))
}
