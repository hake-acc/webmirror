package com.webmirror.app.ui.dialog

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.chip.Chip
import com.google.android.material.slider.Slider
import com.webmirror.app.R
import com.webmirror.app.data.model.ViewportConfig

class ConfigBottomSheetDialog(
    private var initialDepth: Int = 1,
    private var initialMaxPages: Int = 10,
    private var initialViewportName: String = "Desktop",
    private var initialVisualDiff: Boolean = true,
    private val onApply: (depth: Int, maxPages: Int, viewport: ViewportConfig, visualDiff: Boolean) -> Unit
) : BottomSheetDialogFragment() {

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.dialog_crawl_config, container, false)

        val chipScopeSingle: Chip = view.findViewById(R.id.chip_scope_single)
        val chipScopeSite: Chip = view.findViewById(R.id.chip_scope_site)
        val sliderDepth: Slider = view.findViewById(R.id.slider_depth)
        val tvDepthLabel: android.widget.TextView = view.findViewById(R.id.tv_depth_label)
        val tvMaxPagesLabel: android.widget.TextView = view.findViewById(R.id.tv_max_pages_label)
        val layoutDepthControls: View = view.findViewById(R.id.layout_depth_controls)

        val chipVpDesktop: Chip = view.findViewById(R.id.chip_vp_desktop)
        val chipVpTablet: Chip = view.findViewById(R.id.chip_vp_tablet)
        val chipVpMobile: Chip = view.findViewById(R.id.chip_vp_mobile)

        val cbVisualDiff: MaterialCheckBox = view.findViewById(R.id.cb_visual_diff)
        val btnApply: MaterialButton = view.findViewById(R.id.btn_apply_config)

        // Set initial values
        sliderDepth.value = initialDepth.coerceIn(1, 5).toFloat()
        tvDepthLabel.text = "Max Crawl Depth: ${initialDepth} levels"
        tvMaxPagesLabel.text = "Max Pages: ${initialMaxPages}"

        if (initialDepth == 0) {
            chipScopeSingle.isChecked = true
            layoutDepthControls.visibility = View.GONE
        } else {
            chipScopeSite.isChecked = true
            layoutDepthControls.visibility = View.VISIBLE
        }

        chipScopeSingle.setOnClickListener {
            layoutDepthControls.visibility = View.GONE
        }
        chipScopeSite.setOnClickListener {
            layoutDepthControls.visibility = View.VISIBLE
        }

        sliderDepth.addOnChangeListener { _, value, _ ->
            val d = value.toInt()
            val maxPages = d * 5
            tvDepthLabel.text = "Max Crawl Depth: $d levels"
            tvMaxPagesLabel.text = "Max Pages: $maxPages"
        }

        when (initialViewportName) {
            "Mobile" -> chipVpMobile.isChecked = true
            "Tablet" -> chipVpTablet.isChecked = true
            else -> chipVpDesktop.isChecked = true
        }

        cbVisualDiff.isChecked = initialVisualDiff

        btnApply.setOnClickListener {
            val isSingle = chipScopeSingle.isChecked
            val depth = if (isSingle) 0 else sliderDepth.value.toInt()
            val maxPages = if (isSingle) 1 else (depth * 5)

            val viewport = when {
                chipVpMobile.isChecked -> ViewportConfig(375, 812, 2.0, true, "Mobile")
                chipVpTablet.isChecked -> ViewportConfig(768, 1024, 1.5, false, "Tablet")
                else -> ViewportConfig(1920, 1080, 1.0, false, "Desktop")
            }

            onApply(depth, maxPages, viewport, cbVisualDiff.isChecked)
            dismiss()
        }

        return view
    }
}
