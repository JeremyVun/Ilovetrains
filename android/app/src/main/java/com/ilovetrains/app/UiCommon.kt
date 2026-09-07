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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
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
             height: Dp = 22.dp, horizontalPadding: Dp = 7.dp) {
    val c = LocalTrainColors.current
    Box(modifier.height(height).clip(RoundedCornerShape(3.dp))
        .background(lineColor(line, mode, c, fill = true)).padding(horizontal = horizontalPadding),
        contentAlignment = Alignment.Center) {
        Text(text.uppercase(), color = chipInk(line, mode, c), fontSize = 14.sp,
            fontWeight = FontWeight.Bold, letterSpacing = 0.sp, maxLines = 1)
    }
}

fun platformText(raw: String?, mode: String, full: Boolean = false): String? {
    if (raw.isNullOrBlank()) return null
    val cleaned = raw.trim().replace(Regex("^(Platform|Wharf)\\s*", RegexOption.IGNORE_CASE), "")
    if (mode.equals("ferry", true)) {
        val numbered = Regex("\\d+").find(cleaned)?.value
        if (numbered == null) return if (full) raw else "Wharf"
        val side = Regex("Side\\s*([A-Za-z0-9]+)", RegexOption.IGNORE_CASE).find(cleaned)?.groupValues?.get(1)
        return if (full) "Wharf $numbered${side?.let { ", Side $it" } ?: ""}" else numbered + (side ?: "")
    }
    val platform = Regex("[A-Za-z0-9]+(?:[A-Za-z])?").find(cleaned)?.value ?: cleaned
    return if (full) "Platform $platform" else platform
}

fun minutesBetween(from: Long, to: Long): Int = ((to / 60_000) - (from / 60_000)).toInt()

data class Figure(val value: String, val unit: String = "", val provenance: String = "", val past: Boolean = false)

fun figureFor(journey: Journey, board: BoardData?, now: Long): Figure {
    val departure = journey.effectiveDeparture
    val stale = board == null || board.offline || journey.retained || now - board.generatedAt > 90_000
    val mins = minutesBetween(now, departure)
    if (journey.cancelled) return Figure("—", provenance = "Cancelled", past = mins < 0)
    if (stale) return Figure("", provenance = if (journey.retained && journey.realtime) "Last known" else "Scheduled", past = mins < 0)
    if (mins < 0) return Figure(abs(mins).toString(), "min", "Ago", past = true)
    val liveRealtime = board.source == "live" && journey.realtime
    if (mins == 0) return Figure("Now", provenance = if (liveRealtime) "Departing" else "Scheduled")
    if (mins > 99) return Figure(((mins / 60f).roundToInt()).toString(), "H", if (liveRealtime) "" else "Scheduled")
    val late = minutesBetween(journey.departure, journey.effectiveDeparture)
    return Figure(mins.toString(), "min", if (late > 0) "$late min late" else if (liveRealtime) "" else "Scheduled")
}

fun directionFigureFor(journey: Journey, now: Long): Figure? {
    if (now < journey.effectiveDeparture || now >= journey.effectiveArrival) return null
    val nextChange = journey.legs.dropLast(1).firstOrNull { now < it.effectiveArrival }
    val actionTime = nextChange?.effectiveArrival ?: journey.effectiveArrival
    return Figure(
        minutesBetween(now, actionTime).coerceAtLeast(0).toString(),
        "min",
        if (nextChange != null) "To change" else "To go",
    )
}

@Composable
fun JourneyAxis(journey: Journey, modifier: Modifier = Modifier, large: Boolean = false,
                showCap: Boolean = true, progress: Float? = null) {
    if (journey.legs.isEmpty()) return
    val c = LocalTrainColors.current
    val fontScale = LocalDensity.current.fontScale
    val first = journey.legs.first()
    val total = (journey.effectiveArrival - journey.effectiveDeparture).coerceAtLeast(1)
    val axisHeight = if (large) (42 + ((fontScale - 1f).coerceAtLeast(0f) * 80f)).dp else 22.dp
    val itemAlignment = if (large) Alignment.Top else Alignment.CenterVertically
    Row(modifier.height(axisHeight), verticalAlignment = itemAlignment) {
        platformText(first.fromPlatform, first.mode)?.takeIf { showCap }?.let {
            LineChip(first.line, first.mode, if (first.mode == "ferry" && it == "Wharf") it else "${if (first.mode == "ferry") "Wharf" else "Platform"} $it",
                height = if (large) 24.dp else 22.dp, horizontalPadding = if (large) 10.dp else 7.dp)
        }
        BoxWithConstraints(Modifier.weight(1f).height(axisHeight)) {
            val barHeight = if (large) 14.dp else 7.dp
            val segmentPlacement: Modifier.() -> Modifier = {
                if (large) align(Alignment.TopStart).offset(y = 5.dp) else align(Alignment.CenterStart)
            }
            journey.legs.forEachIndexed { index, leg ->
                val start = (leg.effectiveDeparture - journey.effectiveDeparture).toFloat() / total
                val ride = (leg.effectiveArrival - leg.effectiveDeparture).toFloat() / total
                Box(Modifier.offset(x = maxWidth * start).width(maxWidth * ride.coerceAtLeast(.001f))
                    .height(barHeight).segmentPlacement()
                    .background(lineColor(leg.line, leg.mode, c, fill = true),
                        RoundedCornerShape(topEnd = if (index == journey.legs.lastIndex) 3.dp else 0.dp,
                            bottomEnd = if (index == journey.legs.lastIndex) 3.dp else 0.dp)))
                if (index < journey.legs.lastIndex) {
                    val next = journey.legs[index + 1]
                    val waitStart = (leg.effectiveArrival - journey.effectiveDeparture).toFloat() / total
                    val wait = (next.effectiveDeparture - leg.effectiveArrival).toFloat() / total
                    Box(Modifier.offset(x = maxWidth * waitStart).width(maxWidth * wait.coerceAtLeast(.001f))
                        .height(barHeight).segmentPlacement().background(
                            if (minutesBetween(leg.effectiveArrival, next.effectiveDeparture) < 5) c.warning else c.rule))
                    platformText(leg.toPlatform, leg.mode)?.let {
                        LineChip(leg.line, leg.mode, it,
                            Modifier.offset(x = maxWidth * waitStart - 3.dp)
                                .align(if (large) Alignment.TopStart else Alignment.CenterStart).zIndex(2f),
                            height = if (large) 24.dp else 22.dp, horizontalPadding = 5.dp)
                    }
                    platformText(next.fromPlatform, next.mode)?.let {
                        val nextStart = (next.effectiveDeparture - journey.effectiveDeparture).toFloat() / total
                        LineChip(next.line, next.mode, it,
                            Modifier.offset(x = maxWidth * nextStart + 3.dp)
                                .align(if (large) Alignment.TopStart else Alignment.CenterStart).zIndex(2f),
                            height = if (large) 24.dp else 22.dp, horizontalPadding = 5.dp)
                    }
                    if (large) {
                        val middle = (leg.effectiveArrival + next.effectiveDeparture) / 2
                        val at = (middle - journey.effectiveDeparture).toFloat() / total
                        Column(Modifier.offset(x = maxWidth * at - 48.dp).width(96.dp).align(Alignment.BottomStart),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            if (progress != null) Box(Modifier.width(1.dp).height(6.dp).background(c.ink3))
                            Label(if (leg.to.id == next.from.id) leg.to.shortName else "${leg.to.shortName} → ${next.from.shortName}",
                                Modifier.fillMaxWidth(), align = TextAlign.Center, maxLines = 2)
                        }
                    }
                }
            }
            progress?.let { at ->
                if (large) {
                    val instant = journey.effectiveDeparture + (total * at).toLong()
                    val activeLeg = journey.legs.firstOrNull { instant <= it.effectiveArrival }
                        ?: journey.legs.last()
                    val marker = lineColor(activeLeg.line, activeLeg.mode, c, fill = true)
                    Box(Modifier.width(maxWidth * at.coerceIn(0f, 1f)).height(barHeight).offset(y = 5.dp)
                        .align(Alignment.TopStart).background(c.ground.copy(alpha = .62f),
                            RoundedCornerShape(topEnd = if (at >= 1f) 3.dp else 0.dp,
                                bottomEnd = if (at >= 1f) 3.dp else 0.dp)).zIndex(1f))
                    Canvas(Modifier.offset(x = maxWidth * at - 6.5.dp).width(13.dp).height(27.dp)
                        .align(Alignment.TopStart).zIndex(3f)) {
                        val triangle = Path().apply {
                            moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2f, 9.dp.toPx()); close()
                        }
                        drawPath(triangle, marker)
                        drawRect(marker, androidx.compose.ui.geometry.Offset(size.width / 2f - 1.dp.toPx(), 9.dp.toPx()),
                            androidx.compose.ui.geometry.Size(2.dp.toPx(), 18.dp.toPx()))
                    }
                } else {
                    Box(Modifier.offset(x = maxWidth * at - 1.dp).width(2.dp).height(11.dp)
                        .align(Alignment.TopStart).background(c.ink).zIndex(3f))
                }
            }
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
