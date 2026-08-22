export {};

const assert = require("node:assert/strict");
const { createServer, request } = require("node:http");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

async function findFreePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`server did not become ready: ${url}`);
}

async function rawStatus(port, path) {
  return new Promise((resolve, reject) => {
    const client = request({ hostname: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    client.once("error", reject);
    client.end();
  });
}

test("paired performance server isolates baseline assets and rejects traversal", async () => {
  const baselineRoot = await mkdtemp(join(tmpdir(), "reader-performance-baseline-"));
  const port = await findFreePort();
  const serverProcess = spawn(process.execPath, ["tests/e2e/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, READER_E2E_PORT: String(port), READER_E2E_BASELINE_ROOT: baselineRoot },
    stdio: "ignore",
  });
  try {
    await writeFile(join(baselineRoot, "sentinel.js"), "baseline sentinel");
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/tests/e2e/fixtures/performance.html`);

    const baselineResponse = await fetch(`${baseUrl}/__reader-baseline__/sentinel.js`);
    assert.equal(baselineResponse.status, 200);
    assert.equal(await baselineResponse.text(), "baseline sentinel");

    assert.equal(await rawStatus(port, "/__reader-baseline__/%2e%2e/%2e%2e/etc/passwd"), 403);
  } finally {
    serverProcess.kill();
    await rm(baselineRoot, { recursive: true, force: true });
  }
});
