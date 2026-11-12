// 도구 묶음·대기 목록 전시 화면(시험 전용, 제품 코드가 import하지 않는다, DP-154·156).
// 주소의 `?scene=done|live`가 장면을, `?theme=dark|light`가 테마를 정한다. done은 쉬는 대화(끝난 묶음 여러 모양 + 멈춘 뒤 대기 목록),
// live는 도는 대화(한 번에 부른 10개 묶음의 일부 실패·일부 실행 중, 모두 실행 중인 묶음, 차례로 도는 묶음 + 끝나면 대기 목록)다.
// 첫 그림이 끝나면 `document.body.dataset.ready = "1"`이다.
import { setActiveLocale } from "@fresnel/client/i18n";
import { detach, ok, rethrow } from "@fresnel/contracts";
import type { ItemRecord, JsonObject } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { EMPTY_THREAD_CONVO } from "../../../src/state/engine/convo.ts";
import {
  useTranscriptShapes,
  type EngineMirror,
  type QueuedInput,
} from "../../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { TranscriptRowView } from "../../../src/views/item-view.tsx";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import {
  PluginUiProvider,
  type PluginUiContextValue,
} from "../../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { QueuedInputs } from "../../../src/views/queued-inputs.tsx";
import { transcriptRowsOf } from "../../../src/views/transcript-rows.ts";
import { extGetOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { evt, itm, openedHarness, recorded, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../../views/fake-commands.ts";

setActiveLocale("ko");
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset["theme"] = params.get("theme") === "light" ? "light" : "dark";
const live = params.get("scene") === "live";

const THREAD = thr(1);
const T0 = Date.parse("2026-11-12T05:00:00.000Z");

type Block = Extract<ItemRecord, { kind: "assistant" }>["message"]["content"][number];
const call = (id: string, name: string, args: JsonObject): Block => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

function user(n: number, content: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "user",
    message: { role: "user", content, timestamp: T0 + n * 1000 },
    requestId: null,
  };
}

function assistant(n: number, content: readonly Block[]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    partIds: [],
    message: {
      role: "assistant",
      content: [...content],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: T0 + n * 1000,
    },
  };
}

function result(
  n: number,
  callId: string,
  toolName: string,
  body: string,
  error = false,
): ItemRecord {
  return {
    itemId: itm(n),
    status: error ? "failed" : "completed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName,
      content: [{ type: "text", text: body }],
      isError: error,
      timestamp: T0 + n * 1000,
    },
  };
}

const say = (n: number, value: string): ItemRecord => assistant(n, [{ type: "text", text: value }]);

/** 모델이 한 번에 부른 10개(사용자 캡처 1112c-1과 같은 모양) */
const TEN: readonly Block[] = [
  call("p1", "read", { path: "/Users/user/Downloads", offset: 1, limit: 5 }),
  call("p2", "bash", { command: "date -u && uname -a && whoami" }),
  call("p3", "web_fetch", { url: "https://example.com" }),
  call("p4", "grep", { pattern: "helm" }),
  call("p5", "mcp_servers", {}),
  call("p6", "mcp_list_resources", {}),
  call("p7", "ls", { path: "src" }),
  call("p8", "find", { pattern: "*.md" }),
  call("p9", "mcp__github__list_issues", { repo: "acme/web", state: "open" }),
  call("p10", "web_search", { query: "fresnel optics" }),
];

function tenResults(base: number, upTo: number): ItemRecord[] {
  const bodies: readonly [string, string, string, boolean][] = [
    ["p1", "read", "/Users/user/Downloads is a directory. Use ls to list it.", true],
    ["p2", "bash", 'Tool "bash" changes state and is not allowed in plan mode.', true],
    ["p3", "web_fetch", "Example Domain", false],
    ["p4", "grep", "3 matches", false],
    ["p7", "ls", "app.ts\nmodel.ts", false],
    ["p8", "find", "README.md", false],
    ["p5", "mcp_servers", "github: connected, 12 tools", false],
    ["p6", "mcp_list_resources", "(none)", false],
    ["p9", "mcp__github__list_issues", "2 issues", false],
    ["p10", "web_search", "5 results", false],
  ];
  return bodies
    .slice(0, upTo)
    .map(([id, name, body, error], i) => result(base + i, id, name, body, error));
}

function items(): ItemRecord[] {
  const list: ItemRecord[] = [
    user(1, "src/app.ts만 읽어 줘"),
    assistant(2, [call("s1", "read", { path: "src/app.ts" })]),
    result(3, "s1", "read", "export const app = 1;"),
    say(4, "한 파일만 읽었어요."),
    user(5, "세 군데를 한 번에 봐 줘"),
    assistant(6, [
      call("a1", "read", { path: "src/app.ts" }),
      call("a2", "grep", { pattern: "validateLogin" }),
      call("a3", "bash", { command: "bun test auth" }),
    ]),
    result(7, "a1", "read", "export const app = 1;"),
    result(8, "a2", "grep", "2 matches"),
    result(9, "a3", "bash", "12 pass"),
    say(10, "셋 다 끝났어요."),
    user(11, "네 군데를 한 번에, 하나는 실패해도 돼"),
    assistant(12, [
      call("b1", "read", { path: "docs/guide.md" }),
      call("b2", "read", { path: "docs/missing.md" }),
      call("b3", "web_search", { query: "login ux" }),
      call("b4", "mcp__docs__search_pages", { query: "password policy" }),
    ]),
    result(13, "b1", "read", "# Guide"),
    result(14, "b2", "read", "ENOENT: no such file or directory, open 'docs/missing.md'", true),
    result(15, "b3", "web_search", "5 results"),
    result(16, "b4", "mcp__docs__search_pages", "2 pages"),
    say(17, "하나만 실패했어요."),
    user(18, "차례로 확인해 줘"),
    assistant(19, [call("q1", "ls", { path: "src" })]),
    result(20, "q1", "ls", "app.ts"),
    assistant(21, [call("q2", "read", { path: "src/app.ts" })]),
    result(22, "q2", "read", "export const app = 1;"),
    assistant(23, [call("q3", "bash", { command: "bun run lint" })]),
    result(24, "q3", "bash", "error: 3 problems\n  src/app.ts:1", true),
    say(25, "린트가 실패했어요."),
    user(26, "10가지 도구를 한 번에 불러 봐"),
    assistant(27, TEN),
  ];
  if (!live) {
    list.push(...tenResults(28, 10), say(40, "끝났어요. 두 개가 실패했어요."));
    return list;
  }
  list.push(...tenResults(28, 6));
  return list;
}

function liveTail(): ItemRecord[] {
  return [
    say(50, "이어서 세 가지를 한 번에 볼게요."),
    assistant(51, [
      call("r1", "read", { path: "src/a.ts" }),
      call("r2", "read", { path: "src/b.ts" }),
      call("r3", "bash", { command: "bun test" }),
    ]),
  ];
}

function queued(): QueuedInput[] {
  return [
    {
      inputId: evt(901),
      threadId: THREAD,
      requestId: "q-user",
      mode: "followUp",
      sourceType: "user",
      preview: { kind: "text", text: "그다음 README도 고쳐 줘" },
    },
    {
      inputId: evt(902),
      threadId: THREAD,
      requestId: "q-helm",
      mode: "next",
      sourceType: "extension",
      preview: { kind: "label", labelKey: "helm" },
    },
  ];
}

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function mirror(): EngineMirror {
  const h = openedHarness(5, THREAD);
  // 도는 줄이 "중단됨"이 되지 않게 엔진이 살아 있다고 둔다
  h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
  const all = live ? [...items(), ...liveTail()] : items();
  const facts = all.map((item, i) => recorded(10 + i, item, THREAD));
  h.store.ingest({ type: "batch", sub: "s1", from: 5, to: 400, caughtUp: true, facts });
  h.store.flush();
  const state = h.store.read.getState();
  const summary: ThreadSummary = {
    threadId: THREAD,
    title: "도구 묶음",
    status: live ? "running" : "idle",
    workspace: null,
    createdAt: "2026-11-12T05:00:00.000Z",
    updatedAt: "2026-11-12T05:00:00.000Z",
    headSeq: 400,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 2,
    pendingApprovals: 0,
  };
  const threads: EngineMirror["threads"] = {
    status: "ready",
    ids: [THREAD],
    byId: { [THREAD]: summary },
  };
  return {
    ...state,
    threads,
    queuedInputs: queued(),
    convo: { ...state.convo, [THREAD]: EMPTY_THREAD_CONVO },
  } satisfies EngineMirror;
}

function Page(): ReactNode {
  const shapes = useTranscriptShapes();
  const rows = useMemo(
    () =>
      transcriptRowsOf({
        shapes,
        live: [],
        showLive: true,
        anchors: [],
        turns: [],
        markers: [],
        leads: [],
        running: live,
      }),
    [shapes],
  );
  return (
    <main
      data-showcase="batch"
      style={{
        height: "100%",
        overflowY: "auto",
        paddingBlock: 32,
        background: "var(--cs-color-surface-base)",
      }}
    >
      {rows.map((row) => (
        <TranscriptRowView key={row.key} threadId={THREAD} row={row} unsentId={null} />
      ))}
      <div className="mx-auto mt-6 w-full max-w-184 px-3" data-showcase-queue>
        <QueuedInputs
          threadId={THREAD}
          disabledReason={null}
          steerable={() => true}
          onSteerNow={() => Promise.resolve({ status: "idle" })}
        />
      </div>
    </main>
  );
}

/** 확장 화면이 없는 플러그인 문맥(줄 부품이 문맥을 요구한다) */
async function pluginUi(): Promise<PluginUiContextValue> {
  const fake = fakeConnection({
    "ext.ui.list": () => Promise.resolve({ items: [] }),
    "ext.list": () => Promise.resolve({ extensions: [] }),
    "ext.get": () => Promise.resolve(extGetOf()),
    "settings.get": () => Promise.resolve({ settings: [] }),
  });
  const runtime = createPluginUiRuntime({
    withConnection: async (run) => ok(await run(fake.connection)),
    appRootsInvoke: undefined,
    framesSupported: false,
  });
  await runtime.refresh();
  return { runtime, confirm: createConfirmQueue(), openExternal: () => Promise.resolve() };
}

async function start(): Promise<void> {
  const plugin = await pluginUi();
  const host = document.getElementById("root");
  if (host === null) return;
  createRoot(host).render(
    <ShellStoreContext value={createShellStore(1440)}>
      <Providers engine={frozen(mirror())} ui={createUiStore().read} commands={fakeCommands()}>
        <PluginUiProvider value={plugin}>
          <Page />
        </PluginUiProvider>
      </Providers>
    </ShellStoreContext>,
  );
  requestAnimationFrame(() => {
    document.body.dataset["ready"] = "1";
  });
}

detach(start(), rethrow);
