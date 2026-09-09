import Foundation
import XCTest
@testable import ILoveTrains

final class FeedbackBoundaryTests: XCTestCase {
    private let bodyLimit = 10_240
    private let messageLimit = 8192

    private func encodedLength(_ text: String) throws -> Int {
        try JSONSerialization.data(withJSONObject: [text]).count - 4
    }

    private func measuredEnvelope() async throws -> Int {
        try await send("x").count - 1
    }

    private func send(_ message: String) async throws -> Data {
        try await TransitAPI(session: BoundaryProtocol.session()).feedback(text: message, category: "problem")
        return try XCTUnwrap(BoundaryProtocol.bodies.last)
    }

    override func setUp() {
        super.setUp()
        BoundaryProtocol.reset()
    }

    func testTheLargestBodyTheCapAcceptsIsExactlyTheCapAndOneByteMoreIsRefused() async throws {
        let envelope = try await measuredEnvelope()
        let room = bodyLimit - envelope
        let message = String(repeating: "\"", count: room / 2) + String(repeating: "x", count: room % 2)
        XCTAssertLessThan(message.utf8.count, messageLimit)

        let body = try await send(message)
        XCTAssertEqual(body.count, bodyLimit)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(sent["feedback"], message)

        do {
            _ = try await send(message + "x")
            XCTFail("a body one byte past the cap reached the transport")
        } catch {
            XCTAssertEqual(error as? TransitError, .invalid)
        }
    }

    func testTheLargestMultiByteMessageFitsTheBodyCap() async throws {
        let message = String(repeating: "\u{1F682}", count: messageLimit / 4)
        XCTAssertEqual(message.utf8.count, messageLimit)

        try await TransitAPI(session: BoundaryProtocol.session()).feedback(text: message, category: "problem")

        XCTAssertLessThanOrEqual(try XCTUnwrap(BoundaryProtocol.bodies.last).count, bodyLimit)
    }

    func testEscapedWorstCasesAreRejectedByTheBodyCapNotTheMessageCap() async throws {
        let envelope = try await measuredEnvelope()
        for glyph in ["\"", "\\", "\n", "\u{2028}", "/"] {
            let message = "x" + String(repeating: glyph, count: (messageLimit - 2) / glyph.utf8.count) + "x"
            XCTAssertLessThanOrEqual(message.utf8.count, messageLimit)
            let overflows = try encodedLength(message) + envelope > bodyLimit
            do {
                try await TransitAPI(session: BoundaryProtocol.session()).feedback(text: message, category: "problem")
                XCTAssertFalse(overflows, "\(glyph.debugDescription) reached the transport past the body cap")
            } catch {
                XCTAssertTrue(overflows, "\(glyph.debugDescription) was rejected inside the body cap")
                XCTAssertEqual(error as? TransitError, .invalid)
            }
        }
    }
}

private final class BoundaryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [Data] = []

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        recorded = []
    }
    static var bodies: [Data] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BoundaryProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.lock()
        Self.recorded.append(request.httpBody ?? Self.drain(request.httpBodyStream))
        Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 201, httpVersion: nil, headerFields: nil)!,
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
