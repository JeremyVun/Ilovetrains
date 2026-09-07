package com.ilovetrains.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private const val FeedbackSuccessMessage = "Feedback sent. Thank you."
private const val FeedbackSuccessTimeoutMillis = 4_000L

@Composable
fun TrainApp(state: AppState, actions: UiActions) {
    TrainTheme(state.appearance) {
        val c = LocalTrainColors.current
        val accessibilityManager = LocalAccessibilityManager.current
        Box(Modifier.fillMaxSize().background(c.ground).windowInsetsPadding(WindowInsets.safeDrawing)) {
            if (!state.ready) {
                Box(Modifier.fillMaxSize().padding(PagePadding), contentAlignment = Alignment.CenterStart) {
                    Column {
                        Label("ilovetrains", color = c.ink, size = 11)
                        Text(state.timetableStatus, color = c.ink2, fontSize = 16.sp,
                            fontWeight = FontWeight.Light, modifier = Modifier.padding(top = 10.dp))
                    }
                }
            } else when (state.screen) {
                Screen.Home -> HomeScreen(state, actions)
                Screen.Board -> BoardScreen(state, actions)
                Screen.Detail -> DetailScreen(state, actions)
                Screen.Setup -> if (state.selectingHome) SettingsScreen(state, actions) else SetupScreen(state, actions)
                Screen.Settings -> SettingsScreen(state, actions)
            }
            state.message?.takeIf { state.ready }?.let { message ->
                LaunchedEffect(message, accessibilityManager) {
                    if (message == FeedbackSuccessMessage) {
                        val timeout = accessibilityManager?.calculateRecommendedTimeoutMillis(
                            originalTimeoutMillis = FeedbackSuccessTimeoutMillis,
                            containsIcons = false,
                            containsText = true,
                            containsControls = true,
                        ) ?: FeedbackSuccessTimeoutMillis
                        delay(timeout)
                        actions.dismissMessage()
                    }
                }
                Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(c.ink)
                    .heightIn(min = 52.dp).clickable(role = Role.Button, onClick = if (state.undoAvailable) actions::undoDelete else actions::dismissMessage)
                    .padding(horizontal = PagePadding), verticalAlignment = Alignment.CenterVertically) {
                    Text(message, Modifier.weight(1f), color = c.ground, fontSize = 14.sp, fontWeight = FontWeight.Normal,
                        maxLines = if (state.undoAvailable) 1 else Int.MAX_VALUE, overflow = TextOverflow.Clip)
                    Label(if (state.undoAvailable) "Undo" else "Dismiss", color = c.ground)
                }
            }
        }
    }
}
