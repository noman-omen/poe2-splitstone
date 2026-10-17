"use strict";
/**
 * Client.txt zone-event parser (ported from helper/splitstone_helper.py).
 * Pure: feed(line, now?) → emit zone and level-up events via callback.
 */
const RE_GENERATING = /Generating level (\d+) area "([^"]+)"/;
const RE_ENTERED = /\] : You have entered (.+?)\.?\s*$/;
/**
 * The game's own level-up notice, matched as a whole line: date, time, two counters, the [INFO Client n] tag, then
 * " : Name (Class) is now level N". The class is the ascendancy once the character has one, which can be several
 * words ("Smith of Kitava"). Chat lines put the sender before the colon ("] Name: ..."), so a typed message can't produce one.
 */
const RE_LEVEL = /^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d \d+ [0-9a-f]+ \[INFO Client \d+\] : ([A-Za-z0-9_]{3,23}) \(([A-Za-z]{2,24}(?: [A-Za-z]{2,24}){0,3})\) is now level (\d{1,3})\r?$/;

/** { name, cls, level } for a level-up line, otherwise null. */
function parseLevelUp(line) {
  const m = RE_LEVEL.exec(String(line));
  if (!m) return null;
  const level = Number(m[3]);
  return level >= 1 && level <= 100 ? { name: m[1], cls: m[2], level } : null;
}

class Parser {
  constructor(emit) {
    this.emit = emit;
    this.pending = null;
    this.PAIR_WINDOW = 5.0;
  }

  feed(line, now) {
    const t = now == null ? Date.now() / 1000 : now;
    let m = RE_GENERATING.exec(line);
    if (m) {
      this.flush(t, true);
      this.pending = { area: m[2].toLowerCase(), level: parseInt(m[1], 10), t };
      return;
    }
    const up = parseLevelUp(line);
    if (up) {
      this.emit({ type: "level", ...up });
      return;
    }
    m = RE_ENTERED.exec(line);
    if (m) {
      const area = this.pending ? this.pending.area : null;
      const level = this.pending ? this.pending.level : null;
      this.pending = null;
      this.emit({ type: "zone", area, name: m[1].trim(), level });
    }
  }

  flush(now, force = false) {
    const t = now == null ? Date.now() / 1000 : now;
    if (this.pending && (force || t - this.pending.t > this.PAIR_WINDOW)) {
      const { area, level } = this.pending;
      this.pending = null;
      this.emit({ type: "zone", area, name: null, level });
    }
  }
}

module.exports = { Parser, parseLevelUp, RE_GENERATING, RE_ENTERED, RE_LEVEL };
