package org.hatialert.core;

/** Input limits ({@code LIMITS} in domain.py) and time constants. Ranges are inclusive. */
public final class Limits {
    private Limits() {
    }

    public static final long DAY_MS = 86_400_000L;
    public static final long HOUR_MS = 3_600_000L;

    public static final int HERD_SIZE_MIN = 0;
    public static final int HERD_SIZE_MAX = 200;
    public static final int CASUALTIES_MIN = 0;
    public static final int CASUALTIES_MAX = 50;
    public static final double CROP_ACRES_MIN = 0.0;
    public static final double CROP_ACRES_MAX = 500.0;
    public static final long PROPERTY_INR_MIN = 0;
    public static final long PROPERTY_INR_MAX = 10_000_000L;
    public static final double OFFSET_KM_MIN = 0.0;
    public static final double OFFSET_KM_MAX = 15.0;
    public static final double RADIUS_KM_MIN = 1.0;
    public static final double RADIUS_KM_MAX = 25.0;
    public static final int DESCRIPTION_MAX = 500;
    public static final int MESSAGE_MAX = 400;
    public static final int NAME_MAX = 60;
    /** {@code place} is capped at 120 characters in api.py. */
    public static final int PLACE_MAX = 120;

    /** GPS positions the server accepts on a report (api.py post_incident). */
    public static final double REPORT_LAT_MIN = 25.0;
    public static final double REPORT_LAT_MAX = 27.5;
    public static final double REPORT_LNG_MIN = 93.0;
    public static final double REPORT_LNG_MAX = 95.5;
}
