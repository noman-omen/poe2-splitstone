"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isAllowedLogPath } = require("../src/client-log");
const { isPrereleaseVersion } = require("../src/desktop-settings");

function tmpLog(dir, name = "Client.txt") {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, "");
  return p;
}

test("known candidate is allowed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const known = tmpLog(path.join(root, "Path of Exile 2", "logs"));
  assert.ok(isAllowedLogPath(known, null, [known]));
});

test("arbitrary Client.txt is rejected unless picked", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const other = tmpLog(path.join(root, "elsewhere"));
  assert.ok(!isAllowedLogPath(other, null, []));
  assert.ok(isAllowedLogPath(other, other, []));
});

test("symlink named Client.txt to another file is rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const secret = path.join(root, "secret.txt");
  fs.writeFileSync(secret, "x");
  const link = path.join(root, "Client.txt");
  try { fs.symlinkSync(secret, link); } catch (_) { return; }
  assert.ok(!isAllowedLogPath(link, link, [link]));
});

test("non Client.txt names are rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const p = tmpLog(root, "notes.txt");
  assert.ok(!isAllowedLogPath(p, p, [p]));
});

test("prerelease detection", () => {
  assert.strictEqual(isPrereleaseVersion("1.0.0"), false);
  assert.strictEqual(isPrereleaseVersion("0.6.1"), false);
  assert.strictEqual(isPrereleaseVersion("1.1.0-beta.1"), true);
});
