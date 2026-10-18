"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { Button } from "@crispr/ui/components/button";
import { DiseaseCard } from "@crispr/ui/genome/disease-card";
import { Field, FieldGroup, FieldLabel } from "@crispr/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@crispr/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crispr/ui/components/select";
import {
  BASE_PIXELS,
  DNA_BASES,
  DNA_FINDING_COLOR,
  clampGenomePosition,
  type DnaViewMode,
} from "@crispr/human-model/dna-sequence";
import { DEMO_CHROMOSOMES, DEMO_GENOME } from "./demo-genome";
import { DISEASE_ARTWORK } from "./disease-artwork";
import { CrisprDialog, type CrisprGene } from "./crispr/crispr-dialog";
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
// A disease zone gets its floating label once it is this close to the focus line (about the
// visible half of the helix, at BASE_PIXELS per base).
const ZONE_NEAR_BASES = 8;

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
      findings={report?.findings}
    />
  );
}

function GenomeExplorerContent({
  active,
  view,
  findings,
}: {
  active: boolean;
  view?: GenomeView;
  findings?: GenomeReport["findings"];
}) {
  const chromosomes = view?.chromosomes ?? DEMO_CHROMOSOMES;
  const regions = view?.regions ?? [];
  const chromosomeItems = chromosomes.map(({ id }) => {
    const count = regions.filter((region) => region.chromosome === id).length;
    return { value: id, label: `Chr ${id}${count ? ` · ${count}` : ""}` };
  });
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
  const [crisprGene, setCrisprGene] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  // Carriers are not candidates for editing, so only genes with a likely or possible finding.
  const crisprGenes = useMemo(() => {
    const byGene = new Map<string, CrisprGene>();
    for (const { gene, disease, tier } of findings ?? [])
      if (tier !== "carrier" && !byGene.has(gene))
        byGene.set(gene, { gene, disease });
    return [...byGene.values()];
  }, [findings]);
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
  // The finding nearest the focus line, once it is close enough to be on screen.
  const zone = highlights
    .map((region) => ({
      region,
      distance:
        shown < region.start
          ? region.start - shown
          : shown >= region.end
            ? shown - region.end + 1
            : 0,
    }))
    .filter(({ distance }) => distance <= ZONE_NEAR_BASES)
    .sort((a, b) => a.distance - b.distance)[0]?.region;
  const zoneCrispr = zone?.annotations.find(
    ({ tier, gene }) =>
      tier !== "carrier" && crisprGenes.some((item) => item.gene === gene),
  );
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
        </header>
        <div
          className={styles.body}
          data-findings={(view && regions.length > 0) || undefined}
        >
          <div className={styles.visualization}>
            <FieldGroup className={styles.navigation}>
              <Field className={styles.chromosome}>
                <FieldLabel htmlFor="genome-chromosome">Chromosome</FieldLabel>
                <Select
                  items={chromosomeItems}
                  value={chromosomeId}
                  onValueChange={(id) => {
                    if (id === null) return;
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
                  <SelectTrigger
                    id="genome-chromosome"
                    size="sm"
                    className="w-full data-[size=sm]:rounded-e-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    size="sm"
                    sideOffset={2}
                    align="start"
                    alignItemWithTrigger={false}
                  >
                    <SelectGroup>
                      {chromosomeItems.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
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
                <Field className={styles.positionField}>
                  <FieldLabel htmlFor="genome-position">Go to base</FieldLabel>
                  <InputGroup className="h-7 rounded-s-none rounded-e-[10px] border-s-0">
                    <InputGroupInput
                      className="h-full px-1.5 py-0"
                      id="genome-position"
                      name="position"
                      type="number"
                      min={1}
                      max={chromosome.length}
                      step={1}
                      defaultValue={Math.round(position) + 1}
                      required
                    />
                    <InputGroupAddon
                      align="inline-end"
                      className="p-px has-[>button]:mr-0"
                    >
                      <InputGroupButton
                        type="submit"
                        size="icon-xs"
                        className="rounded-sm"
                        aria-label="Go to base"
                        title="Go to base"
                      >
                        <span aria-hidden="true">↵</span>
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              </form>
            </FieldGroup>
            <div className={styles.scene}>
              <div
                className={styles.viewerToolbar}
                role="toolbar"
                aria-label="DNA viewer tools"
                aria-orientation="vertical"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 rounded-xl"
                  aria-label={
                    mode === "helix"
                      ? "Unwind double helix"
                      : "Rewind double helix"
                  }
                  title={
                    mode === "helix"
                      ? "Unwind double helix"
                      : "Rewind double helix"
                  }
                  onClick={() =>
                    setMode((current) =>
                      current === "helix" ? "ladder" : "helix",
                    )
                  }
                >
                  <span
                    className={styles.modeIcon}
                    data-mode={mode}
                    aria-hidden="true"
                  />
                </Button>
              </div>
              <DnaHelix
                key={chromosomeId}
                chromosome={chromosome}
                source={source}
                highlights={dnaHighlights}
                navigation={target}
                active={active}
                mode={mode}
                onPositionChange={setPosition}
                onGlide={(next) => {
                  // Frame positions must reach the DOM before WebGL paints. Completion
                  // can also come from an Effect (reduced motion), so only flush frames.
                  if (next === null) setGlide(null);
                  else flushSync(() => setGlide(next));
                }}
              />
              {zone && (
                <div
                  key={zone.id}
                  className={styles.zoneTag}
                  role="group"
                  aria-label="Disease zone"
                  data-testid="zone-tag"
                  style={
                    {
                      // Where the zone sits relative to the focus line; the stylesheet clamps it.
                      "--zone-offset": `${(zone.start - shown) * BASE_PIXELS}px`,
                    } as CSSProperties
                  }
                >
                  <strong>
                    {[
                      ...new Set(zone.annotations.map(({ gene }) => gene)),
                    ].join(" / ")}
                  </strong>
                  <span>
                    {[
                      ...new Set(
                        zone.annotations.map(({ disease }) => disease),
                      ),
                    ].join("; ")}
                  </span>
                  {!zoneCrispr &&
                    zone.annotations.every((a) => a.tier === "carrier") && (
                      <em>Carrier · not an editing target</em>
                    )}
                  {zoneCrispr && (
                    <button
                      type="button"
                      className={styles.zoneAction}
                      onClick={() => setCrisprGene(zoneCrispr.gene)}
                    >
                      CRISPR
                    </button>
                  )}
                </div>
              )}
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
                <section
                  className={styles.diseaseCards}
                  aria-label="Selected finding"
                >
                  {selected.annotations.map(({ gene, disease, tier }) => {
                    const evidenceKey = `${selected.id}:${gene}:${disease}`;
                    return (
                      <DiseaseCard
                        key={evidenceKey}
                        gene={gene}
                        name={disease}
                        status={tier}
                        artwork={DISEASE_ARTWORK[gene]}
                        location={`Chr ${selected.chromosome}:${format.format(selected.start + 1)}${selected.end > selected.start + 1 ? `–${format.format(selected.end)}` : ""}`}
                        expanded={evidence === evidenceKey}
                        onExpandedChange={(open) =>
                          setEvidence(open ? evidenceKey : null)
                        }
                      >
                        <dl>
                          <dt>Reference allele</dt>
                          <dd dir="ltr">{selected.reference}</dd>
                          <dt>Alternate allele</dt>
                          <dd dir="ltr">{selected.alternate}</dd>
                        </dl>
                        {tier !== "carrier" &&
                          crisprGenes.some((item) => item.gene === gene) && (
                            <Button
                              variant="secondary"
                              onClick={() => setCrisprGene(gene)}
                            >
                              Open editing studio
                            </Button>
                          )}
                      </DiseaseCard>
                    );
                  })}
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
      <CrisprDialog
        open={crisprGene !== null}
        onOpenChange={(open) => {
          if (!open) setCrisprGene(null);
        }}
        genes={crisprGenes}
        initialGene={crisprGene ?? crisprGenes[0]?.gene ?? ""}
      />
    </section>
  );
}
