import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import * as publicApi from "./index";

const { assertNever } = publicApi;

function presentIncompleteState(state: "ready" | "failed"): string {
  switch (state) {
    case "ready":
      return "Ready";
    default:
      // @ts-expect-error This fixture must remain non-exhaustive so widening
      // assertNever's first parameter makes type-checking fail.
      return assertNever(state, "Unhandled fixture state");
  }
}

describe("assertNever", () => {
  it("rejects a concrete remainder from a non-exhaustive switch", () => {
    // Arrange
    const state = "ready";

    // Act
    const result = presentIncompleteState(state);

    // Assert
    expect(result).toBe("Ready");
  });

  it("throws with the supplied context and unexpected runtime value", () => {
    // Arrange
    const impossibleValue = "FUTURE_VARIANT" as never;

    // Act
    const act = () =>
      assertNever(impossibleValue, "Unhandled prescription failure");

    // Assert
    expect(act).toThrow("Unhandled prescription failure: FUTURE_VARIANT");
  });

  it("is the package's only public runtime export", () => {
    // Arrange
    const expectedExports = ["assertNever"];

    // Act
    const exports = Object.keys(publicApi);

    // Assert
    expect(exports).toEqual(expectedExports);
  });

  it("keeps the root source export surface frozen to assertNever", () => {
    // Arrange
    const expectedSource = 'export { assertNever } from "./assert-never";';

    // Act
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    // Assert
    expect(source.trim()).toBe(expectedSource);
  });

  it("keeps the package root-only and free of all runtime dependencies", () => {
    // Arrange
    const expectedExportMap = { ".": "./src/index.ts" };
    const runtimeDependencyFields = [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "bundledDependencies",
      "bundleDependencies",
    ] as const;

    // Act
    const packageContract = {
      runtimeDependencies: Object.fromEntries(
        runtimeDependencyFields.map((field) => [
          field,
          Reflect.get(packageJson, field),
        ]),
      ),
      exports: packageJson.exports,
    };

    // Assert
    expect(packageContract).toEqual({
      runtimeDependencies: {
        dependencies: undefined,
        peerDependencies: undefined,
        optionalDependencies: undefined,
        bundledDependencies: undefined,
        bundleDependencies: undefined,
      },
      exports: expectedExportMap,
    });
  });
});
