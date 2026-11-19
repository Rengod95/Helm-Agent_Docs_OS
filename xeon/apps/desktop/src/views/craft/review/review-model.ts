import { assertNever } from "@fresnel/contracts";
import type { CardScript, PluginCard, ScriptUse } from "@fresnel/contracts/extensions";
import type { Profile, ReviewDecision, ReviewItem } from "@fresnel/contracts/wire";

// Craft 리뷰 화면(C5, `docs/xeon/review/m6/craft-flows.md` 6.12)의 순수 값. 화면 두 판(가·나)이 같이 쓴다.
// 항목은 `pluginReview.list`의 `ReviewItem` 그대로다. 이 파일은 그것을 화면의 줄·칸·경고·결정으로 옮기고, React 밖에서 시험한다
// (test/views/craft/review-model.test.ts).

/** 화면이 가르는 항목 종류. wire의 `new`를 대화에서 만든 드래프트와 그 밖의 새 설치로 나눈다 */
export type EntryKind = "install" | "update" | "draft" | "remove";

/**
 * wire 종류 셋을 화면 종류 넷으로. 대화에서 만든 것(`originThreadId`)과 "룰 추가"로 쓴 한 줄(`user_instruction`)은 드래프트 승인이고,
 * 폴더에서 들인 것과 프로젝트·가져오기 출처는 새 설치다 [제안]
 */
export function entryKindOf(
  item: Pick<ReviewItem, "kind" | "originThreadId" | "provenance">,
): EntryKind {
  switch (item.kind) {
    case "remove":
      return "remove";
    case "update":
      return "update";
    case "new":
      return item.originThreadId !== null || item.provenance === "user_instruction"
        ? "draft"
        : "install";
    default:
      return assertNever(item.kind, "review entry kind");
  }
}

/** 플러그인 종류. 색과 그림은 종류를 가르는 데만 쓴다(디자인 공통 규칙) */
export type PluginKind = "drive" | "hook" | "tool" | "inject";
const KIND_ORDER: readonly PluginKind[] = ["drive", "hook", "tool", "inject"];

function injectsSomething(card: PluginCard): boolean {
  const inject = card.does.inject;
  if (inject === null) return false;
  return (
    inject.instructions.always.length > 0 ||
    inject.instructions.skills.length > 0 ||
    inject.agents.length > 0 ||
    inject.commands.length > 0 ||
    inject.providers.length > 0 ||
    inject.ui.length > 0
  );
}

function providesTools(card: PluginCard): boolean {
  const inject = card.does.inject;
  return inject !== null && (inject.tools.length > 0 || inject.mcpServers.length > 0);
}

/** 카드가 가진 종류(Drive → Hook → 도구 → Inject 순). 아무것도 없으면 Inject 하나로 본다(빈 지침 플러그인) */
export function kindsOf(card: PluginCard): readonly PluginKind[] {
  const has: Record<PluginKind, boolean> = {
    drive: card.does.drive !== null,
    hook: card.does.hook !== null && card.does.hook.hooks.length > 0,
    tool: providesTools(card),
    inject: injectsSomething(card),
  };
  const kinds = KIND_ORDER.filter((kind) => has[kind]);
  return kinds.length === 0 ? ["inject"] : kinds;
}

/** 줄의 타일에 쓰는 대표 종류 */
export function primaryKindOf(card: PluginCard): PluginKind {
  return kindsOf(card)[0] ?? "inject";
}

/**
 * 훅이 붙는 자리. 내부 이름(`tool.call.before`)을 사용자에게 보이지 않으므로 무리(입력, 모델 요청, 도구 호출, 턴, 대화)와
 * 앞·뒤로 줄인다. 모르는 이름은 `other`다
 */
type PlaceGroup = "input" | "request" | "tool" | "turn" | "thread" | "other";
export interface Place {
  readonly group: PlaceGroup;
  readonly side: "before" | "after" | null;
}

/** 훅 이름 첫 마디 → 무리. `guard`·`boundary`는 둘째 마디로 가른다 */
const PLACE_BY_HEAD: ReadonlyMap<string, PlaceGroup> = new Map([
  ["input", "input"],
  ["request", "request"],
  ["tool", "tool"],
  ["thread", "thread"],
]);
const GUARD_PLACE: ReadonlyMap<string, PlaceGroup> = new Map([
  ["model", "request"],
  ["tool", "tool"],
]);
const TURN_BOUNDARIES: ReadonlySet<string> = new Set(["turn", "step", "settle", "message"]);

function placeGroupOf(head: string, second: string): PlaceGroup {
  if (head === "guard") return GUARD_PLACE.get(second) ?? "turn";
  if (head === "boundary") return TURN_BOUNDARIES.has(second) ? "turn" : "other";
  return PLACE_BY_HEAD.get(head) ?? "other";
}

export function placeOf(hookName: string): Place {
  const parts = hookName.split(".");
  const last = parts[parts.length - 1];
  const side = last === "before" ? "before" : last === "after" ? "after" : null;
  return { group: placeGroupOf(parts[0] ?? "", parts[1] ?? ""), side };
}

/** 카드의 훅이 붙는 자리(같은 자리는 한 번, 처음 나온 순서) */
export function placesOf(card: PluginCard): readonly Place[] {
  const hooks = card.does.hook?.hooks ?? [];
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const hook of hooks) {
    // 카드의 `position`은 흐름 그림의 블록 자리("event", "context.before")라 사람이 읽는 무리를 가르지 못한다. 훅 이름으로 가른다
    const place = placeOf(hook.name);
    const key = `${place.group}:${place.side ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  return places;
}

/**
 * 승인하면 실행될 것 한 줄. 스크립트(매니페스트 `scripts`), 로컬 MCP 서버(stdio), 코드로 도는 Hook·Drive.
 * 명령은 실행기와 인자를 띄어 쓴 한 줄이고 환경 변수는 이름만 있다(값은 카드에 없다)
 */
export type RunLine =
  | {
      readonly kind: "script";
      readonly name: string;
      readonly command: string;
      /** 없으면 엔진이 이 칸을 채우지 않은 옛 카드다(`CardScript.uses`가 선택 필드) */
      readonly uses: readonly ScriptUse[] | null;
      readonly timeoutMs: number;
      readonly envNames: readonly string[];
    }
  | {
      readonly kind: "server";
      readonly name: string;
      /** http 서버는 실행 명령이 없다 */
      readonly command: string | null;
      readonly envNames: readonly string[];
    };

function commandLine(launch: {
  readonly command: string;
  readonly args: readonly string[];
}): string {
  return [launch.command, ...launch.args].join(" ");
}

function scriptLine(script: CardScript): RunLine {
  return {
    kind: "script",
    name: script.name,
    command: commandLine(script.launch),
    uses: script.uses ?? null,
    timeoutMs: script.timeoutMs,
    envNames: script.launch.envNames,
  };
}

/** 승인하면 실행될 명령들. 스크립트가 먼저, 그다음 MCP 서버다 */
export function runLinesOf(card: PluginCard): readonly RunLine[] {
  const inject = card.does.inject;
  if (inject === null) return [];
  const scripts = (inject.scripts ?? []).map(scriptLine);
  const servers = inject.mcpServers.map((server): RunLine => ({
    kind: "server",
    name: server.name,
    command:
      server.launch === undefined || server.launch === null ? null : commandLine(server.launch),
    envNames: server.launch?.envNames ?? [],
  }));
  return [...scripts, ...servers];
}

/**
 * 코드 실행 안내(늘 보이는 경고 한 줄, AGE-14·AC-51). 코드가 도는 플러그인에만 있다. 스크립트가 시스템 도구나 네트워크를 쓰면
 * 그 사실을 같은 줄에 더한다. 문구는 "격리돼 안전하다"가 아니라 파일 범위에 한정해 말한다
 */
export interface CodeNotice {
  readonly isolated: boolean | null;
  readonly systemTools: boolean;
  readonly network: boolean;
  /** 스크립트 가운데 `uses`가 없는 옛 카드가 있어 알 수 없는 것이 있다 */
  readonly usesUnknown: boolean;
}

export function codeNoticeOf(card: PluginCard): CodeNotice | null {
  const runs = runLinesOf(card);
  if (!card.runs.code && runs.length === 0) return null;
  const scripts = runs.flatMap((line) => (line.kind === "script" ? [line] : []));
  return {
    isolated: card.runs.isolated,
    systemTools: scripts.some((line) => line.uses?.includes("system_tools") === true),
    network: scripts.some((line) => line.uses?.includes("network") === true),
    usesUnknown: scripts.some((line) => line.uses === null),
  };
}

/** 이 항목에서 보여야 할 경고. 순서는 무게 순이다 */
export type Warning =
  | "handEdit"
  | "purposeMissing"
  | "enforcedNow"
  | "costUp"
  | "projectCode"
  | "managedOff";

/** `managedOff`는 관리자가 이 플러그인을 꺼 둔 경우다(`ext.list`의 `enabledSource: managed`) */
export function warningsOf(item: ReviewItem, managedOff: boolean): readonly Warning[] {
  const out: Warning[] = [];
  if (item.kind !== "remove" && item.provenance === "unknown") out.push("handEdit");
  if (managedOff) out.push("managedOff");
  if (item.kind !== "remove" && (item.card.purpose ?? "").trim() === "") out.push("purposeMissing");
  const change = item.diff.enforcementChange;
  if (change !== null && change.from === "advisory" && change.to === "enforced") {
    out.push("enforcedNow");
  }
  if ((item.diff.costDelta.always ?? 0) > 0) out.push("costUp");
  if (item.provenance === "project" && item.card.runs.code) out.push("projectCode");
  return out;
}

/** 승인을 막는 이유. 없으면 null이다. 목적 문장은 승인하면서 채울 수 있으므로 막지 않는다(§4.7.6) */
export type ApproveBlock = "notPending" | "handEdit";
export function approveBlockOf(item: ReviewItem): ApproveBlock | null {
  if (item.state !== "pending") return "notPending";
  if (item.kind !== "remove" && item.provenance === "unknown") return "handEdit";
  return null;
}

/** 대기 항목(오래된 것부터, 받은 요청 패널의 기본 정렬과 같다) */
export function pendingOf(items: readonly ReviewItem[]): readonly ReviewItem[] {
  return items
    .filter((item) => item.state === "pending")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.itemId.localeCompare(b.itemId));
}

/** 비교 대상 검토본을 승인한 지난 항목. 파일 목록과 해시가 거기에 있다. 없으면(내장, 옮긴 것, 지운 기록) null */
export function baseItemOf(
  items: readonly ReviewItem[],
  item: Pick<ReviewItem, "baseHash" | "itemId">,
): ReviewItem | null {
  if (item.baseHash === null) return null;
  return (
    items.find(
      (other) =>
        other.itemId !== item.itemId &&
        other.state === "approved" &&
        other.candidateHash === item.baseHash,
    ) ?? null
  );
}

type FileChange = "added" | "changed" | "removed" | "same";
export interface FileRow {
  readonly path: string;
  readonly change: FileChange;
  readonly bytes: number;
  /** 후보 스냅샷에 있어 `pluginReview.file`로 읽을 수 있다 */
  readonly readable: boolean;
}

/**
 * 이전 승인 버전과의 파일 차이. 내용 해시(sha256)로 견준다. 이전 버전의 파일 목록을 모르면(`base`가 null) 새 플러그인은
 * 모두 추가이고, 갱신은 바뀜으로 본다(무엇이 같은지 알 수 없다). 바뀐 것 → 추가 → 지움 → 같음, 같은 무리 안에서는 경로 순
 */
export function fileRowsOf(item: ReviewItem, base: ReviewItem | null): readonly FileRow[] {
  const before = new Map((base?.files ?? []).map((file) => [file.path, file]));
  const rows: FileRow[] = item.files.map((file) => {
    const old = before.get(file.path);
    const change: FileChange =
      old === undefined
        ? base === null && item.kind === "update"
          ? "changed"
          : "added"
        : old.sha256 === file.sha256
          ? "same"
          : "changed";
    return { path: file.path, change, bytes: file.bytes, readable: true };
  });
  const after = new Set(item.files.map((file) => file.path));
  for (const old of base?.files ?? []) {
    if (!after.has(old.path)) {
      rows.push({ path: old.path, change: "removed", bytes: old.bytes, readable: false });
    }
  }
  const rank: Record<FileChange, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.toSorted((a, b) => rank[a.change] - rank[b.change] || a.path.localeCompare(b.path));
}

/** 차이 보기의 첫 파일: 바뀐 것이 있으면 그 첫째, 없으면 첫 줄 */
export function firstFileOf(rows: readonly FileRow[]): string | null {
  const first = rows.find((row) => row.change !== "same" && row.readable) ?? rows[0];
  return first?.path ?? null;
}

/** 넘기기(]·[): 읽을 수 있는 파일 사이를 돈다. 끝에서 멈춘다 */
export function stepFile(
  rows: readonly FileRow[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  const readable = rows.filter((row) => row.readable);
  if (readable.length === 0) return null;
  const index = readable.findIndex((row) => row.path === current);
  if (index < 0) return readable[0]?.path ?? null;
  const next = Math.min(readable.length - 1, Math.max(0, index + delta));
  return readable[next]?.path ?? null;
}

/** 해시를 사람이 견줄 만큼만(앞 12자리) */
export function shortHash(hash: string | null): string | null {
  if (hash === null) return null;
  const hex = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return hex.slice(0, 12);
}

/**
 * 승인 대상. 새 플러그인은 보관만이 기본이다: 엔진은 승인한 새 플러그인을 다시 시작하기 전에는 프로필에 넣지 못한다
 * (실제 엔진에서 `profile.invalid`(3656)로 거절됨, enK6 보고) [제안]. 그 밖에는 만든 대화의 프로필, 없으면 보관만이다
 */
export type Target =
  | { readonly kind: "profile"; readonly profileId: string }
  | { readonly kind: "library" };

export function defaultTargetOf(
  item: Pick<ReviewItem, "originProfileId" | "kind">,
  profiles: readonly Pick<Profile, "id">[],
): Target {
  const origin = item.originProfileId;
  if (item.kind !== "new" && origin !== null && profiles.some((profile) => profile.id === origin)) {
    return { kind: "profile", profileId: origin };
  }
  return { kind: "library" };
}

/**
 * 승인 결정. 갱신은 이미 그 플러그인을 쓰는 프로필 모두에 새 버전이 들어가므로(§4.7.3, `profileIds: []`) 대상을 묻지 않는다.
 * 제거는 대상이 없다. 목적 문장이 비었으면 승인하면서 채운다
 */
export function approveDecisionOf(
  item: Pick<ReviewItem, "kind">,
  target: Target,
  purpose: string,
): ReviewDecision {
  const filled = purpose.trim();
  const extra = filled === "" ? {} : { purpose: filled };
  if (item.kind !== "new") return { kind: "approve", profileIds: [], libraryOnly: false, ...extra };
  return target.kind === "profile"
    ? { kind: "approve", profileIds: [target.profileId], libraryOnly: false, ...extra }
    : { kind: "approve", profileIds: [], libraryOnly: true, ...extra };
}

/** 거절. 사유를 적으면 만든 대화로 돌려보내고(`sendBack`), 비우면 버린다(`discard`) [제안] */
export function rejectDecisionOf(reason: string): ReviewDecision {
  const filled = reason.trim().slice(0, 2000);
  return filled === "" ? { kind: "discard" } : { kind: "sendBack", reason: filled };
}

/** 결정이 실패한 이유. wire 오류 번호(3650~3669)와 연결 상태에서 고른다 */
export type DecideFailure =
  | "offline"
  | "switching"
  | "notPending"
  | "notFound"
  | "handEdit"
  | "purposeRequired"
  | "profileInvalid"
  | "failed";

const FAILURE_BY_CODE: ReadonlyMap<number, DecideFailure> = new Map([
  [3651, "notFound"],
  [3652, "notPending"],
  [3654, "handEdit"],
  [3655, "purposeRequired"],
  [3656, "profileInvalid"],
]);

export function decideFailureOf(error: {
  readonly kind: string;
  readonly code?: number | null;
}): DecideFailure {
  if (error.kind === "offline") return "offline";
  if (error.kind === "switching") return "switching";
  if (error.kind !== "rejected" || error.code === undefined || error.code === null) return "failed";
  return FAILURE_BY_CODE.get(error.code) ?? "failed";
}

/**
 * 승인 뒤 화면이 알릴 것. `profiles`는 승인이 넣은 프로필(`appliedTo`)의 이름이고, `library`면 어느 프로필에도 넣지 않았다.
 * `restart`는 새 플러그인을 엔진을 다시 시작한 뒤에야 프로필에 넣을 수 있다는 안내다(엔진의 알려진 제약, enK6 보고)
 */
export interface ApproveOutcome {
  readonly profiles: readonly string[];
  readonly library: boolean;
  readonly restart: boolean;
}

export function approveOutcomeOf(
  item: Pick<ReviewItem, "kind">,
  appliedTo: readonly string[],
  profiles: readonly Pick<Profile, "id" | "title">[],
): ApproveOutcome {
  const names = appliedTo.map((id) => profiles.find((p) => p.id === id)?.title ?? id);
  return {
    profiles: names,
    library: item.kind === "new" && appliedTo.length === 0,
    restart: item.kind === "new",
  };
}

/** 화면 키(목록 이동, 승인·거절, 파일 넘기기). 입력 칸 안에서는 부르지 않는다 */
export type ReviewKey = "next" | "prev" | "approve" | "reject" | "nextFile" | "prevFile";

const KEY_ACTIONS: ReadonlyMap<string, ReviewKey> = new Map([
  ["j", "next"],
  ["ArrowDown", "next"],
  ["k", "prev"],
  ["ArrowUp", "prev"],
  ["a", "approve"],
  ["r", "reject"],
  ["]", "nextFile"],
  ["[", "prevFile"],
]);

export function reviewKeyOf(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}): ReviewKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return KEY_ACTIONS.get(event.key) ?? null;
}

/** 목록 이동. 끝에서 멈추고, 고른 것이 없으면 첫 줄이다 */
export function stepItem(
  ids: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index < 0) return ids[0] ?? null;
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))] ?? null;
}

/** 결정 뒤 고를 다음 항목: 같은 자리의 다음, 없으면 앞, 그것도 없으면 null */
export function nextAfter(ids: readonly string[], decided: string): string | null {
  const index = ids.indexOf(decided);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** 바이트를 짧게(1.2 KB). 화면 숫자 서식은 부르는 쪽이 정한다 */
export function sizeOf(bytes: number): {
  readonly unit: "B" | "KB" | "MB";
  readonly value: number;
} {
  if (bytes < 1024) return { unit: "B", value: bytes };
  if (bytes < 1024 * 1024) return { unit: "KB", value: Math.round((bytes / 1024) * 10) / 10 };
  return { unit: "MB", value: Math.round((bytes / 1024 / 1024) * 10) / 10 };
}
