import type { GenomeFileInfo, GenomeProgress, GenomeReport } from "./contract";
import { formatGenomeBytes } from "./contract";
import type { GenomeRegion } from "./genome-view";
import { CrisprReport } from "../crispr/report";
import { OverviewPanel, Raw } from "../crispr/panels";
import styles from "./report.module.css";

const numbers = new Intl.NumberFormat("en-US");
const INHERITANCE = {
  AD: "Autosomal dominant",
  AR: "Autosomal recessive",
  XLR: "X-linked recessive",
  XLD: "X-linked dominant",
} as const;

/** Evidence from the analyzed genome, never a substitute catalog gene plan. */
export function FindingReport({
  finding,
  regions = [],
}: {
  finding?: GenomeReport["findings"][number];
  regions?: readonly GenomeRegion[];
}) {
  return (
    <div className={styles.sections}>
      {finding && (
        <section>
          <h3>Genetic evidence</h3>
          <dl>
            <dt>Finding</dt>
            <dd>
              {finding.tier === "carrier"
                ? "Carrier"
                : `${finding.tier === "likely" ? "Likely" : "Possible"} finding`}
            </dd>
            {finding.inheritance && (
              <>
                <dt>Inheritance</dt>
                <dd>{INHERITANCE[finding.inheritance]}</dd>
              </>
            )}
            {finding.genotype && (
              <>
                <dt>Genotype</dt>
                <dd>{finding.genotype.explanation}</dd>
              </>
            )}
            {finding.omim_id && (
              <>
                <dt>OMIM</dt>
                <dd>{finding.omim_id}</dd>
              </>
            )}
          </dl>
        </section>
      )}
      <section>
        <h3>Variant evidence</h3>
        {finding?.variants?.length ? (
          finding.variants.map((variant, index) => (
            <div
              className={styles.variant}
              key={`${variant.variation_id}:${index}`}
            >
              <h4>
                {variant.name ??
                  `Chr ${variant.chrom}:${numbers.format(variant.pos)}`}
              </h4>
              <dl>
                <dt>Location · GRCh38</dt>
                <dd>
                  Chr {variant.chrom}:{numbers.format(variant.pos)}
                </dd>
                <dt>Reference allele</dt>
                <dd className={styles.sequence}>{variant.ref}</dd>
                <dt>Alternate allele</dt>
                <dd className={styles.sequence}>{variant.alt}</dd>
                <dt>Classification</dt>
                <dd>
                  {variant.significance} · {variant.zygosity}
                </dd>
                <dt>ClinVar</dt>
                <dd>
                  Variation {variant.variation_id} · {variant.stars}/4 review
                  stars{variant.rsid ? ` · ${variant.rsid}` : ""}
                </dd>
              </dl>
            </div>
          ))
        ) : regions.length ? (
          regions.map((region) => (
            <div className={styles.variant} key={region.id}>
              <h4>
                Chr {region.chromosome}:{numbers.format(region.start + 1)}
                {region.end > region.start + 1
                  ? `–${numbers.format(region.end)}`
                  : ""}
              </h4>
              <dl>
                <dt>Reference allele</dt>
                <dd className={styles.sequence}>{region.reference}</dd>
                <dt>Alternate allele</dt>
                <dd className={styles.sequence}>{region.alternate}</dd>
                <dt>Classification</dt>
                <dd>
                  {region.clinical_significance} · {region.zygosity}
                </dd>
              </dl>
            </div>
          ))
        ) : (
          <p>Variant details are unavailable in this saved report.</p>
        )}
      </section>
      {finding?.phenotype && (
        <section>
          <h3>Symptom match</h3>
          <p>
            Panel rank {finding.phenotype.rank} · similarity score{" "}
            {finding.phenotype.score.toFixed(2)}
          </p>
          <ul>
            {finding.phenotype.matched_terms.map((term, index) => (
              <li key={`${term.hpo_id}:${index}`}>
                {term.patient_term} → {term.disease_term} ({term.hpo_id})
              </li>
            ))}
          </ul>
        </section>
      )}
      {finding && finding.tier !== "carrier" && !!finding.crispr?.length && (
        <section>
          <h3>CRISPR analysis</h3>
          <CrisprReport
            edits={finding.crispr}
            subject={`${finding.gene} · ${finding.disease}`}
          />
        </section>
      )}
    </div>
  );
}

export function GenomeReportDetails({
  report,
  file,
  progress,
}: {
  report: GenomeReport;
  file: GenomeFileInfo;
  progress: GenomeProgress;
}) {
  return (
    <div className={styles.sections}>
      <section>
        <h2>{report.conclusion.label}</h2>
        <p>{report.summary.text}</p>
        <dl>
          <dt>Genome file</dt>
          <dd>
            {file.name} · {formatGenomeBytes(file.size)}
          </dd>
          <dt>Variants checked</dt>
          <dd>{numbers.format(report.genome.variants_checked)}</dd>
          <dt>Records scanned</dt>
          <dd>{numbers.format(progress.records_scanned)}</dd>
          <dt>Panel variants retained</dt>
          <dd>{numbers.format(progress.retained_variants)}</dd>
          <dt>Screened genes</dt>
          <dd className={styles.sequence}>
            {report.genome.panel_genes.join(", ")}
          </dd>
          {report.genome_view && (
            <>
              <dt>Reference assembly</dt>
              <dd>{report.genome_view.assembly}</dd>
            </>
          )}
        </dl>
      </section>
      {report.overview && (
        <OverviewPanel overview={report.overview} subject="Genome analysis" />
      )}
      {report.findings.map((finding, index) => (
        <section key={`${finding.gene}:${index}`}>
          <h2>{finding.disease}</h2>
          <p className={styles.gene}>{finding.gene}</p>
          <FindingReport
            finding={finding}
            regions={report.genome_view?.regions.filter((region) =>
              region.annotations.some(
                (annotation) =>
                  annotation.gene === finding.gene &&
                  annotation.disease === finding.disease,
              ),
            )}
          />
        </section>
      ))}
      {report.symptoms && (
        <section>
          <h2>Symptoms</h2>
          <p>
            {report.symptoms.text ||
              "No symptoms supplied for this genome-only analysis."}
          </p>
          {!!report.symptoms.terms.length && (
            <ul>
              {report.symptoms.terms.map((term) => (
                <li key={term.id}>
                  {term.name} ({term.id}) · {term.matched_text}
                </li>
              ))}
            </ul>
          )}
          {!!report.symptoms.closest_panel_diseases.length && (
            <>
              <h3>Closest panel matches</h3>
              <ul>
                {report.symptoms.closest_panel_diseases.map((disease) => (
                  <li key={disease.omim_id}>
                    {disease.disease} · {disease.score.toFixed(2)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {!!report.predicted_symptoms?.length && (
        <section>
          <h2>Predicted symptoms</h2>
          <ul>
            {report.predicted_symptoms.map((term) => (
              <li key={term.id}>
                {term.name} ({term.id})
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={styles.disclaimer}>{report.disclaimer}</p>
      <Raw value={report} />
    </div>
  );
}
