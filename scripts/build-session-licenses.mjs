import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}));
const tree = execFileSync("cargo", [
  "tree",
  "--locked",
  "--package",
  "reader-session",
  "--target",
  "wasm32-unknown-unknown",
  "--edges",
  "normal",
  "--format",
  "{p}",
], { cwd: repositoryRoot, encoding: "utf8" });
const packageKeys = new Set();
for (const line of tree.split("\n")) {
  const match = line.match(/\b([A-Za-z0-9_-]+) v([0-9][^ ()]+)/u);
  if (match) packageKeys.add(`${match[1]}@${match[2]}`);
}

const packages = new Map(metadata.packages.map((item) => [`${item.name}@${item.version}`, item]));
const selectedPackages = [...packageKeys]
  .map((key) => packages.get(key))
  .filter((item) => item)
  .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
const licenseTexts = new Map();
const packageNotices = [];

for (const item of selectedPackages) {
  const packageRoot = dirname(item.manifest_path);
  const entries = await readdir(packageRoot);
  const licenseNames = [];
  for (const name of entries.filter((entry) => /^(?:LICENSE|COPYING|NOTICE)/iu.test(entry)).sort()) {
    const path = join(packageRoot, name);
    if ((await stat(path)).isFile()) licenseNames.push(name);
  }
  if (item.name === "reader-session" && licenseNames.length === 0) {
    licenseNames.push("LICENSE (repository)");
    const text = await readFile(join(repositoryRoot, "LICENSE"), "utf8");
    licenseTexts.set(text, { names: ["reader-session/LICENSE"], text });
  }
  const sources = [];
  for (const name of licenseNames) {
    if (name === "LICENSE (repository)") continue;
    const text = await readFile(join(packageRoot, name), "utf8");
    if (!licenseTexts.has(text)) licenseTexts.set(text, { names: [], text });
    licenseTexts.get(text).names.push(`${item.name}@${item.version}/${name}`);
    sources.push(name);
  }
  packageNotices.push([
    `${item.name}@${item.version}`,
    `Declared license: ${item.license || "not declared"}`,
    `License files: ${sources.length > 0 ? sources.join(", ") : "see the license text section below"}`,
  ].join("\n"));
}

const sections = [
  "ReaderSession WASM dependency notices",
  "Generated from Cargo.lock and the wasm32-unknown-unknown normal dependency tree.",
  "",
  ...packageNotices,
  "",
  ...[...licenseTexts.values()].map(({ names, text }) => `----- ${names.join(", ")} -----\n${text.trim()}`),
  "",
];
const outputDirectory = resolve(repositoryRoot, ".build/session-licenses");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "reader-session-dependencies.txt"), `${sections.join("\n\n")}\n`);
