#!/usr/bin/env bun
import { Command, Option } from "commander";

import {
  createBrowserHarness,
  runBrowserHarnessEnvironmentSmoke,
} from "./index";
import { serveBrowserJsonLines } from "./json-lines-server";
import type { BrowserHarnessConfigInput } from "./types";

type CliOptions = {
  allowExternalUrls?: boolean;
  appName?: string;
  appCommand?: string;
  appUrl?: string;
  config?: string;
  evidenceDir?: string;
  harnessRunId?: string;
  headed?: boolean;
  headless?: string;
  issueId?: string;
  issueIdentifier?: string;
  port?: string;
  sessionId?: string;
  startApp?: string;
  startupTimeoutMs?: string;
  taskId?: string;
  testName?: string;
  workspace?: string;
};

type SmokeCliOptions = {
  timeoutMs?: string;
};

const program = new Command()
  .name("browser-harness")
  .description("Run a local web app in Chromium and report browser state")
  .version("0.0.0");

addHarnessOptions(program.command("start"))
  .description("Run one browser observation and write evidence")
  .action(async (options: CliOptions) => {
    const harness = await createBrowserHarness(optionsToConfig(options));
    try {
      await harness.start();
      await harness.snapshot();
      await harness.screenshot({ name: "final" });
    } finally {
      await harness.stop();
    }
  });

addHarnessOptions(program.command("serve"))
  .description("Serve browser tools as JSON lines over stdio")
  .action(async (options: CliOptions) => {
    const harness = await createBrowserHarness(optionsToConfig(options));
    const result = await serveBrowserJsonLines(harness, {
      input: process.stdin,
      output: process.stdout,
      signalSource: process,
    });
    process.exitCode = result.exitCode;
  });

program
  .command("smoke")
  .description(
    "Check whether this environment can run local Chromium harness work",
  )
  .option("--timeout-ms <ms>", "timeout for browser launch and navigation")
  .action(async (options: SmokeCliOptions) => {
    const result = await runBrowserHarnessEnvironmentSmoke({
      timeoutMs: parseOptionalPositiveInteger(options.timeoutMs, "timeout-ms"),
    });

    if (result.success) {
      process.stdout.write(
        `${JSON.stringify({
          durationMs: result.durationMs,
          port: result.port,
          success: true,
          tempDir: result.tempDir,
          url: result.url,
        })}\n`,
      );
      return;
    }

    process.stderr.write(
      `${JSON.stringify({
        code: result.error.code,
        message: result.error.message,
        requires: "privileged_browser_runner",
        success: false,
      })}\n`,
    );
    process.exitCode = 1;
  });

await program.parseAsync(process.argv);

function addHarnessOptions(command: Command) {
  return command
    .option("--workspace <path>", "workspace to run the app from")
    .option("--app-name <name>", "logical app name for observability")
    .option("--app-command <command>", "app command to start")
    .option("--app-url <url>", "app URL to open")
    .option("--config <path>", "YAML config file")
    .option("--evidence-dir <path>", "evidence output directory")
    .option(
      "--harness-run-id <id>",
      "observability run id to attach to emitted telemetry",
    )
    .option(
      "--issue-id <id>",
      "Linear issue UUID to attach to emitted telemetry",
    )
    .option(
      "--issue-identifier <key>",
      "Linear issue key to attach to emitted telemetry",
    )
    .option("--port <port>", "PORT value to inject and expand")
    .option(
      "--session-id <id>",
      "Codex session id to attach to emitted telemetry",
    )
    .option("--startup-timeout-ms <ms>", "startup timeout in milliseconds")
    .option("--start-app <value>", "whether to start the app process")
    .option("--task-id <id>", "task id to attach to emitted telemetry")
    .option("--test-name <name>", "test name to attach to emitted telemetry")
    .option("--headless <value>", "whether Chromium should run headless")
    .option("--headed", "run Chromium headed")
    .addOption(
      new Option("--allow-external-urls", "allow non-loopback URLs").default(
        false,
      ),
    );
}

function optionsToConfig(options: CliOptions): BrowserHarnessConfigInput {
  return {
    allowExternalUrls: options.allowExternalUrls,
    appName: options.appName,
    appCommand: options.appCommand,
    appUrl: options.appUrl,
    configFile: options.config,
    evidenceDir: options.evidenceDir,
    harnessRunId: options.harnessRunId,
    headless: options.headed
      ? false
      : options.headless === undefined
        ? undefined
        : parseBoolean(options.headless, "headless"),
    issueId: options.issueId,
    issueIdentifier: options.issueIdentifier,
    port: options.port === undefined ? undefined : Number(options.port),
    sessionId: options.sessionId,
    startApp:
      options.startApp === undefined
        ? undefined
        : parseBoolean(options.startApp, "startApp"),
    startupTimeoutMs:
      options.startupTimeoutMs === undefined
        ? undefined
        : Number(options.startupTimeoutMs),
    taskId: options.taskId,
    testName: options.testName,
    workspace: options.workspace,
  };
}

function parseBoolean(value: string, name: string) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function parseOptionalPositiveInteger(value: string | undefined, name: string) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  throw new Error(`${name} must be a positive integer`);
}
