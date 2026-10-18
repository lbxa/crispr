import type { StudyType } from '../graph/types';

export interface EpmcRecord {
  id: string;
  source: string;
  pmid?: string;
  doi?: string;
  title: string;
  abstract: string;
  year: number | null;
  journal?: string;
  pubTypes: string[];
  citedBy: number;
}

export const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
export const MAX_ABSTRACT_CHARS = 700;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Abstracts and titles are untrusted text from a third party and end up in the model's
 * context. Strip markup, collapse whitespace and control characters, and bound the length.
 * (The system prompt also tells the model to treat paper text as data, never instructions.)
 */
export function sanitizeText(raw: unknown, maxChars = MAX_ABSTRACT_CHARS): string {
  if (typeof raw !== 'string') return '';
  let s = raw.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars)}…`;
}

export function classifyStudy(pubTypes: string[], source: string): { studyType: StudyType; peerReviewed: boolean } {
  if (source === 'PPR') return { studyType: 'Preprint', peerReviewed: false };
  const t = pubTypes.map((p) => p.toLowerCase());
  const has = (needle: string) => t.some((p) => p.includes(needle));
  let studyType: StudyType = 'Research article';
  if (has('meta-analysis') || has('systematic review')) studyType = 'Systematic review / meta-analysis';
  else if (has('clinical trial') || has('randomized controlled trial')) studyType = 'Clinical trial';
  else if (has('review')) studyType = 'Review';
  else if (has('case reports')) studyType = 'Case report';
  return { studyType, peerReviewed: true };
}

const quote = (s: string) => `"${s.replace(/["()\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;

export interface QueryTerms {
  entities: string[];
  topics?: string[];
}

/**
 * Europe PMC query: (entity terms OR-ed) AND (topic terms OR-ed), restricted to PubMed
 * records and preprints. Terms are quoted and stripped of operators, so user text
 * cannot inject query syntax.
 */
export function buildQuery({ entities, topics = [] }: QueryTerms): string {
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter((x) => x.length >= 2))];
  const e = clean(entities).slice(0, 6);
  const t = clean(topics).slice(0, 5);
  if (e.length === 0) return '';
  let q = `(${e.map(quote).join(' OR ')})`;
  if (t.length) q += ` AND (${t.map(quote).join(' OR ')})`;
  return `${q} AND (SRC:MED OR SRC:PPR)`;
}

export interface SearchOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  limit?: number;
}

type RawRecord = Record<string, unknown>;

function parseRecord(r: RawRecord): EpmcRecord | null {
  const id = typeof r.id === 'string' ? r.id : undefined;
  const source = typeof r.source === 'string' ? r.source : undefined;
  const title = sanitizeText(r.title, 300);
  if (!id || !source || !title) return null;
  const journalInfo = r.journalInfo as { journal?: { title?: unknown }; yearOfPublication?: unknown } | undefined;
  const yearRaw = r.pubYear ?? journalInfo?.yearOfPublication;
  const year = Number(yearRaw);
  const pubTypeList = r.pubTypeList as { pubType?: unknown } | undefined;
  const pubTypes = Array.isArray(pubTypeList?.pubType)
    ? (pubTypeList.pubType as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const journal = sanitizeText(r.journalTitle ?? journalInfo?.journal?.title, 120);
  return {
    id,
    source,
    pmid: typeof r.pmid === 'string' ? r.pmid : undefined,
    doi: typeof r.doi === 'string' ? r.doi : undefined,
    title,
    abstract: sanitizeText(r.abstractText),
    year: Number.isFinite(year) && year > 1900 ? year : null,
    journal: journal || undefined,
    pubTypes,
    citedBy: typeof r.citedByCount === 'number' ? r.citedByCount : 0,
  };
}

/**
 * Search Europe PMC. Throws on transport or HTTP failure so the caller can decide how to
 * degrade; malformed individual records are skipped.
 *
 * NOTE: written against the documented REST response shape and exercised with a mocked
 * fetch only. It has not been run against the live service.
 */
export async function searchEuropePmc(query: string, opts: SearchOptions = {}): Promise<EpmcRecord[]> {
  if (!query) return [];
  const fetchFn = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? EPMC_BASE;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const url = `${base}/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${limit}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
  if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);
  const body = (await res.json()) as { resultList?: { result?: unknown } };
  const results = Array.isArray(body.resultList?.result) ? (body.resultList!.result as RawRecord[]) : [];
  return results.map(parseRecord).filter((r): r is EpmcRecord => r !== null);
}
