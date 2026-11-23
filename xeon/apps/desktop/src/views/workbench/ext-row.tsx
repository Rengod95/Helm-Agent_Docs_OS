// 확장 상태와 종류의 글, 이름 칸(V-16, §6.21). 런타임 탭과 검사 탭, 대화 스위치 목록이 같이 쓴다.
// 크래프트 목록은 `plugin-list.tsx`가 그린다(켜기 스위치 없음, AGE-74).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtKind, ExtRowVM, ExtState } from "@fresnel/client/workbench";
import type { ReactNode } from "react";

type DotTone = "neutral" | "success" | "warning" | "danger" | "info";

const STATE_TONE: Readonly<Record<ExtState, DotTone>> = {
  on: "success",
  off: "neutral",
  enabling: "info",
  disabling: "info",
  auto_disabled: "danger",
  safe_excluded: "warning",
};

const STATE_TEXT: Readonly<Record<ExtState, MessageId>> = {
  on: "desktop.workbench.state.on",
  off: "desktop.workbench.state.off",
  enabling: "desktop.workbench.state.enabling",
  disabling: "desktop.workbench.state.disabling",
  auto_disabled: "desktop.workbench.state.autoDisabled",
  safe_excluded: "desktop.workbench.state.safeExcluded",
};

const KIND_TEXT: Readonly<Record<ExtKind, MessageId>> = {
  group: "desktop.workbench.kind.group",
  plugin: "desktop.workbench.kind.plugin",
  core: "desktop.workbench.kind.core",
};

export const stateText = (state: ExtState): string => t(STATE_TEXT[state]);
export const kindText = (kind: ExtKind): string => t(KIND_TEXT[kind]);
export const stateTone = (state: ExtState): DotTone => STATE_TONE[state];

export function ExtName(props: { readonly row: ExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <span className="min-w-0 truncate">
      {row.displayName !== null ? (
        <span className="text-text-primary">{row.displayName}</span>
      ) : (
        <span className="font-mono text-mono-sm text-text-tertiary">{row.name}</span>
      )}
    </span>
  );
}
