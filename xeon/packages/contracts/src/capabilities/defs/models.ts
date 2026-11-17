import { Type, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof } from "../../base/index.ts";
import { StopReasonSchema, ThreadIdSchema } from "../../conversation/index.ts";
import { defineCapability, type CapabilityApi, type CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import type { PluginModelRequest, PluginModelValue } from "../plugin-model.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";

// 공개 기능 `models.complete`(hooks-core-boundary §6.2, D-30). 모델 호출 한 번의 텍스트와 사용량을 돌려준다. 역할은 `judge`다.
// 공급자는 core-models다(`ModelService.completeForPlugin`을 감싼다). 모델 도구가 아니므로 `tools`는 비어 있다.
// 쓰기 효과는 없지만 토큰을 쓰므로 `readOnly`가 아니다. 그래서 통합 경로(U-1 (다))에서 합성 이름 `cap:models.complete`로 간다.
// 호출 주체(플러그인 이름)와 `requestId`, `signal`은 호출이 정한다. 입력 값에는 싣지 않는다.

/** 입력: 플러그인이 보내는 부분. 호출자 identity는 호출 문맥의 `caller.extension`에서 공급자가 얻는다 */
export type ModelsCompleteInputValue = Pick<PluginModelRequest, "threadId" | "messages" | "label">;

const pluginModelMessageShape = Type.Object(
  {
    role: Type.Union([Type.Literal("system"), Type.Literal("user"), Type.Literal("assistant")]),
    content: Type.String(),
  },
  { additionalProperties: false },
);

const modelsCompleteInputShape = Type.Object(
  {
    threadId: ThreadIdSchema,
    messages: Type.Array(pluginModelMessageShape, { minItems: 1, maxItems: 1024 }),
    label: Type.Optional(Type.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
);

export const ModelsCompleteInput: TUnsafe<ModelsCompleteInputValue> =
  Type.Unsafe<ModelsCompleteInputValue>(
    modelsCompleteInputShape satisfies SchemaProof<
      ModelsCompleteInputValue,
      typeof modelsCompleteInputShape
    >,
  );

const modelsCompleteOutputShape = Type.Object(
  {
    text: Type.String(),
    usage: Nullable(
      Type.Object(
        {
          input: Type.Integer({ minimum: 0 }),
          output: Type.Integer({ minimum: 0 }),
          total: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    stopReason: StopReasonSchema,
  },
  { additionalProperties: false },
);

export const ModelsCompleteOutput: TUnsafe<PluginModelValue> = Type.Unsafe<PluginModelValue>(
  modelsCompleteOutputShape satisfies SchemaProof<
    PluginModelValue,
    typeof modelsCompleteOutputShape
  >,
);

type ModelsMethods = {
  // `idempotent: true`를 타입에 고정해 `requestId` 옵션을 필수로 만든다(MethodOptionsParam)
  readonly complete: MethodDef<typeof ModelsCompleteInput, typeof ModelsCompleteOutput> & {
    readonly idempotent: true;
  };
};

/** 모델 호출 기능. 역할 `judge`로 한 번 부른다. 실패는 호출 오류(CapabilityError)로 거부한다 */
export const ModelsComplete: CapabilityDef<ModelsMethods, readonly []> = defineCapability({
  id: "models.complete",
  version: "1.0.0",
  description:
    "One model call in the judge role that returns the text and usage. It is not a model tool.",
  service: {
    methods: {
      complete: {
        description:
          "Calls the model once with the given messages and returns its text, usage and stop reason. A call with the same requestId is not sent again.",
        input: ModelsCompleteInput,
        output: ModelsCompleteOutput,
        replay: "safe",
        idempotent: true,
      },
    },
  },
  tools: [],
});
export const ModelsCompleteKey: ServiceKey<CapabilityApi<typeof ModelsComplete>> =
  serviceKey(ModelsComplete);
