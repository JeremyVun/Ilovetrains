package com.ilovetrains.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.CancellationSignal
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
    private var cancellation: CancellationSignal? = null
    private var listener: LocationListener? = null
    private val handler = Handler(Looper.getMainLooper())
    private val locationManager get() = getSystemService(LocationManager::class.java)
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        val granted = permissions.values.any { it } || hasLocation()
        if (permissions.isNotEmpty()) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("locationAsked", true).apply()
        }
        val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
        model.permission(granted, isLocationPermissionBlocked(asked, granted,
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)))
        if (granted) takeLocation()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model.onLocationRequest = {
            if (hasLocation()) takeLocation() else {
                val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
                if (isLocationPermissionBlocked(asked, granted = false,
                        shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION))) {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
                } else {
                    permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }
        }
        model.onSilentLocation = { if (hasLocation()) takeLocation() }
        model.onLocationDisabled = { stopLocation() }
        setContent {
            val state = model.state.collectAsStateWithLifecycle().value
            LaunchedEffect(state.ready) {
                if (state.ready) {
                    val preferences = getPreferences(MODE_PRIVATE)
                    if (!preferences.getBoolean("initialLocationHandled", false)) {
                        preferences.edit().putBoolean("initialLocationHandled", true).apply()
                        if (state.totalTrips == 0 && state.useLocation && !preferences.getBoolean("locationAsked", false)) {
                            model.requestLocation()
                        }
                    }
                }
            }
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
        val granted = hasLocation()
        val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
        model.permission(granted, isLocationPermissionBlocked(asked, granted,
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)))
        model.resume()
        if (hasLocation() && model.state.value.ready && model.state.value.useLocation) takeLocation()
    }
    override fun onStop() { stopLocation(); model.pause(); super.onStop() }
    private fun hasLocation() = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    private fun stopLocation() {
        locationGeneration++; cancellation?.cancel(); cancellation = null
        listener?.let { locationManager.removeUpdates(it) }; listener = null
        handler.removeCallbacksAndMessages(null)
    }
    private fun takeLocation() {
        if (!hasLocation() || !model.state.value.useLocation) return
        stopLocation(); val generation = locationGeneration
        val manager = locationManager
        val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).firstOrNull { manager.isProviderEnabled(it) } ?: return
        fun deliver(location: Location?) {
            if (generation != locationGeneration || location == null || !model.state.value.useLocation) return
            model.location(Fix(location.latitude, location.longitude, location.time, location.speed.toDouble().takeIf { location.hasSpeed() }))
        }
        try {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                val signal = CancellationSignal(); cancellation = signal
                manager.getCurrentLocation(provider, signal, mainExecutor) { deliver(it) }
                handler.postDelayed({ if (generation == locationGeneration) stopLocation() }, 15_000)
            } else {
                val single = object : LocationListener {
                    override fun onLocationChanged(location: Location) { deliver(location); stopLocation() }
                    @Deprecated("Legacy Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                }
                listener = single
                @Suppress("DEPRECATION") manager.requestSingleUpdate(provider, single, Looper.getMainLooper())
                handler.postDelayed({ if (generation == locationGeneration) stopLocation() }, 15_000)
            }
        } catch (_: SecurityException) { stopLocation() }
    }
}

internal fun isLocationPermissionBlocked(locationAsked: Boolean, granted: Boolean, shouldShowRationale: Boolean) =
    locationAsked && !granted && !shouldShowRationale
