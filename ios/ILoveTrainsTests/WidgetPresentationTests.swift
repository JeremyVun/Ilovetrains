import Foundation
import XCTest
@testable import ILoveTrains

final class WidgetPresentationTests: XCTestCase {
    private let rhodes = Station(id: "213820", name: "Rhodes Station", modes: ["train"])
    private let townHall = Station(id: "200070", name: "Town Hall Station", modes: ["train"])
    private let bondi = Station(id: "202210", name: "Bondi Junction Station", modes: ["train"])
    private let now = (ISO8601DateFormatter().date(from: "2026-09-23T09:21:00+10:00")!.timeIntervalSince1970 * 1_000).rounded()

    func testRouteShortensBothNamesOneRuleAtATime() {
        let forms = widgetRouteForms(from: "North Strathfield", to: "Bondi Junction")
        XCTAssertEqual(forms.map(\.from), ["North Strathfield", "North Strathfield", "N Strathfield"])
        XCTAssertEqual(forms.map(\.to), ["Bondi Junction", "Bondi Jn", "Bondi Jn"])
        XCTAssertEqual(widgetRouteForms(from: "Rhodes", to: "Central").count, 1)
        XCTAssertEqual(widgetRouteForms(from: "Westmead", to: "Southern Cross (Melbourne)").count, 1, "only whole leading compass words shorten")
    }

    func testCountdownUsesPrintedClockMinutes() {
        XCTAssertEqual(widgetCountdown(to: now + 204_000, now: now + 36_000), WidgetCountdown(value: "3", unit: "min"))
        XCTAssertEqual(widgetCountdown(to: now + 30_000, now: now), WidgetCountdown(value: "Now", unit: ""))
        XCTAssertEqual(widgetCountdown(to: now + 99 * 60_000, now: now).value, "99")
        XCTAssertEqual(widgetCountdown(to: now + 150 * 60_000, now: now), WidgetCountdown(value: "3", unit: "H"))
    }

    func testScheduledOnlyFollowsTheBoardAndTheHeaderSkipsTheHorizon() {
        let timetabled = trip(departs: 3)
        var estimated = trip(departs: 45)
        estimated.legs[0].estimatedDeparture = estimated.legs[0].departure
        var late = trip(departs: 45)
        late.legs[0].estimatedDeparture = late.legs[0].departure + 300_000
        XCTAssertTrue(widgetScheduledOnly(timetabled, now: now, includesHorizon: false))
        XCTAssertTrue(widgetScheduledOnly(estimated, now: now, includesHorizon: true))
        XCTAssertFalse(widgetScheduledOnly(estimated, now: now, includesHorizon: false))
        XCTAssertFalse(widgetScheduledOnly(late, now: now, includesHorizon: true))
        XCTAssertEqual(widgetLateMinutes(late), 5)
    }

    func testStepsAndTheTrackerSentenceFollowTheRide() {
        let journey = changing()
        let steps = widgetSteps(journey)
        XCTAssertEqual(steps.map(\.kind), [.board, .getOff, .board, .arrive])
        XCTAssertEqual(steps.map(\.station), ["Rhodes", "Town Hall", "Town Hall", "Bondi Junction"])
        XCTAssertEqual(steps.map(\.platform), ["1", "3", "5", "2"])

        let before = content(journey, at: now)
        let boarding = widgetLockSentence(before)
        XCTAssertEqual(boarding.subject, "T9 leaves in ")
        XCTAssertEqual(boarding.deadline, journey.effectiveDeparture)
        XCTAssertEqual(boarding.instruction, [WidgetSentenceRun(text: "Go to "), WidgetSentenceRun(text: "Platform 1", strong: true)])
        XCTAssertEqual(boarding.arrival, "Bondi Junction about 10:08")
        XCTAssertEqual(widgetStatus(before), WidgetStatus(text: nil, pinned: true, warns: false))

        let riding = content(journey, at: now + 12 * 60_000)
        XCTAssertEqual(widgetNextStep(steps, now: riding.date), 1)
        let alighting = widgetLockSentence(riding)
        XCTAssertEqual(alighting.subject, "Town Hall in ")
        XCTAssertEqual(alighting.deadline, journey.legs[0].effectiveArrival)
        XCTAssertEqual(alighting.instruction.map(\.text).joined(), "Get off on Platform 3")
        XCTAssertEqual(widgetStatus(riding), WidgetStatus(text: "Running", pinned: true, warns: false))

        let changing = widgetLockSentence(content(journey, at: journey.legs[0].effectiveArrival + 60_000))
        XCTAssertEqual(changing.subject, "T4 leaves in ")
        XCTAssertEqual(changing.instruction.map(\.text).joined(), "Go to Platform 5")

        let arrived = content(journey, at: journey.effectiveArrival + 60_000)
        XCTAssertNil(widgetNextStep(steps, now: arrived.date))
        XCTAssertNil(widgetStatus(arrived), "the widget cannot know an arrival was confirmed, so it claims nothing")
    }

    func testEmptyAndMissingBoardsUseTheProductsOwnWords() {
        XCTAssertEqual(widgetLockSentence(WidgetContent(date: now)),
                       WidgetLockSentence(subject: "New trip", instruction: [WidgetSentenceRun(text: "Choose where you start")]))
        let trip = WidgetTrip(id: "a", from: WidgetStop(id: rhodes.id, name: rhodes.name, modes: ["train"]),
                              to: WidgetStop(id: bondi.id, name: bondi.name, modes: ["train"]))
        let answer = WidgetAnswer(trip: trip, reverse: false)
        let empty = BoardData(from: rhodes, to: bondi, generatedAt: now - 60_000, source: "live")
        let none = WidgetContent(date: now, answer: answer, board: empty, freshness: widgetFreshness(empty, lead: nil))
        XCTAssertEqual(widgetNoServiceText(none), "No services in the next few hours")
        XCTAssertEqual(widgetLockSentence(none).subject, "No services in the next few hours")
        XCTAssertEqual(widgetLockSentence(none).arrival, "Rhodes → Bondi Junction")
        let retained = retainedOfflineBoard(empty)
        XCTAssertEqual(widgetNoServiceText(WidgetContent(date: now, answer: answer, board: retained)),
                       "No services on the last board we could load")
    }

    func testOnlyMonochromeNamesATightChangeStillAhead() {
        let tight = changing(changeMinutes: 2)
        XCTAssertEqual(connectionStates(tight.legs), [.tight])
        XCTAssertTrue(widgetNamesTightChange(tight, now: now, monochrome: true))
        XCTAssertFalse(widgetNamesTightChange(tight, now: now, monochrome: false), "full colour keeps the paint only")
        XCTAssertFalse(widgetNamesTightChange(changing(), now: now, monochrome: true), "an ordinary change")
        XCTAssertTrue(widgetNamesTightChange(tight, now: tight.legs[0].effectiveArrival + 60_000, monochrome: true), "waiting at the change")
        XCTAssertFalse(widgetNamesTightChange(tight, now: tight.legs[1].effectiveDeparture, monochrome: true), "a change already made")
        var broken = tight
        broken.legs[1].cancelled = true
        XCTAssertFalse(widgetNamesTightChange(broken, now: now, monochrome: true), "a cancelled connection is broken, never tight")

        let lock = content(tight, at: now)
        let sentence = widgetLockSentence(lock)
        XCTAssertEqual(widgetLockFooter(lock, sentence: sentence, monochrome: true), "Tight change")
        XCTAssertEqual(widgetLockFooter(lock, sentence: sentence, monochrome: false), "Bondi Junction about 10:03")
        let ordinary = content(changing(), at: now)
        XCTAssertEqual(widgetLockFooter(ordinary, sentence: widgetLockSentence(ordinary), monochrome: true), "Bondi Junction about 10:08")
        var offline = lock
        offline.freshness = .offline(now - 19 * 60_000)
        let nbsp = "\u{00A0}"
        XCTAssertEqual(widgetLockFooter(offline, sentence: sentence, monochrome: true),
                       "Tight\(nbsp)change · Offline · Last\(nbsp)updated\(nbsp)09:02", "the line breaks only between clauses")
        XCTAssertEqual(widgetLockFooter(offline, sentence: sentence, monochrome: false), "Offline · Last updated 09:02")
    }

    private func trip(departs minutes: Double) -> Journey {
        Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Hornsby", from: rhodes, to: townHall,
                           departure: now + minutes * 60_000, arrival: now + (minutes + 27) * 60_000)])
    }

    private func changing(changeMinutes: Double = 7) -> Journey {
        Journey(legs: [
            Leg(line: "T9", mode: "train", headsign: "Gordon via Lindfield", from: rhodes, to: townHall,
                departure: now + 3 * 60_000, arrival: now + 30 * 60_000, fromPlatform: "1", toPlatform: "3"),
            Leg(line: "T4", mode: "train", headsign: "Bondi Junction", from: townHall, to: bondi,
                departure: now + (30 + changeMinutes) * 60_000, arrival: now + (40 + changeMinutes) * 60_000,
                fromPlatform: "5", toPlatform: "2"),
        ])
    }

    private func content(_ journey: Journey, at t: Millis) -> WidgetContent {
        let trip = WidgetTrip(id: "a", from: WidgetStop(id: rhodes.id, name: rhodes.name, modes: ["train"]),
                              to: WidgetStop(id: bondi.id, name: bondi.name, modes: ["train"]))
        let board = BoardData(from: rhodes, to: bondi, journeys: [journey], generatedAt: now, source: "live")
        let focus = WidgetFocus(tripId: "a", reverse: false, pinned: true, journey: journey, board: board, expiresAt: journey.effectiveArrival + 1_800_000)
        return WidgetContent(date: t, answer: WidgetAnswer(trip: trip, reverse: false, focus: focus), board: board, lead: journey,
                             freshness: .updated(now))
    }
}
