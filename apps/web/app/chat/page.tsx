import type { Metadata } from "next";
import styles from "./chat.module.css";

export const metadata: Metadata = {
  title: "Chat — Crispr workbench",
  description:
    "Ask about simulated genomes, genes, organs and CRISPR edit designs. Prototype on illustrative data; not medical advice.",
};

/**
 * The workbench is a self-contained page in `public/workbench/` (source and
 * build steps: `prototypes/chat-workbench`). It is embedded same-origin so its
 * styles cannot collide with the app's, and it is granted the microphone for
 * voice input.
 */
export default function ChatPage() {
  return (
    <main className={styles.main}>
      <h1 className={styles.srOnly}>Crispr chat workbench</h1>
      <iframe
        className={styles.frame}
        src="/workbench/index.html"
        title="Crispr chat workbench"
        allow="microphone"
      />
    </main>
  );
}
