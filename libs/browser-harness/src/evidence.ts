import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class EvidenceWriter {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async writeJson(name: string, value: unknown) {
    await this.ensureDir();
    const path = join(this.dir, name);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return path;
  }

  async screenshotPath(name = "screenshot") {
    await this.ensureDir();
    return join(this.dir, `${sanitizeEvidenceName(name)}.png`);
  }

  private async ensureDir() {
    await mkdir(this.dir, { recursive: true });
  }
}

export function sanitizeEvidenceName(value: string) {
  const basename = value.split(/[\\/]/).at(-1) ?? "screenshot";
  const sanitized = basename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "screenshot";
}
