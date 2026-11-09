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
        // VERSION_OFFSET: nach dem Umzug zu Forgejo beginnt die Laufnummer neu, der Versatz hält die Nummern höher als bei GitHub
        val run = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt() + (System.getenv("VERSION_OFFSET") ?: "0").toInt()
        versionCode = run
        versionName = "1.0.$run"
    }

    // Signatur: Schlüssel kommt im Bau aus dem Secret WIDGET_KEYSTORE (liegt nicht im Repo).
    // Ohne Secret erzeugt der Bau einmalig einen Schlüssel und hebt ihn im Actions-Cache auf.
    val ks = file("widget.keystore")
    signingConfigs {
        create("widget") {
            storeFile = if (ks.exists()) ks else null
            storePassword = System.getenv("WIDGET_KEY_PASS")?.takeIf { it.isNotEmpty() } ?: "android"
            keyAlias = "widget"
            keyPassword = System.getenv("WIDGET_KEY_PASS")?.takeIf { it.isNotEmpty() } ?: "android"
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

dependencies {
    // Geofencing für den automatischen Home-Modus
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // Kamera-Foto aus der App an die Web-App übergeben
    implementation("androidx.core:core:1.13.1")
}
