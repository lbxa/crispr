import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ANATOMY_REGIONS } from "../src/anatomy";
import { inspectGlb } from "../src/glb";

interface GltfNode {
  extras?: Record<string, unknown>;
  mesh?: number;
  name?: string;
}

interface SegmentedGltf {
  nodes?: GltfNode[];
}

const models = [
  {
    filename: "realistic-male-segmented.glb",
    profile: "male",
  },
  {
    filename: "realistic-female-segmented.glb",
    profile: "female",
  },
] as const;

const expectedIds = new Set(ANATOMY_REGIONS.map(({ id }) => id));

for (const { filename, profile } of models) {
  const path = resolve(import.meta.dir, "..", "public/models/segmented", filename);
  const bytes = await readFile(path);
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const metadata = inspectGlb(data);
  const gltf = metadata.json as SegmentedGltf;
  const nodes = gltf.nodes ?? [];
  const proxyNodes = nodes.filter(
    ({ extras, name }) =>
      extras?.role === "anatomy_region_proxy" &&
      name?.startsWith("ANATOMY_REGION__"),
  );
  const embeddedIds = new Set(
    proxyNodes.flatMap(({ extras }) =>
      typeof extras?.region_id === "string" ? [extras.region_id] : [],
    ),
  );

  if (proxyNodes.length !== 27) {
    throw new Error(`${filename} has ${proxyNodes.length} proxies; expected 27.`);
  }
  if (
    embeddedIds.size !== expectedIds.size ||
    [...expectedIds].some((id) => !embeddedIds.has(id))
  ) {
    throw new Error(`${filename} does not contain the complete region catalog.`);
  }

  const body = nodes.find(
    ({ extras }) =>
      extras?.role === "anatomy_body" && extras.profile === profile,
  );
  if (!body || body.mesh === undefined) {
    throw new Error(`${filename} is missing its semantic body node.`);
  }

  console.log(
    `Verified ${filename}: ${embeddedIds.size} regions, ` +
      `${proxyNodes.length} proxies, ${(bytes.byteLength / 1_048_576).toFixed(1)} MB.`,
  );
}
