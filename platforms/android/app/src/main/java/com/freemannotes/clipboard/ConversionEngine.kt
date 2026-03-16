package com.freemannotes.clipboard

import android.content.Context
import android.webkit.ValueCallback
import android.webkit.WebSettings
import android.webkit.WebView
import org.json.JSONObject

class ConversionEngine(private val context: Context) {
	fun convert(text: String, target: String, callback: (String, String?) -> Unit) {
		val webView = WebView(context)
		webView.settings.javaScriptEnabled = true
		webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
		webView.loadData("<html><body></body></html>", "text/html", "utf-8")
		webView.evaluateJavascript(loadBundle()) {
			val json = JSONObject().put("text", text)
			val script = "JSON.stringify(globalThis.FreemanClipboardConverter.prepareConvertedClipboardPayload(${JSONObject.quote(json.toString())} ? JSON.parse(${JSONObject.quote(json.toString())}) : {text: ''}, ${JSONObject.quote(target)}))"
			webView.evaluateJavascript(script, ValueCallback { result ->
				val parsed = JSONObject(result.removePrefix("\"").removeSuffix("\"").replace("\\\"", "\""))
				callback(parsed.getString("text"), parsed.optString("html").ifBlank { null })
				webView.destroy()
			})
		}
	}

	private fun loadBundle(): String {
		context.assets.open("clipboard-converter.bundle.js").bufferedReader().use {
			return it.readText()
		}
	}
}
