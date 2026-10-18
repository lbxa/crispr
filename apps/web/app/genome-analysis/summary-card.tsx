"use client";

import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { Button } from "@crispr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@crispr/ui/components/card";
import type { GenomeAnalysisState } from "./use-genome-analysis";
import { formatGenomeBytes } from "./contract";
import styles from "./summary-card.module.css";

const numbers = new Intl.NumberFormat("en");
const compactNumbers = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function GenomeSummaryCard({
  analysis,
  onRetry,
  onPause,
  onResume,
  onCancel,
  onClear,
}: {
  analysis: Exclude<GenomeAnalysisState, { status: "idle" }>;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onClear?: () => void;
}) {
  const transferring =
    analysis.status === "uploading" || analysis.status === "paused";
  const active =
    transferring ||
    analysis.status === "queued" ||
    analysis.status === "processing";

  return (
    <Card className={styles.card} data-no-widget-drag="">
      <CardHeader>
        <CardTitle>Genome summary</CardTitle>
        <CardDescription>Genome-only analysis</CardDescription>
        {analysis.status === "complete" && onClear && (
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove genome"
              title="Remove genome"
              onClick={onClear}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className={styles.content}>
        {transferring && (
          <div className={styles.transfer}>
            <p className={styles.transferTitle} role="status">
              {analysis.status === "paused"
                ? "Upload paused"
                : analysis.stage === "preparing"
                  ? "Preparing upload…"
                  : analysis.stage === "finishing"
                    ? "Verifying upload…"
                    : "Uploading to IBM"}
            </p>
            <progress
              className={styles.progress}
              aria-label="Genome upload"
              max={analysis.file.size}
              value={analysis.uploaded}
            />
            <p className={styles.detail}>
              {formatGenomeBytes(analysis.uploaded)}{" "}
              <span aria-hidden="true">/</span>
              <span className={styles.srOnly}>of</span>{" "}
              {formatGenomeBytes(analysis.file.size)} saved
            </p>
          </div>
        )}
        {(analysis.status === "queued" || analysis.status === "processing") && (
          <div className={styles.processing} role="status">
            <LoaderCircleIcon className={styles.spinner} aria-hidden="true" />
            <p>
              {analysis.status === "queued"
                ? "Waiting to process…"
                : "Analyzing genome…"}
            </p>
            <p className={styles.detail}>
              {analysis.status === "queued"
                ? "Your upload is saved on IBM."
                : `${numbers.format(analysis.progress.records_scanned)} records scanned · ${formatGenomeBytes(analysis.progress.uncompressed_bytes)} read`}
            </p>
            {analysis.status === "processing" && (
              <p className={styles.detail}>
                {numbers.format(analysis.progress.retained_variants)} panel
                variants retained
              </p>
            )}
          </div>
        )}
        {analysis.status === "canceled" && (
          <p className={styles.detail} role="status">
            Upload canceled. Drop a file to begin again.
          </p>
        )}
        {analysis.status === "error" && (
          <div className={styles.failure}>
            <p role="alert">{analysis.error.message}</p>
            {analysis.error.retryable && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                {["upload_setup_failed", "session_expired"].includes(
                  analysis.error.code,
                )
                  ? "Start again"
                  : analysis.error.code === "upload_failed"
                    ? "Resume upload"
                    : "Try again"}
              </Button>
            )}
          </div>
        )}
        {analysis.status === "complete" && (
          <>
            <p className={styles.complete} role="status">
              Analysis complete
            </p>
            <dl className={styles.metrics}>
              <div>
                <dt>Variants</dt>
                <dd
                  title={numbers.format(
                    analysis.report.genome.variants_checked,
                  )}
                  aria-label={numbers.format(
                    analysis.report.genome.variants_checked,
                  )}
                >
                  {compactNumbers
                    .format(analysis.report.genome.variants_checked)
                    .replace("K", "k")}
                </dd>
              </div>
              <div>
                <dt>Panel genes</dt>
                <dd>
                  {numbers.format(analysis.report.genome.panel_genes.length)}
                </dd>
              </div>
              <div>
                <dt>Findings</dt>
                <dd>{numbers.format(analysis.report.findings.length)}</dd>
              </div>
            </dl>
            <p className={styles.summary}>{analysis.report.summary.text}</p>
          </>
        )}
      </CardContent>
      {active && (
        <CardFooter className={styles.actions}>
          {analysis.status === "paused" && (
            <Button variant="outline" size="sm" onClick={onResume}>
              Resume upload
            </Button>
          )}
          {analysis.status === "uploading" &&
            analysis.stage === "transferring" && (
              <Button variant="outline" size="sm" onClick={onPause}>
                Pause upload
              </Button>
            )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </CardFooter>
      )}
      {analysis.status === "complete" && (
        <CardFooter>
          <p className={styles.disclaimer}>{analysis.report.disclaimer}</p>
        </CardFooter>
      )}
    </Card>
  );
}
