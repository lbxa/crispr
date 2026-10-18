import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBrowserHarness } from "./index";
import { runBrowserHarnessEnvironmentSmoke } from "./environment-smoke";

const tempDirs: string[] = [];
let server: Server | undefined;
const environmentSmoke = await runBrowserHarnessEnvironmentSmoke();
const integrationBlocker = environmentSmoke.success
  ? undefined
  : environmentSmoke.error.code;

async function makeWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "browser-harness-int-"));
  tempDirs.push(workspace);
  return workspace;
}

async function startFixtureServer() {
  const selectedServer = createServer((request, response) => {
    if (request.url === "/missing") {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("boom");
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
      <title>Harness Fixture</title>
      <button id="fail">Fail</button>
      <input id="genome" type="file" />
      <output id="selected-file">No file</output>
      <output id="pointer-events"></output>
      <script>
        console.error("fixture console error");
        document.querySelector("#fail").addEventListener("click", () => {
          fetch("/missing").catch(() => {});
        });
        document.querySelector("#genome").addEventListener("change", (event) => {
          document.querySelector("#selected-file").textContent = event.target.files[0]?.name ?? "No file";
        });
        for (const type of ["pointerdown", "pointermove", "pointerup"]) {
          document.addEventListener(type, (event) => {
            document.querySelector("#pointer-events").textContent = type + ":" + event.clientX + "," + event.clientY + ":" + event.buttons;
          });
        }
      </script>`);
  });

  await new Promise<void>((resolve, reject) => {
    selectedServer.once("error", reject);
    selectedServer.listen(0, "127.0.0.1", () => {
      selectedServer.off("error", reject);
      resolve();
    });
  });

  const address = selectedServer.address();
  if (typeof address === "string" || address === null) {
    selectedServer.close();
    throw new Error("Fixture server did not bind to a TCP port");
  }

  server = selectedServer;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe.skipIf(Boolean(integrationBlocker))(
  integrationBlocker
    ? `browser harness integration skipped: ${integrationBlocker}`
    : "browser harness integration",
  () => {
    test("keeps the pointer held between moves so drag evidence can be captured", async () => {
      const harness = await createBrowserHarness({
        workspace: await makeWorkspace(),
        appUrl: await startFixtureServer(),
        startApp: false,
      });
      try {
        await harness.start();
        await harness.pointer({ action: "move", x: 100, y: 100 });
        await harness.pointer({ action: "down" });
        await harness.pointer({ action: "move", x: 600, y: 300, steps: 10 });
        expect((await harness.snapshot()).visibleText).toContain(
          "pointermove:600,300:1",
        );
        await harness.pointer({ action: "up" });
        expect((await harness.snapshot()).visibleText).toContain(
          "pointerup:600,300:0",
        );
      } finally {
        await harness.stop();
      }
    }, 30000);

    test("uploads workspace fixtures and rejects files or symlinks outside the workspace", async () => {
      const workspace = await makeWorkspace();
      const outside = await makeWorkspace();
      await Bun.write(join(workspace, "demo.vcf"), "##fileformat=VCFv4.2\n");
      await Bun.write(join(outside, "outside.vcf"), "outside fixture");
      await symlink(
        join(outside, "outside.vcf"),
        join(workspace, "escape.vcf"),
      );
      const harness = await createBrowserHarness({
        workspace,
        appUrl: await startFixtureServer(),
        startApp: false,
      });
      try {
        await harness.start();
        await harness.setInputFiles({ selector: "#genome", path: "demo.vcf" });
        await harness.waitForText({ text: "demo.vcf" });
        for (const path of [
          join(outside, "outside.vcf"),
          "escape.vcf",
          workspace,
        ]) {
          await expect(
            harness.setInputFiles({ selector: "#genome", path }),
          ).rejects.toMatchObject({ code: "invalid_config" });
        }
        expect((await harness.snapshot()).visibleText).toContain("demo.vcf");
      } finally {
        await harness.stop();
      }
    }, 30000);

    test("captures snapshot, screenshot, console, network, and evidence", async () => {
      const workspace = await makeWorkspace();
      const appUrl = await startFixtureServer();
      const harness = await createBrowserHarness({
        appUrl,
        evidenceDir: ".harness/evidence",
        headless: true,
        startApp: false,
        workspace,
      });

      await harness.start();
      const snapshot = await harness.snapshot();
      await harness.click({ selector: "#fail" });
      await harness.wait({ timeoutMs: 250 });
      const screenshot = await harness.screenshot({ name: "after failure" });
      await harness.stop();

      expect(snapshot.title).toBe("Harness Fixture");
      expect(snapshot.visibleText).toContain("Fail");
      expect(snapshot.consoleErrors.length).toBeGreaterThan(0);
      expect(screenshot.path.endsWith("after-failure.png")).toBe(true);

      const finalSnapshot = await readFile(
        join(workspace, ".harness/evidence/final-snapshot.json"),
        "utf8",
      );
      expect(JSON.parse(finalSnapshot).url).toBe(`${appUrl}/`);
    }, 30000);
  },
);
