import Foundation
import XCTest
@testable import ILoveTrains

@MainActor
final class TransferRecoveryProbeTests: XCTestCase {
    private let rhodes = Station(id: "213820", name: "Rhodes Station")
    private let townHall = Station(id: "200070", name: "Town Hall Station")
    private let central = Station(id: "200060", name: "Central Station")
    private let bondi = Station(id: "202210", name: "Bondi Junction Station")

    private static let midnight: Millis = 1_789_394_400_000 // 2026-09-15 00:00 AEST
    private static let minute: Millis = 60_000
    private static func t(_ clock: String) -> Millis {
        let parts = clock.split(separator: ":").map { Double($0)! }
        return midnight + (parts[0] * 60 + parts[1]) * minute
    }
    private let now = t("09:47")

    private var t9: Leg {
        Leg(line: "T9", mode: "train", headsign: "Gordon via Lindfield", from: rhodes, to: townHall,
            departure: Self.t("09:24"), arrival: Self.t("09:51"), estimatedArrival: Self.t("10:00"),
            fromPlatform: "1", toPlatform: "3")
    }
    private var t4: Leg {
        Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: townHall, to: bondi,
            departure: Self.t("09:58"), arrival: Self.t("10:08"), fromPlatform: "5", toPlatform: "1")
    }
    private var followed: Journey { Journey(legs: [t9, t4]) }

    private func t4At(_ departure: String, _ arrival: String, estimatedDeparture: String? = nil,
                      from: Station? = nil, platform: String = "5") -> Leg {
        Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: from ?? townHall, to: bondi,
            departure: Self.t(departure), arrival: Self.t(arrival),
            estimatedDeparture: estimatedDeparture.map(Self.t), fromPlatform: platform, toPlatform: "1")
    }

    private var heldTenPastEight: RecoveryRecord {
        RecoveryRecord(changeIndex: 0, journey: Journey(legs: [t4At("10:08", "10:18")]), fetchedAt: now,
                       source: RecoverySource(generatedAt: now, degraded: false))
    }

    private func focusOf(_ recovery: RecoveryRecord?, journey: Journey? = nil) -> FocusedJourney {
        let journey = journey ?? followed
        let board = BoardData(from: rhodes, to: bondi, journeys: [journey], generatedAt: now, source: "live")
        return FocusedJourney(tripId: "rhodes-bondijunction", reverse: false, journey: journey, board: board,
                              pinned: false, recovery: recovery)
    }

    /// The lines of TrainViewModel.recoverFocus that choose the record from a board.
    private func settle(_ focus: FocusedJourney, boards: (RecoverySearch) -> [Journey]) -> RecoveryRecord? {
        let plan = recoveryPlan(focus)
        guard let search = plan.search else { return nil }
        return recoveryRecord(plan: plan, held: focus.recovery, journeys: boards(search), modes: allModes,
                              fetchedAt: now, source: RecoverySource(generatedAt: now, degraded: false))
    }

    private func outline(_ journey: Journey) -> [String] { journey.legs.map { "\($0.line)@\(clockTime($0.departure))" } }

    // Invariant 1 / 8: the printed-change receipt waits until the journey is under way.

    func testTheShrunkChangeReceiptIsNotShownBeforeDeparture() {
        let waiting = Journey(legs: [
            Leg(line: "T9", mode: "train", headsign: "Gordon", from: rhodes, to: townHall,
                departure: now + 5 * Self.minute, arrival: now + 20 * Self.minute,
                estimatedArrival: now + 23 * Self.minute, fromPlatform: "1", toPlatform: "3"),
            Leg(line: "T4", mode: "train", headsign: "Bondi", from: townHall, to: bondi,
                departure: now + 27 * Self.minute, arrival: now + 40 * Self.minute, fromPlatform: "5", toPlatform: "1"),
        ])
        let focus = focusOf(nil, journey: waiting)
        XCTAssertNil(focusReceipt(focus, plan: recoveryPlan(focus), now: now),
                     "the receipt appears only once the journey is under way (ui.md)")
    }

    // Invariant 2 / 8: the record is re-matched, never re-picked.

    func testAHeldCandidateIsKeptWhenAnEarlierTrainBecomesEligible() throws {
        let earlier = Journey(legs: [t4At("10:04", "10:15", estimatedDeparture: "10:05")])
        let record = try XCTUnwrap(settle(focusOf(heldTenPastEight)) { _ in [earlier, heldTenPastEight.journey] })
        XCTAssertEqual(outline(record.journey), outline(heldTenPastEight.journey),
                       "the rider was told the 10:08 and is now re-told the 10:04")
    }

    func testAHeldCandidateWhoseWindowShrinksToTightIsKeptNotSwapped() throws {
        let tightened = Journey(legs: [t4At("10:08", "10:18", estimatedDeparture: "10:02")])
        let later = Journey(legs: [t4At("10:15", "10:25")])
        let record = try XCTUnwrap(settle(focusOf(heldTenPastEight)) { _ in [tightened, later] })
        XCTAssertEqual(outline(record.journey), outline(tightened), "the tight 10:08 was swapped for a later train")
        let plan = recoveryPlan(focusOf(record))
        XCTAssertEqual(plan.composedStates, [.tight])
    }

    func testAMovedAnchorRecordIsStableAcrossTheRefreshesThatFollowIt() throws {
        let viaCentral = Journey(legs: [
            Leg(line: "T1", mode: "train", headsign: "Central", from: townHall, to: central,
                departure: Self.t("10:05"), arrival: Self.t("10:08"), estimatedArrival: Self.t("10:14"),
                fromPlatform: "5", toPlatform: "18"),
            t4At("10:11", "10:24", from: central, platform: "20"),
        ])
        let fromCentral = Journey(legs: [t4At("10:19", "10:32", from: central, platform: "20")])
        let boards: (RecoverySearch) -> [Journey] = { search in
            switch search.from.id {
            case self.townHall.id: return [viaCentral]
            case self.central.id: return [fromCentral]
            default: return []
            }
        }
        var focus = focusOf(RecoveryRecord(changeIndex: 0, journey: viaCentral, fetchedAt: now,
                                           source: RecoverySource(generatedAt: now, degraded: false)))
        let first = try XCTUnwrap(settle(focus, boards: boards))
        focus.recovery = first
        XCTAssertEqual(outline(recoveryPlan(focus).composed), ["T9@09:24", "T1@10:05", "T4@10:19"])

        for refresh in 2...4 {
            let record = try XCTUnwrap(settle(focus, boards: boards))
            focus.recovery = record
            XCTAssertEqual(outline(recoveryPlan(focus).composed), ["T9@09:24", "T1@10:05", "T4@10:19"],
                           "refresh \(refresh) re-told the rider a different train")
        }
    }

    // Invariant 8 (ruling): the candidate's own change is lost and nothing is found from the later change.

    func testTheCandidatesOwnChangeLostWithNothingFromTheLaterChangeReadsAsLost() {
        let viaCentral = Journey(legs: [
            Leg(line: "T1", mode: "train", headsign: "Central", from: townHall, to: central,
                departure: Self.t("10:05"), arrival: Self.t("10:08"), estimatedArrival: Self.t("10:14"),
                fromPlatform: "5", toPlatform: "18"),
            t4At("10:11", "10:24", from: central, platform: "20"),
        ])
        let held = RecoveryRecord(changeIndex: 0, journey: viaCentral, fetchedAt: now,
                                  source: RecoverySource(generatedAt: now, degraded: false))
        var focus = focusOf(held)
        focus.recovery = settle(focus) { _ in [] }
        let plan = recoveryPlan(focus)
        XCTAssertEqual(focusReceipt(focus, plan: plan, now: now), "Check the station boards.")
        XCTAssertEqual(focusedInstruction(plan, now: now), "The T1 arrives too late for the 10:11")
        XCTAssertNotNil(focusArrivalClocks(plan, followed: focus.journey).planned,
                        "the arrival the rider cannot make is shown as achievable")
    }

    // Invariant 6: a recovery change is judged by its window alone.

    func testARecoveryChangeWhoseEstimateLandsEarlierThanItsTimetableIsNotShrunk() throws {
        let early = Journey(legs: [t4At("10:08", "10:18", estimatedDeparture: "10:06")])
        let record = try XCTUnwrap(settle(focusOf(nil)) { _ in [early] })
        let focus = focusOf(record)
        let plan = recoveryPlan(focus)
        XCTAssertEqual(plan.composedStates, [.ordinary])
        XCTAssertEqual(focusedInstruction(plan, now: now), "Get off at Town Hall · Platform 3")
        XCTAssertFalse((focusReceipt(focus, plan: plan, now: now) ?? "").contains("Printed change"))
    }

    // Invariant 3 (ruling): the ride recorded is the followed journey's.

    func testTheRideRecordedAtTheEndOfARecoveredJourneyIsTheFollowedJourneys() throws {
        let rides = settledRides([], focus: focusOf(heldTenPastEight), arrived: true, ends: (rhodes, bondi))
        let ride = try XCTUnwrap(rides.first)
        XCTAssertEqual(ride.departure, followed.departure)
        XCTAssertEqual(ride.arrival, followed.effectiveArrival)
    }

    // Invariant 2: malformed records.

    func testAChangeIndexPastTheLastChangeIsIgnored() {
        var stray = heldTenPastEight
        stray.changeIndex = 3
        XCTAssertEqual(recoveryPlan(focusOf(stray)).composed.legs, followed.legs)
        XCTAssertNil(recoveryPlan(focusOf(stray)).recoveryChangeIndex)
    }

    func testARecordWhoseFirstLegDoesNotBoardAtTheChangeStationIsNotComposed() {
        let stray = RecoveryRecord(changeIndex: 0, journey: Journey(legs: [t4At("10:08", "10:18", from: central)]),
                                   fetchedAt: now, source: RecoverySource(generatedAt: now, degraded: false))
        let composed = recoveryPlan(focusOf(stray)).composed
        XCTAssertEqual(composed.legs[0].to.id, composed.legs[1].from.id,
                       "the composed journey changes at Town Hall but boards at Central")
    }

    // Invariant 5: the tight-change cue waits until the rider is riding toward the change.

    func testAChangeBecomingTightBeforeDepartureDoesNotCue() throws {
        let waiting = Journey(legs: [
            Leg(line: "T9", mode: "train", headsign: "Gordon", from: rhodes, to: townHall,
                departure: now + 5 * Self.minute, arrival: now + 20 * Self.minute, fromPlatform: "1", toPlatform: "3"),
            Leg(line: "T4", mode: "train", headsign: "Bondi", from: townHall, to: bondi,
                departure: now + 23 * Self.minute, arrival: now + 33 * Self.minute, fromPlatform: "5", toPlatform: "1"),
        ])
        let focus = focusOf(nil, journey: waiting)
        let state = try XCTUnwrap(TravelTrackerState.derive(focus: focus, now: now, generation: 1))
        XCTAssertEqual(state.stage, .boarding)
        let previous = TravelTrackerCueBaseline(arrivalDelay: 0, changeStates: [.ordinary])
        let kinds = TravelTrackerCue.pending(state: state, focus: focus, now: now, previous: previous).map(\.kind)
        XCTAssertFalse(kinds.contains(.tightChange), "a tight change cued while the rider is still on the platform: \(kinds)")
    }

    // Invariant 4: the recovery request carries the followed journey's transfer cap.

    func testTheRecoveryRequestCarriesTheTransferCap() async throws {
        ProbeRecordingProtocol.reset()
        let real = epochNow()
        let iso = { (offset: Double) -> String in
            ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: (real + offset * 60_000) / 1000))
        }
        let legs = """
        [{"line":{"name":"T9","mode":"train"},"headsign":"Gordon","from":{"id":"213820","name":"Rhodes Station","platform":"Platform 1"},
          "to":{"id":"200070","name":"Town Hall Station","platform":"Platform 3"},
          "departure":{"scheduled":"\(iso(-30))","estimated":"\(iso(-30))"},"arrival":{"scheduled":"\(iso(-5))","estimated":"\(iso(3))"}},
         {"line":{"name":"T4","mode":"train"},"headsign":"Bondi Junction","from":{"id":"200070","name":"Town Hall Station","platform":"Platform 5"},
          "to":{"id":"202210","name":"Bondi Junction Station","platform":"Platform 1"},
          "departure":{"scheduled":"\(iso(1))","estimated":"\(iso(1))"},"arrival":{"scheduled":"\(iso(15))","estimated":"\(iso(15))"}}]
        """
        let followedBoard = """
        {"from":{"id":"213820","name":"Rhodes Station"},"to":{"id":"202210","name":"Bondi Junction Station"},
         "generatedAt":"\(iso(0))","journeys":[{"legDetail":\(legs)}]}
        """
        let emptyBoard = """
        {"from":{"id":"200070","name":"Town Hall Station"},"to":{"id":"202210","name":"Bondi Junction Station"},
         "generatedAt":"\(iso(0))","journeys":[]}
        """
        ProbeRecordingProtocol.respond { url in
            if url.path == "/api/v1/flags" { return Data(#"{"transferLimit": true}"#.utf8) }
            return Data((url.query?.contains("from=200070") == true ? emptyBoard : followedBoard).utf8)
        }
        let board = try TransitWire.board(Data(followedBoard.utf8))
        let journey = try XCTUnwrap(board.journeys.first)
        XCTAssertEqual(connectionStates(journey.legs), [.lost], "the seeded journey must have a lost change")
        let trip = SavedTrip(id: "trip", from: rhodes, to: bondi, createdAt: real)
        let data = UserData(trips: [trip], lastTripId: "trip",
                            focus: FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board),
                            transferLimit: .direct, flags: ["transferLimit": true])
        let store = DeviceStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        try await store.save(data)

        let model = TrainViewModel(store: store, api: TransitAPI(baseURL: "https://stub.invalid", session: ProbeRecordingProtocol.session()))
        for _ in 0..<200 where !model.state.ready { try await Task.sleep(for: .milliseconds(10)) }
        model.resume()
        for _ in 0..<500 where ProbeRecordingProtocol.departures().first(where: { $0.contains("from=200070") }) == nil {
            try await Task.sleep(for: .milliseconds(10))
        }
        let recovery = try XCTUnwrap(ProbeRecordingProtocol.departures().first { $0.contains("from=200070") },
                                     "no recovery request was made: \(ProbeRecordingProtocol.departures())")
        XCTAssertTrue(recovery.contains("to=202210"), recovery)
        XCTAssertTrue(recovery.contains("at="), recovery)
        XCTAssertTrue(recovery.contains("transferLimit="), "the recovery search ignores the rider's transfer cap: \(recovery)")
        model.pause()
    }
}

private final class ProbeRecordingProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [URL] = []
    private static var responder: (URL) -> Data = { _ in Data("{}".utf8) }

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        recorded = []
    }
    static func respond(_ body: @escaping (URL) -> Data) {
        lock.lock(); defer { lock.unlock() }
        responder = body
    }
    static func departures() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded.filter { $0.path == "/api/v1/departures" }.map(\.absoluteString)
    }
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProbeRecordingProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.lock()
        Self.recorded.append(url)
        let body = Self.responder(url)
        Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
