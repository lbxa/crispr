import { Badge } from "@crispr/ui/components/badge";
import type { Edit, Energy, Guide } from "./contract";
import styles from "./lab-report.module.css";

const ENERGY_TERMS: [keyof Energy, string][] = [
  ["rna_dna", "RNA–DNA hybrid"],
  ["rna_dna_weighted", "RNA–DNA hybrid, weighted"],
  ["dna_opening", "DNA opening"],
  ["spacer_self_fold", "Spacer self-fold"],
  ["crisproff_score", "CRISPRoff score"],
];

/** One guide's complete evidence, visible without expanding a table row. */
function GuideEvidence({
  guide,
  number,
  highestActivity,
}: {
  guide: Guide;
  number: number;
  highestActivity: boolean;
}) {
  const models = Object.entries(guide.model_scores ?? {});
  const energy = guide.energy;
  return (
    <section className={styles.guide} aria-label={`Guide G${number} evidence`}>
      <header className={styles.guideHeader}>
        <h5>G{number}</h5>
        {highestActivity && <Badge variant="secondary">Highest activity</Badge>}
      </header>
      <dl className={styles.sequences}>
        <div>
          <dt>Spacer · 5′ to 3′</dt>
          <dd>
            <code dir="ltr">{guide.spacer}</code>
          </dd>
        </div>
        <div>
          <dt>PAM</dt>
          <dd>
            <code dir="ltr">{guide.pam}</code>
          </dd>
        </div>
      </dl>
      <dl className={styles.metrics}>
        <div>
          <dt>Cut after · 1-based</dt>
          <dd>
            <span dir="ltr">{guide.cut_position.toLocaleString("en-US")}</span>
          </dd>
        </div>
        <div>
          <dt>Strand</dt>
          <dd>{guide.strand === "+" ? "+ (forward)" : "− (reverse)"}</dd>
        </div>
        <div>
          <dt>GC content</dt>
          <dd>{Math.round(guide.gc_content * 100)}%</dd>
        </div>
        <div>
          <dt>Design rule score</dt>
          <dd>{guide.score}</dd>
        </div>
      </dl>
      {guide.notes.length > 0 && (
        <ul className={styles.notes}>
          {guide.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className={styles.evidenceBlock}>
        <h6>Model input · 30 bases</h6>
        {guide.context ? (
          <code className={styles.context} dir="ltr">
            {guide.context}
          </code>
        ) : (
          <p className={styles.missing}>Context unavailable</p>
        )}
      </div>
      <div className={styles.evidenceBlock}>
        <h6>Model predictions · /100</h6>
        {models.length ? (
          <dl className={styles.models}>
            {models.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd dir="ltr">{value.toFixed(2)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.missing}>Activity prediction unavailable</p>
        )}
      </div>
      <div className={styles.evidenceBlock}>
        <h6>Binding energies · kcal/mol</h6>
        {energy ? (
          <dl className={styles.energies}>
            {ENERGY_TERMS.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd dir="ltr">{energy[key].toFixed(2)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.missing}>Binding-energy estimates unavailable</p>
        )}
      </div>
    </section>
  );
}

/** A lab record keeps the proposed edit, guide comparison and evidence together. */
export function LabEditReport({ edit }: { edit: Edit }) {
  const target = edit.variant ?? `Variant ${edit.variation_id}`;
  const advice = edit.advisability;
  return (
    <article className={styles.target} aria-label={`Editing target ${target}`}>
      <header className={styles.targetHeader}>
        <p className={styles.eyebrow}>
          Editing target · Variation {edit.variation_id}
        </p>
        <h3 dir="ltr">{target}</h3>
        {edit.disease && <p className={styles.disease}>{edit.disease}</p>}
      </header>
      <section className={styles.section}>
        <h4>Proposed strategy</h4>
        <p className={styles.strategy}>{edit.strategy}</p>
        <p>{edit.rationale}</p>
        <dl className={styles.activity}>
          <div>
            <dt>Highest guide activity</dt>
            <dd dir="ltr">
              {advice?.score != null
                ? `${advice.score.toFixed(1)} /100`
                : "Not scored"}
            </dd>
          </div>
          {advice && (
            <div>
              <dt>Provisional threshold</dt>
              <dd dir="ltr">{advice.threshold} /100</dd>
            </div>
          )}
        </dl>
        {advice?.score != null && (
          <p className={styles.annotation}>
            This score estimates cutting activity, not correction success or
            off-target safety.
          </p>
        )}
      </section>
      <section className={styles.section}>
        <h4>Off-target assessment</h4>
        <p>{edit.off_target}</p>
      </section>
      {edit.guides.length > 0 ? (
        <>
          <div
            className={styles.comparisonScroll}
            data-base-ui-swipe-ignore="x"
            role="region"
            aria-label={`Guide comparison for ${target}`}
            tabIndex={0}
          >
            <table className={styles.comparison}>
              <caption>Guide comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Guide</th>
                  <th scope="col">
                    Distance <span>bp</span>
                  </th>
                  <th scope="col">
                    Activity <span>/100</span>
                  </th>
                  <th scope="col">Allele match</th>
                </tr>
              </thead>
              <tbody>
                {edit.guides.map((guide, index) => (
                  <tr
                    key={`${guide.strand}:${guide.cut_position}:${guide.spacer}`}
                    data-best={guide.spacer === advice?.best_guide}
                  >
                    <th scope="row">G{index + 1}</th>
                    <td>{guide.cut_distance}</td>
                    <td>
                      {guide.efficiency === null
                        ? "Not scored"
                        : guide.efficiency.toFixed(1)}
                    </td>
                    <td>
                      {guide.allele_specific ? "Mutant only" : "Both alleles"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.annotation}>
            Distance is measured from the variant. Guide IDs follow design
            order; full evidence is listed below.
          </p>
          <section
            className={styles.evidence}
            aria-label={`Guide evidence for ${target}`}
          >
            <h4>Guide evidence</h4>
            {edit.guides.map((guide, index) => (
              <GuideEvidence
                key={`${guide.strand}:${guide.cut_position}:${guide.spacer}`}
                guide={guide}
                number={index + 1}
                highestActivity={guide.spacer === advice?.best_guide}
              />
            ))}
          </section>
        </>
      ) : (
        <section className={styles.section}>
          <h4>No guide candidates</h4>
          <p>
            No SpCas9 guide could be designed within cutting distance of this
            variant.
          </p>
        </section>
      )}
      {edit.repair_template && (
        <section className={styles.section}>
          <h4>
            Repair template{" "}
            <span className={styles.unit}>
              {edit.repair_template.length} nt
            </span>
          </h4>
          <code className={styles.template} dir="ltr">
            {edit.repair_template}
          </code>
          {edit.repair_template_notes && (
            <p className={styles.annotation}>{edit.repair_template_notes}</p>
          )}
        </section>
      )}
      {!edit.repair_template && edit.repair_template_notes && (
        <p className={styles.annotation}>{edit.repair_template_notes}</p>
      )}
      <section className={styles.section}>
        <h4>Alternative approach</h4>
        <p>{edit.alternative}</p>
      </section>
      {advice && (
        <section className={styles.section}>
          <h4>Scoring method</h4>
          <p className={styles.annotation}>
            {advice.guides_scored} guides scored · {advice.guides_skipped}{" "}
            skipped · {advice.band} band
          </p>
          <p className={styles.annotation}>{advice.basis}</p>
        </section>
      )}
    </article>
  );
}
