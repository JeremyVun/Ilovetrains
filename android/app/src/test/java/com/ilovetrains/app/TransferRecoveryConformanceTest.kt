package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferRecoveryConformanceTest {
    private val keys = listOf(
        "followedChanges", "composedChanges", "recoveryAnchor", "search", "candidate", "composed",
        "status", "pinIcon", "changeLabels", "receipt", "instruction", "arrival", "figure",
        "provenance", "alert",
    )

    @Test fun everyTransferRecoveryCaseCarriesTheWholeSeam() {
        val fixture = JSONObject(resource("/transfer-recovery.json"))
        assertTrue(fixture.getString("notes").contains("printed clock minutes"))
        assertTrue(fixture.getJSONObject("base").getJSONArray("legs").length() >= 2)
        val cases = fixture.getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val name = case.getString("name")
            assertTrue(name, case.has("now") && case.has("fresh"))
            assertTrue(name, case.getString("by") in listOf("focus", "inferred"))
            assertTrue(name, case.has("searches"))
            val expected = case.getJSONObject("expected")
            assertEquals(name, keys.sorted(), expected.keys().asSequence().sorted().toList())
        }
    }

    @Test fun theSharedSeamAnswersEveryCase() {
        val fixture = JSONObject(resource("/transfer-recovery.json"))
        val base = fixture.getJSONObject("base")
        val cases = fixture.getJSONArray("cases")
        var asserted = 0
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val name = case.getString("name")
            val expected = case.getJSONObject("expected")
            val now = case.getLong("now")
            val followed = followedJourney(base, case)
            val destination = followed.legs.last().to
            val searches = case.getJSONArray("searches")

            assertEquals("$name followedChanges", strings(expected, "followedChanges"),
                connectionStates(followed).map { it.name.lowercase() })

            val held = case.optJSONObject("heldRecovery")?.let {
                Recovery(it.getInt("changeIndex"), searchJourney(searches, it.getString("search"), it.getInt("journey")),
                    now, RecoverySource(now))
            }
            val plan = recoveryPlan(followed, held, destination)
            assertEquals("$name recoveryAnchor", optInt(expected, "recoveryAnchor"), plan.anchor)
            val requested = plan.search?.let { searchId(searches, it) }
            assertEquals("$name search", optString(expected, "search"), requested)

            val search = named(searches, requested)
            val candidate = search?.let { recoveryCandidate(searchJourneys(it), plan.search!!.at, AllModes) }
            assertEquals("$name candidate", optInt(expected, "candidate"),
                candidate?.let { chosen -> searchJourneys(search).indexOfFirst { it == chosen } })

            val recovery = recoveryAfterSearch(plan, candidate, now, RecoverySource(now))
            val focus = FocusedJourney(
                fixture.getString("tripId"), fixture.getBoolean("reverse"), followed,
                BoardData(followed.legs.first().from, destination, listOf(followed), now,
                    source = if (case.getBoolean("fresh")) "live" else "schedule"),
                pinned = case.getString("by") == "focus",
                recovery = recovery,
            )
            val composed = focus.composed
            assertEquals("$name composed", legSummaries(expected.getJSONArray("composed")),
                composed.legs.map { it.line to it.departure })
            assertEquals("$name composedChanges", strings(expected, "composedChanges"),
                connectionStates(composed, recovery?.changeIndex).map { it.name.lowercase() })

            val header = focusHeader(focus, now)
            assertEquals("$name status", expected.getString("status"), header.status.text.uppercase())
            assertEquals("$name pinIcon", expected.getBoolean("pinIcon"), header.pinIcon)
            assertEquals("$name changeLabels", strings(expected, "changeLabels"),
                header.changeLabels.map { it.uppercase() })
            assertEquals("$name receipt", expected.getString("receipt"), header.receipt)
            assertEquals("$name instruction", expected.getString("instruction"), header.instruction)
            assertEquals("$name arrival", arrivalMap(expected.getJSONObject("arrival")), arrivalMap(header.arrival))
            assertEquals("$name figure", expected.getString("figure"), header.figure.value)
            assertEquals("$name provenance", expected.getString("provenance"), header.figure.provenance.uppercase())

            // No prior observation is the baseline the contract refuses to cue on.
            val projection = requireNotNull(TravelTrackerState.derive(focus, now, 1)) { "$name has no projection" }
            val previous = case.optJSONObject("previous")?.let {
                TravelTrackerObservation(it.getInt("arrivalDelay"), strings(it, "composedChanges").map(::connectionState))
            }
            assertEquals("$name alert", optString(expected, "alert"),
                trackerCues(focus, projection, now, previous).firstOrNull()?.let(::alertName))
            asserted++
        }
        assertEquals("every shared case is asserted", cases.length(), asserted)
    }

    private fun followedJourney(base: JSONObject, case: JSONObject): Journey {
        val source = case.optJSONArray("legs") ?: base.getJSONArray("legs")
        val cancelled = case.optJSONArray("cancelledLegs")?.let { array ->
            (0 until array.length()).map(array::getInt).toSet()
        } ?: emptySet()
        val estimates = case.optJSONArray("estimates")?.let { array ->
            (0 until array.length()).map(array::getJSONObject).associateBy { it.getInt("leg") }
        } ?: emptyMap()
        return Journey((0 until source.length()).map { index ->
            val estimate = estimates[index]
            val parsed = leg(source.getJSONObject(index))
            parsed.copy(
                estimatedDeparture = estimate?.takeIf { it.has("departure") }?.getLong("departure")
                    ?: parsed.estimatedDeparture,
                estimatedArrival = estimate?.takeIf { it.has("arrival") }?.getLong("arrival")
                    ?: parsed.estimatedArrival,
                cancelled = parsed.cancelled || index in cancelled,
            )
        })
    }

    private fun leg(value: JSONObject): Leg {
        val from = value.getJSONObject("from")
        val to = value.getJSONObject("to")
        val departure = value.getJSONObject("departure")
        val arrival = value.getJSONObject("arrival")
        return Leg(
            value.getString("line"), value.getString("mode"), value.optString("headsign"),
            Station(from.getString("id"), from.getString("name")), Station(to.getString("id"), to.getString("name")),
            departure.getLong("scheduled"), arrival.getLong("scheduled"),
            departure.optLong("estimated").takeIf { it > 0 }, arrival.optLong("estimated").takeIf { it > 0 },
            from.stringOrNull("platform"), to.stringOrNull("platform"), value.optBoolean("cancelled"),
        )
    }

    private fun named(searches: JSONArray, id: String?): JSONObject? = (0 until searches.length())
        .map(searches::getJSONObject).firstOrNull { it.getString("id") == id }

    private fun searchId(searches: JSONArray, requested: RecoverySearch): String? = (0 until searches.length())
        .map(searches::getJSONObject)
        .firstOrNull { it.getString("from") == requested.from.id && it.getLong("at") == requested.at }
        ?.getString("id")

    private fun searchJourneys(search: JSONObject): List<Journey> {
        val journeys = search.getJSONArray("journeys")
        return (0 until journeys.length()).map { index ->
            val legs = journeys.getJSONObject(index).getJSONArray("legs")
            Journey((0 until legs.length()).map { leg(legs.getJSONObject(it)) })
        }
    }

    private fun searchJourney(searches: JSONArray, id: String, index: Int): Journey =
        searchJourneys(requireNotNull(named(searches, id)) { "unknown search $id" })[index]

    private fun arrivalMap(value: JSONObject): Map<String, String> =
        value.keys().asSequence().associateWith { value.getString(it) }

    private fun arrivalMap(value: FocusArrivalClocks): Map<String, String> = buildMap {
        value.shown?.let { put("shown", it) }
        value.struck?.let { put("struck", it) }
        value.planned?.let { put("planned", it) }
    }

    private fun legSummaries(value: JSONArray): List<Pair<String, Long>> = (0 until value.length()).map {
        val leg = value.getJSONObject(it)
        leg.getString("line") to leg.getLong("scheduledDeparture")
    }

    private fun connectionState(name: String) = ConnectionState.entries.first { it.name.equals(name, true) }

    private fun alertName(cue: TravelTrackerCue) = when (cue.kind) {
        TravelTrackerCueKind.MissedTransfer -> "missedConnection"
        TravelTrackerCueKind.TightChange -> "tightChange"
        TravelTrackerCueKind.Delayed -> "delayed"
        TravelTrackerCueKind.Cancellation -> "cancellation"
        TravelTrackerCueKind.GetOff -> "getOff"
        TravelTrackerCueKind.Change -> "change"
    }

    private fun optInt(value: JSONObject, key: String): Int? = if (value.isNull(key)) null else value.getInt(key)

    private fun optString(value: JSONObject, key: String): String? =
        if (value.isNull(key)) null else value.getString(key)

    private fun strings(value: JSONObject, key: String): List<String> = value.getJSONArray(key).let { array ->
        (0 until array.length()).map(array::getString)
    }

    private fun resource(name: String) =
        requireNotNull(javaClass.getResourceAsStream(name)).bufferedReader().use { it.readText() }
}
