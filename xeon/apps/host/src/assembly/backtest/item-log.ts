import { attemptAsync, err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { DurableEventEnvelope, SessionService } from "@fresnel/contracts/records";
import type { ItemLogReadError } from "./service.ts";

// 돌려 보기가 대화 로그에서 도구 호출 인자와 결과를 읽는 길(§4.8 규칙 45). 모든 가지의 `item.recorded`를 커밋 순서로 읽고,
// 큰 값은 되살린다(`hydrate`). 되살리지 못한 자리표시는 그대로 남아 서비스가 `blob_expired`로 센다.

/** 세션의 읽기 면. 쓰기는 이 모듈이 하지 않는다 */
export type ItemLogSession = Pick<SessionService, "readFrom" | "hydrate">;

/** 대화 하나의 `item.recorded` 사건을 읽는다 */
export function createItemLogReader(
  session: ItemLogSession,
): (threadId: string) => Promise<Result<readonly DurableEventEnvelope[], ItemLogReadError>> {
  return async (threadId) => {
    const id = parse(ThreadIdSchema, threadId);
    if (!id.ok) return err({ reason: "thread_id" });
    const rows: DurableEventEnvelope[] = [];
    for await (const item of session.readFrom(0, { threadId: id.value })) {
      if (!item.ok) return err({ reason: item.error.kind });
      if (item.value.kind === "item.recorded") rows.push(item.value);
    }
    const hydrated = await Promise.all(rows.map((row) => attemptAsync(() => session.hydrate(row))));
    const out: DurableEventEnvelope[] = [];
    for (const full of hydrated) {
      if (!full.ok) return err({ reason: "hydrate" });
      out.push(full.value);
    }
    return ok(out);
  };
}
