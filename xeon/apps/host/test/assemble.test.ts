import { existsSync } from "node:fs";
import { afterAll, expect, test } from "bun:test";
import { Type } from "typebox";
import { err, ok, type LogFields, type Logger, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReadFailure, StoreFailureKind } from "@fresnel/contracts/records";
import type { StoreOpenError, StoreWarning } from "@fresnel/platform-store";
import type { ExtHost } from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { defineSettings } from "@fresnel/contracts/settings";
import {
  AssembleError,
  assemble,
  buildEngineCatalog,
  coreSettingGroups,
  logStoreWarning,
  startupNoticesOf,
  storeIssueOf,
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

test("the Plugin App keys are in the engine catalog, so the app can read its screen list", () => {
  const built = buildEngineCatalog([]);
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  // 없으면 settings.get x.ui.apps가 unknownKey로 실패하고 플러그인 화면 목록이 늘 비어 있다
  expect(built.catalog.has("x.ui.apps")).toBe(true);
  expect(built.catalog.has("x.ui.allowProjectApps")).toBe(true);
});

test("the core groups build one catalog with the keys of every package that declares settings", () => {
  const built = buildEngineCatalog();
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const owners = new Set(coreSettingGroups().map((group) => group.owner));
  expect([...owners].toSorted()).toEqual([
    "builtin-extensions",
    "cap-artifacts",
    "cap-dialog",
    "cap-knowledge",
    "cap-mcp",
    "cap-schedule",
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
    "group-account-rotation",
    "group-helm",
    "group-learning",
    "group-provider-anthropic-oauth",
    "group-sdk",
    "host",
    "platform-exec",
    "platform-os",
    "platform-process",
    "platform-sandbox",
    "platform-secrets",
    "platform-store",
    "plugin-builder",
  ]);
  // 내장 확장의 예약 키가 정적 카탈로그에 있어 파일 스키마와 `config list`가 같은 키를 본다(X10)
  expect(built.catalog.has("ext.cap-web.enabled")).toBe(true);
  expect(built.catalog.get("ext.authoring.enabled")?.default).toBe(false);
  expect(built.catalog.get("ext.learning.enabled")?.default).toBe(true);
  for (const key of [
    "x.primitives.driveDefaultLimits",
    "x.primitives.driveLimits",
    "ext.helm.driveLimits",
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
    "l3.group-sdk.instrumentation",
    "l3.authoring.devMode",
    "l4.host-service.maxReplayEvents",
    "l4.remote.web.enabled",
    "l4.remote.web.listen",
    "l4.remote.web.listenTls",
    "l4.remote.web.hosts",
    "l4.remote.web.tlsCert",
    "l4.remote.web.tlsKey",
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

// G2-06: 저장소를 열지 못한 이유를 안내 분류로 나눠 알린다. 한 이름(storeUnavailable)으로 합치면 안내가 같아진다.
const STORE_OPEN_ERRORS: Readonly<
  Record<StoreOpenError["kind"], readonly [StoreOpenError, string, StoreFailureKind]>
> = {
  db_path_invalid: [
    { kind: "db_path_invalid", reason: "is_directory" },
    "storeUnavailable",
    "unavailable",
  ],
  unsupported_filesystem: [
    { kind: "unsupported_filesystem", fsKind: "network", dir: "/n" },
    "dataDirPermission",
    "unavailable",
  ],
  permission: [{ kind: "permission", path: "/d", mode: 0o755 }, "dataDirUnwritable", "unavailable"],
  foreign_database: [
    { kind: "foreign_database", applicationId: 1 },
    "storeUnavailable",
    "unavailable",
  ],
  fts5_missing: [{ kind: "fts5_missing" }, "fts5Missing", "unavailable"],
  sqlite_load_failed: [
    { kind: "sqlite_load_failed", path: "/lib/libsqlite3.dylib" },
    "storeUnavailable",
    "unavailable",
  ],
  corrupt: [{ kind: "corrupt", code: "SQLITE_CORRUPT" }, "storeCorrupt", "corrupt"],
  busy: [{ kind: "busy" }, "storeBusy", "unavailable"],
  disk_full: [{ kind: "disk_full" }, "storeUnavailable", "unavailable"],
  io: [{ kind: "io", code: "EIO" }, "storeUnavailable", "unavailable"],
  migration_checksum_mismatch: [
    { kind: "migration_checksum_mismatch", owner: "sys", version: 1 },
    "storeCorrupt",
    "corrupt",
  ],
  migration_gap: [
    { kind: "migration_gap", owner: "sys", expected: 2, got: 4 },
    "storeCorrupt",
    "corrupt",
  ],
  migration_future_version: [
    { kind: "migration_future_version", owner: "sys", dbVersion: 9, codeVersion: 3 },
    "storeFutureVersion",
    "future_version",
  ],
  migration_failed: [
    { kind: "migration_failed", owner: "sys", version: 3, code: "snapshot_failed:ENOSPC" },
    "storeMigrationFailed",
    "migration_failed",
  ],
};

test("every store open error maps to the CLI name and the guidance class the spec table gives", () => {
  for (const [error, message, failure] of Object.values(STORE_OPEN_ERRORS)) {
    expect(storeIssueOf(error, true)).toEqual({ code: "store", message, failure });
  }
});

/** 이슈의 이름과 안내 분류를 한 줄로 만든다 */
function ioIssueText(code: string, dataDirWritable: boolean): string {
  const issue = storeIssueOf({ kind: "io", code }, dataDirWritable);
  return `${issue.message}/${issue.failure}`;
}

test("an io error that says the data folder cannot be written is dataDirUnwritable, other io errors stay unavailable", () => {
  for (const code of [
    "EACCES",
    "EPERM",
    "EROFS",
    "SQLITE_READONLY",
    "SQLITE_READONLY_DIRECTORY",
    "SQLITE_PERM",
  ]) {
    expect(ioIssueText(code, true)).toBe("dataDirUnwritable/unavailable");
  }
  expect(ioIssueText("EIO", true)).toBe("storeUnavailable/unavailable");
  expect(ioIssueText("ENOTDIR", false)).toBe("storeUnavailable/unavailable");
  expect(ioIssueText("SQLITE_IOERR_WRITE", true)).toBe("storeUnavailable/unavailable");
  // SQLITE_CANTOPEN은 데이터 폴더에 쓰기 접근이 없을 때만 쓸 수 없다로 본다
  expect(ioIssueText("SQLITE_CANTOPEN", false)).toBe("dataDirUnwritable/unavailable");
  expect(ioIssueText("SQLITE_CANTOPEN", true)).toBe("storeUnavailable/unavailable");
});

test("a store warning is logged by kind with its safe fields, and a migration snapshot keeps its place", () => {
  const lines: [string, string, LogFields | undefined][] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (event, fields) => lines.push(["info", event, fields]),
    warn: (event, fields) => lines.push(["warn", event, fields]),
    error: () => undefined,
    child: () => logger,
  };
  const warnings: readonly StoreWarning[] = [
    { kind: "migration_snapshot", path: "/b/fresnel.v2.db", owner: "sys", from: 2, to: 3 },
    { kind: "snapshot_prune_failed", path: "/b/old.db", code: "EACCES" },
    { kind: "fts5_missing" },
  ];
  for (const warning of warnings) logStoreWarning(logger, warning);
  expect(lines).toEqual([
    [
      "info",
      "store.migration_snapshot",
      { path: "/b/fresnel.v2.db", owner: "sys", from: 2, to: 3 },
    ],
    ["warn", "store.snapshot_prune_failed", { path: "/b/old.db", code: "EACCES" }],
    ["warn", "store.warning", { kind: "fts5_missing" }],
  ]);
});

test("an emptied database that was replaced is logged as a warning with its two paths, and is the one startup notice", () => {
  const lines: [string, string, LogFields | undefined][] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (event, fields) => lines.push(["info", event, fields]),
    warn: (event, fields) => lines.push(["warn", event, fields]),
    error: () => undefined,
    child: () => logger,
  };
  const replaced: StoreWarning = {
    kind: "empty_replaced",
    path: "/d/fresnel.db",
    movedTo: "/d/fresnel.db.broken-20261108T010203456Z",
  };
  logStoreWarning(logger, replaced);
  expect(lines).toEqual([
    [
      "warn",
      "store.empty_replaced",
      { path: "/d/fresnel.db", movedTo: "/d/fresnel.db.broken-20261108T010203456Z" },
    ],
  ]);
  expect(startupNoticesOf([{ kind: "fts5_missing" }, replaced])).toEqual([
    { kind: "store_empty_replaced", movedTo: "/d/fresnel.db.broken-20261108T010203456Z" },
  ]);
  expect(startupNoticesOf([{ kind: "fts5_missing" }, { kind: "lock_provider_none" }])).toEqual([]);
});

test("diagnose reports the external binary table of this platform, and a cancelled signal is a value", async () => {
  const engine = await assemble({ mode: "in-process" });
  try {
    const live = await engine.diagnose(new AbortController().signal);
    expect(live.binaries.ok).toBe(true);
    if (live.binaries.ok) {
      const names = live.binaries.value.items.map((item) => item.name);
      expect(names).toContain("sops");
      expect(names).toContain("age");
      expect(names).toContain("rg");
      expect(live.binaries.value.ready).toBe(live.binaries.value.blocking.length === 0);
    }
    const cancelled = new AbortController();
    cancelled.abort();
    const stopped = await engine.diagnose(cancelled.signal);
    expect(stopped.binaries).toEqual({ ok: false, error: { kind: "cancelled" } });
  } finally {
    await engine.close();
  }
});
