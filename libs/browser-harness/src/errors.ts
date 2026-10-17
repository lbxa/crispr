import type { HarnessErrorCode } from "./types";

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "HarnessError";
  }
}

export function toHarnessError(
  error: unknown,
  fallbackCode: HarnessErrorCode,
): HarnessError {
  if (error instanceof HarnessError) {
    return error;
  }

  if (error instanceof Error) {
    return new HarnessError(fallbackCode, error.message, { cause: error });
  }

  return new HarnessError(fallbackCode, String(error));
}
