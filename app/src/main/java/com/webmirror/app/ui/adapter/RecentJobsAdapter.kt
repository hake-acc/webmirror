package com.webmirror.app.ui.adapter

import android.content.Context
import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.webmirror.app.R
import com.webmirror.app.data.model.JobModel

class RecentJobsAdapter(
    private val onJobClick: (JobModel) -> Unit,
    private val onDownloadClick: (JobModel) -> Unit
) : RecyclerView.Adapter<RecentJobsAdapter.JobViewHolder>() {

    private val jobs = mutableListOf<JobModel>()

    fun setJobs(newJobs: List<JobModel>) {
        jobs.clear()
        jobs.addAll(newJobs)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): JobViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_recent_job, parent, false)
        return JobViewHolder(view)
    }

    override fun onBindViewHolder(holder: JobViewHolder, position: Int) {
        holder.bind(jobs[position])
    }

    override fun getItemCount(): Int = jobs.size

    inner class JobViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvUrl: TextView = itemView.findViewById(R.id.tv_job_url)
        private val chipStatus: Chip = itemView.findViewById(R.id.chip_job_status)
        private val chipFidelity: Chip = itemView.findViewById(R.id.chip_fidelity)
        private val tvStats: TextView = itemView.findViewById(R.id.tv_job_stats)
        private val btnView: MaterialButton = itemView.findViewById(R.id.btn_view_job)
        private val btnDownload: MaterialButton = itemView.findViewById(R.id.btn_download_job)

        fun bind(job: JobModel) {
            tvUrl.text = job.url

            // Status chip
            chipStatus.text = job.status.replace("_", " ").uppercase()
            when (job.status) {
                "completed" -> {
                    chipStatus.setChipBackgroundColorResource(R.color.bg_surface_elevated)
                    chipStatus.setTextColor(ContextCompat.getColor(itemView.context, R.color.status_success))
                    chipStatus.setChipStrokeColorResource(R.color.status_success)
                }
                "failed" -> {
                    chipStatus.setChipBackgroundColorResource(R.color.bg_surface_elevated)
                    chipStatus.setTextColor(ContextCompat.getColor(itemView.context, R.color.status_error))
                    chipStatus.setChipStrokeColorResource(R.color.status_error)
                }
                else -> {
                    chipStatus.setChipBackgroundColorResource(R.color.bg_surface_elevated)
                    chipStatus.setTextColor(ContextCompat.getColor(itemView.context, R.color.secondary_teal))
                    chipStatus.setChipStrokeColorResource(R.color.secondary_teal)
                }
            }

            // Fidelity chip
            val fidelity = job.report?.fidelityScore
            if (fidelity != null && fidelity > 0) {
                chipFidelity.visibility = View.VISIBLE
                chipFidelity.text = "$fidelity% Fidelity"
                chipFidelity.setTextColor(ContextCompat.getColor(itemView.context, R.color.primary_neon))
            } else {
                chipFidelity.visibility = View.GONE
            }

            // Stats
            val pages = job.stats.discoveredPages
            val assets = job.stats.downloadedAssets
            val kb = job.stats.totalBytes / 1024
            tvStats.text = "$pages pages • $assets assets • ${kb} KB"

            btnDownload.visibility = if (job.zipFileName != null) View.VISIBLE else View.GONE

            btnView.setOnClickListener { onJobClick(job) }
            btnDownload.setOnClickListener { onDownloadClick(job) }
            itemView.setOnClickListener { onJobClick(job) }
        }
    }
}
