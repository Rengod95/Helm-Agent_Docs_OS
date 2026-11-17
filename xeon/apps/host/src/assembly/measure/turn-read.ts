import { parseJson, parse, type Result, err, ok } from "@fresnel/contracts";
import {
  SCOPE_KINDS,
  TURN_FLAG_KEYS,
  TURN_STATUSES,
  TurnRecordSchema,
  type CompareRow,
  type Dim,
  type EvidenceRef,
  type Finding,
  type HookOutcome,
  type TurnSearchItem,
  type FindingBundle,
  type MetricDef,
  type MetricFilter,
  type MetricPeriod,
  type MetricRow,
  type MetricNote,
  type RecordLevel,
  type ScopeKind,
  type TurnRecord,
  type TurnStatus,
  type TurnSummary,
  type TurnFlagKey,
} from "@fresnel/contracts/wire";
import { Type } from "typebox";
import { hookOutcomeOf, HOOK_OUTCOME_CLASSES } from "./classify.ts";
import {
  compareMetrics,
  METRIC_CATALOG,
  metricIsKnown,
  passesFilter,
  queryMetrics,
  type CounterFilter,
} from "./metrics.ts";
import {
  bundleOf,
  evaluateRules,
  findingIdOf,
  fingerprintText,
  reopens,
  toFinding,
  type Candidate,
  type OverrideMap,
} from "./findings.ts";
import type { MeasureStore, MeasureStoreError, TurnBundleRow } from "./store.ts";
import { dailyId, foldTurn, mergeAggregates, type DailyCell } from "./turn-fold.ts";
import type { TrTurnRow } from "./turn-tables.ts";

// 턴 기록 읽기 포트(문서 §3.5, §3.8, §4.7). 처리기(`handlers/m5/`)가 이것을 부른다.
// 저장소가 없으면(열지 못함) 빈 결과와 `enabled`·`level`로 알린다. 저장소 읽기 실패만 오류다.
// 지표와 발견은 같은 창에서 원본 턴(접기 함수로 접은 값)과 `tr_daily`를 합쳐 계산한다(`counters`).

const DAY_MS = 86_400_000;
const DEFAULT_SCOPES: readonly ScopeKind[] = ["live", "overlay_reviewed"];
/** 번들 한 건의 상한(§4.7 규칙 43). 넘으면 증거를 줄인다 */
const BUNDLE_MAX_BYTES = 16_384;

/** 포트가 돌려주는 오류. 처리기가 wire 오류로 옮긴다 */
export type TurnReadError =
  | { readonly kind: "store"; readonly cause: MeasureStoreError }
  | { readonly kind: "corrupt" }
  | { readonly kind: "invalid_cursor" }
  | { readonly kind: "invalid_filter"; readonly message: string }
  | { readonly kind: "unknown_metric"; readonly id: string }
  | { readonly kind: "turn_missing" }
  | { readonly kind: "finding_not_found" }
  | { readonly kind: "not_a_test_run" };

/** 포트가 읽는 설정 값 묶음. 키의 기본값은 `settings-keys.ts`가 정한다 */
export interface MetricsSettingsValues {
  readonly minSample: number;
  readonly defaultWindowDays: number;
  readonly findingsEnabled: boolean;
  /** `x.operations.findings.overrides`의 원시 값. 모양이 틀리면 빈 덮어쓰기다 */
  readonly findingOverrides: unknown;
}

/** 포트의 원천. 조립 루트가 채운다 */
export interface TurnReadSource {
  readonly store: () => MeasureStore | undefined;
  /** `x.operations.trace.enabled`의 현재 값 */
  readonly enabled: () => boolean;
  /** `x.operations.trace.retentionDays`의 현재 값. 이보다 오래된 턴은 접혔다 */
  readonly retentionDays: () => number;
  readonly now: () => number;
  readonly metrics: () => MetricsSettingsValues;
}

const OverrideShape = Type.Record(Type.String(), Type.Record(Type.String(), Type.Number()));

interface ListQuery {
  readonly threadId: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly scope?: readonly ScopeKind[];
  readonly flags?: readonly TurnFlagKey[];
}

interface ListOut {
  readonly enabled: boolean;
  readonly level: RecordLevel;
  readonly items: TurnSummary[];
  readonly next: string | null;
}

type Absent = "never_recorded" | "purged" | "off";

interface GetOut {
  readonly enabled: boolean;
  readonly level: RecordLevel;
  readonly record: TurnRecord | null;
  readonly absent: Absent | null;
}

interface MetricsQuery {
  readonly metrics: readonly string[];
  readonly filter: MetricFilter;
  readonly groupBy: readonly Dim[];
  readonly compare: {
    readonly by: "pluginVersion" | "model" | "profileRev";
    readonly a: string;
    readonly b: string;
  } | null;
}

interface MetricsOut {
  readonly window: { readonly from: number; readonly to: number };
  readonly rows: MetricRow[];
  readonly notes: MetricNote[];
}

interface FindingsListOut {
  readonly asOf: number;
  readonly dataRevision: number;
  readonly findings: Finding[];
}

/** 발견 계산 결과 하나의 캐시 한 칸 */
interface Snapshot {
  readonly candidates: readonly Candidate[];
  readonly revision: number;
}

export interface TurnRecordReadPort {
  /** 계측 켜짐과 기록 수준(저장소가 없으면 `none`) */
  status(): { readonly enabled: boolean; readonly level: RecordLevel };
  list(query: ListQuery): Result<ListOut, TurnReadError>;
  get(threadId: string, turnId: string): Result<GetOut, TurnReadError>;
  search(query: {
    readonly plugin: string;
    readonly hook: string | null;
    readonly outcome: HookOutcome | null;
    readonly period: MetricPeriod;
    readonly scopes: readonly ScopeKind[] | null;
    readonly cursor: string | null;
    readonly limit: number;
  }): Result<{ readonly items: TurnSearchItem[]; readonly next: string | null }, TurnReadError>;
  mark(
    threadId: string,
    turnId: string,
    plugin: string,
    mark: "followed" | "not_followed",
  ): Result<true, TurnReadError>;
  catalog(): MetricDef[];
  metrics(query: MetricsQuery): Result<MetricsOut, TurnReadError>;
  findingsList(query: {
    readonly profileId: string | null;
    readonly period: MetricPeriod | null;
    readonly state: "open" | "dismissed" | null;
  }): Result<FindingsListOut, TurnReadError>;
  findingsEvidence(
    findingId: string,
    cursor: string | null,
  ): Result<{ readonly items: EvidenceRef[]; readonly next: string | null }, TurnReadError>;
  findingsDismiss(findingId: string, until: number | null): Result<true, TurnReadError>;
  findingsBundle(
    findingId: string,
  ): Result<{ readonly bundle: FindingBundle; readonly bytes: number }, TurnReadError>;
  profileCost(profileId: string): Result<ProfileCostOut, TurnReadError>;
  testRunCompare(threadIds: readonly string[]): Result<TestRunCompareOut, TurnReadError>;
}

/** `profileCost.get`의 한 줄. 정적 추정의 칸은 null이다(`drive`는 정적 원천이 없다, §3.3) */
interface ProfileCostRowOut {
  plugin: string;
  always: number | null;
  drive: number | null;
  onDemand: number | null;
  toolCount: number | null;
  basis: "measured" | "unknown";
  shared: boolean;
}

interface ProfileCostOut {
  readonly profileId: string;
  readonly basis: "measured" | "estimated";
  readonly nTurns: number;
  readonly plugins: ProfileCostRowOut[];
  readonly total: ProfileCostRowOut;
}

interface TestRunCompareOut {
  readonly sameInput: boolean;
  readonly columns: { threadId: string; label: string; versionIds: string[] }[];
  readonly rows: CompareRow[];
}

// ---- 공통 보조 ----------------------------------------------------------------

function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function scopesOf(scope?: readonly ScopeKind[]): readonly ScopeKind[] {
  return scope ?? DEFAULT_SCOPES;
}

function storeError(cause: MeasureStoreError): TurnReadError {
  return { kind: "store", cause };
}

/** 기간 필터를 `[from, to)`로 바꾼다 */
function windowOf(
  period: MetricPeriod,
  now: number,
): Result<{ from: number; to: number }, TurnReadError> {
  if ("days" in period) return ok({ from: now - period.days * DAY_MS, to: now });
  if (!(period.from < period.to))
    return err({ kind: "invalid_filter", message: "period.from must be less than period.to" });
  return ok({ from: period.from, to: period.to });
}

/** 저장된 문자열이 정본 목록에 있으면 그 값이다. 없으면 null(저장 데이터 손상) */
function listedOf<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

/** 턴 기록 행 하나를 목록 요약으로 바꾼다. `record_json`을 검증해 플래그와 자식 수를 얻는다 */
function summaryOf(
  row: Pick<
    TrTurnRow,
    "threadId" | "turnId" | "startedAt" | "endedAt" | "status" | "scopeKind" | "complete"
  >,
  bundle: { readonly steps: number; readonly calls: number },
  record: TurnRecord,
  profileId: string | null,
): TurnSummary | null {
  const frameDepthMax = record.frames.reduce((max, frame) => Math.max(max, frame.depth), 0);
  const status = listedOf<TurnStatus>(TURN_STATUSES, row.status);
  const scope = listedOf<ScopeKind>(SCOPE_KINDS, row.scopeKind);
  if (status === null || scope === null) return null;
  return {
    threadId: row.threadId,
    turnId: row.turnId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    status,
    scope,
    complete: row.complete,
    profileId,
    stepCount: bundle.steps,
    callCount: bundle.calls,
    flags: record.flags,
    frameDepthMax,
    childCount: record.children.length,
  };
}

/** 목록 거르기의 플래그 비트. 정본은 정한 것이 없어 목록 순서를 쓴다(`TURN_FLAG_KEYS`의 i번째가 1 << i) [제안] */
function flagsMaskOf(keys: readonly TurnFlagKey[] | undefined): number {
  if (keys === undefined) return 0;
  let mask = 0;
  for (const key of keys) {
    const index = TURN_FLAG_KEYS.indexOf(key);
    if (index >= 0) mask |= 1 << index;
  }
  return mask;
}

/** 계측 행이 없는 창의 지표 값(꺼짐). 0으로 채우지 않는다 */
function offRows(metrics: readonly string[]): MetricsOut {
  const values = Object.fromEntries(
    metrics.map((id) => [
      id,
      { value: null, n: 0, state: "unavailable" as const, reason: "measurement_off" as const },
    ]),
  );
  return { window: { from: 0, to: 0 }, rows: [{ key: {}, values }], notes: [] };
}

/** 원본 턴 묶음(시작 시각 순)과 접힌 날을 한 카운터 묶음으로 합친다 */
function mergeCells(cells: readonly DailyCell[]): DailyCell[] {
  const merged = new Map<string, DailyCell>();
  for (const cell of cells) {
    const id = dailyId(cell.key);
    const prev = merged.get(id);
    merged.set(
      id,
      prev === undefined ? cell : { key: cell.key, agg: mergeAggregates(prev.agg, cell.agg) },
    );
  }
  return [...merged.values()];
}

function foldBundles(bundles: readonly TurnBundleRow[]): DailyCell[] {
  return bundles.flatMap((bundle) =>
    foldTurn({
      day: dayOf(bundle.turn.startedAt),
      turn: bundle.turn,
      calls: bundle.calls,
      hooks: bundle.hooks,
      materials: bundle.materials,
      tooluse: bundle.tooluse,
      skills: bundle.skills,
    }),
  );
}

/** 창의 카운터와 원본 묶음. 보관 시작 전 날은 `tr_daily`, 이후 턴은 원본을 접는다 */
function countersOf(
  store: MeasureStore,
  window: { from: number; to: number },
  scopes: readonly ScopeKind[],
  cutoff: number,
): Result<{ cells: DailyCell[]; bundles: TurnBundleRow[]; partial: boolean }, TurnReadError> {
  // 원본 턴은 표에 남아 있는 것 전부다. 접힌 턴은 접기와 같은 트랜잭션에서 지워지므로 원본과 `tr_daily`는 겹치지 않는다
  const bundles =
    window.from < window.to
      ? store.windowBundles({ from: window.from, to: window.to, scopes: [...scopes] })
      : ok([]);
  if (!bundles.ok) return err(storeError(bundles.error));
  const foldedUntil = Math.min(window.to, cutoff);
  let daily: DailyCell[] = [];
  if (window.from < foldedUntil) {
    const cells = store.dailyWindow({
      fromDay: dayOf(window.from),
      toDay: dayOf(foldedUntil - 1),
      scopes: [...scopes],
    });
    if (!cells.ok) return err(storeError(cells.error));
    daily = [...cells.value];
  }
  const raw = bundles.value;
  return ok({
    cells: mergeCells([...daily, ...foldBundles(raw)]),
    bundles: [...raw],
    partial: window.from < cutoff,
  });
}

function turnCountsOf(
  cells: readonly DailyCell[],
  filter: CounterFilter,
): { full: number; off: number } {
  let full = 0;
  let off = 0;
  for (const cell of cells) {
    if (cell.key.subject !== "turn_level" || !passesFilter(cell, filter)) continue;
    if (cell.key.counter === "full") full += cell.agg.n;
    else off += cell.agg.n;
  }
  return { full, off };
}

function counterFilterOf(filter: MetricFilter): CounterFilter {
  return {
    profileId: filter.profileId ?? null,
    plugin: filter.plugin ?? null,
    modelVersion: filter.modelVersion ?? null,
    caller: filter.caller ?? "any",
  };
}

// ---- 포트 -----------------------------------------------------------------------

export function createTurnRecordPort(source: TurnReadSource): TurnRecordReadPort {
  /** 발견 계산 캐시. 키는 (프로필, 기간, 데이터 개정)이다 */
  const snapshots = new Map<string, Snapshot>();
  /** 발견 id → 가장 최근 계산의 후보(증거 목록과 지문을 여기서 본다) */
  const lastById = new Map<string, Candidate>();

  function overridesOf(): OverrideMap {
    const parsed = parse(OverrideShape, source.metrics().findingOverrides);
    return parsed.ok ? parsed.value : {};
  }

  return {
    status() {
      const store = source.store();
      if (store === undefined) return { enabled: false, level: "none" };
      return { enabled: source.enabled(), level: source.enabled() ? "full" : "log_only" };
    },

    list(query) {
      const store = source.store();
      if (store === undefined)
        return ok({ enabled: source.enabled(), level: "none", items: [], next: null });
      const page = store.listTurns({
        threadId: query.threadId,
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.scope === undefined ? {} : { scopes: [...query.scope] }),
        flagsMask: flagsMaskOf(query.flags),
      });
      if (!page.ok) {
        if (page.error.kind === "invalid_cursor") return err({ kind: "invalid_cursor" });
        return err(storeError(page.error));
      }
      const items: TurnSummary[] = [];
      for (const item of page.value.items) {
        const bundle = store.readTurn(item.threadId, item.turnId);
        if (!bundle.ok) return err(storeError(bundle.error));
        if (bundle.value === undefined) continue;
        const parsedJson = parseJson(bundle.value.turn.recordJson);
        if (!parsedJson.ok) return err({ kind: "corrupt" });
        const record = parse(TurnRecordSchema, parsedJson.value);
        if (!record.ok) return err({ kind: "corrupt" });
        const summary = summaryOf(
          bundle.value.turn,
          { steps: bundle.value.steps.length, calls: bundle.value.calls.length },
          record.value,
          bundle.value.turn.profileId,
        );
        if (summary === null) return err({ kind: "corrupt" });
        items.push(summary);
      }
      return ok({
        enabled: source.enabled(),
        level: source.enabled() ? "full" : "log_only",
        items,
        next: page.value.next,
      });
    },

    get(threadId, turnId) {
      const store = source.store();
      if (store === undefined)
        return ok({ enabled: source.enabled(), level: "none", record: null, absent: "off" });
      const bundle = store.readTurn(threadId, turnId);
      if (!bundle.ok) return err(storeError(bundle.error));
      if (bundle.value === undefined) {
        return ok({
          enabled: source.enabled(),
          level: source.enabled() ? "full" : "log_only",
          record: null,
          absent: source.enabled() ? "never_recorded" : "off",
        });
      }
      const parsedJson = parseJson(bundle.value.turn.recordJson);
      if (!parsedJson.ok) return err({ kind: "corrupt" });
      const record = parse(TurnRecordSchema, parsedJson.value);
      if (!record.ok) return err({ kind: "corrupt" });
      return ok({
        enabled: source.enabled(),
        level: source.enabled() ? "full" : "log_only",
        record: record.value,
        absent: null,
      });
    },

    search(query) {
      const store = source.store();
      if (store === undefined) return ok({ items: [], next: null });
      const window = windowOf(query.period, source.now());
      if (!window.ok) return err(window.error);
      const beforeRowid = query.cursor === null ? null : Number(query.cursor);
      if (beforeRowid !== null && !Number.isInteger(beforeRowid))
        return err({ kind: "invalid_cursor" });
      const items: TurnSearchItem[] = [];
      let cursor = beforeRowid;
      let exhausted = false;
      while (items.length < query.limit && !exhausted) {
        const rows = store.searchHooks({
          plugin: query.plugin,
          hook: query.hook,
          from: window.value.from,
          to: window.value.to,
          scopes: [...(query.scopes ?? DEFAULT_SCOPES)],
          beforeRowid: cursor,
          limit: query.limit,
        });
        if (!rows.ok) return err(storeError(rows.error));
        if (rows.value.length < query.limit) exhausted = true;
        for (const row of rows.value) {
          // 쪽이 찼으면 멈춘다. 커서는 처리한 마지막 행이라서 넘긴 행은 다음 쪽에 그대로 남는다
          if (items.length >= query.limit) break;
          cursor = row.rowid;
          const outcome = hookOutcomeOf({
            result: row.result,
            reason: row.reason,
            decision: row.decision,
          });
          // 건너뜀은 표시값 여섯에 없어 검색 결과에서 뺀다(§3.8의 outcome은 여섯 값이다)
          if (outcome === "skipped") continue;
          if (query.outcome !== null && outcome !== query.outcome) continue;
          items.push({
            threadId: row.threadId,
            turnId: row.turnId,
            hookSeq: row.seqGlobal,
            plugin: row.plugin,
            outcome,
            at: row.at,
          });
        }
      }
      return ok({
        items,
        next: !exhausted && cursor !== null && items.length === query.limit ? String(cursor) : null,
      });
    },

    mark(threadId, turnId, plugin, mark) {
      const store = source.store();
      if (store === undefined) return err({ kind: "turn_missing" });
      const bundle = store.readTurn(threadId, turnId);
      if (!bundle.ok) return err(storeError(bundle.error));
      if (bundle.value === undefined) return err({ kind: "turn_missing" });
      const written = store.putMark({
        threadId,
        turnId,
        ref: plugin,
        mark,
        plugin,
        markedAt: source.now(),
      });
      if (!written.ok) return err(storeError(written.error));
      return ok(true);
    },

    catalog() {
      return METRIC_CATALOG.map((m) => ({
        id: m.id,
        label: m.label,
        unit: m.unit,
        kind: m.kind,
        appliesTo: m.appliesTo,
        feasible: m.feasible,
        definitionNote: m.definitionNote,
      }));
    },

    metrics(query) {
      const unknown = query.metrics.find((id) => !metricIsKnown(id));
      if (unknown !== undefined) return err({ kind: "unknown_metric", id: unknown });
      const settings = source.metrics();
      const window = windowOf(query.filter.period, source.now());
      if (!window.ok) return err(window.error);
      const store = source.store();
      if (store === undefined) return ok({ ...offRows(query.metrics), window: window.value });
      const retentionCutoff = source.now() - source.retentionDays() * DAY_MS;
      const counters = countersOf(
        store,
        window.value,
        scopesOf(query.filter.scopes),
        retentionCutoff,
      );
      if (!counters.ok) return err(counters.error);
      const filter = counterFilterOf(query.filter);
      const counts = turnCountsOf(counters.value.cells, filter);
      const input = {
        cells: counters.value.cells,
        metrics: [...query.metrics],
        groupBy: [...query.groupBy],
        filter,
        minSample: settings.minSample,
        turnsFull: counts.full,
        turnsOff: counts.off,
        partialWindow: counters.value.partial,
      };
      const out =
        query.compare === null
          ? queryMetrics(input)
          : compareMetrics({
              ...input,
              by: query.compare.by,
              a: query.compare.a,
              b: query.compare.b,
            });
      return ok({ window: window.value, rows: out.rows, notes: out.notes });
    },

    findingsList(query) {
      const settings = source.metrics();
      const store = source.store();
      const now = source.now();
      const window = windowOf(query.period ?? { days: settings.defaultWindowDays }, now);
      if (!window.ok) return err(window.error);
      if (store === undefined || !settings.findingsEnabled) {
        return ok({ asOf: now, dataRevision: 0, findings: [] });
      }
      const revision = store.maxTurnRowid();
      if (!revision.ok) return err(storeError(revision.error));
      const key = JSON.stringify([query.profileId, query.period, revision.value]);
      let snapshot = snapshots.get(key);
      if (snapshot === undefined) {
        const retentionCutoff = now - source.retentionDays() * DAY_MS;
        const counters = countersOf(store, window.value, DEFAULT_SCOPES, retentionCutoff);
        if (!counters.ok) return err(counters.error);
        const filter: CounterFilter = {
          profileId: query.profileId,
          plugin: null,
          modelVersion: null,
          caller: "any",
        };
        const counts = turnCountsOf(counters.value.cells, filter);
        const candidates = evaluateRules({
          cells: counters.value.cells.filter((cell) => passesFilter(cell, filter)),
          bundles: counters.value.bundles.filter(
            (b) => query.profileId === null || b.turn.profileId === query.profileId,
          ),
          minSample: settings.minSample,
          overrides: overridesOf(),
          turnsFull: counts.full,
          turnsOff: counts.off,
        });
        snapshot = { candidates, revision: revision.value };
        snapshots.set(key, snapshot);
      }
      const findings: Finding[] = [];
      for (const candidate of snapshot.candidates) {
        lastById.set(findingIdOf(candidate), candidate);
        const stored = store.getFindingState(findingIdOf(candidate));
        if (!stored.ok) return err(storeError(stored.error));
        let state: "open" | "dismissed" = "open";
        if (stored.value !== undefined && stored.value.state === "dismissed") {
          const stillClosed = !reopens(
            { fingerprint: stored.value.fingerprint, snoozeUntil: stored.value.snoozeUntil },
            { value: candidate.impact.value },
            now,
          );
          state = stillClosed ? "dismissed" : "open";
        }
        if (query.state !== null && query.state !== state) continue;
        findings.push(toFinding(candidate, state));
      }
      return ok({ asOf: now, dataRevision: snapshot.revision, findings });
    },

    findingsEvidence(findingId, cursor) {
      const candidate = lastById.get(findingId);
      if (candidate === undefined) return err({ kind: "finding_not_found" });
      const start = cursor === null ? 0 : Number(cursor);
      if (!Number.isInteger(start) || start < 0) return err({ kind: "invalid_cursor" });
      const items = candidate.evidence.slice(start, start + 200);
      const next = start + 200 < candidate.evidence.length ? String(start + 200) : null;
      return ok({ items: [...items], next });
    },

    findingsDismiss(findingId, until) {
      const candidate = lastById.get(findingId);
      const store = source.store();
      if (candidate === undefined || store === undefined) return err({ kind: "finding_not_found" });
      const written = store.upsertFindingState({
        findingId,
        state: "dismissed",
        dismissedAt: source.now(),
        snoozeUntil: until,
        fingerprint: fingerprintText(candidate),
      });
      if (!written.ok) return err(storeError(written.error));
      return ok(true);
    },

    findingsBundle(findingId) {
      const candidate = lastById.get(findingId);
      if (candidate === undefined) return err({ kind: "finding_not_found" });
      const base = toFinding(candidate, "open");
      // 16 KiB를 넘으면 증거를 절반씩 줄인다. 남는 것은 id, 해시, 숫자다
      let count = base.evidence.length;
      let shaped = bundleOf(base);
      while (shaped.bytes > BUNDLE_MAX_BYTES && count > 0) {
        count = Math.floor(count / 2);
        shaped = bundleOf({ ...base, evidence: base.evidence.slice(0, count) });
      }
      return ok({ bundle: shaped.bundle, bytes: shaped.bytes });
    },

    profileCost(profileId) {
      const settings = source.metrics();
      const store = source.store();
      const now = source.now();
      const window = { from: now - settings.defaultWindowDays * DAY_MS, to: now };
      const empty: ProfileCostOut = {
        profileId,
        basis: "estimated",
        nTurns: 0,
        plugins: [],
        total: {
          plugin: "",
          always: null,
          drive: null,
          onDemand: null,
          toolCount: null,
          basis: "unknown",
          shared: false,
        },
      };
      if (store === undefined) return ok(empty);
      const counters = countersOf(
        store,
        window,
        DEFAULT_SCOPES,
        now - source.retentionDays() * DAY_MS,
      );
      if (!counters.ok) return err(counters.error);
      const mine = counters.value.cells.filter((cell) => cell.key.profile === profileId);
      const nTurns = mine
        .filter((cell) => cell.key.subject === "turn")
        .reduce((sum, cell) => sum + cell.agg.n, 0);
      if (nTurns === 0) return ok(empty);
      const plugins = new Map<
        string,
        { always: number; drive: number; onDemand: number; tools: Set<string> }
      >();
      const slot = (plugin: string) => {
        const found = plugins.get(plugin) ?? {
          always: 0,
          drive: 0,
          onDemand: 0,
          tools: new Set<string>(),
        };
        plugins.set(plugin, found);
        return found;
      };
      for (const cell of mine) {
        if (cell.key.subject === "cost") {
          const row = slot(cell.key.plugin);
          if (cell.key.counter === "always") row.always += cell.agg.sum;
          if (cell.key.counter === "drive") row.drive += cell.agg.sum;
          if (cell.key.counter === "on_demand") row.onDemand += cell.agg.sum;
        }
        if (cell.key.subject === "tool") slot(cell.key.plugin).tools.add(cell.key.ref);
      }
      const rows: ProfileCostRowOut[] = [...plugins.entries()].map(([plugin, p]) => ({
        plugin,
        always: Math.round(p.always / nTurns),
        drive: Math.round(p.drive / nTurns),
        onDemand: Math.round(p.onDemand / nTurns),
        toolCount: p.tools.size,
        basis: "measured",
        shared: false,
      }));
      const total: ProfileCostRowOut = {
        plugin: "",
        always: 0,
        drive: 0,
        onDemand: 0,
        toolCount: 0,
        basis: "measured",
        shared: false,
      };
      for (const row of rows) {
        total.always = (total.always ?? 0) + (row.always ?? 0);
        total.drive = (total.drive ?? 0) + (row.drive ?? 0);
        total.onDemand = (total.onDemand ?? 0) + (row.onDemand ?? 0);
        total.toolCount = (total.toolCount ?? 0) + (row.toolCount ?? 0);
      }
      return ok({ profileId, basis: "measured", nTurns, plugins: rows, total });
    },

    testRunCompare(threadIds) {
      const store = source.store();
      if (store === undefined) return err({ kind: "not_a_test_run" });
      const columns: TestRunCompareOut["columns"] = [];
      const perThread: {
        label: string;
        turns: number;
        calls: number;
        blocked: number;
        outcomes: Record<string, number>;
        inputHash: string | null;
      }[] = [];
      for (const [index, threadId] of threadIds.entries()) {
        const thread = store.getThread(threadId);
        if (!thread.ok) return err(storeError(thread.error));
        if (thread.value === undefined || thread.value.scopeKind !== "test")
          return err({ kind: "not_a_test_run" });
        const page = store.listTurns({ threadId, limit: 200 });
        if (!page.ok) return err(storeError(page.error));
        let calls = 0;
        let blocked = 0;
        const outcomes: Record<string, number> = Object.fromEntries(
          HOOK_OUTCOME_CLASSES.map((c) => [c, 0]),
        );
        const versionIds: string[] = [];
        for (const item of page.value.items) {
          const bundle = store.readTurn(item.threadId, item.turnId);
          if (!bundle.ok) return err(storeError(bundle.error));
          if (bundle.value === undefined) continue;
          calls += bundle.value.calls.length;
          blocked += bundle.value.calls.filter(
            (c) => c.verdict.startsWith("blocked") || c.verdict === "denied_human",
          ).length;
          for (const hook of bundle.value.hooks) {
            const cls = hookOutcomeOf({
              result: hook.result,
              reason: hook.reason,
              decision: hook.decision,
            });
            outcomes[cls] = (outcomes[cls] ?? 0) + 1;
            if (hook.versionId !== null && !versionIds.includes(hook.versionId))
              versionIds.push(hook.versionId);
          }
        }
        columns.push({
          threadId,
          label: `#${String(index + 1)}`,
          versionIds: versionIds.slice(0, 16),
        });
        perThread.push({
          label: `#${String(index + 1)}`,
          turns: page.value.items.length,
          calls,
          blocked,
          outcomes,
          inputHash: thread.value.inputHash,
        });
      }
      const hashes = perThread.map((t) => t.inputHash);
      const sameInput = hashes.every((h) => h !== null && h === hashes[0]);
      const rows: CompareRow[] = [
        {
          row: "turns",
          values: Object.fromEntries(
            columns.map((c, i) => [
              c.threadId,
              { value: perThread[i]?.turns ?? 0, state: "exact" as const },
            ]),
          ),
          observation: perThread.every((t) => t.turns === 1),
        },
        {
          row: "calls",
          values: Object.fromEntries(
            columns.map((c, i) => [
              c.threadId,
              { value: perThread[i]?.calls ?? 0, state: "exact" as const },
            ]),
          ),
          observation: perThread.every((t) => t.calls <= 1),
        },
        {
          row: "blocked_calls",
          values: Object.fromEntries(
            columns.map((c, i) => [
              c.threadId,
              { value: perThread[i]?.blocked ?? 0, state: "exact" as const },
            ]),
          ),
          observation: perThread.every((t) => t.blocked <= 1),
        },
        ...HOOK_OUTCOME_CLASSES.map((cls) => ({
          row: `hook.outcomes.${cls}`,
          values: Object.fromEntries(
            columns.map((c, i) => [
              c.threadId,
              { value: perThread[i]?.outcomes[cls] ?? 0, state: "exact" as const },
            ]),
          ),
          observation: perThread.every((t) => (t.outcomes[cls] ?? 0) <= 1),
        })),
      ];
      return ok({ sameInput, columns, rows });
    },
  };
}
