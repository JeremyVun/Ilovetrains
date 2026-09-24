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
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxState
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Gmail's dismiss red, the swipe background Android users already know. */
private val DismissRed = Color(0xFFD93025)

@Composable
fun HomeScreen(state: AppState, actions: UiActions) {
    val c = LocalTrainColors.current
    val board = state.homeBoard ?: state.board
    val alternatives = state.focus?.alternatives ?: board
    val answer = homeAnswer(board, state.focus, state.now, state.enabledModes, state.transferLimit?.maxTransfers)
    Column(Modifier.fillMaxSize()) {
        if (answer != null) SmartHeader(state, answer.board, alternatives, answer.journey, answer.cancelledLeadTime, actions)
        else if (state.trips.isNotEmpty()) SmartLoadingHeader(state, board, actions)
        else if (state.totalTrips > 0) {
            Column(Modifier.fillMaxWidth().padding(horizontal = PagePadding, vertical = 28.dp)) {
                Text("No trips match your selected services.", color = c.ink2,
                    fontSize = 20.sp, fontWeight = FontWeight.Light, lineHeight = 28.sp)
                Label("Change settings", Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = actions::openSettings)
                    .wrapContentHeight(Alignment.CenterVertically), color = c.ink)
            }
            Rule(heavy = true)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            item("anchor") { Label("My trips", Modifier.padding(start = PagePadding, end = PagePadding, top = 22.dp, bottom = 10.dp), color = c.ink, size = 11) }
            items(state.trips, key = { it.id }) { trip -> SavedTripRow(trip, state, actions, Modifier.animateItem()) }
            item("end") { Label("— End of trips", Modifier.padding(start = PagePadding, end = PagePadding, top = 14.dp, bottom = 6.dp)) }
        }
        MessageBar(state, actions)
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
private fun SmartHeader(state: AppState, board: BoardData, alternatives: BoardData?, journey: Journey,
                        cancelledLeadTime: Long?, actions: UiActions) {
    val c = LocalTrainColors.current
    val maxTransfers = state.transferLimit?.maxTransfers
    val fig = figureFor(journey, board, state.now)
    val first = journey.legs.first()
    val focus = state.focus
    val header = focus?.takeIf { cancelledLeadTime == null }
        ?.let { focusHeader(it, state.now, state.focusComplete, state.arrival) }
    val late = minutesBetween(journey.departure, journey.effectiveDeparture) > 0
    val warnFigure = late || header?.status?.late == true
    val focusState = header?.status
    val focused = focus != null && cancelledLeadTime == null
    val explicitlyPinned = focused && focus?.pinned == true
    val departed = focused && state.now >= journey.effectiveDeparture
    val completed = state.focusComplete || state.arrival?.state == ArrivalState.Arrived
    val overdue = focused && state.now >= journey.effectiveArrival && !completed
    val boardFigure = if (overdue) {
        val past = ((state.now - journey.effectiveArrival) / 60_000).toInt()
        Figure(if (state.arrival?.moving == true && past > 0) past.toString() else "—",
            if (state.arrival?.moving == true && past > 0) "min" else "",
            if (state.arrival?.moving == true && past > 0) "Past estimate" else "Last estimate", past = true)
    } else if (departed && !completed) {
        directionFigureFor(journey, state.now) ?: fig
    } else fig
    val directionFigure = homeHeaderFigure(header, departed, boardFigure)
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = if (explicitlyPinned) 44.dp else 22.dp).padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
            val status = when {
                focusState != null -> focusState.text
                journey.retained && board.offline && state.now >= journey.effectiveDeparture -> "Last shown"
                state.distanceMetres != null && state.distanceMetres <= 200 -> "At ${first.from.shortName}"
                state.distanceMetres != null -> "${distanceText(state.distanceMetres)} to ${first.from.shortName}"
                else -> "Next ${first.modeName()}"
            }
            Row(modifier = if (explicitlyPinned) Modifier.heightIn(min = 44.dp)
                .clickable(role = Role.Button, onClick = actions::unpinJourney) else Modifier,
                verticalAlignment = Alignment.CenterVertically) {
                val statusWarns = focusState?.warning == true || journey.cancelled || late && !focused
                if (explicitlyPinned && status == "Pinned") {
                    Icon(Icons.Filled.PushPin, null, Modifier.size(12.dp), tint = c.ink2)
                    Spacer(Modifier.width(5.dp)); Label("Pinned", color = c.ink2, size = 11)
                } else {
                Label(status, color = if (statusWarns) c.warning else c.ink2, size = 11)
                    if (explicitlyPinned && header?.pinWord == false) {
                        Spacer(Modifier.width(8.dp))
                        Icon(Icons.Filled.PushPin, null, Modifier.size(12.dp), tint = if (statusWarns) c.warning else c.ink2)
                    } else if (explicitlyPinned) {
                        Label(" · ", color = c.ink3, size = 11)
                        Icon(Icons.Filled.PushPin, null, Modifier.size(12.dp), tint = c.ink2)
                        Spacer(Modifier.width(4.dp)); Label("Pinned", color = c.ink2, size = 11)
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Freshness(board, state.now)
        }
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { actions.openJourney(journey) }
            .testTag("home-journey").padding(horizontal = PagePadding, vertical = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.width(104.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(directionFigure.value, color = if (warnFigure) c.warning else c.ink,
                        modifier = Modifier.testTag("home-primary-figure"),
                        fontSize = when {
                            wideFigure(directionFigure) -> 50.sp
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
                    val clocks = header?.arrival
                    Row(Modifier.padding(top = 7.dp), verticalAlignment = Alignment.Bottom) {
                        if (clocks?.struck != null && clocks.shown != null) {
                            Text(clocks.struck, color = c.ink3, fontSize = 20.sp, fontWeight = FontWeight.Light,
                                textDecoration = TextDecoration.LineThrough, modifier = Modifier.padding(end = 9.dp))
                        }
                        val shown = clocks?.shown ?: clocks?.struck ?: clocks?.planned ?: clockTime(journey.effectiveArrival)
                        Text(shown, color = c.ink2, fontSize = 20.sp, fontWeight = FontWeight.Light,
                            textDecoration = if (clocks?.shown == null && clocks?.struck != null) TextDecoration.LineThrough else null)
                    }
                    if (clocks?.planned != null) Label("Planned", Modifier.padding(top = 4.dp), color = c.ink3, size = 10)
                    else if (overdue) Label("Last estimate", Modifier.padding(top = 4.dp), color = c.ink3, size = 10)
                }
            }
        }
        val overdueUnconfirmed = overdue
        val progress = if (departed && !completed) {
            val duration = (journey.effectiveArrival - journey.effectiveDeparture).coerceAtLeast(1)
            if (overdueUnconfirmed) .98f else {
                val elapsed = ((state.now - journey.effectiveDeparture) / 60_000) * 60_000
                (elapsed.toFloat() / duration).coerceIn(0f, .999f)
            }
        } else null
        JourneyAxis(journey, Modifier.fillMaxWidth().padding(horizontal = PagePadding), large = true, tinyTrain = true,
            recoveryFrom = header?.recoveryFrom,
            showCap = !departed, progress = progress?.takeIf { !overdueUnconfirmed || state.arrival?.moving == true },
            travelledAt = progress?.let { journey.effectiveDeparture +
                ((journey.effectiveArrival - journey.effectiveDeparture) * it).toLong() })
        val instruction = when {
            cancelledLeadTime != null -> "${clockTime(cancelledLeadTime)} cancelled · next ${first.modeName()}"
            completed && state.arrival?.basis == ArrivalBasis.Estimate -> if (journey.legs.any { it.estimatedArrival != null })
                "The last arrival estimate has passed. The return trip is ready."
                else "The scheduled trip has ended. The return trip is ready."
            completed -> "The journey has finished"
            overdueUnconfirmed && state.arrival?.moving == true -> "Still on the way to ${journey.legs.last().to.shortName}."
            overdueUnconfirmed && state.arrival?.state == ArrivalState.CheckingArrival ->
                "Checking arrival at ${journey.legs.last().to.shortName}."
            overdueUnconfirmed -> "Arrival time needs an update."
            header != null && departed -> header.instruction
            else -> first.headsign.ifBlank { first.to.shortName }
        }
        if (cancelledLeadTime != null || header?.warnInstruction == true && departed) {
            Label(instruction, Modifier.padding(horizontal = PagePadding, vertical = 8.dp), color = c.warning, size = 11, maxLines = 2)
        } else {
            Text(instruction, color = if (departed) c.ink else c.ink2, fontSize = 15.sp,
                fontWeight = if (departed) FontWeight.Normal else FontWeight.Light,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = PagePadding, end = PagePadding, top = 6.dp, bottom = 8.dp))
        }
        val receipt = header?.receipt?.takeIf { it.isNotBlank() && departed } ?: state.receipt
        if (!receipt.isNullOrBlank()) {
            Text(receipt, color = c.ink2, fontSize = 15.sp, fontWeight = FontWeight.Light,
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
            val following = alternatives ?: board
            earliestAlternative(following.recommendationCandidates(state.now, TransferConstraint(maxTransfers)), journey, state.now,
                state.enabledModes, maxTransfers)?.let { alternative ->
                val next = alternative.journey
                Rule(Modifier.padding(horizontal = PagePadding))
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = PagePadding)
                    .clickable(role = Role.Button) { actions.openJourney(next) }, verticalAlignment = Alignment.CenterVertically) {
                    val nextMode = next.legs.firstOrNull()?.mode
                    val relation = if (next.effectiveDeparture < journey.effectiveDeparture) "Earlier" else "Next"
                    Label("$relation ${when (nextMode) { "ferry" -> "ferry"; "metro" -> "metro"; "train" -> "train"; else -> "service" }}",
                        Modifier.width(96.dp), size = 9)
                    val nextFigure = nextServiceFigure(next, alternative.source, state.now)
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
private fun SavedTripRow(trip: SavedTrip, state: AppState, actions: UiActions, modifier: Modifier = Modifier) {
    val c = LocalTrainColors.current
    var showActions by remember(trip.id) { mutableStateOf(false) }
    val focused = state.focus?.tripId == trip.id
    val shown = state.selectedTripId == trip.id
    val lines = trip.lines
    val highlighted = focused || shown
    val metadata = state.tripMetadata[trip.id].orEmpty()
    // The header already names its own trip and status, so every row carries only its own facts.
    val summary = metadata.ifBlank { "Saved trip" }
    val justAdded = state.justAddedTripId == trip.id && shown && state.focus == null
    // Plain remember: the lazy list's saved state would bring an undone row back already dismissed.
    val dismissState = remember(trip.id) { SwipeToDismissBoxState(SwipeToDismissBoxValue.Settled, positionalThreshold = { it * 0.5f }) }
    SwipeToDismissBox(dismissState, backgroundContent = {
        Box(Modifier.fillMaxSize().background(DismissRed).padding(horizontal = PagePadding), contentAlignment = Alignment.CenterEnd) {
            Icon(Icons.Outlined.Delete, contentDescription = null, Modifier.size(24.dp), tint = Color.White)
        }
    }, modifier = modifier.testTag("trip-${trip.id}"), enableDismissFromStartToEnd = false,
        onDismiss = { actions.deleteTrip(trip.id) }) {
    Column(Modifier.fillMaxWidth().background(c.ground).padding(horizontal = PagePadding)) {
    Box(Modifier.fillMaxWidth()) {
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp)
        .semantics { customActions = listOf(CustomAccessibilityAction("Trip actions") { showActions = true; true }) }
        .combinedClickable(role = Role.Button, onClick = { actions.openTrip(trip.id) }, onLongClick = { showActions = true })
        .padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.width(15.dp).height(52.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            lines.take(3).forEach { code ->
                Box(Modifier.width(3.dp).fillMaxHeight().background(lineColor(code, if (code.startsWith("F")) "ferry" else "train", c, true)))
            }
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                lines.firstOrNull()?.let { firstCode ->
                    LineChip(firstCode, if (firstCode.startsWith("F")) "ferry" else "train", firstCode,
                        Modifier.padding(end = 6.dp), height = 20.dp, horizontalPadding = 5.dp)
                }
                Text(trip.from.shortName, Modifier.weight(1f, fill = false), color = c.ink, fontSize = 19.sp,
                    lineHeight = 22.sp, fontWeight = FontWeight.Light, letterSpacing = (-.28).sp,
                    maxLines = 2, overflow = TextOverflow.Clip)
                Text("  →  ", color = c.ink3, fontSize = 19.sp, fontWeight = FontWeight.Light)
                if (lines.size > 1) {
                    val lastCode = lines.last()
                    LineChip(lastCode, if (lastCode.startsWith("F")) "ferry" else "train", lastCode,
                        Modifier.padding(end = 6.dp), height = 20.dp, horizontalPadding = 5.dp)
                }
                Text(trip.to.shortName, Modifier.weight(1f, fill = false), color = c.ink, fontSize = 19.sp,
                    lineHeight = 22.sp, fontWeight = FontWeight.Light, letterSpacing = (-.28).sp,
                    maxLines = 2, overflow = TextOverflow.Clip)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (justAdded) {
                    val distance = justAddedDistance(metadata)
                    Text(buildAnnotatedString {
                        withStyle(SpanStyle(fontSize = 12.sp, fontStyle = FontStyle.Italic,
                            fontWeight = FontWeight.Normal, letterSpacing = 0.sp)) { append("Just added") }
                        if (distance.isNotEmpty()) append(" · ${distance.uppercase(java.util.Locale.ENGLISH)}")
                    }, Modifier.weight(1f), color = c.ink3, fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold, letterSpacing = 1.4.sp, maxLines = 2)
                } else {
                    Label(summary, Modifier.weight(1f), color = if (highlighted) c.ink2 else c.ink3, maxLines = 2)
                }
                Spacer(Modifier.width(8.dp))
                Label("Departures", color = c.ink2)
                Chevron()
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
    }
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
