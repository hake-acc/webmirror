package com.webmirror.app.data.repository

import android.content.Context
import android.content.SharedPreferences

class PreferencesRepository(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("webmirror_prefs", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_SERVER_URL = "key_server_url"
        private const val DEFAULT_SERVER_URL = "http://10.0.2.2:3000"
        private const val KEY_DEFAULT_DEPTH = "key_default_depth"
        private const val KEY_DEFAULT_MAX_PAGES = "key_default_max_pages"
        private const val KEY_VISUAL_DIFF = "key_visual_diff"
    }

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value.trim().removeSuffix("/")).apply()

    var defaultCrawlDepth: Int
        get() = prefs.getInt(KEY_DEFAULT_DEPTH, 1)
        set(value) = prefs.edit().putInt(KEY_DEFAULT_DEPTH, value).apply()

    var defaultMaxPages: Int
        get() = prefs.getInt(KEY_DEFAULT_MAX_PAGES, 10)
        set(value) = prefs.edit().putInt(KEY_DEFAULT_MAX_PAGES, value).apply()

    var visualDiffEnabled: Boolean
        get() = prefs.getBoolean(KEY_VISUAL_DIFF, true)
        set(value) = prefs.edit().putBoolean(KEY_VISUAL_DIFF, value).apply()
}
