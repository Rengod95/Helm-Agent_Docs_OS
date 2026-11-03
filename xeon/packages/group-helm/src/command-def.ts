import type { GroupApi } from "@fresnel/group-sdk";
import {
  HELM_USAGE,
  commandErrorText,
  parseHelmCommand,
  runHelmCommand,
  statusText,
} from "./commands.ts";
import { statusNotice } from "./prompts.ts";
import type { SignalTermsStore, TallyStore } from "./signals.ts";
import type { HelmState } from "./state.ts";

type CommandApi = Pick<GroupApi<HelmState>, "state" | "commit" | "post">;

/**
 * g.registerCommand에 넘기는 정의. 처리기는 X의 명령 문맥(thread 있음) 안에서 상태를 바로 바꾸고 결과를 알림으로 남긴다.
 * 알림 requestId는 호출 id(`invocationId`)에서 만든다. 같은 호출을 다시 실행하면 같은 값이라 알림은 한 번이다.
 * thread가 없는 호출은 닿을 상태가 없어 아무것도 하지 않는다
 */
export function helmCommand(
  g: CommandApi,
  tallies: TallyStore,
  signalTerms: SignalTermsStore,
  missingMeta: ReadonlySet<string>,
): Parameters<GroupApi<HelmState>["registerCommand"]>[1] {
  return {
    description: HELM_USAGE,
    async handler(args, ctx) {
      if (ctx.threadId === null) return;
      const parsed = parseHelmCommand(args);
      let text: string;
      if (!parsed.ok) {
        text = commandErrorText(parsed.error);
      } else {
        // 이 turn 입력의 용어가 우선이고, 없으면 마지막 신호의 근거 용어를 쓴다
        const current = tallies.get(ctx.threadId)?.promptTerms ?? [];
        const terms = current.length > 0 ? current : (signalTerms.get(ctx.threadId) ?? []);
        const result = await runHelmCommand(g, parsed.value, { nonce: ctx.invocationId, terms });
        text = result.ok
          ? statusText(result.value, [...missingMeta])
          : commandErrorText(result.error);
      }
      await g.post(statusNotice(text), { when: "next", requestId: `helm:cmd:${ctx.invocationId}` });
    },
  };
}
