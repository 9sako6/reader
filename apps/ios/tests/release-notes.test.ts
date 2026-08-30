export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "generate-apple-release-notes.sh");

function git(repository, ...commandArguments) {
  return execFileSync("git", commandArguments, { cwd: repository, encoding: "utf8" });
}

function commit(repository, title) {
  fs.writeFileSync(path.join(repository, "content.txt"), `${title}\n`, { flag: "a" });
  git(repository, "add", "content.txt");
  git(repository, "commit", "-m", title);
  return git(repository, "rev-parse", "HEAD").trim();
}

test("the first Apple release lists changes after the preceding Chrome snapshot", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-apple-release-notes-"));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Release test");
  git(repository, "config", "user.email", "release-test@example.com");
  commit(repository, "以前の変更");
  git(repository, "tag", "chrome-v2026.8.6");
  const speedCommit = commit(repository, "iPhoneでreaderを常にすばやく開く");
  const snapshotCommit = commit(repository, "Apple版のスナップショットを残す");
  git(repository, "tag", "apple-v2026.8.7");

  const notes = execFileSync("bash", [script, "apple-v2026.8.7"], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      APPLE_RELEASE_REPOSITORY_URL: "https://github.com/example/reader",
    },
  });

  assert.doesNotMatch(notes, /以前の変更/u);
  assert.match(notes, /署名情報は含まれず、iPhoneへ直接インストールする配布物ではありません/u);
  assert.match(notes, new RegExp(`\\[${speedCommit.slice(0, 7)}\\]`, "u"));
  assert.match(notes, new RegExp(`\\[${snapshotCommit.slice(0, 7)}\\]`, "u"));
  assert.ok(notes.indexOf("iPhoneでreaderを常にすばやく開く") < notes.indexOf("Apple版のスナップショットを残す"));
});
