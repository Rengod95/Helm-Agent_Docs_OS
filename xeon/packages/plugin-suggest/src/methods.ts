import { parse } from "@fresnel/contracts";
import { KnowledgeLedgerKey } from "@fresnel/contracts/capabilities";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { ProposalListResultSchema, ProposalStatusWireSchema } from "@fresnel/contracts/wire";
import type { OrchestrationApi } from "@fresnel/orchestration-sdk";
import {
  Type,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TObject,
  type TOptional,
  type TSchema,
  type TString,
  type TUnion,
} from "typebox";
import { countPending, LEDGER_MAX, listSuggestions } from "./queue.ts";

// 확장 메서드 두 개(`ext.suggest.list`, `ext.suggest.count`). 둘 다 읽기 전용이고 쓰기 메서드는 없다. 승인과 거절은 호스트 wire
// `proposal.decide`가 사용자 문맥에서 한다(플러그인에 결정 권한을 주지 않는다).
// 선언(params, result)은 JSON Schema 문서로 매니페스트에 싣고, 같은 TypeBox 스키마로 들어온 값을 다시 검사한다.

/** `list`의 입력: `ProposalListParams`에서 출처를 뺀 것이다(같은 제약). 이 플러그인은 지식 대기열만 읽는다 */
export const SuggestListParamsSchema: TObject<{
  status: TOptional<TArray<typeof ProposalStatusWireSchema>>;
  limit: TOptional<TInteger>;
  cursor: TOptional<TString>;
}> = Type.Object(
  {
    status: Type.Optional(Type.Array(ProposalStatusWireSchema, { minItems: 1, maxItems: 7 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);

/** `count`의 결과. 읽지 못하면 `ok`가 거짓이고 이유는 `unavailable`이다 */
export const SuggestCountResultSchema: TUnion<
  [
    TObject<{ ok: TLiteral<true>; count: TInteger; capped: TBoolean }>,
    TObject<{ ok: TLiteral<false>; reason: TLiteral<"unavailable"> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      count: Type.Integer({ minimum: 0, maximum: LEDGER_MAX }),
      capped: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { ok: Type.Literal(false), reason: Type.Literal("unavailable") },
    { additionalProperties: false },
  ),
]);

/** TypeBox 스키마 객체를 매니페스트에 싣는 JSON Schema 객체로 옮긴다. 최상위 키만 복사한다(기호 키는 JSON으로 가지 않는다) */
function jsonSchemaOf(schema: TSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = value;
  return out;
}

const NO_PARAMS: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/** 매니페스트 `methods`에 싣는 선언. 순서는 list, count다 */
export const suggestMethodDecls: ExtMethodDecl[] = [
  {
    verb: "list",
    params: jsonSchemaOf(SuggestListParamsSchema),
    result: jsonSchemaOf(ProposalListResultSchema),
    readOnly: true,
  },
  {
    verb: "count",
    params: NO_PARAMS,
    result: jsonSchemaOf(SuggestCountResultSchema),
    readOnly: true,
  },
];

/** 처리기를 등록한다. 기능은 호출할 때마다 얻는다(매니페스트의 `requires`가 있어야 얻는다) */
export function registerSuggestMethods(
  g: Pick<OrchestrationApi<never>, "capability" | "registerMethod">,
): void {
  g.registerMethod("list", {
    handler: async (params) => {
      // 확장 메서드의 입력은 선언의 params 스키마로 X가 처리기 앞에서 먼저 검사한다. 그래서 여기 닿는 입력은 맞는 값이다.
      // 그래도 읽지 못하면 입력이 없는 것으로 보고 첫 쪽을 읽는다(읽기 전용이라 해가 없다, helm의 `inquiryIdOf`와 같은 처리)
      const checked = parse(SuggestListParamsSchema, params);
      return listSuggestions(g.capability(KnowledgeLedgerKey), checked.ok ? checked.value : {});
    },
  });
  g.registerMethod("count", {
    handler: async () => countPending(g.capability(KnowledgeLedgerKey)),
  });
}
