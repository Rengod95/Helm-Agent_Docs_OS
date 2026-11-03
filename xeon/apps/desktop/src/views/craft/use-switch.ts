// 켜기·끄기 한 번을 보낸다. 보내는 동안은 스위치를 막고, 거부되면 원인을 상태에 담아 화면이 문구로 알린다.
// 거부를 조용히 지우지 않는다(TY-25): 원인은 `failure.cause`에 그대로 있다.
import { toggleTargets } from "@fresnel/client/workbench/canvas";
import { attemptAsync, detach, rethrow, type Thrown } from "@fresnel/contracts";
import { useCallback, useState } from "react";
import { useCraft } from "./craft-context.tsx";

export interface SwitchState {
  /** 보내는 중인 대상 id(없으면 null). 스위치는 이 동안 모두 막힌다 */
  readonly pending: string | null;
  /** 마지막 한 번이 거부됐으면 그 원인 */
  readonly failure: Thrown | null;
  /** 대상 id의 스위치를 on으로. 그룹에 속하면 그룹 전체가 바뀐다(toggleTargets, 결정 15-1) */
  readonly set: (id: string, on: boolean) => void;
}

export function useSwitch(): SwitchState {
  const { source } = useCraft();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Thrown | null>(null);

  const set = useCallback(
    (id: string, on: boolean) => {
      const ids = toggleTargets(source.snapshot, id);
      const run = async (): Promise<void> => {
        setPending(id);
        setFailure(null);
        const r = await attemptAsync(() => source.setOn(ids, on));
        setPending(null);
        if (!r.ok) setFailure(r.error);
      };
      detach(run(), rethrow);
    },
    [source],
  );

  return { pending, failure, set };
}
