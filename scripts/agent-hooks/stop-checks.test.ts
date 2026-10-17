import { afterEach, expect, test } from "bun:test";
import { chmod, cp, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
const root = resolve(import.meta.dir, "../..");
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function stop(exitCode: number, active: boolean, wrapper = false) {
  const fixture = await mkdtemp(join(tmpdir(), "crispr-stop-test-"));
  fixtures.push(fixture);
  await mkdir(join(fixture, "scripts/agent-hooks"), { recursive: true });
  await mkdir(join(fixture, ".codex/hooks"), { recursive: true });
  await mkdir(join(fixture, "bin"));
  await cp(
    join(root, "scripts/agent-hooks/stop-checks.sh"),
    join(fixture, "scripts/agent-hooks/stop-checks.sh"),
  );
  await cp(
    join(root, ".codex/hooks/stop_checks.sh"),
    join(fixture, ".codex/hooks/stop_checks.sh"),
  );
  await cp(join(import.meta.dir, "fixtures/bun"), join(fixture, "bin/bun"));
  await chmod(join(fixture, "bin/bun"), 0o755);
  const child = Bun.spawn(
    [
      "bash",
      join(
        fixture,
        wrapper
          ? ".codex/hooks/stop_checks.sh"
          : "scripts/agent-hooks/stop-checks.sh",
      ),
    ],
    {
      cwd: tmpdir(),
      env: {
        ...process.env,
        PATH: `${fixture}/bin:${process.env.PATH}`,
        REAL_BUN: process.execPath,
        VERIFY_EXIT_CODE: String(exitCode),
      },
      stdin: new Response(JSON.stringify({ stop_hook_active: active })),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {
    code,
    result: JSON.parse(stdout),
    stderr,
    logs: await readdir(join(fixture, ".harness/verification")),
  };
}

test("successful verification permits Stop through the Codex adapter from another cwd", async () => {
  expect(await stop(0, false, true)).toMatchObject({
    code: 0,
    result: {},
    stderr: "",
  });
});
test("first failure requests repair and preserves diagnostics", async () => {
  const result = await stop(1, false);
  expect(result.result.decision).toBe("block");
  expect(result.stderr).toContain("fixture verification output");
  expect(result.logs).toHaveLength(1);
});
test("repeated failure reports the failure without an infinite continuation", async () => {
  const result = await stop(1, true);
  expect(result.result.decision).toBeUndefined();
  expect(result.result.systemMessage).toContain("still failing");
  expect(result.stderr).toContain("Verification log:");
});
