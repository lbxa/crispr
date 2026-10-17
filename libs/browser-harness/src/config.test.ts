import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadBrowserHarnessConfig } from "./config";

const tempDirs: string[] = [];

async function makeWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "browser-harness-config-"));
  tempDirs.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("loadBrowserHarnessConfig", () => {
  test("the repository profile starts Next.js with an overridden port and workspace evidence", async () => {
    const workspace = resolve(import.meta.dir, "../../..");
    const config = await loadBrowserHarnessConfig({
      workspace,
      configFile: "browser-harness.yaml",
      port: 3217,
      harnessRunId: "next-profile-test",
    });
    expect(config.appUrl).toBe("http://127.0.0.1:3217/");
    expect(config.appCommand).toContain("bun run --cwd apps/web dev");
    expect(config.observability.appName).toBe("web");
    expect(config.observability.harnessRunId).toBe("next-profile-test");
    expect(config.evidenceDir).toBe(join(workspace, ".harness/evidence/web"));
  });
  test("normalizes YAML config and explicit overrides", async () => {
    const workspace = await makeWorkspace();
    const configFile = join(workspace, "browser-harness.yaml");
    await writeFile(
      configFile,
      [
        "app_command: bun run dev",
        "app_url: http://127.0.0.1:${PORT}",
        "workspace: .",
        "port: 4102",
        "headless: false",
        "startup_timeout_ms: 1234",
        "evidence_dir: .harness/custom",
        "issue_id: issue-uuid-1",
        "issue_identifier: MT-620",
        "session_id: thread-1:turn-1",
        "viewport:",
        "  width: 800",
        "  height: 600",
      ].join("\n"),
    );

    const config = await loadBrowserHarnessConfig({
      configFile,
      workspace,
      headless: true,
    });

    expect(config.workspace).toBe(workspace);
    expect(config.appCommand).toBe("bun run dev");
    expect(config.appUrl).toBe("http://127.0.0.1:4102/");
    expect(config.headless).toBe(true);
    expect(config.startupTimeoutMs).toBe(1234);
    expect(config.viewport).toEqual({ width: 800, height: 600 });
    expect(config.evidenceDir).toBe(join(workspace, ".harness/custom"));
    expect(config.observability.issueId).toBe("issue-uuid-1");
    expect(config.observability.issueIdentifier).toBe("MT-620");
    expect(config.observability.sessionId).toBe("thread-1:turn-1");
  });

  test("rejects non-local app URLs by default", async () => {
    const workspace = await makeWorkspace();

    expect(
      loadBrowserHarnessConfig({
        appUrl: "https://example.com",
        startApp: false,
        workspace,
      }),
    ).rejects.toThrow("Only loopback URLs are allowed");
  });

  test("rejects evidence directories outside the workspace", async () => {
    const workspace = await makeWorkspace();

    expect(
      loadBrowserHarnessConfig({
        appUrl: "http://127.0.0.1:3000",
        evidenceDir: join(tmpdir(), "outside-evidence"),
        startApp: false,
        workspace,
      }),
    ).rejects.toThrow("Evidence directory must be inside workspace");
  });
});
