import { parse } from "@xeon/contracts";
import type { EventId, StepId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { BoundaryValue } from "@xeon/contracts/extensions";
import {
  checkEnvelopeSize,
  parseEventKind,
  type CatalogEntry,
  type DurableEventDraft,
} from "@xeon/contracts/records";

// L1.loop.spec §3.6 boundary 최종 검증. 순수 함수다.

export interface BoundaryCheckContext {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  /** 카탈로그·확장 등록에서 kind의 payload 스키마를 찾는다 */
  readonly lookup: (kind: string) => CatalogEntry | undefined;
  /** 이미 커밋된 이벤트 id인지 */
  readonly committed: (id: EventId) => boolean;
  /** 계속을 허용하는 조건(§4.9). false면 continue를 false로 바꾼다 */
  readonly canContinue: boolean;
}

export type BoundaryVerdict =
  | { readonly ok: true; readonly value: BoundaryValue }
  | {
      readonly ok: false;
      readonly value: { readonly entries: readonly []; readonly continue: false };
      readonly issues: readonly string[];
    };

function isCustomItem(entry: DurableEventDraft): boolean {
  if (entry.kind !== "item.recorded") return false;
  const payload = entry.payload;
  if (typeof payload !== "object" || payload === null || !("item" in payload)) return false;
  const item = payload.item;
  return typeof item === "object" && item !== null && "kind" in item && item.kind === "custom";
}

function issuesOf(entry: DurableEventDraft, index: number, ctx: BoundaryCheckContext): string[] {
  const issues: string[] = [];
  const at = `entries[${index}] (${entry.kind})`;
  // 1. kind와 payload 스키마
  const parsed = parseEventKind(entry.kind);
  if (!parsed.ok) {
    issues.push(`${at}: kind is not valid (${parsed.error.kind})`);
    return issues;
  }
  const catalog = ctx.lookup(entry.kind);
  if (catalog === undefined) {
    issues.push(`${at}: no payload schema is registered for the kind`);
  } else {
    const payload = parse(catalog.payload, entry.payload);
    if (!payload.ok) issues.push(`${at}: payload does not match the schema`);
  }
  // 2. 코어 kind는 custom item.recorded만
  if (parsed.value.origin !== "extension" && !isCustomItem(entry)) {
    issues.push(`${at}: only custom item.recorded is allowed among core kinds`);
  }
  // 3. 범위 필드
  if (entry.threadId !== ctx.threadId) issues.push(`${at}: threadId differs from the boundary`);
  // turn_end 페이로드에는 turnId가 없어 핸들러가 null로 둔다. null은 루프가 현재 turn으로 채운다
  if (entry.turnId !== null && entry.turnId !== ctx.turnId) {
    issues.push(`${at}: turnId differs from the boundary`);
  }
  if (entry.stepId !== ctx.stepId) issues.push(`${at}: stepId differs from the boundary`);
  // 타입은 true로 좁혀져 있지만 핸들러 반환값은 실행 때 들어온다. 값으로 다시 본다
  const durable: unknown = Reflect.get(entry, "durable");
  if (durable !== true) issues.push(`${at}: durable must be true`);
  // 4. 이미 커밋된 id
  if (ctx.committed(entry.id)) issues.push(`${at}: id is already committed`);
  // 5. 크기
  const size = checkEnvelopeSize({
    ...entry,
    recordedAt: 0,
    seq: 1,
    parentId: entry.parentId ?? null,
  });
  if (!size.ok) issues.push(`${at}: envelope is larger than ${size.error.limit} bytes`);
  return issues;
}

/**
 * `boundary.step.after`·`boundary.settle.before`의 최종 값을 검증한다. 규칙 하나라도 어기면 값 전체를
 * `{ entries: [], continue: false }`로 바꾸고 `issues`를 돌려준다. `continue`는 규칙을 통과한 뒤에도
 * `canContinue`가 거짓이면 거짓으로 바꾼다(엔트리는 남긴다).
 */
export function finalizeBoundary(value: BoundaryValue, ctx: BoundaryCheckContext): BoundaryVerdict {
  const issues: string[] = [];
  const seen = new Set<EventId>();
  for (const [index, entry] of value.entries.entries()) {
    issues.push(...issuesOf(entry, index, ctx));
    if (seen.has(entry.id)) issues.push(`entries[${index}] (${entry.kind}): duplicate id`);
    seen.add(entry.id);
  }
  if (issues.length > 0) {
    return { ok: false, value: { entries: [], continue: false }, issues };
  }
  return {
    ok: true,
    value: { entries: value.entries, continue: value.continue && ctx.canContinue },
  };
}
