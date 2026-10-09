package org.hatialert.core;

import java.util.List;

/** Photos and voice notes ({@code MEDIA} in domain.py). */
public enum MediaKind {
    PHOTO("photo", Util.list("image/jpeg", "image/png", "image/webp"), 1_500_000, 6),
    VOICE("voice", Util.list("audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"), 2_000_000, 2);

    /** {@code VOICE_MAX_SECONDS}. */
    public static final int VOICE_MAX_SECONDS = 60;

    private final String key;
    private final List<String> mimes;
    private final int maxBytes;
    private final int maxCount;

    MediaKind(String key, List<String> mimes, int maxBytes, int maxCount) {
        this.key = key;
        this.mimes = mimes;
        this.maxBytes = maxBytes;
        this.maxCount = maxCount;
    }

    public String key() {
        return key;
    }

    public List<String> mimes() {
        return mimes;
    }

    /** Largest decoded file the server takes. */
    public int maxBytes() {
        return maxBytes;
    }

    /** Most files of this kind on one report. */
    public int maxCount() {
        return maxCount;
    }

    public static MediaKind fromKey(String key) {
        for (MediaKind m : values()) {
            if (m.key.equals(key)) {
                return m;
            }
        }
        return null;
    }

    /**
     * Media type from a file's leading bytes (16 are enough), or {@code null}:
     * {@code sniff_media} in domain.py. The server ignores the name or type a
     * phone reports, so clients can use this to refuse a file before uploading.
     */
    public static String sniff(byte[] head) {
        if (startsWith(head, 0, 0xFF, 0xD8, 0xFF)) {
            return "image/jpeg";
        }
        if (startsWith(head, 0, 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n')) {
            return "image/png";
        }
        boolean riff = startsWith(head, 0, 'R', 'I', 'F', 'F');
        if (riff && startsWith(head, 8, 'W', 'E', 'B', 'P')) {
            return "image/webp";
        }
        if (riff && startsWith(head, 8, 'W', 'A', 'V', 'E')) {
            return "audio/wav";
        }
        if (startsWith(head, 0, 0x1A, 0x45, 0xDF, 0xA3)) {
            return "audio/webm";
        }
        if (startsWith(head, 0, 'O', 'g', 'g', 'S')) {
            return "audio/ogg";
        }
        if (startsWith(head, 4, 'f', 't', 'y', 'p')) {
            return "audio/mp4";
        }
        if (startsWith(head, 0, 'I', 'D', '3')) {
            return "audio/mpeg";
        }
        if (head.length > 1 && (head[0] & 0xFF) == 0xFF) {
            int b = head[1] & 0xFF;
            if (b == 0xFB || b == 0xF3 || b == 0xF2 || b == 0xFA) {
                return "audio/mpeg";
            }
        }
        return null;
    }

    private static boolean startsWith(byte[] data, int offset, int... expected) {
        if (data == null || data.length < offset + expected.length) {
            return false;
        }
        for (int i = 0; i < expected.length; i++) {
            if ((data[offset + i] & 0xFF) != expected[i]) {
                return false;
            }
        }
        return true;
    }
}
