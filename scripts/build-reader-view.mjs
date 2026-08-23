import { build } from "esbuild";

await build({
  entryPoints: ["packages/reader-view/src/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: true,
  outfile: ".build/reader-view/reader-view.js",
  legalComments: "none",
});
