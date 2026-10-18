"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { GenomeChromosome } from "@crispr/human-model/dna-sequence";
import type { GenomeRegion } from "../genome-analysis/genome-view";
import { KARYOTYPE_GEOMETRY } from "./karyotype-data";
import styles from "./karyotype-navigator.module.css";

export type KaryotypeSex = "male" | "female";
type Parent = "maternal" | "paternal";

// The 46-chromosome strip, drawn to GRCh38 scale (chromosome 1 = 180 px) and aligned on
// centromeres. Arms are vertical; only each centromere bows toward its partner's.
const SCALE = 180 / 248_956_422;
const CHR_W = 10; // chromatid width
const GAP = 6; // space between the two copies of a pair
const BEND = 4.5; // how far each centromere bows toward its partner
const NECK = 8; // height of the curved centromere
const COL = 58; // horizontal space per pair
const MARGIN = 16;
const HIT_PAD = 4; // extra clickable width either side of a chromosome
const LABEL_GAP = 16; // from the lowest chromosome tip to the "Chr." captions
const LABEL_LINE = 12; // from each "Chr." caption down to its number
const R = CHR_W / 2;

const GEOMETRY = new Map(KARYOTYPE_GEOMETRY.map((item) => [item.id, item]));
const AUTOSOMES = KARYOTYPE_GEOMETRY.filter(({ id }) => /^\d+$/.test(id)).map(
  ({ id }) => id,
);

type Homolog = { id: string; parent: Parent; cx: number; lean: number };
type Pair = { id: string; homologs: [Homolog, Homolog] };

function pairsFor(sex: KaryotypeSex): Pair[] {
  const ids = [...AUTOSOMES, sex === "male" ? "XY" : "XX"];
  return ids.map((id, index) => {
    const centre = MARGIN + index * COL + COL / 2;
    const offset = (CHR_W + GAP) / 2;
    const [maternal, paternal] =
      id === "XY" ? ["X", "Y"] : id === "XX" ? ["X", "X"] : [id, id];
    return {
      id,
      homologs: [
        { id: maternal, parent: "maternal", cx: centre - offset, lean: BEND },
        { id: paternal, parent: "paternal", cx: centre + offset, lean: -BEND },
      ],
    };
  });
}

/** Where a homolog sits: its top and bottom, with every centromere on one line. */
function span(id: string, centromereY: number) {
  const { length, centromere } = GEOMETRY.get(id as never)!;
  const top = centromereY - centromere * SCALE;
  return { top, bottom: top + length * SCALE };
}

function layout(pairs: Pair[]) {
  const ids = pairs.flatMap(({ homologs }) => homologs.map(({ id }) => id));
  const above = Math.max(
    ...ids.map((id) => GEOMETRY.get(id as never)!.centromere),
  );
  const below = Math.max(
    ...ids.map((id) => {
      const item = GEOMETRY.get(id as never)!;
      return item.length - item.centromere;
    }),
  );
  const centromereY = MARGIN + above * SCALE;
  const labelY = centromereY + below * SCALE + LABEL_GAP;
  return {
    centromereY,
    labelY,
    width: pairs.length * COL + 2 * MARGIN,
    height: labelY + LABEL_LINE + MARGIN - 6,
  };
}

function chromosomePaths(homolog: Homolog, centromereY: number) {
  const { cx, lean } = homolog;
  const { top, bottom } = span(homolog.id, centromereY);
  const neckTop = centromereY - NECK / 2;
  const neckBottom = centromereY + NECK / 2;
  const k = NECK / 2;
  // Round caps add R to each end, so arm centrelines stop R short of the tips and the neck.
  return {
    arms: [
      `M${cx},${top + R} L${cx},${Math.max(top + R, neckTop - R)}`,
      `M${cx},${Math.min(bottom - R, neckBottom + R)} L${cx},${bottom - R}`,
    ],
    neck:
      `M${cx},${neckTop - 1.5} C${cx},${neckTop + k * 0.4} ${cx + lean},${centromereY - k * 0.6} ` +
      `${cx + lean},${centromereY} C${cx + lean},${centromereY + k * 0.6} ${cx},${neckBottom - k * 0.4} ` +
      `${cx},${neckBottom + 1.5}`,
  };
}

/** Which drawn copies carry a finding: both when homozygous, otherwise the first copy. */
function carriers(pairs: Pair[], region: GenomeRegion) {
  const copies = pairs
    .flatMap(({ homologs }) => homologs)
    .filter(({ id }) => id === region.chromosome);
  return region.zygosity === "homozygous" ? copies : copies.slice(0, 1);
}

export function KaryotypeNavigator({
  chromosomes,
  current,
  position,
  regions,
  unseen,
  sex,
  onNavigate,
  onChoose,
  onSelect,
}: {
  /** Chromosomes the explorer can show, with the lengths it navigates in. */
  chromosomes: readonly GenomeChromosome[];
  current: string;
  /** Where the helix is, drawn as a cursor across the current pair. */
  position: number;
  regions: readonly GenomeRegion[];
  /** Region ids the user has not looked at yet. */
  unseen?: ReadonlySet<string>;
  sex: KaryotypeSex;
  /** A clicked point (`animate`) or a keyboard jump to a chromosome end. */
  onNavigate: (
    chromosome: string,
    position: number,
    options: { animate: boolean },
  ) => void;
  /** Keyboard selection of a whole chromosome; the explorer picks where to land. */
  onChoose: (chromosome: string) => void;
  onSelect: (region: GenomeRegion) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLElement>(null);
  // The browser's own SVG tooltips wait about a second; this one shows as soon as the pointer arrives.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  const pairs = pairsFor(sex);
  const { centromereY, labelY, width, height } = layout(pairs);
  const lengths = new Map(chromosomes.map(({ id, length }) => [id, length]));

  // Keep the chromosome on show in view, including after a jump from the findings list.
  useEffect(() => {
    const strip = scroller.current;
    const index = pairsFor(sex).findIndex(({ homologs }) =>
      homologs.some(({ id }) => id === current),
    );
    if (!strip || index < 0 || typeof strip.scrollTo !== "function") return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    strip.scrollTo({
      left: MARGIN + index * COL + COL / 2 - strip.clientWidth / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [current, sex]);

  function yOf(id: string, base: number) {
    const { top, bottom } = span(id, centromereY);
    const length = lengths.get(id) ?? GEOMETRY.get(id as never)!.length;
    return (
      top + (Math.min(Math.max(base, 0), length) / length) * (bottom - top)
    );
  }

  function clickPoint(id: string, event: MouseEvent<SVGRectElement>) {
    const length = lengths.get(id);
    const rect = event.currentTarget.getBoundingClientRect();
    if (!length || rect.height <= 0) return;
    const fraction = Math.min(
      1,
      Math.max(0, (event.clientY - rect.top) / rect.height),
    );
    onNavigate(id, Math.round(fraction * (length - 1)), { animate: true });
  }

  function showTip(text: string, event: PointerEvent) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    const edge = 70; // keep the label inside the pane near its sides
    setTip({
      text,
      x: Math.min(
        Math.max(event.clientX - rect.left, edge),
        Math.max(edge, rect.width - edge),
      ),
      y: event.clientY - rect.top,
    });
  }

  function hoverHandlers(text: string) {
    return {
      onPointerEnter: (event: PointerEvent) => showTip(text, event),
      onPointerMove: (event: PointerEvent) => showTip(text, event),
      onPointerLeave: () => setTip(null),
    };
  }

  function pairKeys(id: string, event: KeyboardEvent) {
    const length = lengths.get(id);
    if (!length) return;
    if (event.key === "Enter" || event.key === " ") onChoose(id);
    else if (event.key === "Home") onNavigate(id, 0, { animate: false });
    else if (event.key === "End")
      onNavigate(id, length - 1, { animate: false });
    else return;
    event.preventDefault();
  }

  const shown = pairs.find(({ homologs }) =>
    homologs.some(({ id }) => id === current),
  );

  return (
    <section ref={frame} className={styles.navigator} aria-label="Chromosomes">
      <div
        ref={scroller}
        className={styles.strip}
        onScroll={() => setTip(null)}
      >
        <svg
          className={styles.karyotype}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="group"
          aria-label={`Karyotype, 46,${sex === "male" ? "XY" : "XX"}`}
        >
          {pairs.map((pair) => {
            // Both copies of a pair navigate the same chromosome; the sex pair holds two ids.
            const ids = [...new Set(pair.homologs.map(({ id }) => id))];
            return ids.map((id) => {
              const copies = pair.homologs.filter(
                (homolog) => homolog.id === id,
              );
              const enabled = lengths.has(id);
              const isCurrent = id === current;
              const { top, bottom } = span(id, centromereY);
              const left =
                Math.min(...copies.map(({ cx }) => cx)) - R - HIT_PAD;
              const right =
                Math.max(...copies.map(({ cx }) => cx)) + R + HIT_PAD;
              return (
                <g
                  key={`${pair.id}-${id}`}
                  className={styles.pair}
                  role="button"
                  tabIndex={enabled ? 0 : -1}
                  aria-label={`Chromosome ${id}`}
                  aria-pressed={isCurrent}
                  aria-disabled={!enabled || undefined}
                  data-chromosome={id}
                  onKeyDown={(event) => pairKeys(id, event)}
                >
                  <rect
                    className={styles.backdrop}
                    x={left - 3}
                    y={top - 6}
                    width={right - left + 6}
                    height={bottom - top + 12}
                    rx={8}
                    data-current={isCurrent || undefined}
                  />
                  {copies.map((homolog) => {
                    const { arms, neck } = chromosomePaths(
                      homolog,
                      centromereY,
                    );
                    return (
                      <g
                        key={homolog.parent}
                        aria-hidden="true"
                        data-homolog={`${id}-${homolog.parent}`}
                        // The pair's button carries the accessible name; this is the hover label.
                        {...hoverHandlers(
                          `Chromosome ${id}, ${homolog.parent}${enabled ? "" : " · not in this genome"}`,
                        )}
                      >
                        {[...arms, neck].map((d, index) => (
                          <path
                            key={`edge-${index}`}
                            className={styles.edge}
                            d={d}
                            strokeWidth={(index < 2 ? CHR_W : 3.5) + 1.5}
                          />
                        ))}
                        {[...arms, neck].map((d, index) => (
                          <path
                            key={`fill-${index}`}
                            className={styles.fill}
                            d={d}
                            strokeWidth={index < 2 ? CHR_W : 3.5}
                          />
                        ))}
                        {enabled && (
                          <rect
                            className={styles.hit}
                            data-testid={`karyotype-${id}-${homolog.parent}`}
                            x={homolog.cx - R - HIT_PAD}
                            y={top}
                            width={CHR_W + 2 * HIT_PAD}
                            height={bottom - top}
                            onClick={(event) => clickPoint(id, event)}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            });
          })}
          <g className={styles.labels} aria-hidden="true">
            {pairs.flatMap(({ id, homologs }) => {
              // Autosomes get one number per pair; the sex pair labels each copy (X Y or X X)
              // under a single shared "Chr." caption.
              const centre = (homologs[0].cx + homologs[1].cx) / 2;
              const marks = /^\d+$/.test(id)
                ? [{ text: id, x: centre }]
                : homologs.map(({ id: copy, cx }) => ({ text: copy, x: cx }));
              const ids = marks.map(({ text }) => text);
              return [
                <text
                  key={`${id}-caption`}
                  className={styles.caption}
                  x={centre}
                  y={labelY}
                  textAnchor="middle"
                  data-current={ids.includes(current) || undefined}
                  data-absent={
                    ids.every((copy) => !lengths.has(copy)) || undefined
                  }
                >
                  Chr.
                </text>,
                ...marks.map(({ text, x }, index) => (
                  <text
                    key={`${id}-${index}`}
                    x={x}
                    y={labelY + LABEL_LINE}
                    textAnchor="middle"
                    data-current={text === current || undefined}
                    data-absent={!lengths.has(text) || undefined}
                  >
                    {text}
                  </text>
                )),
              ];
            })}
          </g>
          {shown && lengths.has(current) && (
            <g
              className={styles.cursor}
              data-testid="karyotype-cursor"
              data-position={Math.round(position)}
              aria-hidden="true"
            >
              {shown.homologs
                .filter(({ id }) => id === current)
                .map(({ cx, parent }) => (
                  <line
                    key={parent}
                    x1={cx - R - 3}
                    x2={cx + R + 3}
                    y1={yOf(current, position)}
                    y2={yOf(current, position)}
                  />
                ))}
            </g>
          )}
          {regions.map((region) =>
            carriers(pairs, region).map((homolog, index) => {
              const genes = [
                ...new Set(region.annotations.map(({ gene }) => gene)),
              ].join(", ");
              const diseases = [
                ...new Set(region.annotations.map(({ disease }) => disease)),
              ].join("; ");
              // A homozygous finding marks both copies; only the first is in the tab order.
              const primary = index === 0;
              return (
                <g
                  key={`${region.id}-${homolog.parent}`}
                  transform={`translate(${homolog.cx} ${yOf(region.chromosome, region.start)})`}
                >
                  {/* The ping sits outside the clickable group so the button's bounds stay still. */}
                  <circle className={styles.ring} r={3.5} aria-hidden="true" />
                  <g
                    className={styles.dot}
                    role={primary ? "button" : undefined}
                    tabIndex={primary ? 0 : -1}
                    aria-hidden={primary ? undefined : true}
                    aria-label={
                      primary
                        ? `Jump to ${genes} at chr${region.chromosome}:${region.start + 1}`
                        : undefined
                    }
                    data-region={region.id}
                    data-copy={homolog.parent}
                    data-unseen={unseen?.has(region.id) || undefined}
                    {...hoverHandlers(
                      `${genes} · ${diseases} · chr${region.chromosome}:${region.start + 1}`,
                    )}
                    onClick={() => onSelect(region)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect(region);
                    }}
                  >
                    <circle className={styles.dotHit} r={8} />
                    <circle className={styles.core} r={3.5} />
                  </g>
                </g>
              );
            }),
          )}
        </svg>
      </div>
      {tip && (
        <div
          className={styles.tooltip}
          data-testid="karyotype-tooltip"
          aria-hidden="true"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </section>
  );
}
