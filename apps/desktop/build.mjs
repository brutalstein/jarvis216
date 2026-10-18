import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

process.chdir(dirname(fileURLToPath(import.meta.url)));
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["src/preload/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["src/renderer/app.ts", "src/renderer/overlay.ts", "src/renderer/styles.css"],
  bundle: true,
  platform: "browser",
  outdir: "dist",
  target: "chrome142",
  // Icons inline as SVG text; fonts ship beside the bundle so the CSP needs no remote origin.
  loader: { ".svg": "text", ".woff2": "file" },
  assetNames: "fonts/[name]-[hash]",
});
for (const name of ["index.html", "overlay.html"])
  await copyFile(`src/renderer/${name}`, `dist/${name}`);
