// 맡기기 동등성 시험의 두 플러그인 단계(A `ha`는 맡기고, B `hb`는 받는다). 같은 로직을 A·B 엔트리 파일이 등록한다.
// 시작 요청의 입력 `mode`를 A가 B에게 그대로 넘기므로, 시험이 갈래를 고른다:
//   plain  B는 바로 done으로 결과를 돌려준다
//   turn   B는 턴 하나를 하고 그 턴 결과를 done으로 돌려준다(예산이 맡긴 쪽과 함께 준다)
//   self   B가 자기 자신에게 맡긴다(self_handoff 거부), 거부 결과를 done으로 돌려준다
//   fail   B는 첫 단계에서 실패한다. 실패 방식(끝나지 않음 또는 던짐)은 시험이 drive-probe의 `setFailure`로 고른다
// A는 첫 단계에 B에게 맡기고, 돌아온 `last`(맡기기 결과, 거부, 끊김)를 상태에 적고 끝낸다.
import { Type } from "typebox";
import type { DriveStep, ExtensionEntry, PostItem } from "@fresnel/contracts/extensions";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { failureMode, observe } from "./drive-probe.ts";

interface HandoffDoc {
  readonly n: number;
  readonly seen: string;
}

const HANDOFF_DOC = Type.Object({ n: Type.Integer({ minimum: 0 }), seen: Type.String() });
const GO: PostItem = { kind: "user", content: "go" };

/** 시작 요청 입력의 `mode`. 없거나 모르면 plain이다 */
function modeOf(input: JsonValue | null): string {
  if (input === null || typeof input !== "object" || !("mode" in input)) return "plain";
  const mode: unknown = input.mode;
  return typeof mode === "string" ? mode : "plain";
}

const forever = (): Promise<never> =>
  new Promise<never>(() => {
    // 끝나지 않는 약속: 시간 한도나 프로세스 죽음이 끝낸다
  });

/** 맡기는 쪽(A, `ha`) */
export const stepA: DriveStep<HandoffDoc> = async ({ state, last, budget, frame }) => {
  observe({ plugin: "ha", state: { n: state.n, seen: state.seen }, last, budget, frame });
  if (last === null) {
    return { do: "handoff", to: "hb", input: { mode: modeOf(frame.input) } };
  }
  return {
    do: "commit",
    state: { n: state.n + 1, seen: JSON.stringify(last) },
    next: { do: "done" },
  };
};

/** 맡은 쪽(B, `hb`) */
export const stepB: DriveStep<HandoffDoc> = async ({ state, last, budget, frame }) => {
  observe({ plugin: "hb", state: { n: state.n, seen: state.seen }, last, budget, frame });
  const mode = modeOf(frame.input);
  if (mode === "fail") {
    if (failureMode() === "hang") await forever();
    throw new Error("the step of hb fails on purpose");
  }
  if (mode === "turn") {
    if (last === null) return { do: "turn", input: GO };
    if (last.kind === "ok" && last.of === "turn") {
      return { do: "done", result: { turn: last.value.turnId } };
    }
    return { do: "done" };
  }
  if (mode === "self") {
    if (last === null) return { do: "handoff", to: "hb", input: { mode: "plain" } };
    return { do: "done", result: last.kind === "refused" ? { refused: last.code } : null };
  }
  return { do: "done", result: { b: "plain" } };
};

/** 등록 한 개짜리 엔트리. 상태 스키마는 여기서만 쓴다 */
export function handoffEntry(name: string, step: DriveStep<HandoffDoc>): ExtensionEntry {
  return ({ register }) => {
    register(
      name,
      {
        state: { schema: HANDOFF_DOC, initial: { n: 0, seen: "" }, version: 1 },
        defaultEnabled: true,
      },
      (g) => {
        g.drive(step);
      },
    );
  };
}
