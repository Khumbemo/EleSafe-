package org.hatialert.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The same vectors as hatialert-py/tests/test_hatialert.py (SeverityTests, GeoTests, UtmTests, ...). */
class DomainTest {

    @Test
    void severityRulesMatchOriginalApp() {
        Object[][] cases = {
            {"sighting", 1, 0, "low"}, {"sighting", 5, 0, "medium"},
            {"herd_movement", 9, 0, "low"}, {"herd_movement", 10, 0, "high"},
            {"crop_raid", 4, 0, "medium"}, {"crop_raid", 5, 0, "high"},
            {"property_damage", 1, 0, "high"}, {"injury", 1, 0, "critical"},
            {"death", 1, 0, "critical"}, {"sighting", 1, 2, "critical"},
        };
        for (Object[] c : cases) {
            assertEquals(c[3], Severity.classify((String) c[0], (Integer) c[1], (Integer) c[2]).key(), Arrays.toString(c));
            assertEquals(c[3], Severity.classify(IncidentType.fromKey((String) c[0]), (Integer) c[1], (Integer) c[2]).key());
        }
    }

    @Test
    void haversineOneDegreeLatitude() {
        assertEquals(111.19, Geo.haversineKm(26, 94, 27, 94), 0.05);
    }

    @Test
    void destinationRoundTrip() {
        for (String d : Geo.DIRECTIONS) {
            LatLng p = Geo.destination(26.1, 94.26, 3.0, d);
            assertEquals(3.0, Geo.haversineKm(26.1, 94.26, p.lat, p.lng), 0.01, d);
            assertEquals(d, Geo.compass(Geo.bearingDeg(26.1, 94.26, p.lat, p.lng)));
        }
    }

    @Test
    void destinationIgnoresZeroDistanceAndUnknownDirection() {
        assertEquals(new LatLng(26.1, 94.26), Geo.destination(26.1, 94.26, 0, "N"));
        assertEquals(new LatLng(26.1, 94.26), Geo.destination(26.1, 94.26, 2, "UP"));
        assertEquals(new LatLng(26.1, 94.26), Geo.destination(26.1, 94.26, 2, null));
    }

    @Test
    void compassBoundaries() {
        assertEquals("N", Geo.compass(22.4));
        assertEquals("NE", Geo.compass(22.6));
        assertEquals("N", Geo.compass(359));
        assertEquals("NW", Geo.compass(-45));
        assertThrows(IllegalArgumentException.class, () -> Geo.compass(Double.NaN));
    }

    @Test
    void pythonRoundIsHalfEvenOnExactValue() {
        // Values as Python prints them: 0.123455 is stored just below the tie, 1.000005 just above.
        assertEquals(0.12345, Geo.round(0.123455, 5));
        assertEquals(1.00001, Geo.round(1.000005, 5));
        assertEquals(2.67, Geo.round(2.675, 2));
        assertEquals(2.0, Geo.round(2.5, 0));
        assertEquals(4.0, Geo.round(3.5, 0));
    }

    @Test
    void referenceUsesIst() {
        // 2026-09-30 19:00 UTC is already October in IST
        assertEquals("HA-2610-0007", Ist.reference(7, 1_790_794_800_000L));
        assertEquals("2026-10-01", Ist.date(1_790_794_800_000L));
        assertEquals("2026-10-01 00:30", Ist.stamp(1_790_794_800_000L));
    }

    // Reference values from PROJ (pyproj, EPSG:4326 -> EPSG:32646), as UtmTests.REF.
    private static final double[][] PROJ = {
        {26.09717, 94.25817, 625817.193, 2887052.620},
        {25.9208, 93.9549, 595630.908, 2867261.356},
        {26.5595, 94.3908, 638530.297, 2938399.207},
    };

    @Test
    void utmForwardMatchesProj() {
        for (double[] r : PROJ) {
            Utm.Point p = Utm.forward(r[0], r[1]);
            assertEquals(r[2], p.easting, 0.01);
            assertEquals(r[3], p.northing, 0.01);
        }
    }

    @Test
    void utmInverseRoundTrip() {
        for (double[] r : PROJ) {
            Utm.Point p = Utm.forward(r[0], r[1]);
            LatLng back = Utm.inverse(p.easting, p.northing);
            assertEquals(r[0], back.lat, 1e-8);
            assertEquals(r[1], back.lng, 1e-8);
        }
    }

    @Test
    void onlyCheckedVillagesMarkedVerified() {
        List<String> verified = new ArrayList<>();
        for (Village v : Villages.SEED) {
            if (v.verified) {
                verified.add(v.name);
            }
        }
        assertEquals(List.of("Wokha Town"), verified);
        assertEquals("GeoNames gazetteer", Villages.byName("Wokha Town").source);
        assertEquals(Villages.UNVERIFIED, Villages.byName("Wozhuro").source);
        assertNull(Villages.byName("Paris"));
    }

    @Test
    void statusWorkflowAndPermissions() {
        // test_status_workflow_and_permissions, at the domain level
        assertFalse(Status.REPORTED.canMoveTo(Status.VERIFIED, Role.VILLAGER));
        assertFalse(Status.REPORTED.canMoveTo(Status.RESOLVED, Role.GUARD)); // 409 on the server
        assertTrue(Status.REPORTED.canMoveTo(Status.VERIFIED, Role.GUARD));
        assertEquals(List.of(Status.RESPONDED, Status.FALSE_REPORT), Status.VERIFIED.nextFor(Role.GUARD));
        assertFalse(Status.RESPONDED.canMoveTo(Status.RESOLVED, Role.GUARD)); // 403 on the server
        assertTrue(Status.RESPONDED.canMoveTo(Status.RESOLVED, Role.OFFICER));
        assertEquals(List.of(), Status.RESPONDED.nextFor(Role.GUARD));
        assertEquals(List.of(), Status.RESOLVED.nextFor(Role.OFFICER));
        assertEquals(List.of(), Status.REPORTED.nextFor(Role.VILLAGER));
        assertTrue(Status.RESPONDED.isOpen());
        assertFalse(Status.FALSE_REPORT.isOpen());
        assertTrue(Role.GUARD.isStaff());
        assertFalse(Role.VILLAGER.isStaff());
    }

    @Test
    void mediaSniffingAndLimits() {
        byte[] jpeg = new byte[64];
        jpeg[0] = (byte) 0xFF;
        jpeg[1] = (byte) 0xD8;
        jpeg[2] = (byte) 0xFF;
        jpeg[3] = (byte) 0xE0;
        byte[] webm = new byte[64];
        webm[0] = 0x1A;
        webm[1] = 0x45;
        webm[2] = (byte) 0xDF;
        webm[3] = (byte) 0xA3;
        assertEquals("image/jpeg", MediaKind.sniff(jpeg));
        assertEquals("audio/webm", MediaKind.sniff(webm));
        assertNull(MediaKind.sniff("<html><script>alert(1)</script></html>".getBytes(StandardCharsets.US_ASCII)));
        assertTrue(MediaKind.PHOTO.mimes().contains(MediaKind.sniff(jpeg)));
        assertFalse(MediaKind.VOICE.mimes().contains(MediaKind.sniff(jpeg)));
        assertEquals(1_500_000, MediaKind.PHOTO.maxBytes());
        assertEquals(2, MediaKind.VOICE.maxCount());
        assertEquals(6, MediaKind.PHOTO.maxCount());
        assertNull(MediaKind.fromKey("video"));
    }

    @Test
    void lookupsByKey() {
        for (IncidentType t : IncidentType.values()) {
            assertEquals(t, IncidentType.fromKey(t.key()));
        }
        assertNull(IncidentType.fromKey("party"));
        assertTrue(IncidentType.INJURY.isCasualty());
        assertEquals(Status.FALSE_REPORT, Status.fromKey("false_report"));
        assertEquals(AlertLevel.ALL_CLEAR, AlertLevel.fromKey("all_clear"));
        assertEquals(Severity.HIGH, Severity.fromKey("high"));
        assertEquals(Role.OFFICER, Role.fromKey("officer"));
    }

    @Test
    void alertRingClosesOnItself() {
        // 73 points every 5 degrees, as app.js draws the alert ring
        Village home = Villages.SEED.get(0);
        LatLng first = Geo.destinationBearing(home.lat, home.lng, 5, 0);
        LatLng last = Geo.destinationBearing(home.lat, home.lng, 5, 360);
        assertEquals(first.lat, last.lat, 1e-12);
        assertEquals(first.lng, last.lng, 1e-12);
        for (int k = 0; k <= 72; k++) {
            LatLng p = Geo.destinationBearing(home.lat, home.lng, 5, k * 5);
            assertEquals(5.0, Geo.haversineKm(home.lat, home.lng, p.lat, p.lng), 1e-9);
        }
    }
}
