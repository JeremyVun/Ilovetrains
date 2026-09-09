package com.ilovetrains.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

@Composable
fun BoardScreen(state: AppState, actions: UiActions) {
    val board = state.board
    val c = LocalTrainColors.current
    if (board == null) {
        Column(Modifier.fillMaxSize()) {
            BoardMast(null, state.now, actions)
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Label(if (state.refreshing) "Opening timetable" else "Timetable unavailable", color = c.ink3)
            }
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        BoardMast(board, state.now, actions)
        val visibleJourneys = board.journeys
        val past = remember(visibleJourneys, state.now) { visibleJourneys.filter { it.effectiveDeparture < state.now } }
        val future = remember(visibleJourneys, state.now) { visibleJourneys.filter { it.effectiveDeparture >= state.now } }
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = past.size)
        val hasPast = rememberUpdatedState(past.isNotEmpty())
        LaunchedEffect(listState, board.from.id, board.to.id) {
            snapshotFlow { listState.firstVisibleItemIndex to hasPast.value }.distinctUntilChanged()
                .filter { (index, available) -> index == 0 && available }
                .collect { actions.earlier() }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState) {
            items(past, key = { it.key }) { journey ->
                BoardRow(journey, board, state.now, onClick = { actions.openJourney(journey) })
            }
            item(key = "now") {
                Column(Modifier.fillMaxWidth().height(32.dp).padding(horizontal = PagePadding)) {
                    Label("Now · ${clockTime(state.now)}", Modifier.padding(top = 9.dp), color = c.ink, size = 11)
                }
            }
            items(future, key = { it.key }) { journey ->
                BoardRow(journey, board, state.now, onClick = { actions.openJourney(journey) })
            }
            if (visibleJourneys.isEmpty()) item(key = "empty") {
                Column(Modifier.fillMaxWidth().padding(horizontal = PagePadding, vertical = 22.dp)) {
                    Text(board.error ?: if (board.offline) "No services on the last board we could load"
                        else "No services in the next few hours",
                        color = if (board.error != null) c.warning else c.ink2,
                        fontSize = 16.sp, fontWeight = FontWeight.Light, lineHeight = 23.sp)
                    if (board.error != null) Label("Update timetable",
                        Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = actions::updateTimetable)
                            .wrapContentHeight(Alignment.CenterVertically), color = c.ink, size = 11)
                }
            }
            if (visibleJourneys.isNotEmpty()) item(key = "end") {
                Column(Modifier.fillMaxWidth().padding(horizontal = PagePadding, vertical = 15.dp)) {
                Label(if (visibleJourneys.size == 6) "— Six services shown" else "— End of board")
                    if (visibleJourneys.size <= 3) {
                        Text("Nothing scheduled after ${visibleJourneys.lastOrNull()?.let { clockTime(it.effectiveDeparture) } ?: clockTime(state.now)}.",
                            color = c.ink3, fontSize = 14.sp, fontWeight = FontWeight.Light,
                            modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardMast(board: BoardData?, now: Long, actions: UiActions) {
    val c = LocalTrainColors.current
    Column(Modifier.fillMaxWidth().padding(start = PagePadding, end = PagePadding, top = 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            BackButton("Home", actions::back)
            Spacer(Modifier.weight(1f))
            Freshness(board, now)
        }
        if (board != null) {
            Row(Modifier.fillMaxWidth().heightIn(min = 69.dp).padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(board.from.shortName, Modifier.weight(1f), color = c.ink, fontSize = 25.sp,
                    fontWeight = FontWeight.Light, lineHeight = 26.sp, maxLines = 3, overflow = TextOverflow.Clip)
                Row(Modifier.width(44.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).height(1.dp).background(c.rule2))
                    Text("›", color = c.ink3, fontSize = 18.sp)
                }
                Text(board.to.shortName, Modifier.weight(1f), color = c.ink, fontSize = 25.sp,
                    fontWeight = FontWeight.Light, lineHeight = 26.sp, textAlign = TextAlign.End,
                    maxLines = 3, overflow = TextOverflow.Clip)
            }
        } else Spacer(Modifier.height(56.dp))
        Rule(heavy = true)
    }
}

@Composable
fun BoardRow(journey: Journey, board: BoardData?, now: Long, onClick: (() -> Unit)? = null,
             detail: Boolean = false, figureOverride: Figure? = null, axisTravelledAt: Long? = null,
             axisProgress: Float? = null) {
    if (journey.legs.isEmpty()) return
    val c = LocalTrainColors.current
    val fig = figureOverride ?: figureFor(journey, board, now)
    val first = journey.legs.first()
    val late = minutesBetween(journey.departure, journey.effectiveDeparture) > 0
    val stale = board == null || board.offline || journey.retained || now - board.generatedAt > 90_000
    val figureColor = when {
        journey.cancelled || fig.past -> c.ink3
        late && !fig.past -> c.warning
        stale -> c.ink2
        !journey.realtime -> c.ink2
        else -> c.ink
    }
    val clickable = if (onClick == null) Modifier else Modifier.clickable(role = Role.Button, onClick = onClick)
    Row(clickable.fillMaxWidth().testTag("board-journey-${journey.key}").heightIn(min = if (detail) 100.dp else 96.dp)
        .background(c.ground).padding(horizontal = PagePadding, vertical = if (detail) 8.dp else 7.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(if (detail) 69.dp else 72.dp), horizontalAlignment = Alignment.End) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(fig.value, color = figureColor, fontSize = when {
                    wideFigure(fig) -> 28.sp
                    else -> 40.sp
                },
                    modifier = Modifier.testTag("board-figure-${journey.key}"),
                    fontWeight = FontWeight(250), letterSpacing = (-1.5).sp, lineHeight = 38.sp,
                    maxLines = 1, softWrap = false)
                if (fig.unit.isNotEmpty()) Text(fig.unit, color = figureColor, fontSize = 12.sp,
                    fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 2.dp, bottom = 4.dp))
            }
            Label(fig.provenance, Modifier.fillMaxWidth().heightIn(min = 12.dp).padding(top = 4.dp),
                color = if (late && !fig.past || journey.cancelled) c.warning else c.ink3,
                size = if (fig.provenance.length >= 9) 7 else 9, align = TextAlign.End, maxLines = 1)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Text(clockTime(journey.effectiveDeparture), color = if (late && journey.realtime) c.warning else if (journey.cancelled) c.ink3 else c.ink,
                    fontSize = 18.sp, fontWeight = FontWeight.Light,
                    textDecoration = if (journey.cancelled) TextDecoration.LineThrough else null)
                if (late && journey.effectiveDeparture != journey.departure) {
                    Text(clockTime(journey.departure), color = c.ink3, fontSize = 13.sp, fontWeight = FontWeight.Light,
                        textDecoration = TextDecoration.LineThrough, modifier = Modifier.padding(start = 7.dp))
                }
                Spacer(Modifier.weight(1f))
                Text(clockTime(journey.effectiveArrival), color = c.ink3, fontSize = 16.sp,
                    fontWeight = FontWeight.Light,
                    textDecoration = if (journey.cancelled) TextDecoration.LineThrough else null)
                if (journey.cancelled) Label("Cancelled", Modifier.padding(start = 7.dp), color = c.warning, size = 9)
            }
            JourneyAxis(journey, Modifier.fillMaxWidth().padding(top = 6.dp).alpha(if (journey.cancelled) .3f else 1f),
                travelledAt = axisTravelledAt, progress = axisProgress)
            Text(first.headsign.ifBlank { first.to.shortName }, color = c.ink3, fontSize = 13.sp,
                fontWeight = FontWeight.Light, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp))
        }
    }
    Rule()
}
