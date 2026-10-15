"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

describe("IPC contract", () => {
  it("preload exposes only allowlisted methods", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
    assert.match(src, /contextBridge\.exposeInMainWorld\("splitstoneDesktop"/);
    const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /nodeIntegration:\s*false/);
    for (const ch of [
      "desktop:get-status", "desktop:set-client-log", "desktop:browse-client-log",
      "desktop:find-client-log", "desktop:set-hotkeys", "desktop:set-overlay",
      "desktop:overlay-state", "desktop:zone", "desktop:hotkey",
    ]) {
      assert.ok(main.includes(ch) || src.includes(ch), "missing " + ch);
    }
  });

  it("file reads gated to Client.txt", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/client-log.js"), "utf8");
    assert.match(src, /Only Client\.txt may be watched/);
  });
});
