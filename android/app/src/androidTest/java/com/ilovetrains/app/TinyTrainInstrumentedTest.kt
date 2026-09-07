package com.ilovetrains.app

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class TinyTrainInstrumentedTest {
    @get:Rule val compose = createComposeRule()

    @Test fun repeatedTapsDoNotRestartAndFlagOffRemovesTheAction() {
        val enabled = mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalTinyTrainFlag provides enabled.value) {
                TinyTrainLane(Modifier.width(346.dp))
            }
        }
        val button = compose.onNodeWithContentDescription("Run a tiny train")
        button.assertExists()
        compose.mainClock.autoAdvance = false
        button.performClick()
        compose.mainClock.advanceTimeBy(1400)
        button.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Running"))
        repeat(8) { button.performClick() }
        compose.mainClock.advanceTimeBy(1400)
        button.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Ready"))
        button.performClick()
        compose.runOnIdle { enabled.value = false }
        compose.mainClock.advanceTimeBy(100)
        button.assertDoesNotExist()
    }

    @Test fun trainKeepsTheTripLineAndSurroundingLayoutFixed() {
        val showToy = mutableStateOf(false)
        val from = Station("a", "A"); val to = Station("b", "B")
        val journey = Journey(listOf(Leg("T1", "train", "B", from, to, 1000, 2000)))
        compose.setContent {
            CompositionLocalProvider(LocalTinyTrainFlag provides true) {
                Column {
                    Spacer(Modifier.height(24.dp))
                    JourneyAxis(journey, Modifier.width(346.dp).testTag("axis"), large = true, tinyTrain = showToy.value)
                    Spacer(Modifier.height(20.dp).width(346.dp).testTag("below"))
                }
            }
        }
        val axis = compose.onNodeWithTag("axis").fetchSemanticsNode().boundsInRoot
        val below = compose.onNodeWithTag("below").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { showToy.value = true }
        val button = compose.onNodeWithContentDescription("Run a tiny train")
        button.assertExists()
        val target = button.fetchSemanticsNode().boundsInRoot
        val density = target.height / 44f
        assertEquals(axis.top + 5f * density, target.top + 18f * density, .5f)
        button.performClick()
        assertEquals(axis, compose.onNodeWithTag("axis").fetchSemanticsNode().boundsInRoot)
        assertEquals(below, compose.onNodeWithTag("below").fetchSemanticsNode().boundsInRoot)
    }

}
