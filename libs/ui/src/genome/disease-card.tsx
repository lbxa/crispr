"use client";

import { useId, type ReactNode } from "react";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/card";
import styles from "./disease-card.module.css";

const STATUS = {
  likely: "Likely finding",
  possible: "Possible finding",
  carrier: "Carrier",
  clear: "Clear",
} as const;

/** Shared presentation; callers own report evidence, selection and clinical actions. */
export function DiseaseCard({
  name,
  gene,
  status,
  artwork,
  location,
  expanded,
  onExpandedChange,
  children,
}: {
  name: string;
  gene: string;
  status: keyof typeof STATUS;
  artwork?: string;
  location?: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card
      className={styles.card}
      data-disease={gene}
      role="article"
      aria-labelledby={`${id}-title`}
    >
      {artwork && (
        // Local, pre-encoded WebP covers avoid a runtime image service on Workers.
        // Artwork is illustrative; the disease name supplies the accessible identity.
        <img
          className={styles.cover}
          src={artwork}
          alt=""
          width={768}
          height={512}
          loading="lazy"
          decoding="async"
        />
      )}
      <CardHeader>
        <div className={styles.eyebrow}>
          <span translate="no">{gene}</span>
          <Badge variant={status === "clear" ? "outline" : "secondary"}>
            {STATUS[status]}
          </Badge>
        </div>
        <CardTitle>
          <h3 id={`${id}-title`}>{name}</h3>
        </CardTitle>
        {location && (
          <CardDescription>
            <span dir="ltr">{location}</span>
          </CardDescription>
        )}
      </CardHeader>
      {expanded && (
        <CardContent id={`${id}-evidence`} className={styles.evidence}>
          {children}
        </CardContent>
      )}
      <CardFooter>
        <Button
          variant="ghost"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-evidence` : undefined}
          aria-label={`${expanded ? "Hide" : "View"} ${gene} evidence`}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? "Hide evidence" : "View evidence"}
          <span aria-hidden="true">{expanded ? "−" : "+"}</span>
        </Button>
      </CardFooter>
    </Card>
  );
}
