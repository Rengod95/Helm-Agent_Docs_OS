// 검사기(spec L4.desktop-ux §6.22.4, 오른쪽 "검사" 탭)의 순수 모델. 캔버스나 목록에서 고른 확장 하나를 읽을 값으로 바꾼다.
// 값이 없는 구역은 비운다. 엔진이 준 것만 쓰고 지어내지 않는다.
import {
  CompositionDeclSchema,
  HOOK_NAMES,
  HOOKS,
  UserConfigEntrySchema,
  type ExtHookTiming,
  type HookName,
} from "@fresnel/contracts/extensions";
import { parse } from "@fresnel/contracts";
import type {
  ExtBindingEdge,
  ExtHealthEntry,
  ExtHookInfo,
  SettingsExplainResult,
} from "@fresnel/contracts/wire";
import type { RuntimeDriveView } from "./runtime.ts";

/** 훅 예산 막대의 단계. 50% 이상 warning, 100% 이상 danger */
export type BudgetLevel = "normal" | "warning" | "danger";

/** 훅 한 줄: 이름, fold, 예산, p95, 실패 수, 예산 대비 단계 */
export interface InspectHookVM {
  readonly hook: string;
  readonly registrationId: string;
  /** 훅의 fold(`tap`, `first`, `chain`, `collect`). 훅 이름이 알려진 훅이 아니면 null */
  readonly fold: string | null;
  readonly budgetClass: string;
  readonly budgetMs: number;
  /** 측정된 p95(`ext.timings`). 계측이 꺼졌거나 아직 측정이 없으면 null */
  readonly p95Ms: number | null;
  /** 측정된 실패 수. 측정이 없으면 null */
  readonly failures: number | null;
  /** p95가 예산의 몇 %인지에 따른 단계. 측정이 없거나 예산이 0이면 null */
  readonly level: BudgetLevel | null;
}

/** 훅 이름이 F의 알려진 훅인지 가린다(`HOOKS`의 키) */
function knownHook(name: string): HookName | undefined {
  return HOOK_NAMES.find((hook) => hook === name);
}

/** p95와 예산으로 단계를 정한다. 예산이 0 이하면 단계를 정하지 않는다 */
export function budgetLevelOf(p95Ms: number, budgetMs: number): BudgetLevel | null {
  if (budgetMs <= 0) return null;
  const ratio = p95Ms / budgetMs;
  if (ratio >= 1) return "danger";
  if (ratio >= 0.5) return "warning";
  return "normal";
}

/**
 * 훅 줄. `hooks`는 `ext.get`의 훅 목록(이 확장의 Registration별), `timings`는 `ext.timings`에서 이 확장의 칸이다.
 * 계측이 꺼져 있으면 `timings`는 빈 배열이고 p95와 실패 수는 null이다.
 */
export function inspectHookRowsOf(
  hooks: readonly ExtHookInfo[],
  timings: readonly ExtHookTiming[],
): readonly InspectHookVM[] {
  return hooks.map((info) => {
    const measured = timings.find(
      (t) => t.registrationId === info.registrationId && t.hook === info.hook,
    );
    const known = knownHook(info.hook);
    return {
      hook: info.hook,
      registrationId: info.registrationId,
      fold: known === undefined ? null : HOOKS[known].fold,
      budgetClass: info.budgetClass,
      budgetMs: info.budgetMs,
      p95Ms: measured?.p95Ms ?? null,
      failures: measured?.failures ?? null,
      level: measured === undefined ? null : budgetLevelOf(measured.p95Ms, info.budgetMs),
    };
  });
}

/** 기능 한 줄(요구·선택). `satisfied`가 거짓이면 묶인 제공자가 없다 */
export interface InspectFeatureVM {
  readonly capability: string;
  /** 맞은편 Registration id. 없으면 null */
  readonly peer: string | null;
  readonly satisfied: boolean;
}

/** 기능 구역: 제공하는 것, 요구하는 것, 선택하는 것 */
export interface InspectFeaturesVM {
  readonly provides: readonly string[];
  readonly requires: readonly InspectFeatureVM[];
  readonly optional: readonly InspectFeatureVM[];
}

function featureOf(edge: ExtBindingEdge): InspectFeatureVM {
  return { capability: edge.capability, peer: edge.peer, satisfied: edge.satisfied };
}

export function inspectFeaturesOf(bindings: readonly ExtBindingEdge[]): InspectFeaturesVM {
  return {
    provides: unique(bindings.filter((b) => b.relation === "provides").map((b) => b.capability)),
    requires: bindings.filter((b) => b.relation === "requires").map(featureOf),
    optional: bindings.filter((b) => b.relation === "optional").map(featureOf),
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** 실패 장부 한 줄(Registration별). 실패가 없는 Registration은 뺀다 */
export interface InspectHealthVM {
  readonly registrationId: string;
  readonly consecutiveFailures: number;
  readonly lastFailureAt: string | null;
  readonly lastError: string | null;
  readonly autoDisabled: boolean;
}

export function inspectHealthOf(entries: readonly ExtHealthEntry[]): readonly InspectHealthVM[] {
  return entries
    .filter((e) => e.consecutiveFailures > 0 || e.lastFailureAt !== null || e.autoDisabled)
    .map((e) => ({
      registrationId: e.registrationId,
      consecutiveFailures: e.consecutiveFailures,
      lastFailureAt: e.lastFailureAt,
      lastError: e.lastError,
      autoDisabled: e.autoDisabled,
    }));
}

/** 구성 구역의 블록 한 줄(`composition`의 blocks) */
export interface InspectBlockVM {
  readonly id: string;
  readonly stage: string;
  readonly op: string;
  readonly title: string | null;
}

/**
 * 매니페스트의 `composition`을 읽는다. 선언이 없으면 null("구성 정보 없음"), 모양이 맞지 않으면 역시 null이다.
 */
export function inspectCompositionOf(
  manifest: Readonly<Record<string, unknown>>,
): readonly InspectBlockVM[] | null {
  if (manifest["composition"] === undefined) return null;
  const parsed = parse(CompositionDeclSchema, manifest["composition"]);
  if (!parsed.ok) return null;
  return parsed.value.blocks.map((block) => ({
    id: block.id,
    stage: block.stage,
    op: block.op,
    title: block.title ?? null,
  }));
}

/** 설정 바인딩 한 줄(매니페스트 `userConfig`와 `settings.explain`) */
export interface InspectSettingVM {
  readonly key: string;
  readonly title: string;
  /** 시크릿 항목은 값을 싣지 않는다(null) */
  readonly value: string | null;
  /** 이긴 범위(`managed`, `user`, `project`, `local`, `session`). 기본값이면 null */
  readonly winningScope: string | null;
  readonly writer: SettingsExplainResult["writer"];
}

/** 설정 한 줄을 만든다. 시크릿이면 값을 가린다. */
export function inspectSettingOf(
  entry: { readonly setting: string; readonly title: string; readonly sensitive?: boolean },
  explained: SettingsExplainResult,
): InspectSettingVM {
  return {
    key: entry.setting,
    title: entry.title,
    value:
      entry.sensitive === true || explained.value === undefined
        ? null
        : JSON.stringify(explained.value),
    winningScope: explained.winningScope,
    writer: explained.writer,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** 매니페스트의 `userConfig` 항목 목록을 설정 키·제목 쌍으로 읽는다. 모양이 맞지 않는 항목은 뺀다 */
export function userConfigOf(
  manifest: Readonly<Record<string, unknown>>,
): readonly { readonly setting: string; readonly title: string; readonly sensitive?: boolean }[] {
  const config = manifest["userConfig"];
  if (!isRecord(config)) return [];
  return Object.values(config).flatMap((value) => {
    const parsed = parse(UserConfigEntrySchema, value);
    if (!parsed.ok) return [];
    const { setting, title, sensitive } = parsed.value;
    return [sensitive === undefined ? { setting, title } : { setting, title, sensitive }];
  });
}

/** 이 확장의 drive 상태(그룹이고 drive를 쓸 때만). 역할과 대기 횟수는 `RuntimeDriveView`에서 찾는다 */
export interface InspectDriveVM {
  readonly role: DriveRoleOf;
  readonly waits: number | null;
  readonly waitLimit: number | null;
}

/** 검사기 drive 역할: 보유, 대기, 거절, 오류, 후보 아님(`none`) */
export type DriveRoleOf = "holder" | "waiting" | "rejected" | "error" | "none";

/** 그룹 id의 drive 역할을 drive 구역 값에서 찾는다. 구역에 없으면 후보가 아니다(`none`) */
export function inspectDriveOf(view: RuntimeDriveView, id: string): InspectDriveVM {
  if (view.holder?.id === id) return { role: "holder", waits: null, waitLimit: null };
  const queued = view.queue.find((m) => m.id === id);
  if (queued !== undefined)
    return { role: "waiting", waits: queued.waits, waitLimit: queued.waitLimit };
  if (view.rejected.some((m) => m.id === id))
    return { role: "rejected", waits: null, waitLimit: null };
  if (view.errored.some((m) => m.id === id)) return { role: "error", waits: null, waitLimit: null };
  return { role: "none", waits: null, waitLimit: null };
}
