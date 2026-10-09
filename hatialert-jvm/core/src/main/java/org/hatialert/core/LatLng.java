package org.hatialert.core;

/** A WGS 84 position in degrees. Immutable. */
public final class LatLng {
    public final double lat;
    public final double lng;

    public LatLng(double lat, double lng) {
        this.lat = lat;
        this.lng = lng;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof LatLng)) {
            return false;
        }
        LatLng other = (LatLng) o;
        return Double.compare(lat, other.lat) == 0 && Double.compare(lng, other.lng) == 0;
    }

    @Override
    public int hashCode() {
        return 31 * Double.hashCode(lat) + Double.hashCode(lng);
    }

    @Override
    public String toString() {
        return "LatLng(" + lat + ", " + lng + ")";
    }
}
