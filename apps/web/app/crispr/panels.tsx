"use client";

import type { CSSProperties, ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, CircleDashedIcon } from "lucide-react";
import { Badge } from "@crispr/ui/components/badge";
import { Button } from "@crispr/ui/components/button";
import { ReportDrawer } from "@crispr/ui/report-drawer";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crispr/ui/components/card";
import styles from "./crispr.module.css";
import type { Overview } from "./contract";

const VERDICT_TITLE: Record<Overview["verdict"], string> = {
  recommended: "Potentially viable",
  not_recommended: "Not supported",
  unavailable: "Not enough data",
  no_guide: "No suitable guide",
  no_edit: "No edit proposed",
};
const VERDICT_DESCRIPTION: Record<Overview["verdict"], string> = {
  recommended: "The model found a promising editing approach for lab review.",
  not_recommended:
    "This CRISPR approach did not meet the model's activity threshold.",
  unavailable:
    "We need a reliable activity prediction before judging this approach.",
  no_guide:
    "This analysis found no standard CRISPR guide close enough to the variant.",
  no_edit: "This result does not propose a gene edit.",
};

export function OverviewPanel({
  overview,
  subject,
  source = "genome",
}: {
  overview: Overview;
  subject: string;
  source?: "genome" | "catalog";
}) {
  const { score, threshold } = overview;
  return (
    <Card
      className={styles.overview}
      data-verdict={overview.verdict}
      data-testid="overview"
      role="region"
      aria-label="CRISPR overview"
    >
      <CardHeader>
        <div className={styles.resultCaption}>
          <span>Your editing outlook</span>
          <Badge variant="secondary">
            {source === "catalog" ? "Catalog example" : "Research preview"}
          </Badge>
        </div>
        <CardTitle>
          <h3 className={styles.verdict} data-testid="verdict">
            {VERDICT_TITLE[overview.verdict]}
          </h3>
        </CardTitle>
        <CardDescription>{subject}</CardDescription>
      </CardHeader>
      <CardContent className={styles.resultBody}>
        <div
          className={styles.scoreRing}
          style={
            {
              "--score": Math.max(0, Math.min(100, score ?? 0)),
            } as CSSProperties
          }
          role={score === null ? undefined : "meter"}
          aria-label="Editing score"
          aria-valuemin={score === null ? undefined : 0}
          aria-valuemax={score === null ? undefined : 100}
          aria-valuenow={
            score === null ? undefined : Math.max(0, Math.min(100, score))
          }
          aria-valuetext={
            score === null
              ? undefined
              : `${score} out of 100; provisional threshold ${threshold}`
          }
        >
          <div className={styles.ringLabel}>
            <span data-testid="overview-score">
              {score === null ? "—" : Math.round(score)}
            </span>
            <span>
              {score === null ? "Score unavailable" : "Editing score /100"}
            </span>
          </div>
        </div>
        <p className={styles.outlookDescription}>
          {VERDICT_DESCRIPTION[overview.verdict]}
        </p>
        <ul className={styles.outlookSteps} aria-label="Research progress">
          <li data-complete={overview.edits_considered > 0}>
            {overview.edits_considered > 0 ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CircleDashedIcon aria-hidden="true" />
            )}
            <span>
              {overview.edits_considered > 0
                ? "Target found"
                : "No edit target"}
            </span>
          </li>
          <li data-complete={score !== null}>
            {score !== null ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CircleDashedIcon aria-hidden="true" />
            )}
            <span>{score !== null ? "Model scored" : "Not scored"}</span>
          </li>
          <li>
            <CircleDashedIcon aria-hidden="true" />
            <span>Lab review next</span>
          </li>
        </ul>
        <p className={styles.clinicalNote}>
          Predicted cutting activity, not a treatment-success rate. Clinical
          eligibility needs specialist review.
        </p>
        {source === "catalog" && (
          <p className={styles.clinicalNote}>
            Catalog example; this is not an analysis of your uploaded genome.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Lab evidence opens above the consumer report without replacing its state. */
export function AdvancedGenomics({
  subject,
  children,
}: {
  subject: string;
  children: ReactNode;
}) {
  return (
    <ReportDrawer
      title="Advanced genomics"
      description={`${subject}. Guide designs, scoring evidence and safety notes.`}
      trigger={
        <Button variant="secondary" className={styles.advancedTrigger}>
          <span>
            Advanced genomics
            <span className={styles.advancedHint}>
              Evidence, safety notes & all guides
            </span>
          </span>
          <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      }
    >
      <div className={styles.advancedBody} data-testid="advanced">
        {children}
      </div>
    </ReportDrawer>
  );
}
