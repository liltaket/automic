import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/extension", { recursive: true });
await mkdir("dist/simulator", { recursive: true });
await build({
  entryPoints: [
    "extension/content.ts",
    "extension/background.ts",
    "extension/popup.ts",
  ],
  outdir: "dist/extension",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: false,
});
await build({
  entryPoints: ["simulator/main.ts"],
  outfile: "dist/simulator/main.js",
  bundle: true,
  format: "esm",
  target: "es2022",
});
for (const name of ["manifest.json", "popup.html", "popup.css"])
  await copyFile(`extension/${name}`, `dist/extension/${name}`);
for (const name of ["index.html", "style.css"])
  await copyFile(`simulator/${name}`, `dist/simulator/${name}`);
console.log("Built dist/extension and dist/simulator");
