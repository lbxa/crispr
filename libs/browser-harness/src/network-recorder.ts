import type { Page } from "playwright";

import type { NetworkEntry } from "./types";

type NetworkTelemetrySink = {
  networkFailure?(entry: NetworkEntry): void;
};

export class NetworkRecorder {
  private readonly failed: NetworkEntry[] = [];

  constructor(private readonly telemetry: NetworkTelemetrySink = {}) {}

  attach(page: Page) {
    page.on("requestfailed", (request) => {
      const entry = {
        error: request.failure()?.errorText ?? "request failed",
        method: request.method(),
        timestamp: new Date().toISOString(),
        url: request.url(),
      };
      this.failed.push(entry);
      this.telemetry.networkFailure?.(entry);
    });

    page.on("response", (response) => {
      if (response.status() < 400) {
        return;
      }

      const entry = {
        method: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
        timestamp: new Date().toISOString(),
        url: response.url(),
      };
      this.failed.push(entry);
      this.telemetry.networkFailure?.(entry);
    });
  }

  failedRequests() {
    return [...this.failed];
  }
}
