package org.hatialert.client.app

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * What part of the map is on screen, as the web map's view (map.ts `View`): [x], [y] is the
 * top-left corner and [w] the width, in map-space km (see [MapFrame]); the height follows
 * from the canvas's aspect ratio. Immutable: zooming and panning return a new view, already
 * kept inside the map by [clamp]. Pixel sizes are passed in, so the same view survives a
 * rotation or a resized window.
 */
data class MapView(val x: Double, val y: Double, val w: Double) {

    fun pxPerKm(widthPx: Float): Double = widthPx / w

    /** Screen x, y of a map-space point for a canvas [widthPx] wide. */
    fun sx(mx: Double, widthPx: Float): Float = ((mx - x) * widthPx / w).toFloat()
    fun sy(my: Double, widthPx: Float): Float = ((my - y) * widthPx / w).toFloat()

    /** The map-space point under a screen point. */
    fun toMap(px: Float, py: Float, widthPx: Float): MapPoint = MapPoint(x + px * w / widthPx, y + py * w / widthPx)

    fun heightKm(widthPx: Float, heightPx: Float): Double = w * aspect(widthPx, heightPx)

    /** Far out (the whole district): fewer labels, faint small streams. */
    val isFar: Boolean get() = w > FAR_KM

    /** Contour heights are labelled between [MID_KM] and [FAR_KM] wide. */
    val showsContourLabels: Boolean get() = w > MID_KM && w <= FAR_KM

    /**
     * Keeps the view on the map, as map.ts `set`: between 1.5 km wide and the whole map
     * (plus 2%), centred when it is wider or taller than the map, else at most 10% off an edge.
     */
    fun clamp(frame: MapFrame, widthPx: Float, heightPx: Float): MapView {
        val a = aspect(widthPx, heightPx)
        val maxW = max(frame.width, frame.height / a) * 1.02
        val nw = min(maxW, max(MIN_W, w))
        val nh = nw * a
        val nx = if (nw >= frame.width) (frame.width - nw) / 2 else min(max(x, -nw * 0.1), frame.width - nw * 0.9)
        val ny = if (nh >= frame.height) (frame.height - nh) / 2 else min(max(y, -nh * 0.1), frame.height - nh * 0.9)
        return MapView(nx, ny, nw)
    }

    /**
     * Zooms by [factor] (the new width is w * factor: below 1 zooms in) keeping the map point
     * under ([px], [py]) where it is, e.g. the middle of a pinch.
     */
    fun zoomAt(factor: Double, px: Float, py: Float, frame: MapFrame, widthPx: Float, heightPx: Float): MapView {
        val nw = w * factor
        val fx = px / widthPx
        val fy = py / heightPx
        val a = aspect(widthPx, heightPx)
        return MapView(x + fx * (w - nw), y + fy * (w * a - nw * a), nw).clamp(frame, widthPx, heightPx)
    }

    /** Moves the map with a finger: [dxPx], [dyPx] in screen pixels. */
    fun panBy(dxPx: Float, dyPx: Float, frame: MapFrame, widthPx: Float, heightPx: Float): MapView {
        val k = w / widthPx
        return MapView(x - dxPx * k, y - dyPx * k, w).clamp(frame, widthPx, heightPx)
    }

    /** Grid lines every 1, 2, 5, 10 or 20 km, so that at most 8 cross the view (map.ts). */
    fun gridStepKm(): Int = GRID_STEPS.firstOrNull { w / it <= 8 } ?: GRID_STEPS.last()

    /** Grid eastings (km) to draw from the left edge to the right one. */
    fun gridEastings(frame: MapFrame): IntProgression {
        val step = gridStepKm()
        val first = (ceil((frame.e0 + x) / step) * step).toInt()
        val last = (frame.e0 + x + w).toInt()
        return first..last step step
    }

    /** Grid northings (km) from the bottom edge to the top. */
    fun gridNorthings(frame: MapFrame, widthPx: Float, heightPx: Float): IntProgression {
        val step = gridStepKm()
        val h = heightKm(widthPx, heightPx)
        val first = (ceil((frame.n1 - y - h) / step) * step).toInt()
        val last = (frame.n1 - y).toInt()
        return first..last step step
    }

    companion object {
        const val MIN_W = 1.5
        const val FAR_KM = 30.0
        const val MID_KM = 9.0
        private val GRID_STEPS = listOf(1, 2, 5, 10, 20)
        private val SCALE_STEPS = listOf(0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0)

        private fun aspect(widthPx: Float, heightPx: Float): Double =
            (if (heightPx > 0f) heightPx else 300f).toDouble() / (if (widthPx > 0f) widthPx else 400f).toDouble()

        /**
         * The web map's starting view: everything in [points] with 1.5 km to spare on each side,
         * at least 8 km wide, centred, then kept on the map.
         */
        fun fit(points: List<MapPoint>, frame: MapFrame, widthPx: Float, heightPx: Float): MapView {
            if (points.isEmpty()) return MapView(0.0, 0.0, frame.width).clamp(frame, widthPx, heightPx)
            val a = aspect(widthPx, heightPx)
            val minX = points.minOf { it.x }
            val maxX = points.maxOf { it.x }
            val minY = points.minOf { it.y }
            val maxY = points.maxOf { it.y }
            var w = max(8.0, maxX - minX + 3)
            val h = maxY - minY + 3
            w = max(w, h / a)
            val cx = (minX + maxX) / 2
            val cy = (minY + maxY) / 2
            return MapView(cx - w / 2, cy - w * a / 2, w).clamp(frame, widthPx, heightPx)
        }

        /** The points a scene is fitted to: its [MapScene.bounds] corners in map space. */
        fun fitPoints(scene: MapScene, frame: MapFrame): List<MapPoint> {
            val b = scene.bounds
            return listOf(frame.toMap(GridKm(b.minE, b.minN)), frame.toMap(GridKm(b.maxE, b.maxN)))
        }

        /**
         * The scale bar for [kmPerPx]: a round distance near 90 px (map.ts), as (km, label),
         * e.g. (0.5, "500 m") or (2.0, "2 km").
         */
        fun scaleBar(kmPerPx: Double): Pair<Double, String> {
            val target = 90 * kmPerPx
            val nice = SCALE_STEPS.firstOrNull { it >= target * 0.6 } ?: SCALE_STEPS.last()
            val label = if (nice < 1) "${(nice * 1000).toInt()} m" else "${nice.toInt()} km"
            return nice to label
        }
    }
}

/**
 * Hides map labels that would sit on a marker or on a more important label, as the web
 * map's `declutter`. Feed it the markers with [block], then offer labels most important
 * first with [place]. Reused between frames: [reset] keeps its arrays.
 */
class LabelPlacer {
    private var boxes = FloatArray(64 * 4)
    private var count = 0

    fun reset() {
        count = 0
    }

    /** Space no label may cover (a village dot, an incident, a peak). */
    fun block(left: Float, top: Float, right: Float, bottom: Float) {
        if ((count + 1) * 4 > boxes.size) boxes = boxes.copyOf(boxes.size * 2)
        val i = count * 4
        boxes[i] = left
        boxes[i + 1] = top
        boxes[i + 2] = right
        boxes[i + 3] = bottom
        count++
    }

    /**
     * True when the label fits (and then takes its space). [always] labels (the home village)
     * are placed even on top of others.
     */
    fun place(left: Float, top: Float, right: Float, bottom: Float, always: Boolean = false): Boolean {
        if (!always && overlapsAny(left, top, right, bottom)) return false
        block(left, top, right, bottom)
        return true
    }

    fun overlapsAny(left: Float, top: Float, right: Float, bottom: Float): Boolean {
        for (k in 0 until count) {
            val i = k * 4
            if (left < boxes[i + 2] - 1 && boxes[i] < right - 1 && top < boxes[i + 3] - 1 && boxes[i + 1] < bottom - 1) return true
        }
        return false
    }
}
