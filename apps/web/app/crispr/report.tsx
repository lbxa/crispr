import { AdvancedGenomics, EditCard, OverviewPanel } from "./panels";
import type { Edit, Overview } from "./contract";
import styles from "./crispr.module.css";

export function CrisprReport({
  overview,
  edits,
  subject,
}: {
  overview?: Overview;
  edits: readonly Edit[];
  subject: string;
}) {
  const details = (
    <>
      {edits.map((edit) => (
        <article className={styles.finding} key={edit.variation_id}>
          {edit.disease && <p className={styles.muted}>{edit.disease}</p>}
          <EditCard edit={edit} />
          <dl>
            <dt>Rationale</dt>
            <dd>{edit.rationale}</dd>
            <dt>Alternative</dt>
            <dd>{edit.alternative}</dd>
            <dt>Off-target assessment</dt>
            <dd>{edit.off_target}</dd>
            {edit.repair_template && (
              <>
                <dt>Repair template</dt>
                <dd className={styles.mono}>{edit.repair_template}</dd>
              </>
            )}
            {edit.repair_template_notes && (
              <>
                <dt>Repair-template notes</dt>
                <dd>{edit.repair_template_notes}</dd>
              </>
            )}
          </dl>
        </article>
      ))}
    </>
  );
  return (
    <>
      {overview && <OverviewPanel overview={overview} subject={subject} />}
      {overview ? (
        <AdvancedGenomics overview={overview}>{details}</AdvancedGenomics>
      ) : (
        details
      )}
    </>
  );
}
