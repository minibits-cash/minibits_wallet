package com.minibits_wallet

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Choreographer.FrameCallback
import com.facebook.react.internal.ChoreographerProvider

/**
 * RN drives JS timers (setTimeout/setInterval) from Choreographer frame callbacks.
 * With the activity stopped (app warm in background), Android stops delivering vsync,
 * so on a background NWC wake every timer froze even though headless tasks were active:
 * fetch never resolved (whatwg-fetch resolves via setTimeout(0)), the listener's 30s
 * close never ran, and the shortService FGS hit its 3 min limit → Background ANR.
 *
 * Each posted callback also gets a main-looper fallback; whichever fires first runs it.
 * In the foreground vsync always wins, so behaviour there is unchanged.
 */
class VsyncFallbackChoreographerProvider : ChoreographerProvider {

    override fun getChoreographer(): ChoreographerProvider.Choreographer =
        object : ChoreographerProvider.Choreographer {
            private val choreographer = Choreographer.getInstance()
            private val handler = Handler(Looper.getMainLooper())
            private val pending = HashMap<FrameCallback, Pair<FrameCallback, Runnable>>()

            override fun postFrameCallback(callback: FrameCallback) {
                val onVsync = FrameCallback { fire(callback, it) }
                val onFallback = Runnable {
                    if (BuildConfig.DEBUG) Log.d(TAG, "vsync missed, fallback frame")
                    fire(callback, System.nanoTime())
                }
                synchronized(pending) {
                    if (pending.containsKey(callback)) return
                    pending[callback] = Pair(onVsync, onFallback)
                }
                choreographer.postFrameCallback(onVsync)
                // ponytail: fixed 100ms fallback; background timers tick at most ~10Hz, fine for NWC
                handler.postDelayed(onFallback, FALLBACK_DELAY_MS)
            }

            override fun removeFrameCallback(callback: FrameCallback) {
                val entry = synchronized(pending) { pending.remove(callback) } ?: return
                choreographer.removeFrameCallback(entry.first)
                handler.removeCallbacks(entry.second)
            }

            private fun fire(callback: FrameCallback, frameTimeNanos: Long) {
                val entry = synchronized(pending) { pending.remove(callback) } ?: return
                choreographer.removeFrameCallback(entry.first)
                handler.removeCallbacks(entry.second)
                callback.doFrame(frameTimeNanos)
            }
        }

    private companion object {
        const val FALLBACK_DELAY_MS = 100L
        const val TAG = "VsyncFallback"
    }
}
