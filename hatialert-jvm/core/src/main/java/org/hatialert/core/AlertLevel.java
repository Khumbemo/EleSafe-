package org.hatialert.core;

/** Alert kinds ({@code ALERT_LEVELS} in domain.py). */
public enum AlertLevel {
    WARNING("warning", "Elephant warning"),
    INFO("info", "Information"),
    ALL_CLEAR("all_clear", "All clear");

    private final String key;
    private final String label;

    AlertLevel(String key, String label) {
        this.key = key;
        this.label = label;
    }

    public String key() {
        return key;
    }

    public String label() {
        return label;
    }

    public static AlertLevel fromKey(String key) {
        for (AlertLevel a : values()) {
            if (a.key.equals(key)) {
                return a;
            }
        }
        return null;
    }
}
