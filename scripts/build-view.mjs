import { build } from "esbuild";

await build({
  entryPoints: ["packages/view/src/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: true,
  outfile: ".build/view/view.js",
  legalComments: "none",
});
