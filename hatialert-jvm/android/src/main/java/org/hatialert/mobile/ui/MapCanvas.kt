package org.hatialert.mobile.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import org.hatialert.client.app.GridKm
import org.hatialert.client.app.MapScene
import org.hatialert.client.app.Viewport
import org.hatialert.client.app.fmtKm

/**
 * A plain native map: UTM zone 46N km grid, villages, open incidents coloured
 * by severity, and the geodesic alert ring around the user's village. The
 * projection and fitting live in :client (MapScene, Viewport). Tap an incident to open it.
 */
@Composable
fun MapCanvas(scene: MapScene, onIncident: (Long) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val padPx = with(density) { 28.dp.toPx() }
    val labelStyle = remember(p) { TextStyle(color = argb(p.ink), fontSize = 11.sp) }
    val gridStyle = remember(p) { TextStyle(color = argb(p.muted), fontSize = 9.sp) }
    val homeStyle = remember(p) { TextStyle(color = argb(p.accent), fontSize = 11.sp, fontWeight = FontWeight.Bold) }

    Canvas(
        modifier
            .clipToBounds()
            .pointerInput(scene) {
                detectTapGestures { tap ->
                    val vp = Viewport(scene.bounds, size.width.toFloat(), size.height.toFloat(), padPx)
                    val hit = scene.incidents
                        .map { (inc, g) -> inc to hypot(vp.x(g) - tap.x, vp.y(g) - tap.y) }
                        .filter { it.second < 28.dp.toPx() }
                        .minByOrNull { it.second }
                    hit?.let { onIncident(it.first.id) }
                }
            },
    ) {
        val vp = Viewport(scene.bounds, size.width, size.height, padPx)
        drawRect(argb(p.land))

        // Grid every 1, 2, 5... km, labelled in km like the web map.
        val step = vp.gridStepKm(64.dp.toPx())
        val topLeft = vp.toGrid(0f, 0f)
        val bottomRight = vp.toGrid(size.width, size.height)
        val gridColor = argb(p.line)
        var e = ceil(topLeft.e / step) * step
        while (e <= bottomRight.e) {
            val x = vp.x(GridKm(e, topLeft.n))
            drawLine(gridColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
            label(measurer, fmtGrid(e), Offset(x + 2f, 2f), gridStyle)
            e += step
        }
        var n = floor(bottomRight.n / step) * step
        while (n <= topLeft.n) {
            val y = vp.y(GridKm(topLeft.e, n))
            drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
            label(measurer, fmtGrid(n), Offset(2f, y + 1f), gridStyle)
            n += step
        }

        // Alert ring
        if (scene.ring.size > 2) {
            val ring = Path().apply {
                moveTo(vp.x(scene.ring[0]), vp.y(scene.ring[0]))
                for (pt in scene.ring.drop(1)) lineTo(vp.x(pt), vp.y(pt))
                close()
            }
            drawPath(ring, argb(p.accent).copy(alpha = 0.10f))
            drawPath(ring, argb(p.accent), style = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 8f))))
        }

        // Villages: filled when the position is verified, hollow and dashed when not.
        val r = 4.dp.toPx()
        for ((v, g) in scene.villages) {
            val c = Offset(vp.x(g), vp.y(g))
            if (v.verified) {
                drawCircle(argb(p.ink), r, c)
            } else {
                drawCircle(argb(p.surface), r, c)
                drawCircle(argb(p.ink), r, c, style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 3f))))
            }
            label(measurer, v.name, c + Offset(r + 3f, -r - 10f), if (scene.home == g) homeStyle else labelStyle)
        }
        scene.home?.let { h ->
            val c = Offset(vp.x(h), vp.y(h))
            drawCircle(argb(p.accent), 7.dp.toPx(), c, style = Stroke(2.dp.toPx()))
        }

        // Incidents, most severe drawn last (on top).
        val order = listOf("low", "medium", "high", "critical")
        for ((inc, g) in scene.incidents.sortedBy { order.indexOf(it.first.severity) }) {
            val c = Offset(vp.x(g), vp.y(g))
            drawCircle(Color.White, 8.dp.toPx(), c)
            drawCircle(argb(p.severity(inc.severity)), 6.dp.toPx(), c)
        }

        // Scale bar
        val barKm = step
        val barPx = (barKm * vp.pxPerKm).toFloat()
        val y = size.height - 10.dp.toPx()
        val x0 = size.width - barPx - 10.dp.toPx()
        drawLine(argb(p.ink), Offset(x0, y), Offset(x0 + barPx, y), strokeWidth = 2.dp.toPx())
        label(measurer, "${fmtGrid(barKm)} km", Offset(x0, y - 16.dp.toPx()), gridStyle)
    }
}

private fun fmtGrid(km: Double): String = if (km == floor(km)) km.toLong().toString() else fmtKm(km)

/** Text at [at]; skipped when it would start outside the canvas. */
private fun DrawScope.label(measurer: androidx.compose.ui.text.TextMeasurer, text: String, at: Offset, style: TextStyle) {
    if (at.x < 0f || at.y < 0f || at.x >= size.width || at.y >= size.height) return
    drawText(measurer.measure(text, style), topLeft = at)
}
