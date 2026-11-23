// 멤버 떼기(`ext.members.detach`)와 플러그인 합치기(`ext.members.merge`, AGE-33)의 순수 모델. 그리기와 엔진 호출은 하지 않는다.
// 둘 다 원본 폴더는 읽기만 하고 새 폴더에 새 플러그인을 쓴다. 화면은 그 새 폴더로 드래프트를 만들어 리뷰에 낸다(원본은 지우지 않는다).
// 엔진의 영어 원문(`message`)은 보이지 않는다: 거절 사유(`reasons[].code`)와 결과 알림(`issues[].code`)을 사람 말로 옮긴다.
import type { MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { EXTENSION_NAME_PATTERN, type PluginCard } from "@fresnel/contracts/extensions";
import type { DevkitIssue, MemberInfo } from "@fresnel/contracts/services";
import type { ExtListEntry, ProfilePlan } from "@fresnel/contracts/wire";
import type { CommandError } from "../../commands.ts";

/** 목적 한 문장의 길이 한도(엔진의 `purpose` 한도와 같다) */
export const PURPOSE_MAX = 200;

/** 합칠 수 있는 원본 수(엔진: 2~16, 구성원은 뿌리를 빼고 15개까지라 15) */
export const MERGE_MIN = 2;
export const MERGE_MAX = 15;

const NAME = new RegExp(EXTENSION_NAME_PATTERN);

/** 새 플러그인 이름의 문제. 비어 있으면 아직 묻지 않는다(null). 설치된 이름과 겹치면 엔진도 거절한다 */
export function newNameProblemOf(name: string, taken: readonly string[]): MessageId | null {
  if (name === "") return null;
  if (!NAME.test(name)) return "desktop.craft.split.name.invalid";
  if (taken.includes(name)) return "desktop.craft.split.name.taken";
  return null;
}

/** 떼기의 새 이름 기본값: `<원래 이름>-<멤버 id>`(엔진의 기본값과 같다). 이름 한도(32자)를 넘으면 자른다 */
export function defaultDetachName(root: string, member: string): string {
  return `${root}-${member}`.slice(0, 32).replace(/-+$/, "");
}

/** 원본 폴더 옆(같은 부모)의 새 폴더 경로. 경로 구분자는 원본의 것을 따른다 */
export function siblingDirOf(dir: string, name: string): string {
  const trimmed = dir.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut < 0) return name;
  return `${trimmed.slice(0, cut + 1)}${name}`;
}

/** 고른 부모 폴더 안의 새 폴더 경로 */
export function childDirOf(parent: string, name: string): string {
  const trimmed = parent.replace(/[/\\]+$/, "");
  const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${sep}${name}`;
}

export function purposeProblemOf(text: string): MessageId | null {
  return text.trim().length > PURPOSE_MAX ? "desktop.craft.split.purpose.tooLong" : null;
}

/** 떼기와 합치기가 거절된 까닭. 엔진의 입력 사유(`reasons`)가 있으면 첫 사유로 가른다 */
export function splitFailureText(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.craft.members.fail.offline";
    case "switching":
      return "desktop.craft.members.fail.switching";
    case "rejected": {
      const code = error.reasons?.[0]?.code ?? "";
      const known = REFUSAL_TEXT.get(code);
      if (known !== undefined) return known;
      if ((error.issue ?? "").startsWith("denied")) return "desktop.craft.members.fail.denied";
      return "desktop.craft.split.fail.other";
    }
    case "unsupported":
    case "locked":
    case "not_available":
    case "failed":
      return "desktop.craft.split.fail.other";
    default:
      return assertNever(error, "splitFailureText");
  }
}

const REFUSAL_TEXT: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["out_dir_not_empty", "desktop.craft.split.fail.outDirNotEmpty"],
  ["out_dir_inside_source", "desktop.craft.split.fail.outDirInside"],
  ["name_invalid", "desktop.craft.split.name.invalid"],
  ["name_conflict", "desktop.craft.split.name.taken"],
  ["member_not_found", "desktop.craft.members.fail.notFound"],
  ["capability_duplicate", "desktop.craft.split.fail.capabilityDuplicate"],
  ["replace_conflict", "desktop.craft.split.fail.replaceConflict"],
  ["member_id_conflict", "desktop.craft.split.fail.memberIdConflict"],
  ["source_has_members", "desktop.craft.split.fail.sourceHasMembers"],
  ["source_duplicate_name", "desktop.craft.split.fail.sourceDuplicate"],
  ["tool_duplicate", "desktop.craft.split.fail.toolDuplicate"],
  ["layer_mixed_external", "desktop.craft.split.fail.layerMixed"],
]);

/** 결과 알림 한 줄. 경고는 사람이 손봐야 하는 것이고 알림은 알아 둘 것이다 */
export interface SplitNote {
  readonly tone: "warning" | "info";
  readonly text: MessageId;
}

const NOTE_TEXT: ReadonlyMap<string, SplitNote> = new Map<string, SplitNote>([
  ["detach_code_needs_wiring", { tone: "warning", text: "desktop.craft.split.note.detachWiring" }],
  ["merge_code_needs_wiring", { tone: "warning", text: "desktop.craft.split.note.mergeWiring" }],
  [
    "detach_shared_files_not_copied",
    { tone: "info", text: "desktop.craft.split.note.sharedFiles" },
  ],
  ["merge_shared_files_not_copied", { tone: "info", text: "desktop.craft.split.note.sharedFiles" }],
  ["merge_purpose_truncated", { tone: "info", text: "desktop.craft.split.note.purposeTruncated" }],
  [
    "merge_version_taken_from_first",
    { tone: "info", text: "desktop.craft.split.note.versionFirst" },
  ],
  [
    "merge_internal_dependency_dropped",
    { tone: "info", text: "desktop.craft.split.note.internalDependency" },
  ],
]);

/**
 * 결과 알림을 사람 말로. 같은 말은 한 번만, 경고가 먼저다. 모르는 코드는 경고만 "엔진 경고가 더 있어요" 한 줄로 모은다
 * (엔진 원문은 보이지 않는다)
 */
export function splitNotesOf(issues: readonly DevkitIssue[]): readonly SplitNote[] {
  const out: SplitNote[] = [];
  let unknownWarning = false;
  for (const issue of issues) {
    const note = NOTE_TEXT.get(issue.code);
    if (note === undefined) {
      if (issue.severity !== "info") unknownWarning = true;
      continue;
    }
    if (!out.some((n) => n.text === note.text)) out.push(note);
  }
  if (unknownWarning) out.push({ tone: "warning", text: "desktop.craft.split.note.otherWarning" });
  return out.toSorted((a, b) => Number(a.tone === "info") - Number(b.tone === "info"));
}

/**
 * 합칠 수 있는 후보: 앱에 든 것이 아니고 외부 층(`plugin`)이며 멤버가 없는(Registration 하나, 오케스트레이션 선언 없음) 플러그인.
 * 엔진은 오케스트레이션 선언이 있는 원본을 이미 멤버가 있다고 보고 거절하고(`source_has_members`), 합친 뿌리를 외부 층으로 쓰므로
 * L1~L3 원본은 층이 섞여 거절한다(`layer_mixed_external`). 원본 폴더 유무는 엔진에 물어 가른다
 */
export function mergeCandidatesOf(entries: readonly ExtListEntry[]): readonly ExtListEntry[] {
  return entries.filter(
    (e) =>
      e.origin !== "builtin" &&
      e.layer === "plugin" &&
      !e.isOrchestration &&
      e.plugins.length === 1 &&
      e.plugins[0]?.id === undefined,
  );
}

/** Registration id(`<확장 이름>` 또는 `<확장 이름>/<id>`)에서 확장 이름만 */
export function extensionNameOf(registration: string): string {
  const cut = registration.indexOf("/");
  return cut < 0 ? registration : registration.slice(0, cut);
}

/** 합칠 원본 하나와 거기에 hard로 기대는 다른 플러그인들(확장 이름, 고른 순서와 카드 순서) */
export interface MergeDependents {
  readonly source: string;
  readonly dependents: readonly string[];
}

/**
 * 합치기 상자의 미리 알림(plugWire): 고른 원본에 hard로 기대는, 고르지 않은 플러그인. 승인하면 원본이 프로필에서 빠지므로 엔진이 그 승인을
 * 거절한다(AGE-33). 카드(`plugin.list`)의 `dependencies.dependsOn`에서 읽고, 고른 것끼리의 의존과 자기 자신은 세지 않는다
 */
export function mergeDependentsOf(
  picked: readonly string[],
  cards: readonly PluginCard[],
): readonly MergeDependents[] {
  const chosen = new Set(picked);
  return picked.flatMap((source) => {
    const dependents = cards
      .filter(
        (card) =>
          !chosen.has(card.name) &&
          (card.dependencies?.dependsOn ?? []).some(
            (dependency) =>
              dependency.kind === "hard" && extensionNameOf(dependency.target) === source,
          ),
      )
      .map((card) => card.name);
    return dependents.length === 0 ? [] : [{ source, dependents }];
  });
}

/** 합치기가 프로필에서 뺄 원래 플러그인들(확장 이름, 같은 이름은 한 번만) */
export function swapOutOf(profileMove: readonly { readonly from: string }[]): readonly string[] {
  return [...new Set(profileMove.map((move) => extensionNameOf(move.from)))];
}

/** 떼기 뒤 원래 묶음이 프로필에서 어떻게 되는지와 원래 묶음 폴더를 다시 내야 하는지 */
export interface DetachPlan {
  readonly profilePlan: ProfilePlan;
  /** 참이면 원래 묶음에 구성원이 남는다: 그 폴더에서 떼는 구성원을 빼고 새 판을 리뷰에 낸다 */
  readonly bundleStays: boolean;
}

/**
 * 떼기의 프로필 계획(AGE-72). 남는 구성원이 있으면 새 플러그인은 원래 묶음 바로 뒤에 들고(묶음은 프로필에 남는다),
 * 떼는 구성원이 시작 Drive를 쥐고 남은 구성원이 아무도 Drive가 아니면 Drive도 새 플러그인으로 옮긴다.
 * 남는 구성원이 없으면 묶음이 프로필에서 빠지고 새 플러그인이 그 자리를 차지한다(Drive는 묶음 쪽이 옮긴다).
 */
export function detachPlanOf(
  members: readonly MemberInfo[],
  member: string,
  original: string,
): DetachPlan {
  const remaining = members.filter((m) => m.id !== member);
  if (remaining.length === 0)
    return {
      profilePlan: { swapOut: [original], placeAfter: null, driveFrom: null },
      bundleStays: false,
    };
  const drivesOut = members.some((m) => m.id === member && m.drives);
  const driveFrom = drivesOut && remaining.every((m) => !m.drives) ? original : null;
  return {
    profilePlan: { swapOut: [], placeAfter: original, driveFrom },
    bundleStays: true,
  };
}
