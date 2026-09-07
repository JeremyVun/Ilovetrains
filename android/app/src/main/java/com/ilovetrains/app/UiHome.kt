package com.ilovetrains.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun HomeScreen(state: AppState, actions: UiActions) {
    val c = LocalTrainColors.current
    val board = state.homeBoard ?: state.board
    val focusJourney = state.focus?.journey
    val retainedJourney = retainedHomeJourney(board, state.now)
    val firstFuture = retainedJourney ?: board?.journeys?.firstOrNull { it.effectiveDeparture >= state.now }
    val firstRunning = retainedJourney?.takeUnless { it.cancelled }
        ?: board?.journeys?.firstOrNull { !it.cancelled && it.effectiveDeparture >= state.now }
    val focusReplacement = focusJourney?.takeIf { it.cancelled && state.now < it.effectiveDeparture }?.let { cancelled ->
        board?.journeys?.firstOrNull { !it.cancelled && it.effectiveDeparture > cancelled.effectiveDeparture }
    }
    val journey = focusReplacement ?: focusJourney ?: firstRunning ?: firstFuture
    val cancelledLeadTime = when {
        focusReplacement != null -> focusJourney?.effectiveDeparture
        focusJourney == null && firstFuture?.cancelled == true && firstRunning != null -> firstFuture.effectiveDeparture
        else -> null
    }
    Column(Modifier.fillMaxSize()) {
        if (journey != null && board != null) SmartHeader(state, board, journey, cancelledLeadTime, actions)
        else if (state.trips.isNotEmpty()) SmartLoadingHeader(state, board, actions)
        else if (state.totalTrips > 0) {
            Column(Modifier.fillMaxWidth().padding(horizontal = PagePadding, vertical = 28.dp)) {
                Text(state.message ?: "No trips match your selected services.", color = c.ink2,
                    fontSize = 20.sp, fontWeight = FontWeight.Light, lineHeight = 28.sp)
                Label("Change settings", Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = actions::openSettings)
                    .wrapContentHeight(Alignment.CenterVertically), color = c.ink)
            }
            Rule(heavy = true)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = PagePadding)) {
            item("anchor") { Label("My trips", Modifier.padding(top = 22.dp, bottom = 10.dp), color = c.ink, size = 11) }
            items(state.trips, key = { it.id }) { trip -> SavedTripRow(trip, state, actions) }
            item("end") { Label("— End of trips", Modifier.padding(top = 14.dp, bottom = 6.dp)) }
        }
        HomeFooter(actions)
    }
}

@Composable
private fun SmartLoadingHeader(state: AppState, board: BoardData?, actions: UiActions) {
    val c = LocalTrainColors.current
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 22.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
            Label("Next train", color = c.ink2, size = 11)
            Spacer(Modifier.weight(1f))
            if (board != null) Freshness(board, state.now)
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 126.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
            Text(when {
                board?.error != null -> board.error
                state.enabledModes.isEmpty() -> "Turn on a service in Settings"
                state.refreshing -> "Getting the next trains…"
                board?.offline == true -> "No saved board for this trip yet"
                else -> "No services in the next few hours"
            }, Modifier.weight(1f), color = c.ink2, fontSize = 15.sp, fontWeight = FontWeight.Light)
            when {
                board?.error != null -> Label("Update timetable", Modifier.heightIn(min = 44.dp)
                    .clickable(role = Role.Button, onClick = actions::updateTimetable)
                    .wrapContentHeight(Alignment.CenterVertically), color = c.ink)
                state.enabledModes.isEmpty() -> Label("Settings", Modifier.heightIn(min = 44.dp)
                    .clickable(role = Role.Button, onClick = actions::openSettings)
                    .wrapContentHeight(Alignment.CenterVertically), color = c.ink)
            }
        }
        Rule(heavy = true)
    }
}

@Composable
private fun SmartHeader(state: AppState, board: BoardData, journey: Journey, cancelledLeadTime: Long?, actions: UiActions) {
    val c = LocalTrainColors.current
    val fig = figureFor(journey, board, state.now)
    val first = journey.legs.first()
    val focus = state.focus
    val focused = focus != null && cancelledLeadTime == null
    val explicitlyPinned = focused && focus?.pinned == true
    val departed = focused && state.now >= journey.effectiveDeparture
    val completed = state.focusComplete || state.now >= journey.effectiveArrival
    val directionFigure = if (departed && !completed && !journey.retained && board.isLive(state.now)) {
        directionFigureFor(journey, state.now) ?: fig
    } else fig
    val late = minutesBetween(journey.departure, journey.effectiveDeparture) > 0
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = if (explicitlyPinned) 44.dp else 22.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
            val status = when {
                completed && focused -> "Trip over"
                (journey.cancelled && focused) || cancelledLeadTime != null && focus != null -> "Cancelled"
                departed && focused && late -> "Running late"
                focused && late -> "${minutesBetween(journey.departure, journey.effectiveDeparture)} min late"
                departed && focused -> "Running"
                explicitlyPinned -> "Pinned"
                journey.retained && board.offline && state.now >= journey.effectiveDeparture -> "Last shown"
                state.distanceMetres != null && state.distanceMetres <= 200 -> "At ${first.from.shortName}"
                state.distanceMetres != null -> "${distanceText(state.distanceMetres)} to ${first.from.shortName}"
                else -> "Next ${first.modeName()}"
            }
            Row(modifier = if (explicitlyPinned) Modifier.heightIn(min = 44.dp)
                .clickable(role = Role.Button, onClick = actions::unpinJourney) else Modifier,
                verticalAlignment = Alignment.CenterVertically) {
                if (explicitlyPinned && status == "Pinned") {
                    Icon(Icons.Filled.PushPin, null, Modifier.size(12.dp), tint = c.ink2)
                    Spacer(Modifier.width(5.dp)); Label("Pinned", color = c.ink2, size = 11)
                } else {
                    Label(status, color = if (journey.cancelled || late) c.warning else c.ink2, size = 11)
                    if (explicitlyPinned) {
                        Label(" · ", color = c.ink3, size = 11)
                        Icon(Icons.Filled.PushPin, null, Modifier.size(12.dp), tint = c.ink2)
                        Spacer(Modifier.width(4.dp)); Label("Pinned", color = c.ink2, size = 11)
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Freshness(board, state.now)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = PagePadding, vertical = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.width(104.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(directionFigure.value, color = if (late) c.warning else c.ink,
                        modifier = Modifier.testTag("home-primary-figure"),
                        fontSize = when {
                            directionFigure.value.equals("NOW", ignoreCase = true) -> 36.sp
                            directionFigure.value.length > 3 -> 50.sp
                            else -> 64.sp
                        },
                        lineHeight = 58.sp, fontWeight = FontWeight(250), letterSpacing = (-2).sp,
                        maxLines = 1, softWrap = false)
                    Text(directionFigure.unit, color = c.ink2, fontSize = 16.sp, fontWeight = FontWeight.Normal,
                        modifier = Modifier.padding(start = 2.dp, bottom = 7.dp))
                }
                val homeProvenance = directionFigure.provenance.takeUnless { it.equals("Scheduled", true) }.orEmpty()
                if (homeProvenance.isNotEmpty()) Label(homeProvenance, Modifier.padding(top = 5.dp),
                    color = if (late || journey.cancelled) c.warning else c.ink3)
            }
            Spacer(Modifier.width(14.dp))
            Row(Modifier.weight(1f)) {
                Column(Modifier.weight(1f)) {
                    Text(first.from.shortName, color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Light,
                        maxLines = 2, overflow = TextOverflow.Clip)
                    Text(clockTime(journey.effectiveDeparture), color = if (late) c.warning else c.ink,
                        fontSize = 25.sp, fontWeight = FontWeight.Normal, modifier = Modifier.padding(top = 3.dp))
                }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                    Text(journey.legs.last().to.shortName, color = c.ink2, fontSize = 16.sp, fontWeight = FontWeight.Light,
                        textAlign = TextAlign.End, maxLines = 2, overflow = TextOverflow.Clip)
                    Text(clockTime(journey.effectiveArrival), color = c.ink2, fontSize = 20.sp,
                        fontWeight = FontWeight.Light, modifier = Modifier.padding(top = 7.dp))
                }
            }
        }
        JourneyAxis(journey, Modifier.fillMaxWidth().padding(horizontal = PagePadding), large = true,
            showCap = !departed, progress = if (departed && !completed) {
                ((state.now - journey.effectiveDeparture).toFloat() /
                    (journey.effectiveArrival - journey.effectiveDeparture).coerceAtLeast(1)).coerceIn(0f, 1f)
            } else null)
        val instruction = when {
            cancelledLeadTime != null -> "${clockTime(cancelledLeadTime)} cancelled · next ${first.modeName()}"
            completed -> "The journey has finished"
            departed -> focusedInstruction(journey, state.now)
            else -> first.headsign.ifBlank { first.to.shortName }
        }
        if (cancelledLeadTime != null) {
            Label(instruction, Modifier.padding(horizontal = PagePadding, vertical = 8.dp), color = c.warning, size = 11, maxLines = 2)
        } else {
            Text(instruction, color = if (departed) c.ink else c.ink2, fontSize = 15.sp,
                fontWeight = if (departed) FontWeight.Normal else FontWeight.Light,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = PagePadding, end = PagePadding, top = 6.dp, bottom = 8.dp))
        }
        if (!state.receipt.isNullOrBlank()) {
            Text(state.receipt, color = c.ink2, fontSize = 15.sp, fontWeight = FontWeight.Light,
                lineHeight = 21.sp, modifier = Modifier.padding(horizontal = PagePadding, vertical = 4.dp))
        }
        if (completed && focused) {
            Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
                Label("Need to get back?", color = c.ink3)
                Spacer(Modifier.width(20.dp))
                Label("Show the way back", Modifier.clickable(role = Role.Button, onClick = actions::showReturn)
                    .heightIn(min = 44.dp).wrapContentHeight(Alignment.CenterVertically), color = c.ink, size = 12)
            }
        }
        if (!departed) {
            board.journeys.firstOrNull { candidate -> !candidate.cancelled && candidate.effectiveDeparture > journey.effectiveDeparture &&
                !(candidate.departure == journey.departure && candidate.legs.firstOrNull()?.line == journey.legs.firstOrNull()?.line) }?.let { next ->
                Rule(Modifier.padding(horizontal = PagePadding))
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = PagePadding)
                    .clickable(role = Role.Button) { actions.openJourney(next) }, verticalAlignment = Alignment.CenterVertically) {
                    val nextMode = next.legs.firstOrNull()?.mode
                    Label("Next ${when (nextMode) { "ferry" -> "ferry"; "metro" -> "metro"; "train" -> "train"; else -> "service" }}",
                        Modifier.width(96.dp), size = 9)
                    val m = minutesBetween(state.now, next.effectiveDeparture)
                    val nextFigure = if (board.offline || state.now - board.generatedAt > 90_000 || !next.realtime) ""
                        else if (m > 99) "${(m / 60f).toInt()}H" else "$m min"
                    Text(nextFigure, color = c.ink,
                        fontSize = 17.sp, fontWeight = FontWeight.Light)
                    Spacer(Modifier.weight(1f))
                    Text("${clockTime(next.effectiveDeparture)} → ${clockTime(next.effectiveArrival)}",
                        color = c.ink3, fontSize = 15.sp, fontWeight = FontWeight.Light)
                    Chevron()
                }
            }
        }
        Rule(heavy = true)
        if (focus != null && !focus.pinned) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
                Text("Going somewhere else?", Modifier.weight(1f), color = c.ink2, fontSize = 15.sp, fontWeight = FontWeight.Light)
                Label("Change", Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = actions::newTrip)
                    .wrapContentHeight(Alignment.CenterVertically), color = c.ink, size = 12)
            }
            Rule()
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SavedTripRow(trip: SavedTrip, state: AppState, actions: UiActions) {
    val c = LocalTrainColors.current
    val largeText = LocalDensity.current.fontScale > 1.15f
    var showActions by remember(trip.id) { mutableStateOf(false) }
    val focused = state.focus?.tripId == trip.id
    val shown = state.selectedTripId == trip.id
    val lines = trip.lines.ifEmpty { listOf("T") }
    val stacked = lines.size > 1 && trip.from.shortName.length + trip.to.shortName.length > 26
    Box(Modifier.fillMaxWidth()) {
    Row(Modifier.fillMaxWidth().heightIn(min = if (stacked) 92.dp else 72.dp)
        .semantics { customActions = listOf(CustomAccessibilityAction("Trip actions") { showActions = true; true }) }
        .combinedClickable(role = Role.Button, onClick = { actions.openTrip(trip.id) }, onLongClick = { showActions = true })
        .padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.width(15.dp).height(if (stacked) 72.dp else 52.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            lines.take(3).forEach { code ->
                Box(Modifier.width(3.dp).fillMaxHeight().background(lineColor(code, if (code.startsWith("F")) "ferry" else "train", c, true)))
            }
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
            if (stacked) {
                val firstCode = lines.first()
                val lastCode = lines.last()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    LineChip(firstCode, if (firstCode.startsWith("F")) "ferry" else "train", firstCode,
                        Modifier.padding(end = 6.dp), height = 20.dp, horizontalPadding = 5.dp)
                    Text(trip.from.shortName, color = c.ink, fontSize = 19.sp, lineHeight = 22.sp,
                        fontWeight = FontWeight.Light, letterSpacing = (-.28).sp)
                }
                Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("→", Modifier.width(51.dp), color = c.ink3, fontSize = 19.sp,
                        fontWeight = FontWeight.Light, textAlign = TextAlign.Center)
                    LineChip(lastCode, if (lastCode.startsWith("F")) "ferry" else "train", lastCode,
                        Modifier.padding(end = 6.dp), height = 20.dp, horizontalPadding = 5.dp)
                    Text(trip.to.shortName, color = c.ink, fontSize = 19.sp, lineHeight = 22.sp,
                        fontWeight = FontWeight.Light, letterSpacing = (-.28).sp)
                }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    val firstCode = lines.first()
                    LineChip(firstCode, if (firstCode.startsWith("F")) "ferry" else "train", firstCode,
                        Modifier.padding(end = 6.dp), height = 20.dp, horizontalPadding = 5.dp)
                    Text(trip.from.shortName, Modifier.weight(trip.from.shortName.length.coerceAtLeast(1).toFloat()),
                        color = c.ink, fontSize = 19.sp, lineHeight = 22.sp, fontWeight = FontWeight.Light,
                        letterSpacing = (-.28).sp, maxLines = 2, overflow = TextOverflow.Clip)
                    Text("  →  ", color = c.ink3, fontSize = 19.sp, fontWeight = FontWeight.Light)
                    if (lines.size > 1) {
                        val lastCode = lines.last()
                        LineChip(lastCode, if (lastCode.startsWith("F")) "ferry" else "train", lastCode,
                            Modifier.padding(end = 6.dp), height = 20.dp, horizontalPadding = 5.dp)
                    }
                    Text(trip.to.shortName, Modifier.weight(trip.to.shortName.length.coerceAtLeast(1).toFloat()),
                        color = c.ink, fontSize = 19.sp, lineHeight = 22.sp, fontWeight = FontWeight.Light,
                        letterSpacing = (-.28).sp, maxLines = 2, overflow = TextOverflow.Clip)
                }
            }
            val stateText = when { focused && state.focus?.pinned == true -> "Running · Pinned"; focused -> "Running"; shown -> "Shown above"; else -> "" }
            val metadata = state.tripMetadata[trip.id].orEmpty()
            val summary = listOf(stateText, metadata).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "Saved trip" }
            if (largeText) {
                Label(summary, Modifier.fillMaxWidth().padding(top = 6.dp),
                    color = if (focused || shown) c.ink2 else c.ink3, maxLines = 3)
                Row(Modifier.fillMaxWidth().padding(top = 3.dp), horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically) {
                    Label("Departures", color = c.ink2)
                    Chevron()
                }
            } else {
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(summary, Modifier.weight(1f), color = if (focused || shown) c.ink2 else c.ink3, maxLines = 2)
                    Spacer(Modifier.width(8.dp))
                    Label("Departures", color = c.ink2)
                    Chevron()
                }
            }
        }
    }
        DropdownMenu(expanded = showActions, onDismissRequest = { showActions = false }, containerColor = c.ground) {
            DropdownMenuItem(text = { Text("Delete trip", color = c.warning, fontSize = 16.sp) }, onClick = {
                showActions = false
                actions.deleteTrip(trip.id)
            })
        }
    }
    Rule()
}

@Composable
private fun HomeFooter(actions: UiActions) {
    val c = LocalTrainColors.current
    Column {
        Rule(heavy = true)
        Row(Modifier.fillMaxWidth().padding(horizontal = PagePadding)) {
            Row(Modifier.weight(1f).heightIn(min = 56.dp).clickable(role = Role.Button, onClick = actions::newTrip), verticalAlignment = Alignment.CenterVertically) {
                Text("+", color = c.ink2, fontSize = 20.sp, fontWeight = FontWeight.Light)
                Spacer(Modifier.width(9.dp)); Label("New trip", color = c.ink, size = 12)
            }
            Row(Modifier.weight(1f).heightIn(min = 56.dp).clickable(role = Role.Button, onClick = actions::openSettings),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.End) {
                Icon(Icons.Outlined.Settings, null, Modifier.size(20.dp), c.ink2)
                Spacer(Modifier.width(9.dp)); Label("Settings", color = c.ink, size = 12)
            }
        }
    }
}

private fun Leg.modeName() = if (mode.equals("ferry", true)) "ferry" else "train"
private fun distanceText(metres: Int): String = if (metres < 1000) "${(metres / 10) * 10} m" else if (metres < 10_000) "${"%.1f".format(metres / 1000f)} km" else "${metres / 1000} km"
private fun focusedInstruction(journey: Journey, now: Long): String {
    journey.legs.zipWithNext().forEach { (before, after) ->
        if (now < before.effectiveArrival) {
            val wait = minutesBetween(before.effectiveArrival, after.effectiveDeparture)
            return if (wait < 5) "Tight change · $wait min${placeClause(before.toPlatform, before.mode)}"
                else "Get off at ${before.to.shortName}${placeClause(before.toPlatform, before.mode)}"
        }
        if (now < after.effectiveDeparture) {
            val wait = minutesBetween(now, after.effectiveDeparture).coerceAtLeast(0)
            return if (wait < 5) "Tight change · $wait min${placeClause(after.fromPlatform, after.mode)}"
                else "Change at ${after.from.shortName}${placeClause(after.fromPlatform, after.mode)}"
        }
    }
    val last = journey.legs.last()
    return "Stay on to ${last.to.shortName}"
}
private fun placeClause(raw: String?, mode: String): String {
    val p = platformText(raw, mode, full = true) ?: return ""
    return " · ${if (mode == "ferry" && !p.startsWith("Wharf", true)) "Wharf " else if (mode != "ferry" && !p.startsWith("Platform", true)) "Platform " else ""}$p"
}
