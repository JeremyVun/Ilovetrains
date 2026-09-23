package com.ilovetrains.app

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.nio.file.Files
import java.util.concurrent.Executor
import kotlin.concurrent.thread

internal class MemoryAnalyticsStore(var text: String? = null) : AnalyticsStore {
    var reads = 0
    var writes = 0
    override fun read(): String? { reads++; return text }
    override fun write(text: String) { writes++; this.text = text }
}

internal class ManualExecutor : Executor {
    val tasks = ArrayDeque<Runnable>()
    override fun execute(command: Runnable) { tasks += command }
    fun runAll() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
}

internal class Posts(var status: Boolean = true) {
    val bodies = mutableListOf<String>()
    val urls = mutableListOf<String>()
    fun post(url: String, body: String): Boolean { urls += url; bodies += body; return status }
}

internal fun testAnalytics(
    debug: Boolean = false,
    store: AnalyticsStore = MemoryAnalyticsStore(),
    posts: Posts = Posts(),
    network: Executor = Executor { it.run() },
    later: MutableList<Runnable> = mutableListOf(),
    capture: String? = null,
) = Analytics(debug, analyticsEndpoint(debug, capture), store, posts::post, Executor { it.run() }, network) { _, task -> later += task }

internal fun storedQueue(store: MemoryAnalyticsStore): List<AnalyticsEntry> = requireNotNull(parseAnalyticsStore(store.text)).queue

private fun dims(u: String, vararg own: Pair<String, String>) = mapOf("u" to u, "pl" to "android", "pl.u" to "android.$u") + own

class AnalyticsTest {
    @Test fun bandsAndMilestonesFollowTheContractTable() {
        val bands = mapOf(0 to "1", 1 to "1", 2 to "2-5", 5 to "2-5", 6 to "6-10", 10 to "6-10", 11 to "11-15",
            15 to "11-15", 16 to "16-20", 46 to "46-50", 50 to "46-50", 51 to "51+", 5000 to "51+")
        bands.forEach { (opens, band) -> assertEquals("opens $opens", band, usageBand(opens)) }
        val milestones = (0..300).mapNotNull(::openMilestone)
        assertEquals(listOf("1", "5", "10", "15", "20", "25", "30", "40", "50", "75", "100", "150", "200", "250"), milestones)
    }

    @Test fun theNativeVocabularyIsClosedAndCarriesNoPairOrExperiment() {
        val kinds = listOf("predicted", "focus", "usual", "home", "inferred")
        val expected = kinds.flatMap { k -> listOf("shown_$k", "hit_$k", "miss_$k", "pinned_$k") }.toSet() +
            setOf("opened", "rode_pin", "rode_auto")
        assertEquals(expected, AnalyticsEventNames)
        assertTrue(validAnalyticsEvent("shown_home", dims("6-10")))
        assertFalse(validAnalyticsEvent("shown_pair", dims("6-10")))
        assertFalse(validAnalyticsEvent("shown_setup", dims("1") + ("f" to "empty")))
        assertFalse(validAnalyticsEvent("shown_home", dims("6-10") + ("x.strip-placement" to "a3")))
        assertFalse(validAnalyticsEvent("shown_home", mapOf("u" to "6-10", "pl" to "web", "pl.u" to "web.6-10")))
        assertFalse(validAnalyticsEvent("shown_home", mapOf("u" to "6-10", "pl" to "android", "pl.u" to "android.2-5")))
        assertTrue(validAnalyticsEvent("pinned_usual", dims("1", "r" to "service", "pl.r" to "android.service")))
        assertFalse(validAnalyticsEvent("pinned_usual", dims("1", "r" to "service")))
        assertFalse(validAnalyticsEvent("pinned_usual", dims("1", "r" to "wrong", "pl.r" to "android.wrong")))
        assertTrue(validAnalyticsEvent("rode_auto", dims("1", "b" to "location", "pl.b" to "android.location")))
        assertFalse(validAnalyticsEvent("rode_auto", dims("1", "b" to "location", "pl.b" to "ios.location")))
        assertFalse(validAnalyticsEvent("opened", dims("1", "m" to "3")))
        assertFalse(validAnalyticsEvent("hit_focus", dims("1", "m" to "1")))
    }

    @Test fun equalEventsCompactIntoOneCountedEntryInFirstRecordedOrder() {
        val store = MemoryAnalyticsStore()
        val analytics = testAnalytics(store = store)
        analytics.shown(HeaderKind.Usual)
        analytics.miss(HeaderKind.Usual)
        analytics.shown(HeaderKind.Usual)
        analytics.shown(HeaderKind.Usual)
        analytics.pinned(HeaderKind.Usual, PinResult.Service)
        analytics.pinned(HeaderKind.Usual, PinResult.Same)
        analytics.pinned(HeaderKind.Usual, PinResult.Service)
        assertEquals(listOf(
            AnalyticsEntry("shown_usual", dims("1"), 3),
            AnalyticsEntry("miss_usual", dims("1"), 1),
            AnalyticsEntry("pinned_usual", dims("1", "r" to "service", "pl.r" to "android.service"), 2),
            AnalyticsEntry("pinned_usual", dims("1", "r" to "same", "pl.r" to "android.same"), 1),
        ), storedQueue(store))
    }

    @Test fun theQueueKeepsTheNewestTwoHundredEntries() {
        val seeded = distinctEntries(AnalyticsQueueCap)
        val store = MemoryAnalyticsStore(analyticsStoreText(AnalyticsState(60, seeded)))
        val analytics = testAnalytics(store = store)
        analytics.rode(pinned = true, basis = ArrivalBasis.Estimate)
        val queue = storedQueue(store)
        assertEquals(AnalyticsQueueCap, queue.size)
        assertEquals(seeded.drop(1), queue.dropLast(1))
        assertEquals(AnalyticsEntry("rode_pin", dims("51+", "b" to "estimate", "pl.b" to "android.estimate"), 1), queue.last())
    }

    @Test fun aCompactedCountSaturatesAtTheCollectorCeiling() {
        val full = AnalyticsEntry("shown_home", dims("1"), AnalyticsCountCap - 1)
        val store = MemoryAnalyticsStore(analyticsStoreText(AnalyticsState(0, listOf(full))))
        val analytics = testAnalytics(store = store)
        repeat(3) { analytics.shown(HeaderKind.Home) }
        assertEquals(listOf(full.copy(n = AnalyticsCountCap)), storedQueue(store))
    }

    @Test fun aSuccessfulPostSettlesOnlyTheSnapshotItSent() {
        val store = MemoryAnalyticsStore()
        val posts = Posts()
        val network = ManualExecutor()
        val analytics = testAnalytics(store = store, posts = posts, network = network)
        analytics.shown(HeaderKind.Predicted)
        analytics.shown(HeaderKind.Predicted)
        analytics.flush()
        assertEquals(1, network.tasks.size)
        analytics.shown(HeaderKind.Predicted)
        analytics.hit(HeaderKind.Predicted)
        analytics.flush()
        analytics.background()
        assertEquals("one request is in flight at a time", 1, network.tasks.size)
        network.runAll()

        val sent = JSONArray(posts.bodies.single())
        assertEquals(1, sent.length())
        val entry = sent.getJSONObject(0)
        assertEquals(setOf("p", "t", "d", "n"), entry.keys().asSequence().toSet())
        assertEquals("ilovetrains", entry.getString("p"))
        assertEquals("shown_predicted", entry.getString("t"))
        assertEquals(2, entry.getInt("n"))
        assertEquals(AnalyticsEndpoint, posts.urls.single())
        assertEquals(listOf(AnalyticsEntry("shown_predicted", dims("1"), 1), AnalyticsEntry("hit_predicted", dims("1"), 1)),
            storedQueue(store))
    }

    @Test fun aRefusedOrFailedPostKeepsEveryCount() {
        val store = MemoryAnalyticsStore()
        val posts = Posts(status = false)
        val analytics = testAnalytics(store = store, posts = posts)
        analytics.shown(HeaderKind.Focus)
        analytics.flush()
        assertEquals(listOf(AnalyticsEntry("shown_focus", dims("1"), 1)), storedQueue(store))
        val throwing = Analytics(false, AnalyticsEndpoint, store, { _, _ -> error("offline") },
            Executor { it.run() }, Executor { it.run() }) { _, _ -> }
        throwing.flush()
        assertEquals(listOf(AnalyticsEntry("shown_focus", dims("1"), 1)), storedQueue(store))
        posts.status = true
        analytics.flush()
        assertEquals(emptyList<AnalyticsEntry>(), storedQueue(store))
        assertEquals(2, posts.bodies.size)
    }

    @Test fun theFirstEventOfAForegroundSessionSchedulesOneFlushAndReturningSendsLeftovers() {
        val store = MemoryAnalyticsStore()
        val posts = Posts(status = false)
        val later = mutableListOf<Runnable>()
        val analytics = testAnalytics(store = store, posts = posts, later = later)
        analytics.shown(HeaderKind.Usual)
        analytics.hit(HeaderKind.Usual)
        assertEquals(1, later.size)
        later.single().run()
        assertEquals(1, posts.bodies.size)
        analytics.foreground()
        assertEquals("a foreground entry sends what is still queued", 2, posts.bodies.size)
        analytics.miss(HeaderKind.Usual)
        assertEquals(2, later.size)
        posts.status = true
        analytics.background()
        assertEquals(emptyList<AnalyticsEntry>(), storedQueue(store))
        analytics.foreground()
        assertEquals("nothing queued, nothing sent", 3, posts.bodies.size)
    }

    @Test fun aMalformedStoreIsDroppedWhole() {
        val valid = """{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10"},"n":4}"""
        val malformed = listOf(
            "not json",
            """{"opens":7}""",
            """{"opens":-1,"queue":[]}""",
            """{"opens":2.5,"queue":[]}""",
            """{"opens":"7","queue":[]}""",
            """{"opens":7,"queue":[],"bucket":3}""",
            """{"opens":7,"queue":{}}""",
            """{"opens":7,"queue":[$valid,{"t":"shown_pair","d":{"u":"6-10","pl":"android","pl.u":"android.6-10"},"n":1}]}""",
            """{"opens":7,"queue":[$valid,{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10","x.strip-placement":"a3"},"n":1}]}""",
            """{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10"},"n":1}]}""",
            """{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10"},"n":0}]}""",
            """{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10"},"n":1000001}]}""",
            """{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10"},"n":1,"p":"ilovetrains"}]}""",
            """{"opens":7,"queue":[{"t":"pinned_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10","r":"same"},"n":1}]}""",
            """{"opens":7,"queue":[{"t":"shown_home","d":{"u":"6-10","pl":"android","pl.u":"android.6-10","n":1},"n":1}]}""",
        )
        for (text in malformed) {
            assertNull(text, parseAnalyticsStore(text))
            val store = MemoryAnalyticsStore(text)
            val analytics = testAnalytics(store = store)
            analytics.recordOpen()
            val state = requireNotNull(parseAnalyticsStore(store.text))
            assertEquals(text, 1, state.opens)
            assertEquals(text, listOf(AnalyticsEntry("opened", dims("1", "m" to "1"), 1)), state.queue)
        }
        assertEquals(AnalyticsState(7, listOf(AnalyticsEntry("shown_home", dims("6-10"), 4))),
            parseAnalyticsStore("""{"opens":7,"queue":[$valid]}"""))
        assertEquals(AnalyticsState(), parseAnalyticsStore(null))
    }

    @Test fun theFileStoreRoundTripsAndReplacesAtomically() {
        val directory = Files.createTempDirectory("ilt-analytics").toFile()
        try {
            val file = java.io.File(directory, AnalyticsStoreName)
            val store = FileAnalyticsStore(file)
            assertNull(store.read())
            val analytics = testAnalytics(store = store)
            analytics.recordOpen()
            analytics.shown(HeaderKind.Predicted)
            val reopened = testAnalytics(store = FileAnalyticsStore(file))
            reopened.recordOpen()
            val state = requireNotNull(parseAnalyticsStore(file.readText()))
            assertEquals(2, state.opens)
            assertEquals(listOf("opened", "shown_predicted"), state.queue.map { it.t })
            assertEquals(listOf(AnalyticsStoreName), directory.list()!!.toList())
        } finally { directory.deleteRecursively() }
    }

    @Test fun aDebugBuildKeepsALedgerAndNeverPersistsOrSends() {
        val store = MemoryAnalyticsStore("""{"opens":40,"queue":[]}""")
        val posts = Posts()
        val later = mutableListOf<Runnable>()
        val analytics = testAnalytics(debug = true, store = store, posts = posts, later = later)
        assertFalse(analytics.enabled)
        analytics.recordOpen()
        analytics.shown(HeaderKind.Home)
        analytics.rode(pinned = false, basis = ArrivalBasis.Location)
        analytics.flush(); analytics.background(); analytics.foreground()
        assertEquals(listOf(
            AnalyticsEvent("opened", dims("1", "m" to "1")),
            AnalyticsEvent("shown_home", dims("1")),
            AnalyticsEvent("rode_auto", dims("1", "b" to "location", "pl.b" to "android.location")),
        ), analytics.ledger)
        assertEquals(0, store.reads + store.writes)
        assertTrue(posts.bodies.isEmpty())
        assertTrue(later.isEmpty())
    }

    @Test fun onlyADebugBuildHonoursTheCaptureOverride() {
        assertEquals(AnalyticsEndpoint, analyticsEndpoint(debug = false))
        assertEquals(AnalyticsEndpoint, analyticsEndpoint(debug = false, capture = "http://10.0.2.2:9000/e"))
        assertNull(analyticsEndpoint(debug = true))
        assertNull(analyticsEndpoint(debug = true, capture = "not a url"))
        assertNull(analyticsEndpoint(debug = true, capture = "file:///sdcard/e"))
        assertEquals("http://10.0.2.2:9000/e", analyticsEndpoint(debug = true, capture = "http://10.0.2.2:9000/e"))

        val releasePosts = Posts()
        val release = testAnalytics(debug = false, posts = releasePosts)
        release.captureTo("http://10.0.2.2:9000/e")
        release.shown(HeaderKind.Usual); release.flush()
        assertEquals(listOf(AnalyticsEndpoint), releasePosts.urls)
        assertTrue("release keeps no ledger", release.ledger.isEmpty())

        val store = MemoryAnalyticsStore()
        val debugPosts = Posts()
        val debug = testAnalytics(debug = true, store = store, posts = debugPosts)
        debug.shown(HeaderKind.Usual); debug.flush()
        assertTrue(debugPosts.urls.isEmpty())
        debug.captureTo("http://10.0.2.2:9000/e")
        debug.shown(HeaderKind.Usual); debug.flush()
        assertEquals(listOf("http://10.0.2.2:9000/e"), debugPosts.urls)
        assertEquals(1, JSONArray(debugPosts.bodies.single()).length())
    }

    @Test fun theBuildThisSuiteRunsInNeverSendsWithoutTheOverride() {
        assumeTrue("only a debug build's unit tests exercise this path", BuildConfig.DEBUG)
        val store = MemoryAnalyticsStore()
        val posts = Posts()
        val analytics = Analytics.create(BuildConfig.DEBUG, store, posts::post)
        analytics.recordOpen(); analytics.shown(HeaderKind.Predicted)
        analytics.flush(); analytics.background(); analytics.foreground()
        analytics.hit(HeaderKind.Predicted)
        val deadline = System.currentTimeMillis() + 5_000
        while (analytics.ledger.size < 3 && System.currentTimeMillis() < deadline) Thread.sleep(10)
        assertEquals(listOf("opened", "shown_predicted", "hit_predicted"), analytics.ledger.map { it.t })
        assertTrue(posts.bodies.isEmpty())
        assertEquals(0, store.reads + store.writes)
    }

    @Test fun countingNeverThrowsWhenTheStoreOrNetworkFails() {
        val broken = object : AnalyticsStore {
            override fun read(): String = error("unreadable")
            override fun write(text: String) = error("disk full")
        }
        val analytics = Analytics(false, AnalyticsEndpoint, broken, { _, _ -> error("offline") },
            Executor { it.run() }, Executor { error("rejected") }) { _, _ -> error("no timer") }
        analytics.recordOpen(); analytics.shown(HeaderKind.Usual); analytics.flush(); analytics.background()
        val rejecting = Analytics(false, AnalyticsEndpoint, MemoryAnalyticsStore(), { _, _ -> true },
            Executor { error("rejected") }, Executor { it.run() }) { _, _ -> }
        rejecting.shown(HeaderKind.Usual); rejecting.flush(); rejecting.captureTo("http://127.0.0.1/e")
    }

    @Test fun countingReturnsBeforeTheWorkerHasRun() {
        val worker = ManualExecutor()
        val store = MemoryAnalyticsStore()
        val analytics = Analytics(false, AnalyticsEndpoint, store, { _, _ -> true }, worker, Executor { it.run() }) { _, _ -> }
        analytics.recordOpen(); analytics.shown(HeaderKind.Usual); analytics.flush()
        assertEquals(0, store.reads + store.writes)
        worker.runAll()
        assertTrue(store.writes > 0)
    }

    @Test fun thePostIsOneJsonArrayWithoutCookiesOrCredentials() {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        var head = ""
        var body = ""
        val serving = thread(isDaemon = true) {
            runCatching {
                server.accept().use { socket ->
                    val input = socket.getInputStream()
                    val raw = ByteArrayOutputStream()
                    while (!String(raw.toByteArray(), Charsets.ISO_8859_1).endsWith("\r\n\r\n")) {
                        val byte = input.read()
                        if (byte < 0) break
                        raw.write(byte)
                    }
                    head = String(raw.toByteArray(), Charsets.ISO_8859_1)
                    val length = head.lines().first { it.startsWith("Content-Length:", ignoreCase = true) }.substringAfter(':').trim().toInt()
                    val bytes = ByteArray(length)
                    var read = 0
                    while (read < length) { val count = input.read(bytes, read, length - read); if (count < 0) break; read += count }
                    body = String(bytes, 0, read)
                    socket.getOutputStream().write("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".toByteArray())
                    socket.getOutputStream().flush()
                }
            }
        }
        try {
            val url = "http://127.0.0.1:${server.localPort}/e"
            val payload = analyticsBody(listOf(AnalyticsEntry("rode_pin", dims("2-5", "b" to "location", "pl.b" to "android.location"), 2)))
            assertTrue(postAnalytics(url, payload))
        } finally { server.close(); serving.join(2000) }
        assertTrue(head.startsWith("POST /e HTTP/1.1\r\n"))
        val headers = head.lines().drop(1).filter { it.isNotEmpty() }.map { it.substringBefore(':').lowercase() }
        assertTrue(head.lines().any { it.equals("Content-Type: application/json", ignoreCase = true) })
        assertFalse(headers.any { it == "cookie" || it == "authorization" })
        val entry = JSONArray(body).getJSONObject(0)
        assertEquals("rode_pin", entry.getString("t"))
        assertEquals(2, entry.getInt("n"))
        assertEquals(mapOf("u" to "2-5", "pl" to "android", "pl.u" to "android.2-5", "b" to "location", "pl.b" to "android.location"),
            entry.getJSONObject("d").let { d -> d.keys().asSequence().associateWith(d::getString) })
    }

    @Test fun aServerErrorIsNotAnAcceptance() {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serving = thread(isDaemon = true) {
            runCatching {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    while (!reader.readLine().isNullOrEmpty()) { }
                    socket.getOutputStream().write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    socket.getOutputStream().flush()
                }
            }
        }
        try { assertFalse(postAnalytics("http://127.0.0.1:${server.localPort}/e", "[]")) }
        finally { server.close(); serving.join(2000) }
    }

    private fun distinctEntries(count: Int): List<AnalyticsEntry> {
        val bands = listOf("1", "2-5", "6-10", "11-15", "16-20", "21-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51+")
        val kinds = HeaderKind.entries.map(HeaderKind::wire)
        val plain = kinds.flatMap { k -> listOf("shown_$k", "hit_$k", "miss_$k") }.map { it to emptyMap<String, String>() }
        val pins = kinds.flatMap { k -> PinResult.entries.map { r -> "pinned_$k" to mapOf("r" to r.wire, "pl.r" to "android.${r.wire}") } }
        return (plain + pins).flatMap { (name, own) -> bands.map { AnalyticsEntry(name, dims(it) + own, 1) } }
            .take(count).also { check(it.size == count) }
    }
}
