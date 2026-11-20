import { assertNever } from "@fresnel/contracts";
import type {
  CardScript,
  CardScriptEnv,
  HookPower,
  PluginCard,
  ScriptUse,
} from "@fresnel/contracts/extensions";
import type { Profile, ReviewDecision, ReviewItem } from "@fresnel/contracts/wire";

// Craft 리뷰 화면(C5, `docs/xeon/review/m6/craft-flows.md` 6.12)의 순수 값.
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
 * 누가 지키는가(요약 띠의 칩과 권한과 위험의 "지키는 쪽"). 엔진 값은 `card.enforcement` 하나다: Drive이거나 `tap`이 아닌 훅이 있으면 `enforced`,
 * 아니면 `advisory`(`apps/host/src/assembly/plugins/card.ts`). `advisory`는 "엔진이 강제하지 않는다"는 뜻이지 "모델이 고른다"는 뜻이 아니다.
 * 모델에 싣는 것(지침, 스킬, 도구)이 없고 `tap` 훅만 가진 플러그인은 엔진이 정해진 자리에서 돌리되 막거나 바꾸지 않으므로 `watch`다(m6R4)
 */
export type Keeper = "engine" | "watch" | "model";
export function keeperOf(card: PluginCard): Keeper {
  if (card.enforcement === "enforced") return "engine";
  const kinds = kindsOf(card);
  return kinds.length === 1 && kinds[0] === "hook" ? "watch" : "model";
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
      /** 가져온 훅(환경 모드)이면 원래 명령, 셸, 찾지 못한 실행 파일, 읽는 파일. 아니면 null이다 */
      readonly env: CardScriptEnv | null;
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
    env: script.env ?? null,
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
 * 코드 실행 안내(늘 보이는 경고, AGE-14·AC-51). 코드가 도는 플러그인에만 있다. 세 갈래다(m6R4, 엔진 값은 `CardScript.uses`와 `env`):
 * - `narrow`: Fresnel에서 만든 플러그인의 스크립트. 자기 폴더 밖을 읽거나 쓰지 못한다. 시스템 도구나 네트워크를 쓰면 같은 칸에 더한다.
 * - `userFull`: 가져온 훅(환경 모드)의 기본값 `user_full_access`. 사용자의 셸 명령 그대로, 사용자 권한으로 돈다. Fresnel이 막지 않는다.
 * - `sandboxed`: 같은 훅을 설정 `l0.sandbox.sandboxImportedHooks`로 샌드박스 안에서 돌릴 때(`read_wide`, `write_project`).
 * 한 플러그인에 둘이 섞이면 가장 넓은 쪽을 말한다(userFull → sandboxed → narrow)
 */
export interface CodeNotice {
  readonly mode: "narrow" | "userFull" | "sandboxed";
  readonly isolated: boolean | null;
  readonly systemTools: boolean;
  readonly network: boolean;
  /** 스크립트 가운데 `uses`가 없는 옛 카드가 있어 알 수 없는 것이 있다 */
  readonly usesUnknown: boolean;
}

type ScriptLine = Extract<RunLine, { readonly kind: "script" }>;

function usesAny(scripts: readonly ScriptLine[], use: ScriptUse): boolean {
  return scripts.some((line) => line.uses?.includes(use) === true);
}

export function codeNoticeOf(card: PluginCard): CodeNotice | null {
  const runs = runLinesOf(card);
  if (!card.runs.code && runs.length === 0) return null;
  const scripts = runs.flatMap((line): ScriptLine[] => (line.kind === "script" ? [line] : []));
  const mode: CodeNotice["mode"] = usesAny(scripts, "user_full_access")
    ? "userFull"
    : usesAny(scripts, "read_wide") || usesAny(scripts, "write_project")
      ? "sandboxed"
      : "narrow";
  return {
    mode,
    isolated: card.runs.isolated,
    systemTools: usesAny(scripts, "system_tools"),
    network: usesAny(scripts, "network"),
    usesUnknown: scripts.some((line) => line.uses === null),
  };
}

/**
 * 목적 문장의 기본값(m6R4: 사용자가 처음부터 쓰지 않고, 채워진 문장을 고칠 때만 고친다). 모델을 부르지 않는다.
 * 1) 엔진 값: 카드의 `purpose`가 있으면 묻지 않는다(이 함수를 부르지 않는다). 도구 하나만 주고 그 도구에 설명이 있으면 그 설명이다.
 * 2) 카드의 사실: 대표 종류(Drive → Hook → 도구 → Inject)로 한 문장을 조립한다.
 * 내부 부품(`internal`)은 리뷰 대상이 아니므로 비워 둔다
 */
export type PurposeDraft =
  | { readonly kind: "none" }
  | { readonly kind: "toolText"; readonly text: string }
  | { readonly kind: "drive"; readonly command: string | null; readonly start: boolean }
  | { readonly kind: "hook"; readonly place: Place; readonly power: HookPower }
  | { readonly kind: "tools"; readonly names: readonly string[] }
  | { readonly kind: "server"; readonly name: string }
  | { readonly kind: "skill"; readonly name: string }
  | { readonly kind: "instructions" };

/** 한 훅의 힘 가운데 가장 센 것(막기 → 고치기 → 더하기 → 보기) */
const POWER_ORDER: readonly HookPower[] = ["decide", "modify", "contribute", "observe"];

export function purposeDraftOf(card: PluginCard): PurposeDraft {
  if (card.internal === true) return { kind: "none" };
  const inject = card.does.inject;
  const tools = inject?.tools ?? [];
  const only = tools.length === 1 ? tools[0] : undefined;
  const described = only?.description?.trim() ?? "";
  if (described !== "" && (inject?.mcpServers.length ?? 0) <= 1) {
    return { kind: "toolText", text: described.slice(0, 200) };
  }
  const primary = primaryKindOf(card);
  switch (primary) {
    case "drive": {
      const drive = card.does.drive;
      return { kind: "drive", command: drive?.commands[0] ?? null, start: drive?.start ?? false };
    }
    case "hook": {
      const hooks = card.does.hook?.hooks ?? [];
      const powers = new Set(hooks.flatMap((hook) => hook.powers));
      const power = POWER_ORDER.find((p) => powers.has(p)) ?? "observe";
      const first = hooks.find((hook) => hook.powers.includes(power)) ?? hooks[0];
      if (first === undefined) return { kind: "none" };
      return { kind: "hook", place: placeOf(first.name), power };
    }
    case "tool": {
      if (tools.length > 0) return { kind: "tools", names: tools.map((tool) => tool.name) };
      const server = inject?.mcpServers[0];
      return server === undefined ? { kind: "none" } : { kind: "server", name: server.name };
    }
    case "inject": {
      const skills = inject?.instructions.skills ?? [];
      const skill = skills.length === 1 ? skills[0] : undefined;
      if (skill !== undefined) return { kind: "skill", name: skill.name };
      return (inject?.instructions.always.length ?? 0) > 0
        ? { kind: "instructions" }
        : { kind: "none" };
    }
    default:
      return assertNever(primary, "purpose draft kind");
  }
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

/** 비교 대상 검토본을 승인한 지난 항목(지난 버전 번호를 읽는다). 목록에 없으면(내장, 옮긴 것, 지운 기록) null */
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
  /** 새 판의 크기. 지운 파일은 지난 판의 크기다 */
  readonly bytes: number;
  /** `pluginReview.file`로 읽을 수 있는 쪽. 새 판은 `files`, 지난 승인 버전은 `baseFiles`에 있는 경로다 */
  readonly sides: { readonly candidate: boolean; readonly base: boolean };
}

/**
 * 지난 승인 버전과의 파일 차이. 엔진이 준 지난 판의 목록(`ReviewItem.baseFiles`)과 내용 해시(sha256)로 견준다.
 * 지난 판이 없으면(`baseFiles` 없음) 새 플러그인은 모두 새 파일이고, 갱신은 무엇이 같은지 알 수 없어 모두 바뀐 것으로 본다.
 * 바뀐 것 → 새 파일 → 지움 → 같음, 같은 무리 안에서는 경로 순
 */
export function fileRowsOf(
  item: Pick<ReviewItem, "kind" | "files" | "baseFiles">,
): readonly FileRow[] {
  const baseFiles = item.baseFiles;
  const before = new Map((baseFiles ?? []).map((file) => [file.path, file]));
  const rows: FileRow[] = item.files.map((file) => {
    const old = before.get(file.path);
    if (old === undefined) {
      const unknownBase = baseFiles === undefined && item.kind === "update";
      return {
        path: file.path,
        change: unknownBase ? "changed" : "added",
        bytes: file.bytes,
        sides: { candidate: true, base: false },
      };
    }
    return {
      path: file.path,
      change: old.sha256 === file.sha256 ? "same" : "changed",
      bytes: file.bytes,
      sides: { candidate: true, base: true },
    };
  });
  const after = new Set(item.files.map((file) => file.path));
  for (const old of baseFiles ?? []) {
    if (!after.has(old.path)) {
      rows.push({
        path: old.path,
        change: "removed",
        bytes: old.bytes,
        sides: { candidate: false, base: true },
      });
    }
  }
  const rank: Record<FileChange, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.toSorted((a, b) => rank[a.change] - rank[b.change] || a.path.localeCompare(b.path));
}

/** 차이 보기의 첫 파일: 바뀐 것이 있으면 그 첫째, 없으면 첫 줄 */
export function firstFileOf(rows: readonly FileRow[]): string | null {
  const first = rows.find((row) => row.change !== "same") ?? rows[0];
  return first?.path ?? null;
}

/** 넘기기(]·[): 보이는 파일 사이를 돈다(같은 파일은 바뀐 것이 있으면 목록에서 빠진다). 끝에서 멈춘다 */
export function stepFile(
  rows: readonly FileRow[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (rows.length === 0) return null;
  const index = rows.findIndex((row) => row.path === current);
  if (index < 0) return rows[0]?.path ?? null;
  const next = Math.min(rows.length - 1, Math.max(0, index + delta));
  return rows[next]?.path ?? null;
}

/** 목록에 보일 파일: 바뀐 것이 있으면 바뀐 것만(같은 파일은 수로 접는다), 없으면 전부 */
export function shownFilesOf(rows: readonly FileRow[]): readonly FileRow[] {
  const changed = rows.filter((row) => row.change !== "same");
  return changed.length > 0 ? changed : rows;
}

/** 해시를 사람이 견줄 만큼만(앞 12자리) */
export function shortHash(hash: string | null): string | null {
  if (hash === null) return null;
  const hex = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return hex.slice(0, 12);
}

/**
 * 승인 대상(새 플러그인만 묻는다). 기본은 만든 대화의 프로필이고, 그 프로필이 없으면 고르지 않은 채로 두어 사람이 고르게 한다
 * (craft-flows 6.12 "기본은 만든 대화의 프로필, 보관만 가능"). 보관만 하기도 고를 수 있다
 */
export type Target =
  | { readonly kind: "profile"; readonly profileId: string }
  | { readonly kind: "library" }
  | { readonly kind: "unset" };

export function defaultTargetOf(
  item: Pick<ReviewItem, "originProfileId">,
  profiles: readonly Pick<Profile, "id">[],
): Target {
  const origin = item.originProfileId;
  if (origin !== null && profiles.some((profile) => profile.id === origin)) {
    return { kind: "profile", profileId: origin };
  }
  return { kind: "unset" };
}

/** 새 플러그인은 넣을 곳을 골라야 승인할 수 있다 */
export function needsTarget(item: Pick<ReviewItem, "kind">, target: Target): boolean {
  return item.kind === "new" && target.kind === "unset";
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
  if (item.kind !== "new" || target.kind === "unset") {
    return { kind: "approve", profileIds: [], libraryOnly: false, ...extra };
  }
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
 * 승인 뒤 화면이 알릴 것. `profiles`는 승인이 넣은 프로필(`appliedTo`)의 이름이고, `library`면 새 플러그인을 어느 프로필에도 넣지 않았다.
 * 엔진은 승인과 함께 프로필에 넣는다. 다시 시작할 일은 없다(enRv가 실제 엔진으로 새 설치·가져오기·드래프트·갱신을 확인)
 */
export interface ApproveOutcome {
  readonly profiles: readonly string[];
  readonly library: boolean;
  /**
   * 넣은 프로필이 이미 가리키던, 지금 이 기기에 없는 플러그인(엔진의 `missingPlugins`). 거절이 아니라 경고다: 실행 때 건너뛴다
   * [결정: 2026-11-20, 사용자, AGE-34]
   */
  readonly missing: readonly string[];
}

export function approveOutcomeOf(
  item: Pick<ReviewItem, "kind">,
  appliedTo: readonly string[],
  profiles: readonly Pick<Profile, "id" | "title">[],
  missingPlugins: readonly string[] = [],
): ApproveOutcome {
  const names = appliedTo.map((id) => profiles.find((p) => p.id === id)?.title ?? id);
  return {
    profiles: names,
    library: item.kind === "new" && appliedTo.length === 0,
    missing: [...new Set(missingPlugins)],
  };
}

/**
 * 넣을 곳을 고를 때 미리 보이는 "이 기기에 없는 플러그인": 프로필과 베이스(공통 묶음)가 가리키지만 `ext.list`에 없는 이름.
 * 미리 보기일 뿐이고 승인 결과의 `missingPlugins`가 정본이다. 설치 목록을 못 읽었으면(`installed` null) 아무것도 말하지 않는다
 * (모르는 것을 없다고 그리지 않는다)
 */
export function missingByProfileOf(
  profiles: readonly Pick<Profile, "id" | "plugins">[],
  common: { readonly plugins: readonly { readonly name: string }[] } | null,
  installed: ReadonlySet<string> | null,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  if (installed === null) return out;
  const base = common?.plugins.map((ref) => ref.name) ?? [];
  for (const profile of profiles) {
    const names = [...new Set([...profile.plugins.map((ref) => ref.name), ...base])].filter(
      (name) => !installed.has(name),
    );
    if (names.length > 0) out.set(profile.id, names);
  }
  return out;
}

/** 고른 프로필의 없는 플러그인. 지금 리뷰하는 플러그인 자신은 승인하면 생기므로 뺀다 */
export function missingForTarget(
  missing: ReadonlyMap<string, readonly string[]>,
  target: Target,
  itemName: string,
): readonly string[] {
  if (target.kind !== "profile") return [];
  return (missing.get(target.profileId) ?? []).filter((name) => name !== itemName);
}

/** 버전 줄. 갱신이면 지난 승인 항목의 카드 버전과 견준다. 엔진이 버전을 주지 않은 카드(매니페스트에 없음)는 null이다 */
export interface Versions {
  readonly now: string | null;
  readonly before: string | null;
}

export function versionsOf(item: ReviewItem, items: readonly ReviewItem[]): Versions {
  const before = item.kind === "update" ? (baseItemOf(items, item)?.card.version ?? null) : null;
  return { now: item.card.version ?? null, before: before === item.card.version ? null : before };
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
