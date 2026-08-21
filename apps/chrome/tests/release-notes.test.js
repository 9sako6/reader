const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "generate-chrome-release-notes.sh");

function git(repository, ...commandArguments) {
  return execFileSync("git", commandArguments, { cwd: repository, encoding: "utf8" });
}

function commit(repository, title) {
  fs.writeFileSync(path.join(repository, "content.txt"), `${title}\n`, { flag: "a" });
  git(repository, "add", "content.txt");
  git(repository, "commit", "-m", title);
}

test("Chrome release notes list commit titles between Chrome tags without pull requests", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-release-notes-"));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Release test");
  git(repository, "config", "user.email", "release-test@example.com");
  commit(repository, "以前の変更");
  git(repository, "tag", "chrome-v0.0.1");
  commit(repository, "画像を本文位置に表示する");
  commit(repository, "暗幕で夜間の眩しさを抑える");
  git(repository, "tag", "chrome-v0.0.2");

  const notes = execFileSync("bash", [script, "chrome-v0.0.2"], {
    cwd: repository,
    encoding: "utf8",
  });

  assert.doesNotMatch(notes, /以前の変更/);
  assert.match(notes, /## 変更/);
  assert.ok(notes.indexOf("画像を本文位置に表示する") < notes.indexOf("暗幕で夜間の眩しさを抑える"));

  const outputPath = path.join(repository, "release-notes.md");
  execFileSync("bash", [script, "chrome-v0.0.2", outputPath], { cwd: repository });
  assert.equal(fs.readFileSync(outputPath, "utf8"), notes);
});
