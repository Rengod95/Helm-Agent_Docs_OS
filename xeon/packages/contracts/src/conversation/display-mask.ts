import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { EventIdSchema, ItemIdSchema, type EventId, type ItemId } from "./ids.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 화면 가림 표식. 호스트가 registered 값과 패턴을 가진 redactor로 구간을 계산하고, 클라이언트가 같은 문자열에 구간을 적용한다.
// 표식에는 값이 없다. 구간, 길이, 표지 안쪽 말(`known:<이름>`, 패턴 kind, `kv`)만 있다.
// 이벤트 payload와 저장 행은 바뀌지 않는다. 표식은 wire의 선택 필드다.

/** 가릴 구간 하나. [start, end)는 문자열의 UTF-16 단위 위치다. 구간은 겹치지 않고 start 순서다 */
export const MaskRangeSchema: TObject<{
  start: TInteger;
  end: TInteger;
  label: TString;
}> = Type.Object(
  {
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 0 }),
    label: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export type MaskRange = Static<typeof MaskRangeSchema>;

/** 내구 item의 문자열 잎 하나의 표식. pointer는 item 레코드 기준 RFC 6901이다. len은 호스트가 잰 잎 길이다(클라이언트가 같은지 확인한다) */
export const LeafMaskSchema: TObject<{
  pointer: TString;
  len: TInteger;
  ranges: TArray<typeof MaskRangeSchema>;
}> = Type.Object(
  {
    pointer: Type.String({ maxLength: 512 }),
    len: Type.Integer({ minimum: 0 }),
    ranges: Type.Array(MaskRangeSchema, { maxItems: 16384 }),
  },
  { additionalProperties: false },
);
export type LeafMask = Static<typeof LeafMaskSchema>;

/** thread.read 결과 안의 item 하나의 표식. 가릴 잎이 있는 item만 담는다 */
export const ItemMaskEntrySchema: TObject<{
  itemId: TUnsafe<ItemId>;
  leaves: TArray<typeof LeafMaskSchema>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    leaves: Type.Array(LeafMaskSchema, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);
export type ItemMaskEntry = Static<typeof ItemMaskEntrySchema>;

/** approval.list 결과 안의 대기 승인 하나의 표식. 승인 카드의 제목과 도구 인자 잎만 담는다. 가릴 잎이 있는 승인만 */
export const ApprovalMaskEntrySchema: TObject<{
  approvalId: TUnsafe<EventId>;
  leaves: TArray<typeof LeafMaskSchema>;
}> = Type.Object(
  {
    approvalId: EventIdSchema,
    leaves: Type.Array(LeafMaskSchema, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);
export type ApprovalMaskEntry = Static<typeof ApprovalMaskEntrySchema>;

/**
 * 진행 중 파트 조각의 표식. 누적 텍스트 기준이다.
 * verified: true면 len은 호스트가 누적한 전체 길이, visible은 지금 보여도 되는 앞부분 길이, ranges는 그 앞부분의 구간이다.
 * verified: false면 호스트가 누적을 믿을 수 없다(조각을 놓쳤거나 추적 상한을 넘었다). 클라이언트는 확정 item이 올 때까지 가린다.
 */
export const PartMaskSchema: TUnion<
  [
    TObject<{
      verified: TLiteral<true>;
      len: TInteger;
      visible: TInteger;
      ranges: TArray<typeof MaskRangeSchema>;
    }>,
    TObject<{ verified: TLiteral<false> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      verified: Type.Literal(true),
      len: Type.Integer({ minimum: 0 }),
      visible: Type.Integer({ minimum: 0 }),
      ranges: Type.Array(MaskRangeSchema, { maxItems: 16384 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ verified: Type.Literal(false) }, { additionalProperties: false }),
]);
export type PartMask = Static<typeof PartMaskSchema>;
