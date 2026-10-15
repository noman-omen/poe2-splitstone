"""Shared state protocol between the Splitstone browser app and the helper overlay.

The browser POSTs JSON to http://127.0.0.1:8766/state whenever the current
step changes (and on a short timer while a zone clock is running). The helper
overlay reads the latest snapshot and paints a compact top-right panel.

Schema (version 1):
{
  "v": 1,
  "zone": "Cemetery of the Eternals",
  "section": "Act 1",
  "step": "Activate waypoint + checkpoint, enter Tomb of the Consort",
  "tip": "Hug the walls to find both crypt entrances",
  "nextStep": "Kill Asinia → Memorial Key Piece",
  "nextZone": "Tomb of the Consort",
  "zoneMs": 45000,
  "runMs": 390000,
  "deltaMs": 5000,          # vs PB; null if no PB
  "running": true,
  "paused": false,
  "finished": false,
  "progress": "9/111"
}
"""
from __future__ import annotations

import copy
from typing import Any, Optional

SCHEMA_VERSION = 1

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


def normalise(raw: Any) -> dict[str, Any]:
    """Validate / coerce an incoming payload into a safe snapshot."""
    if not isinstance(raw, dict):
        raise ValueError("state must be a JSON object")
    out = copy.deepcopy(EMPTY)
    out["v"] = int(raw.get("v") or SCHEMA_VERSION)
    for key in ("zone", "section", "step", "tip", "nextStep", "nextZone", "progress"):
        if key in raw and raw[key] is not None:
            out[key] = str(raw[key])[:240]
    for key in ("zoneMs", "runMs"):
        if key in raw and raw[key] is not None:
            out[key] = max(0, int(raw[key]))
    if "deltaMs" in raw:
        out["deltaMs"] = None if raw["deltaMs"] is None else int(raw["deltaMs"])
    for key in ("running", "paused", "finished"):
        if key in raw:
            out[key] = bool(raw[key])
    return out


def lines_for_panel(state: dict[str, Any]) -> list[tuple[str, str]]:
    """Return (role, text) rows for the compact corner panel."""
    rows: list[tuple[str, str]] = []
    head = state["zone"] or "—"
    if state.get("section"):
        head = f"{state['section']} · {head}"
    if state.get("progress"):
        head = f"{head}  ({state['progress']})"
    rows.append(("zone", head))
    rows.append(("step", state.get("step") or "—"))
    if state.get("tip"):
        rows.append(("tip", "➤ " + state["tip"]))
    nxt = []
    if state.get("nextStep"):
        nxt.append("Next: " + state["nextStep"])
    if state.get("nextZone"):
        nxt.append("Zone: " + state["nextZone"])
    if nxt:
        rows.append(("next", " · ".join(nxt)))
    timer = format_ms(state.get("zoneMs"))
    run = format_ms(state.get("runMs"))
    delta = format_delta(state.get("deltaMs"))
    status = "PAUSED" if state.get("paused") else ("DONE" if state.get("finished") else "")
    clock = f"{timer}   run {run}"
    if delta:
        clock += f"  {delta}"
    if status:
        clock += f"  [{status}]"
    rows.append(("timer", clock))
    return rows
