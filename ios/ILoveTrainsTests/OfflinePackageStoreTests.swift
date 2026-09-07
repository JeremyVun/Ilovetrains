import XCTest
@testable import ILoveTrains

final class OfflinePackageStoreTests: XCTestCase {
    func testInterruptedStagingLeavesActiveGenerationFirst() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OfflinePackageStore(directory: directory)
        try store.prepareDirectory()
        let old = String(repeating: "a", count: 64)
        let newer = String(repeating: "b", count: 64)
        let candidate = directory.appendingPathComponent("old-candidate")
        try Data("valid-old".utf8).write(to: candidate)
        try store.activate(candidateDatabase: candidate, manifest: manifest(old), sha256: old)
        try Data("partial".utf8).write(to: directory.appendingPathComponent("candidate-\(newer).sqlite3"))

        XCTAssertEqual(selected(store), old)
    }

    func testRetainedPreviousGenerationSurvivesCorruptActiveGeneration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OfflinePackageStore(directory: directory)
        try store.prepareDirectory()
        let old = String(repeating: "a", count: 64)
        let newer = String(repeating: "b", count: 64)
        let oldCandidate = directory.appendingPathComponent("old")
        try Data("valid-old".utf8).write(to: oldCandidate)
        try store.activate(candidateDatabase: oldCandidate, manifest: manifest(old), sha256: old)
        let newCandidate = directory.appendingPathComponent("new")
        try Data("valid-new".utf8).write(to: newCandidate)
        try store.activate(candidateDatabase: newCandidate, manifest: manifest(newer), sha256: newer)
        try Data("corrupt".utf8).write(to: store.database(newer))

        XCTAssertEqual(selected(store), old)
    }

    func testFailedCandidateActivationDoesNotReplaceActiveManifest() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OfflinePackageStore(directory: directory)
        try store.prepareDirectory()
        let old = String(repeating: "a", count: 64)
        let newer = String(repeating: "b", count: 64)
        let oldCandidate = directory.appendingPathComponent("old")
        try Data("valid-old".utf8).write(to: oldCandidate)
        try store.activate(candidateDatabase: oldCandidate, manifest: manifest(old), sha256: old)

        XCTAssertThrowsError(try store.activate(
            candidateDatabase: directory.appendingPathComponent("missing-candidate"),
            manifest: manifest(newer),
            sha256: newer
        ))
        XCTAssertEqual(selected(store), old)
    }

    private func selected(_ store: OfflinePackageStore) -> String? {
        for data in store.manifests() {
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let packages = json["packages"] as? [[String: Any]],
                  let hash = packages.first?["sha256"] as? String,
                  let bytes = try? Data(contentsOf: store.database(hash)),
                  String(decoding: bytes, as: UTF8.self).hasPrefix("valid") else { continue }
            return hash
        }
        return nil
    }

    private func manifest(_ hash: String) -> Data {
        Data("{\"schemaVersion\":1,\"packages\":[{\"sha256\":\"\(hash)\"}]}".utf8)
    }
}
