import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@fresnel/contracts/conversation";
import {
  ToolsPortKey,
  type LoaderFs,
  type ToolResourceDef,
  type TrustStoreBackend,
} from "@fresnel/contracts/extensions";
import { createExtensionLoader } from "@fresnel/ext-host";
import { createTestHost, type TestHost } from "@fresnel/ext-host/testing";
import { HOST_SDK_MODULES } from "../../src/plugin-host/sdk-modules.ts";

// 본보기 `examples/kanban-native`가 실제 로더로 실리고, 화면의 길(메서드 move, add, reorder, caller `ui`)과
// 모델의 길(도구 kanban_native_move_card, kanban_native_add_card)이 같은 보드를 고치는지 값으로 본다.
// 메서드 인자는 보드 부품이 보내는 모양 그대로다: move { id, column, index }, add { column, title }, reorder { id, index }.
// 대역은 `kanban-ui-changes.test.ts`와 같다(로더 정책, 빈 신뢰 저장소, 도구 포트).

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "examples", "kanban-native");
const EXTENSION = "kanban-native";

const madeDirs: string[] = [];
afterAll(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
});

/** 확장 위치(`<userDir>/extensions/`)가 될 임시 폴더. 시험마다 따로 둔다 */
function freshUserDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kanban-native-load-"));
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
  const t = await createTestHost();
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
function space(): string {
  const userDir = freshUserDir();
  cpSync(ROOT, join(userDir, "extensions", EXTENSION), { recursive: true });
  return userDir;
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** 보드 결과에서 열마다 카드 id 목록 */
function columnsOf(value: JsonValue): Record<string, readonly string[]> {
  const out: Record<string, string[]> = { todo: [], doing: [], done: [] };
  if (typeof value !== "object" || value === null || isJsonArray(value)) return out;
  const cards = value["cards"];
  if (!isJsonArray(cards)) return out;
  const ordered = cards.toSorted((a, b) => orderOf(a) - orderOf(b));
  for (const card of ordered) {
    if (typeof card !== "object" || card === null || isJsonArray(card)) continue;
    const column = card["column"];
    const id = card["id"];
    if (typeof column === "string" && typeof id === "string") out[column]?.push(id);
  }
  return out;
}

function orderOf(card: JsonValue): number {
  if (typeof card !== "object" || card === null || isJsonArray(card)) return 0;
  const order = card["order"];
  return typeof order === "number" ? order : 0;
}

test("the native kanban example loads and its board method gives columns, the seeded cards and the to-do list", async () => {
  const loaded = await loadExtension(space(), EXTENSION);
  const board = await callMethod(loaded, loaded.thread, "board", {});
  expect(board).toMatchObject({
    ok: true,
    columns: [
      { id: "todo", title: "할 일" },
      { id: "doing", title: "진행 중" },
      { id: "done", title: "끝" },
    ],
  });
  expect(columnsOf(board)).toEqual({
    todo: ["card-1", "card-2"],
    doing: ["card-3"],
    done: ["card-4"],
  });
  expect(
    typeof board === "object" && board !== null && !isJsonArray(board) ? board["todo"] : undefined,
  ).toEqual([
    { id: "card-1", title: "보드 부품 살펴보기", column: "todo", order: 0, tag: "본보기" },
    {
      id: "card-2",
      title: "열 사이로 카드를 끌어 옮기고, 키보드로도 옮겨 보기",
      column: "todo",
      order: 1,
      detail: "스페이스로 들고 화살표로 옮겨요",
    },
  ]);
});

test("the board widget's calls move, add and reorder change the same board the model tools change", async () => {
  const loaded = await loadExtension(space(), EXTENSION);
  const { thread } = loaded;
  expect(
    await callMethod(loaded, thread, "move", { id: "card-1", column: "doing", index: 1 }),
  ).toEqual({
    ok: true,
  });
  expect(await callMethod(loaded, thread, "add", { column: "done", title: "다섯째" })).toEqual({
    ok: true,
  });
  expect(columnsOf(await callMethod(loaded, thread, "board", {}))).toEqual({
    todo: ["card-2"],
    doing: ["card-3", "card-1"],
    done: ["card-4", "card-5"],
  });
  await callTool(loaded, thread, "kanban_native_add_card", { title: "여섯째", tag: "모델" });
  expect(await callMethod(loaded, thread, "reorder", { id: "card-6", index: 0 })).toEqual({
    ok: true,
  });
  await callTool(loaded, thread, "kanban_native_move_card", {
    id: "card-4",
    column: "todo",
    index: 9,
  });
  expect(columnsOf(await callMethod(loaded, thread, "board", {}))).toEqual({
    todo: ["card-6", "card-2", "card-4"],
    doing: ["card-3", "card-1"],
    done: ["card-5"],
  });
});

test("a move of an unknown card answers { ok: false }, params of the wrong shape are refused, and the board stays", async () => {
  const loaded = await loadExtension(space(), EXTENSION);
  const { thread } = loaded;
  expect(
    await callMethod(loaded, thread, "move", { id: "card-99", column: "done", index: 0 }),
  ).toEqual({
    ok: false,
    reason: "not_found",
  });
  // 매니페스트의 params 스키마에 맞지 않는 호출은 엔진이 처리기에 닿기 전에 거절한다
  const outcome = await loaded.t.host.methods.call({
    extension: EXTENSION,
    verb: "add",
    params: { title: "열 없음" },
    threadId: thread,
    signal: new AbortController().signal,
    caller: "ui",
  });
  expect(outcome.kind).toBe("params_invalid");
  expect(columnsOf(await callMethod(loaded, thread, "board", {}))).toEqual({
    todo: ["card-1", "card-2"],
    doing: ["card-3"],
    done: ["card-4"],
  });
});
