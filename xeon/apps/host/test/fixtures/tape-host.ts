import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import type { AssembleOptions } from "../../src/types.ts";

// 모델 테이프로 엔진을 움직이는 시험의 도우미. 실제 시간으로 도는 시계(stall 응답이 abort를 기다릴 때 쓴다)와,
// 첫 요청에 응답하지 않는(stall) 테이프 또는 정해진 답을 내는 테이프로 buildModels를 만든다.

export function realTapeClock(): Clock & Scheduler {
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  const state = { next: 1 };
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const handle = state.next;
      state.next += 1;
      timers.set(handle, setTimeout(fn, ms));
      return handle;
    },
    clearTimeout(handle) {
      const timer = timers.get(handle);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

/** 모델이 응답하지 않는 테이프: turn이 시작된 채로 멈춰 있다가 abort로 끝난다 */
export function stallingModels(id: string): NonNullable<AssembleOptions["buildModels"]> {
  const provider = tapeProvider(
    tapePlayer(
      tape(id, [{ role: "main", label: "never answers", response: { type: "stall" } }], {
        allowLeftover: true,
      }),
      { clock: realTapeClock() },
    ),
  );
  return tapeBuildModels(provider);
}

/** 모델이 정해진 답을 한 번 내는 테이프 */
export function answeringModels(
  id: string,
  answer: string,
): NonNullable<AssembleOptions["buildModels"]> {
  const provider = tapeProvider(
    tapePlayer(
      tape(id, [
        {
          role: "main",
          label: "plain answer",
          response: { type: "message", content: [t.text(answer)], stopReason: "stop" },
        },
      ]),
      { clock: realTapeClock() },
    ),
  );
  return tapeBuildModels(provider);
}

/** 모델이 부른 순서대로 정해진 답을 내는 테이프. 대화 turn과 요약 호출이 같은 큐(`main`)에서 차례로 꺼낸다 */
export function sequencedModels(
  id: string,
  answers: readonly string[],
): NonNullable<AssembleOptions["buildModels"]> {
  const provider = tapeProvider(
    tapePlayer(
      tape(
        id,
        answers.map((answer, index) => ({
          role: "main" as const,
          label: `answer ${String(index + 1)}`,
          response: {
            type: "message" as const,
            content: [t.text(answer)],
            stopReason: "stop" as const,
          },
        })),
      ),
      { clock: realTapeClock() },
    ),
  );
  return tapeBuildModels(provider);
}
