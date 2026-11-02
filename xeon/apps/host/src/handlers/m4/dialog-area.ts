import type { WireHandlers } from "@fresnel/contracts/wire";
import { notImplemented } from "../not-implemented.ts";

// 대화 영역 wire. 처리기는 T-WC가 채운다.
// T-F가 `notImplemented`로 채워 둔 기본 처리기다(`spec-deltas/t-f.md` §5). 소유 트랙(T-WC)이 이 파일과
// `assembly/m4/dialog-area-port.ts`만 고쳐서 채운다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 처음에는 메서드가 없다. T-WC가 메서드를 더한다 */
export type DialogAreaPort = Readonly<Record<string, never>>;

export type DialogAreaMethods =
  | "review.get"
  | "goal.status"
  | "work.tasks.list"
  | "schedule.update"
  | "schedule.runs";

export function createDialogAreaHandlers(
  _port: DialogAreaPort,
): Pick<WireHandlers, DialogAreaMethods> {
  return {
    "review.get": notImplemented("review.get"),
    "goal.status": notImplemented("goal.status"),
    "work.tasks.list": notImplemented("work.tasks.list"),
    "schedule.update": notImplemented("schedule.update"),
    "schedule.runs": notImplemented("schedule.runs"),
  };
}
