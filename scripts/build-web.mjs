// Bundles src/browser/engine.ts into web/engine.js, a plain script that
// sets window.ChordChartsEngine for web/app.js.
//
// The shared modules it pulls in (document.ts, bulk.ts, outputWriter.ts,
// chart.ts) also hold the CLI's file-reading and PNG-writing code paths,
// so they import `fs`, `path`, and `sharp`. The web UI never reaches
// those paths (src/api rejects every file-referencing field), so they're
// replaced here with stubs that throw if anything ever does call them.

import * as esbuild from "esbuild";

const NODE_ONLY = /^(fs|path|sharp)$/;

const nodeOnlyStubs = {
  name: "node-only-stubs",
  setup(build) {
    build.onResolve({ filter: NODE_ONLY }, (args) => ({ path: args.path, namespace: "node-only-stub" }));
    build.onLoad({ filter: /.*/, namespace: "node-only-stub" }, (args) => ({
      contents: `
        const fail = (name) => () => { throw new Error(name + " is not available in the browser"); };
        const stub = new Proxy(fail(${JSON.stringify(args.path)}), {
          get: (_, key) => (key === "__esModule" ? false : fail(${JSON.stringify(args.path)} + "." + String(key))),
        });
        module.exports = stub;
      `,
      loader: "js",
    }));
  },
};

await esbuild.build({
  entryPoints: ["src/browser/engine.ts"],
  outfile: "web/engine.js",
  bundle: true,
  format: "iife",
  globalName: "ChordChartsEngine",
  platform: "browser",
  target: ["es2020"],
  minify: process.argv.includes("--minify"),
  sourcemap: process.argv.includes("--minify") ? false : "inline",
  // csv-parse's default build relies on Node's Buffer; its browser build
  // bundles its own polyfill.
  alias: { "csv-parse/sync": "csv-parse/browser/esm/sync" },
  plugins: [nodeOnlyStubs],
  logLevel: "info",
});
