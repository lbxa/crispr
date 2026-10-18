"use client";

import type { CSSProperties } from "react";
import type { GenomeChromosome } from "@crispr/human-model/dna-sequence";
import type { GenomeRegion } from "./genome-analysis/genome-view";
import styles from "./genome-minimap.module.css";

const format = new Intl.NumberFormat("en-US");

export function GenomeMinimap({
  chromosome,
  regions,
  position,
  onNavigate,
  onSelect,
}: {
  chromosome: GenomeChromosome;
  regions: readonly GenomeRegion[];
  position: number;
  onNavigate: (position: number) => void;
  onSelect: (region: GenomeRegion) => void;
}) {
  const current = regions.filter(
    (region) => region.chromosome === chromosome.id,
  );
  return (
    <section className={styles.minimap} aria-label="Chromosome minimap">
      <div className={styles.caption}>
        <span>Chr {chromosome.id}</span>
        <span>
          {current.length} {current.length === 1 ? "region" : "regions"}
        </span>
      </div>
      <div className={styles.map}>
        <div className={styles.rail} aria-hidden="true" />
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={chromosome.length - 1}
          step={1}
          value={position}
          aria-label="Position in chromosome"
          aria-valuetext={`Chromosome ${chromosome.id}, base ${format.format(position + 1)} of ${format.format(chromosome.length)}`}
          onChange={(event) => onNavigate(Number(event.target.value))}
        />
        {current.map((region) => (
          <button
            key={region.id}
            type="button"
            className={styles.marker}
            aria-label={`Jump to ${region.annotations.map(({ gene }) => gene).join(", ")} at chr${chromosome.id}:${region.start + 1}`}
            title={`${region.annotations[0]!.gene} · ${format.format(region.start + 1)}–${format.format(region.end)} bp`}
            aria-pressed={position >= region.start && position < region.end}
            onClick={() => onSelect(region)}
            style={
              {
                left: `${(region.start / Math.max(1, chromosome.length - 1)) * 100}%`,
                "--region-width": `${Math.max(0, ((region.end - region.start) / chromosome.length) * 100)}%`,
              } as CSSProperties
            }
          />
        ))}
        <span
          className={styles.cursor}
          aria-hidden="true"
          style={{
            left: `${(position / Math.max(1, chromosome.length - 1)) * 100}%`,
          }}
        />
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>1</span>
        <span>{format.format(chromosome.length)}</span>
      </div>
    </section>
  );
}
