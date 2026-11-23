// 플러그인 종류 표시(plugTab, AGE-76). 크래프트 목록의 표와 카드, 상세 개요가 같이 쓴다.
// 종류는 캔버스와 같은 규칙(`kindOfCard`)이고, 그림과 이름도 캔버스의 것(`KindGlyph`, `KIND_WORD`)을 그대로 쓴다.
// 색은 캔버스 판의 책갈피와 같은 선명한 한 벌(`src/chroma.css`, DP-229): 채운 면 `--fr-vivid-<색>-solid` 위에 글 `-on`이다.
// 캔버스의 `--cv6-*` 변수는 캔버스 뿌리 안에서만 풀리므로 여기서는 같은 토큰을 바로 가리킨다(색 값 자체는 없다).
import { t } from "@fresnel/client/i18n";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { CSSProperties, ReactElement } from "react";
import { KindGlyph } from "../craft/canvas/cv6/glyphs.tsx";
import { kindOfCard } from "../craft/canvas/cv6/live.ts";
import type { Kind } from "../craft/canvas/cv6/model.ts";
import { KIND_WORD } from "../craft/canvas/cv6/words.ts";

export type { Kind as PluginKind } from "../craft/canvas/cv6/model.ts";

/** 종류의 색 이름(chroma.css의 선명한 한 벌). Inject cobalt, Hook 노랑, Drive 보라, 도구 초록 */
const HUE: Readonly<Record<Kind, string>> = {
  inject: "cobalt",
  hook: "yellow",
  drive: "purple",
  tool: "green",
};

/** 정렬에 쓰는 종류 순서(캔버스 레일 순서와 같다: Drive, Inject, 도구, Hook) */
export const KIND_ORDER: readonly Kind[] = ["drive", "inject", "tool", "hook"];

/** 카드의 종류. 카드가 없으면(카드를 주지 않는 내부 부품) null */
export function pluginKindOf(card: PluginCard | null | undefined): Kind | null {
  return card === null || card === undefined ? null : kindOfCard(card);
}

/** 종류 이름(사람 말) */
export function kindWord(kind: Kind): string {
  return t(KIND_WORD[kind]);
}

/** 채운 면과 그 위 글 색 */
export function kindFaceStyle(kind: Kind): CSSProperties {
  const hue = HUE[kind];
  return { background: `var(--fr-vivid-${hue}-solid)`, color: `var(--fr-vivid-${hue}-on)` };
}

/** 종류 꼬리표: 채운 면 위 종류 그림 + 종류 이름. 표의 종류 칸과 상세 개요가 쓴다 */
export function KindTag(props: { readonly kind: Kind }): ReactElement {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-ui-xs font-medium"
      style={kindFaceStyle(props.kind)}
    >
      <KindGlyph kind={props.kind} size={12} />
      <span>{kindWord(props.kind)}</span>
    </span>
  );
}
