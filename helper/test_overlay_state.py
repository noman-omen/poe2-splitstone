#!/usr/bin/env python3
"""Protocol tests for overlay state (no GUI)."""
import json
import sys
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from overlay_state import EMPTY, format_delta, format_ms, lines_for_panel, normalise


class StateProtocolTest(unittest.TestCase):
    def test_normalise_defaults(self):
        s = normalise({})
        self.assertEqual(s["zone"], EMPTY["zone"])
        self.assertEqual(s["v"], 1)

    def test_normalise_fields(self):
        s = normalise({"zone": "Clearfell", "zoneMs": 45000, "deltaMs": -3000, "running": 1, "tip": "x" * 500})
        self.assertEqual(s["zone"], "Clearfell")
        self.assertEqual(s["zoneMs"], 45000)
        self.assertEqual(s["deltaMs"], -3000)
        self.assertTrue(s["running"])
        self.assertLessEqual(len(s["tip"]), 240)

    def test_normalise_rejects_non_object(self):
        with self.assertRaises(ValueError):
            normalise([1, 2])

    def test_formatters(self):
        self.assertEqual(format_ms(0), "0:00")
        self.assertEqual(format_ms(65000), "1:05")
        self.assertEqual(format_ms(3723000), "1:02:03")
        self.assertEqual(format_delta(-5000), "−0:05")
        self.assertEqual(format_delta(5000), "+0:05")

    def test_panel_lines(self):
        rows = lines_for_panel(normalise({
            "zone": "Cemetery of the Eternals", "section": "Act 1", "progress": "9/111",
            "step": "Activate waypoint", "tip": "Hug the walls",
            "nextStep": "Kill Asinia", "nextZone": "Tomb of the Consort",
            "zoneMs": 30000, "runMs": 390000, "deltaMs": 5000, "running": True,
        }))
        roles = [r for r, _ in rows]
        self.assertEqual(roles[:4], ["zone", "step", "tip", "next"])
        self.assertIn("seg", roles)
        self.assertIn("run", roles)
        self.assertIn("delta", roles)
        self.assertIn("Cemetery", rows[0][1])
        self.assertTrue(rows[2][1].startswith("➤ "))
        self.assertTrue(any("+0:05" in t for r, t in rows if r == "delta"))
        # Tip hard-cap
        long = normalise({"tip": "x" * 200})
        self.assertLessEqual(len(long["tip"]), 100)
        self.assertTrue(long["tip"].endswith("…"))


class HelperStateEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import splitstone_helper as sh
        cls.tmp = Path(__file__).resolve().parent / "_test_client.txt"
        cls.tmp.write_text("")
        cls.port = 8768
        cls.proc_stop = threading.Event()
        # Run helper main in a thread with --overlay omitted
        def run():
            try:
                sh.main(["--log", str(cls.tmp), "--port", str(cls.port)])
            except Exception:
                pass
        # Actually main blocks forever — use server pieces directly
        cls.hub = sh.Hub()
        handler = sh.make_handler(cls.hub, cls.tmp)
        cls.httpd = sh.ThreadingHTTPServer(("127.0.0.1", cls.port), handler)
        cls.httpd.daemon_threads = True
        t = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        t.start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.tmp.unlink(missing_ok=True)

    def _conn(self):
        return HTTPConnection("127.0.0.1", self.port, timeout=3)

    def test_post_and_get_state(self):
        payload = {"v": 1, "zone": "Clearfell", "step": "Kill Beira", "zoneMs": 12000,
                   "runMs": 12000, "running": True, "tip": "Stay above 35 life"}
        c = self._conn()
        body = json.dumps(payload).encode()
        c.request("POST", "/state", body=body, headers={"Content-Type": "application/json"})
        r = c.getresponse()
        self.assertEqual(r.status, 200)
        self.assertTrue(json.loads(r.read())["ok"])
        c.close()

        c = self._conn()
        c.request("GET", "/state")
        r = c.getresponse()
        data = json.loads(r.read())
        c.close()
        self.assertEqual(data["zone"], "Clearfell")
        self.assertEqual(data["step"], "Kill Beira")
        self.assertEqual(data["zoneMs"], 12000)

    def test_bad_json(self):
        c = self._conn()
        c.request("POST", "/state", body=b"not-json", headers={"Content-Type": "application/json"})
        r = c.getresponse()
        self.assertEqual(r.status, 400)
        c.close()

    def test_options_cors(self):
        c = self._conn()
        c.request("OPTIONS", "/state")
        r = c.getresponse()
        self.assertIn(r.status, (200, 204))
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "*")
        c.close()


if __name__ == "__main__":
    unittest.main()
