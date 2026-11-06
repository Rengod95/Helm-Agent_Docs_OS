// 범위 글과 범위 배지(ADR-0022 §3.3). 범위(전역 · 프로젝트 · 이 대화, 관리 · 로컬 · 기본값)는 설정 행마다 배지 하나로 보인다.
// 확장 상세 머리에서는 배지 대신 상태 글 뒤에 같은 글을 잇는다(시안 머리 줄에는 배지를 두지 않는다, DP-36).
// 값은 `@fresnel/client/workbench`의 `SourceScope`에서 온다. 글은 caustic `Badge`로 보이고 색만으로 뜻을 전하지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { SourceScope } from "@fresnel/client/workbench";
import { Badge } from "@caustic/react";
import type { ReactNode } from "react";

const SCOPE_TEXT: Readonly<Record<SourceScope, MessageId>> = {
  global: "desktop.workbench.scope.global",
  project: "desktop.workbench.scope.project",
  thread: "desktop.workbench.scope.thread",
  managed: "desktop.workbench.scope.managed",
  local: "desktop.workbench.scope.local",
  default: "desktop.workbench.scope.default",
};

/** 범위의 글. 어느 층이 값을 정했는지 글로 보인다 */
export const scopeText = (scope: SourceScope): string => t(SCOPE_TEXT[scope]);

/** 범위 배지. 설정 행마다 하나(c02 시안과 같은 연한 중립 배지) */
export function ScopeBadge(props: { readonly scope: SourceScope }): ReactNode {
  return (
    <Badge size="sm" variant="soft">
      {scopeText(props.scope)}
    </Badge>
  );
}
