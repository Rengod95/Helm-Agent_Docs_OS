import type { SchemaProof } from "@fresnel/contracts";
import { Type, type TUnsafe } from "typebox";
import { Value } from "typebox/value";
import type { Tier } from "../tier.ts";

// 외부 훅 정의와 설정 범위 병합(X.operations.spec §3.7, §4.7.1, §4.7.6)

const HOOK_ID_PATTERN = "^[a-z][a-z0-9-]{1,63}$";

/** 외부 훅이 참여할 수 있는 지점. 고빈도 stream tap과 모델 요청 직전 chain은 뺀다(§4.7.2) */
const HOOK_HOOKS = [
  "input.user.before",
  "input.bash.before",
  "tool.call.before",
  "tool.result",
  "thread.start",
  "thread.compact.before",
  "boundary.settle.after",
  "thread.shutdown",
] as const;
export type HookHookName = (typeof HOOK_HOOKS)[number];

const HookDefShape = Type.Object(
  {
    id: Type.String({ pattern: HOOK_ID_PATTERN }),
    point: Type.Union(HOOK_HOOKS.map((name) => Type.Literal(name))),
    /** 도구 지점에서만. 정확 일치 목록. 생략하면 모든 도구 */
    tools: Type.Optional(
      Type.Array(Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }), { minItems: 1, maxItems: 64 }),
    ),
    /** argv. 셸을 거치지 않는다. 첫 원소는 실행 파일 */
    command: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
      minItems: 1,
      maxItems: 64,
    }),
    cwd: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("home")])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 600_000 })),
    /** 부모 환경에서 넘길 변수 이름. `x.operations.hookEnvAllow`와의 교집합만 넘긴다 */
    env: Type.Optional(
      Type.Array(Type.String({ pattern: "^[A-Z_][A-Z0-9_]{0,63}$" }), { maxItems: 32 }),
    ),
  },
  { additionalProperties: false },
);

export interface HookDef {
  readonly id: string;
  readonly point: HookHookName;
  readonly tools?: readonly string[];
  readonly command: readonly string[];
  readonly cwd?: "project" | "home";
  readonly timeoutMs?: number;
  readonly env?: readonly string[];
}
const HookDefSchema: TUnsafe<HookDef> = Type.Unsafe<HookDef>(
  HookDefShape satisfies SchemaProof<HookDef, typeof HookDefShape>,
);

/** 설정 키 x.operations.hookDefs의 값 */
const HookDefListShape = Type.Array(HookDefShape, { maxItems: 128 });
export const HookDefListSchema: TUnsafe<readonly HookDef[]> = Type.Unsafe<readonly HookDef[]>(
  HookDefListShape satisfies SchemaProof<readonly HookDef[], typeof HookDefListShape>,
);

export type HookSource = "managed" | "user" | "project" | "local";
/** 병합 순서: 관리 → 사용자 → 작업 폴더 → 로컬(§4.7.1) */
export const HOOK_SOURCES: readonly HookSource[] = ["managed", "user", "project", "local"];

/** §4.7.6 표 */
export const HOOK_SOURCE_TIER: { readonly [S in HookSource]: Tier } = {
  managed: "guard",
  user: "user",
  project: "project",
  local: "project",
};

export interface LoadedHook {
  readonly def: HookDef;
  readonly source: HookSource;
  readonly tier: Tier;
  /** 외부 훅 순서. 병합 뒤 0부터 */
  readonly index: number;
}

interface HookConfigIssue {
  readonly source: HookSource;
  readonly message: string;
}

export interface MergedHooks {
  readonly hooks: readonly LoadedHook[];
  readonly issues: readonly HookConfigIssue[];
}

/** 범위별 `hookDefs` 값(없으면 undefined)을 이어 붙인다. 모양이 틀린 항목은 버리고 진단을 남긴다. 같은 id는 바깥 범위의 것만 쓴다 */
export function mergeHookDefs(
  values: { readonly [S in HookSource]?: unknown },
  trusted: { readonly [S in HookSource]: boolean },
): MergedHooks {
  const hooks: LoadedHook[] = [];
  const issues: HookConfigIssue[] = [];
  const seen = new Set<string>();
  for (const source of HOOK_SOURCES) {
    // 신뢰 전의 작업 폴더·로컬 훅은 목록으로도 싣지 않는다. 화면용 목록은 호출하는 쪽이 따로 읽는다
    if (!trusted[source]) continue;
    const raw = values[source];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      issues.push({ source, message: "hookDefs is not a list" });
      continue;
    }
    for (const item of raw) {
      if (!Value.Check(HookDefSchema, item)) {
        issues.push({ source, message: "a hook definition has an invalid shape and was dropped" });
        continue;
      }
      if (seen.has(item.id)) {
        issues.push({ source, message: `hook id ${item.id} is already defined in an outer scope` });
        continue;
      }
      seen.add(item.id);
      hooks.push({ def: item, source, tier: HOOK_SOURCE_TIER[source], index: hooks.length });
    }
  }
  return { hooks, issues };
}
