package com.ilovetrains.app

// About 30 km/h: faster than anyone walks or runs on a platform.
const val TrainSpeedMps = 8.0
// Gadigal is 152 m from Town Hall's point, so a saved station's footprint must beat a stranger's 200 m.
const val SavedStationMetres = 400.0
const val AtStationMetres = 200.0
const val NearStationMetres = 2_000.0
// Platforms reach about 150 m from a station's point, and a Home fix may be 200 m inaccurate.
const val SightingMetres = 300.0
const val PreviousFixMinMillis = 15_000L
const val PreviousFixMaxMillis = 120_000L

/** [tier] 1 is standing at the station, 2 a saved end within 2 km, 3 any station within 2 km. */
data class Here(val station: Station, val tier: Int)

fun previousFixUsable(fix: Fix, previous: Fix?): Boolean =
    previous != null && fix.at - previous.at in PreviousFixMinMillis..PreviousFixMaxMillis

private fun Double?.known(): Double? = this?.takeIf { it.isFinite() && it >= 0 }

// Without a usable speed, only a displacement no position error could produce counts.
fun trainSpeed(fix: Fix?, previous: Fix? = null): Boolean {
    fix ?: return false
    fix.speed.known()?.let { return it >= TrainSpeedMps }
    if (previous == null || !previousFixUsable(fix, previous)) return false
    val accuracy = fix.accuracyMetres.known() ?: return false
    val previousAccuracy = previous.accuracyMetres.known() ?: return false
    return distanceMetres(fix, previous) >= TrainSpeedMps * (fix.at - previous.at) / 1000 + accuracy + previousAccuracy
}

/**
 * Where the phone is, as a station: the nearest saved end within 400 m, else any station within 200 m, else the
 * nearest saved end within 2 km, else the nearest station within 2 km. A phone at train speed is passing stations.
 */
fun here(data: UserData, stations: List<Station>, fix: Fix?, now: Long, previousFix: Fix? = null): Here? {
    if (!data.useLocation || fix == null || now - fix.at !in 0..300_000 || trainSpeed(fix, previousFix)) return null
    val saved = data.trips.flatMap { listOf(it.from, it.to) }.map { s -> stations.find { it.id == s.id } ?: s }.distinctBy { it.id }
        .filter { s -> s.modes.any { it in data.modes } }
    val eligible = stations.filter { s -> s.modes.any { it in data.modes } }
    fun nearest(list: List<Station>, within: Double) = list.filter { distanceMetres(fix, it) <= within }.minByOrNull { distanceMetres(fix, it) }
    nearest(saved, SavedStationMetres)?.let { return Here(it, 1) }
    nearest(eligible, AtStationMetres)?.let { return Here(it, 1) }
    nearest(saved, NearStationMetres)?.let { return Here(it, 2) }
    return nearest(eligible, NearStationMetres)?.let { Here(it, 3) }
}

/** The station a record may name as seen at: here's station, when the fix is close enough to be on its platforms. */
fun sightingOf(here: Here?, fix: Fix?): Station? =
    here?.station?.takeIf { fix != null && distanceMetres(fix, it) <= SightingMetres }
