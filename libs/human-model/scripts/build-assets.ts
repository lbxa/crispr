import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, simplify, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist/assets");
await mkdir(output, { recursive: true });
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const manifest: Record<
  string,
  { file: string; bytes: number; sourceBytes: number }
> = {};

for (const profile of ["male", "female"] as const) {
  const source = Bun.file(
    resolve(root, `public/models/segmented/realistic-${profile}-segmented.glb`),
  );
  const document = await io.readBinary(
    new Uint8Array(await source.arrayBuffer()),
  );
  // These reference meshes have no textures. Remove unused UVs and split
  // normals before simplifying. Three.js rebuilds smooth normals on load.
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitive.setAttribute("TEXCOORD_0", null);
      primitive.setAttribute("NORMAL", null);
      primitive.setAttribute("TANGENT", null);
    }
  }
  // Runtime derivatives only: keep Blender exports and semantic proxy extras intact.
  await document.transform(
    dedup(),
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.15,
      error: 0.001,
      lockBorder: true,
    }),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  const bytes = await io.writeBinary(document);
  if (bytes.byteLength > 3 * 1024 * 1024)
    throw new Error(`${profile} exceeds the 3 MB runtime model budget`);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const file = `${profile}-${hash}.glb`;
  await writeFile(resolve(output, file), bytes);
  manifest[profile] = {
    file,
    bytes: bytes.byteLength,
    sourceBytes: source.size,
  };
  console.log(
    JSON.stringify({
      event: "human_model_asset_built",
      profile,
      ...manifest[profile],
    }),
  );
}
await writeFile(
  resolve(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const currentFiles = new Set([
  "manifest.json",
  ...Object.values(manifest).map(({ file }) => file),
]);
for (const name of await readdir(output)) {
  if (!currentFiles.has(name)) await rm(resolve(output, name), { force: true });
}
