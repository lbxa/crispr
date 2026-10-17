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
  await harness.click({ selector: 'button[popovertarget="anatomy-regions"]' });
  await harness.click({ selector: 'input[type="checkbox"][value="liver"]' });
  await harness.waitForText({ text: "1 region selected" });
  await harness.press({ key: "Escape" });
  await harness.screenshot({ name: "male-liver", fullPage: true });
  await harness.click({ selector: 'input[type="radio"][value="female"]' });
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  const femaleSnapshot = await harness.snapshot();
  if (
    !femaleSnapshot.accessibilityTree.includes(
      "Interactive realistic female human model",
    )
  ) {
    throw new Error(`Profile switch failed; inspect ${evidenceDir}`);
  }
  await harness.screenshot({ name: "next-home", fullPage: true });
  for (const side of ["Left", "Right"]) {
    await harness.click({ selector: `button[aria-label="${side} pane"]` });
    const paneSnapshot = await harness.snapshot();
    if (
      !paneSnapshot.accessibilityTree.includes(`region "${side} workspace pane"`) ||
      !paneSnapshot.accessibilityTree.includes(`button "${side} pane" [expanded]`) ||
      !paneSnapshot.accessibilityTree.includes("Interactive realistic female human model") ||
      !paneSnapshot.visibleText.includes("1 region selected")
    ) {
      throw new Error(`Pane switch lost workspace state; inspect ${evidenceDir}`);
    }
    await harness.wait({ timeoutMs: 800 });
    await harness.screenshot({ name: `${side.toLowerCase()}-pane`, fullPage: true });
  }
  await harness.press({ key: "Escape" });
  // Focus stays on the right toggle, so keyboard users can reopen it directly.
  await harness.press({ key: "Space" });
  await harness.click({
    selector: 'button[aria-label="Right pane"][aria-expanded="true"]',
  });
  const closedPanes = await harness.snapshot();
  if (closedPanes.accessibilityTree.includes("[expanded]")) {
    throw new Error(`Pane dismissal failed; inspect ${evidenceDir}`);
  }
  await harness.click({ selector: 'button[popovertarget="anatomy-regions"]' });
  await harness.click({ selector: "#anatomy-regions button" });
  await harness.waitForText({ text: "0 regions selected" });
  await harness.press({ key: "Escape" });
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
