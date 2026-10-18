"use client";

import dynamic from "next/dynamic";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import type { HumanModelHighlight } from "@crispr/human-model";
import {
  MODEL_PROFILES,
  type ModelProfile,
} from "@crispr/human-model/profiles";
import {
  ArrowUpRight,
  ChevronDown,
  Heart,
  Mic,
  Search,
  Spark,
  StatusGlyph,
} from "@crispr/ui/genome/icons";
import {
  BODY_SYSTEMS,
  type BodySystemId,
  countByStatus,
  type FindingStatus,
  type GenomeReport,
  type Inheritance,
  type PanelResult,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_RANK,
  worstStatus,
} from "@crispr/ui/genome/report";
import styles from "@crispr/ui/genome/genome.module.css";

// The dashboard hydrates without downloading Three.js.
const HumanModel = dynamic(
  () => import("@crispr/human-model").then((module) => module.HumanModel),
  {
    ssr: false,
    loading: () => (
      <p className={styles.loading} role="status">
        Preparing your body twin…
      </p>
    ),
  },
);

type SystemFilter = "all" | BodySystemId;

const systemLabel = (id: BodySystemId) =>
  BODY_SYSTEMS.find((system) => system.id === id)?.label ?? id;

export function GenomeWorkspace({
  report,
  modelUrls,
  summary,
  editPlan,
}: {
  report: GenomeReport;
  modelUrls: Record<ModelProfile, string>;
  summary: ReactNode;
  editPlan: ReactNode;
}) {
  const [profile, setProfile] = useState<ModelProfile>("male");
  const [system, setSystem] = useState<SystemFilter>("all");
  const [openGene, setOpenGene] = useState<string | null>(
    () =>
      report.results.find((result) => result.status === "likely")?.gene ?? null,
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FindingStatus>(
    "all",
  );
  const [inheritanceFilter, setInheritanceFilter] = useState<
    "all" | Inheritance
  >("all");
  const [askReply, setAskReply] = useState<string | null>(null);

  const counts = countByStatus(report.results);
  const total = report.results.length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return report.results
      .filter((result) => system === "all" || result.system === system)
      .filter(
        (result) => statusFilter === "all" || result.status === statusFilter,
      )
      .filter(
        (result) =>
          inheritanceFilter === "all" ||
          result.inheritance === inheritanceFilter,
      )
      .filter(
        (result) =>
          !needle ||
          result.name.toLowerCase().includes(needle) ||
          result.gene.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.fit - a.fit,
      );
  }, [report.results, system, statusFilter, inheritanceFilter, query]);

  // The body shows the open result, else the selected system, else the top finding.
  const focus = useMemo(() => {
    const open = report.results.find((result) => result.gene === openGene);
    if (open) {
      return {
        system: open.system,
        status: open.status,
        caption: `${systemLabel(open.system)} · ${open.name.split(",")[0]}`,
      };
    }
    if (system !== "all") {
      const status = worstStatus(
        report.results.filter((result) => result.system === system),
      );
      return {
        system,
        status,
        caption: `${systemLabel(system)} · ${status === "clear" ? "all clear" : `${STATUS_LABEL[status].toLowerCase()} finding`}`,
      };
    }
    const top = [...report.results].sort(
      (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
    )[0];
    return top
      ? {
          system: top.system,
          status: top.status,
          caption: `${systemLabel(top.system)} · ${STATUS_LABEL[top.status].toLowerCase()} finding`,
        }
      : null;
  }, [report.results, openGene, system]);

  const highlights = useMemo<readonly HumanModelHighlight[]>(() => {
    if (!focus) return [];
    const regions =
      BODY_SYSTEMS.find((entry) => entry.id === focus.system)?.regions ?? [];
    return regions.map((regionId) => ({
      regionId,
      color: STATUS_COLOR[focus.status],
    }));
  }, [focus]);

  function selectSystem(next: SystemFilter) {
    setSystem(next);
    setOpenGene(null);
  }

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const question = new FormData(form).get("question");
    if (typeof question !== "string" || !question.trim()) return;
    // Placeholder until the page calls Granite through the backend.
    setAskReply(
      "Crispr AI will answer from your report once the backend is connected. For now: your one likely finding is hereditary hemochromatosis, and the next step is a ferritin blood test.",
    );
    form.reset();
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.rail} aria-label="Body systems">
        <div className={styles.tabs}>
          <span aria-current="page">Twin</span>
          <span aria-disabled="true">Reports</span>
        </div>
        <ul className={styles.systems}>
          <li>
            <button
              type="button"
              className={styles.sys}
              aria-pressed={system === "all"}
              onClick={() => selectSystem("all")}
            >
              <span className={styles.grade} data-grade="all">
                <Heart width="12" height="12" />
              </span>
              Summary
            </button>
          </li>
          <li className={styles.railGroup} aria-hidden="true">
            Body systems
          </li>
          {BODY_SYSTEMS.map((entry) => {
            const results = report.results.filter(
              (result) => result.system === entry.id,
            );
            const grade = worstStatus(results);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={styles.sys}
                  aria-pressed={system === entry.id}
                  onClick={() => selectSystem(entry.id)}
                >
                  <span className={styles.grade} data-grade={grade}>
                    <StatusGlyph status={grade} />
                  </span>
                  {entry.label}
                  <span className={styles.srOnly}>, {STATUS_LABEL[grade]}</span>
                  <span className={styles.count}>{results.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className={styles.stage} aria-label="Body twin">
        <div className={styles.model}>
          <HumanModel
            profile={profile}
            modelUrl={modelUrls[profile]}
            highlights={highlights}
          />
        </div>
        <div className={styles.stageDock}>
          {focus && (
            <p className={styles.caption} role="status">
              <span className={styles.dot} data-status={focus.status} />
              {focus.caption}
            </p>
          )}
          <fieldset className={styles.profiles}>
            <legend className={styles.srOnly}>Body profile</legend>
            {(["male", "female"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="profile"
                  value={value}
                  checked={profile === value}
                  onChange={() => setProfile(value)}
                />
                <span>{MODEL_PROFILES[value].label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </section>

      <main className={styles.panel} id="results" tabIndex={-1}>
        <h1 className={styles.srOnly}>Your genome results</h1>
        {summary}

        <section
          className={styles.card}
          id="disease-panel"
          aria-labelledby="panel-title"
        >
          <h3 id="panel-title">Disease panel</h3>
          <dl className={styles.counts}>
            <div>
              <dt>Screened</dt>
              <dd>{total}</dd>
            </div>
            {(["clear", "carrier", "likely"] as const).map((status) => (
              <div key={status} data-faint>
                <dt>{STATUS_LABEL[status]}</dt>
                <dd>{counts[status]}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.partition} aria-hidden="true">
            {(["clear", "carrier", "likely"] as const).map((status) =>
              counts[status] ? (
                <span
                  key={status}
                  data-status={status}
                  style={{ flexGrow: counts[status] }}
                />
              ) : null,
            )}
          </div>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <Search />
              <span className={styles.srOnly}>Search diseases or genes</span>
              <input
                type="search"
                name="q"
                placeholder="Search diseases or genes…"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className={styles.select}>
              <span className={styles.srOnly}>Filter by status</span>
              <select
                name="status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "all" | FindingStatus)
                }
              >
                <option value="all">All results</option>
                <option value="likely">Likely</option>
                <option value="carrier">Carrier</option>
                <option value="clear">Clear</option>
              </select>
              <ChevronDown />
            </label>
            <label className={styles.select}>
              <span className={styles.srOnly}>Filter by inheritance</span>
              <select
                name="inheritance"
                value={inheritanceFilter}
                onChange={(event) =>
                  setInheritanceFilter(
                    event.target.value as "all" | Inheritance,
                  )
                }
              >
                <option value="all">All inheritance</option>
                <option value="Recessive">Recessive</option>
                <option value="Dominant">Dominant</option>
                <option value="X-linked">X-linked</option>
              </select>
              <ChevronDown />
            </label>
          </div>
        </section>

        <div>
          <div className={styles.tableHead} aria-hidden="true">
            <span>Condition</span>
            <span>Gene</span>
            <span>Status</span>
            <span>Symptom fit</span>
            <span />
          </div>
          <div className={styles.rows} aria-live="polite">
            {visible.length === 0 ? (
              <p className={styles.empty}>
                No conditions match these filters. Try a gene name such as HFE,
                or clear the filters.
              </p>
            ) : (
              visible.map((result) => (
                <ResultRow
                  key={result.gene}
                  result={result}
                  open={openGene === result.gene}
                  onToggle={() =>
                    setOpenGene((current) =>
                      current === result.gene ? null : result.gene,
                    )
                  }
                />
              ))
            )}
          </div>
        </div>

        {editPlan}

        <p className={styles.disclaimer}>
          Research prototype on simulated genomes. Not medical advice.
        </p>
      </main>

      {askReply && (
        <p className={styles.askReply} role="status">
          {askReply}
        </p>
      )}
      <form className={styles.ask} id="ask" onSubmit={ask}>
        <Spark className={styles.spark} />
        <label className={styles.srOnly} htmlFor="ask-input">
          Ask Crispr AI
        </label>
        <input
          id="ask-input"
          name="question"
          placeholder="Ask Crispr AI…"
          autoComplete="off"
        />
        <button
          type="button"
          className={styles.mic}
          aria-label="Speak your question"
        >
          <Mic />
        </button>
      </form>
    </div>
  );
}

function ResultRow({
  result,
  open,
  onToggle,
}: {
  result: PanelResult;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = `result-${result.gene}`;
  return (
    <>
      <button
        type="button"
        className={styles.row}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
      >
        <span className={styles.rowName}>
          <span className={styles.cat}>{systemLabel(result.system)}</span>
          <span className={styles.name}>{result.name}</span>
        </span>
        <span className={styles.gene} translate="no">
          {result.gene}
        </span>
        <span className={styles.status} data-status={result.status}>
          <span className={styles.dot} data-status={result.status} />
          {STATUS_LABEL[result.status]}
        </span>
        <span
          className={styles.fit}
          data-status={result.status}
          aria-label={`Symptom fit ${result.fit} of 5`}
        >
          {[1, 2, 3, 4, 5].map((step) => (
            <i
              key={step}
              data-filled={step <= result.fit || undefined}
              style={{ height: 6 + step * 3 }}
            />
          ))}
        </span>
        <ChevronDown className={styles.chev} />
      </button>
      {open && (
        <div className={styles.detail} id={detailId}>
          <dl>
            <dt>Gene</dt>
            <dd translate="no">{result.gene}</dd>
            <dt>Inheritance</dt>
            <dd>{result.inheritance}</dd>
            <dt>Copies found</dt>
            <dd>{result.copies}</dd>
            <dt>Matched symptoms</dt>
            <dd>{result.matchedSymptoms}</dd>
          </dl>
          {result.status === "likely" && (
            <a className={styles.linkish} href="#edit-plan">
              See edit plan <ArrowUpRight />
            </a>
          )}
          {result.status === "carrier" && (
            <p>
              Carriers usually have no symptoms. Partners can test the same gene
              before a pregnancy.
            </p>
          )}
        </div>
      )}
    </>
  );
}
