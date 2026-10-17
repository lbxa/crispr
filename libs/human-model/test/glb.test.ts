import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectGlb } from "../src/glb";

const MODEL_CASES = [
  {
    bodyName: "body_female_realistic",
    filename: "realistic-female.glb",
    label: "female",
  },
  {
    bodyName: "body_male_realistic",
    filename: "realistic-male.glb",
    label: "male",
  },
] as const;

describe("realistic body GLBs", () => {
  for (const model of MODEL_CASES) {
    test(`${model.label} model contains a body and two eye meshes`, async () => {
      const path = resolve(import.meta.dir, `../public/models/${model.filename}`);
      const bytes = await readFile(path);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const metadata = inspectGlb(data);
      const names = metadata.json.nodes?.flatMap((node) => node.name ?? []) ?? [];

      expect(metadata.version).toBe(2);
      expect(metadata.declaredLength).toBe(bytes.byteLength);
      expect(metadata.json.asset?.version).toBe("2.0");
      expect(metadata.json.meshes?.length).toBe(3);
      expect(names.some((name) => name.includes(model.bodyName))).toBe(true);
      expect(names.filter((name) => name.includes("eye")).length).toBeGreaterThanOrEqual(2);
    });
  }
});
