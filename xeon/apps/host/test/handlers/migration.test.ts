import { afterEach, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  WireError,
  type MigrationChangedParams,
  type MigrationProgressParams,
  type WireResult,
} from "@fresnel/contracts/wire";
import {
  createMigrationService,
  type MigrationProfilePort,
} from "../../src/assembly/plugins/migration.ts";
import type { MigrationFailure, MigrationPort } from "../../src/handlers/m5/migration.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { partial } from "../fixtures/unsafe.ts";
import { removeTree } from "../fixtures/remove-tree.ts";
import { SILENT } from "../assembly/plugins/intake-rig.ts";
import { fakeScanSource } from "../assembly/plugins/migration-scan-rig.ts";
import { tempRoot, writeFiles } from "../assembly/plugins/support.ts";

// 가져오기 처리기(`migration.*`)와 `trust.get`의 `foreignFormats`, 알림 두 개의 wire 모양을 가짜 엔진 위의 실제 처리기로 시험한다.
// 서비스의 동작은 `test/assembly/plugins/migration.test.ts`가 본다. 여기서는 실패가 wire 오류 이름, 번호, 세부 값으로 가는지를 본다.

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) removeTree(root);
});

function tempDir(prefix: string): string {
  const root = tempRoot(prefix);
  created.push(root);
  return root;
}

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

function failed<T>(failure: MigrationFailure): Promise<Result<T, MigrationFailure>> {
  return Promise.resolve(err(failure));
}

/** `trust.get` 응답의 뼈대. 시험은 `projectRoot`만 바꿔 쓴다 */
function statusOf(projectRoot: string): WireResult<"trust.get"> {
  return {
    projectRoot,
    required: true,
    verdict: "undecided",
    via: "headless",
    resources: [".mcp.json"],
    options: [],
  };
}

test("each migration failure reaches the wire with its own code, kind and details", async () => {
  const cases: readonly {
    readonly failure: MigrationFailure;
    readonly code: number;
    readonly kind: string;
    readonly details?: Readonly<Record<string, string>>;
  }[] = [
    { failure: { kind: "root_invalid" }, code: 3671, kind: "migration.rootInvalid" },
    { failure: { kind: "scan_limit" }, code: 3670, kind: "migration.scanLimit" },
    {
      failure: { kind: "questions_open", proposalId: "proposal-1" },
      code: 3672,
      kind: "migration.questionsOpen",
      details: { id: "proposal-1" },
    },
    {
      failure: { kind: "name_conflict", name: "deploy" },
      code: 3673,
      kind: "migration.nameConflict",
      details: { name: "deploy" },
    },
    {
      failure: { kind: "not_found", id: "scan-9" },
      code: 3675,
      kind: "migration.notFound",
      details: { id: "scan-9" },
    },
    // 훑기 자식이 끝까지 못 갔다. wire에는 새 번호가 없고 `store.io`의 `code`에 이유를 붙인다(host-service §4.25)
    {
      failure: { kind: "scan_failed", reason: "timeout" },
      code: 5006,
      kind: "store.io",
      details: { code: "scan_timeout" },
    },
    {
      failure: { kind: "scan_failed", reason: "unavailable" },
      code: 5006,
      kind: "store.io",
      details: { code: "scan_unavailable" },
    },
  ];
  await Promise.all(
    cases.map(async (item) => {
      const host = createFakeHost({
        overrides: { migration: partial<MigrationPort>({ proposal: () => failed(item.failure) }) },
      });
      const connection = await open(host);
      const error = await wireErrorOf(
        connection.request("migration.proposal", { scanId: "scan-1" }),
      );
      expect(error.code).toBe(item.code);
      expect(error.data.kind).toBe(item.kind);
      if (item.details !== undefined) expect(error.data.details).toEqual(item.details);
      await connection.close();
    }),
  );
});

test("a profile name that was not proposed is an invalid-params error on createProfiles", async () => {
  const host = createFakeHost({
    overrides: {
      migration: partial<MigrationPort>({
        apply: () => failed({ kind: "profile_not_proposed", name: "없는-프로필" }),
      }),
    },
  });
  const connection = await open(host);
  const error = await wireErrorOf(
    connection.request("migration.apply", {
      proposalId: "proposal-1",
      choices: { answers: {} },
      createProfiles: ["없는-프로필"],
    }),
  );
  expect(error.data.kind).toBe("jsonrpc.invalidParams");
  expect(error.data.details).toEqual({
    issues: [
      {
        path: "createProfiles",
        message: "a profile name must be one of the profileProposals of the proposal",
      },
    ],
  });
  await connection.close();
});

test("migration.detect and migration.dismiss pass their parameters to the port and answer its values", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      migration: partial<MigrationPort>({
        detect: (workspace) => {
          asked.push(`detect ${workspace}`);
          return Promise.resolve(
            ok({
              found: [
                {
                  marker: "CLAUDE.md",
                  harness: "claude-code",
                  engineReads: false,
                  importable: true,
                },
              ],
              notice: {
                code: "foreign_format_found",
                willStopReading: [],
                importable: ["CLAUDE.md"],
                importAvailable: true,
              },
            }),
          );
        },
        dismiss: (root, marker) => {
          asked.push(`dismiss ${root} ${marker}`);
          return Promise.resolve(ok(undefined));
        },
      }),
    },
  });
  const connection = await open(host);
  const detected = await connection.request("migration.detect", { workspace: "/work/app" });
  expect(detected.found.map((item) => item.marker)).toEqual(["CLAUDE.md"]);
  expect(detected.notice?.importable).toEqual(["CLAUDE.md"]);
  expect(
    await connection.request("migration.dismiss", { root: "/work/app", marker: "CLAUDE.md" }),
  ).toEqual({});
  expect(asked).toEqual(["detect /work/app", "dismiss /work/app CLAUDE.md"]);
  await connection.close();
});

test("trust.get carries the foreign-format notice from the real service when a marker exists, and omits it otherwise", async () => {
  const home = tempDir("migration-wire-home-");
  const stateDir = tempDir("migration-wire-state-");
  const withMarkers = tempDir("migration-wire-proj-");
  writeFiles(withMarkers, { ".mcp.json": "{}\n", "CLAUDE.md": "지침\n" });
  const bare = tempDir("migration-wire-bare-");
  writeFiles(bare, { "README.md": "x\n" });
  const service = createMigrationService({
    homeDir: realpathSync(home),
    stateDir,
    submitter: { submitPlanned: () => Promise.resolve(ok([])) },
    profiles: partial<MigrationProfilePort>({}),
    clock: { now: () => 0 },
    log: SILENT,
    scanSource: fakeScanSource().source,
  });
  const host = createFakeHost({
    overrides: {
      migration: service,
      trust: {
        get: (workspace) =>
          Promise.resolve(
            ok(
              statusOf(workspace === withMarkers ? realpathSync(withMarkers) : realpathSync(bare)),
            ),
          ),
      },
    },
  });
  const connection = await open(host);
  const found = await connection.request("trust.get", { workspace: withMarkers });
  expect(found.foreignFormats).toEqual({
    code: "foreign_format_found",
    willStopReading: [".mcp.json"],
    importable: [".mcp.json", "CLAUDE.md"],
    importAvailable: true,
  });
  const plain = await connection.request("trust.get", { workspace: bare });
  expect("foreignFormats" in plain).toBe(false);
  await connection.close();
});

test("a migration change and a scan step are pushed to every ready connection", async () => {
  const slot: {
    changed?: (change: MigrationChangedParams) => void;
    progress?: (step: MigrationProgressParams) => void;
  } = {};
  const host = createFakeHost({
    overrides: {
      migration: partial<MigrationPort>({
        onChanged: (listener) => {
          slot.changed = listener;
          return () => undefined;
        },
        onProgress: (listener) => {
          slot.progress = listener;
          return () => undefined;
        },
      }),
    },
  });
  const connection = await open(host);
  const changed = new Promise<unknown>((resolve) => {
    connection.onNotification("migration.changed", (params) => resolve(params));
  });
  const progressed = new Promise<unknown>((resolve) => {
    connection.onNotification("migration.progress", (params) => resolve(params));
  });
  if (slot.changed === undefined || slot.progress === undefined) {
    throw new Error("the hub should subscribe to both migration notifications");
  }
  slot.changed({ kind: "dismiss" });
  slot.progress({ scanId: "scan-1", done: 1, total: 2 });
  expect(await changed).toEqual({ kind: "dismiss" });
  expect(await progressed).toEqual({ scanId: "scan-1", done: 1, total: 2 });
  await connection.close();
});
