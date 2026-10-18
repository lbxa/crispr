"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PhoneIcon } from "lucide-react";
import { toast } from "@crispr/ui/components/sonner";
import { getAnatomyRegion } from "@crispr/human-model/anatomy";
import type { ModelProfile } from "@crispr/human-model/profiles";
import { ManagedWidgetGrid } from "@crispr/widget-grid/managed-react";
import { WidgetGrid } from "@crispr/widget-grid/react";
import { FileDropCard } from "./file-drop-card";
import { DateCard } from "./date-card";
import { GenomeLibraryCard } from "./genome-library/card";
import { SymptomsCard } from "./symptoms-card";
import { GenomeExplorer } from "./genome-explorer";
import { GenomeSummaryCard } from "./genome-analysis/summary-card";
import { useGenomeAnalysis } from "./genome-analysis/use-genome-analysis";
import { bodyHighlights } from "./genome-analysis/body-map";
import { ThemeToggle } from "./theme-toggle";
import styles from "./page.module.css";

// The application shell and controls hydrate without downloading Three.js.
const HumanModel = dynamic(
  () => import("@crispr/human-model").then((module) => module.HumanModel),
  {
    ssr: false,
    loading: () => (
      <p className={styles.loading} role="status">
        Preparing 3D anatomy…
      </p>
    ),
  },
);

const PANES = ["left", "right"] as const;
type Pane = (typeof PANES)[number];
// 360px files + 548px studio + 440px anatomy + 64px margins + 28px gaps.
const SHARED_WORKSPACE_QUERY = "(min-width: 90rem)";

function subscribeToWorkspaceWidth(onChange: () => void) {
  const media = window.matchMedia(SHARED_WORKSPACE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSharedWorkspace() {
  return window.matchMedia(SHARED_WORKSPACE_QUERY).matches;
}

function getServerSharedWorkspace() {
  return false;
}

export function ModelWorkspace({
  modelUrls,
}: {
  modelUrls: Record<ModelProfile, string>;
}) {
  const {
    analysis,
    analyze,
    prepareLibraryGenome,
    libraryLoading,
    libraryError,
    retry,
    pause,
    resume,
    cancel,
    clear,
    cacheError,
    cacheSaved,
    cacheReady,
    downloadReport,
  } = useGenomeAnalysis();
  const genomeFile = analysis.status === "idle" ? null : analysis.file;
  const profile: ModelProfile =
    analysis.status === "complete"
      ? (analysis.report.genome.model_profile ?? "male")
      : "male";
  const highlights = useMemo(
    () =>
      analysis.status === "complete" ? bodyHighlights(analysis.report) : [],
    [analysis],
  );
  const hasDiseaseFindings =
    analysis.status === "complete" &&
    analysis.report.findings.some(({ tier }) => tier !== "carrier");
  // Disease associations remain visible even when no symptom predictions exist.
  const noPredictedSymptoms =
    analysis.status === "complete" &&
    !hasDiseaseFindings &&
    highlights.length === 0 &&
    (analysis.report.predicted_symptoms?.length ?? 0) === 0;
  const bodyMappingNotice =
    highlights.length > 0
      ? highlights.every(({ association }) => association === "carrier")
        ? null
        : "Disease-associated regions shown in red"
      : hasDiseaseFindings
        ? analysis.status === "complete" &&
          analysis.report.body_map?.status === "mapped"
          ? "No supported body regions mapped"
          : "Body region mapping unavailable. Analyze this genome again."
        : null;
  const sharedWorkspace = useSyncExternalStore(
    subscribeToWorkspaceWidth,
    getSharedWorkspace,
    getServerSharedWorkspace,
  );
  // The file pane starts open so a first-time visitor sees where to upload a genome.
  const [openPanes, setOpenPanes] = useState<readonly Pane[]>(["left"]);
  const visiblePanes = sharedWorkspace ? openPanes : openPanes.slice(-1);
  const paneLayout =
    visiblePanes.length === 2 ? "both" : (visiblePanes[0] ?? "none");
  const [genomeOpened, setGenomeOpened] = useState(false);
  const [genomeSelection, setGenomeSelection] = useState(0);
  const paneToggles = useRef<Record<Pane, HTMLButtonElement | null>>({
    left: null,
    right: null,
  });

  function selectGenome(file: File) {
    setGenomeSelection((current) => current + 1);
    setGenomeOpened(true);
    setOpenPanes((current) =>
      sharedWorkspace
        ? [...current.filter((pane) => pane !== "right"), "right"]
        : ["right"],
    );
    void analyze(file);
  }

  return (
    <div
      className={styles.workspace}
      data-pane={paneLayout}
      data-genome-cached={cacheSaved || undefined}
      data-genome-cache-ready={cacheReady || undefined}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          visiblePanes.length > 0 &&
          !(
            event.target instanceof Element &&
            event.target.closest("[popover], [role=dialog]")
          )
        ) {
          const target =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-side]")?.dataset.side
              : undefined;
          const closingPane =
            (target === "left" || target === "right") &&
            visiblePanes.includes(target)
              ? target
              : visiblePanes.at(-1)!;
          setOpenPanes((current) =>
            sharedWorkspace
              ? current.filter((pane) => pane !== closingPane)
              : [],
          );
          paneToggles.current[closingPane]?.focus();
        }
      }}
    >
      <div
        className={styles.paneToggles}
        role="group"
        aria-label="Workspace controls"
      >
        <ThemeToggle className={styles.paneToggle} />
        {PANES.map((side) => (
          <button
            key={side}
            ref={(button) => {
              paneToggles.current[side] = button;
            }}
            type="button"
            className={styles.paneToggle}
            data-side={side}
            aria-label={`${side === "left" ? "Left" : "Right"} pane`}
            aria-controls={`workspace-pane-${side}`}
            aria-expanded={visiblePanes.includes(side)}
            onClick={() => {
              if (side === "right") setGenomeOpened(true);
              setOpenPanes((current) => {
                const visible = sharedWorkspace ? current : current.slice(-1);
                if (visible.includes(side)) {
                  return sharedWorkspace
                    ? current.filter((pane) => pane !== side)
                    : [];
                }
                return sharedWorkspace ? [...current, side] : [side];
              });
            }}
          >
            <span
              className={styles.paneIcon}
              data-side={side}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <section
        className={styles.stage}
        aria-label="3D anatomy workspace"
        data-phenotype={noPredictedSymptoms ? "none" : undefined}
      >
        <HumanModel
          profile={profile}
          modelUrl={modelUrls[profile]}
          highlights={highlights}
        />
        {noPredictedSymptoms && (
          <p className={styles.phenotypeNotice} role="status">
            No phenotypic symptoms predicted
          </p>
        )}
        {bodyMappingNotice && (
          <p className={styles.phenotypeNotice} role="status">
            {bodyMappingNotice}
            {highlights.length > 0 && (
              <span className={styles.srOnly}>
                {": "}
                {highlights
                  .map(({ regionId }) => getAnatomyRegion(regionId).label)
                  .join(", ")}
              </span>
            )}
          </p>
        )}
      </section>
      {PANES.map((side) => (
        <section
          key={side}
          id={`workspace-pane-${side}`}
          className={styles.pane}
          data-side={side}
          data-open={visiblePanes.includes(side)}
          aria-label={`${side === "left" ? "Left" : "Right"} workspace pane`}
          aria-hidden={!visiblePanes.includes(side)}
          inert={!visiblePanes.includes(side)}
        >
          {side === "left" && (
            <>
              {cacheError && (
                <p className={styles.cacheNotice} role="status">
                  {cacheError}
                </p>
              )}
              <ManagedWidgetGrid
                defaultOrder={
                  genomeFile
                    ? [
                        "files",
                        "library",
                        "symptoms",
                        "call-doctor",
                        "date",
                        "summary",
                      ]
                    : ["files", "library", "symptoms", "call-doctor", "date"]
                }
                disabled={!visiblePanes.includes(side)}
                aria-label="Left widgets"
                gap={32}
              >
                <WidgetGrid.Item
                  id="files"
                  size="small"
                  label="Files"
                  className={styles.widget}
                >
                  <span className={styles.widgetGrip} aria-hidden="true" />
                  <FileDropCard file={genomeFile} onFileSelect={selectGenome} />
                </WidgetGrid.Item>
                <WidgetGrid.Item
                  id="library"
                  size="small"
                  label="Genome library"
                  className={styles.widget}
                >
                  <span className={styles.widgetGrip} aria-hidden="true" />
                  <GenomeLibraryCard
                    loading={libraryLoading}
                    error={libraryError}
                    selectedFileName={genomeFile?.name}
                    onSelect={async (genome) => {
                      const file = await prepareLibraryGenome(genome);
                      if (file) selectGenome(file);
                    }}
                  />
                </WidgetGrid.Item>
                <WidgetGrid.Item
                  id="symptoms"
                  size="wide"
                  label="Symptoms"
                  className={styles.widget}
                >
                  <span className={styles.widgetGrip} aria-hidden="true" />
                  <SymptomsCard />
                </WidgetGrid.Item>
                <WidgetGrid.Item
                  id="call-doctor"
                  size="small"
                  label="Doctor contact"
                  className={styles.widget}
                >
                  <span className={styles.widgetGrip} aria-hidden="true" />
                  <button
                    type="button"
                    className={styles.callDoctor}
                    onClick={() =>
                      toast.info("Doctor calls are coming soon.", {
                        id: "call-doctor",
                        position: "top-center",
                      })
                    }
                  >
                    <PhoneIcon size={28} strokeWidth={1.5} aria-hidden="true" />
                    <span>Call doctor</span>
                  </button>
                </WidgetGrid.Item>
                <WidgetGrid.Item
                  id="date"
                  size="small"
                  label="Current date"
                  className={styles.widget}
                >
                  <span className={styles.widgetGrip} aria-hidden="true" />
                  <DateCard />
                </WidgetGrid.Item>
                {genomeFile && analysis.status !== "idle" && (
                  <WidgetGrid.Item
                    id="summary"
                    size="normal"
                    label="Analysis summary"
                    className={styles.widget}
                  >
                    <span className={styles.widgetGrip} aria-hidden="true" />
                    <GenomeSummaryCard
                      analysis={analysis}
                      onDownloadReport={downloadReport}
                      onRetry={retry}
                      onPause={pause}
                      onResume={resume}
                      onCancel={cancel}
                      onClear={() => {
                        void clear().then(() =>
                          paneToggles.current.left?.focus(),
                        );
                      }}
                    />
                  </WidgetGrid.Item>
                )}
              </ManagedWidgetGrid>
            </>
          )}
          {side === "right" && genomeOpened && (
            <GenomeExplorer
              key={genomeSelection}
              active={visiblePanes.includes("right")}
              hasGenome={genomeFile !== null}
              loading={
                analysis.status === "uploading" ||
                analysis.status === "queued" ||
                analysis.status === "processing"
              }
              report={
                analysis.status === "complete" ? analysis.report : undefined
              }
              onDownloadReport={downloadReport}
            />
          )}
        </section>
      ))}
    </div>
  );
}
