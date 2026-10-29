import { parse } from "@xeon/contracts";
import type { NoticeKind } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  ScopeHandlerFailedPayloadSchema,
  type ScopeHandlerFailedPayload,
} from "@xeon/contracts/records";
import type { NotifyDeliveredParams, StreamChunkParams } from "@xeon/contracts/wire";
import type { RenderOp } from "./ops.ts";

// L4.cli.spec §4.5, X.operations.spec §4.3.4, L4.host-service.spec HS-80·HS-82. 확장 핸들러 실패(`scope.handler_failed`)와
// 알림 전달(`notify.delivered`)을 `notice` 그리기 명령으로 바꾼다. 순수 함수다: 세션 상태를 쓰지 않는다.

const MESSAGE_LIMIT = 120;

/** 연속 실패가 이 간격마다 한 번씩 그린다(1번째는 항상 그린다) [결정: 오케스트레이터 기본값] */
const HANDLER_FAILURE_STEP = 5;

const KIND_LABEL: Readonly<Record<NoticeKind, string>> = {
  completed: "완료",
  approval_waiting: "승인 대기",
  question_waiting: "질문 대기",
  error: "오류",
  background_completed: "백그라운드 완료",
};

/** 제어 문자와 공백 연속을 한 칸으로 바꾼다. 확장과 도구가 준 글자가 터미널 제어열이 되지 않게 한다 */
function oneLine(text: string): string {
  return text.replaceAll(/[\p{Cc}\s]+/gu, " ").trim();
}

/** 본문: 줄바꿈은 살리고 나머지 제어 문자는 칸으로 바꾼다 */
function bodyLines(text: string): string {
  return text
    .replaceAll(/\r\n?/g, "\n")
    .replaceAll(/(?!\n)\p{Cc}/gu, " ")
    .trim();
}

/** 코드 포인트 단위로 자른다. 자르면 뒤에 …을 붙인다 */
function clip(text: string, limit: number): string {
  const chars = Array.from(text);
  return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

/** `owner`는 `ext:<이름>` 또는 `hook:<이름>`이다(X.operations.spec HandlerOwnerKey). 접두어를 떼고 이름만 보인다 */
function ownerLabel(owner: string): string {
  if (owner.startsWith("ext:")) return `확장 ${oneLine(owner.slice(4))}`;
  if (owner.startsWith("hook:")) return `훅 ${oneLine(owner.slice(5))}`;
  return oneLine(owner);
}

/** 이 연속 실패 수를 그릴지 정한다. 1번째와 `HANDLER_FAILURE_STEP`의 배수만 그린다 */
export function isShownFailure(consecutive: number): boolean {
  return consecutive === 1 || consecutive % HANDLER_FAILURE_STEP === 0;
}

/**
 * 확장 핸들러 실패 한 건을 한 줄 알림 문구로 바꾼다. 그리지 않을 연속 실패(묶음 안의 중간 번째)면 undefined다.
 * 예: "확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): boom"
 */
export function handlerFailedText(payload: ScopeHandlerFailedPayload): string | undefined {
  if (!isShownFailure(payload.consecutive)) return undefined;
  const head = `${ownerLabel(payload.owner)}의 ${oneLine(payload.point)} 핸들러가 실패했다 (연속 ${payload.consecutive}회)`;
  const detail = oneLine(payload.message);
  return detail === "" ? head : `${head}: ${clip(detail, MESSAGE_LIMIT)}`;
}

/**
 * `stream.chunk` 한 조각을 알림 그리기 명령으로 바꾼다. `scope.handler_failed`가 아니거나, 이 세션의 thread가 아니거나,
 * 페이로드가 검증에 못 미치거나, 묶음 밖의 실패면 빈 목록이다.
 * thread 확인: 호스트는 thread를 연 연결마다 한 번씩 보내므로 이 세션 것만 그리면 같은 실패가 두 번 나오지 않는다(HS-80).
 */
export function handlerFailedOpsOf(
  chunk: StreamChunkParams,
  current: ThreadId,
): readonly RenderOp[] {
  const { event } = chunk;
  if (event.kind !== "scope.handler_failed" || event.threadId !== current) return [];
  const parsed = parse(ScopeHandlerFailedPayloadSchema, event.payload);
  if (!parsed.ok) return [];
  const text = handlerFailedText(parsed.value);
  return text === undefined ? [] : [{ kind: "notice", text }];
}

/**
 * `notify.delivered` 한 건의 문구. 첫 줄은 "[종류] 제목"이고, 본문이 있으면 둘째 줄이다.
 * thread가 없거나(null) 이 세션의 thread면 그대로 두고, 다른 thread의 알림이면 첫 줄 끝에 "(다른 대화)"를 붙인다.
 */
export function deliveredText(params: NotifyDeliveredParams, current: ThreadId): string {
  const { notice, threadId } = params;
  const other = threadId !== null && threadId !== current;
  const head = `[${KIND_LABEL[notice.kind]}] ${oneLine(notice.title)}${other ? " (다른 대화)" : ""}`;
  const body = notice.body === null ? "" : bodyLines(notice.body);
  return body === "" ? head : `${head}\n${body}`;
}

export function deliveredOpsOf(
  params: NotifyDeliveredParams,
  current: ThreadId,
): readonly RenderOp[] {
  return [{ kind: "notice", text: deliveredText(params, current) }];
}
