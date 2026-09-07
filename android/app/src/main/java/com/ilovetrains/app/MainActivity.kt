package com.ilovetrains.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {
    private val model by viewModels<TrainViewModel>()
    private var locationGeneration = 0L
    private var listener: LocationListener? = null
    private var locating = false
    private var askingPermission = false
    private var foreground = false
    private val handler = Handler(Looper.getMainLooper())
    private val locationManager get() = getSystemService(LocationManager::class.java)
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        askingPermission = false
        val granted = permissions.values.any { it } || hasLocation()
        if (permissions.isNotEmpty()) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("locationAsked", true).apply()
        }
        val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
        model.permission(granted, isLocationPermissionBlocked(asked, granted,
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)))
        if (granted) takeLocation() else model.locationFailed(SetupLocationStatus.Denied)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model.onLocationRequest = {
            if (hasLocation() && !locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) && !locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                model.locationFailed(SetupLocationStatus.ServicesDisabled)
                startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            } else if (hasLocation()) takeLocation() else {
                val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
                if (isLocationPermissionBlocked(asked, granted = false,
                        shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION))) {
                    model.locationFailed(SetupLocationStatus.Denied)
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
                } else {
                    askingPermission = true
                    permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }
        }
        model.onSilentLocation = { if (hasLocation()) takeLocation() }
        model.onLocationDisabled = { stopLocation() }
        setContent {
            val state = model.state.collectAsStateWithLifecycle().value
            val dark = when (state.appearance) { Appearance.Dark -> true; Appearance.Light -> false; Appearance.System -> isSystemInDarkTheme() }
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            BackHandler(enabled = state.screen != Screen.Home && !(state.screen == Screen.Setup && state.totalTrips == 0)) { model.back() }
            TrainApp(state, model)
        }
    }
    override fun onResume() {
        super.onResume()
        foreground = true
        val granted = hasLocation()
        val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
        model.permission(granted, isLocationPermissionBlocked(asked, granted,
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)))
        if (!granted && !askingPermission) model.locationFailed(SetupLocationStatus.Denied)
        model.resume()
        if (hasLocation() && model.state.value.ready && model.state.value.useLocation) takeLocation()
    }
    override fun onStop() { foreground = false; stopLocation(); model.pause(); super.onStop() }
    private fun hasLocation() = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    private fun stopLocation() {
        locating = false
        locationGeneration++
        listener?.let { locationManager.removeUpdates(it) }; listener = null
        handler.removeCallbacksAndMessages(null)
    }
    private fun takeLocation() {
        if (!foreground || locating || askingPermission || !hasLocation() || !model.state.value.useLocation) return
        stopLocation(); val generation = locationGeneration
        locating = true
        val manager = locationManager
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).filter { manager.isProviderEnabled(it) }
        if (providers.isEmpty()) { stopLocation(); model.locationFailed(SetupLocationStatus.ServicesDisabled); return }
        // Ask every enabled provider. Network-only requests can stall even with working GPS.
        var best: Location? = null
        fun finish() {
            if (generation != locationGeneration) return
            val value = best
            stopLocation()
            if (value == null) model.locationFailed(SetupLocationStatus.Unavailable)
            else model.location(Fix(value.latitude, value.longitude, value.time,
                value.speed.toDouble().takeIf { value.hasSpeed() }, value.accuracy.toDouble().takeIf { value.hasAccuracy() }))
        }
        val single = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (generation != locationGeneration || System.currentTimeMillis() - location.time !in 0..300_000) return
                if (best == null || (location.hasAccuracy() && location.accuracy < (best?.accuracy ?: Float.MAX_VALUE))) best = location
                if (location.hasAccuracy() && location.accuracy <= 200) finish()
                else if (best === location) {
                    // Give a precise provider a brief chance; approximate access still produces a useful choice.
                    handler.postDelayed({ finish() }, 2_000)
                }
            }
            @Deprecated("Legacy Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        listener = single
        var subscribed = false
        for (provider in providers) {
            try { manager.requestLocationUpdates(provider, 0L, 0f, single, Looper.getMainLooper()); subscribed = true }
            catch (_: SecurityException) { /* Another provider may support approximate access. */ }
            catch (_: IllegalArgumentException) { /* Provider was disabled between lookup and request. */ }
        }
        if (!subscribed) { finish(); return }
        handler.postDelayed({ finish() }, 15_000)
    }

}

internal fun isLocationPermissionBlocked(locationAsked: Boolean, granted: Boolean, shouldShowRationale: Boolean) =
    locationAsked && !granted && !shouldShowRationale
