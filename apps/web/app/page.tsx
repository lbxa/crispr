import manifest from "@crispr/human-model/asset-manifest";
import Link from "next/link";
import { ModelWorkspace } from "./model-workspace";
import styles from "./page.module.css";
import wordmark from "./wordmark.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.srOnly}>Gene editing workspace</h1>
      <Link
        href="/"
        className={`${wordmark.wordmark} ${wordmark.home}`}
        aria-label="Genome home"
        translate="no"
      >
        Genome
      </Link>
      <ModelWorkspace
        modelUrls={{
          male: `/models/human/${manifest.male.file}`,
          female: `/models/human/${manifest.female.file}`,
        }}
      />
    </main>
  );
}
