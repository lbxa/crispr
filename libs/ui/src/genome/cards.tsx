import { ArrowUpRight, Check, Spark } from "./icons";
import { countByStatus, type GenomeReport } from "./report";
import styles from "./genome.module.css";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function SummaryCard({ report }: { report: GenomeReport }) {
  const counts = countByStatus(report.results);
  return (
    <section className={styles.card} aria-labelledby="summary-title">
      <div className={styles.cardHead}>
        <h2 id="summary-title">Summary</h2>
        <span className={styles.meta}>
          Kit <span translate="no">{report.kitId}</span> · analysed{" "}
          <time dateTime={report.analysedOn}>
            {dateFormat.format(new Date(report.analysedOn))}
          </time>
        </span>
      </div>
      <div className={styles.tiles}>
        <a className={styles.tile} href="#disease-panel">
          <div className={styles.tileTop}>
            <h3>Findings</h3>
            <ArrowUpRight />
          </div>
          <p className={styles.big}>
            {counts.likely}
            <small>likely of {report.results.length}</small>
          </p>
          <p>One result fits both your DNA and your symptoms.</p>
        </a>
        <a className={styles.tile} href="#disease-panel">
          <div className={styles.tileTop}>
            <h3>Carrier status</h3>
            <ArrowUpRight />
          </div>
          <p className={styles.big}>
            {counts.carrier}
            <small>variants</small>
          </p>
          <p>
            One copy each. Usually no symptoms, but relevant for family
            planning.
          </p>
        </a>
      </div>
      <p className={styles.summaryText}>{report.summary}</p>
      <button type="button" className={styles.linkish}>
        <Spark className={styles.spark} />
        Update my symptoms
        <ArrowUpRight />
      </button>
    </section>
  );
}

export function EditPlanCard({ report }: { report: GenomeReport }) {
  const plan = report.editPlan;
  return (
    <section
      className={styles.card}
      id="edit-plan"
      aria-labelledby="edit-plan-title"
    >
      <div className={styles.cardHead}>
        <h2 id="edit-plan-title">Edit plan</h2>
        <span className={styles.meta}>Concept · not a treatment</span>
      </div>
      <div className={styles.planHero}>
        <span className={styles.status} data-status="likely">
          <span className={styles.dot} data-status="likely" />
          {plan.condition} · <span translate="no">{plan.gene}</span>
        </span>
        <p>{plan.approach}</p>
      </div>
      <ol className={styles.steps}>
        {plan.steps.map((step, index) => (
          <li
            key={step.title}
            className={styles.step}
            data-done={step.done || undefined}
          >
            <span className={styles.marker}>
              {step.done ? <Check /> : index + 1}
            </span>
            <div>
              <h4>{step.title}</h4>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className={styles.caveats}>
        <strong>What this plan does not cover</strong>
        <span>{plan.limits}</span>
      </div>
      <div className={styles.planActions}>
        <button type="button" className={styles.btnPrimary}>
          Book a counsellor call
        </button>
        <button type="button" className={styles.btn}>
          Download report (PDF)
        </button>
      </div>
    </section>
  );
}
