// Kleine Android-App, die nur das Familienkalender-Widget liefert (heute + Pinnwand)
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    buildFeatures { buildConfig = true }
    namespace = "de.familienkalender.widget"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.familienkalender.widget"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    // Signatur: Schlüssel kommt im Bau aus dem Secret WIDGET_KEYSTORE (liegt nicht im Repo).
    // Ohne Secret wird mit einem einmaligen Schlüssel signiert; Updates brauchen dann eine Neuinstallation.
    val ks = file("widget.keystore")
    signingConfigs {
        create("widget") {
            storeFile = if (ks.exists()) ks else null
            storePassword = System.getenv("WIDGET_KEY_PASS") ?: "android"
            keyAlias = "widget"
            keyPassword = System.getenv("WIDGET_KEY_PASS") ?: "android"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ks.exists()) signingConfigs.getByName("widget") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
