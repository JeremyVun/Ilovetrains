package com.ilovetrains.app

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.util.TimeZone

class WebConformanceTest {
    @Test fun predictionMatchesCommittedWebOutputs() {
        val previous = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Australia/Sydney"))
        try {
            val cases = JSONArray(requireNotNull(javaClass.getResourceAsStream("/prediction.json")).bufferedReader().use { it.readText() })
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index); val raw = case.getJSONObject("doc"); val expected = case.getJSONObject("expected")
                val now = Instant.parse(case.getString("now")).toEpochMilli()
                val trips = raw.getJSONArray("trips").readEach { SavedTrip(it.getString("id"), Wire.station(it.getJSONObject("from")), Wire.station(it.getJSONObject("to"))) }
                val data = UserData(trips = trips,
                    history = raw.getJSONArray("history").readEach { ViewEvent(it.getString("tripId"), it.getString("direction") == "reverse", Instant.parse(it.getString("t")).toEpochMilli()) },
                    votes = raw.getJSONArray("homeVotes").readEach { HomeVote(it.getString("day"), Wire.station(it.getJSONObject("station"))) },
                    useLocation = raw.getJSONObject("preferences").optBoolean("useLocation", true),
                    lastTripId = raw.optJSONObject("lastViewed")?.getString("tripId"), lastReverse = raw.optJSONObject("lastViewed")?.getString("direction") == "reverse")
                val stations = case.getJSONArray("stations").readEach(Wire::station)
                val fix = case.optJSONObject("fix")?.let { Fix(it.getDouble("lat"), it.getDouble("lon"), now) }
                val actual = predict(data, stations, fix, now)
                val selection = expected.optJSONObject("selection")
                assertEquals(case.getString("name"), selection?.getString("tripId"), actual?.tripId)
                assertEquals(case.getString("name"), selection?.getBoolean("reverse"), actual?.reverse)
                assertEquals(case.getString("name"), expected.stringOrNull("home"), automaticHome(data)?.id)
                expected.getJSONArray("scores").readEach { score ->
                    assertEquals(case.getString("name"), score.getDouble("value"), historyScore(data.history, score.getString("tripId"), score.getBoolean("reverse"), now), 1e-12)
                }
            }
        } finally { TimeZone.setDefault(previous) }
    }
}
