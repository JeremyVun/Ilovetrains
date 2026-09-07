package com.ilovetrains.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun SetupScreen(state: AppState, actions: UiActions) {
    val c = LocalTrainColors.current
    val from = state.setupFrom
    val to = state.setupTo
    val selectingFrom = from == null
    val selectingTo = from != null && to == null
    var query by remember(from?.id, to?.id) { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val recent = if (from == null) state.recentFrom else state.recentTo
    val matches = remember(query, state.stations, from) {
        val excluded = from?.id
        if (query.length < 3) emptyList() else state.stations.asSequence()
            .filter { it.id != excluded }
            .map { it to stationFuzzyScore(it.name, query) }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
            .map { it.first }.take(8).toList()
    }
    Column(Modifier.fillMaxSize()) {
        if (state.trips.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = PagePadding)) { BackButton("Home", actions::back) }
        }
        Column(Modifier.padding(horizontal = PagePadding)) {
            Text("New trip", color = c.ink, fontSize = 29.sp, fontWeight = FontWeight.Light,
                modifier = Modifier.padding(top = if (state.trips.isEmpty()) 10.dp else 2.dp, bottom = 12.dp))
            Rule(heavy = true)
        }
        LazyColumn(Modifier.weight(1f).padding(horizontal = PagePadding)) {
            item("from") {
                SetupField("From", from?.shortName.orEmpty(), "Origin station", selectingFrom, focusRequester, query,
                    onQuery = { actions.setupOriginQueryChanged(); query = it }, onClick = { if (from != null) actions.clearSetupFrom() },
                    onSearch = { matches.firstOrNull()?.let(actions::chooseSetupFrom) })
            }
            item("to") {
                SetupField("To", to?.shortName.orEmpty(), "Destination station", selectingTo, focusRequester, query,
                    onQuery = { query = it }, onClick = { if (to != null) actions.clearSetupTo() },
                    onSearch = { matches.firstOrNull()?.let(actions::chooseSetupTo) })
            }
            if (selectingFrom && query.isBlank()) {
                item("location-title") { Label("Nearby", Modifier.padding(top = 18.dp, bottom = 4.dp)) }
                item("location") {
                    val status = state.setupLocationStatus
                    if (status == SetupLocationStatus.Locating) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).semantics { liveRegion = LiveRegionMode.Polite },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = c.ink2, strokeWidth = 2.dp)
                            Text("Finding your location…", color = c.ink2, fontSize = 16.sp)
                        }
                        Rule()
                    } else {
                        val message = status.message ?: if (state.locationDenied) "Location is blocked. Allow access in Settings or search for a station." else null
                        if (message != null) Text(message, color = c.ink2, fontSize = 14.sp,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp).semantics { liveRegion = LiveRegionMode.Polite })
                        val title = when {
                            state.locationDenied || status == SetupLocationStatus.ServicesDisabled -> "Open Settings"
                            status == SetupLocationStatus.Idle || status == SetupLocationStatus.ChooseStation -> "Use my location"
                            else -> "Try again"
                        }
                        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = actions::requestLocation),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(title, Modifier.weight(1f), color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Light)
                        }
                        Rule()
                    }
                }
                if (state.setupLocationStatus != SetupLocationStatus.Locating) {
                    items(state.nearbyStations, key = { "nearby-${it.id}" }) { station ->
                        StationResult(station) { actions.chooseSetupFrom(station) }
                    }
                }
            }
            if ((selectingFrom || selectingTo) && query.isBlank() && recent.isNotEmpty()) {
                item("recent-title") { Label("You searched before", Modifier.padding(top = 18.dp, bottom = 4.dp)) }
                items(recent.filter { it.id != from?.id }.take(6), key = { "recent-${it.id}" }) { station ->
                    StationResult(station) {
                        if (selectingFrom) actions.chooseSetupFrom(station) else actions.chooseSetupTo(station)
                    }
                }
            } else if ((selectingFrom || selectingTo) && query.length in 1..2) {
                item("hint") { Label("Type at least three letters", Modifier.padding(vertical = 16.dp)) }
            } else if ((selectingFrom || selectingTo) && query.length >= 3 && matches.isEmpty()) {
                item("none") { Label(if (query.length <= 4) "No match yet · keep typing" else "No stations match",
                    Modifier.padding(vertical = 16.dp), color = c.warning) }
            } else if (matches.isNotEmpty()) {
                item("matches-title") { Label("Matches", Modifier.padding(top = 18.dp, bottom = 4.dp)) }
                items(matches, key = { it.id }) { station ->
                    StationResult(station) {
                        if (selectingFrom) actions.chooseSetupFrom(station) else actions.chooseSetupTo(station)
                    }
                }
            }
        }
        when {
            from != null && to != null -> ActionRail("Save trip", { actions.saveTrip(from, to) })
            selectingTo && query.isBlank() -> ActionRail("Choose where you’re going", {}, enabled = false)
            selectingFrom && query.isBlank() -> ActionRail("Choose where you’re leaving from", {}, enabled = false)
        }
    }
    LaunchedEffect(from?.id, to?.id) {
        if (selectingTo || (selectingFrom && state.setupLocationStatus == SetupLocationStatus.Idle)) focusRequester.requestFocus()
    }
    LaunchedEffect(state.setupLocationStatus) {
        if (state.setupLocationStatus == SetupLocationStatus.Locating || state.setupLocationStatus == SetupLocationStatus.ChooseStation) {
            focusManager.clearFocus(); keyboard?.hide()
        }
    }
}

@Composable
private fun SetupField(label: String, value: String, placeholder: String, active: Boolean,
                       focusRequester: FocusRequester, query: String, onQuery: (String) -> Unit, onClick: () -> Unit,
                       onSearch: () -> Unit) {
    val c = LocalTrainColors.current
    Column(Modifier.fillMaxWidth().heightIn(min = 72.dp).clickable(enabled = !active, onClick = onClick)
        .padding(top = 15.dp)) {
        Label(label)
        if (active) {
            BasicTextField(query, onQuery, Modifier.fillMaxWidth().heightIn(min = 45.dp).focusRequester(focusRequester),
                textStyle = androidx.compose.ui.text.TextStyle(color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Normal),
                cursorBrush = SolidColor(c.ink), singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                decorationBox = { inner -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) Text(placeholder, color = c.ink3, fontSize = 20.sp, fontWeight = FontWeight.Light)
                    inner()
                } })
        } else {
            Text(if (value.isBlank()) placeholder else value, color = if (value.isBlank()) c.ink3 else c.ink,
                fontSize = 20.sp, fontWeight = if (value.isBlank()) FontWeight.Light else FontWeight.Normal,
                modifier = Modifier.heightIn(min = 45.dp).wrapContentHeight(Alignment.CenterVertically))
        }
        Rule()
    }
}

@Composable
private fun StationResult(station: Station, onClick: () -> Unit) {
    val c = LocalTrainColors.current
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick)
        .padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(station.shortName, Modifier.weight(1f), color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Light)
        Label(station.modes.sorted().joinToString(" · "))
    }
    Rule()
}
