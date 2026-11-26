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
        assertEquals(441, (root["words"] as kotlinx.serialization.json.JsonObject).size)
        assertEquals(55, (root["patterns"] as kotlinx.serialization.json.JsonArray).size)
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
        /** From hatialert-py/tools/check_i18n.cjs. */
        val SAMPLES = listOf(
            "Elephant warning · Wozhuro", "Within 5 km of Wozhuro", "3 open incidents near you", "1 open incident near you",
            "2 open incidents elsewhere in the district. You'll see new reports here.", "2.3 km SW of Wokha Town", "· 6 elephants",
            "5 min ago", "3 h ago", "2 days ago", "of 1:00", "0.5 km away", "Using 26.1, 94.2 (±12 m)", "1 photo, 1 voice note", "3 cases",
            "1.5 acres", "Warnings from forest staff. Alerts for Sanis are marked.", "30 days", "4 still open", "across 9 cases",
            "1 false report", "crops · ₹87,000 property", "CSV · last 30 days", "4 Oct: 2 incidents", "Copy Police number",
            "Theme: Navy blue", "Language: English", "Engine: Python server", "View photo 2", "Voice note 1", "Your 5 km alert area",
            "Sanis: position not verified", "Enter a value from 0 to 200.", "Keep this under 400 characters.",
            "Each photo must be under 1.5 MB.", "A report can have up to 2 voice notes.", "Too many wrong PINs. Try again in 3 min.",
            "A verified case can't move to that status.", "2 reports", "No connection. Showing what was saved at 07:48 am.",
            "Saved report sent: HA-2610-0015", "A saved report couldn't be sent: Choose what happened.",
            "2 photos or voice notes, seen only by the reporter and forest staff.", "Alert sent. 3 people to text by hand (Admin › Messages)",
            "Alert sent. Texting 1 person", "Text me alerts for Wozhuro", "2 wrong PINs today", "Last seen 5 min ago", "Temporary PIN for",
            "8 village positions are not checked yet. Distances and alert areas depend on them.", "Imported: 1 added, 1 updated",
            "Skipped 1 line with a problem: 4", "2 people", "1 incident", "Sent: 1", "6 elephants",
        )
    }
}
