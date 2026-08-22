import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const port = Number(process.env.READER_E2E_PORT) || 4173;
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
]);
const immediateImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const intrinsicImages = new Map([
  ["/image/vertical.png", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="1200" viewBox="0 0 240 1200"><rect width="240" height="1200" fill="#4ba9c7"/></svg>'],
  ["/image/horizontal.png", '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240" viewBox="0 0 1200 240"><rect width="1200" height="240" fill="#4ba9c7"/></svg>'],
  ["/image/transparent.png", '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"/>'],
  ["/image/huge.png", '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000" viewBox="0 0 4000 3000"><rect width="4000" height="3000" fill="#4ba9c7"/></svg>'],
]);

createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", "http://localhost");
  const pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/image/missing.png") {
    response.writeHead(404).end();
    return;
  }
  if (pathname === "/image/broken.png") {
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end("not an image");
    return;
  }
  if ([
    "/image/immediate.png",
    "/image/delayed.png",
    "/image/vertical.png",
    "/image/horizontal.png",
    "/image/transparent.png",
    "/image/huge.png",
  ].includes(pathname) || pathname.startsWith("/image/delayed/")) {
    const configuredDelayValue = requestUrl.searchParams.get("delay");
    const configuredDelay = configuredDelayValue === null ? Number.NaN : Number(configuredDelayValue);
    const delay = Number.isFinite(configuredDelay) && configuredDelay >= 0
      ? configuredDelay
      : (pathname.endsWith("delayed.png") || pathname.startsWith("/image/delayed/")) ? 500 : 0;
    if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    const intrinsicImage = intrinsicImages.get(pathname);
    if (intrinsicImage !== undefined) {
      response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" }).end(intrinsicImage);
      return;
    }
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(immediateImage);
    return;
  }
  const filePath = resolve(repositoryRoot, `.${pathname}`);
  if (!filePath.startsWith(`${repositoryRoot}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1");
