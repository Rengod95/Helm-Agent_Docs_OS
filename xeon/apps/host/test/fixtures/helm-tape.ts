import { t, tape, tapePlayer, type TapePlayer } from "@fresnel/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import { fakeHostedSearch } from "./web-search.ts";
import type { AssembleOptions } from "../../src/types.ts";

// Helm 조사 한 번(발산 turn, 렌즈 탐색 3, 적용 turn)의 모델 대본. helm.int.test.ts의 uc2 대본에서 사용자 turn을 뺀 명령 경로다.
// SIGKILL 시험(int/helm-sigkill.int.test.ts)의 자식 호스트와 재개 호스트가 같은 파일을 쓴다.

function answer(label: string, text: string) {
  return {
    role: "main" as const,
    label,
    response: { type: "message" as const, content: [t.text(text)], stopReason: "stop" as const },
  };
}

function report(claim: string): string {
  return `\`\`\`json\n${JSON.stringify({ findings: [{ claim, sources: [], confidence: "medium" }] })}\n\`\`\``;
}

/** 발산 turn의 bash 호출(거부됨), 거부 뒤 답, 렌즈 탐색 셋, 적용 turn */
export function helmDivergeTape(id: string): TapePlayer {
  return tapePlayer(
    tape(id, [
      {
        role: "main" as const,
        label: "diverge: tries bash",
        response: {
          type: "message" as const,
          content: [t.toolCall("bash", { command: "echo should-not-run" }, "call_bash")],
          stopReason: "toolUse" as const,
        },
      },
      answer("diverge: answers after the denial", "쓰기 없이 정리합니다."),
      answer("explorer 1", report("관점 하나")),
      answer("explorer 2", report("관점 둘")),
      answer("explorer 3", report("관점 셋")),
      answer("apply", "발견을 적용했습니다."),
    ]),
    { clock: realTapeClock() },
  );
}

/** 재개 호스트의 대본. 렌즈 탐색과 적용에 쓸 답을 넉넉히 둔다. 남는 답은 검사하지 않는다 */
export function helmResumeTape(id: string): TapePlayer {
  return tapePlayer(
    tape(id, [
      answer("explorer 1", report("관점 하나")),
      answer("explorer 2", report("관점 둘")),
      answer("explorer 3", report("관점 셋")),
      answer("apply", "발견을 적용했습니다."),
      answer("spare 1", "여유 답"),
      answer("spare 2", "여유 답"),
    ]),
    { clock: realTapeClock() },
  );
}

/**
 * 호출 번호 `holdCall`(1부터)의 응답만 끝나지 않게 붙잡는다. 그 호출에서 조사가 탐색 단계에 머문다.
 * 부모가 자식을 SIGKILL로 죽일 때까지 그 자리에 있으려고 쓴다. 다른 호출은 그대로 흘려보낸다
 */
export function holdingPlayer(inner: TapePlayer, holdCall: number): TapePlayer {
  const state = { calls: 0 };
  const never: Promise<never> = new Promise<never>(() => undefined);
  return {
    stream(request) {
      state.calls += 1;
      const stream = inner.stream(request);
      if (state.calls !== holdCall) return stream;
      return {
        rawEvents: stream.rawEvents,
        async *[Symbol.asyncIterator]() {
          await never;
          yield* stream;
        },
      };
    },
    remaining: () => inner.remaining(),
    consumed: () => inner.consumed(),
    assertExhausted: () => inner.assertExhausted(),
  };
}

/**
 * Helm 조사 시험의 웹 검색 대역. 테이프 모델은 hosted 검색을 받지 못해 실제 웹 검색은 실패한다. 엔진 안에서는 이 실패가 출처 저하로
 * 넘어가지만, 격리 자식에서는 엔진 호출 실패의 코드가 자식까지 옮겨지지 않아 단계 오류가 되어 조사가 끝나지 않는다.
 * 시험은 검색을 성공시켜 시나리오가 저하 경로에 들어가지 않게 한다
 */
export function helmWebPorts(): NonNullable<AssembleOptions["webPorts"]> {
  return { hostedSearch: fakeHostedSearch().port };
}
