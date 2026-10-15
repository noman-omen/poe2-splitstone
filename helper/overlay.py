"""Compact always-on-top Splitstone overlay — top-right race panel.

Race-mode default: minimal wordmark drag handle; settings behind ⚙ / double-click;
action buttons only when click-through is off (hidden when display-only).
"""
from __future__ import annotations

import sys
import threading
import tkinter as tk
from tkinter import font as tkfont
from typing import Any, Callable, Optional

from overlay_state import EMPTY, key_label, lines_for_panel

BG = "#100e0a"
PANEL = "#1a1815"
LINE = "#3a342a"
TEXT = "#e8e0d0"
MUTED = "#a39a88"
GOLD = "#e6c47a"
GOLD_DIM = "#c8a45a"
SEG = "#e6c47a"       # segment time: gold / neutral
RUN_C = "#a39a88"     # run: secondary muted
OK = "#6fbf73"
BAD = "#d0574e"
TIP = "#f1e6c8"

WIDTH = 340
PAD = 10


class Overlay:
    def __init__(self, on_action: Optional[Callable[[str], None]] = None,
                 opacity: float = 0.88, click_through: bool = False):
        self.on_action = on_action or (lambda _a: None)
        self._state: dict[str, Any] = dict(EMPTY)
        self._opacity = max(0.35, min(1.0, opacity))
        self._click_through = click_through
        self._settings_open = False
        self._root: Optional[tk.Tk] = None
        self._labels: dict[str, tk.Label] = {}
        self._btn_frame: Optional[tk.Frame] = None
        self._opts_frame: Optional[tk.Frame] = None
        self._buttons: dict[str, tk.Button] = {}
        self._lock = threading.Lock()
        self._pending: Optional[dict[str, Any]] = None
        self._alive = False

    def set_state(self, state: dict[str, Any]) -> None:
        with self._lock:
            self._pending = state
        if self._root is not None:
            try:
                self._root.after(0, self._flush)
            except tk.TclError:
                pass

    def close(self) -> None:
        self._alive = False
        if self._root is not None:
            try:
                self._root.after(0, self._root.destroy)
            except tk.TclError:
                pass

    def run(self) -> None:
        self._build()
        self._alive = True
        self._root.mainloop()
        self._alive = False

    def _build(self) -> None:
        root = tk.Tk()
        self._root = root
        root.title("Splitstone")
        root.configure(bg=BG)
        root.attributes("-topmost", True)
        try:
            root.attributes("-alpha", self._opacity)
        except tk.TclError:
            pass
        root.resizable(False, False)
        root.overrideredirect(True)

        frame = tk.Frame(root, bg=PANEL, highlightbackground=GOLD_DIM, highlightthickness=1)
        frame.pack(fill="both", expand=True)

        # Minimal drag-handle wordmark + gear
        bar = tk.Frame(frame, bg=PANEL)
        bar.pack(fill="x", padx=PAD, pady=(4, 0))
        title = tk.Label(bar, text="◆", bg=PANEL, fg=GOLD_DIM, font=("Segoe UI", 9, "bold"),
                         cursor="fleur")
        title.pack(side="left")
        title.bind("<ButtonPress-1>", self._start_drag)
        title.bind("<B1-Motion>", self._drag)
        title.bind("<Double-Button-1>", lambda _e: self._toggle_settings())
        # Tiny wordmark (not the full SPLITSTONE shout)
        mark = tk.Label(bar, text="splitstone", bg=PANEL, fg=GOLD_DIM,
                        font=("Segoe UI", 8), cursor="fleur")
        mark.pack(side="left", padx=(4, 0))
        mark.bind("<ButtonPress-1>", self._start_drag)
        mark.bind("<B1-Motion>", self._drag)
        mark.bind("<Double-Button-1>", lambda _e: self._toggle_settings())
        gear = tk.Button(bar, text="⚙", command=self._toggle_settings,
                         bg=PANEL, fg=MUTED, activebackground=LINE, activeforeground=GOLD,
                         relief="flat", bd=0, padx=4, font=("Segoe UI", 9), cursor="hand2")
        gear.pack(side="right")

        body = tk.Frame(frame, bg=PANEL)
        body.pack(fill="both", expand=True, padx=PAD, pady=(2, 2))

        fonts = {
            "zone": tkfont.Font(family="Segoe UI", size=11, weight="bold"),
            "step": tkfont.Font(family="Segoe UI", size=10, weight="bold"),
            "tip": tkfont.Font(family="Segoe UI", size=9),
            "next": tkfont.Font(family="Segoe UI", size=8),
            "seg": tkfont.Font(family="Consolas", size=13, weight="bold"),
            "run": tkfont.Font(family="Consolas", size=10),
            "delta": tkfont.Font(family="Consolas", size=12, weight="bold"),
            "status": tkfont.Font(family="Segoe UI", size=8, weight="bold"),
        }
        colours = {
            "zone": GOLD, "step": TEXT, "tip": TIP, "next": MUTED,
            "seg": SEG, "run": RUN_C, "delta": OK, "status": BAD,
        }
        for role in ("zone", "step", "tip", "next", "seg", "run", "delta", "status"):
            self._labels[role] = tk.Label(body, text="", bg=PANEL, fg=colours[role],
                                          font=fonts[role], anchor="w", justify="left",
                                          wraplength=WIDTH - 2 * PAD)
            self._labels[role].pack(fill="x", pady=0)

        # Action buttons (hidden when click-through)
        self._btn_frame = tk.Frame(frame, bg=PANEL)
        for action, default_key in (("split", " "), ("pause", "p"), ("undo", "u")):
            label = f"{action.title()} ({key_label(default_key)})"
            b = tk.Button(self._btn_frame, text=label,
                          command=lambda a=action: self.on_action(a),
                          bg=PANEL, fg=GOLD, activebackground=LINE, activeforeground=GOLD,
                          relief="solid", bd=1, padx=8, pady=2, font=("Segoe UI", 8))
            b.pack(side="left", padx=(0, 4))
            self._buttons[action] = b

        # Settings (collapsed by default)
        self._opts_frame = tk.Frame(frame, bg=PANEL)
        self._opacity_var = tk.DoubleVar(value=self._opacity)
        tk.Label(self._opts_frame, text="Opacity", bg=PANEL, fg=MUTED,
                 font=("Segoe UI", 7)).pack(side="left")
        tk.Scale(self._opts_frame, from_=0.4, to=1.0, resolution=0.05, orient="horizontal",
                 variable=self._opacity_var, command=self._on_opacity,
                 bg=PANEL, fg=MUTED, highlightthickness=0, troughcolor=LINE,
                 length=100, showvalue=0).pack(side="left", padx=4)
        self._ct_var = tk.BooleanVar(value=self._click_through)
        tk.Checkbutton(self._opts_frame, text="Click-through", variable=self._ct_var,
                       command=self._on_click_through_toggle,
                       bg=PANEL, fg=MUTED, selectcolor=PANEL, activebackground=PANEL,
                       activeforeground=MUTED, font=("Segoe UI", 7)).pack(side="left", padx=4)

        root.update_idletasks()
        self._place_top_right()
        self._apply_click_through()
        self._sync_chrome()
        self._flush()
        root.after(200, self._tick)

    def _toggle_settings(self) -> None:
        self._settings_open = not self._settings_open
        self._sync_chrome()

    def _on_click_through_toggle(self) -> None:
        self._click_through = bool(self._ct_var.get())
        self._apply_click_through()
        self._sync_chrome()

    def _sync_chrome(self) -> None:
        """Race mode: buttons only when interactive; settings only when opened."""
        if not self._btn_frame or not self._opts_frame:
            return
        show_btns = not self._click_through
        if show_btns:
            if not self._btn_frame.winfo_ismapped():
                self._btn_frame.pack(fill="x", padx=PAD, pady=(2, 6))
        elif self._btn_frame.winfo_ismapped():
            self._btn_frame.pack_forget()
        if self._settings_open:
            if not self._opts_frame.winfo_ismapped():
                self._opts_frame.pack(fill="x", padx=PAD, pady=(0, 6))
        elif self._opts_frame.winfo_ismapped():
            self._opts_frame.pack_forget()
        self._root.update_idletasks()
        self._resize()

    def _place_top_right(self) -> None:
        self._root.update_idletasks()
        h = self._root.winfo_reqheight()
        sw = self._root.winfo_screenwidth()
        self._root.geometry(f"{WIDTH}x{h}+{max(0, sw - WIDTH - 16)}+48")

    def _resize(self) -> None:
        self._root.update_idletasks()
        h = max(self._root.winfo_reqheight(), 70)
        parts = self._root.geometry().split("+")
        xy = f"+{parts[1]}+{parts[2]}" if len(parts) >= 3 else ""
        self._root.geometry(f"{WIDTH}x{h}{xy}")

    def _start_drag(self, event) -> None:
        self._drag_x, self._drag_y = event.x_root, event.y_root

    def _drag(self, event) -> None:
        dx = event.x_root - self._drag_x
        dy = event.y_root - self._drag_y
        self._drag_x, self._drag_y = event.x_root, event.y_root
        self._root.geometry(f"+{self._root.winfo_x() + dx}+{self._root.winfo_y() + dy}")

    def _on_opacity(self, _v=None) -> None:
        self._opacity = float(self._opacity_var.get())
        try:
            self._root.attributes("-alpha", self._opacity)
        except tk.TclError:
            pass

    def _apply_click_through(self) -> None:
        if sys.platform != "win32":
            return
        try:
            import ctypes
            hwnd = ctypes.windll.user32.GetParent(self._root.winfo_id())
            GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT = -20, 0x80000, 0x20
            style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED
            if self._click_through:
                style |= WS_EX_TRANSPARENT
            else:
                style &= ~WS_EX_TRANSPARENT
            ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)
        except Exception:
            pass

    def _flush(self) -> None:
        with self._lock:
            if self._pending is not None:
                self._state = self._pending
                self._pending = None
        self._paint(self._state)

    def _paint(self, state: dict[str, Any]) -> None:
        if not self._labels:
            return
        shown = {role: text for role, text in lines_for_panel(state)}
        for role, label in self._labels.items():
            text = shown.get(role, "")
            label.configure(text=text)
            if role in ("tip", "next", "delta", "status"):
                if text and not label.winfo_ismapped():
                    # pack before buttons area — keep after run for delta
                    label.pack(fill="x", pady=0)
                elif not text and label.winfo_ismapped():
                    label.pack_forget()
        # Δ colour: behind PB = BAD (red), ahead = OK (green)
        d = state.get("deltaMs")
        if d is not None and "delta" in self._labels:
            self._labels["delta"].configure(fg=BAD if d > 0 else OK)
        # Hotkey captions from app bindings
        hk = state.get("hotkeys") or {}
        for action, btn in self._buttons.items():
            btn.configure(text=f"{action.title()} ({key_label(hk.get(action))})")
        self._resize()

    def _tick(self) -> None:
        if not self._alive:
            return
        st = self._state
        if st.get("running") and not st.get("paused"):
            st = dict(st)
            st["zoneMs"] = int(st.get("zoneMs") or 0) + 200
            st["runMs"] = int(st.get("runMs") or 0) + 200
            self._state = st
            self._paint(st)
        self._root.after(200, self._tick)
