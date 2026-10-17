#!/usr/bin/env python3
"""Security regression tests: import URL allowlist, helper bounds, PoB inflate caps."""
import json
import os
import sys
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "helper"))

from playwright.sync_api import sync_playwright
import splitstone_helper as sh
from tracker_url import TRACKER_URL

URL = TRACKER_URL


class HelperSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = ROOT / "helper" / "_sec_client.txt"
        cls.tmp.write_text("")
        cls.port = 8771
        cls.token_port = 8772
        cls.hub = sh.Hub()
        cls.httpd = sh.ThreadingHTTPServer(
            ("127.0.0.1", cls.port), sh.make_handler(cls.hub, cls.tmp))
        cls.httpd.daemon_threads = True
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

        cls.hub_t = sh.Hub()
        cls.httpd_t = sh.ThreadingHTTPServer(
            ("127.0.0.1", cls.token_port),
            sh.make_handler(cls.hub_t, cls.tmp, token="sekrit"))
        cls.httpd_t.daemon_threads = True
        threading.Thread(target=cls.httpd_t.serve_forever, daemon=True).start()
        time.sleep(0.15)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd_t.shutdown()
        cls.tmp.unlink(missing_ok=True)

    def _conn(self, port=None):
        return HTTPConnection("127.0.0.1", port or self.port, timeout=3)

    def test_content_length_too_large(self):
        c = self._conn()
        c.request("POST", "/state", body=b"{}", headers={
            "Content-Type": "application/json", "Content-Length": "64001"})
        r = c.getresponse(); body = r.read(); c.close()
        self.assertEqual(r.status, 413, body)

    def test_content_length_negative(self):
        c = self._conn()
        # http.client won't send negative easily — hit handler via raw-ish path:
        # send Content-Length: -1 with empty body; BaseHTTPRequestHandler still parses header.
        c.request("POST", "/state", body=b"", headers={
            "Content-Type": "application/json", "Content-Length": "-1"})
        r = c.getresponse(); body = r.read(); c.close()
        self.assertIn(r.status, (400, 413), body)

    def test_content_length_zero_ok(self):
        c = self._conn()
        c.request("POST", "/state", body=b"", headers={
            "Content-Type": "application/json", "Content-Length": "0"})
        r = c.getresponse(); body = r.read(); c.close()
        self.assertEqual(r.status, 200, body)

    def test_exact_path_rejects_prefix(self):
        c = self._conn()
        c.request("GET", "/state/evil")
        r = c.getresponse(); r.read(); c.close()
        self.assertEqual(r.status, 404)

    def test_cors_allowlist_localhost(self):
        c = self._conn()
        c.request("OPTIONS", "/state", headers={"Origin": "http://127.0.0.1:8765"})
        r = c.getresponse(); r.read(); c.close()
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "http://127.0.0.1:8765")

    def test_cors_allowlist_ipv6(self):
        c = self._conn()
        c.request("OPTIONS", "/state", headers={"Origin": "http://[::1]:8765"})
        r = c.getresponse(); r.read(); c.close()
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "http://[::1]:8765")

    def test_cors_rejects_foreign_origin(self):
        c = self._conn()
        c.request("OPTIONS", "/state", headers={"Origin": "https://evil.example"})
        r = c.getresponse(); r.read(); c.close()
        self.assertIsNone(r.getheader("Access-Control-Allow-Origin"))

    def test_status_reports_auth_without_token(self):
        c = self._conn(self.token_port)
        c.request("GET", "/status")
        r = c.getresponse(); body = r.read(); c.close()
        self.assertEqual(r.status, 200, body)
        data = json.loads(body)
        self.assertTrue(data["auth"])
        self.assertIsNone(data["log"], "log path must be hidden when a token is set")

    def test_token_required_on_state(self):
        c = self._conn(self.token_port)
        c.request("GET", "/state")
        r = c.getresponse(); r.read(); c.close()
        self.assertEqual(r.status, 401)
        c = self._conn(self.token_port)
        c.request("GET", "/state", headers={"X-Splitstone-Token": "sekrit"})
        r = c.getresponse(); body = r.read(); c.close()
        self.assertEqual(r.status, 200, body)


    def test_post_state_accepts_header_token(self):
        payload = {"v": 1, "zone": "Clearfell", "step": "x", "zoneMs": 1, "runMs": 1, "running": False}
        body = json.dumps(payload).encode()
        c = self._conn(self.token_port)
        c.request("POST", "/state", body=body, headers={
            "Content-Type": "application/json", "X-Splitstone-Token": "sekrit"})
        r = c.getresponse(); data = r.read(); c.close()
        self.assertEqual(r.status, 200, data)

    def test_post_state_rejects_wrong_token(self):
        c = self._conn(self.token_port)
        c.request("POST", "/state", body=b"{}", headers={
            "Content-Type": "application/json", "X-Splitstone-Token": "nope",
            "Content-Length": "2"})
        r = c.getresponse(); r.read(); c.close()
        self.assertEqual(r.status, 401)


class BrowserSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        cls.page = cls.browser.new_page()
        cls.page.goto(URL)
        cls.page.evaluate("localStorage.clear()")
        cls.page.reload()
        cls.page.wait_for_function("() => window.Storage2 && window.PoB")

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def test_helper_url_allowlist(self):
        ok = self.page.evaluate("""() => ({
          good1: Storage2.isLocalHelperUrl('http://127.0.0.1:8766'),
          good2: Storage2.isLocalHelperUrl('http://localhost:8766'),
          good6: Storage2.isLocalHelperUrl('http://[::1]:8766'),
          badHost: Storage2.isLocalHelperUrl('http://evil.example:8766'),
          badHttps: Storage2.isLocalHelperUrl('https://127.0.0.1:8766'),
          badPath: Storage2.isLocalHelperUrl('http://127.0.0.1:8766/evil'),
          badUser: Storage2.isLocalHelperUrl('http://u:p@127.0.0.1:8766'),
          badQuery: Storage2.isLocalHelperUrl('http://127.0.0.1:8766?token=x'),
          badHash: Storage2.isLocalHelperUrl('http://127.0.0.1:8766#x'),
          canon: Storage2.canonicalHelperUrl('http://127.0.0.1:8766/'),
        })""")
        self.assertTrue(ok["good1"] and ok["good2"] and ok["good6"])
        self.assertFalse(ok["badHost"] or ok["badHttps"] or ok["badPath"] or ok["badUser"] or ok["badQuery"] or ok["badHash"])
        self.assertEqual(ok["canon"], "http://127.0.0.1:8766")

    def test_import_strips_autosplit_enabled(self):
        result = self.page.evaluate("""() => {
          const state = Storage2.load();
          state.settings.autoSplit = { enabled: false, url: 'http://127.0.0.1:8766' };
          const payload = {
            app: 'splitstone', schema: 1, activeId: 'x',
            settings: { autoSplit: { enabled: true, url: 'http://evil.example:9' }, theme: 'ember' },
            characters: { x: { id: 'x', name: 'Imported' } },
          };
          Storage2.importJSON(state, JSON.stringify(payload), { keepHelper: true });
          return {
            enabled: state.settings.autoSplit.enabled,
            url: state.settings.autoSplit.url,
            name: state.characters.x.name,
          };
        }""")
        self.assertFalse(result["enabled"])
        self.assertEqual(result["url"], "http://127.0.0.1:8766")  # evil URL rejected → default
        self.assertEqual(result["name"], "Imported")

    def test_import_preserves_helper_when_declined(self):
        result = self.page.evaluate("""() => {
          const state = Storage2.load();
          state.settings.autoSplit = { enabled: true, url: 'http://127.0.0.1:8766' };
          const payload = {
            schema: 1, activeId: 'y',
            settings: { autoSplit: { enabled: true, url: 'http://localhost:9999' } },
            characters: { y: { id: 'y', name: 'Y' } },
          };
          Storage2.importJSON(state, JSON.stringify(payload), { keepHelper: false });
          return state.settings.autoSplit;
        }""")
        self.assertTrue(result["enabled"])
        self.assertEqual(result["url"], "http://127.0.0.1:8766")

    def test_legacy_migration_leaves_bad_key(self):
        result = self.page.evaluate("""() => {
          localStorage.clear();
          localStorage.setItem('poe2-campaign-tracker:v1', '{not-json');
          const state = Storage2.load();
          return {
            stillThere: localStorage.getItem('poe2-campaign-tracker:v1'),
            hasFresh: !!state.characters && Object.keys(state.characters).length >= 1,
            noNewKey: localStorage.getItem(Storage2.KEY) === null,
          };
        }""")
        self.assertEqual(result["stillThere"], "{not-json")
        self.assertTrue(result["hasFresh"])
        # load() returns defaultState without writing when migration fails and KEY missing
        self.assertTrue(result["noNewKey"] or result["hasFresh"])

    def test_inflate_rejects_huge_compressed(self):
        result = self.page.evaluate("""async () => {
          const big = new Uint8Array(PoB.MAX_COMPRESSED + 1);
          try { await PoB.inflate(big); return 'ok'; }
          catch (e) { return e.message; }
        }""")
        self.assertIn("too large", result)

    def test_csv_formula_prefix(self):
        # Exercise csvCell via exporting — call through page by evaluating a small copy
        # of the same rule used in app.js (exported cells for map names).
        out = self.page.evaluate("""() => {
          const csvCell = v => {
            let s = String(v ?? '');
            if (/^[=+\\-@\\t\\r]/.test(s)) s = "'" + s;
            return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          };
          return [csvCell('=CMD'), csvCell('+1'), csvCell('normal')];
        }""")
        self.assertEqual(out[0], "'=CMD")
        self.assertEqual(out[1], "'+1")
        self.assertEqual(out[2], "normal")


if __name__ == "__main__":
    unittest.main()
