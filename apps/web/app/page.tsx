import manifest from "@crispr/human-model/asset-manifest";
import Link from "next/link";
import { ModelWorkspace } from "./model-workspace";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Crispr home">
          crispr<span aria-hidden="true">.</span>
        </Link>
      </header>
      <main className={styles.main}>
        <h1 className={styles.srOnly}>Gene editing workspace</h1>
        <ModelWorkspace
          modelUrls={{
            male: `/models/human/${manifest.male.file}`,
            female: `/models/human/${manifest.female.file}`,
          }}
        />
      </main>
    </div>
  );
}
