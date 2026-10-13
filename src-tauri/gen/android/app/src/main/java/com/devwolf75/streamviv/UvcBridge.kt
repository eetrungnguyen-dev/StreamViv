package com.devwolf75.streamviv

import android.app.Activity
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.os.Handler
import android.os.HandlerThread
import android.view.TextureView
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import com.serenegiant.usb.Size
import com.serenegiant.usb.USBMonitor
import com.serenegiant.usb.UVCCamera
import com.serenegiant.usb.UVCParam
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * USB capture cards on Android.
 *
 * The System WebView's getUserMedia() only sees cameras the phone's Camera2
 * HAL exposes, and most phones expose no USB video devices there at all. So
 * the card is opened here instead, through the USB host API (which is what
 * raises the "Allow StreamViv to access ..." prompt), and drawn into a
 * TextureView that sits behind a transparent WebView. The page still owns
 * the geometry: it computes rotation/fit exactly as on desktop and hands
 * the numbers to layout().
 *
 * Exposed to the page as `window.StreamVivUVC`; replies and events come back
 * through `window.__streamvivUvc(json)`.
 */
class UvcBridge(private val activity: Activity, private val webView: WebView) :
    USBMonitor.OnDeviceConnectListener {

    private val worker = HandlerThread("uvc").apply { start() }
    private val handler = Handler(worker.looper)
    private val monitor = USBMonitor(activity, this, handler)

    private class Request(val id: Int, val device: String, val width: Int, val height: Int, val fps: Int)

    // Touched only on the worker thread.
    private var pending: Request? = null
    private var camera: UVCCamera? = null
    private var cameraDevice: String? = null

    private var texture: TextureView? = null
    @Volatile private var surface: SurfaceTexture? = null
    private var surfaceReady = CountDownLatch(1)

    init {
        monitor.register()
    }

    fun destroy() {
        handler.post {
            closeCamera()
            monitor.unregister()
            monitor.destroy()
            worker.quitSafely()
        }
    }

    // ------------------------------------------------------------ page API

    @JavascriptInterface
    fun devices(): String {
        val out = JSONArray()
        for (d in monitor.deviceList) {
            if (!isVideo(d)) continue
            out.put(JSONObject().put("deviceId", d.deviceName).put("label", label(d)))
        }
        return out.toString()
    }

    /** Asks for USB permission if needed; the reply arrives as a "result" event. */
    @JavascriptInterface
    fun open(id: Int, deviceName: String, width: Int, height: Int, fps: Int) {
        handler.post {
            val device = monitor.deviceList.firstOrNull { it.deviceName == deviceName }
            if (device == null) {
                reply(id, error = "The capture device is no longer connected.")
                return@post
            }
            pending?.let { reply(it.id, error = "Superseded by a newer request.") }
            pending = Request(id, deviceName, width, height, fps)
            // Grants straight away (onDeviceOpen) when permission is already
            // held, otherwise shows the system prompt.
            monitor.requestPermission(device)
        }
    }

    @JavascriptInterface
    fun close() {
        handler.post { closeCamera() }
    }

    /** Geometry in physical px, mirroring the CSS transform of the <video>. */
    @JavascriptInterface
    fun layout(json: String) {
        val o = JSONObject(json)
        activity.runOnUiThread {
            val tv = ensureTexture()
            val w = o.getInt("w").coerceAtLeast(1)
            val h = o.getInt("h").coerceAtLeast(1)
            val lp = tv.layoutParams
            if (lp.width != w || lp.height != h) {
                lp.width = w
                lp.height = h
                tv.layoutParams = lp
            }
            tv.x = o.getDouble("x").toFloat()
            tv.y = o.getDouble("y").toFloat()
            tv.pivotX = w / 2f
            tv.pivotY = h / 2f
            tv.rotation = o.getDouble("rotation").toFloat()
            tv.scaleX = o.getDouble("sx").toFloat()
            tv.scaleY = o.getDouble("sy").toFloat()
        }
    }

    // ------------------------------------------------------- USB callbacks

    override fun onAttach(device: UsbDevice) {
        if (isVideo(device)) emit(JSONObject().put("type", "devicechange"))
    }

    override fun onDetach(device: UsbDevice) {
        if (!isVideo(device)) return
        if (device.deviceName == cameraDevice) {
            closeCamera()
            emit(JSONObject().put("type", "ended"))
        }
        emit(JSONObject().put("type", "devicechange"))
    }

    override fun onDeviceOpen(device: UsbDevice, ctrlBlock: USBMonitor.UsbControlBlock, createNew: Boolean) {
        val req = pending ?: return
        if (req.device != device.deviceName) return
        pending = null
        try {
            reply(req.id, value = startCamera(req, ctrlBlock, device))
        } catch (t: Throwable) {
            // UnsatisfiedLinkError lands here too: the bundled native libs
            // are 4 KB page aligned and may not load on a 16 KB kernel.
            closeCamera()
            reply(req.id, error = "Could not start the capture card: ${t.message ?: t.javaClass.simpleName}")
        }
    }

    override fun onDeviceClose(device: UsbDevice, ctrlBlock: USBMonitor.UsbControlBlock) {}

    override fun onCancel(device: UsbDevice) {
        val req = pending ?: return
        if (req.device != device.deviceName) return
        pending = null
        reply(req.id, error = "USB access to the capture card was denied. Unplug and replug it to be asked again.")
    }

    override fun onError(device: UsbDevice, e: USBMonitor.USBException) {
        val req = pending ?: return
        pending = null
        reply(req.id, error = "USB error: ${e.message}")
    }

    // ------------------------------------------------------------- camera

    private fun startCamera(req: Request, ctrlBlock: USBMonitor.UsbControlBlock, device: UsbDevice): JSONObject {
        closeCamera()
        val cam = UVCCamera(UVCParam())
        val rc = cam.open(ctrlBlock)
        if (rc != 0) {
            cam.destroy()
            throw IllegalStateException("open failed ($rc)")
        }
        camera = cam
        cameraDevice = device.deviceName

        val mode = pickMode(cam.supportedSizeList, req.width, req.height)
            ?: throw IllegalStateException("the card reports no usable video modes")
        val fps = pickFps(mode, req.fps)
        cam.setPreviewSize(mode.width, mode.height, mode.type, fps)

        activity.runOnUiThread { ensureTexture() }
        if (!surfaceReady.await(3, TimeUnit.SECONDS)) throw IllegalStateException("no drawing surface")
        val st = surface ?: throw IllegalStateException("no drawing surface")
        st.setDefaultBufferSize(mode.width, mode.height)
        cam.setPreviewTexture(st)
        cam.startPreview()
        activity.runOnUiThread {
            // The page paints its controls over the picture from here on.
            webView.setBackgroundColor(Color.TRANSPARENT)
            texture?.visibility = android.view.View.VISIBLE
        }

        val exact = req.width == 0 || (req.width == mode.width && req.height == mode.height)
        return JSONObject()
            .put("label", label(device))
            .put("deviceId", device.deviceName)
            .put("width", mode.width)
            .put("height", mode.height)
            .put("frameRate", fps)
            .put("format", if (mode.type == UVCCamera.UVC_VS_FRAME_MJPEG) "MJPEG" else "YUYV")
            .put("degraded", !exact || (req.fps > 0 && req.fps != fps))
    }

    private fun closeCamera() {
        camera?.let {
            try { it.stopPreview() } catch (_: Throwable) {}
            try { it.destroy() } catch (_: Throwable) {}
        }
        camera = null
        cameraDevice = null
        activity.runOnUiThread { texture?.visibility = android.view.View.INVISIBLE }
    }

    private fun ensureTexture(): TextureView {
        texture?.let { return it }
        val tv = TextureView(activity)
        tv.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
                surface = st
                surfaceReady.countDown()
            }
            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                surface = null
                surfaceReady = CountDownLatch(1)
                return true
            }
            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
        }
        // Behind the WebView, in the same parent, so page coordinates are
        // view coordinates.
        val parent = webView.parent as ViewGroup
        parent.setBackgroundColor(Color.BLACK)
        parent.addView(tv, 0, FrameLayout.LayoutParams(parent.width.coerceAtLeast(1), parent.height.coerceAtLeast(1)))
        texture = tv
        return tv
    }

    // ------------------------------------------------------------ helpers

    private fun isVideo(d: UsbDevice): Boolean =
        d.deviceClass == UsbConstants.USB_CLASS_VIDEO ||
            (0 until d.interfaceCount).any { d.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_VIDEO }

    private fun label(d: UsbDevice): String =
        d.productName?.takeIf { it.isNotBlank() }
            ?: "USB video %04x:%04x".format(d.vendorId, d.productId)

    private fun emit(o: JSONObject) {
        val js = "window.__streamvivUvc && window.__streamvivUvc(${o})"
        activity.runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun reply(id: Int, value: JSONObject? = null, error: String? = null) {
        val o = JSONObject().put("type", "result").put("id", id)
        if (error != null) o.put("error", error) else o.put("value", value)
        emit(o)
    }

    companion object {
        /**
         * The requested size if the card offers it, else the largest - and
         * MJPEG before anything else, because cards also advertise big YUYV
         * modes that USB 2 can only carry at a few frames a second.
         */
        fun pickMode(sizes: List<Size>, width: Int, height: Int): Size? {
            val usable = sizes.filter {
                it.type == UVCCamera.UVC_VS_FRAME_MJPEG || it.type == UVCCamera.UVC_VS_FRAME_UNCOMPRESSED
            }
            val rank = compareBy<Size>({ if (it.type == UVCCamera.UVC_VS_FRAME_MJPEG) 1 else 0 }, { it.width * it.height })
            val exact = usable.filter { it.width == width && it.height == height }
            return (exact.ifEmpty { usable }).maxWithOrNull(rank)
        }

        fun pickFps(mode: Size, wanted: Int): Int {
            val list = mode.fpsList?.filter { it > 0 }.orEmpty()
            if (list.isEmpty()) return if (mode.fps > 0) mode.fps else UVCCamera.DEFAULT_PREVIEW_FPS
            if (wanted > 0 && wanted in list) return wanted
            return list.max()
        }
    }
}
