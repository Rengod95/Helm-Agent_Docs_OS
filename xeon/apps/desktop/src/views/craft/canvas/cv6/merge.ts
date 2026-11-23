// 캔버스에서 끌어서 합치기, 의존으로 잇기, 떼기의 순수 모델(cvMerge, AGE-72). 그리기와 엔진 호출은 하지 않는다.
// 범위는 엔진 그대로다 [결정: 2026-11-23 사용자, AGE-72 "3.가"]: 합치기는 사용자가 넣은(앱에 들지 않은) 외부 층의 멤버 없는 플러그인끼리,
// 원본 폴더가 있을 때만(`mergeCandidatesOf`, `ext.members.merge`). 의존은 끌어온 쪽의 원본 폴더에 줄을 더한다(`ext.dependencies.edit`).
// 떼기는 원본 폴더가 있는 묶음의 멤버 하나를 새 플러그인으로 쓴다(`ext.members.detach`). 셋 다 결과는 리뷰를 거친다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { mergeCandidatesOf } from "../../members/split-model.ts";
import {
  bundleIdOfMember,
  moveOnto,
  pendingItemOf,
  requiredByOf,
  type CanvasProfile,
} from "./model.ts";

/** 엔진에서 읽은 합치기의 사실: 설치 목록(`ext.list`)과 원본 폴더(`plugin.get`의 `source.path`) */
export interface MergeFacts {
  readonly entries: readonly ExtListEntry[];
  readonly sources: ReadonlyMap<string, string>;
}

export const NO_FACTS: MergeFacts = { entries: [], sources: new Map() };

/** 놓을 수 없는 까닭. 한 줄 글은 `REFUSAL_TEXT` */
export type Refusal =
  | "self"
  | "pending"
  | "member"
  | "core"
  | "builtin"
  | "members"
  | "layer"
  | "noSource"
  | "unknown";

export const REFUSAL_TEXT: Readonly<Record<Refusal, MessageId>> = {
  self: "desktop.craft.canvas.cvMerge.refuse.self",
  pending: "desktop.craft.canvas.cvMerge.refuse.pending",
  member: "desktop.craft.canvas.cvMerge.refuse.member",
  core: "desktop.craft.canvas.cvMerge.refuse.core",
  builtin: "desktop.craft.canvas.cvMerge.refuse.builtin",
  members: "desktop.craft.canvas.cvMerge.refuse.members",
  layer: "desktop.craft.canvas.cvMerge.refuse.layer",
  noSource: "desktop.craft.canvas.cvMerge.refuse.noSource",
  unknown: "desktop.craft.canvas.cvMerge.refuse.unknown",
};

function entryOf(facts: MergeFacts, name: string): ExtListEntry | undefined {
  return facts.entries.find((e) => e.name === name);
}

/** 멤버 판인가(`<플러그인>/<멤버 id>`) */
export function isMemberPlate(name: string): boolean {
  return name.includes("/");
}

/**
 * 이 판을 합치기에 쓸 수 없는 까닭. null이면 쓸 수 있다. 차례: 리뷰 대기, 멤버 판, 앱 핵심, 앱에 든 것, 멤버 있음, 층, 원본 폴더.
 * 엔진의 범위(`mergeCandidatesOf`)를 넓히지 않는다: 그 목록에 없으면 어떤 까닭으로든 거절이다
 */
export function mergeRefusalOf(name: string, facts: MergeFacts): Refusal | null {
  if (pendingItemOf(name) !== null) return "pending";
  if (isMemberPlate(name)) return "member";
  if (requiredByOf(name).length > 0) return "core";
  const entry = entryOf(facts, name);
  if (entry === undefined) return "unknown";
  if (entry.origin === "builtin") return "builtin";
  if (entry.isOrchestration || entry.plugins.some((p) => p.id !== undefined)) return "members";
  if (mergeCandidatesOf([entry]).length === 0) return "layer";
  if (!facts.sources.has(name)) return "noSource";
  return null;
}

/** 이 판에서 의존을 걸 수 없는 까닭(끌어온 쪽). 원본 폴더의 매니페스트를 고치므로 원본 폴더가 있어야 한다 */
export function linkFromRefusalOf(name: string, facts: MergeFacts): Refusal | null {
  if (pendingItemOf(name) !== null) return "pending";
  if (isMemberPlate(name)) return "member";
  const entry = entryOf(facts, name);
  if (entry === undefined) return "unknown";
  if (entry.origin === "builtin") return "builtin";
  if (!facts.sources.has(name)) return "noSource";
  return null;
}

/** 이 판에 기댈 수 없는 까닭(놓인 쪽). 설치된 플러그인이면 어느 것이든 대상이 된다(엔진 `targetOptionsOf`와 같다) */
export function linkToRefusalOf(from: string, to: string, facts: MergeFacts): Refusal | null {
  if (from === to) return "self";
  if (pendingItemOf(to) !== null) return "pending";
  const target = isMemberPlate(to) ? (bundleIdOfMember(to) ?? to) : to;
  if (target === from) return "self";
  if (entryOf(facts, target) === undefined) return "unknown";
  return null;
}

/**
 * 판 하나를 다른 판 위에 놓을 때 고를 수 있는 것. 놓을 자리(강조)는 합칠 수 있는 판이다: 앱에 든 것, 앱 핵심, 멤버 있는 것은 흐리다.
 * 의존으로 잇기는 그 자리의 고르기에 함께 서고, 다른 판(앱에 든 것 따위)에 기대려면 판 메뉴의 "의존으로 잇기…"를 쓴다
 */
export interface DropChoices {
  readonly merge: boolean;
  readonly link: boolean;
  /** 같은 자리의 순서 바꾸기(cv9의 끌어 놓기). 합칠 수 없는 판 위에서는 고르기 없이 그대로 옮긴다 */
  readonly reorder: boolean;
  /** 합칠 수 없는 까닭(놓인 쪽의 까닭이 먼저). null이면 놓을 자리다 */
  readonly refusal: Refusal | null;
}

export function dropChoicesOf(
  profile: CanvasProfile,
  dragged: string,
  target: string,
  facts: MergeFacts,
): DropChoices {
  if (dragged === target) return { merge: false, link: false, reorder: false, refusal: "self" };
  const refusal = mergeRefusalOf(target, facts) ?? mergeRefusalOf(dragged, facts);
  const merge = refusal === null;
  const link =
    merge &&
    linkFromRefusalOf(dragged, facts) === null &&
    linkToRefusalOf(dragged, target, facts) === null;
  const reorder = pendingItemOf(target) === null && moveOnto(profile, dragged, target) !== profile;
  return { merge, link, reorder, refusal };
}

/** 합칠 상대 목록(판 메뉴의 "합치기…"): 이 플러그인과 합칠 수 있는 설치된 플러그인, 목록 순서 */
export function mergePartnersOf(name: string, facts: MergeFacts): readonly ExtListEntry[] {
  if (mergeRefusalOf(name, facts) !== null) return [];
  return facts.entries.filter((e) => e.name !== name && mergeRefusalOf(e.name, facts) === null);
}

/** 기댈 대상 목록(판 메뉴의 "의존으로 잇기…"): 자기 자신을 뺀 설치된 플러그인, 목록 순서 */
export function linkPartnersOf(name: string, facts: MergeFacts): readonly ExtListEntry[] {
  if (linkFromRefusalOf(name, facts) !== null) return [];
  return facts.entries.filter((e) => linkToRefusalOf(name, e.name, facts) === null);
}

/** 멤버 판을 뗄 수 없는 까닭. 묶음의 원본 폴더가 있어야 한다 */
export function detachRefusalOf(name: string, facts: MergeFacts): Refusal | null {
  const bundle = bundleIdOfMember(name);
  if (bundle === null) return "unknown";
  if (!facts.sources.has(bundle)) return "noSource";
  return null;
}

/** 멤버 판 이름(`<플러그인>/<멤버 id>`)을 묶음과 멤버 id로 */
export function memberPartsOf(name: string): { readonly root: string; readonly member: string } {
  const cut = name.indexOf("/");
  return { root: name.slice(0, cut), member: name.slice(cut + 1) };
}

/** 합친 플러그인의 이름 기본값: `<놓인 것>-<끌어온 것>`, 이름 한도 32자, 이미 있는 이름이면 빈 값(사람이 적는다) */
export function defaultMergeName(
  target: string,
  dragged: string,
  taken: readonly string[],
): string {
  const name = `${target}-${dragged}`.slice(0, 32).replace(/-+$/, "");
  return taken.includes(name) ? "" : name;
}

// ── 리뷰 대기 판을 기억하기 ────────────────────────────────────────

/** 이 캔버스가 리뷰에 낸 합치기·떼기 결과의 리뷰 항목 id(앱을 다시 열어도 반투명 판이 남게 브라우저 저장소에 둔다) */
const PENDING_KEY = "fresnel.craft.canvasPending";

export function readTracked(): readonly string[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(PENDING_KEY);
  if (raw === null || raw === "") return [];
  return raw.split("\n").filter((id) => id !== "");
}

export function writeTracked(ids: readonly string[]): void {
  if (typeof localStorage === "undefined") return;
  if (ids.length === 0) localStorage.removeItem(PENDING_KEY);
  else localStorage.setItem(PENDING_KEY, [...new Set(ids)].join("\n"));
}

export function track(itemId: string): void {
  writeTracked([...readTracked(), itemId]);
}
