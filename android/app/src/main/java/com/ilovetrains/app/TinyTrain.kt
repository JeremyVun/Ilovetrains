package com.ilovetrains.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.*

internal val LocalTinyTrainFlag = staticCompositionLocalOf { false }

@Composable
internal fun TinyTrainLane(modifier: Modifier = Modifier, flag: Boolean = LocalTinyTrainFlag.current) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val colors = LocalTrainColors.current
    var paused by remember { mutableStateOf(true) }
    var running by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var reduced by remember { mutableStateOf(false) }
    val enabled = flag && !paused
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            paused = event != Lifecycle.Event.ON_RESUME
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(enabled) { if (!enabled) running = false }
    LaunchedEffect(running) {
        if (!running) return@LaunchedEffect
        try {
            val scale = coroutineContext[MotionDurationScale]
            reduced = (scale?.scaleFactor ?: 1f) == 0f
            if (!reduced) {
                val start = withFrameNanos { it }
                while (progress < 1f) {
                    if ((scale?.scaleFactor ?: 1f) == 0f) { reduced = true; break }
                    withFrameNanos { progress = ((it - start) / 2_600_000_000f).coerceAtMost(1f) }
                }
            }
            if (reduced) delay(650)
        } finally { running = false }
    }
    val interaction = remember { MutableInteractionSource() }
    Canvas(modifier.height(44.dp).then(if (enabled) Modifier
        .semantics { contentDescription = "Run a tiny train"; stateDescription = if (running) "Running" else "Ready" }
        .clickable(interactionSource = interaction, indication = null, role = Role.Button) {
            if (!running) { progress = 0f; running = true }
        } else Modifier)) {
        if (!running || !enabled) return@Canvas
        val unit = 1.dp.toPx()
        val logicalWidth = 327f
        val fitScale = minOf(1f, size.width / (logicalWidth * unit))
        val trainWidth = logicalWidth * unit * fitScale
        val left = if (reduced) (size.width - trainWidth) / 2 else
            -trainWidth - 4 * unit + progress * (size.width + trainWidth + 8 * unit)
        val body = if (colors.dark) Color(0xFFB6BAB8) else Color(0xFF9DA3A1)
        val window = if (colors.dark) Color(0xFF4A3328) else Color(0xFF3B2A22)
        clipRect(0f, 0f, size.width, 18 * unit) {
            repeat(8) { car ->
                withTransform({
                    translate(left + car * 41 * unit * fitScale, 0f)
                    scale(fitScale, fitScale, Offset.Zero)
                    if (car == 0) scale(-1f, 1f, Offset(20 * unit, 0f))
                }) {
                    fun rect(x: Float, y: Float, w: Float, h: Float, color: Color) =
                        drawRect(color, Offset(x * unit, y * unit), Size(w * unit, h * unit))
                    val lead = car == 0 || car == 7
                    val shape = Path().apply {
                        moveTo(unit, 3 * unit); lineTo((if (lead) 33 else 39) * unit, 3 * unit)
                        if (lead) lineTo(39 * unit, 7 * unit)
                        lineTo(39 * unit, 15 * unit); lineTo(unit, 15 * unit); close()
                    }
                    drawPath(shape, body)
                    for (x in listOf(6f, 28f)) {
                        rect(x, 4f, 5f, 11f, if (colors.dark) Color(0xFFF9B928) else Color(0xFFE4A20C))
                        drawLine(body.copy(alpha = .7f), Offset((x + 2.5f) * unit, 4 * unit), Offset((x + 2.5f) * unit, 15 * unit), .6f * unit)
                        rect(x + .5f, 5f, 1.5f, 3f, window)
                        rect(x + 3f, 5f, 1.5f, 3f, window)
                    }
                    for (y in listOf(5f, 9f)) for (x in listOf(12.5f, 16.5f, 20.5f, 24.5f)) rect(x, y, 2.5f, 2f, window)
                    if (lead) {
                        val nose = Path().apply {
                            moveTo(33 * unit, 3 * unit); lineTo(39 * unit, 7 * unit)
                            lineTo(39 * unit, 15 * unit); lineTo(33 * unit, 15 * unit); close()
                        }
                        drawPath(nose, if (colors.dark) Color(0xFFF9B928) else Color(0xFFE4A20C))
                        rect(34f, 5f, 3f, 4f, window)
                        rect(37f, 12f, 1f, 1f, if (colors.dark) Color(0xFFFFF1AE) else Color(0xFFFFF3B3))
                    }
                    for (x in listOf(8f, 32f)) drawCircle(Color(0xFF201C1A), 1.5f * unit, Offset(x * unit, 16 * unit))
                }
            }
        }
    }
}
