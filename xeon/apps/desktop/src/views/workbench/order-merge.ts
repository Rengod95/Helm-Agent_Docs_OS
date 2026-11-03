// 훅별 핸들러 순서 표를 만든다. 기본 순서는 `hooks.list`, 적용 순서는 `hooks.order.get`이 준다.
import type { HookEntry, HookOrderEntry } from "@fresnel/contracts/wire";

/** 훅 하나의 기본 순서. 디스패치되는 행(tier가 있는 행)만 행 순서대로 잇는다. `order`가 없는 옛 호스트는 `registrations`를 쓴다 */
function defaultOrderOf(hook: HookEntry): readonly string[] {
  if (hook.order === undefined) return hook.registrations;
  return hook.order.filter((row) => row.tier !== null).map((row) => row.registrationId);
}

/** 기본 순서 표를 깔고, 적용 순서가 있는 훅은 그 값으로 덮는다. 적용 값이 엔진이 실제로 디스패치하는 순서다 */
export function orderTableOf(
  hooks: readonly HookEntry[],
  applied: readonly HookOrderEntry[],
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries([
    ...hooks.map((hook): [string, readonly string[]] => [hook.hook, defaultOrderOf(hook)]),
    ...applied.map((entry): [string, readonly string[]] => [entry.hook, entry.applied]),
  ]);
}
