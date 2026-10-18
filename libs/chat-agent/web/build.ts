/**
 * Builds the self-contained workbench page: bundles web/page.ts and inlines it into
 * web/template.html. Output: dist/workbench/index.html, which apps/web copies to
 * public/workbench/ (served at /chat through an iframe).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist/workbench/index.html");

const result = await Bun.build({
  entrypoints: [resolve(root, "web/page.ts")],
  format: "iife",
  target: "browser",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("workbench bundle failed");
}
const bundle = (await result.outputs[0]!.text()).replaceAll("</", "<\\/");
const template = await readFile(resolve(root, "web/template.html"), "utf8");
if (!template.includes("/*ENGINE*/"))
  throw new Error("web/template.html has no /*ENGINE*/ slot");
await mkdir(resolve(root, "dist/workbench"), { recursive: true });
await writeFile(
  out,
  template.replace("/*ENGINE*/", () => bundle),
);
console.log(
  `Built ${out} (${Math.round((await readFile(out)).length / 1024)} kB)`,
);
