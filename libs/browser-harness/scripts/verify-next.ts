import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { loadBrowserHarnessConfig } from "../src/index";
import { BrowserHarnessRuntime } from "../src/browser-harness-runtime";
import { EvidenceWriter } from "../src/evidence";

const workspace = resolve(import.meta.dir, "../../..");
const { values } = parseArgs({ options: { "app-url": { type: "string" } } });
const runId = randomUUID();
const evidenceDir = `.harness/evidence/${runId}`;
const config = await loadBrowserHarnessConfig({
  configFile: "browser-harness.yaml",
  workspace,
  harnessRunId: runId,
  evidenceDir,
  ...(values["app-url"] ? { appUrl: values["app-url"], startApp: false } : {}),
  ...(process.env.HARNESS_PORT
    ? { port: Number(process.env.HARNESS_PORT) }
    : {}),
});
const evidence = new EvidenceWriter(config.evidenceDir);
const harness = new BrowserHarnessRuntime(config);
const diagnostics = new Client({
  name: "crispr-browser-verification",
  version: "1.0.0",
});

await evidence.writeJson("run-context.json", config.observability);
let verifiedUrl: string;
try {
  await harness.start();
  await harness.waitForText({ text: "Gene editing workspace" });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  const initialSnapshot = await harness.snapshot();
  if (
    !initialSnapshot.accessibilityTree.includes(
      "Interactive realistic male human model",
    ) ||
    initialSnapshot.accessibilityTree.includes('group "Body profile"') ||
    !initialSnapshot.accessibilityTree.includes('link "Genome home"') ||
    initialSnapshot.accessibilityTree.includes('button "Regions"')
  ) {
    throw new Error(
      `Initial avatar or hidden developer controls failed; inspect ${evidenceDir}`,
    );
  }
  await harness.screenshot({ name: "next-home", fullPage: true });
  for (const side of ["Left", "Right"]) {
    const opposite = side === "Left" ? "Right" : "Left";
    const bothOpen = side === "Right" && config.viewport.width >= 1440;
    // The file pane starts open to invite an upload, so only the other pane needs opening.
    if (side !== "Left")
      await harness.click({ selector: `button[aria-label="${side} pane"]` });
    const paneSnapshot = await harness.snapshot();
    if (
      !paneSnapshot.accessibilityTree.includes(
        `region "${side} workspace pane"`,
      ) ||
      !paneSnapshot.accessibilityTree.includes(
        `button "${side} pane" [expanded]`,
      ) ||
      paneSnapshot.accessibilityTree.includes(
        `region "${opposite} workspace pane"`,
      ) !== bothOpen ||
      paneSnapshot.accessibilityTree.includes(
        `button "${opposite} pane" [expanded]`,
      ) !== bothOpen ||
      !paneSnapshot.accessibilityTree.includes(
        "Interactive realistic male human model",
      )
    ) {
      throw new Error(
        `Pane switch lost workspace state; inspect ${evidenceDir}`,
      );
    }
    await harness.wait({ timeoutMs: 800 });
    if (side === "Right") {
      await harness.waitForText({ text: "3D DNA ready", timeoutMs: 60_000 });
      await harness.click({ selector: '[aria-label="DNA sequence"]' });
      await harness.press({ key: "PageDown" });
      let scrolled = await harness.snapshot();
      // Native keyboard scrolling can finish late while both WebGL scenes render.
      for (
        let attempt = 0;
        attempt < 30 && scrolled.visibleText.includes("1,024,001 bp");
        attempt++
      ) {
        await harness.wait({ timeoutMs: 100 });
        scrolled = await harness.snapshot();
      }
      if (scrolled.visibleText.includes("1,024,001 bp")) {
        throw new Error(
          `DNA scrolling did not advance; inspect ${evidenceDir}`,
        );
      }
      // Click the middle of chromosome 1 on the karyotype; the helix slides there.
      await harness.click({ selector: '[data-testid="karyotype-1-maternal"]' });
      // The readout passes through intermediate values while the helix slides, so wait for
      // the same mid-chromosome position on two consecutive reads.
      const middle = /\b1[12]\d,\d{3},\d{3} bp/;
      let reached: string | undefined;
      let previous: string | undefined;
      for (let attempt = 0; attempt < 60; attempt++) {
        await harness.wait({ timeoutMs: 150 });
        const current = middle.exec(
          (await harness.snapshot()).visibleText,
        )?.[0];
        if (current && current === previous) {
          reached = current;
          break;
        }
        previous = current;
      }
      if (!reached) {
        throw new Error(
          `Clicking the karyotype did not move the helix; inspect ${evidenceDir}`,
        );
      }
      await harness.click({
        selector: 'button[aria-label="Unwind double helix"]',
      });
      await harness.waitForText({ text: "Flat ladder" });
      await harness.wait({ timeoutMs: 1400 });
      await harness.screenshot({ name: "dna-flat-ladder", fullPage: true });
      const ladder = await harness.snapshot();
      if (!ladder.visibleText.includes(reached)) {
        throw new Error(
          `Unwinding lost the genome position; inspect ${evidenceDir}`,
        );
      }
      await harness.click({ selector: '[aria-label="DNA sequence"]' });
      await harness.press({ key: "End" });
      await harness.waitForText({ text: "248,000,000 bp" });
      await harness.press({ key: "Home" });
      await harness.waitForText({ text: "1 bp" });
    }
    await harness.screenshot({
      name: `${side.toLowerCase()}-pane`,
      fullPage: true,
    });
    if (side === "Left") {
      if (!paneSnapshot.accessibilityTree.includes('group "Current date"')) {
        throw new Error(`Date widget is missing; inspect ${evidenceDir}`);
      }
      // Drag across the sidebar's clipping edge and capture the live top layer.
      await harness.pointer({ action: "move", x: 100, y: 86 });
      await harness.pointer({ action: "down" });
      await harness.pointer({ action: "move", x: 110, y: 86 });
      await harness.waitForText({ text: "Files picked up." });
      await harness.pointer({ action: "move", x: 620, y: 220, steps: 12 });
      await harness.screenshot({
        name: "widget-above-sidebar",
        fullPage: true,
      });
      await harness.pointer({ action: "up" });
      await harness.waitForText({
        text: "Files returned to its original position.",
      });
      await harness.click({
        selector: '[data-widget-id="files"] > span[aria-hidden="true"]',
      });
      await harness.press({ key: "Space" });
      await harness.waitForText({ text: "Files picked up." });
      await harness.press({ key: "ArrowRight" });
      await harness.press({ key: "Enter" });
      await harness.waitForText({ text: "Files moved to position 2 of 2." });
      await harness.press({ key: "Space" });
      await harness.press({ key: "Escape" });
      await harness.waitForText({
        text: "Files returned to its original position.",
      });
      const canceledWidget = await harness.snapshot();
      if (
        !canceledWidget.accessibilityTree.includes(
          'button "Left pane" [expanded]',
        )
      ) {
        throw new Error(
          `Widget cancellation dismissed its pane; inspect ${evidenceDir}`,
        );
      }
    }
  }
  await harness.press({ key: "Escape" });
  // Focus stays on the right toggle, so keyboard users can reopen it directly.
  await harness.press({ key: "Space" });
  await harness.waitForText({ text: "3D DNA ready" });
  await harness.waitForText({ text: "1 bp" });
  await harness.waitForText({ text: "Flat ladder" });
  await harness.click({ selector: 'button[aria-label="Rewind double helix"]' });
  const rewound = await harness.snapshot();
  if (!rewound.accessibilityTree.includes('heading "Double helix"')) {
    throw new Error(
      `DNA rewind did not restore helix mode; inspect ${evidenceDir}`,
    );
  }
  await harness.click({
    selector: 'button[aria-label="Right pane"][aria-expanded="true"]',
  });
  if (config.viewport.width >= 1440) {
    await harness.click({
      selector: 'button[aria-label="Left pane"][aria-expanded="true"]',
    });
  }
  const closedPanes = await harness.snapshot();
  if (closedPanes.accessibilityTree.includes("[expanded]")) {
    throw new Error(`Pane dismissal failed; inspect ${evidenceDir}`);
  }
  await diagnostics.connect(
    new StreamableHTTPClientTransport(new URL("/_next/mcp", config.appUrl)),
  );
  const { tools } = await diagnostics.listTools();
  await evidence.writeJson("next-tools.json", tools);
  for (const name of ["get_compilation_issues", "get_errors"]) {
    if (!tools.some((tool) => tool.name === name))
      throw new Error(`Next.js did not advertise ${name}`);
    const result = await diagnostics.callTool({ name, arguments: {} });
    await evidence.writeJson(`${name}.json`, result);
    if (result.isError)
      throw new Error(`Next.js ${name} failed; inspect ${evidenceDir}`);
    const content = z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .min(1)
      .parse(result.content);
    for (const entry of content) {
      const payload: unknown = JSON.parse(entry.text);
      // These schemas match the installed Next.js MCP tools. Unknown or error
      // responses fail closed rather than silently passing a diagnostic check.
      const schema =
        name === "get_errors"
          ? z.object({
              configErrors: z.array(z.unknown()).max(0),
              sessionErrors: z.array(z.unknown()).max(0),
            })
          : z.object({ issues: z.array(z.unknown()).max(0) });
      schema.parse(payload);
    }
  }
  const snapshot = await harness.snapshot();
  if (
    snapshot.consoleErrors.length ||
    snapshot.pageErrors.length ||
    snapshot.runtimeExceptions.length ||
    snapshot.failedRequests.length
  ) {
    throw new Error(`Browser diagnostics failed; inspect ${evidenceDir}`);
  }
  verifiedUrl = snapshot.url;
} finally {
  try {
    await diagnostics.close();
  } finally {
    await harness.stop();
  }
}
console.log(
  JSON.stringify({
    success: true,
    harness_run_id: runId,
    evidence_dir: evidenceDir,
    url: verifiedUrl,
  }),
);
