"use client";

import { useEffect, useState } from "react";
import { ReportDrawer } from "@crispr/ui/report-drawer";
import { loadGenePlan } from "./client";
import type { PlanResult } from "./contract";
import { Raw } from "./panels";
import { CrisprReport } from "./report";
import styles from "./crispr.module.css";

export interface CrisprGene {
  gene: string;
  disease: string;
}

/**
 * The CRISPR flow in the shared report drawer. The genome belongs to the user, so the only
 * choice is which of the genome's identified genes to look at.
 */
export function CrisprDrawer({
  open,
  onOpenChange,
  genes,
  initialGene,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  genes: readonly CrisprGene[];
  initialGene: string;
}) {
  return (
    <ReportDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="CRISPR gene editing"
      description="Editing analysis, evidence and guide design."
    >
      <CrisprContent
        key={initialGene}
        genes={genes}
        initialGene={initialGene}
      />
    </ReportDrawer>
  );
}

// Mounted only while the drawer is open, so each opening starts on its selected gene.
function CrisprContent({
  genes,
  initialGene,
}: {
  genes: readonly CrisprGene[];
  initialGene: string;
}) {
  const [gene, setGene] = useState(initialGene);
  const [results, setResults] = useState<Readonly<Record<string, PlanResult>>>(
    {},
  );
  const result = results[gene];
  const disease = genes.find((item) => item.gene === gene)?.disease;

  // Each gene is fetched once; switching away cancels an unfinished request.
  useEffect(() => {
    if (results[gene]) return;
    const controller = new AbortController();
    void loadGenePlan(gene, controller.signal).then((next) => {
      if (!controller.signal.aborted)
        setResults((current) => ({ ...current, [gene]: next }));
    });
    return () => controller.abort();
  }, [gene, results]);

  return (
    <>
      <label className={styles.geneSelect}>
        <span>Gene</span>
        <select
          value={gene}
          onChange={(event) => setGene(event.target.value)}
          aria-label="Gene"
        >
          {genes.map((item) => (
            <option key={item.gene} value={item.gene}>
              {item.gene} · {item.disease}
            </option>
          ))}
        </select>
      </label>
      {!result && (
        <p className={styles.status} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          Predicting how well {gene} can be edited…
        </p>
      )}
      {result && !result.ok && (
        <div className={styles.failure} role="alert">
          <p>{result.error.message}</p>
          {result.error.code !== "not_found" && (
            <button
              type="button"
              onClick={() =>
                setResults(({ [gene]: _discarded, ...rest }) => rest)
              }
            >
              Try again
            </button>
          )}
        </div>
      )}
      {result?.ok && (
        <div data-testid="crispr-plan">
          <CrisprReport
            key={result.plan.gene}
            overview={result.plan.overview}
            edits={result.plan.edits}
            subject={disease ? `${gene} · ${disease}` : gene}
          />
          <Raw value={result.plan} />
          <p className={styles.muted}>{result.plan.disclaimer}</p>
        </div>
      )}
    </>
  );
}
