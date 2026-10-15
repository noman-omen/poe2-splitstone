#!/usr/bin/env python3
"""Splitstone helper: Client.txt auto-split + optional always-on-top overlay.

Standard library only (Python 3.8+). Optional:
  - global hotkeys: pip install pynput
  - overlay UI: tkinter (included with python.org Windows builds; python3-tk on Linux)

    python splitstone_helper.py
    python splitstone_helper.py --log "D:\\...\\logs\\Client.txt"
    python splitstone_helper.py --overlay              # top-right corner panel
    python splitstone_helper.py --overlay --hotkeys

The browser cannot draw over a fullscreen game. Enable Auto-split in Splitstone
so the tab connects here; with --overlay the helper also shows a compact panel.

Localhost only (127.0.0.1):
  GET  /events   Server-Sent Events → browser (zone changes, hotkeys)
  GET  /status   health + last zone event
  GET  /state    latest overlay snapshot (JSON)
  POST /state    browser pushes current step/timer (JSON) → overlay

CORS: Origin allowlist (localhost / 127.0.0.1 / null). Optional --token or
$SPLITSTONE_TOKEN requires X-Splitstone-Token (or ?token= for SSE).
POST /state: Content-Length must be 0..64000. Paths are exact match.
"""
import argparse
import json
import os
import queue
import re
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = 2

DEFAULT_LOGS = [
    r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile 2\logs\Client.txt",
    r"C:\Program Files\Steam\steamapps\common\Path of Exile 2\logs\Client.txt",
    r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\logs\Client.txt",
    r"C:\Program Files\Grinding Gear Games\Path of Exile 2\logs\Client.txt",
    os.path.expanduser("~/.steam/steam/steamapps/common/Path of Exile 2/logs/Client.txt"),
    os.path.expanduser("~/.local/share/Steam/steamapps/common/Path of Exile 2/logs/Client.txt"),
]

RE_GENERATING = re.compile(r'Generating level (\d+) area "([^"]+)"')
RE_ENTERED = re.compile(r"\] : You have entered (.+?)\.?\s*$")


class Parser:
    PAIR_WINDOW = 5.0

    def __init__(self, emit):
        self.emit = emit
        self.pending = None

    def feed(self, line, now=None):
        now = time.monotonic() if now is None else now
        m = RE_GENERATING.search(line)
        if m:
            self.flush(now, force=True)
            self.pending = (m.group(2).lower(), int(m.group(1)), now)
            return
        m = RE_ENTERED.search(line)
        if m:
            area, level = (self.pending[0], self.pending[1]) if self.pending else (None, None)
            self.pending = None
            self.emit({"type": "zone", "area": area, "name": m.group(1).strip(), "level": level})

    def flush(self, now=None, force=False):
        now = time.monotonic() if now is None else now
        if self.pending and (force or now - self.pending[2] > self.PAIR_WINDOW):
            area, level, _ = self.pending
            self.pending = None
            self.emit({"type": "zone", "area": area, "name": None, "level": level})


class Hub:
    def __init__(self):
        self.clients, self.lock, self.last = [], threading.Lock(), None
        self.state = None  # latest overlay snapshot (dict)
        self.on_state = None  # optional callback(state)

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def publish(self, event):
        event.setdefault("ts", datetime.now().isoformat(timespec="seconds"))
        if event.get("type") == "zone":
            self.last = event
        print(f"[{event['ts']}] {json.dumps(event)}", flush=True)
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(event)
                except queue.Full:
                    pass

    def set_state(self, state):
        self.state = state
        if self.on_state:
            try:
                self.on_state(state)
            except Exception as e:
                print(f"! overlay state callback: {e}", flush=True)


def tail(path, parser, stop, from_start=False, poll=0.25):
    pos, ident = None, None
    while not stop.is_set():
        try:
            st = os.stat(path)
            if ident != (st.st_dev, st.st_ino) or (pos is not None and st.st_size < pos):
                pos = 0 if (from_start or ident is not None) else st.st_size
                ident = (st.st_dev, st.st_ino)
            if st.st_size > pos:
                with open(path, "rb") as f:
                    f.seek(pos)
                    chunk = f.read()
                end = chunk.rfind(b"\n") + 1
                for raw in chunk[:end].splitlines():
                    parser.feed(raw.decode("utf-8", "replace"))
                pos += end
        except FileNotFoundError:
            ident = None
        parser.flush()
        stop.wait(poll)


def _origin_allowed(origin):
    """Strict browser Origin allowlist for local helper CORS."""
    if origin is None or origin == "":
        return False
    if origin == "null":  # file:// pages
        return True
    try:
        from urllib.parse import urlparse
        u = urlparse(origin)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    host = (u.hostname or "").lower()
    return host in ("127.0.0.1", "localhost")


def make_handler(hub, log_path, token=None):
    # Import here so unit tests that only need Parser don't need overlay_state on path quirks
    from overlay_state import normalise
    from urllib.parse import urlparse, parse_qs

    MAX_STATE = 64_000

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _path_only(self):
            return (self.path or "/").split("?", 1)[0]

        def _query(self):
            q = urlparse(self.path).query
            return parse_qs(q)

        def cors(self):
            origin = self.headers.get("Origin")
            if origin and _origin_allowed(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Splitstone-Token")
            self.send_header("Cache-Control", "no-store")

        def _authorized(self):
            if not token:
                return True
            hdr = self.headers.get("X-Splitstone-Token") or ""
            qs = self._query().get("token", [None])[0]
            return hdr == token or qs == token

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.end_headers()

        def _json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.cors()
            self.end_headers()
            self.wfile.write(body)

        def _deny(self):
            self._json(401, {"ok": False, "error": "unauthorized"})

        def do_POST(self):
            if self._path_only() != "/state":
                self.send_error(404)
                return
            if not self._authorized():
                self._deny()
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except (TypeError, ValueError):
                self._json(400, {"ok": False, "error": "bad Content-Length"})
                return
            if length < 0 or length > MAX_STATE:
                self._json(413 if length > MAX_STATE else 400,
                           {"ok": False, "error": "Content-Length out of bounds (0..64000)"})
                return
            try:
                raw = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                state = normalise(raw)
            except (ValueError, json.JSONDecodeError) as e:
                self._json(400, {"ok": False, "error": str(e)})
                return
            hub.set_state(state)
            self._json(200, {"ok": True})

        def do_GET(self):
            path = self._path_only()
            if path == "/status":
                if not self._authorized():
                    self._deny()
                    return
                self._json(200, {"ok": True, "version": VERSION, "log": str(log_path),
                                 "log_exists": Path(log_path).exists(), "last": hub.last,
                                 "overlay": hub.state is not None,
                                 "auth": bool(token)})
                return
            if path == "/state":
                if not self._authorized():
                    self._deny()
                    return
                self._json(200, hub.state or {})
                return
            if path != "/events":
                self.send_error(404)
                return
            if not self._authorized():
                self._deny()
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.cors()
            self.end_headers()
            q = hub.subscribe()
            try:
                hello = {"type": "hello", "version": VERSION, "log": str(log_path),
                         "log_exists": Path(log_path).exists(), "overlay": True}
                self.wfile.write(f"data: {json.dumps(hello)}\n\n".encode())
                self.wfile.flush()
                while True:
                    try:
                        ev = q.get(timeout=15)
                        self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                hub.unsubscribe(q)

    return Handler


def start_hotkeys(hub, spec):
    try:
        from pynput import keyboard
    except ImportError:
        print("! --hotkeys needs pynput: pip install pynput (continuing without hotkeys)", flush=True)
        return None
    mapping = {}
    for part in spec.split(","):
        action, _, key = part.partition("=")
        mapping[f"<{key.strip().lower()}>"] = action.strip()
    listener = keyboard.GlobalHotKeys(
        {k: (lambda a=a: hub.publish({"type": "hotkey", "action": a})) for k, a in mapping.items()})
    listener.daemon = True
    listener.start()
    print(f"Global hotkeys: {mapping}", flush=True)
    return listener


def find_log(explicit):
    if explicit:
        return Path(explicit)
    env = os.environ.get("POE2_CLIENT_TXT")
    if env:
        return Path(env)
    for p in DEFAULT_LOGS:
        if Path(p).exists():
            return Path(p)
    return Path(DEFAULT_LOGS[0])


def main(argv=None):
    # Allow `python helper/splitstone_helper.py` and imports from helper/
    here = Path(__file__).resolve().parent
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--log", help="path to Client.txt (default: auto-detect, or $POE2_CLIENT_TXT)")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--from-start", action="store_true", help="replay the whole log (testing)")
    ap.add_argument("--hotkeys", nargs="?", const="split=f1,undo=f2,pause=f3",
                    help="global hotkeys, e.g. split=f1,undo=f2,pause=f3 (needs pynput)")
    ap.add_argument("--overlay", action="store_true",
                    help="show always-on-top top-right corner panel (needs tkinter)")
    ap.add_argument("--opacity", type=float, default=0.88, help="overlay opacity 0.4–1.0 (default 0.88)")
    ap.add_argument("--click-through", action="store_true",
                    help="start overlay click-through (Windows; toggleable in the panel)")
    ap.add_argument("--token", default=os.environ.get("SPLITSTONE_TOKEN") or None,
                    help="require X-Splitstone-Token / ?token= (or set $SPLITSTONE_TOKEN)")
    args = ap.parse_args(argv)

    log_path = find_log(args.log)
    hub = Hub()
    stop = threading.Event()
    parser = Parser(hub.publish)
    threading.Thread(target=tail, args=(str(log_path), parser, stop, args.from_start), daemon=True).start()
    if args.hotkeys:
        start_hotkeys(hub, args.hotkeys)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(hub, log_path, token=args.token))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Watching {log_path}{'' if log_path.exists() else '  (not found yet, waiting)'}", flush=True)
    print(f"Serving http://127.0.0.1:{args.port}/  (events, state, status)  Ctrl+C to stop", flush=True)
    if args.token:
        print("Auth: token required (X-Splitstone-Token or ?token=)", flush=True)

    overlay = None
    if args.overlay:
        try:
            from overlay import Overlay
        except ImportError as e:
            print(f"! --overlay needs tkinter ({e}). On Windows use python.org builds; "
                  f"on Linux: sudo apt install python3-tk", flush=True)
        else:
            def on_action(action):
                hub.publish({"type": "hotkey", "action": action})

            overlay = Overlay(on_action=on_action, opacity=args.opacity,
                              click_through=args.click_through)
            hub.on_state = overlay.set_state
            print("Overlay: top-right corner panel (drag the SPLITSTONE title to move)", flush=True)
            try:
                overlay.run()  # Tk main loop on this thread
            except KeyboardInterrupt:
                pass
            finally:
                overlay.close()
            stop.set()
            server.shutdown()
            return 0

    try:
        while not stop.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
