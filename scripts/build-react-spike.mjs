import { build } from "esbuild";

await build({
  entryPoints: ["packages/react-spike/src/react-spike.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: true,
  outfile: ".build/react-spike/react-spike.js",
  legalComments: "none",
});
