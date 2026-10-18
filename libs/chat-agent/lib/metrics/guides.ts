/**
 * SpCas9 guide geometry. Everything here is deterministic arithmetic on a sequence:
 * PAM scan on both strands, cut position, distance to the variant, GC content,
 * homopolymers, and base-editor window fit.
 *
 * What this module does NOT do: predict on-target efficiency or off-target risk.
 * Those fields are explicit `not_computed` / `not_assessed` values so nothing downstream
 * can mistake a missing score for a good one.
 */

export interface VariantSpan {
  start: number;
  /** Half-open. start === end for a pure deletion (the junction). */
  end: number;
  ref: string;
  alt: string;
}

export interface BaseEditFit {
  editor: "ABE" | "CBE";
  /** 1-based, from the PAM-distal (5') end of the protospacer. */
  position: number;
  /** Canonical activity window, protospacer positions 4 to 8. Editor-dependent in practice. */
  inWindow: boolean;
  /** Other bases in the window the same editor would also change. */
  bystanders: number;
}

export interface Guide {
  id: string;
  strand: "+" | "-";
  /** 20 nt, 5' to 3' on the guide's own strand. */
  protospacer: string;
  pam: string;
  /** Protospacer range on the forward strand of the window, half-open. */
  start: number;
  end: number;
  pamStart: number;
  /** Cut boundary: the cut falls between window index cut-1 and cut. */
  cut: number;
  cutDistance: number;
  gc: number;
  polyT: boolean;
  maxHomopolymer: number;
  /** Heuristic, lower is better. Cut distance plus penalties. NOT an efficiency prediction. */
  geometryScore: number;
  rank: number;
  onTarget: { score: null; source: "not_computed" };
  offTarget: { status: "not_assessed" };
  baseEdit: BaseEditFit | null;
}

const COMP: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };

export function revcomp(s: string): string {
  let out = "";
  for (let i = s.length - 1; i >= 0; i--) out += COMP[s[i]!] ?? "N";
  return out;
}

const isDna = (s: string) => /^[ACGT]+$/.test(s);

export function gcPercent(s: string): number {
  let gc = 0;
  for (const c of s) if (c === "G" || c === "C") gc++;
  return Math.round((gc / s.length) * 1000) / 10;
}

export function maxHomopolymer(s: string): number {
  let best = 0;
  let run = 0;
  let prev = "";
  for (const c of s) {
    run = c === prev ? run + 1 : 1;
    prev = c;
    if (run > best) best = run;
  }
  return best;
}

export function cutDistance(cut: number, v: VariantSpan): number {
  if (cut >= v.start && cut <= v.end) return 0;
  return Math.min(Math.abs(cut - v.start), Math.abs(cut - v.end));
}

export type EditClass = "transition" | "transversion" | "indel";

export function classifyEdit(ref: string, alt: string): EditClass {
  if (ref.length !== 1 || alt.length !== 1) return "indel";
  const purines = "AG";
  return purines.includes(ref) === purines.includes(alt)
    ? "transition"
    : "transversion";
}

/**
 * Can a cytosine or adenine base editor reverse this variant with this guide?
 * The correction runs alt -> ref on the forward strand. A guide on the forward strand
 * edits forward-strand bases (ABE: A>G, CBE: C>T); a guide on the reverse strand
 * edits the complement (ABE: forward T>C, CBE: forward G>A).
 */
export function baseEditFit(
  v: VariantSpan,
  guide: Pick<Guide, "strand" | "start" | "end" | "protospacer">,
): BaseEditFit | null {
  if (classifyEdit(v.ref, v.alt) !== "transition") return null;
  const from = v.alt;
  const to = v.ref;
  let editor: "ABE" | "CBE" | null = null;
  if (guide.strand === "+") {
    if (from === "A" && to === "G") editor = "ABE";
    else if (from === "C" && to === "T") editor = "CBE";
  } else {
    if (from === "T" && to === "C") editor = "ABE";
    else if (from === "G" && to === "A") editor = "CBE";
  }
  if (!editor) return null;

  const position =
    guide.strand === "+"
      ? v.start - guide.start + 1
      : guide.end - 1 - v.start + 1;
  if (position < 1 || position > 20) return null;

  const targetBase = editor === "ABE" ? "A" : "C";
  if (guide.protospacer[position - 1] !== targetBase) return null;

  let bystanders = 0;
  for (let i = 3; i <= 7; i++) {
    if (i !== position - 1 && guide.protospacer[i] === targetBase) bystanders++;
  }
  return {
    editor,
    position,
    inWindow: position >= 4 && position <= 8,
    bystanders,
  };
}

export interface DesignOptions {
  /** Drop guides whose cut is further than this from the variant. Default 30 bp. */
  maxCutDistance?: number;
  /** Keep at most this many guides. Default 8. */
  limit?: number;
}

export function designGuides(
  sequence: string,
  v: VariantSpan,
  opts: DesignOptions = {},
): Guide[] {
  const maxDist = opts.maxCutDistance ?? 30;
  const seq = sequence.toUpperCase();
  const found: Omit<Guide, "rank">[] = [];

  const push = (
    strand: "+" | "-",
    protospacer: string,
    pam: string,
    start: number,
    end: number,
    pamStart: number,
    cut: number,
  ) => {
    if (protospacer.length !== 20 || !isDna(protospacer) || !isDna(pam)) return;
    const dist = cutDistance(cut, v);
    if (dist > maxDist) return;
    const gc = gcPercent(protospacer);
    const polyT = protospacer.includes("TTTT");
    const geometryScore =
      dist + (gc < 30 || gc > 80 ? 5 : 0) + (polyT ? 10 : 0);
    const partial = { strand, start, end, protospacer };
    found.push({
      id: `guide:${strand}:${start}:${protospacer}`,
      strand,
      protospacer,
      pam,
      start,
      end,
      pamStart,
      cut,
      cutDistance: dist,
      gc,
      polyT,
      maxHomopolymer: maxHomopolymer(protospacer),
      geometryScore,
      onTarget: { score: null, source: "not_computed" },
      offTarget: { status: "not_assessed" },
      baseEdit: baseEditFit(v, partial),
    });
  };

  // Forward strand: protospacer [p-20, p), PAM NGG at [p, p+3), cut 3 bp upstream of the PAM.
  for (let p = 20; p + 3 <= seq.length; p++) {
    if (seq[p + 1] === "G" && seq[p + 2] === "G") {
      push("+", seq.slice(p - 20, p), seq.slice(p, p + 3), p - 20, p, p, p - 3);
    }
  }
  // Reverse strand: forward-strand CCN at [q, q+3) is an NGG PAM on the other strand;
  // the protospacer is the reverse complement of [q+3, q+23); cut lies between q+5 and q+6.
  for (let q = 0; q + 23 <= seq.length; q++) {
    if (seq[q] === "C" && seq[q + 1] === "C") {
      push(
        "-",
        revcomp(seq.slice(q + 3, q + 23)),
        revcomp(seq.slice(q, q + 3)),
        q + 3,
        q + 23,
        q,
        q + 6,
      );
    }
  }

  found.sort((a, b) => a.geometryScore - b.geometryScore || a.start - b.start);
  return found.slice(0, opts.limit ?? 8).map((g, i) => ({ ...g, rank: i + 1 }));
}
