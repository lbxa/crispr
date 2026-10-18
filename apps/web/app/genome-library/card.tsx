"use client";

import { FileIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@crispr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crispr/ui/components/card";
import { LIBRARY_GENOMES, type LibraryGenome } from "./catalog";
import styles from "./card.module.css";

export function GenomeLibraryCard({
  loading,
  error,
  selectedFileName,
  onSelect,
}: {
  loading: string | null;
  error: string | null;
  selectedFileName?: string;
  onSelect: (genome: LibraryGenome) => void;
}) {
  return (
    <Card size="sm" className={styles.card} aria-busy={loading !== null}>
      <CardHeader className={styles.header}>
        <CardTitle>Genome library</CardTitle>
      </CardHeader>
      <CardContent className={styles.content}>
        <ul className={styles.list}>
          {LIBRARY_GENOMES.map((genome) => (
            <li key={genome.id}>
              <Button
                type="button"
                variant="ghost"
                className={styles.option}
                disabled={loading !== null}
                aria-label={`Use ${genome.fileName}`}
                aria-pressed={selectedFileName === genome.fileName}
                onClick={() => onSelect(genome)}
              >
                {loading === genome.id ? (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <FileIcon data-icon="inline-start" aria-hidden="true" />
                )}
                <span className={styles.fileName}>
                  {loading === genome.id ? "Loading genome…" : genome.fileName}
                </span>
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
