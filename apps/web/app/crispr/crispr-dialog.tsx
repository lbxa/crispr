"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crispr/ui/components/dialog";
import { loadGenePlan } from "./client";
import type { PlanResult } from "./contract";
import { AdvancedGenomics, EditCard, OverviewPanel } from "./panels";
import styles from "./crispr.module.css";

export interface CrisprGene {
  gene: string;
  disease: string;
}

/**
 * The CRISPR flow as a popup. The genome belongs to the user and the backend is fixed, so the only
 * choice is which of the genome's identified genes to look at.
 */
export function CrisprDialog({
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="CRISPR gene editing">
        <CrisprContent genes={genes} initialGene={initialGene} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so each opening starts on the gene it was opened from.
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
      <DialogHeader>
        <DialogTitle>CRISPR gene editing</DialogTitle>
        <DialogDescription>
          How well could this condition be treated by editing the gene?
        </DialogDescription>
      </DialogHeader>
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
          <OverviewPanel
            key={result.plan.gene}
            overview={result.plan.overview}
            subject={disease ? `${gene} · ${disease}` : gene}
          />
          <AdvancedGenomics overview={result.plan.overview}>
            <article className={styles.finding}>
              {result.plan.edits.map((edit) => (
                <div key={edit.variation_id}>
                  {edit.disease && (
                    <p className={styles.muted}>{edit.disease}</p>
                  )}
                  <EditCard edit={edit} />
                </div>
              ))}
            </article>
          </AdvancedGenomics>
          <p className={styles.muted}>{result.plan.disclaimer}</p>
        </div>
      )}
    </>
  );
}
