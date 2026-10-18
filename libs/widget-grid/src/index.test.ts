import { describe, expect, it } from "vitest";

import {
  WIDGET_FOOTPRINTS,
  buildDropTargets,
  getTailPlacement,
  packLayout,
  reconcileOrder,
  reorderWidgets,
  type WidgetDescriptor,
} from "./index";

const widgets = [
  { id: "bio-age", size: "normal" },
  { id: "summary", size: "normal" },
  { id: "oura", size: "small" },
] as const satisfies readonly WidgetDescriptor[];

describe("packLayout", () => {
  it("packs rectangular cards across two cells and leaves the following row available", () => {
    const items = [
      { id: "files", size: "small" },
      { id: "date", size: "small" },
      { id: "symptoms", size: "wide" },
      { id: "summary", size: "normal" },
    ] as const;

    const layout = packLayout(
      items,
      items.map(({ id }) => id),
      2,
    );

    expect(layout.placements).toMatchObject([
      { id: "files", column: 0, row: 0 },
      { id: "date", column: 1, row: 0 },
      { id: "symptoms", column: 0, row: 1, columnSpan: 2, rowSpan: 1 },
      { id: "summary", column: 0, row: 2 },
    ]);
    const targets = buildDropTargets(items, layout.order, "symptoms", 2);
    expect(targets.every(({ placement }) => placement.rowSpan === 1)).toBe(
      true,
    );
  });

  it.each([2, 4])(
    "places a large card directly after a filled small-card row in %i columns",
    (columnCount) => {
      // Arrange
      const mixedWidgets: readonly WidgetDescriptor[] = [
        ...Array.from({ length: columnCount }, (_, index) => ({
          id: `small-${index}`,
          size: "small" as const,
        })),
        { id: "summary", size: "normal" },
      ];

      // Act
      const layout = packLayout(
        mixedWidgets,
        mixedWidgets.map(({ id }) => id),
        columnCount,
      );

      // Assert
      expect(
        layout.placements.find(({ id }) => id === "summary"),
      ).toMatchObject({
        column: 0,
        row: 1,
        columnSpan: 2,
        rowSpan: 2,
      });
    },
  );

  it("packs normal widgets into aligned 2-by-2 footprints and mini widgets into one cell", () => {
    // Arrange
    const order = ["bio-age", "summary", "oura"];

    // Act
    const layout = packLayout(widgets, order, 4);

    // Assert
    expect(layout.placements).toEqual([
      {
        id: "bio-age",
        size: "normal",
        column: 0,
        row: 0,
        columnSpan: 2,
        rowSpan: 2,
      },
      {
        id: "summary",
        size: "normal",
        column: 2,
        row: 0,
        columnSpan: 2,
        rowSpan: 2,
      },
      {
        id: "oura",
        size: "small",
        column: 0,
        row: 2,
        columnSpan: 1,
        rowSpan: 1,
      },
    ]);
    expect(WIDGET_FOOTPRINTS.normal).toEqual({
      columnSpan: 2,
      rowSpan: 2,
      columnAlignment: 2,
      rowAlignment: 1,
    });
  });

  it("repacks the same canonical order for the two-column layout", () => {
    // Arrange
    const order = ["bio-age", "summary", "oura"];

    // Act
    const layout = packLayout(widgets, order, 2);

    // Assert
    expect(
      layout.placements.map(({ id, column, row }) => ({
        id,
        column,
        row,
      })),
    ).toEqual([
      { id: "bio-age", column: 0, row: 0 },
      { id: "summary", column: 0, row: 2 },
      { id: "oura", column: 0, row: 4 },
    ]);
  });

  it("rejects duplicate widget descriptors before packing", () => {
    // Arrange
    const duplicateWidgets = [widgets[0], widgets[0]];

    // Act
    const packDuplicateLayout = () =>
      packLayout(duplicateWidgets, ["bio-age"], 4);

    // Assert
    expect(packDuplicateLayout).toThrow(/duplicate widget id/i);
  });

  it("rejects column counts outside the fixed responsive contract", () => {
    // Arrange
    const packThreeColumns = () => packLayout(widgets, [], 3);
    const packNoColumns = () => packLayout(widgets, [], 0);

    // Act + Assert
    expect(packThreeColumns).toThrow(/two or four columns/i);
    expect(packNoColumns).toThrow(/two or four columns/i);
  });
});

describe("reorderWidgets", () => {
  it("returns a new order without mutating the committed order", () => {
    // Arrange
    const committed = ["bio-age", "summary", "oura"] as const;

    // Act
    const reordered = reorderWidgets(committed, "oura", 0);

    // Assert
    expect(reordered).toEqual(["oura", "bio-age", "summary"]);
    expect(committed).toEqual(["bio-age", "summary", "oura"]);
  });

  it("rejects unknown widgets and insertion indices outside the remaining order", () => {
    // Arrange
    const committed = ["bio-age", "summary"];

    // Act
    const reorderUnknown = () => reorderWidgets(committed, "oura", 0);
    const reorderOutsideOrder = () => reorderWidgets(committed, "summary", 3);

    // Assert
    expect(reorderUnknown).toThrow(/unknown widget id/i);
    expect(reorderOutsideOrder).toThrow(/insertion index/i);
  });
});

describe("buildDropTargets", () => {
  it("offers the adjacent row when reordering a large card after small cards", () => {
    // Arrange
    const mixedWidgets: readonly WidgetDescriptor[] = [
      { id: "files", size: "small" },
      { id: "date", size: "small" },
      { id: "summary", size: "normal" },
    ];

    // Act
    const targets = buildDropTargets(
      mixedWidgets,
      ["files", "date", "summary"],
      "summary",
      2,
    );

    // Assert
    expect(
      targets.map(({ placement }) => [placement.column, placement.row]),
    ).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("deduplicates insertion indices that resolve to the same visible footprint", () => {
    // Arrange
    const order = ["bio-age", "summary", "oura"];

    // Act
    const targets = buildDropTargets(widgets, order, "oura", 4);

    // Assert
    expect(new Set(targets.map((target) => target.key)).size).toBe(
      targets.length,
    );
    expect(
      targets.map(({ placement }) => [placement.column, placement.row]),
    ).toEqual([
      [0, 0],
      [2, 0],
      [0, 2],
    ]);
  });
});

describe("getTailPlacement", () => {
  it("uses the first full row when no widgets are available", () => {
    // Arrange
    const layout = packLayout([], [], 4);

    // Act
    const tail = getTailPlacement(layout);

    // Assert
    expect(tail).toEqual({
      column: 0,
      row: 0,
      columnSpan: 4,
      rowSpan: 1,
    });
  });

  it("fills the contiguous suffix after the final widget row", () => {
    // Arrange
    const layout = packLayout(widgets, ["bio-age", "summary", "oura"], 4);

    // Act
    const tail = getTailPlacement(layout);

    // Assert
    expect(tail).toEqual({
      column: 1,
      row: 2,
      columnSpan: 3,
      rowSpan: 1,
    });
  });

  it("uses a new full row when the last row has no suffix", () => {
    // Arrange
    const fullRowWidgets = [
      { id: "a", size: "small" },
      { id: "b", size: "small" },
      { id: "c", size: "small" },
      { id: "d", size: "small" },
    ] as const satisfies readonly WidgetDescriptor[];
    const layout = packLayout(fullRowWidgets, ["a", "b", "c", "d"], 4);

    // Act
    const tail = getTailPlacement(layout);

    // Assert
    expect(tail).toEqual({
      column: 0,
      row: 1,
      columnSpan: 4,
      rowSpan: 1,
    });
  });
});

describe("reconcileOrder", () => {
  it("filters stale and duplicate ids before appending newly available widgets", () => {
    // Arrange
    const persisted = ["oura", "removed", "oura", "bio-age"];
    const available = ["bio-age", "summary", "oura"];

    // Act
    const reconciled = reconcileOrder(persisted, available);

    // Assert
    expect(reconciled).toEqual(["oura", "bio-age", "summary"]);
  });
});
