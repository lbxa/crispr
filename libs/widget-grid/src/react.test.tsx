import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";

import { WidgetCard, WidgetGrid } from "./react";

describe("WidgetCard", () => {
  it("previews a wide card with a rectangular aspect ratio", () => {
    render(<WidgetCard.Preview size="wide" aria-label="Symptoms preview" />);

    expect(screen.getByLabelText("Symptoms preview")).toHaveClass(
      "aspect-[2/1]",
    );
  });

  it("requires a widget item or preview container", () => {
    // Arrange
    const renderWithoutContainer = () =>
      render(<WidgetCard.Root>Uncontained</WidgetCard.Root>);

    // Act + Assert
    expect(renderWithoutContainer).toThrow(/widgetcard\.root.*container/i);
  });

  it("provides responsive compound slots inside a preview container", () => {
    // Arrange
    render(
      <WidgetCard.Preview size="small" aria-label="Oura preview">
        <WidgetCard.Root className="custom-surface">
          <WidgetCard.Header>Header</WidgetCard.Header>
          <WidgetCard.Body layout="split">
            <WidgetCard.Eyebrow>Wearable</WidgetCard.Eyebrow>
            <WidgetCard.Title>A very long Oura Ring title</WidgetCard.Title>
            <WidgetCard.Description>Optional detail</WidgetCard.Description>
          </WidgetCard.Body>
          <WidgetCard.Footer>Action</WidgetCard.Footer>
        </WidgetCard.Root>
      </WidgetCard.Preview>,
    );

    // Act
    const preview = screen.getByLabelText("Oura preview");
    const surface = screen.getByText("Header").parentElement;
    const body = screen.getByText("Wearable").parentElement;
    const description = screen.getByText("Optional detail");
    const footer = screen.getByText("Action");

    // Assert
    expect(preview).toHaveAttribute("data-slot", "widget-card-preview");
    expect(preview).toHaveAttribute("data-size", "small");
    expect(preview).toHaveClass("@container/widget-card", "aspect-square");
    expect(surface).toHaveAttribute("data-slot", "widget-card-root");
    expect(surface).toHaveClass(
      "custom-surface",
      "bg-card",
      "text-card-foreground",
      "flex",
      "h-full",
      "min-w-0",
      "flex-col",
      "overflow-hidden",
      "p-[var(--widget-card-padding)]",
    );
    expect(surface?.style.getPropertyValue("--widget-card-padding-base")).toBe(
      "clamp(1.25rem, 6cqw, 2.25rem)",
    );
    expect(surface?.style.getPropertyValue("--widget-card-gap-base")).toBe(
      "clamp(0.875rem, 4cqw, 1.5rem)",
    );
    expect(body).toHaveAttribute("data-layout", "split");
    expect(body).toHaveClass(
      "grid",
      "min-h-0",
      "min-w-0",
      "flex-1",
      "@min-[24rem]/widget-card:grid-cols-2",
    );
    expect(description).toHaveClass(
      "@max-[12rem]/widget-card:hidden",
      "line-clamp-2",
    );
    expect(footer).toHaveClass("mt-auto", "shrink-0");
  });

  it("forwards native props and refs across the custom-body contract", () => {
    // Arrange
    const rootRef = React.createRef<HTMLDivElement>();
    const bodyRef = React.createRef<HTMLDivElement>();

    // Act
    render(
      <WidgetCard.Preview size="normal">
        <WidgetCard.Root ref={rootRef} aria-label="Metric card">
          <WidgetCard.CustomBody ref={bodyRef} data-testid="custom-body">
            <svg aria-label="Metric chart" />
          </WidgetCard.CustomBody>
        </WidgetCard.Root>
      </WidgetCard.Preview>,
    );

    // Assert
    expect(rootRef.current).toBe(screen.getByLabelText("Metric card"));
    expect(bodyRef.current).toBe(screen.getByTestId("custom-body"));
    expect(bodyRef.current).toHaveClass(
      "min-h-0",
      "min-w-0",
      "flex-1",
      "overflow-hidden",
    );
  });

  it("keeps primitive slot markers stable when native data props are forwarded", () => {
    // Arrange + Act
    render(
      <WidgetCard.Preview size="normal" data-slot="caller-preview">
        <WidgetCard.Root data-slot="caller-root">
          <WidgetCard.Body data-slot="caller-body">Metric</WidgetCard.Body>
        </WidgetCard.Root>
      </WidgetCard.Preview>,
    );

    // Assert
    expect(screen.getByText("Metric")).toHaveAttribute(
      "data-slot",
      "widget-card-body",
    );
    expect(screen.getByText("Metric").parentElement).toHaveAttribute(
      "data-slot",
      "widget-card-root",
    );
    expect(
      screen.getByText("Metric").parentElement?.parentElement,
    ).toHaveAttribute("data-slot", "widget-card-preview");
  });
});

describe("WidgetGrid", () => {
  it("lifts the live widget at viewport coordinates while preserving its footprint and state", () => {
    const mounted = vi.fn();
    function Content() {
      React.useEffect(mounted, []);
      return <input aria-label="Widget note" defaultValue="Original" />;
    }
    render(
      <WidgetGrid.Root order={["a"]} onOrderChange={() => {}}>
        <WidgetGrid.Item id="a" size="normal" label="Widget A">
          <Content />
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const widget = screen.getByRole("group", { name: "Widget A" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep this" } });
    widget.getBoundingClientRect = () => rect(32, -40, 320, 400);
    const show = vi.spyOn(widget, "showPopover");
    fireEvent.pointerDown(widget, {
      pointerId: 1,
      button: 0,
      clientX: 50,
      clientY: 80,
    });

    fireEvent.pointerMove(widget, {
      pointerId: 1,
      clientX: 650,
      clientY: 300,
    });

    expect(show).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { hidden: true })).toBe(input);
    expect(input).toHaveValue("Keep this");
    expect(mounted).toHaveBeenCalledOnce();
    expect(widget).toHaveAttribute("popover", "manual");
    expect(widget).toHaveStyle({
      position: "fixed",
      left: "32px",
      top: "-40px",
      width: "320px",
      height: "400px",
      transform: "translate3d(600px, 220px, 0) scale(1.025)",
    });
    expect(
      document.querySelector('[data-slot="widget-grid-placeholder"]'),
    ).toHaveStyle({
      gridColumn: "1 / span 2",
      gridRow: "1 / span 2",
      height: "400px",
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(widget).not.toHaveAttribute("popover");
    expect(widget.style.position).toBe("");
    expect(
      document.querySelector('[data-slot="widget-grid-placeholder"]'),
    ).toBeNull();
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("Keep this");
    expect(mounted).toHaveBeenCalledOnce();
  });

  it.each(["drop", "cancel", "blur", "disable", "remove"])(
    "restores the grid after a floating drag ends through %s",
    (ending) => {
      const view = (disabled = false, present = true) => (
        <WidgetGrid.Root
          disabled={disabled}
          order={present ? ["a"] : []}
          onOrderChange={() => {}}
        >
          {present && <WidgetGrid.Item id="a" size="small" label="Widget A" />}
        </WidgetGrid.Root>
      );
      const { rerender, unmount } = render(view());
      const widget = screen.getByRole("group", { name: "Widget A" });
      fireEvent.pointerDown(widget, { pointerId: 1, button: 0, clientX: 10 });
      fireEvent.pointerMove(widget, { pointerId: 1, clientX: 30 });
      expect(widget).toHaveAttribute("popover", "manual");

      if (ending === "drop") fireEvent.pointerUp(widget, { pointerId: 1 });
      else if (ending === "cancel") fireEvent.pointerCancel(widget);
      else if (ending === "blur") fireEvent.blur(window);
      else rerender(view(ending === "disable", ending !== "remove"));

      expect(document.querySelector("[popover]")).toBeNull();
      expect(
        document.querySelector('[data-slot="widget-grid-placeholder"]'),
      ).toBeNull();
      unmount();
    },
  );

  it("cancels pickup and prevents another pickup when disabled", () => {
    const view = (disabled: boolean) => (
      <WidgetGrid.Root
        disabled={disabled}
        order={["files"]}
        onOrderChange={() => {}}
      >
        <WidgetGrid.Item id="files" size="normal" label="Files" />
      </WidgetGrid.Root>
    );
    const { rerender } = render(view(false));
    const widget = screen.getByRole("group", { name: "Files" });
    fireEvent.keyDown(widget, { key: " " });
    expect(widget).toHaveAttribute("data-drag-state", "dragging");

    rerender(view(true));
    fireEvent.keyDown(widget, { key: " " });
    fireEvent.pointerDown(widget, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
    });

    expect(widget).toHaveAttribute("data-drag-state", "idle");
    expect(widget).toHaveAttribute("tabindex", "-1");
    expect(widget).toHaveAttribute("aria-disabled", "true");
    rerender(view(false));
    fireEvent.keyDown(widget, { key: " " });
    expect(widget).toHaveAttribute("data-drag-state", "dragging");
  });

  it.each(["button", "opt-out"])(
    "leaves a custom %s control available without starting a widget drag",
    (kind) => {
      render(
        <WidgetGrid.Root order={["files"]} onOrderChange={() => {}}>
          <WidgetGrid.Item id="files" size="normal" label="Files">
            <div
              role={kind === "button" ? "button" : undefined}
              data-no-widget-drag={kind === "opt-out" ? "" : undefined}
            >
              Drop a file
            </div>
          </WidgetGrid.Item>
        </WidgetGrid.Root>,
      );

      fireEvent.pointerDown(screen.getByText("Drop a file"), {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
      });

      expect(screen.getByRole("group", { name: "Files" })).toHaveAttribute(
        "data-drag-state",
        "idle",
      );
    },
  );

  it("cancels dragging before a parent handles Escape", () => {
    const onDismiss = vi.fn();
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) onDismiss();
        }}
      >
        <WidgetGrid.Root order={["files"]} onOrderChange={() => {}}>
          <WidgetGrid.Item id="files" size="normal" label="Files" />
        </WidgetGrid.Root>
      </div>,
    );
    const widget = screen.getByRole("group", { name: "Files" });
    fireEvent.pointerDown(widget, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
    });
    fireEvent.pointerMove(widget, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 20,
    });
    expect(widget).toHaveAttribute("data-drag-state", "dragging");

    fireEvent.keyDown(widget, { key: "Escape" });

    expect(widget).toHaveAttribute("data-drag-state", "idle");
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(widget, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("places fixed-size items and pins the tail after the final widget", () => {
    // Arrange
    render(
      <WidgetGrid.Root
        aria-label="Health widgets"
        order={["bio-age", "summary", "oura"]}
        onOrderChange={() => {}}
      >
        <WidgetGrid.Item id="bio-age" size="normal" label="Biological age">
          <WidgetCard.Root>Age</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="summary" size="normal" label="Result summary">
          <WidgetCard.Root>Summary</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="oura" size="small" label="Oura Ring">
          <WidgetCard.Root>Oura</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Tail>Add widget</WidgetGrid.Tail>
      </WidgetGrid.Root>,
    );

    // Act
    const grid = screen.getByLabelText("Health widgets");
    const age = screen.getByRole("group", { name: "Biological age" });
    const summary = screen.getByRole("group", { name: "Result summary" });
    const oura = screen.getByRole("group", { name: "Oura Ring" });
    const tail = screen.getByText("Add widget");

    // Assert
    expect(grid).toHaveAttribute("data-slot", "widget-grid");
    expect(grid).toHaveAttribute("data-column-count", "4");
    expect(age).toHaveStyle({
      gridColumn: "1 / span 2",
      gridRow: "1 / span 2",
    });
    expect(summary).toHaveStyle({
      gridColumn: "3 / span 2",
      gridRow: "1 / span 2",
    });
    expect(oura).toHaveStyle({
      gridColumn: "1 / span 1",
      gridRow: "3 / span 1",
    });
    expect(oura).toHaveClass("@container/widget-card");
    expect(tail).toHaveAttribute("data-slot", "widget-grid-tail");
    expect(tail).toHaveStyle({
      gridColumn: "2 / span 3",
      gridRow: "3 / span 1",
    });
  });

  it("recognizes declarative items across a server-to-client component boundary", () => {
    // Arrange: RSC serialization preserves props, but not component-object
    // identity. These wrappers reproduce that boundary in the DOM test.
    function BoundaryItem(props: React.ComponentProps<typeof WidgetGrid.Item>) {
      return <WidgetGrid.Item {...props} />;
    }
    function BoundaryTail(props: React.ComponentProps<typeof WidgetGrid.Tail>) {
      return <WidgetGrid.Tail {...props} />;
    }

    // Act
    render(
      <WidgetGrid.Root order={["summary"]} onOrderChange={() => {}}>
        <BoundaryItem id="summary" size="normal" label="Result summary">
          <WidgetCard.Root>Summary</WidgetCard.Root>
        </BoundaryItem>
        <BoundaryTail>Add widget</BoundaryTail>
      </WidgetGrid.Root>,
    );

    // Assert
    expect(screen.getByRole("group", { name: "Result summary" })).toHaveStyle({
      gridColumn: "1 / span 2",
      gridRow: "1 / span 2",
    });
    expect(screen.getByText("Add widget")).toHaveAttribute(
      "data-slot",
      "widget-grid-tail",
    );
  });

  it("keeps the tail at the same fixed cell height as any one-row widget", () => {
    // Arrange
    render(
      <WidgetGrid.Root order={["source"]} onOrderChange={() => {}}>
        <WidgetGrid.Item id="source" size="small" label="Data source">
          <WidgetCard.Root>Source</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Tail>
          <div style={{ minHeight: "30rem" }}>Add widget</div>
        </WidgetGrid.Tail>
      </WidgetGrid.Root>,
    );

    // Act
    const source = screen.getByRole("group", { name: "Data source" });
    const tail = screen.getByText("Add widget").parentElement;

    // Assert
    expect(source).toHaveStyle({
      height: "var(--widget-grid-cell-size, 9rem)",
    });
    expect(tail).toHaveStyle({
      height: "var(--widget-grid-cell-size, 9rem)",
    });
  });

  it("reorders through the keyboard and announces the committed position", () => {
    // Arrange
    const onOrderChange = vi.fn();
    render(
      <WidgetGrid.Root
        order={["bio-age", "summary", "oura"]}
        onOrderChange={onOrderChange}
      >
        <WidgetGrid.Item id="bio-age" size="normal" label="Biological age">
          <WidgetCard.Root>Age</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="summary" size="normal" label="Result summary">
          <WidgetCard.Root>Summary</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="oura" size="small" label="Oura Ring">
          <WidgetCard.Root>Oura</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const oura = screen.getByRole("group", { name: "Oura Ring" });

    // Act
    oura.focus();
    fireEvent.keyDown(oura, { key: " " });
    fireEvent.keyDown(oura, { key: "ArrowLeft" });
    fireEvent.keyDown(oura, { key: "Enter" });

    // Assert
    expect(onOrderChange).toHaveBeenCalledWith(["bio-age", "oura", "summary"], {
      input: "keyboard",
      movedId: "oura",
      previousIndex: 2,
      nextIndex: 1,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Oura Ring moved to position 2 of 3",
    );
  });

  it("does not arm whole-card dragging from an interactive descendant", () => {
    // Arrange
    render(
      <WidgetGrid.Root order={["oura"]} onOrderChange={() => {}}>
        <WidgetGrid.Item id="oura" size="small" label="Oura Ring">
          <WidgetCard.Root>
            <button type="button">View trends</button>
          </WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const button = screen.getByRole("button", { name: "View trends" });
    const oura = screen.getByRole("group", { name: "Oura Ring" });

    // Act
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(oura, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 80,
      clientY: 80,
    });

    // Assert
    expect(oura).toHaveAttribute("data-drag-state", "idle");
    expect(
      document.querySelector('[data-slot="widget-grid-drop-target"]'),
    ).not.toBeInTheDocument();
  });

  it("does not arm dragging from a portalled descendant", () => {
    // Arrange
    render(
      <WidgetGrid.Root order={["messages"]} onOrderChange={() => {}}>
        <WidgetGrid.Item id="messages" size="small" label="Messages">
          <WidgetCard.Root>
            {createPortal(
              <div data-testid="drawer-viewport">Drawer viewport</div>,
              document.body,
            )}
          </WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const viewport = screen.getByTestId("drawer-viewport");
    const messages = screen.getByRole("group", { name: "Messages" });
    const setPointerCapture = vi.fn();
    messages.setPointerCapture = setPointerCapture;

    // Act
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      pointerType: "mouse",
      button: 0,
      clientX: 600,
      clientY: 100,
    });

    // Assert
    expect(messages).toHaveAttribute("data-drag-state", "idle");
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("commits a pointer drop only after entering a measured target", () => {
    // Arrange
    const onOrderChange = vi.fn();
    render(
      <WidgetGrid.Root order={["a", "b"]} onOrderChange={onOrderChange}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>A</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="b" size="small" label="Widget B">
          <WidgetCard.Root>B</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const widgetB = screen.getByRole("group", { name: "Widget B" });

    // Act
    fireEvent.pointerDown(widgetB, {
      pointerId: 7,
      pointerType: "mouse",
      button: 0,
      clientX: 150,
      clientY: 50,
    });
    fireEvent.pointerMove(widgetB, {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 160,
      clientY: 50,
    });
    const targets = document.querySelectorAll<HTMLElement>(
      '[data-slot="widget-grid-drop-target"]',
    );
    expect(targets[0]).toHaveClass("z-0");
    expect(targets[0]).not.toHaveClass(
      "backdrop-blur-md",
      "border-2",
      "border-dashed",
    );
    if (targets[0]) {
      targets[0].getBoundingClientRect = () => rect(0, 0, 100, 100);
    }
    if (targets[1]) {
      targets[1].getBoundingClientRect = () => rect(120, 0, 100, 100);
    }
    fireEvent.pointerMove(widgetB, {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerUp(widgetB, {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });

    // Assert
    expect(onOrderChange).toHaveBeenCalledWith(["b", "a"], {
      input: "pointer",
      movedId: "b",
      previousIndex: 1,
      nextIndex: 0,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Widget B moved to position 1 of 2",
    );
  });

  it("cancels a pointer drop outside every target", () => {
    // Arrange
    const onOrderChange = vi.fn();
    render(
      <WidgetGrid.Root order={["a"]} onOrderChange={onOrderChange}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>A</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const widget = screen.getByRole("group", { name: "Widget A" });

    // Act
    fireEvent.pointerDown(widget, {
      pointerId: 3,
      pointerType: "pen",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(widget, {
      pointerId: 3,
      pointerType: "pen",
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerUp(widget, {
      pointerId: 3,
      pointerType: "pen",
      clientX: 400,
      clientY: 400,
    });

    // Assert
    expect(onOrderChange).not.toHaveBeenCalled();
    expect(widget).toHaveAttribute("data-drag-state", "idle");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Widget A returned to its original position",
    );
  });

  it("uses a long press for touch and preserves scrolling when touch moves early", () => {
    // Arrange
    vi.useFakeTimers();
    render(
      <WidgetGrid.Root order={["a"]} onOrderChange={() => {}}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>A</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const widget = screen.getByRole("group", { name: "Widget A" });

    // Act
    fireEvent.pointerDown(widget, {
      pointerId: 9,
      pointerType: "touch",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(widget, {
      pointerId: 9,
      pointerType: "touch",
      clientX: 10,
      clientY: 30,
    });
    act(() => vi.advanceTimersByTime(300));

    // Assert
    expect(widget).toHaveAttribute("data-drag-state", "idle");
    expect(
      document.querySelector('[data-slot="widget-grid-drop-target"]'),
    ).not.toBeInTheDocument();

    // Act
    fireEvent.pointerDown(widget, {
      pointerId: 10,
      pointerType: "touch",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(260));

    // Assert
    expect(widget).toHaveAttribute("data-drag-state", "dragging");
    expect(
      document.querySelector('[data-slot="widget-grid-drop-target"]'),
    ).toBeInTheDocument();
    fireEvent.pointerCancel(widget, { pointerId: 10, pointerType: "touch" });
    expect(widget).toHaveAttribute("data-drag-state", "idle");
    vi.useRealTimers();
  });

  it("cancels keyboard movement and responds to a narrow container", () => {
    // Arrange
    let resize: ResizeObserverCallback | null = null;
    class ControlledResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
    const onOrderChange = vi.fn();
    render(
      <WidgetGrid.Root order={["a", "b"]} onOrderChange={onOrderChange}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>A</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="b" size="small" label="Widget B">
          <WidgetCard.Root>B</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const grid = document.querySelector<HTMLElement>(
      '[data-slot="widget-grid"]',
    );
    const widget = screen.getByRole("group", { name: "Widget B" });

    // Act
    widget.focus();
    fireEvent.keyDown(widget, { key: " " });
    fireEvent.keyDown(widget, { key: "ArrowRight" });
    fireEvent.keyDown(widget, { key: "Escape" });
    act(() => {
      resize?.(
        [{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // Assert
    expect(onOrderChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Widget B returned to its original position",
    );
    expect(grid).toHaveAttribute("data-column-count", "2");
    vi.unstubAllGlobals();
  });

  it("cancels an active drag when its item is removed", () => {
    // Arrange
    const onOrderChange = vi.fn();
    const { rerender } = render(
      <WidgetGrid.Root order={["a", "b"]} onOrderChange={onOrderChange}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>A</WidgetCard.Root>
        </WidgetGrid.Item>
        <WidgetGrid.Item id="b" size="small" label="Widget B">
          <WidgetCard.Root>B</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const widget = screen.getByRole("group", { name: "Widget B" });
    widget.focus();
    fireEvent.keyDown(widget, { key: " " });

    // Act
    rerender(
      <WidgetGrid.Root order={["a"]} onOrderChange={onOrderChange}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>A</WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );

    // Assert
    expect(onOrderChange).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-slot="widget-grid-drop-target"]'),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="widget-grid"]')).toHaveAttribute(
      "data-dragging",
      "false",
    );
  });

  it("cancels a pending touch drag when its widget is removed", () => {
    vi.useFakeTimers();
    try {
      const onOrderChange = vi.fn();
      const { rerender } = render(
        <WidgetGrid.Root order={["a"]} onOrderChange={onOrderChange}>
          <WidgetGrid.Item id="a" size="small" label="Widget A">
            <WidgetCard.Root>A</WidgetCard.Root>
          </WidgetGrid.Item>
        </WidgetGrid.Root>,
      );
      fireEvent.pointerDown(screen.getByRole("group", { name: "Widget A" }), {
        pointerId: 12,
        pointerType: "touch",
        button: 0,
        clientX: 40,
        clientY: 40,
      });

      rerender(<WidgetGrid.Root order={[]} onOrderChange={onOrderChange} />);
      act(() => vi.advanceTimersByTime(300));

      expect(onOrderChange).not.toHaveBeenCalled();
      expect(
        document.querySelector('[data-slot="widget-grid"]'),
      ).toHaveAttribute("data-dragging", "false");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Widget A returned to its original position.",
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels pointer dragging with global Escape and suppresses its next click", () => {
    // Arrange
    const onAction = vi.fn();
    const onOrderChange = vi.fn();
    render(
      <WidgetGrid.Root order={["a"]} onOrderChange={onOrderChange}>
        <WidgetGrid.Item id="a" size="small" label="Widget A">
          <WidgetCard.Root>
            <button type="button" onClick={onAction}>
              Open widget
            </button>
          </WidgetCard.Root>
        </WidgetGrid.Item>
      </WidgetGrid.Root>,
    );
    const widget = screen.getByRole("group", { name: "Widget A" });

    // Act
    fireEvent.pointerDown(widget, {
      pointerId: 3,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(widget, {
      pointerId: 3,
      pointerType: "mouse",
      clientX: 20,
      clientY: 20,
    });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Open widget" }));

    // Assert
    expect(widget).toHaveAttribute("data-drag-state", "idle");
    expect(onOrderChange).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}
