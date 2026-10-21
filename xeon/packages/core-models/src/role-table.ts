import { err, ok, type Result } from "@xeon/contracts";
import type { ModelThinkingLevel } from "@xeon/contracts/conversation";
import {
  parseModelRef,
  type CachePolicy,
  type ModelBinding,
  type ModelError,
  type ModelRefString,
  type ModelRole,
  type ResolutionSource,
  type ResolvedModel,
  type RoleOverrides,
} from "@xeon/contracts/services";
import { clampThinkingLevel, type Api, type Model } from "@earendil-works/pi-ai";

// L1.models.spec §4.1, L1.models.plan M-2. M1은 main 역할과 l1.models.default만 쓰는 최소 경로다.
// 역할 표(routing.*), 그룹 덮어쓰기, ROLE_FALLBACK, 허용·차단 패턴, 토큰 예산은 M2에서 더한다.
// 그래서 이 단계의 역할은 모두 default로 해석된다(역할 표가 비어 있을 때 M2 알고리즘이 내는 결과와 같다).

/** 설정 스냅샷의 M1 부분 */
export interface RoutingTable {
  /** l1.models.default */
  readonly default: ModelRefString | null;
  /** M2의 l1.models.thinkingLevel 자리. M1은 서비스가 고정 값을 넘긴다 */
  readonly thinkingLevel: ModelThinkingLevel;
}

export interface ResolveInput {
  readonly role: ModelRole;
  readonly overrides: RoleOverrides;
  readonly table: RoutingTable;
  /** 카탈로그 조회 */
  readonly lookup: (provider: string, modelId: string) => Model<Api> | undefined;
}

export interface Resolution {
  readonly binding: ModelBinding;
  readonly source: ResolutionSource;
  readonly model: Model<Api>;
  readonly trace: ResolvedModel["trace"];
}

/** 호출을 일으킨 역할이 캐시 보존을 두지 않는 역할인지(L1.models.spec §3.4 표의 기본 캐시 보존) */
const NO_CACHE_ROLES: ReadonlySet<ModelRole> = new Set<ModelRole>(["summary", "judge", "search"]);

/**
 * 캐시 정책의 M1 부분. 보존 기간과 세션 키만 정한다. 표식 위치·상한 적용과 model.compat 읽기는 M2(M-5)다.
 * summary·judge·search는 retention "none"이고 세션 키가 없다.
 */
export function basicCachePolicy(
  role: ModelRole,
  configured: CachePolicy["retention"],
): CachePolicy {
  const none = NO_CACHE_ROLES.has(role) || configured === "none";
  return {
    retention: none ? "none" : configured,
    sessionKey: none ? null : "thread",
    sites: ["system", "tools", "summary", "tail"],
    maxBreakpoints: 4,
    midConversationSystem: false,
    midConversationToolChanges: false,
  };
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
 * 순수 함수. 같은 입력(역할, 덮어쓰기, 설정 스냅샷, 카탈로그)이면 같은 결과를 낸다.
 * 순서: overrides.ref(explicit) → table.default(default) → 없으면 no_model_for_role.
 * 추론 레벨: overrides.thinkingLevel → 참조 접미 → table.thinkingLevel 순으로 정하고 모델이 지원하는 값으로 맞춘다.
 */
export function resolveRole(input: ResolveInput): Result<Resolution, ModelError> {
  const { role, overrides, table } = input;

  let ref: ModelRefString;
  let source: ResolutionSource;
  if (overrides.ref !== undefined) {
    ref = overrides.ref;
    source = "explicit";
  } else if (table.default !== null) {
    ref = table.default;
    source = "default";
  } else {
    return err(modelError("no_model_for_role", `no model is configured for role ${role}`, role));
  }

  const parsed = parseModelRef(ref);
  if (!parsed.ok) {
    return err(modelError("invalid_ref", `model reference is malformed: ${ref}`, role, ref));
  }
  const model = input.lookup(parsed.value.provider, parsed.value.modelId);
  if (model === undefined) {
    return err(
      modelError(
        "model_not_found",
        `model ${parsed.value.provider}/${parsed.value.modelId} is not in the catalog`,
        role,
        ref,
      ),
    );
  }

  const requested = overrides.thinkingLevel ?? parsed.value.thinkingLevel ?? table.thinkingLevel;
  const thinkingLevel: ModelThinkingLevel = model.reasoning
    ? clampThinkingLevel(model, requested)
    : "off";

  return ok({
    binding: {
      role,
      provider: parsed.value.provider,
      modelId: parsed.value.modelId,
      thinkingLevel,
    },
    source,
    model,
    trace: [{ step: source, ref }],
  });
}
