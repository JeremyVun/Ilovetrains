package com.ilovetrains.app

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.util.AtomicFile
import android.util.TypedValue
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider as dayNight
import androidx.glance.color.isNightMode
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
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

internal val WidgetContentKey = stringPreferencesKey("content")
private const val WidgetRenderHorizon = 24 * 60 * 60_000L
const val WidgetOpenExtra = "com.ilovetrains.app.WIDGET_OPEN"
const val WidgetOpenHome = "home"
const val WidgetOpenSetup = "setup"

/** Renders what the refresh worker last computed; provideGlance runs once per session, so it never computes itself. */
class HomeTripWidget : GlanceAppWidget() {
    // Exact sizes let the rows draw the journey axis to scale and fit names by measurement.
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val content = currentState(WidgetContentKey)?.let { runCatching { WidgetWire.content(JSONObject(it)) }.getOrNull() }
            val size = LocalSize.current
            HomeTripWidgetContent(widgetView(content, size.width.value, size.height.value, PaintWidgetMeasure(LocalContext.current)))
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
        ids.forEach { id -> updateAppWidgetState(context, id) { it[WidgetContentKey] = json } }
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

internal class PaintWidgetMeasure(context: Context) : WidgetMeasure {
    private val metrics = context.resources.displayMetrics
    private val paints = HashMap<WidgetFont, Paint>()

    private fun paint(font: WidgetFont) = paints.getOrPut(font) {
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = widgetTypeface(font.face)
            textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, font.sp, metrics)
            letterSpacing = font.face.tracking
        }
    }

    override fun width(text: String, font: WidgetFont) = paint(font).measureText(text) / metrics.density
    override fun lineHeight(font: WidgetFont) = paint(font).fontMetrics.let { it.descent - it.ascent } / metrics.density
}

private fun widgetTypeface(face: WidgetFace): Typeface = if (Build.VERSION.SDK_INT >= 28) {
    Typeface.create(Typeface.SANS_SERIF, face.weight, false)
} else when (face) {
    WidgetFace.Thin, WidgetFace.Light -> Typeface.create("sans-serif-light", Typeface.NORMAL)
    WidgetFace.Label -> Typeface.create("sans-serif-medium", Typeface.NORMAL)
    WidgetFace.Chip -> Typeface.DEFAULT_BOLD
    WidgetFace.Regular -> Typeface.SANS_SERIF
}

private data class DayNight(val day: Color, val night: Color) {
    val provider get() = dayNight(day = day, night = night)
    fun faded() = DayNight(lerp(LightColors.ground, day, .3f), lerp(DarkColors.ground, night, .3f))
}

private val Ground = DayNight(LightColors.ground, DarkColors.ground)
private val RuleColor = DayNight(LightColors.rule, DarkColors.rule)
private fun tone(tone: WidgetTone) = when (tone) {
    WidgetTone.Ink -> DayNight(LightColors.ink, DarkColors.ink)
    WidgetTone.Ink2 -> DayNight(LightColors.ink2, DarkColors.ink2)
    WidgetTone.Ink3 -> DayNight(LightColors.ink3, DarkColors.ink3)
    WidgetTone.Warn -> DayNight(LightColors.warning, DarkColors.warning)
}
private fun fill(chip: WidgetChip) = DayNight(lineColor(chip.line, chip.mode, LightColors, fill = true),
    lineColor(chip.line, chip.mode, DarkColors, fill = true)).let { if (chip.faded) it.faded() else it }
private fun chipInk(chip: WidgetChip) = DayNight(chipInk(chip.line, chip.mode, LightColors), chipInk(chip.line, chip.mode, DarkColors))
    .let { if (chip.faded) it.faded() else it }

// A span cannot follow the night switch, and label ink composites to nearly the same grey on both grounds.
private val ArrowGrey = lerp(lerp(DarkColors.ground, DarkColors.ink3.copy(alpha = 1f), DarkColors.ink3.alpha),
    lerp(LightColors.ground, LightColors.ink3.copy(alpha = 1f), LightColors.ink3.alpha), .5f)

private fun RemoteViews.color(context: Context, id: Int, colors: DayNight) {
    if (Build.VERSION.SDK_INT >= 31) setColorInt(id, "setTextColor", colors.day.toArgb(), colors.night.toArgb())
    else setTextColor(id, (if (context.isNightMode) colors.night else colors.day).toArgb())
}

private fun layoutOf(face: WidgetFace) = when (face) {
    WidgetFace.Thin -> R.layout.widget_text_thin
    WidgetFace.Light -> R.layout.widget_text_light
    WidgetFace.Regular -> R.layout.widget_text_regular
    WidgetFace.Label -> R.layout.widget_text_label
    WidgetFace.Chip -> R.layout.widget_text_chip
}

private fun styled(text: WidgetText): CharSequence {
    val arrow = text.text.indexOf("\u00A0→").takeIf { it >= 0 }?.plus(1)
    if (!text.struck && arrow == null) return text.text
    return SpannableString(text.text).apply {
        if (text.struck) setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        arrow?.let { setSpan(ForegroundColorSpan(ArrowGrey.toArgb()), it, it + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    }
}

@Composable
private fun WText(text: WidgetText, modifier: GlanceModifier = GlanceModifier, colors: DayNight = tone(text.tone)) {
    val context = LocalContext.current
    val views = RemoteViews(context.packageName, layoutOf(text.font.face)).apply {
        setTextViewText(R.id.widget_text, styled(text))
        setTextViewTextSize(R.id.widget_text, TypedValue.COMPLEX_UNIT_SP, text.font.sp)
        setInt(R.id.widget_text, "setMaxLines", text.maxLines)
        color(context, R.id.widget_text, colors)
    }
    // Bare RemoteViews filled the main axis of any exactly sized parent, so each sits in a wrapping Glance box.
    Box(text.width?.let { modifier.width(it.dp) } ?: modifier) { AndroidRemoteViews(views) }
}

@Composable
private fun WSentence(sentence: WidgetSentence, modifier: GlanceModifier = GlanceModifier) {
    val context = LocalContext.current
    val views = RemoteViews(context.packageName, R.layout.widget_sentence).apply {
        setTextViewText(R.id.widget_sentence_lead, sentence.lead)
        setInt(R.id.widget_sentence_lead, "setMaxLines", sentence.maxLines)
        listOf(R.id.widget_sentence_lead, R.id.widget_sentence_timer).forEach {
            setTextViewTextSize(it, TypedValue.COMPLEX_UNIT_SP, sentence.sp)
        }
        color(context, R.id.widget_sentence_lead, tone(WidgetTone.Ink2))
        color(context, R.id.widget_sentence_timer, tone(WidgetTone.Ink))
        // The chronometer ticks on the elapsed-realtime clock, so the wall-clock departure is carried across at render.
        setChronometer(R.id.widget_sentence_timer, SystemClock.elapsedRealtime() + sentence.deadline - System.currentTimeMillis(), null, true)
        setChronometerCountDown(R.id.widget_sentence_timer, true)
    }
    Box(modifier) { AndroidRemoteViews(views) }
}

@Composable
private fun WChip(chip: WidgetChip, modifier: GlanceModifier = GlanceModifier, height: Float = WidgetDimens.CapHeight,
                  pad: Float = WidgetDimens.CapPad) {
    Box(modifier.height(height.dp).background(fill(chip).provider).cornerRadius(LineChipCornerRadius).padding(horizontal = pad.dp),
        contentAlignment = Alignment.Center) {
        WText(WidgetText(chip.text, WidgetType.Chip, WidgetTone.Ink), colors = chipInk(chip))
    }
}

@Composable
private fun Pin(colors: DayNight = tone(WidgetTone.Ink2)) {
    Image(ImageProvider(R.drawable.widget_pin), null, GlanceModifier.size(WidgetDimens.PinMark.dp),
        colorFilter = ColorFilter.tint(colors.provider))
}

@Composable
private fun Kicker(kicker: WidgetKicker, modifier: GlanceModifier = GlanceModifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        kicker.parts.forEachIndexed { i, part ->
            if (part == null) {
                Pin()
                if (i < kicker.parts.lastIndex) Spacer(GlanceModifier.width(4.dp))
            } else WText(part)
        }
    }
}

private fun openIntent(context: Context, setup: Boolean) = Intent(context, MainActivity::class.java)
    .putExtra(WidgetOpenExtra, if (setup) WidgetOpenSetup else WidgetOpenHome)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

@Composable
internal fun HomeTripWidgetContent(view: WidgetView) {
    val context = LocalContext.current
    Box(GlanceModifier.fillMaxSize().appWidgetBackground().background(Ground.provider)
        .cornerRadius(android.R.dimen.system_app_widget_background_radius)
        .clickable(actionStartActivity(openIntent(context, setup = view is WidgetEmpty)))) {
        when (view) {
            WidgetBlank -> Unit
            is WidgetEmpty -> EmptyWidget(view)
            is WidgetSmall -> SmallWidget(view)
            is WidgetBoard -> BoardWidget(view)
        }
    }
}

@Composable
private fun EmptyWidget(view: WidgetEmpty) {
    val d = WidgetDimens
    Column(GlanceModifier.fillMaxSize().padding(start = d.SmallPadSide.dp, end = d.SmallPadSide.dp, top = d.SmallPadTop.dp)) {
        WText(view.kicker)
        WText(view.message, GlanceModifier.padding(top = 10.dp))
    }
}

@Composable
private fun SmallWidget(view: WidgetSmall) {
    val d = WidgetDimens
    val g = view.gap
    Column(GlanceModifier.fillMaxSize().padding(start = d.SmallPadSide.dp, end = d.SmallPadSide.dp, top = d.SmallPadTop.dp,
        bottom = d.SmallPadBottom.dp)) {
        Column(GlanceModifier.fillMaxWidth()) {
            view.kicker?.let { Kicker(it, GlanceModifier.padding(bottom = (d.KickerGap * g).dp)) }
            view.route?.let { WText(it) }
            view.note?.let { WText(it, GlanceModifier.padding(top = (d.NoteGap * g).dp)) }
            view.clock?.let { WText(it, GlanceModifier.padding(top = (d.ClockGap * g).dp)) }
            if (view.meta.isNotEmpty()) Row(GlanceModifier.padding(top = (d.MetaGap * g).dp), verticalAlignment = Alignment.CenterVertically) {
                view.meta.forEachIndexed { i, text -> WText(text, if (i > 0) GlanceModifier.padding(start = 7.dp) else GlanceModifier) }
            }
            view.sentence?.let { WSentence(it, GlanceModifier.padding(top = ((if (view.meta.isEmpty() && view.step.isEmpty()) d.SentenceGap else d.MetaGap) * g).dp)) }
            if (view.step.isNotEmpty()) Row(GlanceModifier.padding(top = (d.StepGap * g).dp), verticalAlignment = Alignment.CenterVertically) {
                view.step.forEachIndexed { i, text ->
                    if (i > 0) Spacer(GlanceModifier.width(d.StepNameGap.dp))
                    WText(text)
                }
            }
        }
        Spacer(GlanceModifier.defaultWeight())
        Column(GlanceModifier.fillMaxWidth()) {
            CapAndArrival(view)
            view.nextStep?.let { next ->
                Row(GlanceModifier.fillMaxWidth().padding(top = (d.StepGap * g).dp), verticalAlignment = Alignment.CenterVertically) {
                    WText(next.time)
                    WText(next.action, GlanceModifier.padding(start = 7.dp, end = 7.dp))
                    next.chip?.let { WChip(it, height = d.LaneHeight + 2, pad = d.LaneChipPad) }
                }
            }
            view.message?.let { WText(it) }
            view.foot?.let { WText(it, GlanceModifier.padding(top = (d.FootGap * g).dp)) }
        }
    }
}

@Composable
private fun CapAndArrival(view: WidgetSmall) {
    val d = WidgetDimens
    val g = view.gap
    val cap = view.cap
    val arrival = view.arrival
    if (cap == null && arrival == null) return
    if (view.stacked || cap == null || arrival == null) {
        Column(GlanceModifier.fillMaxWidth().padding(top = (d.CapGap * g).dp)) {
            cap?.let { WChip(it) }
            arrival?.let {
                Box(GlanceModifier.fillMaxWidth().padding(top = if (cap != null) (d.ArrivalGap * g).dp else 0.dp), contentAlignment = Alignment.CenterEnd) { WText(it) }
            }
        }
    } else {
        Box(GlanceModifier.fillMaxWidth().padding(top = (d.CapGap * g).dp), contentAlignment = Alignment.CenterStart) {
            WChip(cap)
            Box(GlanceModifier.fillMaxWidth().height(d.CapHeight.dp), contentAlignment = Alignment.CenterEnd) { WText(arrival) }
        }
    }
}

@Composable
private fun BoardWidget(view: WidgetBoard) {
    val d = WidgetDimens
    val side = GlanceModifier.padding(horizontal = d.BoardPadSide.dp)
    Column(GlanceModifier.fillMaxSize().padding(top = d.BoardPadTop.dp, bottom = d.BoardPadBottom.dp)) {
        // Layered at measured widths, so a long route wraps before it reaches the countdown.
        Box(side.fillMaxWidth().padding(bottom = d.HeadGap.dp)) {
            view.kicker?.let { Kicker(it, GlanceModifier.width(view.routeWidth.dp)) }
            view.route?.let { WText(it, GlanceModifier.width(view.routeWidth.dp)) }
            view.sentence?.let { Box(GlanceModifier.fillMaxWidth(), contentAlignment = Alignment.TopEnd) { WSentence(it) } }
        }
        if (view.rows.isNotEmpty()) Column(GlanceModifier.fillMaxWidth()) {
            view.rows.forEachIndexed { i, row ->
                if (i > 0) Box(GlanceModifier.fillMaxWidth().height(1.dp).background(RuleColor.provider)) {}
                val height = (view.rowHeight - if (i > 0) 1 else 0).dp
                when (row) {
                    is WidgetServiceRow -> ServiceRow(row, view, side.fillMaxWidth().height(height))
                    is WidgetStepRow -> StepRow(row, view, side.fillMaxWidth().height(height))
                }
            }
        }
        if (view.end.isNotEmpty()) Column(side.fillMaxWidth().padding(top = d.RowMetaGap.dp)) {
            view.end.forEach { WText(it) }
        }
        view.message?.let { Box(side.fillMaxWidth().defaultWeight(), contentAlignment = Alignment.BottomStart) { WText(it) } }
            ?: Spacer(GlanceModifier.defaultWeight())
        view.foot?.let { WText(it, side.padding(top = d.BoardFootGap.dp)) }
    }
}

@Composable
private fun ServiceRow(row: WidgetServiceRow, view: WidgetBoard, modifier: GlanceModifier) {
    val d = WidgetDimens
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Row(GlanceModifier.width(view.clockWidth.dp), verticalAlignment = Alignment.CenterVertically) {
            WText(row.clock)
            if (row.pinned) {
                Spacer(GlanceModifier.width(d.PinGap.dp))
                Pin()
            }
        }
        Spacer(GlanceModifier.width(d.ColumnGap.dp))
        Column(GlanceModifier.width(view.laneWidth.dp)) {
            Lane(row.lane, view.laneWidth)
            if (row.meta.isNotEmpty()) Row(GlanceModifier.padding(top = d.RowMetaGap.dp), verticalAlignment = Alignment.CenterVertically) {
                row.meta.forEachIndexed { i, text -> WText(text, if (i > 0) GlanceModifier.padding(start = 6.dp) else GlanceModifier) }
            }
        }
        Spacer(GlanceModifier.width(d.ColumnGap.dp))
        Box(GlanceModifier.width(view.arrivalWidth.dp), contentAlignment = Alignment.CenterEnd) { WText(row.arrival) }
    }
}

@Composable
private fun Lane(lane: WidgetLane, width: Float) {
    val d = WidgetDimens
    Box(GlanceModifier.width(width.dp).height(d.LaneHeight.dp)) {
        Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            if (lane.start > 0) Spacer(GlanceModifier.width(lane.start.dp))
            lane.segments.forEach { segment ->
                val colors = if (segment.line == null) (if (segment.tight) tone(WidgetTone.Warn) else RuleColor)
                    else DayNight(lineColor(segment.line, segment.mode.orEmpty(), LightColors, fill = true),
                        lineColor(segment.line, segment.mode.orEmpty(), DarkColors, fill = true))
                Box(GlanceModifier.width(segment.width.dp).height(d.LaneBar.dp)
                    .background((if (lane.faded && segment.line != null) colors.faded() else colors).provider)) {}
            }
        }
        Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            var cursor = 0f
            lane.chips.forEach { placed ->
                if (placed.x > cursor) Spacer(GlanceModifier.width((placed.x - cursor).dp))
                WChip(placed.chip, GlanceModifier.width(placed.width.dp), height = d.LaneHeight, pad = 0f)
                cursor = maxOf(cursor, placed.x) + placed.width
            }
        }
    }
}

@Composable
private fun StepRow(row: WidgetStepRow, view: WidgetBoard, modifier: GlanceModifier) {
    val d = WidgetDimens
    Box(modifier, contentAlignment = Alignment.CenterStart) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(GlanceModifier.width(view.clockWidth.dp)) { WText(row.clock) }
            Spacer(GlanceModifier.width(d.ColumnGap.dp))
            WText(row.action)
            row.station?.let {
                Spacer(GlanceModifier.width(d.StepNameGap.dp))
                WText(it)
            }
        }
        row.chip?.let { Box(GlanceModifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) { WChip(it, height = d.LaneHeight + 2, pad = d.LaneChipPad) } }
    }
}
