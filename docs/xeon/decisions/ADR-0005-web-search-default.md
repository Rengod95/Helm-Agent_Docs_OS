---
id: adr.0005
layer: adr
domain: web-search
kind: adr
status: accepted
depends_on: [adr.0002]
binds: [xeon/packages/cap-web/**]
---

# ADR-0005 무료 웹 검색 기본값: 단계 구성 4개

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] 무료 검색 기본값은 `_research/foundation-plan.md §1` 결정표 6번의 단계 구성을 따른다(`_research/decisions-log.md` 2026-10-21 결정(3차) "무료 검색 기본값은 foundation-plan.md 1절 6번").
- [결정] 웹의 유료 API는 사용자가 플러그인으로 등록하고, 기본값은 로컬 도구로 둔다(`_research/decisions-log.md` 2026-10-21 결정(2차)).
- 개정: 2026-10-25, 사용자 결정 H1(`review.m2-plan` §9). SearXNG 자동 감지를 없애고 사용자가 설정한 provider만 체인에 넣는다. 고친 절: §3.1 ③·④ 행, §3.3, §4.2, §5, §6 미결 1·3. ① 모델용 도구와 ② 내장 검색 래퍼 기본값은 그대로다.
- 범위: 이 ADR은 웹 **검색**의 기본 provider와 선택 순서만 정한다. 브라우저 자동화(`web.browse`)와 본문 가져오기(`web.fetch`)는 범위 밖이다. 참고로 기본 `web.browse`는 Playwright(`playwright-core`)이고 agent-browser는 내장 선택 provider다(`_research/layer-plan-v2-notes.md` "질문에 대한 답" 웹 기본값 항목).

## 2. 맥락

### 2.1 요구

- 검색은 브라우저와 다른 문제이고, 무료로 쓸 만한 검색 API가 드물다(`_research/layer-plan-v2-notes.md` "질문에 대한 답" 웹 기본값 항목).
- 검색을 쓰는 경로는 둘이다.
  - 모델용 도구: 모델이 대화 중에 검색을 부른다.
  - 서비스 API `web.search`: L3 그룹 코드(Helm, 학습 그룹)가 모델 턴 밖에서 직접 호출한다. 예를 들어 Helm의 `drive` 함수가 탐색 결과를 모아 상태에 커밋하기 전에 검색을 호출한다(ADR-0007 `./ADR-0007-ext-points.md`).
- L3 그룹은 L2 능력의 정의(F3)만 참조하고 provider 구현을 참조하지 않는다(`_research/layer-plan-v2-notes.md` "층 사이 규칙" 2번). 그래서 `web.search`는 provider를 교체할 수 있는 서비스여야 한다. 서비스 등록과 주입은 Cordis가 맡는다(ADR-0002 `./ADR-0002-di-cordis.md`).
- 이전 메모는 Exa를 기본 검색 provider로 권장했다(`_research/web-tools.md §1.1`, `_research/decisions-log.md` 2026-10-21 "웹 도구는 최신 provider 위주(Exa 기본, ...)"). 이후 2차 결정이 "유료 API는 플러그인, 기본은 로컬 도구"로 바꾸었으므로 Exa는 기본값에서 빠지고 플러그인 후보로 남는다.

### 2.2 모델 내장 검색 3종

확인한 세 provider의 내장 검색은 모두 모델 요청 안에서만 실행된다. 검색만 따로 부르는 API는 확인되지 않았다(`_research/durable-and-search-facts.md §B-1`, `§B-5` 1번).

| 항목 | Anthropic `web_search` | OpenAI web search | Gemini google_search grounding | 출처 |
|---|---|---|---|---|
| 가격 | 검색 1,000건당 $10 + 결과 토큰(표준 단가) | 호출 1,000건당 $10 + 검색 콘텐츠 토큰. 비추론 preview는 $25/1k | Gemini 3 이상은 월 5,000건 무료 후 $14/1k [요약] | `§B-1` |
| 실행 위치 | Messages 요청 안의 서버 도구 | 확인 범위에 검색 전용 API 없음 [미확인] | 확인 범위에 검색 전용 API 없음 [요약] | `§B-1` |
| 결과 형식 | `web_search_tool_result`(url, title, page_age, encrypted_content), 인용 `web_search_result_location`(cited_text 150자 이하) | `url_citation` 주석 [요약] | 자료 간 상충(§6 참조) | `§B-1` |
| 운영 제약 | 조직 관리자가 콘솔에서 끌 수 있고, 꺼져 있으면 400. `max_uses`, 도메인 필터, `pause_turn` 처리 필요. 실패 시 과금 없음 | — | — | `§B-1` |
| 구독 OAuth 경로 | [미확인] | [미확인] | [미확인] | `§B-1`, `§B-6` |

### 2.3 키 없는 선택지와 무료 크레딧

- 키 없이 쓸 수 있는 기본값 후보는 자가 호스팅 SearXNG 하나다(`_research/durable-and-search-facts.md §B-5` 5번).
  - 라이선스는 AGPL-3.0이다(`§B-2`, GitHub LICENSE 확인).
  - JSON 응답은 `settings.yml`의 `search:` 절에서 켜야 하고, 꺼져 있으면 `format=json` 요청이 403이다. 공개 인스턴스는 이 형식을 꺼 둔 경우가 많다(`§B-2`).
  - 설치 문서는 Docker 또는 Podman을 요구한다(`§B-2`).
- 무료 크레딧 API는 월 1,000~2,500건 규모다(`_research/durable-and-search-facts.md §B-4`). 모두 키가 필요하다.

## 3. 결정

### 3.1 단계 구성

[결정] 아래 네 단계를 그대로 쓴다(`_research/foundation-plan.md §1` 결정표 6번).

| 단계 | 쓰임 | 기본 동작 | 설정 | 근거 |
|---|---|---|---|---|
| ① 모델용 도구 | 모델이 대화 중 검색 | 현재 모델 provider의 내장 검색을 그대로 노출한다 | 필요 없음 | `foundation-plan.md §1` 6번 ①, `durable-and-search-facts.md §B-1` |
| ② 서비스 API `web.search` | L3 그룹 코드가 모델 턴 밖에서 호출 | 기본 provider는 "내장 검색 래퍼"다. 소형 모델에 내장 검색 도구 하나만 주고 한 턴 요청한다. 1회 약 $0.011(아래 3.2 산식) | 필요 없음(모델 provider 키만) | `foundation-plan.md §1` 6번 ②, `durable-and-search-facts.md §B-5` 1·2번 |
| ③ 설정한 SearXNG | ②의 provider 교체 | 사용자가 SearXNG 주소를 설정했을 때만 래퍼보다 먼저 쓴다. 자동 감지는 하지 않는다(2026-10-25 개정, H1). 무료이고 키가 필요 없다 | SearXNG 주소(필수) | `foundation-plan.md §1` 6번 ③, `durable-and-search-facts.md §B-2`, `review.m2-plan` §9 H1 |
| ④ 무료 크레딧 API 플러그인 | ②의 provider 교체 | 사용자가 키를 등록한 플러그인만 체인에 들어간다. 첫 실행 설정에서 플러그인 등록을 권장한다. Exa는 월 $10 크레딧으로 Lite 2,500건, Brave는 월 $5 크레딧으로 약 1,000건(산술 추정) | 키 등록(`secret://` 참조) | `foundation-plan.md §1` 6번 ④, `durable-and-search-facts.md §B-4` |
| 제외 | — | 키 없는 DuckDuckGo 스크레이핑은 지원하지 않는다. 약관 위반 위험이 있다 | — | `foundation-plan.md §1` 6번, `durable-and-search-facts.md §B-3`, `web-tools.md §5.1` 스크레이퍼형 검색 행 |

- [가정] SearXNG를 수정하지 않고 별도 프로세스로 띄워 HTTP API만 호출하면 AGPL-3.0 §13의 소스 제공 의무가 생기지 않는다. 이 해석은 2차 요약이고 gnu.org 원문은 429로 열지 못했다(`_research/durable-and-search-facts.md §B-2`). 공개 릴리즈 전에 법률 확인이 필요하다. 그 전까지 SearXNG 코드를 번들하거나 링크하지 않는다(`_research/web-tools.md §5.1` SearXNG AGPL 행).

### 3.2 내장 검색 래퍼 비용 산식

[결정] 래퍼 1회 비용은 약 $0.011로 본다(`_research/foundation-plan.md §1` 6번 ②). 산식은 다음과 같다(`_research/durable-and-search-facts.md §B-5` 2번).

| 항목 | 가정 값 | 단가 | 금액 | 출처 |
|---|---|---|---|---|
| 검색 수수료 | 1건 | $10/1,000건 | $0.010 | `§B-1` Anthropic 가격 |
| 입력 토큰(검색 결과 포함) | 약 10,000 | Haiku 5.5 $0.10/MTok(10만 토큰 이하) | $0.001 | `§B-1` Haiku 5.5 단가 |
| 출력 토큰 | 약 500 | Haiku 5.5 $0.50/MTok | $0.00025 | `§B-1` Haiku 5.5 단가 |
| 합계 | | | 약 $0.011 | `§B-5` 2번 |

- [가정] 토큰 수는 측정하지 않은 추정이다(`§B-5` 2번 [추정]). M2 이후 계측 값으로 바꾼다.
- 비용의 대부분은 검색 수수료다. 직접 검색 API(Brave $5/1k, Exa Lite $4/1k)가 래퍼의 $10/1k 수수료보다 싸다(`§B-5` 4번). 그래서 ④를 첫 실행에서 권장한다.

### 3.3 provider 선택 순서

[제안] `web.search` 호출의 provider는 다음 순서로 고른다. 설정 `l2.web.search.provider`의 기본값은 `"auto"`다.

1. 호출 인자 `provider`가 있으면 그 provider를 쓴다(`_research/web-tools.md §4.2` 입력 `provider?`).
2. 설정 `l2.web.search.provider`가 `"auto"`가 아니면 그 provider를 쓴다.
3. `"auto"`이면 사용자가 키를 등록한 플러그인(④)을 `l2.web.search.pluginOrder` 순으로 쓴다.
4. 플러그인이 없거나 모두 실패하면, 사용자가 `l2.web.search.searxng.url`을 설정한 경우에만 SearXNG(③)를 쓴다.
5. 둘 다 없으면 내장 검색 래퍼(②)를 쓴다.

- [결정] 체인에는 사용자가 설정한 provider만 들어간다. 주소 탐침으로 SearXNG를 찾는 자동 감지는 없다(사용자 결정 H1, 2026-10-25, `review.m2-plan` §9). 감지 설정 `l2.web.search.searxng.detect`도 없앤다. 키 정의와 코드 변경은 `L2.web.spec` §4.8.3과 cap-web이 맡는다.
- 감지를 없애는 이유는 세 가지다.
  - 탐침 요청에 실제 검색어가 들어가 상위 검색 엔진으로 나간다(`L2.web.spec` §4.8.3).
  - 기본 경로가 로컬 서버 기동 여부에 달려 실패가 사용자에게 보이지 않는다. JSON 형식이 꺼져 있으면 403으로 실패한다.
  - 2026-10-24 웹 검색 조사에서 Claude Code, Codex CLI, Gemini CLI, OpenCode 등 조사한 런타임 중 SearXNG를 기본값으로 쓰는 곳은 없었다. 모두 모델 제공자의 호스티드 검색을 기본으로 둔다(`review.m2-plan` §9 H1 근거).
- 3번과 4번의 순서는 `foundation-plan.md §1` 6번에 명시되어 있지 않다. 둘 다 사용자 설정이므로 이 순서는 작성자 제안이다([미결] §6).
- 앞 provider가 `isAvailable`에서 실패하면 다음 provider로 내려간다. 실패 사유는 응답 `meta.fallbacks`에 남긴다.

### 3.4 인터페이스 초안

[제안] 아래 타입은 이 ADR이 요구하는 최소 형태다. 최종 이름과 필드는 `L2.web.spec`과 F3(`xeon/packages/contracts/src/capabilities`)이 정한다. 요청·결과 필드는 `_research/web-tools.md §4.2`를 따른다.

```ts
import { Type, type Static } from "typebox";

export const WebSearchProviderId = Type.Union([
  Type.Literal("builtin-wrapper"),
  Type.Literal("searxng"),
  Type.TemplateLiteral("plugin:${string}"),
]);
export type WebSearchProviderId = Static<typeof WebSearchProviderId>;

export const ProviderUnavailableReason = Type.Union([
  Type.Literal("no-key"),            // ④ 키 미등록
  Type.Literal("unreachable"),       // ③ 주소 응답 없음
  Type.Literal("json-disabled"),     // ③ format=json 403
  Type.Literal("org-disabled"),      // ② Anthropic web_search 400(조직 관리자 차단)
  Type.Literal("unsupported-model"), // ② 현재 provider·모델에 내장 검색 없음
]);
export type ProviderUnavailableReason = Static<typeof ProviderUnavailableReason>;

export type ProviderAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ProviderUnavailableReason };

export interface WebSearchProvider {
  readonly id: WebSearchProviderId;
  isAvailable(signal: AbortSignal): Promise<ProviderAvailability>;
  search(request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult>;
}
```

- `WebSearchRequest`, `WebSearchResult`는 `_research/web-tools.md §4.2`의 입력·출력(`query`, `limit`, `recency`, `domains`, `content`, `provider`, `results`, `answer`, `meta`)을 TypeBox로 옮긴 것이다. 정의는 `L2.web.spec`에 둔다.
- [제안] 래퍼 provider는 `pause_turn` 응답을 받으면 같은 대화를 이어 다시 요청한다. 재요청 상한은 설정 `l2.web.search.wrapper.maxContinuations`(기본 3)로 둔다. 상한을 넘으면 그때까지 받은 결과만 돌려준다(`_research/durable-and-search-facts.md §B-1` 오류/흐름 행, `§B-5` 3번).

### 3.5 설정 노출

- [제안] F5 설정 키: `l2.web.search.provider`(`"auto"` 또는 `WebSearchProviderId`), `l2.web.search.searxng.url`, `l2.web.search.wrapper.model`, `l2.web.search.wrapper.maxContinuations`. 범위는 사용자·프로젝트다(`_research/settings.md §2.10` 웹 검색과 가져오기 제공자 행). 키 이름과 기본값의 정본은 `L2.web.spec` §6이다. 키 플러그인 우선순위는 `l2.web.search.pluginOrder`다.
- 첫 실행 권장 화면(검색 provider 상태, SearXNG 주소 입력, ④ 권장 목록)은 M3 L4 설정 화면에 두고, ①~③은 M2에 동작한다(`product.scope.spec` I10).
- L4 설정 노출: `L4.settings-ui.spec`의 "도구와 웹" 탭에 검색 provider 선택(auto 또는 고정)과 플러그인 등록(키는 `secret://` 참조)을 둔다(`_research/layer-plan-v2-notes.md` "L4 설정 화면 구성안" 도구와 웹 행).

## 4. 결과

### 4.1 좋은 점

- 설정 없이 동작한다. ①은 모델 provider의 기본 기능이고 ②는 모델 provider 키만 있으면 된다.
- L3 그룹 코드가 모델 턴 밖에서 `web.search`를 호출할 수 있다. 내장 검색만으로는 이 조건을 만족하지 못한다(`_research/durable-and-search-facts.md §B-5` 1번).
- 유료 검색 키에 의존하지 않는다. 사용자 결정(2차)과 맞는다.
- provider 교체가 설정 한 줄이다. 검색 품질 순위는 벤치마크마다 다르고 단일 승자가 없으므로 교체 가능성이 설계의 핵심이다(`_research/web-tools.md §1.2` 1번).

### 4.2 감수할 점

- 래퍼 비용과 지연을 측정하지 않았다. 비용은 추정이고 지연은 공식 수치가 없다(`_research/durable-and-search-facts.md §B-5` 2·3번).
- 래퍼에 `pause_turn` 재요청 루프가 필요하다(`§B-5` 3번).
- 구독 OAuth 경로에서 내장 검색을 쓸 수 있는지 확인하지 않았다(`§B-1`, `§B-6`). 위장 provider는 배포판에서 빠지므로(`_research/decisions-log.md` 2차) 배포판 기본 경로는 API 키 경로다.
- SearXNG를 설정하지 않은 사용자는 래퍼 경로(②)를 쓴다. 검색 1회마다 모델 호출 비용이 든다(§3.2).
- SearXNG 운영 부담이 있다. Docker 또는 Podman 설치, `format=json` 활성화(꺼져 있으면 403), 상위 엔진 차단 대응이 필요하다(`§B-2`, `§B-5` 5번). 엔진 차단과 레이트 리밋 세부는 [미확인]이다.
- 조직 관리자가 Anthropic `web_search`를 끄면 요청이 400으로 실패한다(`§B-1` 운영 제약 행). 이 경우 ①은 동작하지 않고 ②는 다음 provider로 내려간다.
- 래퍼 결과의 `encrypted_content`는 Anthropic 대화 밖에서 재사용할 수 없다. 서비스 API 결과에는 url, title, 인용 발췌만 담는다(`_research/web-tools.md §2.2` Anthropic web_search 행).

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| SearXNG만 기본 | 키 없는 유일한 선택지를 기본으로 둔다 | 보조(③) | Docker·Podman과 JSON 활성화 없이는 동작하지 않는다. 설치 직후 상태에서 검색이 실패한다(`durable-and-search-facts.md §B-2`, `§B-5` 5번) |
| SearXNG 자동 감지(개정 전 ③) | 루프백 주소를 탐침해 SearXNG가 있으면 래퍼보다 먼저 쓴다 | 제외(2026-10-25 개정) | 탐침이 실제 검색어를 상위 엔진으로 보내고, 실패가 사용자에게 보이지 않는다. 조사한 런타임 중 기본값으로 쓰는 곳이 없다(§3.3, 사용자 결정 H1) |
| 직접 API를 기본 | Brave $5/1k(`§B-4`), Exa Lite $4/1k(`§B-4`), Tavily 종량 $0.008/크레딧(`§B-4`), Serper 가입 시 2,500쿼리(`§B-4`, 2차 출처) | 보조(④ 플러그인) | 모두 키가 필요하다. 유료 API는 플러그인으로 둔다는 사용자 결정(2차)과 맞지 않는다. Tavily는 Nebius 인수로 방향이 불확실하고(`web-tools.md §1.2` 2번), Serper는 Google SERP 스크레이핑 계열이라 법적 위험이 있다(`web-tools.md §1.2` 5번) |
| DuckDuckGo 스크레이핑 | 키 없이 HTML을 긁는다 | 제외 | 공식 검색 API 문서를 찾지 못했고 약관 위반 위험이 있다(`§B-3`, `web-tools.md §5.1`) |
| Mojeek | 키 필요, 유료 CPM £1~3/1k, 일일 상한 2,000~400,000건 | 플러그인 후보 | 무료 한도를 찾지 못했다. 2차 요약이고 공식 URL은 404다(`§B-3`) |
| Marginalia | 이메일로 키 요청, 비상업 키 무료(CC-BY-NC-SA 4.0) | 플러그인 후보 | 상업 용도는 유료 키가 필요하다. 공개 릴리즈 기본값으로 쓸 수 없다(`§B-3`, `§B-5` 6번) |
| Jina `s.jina.ai` | 토큰제, 키 선택 또는 필수 | 선택 provider | 키 정책이 자료 사이에서 상충한다(`§B-3`, `web-tools.md §2.1`). 라이선스 판매가 Elastic으로 넘어갔다(`web-tools.md §1.2` 3번) |
| 내장 검색만 | ①만 두고 서비스 API는 만들지 않는다 | ①로만 채택 | 모델 턴 밖에서 호출할 수 없다(`§B-5` 1번). L3 그룹 요구를 만족하지 못한다 |

## 6. 미결 사항

- [미결] provider 선택 순서에서 등록된 키 플러그인과 설정한 SearXNG 중 무엇을 먼저 쓸지(§3.3 3·4번). 작성자 제안은 플러그인 우선이다.
- [미결] Parallel(월 5,000회 무료 + 월 $5, `_research/web-tools.md §2.1`)을 ④의 첫 실행 권장 목록에 넣을지. `foundation-plan.md §1` 6번은 Exa와 Brave만 적었다.
- [가정] SearXNG를 수정 없이 별도 프로세스로 쓰면 AGPL 배포 의무가 없다. 2차 요약이며 법률 확인이 필요하다(`durable-and-search-facts.md §B-2`).
- [가정] 래퍼 1회 약 $0.011은 토큰 수 미측정 추정이다(`§B-5` 2번).
- [미결] 래퍼 지연 수치. 공식 수치가 없다(`§B-5` 3번, `§B-6`).
- [미결] 구독 OAuth 경로에서 세 provider의 내장 검색 가능 여부(`§B-6`).
- [미결] Gemini 응답 형식. WebFetch 요약은 steps와 url_citation이라고 하고, `web-tools.md §2.2`는 groundingMetadata라고 적는다. 원문 대조 전에는 Gemini 결과 정규화를 구현하지 않는다(`durable-and-search-facts.md` "상충과 확인 필요 항목").
- [미결] Gemini 지원 모델 목록 원문 대조(`§B-6`).
- [미결] Jina 키 정책. 기존 메모는 키 없이 차단된다고 하고 홈페이지는 키가 상위 한도용이라고 한다(`durable-and-search-facts.md` "상충과 확인 필요 항목").
- [미결] Brave 무료 크레딧. 본문은 월 $5, 머리말은 "Up to $20"이다. 약 1,000건은 $5 기준 산술 추정이다(`§B-4`).
- [가정] Serper 가입 시 2,500쿼리는 2차 출처이고 공식 가격 페이지는 404다(`§B-4`).
- [미결] SearXNG 엔진 차단·레이트 리밋 세부와 메모리 요구(`§B-2`, `§B-6`).
- [미결] DuckDuckGo 약관 전문, Mojeek 무료 한도, Marginalia 공식 페이지(`§B-6`).
