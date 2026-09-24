package com.ilovetrains.app

import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.appwidget.updateAll
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.json.JSONObject
import org.junit.runner.RunWith
import java.time.LocalTime
import java.time.ZonedDateTime

/**
 * Seeds every placed home widget with one of the comps round's scenarios, shifted to the current minute, and
 * stops the widget's own refresh so the capture is not overwritten; `refresh` hands it back to live data, and
 * `probe` logs (tag WidgetProbe) the view each placed widget draws at every size the launcher reports.
 * Skipped unless a scenario is named:
 * `adb shell am instrument -w -e class com.ilovetrains.app.HomeWidgetScenarios -e scenario late
 * com.ilovetrains.app.test/androidx.test.runner.AndroidJUnitRunner`.
 */
@RunWith(AndroidJUnit4::class)
class HomeWidgetScenarios {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun seed() = runBlocking {
        val name = InstrumentationRegistry.getArguments().getString("scenario")
        assumeTrue(name != null)
        if (name == "refresh") {
            HomeWidgetWork.refresh(context)
            delay(10_000)
            return@runBlocking
        }
        if (name == "probe") {
            val manager = GlanceAppWidgetManager(context)
            val measure = PaintWidgetMeasure(context)
            manager.getGlanceIds(HomeTripWidget::class.java).forEach { id ->
                val content = getAppWidgetState(context, PreferencesGlanceStateDefinition, id)[WidgetContentKey]
                    ?.let { WidgetWire.content(JSONObject(it)) }
                manager.getAppWidgetSizes(id).forEach { size ->
                    "$id ${size.width.value}x${size.height.value} ${widgetView(content, size.width.value, size.height.value, measure)}"
                        .chunked(3000).forEach { Log.i("WidgetProbe", it) }
                }
            }
            return@runBlocking
        }
        val content = requireNotNull(scenario(name!!, System.currentTimeMillis())) { "Unknown scenario $name" }
        HomeWidgetWork.cancel(context)
        val json = WidgetWire.content(content).toString()
        GlanceAppWidgetManager(context).getGlanceIds(HomeTripWidget::class.java).forEach { id ->
            updateAppWidgetState(context, id) { it[WidgetContentKey] = json }
        }
        HomeTripWidget().updateAll(context)
        // The Glance session renders asynchronously; the instrumented process must outlive it.
        delay(5_000)
    }

    private val rhodes = Station("213820", "Rhodes Station", modes = setOf("train"))
    private val townHall = Station("200070", "Town Hall Station", modes = setOf("train"))
    private val bondi = Station("202210", "Bondi Junction Station", modes = setOf("train"))
    private val quay = Station("200020", "Circular Quay Station", modes = setOf("train", "ferry"))
    private val manly = Station("209530", "Manly Wharf", modes = setOf("ferry"))
    private val olympic = Station("213590", "Sydney Olympic Park Wharf", modes = setOf("ferry"))
    private val melbourne = Station("900001", "Southern Cross (Melbourne)", modes = setOf("train"))

    /** Scenario clock times, moved so that the scenario's own minute is the current one. */
    private class Clock(scenarioNow: String, private val realNow: Long) {
        private val today = ZonedDateTime.now(Sydney).withSecond(0).withNano(0)
        private val shift = realNow - realNow % 60_000 - at(scenarioNow)
        fun at(hm: String): Long = today.with(LocalTime.parse(hm)).toInstant().toEpochMilli()
        operator fun invoke(hm: String) = at(hm) + shift
        val now get() = realNow
    }

    private fun Clock.change(from: Station, via: Station, to: Station, times: List<String>, late: Int = 0, cancelled: Boolean = false,
                             realtime: Boolean = true, first: String = "T9", second: String = "T4",
                             platforms: List<String> = listOf("1", "3", "5", "2"), headsign: String = "Bondi Junction"): Journey {
        val (dep, arr, dep2, arr2) = times.map { this(it) }
        fun est(t: Long, by: Int = 0) = if (realtime) t + by * 60_000L else null
        return Journey(listOf(
            Leg(first, "train", "Gordon via Lindfield", from, via, dep, arr, est(dep, late), est(arr, late), platforms[0], platforms[1], cancelled),
            Leg(second, "train", headsign, via, to, dep2, arr2, est(dep2), est(arr2), platforms[2], platforms[3]),
        ))
    }

    private fun Clock.outbound(realtime: Boolean = true) = listOf(
        change(rhodes, townHall, bondi, listOf("09:24", "09:51", "09:58", "10:08"), realtime = realtime),
        change(rhodes, townHall, bondi, listOf("09:39", "10:06", "10:12", "10:22"), realtime = realtime),
        change(rhodes, townHall, bondi, listOf("09:54", "10:18", "10:28", "10:42"), realtime = realtime),
        change(rhodes, townHall, bondi, listOf("10:09", "10:36", "10:43", "10:53"), realtime = realtime),
    )

    private fun stop(station: Station) = WidgetStop(station.id, station.name, station.modes.toList())

    private fun content(clock: Clock, from: Station, to: Station, board: BoardData?, reverse: Boolean = false,
                        focus: ((Long) -> WidgetFocus)? = null, retained: Boolean = false): WidgetContent {
        val trip = if (reverse) WidgetTrip("commute", stop(to), stop(from)) else WidgetTrip("commute", stop(from), stop(to))
        val snapshot = WidgetSnapshot(clock.now, listOf(trip), widgetSchedule(clock.now, 2) { "commute" to reverse },
            focus?.invoke(clock.now), listOf("train", "metro", "ferry"), null, listOfNotNull(board?.takeIf { retained }))
        val request = widgetRequest(widgetAnswer(snapshot, clock.now)!!, snapshot, clock.now)
        val source = widgetSource(request, board?.takeUnless { retained })
        return widgetContent(snapshot, listOfNotNull(source?.let { request.key to it }).toMap(), clock.now)
    }

    private fun scenario(name: String, now: Long): WidgetContent? = when (name) {
        "live" -> Clock("09:21", now).let { c -> content(c, rhodes, bondi, BoardData(rhodes, bondi, c.outbound(), c("09:18"), "live")) }
        "late" -> Clock("09:21", now).let { c ->
            val late = c.change(rhodes, townHall, bondi, listOf("09:24", "09:51", "09:58", "10:08"), late = 5)
            content(c, rhodes, bondi, BoardData(rhodes, bondi, listOf(late) + c.outbound().drop(1), c("09:19"), "live"))
        }
        "cxl" -> Clock("09:21", now).let { c ->
            val cancelled = c.change(rhodes, townHall, bondi, listOf("09:24", "09:51", "09:58", "10:08"), cancelled = true)
            content(c, rhodes, bondi, BoardData(rhodes, bondi, listOf(cancelled) + c.outbound().drop(1), c("09:19"), "live"))
        }
        "sched" -> Clock("10:18", now).let { c ->
            val tail = listOf(c.change(rhodes, townHall, bondi, listOf("10:24", "10:51", "11:02", "11:12"), realtime = false),
                c.change(rhodes, townHall, bondi, listOf("10:39", "11:06", "11:10", "11:22"), realtime = false))
            content(c, rhodes, bondi, BoardData(rhodes, bondi, tail, c("10:15"), "live"))
        }
        "stale" -> Clock("09:21", now).let { c ->
            content(c, rhodes, bondi, BoardData(rhodes, bondi, c.outbound(), c("09:02"), "live"), retained = true)
        }
        "pinned" -> Clock("09:21", now).let { c ->
            val board = BoardData(rhodes, bondi, c.outbound(), c("09:19"), "live")
            val pinned = board.journeys[1]
            content(c, rhodes, bondi, board, focus = { WidgetFocus("commute", false, true, pinned, board, pinned.effectiveArrival + 1_800_000) })
        }
        "riding" -> Clock("09:33", now).let { c ->
            val board = BoardData(rhodes, bondi, c.outbound(), c("09:30"), "live")
            val pinned = board.journeys[0]
            content(c, rhodes, bondi, board, focus = { WidgetFocus("commute", false, true, pinned, board, pinned.effectiveArrival + 1_800_000) })
        }
        "home" -> Clock("18:12", now).let { c ->
            val back = listOf(listOf("18:24", "18:38", "18:47", "19:08"), listOf("18:39", "18:53", "19:01", "19:22"),
                listOf("18:54", "19:08", "19:21", "19:42")).map {
                c.change(bondi, townHall, rhodes, it, first = "T4", second = "T9", platforms = listOf("2", "5", "3", "1"), headsign = "Hornsby")
            }
            content(c, bondi, rhodes, BoardData(bondi, rhodes, back, c("18:10"), "live"), reverse = true)
        }
        "ferry" -> Clock("15:36", now).let { c ->
            fun ferry(line: String, dep: String, arr: String, wharf: String, realtime: Boolean) = Journey(listOf(Leg(line, "ferry", "Manly",
                quay, manly, c(dep), c(arr), if (realtime) c(dep) else null, if (realtime) c(arr) else null, wharf)))
            content(c, quay, manly, BoardData(quay, manly, listOf(ferry("MFF", "15:40", "16:00", "Wharf 2, Side A", false),
                ferry("F1", "15:45", "16:07", "Wharf 3, Side A", true), ferry("F1", "15:50", "16:20", "Wharf 3, Side B", true)), c("15:34"), "live"))
        }
        "long" -> Clock("09:21", now).let { c ->
            val journeys = c.outbound().map { j -> Journey(listOf(j.legs[0].copy(from = olympic), j.legs[1].copy(to = melbourne))) }
            content(c, olympic, melbourne, BoardData(olympic, melbourne, journeys, c("09:18"), "live"))
        }
        "none" -> Clock("01:10", now).let { c -> content(c, rhodes, bondi, BoardData(rhodes, bondi, emptyList(), c("01:08"), "live")) }
        "nodata" -> Clock("09:21", now).let { c -> content(c, rhodes, bondi, null) }
        "empty" -> WidgetContent(now, null, null, null, emptyList(), null)
        else -> null
    }
}
