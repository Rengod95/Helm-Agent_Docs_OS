// M5e 훅 정리(enH1)가 더한 것을 격리 자식도 같은 뜻으로 받는지 보는 픽스처. 같은 모듈을 엔진 안과 격리 자식이 싣는다.
// 새 훅 넷, `tool.call.before`의 결정 ask·replace, `thread.resources`의 workspace, 도구의 `ctx.changes.report`를 쓴다.
import { Type } from "typebox";
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

const PARITY_STATE = Type.Object({ asked: Type.Array(Type.String()) });
const PARITY_INITIAL: { asked: string[] } = { asked: [] };

export const PARITY_HOOKS = [
  "tool.call.before",
  "ask.human.before",
  "ask.human.after",
  "agent.spawn.before",
  "agent.spawn.after",
  "thread.resources",
] as const;

export const extension: ExtensionEntry = ({ register }) => {
  register(
    "pa",
    { state: { schema: PARITY_STATE, initial: PARITY_INITIAL, version: 1 }, defaultEnabled: true },
    (g) => {
      const host = hostOf(g);

      // first: 도구 이름으로 결정 종류를 고른다. `both`는 합치기 시험에서 다른 플러그인의 ask와 겨룬다
      g.on("tool.call.before", (payload) => {
        if (payload.toolName === "ask-it") return { ask: true, reason: "pa asks" };
        if (payload.toolName === "replace-it" || payload.toolName === "both") {
          return {
            replace: { content: [{ type: "text", text: "replaced by pa" }], isError: false },
            reason: "pa replaces",
          };
        }
        return undefined;
      });

      // first: 카드 없이 취소한다. 질문 종류는 결정을 내지 않는다
      g.on("ask.human.before", (payload) =>
        payload.askKind === "tool" ? { cancel: true, reason: "pa cancels" } : undefined,
      );

      // tap: 물은 종류를 상태에 쌓는다
      g.on("ask.human.after", async (payload) => {
        const state = g.state();
        await g.commit({ asked: [...state.asked, payload.askKind] });
      });

      // first: 위임을 막거나 보고로 대신한다
      g.on("agent.spawn.before", (payload) => {
        if (payload.agent === "blocked") return { block: true, reason: "pa blocks the spawn" };
        if (payload.agent === "reported") {
          return { replace: { report: "pa reports" }, reason: "pa replaces the spawn" };
        }
        return undefined;
      });

      // chain: 보고 본문을 바꾼다
      g.on("agent.spawn.after", () => ({ reportText: "patched by pa" }));

      // collect: 스킬 경로와 대화 폴더 후보를 낸다
      g.on("thread.resources", () => ({ skillPaths: ["/pa/skills"], workspace: "/pa/work" }));

      host.registerTool({
        name: "pa-tool",
        description: "report one file change",
        parameters: Type.Object({ path: Type.String() }),
        replay: "safe",
        execute: async (args, ctx) => {
          ctx.changes?.report([
            { path: "/pa/a.txt", op: "create", existed: false, added: 1, removed: 0 },
          ]);
          return { reported: args };
        },
      });
    },
  );
};
