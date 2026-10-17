"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  ANATOMY_REGIONS,
  type AnatomyRegionId,
} from "@crispr/human-model/anatomy";
import {
  MODEL_PROFILES,
  type ModelProfile,
} from "@crispr/human-model/profiles";
import type { HumanModelHighlight } from "@crispr/human-model";
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

export function ModelWorkspace({
  modelUrls,
}: {
  modelUrls: Record<ModelProfile, string>;
}) {
  const [profile, setProfile] = useState<ModelProfile>("male");
  const [activePane, setActivePane] = useState<(typeof PANES)[number] | null>(
    null,
  );
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
        if (event.key === "Escape" && !event.defaultPrevented) {
          setActivePane(null);
        }
      }}
    >
      <div className={styles.paneToggles} role="group" aria-label="Workspace panes">
        {PANES.map((side) => (
          <button
            key={side}
            type="button"
            className={styles.paneToggle}
            aria-label={`${side === "left" ? "Left" : "Right"} pane`}
            aria-controls={`workspace-pane-${side}`}
            aria-expanded={activePane === side}
            onClick={() =>
              setActivePane((current) => (current === side ? null : side))
            }
          >
            <span className={styles.paneIcon} data-side={side} aria-hidden="true" />
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
        />
      ))}
      <aside className={styles.controls} aria-label="Anatomy controls">
        <fieldset className={styles.profiles}>
          <legend className={styles.srOnly}>Body profile</legend>
          {(["male", "female"] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="profile"
                value={value}
                checked={profile === value}
                onChange={() => setProfile(value)}
              />
              <span>{MODEL_PROFILES[value].label}</span>
            </label>
          ))}
        </fieldset>
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
      <div id="anatomy-regions" popover="auto" className={styles.regionsPanel}>
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
    </div>
  );
}
