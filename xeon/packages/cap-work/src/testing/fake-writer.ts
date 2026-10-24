import { Bug } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { EventKind, ProducerHandle } from "@xeon/contracts/records";
import type { WorkSessionPort } from "../ports/session.ts";

// 시험 대역이 L1.tools처럼 이벤트를 남기는 길. 대역은 `core.tools` 생산자 핸들을 받아 승인·모드 변경 이벤트를 실제 세션에 커밋한다.
// 투영기가 읽는 이벤트가 실제 L1과 같은 모양(F 카탈로그)이어야 하므로 카탈로그 검증은 저장소가 한다.

export interface FakeWriter {
  /** 이벤트 하나를 커밋하고 그 이벤트 id를 돌려준다. 같은 key의 재호출은 처음 id를 돌려준다 */
  write(threadId: ThreadId, key: string, kind: EventKind, payload: unknown): string;
}

export function createFakeWriter(options: {
  readonly session: Pick<WorkSessionPort, "commit">;
  /** `session.producer("core.tools")`로 받은 핸들: approval.* 이벤트의 생산자 */
  readonly tools: ProducerHandle;
  /**
   * settings.changed(세션 범위 설정 기록) 대역. 이 이벤트의 생산자 core.persistence는 PS-14(m2/l1b)가 구현하기 전에는
   * 밖에서 쓸 수 없다. 시험 조립이 투영기에 직접 알리는 함수를 넘기고, 통합 때 실제 `sessionSettings.set`으로 바꾼다
   */
  readonly recordSetting: (threadId: ThreadId, payload: unknown) => void;
  readonly ids: IdFactory;
}): FakeWriter {
  return {
    write(threadId, key, kind, payload) {
      if (kind === "settings.changed") {
        options.recordSetting(threadId, payload);
        return "evt_settings";
      }
      const result = options.session.commit({
        threadId,
        requestId: key,
        fingerprintSource: { key },
        build: () => ({
          kind: "append",
          drafts: [
            options.tools.draft({
              id: options.ids.next("evt"),
              kind,
              threadId,
              turnId: null,
              stepId: null,
              causationId: null,
              correlationId: null,
              payload,
            }),
          ],
          checkpoint: null,
        }),
      });
      if (!result.ok || result.value.status !== "committed") {
        throw new Bug(`fake writer: commit of ${kind} failed`, { cause: result });
      }
      const first = result.value.eventIds[0];
      if (first === undefined) throw new Bug("fake writer: the commit made no event");
      return first;
    },
  };
}
