# pi durable Chord 의존과 무료 웹 검색 사실 (2026-10-21 조사)

정본 아님. Explore 에이전트 조사 결과 원문.

## 결과 요약

조사 기준일은 2026-10-21이며, 읽기 전용으로 진행했습니다. WebFetch 결과는 소형 모델이 요약한 내용이라서 원문과 대조하지 못한 항목은 [요약]으로 표시했습니다.

**A. Chord 의존**
- 떼어낼 대상(env, tools, images, truncate)의 import 폐포에는 Chord 값 import가 0건입니다. Chord 타입 import는 8줄뿐이고 모두 `import type`이라 런타임에 지워집니다. 타입체크에는 여전히 Chord 타입이 필요합니다.
- Chord 심볼은 `Context`(7곳)와 `JsonValue`(1곳)입니다. `Context`는 DI가 아니라 `abortSignal`을 실어 나르는 취소 토큰입니다. durable 소스에서 Chord의 service/facet/inject API 사용은 0건입니다.
- 실제 결합은 import 줄보다 타입 경로에 있습니다. `tools → harness/define.ts → harness/types.ts`(786줄, 타입 전용)입니다.
- 얇은 Cordis 어댑터는 설계상 가능합니다. 경계는 `ExecutionEnv` 인터페이스와 `ToolExecutionApi.env`입니다. 다만 Cordis의 JS provide/inject 시그니처는 확인하지 못했습니다.
- 전제 확인: 저장소 안에는 Cordis 의존이나 채택 결정이 없습니다. Cordis를 DI로 전제한 곳은 scratchpad 계획 문서뿐입니다.

**B. 무료 웹 검색**
- 확인된 범위에서 모델 내장 검색 3종은 모두 모델 요청 안에서만 실행됩니다. 검색 전용 API는 확인되지 않았습니다.
- SearXNG는 AGPL-3.0이고 JSON 응답은 설정에서 따로 켜야 합니다.
- 키 없이 쓸 수 있는 선택지는 사실상 자가 호스팅 SearXNG뿐입니다.
- 무료 크레딧이 있는 API(Brave, Exa, Tavily, Serper)는 월 1,000–2,500건 규모입니다.

---

## A. pi durable의 Chord 의존 깊이

경로 기준은 `~/projects/_ref/pi-src/packages/durable`(이하 `D/`)입니다.

### A-1. 폐포 안의 Chord 심볼 (파일:줄)

| 파일:줄 | 심볼 | 종류 |
|---|---|---|
| `D/src/env/index.ts:1` | `Context` | type |
| `D/src/env/node.ts:23` | `Context` | type |
| `D/src/env/node-watch.ts:5` | `Context` | type |
| `D/src/tools/read.ts:1` | `Context` | type |
| `D/src/tools/bash.ts:1` | `Context` | type |
| `D/src/tools/file-mutation-queue.ts:1` | `Context` | type |
| `D/src/tools/path-utils.ts:1` | `Context` | type |
| `D/src/harness/define.ts:1` | `JsonValue` | type |

- 합계는 type 8줄(`Context` 7, `JsonValue` 1)이고, 값 import는 0입니다.
- `D/src/images/*`와 `D/src/truncate.ts`는 Chord import가 없습니다. `truncate.ts`는 import가 전혀 없습니다.
- `truncate.ts`는 `package.json`의 exports에 없는 내부 파일입니다.
- `context.abortSignal` 런타임 접근은 38줄입니다. `env/node.ts`가 31줄(예: :403, :624, :1082)이고, `tools/edit.ts`가 105, 114, 120, 125줄, `tools/write.ts`가 30, 32줄, `tools/bash.ts`가 120줄입니다. 그 외 `Context` 멤버 접근은 없습니다.
- 폐포 밖에는 값 import가 많습니다. 예를 들면 `D/src/session/session.ts:1-3`(replicatedState, awaitWithContext, BACKGROUND_CONTEXT, withoutAbortSignal, track), `D/src/harness/scheduler.ts:1-2`(copyJson, awaitWithContext, withAbortSignal), `D/src/session/observation.ts:8`, `D/src/storage/memory.ts:2`입니다. `src` 전체에서 chord를 import하는 파일은 41개입니다.
- Chord 원본은 `~/projects/_ref/pi-src/packages/chord/src/types.ts:15-16`에 `interface Context { readonly abortSignal }`로 정의되어 있습니다. `context/index.ts`(121줄)에 BACKGROUND_CONTEXT, withAbortSignal, withoutAbortSignal, awaitWithContext가 있습니다.

### A-2. 타입 전용인가, 런타임 DI인가

- 폐포는 타입 전용입니다. 런타임에 Chord가 로드되지 않습니다.
- `Context`는 모든 env 메서드의 마지막 인자로 전달되고, 그 안에서 `.abortSignal`만 읽힙니다. 취소 신호 전달이고 DI가 아닙니다.
- DI처럼 보이는 구조는 durable 내부에 있습니다. Harness가 호출마다 env를 주입합니다. spec.md:2628이 "tool task, prepare, runtime.env() | environment | at each call"이라고 적고 있고, `D/src/tools/env.ts:5-7`의 `requireEnv(api)`가 `api.env`를 읽습니다.
- `service`, `inject`, `provide` 심볼은 durable 소스에서 0건입니다. `defineService`, `defineFacet`, `createFacetHost`, `RemoteServiceProvider`도 0건입니다.

### A-3. 포크 변경량 추정

- 대상은 25개 파일, 4,792줄입니다.
  - env 5개 2,250줄(index 327, node 1,226, node-watch 522, decode 30, line-scan 145)
  - tools 11개 1,562줄
  - images 6개 390줄
  - `truncate.ts` 205줄
  - `harness/define.ts` 44줄과 `harness/output.ts` 341줄
- Chord 제거 편집은 import 8줄을 로컬 타입으로 바꾸는 것입니다. 로컬 `Context`는 `{ readonly abortSignal: AbortSignal | undefined }` 한 개로 충분합니다. 본문은 바꿀 필요가 없다고 보지만, 이는 [추정]이고 타입체크로 확인해야 합니다.
- 값 치환이 필요한 테스트/헬퍼는 6파일입니다. `test/tools.test.ts`, `test/tools-images.test.ts`, `test/tools-read-differential.test.ts`, `test/env-node.test.ts`, `test/env-node-conformance.test.ts`, `src/testing/env-conformance.ts`입니다. BACKGROUND_CONTEXT는 `{ abortSignal: undefined }`로, withAbortSignal은 직접 조합으로 바꾸면 됩니다.
- 실제로 큰 비용은 `harness/types.ts`(786줄)입니다. 도구 쪽은 ToolRegistration, ToolExecutionApi, ToolExecutionResult, ToolDiagnostic 같은 타입을 여기서 가져옵니다. 이 부분만 추출하면 100–200줄 정도로 줄어들 것으로 보지만 [추정, 미측정]입니다.
- 외부 패키지는 typebox(도구 4파일), diff(`tools/edit-diff.ts:5`), `@silvia-odwyer/photon`(images), pi-ai(`harness/define.ts:2`, 타입 전용)입니다.
- 종합하면 편집은 약 10줄, 타입 추출은 약 100–200줄, 헬퍼 수정은 수십 줄이고, 25개 파일을 복사하게 됩니다. 기존 보고서 안 C의 "chord Context를 env 경계 타입으로 수용"은 Chord를 타입 의존으로 남기는 선택입니다.

### A-4. Cordis 서비스로 감싸는 얇은 어댑터

- 경계 후보는 `ExecutionEnv`입니다. `D/src/env/index.ts:324`의 `export interface ExecutionEnv extends FileSystem, Shell {}`이고, FileSystem은 :171, Shell은 :309에 있습니다. `NodeExecutionEnv`(`D/src/env/node.ts`)에 위임하는 구현체를 두면 됩니다. 어댑터는 Context를 받아 AbortSignal로 바꿔 넘기면 됩니다.
- 주입점은 `ToolExecutionApi.env`입니다. Cordis 서비스가 env 구현을 제공하고, Harness가 이를 `api.env`로 넘기는 구조가 가능합니다.
- 이름 충돌에 주의해야 합니다. Chord의 `Context`는 취소 토큰이고, Cordis의 `Context`는 DI 루트로 보입니다([미확인]). 임포트에 별칭을 두어야 합니다.
- Cordis의 JS API는 확인하지 못했습니다.
  - 로컬에는 Cordis 소스가 없습니다(`~/projects/_ref` 목록에 없음).
  - 공식 README(github.com/cordiverse/cordis)는 "API is not yet stable"만 명시하고 provide/inject 설명이 없습니다.
  - WebSearch는 Rust 포트(cordis-rs)와 3차 가이드만 반환했습니다.
  - 기존 보고서가 인용한 `events.ts:14`, `fiber.ts:103`은 열어보지 못했습니다.

### A-5. 전제와 기존 보고서 대조

- 사용자 전제인 "DI는 Cordis 하나"는 저장소에서 확인되지 않았습니다. `/home/user/projects/helm/code/helm`의 어떤 package.json에도 cordis 의존이 없습니다. 매치는 `docs/reference/deepseek-harness.md:11`(하네스를 채택하지 않음), `:38`(DeepSeek 하네스가 Cordis 기반이라는 설명), `.helm-design-work/research/deepseek/*.md`뿐입니다.
- Cordis를 계획상 DI로 전제한 곳은 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/research/r2/packages.md`의 3절(A/B/C안)입니다. 이 문서는 cordis 4.0.0-rc.11을 기준으로 하지만, 그 버전 값은 이번 조사에서 검증하지 못했습니다.
- 기존 보고서와의 대조 결과는 일치합니다.
  - `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/research/refs/pi-durable.md:287-291`의 "Context 2용도, facet 아님"은 확인과 일치합니다.
  - `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/research/r2/packages.md:26`의 "/env는 깨끗(chord Context만)"도 일치합니다.

### A-6. L1 설계 자료: spec.md 줄 범위

- 대상 파일은 `~/projects/_ref/pi-src/packages/durable/docs/spec.md`(5,123줄)입니다.
- `/home/user/projects/helm/code/helm/.helm-design-work/P4/pi-v1.1.0/packages/durable/docs/spec.md` 사본과는 574줄이 다릅니다. 예를 들어 `documentRetentionMs`, `modelTools`, `closed` 관련 절이 한쪽에만 있습니다. 아래 줄 번호는 `_ref` 사본 기준입니다.

| 주제 | 줄 범위 | 내용 |
|---|---|---|
| 소유 트리 | 104-114 | ConversationOwnership, owner 필드 |
| | 247-255 | owner와 parent 구분, 생성 시 소유 명시 |
| | 1255-1265 | task 생성 시 소유 규칙 |
| | 1668, 1787-1789 | TaskOwnership, task는 owner를 반드시 명명 |
| | 1972-2030 | §5.4 소유 순회, abort 전파 |
| | 2156-2200 | §5.5 구조적 동시성, 158행이 "one ownership tree" |
| requestId 멱등 | 169, 311 | requestId 필드 정의 |
| | 666 | 재시도 시 request ID 사용 |
| | 1212 | submissionByRequest |
| | 2288-2301 | 제출 상태표, 2300-2301행이 dedupe 규칙 |
| | 3206-3266 | subagent request ID 파생 |
| | 4132 | `compaction:<taskId>` |
| | 4740 | 스토리지 계약 |
| | 4826-4834 | 재오픈 후 requestId로 재제출 |
| 결과 불명 합성 | 280-281 | 컨텍스트 도출 규칙 8, 누락된 결과 합성 |
| | 1917-1927 | §5.2 효과 샌드위치, intent 단계 재오픈 시 효과가 났을 수 있음 |
| | 2082-2108 | orphaned, replay-unsafe |
| | 2134-2139 | pi.tool 결과 누락 시 컨텍스트 도출이 합성 |
| | 2896-2939 | §7.3 중첩 호출 interrupted 처리 |
| | 3310-3316 | interrupted 결과 |
| | 4820-4834 | §10.1 스토리지 실패 |
| 훅 표 | 2636-2646 | §7.2 본문, 재실행 조건 |
| | 2647-2655 | 훅 합성 표(hook / composition / ordinary throw) |
| | 2619-2628 | §7.1 reader 해석 표 |
| 재생 규칙 | — | "replay"라는 전용 절은 없습니다. 아래 근접 절을 씁니다. |
| | 약 268-283 | §2.1 컨텍스트 도출 규칙 1-9 |
| | 1434-1485 | §3.5 베이스와 체크포인트, 재생 상한은 약 1463-1470 |
| | 1486-1520 | §3.6 버전과 마이그레이션, 재생 후 마이그레이션은 1512 |
| | 2851-2882 | §7.3 도구 replay 정책 |
| | 3136-3170 | 재생 시 정책 해석, 재생 때 beforeTool을 다시 실행하지 않음(3162-3163) |
| | 3395-3477 | §8.3 생성 재생, 3444행이 전사 순서 재생 |

---

## B. 무료 웹 검색 기본값의 트레이드오프

### B-1. 모델 내장 검색 3종

| 항목 | Anthropic web_search | OpenAI web_search | Gemini google_search grounding |
|---|---|---|---|
| 가격 | 검색 1,000건당 $10 + 검색 결과 토큰(표준 토큰 단가) | 호출 1,000건당 $10 + 검색 콘텐츠 토큰(모델 단가). 비추론 preview는 $25/1k이고 콘텐츠 토큰은 무료 | Gemini 3 이상은 월 5,000건 무료 후 $14/1k. 2.5 계열은 프롬프트당 과금 [요약] |
| 지원 모델 | 목록은 게시되지 않음. Models API의 `capabilities.server_tools.web_search.supported`로 확인 | 페이지에 목록 없음 [미확인] | 2.0 Flash부터 Gemini 3.x까지 나열 [요약] |
| 결과 형식 | `web_search_tool_result`에 url, title, page_age, encrypted_content가 있고 원문 URL이 반환됨. 인용은 `web_search_result_location`(url, cited_text 150자 이하) | `url_citation` 주석 [요약] | 응답 구조 불일치: 요약은 steps와 url_citation, 기존 메모 `web-tools.md`는 groundingMetadata라고 적음. 원문 교차 확인 필요 |
| 검색 전용 API | 없음. 서버 도구로 Messages 요청 안에서만 실행 | 확인 범위 내에 없음 [미확인] | 확인 범위 내에 없음 [요약] |
| 구독 OAuth 경로 | 문서는 API 기준만 설명 [미확인] | [미확인] | [미확인] |
| 운영 제약 | 조직 관리자가 콘솔에서 끌 수 있고, 꺼져 있으면 400 | — | — |
| 오류/흐름 | max_uses, 도메인 필터, pause_turn 처리 필요, 실패 시 과금 없음 | — | — |

출처는 다음과 같습니다.
- Anthropic: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Anthropic 가격: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI: https://developers.openai.com/api/docs/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/grounding

Anthropic 가격 문서에서 Haiku 5.5의 단가는 다음과 같습니다. 프롬프트가 10만 토큰 이하일 때 입력 $0.10/MTok, 출력 $0.50/MTok, 캐시 히트 $0.01/MTok입니다. 10만 토큰을 넘으면 $0.50/MTok과 $2.50/MTok입니다.

### B-2. SearXNG

- 라이선스는 AGPL-3.0입니다. GitHub의 LICENSE 파일에서 확인했습니다.
- Docker는 필수가 아니라고 설명합니다. 문서는 "a working Docker or Podman installation"을 요구하면서도 대부분 사용자에게 Docker를 권장합니다. 메모리 요구는 명시되어 있지 않습니다 [미확인]. 컨테이너 밖 설치 경로는 이 페이지에서 확인하지 못했습니다.
- JSON API는 `GET /search?q=...&format=json` 또는 POST로 호출합니다. `format=json`은 `settings.yml`의 `search:` 섹션에서 활성화해야 하고, 꺼져 있으면 403입니다. 문서는 많은 공개 인스턴스가 이 형식을 꺼 둔다고 경고합니다.
- 엔진 차단과 레이트 리밋 세부 사항은 Limiter 및 Bot Detection 페이지를 열지 못해 [미확인]입니다. 공개 인스턴스 사용 정책도 페이지에 명시되지 않았습니다 [미확인].
- 라이선스 문제(2차 요약, 원문 미대조): AGPL-3.0 §13의 소스 제공 의무는 수정본을 네트워크 사용자에게 제공할 때 생깁니다. 별도 프로세스로 수정 없이 HTTP API만 호출하는 방식이면 §13 의무가 없다는 것이 요약의 설명입니다. 다만 법률 해석이므로 변호사 확인이 필요합니다. gnu.org 원문은 429로 열지 못했습니다.
- 출처: https://docs.searxng.org/dev/search_api.html , https://docs.searxng.org/admin/installation-docker.html , https://github.com/searxng/searxng/blob/master/LICENSE

### B-3. 키 없는 대안

| 서비스 | 키 | 상태와 약관 | 확인 수준 |
|---|---|---|---|
| DuckDuckGo | 키 없음 | 공식 검색 API 문서를 이번에 찾지 못함. 약관 페이지 본문에서 자동 접근 조항을 확인하지 못함 | [미확인]. 스크레이핑은 약관 위반 위험이 있음 |
| Mojeek | 키 필요 | 유료 CPM. 개인 £1, 스타트업 £2, 비즈니스 £3(1,000건당), 초당 1/5/10건, 일일 2,000/100,000/400,000건 상한. 무료 한도는 찾지 못함 | 2차 요약. 공식 URL 404 |
| Marginalia | 키 필요 | 이메일로 키를 요청하는 방식. 비상업 키는 무료이고 CC-BY-NC-SA 4.0 조건. 공개 키는 개발용이며 503이 날 수 있음. 엔드포인트는 api2.marginalia-search.com | 2차 요약. 상업 용도면 유료 키 필요 |
| Jina s.jina.ai | 선택 | 홈페이지는 "Enter your Jina API key to access a higher rate limit"이라고 함. 기존 메모는 키 없이는 차단된다고 적어 상충함. 무료 한도 수치는 미확인 | 상충, [미확인] |
| SearXNG 자가 호스팅 | 없음 | AGPL-3.0. 운영 비용 있음 | 위 B-2 참고 |

### B-4. 무료 한도가 있는 API

| API | 무료 한도 | 키 | 단가 | 확인 |
|---|---|---|---|---|
| Brave Search | 매월 $5 크레딧(약 1,000건, 산술 추정) | 필요 | $5/1k, 50 QPS | 머리말은 "Up to $20"이라고 해서 불일치. [확인 필요] https://brave.com/search/api/ |
| Exa | 매월 $10 크레딧, Lite 검색 2,500건, 매월 1일 리셋 | 필요 | Lite $4/1k | https://exa.ai/pricing |
| Tavily | Researcher 월 1,000 크레딧 | 필요 | 종량 $0.008/크레딧 | https://tavily.com/pricing |
| Serper | 가입 시 2,500 쿼리 | 필요 | 팩 기준 $1.00에서 $0.30/1k [2차] | 공식 pricing 페이지 404. 2차 출처만 확인 |
| Jina s.jina.ai | 수치 미확인 | 선택(상충) | 토큰제 | 위 B-3 참고 |

### B-5. 우리 설계 제약

1. L3 그룹 코드가 모델 턴 밖에서 서비스 API로 `web.search`를 직접 호출해야 한다는 조건은 모델 내장 검색으로는 만족할 수 없습니다. 확인한 세 제공자 모두 검색이 모델 요청 안에서만 실행됩니다.
2. 검색 전용 소형 모델 래퍼는 가능하지만 비용이 듭니다. Haiku 5.5에 web_search 도구 하나만 주고 한 턴 요청을 보내는 방식입니다. 1회 검색당 약 $0.011로 추정합니다. 여기에는 검색 결과 입력 약 10k토큰, 출력 약 500토큰을 가정했고 토큰 수는 측정하지 않았습니다 [추정]. 검색 수수료 $0.01이 대부분입니다.
3. 래퍼 지연은 공식 수치가 없습니다 [미확인]. pause_turn이 올 수 있으므로 재요청 루프가 필요합니다.
4. 직접 검색 API는 모델 턴 없이 호출할 수 있고 단가가 낮습니다. Brave $5/1k와 Exa Lite $4/1k는 래퍼의 $10/1k 수수료보다 쌉니다. 무료 크레딧은 월 1,000–2,500건 규모입니다.
5. 키 없는 기본값을 원하면 선택지는 SearXNG 자가 호스팅 하나입니다. 운영 부담으로 Docker 또는 Podman, JSON 활성화, 엔진 차단 대응이 생깁니다.
6. Marginalia는 비상업 용도 키가 무료입니다. 상업 용도로 쓰려면 유료 키가 필요합니다.

### B-6. 확인하지 못한 것

- 구독 OAuth 경로에서 세 제공자의 모델 내장 검색이 되는지 [미확인]
- 래퍼 지연 수치 [미확인]
- Gemini의 지원 모델 목록과 응답 구조 원문 대조
- DuckDuckGo 약관 전문, Mojeek의 무료 한도, Marginalia 공식 페이지(404)
- SearXNG의 엔진 차단과 레이트 리밋 세부 사항, 메모리 요구
- AGPL 원문(gnu.org가 429로 차단)
- Cordis의 JS API 시그니처

---

## 상충과 확인 필요 항목

- Gemini 응답 형식: WebFetch 요약은 steps와 url_citation이라고 하고, 기존 메모 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/research/web-tools.md`는 groundingMetadata라고 적습니다.
- Jina 키 정책: 기존 메모는 키 없이 차단된다고 하고, 홈페이지 문구는 키가 상위 한도용이라고 합니다.
- Brave 무료 크레딧: 본문은 $5, 머리말은 "Up to $20"입니다.
- Serper 무료 2,500쿼리: 2차 출처이며 공식 페이지는 404입니다.
- Cordis: 저장소 밖 계획 문서에서만 DI로 전제됩니다.
- spec.md 두 사본은 574줄이 다릅니다. 줄 번호는 `_ref` 사본 기준입니다.

## 출처 목록

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- https://platform.claude.com/docs/en/about-claude/pricing
- https://developers.openai.com/api/docs/pricing
- https://ai.google.dev/gemini-api/docs/grounding
- https://docs.searxng.org/dev/search_api.html
- https://docs.searxng.org/admin/installation-docker.html
- https://github.com/searxng/searxng/blob/master/LICENSE
- https://brave.com/search/api/
- https://exa.ai/pricing
- https://tavily.com/pricing
- https://jina.ai/
- https://serper.dev/
- https://www.mojeek.com/services/api.html (WebSearch 스니펫, 2차)
- https://about.marginalia-search.com/article/api (WebSearch 스니펫, 2차)
- https://github.com/cordiverse/cordis
- https://duckduckgo.com/duckduckgo-help-pages/company/terms-of-service/