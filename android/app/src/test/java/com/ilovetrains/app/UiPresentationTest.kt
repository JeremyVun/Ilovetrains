package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class UiPresentationTest {
    private val a = Station("a", "Alpha Station", -33.87, 151.20)
    private val b = Station("b", "Beta Station", -33.86, 151.21)
    private val c = Station("c", "Gamma Station", -33.85, 151.22)
    private val d = Station("d", "Delta Station", -33.84, 151.23)

    @Test fun boardingGrammarKeepsNamedAndSideOnlyWharvesWithoutRepeatingThePlace() {
        assertEquals("Balmain Wharf", platformText("Balmain Wharf", "ferry", full = true))
        assertEquals("Side A", platformText("Side A", "ferry", full = true))
        assertEquals("A", platformText("Side A", "ferry"))
        assertEquals("4B", platformText("Wharf 4, Side B", "ferry"))
        assertEquals("Wharf 4, Side B", departureCapText("Wharf 4, Side B", "ferry"))
        assertEquals("Wharf", departureCapText("Pyrmont Bay Wharf", "ferry"))
        assertEquals("Platform 5", platformText("5", "train", full = true))
    }

    @Test fun focusStatusUsesTheActiveLegAndOneMeaningForHeaderAndSavedRow() {
        val now = 1_000_000L
        val first = Leg("T1", "train", "Beta", a, b, now - 600_000, now - 60_000)
        val second = Leg("T2", "train", "Gamma", b, c, now + 60_000, now + 600_000,
            estimatedDeparture = now + 180_000)
        val journey = Journey(listOf(first, second))
        val live = BoardData(a, c, listOf(journey), now, source = "live")
        val focus = FocusedJourney("trip", false, journey, live)

        assertEquals("Running late", focusStatus(focus, now, complete = false).text)
        assertEquals("Running late · Pinned", savedTripFocusStatus(focus, now, complete = false))
        val degraded = focus.copy(board = live.copy(serverStale = true))
        assertEquals("Running late", focusStatus(degraded, now, false).text)
        assertEquals("Running late · Pinned", savedTripFocusStatus(degraded, now, false))
        for (unavailable in listOf(live.copy(offline = true), live.copy(source = "schedule"), live.copy(generatedAt = now - 90_001))) {
            assertEquals("Running", focusStatus(focus.copy(board = unavailable), now, false).text)
        }
        assertEquals("Running", focusStatus(focus.copy(journey = journey.copy(retained = true)), now, false).text)
        assertEquals("Cancelled", focusStatus(focus.copy(journey = journey.copy(legs = listOf(first.copy(cancelled = true), second))), now, false).text)
        assertEquals("Trip over", focusStatus(focus, now, complete = true).text)
        assertEquals("Pinned", savedTripFocusStatus(focus.copy(journey = Journey(listOf(second.copy(estimatedDeparture = null)))), now, false))
    }

    @Test fun figureWidthUsesTheRenderedTokenAndNextUsesSharedRoundingAcrossSourceStates() {
        assertTrue(wideFigure(Figure("Now")))
        assertFalse(wideFigure(Figure("2", "H")))
        assertTrue(wideFigure(Figure("10", "H")))
        assertFalse(wideFigure(Figure("99", "min")))
        assertTrue(wideFigure(Figure("100", "min")))

        val now = 6_000_000L
        val journey = Journey(listOf(Leg("T1", "train", "Beta", a, b,
            now + 119 * 60_000, now + 149 * 60_000)))
        val board = BoardData(a, b, listOf(journey), now, source = "live")
        assertEquals("2H", nextServiceFigure(journey, board, now))
        val minutes = Journey(listOf(journey.legs.single().copy(departure = now + 3 * 60_000)))
        assertEquals("3 min", nextServiceFigure(minutes, board.copy(journeys = listOf(minutes)), now))
        assertEquals("2H", nextServiceFigure(journey, board.copy(serverStale = true), now))
        assertEquals("2H", nextServiceFigure(journey, board.copy(generatedAt = now - 90_001), now))
        assertEquals("2H", nextServiceFigure(journey, board.copy(offline = true), now))
        assertEquals("2H", nextServiceFigure(journey.copy(retained = true), board, now))
    }

    @Test fun shownLeadEvidenceKeepsTheExactObservationAndItsSource() {
        val now = 6_000_000L
        val scheduled = Journey(listOf(Leg("T1", "train", "Beta", a, b, now + 60_000, now + 300_000)))
        val mergedLead = Journey(listOf(scheduled.legs.single().copy(estimatedDeparture = now + 120_000)))
        val final = BoardData(a, b, listOf(mergedLead), now, source = "live")
        val observed = BoardData(a, b, listOf(scheduled), now, source = "live")

        assertNull(shownLeadEvidence(final, listOf(observed), now, suppressed = false))
        val matching = observed.copy(journeys = listOf(mergedLead), generatedAt = now - 1000)
        val evidence = shownLeadEvidence(final, listOf(matching), now, suppressed = false)
        assertSame(matching, evidence?.board)
        assertSame(mergedLead, evidence?.journey)
        assertNull(shownLeadEvidence(final, listOf(observed.copy(offline = true)), now, suppressed = false))
        assertNull(shownLeadEvidence(final.copy(journeys = listOf(mergedLead.copy(retained = true))), listOf(observed), now, suppressed = false))
        assertNull(shownLeadEvidence(final, listOf(observed), now, suppressed = true))

        val outside = Journey(listOf(scheduled.legs.single().copy(line = "T2", departure = now + 180_000,
            arrival = now + 240_000)))
        val outsideSource = final.copy(journeys = listOf(outside), generatedAt = now)
        val withRecommendation = final.copy(recommendation = RecommendationResult(outside, outsideSource))
        assertSame(outside, shownLeadEvidence(withRecommendation, listOf(outsideSource), now, false)?.journey)
        val earlier = scheduled.copy(legs = scheduled.legs.map { it.copy(line = "T3") })
        val earlierSource = final.copy(journeys = listOf(earlier), generatedAt = now - 30_000)
        val pages = withRecommendation.copy(recommendationPages = listOf(RecommendationPage(now, earlierSource, false, TransferConstraint(null))))
        assertSame(earlierSource, boardForOpenedJourney(null, pages, null, earlier))
    }

    @Test fun homeVotesAreLimitedToTheHomeScreen() {
        assertTrue(shouldCastHomeVote(Screen.Home, hasTrips = true, station = a, alreadyVoted = false))
        assertFalse(shouldCastHomeVote(Screen.Setup, hasTrips = true, station = a, alreadyVoted = false))
        assertFalse(shouldCastHomeVote(Screen.Home, hasTrips = false, station = a, alreadyVoted = false))
        assertFalse(shouldCastHomeVote(Screen.Home, hasTrips = true, station = a, alreadyVoted = true))
    }

    @Test fun modesRedirectDistanceSearchAndNearestFollowSharedRules() {
        val first = Journey(listOf(Leg("T1", "train", "Beta", a, b, 100, 200)))
        val redirected = Journey(listOf(Leg("T1", "train", "Delta", a, d, 100, 500)))
        val changed = Journey(listOf(Leg("T1", "train", "Delta", a, d, 101, 500)))
        val mixed = Journey(listOf(first.legs.single(), Leg("F1", "ferry", "Gamma", b, c, 300, 400)))
        assertTrue(sameDeparture(first, redirected))
        assertFalse(sameDeparture(first, changed))
        assertTrue(journeyAllowed(mixed, setOf("train", "ferry")))
        assertFalse(journeyAllowed(mixed, setOf("train")))
        assertEquals("10 m", distanceText(1))
        assertEquals("1.0 km", distanceText(1_049))
        assertEquals("11 km", distanceText(10_600))
        assertTrue(stationFuzzyScore("Town Hall", "twh") > 0)

        val fix = Fix(a.lat, a.lon, 0)
        val ferryOnly = a.copy(id = "wharf", modes = setOf("ferry"))
        assertEquals(ferryOnly, nearestStation(listOf(c, ferryOnly), fix))
    }

    @Test fun redirectUsesTheSavedDirectionalOriginAndFocusedRowsKeepTheirOwnBoard() {
        val printed = Journey(listOf(Leg("T1", "train", "Delta", a.copy(lat = 0.0, lon = 0.0), d, 100, 500)))
        val focusedBoard = BoardData(a, d, listOf(printed), 100, source = "live")
        val alternative = Journey(listOf(printed.legs.single().copy(line = "T2", departure = 200)))
        val alternatives = focusedBoard.copy(journeys = listOf(printed, alternative), source = "schedule")
        val focus = FocusedJourney("trip", false, printed, focusedBoard, alternatives = alternatives)
        val saved = SavedTrip("trip", a, d)

        assertSame(a, redirectOrigin(focus, listOf(saved)))
        assertSame(d, redirectOrigin(focus.copy(reverse = true), listOf(saved)))
        assertSame(focusedBoard, boardForOpenedJourney(focus, focusedBoard, null, printed))
        assertSame(alternatives, boardForOpenedJourney(focus, focusedBoard, null, alternative))
        val recommendationSource = focusedBoard.copy(journeys = listOf(alternative), generatedAt = 300)
        val recommendingBoard = focusedBoard.copy(recommendation = RecommendationResult(alternative, recommendationSource))
        assertSame(recommendationSource, boardForOpenedJourney(null, recommendingBoard, null, alternative))
    }

    @Test fun failedFocusedRefreshKeepsLastKnownAgeAndAttachesIndependentAlternatives() {
        val now = 6_000_000L
        val journey = Journey(listOf(Leg("T1", "train", "Beta", a, b, now, now + 300_000)))
        val board = BoardData(a, b, listOf(journey), now - 60_000, source = "live")
        val alternatives = BoardData(a, b, listOf(journey.copy(retained = false)), now, source = "schedule")
        val focus = FocusedJourney("trip", false, journey, board)

        val result = focusAfterRefresh(focus, FocusedRefresh(journey, observedAt = null, live = false), alternatives)

        assertTrue(result.journey.retained)
        assertEquals(now - 60_000, result.board.generatedAt)
        assertTrue(result.board.offline)
        assertSame(alternatives, result.alternatives)
    }

    @Test fun earlierMergePreservesCurrentObservations() {
        val scheduled = Journey(listOf(Leg("T1", "train", "Beta", a, b, 100, 200)))
        val observed = Journey(listOf(scheduled.legs.single().copy(estimatedDeparture = 130, cancelled = true)))
        val old = Journey(listOf(Leg("T2", "train", "Beta", a, b, 10, 90)))
        val merged = mergeEarlier(listOf(observed), listOf(old, scheduled))
        assertEquals(listOf(old.key, observed.key), merged.map { it.key })
        assertEquals(observed, merged.last())
    }

    @Test fun axisAssociatesEachStationWithItsDwellStacksCollisionsAndSuppressesTheSecondAlightPin() {
        val journey = Journey(listOf(
            Leg("T1", "train", "Beta", a, b, 0, 20, fromPlatform = "1", toPlatform = "2"),
            Leg("T2", "train", "Gamma", b, c, 40, 60, fromPlatform = "3", toPlatform = "4"),
            Leg("T3", "train", "Delta", c, d, 80, 100, fromPlatform = "5", toPlatform = "6"),
        ))
        assertTrue(showAlightingPin(3, 0))
        assertFalse(showAlightingPin(3, 1))
        assertTrue(isTightChange(journey.copy(legs = listOf(journey.legs[0], journey.legs[1].copy(departure = 24))), 0))
        assertFalse(isTightChange(journey.copy(legs = listOf(journey.legs[0].copy(cancelled = true), journey.legs[1].copy(departure = 24))), 0))

        val elements = listOf(
            AxisElement.Cap,
            AxisElement.Ride(0), AxisElement.Dwell(0), AxisElement.Ride(1), AxisElement.Dwell(1), AxisElement.Ride(2),
            AxisElement.Alight(0), AxisElement.Board(0), AxisElement.Board(1),
            AxisElement.StationLabel(0), AxisElement.StationLabel(1),
        )
        val sizes = elements.map {
            when (it) {
                AxisElement.Cap -> AxisSize(10, 22)
                is AxisElement.Alight, is AxisElement.Board -> AxisSize(22, 22)
                is AxisElement.StationLabel -> AxisSize(70, 12)
                else -> AxisSize(0, 0)
            }
        }
        val (frames, height) = journeyAxisFrames(journey, 100, elements, sizes, 7, 22, 22, 3, 4, 6, 3, null)
        val firstLabel = frames[elements.indexOf(AxisElement.StationLabel(0))]
        val secondLabel = frames[elements.indexOf(AxisElement.StationLabel(1))]
        val flushFrames = journeyAxisFrames(journey, 300, elements, sizes, 7, 22, 22, 3, 4, 6, 3, null).first
        val firstRide = flushFrames[elements.indexOf(AxisElement.Ride(0))]
        val firstAlight = flushFrames[elements.indexOf(AxisElement.Alight(0))]
        val firstDwell = flushFrames[elements.indexOf(AxisElement.Dwell(0))]
        val firstBoard = flushFrames[elements.indexOf(AxisElement.Board(0))]
        assertEquals(firstAlight.x + firstAlight.width - 3, firstRide.x + firstRide.width)
        assertEquals(firstDwell.x + firstDwell.width, firstBoard.x)
        assertTrue(firstRide.x + firstRide.width > firstAlight.x)
        assertTrue(flushFrames[elements.indexOf(AxisElement.Ride(1))].x < firstBoard.x + firstBoard.width)

        val crowdedFrames = journeyAxisFrames(journey, 50, elements, sizes, 7, 22, 22, 3, 4, 6, 3, null).first
        val crowdedDwell = crowdedFrames[elements.indexOf(AxisElement.Dwell(0))]
        val crowdedBoard = crowdedFrames[elements.indexOf(AxisElement.Board(0))]
        val crowdedOnwardRide = crowdedFrames[elements.indexOf(AxisElement.Ride(1))]
        assertTrue(crowdedBoard.y > 0)
        assertEquals(crowdedDwell.x + crowdedDwell.width, crowdedOnwardRide.x)
        assertNotEquals(firstLabel.x, secondLabel.x)
        assertTrue(secondLabel.y >= firstLabel.y + firstLabel.height + 6)
        assertTrue(height >= secondLabel.y + secondLabel.height)
        frames.forEach { assertTrue(it.x >= 0 && it.x + it.width <= 100) }
    }
}
