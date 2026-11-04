// 여기가 범위가 들어가는 자리다. project·thread는 변형을 더하고 이 표를 채운다.
// 표는 `CraftScope["kind"]`마다 값을 하나씩 요구하므로(`Record`) 변형을 더하면 이 파일이 컴파일 오류로 알려 준다.
// 단일 변형 유니온의 `switch`는 `no-unnecessary-condition`이 `case`를 항상 참이라고 막아서 표로 썼다.
// 지금은 전역만 있다. 전역은 범위가 없던 때와 같은 인자를 보낸다: 목록은 대화 없이 읽고, 켜기·끄기는 사용자 범위로 쓴다.
// 확장 훅 순서(`hooks.order.*`)와 `trace.turn`은 wire에 범위 칸이 없어서 여기 들어오지 않는다(범위를 더하려면 wire 칸이 먼저 있어야 한다).
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { CraftScope } from "../../state/workbench/index.ts";

/** 범위를 호출 인자로 옮긴 값. 호출하는 쪽은 자기가 쓰는 칸만 읽는다 */
export interface ScopeArg {
  /** `ext.list`의 `threadId`. 전역은 대화 없이 읽으니 `undefined`다 */
  readonly listThreadId: ThreadId | undefined;
  /** 켜기·끄기(`settings.set`)의 `scope`. 전역은 사용자 범위다 */
  readonly settingsScope: "user";
}

const SCOPE_ARG: Readonly<Record<CraftScope["kind"], ScopeArg>> = {
  global: { listThreadId: undefined, settingsScope: "user" },
};

export function scopeArg(scope: CraftScope): ScopeArg {
  return SCOPE_ARG[scope.kind];
}
