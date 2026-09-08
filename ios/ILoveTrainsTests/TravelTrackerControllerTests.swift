import ActivityKit
import Foundation
import XCTest
@testable import ILoveTrains

final class TravelTrackerControllerTests: XCTestCase {
    func testAutomaticInferenceStartsButPinAloneDoesNot() async {
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
        XCTAssertTrue(pinnedDriver.current.isEmpty)
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

    init(requestDelay: Duration = .zero) {
        self.requestDelay = requestDelay
    }

    var current: [TravelTrackerActivityRecord] { lock.withLock { records } }
    var updateCount: Int { lock.withLock { updates } }

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
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>
    ) async {
        lock.withLock { updates += 1 }
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
