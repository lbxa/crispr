import {
  createLokiRunQuery,
  lokiSearchLogs,
  type LokiLogEntry,
  type LokiRunQueryOptions,
} from "@crispr/observability";

export type ObservabilityClientConfig = {
  lokiBaseUrl?: string;
};

export type ObservabilityLogEntry = {
  fields: Record<string, unknown>;
  labels: Record<string, string>;
  line: string;
  timestampUnixNano: string;
};

export class ObservabilityClient {
  private readonly lokiBaseUrl: string;

  constructor(config: ObservabilityClientConfig = {}) {
    this.lokiBaseUrl =
      config.lokiBaseUrl ?? process.env.LOKI_URL ?? "http://127.0.0.1:3100";
  }

  async getLogs(runId: string): Promise<ObservabilityLogEntry[]> {
    return this.queryLogs(runId);
  }

  async getErrors(runId: string): Promise<ObservabilityLogEntry[]> {
    return this.queryLogs(runId, { level: "error" });
  }

  async getBrowserConsoleLogs(runId: string): Promise<ObservabilityLogEntry[]> {
    return this.queryLogs(runId, {
      eventName: /^browser_console_/,
      surface: "browser",
    });
  }

  async getNetworkFailures(runId: string): Promise<ObservabilityLogEntry[]> {
    return this.queryLogs(runId, {
      eventName: /^browser_(http_error|network_failure)$/,
      surface: "browser",
    });
  }

  private async queryLogs(
    runId: string,
    options: LokiRunQueryOptions = {},
  ): Promise<ObservabilityLogEntry[]> {
    const result = await lokiSearchLogs(
      {
        limit: 1_000,
        query: createLokiRunQuery(runId, options),
      },
      {
        lokiBaseUrl: this.lokiBaseUrl,
      },
    );

    if (!result.success) {
      throw new Error(`Loki query failed: ${result.error}`);
    }

    return result.entries.map(toObservabilityLogEntry);
  }
}

function parseJsonLine(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toObservabilityLogEntry(entry: LokiLogEntry): ObservabilityLogEntry {
  return {
    fields: parseJsonLine(entry.line),
    labels: entry.labels,
    line: entry.line,
    timestampUnixNano: String(BigInt(Date.parse(entry.ts)) * 1_000_000n),
  };
}

export { createLokiRunQuery };
