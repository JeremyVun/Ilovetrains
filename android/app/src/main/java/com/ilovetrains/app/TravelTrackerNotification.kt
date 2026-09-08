package com.ilovetrains.app

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StrikethroughSpan
import java.time.Instant
import java.time.format.DateTimeFormatter
import kotlin.math.max
import kotlin.math.roundToInt

internal object TravelTrackerNotification {
    const val ChannelId = "current_journey"
    const val NotificationId = 4108

    fun createChannel(context: Context) {
        val channel = NotificationChannel(ChannelId, "Current journey", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "The next instruction for your current public transport journey"
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun opening(context: Context): Notification = baseBuilder(
        context,
        title = "Opening current journey",
        text = "Getting the latest instruction.",
        subtext = null,
        revision = null,
    ).setStyle(Notification.BigTextStyle().bigText("Getting the latest instruction.")).build()

    fun build(context: Context, focus: FocusedJourney, state: TravelTrackerState): Notification {
        val eventClock = clock(state.event.deadline)
        val etaClock = clock(state.eta)
        val provenance = provenance(focus, state)
        val compactTitle = "${state.headline.text.trim()} · $eventClock"
        val compactBody = compactBody(state, etaClock)
        val builder = baseBuilder(context, compactTitle, compactBody, provenance, state.revision)

        if (Build.VERSION.SDK_INT >= 36 && state.missedConnection == null &&
            context.resources.configuration.fontScale <= 1f && fitsProgressTemplate(compactTitle, compactBody, provenance)) {
            builder.setStyle(progressStyle(context, state))
            requestPromotion(builder)
        } else {
            builder.setContentTitle(state.headline.text.trim())
                .setSubText(if (state.event.kind == TravelTrackerEventKind.MissedConnection) null else provenance)
                .setContentText(if (state.event.kind == TravelTrackerEventKind.MissedConnection) {
                    "${state.destination} · ${state.etaText}"
                } else state.instruction)
                .setStyle(Notification.BigTextStyle().bigText(expandedText(state, eventClock, provenance)))
            if (state.missedConnection == null) {
                builder.setProgress(10_000, (state.progress * 10_000).roundToInt(), false)
            }
        }
        return builder.build()
    }

    private fun baseBuilder(
        context: Context,
        title: String,
        text: CharSequence,
        subtext: String?,
        revision: TravelTrackerRevision?,
    ): Notification.Builder {
        val builder = Notification.Builder(context, ChannelId)
        builder.setSmallIcon(R.drawable.ic_notification_train)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText(subtext)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory("navigation")
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setShowWhen(false)
            .setPublicVersion(publicVersion(context))
        if (revision != null) {
            builder.setContentIntent(openIntent(context, revision))
                .setDeleteIntent(dismissIntent(context, revision))
        }
        return builder
    }

    private fun publicVersion(context: Context): Notification {
        val builder = Notification.Builder(context, ChannelId)
        return builder.setSmallIcon(R.drawable.ic_notification_train)
            .setContentTitle("Current journey")
            .setContentText("Open ilovetrains for details.")
            .setCategory("navigation")
            .setShowWhen(false)
            .build()
    }

    private fun openIntent(context: Context, revision: TravelTrackerRevision): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(TravelTrackerService.ActionOpen)
            .setData(revisionUri("open", revision))
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putTrackerRevision(revision)
        return PendingIntent.getActivity(context, revision.requestCode(1), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun dismissIntent(context: Context, revision: TravelTrackerRevision): PendingIntent {
        val intent = Intent(context, TravelTrackerService::class.java)
            .setAction(TravelTrackerService.ActionDismiss)
            .setData(revisionUri("dismiss", revision))
            .putTrackerRevision(revision)
        return PendingIntent.getService(context, revision.requestCode(2), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun revisionUri(action: String, revision: TravelTrackerRevision) = Uri.Builder()
        .scheme("ilovetrains")
        .authority("tracker")
        .appendPath(action)
        .appendPath(revision.generation.toString())
        .appendPath(revision.identity.hashCode().toString())
        .build()

    private fun TravelTrackerRevision.requestCode(salt: Int) = 31 * identity.hashCode() + generation.hashCode() + salt

    private fun compactBody(state: TravelTrackerState, etaClock: String): CharSequence {
        val instruction = state.instruction
            .replace(Regex("Platform (?=\\d)"), "P")
            .removeSuffix(".")
        val connection = state.connection?.replace(" min to change", " min change")
        val prefix = listOfNotNull(instruction, connection).joinToString(" · ").let { if (it.isEmpty()) "" else "$it · " }
        val arrival = if (state.arrivalCancelled) "Cancelled ($etaClock)" else etaClock
        val value = SpannableString("$prefix${state.destination} $arrival")
        if (state.arrivalCancelled) {
            val start = value.toString().lastIndexOf(etaClock)
            value.setSpan(StrikethroughSpan(), start, start + etaClock.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return value
    }

    private fun expandedText(state: TravelTrackerState, eventClock: String, provenance: String): CharSequence {
        val lines = buildList {
            add(state.instruction)
            state.connection?.let(::add)
            add("${state.event.name} · $eventClock")
        }.distinct()
        val value = SpannableStringBuilder(lines.joinToString("\n"))
        if (value.isNotEmpty()) value.append('\n')
        value.append("${state.destination} · ")
        val etaClock = clock(state.eta)
        value.append(if (state.arrivalCancelled) "Cancelled ($etaClock)" else state.etaText)
        if (state.arrivalCancelled) {
            val start = value.toString().lastIndexOf(etaClock)
            value.setSpan(StrikethroughSpan(), start, start + etaClock.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        value.append('\n').append(provenance)
        return value
    }

    private fun provenance(focus: FocusedJourney, state: TravelTrackerState): String {
        val updated = "Updated ${clock(focus.board.generatedAt)}"
        return when (state.freshness) {
            TravelTrackerFreshness.Live -> updated
            TravelTrackerFreshness.Offline -> "Offline · $updated"
            TravelTrackerFreshness.Retained -> "Last known · $updated"
            TravelTrackerFreshness.Stale -> updated
            TravelTrackerFreshness.Scheduled -> "Timetable · $updated"
        }
    }

    private fun fitsProgressTemplate(title: String, body: CharSequence, subtext: String): Boolean =
        title.length <= 48 && body.length <= 78 && subtext.length <= 30

    @TargetApi(36)
    private fun progressStyle(context: Context, state: TravelTrackerState): Notification.ProgressStyle {
        val positive = state.segments.filter { it.end > it.start }
        val units = positive.map { max(1, ((it.end - it.start) / 1_000).toInt()) }
        val total = units.sum().coerceAtLeast(1)
        val segments = positive.zip(units).map { (segment, length) ->
            Notification.ProgressStyle.Segment(length).setColor(segmentColor(segment, state))
        }
        return Notification.ProgressStyle()
            .setStyledByProgress(false)
            .setProgress((state.progress * total).roundToInt().coerceIn(0, total))
            .setProgressTrackerIcon(Icon.createWithResource(context, R.drawable.ic_notification_train))
            .setProgressSegments(segments)
    }

    @SuppressLint("NewApi")
    private fun requestPromotion(builder: Notification.Builder) {
        if (supportsQpr2Promotion()) builder.setRequestPromotedOngoing(true)
    }

    private fun segmentColor(segment: TravelTrackerSegment, state: TravelTrackerState): Int {
        if (segment.kind == TravelTrackerSegmentKind.Gap) {
            return if (state.tightConnection && state.activeLegIndex == segment.legIndex + 1) Color.rgb(255, 122, 92)
            else Color.rgb(111, 129, 142)
        }
        val key = if (segment.mode.equals("ferry", true)) "FERRY" else segment.line.orEmpty().uppercase()
        return LineColors[key] ?: Color.rgb(111, 129, 142)
    }

    private fun supportsQpr2Promotion(): Boolean {
        if (Build.VERSION.SDK_INT > 36) return true
        if (Build.VERSION.SDK_INT < 36) return false
        return runCatching {
            val running = Build.VERSION::class.java.getField("SDK_INT_FULL").getInt(null)
            val required = Class.forName("android.os.Build\$VERSION_CODES_FULL").getField("BAKLAVA_1").getInt(null)
            running >= required
        }.getOrDefault(false)
    }

    private fun clock(time: Long): String = Clock.format(Instant.ofEpochMilli(time))

    private val Clock = DateTimeFormatter.ofPattern("HH:mm").withZone(Sydney)
    private val LineColors = mapOf(
        "T1" to Color.rgb(249, 157, 28), "T2" to Color.rgb(0, 152, 205),
        "T3" to Color.rgb(243, 112, 33), "T4" to Color.rgb(0, 90, 163),
        "T5" to Color.rgb(196, 37, 143), "T7" to Color.rgb(111, 129, 142),
        "T8" to Color.rgb(0, 149, 76), "T9" to Color.rgb(209, 31, 47),
        "M1" to Color.rgb(22, 131, 136), "BMT" to Color.rgb(249, 157, 28),
        "CCN" to Color.rgb(209, 31, 47), "SCO" to Color.rgb(0, 152, 205),
        "SHL" to Color.rgb(0, 149, 76), "HUN" to Color.rgb(131, 49, 52),
        "FERRY" to Color.rgb(90, 176, 49),
    )
}
