import { Type, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof, type SchemaSound } from "../../base/index.ts";
import {
  ItemIdSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  UsageSchema,
} from "../../conversation/index.ts";
import { defineCapability, type CapabilityApi, type CapabilityDef } from "../capability.ts";
import type { JudgeInput, JudgeOutcome } from "../judge.ts";
import type { MethodDef } from "../method.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";

// 공개 기능 `agents.judge`(hooks-core-boundary §6.2, D-30). 목표 판정 한 번이다. 모델 도구는 없다.
// 공급자는 core-agents다(`AgentService.judge`를 그대로 넘긴다). 같은 (threadId, stepId)의 재호출은 기록된 판정을 `recorded`로 돌려준다.
// 실패(상한, 모델 없음, 판정 호출 오류)는 `capped`, `failed` 값으로 돌려주고 거부하지 않는다.

// ── 입력(JudgeInput) ───────────────────────────────────────────────────

const judgeEvidenceShape = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("assistant_text"),
      Type.Literal("tool_result"),
      Type.Literal("work_item"),
      Type.Literal("note"),
    ]),
    text: Type.String(),
    ref: Type.Optional(
      Type.Object(
        {
          itemId: Type.Optional(ItemIdSchema),
          effectId: Type.Optional(Type.String({ maxLength: 256 })),
          workRef: Type.Optional(Type.String({ maxLength: 256 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const judgeInputShape = Type.Object(
  {
    threadId: ThreadIdSchema,
    turnId: TurnIdSchema,
    /** 있으면 같은 단계의 재호출을 알아본다(`JudgeInput.stepId`) */
    stepId: Type.Optional(Type.Union([StepIdSchema, Type.Null()])),
    goalRef: Type.String({ minLength: 1, maxLength: 256 }),
    goal: Type.Object(
      { text: Type.String(), criteria: Type.Array(Type.String()) },
      { additionalProperties: false },
    ),
    evidence: Type.Array(judgeEvidenceShape, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);

export const AgentsJudgeInput: TUnsafe<JudgeInput> = Type.Unsafe<JudgeInput>(
  judgeInputShape satisfies SchemaProof<JudgeInput, typeof judgeInputShape>,
);

// ── 출력(JudgeOutcome) ─────────────────────────────────────────────────

const judgeRecordShape = Type.Object(
  {
    goalRef: Type.String({ minLength: 1, maxLength: 256 }),
    run: Type.Integer({ minimum: 1 }),
    verdict: Type.Union([
      Type.Literal("met"),
      Type.Literal("not_met"),
      Type.Literal("undecidable"),
    ]),
    rationale: Type.String({ maxLength: 8000 }),
    missing: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 64 }),
    usage: Nullable(UsageSchema),
    model: Type.Object(
      { provider: Type.String(), modelId: Type.String() },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const judgeOutcomeShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("judged"), record: judgeRecordShape },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("recorded"), record: judgeRecordShape },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("capped"),
      runs: Type.Integer({ minimum: 0 }),
      maxRuns: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("failed"), message: Type.String({ maxLength: 8192 }) },
    { additionalProperties: false },
  ),
]);

export const AgentsJudgeOutput: TUnsafe<JudgeOutcome> = Type.Unsafe<JudgeOutcome>(
  judgeOutcomeShape satisfies SchemaSound<JudgeOutcome, typeof judgeOutcomeShape>,
);

type AgentsMethods = {
  // `idempotent: true`를 타입에 고정해 `requestId` 옵션을 필수로 만든다(MethodOptionsParam)
  readonly judge: MethodDef<typeof AgentsJudgeInput, typeof AgentsJudgeOutput> & {
    readonly idempotent: true;
  };
};

/** 목표 판정 기능. 모델 도구가 없다. 호출은 `requestId`를 반드시 넘긴다(idempotent) */
export const AgentsJudge: CapabilityDef<AgentsMethods, readonly []> = defineCapability({
  id: "agents.judge",
  version: "1.0.0",
  description:
    "Judges whether a goal is met from the given evidence, with the separate judge model role. It has no model tools.",
  service: {
    methods: {
      judge: {
        risk: "read",
        description:
          "Returns the verdict, or capped or failed as values. A call with the same stepId returns the recorded verdict.",
        input: AgentsJudgeInput,
        output: AgentsJudgeOutput,
        replay: "safe",
        idempotent: true,
      },
    },
  },
  tools: [],
});
export const AgentsJudgeKey: ServiceKey<CapabilityApi<typeof AgentsJudge>> =
  serviceKey(AgentsJudge);
