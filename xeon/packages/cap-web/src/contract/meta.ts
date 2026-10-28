import type { Clock } from "@xeon/contracts";
import type { Cost, WebCallMeta, WebProviderFallback } from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";

// L2.web.spec §3.1 WebCallMeta 조립. 호출 ID는 LocalIdFactory로 만든다.

export const NO_COST: Cost = { usd: 0, basis: "free", units: [] };

const MAX_WARNINGS = 16;
const MAX_WARNING_CHARS = 512;
const MAX_FALLBACKS = 8;

export interface MetaInput {
  readonly ids: LocalIdFactory;
  readonly clock: Clock;
  readonly startedAt: number;
  readonly provider: string;
  readonly selectedBy: WebCallMeta["selectedBy"];
  readonly fallbacks: readonly WebProviderFallback[];
  readonly cache: WebCallMeta["cache"];
  readonly cost: Cost;
  readonly warnings: readonly string[];
}

/** 같은 경고는 한 번만, 길이와 개수는 스키마 상한까지 */
export function normalizeWarnings(warnings: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const warning of warnings) {
    const text = warning.slice(0, MAX_WARNING_CHARS);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length === MAX_WARNINGS) break;
  }
  return out;
}

export function buildMeta(input: MetaInput): WebCallMeta {
  return {
    callId: input.ids.next("wcl"),
    provider: input.provider,
    selectedBy: input.selectedBy,
    fallbacks: input.fallbacks.slice(0, MAX_FALLBACKS),
    cache: input.cache,
    latencyMs: Math.max(0, Math.round(input.clock.now() - input.startedAt)),
    cost: input.cost,
    warnings: normalizeWarnings(input.warnings),
    untrusted: true,
  };
}
