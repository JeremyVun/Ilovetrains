package com.ilovetrains.app

import java.util.Locale
import kotlin.math.floor

enum class WidgetFace(val weight: Int, val tracking: Float) {
    Thin(250, -.03f), Light(300, -.01f), Regular(400, 0f), Label(600, .12f), Chip(700, .02f),
}

data class WidgetFont(val face: WidgetFace, val sp: Float)

enum class WidgetTone { Ink, Ink2, Ink3, Warn }

data class WidgetText(
    val text: String,
    val font: WidgetFont,
    val tone: WidgetTone,
    val maxLines: Int = 1,
    val struck: Boolean = false,
    val width: Float? = null,
)

data class WidgetChip(val text: String, val line: String, val mode: String, val faded: Boolean = false)

data class WidgetSentence(val lead: String, val deadline: Long, val sp: Float, val maxLines: Int = 1)

/** The header's status line; a null part is the pin icon. */
data class WidgetKicker(val parts: List<WidgetText?>)

data class WidgetNextStep(val time: WidgetText, val action: WidgetText, val chip: WidgetChip?)

data class WidgetSegment(val width: Float, val line: String?, val mode: String?, val tight: Boolean = false)
data class WidgetLaneChip(val x: Float, val width: Float, val chip: WidgetChip)
data class WidgetLane(val start: Float, val segments: List<WidgetSegment>, val chips: List<WidgetLaneChip>, val faded: Boolean)

sealed interface WidgetRow { val clock: WidgetText }
data class WidgetServiceRow(override val clock: WidgetText, val pinned: Boolean, val lane: WidgetLane,
    val meta: List<WidgetText>, val arrival: WidgetText) : WidgetRow
data class WidgetStepRow(override val clock: WidgetText, val action: WidgetText, val station: WidgetText?,
    val chip: WidgetChip?) : WidgetRow

sealed interface WidgetView
data object WidgetBlank : WidgetView
data class WidgetEmpty(val kicker: WidgetText, val message: WidgetText) : WidgetView
data class WidgetSmall(
    val kicker: WidgetKicker? = null,
    val route: WidgetText? = null,
    val note: WidgetText? = null,
    val clock: WidgetText? = null,
    val meta: List<WidgetText> = emptyList(),
    val sentence: WidgetSentence? = null,
    val step: List<WidgetText> = emptyList(),
    val cap: WidgetChip? = null,
    val arrival: WidgetText? = null,
    val stacked: Boolean = false,
    val nextStep: WidgetNextStep? = null,
    val message: WidgetText? = null,
    val foot: WidgetText? = null,
    val gap: Float = 1f,
) : WidgetView
data class WidgetBoard(
    val kicker: WidgetKicker? = null,
    val route: WidgetText? = null,
    val sentence: WidgetSentence? = null,
    val rows: List<WidgetRow> = emptyList(),
    val rowHeight: Float = 0f,
    val clockWidth: Float = 0f,
    val arrivalWidth: Float = 0f,
    val laneWidth: Float = 0f,
    val routeWidth: Float = 0f,
    val end: List<WidgetText> = emptyList(),
    val message: WidgetText? = null,
    val foot: WidgetText? = null,
) : WidgetView

/** Widths and line heights in dp at the device's font scale. */
interface WidgetMeasure {
    fun width(text: String, font: WidgetFont): Float
    fun lineHeight(font: WidgetFont): Float
}

object WidgetDimens {
    const val BoardMinWidth = 260f
    // The Pixel launcher reports a widget about 11 dp taller than the view it hosts.
    const val ReportedHeightSlack = 12f
    const val SmallPadTop = 16f
    const val SmallPadSide = 16f
    const val SmallPadBottom = 15f
    const val BoardPadTop = 15f
    const val BoardPadSide = 18f
    const val BoardPadBottom = 13f
    const val CapHeight = 22f
    const val CapPad = 7f
    const val LaneHeight = 18f
    const val LaneChipPad = 4f
    const val LaneBar = 5f
    const val PinMark = 12f
    const val PinGap = 3f
    const val ColumnGap = 10f
    const val RowMin = 40f
    const val RowMax = 56f
    const val MaxRows = 5
    const val RowMetaGap = 3f
    const val KickerGap = 5f
    const val NoteGap = 8f
    const val ClockGap = 4f
    const val MetaGap = 2f
    const val SentenceGap = 4f
    const val CapGap = 6f
    const val ArrivalGap = 4f
    const val FootGap = 8f
    const val HeadGap = 4f
    const val BoardFootGap = 6f
    const val StepGap = 6f
    const val StepNameGap = 6f
}

object WidgetType {
    val Label = WidgetFont(WidgetFace.Label, 11f)
    val Route = WidgetFont(WidgetFace.Light, 13.5f)
    val BoardRoute = WidgetFont(WidgetFace.Light, 14f)
    val Struck = WidgetFont(WidgetFace.Light, 12f)
    val Arrival = WidgetFont(WidgetFace.Light, 15f)
    val Station = WidgetFont(WidgetFace.Light, 14f)
    val NextTime = WidgetFont(WidgetFace.Light, 13f)
    val Message = WidgetFont(WidgetFace.Light, 17f)
    val EndNote = WidgetFont(WidgetFace.Light, 12f)
    val RowArrival = WidgetFont(WidgetFace.Light, 13.5f)
    val Chip = WidgetFont(WidgetFace.Chip, 14f)
    const val Sentence = 13f
    const val RowClock = 23f
    val Clocks = listOf(46f, 40f, 34f, 28f)
}

private val Sentences = listOf(WidgetType.Sentence, 12f, 11f)

/** Gaps close before the clock steps down, because the departure clock is the glance. */
private fun clockLadder(texts: Float, gaps: Float, height: Float, measure: WidgetMeasure): Pair<Float, Float>? =
    WidgetType.Clocks.firstNotNullOfOrNull { sp ->
        listOf(1f, .5f).firstOrNull { g -> texts + g * gaps + measure.lineHeight(WidgetFont(WidgetFace.Thin, sp)) <= height }?.let { sp to it }
    }

private val Shortenings = listOf<(String) -> String>(
    { it.replace(Regex("\\s+Station$", RegexOption.IGNORE_CASE), "") },
    { it.replace(Regex("\\s+Junction$", RegexOption.IGNORE_CASE), " Jn") },
    { it.replace(Regex("^(North|South|East|West)\\s+", RegexOption.IGNORE_CASE)) { m -> "${m.groupValues[1].first()} " } },
)

/** Both names are shortened a rule at a time until the pair fits one line, and wrap only once no rule is left. */
internal fun fitRoute(from: String, to: String, font: WidgetFont, width: Float, measure: WidgetMeasure, tone: WidgetTone,
                      maxLines: Int = 3): WidgetText {
    var a = from
    var b = to
    fun text() = "$a\u00A0→ $b"
    if (measure.width(text(), font) <= width) return WidgetText(text(), font, tone)
    for (shorten in Shortenings) {
        val next = shorten(a) to shorten(b)
        if (next == a to b) continue
        a = next.first; b = next.second
        if (measure.width(text(), font) <= width) return WidgetText(text(), font, tone)
    }
    // When each name fits a line of its own, the pair breaks after the arrow rather than inside a name.
    val whole = measure.width("$a\u00A0→", font) <= width && measure.width(b, font) <= width
    val wrapped = if (whole) "${a.replace(' ', '\u00A0')}\u00A0→ ${b.replace(' ', '\u00A0')}" else text()
    return WidgetText(wrapped, font, tone, maxLines = maxLines.coerceAtMost(wrappedLines(wrapped, font, width, measure)))
}

/** A single name in a measured track: shortened by rule, then wrapped onto a second line, never ellipsised. */
internal fun fitName(name: String, font: WidgetFont, width: Float, measure: WidgetMeasure, tone: WidgetTone): WidgetText {
    var shown = name
    for (shorten in Shortenings) {
        if (measure.width(shown, font) <= width) break
        shown = shorten(shown)
    }
    return WidgetText(shown, font, tone, maxLines = wrappedLines(shown, font, width, measure).coerceAtMost(2), width = width)
}

internal fun wrappedLines(text: String, font: WidgetFont, width: Float, measure: WidgetMeasure): Int {
    var lines = 1
    var line = ""
    for (word in text.split(' ')) {
        val candidate = if (line.isEmpty()) word else "$line $word"
        if (line.isNotEmpty() && measure.width(candidate, font) > width) { lines++; line = word } else line = candidate
    }
    return lines
}

private fun label(text: String, tone: WidgetTone = WidgetTone.Ink3, maxLines: Int = 1) =
    WidgetText(text.uppercase(Locale.ENGLISH), WidgetType.Label, tone, maxLines)

private fun chip(text: String, leg: Leg, faded: Boolean = false) =
    WidgetChip(text.uppercase(Locale.ENGLISH), leg.line, leg.mode, faded)

private fun vehicle(leg: Leg) = leg.line.ifBlank {
    when (leg.mode.lowercase(Locale.ENGLISH)) { "ferry" -> "Ferry"; "metro" -> "Metro"; else -> "Train" }
}

/** Timetable-only data, or a live estimate past the accuracy horizon as it stood when fetched, reads SCHEDULED. */
internal fun widgetScheduled(journey: Journey, board: BoardData?): Boolean {
    if (journey.cancelled || minutesBetween(journey.departure, journey.effectiveDeparture) > 0) return false
    if (board == null || board.source != "live" || !journey.realtime) return true
    return journey.legs.first().estimatedDeparture != null &&
        minutesBetween(board.generatedAt, journey.effectiveDeparture) > LIVE_HORIZON_MIN
}

private fun delay(journey: Journey) = minutesBetween(journey.departure, journey.effectiveDeparture)

private fun provenance(journey: Journey, board: BoardData?): List<WidgetText> = when {
    journey.cancelled -> listOf(label("Cancelled", WidgetTone.Warn))
    delay(journey) > 0 -> listOf(WidgetText(clockTime(journey.departure), WidgetType.Struck, WidgetTone.Ink3, struck = true),
        label("${delay(journey)} min late", WidgetTone.Warn))
    widgetScheduled(journey, board) -> listOf(label("Scheduled"))
    else -> emptyList()
}

private fun clockTone(journey: Journey, board: BoardData?) = when {
    journey.cancelled -> WidgetTone.Ink3
    delay(journey) > 0 -> WidgetTone.Warn
    widgetScheduled(journey, board) -> WidgetTone.Ink2
    else -> WidgetTone.Ink
}

private fun foot(content: WidgetContent): WidgetText? = content.provenance?.let {
    label(it, if (it.startsWith("Offline")) WidgetTone.Warn else WidgetTone.Ink3, maxLines = 2)
}

private fun message(content: WidgetContent) = "— " + when {
    content.board == null -> "No saved board for this trip yet"
    content.board.offline -> "No services on the last board we could load"
    else -> "No services in the next few hours"
}

private fun kicker(content: WidgetContent): WidgetKicker? {
    val focus = content.answer?.focus ?: return null
    val lead = content.next ?: return null
    if (lead.key != focus.journey.key) return null
    val header = focusHeader(widgetFocused(focus, content.board), content.date)
    val status = label(header.status.text, if (header.status.warning) WidgetTone.Warn else WidgetTone.Ink2)
    return WidgetKicker(when {
        !focus.pinned -> listOf(status)
        header.status.text == "Pinned" -> listOf(null, label("Pinned", WidgetTone.Ink2))
        header.pinWord -> listOf(status, label(" · ", WidgetTone.Ink3), null, label("Pinned", WidgetTone.Ink2))
        else -> listOf(status, null)
    })
}

private fun riding(content: WidgetContent): Boolean {
    val lead = content.next ?: return false
    val focus = content.answer?.focus ?: return false
    return lead.key == focus.journey.key && content.date >= lead.effectiveDeparture
}

internal data class WidgetStep(val time: Long, val action: String, val short: String, val station: String?, val leg: Leg,
                               val platform: String?, val boards: Boolean)

internal fun widgetSteps(journey: Journey): List<WidgetStep> {
    val first = journey.legs.first()
    val steps = mutableListOf(WidgetStep(first.effectiveDeparture, "Board ${vehicle(first)}", "Board ${vehicle(first)}",
        first.from.shortName, first, first.fromPlatform, boards = true))
    journey.legs.zipWithNext().forEach { (before, after) ->
        steps += WidgetStep(before.effectiveArrival, "Get off", "Get off", before.to.shortName, before, before.toPlatform, boards = false)
        val headsign = after.headsign.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
        steps += WidgetStep(after.effectiveDeparture, "Board ${vehicle(after)}$headsign", "Board ${vehicle(after)}",
            after.from.shortName.takeIf { after.from.id != before.to.id }, after, after.fromPlatform, boards = true)
    }
    val last = journey.legs.last()
    steps += WidgetStep(last.effectiveArrival, "Arrive", "Arrive", last.to.shortName, last, last.toPlatform, boards = false)
    return steps
}

private fun stepSentence(step: WidgetStep, width: Float, measure: WidgetMeasure): WidgetSentence {
    val subject = if (step.boards) "${vehicle(step.leg)} leaves in " else "${step.leg.to.shortName} in "
    return sentence(subject, step.time, width, measure)
}

private fun sentence(lead: String, deadline: Long, width: Float, measure: WidgetMeasure, hours: Boolean = false): WidgetSentence {
    val timer = if (hours) "0:00:00" else "00:00"
    for (sp in Sentences) {
        val fits = measure.width(lead, WidgetFont(WidgetFace.Regular, sp)) + measure.width(timer, WidgetFont(WidgetFace.Chip, sp)) <= width
        if (fits) return WidgetSentence(lead, deadline, sp)
    }
    return WidgetSentence(lead, deadline, Sentences.last(), maxLines = 2)
}

private fun leadSentence(lead: Journey, date: Long, width: Float, measure: WidgetMeasure) =
    sentence("${vehicle(lead.legs.first())} leaves in ", lead.effectiveDeparture, width, measure,
        hours = lead.effectiveDeparture - date >= 3_600_000)

fun widgetView(content: WidgetContent?, width: Float, height: Float, measure: WidgetMeasure): WidgetView {
    content ?: return WidgetBlank
    if (content.answer == null) {
        return WidgetEmpty(label("+ New trip", WidgetTone.Ink2), WidgetText("Choose where you start", WidgetType.Message, WidgetTone.Ink, 3))
    }
    val usable = height - WidgetDimens.ReportedHeightSlack
    return if (width >= WidgetDimens.BoardMinWidth) boardView(content, width, usable, measure) else smallView(content, width, usable, measure)
}

private fun smallView(content: WidgetContent, width: Float, height: Float, measure: WidgetMeasure): WidgetSmall {
    val d = WidgetDimens
    val w = width - 2 * d.SmallPadSide
    val h = height - d.SmallPadTop - d.SmallPadBottom
    val answer = content.answer!!
    fun lh(font: WidgetFont) = measure.lineHeight(font)
    fun lines(text: WidgetText) = wrappedLines(text.text, text.font, w, measure).coerceAtMost(text.maxLines) * lh(text.font)
    val foot = foot(content)
    val footHeight = foot?.let { lines(it) } ?: 0f
    val footGap = if (foot != null) d.FootGap else 0f
    val kicker = kicker(content)
    val kickerHeight = kicker?.let { lh(WidgetType.Label) } ?: 0f
    val kickerGap = if (kicker != null) d.KickerGap else 0f
    val lead = content.next
    if (lead == null) {
        val route = fitRoute(answer.from.station.shortName, answer.to.station.shortName, WidgetType.Route, w, measure, WidgetTone.Ink2)
        return WidgetSmall(route = route, message = label(message(content), maxLines = 3), foot = foot)
    }
    if (riding(content)) {
        val steps = widgetSteps(lead)
        val index = steps.indexOfFirst { it.time > content.date }
        val step = steps[if (index < 0) steps.lastIndex else index]
        val after = steps.getOrNull(index + 1).takeIf { index >= 0 }
        val cap = step.platform?.let { platformText(it, step.leg.mode, full = true) }?.let { chip(it, step.leg) }
        val next = after?.let { s ->
            WidgetNextStep(WidgetText(clockTime(s.time), WidgetType.NextTime, WidgetTone.Ink2), label(s.short),
                s.platform?.let { platformText(it, s.leg.mode) }?.let { chip(it, s.leg) })
        }
        val sentence = if (index >= 0) stepSentence(step, w, measure) else null
        val texts = kickerHeight + (sentence?.let { lh(WidgetFont(WidgetFace.Regular, it.sp)) * it.maxLines } ?: 0f) +
            lh(WidgetType.Station) + (cap?.let { d.CapHeight } ?: 0f) + footHeight
        val gaps = kickerGap + (sentence?.let { d.MetaGap } ?: 0f) + d.StepGap + (cap?.let { d.CapGap } ?: 0f) + footGap
        val fitted = next?.let { clockLadder(texts + d.CapHeight, gaps + d.StepGap, h, measure) }
        val (clockSp, gap) = fitted ?: clockLadder(texts, gaps, h, measure) ?: (WidgetType.Clocks.last() to .5f)
        return WidgetSmall(kicker = kicker, clock = WidgetText(clockTime(step.time), WidgetFont(WidgetFace.Thin, clockSp), WidgetTone.Ink),
            sentence = sentence,
            step = listOfNotNull(label(step.short, WidgetTone.Ink2), step.station?.let {
                fitName(it, WidgetType.Station, w - measure.width(label(step.short).text, WidgetType.Label) - d.StepNameGap, measure, WidgetTone.Ink)
            }),
            cap = cap, nextStep = next.takeIf { fitted != null }, foot = foot, gap = gap)
    }
    val first = lead.legs.first()
    val route = fitRoute(answer.from.station.shortName, answer.to.station.shortName, WidgetType.Route, w, measure, WidgetTone.Ink2)
    val note = content.cancelled?.let { label("${clockTime(it.effectiveDeparture)} cancelled", WidgetTone.Warn) }
    val meta = provenance(lead, content.board)
    val sentence = leadSentence(lead, content.date, w, measure)
    val cap = departureCapText(first.fromPlatform, first.mode)?.let { chip(it, first) }
    val arrival = WidgetText("→ ${clockTime(lead.effectiveArrival)}", WidgetType.Arrival, WidgetTone.Ink2)
    val capWidth = cap?.let { measure.width(it.text, WidgetType.Chip) + 2 * d.CapPad } ?: 0f
    val stacked = cap != null && capWidth + d.CapGap + measure.width(arrival.text, arrival.font) > w
    val capRow = if (cap == null) lh(arrival.font) else if (stacked) d.CapHeight + lh(arrival.font) else maxOf(d.CapHeight, lh(arrival.font))
    val texts = kickerHeight + lines(route) + (note?.let { lh(it.font) } ?: 0f) + (meta.maxOfOrNull { lh(it.font) } ?: 0f) +
        lh(WidgetFont(WidgetFace.Regular, sentence.sp)) * sentence.maxLines + capRow + footHeight
    val gaps = kickerGap + (note?.let { d.NoteGap } ?: 0f) + d.ClockGap + (if (meta.isEmpty()) d.SentenceGap else 2 * d.MetaGap) +
        d.CapGap + (if (stacked) d.ArrivalGap else 0f) + footGap
    val fitted = clockLadder(texts, gaps, h, measure)
    // Past the smallest clock the arrival goes first: the departure, countdown, platform and freshness are the glance.
    val (clockSp, gap) = fitted ?: clockLadder(texts - capRow + (cap?.let { d.CapHeight } ?: 0f), gaps - (if (stacked) d.ArrivalGap else 0f), h, measure)
        ?: (WidgetType.Clocks.last() to .5f)
    val clock = WidgetText(clockTime(lead.effectiveDeparture), WidgetFont(WidgetFace.Thin, clockSp), clockTone(lead, content.board))
    return WidgetSmall(kicker = kicker, route = route, note = note, clock = clock, meta = meta, sentence = sentence, cap = cap,
        arrival = arrival.takeIf { fitted != null }, stacked = stacked && fitted != null, foot = foot, gap = gap)
}

private fun boardView(content: WidgetContent, width: Float, height: Float, measure: WidgetMeasure): WidgetBoard {
    val d = WidgetDimens
    val w = width - 2 * d.BoardPadSide
    val h = height - d.BoardPadTop - d.BoardPadBottom
    val answer = content.answer!!
    fun lh(font: WidgetFont) = measure.lineHeight(font)
    val foot = foot(content)
    val footHeight = foot?.let { d.BoardFootGap + wrappedLines(it.text, it.font, w, measure).coerceAtMost(it.maxLines) * lh(it.font) } ?: 0f
    val lead = content.next
    val riding = riding(content)
    val sentence = when {
        lead == null -> null
        riding -> widgetSteps(lead).firstOrNull { it.time > content.date }?.let { stepSentence(it, w / 2, measure) }
        else -> leadSentence(lead, content.date, w / 2, measure)
    }
    val sentenceWidth = sentence?.let { measure.width(it.lead, WidgetFont(WidgetFace.Regular, it.sp)) +
        measure.width("00:00", WidgetFont(WidgetFace.Chip, it.sp)) + d.ColumnGap } ?: 0f
    val kicker = if (riding) kicker(content) else null
    val route = if (riding) null else fitRoute(answer.from.station.shortName, answer.to.station.shortName, WidgetType.BoardRoute,
        w - sentenceWidth, measure, WidgetTone.Ink, maxLines = 2)
    val headHeight = maxOf(route?.let { wrappedLines(it.text, it.font, w - sentenceWidth, measure).coerceAtMost(it.maxLines) * lh(it.font) }
        ?: lh(WidgetType.Label), sentence?.let { lh(WidgetFont(WidgetFace.Regular, it.sp)) } ?: 0f) + d.HeadGap
    val body = h - headHeight - footHeight
    val routeWidth = w - sentenceWidth
    if (lead == null) return WidgetBoard(route = route, routeWidth = routeWidth, message = label(message(content), maxLines = 3), foot = foot)
    val capacity = floor(body / d.RowMin).toInt().coerceIn(1, d.MaxRows)
    val rowHeight = minOf(body / capacity, d.RowMax)
    if (riding) {
        val steps = widgetSteps(lead)
        val next = steps.indexOfFirst { it.time > content.date }.let { if (it < 0) steps.lastIndex else it }
        val start = maxOf(0, minOf(next, steps.size - capacity))
        val shown = steps.drop(start).take(capacity)
        val clocks = shown.mapIndexed { i, s ->
            WidgetText(clockTime(s.time), WidgetFont(if (start + i == next) WidgetFace.Light else WidgetFace.Thin, WidgetType.RowClock),
                if (start + i < next) WidgetTone.Ink3 else WidgetTone.Ink)
        }
        val clockWidth = clocks.maxOf { measure.width(it.text, it.font) }
        val rows = shown.mapIndexed { i, s ->
            val done = start + i < next
            val action = label(s.action, if (done) WidgetTone.Ink3 else WidgetTone.Ink2)
            val chip = s.platform?.let { platformText(it, s.leg.mode) }?.let { chip(it, s.leg, faded = done) }
            val chipWidth = chip?.let { measure.width(it.text, WidgetType.Chip) + 2 * d.LaneChipPad + d.ColumnGap } ?: 0f
            WidgetStepRow(clocks[i], action, s.station?.let {
                fitName(it, WidgetType.Station, w - clockWidth - d.ColumnGap - measure.width(action.text, action.font) - d.StepNameGap - chipWidth,
                    measure, if (done) WidgetTone.Ink3 else WidgetTone.Ink)
            }, chip)
        }
        return WidgetBoard(kicker = kicker, sentence = sentence, rows = rows, rowHeight = rowHeight, routeWidth = routeWidth,
            clockWidth = clockWidth, foot = foot)
    }
    val pinned = content.answer.focus?.takeIf { it.pinned && it.journey.key == lead.key } != null
    val services = listOfNotNull(content.cancelled?.let { it to false }, lead to true) + content.following.map { it to false }
    val shown = services.take(capacity)
    val clocks = shown.map { (journey, isLead) ->
        WidgetText(clockTime(journey.effectiveDeparture), WidgetFont(if (isLead) WidgetFace.Light else WidgetFace.Thin, WidgetType.RowClock),
            clockTone(journey, content.board), struck = journey.cancelled)
    }
    val arrivals = shown.map { (journey, _) ->
        WidgetText(clockTime(journey.effectiveArrival), WidgetType.RowArrival, if (journey.cancelled) WidgetTone.Ink3 else WidgetTone.Ink2,
            struck = journey.cancelled)
    }
    val clockWidth = clocks.maxOf { measure.width(it.text, it.font) } + if (pinned) d.PinGap + d.PinMark else 0f
    val arrivalWidth = arrivals.maxOf { measure.width(it.text, it.font) }
    val laneWidth = w - clockWidth - arrivalWidth - 2 * d.ColumnGap
    val rows = shown.mapIndexed { i, (journey, isLead) ->
        WidgetServiceRow(clocks[i], isLead && pinned, widgetLane(journey, laneWidth, measure), provenance(journey, content.board), arrivals[i])
    }
    val end = if (services.size < capacity) listOf(label("— End of board"),
        WidgetText("Nothing scheduled after ${clockTime(services.last().first.effectiveDeparture)}.", WidgetType.EndNote, WidgetTone.Ink3))
        else emptyList()
    return WidgetBoard(route = route, sentence = sentence, rows = rows, rowHeight = rowHeight, clockWidth = clockWidth, routeWidth = routeWidth,
        arrivalWidth = arrivalWidth, laneWidth = laneWidth, end = end, foot = foot)
}

internal fun widgetLane(journey: Journey, width: Float, measure: WidgetMeasure): WidgetLane {
    val d = WidgetDimens
    val unit = 10f
    val first = journey.legs.first()
    val faded = journey.cancelled
    val elements = mutableListOf<AxisElement>()
    val chips = mutableMapOf<AxisElement, WidgetChip>()
    platformText(first.fromPlatform, first.mode)?.let { chips[AxisElement.Cap] = chip(it, first, faded); elements += AxisElement.Cap }
    journey.legs.indices.forEach { i ->
        elements += AxisElement.Ride(i)
        if (i < journey.legs.lastIndex) elements += AxisElement.Dwell(i)
    }
    journey.legs.zipWithNext().forEachIndexed { i, (before, after) ->
        if (showAlightingPin(journey.legs.size, i)) platformText(before.toPlatform, before.mode)?.let {
            chips[AxisElement.Alight(i)] = chip(it, before, faded); elements += AxisElement.Alight(i)
        }
        platformText(after.fromPlatform, after.mode)?.let { chips[AxisElement.Board(i)] = chip(it, after, faded); elements += AxisElement.Board(i) }
    }
    val sizes = elements.map { element ->
        chips[element]?.let { AxisSize(((measure.width(it.text, WidgetType.Chip) + 2 * d.LaneChipPad) * unit).toInt(), (d.LaneHeight * unit).toInt()) }
            ?: AxisSize(0, 0)
    }
    val total = (width * unit).toInt()
    val (frames, _) = journeyAxisFrames(journey, total, elements, sizes, (d.LaneBar * unit).toInt(), (d.LaneHeight * unit).toInt(),
        (d.LaneHeight * unit).toInt(), (3 * unit).toInt(), 0, 0, (LineChipCornerRadius.value * unit).toInt(), null)
    val capWidth = elements.indexOf(AxisElement.Cap).takeIf { it >= 0 }?.let { sizes[it].width / unit } ?: 0f
    val axis = (width - capWidth).coerceAtLeast(1f)
    val duration = (journey.effectiveArrival - journey.effectiveDeparture).coerceAtLeast(1).toFloat()
    fun x(t: Long) = axis * ((t - journey.effectiveDeparture) / duration).coerceIn(0f, 1f)
    val segments = mutableListOf<WidgetSegment>()
    journey.legs.forEachIndexed { i, leg ->
        segments += WidgetSegment(x(leg.effectiveArrival) - x(leg.effectiveDeparture), leg.line, leg.mode)
        journey.legs.getOrNull(i + 1)?.let { next ->
            segments += WidgetSegment(x(next.effectiveDeparture) - x(leg.effectiveArrival), null, null, !faded && isTightChange(journey, i))
        }
    }
    // A second lane of pins has no room in a row, so only the first lane is drawn.
    val placed = elements.indices.filter { chips.containsKey(elements[it]) && frames[it].y == 0 }
        .map { WidgetLaneChip(frames[it].x / unit, frames[it].width / unit, chips.getValue(elements[it])) }.sortedBy { it.x }
    return WidgetLane(capWidth, segments, placed, faded)
}
