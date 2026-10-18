"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { ReportDrawer } from "../report-drawer";
import {
  Card,
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
  locations,
  notice,
  size = "default",
  open,
  onOpenChange,
  children,
}: {
  name: string;
  gene: string;
  status: keyof typeof STATUS;
  artwork?: string;
  location?: string;
  locations?: ReactNode;
  notice?: ReactNode;
  size?: ComponentProps<typeof Card>["size"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card
      className={styles.card}
      size={size}
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
        {locations ??
          (location && (
            <CardDescription>
              <span dir="ltr">{location}</span>
            </CardDescription>
          ))}
        {notice && <CardDescription>{notice}</CardDescription>}
      </CardHeader>
      <CardFooter>
        <ReportDrawer
          open={open}
          onOpenChange={onOpenChange}
          title={name}
          description={`${gene} · ${STATUS[status]}${location ? ` · ${location}` : ""}`}
          trigger={
            <Button
              variant="ghost"
              className={styles.disclosure}
              aria-label={`View ${gene} report`}
            >
              View report <span aria-hidden="true">↗</span>
            </Button>
          }
        >
          {artwork && (
            <img
              className={styles.cover}
              src={artwork}
              width={768}
              height={512}
              alt=""
              decoding="async"
            />
          )}
          <div className={styles.evidence}>{children}</div>
        </ReportDrawer>
      </CardFooter>
    </Card>
  );
}
