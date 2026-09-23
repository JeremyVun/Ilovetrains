package com.ilovetrains.app

import android.app.Application
import java.io.File

class TrainApplication : Application() {
    val analytics: Analytics by lazy { Analytics.create(BuildConfig.DEBUG, FileAnalyticsStore(File(filesDir, AnalyticsStoreName))) }
    val model: TrainViewModel by lazy {
        TrainViewModel(
            this,
            AndroidTravelTrackerSessionStore(this),
            AndroidTravelTrackerRuntime(this),
        )
    }

    override fun onCreate() {
        super.onCreate()
        TravelTrackerNotification.createChannel(this)
    }
}
