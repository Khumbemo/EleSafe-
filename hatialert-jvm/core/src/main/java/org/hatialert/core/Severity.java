package org.hatialert.core;

/** Severity levels, most severe first, as {@code SEVERITIES} in domain.py. */
public enum Severity {
    CRITICAL("critical", "Critical"),
    HIGH("high", "High"),
    MEDIUM("medium", "Medium"),
    LOW("low", "Low");

    private final String key;
    private final String label;

    Severity(String key, String label) {
        this.key = key;
        this.label = label;
    }

    public String key() {
        return key;
    }

    public String label() {
        return label;
    }

    public static Severity fromKey(String key) {
        for (Severity s : values()) {
            if (s.key.equals(key)) {
                return s;
            }
        }
        return null;
    }

    /**
     * Severity rules carried over unchanged from the original app
     * ({@code classify_severity} in domain.py). {@code kind} is the API key; an
     * unknown key falls through to {@link #LOW}, exactly as in Python.
     */
    public static Severity classify(String kind, int herdSize, int casualties) {
        if (casualties > 0 || "death".equals(kind) || "injury".equals(kind)) {
            return CRITICAL;
        }
        if ("property_damage".equals(kind)) {
            return HIGH;
        }
        if ("crop_raid".equals(kind)) {
            return herdSize >= 5 ? HIGH : MEDIUM;
        }
        if ("herd_movement".equals(kind) && herdSize >= 10) {
            return HIGH;
        }
        if ("sighting".equals(kind) && herdSize >= 5) {
            return MEDIUM;
        }
        return LOW;
    }

    public static Severity classify(IncidentType type, int herdSize, int casualties) {
        return classify(type.key(), herdSize, casualties);
    }
}
