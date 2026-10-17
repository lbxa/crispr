import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import manifest from "../dist/assets/manifest.json";

for (const profile of ["male", "female"] as const) {
  test(`${profile} runtime asset stays small and preserves anatomy semantics`, async () => {
    const asset = manifest[profile];
    expect(asset.bytes).toBeLessThan(3 * 1024 * 1024);
    expect(asset.bytes / asset.sourceBytes).toBeLessThan(0.1);
    const path = resolve(import.meta.dir, "../dist/assets", asset.file);
    expect(Bun.file(path).size).toBe(asset.bytes);
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.read(path);
    const nodes = doc.getRoot().listNodes();
    expect(
      nodes.filter((node) => node.getExtras().role === "anatomy_region_proxy"),
    ).toHaveLength(27);
    expect(nodes.some((node) => node.getExtras().role === "anatomy_body")).toBe(
      true,
    );
    expect(
      nodes.filter((node) =>
        node.getName().startsWith(`WEB_AUX__${profile}__`),
      ),
    ).toHaveLength(2);
  });
}
