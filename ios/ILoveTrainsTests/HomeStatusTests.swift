import XCTest
@testable import ILoveTrains

final class HomeStatusTests: XCTestCase {
    func testFuturePinnedSavedTripReadsPinned() {
        let now: Millis = 1_000_000
        let focus = makeFocus(now: now)

        XCTAssertEqual(savedTripFocusStatus(focus, now: now, complete: false), "Pinned")
    }

    func testExceptionalStatusesOutrankFuturePin() {
        let now: Millis = 1_000_000
        var cancelled = makeFocus(now: now)
        cancelled.journey.legs[0].cancelled = true
        XCTAssertEqual(savedTripFocusStatus(cancelled, now: now, complete: false), "Cancelled · Pinned")

        XCTAssertEqual(savedTripFocusStatus(makeFocus(now: now), now: now, complete: true), "Trip over · Pinned")
    }

    func testHeaderAndSavedRowUseTheSameLiveLateStatus() {
        let now: Millis = 1_000_000
        var focus = makeFocus(now: now)
        focus.journey.legs[0].estimatedDeparture = focus.journey.departure + 120_000
        focus.board.journeys = [focus.journey]

        XCTAssertEqual(focusStatus(focus, now: now, complete: false), "Running late")
        XCTAssertEqual(savedTripFocusStatus(focus, now: now, complete: false), "Running late · Pinned")

        focus.board.serverStale = true
        XCTAssertEqual(focusStatus(focus, now: now, complete: false), "Running late")
        XCTAssertEqual(savedTripFocusStatus(focus, now: now, complete: false), "Running late · Pinned")

        var unavailable = focus
        unavailable.board.offline = true
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
        unavailable = focus
        unavailable.board.source = "schedule"
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
        unavailable = focus
        unavailable.board.generatedAt = now - 90_001
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
        unavailable = focus
        unavailable.journey.retained = true
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
    }

    func testEveryLegMustBeEnabledForSuggestions() {
        let now: Millis = 1_000_000
        let from = Station(id: "from", name: "From")
        let change = Station(id: "change", name: "Change")
        let to = Station(id: "to", name: "To")
        let mixed = Journey(legs: [
            Leg(line: "T1", mode: "train", headsign: "Change", from: from, to: change, departure: now, arrival: now + 60_000),
            Leg(line: "F1", mode: "ferry", headsign: "To", from: change, to: to, departure: now + 120_000, arrival: now + 300_000)
        ])

        XCTAssertFalse(journeyAllowed(mixed, modes: ["train"]))
        XCTAssertTrue(journeyAllowed(mixed, modes: ["train", "ferry"]))
    }

    func testDepartedUnfocusedRetainedHeaderReadsLastShown() {
        let now: Millis = 1_000_000
        var focus = makeFocus(now: now)
        focus.journey.legs[0].departure = now - 300_000
        focus.journey.legs[0].estimatedDeparture = now - 240_000
        focus.journey.retained = true
        focus.board.offline = true

        XCTAssertEqual(
            retainedHeaderStatus(board: focus.board, journey: focus.journey, hasFocus: false, now: now),
            "Last shown"
        )
        XCTAssertNil(retainedHeaderStatus(board: focus.board, journey: focus.journey, hasFocus: true, now: now))
    }

    private func makeFocus(now: Millis) -> FocusedJourney {
        let from = Station(id: "from", name: "From")
        let to = Station(id: "to", name: "To")
        let journey = Journey(legs: [Leg(
            line: "T1",
            mode: "train",
            headsign: "To",
            from: from,
            to: to,
            departure: now + 300_000,
            arrival: now + 1_200_000
        )])
        let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: now, source: "live")
        return FocusedJourney(tripId: "trip", reverse: false, journey: journey, board: board)
    }
}

/// The candidate's own change is lost and the search from that change finds nothing
/// (docs/contracts/client-storage.md, Recovery): the rider reads the composition as lost,
/// never a struck arrival beside a time they cannot make.
final class StrandedRecoveryTests: XCTestCase {
    private let rhodes = Station(id: "213820", name: "Rhodes Station")
    private let townHall = Station(id: "200070", name: "Town Hall Station")
    private let central = Station(id: "200060", name: "Central Station")
    private let bondi = Station(id: "202210", name: "Bondi Junction Station")

    private static let midnight: Millis = 1_789_394_400_000 // 2026-09-15 00:00 AEST
    private static func t(_ clock: String) -> Millis {
        let parts = clock.split(separator: ":").map { Double($0)! }
        return midnight + (parts[0] * 60 + parts[1]) * 60_000
    }
    private let now = t("09:47")

    private var followed: Journey {
        Journey(legs: [
            Leg(line: "T9", mode: "train", headsign: "Gordon via Lindfield", from: rhodes, to: townHall,
                departure: Self.t("09:24"), arrival: Self.t("09:51"), estimatedArrival: Self.t("10:00"),
                fromPlatform: "1", toPlatform: "3"),
            Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: townHall, to: bondi,
                departure: Self.t("09:58"), arrival: Self.t("10:08"), fromPlatform: "5", toPlatform: "1"),
        ])
    }

    private var viaCentral: Journey {
        Journey(legs: [
            Leg(line: "T1", mode: "train", headsign: "Central", from: townHall, to: central,
                departure: Self.t("10:05"), arrival: Self.t("10:08"), estimatedArrival: Self.t("10:14"),
                fromPlatform: "5", toPlatform: "18"),
            Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: central, to: bondi,
                departure: Self.t("10:11"), arrival: Self.t("10:24"), fromPlatform: "20", toPlatform: "1"),
        ])
    }

    private func focus(_ recovery: RecoveryRecord?) -> FocusedJourney {
        let journey = followed
        let board = BoardData(from: rhodes, to: bondi, journeys: [journey], generatedAt: now, source: "live")
        return FocusedJourney(tripId: "rhodes-bondijunction", reverse: false, journey: journey, board: board,
                              pinned: false, recovery: recovery)
    }

    private var held: RecoveryRecord {
        RecoveryRecord(changeIndex: 0, journey: viaCentral, fetchedAt: now - 60_000,
                       source: RecoverySource(generatedAt: now - 60_000, degraded: false))
    }

    private func settle(_ subject: FocusedJourney, boards: (RecoverySearch) -> [Journey]) -> FocusedJourney {
        var settled = subject
        let plan = recoveryPlan(subject)
        guard let search = plan.search else { settled.recovery = nil; return settled }
        settled.recovery = recoveryRecord(plan: plan, held: subject.recovery, journeys: boards(search),
                                          modes: allModes, fetchedAt: now,
                                          source: RecoverySource(generatedAt: now, degraded: false))
        return settled
    }

    func testTheSearchFollowsTheRecordToItsOwnChange() {
        let search = recoveryPlan(focus(held)).search
        XCTAssertEqual(search?.anchor, 1)
        XCTAssertEqual(search?.from.id, central.id)
        XCTAssertEqual(search?.at, Self.t("10:14"))
    }

    func testAConnectedRecordIsRefreshedFromItsOwnChange() {
        let repaired = RecoveryRecord(changeIndex: 0, journey: Journey(legs: [
            viaCentral.legs[0],
            Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: central, to: bondi,
                departure: Self.t("10:19"), arrival: Self.t("10:32"), fromPlatform: "20", toPlatform: "1"),
        ]), fetchedAt: now, source: RecoverySource(generatedAt: now, degraded: false), anchor: 1)
        let plan = recoveryPlan(focus(repaired))
        XCTAssertEqual(plan.composedStates, [.ordinary, .ordinary])
        XCTAssertEqual(plan.search?.anchor, 1)
        XCTAssertEqual(plan.search?.from.id, central.id)
        XCTAssertEqual(plan.search?.at, Self.t("10:14"))
    }

    func testAStrandedCandidateReadsAsLostWithoutAStruckArrival() {
        let settled = settle(focus(held)) { _ in [] }
        let plan = recoveryPlan(settled)
        XCTAssertEqual(plan.composed.legs.map(\.line), ["T9", "T1", "T4"])
        XCTAssertEqual(plan.composedStates, [.ordinary, .lost])
        XCTAssertEqual(focusedInstruction(plan, now: now), "The T1 arrives too late for the 10:11")
        XCTAssertEqual(focusReceipt(settled, plan: plan, now: now), "Check the station boards.")
        XCTAssertEqual(focusStatus(settled, plan: plan, now: now, complete: false), "Late · Connection gone")
        let clocks = focusArrivalClocks(plan, followed: settled.journey)
        XCTAssertEqual(clocks.planned, "10:24")
        XCTAssertNil(clocks.struck)
        XCTAssertNil(clocks.shown)
    }

    func testAStrandedRecordIsNotRepairedFromTheOriginalChange() {
        let fromTownHall = Journey(legs: [
            Leg(line: "T8", mode: "train", headsign: "Bondi Junction", from: townHall, to: bondi,
                departure: Self.t("10:20"), arrival: Self.t("10:30"), fromPlatform: "5", toPlatform: "1"),
        ])
        let settled = settle(focus(held)) { $0.from.id == self.townHall.id ? [fromTownHall] : [] }
        XCTAssertEqual(settled.recovery?.journey.legs.map(\.line), ["T1", "T4"])
        XCTAssertEqual(recoveryPlan(settled).composedStates, [.ordinary, .lost])
    }

    func testAStrandedRecordIsReplacedFromItsOwnChange() {
        let fromCentral = Journey(legs: [
            Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: central, to: bondi,
                departure: Self.t("10:19"), arrival: Self.t("10:32"), fromPlatform: "20", toPlatform: "1"),
        ])
        let settled = settle(focus(held)) { $0.from.id == self.central.id ? [fromCentral] : [] }
        let plan = recoveryPlan(settled)
        XCTAssertEqual(plan.composed.legs.map(\.departure),
                       [Self.t("09:24"), Self.t("10:05"), Self.t("10:19")])
        XCTAssertEqual(plan.composedStates, [.ordinary, .ordinary])
        XCTAssertEqual(focusArrivalClocks(plan, followed: settled.journey).struck, "10:08")
    }

    func testACandidateBoardingAwayFromTheChangeOrOverTheCapIsSkipped() {
        let elsewhere = Journey(legs: [
            Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: central, to: bondi,
                departure: Self.t("10:08"), arrival: Self.t("10:18"), fromPlatform: "20", toPlatform: "1"),
        ])
        XCTAssertNil(recoveryCandidate([elsewhere], arrival: Self.t("10:00"), modes: allModes,
                                       boardingAt: townHall.id))
        XCTAssertNil(recoveryCandidate([viaCentral], arrival: Self.t("10:00"), modes: allModes,
                                       transferLimit: 0, boardingAt: townHall.id))
        XCTAssertNotNil(recoveryCandidate([viaCentral], arrival: Self.t("10:00"), modes: allModes,
                                          transferLimit: 1, boardingAt: townHall.id))
    }
}
