import { attempt, err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { WebSessionSourcesPort } from "../ports/session-sources.ts";

// L2.web.spec §4.6.6. "대화에 나온 URL" 집합: 웹 능력이 돌려준 URL(검색 결과, fetch의 links, 리다이렉트 to)과
// 사용자 입력 텍스트에서 뽑은 URL. 세션별 메모리 집합이고, 재시작 뒤에는 이벤트에서 다시 채운다.

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/;

export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(TRAILING_PUNCTUATION, ""));
}

/**
 * "대화에 나온 URL" 비교 키. 요청이 실제로 나가는 모양 그대로 비교한다: 스킴, 사용자 정보, 호스트(소문자, 기본 포트 제외),
 * 경로와 전체 쿼리(이름 순 정렬, 추적 파라미터도 지우지 않는다). 프래그먼트는 서버로 가지 않으므로 뺀다.
 * 추적 파라미터를 지우는 `normalizeUrl`은 캐시 키 전용이다. 여기서 쓰면 본 URL 뒤에 `?utm_x=<대화 내용>`을 붙여
 * 질문 없이 내보낼 수 있다.
 */
function seenKeyOf(raw: string): string {
  const parsed = attempt(() => new URL(raw));
  if (!parsed.ok) return raw;
  const url = parsed.value;
  const pairs = url.search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part !== "")
    .map((part, index) => ({ part, name: part.split("=", 1)[0] ?? part, index }))
    .toSorted((a, b) => compareText(a.name, b.name) || a.index - b.index);
  const query = pairs.length === 0 ? "" : `?${pairs.map((pair) => pair.part).join("&")}`;
  const user =
    url.username === "" ? "" : `${url.username}${url.password === "" ? "" : `:${url.password}`}@`;
  const host = url.host.replace(/\.(?=$|:)/, "");
  return `${url.protocol}//${user}${host}${url.pathname}${query}`;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const keyOf = seenKeyOf;

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
