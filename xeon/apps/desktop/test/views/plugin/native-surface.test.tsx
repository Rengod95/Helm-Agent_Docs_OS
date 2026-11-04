import { describe, expect, test } from "bun:test";
import {
  createActionRunner,
  type ActionRunner,
  type BridgeBackend,
  type BridgePolicyContext,
} from "@fresnel/client/views/app";
import { createScreenLedger } from "@fresnel/client/views/ledger";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createBridgeBackend } from "../../../src/plugin-ui/backend.ts";
import { policyContextOf } from "../../../src/plugin-ui/policy-context.ts";
import { createConfirmQueue, type ConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import { readTreeOf, treeActionsOf } from "../../../src/views/plugin/native-run.ts";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { NativeSurface, type Loaded } from "../../../src/views/plugin/plugin-view.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { extGetOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { harness, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { emptyPluginUi } from "./support.tsx";

// 선언형 화면의 두 길을 값으로 본다. 읽기: 연결 대역의 `ext.helm.status` → 트리 글. 명령: 버튼 동작 → 확인 줄 → `command.run`.
// 실행기, 백엔드, 확인 줄 큐는 화면이 쓰는 것과 같은 모듈이다. 서버 렌더는 효과를 돌리지 않으므로 그릴 때 자르는 길은 `doc`으로 본다.

const SCREEN_KEY = "helm/phase";
const OPEN_THREAD = thr(1);

/** 단계 칩 하나. 글은 상태 문서의 `phase`에서 온다 */
const PHASE_TREE: UiNode = { type: "Chip", bind: { text: { path: "/status/phase" } } };
const PHASE_ENTRY: ExtUiEntry = uiEntryOf({
  id: "phase",
  placement: "status",
  title: "단계",
  tree: PHASE_TREE,
});

/** 판정 맥락. 시험 입력은 검사를 통과하므로 오류면 시험 입력이 깨진 것이다 */
function contextOf(
  commands: readonly { readonly name: string; readonly origin: string }[],
): BridgePolicyContext {
  const built = policyContextOf({
    get: extGetOf(),
    entry: PHASE_ENTRY,
    openThreadId: OPEN_THREAD,
    commands,
  });
  if (!built.ok) throw new Error(`policy context: ${built.error.kind}`);
  return built.value;
}

/** 백엔드는 열린 대화 하나와 `helm` 확장으로 wire를 부른다 */
function backendOf(
  connection: ReturnType<typeof fakeConnection>,
  context: BridgePolicyContext,
): BridgeBackend {
  return createBridgeBackend({
    connection: () => connection.connection,
    extension: "helm",
    screen: "phase",
    openThreadId: () => OPEN_THREAD,
    policy: () => context,
    snapshot: () => ({
      threadId: OPEN_THREAD,
      threadTitle: undefined,
      connection: "connected",
      locale: "ko-KR",
      theme: "light",
      extension: { enabled: true, trust: "user", safeMode: false },
    }),
    navigate: () => false,
    openExternal: () => Promise.resolve(),
    resize: () => {},
    diagnostic: () => {},
  });
}

/** 화면 실행기. 확인 줄은 `queue`가 맡고, 시간 초과 시계는 시험에서 멈춰 있다 */
function runnerOf(
  backend: BridgeBackend,
  context: BridgePolicyContext,
  queue: ConfirmQueue,
): ActionRunner {
  return createActionRunner({
    screenKey: SCREEN_KEY,
    context: () => context,
    backend,
    ledger: createScreenLedger(),
    clock: { now: () => 0 },
    scheduler: { setTimeout: () => 0, clearTimeout: () => {} },
    confirm: queue.request,
    cancelConfirm: queue.cancel,
    recheck: () => Promise.resolve(context),
    onDisabled: () => {},
  });
}

/** 연결이 보낸 호출 가운데 `command.run`만 */
function commandCallsOf(connection: ReturnType<typeof fakeConnection>): unknown[] {
  return connection.calls.filter((call) => call.method === "command.run");
}

/** 답하기 전에 묶인 일을 끝까지 돌린다. 확인 줄이 답을 받은 뒤의 호출까지 기다린다 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("a status Chip reads its text from the polled status document", () => {
  test("ext.helm.status fills the bound text, and that read is the only extension call", async () => {
    const connection = fakeConnection(
      {},
      { "ext.helm.status": () => Promise.resolve({ phase: "탐색 2/3" }) },
    );
    const context = contextOf([]);
    const runner = runnerOf(backendOf(connection, context), context, createConfirmQueue());
    const resolved = await readTreeOf(runner, context, PHASE_TREE, { locale: "ko-KR", nowMs: 0 });
    expect(resolved?.root).toEqual({ type: "Chip", props: { text: "탐색 2/3" }, children: [] });
    expect(connection.calls).toEqual([
      { method: "ext.helm.status", params: { threadId: OPEN_THREAD } },
    ]);
  });
});

describe("a command button waits for the confirm line", () => {
  const commands = [{ name: "helm-start", origin: "helm" }];

  test("nothing is sent while the line is open, and an allow sends the command once", async () => {
    const connection = fakeConnection({
      "command.run": () =>
        Promise.resolve({ status: "done", name: "helm-start", message: null, result: null }),
    });
    const context = contextOf(commands);
    const queue = createConfirmQueue();
    const runner = runnerOf(backendOf(connection, context), context, queue);
    const actions = treeActionsOf({
      runner,
      context: () => context,
      ledger: createScreenLedger(),
      screenKey: SCREEN_KEY,
      openChat: () => {},
    });

    actions.runCommand("helm-start", {});
    await settle();
    expect(queue.current()?.request).toEqual({
      kind: "command",
      extension: "helm",
      trust: "user",
      action: "/helm-start",
      label: undefined,
      paramsSummary: 'args=""',
      approval: false,
    });
    expect(commandCallsOf(connection)).toEqual([]);

    queue.current()?.answer("allow");
    await settle();
    expect(commandCallsOf(connection)).toEqual([
      { method: "command.run", params: { threadId: OPEN_THREAD, text: "/helm-start" } },
    ]);
    expect(queue.current()).toBeUndefined();
  });

  test("a denial sends nothing and leaves the line empty", async () => {
    const connection = fakeConnection({
      "command.run": () =>
        Promise.resolve({ status: "done", name: "helm-start", message: null, result: null }),
    });
    const context = contextOf(commands);
    const queue = createConfirmQueue();
    const runner = runnerOf(backendOf(connection, context), context, queue);
    const actions = treeActionsOf({
      runner,
      context: () => context,
      ledger: createScreenLedger(),
      screenKey: SCREEN_KEY,
      openChat: () => {},
    });

    actions.runCommand("helm-start", {});
    await settle();
    expect(queue.current()?.request.action).toEqual("/helm-start");
    queue.current()?.answer("deny");
    await settle();
    expect(commandCallsOf(connection)).toEqual([]);
    expect(queue.current()).toBeUndefined();
  });

  test("a command the extension did not register never reaches the line", async () => {
    const connection = fakeConnection({});
    const context = contextOf(commands);
    const queue = createConfirmQueue();
    const runner = runnerOf(backendOf(connection, context), context, queue);
    const actions = treeActionsOf({
      runner,
      context: () => context,
      ledger: createScreenLedger(),
      screenKey: SCREEN_KEY,
      openChat: () => {},
    });

    actions.runCommand("someone-else", {});
    await settle();
    expect(queue.current()).toBeUndefined();
    expect(commandCallsOf(connection)).toEqual([]);
  });
});

describe("the surface draws a fixed document on the first render", () => {
  test("a Chip bound to the status document shows its resolved text", () => {
    const connection = fakeConnection({});
    const loaded: Loaded = { connection: connection.connection, context: contextOf([]) };
    const html = renderToString(
      <Providers engine={harness().store.read} ui={createUiStore().read} commands={fakeCommands()}>
        <PluginUiProvider value={emptyPluginUi()}>
          <NativeSurface
            entry={PHASE_ENTRY}
            loaded={loaded}
            doc={{ status: { phase: "탐색 2/3" } }}
            dense
          />
        </PluginUiProvider>
      </Providers>,
    );
    expect(html).toContain("탐색 2/3");
    expect(connection.calls).toEqual([]);
  });
});
