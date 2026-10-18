"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ReportDrawer } from "@crispr/ui/report-drawer";
import { Button } from "@crispr/ui/components/button";
import { Badge } from "@crispr/ui/components/badge";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from "@crispr/ui/components/empty";
import { Skeleton } from "@crispr/ui/components/skeleton";
import { Field, FieldLabel } from "@crispr/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crispr/ui/components/select";
import { loadGenePlan } from "./client";
import { planFailure, type GenePlan, type PlanResult } from "./contract";
import type { DownloadLabReport } from "../genome-analysis/client";
import { CrisprReport } from "./report";
import styles from "./crispr.module.css";
import orderStyles from "./order-preview.module.css";

type OrderPreview = "review" | "confirming" | "placed";

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
  plans,
  onDownloadReport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  genes: readonly CrisprGene[];
  initialGene: string;
  plans?: readonly GenePlan[];
  onDownloadReport?: DownloadLabReport;
}) {
  const [orderPreview, setOrderPreview] = useState<OrderPreview>("review");
  const [previousOpen, setPreviousOpen] = useState(open);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  // Reset on opening so the outgoing drawer keeps its confirmation during dismissal.
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) setOrderPreview("review");
  }
  // Synchronize the acknowledgement clock and focus with the visible preview state.
  useEffect(() => {
    if (!open) return;
    if (orderPreview === "placed") {
      confirmationHeading.current?.focus({ preventScroll: true });
      return;
    }
    if (orderPreview !== "confirming") return;
    const timer = window.setTimeout(() => setOrderPreview("placed"), 650);
    return () => window.clearTimeout(timer);
  }, [open, orderPreview]);

  const placed = orderPreview === "placed";
  const confirming = orderPreview === "confirming";
  return (
    <ReportDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={placed ? "Order placed" : "CRISPR gene editing"}
      description={
        placed
          ? "Genome kit confirmation preview."
          : "Your outlook, with a report for your lab."
      }
      hideHeading={placed}
      footer={
        !placed && (
          <Button
            type="button"
            size="lg"
            className={orderStyles.orderButton}
            aria-disabled={confirming || undefined}
            onClick={() => {
              if (orderPreview !== "review") return;
              setOrderPreview(
                window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
                  ? "placed"
                  : "confirming",
              );
            }}
          >
            {confirming ? (
              <>
                <span
                  className={orderStyles.buttonTick}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Confirmed
              </>
            ) : (
              "Order kit"
            )}
          </Button>
        )
      }
    >
      {placed ? (
        <Empty className={orderStyles.confirmation} role="status">
          <EmptyMedia className={orderStyles.mark} aria-hidden="true">
            <span className={orderStyles.tick} />
          </EmptyMedia>
          <EmptyHeader>
            <Badge variant="secondary">Genome kit</Badge>
            <EmptyTitle>
              <h3
                className={orderStyles.title}
                ref={confirmationHeading}
                tabIndex={-1}
              >
                Order placed
              </h3>
            </EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div
          className={orderStyles.review}
          data-leaving={confirming || undefined}
          inert={confirming}
        >
          <CrisprContent
            key={initialGene}
            genes={genes}
            initialGene={initialGene}
            plans={plans}
            onDownloadReport={onDownloadReport}
          />
        </div>
      )}
    </ReportDrawer>
  );
}

// Mounted only while the drawer is open, so each opening starts on its selected gene.
function CrisprContent({
  genes,
  initialGene,
  plans,
  onDownloadReport,
}: {
  genes: readonly CrisprGene[];
  initialGene: string;
  plans?: readonly GenePlan[];
  onDownloadReport?: DownloadLabReport;
}) {
  const geneId = useId();
  const [gene, setGene] = useState(initialGene);
  const [results, setResults] = useState<Readonly<Record<string, PlanResult>>>(
    {},
  );
  const savedPlan = plans?.find((plan) => plan.gene === gene);
  const result: PlanResult | undefined =
    plans !== undefined
      ? savedPlan
        ? { ok: true, plan: savedPlan }
        : planFailure("not_found")
      : results[gene];
  const disease = genes.find((item) => item.gene === gene)?.disease;
  const items = genes.map(({ gene, disease }) => ({
    value: gene,
    label: `${gene} · ${disease}`,
  }));

  // Each gene is fetched once; switching away cancels an unfinished request.
  useEffect(() => {
    if (plans !== undefined || results[gene]) return;
    const controller = new AbortController();
    void loadGenePlan(gene, controller.signal).then((next) => {
      if (!controller.signal.aborted)
        setResults((current) => ({ ...current, [gene]: next }));
    });
    return () => controller.abort();
  }, [gene, results, plans]);

  return (
    <>
      <Field className="gap-1">
        <FieldLabel htmlFor={geneId}>Gene</FieldLabel>
        <Select
          items={items}
          value={gene}
          onValueChange={(next) => {
            if (next !== null) setGene(next);
          }}
        >
          <SelectTrigger id={geneId} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent size="sm" align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {items.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  <span className="line-clamp-2 whitespace-normal">
                    {label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {!result && (
        <div className={styles.report} role="status">
          <span className="sr-only">
            Predicting how well {gene} can be edited…
          </span>
          <div className={styles.loadingCards} aria-hidden="true">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </div>
        </div>
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
            disclaimer={result.plan.disclaimer}
            source={plans === undefined ? "catalog" : "genome"}
            downloadReport={onDownloadReport}
          />
        </div>
      )}
    </>
  );
}
