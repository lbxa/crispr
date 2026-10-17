"use client";

import { cn } from "cn";
import * as React from "react";

import {
  buildDropTargets,
  getTailPlacement,
  packLayout,
  reconcileOrder,
  type DropTarget,
  type GridPlacement,
  type WidgetId,
  type WidgetSize,
} from "./index";
import { flattenGridChildren, isGridItemElement } from "./react-children";

type DragInput = "keyboard" | "pointer" | "touch";

export type WidgetOrderChangeDetails = Readonly<{
  input: DragInput;
  movedId: WidgetId;
  previousIndex: number;
  nextIndex: number;
}>;

export type WidgetGridRootProps = Omit<
  React.ComponentPropsWithRef<"div">,
  "onChange"
> & {
  order: readonly WidgetId[];
  onOrderChange: (
    order: readonly WidgetId[],
    details: WidgetOrderChangeDetails,
  ) => void;
  /** Container width at which the logical grid changes from two to four columns. */
  wideAt?: number;
  /** Pixel gap between logical cells. */
  gap?: number;
  /** Cancel movement and disable pickup while the grid is unavailable. */
  disabled?: boolean;
};

export type WidgetGridItemProps = React.ComponentPropsWithRef<"div"> & {
  id: WidgetId;
  size: WidgetSize;
  label: string;
};

export type WidgetGridTailProps = React.ComponentPropsWithRef<"div">;

type Point = Readonly<{ x: number; y: number }>;
type DragBounds = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type IdleDrag = Readonly<{ phase: "idle" }>;
type PressingDrag = Readonly<{
  phase: "pressing";
  id: WidgetId;
  label: string;
  input: "pointer" | "touch";
  pointerId: number;
  start: Point;
  element: HTMLDivElement;
}>;
type ActiveDrag = Readonly<{
  phase: "dragging";
  id: WidgetId;
  label: string;
  input: DragInput;
  pointerId: number | null;
  start: Point | null;
  current: Point | null;
  bounds: DragBounds | null;
  targets: readonly DropTarget[];
  activeTargetIndex: number;
}>;
type DragState = IdleDrag | PressingDrag | ActiveDrag;

type GridContextValue = Readonly<{
  disabled: boolean;
  instructionsId: string;
  dragState: DragState;
  placements: ReadonlyMap<WidgetId, GridPlacement>;
  committedPlacements: ReadonlyMap<WidgetId, GridPlacement>;
  tailPlacement: GridPlacement;
  registerItem: (id: WidgetId, element: HTMLDivElement | null) => void;
  onItemPointerDown: (
    id: WidgetId,
    label: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onItemPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onItemPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onItemPointerCancel: () => void;
  onItemKeyDown: (
    id: WidgetId,
    label: string,
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;
}>;

const GridContext = React.createContext<GridContextValue | null>(null);
const CardContainerContext = React.createContext(false);
const idleDrag: IdleDrag = { phase: "idle" };

export function WidgetGridRoot({
  order,
  onOrderChange,
  wideAt = 640,
  gap = 16,
  disabled = false,
  className,
  style,
  children,
  ref,
  onClickCapture,
  ...props
}: WidgetGridRootProps) {
  const flattenedChildren = flattenGridChildren(children);
  const itemElements = flattenedChildren.filter(isGridItemElement);
  const tailElement =
    flattenedChildren.find((child) => !isGridItemElement(child)) ?? null;
  const descriptors = itemElements.map(({ props: itemProps }) => ({
    id: itemProps.id,
    size: itemProps.size,
  }));
  const availableIds = descriptors.map(({ id }) => id);
  const committedOrder = reconcileOrder(order, availableIds);
  const itemsById = new Map(itemElements.map((item) => [item.props.id, item]));
  const [columnCount, setColumnCount] = React.useState(4);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [dragState, setDragState] = React.useState<DragState>(idleDrag);
  const [announcement, setAnnouncement] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef(new Map<WidgetId, HTMLDivElement>());
  const targetRefs = React.useRef(new Map<string, HTMLDivElement>());
  const previousRects = React.useRef(new Map<WidgetId, DOMRect>());
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const suppressClick = React.useRef(false);
  const instructionsId = React.useId();

  if (
    dragState.phase !== "idle" &&
    (disabled || !availableIds.includes(dragState.id))
  ) {
    setDragState(idleDrag);
    setAnnouncement(`${dragState.label} returned to its original position.`);
  }

  const previewOrder =
    dragState.phase === "dragging" && dragState.activeTargetIndex >= 0
      ? dragState.targets[dragState.activeTargetIndex]?.order
      : null;
  const committedLayout = packLayout(descriptors, committedOrder, columnCount);
  const previewLayout = packLayout(
    descriptors,
    previewOrder ?? committedOrder,
    columnCount,
  );
  const committedPlacements = placementsById(committedLayout.placements);
  const previewPlacements = placementsById(previewLayout.placements);
  const displayPlacements = new Map(previewPlacements);
  if (dragState.phase === "dragging" && dragState.input !== "keyboard") {
    const committedPlacement = committedPlacements.get(dragState.id);
    if (committedPlacement) {
      displayPlacements.set(dragState.id, committedPlacement);
    }
  }
  const tail = getTailPlacement(previewLayout);
  const tailPlacement: GridPlacement = {
    id: "__widget-grid-tail__",
    size: "small",
    ...tail,
  };

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function cancelDrag(message?: string) {
    clearLongPressTimer();
    setDragState(idleDrag);
    if (message) setAnnouncement(message);
  }

  function targetsFor(id: WidgetId): readonly DropTarget[] {
    return buildDropTargets(descriptors, committedOrder, id, columnCount);
  }

  function beginPointerDrag(press: PressingDrag, current: Point) {
    const targets = targetsFor(press.id);
    const { left, top, width, height } = press.element.getBoundingClientRect();
    press.element.setPointerCapture?.(press.pointerId);
    suppressClick.current = true;
    setAnnouncement(
      `${press.label} picked up. Move to a highlighted position.`,
    );
    setDragState({
      phase: "dragging",
      id: press.id,
      label: press.label,
      input: press.input,
      pointerId: press.pointerId,
      start: press.start,
      current,
      bounds: { left, top, width, height },
      targets,
      activeTargetIndex: -1,
    });
  }

  function onItemPointerDown(
    id: WidgetId,
    label: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (
      disabled ||
      !event.nativeEvent.composedPath().includes(event.currentTarget) ||
      isInteractiveTarget(event.target) ||
      event.button !== 0
    ) {
      return;
    }
    const input = event.pointerType === "touch" ? "touch" : "pointer";
    const press: PressingDrag = {
      phase: "pressing",
      id,
      label,
      input,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      element: event.currentTarget,
    };
    setDragState(press);

    if (input === "touch") {
      clearLongPressTimer();
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        beginPointerDrag(press, press.start);
      }, 260);
    } else {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  }

  function onItemPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = { x: event.clientX, y: event.clientY };
    if (
      dragState.phase === "pressing" &&
      dragState.pointerId === event.pointerId
    ) {
      const distance = pointDistance(dragState.start, point);
      if (dragState.input === "touch") {
        if (distance > 8) cancelDrag();
      } else if (distance >= 4) {
        beginPointerDrag(dragState, point);
      }
      return;
    }

    if (
      dragState.phase !== "dragging" ||
      dragState.pointerId !== event.pointerId
    ) {
      return;
    }

    const activeTargetIndex = dragState.targets.findIndex((target) => {
      const rectangle = targetRefs.current
        .get(target.key)
        ?.getBoundingClientRect();
      return rectangle ? containsPoint(rectangle, point) : false;
    });
    setDragState({
      ...dragState,
      current: point,
      activeTargetIndex,
    });
  }

  function commitDrag(activeDrag: ActiveDrag) {
    const target = activeDrag.targets[activeDrag.activeTargetIndex];
    if (!target) {
      cancelDrag(`${activeDrag.label} returned to its original position.`);
      return;
    }

    const previousIndex = committedOrder.indexOf(activeDrag.id);
    const nextIndex = target.order.indexOf(activeDrag.id);
    onOrderChange(target.order, {
      input: activeDrag.input,
      movedId: activeDrag.id,
      previousIndex,
      nextIndex,
    });
    clearLongPressTimer();
    setDragState(idleDrag);
    setAnnouncement(
      `${activeDrag.label} moved to position ${nextIndex + 1} of ${target.order.length}.`,
    );
  }

  function onItemPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.phase === "pressing") {
      cancelDrag();
      return;
    }
    if (
      dragState.phase === "dragging" &&
      dragState.pointerId === event.pointerId
    ) {
      commitDrag(dragState);
    }
  }

  function onItemKeyDown(
    id: WidgetId,
    label: string,
    event: React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (disabled || event.target !== event.currentTarget) return;

    if (
      dragState.phase === "idle" &&
      (event.key === " " || event.key === "Enter")
    ) {
      event.preventDefault();
      const targets = targetsFor(id);
      const currentPlacement = committedPlacements.get(id);
      const currentTargetIndex = currentPlacement
        ? targets.findIndex(
            ({ placement }) =>
              placement.column === currentPlacement.column &&
              placement.row === currentPlacement.row,
          )
        : 0;
      setDragState({
        phase: "dragging",
        id,
        label,
        input: "keyboard",
        pointerId: null,
        start: null,
        current: null,
        bounds: null,
        targets,
        activeTargetIndex: Math.max(0, currentTargetIndex),
      });
      setAnnouncement(
        `${label} picked up. Use arrow keys to choose a position.`,
      );
      return;
    }

    if (
      dragState.phase !== "dragging" ||
      dragState.input !== "keyboard" ||
      dragState.id !== id
    ) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelDrag(`${label} returned to its original position.`);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitDrag(dragState);
      return;
    }
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const targetCount = dragState.targets.length;
    const activeTargetIndex =
      (dragState.activeTargetIndex + direction + targetCount) % targetCount;
    const target = dragState.targets[activeTargetIndex];
    setDragState({ ...dragState, activeTargetIndex });
    if (target) {
      const position = target.order.indexOf(id) + 1;
      setAnnouncement(
        `${label}, position ${position} of ${target.order.length}.`,
      );
    }
  }

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function measure(width: number) {
      if (width <= 0) return;
      setContainerWidth(width);
      const nextColumnCount = width >= wideAt ? 4 : 2;
      setColumnCount((currentColumnCount) => {
        if (currentColumnCount !== nextColumnCount) {
          if (longPressTimer.current !== null) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
          setDragState(idleDrag);
        }
        return nextColumnCount;
      });
    }

    measure(root.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [wideAt]);

  const activeDragId = dragState.phase === "idle" ? null : dragState.id;
  const activeDragLabel = dragState.phase === "idle" ? null : dragState.label;
  React.useLayoutEffect(() => {
    if (activeDragId === null && longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, [activeDragId]);

  const placementSignature = previewLayout.placements
    .map(({ id, column, row }) => `${id}:${column}:${row}`)
    .join("|");
  const animatedDragId = dragState.phase === "dragging" ? dragState.id : null;
  React.useLayoutEffect(() => {
    const nextRects = new Map<WidgetId, DOMRect>();
    for (const [id, element] of itemRefs.current) {
      const rectangle = element.getBoundingClientRect();
      nextRects.set(id, rectangle);
      const previous = previousRects.current.get(id);
      if (
        !previous ||
        id === animatedDragId ||
        prefersReducedMotion() ||
        typeof element.animate !== "function"
      ) {
        continue;
      }
      const x = previous.left - rectangle.left;
      const y = previous.top - rectangle.top;
      if (x === 0 && y === 0) continue;
      element.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
    previousRects.current = nextRects;
  }, [placementSignature, animatedDragId]);

  React.useEffect(() => {
    if (!activeDragLabel) return;
    function cancelExternalDrag() {
      if (longPressTimer.current !== null) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setDragState(idleDrag);
      setAnnouncement(`${activeDragLabel} returned to its original position.`);
    }
    function cancelOnBlur() {
      cancelExternalDrag();
    }
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      cancelExternalDrag();
    }
    window.addEventListener("blur", cancelOnBlur);
    // Consume cancellation before an enclosing pane/dialog handles dismissal.
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => {
      window.removeEventListener("blur", cancelOnBlur);
      window.removeEventListener("keydown", cancelOnEscape, true);
    };
  }, [activeDragLabel]);

  React.useEffect(
    () => () => {
      if (longPressTimer.current !== null) {
        clearTimeout(longPressTimer.current);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (
      dragState.phase !== "dragging" ||
      dragState.input === "keyboard" ||
      !dragState.current
    ) {
      return;
    }
    let frame = 0;
    function scrollNearViewportEdge() {
      const point = dragState.phase === "dragging" ? dragState.current : null;
      if (!point) return;
      const edge = 72;
      const distanceFromBottom = window.innerHeight - point.y;
      const delta =
        point.y < edge
          ? -Math.ceil((edge - point.y) / 6)
          : distanceFromBottom < edge
            ? Math.ceil((edge - distanceFromBottom) / 6)
            : 0;
      if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
      frame = requestAnimationFrame(scrollNearViewportEdge);
    }
    frame = requestAnimationFrame(scrollNearViewportEdge);
    return () => cancelAnimationFrame(frame);
  }, [dragState]);

  const cellSize =
    containerWidth > 0
      ? Math.max(0, (containerWidth - gap * (columnCount - 1)) / columnCount)
      : null;
  const gridStyle = {
    ...style,
    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    gridAutoRows: "minmax(var(--widget-grid-cell-size, 9rem), auto)",
    columnGap: "var(--widget-grid-gap)",
    rowGap: "var(--widget-grid-gap)",
    "--widget-grid-gap": `${gap}px`,
    ...(cellSize === null
      ? {}
      : { "--widget-grid-cell-size": `${cellSize}px` }),
  } as React.CSSProperties;

  function setRootRef(element: HTMLDivElement | null) {
    rootRef.current = element;
    assignRef(ref, element);
  }

  const context: GridContextValue = {
    disabled,
    instructionsId,
    dragState,
    placements: displayPlacements,
    committedPlacements,
    tailPlacement,
    registerItem(id, element) {
      if (element) itemRefs.current.set(id, element);
      else itemRefs.current.delete(id);
    },
    onItemPointerDown,
    onItemPointerMove,
    onItemPointerUp,
    onItemPointerCancel: () => cancelDrag(),
    onItemKeyDown,
  };

  return (
    <GridContext.Provider value={context}>
      <div
        ref={setRootRef}
        {...props}
        data-slot="widget-grid"
        data-column-count={columnCount}
        data-dragging={dragState.phase === "dragging" ? "true" : "false"}
        className={cn("relative isolate grid min-w-0 items-stretch", className)}
        style={gridStyle}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClickCapture?.(event);
        }}
      >
        {committedOrder.map((id) => {
          const item = itemsById.get(id);
          return item ? React.cloneElement(item, { key: id }) : null;
        })}
        {dragState.phase === "dragging"
          ? dragState.targets.map((target, index) => (
              <div
                key={target.key}
                ref={(element) => {
                  if (element) targetRefs.current.set(target.key, element);
                  else targetRefs.current.delete(target.key);
                }}
                aria-hidden="true"
                data-slot="widget-grid-drop-target"
                data-active={
                  dragState.activeTargetIndex === index ? "true" : "false"
                }
                className="pointer-events-none z-0 m-1 rounded-xl bg-primary/5 opacity-70 ring-1 ring-primary/10 transition-[background-color,opacity,transform] duration-200 data-[active=true]:scale-[1.012] data-[active=true]:bg-primary/10 data-[active=true]:opacity-100 data-[active=true]:ring-primary/30 motion-reduce:transform-none motion-reduce:transition-none"
                style={placementStyle(target.placement)}
              />
            ))
          : null}
        {tailElement}
        <p id={instructionsId} className="sr-only">
          Press Space or Enter to pick up this widget, arrow keys to move, Enter
          to place, and Escape to cancel.
        </p>
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    </GridContext.Provider>
  );
}

export function WidgetGridItem({
  id,
  size,
  label,
  className,
  style,
  children,
  ref,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onTouchMove,
  onContextMenu,
  "aria-describedby": describedBy,
  ...props
}: WidgetGridItemProps) {
  const context = useGridContext("WidgetGrid.Item");
  const placement = context.placements.get(id);
  const active =
    context.dragState.phase === "dragging" && context.dragState.id === id;
  const pressing =
    context.dragState.phase === "pressing" && context.dragState.id === id;
  const floatingBounds =
    active && context.dragState.input !== "keyboard"
      ? context.dragState.bounds
      : null;
  const floating = floatingBounds !== null;
  const itemRef = React.useRef<HTMLDivElement | null>(null);
  const pointerTransform =
    active &&
    context.dragState.input !== "keyboard" &&
    context.dragState.start &&
    context.dragState.current
      ? `translate3d(${context.dragState.current.x - context.dragState.start.x}px, ${context.dragState.current.y - context.dragState.start.y}px, 0) scale(1.025)`
      : undefined;

  function setItemRef(element: HTMLDivElement | null) {
    itemRef.current = element;
    context.registerItem(id, element);
    assignRef(ref, element);
  }

  React.useLayoutEffect(() => {
    const element = itemRef.current;
    if (!floating || !element) return;
    // The top layer escapes scroll/transform clipping without remounting content
    // or moving its DOM node away from pointer capture and inherited styles.
    element.showPopover();
    return () => {
      if (element.hasAttribute("popover")) element.hidePopover();
    };
  }, [floating]);

  return (
    <CardContainerContext.Provider value>
      {floatingBounds ? (
        <div
          aria-hidden="true"
          data-slot="widget-grid-placeholder"
          style={{
            ...placementStyle(placement),
            height: floatingBounds.height,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div
        ref={setItemRef}
        {...props}
        role="group"
        aria-label={label}
        aria-roledescription="draggable widget"
        aria-describedby={[describedBy, context.instructionsId]
          .filter(Boolean)
          .join(" ")}
        aria-disabled={context.disabled || undefined}
        tabIndex={context.disabled ? -1 : 0}
        data-slot="widget-grid-item"
        data-widget-id={id}
        data-size={size}
        data-drag-state={active ? "dragging" : pressing ? "pressing" : "idle"}
        popover={floating ? "manual" : undefined}
        className={cn(
          "@container/widget-card relative z-10 flex min-h-0 min-w-0 flex-col outline-none transition-[filter,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
          size === "normal"
            ? "rounded-xl [--widget-corner-radius:var(--radius-xl)]"
            : "rounded-lg [--widget-corner-radius:var(--radius-lg)]",
          active && "z-30 cursor-grabbing select-none drop-shadow-xl",
          !active && !context.disabled && "cursor-grab",
          className,
        )}
        style={{
          ...placementStyle(placement),
          ...style,
          transform: pointerTransform ?? style?.transform,
          minHeight:
            size === "normal"
              ? "calc(var(--widget-grid-cell-size, 9rem) * 2 + var(--widget-grid-gap, 1rem))"
              : "var(--widget-grid-cell-size, 9rem)",
          height:
            size === "small"
              ? "var(--widget-grid-cell-size, 9rem)"
              : style?.height,
          ...(floatingBounds
            ? {
                position: "fixed",
                inset: "auto",
                left: floatingBounds.left,
                top: floatingBounds.top,
                width: floatingBounds.width,
                height: floatingBounds.height,
                minHeight: floatingBounds.height,
                margin: 0,
                border: 0,
                background: "transparent",
                color: "inherit",
                overflow: "visible",
              }
            : {}),
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (!event.defaultPrevented)
            context.onItemPointerDown(id, label, event);
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (!event.defaultPrevented) context.onItemPointerMove(event);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          if (!event.defaultPrevented) context.onItemPointerUp(event);
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          if (!event.defaultPrevented) context.onItemPointerCancel();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) context.onItemKeyDown(id, label, event);
        }}
        onTouchMove={(event) => {
          onTouchMove?.(event);
          if (active && context.dragState.input === "touch")
            event.preventDefault();
        }}
        onContextMenu={(event) => {
          onContextMenu?.(event);
          if (pressing || active) event.preventDefault();
        }}
      >
        {children}
      </div>
    </CardContainerContext.Provider>
  );
}

export function WidgetGridTail({
  className,
  style,
  ref,
  ...props
}: WidgetGridTailProps) {
  const context = useGridContext("WidgetGrid.Tail");
  return (
    <div
      ref={ref}
      {...props}
      data-slot="widget-grid-tail"
      className={cn("relative z-10 min-h-0 min-w-0", className)}
      style={{
        ...placementStyle(context.tailPlacement),
        ...style,
        minHeight: "var(--widget-grid-cell-size, 9rem)",
        height: "var(--widget-grid-cell-size, 9rem)",
      }}
    />
  );
}

export type WidgetCardRootProps = React.ComponentPropsWithRef<"div">;
export type WidgetCardHeaderProps = React.ComponentPropsWithRef<"div">;
export type WidgetCardBodyProps = React.ComponentPropsWithRef<"div"> & {
  layout?: "flow" | "split";
};
export type WidgetCardCustomBodyProps = React.ComponentPropsWithRef<"div">;
export type WidgetCardEyebrowProps = React.ComponentPropsWithRef<"p">;
export type WidgetCardTitleProps = React.ComponentPropsWithRef<"h3">;
export type WidgetCardDescriptionProps = React.ComponentPropsWithRef<"p">;
export type WidgetCardFooterProps = React.ComponentPropsWithRef<"div">;
export type WidgetCardPreviewProps = React.ComponentPropsWithRef<"div"> & {
  size: WidgetSize;
};

export function WidgetCardRoot({
  className,
  style,
  ...props
}: WidgetCardRootProps) {
  const contained = React.useContext(CardContainerContext);
  if (!contained) {
    throw new Error(
      "WidgetCard.Root must be rendered inside a WidgetGrid.Item or WidgetCard.Preview container.",
    );
  }
  return (
    <div
      {...props}
      data-slot="widget-card-root"
      className={cn(
        "relative isolate flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[var(--widget-corner-radius,var(--radius-xl))] bg-card p-[var(--widget-card-padding)] text-card-foreground [&_canvas]:max-w-full [&_img]:max-w-full [&_svg]:max-w-full",
        className,
      )}
      style={
        {
          "--widget-card-chart-base": "min(100%, calc(100cqw - 7.5rem))",
          "--widget-card-chart-compact": "min(100%, calc(100cqw - 3.5rem))",
          "--widget-card-chart-spacious": "min(19rem, 100%)",
          "--widget-card-gap-base": "clamp(0.875rem, 4cqw, 1.5rem)",
          "--widget-card-icon-base": "clamp(3rem, 20cqw, 4rem)",
          "--widget-card-padding-base": "clamp(1.25rem, 6cqw, 2.25rem)",
          "--widget-card-title-base": "clamp(1.125rem, 7cqw, 1.75rem)",
          ...style,
        } as React.CSSProperties
      }
    />
  );
}

export function WidgetCardHeader({
  className,
  ...props
}: WidgetCardHeaderProps) {
  return (
    <div
      {...props}
      data-slot="widget-card-header"
      className={cn(
        "flex min-w-0 shrink-0 items-start justify-between gap-[var(--widget-card-gap)]",
        className,
      )}
    />
  );
}

export function WidgetCardBody({
  layout = "flow",
  className,
  ...props
}: WidgetCardBodyProps) {
  return (
    <div
      {...props}
      data-slot="widget-card-body"
      data-layout={layout}
      className={cn(
        "min-h-0 min-w-0 flex-1 gap-[var(--widget-card-gap)]",
        layout === "flow" && "flex flex-col",
        layout === "split" &&
          "grid grid-cols-1 @min-[24rem]/widget-card:grid-cols-2",
        className,
      )}
    />
  );
}

export function WidgetCardCustomBody({
  className,
  ...props
}: WidgetCardCustomBodyProps) {
  return (
    <div
      {...props}
      data-slot="widget-card-custom-body"
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-hidden [&>*]:max-w-full",
        className,
      )}
    />
  );
}

export function WidgetCardEyebrow({
  className,
  ...props
}: WidgetCardEyebrowProps) {
  return (
    <p
      {...props}
      data-slot="widget-card-eyebrow"
      className={cn(
        "min-w-0 text-[clamp(0.5625rem,3cqw,0.75rem)] font-semibold uppercase tracking-[0.14em] opacity-65",
        className,
      )}
    />
  );
}

export function WidgetCardTitle({ className, ...props }: WidgetCardTitleProps) {
  return (
    <h3
      {...props}
      data-slot="widget-card-title"
      className={cn(
        "min-w-0 overflow-hidden text-pretty font-semibold leading-[1.05] text-[length:var(--widget-card-title-size)] tracking-[-0.03em] [overflow-wrap:anywhere] @max-[12rem]/widget-card:line-clamp-2",
        className,
      )}
    />
  );
}

export function WidgetCardDescription({
  className,
  ...props
}: WidgetCardDescriptionProps) {
  return (
    <p
      {...props}
      data-slot="widget-card-description"
      className={cn(
        "line-clamp-2 min-w-0 text-[clamp(0.7rem,3.5cqw,0.875rem)] leading-snug opacity-72 [overflow-wrap:anywhere] @max-[12rem]/widget-card:hidden",
        className,
      )}
    />
  );
}

export function WidgetCardFooter({
  className,
  ...props
}: WidgetCardFooterProps) {
  return (
    <div
      {...props}
      data-slot="widget-card-footer"
      className={cn(
        "mt-auto min-w-0 shrink-0 pt-[var(--widget-card-gap)] [&_a]:max-w-full [&_button]:max-w-full [&_[data-slot=button]]:min-h-[var(--widget-card-action-min)]",
        className,
      )}
    />
  );
}

export function WidgetCardPreview({
  size,
  className,
  ...props
}: WidgetCardPreviewProps) {
  return (
    <CardContainerContext.Provider value>
      <div
        {...props}
        data-slot="widget-card-preview"
        data-size={size}
        className={cn(
          "@container/widget-card min-h-0 min-w-0 overflow-hidden",
          size === "normal"
            ? "aspect-square rounded-xl [--widget-corner-radius:var(--radius-xl)]"
            : "aspect-square rounded-lg [--widget-corner-radius:var(--radius-lg)]",
          className,
        )}
      />
    </CardContainerContext.Provider>
  );
}

export const WidgetGrid = {
  Root: WidgetGridRoot,
  Item: WidgetGridItem,
  Tail: WidgetGridTail,
};

export const WidgetCard = {
  Root: WidgetCardRoot,
  Header: WidgetCardHeader,
  Body: WidgetCardBody,
  CustomBody: WidgetCardCustomBody,
  Eyebrow: WidgetCardEyebrow,
  Title: WidgetCardTitle,
  Description: WidgetCardDescription,
  Footer: WidgetCardFooter,
  Preview: WidgetCardPreview,
};

function useGridContext(component: string): GridContextValue {
  const context = React.useContext(GridContext);
  if (!context) {
    throw new Error(`${component} must be rendered inside WidgetGrid.Root.`);
  }
  return context;
}

function placementsById(
  placements: readonly GridPlacement[],
): ReadonlyMap<WidgetId, GridPlacement> {
  return new Map(placements.map((placement) => [placement.id, placement]));
}

function placementStyle(
  placement:
    | Pick<GridPlacement, "column" | "row" | "columnSpan" | "rowSpan">
    | null
    | undefined,
): React.CSSProperties {
  if (!placement) return {};
  return {
    gridColumn: `${placement.column + 1} / span ${placement.columnSpan}`,
    gridRow: `${placement.row + 1} / span ${placement.rowSpan}`,
  };
}

function pointDistance(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function containsPoint(rectangle: DOMRect, point: Point): boolean {
  return (
    point.x >= rectangle.left &&
    point.x <= rectangle.right &&
    point.y >= rectangle.top &&
    point.y <= rectangle.bottom
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'a,button,input,select,textarea,[role="button"],[role="link"],[contenteditable="true"],[data-no-widget-drag]',
    ) !== null
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}
