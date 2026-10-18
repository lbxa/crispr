"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@crispr/ui/components/button";
import { toast } from "@crispr/ui/components/sonner";
import { LabReportDownloadError, type DownloadLabReport } from "./client";
import styles from "./download-report-button.module.css";

/** The caller owns access to its saved analysis; this control owns one browser download. */
export function DownloadReportButton({
  download,
}: {
  download?: DownloadLabReport;
}) {
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={!download || pending}
      aria-busy={pending}
      onClick={async () => {
        if (!download || active.current) return;
        const request = new AbortController();
        active.current = request;
        setPending(true);
        try {
          const pdf = await download(request.signal);
          if (request.signal.aborted) return;
          const url = URL.createObjectURL(pdf);
          try {
            const link = document.createElement("a");
            link.href = url;
            link.download = "genome-lab-report.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
          } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        } catch (error) {
          if (!request.signal.aborted)
            toast.error(
              error instanceof LabReportDownloadError
                ? error.message
                : "The lab report could not be downloaded. Try again shortly.",
            );
        } finally {
          if (active.current === request) {
            active.current = null;
            setPending(false);
          }
        }
      }}
    >
      <span
        className={styles.pdfIcon}
        data-icon="inline-start"
        aria-hidden="true"
      />
      {pending ? "Preparing PDF…" : "Download Report"}
    </Button>
  );
}
