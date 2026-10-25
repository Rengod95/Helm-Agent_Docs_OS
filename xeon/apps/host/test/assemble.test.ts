import { existsSync } from "node:fs";
import { afterAll, expect, test } from "bun:test";
import { Type } from "typebox";
import { err, ok, type LogFields, type Logger, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ReadFailure } from "@xeon/contracts/records";
import type { ExtHost } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { defineSettings } from "@xeon/contracts/settings";
import {
  AssembleError,
  assemble,
  buildEngineCatalog,
  coreSettingGroups,
  threadWorkspaceOf,
} from "../src/assemble.ts";
import { useEngineHome } from "./fixtures/engine-home.ts";
import { partial } from "./fixtures/unsafe.ts";

const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

test("assemble-catalog-refused: a group that declares a core key again stops the start with code catalog", async () => {
  const duplicate = defineSettings("l4.host-service", {
    maxReplayEvents: {
      type: Type.Integer(),
      default: 5000,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  const caught = await assemble({ mode: "in-process", settingGroups: [duplicate] }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(AssembleError);
  if (caught instanceof AssembleError) {
    expect(caught.issues).toHaveLength(1);
    const issue = caught.issues[0];
    expect(issue?.code).toBe("catalog");
    if (issue?.code === "catalog") {
      expect(issue.issues).toEqual([
        {
          code: "duplicateKey",
          key: "l4.host-service.maxReplayEvents",
          owners: ["host", "app"],
        },
      ]);
    }
    expect(caught.message).toContain("duplicateKey");
  }
  // 열린 자원이 없다: 데이터 디렉터리도 DB 파일도 만들지 않았다
  expect(existsSync(home.dataDir)).toBe(false);
});

test("an app group such as l4.cli.* joins the catalog next to the core groups", () => {
  const stray = defineSettings("l4.cli", {
    color: {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  const built = buildEngineCatalog([stray]);
  expect(built.ok).toBe(true);
  if (built.ok) expect(built.catalog.has("l4.cli.color")).toBe(true);
});

test("the core groups build one catalog with the keys of every package that declares settings", () => {
  const built = buildEngineCatalog();
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const owners = new Set(coreSettingGroups().map((group) => group.owner));
  expect([...owners].toSorted()).toEqual([
    "cap-dialog",
    "cap-knowledge",
    "cap-mcp",
    "cap-web",
    "cap-work",
    "cap-workspace",
    "core-agents",
    "core-context",
    "core-loop",
    "core-models",
    "core-persistence",
    "core-tasks",
    "core-tools",
    "ext-host",
    "group-helm",
    "group-kit",
    "host",
    "platform-exec",
    "platform-os",
    "platform-process",
    "platform-sandbox",
    "platform-secrets",
    "platform-store",
  ]);
  for (const key of [
    "x.primitives.driveDefaultLimits",
    "x.primitives.driveLimits",
    "l3.helm.driveLimits",
    "x.operations.budget.firstMs",
    "x.loading-trust.defaultProjectTrust",
    "l0.os.log.level",
    "l0.store.heartbeatMs",
    "l0.exec.defaultTimeoutMs",
    "l0.secrets.lease.ttlSeconds",
    "l0.process.shutdown.timeoutMs",
    "l0.sandbox.enabled",
    "l1.persistence.maxResumeAttempts",
    "l1.tools.permissionMode",
    "l1.context.autoCompact",
    "l1.agents.maxDepth",
    "l1.models.default",
    "l1.loop.maxSteps",
    "l1.tasks.queue.steeringMode",
    "l2.workspace.read.maxLines",
    "l2.web.policy.allowPrivateNetwork",
    "l2.knowledge.skills.projectSkills",
    "l2.mcp.callTimeoutMs",
    "l2.work.plans.requireApproval",
    "l2.dialog.ask.timeoutSec",
    "l3.group-kit.instrumentation",
    "l4.host-service.maxReplayEvents",
  ]) {
    expect(built.catalog.has(key)).toBe(true);
  }
});

// 통합 검토 L5 후속 N-5: thread 읽기 실패는 작업 디렉터리 없음과 같은 undefined지만 조용히 삼키지 않는다.
function sessionPortReading(
  read: Result<{ readonly workspace: string | null } | null, ReadFailure>,
) {
  return partial<ExtHost>({
    ports: partial<ExtHost["ports"]>({
      get: partial<ExtHost["ports"]["get"]>(() => ({ query: { thread: () => read } })),
    }),
  });
}

function recordingLogger(): {
  readonly logger: Logger;
  readonly warns: [string, LogFields | undefined][];
} {
  const warns: [string, LogFields | undefined][] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields) => {
      warns.push([event, fields]);
    },
    error: () => undefined,
    child: () => logger,
  };
  return { logger, warns };
}

const THREAD_X: ThreadId = fixedIdFactory(710).next("thr");

test("threadWorkspaceOf logs a thread read failure and still answers undefined", () => {
  const { logger, warns } = recordingLogger();
  const of = threadWorkspaceOf(sessionPortReading(err({ kind: "io", code: "EIO" })), logger);
  expect(of(THREAD_X)).toBeUndefined();
  expect(warns).toEqual([
    ["host.thread_workspace_unreadable", { threadId: THREAD_X, reason: "io" }],
  ]);
});

test("threadWorkspaceOf answers the workspace, and undefined without a log for an unknown thread or a missing workspace", () => {
  const { logger, warns } = recordingLogger();
  expect(threadWorkspaceOf(sessionPortReading(ok({ workspace: "/w" })), logger)(THREAD_X)).toBe(
    "/w",
  );
  expect(
    threadWorkspaceOf(sessionPortReading(ok({ workspace: null })), logger)(THREAD_X),
  ).toBeUndefined();
  expect(threadWorkspaceOf(sessionPortReading(ok(null)), logger)(THREAD_X)).toBeUndefined();
  expect(warns).toEqual([]);
});
