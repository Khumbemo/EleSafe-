package org.hatialert.core;

/** Account roles ({@code ROLES} in domain.py). Guards and officers are forest staff. */
public enum Role {
    VILLAGER("villager"),
    GUARD("guard"),
    OFFICER("officer");

    private final String key;

    Role(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }

    /** {@code STAFF} in domain.py. */
    public boolean isStaff() {
        return this == GUARD || this == OFFICER;
    }

    public static Role fromKey(String key) {
        for (Role r : values()) {
            if (r.key.equals(key)) {
                return r;
            }
        }
        return null;
    }
}
