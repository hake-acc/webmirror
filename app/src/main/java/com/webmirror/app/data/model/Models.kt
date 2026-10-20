package com.webmirror.app.data.model

import com.google.gson.annotations.SerializedName

data class ViewportConfig(
    @SerializedName("width") val width: Int = 1280,
    @SerializedName("height") val height: Int = 800,
    @SerializedName("deviceScaleFactor") val deviceScaleFactor: Double = 1.0,
    @SerializedName("isMobile") val isMobile: Boolean = false,
    @SerializedName("name") val name: String = "Desktop"
)

data class AssetDownloadOptions(
    @SerializedName("css") val css: Boolean = true,
    @SerializedName("js") val js: Boolean = true,
    @SerializedName("images") val images: Boolean = true,
    @SerializedName("fonts") val fonts: Boolean = true,
    @SerializedName("media") val media: Boolean = true,
    @SerializedName("json") val json: Boolean = true
)

data class JobConfig(
    @SerializedName("url") val url: String,
    @SerializedName("crawlDepth") val crawlDepth: Int = 1,
    @SerializedName("maxPages") val maxPages: Int = 10,
    @SerializedName("includeAssets") val includeAssets: AssetDownloadOptions = AssetDownloadOptions(),
    @SerializedName("viewport") val viewport: ViewportConfig = ViewportConfig(),
    @SerializedName("performVisualDiff") val performVisualDiff: Boolean = true,
    @SerializedName("testInteractions") val testInteractions: Boolean = true,
    @SerializedName("timeoutMs") val timeoutMs: Long = 15000,
    @SerializedName("userAgent") val userAgent: String? = null
)

data class JobStats(
    @SerializedName("discoveredPages") var discoveredPages: Int = 0,
    @SerializedName("crawledPages") var crawledPages: Int = 0,
    @SerializedName("downloadedAssets") var downloadedAssets: Int = 0,
    @SerializedName("failedAssets") var failedAssets: Int = 0,
    @SerializedName("totalBytes") var totalBytes: Long = 0,
    @SerializedName("startTime") val startTime: Long = System.currentTimeMillis(),
    @SerializedName("endTime") var endTime: Long? = null,
    @SerializedName("currentTask") var currentTask: String = "Initializing"
)

data class LogEntry(
    @SerializedName("timestamp") val timestamp: Long = System.currentTimeMillis(),
    @SerializedName("stage") val stage: String = "connecting",
    @SerializedName("message") val message: String = "",
    @SerializedName("level") val level: String = "info"
)

data class MissingAsset(
    @SerializedName("url") val url: String,
    @SerializedName("type") val type: String = "unknown",
    @SerializedName("statusCode") val statusCode: Int? = null,
    @SerializedName("error") val error: String = "",
    @SerializedName("sourcePage") val sourcePage: String? = null
)

data class BrokenLink(
    @SerializedName("sourcePage") val sourcePage: String,
    @SerializedName("targetUrl") val targetUrl: String,
    @SerializedName("statusCode") val statusCode: Int? = null,
    @SerializedName("reason") val reason: String = ""
)

data class DeploymentCompatibility(
    @SerializedName("staticHostingReady") val staticHostingReady: Boolean = true,
    @SerializedName("vercelReady") val vercelReady: Boolean = true,
    @SerializedName("netlifyReady") val netlifyReady: Boolean = true,
    @SerializedName("githubPagesReady") val githubPagesReady: Boolean = true,
    @SerializedName("cloudflareReady") val cloudflareReady: Boolean = true,
    @SerializedName("warnings") val warnings: List<String> = emptyList(),
    @SerializedName("recommendations") val recommendations: List<String> = emptyList()
)

data class QualityReport(
    @SerializedName("fidelityScore") val fidelityScore: Int = 0,
    @SerializedName("originalScreenshotUrl") val originalScreenshotUrl: String? = null,
    @SerializedName("clonedScreenshotUrl") val clonedScreenshotUrl: String? = null,
    @SerializedName("diffScreenshotUrl") val diffScreenshotUrl: String? = null,
    @SerializedName("pixelDiffRatio") val pixelDiffRatio: Double? = null,
    @SerializedName("missingAssets") val missingAssets: List<MissingAsset> = emptyList(),
    @SerializedName("brokenLinks") val brokenLinks: List<BrokenLink> = emptyList(),
    @SerializedName("consoleErrors") val consoleErrors: List<String> = emptyList(),
    @SerializedName("unresolvedIssues") val unresolvedIssues: List<String> = emptyList(),
    @SerializedName("deploymentCompatibility") val deploymentCompatibility: DeploymentCompatibility? = null,
    @SerializedName("categoryCounts") val categoryCounts: Map<String, Int> = emptyMap(),
    @SerializedName("generatedAt") val generatedAt: Long = 0
)

data class ClonedPage(
    @SerializedName("sourceUrl") val sourceUrl: String,
    @SerializedName("localPath") val localPath: String,
    @SerializedName("title") val title: String,
    @SerializedName("byteSize") val byteSize: Long,
    @SerializedName("depth") val depth: Int
)

data class ClonedAsset(
    @SerializedName("sourceUrl") val sourceUrl: String,
    @SerializedName("localPath") val localPath: String,
    @SerializedName("mimeType") val mimeType: String,
    @SerializedName("byteSize") val byteSize: Long,
    @SerializedName("sha256") val sha256: String,
    @SerializedName("category") val category: String
)

data class CloneManifest(
    @SerializedName("version") val version: String,
    @SerializedName("clonedAt") val clonedAt: String,
    @SerializedName("origin") val origin: String,
    @SerializedName("entryPage") val entryPage: String,
    @SerializedName("totalPages") val totalPages: Int,
    @SerializedName("totalAssets") val totalAssets: Int,
    @SerializedName("totalBytes") val totalBytes: Long,
    @SerializedName("pages") val pages: List<ClonedPage> = emptyList(),
    @SerializedName("assets") val assets: List<ClonedAsset> = emptyList()
)

data class JobModel(
    @SerializedName("id") val id: String,
    @SerializedName("url") val url: String,
    @SerializedName("normalizedUrl") val normalizedUrl: String = url,
    @SerializedName("status") var status: String = "connecting",
    @SerializedName("progress") var progress: Int = 0,
    @SerializedName("config") val config: JobConfig,
    @SerializedName("stats") val stats: JobStats = JobStats(),
    @SerializedName("error") var error: String? = null,
    @SerializedName("logs") val logs: MutableList<LogEntry> = mutableListOf(),
    @SerializedName("manifest") var manifest: CloneManifest? = null,
    @SerializedName("report") var report: QualityReport? = null,
    @SerializedName("zipFileName") var zipFileName: String? = null,
    @SerializedName("zipFileSize") var zipFileSize: Long? = null,
    @SerializedName("exportDirPath") var exportDirPath: String? = null,
    @SerializedName("zipFilePath") var zipFilePath: String? = null
)
