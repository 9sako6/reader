import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(process.argv[3] ?? path.join(scriptDirectory, ".."));
const requestedVersion = process.argv[2];
const versionPattern = /^[0-9]{4}\.(?:[1-9]|1[0-2])\.(?:0|[1-9][0-9]*)$/u;

const projectSpecPath = path.join(repositoryRoot, "apps", "ios", "project.yml");
const chromeManifestPath = path.join(repositoryRoot, "apps", "chrome", "manifest.json");
const safariManifestPath = path.join(repositoryRoot, "apps", "ios", "ReaderExtension", "Resources", "manifest.json");

function readProjectVersion() {
  const projectSpec = fs.readFileSync(projectSpecPath, "utf8");
  const matches = [...projectSpec.matchAll(/^[ \t]*MARKETING_VERSION:[ \t]*([^\s]+)[ \t]*$/gmu)];
  if (matches.length !== 1) throw new Error(`expected exactly one MARKETING_VERSION in ${projectSpecPath}`);
  const version = matches[0][1];
  if (!versionPattern.test(version)) throw new Error(`invalid release version in ${projectSpecPath}: ${version}`);
  return version;
}

function readManifestVersion(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.version !== "string") throw new Error(`missing version in ${manifestPath}`);
  return manifest.version;
}

function replaceOne(source, pattern, replacement, filePath) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`expected exactly one version owner in ${filePath}`);
  return source.replace(pattern, replacement);
}

function writeProjectVersion(version) {
  const source = fs.readFileSync(projectSpecPath, "utf8");
  const updated = replaceOne(
    source,
    /^[ \t]*MARKETING_VERSION:[ \t]*[^\s]+[ \t]*$/gmu,
    `    MARKETING_VERSION: ${version}`,
    projectSpecPath,
  );
  fs.writeFileSync(projectSpecPath, updated);
}

function writeManifestVersion(manifestPath, version) {
  const source = fs.readFileSync(manifestPath, "utf8");
  const updated = replaceOne(
    source,
    /^(\s*"version":\s*")[^"]+(".*)$/gmu,
    `$1${version}$2`,
    manifestPath,
  );
  fs.writeFileSync(manifestPath, updated);
}

if (requestedVersion === "--check") {
  const projectVersion = readProjectVersion();
  const chromeVersion = readManifestVersion(chromeManifestPath);
  const safariVersion = readManifestVersion(safariManifestPath);
  if (chromeVersion !== projectVersion || safariVersion !== projectVersion) {
    throw new Error(`release versions differ: iOS=${projectVersion}, Chrome=${chromeVersion}, Safari=${safariVersion}`);
  }
  process.stdout.write(`${projectVersion}\n`);
} else {
  if (!versionPattern.test(requestedVersion ?? "")) throw new Error(`invalid release version: ${requestedVersion ?? ""}`);
  writeProjectVersion(requestedVersion);
  writeManifestVersion(chromeManifestPath, requestedVersion);
  writeManifestVersion(safariManifestPath, requestedVersion);
  process.stdout.write(`${requestedVersion}\n`);
}
