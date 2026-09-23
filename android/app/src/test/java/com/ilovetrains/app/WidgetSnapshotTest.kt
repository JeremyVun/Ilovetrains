package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.OffsetDateTime

class WidgetSnapshotTest {
    private val rhodes = Station("213820", "Rhodes Station", -33.8308, 151.0879, setOf("train"))
    private val central = Station("200060", "Central Station", -33.884, 151.206, setOf("train", "metro"))
    private val manly = Station("209530", "Manly Wharf", -33.8, 151.28, setOf("ferry"))
    private val quay = Station("200020", "Circular Quay", -33.861, 151.21, setOf("train", "ferry"))
    private val commute = SavedTrip("commute", rhodes, central, createdAt = at("2026-09-01T07:00:00+10:00"))
    private val weekend = SavedTrip("weekend", quay, manly, createdAt = at("2026-09-01T07:00:00+10:00"))

    /** Weekday mornings out, weekday evenings back, weekend mornings on the ferry, over the two weeks before 25 September 2026. */
    private fun habits(): UserData {
        val history = (14..24).flatMap { day ->
            val date = "2026-09-%02d".format(day)
            val weekday = Instant.ofEpochMilli(at("${date}T12:00:00+10:00")).atZone(Sydney).dayOfWeek.value
            if (weekday >= 6) listOf(ViewEvent("weekend", false, at("${date}T10:05:00+10:00")))
            else listOf(ViewEvent("commute", false, at("${date}T08:05:00+10:00")), ViewEvent("commute", true, at("${date}T17:35:00+10:00")))
        }
        return UserData(trips = listOf(commute, weekend), history = history)
    }

    @Test fun scheduleIsAWeekOfHourlyNoLocationPredictionsAcrossMidnightAndTheWeekend() {
        val data = habits()
        val now = at("2026-09-25T22:40:00+10:00")
        val schedule = widgetSchedule(data, listOf(rhodes, central, quay, manly), now)

        assertEquals(168, schedule.size)
        assertEquals(at("2026-09-25T22:00:00+10:00"), schedule.first().at)
        assertTrue(schedule.zipWithNext().all { (a, b) -> b.at - a.at == 3_600_000L })
        schedule.forEach { entry ->
            val predicted = predict(data, emptyList(), null, entry.at)
            assertEquals(predicted?.tripId, entry.tripId)
            assertEquals(predicted?.reverse, entry.reverse)
        }
        assertEquals(at("2026-09-25T23:00:00+10:00"), widgetScheduleEntry(schedule, at("2026-09-25T23:00:00+10:00"))?.at)
        assertEquals(at("2026-09-26T00:00:00+10:00"), widgetScheduleEntry(schedule, at("2026-09-26T00:00:00+10:00"))?.at)
        assertEquals("weekend:false", pick(schedule, "2026-09-26T10:00:00+10:00"))
        assertEquals("weekend:false", pick(schedule, "2026-09-27T10:00:00+10:00"))
        assertEquals("commute:false", pick(schedule, "2026-09-28T08:00:00+10:00"))
        assertEquals("commute:true", pick(schedule, "2026-09-28T17:00:00+10:00"))
        assertEquals("commute:false", pick(schedule, "2026-10-02T08:00:00+10:00"))
    }

    @Test fun unexpiredFocusWinsOverTheScheduleUntilItExpires() {
        val now = at("2026-09-28T08:00:00+10:00")
        val journey = service(rhodes, central, now + 600_000, 25)
        val data = habits().copy(focus = FocusedJourney("commute", false, journey, BoardData(rhodes, central, listOf(journey), now, source = "live")))
        val schedule = widgetSchedule(data, emptyList(), now)
        val snapshot = widgetSnapshot(data, schedule, emptyList(), now)
        val expiry = journey.effectiveArrival + 1_800_000

        assertEquals(expiry, snapshot.focus?.expiresAt)
        assertEquals(journey.key, widgetAnswer(snapshot, now)?.focus?.journey?.key)
        assertEquals(journey.key, widgetAnswer(snapshot, expiry)?.focus?.journey?.key)
        assertNull(widgetAnswer(snapshot, expiry + 1)?.focus)
        assertEquals("commute", widgetAnswer(snapshot, expiry + 1)?.trip?.id)

        val ferry = service(manly, quay, now + 600_000, 20, "ferry", "F1")
        val weekendFocus = data.copy(focus = FocusedJourney("weekend", true, ferry, BoardData(manly, quay, listOf(ferry), now)))
        val pinned = widgetSnapshot(weekendFocus, schedule, emptyList(), now)
        assertEquals("weekend", widgetAnswer(pinned, now)?.trip?.id)
        assertEquals(manly.id, widgetAnswer(pinned, now)?.from?.id)
        assertEquals(true, widgetAnswer(pinned, now)?.focus?.pinned)

        assertNull(widgetSnapshot(data, schedule, emptyList(), expiry + 1).focus)
        assertNull(widgetSnapshot(data.copy(modes = setOf("metro", "ferry")), schedule, emptyList(), now).focus)
        val capped = weekendFocus.copy(flags = mapOf(TransferLimitFlag to true), transferLimit = TransferLimit.Direct,
            focus = weekendFocus.focus!!.copy(journey = Journey(ferry.legs + ferry.legs)))
        assertNull(widgetSnapshot(capped, schedule, emptyList(), now).focus)
    }

    @Test fun armedFocusKeepsItsRetentionDeadline() {
        val now = at("2026-09-28T08:00:00+10:00")
        val journey = service(rhodes, central, now - 3_600_000, 25)
        val focus = FocusedJourney("commute", false, journey, BoardData(rhodes, central, listOf(journey), now),
            arrivalGuard = ArrivalGuard(armed = true, retainedAt = now - 60_000))
        assertEquals(now - 60_000 + 7_200_000, focusExpiry(focus))
        val confirmed = focus.copy(arrivalGuard = ArrivalGuard(true, now - 60_000, ArrivalBasis.Location, now - 30_000))
        assertEquals(journey.effectiveArrival + 1_800_000, focusExpiry(confirmed))
    }

    @Test fun pastTheScheduleEndTheSameWeekdayAndHourAnswers() {
        val data = habits()
        val written = at("2026-09-25T22:40:00+10:00")
        val snapshot = widgetSnapshot(data, widgetSchedule(data, emptyList(), written), emptyList(), written)
        assertEquals(at("2026-10-02T22:00:00+10:00"), snapshot.schedule.last().at + 3_600_000)

        for (later in listOf("2026-10-05T08:30:00+11:00", "2026-10-12T17:10:00+11:00", "2026-10-03T10:15:00+10:00")) {
            val t = at(later)
            val zoned = Instant.ofEpochMilli(t).atZone(Sydney)
            val expected = snapshot.schedule.first {
                val z = Instant.ofEpochMilli(it.at).atZone(Sydney)
                z.dayOfWeek == zoned.dayOfWeek && z.hour == zoned.hour
            }
            assertEquals(later, expected, widgetScheduleEntry(snapshot.schedule, t))
        }
        assertEquals("commute:false", widgetAnswer(snapshot, at("2026-10-05T08:30:00+11:00"))?.let { "${it.trip.id}:${it.reverse}" })
        assertEquals("weekend:false", widgetAnswer(snapshot, at("2026-10-10T10:20:00+11:00"))?.let { "${it.trip.id}:${it.reverse}" })
    }

    @Test fun daylightSavingKeepsTheWeeklyAnswerOnLocalTime() {
        val schedule = widgetSchedule(habits(), emptyList(), at("2026-09-28T00:10:00+10:00"))
        val mondayEight = schedule.first { it.at == at("2026-09-28T08:00:00+10:00") }
        // Clocks go forward on 4 October: 168 elapsed hours before 08:30 AEDT is 07:30 AEST.
        assertEquals(mondayEight, widgetScheduleEntry(schedule, at("2026-10-05T08:30:00+11:00")))
    }

    @Test fun failedFetchFallsBackToTheAppsBoardWithRetainedProvenance() {
        val now = at("2026-09-28T08:00:00+10:00")
        val data = habits()
        val schedule = widgetSchedule(data, emptyList(), now)
        val cached = BoardData(rhodes, central, listOf(
            service(rhodes, central, now - 300_000, 25),
            service(rhodes, central, now + 240_000, 25),
            service(rhodes, central, now + 840_000, 25),
        ), now - 600_000, source = "live")
        val snapshot = widgetSnapshot(data, schedule, listOf(cached), now)
        assertEquals(2, snapshot.boards.single().journeys.size)

        val answer = widgetAnswer(snapshot, now)!!
        val request = widgetRequest(answer, snapshot, now)
        assertEquals(AllModes, request.modes)
        assertNull(request.transferLimit)
        assertNull(request.at)

        val failed = widgetContent(snapshot, mapOf(request.key to widgetSource(request, null)!!), now)
        assertEquals(true, failed.board?.offline)
        assertEquals(true, failed.next?.retained)
        assertEquals(now + 240_000, failed.next?.effectiveDeparture)
        assertEquals("Offline · last updated 10m ago", failed.provenance)

        val live = cached.copy(generatedAt = now - 20_000)
        val fetched = widgetContent(snapshot, mapOf(request.key to widgetSource(request, live)!!), now)
        assertEquals("Live", fetched.provenance)
        assertEquals(false, fetched.board?.offline)

        val timetable = snapshot.copy(boards = listOf(cached.copy(source = "schedule")))
        val timetableRequest = widgetRequest(answer, timetable, now)
        assertEquals("Offline · timetable",
            widgetContent(timetable, mapOf(timetableRequest.key to widgetSource(timetableRequest, null)!!), now).provenance)

        val noBoard = snapshot.copy(boards = emptyList())
        assertNull(widgetSource(widgetRequest(answer, noBoard, now), null))
        val empty = widgetContent(noBoard, emptyMap(), now)
        assertEquals("commute", empty.answer?.trip?.id)
        assertNull(empty.next)
        assertNull(empty.provenance)
    }

    @Test fun focusedFetchFollowsTheServiceAndRetainsItWhenUnmatched() {
        val now = at("2026-09-28T08:20:00+10:00")
        val journey = service(rhodes, central, now - 300_000, 25)
        val data = habits().copy(modes = setOf("train"), flags = mapOf(TransferLimitFlag to true), transferLimit = TransferLimit.Direct,
            focus = FocusedJourney("commute", false, journey, BoardData(rhodes, central, listOf(journey), now - 120_000, source = "live")))
        val snapshot = widgetSnapshot(data, widgetSchedule(data, emptyList(), now), emptyList(), now)
        val request = widgetRequest(widgetAnswer(snapshot, now)!!, snapshot, now)
        assertEquals(AllModes, request.modes)
        assertNull(request.transferLimit)
        assertEquals(journey.departure, request.at)

        val delayed = journey.copy(legs = listOf(journey.legs[0].copy(estimatedDeparture = journey.departure + 120_000)))
        val board = BoardData(rhodes, central, listOf(service(rhodes, central, now, 25), delayed), now - 10_000, source = "live")
        val matched = widgetContent(snapshot, mapOf(request.key to widgetSource(request, board)!!), now)
        assertEquals(delayed, matched.next)
        assertEquals("Live", matched.provenance)

        val gone = board.copy(journeys = listOf(service(rhodes, central, now, 25)))
        val unmatched = widgetContent(snapshot, mapOf(request.key to widgetSource(request, gone)!!), now)
        assertEquals(journey.key, unmatched.next?.key)
        assertEquals(true, unmatched.next?.retained)
        assertEquals("Offline · last updated 2m ago", unmatched.provenance)
    }

    @Test fun cappedPairRequestAndRedrawBoundaries() {
        val now = at("2026-09-28T08:00:00+10:00")
        val data = habits().copy(modes = setOf("train", "metro"), flags = mapOf(TransferLimitFlag to true), transferLimit = TransferLimit.Two)
        val snapshot = widgetSnapshot(data, widgetSchedule(data, emptyList(), now), emptyList(), now)
        val request = widgetRequest(widgetAnswer(snapshot, now)!!, snapshot, now)
        assertEquals(setOf("train", "metro"), request.modes)
        assertEquals(2, request.transferLimit)
        assertEquals(2, snapshot.transferCap)
        assertEquals(listOf("train", "metro"), snapshot.modes)

        val departures = listOf(4, 11, 19, 26).map { service(rhodes, central, now + it * 60_000L, 25) }
        val cancelled = departures[0].copy(legs = listOf(departures[0].legs[0].copy(cancelled = true)))
        val sources = mapOf(request.key to BoardData(rhodes, central, listOf(cancelled) + departures.drop(1), now - 30_000, source = "live"))
        val until = now + 1_800_000
        val dates = generateSequence(now) { widgetNextBoundary(snapshot, sources, it, until) }.toList()
        val contents = dates.map { widgetContent(snapshot, sources, it) }

        assertEquals(listOf(now, now + 60_001, now + 240_000, now + 660_000, now + 1_140_000, now + 1_560_000), dates)
        assertEquals(now + 660_000, contents[0].next?.effectiveDeparture)
        assertEquals(listOf(now + 1_140_000, now + 1_560_000), contents[0].following.map { it.effectiveDeparture })
        assertEquals("Live", contents[0].provenance)
        assertEquals("Last updated 1m ago", contents[1].provenance)
        assertEquals(now + 1_140_000, contents[3].next?.effectiveDeparture)
        assertNull(contents[5].next)
    }

    @Test fun noCompatibleTripIsTheEmptyState() {
        val now = at("2026-09-28T08:00:00+10:00")
        val data = habits().copy(modes = setOf("metro"))
        val snapshot = widgetSnapshot(data, widgetSchedule(data, emptyList(), now), emptyList(), now)
        assertTrue(snapshot.trips.isEmpty())
        assertTrue(snapshot.schedule.isEmpty())
        assertNull(widgetAnswer(snapshot, now))
        assertNull(widgetContent(snapshot, emptyMap(), now).answer)
        assertEquals(listOf("New trip"), homeWidgetLines(widgetContent(snapshot, emptyMap(), now), wide = false))
        assertNull(widgetNextBoundary(snapshot, emptyMap(), now, now + 86_400_000))

        val none = widgetSnapshot(UserData(), widgetSchedule(UserData(), emptyList(), now), emptyList(), now)
        assertTrue(none.schedule.isEmpty())
        assertNull(widgetAnswer(none, now))
    }

    @Test fun snapshotCarriesNothingPersonalBeyondTripsModesAndCap() {
        val now = at("2026-09-28T08:00:00+10:00")
        val home = Station("999001", "Secret Home Station", -33.9, 151.1)
        val board = BoardData(rhodes, central, listOf(service(rhodes, central, now + 300_000, 25)), now, source = "live")
        val data = habits().copy(
            rides = listOf(Ride("commute", false, now - 86_400_000, now - 85_000_000, rhodes, central)),
            votes = listOf(HomeVote("2026-09-27", home)), home = home, recentFrom = listOf(home), recentTo = listOf(home),
            useLocation = false, appearance = Appearance.Dark, journeyAlerts = false, lastTripId = "commute",
            lastAnswer = LastAnswer("commute", false, now, home.id, board, board.journeys[0]))
        val snapshot = widgetSnapshot(data, widgetSchedule(data, emptyList(), now), listOf(board), now)
        val encoded = WidgetWire.snapshot(snapshot)
        val text = encoded.toString()

        assertEquals(setOf("schemaVersion", "writtenAt", "trips", "schedule", "modes", "boards"), encoded.keys().asSequence().toSet())
        assertTrue(keys(encoded).intersect(setOf("history", "rides", "votes", "home", "recentFrom", "recentTo", "useLocation",
            "appearance", "journeyAlerts", "lastAnswer", "lastTripId", "lastReverse", "flags", "transferLimit", "arrivalGuard",
            "stationId")).isEmpty())
        assertFalse(text.contains(home.id))
        assertFalse(text.contains("Secret Home"))
        val trip = encoded.getJSONArray("trips").getJSONObject(0)
        assertEquals(setOf("id", "from", "to"), trip.keys().asSequence().toSet())
        assertEquals(setOf("id", "name", "modes"), trip.getJSONObject("from").keys().asSequence().toSet())
        assertEquals(snapshot, WidgetWire.snapshot(JSONObject(text)))
    }

    @Test fun onlyAnAnswerChangeAsksForARedrawAndContentSurvivesWidgetState() {
        val now = at("2026-09-28T08:00:00+10:00")
        val data = habits()
        val schedule = widgetSchedule(data, emptyList(), now)
        val board = BoardData(rhodes, central, listOf(service(rhodes, central, now + 300_000, 25)), now, source = "live")
        val first = widgetSnapshot(data, schedule, listOf(board), now)
        assertTrue(widgetAnswerChanged(null, first))
        assertFalse(widgetAnswerChanged(first, widgetSnapshot(data, schedule, listOf(board.copy(generatedAt = now + 30_000)), now + 30_000)))
        assertTrue(widgetAnswerChanged(first, widgetSnapshot(data.copy(modes = setOf("train", "metro")), schedule, listOf(board), now)))
        val pinned = data.copy(focus = FocusedJourney("commute", false, board.journeys[0], board))
        assertTrue(widgetAnswerChanged(first, widgetSnapshot(pinned, schedule, listOf(board), now)))

        val request = widgetRequest(widgetAnswer(first, now)!!, first, now)
        val content = widgetContent(first, mapOf(request.key to widgetSource(request, board)!!), now)
        assertEquals(content, WidgetWire.content(JSONObject(WidgetWire.content(content).toString())))
        assertEquals(listOf("Rhodes → Central", clockTime(now + 300_000), "Live"), homeWidgetLines(content, wide = true))
    }

    private fun service(from: Station, to: Station, departs: Long, minutes: Int, mode: String = "train", line: String = "T9") =
        Journey(listOf(Leg(line, mode, to.name, from, to, departs, departs + minutes * 60_000L)))

    private fun pick(schedule: List<WidgetScheduleEntry>, time: String) =
        widgetScheduleEntry(schedule, at(time))?.let { "${it.tripId}:${it.reverse}" }

    private fun keys(value: Any?): Set<String> = when (value) {
        is JSONObject -> value.keys().asSequence().toSet() + value.keys().asSequence().flatMap { keys(value.opt(it)) }
        is JSONArray -> (0 until value.length()).flatMap { keys(value.opt(it)) }.toSet()
        else -> emptySet()
    }
}

private fun at(value: String) = OffsetDateTime.parse(value).toInstant().toEpochMilli()
