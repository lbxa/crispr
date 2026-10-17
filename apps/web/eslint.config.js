import { nextJsConfig } from "@crispr/eslint-config/next-js";
import { globalIgnores } from "eslint/config";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  globalIgnores([".open-next/**", ".wrangler/**", "cloudflare-env.d.ts"]),
];
