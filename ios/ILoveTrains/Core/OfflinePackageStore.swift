import Foundation

struct OfflinePackageStore {
    let directory: URL

    private var activeManifest: URL { directory.appendingPathComponent("active-manifest.json") }

    func database(_ sha256: String) -> URL {
        directory.appendingPathComponent("timetable-\(sha256).sqlite3")
    }

    func manifests() -> [Data] {
        let active = try? Data(contentsOf: activeManifest)
        let retained = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ))?.filter { $0.lastPathComponent.hasPrefix("manifest-") && $0.pathExtension == "json" }
            .sorted {
                let left = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let right = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return left > right
            }
            .compactMap { try? Data(contentsOf: $0) } ?? []
        var seen = Set<Data>()
        return ([active].compactMap { $0 } + retained).filter { seen.insert($0).inserted }
    }

    func activate(candidateDatabase: URL, manifest: Data, sha256: String) throws {
        try prepareDirectory()
        let installed = database(sha256)
        if candidateDatabase.standardizedFileURL != installed.standardizedFileURL {
            if FileManager.default.fileExists(atPath: installed.path) {
                _ = try FileManager.default.replaceItemAt(installed, withItemAt: candidateDatabase)
            } else {
                try FileManager.default.moveItem(at: candidateDatabase, to: installed)
            }
        }
        try manifest.write(
            to: directory.appendingPathComponent("manifest-\(sha256).json"),
            options: [.atomic]
        )
        try manifest.write(to: activeManifest, options: [.atomic])
    }

    func retain(_ hashes: Set<String>) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files where isGeneration(file) && !hashes.contains(where: { file.lastPathComponent.contains($0) }) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    func prepareDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = directory
        try mutableDirectory.setResourceValues(values)
    }

    private func isGeneration(_ url: URL) -> Bool {
        (url.lastPathComponent.hasPrefix("timetable-") && url.pathExtension == "sqlite3")
            || (url.lastPathComponent.hasPrefix("manifest-") && url.pathExtension == "json")
    }
}
