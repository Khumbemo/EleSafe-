package org.hatialert.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Case status and workflow: {@code STATUSES}, {@code STATUS_LABELS},
 * {@code OPEN_STATUSES}, {@code TRANSITIONS} and {@code TRANSITION_ROLES} in domain.py.
 */
public enum Status {
    REPORTED("reported", "Reported", true),
    VERIFIED("verified", "Verified", true),
    RESPONDED("responded", "Team responded", true),
    RESOLVED("resolved", "Resolved", false),
    FALSE_REPORT("false_report", "False report", false);

    private final String key;
    private final String label;
    private final boolean open;

    Status(String key, String label, boolean open) {
        this.key = key;
        this.label = label;
        this.open = open;
    }

    public String key() {
        return key;
    }

    public String label() {
        return label;
    }

    /** Reported, verified and responded cases are open. */
    public boolean isOpen() {
        return open;
    }

    public static Status fromKey(String key) {
        for (Status s : values()) {
            if (s.key.equals(key)) {
                return s;
            }
        }
        return null;
    }

    /** Which status may follow this one, in the server's order. */
    public List<Status> transitions() {
        switch (this) {
            case REPORTED:
                return Util.list(VERIFIED, FALSE_REPORT);
            case VERIFIED:
                return Util.list(RESPONDED, FALSE_REPORT);
            case RESPONDED:
                return Util.list(RESOLVED);
            default:
                return Collections.emptyList();
        }
    }

    /** Roles allowed to move a case <em>into</em> this status (empty for {@link #REPORTED}). */
    public List<Role> rolesAllowed() {
        switch (this) {
            case VERIFIED:
            case RESPONDED:
            case FALSE_REPORT:
                return Util.list(Role.GUARD, Role.OFFICER);
            case RESOLVED:
                return Util.list(Role.OFFICER);
            default:
                return Collections.emptyList();
        }
    }

    /** Whether {@code role} may move a case from this status to {@code target}. */
    public boolean canMoveTo(Status target, Role role) {
        return role != null && transitions().contains(target) && target.rolesAllowed().contains(role);
    }

    /** The moves {@code role} may make from here: the {@code next} list of an incident detail. */
    public List<Status> nextFor(Role role) {
        List<Status> out = new ArrayList<>();
        for (Status s : transitions()) {
            if (role != null && s.rolesAllowed().contains(role)) {
                out.add(s);
            }
        }
        return Collections.unmodifiableList(out);
    }
}
