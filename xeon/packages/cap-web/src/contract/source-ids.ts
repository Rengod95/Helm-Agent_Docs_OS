import { err, ok, parse, type Result } from "@xeon/contracts";
import { SourceIdSchema, type SourceId } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { WebSessionSourcesPort } from "../ports/session-sources.ts";
import { normalizeUrl } from "./url.ts";

// L2.web.spec §4.2.1. 같은 세션에서 같은 정규화 URL은 같은 sN을 다시 쓰고, 새 URL은 다음 번호를 받는다.

const MAX_SOURCE_NUMBER = 999_999;

export type SourceIdError =
  | { readonly kind: "exhausted" }
  | { readonly kind: "session_read_failed"; readonly cause: string };

/** 세션 하나의 번호 표. 메모리에만 있다 */
export interface SourceIdTable {
  /** 정규화 URL에 번호를 준다. 이미 있으면 같은 번호 */
  idFor(url: string): Result<SourceId, SourceIdError>;
  /** 이전 결과에서 읽은 Source로 표를 채운다. 번호가 틀렸거나 URL이 틀린 항목은 건너뛴다 */
  seed(entries: readonly { readonly id: string; readonly url: string }[]): void;
}

function keyOf(url: string): string {
  const normalized = normalizeUrl(url);
  return normalized.ok ? normalized.value : url;
}

function numberOf(id: SourceId): number {
  return Number.parseInt(id.slice(1), 10);
}

export function createSourceIdTable(): SourceIdTable {
  const byUrl = new Map<string, SourceId>();
  let next = 1;
  return {
    idFor(url) {
      const key = keyOf(url);
      const known = byUrl.get(key);
      if (known !== undefined) return ok(known);
      if (next > MAX_SOURCE_NUMBER) return err({ kind: "exhausted" });
      const parsed = parse(SourceIdSchema, `s${next}`);
      if (!parsed.ok) return err({ kind: "exhausted" });
      next += 1;
      byUrl.set(key, parsed.value);
      return ok(parsed.value);
    },
    seed(entries) {
      for (const entry of entries) {
        const id = parse(SourceIdSchema, entry.id);
        if (!id.ok) continue;
        const key = keyOf(entry.url);
        if (!byUrl.has(key)) byUrl.set(key, id.value);
        next = Math.max(next, numberOf(id.value) + 1);
      }
    },
  };
}

/** 세션별 표 모음. 세션이 없는 호출은 호출마다 새 표를 쓴다(호출 안에서만 s1부터) */
export interface SourceIdRegistry {
  forThread(threadId: ThreadId | undefined): Promise<Result<SourceIdTable, SourceIdError>>;
}

export function createSourceIdRegistry(port: WebSessionSourcesPort): SourceIdRegistry {
  const tables = new Map<ThreadId, SourceIdTable>();
  return {
    async forThread(threadId) {
      if (threadId === undefined) return ok(createSourceIdTable());
      const cached = tables.get(threadId);
      if (cached !== undefined) return ok(cached);
      const recorded = await port.recordedSources(threadId);
      if (!recorded.ok) {
        return err({ kind: "session_read_failed", cause: recorded.error.cause });
      }
      const table = createSourceIdTable();
      // 같은 URL이 여러 finalUrl로 기록된 경우도 같은 번호를 쓴다
      table.seed(recorded.value.map((source) => ({ id: source.id, url: source.url })));
      table.seed(
        recorded.value.flatMap((source) =>
          source.finalUrl === undefined ? [] : [{ id: source.id, url: source.finalUrl }],
        ),
      );
      tables.set(threadId, table);
      return ok(table);
    },
  };
}
