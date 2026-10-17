import type { CDPSession, Page } from "playwright";

import type { RuntimeExceptionEntry } from "./types";

type RuntimeExceptionPayload = {
  exceptionDetails?: {
    exception?: {
      description?: string;
    };
    text?: string;
  };
};

export class BrowserCdpSession {
  private client: CDPSession | undefined;
  private readonly exceptions: RuntimeExceptionEntry[] = [];

  async attach(page: Page) {
    this.client = await page.context().newCDPSession(page);
    await this.client.send("Runtime.enable");
    await this.client.send("Performance.enable");
    this.client.on(
      "Runtime.exceptionThrown",
      (payload: RuntimeExceptionPayload) => {
        this.exceptions.push({
          message:
            payload.exceptionDetails?.exception?.description ??
            payload.exceptionDetails?.text ??
            "Runtime exception",
          timestamp: new Date().toISOString(),
        });
      },
    );
  }

  runtimeExceptions() {
    return [...this.exceptions];
  }

  async detach() {
    await this.client?.detach().catch(() => undefined);
    this.client = undefined;
  }
}
