import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("an output path is required");

const [session, reactSpike] = await Promise.all([
  readFile(".build/packages/session-ts/src/session.js", "utf8"),
  readFile(".build/react-spike/react-spike.js", "utf8"),
]);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${session}\n${reactSpike}\n`);
