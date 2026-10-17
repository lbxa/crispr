import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createBrowserHarness } from "@crispr/browser-harness";
import { z } from "zod";

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
const harness = await createBrowserHarness({
  workspace,
  appUrl,
  startApp: false,
  harnessRunId: runId,
  evidenceDir,
  testName: "direct-genome-upload",
});
try {
  await harness.start();
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  await harness.click({ selector: 'button[aria-label="Left pane"]' });
  await harness.setInputFiles({
    selector: 'input[type="file"]',
    path: `libs/browser-harness/fixtures/${fixture}`,
  });
  await harness.waitForText({ text: "Analysis complete", timeoutMs: 90_000 });
  await harness.screenshot({ name: "genome-summary", fullPage: true });
  await harness.click({ selector: 'button[aria-label="Right pane"]' });
  if (values.findings) {
    await harness.waitForText({ text: "3D DNA ready", timeoutMs: 60_000 });
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
  await harness.click({ selector: 'button[aria-label="Left pane"]' });
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
    initialProbes.length > 1 ||
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
  const result = {
    success: true,
    harness_run_id: runId,
    evidence_dir: evidenceDir,
    expected_initial_tus_probes: initialProbes.length,
    findings_navigation: values.findings,
  };
  await Bun.write(
    resolve(workspace, evidenceDir, "verification-summary.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await harness.stop();
}
