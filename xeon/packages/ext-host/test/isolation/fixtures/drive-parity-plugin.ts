// 주도 동등성 시험의 단일 플러그인 픽스처(등록 이름 `dp`, 상태 `{n, seen}`).
// 명령 순서: turn → commit(+next ask) → ask 답 → spawn → commit(+next yield) → 사용자 메시지 → done.
// 단계 함수는 클로저에 진행 상태를 두지 않는다. `yield` 뒤 엔진이 `last: null`로 다시 부르면 상태 문서의 `n`으로 정한다
// (F.extensions 4.6: 같은 단계가 다시 돌 수 있다). 단계마다 받은 입력을 `observe`로 넘긴다(drive-probe.ts).
import { Type } from "typebox";
import type { AskCard, DriveStep, ExtensionEntry, PostItem } from "@fresnel/contracts/extensions";
import { observe } from "./drive-probe.ts";

interface Doc {
  readonly n: number;
  readonly seen: string;
}

const DOC = Type.Object({ n: Type.Integer({ minimum: 0 }), seen: Type.String() });
const GO: PostItem = { kind: "user", content: "go" };

const CARD: AskCard = {
  questions: [
    {
      id: "q1",
      header: "Plan",
      text: "Proceed?",
      options: [
        { id: "yes", label: "Yes", description: "Run it now", recommended: true },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

const step: DriveStep<Doc> = async ({ state, last, budget, frame }) => {
  observe({ plugin: "dp", state: { n: state.n, seen: state.seen }, last, budget, frame });
  if (last === null) {
    if (state.n === 0) return { do: "turn", input: GO };
    if (state.n === 2) return { do: "yield" };
    return { do: "done" };
  }
  if (last.kind === "ok" && last.of === "turn") {
    return {
      do: "commit",
      state: { n: state.n + 1, seen: JSON.stringify(last) },
      next: { do: "ask", card: CARD },
    };
  }
  if (last.kind === "ask") return { do: "spawn", agent: "helper", task: "look" };
  if (last.kind === "ok" && last.of === "spawn") {
    return {
      do: "commit",
      state: { n: state.n + 1, seen: JSON.stringify(last) },
      next: { do: "yield" },
    };
  }
  if (last.kind === "user") return { do: "done", result: { n: state.n } };
  return { do: "done" };
};

export const extension: ExtensionEntry = ({ register }) => {
  register(
    "dp",
    { state: { schema: DOC, initial: { n: 0, seen: "" }, version: 1 }, defaultEnabled: true },
    (g) => {
      g.drive(step);
    },
  );
};
