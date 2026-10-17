"use client";

import { useEffect, useRef, useState } from "react";
import { GenomeUpload } from "./client";
import type { GenomeAnalysisState } from "./contract";

export type { GenomeAnalysisState } from "./contract";

export function useGenomeAnalysis() {
  const [analysis, setAnalysis] = useState<GenomeAnalysisState>({
    status: "idle",
  });
  const activeUpload = useRef<GenomeUpload | null>(null);

  // The request outlives pane visibility, but never the workspace that owns it.
  useEffect(
    () => () => {
      const upload = activeUpload.current;
      activeUpload.current = null;
      upload?.dispose();
    },
    [],
  );

  async function analyze(file: File) {
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
    if (analysis.status === "idle") return;
    const upload = activeUpload.current;
    activeUpload.current = null;
    void upload?.cancel();
    setAnalysis({ status: "canceled", file: analysis.file });
  }

  return {
    analysis,
    analyze,
    retry,
    cancel,
    pause: () => activeUpload.current?.pause(),
    resume: () => void activeUpload.current?.resume(),
  };
}
