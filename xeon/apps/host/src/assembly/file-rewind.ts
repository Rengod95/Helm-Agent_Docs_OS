import { err, ok, parse, type RandomSource, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  WorkspaceRewindStartedPayloadSchema,
  WorkspaceRewindUndonePayloadSchema,
  type ReadFailure,
  type RewindId,
  type RewindUndoState,
  type SessionService,
} from "@fresnel/contracts/records";
import type { StartedRewind } from "../types.ts";

// 파일 되감기의 조립 도우미(L4.host-service.spec, 파일 되감기 절). 되감기 식별자는 `RewindIdSchema`(`rwd_` + 소문자 영숫자 8~64자)를 지키고,
// 조립 루트가 넘긴 난수 원천으로 만든다(TS-21). 되돌리기는 시작 기록에서 범위와 되감기 직전 leaf를 읽는다.

const REWIND_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const REWIND_ID_BODY_LENGTH = 16;

/** 되감기 식별자 발급기. 난수 한 개로 글자 한 개를 고른다(36진수, 치우침은 상한으로 막는다) */
export function createRewindIdFactory(random: RandomSource): () => RewindId {
  return () => {
    let body = "";
    for (let index = 0; index < REWIND_ID_BODY_LENGTH; index += 1) {
      const pick = Math.min(
        REWIND_ID_ALPHABET.length - 1,
        Math.floor(random() * REWIND_ID_ALPHABET.length),
      );
      body += REWIND_ID_ALPHABET.charAt(pick);
    }
    return `rwd_${body}`;
  };
}

/**
 * 대화의 워크스페이스 이벤트에서 `workspace.rewind_started`를 찾는다. 같은 되감기 식별자는 한 번만 시작되므로 처음 맞는 것이 답이다.
 * 기록의 모양이 맞지 않으면 읽기 실패(`row_invalid`)다. 파일 내용은 이 기록에 없다.
 */
export async function startedRewindOf(
  session: Pick<SessionService, "readFrom">,
  threadId: ThreadId,
  rewindId: RewindId,
): Promise<Result<StartedRewind | undefined, ReadFailure>> {
  for await (const item of session.readFrom(0, { threadId })) {
    if (!item.ok) return err(item.error);
    const event = item.value;
    if (event.kind !== "workspace.rewind_started") continue;
    const payload = parse(WorkspaceRewindStartedPayloadSchema, event.payload);
    if (!payload.ok) return err({ kind: "row_invalid", where: "workspace.rewind_started" });
    if (payload.value.rewindId !== rewindId) continue;
    return ok({
      scope: payload.value.scope,
      targetEventId: payload.value.targetEventId,
      oldLeafEventId: payload.value.oldLeafEventId,
    });
  }
  return ok(undefined);
}

/**
 * 되돌리기가 커밋한 대화 쪽 상태. 되돌리기가 없었거나 적용 기록이 없으면 undefined다. 같은 되돌리기를 다시 불러도 처음 값이다.
 * 기록의 모양이 맞지 않으면 읽기 실패(`row_invalid`)다.
 */
export async function undoneConversationOf(
  session: Pick<SessionService, "readFrom">,
  threadId: ThreadId,
  rewindId: RewindId,
): Promise<Result<RewindUndoState | undefined, ReadFailure>> {
  for await (const item of session.readFrom(0, { threadId })) {
    if (!item.ok) return err(item.error);
    const event = item.value;
    if (event.kind !== "workspace.rewind_undone") continue;
    const payload = parse(WorkspaceRewindUndonePayloadSchema, event.payload);
    if (!payload.ok) return err({ kind: "row_invalid", where: "workspace.rewind_undone" });
    if (payload.value.rewindId !== rewindId) continue;
    return ok(payload.value.conversation);
  }
  return ok(undefined);
}
