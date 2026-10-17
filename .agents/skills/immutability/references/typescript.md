# TypeScript Immutability Patterns

Use these examples when writing or reviewing TypeScript or JavaScript code that should make state transitions explicit.

## Contents

- Prefer Readonly State Shapes
- Avoid In-Place Array Operations
- Publish Frozen Snapshots at Boundaries
- Make Reducers Pure
- TypeScript Notes

## Prefer Readonly State Shapes

Bad: mutate nested arrays and return the same object.

```ts
type LineItem = { sku: string; price: number };
type Cart = { items: LineItem[]; total: number };

function addItem(cart: Cart, item: LineItem): Cart {
  cart.items.push(item);
  cart.total += item.price;
  return cart;
}
```

Good: type the state as readonly and return a new object.

```ts
type LineItem = Readonly<{ sku: string; price: number }>;
type Cart = Readonly<{
  items: readonly LineItem[];
  total: number;
}>;

function addItem(cart: Cart, item: LineItem): Cart {
  return {
    ...cart,
    items: [...cart.items, item],
    total: cart.total + item.price,
  };
}
```

## Avoid In-Place Array Operations

Bad: `sort` mutates the input array.

```ts
function ranked(users: User[]): User[] {
  return users.sort((a, b) => b.score - a.score);
}
```

Good: copy first, or use non-mutating array APIs when the runtime supports them.

```ts
function ranked(users: readonly User[]): User[] {
  return [...users].sort((a, b) => b.score - a.score);
}
```

```ts
function ranked(users: readonly User[]): User[] {
  return users.toSorted((a, b) => b.score - a.score);
}
```

## Publish Frozen Snapshots at Boundaries

Bad: mutate shared configuration in place.

```ts
export const config = {
  region: "us-east-1",
  mode: "live",
};

export function setMode(mode: string) {
  config.mode = mode;
}
```

Good: replace the snapshot. `Object.freeze` is shallow, so freeze nested objects separately when needed.

```ts
type AppConfig = Readonly<{
  region: string;
  mode: "live" | "test";
}>;

let currentConfig: AppConfig = Object.freeze({
  region: "us-east-1",
  mode: "live",
});

export function getConfig(): AppConfig {
  return currentConfig;
}

export function setMode(mode: AppConfig["mode"]): void {
  currentConfig = Object.freeze({ ...currentConfig, mode });
}
```

## Make Reducers Pure

Bad: mutate reducer state.

```ts
function reducer(state: State, action: Action): State {
  if (action.type === "rename") {
    state.users[action.id].name = action.name;
  }
  return state;
}
```

Good: copy each changed level.

```ts
function reducer(state: State, action: Action): State {
  if (action.type !== "rename") return state;

  const user = state.users[action.id];
  return {
    ...state,
    users: {
      ...state.users,
      [action.id]: { ...user, name: action.name },
    },
  };
}
```

## TypeScript Notes

- Prefer `readonly` parameters so functions cannot accidentally mutate caller-owned arrays.
- Use `as const` for literal configuration and discriminated union fixtures.
- Remember that `readonly` is compile-time only; runtime aliases can still mutate unless values are copied or frozen.
- Treat `Readonly<T>` as shallow. Use a local `DeepReadonly` type only when the project already uses one or the added complexity is worth it.
- Avoid `let` for values that do not need rebinding, but do not confuse `const` binding with immutable object contents.
