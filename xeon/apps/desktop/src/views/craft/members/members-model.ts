// 플러그인 상세 "구성원" 탭(m6Mb, AGE-33)의 순수 모델. 그리기와 엔진 호출은 하지 않는다.
// 구성원은 플러그인 안의 작은 단위(Hook, Drive, 지침·도구만 있는 것)이고 순서가 등록 순서다(같은 자리에 걸린 Hook의 호출 순서).
// 값의 출처: 원본 폴더가 있으면 `ext.members.read`(드래프트가 될 원본), 없으면 설치본 매니페스트(`ext.get`의 `plugins[]`)다.
// 엔진이 멤버마다 주는 것은 Hook 이름, Drive 여부, 걸린 블록 id이고, Inject와 도구(`injects`, `tools`)는 칸만 있고 지금은 늘 비어 있다
// (매니페스트에 멤버별 소유가 없다, enDep-b 2). 값이 있을 때만 그린다: 빈 칸이나 "없어요"를 그리지 않는다.
import type { MessageId } from "@fresnel/client/i18n";
import { compositionOf, memberIdErrorOf, type MemberIdProblem } from "@fresnel/client/workbench";
import { assertNever, parse } from "@fresnel/contracts";
import { PluginDeclSchema } from "@fresnel/contracts/extensions";
import type { DevkitIssue, MemberInfo, PluginMode } from "@fresnel/contracts/services";
import type { ExtListEntry, ReviewItem } from "@fresnel/contracts/wire";
import type { CommandError } from "../../commands.ts";
import { hookLabelOf } from "../hook-labels.ts";

/** 뿌리를 뺀 구성원 상한. 매니페스트 `plugins[]`는 뿌리를 포함해 16개까지다 */
export const MEMBER_LIMIT = 15;

/** 멤버가 선언한 일. 순서는 리뷰 화면의 `KIND_ORDER`와 같다. `tool`과 `inject`는 엔진이 값을 줄 때만 생긴다 */
type MemberKind = "drive" | "hook" | "tool" | "inject";

interface MemberBlock {
  readonly id: string;
  /** 블록 제목. 설치본 구성에서 찾지 못하면 id */
  readonly title: string;
}

/** 화면의 구성원 한 줄 */
export interface MemberRow {
  readonly id: string;
  /** 보이는 이름: 제목, 없으면 id */
  readonly name: string;
  /** 제목이 있을 때만 id를 따로 보인다 */
  readonly hasTitle: boolean;
  /** 그림 순서: Drive가 먼저다(리뷰 화면의 `KIND_ORDER`와 같다) */
  readonly kinds: readonly MemberKind[];
  /** 걸린 Hook 자리의 사용자 말(중복 없이, 선언 순서). 이름표가 없는 훅은 세기만 한다 */
  readonly moments: readonly MessageId[];
  readonly otherHooks: number;
  /** 이 멤버의 도구 수와 Inject 수. 지금 엔진은 늘 0이다 */
  readonly tools: number;
  readonly injects: number;
  readonly blocks: readonly MemberBlock[];
}

/** 설치본 구성의 블록 제목(id → 제목). 구성 선언이 없으면 빈 표다 */
export function blockTitlesOf(
  manifest: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const composition = compositionOf(manifest);
  if (composition.kind === "none") return new Map();
  return new Map(composition.composition.blocks.map((b) => [b.id, b.title ?? b.id]));
}

/**
 * 설치본 매니페스트에서 구성원을 읽는다(원본 폴더가 없거나 읽지 못할 때). 모양이 맞지 않는 항목은 건너뛴다(지어내지 않는다).
 * `blockIds`는 구성 선언의 `block.plugin`이 그 구성원인 블록이다(`ext.members.read`와 같은 규칙)
 */
export function membersOfManifest(
  name: string,
  manifest: Readonly<Record<string, unknown>>,
): readonly MemberInfo[] {
  const plugins = manifest["plugins"];
  if (!Array.isArray(plugins)) return [];
  const composition = compositionOf(manifest);
  const blocks = composition.kind === "none" ? [] : composition.composition.blocks;
  const out: MemberInfo[] = [];
  for (const raw of plugins) {
    const decl = parse(PluginDeclSchema, raw);
    if (!decl.ok || decl.value.id === undefined) continue;
    const id = decl.value.id;
    out.push({
      id,
      registrationId: `${name}/${id}`,
      title: decl.value.title ?? null,
      layer: decl.value.layer,
      hooks: decl.value.hooks,
      injects: [],
      tools: [],
      drives: decl.value.drives === true,
      defaultEnabled: decl.value.defaultEnabled ?? false,
      blockIds: blocks.filter((b) => b.plugin === id).map((b) => b.id),
    });
  }
  return out;
}

/** 목록에 구성원 줄이 하나라도 있는가(`ext.list`의 Registration 가운데 id가 있는 것) */
export function hasMembers(entry: ExtListEntry): boolean {
  return entry.plugins.some((p) => p.id !== undefined);
}

/** 뿌리 플러그인의 층(`ext.list`). 뿌리가 없으면 첫 줄의 층이다 */
export function rootLayerOf(entry: ExtListEntry): string | null {
  const root = entry.plugins.find((p) => p.id === undefined) ?? entry.plugins[0];
  return root?.layer ?? null;
}

export function memberRowsOf(
  members: readonly MemberInfo[],
  blockTitles: ReadonlyMap<string, string>,
): readonly MemberRow[] {
  return members.map((m) => {
    const moments: MessageId[] = [];
    let otherHooks = 0;
    for (const hook of m.hooks) {
      const label = hookLabelOf(hook);
      if (label === undefined) otherHooks += 1;
      else if (!moments.includes(label)) moments.push(label);
    }
    const kinds: MemberKind[] = [];
    if (m.drives) kinds.push("drive");
    if (m.hooks.length > 0) kinds.push("hook");
    if (m.tools.length > 0) kinds.push("tool");
    if (m.injects.length > 0) kinds.push("inject");
    return {
      id: m.id,
      name: m.title ?? m.id,
      hasTitle: m.title !== null,
      kinds,
      moments,
      otherHooks,
      tools: m.tools.length,
      injects: m.injects.length,
      blocks: m.blockIds.map((id) => ({ id, title: blockTitles.get(id) ?? id })),
    };
  });
}

// ── 고칠 수 있는가 ─────────────────────────────────────────────────────

/** 고칠 수 없는 까닭. 내장(앱에 든 것), 원본 폴더 없음(설치본만 있음), 엔진이 거절함(설치된 사본이나 저장소 폴더) */
export type LockReason = "builtin" | "noSource" | "denied";

export type MembersAccess =
  | { readonly kind: "editable"; readonly dir: string }
  | { readonly kind: "locked"; readonly reason: LockReason };

export const LOCK_TEXT: Readonly<Record<LockReason, MessageId>> = {
  builtin: "desktop.craft.members.locked.builtin",
  noSource: "desktop.craft.members.locked.noSource",
  denied: "desktop.craft.members.locked.denied",
};

/** 원본 폴더(`plugin.get`의 `source`)와 출처로 고칠 수 있는지 정한다. 원본 폴더를 엔진이 거절하면 `denied`다 */
export function accessOf(
  entry: ExtListEntry,
  sourcePath: string | null,
  denied: boolean,
): MembersAccess {
  if (entry.origin === "builtin") return { kind: "locked", reason: "builtin" };
  if (sourcePath === null) return { kind: "locked", reason: "noSource" };
  if (denied) return { kind: "locked", reason: "denied" };
  return { kind: "editable", dir: sourcePath };
}

// ── 리뷰 ───────────────────────────────────────────────────────────────

/**
 * 리뷰와의 관계. `clean`: 원본이 지금 도는 승인본과 같다. `changed`: 원본이 바뀌었고 리뷰에 보낸 것이 없다.
 * `inReview`: 이 플러그인의 리뷰 항목이 기다린다(승인 전에는 승인본이 돈다)
 */
export type SendState =
  | { readonly kind: "clean" }
  | { readonly kind: "changed" }
  | { readonly kind: "inReview"; readonly itemId: string };

/**
 * 원본이 승인본과 같은지(`plugin.get`의 `source.matchesReviewed`), 기다리는 리뷰 항목, 이 화면에서 보낸 뒤 또 고쳤는지로 정한다.
 * 보낸 뒤 또 고쳤으면 다시 보내야 하므로 `changed`다
 */
export function sendStateOf(input: {
  readonly matchesReviewed: boolean;
  readonly pending: ReviewItem | null;
  readonly editedSinceSend: boolean;
}): SendState {
  if (input.pending !== null && !input.editedSinceSend) {
    return { kind: "inReview", itemId: input.pending.itemId };
  }
  return input.matchesReviewed ? { kind: "clean" } : { kind: "changed" };
}

/** 이 플러그인의 기다리는 리뷰 항목(가장 최근 것) */
export function pendingItemOf(items: readonly ReviewItem[], name: string): ReviewItem | null {
  const mine = items.filter((i) => i.name === name && i.state === "pending");
  return mine.at(-1) ?? null;
}

// ── 더하기 ─────────────────────────────────────────────────────────────

/** 더할 때 고르는 방식. 엔진의 `mode` 셋과 같다 */
export const ADD_MODES: readonly PluginMode[] = ["hook", "inject", "drive"];

/** Drive 구성원은 L3 플러그인에만 더할 수 있다(엔진: "a drive member needs layer L3"). 구성원은 뿌리의 층을 따른다 */
export function driveAllowedOf(rootLayer: string | null): boolean {
  return rootLayer === "L3";
}

const ID_PROBLEM_TEXT: Readonly<Record<MemberIdProblem, MessageId>> = {
  pattern: "desktop.craft.members.id.pattern",
  duplicate: "desktop.craft.members.id.duplicate",
};

/**
 * 이름(id) 검사. `existing`은 구성원 id 전부와 뿌리 플러그인 이름이다. 바꾸기는 자기 이름을 뺀 목록을 준다.
 * 빈 값은 아직 입력 전이라 null이다(`memberIdErrorOf`)
 */
export function idProblemOf(id: string, existing: readonly string[]): MessageId | null {
  const problem = memberIdErrorOf(id, existing);
  return problem === null ? null : ID_PROBLEM_TEXT[problem];
}

// ── 순서 ───────────────────────────────────────────────────────────────

/** `from`의 것을 `to` 자리로 옮긴 목록(`to`는 옮긴 뒤의 자리). 범위 밖이면 그대로 */
export function movedOrder<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [picked] = next.splice(from, 1);
  if (picked === undefined) return items;
  next.splice(to, 0, picked);
  return next;
}

/**
 * 키보드 순서 바꾸기. 줄에서 Alt+↑·↓는 바로 옮기고, 집어 든 동안(`lifted`)은 ↑·↓만으로 옮긴다. Home·End는 맨 앞·맨 뒤.
 * 옮길 자리를 돌려주고, 순서 키가 아니면 null이다
 */
export function keyMoveOf(
  key: string,
  alt: boolean,
  lifted: boolean,
  index: number,
  count: number,
): number | null {
  const free = lifted || alt;
  if (!free) return null;
  const last = count - 1;
  if (key === "ArrowUp") return index > 0 ? index - 1 : null;
  if (key === "ArrowDown") return index < last ? index + 1 : null;
  if (key === "Home") return lifted && index > 0 ? 0 : null;
  if (key === "End") return lifted && index < last ? last : null;
  return null;
}

// ── 편집 결과 ──────────────────────────────────────────────────────────

/** 빼도 남긴 코드 파일(`member_file_kept` 알림의 `file`) */
export function keptFilesOf(issues: readonly DevkitIssue[]): readonly string[] {
  return issues.flatMap((i) =>
    i.code === "member_file_kept" && i.file !== undefined ? [i.file] : [],
  );
}

/** 편집이 실패한 까닭의 문장. 입력 거절은 엔진의 종류(`<종류>: <내용>`)로 가른다. 엔진의 영어 원문은 보이지 않는다 */
export function editFailureText(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.craft.members.fail.offline";
    case "switching":
      return "desktop.craft.members.fail.switching";
    case "rejected": {
      const kind = error.issue?.split(":", 1)[0] ?? "";
      if (kind === "denied") return "desktop.craft.members.fail.denied";
      if (kind === "not_found") return "desktop.craft.members.fail.notFound";
      if (kind === "no_manifest") return "desktop.craft.members.fail.noManifest";
      return "desktop.craft.members.fail.invalid";
    }
    case "unsupported":
    case "locked":
    case "not_available":
    case "failed":
      return "desktop.craft.members.fail.other";
    default:
      return assertNever(error, "editFailureText");
  }
}

/** 엔진이 원본 폴더를 거절했는가(설치된 사본이나 저장소 폴더) */
export function isDenied(error: CommandError): boolean {
  return error.kind === "rejected" && (error.issue?.startsWith("denied:") ?? false);
}

/** 구성원 목록이 어디서 왔나: 원본 폴더(드래프트가 될 것) 또는 설치본 */
export type MembersOrigin = "source" | "installed";
