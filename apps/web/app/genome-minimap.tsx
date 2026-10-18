"use client";

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { GenomeChromosome } from "@crispr/human-model/dna-sequence";
import type { GenomeRegion } from "./genome-analysis/genome-view";
import styles from "./genome-minimap.module.css";

const format = new Intl.NumberFormat("en-US");
const HANDLE_GRAB_PX = 10; // a press this close to the handle grabs it instead of jumping
const DRAG_THRESHOLD_PX = 4; // a press on a marker only becomes a drag after this much travel

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
  // `pending` presses started on a finding marker: a click selects it, a drag scrubs instead.
  const press = useRef<{
    id: number;
    x: number;
    offset: number;
    pending: boolean;
  } | null>(null);
  const current = regions.filter(
    (region) => region.chromosome === chromosome.id,
  );
  const span = Math.max(1, chromosome.length - 1);

  function track() {
    const rect = map.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect : null;
  }

  function atX(clientX: number) {
    const rect = track();
    if (!rect) return position;
    const fraction = (clientX - rect.left) / rect.width;
    return Math.round(Math.min(1, Math.max(0, fraction)) * span);
  }

  function beginDrag(event: PointerEvent, jump: boolean) {
    const state = press.current;
    if (!state) return;
    state.pending = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    if (jump) onNavigate(atX(event.clientX + state.offset));
  }

  function endDrag() {
    press.current = null;
    setDragging(false);
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
        // Pressing the track or the handle grabs it, keeping the grab point on the handle; a
        // finding marker still selects on click but scrubs if it is dragged instead.
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const rect = track();
          const handleX = rect
            ? rect.left + (displayPosition / span) * rect.width
            : event.clientX;
          const onHandle = Math.abs(event.clientX - handleX) <= HANDLE_GRAB_PX;
          press.current = {
            id: event.pointerId,
            x: event.clientX,
            offset: onHandle ? handleX - event.clientX : 0,
            pending: event.target instanceof HTMLButtonElement,
          };
          if (!press.current.pending) beginDrag(event, !onHandle);
        }}
        onPointerMove={(event) => {
          const state = press.current;
          if (state?.id !== event.pointerId) return;
          if (state.pending) {
            if (Math.abs(event.clientX - state.x) < DRAG_THRESHOLD_PX) return;
            beginDrag(event, false);
          }
          onNavigate(atX(event.clientX + state.offset));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
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
