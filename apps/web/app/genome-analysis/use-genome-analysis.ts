"use client";

import { useEffect, useRef, useState } from "react";
import { GenomeUpload } from "./client";
import { currentGenomeCache } from "./cache";
import type { GenomeAnalysisState } from "./contract";

export type { GenomeAnalysisState } from "./contract";

/**
 * `restore` brings back the genome saved on this device. The app starts fresh instead: it
 * discards the saved copy on load so a returning visitor is invited to upload again.
 */
export function useGenomeAnalysis({ restore = false } = {}) {
  const [analysis, setAnalysis] = useState<GenomeAnalysisState>({
    status: "idle",
  });
  const activeUpload = useRef<GenomeUpload | null>(null);
  const selection = useRef(0);
  const restoredGenome = useRef<Extract<
    GenomeAnalysisState,
    { status: "complete" }
  > | null>(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [persistedGenome, setPersistedGenome] = useState<Extract<
    GenomeAnalysisState,
    { status: "complete" }
  > | null>(null);

  // Synchronizes the workspace with IndexedDB; a user selection wins over a
  // delayed restore. Strict Mode cleanup also owns the upload's lifetime.
  useEffect(() => {
    let disposed = false;
    const initialSelection = selection.current;
    void (restore
      ? currentGenomeCache.restore()
      : currentGenomeCache.forget().then(() => null)
    )
      .then((cached) => {
        if (disposed) return;
        if (cached && selection.current === initialSelection) {
          restoredGenome.current = cached;
          setPersistedGenome(cached);
          setAnalysis((current) =>
            current.status === "idle" ? cached : current,
          );
        }
        setCacheReady(true);
      })
      .catch(() => {
        if (disposed) return;
        setCacheError(
          "Couldn’t restore the saved genome. You can still choose a file.",
        );
        setCacheReady(true);
      });
    return () => {
      disposed = true;
      const upload = activeUpload.current;
      activeUpload.current = null;
      upload?.dispose();
    };
  }, [restore]);

  const completedGenome = analysis.status === "complete" ? analysis : null;
  const status = analysis.status;
  // Persist only the completed snapshot, once per state transition rather than
  // per upload chunk. Effects commit in order, so replacement/removal follows
  // any older save. A restored snapshot never overwrites another tab's cache.
  useEffect(() => {
    if (
      !cacheReady ||
      (completedGenome !== null &&
        completedGenome === restoredGenome.current) ||
      (status === "idle" && selection.current === 0)
    )
      return;
    let disposed = false;
    const operation = completedGenome
      ? currentGenomeCache.remember(completedGenome)
      : currentGenomeCache.forget();
    void operation
      .then(() => {
        if (!disposed) {
          setPersistedGenome(completedGenome);
          setCacheError(null);
        }
      })
      .catch(() => {
        if (!disposed)
          setCacheError(
            "Couldn’t save this workspace on this device. Refresh may lose the current genome.",
          );
      });
    return () => {
      disposed = true;
    };
  }, [cacheReady, completedGenome, status]);

  async function analyze(file: File) {
    selection.current++;
    void activeUpload.current?.cancel();
    const upload = new GenomeUpload(file, (state) => {
      if (activeUpload.current === upload) setAnalysis(state);
    });
    activeUpload.current = upload;
    await upload.start();
  }

  async function retry() {
    if (analysis.status !== "error") return;
    if (
      ["upload_setup_failed", "session_expired"].includes(analysis.error.code)
    ) {
      const previous = activeUpload.current;
      setAnalysis({
        status: "uploading",
        stage: "preparing",
        uploaded: 0,
        file: analysis.file,
      });
      await previous?.cancel();
      if (activeUpload.current !== previous) return;
      activeUpload.current = null;
      void analyze(analysis.file);
      return;
    }
    if (!activeUpload.current) void analyze(analysis.file);
    else void activeUpload.current.resume();
  }

  function cancel() {
    if (analysis.status === "idle" || analysis.status === "complete") return;
    const upload = activeUpload.current;
    activeUpload.current = null;
    selection.current++;
    void upload?.cancel();
    setAnalysis({ status: "canceled", file: analysis.file });
  }

  async function clear() {
    const currentSelection = ++selection.current;
    activeUpload.current?.dispose();
    activeUpload.current = null;
    try {
      await currentGenomeCache.forget();
      if (selection.current !== currentSelection) return;
      restoredGenome.current = null;
      setAnalysis({ status: "idle" });
      setPersistedGenome(null);
      setCacheError(null);
    } catch {
      if (selection.current === currentSelection)
        setCacheError("Couldn’t remove the saved genome. Try again.");
    }
  }

  return {
    analysis,
    analyze,
    retry,
    cancel,
    clear,
    cacheError,
    cacheReady,
    cacheSaved: completedGenome !== null && completedGenome === persistedGenome,
    pause: () => activeUpload.current?.pause(),
    resume: () => void activeUpload.current?.resume(),
  };
}
