import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { EffectiveSetting, SettingDefWire } from "@fresnel/contracts/settings";
import { wireError } from "@fresnel/contracts/wire";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import {
  createSettingsController,
  type SettingsController,
  type SettingsHostPort,
} from "../../src/settings/index.ts";
import {
  effectiveOf,
  fakeConnection,
  wireDef,
  type ConnectionTable,
  type FakeConnection,
} from "./fixtures.ts";

// 설정 컨트롤러(controller.ts)의 시험. 가짜 호스트가 값을 기억해서 쓰기 뒤 읽기와 바깥 변경이 실제처럼 보인다.

function threadOf(name: string): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_01HZX0000000000000000000${name}`);
  if (!parsed.ok) throw new Error("test thread id must parse");
  return parsed.value;
}

const THREAD_A = threadOf("AA");
const THREAD_B = threadOf("BB");
const BUDGET = "l1.models.budget";
const DEFAULT_MODEL = "l1.models.default";

const DEFS: readonly SettingDefWire[] = [
  wireDef({
    key: BUDGET,
    type: { type: "integer" },
    range: { min: 1, max: 20 },
    default: 10,
    ui: { tab: "models", widget: "number", order: 1, label: "판정 최대 횟수" },
  }),
  wireDef({
    key: DEFAULT_MODEL,
    type: { type: "string" },
    default: "anthropic/claude",
    ui: { tab: "models", widget: "text", order: 2, label: "기본 모델" },
  }),
];

interface Host {
  readonly controller: SettingsController;
  readonly fake: FakeConnection;
  readonly stored: Map<string, EffectiveSetting>;
  setThread(thread: ThreadId | null): void;
  methods(): readonly string[];
}

/** 가짜 호스트 하나와 컨트롤러 하나. `table`로 메서드 응답을 바꾼다 */
function hostFor(
  options: {
    readonly thread?: ThreadId | null;
    readonly table?: ConnectionTable;
    readonly restart?: () => Promise<void>;
    readonly defs?: readonly SettingDefWire[];
  } = {},
): Host {
  const defs = options.defs ?? DEFS;
  let thread: ThreadId | null = options.thread ?? null;
  const stored = new Map<string, EffectiveSetting>(
    defs.map((def) => [
      def.key,
      effectiveOf(def.key, def.default ?? null, {
        source: { scope: "default" },
        runtimeChange: def.runtimeChange,
      }),
    ]),
  );
  const settingsFor = (keys: readonly string[] | undefined): readonly EffectiveSetting[] =>
    keys === undefined
      ? [...stored.values()]
      : keys.flatMap((key) => {
          const found = stored.get(key);
          return found === undefined ? [] : [found];
        });
  const defaults: ConnectionTable = {
    "settings.list": () => Promise.resolve({ defs: [...defs] }),
    "settings.get": (params) => Promise.resolve({ settings: [...settingsFor(params.keys)] }),
    "settings.set": (params) => {
      const setting = effectiveOf(params.key, params.value, {
        source: { scope: params.scope },
      });
      stored.set(params.key, setting);
      return Promise.resolve({ setting });
    },
    "settings.reset": (params) => {
      const def = defs.find((entry) => entry.key === params.key);
      const setting = effectiveOf(params.key, def?.default ?? null, {
        source: { scope: "default" },
      });
      stored.set(params.key, setting);
      return Promise.resolve({ setting });
    },
  };
  const fake = fakeConnection({ ...defaults, ...options.table });
  const port: SettingsHostPort = {
    connection: fake.connection,
    currentThreadId: () => thread,
    requestHostRestart: options.restart ?? (() => Promise.resolve()),
  };
  return {
    controller: createSettingsController(port),
    fake,
    stored,
    setThread(next) {
      thread = next;
    },
    methods: () => fake.calls.map((call) => call.method),
  };
}

/** 대기 중인 응답과 알림 뒤 읽기를 모두 흘려보낸다 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let saved: Locale = "ko";
beforeEach(() => {
  saved = activeLocale();
  setActiveLocale("ko");
});
afterEach(() => {
  setActiveLocale(saved);
});

describe("load", () => {
  test("reads the catalog, then the values, and marks the state ready", async () => {
    const host = hostFor();
    await host.controller.load();
    expect(host.methods()).toEqual(["settings.list", "settings.get"]);
    const state = host.controller.getState();
    expect(state.status).toBe("ready");
    expect([...state.defs.keys()].toSorted()).toEqual([BUDGET, DEFAULT_MODEL]);
    expect(state.values.get(BUDGET)).toEqual(
      effectiveOf(BUDGET, 10, { source: { scope: "default" }, runtimeChange: "live" }),
    );
  });

  test("a failed catalog read records loadFailed and reads no values", async () => {
    const host = hostFor({
      table: { "settings.list": () => Promise.reject(new Error("list refused")) },
    });
    await host.controller.load();
    expect(host.methods()).toEqual(["settings.list"]);
    const state = host.controller.getState();
    expect(state.status).toBe("failed");
    expect(state.loadError).toEqual({
      kind: "transient",
      message: "엔진과 연결이 끊겼어요. 다시 연결되면 저장해 주세요",
    });
  });

  test("subscribe receives each change, and the unsubscribed listener stops receiving", async () => {
    const host = hostFor();
    const kinds: string[] = [];
    const unsubscribe = host.controller.subscribe((state) => kinds.push(state.status));
    await host.controller.load();
    unsubscribe();
    host.controller.edit(BUDGET, 3);
    // loadStarted, catalogLoaded(아직 loading), valuesLoaded(ready). 구독을 끊은 뒤의 편집은 알리지 않는다
    expect(kinds).toEqual(["loading", "loading", "ready"]);
  });
});

describe("edit and commit", () => {
  test("commit sends the draft as settings.set in the default scope and keeps the saved value", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, "7");
    await host.controller.commit(BUDGET);
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.set",
      params: { key: BUDGET, value: 7, scope: "user" },
    });
    const state = host.controller.getState();
    expect(state.drafts.has(BUDGET)).toBe(false);
    expect(state.values.get(BUDGET)?.value).toBe(7);
    expect(state.saving.size).toBe(0);
  });

  test("an out-of-range draft sends nothing and records the range sentence", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 25);
    await host.controller.commit(BUDGET);
    expect(host.methods()).toEqual(["settings.list", "settings.get"]);
    expect(host.controller.getState().errors.get(BUDGET)).toEqual({
      kind: "invalidValue",
      message: "1에서 20 사이 값만 넣을 수 있어요",
      issues: [{ path: "", message: "1에서 20 사이 값만 넣을 수 있어요" }],
    });
  });

  test("commit with no draft sends nothing", async () => {
    const host = hostFor();
    await host.controller.load();
    await host.controller.commit(BUDGET);
    expect(host.methods()).toEqual(["settings.list", "settings.get"]);
  });

  test("a locked answer records the lock and reads that key again", async () => {
    const host = hostFor({
      table: {
        "settings.set": () =>
          Promise.reject(
            wireError("settings.locked", { details: { key: BUDGET, lockedBy: "managed" } }),
          ),
      },
    });
    await host.controller.load();
    host.controller.edit(BUDGET, 4);
    await host.controller.commit(BUDGET);
    const state = host.controller.getState();
    expect(state.errors.get(BUDGET)).toEqual({
      kind: "locked",
      message: "관리 정책으로 잠겨 있어 바꿀 수 없어요",
    });
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.get",
      params: { keys: [BUDGET] },
    });
    expect(state.drafts.get(BUDGET)?.value).toBe(4);
  });

  test("a second commit of the same key waits for the first, then sends the newer draft", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 3);
    const first = host.controller.commit(BUDGET);
    host.controller.edit(BUDGET, 4);
    const second = host.controller.commit(BUDGET);
    await Promise.all([first, second]);
    const sets = host.fake.calls.filter((call) => call.method === "settings.set");
    expect(sets.map((call) => call.params)).toEqual([
      { key: BUDGET, value: 3, scope: "user" },
      { key: BUDGET, value: 4, scope: "user" },
    ]);
    const state = host.controller.getState();
    expect(state.values.get(BUDGET)?.value).toBe(4);
    expect(state.drafts.has(BUDGET)).toBe(false);
  });

  test("discard drops the draft and its error", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 25);
    await host.controller.commit(BUDGET);
    host.controller.discard(BUDGET);
    const state = host.controller.getState();
    expect(state.drafts.has(BUDGET)).toBe(false);
    expect(state.errors.has(BUDGET)).toBe(false);
  });
});

describe("reset and scope", () => {
  test("reset sends settings.reset for the scope and applies the answer", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 3);
    await host.controller.commit(BUDGET);
    await host.controller.reset(BUDGET, "user");
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.reset",
      params: { key: BUDGET, scope: "user" },
    });
    expect(host.controller.getState().values.get(BUDGET)?.value).toBe(10);
  });

  test("reset in the launch scope with no open thread sends nothing and names the scope", async () => {
    const host = hostFor();
    await host.controller.load();
    await host.controller.reset(BUDGET, "launch");
    expect(host.methods()).toEqual(["settings.list", "settings.get"]);
    expect(host.controller.getState().errors.get(BUDGET)).toEqual({
      kind: "scopeNotAllowed",
      message: "이번 실행 범위에는 저장할 수 없어요",
      allowed: ["user", "project", "local"],
    });
  });

  test("a commit in the launch scope sends the open thread id", async () => {
    const host = hostFor({ thread: THREAD_A });
    await host.controller.load();
    host.controller.selectScope(BUDGET, "launch");
    host.controller.edit(BUDGET, 5);
    await host.controller.commit(BUDGET);
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.set",
      params: { key: BUDGET, value: 5, scope: "launch", threadId: THREAD_A },
    });
  });
});

describe("changes from elsewhere", () => {
  test("a launch change of another thread does not read anything again", async () => {
    const host = hostFor({ thread: THREAD_A });
    await host.controller.load();
    const before = host.methods().length;
    host.fake.emit("settings.invalidated", {
      keys: [BUDGET],
      scopes: ["launch"],
      threadId: THREAD_B,
    });
    await flush();
    expect(host.methods().length).toBe(before);
  });

  test("a launch change of the open thread reads its key with the thread id", async () => {
    const host = hostFor({ thread: THREAD_A });
    await host.controller.load();
    host.fake.emit("settings.invalidated", {
      keys: [BUDGET],
      scopes: ["launch"],
      threadId: THREAD_A,
    });
    await flush();
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.get",
      params: { keys: [BUDGET], threadId: THREAD_A },
    });
  });

  test("a user-scope change reads only the named key, keeps the draft, and flags it", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 3);
    host.stored.set(BUDGET, effectiveOf(BUDGET, 9, { source: { scope: "user" } }));
    host.fake.emit("settings.invalidated", { keys: [BUDGET], scopes: ["user"], threadId: null });
    await flush();
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.get",
      params: { keys: [BUDGET] },
    });
    const state = host.controller.getState();
    expect(state.values.get(BUDGET)?.value).toBe(9);
    expect(state.drafts.get(BUDGET)).toEqual({ value: 3, issues: [] });
    expect([...state.remoteChanged]).toEqual([BUDGET]);
  });

  test("a flagged draft is not written until the user keeps it, and then it overwrites", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 3);
    host.stored.set(BUDGET, effectiveOf(BUDGET, 9, { source: { scope: "user" } }));
    host.fake.emit("settings.invalidated", { keys: [BUDGET], scopes: ["user"], threadId: null });
    await flush();
    await host.controller.commit(BUDGET);
    expect(host.methods().includes("settings.set")).toBe(false);
    expect(host.controller.getState().drafts.get(BUDGET)).toEqual({ value: 3, issues: [] });
    host.controller.keepDraft(BUDGET);
    expect(host.controller.getState().remoteChanged.size).toBe(0);
    await host.controller.commit(BUDGET);
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.set",
      params: { key: BUDGET, value: 3, scope: "user" },
    });
  });

  test("taking the new value drops the draft and the flag", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 3);
    host.stored.set(BUDGET, effectiveOf(BUDGET, 9, { source: { scope: "user" } }));
    host.fake.emit("settings.invalidated", { keys: [BUDGET], scopes: ["user"], threadId: null });
    await flush();
    host.controller.discard(BUDGET);
    const state = host.controller.getState();
    expect(state.drafts.has(BUDGET)).toBe(false);
    expect(state.remoteChanged.size).toBe(0);
    expect(state.values.get(BUDGET)?.value).toBe(9);
  });

  test("a notice whose reloaded value equals the old one is not a change elsewhere", async () => {
    const host = hostFor();
    await host.controller.load();
    host.controller.edit(BUDGET, 3);
    host.fake.emit("settings.invalidated", { keys: [BUDGET], scopes: ["user"], threadId: null });
    await flush();
    expect(host.controller.getState().remoteChanged.size).toBe(0);
  });

  test("a change with empty keys reads the catalog and every value again", async () => {
    const host = hostFor();
    await host.controller.load();
    host.fake.emit("settings.invalidated", { keys: [], scopes: ["project"], threadId: null });
    await flush();
    expect(host.methods().slice(-2)).toEqual(["settings.list", "settings.get"]);
    expect(host.fake.calls.at(-1)).toEqual({ method: "settings.get", params: {} });
  });

  test("a change to a key that is not in the catalog reads the catalog before its value", async () => {
    const host = hostFor();
    await host.controller.load();
    host.fake.emit("settings.invalidated", {
      keys: ["l1.models.newKey"],
      scopes: ["user"],
      threadId: null,
    });
    await flush();
    expect(host.methods().slice(-2)).toEqual(["settings.list", "settings.get"]);
    expect(host.fake.calls.at(-1)).toEqual({
      method: "settings.get",
      params: { keys: ["l1.models.newKey"] },
    });
  });
});

describe("restart and dispose", () => {
  test("a failed restart request is recorded, and the next request clears it", async () => {
    let attempts = 0;
    const host = hostFor({
      restart: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("restart refused")) : Promise.resolve();
      },
    });
    await host.controller.restartHost();
    expect(host.controller.getState().restartError).toEqual({
      kind: "transient",
      message: "엔진과 연결이 끊겼어요. 다시 연결되면 저장해 주세요",
    });
    await host.controller.restartHost();
    expect(host.controller.getState().restartError).toBeNull();
  });

  test("dispose stops the change notices from reaching the listeners", async () => {
    const host = hostFor();
    await host.controller.load();
    let calls = 0;
    host.controller.subscribe(() => {
      calls += 1;
    });
    await host.controller.dispose();
    host.fake.emit("settings.invalidated", { keys: [BUDGET], scopes: ["user"], threadId: null });
    await flush();
    expect(calls).toBe(0);
  });
});
