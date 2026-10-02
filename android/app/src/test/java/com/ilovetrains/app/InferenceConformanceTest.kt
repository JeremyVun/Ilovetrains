package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Every case of the shared inference.json, in the order each section's `run` states. */
class InferenceConformanceTest {
    private val fixture = JSONObject(requireNotNull(javaClass.getResourceAsStream("/inference.json")).bufferedReader().use { it.readText() })

    @Test fun holdCasesKeepTheRecordTheWebKeeps() {
        val cases = fixture.getJSONObject("holdCases").getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val name = case.getString("name")
            val data = document(case.getJSONObject("doc"))
            val now = case.getLong("nowMs")
            val incoming = record(case.getJSONObject("incoming"), now)
            val sightingAt = case.optLong("sightingAt").takeIf { !case.isNull("sightingAt") }
            val kept = if (replacesLastAnswer(data, incoming.stationId, now, sightingAt)) "incoming" else "stored"
            assertEquals(name, case.getString("expectedKept"), kept)
            assertEquals(name, if (kept == "stored") data.lastAnswer else incoming, data.withLastAnswer(incoming, sightingAt).lastAnswer)
        }
    }

    @Test fun entryCasesEnterAsTheWebEnters() {
        val cases = fixture.getJSONObject("entryCases").getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            assertEquals(case.getString("name"), expected(case.opt("expected")), entered(case))
        }
    }

    @Test fun startCasesOfferStartTripWhereTheWebOffersIt() {
        val cases = fixture.getJSONObject("startCases").getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            assertEquals(case.getString("name"), case.getBoolean("expectedStartable"),
                startable(Wire.journey(case.getJSONObject("journey")), case.getLong("nowMs")))
        }
    }

    @Test fun runningCasesStartFromTheBoardWhereTheWebStarts() {
        val cases = fixture.getJSONObject("runningCases").getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val modes = case.optJSONArray("enabledModes")?.let { modes -> (0 until modes.length()).map(modes::getString).toSet() } ?: AllModes
            assertEquals(case.getString("name"), case.getBoolean("expectedRunning"),
                runningJourney(Wire.journey(case.getJSONObject("journey")), case.getLong("nowMs"), modes, null))
        }
    }

    @Test fun stopCasesDeclineAsTheWebDeclines() {
        val cases = fixture.getJSONObject("stopCases").getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val name = case.getString("name")
            val focus = focusOf(case.getJSONObject("focus"))
            val stopped = document(case.getJSONObject("doc")).copy(focus = focus).withTripStopped(case.getLong("nowMs"))
            assertNull(name, stopped.focus)
            assertEquals(name, case.optJSONObject("expectedDecline")?.let { decline ->
                InferenceDecline(decline.getString("tripId"), decline.getString("direction") == "reverse", decline.getLong("at"),
                    departureKey(decline.getString("departure")), decline.getLong("arrival"))
            }, stopped.inferenceDeclined)
            assertEquals(name, case.getBoolean("expectedEvent"), !focus.pinned)
        }
    }

    private fun entered(case: JSONObject): String? {
        var data = document(case.getJSONObject("doc"))
        var snapshot = case.optJSONObject("snapshot")?.let { record(it, null) }
        val writes = case.getJSONArray("writes")
        for (index in 0 until writes.length()) {
            val write = writes.getJSONObject(index)
            val written = record(write.getJSONObject("record"), write.getLong("nowMs"))
            val sightingAt = write.optLong("sightingAt").takeIf { !write.isNull("sightingAt") }
            if (retiresSnapshot(data, snapshot, written.stationId, sightingAt)) snapshot = null
            data = data.withLastAnswer(written, sightingAt)
        }
        val now = case.getLong("nowMs")
        val fix = fixOf(case.getJSONObject("fix"), now)
        val previousFix = case.optJSONObject("previousFix")?.let { fixOf(it, now) }
        inferFromRecords(data, snapshot, now, fix)?.let { return described("platform", it.tripId, it.reverse, it.journey) }
        val cached = boards(case.getJSONObject("cached"))
        case.optJSONArray("expectedRequests")?.let { requests ->
            assertEquals(case.getString("name"), (0 until requests.length()).map { requests.getJSONObject(it).let { request ->
                listOf(request.getString("tripId"), request.getString("direction"), request.getString("from"), request.getString("to"),
                    request.getLong("at"), request.getInt("limit"))
            } }, onBoardRequests(data, now, fix, previousFix, cached).map { request ->
                listOf(request.trip.tripId, direction(request.trip.reverse), request.from.id, request.to.id, request.at, request.limit)
            })
        }
        if (!trainSpeed(fix, previousFix)) return null
        return inferOnBoard(data, now, fix, previousFix, boards(case.getJSONObject("boards")), cached)
            ?.let { described("onBoard", it.trip.tripId, it.trip.reverse, it.journey) }
    }

    private fun described(via: String, tripId: String, reverse: Boolean, journey: Journey) =
        "$via $tripId ${direction(reverse)} ${journey.key}"

    private fun expected(raw: Any?): String? = (raw as? JSONObject)?.let { entry ->
        val key = entry.getJSONArray("journeyKey").let { legs ->
            (0 until legs.length()).joinToString("|") { legs.getJSONArray(it).let { leg -> "${leg.getString(0)}:${time(leg.getString(1))}" } }
        }
        "${entry.getString("via")} ${entry.getString("tripId")} ${entry.getString("direction")} $key"
    }

    private fun direction(reverse: Boolean) = if (reverse) "reverse" else "forward"

    /** The web personal document, read into the native one. */
    private fun document(raw: JSONObject): UserData {
        val trips = raw.getJSONArray("trips").objects { SavedTrip(it.getString("id"), Wire.station(it.getJSONObject("from")), Wire.station(it.getJSONObject("to"))) }
        val preferences = raw.optJSONObject("preferences") ?: JSONObject()
        return UserData(
            trips = trips,
            history = raw.optJSONArray("history").objects { ViewEvent(it.getString("tripId"), it.getString("direction") == "reverse", time(it.getString("t"))) },
            rides = raw.optJSONArray("rides").objects { ride ->
                Ride(ride.getString("tripId"), ride.getString("direction") == "reverse",
                    time(ride.optString("scheduledDeparture").ifEmpty { ride.getString("departedAt") }), time(ride.getString("arrivedAt")))
            },
            focus = raw.optJSONObject("focus")?.let(::focusOf),
            lastAnswer = raw.optJSONObject("lastOpen")?.let { record(it, null) },
            useLocation = preferences.optBoolean("useLocation", true),
            modes = preferences.optJSONArray("enabledModes")?.let { modes -> (0 until modes.length()).map(modes::getString).toSet() } ?: AllModes,
            inferenceDeclined = raw.optJSONObject("inferenceDeclined")?.let { decline ->
                InferenceDecline(decline.getString("tripId"), decline.getString("direction") == "reverse", time(decline.getString("at")),
                    departureKey(decline.getString("departure")), time(decline.getString("arrival")))
            },
        )
    }

    /** A web focus; a native focus carries its journey's board, from its first leg's origin to its last leg's destination. */
    private fun focusOf(raw: JSONObject): FocusedJourney {
        val journey = Wire.journey(raw.getJSONObject("journey"))
        return FocusedJourney(raw.getString("tripId"), raw.getString("direction") == "reverse", journey,
            BoardData(journey.legs.first().from, journey.legs.last().to, listOf(journey), time(raw.getString("focusedAt"))),
            pinned = raw.optString("by") != "inferred")
    }

    /** The web departureKey, a JSON [line, ISO departure], as the native `line:epoch ms`. */
    private fun departureKey(web: String) = JSONArray(web).let { "${it.getString(0)}:${time(it.getString(1))}" }

    /** A lastOpen record; a write's record takes its write time as [at]. */
    private fun record(raw: JSONObject, at: Long?): LastAnswer {
        val journey = Wire.journey(raw.getJSONObject("journey"))
        val written = at ?: time(raw.getString("at"))
        return LastAnswer(raw.getString("tripId"), raw.getString("direction") == "reverse", written,
            raw.optJSONObject("station")?.getString("id"),
            BoardData(journey.legs.first().from, journey.legs.last().to, listOf(journey), written), journey)
    }

    private fun boards(raw: JSONObject): Map<TripDirection, List<Journey>> = raw.keys().asSequence().associate { key ->
        val (tripId, direction) = key.split("|")
        TripDirection(tripId, direction == "reverse") to raw.getJSONArray(key).objects(Wire::journey)
    }

    private fun time(iso: String) = Instant.parse(iso).toEpochMilli()

    private fun <T> JSONArray?.objects(read: (JSONObject) -> T): List<T> =
        if (this == null) emptyList() else (0 until length()).map { read(getJSONObject(it)) }
}
