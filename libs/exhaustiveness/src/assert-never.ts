export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${String(value)}`);
}
