import Foundation
import XCTest
@testable import ILoveTrains

@MainActor
final class TransferLimitRequestTests: XCTestCase {
    private let from = Station(id: "a", name: "A")
    private let to = Station(id: "b", name: "B")

    override func setUp() {
        super.setUp()
        RecordingProtocol.reset()
    }

    func testDeparturesSendsTheCapOnlyWhenItIsGiven() async throws {
        let api = TransitAPI(baseURL: "https://stub.invalid", session: RecordingProtocol.session())

        _ = try await api.departures(from: from, to: to, modes: allModes)
        _ = try await api.departures(from: from, to: to, modes: allModes, transferLimit: 2)

        let requests = RecordingProtocol.urls.map(\.absoluteString)
        XCTAssertEqual(requests.count, 2)
        XCTAssertFalse(requests[0].contains("transferLimit"))
        XCTAssertTrue(requests[1].contains("transferLimit=2"))
    }

    func testFlagsKeepBooleansAndDropEverythingElse() async throws {
        RecordingProtocol.respond { _ in
            Data(#"{"version": "v1", "flags": {"transferLimit": true, "off": false, "count": 1, "text": "true"}}"#.utf8)
        }
        let api = TransitAPI(baseURL: "https://stub.invalid", session: RecordingProtocol.session())

        let flags = try await api.flags()

        XCTAssertEqual(RecordingProtocol.urls.map(\.path), ["/api/v1/flags"])
        XCTAssertEqual(flags, ["transferLimit": true, "off": false])
        XCTAssertEqual(try TransitWire.flags(Data(#"{"version": ""}"#.utf8)), [:])
        XCTAssertEqual(try TransitWire.flags(Data(#"{"flags": ["transferLimit"]}"#.utf8)), [:])
        XCTAssertThrowsError(try TransitWire.flags(Data("[]".utf8)))
    }

    func testCappedBoardRequestsCarryTheCapAndTheFocusRefreshNeverDoes() async throws {
        let now = epochNow()
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: from, to: to,
                                        departure: now - 300_000, arrival: now + 900_000)])
        let trip = SavedTrip(id: "trip", from: from, to: to, createdAt: now)
        let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: now, source: "live")
        let data = UserData(trips: [trip], lastTripId: "trip",
                            focus: FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board),
                            transferLimit: .two, flags: ["transferLimit": true])
        let store = DeviceStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        try await store.save(data)

        let model = TrainViewModel(store: store, api: TransitAPI(baseURL: "https://stub.invalid", session: RecordingProtocol.session()))
        for _ in 0..<200 where !model.state.ready { try await Task.sleep(for: .milliseconds(10)) }
        model.resume()
        for _ in 0..<300 where RecordingProtocol.departures().count < 2 { try await Task.sleep(for: .milliseconds(10)) }

        let departures = RecordingProtocol.departures()
        let focusRequest = try XCTUnwrap(departures.first { $0.contains("at=") })
        let boardRequest = try XCTUnwrap(departures.first { !$0.contains("at=") })
        XCTAssertFalse(focusRequest.contains("transferLimit"))
        XCTAssertTrue(boardRequest.contains("transferLimit=2"))
        XCTAssertTrue(RecordingProtocol.urls.contains { $0.path == "/api/v1/flags" })
        model.pause()
    }
}

private final class RecordingProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [URL] = []
    private static var responder: (URL) -> Data = defaultBody

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        recorded = []
        responder = defaultBody
    }
    static func respond(_ body: @escaping (URL) -> Data) {
        lock.lock(); defer { lock.unlock() }
        responder = body
    }
    static var urls: [URL] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
    static func departures() -> [String] {
        urls.filter { $0.path == "/api/v1/departures" }.map(\.absoluteString)
    }
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecordingProtocol.self]
        return URLSession(configuration: configuration)
    }

    private static let defaultBody: (URL) -> Data = { url in
        url.path == "/api/v1/flags"
            ? Data(#"{"version": "v1", "flags": {"transferLimit": true}}"#.utf8)
            : Data(#"{"from": {"id": "a", "name": "A"}, "to": {"id": "b", "name": "B"}, "generatedAt": "2026-09-07T09:00:00+10:00", "journeys": []}"#.utf8)
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
