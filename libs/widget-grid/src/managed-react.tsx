"use client";

import * as React from "react";

import { reconcileOrder, type WidgetId } from "./index";
import {
  WidgetGridRoot,
  type WidgetGridRootProps,
  type WidgetOrderChangeDetails,
} from "./react";
import { flattenGridChildren, isGridItemElement } from "./react-children";

export type WidgetGridPersistenceOperation = "read" | "write";

export type WidgetGridPersistenceFailure = Readonly<{
  key: string;
  operation: WidgetGridPersistenceOperation;
  cause: unknown;
}>;

/**
 * Synchronous persistence boundary for widget order. Implementations own their
 * storage format; the built-in browser adapter uses the versioned JSON format
 * documented by this package.
 */
export interface WidgetGridOrderStorage {
  readOrder(key: string): readonly WidgetId[] | null;
  writeOrder(key: string, order: readonly WidgetId[]): void;
}

export type ManagedWidgetGridPersistence = Readonly<{
  key: string;
  storage?: WidgetGridOrderStorage;
  onError?: (failure: WidgetGridPersistenceFailure) => void;
}>;

export type ManagedWidgetGridProps<TWidgetId extends WidgetId = WidgetId> =
  Omit<WidgetGridRootProps, "order" | "onOrderChange"> & {
    /** Complete declared order for the grid's current widget ids. */
    defaultOrder: readonly TWidgetId[];
    persistence?: ManagedWidgetGridPersistence;
    onOrderChange?: (
      order: readonly TWidgetId[],
      details: WidgetOrderChangeDetails,
    ) => void;
  };

/**
 * The default semantic storage adapter. It resolves `window.localStorage`
 * lazily so importing and server-rendering this entrypoint is safe.
 */
export const localStorageWidgetGridOrderStorage: WidgetGridOrderStorage = {
  readOrder(key) {
    const storage = getBrowserLocalStorage();
    if (!storage) return null;
    const serialized = storage.getItem(key);
    return serialized === null ? null : deserializeOrder(serialized);
  },
  writeOrder(key, order) {
    const storage = getBrowserLocalStorage();
    if (!storage) {
      throw new Error("Browser localStorage is unavailable.");
    }
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        state: { preferredOrder: [...order] },
      }),
    );
  },
};

const storageSessionIds = new WeakMap<WidgetGridOrderStorage, number>();
let nextStorageSessionId = 0;

export function ManagedWidgetGrid<TWidgetId extends WidgetId = WidgetId>({
  persistence,
  defaultOrder,
  children,
  ...props
}: ManagedWidgetGridProps<TWidgetId>) {
  assertDefaultOrderMatchesChildren(defaultOrder, children);
  const storage = persistence?.storage ?? localStorageWidgetGridOrderStorage;
  const persistenceKey = persistence?.key ?? null;
  const sessionKey = JSON.stringify([
    getStorageSessionId(storage),
    persistenceKey,
  ]);

  return (
    <ManagedWidgetGridScope
      key={sessionKey}
      defaultOrder={defaultOrder}
      persistence={persistence}
      {...props}
    >
      {children}
    </ManagedWidgetGridScope>
  );
}

function getStorageSessionId(storage: WidgetGridOrderStorage): number {
  const existingId = storageSessionIds.get(storage);
  if (existingId !== undefined) return existingId;

  const sessionId = nextStorageSessionId;
  nextStorageSessionId += 1;
  storageSessionIds.set(storage, sessionId);
  return sessionId;
}

function ManagedWidgetGridScope<TWidgetId extends WidgetId>({
  defaultOrder,
  persistence,
  onOrderChange,
  ...props
}: ManagedWidgetGridProps<TWidgetId>) {
  const [preferredOrder, setPreferredOrder] = React.useState<
    readonly TWidgetId[] | null
  >(null);
  const [hydration] = React.useState(() =>
    createWidgetOrderHydrationStore({ defaultOrder, persistence }),
  );
  const hydratedOrder = React.useSyncExternalStore(
    hydration.subscribe,
    hydration.getSnapshot,
    hydration.getServerSnapshot,
  );

  const order = reconcileTypedOrder(
    preferredOrder ?? hydratedOrder,
    defaultOrder,
  );

  function handleOrderChange(
    nextOrder: readonly WidgetId[],
    details: WidgetOrderChangeDetails,
  ) {
    const reconciledOrder = reconcileTypedOrder(nextOrder, defaultOrder);
    setPreferredOrder(reconciledOrder);

    if (persistence) {
      const storage = persistence.storage ?? localStorageWidgetGridOrderStorage;
      try {
        storage.writeOrder(persistence.key, reconciledOrder);
      } catch (cause) {
        persistence.onError?.({
          key: persistence.key,
          operation: "write",
          cause,
        });
      }
    }

    onOrderChange?.(reconciledOrder, details);
  }

  return (
    <WidgetGridRoot
      {...props}
      order={order}
      onOrderChange={handleOrderChange}
    />
  );
}

function createWidgetOrderHydrationStore<TWidgetId extends WidgetId>({
  defaultOrder,
  persistence,
}: Pick<ManagedWidgetGridProps<TWidgetId>, "defaultOrder" | "persistence">) {
  let loaded = false;
  const initialOrder: readonly TWidgetId[] = [...defaultOrder];
  let snapshot = initialOrder;

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialOrder,
    subscribe(onChange: () => void) {
      // React subscribes after commit, so storage observes the default-first UI.
      // Cache the result for this keyed session, including failed or empty reads.
      if (!loaded) {
        loaded = true;
        if (persistence) {
          const storage =
            persistence.storage ?? localStorageWidgetGridOrderStorage;
          try {
            const storedOrder = storage.readOrder(persistence.key);
            if (storedOrder !== null) {
              if (!isWidgetOrder(storedOrder)) {
                throw new Error(
                  `Persisted widget grid order for "${persistence.key}" is invalid.`,
                );
              }
              snapshot = reconcileTypedOrder(storedOrder, defaultOrder);
              onChange();
            }
          } catch (cause) {
            persistence.onError?.({
              key: persistence.key,
              operation: "read",
              cause,
            });
          }
        }
      }
      // Hydration is a one-time read; subsequent order changes are app-owned.
      return () => {};
    },
  };
}

function reconcileTypedOrder<TWidgetId extends WidgetId>(
  preferredOrder: readonly WidgetId[],
  availableOrder: readonly TWidgetId[],
): TWidgetId[] {
  const availableById = new Map<WidgetId, TWidgetId>(
    availableOrder.map((widgetId) => [widgetId, widgetId]),
  );
  return reconcileOrder(preferredOrder, availableOrder).flatMap((widgetId) => {
    const availableWidgetId = availableById.get(widgetId);
    return availableWidgetId === undefined ? [] : [availableWidgetId];
  });
}

function deserializeOrder(serialized: string): readonly WidgetId[] {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== "object") {
    throw new Error("Persisted widget grid state must be an object.");
  }

  const envelope = value as {
    version?: unknown;
    order?: unknown;
    state?: unknown;
  };
  if (envelope.version !== 1) {
    throw new Error("Persisted widget grid state has an unsupported version.");
  }

  const preferredOrder =
    envelope.state && typeof envelope.state === "object"
      ? (envelope.state as { preferredOrder?: unknown }).preferredOrder
      : envelope.order;
  if (!isWidgetOrder(preferredOrder)) {
    throw new Error("Persisted widget grid state contains an invalid order.");
  }
  return preferredOrder;
}

function isWidgetOrder(value: unknown): value is readonly WidgetId[] {
  return (
    Array.isArray(value) &&
    value.every((widgetId) => typeof widgetId === "string")
  );
}

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function assertDefaultOrderMatchesChildren(
  defaultOrder: readonly WidgetId[],
  children: React.ReactNode,
): void {
  const renderedIds = flattenGridChildren(children)
    .filter(isGridItemElement)
    .map(({ props }) => props.id);
  const declaredIds = new Set(defaultOrder);
  const renderedIdSet = new Set(renderedIds);
  const matches =
    declaredIds.size === defaultOrder.length &&
    renderedIdSet.size === renderedIds.length &&
    declaredIds.size === renderedIdSet.size &&
    [...declaredIds].every((widgetId) => renderedIdSet.has(widgetId));
  if (!matches) {
    throw new Error(
      "ManagedWidgetGrid defaultOrder must contain exactly the rendered widget ids.",
    );
  }
}
