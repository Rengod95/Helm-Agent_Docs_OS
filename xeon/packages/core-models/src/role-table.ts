import { err, ok, type Result } from "@xeon/contracts";
import type { ModelThinkingLevel } from "@xeon/contracts/conversation";
import {
  parseModelRef,
  type ModelBinding,
  type ModelError,
  type ModelRefString,
  type ModelRole,
  type ResolutionSource,
  type ResolvedModel,
  type RoleOverrides,
} from "@xeon/contracts/services";
import { clampThinkingLevel, type Api, type Model } from "@earendil-works/pi-ai";
import type { BudgetLevel, ThinkingBudgetSettings } from "./settings.ts";

// L1.models.spec §4.1, L1.models.plan M-2. 순수 해석기다. 같은 입력(역할, 덮어쓰기, 설정 스냅샷, 카탈로그)이면
// 같은 결과를 내고 입력 객체의 키 순서에 영향받지 않는다.

/** 설정 스냅샷 중 해석에 쓰는 부분(L1.models.spec §4.1 RoutingTable) */
export interface RoutingTable {
  /** l1.models.default */
  readonly default: ModelRefString | null;
  /** l1.models.routing.* . main은 default가 맡는다 */
  readonly routing: Readonly<Partial<Record<Exclude<ModelRole, "main">, ModelRefString | null>>>;
  /** l1.models.groupRouting */
  readonly groupRouting: Readonly<
    Record<string, Readonly<Partial<Record<ModelRole, ModelRefString>>>>
  >;
  /** l1.models.thinkingLevel */
  readonly thinkingLevel: ModelThinkingLevel;
  /** l1.models.thinkingBudgets */
  readonly thinkingBudgets: ThinkingBudgetSettings;
  /** l1.models.allowedModels. 비면 전체 허용 */
  readonly allowed: readonly string[];
  /** l1.models.deniedModels */
  readonly denied: readonly string[];
}

/** 역할이 값을 갖지 못했을 때 차례로 찾는 대체 역할. 마지막은 항상 default다 */
export const ROLE_FALLBACK: Readonly<Record<ModelRole, readonly ModelRole[]>> = {
  main: [],
  review: ["main"],
  summary: ["main"],
  subagent: ["main"],
  judge: ["review", "main"],
  search: ["summary", "main"],
};

export interface ResolveInput {
  readonly role: ModelRole;
  readonly overrides: RoleOverrides;
  readonly table: RoutingTable;
  /** 카탈로그 조회 */
  readonly lookup: (provider: string, modelId: string) => Model<Api> | undefined;
  /** 그룹 덮어쓰기를 쓸 수 있는 scope인지. 꺼진 scope의 값은 무시한다(spec §5). 없으면 모두 켜짐 */
  readonly scopeEnabled?: (scopeId: string) => boolean;
}

export interface Resolution {
  readonly binding: ModelBinding;
  readonly source: ResolutionSource;
  readonly model: Model<Api>;
  readonly trace: ResolvedModel["trace"];
  /** 레벨별 토큰 예산. 레벨이 off이거나 예산을 쓰지 않는 모델이면 null */
  readonly thinkingBudgetTokens: number | null;
}

function modelError(
  kind: ModelError["kind"],
  message: string,
  role?: ModelRole,
  ref?: string,
): ModelError {
  return {
    kind,
    message,
    ...(role === undefined ? {} : { role }),
    ...(ref === undefined ? {} : { ref }),
  };
}

/**
 * `provider/modelId` 전체 일치 또는 `provider/*` 패턴이 모델 참조에 맞는지.
 * 패턴은 정규식이 아니라 두 형식뿐이다
 */
export function matchesModelPattern(pattern: string, provider: string, modelId: string): boolean {
  if (pattern.endsWith("/*")) return pattern.slice(0, -2) === provider;
  return pattern === `${provider}/${modelId}`;
}

/** 허용·차단 목록을 통과하는지. resolve, rebind, list가 같은 판정을 쓴다 */
export function isModelAllowed(
  lists: Pick<RoutingTable, "allowed" | "denied">,
  provider: string,
  modelId: string,
): boolean {
  if (lists.denied.some((pattern) => matchesModelPattern(pattern, provider, modelId))) return false;
  if (lists.allowed.length === 0) return true;
  return lists.allowed.some((pattern) => matchesModelPattern(pattern, provider, modelId));
}

/**
 * pi-ai `thinkingBudgets`는 minimal~high 네 키만 받는다(L1.models.spec §3.1). xhigh·max의 숫자 예산은
 * 설정에 저장만 하고 provider 매핑에 맡긴다
 */
export function passableBudgets(
  budgets: ThinkingBudgetSettings,
): Readonly<Record<"minimal" | "low" | "medium" | "high", number>> {
  return {
    minimal: budgets.minimal,
    low: budgets.low,
    medium: budgets.medium,
    high: budgets.high,
  };
}

/** 레벨별 토큰 예산. 레벨이 off이거나 추론 모델이 아니면 null */
export function budgetOf(
  table: Pick<RoutingTable, "thinkingBudgets">,
  model: Model<Api>,
  level: ModelThinkingLevel,
): number | null {
  if (level === "off" || !model.reasoning) return null;
  const key: BudgetLevel = level;
  return table.thinkingBudgets[key];
}

interface Candidate {
  readonly step: ResolutionSource;
  readonly ref: ModelRefString | null;
}

/** 해석 순서(spec §4.1)대로 거칠 단계를 나열한다. 값이 없는 단계는 ref가 null이다 */
function candidatesOf(input: ResolveInput): readonly Candidate[] {
  const { role, overrides, table } = input;
  const scopeId = overrides.scopeId;
  const groups =
    scopeId !== undefined && (input.scopeEnabled === undefined || input.scopeEnabled(scopeId))
      ? table.groupRouting[scopeId]
      : undefined;
  const groupRef = (r: ModelRole): ModelRefString | null => groups?.[r] ?? null;
  const roleRef = (r: ModelRole): ModelRefString | null =>
    r === "main" ? null : (table.routing[r] ?? null);

  const out: Candidate[] = [{ step: "explicit", ref: overrides.ref ?? null }];
  if (scopeId !== undefined) out.push({ step: `group:${scopeId}`, ref: groupRef(role) });
  if (role !== "main") out.push({ step: "role", ref: roleRef(role) });
  for (const fallback of ROLE_FALLBACK[role]) {
    out.push({ step: "role-fallback", ref: groupRef(fallback) ?? roleRef(fallback) });
  }
  out.push({ step: "default", ref: table.default });
  return out;
}

/**
 * 순서: overrides.ref(explicit) → groupRouting[scopeId][role](group:<scopeId>) → routing[role](role) →
 * ROLE_FALLBACK 역할들(role-fallback) → default. 값이 있는 첫 단계를 쓰고, 그 값이 틀렸으면 다음 단계로 넘어가지 않고
 * 오류를 돌려준다. 모두 없으면 no_model_for_role.
 * 추론 레벨: overrides.thinkingLevel → 참조 접미 → table.thinkingLevel 순으로 정하고 모델이 지원하는 값으로 맞춘다.
 */
export function resolveRole(input: ResolveInput): Result<Resolution, ModelError> {
  const { role, overrides, table } = input;

  const trace: { step: ResolutionSource; ref: ModelRefString | null }[] = [];
  let chosen: Candidate | undefined;
  for (const candidate of candidatesOf(input)) {
    trace.push({ step: candidate.step, ref: candidate.ref });
    if (candidate.ref !== null) {
      chosen = candidate;
      break;
    }
  }
  if (chosen === undefined || chosen.ref === null) {
    return err(modelError("no_model_for_role", `no model is configured for role ${role}`, role));
  }
  const ref = chosen.ref;

  const parsed = parseModelRef(ref);
  if (!parsed.ok) {
    return err(modelError("invalid_ref", `model reference is malformed: ${ref}`, role, ref));
  }
  const { provider, modelId } = parsed.value;
  const model = input.lookup(provider, modelId);
  if (model === undefined) {
    return err(
      modelError(
        "model_not_found",
        `model ${provider}/${modelId} is not in the catalog`,
        role,
        ref,
      ),
    );
  }
  if (!isModelAllowed(table, provider, modelId)) {
    return err(
      modelError("model_denied", `model ${provider}/${modelId} is not allowed`, role, ref),
    );
  }

  const requested = overrides.thinkingLevel ?? parsed.value.thinkingLevel ?? table.thinkingLevel;
  const thinkingLevel: ModelThinkingLevel = model.reasoning
    ? clampThinkingLevel(model, requested)
    : "off";

  return ok({
    binding: { role, provider, modelId, thinkingLevel },
    source: chosen.step,
    model,
    trace,
    thinkingBudgetTokens: budgetOf(table, model, thinkingLevel),
  });
}
