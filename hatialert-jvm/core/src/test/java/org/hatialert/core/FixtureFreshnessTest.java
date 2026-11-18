package org.hatialert.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/**
 * Re-runs tools/gen_python_vectors.py against hatialert-py and checks the
 * committed fixture is still what the Python code produces. Skipped when no
 * Python 3.10+ is available.
 *
 * <p>The comparison is structural: keys, text, whole numbers and list lengths
 * must match exactly; decimals within a relative 1e-12. Python's math module
 * uses the platform's libm, whose sin/cos/atan2 may differ in the last bit
 * between OS releases, which would change the printed digits without any
 * change to the code.
 */
class FixtureFreshnessTest {

    static String python() {
        String env = System.getenv("HATIALERT_PYTHON");
        for (String exe : env != null ? new String[] {env} : new String[] {"python3", "python"}) {
            try {
                Process p = new ProcessBuilder(exe, "-c", "import sys; print(sys.version_info >= (3, 10))")
                        .redirectErrorStream(true).start();
                String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
                if (p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0 && out.equals("True")) {
                    return exe;
                }
            } catch (IOException e) {
                // try the next name
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return null;
    }

    @Test
    void fixtureMatchesCurrentPythonCode() throws Exception {
        String py = python();
        assumeTrue(py != null, "Python 3.10+ not found; skipping fixture freshness check");
        File jvm = new File(System.getProperty("hatialert.jvm.dir", ".."));
        File pyDir = new File(System.getProperty("hatialert.py.dir", "../../hatialert-py"));
        assumeTrue(new File(pyDir, "hatialert/domain.py").isFile(), "hatialert-py not found at " + pyDir);
        File script = new File(jvm, "tools/gen_python_vectors.py");
        File out = File.createTempFile("python-vectors", ".json");
        out.deleteOnExit();
        Process p = new ProcessBuilder(py, script.getAbsolutePath(), "--py-dir", pyDir.getAbsolutePath())
                .redirectOutput(out).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        assertEquals(true, p.waitFor(120, TimeUnit.SECONDS), "generator timed out");
        assertEquals(0, p.exitValue(), "generator failed");
        String fresh = Files.readString(out.toPath(), StandardCharsets.UTF_8);
        String committed;
        try (InputStream in = getClass().getResourceAsStream("/python-vectors.json")) {
            committed = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        List<String> diffs = new ArrayList<>();
        compare("$", MiniJson.parse(committed), MiniJson.parse(fresh), diffs);
        assertEquals(List.of(), diffs,
                "python-vectors.json is stale (first differences shown): run "
                        + "`python3 tools/gen_python_vectors.py > core/src/test/resources/python-vectors.json`");
    }

    static final double REL_TOL = 1e-12;

    /** Records up to 10 differences between the committed (a) and freshly generated (b) values. */
    static void compare(String path, Object a, Object b, List<String> diffs) {
        if (diffs.size() >= 10) {
            return;
        }
        if (a instanceof Map<?, ?> ma && b instanceof Map<?, ?> mb) {
            if (!ma.keySet().equals(mb.keySet())) {
                diffs.add(path + ": keys " + ma.keySet() + " vs " + mb.keySet());
                return;
            }
            for (Object k : ma.keySet()) {
                compare(path + "." + k, ma.get(k), mb.get(k), diffs);
            }
        } else if (a instanceof List<?> la && b instanceof List<?> lb) {
            if (la.size() != lb.size()) {
                diffs.add(path + ": length " + la.size() + " vs " + lb.size());
                return;
            }
            for (int i = 0; i < la.size(); i++) {
                compare(path + "[" + i + "]", la.get(i), lb.get(i), diffs);
            }
        } else if (a instanceof Double da && b instanceof Double db) {
            double scale = Math.max(1.0, Math.max(Math.abs(da), Math.abs(db)));
            if (!(Math.abs(da - db) <= REL_TOL * scale)) {
                diffs.add(path + ": " + da + " vs " + db);
            }
        } else if (!Objects.equals(a, b)) {
            diffs.add(path + ": " + a + " vs " + b);
        }
    }
}
