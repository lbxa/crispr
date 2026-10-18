import type { VariantProps } from '../graph/types';
import type { Guide } from '../metrics/guides';
import type { HelixMark, HelixPayload } from '../ui/payload';
import type { SequenceProvider, SequenceWindow } from '../sequence/provider';

/** Fetch (and memoise per variant) the sequence window the helix and guide design share. */
export async function getWindow(
  provider: SequenceProvider,
  cache: Map<string, SequenceWindow>,
  variantId: string,
  variant: VariantProps,
): Promise<SequenceWindow | null> {
  if (!variant.locus) return null;
  const hit = cache.get(variantId);
  if (hit) return hit;
  const w = await provider.window(variant.locus);
  cache.set(variantId, w);
  return w;
}

export function makeHelix(label: string, variant: VariantProps, w: SequenceWindow, best?: Guide): HelixPayload {
  const marks: HelixMark[] = [
    {
      kind: w.variantStart === w.variantEnd ? 'deletion_junction' : 'variant',
      start: w.variantStart,
      end: w.variantEnd,
      label,
    },
  ];
  if (best) {
    marks.push(
      { kind: 'guide', start: best.start, end: best.end, label: `guide ${best.rank}`, strand: best.strand },
      { kind: 'pam', start: best.pamStart, end: best.pamStart + 3, label: best.pam, strand: best.strand },
      { kind: 'cut_site', start: best.cut, end: best.cut, label: 'cut', strand: best.strand },
    );
  }
  const locus = variant.locus!;
  return {
    locusLabel: `chr${locus.chrom}:${locus.pos.toLocaleString('en-US')} (${locus.assembly})`,
    sequence: w.sequence,
    sequenceSource: w.source,
    refCheck: w.refCheck,
    windowStartPos: w.windowStartPos,
    marks,
    note: w.note,
  };
}
