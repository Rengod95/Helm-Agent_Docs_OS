// 노드와 패널이 함께 쓰는 한 줄 사실들: 붙는 자리, 구성 요소 요약, 상태 표식. 글은 message id로 돌려주고 화면이 `t`로 옮긴다.
import { t } from "@fresnel/client/i18n";
import { agoText, type SharedPlugin } from "../shared-sample.ts";
import type { GlyphName } from "./glyphs.tsx";
import {
  entriesOf,
  groupOfMember,
  isBase,
  relationsOf,
  slotOf,
  type CanvasProfile,
  type Relation,
} from "./model.ts";
import { extOf, foldOf } from "./sample-ext.ts";
import { DECISION_WORD, FOLD_WORD, KIND_WORD, SLOT_WORD } from "./words.ts";

export interface Fact {
  readonly glyph: GlyphName;
  readonly text: string;
  /** 식별자(파일, 서버, 키)는 고정폭으로 */
  readonly mono: boolean;
}

/** "Hook · 도구 실행 앞" 같은 종류와 자리 한 줄 */
export function whereText(p: SharedPlugin): string {
  return `${t(KIND_WORD[p.kind])} · ${t(SLOT_WORD[slotOf(p)])}`;
}

/** 카드에 보일 구성 요소 요약(많아야 셋) */
export function componentFacts(p: SharedPlugin): readonly Fact[] {
  const out: Fact[] = [];
  const ext = extOf(p.name);
  if (p.kind === "hook") {
    if (p.decision !== undefined)
      out.push({ glyph: p.decision, text: t(DECISION_WORD[p.decision]), mono: false });
    if (ext?.hook !== undefined) {
      out.push({ glyph: "setting", text: ext.hook, mono: true });
      out.push({ glyph: "loop", text: t(FOLD_WORD[foldOf(ext.hook)]), mono: false });
    }
  }
  if (p.kind === "tool" && p.mcp !== undefined) {
    const writes = p.mcp.tools.filter((x) => x.writes).length;
    out.push({ glyph: "server", text: p.mcp.server, mono: true });
    out.push({
      glyph: "plus",
      text: t("desktop.craft.canvas.cvH.fact.tools", {
        count: p.mcp.tools.length,
        writes,
      }),
      mono: false,
    });
  }
  for (const file of p.instructions) out.push({ glyph: "doc", text: file, mono: true });
  if (p.skills.length > 0)
    out.push({
      glyph: "skill",
      text: t("desktop.craft.canvas.cvH.fact.skills", { count: p.skills.length }),
      mono: false,
    });
  for (const file of p.memory) out.push({ glyph: "doc", text: file, mono: true });
  for (const s of p.settings)
    out.push({ glyph: "setting", text: `${s.key} ${s.value}`, mono: true });
  return out.slice(0, 3);
}

/** 플러그인이 이 프로필에 든 길: 베이스, 묶음, 프로필 */
export type Via =
  | { readonly kind: "base" }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "profile"; readonly index: number }
  | { readonly kind: "none" };

export function viaOf(profile: CanvasProfile, name: string): Via {
  if (isBase(profile, name)) return { kind: "base" };
  const g = groupOfMember(profile.groups, name);
  if (g !== undefined && entriesOf(profile).includes(name)) return { kind: "group", id: g.id };
  const i = entriesOf(profile).indexOf(name);
  return i < 0 ? { kind: "none" } : { kind: "profile", index: i + 1 };
}

export function lastUsed(p: SharedPlugin): string {
  return agoText(p.lastUsedMin);
}

/** 이 플러그인의 관계 전부(프로필 안). 묶음 소유는 구성원 쪽에서도 보인다 */
export function relationsFor(profile: CanvasProfile, name: string): readonly Relation[] {
  return relationsOf(profile).filter(
    (r) => r.from === name || r.to === name || r.from === `seed:${name}`,
  );
}
