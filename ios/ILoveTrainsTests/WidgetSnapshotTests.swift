import Foundation
import XCTest
@testable import ILoveTrains

final class WidgetSnapshotTests: XCTestCase {
    private let rhodes = Station(id: "213820", name: "Rhodes Station", lat: -33.8308, lon: 151.0879, modes: ["train"])
    private let central = Station(id: "200060", name: "Central Station", lat: -33.884, lon: 151.206, modes: ["train", "metro"])
    private let manly = Station(id: "209530", name: "Manly Wharf", lat: -33.8, lon: 151.28, modes: ["ferry"])
    private let quay = Station(id: "200020", name: "Circular Quay", lat: -33.861, lon: 151.21, modes: ["train", "ferry"])

    private var commute: SavedTrip { SavedTrip(id: "commute", from: rhodes, to: central, createdAt: at("2026-09-01T07:00:00+10:00")) }
    private var weekend: SavedTrip { SavedTrip(id: "weekend", from: quay, to: manly, createdAt: at("2026-09-01T07:00:00+10:00")) }

    /// Weekday mornings out, weekday evenings back, weekend mornings on the ferry, over the two weeks before 25 September 2026.
    private func habits() -> UserData {
        var history: [ViewEvent] = []
        for day in 14...24 {
            let date = String(format: "2026-09-%02d", day)
            let weekday = sydneyCalendar.component(.weekday, from: Date(timeIntervalSince1970: at("\(date)T12:00:00+10:00") / 1_000))
            if weekday == 1 || weekday == 7 {
                history.append(ViewEvent(tripId: "weekend", reverse: false, at: at("\(date)T10:05:00+10:00")))
            } else {
                history.append(ViewEvent(tripId: "commute", reverse: false, at: at("\(date)T08:05:00+10:00")))
                history.append(ViewEvent(tripId: "commute", reverse: true, at: at("\(date)T17:35:00+10:00")))
            }
        }
        return UserData(trips: [commute, weekend], history: history)
    }

    func testScheduleIsAWeekOfHourlyNoLocationPredictionsAcrossMidnightAndTheWeekend() {
        let data = habits()
        let now = at("2026-09-25T22:40:00+10:00")
        let schedule = widgetSchedule(data: data, stations: [rhodes, central, quay, manly], now: now)

        XCTAssertEqual(schedule.count, 168)
        XCTAssertEqual(schedule.first?.at, at("2026-09-25T22:00:00+10:00"))
        XCTAssertTrue(zip(schedule, schedule.dropFirst()).allSatisfy { $1.at - $0.at == 3_600_000 })
        for entry in schedule {
            let predicted = predict(data: data, stations: [], fix: nil, now: entry.at)
            XCTAssertEqual(entry.tripId, predicted?.tripId)
            XCTAssertEqual(entry.reverse, predicted?.reverse)
        }
        XCTAssertEqual(entry(schedule, "2026-09-25T23:00:00+10:00")?.at, at("2026-09-25T23:00:00+10:00"))
        XCTAssertEqual(entry(schedule, "2026-09-26T00:00:00+10:00")?.at, at("2026-09-26T00:00:00+10:00"))
        XCTAssertEqual(pick(schedule, "2026-09-26T10:00:00+10:00"), "weekend:false")
        XCTAssertEqual(pick(schedule, "2026-09-27T10:00:00+10:00"), "weekend:false")
        XCTAssertEqual(pick(schedule, "2026-09-28T08:00:00+10:00"), "commute:false")
        XCTAssertEqual(pick(schedule, "2026-09-28T17:00:00+10:00"), "commute:true")
        XCTAssertEqual(pick(schedule, "2026-10-02T08:00:00+10:00"), "commute:false")
    }

    func testUnexpiredFocusWinsOverTheScheduleUntilItExpires() {
        let now = at("2026-09-28T08:00:00+10:00")
        let journey = service(rhodes, central, departs: now + 600_000, minutes: 25)
        var data = habits()
        data.focus = FocusedJourney(tripId: "commute", reverse: false, journey: journey,
                                    board: BoardData(from: rhodes, to: central, journeys: [journey], generatedAt: now, source: "live"))
        let schedule = widgetSchedule(data: data, stations: [], now: now)
        let snapshot = widgetSnapshot(data: data, schedule: schedule, boards: [], now: now)
        let expiry = journey.effectiveArrival + 1_800_000

        XCTAssertEqual(snapshot.focus?.expiresAt, expiry)
        XCTAssertEqual(widgetAnswer(snapshot, at: now)?.focus?.journey.key, journey.key)
        XCTAssertEqual(widgetAnswer(snapshot, at: expiry)?.focus?.journey.key, journey.key)
        XCTAssertNil(widgetAnswer(snapshot, at: expiry + 1)?.focus)
        XCTAssertEqual(widgetAnswer(snapshot, at: expiry + 1)?.trip.id, "commute")

        var weekendFocus = data
        let ferry = service(manly, quay, departs: now + 600_000, minutes: 20, mode: "ferry", line: "F1")
        weekendFocus.focus = FocusedJourney(tripId: "weekend", reverse: true, journey: ferry,
                                            board: BoardData(from: manly, to: quay, journeys: [ferry], generatedAt: now))
        let pinned = widgetSnapshot(data: weekendFocus, schedule: schedule, boards: [], now: now)
        XCTAssertEqual(widgetAnswer(pinned, at: now)?.trip.id, "weekend")
        XCTAssertEqual(widgetAnswer(pinned, at: now)?.from.id, manly.id)
        XCTAssertEqual(widgetAnswer(pinned, at: now)?.focus?.pinned, true)

        XCTAssertNil(widgetSnapshot(data: data, schedule: schedule, boards: [], now: expiry + 1).focus)
        var hidden = data
        hidden.modes = ["metro", "ferry"]
        XCTAssertNil(widgetSnapshot(data: hidden, schedule: schedule, boards: [], now: now).focus)
        var capped = weekendFocus
        capped.flags = [transferLimitFlagKey: true]
        capped.transferLimit = .direct
        capped.focus?.journey = Journey(legs: ferry.legs + ferry.legs)
        XCTAssertNil(widgetSnapshot(data: capped, schedule: schedule, boards: [], now: now).focus)
    }

    func testArmedFocusKeepsItsRetentionDeadline() {
        let now = at("2026-09-28T08:00:00+10:00")
        let journey = service(rhodes, central, departs: now - 3_600_000, minutes: 25)
        let focus = FocusedJourney(tripId: "commute", reverse: false, journey: journey,
                                   board: BoardData(from: rhodes, to: central, journeys: [journey], generatedAt: now),
                                   arrivalGuard: ArrivalGuard(armed: true, retainedAt: now - 60_000))
        XCTAssertEqual(widgetFocusExpiry(focus, now: now), now - 60_000 + 7_200_000)
        var confirmed = focus
        confirmed.arrivalGuard = ArrivalGuard(armed: true, retainedAt: now - 60_000, basis: .location, confirmedAt: now - 30_000)
        XCTAssertEqual(widgetFocusExpiry(confirmed, now: now), journey.effectiveArrival + 1_800_000)
    }

    func testPastTheScheduleEndTheSameWeekdayAndHourAnswers() {
        let data = habits()
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: at("2026-09-25T22:40:00+10:00")),
                                      boards: [], now: at("2026-09-25T22:40:00+10:00"))
        let end = snapshot.schedule.last!.at + 3_600_000
        XCTAssertEqual(end, at("2026-10-02T22:00:00+10:00"))

        for later in ["2026-10-05T08:30:00+11:00", "2026-10-12T17:10:00+11:00", "2026-10-03T10:15:00+10:00"] {
            let t = at(later)
            let expected = snapshot.schedule.first {
                let a = sydneyCalendar.dateComponents([.weekday, .hour], from: Date(timeIntervalSince1970: $0.at / 1_000))
                let b = sydneyCalendar.dateComponents([.weekday, .hour], from: Date(timeIntervalSince1970: t / 1_000))
                return a.weekday == b.weekday && a.hour == b.hour
            }
            XCTAssertNotNil(expected, later)
            XCTAssertEqual(widgetScheduleEntry(snapshot.schedule, at: t), expected, later)
        }
        XCTAssertEqual(widgetAnswer(snapshot, at: at("2026-10-05T08:30:00+11:00")).map { "\($0.trip.id):\($0.reverse)" }, "commute:false")
        XCTAssertEqual(widgetAnswer(snapshot, at: at("2026-10-10T10:20:00+11:00")).map { "\($0.trip.id):\($0.reverse)" }, "weekend:false")
    }

    func testDaylightSavingKeepsTheWeeklyAnswerOnLocalTime() {
        let data = habits()
        let start = at("2026-09-28T00:10:00+10:00")
        let schedule = widgetSchedule(data: data, stations: [], now: start)
        let mondayEight = schedule.first { $0.at == at("2026-09-28T08:00:00+10:00") }
        let mondaySeven = schedule.first { $0.at == at("2026-09-28T07:00:00+10:00") }
        // Clocks go forward on 4 October: 168 elapsed hours before 08:30 AEDT is 07:30 AEST.
        XCTAssertEqual(widgetScheduleEntry(schedule, at: at("2026-10-05T08:30:00+11:00")), mondayEight)
        XCTAssertNotEqual(mondayEight, mondaySeven)
    }

    func testFailedFetchFallsBackToTheAppsBoardWithRetainedProvenance() {
        let now = at("2026-09-28T08:00:00+10:00")
        let data = habits()
        let schedule = widgetSchedule(data: data, stations: [], now: now)
        let cached = BoardData(from: rhodes, to: central, journeys: [
            service(rhodes, central, departs: now - 300_000, minutes: 25),
            service(rhodes, central, departs: now + 240_000, minutes: 25),
            service(rhodes, central, departs: now + 840_000, minutes: 25),
        ], generatedAt: at("2026-09-28T07:50:00+10:00"), source: "live")
        let snapshot = widgetSnapshot(data: data, schedule: schedule, boards: [cached], now: now)
        XCTAssertEqual(snapshot.boards.first?.journeys.count, 2)

        let answer = widgetAnswer(snapshot, at: now)!
        let request = widgetRequest(for: answer, in: snapshot, now: now)
        XCTAssertEqual(request.modes, allModes)
        XCTAssertNil(request.transferLimit)
        XCTAssertNil(request.at)

        let failed = widgetContent(snapshot, sources: [request.key: widgetSource(request, fetched: nil)], at: now)
        XCTAssertEqual(failed.board?.offline, true)
        XCTAssertEqual(failed.lead?.retained, true)
        XCTAssertEqual(failed.lead?.effectiveDeparture, now + 240_000)
        XCTAssertEqual(failed.freshness?.text, "Offline · Last updated 07:50")
        XCTAssertEqual(failed.freshness?.warns, true)

        var live = cached
        live.generatedAt = at("2026-09-28T07:59:40+10:00")
        let fetched = widgetContent(snapshot, sources: [request.key: widgetSource(request, fetched: live)], at: now)
        XCTAssertEqual(fetched.freshness?.text, "Last updated 07:59")
        XCTAssertEqual(fetched.board?.offline, false)
        // An absolute clock time never goes stale the way a relative age does.
        XCTAssertEqual(widgetContent(snapshot, sources: [request.key: live], at: now + 1_800_000).freshness?.text, "Last updated 07:59")

        var scheduled = cached
        scheduled.source = "schedule"
        var timetable = snapshot
        timetable.boards = [scheduled]
        let timetableRequest = widgetRequest(for: answer, in: timetable, now: now)
        XCTAssertEqual(widgetContent(timetable, sources: [timetableRequest.key: widgetSource(timetableRequest, fetched: nil)], at: now)
            .freshness?.text, "Offline · timetable")

        var noBoard = snapshot
        noBoard.boards = []
        let bare = widgetRequest(for: answer, in: noBoard, now: now)
        let nothing = widgetContent(noBoard, sources: [bare.key: widgetSource(bare, fetched: nil)], at: now)
        XCTAssertEqual(nothing.answer?.trip.id, "commute")
        XCTAssertNil(nothing.lead)
        XCTAssertEqual(nothing.freshness?.text, "Offline")
        XCTAssertEqual(widgetNoServiceText(nothing), "No saved board for this trip yet")
        let unasked = widgetContent(noBoard, sources: [:], at: now)
        XCTAssertNil(unasked.freshness)
    }

    func testFocusedFetchFollowsTheServiceAndRetainsItWhenUnmatched() {
        let now = at("2026-09-28T08:20:00+10:00")
        let journey = service(rhodes, central, departs: now - 300_000, minutes: 25)
        var data = habits()
        data.modes = ["train"]
        data.flags = [transferLimitFlagKey: true]
        data.transferLimit = .direct
        data.focus = FocusedJourney(tripId: "commute", reverse: false, journey: journey,
                                    board: BoardData(from: rhodes, to: central, journeys: [journey],
                                                     generatedAt: at("2026-09-28T08:18:00+10:00"), source: "live"))
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: now), boards: [], now: now)
        let request = widgetRequest(for: widgetAnswer(snapshot, at: now)!, in: snapshot, now: now)
        XCTAssertEqual(request.modes, allModes)
        XCTAssertNil(request.transferLimit)
        XCTAssertEqual(request.at, journey.departure)

        var delayed = journey
        delayed.legs[0].estimatedDeparture = journey.departure + 120_000
        let board = BoardData(from: rhodes, to: central, journeys: [service(rhodes, central, departs: now, minutes: 25), delayed],
                              generatedAt: at("2026-09-28T08:19:50+10:00"), source: "live")
        let matched = widgetContent(snapshot, sources: [request.key: widgetSource(request, fetched: board)], at: now)
        XCTAssertEqual(matched.lead, delayed)
        XCTAssertEqual(matched.freshness?.text, "Last updated 08:19")
        XCTAssertEqual(widgetStatus(matched), WidgetStatus(text: "Running", pinned: true, warns: false))

        var gone = board
        gone.journeys = [service(rhodes, central, departs: now, minutes: 25)]
        let unmatched = widgetContent(snapshot, sources: [request.key: widgetSource(request, fetched: gone)], at: now)
        XCTAssertEqual(unmatched.lead?.key, journey.key)
        XCTAssertEqual(unmatched.lead?.retained, true)
        XCTAssertEqual(unmatched.freshness?.text, "Last known · Last updated 08:18")
        let failed = widgetContent(snapshot, sources: [request.key: widgetSource(request, fetched: nil)], at: now)
        XCTAssertEqual(failed.freshness?.text, "Offline · Last updated 08:18")
    }

    func testCappedPairRequestAndMinuteTimeline() {
        let now = at("2026-09-28T08:00:20+10:00")
        var data = habits()
        data.modes = ["train", "metro"]
        data.flags = [transferLimitFlagKey: true]
        data.transferLimit = .two
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: now), boards: [], now: now)
        let answer = widgetAnswer(snapshot, at: now)!
        let request = widgetRequest(for: answer, in: snapshot, now: now)
        XCTAssertEqual(request.modes, ["train", "metro"])
        XCTAssertEqual(request.transferLimit, 2)
        XCTAssertEqual(snapshot.transferCap, 2)
        XCTAssertEqual(snapshot.modes, ["train", "metro"])

        let minute = at("2026-09-28T08:00:00+10:00")
        let departures = [4, 11, 19, 26].map { service(rhodes, central, departs: minute + Millis($0) * 60_000, minutes: 25) }
        var cancelled = departures[0]
        cancelled.legs[0].cancelled = true
        let board = BoardData(from: rhodes, to: central, journeys: [cancelled] + Array(departures.dropFirst()),
                              generatedAt: now - 30_000, source: "live")
        let timeline = widgetTimeline(snapshot, sources: [request.key: board], from: now, until: now + 1_800_000)

        XCTAssertEqual(timeline.first?.date, now)
        let minutes = timeline.map(\.date).filter { $0 > now && $0.truncatingRemainder(dividingBy: 60_000) == 0 }
        XCTAssertEqual(minutes, (1...30).map { minute + Millis($0) * 60_000 })
        XCTAssertTrue(timeline.map(\.date).contains(minute + 660_001), "the lead moves on the moment it leaves")
        XCTAssertEqual(timeline.map(\.date), timeline.map(\.date).sorted())

        let first = timeline[0]
        XCTAssertEqual(first.lead?.effectiveDeparture, minute + 660_000)
        XCTAssertEqual(first.replaced?.key, cancelled.key)
        XCTAssertEqual(first.following.map(\.effectiveDeparture), [minute + 1_140_000, minute + 1_560_000])
        XCTAssertEqual(first.rows.map(\.effectiveDeparture), [minute + 240_000, minute + 660_000, minute + 1_140_000])
        XCTAssertEqual(widgetCountdown(to: first.lead!.effectiveDeparture, now: first.date), WidgetCountdown(value: "11", unit: "min"))

        let atEight03 = timeline.first { $0.date == minute + 180_000 }!
        XCTAssertEqual(widgetCountdown(to: atEight03.lead!.effectiveDeparture, now: atEight03.date).value, "8")
        let afterLead = timeline.first { $0.date == minute + 660_001 }!
        XCTAssertEqual(afterLead.lead?.effectiveDeparture, minute + 1_140_000)
        XCTAssertNil(afterLead.replaced)
        XCTAssertNil(timeline.last?.lead)
    }

    func testLeadIsTheHeadersRecommendationAndFollowingRowsStayChronological() {
        let now = at("2026-09-28T08:00:00+10:00")
        let data = habits()
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: now), boards: [], now: now)
        let answer = widgetAnswer(snapshot, at: now)!
        let request = widgetRequest(for: answer, in: snapshot, now: now)
        let allStops = service(rhodes, central, departs: now + 180_000, minutes: 40)
        let express = service(rhodes, central, departs: now + 360_000, minutes: 20)
        let later = service(rhodes, central, departs: now + 540_000, minutes: 40)
        let last = service(rhodes, central, departs: now + 900_000, minutes: 20)
        let board = BoardData(from: rhodes, to: central, journeys: [allStops, express, later, last], generatedAt: now, source: "live")

        let content = widgetContent(snapshot, sources: [request.key: board], at: now)
        let recommended = selectRecommendation(recommendationCandidates(board), now: now, modes: allModes, maxTransfers: nil)?.journey
        XCTAssertEqual(recommended?.key, express.key)
        XCTAssertEqual(content.lead?.key, express.key)
        XCTAssertNil(content.replaced, "an earlier running train is not a cancellation")
        XCTAssertEqual(content.rows.map(\.key), [express.key, later.key, last.key])
    }

    func testCancelledPinnedServiceNamesItsReplacement() {
        let now = at("2026-09-28T08:00:00+10:00")
        var pinned = service(rhodes, central, departs: now + 300_000, minutes: 25)
        var data = habits()
        data.focus = FocusedJourney(tripId: "commute", reverse: false, journey: pinned,
                                    board: BoardData(from: rhodes, to: central, journeys: [pinned], generatedAt: now, source: "live"))
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: now), boards: [], now: now)
        let request = widgetRequest(for: widgetAnswer(snapshot, at: now)!, in: snapshot, now: now)
        pinned.legs[0].cancelled = true
        let next = service(rhodes, central, departs: now + 1_200_000, minutes: 25)
        let board = BoardData(from: rhodes, to: central, journeys: [pinned, next], generatedAt: now, source: "live")

        let content = widgetContent(snapshot, sources: [request.key: widgetSource(request, fetched: board)], at: now)
        XCTAssertEqual(content.lead?.key, next.key)
        XCTAssertEqual(content.replaced?.key, pinned.key)
        XCTAssertEqual(widgetStatus(content), WidgetStatus(text: "Cancelled", pinned: false, warns: true))
        let lock = widgetLockSentence(content)
        XCTAssertEqual(lock.subject, "T9 leaves in ")
        XCTAssertEqual(lock.deadline, next.effectiveDeparture)
        XCTAssertEqual(lock.instruction.map(\.text).joined(), "08:05 cancelled · next train")
    }

    func testNoCompatibleTripIsTheEmptyState() {
        let now = at("2026-09-28T08:00:00+10:00")
        var data = habits()
        data.modes = ["metro"]
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: now), boards: [], now: now)
        XCTAssertTrue(snapshot.trips.isEmpty)
        XCTAssertTrue(snapshot.schedule.isEmpty)
        XCTAssertNil(widgetAnswer(snapshot, at: now))
        XCTAssertNil(widgetContent(snapshot, sources: [:], at: now).answer)
        XCTAssertTrue(widgetRequests(snapshot, from: now, until: now + widgetTimelineHorizon).isEmpty)

        let none = widgetSnapshot(data: UserData(), schedule: widgetSchedule(data: UserData(), stations: [], now: now), boards: [], now: now)
        XCTAssertTrue(none.schedule.isEmpty)
        XCTAssertNil(widgetAnswer(none, at: now))
    }

    func testSnapshotCarriesNothingPersonalBeyondTripsModesAndCap() throws {
        let now = at("2026-09-28T08:00:00+10:00")
        let home = Station(id: "999001", name: "Secret Home Station", lat: -33.9, lon: 151.1)
        var data = habits()
        data.rides = [Ride(tripId: "commute", reverse: false, departure: now - 86_400_000, arrival: now - 85_000_000, from: rhodes, to: central)]
        data.votes = [HomeVote(day: "2026-09-27", station: home)]
        data.home = home
        data.recentFrom = [home]
        data.recentTo = [home]
        data.useLocation = false
        data.appearance = .dark
        data.journeyAlerts = false
        data.lastTripId = "commute"
        let board = BoardData(from: rhodes, to: central, journeys: [service(rhodes, central, departs: now + 300_000, minutes: 25)],
                              generatedAt: now, source: "live")
        data.lastAnswer = LastAnswer(tripId: "commute", reverse: false, at: now, stationId: home.id, board: board, journey: board.journeys[0])
        let snapshot = widgetSnapshot(data: data, schedule: widgetSchedule(data: data, stations: [], now: now), boards: [board], now: now)
        let encoded = try JSONEncoder().encode(snapshot)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

        XCTAssertEqual(Set(object.keys), ["schemaVersion", "writtenAt", "trips", "schedule", "modes", "boards"])
        XCTAssertTrue(keys(in: object).isDisjoint(with: [
            "history", "rides", "votes", "home", "recentFrom", "recentTo", "useLocation", "appearance",
            "journeyAlerts", "lastAnswer", "lastTripId", "lastReverse", "flags", "transferLimit", "arrivalGuard", "stationId",
        ]))
        let text = String(decoding: encoded, as: UTF8.self)
        XCTAssertFalse(text.contains(home.id))
        XCTAssertFalse(text.contains("Secret Home"))
        let trips = try XCTUnwrap(object["trips"] as? [[String: Any]])
        XCTAssertEqual(Set(trips[0].keys), ["id", "from", "to"])
        XCTAssertEqual(Set((trips[0]["from"] as? [String: Any] ?? [:]).keys), ["id", "name", "modes"])
        XCTAssertEqual(try JSONDecoder().decode(WidgetSnapshot.self, from: encoded), snapshot)
    }

    func testStoreWritesChangesAndAsksForRedrawOnlyWhenTheAnswerChanges() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let now = at("2026-09-28T08:00:00+10:00")
        let data = habits()
        let schedule = widgetSchedule(data: data, stations: [], now: now)
        let board = BoardData(from: rhodes, to: central, journeys: [service(rhodes, central, departs: now + 300_000, minutes: 25)],
                              generatedAt: now, source: "live")
        let first = widgetSnapshot(data: data, schedule: schedule, boards: [board], now: now)

        let wroteFirst = try await store.saveWidget(first)
        XCTAssertTrue(wroteFirst)
        XCTAssertEqual(readWidgetSnapshot(directory: directory), first)

        let same = try await store.saveWidget(widgetSnapshot(data: data, schedule: schedule, boards: [board], now: now + 5_000))
        XCTAssertFalse(same)
        XCTAssertEqual(readWidgetSnapshot(directory: directory)?.writtenAt, now)

        var fresher = board
        fresher.generatedAt = now + 30_000
        let boardOnly = try await store.saveWidget(widgetSnapshot(data: data, schedule: schedule, boards: [fresher], now: now + 30_000))
        XCTAssertFalse(boardOnly)
        XCTAssertEqual(readWidgetSnapshot(directory: directory)?.boards.first?.generatedAt, now + 30_000)

        var hidden = data
        hidden.modes = ["train", "metro"]
        let answerChanged = try await store.saveWidget(widgetSnapshot(data: hidden, schedule: schedule, boards: [fresher], now: now + 60_000))
        XCTAssertTrue(answerChanged)
    }

    private func service(_ from: Station, _ to: Station, departs: Millis, minutes: Double, mode: String = "train", line: String = "T9") -> Journey {
        Journey(legs: [Leg(line: line, mode: mode, headsign: to.name, from: from, to: to,
                           departure: departs, arrival: departs + minutes * 60_000)])
    }

    private func entry(_ schedule: [WidgetScheduleEntry], _ time: String) -> WidgetScheduleEntry? {
        widgetScheduleEntry(schedule, at: at(time))
    }

    private func pick(_ schedule: [WidgetScheduleEntry], _ time: String) -> String? {
        entry(schedule, time).map { "\($0.tripId):\($0.reverse)" }
    }

    private func keys(in value: Any) -> Set<String> {
        if let object = value as? [String: Any] {
            return object.reduce(into: Set(object.keys)) { $0.formUnion(keys(in: $1.value)) }
        }
        if let array = value as? [Any] { return array.reduce(into: Set<String>()) { $0.formUnion(keys(in: $1)) } }
        return []
    }
}

private func at(_ value: String) -> Millis {
    (ISO8601DateFormatter().date(from: value)!.timeIntervalSince1970 * 1_000).rounded()
}
