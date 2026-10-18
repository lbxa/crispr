import type { Metadata } from "next";
import styles from "./chat.module.css";

export const metadata: Metadata = {
  title: "Chat — Crispr workbench",
  description:
    "Ask about simulated genomes, genes and CRISPR edit designs, answered from NCBI ClinVar variant data when it is imported. Research prototype; not medical advice.",
};

/**
 * The workbench is a self-contained page built by `@crispr/chat-agent`
 * (`libs/chat-agent/web`) and copied to `public/workbench/` by dev/build. It
 * talks to `/api/chat` and `/api/state`, is embedded same-origin so its styles
 * cannot collide with the app's, and is granted the microphone for voice input.
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
