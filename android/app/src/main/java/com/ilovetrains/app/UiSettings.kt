package com.ilovetrains.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private enum class SettingsPage { Main, Feedback }
private enum class LocationSettingsState { Off, Ask, Blocked, On }

@Composable
fun SettingsScreen(state: AppState, actions: UiActions) {
    var page by remember { mutableStateOf(SettingsPage.Main) }
    when {
        state.selectingHome -> HomePicker(state, actions)
        page == SettingsPage.Feedback -> FeedbackScreen(
            state = state,
            actions = actions,
            category = state.feedbackCategory,
            message = state.feedbackDraft,
            onCategoryChange = actions::setFeedbackCategory,
            onMessageChange = actions::setFeedbackDraft,
            onBack = { page = SettingsPage.Main },
        )
        else -> SettingsMain(state, actions) { page = SettingsPage.Feedback }
    }
}

@Composable
private fun SettingsShell(title: String, backLabel: String, onBack: () -> Unit,
                          rail: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalTrainColors.current
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = PagePadding)) {
            BackButton(backLabel, onBack)
            Text(title, color = c.ink, fontSize = 29.sp, fontWeight = FontWeight.Light,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
            Rule(heavy = true)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = PagePadding, vertical = 0.dp), content = content)
        rail?.invoke()
    }
}

@Composable
private fun SettingsMain(state: AppState, actions: UiActions, feedback: () -> Unit) {
    val c = LocalTrainColors.current
    SettingsShell("Settings", "Home", actions::back) {
        SettingsSection("Personal")
        val locationState = when {
            !state.useLocation -> LocationSettingsState.Off
            state.locationDenied -> LocationSettingsState.Blocked
            !state.locationGranted -> LocationSettingsState.Ask
            else -> LocationSettingsState.On
        }
        val locationSubtitle = when (locationState) {
            LocationSettingsState.Off -> "Location is not used"
            LocationSettingsState.Ask -> "Location needs permission"
            LocationSettingsState.Blocked -> "Location is blocked"
            LocationSettingsState.On -> "Nearby trips use location"
        }
        val locationMark = when (locationState) {
            LocationSettingsState.Off -> "TURN ON"
            LocationSettingsState.Ask -> "ALLOW"
            LocationSettingsState.Blocked -> "OPEN SETTINGS ›"
            LocationSettingsState.On -> "TURN OFF"
        }
        val locationAction: () -> Unit = when (locationState) {
            LocationSettingsState.Off -> { { actions.setUseLocation(true) } }
            LocationSettingsState.Ask, LocationSettingsState.Blocked -> actions::requestLocation
            LocationSettingsState.On -> { { actions.setUseLocation(false) } }
        }
        val locationToggleState = when (locationState) {
            LocationSettingsState.Off -> ToggleableState.Off
            LocationSettingsState.On -> ToggleableState.On
            LocationSettingsState.Ask, LocationSettingsState.Blocked -> null
        }
        SettingsPersonalRow(Icons.Outlined.LocationOn, "Use location", locationSubtitle, locationMark,
            locationAction, valueWarning = locationState == LocationSettingsState.Blocked,
            primaryState = true, toggleState = locationToggleState)
        val homeValue = when {
            state.home == null -> "Automatic"
            state.homeIsManual -> state.home.shortName
            else -> "Automatic — ${state.home.shortName}"
        }
        SettingsPersonalRow(Icons.Outlined.Home, "Home", homeValue, if (state.homeIsManual) "Change  ›" else "Set  ›", actions::chooseHome)

        Spacer(Modifier.height(22.dp)); SettingsSection("Services")
        Row(Modifier.fillMaxWidth()) {
            listOf("train" to "Trains", "metro" to "Metro", "ferry" to "Ferries", "bus" to "Buses").forEach { (mode, label) ->
                val enabled = mode in state.enabledModes
                val available = mode != "bus"
                ServiceChoice(mode, label, enabled, available, Modifier.weight(1f)) {
                    if (available) actions.setMode(mode, !enabled)
                }
            }
        }
        Rule()
        Label(if (state.enabledModes.isEmpty()) "No services selected. Turn one on to see trips."
            else "Trips use chosen services only.", Modifier.padding(top = 8.dp),
            color = if (state.enabledModes.isEmpty()) c.warning else c.ink3, maxLines = 3)

        Spacer(Modifier.height(22.dp)); SettingsSection("Appearance")
        Row(Modifier.fillMaxWidth()) {
            listOf(Appearance.System, Appearance.Light, Appearance.Dark).forEach { appearance ->
                AppearanceChoice(appearance, state.appearance == appearance, Modifier.weight(1f)) { actions.setAppearance(appearance) }
            }
        }
        Rule()

        Spacer(Modifier.height(22.dp)); Rule()
        SecondaryRow("Send feedback", "›", feedback)
        SecondaryRow("Offline timetable", state.timetableStatus, actions::updateTimetable,
            enabled = !state.timetableUpdating)
        SecondaryRow("Version ${state.version}", "", null)
        Spacer(Modifier.height(18.dp))
    }
}

@Composable
private fun SettingsSection(text: String) {
    Label(text, Modifier.fillMaxWidth().heightIn(min = 30.dp).wrapContentHeight(Alignment.Bottom).padding(bottom = 7.dp))
    Rule()
}

@Composable
private fun SettingsPersonalRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, value: String,
                                state: String, onClick: () -> Unit, valueWarning: Boolean = false,
                                primaryState: Boolean = false, toggleState: ToggleableState? = null) {
    val c = LocalTrainColors.current
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp)
        .semantics(mergeDescendants = true) {
            contentDescription = "$title, $value, $state"
            if (toggleState != null) toggleableState = toggleState
        }
        .clickable(role = Role.Button, onClick = onClick)
        .padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(23.dp), c.ink2); Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Normal)
            Text(value, color = if (valueWarning) c.warning else c.ink2, fontSize = 12.sp,
                fontWeight = FontWeight.Light, modifier = Modifier.padding(top = 4.dp))
        }
        Label(state, color = if (primaryState) c.ink else c.ink2, maxLines = 1)
    }
    Rule()
}

@Composable
private fun ServiceChoice(mode: String, label: String, enabled: Boolean, available: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = LocalTrainColors.current
    val height = if (LocalDensity.current.fontScale > 1.15f) 102.dp else 86.dp
    Box(modifier.height(height)) {
        Column(Modifier.fillMaxSize().clickable(enabled = available, role = Role.Button, onClick = onClick)
            .padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            ServiceIcon(mode, if (enabled && available) c.ink else c.ink3)
            Label(label, Modifier.padding(top = 6.dp), color = if (available) c.ink else c.ink3, size = 12)
            Label(if (enabled) "On" else "Off", Modifier.padding(top = 4.dp),
                color = if (enabled) c.ink else c.ink3, size = 9)
        }
        if (mode != "train") Box(Modifier.align(Alignment.CenterStart).fillMaxHeight().width(1.dp).background(c.rule))
    }
}

@Composable
private fun AppearanceChoice(value: Appearance, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = LocalTrainColors.current
    val height = if (LocalDensity.current.fontScale > 1.15f) 102.dp else 86.dp
    Box(modifier.height(height)) {
    Column(Modifier.fillMaxSize().clickable(role = Role.RadioButton, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        AppearancePreview(value)
        Label(value.name, Modifier.padding(top = 7.dp), color = if (selected) c.ink else c.ink2, size = 12)
        Box(Modifier.height(14.dp), contentAlignment = Alignment.Center) {
            if (value == Appearance.System) Label("Follow device", color = if (selected) c.ink else c.ink3, size = 9)
        }
    }
    if (value != Appearance.System) Box(Modifier.align(Alignment.CenterStart).fillMaxHeight().width(1.dp).background(c.rule))
    if (selected) Icon(Icons.Outlined.Check, null, Modifier.align(Alignment.TopEnd).padding(8.dp).size(14.dp), tint = c.ink)
    }
}

@Composable
private fun AppearancePreview(value: Appearance) {
    val c = LocalTrainColors.current
    Row(Modifier.width(39.dp).height(25.dp).border(1.dp, c.rule2)) {
        val halves = if (value == Appearance.System) listOf(false, true) else listOf(value == Appearance.Dark)
        halves.forEach { dark ->
            val paper = if (dark) androidx.compose.ui.graphics.Color(0xFF0A0B0D) else androidx.compose.ui.graphics.Color(0xFFFAF9F5)
            val ink = if (dark) androidx.compose.ui.graphics.Color(0xFFF4F5F7) else androidx.compose.ui.graphics.Color(0xFF14120E)
            Box(Modifier.weight(1f).fillMaxHeight().background(paper)) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 5.dp).height(2.dp).offset(y = 7.dp).background(ink))
                Box(Modifier.fillMaxWidth().padding(horizontal = 5.dp).height(2.dp).offset(y = 14.dp).background(ink))
            }
        }
    }
}

@Composable
private fun SecondaryRow(name: String, value: String, onClick: (() -> Unit)?, enabled: Boolean = true) {
    val c = LocalTrainColors.current
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (onClick != null) Modifier.clickable(enabled, role = Role.Button, onClick = onClick) else Modifier),
        verticalAlignment = Alignment.CenterVertically) {
        Text(name, color = c.ink2, fontSize = 14.sp, fontWeight = FontWeight.Light)
        Spacer(Modifier.weight(1f))
        Text(value, color = c.ink3, fontSize = 11.sp, fontWeight = FontWeight.Light, maxLines = 2)
    }
    Rule()
}

@Composable
private fun HomePicker(state: AppState, actions: UiActions) {
    val c = LocalTrainColors.current
    var query by remember { mutableStateOf("") }
    val results = remember(query, state.stations) { if (query.length < 3) emptyList() else state.stations
        .map { it to stationFuzzyScore(it.name, query) }.filter { it.second > 0 }.sortedByDescending { it.second }.take(8).map { it.first } }
    SettingsShell("Home station", "Settings", actions::back,
        rail = if (state.homeIsManual) { { ActionRail("Use automatic home", { actions.setHome(null) }) } } else null) {
        Label("Home station", Modifier.padding(top = 16.dp))
        BasicTextField(query, { query = it }, Modifier.fillMaxWidth().heightIn(min = 52.dp), singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(c.ink, 20.sp, FontWeight.Normal), cursorBrush = SolidColor(c.ink),
            decorationBox = { inner -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                if (query.isEmpty()) Text("Station name", color = c.ink3, fontSize = 20.sp, fontWeight = FontWeight.Light)
                inner()
            } }); Rule()
        if (query.length in 1..2) Text("Type at least three letters.", color = c.ink2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 14.dp))
        if (query.length >= 3 && results.isEmpty()) Text("No matching stations.", color = c.warning, fontSize = 14.sp, modifier = Modifier.padding(vertical = 14.dp))
        if (results.isNotEmpty()) Label("Matches", Modifier.padding(top = 18.dp, bottom = 4.dp))
        results.forEach { station -> StationSettingsResult(station) { actions.setHome(station) } }
    }
}

@Composable
private fun StationSettingsResult(station: Station, onClick: () -> Unit) {
    val c = LocalTrainColors.current
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Text(station.shortName, Modifier.weight(1f), color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Light)
        Label(station.modes.sorted().joinToString(" · "))
    }; Rule()
}

@Composable
private fun FeedbackScreen(state: AppState, actions: UiActions, category: String, message: String,
                           onCategoryChange: (String) -> Unit, onMessageChange: (String) -> Unit,
                           onBack: () -> Unit) {
    val c = LocalTrainColors.current
    var messageFocused by remember { mutableStateOf(false) }
    SettingsShell("Send feedback", "Settings", onBack,
        rail = { ActionRail(if (state.feedbackSubmitting) "Sending…" else "Send feedback",
            { actions.feedback(message.trim(), category) }, enabled = message.isNotBlank() && !state.feedbackSubmitting) }) {
        SettingsSection("Category")
        Row(Modifier.fillMaxWidth()) {
            listOf("problem", "suggestion", "other").forEach { value ->
                Column(Modifier.weight(1f).heightIn(min = 56.dp)
                    .clickable(enabled = !state.feedbackSubmitting, role = Role.RadioButton) { onCategoryChange(value) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Label(value, color = if (category == value) c.ink else c.ink3)
                    Label(if (category == value) "●" else "○", color = if (category == value) c.ink else c.ink3)
                }
            }
        }; Rule()
        Label("Message", Modifier.padding(top = 16.dp), color = if (messageFocused) c.ink else c.ink3)
        BasicTextField(message, onMessageChange, Modifier.fillMaxWidth().heightIn(min = 150.dp).padding(top = 9.dp)
            .onFocusChanged { messageFocused = it.isFocused },
            enabled = !state.feedbackSubmitting,
            textStyle = androidx.compose.ui.text.TextStyle(c.ink, 18.sp, FontWeight.Light, lineHeight = 26.sp), cursorBrush = SolidColor(c.ink),
            decorationBox = { inner -> Box(Modifier.fillMaxSize()) { if (message.isEmpty()) Text("What happened?", color = c.ink3, fontSize = 18.sp); inner() } })
        Rule(heavy = messageFocused)
        Text("Don’t include personal details.", color = c.ink2, fontSize = 14.sp, fontWeight = FontWeight.Light, modifier = Modifier.padding(vertical = 14.dp))
    }
}
