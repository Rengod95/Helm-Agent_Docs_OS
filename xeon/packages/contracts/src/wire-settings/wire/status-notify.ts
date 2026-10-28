import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TObject,
  type TOptional,
  type TUnion,
  type TNull,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import {
  AttachmentAddOutput,
  AttachmentSourceSchema,
  NoticeKindSchema,
  NoticeSchema,
  StatusListOutput,
} from "../../capabilities/index.ts";
import { ThreadIdSchema } from "../../conversation/index.ts";
import { IsoTimeSchema } from "./notifications.ts";

// 상태줄·첨부·알림 wire(M3-REQ-16, M3-20). 값 모양은 L2.dialog의 능력 정의(`dialog.status.list`, `dialog.attachments.add`,
// `dialog.notify.list`)와 같다. wire는 thread 문맥을 더해 호스트가 능력 호출로 옮긴다(`L2.dialog.spec` §4.2.6).

/** 상태줄 스냅숏. 재접속 뒤 다시 그리는 데 쓴다. 변경은 휘발 이벤트 `dialog.status`로 온다 */
export const StatusListParamsSchema: TObject<{ threadId: typeof ThreadIdSchema }> = Type.Object(
  { threadId: ThreadIdSchema },
  { additionalProperties: false },
);
export type StatusListParams = Static<typeof StatusListParamsSchema>;

export const StatusListResultSchema: typeof StatusListOutput = StatusListOutput;
export type StatusListResult = Static<typeof StatusListResultSchema>;

/** 첨부 추가. `source.kind: "path"`의 상대 경로는 `threadId`의 작업 폴더 기준이다. 결과의 `parts`를 `turn.start`의 input에 넣는다 */
export const AttachmentsAddParamsSchema: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  source: typeof AttachmentSourceSchema;
}> = Type.Object(
  { threadId: Type.Optional(ThreadIdSchema), source: AttachmentSourceSchema },
  { additionalProperties: false },
);
export type AttachmentsAddParams = Static<typeof AttachmentsAddParamsSchema>;

export const AttachmentsAddResultSchema: typeof AttachmentAddOutput = AttachmentAddOutput;
export type AttachmentsAddResult = Static<typeof AttachmentsAddResultSchema>;

/** 알림 목록. `afterSeq` 뒤의 알림을 오래된 것부터 돌려준다. `threadId`를 주면 그 thread의 알림만 */
export const NotifyListParamsSchema: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  afterSeq: TInteger;
  kinds: TOptional<TArray<typeof NoticeKindSchema>>;
  limit: TOptional<TInteger>;
}> = Type.Object(
  {
    threadId: Type.Optional(ThreadIdSchema),
    afterSeq: Type.Integer({ minimum: 0 }),
    kinds: Type.Optional(
      Type.Array(NoticeKindSchema, { minItems: 1, maxItems: 5, uniqueItems: true }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);
export type NotifyListParams = Static<typeof NotifyListParamsSchema>;

/** 알림 한 건과 그 thread. `notices`의 원소 모양은 `dialog.notify.list`의 `Notice`다 */
export const NotifyListResultSchema: TObject<{
  notices: TArray<typeof NoticeSchema>;
  nextSeq: TInteger;
}> = Type.Object(
  { notices: Type.Array(NoticeSchema, { maxItems: 500 }), nextSeq: Type.Integer() },
  { additionalProperties: false },
);
export type NotifyListResult = Static<typeof NotifyListResultSchema>;

/**
 * 서버 → 클라이언트 알림 `notify.delivered`의 params [결정: review.m3-design-inputs D-M3-17].
 * 호스트는 연결된 클라이언트 모두에 보낸다. 클라이언트 창이 앞에 있어도 기본으로 보내고, 보낼지는 설정으로 조정한다(호스트의 설정 키).
 * `threadId`는 알림이 속한 thread이고 thread 밖 알림이면 null이다. OS 토스트와 앱 안 알림 표시는 클라이언트가 한다.
 */
export const NotifyDeliveredParamsSchema: TObject<{
  threadId: TUnion<[typeof ThreadIdSchema, TNull]>;
  notice: typeof NoticeSchema;
  deliveredAt: typeof IsoTimeSchema;
}> = Type.Object(
  { threadId: Nullable(ThreadIdSchema), notice: NoticeSchema, deliveredAt: IsoTimeSchema },
  { additionalProperties: false },
);
export type NotifyDeliveredParams = Static<typeof NotifyDeliveredParamsSchema>;
