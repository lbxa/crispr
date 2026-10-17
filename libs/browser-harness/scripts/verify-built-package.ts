import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const packageRoot = resolve(import.meta.dir, "..");
const packageManifestSchema = z.object({
  bin: z
    .object({
      "browser-harness": z.literal("./dist/cli.js"),
    })
    .strict(),
  exports: z
    .object({
      ".": z
        .object({
          bun: z.literal("./dist/index.js"),
          types: z.literal("./dist/index.d.ts"),
        })
        .strict(),
    })
    .passthrough(),
});
const packageManifest = packageManifestSchema.parse(
  JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")),
);

const cliPath = resolve(packageRoot, packageManifest.bin["browser-harness"]);
const [shebang] = (await readFile(cliPath, "utf8")).split("\n");
if (shebang !== "#!/usr/bin/env bun") {
  throw new Error(
    `The built browser-harness CLI must use the Bun shebang; received ${shebang}.`,
  );
}

const browserHarness: unknown = await import("@crispr/browser-harness");
if (
  typeof browserHarness !== "object" ||
  browserHarness === null ||
  typeof Reflect.get(browserHarness, "createBrowserHarness") !== "function"
) {
  throw new Error(
    "The built @crispr/browser-harness Bun export does not expose createBrowserHarness.",
  );
}

const cli = Bun.spawn({
  cmd: [globalThis.process.execPath, cliPath, "--help"],
  stderr: "pipe",
  stdout: "pipe",
});
const [exitCode, stderr, stdout] = await Promise.all([
  cli.exited,
  new Response(cli.stderr).text(),
  new Response(cli.stdout).text(),
]);

if (exitCode !== 0 || !stdout.includes("Run a local web app in Chromium")) {
  throw new Error(
    `The built browser-harness CLI smoke check failed (${exitCode}): ${stderr}`,
  );
}
