// Turn 다시 보기의 글 표. 모르는 값(meas4가 더할 결과 이름, 새 캐시 원인)은 원문을 그대로 보인다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type {
  CacheEventVM,
  CompositionPart,
  OutcomeKey,
  OutcomeVM,
} from "@fresnel/client/workbench";

const OUTCOME_TEXT: Readonly<Record<OutcomeKey, MessageId>> = {
  ok: "desktop.measure.outcome.ok",
  patched: "desktop.measure.outcome.patched",
  passed: "desktop.measure.outcome.passed",
  blocked: "desktop.measure.outcome.blocked",
  denied: "desktop.measure.outcome.denied",
  failed: "desktop.measure.outcome.failed",
  error: "desktop.measure.outcome.error",
  over_budget: "desktop.measure.outcome.overBudget",
  skipped: "desktop.measure.outcome.skipped",
};

export function outcomeText(outcome: OutcomeVM): string {
  return outcome.key === null ? outcome.raw : t(OUTCOME_TEXT[outcome.key]);
}

const PART_TEXT: Readonly<Record<Exclude<CompositionPart, "section">, MessageId>> = {
  system: "desktop.measure.part.system",
  injected: "desktop.measure.part.injected",
  volatile: "desktop.measure.part.volatile",
  history: "desktop.measure.part.history",
};

export function partText(part: CompositionPart, owner: string | null): string {
  if (part === "section") return owner ?? "";
  return t(PART_TEXT[part]);
}

const CACHE_CODE_TEXT: Readonly<Record<string, MessageId>> = {
  cache_prefix_reset: "desktop.measure.cache.prefixReset",
  cache_reset_model_switch: "desktop.measure.cache.modelSwitch",
  tools_deferred: "desktop.measure.cache.toolsDeferred",
};

const CACHE_OWNER_TEXT: Readonly<Record<string, MessageId>> = {
  "context-hook": "desktop.measure.cache.owner.contextHook",
  model: "desktop.measure.cache.owner.model",
  tools: "desktop.measure.cache.owner.tools",
};

export function cacheCodeText(code: string): string {
  const id = CACHE_CODE_TEXT[code];
  return id === undefined ? code : t(id);
}

export function cacheOwnerText(owner: string): string {
  const id = CACHE_OWNER_TEXT[owner];
  return id === undefined ? owner : t(id);
}

/** 캐시 사건의 "바뀐 부분" 한 줄. 알 수 있는 값만 잇는다 */
export function cacheDetailText(event: CacheEventVM): string {
  const parts: string[] = [];
  if (event.at !== null) parts.push(t("desktop.measure.cache.at", { at: event.at }));
  if (event.from !== "" || event.to !== "") {
    parts.push(t("desktop.measure.cache.model", { from: event.from, to: event.to }));
  }
  if (event.added !== null || event.removed !== null) {
    parts.push(
      t("desktop.measure.cache.tools", { added: event.added ?? 0, removed: event.removed ?? 0 }),
    );
  }
  return parts.join(" · ");
}
