import { describe, expect, test } from "bun:test";

import { harnessRunContextEnv } from "./observability";

describe("browser harness observability", () => {
  test("propagates run, issue, and session context to spawned apps", () => {
    expect(
      harnessRunContextEnv({
        appName: "web",
        branch: "codex/logging",
        browserSessionId: "browser-session-1",
        commitSha: "abc1234",
        harnessRunId: "run-1",
        issueId: "issue-uuid-1",
        issueIdentifier: "MT-620",
        sessionId: "thread-1:turn-1",
        taskId: "task-1",
        testName: "next_home",
      }),
    ).toEqual({
      APP_NAME: "web",
      BRANCH: "codex/logging",
      BROWSER_SESSION_ID: "browser-session-1",
      COMMIT_SHA: "abc1234",
      HARNESS_RUN_ID: "run-1",
      ISSUE_ID: "issue-uuid-1",
      ISSUE_IDENTIFIER: "MT-620",
      SESSION_ID: "thread-1:turn-1",
      TASK_ID: "task-1",
      TEST_NAME: "next_home",
    });
  });
});
