package com.ilovetrains.app

import android.app.Application

class TrainApplication : Application() {
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
