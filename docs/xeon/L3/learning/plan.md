---
id: L3.learning.plan
layer: L3
domain: learning
kind: plan
status: draft
depends_on: [L3.learning.spec, L3.group-kit.plan, L2.knowledge.plan, L1.agents.plan, product.scope.spec, eng.testing.guide, eng.dependency-rules.guide]
binds: [xeon/packages/group-learning/**]
---

# L3 학습 그룹 구현 계획

## 1. 목표와 마일스톤 배치

목표는 L3.learning.spec의 1차 구성요소(학습 트리거, 검토 포크, 승인 대기열, 메타인지 피드백 제안)를 M3에 넣는 것이다. 근거는 `product.scope.spec` 4.1 I8(학습 그룹 M3), 4.3 M3 행, 4.4 M3 종료 조건, 4.5 UC-3 행이다.

| 마일스톤 | 학습 그룹 작업 | 선행 조건(다른 층) |
|---|---|---|
| M0 | 없음. 패키지 골격(`export {};`)만 있다 | F 계약 골격, check-layers |
| M1 | 없음 | F.extensions 지점 타입, X `on`·`post`·`scope` 구현, 이벤트 저장 |
| M2 | 없음. group-kit M2 완료가 선행 조건이다 | L3.group-kit.plan M2(`defineGroup`, `GroupApi`, 도구·명령 등록 `registerTool`·`registerCommand`(G-22)), L2.knowledge.plan(읽기 능력) |
| M3 | 1차 구성요소 전부(LR-01~LR-18). UC-3 스모크 | L1.agents.plan 백그라운드 위임, L2.knowledge.plan 쓰기·원장·스캔 API, L4.settings-ui.plan 설정 화면, L4 승인 화면 계약 |
| M3 이후(2차) | 큐레이터, 학습 이력, 스크립트 제안(LR-19~LR-22) | L2-h 예약(큐레이터 트리거를 예약으로 정할 때), L2-d 백업 API |

구성요소별 배치:

| 구성요소 | 차수 | 마일스톤 | 작업 |
|---|---|---|---|
| 학습 트리거 | 1차 | M3 | LR-01~LR-04 |
| 검토 포크 | 1차 | M3 | LR-05~LR-07 |
| 승인 대기열 | 1차 | M3 | LR-08~LR-12 |
| 메타인지 피드백 제안 | 1차 | M3 | LR-13 |
| 레코드·명령·통합 | 1차 | M3 | LR-14~LR-18 |
| 큐레이터 | 2차 | M3 이후 | LR-19, LR-20 |
| 학습 이력 보기 | 2차 | M3 이후 | LR-21 |
| 반복 작업 스크립트 제안 | 2차 | M3 이후 | LR-22 |

## 2. 패키지와 파일 배치

패키지 `xeon/packages/group-learning`(`@xeon/group-learning`, `package.json`의 `xeon.layer = "L3"`, `xeon.domain = "learning"`). 이 문서를 쓰는 단계에서 코드는 만들지 않는다.

```text
xeon/packages/group-learning/
  src/
    index.ts              defineGroup 진입점. default export
    manifest.ts           defineManifest 상수(spec §3.1)
    state.ts              LearningStateSchema, INITIAL_LEARNING_STATE
    settings.ts           defineSettings("l3.learning", …)(spec §6.1)
    triggers.ts           TurnTally 집계, applyTurn, reviewRequestId, on 핸들러 등록
    review/
      fork.ts             buildReviewSpec, reviewTokenBudget, g.delegate 호출, 완료 처리
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

- import 허용: `@xeon/contracts`(F), `@xeon/group-kit`(DR-02 허용 목록 `DR-02/group-kit-learning`, `eng.dependency-rules.guide` DR-02, [결정(잠정): review.decisions-2 U-15]), 테스트 파일에서만 `@xeon/core-models/testing`(테이프, `eng.testing.guide` TS-04)과 각 패키지의 `testing` 서브패스(DR-14 예외, review.decisions-2 U-17). F에는 `./testing` 서브패스가 없으므로 시계·ID 대역은 이 패키지 `test/` 안에 둔다(review.decisions-2 U-03).
- import 금지: `cap-*`(L2-d는 `g.capability(<ServiceKey>)`로만 쓴다), `core-*`(위임은 `g.delegate`로만 쓴다), `ext-host`, `platform-*`, `group-helm`(CM-06).
- 의존 추가: 외부 npm 의존을 더하지 않는다. `typebox`는 workspace catalog의 1.4.2를 쓴다(`catalog:`, L3.group-kit.plan §4 표, eng.toolchain.guide).

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| LR-01 | 매니페스트와 상태: `manifest.ts`, `state.ts`, `index.ts`의 `defineGroup` 뼈대. `validateManifest` 통과 테스트 | group-kit M2(`defineGroup`, `GroupDef<S>`) | S |
| LR-02 | 설정: `settings.ts`에 spec §6.1의 13개 키 `SettingDef`. 설정 읽기 실패 시 fail-closed 경로 | LR-01, F.wire-settings `defineSettings` | S |
| LR-03 | 카운터 tap: `agent_start`, `tool_execution_end`의 `TurnTally` 집계(입력 출처, step 중복 방지, 스킬 쓰기 판정) | LR-01, F 지점 페이로드(`AgentStartPayload`, `ToolExecutionEndPayload`) | M |
| LR-04 | 임계 판정 순수 함수: `applyTurn`, `reviewRequestId`, `agent_settled` 핸들러의 상태 커밋(턴당 1회) | LR-02, LR-03 | S |
| LR-05 | 포크 호출: `buildReviewSpec`(group-kit `DelegateSpec`), `reviewTokenBudget`, `reviewStartOutcome`(`DelegateResult` 처리), `g.delegate` 멱등 호출과 "위임 먼저, 커밋 나중" 순서, `grp.learning.fork.started`, `agents/learning-review.md` 정의 | LR-04, L1.agents 백그라운드 위임 API(L1.agents.spec §3.3 `AgentService.delegate`), group-kit `GroupApi.delegate`(G-14) | M |
| LR-06 | 제안 도구와 허용 목록: `g.registerTool`로 `learning_propose` 등록, 입력 검사, 읽기 선행 가드(`baseHash`), 후보 수 상한, `toolPolicy.allow` 기본값과 거부 안내 문장(`denyHint`) | LR-05, group-kit `registerTool`(G-22), L1.tools 실행 시점 허용 검사 | M |
| LR-07 | 검토 지시: `prompts.ts` 요구 사항 7항목(신호, 선호 순서, 저장 금지, 메모리 영역, DATA 방어, 출력 규약, 편향 문구 금지) 문구 본문 작성 | LR-05 | M |
| LR-08 | Proposal 이벤트와 투영: `grp.learning.proposal.*`·`grp.learning.fork.*` 비공개 기록 9종, `learningProjector`, `x_learning_proposals`·`x_learning_reviews` DDL | LR-06. X `ScopeApi.recordPrivate`(review.decisions-2 T-21, spec §3.7.1)의 X 구현 | M |
| LR-09 | 승인 전이: 상태 전이 순수 함수(spec §4.5 표), `ProposalDecision` 처리, 만료 판정, `session_start` 복원 | LR-08 | M |
| LR-10 | L2-d 적용 어댑터: `apply.ts`의 `apply`·`rollback` 호출, 멱등 키, `base_stale`·`scan_failed`·`io` 처리 | LR-09, L2.knowledge 쓰기·원장·롤백 API | M |
| LR-11 | 사전 스캔: 자체 검사와 L2-d `scan` 호출, `findings` 규칙 이름만 저장 | LR-09, L2.knowledge 스캔 API(선택) | S |
| LR-12 | 충돌 표시: 같은 이름·유사 스킬 검색으로 `conflictsWith`와 기준 diff 생성 | LR-10, `knowledge.skill.read` 검색 | S |
| LR-13 | 피드백 제안: `feedback.ts`의 `kind: "feedback"` 검사, `target` 규칙, 메모리 `user` 영역 적용 연결 | LR-06, LR-10 | S |
| LR-14 | 레코드 발행: `records.ts` 8종 스키마와 `recordKinds` 선언, 전이마다 레코드 쓰기 | LR-09 | S |
| LR-15 | 명령: `g.registerCommand("learning", …)`로 `/learning queue` 하위 명령 6종, `/learning review [--cancel]`, `--json` 출력(`ProposalView`) | LR-09, LR-10, group-kit `registerCommand`(G-22), L4 승인 화면 계약 | M |
| LR-16 | 공존 확인: Helm 임대 중 동작, `drive` 호출 0 계측 | LR-05, group-kit `DriveArbiter` | S |
| LR-17 | 사용량 계측: 검토별 입력·출력 토큰을 `x_learning_reviews`와 `GroupMetrics`에 남김 | LR-05, L1.agents 사용량 부모 귀속 | S |
| LR-18 | UC-3 테이프 통합 테스트와 M3 코어 diff 0 확인 | LR-01~LR-17 | M |
| LR-19 | (2차) 큐레이터 결정적 단계: 유휴 판정, 14일 stale, 30일 archive 후보, 고정·참조·사용자 생성 스킬 제외, archive도 대기열 | LR-09, L2-d 사용 기록과 "에이전트 생성" 표시, spec §10 미결 6 | M |
| LR-20 | (2차) 큐레이터 LLM 통합: 옵트인, 실행 전 백업 요청, 검토 포크와 같은 위임 경로 | LR-19, L2-d 백업 API | M |
| LR-21 | (2차) 학습 이력: 대기열과 원장 시간순 합치기, `/learning history`, 되돌리기 | LR-10, `knowledge.ledger.read` | M |
| LR-22 | (2차) 스크립트 제안: 반복 명령 묶음 탐지(최소 반복 3회 [가정]), `kind: "script"` 후보 | LR-06, LR-10 | M |

선행 조건(다른 층):

- group-kit M2: `defineGroup`, `GroupApi<S>`의 `settings()`, `delegate(spec)`(M2는 입력 검사만, 호출은 M3의 G-14), `metrics`, `registerTool`·`registerCommand`(G-22)(L3.group-kit.plan). 비공개 기록 경로는 X `ScopeApi.recordPrivate`다(review.decisions-2 T-21, spec §3.7.1). group-kit은 이 연산을 그대로 전달한다(L3.group-kit.spec §3.2). 그래서 LR-08이 X 구현을 선행으로 갖는다.
- L1.agents 백그라운드 위임: 접수 결과(`accepted`/`duplicate`), 부모 대화 범위 `requestId` 멱등, 스냅샷 복제, 실행 시점 도구 허용 검사, 반복·토큰 상한, 사용량 부모 귀속, 취소, 완료 통지(L1.agents.plan).
- L2.knowledge 쓰기·원장·승인 API: 읽기 능력 4종, `apply`(멱등 키, 승인 증거, `base_stale`), 스캔, 롤백, "에이전트 생성" 표시(L2.knowledge.plan).
- L4 승인 화면 계약: `ProposalView`와 `/learning queue` 명령 호출 경로(L4.desktop, L4.cli), 설정 화면 `plugins` 탭(L4.settings-ui.plan).

## 4. 채택 코드

그대로 쓰는 외부 패키지는 워크스페이스 공용 `typebox` 1.4.2(`catalog:`, L3.group-kit.plan §4 표)뿐이다. Hermes 소스는 가져오지 않는다. Hermes는 MIT 라이선스이고 Python이므로 개념만 TypeScript로 재구현한다(`_research/refs/hermes.md` §4.1 라이선스 항목, §4.2 첫 항목). 아래 표의 소스 경로는 설계 참고 위치이며, 커밋은 `0319e113c9602b86ffda350e931cb4b035e1d5d8`이다(`_research/notes/L3-3.md` §0).

| Hermes 요소 | 참고 위치 | 학습 그룹 대응 | 바꾸는 점 |
|---|---|---|---|
| 카운터 트리거 | `agent/turn_context.py:758-767`, `agent/turn_iteration_prep.py:166-167`, `agent/tool_executor.py:744-747`, `agent/turn_finalizer.py:763-791`(`hermes.md` §3.10.1 (가)) | `triggers.ts` `applyTurn` | 단계 경계 이벤트(`agent_start`, `tool_execution_end`, `agent_settled`) 기준. 순수 함수로 분리. 커밋 턴당 1회 |
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
| `settings.defs-valid` | 13개 키가 `checkSettingDef`를 통과하고 기본값이 spec §6.1과 같다 | LR-02 |
| `settings.read-failure-fails-closed` | 설정 읽기 실패 시 `g.delegate`와 `apply` 호출 0 | LR-02 |
| `triggers.counts-user-turns` | 사용자 turn 10회째 `agent_settled`에서 `review/user_turns` | LR-03, LR-04 |
| `triggers.counts-tool-iterations-per-step` | 한 step의 도구 3개는 반복 1회. 같은 지점 재발화도 1회 | LR-03 |
| `triggers.skips-aborted-and-scheduled-turns` | `aborted`, `error`, `scheduled`, `remote` turn은 사용자 turn 수를 올리지 않고 검토를 시작하지 않는다 | LR-04 |
| `triggers.resets-on-skill-write` | 스킬 쓰기 능력 실행 또는 `learning_propose(kind: "skill")` 뒤 도구 반복 카운터 0 | LR-03 |
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
| `queue.base-stale-returns-to-pending` | 승인 뒤 원본 변경 → `pending/base_stale`, 새 diff | LR-10, LR-12 |
| `queue.revert-uses-ledger` | `revert` → `rollback(ledgerId)` 1회, 성공 시 `reverted`, `hash_mismatch` 시 `applied/rollback_refused` | LR-10 |
| `queue.restore-on-session-start` | `approved` 미적용 행 재적용, 만료 행 `expired` | LR-09 |
| `queue.projection-rebuild-equal` | 이벤트에서 투영을 다시 만들면 같은 행 | LR-08 |
| `feedback.frustration-signal-creates-proposal` | 좌절 표현이 있는 테이프 세션 → `kind: "feedback"` 후보 1개와 `grp.learning.feedback.proposed` | LR-13 |
| `coexist.helm-lease-held-fork-still-runs` | 테스트 drive 그룹이 임대를 가진 상태에서 임계 도달 → 포크 시작, 학습 그룹 `drive` 호출 0 | LR-16 |
| `records.schema-valid` | 8종 예시 payload가 스키마를 통과하고 `validateGroupRecord`를 통과한다 | LR-14 |
| `commands.queue-json-matches-view` | `/learning queue --json` 출력이 `ProposalView[]` 스키마를 따른다 | LR-15 |
| `curator.stale-after-14d-archive-after-30d` | (2차) 주입 시계로 14일·30일 경계, archive는 대기열 후보로만 생김 | LR-19 |
| `curator.skips-pinned-and-user-created` | (2차) 고정, 예약 참조, 사용자 생성, 번들 스킬은 후보 0 | LR-19 |

### 5.2 테이프 통합 (M3 스모크)

- 이름: `group-learning/test/uc3.int.test.ts`의 `uc3.threshold-review-queue-and-helm-coexist`.
- 구성: 실제 SQLite 임시 파일, X·group-kit 실구현, L1-g·L2-d 가짜, 테스트용 drive 그룹(Helm 대역), 테이프 `test/tapes/uc3-review.tape.jsonl`(주 대화 10 turn + 검토 포크 응답).
- 확인: (1) 임계를 넘는 세션에서 포크가 백그라운드로 1회 실행되고 후보가 대기열에 들어가며, 승인 전 스킬 디렉터리와 메모리 파일 해시가 같다. (2) drive 그룹이 임대를 가진 동안에도 (1)이 성립한다. (3) 승인 뒤에만 L2-d `apply`가 불린다.
- [미결] `eng.testing.guide` TS-01은 `scenario` 계층을 저장소 전체에 1개(`apps/cli` 스모크)로 제한한다. 이 테스트는 패키지 안 `int` 계층으로 두는 안을 제안한다. UC-3 스모크를 `scenario` 계층에 더해야 하는지는 testing guide 소유자가 정한다.

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

2. M3 검증(`product.scope.spec` 4.4 M3, 5절): 학습 그룹을 추가하는 변경에서 `xeon/packages/contracts/**`, `xeon/packages/ext-host/**`, `xeon/packages/platform-*/**`, `xeon/packages/core-*/**` 경로의 diff가 0이다. 확인 방법은 그 변경 묶음에 대한 `git diff --stat <기준>..HEAD -- <경로들>` 결과가 비어 있는 것이다. 필요한 F·X·L1 변경은 학습 그룹 변경보다 앞선 별도 변경으로 끝나 있어야 한다.
3. 학습 그룹이 쓰는 연산(`on`, `post` 선언, `scope`)이 통합 테스트에서 호출된다(`product.scope.spec` 4.4 M3, `product.vision.spec` S1).
4. 승인 전 파일 불변 검증: 통합 테스트가 가짜 L2-d 저장소의 스킬 디렉터리와 메모리 파일 해시를 세션 전, 후보 생성 뒤, 거절 뒤에 비교하고 모두 같다.
5. `just verify`가 종료코드 0이다. `just check-layers`와 `just depcruise`가 `group-learning`의 import를 허용 목록 안으로 확인한다.
6. 2차 작업(LR-19~LR-22)은 M3 완료 기준에 넣지 않는다.

## 7. 위험과 대응

| 위험 | 내용 | 대응 |
|---|---|---|
| 검토 포크 비용 | Hermes 기준 검토 한 번에 약 3만 토큰이다(`hermes.md` §3.10.1 (가) 5, turn_finalizer.py:780). 사용자 10 turn마다 돌면 누적 비용이 크다 | 임계와 토큰 예산을 설정으로 노출한다. 예약·원격 turn은 세지 않는다. 검토별 사용량을 `x_learning_reviews`와 `GroupMetrics`로 계측해 설정 화면에 보인다(LR-17). 캐시 접두 공유는 L1.agents가 지원할 때만 기대한다 |
| 학습 품질을 재는 장치 부재 | Hermes에도 스킬 품질 평가가 없다(`hermes.md` §3.10.1 (바) 셋째 항목, §4.3 둘째 항목) | 1차는 승인율·거절 사유·되돌림 수를 계측만 한다. 평가 루프(테이프 녹화 기반 품질 평가)는 2차 과제로 둔다. 검토 지시에 "Be ACTIVE" 편향 문구를 넣지 않는다 |
| 프롬프트 주입의 영속화 | 도구 결과나 웹 페이지의 지시문이 교훈이라는 이름으로 스킬 본문에 들어가 이후 세션에 실린다(`hermes.md` §3.10.1 (바) 둘째 항목) | 검토 지시의 DATA 방어(spec §4.4 요구 5), 사전 스캔과 L2-d 적용 스캔 두 번, 승인 기본 켬 |
| L1 위임 구현 지연 | 계약은 정해졌다(L1.agents.spec §3.2 `DelegateRequest`, §3.3 `AgentService.delegate`, L3.group-kit.spec §3.4 `DelegateSpec`). group-kit `delegate` 호출 구현은 M3(G-14)이고, L1.agents.spec §3.2 끝 문단의 옛 필드 대응(`forkFrom`)은 고칠 대상이다 | LR-01~LR-04, LR-08~LR-14는 위임 없이 진행한다. LR-05는 group-kit `testing`의 가짜 `delegate`로 먼저 만들고, L1.agents 확정 뒤 계약 테스트를 더한다. on 핸들러 효과 규칙(spec §10 미결 2)이 바뀌면 요청 레코드 + 워커 방식으로 LR-05만 바꾼다 |
| 승인 피로 | 후보가 많으면 사용자가 대기열을 보지 않게 된다 | 대기열 만료(`l3.learning.queue.expiryDays`, 기본 30일) [제안], 검토당 후보 상한 8개(spec §3.5) |
| L2-d 쓰기 API 미확정 | 보관·적용·스캔·원장의 메서드 구분 근거가 없다(`_research/notes/L3-3.md` §4.1) | `apply.ts`를 어댑터 하나로 모아 L2.knowledge 확정 뒤 이 파일만 바꾼다 |
| 문서 충돌 | 레코드 접두 체계, on 핸들러 효과 규칙, `xeon.domain` 값(spec §10 미결 1~3) | 착수 전 사용자 확인. 결정이 나기 전에는 LR-08(이벤트 경로)과 LR-05(위임 시작 위치)를 미룬다 |
