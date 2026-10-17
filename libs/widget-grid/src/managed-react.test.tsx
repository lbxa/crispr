import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ManagedWidgetGrid,
  type WidgetGridOrderStorage,
  type WidgetGridPersistenceFailure,
} from "./managed-react";
import { WidgetCard, WidgetGrid } from "./react";

const defaultOrder = ["a", "b", "c"] as const;

function GridFixture({
  persistence,
  onOrderChange,
  declaredOrder = defaultOrder,
}: {
  declaredOrder?: readonly (typeof defaultOrder)[number][];
  persistence?: React.ComponentProps<
    typeof ManagedWidgetGrid<(typeof defaultOrder)[number]>
  >["persistence"];
  onOrderChange?: React.ComponentProps<
    typeof ManagedWidgetGrid<(typeof defaultOrder)[number]>
  >["onOrderChange"];
}) {
  return (
    <ManagedWidgetGrid
      aria-label="Managed widgets"
      defaultOrder={declaredOrder}
      persistence={persistence}
      onOrderChange={onOrderChange}
    >
      <WidgetGrid.Item id="a" size="small" label="Widget A">
        <WidgetCard.Root>A</WidgetCard.Root>
      </WidgetGrid.Item>
      <WidgetGrid.Item id="b" size="small" label="Widget B">
        <WidgetCard.Root>B</WidgetCard.Root>
      </WidgetGrid.Item>
      <WidgetGrid.Item id="c" size="small" label="Widget C">
        <WidgetCard.Root>C</WidgetCard.Root>
      </WidgetGrid.Item>
    </ManagedWidgetGrid>
  );
}

describe("ManagedWidgetGrid", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("commits visual and reading order without remounting widget content", () => {
    render(<GridFixture />);
    const widgetC = screen.getByRole("group", { name: "Widget C" });
    const widgetA = screen.getByRole("group", { name: "Widget A" });
    widgetC.focus();
    fireEvent.keyDown(widgetC, { key: " " });
    fireEvent.keyDown(widgetC, { key: "ArrowLeft" });
    fireEvent.keyDown(widgetC, { key: "Enter" });

    expect(
      screen
        .getAllByRole("group")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Widget A", "Widget C", "Widget B"]);
    expect(document.activeElement).toBe(widgetC);
    expect(screen.getByRole("group", { name: "Widget A" })).toBe(widgetA);
  });

  it("preserves a session's initial order when default props change", () => {
    const { rerender } = render(<GridFixture />);

    rerender(<GridFixture declaredOrder={["c", "b", "a"]} />);

    expect(screen.getByRole("group", { name: "Widget A" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });
  });

  it("hydrates once when a session receives a fresh persistence object", () => {
    const storage: WidgetGridOrderStorage = {
      readOrder: vi.fn(() => ["c", "b", "a"]),
      writeOrder: vi.fn(),
    };
    const { rerender } = render(
      <GridFixture persistence={{ key: "shared", storage }} />,
    );
    const widgetC = screen.getByRole("group", { name: "Widget C" });
    fireEvent.keyDown(widgetC, { key: " " });
    fireEvent.keyDown(widgetC, { key: "ArrowRight" });
    fireEvent.keyDown(widgetC, { key: "Enter" });

    rerender(
      <GridFixture
        persistence={{ key: "shared", storage, onError: vi.fn() }}
      />,
    );

    expect(storage.readOrder).toHaveBeenCalledTimes(1);
    expect(widgetC).toHaveStyle({ gridColumn: "2 / span 1" });
  });

  it("renders the declared order on the server without reading browser storage", () => {
    // Arrange
    const storage: WidgetGridOrderStorage = {
      readOrder: vi.fn(() => ["c", "b", "a"]),
      writeOrder: vi.fn(),
    };

    // Act
    const markup = renderToString(
      <GridFixture persistence={{ key: "server", storage }} />,
    );

    // Assert
    expect(markup.indexOf('data-widget-id="a"')).toBeLessThan(
      markup.indexOf('data-widget-id="c"'),
    );
    expect(storage.readOrder).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "legacy layout",
      value: { version: 1, order: ["c", "removed", "c", "a"] },
      expectedAColumn: "2 / span 1",
    },
    {
      name: "Zustand persist layout",
      value: {
        version: 1,
        state: { preferredOrder: ["c", "b", "a"] },
      },
      expectedAColumn: "3 / span 1",
    },
  ])(
    "hydrates and reconciles a $name after the default render",
    async ({ value, expectedAColumn }) => {
      // Arrange
      localStorage.setItem("saved-layout", JSON.stringify(value));

      // Act
      render(<GridFixture persistence={{ key: "saved-layout" }} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByRole("group", { name: "Widget C" })).toHaveStyle({
          gridColumn: "1 / span 1",
        });
      });
      expect(screen.getByRole("group", { name: "Widget A" })).toHaveStyle({
        gridColumn: expectedAColumn,
      });
    },
  );

  it("writes the Zustand-compatible envelope and notifies the observer", () => {
    // Arrange
    const onOrderChange = vi.fn();
    render(
      <GridFixture
        persistence={{ key: "saved-layout" }}
        onOrderChange={onOrderChange}
      />,
    );
    const widgetC = screen.getByRole("group", { name: "Widget C" });

    // Act
    widgetC.focus();
    fireEvent.keyDown(widgetC, { key: " " });
    fireEvent.keyDown(widgetC, { key: "ArrowLeft" });
    fireEvent.keyDown(widgetC, { key: "Enter" });

    // Assert
    expect(JSON.parse(localStorage.getItem("saved-layout") ?? "null")).toEqual({
      version: 1,
      state: { preferredOrder: ["a", "c", "b"] },
    });
    expect(onOrderChange).toHaveBeenCalledWith(["a", "c", "b"], {
      input: "keyboard",
      movedId: "c",
      previousIndex: 2,
      nextIndex: 1,
    });
  });

  it("keeps the declared in-memory order and reports invalid persisted data", () => {
    // Arrange
    const onError = vi.fn<(failure: WidgetGridPersistenceFailure) => void>();
    localStorage.setItem(
      "invalid-layout",
      JSON.stringify({
        version: 1,
        state: { preferredOrder: "c" },
      }),
    );

    // Act
    render(<GridFixture persistence={{ key: "invalid-layout", onError }} />);

    // Assert
    expect(screen.getByRole("group", { name: "Widget A" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "invalid-layout",
        operation: "read",
        cause: expect.any(Error),
      }),
    );
  });

  it("degrades read failures to memory and reports the failed operation", () => {
    // Arrange
    const readFailure = new Error("storage unavailable");
    const onError = vi.fn<(failure: WidgetGridPersistenceFailure) => void>();
    const storage: WidgetGridOrderStorage = {
      readOrder: () => {
        throw readFailure;
      },
      writeOrder: vi.fn(),
    };

    // Act
    render(
      <GridFixture persistence={{ key: "read-failure", storage, onError }} />,
    );

    // Assert
    expect(screen.getByRole("group", { name: "Widget A" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });
    expect(onError).toHaveBeenCalledWith({
      key: "read-failure",
      operation: "read",
      cause: readFailure,
    });
  });

  it("keeps committed order in memory when a write fails and reports it", () => {
    // Arrange
    const writeFailure = new Error("quota exceeded");
    const onError = vi.fn<(failure: WidgetGridPersistenceFailure) => void>();
    const onOrderChange = vi.fn();
    const storage: WidgetGridOrderStorage = {
      readOrder: () => null,
      writeOrder: () => {
        throw writeFailure;
      },
    };
    render(
      <GridFixture
        persistence={{ key: "write-failure", storage, onError }}
        onOrderChange={onOrderChange}
      />,
    );
    const widgetC = screen.getByRole("group", { name: "Widget C" });

    // Act
    widgetC.focus();
    fireEvent.keyDown(widgetC, { key: " " });
    fireEvent.keyDown(widgetC, { key: "ArrowLeft" });
    fireEvent.keyDown(widgetC, { key: "Enter" });

    // Assert
    expect(widgetC).toHaveStyle({ gridColumn: "2 / span 1" });
    expect(onOrderChange).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith({
      key: "write-failure",
      operation: "write",
      cause: writeFailure,
    });
  });

  it("rehydrates each changed key from defaults without flashing the previous key", () => {
    // Arrange
    const reads: string[] = [];
    const storage: WidgetGridOrderStorage = {
      readOrder(key) {
        reads.push(key);
        if (key === "second") {
          expect(screen.getByRole("group", { name: "Widget A" })).toHaveStyle({
            gridColumn: "1 / span 1",
          });
        }
        return key === "first" ? ["c", "b", "a"] : ["b", "a", "c"];
      },
      writeOrder: vi.fn(),
    };
    const { rerender } = render(
      <GridFixture persistence={{ key: "first", storage }} />,
    );
    expect(screen.getByRole("group", { name: "Widget C" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });

    // Act
    rerender(<GridFixture persistence={{ key: "second", storage }} />);

    // Assert
    expect(screen.getByRole("group", { name: "Widget B" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });
    expect(reads).toEqual(["first", "second"]);
  });

  it("rejects a default order that does not match the rendered widget ids", () => {
    // Arrange
    const renderMismatchedGrid = () =>
      render(
        <ManagedWidgetGrid defaultOrder={["a"]}>
          <WidgetGrid.Item id="b" size="small" label="Widget B">
            <WidgetCard.Root>B</WidgetCard.Root>
          </WidgetGrid.Item>
        </ManagedWidgetGrid>,
      );

    // Act + Assert
    expect(renderMismatchedGrid).toThrow(/defaultOrder.*rendered widget ids/i);
  });

  it("starts a default-first session when the storage adapter changes", () => {
    // Arrange
    const firstStorage: WidgetGridOrderStorage = {
      readOrder: () => ["c", "b", "a"],
      writeOrder: vi.fn(),
    };
    const secondStorage: WidgetGridOrderStorage = {
      readOrder() {
        expect(screen.getByRole("group", { name: "Widget A" })).toHaveStyle({
          gridColumn: "1 / span 1",
        });
        return ["b", "a", "c"];
      },
      writeOrder: vi.fn(),
    };
    const { rerender } = render(
      <GridFixture persistence={{ key: "shared", storage: firstStorage }} />,
    );
    expect(screen.getByRole("group", { name: "Widget C" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });

    // Act
    rerender(
      <GridFixture persistence={{ key: "shared", storage: secondStorage }} />,
    );

    // Assert
    expect(screen.getByRole("group", { name: "Widget B" })).toHaveStyle({
      gridColumn: "1 / span 1",
    });
  });

  it("does not reset the committed session after an interrupted key change", async () => {
    // Arrange
    const reads: string[] = [];
    const storage: WidgetGridOrderStorage = {
      readOrder(key) {
        reads.push(key);
        return key === "first" ? ["c", "b", "a"] : ["b", "a", "c"];
      },
      writeOrder: vi.fn(),
    };
    let suspendedRenders = 0;
    const pendingRender = new Promise<never>(() => undefined);

    function SuspendedSessionFixture() {
      const [key, setKey] = React.useState("first");
      const [urgentRender, setUrgentRender] = React.useState(0);

      return (
        <>
          <button
            type="button"
            onClick={() => {
              React.startTransition(() => setKey("second"));
            }}
          >
            Change key
          </button>
          <button
            type="button"
            data-urgent-render={urgentRender}
            onClick={() => setUrgentRender((current) => current + 1)}
          >
            Urgent render
          </button>
          <React.Suspense fallback="Loading second grid">
            <GridFixture persistence={{ key, storage }} />
            {key === "second" ? <SuspendPendingRender /> : null}
          </React.Suspense>
        </>
      );
    }

    function SuspendPendingRender(): never {
      suspendedRenders += 1;
      throw pendingRender;
    }

    render(<SuspendedSessionFixture />);
    await waitFor(() => {
      expect(reads).toEqual(["first"]);
    });

    // Act
    fireEvent.click(screen.getByRole("button", { name: "Change key" }));
    await waitFor(() => {
      expect(suspendedRenders).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Urgent render" }));

    // Assert
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Urgent render" }),
      ).toHaveAttribute("data-urgent-render", "1");
    });
    expect(reads).toEqual(["first"]);
  });
});
