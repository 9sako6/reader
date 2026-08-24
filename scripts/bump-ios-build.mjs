#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const projectSpecPath = process.argv[2] || "apps/ios/project.yml";
const projectSpec = readFileSync(projectSpecPath, "utf8");
const buildNumberPattern = /^([ \t]*CURRENT_PROJECT_VERSION:[ \t]*)([0-9]+)([ \t]*)$/gmu;
const buildNumberFields = [...projectSpec.matchAll(buildNumberPattern)];

if (buildNumberFields.length !== 1) {
  throw new Error(`expected exactly one CURRENT_PROJECT_VERSION in ${projectSpecPath}`);
}

const currentBuild = Number(buildNumberFields[0][2]);
if (!Number.isSafeInteger(currentBuild) || currentBuild < 1) {
  throw new Error(`invalid CURRENT_PROJECT_VERSION in ${projectSpecPath}`);
}

const nextBuild = currentBuild + 1;
writeFileSync(
  projectSpecPath,
  projectSpec.replace(buildNumberPattern, `$1${nextBuild}$3`),
);
process.stdout.write(`${nextBuild}\n`);
