package com.ilovetrains.app

// Transient setup state. Coordinates and accuracy are never persisted.
enum class SetupLocationStatus(val message: String?) {
    Idle(null), Locating("Finding your location…"),
    Denied("Location permission wasn’t granted. You can search for a station."),
    Unavailable("Couldn’t get your location. Try again or search for a station."),
    ServicesDisabled("Location Services are off. Turn them on in Settings or search for a station."),
    NoNearby("No stations found nearby. Search for your starting station."),
    ChooseStation("Choose your starting station. Your location isn’t precise enough to pick one.")
}
data class SetupLocationChoice(val stations: List<Station>, val automatic: Station?)
fun setupLocationChoice(stations: List<Station>, modes: Set<String>, fix: Fix): SetupLocationChoice {
    val accuracy = fix.accuracyMetres?.takeIf { it.isFinite() && it >= 0 }
    val radius = 2_000 + (accuracy ?: 3_000.0).coerceAtMost(3_000.0)
    val nearby = stations.filter { it.modes.any(modes::contains) }
        .map { it to distanceMetres(fix, it) }.filter { it.second <= radius }.sortedBy { it.second }
    val first = nearby.firstOrNull()
    val confident = accuracy != null && accuracy <= 200 && first != null && first.second <= 2_000 &&
        (nearby.getOrNull(1)?.second?.minus(first.second) ?: Double.POSITIVE_INFINITY) > 2 * accuracy
    return SetupLocationChoice(nearby.take(3).map { it.first }, first?.first?.takeIf { confident })
}
