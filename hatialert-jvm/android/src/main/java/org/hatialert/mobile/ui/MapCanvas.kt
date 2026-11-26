package org.hatialert.mobile.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.IOException
import kotlin.math.hypot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.hatialert.client.app.GridKm
import org.hatialert.client.app.LabelPlacer
import org.hatialert.client.app.MapFrame
import org.hatialert.client.app.MapLayers
import org.hatialert.client.app.MapScene
import org.hatialert.client.app.MapView
import org.hatialert.client.app.Palette

/**
 * The offline topographic map, drawn from the same files as the web map (assets/map, copied
 * from hatialert-py by `./gradlew syncMapAssets`): SRTM hillshade, 100 m contours (every 500 m
 * darker), streams by Strahler order, district boundaries and Mount Tiyi, under the UTM zone
 * 46N km grid, villages (hollow when the position is not verified), open incidents by severity
 * and the alert ring. Pinch or use the buttons to zoom, drag to pan, tap an incident to open it.
 * Parsing, projection, zoom limits and label placement live in :client (MapLayers, MapView).
 */
@Composable
fun MapCanvas(scene: MapScene, onIncident: (Long) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val context = LocalContext.current
    val measurer = rememberTextMeasurer()
    val base by produceState<BaseMap?>(BaseMap.cached) {
        if (value == null) value = withContext(Dispatchers.Default) { BaseMap.load(context.applicationContext) }
    }
    // Before the base map is read (a fraction of a second, once per app run) the scene is
    // drawn on its own frame, so pins show at once.
    val frame = base?.layers?.frame ?: MapFrame.around(sceneGrid(scene))
    var size by remember { mutableStateOf(IntSize.Zero) }
    var view by remember(scene, frame) { mutableStateOf<MapView?>(null) }
    val w = size.width.toFloat()
    val h = size.height.toFloat()
    if (view == null && size.width > 0 && size.height > 0) {
        view = MapView.fit(MapView.fitPoints(scene, frame), frame, w, h)
    }
    val styles = remember(p) { MapStyles(p) }
    val placer = remember { LabelPlacer() }
    val mapLabel = tr("Map of villages and open incidents")

    Box(modifier.clipToBounds()) {
        Canvas(
            Modifier
                .fillMaxSize()
                .onSizeChanged { size = it }
                .semantics { contentDescription = mapLabel }
                .pointerInput(frame, size) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        val v = view ?: return@detectTransformGestures
                        view = v.zoomAt(1.0 / zoom, centroid.x, centroid.y, frame, w, h).panBy(pan.x, pan.y, frame, w, h)
                    }
                }
                .pointerInput(scene, frame, size) {
                    detectTapGestures { tap ->
                        val v = view ?: return@detectTapGestures
                        val hit = scene.incidents
                            .map { (inc, g) -> inc to frame.toMap(g).let { m -> hypot(v.sx(m.x, w) - tap.x, v.sy(m.y, w) - tap.y) } }
                            .filter { it.second < 28.dp.toPx() }
                            .minByOrNull { it.second }
                        hit?.let { onIncident(it.first.id) }
                    }
                },
        ) {
            val v = view ?: return@Canvas
            drawRect(argb(p.land))
            base?.let { drawBase(it, v, styles) }
            drawScene(scene, v, frame, base?.layers, styles, measurer, placer)
        }
        Column(
            Modifier.align(Alignment.TopEnd).padding(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            MapButton("+", tr("Zoom in")) { view = view?.zoomAt(0.5, w / 2, h / 2, frame, w, h) }
            MapButton("−", tr("Zoom out")) { view = view?.zoomAt(2.0, w / 2, h / 2, frame, w, h) }
            MapButton("⤢", tr("Fit to area")) { view = MapView.fit(MapView.fitPoints(scene, frame), frame, w, h) }
        }
    }
}

@Composable
private fun MapButton(text: String, description: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = argb(p.surface),
        contentColor = argb(p.ink),
        shadowElevation = 2.dp,
        modifier = Modifier.size(44.dp).semantics { contentDescription = description },
    ) {
        Box(contentAlignment = Alignment.Center) { Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
    }
}

private fun sceneGrid(scene: MapScene): List<GridKm> =
    scene.villages.map { it.second } + scene.incidents.map { it.second } + listOfNotNull(scene.home)

/** The base map read once per app run: layers (~400 KB of JSON) as map-space paths, and the hillshade. */
class BaseMap private constructor(val layers: MapLayers, val terrain: ImageBitmap?) {
    val contours = Path()
    val indexContours = Path()
    val streams: Array<Path> = Array(maxOf(layers.maxStreamOrder, 1)) { Path() }
    val districts = Path()
    val wokha = Path()

    /** Where the hillshade image sits, in map space (km from the map's top-left corner): left, top, right, bottom. */
    val terrainBox: FloatArray = layers.terrain.let { t ->
        val f = layers.frame
        floatArrayOf((t.minE - f.e0).toFloat(), (f.n1 - t.maxN).toFloat(), (t.maxE - f.e0).toFloat(), (f.n1 - t.minN).toFloat())
    }

    init {
        for (c in layers.contours) for (line in c.lines) addLine(if (c.index) indexContours else contours, line, close = false)
        for (st in layers.streams) addLine(streams[(st.order - 1).coerceIn(0, streams.size - 1)], st.line, close = false)
        for (d in layers.districts) for (ring in d.rings) addLine(if (d.isWokha) wokha else districts, ring, close = true)
    }

    private fun addLine(path: Path, xy: FloatArray, close: Boolean) {
        if (xy.size < 4) return
        path.moveTo(xy[0], xy[1])
        var i = 2
        while (i + 1 < xy.size) {
            path.lineTo(xy[i], xy[i + 1])
            i += 2
        }
        if (close) path.close()
    }

    companion object {
        @Volatile
        var cached: BaseMap? = null
            private set

        fun load(context: Context): BaseMap? = synchronized(this) {
            cached?.let { return it }
            val layers = try {
                context.assets.open("map/layers.json").use { MapLayers.parse(it.readBytes().toString(Charsets.UTF_8)) }
            } catch (e: IOException) {
                return null
            } catch (e: RuntimeException) { // a damaged file: draw the plain map instead
                return null
            }
            val terrain: Bitmap? = try {
                context.assets.open("map/terrain.webp").use { BitmapFactory.decodeStream(it) }
            } catch (e: IOException) {
                null
            }
            BaseMap(layers, terrain?.asImageBitmap()).also { cached = it }
        }
    }
}

/** Colours and text styles for one palette (made once, not per frame). */
private class MapStyles(val palette: Palette) {
    private val p = palette
    val ink = argb(p.ink)
    val muted = argb(p.muted)
    val accent = argb(p.accent)
    val surface = argb(p.surface)
    val water = argb(p.water)
    // The web map blends the hillshade with soft-light; overlay is the closest mode here.
    val shadeAlpha = if (p.isDark) 0.6f else 0.85f
    val contour = ink.copy(alpha = 0.16f)
    val indexContour = ink.copy(alpha = 0.32f)
    val label = TextStyle(color = ink, fontSize = 11.sp, fontWeight = FontWeight.Medium)
    val home = TextStyle(color = accent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    val small = TextStyle(color = muted, fontSize = 9.sp)
    val contourLabel = TextStyle(color = ink.copy(alpha = 0.55f), fontSize = 9.sp)
}

/** Hillshade, contours, streams and district lines. Paths are in map space (km) under one transform. */
private fun DrawScope.drawBase(base: BaseMap, v: MapView, s: MapStyles) {
    val w = size.width
    val k = v.pxPerKm(w).toFloat()
    base.terrain?.let { img ->
        // In screen pixels, so the image edges stay sharp at every zoom.
        val b = base.terrainBox
        val left = v.sx(b[0].toDouble(), w)
        val top = v.sy(b[1].toDouble(), w)
        val right = v.sx(b[2].toDouble(), w)
        val bottom = v.sy(b[3].toDouble(), w)
        drawImage(
            img,
            dstOffset = IntOffset(left.toInt(), top.toInt()),
            dstSize = IntSize((right - left).toInt().coerceAtLeast(1), (bottom - top).toInt().coerceAtLeast(1)),
            alpha = s.shadeAlpha,
            blendMode = BlendMode.Overlay,
        )
    }
    // Line widths are in screen pixels: divided by the scale inside the transform.
    val px = 1.dp.toPx() / k
    withTransform({
        scale(k, k, pivot = Offset.Zero)
        translate(-v.x.toFloat(), -v.y.toFloat())
    }) {
        drawPath(base.contours, s.contour, style = Stroke(width = 0.6f * px))
        drawPath(base.indexContours, s.indexContour, style = Stroke(width = 1.1f * px))
        for ((i, path) in base.streams.withIndex()) {
            val order = i + 1
            val width = when (order) { 1 -> 0.7f; 2 -> 1.1f; 3 -> 1.8f; else -> 2.8f }
            val alpha = if (order == 1) (if (v.isFar) 0.35f else 0.75f) else 1f
            drawPath(path, s.water.copy(alpha = alpha), style = Stroke(width = width * px, cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
        }
        drawPath(base.districts, s.muted, style = Stroke(width = 1f * px, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f * px, 4f * px))))
        drawPath(base.wokha, s.ink, style = Stroke(width = 2.2f * px))
    }
}

/** The grid, alert ring, villages, incidents, peak, labels and scale bar, in screen space. */
private fun DrawScope.drawScene(
    scene: MapScene, v: MapView, frame: MapFrame, layers: MapLayers?, s: MapStyles,
    measurer: TextMeasurer, placer: LabelPlacer,
) {
    val w = size.width
    val h = size.height
    fun sx(g: GridKm) = frame.toMap(g).let { v.sx(it.x, w) }
    fun sy(g: GridKm) = frame.toMap(g).let { v.sy(it.y, w) }

    // UTM km grid, labelled like the web map (e.g. 625E, 2890N).
    val gridColor = s.ink.copy(alpha = 0.14f)
    for (e in v.gridEastings(frame)) {
        val x = v.sx(e - frame.e0, w)
        drawLine(gridColor, Offset(x, 0f), Offset(x, h), strokeWidth = 1f)
        text(measurer, "${e}E", Offset(x + 2f, 2f), s.small)
    }
    for (n in v.gridNorthings(frame, w, h)) {
        val y = v.sy(frame.n1 - n, w)
        drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1f)
        text(measurer, "${n}N", Offset(2f, y + 1f), s.small)
    }

    // Alert ring (geodesic circle around the person's village).
    if (scene.ring.size > 2) {
        val ring = Path().apply {
            moveTo(sx(scene.ring[0]), sy(scene.ring[0]))
            for (pt in scene.ring.drop(1)) lineTo(sx(pt), sy(pt))
            close()
        }
        drawPath(ring, s.accent.copy(alpha = 0.10f))
        drawPath(ring, s.accent, style = Stroke(width = 1.6.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 8f))))
    }

    // Markers first, so labels can be kept off them.
    placer.reset()
    val r = 4.dp.toPx()
    val pin = 7.dp.toPx()
    for ((_, g) in scene.villages) placer.block(sx(g) - r, sy(g) - r, sx(g) + r, sy(g) + r)
    for ((_, g) in scene.incidents) placer.block(sx(g) - pin, sy(g) - pin, sx(g) + pin, sy(g) + pin)

    for ((vil, g) in scene.villages) {
        val c = Offset(sx(g), sy(g))
        if (vil.verified) {
            drawCircle(s.surface, r, c)
            drawCircle(s.ink, r, c, style = Stroke(1.5.dp.toPx()))
        } else {
            drawCircle(s.surface, r, c)
            drawCircle(s.ink, r, c, style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3f, 3f))))
        }
    }
    scene.home?.let { drawCircle(s.accent, 7.dp.toPx(), Offset(sx(it), sy(it)), style = Stroke(2.dp.toPx())) }

    // Incidents, most severe on top.
    val order = listOf("low", "medium", "high", "critical")
    for ((inc, g) in scene.incidents.sortedBy { order.indexOf(it.first.severity) }) {
        val c = Offset(sx(g), sy(g))
        drawCircle(Color.White, pin + 1.5.dp.toPx(), c)
        drawCircle(argb(s.palette.severity(inc.severity)), pin, c)
    }

    // Mount Tiyi and other peaks.
    layers?.peaks?.forEach { pk ->
        val x = v.sx(pk.at.x, w)
        val y = v.sy(pk.at.y, w)
        if (x < 0 || y < 0 || x > w || y > h) return@forEach
        val t = 5.dp.toPx()
        drawPath(Path().apply { moveTo(x, y - t); lineTo(x + t, y + t * 0.7f); lineTo(x - t, y + t * 0.7f); close() }, s.ink)
        placed(measurer, placer, pk.name, x - 20.dp.toPx(), y + t + 2f, s.label, always = false)
    }

    // Labels, most important first: home village, other villages, contour heights.
    val homeVillage = scene.villages.firstOrNull { it.second == scene.home }
    homeVillage?.let { (vil, g) -> placed(measurer, placer, vil.name, sx(g) + r + 3f, sy(g) - r - 8f, s.home, always = true) }
    for ((vil, g) in scene.villages) {
        if (vil == homeVillage?.first || v.isFar && !vil.verified) continue
        placed(measurer, placer, vil.name, sx(g) + r + 3f, sy(g) - r - 8f, s.label, always = false)
    }
    if (layers != null && v.showsContourLabels) {
        for (lab in layers.contourLabels) placed(measurer, placer, lab.text, v.sx(lab.at.x, w), v.sy(lab.at.y, w), s.contourLabel, always = false)
    }

    // Scale bar, bottom left.
    val (km, label) = MapView.scaleBar(v.w / w)
    val barPx = (km * v.pxPerKm(w)).toFloat()
    val y = h - 12.dp.toPx()
    val x0 = 10.dp.toPx()
    drawLine(s.ink, Offset(x0, y), Offset(x0 + barPx, y), strokeWidth = 2.dp.toPx())
    drawLine(s.ink, Offset(x0, y - 4.dp.toPx()), Offset(x0, y), strokeWidth = 2.dp.toPx())
    drawLine(s.ink, Offset(x0 + barPx, y - 4.dp.toPx()), Offset(x0 + barPx, y), strokeWidth = 2.dp.toPx())
    text(measurer, label, Offset(x0, y - 18.dp.toPx()), s.label)
}

/** Draws a label at its top-left if it fits and doesn't cover a marker or a label placed before it. */
private fun DrawScope.placed(measurer: TextMeasurer, placer: LabelPlacer, text: String, x: Float, y: Float, style: TextStyle, always: Boolean) {
    if (text.isBlank()) return
    val m = measurer.measure(text, style)
    if (x < 0f || y < 0f || x + m.size.width > size.width || y + m.size.height > size.height) return
    if (placer.place(x, y, x + m.size.width, y + m.size.height, always)) drawText(m, topLeft = Offset(x, y))
}

/** Text at [at]; skipped when it would start outside the canvas. */
private fun DrawScope.text(measurer: TextMeasurer, text: String, at: Offset, style: TextStyle) {
    if (at.x < 0f || at.y < 0f || at.x >= size.width || at.y >= size.height) return
    drawText(measurer.measure(text, style), topLeft = at)
}
