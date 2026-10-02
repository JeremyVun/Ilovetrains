package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** One case of the web-generated prediction.json, read into native types. */
internal class PredictionCase(val name: String, val now: Long, val data: UserData, val stations: List<Station>,
    val fix: Fix?, val previousFix: Fix?, val expected: JSONObject)

internal fun predictionCases(): List<PredictionCase> {
    val cases = JSONArray(requireNotNull(PredictionCase::class.java.getResourceAsStream("/prediction.json")).bufferedReader().use { it.readText() })
    return (0 until cases.length()).map { index ->
        val case = cases.getJSONObject(index)
        val raw = case.getJSONObject("doc")
        val now = Instant.parse(case.getString("now")).toEpochMilli()
        PredictionCase(case.getString("name"), now, UserData(
            trips = raw.getJSONArray("trips").readEach { SavedTrip(it.getString("id"), Wire.station(it.getJSONObject("from")), Wire.station(it.getJSONObject("to"))) },
            history = raw.getJSONArray("history").readEach { ViewEvent(it.getString("tripId"), it.getString("direction") == "reverse", Instant.parse(it.getString("t")).toEpochMilli()) },
            votes = raw.getJSONArray("homeVotes").readEach { HomeVote(it.getString("day"), Wire.station(it.getJSONObject("station"))) },
            useLocation = raw.getJSONObject("preferences").optBoolean("useLocation", true),
            lastTripId = raw.optJSONObject("lastViewed")?.getString("tripId"), lastReverse = raw.optJSONObject("lastViewed")?.getString("direction") == "reverse"),
            case.getJSONArray("stations").readEach(Wire::station),
            case.optJSONObject("fix")?.let { fixOf(it, now) }, case.optJSONObject("previousFix")?.let { fixOf(it, now) },
            case.getJSONObject("expected"))
    }
}

/** A fixture fix omits a value it does not know; it is never zero. */
internal fun fixOf(raw: JSONObject, now: Long): Fix {
    fun optional(key: String) = if (raw.has(key) && !raw.isNull(key)) raw.getDouble(key) else null
    return Fix(raw.getDouble("lat"), raw.getDouble("lon"), if (raw.has("at")) raw.getLong("at") else now,
        optional("speed"), optional("accuracy"), optional("heading"))
}
