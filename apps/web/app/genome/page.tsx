import manifest from "@crispr/human-model/asset-manifest";
import type { Metadata } from "next";
import Link from "next/link";
import { EditPlanCard, SummaryCard } from "@crispr/ui/genome/cards";
import { GenomeWorkspace } from "./genome-workspace";
import { ThemeToggle } from "../theme-toggle";
import { DEMO_REPORT } from "@crispr/ui/genome/report";
import styles from "@crispr/ui/genome/genome.module.css";
import wordmark from "../wordmark.module.css";

export const metadata: Metadata = {
  title: "Genome — Your genome",
  description:
    "Genome results on a body twin: findings, carrier status, and the edit plan concept.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/genome", label: "Genome", current: true },
  { href: "/genome#ask", label: "Genome AI" },
  { href: "/genome#edit-plan", label: "Edit plan" },
] as const;

export default function GenomePage() {
  const report = DEMO_REPORT;
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#results">
        Skip to results
      </a>
      <header className={styles.top}>
        <Link
          href="/"
          className={wordmark.wordmark}
          aria-label="Genome home"
          translate="no"
        >
          Genome
        </Link>
        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              aria-current={"current" in item ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.topRight}>
          <ThemeToggle className={styles.plainButton} />
          <button type="button" className={styles.plainButton}>
            Invite friend
          </button>
        </div>
      </header>
      <GenomeWorkspace
        report={report}
        modelUrls={{
          male: `/models/human/${manifest.male.file}`,
          female: `/models/human/${manifest.female.file}`,
        }}
        summary={<SummaryCard report={report} />}
        editPlan={<EditPlanCard report={report} />}
      />
    </div>
  );
}
