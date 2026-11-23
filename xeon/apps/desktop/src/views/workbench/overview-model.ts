// 플러그인 상세 "개요" 탭의 순수 모델(plugTab, AGE-76). 카드와 프로필 값을 화면이 쓰는 글 키와 세는 수로 바꾼다. 그림은 `detail-overview.tsx`가 그린다.
import { t, tKey, type MessageId } from "@fresnel/client/i18n";
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

/** "하는 일" 첫 줄. `fromDescription`이면 글은 설명이라 아래 설명 줄을 또 그리지 않는다 */
export interface DoesLead {
  readonly text: string;
  readonly fromDescription: boolean;
}

/**
 * 리뷰가 도구 이름으로 채우는 기본 목적 글(`desktop.craft.review.purpose.toolOne`·`toolMany`, 리뷰의 상한 200자와 같다).
 * 목적이 이 글과 같으면 그 목적은 도구 이름을 싣고 있는 것이다
 */
function toolsDraftTextOf(names: readonly string[]): string {
  const text =
    names.length === 1
      ? t("desktop.craft.review.purpose.toolOne", { name: names[0] ?? "" })
      : t("desktop.craft.review.purpose.toolMany", {
          count: names.length,
          names: names.join(", "),
        });
  return text.slice(0, 200);
}

/**
 * "하는 일" 첫 줄(AGE-77 S-09 나). 목적이 도구 이름을 싣고 있으면(리뷰가 채운 기본 문장) 이름 원문을 빼고, 설명이 있으면 설명을,
 * 없으면 "도구 N개를 모델에 줘요"를 쓴다. 사람이 쓴 목적은 그대로다. 목적이 없으면 null이다
 */
export function doesLeadOf(input: {
  readonly purpose: string | null;
  readonly description: string | null;
  readonly toolNames: readonly string[];
}): DoesLead | null {
  const { purpose, description, toolNames } = input;
  if (purpose === null) return null;
  if (toolNames.length === 0 || purpose !== toolsDraftTextOf(toolNames)) {
    return { text: purpose, fromDescription: false };
  }
  if (description !== null) return { text: description, fromDescription: true };
  return {
    text: t("desktop.workbench.detail.overview.toolCount", { count: toolNames.length }),
    fromDescription: false,
  };
}

/** 카드의 "하는 일" 첫 줄. 카드를 못 읽었으면 null(호출하는 쪽이 자리 글을 쓴다) */
export function doesLeadOfCard(card: PluginCard): DoesLead | null {
  return doesLeadOf({
    purpose: cardTextIn(card, "purpose"),
    description: cardTextIn(card, "description"),
    toolNames: card.does.inject === null ? [] : card.does.inject.tools.map((tool) => tool.name),
  });
}

/**
 * 첫 문장: 첫 줄 안에서 `.`·`!`·`?`·`。` 뒤에 공백이나 글 끝이 오는 곳까지다(`v1.2`처럼 점 뒤가 글자면 문장이 끝나지 않는다).
 * 그런 곳이 없으면 첫 줄 전부다
 */
export function firstSentenceOf(text: string): string {
  const firstLine = text.split("\n")[0] ?? text;
  return (/^.*?[.!?。](?=\s|$)/u.exec(firstLine)?.[0] ?? firstLine).trim();
}

/**
 * 플러그인 카드의 한 줄(rerun3 T-04). 목적이 있으면 "하는 일" 첫 줄과 같고, 목적이 없으면 설명의 첫 문장이다.
 * 둘 다 없으면 null이다(카드는 "목적이 없어요"를 쓴다). 설명의 첫 문장은 설명 줄을 또 그리지 않는 글(`fromDescription`)이다
 */
export function cardLeadOf(card: PluginCard): DoesLead | null {
  const lead = doesLeadOfCard(card);
  if (lead !== null) return lead;
  const description = cardTextIn(card, "description");
  return description === null
    ? null
    : { text: firstSentenceOf(description), fromDescription: true };
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
