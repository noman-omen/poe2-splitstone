"""Minimal always-on-top Splitstone overlay — top-right step panel.

Shows only: current step, optional hint, next step.
Opacity and click-through come from the app via state (not on-overlay chrome).
Tiny drag handle appears on hover.
"""
from __future__ import annotations

import sys
import threading
import tkinter as tk
from tkinter import font as tkfont
from typing import Any, Callable, Optional

from overlay_state import DEFAULT_OPACITY, EMPTY, OPACITY_MIN, THEMES, lines_for_panel

WIDTH = 320
PAD = 8


class Overlay:
    def __init__(self, on_action: Optional[Callable[[str], None]] = None,
                 opacity: float = DEFAULT_OPACITY, click_through: bool = True):
        self.on_action = on_action or (lambda _a: None)
        self._state: dict[str, Any] = dict(EMPTY)
        self._opacity = max(OPACITY_MIN, min(1.0, opacity))
        self._click_through = click_through
        self._theme = ""
        self._frame: Optional[tk.Frame] = None
        self._root: Optional[tk.Tk] = None
        self._labels: dict[str, tk.Label] = {}
        self._handle: Optional[tk.Label] = None
        self._body: Optional[tk.Frame] = None
        self._lock = threading.Lock()
        self._pending: Optional[dict[str, Any]] = None
        self._alive = False
        self._drag_x = 0
        self._drag_y = 0

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
        pal = THEMES["ember"]
        root.configure(bg=pal["panel"])
        root.attributes("-topmost", True)
        try:
            root.attributes("-alpha", self._opacity)
        except tk.TclError:
            pass
        root.resizable(False, False)
        root.overrideredirect(True)

        frame = tk.Frame(root, bg=pal["panel"], highlightbackground=pal["line"], highlightthickness=1)
        frame.pack(fill="both", expand=True)
        self._frame = frame

        handle = tk.Label(frame, text="⠿", bg=pal["panel"], fg=pal["accent"], font=("Segoe UI", 8),
                          cursor="fleur")
        self._handle = handle
        handle.bind("<ButtonPress-1>", self._start_drag)
        handle.bind("<B1-Motion>", self._drag)

        body = tk.Frame(frame, bg=pal["panel"])
        body.pack(fill="both", expand=True, padx=PAD, pady=(4, 6))
        self._body = body

        fonts = {
            "step": tkfont.Font(family="Segoe UI", size=10, weight="bold"),
            "tip": tkfont.Font(family="Segoe UI", size=9),
            "next": tkfont.Font(family="Segoe UI", size=8),
        }
        for role in ("step", "tip", "next"):
            self._labels[role] = tk.Label(
                body, text="", bg=pal["panel"], fg=pal["next" if role == "tip" else role], font=fonts[role],
                anchor="w", justify="left", wraplength=WIDTH - 2 * PAD,
            )
            if role == "step":
                self._labels[role].pack(fill="x", pady=0)

        frame.bind("<Enter>", lambda _e: self._show_handle())
        frame.bind("<Leave>", lambda _e: self._hide_handle())

        root.update_idletasks()
        self._place_top_right()
        self._apply_click_through()
        self._flush()

    def _show_handle(self) -> None:
        if self._handle and not self._handle.winfo_ismapped() and self._body:
            self._handle.pack(fill="x", padx=PAD, pady=(2, 0), before=self._body)
            self._resize()

    def _hide_handle(self) -> None:
        if not self._handle or not self._handle.winfo_ismapped() or not self._root:
            return
        try:
            x, y = self._root.winfo_pointerxy()
            widget = self._root.winfo_containing(x, y)
            if widget is self._handle:
                return
        except tk.TclError:
            pass
        self._handle.pack_forget()
        self._resize()

    def _place_top_right(self) -> None:
        self._root.update_idletasks()
        h = max(self._root.winfo_reqheight(), 36)
        sw = self._root.winfo_screenwidth()
        self._root.geometry(f"{WIDTH}x{h}+{max(0, sw - WIDTH - 16)}+48")

    def _resize(self) -> None:
        if not self._root:
            return
        self._root.update_idletasks()
        h = max(self._root.winfo_reqheight(), 36)
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

    def _set_theme(self, theme: str) -> None:
        """Repaint in one of the app's themes; unknown names keep the current one."""
        if theme not in THEMES or theme == self._theme or not self._root:
            return
        self._theme = theme
        pal = THEMES[theme]
        self._root.configure(bg=pal["panel"])
        if self._frame:
            self._frame.configure(bg=pal["panel"], highlightbackground=pal["line"])
        if self._body:
            self._body.configure(bg=pal["panel"])
        if self._handle:
            self._handle.configure(bg=pal["panel"], fg=pal["accent"])
        for role, label in self._labels.items():
            label.configure(bg=pal["panel"], fg=pal["next" if role == "tip" else role])

    def _set_opacity(self, opacity: float) -> None:
        self._opacity = max(OPACITY_MIN, min(1.0, float(opacity)))
        if not self._root:
            return
        try:
            self._root.attributes("-alpha", self._opacity)
        except tk.TclError:
            pass

    def _apply_click_through(self) -> None:
        if sys.platform != "win32" or not self._root:
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
        if state.get("opacity") is not None:
            self._set_opacity(state["opacity"])
        self._set_theme(state.get("theme") or "ember")
        if "clickThrough" in state:
            ct = bool(state["clickThrough"])
            if ct != self._click_through:
                self._click_through = ct
                self._apply_click_through()

        shown = {role: text for role, text in lines_for_panel(state)}
        for role, label in self._labels.items():
            text = shown.get(role, "")
            label.configure(text=text)
            if role == "step":
                continue
            if text and not label.winfo_ismapped():
                label.pack(fill="x", pady=(2, 0))
            elif not text and label.winfo_ismapped():
                label.pack_forget()
        self._resize()
