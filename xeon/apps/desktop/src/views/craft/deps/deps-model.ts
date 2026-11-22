// 플러그인 사이의 의존(`dependsOn`, AGE-33)을 화면 말로 옮기는 순수 모델. 그리기와 엔진 호출은 하지 않는다.
// 값의 출처는 셋이다: 카드의 `dependencies`(설치본 기준, 문제와 기대는 쪽을 엔진이 계산한다), 원본 폴더의 `ext.dependencies.read`
// (고치는 중인 선언), 거절 오류 `plugin.dependency`(3627)의 `items`. 대상은 Registration id(`이름` 또는 `이름/멤버`)다.
import type { MessageId } from "@fresnel/client/i18n";
import { extNameOf } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type {
  CardDependency,
  CardDependencyProblem,
  DependencyKind,
} from "@fresnel/contracts/extensions";
import type { DependencyInfo } from "@fresnel/contracts/services";
import type {
  DependencyProblemKind,
  DependencyRefusalReason,
  ExtListEntry,
} from "@fresnel/contracts/wire";
import type { CommandError } from "../../commands.ts";

/** 버전 범위 칸의 길이 한도(엔진의 `range` 한도와 같다) */
export const RANGE_MAX = 64;

/** Registration id를 플러그인 이름과 멤버 id로 가른다. 플러그인 전체면 멤버는 null이다 */
export function splitRegistration(id: string): {
  readonly plugin: string;
  readonly member: string | null;
} {
  const slash = id.indexOf("/");
  if (slash === -1) return { plugin: id, member: null };
  return { plugin: id.slice(0, slash), member: id.slice(slash + 1) };
}

/** 화면이 그리는 이름 한 덩이: 플러그인의 보이는 이름과, 있으면 멤버 id */
export interface PartyName {
  readonly plugin: string;
  readonly member: string | null;
}

/** 목록(`ext.list`)에서 보이는 이름을 찾는다. 목록에 없는 이름(설치되지 않은 대상)은 이름 그대로다 */
export function partyNameOf(id: string, entries: readonly ExtListEntry[]): PartyName {
  const split = splitRegistration(id);
  const entry = entries.find((e) => e.name === split.plugin);
  return { plugin: entry === undefined ? split.plugin : extNameOf(entry), member: split.member };
}

export const KIND_WORD: Readonly<Record<DependencyKind, MessageId>> = {
  hard: "desktop.craft.deps.kind.hard",
  soft: "desktop.craft.deps.kind.soft",
};

/** 카드의 문제(설치본 기준). 없으면 null */
export function cardProblemText(problem: CardDependencyProblem | null): MessageId | null {
  switch (problem) {
    case null:
      return null;
    case "target_missing":
      return "desktop.craft.deps.problem.targetMissing";
    case "member_missing":
      return "desktop.craft.deps.problem.memberMissing";
    case "range_unmet":
      return "desktop.craft.deps.problem.rangeUnmet";
    default:
      return assertNever(problem, "card dependency problem");
  }
}

/** 화면의 의존 한 줄 */
export interface DependencyRow {
  /** 줄을 가르는 값(`from→target`) */
  readonly key: string;
  readonly from: string;
  readonly target: string;
  /** 의존을 건 쪽이 멤버면 그 id. 플러그인 전체면 null */
  readonly fromMember: string | null;
  readonly kind: DependencyKind;
  readonly range: string | null;
  readonly problem: MessageId | null;
}

function keyOf(from: string, target: string): string {
  return `${from}->${target}`;
}

/**
 * 기대는 줄. 원본 폴더의 선언(`source`)이 있으면 그것이 기준이고(고치는 중인 값), 문제는 같은 줄의 카드 값에서 가져온다.
 * 원본에만 있는 새 줄은 승인 전이라 문제를 모른다(null). 원본이 없으면 카드 값 그대로다
 */
export function dependsOnRowsOf(
  card: readonly CardDependency[],
  source: readonly DependencyInfo[] | null,
): readonly DependencyRow[] {
  const problems = new Map(card.map((line) => [keyOf(line.from, line.target), line.problem]));
  const lines = source ?? card;
  return lines.map((line) => {
    const key = keyOf(line.from, line.target);
    return {
      key,
      from: line.from,
      target: line.target,
      fromMember: splitRegistration(line.from).member,
      kind: line.kind,
      range: line.range,
      problem: cardProblemText(problems.get(key) ?? null),
    };
  });
}

/** 이 플러그인에 기대는 줄(카드 값). 문제는 없다 */
export function dependentRowsOf(card: readonly CardDependency[]): readonly DependencyRow[] {
  return card.map((line) => ({
    key: keyOf(line.from, line.target),
    from: line.from,
    target: line.target,
    fromMember: splitRegistration(line.from).member,
    kind: line.kind,
    range: line.range,
    problem: null,
  }));
}

/** 대상 고르기의 한 줄: 플러그인 전체 또는 그 멤버 */
export interface TargetOption {
  readonly value: string;
  readonly name: PartyName;
}

/**
 * 고를 수 있는 대상: 설치된 플러그인과 그 멤버. 자기 자신(과 자기 멤버)은 뺀다(엔진이 `dependency_self`로 거절한다).
 * 이미 기대는 대상도 뺀다(같은 대상의 줄을 다시 더하면 엔진이 바꾸기로 다룬다: 화면은 지우고 다시 더하게 한다)
 */
export function targetOptionsOf(
  entries: readonly ExtListEntry[],
  self: string,
  taken: readonly string[],
): readonly TargetOption[] {
  const out: TargetOption[] = [];
  for (const entry of entries) {
    if (entry.name === self) continue;
    const ids = [
      entry.name,
      ...entry.plugins.flatMap((p) => (p.id === undefined ? [] : [`${entry.name}/${p.id}`])),
    ];
    for (const id of ids) {
      if (taken.includes(id)) continue;
      out.push({ value: id, name: partyNameOf(id, entries) });
    }
  }
  return out;
}

/** 버전 범위 칸의 문제. 비어 있으면 어느 버전이든 된다(문제 없음). 형식은 엔진이 본다 */
export function rangeProblemOf(range: string): MessageId | null {
  const trimmed = range.trim();
  if (trimmed === "") return null;
  if (trimmed.length > RANGE_MAX) return "desktop.craft.deps.range.tooLong";
  return null;
}

/** 의존 편집이 거절된 까닭. 엔진의 입력 사유(`reasons`)가 있으면 그것으로 가른다 */
export function depsEditFailureText(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.craft.members.fail.offline";
    case "switching":
      return "desktop.craft.members.fail.switching";
    case "rejected": {
      const code = error.reasons?.[0]?.code ?? "";
      if (code === "dependency_self") return "desktop.craft.deps.fail.self";
      if (code === "dependency_range_invalid") return "desktop.craft.deps.fail.rangeInvalid";
      if (code === "dependency_not_found") return "desktop.craft.deps.fail.notFound";
      if (code === "member_not_found") return "desktop.craft.deps.fail.memberNotFound";
      if ((error.issue ?? "").startsWith("denied")) return "desktop.craft.members.fail.denied";
      return "desktop.craft.deps.fail.other";
    }
    case "unsupported":
    case "locked":
    case "not_available":
    case "failed":
      return "desktop.craft.deps.fail.other";
    default:
      return assertNever(error, "depsEditFailureText");
  }
}

// ── 의존 때문에 거절된 것 ──────────────────────────────────────────────

export const REFUSAL_TITLE: Readonly<Record<DependencyRefusalReason, MessageId>> = {
  unmet: "desktop.craft.deps.refusal.unmet",
  required_by: "desktop.craft.deps.refusal.requiredBy",
  breaks_range: "desktop.craft.deps.refusal.breaksRange",
};

/** 거절 한 줄의 문제 말. `range_unmet`은 찾은 버전과 범위를 함께 적는다 */
export function refusalProblemText(
  problem: DependencyProblemKind,
  range: string | null,
  found: string | null,
): { readonly id: MessageId; readonly values: Readonly<Record<string, string>> } {
  switch (problem) {
    case "target_missing":
      return { id: "desktop.craft.deps.item.targetMissing", values: {} };
    case "member_missing":
      return { id: "desktop.craft.deps.item.memberMissing", values: {} };
    case "range_unmet":
      return found === null || range === null
        ? { id: "desktop.craft.deps.problem.rangeUnmet", values: {} }
        : { id: "desktop.craft.deps.item.rangeUnmet", values: { found, range } };
    case "target_disabled":
      return { id: "desktop.craft.deps.item.targetDisabled", values: {} };
    case "depended_on":
      return { id: "desktop.craft.deps.item.dependedOn", values: {} };
    case "cycle":
      return { id: "desktop.craft.deps.item.cycle", values: {} };
    default:
      return assertNever(problem, "dependency problem");
  }
}

/** 프로필 검사의 의존 이슈(`dependency_missing`, `dependency_disabled`, `dependency_range`)의 줄 끝 말. 의존 이슈가 아니면 null */
export function dependencyIssueTextOf(code: string): MessageId | null {
  if (code === "dependency_missing") return "desktop.craft.deps.issue.missing";
  if (code === "dependency_disabled") return "desktop.craft.deps.issue.disabled";
  if (code === "dependency_range") return "desktop.craft.deps.issue.range";
  return null;
}

/**
 * 꺼져 있는 대상(`dependency_disabled`) 때문에 저장이 막혔을 때 고칠 두 길: 대상도 켜기(`enable`, 이슈의 `other`의 플러그인)와
 * 기대는 것도 빼기(`drop`, 이슈의 `plugin`). 두 목록은 겹치지 않게 이름으로 모은다
 */
export function disabledFixOf(
  issues: readonly {
    readonly code: string;
    readonly plugin?: string | null;
    readonly other?: string | null;
  }[],
): { readonly enable: readonly string[]; readonly drop: readonly string[] } {
  const enable = new Set<string>();
  const drop = new Set<string>();
  for (const issue of issues) {
    if (issue.code !== "dependency_disabled") continue;
    const target = issue.other ?? null;
    const from = issue.plugin ?? null;
    if (target !== null) enable.add(splitRegistration(target).plugin);
    if (from !== null) drop.add(from);
  }
  return { enable: [...enable], drop: [...drop] };
}

// ── 엔진이 필요로 하는 플러그인 ──────────────────────────────────────

/** 카드의 `requiredByCore`(엔진의 어느 부분이 이 플러그인을 필요로 하는지). 이름 → 필요로 하는 쪽 */
export function requiredByCoreOf(
  cards: readonly { readonly name: string; readonly requiredByCore?: readonly string[] }[],
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const card of cards) {
    const by = card.requiredByCore ?? [];
    if (by.length > 0) out.set(card.name, by);
  }
  return out;
}

// ── 리뷰 카드의 바뀐 줄 ───────────────────────────────────────────────

/**
 * 카드 비교의 의존 줄(`dependsOn:<from>-><target>`, 자세히 `<kind>, range <범위|any>`)을 값으로 읽는다(엔진 `diff.ts`의 모양).
 * 모양이 다르면 null이라 화면이 원문을 그대로 보인다
 */
export function dependencyChangeOf(
  what: string,
  detail: string | undefined,
): {
  readonly from: string;
  readonly target: string;
  readonly kind: DependencyKind | null;
  readonly range: string | null;
} | null {
  if (!what.startsWith("dependsOn:")) return null;
  const body = what.slice("dependsOn:".length);
  const arrow = body.indexOf("->");
  if (arrow <= 0 || arrow + 2 >= body.length) return null;
  const from = body.slice(0, arrow);
  const target = body.slice(arrow + 2);
  const match = /^(hard|soft), range (.+)$/.exec(detail ?? "");
  const kind = match?.[1] === "hard" ? "hard" : match?.[1] === "soft" ? "soft" : null;
  const rawRange = match?.[2] ?? null;
  return { from, target, kind, range: rawRange === null || rawRange === "any" ? null : rawRange };
}
