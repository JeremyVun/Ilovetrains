import Compression
import Foundation

enum OfflineZip {
    private static let maxDatabaseBytes = 300 * 1_024 * 1_024

    static func extractDatabase(from archive: URL, to destination: URL) throws {
        let data = try Data(contentsOf: archive, options: [.mappedIfSafe])
        let entry = try parseSingleEntry(data)
        guard entry.uncompressedSize <= maxDatabaseBytes else { throw OfflineCoreError.invalidPackage }
        var output = Data(count: entry.uncompressedSize)
        let decoded = output.withUnsafeMutableBytes { outputBytes in
            data.withUnsafeBytes { archiveBytes in
                guard let outputBase = outputBytes.bindMemory(to: UInt8.self).baseAddress,
                      let archiveBase = archiveBytes.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                return compression_decode_buffer(
                    outputBase,
                    entry.uncompressedSize,
                    archiveBase.advanced(by: entry.dataOffset),
                    entry.compressedSize,
                    nil,
                    COMPRESSION_ZLIB
                )
            }
        }
        guard decoded == entry.uncompressedSize else { throw OfflineCoreError.invalidPackage }
        try output.write(to: destination)
    }

    private struct Entry {
        var compressedSize: Int
        var uncompressedSize: Int
        var dataOffset: Int
    }

    private static func parseSingleEntry(_ data: Data) throws -> Entry {
        guard data.count >= 22,
              let eocd = stride(from: data.count - 22, through: max(0, data.count - 65_557), by: -1)
                .first(where: { data.u32($0) == 0x0605_4b50 }),
              data.u16(eocd + 4) == 0,
              data.u16(eocd + 6) == 0,
              data.u16(eocd + 8) == 1,
              data.u16(eocd + 10) == 1,
              eocd + 22 + Int(data.u16(eocd + 20)) == data.count else { throw OfflineCoreError.invalidPackage }
        let centralSize = Int(data.u32(eocd + 12))
        let centralOffset = Int(data.u32(eocd + 16))
        guard centralOffset >= 0,
              centralSize >= 46,
              centralOffset + centralSize == eocd,
              data.u32(centralOffset) == 0x0201_4b50 else { throw OfflineCoreError.invalidPackage }
        let flags = data.u16(centralOffset + 8)
        let method = data.u16(centralOffset + 10)
        let compressedSize = Int(data.u32(centralOffset + 20))
        let uncompressedSize = Int(data.u32(centralOffset + 24))
        let nameLength = Int(data.u16(centralOffset + 28))
        let extraLength = Int(data.u16(centralOffset + 30))
        let commentLength = Int(data.u16(centralOffset + 32))
        let localOffset = Int(data.u32(centralOffset + 42))
        guard flags & 1 == 0,
              method == 8,
              centralSize == 46 + nameLength + extraLength + commentLength,
              data.utf8(centralOffset + 46, count: nameLength) == "timetable.sqlite3",
              localOffset == 0,
              localOffset + 30 <= data.count,
              data.u32(localOffset) == 0x0403_4b50,
              data.u16(localOffset + 6) & 1 == 0,
              data.u16(localOffset + 8) == method else { throw OfflineCoreError.invalidPackage }
        let localNameLength = Int(data.u16(localOffset + 26))
        let localExtraLength = Int(data.u16(localOffset + 28))
        let dataOffset = localOffset + 30 + localNameLength + localExtraLength
        guard data.utf8(localOffset + 30, count: localNameLength) == "timetable.sqlite3",
              compressedSize >= 0,
              uncompressedSize >= 0,
              dataOffset >= 0,
              dataOffset + compressedSize == centralOffset else { throw OfflineCoreError.invalidPackage }
        return Entry(compressedSize: compressedSize, uncompressedSize: uncompressedSize, dataOffset: dataOffset)
    }
}

private extension Data {
    func u16(_ offset: Int) -> UInt16 {
        guard offset >= 0, offset + 2 <= count else { return 0 }
        return withUnsafeBytes { bytes in
            let base = bytes.bindMemory(to: UInt8.self).baseAddress!
            return UInt16(base[offset]) | UInt16(base[offset + 1]) << 8
        }
    }

    func u32(_ offset: Int) -> UInt32 {
        guard offset >= 0, offset + 4 <= count else { return 0 }
        return withUnsafeBytes { bytes in
            let base = bytes.bindMemory(to: UInt8.self).baseAddress!
            return UInt32(base[offset])
                | UInt32(base[offset + 1]) << 8
                | UInt32(base[offset + 2]) << 16
                | UInt32(base[offset + 3]) << 24
        }
    }

    func utf8(_ offset: Int, count length: Int) -> String? {
        guard offset >= 0, length >= 0, offset + length <= count else { return nil }
        return String(data: self[offset..<(offset + length)], encoding: .utf8)
    }
}
