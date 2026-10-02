package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

class WebConformanceTest {
    @Test fun predictionMatchesCommittedWebOutputs() {
        val previous = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Australia/Sydney"))
        try {
            for (case in predictionCases()) {
                val name = case.name; val data = case.data; val stations = case.stations; val now = case.now; val expected = case.expected
                // The fixture places the phone whatever the preference, which only gates using the answer.
                val placed = here(data.copy(useLocation = true), stations, case.fix, now, case.previousFix)
                assertEquals(name, expected.optJSONObject("here")?.getString("stationId"), placed?.station?.id)
                assertEquals(name, expected.optJSONObject("here")?.getInt("tier"), placed?.tier)
                assertEquals(name, expected.stringOrNull("sighting"), sightingOf(placed, case.fix)?.id)
                val actual = predict(data, stations, case.fix, now, case.previousFix)
                val selection = expected.optJSONObject("selection")
                if (selection == null && actual != null) {
                    val answer = pairedAnswer(case)
                    assertEquals(name, "pair", answer?.tripId)
                    assertEquals(name, false, answer?.reverse)
                } else {
                    assertEquals(name, selection?.getString("tripId"), actual?.tripId)
                    assertEquals(name, selection?.getBoolean("reverse"), actual?.reverse)
                }
                val withoutLocation = predict(data.copy(useLocation = false), stations, case.fix, now, case.previousFix)
                val expectedWithoutLocation = expected.optJSONObject("noLocation")
                assertEquals(name, expectedWithoutLocation?.getString("tripId"), withoutLocation?.tripId)
                assertEquals(name, expectedWithoutLocation?.let { it.getString("direction") == "reverse" }, withoutLocation?.reverse)
                assertEquals(name, expected.stringOrNull("home"), automaticHome(data)?.id)
                val scores = expected.getJSONArray("scores")
                for (scoreIndex in 0 until scores.length()) {
                    val score = scores.getJSONObject(scoreIndex)
                    val evidence = historyEvidence(data.history, score.getString("tripId"), score.getBoolean("reverse"), now)
                    assertEquals(name, score.getDouble("value"), evidence.score, 1e-12)
                    assertEquals(name, score.getInt("days"), evidence.days)
                    assertEquals(name, score.getInt("receiptDays"), evidence.receiptDays)
                }
            }
        } finally { TimeZone.setDefault(previous) }
    }
}

/** The web answers a station no saved trip touches with a pair; native saves that trip home, then answers it. */
internal fun pairedAnswer(case: PredictionCase): Selection? {
    val station = stationHere(case.data, case.stations, case.fix, case.now, case.previousFix) ?: return null
    val home = homewardPairEnd(case.data, station) ?: return null
    return predict(case.data.copy(trips = case.data.trips + SavedTrip("pair", station, home)), case.stations, case.fix, case.now, case.previousFix)
}
