// 출처 배지(ADR-0022 §3.3). 범위 배지(전역 · 프로젝트 · 이 대화, 관리 · 로컬 · 기본값)와 설치 등급 배지(내장 · 사용자 설치 · 이 프로젝트 · 관리자).
// 값은 `@fresnel/client/workbench`의 `SourceScope`와 `ExtListEntry.origin`에서 온다. 글은 caustic `Badge`로 보이고 색만으로 뜻을 전하지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { SourceScope } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Badge } from "@caustic/react";
import type { ReactNode } from "react";
import { originText } from "./trust-dialog.tsx";

const SCOPE_TEXT: Readonly<Record<SourceScope, MessageId>> = {
  global: "desktop.workbench.scope.global",
  project: "desktop.workbench.scope.project",
  thread: "desktop.workbench.scope.thread",
  managed: "desktop.workbench.scope.managed",
  local: "desktop.workbench.scope.local",
  default: "desktop.workbench.scope.default",
};

/** 범위 배지. 어느 층이 값을 정했는지 글로 보인다 */
export function ScopeBadge(props: { readonly scope: SourceScope }): ReactNode {
  return <Badge size="sm">{t(SCOPE_TEXT[props.scope])}</Badge>;
}

/** 설치 등급 배지. 확장이 실린 위치(`ExtListEntry.origin`)의 글이다 */
export function OriginBadge(props: {
  readonly origin: NonNullable<ExtListEntry["origin"]>;
}): ReactNode {
  return <Badge size="sm">{originText(props.origin)}</Badge>;
}
