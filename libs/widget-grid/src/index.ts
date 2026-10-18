export type WidgetId = string;

export type WidgetSize = "normal" | "small" | "wide";

export type WidgetDescriptor = Readonly<{
  id: WidgetId;
  size: WidgetSize;
}>;

export type WidgetFootprint = Readonly<{
  columnSpan: number;
  rowSpan: number;
  columnAlignment: number;
  rowAlignment: number;
}>;

export type GridPlacement = Readonly<{
  id: WidgetId;
  size: WidgetSize;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}>;

export type PackedLayout = Readonly<{
  columnCount: number;
  rowCount: number;
  order: readonly WidgetId[];
  placements: readonly GridPlacement[];
}>;

export type DropTarget = Readonly<{
  key: string;
  insertionIndex: number;
  order: readonly WidgetId[];
  placement: GridPlacement;
}>;

export type TailPlacement = Readonly<{
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: 1;
}>;

export const WIDGET_FOOTPRINTS = {
  normal: {
    columnSpan: 2,
    rowSpan: 2,
    columnAlignment: 2,
    rowAlignment: 1,
  },
  small: {
    columnSpan: 1,
    rowSpan: 1,
    columnAlignment: 1,
    rowAlignment: 1,
  },
  wide: {
    columnSpan: 2,
    rowSpan: 1,
    columnAlignment: 2,
    rowAlignment: 1,
  },
} as const satisfies Readonly<Record<WidgetSize, WidgetFootprint>>;

export function reconcileOrder(
  preferredOrder: readonly WidgetId[],
  availableIds: readonly WidgetId[],
): WidgetId[] {
  const available = new Set(availableIds);
  const seen = new Set<WidgetId>();
  const reconciled: WidgetId[] = [];

  for (const id of preferredOrder) {
    if (!available.has(id) || seen.has(id)) continue;
    seen.add(id);
    reconciled.push(id);
  }

  for (const id of availableIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    reconciled.push(id);
  }

  return reconciled;
}

export function reorderWidgets(
  committedOrder: readonly WidgetId[],
  draggedId: WidgetId,
  insertionIndex: number,
): WidgetId[] {
  if (!committedOrder.includes(draggedId)) {
    throw new Error(`Cannot reorder unknown widget id "${draggedId}".`);
  }

  const remaining = committedOrder.filter((id) => id !== draggedId);
  if (
    !Number.isInteger(insertionIndex) ||
    insertionIndex < 0 ||
    insertionIndex > remaining.length
  ) {
    throw new Error(`Invalid widget insertion index ${insertionIndex}.`);
  }

  return [
    ...remaining.slice(0, insertionIndex),
    draggedId,
    ...remaining.slice(insertionIndex),
  ];
}

export function packLayout(
  widgets: readonly WidgetDescriptor[],
  preferredOrder: readonly WidgetId[],
  columnCount: number,
): PackedLayout {
  assertValidColumnCount(columnCount);
  const widgetById = indexWidgets(widgets);
  const order = reconcileOrder(
    preferredOrder,
    widgets.map(({ id }) => id),
  );
  const occupied = new Set<string>();
  const placements: GridPlacement[] = [];

  for (const id of order) {
    const widget = widgetById.get(id);
    if (!widget) continue;
    const footprint = WIDGET_FOOTPRINTS[widget.size];
    if (footprint.columnSpan > columnCount) {
      throw new Error(
        `Widget "${id}" cannot fit inside a ${columnCount}-column grid.`,
      );
    }

    const position = findFirstAvailablePosition(
      occupied,
      footprint,
      columnCount,
    );
    occupy(occupied, position.column, position.row, footprint);
    placements.push({
      id,
      size: widget.size,
      column: position.column,
      row: position.row,
      columnSpan: footprint.columnSpan,
      rowSpan: footprint.rowSpan,
    });
  }

  const rowCount = placements.reduce(
    (maximum, placement) =>
      Math.max(maximum, placement.row + placement.rowSpan),
    0,
  );

  return {
    columnCount,
    rowCount,
    order,
    placements,
  };
}

export function buildDropTargets(
  widgets: readonly WidgetDescriptor[],
  committedOrder: readonly WidgetId[],
  draggedId: WidgetId,
  columnCount: number,
): DropTarget[] {
  const availableIds = widgets.map(({ id }) => id);
  const order = reconcileOrder(committedOrder, availableIds);
  if (!order.includes(draggedId)) {
    throw new Error(
      `Cannot build targets for unknown widget id "${draggedId}".`,
    );
  }

  const remainingCount = order.length - 1;
  const targets: DropTarget[] = [];
  const seenPlacements = new Set<string>();

  for (
    let insertionIndex = 0;
    insertionIndex <= remainingCount;
    insertionIndex += 1
  ) {
    const nextOrder = reorderWidgets(order, draggedId, insertionIndex);
    const layout = packLayout(widgets, nextOrder, columnCount);
    const placement = layout.placements.find(({ id }) => id === draggedId);
    if (!placement) continue;
    const key = placementKey(placement);
    if (seenPlacements.has(key)) continue;
    seenPlacements.add(key);
    targets.push({ key, insertionIndex, order: nextOrder, placement });
  }

  return targets;
}

export function getTailPlacement(layout: PackedLayout): TailPlacement {
  if (layout.placements.length === 0) {
    return {
      column: 0,
      row: 0,
      columnSpan: layout.columnCount,
      rowSpan: 1,
    };
  }

  const finalRow = Math.max(
    ...layout.placements.map(
      (placement) => placement.row + placement.rowSpan - 1,
    ),
  );
  const occupiedColumns = new Set<number>();
  for (const placement of layout.placements) {
    const coversFinalRow =
      placement.row <= finalRow && placement.row + placement.rowSpan > finalRow;
    if (!coversFinalRow) continue;
    for (
      let column = placement.column;
      column < placement.column + placement.columnSpan;
      column += 1
    ) {
      occupiedColumns.add(column);
    }
  }

  const lastOccupiedColumn = Math.max(...occupiedColumns);
  if (lastOccupiedColumn < layout.columnCount - 1) {
    const column = lastOccupiedColumn + 1;
    return {
      column,
      row: finalRow,
      columnSpan: layout.columnCount - column,
      rowSpan: 1,
    };
  }

  return {
    column: 0,
    row: finalRow + 1,
    columnSpan: layout.columnCount,
    rowSpan: 1,
  };
}

function assertValidColumnCount(columnCount: number): void {
  if (columnCount !== 2 && columnCount !== 4) {
    throw new Error(`Widget grids support exactly two or four columns.`);
  }
}

function indexWidgets(
  widgets: readonly WidgetDescriptor[],
): ReadonlyMap<WidgetId, WidgetDescriptor> {
  const widgetById = new Map<WidgetId, WidgetDescriptor>();
  for (const widget of widgets) {
    if (widgetById.has(widget.id)) {
      throw new Error(`Duplicate widget id "${widget.id}".`);
    }
    widgetById.set(widget.id, widget);
  }
  return widgetById;
}

function findFirstAvailablePosition(
  occupied: ReadonlySet<string>,
  footprint: WidgetFootprint,
  columnCount: number,
): { column: number; row: number } {
  for (let row = 0; ; row += footprint.rowAlignment) {
    for (
      let column = 0;
      column + footprint.columnSpan <= columnCount;
      column += footprint.columnAlignment
    ) {
      if (fits(occupied, column, row, footprint)) return { column, row };
    }
  }
}

function fits(
  occupied: ReadonlySet<string>,
  column: number,
  row: number,
  footprint: WidgetFootprint,
): boolean {
  for (let rowOffset = 0; rowOffset < footprint.rowSpan; rowOffset += 1) {
    for (
      let columnOffset = 0;
      columnOffset < footprint.columnSpan;
      columnOffset += 1
    ) {
      if (occupied.has(cellKey(column + columnOffset, row + rowOffset))) {
        return false;
      }
    }
  }
  return true;
}

function occupy(
  occupied: Set<string>,
  column: number,
  row: number,
  footprint: WidgetFootprint,
): void {
  for (let rowOffset = 0; rowOffset < footprint.rowSpan; rowOffset += 1) {
    for (
      let columnOffset = 0;
      columnOffset < footprint.columnSpan;
      columnOffset += 1
    ) {
      occupied.add(cellKey(column + columnOffset, row + rowOffset));
    }
  }
}

function cellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

function placementKey(placement: GridPlacement): string {
  return `${placement.column}:${placement.row}:${placement.columnSpan}:${placement.rowSpan}`;
}
