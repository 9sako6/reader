export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "sync-release-version.mjs");

function createVersionFiles() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-shared-release-version-"));
  fs.mkdirSync(path.join(repository, "apps", "chrome"), { recursive: true });
  fs.mkdirSync(path.join(repository, "apps", "ios", "ReaderExtension", "Resources"), { recursive: true });
  fs.writeFileSync(path.join(repository, "apps", "chrome", "manifest.json"), '{\n  "version": "2026.8.6"\n}\n');
  fs.writeFileSync(path.join(repository, "apps", "ios", "project.yml"), [
    "settings:",
    "  base:",
    "    CURRENT_PROJECT_VERSION: 41",
    "    MARKETING_VERSION: 2026.8.6",
    "",
  ].join("\n"));
  fs.writeFileSync(
    path.join(repository, "apps", "ios", "ReaderExtension", "Resources", "manifest.json"),
    '{\n  "version": "2026.8.6"\n}\n',
  );
  return repository;
}

test("setting a shared release version updates Chrome and both Apple version owners without changing the Apple build", () => {
  const repository = createVersionFiles();

  const version = execFileSync("node", [script, "2026.8.7", repository], { encoding: "utf8" });

  assert.equal(version, "2026.8.7\n");
  assert.equal(JSON.parse(fs.readFileSync(path.join(repository, "apps", "chrome", "manifest.json"), "utf8")).version, "2026.8.7");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(repository, "apps", "ios", "ReaderExtension", "Resources", "manifest.json"), "utf8")).version,
    "2026.8.7",
  );
  assert.match(fs.readFileSync(path.join(repository, "apps", "ios", "project.yml"), "utf8"), /CURRENT_PROJECT_VERSION: 41/u);
  assert.match(fs.readFileSync(path.join(repository, "apps", "ios", "project.yml"), "utf8"), /MARKETING_VERSION: 2026\.8\.7/u);
});

test("checking a shared release version rejects a Chrome version that differs from the Apple project", () => {
  const repository = createVersionFiles();
  fs.writeFileSync(path.join(repository, "apps", "chrome", "manifest.json"), '{\n  "version": "2026.8.5"\n}\n');

  const result = spawnSync("node", [script, "--check", repository], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /release versions differ: iOS=2026\.8\.6, Chrome=2026\.8\.5, Safari=2026\.8\.6/u);
});
