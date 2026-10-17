import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EvidenceWriter } from "./evidence";

const tempDirs: string[] = [];

async function makeEvidenceDir() {
  const workspace = await mkdtemp(join(tmpdir(), "browser-harness-evidence-"));
  tempDirs.push(workspace);
  return join(workspace, ".harness/evidence");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("EvidenceWriter", () => {
  test("writes JSON evidence", async () => {
    const writer = new EvidenceWriter(await makeEvidenceDir());

    const path = await writer.writeJson("final-snapshot.json", {
      success: true,
      url: "http://127.0.0.1:3000/",
    });

    const contents = await readFile(path, "utf8");
    expect(JSON.parse(contents)).toEqual({
      success: true,
      url: "http://127.0.0.1:3000/",
    });
  });

  test("sanitizes screenshot names", async () => {
    const writer = new EvidenceWriter(await makeEvidenceDir());

    const path = await writer.screenshotPath("../after send!");

    expect(path.endsWith("after-send.png")).toBe(true);
  });
});
