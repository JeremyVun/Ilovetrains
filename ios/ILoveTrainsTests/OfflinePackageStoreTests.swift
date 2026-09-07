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

    func testMalformedZipArchivesAreRejectedBeforeWritingDatabase() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let archive = directory.appendingPathComponent("package.zip")
        let destination = directory.appendingPathComponent("timetable.sqlite3")
        let malformed = [
            Data(),
            zip(name: "other.sqlite3"),
            zip(flags: 1),
            zip(entries: 2),
            zip(localName: "other.sqlite3")
        ]

        for data in malformed {
            try data.write(to: archive)
            XCTAssertThrowsError(try OfflineZip.extractDatabase(from: archive, to: destination))
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        }
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

    private func zip(
        name: String = "timetable.sqlite3",
        flags: UInt16 = 0,
        entries: UInt16 = 1,
        localName: String? = nil
    ) -> Data {
        let centralName = Data(name.utf8)
        let localName = Data((localName ?? name).utf8)
        var data = Data()
        data.appendLE(UInt32(0x0403_4b50))
        data.appendLE(UInt16(20))
        data.appendLE(flags)
        data.appendLE(UInt16(8))
        data.appendLE(UInt16(0))
        data.appendLE(UInt16(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt16(localName.count))
        data.appendLE(UInt16(0))
        data.append(localName)
        let centralOffset = data.count
        data.appendLE(UInt32(0x0201_4b50))
        data.appendLE(UInt16(20))
        data.appendLE(UInt16(20))
        data.appendLE(flags)
        data.appendLE(UInt16(8))
        data.appendLE(UInt16(0))
        data.appendLE(UInt16(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt16(centralName.count))
        data.appendLE(UInt16(0))
        data.appendLE(UInt16(0))
        data.appendLE(UInt16(0))
        data.appendLE(UInt16(0))
        data.appendLE(UInt32(0))
        data.appendLE(UInt32(0))
        data.append(centralName)
        let centralSize = data.count - centralOffset
        data.appendLE(UInt32(0x0605_4b50))
        data.appendLE(UInt16(0))
        data.appendLE(UInt16(0))
        data.appendLE(entries)
        data.appendLE(entries)
        data.appendLE(UInt32(centralSize))
        data.appendLE(UInt32(centralOffset))
        data.appendLE(UInt16(0))
        return data
    }
}

private extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var littleEndian = value.littleEndian
        append(Data(bytes: &littleEndian, count: MemoryLayout<T>.size))
    }
}
