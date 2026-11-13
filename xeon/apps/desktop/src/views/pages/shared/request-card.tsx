import { useId, type ReactNode } from "react";
import { AttendGlow, AttentionMark } from "../../effects/attention-mark.tsx";

// 요청 카드(DP-191). 사용자의 확인을 기다리는 요청 하나를 한 줄 카드로 보인다: 주의 표시 · 머리말 · 제목 … 오른쪽 끝 동작.
// 받은 요청 맨 위 "제안" 카드가 쓴다. 승인 카드(approval-card)와 같은 틀(반경 xl, 바탕 surface.base, 1px border-subtle)에
// 주의 면(위 변 빛 + 안쪽 오로라)이 깔린다. 안쪽 위아래 12·좌우 16, 동작 단추는 폼 표준 sm(28)이라 카드 높이는 52다.
// 머리말은 13/500 secondary, 제목은 13/400 primary로 한 줄에 잇고 넘치면 말줄임한다.

export function RequestCard(props: {
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
      aria-labelledby={labelId}
      className="fx-attend-card flex min-w-0 items-center gap-3 rounded-xl bg-surface-base py-3 ps-4 pe-3 text-ui shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      <AttendGlow pending />
      <AttentionMark />
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
