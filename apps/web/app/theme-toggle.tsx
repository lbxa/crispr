"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import styles from "./theme-toggle.module.css";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ""}`}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <span className={styles.toDark}>
        <Moon size={20} aria-hidden="true" />
        <span className={styles.srOnly}>Switch to dark theme</span>
      </span>
      <span className={styles.toLight}>
        <Sun size={20} aria-hidden="true" />
        <span className={styles.srOnly}>Switch to light theme</span>
      </span>
    </button>
  );
}
