// 크래프트 개요가 읽는 `CraftSource`를 스토어와 명령에서 만든다. 화면은 이 값 하나만 받는다.
// 켜기·끄기는 컨트롤러 요청 경로(`useToggleRequest`)를 거쳐 O-10 확인 대화 상자가 뜬다.
import { extOf, snapshotOf, toggleRequestOf, type WorkbenchState } from "@fresnel/client/workbench";
import type {
  CanvasSnapshot,
  HookOrderPort,
  OrderPortError,
} from "@fresnel/client/workbench/canvas";
import { assertNever, err, type Result } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { TraceTurnResult } from "@fresnel/contracts/extensions";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLatestTurnId, useOpenThreadId } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands, type CommandError, type WorkbenchCommands } from "../commands.ts";
import type { CraftRunEntry, CraftSource } from "../craft/craft-context.tsx";
import { detachVoid, type WorkbenchController } from "./controller.ts";

/** 켜기·끄기 요청. `useToggleRequest`의 `request`가 이 모양이다. 매 렌더 새로 만들어져도 된다 */
export type RequestToggle = (name: string, target: boolean) => void;

/**
 * 크래프트 원천. `request`는 켜기·끄기 확인 경로(`useToggleRequest`)에서 받는다. 원천 객체는 스토어와 명령이 바뀔 때만 새로 만든다.
 * 자세히 보기는 원천 identity가 바뀌면 최근 실행을 다시 읽으므로, `request`가 바뀌어도 원천은 그대로다.
 */
export function useCraftSource(
  controller: WorkbenchController,
  request: RequestToggle,
): CraftSource {
  const commands = useCommands();
  const actions = useWorkbenchActions();
  const entries = useWorkbench((s) => s.entries);
  const details = useWorkbench((s) => s.details);
  const health = useWorkbench((s) => s.health);
  const pending = useWorkbench((s) => s.pending);
  const order = useWorkbench((s) => s.order);
  const threadId = useOpenThreadId();
  const turnId = useLatestTurnId(threadId);

  // 매니페스트 검사(`snapshotOf`)는 목록·자세히·장부가 바뀔 때만 한다. 대기 표시만 바뀌면 덮어쓰기만 다시 한다
  const base = useMemo(() => snapshotOf({ entries, details, health }), [entries, details, health]);
  const snapshot = useMemo(() => withPending(base, pending), [base, pending]);

  // `request`는 렌더마다 새로 만들어지므로 의존성에 넣지 않고 최신 값을 ref로 읽는다
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const setOn = useCallback(
    (ids: readonly string[], on: boolean): Promise<void> => {
      for (const name of namesToToggle(actions.snapshot(), ids, on)) {
        requestRef.current(name, on);
      }
      // 요청은 기다리지 않는다(확인 대화 상자가 끼어들 수 있다). 실패는 컨트롤러가 토스트로 알린다
      return Promise.resolve();
    },
    [actions],
  );

  const openBuilder = useCallback(
    (hook: string | null): void => {
      actions.requestBuilder(hook);
    },
    [actions],
  );

  // 새 턴이 시작되면 턴 id가 바뀌어 원천이 새로 만들어지고, 자세히 보기가 최근 실행을 다시 읽는다
  const recentRuns = useCallback(
    (pluginId: string) => recentRunsOf(commands.workbench, threadId, turnId, pluginId),
    [commands, threadId, turnId],
  );

  // 순서 화면은 포트 identity가 바뀌면 읽기를 다시 한다. 그래서 포트는 명령과 컨트롤러가 바뀔 때만 만든다
  const orderPort = useMemo(
    () =>
      orderPortOf(commands.workbench, () => {
        detachVoid(controller.reloadOrders());
      }),
    [commands, controller],
  );

  return useMemo(
    (): CraftSource => ({ snapshot, order, setOn, orderPort, openBuilder, recentRuns }),
    [snapshot, order, setOn, orderPort, openBuilder, recentRuns],
  );
}

/** 덮어쓰기 대기 표시를 반영한 스냅샷. 대기 중인 확장의 플러그인은 목표 값으로 보인다(낙관적 표시) */
export function withPending(
  snapshot: CanvasSnapshot,
  pending: Readonly<Record<string, boolean>>,
): CanvasSnapshot {
  return {
    ...snapshot,
    plugins: snapshot.plugins.map((plugin) => {
      const target = pending[extOf(plugin.id)];
      return target === undefined ? plugin : { ...plugin, on: target };
    }),
  };
}

/** 고른 id들을 확장 이름으로 모아 이름마다 한 번씩 요청한다. 잠긴 확장과 모르는 확장은 뺀다 */
export function namesToToggle(
  state: WorkbenchState,
  ids: readonly string[],
  on: boolean,
): string[] {
  const names = [...new Set(ids.map(extOf))];
  return names.filter((name) => toggleRequestOf(state, name, on).ok);
}

/** `trace.turn`의 턴 기록을 이 플러그인의 최근 실행 줄로 바꾼다. 계측이 꺼졌거나 링 버퍼에서 밀렸으면 null이다 */
export function runEntriesOf(
  trace: TraceTurnResult,
  pluginId: string,
): readonly CraftRunEntry[] | null {
  if (!trace.traceEnabled || !trace.retained) return null;
  return trace.entries.flatMap((step) =>
    step.handlers
      .filter((handler) => handler.registrationId === pluginId)
      .map((handler): CraftRunEntry => ({
        hook: step.hook,
        registrationId: handler.registrationId,
        ms: handler.ms,
        result: handler.result,
        reason: handler.reason,
      })),
  );
}

/**
 * 열린 대화의 턴 하나를 읽어 이 플러그인의 최근 실행을 준다. 대화나 턴 id가 없으면 읽을 것이 없으니 null이다.
 * 명령이 실패하면 거부한다(`loadRuns`가 읽기 실패로 보인다). null과 거부는 뜻이 다르다: null은 계측 잠김이다.
 */
export async function recentRunsOf(
  workbench: Pick<WorkbenchCommands, "trace">,
  threadId: ThreadId | null,
  turnId: TurnId | null,
  pluginId: string,
): Promise<readonly CraftRunEntry[] | null> {
  if (threadId === null || turnId === null) return null;
  const got = await workbench.trace(threadId, turnId);
  if (!got.ok) throw commandFailure(got.error);
  return runEntriesOf(got.value, pluginId);
}

/**
 * 순서 포트: 순서 호출 넷을 `commands.workbench`에 잇는다. 명령의 `err`는 포트의 `OrderPortError` 값으로 옮겨 돌려주고 던지지 않는다.
 * 쓰기가 성공했을 때만 `afterWrite`를 부른다.
 */
export function orderPortOf(workbench: WorkbenchCommands, afterWrite: () => void): HookOrderPort {
  return {
    get: () => fromCommand(workbench.orderGet()),
    set: async (params) => {
      const saved = await fromCommand(workbench.orderSet(params.hook, params.order));
      if (saved.ok) afterWrite();
      return saved;
    },
    reset: async (params) => {
      const done = await fromCommand(workbench.orderReset(params.hook));
      if (done.ok) afterWrite();
      return done;
    },
    preview: (params) => fromCommand(workbench.orderPreview(params.hook, params.order)),
  };
}

/** 명령 결과를 포트 결과로 옮긴다. 성공 값은 그대로, 실패는 `orderErrorOf`로 옮긴다 */
async function fromCommand<T>(
  pending: Promise<Result<T, CommandError>>,
): Promise<Result<T, OrderPortError>> {
  const got = await pending;
  return got.ok ? got : err(orderErrorOf(got.error));
}

/** 명령 실패를 포트 오류로 옮긴다. 종류와 값은 그대로 옮기고, 순서 화면이 쓰지 않는 `locked`의 선택지 목록만 뺀다 */
function orderErrorOf(error: CommandError): OrderPortError {
  switch (error.kind) {
    case "offline":
      return { kind: "offline" };
    case "unsupported":
      return { kind: "unsupported" };
    case "locked":
      return { kind: "locked", ownerKind: error.ownerKind };
    case "rejected":
      return error.detail === undefined
        ? { kind: "rejected", code: error.code }
        : { kind: "rejected", code: error.code, detail: error.detail };
    case "failed":
      return { kind: "failed" };
    case "switching":
      return { kind: "switching" };
    default:
      return assertNever(error, "orderErrorOf");
  }
}

/** 명령 실패를 `Error`로 바꾼다. 원래 값은 `cause`에 남는다 */
export function commandFailure(error: CommandError): Error {
  return new Error(commandErrorText(error), { cause: error });
}

/** 명령 실패의 한 줄 글(데이터다. 화면 문구가 아니다) */
export function commandErrorText(error: CommandError): string {
  switch (error.kind) {
    case "rejected":
      return `rejected:${String(error.code)}`;
    case "locked":
      return `locked:${error.ownerKind}`;
    case "offline":
    case "unsupported":
    case "failed":
    case "switching":
      return error.kind;
    default:
      return assertNever(error, "commandErrorText");
  }
}
