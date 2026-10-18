"use client";

import dynamic from "next/dynamic";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@crispr/ui/components/button";
import { DiseaseCard } from "@crispr/ui/genome/disease-card";
import { toast } from "@crispr/ui/components/sonner";
import {
  BASE_PIXELS,
  DNA_BASES,
  DNA_FINDING_COLOR,
  clampGenomePosition,
  type DnaViewMode,
} from "@crispr/human-model/dna-sequence";
import { DEMO_CHROMOSOMES, DEMO_GENOME } from "./demo-genome";
import { DISEASE_ARTWORK } from "./disease-artwork";
import { getAnatomyRegion } from "@crispr/human-model/anatomy";
import { reviewedBodyAssociation } from "./genome-analysis/body-map";
import { CrisprDrawer, type CrisprGene } from "./crispr/crispr-drawer";
import { FindingReport } from "./genome-analysis/report";
import {
  DnaSceneSkeleton,
  GenomeExplorerSkeleton,
} from "./genome-explorer-skeleton";
import type { GenomeReport } from "./genome-analysis/contract";
import {
  referenceSequenceSource,
  type GenomeRegion,
  type GenomeView,
} from "./genome-analysis/genome-view";
import { createReferenceLoader } from "./genome-analysis/reference";
import {
  KaryotypeNavigator,
  type KaryotypeSex,
} from "./karyotype/karyotype-navigator";
import styles from "./genome-explorer.module.css";

const DnaHelix = dynamic(
  () => import("@crispr/human-model/dna").then((module) => module.DnaHelix),
  {
    ssr: false,
    loading: DnaSceneSkeleton,
  },
);
const format = new Intl.NumberFormat("en-US");
const NO_REGIONS: readonly GenomeRegion[] = [];
// A disease zone gets its floating label once it is this close to the focus line (about the
// visible half of the helix, at BASE_PIXELS per base).
const ZONE_NEAR_BASES = 8;

export function GenomeExplorer({
  active,
  report,
  hasGenome = false,
  loading = false,
}: {
  active: boolean;
  report?: GenomeReport;
  hasGenome?: boolean;
  loading?: boolean;
}) {
  const analysisIncomplete = hasGenome && !report;
  const mapUnavailable = Boolean(report && !report.genome_view);

  useEffect(() => {
    if (!active || loading) return;
    if (analysisIncomplete) {
      toast.info("Genome analysis incomplete", {
        description: "Continue from the genome summary to see mapped findings.",
        id: "genome-analysis-incomplete",
      });
    } else if (mapUnavailable) {
      toast.info("Genome map unavailable", {
        description: "Choose the file again to load its region map.",
        id: "genome-map-unavailable",
      });
    }
  }, [active, analysisIncomplete, loading, mapUnavailable]);

  if (loading) return <GenomeExplorerSkeleton />;
  if (analysisIncomplete || mapUnavailable) return null;
  return (
    <GenomeExplorerContent
      key={report ? "result" : "demo"}
      active={active}
      view={report?.genome_view}
      findings={report?.findings}
      profile={report?.genome.model_profile}
    />
  );
}

function GenomeExplorerContent({
  active,
  view,
  findings,
  profile,
}: {
  active: boolean;
  view?: GenomeView;
  findings?: GenomeReport["findings"];
  profile?: GenomeReport["genome"]["model_profile"];
}) {
  const chromosomes = view?.chromosomes ?? DEMO_CHROMOSOMES;
  // Without a reported sex, a genome with Y calls is drawn 46,XY; the demo genome has a Y.
  const sex: KaryotypeSex =
    profile ?? (chromosomes.some(({ id }) => id === "Y") ? "male" : "female");
  const regions = view?.regions ?? NO_REGIONS;
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
  // While the helix slides to a target, the readout and karyotype cursor follow it.
  const [glide, setGlide] = useState<number | null>(null);
  const shown = glide ?? position;
  // Findings the user has not looked at pulse until their region has been in view.
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const [crisprGene, setCrisprGene] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const visualization = useRef<HTMLDivElement>(null);
  // A disease has one report card, even when several mapped variants contribute to it.
  const findingCards = useMemo(() => {
    const cards = new Map<
      string,
      {
        annotation: GenomeRegion["annotations"][number];
        regions: GenomeRegion[];
      }
    >();
    for (const { gene, disease, tier } of findings ?? []) {
      cards.set(JSON.stringify([gene, disease, tier]), {
        annotation: { gene, disease, tier },
        regions: [],
      });
    }
    for (const region of regions) {
      for (const annotation of region.annotations) {
        const key = JSON.stringify([
          annotation.gene,
          annotation.disease,
          annotation.tier,
        ]);
        const card = cards.get(key) ?? { annotation, regions: [] };
        if (!card.regions.includes(region)) card.regions.push(region);
        cards.set(key, card);
      }
    }
    return [...cards.entries()];
  }, [findings, regions]);
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
  // Whether GRCh38 reference bases are reaching the viewer (null until the first read).
  const [referenceAvailable, setReferenceAvailable] = useState<boolean | null>(
    null,
  );
  const source = useMemo(
    () =>
      view
        ? referenceSequenceSource(
            view,
            createReferenceLoader(
              new Map(view.chromosomes.map(({ id, length }) => [id, length])),
            ),
            setReferenceAvailable,
          )
        : DEMO_GENOME,
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

  /** A point picked on the karyotype: slide there on this chromosome, or open the other one there. */
  function goTo(
    id: string,
    next: number,
    options: { animate: boolean } = { animate: true },
  ) {
    const destination = chromosomes.find((item) => item.id === id);
    if (!destination) return;
    if (id === chromosomeId) {
      navigate(next, options);
      return;
    }
    const clamped = clampGenomePosition(Math.round(next), destination.length);
    // A new chromosome mounts a fresh helix, so there is nothing to slide from.
    setChromosomeId(id);
    setGlide(null);
    setTarget({ position: clamped });
    setPosition(clamped);
    setSelectedId(null);
  }

  /** A whole chromosome chosen from the keyboard: open on its first finding, if any. */
  function chooseChromosome(id: string) {
    if (id === chromosomeId) return;
    const region = regions.find((item) => item.chromosome === id);
    const next = region?.start ?? (view ? 0 : 1_024_000);
    setChromosomeId(id);
    setGlide(null);
    setTarget({ position: next });
    setPosition(next);
    setSelectedId(region?.id ?? null);
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
          data-findings={findingCards.length > 0 || undefined}
        >
          <div className={styles.visualization} ref={visualization}>
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
                loadingFallback={<DnaSceneSkeleton />}
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
            <KaryotypeNavigator
              chromosomes={chromosomes}
              current={chromosomeId}
              position={shown}
              regions={regions}
              unseen={unseen}
              sex={sex}
              onNavigate={goTo}
              onChoose={chooseChromosome}
              onSelect={selectRegion}
            />
            <footer className={styles.footer}>
              <div className={styles.location}>
                <span className={styles.chromosomeName}>
                  Chr {chromosome.id}
                </span>
                <output aria-label="Current base" aria-live="off">
                  {format.format(shown + 1)}
                  <span> bp</span>
                </output>
                <span>of {format.format(chromosome.length)}</span>
              </div>
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
                  ? referenceAvailable || covered
                    ? regions.length === 0
                      ? "No flagged regions in the screened genes · GRCh38 reference sequence"
                      : "GRCh38 reference · Alternate allele shown separately"
                    : regions.length === 0
                      ? "No flagged regions in the screened genes. Reference sequence is unavailable here."
                      : "Reference unavailable here · N = unknown base"
                  : "Synthetic sequence · Upload a genome to map findings"}
              </p>
            </footer>
          </div>
          {findingCards.length > 0 && (
            <aside className={styles.inspector} aria-label="Mutation details">
              <section
                className={styles.diseaseCards}
                aria-label="Disease findings"
              >
                {findingCards.map(
                  ([
                    evidenceKey,
                    {
                      annotation: { gene, disease, tier },
                      regions: cardRegions,
                    },
                  ]) => {
                    const carrierAssociation =
                      tier === "carrier"
                        ? reviewedBodyAssociation({ gene, disease })
                        : undefined;
                    const finding = findings?.find(
                      (finding) =>
                        finding.gene === gene && finding.disease === disease,
                    );
                    return (
                      <DiseaseCard
                        key={evidenceKey}
                        gene={gene}
                        name={disease}
                        size="sm"
                        status={tier}
                        artwork={DISEASE_ARTWORK[gene]}
                        location={
                          cardRegions[0] &&
                          `Chr ${cardRegions[0].chromosome}:${format.format(cardRegions[0].start + 1)}`
                        }
                        locations={
                          cardRegions.length > 0 && (
                            <div className={styles.locationButtons}>
                              {cardRegions.map((region) => (
                                <Button
                                  key={region.id}
                                  variant="ghost"
                                  size="xs"
                                  aria-label={`Inspect ${gene} at chr${region.chromosome}:${region.start + 1}`}
                                  aria-pressed={selected?.id === region.id}
                                  data-unseen={
                                    !viewed.has(region.id) || undefined
                                  }
                                  onClick={() => {
                                    selectRegion(region);
                                    visualization.current?.scrollIntoView?.({
                                      block: "start",
                                    });
                                  }}
                                >
                                  <span dir="ltr">
                                    Chr {region.chromosome}:
                                    {format.format(region.start + 1)}
                                    {region.end > region.start + 1
                                      ? `–${format.format(region.end)}`
                                      : ""}
                                  </span>
                                </Button>
                              ))}
                            </div>
                          )
                        }
                        notice={
                          carrierAssociation && (
                            <>
                              Carrier finding · Associated region shown in red
                              <span className="sr-only">
                                {": "}
                                {carrierAssociation.regions
                                  .map(
                                    ({ regionId }) =>
                                      getAnatomyRegion(regionId).label,
                                  )
                                  .join(", ")}
                              </span>
                            </>
                          )
                        }
                        open={evidence === evidenceKey}
                        onOpenChange={(open) =>
                          setEvidence(open ? evidenceKey : null)
                        }
                      >
                        <FindingReport
                          finding={finding}
                          regions={cardRegions}
                        />
                        {tier !== "carrier" &&
                          !finding?.crispr?.length &&
                          crisprGenes.some((item) => item.gene === gene) && (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setEvidence(null);
                                setCrisprGene(gene);
                              }}
                            >
                              Open editing studio
                            </Button>
                          )}
                      </DiseaseCard>
                    );
                  },
                )}
              </section>
            </aside>
          )}
        </div>
      </div>
      <CrisprDrawer
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
