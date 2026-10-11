package org.hatialert.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt
import org.hatialert.core.MediaKind

/** Camera photos: a file for the camera app to fill, then a JPEG small enough to upload. */
object Photos {
    /** Longest side after shrinking, as the web app does. */
    const val MAX_SIDE = 1600

    /** A new empty file under cache/photos and its content:// URI for the camera app. */
    fun newCaptureTarget(context: Context): Pair<File, Uri> {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        val file = File(dir, "hati-${System.currentTimeMillis()}.jpg")
        return file to FileProvider.getUriForFile(context, context.packageName + ".photos", file)
    }

    /**
     * Upright JPEG with its longest side at most [maxSide] px and under the
     * server's photo limit. Runs on a background thread. Deletes [file].
     */
    @Throws(IOException::class)
    fun shrink(file: File, maxSide: Int = MAX_SIDE, maxBytes: Int = MediaKind.PHOTO.maxBytes()): ByteArray {
        try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IOException("The camera didn't save a photo.")
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
            var bmp = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
                ?: throw IOException("Couldn't read the photo.")
            val scale = maxSide.toFloat() / max(bmp.width, bmp.height)
            if (scale < 1f) {
                bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).roundToInt(), (bmp.height * scale).roundToInt(), true)
            }
            val degrees = when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
            if (degrees != 0f) {
                bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(degrees) }, true)
            }
            var quality = 85
            while (true) {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
                if (out.size() <= maxBytes || quality <= 40) {
                    if (out.size() > maxBytes) throw IOException("The photo is too large to send.")
                    return out.toByteArray()
                }
                quality -= 15
            }
        } finally {
            file.delete()
        }
    }

    /** A small bitmap for on-screen thumbnails. */
    fun thumbnail(bytes: ByteArray, side: Int = 240): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= side) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
