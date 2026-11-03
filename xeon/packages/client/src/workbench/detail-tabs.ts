// P-17 확장 상세의 설정·측정·화면 탭과 출처 배지(ADR-0022 §3.3)의 순수 모델. 엔진이 준 값만 쓰고 지어내지 않는다.
// 출처 배지의 범위는 wire가 준 범위 값에서만 고른다. 값이 없으면 배지를 두지 않는다(프로젝트 범위를 추정하지 않는다).
import { assertNever, type Result } from "@fresnel/contracts";
import type { EffectiveSetting, SettingDefWire } from "@fresnel/contracts/settings";
import type { EnabledSource, ExtUiEntry, GroupMetricsResult } from "@fresnel/contracts/wire";
import { buildSettingsView } from "../settings/view.ts";
import type { BadgeScope, FieldVM } from "../settings/types.ts";

/** 출처 배지의 범위(ADR-0022 §3.3: 전역 / 프로젝트 / 이 대화). `local`과 `managed`, `default`는 같은 자리에 그대로 보인다 */
export type SourceScope = "global" | "project" | "thread" | "managed" | "local" | "default";

/** 켜짐 요청의 출처(`ext.list`의 `enabledSource`)를 배지 범위로 바꾼다. 호스트가 싣지 않았으면 null */
export function enabledScopeOf(source: EnabledSource | undefined): SourceScope | null {
  switch (source) {
    case undefined:
      return null;
    case "user":
      return "global";
    case "project":
      return "project";
    case "thread":
      return "thread";
    case "managed":
      return "managed";
    case "default":
      return "default";
    default:
      return assertNever(source, "EnabledSource");
  }
}

/** 설정 값을 정한 범위(`settings.get`의 `source.scope`)를 배지 범위로 바꾼다. 이번 실행(`launch`)은 이 대화 범위다 */
export function settingScopeOf(scope: BadgeScope): SourceScope {
  switch (scope) {
    case "managed":
      return "managed";
    case "user":
      return "global";
    case "project":
      return "project";
    case "local":
      return "local";
    case "launch":
      return "thread";
    case "default":
      return "default";
    default:
      return assertNever(scope, "BadgeScope");
  }
}

// ───────── 설정 탭 ─────────

/** 확장 하나의 설정 키 접두사. 확장 설정(예약 키와 userConfig)은 `ext.<이름>.`, 그룹 설정은 `l3.<이름>.`이다 */
export function extSettingPrefixes(name: string): readonly string[] {
  return [`ext.${name}.`, `l3.${name}.`];
}

/** 설정 키가 이 확장의 것인가. 접두사 뒤에 이름이 있어야 한다 */
function ownsKey(name: string, key: string): boolean {
  return extSettingPrefixes(name).some(
    (prefix) => key.startsWith(prefix) && key.length > prefix.length,
  );
}

export type ExtSettingValueVM =
  | { readonly kind: "text"; readonly text: string }
  /** 시크릿 참조가 있다. 참조 이름도 값도 싣지 않는다 */
  | { readonly kind: "secret" }
  /** 값이 없다. 시크릿이 아직 등록되지 않은 경우도 여기다 */
  | { readonly kind: "unset" };

export interface ExtSettingRowVM {
  readonly key: string;
  readonly label: string;
  readonly value: ExtSettingValueVM;
  readonly scope: SourceScope;
}

/** 설정 탭의 입력: `settings.list`(접두사별로 읽은 정의)와 `settings.get`(유효 값), 대화가 열렸는지 */
export interface ExtSettingsInput {
  readonly defs: readonly SettingDefWire[];
  readonly values: readonly EffectiveSetting[];
  readonly hasThread: boolean;
}

function settingValueOf(field: FieldVM): ExtSettingValueVM {
  if (field.secret !== null) {
    return field.secret.status === "referenced" ? { kind: "secret" } : { kind: "unset" };
  }
  const value = field.value;
  if (value === null || value === undefined) return { kind: "unset" };
  if (typeof value === "string") return { kind: "text", text: value };
  return { kind: "text", text: JSON.stringify(value) };
}

/**
 * 이 확장의 설정 줄. 정의와 값으로 `buildSettingsView`를 만들고 그중 `plugins` 탭의 이 확장 키만 남긴다.
 * 읽기 전용이다(설정 저장은 P-09 규칙의 입력 칸이 생기면 따로 붙인다).
 */
export function extSettingRowsOf(
  name: string,
  input: ExtSettingsInput,
): readonly ExtSettingRowVM[] {
  const defs = input.defs.filter((def) => ownsKey(name, def.key));
  const values = new Map<string, EffectiveSetting>(
    input.values.map((setting): [string, EffectiveSetting] => [setting.key, setting]),
  );
  const view = buildSettingsView({ defs, values, hasThread: input.hasThread });
  const plugins = view.tabs.find((tab) => tab.id === "plugins");
  return (plugins?.fields ?? [])
    .filter((field) => ownsKey(name, field.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: settingValueOf(field),
      scope: settingScopeOf(field.scope.scope),
    }));
}

// ───────── 측정 탭(그룹만) ─────────

/** 토큰 칸. 네 칸은 서로 겹치지 않는다(입력, 출력, 캐시 읽기, 캐시 쓰기) */
export type TokenKey = "input" | "output" | "cacheRead" | "cacheWrite";

/** 시간 값과 그 단위. 1초 밑은 밀리초, 1분 밑은 초, 그 밖은 분이다(내림) */
export interface DurationVM {
  readonly unit: "ms" | "sec" | "min";
  readonly value: number;
}

export function durationOf(ms: number): DurationVM {
  if (ms < 1000) return { unit: "ms", value: Math.floor(ms) };
  if (ms < 60_000) return { unit: "sec", value: Math.floor(ms / 1000) };
  return { unit: "min", value: Math.floor(ms / 60_000) };
}

/**
 * 정가 기준 추정 비용의 글. 0이거나 1센트 이상이면 소수 둘, 그 밑이면 소수 넷이다.
 * 구독 사용자의 실제 청구액과 다르므로 화면은 "정가 기준 추정"이라고 붙인다(§6.27).
 */
export function costText(usd: number): string {
  const digits = usd === 0 || usd >= 0.01 ? 2 : 4;
  return `$${usd.toFixed(digits)}`;
}

export interface GroupMetricsVM {
  readonly tokens: readonly { readonly key: TokenKey; readonly value: number }[];
  readonly costUsd: number;
  readonly lead: DurationVM;
  readonly denies: number;
  readonly handlerErrors: number;
  readonly posts: number;
  readonly spawns: number;
}

/**
 * `group.metrics` 결과의 측정 값. 계측이 꺼져 있으면(`metrics`가 null) null이다.
 * 합치는 점수는 만들지 않는다. `since`는 이 탭이 요청하지 않으므로 무시한다.
 */
export function groupMetricsOf(result: GroupMetricsResult): GroupMetricsVM | null {
  const m = result.metrics;
  if (m === null) return null;
  return {
    tokens: [
      { key: "input", value: m.inputTokens },
      { key: "output", value: m.outputTokens },
      { key: "cacheRead", value: m.cacheReadTokens },
      { key: "cacheWrite", value: m.cacheWriteTokens },
    ],
    costUsd: m.costUsd,
    lead: durationOf(m.leaseMs),
    denies: m.denies,
    handlerErrors: m.handlerErrors,
    posts: m.posts,
    spawns: m.spawns,
  };
}

// ───────── 화면 탭 ─────────

export interface ScreenRowVM {
  readonly id: string;
  readonly title: string;
  readonly placement: ExtUiEntry["placement"];
  readonly mode: ExtUiEntry["mode"];
  readonly state: ExtUiEntry["state"];
  readonly issues: number;
}

/** `ext.ui.list` 항목 가운데 이 확장이 기여한 화면만, 호스트가 준 순서대로 */
export function screenRowsOf(name: string, items: readonly ExtUiEntry[]): readonly ScreenRowVM[] {
  return items
    .filter((item) => item.extension === name)
    .map((item) => ({
      id: item.id,
      title: item.title,
      placement: item.placement,
      mode: item.mode,
      state: item.state,
      issues: item.issues.length,
    }));
}

// ───────── 탭의 읽기 상태 ─────────

/** 탭 하나의 읽기 결과. `offline`은 연결이 없고 읽은 값도 없다는 뜻이다 */
export type TabRead<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "offline" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly value: T; readonly stale: boolean };

/** 탭이 마지막으로 읽은 결과와 그 키(확장 이름과 대화를 합친 것). 키가 다르면 다른 확장·대화의 값이라 쓰지 않는다 */
export interface TabSlot<T> {
  readonly key: string;
  readonly state: { readonly kind: "ready"; readonly value: T } | { readonly kind: "error" };
}

/** 엔진 연결 상태. `pending`은 연결하는 중이다(런타임 탭의 `LinkState`와 같은 값) */
export type TabLink = "live" | "offline" | "pending";

/**
 * 탭이 그릴 읽기 상태. 연결이 살아 있으면 읽은 결과를 보이고, 읽기 전이면 읽는 중이다.
 * 연결하는 중에는 같은 키의 마지막 값이 있으면 그 값을, 없으면 읽는 중을 보인다.
 * 연결이 끊기면 같은 키로 읽은 마지막 값을 `stale`로 보이고, 읽은 값이 없으면 오프라인이다.
 */
export function tabReadOf<T>(slot: TabSlot<T> | null, key: string, link: TabLink): TabRead<T> {
  const mine = slot !== null && slot.key === key ? slot.state : null;
  switch (link) {
    case "live":
      if (mine === null) return { kind: "loading" };
      return mine.kind === "ready"
        ? { kind: "ready", value: mine.value, stale: false }
        : { kind: "error" };
    case "pending":
      return mine?.kind === "ready"
        ? { kind: "ready", value: mine.value, stale: true }
        : { kind: "loading" };
    case "offline":
      return mine?.kind === "ready"
        ? { kind: "ready", value: mine.value, stale: true }
        : { kind: "offline" };
    default:
      return assertNever(link, "TabLink");
  }
}

/** 명령 결과를 탭 슬롯의 값으로 바꾼다. 실패는 종류를 버리고 오류 한 줄로 보인다 */
export function slotOf<T, E>(key: string, result: Result<T, E>): TabSlot<T> {
  return result.ok
    ? { key, state: { kind: "ready", value: result.value } }
    : { key, state: { kind: "error" } };
}
