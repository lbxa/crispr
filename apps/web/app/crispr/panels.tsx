"use client";

import { useEffect, useState } from "react";
import styles from "./crispr.module.css";
import type { Advisability, Edit, Energy, Guide, Overview } from "./contract";

const ENERGY_TERMS: [keyof Energy, string, string][] = [
  [
    "rna_dna",
    "RNA–DNA hybrid",
    "Energy of the guide binding its target (kcal/mol)",
  ],
  ["rna_dna_weighted", "RNA–DNA hybrid, weighted", "Same, position-weighted"],
  ["dna_opening", "DNA opening", "Energy to unzip the target DNA"],
  [
    "spacer_self_fold",
    "Spacer self-fold",
    "Guide folding on itself, which can block binding",
  ],
  [
    "crisproff_score",
    "CRISPRoff score",
    "Combined binding score; the model's ΔG input",
  ],
];

function Context({ context }: { context: string }) {
  const parts: [string, string, string | undefined][] = [
    [context.slice(0, 4), "5′ context", styles.ctx5],
    [context.slice(4, 24), "protospacer", styles.ctxSpacer],
    [context.slice(24, 27), "PAM", styles.ctxPam],
    [context.slice(27), "3′ context", styles.ctx3],
  ];
  return (
    <span className={styles.mono} data-testid="context">
      {parts.map(([text, title, className]) => (
        <span key={title} className={className} title={title}>
          {text}
        </span>
      ))}
    </span>
  );
}

function GuideDetails({ guide }: { guide: Guide }) {
  const models = guide.model_scores ? Object.entries(guide.model_scores) : [];
  return (
    <div className={styles.details} data-testid="guide-details">
      <div>
        <h5>Site</h5>
        <p className={styles.muted}>
          Cuts after position {guide.cut_position} on the {guide.strand} strand,{" "}
          {guide.cut_distance} bp from the variant · GC{" "}
          {Math.round(guide.gc_content * 100)}% ·{" "}
          {guide.allele_specific
            ? "allele-specific (mutant copy only)"
            : "also matches the healthy allele"}
        </p>
        {guide.notes.map((note) => (
          <p key={note} className={styles.muted}>
            {note}
          </p>
        ))}
        {guide.context && (
          <p>
            <span className={styles.muted}>Model input (30 nt): </span>
            <Context context={guide.context} />
          </p>
        )}
      </div>
      {models.length > 0 && (
        <div>
          <h5>Ensemble ({models.length} models)</h5>
          {models.map(([name, value]) => (
            <div key={name} className={styles.modelRow}>
              <span className={styles.muted}>
                {name.replace(".model.best", "")}
              </span>
              <span className={styles.bar}>
                <span
                  style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                />
              </span>
              <span>{value.toFixed(1)}</span>
            </div>
          ))}
          <p className={styles.muted}>
            range {Math.min(...models.map(([, v]) => v)).toFixed(1)}–
            {Math.max(...models.map(([, v]) => v)).toFixed(1)}
          </p>
        </div>
      )}
      {guide.energy && (
        <div>
          <h5>Binding energies (CRISPRoff)</h5>
          <table className={styles.table}>
            <tbody>
              {ENERGY_TERMS.map(([key, label, hint]) => (
                <tr key={key} title={hint}>
                  <td>{label}</td>
                  <td>{guide.energy?.[key].toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Gauge({ advisability }: { advisability: Advisability }) {
  const { score, band } = advisability;
  return (
    <div className={styles.gauge} data-band={band} data-testid="advisability">
      <div className={styles.gaugeScore}>
        {score === null ? "—" : Math.round(score)}
        <span>/100</span>
      </div>
      <div>
        <div className={styles.gaugeLabel}>{advisability.label}</div>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.fill} style={{ width: `${score ?? 0}%` }} />
        </div>
        <div className={styles.muted}>
          band: <b data-testid="band">{band}</b> · {advisability.guides_scored}{" "}
          guide(s) scored
          {advisability.guides_skipped > 0 &&
            `, ${advisability.guides_skipped} skipped`}
        </div>
      </div>
    </div>
  );
}

function GuideRow({ guide, best }: { guide: Guide; best: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        data-best={best}
        className={styles.row}
        onClick={() => setOpen(!open)}
      >
        <td className={styles.mono}>
          <button
            className={styles.toggle}
            aria-expanded={open}
            aria-label="Toggle guide details"
          >
            {open ? "▾" : "▸"}
          </button>
          {guide.spacer}
        </td>
        <td className={styles.mono}>{guide.pam}</td>
        <td>{guide.strand}</td>
        <td>{guide.cut_distance}</td>
        <td>{guide.score}</td>
        <td>
          {guide.efficiency === null ? "n/a" : guide.efficiency.toFixed(1)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <GuideDetails guide={guide} />
          </td>
        </tr>
      )}
    </>
  );
}

export function EditCard({ edit }: { edit: Edit }) {
  return (
    <section className={styles.edit}>
      <h4>{edit.variant}</h4>
      <p className={styles.muted}>{edit.strategy}</p>
      {edit.advisability && <Gauge advisability={edit.advisability} />}
      {edit.advisability && (
        <p className={styles.basis}>{edit.advisability.basis}</p>
      )}
      {edit.guides.length === 0 ? (
        <p className={styles.muted}>
          No SpCas9 guide could be designed within cutting distance of this
          variant. {edit.alternative}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Spacer</th>
              <th>PAM</th>
              <th>Strand</th>
              <th>Cut dist.</th>
              <th>Rule score</th>
              <th>CRISPRon</th>
            </tr>
          </thead>
          <tbody>
            {edit.guides.map((guide) => (
              <GuideRow
                key={`${guide.strand}${guide.cut_position}${guide.spacer}`}
                guide={guide}
                best={guide.spacer === edit.advisability?.best_guide}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const VERDICT_TITLE: Record<Overview["verdict"], string> = {
  recommended: "Gene editing looks promising",
  not_recommended: "Gene editing looks unlikely to work well",
  unavailable: "We couldn't estimate this",
  no_guide: "No suitable edit site found",
  no_edit: "No gene edit suggested",
};

const VERDICT_PLAIN: Record<Overview["verdict"], string> = {
  recommended:
    "Based on this analysis, CRISPR gene editing is a reasonable option to discuss with your care team.",
  not_recommended:
    "Based on this analysis, CRISPR gene editing is unlikely to work well for this condition. Other treatments may be a better fit.",
  unavailable:
    "We couldn't predict how well gene editing would work for this result.",
  no_guide:
    "No standard CRISPR guide could be designed close enough to this variant. Other editing approaches may still be possible.",
  no_edit: "This result doesn't point to a gene edit.",
};

const FILL_MS = 1400;
// Where the bar's colour ends up, as an HSL hue: green when advisable, red when not.
const FINAL_HUE: Partial<Record<Overview["verdict"], number>> = {
  recommended: 140,
  not_recommended: 8,
};

function prefersReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

/** Eases from 0 up to `target`, or jumps straight there when the user prefers reduced motion. */
function useFillProgress(target: number) {
  const [value, setValue] = useState(() =>
    prefersReducedMotion() ? target : 0,
  );
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = requestAnimationFrame(function tick(now) {
      start ??= now;
      const t = Math.min(1, (now - start) / FILL_MS);
      setValue(target * (1 - (1 - t) ** 3)); // ease-out
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    let start: number | undefined;
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

export function OverviewPanel({
  overview,
  subject,
}: {
  overview: Overview;
  subject: string;
}) {
  const { score, threshold } = overview;
  const shown = useFillProgress(score ?? 0);
  const finalHue = FINAL_HUE[overview.verdict];
  // The bar starts red and drifts to its final colour as it fills.
  const fillColor =
    finalHue === undefined
      ? undefined
      : `hsl(${finalHue * (score ? shown / score : 1)} 65% 58%)`;
  return (
    <section
      className={styles.overview}
      data-verdict={overview.verdict}
      data-testid="overview"
      aria-label="CRISPR overview"
    >
      <div className={styles.overviewTop}>
        <div>
          <div className={styles.verdict} data-testid="verdict">
            {VERDICT_TITLE[overview.verdict]}
          </div>
          <div className={styles.muted}>{subject}</div>
        </div>
        <div className={styles.overviewScore}>
          <span data-testid="overview-score">
            {score === null ? "—" : Math.round(shown)}
          </span>
          <span>/100</span>
        </div>
      </div>
      <div
        className={styles.meter}
        role="img"
        aria-label={`Score ${score ?? "unavailable"} out of 100; gene editing is advised from ${threshold}`}
      >
        <div
          className={styles.meterFill}
          data-testid="meter-fill"
          style={{ width: `${shown}%`, background: fillColor }}
        />
        <div className={styles.meterTick} style={{ left: `${threshold}%` }}>
          <span>advised from {threshold}</span>
        </div>
      </div>
      <p className={styles.headline}>{VERDICT_PLAIN[overview.verdict]}</p>
      <p className={styles.basis}>
        The score estimates how reliably a gene edit would work. This is a
        research prototype, not medical advice.
      </p>
    </section>
  );
}

/** Everything a genomics specialist would want; collapsed so the consumer view stays simple. */
export function AdvancedGenomics({
  overview,
  children,
}: {
  overview: Overview;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.advanced} data-testid="advanced">
      <summary>Advanced genomics</summary>
      <div className={styles.advancedBody}>
        <section className={styles.technical}>
          <h4>How the score was reached</h4>
          <p>{overview.headline}</p>
          {overview.target && (
            <p className={styles.muted}>
              Best target: <b>{overview.target}</b>
              {overview.gene && <> ({overview.gene})</>} ·{" "}
              {overview.edits_considered} edit(s) considered
            </p>
          )}
          <p className={styles.basis}>{overview.basis}</p>
        </section>
        {children}
      </div>
    </details>
  );
}
