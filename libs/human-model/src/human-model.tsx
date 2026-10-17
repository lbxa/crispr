"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { HumanModelScene } from "./scene";
import { MODEL_PROFILES, type ModelProfile } from "./profiles";
import type { HumanModelHighlight, HumanModelState } from "./types";
import styles from "./human-model.module.css";

export type { HumanModelHighlight, HumanModelState } from "./types";
export type { ModelProfile } from "./profiles";

export interface HumanModelProps {
  profile?: ModelProfile;
  /** Consumer-owned static/CDN URL; use the built asset manifest in Next.js. */
  modelUrl: string;
  highlights?: readonly HumanModelHighlight[];
  className?: string;
  onStateChange?: (state: HumanModelState) => void;
}

const NO_HIGHLIGHTS: readonly HumanModelHighlight[] = [];

export function HumanModel({
  profile = "male",
  modelUrl,
  highlights = NO_HIGHLIGHTS,
  className,
  onStateChange,
}: HumanModelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<HumanModelScene>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HumanModelState>({
    status: "loading",
    profile,
  });
  const reportState = useEffectEvent((next: HumanModelState) => {
    setState(next);
    onStateChange?.(next);
  });
  const initialize = useEffectEvent((runtime: HumanModelScene) => {
    runtime.setHighlights(highlights);
    void runtime.setModel(profile, modelUrl);
  });

  // Synchronizes React's canvas lifetime with the external WebGL runtime.
  useEffect(() => {
    if (!canvas.current) return;
    const element = canvas.current;
    let runtime: HumanModelScene | undefined;
    // Allocate after the shell's first paint. Strict Mode's setup/cleanup replay
    // cancels the first frame before it can allocate or lose this canvas context.
    const frame = requestAnimationFrame(() => {
      try {
        runtime = new HumanModelScene(element, (next) => reportState(next));
        scene.current = runtime;
        initialize(runtime);
      } catch (error) {
        console.error("human_model_start_failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        reportState({
          status: "error",
          message:
            "This browser could not start the 3D display. Check WebGL support and retry.",
        });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      scene.current = null;
      runtime?.dispose();
    };
  }, [attempt]);

  // Synchronizes controlled asset selection and highlight inputs with Three.js.
  useEffect(() => {
    void scene.current?.setModel(profile, modelUrl);
  }, [profile, modelUrl, attempt]);
  useEffect(() => {
    scene.current?.setHighlights(highlights);
  }, [highlights, attempt]);

  return (
    <div
      className={[styles.viewer, className].filter(Boolean).join(" ")}
      data-status={state.status}
    >
      <canvas
        key={attempt}
        ref={canvas}
        className={styles.canvas}
        role="img"
        aria-label={MODEL_PROFILES[profile].ariaLabel}
        tabIndex={0}
      >
        Interactive human anatomy model. Use the region controls to explore
        anatomy.
      </canvas>
      {state.status === "loading" ? (
        <p className={styles.notice} role="status">
          Loading 3D anatomy…
        </p>
      ) : null}
      {state.status === "ready" ? (
        <span className={styles.srOnly} role="status">
          3D anatomy ready
        </span>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.notice} role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry model
          </button>
        </div>
      ) : null}
    </div>
  );
}
