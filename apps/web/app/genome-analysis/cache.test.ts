import "fake-indexeddb/auto";
import { createStore, get, set, type UseStore } from "idb-keyval";
import { describe, expect, it } from "vitest";
import { CurrentGenomeCache } from "./cache";
import { detailedReport, report } from "./report.fixture";
import { uploadJob } from "./upload.fixture";

const file = new File(["genome data"], "sample.vcf", {
  type: "application/vcf",
  lastModified: 1000,
});
const complete = {
  status: "complete" as const,
  file,
  report,
  progress: {
    records_scanned: 100,
    variants_checked: 100,
    retained_variants: 1,
    uncompressed_bytes: 2048,
  },
};

describe("current genome cache", () => {
  it("preserves detailed evidence and edit results across a cache round trip", async () => {
    const cache = new CurrentGenomeCache(
      createStore(`cache-${crypto.randomUUID()}`, "genomes"),
    );
    await cache.remember({ ...complete, report: detailedReport });
    const restored = await cache.restore();
    expect(restored?.report.findings[0]?.genotype).toEqual(
      detailedReport.findings[0]?.genotype,
    );
    expect(restored?.report.findings[0]?.crispr).toEqual(
      detailedReport.findings[0]?.crispr,
    );
  });
  it("restores the analyzed genome without storing raw file bytes or upload capabilities", async () => {
    // Arrange
    const store = createStore(`cache-${crypto.randomUUID()}`, "genomes");
    const cache = new CurrentGenomeCache(store);

    // Act
    await cache.remember(complete);
    const stored = await get<unknown>("current", store);
    const restored = await cache.restore();

    // Assert
    const fileInfo = {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    };
    expect(stored).toEqual({
      version: 1,
      file: fileInfo,
      report,
      progress: complete.progress,
    });
    expect(restored).toEqual({ ...complete, file: fileInfo });
    expect(restored?.file).not.toBeInstanceOf(Blob);
  });

  it.each([
    { version: 2, report },
    { version: 1, file: { name: "broken.vcf" }, report },
    { version: 1, ...uploadJob(1) },
  ])(
    "ignores incompatible or corrupt records instead of inventing a report",
    async (invalid) => {
      // Arrange
      const store = createStore(`cache-${crypto.randomUUID()}`, "genomes");
      const cache = new CurrentGenomeCache(store);
      await set("current", invalid, store);

      // Act
      const restored = await cache.restore();

      // Assert
      expect(restored).toBeNull();
    },
  );

  it("keeps the latest replacement and removal atomic across overlapping writes", async () => {
    // Arrange
    const cache = new CurrentGenomeCache(
      createStore(`cache-${crypto.randomUUID()}`, "genomes"),
    );
    const replacement = {
      ...complete,
      file: new File(["new genome"], "new.vcf"),
    };

    // Act
    await Promise.all([
      cache.remember(complete),
      cache.remember(replacement),
      cache.forget(),
    ]);

    // Assert
    expect(await cache.restore()).toBeNull();
  });

  it("surfaces unavailable storage so the workspace can explain that refresh recovery failed", async () => {
    // Arrange
    const unavailable: UseStore = () =>
      Promise.reject(
        new DOMException("Storage unavailable", "QuotaExceededError"),
      );
    const cache = new CurrentGenomeCache(unavailable);

    // Act + Assert
    await expect(cache.remember(complete)).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
  });
});
