import * as esbuild from "esbuild";

const shared = {
  entryPoints: ["src/index.js"],
  bundle: true,
  sourcemap: true,
  minify: true,
  target: ["es2022"],
  platform: "neutral",
  logLevel: "info",
};

await Promise.all([
  esbuild.build({
    ...shared,
    format: "esm",
    outfile: "dist/node-game-ecs.js",
  }),
  esbuild.build({
    ...shared,
    format: "iife",
    globalName: "NodeGameECS",
    outfile: "dist/node-game-ecs.iife.js",
  }),
]);
