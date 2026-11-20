// 내비 "리뷰" 줄의 대기 수와 크리스탈 표시(craft-flows 3.2 "대기 수 배지", DP-223 크리스탈 표시).
// 수는 연결이 살아 있을 때만 `pluginReview.list`의 대기 항목을 센다(끊긴 동안 지난 수를 보이지 않는다). 셸의 숫자 배지 자리
// (`ScreenDef.Badge`)가 이 부품으로 수를 읽고, 같은 줄의 표시 자리(`ScreenDef.Mark`)는 같은 수를 문맥으로 받아 크리스탈을 그린다:
// 요청을 한 번만 보내고 두 자리가 어긋나지 않는다. 크리스탈은 대화 영역의 "제안" 줄과 같은 규칙이다: 내 확인을 기다리는 것이 있을 때만
// 보이고, 한 영역의 내비에서 한 줄만 단다(Craft에서는 이 줄). 리뷰 항목은 턴을 멈추지 않으므로 받은 요청 패널의 승인 대기열에는
// 넣지 않는다 [제안].
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { CrystalMark } from "../../effects/crystal-mark.tsx";
import { pendingOf } from "./review-model.ts";

const PendingCount = createContext<number | undefined>(undefined);

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
  const shown = phase === "live" ? count : undefined;
  return <PendingCount value={shown}>{props.render(shown)}</PendingCount>;
}

/** 내비 줄 끝(수 앞)의 크리스탈. 기다리는 리뷰가 있을 때만 보인다. 낭독 이름은 기다리는 수다 */
export function ReviewMark(): ReactNode {
  const count = use(PendingCount) ?? 0;
  return (
    <CrystalMark
      present={count > 0}
      count={count}
      size={14}
      label={t("desktop.craft.review.mark", { count })}
    />
  );
}
