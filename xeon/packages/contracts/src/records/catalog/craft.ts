import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import { CraftContextsSchema, type ContextRef } from "../../conversation/craft-chat.ts";

// M5c §4.8.8 `craft.context`(review.m5-profile-project-loader §4.8.8). 테스트 대화를 열 때 사용자가 붙인 맥락 참조와 한 줄 의도다.
// 상태 사건이다: 사용자가 연 사실이고 관찰이 아니다. 참조는 모델 컨텍스트에 줄로 들어가지 않고 도구 `authoring_context`가 읽는다.

export interface CraftContextPayload {
  /** 맥락 참조(판별 유니온). 발견(`finding`)은 근거 묶음을 가리킨다. 내용은 기록에 싣지 않는다 */
  readonly refs: readonly ContextRef[];
  /** 사용자가 쓴 한 줄 의도("고치기", "올리기"). 없으면 null */
  readonly intent: string | null;
}

const CraftContextShape = Type.Object(
  {
    refs: CraftContextsSchema,
    intent: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const CraftContextPayloadSchema: TUnsafe<CraftContextPayload> =
  Type.Unsafe<CraftContextPayload>(
    CraftContextShape satisfies SchemaProof<CraftContextPayload, typeof CraftContextShape>,
  );
