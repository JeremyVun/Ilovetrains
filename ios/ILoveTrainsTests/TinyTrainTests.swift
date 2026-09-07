import XCTest
@testable import ILoveTrains

final class TinyTrainTests: XCTestCase {
    func testFlagRequiresLiteralTrue() throws {
        func flag(_ raw: String) throws -> Bool { try JSONDecoder().decode(TinyTrainFlags.self, from: Data(raw.utf8)).tinyTrain }
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

    func testFailedPublicResponsesDisableTheFeature() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [TinyTrainProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        for (status, body, expected) in [(200, #"{"tiny_train":true}"#, true),
                                          (503, #"{"tiny_train":true}"#, false),
                                          (200, "invalid JSON", false),
                                          (200, #"{"tiny_train":"true"}"#, false)] {
            TinyTrainProtocol.response = (status, body)
            let value = await fetchTinyTrainFlag(session: session)
            XCTAssertEqual(value, expected)
        }
    }
}

private final class TinyTrainProtocol: URLProtocol {
    static var response = (200, "{}")
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.url?.absoluteString, "https://ilovetrains.jeremyvun.com/api/v1/flags")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.response.0,
                                                             httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.response.1.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
