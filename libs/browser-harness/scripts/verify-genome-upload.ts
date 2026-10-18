import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "playwright";
import { z } from "zod";
import { BrowserHarnessRuntime } from "../src/browser-harness-runtime";
import { BrowserSession } from "../src/browser-session";
import { loadBrowserHarnessConfig } from "../src/config";

const { values } = parseArgs({
  options: {
    "app-url": { type: "string" },
    findings: { type: "boolean", default: false },
  },
});
const fixture = values.findings
  ? "synthetic-findings.vcf"
  : "synthetic-genome.vcf";
const appUrl = values["app-url"] ?? "http://localhost:3000";
const workspace = resolve(import.meta.dir, "../../..");
const runId = randomUUID();
const evidenceDir = `.harness/evidence/${runId}`;
const config = z.object({ api_url: z.url() }).parse(
  await (
    await fetch(new URL("/api/genome-uploads/config", appUrl), {
      signal: AbortSignal.timeout(15_000),
    })
  ).json(),
);
const apiOrigin = new URL(config.api_url).origin;
const harnessConfig = await loadBrowserHarnessConfig({
  workspace,
  appUrl,
  startApp: false,
  harnessRunId: runId,
  evidenceDir,
  testName: "direct-genome-upload",
});
let browser: Browser | undefined;
const browserSession = new BrowserSession(harnessConfig, async (options) => {
  browser = await chromium.launch(options);
  return browser;
});
const harness = new BrowserHarnessRuntime(
  harnessConfig,
  undefined,
  browserSession,
);
try {
  await harness.start();
  const page = browser?.contexts()[0]?.pages()[0];
  if (!page) throw new Error("The harness did not create its page");
  let uploadRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === apiOrigin ||
      url.pathname === "/api/genome-uploads/config"
    )
      uploadRequests++;
  });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  // The file pane starts open with an upload prompt and no genome.
  await harness.waitForText({ text: "Drop your genome" });
  await harness.setInputFiles({
    selector: 'input[type="file"]',
    path: `libs/browser-harness/fixtures/${fixture}`,
  });
  await harness.waitForText({ text: "Analysis complete", timeoutMs: 90_000 });
  await page
    .locator('[data-genome-cached="true"]')
    .waitFor({ state: "attached" });
  await harness.screenshot({ name: "genome-summary", fullPage: true });
  let requestsBeforeRefresh = uploadRequests;
  // A refresh starts fresh: the saved genome is discarded and nothing is re-fetched.
  await harness.open();
  await page
    .locator('[data-genome-cache-ready="true"]')
    .waitFor({ state: "attached" });
  await harness.waitForText({ text: "Drop your genome", timeoutMs: 15_000 });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  const fresh = await harness.snapshot();
  if (
    fresh.visibleText.includes("Analysis complete") ||
    uploadRequests !== requestsBeforeRefresh
  )
    throw new Error("A refresh did not start without the previous genome");
  await harness.screenshot({ name: "fresh-start", fullPage: true });
  await harness.setInputFiles({
    selector: 'input[type="file"]',
    path: `libs/browser-harness/fixtures/${fixture}`,
  });
  await harness.waitForText({ text: "Analysis complete", timeoutMs: 90_000 });
  await page
    .locator('[data-genome-cached="true"]')
    .waitFor({ state: "attached" });
  requestsBeforeRefresh = uploadRequests;
  // A completed analysis opens the genome explorer by itself.
  await harness.waitForText({ text: "3D DNA ready", timeoutMs: 60_000 });
  if (values.findings) {
    await harness.waitForText({ text: "117,559,590 bp" });
    const reference = await harness.snapshot();
    if (
      !reference.visibleText.includes("GRCh38") ||
      !reference.visibleText.includes("Carrier")
    )
      throw new Error(
        `Reference findings were not connected; inspect ${evidenceDir}`,
      );
    await harness.screenshot({ name: "cftr-deletion-map", fullPage: true });
    await harness.click({ selector: 'button[aria-label^="Inspect HBB at "]' });
    await harness.waitForText({ text: "5,227,002 bp" });
    await harness.click({
      selector: 'input[aria-label="Position in chromosome"]',
    });
    await harness.press({ key: "End" });
    await harness.waitForText({ text: "135,086,622 bp" });
    await harness.press({ key: "Home" });
    await harness.waitForText({ text: "1 bp" });
    await harness.click({ selector: 'button[aria-label^="Jump to HBB at "]' });
    await harness.waitForText({ text: "5,227,002 bp" });
    await harness.click({ selector: '[aria-label="DNA sequence"]' });
    await harness.press({ key: "ArrowDown" });
    await harness.waitForText({ text: "5,227,003 bp" });
    const scrolled = await harness.snapshot();
    // The harness's ARIA snapshot exposes the range's numeric, zero-based value.
    if (
      !/slider "Position in chromosome"[^\n]*: "5227002"/.test(
        scrolled.accessibilityTree,
      )
    )
      throw new Error(
        `DNA scrolling did not synchronize the minimap; inspect ${evidenceDir}`,
      );
    await harness.click({ selector: 'button[aria-label^="Jump to HBB at "]' });
    await harness.click({
      selector: 'button[aria-label="Unwind double helix"]',
    });
    await harness.waitForText({ text: "Flat ladder" });
    await harness.wait({ timeoutMs: 1200 });
    await harness.screenshot({ name: "hbb-finding-ladder", fullPage: true });
  }
  const panes = await harness.snapshot();
  if (!panes.accessibilityTree.includes('button "Left pane" [expanded]')) {
    await harness.click({ selector: 'button[aria-label="Left pane"]' });
  }
  await harness.waitForText({ text: "Analysis complete" });
  const snapshot = await harness.snapshot();
  // A known, not-yet-created tus resource is intentionally probed before POST.
  // Retain its 404 in raw evidence and allow only this precise protocol outcome.
  const initialProbes = snapshot.failedRequests.filter((entry) => {
    const url = new URL(entry.url);
    return (
      entry.method === "HEAD" &&
      entry.status === 404 &&
      url.origin === apiOrigin &&
      /^\/files\/[a-f0-9]{32}$/.test(url.pathname)
    );
  });
  const probeUrls = new Set(initialProbes.map(({ url }) => url));
  const unexpectedRequests = snapshot.failedRequests.filter(
    (entry) => !initialProbes.includes(entry),
  );
  const unexpectedConsole = snapshot.consoleErrors.filter(
    (entry) =>
      !probeUrls.has(entry.location?.url ?? "") || !entry.text.includes("404"),
  );
  if (
    initialProbes.length > 2 ||
    unexpectedRequests.length ||
    unexpectedConsole.length ||
    snapshot.pageErrors.length ||
    snapshot.runtimeExceptions.length ||
    !snapshot.visibleText.includes(fixture) ||
    !snapshot.visibleText.includes(
      values.findings
        ? "Disease-causing variants found"
        : "No genetic cause found",
    )
  )
    throw new Error(`Genome journey failed; inspect ${evidenceDir}`);
  await harness.click({ selector: 'button[aria-label="Remove genome"]' });
  await harness.waitForText({ text: "Drop your genome" });
  await harness.open();
  await page
    .locator('[data-genome-cache-ready="true"]')
    .waitFor({ state: "attached" });
  await harness.waitForText({ text: "Drop your genome" });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  const cleared = await harness.snapshot();
  if (
    cleared.visibleText.includes("Analysis complete") ||
    uploadRequests !== requestsBeforeRefresh ||
    cleared.failedRequests.length > snapshot.failedRequests.length ||
    cleared.consoleErrors.length > snapshot.consoleErrors.length ||
    cleared.pageErrors.length > snapshot.pageErrors.length ||
    cleared.runtimeExceptions.length > snapshot.runtimeExceptions.length
  )
    throw new Error("Removing the genome did not leave the page empty");
  await harness.screenshot({ name: "removed-genome", fullPage: true });
  const result = {
    success: true,
    harness_run_id: runId,
    evidence_dir: evidenceDir,
    expected_initial_tus_probes: initialProbes.length,
    findings_navigation: values.findings,
    fresh_start_after_refresh: true,
    cache_removal: true,
  };
  await Bun.write(
    resolve(workspace, evidenceDir, "verification-summary.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await harness.stop();
}
