import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectGlb } from "../src/glb";

const MODELS = [
  { bodyName: "body_female_realistic", filename: "realistic-female.glb" },
  { bodyName: "body_male_realistic", filename: "realistic-male.glb" },
] as const;

for (const model of MODELS) {
  const modelPath = resolve(import.meta.dir, "..", "public/models", model.filename);
  const bytes = await readFile(modelPath);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const metadata = inspectGlb(data);
  const nodeNames = metadata.json.nodes?.flatMap((node) => node.name ?? []) ?? [];

  if (metadata.json.asset?.version !== "2.0") {
    throw new Error(`Expected glTF 2.0, received ${metadata.json.asset?.version ?? "unknown"}.`);
  }

  if (!nodeNames.some((name) => name.includes(model.bodyName))) {
    throw new Error(`${model.filename} does not contain ${model.bodyName}.`);
  }

  console.log(
    `Verified ${model.filename}: ${(bytes.byteLength / 1_048_576).toFixed(1)} MB, ` +
      `${metadata.json.meshes?.length ?? 0} meshes, ${nodeNames.length} named nodes.`,
  );
}
