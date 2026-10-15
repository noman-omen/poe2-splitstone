"""Compact always-on-top Splitstone overlay — small top-right corner panel.

Requires tkinter (stdlib on Windows Python installs; `python3-tk` on Linux).
Designed to sit over PoE2: Ember colours, minimal text, opacity + click-through.

Click-through uses Win32 layered-window flags on Windows; on other platforms
the toggle is shown but is a no-op with a status note.
"""
from __future__ import annotations

import sys
import threading
import tkinter as tk
from tkinter import font as tkfont
from typing import Any, Callable, Optional

from overlay_state import EMPTY, format_delta, format_ms, lines_for_panel

# Ember theme (matches css/styles.css [data-theme=ember])
BG = "#100e0a"
PANEL = "#1a1815"
LINE = "#3a342a"
TEXT = "#e8e0d0"
MUTED = "#a39a88"
GOLD = "#e6c47a"
GOLD_DIM = "#c8a45a"
RUN = "#ffb055"
TIP = "#f1e6c8"
OK = "#6fbf73"
BAD = "#d0574e"

WIDTH = 360
PAD = 10


class Overlay:
    """Top-right floating panel. Call `set_state` from any thread."""

    def __init__(self, on_action: Optional[Callable[[str], None]] = None,
                 opacity: float = 0.88, click_through: bool = False):
        self.on_action = on_action or (lambda _a: None)
        self._state: dict[str, Any] = dict(EMPTY)
        self._opacity = max(0.35, min(1.0, opacity))
        self._click_through = click_through
        self._root: Optional[tk.Tk] = None
        self._labels: dict[str, tk.Label] = {}
        self._lock = threading.Lock()
        self._pending: Optional[dict[str, Any]] = None
        self._alive = False

    # ---- public API (thread-safe) ----
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
        """Blocking: create the window and enter the Tk main loop (call from main thread)."""
        self._build()
        self._alive = True
        self._root.mainloop()
        self._alive = False

    # ---- UI ----
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
        root.overrideredirect(True)  # borderless

        frame = tk.Frame(root, bg=PANEL, highlightbackground=GOLD_DIM, highlightthickness=1)
        frame.pack(fill="both", expand=True)

        # Drag handle / title
        title = tk.Label(frame, text="SPLITSTONE", bg=PANEL, fg=GOLD_DIM,
                         font=("Segoe UI", 8, "bold"), anchor="w")
        title.pack(fill="x", padx=PAD, pady=(6, 0))
        title.bind("<ButtonPress-1>", self._start_drag)
        title.bind("<B1-Motion>", self._drag)

        body = tk.Frame(frame, bg=PANEL)
        body.pack(fill="both", expand=True, padx=PAD, pady=(2, 4))

        f_zone = tkfont.Font(family="Segoe UI", size=11, weight="bold")
        f_step = tkfont.Font(family="Segoe UI", size=10, weight="bold")
        f_tip = tkfont.Font(family="Segoe UI", size=9)
        f_next = tkfont.Font(family="Segoe UI", size=8)
        f_timer = tkfont.Font(family="Consolas", size=14, weight="bold")

        self._labels["zone"] = tk.Label(body, text="", bg=PANEL, fg=GOLD, font=f_zone,
                                        anchor="w", justify="left", wraplength=WIDTH - 2 * PAD)
        self._labels["step"] = tk.Label(body, text="", bg=PANEL, fg=TEXT, font=f_step,
                                        anchor="w", justify="left", wraplength=WIDTH - 2 * PAD)
        self._labels["tip"] = tk.Label(body, text="", bg=PANEL, fg=TIP, font=f_tip,
                                       anchor="w", justify="left", wraplength=WIDTH - 2 * PAD)
        self._labels["next"] = tk.Label(body, text="", bg=PANEL, fg=MUTED, font=f_next,
                                        anchor="w", justify="left", wraplength=WIDTH - 2 * PAD)
        self._labels["timer"] = tk.Label(body, text="0:00", bg=PANEL, fg=RUN, font=f_timer,
                                         anchor="w")
        for key in ("zone", "step", "tip", "next", "timer"):
            self._labels[key].pack(fill="x", pady=1)

        btns = tk.Frame(frame, bg=PANEL)
        btns.pack(fill="x", padx=PAD, pady=(0, 8))
        for text, action in (("Split", "split"), ("Pause", "pause"), ("Undo", "undo")):
            b = tk.Button(btns, text=text, command=lambda a=action: self.on_action(a),
                          bg=PANEL, fg=GOLD, activebackground=LINE, activeforeground=GOLD,
                          relief="solid", bd=1, padx=8, pady=2, font=("Segoe UI", 8))
            b.pack(side="left", padx=(0, 4))

        # Opacity / click-through controls
        opts = tk.Frame(frame, bg=PANEL)
        opts.pack(fill="x", padx=PAD, pady=(0, 8))
        tk.Label(opts, text="Opacity", bg=PANEL, fg=MUTED, font=("Segoe UI", 7)).pack(side="left")
        self._opacity_var = tk.DoubleVar(value=self._opacity)
        scale = tk.Scale(opts, from_=0.4, to=1.0, resolution=0.05, orient="horizontal",
                         variable=self._opacity_var, command=self._on_opacity,
                         bg=PANEL, fg=MUTED, highlightthickness=0, troughcolor=LINE,
                         length=100, showvalue=0)
        scale.pack(side="left", padx=4)
        self._ct_var = tk.BooleanVar(value=self._click_through)
        tk.Checkbutton(opts, text="Click-through", variable=self._ct_var,
                       command=self._apply_click_through,
                       bg=PANEL, fg=MUTED, selectcolor=PANEL, activebackground=PANEL,
                       activeforeground=MUTED, font=("Segoe UI", 7)).pack(side="left", padx=4)

        root.update_idletasks()
        self._place_top_right()
        self._apply_click_through()
        self._flush()
        root.after(200, self._tick)

    def _place_top_right(self) -> None:
        root = self._root
        root.update_idletasks()
        w = WIDTH
        h = root.winfo_reqheight()
        sw = root.winfo_screenwidth()
        x = max(0, sw - w - 16)
        y = 48
        root.geometry(f"{w}x{h}+{x}+{y}")

    def _start_drag(self, event) -> None:
        self._drag_x, self._drag_y = event.x_root, event.y_root

    def _drag(self, event) -> None:
        root = self._root
        dx = event.x_root - self._drag_x
        dy = event.y_root - self._drag_y
        self._drag_x, self._drag_y = event.x_root, event.y_root
        root.geometry(f"+{root.winfo_x() + dx}+{root.winfo_y() + dy}")

    def _on_opacity(self, _v=None) -> None:
        self._opacity = float(self._opacity_var.get())
        try:
            self._root.attributes("-alpha", self._opacity)
        except tk.TclError:
            pass

    def _apply_click_through(self) -> None:
        self._click_through = bool(self._ct_var.get()) if hasattr(self, "_ct_var") else self._click_through
        if sys.platform != "win32":
            return
        # WS_EX_LAYERED | WS_EX_TRANSPARENT for click-through; keep LAYERED for alpha.
        try:
            import ctypes
            hwnd = ctypes.windll.user32.GetParent(self._root.winfo_id())
            GWL_EXSTYLE = -20
            WS_EX_LAYERED = 0x80000
            WS_EX_TRANSPARENT = 0x20
            style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            style |= WS_EX_LAYERED
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
            # Collapse empty tip/next rows so the panel stays compact.
            if role in ("tip", "next"):
                if text:
                    if not label.winfo_ismapped():
                        label.pack(fill="x", pady=1, before=self._labels["timer"])
                elif label.winfo_ismapped():
                    label.pack_forget()
        d = state.get("deltaMs")
        colour = RUN if d is None else (BAD if d > 0 else OK)
        self._labels["timer"].configure(fg=colour)
        self._root.update_idletasks()
        h = max(self._root.winfo_reqheight(), 80)
        parts = self._root.geometry().split("+")
        xy = f"+{parts[1]}+{parts[2]}" if len(parts) >= 3 else ""
        self._root.geometry(f"{WIDTH}x{h}{xy}")

    def _tick(self) -> None:
        if not self._alive:
            return
        # Live clock: if running, advance zoneMs/runMs locally between POSTs
        st = self._state
        if st.get("running") and not st.get("paused"):
            st = dict(st)
            st["zoneMs"] = int(st.get("zoneMs") or 0) + 200
            st["runMs"] = int(st.get("runMs") or 0) + 200
            self._state = st
            self._paint(st)
        self._root.after(200, self._tick)
