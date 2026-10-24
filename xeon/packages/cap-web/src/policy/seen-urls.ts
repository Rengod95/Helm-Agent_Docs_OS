import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { normalizeUrl } from "../contract/url.ts";
import type { WebSessionSourcesPort } from "../ports/session-sources.ts";

// L2.web.spec §4.6.6. "대화에 나온 URL" 집합: 웹 능력이 돌려준 URL(검색 결과, fetch의 links, 리다이렉트 to)과
// 사용자 입력 텍스트에서 뽑은 URL. 세션별 메모리 집합이고, 재시작 뒤에는 이벤트에서 다시 채운다.

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/;

export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(TRAILING_PUNCTUATION, ""));
}

function keyOf(url: string): string {
  const normalized = normalizeUrl(url);
  return normalized.ok ? normalized.value : url;
}

export type SeenUrlsError = { readonly kind: "session_read_failed"; readonly cause: string };

export interface SeenUrls {
  /** 웹 능력이 돌려준 URL이나 사용자 입력 URL을 더한다 */
  note(threadId: ThreadId, urls: readonly string[]): void;
  /** 사용자 입력 텍스트에서 URL을 뽑아 더한다 */
  noteText(threadId: ThreadId, text: string): void;
  has(threadId: ThreadId, url: string): Promise<Result<boolean, SeenUrlsError>>;
}

export function createSeenUrls(port: WebSessionSourcesPort): SeenUrls {
  const sets = new Map<ThreadId, Set<string>>();
  const hydrated = new Set<ThreadId>();

  function setOf(threadId: ThreadId): Set<string> {
    const existing = sets.get(threadId);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    sets.set(threadId, created);
    return created;
  }

  return {
    note(threadId, urls) {
      const set = setOf(threadId);
      for (const url of urls) set.add(keyOf(url));
    },
    noteText(threadId, text) {
      this.note(threadId, extractUrls(text));
    },
    async has(threadId, url) {
      const set = setOf(threadId);
      if (!hydrated.has(threadId)) {
        const recorded = await port.recordedSources(threadId);
        if (!recorded.ok) return err({ kind: "session_read_failed", cause: recorded.error.cause });
        for (const source of recorded.value) {
          set.add(keyOf(source.url));
          if (source.finalUrl !== undefined) set.add(keyOf(source.finalUrl));
        }
        hydrated.add(threadId);
      }
      return ok(set.has(keyOf(url)));
    },
  };
}
