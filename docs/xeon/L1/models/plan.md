---
id: L1.models.plan
layer: L1
domain: models
kind: plan
status: draft
depends_on: [L1.models.spec, eng.testing.guide, eng.toolchain.guide, eng.dependency-rules.guide]
binds: [xeon/packages/core-models/**, xeon/plugins/provider-anthropic-oauth/**]
---

# L1 모델 게이트웨이 (models) 구현 계획

패키지 둘이다. 둘 다 스캐폴드 상태이고(`package.json`, `src/index.ts`, `test/smoke.test.ts`), 이 문서는 계획만 둔다. 코드는 수정하지 않는다.

- `xeon/packages/core-models`: `xeon.layer = "L1"`, `xeon.domain = "models"`.
- `xeon/plugins/provider-anthropic-oauth`: `xeon.layer = "L1"`, `xeon.domain = "provider-anthropic-oauth"`, `private: true`.

## 1. 목표와 마일스톤 배치

목표: `L1.models.spec`의 `xeon.models`를 구현한다. M1 스모크의 한 턴이 테이프 모델로 재생되고, 비밀 참조가 요청 직전에만 해석되며, 위장 플러그인 없이 core-models 테스트가 통과해야 한다.

마일스톤 정의는 `product.scope.spec` §4.3을 따른다. M1은 걸어 다니는 골격(`_research/foundation-plan.md` §5 P4), M2는 L2 능력과 Helm, M3는 첫 공개 릴리즈 후보(학습 그룹, 공유 서비스 모드, 목표 판정 등)다. 그 문서의 M2·M3 정의는 [제안]이다. 계획 JSON의 "2차"는 M3 이후에 둔다 [제안].

| 단계 | 범위 | 근거 |
|---|---|---|
| M0 | core-models 코드 없음. 선행: contracts에 `L1.models.spec` §3.2·§3.3의 F 요청 타입(`ModelRole`, `ModelRef`, `parseModelRef`, `ModelBinding`, `CachePolicy`, 그리고 `@xeon/contracts/services`의 `ModelService`·`ModelServiceName`)이 들어가야 한다. platform-secrets의 `SecretService` 인터페이스가 F에 있어야 한다 | `_research/foundation-plan.md` §5 P4 M0 |
| M1 | pi-ai 모델 1개 호출(`stream`, `complete`, `streamFn`), 사용량 합산(중단 응답 포함), 모델 테이프 가짜(`@xeon/core-models/testing`), 비밀 참조 해석 연결(`secretBackedCredentialStore`), `l1.models.default`·`providers`·`retry` 설정, 지점 `before_provider_request` | `_research/foundation-plan.md` §5 P4 M1 "pi-ai 모델 1개", `eng.testing.guide` TS-04 |
| M2 | 역할 표와 라우팅(6역할, 그룹 덮어쓰기), 추론 레벨·레벨별 토큰 예산 설정과 체크포인트 고정, 캐시 정책 객체와 표식 적용, provider 등록 API, 나머지 지점 5개, 허용·차단 목록. 별도 작업 줄기: 위장 provider 플러그인(방안 A 스파이크, 회귀 테스트, 배포 제외 CI 검사) | 계획 v2 L1-c 1차 행, `L1.agents.plan` M2(서브에이전트 역할) |
| M3 | 구조화 출력 최소형(목표 판정용, 재시도 루프와 횟수 상한), 레이트 리밋과 계정 회전(설정은 M3 설정 화면) | `L1.models.spec` §3.10·§4.8, `L1.agents.spec` §4.8, review.decisions-2 U-21 |
| 2차(M3 이후) | 폴백 체인, 구조화 출력 전체 | 계획 v2 L1-c 2차 행 |
| 배포 제외 | 위장 provider 플러그인은 어느 단계에서도 배포 산출물에 들어가지 않는다 | [결정] `_research/decisions-log.md` 2026-10-21 결정 2차 |

## 2. 패키지와 파일 배치

```
xeon/packages/core-models/
  package.json                 # dependencies: @xeon/contracts, @earendil-works/pi-ai 1.3.0(정확), typebox(catalog)
                               # exports: ".": src/index.ts, "./testing": src/testing/index.ts
  src/
    index.ts                   # plugin만 export. 다른 L1은 이 패키지를 import하지 않는다(DR-02)
    plugin.ts                  # 플러그인 정의: xeon.models 제공, inject [xeon.secrets, xeon.ext], 설정 등록 (M-1, M-7)
    service.ts                 # ModelService 구현: resolve, rebind, stream, complete, streamFn, list, classify (M-1)
    routing.ts                 # 설정 스냅샷 → RoutingTable, 카탈로그 조회 연결, 바인딩 변경 감지(model_select) (M-2)
    role-table.ts              # 순수 해석기 resolveRole, ROLE_FALLBACK, 패턴 일치 (M-2)
    provider-registry.ts       # addProvider, 포트 registerProvider(ModelsPort), ProviderDef 검사, pi-ai createModels/setProvider 연결 (M-4)
    usage.ts                   # UsageMeter, combineUsage 소형 포크, 종결 이벤트 기록 (M-3)
    cache-policy.ts            # CachePolicy 생성, anthropic-messages 표식 적용(onPayload), 상한 검사 (M-5)
    secrets-bridge.ts          # secretBackedCredentialStore, sk-ant-oat 가드 (M-6)
    settings.ts                # defineSettings("l1.models", …) (M-7)
    pipeline.ts                # §4.3 호출 파이프라인: 옵션 조립, 훅 연결, 지점 디스패치 (M-1, M-11)
    tokens.ts                  # TokenEstimator: pi-ai estimate 위임 (M-1)
    classify.ts                # ModelErrorKind 분류 (M-1)
    # 2차
    rate-limit.ts              # 요청 간격, 대기·전환 판단 (M-13)
    accounts.ts                # 계정 풀, core_models_* 테이블 (M-13)
    fallback.ts                # 역할별 폴백 체인 (M-14)
    structured-output.ts       # completeStructured (M-12 최소형 M3, 전체 2차)
    testing/
      index.ts                 # loadTape, tape, tapePlayer, contextHash, t (eng.testing.guide TS-04)
      tape.ts
      tape-wire.ts             # 요청 정규화·해시, 비밀 찾기·치환, tapeFetch(녹화 wire 재생) (M-15)
      tape-recorder.ts         # recordingFetch, buildRecordedTape, renderRecordedTape (M-15)
      fake-secrets.ts          # 메모리 SecretService(가짜 키 문자열 고정)
  scripts/
    record-tape.ts             # 녹화기 진입 파일. xeon/scripts/tape-record.ts가 부른다 (M-15)
    scenarios.ts               # 녹화 시나리오 표
  test/
    *.test.ts                  # §5 단위 테스트
    tapes/*.tape.jsonl

xeon/plugins/provider-anthropic-oauth/
  package.json                 # dependencies: @xeon/contracts, @earendil-works/pi-ai 1.3.0(정확), @anthropic-ai/sdk(pi-ai가 쓰는 0.129.0과 같은 판)
                               # core-models는 의존하지 않는다(L1.models.spec §3.11)
  src/
    index.ts                   # manifest, setup export
    plugin.ts                  # manifest(defaultEnabled false), setup: acknowledgeRisk 확인 → 주입받은 xeon.models.addProvider(F ProviderDef) (M-8)
    wrapper.ts                 # ProviderStreams 래퍼, SDK 클라이언트 생성, streamSimple 복제 (M-8)
    payload-rewrite.ts         # onPayload: identity, beta 조건 분기, 도구명 세 곳 (M-8)
    tool-name-map.ts           # CC 도구명 17개 표, claudeCodeVersion 고정 (M-8)
    stream-unmap.ts            # toolcall_start 역치환 래퍼 스트림 (M-8)
  test/
    anthropic-oauth.test.ts                    # pi-ai test 복사 (M-9)
    anthropic-tool-name-normalization.test.ts  # pi-ai test 복사, 실 API 필요 시 건너뜀 (M-9)
    wire-equivalence.test.ts                   # 원본 경로와 래퍼 경로의 요청 비교 (M-8)
```

- 플러그인 정의 형식(`name`, `inject`, `apply`)은 `X.primitives.spec`이 정한다 [가정]. core-models는 Cordis를 import하지 않는다(DR-11).
- 설정 탭 배치는 `L1.models.spec` §6 표다.

## 3. 작업 분해

규모: 소(하루 이하), 중(2~3일), 대(4일 이상) [가정: Sonnet·Haiku 구현자 기준 추정].

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| M-0 | contracts 선행 확인: F 요청 타입(`models.ts`), `SecretService` 인터페이스, 지점 `before_provider_request` 선언. 없으면 F·L0 트랙에 요청하고 착수하지 않는다 | contracts, platform-secrets 서비스 인터페이스 | 소 | M0 |
| M-1 | pi-ai 서비스 래퍼: `createModels`에 내장 provider 등록, `stream`·`complete`·`streamFn`, §4.3 파이프라인 1~4·7·10단계, `tokens`, `classify`. `before_provider_request` 디스패치(5단계) | M-0 | 중 | M1 |
| M-2 | 역할 표 해석기(순수): `resolveRole`, `ROLE_FALLBACK`, 허용·차단 패턴, `clampThinkingLevel` 연결, `parseModelRef` 사용 | M-0 | 소 | M2 (M1에는 `main` 역할만 쓰는 최소 경로) |
| M-3 | usage 합산: 종결 이벤트에서 `UsageRecord`, `UsageMeter.totals`·`subscribe`. coding-agent `usage-totals.ts` `combineUsage` 소형 포크 판단(가져오면 F `Usage`로 타입 교체, 아니면 15줄 안팎 자체 작성) | M-1 | 소 | M1 |
| M-4 | provider 등록 API: `addProvider(owner, name, ProviderDef)`와 `ModelsPort` 충족 `registerProvider(owner, name, ProviderResourceDef)`(JSON `kind: "config"`만, 실패는 `ModelError` 던짐), 중복 거부, `Unsubscribe`와 scope dispose, `kind: "config"` 검사(`apiKey`는 참조만) | M-1 | 중 | M2 |
| M-5 | 캐시 정책 객체: `CachePolicy` 생성(역할별 보존, model.compat에서 `midConversation*`), anthropic-messages 표식 적용, 상한 검사 | M-1, M-2 | 중 | M2 |
| M-6 | secret 참조 해석: `secretBackedCredentialStore`(요청마다 해석, 캐시 없음, modify·delete 거부), 오류 문자열 마스킹, `sk-ant-oat` 가드 | M-0, M-1 | 소 | M1 (가드는 M2) |
| M-7 | 설정 정의: `defineSettings("l1.models", …)` §6 표 전체(2차 키는 정의만), D1~D9 검사 테스트 | M-0 | 소 | M1 (M1 키 셋) → M2 |
| M-8 | 위장 래퍼 방안 A 스파이크: `_research/notes/L1-2.md` §5 S1~S6을 따른다. A2(Api id 유지, provider id `anthropic-oauth`)로 시작. 와이어 동등성 테스트(S5)를 통과하지 못하거나 `L1.models.spec` §4.11.2 전환 조건에 걸리면 방안 B 결정 기록을 남긴다 | M-4 | 대 | M2 별도 줄기 |
| M-9 | 회귀 테스트 복사: pi-ai `test/anthropic-oauth.test.ts`(로그인·갱신, 7개), `anthropic-tool-name-normalization.test.ts`(실 API 왕복, 키 없으면 건너뜀, 4개). 복사본은 실행 전 내용을 검토한다. 두 파일은 요청 형태를 보증하지 않으므로 M-8의 동등성 테스트가 주 검증이다 | M-8 | 소 | M2 |
| M-10 | 배포 제외 CI 검사: `xeon/scripts/check-release.ts`와 `.github/workflows/xeon-ci.yml`의 L1 job 항목(`L1.models.spec` §4.11.4 1~4). `just verify`에도 넣는다 | M-8 | 소 | M2 |
| M-11 | 나머지 지점 5개(`before_provider_headers`, `after_provider_response`, `provider_stream_event`, `model_select`, `thinking_level_select`), 비밀 헤더 가림, 바인딩 변경 감지 | M-1, M-2 | 중 | M2 |
| M-12 | 구조화 출력 최소형: `completeStructured`, `validateToolArguments` 재시도 루프, 시도 상한 | M-1 | 소 | M3 |
| M-13 | 레이트 리밋·계정 회전: 별도 설계 문서 먼저(§7 위험 4), `core_models_*` 테이블, 계정 선택, 대기·전환, M3 설정 화면 키(`accounts`, `rateLimit`) | M-6, 설계 문서 | 대 | M3 |
| M-14 | 폴백 체인: `overloaded`·`provider_unavailable`에서만, 콘텐츠 전 요청만 | M-1, M-2 | 중 | 2차 |
| M-15 | 테이프 녹화기(M2 마감 G4-06, 결정 D-e): `scripts/record-tape.ts <scenario> <out>`와 `testing/tape-recorder.ts`, `testing/tape-wire.ts`. 규칙은 아래 "녹화기" 절 | M-1 | 중 | M2 마감 |

- 구현 상태(M2, m2/l1c): M-2(역할 표 해석기, 허용·차단 목록), M-4(provider 등록부), M-5(캐시 정책 객체와 표식 적용), M-6의 `sk-ant-oat` 가드, M-7의 M2 키 11개를 구현했다. 설정 읽기는 `modelsSettingsOf`가 조립 루트의 `ModelsSettingsSource`를 대신한다. 나머지 지점 5개와 비밀 헤더 가림, 바인딩 변경 감지(M-11)도 구현했다. M1 고정값(추론 레벨 `medium`, 캐시 보존 `short`, 토큰 예산 null)은 설정 `l1.models.thinkingLevel`, `cacheRetention`, `thinkingBudgets`를 읽는 코드로 바꿨다(`review.open-issues` M-07의 core-models 몫). `HostedSearchPort`는 L1C.3에서 구현했다(spec §3.12).
- 녹화기(M-15) 규칙. 형식은 `xeon.model-tape.v1`을 그대로 쓰고, 차례(`ModelTapeTurn`)에 선택 필드 `wire`(`TapeWire`)를 더했다.
  - 주입 지점은 pi-ai 요청 옵션 `fetch`(1.3.0 `ProviderRequestOptions.fetch`)이고 전역 fetch는 바꾸지 않는다. 1.3.0 dist에서 확인한 결과, `anthropic-messages`, `openai-completions`, `openai-responses`, `azure-openai-responses`, `openai-codex-responses`, `mistral-conversations`, `pi-messages`는 `fetch`를 쓴다. `google-generative-ai`와 `google-vertex`는 사용자 정의 fetch를 오류로 거부하고 `bedrock`은 읽지 않는다. 이 셋은 `wire` 재생 대상이 아니다. 첫 시나리오(`hello-text`, `read-tool-call`)는 `anthropic` provider의 `claude-haiku-4-5`를 쓴다.
  - `wire`에는 메서드, 경로(쿼리·호스트 없음), 정규화한 요청 본문의 sha256(`requestHash`), 요청 요약(모델, 메시지 수, 도구 이름), 상태 코드, 허용 목록 응답 헤더(`content-type`, `request-id`, `x-request-id`, `retry-after`), 원본 SSE 덩어리 배열(`t`는 요청 후 ms, `data`는 텍스트)을 담는다. 요청 헤더는 저장하지 않는다. `response`는 같은 교환의 파싱 결과(`message`)이며, `tapeFetch`로 재생한 결과와 같아야 한다(`wire_replay_matches_recorded_response`).
  - 녹화 요청에는 `accept-encoding: identity`를 강제하고, 응답이 다른 `content-encoding`을 달면 녹화를 멈춘다.
  - 요청 본문 정규화는 키 순서를 정렬하고 `user`, `prompt_cache_key`, `safety_identifier`, `metadata.user_id`를 뺀다. 매칭 열쇠는 (메서드, 경로, `requestHash`)이고, 같은 열쇠는 테이프 순서대로 하나씩 소비한다. 헤더는 매칭에 쓰지 않는다.
  - `tapeFetch`는 짝이 없는 요청에 `TapeMismatchError`를 던지면서 `misses()`에도 남긴다. SDK가 fetch 오류를 삼켜도 `assertExhausted()`가 실패한다. 소비되지 않은 항목이 남아도 `TapeLeftoverError`로 실패한다. 재생은 기본으로 지연이 없고, `sleep`을 주면 녹화한 간격을 따른다.
  - 비밀: 키는 환경 변수(`ANTHROPIC_API_KEY`, `secrets run dev -- …`가 주입)에서만 읽고 파일과 인자로 받지 않는다. 없으면 종료코드 2와 `just secret-add ANTHROPIC_API_KEY` 안내를 낸다. 구독 OAuth 토큰, 8자 미만 키, `CI` 환경도 종료코드 2다. 본문의 `sk-ant-`, `sk-proj-`, `sk-`, `Bearer `, `AKIA`, `ghp_` 계열 패턴과 실제 키 값은 `[REDACTED]`로 바꾸고, 쓰기 직전에 텍스트 전체를 다시 훑어 하나라도 남으면 파일을 쓰지 않는다. 키가 덩어리 경계에 걸치면 치환으로 고치지 않고 녹화를 거절한다. 요청 본문에 키 패턴이 있으면 요청을 보내기 전에 멈춘다.
  - 녹화는 사람이 손으로만 한다(`just tape-record <scenario> --yes`, `--yes` 없이는 종료코드 3). 한 차례가 HTTP 요청을 하나 넘게 만들었거나(재시도), 2xx가 아니거나, 오류로 끝났으면 테이프를 만들지 않는다. 대상 파일이 있으면 덮어쓰지 않으므로 다시 녹화하려면 먼저 지운다.
- 선행 외부 작업: contracts(F 요청 타입), platform-secrets 서비스 인터페이스(`L0.secrets.spec`), X 지점 디스패치(`X.primitives.plan`), core-loop의 `streamFn` 사용(`L1.loop.plan`).
- M-2는 순수 함수라 M1에서 먼저 만들어도 된다. M1 경로는 `main` 역할과 `l1.models.default`만 쓴다.

## 4. 채택 코드

| 대상 | 방식 | 정확한 버전·원본 | 바꿀 점·확인 항목 |
|---|---|---|---|
| `@earendil-works/pi-ai` | 그대로 | 1.3.0 정확 고정(catalog). hard dependency로 `@anthropic-ai/sdk` 0.129.0, `openai` 7.19.0, `@google/genai` 2.21.0, `@aws-sdk/client-bedrock-runtime` 3.1127.0 등이 함께 설치된다. 설치 크기 4.2MB·837파일(`_research/packages.md` §1.1) | 없음. 업그레이드는 체크리스트(§7 위험 1)로만 |
| TypeBox | 그대로 | 워크스페이스 `typebox` 1.3.27. pi-ai가 고정한 판과 같다(review.decisions-2 U-24) | 확인 항목: `bun.lock`에 typebox 사본이 하나뿐인지 |
| `usage-totals.ts` `combineUsage` | 소형 포크 후보 | `~/projects/_ref/pi-src/packages/coding-agent/src/core/usage-totals.ts:31`(커밋 `cdaf6c2`) | F `Usage`로 타입 교체. 15줄 안팎이면 자체 작성 쪽이 낫다(M-3에서 판단) |
| 회귀 테스트 2개 | 복사 | `~/projects/_ref/pi-src/packages/ai/test/anthropic-oauth.test.ts`(299줄), `anthropic-tool-name-normalization.test.ts`(204줄) | import 경로를 플러그인 래퍼로 바꾼다. 실 API 테스트는 키가 없으면 건너뛴다 |
| `anthropic-messages.ts` | 방안 B를 고를 때만 포크 | `~/projects/_ref/pi-src/packages/ai/src/api/anthropic-messages.ts`(pi 커밋 `cdaf6c2`, 1639줄) | 1.3.0 dist의 재시도 루프(`dist:434-470`) 차이를 반영한다. 플러그인 안 `src/anthropic-messages-cc.ts`로 둔다 |
| 테이프 형식 | 자체 | `eng.testing.guide` TS-04 `xeon.model-tape.v1` | `role` 값은 `ModelRole` 6종 |

- 읽기 자료(코드를 가져오지 않음): omp `usage-limit.ts`, `credential-pin.ts`, `session/retry-fallback-chains.ts`(AgentSession 결합).

## 5. 단위 테스트 목록

| 테스트 | 위치 | 종류 | 확인할 동작 | 단계 |
|---|---|---|---|---|
| `resolve_role_precedence` | `test/role-table.test.ts` | unit | `explicit` > `group:<id>` > `role` > `role-fallback` > `default` 순서. 같은 입력이면 같은 결과, 입력 키 순서와 무관 | M2 |
| `resolve_group_override` | 같음 | unit | `scopeId: "helm"`의 `groupRouting.helm.review`가 `routing.review`보다 먼저. 꺼진 scope 값은 쓰지 않음 | M2 |
| `parse_model_ref_suffix_rules` | `test/model-ref.test.ts` | unit | `:high`는 레벨, `:0`은 modelId 일부, modelId 안 `/` 허용 | M1 |
| `usage_counts_aborted_response` | `test/usage.test.ts` | unit | 테이프 `error`(`aborted`, `afterContent`) 호출의 사용량이 합계에 들어가고 `abortedCalls` 1 증가 | M1 |
| `provider_registry_rejects_duplicate_api_id` | `test/provider-registry.test.ts` | unit | 같은 이름 두 번째 `addProvider`는 `provider_conflict`. 포트 `registerProvider`로 같은 이름을 등록하면 `provider_conflict` `ModelError`를 던짐. 스키마를 통과하지 않는 포트 `config`는 `invalid_provider`. `ModelService`가 `ModelsPort`에 대입 가능(타입 테스트). `Unsubscribe` 뒤 `list()`에서 빠짐. `kind: "config"`의 리터럴 `apiKey`는 거부 | M2 |
| `secret_ref_resolved_at_request_time_only` | `test/secrets-bridge.test.ts` | unit | 가짜 `SecretService`의 해석 횟수가 요청 수와 같고, 서비스 생성·`resolve` 때는 0. 요청 로그·지점 페이로드·오류 문자열에 가짜 키 문자열이 없음 | M1 |
| `oauth_token_rejected_on_default_provider` | 같음 | unit | 기본 `anthropic`에 `sk-ant-oat…` 값이면 요청 0건, `oauth_token_on_default_provider` | M2 |
| `thinking_level_pinned_in_checkpoint` | `test/routing.test.ts` | unit | `rebind`는 설정 변경과 무관하게 고정 값. 고정 모델이 카탈로그에 없으면 오류 | M2 |
| `thinking_budgets_passed_for_four_levels` | 같음 | unit | `xhigh`·`max` 값은 저장되지만 pi-ai `thinkingBudgets`에는 `minimal`~`high`만 넘어감 | M2 |
| `cache_policy_summary_role_none` | `test/cache-policy.test.ts` | unit | `summary`·`judge`·`search`는 `retention: "none"`, `sessionId` 없음. 표식이 상한 4를 넘으면 뒤쪽 위치부터 버림 | M2 |
| `classify_error_kinds` | `test/classify.test.ts` | unit | 테이프 오류 문구별로 `rate_limited`, `quota_exhausted`, `overloaded`, `context_overflow`, `auth`, `aborted` | M1 |
| `tape_model_replays_fixed_stream` | `test/tape.test.ts` | unit | `tapePlayer`가 같은 테이프로 같은 `AssistantMessageEvent` 열을 내고, 짝이 없으면 `TapeMismatchError`, 남으면 `TapeLeftoverError` | M1 |
| `wire_replay_matches_recorded_response` | `test/tape-wire.test.ts` | unit | 가짜 provider를 녹화 fetch로 감싸 만든 테이프를 `tapeFetch`로 pi-ai에 재생하면 `response`와 같은 텍스트·도구 호출·사용량이 나온다. 덩어리를 이벤트 중간에서 끊어도 같다 | M2 마감 |
| `wire_replay_miss_and_leftover_fail` | 같음 | unit | 다른 요청은 `misses()`에 남고 `assertExhausted()`가 `TapeMismatchError`, 쓰이지 않은 항목은 `TapeLeftoverError`. 같은 열쇠는 테이프 순서대로 소비 | M2 마감 |
| `recording_fetch_keeps_secrets_out` | 같음 | unit | `accept-encoding: identity` 강제, 요청 헤더·키 값 미저장, 응답 헤더 허용 목록, 되풀이된 키 치환, 덩어리 경계에 걸친 키는 쓰기 거절, 압축 응답과 요청 본문의 키는 중단 | M2 마감 |
| `record_tape_entry` | `test/record-tape.test.ts` | unit | 키 없음·`CI`·구독 토큰은 종료코드 2와 안내, 잘못된 인자는 1, 성공 시 `origin: "recorded"` 테이프 내용 비교, 이미 있는 테이프는 덮어쓰지 않음, provider 오류는 테이프 없음(가짜 fetch, 네트워크 없음) | M2 마감 |
| `stream_fn_records_usage_with_context` | `test/service.test.ts` | unit | `streamFn(ctx)` 호출의 `UsageRecord`에 `threadId`, `turnId`, `role`, `scopeId`가 그대로 실림 | M1 |
| `before_provider_request_rerun_same_result` | `test/pipeline.test.ts` | unit | `onPayload`를 두 번 부르면(재시도 모사) 같은 페이로드가 나옴 | M1 |
| `settings_defs_pass_checks` | `test/settings.test.ts` | unit | `l1.models.*` 정의가 `checkSettingDef`·`buildCatalog` 통과. 비밀 값 기본값 없음 | M1 |
| `structured_output_retries_until_cap` | `test/structured-output.test.ts` | unit | 스키마 위반 응답 두 번 뒤 통과면 `attempts: 3`. 상한이면 `schema_mismatch` | M3 |
| `oauth_wrapper_rewrites_system_and_tool_names` | 플러그인 `test/payload-rewrite.test.ts` | unit | identity 블록 삽입과 `cache_control` 복사, beta 조건 분기 세 경우(`null`, 값 있음, 없음), 도구명 세 곳 치환, placeholder 이름 보존 | M2 |
| `oauth_wrapper_unmaps_tool_names_in_response` | 플러그인 `test/stream-unmap.test.ts` | unit | `toolcall_start`에서 되돌린 이름이 후속 이벤트와 `done` 메시지에 반영 | M2 |
| `oauth_wrapper_wire_equivalence` | 플러그인 `test/wire-equivalence.test.ts` | contract | 가짜 `sk-ant-oat` 키로 원본 `stream`과 래퍼의 요청 URL·헤더(인증 값 제외)·본문 비교. 네트워크 없음(캡처 fetch) | M2 |
| `oauth_plugin_default_disabled` | 플러그인 `test/plugin.test.ts` | unit | 매니페스트 `defaultEnabled: false`. `acknowledgeRisk` 거짓이면 `addProvider` 호출 0건 | M2 |
| `request_points_remaining_five_fire` | `test/pipeline.test.ts` | unit | `before_provider_headers` 패치가 요청 헤더에 반영되고 `null` 값은 헤더를 지운다. `after_provider_response`·`provider_stream_event`는 tap으로 한 번씩 발화하고, `thinking_level_select`는 detached로 발화해 요청을 기다리게 하지 않는다(M-11) | M2 |
| `headers_point_payload_masks_secret_values` | `test/pipeline.test.ts` | unit | `before_provider_headers` 페이로드의 인증 헤더 값은 `"[secret]"`이고, 핸들러가 인증 헤더를 패치하지 않으면 실제 요청에는 해석한 값이 그대로 나간다. 지점 페이로드와 로그에 가짜 키 문자열이 없다(M-11, spec §3.9, §7.2) | M2 |
| `model_select_fires_on_binding_change` | `test/routing.test.ts` | unit | 단계 시작 바인딩이 이전 단계와 다르면 `model_select`가 한 번 발화하고, 레벨만 다르면 `thinking_level_select`만 발화한다. 바인딩이 같으면 둘 다 0회(M-11, spec §4.2 6번) | M2 |
| `release_manifest_excludes_oauth_plugin` | `xeon/scripts/check-release.test.ts` | unit | 일부러 의존을 넣은 픽스처 `package.json`에서 검사가 실패하고, 실제 워크스페이스에서는 통과 | M2 |
| `hosted_search_single_turn` | `test/hosted-search.test.ts` | unit | 서버 도구 하나만 단 단일 요청, 결과·인용·사용량 변환, `encrypted_content` 미노출, `search` 역할·캐시 없음, 요청 지점 미발화(L1C.3) | M2 |
| `hosted_search_pause_continuation` | 같음 | unit | `pause_turn` 응답의 continuation이 다음 요청에 assistant 메시지로 되돌아가고 호출자에게는 불투명하다(L1C.3) | M2 |
| `hosted_search_failures` | 같음 | unit | 조직 차단 400, 429, 도구 오류 블록, 스트림 오류, 중단, 가드 차단의 `HostedSearchError` 변환(L1C.3) | M2 |

- 테스트는 실제 모델과 네트워크를 쓰지 않는다(`eng.testing.guide` 26행). 예외는 복사한 `anthropic-tool-name-normalization.test.ts`이고 키가 없으면 건너뛴다. CI에는 키를 두지 않는다.
- 내려받은 테스트 파일은 복사 후 내용을 검토한 뒤 실행한다.

## 6. 완료 기준

1. §5의 해당 단계 테스트가 모두 통과한다.
2. `plugins/provider-anthropic-oauth`를 지운 작업 트리에서 `bun test`(core-models)가 통과한다.
3. M1 스모크(`apps/cli` scenario 테스트)의 한 턴이 테이프 모델로 재생되고, 재개 뒤 같은 바인딩으로 요청이 나간다(`L1.loop.plan` 스모크와 같은 테스트).
4. 배포 제외 검사(M-10)가 CI L1 job과 `just verify`에서 통과한다.
5. core-models의 import 목록에 `cordis`, 다른 `@xeon/core-*`, `@earendil-works/pi-agent-core`가 없다. 플러그인의 import 목록에 `@xeon/core-*`가 없고 F, X, L0, pi-ai·Anthropic SDK만 있다(check-layers, DR-07, DR-09, review.decisions-2 U-16).
6. `cd xeon && just verify` 종료코드 0.

## 7. 위험과 대응

| # | 위험 | 대응 |
|---|---|---|
| 1 | pi-ai는 minor마다 breaking 절이 있다(`_research/packages.md` §1.1 "1.1.0·1.3.0·Unreleased 모두 Breaking") | 1.3.0 정확 고정. 업그레이드 체크리스트: CHANGELOG Breaking 절 확인, `L1.models.spec` §3.1 표의 줄 위치 재확인, 위장 8곳 위치 재확인, 테이프 contract 테스트와 와이어 동등성 테스트 재실행, TypeBox 판 확인 |
| 2 | 방안 A는 payload 사후 수정이라 pi-ai 내부 구조(`tool_removal` 블록 등) 변경에 약하다 | 와이어 동등성 테스트를 업그레이드마다 돌린다. `L1.models.spec` §4.11.2의 방안 B 전환 조건 4개를 기록해 두고, 하나라도 걸리면 B로 바꾸는 결정 기록을 남긴다 |
| 3 | 위장 경로의 약관 위반과 계정 제재 | 기본 꺼짐, 배포 제외 검사, `acknowledgeRisk` 사용자 확인 문구, 관리 범위 잠금. 서버 수용과 이용 조건은 확인하지 않은 전제([가정], `L1.models.spec` §4.11.3)로 두고 공개 배포 결정 전에 확인한다 |
| 4 | 계정 회전 설계의 참고 자료가 AgentSession 결합 구현(omp)뿐이다 | M3 착수 전에 별도 설계 문서(`L1.models` 하위 design, 예: `docs/xeon/L1/models/design.md`)로 분리하고 M-13 착수 조건으로 둔다. 구독 계정 회전의 약관 검토를 그 문서에 넣는다 |
| 5 | pi-ai 설치가 provider SDK 전부를 끌어온다(4.2MB·837파일) | 단일 바이너리 크기를 L4 plan에서 측정한다. 쓰지 않는 provider의 lazy import(`api/*.lazy.ts`)가 번들에서 빠지는지 `bun build` 메타파일로 확인한다 |
| 6 | TypeBox 사본 중복 | catalog를 pi-ai와 같은 1.3.27로 고정했다(review.decisions-2 U-24). pi-ai를 올릴 때 typebox 판을 함께 확인한다 |
| 7 | 위장 플러그인의 import 규칙(review.decisions-2 U-16)이 DR-07·DR-09에 아직 반영되지 않았다 | DR-07·DR-09 개정이 반영되기 전에는 M-8을 플러그인 디렉터리 안 스파이크로만 두고 CI 층 검사 예외를 만들지 않는다 |
