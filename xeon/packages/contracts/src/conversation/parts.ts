import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Bug, Nullable } from "../base/index.ts";
import { ItemIdSchema, PartIdSchema, type IdFactory, type ItemId, type PartId } from "./ids.ts";

export const PartKindSchema: TUnion<
  [TLiteral<"text">, TLiteral<"thinking">, TLiteral<"toolCall">]
> = Type.Union([Type.Literal("text"), Type.Literal("thinking"), Type.Literal("toolCall")]);
export type PartKind = Static<typeof PartKindSchema>;

/** 완성 파트의 내구 레코드. 내용은 담지 않는다. 내용은 소속 item의 message.content[contentIndex]다. */
export const PartRecordSchema: TObject<{
  partId: TUnsafe<PartId>;
  itemId: TUnsafe<ItemId>;
  contentIndex: TInteger;
  kind: typeof PartKindSchema;
  toolCallId: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    partId: PartIdSchema,
    itemId: ItemIdSchema,
    contentIndex: Type.Integer({ minimum: 0 }),
    kind: PartKindSchema,
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
/** partIds[i] ↔ message.content[i]. kind === "toolCall"이면 toolCallId는 pi ToolCall.id, 그 밖에는 null */
export type PartRecord = Static<typeof PartRecordSchema>;

export const PartPhaseSchema: TUnion<[TLiteral<"start">, TLiteral<"delta">, TLiteral<"end">]> =
  Type.Union([Type.Literal("start"), Type.Literal("delta"), Type.Literal("end")]);

/** 휘발 스트림 조각. pi AssistantMessageEvent의 *_start/*_delta/*_end 하나에 대응한다. */
export const PartDeltaSchema: TObject<{
  partId: TUnsafe<PartId>;
  itemId: TUnsafe<ItemId>;
  contentIndex: TInteger;
  kind: typeof PartKindSchema;
  phase: typeof PartPhaseSchema;
  delta: TString;
}> = Type.Object(
  {
    partId: PartIdSchema,
    itemId: ItemIdSchema,
    contentIndex: Type.Integer({ minimum: 0 }),
    kind: PartKindSchema,
    phase: PartPhaseSchema,
    // start는 "", toolCall delta는 인자 JSON 조각. 휘발 경로라 길이 상한을 두지 않는다.
    delta: Type.String(),
  },
  { additionalProperties: false },
);
export type PartDelta = Static<typeof PartDeltaSchema>;

export interface PartAssignment {
  readonly record: PartRecord;
  /** 이번 호출에서 새로 발급했으면 true */
  readonly issued: boolean;
}

export interface AssignPartIdsInput {
  readonly itemId: ItemId;
  /** kinds[i]는 contentIndex i의 블록 종류 */
  readonly kinds: readonly PartKind[];
  /** toolCallIds[i]는 toolCall 블록의 pi id. 그 밖의 블록은 null */
  readonly toolCallIds: readonly (string | null)[];
  readonly existing: readonly PartRecord[];
}

/**
 * contentIndex → PartId 대응. 주입받은 발급기만 부르는 함수다.
 * existing에 같은 (itemId, contentIndex)가 있으면 그 레코드를 그대로 쓰고 ids를 부르지 않는다.
 * 없으면 ids.next("prt")로 발급한다. 길이 불일치, kind 충돌, toolCall 블록의 id 누락은 호출 결함이라 Bug다.
 */
export function assignPartIds(
  input: AssignPartIdsInput,
  ids: IdFactory,
): readonly PartAssignment[] {
  const { itemId, kinds, toolCallIds, existing } = input;
  if (kinds.length !== toolCallIds.length) {
    throw new Bug(
      `assignPartIds: kinds (${kinds.length}) and toolCallIds (${toolCallIds.length}) differ in length`,
    );
  }
  const known = new Map<number, PartRecord>();
  for (const record of existing) {
    if (record.itemId === itemId) known.set(record.contentIndex, record);
  }
  const assignments: PartAssignment[] = [];
  for (const [contentIndex, kind] of kinds.entries()) {
    const previous = known.get(contentIndex);
    if (previous !== undefined) {
      if (previous.kind !== kind) {
        throw new Bug(
          `assignPartIds: contentIndex ${contentIndex} was recorded as ${previous.kind}, now ${kind}`,
        );
      }
      assignments.push({ record: previous, issued: false });
      continue;
    }
    const toolCallId = toolCallIds[contentIndex] ?? null;
    if (kind === "toolCall" && toolCallId === null) {
      throw new Bug(`assignPartIds: toolCall part ${contentIndex} has no toolCallId`);
    }
    assignments.push({
      record: {
        partId: ids.next("prt"),
        itemId,
        contentIndex,
        kind,
        toolCallId: kind === "toolCall" ? toolCallId : null,
      },
      issued: true,
    });
  }
  return assignments;
}

/** 투영 재생용 조회. (itemId, contentIndex) → partId. */
export function partIdAt(
  records: readonly PartRecord[],
  itemId: ItemId,
  contentIndex: number,
): PartId | undefined {
  return records.find((r) => r.itemId === itemId && r.contentIndex === contentIndex)?.partId;
}
