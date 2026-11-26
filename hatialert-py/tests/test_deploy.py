"""The create-officer command used to make the first officer on a --no-demo server."""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from hatialert.__main__ import create_officer, main, temp_pin
from hatialert.api import App
from hatialert.security import verify_pin
from hatialert.store import Store


class CreateOfficerTests(unittest.TestCase):
    def test_new_officer_gets_temporary_pin(self):
        store = Store(pin_iterations=1000)
        user, pin = create_officer(store, "+91 98765 43210", "Asst. Conservator", "Wokha Town")
        self.assertEqual((user["phone"], user["role"], user["village"]), ("9876543210", "officer", "Wokha Town"))
        self.assertTrue(user["must_change_pin"])
        self.assertTrue(verify_pin(pin, user["pin_hash"]))
        # The temporary PIN signs in, and the API then only allows changing it.
        app = App(store, demo=False)
        status, _, _ = app.handle("POST", "/api/auth/login", "", f'{{"phone": "9876543210", "pin": "{pin}"}}', {})
        self.assertEqual(status, 200)
        self.assertEqual(store.audit_log()[0]["action"], "cli_create_officer")

    def test_existing_account_is_promoted_and_keeps_pin(self):
        store = Store(pin_iterations=1000)
        u = store.create_user("Villager One", "9876500001", "Wozhuro", "4826")
        user, pin = create_officer(store, "9876500001", "", "")
        self.assertIsNone(pin)
        self.assertEqual(user["role"], "officer")
        self.assertTrue(verify_pin("4826", store.user(u["id"])["pin_hash"]))

    def test_bad_input_is_refused(self):
        store = Store(pin_iterations=1000)
        with self.assertRaises(ValueError):
            create_officer(store, "12345", "Name", "Wokha Town")
        with self.assertRaises(ValueError):
            create_officer(store, "9876543210", "Name", "Atlantis")
        with self.assertRaises(ValueError):
            create_officer(store, "9876543210", "X", "Wokha Town")
        self.assertTrue(store.is_empty())

    def test_temp_pin_is_never_weak(self):
        for _ in range(500):
            p = temp_pin()
            self.assertRegex(p, r"^\d{6}$")
            self.assertGreater(len(set(p)), 2)

    def test_command_line(self):
        with tempfile.TemporaryDirectory() as d:
            db = str(Path(d) / "h.db")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                main(["create-officer", "--db", db, "--phone", "9876543210", "--name", "Range Officer", "--village", "Wokha Town"])
            self.assertIn("Temporary PIN:", out.getvalue())
            store = Store(db)
            self.assertEqual(store.user_by_phone("9876543210")["role"], "officer")
            store.db.close()


if __name__ == "__main__":
    unittest.main()
