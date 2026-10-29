import { Type, type TArray, type TLiteral, type TObject, type TUnion } from "typebox";
import {
  ScheduleEntryViewSchema,
  ScheduleErrorSchema,
  ScheduleListItemSchema,
  RunViewSchema,
} from "../../capabilities/index.ts";

// 예약 항목 메서드(M3b B1-SCH2, L2.schedule.spec §4.4.9): `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`.
// params는 능력 입력과 같고 레지스트리(`methods.ts`)가 `_meta`를 더한다. 기대한 실패(없음, 원격 아님, 꺼짐, 상한, 저장 실패)는
// JSON-RPC 오류가 아니라 `ok: false`의 `error` 값이다(`proposal.decide`와 같다).

/** 실패 값 공통 모양 */
const ScheduleFailedSchema: TObject<{ ok: TLiteral<false>; error: typeof ScheduleErrorSchema }> =
  Type.Object(
    { ok: Type.Literal(false), error: ScheduleErrorSchema },
    { additionalProperties: false },
  );

/** `schedule.create` 결과. `warnings`는 서비스 모드가 꺼져 있을 때 `service_mode_off`를 싣는다(§4.4.6) */
export const ScheduleCreateResultSchema: TUnion<
  [
    TObject<{
      ok: TLiteral<true>;
      entry: typeof ScheduleEntryViewSchema;
      warnings: TArray<TLiteral<"service_mode_off">>;
    }>,
    typeof ScheduleFailedSchema,
  ]
> = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      entry: ScheduleEntryViewSchema,
      warnings: Type.Array(Type.Literal("service_mode_off"), { maxItems: 4 }),
    },
    { additionalProperties: false },
  ),
  ScheduleFailedSchema,
]);

/** `schedule.list` 결과 */
export const ScheduleListResultSchema: TUnion<
  [
    TObject<{ ok: TLiteral<true>; items: TArray<typeof ScheduleListItemSchema> }>,
    typeof ScheduleFailedSchema,
  ]
> = Type.Union([
  Type.Object(
    { ok: Type.Literal(true), items: Type.Array(ScheduleListItemSchema, { maxItems: 200 }) },
    { additionalProperties: false },
  ),
  ScheduleFailedSchema,
]);

/** `schedule.cancel` 결과 */
export const ScheduleCancelResultSchema: TUnion<
  [
    TObject<{ ok: TLiteral<true>; entry: typeof ScheduleEntryViewSchema }>,
    typeof ScheduleFailedSchema,
  ]
> = Type.Union([
  Type.Object(
    { ok: Type.Literal(true), entry: ScheduleEntryViewSchema },
    { additionalProperties: false },
  ),
  ScheduleFailedSchema,
]);

/** `schedule.fire` 결과 */
export const ScheduleFireResultSchema: TUnion<
  [TObject<{ ok: TLiteral<true>; run: typeof RunViewSchema }>, typeof ScheduleFailedSchema]
> = Type.Union([
  Type.Object({ ok: Type.Literal(true), run: RunViewSchema }, { additionalProperties: false }),
  ScheduleFailedSchema,
]);
