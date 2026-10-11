package org.hatialert.client.app

import org.hatialert.client.Incident
import org.hatialert.client.Village
import org.hatialert.core.Geo
import org.hatialert.core.Utm

/** A point on the UTM zone 46N grid, in km (as the web map is labelled). */
data class GridKm(val e: Double, val n: Double)

fun gridKm(lat: Double, lng: Double): GridKm {
    val p = Utm.forward(lat, lng)
    return GridKm(p.eastingKm(), p.northingKm())
}

/** Axis-aligned extent in grid km. */
data class GridBounds(val minE: Double, val minN: Double, val maxE: Double, val maxN: Double) {
    val width get() = maxE - minE
    val height get() = maxN - minN
}

/**
 * What the native map draws: villages, open incidents and the alert ring around
 * the user's village, all projected to UTM km. Mirrors the web map (app.js):
 * a true geodesic ring of 73 points every 5 degrees, and a view fitted to the
 * incidents, the home village and the ring.
 */
class MapScene(
    val villages: List<Pair<Village, GridKm>>,
    val incidents: List<Pair<Incident, GridKm>>,
    val home: GridKm?,
    val radiusKm: Double,
    val ring: List<GridKm>,
    val bounds: GridBounds,
) {
    companion object {
        fun build(villages: List<Village>, incidents: List<Incident>, home: Village?, radiusKm: Double): MapScene {
            val vp = villages.map { it to gridKm(it.lat, it.lng) }
            val ip = incidents.map { it to gridKm(it.lat, it.lng) }
            val h = home?.let { gridKm(it.lat, it.lng) }
            val ring = if (home != null && radiusKm > 0) {
                (0..72).map { k -> Geo.destinationBearing(home.lat, home.lng, radiusKm, k * 5.0).let { gridKm(it.lat, it.lng) } }
            } else emptyList()
            val pts = buildList {
                addAll(ip.map { it.second })
                h?.let { add(it) }
                if (h != null && radiusKm > 0) {
                    add(GridKm(h.e - radiusKm, h.n - radiusKm))
                    add(GridKm(h.e + radiusKm, h.n + radiusKm))
                }
                if (isEmpty()) addAll(vp.map { it.second })
            }
            val bounds = if (pts.isEmpty()) GridBounds(620.0, 2880.0, 640.0, 2900.0) else GridBounds(
                pts.minOf { it.e }, pts.minOf { it.n }, pts.maxOf { it.e }, pts.maxOf { it.n },
            )
            return MapScene(vp, ip, h, radiusKm, ring, bounds)
        }
    }
}

/**
 * Maps grid km to screen pixels for a canvas of [widthPx] x [heightPx]: equal
 * scale on both axes (so the ring stays round), north up, [paddingPx] margin.
 */
class Viewport(bounds: GridBounds, val widthPx: Float, val heightPx: Float, paddingPx: Float = 24f, minSpanKm: Double = 2.0) {
    val pxPerKm: Double
    private val centerE: Double
    private val centerN: Double

    init {
        val spanE = maxOf(bounds.width, minSpanKm)
        val spanN = maxOf(bounds.height, minSpanKm)
        val usableW = maxOf(widthPx - 2 * paddingPx, 1f)
        val usableH = maxOf(heightPx - 2 * paddingPx, 1f)
        pxPerKm = minOf(usableW / spanE, usableH / spanN)
        centerE = (bounds.minE + bounds.maxE) / 2
        centerN = (bounds.minN + bounds.maxN) / 2
    }

    fun x(p: GridKm): Float = (widthPx / 2 + (p.e - centerE) * pxPerKm).toFloat()

    fun y(p: GridKm): Float = (heightPx / 2 - (p.n - centerN) * pxPerKm).toFloat()

    /** Grid km at a screen point. */
    fun toGrid(x: Float, y: Float): GridKm = GridKm(centerE + (x - widthPx / 2) / pxPerKm, centerN - (y - heightPx / 2) / pxPerKm)

    /** A round grid step (0.5, 1, 2, 5, 10... km) giving lines at least [targetPx] apart. */
    fun gridStepKm(targetPx: Float = 80f): Double {
        val raw = targetPx / pxPerKm
        return GRID_STEPS.firstOrNull { it >= raw } ?: GRID_STEPS.last()
    }

    private companion object {
        val GRID_STEPS = listOf(0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0)
    }
}
