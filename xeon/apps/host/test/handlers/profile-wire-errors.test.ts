import { expect, test } from "bun:test";
import { isId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, wireError, type WireError } from "@fresnel/contracts/wire";
import {
  wireErrorOfApply,
  type HostErrorMappers,
  type ProfileApplyFailure,
} from "../../src/handlers/m4/profile-test-run.ts";

// profile.* 실패 → 와이어 오류 옮김 표. 계약 WIRE_ERRORS의 code·kind·details로 값을 비교한다.

const THREAD_LOCKED = wireError("thread.locked");
const errors: HostErrorMappers = {
  ofStore: (_error, where) => wireError("internal", { message: `store:${where}` }),
  threadLocked: () => THREAD_LOCKED,
};

function view(error: WireError): {
  code: number;
  kind: string;
  retryable: boolean;
  details: unknown;
} {
  return {
    code: error.code,
    kind: error.data.kind,
    retryable: error.data.retryable,
    details: error.data.details,
  };
}

const RAW_THREAD = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
if (!isId("thr", RAW_THREAD)) throw new Error("fixture thread id is malformed");
const THREAD = RAW_THREAD;

const cases: readonly {
  readonly name: string;
  readonly failure: ProfileApplyFailure;
  readonly expected: { code: number; kind: string; retryable: boolean; details: unknown };
}[] = [
  {
    name: "not_found",
    failure: { kind: "not_found", id: "review" },
    expected: { code: 3301, kind: "profile.notFound", retryable: false, details: { id: "review" } },
  },
  {
    name: "conflict",
    failure: { kind: "conflict", id: "review", rev: 2, baseRev: null },
    expected: {
      code: 3302,
      kind: "profile.conflict",
      retryable: false,
      details: { id: "review", rev: 2, baseRev: null },
    },
  },
  {
    name: "corrupt (reason cut to 200)",
    failure: { kind: "corrupt", path: "/p/profiles.json", reason: "x".repeat(300) },
    expected: {
      code: 3303,
      kind: "profile.fileCorrupt",
      retryable: false,
      details: { reason: "x".repeat(200) },
    },
  },
  {
    name: "untrusted_project",
    failure: {
      kind: "write_failed",
      key: "l1.loop.maxSteps",
      failure: { kind: "untrusted_project", workspace: "/w" },
    },
    expected: {
      code: 3304,
      kind: "profile.trustRequired",
      retryable: false,
      details: { workspace: "/w" },
    },
  },
  {
    name: "apply_partial",
    failure: { kind: "apply_partial", written: ["a", "b"], failed: "c" },
    expected: {
      code: 3305,
      kind: "profile.applyPartial",
      retryable: false,
      details: { written: ["a", "b"], failed: "c" },
    },
  },
  {
    name: "limit",
    failure: { kind: "limit", max: 200 },
    expected: { code: 3306, kind: "profile.limit", retryable: false, details: { max: 200 } },
  },
  {
    name: "io",
    failure: { kind: "io", path: "/p/profiles.json", code: "EACCES" },
    expected: { code: 5006, kind: "store.io", retryable: false, details: { code: "EACCES" } },
  },
  {
    name: "thread_required",
    failure: { kind: "thread_required", layer: "thread" },
    expected: {
      code: -32602,
      kind: "jsonrpc.invalidParams",
      retryable: false,
      details: { issues: [{ path: "threadId", message: "threadId is required for layer thread" }] },
    },
  },
  {
    name: "unknown_extension",
    failure: { kind: "unknown_extension", name: "ghost" },
    expected: {
      code: 3101,
      kind: "settings.unknownKey",
      retryable: false,
      details: { key: "ext.ghost.enabled" },
    },
  },
  {
    name: "setting_rejected",
    failure: {
      kind: "setting_rejected",
      rejected: { ok: false, kind: "settings.locked", details: { key: "k" } },
    },
    expected: { code: 3104, kind: "settings.locked", retryable: false, details: { key: "k" } },
  },
  {
    name: "write_failed not_owner",
    failure: { kind: "write_failed", key: "k", failure: { kind: "not_owner", threadId: THREAD } },
    expected: { code: 3002, kind: "thread.locked", retryable: true, details: undefined },
  },
  {
    name: "write_failed managed_read_only",
    failure: { kind: "write_failed", key: "k", failure: { kind: "managed_read_only" } },
    expected: {
      code: 3103,
      kind: "settings.scopeNotAllowed",
      retryable: false,
      details: { key: "k", scope: "managed", reason: "managedReadOnly" },
    },
  },
  {
    name: "write_failed file_unwritable",
    failure: {
      kind: "write_failed",
      key: "k",
      failure: { kind: "file_unwritable", path: "/s.json", code: "EROFS" },
    },
    expected: { code: 5006, kind: "store.io", retryable: false, details: { code: "EROFS" } },
  },
];

test("every ProfileApplyFailure maps to a documented kind with the contract code", () => {
  for (const c of cases) {
    expect({ name: c.name, got: view(wireErrorOfApply(c.failure, errors)) }).toEqual({
      name: c.name,
      got: c.expected,
    });
  }
});

test("every mapped profile.* and testRun.* kind is in the contract table with the same code", () => {
  for (const c of cases) {
    const got = wireErrorOfApply(c.failure, errors);
    if (!got.data.kind.startsWith("profile.")) continue;
    const spec = Object.values(WIRE_ERRORS).find((s) => s.kind === got.data.kind);
    expect({ kind: got.data.kind, code: spec?.code }).toEqual({
      kind: got.data.kind,
      code: got.code,
    });
  }
});
