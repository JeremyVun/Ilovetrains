package com.ilovetrains.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun DetailScreen(state: AppState, actions: UiActions) {
    val journey = state.detail
    val board = state.board
    val c = LocalTrainColors.current
    if (journey == null || journey.legs.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(horizontal = PagePadding)) {
            BackButton("Departures", actions::back)
            Text("Journey unavailable", color = c.ink2, fontSize = 18.sp, modifier = Modifier.padding(top = 24.dp))
        }
        return
    }
    val first = journey.legs.first()
    val last = journey.legs.last()
    val focused = state.focus?.journey?.key == journey.key
    val pinned = focused && state.focus?.pinned == true
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = PagePadding)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                BackButton("${first.from.shortName} departures", actions::back)
                Spacer(Modifier.weight(1f))
                Freshness(board, state.now, Modifier.testTag("detail-freshness"))
            }
            Label("Journey", Modifier.padding(top = 2.dp))
            Text(buildAnnotatedString {
                append(first.from.shortName)
                pushStyle(SpanStyle(color = c.ink3, fontWeight = FontWeight.ExtraLight))
                append(" → ")
                pop()
                append(last.to.shortName)
            }, Modifier.fillMaxWidth().padding(top = 6.dp), color = c.ink, fontSize = 29.sp,
                lineHeight = 33.sp, fontWeight = FontWeight.Light, letterSpacing = (-.72).sp, maxLines = 3)
            val cancelled = journey.legs.firstOrNull { it.cancelled }
            Text(if (cancelled != null) "The ${clockTime(cancelled.departure)} from ${cancelled.from.shortName} is cancelled."
                else if (journey.legs.size == 1) "Direct · arrives ${clockTime(journey.effectiveArrival)}"
                else "${journey.legs.size - 1} ${if (journey.legs.size == 2) "change" else "changes"} · arrives ${clockTime(journey.effectiveArrival)}",
                color = if (cancelled != null) c.warning else c.ink2, fontSize = 14.sp, fontWeight = FontWeight.Light,
                lineHeight = 21.sp, modifier = Modifier.padding(top = 7.dp, bottom = 18.dp))
            Rule(heavy = true)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            BoardRow(journey, board, state.now, detail = true,
                figureOverride = if (!journey.cancelled) directionFigureFor(journey, state.now) else null)
            JourneySteps(journey, state.now)
            Spacer(Modifier.height(12.dp))
        }
        Column(Modifier.padding(horizontal = PagePadding)) {
            Rule(heavy = true)
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(clockTime(journey.effectiveArrival), color = if (last.cancelled) c.ink3 else c.ink,
                    fontSize = 19.sp, fontWeight = FontWeight.Light,
                    textDecoration = if (last.cancelled) TextDecoration.LineThrough else null)
                Text(last.to.shortName, color = c.ink2, fontSize = 14.sp, fontWeight = FontWeight.Light,
                    modifier = Modifier.padding(start = 10.dp))
                Spacer(Modifier.weight(1f))
                Label(if (last.cancelled) "Journey cancelled" else platformText(last.toPlatform, last.mode, true) ?: "Arrive",
                    color = if (last.cancelled) c.warning else c.ink3)
            }
        }
        if (pinned || !focused && !journey.cancelled) ActionRail(
            if (pinned) "Unpin this ${first.modeNameDetail()}" else "Pin this ${first.modeNameDetail()}",
            if (pinned) actions::unpinJourney else ({ actions.pinJourney(journey) }),
            minHeight = 66.dp,
        )
    }
}

@Composable
private fun JourneySteps(journey: Journey, now: Long) {
    val c = LocalTrainColors.current
    val first = journey.legs.first()
    DetailStep(clockTime(first.effectiveDeparture), first.from.shortName, first.fromPlatform, first,
        "Board ${first.line} · ${first.headsign}", done = now > first.effectiveDeparture,
        heavyDivider = journey.legs.size > 1)
    journey.legs.zipWithNext().forEach { (before, after) ->
        val wait = minutesBetween(before.effectiveArrival, after.effectiveDeparture)
        val cancelled = before.cancelled || after.cancelled
        val station = if (before.to.id == after.from.id) before.to.shortName else "${before.to.shortName} → ${after.from.shortName}"
        Column(Modifier.fillMaxWidth().padding(horizontal = PagePadding)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 82.dp).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.width(69.dp), horizontalAlignment = Alignment.End) {
                    Text(if (cancelled) clockTime(after.effectiveDeparture) else "$wait min",
                        color = if (wait < 5 || cancelled) c.warning else c.ink2, fontSize = 17.sp,
                        fontWeight = FontWeight.Light, textDecoration = if (cancelled) TextDecoration.LineThrough else null)
                    val label = if (cancelled) "CANCELLED" else "CHANGE"
                    val style = TextStyle(fontSize = 9.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = 1.44.sp, lineHeight = 12.15.sp)
                    val measuredWidth = rememberTextMeasurer().measure(label, style, softWrap = false).size.width
                    val columnWidth = with(LocalDensity.current) { 69.dp.roundToPx() }
                    val scale = minOf(1f, (columnWidth - 1).toFloat() / measuredWidth.coerceAtLeast(1))
                    Text(label, color = if (wait < 5 || cancelled) c.warning else c.ink3,
                        style = style.copy(fontSize = 9.sp * scale, letterSpacing = 1.44.sp * scale,
                            lineHeight = 12.15.sp * scale), maxLines = 1, softWrap = false)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(station, color = if (cancelled) c.ink3 else c.ink, fontSize = 22.sp,
                        fontWeight = FontWeight.Light, textDecoration = if (cancelled) TextDecoration.LineThrough else null)
                    Row(Modifier.padding(top = 7.dp), verticalAlignment = Alignment.Top) {
                        platformText(before.toPlatform, before.mode)?.let { LineChip(before.line, before.mode, it) }
                        Label("Get off  →", Modifier.padding(start = 7.dp, end = 7.dp, top = 3.dp), color = if (wait < 5) c.warning else c.ink3)
                        platformText(after.fromPlatform, after.mode)?.let { LineChip(after.line, after.mode, it) }
                        val boardingPlace = platformText(after.fromPlatform, after.mode, full = true)
                        Label("Board ${after.line} · ${after.headsign}${boardingPlace?.let { " · $it" } ?: ""}",
                            Modifier.padding(start = 7.dp, top = 3.dp).weight(1f),
                            color = if (wait < 5) c.warning else c.ink3, maxLines = 3)
                    }
                }
            }
            Rule(heavy = true)
        }
    }
    val last = journey.legs.last()
    DetailStep(clockTime(last.effectiveArrival), last.to.shortName, last.toPlatform, last,
        if (last.cancelled) "Arrive · journey cancelled" else "Arrive", done = false)
}

@Composable
private fun DetailStep(time: String, station: String, platform: String?, leg: Leg, action: String, done: Boolean,
                       heavyDivider: Boolean = false) {
    val c = LocalTrainColors.current
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
        Text(time, Modifier.width(69.dp).testTag("detail-step-time"), color = if (leg.cancelled) c.ink3 else c.ink2,
            fontSize = 17.sp, fontWeight = FontWeight.Light, textAlign = TextAlign.End,
            textDecoration = if (leg.cancelled) TextDecoration.LineThrough else null)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(station, color = if (done || leg.cancelled) c.ink2 else c.ink, fontSize = 17.sp,
                fontWeight = FontWeight.Normal, textDecoration = if (leg.cancelled) TextDecoration.LineThrough else null)
            Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                platformText(platform, leg.mode)?.let { LineChip(leg.line, leg.mode, it, height = 21.dp, horizontalPadding = 5.dp) }
                Label(action, Modifier.padding(start = if (platform == null) 0.dp else 7.dp).weight(1f),
                    color = if (leg.cancelled) c.warning else c.ink3, maxLines = 3)
            }
        }
    }
    Rule(Modifier.padding(horizontal = PagePadding), heavy = heavyDivider)
}

private fun Leg.modeNameDetail() = if (mode.equals("ferry", true)) "ferry" else "train"
