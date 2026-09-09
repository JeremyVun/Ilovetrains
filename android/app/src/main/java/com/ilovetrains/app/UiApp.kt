package com.ilovetrains.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private const val FeedbackSuccessTimeoutMillis = 4_000L

@Composable
fun TrainApp(state: AppState, actions: UiActions) {
    TrainTheme(state.appearance) {
        CompositionLocalProvider(LocalTinyTrainFlag provides state.tinyTrain) { TrainAppContent(state, actions) }
    }
}

@Composable
private fun TrainAppContent(state: AppState, actions: UiActions) {
    val c = LocalTrainColors.current
    Box(Modifier.fillMaxSize().background(c.ground).testTag("train-app-root").windowInsetsPadding(WindowInsets.safeDrawing)) {
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
        if (state.screen != Screen.Home) {
            MessageBar(state, actions, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
internal fun MessageBar(state: AppState, actions: UiActions, modifier: Modifier = Modifier) {
    val c = LocalTrainColors.current
    val accessibilityManager = LocalAccessibilityManager.current
    state.message?.takeIf { state.ready }?.let { message ->
        LaunchedEffect(message, state.messageAutoDismiss, accessibilityManager) {
            if (state.messageAutoDismiss) {
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
        Row(modifier.fillMaxWidth().testTag("message-bar").background(c.ink)
            .heightIn(min = 52.dp).clickable(role = Role.Button, onClick = if (state.undoAvailable) actions::undoDelete else actions::dismissMessage)
            .padding(horizontal = PagePadding, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), color = c.ground, fontSize = 14.sp, fontWeight = FontWeight.Normal,
                maxLines = if (state.undoAvailable) 2 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(12.dp))
            Label(if (state.undoAvailable) "Undo" else "Dismiss", color = c.ground)
        }
    }
}
