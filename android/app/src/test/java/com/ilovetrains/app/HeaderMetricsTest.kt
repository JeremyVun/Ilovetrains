package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HeaderMetricsTest {
    private val analytics = testAnalytics(debug = true)
    private val metrics = HeaderMetrics(analytics)
    private val none: () -> String? = { null }

    private fun names() = analytics.ledger.map { it.t }
    private fun event(name: String) = analytics.ledger.filter { it.t == name }
    private fun openOnce(kind: HeaderKind? = HeaderKind.Predicted, trip: String = "a", reverse: Boolean = false, lead: () -> String? = none) {
        metrics.resumed()
        metrics.homeShown(kind, trip, reverse, lead)
    }

    @Test fun eachForegroundEntryShowingAnAnswerIsOneOpenBandedAndMilestonedByItsCount() {
        repeat(12) {
            openOnce()
            metrics.homeShown(HeaderKind.Predicted, "a", false, none)
            metrics.backgrounded()
        }
        assertEquals(listOf("1" to "1", "5" to "2-5", "10" to "6-10"), event("opened").map { it.d.getValue("m") to it.d.getValue("u") })
        assertEquals(listOf("1", "2-5", "2-5", "2-5", "2-5", "6-10", "6-10", "6-10", "6-10", "6-10", "11-15", "11-15"),
            event("shown_predicted").map { it.d.getValue("u") })
        assertTrue(analytics.ledger.all { it.d["pl"] == "android" && it.d["pl.u"] == "android." + it.d["u"] })
    }

    @Test fun openedPrecedesTheFirstExposureOfItsOpen() {
        openOnce(HeaderKind.Home)
        assertEquals(listOf("opened", "shown_home"), names())
    }

    @Test fun onlyARealForegroundEntryStartsAnOpen() {
        metrics.homeShown(HeaderKind.Usual, "a", false, none)
        assertTrue("a process started in the background shows no one anything", names().isEmpty())
        openOnce(HeaderKind.Usual)
        metrics.resumed()
        metrics.homeShown(HeaderKind.Usual, "a", false, none)
        metrics.tripTapped("a", false)
        metrics.homeShown(HeaderKind.Usual, "a", false, none)
        assertEquals("a configuration change and a return from the board stay in one open",
            listOf("opened", "shown_usual", "hit_usual"), names())
        metrics.backgrounded()
        metrics.homeShown(HeaderKind.Usual, "a", false, none)
        metrics.resumed()
        assertEquals("an entry that never reaches Home or setup counts nothing", 3, names().size)
        metrics.backgrounded()
        metrics.resumed()
        metrics.setupShown(newVisit = true)
        metrics.backgrounded()
        metrics.resumed()
        metrics.homeShown(null, "a", false, none)
        metrics.backgrounded()
        openOnce(HeaderKind.Usual)
        metrics.backgrounded()
        openOnce(HeaderKind.Usual)
        assertEquals("setup and a browsed trip were the second and third opens", listOf("1", "5"), event("opened").map { it.d["m"] })
        val release = MemoryAnalyticsStore()
        val counted = HeaderMetrics(testAnalytics(store = release))
        repeat(3) { counted.resumed(); counted.homeShown(null, "a", false, none); counted.backgrounded() }
        assertEquals(3, requireNotNull(parseAnalyticsStore(release.text)).opens)
    }

    @Test fun onlyAnImmediateRepeatOfKindTripAndDirectionIsSuppressed() {
        openOnce(HeaderKind.Usual, "a")
        metrics.homeShown(HeaderKind.Usual, "a", false, none)
        metrics.homeShown(HeaderKind.Usual, "b", false, none)
        metrics.homeShown(HeaderKind.Usual, "a", false, none)
        metrics.homeShown(HeaderKind.Usual, "a", true, none)
        metrics.homeShown(HeaderKind.Home, "a", true, none)
        metrics.homeShown(null, "c", false, none)
        metrics.homeShown(HeaderKind.Home, "a", true, none)
        assertEquals(listOf("opened", "shown_usual", "shown_usual", "shown_usual", "shown_usual", "shown_home"), names())
        metrics.backgrounded()
        openOnce(HeaderKind.Home, "a", true)
        assertEquals("a new open exposes the answer again", 2, event("shown_home").size)
    }

    @Test fun onlyTheFirstHomeRowTapOfAnOpenIsClassified() {
        openOnce(HeaderKind.Predicted, "a")
        metrics.tripTapped("b", false)
        metrics.tripTapped("a", false)
        metrics.backgrounded()
        openOnce(HeaderKind.Predicted, "a")
        metrics.tripTapped("a", false)
        metrics.backgrounded()
        openOnce(HeaderKind.Predicted, "a")
        metrics.tripTapped("a", true)
        assertEquals(listOf("miss_predicted", "hit_predicted", "miss_predicted"), names().filter { it.startsWith("hit_") || it.startsWith("miss_") })
    }

    @Test fun setupIsExcludedUntilLeavingItUnsavedRestoresTheAnswer() {
        openOnce(HeaderKind.Home, "a")
        metrics.setupShown(newVisit = true)
        metrics.tripTapped("a", false)
        metrics.pinned("a", false, "k")
        assertEquals(listOf("opened", "shown_home"), names())
        metrics.backgrounded()

        openOnce(HeaderKind.Home, "a") { "k" }
        metrics.setupShown(newVisit = true)
        metrics.homeShown(null, "a", false, none)
        metrics.pinned("a", false, "k")
        assertEquals(listOf("hit_home", "pinned_home"), names().drop(3))
        metrics.backgrounded()

        openOnce(HeaderKind.Home, "a") { "k" }
        metrics.setupShown(newVisit = true)
        metrics.setupSaved()
        metrics.homeShown(null, "a", false, none)
        metrics.pinned("a", false, "k")
        assertEquals("a saved setup keeps the header excluded", listOf("shown_home"), names().drop(5).filter { it != "opened" })
    }

    @Test fun aPinComparesWithTheLastRenderedLeadAndGivesEachResult() {
        openOnce(HeaderKind.Usual, "a") { "first" }
        metrics.homeShown(HeaderKind.Usual, "a", false) { "lead" }
        metrics.pinned("a", false, "lead")
        metrics.homeShown(HeaderKind.Usual, "a", false) { "lead" }
        metrics.pinned("a", false, "later")
        metrics.homeShown(HeaderKind.Usual, "a", false) { "lead" }
        metrics.pinned("b", false, "lead")
        metrics.homeShown(HeaderKind.Usual, "a", false) { "lead" }
        metrics.pinned("a", true, "lead")
        val pins = analytics.ledger.filter { it.t.startsWith("hit_") || it.t.startsWith("pinned_") }
        assertEquals(listOf("hit_usual", "pinned_usual", "hit_usual", "pinned_usual", "pinned_usual", "pinned_usual"), pins.map { it.t })
        assertEquals(listOf("same", "service", "trip", "trip"), pins.mapNotNull { it.d["r"] })
        assertEquals(listOf("android.same", "android.service", "android.trip", "android.trip"), pins.mapNotNull { it.d["pl.r"] })
        assertTrue(pins.filter { it.t == "hit_usual" }.all { it.d.keys == setOf("u", "pl", "pl.u") })
    }

    @Test fun aSameTripPinWithNoDisplayedLeadCountsTheHitOnly() {
        openOnce(HeaderKind.Focus, "a", lead = none)
        metrics.pinned("a", false, "k")
        metrics.homeShown(HeaderKind.Focus, "a", false, none)
        metrics.pinned("b", false, "k")
        assertEquals(listOf("opened", "shown_focus", "hit_focus", "pinned_focus"), names())
        assertEquals("trip", event("pinned_focus").single().d["r"])
    }

    @Test fun eachPinActionEmitsAtMostOnceAndNeedsThisOpensAnswer() {
        metrics.resumed()
        metrics.pinned("a", false, "k")
        metrics.homeShown(HeaderKind.Inferred, "a", false) { "k" }
        metrics.pinned("a", false, "k")
        metrics.pinned("a", false, "k")
        metrics.homeShown(HeaderKind.Inferred, "a", false) { "k" }
        metrics.released()
        metrics.pinned("a", false, "k")
        metrics.homeShown(HeaderKind.Inferred, "a", false) { "k" }
        metrics.backgrounded()
        metrics.resumed()
        metrics.pinned("a", false, "k")
        assertEquals(listOf("opened", "shown_inferred", "hit_inferred", "pinned_inferred"), names())
    }

    @Test fun ridesCountByHowTravelStartedAndHowArrivalWasDecided() {
        metrics.rode(pinned = true, basis = ArrivalBasis.Location)
        metrics.rode(pinned = false, basis = ArrivalBasis.Estimate)
        assertEquals(listOf(
            AnalyticsEvent("rode_pin", mapOf("u" to "1", "pl" to "android", "pl.u" to "android.1", "b" to "location", "pl.b" to "android.location")),
            AnalyticsEvent("rode_auto", mapOf("u" to "1", "pl" to "android", "pl.u" to "android.1", "b" to "estimate", "pl.b" to "android.estimate")),
        ), analytics.ledger)
    }
}
