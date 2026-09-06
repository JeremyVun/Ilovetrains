package com.ilovetrains.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme

@Immutable
data class TrainColors(
    val ground: Color,
    val ink: Color,
    val ink2: Color,
    val ink3: Color,
    val rule: Color,
    val rule2: Color,
    val warning: Color,
    val live: Color,
    val dark: Boolean,
)

private val DarkColors = TrainColors(
    ground = Color(0xFF0A0B0D), ink = Color(0xFFF4F5F7), ink2 = Color(0xFFF4F5F7).copy(alpha = .66f),
    ink3 = Color(0xFFF4F5F7).copy(alpha = .46f), rule = Color(0xFFF4F5F7).copy(alpha = .10f),
    rule2 = Color(0xFFF4F5F7).copy(alpha = .20f),
    warning = Color(0xFFFF7A5C), live = Color(0xFF4ADE80), dark = true,
)

private val LightColors = TrainColors(
    ground = Color(0xFFFAF9F5), ink = Color(0xFF14120E), ink2 = Color(0xFF14120E).copy(alpha = .75f),
    ink3 = Color(0xFF14120E).copy(alpha = .60f), rule = Color(0xFF14120E).copy(alpha = .11f),
    rule2 = Color(0xFF14120E).copy(alpha = .25f),
    warning = Color(0xFFBF3418), live = Color(0xFF0F7A4A), dark = false,
)

val LocalTrainColors = staticCompositionLocalOf { DarkColors }

private val DarkLineColors = mapOf(
    "T1" to 0xFFF99D1C, "T2" to 0xFF0098CD, "T3" to 0xFFF37021,
    "T4" to 0xFF005AA3, "T5" to 0xFFC4258F, "T7" to 0xFF6F818E,
    "T8" to 0xFF00954C, "T9" to 0xFFD11F2F, "M1" to 0xFF168388,
    "BMT" to 0xFFF99D1C, "CCN" to 0xFFD11F2F, "SCO" to 0xFF0098CD,
    "SHL" to 0xFF00954C, "HUN" to 0xFF833134, "FERRY" to 0xFF5AB031,
)

private val LightLineColors = mapOf(
    "T1" to 0xFFA46204, "T2" to 0xFF0079A3, "T3" to 0xFFBD4D0A,
    "T4" to 0xFF005AA3, "T5" to 0xFFC4258F, "T7" to 0xFF62727E,
    "T8" to 0xFF008041, "T9" to 0xFFD11F2F, "M1" to 0xFF157B7F,
    "BMT" to 0xFFA46204, "CCN" to 0xFFD11F2F, "SCO" to 0xFF0079A3,
    "SHL" to 0xFF008041, "HUN" to 0xFF833134, "FERRY" to 0xFF428024,
)

@Composable
fun TrainTheme(appearance: Appearance, content: @Composable () -> Unit) {
    val dark = when (appearance) {
        Appearance.System -> isSystemInDarkTheme()
        Appearance.Dark -> true
        Appearance.Light -> false
    }
    val colors = if (dark) DarkColors else LightColors
    val material = if (dark) darkColorScheme(
        primary = colors.ink, onPrimary = colors.ground,
        background = colors.ground, onBackground = colors.ink,
        surface = colors.ground, onSurface = colors.ink,
        surfaceVariant = colors.ground, onSurfaceVariant = colors.ink2,
        error = colors.warning, onError = colors.ground,
    ) else lightColorScheme(
        primary = colors.ink, onPrimary = colors.ground,
        background = colors.ground, onBackground = colors.ink,
        surface = colors.ground, onSurface = colors.ink,
        surfaceVariant = colors.ground, onSurfaceVariant = colors.ink2,
        error = colors.warning, onError = colors.ground,
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalTrainColors provides colors) {
        MaterialTheme(colorScheme = material) {
            ProvideTextStyle(
                MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"),
                content,
            )
        }
    }
}

fun lineColor(line: String, mode: String, colors: TrainColors, fill: Boolean = false): Color {
    val key = if (mode.equals("ferry", true)) "FERRY" else line.uppercase()
    if (!colors.dark && fill && (key == "T1" || key == "BMT")) return Color(0xFFF99D1C)
    return Color((if (colors.dark) DarkLineColors else LightLineColors)[key] ?: 0xFF6F818E)
}

fun chipInk(line: String, mode: String, colors: TrainColors): Color {
    if (!colors.dark) return colors.ground
    val key = if (mode.equals("ferry", true)) "FERRY" else line.uppercase()
    return if (key in setOf("T4", "T5", "T9", "CCN", "HUN")) colors.ink else colors.ground
}
