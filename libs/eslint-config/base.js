import babelParser from "@babel/eslint-parser";
import { createRequire } from "node:module";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import globals from "globals";

const require = createRequire(import.meta.url);

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, Bun: "readonly" },
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [require.resolve("@babel/preset-typescript")],
        },
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  // TypeScript owns name resolution; ESLint's core rules do not understand types.
  {
    files: ["**/*.{ts,tsx}"],
    rules: { "no-undef": "off", "no-unused-vars": "off" },
  },
  {
    files: ["**/*.{tsx,jsx}"],
    languageOptions: {
      parserOptions: {
        babelOptions: {
          plugins: [require.resolve("@babel/plugin-syntax-jsx")],
        },
      },
    },
  },
  {
    ignores: ["dist/**"],
  },
];
