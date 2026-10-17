import { expect, test } from "bun:test";
import {
  BASE_PIXELS,
  DNA_BASES,
  clampGenomePosition,
  genomeScrollWindow,
  genomeSequenceRange,
  validateSequenceWindow,
} from "../src/dna-sequence";

test("native scroll coordinates remain bounded and reversible across a chromosome", () => {
  const length = 248_000_000;
  for (const position of [0, 1, 2048, 1_024_000.25, 100_000_000, length - 1]) {
    const window = genomeScrollWindow(position, length);
    expect(window.span * BASE_PIXELS).toBeLessThanOrEqual(81_920);
    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.start + window.span).toBeLessThan(length);
    expect(window.start + window.offset / BASE_PIXELS).toBeCloseTo(position);
  }
  expect(genomeScrollWindow(0, 1)).toEqual({ start: 0, span: 0, offset: 0 });
  expect(clampGenomePosition(Infinity, length)).toBe(0);
  expect(clampGenomePosition(-10, length)).toBe(0);
  expect(clampGenomePosition(length + 1, length)).toBe(length - 1);
});

test("sequence requests have bounded overscan and exclude positions beyond either end", () => {
  for (const position of [0, 512, 1_024_000, 247_999_999]) {
    const range = genomeSequenceRange(Math.floor(position / 512), 248_000_000);
    expect(range.start).toBeLessThanOrEqual(position);
    expect(range.end).toBeGreaterThan(position);
    expect(range.start).toBeGreaterThanOrEqual(0);
    expect(range.end).toBeLessThanOrEqual(248_000_000);
    expect(range.end - range.start).toBeLessThanOrEqual(1536);
  }
});

test("sequence boundaries validate length and alphabet and preserve complementary pairs", () => {
  expect(validateSequenceWindow("ACGTN", 10, 15)).toEqual({
    start: 10,
    bases: "ACGTN",
  });
  expect(() => validateSequenceWindow("AC", 0, 3)).toThrow();
  expect(() => validateSequenceWindow("AB", 0, 2)).toThrow();
  for (const base of ["A", "C", "G", "T", "N"] as const) {
    expect(DNA_BASES[DNA_BASES[base].complement].complement).toBe(base);
  }
});
