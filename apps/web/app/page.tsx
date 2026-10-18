import manifest from "@crispr/human-model/asset-manifest";
import { ModelWorkspace } from "./model-workspace";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.srOnly}>Gene editing workspace</h1>
      <ModelWorkspace
        modelUrls={{
          male: `/models/human/${manifest.male.file}`,
          female: `/models/human/${manifest.female.file}`,
        }}
      />
    </main>
  );
}
