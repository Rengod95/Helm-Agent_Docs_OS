import { Type, type Static, type TObject } from "typebox";
import { ItemRecordSchema, PartRecordSchema } from "../../conversation/index.ts";

export const ItemRecordedPayloadSchema: TObject<{ item: typeof ItemRecordSchema }> = Type.Object(
  { item: ItemRecordSchema },
  { additionalProperties: false },
);
export type ItemRecordedPayload = Static<typeof ItemRecordedPayloadSchema>;

export const PartRecordedPayloadSchema: TObject<{ part: typeof PartRecordSchema }> = Type.Object(
  { part: PartRecordSchema },
  { additionalProperties: false },
);
export type PartRecordedPayload = Static<typeof PartRecordedPayloadSchema>;
