// 내비 "리뷰" 줄의 대기 수(craft-flows 3.2 "대기 수 배지"). 받은 요청의 크리스탈 표시(AGE-53)가 이 브랜치에 없어
// 셸의 기본 숫자 배지 자리(`ScreenDef.Badge`)에 수만 넘긴다. 크리스탈 부품이 들어오면 그 부품이 이 수를 그린다.
// 리뷰 항목은 턴을 멈추지 않으므로 받은 요청 패널의 승인 대기열에는 넣지 않는다 [제안].
import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { pendingOf } from "./review-model.ts";

export function ReviewBadge(props: {
  readonly render: (count: number | undefined) => ReactNode;
}): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let live = true;
    const run = async (): Promise<void> => {
      const listed = await commands.pluginReview.list();
      if (live) setCount(listed.ok ? pendingOf(listed.value.items).length : undefined);
    };
    const read = (): void => {
      detach(run(), rethrow);
    };
    read();
    const off = commands.pluginReview.onChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [commands, phase]);
  // 끊긴 동안에는 지난 수를 보이지 않는다
  return props.render(phase === "live" ? count : undefined);
}
