package org.hatialert.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class Util {
    private Util() {
    }

    /** Immutable list; {@code List.of} is Java 9+ and missing on older Android. */
    @SafeVarargs
    static <T> List<T> list(T... items) {
        List<T> out = new ArrayList<>(items.length);
        for (T item : items) {
            out.add(item);
        }
        return Collections.unmodifiableList(out);
    }
}
