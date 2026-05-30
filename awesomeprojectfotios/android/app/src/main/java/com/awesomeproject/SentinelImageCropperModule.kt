package com.awesomeproject

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class SentinelImageCropperModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SentinelImageCropper"

  @ReactMethod
  fun cropFaceToJpeg(
    photoUri: String,
    cropX: Double,
    cropY: Double,
    cropWidth: Double,
    cropHeight: Double,
    promise: Promise,
  ) {
    try {
      val path = Uri.parse(photoUri).path ?: photoUri.removePrefix("file://")
      val source = BitmapFactory.decodeFile(path)
        ?: throw IllegalArgumentException("Unable to decode photo")

      val x = cropX.toInt().coerceIn(0, source.width - 1)
      val y = cropY.toInt().coerceIn(0, source.height - 1)
      val width = cropWidth.toInt().coerceAtLeast(1).coerceAtMost(source.width - x)
      val height = cropHeight.toInt().coerceAtLeast(1).coerceAtMost(source.height - y)

      val cropped = Bitmap.createBitmap(source, x, y, width, height)
      val resized = Bitmap.createScaledBitmap(cropped, 112, 112, true)
      val output = File(
        reactApplicationContext.cacheDir,
        "sentinel_face_${UUID.randomUUID()}.bin",
      )

      FileOutputStream(output).use { stream ->
        val pixels = IntArray(112 * 112)
        resized.getPixels(pixels, 0, 112, 0, 0, 112, 112)
        val rgbBytes = ByteArray(112 * 112 * 3)
        for (i in pixels.indices) {
          val pixel = pixels[i]
          rgbBytes[i * 3] = ((pixel shr 16) and 0xFF).toByte()     // R
          rgbBytes[i * 3 + 1] = ((pixel shr 8) and 0xFF).toByte()  // G
          rgbBytes[i * 3 + 2] = (pixel and 0xFF).toByte()          // B
        }
        stream.write(rgbBytes)
      }

      if (cropped != source) cropped.recycle()
      resized.recycle()
      source.recycle()

      val result = Arguments.createMap()
      result.putString("path", output.absolutePath)
      result.putString("uri", Uri.fromFile(output).toString())
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("E_FACE_CROP_FAILED", error)
    }
  }
}
