"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { DnaScene } from "./dna-scene";
import {
  BASE_PIXELS,
  SEQUENCE_CHUNK,
  clampGenomePosition,
  genomeScrollWindow,
  genomeSequenceRange,
  validateSequenceWindow,
  type GenomeChromosome,
  type GenomeSequenceSource,
  type DnaInterval,
  type DnaViewMode,
  type SequenceWindow,
} from "./dna-sequence";
import styles from "./dna-helix.module.css";

export interface DnaHelixProps {
  chromosome: GenomeChromosome;
  source: GenomeSequenceSource;
  /** Navigation target, zero-based. Scroll updates are reported separately. */
  navigation: { readonly position: number };
  active: boolean;
  mode?: DnaViewMode;
  highlights?: readonly DnaInterval[];
  onPositionChange: (position: number) => void;
}

/** Key by chromosome id to give each selection an independent scroll/load lifetime. */
export function DnaHelix({
  chromosome,
  source,
  navigation,
  active,
  mode = "helix",
  highlights,
  onPositionChange,
}: DnaHelixProps) {
  const initial = clampGenomePosition(navigation.position, chromosome.length);
  const instructionsId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const runtime = useRef<DnaScene>(null);
  const current = useRef(initial);
  const runway = useRef(genomeScrollWindow(initial, chromosome.length));
  const sequence = useRef<SequenceWindow>(undefined);
  const [scrollState, setScrollState] = useState({
    navigation,
    chunk: Math.floor(initial / SEQUENCE_CHUNK),
  });
  const chunk =
    scrollState.navigation === navigation
      ? scrollState.chunk
      : Math.floor(initial / SEQUENCE_CHUNK);
  const [display, setDisplay] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [sequenceState, setSequenceState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [displayAttempt, setDisplayAttempt] = useState(0);
  const [sequenceAttempt, setSequenceAttempt] = useState(0);
  const initialize = useEffectEvent((scene: DnaScene) => {
    scene.setPosition(current.current, true);
    scene.setMode(mode, true);
    scene.setHighlights(highlights ?? []);
    if (sequence.current) scene.setSequence(sequence.current);
    scene.setActive(active);
  });

  // Synchronizes one canvas lifetime with the external GPU runtime, including Strict Mode replay.
  useEffect(() => {
    let scene: DnaScene | undefined;
    const frame = requestAnimationFrame(() => {
      if (!canvas.current) return;
      try {
        scene = new DnaScene(canvas.current, chromosome.length, () =>
          setDisplay("error"),
        );
        runtime.current = scene;
        initialize(scene);
        setDisplay("ready");
        console.debug("dna_display_ready");
      } catch (error) {
        scene?.dispose();
        setDisplay("error");
        console.warn("dna_display_unavailable", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      runtime.current = null;
      scene?.dispose();
    };
  }, [chromosome.length, displayAttempt]);

  useEffect(() => {
    runtime.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    runtime.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    runtime.current?.setHighlights(highlights ?? []);
  }, [highlights]);

  // Synchronizes explicit navigation with the bounded native scroll surface.
  useEffect(() => {
    const next = clampGenomePosition(navigation.position, chromosome.length);
    current.current = next;
    runway.current = genomeScrollWindow(next, chromosome.length);
    if (viewport.current) viewport.current.scrollTop = runway.current.offset;
    runtime.current?.setPosition(next, true);
  }, [navigation, chromosome.length]);

  // Only one small range is retained; cancellation prevents old selections from winning a race.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const { start, end } = genomeSequenceRange(chunk, chromosome.length);
    void source
      .readRange(chromosome, start, end, controller.signal)
      .then((bases) => {
        if (controller.signal.aborted) return;
        const next = validateSequenceWindow(bases, start, end);
        sequence.current = next;
        runtime.current?.setSequence(next);
        setSequenceState("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSequenceState("error");
        console.warn("dna_sequence_range_failed");
      });
    return () => controller.abort();
  }, [source, chromosome, chunk, active, sequenceAttempt]);

  function scrollToPosition(next: number) {
    current.current = clampGenomePosition(next, chromosome.length);
    runtime.current?.setPosition(current.current);
    const nextChunk = Math.floor(current.current / SEQUENCE_CHUNK);
    if (nextChunk !== chunk || scrollState.navigation !== navigation)
      setScrollState({ navigation, chunk: nextChunk });
    onPositionChange(Math.round(current.current));
    const window = runway.current;
    const local = current.current - window.start;
    if (
      (local < window.span * 0.2 && window.start > 0) ||
      (local > window.span * 0.8 &&
        window.start + window.span < chromosome.length - 1)
    ) {
      runway.current = genomeScrollWindow(current.current, chromosome.length);
      if (viewport.current) viewport.current.scrollTop = runway.current.offset;
    }
  }

  return (
    <div
      className={styles.viewer}
      data-dna-status={display}
      data-dna-mode={mode}
      data-dna-sequence-status={sequenceState}
    >
      <canvas
        key={displayAttempt}
        ref={canvas}
        className={styles.canvas}
        aria-hidden="true"
      />
      <div
        ref={viewport}
        className={styles.scroll}
        role="region"
        aria-label="DNA sequence"
        aria-describedby={instructionsId}
        tabIndex={0}
        onScroll={(event) =>
          scrollToPosition(
            runway.current.start + event.currentTarget.scrollTop / BASE_PIXELS,
          )
        }
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const page = Math.max(
            1,
            Math.floor(event.currentTarget.clientHeight / BASE_PIXELS),
          );
          let next: number;
          switch (event.key) {
            case "Home":
              next = 0;
              break;
            case "End":
              next = chromosome.length - 1;
              break;
            case "ArrowDown":
              next = current.current + 1;
              break;
            case "ArrowUp":
              next = current.current - 1;
              break;
            case "PageDown":
              next = current.current + page;
              break;
            case "PageUp":
              next = current.current - page;
              break;
            default:
              return;
          }
          event.preventDefault();
          next = clampGenomePosition(next, chromosome.length);
          runway.current = genomeScrollWindow(next, chromosome.length);
          event.currentTarget.scrollTop = runway.current.offset;
          scrollToPosition(next);
        }}
      >
        <div
          className={styles.runway}
          style={{
            height: `calc(100% + ${genomeScrollWindow(initial, chromosome.length).span * BASE_PIXELS}px)`,
          }}
        />
      </div>
      <span className={styles.primeLeft} aria-hidden="true">
        5′
      </span>
      <span className={styles.primeRight} aria-hidden="true">
        3′
      </span>
      <div className={styles.focus} aria-hidden="true">
        <span />
        <span />
      </div>
      <div className={styles.ruler} aria-hidden="true" />
      <span id={instructionsId} className={styles.srOnly}>
        Scroll or use arrow and Page keys to travel along the double helix. Home
        and End move to chromosome boundaries.
      </span>
      {display === "loading" && (
        <p className={styles.notice} role="status">
          Preparing double helix…
        </p>
      )}
      {display === "ready" && sequenceState === "loading" && (
        <p className={styles.notice} role="status">
          Loading sequence…
        </p>
      )}
      {display === "ready" && sequenceState === "ready" && (
        <span className={styles.srOnly} role="status">
          3D DNA ready
        </span>
      )}
      {display === "error" && (
        <div className={styles.notice} role="alert">
          <p>The 3D display is unavailable.</p>
          <button
            type="button"
            onClick={() => {
              setDisplay("loading");
              setDisplayAttempt((value) => value + 1);
            }}
          >
            Retry 3D
          </button>
        </div>
      )}
      {sequenceState === "error" && (
        <div className={styles.notice} role="alert">
          <p>This sequence could not be loaded.</p>
          <button
            type="button"
            onClick={() => {
              setSequenceState("loading");
              setSequenceAttempt((value) => value + 1);
            }}
          >
            Retry sequence
          </button>
        </div>
      )}
    </div>
  );
}
