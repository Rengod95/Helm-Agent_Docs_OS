// 동등성 시험의 플러그인 픽스처 하나. 같은 모듈을 (a) 엔진 안에서 직접 부르고, (b) 격리 자식이 확장 루트의 엔트리로 싣는다.
// 두 경우의 같은 호출이 같은 결과, 같은 상태, 같은 기록을 내야 한다. 모든 동작은 payload와 상태만 보고 정한다.
import { Type } from "typebox";
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

/** 상태 문서. 호출마다 커밋 수와 본 도구 이름을 쌓는다 */
const EQUIVALENCE_STATE = Type.Object({
  count: Type.Number(),
  seen: Type.Array(Type.String()),
});

/** 초기 상태. 타입을 적어 빈 배열이 never[]로 좁혀지지 않게 한다 */
const EQUIVALENCE_INITIAL: { count: number; seen: string[] } = { count: 0, seen: [] };

/** 기록 종류. 매니페스트 `recordKinds`에 있어야 `g.record`가 받는다 */
export const EQUIVALENCE_RECORD_KIND = "x.eq.log.seen";

/**
 * 이 픽스처의 매니페스트 입력(makeManifest 인자). 엔트리 파일은 `equivalence-plugin.ts`다.
 * 엔트리 경로는 호출자가 `entry`로 덮는다
 */
export const EQUIVALENCE_HOOKS = [
  "tool.call.before",
  "tool.result",
  "tool.execution.before",
] as const;

export const extension: ExtensionEntry = ({ register }) => {
  register(
    "eq",
    {
      state: { schema: EQUIVALENCE_STATE, initial: EQUIVALENCE_INITIAL, version: 1 },
      defaultEnabled: true,
    },
    (g) => {
      const host = hostOf(g);

      // first(closed): 차단 결정. `blocked`는 차단하고, `throws`는 던지고, `hang`은 응답하지 않는다(프로세스 종료 시험)
      g.on("tool.call.before", (payload) => {
        if (payload.toolName === "blocked") return { block: true, reason: "the fixture blocks it" };
        if (payload.toolName === "throws") throw new Error("the fixture throws");
        if (payload.toolName === "hang") return new Promise(() => {});
        return undefined;
      });

      // chain(skip): 결과 본문의 details를 바꾼다. `hang-result`는 응답하지 않는다(프로세스 종료 시험)
      g.on("tool.result", (payload, current) => {
        if (payload.toolName === "hang-result") return new Promise(() => {});
        return {
          details: {
            modifiedBy: "eq",
            toolName: payload.toolName,
            previous: current.details ?? null,
          },
        };
      });

      // tap(open): 상태를 커밋하고 기록을 쓴다. 실행 때마다 한 번이다
      g.on("tool.execution.before", async (payload) => {
        const state = g.state();
        await g.commit({ count: state.count + 1, seen: [...state.seen, payload.toolName] });
        await g.record(
          EQUIVALENCE_RECORD_KIND,
          { type: "item", id: payload.toolCallId },
          { tool: payload.toolName, count: state.count + 1 },
        );
      });

      host.registerTool({
        name: "eq-tool",
        description: "echo the arguments with the current count",
        parameters: Type.Object({ text: Type.String() }),
        replay: "safe",
        execute: async (args) => ({ args, count: g.state().count }),
      });

      host.registerCommand("eq-cmd", {
        description: "echo the argument",
        handler: async (args) => ({ message: `ran ${args}`, result: { length: args.length } }),
      });
    },
  );
};
