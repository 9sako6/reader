export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "bump-ios-build.mjs");

test("bumping an iOS build changes only the build number in the project spec", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reader-ios-build-version-"));
  const projectSpecPath = path.join(directory, "project.yml");
  fs.writeFileSync(projectSpecPath, [
    "settings:",
    "  base:",
    "    CURRENT_PROJECT_VERSION: 2",
    "    MARKETING_VERSION: 0.0.1",
    "",
  ].join("\n"));

  const nextBuild = execFileSync("node", [script, projectSpecPath], { encoding: "utf8" });

  assert.equal(nextBuild, "3\n");
  assert.equal(fs.readFileSync(projectSpecPath, "utf8"), [
    "settings:",
    "  base:",
    "    CURRENT_PROJECT_VERSION: 3",
    "    MARKETING_VERSION: 0.0.1",
    "",
  ].join("\n"));
});

test("bumping an iOS build rejects multiple build-number owners", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reader-ios-build-version-"));
  const projectSpecPath = path.join(directory, "project.yml");
  fs.writeFileSync(projectSpecPath, [
    "settings:",
    "  base:",
    "    CURRENT_PROJECT_VERSION: 2",
    "targets:",
    "  reader:",
    "    settings:",
    "      CURRENT_PROJECT_VERSION: 3",
    "",
  ].join("\n"));

  const result = spawnSync("node", [script, projectSpecPath], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected exactly one CURRENT_PROJECT_VERSION/);
});
