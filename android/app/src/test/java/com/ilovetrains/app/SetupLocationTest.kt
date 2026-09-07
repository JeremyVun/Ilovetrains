package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test

class SetupLocationTest {
    private val central = Station("central", "Central", -33.8832, 151.2067, setOf("train"))
    private val townHall = Station("town-hall", "Town Hall", -33.8736, 151.2069, setOf("train"))
    private val ferry = central.copy(id = "ferry", modes = setOf("ferry"))
    private val stations = listOf(townHall, ferry, central)
    private fun fix(accuracy: Double?) = Fix(central.lat, central.lon, 1, accuracyMetres = accuracy)

    @Test fun preciseFixSelectsNearestEligibleStation() {
        assertEquals(central, setupLocationChoice(stations, setOf("train"), fix(50.0)).automatic)
        assertEquals(ferry, setupLocationChoice(stations, setOf("ferry"), fix(50.0)).automatic)
    }
    @Test fun ApproximateOrUnknownAccuracyOffersChoicesWithoutSelecting() {
        for (accuracy in listOf(null, 1_000.0, -1.0, Double.NaN)) {
            val choice = setupLocationChoice(stations, setOf("train"), fix(accuracy))
            assertNull(choice.automatic)
            assertEquals(listOf(central, townHall), choice.stations)
        }
    }
    @Test fun ambiguousPreciseFixStillRequiresAChoice() {
        val nextDoor = central.copy(id = "other", lat = central.lat + .0001)
        assertNull(setupLocationChoice(listOf(central, nextDoor), AllModes, fix(50.0)).automatic)
    }
    @Test fun outsideNetworkDoesNotSuggestADistantStation() {
        val choice = setupLocationChoice(stations, AllModes, Fix(0.0, 0.0, 1, accuracyMetres = 100.0))
        assertTrue(choice.stations.isEmpty()); assertNull(choice.automatic)
        assertTrue(setupLocationChoice(stations, emptySet(), fix(50.0)).stations.isEmpty())
    }
}
