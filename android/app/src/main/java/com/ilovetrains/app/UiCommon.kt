package com.ilovetrains.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

val PagePadding = 22.dp

@Composable
fun Label(text: String, modifier: Modifier = Modifier, color: Color = LocalTrainColors.current.ink3,
          size: Int = 10, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) {
    Text(text.uppercase(Locale.ENGLISH), modifier = modifier, color = color, fontSize = size.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (size * .16f).sp, textAlign = align, maxLines = maxLines,
        overflow = TextOverflow.Clip, lineHeight = (size * 1.35f).sp)
}

@Composable
fun Rule(modifier: Modifier = Modifier, heavy: Boolean = false) {
    val c = LocalTrainColors.current
    Box(modifier.fillMaxWidth().height(if (heavy) 2.dp else 1.dp)
        .background(if (heavy) c.ink.copy(alpha = .82f) else c.rule))
}

@Composable
fun Freshness(board: BoardData?, now: Long, modifier: Modifier = Modifier) {
    if (board == null) return
    val c = LocalTrainColors.current
    val live = board.isLive(now)
    val stale = board.offline || now - board.generatedAt > 90_000
    val text = when {
        board.offline && board.source == "schedule" -> "Offline · timetable${board.coverage.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}"
        board.offline -> "Offline · last updated ${ageText(now - board.generatedAt)} ago"
        stale -> "Last updated ${ageText(now - board.generatedAt)} ago"
        live -> "Live"
        else -> "Updated ${ageText(now - board.generatedAt)} ago"
    }
    Row(modifier.heightIn(min = 36.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(
            if (live) c.live else if (stale) c.warning else c.ink3))
        Spacer(Modifier.width(8.dp))
        Label(text, color = if (board.offline) c.warning else c.ink3)
    }
}

fun ageText(age: Long): String = when {
    age < 60_000 -> "${(age.coerceAtLeast(0) / 1000)}s"
    age < 3_600_000 -> "${age / 60_000}m"
    else -> "${age / 3_600_000}h"
}

@Composable
fun BackButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = LocalTrainColors.current
    Row(modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onClick)
        .padding(end = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, Modifier.size(17.dp), tint = c.ink3)
        Spacer(Modifier.width(9.dp))
        Label(label, color = c.ink2, size = 11, maxLines = 1)
    }
}

@Composable
fun Chevron(modifier: Modifier = Modifier) {
    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, modifier.size(18.dp), LocalTrainColors.current.ink3)
}

@Composable
fun ActionRail(text: String, onClick: () -> Unit, enabled: Boolean = true, minHeight: Dp = 64.dp) {
    val c = LocalTrainColors.current
    Column {
        Rule(heavy = true)
        Box(Modifier.fillMaxWidth().heightIn(min = minHeight).clickable(enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = PagePadding), contentAlignment = Alignment.CenterStart) {
            Label(text, color = if (enabled) c.ink else c.ink3, size = 13)
        }
    }
}

@Composable
fun LineChip(line: String, mode: String, text: String = line, modifier: Modifier = Modifier,
             height: Dp = 22.dp, horizontalPadding: Dp = 7.dp, dimmed: Boolean = false) {
    val c = LocalTrainColors.current
    // The chip is sized in text units: enlarged text grows it instead of being clipped by it.
    Box(modifier.height(height * LocalDensity.current.fontScale).clip(RoundedCornerShape(LineChipCornerRadius))
        .background(lineColor(line, mode, c, fill = true)).testTag("chip-$text"),
        contentAlignment = Alignment.Center) {
        Text(text.uppercase(), modifier = Modifier.padding(horizontal = horizontalPadding), color = chipInk(line, mode, c), fontSize = 14.sp,
            fontWeight = FontWeight.Bold, letterSpacing = 0.sp, maxLines = 1, softWrap = false)
        if (dimmed) Box(Modifier.matchParentSize().background(c.ground.copy(alpha = .62f)))
    }
}

internal val LineChipCornerRadius = 3.dp

fun platformText(raw: String?, mode: String, full: Boolean = false): String? {
    if (raw.isNullOrBlank()) return null
    val value = raw.trim()
    val place = if (mode.equals("ferry", true)) "Wharf" else "Platform"
    if (full) {
        if (Regex("\\b$place\\b", RegexOption.IGNORE_CASE).containsMatchIn(value)) return value
        if (place == "Wharf" && value.startsWith("Side", ignoreCase = true)) return value
        return "$place $value"
    }
    val cleaned = value.replace(Regex("^(Platform|Wharf)\\s*", RegexOption.IGNORE_CASE), "")
    if (mode.equals("ferry", true)) {
        val numbered = Regex("\\d+").find(cleaned)?.value
        val side = Regex("Side\\s*([A-Za-z0-9]+)", RegexOption.IGNORE_CASE).find(cleaned)?.groupValues?.get(1)
        return if (numbered == null) side ?: "Wharf" else numbered + (side ?: "")
    }
    val platform = Regex("[A-Za-z0-9]+(?:[A-Za-z])?").find(cleaned)?.value ?: cleaned
    return platform
}

fun departureCapText(raw: String?, mode: String): String? {
    val compact = platformText(raw, mode) ?: return null
    if (!mode.equals("ferry", true)) return platformText(raw, mode, full = true)
    return if (compact == "Wharf") "Wharf" else platformText(raw, mode, full = true)
}

fun minutesBetween(from: Long, to: Long): Int = ((to / 60_000) - (from / 60_000)).toInt()

data class Figure(val value: String, val unit: String = "", val provenance: String = "", val past: Boolean = false)

fun figureFor(journey: Journey, board: BoardData?, now: Long): Figure {
    val departure = journey.effectiveDeparture
    val stale = board == null || board.offline || journey.retained || now - board.generatedAt > 90_000
    val mins = minutesBetween(now, departure)
    if (journey.cancelled) return Figure("—", provenance = "Cancelled", past = mins < 0)
    if (mins < 0) {
        val elapsed = abs(mins)
        return if (elapsed > 99) Figure((elapsed / 60f).roundToInt().toString(), "H", "Ago", past = true)
            else Figure(elapsed.toString(), "min", "Ago", past = true)
    }
    val liveRealtime = !stale && board?.source == "live" && journey.realtime
    val late = minutesBetween(journey.departure, journey.effectiveDeparture)
    val provenance = when {
        late > 0 -> "$late min late"
        !liveRealtime -> "Scheduled"
        mins == 0 -> "Departing"
        else -> ""
    }
    if (mins == 0) return Figure("Now", provenance = provenance)
    if (mins > 99) return Figure(((mins / 60f).roundToInt()).toString(), "H", provenance)
    return Figure(mins.toString(), "min", provenance)
}

fun directionFigureFor(journey: Journey, now: Long): Figure? {
    if (now < journey.effectiveDeparture || now >= journey.effectiveArrival) return null
    journey.legs.forEachIndexed { index, leg ->
        val next = journey.legs.getOrNull(index + 1)
        val target = when {
            now < leg.effectiveArrival -> leg.effectiveArrival
            next != null && now < next.effectiveDeparture -> next.effectiveDeparture
            else -> return@forEachIndexed
        }
        val minutes = minutesBetween(now, target).coerceAtLeast(0)
        val provenance = if (next == null) "To go" else "To change"
        return if (minutes > 99) Figure((minutes / 60f).roundToInt().toString(), "H", provenance)
            else Figure(minutes.toString(), "min", provenance)
    }
    return null
}

internal sealed interface AxisElement {
    data object Cap : AxisElement
    data class Ride(val index: Int) : AxisElement
    data class Dwell(val index: Int) : AxisElement
    data class Alight(val index: Int) : AxisElement
    data class Board(val index: Int) : AxisElement
    data class StationLabel(val index: Int) : AxisElement
    data object TinyTrain : AxisElement
    data object Progress : AxisElement
}

internal data class AxisSize(val width: Int, val height: Int)
internal data class AxisFrame(var x: Int = 0, var y: Int = 0, var width: Int = 0, var height: Int = 0)

internal fun journeyAxisFrames(
    journey: Journey,
    width: Int,
    elements: List<AxisElement>,
    sizes: List<AxisSize>,
    barHeight: Int,
    baseChipHeight: Int,
    minimumHeight: Int,
    itemGap: Int,
    labelTopGap: Int,
    labelCollisionGap: Int,
    ridePaintInset: Int,
    progress: Float?,
): Pair<List<AxisFrame>, Int> {
    val safeWidth = width.coerceAtLeast(1)
    val capIndex = elements.indexOf(AxisElement.Cap)
    val capWidth = sizes.getOrNull(capIndex)?.width ?: 0
    val axisWidth = (safeWidth - capWidth).coerceAtLeast(1)
    val duration = (journey.effectiveArrival - journey.effectiveDeparture).coerceAtLeast(1)
    fun x(instant: Long): Int = capWidth + (axisWidth *
        ((instant - journey.effectiveDeparture).toDouble() / duration).coerceIn(0.0, 1.0)).roundToInt()
    val frames = MutableList(elements.size) { AxisFrame() }
    val chipHeight = maxOf(baseChipHeight, elements.indices.filter {
        elements[it] == AxisElement.Cap || elements[it] is AxisElement.Alight || elements[it] is AxisElement.Board
    }.maxOfOrNull { sizes[it].height } ?: 0)
    val pins = mutableListOf<Int>()
    val labels = mutableListOf<Int>()
    elements.forEachIndexed { index, element ->
        val size = sizes[index]
        frames[index] = when (element) {
            AxisElement.Cap -> AxisFrame(0, 0, size.width, size.height)
            is AxisElement.Ride -> {
                val leg = journey.legs[element.index]
                val start = x(leg.effectiveDeparture)
                AxisFrame(start, (chipHeight - barHeight) / 2,
                    (x(leg.effectiveArrival) - start).coerceAtLeast(1), barHeight)
            }
            is AxisElement.Dwell -> {
                val leg = journey.legs[element.index]
                val start = x(leg.effectiveArrival)
                AxisFrame(start, (chipHeight - barHeight) / 2,
                    (x(journey.legs[element.index + 1].effectiveDeparture) - start).coerceAtLeast(1), barHeight)
            }
            is AxisElement.Alight -> {
                val anchor = x(journey.legs[element.index].effectiveArrival)
                pins += index
                AxisFrame((anchor - size.width).coerceIn(capWidth, (safeWidth - size.width).coerceAtLeast(capWidth)), 0, size.width, size.height)
            }
            is AxisElement.Board -> {
                val anchor = x(journey.legs[element.index + 1].effectiveDeparture)
                pins += index
                AxisFrame(anchor.coerceIn(capWidth, (safeWidth - size.width).coerceAtLeast(capWidth)), 0, size.width, size.height)
            }
            is AxisElement.StationLabel -> {
                labels += index
                AxisFrame(width = size.width.coerceAtMost(safeWidth), height = size.height)
            }
            AxisElement.TinyTrain -> AxisFrame(capWidth, (chipHeight - barHeight) / 2 - size.height * 18 / 44, axisWidth, size.height)
            AxisElement.Progress -> {
                val center = capWidth + (axisWidth * (progress ?: 0f).coerceIn(0f, 1f)).roundToInt()
                AxisFrame(center - size.width / 2, -size.height - labelTopGap / 2, size.width, size.height)
            }
        }
    }
    val lanes = mutableListOf(mutableListOf<Int>())
    var used = 0
    for (index in pins) {
        val required = frames[index].width + if (lanes.last().isEmpty()) 0 else itemGap
        if (used + required > axisWidth && lanes.last().isNotEmpty()) {
            lanes.add(mutableListOf()); used = 0
        }
        lanes.last() += index
        used += frames[index].width + if (used == 0) 0 else itemGap
    }
    lanes.forEachIndexed { lane, indices ->
        var right = capWidth - itemGap
        indices.forEach { index ->
            frames[index].x = maxOf(frames[index].x, right + itemGap)
            frames[index].y = lane * (chipHeight + itemGap)
            right = frames[index].x + frames[index].width
        }
        var edge = safeWidth
        indices.asReversed().forEach { index ->
            frames[index].x = minOf(frames[index].x, edge - frames[index].width)
            edge = frames[index].x - itemGap
        }
    }
    elements.forEachIndexed { index, element ->
        if (element !is AxisElement.Ride) return@forEachIndexed
        val frame = frames[index]
        val logicalStart = frame.x
        val logicalEnd = frame.x + frame.width
        val board = elements.indexOf(AxisElement.Board(element.index - 1)).takeIf { it >= 0 }
            ?.let(frames::get)?.takeIf { it.y == 0 }
        val alight = elements.indexOf(AxisElement.Alight(element.index)).takeIf { it >= 0 }
            ?.let(frames::get)?.takeIf { it.y == 0 }
        val paintedStart = board?.let { marker ->
            val inset = ridePaintInset.coerceAtMost(marker.width / 2)
            logicalStart.coerceIn(marker.x + inset, marker.x + marker.width - inset)
        } ?: logicalStart
        val paintedEnd = alight?.let { marker ->
            val inset = ridePaintInset.coerceAtMost(marker.width / 2)
            logicalEnd.coerceIn(marker.x + inset, marker.x + marker.width - inset)
        } ?: logicalEnd
        frame.x = paintedStart
        frame.width = (paintedEnd - paintedStart).coerceAtLeast(0)
    }
    val markerBottom = maxOf(chipHeight, pins.maxOfOrNull { frames[it].y + frames[it].height } ?: 0)
    val placed = mutableListOf<AxisFrame>()
    labels.forEach { index ->
        val element = elements[index] as AxisElement.StationLabel
        val midpoint = x((journey.legs[element.index].effectiveArrival + journey.legs[element.index + 1].effectiveDeparture) / 2)
        val frame = frames[index]
        frame.x = (midpoint - frame.width / 2).coerceIn(0, (safeWidth - frame.width).coerceAtLeast(0))
        frame.y = markerBottom + labelTopGap
        placed.filter { frame.x < it.x + it.width + labelCollisionGap && frame.x + frame.width > it.x - labelCollisionGap }
            .forEach { prior -> frame.y = maxOf(frame.y, prior.y + prior.height + labelCollisionGap) }
        placed += frame.copy()
    }
    return frames to maxOf(minimumHeight, frames.filterIndexed { i, _ -> elements[i] != AxisElement.TinyTrain }.maxOfOrNull { it.y + it.height } ?: 0)
}

@Composable
fun JourneyAxis(journey: Journey, modifier: Modifier = Modifier, large: Boolean = false,
                showCap: Boolean = true, progress: Float? = null, tinyTrain: Boolean = false,
                travelledAt: Long? = null) {
    if (journey.legs.isEmpty()) return
    val c = LocalTrainColors.current
    val fontScale = LocalDensity.current.fontScale
    val first = journey.legs.first()
    val cap = departureCapText(first.fromPlatform, first.mode).takeIf { showCap }
    Layout(modifier = modifier.semantics {
        contentDescription = "Journey from ${first.from.shortName} to ${journey.legs.last().to.shortName}"
    }, content = {
        cap?.let {
            LineChip(first.line, first.mode, it, Modifier.layoutId(AxisElement.Cap),
                height = if (large) 24.dp else 22.dp, horizontalPadding = if (large) 10.dp else 7.dp)
        }
        journey.legs.forEachIndexed { index, leg ->
            Box(Modifier.layoutId(AxisElement.Ride(index)).background(lineColor(leg.line, leg.mode, c, fill = true),
                RoundedCornerShape(topEnd = if (index == journey.legs.lastIndex) 3.dp else 0.dp,
                    bottomEnd = if (index == journey.legs.lastIndex) 3.dp else 0.dp)).drawWithContent {
                drawContent()
                val fraction = travelledAt?.let { ((it - leg.effectiveDeparture).toFloat() /
                    (leg.effectiveArrival - leg.effectiveDeparture).coerceAtLeast(1)).coerceIn(0f, 1f) } ?: 0f
                if (fraction > 0) drawRect(c.ground.copy(alpha = .62f), size = androidx.compose.ui.geometry.Size(size.width * fraction, size.height))
            })
            if (index < journey.legs.lastIndex) {
                val next = journey.legs[index + 1]
                Box(Modifier.layoutId(AxisElement.Dwell(index)).background(
                    if (isTightChange(journey, index)) c.warning else c.rule).drawWithContent {
                    drawContent()
                    val fraction = travelledAt?.let { ((it - leg.effectiveArrival).toFloat() /
                        (next.effectiveDeparture - leg.effectiveArrival).coerceAtLeast(1)).coerceIn(0f, 1f) } ?: 0f
                    if (fraction > 0) drawRect(c.ground.copy(alpha = .62f), size = androidx.compose.ui.geometry.Size(size.width * fraction, size.height))
                })
            }
        }
        if (tinyTrain) TinyTrainLane(Modifier.layoutId(AxisElement.TinyTrain))
        journey.legs.dropLast(1).forEachIndexed { index, leg ->
            val next = journey.legs[index + 1]
            if (showAlightingPin(journey.legs.size, index)) {
                platformText(leg.toPlatform, leg.mode)?.let {
                    LineChip(leg.line, leg.mode, it,
                        Modifier.layoutId(AxisElement.Alight(index)).testTag("axis-alight-$index"),
                        height = if (large) 24.dp else 22.dp, horizontalPadding = 5.dp,
                        dimmed = travelledAt?.let { at -> at >= next.effectiveDeparture } == true)
                }
            }
            platformText(next.fromPlatform, next.mode)?.let {
                LineChip(next.line, next.mode, it,
                    Modifier.layoutId(AxisElement.Board(index)).testTag("axis-board-$index"),
                    height = if (large) 24.dp else 22.dp, horizontalPadding = 5.dp,
                    dimmed = travelledAt?.let { at -> at >= next.effectiveDeparture } == true)
            }
            Text((if (leg.to.id == next.from.id) leg.to.shortName else "${leg.to.shortName} → ${next.from.shortName}").uppercase(Locale.ENGLISH),
                Modifier.layoutId(AxisElement.StationLabel(index)), color = c.ink2, fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold, letterSpacing = .6.sp, textAlign = TextAlign.Center,
                lineHeight = 13.5.sp, maxLines = 4, overflow = TextOverflow.Clip)
        }
        progress?.let { at ->
            Canvas(Modifier.layoutId(AxisElement.Progress).width(13.dp).height(9.dp)) {
                val triangle = Path().apply {
                    moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2f, size.height); close()
                }
                drawPath(triangle, c.ink3)
            }
        }
    }) { measurables, constraints ->
        val width = constraints.maxWidth.coerceAtLeast(1)
        val elements = measurables.map { it.layoutId as AxisElement }
        val measured = arrayOfNulls<androidx.compose.ui.layout.Placeable>(measurables.size)
        val sizes = measurables.mapIndexed { index, measurable ->
            val element = elements[index]
            if (element == AxisElement.TinyTrain) AxisSize(0, 44.dp.roundToPx())
            else if (element is AxisElement.Ride || element is AxisElement.Dwell) AxisSize(0, 0)
            else {
                val placeable = measurable.measure(androidx.compose.ui.unit.Constraints(maxWidth = width))
                measured[index] = placeable
                AxisSize(placeable.width, placeable.height)
            }
        }
        val barHeight = (if (large) 14.dp else 7.dp).roundToPx()
        val baseChipHeight = ((if (large) 24f else 22f) * fontScale).dp.roundToPx()
        val minimumHeight = (if (large) (42 + ((fontScale - 1f).coerceAtLeast(0f) * 80f)).dp else 22.dp * fontScale).roundToPx()
        val (frames, desiredHeight) = journeyAxisFrames(journey, width, elements, sizes, barHeight, baseChipHeight, minimumHeight,
            3.dp.roundToPx(), 4.dp.roundToPx(), 6.dp.roundToPx(), LineChipCornerRadius.roundToPx(), progress)
        frames.forEachIndexed { index, frame ->
            if (measured[index] == null) {
                measured[index] = measurables[index].measure(androidx.compose.ui.unit.Constraints.fixed(frame.width, frame.height))
            }
        }
        val height = desiredHeight.coerceIn(constraints.minHeight, constraints.maxHeight)
        layout(width, height) {
            measured.forEachIndexed { index, placeable -> placeable?.placeRelative(frames[index].x, frames[index].y) }
        }
    }
}

@Composable
fun ServiceIcon(mode: String, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(27.dp).semantics { contentDescription = mode }) {
        val w = size.width
        val h = size.height
        when (mode) {
            "metro" -> {
                drawCircle(color, style = Stroke(2.dp.toPx()))
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.28f,h*.68f), androidx.compose.ui.geometry.Offset(w*.28f,h*.32f),2.dp.toPx())
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.28f,h*.32f), androidx.compose.ui.geometry.Offset(w*.5f,h*.57f),2.dp.toPx())
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.5f,h*.57f), androidx.compose.ui.geometry.Offset(w*.72f,h*.32f),2.dp.toPx())
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.72f,h*.32f), androidx.compose.ui.geometry.Offset(w*.72f,h*.68f),2.dp.toPx())
            }
            "ferry" -> {
                drawRect(color, androidx.compose.ui.geometry.Offset(w*.27f,h*.35f), androidx.compose.ui.geometry.Size(w*.46f,h*.35f), style=Stroke(2.dp.toPx()))
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.12f,h*.7f), androidx.compose.ui.geometry.Offset(w*.88f,h*.7f),2.dp.toPx())
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.2f,h*.86f), androidx.compose.ui.geometry.Offset(w*.8f,h*.86f),2.dp.toPx())
            }
            else -> {
                drawRoundRect(color, androidx.compose.ui.geometry.Offset(w*.22f,h*.1f), androidx.compose.ui.geometry.Size(w*.56f,h*.68f), androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()), style=Stroke(2.dp.toPx()))
                drawLine(color, androidx.compose.ui.geometry.Offset(w*.35f,h*.38f), androidx.compose.ui.geometry.Offset(w*.65f,h*.38f),2.dp.toPx())
                drawCircle(color,2.dp.toPx(),androidx.compose.ui.geometry.Offset(w*.35f,h*.64f))
                drawCircle(color,2.dp.toPx(),androidx.compose.ui.geometry.Offset(w*.65f,h*.64f))
            }
        }
    }
}

val thinText = TextStyle(fontWeight = FontWeight.Light)
