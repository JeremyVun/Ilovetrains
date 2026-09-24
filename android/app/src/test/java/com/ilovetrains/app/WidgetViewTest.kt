package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test
import java.time.OffsetDateTime

/** Roboto's proportions closely enough to exercise every fitting decision off-device. */
internal object FakeWidgetMeasure : WidgetMeasure {
    override fun width(text: String, font: WidgetFont) = text.length * font.sp * when (font.face) {
        WidgetFace.Label -> .62f
        WidgetFace.Chip -> .6f
        WidgetFace.Regular -> .52f
        else -> .5f
    }
    override fun lineHeight(font: WidgetFont) = font.sp * 1.17f
}

class WidgetViewTest {
    private val rhodes = Station("213820", "Rhodes Station", modes = setOf("train"))
    private val townHall = Station("200070", "Town Hall Station", modes = setOf("train"))
    private val bondi = Station("202210", "Bondi Junction Station", modes = setOf("train"))
    private val quay = Station("200020", "Circular Quay", modes = setOf("train", "ferry"))
    private val manly = Station("209530", "Manly Wharf", modes = setOf("ferry"))
    private val small = 179.4f to 203.8f
    private val wide = 373.7f to 203.8f

    private fun t(hm: String) = OffsetDateTime.parse("2026-09-23T$hm:00+10:00").toInstant().toEpochMilli()

    /** Rhodes to Bondi Junction by T9 to Town Hall, then T4, the round's main trip. */
    private fun trip(departs: String, late: Int = 0, realtime: Boolean = true, cancelled: Boolean = false): Journey {
        val dep = t(departs)
        fun est(time: Long) = if (realtime) time + late * 60_000L else null
        return Journey(listOf(
            Leg("T9", "train", "Gordon via Lindfield", rhodes, townHall, dep, dep + 27 * 60_000L, est(dep), est(dep + 27 * 60_000L),
                "1", "3", cancelled),
            Leg("T4", "train", "Bondi Junction", townHall, bondi, dep + 34 * 60_000L, dep + 44 * 60_000L,
                if (realtime) dep + 34 * 60_000L else null, if (realtime) dep + 44 * 60_000L else null, "5", "2"),
        ))
    }

    private fun snapshot(now: Long, focus: WidgetFocus? = null, from: Station = rhodes, to: Station = bondi) = WidgetSnapshot(now,
        listOf(WidgetTrip("commute", WidgetStop(from.id, from.name, from.modes.toList()), WidgetStop(to.id, to.name, to.modes.toList()))),
        widgetSchedule(now, 2) { "commute" to false }, focus, listOf("train", "ferry"), null, emptyList())

    private fun content(now: Long, board: BoardData?, focus: WidgetFocus? = null, from: Station = rhodes, to: Station = bondi): WidgetContent {
        val snapshot = snapshot(now, focus, from, to)
        val request = widgetRequest(widgetAnswer(snapshot, now)!!, snapshot, now)
        return widgetContent(snapshot, listOfNotNull(board?.let { request.key to widgetSource(request, it)!! }).toMap(), now)
    }

    private fun view(content: WidgetContent, size: Pair<Float, Float>) = widgetView(content, size.first, size.second, FakeWidgetMeasure)
    private fun live(vararg journeys: Journey, at: String = "09:18") = BoardData(rhodes, bondi, journeys.toList(), t(at), source = "live")

    @Test fun smallIsTheDepartureClockWithTheTrackerSentencePlatformArrivalAndFreshness() {
        val v = view(content(t("09:21"), live(trip("09:24"), trip("09:39"), trip("09:54"))), small) as WidgetSmall
        assertEquals("Rhodes\u00A0→ Bondi Jn", v.route?.text)
        assertEquals("09:24", v.clock?.text)
        assertEquals(WidgetTone.Ink, v.clock?.tone)
        assertEquals(WidgetSentence("T9 leaves in ", t("09:24"), 13f), v.sentence)
        assertEquals(WidgetChip("PLATFORM 1", "T9", "train"), v.cap)
        assertEquals("→ 10:08", v.arrival?.text)
        assertEquals("LAST UPDATED 09:18", v.foot?.text)
        assertTrue(v.meta.isEmpty())
        assertNull(v.kicker)
    }

    @Test fun lateCancelledAndScheduledLeadsSpeakTheBoardsProvenance() {
        val late = view(content(t("09:21"), live(trip("09:24", late = 5), trip("09:39"))), small) as WidgetSmall
        assertEquals("09:29", late.clock?.text)
        assertEquals(WidgetTone.Warn, late.clock?.tone)
        assertEquals(listOf("09:24", "5 MIN LATE"), late.meta.map { it.text })
        assertTrue(late.meta[0].struck)

        val cancelled = content(t("09:21"), live(trip("09:24", cancelled = true), trip("09:39"), trip("09:54")))
        val small = view(cancelled, small) as WidgetSmall
        assertEquals("09:24 CANCELLED", small.note?.text)
        assertEquals("09:39", small.clock?.text)
        val board = view(cancelled, wide) as WidgetBoard
        assertEquals(listOf("09:24", "09:39", "09:54"), board.rows.map { it.clock.text })
        val struck = board.rows[0] as WidgetServiceRow
        assertTrue(struck.clock.struck && struck.arrival.struck && struck.lane.faded)
        assertEquals(listOf("CANCELLED"), struck.meta.map { it.text })
        assertEquals("T9 leaves in ", board.sentence?.lead)
        assertEquals(t("09:39"), board.sentence?.deadline)

        val scheduled = view(content(t("10:18"), live(trip("10:24", realtime = false), trip("10:39", realtime = false))), wide) as WidgetBoard
        assertEquals(listOf("SCHEDULED"), (scheduled.rows[0] as WidgetServiceRow).meta.map { it.text })
        assertEquals(WidgetTone.Ink2, scheduled.rows[0].clock.tone)
        assertEquals(listOf("— END OF BOARD", "Nothing scheduled after 10:39."), scheduled.end.map { it.text })
    }

    @Test fun wideIsAMiniatureBoardOfTheLeadAndTheTwoFollowingDepartures() {
        val v = view(content(t("09:21"), live(trip("09:24"), trip("09:39"), trip("09:54"), trip("10:09"))), wide) as WidgetBoard
        assertEquals("Rhodes\u00A0→ Bondi Junction", v.route?.text)
        assertEquals(listOf("09:24", "09:39", "09:54"), v.rows.map { it.clock.text })
        assertEquals(WidgetFace.Light, v.rows[0].clock.font.face)
        assertEquals(WidgetFace.Thin, v.rows[1].clock.font.face)
        assertEquals("LAST UPDATED 09:18", v.foot?.text)
        assertTrue(v.end.isEmpty())
        val lane = (v.rows[0] as WidgetServiceRow).lane
        assertEquals(v.laneWidth - lane.start, lane.segments.sumOf { it.width.toDouble() }.toFloat(), .01f)
        assertEquals(listOf("1", "3", "5"), lane.chips.map { it.chip.text })
        assertTrue(lane.chips.zipWithNext().all { (a, b) -> a.x + a.width <= b.x })
        assertTrue(lane.chips.last().x + lane.chips.last().width <= v.laneWidth + .01f)
        assertEquals(listOf("T9", null, "T4"), lane.segments.map { it.line })
    }

    @Test fun retainedBoardSaysOfflineAndNoBoardSaysOnlyOffline() {
        val now = t("09:21")
        val snapshot = snapshot(now).copy(boards = listOf(live(trip("09:24"), trip("09:39"), at = "09:02")))
        val request = widgetRequest(widgetAnswer(snapshot, now)!!, snapshot, now)
        val retained = widgetContent(snapshot, mapOf(request.key to widgetSource(request, null)!!), now)
        val v = view(retained, small) as WidgetSmall
        assertEquals("OFFLINE · LAST UPDATED 09:02", v.foot?.text)
        assertEquals(WidgetTone.Warn, v.foot?.tone)
        assertEquals(2, v.foot?.maxLines)

        val nothing = view(content(now, null), small) as WidgetSmall
        assertEquals("— NO SAVED BOARD FOR THIS TRIP YET", nothing.message?.text)
        assertEquals("OFFLINE", nothing.foot?.text)
        assertNull(nothing.clock)
        val none = view(content(t("01:10"), live(at = "01:08")), wide) as WidgetBoard
        assertEquals("— NO SERVICES IN THE NEXT FEW HOURS", none.message?.text)
        assertEquals("LAST UPDATED 01:08", none.foot?.text)
    }

    @Test fun pinnedServiceIsMarkedAndRidingShowsTheNextStep() {
        val pinned = trip("09:39")
        val board = live(trip("09:24"), pinned, trip("09:54"), at = "09:19")
        val focus = WidgetFocus("commute", false, true, pinned, board, pinned.effectiveArrival + 1_800_000)
        val before = content(t("09:21"), board, focus)
        val small = view(before, small) as WidgetSmall
        assertEquals(listOf(null, "PINNED"), small.kicker?.parts?.map { it?.text })
        assertEquals("09:39", small.clock?.text)
        val wide = view(before, wide) as WidgetBoard
        assertEquals(listOf("09:39", "09:54"), wide.rows.map { it.clock.text })
        assertTrue((wide.rows[0] as WidgetServiceRow).pinned)

        val riding = content(t("09:48"), board.copy(generatedAt = t("09:45")), focus)
        val ride = view(riding, this.small) as WidgetSmall
        assertEquals(listOf("RUNNING", " · ", null, "PINNED"), ride.kicker?.parts?.map { it?.text })
        assertEquals("10:06", ride.clock?.text)
        assertEquals(WidgetSentence("Town Hall in ", t("10:06"), 13f), ride.sentence)
        assertEquals(listOf("GET OFF", "Town Hall"), ride.step.map { it.text })
        assertEquals(WidgetChip("PLATFORM 3", "T9", "train"), ride.cap)
        assertEquals("10:13", ride.nextStep?.time?.text)
        assertEquals("BOARD T4", ride.nextStep?.action?.text)
        val steps = view(riding, this.wide) as WidgetBoard
        assertEquals(listOf("10:06", "10:13", "10:23"), steps.rows.map { it.clock.text })
        assertEquals(listOf("GET OFF", "BOARD T4 · BONDI JUNCTION", "ARRIVE"), steps.rows.map { (it as WidgetStepRow).action.text })
        assertEquals("Town Hall in ", steps.sentence?.lead)
    }

    @Test fun ferryCapWrapsItsArrivalAndLongNamesShortenThenWrap() {
        val now = t("15:36")
        val ferry = Journey(listOf(Leg("MFF", "ferry", "Manly", quay, manly, t("15:40"), t("16:00"), fromPlatform = "Wharf 2, Side A")))
        val v = view(content(now, BoardData(quay, manly, listOf(ferry), t("15:34"), source = "live"), from = quay, to = manly), small) as WidgetSmall
        assertEquals(WidgetChip("WHARF 2, SIDE A", "MFF", "ferry"), v.cap)
        assertTrue(v.stacked)
        assertEquals(listOf("SCHEDULED"), v.meta.map { it.text })
        assertEquals("MFF leaves in ", v.sentence?.lead)

        assertEquals("Circular\u00A0Quay\u00A0→ Manly\u00A0Wharf", v.route?.text)
        assertEquals(2, v.route?.maxLines)
        val names = fitRoute("Sydney Olympic Park Wharf", "Southern Cross (Melbourne)", WidgetType.Route, 147.4f, FakeWidgetMeasure, WidgetTone.Ink2)
        assertTrue(names.maxLines > 1)
        assertFalse(names.text.contains('…'))
        assertEquals("North Strathfield\u00A0→ Bondi Junction",
            fitRoute("North Strathfield", "Bondi Junction", WidgetType.Route, 400f, FakeWidgetMeasure, WidgetTone.Ink2).text)
        assertEquals("N Strathfield\u00A0→ Bondi Jn",
            fitRoute("North Strathfield", "Bondi Junction", WidgetType.Route, 170f, FakeWidgetMeasure, WidgetTone.Ink2).text)
    }

    @Test fun emptyStateReusesSetupsWords() {
        val empty = view(WidgetContent(t("09:21"), null, null, null, emptyList(), null), small) as WidgetEmpty
        assertEquals("+ NEW TRIP", empty.kicker.text)
        assertEquals("Choose where you start", empty.message.text)
        assertEquals(WidgetBlank, widgetView(null, 179.4f, 203.8f, FakeWidgetMeasure))
    }

    @Test fun everyTextIsAtLeastElevenSpAtEverySize() {
        val board = live(trip("09:24", late = 5), trip("09:39", cancelled = true), trip("09:54", realtime = false))
        val pinned = trip("09:24")
        val focus = WidgetFocus("commute", false, true, pinned, live(pinned), pinned.effectiveArrival + 1_800_000)
        val contents = listOf(content(t("09:21"), board), content(t("09:21"), null), content(t("09:48"), live(pinned, at = "09:45"), focus),
            content(t("09:21"), live(pinned), focus), WidgetContent(t("09:21"), null, null, null, emptyList(), null))
        val sizes = listOf(small, wide, 146f to 160f, 300f to 150f, 180f to 300f, 400f to 360f)
        for (c in contents) for ((w, h) in sizes) {
            val v = widgetView(c, w, h, FakeWidgetMeasure)
            texts(v).forEach { assertTrue("${it.text} at ${it.font.sp}sp in ${w}x$h", it.font.sp >= 11f) }
            sentences(v).forEach { assertTrue(it.sp >= 11f) }
        }
        assertTrue(WidgetType.Chip.sp >= 14f)
    }

    private fun texts(v: WidgetView): List<WidgetText> = when (v) {
        WidgetBlank -> emptyList()
        is WidgetEmpty -> listOf(v.kicker, v.message)
        is WidgetSmall -> listOfNotNull(v.route, v.note, v.clock, v.arrival, v.message, v.foot) + v.meta + v.step +
            v.kicker?.parts.orEmpty().filterNotNull() + listOfNotNull(v.nextStep?.time, v.nextStep?.action)
        is WidgetBoard -> listOfNotNull(v.route, v.message, v.foot) + v.end + v.kicker?.parts.orEmpty().filterNotNull() +
            v.rows.flatMap { row -> when (row) {
                is WidgetServiceRow -> listOf(row.clock, row.arrival) + row.meta
                is WidgetStepRow -> listOfNotNull(row.clock, row.action, row.station)
            } }
    }

    private fun sentences(v: WidgetView) = listOfNotNull((v as? WidgetSmall)?.sentence, (v as? WidgetBoard)?.sentence)
}
