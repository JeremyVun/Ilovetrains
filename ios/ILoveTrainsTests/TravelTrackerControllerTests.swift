import ActivityKit
import Foundation
import XCTest
@testable import ILoveTrains

final class TravelTrackerControllerTests: XCTestCase {
    func testAutomaticInferenceAndPinBothStartTracking() async {
        let now = 1_800_000_000_000.0
        let inferred = trackerFocus(id: "inferred", now: now, pinned: false)
        let inferredDriver = TrackerDriver()
        let inferredController = TravelTrackerController(store: TrackerStore(), driver: inferredDriver)

        await inferredController.reconcile(focus: inferred, visibleFocus: inferred, now: now, recordedComplete: false)
        await inferredController.awaitPublications()
        XCTAssertEqual(inferredDriver.current.count, 1)

        let pinned = trackerFocus(id: "pinned", now: now, pinned: true)
        let pinnedDriver = TrackerDriver()
        let pinnedController = TravelTrackerController(store: TrackerStore(), driver: pinnedDriver)
        await pinnedController.reconcile(focus: pinned, visibleFocus: pinned, now: now, recordedComplete: false)
        await pinnedController.awaitPublications()
        XCTAssertEqual(pinnedDriver.current.single?.attributes.focus.tripId, "pinned")
    }

    func testPinReplacementDuringActiveSessionReplacesActivity() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver)
        let inferred = trackerFocus(id: "first", now: now, pinned: false)
        await controller.reconcile(focus: inferred, visibleFocus: inferred, now: now, recordedComplete: false)
        await controller.awaitPublications()
        let oldId = try! XCTUnwrap(driver.current.first?.id)

        let replacement = trackerFocus(id: "replacement", now: now, pinned: true)
        await controller.reconcile(focus: replacement, visibleFocus: replacement, now: now, recordedComplete: false)
        await controller.awaitPublications()

        XCTAssertEqual(driver.ended, [oldId])
        XCTAssertEqual(driver.current.single?.attributes.focus.tripId, "replacement")
        let session = await controller.snapshot()
        XCTAssertEqual(session.generation, 2)
    }

    func testHiddenFocusEndsSurfaceButRetainsSessionAndCanReturn() async {
        let now = 1_800_000_000_000.0
        let focus = trackerFocus(id: "hidden", now: now, pinned: false)
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()

        await controller.reconcile(focus: focus, visibleFocus: nil, now: now, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertTrue(driver.current.isEmpty)
        let hiddenSession = await controller.snapshot()
        XCTAssertEqual(hiddenSession.active?.identity, focus.trackerIdentity)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertEqual(driver.current.count, 1)
        let restoredSession = await controller.snapshot()
        XCTAssertEqual(restoredSession.generation, 1)
    }

    func testDismissalSuppressesOnlyExactIdentityAcrossRelaunch() async {
        let now = 1_800_000_000_000.0
        let focus = trackerFocus(id: "dismissed", now: now, pinned: false)
        let store = TrackerStore()
        let driver = TrackerDriver()
        var controller = TravelTrackerController(store: store, driver: driver)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()
        let id = try! XCTUnwrap(driver.current.single?.id)
        driver.emit(.dismissed, id: id)
        await waitFor { await controller.snapshot().suppression == .dismissed }

        controller = TravelTrackerController(store: store, driver: driver)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertTrue(driver.current.isEmpty)

        let next = trackerFocus(id: "next", now: now, pinned: false)
        await controller.reconcile(focus: next, visibleFocus: next, now: now, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertEqual(driver.current.single?.attributes.focus.tripId, "next")
    }

    func testCompletionEndsWithoutChangingFocusedJourney() async {
        let now = 1_800_000_000_000.0
        let focus = trackerFocus(id: "complete", now: now, pinned: false)
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: true)
        await controller.awaitPublications()
        let session = await controller.snapshot()
        XCTAssertNil(session.active)
        XCTAssertEqual(session.suppressedIdentity, focus.trackerIdentity)
        XCTAssertEqual(session.suppression, .completed)
        XCTAssertEqual(focus.tripId, "complete")
        XCTAssertTrue(driver.current.isEmpty)
    }

    func testCompletedSessionResumesAfterArrivalMovesFutureAndDeepLinkIsValid() async {
        let now = 1_800_000_000_000.0
        let focus = trackerFocus(id: "late", now: now, pinned: false)
        let stored = TravelTrackerSession(
            active: nil,
            generation: 4,
            suppressedIdentity: focus.trackerIdentity,
            suppression: .completed
        )
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(stored), driver: driver)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()
        let activity = try! XCTUnwrap(driver.current.single)
        let session = await controller.snapshot()
        let opened = await controller.focusIdentity(for: activity.attributes.deepLinkURL)
        XCTAssertEqual(session.generation, 5)
        XCTAssertEqual(opened, focus.trackerIdentity)
    }

    func testLateRequestCannotResurrectReplacedSession() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver(requestDelay: .milliseconds(80))
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver)
        let first = trackerFocus(id: "first", now: now, pinned: false)
        await controller.reconcile(focus: first, visibleFocus: first, now: now, recordedComplete: false)
        try? await Task.sleep(for: .milliseconds(20))

        let replacement = trackerFocus(id: "replacement", now: now, pinned: true)
        await controller.reconcile(focus: replacement, visibleFocus: replacement, now: now, recordedComplete: false)
        await controller.awaitPublications()

        XCTAssertEqual(driver.current.single?.attributes.focus.tripId, "replacement")
        XCTAssertEqual(driver.ended.count, 1, "The request which completed after replacement must be ended")
    }

    func testOneSecondTickDoesNotPublishUntilAJourneyFactChanges() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver)
        var focus = trackerFocus(id: "dedupe", now: now, pinned: false)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 1_000, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertEqual(driver.updateCount, 0, "OS-owned timer and progress changes must not cause a 1 Hz ActivityKit write")

        focus.journey.legs[0].toPlatform = "22"
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 2_000, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertEqual(driver.updateCount, 1, "A platform change is a meaningful tracker update")
    }

    func testMapperKeepsRequiredFactsAndPayloadUnderActivityKitLimit() throws {
        let now = 1_800_000_000_000.0
        let focus = trackerFocus(id: String(repeating: "long-trip-", count: 8), now: now, pinned: false, legCount: 5)
        let state = try XCTUnwrap(TravelTrackerState.derive(focus: focus, now: now, generation: 99))
        let active = TravelTrackerSession.Active(
            identity: focus.trackerIdentity,
            generation: 99,
            sessionId: UUID(uuidString: "00000000-0000-0000-0000-000000000099")!,
            activityId: nil
        )
        let attributes = TravelTrackerActivityContentMapper.attributes(active: active)
        let content = TravelTrackerActivityContentMapper.contentState(state: state, focus: focus, now: now)
        struct Envelope: Encodable {
            var attributes: TravelTrackerActivityAttributes
            var content: TravelTrackerActivityAttributes.ContentState
        }
        let bytes = try JSONEncoder().encode(Envelope(attributes: attributes, content: content))

        XCTAssertLessThanOrEqual(bytes.count, 4_096, "ActivityKit attributes and content must fit its 4 KB payload limit")
        XCTAssertFalse(content.instruction.isEmpty)
        XCTAssertFalse(content.platforms.isEmpty)
        XCTAssertEqual(content.segments.count, 9)
        XCTAssertEqual(content.staleDate, min(content.nextBoundary, Date(timeIntervalSince1970: focus.board.generatedAt / 1_000 + 90)))
    }

    func testLastLegCuesTwoMinutesBeforeArrivalAndNotAtItsDeparture() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let focus = trackerFocus(id: "get-off", now: now, pinned: false)
        let lastLeg = focus.journey.legs[1]

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: lastLeg.effectiveDeparture + 1_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty, "Departing on the last leg is a departure, which never cues")

        await controller.reconcile(focus: focus, visibleFocus: focus, now: lastLeg.effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Get off soon"])
        XCTAssertEqual(driver.alerts.first?.body, "Get off at \(lastLeg.to.shortName) in about 2 minutes.")
        XCTAssertEqual(haptics.impacts, 0)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: lastLeg.effectiveArrival - 30_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.count, 1, "The get-off cue fires once for the leg")
    }

    func testSingleLegJourneyDoesNotCueWhenItDeparts() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let focus = trackerFocus(id: "single", now: now, pinned: false, legCount: 1)
        let leg = focus.journey.legs[0]

        await controller.reconcile(focus: focus, visibleFocus: focus, now: leg.effectiveDeparture - 60_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        await controller.reconcile(focus: focus, visibleFocus: focus, now: leg.effectiveDeparture + 1_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty, "Boarding into the only leg is a departure")
        XCTAssertEqual(haptics.impacts, 0)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: leg.effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Get off soon"])
    }

    func testRideLegCuesAtItsLeadAndEnteringTransferDoesNot() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let focus = trackerFocus(id: "change", now: now, pinned: false)
        let riding = focus.journey.legs[0]

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        await controller.reconcile(focus: focus, visibleFocus: focus, now: riding.effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Change services soon"])
        XCTAssertEqual(
            driver.alerts.first?.body,
            "Get off at \(riding.to.shortName) in about 2 minutes to change to \(focus.journey.legs[1].line)."
        )

        await controller.reconcile(focus: focus, visibleFocus: focus, now: riding.effectiveArrival + 60_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.count, 1, "Entering the transfer stage is not a cue")
    }

    func testForegroundCueVibratesInsteadOfAlerting() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let focus = trackerFocus(id: "foreground", now: now, pinned: false)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()
        await controller.reconcile(focus: focus, visibleFocus: focus,
                                   now: focus.journey.legs[0].effectiveArrival - trackerAlertLead,
                                   recordedComplete: false)
        await controller.awaitPublications()

        XCTAssertEqual(haptics.impacts, 1)
        XCTAssertTrue(driver.alerts.isEmpty)
    }

    func testCueVibratesOnScreenWithNoLiveActivity() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        driver.activitiesEnabled = false
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let focus = trackerFocus(id: "no-surface", now: now, pinned: false)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertTrue(driver.current.isEmpty)
        XCTAssertEqual(haptics.impacts, 0)

        await controller.reconcile(focus: focus, visibleFocus: focus,
                                   now: focus.journey.legs[0].effectiveArrival - trackerAlertLead,
                                   recordedComplete: false)
        await controller.awaitPublications()
        XCTAssertEqual(haptics.impacts, 1, "An on-screen cue does not depend on a tracker surface")
        XCTAssertTrue(driver.alerts.isEmpty)
    }

    func testRestoreInsideALeadDoesNotCueButLaterLegsStillDo() async {
        let now = 1_800_000_000_000.0
        let store = TrackerStore()
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let focus = trackerFocus(id: "restored", now: now, pinned: false)
        var controller = TravelTrackerController(store: store, driver: driver, haptics: haptics)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        controller = TravelTrackerController(store: store, driver: driver, haptics: haptics)
        await controller.reconcile(focus: focus, visibleFocus: focus,
                                   now: focus.journey.legs[0].effectiveArrival - 60_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty, "A first observation already past a lead only records the baseline")

        await controller.reconcile(focus: focus, visibleFocus: focus,
                                   now: focus.journey.legs[1].effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Get off soon"])
    }

    func testArrivalMovingLaterAfterACueDoesNotCueAgain() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        var focus = trackerFocus(id: "delayed", now: now, pinned: false)
        let arrival = focus.journey.legs[0].effectiveArrival

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()
        await controller.reconcile(focus: focus, visibleFocus: focus, now: arrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.count, 1)

        focus.journey.legs[0].estimatedArrival = arrival + 600_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: arrival - 60_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        await controller.reconcile(focus: focus, visibleFocus: focus, now: arrival + 600_000 - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Change services soon", "Connection missed"],
                       "A later estimate does not repeat the leg's cue, and losing the connection is its own cue")
    }

    func testReplacedIdentityStartsANewGenerationWithoutCueing() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let first = trackerFocus(id: "first", now: now, pinned: false)
        await controller.reconcile(focus: first, visibleFocus: first, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        let replacement = trackerFocus(id: "replacement", now: now, pinned: false)
        await controller.reconcile(focus: replacement, visibleFocus: replacement,
                                   now: replacement.journey.legs[0].effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()

        let session = await controller.snapshot()
        XCTAssertEqual(session.generation, 2)
        XCTAssertTrue(driver.alerts.isEmpty)
        XCTAssertEqual(haptics.impacts, 0)
    }

    func testJourneyAlertsOffKeepsTheUpdateSilent() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        let focus = trackerFocus(id: "silent", now: now, pinned: false)
        let lead = focus.journey.legs[0].effectiveArrival - trackerAlertLead

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false,
                                   journeyAlerts: false, background: true)
        await controller.awaitPublications()
        await controller.reconcile(focus: focus, visibleFocus: focus, now: lead, recordedComplete: false,
                                   journeyAlerts: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty)
        XCTAssertEqual(haptics.impacts, 0)

        await controller.reconcile(focus: focus, visibleFocus: focus, now: lead + 1_000, recordedComplete: false,
                                   journeyAlerts: false)
        await controller.awaitPublications()
        XCTAssertEqual(haptics.impacts, 0)
    }

    func testCancelledJourneyStillCuesItsLead() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        var focus = trackerFocus(id: "cancelled", now: now, pinned: false)
        let riding = focus.journey.legs[0]

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()
        focus.journey.legs[1].cancelled = true
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 1_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Service cancelled"])

        await controller.reconcile(focus: focus, visibleFocus: focus, now: riding.effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Service cancelled", "Change services soon"],
                       "A cancellation cannot swallow the rest of the journey's cues")
    }

    func testMissedConnectionCuesInsteadOfTheChangeOnThatLeg() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics)
        var focus = trackerFocus(id: "missed", now: now, pinned: false)
        let riding = focus.journey.legs[0]
        focus.journey.legs[1].estimatedDeparture = riding.effectiveArrival - 60_000

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        await controller.reconcile(focus: focus, visibleFocus: focus, now: riding.effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty, "A leg whose connection is already missed does not cue a change")

        await controller.reconcile(focus: focus, visibleFocus: focus, now: riding.effectiveArrival + 1_000,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Connection missed"])
    }

    func testAGapInObservationRecordsTheBaselineInsteadOfCueing() async {
        let now = 1_800_000_000_000.0
        let clock = TrackerClock()
        let driver = TrackerDriver()
        let haptics = TrackerHaptics()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: haptics, clock: clock.now)
        let focus = trackerFocus(id: "gap", now: now, pinned: false)
        let lead = focus.journey.legs[0].effectiveArrival - trackerAlertLead

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        clock.advance(trackerObservationGap + 1)
        await controller.reconcile(focus: focus, visibleFocus: focus, now: lead, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty, "A lead passed while the app was not observing is not a live moment")

        let next = trackerFocus(id: "gap-next", now: now, pinned: false)
        clock.advance(1)
        await controller.reconcile(focus: next, visibleFocus: next, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()
        clock.advance(1)
        await controller.reconcile(focus: next, visibleFocus: next,
                                   now: next.journey.legs[0].effectiveArrival - trackerAlertLead,
                                   recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Change services soon"], "A session observed live still cues")
    }

    func testTheArrivalDelayCuesOnEveryCrossingOfFiveMinutes() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: TrackerHaptics())
        var focus = trackerFocus(id: "late", now: now, pinned: false)
        let arrival = focus.journey.legs[1].arrival

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        focus.journey.legs[1].estimatedArrival = arrival + 300_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 1_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Running late"])
        XCTAssertEqual(driver.alerts.last?.body,
                       "The train is now due at \(focus.journey.legs[1].to.shortName) at \(clockTime(arrival + 300_000)).")

        focus.journey.legs[1].estimatedArrival = arrival + 600_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 2_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.count, 1, "A delay that grows further is the same lateness")

        focus.journey.legs[1].estimatedArrival = arrival + 60_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 3_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        focus.journey.legs[1].estimatedArrival = arrival + 420_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 4_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Running late", "Running late"],
                       "A delay that recovers and returns is a new fact")
    }

    func testATightChangeCuesOnceWhenTheWindowFirstShrinks() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: TrackerHaptics())
        var focus = trackerFocus(id: "tight", now: now, pinned: false)
        let arrival = focus.journey.legs[0].arrival

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()

        focus.journey.legs[0].estimatedArrival = arrival + 120_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 1_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Tight change"])
        XCTAssertEqual(driver.alerts.last?.body,
                       "The train is expected at \(focus.journey.legs[0].to.shortName) about 3 minutes before the M1 leaves.")

        focus.journey.legs[0].estimatedArrival = arrival + 180_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 2_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.count, 1, "A change that stays tight is one cue")
    }

    func testTheMissedConnectionCueCarriesTheRecoveryCandidate() async {
        let now = 1_800_000_000_000.0
        let driver = TrackerDriver()
        let controller = TravelTrackerController(store: TrackerStore(), driver: driver, haptics: TrackerHaptics())
        var focus = trackerFocus(id: "recovered", now: now, pinned: false)
        let onward = focus.journey.legs[1]
        var candidate = onward
        candidate.departure = onward.departure + 900_000
        candidate.estimatedDeparture = onward.effectiveDeparture + 900_000
        candidate.arrival = onward.arrival + 900_000
        candidate.estimatedArrival = onward.effectiveArrival + 900_000
        focus.recovery = RecoveryRecord(
            changeIndex: 0, journey: Journey(legs: [candidate]), fetchedAt: now,
            source: RecoverySource(generatedAt: now, degraded: false)
        )

        await controller.reconcile(focus: focus, visibleFocus: focus, now: now, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertTrue(driver.alerts.isEmpty)

        focus.journey.legs[0].estimatedArrival = onward.effectiveDeparture + 60_000
        await controller.reconcile(focus: focus, visibleFocus: focus, now: now + 1_000, recordedComplete: false, background: true)
        await controller.awaitPublications()
        XCTAssertEqual(driver.alerts.map(\.title), ["Connection missed"])
        XCTAssertEqual(driver.alerts.last?.body,
                       "The planned trains no longer connect. Another option is the M1 at "
                           + "\(clockTime(candidate.effectiveDeparture)) from \(candidate.from.shortName).")
    }

    private func waitFor(_ predicate: @escaping () async -> Bool) async {
        for _ in 0..<50 {
            if await predicate() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for asynchronous tracker state")
    }
}

private actor TrackerStore: TravelTrackerSessionStoring {
    private var value: TravelTrackerSession
    init(_ value: TravelTrackerSession = TravelTrackerSession()) { self.value = value }
    func load() -> TravelTrackerSession { value }
    func save(_ session: TravelTrackerSession) { value = session }
}

private final class TrackerDriver: @unchecked Sendable, TravelTrackerActivityDriving {
    var activitiesEnabled = true
    private let lock = NSLock()
    private let requestDelay: Duration
    private var records: [TravelTrackerActivityRecord] = []
    private var continuations: [String: AsyncStream<TravelTrackerSystemActivityState>.Continuation] = [:]
    private(set) var ended: [String] = []
    private var updates = 0
    private var alerted: [TravelTrackerAlert?] = []

    init(requestDelay: Duration = .zero) {
        self.requestDelay = requestDelay
    }

    var current: [TravelTrackerActivityRecord] { lock.withLock { records } }
    var updateCount: Int { lock.withLock { updates } }
    var alerts: [TravelTrackerAlert] { lock.withLock { alerted.compactMap { $0 } } }

    func activities() async -> [TravelTrackerActivityRecord] { current }

    func request(
        attributes: TravelTrackerActivityAttributes,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>
    ) async throws -> String {
        if requestDelay > .zero { try? await Task.sleep(for: requestDelay) }
        return lock.withLock {
            let id = UUID().uuidString
            records.append(.init(id: id, attributes: attributes))
            return id
        }
    }

    func update(
        id: String,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>,
        alert: TravelTrackerAlert?
    ) async {
        lock.withLock { updates += 1; alerted.append(alert) }
    }

    func end(id: String) async {
        lock.withLock {
            records.removeAll { $0.id == id }
            ended.append(id)
            continuations.removeValue(forKey: id)?.finish()
        }
    }

    func stateUpdates(id: String) -> AsyncStream<TravelTrackerSystemActivityState> {
        AsyncStream { continuation in lock.withLock { continuations[id] = continuation } }
    }

    func emit(_ state: TravelTrackerSystemActivityState, id: String) {
        lock.withLock {
            if state == .dismissed || state == .ended { records.removeAll { $0.id == id } }
            continuations[id]?.yield(state)
        }
    }
}

private final class TrackerHaptics: @unchecked Sendable, TravelTrackerHapticPerforming {
    private let lock = NSLock()
    private var count = 0

    var impacts: Int { lock.withLock { count } }

    func impact() { lock.withLock { count += 1 } }
}

private final class TrackerClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1_800_000_000)

    var now: @Sendable () -> Date { { self.lock.withLock { self.value } } }

    func advance(_ seconds: TimeInterval) { lock.withLock { value = value.addingTimeInterval(seconds) } }
}

private func trackerFocus(
    id: String,
    now: Millis,
    pinned: Bool,
    legCount: Int = 2
) -> FocusedJourney {
    let stations = (0...legCount).map {
        Station(id: "station-\($0)", name: String(repeating: "Long station name \($0) ", count: 3), modes: ["train", "metro"])
    }
    let legs = (0..<legCount).map { index in
        let departure = now - 120_000 + Double(index) * 900_000
        return Leg(
            line: index.isMultiple(of: 2) ? "T8" : "M1",
            mode: index.isMultiple(of: 2) ? "train" : "metro",
            headsign: "A deliberately long destination headsign \(index)",
            from: stations[index],
            to: stations[index + 1],
            departure: departure,
            arrival: departure + 600_000,
            estimatedDeparture: departure,
            estimatedArrival: departure + 600_000,
            fromPlatform: "Platform \(20 + index)",
            toPlatform: "Platform \(21 + index)"
        )
    }
    let journey = Journey(legs: legs)
    let board = BoardData(
        from: stations[0], to: stations[legCount], journeys: [journey],
        generatedAt: now - 30_000, source: "live"
    )
    return FocusedJourney(tripId: id, reverse: false, journey: journey, board: board, pinned: pinned)
}

private extension Array {
    var single: Element? { count == 1 ? self[0] : nil }
}
