import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "playwright";
import { BrowserHarnessRuntime } from "../src/browser-harness-runtime";
import { BrowserSession } from "../src/browser-session";
import { loadBrowserHarnessConfig } from "../src/config";
import { EvidenceWriter } from "../src/evidence";

const { values } = parseArgs({
  options: { "app-url": { type: "string" }, genome: { type: "string" } },
});
const workspace = resolve(import.meta.dir, "../../..");
const runId = randomUUID();
const evidenceDir = `.harness/evidence/${runId}`;
const config = await loadBrowserHarnessConfig({
  workspace,
  harnessRunId: runId,
  evidenceDir,
  testName: "pku-body-map-rendering",
  ...(values["app-url"] ? { appUrl: values["app-url"], startApp: false } : {}),
});
let browser: Browser | undefined;
const session = new BrowserSession(config, async (options) => {
  browser = await chromium.launch(options);
  return browser;
});
const harness = new BrowserHarnessRuntime(config, undefined, session);
const evidence = new EvidenceWriter(config.evidenceDir);
await evidence.writeJson("run-context.json", config.observability);

try {
  await harness.start();
  const page = browser?.contexts()[0]?.pages()[0];
  if (!page) throw new Error("The harness did not create its page");
  await page.locator('[data-genome-cache-ready="true"]').waitFor();
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });

  if (values.genome) {
    // Use only public/synthetic fixtures, or an explicitly authorized genome.
    await harness.click({ selector: 'button[aria-label="Left pane"]' });
    await page
      .getByRole("button", { name: "Choose file", exact: true })
      .waitFor({ state: "visible" });
    await harness.setInputFiles({
      selector: 'input[type="file"]',
      path: values.genome,
    });
    await page
      .getByRole("button", { name: "Replace file", exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
    console.log(
      JSON.stringify({ event: "pku.upload_started", harness_run_id: runId }),
    );
    await Promise.race([
      harness.waitForText({ text: "Analysis complete", timeoutMs: 300_000 }),
      page
        .getByRole("group", { name: "Analysis summary" })
        .getByRole("alert")
        .waitFor({ state: "visible", timeout: 300_000 })
        .then(() => {
          throw new Error(
            `Genome upload or analysis failed; inspect ${evidenceDir}`,
          );
        }),
    ]);
    console.log(
      JSON.stringify({ event: "pku.analysis_complete", harness_run_id: runId }),
    );
    await page
      .getByRole("group", { name: "Analysis summary" })
      .getByText("Phenylketonuria")
      .waitFor();
    await page.locator('[data-genome-cached="true"]').waitFor();
  } else {
    // Legacy fixture intentionally has no body_map, matching the live backend.
    await page.evaluate(async () => {
      const request = indexedDB.open("crispr-genomes");
      const database = await new Promise<IDBDatabase>((accept, reject) => {
        request.onsuccess = () => accept(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction("genomes", "readwrite");
        transaction.objectStore("genomes").put(
          {
            version: 1,
            file: {
              name: "synthetic-pku.vcf",
              size: 100,
              type: "text/plain",
              lastModified: 0,
            },
            progress: {
              records_scanned: 2,
              variants_checked: 2,
              retained_variants: 2,
              uncompressed_bytes: 100,
            },
            report: {
              conclusion: {
                status: "genetic_finding",
                label: "Disease-causing variants found",
              },
              summary: {
                text: "Synthetic Phenylketonuria finding for avatar rendering verification.",
              },
              genome: {
                variants_checked: 2,
                panel_genes: ["PAH"],
                model_profile: "male",
              },
              findings: [
                { tier: "possible", gene: "PAH", disease: "Phenylketonuria" },
              ],
              disclaimer:
                "Synthetic browser fixture. Research prototype; not a medical diagnosis.",
            },
          },
          "current",
        );
        await new Promise<void>((accept, reject) => {
          transaction.oncomplete = () => accept();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    });
  }

  let analysisRequests = 0;
  page.on("request", (request) => {
    if (
      /\/uploads(?:\/|$)|\/api\/genome-uploads/.test(
        new URL(request.url()).pathname,
      )
    )
      analysisRequests++;
  });
  await harness.open();
  await harness.waitForText({ text: "shown in red" });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  const stage = page.locator('[aria-label="3D anatomy workspace"]');
  if ((await stage.getAttribute("data-phenotype")) === "none")
    throw new Error("Disease highlights were dimmed");
  const snapshot = await harness.snapshot();
  if (!snapshot.accessibilityTree.includes("Head & brain"))
    throw new Error("PKU's head/brain region was not accessible");

  const screenshot = await harness.screenshot({
    name: "pku-head-brain-red",
    fullPage: true,
  });
  // Inspect actual shader output using the browser's native PNG decoder.
  const pixels = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not inspect screenshot pixels");
      context.drawImage(bitmap, 0, 0);
      const { data, width, height } = context.getImageData(
        0,
        0,
        bitmap.width,
        bitmap.height,
      );
      let headRedPixels = 0;
      let otherRedPixels = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const red = data[offset]!;
        if (
          red > 140 &&
          red > data[offset + 1]! * 1.35 &&
          red > data[offset + 2]! * 1.35
        ) {
          const row = Math.floor(offset / 4 / width);
          if (row < height * 0.3) headRedPixels++;
          else otherRedPixels++;
        }
      }
      bitmap.close();
      return { headRedPixels, otherRedPixels };
    },
    Array.from(new Uint8Array(await Bun.file(screenshot.path).arrayBuffer())),
  );
  if (pixels.headRedPixels < 200 || pixels.otherRedPixels > 40) {
    throw new Error(
      `PKU highlight is not localized to the head: ${JSON.stringify(pixels)}; inspect ${evidenceDir}`,
    );
  }

  await harness.click({ selector: 'button[aria-label="Left pane"]' });
  await page
    .getByRole("group", { name: "Analysis summary" })
    .getByText("Phenylketonuria")
    .waitFor();
  await harness.screenshot({ name: "pku-finding-and-avatar", fullPage: true });
  await harness.click({ selector: 'button[aria-label="Remove genome"]' });
  await page.getByText(/shown in red/).waitFor({ state: "detached" });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  await harness.screenshot({ name: "body-map-removed", fullPage: true });
  const cleared = await harness.snapshot();
  // The tus client intentionally probes its not-yet-created resource once.
  const probes = cleared.failedRequests.filter(
    (entry) =>
      entry.method === "HEAD" &&
      entry.status === 404 &&
      /\/files\/[a-f0-9]{32}$/.test(new URL(entry.url).pathname),
  );
  const probeUrls = new Set(probes.map(({ url }) => url));
  const errors = cleared.consoleErrors.filter(
    (entry) =>
      !probeUrls.has(entry.location?.url ?? "") || !entry.text.includes("404"),
  );
  if (
    analysisRequests ||
    probes.length > (values.genome ? 1 : 0) ||
    errors.length ||
    cleared.pageErrors.length ||
    cleared.runtimeExceptions.length ||
    cleared.failedRequests.length !== probes.length
  ) {
    throw new Error(`Body map journey failed; inspect ${evidenceDir}`);
  }
  const result = {
    success: true,
    harness_run_id: runId,
    evidence_dir: evidenceDir,
    actual_genome_upload: Boolean(values.genome),
    carrier_association: snapshot.visibleText.includes("Carrier finding"),
    ...pixels,
    refresh_preserves_highlights: true,
    removal_clears_highlights: true,
  };
  await Bun.write(
    resolve(workspace, evidenceDir, "verification-summary.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await harness.stop();
}
