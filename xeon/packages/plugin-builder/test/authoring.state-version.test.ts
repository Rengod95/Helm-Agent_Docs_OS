import { expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import { toJsonValue } from "@fresnel/contracts/conversation";
import { migrationChain } from "@fresnel/orchestration-sdk";
import {
  AuthoringStateSchema,
  INITIAL_AUTHORING_STATE,
  type AuthoringState,
} from "../src/index.ts";
import { authoringStateMigrations } from "../src/group-state.ts";
import { createAuthoringOrchestration } from "../src/group.ts";
import { devkitProbe } from "./group-support.ts";

// 상태 문서 판 4(판 2: `installed` → `submitted`, 판 3: 종류는 플러그인 하나, 판 4: 목적·상주·원본 시작). 저장된 옛 문서는 엔진이 쓰는 같은 체인(`migrationChain`)으로 옮긴다.

const chain = migrationChain(4, authoringStateMigrations);

/** 저장된 문서처럼 JSON으로 바꿔 판 1에서 현재 판까지 옮긴다. 시험 입력은 모두 JSON이다 */
function migrate(value: unknown): unknown {
  const json = toJsonValue(value);
  if (json === undefined) throw new Bug("the state fixture is not JSON");
  return chain(json, 1);
}

/** 판 2로 저장된 문서를 현재 판까지 옮긴다 */
function migrateFromV2(value: unknown): unknown {
  const json = toJsonValue(value);
  if (json === undefined) throw new Bug("the state fixture is not JSON");
  return chain(json, 2);
}

/** 판 1 모양의 초기 문서(`installed` 필드가 있다). 옛 스키마의 키 그대로다 */
const OLD_INITIAL: Readonly<Record<string, unknown>> = {
  phase: "idle",
  sessionId: null,
  kind: null,
  name: null,
  dir: null,
  displayName: null,
  intentConfirmed: false,
  composition: null,
  files: [],
  lastErrorKey: null,
  sameErrorRuns: 0,
  pending: null,
  packOut: null,
  replay: "none",
  trial: null,
  packaged: null,
  installed: null,
  denied: null,
  askRound: 0,
};

function oldState(overrides: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...OLD_INITIAL, ...overrides };
}

function newState(overrides: Partial<AuthoringState>): AuthoringState {
  return { ...INITIAL_AUTHORING_STATE, ...overrides };
}

const PACKAGED = { path: "/work/demo/dist/package", sha256: "a".repeat(64), files: 3 };
const INSTALLED = { name: "demo", version: "0.1.0", location: "/plugins/demo" };

test("authoring.state-v2.installed: an old installed session keeps done and its submitted slot is null", () => {
  const old = oldState({
    phase: "done",
    kind: "single-plugin",
    name: "demo",
    dir: "/work/demo",
    displayName: "데모",
    intentConfirmed: true,
    files: ["src/index.ts"],
    replay: "passed",
    trial: { threadId: "thr_1" },
    packaged: PACKAGED,
    installed: INSTALLED,
    askRound: 2,
  });
  expect(parse(AuthoringStateSchema, old).ok).toBe(false);
  const migrated = migrate(old);
  expect(parse(AuthoringStateSchema, migrated).ok).toBe(true);
  expect(migrated).toEqual(
    newState({
      phase: "done",
      kind: "single-plugin",
      name: "demo",
      dir: "/work/demo",
      displayName: "데모",
      intentConfirmed: true,
      files: ["src/index.ts"],
      replay: "passed",
      trial: { threadId: "thr_1" },
      packaged: PACKAGED,
      submitted: null,
      askRound: 2,
    }),
  );
});

test("authoring.state-v2.installed-null: a pending install request is dropped and the packed session stays open", () => {
  const old = oldState({
    phase: "package",
    kind: "single-plugin",
    name: "demo",
    dir: "/work/demo",
    intentConfirmed: true,
    packaged: PACKAGED,
    pending: "install",
  });
  expect(migrate(old)).toEqual(
    newState({
      phase: "package",
      kind: "single-plugin",
      name: "demo",
      dir: "/work/demo",
      intentConfirmed: true,
      packaged: PACKAGED,
      pending: null,
      submitted: null,
    }),
  );
});

test("authoring.state-v2.denied-install: a declined install is dropped, not kept as a declined request", () => {
  const old = oldState({
    phase: "package",
    dir: "/work/demo",
    packaged: PACKAGED,
    denied: "install",
  });
  expect(migrate(old)).toEqual(
    newState({ phase: "package", dir: "/work/demo", packaged: PACKAGED, denied: null }),
  );
});

test("authoring.state-v2.initial: an old initial document becomes the new initial state", () => {
  expect(migrate(oldState({}))).toEqual(INITIAL_AUTHORING_STATE);
});

test("authoring.state-v2.new-shape-at-v1: a document already in the new shape passes the step unchanged", () => {
  const current = newState({
    phase: "done",
    kind: "single-plugin",
    name: "demo-group",
    dir: "/work/group",
    intentConfirmed: true,
    packaged: PACKAGED,
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
    askRound: 1,
  });
  expect(migrate(current)).toEqual(current);
});

test("authoring.state-v2.new-shape-at-v2: a version 2 document is parsed as it is", () => {
  const current = newState({
    phase: "done",
    dir: "/work/demo",
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
  });
  const parsed = parse(AuthoringStateSchema, current);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual(current);
});

test("authoring.state-v2.garbage: a stored document that is not a state is a Result error, never a throw", () => {
  const garbage: readonly unknown[] = [
    "text",
    42,
    null,
    [],
    {},
    { phase: "bogus" },
    oldState({ phase: "nope", installed: 1 }),
  ];
  const outcomes: boolean[] = [];
  for (const doc of garbage) {
    expect(() => {
      outcomes.push(parse(AuthoringStateSchema, migrate(doc)).ok);
    }).not.toThrow();
  }
  expect(outcomes).toEqual([false, false, false, false, false, false, false]);
});

test("authoring.state-v3.kind: a version 2 document of the old group kind is read as single-plugin, the rest stays", () => {
  const stored = {
    ...newState({ phase: "done", dir: "/work/demo", askRound: 1 }),
    kind: "plugin-group",
  };
  expect(parse(AuthoringStateSchema, stored).ok).toBe(false);
  const migrated = migrateFromV2(stored);
  expect(parse(AuthoringStateSchema, migrated).ok).toBe(true);
  expect(migrated).toEqual(
    newState({ phase: "done", dir: "/work/demo", askRound: 1, kind: "single-plugin" }),
  );
});

test("authoring.state-v3.kind-kept: a version 2 document of the single plugin kind is not changed", () => {
  const stored = newState({ phase: "done", kind: "single-plugin", dir: "/work/demo" });
  expect(migrateFromV2(stored)).toEqual(stored);
});

test("authoring.state-v4.declared: the group declares state version 4 with three migration steps", () => {
  const module = createAuthoringOrchestration({ devkit: devkitProbe().devkit });
  expect(module.stateVersion).toBe(4);
  expect(module.stateUpcasters).toHaveLength(3);
});

test("authoring.state-v4.added: a version 3 document gets no purpose, not resident, not from a source folder", () => {
  const stored = newState({ phase: "compose", dir: "/work/demo", kind: "single-plugin" });
  const { purpose: _purpose, resident: _resident, fromSource: _fromSource, ...v3 } = stored;
  expect(migrate(v3)).toEqual(stored);
  expect(migrate({ ...v3, purpose: "로그를 정리한다" })).toEqual({
    ...stored,
    purpose: "로그를 정리한다",
  });
});
