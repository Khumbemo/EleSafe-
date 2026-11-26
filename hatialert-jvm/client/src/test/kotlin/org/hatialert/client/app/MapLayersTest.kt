package org.hatialert.client.app

import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.hatialert.core.Utm
import org.junit.jupiter.api.Assumptions.assumeTrue

/** The base map the Android app draws: its copies of the web map's files, parsed and projected. */
class MapLayersTest {
    private val jvm = File(System.getProperty("hatialert.jvm.dir", "../"))
    private val assets = File(jvm, "android/src/main/assets/map")
    private val layers by lazy { MapLayers.parse(File(assets, "layers.json").readText()) }

    private fun near(expected: Double, actual: Double, tol: Double, what: String) =
        assertTrue(abs(expected - actual) <= tol, "$what: expected $expected, got $actual")

    @Test
    fun layersParse() {
        val l = layers
        assertEquals(GridBounds(589.0, 2860.0, 646.0, 2946.0), l.extent)
        assertEquals(l.extent, l.terrain)
        assertEquals(40.0, l.terrainResolutionM)
        assertEquals(100, l.contourStep)
        assertEquals(20, l.contours.size)
        assertEquals((100..2000 step 100).toList(), l.contours.map { it.elev })
        assertEquals(listOf(500, 1000, 1500, 2000), l.contours.filter { it.index }.map { it.elev })
        assertEquals(503, l.streams.size)
        assertEquals(mapOf(1 to 264, 2 to 134, 3 to 34, 4 to 71), l.streams.groupingBy { it.order }.eachCount().toSortedMap())
        assertEquals(4, l.maxStreamOrder)
        assertEquals(11, l.districts.size)
        assertEquals(1, l.districts.count { it.isWokha })
        assertEquals(46479 + 8535 + 5217, l.pointCount)
        assertEquals(3, l.attribution.size)
        // contours and streams lie on the map; neighbouring districts' boundaries run past its edge
        for (line in l.contours.flatMap { it.lines } + l.streams.map { it.line }) {
            for (i in line.indices step 2) {
                assertTrue(line[i] in -0.1f..57.1f && line[i + 1] in -0.1f..86.1f, "point ${line[i]}, ${line[i + 1]}")
            }
        }
        for (ring in l.districts.first { it.isWokha }.rings) {
            for (i in ring.indices step 2) assertTrue(ring[i] in 0f..57f && ring[i + 1] in 0f..86f, "Wokha ${ring[i]}, ${ring[i + 1]}")
        }
        // labels: index contours only, as the web map
        assertTrue(l.contourLabels.isNotEmpty())
        assertTrue(l.contourLabels.all { it.elev in listOf(500, 1000, 1500, 2000) })
        assertTrue(l.contourLabels.any { it.text == "1,000 m" })
        val wokha = l.districts.first { it.isWokha }
        assertTrue(wokha.centre.x in 10.0..50.0 && wokha.centre.y in 10.0..80.0, "Wokha's label sits inside the map: ${wokha.centre}")
    }

    @Test
    fun unpackDecametreDeltas() {
        val frame = MapFrame(589.0, 2946.0, 57.0, 86.0)
        // build_map.py packs [x0, y0, dx, dy...] in 10 m units of easting and northing
        val pts = MapLayers.unpack(intArrayOf(59774, 286066, 0, -64, 10, 0), frame)
        assertEquals(6, pts.size)
        near(597.74 - 589.0, pts[0].toDouble(), 1e-4, "x0")
        near(2946.0 - 2860.66, pts[1].toDouble(), 1e-4, "y0")
        near(2946.0 - 2860.02, pts[3].toDouble(), 1e-4, "y1")
        near(597.84 - 589.0, pts[4].toDouble(), 1e-4, "x2")
    }

    /** Mount Tiyi: its lat/lng through core's UTM lands on the peak in layers.json and on its pixel of the relief. */
    @Test
    fun knownPointProjects() {
        val tiyi = layers.peaks.single()
        assertEquals("Mount Tiyi", tiyi.name)
        assertEquals(1991, tiyi.elev)
        assertEquals("1,991 m", MapLayers.metres(tiyi.elev))
        val g = gridKm(26.09738, 94.283)
        val viaUtm = layers.frame.toMap(g)
        near(tiyi.at.x, viaUtm.x, 0.06, "x")
        near(tiyi.at.y, viaUtm.y, 0.06, "y")
        near(39.3, tiyi.at.x, 1e-9, "x")
        near(58.9, tiyi.at.y, 1e-9, "y")
        // the relief is 25 px per km (40 m), north-west corner at (0, 0)
        val pxPerKm = 1000.0 / layers.terrainResolutionM
        near(982.5, tiyi.at.x * pxPerKm, 1e-6, "relief column")
        near(1472.5, tiyi.at.y * pxPerKm, 1e-6, "relief row")
        // Wokha Town (UTM checked against PROJ in hatialert-py/tools/check_i18n.cjs)
        val town = Utm.forward(26.09717, 94.25817)
        near(625.817193, town.eastingKm(), 1e-5, "easting")
        val p = layers.frame.toMap(GridKm(town.eastingKm(), town.northingKm()))
        // on a 400 px canvas showing the whole 57 km width
        val view = MapView(0.0, 0.0, 57.0)
        near(p.x * 400 / 57, view.sx(p.x, 400f).toDouble(), 1e-3, "screen x")
        near((2946.0 - 2887.05262) * 400 / 57, view.sy(p.y, 400f).toDouble(), 1e-3, "screen y")
    }

    /** terrain.webp is lossy VP8 without alpha (decodes on every Android version the app supports). */
    @Test
    fun reliefImageMatchesTheExtent() {
        val b = File(assets, "terrain.webp").readBytes()
        assertEquals("RIFF", String(b, 0, 4, Charsets.US_ASCII))
        assertEquals("WEBPVP8 ", String(b, 8, 8, Charsets.US_ASCII), "simple lossy WebP (not VP8L/VP8X)")
        // VP8 key frame: start code 9d 01 2a, then 14-bit width and height
        assertContentEquals(byteArrayOf(0x9d.toByte(), 0x01, 0x2a), b.copyOfRange(23, 26))
        val w = ((b[26].toInt() and 0xff) or ((b[27].toInt() and 0xff) shl 8)) and 0x3fff
        val h = ((b[28].toInt() and 0xff) or ((b[29].toInt() and 0xff) shl 8)) and 0x3fff
        assertEquals(1425 to 2150, w to h)
        assertEquals(w.toDouble(), layers.terrain.width * 1000 / layers.terrainResolutionM, 1e-9)
        assertEquals(h.toDouble(), layers.terrain.height * 1000 / layers.terrainResolutionM, 1e-9)
    }

    /** The app's copies are the web map's files byte for byte (`./gradlew syncMapAssets` updates them). */
    @Test
    fun assetsMatchTheWebMap() {
        val web = File(System.getProperty("hatialert.py.dir", "../../hatialert-py"), "hatialert/web/map")
        assumeTrue(web.isDirectory, "hatialert-py not found at $web")
        for (name in listOf("layers.json", "terrain.webp")) {
            assertTrue(
                File(web, name).readBytes().contentEquals(File(assets, name).readBytes()),
                "android/src/main/assets/map/$name differs from hatialert-py: run `./gradlew syncMapAssets`",
            )
        }
    }

    @Test
    fun fitClampZoomAndPan() {
        val frame = layers.frame
        val w = 400f
        val h = 300f
        // a 5 km ring around Wokha Town: at least 8 km wide, 13 km (10 + 3) tall
        val town = frame.toMap(gridKm(26.09717, 94.25817))
        val pts = listOf(MapPoint(town.x - 5, town.y - 5), MapPoint(town.x + 5, town.y + 5))
        val v = MapView.fit(pts, frame, w, h)
        near(13.0 / 0.75, v.w, 1e-9, "width")
        near(town.x, v.x + v.w / 2, 1e-9, "centre x")
        near(town.y, v.y + v.heightKm(w, h) / 2, 1e-9, "centre y")
        assertFalse(v.isFar)
        assertTrue(v.showsContourLabels)

        // zooming keeps the point under the fingers in place
        val before = v.toMap(100f, 80f, w)
        val z = v.zoomAt(0.5, 100f, 80f, frame, w, h)
        near(v.w / 2, z.w, 1e-9, "zoomed width")
        val after = z.toMap(100f, 80f, w)
        near(before.x, after.x, 1e-6, "x under finger")
        near(before.y, after.y, 1e-6, "y under finger")
        // no closer than 1.5 km across, no further out than the whole map
        assertEquals(MapView.MIN_W, v.zoomAt(0.001, 200f, 150f, frame, w, h).w)
        val all = v.zoomAt(100.0, 200f, 150f, frame, w, h)
        near(maxOf(frame.width, frame.height / 0.75) * 1.02, all.w, 1e-9, "whole map")
        assertTrue(all.isFar)
        assertFalse(all.showsContourLabels)
        // panning moves by finger distance and stops near the edge
        val p = v.panBy(40f, -20f, frame, w, h)
        near(v.x - 40 * v.w / w, p.x, 1e-9, "pan x")
        near(v.y + 20 * v.w / w, p.y, 1e-9, "pan y")
        val edge = v.panBy(1e6f, 0f, frame, w, h)
        near(-v.w * 0.1, edge.x, 1e-9, "west edge")
    }

    @Test
    fun gridAndScaleBar() {
        val frame = layers.frame
        val v = MapView(10.0, 20.0, 15.0) // 599-614 km E
        assertEquals(2, v.gridStepKm())
        assertEquals(listOf(600, 602, 604, 606, 608, 610, 612, 614), v.gridEastings(frame).toList())
        val n = v.gridNorthings(frame, 300f, 300f) // 2911-2926 km N
        assertEquals(2912, n.first)
        assertEquals(2926, n.last)
        assertEquals(1, MapView(0.0, 0.0, 6.0).gridStepKm())
        assertEquals(20, MapView(0.0, 0.0, 90.0).gridStepKm())
        assertEquals(0.5 to "500 m", MapView.scaleBar(0.005)) // 90 px = 450 m
        assertEquals(2.0 to "2 km", MapView.scaleBar(0.03)) // 90 px = 2.7 km
        assertEquals(50.0 to "50 km", MapView.scaleBar(10.0))
    }

    @Test
    fun labelsDeclutter() {
        val placer = LabelPlacer()
        placer.block(0f, 0f, 10f, 10f) // a marker
        assertFalse(placer.place(5f, 5f, 40f, 15f), "on the marker")
        assertTrue(placer.place(10f, 0f, 40f, 12f), "touching by a pixel is fine")
        assertFalse(placer.place(20f, 5f, 60f, 15f), "on the first label")
        assertTrue(placer.place(20f, 5f, 60f, 15f, always = true), "the home village always shows")
        repeat(200) { placer.block(100f + it, 100f, 101f + it, 101f) } // grows
        assertTrue(placer.overlapsAny(150f, 90f, 160f, 110f))
        placer.reset()
        assertTrue(placer.place(5f, 5f, 40f, 15f))
    }

    @Test
    fun frameWithoutLayers() {
        val f = MapFrame.around(listOf(GridKm(620.0, 2880.0), GridKm(630.0, 2890.0)))
        assertEquals(MapFrame(605.0, 2905.0, 40.0, 40.0), f)
        assertEquals(MapPoint(15.0, 15.0), f.toMap(GridKm(620.0, 2890.0)))
        assertEquals(GridKm(620.0, 2890.0), f.toGrid(MapPoint(15.0, 15.0)))
    }
}
