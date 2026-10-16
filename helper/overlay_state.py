"""Shared state protocol between the Splitstone browser app and the helper overlay.

Browser POSTs JSON to http://127.0.0.1:8766/state. Overlay paints a compact
top-right race panel showing only: current step, optional hint, next step.

Schema (version 1):
{
  "v": 1,
  "step": "...", "tip": "...", "nextStep": "...",
  "showTip": true,
  "opacity": 0.8, "clickThrough": true,
  # legacy fields still accepted but ignored by the minimal panel:
  "zone", "section", "nextZone", "zoneMs", "runMs", "deltaMs",
  "running", "paused", "finished", "progress", "hotkeys"
}
"""
from __future__ import annotations

import copy
from typing import Any, Optional

SCHEMA_VERSION = 1
TIP_MAX = 100
STEP_MAX = 120
NEXT_MAX = 100
DEFAULT_OPACITY = 0.80


EMPTY: dict[str, Any] = {
    "v": SCHEMA_VERSION,
    "zone": "—",
    "section": "",
    "step": "Open Splitstone and enable Auto-split",
    "tip": "",
    "nextStep": "",
    "nextZone": "",
    "zoneMs": 0,
    "runMs": 0,
    "deltaMs": None,
    "running": False,
    "paused": False,
    "finished": False,
    "progress": "",
    "showTip": True,
    "opacity": DEFAULT_OPACITY,
    "clickThrough": True,
    "hotkeys": {"split": " ", "pause": "p", "undo": "u"},
}


def format_ms(ms: Optional[float]) -> str:
    if ms is None:
        return "—"
    s = max(0, int(ms // 1000))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def format_delta(ms: Optional[float]) -> str:
    if ms is None:
        return ""
    sign = "+" if ms > 0 else ("−" if ms < 0 else "±")
    return sign + format_ms(abs(ms))


def ellipsis(text: str, limit: int = TIP_MAX) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def key_label(key: Optional[str]) -> str:
    if not key:
        return ""
    if key == " ":
        return "Space"
    return key if len(key) > 1 else key.upper()


def normalise(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("state must be a JSON object")
    out = copy.deepcopy(EMPTY)
    out["v"] = int(raw.get("v") or SCHEMA_VERSION)
    for key in ("zone", "section", "step", "nextStep", "nextZone", "progress"):
        if key in raw and raw[key] is not None:
            out[key] = str(raw[key])[:240]
    if raw.get("tip") is not None:
        out["tip"] = ellipsis(str(raw["tip"]), TIP_MAX)
    out["step"] = ellipsis(out.get("step") or "", STEP_MAX)
    out["nextStep"] = ellipsis(out.get("nextStep") or "", NEXT_MAX)
    for key in ("zoneMs", "runMs"):
        if key in raw and raw[key] is not None:
            out[key] = max(0, int(raw[key]))
    if "deltaMs" in raw:
        out["deltaMs"] = None if raw["deltaMs"] is None else int(raw["deltaMs"])
    for key in ("running", "paused", "finished"):
        if key in raw:
            out[key] = bool(raw[key])
    if "showTip" in raw:
        out["showTip"] = bool(raw["showTip"])
    if "opacity" in raw and raw["opacity"] is not None:
        try:
            out["opacity"] = max(0.30, min(1.0, float(raw["opacity"])))
        except (TypeError, ValueError):
            pass
    if "clickThrough" in raw:
        out["clickThrough"] = bool(raw["clickThrough"])
    hk = raw.get("hotkeys")
    if isinstance(hk, dict):
        for k in ("split", "pause", "undo"):
            if k in hk and hk[k] is not None:
                out["hotkeys"][k] = str(hk[k])[:16]
    return out


def lines_for_panel(state: dict[str, Any]) -> list[tuple[str, str]]:
    """Minimal rows: step, optional tip, next. No timers/delta/zone chrome."""
    rows: list[tuple[str, str]] = []
    step = ellipsis(state.get("step") or "—", STEP_MAX)
    rows.append(("step", step))
    if state.get("showTip", True):
        tip = ellipsis(state.get("tip") or "", TIP_MAX)
        if tip:
            rows.append(("tip", tip))
    nxt = ellipsis(state.get("nextStep") or "", NEXT_MAX)
    if nxt:
        rows.append(("next", "Next · " + nxt))
    return rows
