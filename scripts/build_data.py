#!/usr/bin/env python3
"""Generate data/campaign.js from the route.json produced by the original
tracker (/workspace/poe2/campaign/route.json).

The output is a plain JS file assigning a global, so the app works both when
served over HTTP and when opened directly via file:// (no fetch needed).

Usage: python3 scripts/build_data.py [path/to/route.json]
"""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/poe2/campaign/route.json")
OUT = Path(__file__).resolve().parent.parent / "data" / "campaign.js"


# Area ids missing in the source data (verified against Client.txt "Generating level" lines).
AREA_OVERRIDES = {"act1-01": "g1_1"}


def slim_step(s):
    """Keep only what the tracker renders.
    hints = layout + fast tips (how-to-play advice);
    extra = details, skip list, rewards, ritual/level warnings (supplementary info)."""
    return {
        "id": s["id"],
        "zone": s["zone"],
        "level": s.get("level"),
        "objective": s["objective"],
        "waypoint": s.get("waypoint"),
        "optional": bool(s.get("optional")),
        "area": (s.get("area_id") or AREA_OVERRIDES.get(s["id"]) or "").lower() or None,
        # Route variants: "normal" = full clear, "fast" = speedrun route (skip_in_fast steps dropped).
        "modes": [m for m in (s.get("modes") or ["normal", "fast"]) if not (m == "fast" and s.get("skip_in_fast"))],
        "hints": list(s.get("layout") or []),
        "fastTips": list(s.get("fast_tips") or []) + ([f"Saves {x}" for x in [s["fast_saves"]]] if s.get("fast_saves") else []),
        "details": list(s.get("details") or []),
        "skip": list(s.get("skip") or []),
        "rewards": [
            {"label": r["label"], "must": bool(r.get("must")), "permanent": bool(r.get("permanent"))}
            for r in s.get("rewards") or []
        ],
        "warning": s.get("level_warning"),
    }


# The source keeps all three Interludes in one "interludes" block, in the
# speedrun order 2 -> 3 -> 2 -> 1 (see the step objectives in route.json).
# Split it into separate timed sections; Interlude 2 is played in two parts,
# both belonging to the "interlude2" group so it gets one combined total.
INTERLUDE_SPLITS = [
    # (section id, group id, name, region, first step, last step)
    ("int2a", "interlude2", "Interlude 2 · part 1", "The Khari Bazaar → Pools of Khatal", 1, 5),
    ("int3", "interlude3", "Interlude 3", "Mount Kriar → The Cuachic Vault", 6, 12),
    ("int2b", "interlude2", "Interlude 2 · part 2", "Sel Khari Sanctuary → Qimah Reservoir", 13, 16),
    ("int1", "interlude1", "Interlude 1", "The Refuge → Holten → Kingsmarch", 17, 25),
]
GROUP_NAMES = {"interlude1": "Interlude 1", "interlude2": "Interlude 2", "interlude3": "Interlude 3"}


def split_interludes(act):
    steps = {int(s["id"].rsplit("-", 1)[1]): s for s in act["steps"]}
    assert sorted(steps) == list(range(1, 26)), "interlude step numbering changed, update INTERLUDE_SPLITS"
    for sid, gid, name, region, a, b in INTERLUDE_SPLITS:
        yield {"id": sid, "group": gid, "kind": "interlude", "name": name, "region": region,
               "levels": " → ".join(dict.fromkeys(
                   lv for lv in (steps[a]["level"], next((steps[i]["level"] for i in range(b, a - 1, -1)
                                                          if steps[i]["level"]), None)) if lv)),
               "steps": [steps[i] for i in range(a, b + 1)]}


def main():
    route = json.loads(SRC.read_text())
    sections, groups = [], []
    blocks = []
    for act in route["acts"]:
        if act["id"] == "interludes":
            blocks.extend(split_interludes(act))
        else:
            blocks.append(dict(act, group=act["id"], kind="act"))
    for act in blocks:
        # Group consecutive steps by zone: each zone gets its own timer.
        zones = []
        for step in act["steps"]:
            if not zones or zones[-1]["name"] != step["zone"]:
                zones.append({"id": f"{act['id']}-z{len(zones) + 1:02d}", "name": step["zone"], "steps": []})
            zones[-1]["steps"].append(slim_step(step))
        for z in zones:  # area ids used by the Client.txt auto-splitter
            z["areas"] = sorted({st["area"] for st in z["steps"] if st["area"]})
        if act["group"] not in [g["id"] for g in groups]:
            groups.append({"id": act["group"], "kind": act["kind"],
                           "name": GROUP_NAMES.get(act["group"], act["name"])})
        sections.append({
            "id": act["id"],
            "group": act["group"],
            "kind": act["kind"],
            "name": act["name"],
            "region": act.get("region"),
            "levels": act.get("levels"),
            "zones": zones,
        })
    pace = route["meta"].get("pace", {})
    data = {
        "meta": {k: route["meta"].get(k) for k in ("title", "patch", "league", "generated")},
        "variants": {k: {"label": v.get("label"), "desc": v.get("desc"), "tips": v.get("general_tips", [])}
                     for k, v in pace.items()},
        "groups": groups,
        "sections": sections,
    }
    OUT.write_text("// Generated by scripts/build_data.py, do not edit by hand.\n"
                   "window.CAMPAIGN_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    n = sum(len(z["steps"]) for s in sections for z in s["zones"])
    print(f"wrote {OUT} ({len(sections)} sections, {n} steps)")


if __name__ == "__main__":
    main()
