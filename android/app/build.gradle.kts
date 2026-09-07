plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.ilovetrains.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.ilovetrains.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = Regex("VERSION = '([^']+)'").find(rootProject.file("../web/js/version.js").readText())!!.groupValues[1]
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE", "\"https://ilovetrains.jeremyvun.com\"")
    }
    val releaseKey = System.getenv("ILOVETRAINS_KEYSTORE")
    val releasePasswordFile = System.getenv("ILOVETRAINS_KEYSTORE_PASSWORD_FILE")
    signingConfigs {
        if (releaseKey != null && releasePasswordFile != null) {
            create("personalRelease") {
                storeFile = file(releaseKey)
                storePassword = file(releasePasswordFile).readText().trim()
                keyAlias = "ilovetrains"
                keyPassword = storePassword
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseKey != null && releasePasswordFile != null) signingConfig = signingConfigs.getByName("personalRelease")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("test").resources.srcDir("../../tools/fixtures/conformance")
    sourceSets.getByName("androidTest").assets.srcDir("../../tools/fixtures")
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.10.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}
