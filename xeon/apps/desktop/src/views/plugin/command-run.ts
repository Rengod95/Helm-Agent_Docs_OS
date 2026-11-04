import { detach, rethrow, type Clock, type Scheduler } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import {
  createActionRunner,
  type ActionRunner,
  type BridgePolicyContext,
} from "@fresnel/client/views/app";
import { useEffect, useState, useSyncExternalStore } from "react";
import { commandEntriesOf } from "../../plugin-ui/placements.ts";
import type { PluginUiRuntime } from "../../plugin-ui/runtime.ts";
import { useSelectedThreadId } from "../../state/ui/index.ts";
import { useCommands } from "../commands.ts";
import type { ConfirmQueue } from "./confirm-host.tsx";
import { runDecided } from "./native-run.ts";
import { usePluginUi, usePluginUiState } from "./plugin-context.tsx";
import { browserClock, browserScheduler } from "./plugin-frame.tsx";
import { createSession, screenKeyOf } from "./plugin-view.tsx";

// 팔레트의 확장 명령(`command` 자리)을 실행한다. 화면 버튼의 명령과 같은 길이다: `decide`(자기 확장이 등록한 명령만), 확인 줄, 쿨다운, 장부.
// 실행기는 확장 명령마다 처음 쓸 때 만들고 App이 사는 동안 둔다. 연속 거부 쿨다운이 실행기 안에 있어서 실행마다 새로 만들면 쿨다운이 없어진다.
// 장부(`view_disabled`)가 끈 화면의 명령은 팔레트에 없고, 실행기도 보내지 않는다(보고 4, ADR-0021 §3.7).

/**
 * 장부가 이 확장 명령의 화면을 `view_disabled`로 껐는가. 화면 키는 `<확장>/<항목 id>`다(명령도 화면 장부를 함께 쓴다)
 */
function viewDisabledOf(runtime: PluginUiRuntime, entry: ExtUiEntry): boolean {
  return runtime.ledger.stateOf(screenKeyOf(entry)).state === "view_disabled";
}

/**
 * 팔레트가 그릴 확장 명령. `commandEntriesOf`가 거른 목록에서 장부가 끈 화면의 명령을 뺀다. 장부가 화면을 끄거나 다시 켜면 다시 그린다
 */
export function usePaletteCommandEntries(): readonly ExtUiEntry[] {
  const { runtime } = usePluginUi();
  const state = usePluginUiState();
  const candidates = commandEntriesOf(state.groups.command, state.inactive);
  // 장부의 변화는 꺼진 화면 키를 한 글로 이은 값으로 받는다. 글이 같으면 다시 그리지 않는다. 서버 렌더도 같은 값을 읽는다
  const disabledKeys = (): string =>
    candidates
      .filter((entry) => viewDisabledOf(runtime, entry))
      .map((entry) => screenKeyOf(entry))
      .join("\n");
  const offKeys = useSyncExternalStore(
    (listener) => runtime.ledger.subscribe(listener),
    disabledKeys,
    disabledKeys,
  );
  const off = new Set(offKeys === "" ? [] : offKeys.split("\n"));
  return candidates.filter((entry) => !off.has(screenKeyOf(entry)));
}

/** 확장 명령 하나의 실행기. 실행할 때마다 대화와 판정 맥락을 새로 넣는다 */
export interface EntryCommandRunner {
  /** 명령 이름을 판정하고 실행한다. 판정이 거부하면 아무것도 보내지 않는다 */
  readonly run: (
    threadId: string | null,
    context: BridgePolicyContext,
    name: string,
  ) => Promise<void>;
  /** 대기 중인 확인을 거부로 끝낸다 */
  readonly dispose: () => void;
}

export function createEntryCommandRunner(options: {
  readonly entry: ExtUiEntry;
  readonly context: BridgePolicyContext;
  readonly threadId: string | null;
  readonly runtime: PluginUiRuntime;
  readonly confirm: ConfirmQueue;
  readonly openExternal: (href: string) => Promise<void>;
  readonly current: () => HostConnection | null;
  readonly showScreen: (screen: "chat" | "settings") => void;
  /** 시계와 타이머. 생략하면 브라우저 것이다(시험은 고정 값을 넣는다) */
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
}): EntryCommandRunner {
  const { entry, runtime, confirm } = options;
  const key = screenKeyOf(entry);
  const session = createSession(
    entry,
    options.context,
    options.threadId,
    options.showScreen,
    options.current,
    runtime,
    options.openExternal,
  );
  const runner: ActionRunner = createActionRunner({
    screenKey: key,
    context: () => session.box.context,
    backend: session.makeBackend(() => {}),
    ledger: runtime.ledger,
    clock: options.clock ?? browserClock,
    scheduler: options.scheduler ?? browserScheduler,
    confirm: confirm.request,
    cancelConfirm: confirm.cancel,
    recheck: session.recheck,
    // 장부가 화면을 껐어도 팔레트에는 그릴 자리가 없다. 화면의 `useDisabled`가 그 상태를 보여 준다
    onDisabled: () => {},
  });
  return {
    async run(threadId, context, name) {
      // 장부가 화면을 껐으면 판정도 보내기도 하지 않는다(팔레트가 숨기지 못한 뒤늦은 실행도 막는다)
      if (viewDisabledOf(runtime, entry)) return;
      session.update(threadId, context);
      const done = await runDecided(runner, context, "command", { name, args: "" });
      if (done.ok) runtime.ledger.succeed(key);
    },
    dispose: () => {
      runner.dispose();
    },
  };
}

/**
 * 팔레트에서 고른 확장 명령을 실행하는 함수를 돌려준다. 명령 항목은 목록에서 찾고, 꺼졌거나 상태가 `ok`가 아니거나
 * 장부가 화면을 `view_disabled`로 껐으면 아무 일도 없다. 열린 대화가 없으면 보내지 않는다. 판정 맥락을 못 읽어도 보내지 않는다
 */
export function usePluginCommandRunner(): (extension: string, id: string) => void {
  const { runtime, confirm, openExternal } = usePluginUi();
  const commands = useCommands();
  const threadId = useSelectedThreadId();
  const [runners] = useState(() => new Map<string, EntryCommandRunner>());
  useEffect(
    () => () => {
      for (const runner of runners.values()) runner.dispose();
      runners.clear();
    },
    [runners],
  );
  return (extension, id) => {
    if (threadId === null) return;
    const state = runtime.getState();
    const entry = commandEntriesOf(state.groups.command, state.inactive).find(
      (item) => item.extension === extension && item.id === id,
    );
    if (entry === undefined || viewDisabledOf(runtime, entry)) return;
    const key = screenKeyOf(entry);
    const run = async (): Promise<void> => {
      const context = await runtime.contextFor(entry, threadId);
      if (!context.ok) return;
      let runner = runners.get(key);
      if (runner === undefined) {
        runner = createEntryCommandRunner({
          entry,
          context: context.value,
          threadId,
          runtime,
          confirm,
          openExternal,
          current: () => commands.pluginUi.current(),
          showScreen: (screen) => {
            commands.showScreen(screen);
          },
        });
        runners.set(key, runner);
      }
      await runner.run(threadId, context.value, entry.id);
    };
    detach(run(), rethrow);
  };
}
