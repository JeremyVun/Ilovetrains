package com.ilovetrains.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.zip.ZipInputStream

data class FocusedRefresh(
    val journey: Journey,
    val observedAt: Long?,
    val live: Boolean,
    val matchedLegIndices: Set<Int> = if (live) journey.legs.indices.toSet() else emptySet(),
) {
    val canJudgeClock: Boolean get() = matchedLegIndices.isNotEmpty()
}

class OfflinePlanner(
    context: Context,
    private val directory: File = File(context.applicationContext.noBackupFilesDir, "timetable"),
    private val openDatabase: (String) -> SQLiteDatabase = { path -> SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY) },
) {
    internal data class PackageInfo(
        val sha256: String,
        val url: String,
        val bytes: Long,
        val serviceDateFrom: String,
        val serviceDateTo: String,
        val generatedAt: Long,
    )

    private data class ScheduleCache(val baseAt: Long, val serviceDate: LocalDate, val horizonHours: Int, val connections: List<ScheduledConnection>)
    private data class StopRef(val stopId: String, val stationId: String, val platform: String?)
    private data class TripRef(val source: String, val tripId: String, val route: RouteRef, val headsign: String)
    private data class RouteRef(val line: String, val mode: String)
    private data class References(
        val stopsById: Map<Int, StopRef>,
        val tripsById: Map<Int, TripRef>,
    )

    private val appContext = context.applicationContext
    private val packageStore = OfflinePackageStore(directory)
    private val mutex = Mutex()
    private val updateMutex = Mutex()
    private val router = OfflineRouter()
    private val realtime = OfflineRealtime()
    private var database: SQLiteDatabase? = null
    private var activePackage: PackageInfo? = null
    private var scheduleCache: ScheduleCache? = null
    private var stationsById: Map<String, Station> = emptyMap()
    private var stopsById: Map<Int, StopRef> = emptyMap()
    private var tripsById: Map<Int, TripRef> = emptyMap()

    @Volatile
    var coverageDescription: String = "Timetable unavailable"
        private set

    suspend fun initialize() = withContext(Dispatchers.IO) {
        updateMutex.withLock {
            mutex.withLock {
                directory.mkdirs()
                packageStore.manifests().forEach { manifest ->
                    val info = runCatching { parseManifest(JSONObject(manifest)) }.getOrNull() ?: return@forEach
                    if (validateDatabase(packageStore.database(info.sha256), info)) {
                        packageStore.activate(packageStore.database(info.sha256), manifest, info.sha256)
                        open(info)
                        return@withLock
                    }
                }
                installBundled()
            }
        }
    }

    suspend fun plan(from: Station, to: Station, at: Long, modes: Set<String>, limit: Int = 12, maxTransfers: Int = 2): BoardData = withContext(Dispatchers.IO) {
        mutex.withLock {
            ensureOpen()
            val active = checkNotNull(activePackage)
            val date = Instant.ofEpochMilli(at).atZone(Sydney).toLocalDate()
            if (date.format(COMPACT_DATE) !in active.serviceDateFrom..active.serviceDateTo) {
                return@withLock BoardData(from, to, emptyList(), active.generatedAt, source = "schedule", offline = true, coverage = coverageDescription, error = "The offline timetable does not cover this date")
            }
            if (modes.isEmpty()) {
                return@withLock BoardData(from, to, emptyList(), active.generatedAt, source = "schedule", offline = true, coverage = coverageDescription)
            }
            if (from.modes.intersect(modes).isEmpty() || to.modes.intersect(modes).isEmpty()) {
                return@withLock BoardData(from, to, emptyList(), active.generatedAt, source = "schedule", offline = true, coverage = coverageDescription)
            }
            val db = checkNotNull(database)
            val assignments = mutableMapOf<String, StopAssignment?>()
            fun connections(hours: Int): List<ScheduledConnection> {
                val scheduled = cachedConnections(db, at, hours).filter { it.mode in modes }
                return if (realtime.hasFreshData()) realtime.overlay(scheduled) { source, stopId ->
                    assignments.getOrPut("$source\u0000$stopId") { assignmentFor(db, source, stopId) }
                }.sortedWith(compareBy<ScheduledConnection> { it.effectiveDeparture }.thenBy { it.tripKey }.thenBy { it.fromSequence }) else scheduled
            }
            var routed = router.route(from, to, at, connections(INITIAL_HORIZON_HOURS), limit, maxTransfers)
            if (routed.isEmpty() || routed.any(::hasLongWait)) {
                routed = router.route(from, to, at, connections(MAX_HORIZON_HOURS), limit, maxTransfers)
            }
            var observedAt: Long? = null
            var matched = false
            val finalJourneys = routed.map { journey ->
                val result = realtime.observation(journey)
                matched = matched || result.matched
                result.observedAt?.let { observedAt = minOf(observedAt ?: Long.MAX_VALUE, it) }
                result.value
            }
            BoardData(
                from = from,
                to = to,
                journeys = finalJourneys,
                generatedAt = observedAt ?: active.generatedAt,
                source = if (matched) "live" else "schedule",
                offline = !matched,
                coverage = coverageDescription,
            )
        }
    }

    suspend fun refreshRealtime(baseUrl: String) {
        realtime.refresh(baseUrl)
    }

    suspend fun refreshRealtime(baseUrl: String, sources: Set<String>) {
        realtime.refresh(baseUrl, sources)
    }

    suspend fun refreshFocused(journey: Journey): FocusedRefresh = withContext(Dispatchers.IO) {
        mutex.withLock {
            ensureOpen()
            val db = checkNotNull(database)
            val scheduled = scheduledFocusBaseline(journey) { source, stopId -> assignmentFor(db, source, stopId)?.platform }
            val result = realtime.overlay(scheduled) { source, stopId -> assignmentFor(db, source, stopId) }
            val allLegsMatched = scheduled.legs.isNotEmpty() && scheduled.legs.indices.all { it in result.matchedLegIndices }
            FocusedRefresh(result.value, result.observedAt, allLegsMatched, result.matchedLegIndices)
        }
    }

    suspend fun update(baseUrl: String) = withContext(Dispatchers.IO) {
        updateMutex.withLock {
            val manifestBytes = fetch(URL("${baseUrl.trimEnd('/')}/api/v1/timetable/manifest"), 1_000_000)
            val manifestText = manifestBytes.toString(Charsets.UTF_8)
            val candidate = parseManifest(JSONObject(manifestText))
            mutex.withLock {
                if (candidate.sha256 == activePackage?.sha256) return@withContext
            }
            val packageUrl = URL(URL(baseUrl), candidate.url)
            requireSecure(packageUrl)
            val download = File(directory, "download-${candidate.sha256}.zip")
            val extracted = File(directory, "candidate-${candidate.sha256}.sqlite3")
            try {
                val digest = download(packageUrl, download, candidate.bytes)
                require(digest.equals(candidate.sha256, true)) { "Timetable package hash mismatch" }
                extractDatabase(download, extracted)
                require(validateDatabase(extracted, candidate)) { "Timetable package failed validation" }
                mutex.withLock { activateValidatedCandidate(candidate, extracted, manifestText) }
            } finally {
                download.delete()
                extracted.delete()
            }
        }
    }

    private fun ensureOpen() {
        check(database?.isOpen == true) { "OfflinePlanner.initialize() has not completed" }
    }

    private fun installBundled() {
        val manifestText = appContext.assets.open("timetable-manifest.json").bufferedReader().use { it.readText() }
        val info = parseManifest(JSONObject(manifestText))
        val download = File(directory, "download-${info.sha256}.zip")
        val extracted = File(directory, "candidate-${info.sha256}.sqlite3")
        try {
            val digest = appContext.assets.open("timetable.zip").use { input -> copyAndHash(input, download) }
            require(digest.equals(info.sha256, true)) { "Bundled timetable hash mismatch" }
            extractDatabase(download, extracted)
            require(validateDatabase(extracted, info)) { "Bundled timetable failed validation" }
            packageStore.activate(extracted, manifestText, info.sha256)
            open(info)
        } finally {
            download.delete()
            extracted.delete()
        }
    }

    private fun open(info: PackageInfo) {
        val opened = openDatabase(packageStore.database(info.sha256).path)
        try {
            val stations = loadStations(opened)
            val references = loadReferences(opened)
            database?.close()
            database = opened
            activePackage = info
            scheduleCache = null
            stationsById = stations
            stopsById = references.stopsById
            tripsById = references.tripsById
            coverageDescription = coverage(info.serviceDateFrom, info.serviceDateTo)
        } catch (error: Throwable) {
            opened.close()
            throw error
        }
    }

    internal fun activateValidatedCandidate(candidate: PackageInfo, extracted: File, manifest: String) {
        val previous = activePackage?.sha256
        val previousManifest = previous?.let { sha ->
            packageStore.manifests().firstOrNull { stored ->
                runCatching { parseManifest(JSONObject(stored)).sha256 == sha }.getOrDefault(false)
            }
        }
        packageStore.activate(extracted, manifest, candidate.sha256)
        try {
            open(candidate)
        } catch (error: Throwable) {
            if (previous != null && previousManifest != null) {
                packageStore.activate(packageStore.database(previous), previousManifest, previous)
            }
            throw error
        }
        packageStore.retain(candidate.sha256, previous)
    }

    private fun cachedConnections(db: SQLiteDatabase, at: Long, horizonHours: Int): List<ScheduledConnection> {
        val serviceDate = Instant.ofEpochMilli(at).atZone(Sydney).toLocalDate()
        scheduleCache?.takeIf {
            it.serviceDate == serviceDate && it.horizonHours >= horizonHours && at in it.baseAt..it.baseAt + 30 * 60_000L
        }?.let { return it.connections }
        return readConnections(db, at, horizonHours).also { scheduleCache = ScheduleCache(at, serviceDate, horizonHours, it) }
    }

    internal fun validateDatabase(file: File, info: PackageInfo): Boolean {
        if (!file.isFile) return false
        return runCatching {
            SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                val applicationId = db.rawQuery("PRAGMA application_id", null).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
                val version = db.rawQuery("PRAGMA user_version", null).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
                val integrity = db.rawQuery("PRAGMA quick_check", null).use { cursor -> cursor.moveToFirst(); cursor.getString(0) }
                val metadata = db.rawQuery("SELECT key,value FROM meta WHERE key IN ('service_date_from','service_date_to')", null).use { cursor ->
                    buildMap { while (cursor.moveToNext()) put(cursor.getString(0), cursor.getString(1)) }
                }
                applicationId == APPLICATION_ID && version == 1 && integrity == "ok" && metadata["service_date_from"] == info.serviceDateFrom && metadata["service_date_to"] == info.serviceDateTo
            }
        }.getOrDefault(false)
    }

    private fun readConnections(db: SQLiteDatabase, at: Long, horizonHours: Int): List<ScheduledConnection> {
        val horizon = at + horizonHours * 60 * 60_000L
        val atLocal = Instant.ofEpochMilli(at).atZone(Sydney).toLocalDateTime()
        val horizonLocal = Instant.ofEpochMilli(horizon).atZone(Sydney).toLocalDateTime()
        val currentDate = atLocal.toLocalDate()
        val result = ArrayList<ScheduledConnection>(80_000)
        for (offset in -1L..2L) {
            val serviceDate = currentDate.plusDays(offset)
            val midnight = LocalDateTime.of(serviceDate, LocalTime.MIDNIGHT)
            val lower = maxOf(0L, Duration.between(midnight, atLocal.minusHours(3)).seconds)
            val upper = minOf(36 * 3600L, Duration.between(midnight, horizonLocal).seconds)
            if (lower > upper) continue
            queryConnections(db, serviceDate, lower.toInt(), upper.toInt(), result)
        }
        return result.asSequence()
            .filter { it.departure <= horizon && it.arrival >= at - 3 * 60 * 60_000L }
            .sortedWith(compareBy<ScheduledConnection> { it.departure }.thenBy { it.tripKey }.thenBy { it.fromSequence })
            .toList()
    }

    private fun queryConnections(
        db: SQLiteDatabase,
        serviceDate: LocalDate,
        lower: Int,
        upper: Int,
        output: MutableList<ScheduledConnection>,
    ) {
        val compactDate = serviceDate.format(COMPACT_DATE)
        val dateNumber = compactDate.toInt()
        val weekdayMask = 1 shl (serviceDate.dayOfWeek.value - 1)
        val sql = """
            SELECT c.trip,c.from_sequence,c.to_sequence,c.from_stop,c.to_stop,
              c.departure_secs,c.arrival_secs,c.pickup_type,c.drop_off_type
            FROM connections c
            JOIN trips tr ON tr.id=c.trip
            JOIN services sv ON sv.id=tr.service
            WHERE c.departure_secs BETWEEN ? AND ?
              AND (
                EXISTS(SELECT 1 FROM service_exceptions x WHERE x.service=sv.id AND x.service_date=? AND x.exception_type=1)
                OR (? BETWEEN sv.start_date AND sv.end_date AND (sv.weekdays & ?) != 0
                  AND NOT EXISTS(SELECT 1 FROM service_exceptions x WHERE x.service=sv.id AND x.service_date=? AND x.exception_type=2))
              )
        """.trimIndent()
        val args = mutableListOf(lower.toString(), upper.toString()).apply {
            add(dateNumber.toString())
            add(dateNumber.toString())
            add(weekdayMask.toString())
            add(dateNumber.toString())
        }.toTypedArray()
        val fastEpochBase = fastEpochBase(serviceDate)
        db.rawQuery(sql, args).use { cursor ->
            while (cursor.moveToNext()) {
                val trip = tripsById[cursor.getInt(0)] ?: continue
                val fromStop = stopsById[cursor.getInt(3)] ?: continue
                val toStop = stopsById[cursor.getInt(4)] ?: continue
                val departureSeconds = cursor.getInt(5)
                val arrivalSeconds = cursor.getInt(6)
                val departure = fastEpochBase?.plus(departureSeconds * 1_000L) ?: gtfsEpochMillis(serviceDate, departureSeconds)
                val arrival = fastEpochBase?.plus(arrivalSeconds * 1_000L) ?: gtfsEpochMillis(serviceDate, arrivalSeconds)
                output += ScheduledConnection(
                    source = trip.source,
                    tripId = trip.tripId,
                    serviceDate = compactDate,
                    fromSequence = cursor.getInt(1),
                    toSequence = cursor.getInt(2),
                    fromStopId = fromStop.stopId,
                    toStopId = toStop.stopId,
                    fromStationId = fromStop.stationId,
                    toStationId = toStop.stationId,
                    fromStation = stationsById[fromStop.stationId],
                    toStation = stationsById[toStop.stationId],
                    departure = departure,
                    arrival = arrival,
                    pickupType = cursor.getInt(7),
                    dropOffType = cursor.getInt(8),
                    fromPlatform = fromStop.platform,
                    toPlatform = toStop.platform,
                    line = trip.route.line,
                    mode = trip.route.mode,
                    headsign = trip.headsign,
                )
            }
        }
    }

    private fun loadStations(db: SQLiteDatabase): Map<String, Station> = db.rawQuery(
        "SELECT id,name,lat,lon,modes FROM stations",
        null,
    ).use { cursor ->
        buildMap(cursor.count) {
            while (cursor.moveToNext()) {
                val id = cursor.getString(0)
                put(id, Station(id, cursor.getString(1), cursor.getDouble(2), cursor.getDouble(3), cursor.getString(4).split(',').filter(String::isNotBlank).toSet()))
            }
        }
    }

    private fun loadReferences(db: SQLiteDatabase): References {
        val sources = db.rawQuery("SELECT id,name FROM sources", null).use { cursor ->
            buildMap { while (cursor.moveToNext()) put(cursor.getInt(0), cursor.getString(1)) }
        }
        val routes = db.rawQuery("SELECT id,short_name,long_name,mode FROM routes", null).use { cursor ->
            buildMap {
                while (cursor.moveToNext()) {
                    val shortName = cursor.getString(1)
                    put(cursor.getInt(0), RouteRef(shortName.ifBlank { cursor.getString(2) }, cursor.getString(3)))
                }
            }
        }
        val stops = db.rawQuery("SELECT id,stop_id,station_id,platform FROM stops", null).use { cursor ->
            buildMap(cursor.count) {
                while (cursor.moveToNext()) put(cursor.getInt(0), StopRef(cursor.getString(1), cursor.getString(2), if (cursor.isNull(3)) null else cursor.getString(3)))
            }
        }
        val trips = db.rawQuery("SELECT id,source,trip_id,route,headsign FROM trips", null).use { cursor ->
            buildMap(cursor.count) {
                while (cursor.moveToNext()) {
                    val source = sources[cursor.getInt(1)] ?: continue
                    val route = routes[cursor.getInt(3)] ?: continue
                    put(cursor.getInt(0), TripRef(source, cursor.getString(2), route, cursor.getString(4)))
                }
            }
        }
        return References(stops, trips)
    }

    private fun fastEpochBase(serviceDate: LocalDate): Long? {
        val start = serviceDate.atStartOfDay(Sydney).toInstant()
        val end = serviceDate.plusDays(2).atStartOfDay(Sydney).toInstant()
        val transition = Sydney.rules.nextTransition(start.minusNanos(1))
        return if (transition == null || !transition.instant.isBefore(end)) start.toEpochMilli() else null
    }

    private fun hasLongWait(journey: Journey): Boolean = journey.legs.zipWithNext().any { (first, second) ->
        second.departure - first.arrival > 60 * 60_000L
    }

    private fun assignmentFor(db: SQLiteDatabase, source: String, stopId: String): StopAssignment? = db.rawQuery(
        "SELECT st.platform,st.station_id FROM stops st JOIN sources src ON src.id=st.source WHERE src.name=? AND st.stop_id=?",
        arrayOf(source, stopId),
    ).use { cursor ->
        if (!cursor.moveToFirst()) null else StopAssignment(if (cursor.isNull(0)) null else cursor.getString(0), cursor.getString(1))
    }

    private fun fetch(url: URL, limit: Int): ByteArray {
        requireSecure(url)
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Accept", "application/json")
        return try {
            require(connection.responseCode == HttpURLConnection.HTTP_OK) { "Timetable server returned ${connection.responseCode}" }
            connection.inputStream.use { readLimited(it, limit) }
        } finally {
            connection.disconnect()
        }
    }

    private fun download(url: URL, destination: File, expectedBytes: Long): String {
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 8_000
        connection.readTimeout = 60_000
        return try {
            require(connection.responseCode == HttpURLConnection.HTTP_OK) { "Timetable download returned ${connection.responseCode}" }
            val digest = MessageDigest.getInstance("SHA-256")
            var count = 0L
            destination.outputStream().buffered().use { output ->
                connection.inputStream.buffered().use { input ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        count += read
                        require(count <= expectedBytes) { "Timetable package is larger than its manifest" }
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                }
            }
            require(count == expectedBytes) { "Timetable package size mismatch" }
            digest.digest().joinToString("") { "%02x".format(it) }
        } finally {
            connection.disconnect()
        }
    }

    private fun copyAndHash(input: InputStream, destination: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        destination.outputStream().buffered().use { output ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
                output.write(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun extractDatabase(archive: File, destination: File) {
        ZipInputStream(archive.inputStream().buffered()).use { input ->
            val entry = input.nextEntry
            require(entry != null && !entry.isDirectory && entry.name == "timetable.sqlite3")
            var size = 0L
            destination.outputStream().buffered().use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    size += read
                    require(size <= MAX_DATABASE_BYTES) { "Timetable database is too large" }
                    output.write(buffer, 0, read)
                }
            }
            input.closeEntry()
            require(input.nextEntry == null) { "Timetable package contains unexpected files" }
        }
    }

    private fun readLimited(input: InputStream, limit: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            require(output.size() + read <= limit) { "Response is too large" }
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun requireSecure(url: URL) {
        require(url.protocol == "https" || url.host in setOf("localhost", "127.0.0.1")) { "Timetable updates require HTTPS" }
    }

    private fun coverage(from: String, to: String): String {
        val formatter = DateTimeFormatter.ofPattern("d MMM yyyy")
        return "${LocalDate.parse(from, COMPACT_DATE).format(formatter)}–${LocalDate.parse(to, COMPACT_DATE).format(formatter)}"
    }

    companion object {
        private val COMPACT_DATE = DateTimeFormatter.BASIC_ISO_DATE
        private const val MAX_DATABASE_BYTES = 300L * 1024 * 1024
        private const val APPLICATION_ID = 0x494c5452
        private const val MAX_EPOCH_MILLIS = 8_640_000_000_000_000.0
        private const val INITIAL_HORIZON_HOURS = 6
        private const val MAX_HORIZON_HOURS = 30

        internal fun gtfsEpochMillis(serviceDate: LocalDate, seconds: Int): Long =
            LocalDateTime.of(serviceDate, LocalTime.MIDNIGHT).plusSeconds(seconds.toLong()).atZone(Sydney).toInstant().toEpochMilli()

        internal fun parseManifest(json: JSONObject): PackageInfo {
            require(json.getInt("schemaVersion") == 1)
            val packages = json.getJSONArray("packages")
            val candidates = List(packages.length()) { packages.getJSONObject(it) }.filter { it.getString("source") == "network" }
            require(candidates.size == 1)
            val item = candidates.single()
            require(item.getInt("schemaVersion") == 1)
            val sha = item.getString("sha256")
            require(sha.matches(Regex("[0-9a-f]{64}")))
            val from = item.getString("serviceDateFrom")
            val to = item.getString("serviceDateTo")
            require(item.getLong("bytes") in 0..MAX_DATABASE_BYTES)
            require(from.matches(Regex("\\d{8}")))
            require(to.matches(Regex("\\d{8}")))
            require(runCatching { LocalDate.parse(from, COMPACT_DATE) }.isSuccess)
            require(runCatching { LocalDate.parse(to, COMPACT_DATE) }.isSuccess)
            require(from <= to)
            return PackageInfo(
                sha256 = sha,
                url = item.getString("url"),
                bytes = item.getLong("bytes"),
                serviceDateFrom = from,
                serviceDateTo = to,
                generatedAt = parseTime(json.get("generatedAt")),
            )
        }

        private fun parseTime(value: Any): Long {
            val timestamp = when (value) {
                is Number -> value.toDouble()
                is String -> Instant.parse(value).toEpochMilli().toDouble()
                else -> error("Invalid manifest timestamp")
            }
            require(timestamp.isFinite() && kotlin.math.abs(timestamp) <= MAX_EPOCH_MILLIS)
            return timestamp.toLong()
        }

        internal fun scheduledFocusBaseline(journey: Journey, platform: (String, String) -> String?): Journey = Journey(journey.legs.map { leg ->
            val identity = leg.identity ?: return@map leg.copy(estimatedDeparture = null, estimatedArrival = null, cancelled = false)
            leg.copy(
                estimatedDeparture = null,
                estimatedArrival = null,
                fromPlatform = platform(identity.source, identity.fromStopId),
                toPlatform = platform(identity.source, identity.toStopId),
                cancelled = false,
            )
        })
    }
}
