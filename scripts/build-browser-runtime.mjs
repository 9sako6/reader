import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: {
    module: "undefined",
    "process.env.NODE_ENV": '"production"',
  },
  outdir: ".build/browser-runtime",
  legalComments: "none",
};

await build({
  ...shared,
  entryPoints: {
    chrome: "apps/chrome/src/runtime.ts",
    safari: "apps/ios/ReaderExtension/Resources/viewer/runtime.ts",
  },
  minify: true,
});

await build({
  ...shared,
  entryPoints: {
    "service-worker": "apps/chrome/src/service-worker.ts",
  },
  minifySyntax: true,
  minifyWhitespace: true,
});
