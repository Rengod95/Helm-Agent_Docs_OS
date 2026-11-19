import { useId, type ReactNode } from "react";
import { AttendGlow } from "../../effects/attention-mark.tsx";
import { CrystalMark } from "../../effects/crystal-mark.tsx";

// 요청 카드(DP-191). 사용자의 확인을 기다리는 요청 하나를 한 줄 카드로 보인다: 크리스탈 표시 · 머리말 · 제목 … 오른쪽 끝 동작.
// 머리 표시는 크리스탈 20(DP-223, 요청 그림 DP-210을 바꿈): 쉴 때는 멈춰 있고, 수가 바뀌거나 카드를 가리키거나 누를 때만 짧게 움직인다.
// 요청의 종류는 머리말 글이 말한다.
// 받은 요청 맨 위 "제안" 카드가 쓴다. 승인 카드(approval-card)와 같은 틀(반경 xl, 바탕 surface.base, 1px border-subtle)에
// 주의 면(위 변 빛 + 안쪽 오로라)이 깔린다. 안쪽 위아래 12·좌우 16, 동작 단추는 폼 표준 sm(28)이라 카드 높이는 52다.
// 머리말은 13/500 secondary, 제목은 13/400 primary로 한 줄에 잇고 넘치면 말줄임한다.

export function RequestCard(props: {
  /** 기다리는 수(크리스탈 표시의 수 바뀜 모션과 낭독 이름) */
  readonly count: number;
  /** 크리스탈 표시의 낭독 이름(무엇이 몇 개 기다리는지) */
  readonly markLabel: string;
  /** 요청 종류(예: "제안"). 제목 앞에 " · "로 잇는다 */
  readonly lead: string;
  readonly title: string;
  /** 오른쪽 끝 동작(caustic Button size="sm") */
  readonly action: ReactNode;
}): ReactNode {
  const labelId = useId();
  return (
    <section
      data-slot="request-card"
      data-crystal-host=""
      aria-labelledby={labelId}
      className="fx-attend-card flex min-w-0 items-center gap-3 rounded-xl bg-surface-base py-3 ps-4 pe-3 text-ui shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      {/* 면의 빛깔은 머리의 크리스탈과 같은 오로라 계열이다(DP-223, lcMk2) */}
      <AttendGlow pending />
      <CrystalMark present count={props.count} size={20} label={props.markLabel} />
      <p id={labelId} className="m-0 min-w-0 flex-1 truncate" title={props.title}>
        <span className="font-medium text-text-secondary">{props.lead}</span>
        <span aria-hidden className="text-text-tertiary">
          {" · "}
        </span>
        <span className="text-text-primary">{props.title}</span>
      </p>
      <span className="flex shrink-0 items-center">{props.action}</span>
    </section>
  );
}
