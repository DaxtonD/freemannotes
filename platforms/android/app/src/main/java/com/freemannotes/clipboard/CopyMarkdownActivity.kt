package com.freemannotes.clipboard

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle

class CopyMarkdownActivity : Activity() {
	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		val selectedText = intent.getCharSequenceExtra(android.content.Intent.EXTRA_PROCESS_TEXT)?.toString().orEmpty()
		ConversionEngine(this).convert(selectedText, "markdown") { text, _ ->
			val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
			clipboard.setPrimaryClip(ClipData.newPlainText("Markdown", text))
			finish()
		}
	}
}
