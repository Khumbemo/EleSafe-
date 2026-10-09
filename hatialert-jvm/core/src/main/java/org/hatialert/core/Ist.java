package org.hatialert.core;

import java.util.Locale;

/**
 * Indian Standard Time formatting and report numbers. Nagaland keeps IST
 * (UTC+05:30, no daylight saving), so this is plain arithmetic: java.time is
 * avoided because it needs API 26 (or desugaring) on Android.
 */
public final class Ist {
    private Ist() {
    }

    /** IST offset from UTC in milliseconds. */
    public static final long OFFSET_MS = (5 * 60 + 30) * 60_000L;

    /** Broken-down IST wall-clock time. */
    public static final class Civil {
        public final int year;
        public final int month;
        public final int day;
        public final int hour;
        public final int minute;
        public final int second;

        Civil(int year, int month, int day, int hour, int minute, int second) {
            this.year = year;
            this.month = month;
            this.day = day;
            this.hour = hour;
            this.minute = minute;
            this.second = second;
        }
    }

    /** IST calendar fields for a Unix time in milliseconds. */
    public static Civil civil(long epochMs) {
        long local = epochMs + OFFSET_MS;
        long days = Math.floorDiv(local, Limits.DAY_MS);
        long msOfDay = Math.floorMod(local, Limits.DAY_MS);
        // Howard Hinnant's civil_from_days.
        long z = days + 719_468;
        long era = Math.floorDiv(z, 146_097);
        long doe = z - era * 146_097;
        long yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        long mp = (5 * doy + 2) / 153;
        int d = (int) (doy - (153 * mp + 2) / 5 + 1);
        int m = (int) (mp < 10 ? mp + 3 : mp - 9);
        int y = (int) (yoe + era * 400 + (m <= 2 ? 1 : 0));
        int secs = (int) (msOfDay / 1000);
        return new Civil(y, m, d, secs / 3600, secs / 60 % 60, secs % 60);
    }

    /** {@code ist_date}: "YYYY-MM-DD". */
    public static String date(long epochMs) {
        Civil c = civil(epochMs);
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.year, c.month, c.day);
    }

    /** {@code ist_stamp}: "YYYY-MM-DD HH:MM". */
    public static String stamp(long epochMs) {
        Civil c = civil(epochMs);
        return String.format(Locale.ROOT, "%04d-%02d-%02d %02d:%02d", c.year, c.month, c.day, c.hour, c.minute);
    }

    /**
     * Report number villagers quote on compensation claims, e.g. {@code HA-2610-0007}:
     * IST year and month of the report, then the incident id ({@code reference} in domain.py).
     */
    public static String reference(long incidentId, long createdMs) {
        Civil c = civil(createdMs);
        return String.format(Locale.ROOT, "HA-%02d%02d-%04d", Math.floorMod(c.year, 100), c.month, incidentId);
    }
}
