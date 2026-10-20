package com.webmirror.app

import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.webmirror.app.data.api.WebMirrorApiClient
import com.webmirror.app.data.model.JobConfig
import com.webmirror.app.data.model.JobModel
import com.webmirror.app.data.model.ViewportConfig
import com.webmirror.app.data.repository.PreferencesRepository
import com.webmirror.app.databinding.ActivityMainBinding
import com.webmirror.app.ui.adapter.LogConsoleAdapter
import com.webmirror.app.ui.adapter.RecentJobsAdapter
import com.webmirror.app.ui.dialog.ConfigBottomSheetDialog
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: PreferencesRepository
    private lateinit var apiClient: WebMirrorApiClient

    private val recentJobsAdapter = RecentJobsAdapter(
        onJobClick = { job -> displayJobDetails(job) },
        onDownloadClick = { job -> downloadJobZip(job) }
    )
    private val logAdapter = LogConsoleAdapter()

    private var activeJob: JobModel? = null
    private var sseJob: Job? = null
    private var currentDepth = 1
    private var currentMaxPages = 10
    private var currentViewport = ViewportConfig(1920, 1080, 1.0, false, "Desktop")
    private var currentVisualDiff = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = PreferencesRepository(this)
        apiClient = WebMirrorApiClient { prefs.serverUrl }

        setupViews()
        setupBottomNavigation()
        setupWebView()

        // Check backend connection on start
        checkBackendHealth()
        loadRecentJobs()
    }

    private fun setupViews() {
        // Recent jobs RecyclerView
        binding.rvRecentJobs.layoutManager = LinearLayoutManager(this)
        binding.rvRecentJobs.adapter = recentJobsAdapter

        // Terminal logs RecyclerView
        val terminalLayoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        binding.rvTerminalLogs.layoutManager = terminalLayoutManager
        binding.rvTerminalLogs.adapter = logAdapter

        // Server URL input in settings
        binding.etServerUrl.setText(prefs.serverUrl)

        // Paste URL button
        binding.btnPasteUrl.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            if (clipboard.hasPrimaryClip() && clipboard.primaryClipDescription?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) == true) {
                val item = clipboard.primaryClip?.getItemAt(0)
                val pasteText = item?.text?.toString()?.trim()
                if (!pasteText.isNullOrEmpty()) {
                    binding.etUrl.setText(pasteText)
                    binding.tilUrl.error = null
                }
            } else {
                Toast.makeText(this, "Clipboard is empty", Toast.LENGTH_SHORT).show()
            }
        }

        // Configure Crawl button
        binding.btnConfigCrawl.setOnClickListener {
            val dialog = ConfigBottomSheetDialog(
                initialDepth = currentDepth,
                initialMaxPages = currentMaxPages,
                initialViewportName = currentViewport.name,
                initialVisualDiff = currentVisualDiff
            ) { depth, maxPages, viewport, visualDiff ->
                currentDepth = depth
                currentMaxPages = maxPages
                currentViewport = viewport
                currentVisualDiff = visualDiff
                Toast.makeText(this, "Crawl options updated (Depth: $depth, ${viewport.name})", Toast.LENGTH_SHORT).show()
            }
            dialog.show(supportFragmentManager, "config_dialog")
        }

        // Start Cloning action
        binding.btnStartCloning.setOnClickListener {
            val rawUrl = binding.etUrl.text?.toString()?.trim() ?: ""
            if (validateAndFormatUrl(rawUrl)) {
                val formattedUrl = if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
                    "https://$rawUrl"
                } else {
                    rawUrl
                }
                startCloningJob(formattedUrl)
            }
        }

        // Refresh recent jobs
        binding.btnRefreshJobs.setOnClickListener {
            loadRecentJobs()
        }

        // Cancel Crawl button
        binding.btnCancelCrawl.setOnClickListener {
            activeJob?.let { job ->
                lifecycleScope.launch {
                    apiClient.cancelJob(job.id)
                    Toast.makeText(this@MainActivity, "Cancelling crawl…", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Inspect Progress / Go to Results
        binding.btnInspectProgress.setOnClickListener {
            switchTab(R.id.menu_results)
        }

        // Download ZIP action in Results
        binding.btnDownloadZipAction.setOnClickListener {
            activeJob?.let { downloadJobZip(it) }
        }

        // Retry missing assets
        binding.btnRetryMissing.setOnClickListener {
            activeJob?.let { job ->
                lifecycleScope.launch {
                    val result = apiClient.retryJob(job.id)
                    if (result.isSuccess) {
                        Toast.makeText(this@MainActivity, "Retrying failed assets…", Toast.LENGTH_SHORT).show()
                        switchTab(R.id.menu_progress)
                        subscribeToJobEvents(job.id)
                    } else {
                        Toast.makeText(this@MainActivity, "Retry failed to start", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        // Reload Preview
        binding.btnReloadPreview.setOnClickListener {
            activeJob?.let { job ->
                val previewUrl = apiClient.getPreviewUrl(job.id)
                binding.webPreview.loadUrl(previewUrl)
            }
        }

        // Test Connection in Settings
        binding.btnTestConnection.setOnClickListener {
            val enteredUrl = binding.etServerUrl.text?.toString()?.trim() ?: ""
            if (enteredUrl.isNotEmpty()) {
                prefs.serverUrl = enteredUrl
                checkBackendHealth()
            }
        }
    }

    private fun setupBottomNavigation() {
        binding.bottomNavigation.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.menu_home -> {
                    showTab(binding.viewTabHome)
                    loadRecentJobs()
                    true
                }
                R.id.menu_progress -> {
                    showTab(binding.viewTabProgress)
                    true
                }
                R.id.menu_results -> {
                    showTab(binding.viewTabResults)
                    true
                }
                R.id.menu_settings -> {
                    showTab(binding.viewTabSettings)
                    true
                }
                else -> false
            }
        }
    }

    private fun switchTab(menuItemId: Int) {
        binding.bottomNavigation.selectedItemId = menuItemId
    }

    private fun showTab(activeView: View) {
        binding.viewTabHome.visibility = if (activeView == binding.viewTabHome) View.VISIBLE else View.GONE
        binding.viewTabProgress.visibility = if (activeView == binding.viewTabProgress) View.VISIBLE else View.GONE
        binding.viewTabResults.visibility = if (activeView == binding.viewTabResults) View.VISIBLE else View.GONE
        binding.viewTabSettings.visibility = if (activeView == binding.viewTabSettings) View.VISIBLE else View.GONE
    }

    private fun setupWebView() {
        binding.webPreview.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        binding.webPreview.webViewClient = object : WebViewClient() {}
        binding.webPreview.webChromeClient = object : WebChromeClient() {}
    }

    private fun validateAndFormatUrl(url: String): Boolean {
        if (url.isBlank()) {
            binding.tilUrl.error = "Please enter a website URL"
            return false
        }
        if (!url.contains(".") || url.contains(" ")) {
            binding.tilUrl.error = "Please enter a valid website address"
            return false
        }
        binding.tilUrl.error = null
        return true
    }

    private fun checkBackendHealth() {
        binding.tvBackendStatus.text = getString(R.string.status_checking)
        binding.ivStatusDot.setColorFilter(ContextCompat.getColor(this, R.color.status_warning))

        lifecycleScope.launch {
            val result = apiClient.checkHealth()
            if (result.isSuccess) {
                val latency = result.getOrNull()?.second ?: 0
                binding.tvBackendStatus.text = getString(R.string.status_connected)
                binding.tvBackendLatency.text = "${latency}ms"
                binding.ivStatusDot.setColorFilter(ContextCompat.getColor(this@MainActivity, R.color.status_success))
            } else {
                binding.tvBackendStatus.text = getString(R.string.status_disconnected)
                binding.tvBackendLatency.text = "OFFLINE"
                binding.ivStatusDot.setColorFilter(ContextCompat.getColor(this@MainActivity, R.color.status_error))
            }
        }
    }

    private fun loadRecentJobs() {
        lifecycleScope.launch {
            val result = apiClient.listJobs()
            if (result.isSuccess) {
                val list = result.getOrNull() ?: emptyList()
                recentJobsAdapter.setJobs(list)
                binding.tvEmptyJobs.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
            }
        }
    }

    private fun startCloningJob(targetUrl: String) {
        val config = JobConfig(
            url = targetUrl,
            crawlDepth = currentDepth,
            maxPages = currentMaxPages,
            viewport = currentViewport,
            performVisualDiff = currentVisualDiff
        )

        lifecycleScope.launch {
            binding.btnStartCloning.isEnabled = false
            val result = apiClient.createJob(config)
            binding.btnStartCloning.isEnabled = true

            if (result.isSuccess) {
                val job = result.getOrNull()!!
                activeJob = job
                logAdapter.setLogs(emptyList())

                // Switch to progress tab and begin streaming
                switchTab(R.id.menu_progress)
                updateProgressUi(job)
                subscribeToJobEvents(job.id)
            } else {
                Toast.makeText(
                    this@MainActivity,
                    "Failed to start job: ${result.exceptionOrNull()?.message}",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun subscribeToJobEvents(jobId: String) {
        sseJob?.cancel()
        sseJob = lifecycleScope.launch {
            apiClient.streamSseEvents(
                id = jobId,
                onJobUpdate = { updated ->
                    runOnUiThread {
                        activeJob = updated
                        updateProgressUi(updated)
                        if (updated.status == "completed") {
                            displayJobDetails(updated)
                        }
                    }
                },
                onLogReceived = { entry ->
                    runOnUiThread {
                        logAdapter.addLog(entry)
                        binding.rvTerminalLogs.scrollToPosition(logAdapter.itemCount - 1)
                    }
                }
            )
        }
    }

    private fun updateProgressUi(job: JobModel) {
        binding.tvProgressUrl.text = job.url
        binding.tvActiveStage.text = job.status.replace("_", " ").uppercase()
        binding.tvProgressPercent.text = "${job.progress}%"
        binding.progressBar.progress = job.progress
        binding.tvCurrentTask.text = job.stats.currentTask

        binding.tvMetricPages.text = "${job.stats.discoveredPages}"
        binding.tvMetricAssets.text = "${job.stats.downloadedAssets}"
        binding.tvMetricFailed.text = "${job.stats.failedAssets}"
        val kb = job.stats.totalBytes / 1024
        binding.tvMetricBytes.text = if (kb > 1024) "${kb / 1024} MB" else "$kb KB"

        val isFinished = job.status == "completed" || job.status == "failed" || job.status == "cancelled"
        binding.btnCancelCrawl.isEnabled = !isFinished
        binding.btnInspectProgress.visibility = if (isFinished) View.VISIBLE else View.GONE
    }

    private fun displayJobDetails(job: JobModel) {
        activeJob = job
        switchTab(R.id.menu_results)

        val fidelity = job.report?.fidelityScore ?: 0
        binding.tvQaFidelity.text = "$fidelity% Fidelity"

        val missingCount = job.report?.missingAssets?.size ?: 0
        val brokenCount = job.report?.brokenLinks?.size ?: 0
        binding.tvQaSummary.text = "Audit: $brokenCount broken internal links, $missingCount missing assets identified."

        // Load preview
        val previewUrl = apiClient.getPreviewUrl(job.id)
        binding.webPreview.loadUrl(previewUrl)
    }

    private fun downloadJobZip(job: JobModel) {
        val fileName = job.zipFileName ?: "webmirror-export-${job.id}.zip"
        val downloadsDir = File(getExternalFilesDir(null), "Download")
        if (!downloadsDir.exists()) downloadsDir.mkdirs()
        val destFile = File(downloadsDir, fileName)

        Toast.makeText(this, "Downloading ZIP export…", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch {
            val result = apiClient.downloadZip(job.id, destFile) { downloaded, total ->
                // Progress tracking
            }

            if (result.isSuccess) {
                Toast.makeText(this@MainActivity, "Export saved: ${destFile.name}", Toast.LENGTH_LONG).show()

                // Share intent
                try {
                    val contentUri: Uri = FileProvider.getUriForFile(
                        this@MainActivity,
                        "${packageName}.fileprovider",
                        destFile
                    )
                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/zip"
                        putExtra(Intent.EXTRA_STREAM, contentUri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(shareIntent, "Share Cloned Website Archive"))
                } catch (e: Exception) {
                    // Fallback
                }
            } else {
                Toast.makeText(this@MainActivity, "Download error: ${result.exceptionOrNull()?.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        sseJob?.cancel()
    }
}
