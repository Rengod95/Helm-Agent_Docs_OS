import { Bug } from "@xeon/contracts";
import type { EventId } from "@xeon/contracts/conversation";
import { assembleOptions, assistantItem, systemItem, userItem } from "./builders.ts";
import type { Harness } from "./harness.ts";
import { present, valueOf } from "./result.ts";

// 컴팩션 시험용 대화. 사용자-어시스턴트 쌍을 턴마다 turnId를 달아 쌓는다. 접두는 첫 조립이 만든 것을 기록한다.

export interface Chat {
  /** 쌍마다 사용자 item을 기록한 이벤트 */
  readonly users: readonly EventId[];
  /** 쌍마다 어시스턴트 item을 기록한 이벤트 */
  readonly assistants: readonly EventId[];
  readonly prefix: EventId;
}

/** 글자 수 패딩. 테스트 토큰 추정(JSON 길이 / 4)으로 한 메시지가 대략 pad / 4 + 60 토큰이다 */
function padded(label: string, pad: number): string {
  return `${label} ${"x".repeat(pad)}`;
}

export async function buildChat(h: Harness, pairs: number, pad = 400): Promise<Chat> {
  if (pairs < 1) throw new Bug("buildChat needs at least one pair");
  h.log.append("thread.started", {});
  const users: EventId[] = [];
  const assistants: EventId[] = [];

  // 첫 쌍: 사용자 item 뒤에 첫 조립이 만든 접두를 기록한다
  const firstTurn = h.log.ids.next("trn");
  users.push(
    h.log.append("item.recorded", userItem(h.log, padded("question 0", pad)), { turnId: firstTurn })
      .id,
  );
  const first = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const prefix = h.log.append(
    "item.recorded",
    systemItem(h.log, present(first.pendingItems[0]).message),
  ).id;
  assistants.push(
    h.log.append("item.recorded", assistantItem(h.log, padded("answer 0", pad)), {
      turnId: firstTurn,
    }).id,
  );
  for (let i = 1; i < pairs; i += 1) {
    const turnId = h.log.ids.next("trn");
    users.push(
      h.log.append("item.recorded", userItem(h.log, padded(`question ${i}`, pad)), { turnId }).id,
    );
    assistants.push(
      h.log.append("item.recorded", assistantItem(h.log, padded(`answer ${i}`, pad)), { turnId })
        .id,
    );
  }
  return { users, assistants, prefix };
}
