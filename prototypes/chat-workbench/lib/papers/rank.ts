import type { StudyType } from '../graph/types';
import type { EvidenceTimelineData } from '../ui/payload';

const STOP = new Set(
  'the a an and or of in on for to with by from at is are was were be been this that these those it its as into about what which who how why does do can could should would will not no yes than then there their them they you your we our i me my have has had'.split(
    ' ',
  ),
);

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/**
 * Okapi BM25 over a small candidate set. The set is already narrowed by the graph
 * (papers linked to the focus entities), so a few dozen documents is typical and this
 * runs in well under a millisecond. Embeddings would slot in here as a second signal.
 */
export function bm25Rank<T>(
  docs: Array<{ item: T; text: string }>,
  query: string,
  k1 = 1.2,
  b = 0.75,
): Ranked<T>[] {
  const q = [...new Set(terms(query))];
  if (docs.length === 0) return [];
  const tokenised = docs.map((d) => terms(d.text));
  const avgLen = tokenised.reduce((s, t) => s + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const toks of tokenised) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;

  return docs
    .map((d, i) => {
      const toks = tokenised[i]!;
      const tf = new Map<string, number>();
      for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const n = df.get(w) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * toks.length) / avgLen));
      }
      return { item: d.item, score };
    })
    .sort((a, b2) => b2.score - a.score);
}

/** Papers per year split by study type: the data behind the evidence-maturity chart. */
export function evidenceTimeline(
  papers: Array<{ year: number | null; studyType: StudyType }>,
): EvidenceTimelineData['byYear'] {
  const byYear = new Map<number, { year: number; total: number; byType: Partial<Record<StudyType, number>> }>();
  for (const p of papers) {
    if (p.year === null) continue;
    let row = byYear.get(p.year);
    if (!row) byYear.set(p.year, (row = { year: p.year, total: 0, byType: {} }));
    row.total++;
    row.byType[p.studyType] = (row.byType[p.studyType] ?? 0) + 1;
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}
