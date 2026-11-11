// 사용량 내역(N-3). 상태 줄 사용량 칸과 입력창 문맥 링을 누르면 열리는 Popover의 본문이다.
// 이 대화의 합계(`usage.get`의 session 게이지: 토큰, 비용, 요청, 캐시 읽기·쓰기)와, 가장 나중 턴의 입력·출력·캐시·비용과 호출 한 줄(`measure.turn`)을 보인다.
// 값을 지어내지 않는다. 측정이 꺼졌거나 Turn 기록이 없으면 Turn 줄은 두지 않는다.
import { t } from "@fresnel/client/i18n";
import { costText, turnViewOf } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { MeasureTurnResult, UsageGauge } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import { useRecentTurnIds } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { tokenCountText } from "./model-usage.ts";

/** 대화 합계 */
export interface UsageTotals {
  readonly tokens: number;
  readonly usd: number;
  readonly requests: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** 가장 나중 턴의 내역. 호출 수는 main 호출만 센다 */
export interface TurnBreakdown {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly usd: number;
  readonly calls: number;
  /** main 호출들이 모델에서 보낸 시간 합(ms) */
  readonly modelMs: number;
  /** main 호출 사이의 틈 합(ms). 도구 실행과 승인 대기가 합쳐 있다 */
  readonly waitMs: number;
}

interface UsageBreakdown {
  readonly totals: UsageTotals;
  readonly turn: TurnBreakdown | null;
}

/** session 창 게이지를 단위별로 합친다 */
export function totalsOf(gauges: readonly UsageGauge[]): UsageTotals {
  const sum = (unit: UsageGauge["unit"]): number =>
    gauges
      .filter((gauge) => gauge.window === "session" && gauge.unit === unit)
      .reduce((total, gauge) => total + gauge.used, 0);
  return {
    tokens: sum("tokens"),
    usd: sum("usd"),
    requests: sum("requests"),
    cacheRead: sum("cacheRead"),
    cacheWrite: sum("cacheWrite"),
  };
}

/** `measure.turn` 결과에서 Turn 내역을 읽는다. 측정이 꺼졌거나 Turn 행이 없으면 null이다 */
export function turnBreakdownOf(result: MeasureTurnResult): TurnBreakdown | null {
  const state = turnViewOf(result);
  if (state.kind !== "ready" || state.view.summary === null) return null;
  const { summary, calls, phases } = state.view;
  const main = calls.filter((call) => call.role === "main");
  return {
    input: summary.input,
    output: summary.output,
    cacheRead: summary.cacheRead,
    cacheWrite: summary.cacheWrite,
    usd: summary.usd,
    calls: main.length,
    modelMs: main.reduce((total, call) => total + call.durationMs, 0),
    waitMs: phases
      .filter((phase) => phase.kind === "wait")
      .reduce((total, phase) => total + phase.ms, 0),
  };
}

function secondsText(ms: number): string {
  return t("desktop.usage.breakdown.seconds", { value: (ms / 1000).toFixed(1) });
}

/** 이 대화의 사용량 내역을 읽는다. 열릴 때(마운트) 한 번 읽는다 */
function useUsageBreakdown(threadId: ThreadId): UsageBreakdown | null {
  const commands = useCommands();
  const turns = useRecentTurnIds(threadId);
  const lastTurn = turns.at(-1);
  const [slot, setSlot] = useState<UsageBreakdown | null>(null);
  useEffect(() => {
    const guard = { stale: false };
    detach(
      (async (): Promise<undefined> => {
        const usage = await commands.usage.get({ threadId });
        const measured =
          lastTurn === undefined ? undefined : await commands.measure.turn(threadId, lastTurn);
        if (guard.stale || !usage.ok) return undefined;
        setSlot({
          totals: totalsOf(usage.value.gauges),
          turn: measured?.ok === true ? turnBreakdownOf(measured.value) : null,
        });
        return undefined;
      })(),
      rethrow,
    );
    return () => {
      guard.stale = true;
    };
  }, [commands, threadId, lastTurn]);
  return slot;
}

/** Popover 본문. 합계 두 줄, Turn 두 줄. 읽기 전에는 아무것도 그리지 않는다 */
export function UsageBreakdownBody(props: { readonly threadId: ThreadId }): ReactNode {
  const breakdown = useUsageBreakdown(props.threadId);
  if (breakdown === null) return null;
  const { totals, turn } = breakdown;
  return (
    <div className="mt-2 grid gap-2 text-ui text-text-secondary" data-usage-breakdown>
      <div className="grid gap-0.5">
        <p className="m-0 text-text-primary">{t("desktop.usage.breakdown.total")}</p>
        <p className="m-0 tabular-nums">
          {t("desktop.usage.breakdown.totalLine", {
            tokens: tokenCountText(totals.tokens),
            cost: costText(totals.usd),
            requests: totals.requests,
          })}
        </p>
        <p className="m-0 tabular-nums">
          {t("desktop.usage.breakdown.cacheLine", {
            read: tokenCountText(totals.cacheRead),
            write: tokenCountText(totals.cacheWrite),
          })}
        </p>
      </div>
      {turn === null ? null : (
        <div className="grid gap-0.5">
          <p className="m-0 text-text-primary">{t("desktop.usage.breakdown.turn")}</p>
          <p className="m-0 tabular-nums">
            {t("desktop.usage.breakdown.turnTokens", {
              input: tokenCountText(turn.input),
              output: tokenCountText(turn.output),
              read: tokenCountText(turn.cacheRead),
              write: tokenCountText(turn.cacheWrite),
              cost: costText(turn.usd),
            })}
          </p>
          <p className="m-0 tabular-nums">
            {t("desktop.usage.breakdown.turnTime", {
              calls: turn.calls,
              model: secondsText(turn.modelMs),
              wait: secondsText(turn.waitMs),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
