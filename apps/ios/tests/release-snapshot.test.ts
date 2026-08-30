export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.join(__dirname, "..", "..", "..", "scripts", "package-apple-snapshot.sh");

function git(repository, ...commandArguments) {
  return execFileSync("git", commandArguments, { cwd: repository, encoding: "utf8" });
}

test("an Apple source snapshot contains only files tracked at the release tag", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "reader-apple-snapshot-"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "reader-apple-snapshot-output-"));
  fs.mkdirSync(path.join(repository, "apps", "ios"), { recursive: true });
  fs.writeFileSync(path.join(repository, "apps", "ios", "project.yml"), [
    "settings:",
    "  base:",
    "    CURRENT_PROJECT_VERSION: 41",
    "    MARKETING_VERSION: 2026.8.7",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(repository, "README.md"), "reader\n");
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Release test");
  git(repository, "config", "user.email", "release-test@example.com");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "release snapshot");
  git(repository, "tag", "apple-v2026.8.7");
  fs.writeFileSync(path.join(repository, "local-signing.txt"), "must not be archived\n");

  execFileSync("bash", [script, "apple-v2026.8.7", output], { cwd: repository });

  const archive = path.join(output, "reader-apple-2026.8.7-source.tar.gz");
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.match(entries, /^reader-2026\.8\.7\/apps\/ios\/project\.yml$/mu);
  assert.match(entries, /^reader-2026\.8\.7\/README\.md$/mu);
  assert.doesNotMatch(entries, /local-signing/u);
  execFileSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: output });
});
