import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Frame, type Page } from "playwright";

/**
 * Browser check for /chat (the workbench iframe) against a running app. Runs at desktop
 * and phone widths in light and dark: first view, helix rotation and base inspector,
 * bubble and typed questions through /api/chat, panels moving aside, drawers, the
 * off-target chip staying visible, and no horizontal overflow.
 * Evidence: .harness/evidence/chat-<uuid>/.
 */
const { values } = parseArgs({
  options: { "app-url": { type: "string", default: "http://127.0.0.1:3000" } },
});
const appUrl = values["app-url"]!;
const evidenceDir = resolve(
  import.meta.dir,
  "../../..",
  ".harness/evidence",
  `chat-${randomUUID()}`,
);
await mkdir(evidenceDir, { recursive: true });

const MATRIX = [
  { name: "desktop-light", width: 1360, height: 820, colorScheme: "light" },
  { name: "desktop-dark", width: 1360, height: 820, colorScheme: "dark" },
  { name: "phone-light", width: 400, height: 800, colorScheme: "light" },
  { name: "phone-dark", width: 400, height: 800, colorScheme: "dark" },
] as const;
const BG = { light: "#e9eff2", dark: "#0a1317" };

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function noOverflow(page: Page, frame: Frame, step: string) {
  for (const [where, ctx] of [
    ["page", page.mainFrame()],
    ["workbench", frame],
  ] as const) {
    const [w, inner] = await ctx.evaluate(() => [
      document.documentElement.scrollWidth,
      innerWidth,
    ]);
    check(
      w <= inner,
      `${step}: ${where} overflows horizontally (${w} > ${inner})`,
    );
  }
}

/** True when some off-target chip is on screen and nothing covers its centre. */
async function offTargetVisible(frame: Frame) {
  return frame.evaluate(() =>
    [...document.querySelectorAll(".chip.danger")].some((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) return false;
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit === el || el.contains(hit);
    }),
  );
}

const helixFrame = (frame: Frame) =>
  frame.locator("#helix").evaluate((c: HTMLCanvasElement) => c.toDataURL());

const browser = await chromium.launch();
const report: Record<string, string[]> = {};
try {
  for (const combo of MATRIX) {
    const phone = combo.width <= 900;
    const steps: string[] = [];
    const problems: string[] = [];
    const context = await browser.newContext({
      viewport: { width: combo.width, height: combo.height },
      colorScheme: combo.colorScheme,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => {
      if (r.failure()?.errorText !== "net::ERR_ABORTED")
        problems.push(`requestfailed: ${r.url()}`);
    });
    const shot = (name: string) =>
      page.screenshot({ path: `${evidenceDir}/${combo.name}-${name}.png` });

    await page.goto(new URL("/chat", appUrl).toString());
    const frame = page.frameLocator('iframe[title="Crispr chat workbench"]');
    await frame.locator(".bubble").nth(2).waitFor({ timeout: 60_000 });
    const wb = page.frames().find((f) => f.url().includes("/workbench/"))!;
    const app = frame.locator("#app");

    // First view.
    check(
      (await app.getAttribute("data-mode")) === "first",
      "starts in the first view",
    );
    check(
      (await frame.locator(".chips").innerText()).includes(
        "not medical advice",
      ),
      "'not medical advice' shown",
    );
    check(
      await offTargetVisible(wb),
      "off-target chip visible in the first view",
    );
    const bg = await wb.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    );
    check(
      bg === BG[combo.colorScheme],
      `${combo.colorScheme} theme (--bg ${bg})`,
    );
    await noOverflow(page, wb, "first view");
    await shot("1-first-view");
    steps.push("first view");

    // Helix: rotates, and a clicked base opens the inspector (phones open the drawer first).
    if (phone) {
      await frame.locator("#rail .tab", { hasText: "Sequence" }).click();
      await page.waitForTimeout(450);
      check(
        (await app.getAttribute("data-open")) === "right",
        "Sequence drawer opens",
      );
      check(
        await offTargetVisible(wb),
        "off-target chip visible with the Sequence drawer open",
      );
    }
    const a = await helixFrame(wb);
    await page.waitForTimeout(400);
    check(a !== (await helixFrame(wb)), "helix rotates");
    await frame.locator("#helix").click();
    await frame.locator("#hx-sel .sel-h", { hasText: "pairs with" }).waitFor();
    await shot("2-helix-inspector");
    steps.push("helix rotates; base click opens inspector");
    if (phone) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      check(
        (await app.getAttribute("data-open")) === null,
        "Escape closes the drawer",
      );
    }

    // Bubble click: same path as typing; panels move aside, answer streams from /api/chat.
    const bubble = frame.locator(".bubble").first();
    const prompt = ((await bubble.textContent()) ?? "").replace(/^\d+/, "");
    const chatRequest = page.waitForRequest((r) =>
      r.url().endsWith("/api/chat"),
    );
    await bubble.click();
    const body = (await (await chatRequest).postDataJSON()) as {
      messages: Array<{ parts: Array<{ text?: string }> }>;
    };
    check(
      body.messages.at(-1)?.parts[0]?.text === prompt,
      "bubble posted its exact prompt to /api/chat",
    );
    check(
      (await app.getAttribute("data-mode")) === "chat",
      "panels move aside",
    );
    const ans = frame.locator(".turn").nth(0).locator(".ans");
    await ans
      .locator(".meta-row", { hasText: "cited" })
      .waitFor({ timeout: 60_000 });
    check(
      !(await ans.locator(".chip", { hasText: "demo answer" }).count()),
      "answer came from the server, not the demo fallback",
    );
    check(
      await offTargetVisible(wb),
      "off-target chip visible after an answer",
    );
    await noOverflow(page, wb, "chat view");
    await shot("3-bubble-answer");
    steps.push("bubble -> /api/chat answer; panels aside");

    // Every drawer keeps the off-target chip visible.
    const drawers = phone
      ? ["Visualisation", "Sequence"]
      : ["Visualisation", "Scores · Metrics", "Sequence"];
    for (const tab of drawers) {
      await frame.locator("#rail .tab", { hasText: tab }).click();
      await page.waitForTimeout(450);
      check(
        await offTargetVisible(wb),
        `off-target chip visible with ${tab} open`,
      );
      await noOverflow(page, wb, `${tab} drawer`);
      await shot(`4-drawer-${tab.split(" ")[0]!.toLowerCase()}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    if (!phone) {
      await frame.locator("#helix").click();
      await page.waitForTimeout(450);
      check(
        (await app.getAttribute("data-open")) === "right",
        "helix strip opens the sequence panel",
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    steps.push(`drawers (${drawers.join(", ")}) keep the chip visible`);

    // Typing works, and clicking the type bar returns to the first view first.
    await frame.locator("#q").click();
    check(
      (await app.getAttribute("data-mode")) === "first",
      "type bar returns to the first view",
    );
    await frame.locator("#q").fill("Tell me about the liver");
    await frame.locator("#q").press("Enter");
    const ans2 = frame.locator(".turn").nth(1).locator(".ans");
    await ans2
      .locator(".meta-row", { hasText: "cited" })
      .waitFor({ timeout: 60_000 });
    await shot("5-typed-question");
    steps.push("typed question answered");

    await noOverflow(page, wb, "end");
    report[combo.name] = steps;
    if (problems.length)
      throw new Error(`${combo.name}: ${problems.join("; ")}`);
    await context.close();
  }
  await writeFile(
    `${evidenceDir}/report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { success: true, evidence_dir: evidenceDir, report },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    `${evidenceDir}/report.json`,
    JSON.stringify({ report, error: String(error) }, null, 2),
  );
  console.error(
    JSON.stringify({
      success: false,
      evidence_dir: evidenceDir,
      error: String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
