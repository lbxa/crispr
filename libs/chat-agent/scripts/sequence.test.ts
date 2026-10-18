import assert from "node:assert/strict";
import { test } from "node:test";
import type { VariantLocus, VariantProps } from "../lib/graph/types";
import { getWindow } from "../lib/retrieval/helix";
import {
  EnsemblSequenceProvider,
  type SequenceWindow,
} from "../lib/sequence/provider";

// Mocked Ensembl responses: these exercise the provider's logic, not real sequence.
const locus: VariantLocus = {
  chrom: "7",
  pos: 101,
  ref: "TCT",
  alt: "",
  assembly: "GRCh38",
  verified: false,
};
const flank = 4;
const reply = (seq: string) =>
  (async () => new Response(JSON.stringify({ seq }))) as typeof fetch;

test("a matching reference allele yields a real Ensembl window", async () => {
  const p = new EnsemblSequenceProvider({ fetch: reply("ACGTTCTGGCA") });
  const w = await p.window(locus, flank);
  assert.equal(w.source, "ensembl-GRCh38");
  assert.equal(w.refCheck, "match");
  assert.equal(w.sequence, "ACGTGGCA");
});

test("a mismatching reference allele is never shown as real", async () => {
  const p = new EnsemblSequenceProvider({ fetch: reply("ACGTAAAGGCA") });
  const w = await p.window(locus, flank);
  assert.equal(w.source, "synthetic");
  assert.equal(w.refCheck, "mismatch");
  assert.match(w.note ?? "", /withheld/);
});

test("timeouts fall back to synthetic sequence and are not cached", async () => {
  let calls = 0;
  // What fetch throws when AbortSignal.timeout fires.
  const timeout = (async () => {
    calls++;
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as typeof fetch;
  const p = new EnsemblSequenceProvider({ fetch: timeout });
  const cache = new Map<string, SequenceWindow>();
  const props = { locus } as VariantProps;
  const w = await getWindow(p, cache, "var:x", props);
  assert.equal(w?.source, "synthetic");
  assert.equal(w?.transient, true);
  assert.match(
    w?.note ?? "",
    /Ensembl lookup failed \(The operation timed out/,
  );
  assert.equal(cache.size, 0);
  await getWindow(p, cache, "var:x", props);
  assert.equal(calls, 2, "a later turn retries Ensembl");
});

test("real windows are cached per variant", async () => {
  let calls = 0;
  const ok = (async (url: string) => {
    calls++;
    const [, range] = url.match(/:(\d+\.\.\d+):1/)!;
    const [a, b] = range!.split("..").map(Number);
    // Flanks of A around the stored reference allele at its real offset.
    const n = b! - a! + 1;
    const seq =
      "A".repeat(locus.pos - a!) +
      locus.ref +
      "A".repeat(n - (locus.pos - a!) - locus.ref.length);
    return new Response(JSON.stringify({ seq }));
  }) as typeof fetch;
  const p = new EnsemblSequenceProvider({ fetch: ok });
  const cache = new Map<string, SequenceWindow>();
  const props = { locus } as VariantProps;
  assert.equal(
    (await getWindow(p, cache, "var:y", props))?.source,
    "ensembl-GRCh38",
  );
  await getWindow(p, cache, "var:y", props);
  assert.equal(calls, 1, "the second turn is served from the cache");
});
