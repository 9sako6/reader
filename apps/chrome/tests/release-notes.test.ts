export {};

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
  return git(repository, "rev-parse", "HEAD").trim();
}

test("Chrome release notes link each commit title between Chrome tags to its commit", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-release-notes-"));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Release test");
  git(repository, "config", "user.email", "release-test@example.com");
  commit(repository, "以前の変更");
  git(repository, "tag", "chrome-v0.0.10");
  const imageCommit = commit(repository, "画像を本文位置に表示する");
  const dimmingCommit = commit(repository, "暗幕で夜間の眩しさを抑える");
  git(repository, "tag", "chrome-v2026.8.0");

  const notes = execFileSync("bash", [script, "chrome-v2026.8.0"], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      CHROME_RELEASE_REPOSITORY_URL: "https://github.com/example/reader",
    },
  });

  assert.doesNotMatch(notes, /以前の変更/);
  assert.match(notes, /## 変更/);
  assert.match(
    notes,
    new RegExp(
      `^- 画像を本文位置に表示する \\(\\[${imageCommit.slice(0, 7)}\\]\\(https://github\\.com/example/reader/commit/${imageCommit}\\)\\)$`,
      "m",
    ),
  );
  assert.match(
    notes,
    new RegExp(
      `^- 暗幕で夜間の眩しさを抑える \\(\\[${dimmingCommit.slice(0, 7)}\\]\\(https://github\\.com/example/reader/commit/${dimmingCommit}\\)\\)$`,
      "m",
    ),
  );
  assert.ok(notes.indexOf("画像を本文位置に表示する") < notes.indexOf("暗幕で夜間の眩しさを抑える"));

  const outputPath = path.join(repository, "release-notes.md");
  execFileSync("bash", [script, "chrome-v2026.8.0", outputPath], {
    cwd: repository,
    env: {
      ...process.env,
      CHROME_RELEASE_REPOSITORY_URL: "https://github.com/example/reader",
    },
  });
  assert.equal(fs.readFileSync(outputPath, "utf8"), notes);
});
