---
id: L2.web.plan
layer: L2
domain: web
kind: plan
status: draft
depends_on: [L2.web.spec, F.capabilities.plan, L1.models.plan, L0.secrets.plan, L0.store.plan]
binds: [xeon/packages/cap-web/**]
---

# L2 웹 능력 구현 계획 (web)

## 1. 목표와 마일스톤 배치

목표: `L2.web.spec`의 네 능력 중 1차 구성요소(`web.search`, `web.fetch`, `web.browse`의 playwright-core provider, 공통 웹 계약)를 첫 사용 버전(M3 종료)까지 만든다. M2 종료 조건 중 웹 항목 "`web.search`가 SearXNG를 감지하면 SearXNG를 쓰고, 없으면 내장 검색 래퍼를 쓴다"(`product.scope.spec` §4.4 M2)를 M2에서 만족한다.

### 1.1 M0·M1·M2

| 마일스톤 | 웹 범위 | 근거 |
|---|---|---|
| M0 | 없음. `cap-web` 스캐폴드(`package.json`의 `xeon` 필드, 빈 `src/index.ts`)는 이미 있다 | `_research/foundation-plan.md` §5 P4 M0 |
| M1 | 없음. 웹은 M1 걸어 다니는 골격 범위 밖이다 | `product.scope.spec` §4.3 M1, `_research/foundation-plan.md` §5 P4 "L2 웹·MCP는 스캐폴드까지만" |
| M2 전반 | 공통 웹 계약(B2~B5), `web.fetch`(B6), `web.search` 단계 구성(B7~B9), 설정 키(B11) | `product.scope.spec` §4.1 I10, §4.4 M2 종료 조건 |
| M2 후반 ~ M3 초입 [제안] | `web.browse` playwright-core provider(B10) | 아래 1.2 |

### 1.2 `web.browse`의 배치 근거

[제안] B10은 M2 후반에 시작하고, Bun 호환 스모크 결과에 따라 M3 초입까지 끝낸다.

- `_research/layer-plan-v2.json` L2-c는 `web.browse` 기본(playwright-core)을 1차로 둔다. 1차는 첫 사용 버전(M3 종료)에 들어가야 한다(`product.scope.spec` §2). 그래서 M3 끝을 넘길 수 없다.
- M2 종료 조건에는 browse 항목이 없다(`product.scope.spec` §4.4 M2). M2의 웹 필수 항목은 검색 단계 구성이고, fetch의 승격 경로는 browse 없이도 플러그인 provider나 `empty_content` 경고로 동작한다(`L2.web.spec` §4.9.1 6단계). 그래서 B10을 M2 앞쪽에 둘 이유가 없다.
- playwright-core의 Bun 1.4 동작은 실행 확인이 없다(`_research/notes/L2-2.md` §1). Bun 경로가 실패하면 Node 자식 우회(B10의 두 번째 절반)가 필요하고 `xeon.process`(L0.process)에 의존한다. 이 위험(`product.scope.spec` R3, M2)을 M2 안에서 판정하되, 우회 구현이 길어지면 M3 초입으로 넘기는 여유를 둔다.
- Helm(M2)은 `web.search`, `web.fetch`만 `requires`로 쓴다(`L3.helm.spec` §3.8). browse가 늦어도 Helm M2 종료 조건에 영향이 없다.

### 1.3 M3 이후

| 항목 | 마일스톤 | 내용 | 근거 |
|---|---|---|---|
| 첫 실행 권장 흐름(L4 연계) | M3 | 설정 화면 "도구와 웹"(`tools` 탭)에 검색 provider 상태(`isAvailable` 결과), SearXNG 주소 입력, 키 플러그인 설치·키 등록 권장을 둔다. 권장 목록은 Exa, Brave(ADR-0005 §3.1 ④). 키는 `secret://` 참조로만 저장한다 | ADR-0005 §3.5, `product.scope.spec` §4.1 I14(설정 화면 M3), `L4.settings-ui.spec` |
| `xeon/plugins/web-exa` | M3 | `web.search`(Exa search), `web.fetch`(Exa contents) provider. REST 직접 호출 | `_research/packages.md` §4.4 L2-c |
| `xeon/plugins/web-brave` | M3 | `web.search` provider. 매니페스트 `cachePolicy: "none"` | `_research/web-tools.md` §5.1 Brave 행 |
| `xeon/plugins/web-parallel` | 2차 | `web.search`, `web.fetch`(Extract) provider | `_research/web-tools.md` §1.1, ADR-0005 §6 Parallel 권장 [미결] |
| `xeon/plugins/web-firecrawl` | 2차 | `web.fetch` 승격 provider. SDK(MIT)만 쓰고 AGPL 서버 코드는 링크하지 않는다 | `_research/web-tools.md` §5.1 Firecrawl 행 |
| B12 `agent-browser` provider | 2차 | 네이티브 바이너리 직접 호출 | `_research/layer-plan-v2.json` L2-c 2차 |
| B13 `web.research` | 2차 | native 루프, 인용 검증, 상태 머신 | `_research/layer-plan-v2.json` L2-c 2차 |
| fetch `extract` 옵션(소형 모델 요약) | 2차 | `web.fetch` 1.1.0 | `L2.web.spec` §3.3 |
| 선택 엔진 플러그인(Stagehand, moli) | 보류 | — | `_research/layer-plan-v2.json` L2-c |
| Lightpanda | 제외 | AGPL이라 배포판에서 뺀다 | 같음 |

- 플러그인 패키지는 `xeon/plugins/web-<이름>/`에 둔다. [결정: review.decisions-2 U-16] `plugins/*`는 L1 순위다. 각 패키지의 `package.json`은 `"xeon": { "layer": "L1", "domain": "web" }`이고 F(`@xeon/contracts`), X, L0, 외부 패키지만 import한다. `cap-web`과 `core-*`는 import하지 않는다(DR-02, DR-09). 확장 매니페스트의 `layer: "plugin"`(`F.extensions.spec` `ExtensionLayerSchema`)은 매니페스트 값이고 패키지 순위와 별개다. [제안] `_routing/routes.yaml` `layout.plugins`에 `{ path: "xeon/plugins/web-*/**", docs: [L2.web.spec] }` 행을 더하도록 요청한다.
- 플러그인은 배포판에 기본 포함하되 기본 꺼짐으로 둘지, 별도 설치로 둘지는 [미결]이다(§7 위험 표, `L2.web.spec` §10).

## 2. 패키지와 파일 배치

`L2.readme` §3 공통 골격을 따른다.

```
xeon/packages/contracts/src/capabilities/
  provider.ts                 # F.capabilities.spec §3.11 공통 provider 타입(F.capabilities.plan 소유. 다른 L2 plan과 공유)
  defs/web.ts                 # B1: 4개 능력 정의, 공통 웹 계약 스키마, ServiceKey, WebService
  defs/web-provider.ts        # B1: WebProviderManifest, provider 인터페이스, GuardedHttp

xeon/packages/cap-web/
  package.json                # "xeon": { "layer": "L2", "domain": "web" }
  src/
    index.ts                  # 엔트리: manifest, apply(ctx)
    manifest.ts               # provides: web.search, web.fetch, web.browse (research는 2차)
    service.ts                # xeon.web 앞단 조립(WebService)
    settings.ts               # defineSettings("l2.web", …)  B11
    contract/                 # B2
      source-ids.ts           #   세션별 sN 할당기
      url.ts                  #   URL 정규화(순수)
      render.ts               #   renderSearch, renderFetch, renderBrowse, renderResearch, wrapUntrusted
      redact.ts               #   redactForPersistence
      meta.ts                 #   WebCallMeta 조립
    policy/                   # B3
      domain.ts               #   isDomainPattern, matchDomain, resolveDomainPolicy
      ssrf.ts                 #   URL 검사, IP 범위 표, 메타데이터 목록
      robots.ts               #   robots.txt 파서와 24시간 캐시
      guarded-http.ts         #   GuardedHttp 구현(guarded-fetch 연결, endpoints, 비밀 헤더 치환)
      seen-urls.ts            #   세션별 "나온 URL" 집합
    cache/                    # B4
      single-flight.ts
      search-memo.ts          #   LRU + TTL
      fetch-cache.ts          #   cap_web_fetch_cache, cap_web_raw
      migrations/0001_cap_web.sql
    cost/                     # B5
      pricing.ts              #   내장 provider 가격표(asOf, sourceUrl)
      meter.ts                #   reported/estimated/free 계산, cap_web_usage
      limits.ts               #   세션당 호출 상한
    fetch/                    # B6
      pipeline.ts             #   정책 → 캐시 → 협상 → 추출 → 승격 → 저장 → 절단
      local-provider.ts       #   ProviderId "local"
      promote.ts
      raw-read.ts             #   rawRef 재조회
      convert/                #   WEB-R16 영역: 네트워크 금지 lint override
        convert.ts            #     convert(input): ConvertResult (동기 순수)
        readability.ts
        defuddle.ts
        turndown.ts
        sanitize.ts           #     숨은 요소·주석·리소스 태그 제거
      convert-worker.ts       #   Worker 시작 코드: 전역 네트워크 API 제거 뒤 convert import
    search/                   # B7~B9
      chain.ts                #   orderProviderCandidates 호출, 탐침 캐시, fallback 기록
      query.ts                #   parseSearchQuery, 후처리 필터, relaxed
      model-tool.ts           #   decideModelSearchTool, normalizeHostedSearch
      providers/
        searxng.ts            #   B8
        builtin-wrapper.ts    #   B9
    browse/                   # B10 (B12는 2차)
      session-manager.ts      #   sessionId, 상한, session_shutdown 정리
      proxy.ts                #   루프백 필터 프록시
      confirm.ts              #   사람 확인 어휘 표, 판정
      providers/
        playwright-local.ts   #   Bun 경로
        playwright-node/      #   Node 24 자식 중계(server.mjs + client.ts)
        agent-browser.ts      #   2차
    research/                 # B13 (2차)
      loop.ts
      verify.ts
      state.ts
    testing/                  # 공용 가짜(TS-06)
      http-fixtures.ts        #   녹화 HTTP 픽스처 재생 transport
      fake-resolver.ts        #   DNS 응답 표(리바인딩 시나리오 포함)
      fake-providers.ts       #   매니페스트를 받는 가짜 검색·fetch provider
  test/
    fixtures/http/*.json      #   녹화 HTTP 응답
    fixtures/html/*.html      #   변환 픽스처
    fixtures/tapes/*.json     #   래퍼용 모델 테이프(TS-04)
    *.test.ts

xeon/plugins/web-exa/  web-brave/      # M3 (§1.3)
```

- `fetch/convert/**`는 `L2.web.spec` §4.9.3 WEB-R16 영역이다. `.oxlintrc.json` `overrides`와 `scripts/check-layers.ts`의 `SourcePattern`이 이 경로를 대상으로 한다.
- 마이그레이션 파일 위치와 적용 방식은 `L0.store.plan`의 접두사별 마이그레이션 규칙을 따른다 [가정: `L0.store.plan`이 `cap-*` 패키지의 `migrations/` 디렉터리를 읽는다].
- `playwright-node/server.mjs`는 Node 24에서 도는 JS 파일이다. TypeScript 빌드 대상 밖이고 `xeon.process`로 실행한다.

## 3. 작업 분해

규모: S(1일 이하), M(2~3일), L(4~6일).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| B1 | F `defs/web.ts`, `defs/web-provider.ts` 추가. 4개 능력 정의(`WebSearch`, `WebFetch`, `WebBrowse`, `WebResearch`)와 ServiceKey, 서비스 묶음 `WebService`·`WebServiceName`·`WEB_CAPABILITIES`(spec §3.9), 공통 스키마, provider 인터페이스. `validateCapability` 이슈 0건 테스트. F `provider.ts`(L2.readme §5.2)가 없으면 같은 변경에서 만든다 | F.capabilities.plan의 `defineCapability`·`validateCapability` | M | M2 |
| B2 | 공통 계약: `Source`/`Passage`/`Cost`/`WebCallMeta` 조립, URL 정규화, 세션별 `sN` 할당기, `wrapUntrusted`, 렌더러, `redactForPersistence` | B1 | M | M2 |
| B3 | 도메인 정책(문법, 범위 합집합, deny>ask>allow, 승인 요청), SSRF(URL 검사, IP 범위, 메타데이터, 리다이렉트 재검사), robots.txt, `GuardedHttp`(guarded-fetch 연결, endpoints, 비밀 헤더 치환), "나온 URL" 집합. guarded-fetch 0.1.6 소스를 읽어 연결 시점 재검증과 검증 IP 다이얼 여부를 확인하고, 없으면 request-filtering-agent로 바꾼다 | B2 | L | M2 |
| B4 | 캐시 3계층: single-flight, 메모리 검색 메모(LRU 500, TTL), 디스크 fetch 캐시(`cap_web_fetch_cache`, `cap_web_raw`, 마이그레이션), cachePolicy별 저장 규칙, 크기 상한 정리, session rawRef 정리 | B2, L0.store.plan의 `scoped`·`putBlob` | M | M2 |
| B5 | 비용 계측: reported/estimated/free, `cap_web_usage`, 월 무료 한도 경고, 가격표 asOf 90일 검사(`just web-pricing` 레시피, `just verify`에서 경고만), 세션당 호출 상한 | B2, B4(테이블) | M | M2 |
| B6 | fetch 파이프라인: 협상 Markdown, 변환 모듈(readability+linkedom+turndown, defuddle), Worker, 승격(플러그인 후보, 브라우저는 B10 뒤 연결), 저장, 절단, rawRef 재조회, `urls` 일괄. WEB-R16 lint override와 check-layers 패턴 | B3, B4, B5 | L | M2 |
| B7 | search provider 레지스트리와 선택 체인: X 후보 조회, `orderProviderCandidates`, 탐침 캐시, fallback 기록, 명시 선택 규칙, 쿼리 지시어 파서와 후처리 필터, `relaxed`, `decideModelSearchTool` | B3, B4, B5, X.primitives.plan의 후보 등록 API | M | M2 |
| B8 | SearXNG 감지와 provider: 주소 후보, `format=json` 탐침, 403 → `json-disabled`, 결과 정규화, endpoint 예외 | B7 | S | M2 |
| B9 | 내장 검색 래퍼: `HostedSearchPort` 사용, `pause_turn` 재요청 루프(상한 3), 결과 정규화(`encrypted_content` 제외), `unsupported-model`·`org-disabled` 탐침, 비용 계산, 모델 테이프 테스트. `normalizeHostedSearch` | B7, L1.models.plan의 `HostedSearchPort` | M | M2 |
| B10 | browse playwright provider: 세션 관리와 상한, 필터 프록시, 이동 재검사, 사람 확인, 기본 비활성 동작, ref 부여, `code` 출력. Bun 호환 스모크(launch → goto → ariaSnapshot → close, connectOverCDP)와 Node 24 자식 우회(`runtime: node`). fetch 승격의 브라우저 경로 연결 | B3, B5, B6, L0.process.plan의 자식 프로세스 API | L | M2 후반~M3 초입 |
| B11 | 설정 키 `l2.web.*` 전체(`L2.web.spec` §6), 도메인 목록 범위 합집합 읽기, `checkSettingDef` 통과 테스트 | B1 | S | M2 |
| B12 | agent-browser provider(2차): 바이너리 경로 설정, `--json`·`--session`·`--allowed-domains` 호출, delta 스냅샷 적용, ref 맵, 응답 TypeBox 정규화, 버전 고정 픽스처 | B10 | M | 2차 |
| B13 | web.research(2차): native 루프(`xeon.agents`), 예산, 인용 검증 패스, 상태 머신, `run`/`start`/`get`/`cancel`, `web.research_progress` 휘발 이벤트 | B6, B7, B9, L1.agents.plan | L | 2차 |

순서: B1 → B2 → (B3, B11) → (B4, B5) → B6 → B7 → (B8, B9) → B10. B8과 B9는 병렬로 할 수 있다.

## 4. 채택 코드

| 패키지 | 정확한 버전 | 라이선스 | 쓰는 곳 | 비고 |
|---|---|---|---|---|
| `guarded-fetch` | 0.1.6 | Apache-2.0 | `policy/guarded-http.ts` | 0.1.x 신생이다. B3에서 연결 시점 IP 재검증, 검증 IP 다이얼, 리다이렉트 훅을 소스로 확인한다. 부족하면 `request-filtering-agent`로 바꾼다(버전은 B3에서 레지스트리 확인 뒤 정확 고정) (`_research/packages.md` §4.4 L2-c) |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 | `fetch/convert/readability.ts` | 기본 추출기 [제안] |
| `linkedom` | 0.18.13 | ISC [가정] | `fetch/convert/readability.ts` | Readability용 DOM. 리소스 로딩 없음 |
| `defuddle` | 0.19.5 | MIT [가정] | `fetch/convert/defuddle.ts` | 선택 추출기(`l2.web.fetch.extractor`) |
| `turndown` | 7.2.4 | MIT | `fetch/convert/turndown.ts` | HTML → Markdown |
| `playwright-core` | 1.64.1 | Apache-2.0 | `browse/providers/playwright-local.ts`, `playwright-node/server.mjs` | 13.7MB. 브라우저는 별도 다운로드(사용자 확인 뒤). `bun build --compile`에서 `chromium-bidi`를 external로 둔다(`_research/notes/L2-2.md` §2.3) |
| `agent-browser` | 0.39.1 | Apache-2.0 | `browse/providers/agent-browser.ts`(2차) | npm 래퍼는 쓰지 않고 네이티브 바이너리 경로를 설정으로 받는다. 7종 합계 119MB(`_research/notes/L2-2.md` §2.4) |

- 버전은 `xeon/package.json` catalog에 정확 고정으로 둔다(`_research/foundation-plan.md` §2 런타임 행). 라이선스 [가정] 표시는 B6 착수 때 각 패키지 `package.json`의 `license` 필드로 확인한다.
- 불채택: `exa-js` 2.26.0. zod 3과 openai 5에 의존해 무겁다. Exa 플러그인은 REST를 `GuardedHttp`로 직접 호출한다(`_research/packages.md` §4.4 L2-c web.search 행).
- 불채택: Firecrawl 서버 코드와 SearXNG 코드(AGPL-3.0). 별도 프로세스 HTTP 호출만 한다(`_research/web-tools.md` §5.1).
- 불채택: Lightpanda(AGPL, 배포판 제외), Stagehand·moli(보류)(`_research/layer-plan-v2.json` L2-c).
- 소유: `eng.dependency-rules.guide` DR-07 표에 `@mozilla/readability`, `linkedom`(소유 `cap-web`)을 더하도록 요청한다. `guarded-fetch`, `defuddle`, `turndown`, `playwright-core`는 이미 `cap-web` 소유다.
- 포크 코드는 없다. `omp` `web/search`의 쿼리 지시어 파서와 hermes `url_safety.py`는 설계만 참고하고 TypeScript로 새로 쓴다(`_research/web-tools.md` §3.2, §3.3).

## 5. 단위 테스트 목록

방침: `eng.testing.guide` TS-01(단위 우선), TS-03(시계·ID 주입), TS-04(모델 테이프), TS-05(외부 경계 가짜). HTTP는 녹화 픽스처 transport로 대신하고 실제 네트워크 호출은 하지 않는다. 테스트 preload가 루프백 밖 `fetch`를 막는다(`eng.testing.guide` TS-03 표). DNS는 `fake-resolver`로 대신한다. 녹화 픽스처는 `just web-fixture-record <이름>`(사람 확인 뒤 `--yes`, 종료코드 3 규칙)로만 만들고 `just verify`에서는 재생만 한다.

| 파일 | 테스트 이름 | 확인할 동작 |
|---|---|---|
| `test/defs.test.ts` | `four web capabilities validate with zero issues` | `validateCapability` 4건과 `validateCapabilitySet` 이슈 0건 |
| 같음 | `search tool params exclude provider` | 도구 파라미터에 `provider`가 없고 `toInput` 결과가 서비스 입력 스키마를 통과 |
| `test/chain.test.ts` | `chain order table` | 표 주도 테스트: (호출 인자, 설정, 플러그인 유무·순서, SearXNG 감지, 래퍼 가용) 조합마다 시도 순서가 §4.8.2와 같음. 명시 선택은 원소 하나 |
| 같음 | `explicit provider does not fall back` | 호출 인자 provider가 탐침 실패면 `unavailable`, `detail.reason` 있음, 다른 provider 호출 0 |
| 같음 | `auto chain records fallbacks` | 플러그인 `no-key` → SearXNG `unreachable` → 래퍼 성공에서 `meta.fallbacks` 2줄, `stage: "probe"` |
| 같음 | `call error falls back only for safe methods` | 호출 중 `rate_limited`는 다음 후보, `invalid_input`은 즉시 실패 |
| `test/availability.test.ts` | `unavailable reasons` | 5개 사유 각각: 키 없는 플러그인 `no-key`, 연결 거부 SearXNG `unreachable`, 403 SearXNG `json-disabled`, 래퍼 조직 차단 400 뒤 `org-disabled`, hosted 미지원 모델 `unsupported-model` |
| 같음 | `probe cache ttl` | 성공 탐침은 5분, 실패 탐침은 30초 동안 다시 보내지 않음(수동 시계) |
| `test/searxng.test.ts` | `json 403 maps to json-disabled` | 403 픽스처 → `json-disabled`, 경고 1회 |
| 같음 | `detect candidate order` | 설정 주소가 있으면 그 주소만, 없으면 후보 4개 순서 |
| 같음 | `normalize searxng results` | 픽스처 JSON → `results`, `sources`, `sN`, `cost.basis = "free"` |
| `test/wrapper.test.ts` | `pause_turn continuation limit` | 테이프에서 `pause_turn` 4회 → 재요청 3회 후 부분 결과, `wrapper_continuation_limit` 경고 |
| 같음 | `wrapper drops encrypted content` | 결과 JSON 어디에도 `encrypted_content`, `encrypted_index` 없음 |
| 같음 | `wrapper cost estimate` | 사용량(검색 1, 토큰 입력·출력)과 가격표로 `basis: "estimated"`, `pricingAsOf` |
| `test/query.test.ts` | `parse directives` | `site:`, `-site:`, `after:`, `before:`, `filetype:`, `intitle:`, 따옴표, `-제외어` |
| 같음 | `relax order` | 후처리로 결과가 0이면 정해진 순서로 완화하고 `relaxed`에 기록, `domains`는 완화 안 함 |
| `test/ssrf.test.ts` | `blocks private and metadata literals` | `127.0.0.1`, `2130706433`(10진), `0x7f.1`, `0177.0.0.1`, `127.1`, `[::1]`, `[::ffff:127.0.0.1]`, `[64:ff9b::7f00:1]`, `169.254.169.254`, `[fd00:ec2::254]` 모두 `denied`, 연결 시도 0 |
| 같음 | `blocks names` | `localhost`, `a.localhost`, 점 없는 호스트, `*.internal`, `metadata.google.internal`, 사용자 정보 URL |
| 같음 | `dns rebinding at connect time` | 가짜 리졸버가 첫 조회 공개 IP, 연결 시점 조회 `10.0.0.1` → `denied` |
| 같음 | `redirect to private is denied at hop` | `302 → http://10.0.0.5/` 픽스처 → 그 hop에서 `denied` |
| 같음 | `cross host redirect not followed` | 다른 공개 호스트 302 → `redirect.followed = false`, `content` 빈 문자열 |
| 같음 | `same host redirect limit` | 같은 호스트 6회 → `redirect_limit` |
| 같음 | `private network opt-in keeps loopback and metadata blocked` | `allowPrivateNetwork = true`에서 `10.0.0.1`은 허용, `127.0.0.1`·`169.254.169.254`는 거부 |
| 같음 | `searxng loopback endpoint exception is provider-only` | SearXNG provider 요청의 `127.0.0.1:8888`은 통과, 같은 주소의 `fetch`는 `denied` |
| `test/domain-policy.test.ts` | `deny ask allow precedence` | 같은 호스트에 세 규칙이 있으면 deny |
| 같음 | `lower scope cannot lift deny` | 사용자 deny + 프로젝트 allow → deny |
| 같음 | `wildcard dot boundary` | `*.example.com`이 `example.com`, `badexample.com`, `example.com.evil.net`에 맞지 않음. `example.*` 패턴은 거부 |
| 같음 | `ask without session denies` | 세션 없는 확장 호출의 ask → `denied` |
| `test/fetch-pipeline.test.ts` | `negotiated markdown path` | `Content-Type: text/markdown` 픽스처 → 변환 호출 0, `method: "negotiated-md"` |
| 같음 | `html readability path` | HTML 픽스처 → `method: "readability"`, 숨은 요소·주석 제거 |
| 같음 | `empty body promotes` | 빈 SPA 픽스처 + 가짜 fetch 플러그인 → `method: "provider:plugin:web-fake"`. 플러그인이 없으면 `empty_content` 경고 |
| 같음 | `challenge promotes without bypass` | 403 + `cf-mitigated: challenge` → UA를 바꾼 재시도 0, 승격만 |
| 같음 | `truncate and continue by rawRef` | 40,000자 본문 → `truncated.nextOffset`, `rawRef`+`range.offset` 재조회는 네트워크 0 |
| 같음 | `exactly one of url urls rawRef` | 0개, 2개 입력은 `invalid_input` |
| 같음 | `batch partial failure` | `urls` 3개 중 1개 정책 거부 → 해당 페이지만 `error` |
| 같음 | `too large` | 10 MiB 초과 픽스처 → `too_large` |
| `test/convert.test.ts` | `convert is network free` | 외부 이미지·스크립트·스타일 참조가 많은 HTML 픽스처 변환 중 `fetch` 스파이 호출 0, 같은 입력에 같은 출력 |
| 같음 | `untrusted boundary escape` | 본문의 `</untrusted_web_content>`가 `&lt;/untrusted_web_content>`로 바뀌어 경계가 하나 |
| `test/cache.test.ts` | `cache policy storage matrix` | `none`·`session`·`persist` 가짜 provider마다 메모리 메모, `cap_web_fetch_cache`, `cap_web_raw` 저장 여부가 `L2.web.spec` §4.3.2 표와 같음(인메모리 SQLite) |
| 같음 | `brave none never on disk` | Brave 매니페스트 가짜의 검색·fetch 뒤 두 테이블 행 0, 같은 질의 두 번에 provider 호출 2 |
| 같음 | `single flight` | 동시에 같은 질의 2개 → provider 호출 1 |
| 같음 | `fallback result not cached under first provider` | 첫 후보 실패 뒤 둘째 후보 결과는 메모에 들어가지 않음 |
| 같음 | `unreviewed persist downgraded` | `reviewedAt` 없는 `persist` 매니페스트 → `session` 처리와 진단 경고 |
| 같음 | `limit bucket` | limit 7과 10이 같은 메모 항목을 씀 |
| `test/cost.test.ts` | `reported vs estimated vs free` | provider 금액 있으면 `reported`, 없으면 가격표로 `estimated` + `pricingAsOf`, SearXNG `free` |
| 같음 | `pricing asOf stale warning` | 수동 시계 asOf+91일 → `pricing_stale` 경고, +89일은 없음 |
| 같음 | `free allowance warnings` | 월 사용량 80%, 100%에서 각 경고, 월이 바뀌면 초기화(UTC) |
| 같음 | `session call limits` | 101번째 search, 301번째 fetch → `session_limit`. `urls` 3개는 3으로 셈 |
| `test/source-ids.test.ts` | `source ids are session unique` | 두 호출의 같은 URL은 같은 `sN`, 다른 URL은 이어지는 번호. 세션 이벤트 픽스처로 재시작 뒤 다음 번호를 이어감 |
| `test/redact.test.ts` | `redact none passages` | `usage.cache = "none"` Source의 발췌·답변만 비우고 URL·제목 유지 |
| `test/model-tool.test.ts` | `decide model search tool` | (설정, 체인 결과, hosted 지원) 조합 표 → `hosted`/`function`/`off` |
| `test/browse-policy.test.ts` | `navigate policy and post-redirect recheck` | 가짜 브라우저 핸들: 금지 호스트 navigate `denied`, `navigations`에 금지 URL이 생기면 페이지 비우고 `denied` |
| 같음 | `disabled actions` | `evaluate`, `upload` → `action_disabled` |
| 같음 | `confirmation vocabulary` | "결제", "Place order", 다른 origin 폼 제출 → 승인 요청, 거부면 `confirmation_denied` |
| 같음 | `session budget` | 동작 201번째 → `session_budget`, 세션 닫힘 |
| `test/settings.test.ts` | `web settings pass checkSettingDef` | `l2.web.*` 전체가 D1~D9 통과, 키 집합이 `L2.web.spec` §6 표와 같음 |

`int` 태그(`*.int.test.ts`, 패키지 안, 기본 `just verify` 포함 여부는 아래):

| 파일 | 테스트 | verify |
|---|---|---|
| `test/playwright-bun.int.test.ts` | Bun 경로 스모크(launch → goto(루프백 정적 서버) → ariaSnapshot → close), `connectOverCDP` | 넣지 않는다. 브라우저 바이너리가 필요하므로 `just web-browse-smoke` 별도 레시피 |
| `test/playwright-node.int.test.ts` | Node 24 자식 중계 같은 스모크 | 같음 |
| `test/fetch-cache.int.test.ts` | 임시 파일 SQLite에서 캐시 행·blob 저장과 크기 상한 정리 | 넣는다 |

## 6. 완료 기준

M2:

1. `L2.web.spec` §9 수용 기준 1~13이 단위 테스트로 통과한다. 특히 1(SearXNG 감지 시 SearXNG, 없으면 래퍼)과 2(`meta.fallbacks`)가 M2 종료 조건 "`web.search`가 SearXNG를 감지하면 SearXNG를 쓰고, 없으면 내장 검색 래퍼를 쓴다"(`product.scope.spec` §4.4 M2)를 확인한다.
2. Helm 테스트 그룹이 `g.capability(WebSearchKey).search({ query })`와 `g.capability(WebFetchKey).fetch({ url })`를 `cap-web` import 없이 호출하고 타입 검사를 통과한다(`F.capabilities.spec` §9 수용 기준 4).
3. `cd xeon && just verify` 종료코드 0. 가격표 검사는 경고만 내고 0으로 끝난다.
4. WEB-R16 확인: `fetch/convert/` 아래에 `fetch(` 호출을 넣은 임시 변경으로 `just lint` 또는 `just check-layers`가 실패하는 것을 한 번 확인하고 되돌린다.
5. 테스트 실행 중 루프백 밖 네트워크 요청 0(`eng.testing.guide` §5).

B10 완료(M2 후반~M3 초입):

6. `L2.web.spec` §9 수용 기준 14가 가짜 브라우저 핸들 단위 테스트로 통과한다.
7. `just web-browse-smoke`가 macOS와 Linux에서 통과한다. Bun 경로가 실패한 플랫폼은 `runtime: node`로 통과하고, 그 결과를 이 plan §7 위험 표에 기록한다.

M3:

8. `web-exa`, `web-brave` 플러그인이 `provides`와 `WebProviderRegistration`으로 등록되고, 키가 없으면 `no-key`, 키가 있으면 auto 체인의 첫 후보가 된다. Brave 결과는 디스크에 남지 않는다(가짜 HTTP 픽스처).
9. 설정 화면 `tools` 탭의 검색 provider 상태와 키 등록 흐름이 `l2.web.*`·`ext.web-*` 스키마에서 생성된다(`L4.settings-ui.spec`).

2차 완료:

10. `L2.web.spec` §9 수용 기준 15(`web.research`)가 B13 단위 테스트로 통과한다. 1차 완료(M2·M3)의 대상이 아니다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 | 근거 |
|---|---|---|---|
| 래퍼 비용·지연 미측정 | 1회 약 $0.011 추정이 틀리면 Helm 탐색 비용 예측이 틀림. 지연이 길면 Helm drive 준비가 늦음 | B9 완료 뒤 실제 키로 20회 측정 레시피(`just web-wrapper-measure`, 사람 확인 뒤 `--yes`)를 돌려 `pricing.ts`와 ADR-0005 §3.2 값을 갱신한다. 측정 전까지 [가정] 표시 유지 | ADR-0005 §4.2, §6 |
| playwright-core 1.64.1의 Bun 실행 실패(launch, CDP, ariaSnapshot) | browse 기본 경로 중단 | `runtime: auto`가 스모크로 판정하고 Node 24 자식 우회로 넘어간다. 1.64.1 정확 고정, 업그레이드 때 스모크 재실행 | `_research/notes/L2-2.md` §4, §9, `product.scope.spec` R3 |
| `recordHar` 교착, mTLS 실패 | 해당 기능 무한 대기·실패 | Bun 경로에서 두 기능을 쓰지 않는다 | oven-sh/bun#30652, #44523(`_research/notes/L2-2.md` §2.3) |
| `bun build --compile`에서 playwright-core 누락, `chromium-bidi` 해석 실패 | CLI·사이드카 빌드 실패 | `chromium-bidi` external, 빌드 산출물로 launch 스모크 | microsoft/playwright#43190, oven-sh/bun#18749, #44710 |
| SearXNG AGPL 해석 | 번들하면 소스 제공 의무 가능성 | 법률 확인 전 번들·링크 금지. 사용자가 별도 설치한 인스턴스의 HTTP만 쓴다 | ADR-0005 §3.1 [가정], `_research/durable-and-search-facts.md` §B-2 |
| 약관 미확인 provider의 캐시 | 약관 위반 저장 | 확인 전 `session` 기본, `reviewedAt` 없는 `persist`는 `session`으로 낮춤. 공개 릴리즈 전 약관 검토 | `_research/web-tools.md` §4.7, §5.1 |
| guarded-fetch 0.1.6 성숙도 | 연결 시점 재검증 누락 시 DNS 리바인딩 노출 | B3에서 소스 확인과 리바인딩 테스트. 부족하면 request-filtering-agent로 바꾸거나 자체 연결 훅 | `_research/packages.md` §4.4 L2-c |
| agent-browser 응답 JSON 미문서화(2차) | provider 파싱 깨짐 | TypeBox 정규화 + 버전 고정 픽스처 | `_research/notes/L2-2.md` §5, §9 |
| agent-browser 설치 때 Chrome 다운로드(2차) | 설치 시간, 네트워크 실패 | 설치 단계 명시, 사용자 확인 뒤 실행 | 같음 |
| SearXNG 탐침이 상위 엔진에 질의를 보냄 | 상위 엔진 차단, 불필요한 트래픽 | 첫 검색 때 한 번, 5분 캐시 | `L2.web.spec` §4.8.3 |
| 필터 프록시가 WebRTC 등 일부 트래픽을 놓침 | 브라우저 도메인 제한 우회 | WebRTC 비활성 플래그, 단위·스모크 테스트에 WebSocket·이미지·워커 차단 사례 | `L2.web.spec` §4.10.2, §10 미결 8 |
| oxlint `overrides`가 기본 금지 패턴을 대체 | 변환 영역에서 기본 금지 규칙이 빠짐 | override에 기본 패턴을 다시 적고, check-layers 패턴으로 이중 검사 | `eng.dependency-rules.guide` §3.2 |
| 플러그인 배포 방식 미정 | 첫 실행 권장 흐름 구현 지연 | M3 전에 사용자 확인(§1.3) | `L2.web.spec` §10 |

## 8. M2 구현 기록 (m2-plan WEB.1~WEB.5)

구현은 브랜치 `m2/web`에서 했다. 시험은 모두 주입한 가짜(시계, ID, DNS 해석기, 녹화 HTTP 전송, 승인 포트, 비밀 판정)로 돌고 네트워크를 쓰지 않는다. 시험 환경은 WSL2이고 브라우저·macOS는 없다.

### 8.1 작업별 상태

| m2-plan ID | plan ID | 상태 | 내용과 시험 |
|---|---|---|---|
| WEB.1 | B2 | 구현 | `contract/url.ts`(정규화), `source-ids.ts`(세션별 `sN` 표, 이벤트 읽기 포트로 재시작 뒤 이어서 할당), `meta.ts`(`WebCallMeta` 조립), `redact.ts`(`redactForPersistence`). `renderSearch` 등 렌더러는 F `defs/web.ts`가 이미 가지고 있어 `contract/render.ts`를 따로 만들지 않았다. `url.test.ts`, `source-ids.test.ts`, `redact.test.ts`, `meta.test.ts`, `defs.test.ts` |
| WEB.1 | B11 | 구현 | `settings.ts`가 `l2.web.*` 37개 키 전체를 선언한다(1차 `since: "0.1.0"`, 조사 키 `0.2.0` [가정]). 도메인 목록 세 키는 모든 범위의 값을 합쳐 읽는다. `settings.test.ts` |
| WEB.2 | B3 | 구현 | `policy/address.ts`(IP 파싱·분류), `ssrf.ts`(URL 검사, 주소 판정), `domain.ts`, `access.ts`(§4.1 3~4단계: 비밀 값, 도메인, 대화에 나온 URL, 승인), `content-http.ts`(리다이렉트 hop 재검사), `robots.ts`, `seen-urls.ts`, `guarded-http.ts`(provider용 `GuardedHttp`), `transport/http-transport.ts`(guarded-fetch 연결), `transport/system-resolver.ts`, `ask-adapter.ts`. `address.test.ts`, `ssrf.test.ts`, `domain-policy.test.ts`, `access-unseen.test.ts`, `robots.test.ts`, `guarded-http.test.ts`, `ask-adapter.test.ts` |
| WEB.3 | B4 | 구현 | `cache/single-flight.ts`(결과 타입마다 인스턴스, 앞선 호출자가 취소하면 뒤 호출자가 다시 시작), `search-memo.ts`(LRU 500 + TTL, limit 버킷, 메모 키), `fetch-cache.ts`(`cap_web_fetch_cache`, `cap_web_raw`, 크기 상한 정리, 사라진 세션의 원문 정리), `migrations.ts`(TS 상수. `.sql` 파일 대신 `MigrationSet`을 쓴다). `cache.test.ts`, `fetch-cache.int.test.ts`(실제 SQLite 임시 파일) |
| WEB.3 | B5 | 구현 | `cost/pricing.ts`(내장 가격표, asOf 90일 점검), `meter.ts`(reported·estimated·free 계산, 월 무료 한도 경고, `cap_web_usage` 누적), `limits.ts`(세션당 호출 상한), `pricing-cli.ts`. `just web-pricing`을 구현했다(출력만 하고 종료코드 0). `cost.test.ts` |
| WEB.4 | B6 | 구현 | `fetch/convert/`(WEB-R16 영역: `convert.ts`, `sanitize.ts`, `readability.ts`, `defuddle.ts`, `turndown.ts`), `convert-worker.ts`(네트워크 전역을 지운 뒤 변환 모듈을 동적 import), `convert-runner.ts`(Worker 실행기와 직접 실행기), `local-provider.ts`, `promote.ts`(플러그인 후보 승격. 브라우저 승격은 비워 둠), `raw-read.ts`, `truncate.ts`, `robots-gate.ts`, `pipeline.ts`. `convert.test.ts`, `convert-worker.test.ts`, `fetch-pipeline.test.ts`, `fetch-cache-behavior.test.ts`. WEB-R16 확인(plan §6 4번): `convert/`에 `fetch(` 호출과 `node:http` import를 넣으면 `just check-layers`와 `just lint`가 각각 실패하는 것을 확인하고 되돌렸다 |

### 8.2 guarded-fetch 0.1.6 소스 확인 (WEB.2)

npm 레지스트리의 0.1.6 타르볼을 빈 디렉터리에 풀어 `dist/index.mjs`(42 KB)와 README를 읽었다. 내려받은 코드는 실행하지 않았고 import만 한다. 시험은 이 패키지를 호출하지 않는다.

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 연결 시점 IP 재검증 | 있음 | undici `Agent`의 `connect`에 `createGuardedLookup`을 넣는다. 해석된 모든 주소를 `isSafeIpAddress`로 검사하고 하나라도 안전하지 않으면 연결을 거부한다 |
| 검증한 IP로 다이얼 | 있음 | 같은 `lookup` 호출이 돌려주는 주소를 소켓이 쓴다. 해석과 연결 사이에 다시 풀지 않는다 |
| IP 리터럴 | 사전 검사와 연결 전 검사로 막음 | `net.isIP`가 참인 호스트는 `lookup`을 거치지 않으므로 `assertUrlIsSafeToFetch`와 커넥터가 따로 검사한다 |
| 리다이렉트 훅 | `followRedirects: false`로 3xx를 그대로 받음 | hop마다 우리 정책을 거치려고 이 모드를 쓴다. 내장 추적은 5 hop, 같은 호스트 구분이 없다 |
| 범위 표 | 스펙 §4.6.3 표보다 넓거나 같음 | 사설, CGNAT, 링크 로컬, 멀티캐스트, 예약, 문서용, 6to4, NAT64(로컬 용도 `64:ff9b:1::/48` 포함), IPv4 매핑을 막는다 |
| 응답 크기 | 제한 없음(맨 `guardedFetch`) | 본문 읽기는 `http-transport.ts`가 상한까지만 읽는다 |
| 헤더 | `Host`, `Cookie`, `X-Forwarded-*` 등을 조용히 버림 | provider의 인증 헤더(`Authorization`, `X-Api-Key`)는 남는다 |

부족한 점 둘은 스펙이 요구하는 예외다. `guarded-fetch`는 둘을 표현하지 못한다.

1. `l2.web.policy.allowPrivateNetwork = true`일 때 사설 대역(10/8 등)을 여는 선택지가 없다.
2. provider endpoint 예외(§4.6.5). SearXNG의 루프백 주소(`127.0.0.1:8888`)에 연결할 수 없다.

대응(request-filtering-agent로 바꾸지 않고 두 갈래 전송): `policy/ssrf.ts`가 해석된 주소 전체를 스펙 표로 판정한다. 모두 공개 주소면 `public` 모드(guarded-fetch, 연결 시점 재검증 포함)로 보낸다. 사설망 허용이나 endpoint 예외로 열린 주소가 있을 때만 `direct` 모드(전역 `fetch`, `redirect: "manual"`)로 보낸다. `direct` 모드는 연결 시점 재검증이 없다. 그 틈은 아래 8.3에 적었다.

### 8.3 확인하지 못한 항목과 [미결]

| 항목 | 이유 | 확인 방법 |
|---|---|---|
| Bun 런타임에서 guarded-fetch 동작 | `undici`가 Bun에서 도는지, `connect.lookup`을 Bun의 소켓이 따르는지 실행으로 확인하지 못했다. 소스만 읽었다 | 사람이 임시 스모크로 `guardedFetch("http://127.0.0.1:<루프백 서버>")`가 `hostname_unsafe`로 거부되는지, `localhost`로 해석되는 이름이 막히는지 확인한다. 막히지 않으면 `dispatcher`에 자체 `Agent`를 넘기는 방식(undici 직접 의존)으로 바꾼다 |
| `direct` 모드의 DNS 리바인딩 | 사전 검사에서 모든 주소를 판정한 뒤 `fetch`가 이름을 다시 푼다. 그 사이에 주소가 바뀌면 막지 못한다 | 영향 범위는 사설망 허용을 켠 사용자와 SearXNG 같은 사용자 설정 endpoint로 한정된다. `allowPrivateNetwork`는 project 범위를 허용하지 않는다. 막으려면 검증한 IP로 직접 연결하는 전송이 필요하다 |
| `cap_web_usage` 가격 단위 | 래퍼 토큰 단가는 Haiku 5.5 값이고 사용할 모델에 따라 다르다. 토큰 수는 ADR-0005 §3.2의 추정이다 | WEB.6 뒤 실측(`just web-wrapper-measure`, 사람 확인 뒤) |
| robots.txt 가져오기 연결 | `createRobotsChecker`는 가져오기 함수를 주입받는다. 파이프라인 연결은 WEB.4 | WEB.4 |

### 8.4 문서와 다르게 정한 점

- `cap_web_raw`에 출처 열 9개(`url`, `final_url`, `provider`, `status`, `content_type`, `method`, `title`, `published_at`)를 더했다. 스펙 §3.8의 열만으로는 rawRef 재조회가 `Source`를 만들 수 없다(원문 URL이 없다). 마이그레이션은 `.sql` 파일 대신 `cache/migrations.ts`의 `MigrationSet` 상수다.
- `fetch/convert/`는 `ConvertResult`에 `spaSuspected`(`<noscript>`가 JavaScript를 요구하거나 루트 요소 하나뿐인 빈 페이지)를 더해 승격 판단을 돕는다. 승격 조건 "공백 제외 200자 미만"은 파이프라인이 판정한다.
- `defuddle`은 동기 `parse()`만 쓴다. 이 패키지의 비동기 추출기(YouTube, Bilibili)는 제3자 API를 부르므로 WEB-R16과 맞지 않아 쓰지 않는다.
- tsconfig `lib`에 `dom`을 더했다(`cap-web`만). `@mozilla/readability`와 `linkedom`의 타입이 `Document`, `Node`를 전역으로 참조한다.
- `GuardedHttp.request`는 거부할 때 `WebHttpError`를 던진다. 인터페이스가 Promise 거부로 정해져 있어서이고, 앞단 안쪽 호출은 같은 로직의 `Result` 판(`BoundProviderHttp.request`)을 쓴다.
- 비밀 값 판정(`Redactor.containsKnown`), 사용자 승인(`L2ApprovalsPort`), 세션 이벤트 읽기, provider 후보 조회는 `cap-web/src/ports/*.ts`의 좁은 포트로 받는다. 실제 연결은 HOST 트랙의 조립이 한다(m2-plan §3 6번).

