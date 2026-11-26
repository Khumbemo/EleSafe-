package org.hatialert.client.app

import kotlin.math.abs
import kotlin.math.hypot
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The offline base map of Wokha district, read from `map/layers.json` as written by
 * hatialert-py/tools/build_map.py (the web map draws the same file, web-ts/src/map.ts):
 * 100 m contours (every 500 m an index contour), streams with their Strahler order,
 * district boundaries and spot heights, all on the UTM zone 46N grid. The shaded
 * relief `map/terrain.webp` covers [terrain] exactly, north up.
 *
 * Coordinates are kept in *map space*, as the web map does: x = easting - e0 and
 * y = n1 - northing, in km, so x grows east and y grows south (screen direction)
 * from the north-west corner of [extent]. Each line is a FloatArray of x, y pairs,
 * ready to become a drawing path once.
 */
class MapLayers(
    /** e0, n0, e1, n1 in grid km. */
    val extent: GridBounds,
    val terrain: GridBounds,
    val terrainResolutionM: Double,
    val contourStep: Int,
    val contours: List<Contour>,
    val streams: List<Stream>,
    val districts: List<District>,
    val peaks: List<Peak>,
    val contourLabels: List<MapLabel>,
    val attribution: List<String>,
) {
    class Contour(val elev: Int, val index: Boolean, val lines: List<FloatArray>)
    class Stream(val order: Int, val line: FloatArray)
    class District(val name: String, val state: String, val rings: List<FloatArray>, val centre: MapPoint) {
        val isWokha get() = name == "Wokha"
    }
    class Peak(val name: String, val elev: Int, val at: MapPoint)

    val frame = MapFrame(extent.minE, extent.maxN, extent.width, extent.height)

    /** Highest stream order present (4 here). */
    val maxStreamOrder: Int get() = streams.maxOfOrNull { it.order } ?: 0

    /** Number of points in all lines; what a frame has to transform. */
    val pointCount: Int
        get() = contours.sumOf { c -> c.lines.sumOf { it.size / 2 } } + streams.sumOf { it.line.size / 2 } +
            districts.sumOf { d -> d.rings.sumOf { it.size / 2 } }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String): MapLayers = from(json.decodeFromString(RawLayers.serializer(), text))

        private fun from(raw: RawLayers): MapLayers {
            require(raw.extent.size == 4) { "layers.json: extent needs 4 numbers" }
            val (e0, n0, e1, n1) = raw.extent
            val frame = MapFrame(e0, n1, e1 - e0, n1 - n0)
            val contours = raw.contours.map { c -> Contour(c.elev, c.index, c.paths.map { unpack(it, frame) }) }
            val streams = raw.streams.map { Stream(it.order, unpack(it.path, frame)) }
            val districts = raw.districts.map { d ->
                val rings = d.rings.map { unpack(it, frame) }
                var sx = 0.0
                var sy = 0.0
                var n = 0
                for (r in rings) {
                    var i = 0
                    while (i < r.size) {
                        sx += r[i]; sy += r[i + 1]; n++; i += 2
                    }
                }
                District(d.name, d.state, rings, if (n == 0) MapPoint(0.0, 0.0) else MapPoint(sx / n, sy / n))
            }
            val peaks = raw.peaks.map { Peak(it.name ?: "", it.elev, frame.toMap(GridKm(it.e, it.n))) }
            val t = raw.terrain.extent.takeIf { it.size == 4 } ?: raw.extent
            return MapLayers(
                extent = GridBounds(e0, n0, e1, n1),
                terrain = GridBounds(t[0], t[1], t[2], t[3]),
                terrainResolutionM = raw.terrain.resolutionM,
                contourStep = raw.contourStep,
                contours = contours,
                streams = streams,
                districts = districts,
                peaks = peaks,
                contourLabels = contourLabels(contours),
                attribution = raw.attribution,
            )
        }

        /**
         * Paths are packed as [x0, y0, dx, dy, ...] in decametres (10 m) of easting and
         * northing (build_map.py `packed`); returns map-space km pairs.
         */
        internal fun unpack(p: IntArray, frame: MapFrame): FloatArray {
            val out = FloatArray(p.size and 1.inv())
            var x = 0L
            var y = 0L
            var i = 0
            while (i + 1 < p.size) {
                x += p[i]
                y += p[i + 1]
                out[i] = (x / 100.0 - frame.e0).toFloat()
                out[i + 1] = (frame.n1 - y / 100.0).toFloat()
                i += 2
            }
            return out
        }

        /**
         * Height labels on index contours (500, 1,000 m...), as the web map places them: the
         * middle point of each line with more than 20 points, at least 6 km from another
         * label of the same height.
         */
        internal fun contourLabels(contours: List<Contour>): List<MapLabel> {
            val out = mutableListOf<MapLabel>()
            for (c in contours) {
                if (!c.index) continue
                for (line in c.lines) {
                    val n = line.size / 2
                    if (n <= 20) continue
                    val mid = n shr 1
                    val p = MapPoint(line[2 * mid].toDouble(), line[2 * mid + 1].toDouble())
                    if (out.none { it.elev == c.elev && hypot(it.at.x - p.x, it.at.y - p.y) < 6 }) {
                        out += MapLabel(metres(c.elev), p, c.elev)
                    }
                }
            }
            return out
        }

        /** "1,991 m", grouped as en-IN does for numbers under a lakh. */
        fun metres(m: Int): String {
            val digits = abs(m).toString()
            val grouped = if (digits.length <= 3) digits else digits.dropLast(3) + "," + digits.takeLast(3)
            return (if (m < 0) "-" else "") + grouped + " m"
        }
    }
}

/** A point in map space (km east and south of the map's north-west corner). */
data class MapPoint(val x: Double, val y: Double)

/** A text placed on the map: contour heights. [elev] for contour labels. */
data class MapLabel(val text: String, val at: MapPoint, val elev: Int = 0)

/**
 * The map's origin and size: x = easting - [e0], y = [n1] - northing, in km. The base
 * map's extent when layers.json is there, else a box around the villages and incidents.
 */
data class MapFrame(val e0: Double, val n1: Double, val width: Double, val height: Double) {
    fun toMap(g: GridKm) = MapPoint(g.e - e0, n1 - g.n)
    fun toGrid(p: MapPoint) = GridKm(e0 + p.x, n1 - p.y)

    companion object {
        /** The web map's fallback without base layers: 15 km around all points. */
        fun around(points: List<GridKm>): MapFrame {
            if (points.isEmpty()) return MapFrame(589.0, 2946.0, 57.0, 86.0)
            val minE = points.minOf { it.e } - 15
            val maxE = points.maxOf { it.e } + 15
            val minN = points.minOf { it.n } - 15
            val maxN = points.maxOf { it.n } + 15
            return MapFrame(minE, maxN, maxE - minE, maxN - minN)
        }
    }
}

@Serializable
private class RawLayers(
    val extent: List<Double>,
    val terrain: RawTerrain,
    @SerialName("contour_step") val contourStep: Int = 100,
    val contours: List<RawContour> = emptyList(),
    val streams: List<RawStream> = emptyList(),
    val districts: List<RawDistrict> = emptyList(),
    val peaks: List<RawPeak> = emptyList(),
    val attribution: List<String> = emptyList(),
)

@Serializable
private class RawTerrain(val href: String = "", val extent: List<Double> = emptyList(), @SerialName("resolution_m") val resolutionM: Double = 0.0)

@Serializable
private class RawContour(val elev: Int, val index: Boolean = false, val paths: List<IntArray> = emptyList())

@Serializable
private class RawStream(val order: Int, val path: IntArray)

@Serializable
private class RawDistrict(val name: String, val state: String = "", val rings: List<IntArray> = emptyList())

@Serializable
private class RawPeak(val name: String? = null, val e: Double, val n: Double, val elev: Int)
