import type { GroupApi } from "@fresnel/group-sdk";
import {
  HELM_USAGE,
  commandErrorText,
  parseHelmCommand,
  pluginRequestText,
  runHelmCommand,
  startFailureText,
  statusText,
} from "./commands.ts";
import type { SignalTermsStore, TallyStore } from "./signals.ts";
import type { HelmState } from "./state.ts";

type CommandApi = Pick<GroupApi<HelmState>, "state" | "commit" | "startDrive">;

/**
 * g.registerCommand에 넘기는 정의. 처리기는 X의 명령 문맥(thread 있음) 안에서 상태를 바로 바꾸고 결과 글을 명령 결과(`command.run`의 `message`)로 돌려준다.
 * 결과 글은 모델 입력 대기열에 쌓지 않는다. 호출 id(`invocationId`)는 탐구 id의 재료로만 쓴다.
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
      if (ctx.threadId === null) return undefined;
      const parsed = parseHelmCommand(args);
      if (!parsed.ok) return commandErrorText(parsed.error);
      // 이 turn 입력의 용어가 우선이고, 없으면 마지막 신호의 근거 용어를 쓴다
      const current = tallies.get(ctx.threadId)?.promptTerms ?? [];
      const terms = current.length > 0 ? current : (signalTerms.get(ctx.threadId) ?? []);
      const result = await runHelmCommand(g, parsed.value, { nonce: ctx.invocationId, terms });
      if (!result.ok) return commandErrorText(result.error);
      const command = parsed.value;
      // 맡기기 요청도 상태를 커밋한 뒤 주도 시작 요청을 낸다(drive-isolation.md 2.2). 탐구 시작과 같은 계기다
      if (command.name === "plugin") {
        const requested = g.startDrive();
        const line = pluginRequestText(command.purpose);
        return requested.ok ? line : `${line}\n${startFailureText(requested.error)}`;
      }
      const text = statusText(result.value, [...missingMeta]);
      if (command.name !== "start") return text;
      // 탐구 시작은 상태를 커밋한 뒤 주도 시작 요청을 낸다(drive-isolation.md 2.2). 거부되면 이유를 결과 글에 붙인다
      const started = g.startDrive();
      return started.ok ? text : `${text}\n${startFailureText(started.error)}`;
    },
  };
}
