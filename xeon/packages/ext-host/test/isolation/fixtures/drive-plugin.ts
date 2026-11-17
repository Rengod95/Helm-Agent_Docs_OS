// 격리 주도(`drive.step`) 시험의 플러그인 픽스처. 등록 이름은 `dr`이고 상태는 `{count, seen}`이다.
// 시나리오는 `startDrive`의 입력 `scenario`로 고른다. 단계 함수는 `frame.input`으로 시나리오를 읽는다.
//   basic    턴 하나를 하고 상태를 올리며 `seen`에 직전 결과를 적고 끝낸다
//   inspect  첫 단계의 `budget`, `frame`, `last`를 `seen`에 적고 끝낸다(입력이 실제 값으로 왔는지 본다)
//   hang     첫 단계에서 끝나지 않는다(단계 시간 한도, 프로세스 죽음 시험)
//   steps    턴 하나를 하고 상태를 올린 뒤 쉬었다가, 사용자 메시지 `last`에서 끝나지 않는다(재시작 뒤 이어 가기)
//   resume   턴 없이 커밋된 상태를 결과로 끝낸다
//   replay   턴 하나(요청 id turn-1)를 하고, 그 결과를 받은 다음 단계에서 끝나지 않는다(호스트 재시작 뒤 턴이 다시 돌지 않는지 본다)
//   shape    질문 카드가 질문을 하나도 갖지 않는다(명령의 모양이 스키마와 맞지 않는다)
// 명령 `start`는 인자 하나를 시나리오 이름으로 받아 `startDrive({scenario})`를 부른다(시작 요청의 입력이 frame.input이 된다).
// 이 파일은 격리 자식이 import하고, 같은 `extension`을 엔진 안에서 설치해 비교한다.
import { Type } from "typebox";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { DriveStep, ExtensionEntry, PostItem } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

interface Counter {
  readonly count: number;
  readonly seen: string;
}

const COUNTER = Type.Object({ count: Type.Integer({ minimum: 0 }), seen: Type.String() });
const GO: PostItem = { kind: "user", content: "go" };

/** 시나리오 이름. 입력이 없거나 모르는 이름이면 `basic`이다 */
function scenarioOf(input: JsonValue | null): string {
  if (input === null || typeof input !== "object" || !("scenario" in input)) return "basic";
  const name: unknown = input.scenario;
  return typeof name === "string" ? name : "basic";
}

/** 끝나지 않는 약속. 단계가 이것을 기다리면 시간 한도나 프로세스 죽음이 끝낸다 */
function forever(): Promise<never> {
  return new Promise<never>(() => undefined);
}

const step: DriveStep<Counter> = async ({ state, last, budget, frame }) => {
  const scenario = scenarioOf(frame.input);
  if (scenario === "hang") await forever();
  if (scenario === "resume") {
    return { do: "done", result: { count: state.count, seen: state.seen } };
  }
  if (scenario === "inspect" && last === null) {
    return {
      do: "commit",
      state: { count: state.count, seen: JSON.stringify({ budget, frame, last }) },
      next: { do: "done" },
    };
  }
  if (scenario === "shape" && last === null) {
    // 타입은 맞지만 스키마는 질문 1~4개를 요구한다. 엔진이 이 명령을 거부한다
    return { do: "ask", card: { questions: [] } };
  }
  if (scenario === "replay") {
    if (last === null) return { do: "turn", input: GO, requestId: "turn-1" };
    if (last.kind === "ok" && last.of === "turn") await forever();
    return { do: "yield" };
  }
  if (scenario === "steps") {
    if (last === null) return { do: "turn", input: GO, requestId: "turn-1" };
    if (last.kind === "ok" && last.of === "turn") {
      return {
        do: "commit",
        state: { count: state.count + 1, seen: JSON.stringify(last) },
        next: { do: "yield" },
      };
    }
    if (last.kind === "user") {
      await forever();
    }
    return { do: "yield" };
  }
  if (last === null) return { do: "turn", input: GO, requestId: "turn-1" };
  if (last.kind === "ok" && last.of === "turn") {
    return {
      do: "commit",
      state: { count: state.count + 1, seen: JSON.stringify(last) },
      next: { do: "done", result: { turn: last.value.turnId } },
    };
  }
  return { do: "done" };
};

export const extension: ExtensionEntry = ({ register }) => {
  register(
    "dr",
    {
      state: { schema: COUNTER, initial: { count: 0, seen: "" }, version: 1 },
      defaultEnabled: true,
    },
    (g) => {
      const host = hostOf(g);
      g.drive(step);
      host.registerCommand("start", {
        handler: async (args) => {
          const started = await host.startDrive({ scenario: args });
          return started.ok ? "started" : `refused ${started.error.kind}`;
        },
      });
    },
  );
};
