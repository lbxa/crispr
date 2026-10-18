import { KnowledgeGraph, normalize } from './graph';
import type { NodeType } from './types';

export interface LinkedEntity {
  id: string;
  type: NodeType;
  label: string;
  /** The text span that matched, as normalised tokens. */
  matched: string;
  /** Token offsets into the normalised query. */
  start: number;
  end: number;
  method: 'exact' | 'fuzzy';
  /** 1 for exact; for fuzzy, 1 - distance/length. */
  score: number;
  /** Other nodes sharing the same alias, if any. The first is returned as `id`. */
  ambiguousWith?: string[];
}

const MAX_NGRAM = 4;
const TOKEN_RE = /[a-z0-9](?:[a-z0-9.>:_]*[a-z0-9])?/g;

export function tokenize(text: string): string[] {
  return normalize(text).match(TOKEN_RE) ?? [];
}

/** Optimal-string-alignment distance with an early exit once `max` is exceeded. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]!;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

interface FuzzyIndex {
  /** key = `${wordCount}:${charLength}` */
  buckets: Map<string, Array<{ alias: string; ids: string[] }>>;
}

const fuzzyCache = new WeakMap<KnowledgeGraph, { size: number; index: FuzzyIndex }>();

function fuzzyIndex(g: KnowledgeGraph): FuzzyIndex {
  const cached = fuzzyCache.get(g);
  if (cached && cached.size === g.nodeCount) return cached.index;
  const buckets: FuzzyIndex['buckets'] = new Map();
  for (const [alias, ids] of g.aliasEntries()) {
    if (alias.length < 5) continue; // too short to fuzz safely
    const key = `${alias.split(' ').length}:${alias.length}`;
    const list = buckets.get(key);
    if (list) list.push({ alias, ids });
    else buckets.set(key, [{ alias, ids }]);
  }
  const index = { buckets };
  fuzzyCache.set(g, { size: g.nodeCount, index });
  return index;
}

function maxDistanceFor(len: number): number {
  if (len >= 12) return 2;
  if (len >= 5) return 1;
  return 0;
}

/**
 * Link free text to graph nodes.
 *
 * Pass 1: greedy longest-match over token n-grams against the alias index (O(tokens)).
 * Pass 2: fuzzy match on whatever is left, bucketed by word count and length so only
 *         a handful of aliases are compared per window.
 */
export function linkEntities(g: KnowledgeGraph, text: string): LinkedEntity[] {
  const tokens = tokenize(text);
  const consumed = new Array<boolean>(tokens.length).fill(false);
  const found: LinkedEntity[] = [];

  const emit = (
    ids: readonly string[],
    start: number,
    n: number,
    matched: string,
    method: 'exact' | 'fuzzy',
    score: number,
  ) => {
    const node = g.node(ids[0]!);
    if (!node) return;
    for (let k = start; k < start + n; k++) consumed[k] = true;
    const ent: LinkedEntity = {
      id: node.id,
      type: node.type,
      label: node.label,
      matched,
      start,
      end: start + n,
      method,
      score,
    };
    if (ids.length > 1) ent.ambiguousWith = ids.slice(1) as string[];
    found.push(ent);
  };

  // Pass 1: exact.
  for (let i = 0; i < tokens.length; ) {
    let hit = false;
    for (let n = Math.min(MAX_NGRAM, tokens.length - i); n >= 1; n--) {
      const key = tokens.slice(i, i + n).join(' ');
      const ids = g.lookupAlias(key);
      if (ids.length) {
        emit(ids, i, n, key, 'exact', 1);
        i += n;
        hit = true;
        break;
      }
    }
    if (!hit) i++;
  }

  // Pass 2: fuzzy on unconsumed windows (longest first so "cystc fibrosis" beats "cystc").
  const index = fuzzyIndex(g);
  for (let i = 0; i < tokens.length; ) {
    if (consumed[i]) {
      i++;
      continue;
    }
    let hit = false;
    for (let n = Math.min(3, tokens.length - i); n >= 1 && !hit; n--) {
      if (consumed.slice(i, i + n).some(Boolean)) continue;
      const cand = tokens.slice(i, i + n).join(' ');
      if (cand.length < 5) continue;
      const max = maxDistanceFor(cand.length);
      if (max === 0) continue;
      let best: { alias: string; ids: string[]; d: number } | null = null;
      let tie = false;
      for (let len = cand.length - max; len <= cand.length + max; len++) {
        for (const entry of index.buckets.get(`${n}:${len}`) ?? []) {
          if (entry.alias[0] !== cand[0]) continue;
          const d = editDistance(cand, entry.alias, max);
          if (d > max) continue;
          if (!best || d < best.d) {
            best = { ...entry, d };
            tie = false;
          } else if (d === best.d && entry.alias !== best.alias) {
            tie = true;
          }
        }
      }
      if (best && !tie && best.d > 0) {
        emit(best.ids, i, n, cand, 'fuzzy', 1 - best.d / cand.length);
        hit = true;
      }
    }
    i += 1;
  }

  // De-duplicate by node id, keeping the strongest match, in text order.
  const byId = new Map<string, LinkedEntity>();
  for (const e of found) {
    const prev = byId.get(e.id);
    if (!prev || e.score > prev.score) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}
