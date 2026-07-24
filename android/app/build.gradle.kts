plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.chengchao.memorypalace"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chengchao.memorypalace"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore/memorypalace.jks")
            storePassword = "memorypalace"
            keyAlias = "memorypalace"
            keyPassword = "memorypalace"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.webkit:webkit:1.12.0")
    implementation("androidx.core:core-ktx:1.13.1")
}

// 构建前把仓库根目录的 Web 应用打包进 assets
val copyWebAssets by tasks.registering(Copy::class) {
    val webRoot = rootProject.projectDir.parentFile
    from(webRoot) {
        include("index.html", "css/**", "js/**")
    }
    into(layout.projectDirectory.dir("src/main/assets/web"))
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }
