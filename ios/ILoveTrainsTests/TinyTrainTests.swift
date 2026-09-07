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
