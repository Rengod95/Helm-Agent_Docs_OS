---
id: L3.learning.plan
layer: L3
domain: learning
kind: plan
status: draft
depends_on: [L3.learning.spec, adr.0015, L3.group-kit.plan, L2.knowledge.plan, L1.agents.plan, product.scope.spec, eng.testing.guide, eng.dependency-rules.guide]
binds: [xeon/packages/group-learning/**]
---

# L3 학습 그룹 구현 계획

## 1. 목표와 마일스톤 배치

목표는 L3.learning.spec의 1차 구성요소(학습 트리거, 검토 포크, 승인 대기열, 메타인지 피드백 제안)를 M3에 넣는 것이다. 근거는 `product.scope.spec` 4.1 I8(학습 그룹 M3), 4.3 M3 행, 4.4 M3 종료 조건, 4.5 UC-3 행이다.

- M3 설계 개정(2026-10-26): spec §1.0의 변경(ADR-0015 효과 분류, `agent.settled` 구독, 지연 정리, 범위 선택, Result 종류)에 맞춰 작업 LR-03·LR-05·LR-09·LR-15를 고치고 LR-23~LR-28을 더했다. `review.m3-plan`의 작업 번호는 M3-new-03(학습 그룹 1차)이다(`review.m3-design-inputs` §5.2).
- 사용자 결정 D-M3-02(기본 켬), 03(보고 없음), 04(끄기 때 즉시 취소), 09(프로젝트 범위는 승인 화면에서만), 32(대기열 둘)를 받았다(2026-10-26, `review.m3-design-inputs` §3). 작업은 이 결정대로 구현한다.

| 마일스톤 | 학습 그룹 작업 | 선행 조건(다른 층) |
|---|---|---|
| M0 | 없음. 패키지 골격(`export {};`)만 있다 | F 계약 골격, check-layers |
| M1 | 없음 | F.extensions 지점 타입, X `on`·`post`·`scope` 구현, 이벤트 저장 |
| M2 | 없음. group-kit M2 완료가 선행 조건이다 | L3.group-kit.plan M2(`defineGroup`, `GroupApi`, 도구·명령 등록 `registerTool`·`registerCommand`(G-22)), L2.knowledge.plan(읽기 능력) |
| M3 | 1차 구성요소 전부(LR-01~LR-18, LR-23~LR-28). UC-3 스모크 | M3-new-01(ADR-0015 구현), spec §8.1 REQ-LN-01~11, L1.agents.plan 백그라운드 위임(M3-new-02), L2.knowledge.plan 쓰기·원장·스캔 API, L4.settings-ui.plan 설정 화면, L4 승인 화면 계약 |
| M4 이후(2차) | 큐레이터, 학습 이력, 스크립트 제안(LR-19~LR-22) | L2-h 예약(큐레이터 트리거를 예약으로 정할 때), L2-d 백업 API |

구성요소별 배치:

| 구성요소 | 차수 | 마일스톤 | 작업 |
|---|---|---|---|
| 학습 트리거 | 1차 | M3 | LR-01~LR-04 |
| 검토 포크 | 1차 | M3 | LR-05~LR-07 |
| 승인 대기열 | 1차 | M3 | LR-08~LR-11, LR-27 |
| 메타인지 피드백 제안 | 1차 | M3 | LR-13 |
| 레코드·명령·통합 | 1차 | M3 | LR-14~LR-18 |
| 완료 구독·취소·재생 시험·범위 선택 | 1차 | M3 | LR-23~LR-28 |
| 큐레이터 | 2차 | M4 이후 | LR-19, LR-20 |
| 학습 이력 보기 | 2차 | M4 이후 | LR-21 |
| 반복 작업 스크립트 제안 | 2차 | M4 이후 | LR-22 |

## 2. 패키지와 파일 배치

패키지 `xeon/packages/group-learning`(`@xeon/group-learning`, `package.json`의 `xeon.layer = "L3"`, `xeon.domain = "learning"`). 이 문서를 쓰는 단계에서 코드는 만들지 않는다.

```text
xeon/packages/group-learning/
  src/
    index.ts              defineGroup 진입점. default export
    manifest.ts           defineManifest 상수(spec §3.1)
    state.ts              LearningStateSchema, INITIAL_LEARNING_STATE
    results.ts            DecisionResult, ApplyTransition, QueueSweep, LearningError(spec §3.9)
    settings.ts           defineSettings("l3.learning", …)(spec §6.1)
    triggers.ts           TurnTally 집계(boundary.turn.before, boundary.step.after), applyTurn, reviewRequestId, on 핸들러 등록
    review/
      fork.ts             buildReviewSpec, reviewTokenBudget, g.delegate 호출, agent.settled 구독과 reviewFinishOutcome, 취소
      policy.ts           toolPolicy.allow 기본값(DelegateToolPolicy), learning_propose 도구 등록과 검사
      prompts.ts          검토 지시 생성(spec §4.4 요구 사항)
    proposals/
      queue.ts            Proposal 타입, 상태 전이 순수 함수, 이벤트 초안, 투영기
      apply.ts            L2-d KnowledgeChangeApi 어댑터(apply, rollback)
      scan.ts             사전 스캔(자체 검사 + L2-d scan)
    feedback.ts           feedback 후보 검사와 target 규칙
    records.ts            레코드 8종 스키마, learningRecordKindDecls, 레코드 쓰기 도우미
    commands.ts           /learning queue|review|history
    curator/              (2차) 유휴 판정, 결정적 단계, LLM 통합 요청
    history/              (2차) 이력 합치기, 되돌리기
    scripts/              (2차) 반복 명령 묶음 탐지
  agents/
    learning-review.md    검토 포크 서브에이전트 정의(형식은 L1.agents.spec §4.9). 매니페스트 components.agents(spec §3.1)
  test/
    *.test.ts             단위
    uc3.int.test.ts       UC-3 테이프 통합(§5.2)
    tapes/                *.tape.jsonl
    fixtures/
```

- import 허용: `@xeon/contracts`(F), `@xeon/group-kit`(DR-02 허용 목록 `DR-02/group-kit`, `eng.dependency-rules.guide` DR-02, [결정: review.decisions-2 U-15]), 테스트 파일에서만 `@xeon/core-models/testing`(테이프, `eng.testing.guide` TS-04)과 각 패키지의 `testing` 서브패스(DR-14 예외, review.decisions-2 U-17). F에는 `./testing` 서브패스가 없으므로 시계·ID 대역은 이 패키지 `test/` 안에 둔다(review.decisions-2 U-03).
- import 금지: `cap-*`(L2-d는 `g.capability(<ServiceKey>)`로만 쓴다), `core-*`(위임은 `g.delegate`로만 쓴다), `ext-host`, `platform-*`, `group-helm`(CM-06).
- 의존 추가: 외부 npm 의존을 더하지 않는다. `typebox`는 workspace catalog의 1.3.27를 쓴다(`catalog:`, L3.group-kit.plan §4 표, eng.toolchain.guide).

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| LR-01 | 매니페스트와 상태: `manifest.ts`, `state.ts`, `index.ts`의 `defineGroup` 뼈대. `validateManifest` 통과 테스트 | group-kit M2(`defineGroup`, `GroupDef<S>`) | S |
| LR-02 | 설정: `settings.ts`에 spec §6.1의 12개 키 `SettingDef`. 설정 읽기 실패 시 fail-closed 경로 | LR-01, F.wire-settings `defineSettings` | S |
| LR-03 | 카운터 집계: `boundary.turn.before`로 집계표 열기, `boundary.step.after`(chain, `undefined` 반환)로 step당 도구 반복 계수와 `stepId` 중복 방지, 도구 이름 기반 스킬 쓰기 판정(spec §4.2) | LR-01, F `TurnEndPayload` | M |
| LR-04 | 임계 판정 순수 함수: `applyTurn`(규칙 0 `in_flight` 포함), `reviewRequestId`, `boundary.settle.after` 핸들러의 상태 커밋(턴당 1회). `origin`·`status`·`hasFinalAnswer`·`lastItemId` 읽기와 필드가 없을 때의 임시 규칙 | LR-02, LR-03, REQ-LN-01 | S |
| LR-05 | 포크 호출: `buildReviewSpec`(`fork: { at: "item" }`, `report` 없음 [결정: review.m3-design-inputs D-M3-03]), `reviewTokenBudget`, `reviewStartOutcome`, on 핸들러의 `g.delegate`(ADR-0015)와 "위임 먼저, 커밋 나중" 순서, `delegateFailures`, `grp.learning.fork.started`, `agents/learning-review.md` 정의 | LR-04, REQ-LN-05·07·08, group-kit `GroupApi.delegate`(G-14) | M |
| LR-06 | 제안 도구와 허용 목록: `g.registerTool`로 `learning_propose` 등록, 입력 검사, 읽기 선행 가드(`baseHash`), 후보 수 상한, `toolPolicy.allow` 기본값과 거부 안내 문장(`denyHint`) | LR-05, group-kit `registerTool`(G-22), L1.tools 실행 시점 허용 검사 | M |
| LR-07 | 검토 지시: `prompts.ts` 요구 사항 7항목(신호, 선호 순서, 저장 금지, 메모리 영역, DATA 방어, 출력 규약, 편향 문구 금지) 문구 본문 작성 | LR-05 | M |
| LR-08 | Proposal 이벤트와 투영: `grp.learning.proposal.*`·`grp.learning.fork.*` 비공개 기록 9종, `learningProjector`, `x_learning_proposals`·`x_learning_reviews` DDL | LR-06. X `ScopeApi.recordPrivate`(review.decisions-2 T-21, spec §3.7.1)의 X 구현 | M |
| LR-09 | 승인 전이: 상태 전이 순수 함수(spec §4.5 표), `ProposalDecision` 처리, 명령 진입 지연 정리 `sweepQueue`(만료, `approved` 재적용) | LR-08, LR-28 | M |
| LR-10 | L2-d 적용 어댑터: `apply.ts`의 `apply`·`rollback` 호출, 멱등 키, `base_stale`·`scan_failed`·`io` 처리 | LR-09, L2.knowledge 쓰기·원장·롤백 API | M |
| LR-11 | 사전 스캔: 자체 검사와 L2-d `scan` 호출, `findings` 규칙 이름만 저장 | LR-09, L2.knowledge 스캔 API(선택) | S |
| LR-13 | 피드백 제안: `feedback.ts`의 `kind: "feedback"` 검사, `target` 규칙, 메모리 `user` 영역 적용 연결 | LR-06, LR-10 | S |
| LR-14 | 레코드 발행: `records.ts` 8종 스키마와 `recordKinds` 선언, 전이마다 레코드 쓰기 | LR-09 | S |
| LR-15 | 명령: `g.registerCommand("learning", …)`로 `/learning queue` 하위 명령 6종(`approve --scope` 포함), `/learning review [--cancel]`, `--json` 출력(`ProposalView`, `DecisionResult`). 진입 때 `sweepQueue` | LR-09, LR-10, LR-28, group-kit `registerCommand`(G-22), REQ-LN-03, L4 승인 화면 계약 | M |
| LR-16 | 공존 확인: Helm 임대 중 동작, `drive` 호출 0 계측 | LR-05, group-kit `DriveArbiter` | S |
| LR-17 | 사용량 계측: 검토별 입력·출력 토큰을 `x_learning_reviews`와 `GroupMetrics`에 남김 | LR-05, L1.agents 사용량 부모 귀속 | S |
| LR-18 | UC-3 테이프 통합 테스트와 M3 코어 diff 0 확인 | LR-01~LR-17, LR-23~LR-28 | M |
| LR-19 | (2차) 큐레이터 결정적 단계: 유휴 판정, 14일 stale, 30일 archive 후보, 고정·참조·사용자 생성 스킬 제외, archive도 대기열 | LR-09, L2-d 사용 기록과 "에이전트 생성" 표시, spec §10 미결 6 | M |
| LR-20 | (2차) 큐레이터 LLM 통합: 옵트인, 실행 전 백업 요청, 검토 포크와 같은 위임 경로 | LR-19, L2-d 백업 API | M |
| LR-21 | (2차) 학습 이력: 대기열과 원장 시간순 합치기, `/learning history`, 되돌리기 | LR-10, `knowledge.ledger.read` | M |
| LR-22 | (2차) 스크립트 제안: 반복 명령 묶음 탐지(최소 반복 3회 [가정]), `kind: "script"` 후보 | LR-06, LR-10 | M |
| LR-23 | 완료 구독: `agent.settled` 구독 핸들러, `reviewFinishOutcome`, `fork.finished`·`review.finished` 기록, `settledReviewId` 커밋과 `inFlightReviewId` 비우기(§4.3 선후 경합). 구독이 없을 때 명령 진입의 `g.delegateStatus` 대체 경로 | LR-05, REQ-LN-02·07·08 | M |
| LR-24 | 그룹 끄기 취소: `onDispose`의 `g.cancelDelegates`와 `inFlightReviewId` 커밋(REQ-X-12 [가정]), 커밋하지 못하는 구성에서는 다시 켠 뒤 `inFlightReviewId` 정리 [결정: review.m3-design-inputs D-M3-04] | LR-23, REQ-LN-06·08 | S |
| LR-25 | ADR-0015 재생 시험: 모든 커밋 지점에서 끊고 재개, 핸들러 2회 실행, 위임·기록·커밋 계수 1(spec §9 17·18·19) | LR-05, LR-23, group-kit `replayDrive` 효과 계수(G-20 확장), M3-new-01 | M |
| LR-26 | 범위 선택과 신뢰 표지: `Proposal.scope`, `approve --scope`, `KnowledgeChange.scope`, `afterUntrusted` 기록과 화면 필드 [결정: review.m3-design-inputs D-M3-09] | LR-09, LR-10, REQ-LN-01·09·10 | S |
| LR-27 | 충돌 처리: `name_exists` 거부, 유사 스킬 `conflictsWith`(옛 LR-12 충돌 표시를 대신한다. LR-12 번호는 비워 둔다) | LR-06 | S |
| LR-28 | Result 종류: `results.ts`의 `DecisionResult`, `ApplyTransition`, `QueueSweep`, `LearningError`와 분류 순수 함수 | LR-01 | S |

선행 조건(다른 층):

- spec §8.1의 REQ-LN-01~REQ-LN-11. 이 중 REQ-LN-01(`AgentSettledPayload` 필드), REQ-LN-02(`agent.settled` 구독), REQ-LN-05(위임 멱등 내구화), REQ-LN-08(`report` 선택화와 위임 조회·취소)이 없으면 검토 포크가 시작되지 않거나 한 번만 돈다. 학습 그룹 착수(LR-05) 전에 F·X·L1 계약 트랙이 끝나 있어야 한다.
- M3-new-01(ADR-0015 구현): X 능력 래퍼의 on 핸들러 문맥 검사와 코어 멱등의 내구 기록.

- group-kit M2: `defineGroup`, `GroupApi<S>`의 `settings()`, `delegate(spec)`(M2는 입력 검사만, 호출은 M3의 G-14), `metrics`, `registerTool`·`registerCommand`(G-22)(L3.group-kit.plan). 비공개 기록 경로는 X `ScopeApi.recordPrivate`다(review.decisions-2 T-21, spec §3.7.1). group-kit은 이 연산을 그대로 전달한다(L3.group-kit.spec §3.2). 그래서 LR-08이 X 구현을 선행으로 갖는다.
- L1.agents 백그라운드 위임: 접수 결과(`accepted`/`duplicate`), 부모 대화 범위 `requestId` 멱등, 스냅샷 복제, 실행 시점 도구 허용 검사, 반복·토큰 상한, 사용량 부모 귀속, 취소, 완료 통지(L1.agents.plan).
- L2.knowledge 쓰기·원장·승인 API: 읽기 능력 4종, `apply`(멱등 키, 승인 증거, `base_stale`), 스캔, 롤백, "에이전트 생성" 표시(L2.knowledge.plan).
- L4 승인 화면 계약: `ProposalView`와 `/learning queue` 명령 호출 경로(L4.desktop, L4.cli), 설정 화면 `plugins` 탭(L4.settings-ui.plan).

## 4. 채택 코드

그대로 쓰는 외부 패키지는 워크스페이스 공용 `typebox` 1.3.27(`catalog:`, L3.group-kit.plan §4 표)뿐이다. Hermes 소스는 가져오지 않는다. Hermes는 MIT 라이선스이고 Python이므로 개념만 TypeScript로 재구현한다(`_research/refs/hermes.md` §4.1 라이선스 항목, §4.2 첫 항목). 아래 표의 소스 경로는 설계 참고 위치이며, 커밋은 `0319e113c9602b86ffda350e931cb4b035e1d5d8`이다(`_research/notes/L3-3.md` §0).

| Hermes 요소 | 참고 위치 | 학습 그룹 대응 | 바꾸는 점 |
|---|---|---|---|
| 카운터 트리거 | `agent/turn_context.py:758-767`, `agent/turn_iteration_prep.py:166-167`, `agent/tool_executor.py:744-747`, `agent/turn_finalizer.py:763-791`(`hermes.md` §3.10.1 (가)) | `triggers.ts` `applyTurn` | 단계 경계 이벤트(`boundary.turn.before`, `tool.execution.after`, `boundary.settle.after`) 기준. 순수 함수로 분리. 커밋 턴당 1회 |
| 캐시 패리티 포크 | `background_review.py:965-975`, `1147-1160`(`hermes.md` §3.10.1 (나) 8) | `review/fork.ts` `buildReviewSpec` | 스레드 대신 L1-g 백그라운드 위임. 캐시 공유는 L1.agents 지원 여부에 따름 [가정] |
| 디스패치 화이트리스트 | `background_review.py:1088-1131`(`hermes.md` §3.10.1 (나) 9) | `review/policy.ts` `toolPolicy.allow`(group-kit `DelegateToolPolicy`) | 스킬 쓰기 툴셋도 허용하지 않는다. 허용은 읽기와 `learning_propose`뿐 |
| 읽기 선행 가드 | `tools/skill_manager_guards.py:211-221`(`hermes.md` §3.10.1 (다)) | `learning_propose`의 `baseHash` 검사 | "같은 검토 안의 읽기 기록" 대신 내용 해시 비교 |
| 델타 노트 | `agent/skills_index_delta.py:1-14`(`hermes.md` §3.10.1 (라)) | 직접 구현하지 않음. 스킬 인덱스 변경 알림은 L2-d·L1-e 몫 | 적용 결과는 레코드 `grp.learning.skill.applied`로만 알린다 |
| 아카이브 전용 큐레이터 | `agent/curator.py:160-263`, `1085-1160`, `agent/curator_backup.py:1-6`(`hermes.md` §3.10.1 (마)) | `curator/`(2차) | archive도 대기열을 거친다. LLM 통합 결과도 대기열 |
| 저장 금지 블록 | `background_review.py:423-446` | `review/prompts.ts` 요구 3 | 문구는 새로 쓴다 |
| 쓰기 승인 스테이징 | `tools/write_approval.py:74-86`, `201-213` | `proposals/queue.ts` | 기본 켬. 보관을 best-effort로 하지 않고 이벤트 커밋으로 한다 |

## 5. 단위 테스트 목록

테스트 계층과 이름은 `eng.testing.guide` TS-01을 따른다. 모델이 필요한 테스트는 테이프(`@xeon/core-models/testing`의 `tape`, `tapePlayer`)로 검토 포크 응답을 재생한다. L1-g·L2-d는 각 패키지 `testing` 서브패스의 가짜 구현을 쓴다(TS-05) [가정: 해당 가짜가 제공됨]. 시계와 ID는 주입한다(TS-03).

### 5.1 단위

| 테스트 이름 | 확인할 동작 | 작업 |
|---|---|---|
| `manifest.validates` | `validateManifest` 오류 0, `usesDrive: false`, 지점 4개, 레코드 8종 접두 `grp.learning.` | LR-01 |
| `settings.defs-valid` | 12개 키가 `checkSettingDef`를 통과하고 기본값이 spec §6.1과 같다 | LR-02 |
| `settings.read-failure-fails-closed` | 설정 읽기 실패 시 `g.delegate`와 `apply` 호출 0 | LR-02 |
| `triggers.counts-user-turns` | 사용자 turn 10회째 `boundary.settle.after`에서 `review/user_turns` | LR-03, LR-04 |
| `triggers.counts-tool-iterations-per-step` | 한 step의 도구 3개는 반복 1회(`boundary.step.after` 하나). 같은 `stepId`의 `boundary.step.after` 재발화도 1회. 핸들러 반환값은 `undefined` | LR-03 |
| `triggers.skips-aborted-and-scheduled-turns` | `aborted`, `error`, `scheduled`, `remote`, `delegation`, `drive` turn은 사용자 turn 수를 올리지 않고 검토를 시작하지 않는다 | LR-04 |
| `triggers.resets-on-skill-write` | `skill_manage` 또는 `learning_propose` 도구 결과가 있는 step 뒤 도구 반복 카운터 0 | LR-03 |
| `triggers.zero-threshold-disables-reason` | 임계 0이면 그 사유로는 검토하지 않는다 | LR-04 |
| `triggers.commit-once-per-turn` | turn 하나에 `g.commit` 1회 | LR-04 |
| `triggers.fork-has-zero-counters` | 검토 포크 대화의 turn은 집계하지 않고, 포크 대화에서 `g.delegate` 호출 0 | LR-04, LR-05 |
| `fork.requestid-dedup-after-restart` | `delegate` 뒤 커밋 전 크래시 모의 → 재발화 → 같은 `requestId`, `duplicate`, 자식 대화 1개 | LR-05 |
| `fork.token-budget-defaults` | 창 200k → 150k, 창 1M → 600k, 창 미상 → 120k, 설정값 우선 | LR-05 |
| `fork.denies-write-tools-and-returns-hint` | 테이프에서 포크가 `write`를 부름 → 거부 결과에 `learning_propose` 안내, 후보 0 | LR-06 |
| `fork.respects-iteration-and-token-limits` | 17번째 step 없음, 예산 초과 시 `outcome: "budget"` | LR-05, LR-06 |
| `fork.three-denials-end-review` | 거부 3회 연속이면 검토 종료 | LR-06 |
| `propose.patch-requires-fresh-base-hash` | `baseHash` 없음 → `base_missing`, 다름 → `base_stale` | LR-06 |
| `prompts.contains-required-blocks` | 신호 4종, 선호 순서, 저장 금지 5종, DATA 방어 표지 문자열이 모두 있다 | LR-07 |
| `queue.transitions-follow-table` | spec §4.5 표의 모든 (현재, 사건) 쌍. 표에 없는 쌍은 거부 | LR-09 |
| `queue.pending-does-not-touch-files` | `pending`·`rejected`·`expired`만 있을 때 L2-d `apply` 호출 0, 가짜 저장소 파일 해시 불변 | LR-09, LR-10 |
| `queue.approve-applies-via-knowledge-api-only` | 승인 → `KnowledgeChangeApi.apply` 1회, 멱등 키 `learning:apply:<id>:<rev>`, 파일 시스템 직접 쓰기 0 | LR-10 |
| `queue.destructive-ops-always-pending` | `approval.required = false`여도 `patch`, `archive`, `replace`, `remove`는 `pending` | LR-09 |
| `queue.scan-failure-marks-rejected` | 사전 스캔 `block` 또는 `apply`의 `scan_failed` → `rejected/scan_failed`, 본문 문자열이 투영·레코드에 없다 | LR-10, LR-11 |
| `queue.base-stale-returns-to-pending` | 승인 뒤 원본 변경 → `pending/base_stale`, 새 diff | LR-10, LR-27 |
| `queue.revert-uses-ledger` | `revert` → `rollback(ledgerId)` 1회, 성공 시 `reverted`, `hash_mismatch` 시 `applied/rollback_refused` | LR-10 |
| `queue.sweep-on-command-entry` | 결정 처리 도중 적용 전에 프로세스를 끊고 다시 띄운 뒤 아무 `/learning` 명령 진입 때 `approved` 미적용 행을 같은 `idempotencyKey`로 재적용하고(가짜 L2-d 원장 행 1개) 만료 행을 `expired`로 바꾼다. on 핸들러에서는 정리하지 않는다 | LR-09 |
| `queue.projection-rebuild-equal` | 이벤트에서 투영을 다시 만들면 같은 행. `diff`가 16 KiB를 넘는 제안을 만들고 프로세스를 재시작해 재생해도 `x_learning_proposals`의 `diff`가 원문과 같고 승인된 제안의 재적용·만료 판정 결과가 재시작 전과 같다 | LR-08 |
| `feedback.frustration-signal-creates-proposal` | 좌절 표현이 있는 테이프 세션 → `kind: "feedback"` 후보 1개와 `grp.learning.feedback.proposed` | LR-13 |
| `coexist.helm-lease-held-fork-still-runs` | 테스트 drive 그룹이 임대를 가진 상태에서 임계 도달 → 포크 시작, 학습 그룹 `drive` 호출 0 | LR-16 |
| `records.schema-valid` | 8종 예시 payload가 스키마를 통과하고 `validateGroupRecord`를 통과한다 | LR-14 |
| `commands.queue-json-matches-view` | `/learning queue --json` 출력이 `ProposalView[]` 스키마를 따른다 | LR-15 |
| `triggers.in-flight-blocks-second-review` | `inFlightReviewId`가 있는 동안 임계 도달 → `skip/in_flight`, `g.delegate` 0회. 종료 기록 뒤 다음 turn에 1회 | LR-04, LR-23 |
| `triggers.settle-before-commit-clears-inflight` | 자식이 §4.3의 4번 커밋보다 먼저 정착(즉시 오류)하는 순서 → 구독 핸들러가 `settledReviewId`를 커밋하고 4번이 `inFlightReviewId`를 세우지 않는다. 다음 turn에 임계 도달 시 검토가 시작된다 | LR-04, LR-23 |
| `triggers.missing-last-item-id-no-review` | `lastItemId`가 없는 페이로드 → 검토 시작 0회, 카운터 유지 | LR-04 |
| `fork.uses-item-fork-point` | `buildReviewSpec`의 `fork`가 `{ at: "item" }`이고 `report`가 없다 | LR-05 |
| `fork.delegate-failure-counts` | `{ ok: false }` 3회 연속 → 세 번째에 카운터 0, `delegateFailures` 0 | LR-05 |
| `settled.finish-records-once` | 같은 `agent.settled`로 구독 핸들러 2회 → `fork.finished`·`review.finished` 각 1개, `inFlightReviewId` null | LR-23 |
| `settled.ignores-foreign-request-ids` | `requestId`가 `learning:review:`로 시작하지 않거나 주체가 다른 scope → `ignore` | LR-23 |
| `settled.status-fallback-on-command` | 구독 없는 구성에서 `/learning queue` 진입 → `delegateStatus` 조회로 종료 기록 | LR-23 |
| `dispose.cancels-in-flight-review` | 검토 중 그룹 끄기 → `cancelDelegates` 1회, 자식 `agent.settled{ aborted }` | LR-24 |
| `dispose.clears-inflight-id-after-cancel` | 그룹 끄기 뒤 다시 켜면 `inFlightReviewId`가 null이고 명령을 부르지 않아도 다음 임계에서 검토가 시작된다. `onDispose`에서 커밋하지 못하는 구성이면 첫 명령 진입의 대체 조회로 비워진다 | LR-24 |
| `replay.agent-settled-twice-one-delegate` | ADR-0015: 모든 커밋 지점에서 끊고 재개, `boundary.settle.after` 2회 실행 → 위임 1, `fork.started` 1, 상태 반영 1 | LR-25 |
| `replay.no-capability-calls-in-handlers` | on 핸들러·구독 핸들러 실행 중 `g.capability` 호출 0 | LR-25 |
| `scope.tool-proposals-are-user-scope` | `learning_propose`로 만든 스킬 후보의 `scope`는 `user` | LR-26 |
| `scope.approve-project-scope` | `approve --scope project` → 적용 어댑터 `scope: "project"`. 메모리 후보 → `learning.scopeNotAllowed` | LR-26 |
| `propose.after-untrusted-flag` | `caller.afterUntrusted = true` 문맥의 제안 → `afterUntrusted: true`, `ProposalView`에 같은 값 | LR-26 |
| `propose.create-existing-name-refused` | 같은 이름 스킬이 있을 때 `create` → `name_exists`, 대기열 행 0 | LR-27 |
| `results.apply-outcome-mapping` | L2 실패 코드마다 `ApplyTransition` 값이 spec §4.5 표와 같다 | LR-28 |
| `curator.stale-after-14d-archive-after-30d` | (2차) 주입 시계로 14일·30일 경계, archive는 대기열 후보로만 생김 | LR-19 |
| `curator.skips-pinned-and-user-created` | (2차) 고정, 예약 참조, 사용자 생성, 번들 스킬은 후보 0 | LR-19 |

### 5.2 테이프 통합 (M3 스모크)

- 이름: `group-learning/test/uc3.int.test.ts`의 `uc3.threshold-review-queue-and-helm-coexist`.
- 구성: 실제 SQLite 임시 파일, X·group-kit 실구현, L1-g·L2-d 가짜, 테스트용 drive 그룹(Helm 대역), 테이프 `test/tapes/uc3-review.tape.jsonl`(주 대화 10 turn + 검토 포크 응답).
- 확인: (1) 임계를 넘는 세션에서 포크가 백그라운드로 1회 실행되고 후보가 대기열에 들어가며, 승인 전 스킬 디렉터리와 메모리 파일 해시가 같다. (2) drive 그룹이 임대를 가진 동안에도 (1)이 성립한다. (3) 승인 뒤에만 L2-d `apply`가 불린다.
- [제안] 계층(L-IN-19): `eng.testing.guide` TS-01은 `scenario` 계층을 저장소 전체에 1개(`apps/cli` 스모크)로 제한한다. 이 테스트는 패키지 안 `int` 계층으로 둔다. 실제 SQLite와 X·group-kit 실구현을 쓰므로 UC-3 검증에 충분하고, 저장소 전체 스모크 수 제한을 바꾸지 않는다.
- 추가 확인(M3 설계 개정): (4) 검토 결과가 부모 대화의 모델 입력에 없다([결정: review.m3-design-inputs D-M3-03]). (5) 검토 도중 프로세스를 끊고 재개해도 자식 대화는 1개다(ADR-0015).

## 6. 완료 기준

1. spec §9 수용 기준과 테스트 대응표가 모두 통과한다.

   | 수용 기준(spec §9) | 테스트 |
   |---|---|
   | 1 UC-3 임계·포크 1회·승인 전 불변 | `uc3.threshold-review-queue-and-helm-coexist`, `triggers.counts-user-turns` |
   | 2 Helm 임대 중 동작 | `uc3.threshold-review-queue-and-helm-coexist`, `coexist.helm-lease-held-fork-still-runs` |
   | 3 임계 미만 포크 0 | `triggers.counts-user-turns`(경계 9회 사례), `triggers.counts-tool-iterations-per-step` |
   | 4 승인 전 파일 불변 | `queue.pending-does-not-touch-files` |
   | 5 같은 epoch 포크 중복 0 | `fork.requestid-dedup-after-restart` |
   | 6 drive 호출 0 | `coexist.helm-lease-held-fork-still-runs`, `manifest.validates` |
   | 7 쓰기 도구 거부와 제안 도구로만 후보 | `fork.denies-write-tools-and-returns-hint` |
   | 8 제외 turn | `triggers.skips-aborted-and-scheduled-turns`, `triggers.fork-has-zero-counters` |
   | 9 스킬 쓰기 리셋 | `triggers.resets-on-skill-write` |
   | 10 스캔 실패 거절 | `queue.scan-failure-marks-rejected` |
   | 11 파괴적 연산 승인 필수 | `queue.destructive-ops-always-pending` |
   | 12 레코드·매니페스트 스키마 | `records.schema-valid`, `manifest.validates` |
   | 13 검토 지시 요구 사항 | `prompts.contains-required-blocks` |
   | 14 원장 롤백 | `queue.revert-uses-ledger` |
   | 15 비공개 기록 9종 | `queue.projection-rebuild-equal`, `records.schema-valid` |
   | 16 큰 diff 재생 | `queue.projection-rebuild-equal`(큰 diff와 재시작 사례 포함) |
   | 17 재생 2회 위임 1회 | `replay.agent-settled-twice-one-delegate`, `fork.requestid-dedup-after-restart` |
   | 18 구독 재생 기록 1회 | `settled.finish-records-once` |
   | 19 핸들러 능력 호출 0 | `replay.no-capability-calls-in-handlers` |
   | 20 진행 중 검토 | `triggers.in-flight-blocks-second-review` |
   | 21 보고 미주입(D-M3-03 a) | `uc3.threshold-review-queue-and-helm-coexist` 확인 (4), `fork.uses-item-fork-point` |
   | 22 끄기 취소(D-M3-04 b) | `dispose.cancels-in-flight-review` |
   | 23 delegation·drive 제외 | `triggers.skips-aborted-and-scheduled-turns` |
   | 24 범위 선택(D-M3-09 c) | `scope.tool-proposals-are-user-scope`, `scope.approve-project-scope` |
   | 25 같은 이름 거부 | `propose.create-existing-name-refused` |
   | 26 재적용 원장 1행 | `queue.sweep-on-command-entry` |
   | 27 정착이 시작 커밋보다 먼저인 경합 | `triggers.settle-before-commit-clears-inflight` |
   | 28 취소 뒤 `inFlightReviewId` 복구 | `dispose.clears-inflight-id-after-cancel` |

2. M3 검증(`product.scope.spec` 4.4 M3, 5절): 학습 그룹을 추가하는 변경에서 `xeon/packages/contracts/**`, `xeon/packages/ext-host/**`, `xeon/packages/platform-*/**`, `xeon/packages/core-*/**` 경로의 diff가 0이다. 확인 방법은 그 변경 묶음에 대한 `git diff --stat <기준>..HEAD -- <경로들>` 결과가 비어 있는 것이다. 같은 검사를 `xeon/scripts/core-diff-check.ts <기준 커밋>`이 한다(`bun scripts/core-diff-check.ts <기준>`, 종료코드 0 통과, 1 위반, 2 환경 문제). 필요한 F·X·L1 변경은 학습 그룹 변경보다 앞선 별도 변경으로 끝나 있어야 한다.
3. 학습 그룹이 쓰는 연산(`on`, `scope`, `recordPrivate`, `record`, group-kit `delegate`)이 통합 테스트에서 호출된다(`product.scope.spec` 4.4 M3, `product.vision.spec` S1). `post`는 쓰지 않는다(spec §7, `usesPost: false`).
4. 승인 전 파일 불변 검증: 통합 테스트가 가짜 L2-d 저장소의 스킬 디렉터리와 메모리 파일 해시를 세션 전, 후보 생성 뒤, 거절 뒤에 비교하고 모두 같다.
5. `just verify`가 종료코드 0이다. `just check-layers`와 `just depcruise`가 `group-learning`의 import를 허용 목록 안으로 확인한다.
6. 2차 작업(LR-19~LR-22)은 M3 완료 기준에 넣지 않는다.

## 7. 위험과 대응

| 위험 | 내용 | 대응 |
|---|---|---|
| 검토 포크 비용 | Hermes 기준 검토 한 번에 약 3만 토큰이다(`hermes.md` §3.10.1 (가) 5, turn_finalizer.py:780). 사용자 10 turn마다 돌면 누적 비용이 크다 | 임계와 토큰 예산을 설정으로 노출한다. 예약·원격 turn은 세지 않는다. 검토별 사용량을 `x_learning_reviews`와 `GroupMetrics`로 계측해 설정 화면에 보인다(LR-17). 캐시 접두 공유는 L1.agents가 지원할 때만 기대한다 |
| 학습 품질을 재는 장치 부재 | Hermes에도 스킬 품질 평가가 없다(`hermes.md` §3.10.1 (바) 셋째 항목, §4.3 둘째 항목) | 1차는 승인율·거절 사유·되돌림 수를 계측만 한다. 평가 루프(테이프 녹화 기반 품질 평가)는 2차 과제로 둔다. 검토 지시에 "Be ACTIVE" 편향 문구를 넣지 않는다 |
| 프롬프트 주입의 영속화 | 도구 결과나 웹 페이지의 지시문이 교훈이라는 이름으로 스킬 본문에 들어가 이후 세션에 실린다(`hermes.md` §3.10.1 (바) 둘째 항목) | 검토 지시의 DATA 방어(spec §4.4 요구 5), 사전 스캔과 L2-d 적용 스캔 두 번, 승인 기본 켬 |
| L1 위임 구현 지연 | 계약은 정해졌다(L1.agents.spec §3.2 `DelegateRequest`, §3.3 `AgentService.delegate`, L3.group-kit.spec §3.4 `DelegateSpec`). core-agents `delegate`는 아직 스텁이다(M3-new-02). `fork: { at: "event" }`는 L1에서 거부되므로 `item` 지점으로 바꿨다 | LR-01~LR-04, LR-08~LR-14, LR-26~LR-28은 위임 없이 진행한다. LR-05·LR-23은 group-kit `testing`의 가짜 `delegate`와 가짜 `agent.settled` 공급으로 먼저 만들고, L1.agents 구현 뒤 계약 테스트를 더한다 |
| 승인 피로 | 후보가 많으면 사용자가 대기열을 보지 않게 된다 | 대기열 만료(`l3.learning.queue.expiryDays`, 기본 30일) [제안], 검토당 후보 상한 8개(spec §3.5) |
| L2-d 쓰기 API 미확정 | 보관·적용·스캔·원장의 메서드 구분 근거가 없다(`_research/notes/L3-3.md` §4.1) | `apply.ts`를 어댑터 하나로 모아 L2.knowledge 확정 뒤 이 파일만 바꾼다 |
| 하위 층 요구 미반영 | REQ-LN-01(`AgentSettledPayload` 필드)과 REQ-LN-02(`agent.settled` 구독)가 없으면 검토가 시작되지 않거나 한 번만 돈다(spec §5 사례 15·17) | F·X·L1 계약 트랙(M3 설계 단계)에서 먼저 반영한다. 반영 전에는 LR-04의 임시 규칙과 LR-23의 명령 진입 대체 경로로 시험만 한다 |
| 결정 반영 | D-M3-02·03·04·09·32를 받았다. 남은 위험은 L1 쪽 요구(위임 취소 API REQ-L1-02, `report` 선택 필드 REQ-L1-05)가 늦어지는 것이다 | LR-05, LR-24는 해당 L1 요구가 들어온 뒤 완료 판정한다. 그 전에는 가짜 위임 서비스로 단위 시험을 돌린다 |
| 대기열 이중화 | 학습 대기열과 L2 `cap_knowledge_proposals`가 따로 있다(spec §10 미결 8) | L4 승인 화면이 두 출처를 한 목록으로 보인다(REQ-LN-10). 하나로 합치기로 정해지면 LR-08~LR-10을 L2 대기열의 생산자 경로로 바꾼다 |

## 8. M3a 구현 현황 (T-LR)

`xeon/packages/group-learning`, 시험 91개. `just check packages/group-learning`가 통과한다. 코어(F·X·L0·L1) 경로의 diff는 0이다(`core-diff-check.ts`, 기준은 `m3a/x-ambient` 머리). 대기열은 ambient(M3-REQ-102)가 들어온 뒤 설계대로 비공개 기록과 투영기로 돌렸다. 저장소 포트와 호스트 SQLite 저장소는 없앴다.

| 작업 | 상태 | 내용 |
|---|---|---|
| LR-01 | 완료 | `manifest.ts`, `state.ts`(`lastTurnId`, `lastItemId`를 더함), `index.ts`는 default export 대신 팩토리 `createLearningGroup(deps)`다. 읽기 면을 주입해야 해서다. 시험 `manifest.test.ts` |
| LR-02 | 완료 | `settings.ts`의 12개 키(spec §6.1 표와 같다. 큐레이터 4개는 `stage: "reserved"`). 설정을 읽지 못하면 fail-closed. spec §10 15가 남는다 |
| LR-03 | 완료 | `handlers.ts`의 집계표(`boundary.turn.before`, `boundary.step.after`). `triggers.test.ts` |
| LR-04 | 완료 | `triggers.ts`의 `applyTurn`과 `boundary.settle.after` 핸들러. 같은 turn의 재발화를 `lastTurnId`로 한 번만 반영한다 |
| LR-05 | 완료 | `review/fork.ts`, 위임 먼저 커밋 나중, `agents/learning-review.md`. `fork.started`는 `duplicate`에서도 쓴다. `fork.test.ts` |
| LR-06 | 완료 | `review/propose.ts`. 입력에 `description`을 더했다. 후보 id와 비공개 기록 키는 `toolCallId`에서 정한다. `propose.test.ts`, `ambient.test.ts` |
| LR-07 | 완료 | `review/prompts.ts`(영어). 표지 문자열 시험 `prompts.test.ts` |
| LR-08 | 완료 | `proposals/events.ts`(비공개 기록 9종), `proposals/rows.ts`(투영 규칙, 결정 경로와 같은 `transition`), `proposals/sql.ts`(DDL, `learningProjector`, `createSqlReader`). `queue.test.ts`, `records.test.ts`, `ambient.test.ts` |
| LR-09 | 완료 | `proposals/queue.ts`(전이 표), `proposals/ops.ts`(결정, 명령 진입 지연 정리). `queue.test.ts` |
| LR-10 | 완료 | `proposals/knowledge.ts`가 `apply.ts` 자리다. 멱등 키 `learning:apply:<id>:<rev>`, 승인 증거 `learning.queue` |
| LR-11 | 완료 | `proposals/scan.ts`. 걸린 후보는 본문·diff를 비운다. 본문 상한 150,000 바이트 |
| LR-12 | 비움 | 번호를 비워 둔다 |
| LR-13 | 완료 | 피드백 후보(`user/work-style`)와 메모리 `user` 영역 적용. `feedback.test.ts` |
| LR-14 | 완료 | 공개 레코드 8종 선언과 `proposed`·`review.finished`·`approved`·`rejected`·`applied` 기록. `records.test.ts` |
| LR-15 | 완료 | `commands.ts`. 승인·수정은 `--revision` 필수. 결과는 `report(report, invocationId)` 콜백으로 낸다(spec §6.2). `commands.test.ts`, `ambient.test.ts` |
| LR-16 | 완료 | `coexist.test.ts`: drive 임대를 쥔 대역 아래에서 포크가 돈다. 루프 turn이 늘지 않는다 |
| LR-17 | 연결됨 (B4-GRP) | 검토 행과 `fork.finished`, `review.finished`에 토큰을 남기고, 검토 종료 때 `g.metrics.addUsage`로 계측에 더한다. 프로세스 안에서 같은 검토는 한 번만 더한다(`countedReviews`). 규칙과 시험은 spec §10 17 |
| LR-18 | 완료 | `uc3.int.test.ts`(X2, 이벤트를 접은 읽기 면). 실제 SQLite 경로는 `apps/host/test/int/proposals.int.test.ts`다: 모델 테이프가 `learning_propose`를 부르고 승인 전 파일 불변, 승인 뒤 스킬 파일 생성을 확인한다. 코어 diff 0은 `core-diff-check.ts` |
| LR-23 | 완료 | 구독 핸들러, `reviewFinishOutcome`. `settled.test.ts` |
| LR-24 | 완료 | `onDispose`가 `g.cancelDelegates`를 부른다. `onDispose`에는 ambient가 없어 끝난 검토의 표지는 `boundary.settle.after`의 2시간 규칙이나 `/learning` 진입의 `delegateStatus`가 비운다. group-kit이 `onDispose`에서 `cancelDelegates`가 동작하게 고쳤다. `dispose.test.ts` |
| LR-25 | 완료 | `replay.test.ts`: `replayDrive`의 효과 계수, 모든 상태 커밋 지점에서 끊고 재발화. 하니스는 `test/support/replay-harness.ts` |
| LR-26 | 완료 | 범위 선택(`approve --scope`), `scopeNotAllowed`, `ctx.caller.afterUntrusted` 기록. `ambient.test.ts` |
| LR-27 | 완료 | `name_exists`, `conflictsWith` |
| LR-28 | 완료 | `results.ts`(`learning.noConversation`을 더했다) |
