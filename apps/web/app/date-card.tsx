"use client";

import { useSyncExternalStore } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crispr/ui/components/card";
import styles from "./date-card.module.css";

function subscribe(onChange: () => void) {
  const interval = window.setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function getLocalDay() {
  return new Date().setHours(0, 0, 0, 0);
}

function getServerDay() {
  return null;
}

export function DateCard() {
  const localDay = useSyncExternalStore(subscribe, getLocalDay, getServerDay);
  const date = localDay === null ? null : new Date(localDay);
  const isoDate = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : undefined;

  return (
    <Card size="sm" className={styles.card}>
      <CardHeader className={styles.header}>
        <CardTitle>
          {date?.toLocaleDateString("en-US", { weekday: "long" }) ?? "Today"}
        </CardTitle>
      </CardHeader>
      <CardContent className={styles.content}>
        <time
          dateTime={isoDate}
          aria-label={date?.toLocaleDateString("en-US", { dateStyle: "full" })}
          className={styles.date}
        >
          <span className={styles.day}>{date?.getDate() ?? "—"}</span>
          <span className={styles.month}>
            {date?.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            }) ?? "Current date"}
          </span>
        </time>
      </CardContent>
    </Card>
  );
}
