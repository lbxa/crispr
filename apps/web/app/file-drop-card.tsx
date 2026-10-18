"use client";

import { useId, useState } from "react";
import { ErrorCode, useDropzone } from "react-dropzone";
import { FileIcon, UploadIcon } from "lucide-react";
import { Card, CardContent } from "@crispr/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@crispr/ui/components/empty";
import styles from "./file-drop-card.module.css";
import {
  formatGenomeBytes,
  MAX_UPLOAD_BYTES,
  UPLOAD_ERRORS,
  type GenomeFileInfo,
} from "./genome-analysis/contract";

export function FileDropCard({
  file,
  onFileSelect,
}: {
  file: GenomeFileInfo | null;
  onFileSelect: (file: File) => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      multiple: false,
      accept: { "application/vcf": [".vcf"], "application/gzip": [".vcf.gz"] },
      validator: (candidate) =>
        /\.vcf(?:\.gz)?$/i.test(candidate.name)
          ? null
          : {
              code: ErrorCode.FileInvalidType,
              message: UPLOAD_ERRORS.invalid_file,
            },
      minSize: 1,
      maxSize: MAX_UPLOAD_BYTES,
      onDrop: ([selected], rejected) => {
        if (rejected.length) {
          const codes = rejected.flatMap(({ errors }) =>
            errors.map(({ code }) => code),
          );
          setError(
            codes.includes(ErrorCode.TooManyFiles) ||
              rejected.length > 1 ||
              selected
              ? "Choose one file at a time."
              : codes.includes(ErrorCode.FileTooLarge)
                ? UPLOAD_ERRORS.too_large
                : UPLOAD_ERRORS.invalid_file,
          );
          return;
        }
        if (selected) {
          onFileSelect(selected);
          setError(null);
        }
      },
      onError: () => setError("Couldn’t select that file. Try again."),
    });

  return (
    <>
      <Card
        size="sm"
        {...getRootProps({
          role: "button",
          "aria-label": file ? "Replace file" : "Choose file",
          "aria-describedby": error
            ? `${id}-details ${id}-error`
            : `${id}-details`,
          className: styles.card,
          "data-no-widget-drag": "",
          "data-dragging": isDragActive || undefined,
          "data-invalid": isDragReject || !!error || undefined,
        })}
      >
        <CardContent className={styles.content}>
          <input
            {...getInputProps({
              "aria-label": "Choose a file",
              "aria-describedby": error ? `${id}-error` : undefined,
              "aria-invalid": !!error,
            })}
          />
          <Empty className={styles.dropContents}>
            <EmptyHeader id={`${id}-details`} className="min-w-0 max-w-full">
              <EmptyMedia variant="icon">
                {file ? (
                  <FileIcon aria-hidden="true" />
                ) : (
                  <UploadIcon aria-hidden="true" />
                )}
              </EmptyMedia>
              <EmptyTitle className={styles.title} title={file?.name}>
                {isDragActive
                  ? "Drop to add"
                  : (file?.name ?? "Drop your genome")}
              </EmptyTitle>
              <EmptyDescription>
                {file
                  ? formatGenomeBytes(file.size)
                  : "VCF or VCF.gz · Up to 10 GiB"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
