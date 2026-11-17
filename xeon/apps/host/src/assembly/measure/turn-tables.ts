// 턴 기록 테이블(`measure.db`의 `tr_*`, 문서 `review/m5/turn-record-metrics.md` §3.4)의 열 정의다.
// 저장소는 열 값과 `recordJson`(문자열)만 다룬다. 계약 타입(`wire/turn-record.ts`)은 import하지 않는다.
// 행 인터페이스의 속성은 열 이름을 camelCase로 바꾼 것이다. 불리언은 INTEGER 0·1로 쓰고 읽는다.

/** 열에 쓰는 값 */
export type SqlValue = string | number | null;

/** 읽은 행의 열 값 묶음. 저장소가 쓴 값만 읽으므로 모양이 어긋난 칸은 0 또는 빈 값으로 읽는다 */
export type Cols = Readonly<Record<string, unknown>>;

/** 턴 기록 스키마 버전(`PRAGMA user_version`). 1은 기존 `measure_raw`·`measure_daily`, 2는 이 파일의 `tr_*` */
export const TURN_RECORD_VERSION = 2;

export function colsOf(row: unknown): Cols {
  const cols: Record<string, unknown> = {};
  if (typeof row !== "object" || row === null) return cols;
  for (const [key, value] of Object.entries(row)) cols[key] = value;
  return cols;
}

export function colText(cols: Cols, name: string): string {
  const value = cols[name];
  return typeof value === "string" ? value : "";
}

export function colTextOrNull(cols: Cols, name: string): string | null {
  const value = cols[name];
  return typeof value === "string" ? value : null;
}

export function colNum(cols: Cols, name: string): number {
  const value = cols[name];
  return typeof value === "number" ? value : 0;
}

export function colNumOrNull(cols: Cols, name: string): number | null {
  const value = cols[name];
  return typeof value === "number" ? value : null;
}

function colFlag(cols: Cols, name: string): boolean {
  return colNum(cols, name) !== 0;
}

function colFlagOrNull(cols: Cols, name: string): boolean | null {
  const value = colNumOrNull(cols, name);
  return value === null ? null : value !== 0;
}

function flag(value: boolean): number {
  return value ? 1 : 0;
}

function flagOrNull(value: boolean | null): number | null {
  return value === null ? null : flag(value);
}

// ---- 행 타입 -------------------------------------------------------------

export interface TrThreadRow {
  readonly threadId: string;
  readonly scopeKind: string;
  readonly testBaseProfile: string | null;
  readonly testTarget: string | null;
  readonly runGroupId: string | null;
  readonly inputHash: string | null;
  readonly createdAt: number;
  readonly draftJson: string | null;
}

export interface TrTurnRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly status: string;
  readonly origin: string;
  readonly scopeKind: string;
  readonly profileId: string | null;
  readonly profileRev: number | null;
  readonly profileRevChangesJson: string | null;
  readonly overlayJson: string | null;
  readonly pluginStderrJson: string | null;
  readonly level: string;
  readonly complete: boolean;
  readonly model: string | null;
  /** 턴 플래그의 정수 비트. 거르기용 사본이다 */
  readonly flags: number;
  /** `TurnRecord` 전체. 저장소는 읽거나 고치지 않는다(`markLostTurns`가 두 칸만 바꾼다) */
  readonly recordJson: string;
  readonly recordBytes: number;
  readonly startedEventId: string | null;
}

export interface TrStepRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly model: string | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly retries: number;
  readonly advCount: number;
  readonly advTokens: number;
  readonly deferredCount: number;
  readonly toolsetFp: string | null;
  readonly materialsFp: string | null;
  readonly recorded: boolean;
}

export interface TrCallRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly stepIndex: number | null;
  readonly tool: string;
  readonly plugin: string;
  readonly caller: string;
  readonly callerPlugin: string | null;
  readonly via: string | null;
  readonly inheritedFrom: string | null;
  readonly verdict: string;
  readonly blockedPlugin: string | null;
  readonly blockedHook: string | null;
  readonly callKey: string;
  readonly targetKey: string | null;
  readonly execMs: number | null;
  readonly execStatus: string | null;
  readonly resultTokens: number | null;
  readonly resultTruncated: boolean | null;
  readonly resultItemId: string | null;
  readonly metaJson: string;
}

export interface TrHookRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly seqGlobal: number;
  readonly hook: string;
  readonly registrationId: string;
  readonly plugin: string;
  readonly versionId: string | null;
  readonly toolCallId: string | null;
  readonly subjectJson: string;
  readonly decision: string;
  readonly result: string;
  readonly reason: string | null;
  readonly askVia: string | null;
  readonly askWaits: number | null;
  readonly askMs: number | null;
  readonly askAnswer: string | null;
  readonly ms: number;
  readonly atMs: number;
  readonly size: number;
  readonly skippedBy: string | null;
  readonly decisionText: string | null;
}

export interface TrMaterialRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly ref: string;
  readonly plugin: string;
  readonly kind: string;
  readonly material: string;
  readonly tokens: number;
  readonly truncated: boolean;
  readonly omitted: number | null;
  readonly itemId: string | null;
  readonly attribution: string;
}

export interface TrToolUseRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly tool: string;
  readonly plugin: string;
  readonly tokens: number;
  readonly state: string;
  readonly called: number;
}

export interface TrSkillRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly skill: string;
  readonly plugin: string;
  readonly listed: boolean;
  readonly read: boolean;
  readonly via: string | null;
  readonly stepIndex: number | null;
  readonly tokens: number | null;
}

export interface TrFrameRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly leaseId: string;
  readonly depth: number;
  readonly plugin: string | null;
  readonly versionId: string | null;
  readonly parentLeaseId: string | null;
  readonly enteredAtMs: number;
  readonly exitedAtMs: number | null;
  readonly exitReason: string | null;
  readonly lowerResumedWith: string | null;
  readonly limitsJson: string;
  readonly usedJson: string;
  readonly userMessages: number;
}

export interface TrPluginCallRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly seq: number;
  readonly plugin: string;
  readonly capability: string;
  readonly method: string;
  readonly requestKey: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly via: string | null;
  readonly toolCallId: string | null;
}

export interface TrCacheRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly n: number;
  readonly observed: boolean;
  readonly kind: string;
  readonly plugin: string | null;
  /** 등록 id 목록의 JSON 문자열 */
  readonly registrations: string;
  readonly evidence: string | null;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly priorCacheRead: number | null;
  readonly priorCacheWrite: number | null;
}

export interface TrMarkRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly ref: string;
  readonly mark: string;
  readonly plugin: string | null;
  readonly markedAt: number;
}

export interface TrFindingStateRow {
  readonly findingId: string;
  readonly state: string;
  readonly dismissedAt: number | null;
  readonly snoozeUntil: number | null;
  readonly fingerprint: string;
}

/** `tr_daily`의 키. 대화 id, 도구 인자, 훅 사유 본문은 키에 들어가지 않는다 */
export interface DailyKey {
  readonly day: string;
  readonly subject: string;
  readonly plugin: string;
  readonly ref: string;
  readonly model: string;
  readonly profile: string;
  readonly scopeKind: string;
  readonly caller: string;
  readonly counter: string;
}

export interface TrDailyRow extends DailyKey {
  readonly n: number;
  readonly sum: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly histJson: string | null;
}

/** 턴 하나의 기록 묶음(`readTurn`). 하위 행은 모두 그 턴의 것이다 */
export interface TrTurnBundle {
  readonly turn: TrTurnRow;
  readonly steps: readonly TrStepRow[];
  readonly calls: readonly TrCallRow[];
  readonly hooks: readonly TrHookRow[];
  readonly materials: readonly TrMaterialRow[];
  readonly tooluse: readonly TrToolUseRow[];
  readonly skills: readonly TrSkillRow[];
  readonly frames: readonly TrFrameRow[];
  readonly plugincalls: readonly TrPluginCallRow[];
  readonly cache: readonly TrCacheRow[];
  readonly marks: readonly TrMarkRow[];
}

/** 한 단계의 묶음(`writeStep`). 모든 행이 자기 `threadId`·`turnId`를 가진다 */
export interface TrStepBatch {
  readonly step: TrStepRow;
  readonly calls: readonly TrCallRow[];
  readonly hooks: readonly TrHookRow[];
  readonly materials: readonly TrMaterialRow[];
  readonly tooluse: readonly TrToolUseRow[];
  readonly skills: readonly TrSkillRow[];
  readonly plugincalls: readonly TrPluginCallRow[];
  readonly cache: readonly TrCacheRow[];
}

// ---- 열 정의와 쓰기 SQL --------------------------------------------------

type ColumnBinding<Row> = readonly [string, (row: Row) => SqlValue];

export interface TableSpec<Row> {
  readonly name: string;
  /** 같은 키가 있으면 덮어쓰는 INSERT. 행 id(rowid)는 유지된다 */
  readonly upsert: string;
  readonly bind: (row: Row) => readonly SqlValue[];
}

function tableSpec<Row>(
  name: string,
  key: readonly string[],
  columns: readonly ColumnBinding<Row>[],
): TableSpec<Row> {
  const names = columns.map(([column]) => column);
  const updates = names
    .filter((column) => !key.includes(column))
    .map((column) => `${column} = excluded.${column}`);
  return {
    name,
    upsert: `INSERT INTO ${name} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT (${key.join(", ")}) DO UPDATE SET ${updates.join(", ")}`,
    bind: (row) => columns.map(([, value]) => value(row)),
  };
}

export const TR_THREAD: TableSpec<TrThreadRow> = tableSpec<TrThreadRow>(
  "tr_thread",
  ["thread_id"],
  [
    ["thread_id", (r) => r.threadId],
    ["scope_kind", (r) => r.scopeKind],
    ["test_base_profile", (r) => r.testBaseProfile],
    ["test_target", (r) => r.testTarget],
    ["run_group_id", (r) => r.runGroupId],
    ["input_hash", (r) => r.inputHash],
    ["created_at", (r) => r.createdAt],
    ["draft_json", (r) => r.draftJson],
  ],
);

export const TR_TURN: TableSpec<TrTurnRow> = tableSpec<TrTurnRow>(
  "tr_turn",
  ["thread_id", "turn_id"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["started_at", (r) => r.startedAt],
    ["ended_at", (r) => r.endedAt],
    ["status", (r) => r.status],
    ["origin", (r) => r.origin],
    ["scope_kind", (r) => r.scopeKind],
    ["profile_id", (r) => r.profileId],
    ["profile_rev", (r) => r.profileRev],
    ["profile_rev_changes_json", (r) => r.profileRevChangesJson],
    ["overlay_json", (r) => r.overlayJson],
    ["plugin_stderr_json", (r) => r.pluginStderrJson],
    ["level", (r) => r.level],
    ["complete", (r) => flag(r.complete)],
    ["model", (r) => r.model],
    ["flags", (r) => r.flags],
    ["record_json", (r) => r.recordJson],
    ["record_bytes", (r) => r.recordBytes],
    ["started_event_id", (r) => r.startedEventId],
  ],
);

export const TR_STEP: TableSpec<TrStepRow> = tableSpec<TrStepRow>(
  "tr_step",
  ["thread_id", "turn_id", "step_index"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["step_index", (r) => r.stepIndex],
    ["model", (r) => r.model],
    ["input", (r) => r.input],
    ["output", (r) => r.output],
    ["cache_read", (r) => r.cacheRead],
    ["cache_write", (r) => r.cacheWrite],
    ["retries", (r) => r.retries],
    ["adv_count", (r) => r.advCount],
    ["adv_tokens", (r) => r.advTokens],
    ["deferred_count", (r) => r.deferredCount],
    ["toolset_fp", (r) => r.toolsetFp],
    ["materials_fp", (r) => r.materialsFp],
    ["recorded", (r) => flag(r.recorded)],
  ],
);

export const TR_CALL: TableSpec<TrCallRow> = tableSpec<TrCallRow>(
  "tr_call",
  ["thread_id", "tool_call_id"],
  [
    ["thread_id", (r) => r.threadId],
    ["tool_call_id", (r) => r.toolCallId],
    ["turn_id", (r) => r.turnId],
    ["step_index", (r) => r.stepIndex],
    ["tool", (r) => r.tool],
    ["plugin", (r) => r.plugin],
    ["caller", (r) => r.caller],
    ["caller_plugin", (r) => r.callerPlugin],
    ["via", (r) => r.via],
    ["inherited_from", (r) => r.inheritedFrom],
    ["verdict", (r) => r.verdict],
    ["blocked_plugin", (r) => r.blockedPlugin],
    ["blocked_hook", (r) => r.blockedHook],
    ["call_key", (r) => r.callKey],
    ["target_key", (r) => r.targetKey],
    ["exec_ms", (r) => r.execMs],
    ["exec_status", (r) => r.execStatus],
    ["result_tokens", (r) => r.resultTokens],
    ["result_truncated", (r) => flagOrNull(r.resultTruncated)],
    ["result_item_id", (r) => r.resultItemId],
    ["meta_json", (r) => r.metaJson],
  ],
);

export const TR_HOOK: TableSpec<TrHookRow> = tableSpec<TrHookRow>(
  "tr_hook",
  ["thread_id", "turn_id", "step_index", "seq_global"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["step_index", (r) => r.stepIndex],
    ["seq_global", (r) => r.seqGlobal],
    ["hook", (r) => r.hook],
    ["registration_id", (r) => r.registrationId],
    ["plugin", (r) => r.plugin],
    ["version_id", (r) => r.versionId],
    ["tool_call_id", (r) => r.toolCallId],
    ["subject_json", (r) => r.subjectJson],
    ["decision", (r) => r.decision],
    ["result", (r) => r.result],
    ["reason", (r) => r.reason],
    ["ask_via", (r) => r.askVia],
    ["ask_waits", (r) => r.askWaits],
    ["ask_ms", (r) => r.askMs],
    ["ask_answer", (r) => r.askAnswer],
    ["ms", (r) => r.ms],
    ["at_ms", (r) => r.atMs],
    ["size", (r) => r.size],
    ["skipped_by", (r) => r.skippedBy],
    ["decision_text", (r) => r.decisionText],
  ],
);

export const TR_MATERIAL: TableSpec<TrMaterialRow> = tableSpec<TrMaterialRow>(
  "tr_material",
  ["thread_id", "turn_id", "step_index", "ref", "plugin"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["step_index", (r) => r.stepIndex],
    ["ref", (r) => r.ref],
    ["plugin", (r) => r.plugin],
    ["kind", (r) => r.kind],
    ["material", (r) => r.material],
    ["tokens", (r) => r.tokens],
    ["truncated", (r) => flag(r.truncated)],
    ["omitted", (r) => r.omitted],
    ["item_id", (r) => r.itemId],
    ["attribution", (r) => r.attribution],
  ],
);

export const TR_TOOLUSE: TableSpec<TrToolUseRow> = tableSpec<TrToolUseRow>(
  "tr_tooluse",
  ["thread_id", "turn_id", "tool"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["tool", (r) => r.tool],
    ["plugin", (r) => r.plugin],
    ["tokens", (r) => r.tokens],
    ["state", (r) => r.state],
    ["called", (r) => r.called],
  ],
);

export const TR_SKILL: TableSpec<TrSkillRow> = tableSpec<TrSkillRow>(
  "tr_skill",
  ["thread_id", "turn_id", "skill"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["skill", (r) => r.skill],
    ["plugin", (r) => r.plugin],
    ["listed", (r) => flag(r.listed)],
    ["read", (r) => flag(r.read)],
    ["via", (r) => r.via],
    ["step_index", (r) => r.stepIndex],
    ["tokens", (r) => r.tokens],
  ],
);

export const TR_FRAME: TableSpec<TrFrameRow> = tableSpec<TrFrameRow>(
  "tr_frame",
  ["thread_id", "turn_id", "lease_id"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["lease_id", (r) => r.leaseId],
    ["depth", (r) => r.depth],
    ["plugin", (r) => r.plugin],
    ["version_id", (r) => r.versionId],
    ["parent_lease_id", (r) => r.parentLeaseId],
    ["entered_at_ms", (r) => r.enteredAtMs],
    ["exited_at_ms", (r) => r.exitedAtMs],
    ["exit_reason", (r) => r.exitReason],
    ["lower_resumed_with", (r) => r.lowerResumedWith],
    ["limits_json", (r) => r.limitsJson],
    ["used_json", (r) => r.usedJson],
    ["user_messages", (r) => r.userMessages],
  ],
);

export const TR_PLUGINCALL: TableSpec<TrPluginCallRow> = tableSpec<TrPluginCallRow>(
  "tr_plugincall",
  ["thread_id", "turn_id", "seq"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["seq", (r) => r.seq],
    ["plugin", (r) => r.plugin],
    ["capability", (r) => r.capability],
    ["method", (r) => r.method],
    ["request_key", (r) => r.requestKey],
    ["ok", (r) => flag(r.ok)],
    ["ms", (r) => r.ms],
    ["via", (r) => r.via],
    ["tool_call_id", (r) => r.toolCallId],
  ],
);

export const TR_CACHE: TableSpec<TrCacheRow> = tableSpec<TrCacheRow>(
  "tr_cache",
  ["thread_id", "turn_id", "step_index", "n"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["step_index", (r) => r.stepIndex],
    ["n", (r) => r.n],
    ["observed", (r) => flag(r.observed)],
    ["kind", (r) => r.kind],
    ["plugin", (r) => r.plugin],
    ["registrations", (r) => r.registrations],
    ["evidence", (r) => r.evidence],
    ["cache_read", (r) => r.cacheRead],
    ["cache_write", (r) => r.cacheWrite],
    ["prior_cache_read", (r) => r.priorCacheRead],
    ["prior_cache_write", (r) => r.priorCacheWrite],
  ],
);

export const TR_DAILY: TableSpec<TrDailyRow> = tableSpec<TrDailyRow>(
  "tr_daily",
  ["day", "subject", "plugin", "ref", "model", "profile", "scope_kind", "caller", "counter"],
  [
    ["day", (r) => r.day],
    ["subject", (r) => r.subject],
    ["plugin", (r) => r.plugin],
    ["ref", (r) => r.ref],
    ["model", (r) => r.model],
    ["profile", (r) => r.profile],
    ["scope_kind", (r) => r.scopeKind],
    ["caller", (r) => r.caller],
    ["counter", (r) => r.counter],
    ["n", (r) => r.n],
    ["sum", (r) => r.sum],
    ["min", (r) => r.min],
    ["max", (r) => r.max],
    ["hist_json", (r) => r.histJson],
  ],
);

export const TR_MARK: TableSpec<TrMarkRow> = tableSpec<TrMarkRow>(
  "tr_mark",
  ["thread_id", "turn_id", "ref"],
  [
    ["thread_id", (r) => r.threadId],
    ["turn_id", (r) => r.turnId],
    ["ref", (r) => r.ref],
    ["mark", (r) => r.mark],
    ["plugin", (r) => r.plugin],
    ["marked_at", (r) => r.markedAt],
  ],
);

export const TR_FINDING_STATE: TableSpec<TrFindingStateRow> = tableSpec<TrFindingStateRow>(
  "tr_finding_state",
  ["finding_id"],
  [
    ["finding_id", (r) => r.findingId],
    ["state", (r) => r.state],
    ["dismissed_at", (r) => r.dismissedAt],
    ["snooze_until", (r) => r.snoozeUntil],
    ["fingerprint", (r) => r.fingerprint],
  ],
);

/** 대화 삭제(`forgetThread`)와 접기 뒤 지우기가 턴마다 지우는 표. `tr_daily`는 여기 없다 */
export const TURN_CHILD_TABLES = [
  "tr_mark",
  "tr_plugincall",
  "tr_cache",
  "tr_frame",
  "tr_skill",
  "tr_tooluse",
  "tr_material",
  "tr_hook",
  "tr_call",
  "tr_step",
] as const;

// ---- 읽기 -------------------------------------------------------------------

/** 목록에 쓰는 턴 열(`recordJson` 제외). `listTurns`의 SELECT가 쓴다 */
export const TURN_SUMMARY_COLUMNS = `thread_id, turn_id, started_at, ended_at, status, origin, scope_kind, profile_id, profile_rev, profile_rev_changes_json, overlay_json, plugin_stderr_json, level, complete, model, flags, record_bytes, started_event_id`;

export function threadOf(cols: Cols): TrThreadRow {
  return {
    threadId: colText(cols, "thread_id"),
    scopeKind: colText(cols, "scope_kind"),
    testBaseProfile: colTextOrNull(cols, "test_base_profile"),
    testTarget: colTextOrNull(cols, "test_target"),
    runGroupId: colTextOrNull(cols, "run_group_id"),
    inputHash: colTextOrNull(cols, "input_hash"),
    createdAt: colNum(cols, "created_at"),
    draftJson: colTextOrNull(cols, "draft_json"),
  };
}

export function turnSummaryOf(cols: Cols): Omit<TrTurnRow, "recordJson"> {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    startedAt: colNum(cols, "started_at"),
    endedAt: colNumOrNull(cols, "ended_at"),
    status: colText(cols, "status"),
    origin: colText(cols, "origin"),
    scopeKind: colText(cols, "scope_kind"),
    profileId: colTextOrNull(cols, "profile_id"),
    profileRev: colNumOrNull(cols, "profile_rev"),
    profileRevChangesJson: colTextOrNull(cols, "profile_rev_changes_json"),
    overlayJson: colTextOrNull(cols, "overlay_json"),
    pluginStderrJson: colTextOrNull(cols, "plugin_stderr_json"),
    level: colText(cols, "level"),
    complete: colFlag(cols, "complete"),
    model: colTextOrNull(cols, "model"),
    flags: colNum(cols, "flags"),
    recordBytes: colNum(cols, "record_bytes"),
    startedEventId: colTextOrNull(cols, "started_event_id"),
  };
}

export function turnOf(cols: Cols): TrTurnRow {
  return { ...turnSummaryOf(cols), recordJson: colText(cols, "record_json") };
}

export function stepOf(cols: Cols): TrStepRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    stepIndex: colNum(cols, "step_index"),
    model: colTextOrNull(cols, "model"),
    input: colNum(cols, "input"),
    output: colNum(cols, "output"),
    cacheRead: colNum(cols, "cache_read"),
    cacheWrite: colNum(cols, "cache_write"),
    retries: colNum(cols, "retries"),
    advCount: colNum(cols, "adv_count"),
    advTokens: colNum(cols, "adv_tokens"),
    deferredCount: colNum(cols, "deferred_count"),
    toolsetFp: colTextOrNull(cols, "toolset_fp"),
    materialsFp: colTextOrNull(cols, "materials_fp"),
    recorded: colFlag(cols, "recorded"),
  };
}

export function callOf(cols: Cols): TrCallRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    toolCallId: colText(cols, "tool_call_id"),
    stepIndex: colNumOrNull(cols, "step_index"),
    tool: colText(cols, "tool"),
    plugin: colText(cols, "plugin"),
    caller: colText(cols, "caller"),
    callerPlugin: colTextOrNull(cols, "caller_plugin"),
    via: colTextOrNull(cols, "via"),
    inheritedFrom: colTextOrNull(cols, "inherited_from"),
    verdict: colText(cols, "verdict"),
    blockedPlugin: colTextOrNull(cols, "blocked_plugin"),
    blockedHook: colTextOrNull(cols, "blocked_hook"),
    callKey: colText(cols, "call_key"),
    targetKey: colTextOrNull(cols, "target_key"),
    execMs: colNumOrNull(cols, "exec_ms"),
    execStatus: colTextOrNull(cols, "exec_status"),
    resultTokens: colNumOrNull(cols, "result_tokens"),
    resultTruncated: colFlagOrNull(cols, "result_truncated"),
    resultItemId: colTextOrNull(cols, "result_item_id"),
    metaJson: colText(cols, "meta_json"),
  };
}

export function hookOf(cols: Cols): TrHookRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    stepIndex: colNum(cols, "step_index"),
    seqGlobal: colNum(cols, "seq_global"),
    hook: colText(cols, "hook"),
    registrationId: colText(cols, "registration_id"),
    plugin: colText(cols, "plugin"),
    versionId: colTextOrNull(cols, "version_id"),
    toolCallId: colTextOrNull(cols, "tool_call_id"),
    subjectJson: colText(cols, "subject_json"),
    decision: colText(cols, "decision"),
    result: colText(cols, "result"),
    reason: colTextOrNull(cols, "reason"),
    askVia: colTextOrNull(cols, "ask_via"),
    askWaits: colNumOrNull(cols, "ask_waits"),
    askMs: colNumOrNull(cols, "ask_ms"),
    askAnswer: colTextOrNull(cols, "ask_answer"),
    ms: colNum(cols, "ms"),
    atMs: colNum(cols, "at_ms"),
    size: colNum(cols, "size"),
    skippedBy: colTextOrNull(cols, "skipped_by"),
    decisionText: colTextOrNull(cols, "decision_text"),
  };
}

export function materialOf(cols: Cols): TrMaterialRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    stepIndex: colNum(cols, "step_index"),
    ref: colText(cols, "ref"),
    plugin: colText(cols, "plugin"),
    kind: colText(cols, "kind"),
    material: colText(cols, "material"),
    tokens: colNum(cols, "tokens"),
    truncated: colFlag(cols, "truncated"),
    omitted: colNumOrNull(cols, "omitted"),
    itemId: colTextOrNull(cols, "item_id"),
    attribution: colText(cols, "attribution"),
  };
}

export function toolUseOf(cols: Cols): TrToolUseRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    tool: colText(cols, "tool"),
    plugin: colText(cols, "plugin"),
    tokens: colNum(cols, "tokens"),
    state: colText(cols, "state"),
    called: colNum(cols, "called"),
  };
}

export function skillOf(cols: Cols): TrSkillRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    skill: colText(cols, "skill"),
    plugin: colText(cols, "plugin"),
    listed: colFlag(cols, "listed"),
    read: colFlag(cols, "read"),
    via: colTextOrNull(cols, "via"),
    stepIndex: colNumOrNull(cols, "step_index"),
    tokens: colNumOrNull(cols, "tokens"),
  };
}

export function frameOf(cols: Cols): TrFrameRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    leaseId: colText(cols, "lease_id"),
    depth: colNum(cols, "depth"),
    plugin: colTextOrNull(cols, "plugin"),
    versionId: colTextOrNull(cols, "version_id"),
    parentLeaseId: colTextOrNull(cols, "parent_lease_id"),
    enteredAtMs: colNum(cols, "entered_at_ms"),
    exitedAtMs: colNumOrNull(cols, "exited_at_ms"),
    exitReason: colTextOrNull(cols, "exit_reason"),
    lowerResumedWith: colTextOrNull(cols, "lower_resumed_with"),
    limitsJson: colText(cols, "limits_json"),
    usedJson: colText(cols, "used_json"),
    userMessages: colNum(cols, "user_messages"),
  };
}

export function pluginCallOf(cols: Cols): TrPluginCallRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    seq: colNum(cols, "seq"),
    plugin: colText(cols, "plugin"),
    capability: colText(cols, "capability"),
    method: colText(cols, "method"),
    requestKey: colText(cols, "request_key"),
    ok: colFlag(cols, "ok"),
    ms: colNum(cols, "ms"),
    via: colTextOrNull(cols, "via"),
    toolCallId: colTextOrNull(cols, "tool_call_id"),
  };
}

export function cacheOf(cols: Cols): TrCacheRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    stepIndex: colNum(cols, "step_index"),
    n: colNum(cols, "n"),
    observed: colFlag(cols, "observed"),
    kind: colText(cols, "kind"),
    plugin: colTextOrNull(cols, "plugin"),
    registrations: colText(cols, "registrations"),
    evidence: colTextOrNull(cols, "evidence"),
    cacheRead: colNum(cols, "cache_read"),
    cacheWrite: colNum(cols, "cache_write"),
    priorCacheRead: colNumOrNull(cols, "prior_cache_read"),
    priorCacheWrite: colNumOrNull(cols, "prior_cache_write"),
  };
}

export function markOf(cols: Cols): TrMarkRow {
  return {
    threadId: colText(cols, "thread_id"),
    turnId: colText(cols, "turn_id"),
    ref: colText(cols, "ref"),
    mark: colText(cols, "mark"),
    plugin: colTextOrNull(cols, "plugin"),
    markedAt: colNum(cols, "marked_at"),
  };
}

export function findingStateOf(cols: Cols): TrFindingStateRow {
  return {
    findingId: colText(cols, "finding_id"),
    state: colText(cols, "state"),
    dismissedAt: colNumOrNull(cols, "dismissed_at"),
    snoozeUntil: colNumOrNull(cols, "snooze_until"),
    fingerprint: colText(cols, "fingerprint"),
  };
}

export function dailyOf(cols: Cols): TrDailyRow {
  return {
    day: colText(cols, "day"),
    subject: colText(cols, "subject"),
    plugin: colText(cols, "plugin"),
    ref: colText(cols, "ref"),
    model: colText(cols, "model"),
    profile: colText(cols, "profile"),
    scopeKind: colText(cols, "scope_kind"),
    caller: colText(cols, "caller"),
    counter: colText(cols, "counter"),
    n: colNum(cols, "n"),
    sum: colNum(cols, "sum"),
    min: colNumOrNull(cols, "min"),
    max: colNumOrNull(cols, "max"),
    histJson: colTextOrNull(cols, "hist_json"),
  };
}

// ---- 스키마 -----------------------------------------------------------------

/** 버전 2 DDL. 한 트랜잭션에서 실행한다(실패하면 한 줄도 남지 않는다). 인덱스는 §3.4 표의 것뿐이다 */
export const TURN_RECORD_DDL = `
CREATE TABLE IF NOT EXISTS tr_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tr_thread (
  thread_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  test_base_profile TEXT,
  test_target TEXT,
  run_group_id TEXT,
  input_hash TEXT,
  created_at INTEGER NOT NULL,
  draft_json TEXT
);
CREATE TABLE IF NOT EXISTS tr_turn (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  profile_id TEXT,
  profile_rev INTEGER,
  profile_rev_changes_json TEXT,
  overlay_json TEXT,
  plugin_stderr_json TEXT,
  level TEXT NOT NULL,
  complete INTEGER NOT NULL,
  model TEXT,
  flags INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  record_bytes INTEGER NOT NULL,
  started_event_id TEXT,
  PRIMARY KEY (thread_id, turn_id)
);
CREATE TABLE IF NOT EXISTS tr_step (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  model TEXT,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  retries INTEGER NOT NULL,
  adv_count INTEGER NOT NULL,
  adv_tokens INTEGER NOT NULL,
  deferred_count INTEGER NOT NULL,
  toolset_fp TEXT,
  materials_fp TEXT,
  recorded INTEGER NOT NULL,
  PRIMARY KEY (thread_id, turn_id, step_index)
);
CREATE TABLE IF NOT EXISTS tr_call (
  thread_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step_index INTEGER,
  tool TEXT NOT NULL,
  plugin TEXT NOT NULL,
  caller TEXT NOT NULL,
  caller_plugin TEXT,
  via TEXT,
  inherited_from TEXT,
  verdict TEXT NOT NULL,
  blocked_plugin TEXT,
  blocked_hook TEXT,
  call_key TEXT NOT NULL,
  target_key TEXT,
  exec_ms REAL,
  exec_status TEXT,
  result_tokens INTEGER,
  result_truncated INTEGER,
  result_item_id TEXT,
  meta_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, tool_call_id)
);
CREATE INDEX IF NOT EXISTS tr_call_plugin_verdict ON tr_call(plugin, verdict);
CREATE INDEX IF NOT EXISTS tr_call_key ON tr_call(call_key);
CREATE TABLE IF NOT EXISTS tr_hook (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  seq_global INTEGER NOT NULL,
  hook TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  plugin TEXT NOT NULL,
  version_id TEXT,
  tool_call_id TEXT,
  subject_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  ask_via TEXT,
  ask_waits INTEGER,
  ask_ms REAL,
  ask_answer TEXT,
  ms REAL NOT NULL,
  at_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  skipped_by TEXT,
  decision_text TEXT,
  PRIMARY KEY (thread_id, turn_id, step_index, seq_global)
);
CREATE INDEX IF NOT EXISTS tr_hook_plugin_hook_result ON tr_hook(plugin, hook, result);
CREATE TABLE IF NOT EXISTS tr_material (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  ref TEXT NOT NULL,
  plugin TEXT NOT NULL,
  kind TEXT NOT NULL,
  material TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  truncated INTEGER NOT NULL,
  omitted INTEGER,
  item_id TEXT,
  attribution TEXT NOT NULL,
  PRIMARY KEY (thread_id, turn_id, step_index, ref, plugin)
);
CREATE TABLE IF NOT EXISTS tr_tooluse (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  plugin TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  state TEXT NOT NULL,
  called INTEGER NOT NULL,
  PRIMARY KEY (thread_id, turn_id, tool)
);
CREATE TABLE IF NOT EXISTS tr_skill (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  plugin TEXT NOT NULL,
  listed INTEGER NOT NULL,
  read INTEGER NOT NULL,
  via TEXT,
  step_index INTEGER,
  tokens INTEGER,
  PRIMARY KEY (thread_id, turn_id, skill)
);
CREATE TABLE IF NOT EXISTS tr_frame (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  depth INTEGER NOT NULL,
  plugin TEXT,
  version_id TEXT,
  parent_lease_id TEXT,
  entered_at_ms REAL NOT NULL,
  exited_at_ms REAL,
  exit_reason TEXT,
  lower_resumed_with TEXT,
  limits_json TEXT NOT NULL,
  used_json TEXT NOT NULL,
  user_messages INTEGER NOT NULL,
  PRIMARY KEY (thread_id, turn_id, lease_id)
);
CREATE TABLE IF NOT EXISTS tr_plugincall (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  plugin TEXT NOT NULL,
  capability TEXT NOT NULL,
  method TEXT NOT NULL,
  request_key TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ms REAL NOT NULL,
  via TEXT,
  tool_call_id TEXT,
  PRIMARY KEY (thread_id, turn_id, seq)
);
CREATE TABLE IF NOT EXISTS tr_cache (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  n INTEGER NOT NULL,
  observed INTEGER NOT NULL,
  kind TEXT NOT NULL,
  plugin TEXT,
  registrations TEXT NOT NULL,
  evidence TEXT,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  prior_cache_read INTEGER,
  prior_cache_write INTEGER,
  PRIMARY KEY (thread_id, turn_id, step_index, n)
);
CREATE TABLE IF NOT EXISTS tr_daily (
  day TEXT NOT NULL,
  subject TEXT NOT NULL,
  plugin TEXT NOT NULL,
  ref TEXT NOT NULL,
  model TEXT NOT NULL,
  profile TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  caller TEXT NOT NULL,
  counter TEXT NOT NULL,
  n INTEGER NOT NULL,
  sum REAL NOT NULL,
  min REAL,
  max REAL,
  hist_json TEXT,
  PRIMARY KEY (day, subject, plugin, ref, model, profile, scope_kind, caller, counter)
);
CREATE TABLE IF NOT EXISTS tr_mark (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  mark TEXT NOT NULL,
  plugin TEXT,
  marked_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, turn_id, ref)
);
CREATE TABLE IF NOT EXISTS tr_finding_state (
  finding_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  dismissed_at INTEGER,
  snooze_until INTEGER,
  fingerprint TEXT NOT NULL
);
`;
