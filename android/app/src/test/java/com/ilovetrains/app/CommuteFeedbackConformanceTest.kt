package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CommuteFeedbackConformanceTest {
    private val fixture = JSONObject(requireNotNull(javaClass.getResourceAsStream("/commute-feedback.json"))
        .bufferedReader().use { it.readText() })
    private val epoch = fixture.getLong("epochMs")

    @Test fun recommendationFixturesMatchSharedReference() {
        val cases = fixture.getJSONArray("recommendations")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val journeys = case.getJSONArray("journeys").objects(::journey)
            val source = BoardData(origin, destination, journeys, epoch, source = "live")
            val candidates = journeys.map { RecommendationCandidate(it, source, stale = false) }
            val chosen = requireNotNull(selectRecommendation(candidates, epoch))
            assertEquals(case.getString("id"), case.getString("expected"), id(chosen.journey))
            assertEquals(case.getString("id"), epoch + case.getLong("expectedCostDelta"), recommendationCost(chosen.journey))
            if (case.has("alternative")) {
                assertEquals(case.getString("id"), case.getString("alternative"),
                    id(requireNotNull(earliestAlternative(candidates, chosen.journey, epoch)).journey))
            }
        }
    }

    @Test fun preferenceFixturesPreserveNullAndZero() {
        val cases = fixture.getJSONArray("preferences")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val choice = transferLimitOf(case.stringOrNull("choice"))
            val data = UserData(transferLimit = choice, flags = mapOf(TransferLimitFlag to case.getBoolean("flag")))
            assertEquals(case.getString("id"), case.getString("expectedChoice"), choice.wire)
            if (case.isNull("expectedCap")) assertNull(case.getString("id"), data.maxTransfers)
            else assertEquals(case.getString("id"), case.getInt("expectedCap"), data.maxTransfers)
            assertEquals(case.getString("id"), case.getInt("expectedSolver"), data.offlineMaxTransfers)
        }
    }

    @Test fun arrivalFixturesMatchSharedReference() {
        val defaults = fixture.getJSONObject("arrivalDefaults")
        val cases = fixture.getJSONArray("arrivals")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val identity = fixture.getString("identity")
            val now = epoch + case.getLong("nowDelta")
            val departure = epoch + case.optLong("departureDelta", defaults.getLong("departureDelta"))
            val arrival = epoch + case.optLong("arrivalDelta", defaults.getLong("arrivalDelta"))
            val destination = when {
                case.has("destination") && case.isNull("destination") -> null
                case.has("destination") -> station(case.getJSONObject("destination"))
                else -> station(fixture.getJSONObject("destination"))
            }
            val initialGuard = guard(if (case.has("guard")) case.optJSONObject("guard") else defaults.getJSONObject("guard"))
            val base = ArrivalInput(identity, departure, arrival, now, destination, initialGuard,
                matchingRefresh = case.optBoolean("matchingRefresh"), legacyCompleted = case.optBoolean("legacyCompleted"),
                permissionPending = case.optBoolean("permissionPending"), cancelled = case.optBoolean("cancelled"),
                resumeWaitUntilMs = case.optLong("resumeWaitUntilDelta").takeIf { case.has("resumeWaitUntilDelta") }?.let { epoch + it })
            var window: ArrivalWindow? = null
            var currentGuard = initialGuard
            val samples = case.getJSONArray("samples")
            for (sampleIndex in 0 until samples.length()) {
                val raw = samples.getJSONArray(sampleIndex)
                val sampleNow = epoch + raw.getLong(0)
                val sample = ArrivalSample(raw.getDouble(1), raw.getDouble(2), sampleNow, raw.getDouble(3),
                    raw.optDouble(4, Double.NaN).takeIf(Double::isFinite))
                val next = reduceArrival(base.copy(identity = case.optString("windowIdentity", identity), nowMs = sampleNow,
                    guard = currentGuard, window = window, sample = sample))
                window = next.window
                currentGuard = next.guard
            }
            val actual = reduceArrival(base.copy(guard = if (case.has("windowIdentity")) initialGuard else currentGuard, window = window))
            assertEquals(case.getString("id"), state(case.getString("expectedState")), actual.state)
            assertEquals(case.getString("id"), action(case.getString("expectedAction")), actual.action)
            if (case.has("expectedBasis")) assertEquals(case.getString("id"), basis(case.getString("expectedBasis")), actual.basis)
            if (case.has("expectedMoving")) assertEquals(case.getString("id"), case.getBoolean("expectedMoving"), actual.moving)
        }
    }

    private fun journey(raw: JSONObject): Journey {
        val legs = raw.getJSONArray("legs").arrays { leg ->
            val line = leg.getString(0)
            Leg(line, "train", raw.getString("id"), origin, destination,
                epoch + leg.getLong(1), epoch + leg.getLong(2), cancelled = raw.optBoolean("cancelled"))
        }
        return Journey(legs)
    }

    private fun id(journey: Journey) = journey.legs.first().headsign
    private fun station(raw: JSONObject) = Station("destination", "Destination", raw.getDouble("lat"), raw.getDouble("lon"))
    private fun guard(raw: JSONObject?): ArrivalGuard? = raw?.let {
        ArrivalGuard(it.opt("armed") as? Boolean,
            it.optLong("retainedDelta").takeIf { _ -> it.has("retainedDelta") }?.let { delta -> epoch + delta },
            it.stringOrNull("basis")?.let(::basis),
            it.optLong("confirmedDelta").takeIf { _ -> it.has("confirmedDelta") }?.let { delta -> epoch + delta })
    }
    private fun state(value: String) = when (value) {
        "travelling" -> ArrivalState.Travelling
        "checkingArrival" -> ArrivalState.CheckingArrival
        "arrivalUnconfirmed" -> ArrivalState.ArrivalUnconfirmed
        "arrived" -> ArrivalState.Arrived
        else -> ArrivalState.ExpiredUnconfirmed
    }
    private fun action(value: String) = when (value) {
        "record" -> ArrivalAction.Record
        "correct" -> ArrivalAction.Correct
        "withdraw" -> ArrivalAction.Withdraw
        "expire" -> ArrivalAction.Expire
        else -> ArrivalAction.None
    }
    private fun basis(value: String) = if (value == "location") ArrivalBasis.Location else ArrivalBasis.Estimate

    private val origin = Station("origin", "Origin")
    private val destination = Station("destination", "Destination")
}

private fun <T> JSONArray.objects(transform: (JSONObject) -> T): List<T> =
    (0 until length()).map { transform(getJSONObject(it)) }

private fun <T> JSONArray.arrays(transform: (JSONArray) -> T): List<T> =
    (0 until length()).map { transform(getJSONArray(it)) }
