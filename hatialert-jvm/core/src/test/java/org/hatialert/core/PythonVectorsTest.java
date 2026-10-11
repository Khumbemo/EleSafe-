package org.hatialert.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Cross-check against numbers produced by the reference Python code
 * (tools/gen_python_vectors.py, output committed as python-vectors.json).
 */
class PythonVectorsTest {
    /** UTM metres: the task asks for 1e-6 m; observed differences are around 1e-9 m. */
    static final double UTM_M = 1e-6;
    /** Degrees for the inverse: 1e-11 degrees is about a micrometre. */
    static final double DEG = 1e-11;

    static Map<String, Object> v;

    @BeforeAll
    @SuppressWarnings("unchecked")
    static void load() throws IOException {
        try (InputStream in = PythonVectorsTest.class.getResourceAsStream("/python-vectors.json")) {
            v = (Map<String, Object>) MiniJson.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    @SuppressWarnings("unchecked")
    static List<List<Object>> rows(String key) {
        return (List<List<Object>>) v.get(key);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) {
        return (Map<String, Object>) o;
    }

    @SuppressWarnings("unchecked")
    static List<Object> list(Object o) {
        return (List<Object>) o;
    }

    static double d(Object o) {
        return ((Number) o).doubleValue();
    }

    static int i(Object o) {
        return ((Number) o).intValue();
    }

    static void relative(double want, double got, double tol, String what) {
        assertEquals(want, got, Math.abs(want) * tol, what);
    }

    @Test
    void constants() {
        Map<String, Object> c = map(v.get("constants"));
        assertEquals(d(c.get("earth_radius_km")), Geo.EARTH_RADIUS_KM, 0.0);
        relative(d(c.get("utm_A")), Utm.A, 1e-15, "A");
        for (int j = 0; j < 3; j++) {
            relative(d(list(c.get("utm_alpha")).get(j)), Utm.ALPHA[j], 1e-14, "alpha" + j);
            relative(d(list(c.get("utm_beta")).get(j)), Utm.BETA[j], 1e-14, "beta" + j);
            relative(d(list(c.get("utm_delta")).get(j)), Utm.DELTA[j], 1e-14, "delta" + j);
        }
    }

    @Test
    void severityExact() {
        List<List<Object>> r = rows("severity");
        assertEquals(168, r.size());
        for (List<Object> row : r) {
            assertEquals(row.get(3), Severity.classify((String) row.get(0), i(row.get(1)), i(row.get(2))).key(), row.toString());
        }
    }

    @Test
    void compassExact() {
        for (List<Object> row : rows("compass")) {
            assertEquals(row.get(1), Geo.compass(d(row.get(0))), row.toString());
        }
    }

    @Test
    void distanceBearingAndCompass() {
        List<List<Object>> r = rows("pairs");
        assertEquals(225, r.size());
        for (List<Object> row : r) {
            double la1 = d(row.get(0)), lo1 = d(row.get(1)), la2 = d(row.get(2)), lo2 = d(row.get(3));
            assertEquals(d(row.get(4)), Geo.haversineKm(la1, lo1, la2, lo2), 1e-9, row.toString());
            double b = Geo.bearingDeg(la1, lo1, la2, lo2);
            assertEquals(d(row.get(5)), b, 1e-9, row.toString());
            assertEquals(row.get(6), Geo.compass(b), row.toString());
        }
    }

    @Test
    void destinationRoundedExactly() {
        List<List<Object>> r = rows("destination");
        assertEquals(600, r.size());
        for (List<Object> row : r) {
            LatLng p = Geo.destination(d(row.get(0)), d(row.get(1)), d(row.get(2)), (String) row.get(3));
            // Both sides round to 5 decimals from (nearly) the same double: expect the same value.
            assertEquals(d(row.get(4)), p.lat, 1e-12, row.toString());
            assertEquals(d(row.get(5)), p.lng, 1e-12, row.toString());
        }
    }

    @Test
    void destinationOnAnyBearing() {
        for (List<Object> row : rows("destination_bearing")) {
            LatLng p = Geo.destinationBearing(d(row.get(0)), d(row.get(1)), d(row.get(2)), d(row.get(3)));
            assertEquals(d(row.get(4)), p.lat, 1e-12, row.toString());
            assertEquals(d(row.get(5)), p.lng, 1e-12, row.toString());
        }
    }

    @Test
    void utmForward() {
        List<List<Object>> r = rows("utm_forward");
        assertTrue(r.size() >= 60);
        for (List<Object> row : r) {
            Utm.Point p = Utm.forward(d(row.get(0)), d(row.get(1)));
            assertEquals(d(row.get(2)), p.easting, UTM_M, row.toString());
            assertEquals(d(row.get(3)), p.northing, UTM_M, row.toString());
        }
    }

    @Test
    void utmInverse() {
        for (List<Object> row : rows("utm_inverse")) {
            LatLng p = Utm.inverse(d(row.get(0)), d(row.get(1)));
            assertEquals(d(row.get(2)), p.lat, DEG, row.toString());
            assertEquals(d(row.get(3)), p.lng, DEG, row.toString());
        }
    }

    @Test
    void istDatesAndReferencesExact() {
        for (List<Object> row : rows("ist")) {
            long ms = ((Number) row.get(0)).longValue();
            assertEquals(row.get(1), Ist.date(ms), row.toString());
            assertEquals(row.get(2), Ist.stamp(ms), row.toString());
        }
        for (List<Object> row : rows("reference")) {
            assertEquals(row.get(2), Ist.reference(((Number) row.get(0)).longValue(), ((Number) row.get(1)).longValue()), row.toString());
        }
    }

    @Test
    void mediaSniffExact() {
        for (List<Object> row : rows("sniff")) {
            assertEquals(row.get(1), MediaKind.sniff(HexFormat.of().parseHex((String) row.get(0))), row.toString());
        }
    }

    @Test
    void metaMatchesEnumsAndLists() {
        Map<String, Object> m = map(v.get("meta"));

        List<Object> types = list(m.get("types"));
        assertEquals(IncidentType.values().length, types.size());
        for (int k = 0; k < types.size(); k++) {
            Map<String, Object> t = map(types.get(k));
            IncidentType it = IncidentType.values()[k];
            assertEquals(t.get("key"), it.key());
            assertEquals(t.get("label"), it.label());
            assertEquals(t.get("local"), it.local());
        }

        List<Object> sev = list(m.get("severities"));
        assertEquals(Severity.values().length, sev.size());
        for (int k = 0; k < sev.size(); k++) {
            assertEquals(map(sev.get(k)).get("key"), Severity.values()[k].key());
            assertEquals(map(sev.get(k)).get("label"), Severity.values()[k].label());
        }

        List<Object> st = list(m.get("statuses"));
        assertEquals(Status.values().length, st.size());
        for (int k = 0; k < st.size(); k++) {
            Map<String, Object> s = map(st.get(k));
            Status status = Status.values()[k];
            assertEquals(s.get("key"), status.key());
            assertEquals(s.get("label"), status.label());
            assertEquals(s.get("open"), status.isOpen());
        }

        Map<String, Object> tr = map(m.get("transitions"));
        for (Status s : Status.values()) {
            assertEquals(tr.get(s.key()), keys(s.transitions()), s.key());
        }
        Map<String, Object> roles = map(m.get("transition_roles"));
        for (Status s : Status.values()) {
            Object want = roles.get(s.key());
            assertEquals(want == null ? List.of() : want, roleKeys(s.rolesAllowed()), s.key());
        }

        List<Object> levels = list(m.get("alert_levels"));
        assertEquals(AlertLevel.values().length, levels.size());
        for (int k = 0; k < levels.size(); k++) {
            assertEquals(map(levels.get(k)).get("key"), AlertLevel.values()[k].key());
            assertEquals(map(levels.get(k)).get("label"), AlertLevel.values()[k].label());
        }

        assertEquals(m.get("directions"), Geo.DIRECTIONS);
        List<String> roleNames = new ArrayList<>();
        List<String> staff = new ArrayList<>();
        for (Role r : Role.values()) {
            roleNames.add(r.key());
            if (r.isStaff()) {
                staff.add(r.key());
            }
        }
        assertEquals(m.get("roles"), roleNames);
        assertEquals(m.get("staff"), staff);

        Map<String, Object> lim = map(m.get("limits"));
        assertRange(lim.get("herd_size"), Limits.HERD_SIZE_MIN, Limits.HERD_SIZE_MAX);
        assertRange(lim.get("casualties"), Limits.CASUALTIES_MIN, Limits.CASUALTIES_MAX);
        assertRange(lim.get("crop_acres"), Limits.CROP_ACRES_MIN, Limits.CROP_ACRES_MAX);
        assertRange(lim.get("property_inr"), Limits.PROPERTY_INR_MIN, Limits.PROPERTY_INR_MAX);
        assertRange(lim.get("offset_km"), Limits.OFFSET_KM_MIN, Limits.OFFSET_KM_MAX);
        assertRange(lim.get("radius_km"), Limits.RADIUS_KM_MIN, Limits.RADIUS_KM_MAX);
        assertEquals(Limits.DESCRIPTION_MAX, i(lim.get("description")));
        assertEquals(Limits.MESSAGE_MAX, i(lim.get("message")));
        assertEquals(Limits.NAME_MAX, i(lim.get("name")));
        assertEquals(9, lim.size(), "a new limit appeared in domain.py");

        Map<String, Object> media = map(m.get("media"));
        assertEquals(MediaKind.VOICE_MAX_SECONDS, i(media.get("voice_max_seconds")));
        for (MediaKind k : MediaKind.values()) {
            Map<String, Object> rule = map(media.get(k.key()));
            assertEquals(rule.get("mimes"), k.mimes());
            assertEquals(k.maxBytes(), i(rule.get("max_bytes")));
            assertEquals(k.maxCount(), i(rule.get("max_count")));
        }

        List<Object> villages = list(m.get("villages"));
        assertEquals(Villages.SEED.size(), villages.size());
        for (int k = 0; k < villages.size(); k++) {
            Map<String, Object> pv = map(villages.get(k));
            Village jv = Villages.SEED.get(k);
            assertEquals(pv.get("name"), jv.name);
            assertEquals(d(pv.get("lat")), jv.lat, 0.0);
            assertEquals(d(pv.get("lng")), jv.lng, 0.0);
            assertEquals(pv.get("verified"), jv.verified);
            assertEquals(pv.get("source"), jv.source);
        }

        List<Object> contacts = list(m.get("contacts"));
        assertEquals(Contacts.LIST.size(), contacts.size());
        for (int k = 0; k < contacts.size(); k++) {
            Map<String, Object> pc = map(contacts.get(k));
            Contacts.Contact jc = Contacts.LIST.get(k);
            assertEquals(pc.get("name"), jc.name);
            assertEquals(pc.get("phone"), jc.phone);
            assertEquals(pc.get("role"), jc.role);
            assertEquals(pc.get("placeholder"), jc.placeholder);
        }
    }

    private static void assertRange(Object pair, double lo, double hi) {
        List<Object> p = list(pair);
        assertEquals(lo, d(p.get(0)), 0.0);
        assertEquals(hi, d(p.get(1)), 0.0);
    }

    private static List<String> keys(List<Status> s) {
        List<String> out = new ArrayList<>();
        for (Status x : s) {
            out.add(x.key());
        }
        return out;
    }

    private static List<String> roleKeys(List<Role> s) {
        List<String> out = new ArrayList<>();
        for (Role x : s) {
            out.add(x.key());
        }
        return out;
    }
}
