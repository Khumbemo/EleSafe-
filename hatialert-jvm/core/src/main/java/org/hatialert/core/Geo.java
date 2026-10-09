package org.hatialert.core;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * Spherical geography from domain.py: haversine distance, initial bearing,
 * compass points and destination point, on the IUGG mean Earth radius.
 */
public final class Geo {
    private Geo() {
    }

    /** IUGG mean Earth radius, km ({@code EARTH_RADIUS_KM}). */
    public static final double EARTH_RADIUS_KM = 6371.0088;

    /**
     * Compass points used across the app ({@code DIRECTIONS} in domain.py). The
     * Python app uses 8 points (45 degrees each), so this port does too.
     */
    public static final List<String> DIRECTIONS = Util.list("N", "NE", "E", "SE", "S", "SW", "W", "NW");

    /** Great-circle distance in km. */
    public static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dp = p2 - p1;
        double dl = Math.toRadians(lng2 - lng1);
        double sdp = Math.sin(dp / 2);
        double sdl = Math.sin(dl / 2);
        double a = sdp * sdp + Math.cos(p1) * Math.cos(p2) * sdl * sdl;
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }

    /** Initial bearing from point 1 to point 2, degrees clockwise from north in [0, 360). */
    public static double bearingDeg(double lat1, double lng1, double lat2, double lng2) {
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dl = Math.toRadians(lng2 - lng1);
        double y = Math.sin(dl) * Math.cos(p2);
        double x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return pyMod(Math.toDegrees(Math.atan2(y, x)) + 360, 360);
    }

    /** Nearest of the 8 {@link #DIRECTIONS} to a bearing in degrees (any range). */
    public static String compass(double bearing) {
        double b = pyMod(bearing, 360) / 45 + 0.5;
        if (Double.isNaN(b)) {
            // Python's int(nan) raises; do the same rather than answer "N".
            throw new IllegalArgumentException("bearing must be finite: " + bearing);
        }
        return DIRECTIONS.get(((int) b) % 8);
    }

    /** Index of a compass point in {@link #DIRECTIONS}, or -1. */
    public static int directionIndex(String direction) {
        return direction == null ? -1 : DIRECTIONS.indexOf(direction);
    }

    /**
     * Point {@code km} away from (lat, lng) heading {@code direction} (e.g. "NE"),
     * rounded to 5 decimals as the server stores it ({@code destination} in
     * domain.py). Returns the start point unchanged when {@code km <= 0} or the
     * direction is not one of {@link #DIRECTIONS}.
     */
    public static LatLng destination(double lat, double lng, double km, String direction) {
        int idx = directionIndex(direction);
        if (km <= 0 || idx < 0) {
            return new LatLng(lat, lng);
        }
        LatLng p = destinationBearing(lat, lng, km, idx * 45);
        return new LatLng(round(p.lat, 5), round(p.lng, 5));
    }

    /**
     * Point {@code km} away on any bearing in degrees, unrounded. Same formula as
     * {@code destination} in domain.py and app.js (which draws the alert ring with it).
     */
    public static LatLng destinationBearing(double lat, double lng, double km, double bearingDeg) {
        double theta = Math.toRadians(bearingDeg);
        double delta = km / EARTH_RADIUS_KM;
        double p1 = Math.toRadians(lat);
        double l1 = Math.toRadians(lng);
        double p2 = Math.asin(Math.sin(p1) * Math.cos(delta) + Math.cos(p1) * Math.sin(delta) * Math.cos(theta));
        double l2 = l1 + Math.atan2(
                Math.sin(theta) * Math.sin(delta) * Math.cos(p1),
                Math.cos(delta) - Math.sin(p1) * Math.sin(p2));
        return new LatLng(Math.toDegrees(p2), Math.toDegrees(l2));
    }

    /**
     * Python's {@code round(x, ndigits)}: correctly rounded from the exact binary
     * value, ties to even.
     */
    public static double round(double x, int ndigits) {
        if (Double.isNaN(x) || Double.isInfinite(x)) {
            return x;
        }
        return new BigDecimal(x).setScale(ndigits, RoundingMode.HALF_EVEN).doubleValue();
    }

    /** Python's float {@code %}: the result takes the sign of the divisor. */
    static double pyMod(double x, double m) {
        double r = x % m;
        if (r != 0 && (r < 0) != (m < 0)) {
            r += m;
        }
        return r;
    }
}
