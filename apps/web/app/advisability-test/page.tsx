import Link from "next/link";
import { AdvisabilityTest } from "./advisability-test";
import styles from "./advisability-test.module.css";

export const metadata = {
  title: "Crispr — Advisability test",
};

export default function AdvisabilityTestPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          crispr<span aria-hidden="true">.</span>
        </Link>
        <span className={styles.tag}>
          CRISPRon advisability — integration test
        </span>
      </header>
      <main>
        <AdvisabilityTest
          defaultApi={
            process.env.NEXT_PUBLIC_CRISPR_API ?? "http://localhost:8000"
          }
        />
      </main>
    </div>
  );
}
