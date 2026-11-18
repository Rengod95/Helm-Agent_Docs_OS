// 큰 값 시험의 공용 도우미: 실제 저장소를 연 하네스, 사용자 메시지와 임대 기록 초안, 저장 행 읽기.
import { parse, parseJson } from "@fresnel/contracts";
import type { EventId, JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import {
  DurableEventEnvelopeSchema,
  type CommitPlan,
  type DurableEventDraft,
  type DurableEventEnvelope,
} from "@fresnel/contracts/records";
import type { SessionDeps } from "../../src/index.ts";
import { manualClock } from "./clock.ts";
import { draftOf, expectOk, openHarness, type Harness } from "./harness.ts";
import { openTestStore, type TestStore, type TestStoreOptions } from "./sqlite-store.ts";

export const KIB: number = 1024;
export const MIB: number = 1024 * KIB;

type ReadBlob = NonNullable<SessionDeps["readBlob"]>;

/** 기록 개수 질의 한 줄 */
export function countRows(store: TestStore, sql: string): number {
  return store.raw.query<{ n: number }, []>(sql).get()?.n ?? 0;
}

/** 실제 저장소(platform-store)를 연 하네스. 블롭은 실제 파일로 쓰이고 읽기 횟수를 센다 */
export async function openRealHarness(options: {
  readonly settings?: TestStoreOptions["settings"];
  readonly storeFaults?: TestStoreOptions["storeFaults"];
}): Promise<{ readonly h: Harness; readonly store: TestStore; readonly reads: { count: number } }> {
  const clock = manualClock();
  const store = await openTestStore({
    clock,
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.storeFaults === undefined ? {} : { storeFaults: options.storeFaults }),
  });
  const reads = { count: 0 };
  const readBlob: ReadBlob = (ref) => {
    reads.count += 1;
    return store.service.readBlob(ref);
  };
  const h = await openHarness({
    clock,
    store,
    putBlob: (bytes, mediaType) => store.service.putBlob(bytes, mediaType),
    readBlob,
  });
  return { h, store, reads };
}

/** 사용자 메시지 기록의 payload. 내용 문자열이 `item.message.content`가 된다 */
export function userItemPayload(itemId: string, content: unknown): unknown {
  return {
    item: {
      itemId,
      status: "completed",
      kind: "user",
      message: { role: "user", content, timestamp: 1 },
      requestId: null,
    },
  };
}

/** 사용자 메시지 하나를 쓰는 커밋 계획. payload를 미리 정해 두어 되돌린 값과 비교할 수 있다 */
export function appendItem(h: Harness, threadId: ThreadId, payload: unknown): () => CommitPlan {
  const scope = { turnId: h.ids.next("trn"), stepId: null };
  return () => ({
    kind: "append",
    drafts: [draftOf(h, h.loop, "item.recorded", threadId, scope, payload)],
    checkpoint: null,
  });
}

/** 확장 임대 기록 초안(`ext.commit`용) */
export function leaseDraft(
  h: Harness,
  threadId: ThreadId,
  kind: "lease.acquired" | "lease.released" | "lease.requested" | "lease.user_input",
  payload: unknown,
): DurableEventDraft {
  return {
    id: h.ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
  };
}

/** 저장된 envelope 행의 JSON 텍스트와 파싱한 기록(저장 형식 그대로, 자리표시 포함) */
export function storedRow(
  store: TestStore,
  id: EventId,
): { readonly text: string; readonly envelope: DurableEventEnvelope } {
  const row = store.raw
    .query<{ envelope: string }, [string]>("SELECT envelope FROM events WHERE id = ?")
    .get(id);
  const text = row?.envelope;
  if (text === undefined) throw new Error("the event row is missing");
  return { text, envelope: expectOk(parse(DurableEventEnvelopeSchema, expectOk(parseJson(text)))) };
}

/** 스레드의 기록을 replay와 같은 경로(`readFrom`)로 읽는다. 자리표시는 되돌리지 않는다 */
export async function replayed(
  h: Harness,
  threadId: ThreadId,
): Promise<readonly DurableEventEnvelope[]> {
  return (await Array.fromAsync(h.service.readFrom(0, { threadId }))).map(expectOk);
}

export function bigObject(count: number, chars: number): JsonValue {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      index,
      text: `${index}`.padEnd(chars, "x"),
    })),
  };
}
