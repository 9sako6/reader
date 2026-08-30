export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "git-revision.sh");

function git(repository, ...commandArguments) {
  return execFileSync("git", commandArguments, { cwd: repository, encoding: "utf8" });
}

function initializeRepository() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-git-revision-"));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Revision test");
  git(repository, "config", "user.email", "revision-test@example.com");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "initial\n");
  git(repository, "add", "tracked.txt");
  git(repository, "commit", "-m", "initial");
  return repository;
}

test("a clean Apple build records the eight-character Git commit", () => {
  const repository = initializeRepository();
  const expectedRevision = git(repository, "rev-parse", "--short=8", "HEAD").trim();

  const revision = execFileSync("bash", [script, repository], { encoding: "utf8" });

  assert.equal(revision, `${expectedRevision}\n`);
});

test("an Apple build with tracked changes marks the Git commit as dirty", () => {
  const repository = initializeRepository();
  const expectedRevision = git(repository, "rev-parse", "--short=8", "HEAD").trim();
  fs.writeFileSync(path.join(repository, "tracked.txt"), "changed\n");

  const revision = execFileSync("bash", [script, repository], { encoding: "utf8" });

  assert.equal(revision, `${expectedRevision}-dirty\n`);
});

test("an Apple build with an untracked file marks the Git commit as dirty", () => {
  const repository = initializeRepository();
  const expectedRevision = git(repository, "rev-parse", "--short=8", "HEAD").trim();
  fs.writeFileSync(path.join(repository, "local-signing.txt"), "local only\n");

  const revision = execFileSync("bash", [script, repository], { encoding: "utf8" });

  assert.equal(revision, `${expectedRevision}-dirty\n`);
});
