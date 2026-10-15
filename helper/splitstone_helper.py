#!/usr/bin/env python3
"""Splitstone helper (PoE2 Client.txt): tail Client.txt and push zone changes to the app.

Standard library only (Python 3.8+). Optional global hotkeys need `pynput`.

    python splitstone_helper.py                      # auto-detect Client.txt
    python splitstone_helper.py --log "D:\\Games\\Path of Exile 2\\logs\\Client.txt"
    python splitstone_helper.py --hotkeys            # F1 split, F2 undo, F3 pause (needs pynput)

The app connects to http://127.0.0.1:8766/events (Server-Sent Events).
Only 127.0.0.1 is bound; nothing is sent anywhere else, and the log is only read.

Events (JSON in the SSE `data:` field):
    {"type": "zone", "area": "g1_2", "name": "Clearfell", "level": 2, "ts": "..."}
    {"type": "hotkey", "action": "split"}
    {"type": "hello", "log": "...", "version": 1}
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

VERSION = 1

# Default install locations (first existing one wins).
DEFAULT_LOGS = [
    r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile 2\logs\Client.txt",
    r"C:\Program Files\Steam\steamapps\common\Path of Exile 2\logs\Client.txt",
    r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\logs\Client.txt",
    r"C:\Program Files\Grinding Gear Games\Path of Exile 2\logs\Client.txt",
    os.path.expanduser("~/.steam/steam/steamapps/common/Path of Exile 2/logs/Client.txt"),
    os.path.expanduser("~/.local/share/Steam/steamapps/common/Path of Exile 2/logs/Client.txt"),
]

# Client.txt lines we care about, e.g.
#   2026/10/15 05:40:01 1234 abc [DEBUG Client 1234] Generating level 2 area "G1_2" with seed 1
#   2026/10/15 05:40:03 1234 abc [INFO Client 1234] : You have entered Clearfell.
RE_GENERATING = re.compile(r'Generating level (\d+) area "([^"]+)"')
RE_ENTERED = re.compile(r"\] : You have entered (.+?)\.?\s*$")


class Parser:
    """Pair a "Generating level" line with the following "You have entered" line.
    A lone line still produces an event (other languages translate "entered")."""

    PAIR_WINDOW = 5.0  # seconds

    def __init__(self, emit):
        self.emit = emit
        self.pending = None  # (area, level, t)

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
        """Emit a "Generating" line that was never followed by "You have entered"."""
        now = time.monotonic() if now is None else now
        if self.pending and (force or now - self.pending[2] > self.PAIR_WINDOW):
            area, level, _ = self.pending
            self.pending = None
            self.emit({"type": "zone", "area": area, "name": None, "level": level})


class Hub:
    """Fan events out to every connected SSE client."""

    def __init__(self):
        self.clients, self.lock, self.last = [], threading.Lock(), None

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


def tail(path, parser, stop, from_start=False, poll=0.25):
    """Follow `path` like `tail -F`: survives the file not existing yet, truncation and rotation."""
    pos, ident = None, None
    while not stop.is_set():
        try:
            st = os.stat(path)
            if ident != (st.st_dev, st.st_ino) or (pos is not None and st.st_size < pos):
                # New/rotated/truncated file: start at the end unless asked to replay.
                pos = 0 if (from_start or ident is not None) else st.st_size
                ident = (st.st_dev, st.st_ino)
            if st.st_size > pos:
                with open(path, "rb") as f:
                    f.seek(pos)
                    chunk = f.read()
                # Only consume complete lines; keep a partial last line for next time.
                end = chunk.rfind(b"\n") + 1
                for raw in chunk[:end].splitlines():
                    parser.feed(raw.decode("utf-8", "replace"))
                pos += end
        except FileNotFoundError:
            ident = None
        parser.flush()
        stop.wait(poll)


def make_handler(hub, log_path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # keep the console for events
            pass

        def cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")

        def do_GET(self):
            if self.path.startswith("/status"):
                body = json.dumps({"ok": True, "version": VERSION, "log": str(log_path),
                                   "log_exists": Path(log_path).exists(), "last": hub.last}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.cors()
                self.end_headers()
                self.wfile.write(body)
                return
            if not self.path.startswith("/events"):
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.cors()
            self.end_headers()
            q = hub.subscribe()
            try:
                hello = {"type": "hello", "version": VERSION, "log": str(log_path),
                         "log_exists": Path(log_path).exists()}
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
    """Global hotkeys (work while the game has focus). Requires `pip install pynput`."""
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
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--log", help="path to Client.txt (default: auto-detect, or $POE2_CLIENT_TXT)")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--from-start", action="store_true", help="replay the whole log (testing)")
    ap.add_argument("--hotkeys", nargs="?", const="split=f1,undo=f2,pause=f3",
                    help="enable global hotkeys, e.g. split=f1,undo=f2,pause=f3 (needs pynput)")
    args = ap.parse_args(argv)

    log_path = find_log(args.log)
    hub = Hub()
    stop = threading.Event()
    parser = Parser(hub.publish)
    threading.Thread(target=tail, args=(str(log_path), parser, stop, args.from_start), daemon=True).start()
    if args.hotkeys:
        start_hotkeys(hub, args.hotkeys)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(hub, log_path))
    server.daemon_threads = True
    print(f"Watching {log_path}{'' if log_path.exists() else '  (not found yet, waiting)'}", flush=True)
    print(f"Serving events on http://127.0.0.1:{args.port}/events  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
