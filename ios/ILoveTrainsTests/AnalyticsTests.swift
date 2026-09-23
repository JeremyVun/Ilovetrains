import Foundation
import Network
import XCTest
@testable import ILoveTrains

final class MemoryAnalyticsStore: AnalyticsStore {
    var data: Data?
    var reads = 0
    var writes = 0

    init(_ text: String? = nil) { data = text.map { Data($0.utf8) } }

    func read() throws -> Data? { reads += 1; return data }
    func write(_ data: Data) throws { writes += 1; self.data = data }

    var stored: AnalyticsState? { parseAnalyticsStore(data) }
    var queue: [AnalyticsEntry] { stored?.queue ?? [] }
}

final class AnalyticsPosts {
    var accepted = true
    var holding = false
    var urls: [URL] = []
    var bodies: [Data] = []
    private var held: [(Bool) -> Void] = []

    func post(_ url: URL, _ body: Data, _ done: @escaping (Bool) -> Void) {
        urls.append(url); bodies.append(body)
        if holding { held.append(done) } else { done(accepted) }
    }

    func answer() {
        let pending = held
        held = []
        pending.forEach { $0(accepted) }
    }

    func sent(_ index: Int) throws -> [[String: Any]] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: bodies[index]) as? [[String: Any]])
    }
}

final class AnalyticsTimers {
    var tasks: [() -> Void] = []
}

func makeAnalytics(
    debug: Bool = false,
    store: AnalyticsStore = MemoryAnalyticsStore(),
    posts: AnalyticsPosts = AnalyticsPosts(),
    timers: AnalyticsTimers = AnalyticsTimers(),
    capture: String? = nil
) -> Analytics {
    Analytics(debug: debug, endpoint: analyticsEndpoint(debug: debug, capture: capture), store: store,
              post: posts.post, worker: { $0() }, later: { _, task in timers.tasks.append(task) })
}

func iosDims(_ u: String, _ own: [String: String] = [:]) -> [String: String] {
    ["u": u, "pl": "ios", "pl.u": "ios.\(u)"].merging(own) { first, _ in first }
}

final class AnalyticsTests: XCTestCase {
    func testBandsAndMilestonesFollowTheContractTable() {
        let bands = [0: "1", 1: "1", 2: "2-5", 5: "2-5", 6: "6-10", 10: "6-10", 11: "11-15", 15: "11-15",
                     16: "16-20", 46: "46-50", 50: "46-50", 51: "51+", 5000: "51+"]
        for (opens, band) in bands { XCTAssertEqual(usageBand(opens: opens), band, "opens \(opens)") }
        XCTAssertEqual((0...300).compactMap { openMilestone(opens: $0) },
                       ["1", "5", "10", "15", "20", "25", "30", "40", "50", "75", "100", "150", "200", "250"])
    }

    func testTheNativeVocabularyIsClosedAndCarriesNoExperiment() {
        let kinds = ["predicted", "focus", "usual", "home", "pair", "inferred"]
        let expected = Set(kinds.flatMap { k in ["shown_\(k)", "hit_\(k)", "miss_\(k)", "pinned_\(k)"] })
            .union(["opened", "rode_pin", "rode_auto"])
        XCTAssertEqual(analyticsEventNames, expected)
        XCTAssertTrue(validAnalyticsEvent("shown_pair", iosDims("6-10")))
        XCTAssertFalse(validAnalyticsEvent("shown_setup", iosDims("1", ["f": "empty"])))
        XCTAssertFalse(validAnalyticsEvent("change_inferred", iosDims("1")))
        XCTAssertFalse(validAnalyticsEvent("shown_home", iosDims("6-10", ["x.strip-placement": "a3"])))
        XCTAssertFalse(validAnalyticsEvent("shown_home", ["u": "6-10", "pl": "web", "pl.u": "web.6-10"]))
        XCTAssertFalse(validAnalyticsEvent("shown_home", ["u": "6-10", "pl": "ios", "pl.u": "ios.2-5"]))
        XCTAssertFalse(validAnalyticsEvent("shown_home", ["u": "7", "pl": "ios", "pl.u": "ios.7"]))
        XCTAssertTrue(validAnalyticsEvent("pinned_usual", iosDims("1", ["r": "service", "pl.r": "ios.service"])))
        XCTAssertFalse(validAnalyticsEvent("pinned_usual", iosDims("1", ["r": "service"])))
        XCTAssertFalse(validAnalyticsEvent("pinned_usual", iosDims("1", ["r": "wrong", "pl.r": "ios.wrong"])))
        XCTAssertTrue(validAnalyticsEvent("rode_auto", iosDims("1", ["b": "location", "pl.b": "ios.location"])))
        XCTAssertFalse(validAnalyticsEvent("rode_auto", iosDims("1", ["b": "location", "pl.b": "android.location"])))
        XCTAssertFalse(validAnalyticsEvent("opened", iosDims("1", ["m": "3"])))
        XCTAssertFalse(validAnalyticsEvent("hit_focus", iosDims("1", ["m": "1"])))
    }

    func testEqualEventsCompactIntoOneCountedEntryInFirstRecordedOrder() {
        let store = MemoryAnalyticsStore()
        let analytics = makeAnalytics(store: store)
        analytics.shown(.usual)
        analytics.miss(.usual)
        analytics.shown(.usual)
        analytics.shown(.usual)
        analytics.pinned(.usual, .service)
        analytics.pinned(.usual, .same)
        analytics.pinned(.usual, .service)
        XCTAssertEqual(store.queue, [
            AnalyticsEntry(t: "shown_usual", d: iosDims("1"), n: 3),
            AnalyticsEntry(t: "miss_usual", d: iosDims("1"), n: 1),
            AnalyticsEntry(t: "pinned_usual", d: iosDims("1", ["r": "service", "pl.r": "ios.service"]), n: 2),
            AnalyticsEntry(t: "pinned_usual", d: iosDims("1", ["r": "same", "pl.r": "ios.same"]), n: 1)
        ])
    }

    func testTheQueueKeepsTheNewestTwoHundredEntries() {
        let seeded = distinctEntries(analyticsQueueCap)
        let store = MemoryAnalyticsStore(String(decoding: analyticsStoreData(AnalyticsState(opens: 60, queue: seeded)), as: UTF8.self))
        let analytics = makeAnalytics(store: store)
        analytics.rode(pinned: true, basis: .estimate)
        let queue = store.queue
        XCTAssertEqual(queue.count, analyticsQueueCap)
        XCTAssertEqual(Array(queue.dropLast()), Array(seeded.dropFirst()))
        XCTAssertEqual(queue.last, AnalyticsEntry(t: "rode_pin", d: iosDims("51+", ["b": "estimate", "pl.b": "ios.estimate"]), n: 1))
    }

    func testACompactedCountSaturatesAtTheCollectorCeiling() {
        let full = AnalyticsEntry(t: "shown_home", d: iosDims("1"), n: analyticsCountCap - 1)
        let store = MemoryAnalyticsStore(String(decoding: analyticsStoreData(AnalyticsState(queue: [full])), as: UTF8.self))
        let analytics = makeAnalytics(store: store)
        for _ in 0..<3 { analytics.shown(.home) }
        XCTAssertEqual(store.queue, [AnalyticsEntry(t: "shown_home", d: iosDims("1"), n: analyticsCountCap)])
    }

    func testASuccessfulPostSettlesOnlyTheSnapshotItSent() throws {
        let store = MemoryAnalyticsStore()
        let posts = AnalyticsPosts()
        posts.holding = true
        let analytics = makeAnalytics(store: store, posts: posts)
        analytics.shown(.predicted)
        analytics.shown(.predicted)
        var flushed = 0
        analytics.flush { flushed += 1 }
        XCTAssertEqual(posts.bodies.count, 1)
        analytics.shown(.predicted)
        analytics.hit(.predicted)
        analytics.flush { flushed += 1 }
        XCTAssertEqual(posts.bodies.count, 1, "one request is in flight at a time")
        XCTAssertEqual(flushed, 0, "a flush completes only once its request has settled")
        posts.answer()
        XCTAssertEqual(flushed, 2)

        let sent = try posts.sent(0)
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(Set(sent[0].keys), ["p", "t", "d", "n"])
        XCTAssertEqual(sent[0]["p"] as? String, "ilovetrains")
        XCTAssertEqual(sent[0]["t"] as? String, "shown_predicted")
        XCTAssertEqual(sent[0]["d"] as? [String: String], iosDims("1"))
        XCTAssertEqual(sent[0]["n"] as? Int, 2)
        XCTAssertEqual(posts.urls, [analyticsProductionEndpoint])
        XCTAssertEqual(store.queue, [AnalyticsEntry(t: "shown_predicted", d: iosDims("1"), n: 1),
                                     AnalyticsEntry(t: "hit_predicted", d: iosDims("1"), n: 1)])
    }

    func testARefusedPostKeepsEveryCount() {
        let store = MemoryAnalyticsStore()
        let posts = AnalyticsPosts()
        posts.accepted = false
        let analytics = makeAnalytics(store: store, posts: posts)
        analytics.shown(.focus)
        analytics.flush()
        XCTAssertEqual(store.queue, [AnalyticsEntry(t: "shown_focus", d: iosDims("1"), n: 1)])
        posts.accepted = true
        analytics.flush()
        XCTAssertEqual(store.queue, [])
        XCTAssertEqual(posts.bodies.count, 2)
        var finished = false
        analytics.flush { finished = true }
        XCTAssertTrue(finished, "an empty queue completes a flush at once")
        XCTAssertEqual(posts.bodies.count, 2)
    }

    func testTheFirstEventOfAForegroundSessionSchedulesOneFlushAndReturningSendsLeftovers() {
        let store = MemoryAnalyticsStore()
        let posts = AnalyticsPosts()
        posts.accepted = false
        let timers = AnalyticsTimers()
        let analytics = makeAnalytics(store: store, posts: posts, timers: timers)
        analytics.shown(.usual)
        analytics.hit(.usual)
        XCTAssertEqual(timers.tasks.count, 1)
        timers.tasks[0]()
        XCTAssertEqual(posts.bodies.count, 1)
        analytics.foreground()
        XCTAssertEqual(posts.bodies.count, 2, "a foreground entry sends what is still queued")
        analytics.miss(.usual)
        XCTAssertEqual(timers.tasks.count, 2)
        posts.accepted = true
        analytics.flush()
        XCTAssertEqual(store.queue, [])
        analytics.foreground()
        XCTAssertEqual(posts.bodies.count, 3, "nothing queued, nothing sent")
    }

    func testAMalformedStoreIsDroppedWhole() {
        let valid = #"{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10"},"n":4}"#
        let malformed = [
            "not json",
            "[]",
            #"{"opens":7}"#,
            #"{"opens":-1,"queue":[]}"#,
            #"{"opens":2.5,"queue":[]}"#,
            #"{"opens":"7","queue":[]}"#,
            #"{"opens":true,"queue":[]}"#,
            #"{"opens":7,"queue":[],"bucket":3}"#,
            #"{"opens":7,"queue":{}}"#,
            #"{"opens":7,"queue":[\#(valid),{"t":"change_inferred","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10"},"n":1}]}"#,
            #"{"opens":7,"queue":[\#(valid),{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10","x.strip-placement":"a3"},"n":1}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10"},"n":1}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10"},"n":1}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10"},"n":0}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10"},"n":1000001}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10"},"n":true}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10"},"n":1,"p":"ilovetrains"}]}"#,
            #"{"opens":7,"queue":[{"t":"pinned_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10","r":"same"},"n":1}]}"#,
            #"{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"ios","pl.u":"ios.6-10","n":1},"n":1}]}"#
        ]
        for text in malformed {
            XCTAssertNil(parseAnalyticsStore(Data(text.utf8)), text)
            let store = MemoryAnalyticsStore(text)
            makeAnalytics(store: store).recordOpen()
            XCTAssertEqual(store.stored, AnalyticsState(opens: 1, queue: [AnalyticsEntry(t: "opened", d: iosDims("1", ["m": "1"]), n: 1)]), text)
        }
        XCTAssertEqual(parseAnalyticsStore(Data(#"{"opens":7,"queue":[\#(valid)]}"#.utf8)),
                       AnalyticsState(opens: 7, queue: [AnalyticsEntry(t: "shown_home", d: iosDims("6-10"), n: 4)]))
        XCTAssertEqual(parseAnalyticsStore(nil), AnalyticsState())
    }

    func testTheFileStoreRoundTripsOutsideBackup() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent(analyticsStoreName)
        XCTAssertNil(try FileAnalyticsStore(url: url).read())
        let analytics = makeAnalytics(store: FileAnalyticsStore(url: url))
        analytics.recordOpen()
        analytics.shown(.predicted)
        makeAnalytics(store: FileAnalyticsStore(url: url)).recordOpen()
        let state = try XCTUnwrap(parseAnalyticsStore(Data(contentsOf: url)))
        XCTAssertEqual(state.opens, 2)
        XCTAssertEqual(state.queue.map(\.t), ["opened", "shown_predicted"])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [analyticsStoreName])
        XCTAssertEqual(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        XCTAssertEqual(FileAnalyticsStore().url.deletingLastPathComponent(),
                       FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
    }

    func testADebugBuildKeepsALedgerAndNeverPersistsOrSends() {
        let store = MemoryAnalyticsStore(#"{"opens":40,"queue":[]}"#)
        let posts = AnalyticsPosts()
        let timers = AnalyticsTimers()
        let analytics = makeAnalytics(debug: true, store: store, posts: posts, timers: timers)
        XCTAssertFalse(analytics.enabled)
        analytics.recordOpen()
        analytics.shown(.home)
        analytics.rode(pinned: false, basis: .location)
        analytics.flush(); analytics.foreground()
        XCTAssertEqual(analytics.ledger, [
            AnalyticsEvent(t: "opened", d: iosDims("1", ["m": "1"])),
            AnalyticsEvent(t: "shown_home", d: iosDims("1")),
            AnalyticsEvent(t: "rode_auto", d: iosDims("1", ["b": "location", "pl.b": "ios.location"]))
        ])
        XCTAssertEqual(store.reads + store.writes, 0)
        XCTAssertTrue(posts.bodies.isEmpty)
        XCTAssertTrue(timers.tasks.isEmpty)
    }

    func testOnlyADebugBuildHonoursTheCaptureOverride() throws {
        let capture = "http://127.0.0.1:9000/e"
        XCTAssertEqual(analyticsEndpoint(debug: false), analyticsProductionEndpoint)
        XCTAssertEqual(analyticsEndpoint(debug: false, capture: capture), analyticsProductionEndpoint)
        XCTAssertNil(analyticsEndpoint(debug: true))
        XCTAssertNil(analyticsEndpoint(debug: true, capture: "not a url"))
        XCTAssertNil(analyticsEndpoint(debug: true, capture: "file:///tmp/e"))
        XCTAssertEqual(analyticsEndpoint(debug: true, capture: " \(capture) ")?.absoluteString, capture)

        let releasePosts = AnalyticsPosts()
        let release = makeAnalytics(debug: false, posts: releasePosts)
        release.capture(to: capture)
        release.shown(.usual); release.flush()
        XCTAssertEqual(releasePosts.urls, [analyticsProductionEndpoint])
        XCTAssertTrue(release.ledger.isEmpty, "release keeps no ledger")

        let store = MemoryAnalyticsStore()
        let debugPosts = AnalyticsPosts()
        let debug = makeAnalytics(debug: true, store: store, posts: debugPosts)
        debug.shown(.usual); debug.flush()
        XCTAssertTrue(debugPosts.urls.isEmpty)
        debug.capture(to: capture)
        XCTAssertTrue(debug.enabled)
        debug.shown(.usual); debug.flush()
        XCTAssertEqual(debugPosts.urls.map(\.absoluteString), [capture])
        XCTAssertEqual(try debugPosts.sent(0).count, 1)
        XCTAssertEqual(debug.ledger.map(\.t), ["shown_usual", "shown_usual"])
    }

    func testTheBuildThisSuiteRunsInNeverSendsWithoutTheOverride() async throws {
        try XCTSkipUnless(analyticsDebugBuild, "only a debug build's tests exercise this path")
        if ProcessInfo.processInfo.environment[analyticsURLEnvironmentKey] == nil {
            XCTAssertFalse(Analytics.shared.enabled)
        }
        let store = MemoryAnalyticsStore()
        let posts = AnalyticsPosts()
        let analytics = Analytics.live(store: store, post: posts.post)
        XCTAssertFalse(analytics.enabled)
        analytics.recordOpen(); analytics.shown(.predicted)
        analytics.flush(); analytics.foreground()
        analytics.hit(.predicted)
        for _ in 0..<500 where analytics.ledger.count < 3 { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(analytics.ledger.map(\.t), ["opened", "shown_predicted", "hit_predicted"])
        XCTAssertTrue(posts.bodies.isEmpty)
        XCTAssertEqual(store.reads + store.writes, 0)
    }

    func testCountingNeverFailsWhenTheStoreOrNetworkFails() {
        let broken = BrokenAnalyticsStore()
        let posts = AnalyticsPosts()
        posts.accepted = false
        let analytics = makeAnalytics(store: broken, posts: posts)
        analytics.recordOpen(); analytics.shown(.usual)
        var finished = false
        analytics.flush { finished = true }
        XCTAssertTrue(finished)
        XCTAssertEqual(posts.bodies.count, 1, "an unwritable store still counts in memory and sends")
    }

    func testCountingReturnsBeforeTheWorkerHasRun() {
        var pending: [() -> Void] = []
        let store = MemoryAnalyticsStore()
        let analytics = Analytics(debug: false, endpoint: analyticsProductionEndpoint, store: store,
                                  post: { _, _, done in done(true) }, worker: { pending.append($0) }, later: { _, _ in })
        analytics.recordOpen(); analytics.shown(.usual); analytics.flush()
        XCTAssertEqual(store.reads + store.writes, 0)
        while !pending.isEmpty { pending.removeFirst()() }
        XCTAssertGreaterThan(store.writes, 0)
    }

    func testThePostIsOneJsonArrayWithoutCookiesOrCredentials() async throws {
        let server = try CaptureServer(status: 204)
        let port = try await server.start()
        defer { server.stop() }
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/e"))
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "who", .value: "me"]))
        HTTPCookieStorage.shared.setCookie(cookie)
        defer { HTTPCookieStorage.shared.deleteCookie(cookie) }
        let payload = analyticsBody([AnalyticsEntry(t: "rode_pin", d: iosDims("2-5", ["b": "location", "pl.b": "ios.location"]), n: 2)])

        let accepted = await postAnalytics(payload, to: url)

        XCTAssertTrue(accepted, "plain HTTP to 127.0.0.1 reaches a local capture server")
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.head.hasPrefix("POST /e HTTP/1.1\r\n"), request.head)
        let headers = request.head.components(separatedBy: "\r\n").dropFirst().filter { !$0.isEmpty }
        XCTAssertTrue(headers.contains { $0.lowercased() == "content-type: application/json" }, request.head)
        let names = Set(headers.map { $0.split(separator: ":")[0].lowercased() })
        XCTAssertFalse(names.contains("cookie"))
        XCTAssertFalse(names.contains("authorization"))
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [[String: Any]])
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0]["p"] as? String, "ilovetrains")
        XCTAssertEqual(sent[0]["t"] as? String, "rode_pin")
        XCTAssertEqual(sent[0]["n"] as? Int, 2)
        XCTAssertEqual(sent[0]["d"] as? [String: String], ["u": "2-5", "pl": "ios", "pl.u": "ios.2-5", "b": "location", "pl.b": "ios.location"])
    }

    func testAServerErrorIsNotAnAcceptance() async throws {
        let server = try CaptureServer(status: 503)
        let port = try await server.start()
        defer { server.stop() }
        let accepted = await postAnalytics(Data("[]".utf8), to: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/e")))
        XCTAssertFalse(accepted)
        XCTAssertEqual(server.requests.count, 1)
    }

    private func distinctEntries(_ count: Int) -> [AnalyticsEntry] {
        let bands = ["1", "2-5", "6-10", "11-15", "16-20", "21-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51+"]
        let kinds = HeaderKind.allCases.map(\.rawValue)
        let plain = kinds.flatMap { k in ["shown_\(k)", "hit_\(k)", "miss_\(k)"] }.map { ($0, [String: String]()) }
        let pins = kinds.flatMap { k in PinResult.allCases.map { r in ("pinned_\(k)", ["r": r.rawValue, "pl.r": "ios.\(r.rawValue)"]) } }
        let entries = (plain + pins).flatMap { name, own in bands.map { AnalyticsEntry(t: name, d: iosDims($0, own), n: 1) } }
        precondition(entries.count >= count)
        return Array(entries.prefix(count))
    }
}

private final class BrokenAnalyticsStore: AnalyticsStore {
    struct Failure: Error {}
    func read() throws -> Data? { throw Failure() }
    func write(_ data: Data) throws { throw Failure() }
}

/// A one-shot HTTP/1.1 listener on the loopback interface, standing in for a capture endpoint.
final class CaptureServer: @unchecked Sendable {
    struct Request {
        var head: String
        var body: Data
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "ilt-analytics-capture")
    private let status: Int
    private let lock = NSLock()
    private var captured: [Request] = []
    private var starting: CheckedContinuation<UInt16, Error>?

    init(status: Int) throws {
        self.status = status
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
    }

    var requests: [Request] { lock.withLock { captured } }

    func start() async throws -> UInt16 {
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: self?.queue ?? .main)
            self?.receive(connection, Data())
        }
        return try await withCheckedThrowingContinuation { continuation in
            lock.withLock { starting = continuation }
            listener.stateUpdateHandler = { [weak self] state in self?.changed(state) }
            listener.start(queue: queue)
        }
    }

    private func changed(_ state: NWListener.State) {
        let result: Result<UInt16, Error>
        switch state {
        case .ready: result = .success(listener.port?.rawValue ?? 0)
        case let .failed(error): result = .failure(error)
        default: return
        }
        let continuation = lock.withLock { () -> CheckedContinuation<UInt16, Error>? in
            defer { starting = nil }
            return starting
        }
        continuation?.resume(with: result)
    }

    func stop() { listener.cancel() }

    private func receive(_ connection: NWConnection, _ buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] chunk, _, complete, error in
            guard let self else { return }
            var buffer = buffer
            if let chunk { buffer.append(chunk) }
            if let request = Self.request(in: buffer) {
                lock.withLock { captured.append(request) }
                let reason = status == 204 ? "No Content" : "Service Unavailable"
                let reply = "HTTP/1.1 \(status) \(reason)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                connection.send(content: Data(reply.utf8), completion: .contentProcessed { _ in connection.cancel() })
            } else if complete || error != nil {
                connection.cancel()
            } else {
                receive(connection, buffer)
            }
        }
    }

    private static func request(in buffer: Data) -> Request? {
        guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: buffer[..<end.upperBound], as: UTF8.self)
        let length = head.components(separatedBy: "\r\n")
            .first { $0.lowercased().hasPrefix("content-length:") }
            .flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) } ?? 0
        let body = buffer[end.upperBound...]
        return body.count >= length ? Request(head: head, body: Data(body.prefix(length))) : nil
    }
}
