package com.ilovetrains.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {
    private val model by lazy { (application as TrainApplication).model }
    private var askingPermission = false
    private var foreground = false
    private val streams by lazy { LocationStreams(SystemLocationSource(getSystemService(LocationManager::class.java))) }
    private val notificationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        model.notificationPermissionResult()
    }
    private val notificationPermissionRequest: () -> Unit = {
        if (android.os.Build.VERSION.SDK_INT >= 33) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    private val locationRequest: () -> Unit = { requestLocationFromSystem() }
    private val silentLocation: () -> Unit = { takeLocation(SingleFix.Home) }
    private val locationDisabled: () -> Unit = { streams.stopAll() }
    private val setupLocationCancel: () -> Unit = { streams.cancel(SingleFix.Lookup) }
    private val arrivalMonitoring: (() -> Unit) -> Boolean = { beforeStart -> startArrivalMonitoring(beforeStart) }
    private val arrivalMonitoringStop: () -> Unit = { streams.stopArrival() }
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        askingPermission = false
        val granted = permissions.values.any { it } || hasLocation()
        if (permissions.isNotEmpty()) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("locationAsked", true).apply()
        }
        val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
        model.permission(granted, isLocationPermissionBlocked(asked, granted,
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)))
        if (granted) takeLocation(SingleFix.Lookup) else model.locationFailed(SetupLocationStatus.Denied)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        captureAnalytics(intent)
        model.attachActivity(this, locationRequest, silentLocation, locationDisabled, setupLocationCancel,
            arrivalMonitoring, arrivalMonitoringStop, notificationPermissionRequest)
        handleTrackerIntent(intent)
        // A recreated activity still carries the tap that first opened it.
        if (savedInstanceState == null) handleWidgetIntent(intent)
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
        model.activityResumed()
        val granted = hasLocation()
        val asked = getPreferences(MODE_PRIVATE).getBoolean("locationAsked", false)
        model.permission(granted, isLocationPermissionBlocked(asked, granted,
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)))
        if (!granted && !askingPermission) model.locationFailed(SetupLocationStatus.Denied)
        model.resume()
        if (model.state.value.ready) takeLocation(SingleFix.Home)
    }
    override fun onStop() {
        foreground = false; streams.stopAll(); model.activityStopped(); model.pause()
        if (!isChangingConfigurations) model.backgrounded()
        super.onStop()
    }
    override fun onDestroy() {
        streams.stopAll()
        model.detachActivity(this, notificationPermissionRequest)
        super.onDestroy()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureAnalytics(intent)
        handleTrackerIntent(intent)
        handleWidgetIntent(intent)
    }
    private fun captureAnalytics(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        intent?.getStringExtra(AnalyticsUrlExtra)?.let((application as TrainApplication).analytics::captureTo)
    }
    private fun handleTrackerIntent(intent: Intent?) {
        if (intent?.action == TravelTrackerService.ActionOpen) intent.trackerRevision()?.let(model::openTrackedJourney)
    }
    private fun handleWidgetIntent(intent: Intent?) {
        if (intent == null || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        intent.getStringExtra(WidgetOpenExtra)?.let { model.openFromWidget(setup = it == WidgetOpenSetup) }
    }
    private fun requestLocationFromSystem() {
        if (hasLocation() && !streams.servicesEnabled()) {
            model.locationFailed(SetupLocationStatus.ServicesDisabled)
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        } else if (hasLocation()) takeLocation(SingleFix.Lookup) else {
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
    private fun hasLocation() = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    private fun takeLocation(kind: SingleFix) {
        if (!foreground || askingPermission || !hasLocation() || !model.state.value.useLocation) return
        // While arrival monitoring runs, its stream is the only source of fixes.
        if (kind == SingleFix.Home && streams.monitoring) return
        val started = streams.single(kind) { fix ->
            if (fix == null) model.locationFailed(SetupLocationStatus.Unavailable) else model.location(fix)
        }
        if (!started) model.locationFailed(SetupLocationStatus.ServicesDisabled)
    }

    private fun startArrivalMonitoring(beforeStart: () -> Unit): Boolean {
        if (!foreground || askingPermission || !hasLocation() || !model.state.value.useLocation) return false
        return streams.startArrival(
            beforeStart = { beforeStart(); model.state.value.focus != null && model.state.value.useLocation },
            sample = model::arrivalLocation,
            lost = { model.arrivalMonitoringFailed(SetupLocationStatus.ServicesDisabled) },
        )
    }
}

internal fun isLocationPermissionBlocked(locationAsked: Boolean, granted: Boolean, shouldShowRationale: Boolean) =
    locationAsked && !granted && !shouldShowRationale
