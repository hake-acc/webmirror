package com.webmirror.app.ui.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.webmirror.app.R
import com.webmirror.app.data.model.LogEntry
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class LogConsoleAdapter : RecyclerView.Adapter<LogConsoleAdapter.LogViewHolder>() {

    private val logs = mutableListOf<LogEntry>()
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    fun setLogs(newLogs: List<LogEntry>) {
        logs.clear()
        logs.addAll(newLogs)
        notifyDataSetChanged()
    }

    fun addLog(log: LogEntry) {
        logs.add(log)
        notifyItemInserted(logs.size - 1)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): LogViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_terminal_log, parent, false)
        return LogViewHolder(view)
    }

    override fun onBindViewHolder(holder: LogViewHolder, position: Int) {
        holder.bind(logs[position])
    }

    override fun getItemCount(): Int = logs.size

    inner class LogViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvTime: TextView = itemView.findViewById(R.id.tv_log_time)
        private val tvStage: TextView = itemView.findViewById(R.id.tv_log_stage)
        private val tvMessage: TextView = itemView.findViewById(R.id.tv_log_message)

        fun bind(log: LogEntry) {
            tvTime.text = timeFormat.format(Date(log.timestamp))
            tvStage.text = "[${log.stage.uppercase()}]"
            tvMessage.text = log.message

            val colorRes = when (log.level) {
                "warn" -> R.color.terminal_warn
                "error" -> R.color.terminal_error
                else -> R.color.terminal_text
            }
            tvMessage.setTextColor(ContextCompat.getColor(itemView.context, colorRes))
        }
    }
}
