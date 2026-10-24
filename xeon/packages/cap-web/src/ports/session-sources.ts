import type { ThreadId } from "@xeon/contracts/conversation";

/** 세션의 이전 웹 도구 결과가 실은 Source 한 건. 번호 할당기와 "나온 URL" 집합을 다시 채우는 데 쓴다 */
export interface RecordedSource {
  readonly id: string;
  readonly url: string;
  readonly finalUrl?: string;
}

/** 읽기 포트 실패. 예상 가능한 실패라 값으로 돌려준다 */
export type SessionSourcesError = { readonly kind: "read_failed"; readonly cause: string };

/**
 * L2.web.spec §4.2.1. 그 세션의 웹 도구 결과(`tool.settled`의 `structuredContent.sources`)를 이벤트에서 읽는다.
 * 구현은 HOST 조립이 `xeon.session`의 type 필터 읽기로 만든다. cap-web은 이 모양만 안다(m2-plan §3 6번).
 */
export interface WebSessionSourcesPort {
  recordedSources(
    threadId: ThreadId,
  ): Promise<
    | { readonly ok: true; readonly value: readonly RecordedSource[] }
    | { readonly ok: false; readonly error: SessionSourcesError }
  >;
}
