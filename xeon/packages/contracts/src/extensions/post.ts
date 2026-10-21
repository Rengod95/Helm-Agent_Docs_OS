import type { ImageContent, JsonValue, TextContent } from "../conversation/index.ts";
import type { RecordKind } from "./group-record.ts";

/** steer: 현재 step 도구 라운드 뒤 / followUp: 현재 turn 정착 뒤 / next: 다음 경계 뒤 모델 요청 한 번 */
export type PostWhen = "steer" | "followUp" | "next";

export type PostContent = string | readonly (TextContent | ImageContent)[];

export type PostItem =
  /** 사용자 메시지로 들어간다 */
  | { readonly kind: "user"; readonly content: PostContent }
  /** 확장 메시지. 모델 컨텍스트에 들어가고 display가 참이면 UI에도 보인다 */
  | {
      readonly kind: "context";
      /** XeonCustomMessage.customType(F.conversation.spec §3.5.2) */
      readonly customType: RecordKind;
      readonly content: PostContent;
      readonly display: boolean;
      readonly details?: JsonValue;
    };

export interface PostOptions {
  readonly when: PostWhen;
  /** 대화 범위 멱등 키(1~64자). 같은 키의 두 번째 post는 큐에 넣지 않는다 */
  readonly requestId: string;
}

export interface PostReceipt {
  readonly requestId: string;
  /** 같은 requestId가 이미 있어 아무것도 넣지 않았으면 참 */
  readonly duplicate: boolean;
}
