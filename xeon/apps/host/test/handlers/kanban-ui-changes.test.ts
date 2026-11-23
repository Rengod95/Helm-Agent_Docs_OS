import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok, type Scheduler, type TimerHandle } from "@fresnel/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@fresnel/contracts/conversation";
import {
  ToolsPortKey,
  type LoaderFs,
  type ToolResourceDef,
  type TrustStoreBackend,
} from "@fresnel/contracts/extensions";
import { locateTemplateDirs, scaffoldExtension } from "@fresnel/core-authoring";
import { createExtensionLoader } from "@fresnel/ext-host";
import { createTestHost, memoryPluginStore, type TestHost } from "@fresnel/ext-host/testing";
import { HOST_SDK_MODULES } from "../../src/plugin-host/sdk-modules.ts";
import { createUiChangeCoalescer, UI_CHANGE_WINDOW_MS } from "../../src/handlers/ui-changes.ts";

// 본보기 `examples/kanban`이 실제 로더로 실리고, 모델 도구의 카드 옮기기가 상태, 데이터 바뀜, 묶인 `ext.ui.changed`까지 이어지는지 값으로 본다.
// 빌더 앱 뼈대(`scaffoldExtension` mode `app`)도 같은 로더로 싣고, 도구와 메서드가 같은 목록을 고치는지 본다.
// 실제 것: 로더(`createExtensionLoader`), 엔트리 가져오기, 오케스트레이션 SDK(조립 루트의 `HOST_SDK_MODULES`), 호스트의 바뀜 신호.
// 대역: 로더 정책(확장 등급만 준다), 신뢰 저장소(비어 있음), 도구 포트(모델 호출 대신 `execute`를 직접 부른다), 가짜 시간.
// 같은 입력과 기대 값의 마지막 단계는 데스크톱 시험(`apps/desktop/test/views/plugin/kanban-invalidate.test.ts`)이 쓴다.

const KANBAN_ROOT = join(import.meta.dir, "..", "..", "..", "..", "examples", "kanban");
const EXTENSION = "kanban";

const madeDirs: string[] = [];
afterAll(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
});

/** 확장 위치(`<userDir>/extensions/`)가 될 임시 폴더. 시험마다 따로 둔다 */
function freshUserDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kanban-load-"));
  madeDirs.push(dir);
  return dir;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 디스크를 읽는 LoaderFs. 없는 경로는 null이다(ext-host 시험 지원의 `realLoaderFs`와 같은 모양) */
const loaderFs: LoaderFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async listDir(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file",
      }));
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (caught) {
      if (isMissing(caught)) return false;
      throw caught;
    }
  },
  realpath: (path) => realpath(path),
};

const trustBackend: TrustStoreBackend = {
  read: () => Promise.resolve({ ok: true, text: null }),
  update: () => Promise.resolve(),
};

/** 가짜 시간의 예약 장치. `advance`가 시각 순서대로 기한이 된 일을 돌린다 */
function fakeScheduler(): { readonly scheduler: Scheduler; advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const timers = new Map<TimerHandle, { readonly at: number; readonly run: () => void }>();
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const handle = next;
      next += 1;
      timers.set(handle, { at: now + ms, run: fn });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };
  return {
    scheduler,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .toSorted((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

interface Loaded {
  readonly t: TestHost;
  readonly tools: Map<string, ToolResourceDef>;
  /** 확장이 켜진 뒤 연 대화 */
  readonly thread: ThreadId;
}

/**
 * `<userDir>/extensions/<이름>/`에 있는 확장을 실제 로더로 싣고, 등록을 켜고, 대화 하나를 연다.
 * 적재 진단에 오류가 없고 확장이 활성이어야 한다. 도구 포트는 등록된 도구 정의를 모아 둔다
 */
async function loadExtension(userDir: string, name: string): Promise<Loaded> {
  const t = await createTestHost({ pluginStore: memoryPluginStore() });
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "extension-test-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        toolMappedFor: () => false,
        executeForPlugin: () =>
          Promise.resolve(err({ kind: "unavailable", message: "test double: not used" })),
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  const loader = createExtensionLoader({
    host: t.host,
    // 정책은 확장 등급만 준다. 자동 끄기와 예산은 이 시험의 대상이 아니다
    policy: { admit: () => ok("user"), forget: () => {} },
    fs: loaderFs,
    paths: { userDir, managedDir: null, homeDir: userDir },
    trustBackend,
    clock: { now: () => 0 },
    sdkModules: HOST_SDK_MODULES,
  });
  const report = await loader.loadAll({
    builtins: [],
    cwd: userDir,
    mode: "headless",
    trustOverride: false,
    extraPaths: [],
    uiPolicy: {},
    signal: new AbortController().signal,
  });
  expect(report.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  expect(
    report.extensions.filter((entry) => entry.name === name).map((entry) => entry.state),
  ).toEqual(["active"]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  // 켜기 요청은 대화의 유휴 경계에서 적용된다. 그래야 도구와 메서드가 대화에서 보인다
  t.host.registration(name)?.enable();
  await t.boundary(thread).idle();
  await t.settled();
  return { t, tools, thread };
}

let calls = 0;
function nextCall(): number {
  calls += 1;
  return calls;
}

/** 모델 도구 호출. 도구 포트에 등록된 정의의 `execute`를 그 대화의 문맥으로 부른다 */
async function callTool(
  loaded: Loaded,
  thread: ThreadId,
  name: string,
  args: JsonValue,
): Promise<JsonValue> {
  const def = loaded.tools.get(name);
  if (def === undefined) throw new Error(`tool ${name} is not registered`);
  const result = await def.execute(args, {
    threadId: thread,
    signal: new AbortController().signal,
    // 호출 id가 같으면 도구 실행이 멱등 키로 묶여 앞 결과를 돌려준다. 호출마다 새 id를 준다
    toolCallId: `call_${name}_${String(nextCall())}`,
    caller: { kind: "model", agent: "main" },
  });
  await loaded.t.settled();
  return toJsonValue(result) ?? null;
}

/** 화면의 길: 메서드 호출(caller `ui`). 결과는 값이다 */
async function callMethod(
  loaded: Loaded,
  thread: ThreadId,
  verb: string,
  params: JsonValue,
  extension = EXTENSION,
): Promise<JsonValue> {
  const outcome = await loaded.t.host.methods.call({
    extension,
    verb,
    params,
    threadId: thread,
    signal: new AbortController().signal,
    caller: "ui",
  });
  await loaded.t.settled();
  if (outcome.kind !== "ok") throw new Error(`method ${verb} gave ${outcome.kind}`);
  return toJsonValue(outcome.value) ?? null;
}

/** 본보기 폴더를 사용자 확장 위치에 복사한 시험 공간 */
function kanbanSpace(): string {
  const userDir = freshUserDir();
  cpSync(KANBAN_ROOT, join(userDir, "extensions", EXTENSION), { recursive: true });
  return userDir;
}

test("the kanban example loads through the real loader and its board starts empty", async () => {
  const loaded = await loadExtension(kanbanSpace(), EXTENSION);
  expect(await callMethod(loaded, loaded.thread, "board", {})).toEqual({
    ok: true,
    cards: [],
  });
});

test("a model tool move changes the card's column, emits one data change, and coalesces to one ext.ui.changed", async () => {
  const loaded = await loadExtension(kanbanSpace(), EXTENSION);
  const { t, thread } = loaded;
  await callTool(loaded, thread, "kanban_add_card", { title: "첫 카드" });
  await callTool(loaded, thread, "kanban_add_card", { title: "둘째 카드" });

  // 바뀜 신호의 묶기는 조립의 `events.ts`가 하는 것과 같게 잇는다: 데이터 바뀜만 골라 묶기에 넘긴다
  const data: unknown[] = [];
  const time = fakeScheduler();
  const sent: { readonly method: string; readonly params: { readonly extension: string } }[] = [];
  const coalescer = createUiChangeCoalescer({
    windowMs: UI_CHANGE_WINDOW_MS,
    scheduler: time.scheduler,
    emit: (extension) => {
      sent.push({ method: "ext.ui.changed", params: { extension } });
    },
  });
  t.host.onChange((change) => {
    if (change.kind !== "data") return;
    data.push(change);
    coalescer.signal(change.extension);
  });

  const moved = await callTool(loaded, thread, "kanban_move_card", {
    id: "card-1",
    column: "doing",
    index: 0,
  });
  // (1) 상태: 옮긴 카드가 doing 칸으로 가고, 남은 카드는 todo 칸 첫 자리에 온다
  expect(moved).toEqual({
    ok: true,
    cards: [
      { id: "card-2", title: "둘째 카드", column: "todo", order: 0 },
      { id: "card-1", title: "첫 카드", column: "doing", order: 0 },
    ],
  });
  // (2) 엔진이 데이터 바뀜을 한 번 낸다
  expect(data).toEqual([
    { kind: "data", extension: EXTENSION, scopeId: EXTENSION, threadId: thread },
  ]);
  // (3) 창이 닫히기 전에는 알리지 않고, 닫히면 연결마다 한 번 알린다
  expect(sent).toEqual([]);
  time.advance(UI_CHANGE_WINDOW_MS - 1);
  expect(sent).toEqual([]);
  time.advance(1);
  expect(sent).toEqual([{ method: "ext.ui.changed", params: { extension: EXTENSION } }]);

  // 창 안의 두 번째와 세 번째 옮기기는 같은 창에 묶여 알림이 한 번 더 나간다(창이 닫힌 뒤의 옮기기는 새 창이다)
  await callTool(loaded, thread, "kanban_move_card", { id: "card-2", column: "done", index: 0 });
  await callTool(loaded, thread, "kanban_move_card", { id: "card-1", column: "done", index: 1 });
  expect(data.length).toBe(3);
  time.advance(UI_CHANGE_WINDOW_MS);
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ method: "ext.ui.changed", params: { extension: EXTENSION } });
});

test("a move that finds no card changes nothing and announces nothing", async () => {
  const loaded = await loadExtension(kanbanSpace(), EXTENSION);
  const { t, thread } = loaded;
  await callTool(loaded, thread, "kanban_add_card", { title: "첫 카드" });
  const data: unknown[] = [];
  t.host.onChange((change) => {
    if (change.kind === "data") data.push(change);
  });
  expect(
    await callTool(loaded, thread, "kanban_move_card", { id: "card-9", column: "done", index: 0 }),
  ).toEqual({ ok: false, reason: "not_found" });
  expect(data).toEqual([]);
});

test("the screen's method calls and the model's tool calls reach the same board", async () => {
  const loaded = await loadExtension(kanbanSpace(), EXTENSION);
  const { t, thread: byTool } = loaded;
  const byMethod = t.newThread();
  await t.host.openThread(byMethod);
  await t.settled();

  await callTool(loaded, byTool, "kanban_add_card", { title: "첫 카드" });
  await callTool(loaded, byTool, "kanban_add_card", { title: "둘째 카드" });
  const toolBoard = await callTool(loaded, byTool, "kanban_move_card", {
    id: "card-1",
    column: "doing",
    index: 0,
  });

  // 다른 대화에서 부른 화면 메서드가 같은 한 보드를 읽고 쓴다(기록은 플러그인 전용 저장소에 하나다)
  expect(await callMethod(loaded, byMethod, "board", {})).toEqual(toolBoard);
  const methodBoard = await callMethod(loaded, byMethod, "move", {
    id: "card-2",
    column: "done",
    index: 0,
  });

  // 메서드가 옮긴 결과를 도구 쪽 대화에서 더한 카드와 함께 읽는다
  const added = await callTool(loaded, byTool, "kanban_add_card", { title: "셋째 카드" });
  expect(added).toEqual({
    ok: true,
    cards: [
      { id: "card-3", title: "셋째 카드", column: "todo", order: 0 },
      { id: "card-1", title: "첫 카드", column: "doing", order: 0 },
      { id: "card-2", title: "둘째 카드", column: "done", order: 0 },
    ],
  });
  expect(methodBoard).toEqual({
    ok: true,
    cards: [
      { id: "card-1", title: "첫 카드", column: "doing", order: 0 },
      { id: "card-2", title: "둘째 카드", column: "done", order: 0 },
    ],
  });
});

const pad = (n: number): string => String(n).padStart(2, "0");

test("a scaffolded app skeleton loads through the same loader, and its tool and method share one list", async () => {
  const userDir = freshUserDir();
  const templates = locateTemplateDirs({});
  if (templates === null) throw new Error("templates are missing in the source tree");
  const scaffolded = await scaffoldExtension(
    { kind: "single-plugin", name: "memo", dir: join(userDir, "extensions", "memo"), mode: "app" },
    { templates },
  );
  expect(scaffolded.ok).toBe(true);
  const loaded = await loadExtension(userDir, "memo");
  const { thread } = loaded;
  expect(await callMethod(loaded, thread, "list", {}, "memo")).toEqual({ ok: true, items: [] });
  const now = new Date();
  const created = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const first = { title: "첫 항목", created };
  const second = { title: "둘째 항목", created };
  expect(await callTool(loaded, thread, "memo_add_item", { title: "첫 항목" })).toEqual({
    ok: true,
    items: [first],
  });
  expect(await callMethod(loaded, thread, "add", { title: "둘째 항목" }, "memo")).toEqual({
    ok: true,
    items: [first, second],
  });
  expect(await callMethod(loaded, thread, "list", {}, "memo")).toEqual({
    ok: true,
    items: [first, second],
  });
});
