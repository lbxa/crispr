import { afterEach, expect, it, vi } from "vitest";
import { createReferenceLoader, REFERENCE_BLOCK } from "./reference";

afterEach(() => vi.unstubAllGlobals());

/** A fake reference where base i is "ACGT"[i % 4], served in whatever range is asked for. */
function serveReference(options: { failFirst?: boolean } = {}) {
  let failures = options.failFirst ? 1 : 0;
  const fetch = vi.fn(async (url: string) => {
    if (failures-- > 0) return new Response("down", { status: 503 });
    const { pathname, searchParams } = new URL(url, "http://localhost");
    const chromosome = pathname.split("/").at(-1)!;
    const start = Number(searchParams.get("start"));
    const end = Number(searchParams.get("end"));
    const bases = Array.from(
      { length: end - start },
      (_, i) => "ACGT"[(start + i) % 4],
    ).join("");
    return Response.json({ chromosome, start, end, bases });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const expected = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, i) => "ACGT"[(start + i) % 4]).join(
    "",
  );
const signal = () => new AbortController().signal;

it("reads aligned blocks once and reuses them across overlapping reads", async () => {
  const fetch = serveReference();
  const load = createReferenceLoader(new Map([["7", 10_000]]));
  // Crosses the first block boundary, so it needs blocks 0 and 1.
  const start = REFERENCE_BLOCK - 100;
  expect(await load("7", start, start + 300, signal())).toBe(
    expected(start, start + 300),
  );
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/reference/7?start=0&end=4096",
    "/api/reference/7?start=4096&end=8192",
  ]);
  expect(await load("7", 10, 600, signal())).toBe(expected(10, 600));
  expect(fetch).toHaveBeenCalledTimes(2); // served from the cached block
  // The last block stops at the chromosome's end.
  expect(await load("7", 9_990, 10_000, signal())).toBe(
    expected(9_990, 10_000),
  );
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "/api/reference/7?start=8192&end=10000",
  );
});

it("returns null while the reference is unavailable, then retries", async () => {
  const fetch = serveReference({ failFirst: true });
  const load = createReferenceLoader(new Map([["7", 10_000]]));
  expect(await load("7", 0, 50, signal())).toBeNull();
  expect(await load("7", 0, 50, signal())).toBe(expected(0, 50));
  expect(fetch).toHaveBeenCalledTimes(2);
  // Unknown chromosomes and out-of-range reads never reach the network.
  expect(await load("Y", 0, 50, signal())).toBeNull();
  expect(await load("7", 9_990, 10_001, signal())).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("rejects on the caller's abort without cancelling the shared block", async () => {
  const fetch = serveReference();
  const load = createReferenceLoader(new Map([["7", 10_000]]));
  const controller = new AbortController();
  const pending = load("7", 0, 50, controller.signal);
  controller.abort();
  await expect(pending).rejects.toBeDefined();
  expect(await load("7", 0, 50, signal())).toBe(expected(0, 50));
  expect(fetch).toHaveBeenCalledTimes(1);
});
