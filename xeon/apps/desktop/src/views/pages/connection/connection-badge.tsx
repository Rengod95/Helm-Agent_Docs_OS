import { Badge } from "@caustic/react";
import type { ReactNode } from "react";

// 연결 화면의 상태 배지(글자와 점). 대상 줄과 서버 모드 섹션이 같이 쓴다. 색 계열마다 글자가 뜻을 함께 든다.

/** 상태 배지의 색 계열 */
export type StatusTone = "info" | "danger" | "neutral" | "success";

/** caustic `Badge`의 `tone`은 쓰지 않고 토큰 클래스와 점으로 입힌다(글자가 뜻을 함께 든다) */
const BADGE_CLASS: Readonly<Record<StatusTone, { readonly soft: string; readonly dot: string }>> = {
  info: { soft: "bg-info-soft text-info-text", dot: "bg-info-graphic" },
  danger: { soft: "bg-danger-soft text-danger-text", dot: "bg-danger-graphic" },
  neutral: { soft: "bg-neutral-track text-text-secondary", dot: "bg-neutral-graphic" },
  success: { soft: "bg-success-soft text-success-text", dot: "bg-success-graphic" },
};

export function StatusBadge(props: {
  readonly tone: StatusTone;
  readonly children: ReactNode;
}): ReactNode {
  const { tone, children } = props;
  return (
    <Badge size="xs" className={BADGE_CLASS[tone].soft}>
      <span aria-hidden className={`size-1.5 rounded-full ${BADGE_CLASS[tone].dot}`} />
      {children}
    </Badge>
  );
}
