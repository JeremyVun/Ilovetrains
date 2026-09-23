package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit

const val AnalyticsEndpoint = "https://analytics.jeremyvun.com/e"
const val AnalyticsUrlExtra = "ILOVETRAINS_ANALYTICS_URL"
const val AnalyticsStoreName = "analytics-v1.json"
internal const val AnalyticsQueueCap = 200
internal const val AnalyticsCountCap = 1_000_000
internal const val AnalyticsFlushDelayMillis = 10_000L
private const val AnalyticsProject = "ilovetrains"
private const val Platform = "android"

enum class HeaderKind(val wire: String) {
    Predicted("predicted"), Focus("focus"), Usual("usual"), Home("home"), Inferred("inferred")
}

enum class PinResult(val wire: String) { Same("same"), Service("service"), Trip("trip") }

private val UsageBands = setOf("1", "2-5", "6-10", "11-15", "16-20", "21-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51+")
private val Milestones = setOf(1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250)
private val MilestoneWords = Milestones.map(Int::toString).toSet()
private val PinWords = PinResult.entries.map(PinResult::wire).toSet()
private val BasisWords = setOf("location", "estimate")
internal val AnalyticsEventNames: Set<String> = HeaderKind.entries.flatMap { kind ->
    listOf("shown_", "hit_", "miss_", "pinned_").map { it + kind.wire }
}.toSet() + setOf("opened", "rode_pin", "rode_auto")

fun usageBand(opens: Int): String = when {
    opens <= 1 -> "1"
    opens <= 5 -> "2-5"
    opens <= 10 -> "6-10"
    opens <= 50 -> ((opens - 1) / 5 * 5 + 1).let { "$it-${it + 4}" }
    else -> "51+"
}

fun openMilestone(opens: Int): String? = opens.takeIf { it in Milestones }?.toString()

val ArrivalBasis.wire: String get() = when (this) { ArrivalBasis.Location -> "location"; ArrivalBasis.Estimate -> "estimate" }

data class AnalyticsEvent(val t: String, val d: Map<String, String>)
data class AnalyticsEntry(val t: String, val d: Map<String, String>, val n: Int)
data class AnalyticsState(val opens: Int = 0, val queue: List<AnalyticsEntry> = emptyList())

private fun ownKeys(name: String): Set<String> = when {
    name == "opened" -> setOf("m")
    name.startsWith("pinned_") -> setOf("r", "pl.r")
    name.startsWith("rode_") -> setOf("b", "pl.b")
    else -> emptySet()
}

internal fun validAnalyticsEvent(name: String, d: Map<String, String>): Boolean {
    if (name !in AnalyticsEventNames) return false
    val band = d["u"]
    if (band !in UsageBands || d["pl"] != Platform || d["pl.u"] != "$Platform.$band") return false
    val own = when {
        name == "opened" -> d["m"] in MilestoneWords
        name.startsWith("pinned_") -> d["r"] in PinWords && d["pl.r"] == "$Platform.${d["r"]}"
        name.startsWith("rode_") -> d["b"] in BasisWords && d["pl.b"] == "$Platform.${d["b"]}"
        else -> true
    }
    return own && d.keys == setOf("u", "pl", "pl.u") + ownKeys(name)
}

private fun wholeNumber(value: Any?, range: LongRange): Long? {
    val number = (value as? Number)?.toDouble() ?: return null
    if (number != Math.floor(number) || number < range.first || number > range.last) return null
    return number.toLong()
}

private fun entryOf(value: Any?): AnalyticsEntry? {
    val entry = value as? JSONObject ?: return null
    if (entry.length() != 3) return null
    val name = entry.opt("t") as? String ?: return null
    val raw = entry.opt("d") as? JSONObject ?: return null
    val dims = raw.keys().asSequence().associateWith { key -> raw.opt(key) as? String ?: return null }
    val count = wholeNumber(entry.opt("n"), 1L..AnalyticsCountCap) ?: return null
    return AnalyticsEntry(name, dims, count.toInt()).takeIf { validAnalyticsEvent(name, dims) }
}

/** Null means malformed: the caller drops the whole store. An absent store is a fresh one. */
internal fun parseAnalyticsStore(text: String?): AnalyticsState? {
    if (text == null) return AnalyticsState()
    return try {
        val root = JSONObject(text)
        if (root.keyNames() != setOf("opens", "queue")) return null
        val opens = wholeNumber(root.opt("opens"), 0L..Int.MAX_VALUE) ?: return null
        val raw = root.opt("queue") as? JSONArray ?: return null
        val queue = (0 until raw.length()).map { entryOf(raw.opt(it)) ?: return null }
        AnalyticsState(opens.toInt(), queue.takeLast(AnalyticsQueueCap))
    } catch (_: Exception) { null }
}

private fun JSONObject.keyNames(): Set<String> = keys().asSequence().toSet()

internal fun analyticsStoreText(state: AnalyticsState): String = JSONObject()
    .put("opens", state.opens)
    .put("queue", JSONArray(state.queue.map { JSONObject().put("t", it.t).put("d", JSONObject(it.d)).put("n", it.n) }))
    .toString()

internal fun analyticsBody(queue: List<AnalyticsEntry>): String = JSONArray(queue.map {
    JSONObject().put("p", AnalyticsProject).put("t", it.t).put("d", JSONObject(it.d)).put("n", it.n)
}).toString()

/** Only release builds send; a debug build sends only to an explicit capture URL. */
internal fun analyticsEndpoint(debug: Boolean, capture: String? = null): String? =
    if (!debug) AnalyticsEndpoint else capture?.let(::captureUrl)

internal fun captureUrl(raw: String): String? = runCatching { URI(raw.trim()) }.getOrNull()
    ?.takeIf { (it.scheme == "http" || it.scheme == "https") && !it.host.isNullOrEmpty() }?.toString()

interface AnalyticsStore {
    fun read(): String?
    fun write(text: String)
}

class FileAnalyticsStore(private val file: File) : AnalyticsStore {
    override fun read(): String? = if (file.exists()) file.readText() else null
    override fun write(text: String) {
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.writeText(text)
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}

internal fun postAnalytics(url: String, body: String): Boolean {
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    return try {
        val bytes = body.toByteArray()
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.connectTimeout = 5000; connection.readTimeout = 10_000
        connection.instanceFollowRedirects = false; connection.useCaches = false
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setFixedLengthStreamingMode(bytes.size)
        connection.outputStream.use { it.write(bytes) }
        connection.responseCode in 200..299
    } finally { connection.disconnect() }
}

/**
 * Anonymous counters with a closed vocabulary (analytics.md). Every call returns at once and never throws;
 * state lives on one worker thread, and the network runs on another so a slow POST never delays a count.
 */
class Analytics internal constructor(
    private val debug: Boolean,
    endpoint: String?,
    private val store: AnalyticsStore,
    private val post: (String, String) -> Boolean,
    private val worker: Executor,
    private val network: Executor,
    private val later: (Long, Runnable) -> Unit,
) {
    @Volatile private var endpoint: String? = endpoint
    private var state: AnalyticsState? = null
    private var inFlight = false
    private var flushScheduled = false
    private val events = mutableListOf<AnalyticsEvent>()

    val enabled: Boolean get() = endpoint != null
    val ledger: List<AnalyticsEvent> get() = synchronized(events) { events.toList() }

    fun recordOpen() = submit {
        val current = loaded()
        val opens = if (current.opens == Int.MAX_VALUE) current.opens else current.opens + 1
        save(current.copy(opens = opens))
        openMilestone(opens)?.let { record("opened", mapOf("m" to it)) }
    }
    fun shown(kind: HeaderKind) = track("shown_" + kind.wire)
    fun hit(kind: HeaderKind) = track("hit_" + kind.wire)
    fun miss(kind: HeaderKind) = track("miss_" + kind.wire)
    fun pinned(kind: HeaderKind, result: PinResult) =
        track("pinned_" + kind.wire, mapOf("r" to result.wire, "pl.r" to "$Platform.${result.wire}"))
    fun rode(pinned: Boolean, basis: ArrivalBasis) =
        track(if (pinned) "rode_pin" else "rode_auto", mapOf("b" to basis.wire, "pl.b" to "$Platform.${basis.wire}"))

    /** A new foreground session: its first event schedules a flush again, and anything left over is sent now. */
    fun foreground() = submit {
        flushScheduled = false
        if (endpoint != null && loaded().queue.isNotEmpty()) sendQueue()
    }
    fun background() = flush()
    fun flush() = submit { sendQueue() }

    fun captureTo(url: String) {
        if (!debug) return
        val capture = analyticsEndpoint(debug = true, capture = url) ?: return
        submit { endpoint = capture; state = null; flushScheduled = false }
    }

    private fun track(name: String, own: Map<String, String> = emptyMap()) = submit { record(name, own) }

    private fun record(name: String, own: Map<String, String>) {
        val current = loaded()
        val band = usageBand(current.opens)
        val dims = mapOf("u" to band, "pl" to Platform, "pl.u" to "$Platform.$band") + own
        if (!validAnalyticsEvent(name, dims)) return
        if (debug) synchronized(events) { events += AnalyticsEvent(name, dims) }
        if (endpoint == null) return
        val queue = current.queue.toMutableList()
        val index = queue.indexOfFirst { it.t == name && it.d == dims }
        if (index >= 0) queue[index] = queue[index].let { it.copy(n = minOf(it.n + 1, AnalyticsCountCap)) }
        else queue += AnalyticsEntry(name, dims, 1)
        save(current.copy(queue = queue.takeLast(AnalyticsQueueCap)))
        if (!flushScheduled) {
            flushScheduled = true
            later(AnalyticsFlushDelayMillis, Runnable { flush() })
        }
    }

    private fun sendQueue() {
        val url = endpoint ?: return
        if (inFlight) return
        val sent = loaded().queue
        if (sent.isEmpty()) return
        val body = analyticsBody(sent)
        inFlight = true
        try {
            network.execute {
                val accepted = try { post(url, body) } catch (_: Exception) { false }
                submit {
                    inFlight = false
                    if (accepted) settle(sent)
                }
            }
        } catch (_: Exception) { inFlight = false }
    }

    // Subtract rather than clear: counts recorded while the request was in flight survive it.
    private fun settle(sent: List<AnalyticsEntry>) {
        val current = loaded()
        val kept = current.queue.mapNotNull { entry ->
            val left = entry.n - (sent.find { it.t == entry.t && it.d == entry.d }?.n ?: 0)
            if (left > 0) entry.copy(n = left) else null
        }
        save(current.copy(queue = kept))
    }

    private fun loaded(): AnalyticsState {
        state?.let { return it }
        if (endpoint == null) return AnalyticsState().also { state = it }
        val text = try { store.read() } catch (_: Exception) { null }
        val parsed = parseAnalyticsStore(text)
        if (parsed != null) return parsed.also { state = it }
        return AnalyticsState().also(::save)
    }

    private fun save(next: AnalyticsState) {
        state = next
        if (endpoint == null) return
        try { store.write(analyticsStoreText(next)) } catch (_: Exception) { }
    }

    private fun submit(task: () -> Unit) {
        try { worker.execute { try { task() } catch (_: Exception) { } } } catch (_: Exception) { }
    }

    companion object {
        fun create(debug: Boolean, store: AnalyticsStore, post: (String, String) -> Boolean = ::postAnalytics): Analytics {
            val worker = Executors.newSingleThreadScheduledExecutor(daemon("ilovetrains-analytics"))
            val network = Executors.newSingleThreadExecutor(daemon("ilovetrains-analytics-post"))
            return Analytics(debug, analyticsEndpoint(debug), store, post, worker, network) { delay, task ->
                worker.schedule(task, delay, TimeUnit.MILLISECONDS)
            }
        }

        private fun daemon(name: String) = ThreadFactory { task -> Thread(task, name).apply { isDaemon = true } }
    }
}

/** How home's answer came about (design: "Header kind on native"). Null is browsing an explicit choice. */
internal fun homeAnswerKind(focus: FocusedJourney?, browsing: Boolean, predicted: Selection?, tripId: String?, reverse: Boolean): HeaderKind? = when {
    focus != null -> if (focus.pinned) HeaderKind.Focus else HeaderKind.Inferred
    browsing -> null
    else -> predicted?.takeIf { it.tripId == tripId && it.reverse == reverse }?.kind
}

/** The lead journey Home shows for a trip answer, derived as HomeScreen derives it. */
internal fun displayedHomeLead(state: AppState): Journey? {
    val board = state.homeBoard ?: state.board ?: return null
    val trip = state.trips.find { it.id == state.selectedTripId } ?: return null
    val from = if (state.reverse) trip.to else trip.from
    val to = if (state.reverse) trip.from else trip.to
    if (board.from.id != from.id || board.to.id != to.id) return null
    val maxTransfers = state.transferLimit?.maxTransfers
    return retainedHomeJourney(board, state.now)?.takeUnless { it.cancelled }
        ?: selectRecommendation(board.recommendationCandidates(state.now, TransferConstraint(maxTransfers)),
            state.now, state.enabledModes, maxTransfers)?.journey
}

internal fun recordedNewRide(before: List<Ride>, after: List<Ride>, focus: FocusedJourney): Boolean {
    fun List<Ride>.holds() = any { it.tripId == focus.tripId && it.reverse == focus.reverse && it.departure == focus.journey.departure }
    return !before.holds() && after.holds()
}

/**
 * The per-open attribution rules of analytics.md, "Event vocabulary and ordering", kept as the web keeps
 * them in main.js. An open is a foreground entry, so a configuration change (no [backgrounded]) keeps its guards.
 */
internal class HeaderMetrics(private val analytics: Analytics) {
    private enum class Entry { Cold, Foreground, Background }
    private class Answer(val kind: HeaderKind, val tripId: String, val reverse: Boolean, val lead: () -> String?)

    private var entry = Entry.Cold
    private var opened = false
    private var tapped = false
    private var lastShown: String? = null
    private var answer: Answer? = null
    private var lastAnswer: Answer? = null
    private var setup = false
    private var setupSaved = false

    @Synchronized fun resumed() {
        if (entry == Entry.Foreground) return
        entry = Entry.Foreground
        opened = false; tapped = false; lastShown = null
        answer = null; lastAnswer = null; setup = false; setupSaved = false
        analytics.foreground()
    }

    @Synchronized fun backgrounded() {
        entry = Entry.Background
        analytics.background()
    }

    @Synchronized fun setupShown(newVisit: Boolean) {
        if (!open()) return
        if (newVisit) setupSaved = false
        setup = true; answer = null
    }

    @Synchronized fun setupSaved() { setupSaved = true }

    /** [kind] is null while Home shows an explicit choice: that counts the open but is no exposure. */
    @Synchronized fun homeShown(kind: HeaderKind?, tripId: String, reverse: Boolean, lead: () -> String?) {
        if (!open()) return
        if (kind == null) {
            // Leaving setup unsaved hands attribution back to the answer it interrupted.
            val last = lastAnswer
            if (setup && !setupSaved && last != null && last.tripId == tripId && last.reverse == reverse) {
                setup = false; answer = last
            }
            return
        }
        setup = false
        answer = Answer(kind, tripId, reverse, lead).also { lastAnswer = it }
        val key = "${kind.wire}:$tripId:$reverse"
        if (key == lastShown) return
        lastShown = key
        analytics.shown(kind)
    }

    @Synchronized fun tripTapped(tripId: String, reverse: Boolean) {
        if (entry != Entry.Foreground || tapped) return
        tapped = true
        val shown = answer ?: return
        if (shown.tripId == tripId && shown.reverse == reverse) analytics.hit(shown.kind) else analytics.miss(shown.kind)
    }

    @Synchronized fun pinned(tripId: String, reverse: Boolean, journeyKey: String) {
        val shown = answer
        released()
        if (entry != Entry.Foreground || shown == null) return
        val sameTrip = shown.tripId == tripId && shown.reverse == reverse
        if (sameTrip) analytics.hit(shown.kind)
        val result = if (!sameTrip) PinResult.Trip else when (runCatching(shown.lead).getOrNull()) {
            null -> return
            journeyKey -> PinResult.Same
            else -> PinResult.Service
        }
        analytics.pinned(shown.kind, result)
    }

    /** Pinning, unpinning and the way back end the attribution, as the web clears its header kind. */
    @Synchronized fun released() { answer = null; setup = false }

    fun rode(pinned: Boolean, basis: ArrivalBasis) = analytics.rode(pinned, basis)

    private fun open(): Boolean {
        if (entry != Entry.Foreground) return false
        if (!opened) { opened = true; analytics.recordOpen() }
        return true
    }
}
