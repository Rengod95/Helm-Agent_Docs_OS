// P-17 탭의 읽기 훅. 연결이 살아 있을 때 `load`로 읽고, 확장 목록 알림(`onChanged`)마다 다시 읽는다.
// 값은 키(확장 이름과 대화)와 함께 둔다. 그림의 상태(읽는 중·마지막 값·오프라인·오류)는 `tabReadOf`가 정한다.
import {
  tabReadOf,
  slotOf,
  type TabLink,
  type TabRead,
  type TabSlot,
} from "@fresnel/client/workbench";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import { useEffect, useState } from "react";
import type { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands, type CommandError } from "../commands.ts";
import { reloadOnExtChanges } from "./controller.ts";

/** 엔진 연결 단계를 탭의 연결 상태로 줄인다. 런타임 탭의 `linkOf`와 같은 규칙이다(순환을 피해 여기 둔다) */
export function tabLinkOf(phase: ReturnType<typeof useLinkPhase>): TabLink {
  if (phase === "live") return "live";
  if (phase === "offline" || phase === "failed") return "offline";
  return "pending";
}

/**
 * 연결이 살아 있을 때 `load`로 읽는다. `load`는 호출자가 `useCallback`으로 안정화한다(바뀌면 다시 읽는다).
 * 확장 목록 알림마다 다시 읽고, 키나 연결이 바뀌면 이전 읽기의 결과는 버린다.
 */
export function useTabRead<T>(
  key: string,
  link: TabLink,
  load: () => Promise<Result<T, CommandError>>,
): TabRead<T> {
  const commands = useCommands();
  const [slot, setSlot] = useState<TabSlot<T> | null>(null);
  useEffect(() => {
    if (link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const result = await load();
      if (active) setSlot(slotOf(key, result));
    };
    detach(run(), rethrow);
    const off = reloadOnExtChanges(commands.workbench, run);
    return () => {
      active = false;
      off();
    };
  }, [commands, key, link, load]);
  return tabReadOf(slot, key, link);
}
