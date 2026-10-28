---
id: L3.helm.plan
layer: L3
domain: helm
kind: plan
status: draft
depends_on: [L3.helm.spec, L3.group-kit.plan, L2.web.plan, L2.knowledge.plan, L2.work.plan, L1.agents.plan, X.loading-trust.plan, adr.0015]
binds: [xeon/packages/group-helm/**]
---

# L3 Helm 그룹 구현 계획

대상 스펙: L3.helm.spec(M3 세부 설계판, 2026-10-26). 패키지: `@xeon/group-helm`(`xeon/packages/group-helm`).

## 1. 목표와 마일스톤 배치

[결정] Helm 본체는 M3 범위다. 2026-10-25 M2 마감 결정 D-a가 E1(UC-2)과 Helm 본체(H-02~H-15)를 M3로 옮겼다(`review.m2-plan` §9 D-a, `review.m3-plan` M3-01). 설계 착수 시점은 "M2 마감 직후, M3 설계 단계 첫 트랙. 선행은 M3-03(adr.0015)"이다(사용자 2026-10-25). M1·M2의 drive 경로 검증은 group-kit의 테스트 그룹이 맡는다.

| 마일스톤 | 범위 | 작업 |
|---|---|---|
| M0 | 없음. 의존 대상(`contracts`의 extensions·records·capabilities·settings 타입)만 준비된다 | 없음 |
| M1 | 스캐폴드: 패키지 디렉터리, `package.json`(`xeon.layer: "L3"`, `xeon.domain: "helm"`), `tsconfig.json`, 빈 `src/index.ts`, `test/` 디렉터리. 호스트 조립 루트는 Helm을 등록하지 않는다 | H-01(완료) |
| M2 | 설정 `l3.helm.driveLimits` 하나(`src/settings.ts`). 본체 없음 | 완료 |
| M3 | Helm 본체 1차. L3-b 구성요소 5개 전부, 명령, 설정 3키 추가(M3-04), ADR-0015 효과 계수 시험, 실패 값, UC-2 통합 테스트(E1), 학습 그룹 공존 확인, `scanDriveSource` 정적 검사, 기본 플러그인 패키징(D-M3-01) | H-02 ~ H-22 |
| 2차 이후 | 렌즈 제안 경로(L3.helm.spec §10 미결 6), 다회 라운드와 종료 판정(미결 7), 신호 임계 설정 노출(미결 8) | 미배정 |

M3 착수 조건(선행):

| 선행 | 내용 | 막는 작업 |
|---|---|---|
| M3-02 | `ToolCallPayload`의 `risk`·`hints`·`caller`, `tool.execution.after`의 `input`(REQ-F-04) | H-05(`repeat`), H-08 |
| M3-new-01 | ADR-0015 구현: F `MethodDef.idempotent`·읽기 표지(REQ-F-01), F 효과 목록 문장(REQ-F-02), X 능력 래퍼 문맥 검사와 `effects` 계수(REQ-X-01), L1 spawn 멱등의 내구 기록(REQ-L1-01), L2 메서드 분류(REQ-L2-01), group-kit `replayDrive` 효과 계수(G-20) | H-10, H-11, H-19 |
| 사용자 결정(받음, 2026-10-26) | D-M3-01 c(기본 플러그인), D-M3-05 a(대기, 상한 뒤 거부), D-M3-06 a(유휴 자율 turn 허용), D-M3-07 a(안전 모드 적재 안 함), D-M3-11 c(자체 확장 API만). 동작은 L3.helm.spec §4.13 표 | H-02(`defaultEnabled`, `trust.level`), H-20(대기 거부), H-22(패키징) |
| M3-15 | X 외부 확장 로더(자체 API), 자체 패키지 가상 모듈 등록, 기본 플러그인 첫 실행 설치 | H-22, H-15 |

학습 그룹과의 관계 [결정: review.decisions-2 D-10]: Helm은 다른 그룹의 레코드를 읽지 않는다. 학습 그룹이 적용한 스킬과 메모리는 L2 지식 능력(`knowledge.search`, `knowledge.skills`, `knowledge.memory`)으로 얻는다. 그래서 학습 그룹이 M3에 들어와도 Helm 코드는 바뀌지 않고, M3에는 공존 확인(H-16)만 둔다.

## 2. 패키지와 파일 배치

```
xeon/packages/group-helm/
  package.json            # name @xeon/group-helm, private, type module, exports "." → ./src/index.ts
                          # "xeon": { "layer": "L3", "domain": "helm" }
                          # dependencies: @xeon/contracts, @xeon/group-kit (workspace:*), typebox (catalog:)
                          # devDependencies: @xeon/ext-host, @xeon/core-models, @xeon/core-agents (testing 서브패스만)
  tsconfig.json           # references: contracts, group-kit (+ 테스트용 ext-host, core-models, core-agents)
  agents/
    explorer.md           # explorer 서브에이전트 정의(형식은 L1.agents.spec) [가정]
  src/
    manifest.ts           # helmManifest
    state.ts              # HelmState 스키마, INITIAL_HELM_STATE, helmStateDecl, fitState, updateState
    phase.ts              # HelmEvent, transition, TRANSITIONS (state.ts와 failures.ts의 순환을 피해 나눔)
    reaction.ts           # reactionOf, HelmReaction
    findings.ts           # ExplorerReportSchema, parseExplorerAnswer, dedupeFindings
    inject.ts             # injectLens(input.agent.before collect 핸들러)
    signals.ts            # SIGNAL_DEFAULTS, HelmTurnTally, openTally, observeToolEnd, extractTerms, settleTurn,
                          # inquiryIdFrom, decideAction, observeTool(tool.execution.after tap), settle(boundary.settle.after tap)
    lenses.ts             # LensDef, BUILTIN_LENSES(6개), LENS_PRIORITY, selectLenses
    prompts.ts            # LensBlock, lensBlockFor, renderLensBlock, divergePrompt, applyPrompt, explorerTask,
                          # postRequestId, injectLens(input.agent.before chain), 알림 post 도우미
    guard.ts              # WRITE_DENY_REASON, ToolCallMetaView, isWriteCall, isGuardedCaller, guardWrite(tool.call.before first)
    drive.ts              # helmDrive, minLimits, turnRequestId, spawnRequestId,
                          # ActiveInquiry, activeInquiry, guarded
    knowledge.ts          # KnowledgeDigest, gatherContext, callSource, degradeOf, 외부 텍스트 감싸기
    failures.ts           # HelmFailure, failureOf, HelmCommandError(스펙 §3.12, §4.12)
    records.ts            # 레코드 payload 스키마 3종, HELM_RECORD_KINDS, recordDiscoveries, recordFinished, linkWork
    commands.ts           # HelmCommand, HelmStatusView, parseHelmCommand, runHelmCommand, helmCommand
    settings.ts           # AutoStartSchema, helmSettings, HelmSettings
    index.ts              # helmGroup = defineGroup(...), 공개 export
  test/
    unit/                 # *.test.ts (§5)
    int/
      uc2.int.test.ts     # UC-2 수용 기준 2개 재생(§5.2)
    fault/
      resume.fault.test.ts   # 프로세스 강제 종료 뒤 재개(§5.2)
    tapes/                # *.tape.jsonl (eng.testing.guide TS-04 xeon.model-tape.v1)
    fixtures/             # 가짜 explorer 응답표, 학습 레코드 픽스처, 가짜 능력 provider
```

- import 규칙: 소스는 `@xeon/contracts`, `@xeon/group-kit`, `typebox`만 import한다. `group-kit`은 DR-02 허용 목록 `DR-02/group-kit-helm`으로 허용된 유일한 같은 층 대상이다(eng.dependency-rules.guide DR-02, [결정: review.decisions-2 U-15]). `group-learning`, `cap-*`, `core-*`, `ext-host`는 소스에서 import하지 않는다(CM-06, DR-01·DR-02).
- 테스트 파일은 다른 컨텍스트의 `testing` 서브패스를 import할 수 있다(eng.testing.guide §1.2, DR-14 예외 3): `@xeon/ext-host/testing`(테스트 확장 호스트), `@xeon/core-models/testing`(테이프), `@xeon/core-agents/testing`(가짜 서브에이전트 [가정]). 시계·ID 대역은 F에 `./testing` 서브패스가 없으므로 이 패키지 `test/` 안에 F `Clock`·`IdFactory` 인터페이스로 만든다 [결정: review.decisions-2 U-03].
- 파일 단위 교체: 내부 설계가 미결인 부분(`lenses.ts`, `prompts.ts`, `signals.ts`의 판정 함수)은 공개 시그니처를 고정하고 파일 안 구현만 바꾼다(§7 위험 1).

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 작업 | 규모 |
|---|---|---|---|
| H-01 | 스캐폴드(M1): 패키지 디렉터리, `package.json`, `tsconfig.json`, 빈 `src/index.ts`, `test/` 구조. `check-layers`가 `xeon.layer`·`xeon.domain`을 통과 | P0 워크스페이스 골격, group-kit 스캐폴드(L3.group-kit.plan) | S |
| H-02 | 매니페스트와 레코드 스키마: `manifest.ts`, `records.ts`의 payload 스키마 3종과 `HELM_RECORD_KINDS` | H-01, F.extensions M0(`defineManifest`, `RecordKindDecl`, `validateManifest`) | S |
| H-03 | 상태 스키마: `HelmStateSchema`, `INITIAL_HELM_STATE`, `helmStateDecl`, `fitState`(직렬화 60 KiB 예산), `updateState`(직렬 큐 + `fitState`) | H-02 | S |
| H-04 | 설정: `helmSettings`(`defineSettings("l3.helm", …)`)에 `autoStart`, `maxLenses`, `writeGuard`를 더해 4개 키(M3-04). `driveLimits`는 M2에 있다. `HelmSettings` | H-01, F.wire-settings `defineSettings`·`checkSettingDef` | S |
| H-05 | 신호: 순수 함수(`openTally`, `observeToolEnd`, `settleTurn`, `extractTerms`(스펙 §3.5 규칙), `inquiryIdFrom`, `decideAction`)와 tap 핸들러 2개(`tool.execution.after`는 메모리 집계만, `boundary.settle.after`는 기록과 turn당 1회 커밋). suggest 모드 post(`when: "next"`). `input`이 없으면 `repeat` 집계를 건너뛴다 | H-03, H-04, M3-02(`tool.execution.after.input`) | M |
| H-06 | 단계 전이: `HelmEvent`, `transition`, `TRANSITIONS`. 스펙 §4.2 표와 1:1. 임대 필요 판정 훅은 두지 않는다(스펙 §3.3) | H-03 | M |
| H-07 | 주입: `lenses.ts`(내장 렌즈 6개, `LENS_PRIORITY`, `selectLenses(pending, …)`), `prompts.ts`(블록 구조, 단계별 문구 본문, turn 입력, explorer 과제, requestId), `input.agent.before` chain 핸들러, 알림 post(`when: "next"`), `agents/explorer.md` 본문과 `risk: read` 도구 목록 | H-06 | M |
| H-08 | 쓰기 거부: `ToolCallMetaView`, `isWriteCall`(`risk !== "read"`), `isGuardedCaller`(`main`, `subagent:explorer`), `guardWrite`. 메타 없음 경고(`/helm status`) | H-03, H-04, M3-02(`ToolCallPayload.risk`·`hints`·`caller`) | S |
| H-09 | drive 단계 머신: `helmDrive`(단계당 한 분기, 커밋 후 반환), `activeInquiry`, `guarded`, `minLimits`, requestId 함수, `parseExplorerAnswer`, `dedupeFindings`, 상한·중지·부분 실패 처리. 비null 단언 없이 `Result`로 좁힌다 | H-06, H-07, group-kit M2 산출물(`defineGroup`, `DriveArbiter`, `replayDrive`), X.primitives 임대 API(부여·`idle` 반납·`LeaseBudget`), L1.agents `loop.spawn`(explorer 정의 로딩) | L |
| H-10 | 지식 소비: `gatherContext`(읽기 호출, requestId 없음), `callSource`, `degradeOf`, 저하 동작 표, 외부 텍스트 감싸기 | H-09, H-20, L2.web 최소형(`web.search` 서비스, `WebSearchKey`), F `capabilities/defs` 키 상수, L2 읽기 표지(REQ-L2-01. 없으면 `effect_not_allowed` 저하 경로만 동작) | M |
| H-11 | 발견 기록과 작업 연결: `recordDiscoveries`, `recordFinished`, `linkWork`(`work.tasks`의 `create({ content })`, 멱등 쓰기, requestId `helm:<inquiryId>:cap:task:<findingId>`, 발견별 `Result`) | H-09, H-10, L2.work `WorkTasksKey`와 `idempotent: true` 선언(없으면 건너뛰는 경로만) | M |
| H-12 | 명령: `parseHelmCommand`, `runHelmCommand`(`Result<HelmStatusView, HelmCommandError>`), `helmCommand`(kind별 문장, `assertNever`), `HelmStatusView`(group-kit `GroupStatus`에서 임대 상태) | H-06, H-20, group-kit `GroupApi.registerCommand`(L3.group-kit.plan G-22) | S |
| H-13 | 조립: `index.ts`의 `helmGroup = defineGroup(...)`와 플러그인 엔트리 export. 조립 루트(`apps/host`)에는 Helm 등록을 두지 않는다. 호스트 설정 카탈로그에 `helmSettings`를 싣는 한 줄(L3.helm.spec §10 미결 13 [제안]) | H-05, H-07, H-08, H-09, H-11, H-12 | S |
| H-14 | 재생·재개 단위 테스트: `replayDrive`로 단계마다 재호출, 임대 교체 뒤 requestId 안정성 | H-13 | M |
| H-19 | 재생 2회, 효과 1회 시험(스펙 §4.11): `replayDrive` 효과 계수로 모든 커밋 지점에서 끊고 drive·on 핸들러를 두 번 실행. `apply` 분기 안 두 지점 추가 | H-14, L3.group-kit.plan G-20(효과 계수 확장, M3-new-01) | M |
| H-20 | 실패 값: `failures.ts`(`HelmFailure`, `failureOf`, `reactionOf`, `HelmCommandError`), `updateState`의 `Result` 반환과 `state_conflict` 1회 재시도, 대기 거부 처리(스펙 §4.13 D-M3-05 a: `lease.rejected` 구독 핸들러) | H-03, 내구 이벤트 `lease.rejected`와 구독 수단(없으면 대기 거부 경로만 빼고 진행) | M |
| H-22 | 기본 플러그인 패키징(D-M3-01): `.xeon-plugin/plugin.json` 생성(매니페스트 대조 테스트), 엔트리 번들 빌드(`@xeon/contracts`·`@xeon/group-kit`·`typebox`는 외부 import), 릴리즈 자원 배치, 첫 실행 설치와 갱신 규칙(원본 해시 일치 때만 교체), 외부 로더 적재 int 테스트(`user` 등급, 안전 모드 미적재) | H-13, X.loading-trust 외부 확장 로더와 가상 모듈 등록(M3-15), L4 릴리즈(M3-27) | M |
| H-21 | 효과 등급 적합 시험: 선언 없는 메서드를 가진 가짜 provider로 X 래퍼 거부와 저하 동작 확인, on 핸들러의 능력 호출 0 확인(스펙 §9 21번) | H-10, H-11, X.primitives 능력 래퍼 문맥 검사(REQ-X-01) | S |
| H-15 | 통합 테스트: UC-2 테이프 재생(int)과 강제 종료 뒤 재개(fault) | H-13, `@xeon/ext-host/testing`, `@xeon/core-models/testing`, 가짜 서브에이전트 | M |
| H-16 | 학습 그룹 공존 확인: `grp.learning.*` 레코드 픽스처가 있어도 `gatherContext`가 다른 그룹 레코드를 읽지 않는지 검사([결정: review.decisions-2 D-10]), 학습 그룹과 공존 통합 확인 | H-10, L3.learning M3 | S |
| H-17 | 문서 대조: 스펙 §4.2 전이표, §3.4 kind 목록, §6 설정 표와 코드 상수 대조 테스트 | H-04, H-06, H-02 | S |
| H-18 | 정적 결정성 검사: `scanDriveSource`로 `drive.ts` 검사(테스트 26번) | H-09, L3.group-kit.plan G-19(M3) | S |

순서: H-02 → H-03 → H-20 → H-04 → H-05 → H-06 → H-07 → H-08 → H-09 → H-10 → H-11 → H-12 → H-13 → H-14 → H-19 → H-21 → H-22 → H-15 → H-16 → H-18. H-04와 H-06, H-05와 H-07은 병렬로 진행할 수 있다. H-17은 H-06 뒤 아무 때나 한다. H-01은 M1에 끝났다.

선행 산출물(다른 계획):

| 산출물 | 소유 계획 | Helm 작업 |
|---|---|---|
| `defineGroup`, `GroupApi.settings()`, `GroupApi.registerCommand`, `DriveArbiter`, `replayDrive`, `GroupStatus` | L3.group-kit.plan (M2: G-04, G-05, G-07, G-12, G-15, G-22) | H-09, H-12, H-13, H-14 |
| `scanDriveSource` | L3.group-kit.plan (M3: G-19) | H-18 |
| 임대 부여·`idle` 반납, `LeaseBudget`, 상한 집행, `lease.*` 이벤트 | X.primitives.plan | H-09 |
| `loop.spawn`, 그룹 제공 에이전트 정의 로딩 | L1.agents.plan | H-09, H-15 |
| `web.search` 최소형(내장 검색 래퍼 또는 SearXNG) | L2.web.plan | H-10 |
| `knowledge.search`, `knowledge.skills`, `knowledge.memory` 읽기 능력 | L2.knowledge.plan | H-10(없으면 저하 동작) |
| `work.tasks`의 `create` | L2.work.plan | H-11(없으면 건너뜀) |
| `ToolCallPayload.risk`·`hints`·`caller`, `tool_execution_end.input` | F.records·F.extensions, L1.tools.plan(M3-02, REQ-F-04) | H-05, H-08 |
| `MethodDef.idempotent`·읽기 표지, `effect_not_allowed`, X 능력 래퍼 문맥 검사 | F.capabilities.plan, X.primitives.plan(M3-new-01, REQ-F-01, REQ-X-01) | H-10, H-11, H-21 |
| `loop.spawn` (thread, `requestId`) 멱등의 세션 DB 기록 | L1.agents.plan(REQ-L1-01) | H-15 fault, H-19 |
| L2 메서드 효과 등급 선언(`web.search`, `knowledge.*` 읽기, `work.tasks.create` 멱등) | L2.web·knowledge·work plan(REQ-L2-01) | H-10, H-11 |
| `replayDrive` 효과 계수(G-20 확장) | L3.group-kit.plan | H-19 |
| 내구 이벤트 `lease.rejected`, `GroupStatus.drive`의 `"rejected"`와 대기 상한 | L3.group-kit.plan G-30, X.primitives.plan(REQ-X-08, D-M3-05) | H-20 |
| 외부 확장 로더(자체 API), `@xeon/contracts`·`@xeon/group-kit`·`typebox` 가상 모듈 등록, 첫 실행 설치 | X.loading-trust.plan(M3-15), L4 릴리즈(M3-27) | H-22, H-15 |

## 4. 채택 코드

- 그대로 쓰는 외부 패키지 코드: 없다. L3-b는 자체 구현이다(`_research/packages.md` §4.6 L3-b "Helm 고유 내용이라 선례가 없다").
- 포크: 없다. 외부 저장소에서 가져오는 코드가 없다.

| 의존 | 판 | 쓰임 |
|---|---|---|
| `@xeon/contracts` | `workspace:*` | F 타입(extensions, records, capabilities, settings) |
| `@xeon/group-kit` | `workspace:*` | `defineGroup`, `GroupApi`, 테스트 도우미 `replayDrive`(M2), `scanDriveSource`(M3, G-19) |
| `typebox` | 1.3.27(`catalog:`, L3.group-kit.plan §4 표, eng.toolchain.guide TC-02) | 상태·레코드·설정 스키마 |

- 참고 자료(코드 복사 없음): 사용자 의사코드(`_research/layer-plan-v2-notes.md` "Helm이 보이는 모양"), ext-points 안 1 재생·토글 보장(`_research/ext-points.md` §5), F `renderSearch`의 외부 내용 표지(F.capabilities.spec §3.9).

## 5. 단위 테스트 목록

테스트 가짜: 모델은 테이프(`@xeon/core-models/testing`, eng.testing.guide TS-04), 서브에이전트는 렌즈별 응답표를 받는 가짜 `loop.spawn`, 능력은 `ServiceKey`별 가짜 provider(`WebSearchKey`, `KnowledgeSearchKey`, `KnowledgeSkillsKey`, `KnowledgeMemoryKey`, `WorkTasksKey`. L3.helm.spec §3.8), 시계·ID는 `test/` 안의 대역(F `Clock`·`IdFactory` 구현)이다. 실제 네트워크와 모델을 쓰지 않는다.

### 5.1 단위 테스트

| # | 테스트 이름 | 확인할 동작 |
|---|---|---|
| 1 | `manifest.valid-and-usage-matches` | `helmManifest`가 `validateManifest` 오류 0, setup 뒤 `validateUsage` 오류 0. `points` 6개, `usesDrive`·`usesPost` 참 |
| 2 | `records.discovery-schema-valid` | 예시 발견 payload가 `DiscoveryRecordedPayloadSchema`와 F `validateGroupRecord`를 통과하고, `confidence` 범위 밖 값은 실패 |
| 3 | `records.kinds-have-group-prefix` | `HELM_RECORD_KINDS` 3개가 `grp.helm.` 접두와 `RECORD_KIND_PATTERN`을 만족 |
| 4 | `state.initial-valid` | `INITIAL_HELM_STATE`가 스키마를 통과하고 `helmStateDecl.version`이 1 |
| 4a | `state.worst-case-fits-64kib` | 모든 배열이 개수 상한이고 모든 문자열이 길이 상한인 한국어 최악 입력에 `fitState`를 적용하면 직렬화 UTF-8이 60 KiB 이하이고 스키마를 통과한다. 같은 입력이면 같은 결과다. 예산 안 입력은 바꾸지 않는다 |
| 4b | `records.discovery-worst-case-under-16kib` | `claim` 1000자, 출처 4개(`ref` 512자, `title` 80자) 한국어 최악 `DiscoveryRecordedPayload`의 직렬화 UTF-8이 16 KiB 이하다 |
| 5 | `state.update-serializes-concurrent-commits` | `updateState` 두 개를 동시에 부르면 두 변경이 모두 남는다(커밋 교체로 잃지 않음) |
| 6 | `settings.defs-pass-check` | 4개 키가 `checkSettingDef`를 통과하고 키·기본값이 스펙 §6 표와 같다 |
| 7 | `signals.stuck-after-n-same-errors` | 같은 도구의 같은 오류 3회 연속이면 `stuck` 1건, 중간에 성공이 끼면 0건 |
| 8 | `signals.repeat-after-n-same-calls` | 같은 도구·같은 정규화 인자 3회 연속이면 `repeat` 1건, 인자 키 순서만 다르면 같은 호출로 센다 |
| 9 | `signals.newdomain-on-knowledge-misses` | 한 turn 지식 검색 빈 결과 2회면 `boundary.settle.after`에서 `newDomain` 1건, 다음 turn에서 카운터가 0 |
| 10 | `signals.pure-query-no-side-effect` | 같은 페이로드로 핸들러를 두 번 실행해도 집계표, 커밋된 `watch`, 기록 수가 한 번 실행과 같고, 능력 호출·post 호출 수가 0(suggest 아닌 경우). `boundary.settle.after` 재실행의 커밋·기록은 `replayed`다 |
| 10a | `signals.commit-once-per-turn` | 도구 호출 5회가 있는 turn에서 `g.commit`은 `boundary.settle.after`의 1회이고 `tool.execution.after`·`input.agent.before`는 커밋하지 않는다 |
| 11 | `signals.autostart-modes` | `off`는 기록만, `suggest`는 `when: "next"` post 1건(같은 turn 재실행 시 `duplicate: true`, 유휴 thread에서 turn을 열지 않음), `auto`는 `pending` 커밋 뒤 Helm이 다시 임대 후보가 된다(테스트 호스트에서 다음 경계에 `lease.acquired`) |
| 12 | `transitions.table-covers-all-phase-pairs` | 모든 (단계, 이벤트) 쌍을 열거해 표에 있으면 표의 다음 단계, 없으면 같은 상태 |
| 13 | `transitions.finish-resets-inquiry` | `idle`로 가는 전이가 탐구 필드를 초기화하고 `finished`를 채운다 |
| 14 | `guard.denies-write-in-diverge-only` | `diverge`·`explore`에서 쓰기 도구는 `{ block: true }`, 읽기 도구는 `undefined`. `idle`(pending 포함)·`converge`·`apply`에서는 모두 `undefined` |
| 15 | `guard.respects-write-guard-setting` | `writeGuard` 거짓이면 확산 단계에서도 `undefined` |
| 16 | `guard.exception-becomes-deny` | 메타 조회가 예외를 내면 테스트 호스트의 first 디스패치 결과가 `FIRST_DENY["tool.call.before"]` |
| 17 | `guard.unknown-meta-is-write` | `risk`가 없는 도구는 확산 단계에서 거부. `hints.readOnly: true`여도 `risk: exec`면 거부. `caller`가 `subagent:explorer`가 아닌 서브에이전트면 허용 |
| 18 | `inject.one-lens-at-a-time` | 어느 단계에서도 시스템 프롬프트 블록에 렌즈 본문이 둘 이상 들어가지 않는다 |
| 19 | `inject.appends-to-current` | 핸들러가 받은 원본 `payload.systemPrompt` 뒤에 Helm 블록이 붙는다(collect 지점이라 다른 핸들러의 패치를 보지 않는다) |
| 20 | `inject.requestid-dedup` | `postRequestId`가 같은 (inquiryId, phase, round)에 같은 값, 64자 이하. 같은 알림 두 번 post면 두 번째가 `duplicate: true` |
| 21 | `drive.recall-from-committed-state-spawns-once` | `replayDrive`로 각 커밋 뒤 drive를 다시 호출해도 렌즈별 spawn 1회, 적용 turn 1회 |
| 22 | `drive.n-lenses-n-spawns-then-one-apply-turn` | 렌즈 N(1, 3, 8)개면 spawn N회, 모든 결과 커밋 이벤트 뒤 적용 turn 1회 |
| 23 | `drive.limit-reached-releases-lease` | `maxTurns`·`maxSpawns` 소진 시 `inquiry.finished`(`limit`), 알림 post 1건, 임대 `releasing` |
| 24 | `drive.partial-failure-commits-rest` | 렌즈 3개 중 1개 `error`면 `done` 2·`failed` 1로 수렴, 적용 turn 실행, `failedLenses` 1 |
| 25 | `drive.requestids-stable-across-lease-change` | 임대를 반납하고 새 `leaseId`로 다시 받아도 같은 탐구의 spawn·turn requestId가 같아 중복 실행이 없다 |
| 26 | `drive.source-is-deterministic` (H-18) | `scanDriveSource`가 `drive.ts`에서 `Date.now`, `Math.random`, 직접 I/O를 찾지 못한다 |
| 27 | `knowledge.degrades-when-web-missing` | `web.search` provider가 없거나 `unavailable`이면 `degraded`에 `web`, 탐구는 `applied`로 끝남 |
| 28 | `knowledge.learning-absent-is-empty` | 학습 그룹이 없어도 `gatherContext` 결과가 같고 `readRecords` 호출은 0이다 |
| 29 | `knowledge.untrusted-text-wrapped` | 외부 텍스트가 표지로 감싸지고, 본문 안 표지 문자열이 이스케이프된다. 본문 내용에 따라 전이가 바뀌지 않는다 |
| 30 | `commands.start-stop-status` | `/helm start 주제`가 `pending` 커밋, 탐구 중 start는 오류, `/helm stop`이 `stopRequested` 커밋, `status`는 상태를 바꾸지 않음 |
| 31 | `disable.at-step-boundary-releases-lease` | 탐구 중 disable 요청 뒤 다음 단계 경계에서 `lease.released`(`disabled`) 1건, 핸들러 미호출, 상태 보존, 다시 켜면 같은 단계에서 이어짐 |
| 32 | `coexist.learning-on-while-helm-holds-lease` | 테스트 호스트에 drive를 쓰지 않는 가짜 그룹(학습 그룹 역할, `group-learning` import 없음)을 함께 켜고, Helm 임대 중에도 그 그룹의 on 핸들러와 post가 동작 |
| 33 | `coexist.waiting-lease-keeps-signals` | 다른 그룹이 임대를 가진 동안 `pending` 유지, `phase` `idle`, 신호 기록 계속, 쓰기 거부 없음 |
| 34 | `restore.invalid-state-resets` | `session.start`에서 스키마 위반 상태면 초기 상태 커밋과 `inquiry.finished`(`failed`) |
| 35 | `replay.twice-effects-once` (H-19) | UC-2 기준 실행의 모든 커밋 지점에서 끊고 drive·on 핸들러를 두 번 실행해도 새 turn 2, 새 spawn 3, 새 작업 2, 종료 알림 1, `inquiry.finished` 1(스펙 §4.11 표) |
| 36 | `replay.apply-split-points` (H-19) | `recordDiscoveries`와 `linkWork` 사이, `linkWork`와 `applied` 커밋 사이에서 끊어도 작업 2개, 적용 turn 1회 |
| 37 | `failures.reaction-covers-all-kinds` (H-20) | 모든 `HelmFailure` kind × 단계 쌍이 스펙 §4.12 표의 `HelmReaction`을 돌려준다 |
| 38 | `failures.unknown-error-rethrown` (H-20) | `failureOf`가 모르는 예외(`Bug`, `TypeError`)는 drive 밖으로 다시 던져지고 테스트 호스트의 `GroupStatus.lastError`가 `group.driveThrew`다 |
| 39 | `failures.state-conflict-retries-once` (H-20) | 가짜 X가 `state_conflict`를 한 번 내면 `updateState`가 다시 읽어 성공하고, 두 번 내면 `state_conflict` 실패를 돌려준다 |
| 40 | `failures.missing-inquiry-finishes-failed` (H-09) | `phase: "explore"`, `inquiryId: null` 상태로 drive를 부르면 예외 없이 `inquiry.finished`(`failed`)와 초기 상태 커밋 |
| 41 | `lease.wait-rejected-clears-pending` (H-20) | `lease.rejected` 이벤트의 구독 핸들러가 `pending`을 지우고 거부 알림 1건을 `post`한다. 같은 이벤트로 재실행하면 `duplicate`이고, 핸들러는 `GroupStatus`를 읽지 않는다 |
| 42 | `effects.no-capability-in-on-handlers` (H-21) | 신호 지점 세 개를 실행하는 동안 가짜 provider 호출 수가 0 |
| 43 | `knowledge.undeclared-method-degrades` (H-21) | `readOnly` 선언이 없는 `web.search` 정의로 바꾸면 X 래퍼가 `effect_not_allowed`로 거부하고 provider는 불리지 않으며 탐구는 `degraded`에 `web`을 넣고 끝난다 |
| 44 | `work.link-idempotent-across-replay` (H-11) | 같은 `findingId`로 `linkWork`를 두 번 부르면 가짜 work provider의 작업이 1개이고 두 번째 결과가 처음 결과와 같다 |
| 45 | `lenses.priority-by-signal` (H-07) | `stuck`, `repeat`, `newDomain`, `command` 각각에서 `selectLenses`가 스펙 §3.6 우선순위 앞 `maxLenses`개를 고르고 같은 입력에 같은 결과 |
| 46 | `signals.extract-terms-rules` (H-05) | 백틱, 대문자 약어, 낙타 표기·하이픈 낱말, 한글 3자 이상 낱말을 순서대로 모으고 불용어·중복을 빼며 16개, 64자에서 자른다 |

추가: `knowledge.no-cross-group-records`(H-16). `grp.learning.skill.applied`, `grp.learning.skill.proposed` 레코드 픽스처를 테스트 호스트 로그에 넣어도 `gatherContext` 결과 출처에 들어가지 않고 `readRecords` 호출은 0이다([결정: review.decisions-2 D-10]).

### 5.2 테이프 시나리오

eng.testing.guide TS-01의 `scenario` 태그는 저장소 전체에 1개(`apps/cli`)다. Helm의 두 시나리오는 패키지 안 `int`, `fault` 태그로 둔다 [제안].

| 파일 | 이름 | 내용 | 확인 |
|---|---|---|---|
| `test/int/uc2.int.test.ts` | `uc2.write-deny-and-n-lenses` (M3 E1 스모크) | 테스트 확장 호스트에 Helm을 켜고 `/helm start`. 테이프: 발산 turn에서 모델이 `bash`(`risk: exec`)와 `write`(`risk: write`, `cap-workspace`가 있을 때)를 호출 → 거부 결과를 받고 답한다. 가짜 explorer 3개 응답. 적용 turn 1회. 그 뒤 Helm을 끄고 같은 쓰기 호출을 담은 turn 실행 | UC-2 수용 기준 2개: 거부 사유가 도구 결과로 모델에 돌아가고 도구는 실행되지 않음, 끈 다음 turn에서 같은 호출 실행. spawn 3회와 `explored` 커밋 뒤 적용 turn 1회. 테이프 `assertExhausted()` |
| `test/fault/resume.fault.test.ts` | `resume.after-kill-in-explore` | 자식 프로세스로 테스트 호스트를 띄우고 `explore` 단계에서 spawn 2개 커밋 뒤 SIGKILL(`XEON_TEST_KILLPOINT`, eng.testing.guide TS-08). 같은 데이터 디렉터리로 재시작 | 렌즈별 서브에이전트 결과 1개, 적용 turn 1회, `inquiry.finished` 1건. 불변식 비교(D1), 이벤트열 바이트 비교 안 함 |

## 6. 완료 기준

1. L3.helm.spec §9 수용 기준과 테스트가 아래 표처럼 대응하고 모두 통과한다.

| 수용 기준(L3.helm.spec §9) | 테스트 |
|---|---|
| 1 확산 단계 쓰기 거부, 끈 뒤 실행 | `uc2.write-deny-and-n-lenses`, `guard.denies-write-in-diverge-only` |
| 2 렌즈 N개 → spawn N, 적용 turn 1 | `uc2.write-deny-and-n-lenses`, `drive.n-lenses-n-spawns-then-one-apply-turn` |
| 3 재호출해도 spawn 중복 없음 | `drive.recall-from-committed-state-spawns-once`, `drive.requestids-stable-across-lease-change`, `resume.after-kill-in-explore` |
| 4 학습 그룹 꺼져도 동작 | `knowledge.learning-absent-is-empty`, `coexist.learning-on-while-helm-holds-lease` |
| 5 임대 대기 중 신호 기록 계속 | `coexist.waiting-lease-keeps-signals` |
| 6 `writeGuard` 거짓 | `guard.respects-write-guard-setting` |
| 7 first 예외는 거부 | `guard.exception-becomes-deny` |
| 8 신호 핸들러 재실행 안전 | `signals.pure-query-no-side-effect` |
| 9 전이표 | `transitions.table-covers-all-phase-pairs` |
| 10 부분 실패 | `drive.partial-failure-commits-rest` |
| 11 상한 도달 | `drive.limit-reached-releases-lease` |
| 12 단계 경계 disable | `disable.at-step-boundary-releases-lease` |
| 13 스키마·매니페스트 검증 | `records.discovery-schema-valid`, `manifest.valid-and-usage-matches` |
| 14 웹 없음 저하 동작 | `knowledge.degrades-when-web-missing` |
| 15 import 범위, 코어 diff 0 | `check-layers`, 아래 3번 |
| 16 재생 2회, 효과 1회 | `replay.twice-effects-once`, `replay.apply-split-points` |
| 17 쓰기 판정 표 | `guard.unknown-meta-is-write`, `guard.denies-write-in-diverge-only` |
| 18 주입 | `inject.one-lens-at-a-time`, `inject.appends-to-current` |
| 19 대기 거부 | `lease.wait-rejected-clears-pending` |
| 20 실패 값 처리 | `failures.reaction-covers-all-kinds`, `failures.unknown-error-rethrown`, `failures.state-conflict-retries-once` |
| 21 효과 등급 | `effects.no-capability-in-on-handlers`, `knowledge.undeclared-method-degrades` |
| 22 단언 없는 상태 좁히기 | `failures.missing-inquiry-finishes-failed` |

2. `cd xeon && just verify`가 종료코드 0이다(oxfmt, oxlint type-aware, `tsc -b`, check-layers, depcruise, knip, 영향 범위 `bun test`).
3. Helm 본체를 추가하는 변경(M3의 H-02~H-21 커밋 묶음)에서 `xeon/packages/contracts/**`, `xeon/packages/ext-host/**`, `xeon/packages/group-kit/**` 경로의 diff가 0이다(product.vision.spec S1 "코어 수정 없이 그룹 추가"). 이 조건을 깨야 하면 해당 변경을 F·X·group-kit 계획의 작업으로 먼저 넣고 Helm 작업은 그 뒤에 한다.
4. H-17 대조 테스트가 스펙 §4.2 전이표, §3.4 kind 목록, §6 설정 표와 코드 상수의 일치를 확인한다.
5. 패키지 커버리지는 eng.testing.guide TS-10의 L3 임계를 넘는다.

## 7. 위험과 대응

| # | 위험 | 대응 |
|---|---|---|
| 1 | M3 판에서 정한 내부 설계(렌즈 6개, 신호 임계, 프롬프트 문구)가 사용 뒤 바뀐다 | 공개 시그니처(`selectLenses`, `lensBlockFor`, `observeToolEnd`, `settleTurn`, `transition`)와 상태 스키마를 고정하고, 내용은 파일 단위(`lenses.ts`, `prompts.ts`, `signals.ts` 판정부)로 바꾼다. 테스트는 렌즈 선택 규칙(`lenses.priority-by-signal`)만 보고 렌즈 문구에 기대지 않는다 |
| 2 | 서브에이전트 병렬 실행 비용이 커진다 | 임대 상한(`maxSpawns`, `maxTokens`)을 `l3.helm.driveLimits`로 걸고 천장 `x.primitives.driveLimits`로 자른다(review.decisions-2 U-12). 기본 `maxLenses` 3. 남은 spawn 예산보다 렌즈가 많으면 앞 렌즈만 실행한다(`drive.limit-reached-releases-lease`) |
| 3 | 프롬프트 주입: 웹·지식·explorer 답의 숨은 지시가 적용 turn이나 쓰기를 유도한다 | 외부 텍스트를 DATA로 감싸고 코드 경로가 그 내용으로 분기하지 않는다(L3.helm.spec §4.7). 확산 단계 쓰기 거부, explorer 정의의 쓰기 도구 제외, 적용 단계의 일반 승인·샌드박스 정책. `knowledge.untrusted-text-wrapped` |
| 4 | drive 클로저 상태 실수로 재개 뒤 동작이 바뀐다 | 단계당 한 분기·커밋 후 반환 구조, `replayDrive` 재호출 테스트(`drive.recall-from-committed-state-spawns-once`), 리뷰 규칙 EV-09. M3 이후 `scanDriveSource` 정적 검사(H-18)를 더한다 |
| 5 | 선행 계약(M3-02 도구 메타, M3-new-01 ADR-0015 구현, REQ-L1-01 spawn 멱등 내구 기록)이 늦어진다 | Helm 작업을 선행별로 나눴다(§3 선행 열). 메타가 없으면 모두 쓰기로 보는 안전 쪽 동작, 효과 등급 선언이 없으면 `effect_not_allowed` 저하 경로로 동작한다. E1 완료 판정은 선행이 모두 들어온 뒤 한다 |
| 6 | `commit` 교체 의미 때문에 on 핸들러와 drive의 동시 커밋이 서로를 덮어쓴다 | `updateState` 직렬 큐와 `state_conflict` 1회 재시도(`state.update-serializes-concurrent-commits`, `failures.state-conflict-retries-once`). X가 CAS를 주면 큐를 지운다(REQ-X-02) |
| 7 | 재시작 뒤 spawn이 중복된다 | 탐구 id 기반 명시 requestId(`drive.requestids-stable-across-lease-change`)와 L1 spawn 멱등의 세션 DB 기록(REQ-L1-01). `resume.after-kill-in-explore`가 둘을 함께 확인한다 |
| 8 | `record`와 `commit` 사이 강제 종료로 발견 기록이 중복된다 | `findingId` 중복 제거 키, 읽는 쪽 중복 제거 규칙. 원자 API(REQ-X-03)가 생기면 바꾼다 |
| 9 | 도구 메타가 비어 확산 단계에서 읽기 도구까지 거부된다 | M3-02를 H-08의 선행으로 둔다. 메타가 없는 도구 목록을 `/helm status`에 보여 준다 |
| 10 | 기본 플러그인 적재 경로(외부 로더, 가상 모듈 등록, 첫 실행 설치)가 M3-15·M3-27보다 늦어진다 | H-02~H-21은 `defineGroup` 단위 테스트와 `@xeon/ext-host/testing`으로 진행한다. 적재 경로가 늦으면 E1 통합 시험(H-15)만 테스트 하네스의 직접 설치로 돌리고, H-22 int 테스트는 로더가 들어온 뒤 한다 |
| 11 | 읽기 능력 호출이 재생마다 다시 불려 비용이 는다 | `converge` 한 분기에서만 부르고 결과를 `converged` 커밋으로 고정한다. 재생 횟수는 커밋 지점 사이 끊김 수만큼이라 정상 운영에서는 0이다 |
