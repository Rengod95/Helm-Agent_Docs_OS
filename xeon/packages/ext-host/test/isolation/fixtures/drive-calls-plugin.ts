// 주도 동등성 시험의 `model`·`tool` 명령 픽스처(등록 이름 `dc`, 상태 `{n, seen}`). 입력의 `mode`가 갈래를 고른다.
// `calls`: model(m1) → tool(t1) → model(m1 재생) → done. `forever`: 요청 id 없이 `tool`만 낸다(횟수 상한이 끝낸다).
// 토큰 한도 100은 등록 때 건다(엔진 안과 격리 자식이 같은 한도에서 시작한다).
import { Type } from "typebox";
import type { DriveStep, ExtensionEntry } from "@fresnel/contracts/extensions";
import { observe } from "./drive-probe.ts";

interface Doc {
  readonly n: number;
  readonly seen: string;
}

const DOC = Type.Object({ n: Type.Integer({ minimum: 0 }), seen: Type.String() });

const MODEL = {
  do: "model",
  messages: [
    { role: "system", content: "Judge." },
    { role: "user", content: "Is it done?" },
  ],
  label: "judge",
  requestId: "m1",
} as const;

const step: DriveStep<Doc> = async ({ state, last, budget, frame }) => {
  observe({ plugin: "dc", state: { n: state.n, seen: state.seen }, last, budget, frame });
  const mode =
    typeof frame.input === "object" && frame.input !== null && "mode" in frame.input
      ? frame.input.mode
      : null;
  if (mode === "forever") return { do: "tool", name: "read", args: null };
  if (last === null) return { do: "commit", state: { n: 1, seen: "" }, next: MODEL };
  if (last.kind === "ok" && last.of === "model" && state.n === 1) {
    return {
      do: "commit",
      state: { n: 2, seen: "" },
      next: { do: "tool", name: "read", args: { path: "a.txt" }, requestId: "t1" },
    };
  }
  if (last.kind === "ok" && last.of === "tool") {
    return { do: "commit", state: { n: 3, seen: "" }, next: MODEL };
  }
  return { do: "done", result: { n: state.n } };
};

export const extension: ExtensionEntry = ({ register }) => {
  register(
    "dc",
    { state: { schema: DOC, initial: { n: 0, seen: "" }, version: 1 }, defaultEnabled: true },
    (g) => {
      g.drive(step, { limits: { maxTokens: 100 } });
    },
  );
};
