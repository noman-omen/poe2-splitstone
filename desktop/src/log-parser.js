"use strict";
/**
 * Client.txt zone-event parser (ported from helper/splitstone_helper.py).
 * Pure: feed(line, now?) → emit zone events via callback.
 */
const RE_GENERATING = /Generating level (\d+) area "([^"]+)"/;
const RE_ENTERED = /\] : You have entered (.+?)\.?\s*$/;

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

module.exports = { Parser, RE_GENERATING, RE_ENTERED };
