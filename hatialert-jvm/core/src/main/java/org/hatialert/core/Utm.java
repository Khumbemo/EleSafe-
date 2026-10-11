package org.hatialert.core;

/**
 * WGS 84 to and from UTM zone 46N (EPSG:32646), the grid the map uses. Krüger
 * series to third order in n (Karney 2011), a line-by-line port of geo.py with
 * the same constants; accurate to well under a millimetre inside the zone.
 */
public final class Utm {
    private Utm() {
    }

    public static final double A_WGS84 = 6378137.0;
    public static final double F_WGS84 = 1 / 298.257223563;
    public static final double K0 = 0.9996;
    /** Zone 46 central meridian, degrees. */
    public static final double LON0 = 93.0;
    public static final double E0 = 500_000.0;
    public static final double N0 = 0.0;

    static final double N = F_WGS84 / (2 - F_WGS84);
    /** Rectifying radius. */
    public static final double A = A_WGS84 / (1 + N) * (1 + Math.pow(N, 2) / 4 + Math.pow(N, 4) / 64);
    static final double[] ALPHA = {
        N / 2 - 2 * Math.pow(N, 2) / 3 + 5 * Math.pow(N, 3) / 16,
        13 * Math.pow(N, 2) / 48 - 3 * Math.pow(N, 3) / 5,
        61 * Math.pow(N, 3) / 240,
    };
    static final double[] BETA = {
        N / 2 - 2 * Math.pow(N, 2) / 3 + 37 * Math.pow(N, 3) / 96,
        Math.pow(N, 2) / 48 + Math.pow(N, 3) / 15,
        17 * Math.pow(N, 3) / 480,
    };
    static final double[] DELTA = {
        2 * N - 2 * Math.pow(N, 2) / 3 - 2 * Math.pow(N, 3),
        7 * Math.pow(N, 2) / 3 - 8 * Math.pow(N, 3) / 5,
        56 * Math.pow(N, 3) / 15,
    };
    private static final double C = 2 * Math.sqrt(N) / (1 + N);

    /** Easting and northing in metres. */
    public static final class Point {
        public final double easting;
        public final double northing;

        public Point(double easting, double northing) {
            this.easting = easting;
            this.northing = northing;
        }

        /** Easting in km, as the map grid is labelled. */
        public double eastingKm() {
            return easting / 1000;
        }

        /** Northing in km. */
        public double northingKm() {
            return northing / 1000;
        }

        @Override
        public String toString() {
            return "Utm.Point(" + easting + ", " + northing + ")";
        }
    }

    /** {@code utm(lat, lon)}: (easting, northing) in metres. */
    public static Point forward(double lat, double lon) {
        double phi = Math.toRadians(lat);
        double dl = Math.toRadians(lon - LON0);
        double t = Math.sinh(atanh(Math.sin(phi)) - C * atanh(C * Math.sin(phi)));
        double xi = Math.atan2(t, Math.cos(dl));
        double eta = atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
        double se = 0;
        double sn = 0;
        for (int j = 1; j <= 3; j++) {
            double a = ALPHA[j - 1];
            se += a * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
            sn += a * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        }
        double e = eta + se;
        double n = xi + sn;
        return new Point(E0 + K0 * A * e, N0 + K0 * A * n);
    }

    public static Point forward(LatLng p) {
        return forward(p.lat, p.lng);
    }

    /** {@code utm_inverse(easting, northing)}: (lat, lon) in degrees. */
    public static LatLng inverse(double easting, double northing) {
        double xi = (northing - N0) / (K0 * A);
        double eta = (easting - E0) / (K0 * A);
        double sxi = 0;
        double seta = 0;
        for (int j = 1; j <= 3; j++) {
            double b = BETA[j - 1];
            sxi += b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
            seta += b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
        }
        double xi2 = xi - sxi;
        double eta2 = eta - seta;
        double chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
        double sphi = 0;
        for (int j = 1; j <= 3; j++) {
            sphi += DELTA[j - 1] * Math.sin(2 * j * chi);
        }
        double phi = chi + sphi;
        return new LatLng(Math.toDegrees(phi), LON0 + Math.toDegrees(Math.atan2(Math.sinh(eta2), Math.cos(xi2))));
    }

    /** Inverse hyperbolic tangent (java.lang.Math has none). */
    static double atanh(double x) {
        return 0.5 * Math.log1p(2 * x / (1 - x));
    }
}
