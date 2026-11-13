// 상태 줄 전시 화면(시험 전용, 제품 코드가 import하지 않는다). 고정 거울과 명령 대역으로 실제 `StatusBar`를 상태마다 하나씩 그린다(DP-182).
// 줄마다 무대와 같은 바탕(bg.app) 위에 둔다. 주소의 `?theme=dark|light`가 `<html data-theme>`를, `?width=`가 줄 폭(기본 1168)을 정한다.
// 그림이 끝나면 `document.body.dataset.ready = "1"`이다.
import { setActiveLocale } from "@fresnel/client/i18n";
import { detach, ok, rethrow } from "@fresnel/contracts";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { EngineMirror, EngineState } from "../../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createUiStore, type UiState } from "../../../src/state/ui/store.ts";
import type { Commands } from "../../../src/views/commands.ts";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { StatusBar } from "../../../src/views/status-bar.tsx";
import { approvalRequest, evt, harness, STORE, SUB, summary, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../../views/fake-commands.ts";
import { emptyPluginUi } from "../../views/plugin/support.tsx";

setActiveLocale("ko");
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset["theme"] = params.get("theme") === "light" ? "light" : "dark";
const WIDTH = Number(params.get("width") ?? "1168");

const EXIT = { code: 1, signal: null, at: "2026-11-13T00:00:00.000Z" } as const;
const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

/** 엔진 상태와 연결(live 여부), 대화 목록, 승인 수로 거울을 만든다 */
function mirror(options: {
  readonly engine: EngineState;
  readonly live: boolean;
  readonly threads?: readonly ThreadSummary[];
  readonly approvals?: number;
}): EngineMirror {
  const h = harness();
  h.store.ingest({ type: "engine", state: options.engine });
  if (options.live)
    h.store.ingest({
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 5,
      live: true,
      from: "head",
    });
  h.store.ingest({ type: "threads", threads: [...(options.threads ?? [])] });
  const count = options.approvals ?? 0;
  if (count > 0)
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 5 + count,
      caughtUp: true,
      facts: Array.from({ length: count }, (_, i) => ({
        type: "approval.requested" as const,
        seq: 6 + i,
        eventId: evt(6 + i),
        threadId: thr(1),
        turnId: null,
        at: "t",
        request: { ...approvalRequest(thr(1)), approvalId: evt(60 + i) },
      })),
    });
  h.store.flush();
  return h.store.read.getState();
}

/** 대화 고름·원격 대상·연결 실패를 정한 ui 상태 */
function ui(options: {
  readonly thread?: boolean;
  readonly remote?: string;
  readonly connectError?: string;
}): UiState {
  const store = createUiStore();
  if (options.thread === true) store.actions.selectThread(thr(1));
  if (options.remote !== undefined)
    store.actions.setEngineTarget({
      kind: "remote",
      address: "unix:/run/box.sock",
      label: options.remote,
    });
  if (options.connectError !== undefined) store.actions.setConnectError(options.connectError);
  return store.read.getState();
}

/** 샌드박스 켜짐과 문맥 사용량을 정한 명령 대역 */
function commands(options: { readonly sandboxOff?: boolean; readonly context?: number }): Commands {
  const base = fakeCommands();
  const used = options.context;
  return {
    ...base,
    setup: {
      ...base.setup,
      loadSandboxEnabled: () => Promise.resolve(ok(options.sandboxOff !== true)),
    },
    usage: {
      get: () =>
        Promise.resolve(
          ok({
            gauges: [],
            asOf: "2026-11-13T00:00:00.000Z",
            ...(used === undefined
              ? {}
              : { context: { model: "anthropic/claude-sonnet-5-5", used, limit: 200_000 } }),
          }),
        ),
    },
  };
}

interface Scene {
  readonly id: string;
  readonly label: string;
  readonly engine: EngineMirror;
  readonly ui: UiState;
  readonly commands: Commands;
}

/** 열린 대화(thr 1)는 쉬고 다른 대화 n개가 돈다. 문맥 값은 열린 대화가 쉬는 동안 읽힌다 */
const running = (n: number): ThreadSummary[] => [
  summary(thr(1), { status: "idle", title: "열린 대화" }),
  ...Array.from({ length: n }, (_, i) =>
    summary(thr(i + 2), { status: "running", title: `대화 ${String(i + 2)}` }),
  ),
];

const SCENES: readonly Scene[] = [
  {
    id: "idle",
    label: "평소 · 대화 없음(설정·크래프트)",
    engine: mirror({ engine: RUNNING, live: true }),
    ui: ui({}),
    commands: commands({}),
  },
  {
    id: "thread",
    label: "대화 열림 · 문맥 42%",
    engine: mirror({ engine: RUNNING, live: true }),
    ui: ui({ thread: true }),
    commands: commands({ context: 84_000 }),
  },
  {
    id: "busy",
    label: "문맥 86%(요약 가까움) · 진행 중 2 · 승인 대기 1",
    engine: mirror({ engine: RUNNING, live: true, threads: running(2), approvals: 1 }),
    ui: ui({ thread: true }),
    commands: commands({ context: 172_000 }),
  },
  {
    id: "remote-sandbox",
    label: "원격 엔진 · 샌드박스 꺼짐 · 진행 중 1",
    engine: mirror({ engine: RUNNING, live: true, threads: running(1) }),
    ui: ui({ thread: true, remote: "build-box" }),
    commands: commands({ sandboxOff: true, context: 24_000 }),
  },
  {
    id: "starting",
    label: "엔진 시작 중",
    engine: mirror({ engine: { kind: "starting", source: "sidecar", attempt: 0 }, live: false }),
    ui: ui({}),
    commands: commands({}),
  },
  {
    id: "link-failed",
    label: "연결 복구 실패",
    engine: mirror({ engine: RUNNING, live: false }),
    ui: ui({ connectError: "hello:1002" }),
    commands: commands({}),
  },
  {
    id: "engine-failed",
    label: "엔진 시작 실패",
    engine: mirror({ engine: { kind: "failed", attempts: 3, lastExit: EXIT }, live: false }),
    ui: ui({}),
    commands: commands({}),
  },
];

function Scenes(): ReactNode {
  return (
    <main
      className="grid gap-6 p-6"
      style={{ background: "var(--cs-color-bg-app)", minHeight: "100%" }}
    >
      {SCENES.map((scene) => (
        <section key={scene.id} data-scene={scene.id} className="grid gap-1.5">
          <p className="m-0 text-ui-sm text-text-tertiary">{scene.label}</p>
          <div style={{ width: WIDTH }}>
            <ShellStoreContext value={createShellStore(1440)}>
              <Providers
                engine={frozen(scene.engine)}
                ui={frozen(scene.ui)}
                commands={scene.commands}
              >
                <PluginUiProvider value={emptyPluginUi()}>
                  <StatusBar />
                </PluginUiProvider>
              </Providers>
            </ShellStoreContext>
          </div>
        </section>
      ))}
    </main>
  );
}

async function start(): Promise<void> {
  const host = document.getElementById("root");
  if (host === null) return;
  createRoot(host).render(<Scenes />);
  // 문맥과 샌드박스 값은 그린 뒤 명령으로 읽힌다. 두 프레임 기다린 뒤 준비 표식을 단다
  await new Promise((resolve) => setTimeout(resolve, 400));
  document.body.dataset["ready"] = "1";
}

detach(start(), rethrow);
