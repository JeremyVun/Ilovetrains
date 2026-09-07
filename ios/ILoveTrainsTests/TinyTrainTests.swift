import XCTest
@testable import ILoveTrains

final class TinyTrainTests: XCTestCase {
    func testTheToyReadsTheFlagsAnswerAndRequiresLiteralTrue() throws {
        func flag(_ raw: String) throws -> Bool { try TransitWire.flags(Data(raw.utf8))[tinyTrainFlagKey] == true }
        XCTAssertTrue(try flag(#"{"tiny_train":true,"unrelated":"value"}"#))
        for raw in ["{}", #"{"tiny_train":false}"#, #"{"tiny_train":"true"}"#, #"{"tiny_train":1}"#, #"{"tiny_train":null}"#] {
            XCTAssertFalse(try flag(raw), raw)
        }
        XCTAssertThrowsError(try flag("invalid JSON"))
    }

    func testTrainDoesNotMoveJourneyGeometry() {
        let a = Station(id: "a", name: "A"), b = Station(id: "b", name: "B"), c = Station(id: "c", name: "C")
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: a, to: b, departure: 1000, arrival: 2000),
                                     Leg(line: "T2", mode: "train", headsign: "C", from: b, to: c, departure: 2200, arrival: 3000)])
        let items: [AxisItem] = [.cap, .ride(0), .dwell(0), .ride(1), .board(0), .station(0)]
        let sizes = [CGSize(width: 60, height: 24), .zero, .zero, .zero, CGSize(width: 40, height: 24), CGSize(width: 90, height: 14)]
        for width: CGFloat in [346, 368] {
            let before = JourneyAxisGeometry(journey: journey, large: true, progress: nil, width: width, items: items, sizes: sizes)
            let after = JourneyAxisGeometry(journey: journey, large: true, progress: nil, width: width,
                                            items: items + [.tinyTrain], sizes: sizes + [CGSize(width: 0, height: 44)])
            XCTAssertEqual(before.size, after.size)
            XCTAssertEqual(before.frames, Array(after.frames.dropLast()))
            XCTAssertEqual(after.frames.last!.minY + 18, after.frames[1].minY)
            XCTAssertEqual(after.frames.last!.width, width - 60)
        }
    }

    /* One request per open, resume and tick feeds both flags. A second request
       for the toy, or a hardcoded host a local server can never drive, is the
       regression this guards. */
    func testOnlyTheAPIClientReachesTheFlagsEndpoint() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("ILoveTrains")
        let sources = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)!
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
        XCTAssertGreaterThan(sources.count, 10)
        for source in sources where source.lastPathComponent != "TransitAPI.swift" {
            XCTAssertFalse(try String(contentsOf: source, encoding: .utf8).contains("/api/v1/flags"), source.lastPathComponent)
        }
        let model = try String(contentsOf: root.appendingPathComponent("Core/TrainViewModel.swift"), encoding: .utf8)
        XCTAssertEqual(model.components(separatedBy: "api.flags()").count - 1, 1)
        XCTAssertEqual(model.components(separatedBy: "refreshFlags()").count - 1, 4, "the definition, the open, the resume and the tick")
        XCTAssertTrue(model.contains("state.tinyTrain = flags?[tinyTrainFlagKey] == true"))
        let appView = try String(contentsOf: root.appendingPathComponent("UI/AppView.swift"), encoding: .utf8)
        XCTAssertTrue(appView.contains(#".environment(\.tinyTrainFlag, model.state.tinyTrain)"#))
    }
}

/* Review probe: the toy follows only an answer fetched in this process, one
   request per open and per foreground return, none while paused. */
@MainActor
final class FlagsFetchProbeTests: XCTestCase {
    func testOneRequestPerOpenAndReturnAndTheToyNeverReadsTheStoredAnswer() async throws {
        FlagsProbeProtocol.reset()
        let from = Station(id: "a", name: "A"), to = Station(id: "b", name: "B")
        let trip = SavedTrip(id: "trip", from: from, to: to, createdAt: epochNow())
        let store = DeviceStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        try await store.save(UserData(trips: [trip], lastTripId: "trip", transferLimit: .two, flags: ["transferLimit": true, "tiny_train": true]))
        FlagsProbeProtocol.flags = (503, #"{"tiny_train":true,"transferLimit":true}"#)

        let model = TrainViewModel(store: store, api: TransitAPI(baseURL: "https://stub.invalid", session: FlagsProbeProtocol.session()))
        for _ in 0..<200 where !model.state.ready { try await Task.sleep(for: .milliseconds(10)) }
        for _ in 0..<300 where FlagsProbeProtocol.flagsRequests < 1 { try await Task.sleep(for: .milliseconds(10)) }
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(FlagsProbeProtocol.flagsRequests, 1, "I1 open: exactly one flags request")
        XCTAssertFalse(model.state.tinyTrain, "I2 stored true plus a 503 never shows the toy")
        XCTAssertEqual(model.state.flags["transferLimit"], true, "I2 the cap still reads the stored answer")

        func foreground(_ answer: (Int, String), expectRequests: Int) async throws {
            FlagsProbeProtocol.flags = answer
            model.pause(); model.resume()
            for _ in 0..<300 where FlagsProbeProtocol.flagsRequests < expectRequests { try await Task.sleep(for: .milliseconds(10)) }
            try await Task.sleep(for: .milliseconds(300))
            XCTAssertEqual(FlagsProbeProtocol.flagsRequests, expectRequests, "I1 one request per foreground return")
        }
        try await foreground((200, #"{"tiny_train":true,"transferLimit":true}"#), expectRequests: 2)
        XCTAssertTrue(model.state.tinyTrain, "I4 a true answer turns the toy on at the next fetch")
        try await foreground((503, #"{"tiny_train":true,"transferLimit":true}"#), expectRequests: 3)
        XCTAssertFalse(model.state.tinyTrain, "I7 a failed return fetch turns the toy off, not the previous in-process value")
        XCTAssertEqual(model.state.flags["transferLimit"], true)
        try await foreground((200, #"{"tiny_train":"true","transferLimit":true}"#), expectRequests: 4)
        XCTAssertFalse(model.state.tinyTrain, "I2 string true is not true")
        try await foreground((200, #"{"tiny_train":true,"transferLimit":false}"#), expectRequests: 5)
        XCTAssertTrue(model.state.tinyTrain)
        XCTAssertEqual(model.state.flags["transferLimit"], false, "the same answer moved the cap")

        model.pause()
        try await Task.sleep(for: .milliseconds(1500))
        XCTAssertEqual(FlagsProbeProtocol.flagsRequests, 5, "I1 nothing while backgrounded")
        XCTAssertEqual(FlagsProbeProtocol.paths.filter { $0 == "/api/v1/flags" }.count, FlagsProbeProtocol.flagsRequests)
    }
}

private final class FlagsProbeProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [String] = []
    private static var answer = (200, "{}")
    static var flags: (Int, String) {
        get { lock.lock(); defer { lock.unlock() }; return answer }
        set { lock.lock(); defer { lock.unlock() }; answer = newValue }
    }
    static var paths: [String] { lock.lock(); defer { lock.unlock() }; return recorded }
    static var flagsRequests: Int { paths.filter { $0 == "/api/v1/flags" }.count }
    static func reset() { lock.lock(); defer { lock.unlock() }; recorded = []; answer = (200, "{}") }
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FlagsProbeProtocol.self]
        return URLSession(configuration: configuration)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.lock()
        Self.recorded.append(url.path)
        let (status, body) = url.path == "/api/v1/flags" ? Self.answer
            : (200, #"{"from": {"id": "a", "name": "A"}, "to": {"id": "b", "name": "B"}, "generatedAt": "2026-09-07T09:00:00+10:00", "journeys": []}"#)
        Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
