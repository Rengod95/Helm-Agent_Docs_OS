import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { useEffect, useState } from "react";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { usageFractionOf } from "./pages/providers/providers-model.ts";

// 입력창의 모델 단추·사용량 링과 상태 막대의 모델·토큰 칸이 같이 쓰는 읽기. 모두 요청 결과라 거울에 넣지 않는다(FS-03).
// 대화별 모델을 읽는 wire가 없어(`turn.start`에 모델 인자 없음, `ThreadSummary`에 모델 없음) 모델은 기본 모델(`l1.models.default`)이다.

/** `provider/model` 참조에서 모델 이름만. 시안의 `sonnet-5-5` 자리다. 빗금이 없으면 그대로다 */
export function modelLabelOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(slash + 1);
}

/** 이 대화의 사용량. `tokens`는 session 창에서 쓴 토큰 합이고 `percent`는 한도를 알 때만 값이 있다(0~100) */
export interface SessionUsage {
  readonly tokens: number;
  readonly percent: number | null;
}

/**
 * 게이지 중 `session` 창의 토큰 게이지를 모아 읽는다. 하나도 없으면 null이다.
 * 한도는 게이지 하나에 있을 때만 비율을 낸다(여럿이면 가장 높은 비율). 한도를 모르면 비율을 지어내지 않는다.
 */
export function sessionUsageOf(gauges: readonly UsageGauge[]): SessionUsage | null {
  const own = gauges.filter((g) => g.window === "session" && g.unit === "tokens");
  if (own.length === 0) return null;
  const tokens = own.reduce((sum, g) => sum + g.used, 0);
  const fractions = own.flatMap((g) => {
    const f = usageFractionOf(g);
    return f === null ? [] : [f];
  });
  return { tokens, percent: fractions.length === 0 ? null : Math.max(...fractions) };
}

/** 토큰 수를 짧게: 999 이하는 그대로, 천 단위는 `41k`, 백만 단위는 `1.2M` */
export function tokenCountText(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** 기본 모델 참조. 연결이 살아 있을 때 읽고 설정이 바뀌면(`settings.invalidated`) 다시 읽는다. 정해지지 않았거나 읽지 못하면 null이다 */
export function useDefaultModel(): string | null {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.setup.load({ binaries: false }).then((result) => {
          if (!stale) setModel(result.ok ? result.value.defaultModel : null);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const stop = commands.setup.onInvalidated(read);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase]);
  return model;
}

/**
 * 이 대화의 사용량(`usage.get { threadId }`). 대화가 바뀌거나 턴이 끝나면(`running`이 거짓이 되면) 다시 읽는다.
 * 읽지 못하면 null이다(옛 값을 남기지 않는다).
 */
export function useSessionUsage(threadId: ThreadId | null, running: boolean): SessionUsage | null {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [slot, setSlot] = useState<{
    readonly thread: ThreadId;
    readonly usage: SessionUsage | null;
  } | null>(null);
  useEffect(() => {
    if (phase !== "live" || threadId === null || running) return undefined;
    let stale = false;
    detach(
      commands.usage.get({ threadId }).then((result) => {
        if (!stale) {
          setSlot({
            thread: threadId,
            usage: result.ok ? sessionUsageOf(result.value.gauges) : null,
          });
        }
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [commands, phase, threadId, running]);
  return slot !== null && slot.thread === threadId ? slot.usage : null;
}
