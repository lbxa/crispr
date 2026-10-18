import {
  ClipboardCheckIcon,
  FlaskConicalIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crispr/ui/components/card";
import { AdvancedGenomics, OverviewPanel } from "./panels";
import { LabEditReport } from "./lab-report";
import type { Edit, Overview } from "./contract";
import styles from "./crispr.module.css";
import { DownloadReportButton } from "../genome-analysis/download-report-button";
import type { DownloadLabReport } from "../genome-analysis/client";

export function CrisprReport({
  overview,
  edits,
  subject,
  disclaimer,
  source = "genome",
  downloadReport,
}: {
  overview?: Overview;
  edits: readonly Edit[];
  subject: string;
  disclaimer?: string;
  source?: "genome" | "catalog";
  downloadReport?: DownloadLabReport;
}) {
  return (
    <div className={styles.report}>
      {overview && (
        <OverviewPanel overview={overview} subject={subject} source={source} />
      )}
      <Card className={styles.careTeam}>
        <CardHeader>
          <CardTitle>
            <h3 className={styles.resultTitle}>
              Your care team handles the details
            </h3>
          </CardTitle>
          <CardDescription>
            Your specialists review safety, delivery and treatment suitability.
            The technical detail is ready for them below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className={styles.careSteps} aria-label="Clinical next steps">
            <li>
              <ClipboardCheckIcon aria-hidden="true" />
              <span>Review findings</span>
            </li>
            <li>
              <ShieldCheckIcon aria-hidden="true" />
              <span>Check safety</span>
            </li>
            <li>
              <FlaskConicalIcon aria-hidden="true" />
              <span>Plan treatment</span>
            </li>
          </ol>
        </CardContent>
      </Card>
      <section className={styles.labSection} aria-label="For your lab">
        {overview && (
          <>
            <header>
              <h3>For your lab</h3>
              <p>A complete genome report for specialist review.</p>
            </header>
            <DownloadReportButton download={downloadReport} />
            {!downloadReport && (
              <p className={styles.basis}>
                PDF download is available for a genome analyzed in this session.
              </p>
            )}
          </>
        )}
        <AdvancedGenomics subject={subject}>
          {edits.map((edit) => (
            <LabEditReport key={edit.variation_id} edit={edit} />
          ))}
          {disclaimer && <p className={styles.muted}>{disclaimer}</p>}
        </AdvancedGenomics>
      </section>
    </div>
  );
}
