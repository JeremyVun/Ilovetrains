package com.ilovetrains.app

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test

class RowConformanceTest {
    @Test fun pastFiguresKeepElapsedTimeWhenObservationsAreRetainedOrOffline() {
        val now = 9_000_000L
        val from = Station("a", "A"); val to = Station("b", "B")
        for (elapsed in listOf(5, 119)) for (offline in listOf(false, true)) {
            val journey = Journey(listOf(Leg("T1", "train", "B", from, to,
                now - elapsed * 60_000, now + 60_000)), retained = offline)
            val board = BoardData(from, to, listOf(journey), now - 120_000, source = "live", offline = offline)
            val figure = figureFor(journey, board, now)
            assertEquals(if (elapsed > 99) "2" else "5", figure.value)
            assertEquals(if (elapsed > 99) "H" else "min", figure.unit)
            assertEquals("Ago", figure.provenance)
            assertEquals(true, figure.past)
        }
    }

    @Test fun futureFiguresRemainVisibleAcrossEverySourceState() {
        val now = 9_000_000L
        val from = Station("a", "A"); val to = Station("b", "B")
        for (minutes in listOf(0, 34, 119)) {
            val journey = Journey(listOf(Leg("T1", "train", "B", from, to,
                now + minutes * 60_000, now + (minutes + 30) * 60_000)))
            val board = BoardData(from, to, listOf(journey), now, source = "live")
            for (source in listOf(null, board, board.copy(offline = true),
                board.copy(generatedAt = now - 120_000), board.copy(source = "schedule"))) {
                for (retained in listOf(false, true)) {
                    val figure = figureFor(journey.copy(retained = retained), source, now)
                    assertEquals(when (minutes) { 0 -> "Now"; 119 -> "2"; else -> "34" }, figure.value)
                    assertEquals(when (minutes) { 0 -> ""; 119 -> "H"; else -> "min" }, figure.unit)
                    assertEquals("Scheduled", figure.provenance)
                    assertEquals(false, figure.past)
                }
            }
        }
    }

    @Test fun directionFiguresTargetTheNextDepartureDuringATransferDwell() {
        val a = Station("a", "A"); val b = Station("b", "B"); val c = Station("c", "C")
        val journey = Journey(listOf(
            Leg("T1", "train", "B", a, b, 0, 10 * 60_000),
            Leg("T2", "train", "C", b, c, 15 * 60_000, 30 * 60_000)), retained = true)
        assertEquals(Figure("5", "min", "To change"), directionFigureFor(journey, 5 * 60_000))
        assertEquals(Figure("3", "min", "To change"), directionFigureFor(journey, 12 * 60_000))
        assertEquals(Figure("12", "min", "To go"), directionFigureFor(journey, 18 * 60_000))
        assertEquals(null, directionFigureFor(journey, 30 * 60_000))
    }

    @Test fun departureFiguresMatchTheWebReference() {
        val cases = JSONArray(requireNotNull(javaClass.getResourceAsStream("/rows.json")).bufferedReader().use { it.readText() })
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index); val expected = case.getJSONObject("expected")
            val board = Wire.board(case.getJSONObject("body"), api = true).copy(offline = case.getJSONObject("syntheticDelta").optBoolean("offline"))
            val journey = board.journeys.single()
            val figure = figureFor(journey, board, case.getLong("now"))
            val rendered = figure.value + if (figure.unit == "H") "H" else ""
            assertEquals(case.getString("name"), expected.getString("figure"), rendered)
            assertEquals(case.getString("name"), expected.getString("provenance"), figure.provenance.uppercase())
            assertEquals(case.getString("name"), expected.getBoolean("past"), figure.past)
            assertEquals(case.getString("name"), expected.getString("depTime"), clockTime(journey.effectiveDeparture))
            assertEquals(case.getString("name"), expected.getString("arrTime"), clockTime(journey.effectiveArrival))
        }
    }
}
