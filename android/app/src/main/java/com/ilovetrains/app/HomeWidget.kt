package com.ilovetrains.app

import android.appwidget.AppWidgetManager
import android.content.Context
import android.util.AtomicFile
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

private val ContentKey = stringPreferencesKey("content")
private val SmallSize = DpSize(110.dp, 110.dp)
private val WideSize = DpSize(250.dp, 110.dp)
private const val WidgetRenderHorizon = 24 * 60 * 60_000L

/** Renders what the refresh worker last computed; provideGlance runs once per session, so it never computes itself. */
class HomeTripWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SmallSize, WideSize))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val content = currentState(ContentKey)?.let { runCatching { WidgetWire.content(JSONObject(it)) }.getOrNull() }
            HomeTripPlaceholder(content, wide = LocalSize.current.width >= WideSize.width)
        }
    }
}

class HomeTripWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = HomeTripWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        HomeWidgetWork.refresh(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        HomeWidgetWork.cancel(context)
    }
}

class HomeWidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val ids = GlanceAppWidgetManager(context).getGlanceIds(HomeTripWidget::class.java)
        if (ids.isEmpty()) {
            HomeWidgetWork.cancel(context)
            return Result.success()
        }
        val now = System.currentTimeMillis()
        val snapshot = DeviceStore(context).widget() ?: WidgetSnapshot(now, emptyList(), emptyList(), null, emptyList(), null, emptyList())
        val sources = widgetAnswer(snapshot, now)?.let { answer ->
            val request = widgetRequest(answer, snapshot, now)
            val cache = WidgetDepartureCache(File(context.cacheDir, "widget-departures.json"))
            val fetched = cache.fresh(request.key, now) ?: runCatching {
                TransitApi().departures(request.from, request.to, request.modes, request.at, request.transferLimit)
            }.getOrNull()?.also { cache.put(request.key, it, now) }
            widgetSource(request, fetched)?.let { mapOf(request.key to it) }
        }.orEmpty()
        val json = WidgetWire.content(widgetContent(snapshot, sources, now)).toString()
        ids.forEach { id -> updateAppWidgetState(context, id) { it[ContentKey] = json } }
        HomeTripWidget().updateAll(context)
        widgetNextBoundary(snapshot, sources, now, now + WidgetRenderHorizon)?.let { HomeWidgetWork.redrawAt(context, it - now) }
        return Result.success()
    }
}

object HomeWidgetWork {
    private const val Now = "home-widget-now"
    private const val Periodic = "home-widget-periodic"
    private const val Boundary = "home-widget-boundary"

    fun refresh(context: Context) {
        val work = WorkManager.getInstance(context)
        work.enqueueUniqueWork(Now, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<HomeWidgetWorker>().build())
        work.enqueueUniquePeriodicWork(Periodic, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<HomeWidgetWorker>(WidgetLiveRefresh, TimeUnit.MILLISECONDS).build())
    }

    fun redrawAt(context: Context, delayMillis: Long) {
        WorkManager.getInstance(context).enqueueUniqueWork(Boundary, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<HomeWidgetWorker>().setInitialDelay(delayMillis.coerceAtLeast(0), TimeUnit.MILLISECONDS).build())
    }

    fun cancel(context: Context) {
        val work = WorkManager.getInstance(context)
        listOf(Now, Periodic, Boundary).forEach(work::cancelUniqueWork)
    }

    suspend fun placed(context: Context) = GlanceAppWidgetManager(context).getGlanceIds(HomeTripWidget::class.java).isNotEmpty()
}

/** The widget's own fetches, reused inside the live-data floor so a redraw at a departure costs no request. */
internal class WidgetDepartureCache(file: File) {
    private val store = AtomicFile(file)

    fun fresh(key: String, now: Long): BoardData? = entries().find { it.first == key && now - it.second in 0 until WidgetLiveRefresh }?.third

    fun put(key: String, board: BoardData, now: Long) {
        val kept = (listOf(Triple(key, now, board)) + entries().filter { it.first != key }).take(4)
        val stream = store.startWrite()
        try {
            stream.write(JSONArray(kept.map { JSONObject().put("key", it.first).put("fetchedAt", it.second).put("board", Wire.board(it.third)) })
                .toString().toByteArray())
            store.finishWrite(stream)
        } catch (e: Exception) {
            store.failWrite(stream)
        }
    }

    private fun entries(): List<Triple<String, Long, BoardData>> = runCatching {
        JSONArray(store.openRead().bufferedReader().use { it.readText() })
            .readEach { Triple(it.getString("key"), it.getLong("fetchedAt"), Wire.board(it.getJSONObject("board"))) }
    }.getOrDefault(emptyList())
}

/** Temporary: prints the answer until the visual build replaces it. */
@Composable
private fun HomeTripPlaceholder(content: WidgetContent?, wide: Boolean) {
    Column(GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).padding(12.dp)
        .clickable(actionStartActivity<MainActivity>())) {
        homeWidgetLines(content, wide).forEach { Text(it, style = TextStyle(color = GlanceTheme.colors.onSurface), maxLines = 1) }
    }
}

internal fun homeWidgetLines(content: WidgetContent?, wide: Boolean): List<String> {
    content ?: return emptyList()
    val answer = content.answer ?: return listOf("New trip")
    val lines = mutableListOf("${answer.from.station.shortName} → ${answer.to.station.shortName}")
    if (answer.focus?.pinned == true) lines += "Pinned"
    val next = content.next
    lines += when {
        next != null -> (listOf(next) + if (wide) content.following else emptyList()).joinToString(" · ") { clockTime(it.effectiveDeparture) }
        content.board == null -> "No saved board for this trip yet"
        content.board.offline -> "No services on the last board we could load"
        else -> "No services in the next few hours"
    }
    content.provenance?.let { lines += it }
    return lines
}
