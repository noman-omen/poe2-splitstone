"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { watchClientLog, isClientTxtPath } = require("../src/client-log");

describe("watchClientLog", () => {
  let dir, logPath;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-log-"));
    logPath = path.join(dir, "Client.txt");
    fs.writeFileSync(logPath, "seed\n");
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  it("rejects non-Client.txt paths", () => {
    assert.throws(() => watchClientLog(path.join(dir, "other.txt"), () => {}), /Client\.txt/);
  });

  it("emits zone events from appended lines", async () => {
    const events = [];
    const w = watchClientLog(logPath, (e) => events.push(e), { pollMs: 50 });
    await new Promise((r) => setTimeout(r, 80));
    fs.appendFileSync(
      logPath,
      '2026/10/15 05:40:01 1 a [DEBUG Client 1] Generating level 2 area "G1_2" with seed 1\n' +
        "2026/10/15 05:40:02 1 a [INFO Client 1] : You have entered Clearfell.\n",
    );
    await new Promise((r) => setTimeout(r, 200));
    w.stop();
    assert.ok(events.some((e) => e.type === "zone" && e.name === "Clearfell" && e.area === "g1_2"));
  });

  it("isClientTxtPath accepts windows-style paths on linux", () => {
    assert.equal(isClientTxtPath("C:\\\\Program Files\\\\Path of Exile 2\\\\logs\\\\Client.txt"), true);
  });
});
