// 플러그인 상세 "개요" 탭의 순수 모델(plugTab, AGE-76). 카드와 프로필 값을 화면이 쓰는 글 키와 세는 수로 바꾼다. 그림은 `detail-overview.tsx`가 그린다.
import { tKey, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { builtinPluginTextKey, type PluginCard } from "@fresnel/contracts/extensions";
import type { Profile } from "@fresnel/contracts/wire";
import { profileTitleOf } from "../convo/profile-chip-model.ts";
import { inProfile } from "./profile-use.ts";
import type { ToolNeedState } from "./tool-ready.ts";

/** 카드의 글 칸: 앞뒤 공백을 뗀 글이다. 비었거나 없으면 null(화면은 그리지 않거나 "없어요" 글을 쓴다) */
export function cardTextOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 카드의 목적이나 설명을 화면 언어로. 엔진이 싣는 내장 플러그인(`origin.kind`가 `builtin`)의 글은 영어 매니페스트 값이라,
 * 카탈로그에 그 플러그인의 글(`plugin.internal.<이름>.<칸>`, `plugin.builtin.<이름>.<칸>`)이 있으면 그것을 쓴다. 없으면 카드 값이다
 */
export function cardTextIn(card: PluginCard, field: "purpose" | "description"): string | null {
  const own = cardTextOf(field === "purpose" ? card.purpose : card.description);
  const key = card.origin.kind === "builtin" ? builtinPluginTextKey(card.name, field) : undefined;
  return key === undefined ? own : cardTextOf(tKey(key, own ?? ""));
}

/** Hook 수: 훅 칸이 없으면 0 */
export function hookCountOf(card: PluginCard): number {
  return card.does.hook?.hooks.length ?? 0;
}

/** 도구 수: Inject 칸의 도구와 MCP 서버를 더한다. Inject 칸이 없으면 0 */
export function toolCountOf(card: PluginCard): number {
  const inject = card.does.inject;
  return inject === null ? 0 : inject.tools.length + inject.mcpServers.length;
}

/** 도구 상태 말의 글 키 */
export function readinessWordOf(state: ToolNeedState): MessageId {
  switch (state) {
    case "ready":
      return "desktop.workbench.detail.ready.ready";
    case "bundled":
      return "desktop.workbench.detail.ready.bundled";
    case "missing":
      return "desktop.workbench.detail.ready.missing";
    case "tooOld":
      return "desktop.workbench.detail.ready.tooOld";
    case "unusable":
      return "desktop.workbench.detail.ready.unusable";
    case "unchecked":
      return "desktop.workbench.detail.ready.unchecked";
    default:
      return assertNever(state, "readinessWordOf");
  }
}

/** 이 플러그인을 넣은 프로필(id와 보이는 이름). 프로필 목록의 순서를 지킨다 */
export function profilesWithOf(
  name: string,
  profiles: readonly Profile[],
): readonly { readonly id: string; readonly title: string }[] {
  return profiles
    .filter((profile) => inProfile(profile, name))
    .map((profile) => ({ id: profile.id, title: profileTitleOf(profile.id, profile.title) }));
}
