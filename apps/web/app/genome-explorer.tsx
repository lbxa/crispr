"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type CSSProperties } from "react";
import {
  DNA_BASES,
  DNA_FINDING_COLOR,
  clampGenomePosition,
  type DnaViewMode,
} from "@crispr/human-model/dna-sequence";
import { DEMO_CHROMOSOMES, DEMO_GENOME } from "./demo-genome";
import { GenomeMinimap } from "./genome-minimap";
import type { GenomeReport } from "./genome-analysis/contract";
import {
  referenceSequenceSource,
  type GenomeRegion,
  type GenomeView,
} from "./genome-analysis/genome-view";
import styles from "./genome-explorer.module.css";

const DnaHelix = dynamic(
  () => import("@crispr/human-model/dna").then((module) => module.DnaHelix),
  {
    ssr: false,
    loading: () => (
      <p className={styles.loading} role="status">
        Preparing double helix…
      </p>
    ),
  },
);
const format = new Intl.NumberFormat("en-US");

export function GenomeExplorer({
  active,
  report,
  hasGenome = false,
}: {
  active: boolean;
  report?: GenomeReport;
  hasGenome?: boolean;
}) {
  if (hasGenome && !report)
    return (
      <p className={styles.empty} role="status">
        Finish genome analysis to see mapped findings.
      </p>
    );
  if (report && !report.genome_view)
    return (
      <p className={styles.empty} role="status">
        Choose the file again to load its region map.
      </p>
    );
  return (
    <GenomeExplorerContent
      key={report ? "result" : "demo"}
      active={active}
      view={report?.genome_view}
    />
  );
}

function GenomeExplorerContent({
  active,
  view,
}: {
  active: boolean;
  view?: GenomeView;
}) {
  const chromosomes = view?.chromosomes ?? DEMO_CHROMOSOMES;
  const regions = view?.regions ?? [];
  const first = regions[0];
  const [chromosomeId, setChromosomeId] = useState(
    first?.chromosome ?? chromosomes[0]!.id,
  );
  const [mode, setMode] = useState<DnaViewMode>("helix");
  const [target, setTarget] = useState<{
    position: number;
    animate?: boolean;
  }>({
    position: first?.start ?? (view ? 0 : 1_024_000),
  });
  const [position, setPosition] = useState(target.position);
  // While the helix slides to a target, the readout and minimap handle follow it.
  const [glide, setGlide] = useState<number | null>(null);
  const shown = glide ?? position;
  // Findings the user has not looked at pulse until their region has been in view.
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(
    first?.id ?? null,
  );
  const chromosome = chromosomes.find(({ id }) => id === chromosomeId)!;
  const source = useMemo(
    () => (view ? referenceSequenceSource(view) : DEMO_GENOME),
    [view],
  );
  const highlights = useMemo(
    () =>
      view?.regions.filter((region) => region.chromosome === chromosomeId) ??
      [],
    [view, chromosomeId],
  );
  const inView = active
    ? highlights.filter(
        (region) =>
          position >= region.start &&
          position < region.end &&
          !viewed.has(region.id),
      )
    : [];
  if (inView.length > 0)
    setViewed(new Set([...viewed, ...inView.map((region) => region.id)]));
  const unseen = useMemo(
    () =>
      new Set(
        (view?.regions ?? [])
          .filter(({ id }) => !viewed.has(id))
          .map(({ id }) => id),
      ),
    [view, viewed],
  );
  const dnaHighlights = useMemo(
    () =>
      highlights.map(({ id, start, end }) => ({
        start,
        end,
        pulse: !viewed.has(id),
      })),
    [highlights, viewed],
  );
  const selected =
    highlights.find(
      (region) =>
        region.id === selectedId &&
        position >= region.start &&
        position < region.end,
    ) ??
    highlights.find(
      (region) => position >= region.start && position < region.end,
    );
  const covered = highlights.some(
    (region) =>
      region.reference_context &&
      position >= region.reference_context.start &&
      position < region.reference_context.end,
  );

  /** Scrubbing follows the pointer; typed jumps pass `animate` to slide instead. */
  function navigate(next: number, options?: { animate?: boolean }) {
    const clamped = clampGenomePosition(Math.round(next), chromosome.length);
    // Start the readout where the helix is, so it slides rather than flashing the destination.
    if (options?.animate) setGlide(shown);
    setTarget({ position: clamped, animate: options?.animate });
    setPosition(clamped);
    setSelectedId(null);
  }

  function selectRegion(region: GenomeRegion) {
    // A new chromosome mounts a fresh helix, so there is nothing to slide from.
    setGlide(region.chromosome !== chromosomeId ? null : shown);
    setChromosomeId(region.chromosome);
    setTarget({ position: region.start, animate: true });
    setPosition(region.start);
    setSelectedId(region.id);
  }

  return (
    <section
      className={styles.explorer}
      aria-label="Genome explorer"
      style={{ "--dna-finding": DNA_FINDING_COLOR } as CSSProperties}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.title}>
            <h2>{mode === "helix" ? "Double helix" : "Flat ladder"}</h2>
            <span className={styles.demo}>
              {view ? "GRCh38 · Reference context" : "Demo genome"}
            </span>
          </div>
          <button
            type="button"
            className={styles.modeToggle}
            aria-label={
              mode === "helix" ? "Unwind double helix" : "Rewind double helix"
            }
            data-mode={mode}
            onClick={() =>
              setMode((current) => (current === "helix" ? "ladder" : "helix"))
            }
          >
            {mode === "helix" ? "Unwind" : "Rewind"}
          </button>
        </header>
        <div
          className={styles.body}
          data-findings={(view && regions.length > 0) || undefined}
        >
          <div className={styles.visualization}>
            <div className={styles.navigation}>
              <label className={styles.chromosome}>
                <span>Chromosome</span>
                <select
                  aria-label="Chromosome"
                  value={chromosomeId}
                  onChange={(event) => {
                    const id = event.target.value;
                    const region = regions.find(
                      (item) => item.chromosome === id,
                    );
                    const next = region?.start ?? (view ? 0 : 1_024_000);
                    setChromosomeId(id);
                    setGlide(null);
                    setTarget({ position: next });
                    setPosition(next);
                    setSelectedId(region?.id ?? null);
                  }}
                >
                  {chromosomes.map(({ id }) => (
                    <option key={id} value={id}>
                      Chr {id}
                      {regions.some((region) => region.chromosome === id)
                        ? ` · ${regions.filter((region) => region.chromosome === id).length}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <form
                key={`${chromosomeId}:${target.position}`}
                className={styles.jump}
                onSubmit={(event) => {
                  event.preventDefault();
                  const input =
                    event.currentTarget.elements.namedItem("position");
                  if (
                    input instanceof HTMLInputElement &&
                    input.checkValidity()
                  )
                    navigate(input.valueAsNumber - 1, { animate: true });
                }}
              >
                <label htmlFor="genome-position">Go to base</label>
                <div>
                  <input
                    id="genome-position"
                    name="position"
                    type="number"
                    min={1}
                    max={chromosome.length}
                    step={1}
                    defaultValue={Math.round(position) + 1}
                    required
                  />
                  <button type="submit" aria-label="Go to base">
                    ↵
                  </button>
                </div>
              </form>
            </div>
            <div className={styles.scene}>
              <DnaHelix
                key={chromosomeId}
                chromosome={chromosome}
                source={source}
                highlights={dnaHighlights}
                navigation={target}
                active={active}
                mode={mode}
                onPositionChange={setPosition}
                onGlide={setGlide}
              />
            </div>
            <footer className={styles.footer}>
              <div className={styles.location}>
                <output aria-label="Current base" aria-live="off">
                  {format.format(shown + 1)}
                  <span> bp</span>
                </output>
                <span>of {format.format(chromosome.length)}</span>
              </div>
              <GenomeMinimap
                chromosome={chromosome}
                regions={regions}
                position={position}
                displayPosition={shown}
                unseen={unseen}
                onNavigate={navigate}
                onSelect={selectRegion}
              />
              <div className={styles.legend} aria-label="Base colors">
                {(["A", "T", "C", "G"] as const).map((base) => (
                  <span key={base}>
                    <i style={{ background: DNA_BASES[base].color }} />
                    {base}
                  </span>
                ))}
                {view && (
                  <span>
                    <i style={{ background: DNA_FINDING_COLOR }} />
                    Finding
                  </span>
                )}
              </div>
              <p className={styles.disclaimer}>
                {view
                  ? regions.length === 0
                    ? "No flagged regions in the screened genes. Reference sequence is unavailable here."
                    : covered
                      ? "GRCh38 reference · Alternate allele shown separately"
                      : "Reference unavailable here · N = unknown base"
                  : "Synthetic sequence · Upload a genome to map findings"}
              </p>
            </footer>
          </div>
          {view && regions.length > 0 && (
            <aside className={styles.inspector} aria-label="Mutation details">
              {selected && (
                <section className={styles.site} aria-label="Selected finding">
                  <div className={styles.siteHeading}>
                    <strong>{selected.annotations[0]!.gene}</strong>
                    <span dir="ltr">
                      Chr {selected.chromosome}:
                      {format.format(selected.start + 1)}
                      {selected.end > selected.start + 1
                        ? `–${format.format(selected.end)}`
                        : ""}
                    </span>
                  </div>
                  <p>
                    {selected.annotations
                      .map(
                        ({ disease, tier }) =>
                          `${disease}${tier === "carrier" ? " · Carrier" : ""}`,
                      )
                      .join("; ")}
                  </p>
                  <dl className={styles.alleles}>
                    <div>
                      <dt>Reference</dt>
                      <dd dir="ltr">{selected.reference}</dd>
                    </div>
                    <div>
                      <dt>Alternate</dt>
                      <dd dir="ltr">{selected.alternate}</dd>
                    </div>
                  </dl>
                </section>
              )}
              <details
                className={styles.findings}
                aria-label="Regions of interest"
                open={regions.length <= 3}
              >
                <summary>
                  <span>Browse findings</span>
                  <span className={styles.findingCount}>{regions.length}</span>
                </summary>
                <div className={styles.findingList}>
                  {regions.map((region) => (
                    <button
                      key={region.id}
                      type="button"
                      aria-label={`Inspect ${region.annotations.map(({ gene }) => gene).join(", ")} at chr${region.chromosome}:${region.start + 1}`}
                      onClick={() => selectRegion(region)}
                      aria-pressed={selected?.id === region.id}
                      data-unseen={!viewed.has(region.id) || undefined}
                    >
                      <span>
                        {region.annotations
                          .map(({ gene }) => gene)
                          .filter(
                            (gene, index, genes) =>
                              genes.indexOf(gene) === index,
                          )
                          .join(" / ")}
                      </span>
                      <span dir="ltr">
                        Chr {region.chromosome}:
                        {format.format(region.start + 1)}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}
