package com.ilovetrains.app

import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner

class HermeticTestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle?) {
        testApiBase = "http://127.0.0.1:1"
        super.onCreate(arguments)
    }
}
