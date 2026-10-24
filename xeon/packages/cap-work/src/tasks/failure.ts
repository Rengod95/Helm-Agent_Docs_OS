import { Type, type TUnsafe } from "typebox";
import { parse, parseJson, type SchemaProof } from "@xeon/contracts";
import {
  WorkTaskIdSchema,
  WorkTaskStatusSchema,
  type WorkTaskId,
  type WorkTaskStatus,
} from "@xeon/contracts/capabilities";

// L2.work.spec §3.2 TaskErrors, §4.1.3, §5. 작업 규칙이 거부하는 이유를 값으로 표현한다.
// 서비스 경계(errors.ts)가 CapabilityError로 바꾼다. 같은 값을 커밋 거부(reject) 레코드의 detail에 JSON으로 남겨,
// 같은 requestId 재호출이 처음 거부를 그대로 되풀이한다(spec §4.1.1 2단계).

export type TaskFailure =
  | { kind: "invalid_input"; message: string }
  | { kind: "not_found"; id: string }
  | { kind: "task_cycle"; path: WorkTaskId[] }
  | { kind: "task_blocked"; blockers: WorkTaskId[] }
  | { kind: "task_transition_invalid"; from: WorkTaskStatus; to: WorkTaskStatus }
  | { kind: "task_ref_unknown"; ref: string }
  | { kind: "task_limit" };

const failureShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("invalid_input"), message: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("not_found"), id: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("task_cycle"), path: Type.Array(WorkTaskIdSchema) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("task_blocked"), blockers: Type.Array(WorkTaskIdSchema) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("task_transition_invalid"),
      from: WorkTaskStatusSchema,
      to: WorkTaskStatusSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("task_ref_unknown"), ref: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("task_limit") }, { additionalProperties: false }),
]);

const TaskFailureSchema: TUnsafe<TaskFailure> = Type.Unsafe<TaskFailure>(
  failureShape satisfies SchemaProof<TaskFailure, typeof failureShape>,
);

/** 실패한 연산의 위치와 이유. 단일 연산 메서드는 opIndex 0이다 */
export interface OpFailure {
  readonly opIndex: number;
  readonly failure: TaskFailure;
}

const storedShape = Type.Object(
  { opIndex: Type.Integer({ minimum: 0 }), failure: TaskFailureSchema },
  { additionalProperties: false },
);

/** 커밋 거부 레코드의 detail 문자열로 만든다 */
export function encodeOpFailure(value: OpFailure): string {
  return JSON.stringify(value);
}

/** 저장된 detail을 되읽는다. 읽을 수 없으면 undefined(호출자가 internal로 보고한다) */
export function decodeOpFailure(detail: string | null): OpFailure | undefined {
  if (detail === null) return undefined;
  const json = parseJson(detail);
  if (!json.ok) return undefined;
  const parsed = parse(storedShape, json.value);
  return parsed.ok ? parsed.value : undefined;
}
