import { z } from "zod";

import { HarnessError } from "./errors";
import type { BrowserHarness, BrowserToolResult } from "./types";

const openSchema = z.object({ url: z.string().optional() }).optional();
const clickSchema = z.object({
  selector: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});
const typeSchema = z.object({
  selector: z.string(),
  text: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});
const pressSchema = z.object({ key: z.string() });
const waitSchema = z.object({ timeoutMs: z.number().int().nonnegative() });
const waitForTextSchema = z.object({
  text: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});
const waitForUrlSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  url: z.string(),
});
const screenshotSchema = z
  .object({
    fullPage: z.boolean().optional(),
    name: z.string().optional(),
  })
  .optional();

export async function runBrowserTool(
  harness: BrowserHarness,
  method: string,
  params: unknown,
): Promise<BrowserToolResult> {
  switch (method) {
    case "browser.open":
      return harness.open(openSchema.parse(params));
    case "browser.snapshot":
      return harness.snapshot();
    case "browser.click":
      return harness.click(clickSchema.parse(params));
    case "browser.type":
      return harness.type(typeSchema.parse(params));
    case "browser.press":
      return harness.press(pressSchema.parse(params));
    case "browser.wait":
      return harness.wait(waitSchema.parse(params));
    case "browser.waitForText":
      return harness.waitForText(waitForTextSchema.parse(params));
    case "browser.waitForUrl":
      return harness.waitForUrl(waitForUrlSchema.parse(params));
    case "browser.screenshot":
      return harness.screenshot(screenshotSchema.parse(params));
    case "browser.console":
      return harness.console();
    case "browser.network":
      return harness.network();
    case "browser.close":
      return harness.close();
    default:
      throw new HarnessError(
        "unsupported_method",
        `Unsupported method: ${method}`,
      );
  }
}
