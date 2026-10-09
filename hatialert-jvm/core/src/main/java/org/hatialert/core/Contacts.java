package org.hatialert.core;

import java.util.List;

/**
 * Emergency numbers ({@code CONTACTS} in domain.py). Entries marked
 * {@code placeholder} came from the original app and are not real
 * forest-department lines; 112, 108 and 100 are the national numbers.
 */
public final class Contacts {
    private Contacts() {
    }

    public static final class Contact {
        public final String name;
        public final String phone;
        public final String role;
        public final boolean placeholder;

        public Contact(String name, String phone, String role, boolean placeholder) {
            this.name = name;
            this.phone = phone;
            this.role = role;
            this.placeholder = placeholder;
        }
    }

    public static final List<Contact> LIST = Util.list(
            new Contact("National emergency", "112", "Police, fire, ambulance", false),
            new Contact("Ambulance", "108", "Emergency medical", false),
            new Contact("Police", "100", "Police control room", false),
            new Contact("Forest control room, Wokha", "+91 94360 00000", "24/7 forest helpline", true),
            new Contact("DFO Wokha", "+91 94360 00001", "Divisional Forest Officer", true),
            new Contact("Range Officer, Baghty", "+91 94360 00002", "Range Forest Officer", true));
}
