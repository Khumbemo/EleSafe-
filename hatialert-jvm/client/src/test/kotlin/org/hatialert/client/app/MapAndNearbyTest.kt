package org.hatialert.client.app

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import org.hatialert.client.Incident
import org.hatialert.client.Village
import org.hatialert.core.Geo
import org.hatialert.core.Villages

class MapAndNearbyTest {
    private val villages = Villages.SEED.map { Village(0, it.name, it.lat, it.lng, it.verified, it.source) }
    private val json = Json { ignoreUnknownKeys = true }
    private fun incident(id: Long, lat: Double, lng: Double, status: String = "reported", created: Long = 1_000L) =
        json.decodeFromString(Incident.serializer(), org.hatialert.client.Json.incident(id, status, lat, lng, created))

    @Test
    fun nearbyMatchesServerRules() {
        val home = villages.first { it.name == "Wozhuro" }
        val near = Geo.destination(home.lat, home.lng, 2.0, "E")
        val nearer = Geo.destination(home.lat, home.lng, 0.5, "N")
        val far = Geo.destination(home.lat, home.lng, 8.0, "S")
        val list = nearbyIncidents(
            home, 5.0,
            listOf(
                incident(1, near.lat, near.lng, created = 5),
                incident(2, nearer.lat, nearer.lng),
                incident(3, far.lat, far.lng),
                incident(4, nearer.lat, nearer.lng, status = "resolved"),
                incident(5, near.lat, near.lng, created = 9),
            ),
        )
        assertEquals(listOf(2L, 5L, 1L), list.map { it.incident.id }) // nearest first, then newest
        assertEquals(0.5, list[0].km)
        assertEquals("N", list[0].dir)
        assertEquals("E", list[1].dir)
        assertEquals(2.0, list[1].km)
    }

    @Test
    fun ringIsAGeodesicCircleOnTheGrid() {
        val home = villages.first()
        val scene = MapScene.build(villages, emptyList(), home, 5.0)
        assertEquals(73, scene.ring.size)
        assertEquals(scene.ring.first().e, scene.ring.last().e, 1e-9)
        val h = scene.home!!
        for (p in scene.ring) {
            // 5 km on the sphere (as domain.py and app.js) is within 1% of 5 km on the
            // ellipsoidal UTM grid: sphere-vs-ellipsoid radius (~0.4%) and grid scale (~0.02%).
            assertTrue(abs(hypot(p.e - h.e, p.n - h.n) - 5.0) < 0.05, "$p")
        }
        assertEquals(h.e - 5.0, scene.bounds.minE, 1e-9)
        assertEquals(h.n + 5.0, scene.bounds.maxN, 1e-9)
        assertEquals(625.817193, h.e, 1e-5) // PROJ: Wokha Town 625817.193 E
    }

    @Test
    fun viewportKeepsScaleSquareAndNorthUp() {
        val b = GridBounds(620.0, 2880.0, 630.0, 2890.0)
        val vp = Viewport(b, widthPx = 1000f, heightPx = 500f, paddingPx = 0f)
        assertEquals(50.0, vp.pxPerKm, 1e-9) // limited by height: 500 px / 10 km
        assertEquals(500f, vp.x(GridKm(625.0, 2885.0)), 1e-3f)
        assertTrue(vp.y(GridKm(625.0, 2889.0)) < vp.y(GridKm(625.0, 2881.0)))
        val back = vp.toGrid(vp.x(GridKm(621.0, 2882.0)), vp.y(GridKm(621.0, 2882.0)))
        assertEquals(621.0, back.e, 1e-4)
        assertEquals(2882.0, back.n, 1e-4)
        assertEquals(2.0, vp.gridStepKm(80f))
    }

    @Test
    fun themesMatchTheWebPalettes() {
        assertEquals(0xFF1D5A42, ThemeChoice.GREEN.palette(systemDark = false).accent)
        assertEquals(0xFF7CC6A0, ThemeChoice.GREEN.palette(systemDark = true).accent)
        assertEquals(0xFF0A1630, ThemeChoice.NAVY.palette(false).bg)
        assertTrue(ThemeChoice.DARK.palette(false).isDark)
        assertEquals(ThemeChoice.GREEN, ThemeChoice.fromName("nonsense"))
        assertEquals(ThemeChoice.WHITE, ThemeChoice.fromName("WHITE"))
    }
}
