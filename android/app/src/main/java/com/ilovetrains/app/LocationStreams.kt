package com.ilovetrains.app

import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

internal enum class FixProvider { Fused, Gps, Network }

internal enum class SingleFix { Lookup, Home }

internal const val NetworkFallbackMillis = 20_000L
internal const val ArrivalFixIntervalMillis = 10_000L
private const val SingleFixTimeoutMillis = 15_000L
private const val SingleFixSettleMillis = 2_000L
private const val SingleFixPreciseMetres = 200.0
private const val FixMaxAgeMillis = 300_000L

internal interface FixListener {
    fun fix(provider: FixProvider, value: Fix)
    fun disabled(provider: FixProvider)
}

internal interface LocationSource {
    fun enabled(provider: FixProvider): Boolean
    fun request(provider: FixProvider, intervalMillis: Long, listener: FixListener): Boolean
    fun remove(listener: FixListener)
    fun after(delayMillis: Long, action: () -> Unit): () -> Unit
    fun now(): Long
    fun elapsed(): Long
}

/** The fused provider already blends GPS and network; without it, GPS leads and network only fills its silences. */
internal fun fixProviders(enabled: (FixProvider) -> Boolean): List<FixProvider> =
    if (enabled(FixProvider.Fused)) listOf(FixProvider.Fused)
    else listOf(FixProvider.Gps, FixProvider.Network).filter(enabled)

internal class NetworkFixGate {
    private var lastGps: Long? = null
    fun accept(provider: FixProvider, receivedAt: Long): Boolean = when (provider) {
        FixProvider.Gps -> { lastGps = receivedAt; true }
        FixProvider.Network -> lastGps.let { it == null || receivedAt - it >= NetworkFallbackMillis }
        FixProvider.Fused -> true
    }
}

/** Setup lookups, single Home fixes and arrival monitoring each own a listener, so stopping one never stops another. */
internal class LocationStreams(private val source: LocationSource) {
    private val singles = mutableMapOf<SingleFix, FixListener>()
    private var arrival: FixListener? = null
    val monitoring get() = arrival != null
    fun locating(kind: SingleFix) = kind in singles
    fun servicesEnabled() = fixProviders(source::enabled).isNotEmpty()

    /** False when no provider is enabled. A lookup already running for [kind] is left to finish. */
    fun single(kind: SingleFix, done: (Fix?) -> Unit): Boolean {
        if (kind in singles) return true
        val providers = fixProviders(source::enabled)
        if (providers.isEmpty()) return false
        val gate = NetworkFixGate()
        val timers = mutableListOf<() -> Unit>()
        var best: Fix? = null
        val listener = object : FixListener {
            fun finish() {
                if (singles[kind] !== this) return
                singles.remove(kind)
                source.remove(this)
                timers.forEach { it() }
                done(best)
            }
            override fun fix(provider: FixProvider, value: Fix) {
                if (singles[kind] !== this || source.now() - value.at !in 0..FixMaxAgeMillis) return
                if (!gate.accept(provider, source.elapsed())) return
                val accuracy = value.accuracyMetres
                if (best == null || accuracy != null && accuracy < (best?.accuracyMetres ?: Double.MAX_VALUE)) best = value
                when {
                    accuracy != null && accuracy <= SingleFixPreciseMetres -> finish()
                    // Give a precise provider a brief chance; approximate access still produces a useful choice.
                    best === value -> timers += source.after(SingleFixSettleMillis, ::finish)
                }
            }
            override fun disabled(provider: FixProvider) {}
        }
        singles[kind] = listener
        if (providers.count { source.request(it, 0L, listener) } == 0) { listener.finish(); return true }
        timers += source.after(SingleFixTimeoutMillis, listener::finish)
        return true
    }

    fun cancel(kind: SingleFix) {
        singles.remove(kind)?.let(source::remove)
    }

    /** [beforeStart] runs once providers are known and may still decline the start. */
    fun startArrival(beforeStart: () -> Boolean, sample: (Fix) -> Unit, lost: () -> Unit): Boolean {
        stopArrival()
        val providers = fixProviders(source::enabled)
        if (providers.isEmpty() || !beforeStart()) return false
        val gate = NetworkFixGate()
        val listener = object : FixListener {
            override fun fix(provider: FixProvider, value: Fix) {
                if (arrival === this && gate.accept(provider, source.elapsed())) sample(value)
            }
            override fun disabled(provider: FixProvider) {
                if (arrival !== this || providers.any(source::enabled)) return
                stopArrival()
                lost()
            }
        }
        arrival = listener
        if (providers.count { source.request(it, ArrivalFixIntervalMillis, listener) } == 0) { stopArrival(); return false }
        return true
    }

    fun stopArrival() {
        arrival?.let(source::remove)
        arrival = null
    }

    fun stopAll() {
        SingleFix.entries.forEach(::cancel)
        stopArrival()
    }
}

internal fun Location.toFix() = Fix(latitude, longitude, time,
    speed.toDouble().takeIf { hasSpeed() }, accuracy.toDouble().takeIf { hasAccuracy() },
    bearing.toDouble().takeIf { hasBearing() })

internal class SystemLocationSource(private val manager: LocationManager) : LocationSource {
    private val handler = Handler(Looper.getMainLooper())
    private val registered = mutableMapOf<FixListener, MutableList<LocationListener>>()

    override fun enabled(provider: FixProvider): Boolean = when (provider) {
        FixProvider.Fused -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            manager.hasProvider(LocationManager.FUSED_PROVIDER) && manager.isProviderEnabled(LocationManager.FUSED_PROVIDER)
        FixProvider.Gps -> manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        FixProvider.Network -> manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    override fun request(provider: FixProvider, intervalMillis: Long, listener: FixListener): Boolean {
        val name = when (provider) {
            FixProvider.Fused -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) LocationManager.FUSED_PROVIDER else return false
            FixProvider.Gps -> LocationManager.GPS_PROVIDER
            FixProvider.Network -> LocationManager.NETWORK_PROVIDER
        }
        val system = object : LocationListener {
            override fun onLocationChanged(location: Location) = listener.fix(provider, location.toFix())
            @Deprecated("Legacy Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(name: String) {}
            override fun onProviderDisabled(name: String) = listener.disabled(provider)
        }
        return try {
            manager.requestLocationUpdates(name, intervalMillis, 0f, system, Looper.getMainLooper())
            registered.getOrPut(listener) { mutableListOf() }.add(system)
            true
        } catch (_: SecurityException) { false } catch (_: IllegalArgumentException) { false }
    }

    override fun remove(listener: FixListener) {
        registered.remove(listener)?.forEach(manager::removeUpdates)
    }

    override fun after(delayMillis: Long, action: () -> Unit): () -> Unit {
        val runnable = Runnable(action)
        handler.postDelayed(runnable, delayMillis)
        return { handler.removeCallbacks(runnable) }
    }

    override fun now() = System.currentTimeMillis()
    override fun elapsed() = SystemClock.elapsedRealtime()
}
