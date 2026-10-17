import type { Page } from "playwright";

import type { ConsoleEntry, PageErrorEntry } from "./types";

type ConsoleTelemetrySink = {
  consoleMessage?(entry: ConsoleEntry): void;
  pageError?(entry: PageErrorEntry, error: Error): void;
};

export class ConsoleRecorder {
  private readonly messages: ConsoleEntry[] = [];
  private readonly pageErrors: PageErrorEntry[] = [];

  constructor(private readonly telemetry: ConsoleTelemetrySink = {}) {}

  attach(page: Page) {
    page.on("console", (message) => {
      const entry = {
        level: message.type(),
        location: message.location(),
        text: message.text(),
        timestamp: new Date().toISOString(),
      };
      this.messages.push(entry);
      this.telemetry.consoleMessage?.(entry);
    });

    page.on("pageerror", (error) => {
      const entry = {
        message: error.message,
        name: error.name,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      };
      this.pageErrors.push(entry);
      this.telemetry.pageError?.(entry, error);
    });
  }

  all() {
    return [...this.messages];
  }

  errors() {
    return this.messages.filter((message) => message.level === "error");
  }

  pageErrorEntries() {
    return [...this.pageErrors];
  }
}
