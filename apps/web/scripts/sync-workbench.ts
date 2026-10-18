import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The /chat iframe page is built by @crispr/chat-agent; serve the built copy.
const source = fileURLToPath(
  import.meta.resolve("@crispr/chat-agent/workbench.html"),
);
const destination = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/workbench/index.html",
);
await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
