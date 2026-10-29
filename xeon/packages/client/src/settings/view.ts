import { parse } from "@xeon/contracts";
import {
  SecretRef,
  SettingsTabSchema,
  toValueJsonSchema,
  type EffectiveSetting,
  type SettingDefWire,
  type SettingKey,
  type SettingSource,
  type SettingUi,
  type SettingsTab,
} from "@xeon/contracts/settings";
import { t, tKey } from "../i18n/index.ts";
import {
  deprecatedInfo,
  defaultWriteScope,
  lockInfo,
  runtimeBadge,
  runtimeBadgeOf,
  scopeBadge,
  writableScopes,
} from "./badges.ts";
import { TAB_ORDER, TAB_SPECS, type TabSpec } from "./tabs.ts";
import type {
  BadgeScope,
  DeprecatedVM,
  FieldVM,
  FileOnlyEntryVM,
  GaugeSlotVM,
  LockInfo,
  OverviewVM,
  RuntimeBadge,
  ScopeBadge,
  SecretFieldVM,
  SettingsView,
  ShadowedVM,
  TabVM,
  ViewDiagnostic,
  WidgetVM,
  WritableScope,
} from "./types.ts";
import { resolveWidget } from "./widget-map.ts";

// 설정 화면 view-model 조립(L4.settings-ui §4.1, §4.2, §4.3). 정의 목록과 유효 값 목록에서 탭·항목·요약을 만든다.
// 순수 함수다. 입력은 settings.list 결과 합집합과 settings.get 결과다.

export interface SettingsViewInput {
  readonly defs: readonly SettingDefWire[];
  readonly values: ReadonlyMap<SettingKey, EffectiveSetting>;
  /** 열린 대화가 있는가. 없으면 session 쓰기 범위를 뺀다(§4.3.6) */
  readonly hasThread: boolean;
}

const READONLY: WidgetVM = { kind: "readonly" };
const DEFAULT_SOURCE: SettingSource = { scope: "default" };

/** 정의 하나가 화면에서 뜻하는 사실. 항목과 파일 편집기 항목이 함께 쓴다 */
interface Facts {
  readonly value: unknown;
  readonly scope: ScopeBadge;
  readonly runtime: RuntimeBadge;
  readonly lock: LockInfo | null;
  readonly shadowed: readonly ShadowedVM[];
  readonly filePath: string | null;
  readonly writable: readonly WritableScope[];
  readonly deprecated: DeprecatedVM | null;
  readonly secret: SecretFieldVM | null;
  readonly problem: FieldVM["problem"];
}

/** 화면에 보이는 정의 하나와 그 자리. 요약 계산에 쓴다 */
interface Placed {
  readonly key: SettingKey;
  readonly tab: SettingsTab | null;
  readonly deprecated: boolean;
  readonly facts: Facts;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareField(a: FieldVM, b: FieldVM): number {
  return a.order - b.order || compareText(a.key, b.key);
}

/** 같은 키가 두 번 나오면 첫 정의만 쓴다. 뒤의 키는 중복 목록으로 돌려준다 */
function uniqueDefs(defs: readonly SettingDefWire[]): {
  readonly defs: readonly SettingDefWire[];
  readonly duplicates: readonly SettingKey[];
} {
  const sorted = defs.toSorted((a, b) => compareText(a.key, b.key));
  const unique: SettingDefWire[] = [];
  const duplicates: SettingKey[] = [];
  for (const def of sorted) {
    if (unique.at(-1)?.key === def.key) {
      duplicates.push(def.key);
    } else {
      unique.push(def);
    }
  }
  return { defs: unique, duplicates };
}

/** 비밀 값은 SecretRef 문자열만 통과한다. 평문이면 null이다(§4.6.1) */
function refOf(value: unknown): string | null {
  const parsed = parse(SecretRef, value);
  return parsed.ok ? parsed.value : null;
}

function secretFieldOf(value: unknown): SecretFieldVM {
  const ref = refOf(value);
  return { ref, status: ref === null ? "unset" : "referenced" };
}

function shadowedOf(source: SettingSource): ShadowedVM {
  return { scope: source.scope, path: source.path ?? null };
}

function factsOf(
  def: SettingDefWire,
  setting: EffectiveSetting | undefined,
  catalog: ReadonlyMap<SettingKey, SettingDefWire>,
  hasThread: boolean,
): Facts {
  const raw: unknown = setting === undefined ? null : setting.value;
  const secret = def.secret === true ? secretFieldOf(raw) : null;
  return {
    value: secret === null ? raw : secret.ref,
    scope: scopeBadge(setting?.source ?? DEFAULT_SOURCE),
    runtime:
      setting === undefined ? runtimeBadgeOf(def.runtimeChange, null) : runtimeBadge(setting),
    lock: setting === undefined ? null : lockInfo(setting),
    shadowed: (setting?.shadowed ?? []).map(shadowedOf),
    filePath: setting?.source.path ?? null,
    writable: writableScopes(def, setting, hasThread),
    deprecated: deprecatedInfo(def, catalog),
    secret,
    problem:
      setting?.problem === undefined
        ? null
        : { kind: setting.problem.kind, args: setting.problem.args ?? null },
  };
}

/** 정의의 문구. 메시지 키가 있으면 현재 로케일의 카탈로그 문장을 쓰고, 없으면 정의에 적힌 문구를 그대로 쓴다 */
function textOf(text: string, key: string | undefined): string {
  return key === undefined ? text : tKey(key, text);
}

/** 설명. 설명 문구와 키가 모두 없으면 null이다 */
function helpOf(ui: SettingUi): string | null {
  if (ui.help === undefined && ui.helpKey === undefined) return null;
  return textOf(ui.help ?? "", ui.helpKey);
}

function fieldOf(
  def: SettingDefWire,
  ui: SettingUi,
  tab: SettingsTab,
  widget: WidgetVM,
  facts: Facts,
  setting: EffectiveSetting | undefined,
): FieldVM {
  const canReset =
    setting !== undefined && facts.writable.some((scope) => scope === setting.source.scope);
  return {
    key: def.key,
    tab,
    order: ui.order,
    label: textOf(ui.label, ui.labelKey),
    help: helpOf(ui),
    widget,
    value: facts.value,
    scope: facts.scope,
    runtime: facts.runtime,
    lock: facts.lock,
    shadowed: facts.shadowed,
    filePath: facts.filePath,
    writableScopes: facts.writable,
    selectedScope: defaultWriteScope(facts.writable),
    canReset,
    editable: facts.writable.length > 0 && widget.kind !== "readonly",
    deprecated: facts.deprecated,
    secret: facts.secret,
    problem: facts.problem,
    editor: ui.editor ?? null,
  };
}

function fileOnlyOf(def: SettingDefWire, facts: Facts): FileOnlyEntryVM {
  return {
    key: def.key,
    value: facts.value,
    scope: facts.scope,
    lock: facts.lock,
    writableScopes: facts.writable,
    jsonSchema: toValueJsonSchema(def),
  };
}

/**
 * 폐기 정의의 표시 규칙(§4.1 규칙 5): 사용자가 값을 둔 경우에만 보인다. 값이 없거나 출처가 default이면 숨긴다.
 */
function hiddenAsDeprecated(def: SettingDefWire, setting: EffectiveSetting | undefined): boolean {
  return (
    def.deprecated !== undefined && (setting === undefined || setting.source.scope === "default")
  );
}

function isGaugeTab(tab: SettingsTab): tab is "budgets" | "providers" {
  return tab === "budgets" || tab === "providers";
}

function gaugeOf(spec: TabSpec): GaugeSlotVM | null {
  if (!spec.gauge || !isGaugeTab(spec.id)) return null;
  return { tab: spec.id, status: "unavailable", text: t("client.settings.view.gaugeUnavailable") };
}

function overviewOf(placed: readonly Placed[]): OverviewVM {
  const countsByScope: Record<BadgeScope, number> = {
    managed: 0,
    user: 0,
    project: 0,
    local: 0,
    session: 0,
    default: 0,
  };
  const locked: SettingKey[] = [];
  const pendingRestart: SettingKey[] = [];
  const pendingNextTurn: SettingKey[] = [];
  const deprecatedInUse: SettingKey[] = [];
  const secretRefs: {
    key: SettingKey;
    tab: SettingsTab | null;
    status: SecretFieldVM["status"];
  }[] = [];
  for (const entry of placed) {
    const { facts } = entry;
    countsByScope[facts.scope.scope] += 1;
    if (facts.lock !== null) locked.push(entry.key);
    if (facts.runtime.pending === "restart") pendingRestart.push(entry.key);
    if (facts.runtime.pending === "nextTurn") pendingNextTurn.push(entry.key);
    if (entry.deprecated) deprecatedInUse.push(entry.key);
    if (facts.secret !== null) {
      secretRefs.push({ key: entry.key, tab: entry.tab, status: facts.secret.status });
    }
  }
  return { countsByScope, locked, pendingRestart, pendingNextTurn, deprecatedInUse, secretRefs };
}

/**
 * 설정 화면 view-model을 만든다. 정의는 키 순서로 처리해서 같은 입력이면 진단 순서도 같다.
 * - `ui`가 없거나 `stage`가 reserved인 정의는 파일 편집기 항목(fileOnly)이다. reserved는 항목 자리도 만들지 않는다.
 * - `ui.tab`이 탭 표에 없으면 fileOnly로 보내고 `unknownTab` 진단을 남긴다.
 * - 폐기 정의는 출처가 default이면 숨긴다.
 * - 값이 없는 정의는 읽기 전용이고 `missingValue` 진단을 남긴다(reserved는 값이 없는 것이 정상이라 남기지 않는다).
 */
export function buildSettingsView(input: SettingsViewInput): SettingsView {
  const unique = uniqueDefs(input.defs);
  const diagnostics: ViewDiagnostic[] = unique.duplicates.map((key) => ({
    code: "duplicateKey",
    key,
  }));
  const catalog: ReadonlyMap<SettingKey, SettingDefWire> = new Map(
    unique.defs.map((def) => [def.key, def]),
  );
  const fieldsByTab = new Map<SettingsTab, FieldVM[]>();
  const fileOnly: FileOnlyEntryVM[] = [];
  const placed: Placed[] = [];

  for (const def of unique.defs) {
    const setting = input.values.get(def.key);
    if (hiddenAsDeprecated(def, setting)) continue;
    const facts = factsOf(def, setting, catalog, input.hasThread);
    const deprecated = def.deprecated !== undefined;
    if (setting === undefined && def.stage !== "reserved") {
      diagnostics.push({ code: "missingValue", key: def.key });
    }

    const ui = def.stage === "reserved" ? undefined : def.ui;
    if (ui === undefined) {
      fileOnly.push(fileOnlyOf(def, facts));
      placed.push({ key: def.key, tab: null, deprecated, facts });
      continue;
    }
    const tab = parse(SettingsTabSchema, ui.tab);
    if (!tab.ok) {
      diagnostics.push({ code: "unknownTab", key: def.key, tab: ui.tab });
      fileOnly.push(fileOnlyOf(def, facts));
      placed.push({ key: def.key, tab: null, deprecated, facts });
      continue;
    }

    const resolved = resolveWidget(def);
    if (resolved.diagnostic !== null) diagnostics.push(resolved.diagnostic);
    const widget = setting === undefined ? READONLY : resolved.widget;
    const field = fieldOf(def, ui, tab.value, widget, facts, setting);
    const list = fieldsByTab.get(tab.value) ?? [];
    list.push(field);
    fieldsByTab.set(tab.value, list);
    placed.push({ key: def.key, tab: tab.value, deprecated, facts });
  }

  const tabs: TabVM[] = TAB_ORDER.map((id) => {
    const spec = TAB_SPECS[id];
    const fields = (fieldsByTab.get(id) ?? []).toSorted(compareField);
    return {
      id,
      label: spec.label,
      fields,
      gauge: gaugeOf(spec),
      emptyText: fields.length === 0 ? spec.emptyText : null,
    };
  });

  const overview = overviewOf(placed);
  const restartCount = overview.pendingRestart.length;
  return {
    tabs,
    fileOnly,
    overview,
    diagnostics,
    restartBanner:
      restartCount === 0
        ? null
        : {
            count: restartCount,
            text: t("client.settings.view.restartBanner", { count: restartCount }),
          },
  };
}

/** 화면에 보이는 설정 키 전부를 정렬해 돌려준다: 탭 항목과 파일 편집기 항목. 스키마 키 집합 시험이 쓴다 */
export function settingsViewKeys(view: SettingsView): readonly string[] {
  const keys = [
    ...view.tabs.flatMap((tab) => tab.fields.map((field) => field.key)),
    ...view.fileOnly.map((entry) => entry.key),
  ];
  return keys.toSorted(compareText);
}
