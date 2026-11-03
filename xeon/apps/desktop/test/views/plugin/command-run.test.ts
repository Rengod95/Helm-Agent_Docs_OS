import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { createPluginUiRuntime, type PluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { createConfirmQueue, type ConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import { createEntryCommandRunner } from "../../../src/views/plugin/command-run.ts";
import { extGetOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { thr } from "../../state/helpers.ts";

// 팔레트 명령의 실행기. 화면의 버튼 명령과 같은 길(`decide`, 확인 줄, 다리 백엔드)을 값으로 본다.
// 확인 줄은 답하기 전까지 `command.run`을 보내지 않고, 허용 한 번에 한 번만 보내며, 거부하면 아무것도 보내지 않는다.

const OPEN_THREAD = thr(1);
const START: ExtUiEntry = uiEntryOf({
  id: "helm-start",
  placement: "command",
  title: "탐구 시작…",
});

/** 연결 대역. 판정 맥락은 `ext.get`과 `command.list`로 만들고, 실행은 `command.run`으로 간다 */
function connectionOf() {
  return fakeConnection({
    "ext.get": () => Promise.resolve(extGetOf()),
    "command.list": () =>
      Promise.resolve({
        commands: [
          {
            name: "helm-start",
            description: "",
            argumentHint: null,
            args: [],
            kind: "action" as const,
            source: "extension" as const,
            origin: "helm",
            hasShell: false,
          },
        ],
      }),
    "command.run": () =>
      Promise.resolve({ status: "done", name: "helm-start", message: null, result: null }),
  });
}

/** 화면 밖 실행에 쓰는 읽기 묶음. 연결 대역을 그대로 물린다 */
function runtimeOf(connection: ReturnType<typeof connectionOf>): PluginUiRuntime {
  return createPluginUiRuntime({
    withConnection: async <T>(run: (c: HostConnection) => Promise<T>) =>
      ok(await run(connection.connection)),
    appRootsInvoke: undefined,
    framesSupported: false,
  });
}

/** 연결이 보낸 호출 가운데 `command.run`만 */
function commandCallsOf(connection: ReturnType<typeof connectionOf>): unknown[] {
  return connection.calls.filter((call) => call.method === "command.run");
}

/** 답하기 전에 묶인 일을 끝까지 돌린다 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function runnerOf(connection: ReturnType<typeof connectionOf>, queue: ConfirmQueue) {
  const runtime = runtimeOf(connection);
  const built = await runtime.contextFor(START, OPEN_THREAD);
  if (!built.ok) throw new Error(`policy context: ${built.error.kind}`);
  const runner = createEntryCommandRunner({
    entry: START,
    context: built.value,
    threadId: OPEN_THREAD,
    runtime,
    confirm: queue,
    current: () => connection.connection,
    showScreen: () => {},
    // 시험은 시계와 타이머를 멈춰 둔다(확인은 답을 받을 때까지 기다린다)
    clock: { now: () => 0 },
    scheduler: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  return { runner, context: built.value };
}

describe("a palette command waits for the confirm line", () => {
  test("nothing is sent while the line is open, and an allow sends the command once", async () => {
    const connection = connectionOf();
    const queue = createConfirmQueue();
    const { runner, context } = await runnerOf(connection, queue);

    const pending = runner.run(OPEN_THREAD, context, "helm-start");
    await settle();
    expect(queue.current()?.request).toEqual({
      extension: "helm",
      trust: "user",
      action: "/helm-start",
      label: undefined,
      paramsSummary: 'args=""',
      approval: false,
    });
    expect(commandCallsOf(connection)).toEqual([]);

    queue.current()?.answer("allow");
    await pending;
    expect(commandCallsOf(connection)).toEqual([
      { method: "command.run", params: { threadId: OPEN_THREAD, text: "/helm-start" } },
    ]);
    expect(queue.current()).toBeUndefined();
  });

  test("a denial sends nothing and leaves the line empty", async () => {
    const connection = connectionOf();
    const queue = createConfirmQueue();
    const { runner, context } = await runnerOf(connection, queue);

    const pending = runner.run(OPEN_THREAD, context, "helm-start");
    await settle();
    expect(queue.current()?.request.action).toEqual("/helm-start");
    queue.current()?.answer("deny");
    await pending;
    expect(commandCallsOf(connection)).toEqual([]);
    expect(queue.current()).toBeUndefined();
  });

  test("a command the extension did not register never reaches the line", async () => {
    const connection = connectionOf();
    const queue = createConfirmQueue();
    const { runner, context } = await runnerOf(connection, queue);

    await runner.run(OPEN_THREAD, context, "someone-else");
    expect(queue.current()).toBeUndefined();
    expect(commandCallsOf(connection)).toEqual([]);
  });
});
