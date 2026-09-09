import Foundation
import XCTest
@testable import ILoveTrains

final class FeedbackRequestTests: XCTestCase {
    override func setUp() {
        super.setUp()
        FeedbackProtocol.reset()
    }

    func testFeedbackNamesThePlatformAndTheBundleVersion() async throws {
        let api = TransitAPI(session: FeedbackProtocol.session())

        try await api.feedback(text: "  The board froze on the platform.  ", category: "suggestion")

        let request = try XCTUnwrap(FeedbackProtocol.requests.last)
        XCTAssertEqual(request.url?.absoluteString, "https://analytics.jeremyvun.com/feedback")
        XCTAssertEqual(request.method, "POST")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: String])
        XCTAssertEqual(Set(sent.keys), ["project", "category", "feedback", "platform", "clientVersion"])
        XCTAssertEqual(sent["project"], "ilovetrains")
        XCTAssertEqual(sent["category"], "suggestion")
        XCTAssertEqual(sent["feedback"], "The board froze on the platform.")
        XCTAssertEqual(sent["platform"], "ios")
        XCTAssertEqual(sent["clientVersion"], Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        XCTAssertEqual(sent["clientVersion"]?.split(separator: ".").count, 3)
    }

    func testFeedbackFailsWhenTheServiceDoesNotCreateTheRecord() async {
        FeedbackProtocol.status = 200
        let api = TransitAPI(session: FeedbackProtocol.session())

        do {
            try await api.feedback(text: "Accepted is not created.", category: "problem")
            XCTFail("a non-201 answer was treated as a sent message")
        } catch {
            XCTAssertEqual(error as? TransitError, .unavailable)
        }
    }

    func testOversizedOrEmptyFeedbackNeverReachesTheTransport() async {
        let api = TransitAPI(session: FeedbackProtocol.session())

        for text in ["   ", String(repeating: "x", count: 8193)] {
            do {
                try await api.feedback(text: text, category: "problem")
                XCTFail("invalid feedback reached the transport")
            } catch {
                XCTAssertEqual(error as? TransitError, .invalid)
            }
        }
        XCTAssertTrue(FeedbackProtocol.requests.isEmpty)
    }
}

private struct SentRequest {
    let url: URL?
    let method: String?
    let body: Data
}

private final class FeedbackProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [SentRequest] = []
    private static var answer = 201

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        recorded = []
        answer = 201
    }
    static var status: Int {
        get { lock.lock(); defer { lock.unlock() }; return answer }
        set { lock.lock(); defer { lock.unlock() }; answer = newValue }
    }
    static var requests: [SentRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FeedbackProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.lock()
        // URLSession moves the body to a stream before the protocol sees the request.
        Self.recorded.append(SentRequest(url: url, method: request.httpMethod, body: request.httpBody ?? Self.drain(request.httpBodyStream)))
        let status = Self.answer
        Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    private static func drain(_ stream: InputStream?) -> Data {
        guard let stream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
