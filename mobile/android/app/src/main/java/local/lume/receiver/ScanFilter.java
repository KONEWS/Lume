package local.lume.receiver;

import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Folder-scan rules; explicit file imports keep their existing behavior. */
final class ScanFilter {
    private final Set<String> blockedFormats = new HashSet<>();

    ScanFilter(Collection<String> formats) {
        for (String value : formats) {
            if (value == null) continue;
            String format = value.trim().replaceFirst("^\\.", "").toLowerCase(Locale.ROOT);
            if (format.matches("[a-z0-9]{1,16}")) blockedFormats.add(format);
        }
    }

    boolean blocksName(String name) {
        if (name == null) return false;
        int dot = name.lastIndexOf('.');
        return dot >= 0 && blockedFormats.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    static boolean isShort(long milliseconds) {
        // Unknown/zero duration is retained. Exactly 60 seconds is retained.
        return milliseconds > 0 && milliseconds < 60000;
    }

    static boolean skipsAudio(boolean skipShort, long milliseconds, String albumTag) {
        String album = albumTag == null ? "" : albumTag.replace("\u0000", "").trim();
        return skipShort && isShort(milliseconds) && (album.isEmpty() || album.equalsIgnoreCase("<unknown>"));
    }
}
