package org.hatialert.core;

/** What happened. Keys and labels match {@code INCIDENT_TYPES} in domain.py (same order). */
public enum IncidentType {
    SIGHTING("sighting", "Elephant sighted", "Hati dekha"),
    HERD_MOVEMENT("herd_movement", "Herd moving", "Pal jaache"),
    CROP_RAID("crop_raid", "Crop raid", "Kheti barbad"),
    PROPERTY_DAMAGE("property_damage", "Property damage", "Ghar tuta"),
    INJURY("injury", "Person injured", "Manuh ahata"),
    DEATH("death", "Person killed", "Manuh mara");

    private final String key;
    private final String label;
    private final String local;

    IncidentType(String key, String label, String local) {
        this.key = key;
        this.label = label;
        this.local = local;
    }

    /** API key, e.g. {@code "crop_raid"}. */
    public String key() {
        return key;
    }

    /** English label. */
    public String label() {
        return label;
    }

    /** Nagamese label from the original app. */
    public String local() {
        return local;
    }

    /** True for injury and death: the server always records at least one casualty. */
    public boolean isCasualty() {
        return this == INJURY || this == DEATH;
    }

    /** The type with this API key, or {@code null}. */
    public static IncidentType fromKey(String key) {
        for (IncidentType t : values()) {
            if (t.key.equals(key)) {
                return t;
            }
        }
        return null;
    }
}
