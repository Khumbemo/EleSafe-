package org.hatialert.core;

import java.util.List;

/**
 * The seed village list ({@code VILLAGES} in domain.py). Only Wokha Town is
 * checked against a gazetteer (GeoNames); the others came from the original
 * app and are not verified. The server's list (officers can correct and add
 * villages) is the one to use when online; this is the offline fallback.
 */
public final class Villages {
    private Villages() {
    }

    public static final String UNVERIFIED = "Original app, not verified";

    public static final List<Village> SEED = Util.list(
            new Village("Wokha Town", 26.09717, 94.25817, true, "GeoNames gazetteer"),
            new Village("Wozhuro", 26.0912, 94.2434, false, UNVERIFIED),
            new Village("Baghty", 26.0780, 94.2200, false, UNVERIFIED),
            new Village("Sanis", 26.1230, 94.2890, false, UNVERIFIED),
            new Village("Ralan", 26.0650, 94.2750, false, UNVERIFIED),
            new Village("Englan", 26.1450, 94.3100, false, UNVERIFIED),
            new Village("Tening", 26.0500, 94.2100, false, UNVERIFIED),
            new Village("Bhandari", 26.1600, 94.2400, false, UNVERIFIED),
            new Village("Longsa", 26.0300, 94.3200, false, UNVERIFIED),
            new Village("Wosanda", 26.1100, 94.3400, false, UNVERIFIED));

    /** The seed village with this name, or {@code null}. */
    public static Village byName(String name) {
        for (Village v : SEED) {
            if (v.name.equals(name)) {
                return v;
            }
        }
        return null;
    }
}
