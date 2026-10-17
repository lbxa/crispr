"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import {
  ANATOMY_REGIONS,
  type AnatomyRegionId,
} from "@crispr/human-model/anatomy";
import type { ModelProfile } from "@crispr/human-model/profiles";
import type { HumanModelHighlight } from "@crispr/human-model";
import { ManagedWidgetGrid } from "@crispr/widget-grid/managed-react";
import { WidgetGrid } from "@crispr/widget-grid/react";
import { FileDropCard } from "./file-drop-card";
import { GenomeExplorer } from "./genome-explorer";
import { GenomeSummaryCard } from "./genome-analysis/summary-card";
import { useGenomeAnalysis } from "./genome-analysis/use-genome-analysis";
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

const REGIONS = ANATOMY_REGIONS.filter(
  ({ id }) => id !== "skin" && id !== "whole_body",
);
const PANES = ["left", "right"] as const;
// Temporarily disabled: manual anatomy highlighting is a developer tool.
const SHOW_DEV_REGION_CONTROLS = false;

export function ModelWorkspace({
  modelUrls,
}: {
  modelUrls: Record<ModelProfile, string>;
}) {
  const { analysis, analyze, retry, pause, resume, cancel } =
    useGenomeAnalysis();
  const genomeFile = analysis.status === "idle" ? null : analysis.file;
  const profile: ModelProfile =
    analysis.status === "complete"
      ? (analysis.report.genome.model_profile ?? "male")
      : "male";
  const [activePane, setActivePane] = useState<(typeof PANES)[number] | null>(
    null,
  );
  const [genomeOpened, setGenomeOpened] = useState(false);
  const [genomeSelection, setGenomeSelection] = useState(0);
  const paneToggles = useRef<
    Record<(typeof PANES)[number], HTMLButtonElement | null>
  >({
    left: null,
    right: null,
  });
  const [highlights, setHighlights] = useState<readonly HumanModelHighlight[]>(
    [],
  );

  function toggleRegion(regionId: AnatomyRegionId) {
    setHighlights((current) =>
      current.some((region) => region.regionId === regionId)
        ? current.filter((region) => region.regionId !== regionId)
        : [...current, { regionId, color: "#5ec8b0" }],
    );
  }

  return (
    <div
      className={styles.workspace}
      data-pane={activePane ?? "none"}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          activePane &&
          !(
            event.target instanceof Element && event.target.closest("[popover]")
          )
        ) {
          setActivePane(null);
          paneToggles.current[activePane]?.focus();
        }
      }}
    >
      <div
        className={styles.paneToggles}
        role="group"
        aria-label="Workspace panes"
      >
        {PANES.map((side) => (
          <button
            key={side}
            ref={(button) => {
              paneToggles.current[side] = button;
            }}
            type="button"
            className={styles.paneToggle}
            aria-label={`${side === "left" ? "Left" : "Right"} pane`}
            aria-controls={`workspace-pane-${side}`}
            aria-expanded={activePane === side}
            onClick={() => {
              if (side === "right") setGenomeOpened(true);
              setActivePane((current) => (current === side ? null : side));
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
      <section className={styles.stage} aria-label="3D anatomy workspace">
        <HumanModel
          profile={profile}
          modelUrl={modelUrls[profile]}
          highlights={highlights}
        />
      </section>
      {PANES.map((side) => (
        <section
          key={side}
          id={`workspace-pane-${side}`}
          className={styles.pane}
          data-side={side}
          aria-label={`${side === "left" ? "Left" : "Right"} workspace pane`}
          aria-hidden={activePane !== side}
          inert={activePane !== side}
        >
          {side === "left" && (
            <ManagedWidgetGrid
              defaultOrder={genomeFile ? ["files", "summary"] : ["files"]}
              disabled={activePane !== side}
              aria-label="Left widgets"
            >
              <WidgetGrid.Item
                id="files"
                size="normal"
                label="Files"
                className={styles.widget}
              >
                <span className={styles.widgetGrip} aria-hidden="true" />
                <FileDropCard
                  file={genomeFile}
                  onFileSelect={(file) => {
                    setGenomeSelection((current) => current + 1);
                    void analyze(file);
                  }}
                />
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
                    onRetry={retry}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                </WidgetGrid.Item>
              )}
            </ManagedWidgetGrid>
          )}
          {side === "right" && genomeOpened && (
            <GenomeExplorer
              key={genomeSelection}
              active={activePane === "right"}
              hasGenome={genomeFile !== null}
              report={
                analysis.status === "complete" ? analysis.report : undefined
              }
            />
          )}
        </section>
      ))}
      {SHOW_DEV_REGION_CONTROLS && (
        <>
          <aside className={styles.controls} aria-label="Anatomy controls">
            <button
              type="button"
              popoverTarget="anatomy-regions"
              className={styles.regionsTrigger}
            >
              Regions
              {highlights.length > 0 && (
                <span className={styles.selectionCount} aria-hidden="true">
                  {highlights.length}
                </span>
              )}
              <span className={styles.chevron} aria-hidden="true" />
            </button>
          </aside>
          <div
            id="anatomy-regions"
            popover="auto"
            className={styles.regionsPanel}
          >
            <div className={styles.regionsHeader}>
              <h2>Highlight regions</h2>
              <button
                type="button"
                disabled={highlights.length === 0}
                onClick={() => setHighlights([])}
              >
                Clear selection
              </button>
            </div>
            <fieldset className={styles.regions}>
              <legend className={styles.srOnly}>Anatomical regions</legend>
              {REGIONS.map((region) => (
                <label key={region.id} className={styles.region}>
                  <input
                    type="checkbox"
                    value={region.id}
                    checked={highlights.some(
                      (highlight) => highlight.regionId === region.id,
                    )}
                    onChange={() => toggleRegion(region.id)}
                  />
                  <span>{region.label}</span>
                </label>
              ))}
            </fieldset>
          </div>
          <p className={styles.srOnly} role="status">
            {highlights.length} {highlights.length === 1 ? "region" : "regions"}{" "}
            selected
          </p>
        </>
      )}
    </div>
  );
}
