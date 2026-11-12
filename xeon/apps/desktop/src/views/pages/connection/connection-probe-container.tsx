import { sshTargetOfAddress, type TargetEntry } from "@fresnel/client";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { useReducer } from "react";
import type { PreflightOutcome } from "../../../transport/ipc.ts";
import { useCommands, type ConnectionCommands } from "../../commands.ts";
import {
  PROBE_IDLE,
  probeReducer,
  type ProbeAction,
  type ProbeRunArgs,
  type RowProbe,
} from "./connection-probe-model.ts";

// 연결 시험의 명령 쪽: 사전 점검(SSH)과 주소 시험을 돌려 결과를 `connection-probe-model.ts`의 상태로 넘긴다. "컴퓨터 추가"
// wizard(`add-computer-dialog.tsx`)와 저장된 컴퓨터 카드의 시험이 함께 쓴다. 카드의 시험 상태는 한 번에 한 장만 쓰므로
// 화면(`connection-screen.tsx`)이 `useRowProbe`로 든다.

/** 사전 점검이 통과했을 때의 답 */
export type PreflightPassed = Extract<PreflightOutcome, { readonly ok: true }>;

/** 사전 점검을 돌린다. 단계는 `dispatch`로 받고, 통과하면 그 답(저장할 주소, 버전, 걸린 시간)을 돌려준다. 멈추거나 실패하면 `null`이다 */
export async function runPreflight(
  connection: ConnectionCommands,
  target: string,
  args: ProbeRunArgs,
  dispatch: (action: ProbeAction) => void,
): Promise<PreflightPassed | null> {
  const outcome = await connection.preflight({ target, ...args }, (event) => {
    dispatch({ type: "step", event });
  });
  if (!outcome.ok) {
    dispatch({ type: "failed" });
    return null;
  }
  if (!outcome.value.ok) {
    dispatch({ type: "stopped", outcome: outcome.value });
    return null;
  }
  dispatch({ type: "finished" });
  return outcome.value;
}

/** 주소 시험(wss, unix)을 한 번 돌린다 */
async function testAddress(
  connection: ConnectionCommands,
  address: string,
  dispatch: (action: ProbeAction) => void,
): Promise<void> {
  const tested = await connection.testTarget(address);
  if (!tested.ok) {
    dispatch({ type: "failed" });
    return;
  }
  dispatch({ type: "tested", outcome: tested.value });
}

type RowAction =
  | { readonly type: "begin"; readonly id: string }
  | { readonly type: "probe"; readonly action: ProbeAction };

function rowProbeReducer(state: RowProbe | null, action: RowAction): RowProbe | null {
  switch (action.type) {
    case "begin":
      return { id: action.id, probe: probeReducer(PROBE_IDLE, { type: "begin" }) };
    case "probe":
      return state === null ? null : { ...state, probe: probeReducer(state.probe, action.action) };
    default:
      return assertNever(action, "RowAction");
  }
}

/** 저장된 호스트 줄의 시험 상태와 시작 함수. 한 번에 한 줄만 돈다 */
export interface RowProbeHandle {
  readonly row: RowProbe | null;
  readonly run: (entry: TargetEntry, args?: ProbeRunArgs) => void;
}

/**
 * 저장된 호스트 줄의 "연결 시험". ssh 주소는 사전 점검(단계 줄을 줄 아래에 펼친다), 그 밖의 주소는 주소 시험이다.
 * 진행 중이면 새 시험을 시작하지 않는다. `args`는 호스트 키 확인 뒤 다시 돌릴 때만 준다.
 */
export function useRowProbe(): RowProbeHandle {
  const connection = useCommands().connection;
  const [row, dispatchRow] = useReducer(rowProbeReducer, null);
  const dispatch = (action: ProbeAction): void => {
    dispatchRow({ type: "probe", action });
  };
  const run = (entry: TargetEntry, args: ProbeRunArgs = {}): void => {
    if (row?.probe.busy === true) return;
    dispatchRow({ type: "begin", id: entry.id });
    const target = sshTargetOfAddress(entry.address);
    detach(
      target === null
        ? testAddress(connection, entry.address, dispatch)
        : runPreflight(connection, target, args, dispatch).then(() => undefined),
      rethrow,
    );
  };
  return { row, run };
}
