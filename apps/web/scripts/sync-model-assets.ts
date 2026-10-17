import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "@crispr/human-model/asset-manifest";

const source = dirname(
  fileURLToPath(import.meta.resolve("@crispr/human-model/asset-manifest")),
);
const destination = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/models/human",
);
await mkdir(destination, { recursive: true });
for (const asset of Object.values(manifest)) {
  await copyFile(resolve(source, asset.file), resolve(destination, asset.file));
}
