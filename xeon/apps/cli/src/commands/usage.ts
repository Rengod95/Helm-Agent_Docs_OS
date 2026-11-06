import { t } from "@fresnel/client/i18n";
import { assertNever, attemptAsync } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { UsageGauge } from "@fresnel/contracts/wire";
import type { UsageCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { withEngine, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 `fresnel usage [--thread <id>] [--json]`와 `chat -p`가 끝에 stderr로 내는 한 줄 요약.
// 원천은 wire `usage.get`이다. 게이지는 provider마다 session 창의 tokens, usd, requests, cacheRead, cacheWrite 다섯 줄이다.

/** provider 하나(또는 전체)의 합. 게이지 `used`를 단위별로 모은다 */
export interface UsageTally {
  readonly tokens: number;
  readonly usd: number;
  readonly requests: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const EMPTY: UsageTally = { tokens: 0, usd: 0, requests: 0, cacheRead: 0, cacheWrite: 0 };

function addGauge(tally: UsageTally, gauge: UsageGauge): UsageTally {
  switch (gauge.unit) {
    case "tokens":
      return { ...tally, tokens: tally.tokens + gauge.used };
    case "usd":
      return { ...tally, usd: tally.usd + gauge.used };
    case "requests":
      return { ...tally, requests: tally.requests + gauge.used };
    case "cacheRead":
      return { ...tally, cacheRead: tally.cacheRead + gauge.used };
    case "cacheWrite":
      return { ...tally, cacheWrite: tally.cacheWrite + gauge.used };
    default:
      return assertNever(gauge.unit, "UsageUnit");
  }
}

/** provider별 합과 전체 합. session 창만 센다(다른 창은 같은 호출을 다시 세므로). provider는 처음 나온 순서다 */
export function tallyOf(gauges: readonly UsageGauge[]): {
  readonly providers: readonly (readonly [string, UsageTally])[];
  readonly total: UsageTally;
} {
  const byProvider = new Map<string, UsageTally>();
  let total = EMPTY;
  for (const gauge of gauges) {
    if (gauge.window !== "session") continue;
    byProvider.set(gauge.providerId, addGauge(byProvider.get(gauge.providerId) ?? EMPTY, gauge));
    total = addGauge(total, gauge);
  }
  return { providers: [...byProvider], total };
}

function countText(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** 비용은 소수 넷째 자리까지 쓴다. 0이면 `$0`이다 */
function usdText(value: number): string {
  return value === 0 ? "$0" : `$${value.toFixed(4)}`;
}

/** `chat -p` 끝의 한 줄과 표의 합계 줄이 같이 쓰는 문장 */
function usageSummaryText(tally: UsageTally): string {
  return t("cli.cost.summary", {
    tokens: countText(tally.tokens),
    usd: usdText(tally.usd),
    requests: countText(tally.requests),
  });
}

function providerLine(providerId: string, tally: UsageTally): string {
  return t("cli.cost.provider", {
    provider: providerId,
    tokens: countText(tally.tokens),
    usd: usdText(tally.usd),
    requests: countText(tally.requests),
    cacheRead: countText(tally.cacheRead),
    cacheWrite: countText(tally.cacheWrite),
  });
}

/**
 * `chat -p`가 turn 하나를 끝낸 뒤 stderr에 한 줄을 쓴다. 이 대화의 합이다. 엔진이 `usage.get`을 처리하지 않거나 읽지 못하면 아무것도 쓰지 않는다
 * (요약은 부가 정보라 응답과 종료 코드에 영향을 주지 않는다)
 */
export async function printUsageLine(
  ctx: CommandContext,
  handle: EngineHandle,
  threadId: ThreadId,
): Promise<void> {
  if (!handle.supports("usage.get")) return;
  const got = await attemptAsync(() => handle.connection.request("usage.get", { threadId }));
  if (!got.ok) return;
  await ctx.io.stderr(`${usageSummaryText(tallyOf(got.value.gauges).total)}\n`);
}

export async function runUsage(ctx: CommandContext, command: UsageCommand): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const result = await handle.connection.request(
      "usage.get",
      command.threadId === null ? {} : { threadId: command.threadId },
    );
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return EXIT.ok;
    }
    const { providers, total } = tallyOf(result.gauges);
    if (providers.length === 0) {
      await ctx.io.stdout(
        `${command.threadId === null ? t("cli.cost.none") : t("cli.cost.noneThread", { threadId: command.threadId })}\n`,
      );
      return EXIT.ok;
    }
    const lines = [
      command.threadId === null
        ? t("cli.cost.scope.all", { asOf: result.asOf })
        : t("cli.cost.scope.thread", { threadId: command.threadId, asOf: result.asOf }),
      ...providers.map(([providerId, tally]) => providerLine(providerId, tally)),
      ...(providers.length > 1 ? [t("cli.cost.total", { summary: usageSummaryText(total) })] : []),
      ...(result.context === undefined
        ? []
        : [
            t("cli.cost.context", {
              model: result.context.model,
              used: countText(result.context.used),
              limit: countText(result.context.limit),
            }),
          ]),
    ];
    await ctx.io.stdout(`${lines.join("\n")}\n`);
    return EXIT.ok;
  });
}
