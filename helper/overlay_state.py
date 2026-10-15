"""Shared state protocol between the Splitstone browser app and the helper overlay.

Browser POSTs JSON to http://127.0.0.1:8766/state. Overlay paints a compact
top-right race panel.

Schema (version 1 + optional hotkeys):
{
  "v": 1,
  "zone": "...", "section": "...", "step": "...", "tip": "...",
  "nextStep": "...", "nextZone": "...",
  "zoneMs": 0, "runMs": 0, "deltaMs": null,
  "running": true, "paused": false, "finished": false, "progress": "9/111",
  "hotkeys": { "split": " ", "pause": "p", "undo": "u" }
}
"""
from __future__ import annotations

import copy
from typing import Any, Optional

SCHEMA_VERSION = 1
TIP_MAX = 100

EMPTY: dict[str, Any] = {
    "v": SCHEMA_VERSION,
    "zone": "—",
    "section": "",
    "step": "Open Splitstone in a browser and enable Auto-split",
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
    for key in ("zoneMs", "runMs"):
        if key in raw and raw[key] is not None:
            out[key] = max(0, int(raw[key]))
    if "deltaMs" in raw:
        out["deltaMs"] = None if raw["deltaMs"] is None else int(raw["deltaMs"])
    for key in ("running", "paused", "finished"):
        if key in raw:
            out[key] = bool(raw[key])
    hk = raw.get("hotkeys")
    if isinstance(hk, dict):
        for k in ("split", "pause", "undo"):
            if k in hk and hk[k] is not None:
                out["hotkeys"][k] = str(hk[k])[:16]
    return out


def lines_for_panel(state: dict[str, Any]) -> list[tuple[str, str]]:
    """Return (role, text) rows. Roles: zone, step, tip, next, seg, run, delta, status."""
    rows: list[tuple[str, str]] = []
    head = state.get("zone") or "—"
    if state.get("section"):
        head = f"{state['section']} · {head}"
    if state.get("progress"):
        head = f"{head}  ({state['progress']})"
    rows.append(("zone", head))
    rows.append(("step", state.get("step") or "—"))
    tip = ellipsis(state.get("tip") or "", TIP_MAX)
    if tip:
        rows.append(("tip", "➤ " + tip))
    nxt = []
    if state.get("nextStep"):
        nxt.append(state["nextStep"])
    if state.get("nextZone"):
        nxt.append(state["nextZone"])
    if nxt:
        rows.append(("next", "Next · " + " · ".join(nxt)))
    rows.append(("seg", "seg  " + format_ms(state.get("zoneMs"))))
    rows.append(("run", "run  " + format_ms(state.get("runMs"))))
    d = state.get("deltaMs")
    if d is not None:
        rows.append(("delta", "Δ  " + format_delta(d)))
    if state.get("paused"):
        rows.append(("status", "PAUSED"))
    elif state.get("finished"):
        rows.append(("status", "DONE"))
    return rows
