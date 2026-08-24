export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "next-chrome-version.sh");

function git(repository, ...commandArguments) {
  return execFileSync("git", commandArguments, { cwd: repository, encoding: "utf8" });
}

function initializeRepository() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-release-version-"));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Release test");
  git(repository, "config", "user.email", "release-test@example.com");
  fs.writeFileSync(path.join(repository, "content.txt"), "initial\n");
  git(repository, "add", "content.txt");
  git(repository, "commit", "-m", "initial");
  return repository;
}

function nextVersion(repository, releaseDate) {
  return execFileSync("bash", [script], {
    cwd: repository,
    encoding: "utf8",
    env: { ...process.env, CHROME_RELEASE_DATE: releaseDate },
  }).trim();
}

test("the first Chrome release in a month starts at release zero", () => {
  const repository = initializeRepository();
  git(repository, "tag", "chrome-v0.0.10");

  assert.equal(nextVersion(repository, "2026-08-24"), "2026.8.0");
});

test("the next Chrome release increments the highest release in the same month", () => {
  const repository = initializeRepository();
  git(repository, "tag", "chrome-v2026.8.0");
  git(repository, "tag", "chrome-v2026.8.2");
  git(repository, "tag", "chrome-v2026.7.9");

  assert.equal(nextVersion(repository, "2026-08-24"), "2026.8.3");
});

test("the Chrome release sequence returns to zero in a new month", () => {
  const repository = initializeRepository();
  git(repository, "tag", "chrome-v2026.8.4");

  assert.equal(nextVersion(repository, "2026-09-01"), "2026.9.0");
});
