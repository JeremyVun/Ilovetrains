import XCTest
@testable import ILoveTrains

@MainActor
final class HeaderMetricsTests: XCTestCase {
    private var analytics = makeAnalytics(debug: true)
    private lazy var metrics = HeaderMetrics(analytics: analytics)

    private var names: [String] { analytics.ledger.map(\.t) }
    private func events(_ name: String) -> [AnalyticsEvent] { analytics.ledger.filter { $0.t == name } }
    private func openOnce(_ kind: HeaderKind? = .predicted, trip: String = "a", reverse: Bool = false, lead: String? = nil) {
        metrics.resumed()
        metrics.homeShown(kind: kind, tripId: trip, reverse: reverse, lead: lead)
    }

    func testEachForegroundEntryShowingAnAnswerIsOneOpenBandedAndMilestonedByItsCount() {
        for _ in 0..<12 {
            openOnce()
            metrics.homeShown(kind: .predicted, tripId: "a", reverse: false, lead: nil)
            metrics.backgrounded()
        }
        XCTAssertEqual(events("opened").map { [$0.d["m"], $0.d["u"]] }, [["1", "1"], ["5", "2-5"], ["10", "6-10"]])
        XCTAssertEqual(events("shown_predicted").map { $0.d["u"] },
                       ["1", "2-5", "2-5", "2-5", "2-5", "6-10", "6-10", "6-10", "6-10", "6-10", "11-15", "11-15"])
        XCTAssertTrue(analytics.ledger.allSatisfy { $0.d["pl"] == "ios" && $0.d["pl.u"] == "ios." + ($0.d["u"] ?? "") })
    }

    func testOpenedPrecedesTheFirstExposureOfItsOpen() {
        openOnce(.home)
        XCTAssertEqual(names, ["opened", "shown_home"])
    }

    func testOnlyARealForegroundEntryStartsAnOpen() {
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: nil)
        XCTAssertTrue(names.isEmpty, "a process started in the background shows no one anything")
        openOnce(.usual)
        XCTAssertFalse(metrics.resumed(), "returning from an inactive scene is the same open")
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: nil)
        metrics.tripTapped(tripId: "a", reverse: false)
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: nil)
        XCTAssertEqual(names, ["opened", "shown_usual", "hit_usual"], "an inactive scene and a return from the board stay in one open")
        metrics.backgrounded()
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: nil)
        XCTAssertEqual(names.count, 3, "a backgrounded process keeps working unseen")
        XCTAssertTrue(metrics.resumed())
        XCTAssertEqual(names.count, 3, "an entry that never reaches Home or setup counts nothing")
        metrics.backgrounded()
        metrics.resumed()
        metrics.setupShown(newVisit: true)
        metrics.backgrounded()
        metrics.resumed()
        metrics.homeShown(kind: nil, tripId: "a", reverse: false, lead: nil)
        metrics.backgrounded()
        openOnce(.usual)
        metrics.backgrounded()
        openOnce(.usual)
        XCTAssertEqual(events("opened").map { $0.d["m"] }, ["1", "5"], "setup and a browsed trip were the second and third opens")

        let store = MemoryAnalyticsStore()
        let counted = HeaderMetrics(analytics: makeAnalytics(store: store))
        for _ in 0..<3 { counted.resumed(); counted.homeShown(kind: nil, tripId: "a", reverse: false, lead: nil); counted.backgrounded() }
        XCTAssertEqual(store.stored?.opens, 3)
    }

    func testOnlyAnImmediateRepeatOfKindTripAndDirectionIsSuppressed() {
        openOnce(.usual, trip: "a")
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: nil)
        metrics.homeShown(kind: .usual, tripId: "b", reverse: false, lead: nil)
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: nil)
        metrics.homeShown(kind: .usual, tripId: "a", reverse: true, lead: nil)
        metrics.homeShown(kind: .home, tripId: "a", reverse: true, lead: nil)
        metrics.homeShown(kind: nil, tripId: "c", reverse: false, lead: nil)
        metrics.homeShown(kind: .home, tripId: "a", reverse: true, lead: nil)
        XCTAssertEqual(names, ["opened", "shown_usual", "shown_usual", "shown_usual", "shown_usual", "shown_home"])
        metrics.backgrounded()
        openOnce(.home, trip: "a", reverse: true)
        XCTAssertEqual(events("shown_home").count, 2, "a new open exposes the answer again")
    }

    func testOnlyTheFirstHomeRowTapOfAnOpenIsClassified() {
        openOnce(.predicted, trip: "a")
        metrics.tripTapped(tripId: "b", reverse: false)
        metrics.tripTapped(tripId: "a", reverse: false)
        metrics.backgrounded()
        openOnce(.predicted, trip: "a")
        metrics.tripTapped(tripId: "a", reverse: false)
        metrics.backgrounded()
        openOnce(.predicted, trip: "a")
        metrics.tripTapped(tripId: "a", reverse: true)
        XCTAssertEqual(names.filter { $0.hasPrefix("hit_") || $0.hasPrefix("miss_") }, ["miss_predicted", "hit_predicted", "miss_predicted"])
    }

    func testSetupIsExcludedUntilLeavingItUnsavedRestoresTheAnswer() {
        openOnce(.home, trip: "a")
        metrics.setupShown(newVisit: true)
        metrics.tripTapped(tripId: "a", reverse: false)
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        XCTAssertEqual(names, ["opened", "shown_home"])
        metrics.backgrounded()

        openOnce(.home, trip: "a", lead: "k")
        metrics.setupShown(newVisit: true)
        metrics.homeShown(kind: nil, tripId: "a", reverse: false, lead: nil)
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        XCTAssertEqual(Array(names.dropFirst(3)), ["hit_home", "pinned_home"])
        metrics.backgrounded()

        openOnce(.home, trip: "a", lead: "k")
        metrics.setupShown(newVisit: true)
        metrics.setupSaved()
        metrics.homeShown(kind: nil, tripId: "a", reverse: false, lead: nil)
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        XCTAssertEqual(Array(names.dropFirst(5)).filter { $0 != "opened" }, ["shown_home"], "a saved setup keeps the header excluded")
    }

    func testAPinComparesWithTheLastRenderedLeadAndGivesEachResult() {
        openOnce(.usual, trip: "a", lead: "first")
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: "lead")
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "lead")
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: "lead")
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "later")
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: "lead")
        metrics.pinned(tripId: "b", reverse: false, journeyKey: "lead")
        metrics.homeShown(kind: .usual, tripId: "a", reverse: false, lead: "lead")
        metrics.pinned(tripId: "a", reverse: true, journeyKey: "lead")
        let pins = analytics.ledger.filter { $0.t.hasPrefix("hit_") || $0.t.hasPrefix("pinned_") }
        XCTAssertEqual(pins.map(\.t), ["hit_usual", "pinned_usual", "hit_usual", "pinned_usual", "pinned_usual", "pinned_usual"])
        XCTAssertEqual(pins.compactMap { $0.d["r"] }, ["same", "service", "trip", "trip"])
        XCTAssertEqual(pins.compactMap { $0.d["pl.r"] }, ["ios.same", "ios.service", "ios.trip", "ios.trip"])
        XCTAssertTrue(pins.filter { $0.t == "hit_usual" }.allSatisfy { Set($0.d.keys) == ["u", "pl", "pl.u"] })
    }

    func testASameTripPinWithNoDisplayedLeadCountsTheHitOnly() {
        openOnce(.focus, trip: "a")
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        metrics.homeShown(kind: .focus, tripId: "a", reverse: false, lead: nil)
        metrics.pinned(tripId: "b", reverse: false, journeyKey: "k")
        XCTAssertEqual(names, ["opened", "shown_focus", "hit_focus", "pinned_focus"])
        XCTAssertEqual(events("pinned_focus").map { $0.d["r"] }, ["trip"])
    }

    func testEachPinActionEmitsAtMostOnceAndNeedsThisOpensAnswer() {
        metrics.resumed()
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        metrics.homeShown(kind: .inferred, tripId: "a", reverse: false, lead: "k")
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        metrics.homeShown(kind: .inferred, tripId: "a", reverse: false, lead: "k")
        metrics.released()
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        metrics.homeShown(kind: .inferred, tripId: "a", reverse: false, lead: "k")
        metrics.backgrounded()
        metrics.resumed()
        metrics.pinned(tripId: "a", reverse: false, journeyKey: "k")
        XCTAssertEqual(names, ["opened", "shown_inferred", "hit_inferred", "pinned_inferred"])
    }

    func testRidesCountByHowTravelStartedAndHowArrivalWasDecided() {
        metrics.rode(pinned: true, basis: .location)
        metrics.rode(pinned: false, basis: .estimate)
        XCTAssertEqual(analytics.ledger, [
            AnalyticsEvent(t: "rode_pin", d: iosDims("1", ["b": "location", "pl.b": "ios.location"])),
            AnalyticsEvent(t: "rode_auto", d: iosDims("1", ["b": "estimate", "pl.b": "ios.estimate"]))
        ])
    }
}
