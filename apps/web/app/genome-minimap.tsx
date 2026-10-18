"use client";

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { GenomeChromosome } from "@crispr/human-model/dna-sequence";
import type { GenomeRegion } from "./genome-analysis/genome-view";
import styles from "./genome-minimap.module.css";

const format = new Intl.NumberFormat("en-US");

export function GenomeMinimap({
  chromosome,
  regions,
  position,
  displayPosition = position,
  unseen,
  onNavigate,
  onSelect,
}: {
  chromosome: GenomeChromosome;
  regions: readonly GenomeRegion[];
  /** Where the explorer is (or is heading). Drives the slider's value and region state. */
  position: number;
  /** Where the handle is drawn; differs from `position` while the helix slides. */
  displayPosition?: number;
  /** Region ids the user has not looked at yet; their markers pulse. */
  unseen?: ReadonlySet<string>;
  onNavigate: (position: number) => void;
  onSelect: (region: GenomeRegion) => void;
}) {
  const map = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const current = regions.filter(
    (region) => region.chromosome === chromosome.id,
  );
  const span = Math.max(1, chromosome.length - 1);

  function fromPointer(event: PointerEvent) {
    const rect = map.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return position;
    const fraction = (event.clientX - rect.left) / rect.width;
    return Math.round(Math.min(1, Math.max(0, fraction)) * span);
  }

  return (
    <section className={styles.minimap} aria-label="Chromosome minimap">
      <div className={styles.caption}>
        <span>Chr {chromosome.id}</span>
        <span>
          {current.length} {current.length === 1 ? "region" : "regions"}
        </span>
      </div>
      <div
        ref={map}
        className={styles.map}
        data-dragging={dragging || undefined}
        // Pressing the track or the handle grabs it; pressing a marker still selects that region.
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target instanceof HTMLButtonElement)
            return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
          onNavigate(fromPointer(event));
        }}
        onPointerMove={(event) => {
          if (dragging) onNavigate(fromPointer(event));
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
      >
        <div className={styles.rail} aria-hidden="true" />
        {/* Keyboard and screen-reader control; pointer input is handled by the track above. */}
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
            data-unseen={unseen?.has(region.id) || undefined}
            aria-label={`Jump to ${region.annotations.map(({ gene }) => gene).join(", ")} at chr${chromosome.id}:${region.start + 1}`}
            title={`${region.annotations[0]!.gene} · ${format.format(region.start + 1)}–${format.format(region.end)} bp`}
            aria-pressed={position >= region.start && position < region.end}
            onClick={() => onSelect(region)}
            style={
              {
                left: `${(region.start / span) * 100}%`,
                "--region-width": `${Math.max(0, ((region.end - region.start) / chromosome.length) * 100)}%`,
              } as CSSProperties
            }
          />
        ))}
        <span
          className={styles.cursor}
          aria-hidden="true"
          data-testid="minimap-handle"
          style={{ left: `${(displayPosition / span) * 100}%` }}
        />
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>1</span>
        <span>{format.format(chromosome.length)}</span>
      </div>
    </section>
  );
}
