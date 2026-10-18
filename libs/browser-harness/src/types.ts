export type HarnessErrorCode =
  | EnvironmentBlockedErrorCode
  | "invalid_config"
  | "workspace_not_found"
  | "app_start_failed"
  | "app_start_timeout"
  | "browser_launch_failed"
  | "browser_not_started"
  | "page_open_failed"
  | "selector_not_found"
  | "action_timeout"
  | "page_error"
  | "network_failure"
  | "screenshot_failed"
  | "unsupported_method"
  | "shutdown_failed";

export type EnvironmentBlockedErrorCode =
  | "environment_blocked_tempdir"
  | "environment_blocked_loopback"
  | "environment_blocked_browser_launch"
  | "environment_blocked_browser_navigation";

export type Viewport = {
  width: number;
  height: number;
};

export type BrowserHarnessConfigInput = {
  allowEvaluate?: boolean;
  allowExternalUrls?: boolean;
  allowRawCdp?: boolean;
  appName?: string;
  appCommand?: string;
  appUrl?: string;
  captureScreenshots?: boolean;
  captureVideo?: boolean;
  configFile?: string;
  evidenceDir?: string;
  failOnConsoleError?: boolean;
  harnessRunId?: string;
  headless?: boolean;
  issueId?: string;
  issueIdentifier?: string;
  localOnly?: boolean;
  persistBrowserState?: boolean;
  port?: number;
  reportNetworkFailures?: boolean;
  sessionId?: string;
  startApp?: boolean;
  startupTimeoutMs?: number;
  taskId?: string;
  testName?: string;
  viewport?: Partial<Viewport>;
  workspace?: string;
};

export type BrowserHarnessRunContext = {
  appName: string;
  branch?: string;
  browserSessionId: string;
  commitSha?: string;
  harnessRunId: string;
  issueId?: string;
  issueIdentifier?: string;
  sessionId?: string;
  taskId?: string;
  testName: string;
};

export type BrowserHarnessConfig = {
  allowEvaluate: boolean;
  allowExternalUrls: boolean;
  allowRawCdp: boolean;
  appCommand?: string;
  appUrl: string;
  captureScreenshots: boolean;
  captureVideo: boolean;
  evidenceDir: string;
  failOnConsoleError: boolean;
  headless: boolean;
  localOnly: boolean;
  observability: BrowserHarnessRunContext;
  persistBrowserState: boolean;
  port?: number;
  reportNetworkFailures: boolean;
  startApp: boolean;
  startupTimeoutMs: number;
  viewport: Viewport;
  workspace: string;
};

export type AppLogEntry = {
  stream: "stdout" | "stderr";
  text: string;
  timestamp: string;
};

export type ConsoleEntry = {
  level: string;
  location?: {
    columnNumber: number;
    lineNumber: number;
    url: string;
  };
  text: string;
  timestamp: string;
};

export type PageErrorEntry = {
  message: string;
  name?: string;
  stack?: string;
  timestamp: string;
};

export type NetworkEntry = {
  error?: string;
  method: string;
  status?: number;
  statusText?: string;
  timestamp: string;
  url: string;
};

export type RuntimeExceptionEntry = {
  message: string;
  timestamp: string;
};

export type SnapshotResult = {
  accessibilityTree: string;
  consoleErrors: ConsoleEntry[];
  failedRequests: NetworkEntry[];
  pageErrors: PageErrorEntry[];
  runtimeExceptions: RuntimeExceptionEntry[];
  success: true;
  title: string;
  url: string;
  visibleText: string;
};

export type SuccessResult = {
  success: true;
};

export type ScreenshotResult = {
  path: string;
  success: true;
};

export type OpenResult = {
  success: true;
  url: string;
};

export type ConsoleResult = {
  messages: ConsoleEntry[];
  success: true;
};

export type NetworkResult = {
  failedRequests: NetworkEntry[];
  success: true;
};

export type WaitForTextResult = {
  matched: boolean;
  success: true;
};

export type BrowserToolResult =
  | ConsoleResult
  | NetworkResult
  | OpenResult
  | ScreenshotResult
  | SnapshotResult
  | SuccessResult
  | WaitForTextResult;

export type HarnessJsonError = {
  code: HarnessErrorCode;
  message: string;
};

export type JsonRpcRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse =
  | {
      id: string;
      result: BrowserToolResult;
    }
  | {
      error: HarnessJsonError;
      id: string;
    };

export type ClickInput = {
  selector: string;
  timeoutMs?: number;
};

export type TypeInput = {
  selector: string;
  text: string;
  timeoutMs?: number;
};

export type PressInput = {
  key: string;
};

export type PointerInput =
  | { action: "move"; x: number; y: number; steps?: number }
  | { action: "down" | "up" };

export type SetInputFilesInput = {
  selector: string;
  path: string;
  timeoutMs?: number;
};

export type WaitInput = {
  timeoutMs: number;
};

export type WaitForTextInput = {
  text: string;
  timeoutMs?: number;
};

export type WaitForUrlInput = {
  timeoutMs?: number;
  url: string;
};

export type OpenInput = {
  url?: string;
};

export type ScreenshotInput = {
  fullPage?: boolean;
  name?: string;
};

export type BrowserHarness = {
  click(input: ClickInput): Promise<SuccessResult>;
  close(): Promise<SuccessResult>;
  console(): Promise<ConsoleResult>;
  network(): Promise<NetworkResult>;
  open(input?: OpenInput): Promise<OpenResult>;
  press(input: PressInput): Promise<SuccessResult>;
  pointer(input: PointerInput): Promise<SuccessResult>;
  screenshot(input?: ScreenshotInput): Promise<ScreenshotResult>;
  setInputFiles(input: SetInputFilesInput): Promise<SuccessResult>;
  snapshot(): Promise<SnapshotResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
  type(input: TypeInput): Promise<SuccessResult>;
  wait(input: WaitInput): Promise<SuccessResult>;
  waitForText(input: WaitForTextInput): Promise<WaitForTextResult>;
  waitForUrl(input: WaitForUrlInput): Promise<SuccessResult>;
};
