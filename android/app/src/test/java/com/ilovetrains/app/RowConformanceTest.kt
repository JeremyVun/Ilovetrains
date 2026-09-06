package com.ilovetrains.app

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test

class RowConformanceTest {
    @Test fun departureFiguresMatchTheWebReference() {
        val cases = JSONArray(requireNotNull(javaClass.getResourceAsStream("/rows.json")).bufferedReader().use { it.readText() })
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index); val expected = case.getJSONObject("expected")
            val board = Wire.board(case.getJSONObject("body"), api = true).copy(offline = case.getJSONObject("syntheticDelta").optBoolean("offline"))
            val figure = figureFor(board.journeys.single(), board, case.getLong("now"))
            val rendered = figure.value + if (figure.unit == "H") "H" else ""
            assertEquals(case.getString("name"), expected.getString("figure"), rendered)
            assertEquals(case.getString("name"), expected.getString("provenance"), figure.provenance.uppercase())
            assertEquals(case.getString("name"), expected.getBoolean("past"), figure.past)
        }
    }
}
