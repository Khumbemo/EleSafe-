package org.hatialert.client.app

import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue
import org.hatialert.client.PythonServerIntegrationTest
import org.junit.jupiter.api.Assumptions.assumeTrue

class TranslatorTest {
    private val nag = Translator.nagamese

    @Test
    fun exactPhrasesFromTheWebTable() {
        assertEquals("Ghor", nag.tr("Home"))
        assertEquals("Case khan", nag.tr("Cases"))
        assertEquals("Login koribi", nag.tr("Sign in"))
        assertEquals("Kheti barbad", nag.tr("Crop raid"))
        assertEquals("Report hoise", nag.tr("Reported"))
        assertEquals("Hati sabdhan", nag.tr("Elephant warning"))
        assertEquals("Duita PIN eke nohoi.", nag.tr("The two PINs don't match."))
        // the server's own messages are in the table too
        assertEquals("Phone number aru PIN mila nai.", nag.tr("That phone number and PIN don't match."))
    }

    @Test
    fun patternsFillInTheCapturedParts() {
        assertEquals("Hati sabdhan · Wozhuro", nag.tr("Elephant warning · Wozhuro"))
        assertEquals("Wokha Town pora SW phale 2.3 km", nag.tr("2.3 km SW of Wokha Town"))
        assertEquals("Apuni usor te 3 ta khula ghotona ase", nag.tr("3 open incidents near you"))
        assertEquals("Apuni usor te 1 ta khula ghotona ase", nag.tr("1 open incident near you"))
        assertEquals("Wozhuro laga alert moike SMS dibi", nag.tr("Text me alerts for Wozhuro"))
        assertEquals("Alert pathai dise. 4 jon manu ke SMS jai ase", nag.tr("Alert sent. Texting 4 people"))
        // a captured part is translated when it is a phrase itself
        assertEquals("Pathai dise: 1", nag.tr("Sent: 1"))
        assertEquals("Rong: Navy blue", nag.tr("Theme: Navy blue"))
        assertEquals("6 ta hati", nag.tr("6 elephants"))
    }

    @Test
    fun spacesAreKeptAndUnknownTextStaysEnglish() {
        assertEquals("  Case khan ", nag.tr("  Cases "))
        assertEquals("Wozhuro", nag.tr("Wozhuro"))
        assertEquals("HA-2610-0015", nag.tr("HA-2610-0015"))
        assertEquals("", nag.tr(""))
        assertEquals("   ", nag.tr("   "))
        assertFalse(nag.knows("Wozhuro"))
        assertTrue(nag.knows("Elephant warning · Sanis"))
    }

    @Test
    fun englishChangesNothing() {
        assertTrue(Translator.ENGLISH.isIdentity)
        assertEquals("Home", Translator.ENGLISH.tr("Home"))
        assertSame(Translator.ENGLISH, Translator.forLanguage(Language.ENGLISH))
        assertSame(Translator.nagamese, Translator.forLanguage(Language.NAGAMESE))
        assertEquals(Language.NAGAMESE, Language.fromName("NAGAMESE"))
        assertEquals(Language.ENGLISH, Language.fromName("klingon"))
        assertEquals(Language.ENGLISH, Language.fromName(null))
    }

    @Test
    fun tableIsComplete() {
        val text = Translator::class.java.getResourceAsStream("/nagamese.json")!!.readBytes().toString(Charsets.UTF_8)
        val root = kotlinx.serialization.json.Json.parseToJsonElement(text) as kotlinx.serialization.json.JsonObject
        // The exact table is pinned to web-ts/src/i18n/nagamese.ts by nagameseJsonIsFresh; here,
        // only that it was generated with both parts present.
        assertTrue((root["words"] as kotlinx.serialization.json.JsonObject).size > 400)
        assertTrue((root["patterns"] as kotlinx.serialization.json.JsonArray).size > 50)
    }

    /**
     * Every pattern compiles on the JVM and matches a real example of its English (the same
     * samples hatialert-py/tools/check_i18n.cjs checks the JavaScript with).
     */
    @Test
    fun everyPatternMatchesASample() {
        val text = Translator::class.java.getResourceAsStream("/nagamese.json")!!.readBytes().toString(Charsets.UTF_8)
        val root = kotlinx.serialization.json.Json.parseToJsonElement(text) as kotlinx.serialization.json.JsonObject
        val patterns = (root["patterns"] as kotlinx.serialization.json.JsonArray).map {
            Regex((it as kotlinx.serialization.json.JsonArray)[0].let { p -> (p as kotlinx.serialization.json.JsonPrimitive).content })
        }
        val unmatched = patterns.filter { re -> SAMPLES.none { re.matches(it) } }.map { it.pattern }
        assertEquals(emptyList(), unmatched)
        for (s in SAMPLES) assertTrue(nag.knows(s), s)
    }

    /** tools/gen_nagamese.py run against hatialert-py still gives the committed JSON. */
    @Test
    fun nagameseJsonIsFresh() {
        val py = PythonServerIntegrationTest.findPython()
        assumeTrue(py != null, "Python 3.10+ not found; skipping the Nagamese freshness check")
        val jvm = File(System.getProperty("hatialert.jvm.dir", "../"))
        val pyDir = File(System.getProperty("hatialert.py.dir", "../../hatialert-py"))
        assumeTrue(File(pyDir, "web-ts/src/i18n/nagamese.ts").isFile, "nagamese.ts not found under $pyDir")
        val p = ProcessBuilder(py, File(jvm, "tools/gen_nagamese.py").path, "--py-dir", pyDir.path)
            .redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val fresh = p.inputStream.readBytes().toString(Charsets.UTF_8)
        assertTrue(p.waitFor(60, TimeUnit.SECONDS))
        assertEquals(0, p.exitValue(), "gen_nagamese.py failed")
        val committed = File(jvm, "client/src/main/resources/nagamese.json").readText()
        assertTrue(
            fresh == committed,
            "client/src/main/resources/nagamese.json is stale: run `python3 tools/gen_nagamese.py > client/src/main/resources/nagamese.json`",
        )
    }

    companion object {
        /**
         * The English examples every pattern must match: read from hatialert-py/tools/check_i18n.cjs,
         * the same list the web app's check uses, so the two can't drift apart.
         */
        val SAMPLES: List<String> by lazy { readJsSamples(File(System.getProperty("hatialert.py.dir", "../../hatialert-py"), "tools/check_i18n.cjs")) }

        /** The double-quoted string literals in `const SAMPLES = [ ... ];`, skipping `//` comments. */
        fun readJsSamples(file: File): List<String> {
            assumeTrue(file.isFile, "check_i18n.cjs not found at $file")
            val text = file.readText()
            val start = text.indexOf("const SAMPLES = [")
            val end = text.indexOf("\n];", start)
            check(start >= 0 && end > start) { "SAMPLES array not found in $file" }
            val out = ArrayList<String>()
            for (line in text.substring(start + "const SAMPLES = [".length, end).lines()) {
                var k = 0
                while (k < line.length) {
                    val c = line[k]
                    if (c == '/' && k + 1 < line.length && line[k + 1] == '/') break
                    if (c == '"') {
                        val sb = StringBuilder()
                        k++
                        while (k < line.length && line[k] != '"') {
                            if (line[k] == '\\' && k + 1 < line.length) {
                                k++
                                sb.append(
                                    when (line[k]) {
                                        'n' -> '\n'
                                        't' -> '\t'
                                        else -> line[k]
                                    },
                                )
                            } else {
                                sb.append(line[k])
                            }
                            k++
                        }
                        out.add(sb.toString())
                    }
                    k++
                }
            }
            check(out.size > 50) { "only ${out.size} samples read from $file" }
            return out
        }
    }
}
