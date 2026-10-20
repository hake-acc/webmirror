package com.webmirror.app.data.api

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.webmirror.app.data.model.JobConfig
import com.webmirror.app.data.model.JobModel
import com.webmirror.app.data.model.LogEntry
import com.webmirror.app.data.model.QualityReport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

class WebMirrorApiClient(private val baseUrlProvider: () -> String) {
    private val gson = Gson()

    private fun getBaseUrl(): String = baseUrlProvider().trim().removeSuffix("/")

    suspend fun checkHealth(): Result<Pair<Boolean, Long>> = withContext(Dispatchers.IO) {
        try {
            val start = System.currentTimeMillis()
            val url = URL("${getBaseUrl()}/health")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 4000
                readTimeout = 4000
            }
            val code = conn.responseCode
            val latency = System.currentTimeMillis() - start
            if (code == 200) {
                Result.success(Pair(true, latency))
            } else {
                Result.failure(Exception("HTTP $code from health check"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun listJobs(): Result<List<JobModel>> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8000
                readTimeout = 8000
            }
            if (conn.responseCode in 200..299) {
                val json = conn.inputStream.bufferedReader().use { it.readText() }
                val type = object : TypeToken<List<JobModel>>() {}.type
                val list: List<JobModel> = gson.fromJson(json, type)
                Result.success(list)
            } else {
                Result.failure(Exception("Failed to fetch jobs: HTTP ${conn.responseCode}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createJob(config: JobConfig): Result<JobModel> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 10000
                readTimeout = 10000
            }
            val body = gson.toJson(config)
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

            if (conn.responseCode in 200..299) {
                val json = conn.inputStream.bufferedReader().use { it.readText() }
                val job = gson.fromJson(json, JobModel::class.java)
                Result.success(job)
            } else {
                val errorMsg = conn.errorStream?.bufferedReader()?.use { it.readText() }
                Result.failure(Exception("Error creating job: HTTP ${conn.responseCode} $errorMsg"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getJob(id: String): Result<JobModel> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs/$id")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8000
                readTimeout = 8000
            }
            if (conn.responseCode in 200..299) {
                val json = conn.inputStream.bufferedReader().use { it.readText() }
                val job = gson.fromJson(json, JobModel::class.java)
                Result.success(job)
            } else {
                Result.failure(Exception("HTTP ${conn.responseCode}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getQualityReport(id: String): Result<QualityReport> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs/$id/report")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8000
                readTimeout = 8000
            }
            if (conn.responseCode in 200..299) {
                val json = conn.inputStream.bufferedReader().use { it.readText() }
                val report = gson.fromJson(json, QualityReport::class.java)
                Result.success(report)
            } else {
                Result.failure(Exception("Quality report not ready: HTTP ${conn.responseCode}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun cancelJob(id: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs/$id/cancel")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 6000
                readTimeout = 6000
            }
            Result.success(conn.responseCode in 200..299)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun retryJob(id: String): Result<JobModel> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs/$id/retry")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 6000
                readTimeout = 6000
            }
            if (conn.responseCode in 200..299) {
                val json = conn.inputStream.bufferedReader().use { it.readText() }
                val job = gson.fromJson(json, JobModel::class.java)
                Result.success(job)
            } else {
                Result.failure(Exception("Retry failed: HTTP ${conn.responseCode}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun downloadZip(
        id: String,
        destinationFile: File,
        onProgress: (bytesDownloaded: Long, totalBytes: Long) -> Unit
    ): Result<File> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs/$id/download")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 15000
                readTimeout = 30000
            }
            if (conn.responseCode !in 200..299) {
                return@withContext Result.failure(Exception("Download failed: HTTP ${conn.responseCode}"))
            }

            val totalBytes = conn.contentLengthLong
            var downloadedBytes = 0L

            conn.inputStream.use { input ->
                FileOutputStream(destinationFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        downloadedBytes += bytesRead
                        onProgress(downloadedBytes, totalBytes)
                    }
                }
            }
            Result.success(destinationFile)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun getPreviewUrl(id: String, relativePage: String = "index.html"): String {
        val rel = relativePage.removePrefix("/")
        return "${getBaseUrl()}/api/jobs/$id/preview/$rel"
    }

    suspend fun streamSseEvents(
        id: String,
        onJobUpdate: (JobModel) -> Unit,
        onLogReceived: (LogEntry) -> Unit
    ) = withContext(Dispatchers.IO) {
        try {
            val url = URL("${getBaseUrl()}/api/jobs/$id/events")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Accept", "text/event-stream")
                connectTimeout = 10000
                readTimeout = 0 // Infinite read timeout for SSE stream
            }

            if (conn.responseCode in 200..299) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
                var line: String? = null

                while (coroutineContext.isActive && reader.readLine().also { line = it } != null) {
                    val l = line?.trim() ?: continue
                    if (l.startsWith("data:")) {
                        val payload = l.substring(5).trim()
                        try {
                            if (payload.contains("\"type\":\"state\"")) {
                                val wrapper = gson.fromJson(payload, JobStateWrapper::class.java)
                                wrapper.job?.let { onJobUpdate(it) }
                            } else if (payload.contains("\"type\":\"log\"")) {
                                val wrapper = gson.fromJson(payload, JobLogWrapper::class.java)
                                wrapper.log?.let { onLogReceived(it) }
                            }
                        } catch (e: Exception) {
                            // parse error, skip malformed line
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // Connection closed or timed out
        }
    }

    private data class JobStateWrapper(val type: String?, val job: JobModel?)
    private data class JobLogWrapper(val type: String?, val log: LogEntry?)
}
