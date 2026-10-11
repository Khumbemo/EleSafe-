package org.hatialert.core;

/** A village point. {@code verified} is true only for positions checked against a named source. */
public final class Village {
    public final String name;
    public final double lat;
    public final double lng;
    public final boolean verified;
    public final String source;

    public Village(String name, double lat, double lng, boolean verified, String source) {
        this.name = name;
        this.lat = lat;
        this.lng = lng;
        this.verified = verified;
        this.source = source;
    }

    public LatLng position() {
        return new LatLng(lat, lng);
    }

    @Override
    public String toString() {
        return "Village(" + name + ", " + lat + ", " + lng + (verified ? ", verified" : "") + ")";
    }
}
