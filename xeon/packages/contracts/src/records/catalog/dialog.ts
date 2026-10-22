import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import { ThreadIdSchema, type ThreadId } from "../../conversation/index.ts";
import type { CatalogEntry } from "./entry.ts";

// L2.dialog.spec §3.7. 소유 생산자 cap.dialog는 owners.ts가 정한다. 질문의 기록은 L1.tools의 approval.*이고 dialog 이벤트가 아니다.
//
// records는 capabilities와 같은 순서라 capabilities/defs/dialog.ts를 import하지 않는다(F.readme §3). 상태줄 세그먼트와
// 알림 종류의 모양은 JSON 수준으로 같게 다시 적고, 일치는 test/records/dialog-catalog.test.ts가 JSON Schema 비교로 확인한다.

export type StatusItemRecord = {
  id: string;
  text: string;
  tone?: "normal" | "busy" | "warn" | "error";
  order?: number;
};
const statusItemShape = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}\\.[a-z][a-z0-9-]{0,31}$" }),
    text: Type.String({ maxLength: 120 }),
    tone: Type.Optional(
      Type.Union([
        Type.Literal("normal"),
        Type.Literal("busy"),
        Type.Literal("warn"),
        Type.Literal("error"),
      ]),
    ),
    order: Type.Optional(Type.Integer({ minimum: 0, maximum: 999 })),
  },
  { additionalProperties: false },
);
export const StatusItemRecordSchema: TUnsafe<StatusItemRecord> = Type.Unsafe<StatusItemRecord>(
  statusItemShape satisfies SchemaProof<StatusItemRecord, typeof statusItemShape>,
);

/** 휘발 dialog.status의 data. 전체 스냅숏이고 재생 대상이 아니다 */
export type DialogStatusData = { threadId: ThreadId; items: StatusItemRecord[] };
const dialogStatusDataShape = Type.Object(
  { threadId: ThreadIdSchema, items: Type.Array(StatusItemRecordSchema, { maxItems: 32 }) },
  { additionalProperties: false },
);
export const DialogStatusDataSchema: TUnsafe<DialogStatusData> = Type.Unsafe<DialogStatusData>(
  dialogStatusDataShape satisfies SchemaProof<DialogStatusData, typeof dialogStatusDataShape>,
);

export type DialogNotifiedPayload = {
  notice: {
    kind: "completed" | "approval_waiting" | "question_waiting" | "error" | "background_completed";
    title: string;
    body: string | null;
    origin: string;
  };
};
const dialogNotifiedShape = Type.Object(
  {
    notice: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("completed"),
          Type.Literal("approval_waiting"),
          Type.Literal("question_waiting"),
          Type.Literal("error"),
          Type.Literal("background_completed"),
        ]),
        title: Type.String({ maxLength: 120 }),
        body: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
        origin: Type.String({ maxLength: 64 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const DialogNotifiedSchema: TUnsafe<DialogNotifiedPayload> =
  Type.Unsafe<DialogNotifiedPayload>(
    dialogNotifiedShape satisfies SchemaProof<DialogNotifiedPayload, typeof dialogNotifiedShape>,
  );

/** 도메인 소유 카탈로그(F.records.spec §3.3.2). dialog.status는 휘발, dialog.notified는 내구다 */
export const DIALOG_EVENT_CATALOG: readonly CatalogEntry[] = [
  { kind: "dialog.status", version: 1, durable: false, payload: DialogStatusDataSchema },
  { kind: "dialog.notified", version: 1, durable: true, payload: DialogNotifiedSchema },
];
