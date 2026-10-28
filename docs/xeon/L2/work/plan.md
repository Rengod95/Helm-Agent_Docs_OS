---
id: L2.work.plan
layer: L2
domain: work
kind: plan
status: draft
depends_on: [L2.work.spec, F.capabilities.plan, F.records.plan, L1.tools.plan, L1.loop.plan, L1.agents.plan]
binds: [xeon/packages/cap-work/**]
---

# L2 작업 관리 구현 계획 (work)

대상 스펙: `L2.work.spec`. 패키지: `xeon/packages/cap-work`.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 없음. 패키지 골격(`package.json`의 `"xeon": {"layer": "L2", "domain": "work"}`)만 P0에서 만든다 | `_research/foundation-plan.md` §5 P0·P4 |
| M1 | 없음. M1 걷는 골격(`xeon chat`)은 작업 관리를 쓰지 않는다 | `product.scope.spec` §4.3 M1 |
| M2 | 작업 목록, 의존 간선, 계획 모드·계획 승인(승인 프로토콜 통합 포함). T1~T8 | `product.scope.spec` §4.1 I9, §4.3 M2, `_research/layer-plan-v2.json` L2-e 1차 |
| M3 | 목표 지속(판정 모델 + 상한), 완료 보고. T9~T12 | `product.scope.spec` §4.1 I11, §4.3 M3 |
| 보류 | 작업 보드(L4 칸반 보기), 외부 트래커(X 플러그인), 계획 외부 편집기 수정 | `_research/layer-plan-v2.json` L2-e 보류, `L2.work.spec` §4.2.6 |

- `_research/layer-plan-v2.json` L2-e는 목표 지속과 완료 보고를 2차로 적었다. 3차 결정(목표 판정 = 별도 판정 모델 + 상한)이 목표 판정을 범위에 넣었으므로 M3에 둔다[^r]. `L2.readme` 각주와의 차이는 `L2.work.spec` §10 W-9다.
- M2 종료 조건 중 이 패키지가 맡는 것: "질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록된다"(`product.scope.spec` §4.4 M2). `L2.dialog.plan`과 공동이다.
- M3 종료 조건 중 이 패키지가 맡는 것: "목표 판정이 실행 횟수 상한에서 멈춘다"(`product.scope.spec` §4.4 M3).

[^r]: 3차 결정은 `_research/decisions-log.md` 2026-10-21 결정(3차) "목표 판정은 별도 판정 모델+상한"이다.

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/src/                     # F. 선행 작업(T1). F 작업자와 합의 뒤 추가
  capabilities/defs/work.ts                      # L2.work.spec §3.1~§3.6, §4.2.2 스키마
  records/catalog/work.ts                        # L2.work.spec §3.7 WORK_EVENT_CATALOG(CatalogEntry, L2.readme §5.9)
  records/owners.ts                              # "work." → "cap.work" 행 확인(이미 있으면 변경 없음)

xeon/packages/cap-work/
  package.json                                   # "xeon": {"layer":"L2","domain":"work"}, 외부 의존 없음
  src/
    index.ts                                     # manifest, apply(ctx): 서비스·투영기·피드 구독·지점 등록
    manifest.ts                                  # L2.work.spec §7.1
    settings.ts                                  # defineSettings("l2.work", …) 6개 키
    service.ts                                   # WorkService 조립, 스레드별 쓰기 큐
    ports/
      approvals.ts                               # ApprovalsPort ← xeon.approvals (L1.tools)
      permission-mode.ts                         # PermissionModePort ← xeon.tools (L1.tools)
      judge.ts                                   # JudgePort ← xeon.agents judge (L1.agents)
      session.ts                                 # 커밋·이벤트 읽기·피드 구독 ← xeon.session
      artifacts.ts                               # artifacts.registry 선택 의존
      commands.ts                                # dialog.commands 선택 의존(동작 명령 등록)
    tasks/
      model.ts                                   # 상태 전이 표, 막힘 계산(순수)
      graph.ts                                   # 순환 검사(순수)
      write.ts                                   # write 연산 적용과 이벤트 초안(순수)
      service.ts                                 # create/update/link/list/write
      reminder.ts                                # before_agent_start 핸들러(질의만)
    plans/
      model.ts                                   # 계획 상태, 결정 대응표(순수)
      service.ts                                 # enterMode/exitMode/submit/approve/reject/revise/versions
      listener.ts                                # approval.resolved → 모드 복원
    goals/
      model.ts                                   # 목표 상태 머신, 종결 판단(순수)
      evidence.ts                                # GoalEvidence 수집
      judge.ts                                   # GoalJudge 내부 인터페이스, model·delegated 구현 선택
      runner.ts                                  # turn.completed → 판정 → 커밋 → post
      service.ts                                 # set/status/clear/judge
    reports/
      build.ts                                   # WorkReport 계산(순수: 이벤트 목록 → 보고)
      service.ts                                 # build
    projection/
      ddl.ts                                     # cap_work_* DDL
      projector.ts                               # Projector "cap.work" v1, apply
    resume.ts                                    # L2.work.spec §4.5 재개 절차
    testing/
      fake-approvals.ts                          # ApprovalsPort 가짜(메모리, 수동 해결)
      fake-permission-mode.ts
      fake-judge.ts                              # JudgePort 가짜(JudgeOutcome 목록을 차례로 돌려준다)
  test/
    *.test.ts
```

- 투영기 이름은 `cap.work`, 테이블 접두사는 `cap_work_`다(eng.context-map.design §5.2).
- 이벤트 카탈로그 파일은 F `contracts/src/records/catalog/work.ts`다. 이 파일과 `defs/work.ts`는 F 쪽 변경이므로 T1을 선행 작업으로 둔다.
- 포트 파일은 L1 서비스의 실제 이름을 한 곳에서 감싼다. L1.tools·L1.models 문서가 바뀌면 이 파일만 고친다.

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| T1 | F `capabilities/defs/work.ts`(네 정의, 스키마, `WorkService`, `PlanApprovalSubject`·`PlanApprovalAnswer`)와 `records/catalog/work.ts`(`WORK_EVENT_CATALOG` 10종, `CatalogEntry` 형식) 추가. `work` 영역과 `owners.ts`의 `work.` 행(F.records §3.3.2), `CallOptions.context`(F.capabilities §3.2)는 F에 있으므로 확인만 한다. 선행 작업: F.capabilities.plan의 `defineCapability`·`validateCapability`, F.records.plan의 카탈로그 형식 | F.capabilities.plan 정의 형식 완료, F.records.plan 카탈로그 완료 | M | M2 |
| T2 | 작업 모델: 상태 전이 표(§4.1.2), 막힘 계산, 순환 검사(DFS, 경로 반환), `write` 연산 적용(임시 참조 해석, 전부 또는 전무) | T1 | M | M2 |
| T3 | `task_write` 도구와 `work.tasks` 서비스(create/update/link/list/write), 스레드별 쓰기 큐, 순번 ID 발급, 투영기 `cap.work`의 작업 부분(`cap_work_tasks`, `cap_work_edges`, `cap_work_meta`), 자동 시작, 방치 알림 핸들러 | T2, L1.persistence(커밋·투영기 등록) | L | M2 |
| T4 | 계획 객체와 버전: 상태 모델, `work.plan_submitted`·`work.plan_withdrawn` 커밋, 투영(`cap_work_plans`)의 `approval.requested`·`approval.resolved` 반영, `versions` | T3(투영기 골격) | M | M2 |
| T5 | `enterMode`/`exitMode`와 `PermissionModePort`(L1.tools 권한 모드 연결). `requireApproval` 검사, 대기 버전 철회 | T4, L1.tools 권한 모드 API | M | M2 |
| T6 | `submit_plan` → `xeon.approvals`(kind `plan`) 연결: `ApprovalsPort`, 제출 흐름(§4.2.4), `input_required`/`decided` 출력, `approve`/`reject`/`revise` 편의 메서드, 승인 해결 뒤 모드 복원 리스너, 재개 절차의 계획 부분 | T4, T5, L1.tools 승인 프로토콜 | L | M2 |
| T7 | 계획 산출물 등록(`artifacts.registry` 선택 의존, 제출 시점): 사용 가능 확인, 첫 판 `register`·다음 판 `update`(requestId `plan:<planId>:<planVersion>`), 실패 시 `artifact: null` | T6, L2.artifacts 정의 | S | M2(산출물 능력이 없으면 비활성 경로만 테스트) |
| T8 | 설정 키 6개(`settings.ts`), 명령 등록(`dialog.commands` 선택 의존, §6.2) | T3, T6, L2.dialog D5 | S | M2(명령은 W-10 확정 뒤) |
| T9 | 목표 저장과 상태 머신: `set`/`status`/`clear`, `continuation` 필드, `work.goal_set`·`work.goal_settled`, 투영(`cap_work_goals`, `cap_work_judgments`) | T3, T8 | M | M3(완료: M3a A4) |
| T10 | 판정자와 증거: `GoalEvidence` 수집(정착 지점 컨텍스트와 투영 읽기), `xeon.agents.judge` 호출과 `JudgeOutcome` 대응, `delegated` 판정자와 `judge` 메서드(대기 시간 제한은 제외, spec §4.3.5) | T9, L1.agents `judge` | L | M3(완료: M3a A4) |
| T11 | 완료 게이트: `boundary.settle.before` chain 핸들러(`goalGateDecision`), 판정 커밋(키 `work:goal:<goalId>:judge:<run>`), 상한·종결, 판정 실패 stop, 지시·안내 custom 항목, 재개 시 같은 판정 순번 한 번만 기록. `turn.completed` 러너와 `post`는 쓰지 않는다(M3-new-02) | T10 | L | M3(완료: M3a A4) |
| T12 | 완료 보고 스키마와 생성: `reports.build`, 목표 종결 커밋에 `work.report_built` 포함, 사용량·시간 합계, 남은 항목. 산출물 합집합은 `L2.artifacts` 범위 조회가 생길 때 더한다 | T11 | M | M3(완료: M3a A4) |

순서: T1 → T2 → T3 → T4 → (T5, T7 병행) → T6 → T8 → T9 → T10 → T11 → T12.

## 4. 채택 코드

### 4.1 그대로 쓰는 패키지

| 패키지 | 버전 | 쓰임 |
|---|---|---|
| `typebox` | 워크스페이스 catalog 고정 버전(1.3.27, review.decisions-2 U-24) | 정의 스키마. F에만 직접 의존이 있고 cap-work는 F 타입만 쓴다 |

- 외부 패키지를 새로 더하지 않는다. 스키마는 TypeBox로 직접 쓴다(`_research/packages.md` §4.4 L2-e "작업 목록과 계획 객체: typebox 스키마로 자체").

### 4.2 설계 이식(코드 복사 없음)

아래 구현은 동작과 데이터 모양만 참고한다. 소스를 복사하지 않는다.

| 참고 구현 | 위치 | 가져오는 설계 | 바꾸는 점 |
|---|---|---|---|
| Claude Code 작업 도구(TaskCreate/Update/Get/List, `dependencies`) | `_research/refs/claude-code.md` 217행, `_research/l2e.md` §3.1 A1·A7 | 순번 ID, 선행 관계 필드, 목록 연산 | 도구 네 개를 `task_write` 하나로 합친다. 선행 관계에 순환 거부를 더한다 |
| omp `session/todo-tracker.ts`, `tools/todo.ts` | `_research/packages.md` §4.4 L2-e 행, `_research/l2e.md` 부록(omp 로컬 경로) | 상태 5종, `todo_reminder` 방치 알림 | 상태 이름을 이 문서 표로 맞춘다. 알림은 이벤트 대신 `input.agent.before` 질의로 만든다 |
| omp `goals/runtime.ts` | `_research/l2e.md` 부록, `_research/refs/oh-my-pi.md` 숨김 도구 `goal` | 목표 상태, 완료 보고에 토큰·시간 | 자가 판정(`goal` 도구)을 쓰지 않고 별도 판정자로 바꾼다 |
| Hermes `hermes_cli/goals.py` | `_research/l2e.md` 부록, `_research/refs/hermes.md` | 보조 모델 판정자, 턴 종료 뒤 판정 | 실패 시 계속을 기본으로 두지 않고 설정으로 고른다(W-7). 판정 결과를 내구 이벤트로 남긴다 |

## 5. 단위 테스트 목록

판정은 `src/testing/fake-judge.ts`(L1.agents `JudgeOutcome`을 차례로 돌려주는 가짜 `JudgePort`)로 대신한다. 모델 테이프는 L1.agents 테스트의 몫이다. 승인 프로토콜과 권한 모드는 `src/testing/`의 가짜 포트로 대신한다. 저장소는 `openTestStore`(eng.testing.guide §1.2)다. 시계와 ID는 `manualClock`, `fixedIdFactory`로 주입한다(TS-03).

| 테스트 파일 | 테스트 이름 | 확인할 동작 |
|---|---|---|
| `test/tasks-graph.test.ts` | 간선 순환 거부 | 2·3·4노드 순환과 자기 간선이 `task_cycle`이고 `detail.path`가 시작과 끝이 같은 경로다. 같은 `write` 안에서 앞서 더한 간선도 검사한다 |
| `test/tasks-graph.prop.test.ts` | 순환 없음 성질 | 고정 시드 무작위 간선 1,000개를 적용한 뒤 그래프에 순환이 없다 |
| `test/tasks-model.test.ts` | 상태 전이 표 | 25칸 전부를 표(§4.1.2)와 대조한다. 막힌 작업의 `in_progress`는 `task_blocked`, `force`면 허용 |
| `test/tasks-model.test.ts` | 막힘 계산 | `completed`·`cancelled` 선행은 풀림, `failed`·`pending` 선행은 막힘 |
| `test/tasks-write.test.ts` | write 전부 또는 전무 | 세 번째 연산이 실패하면 이벤트 0개, 오류 `detail.opIndex = 2` |
| `test/tasks-write.test.ts` | 임시 참조 | `@a`를 만든 뒤 `link`에서 `@a`를 쓰면 실제 ID로 바뀌고, 없는 참조는 `task_ref_unknown` |
| `test/tasks-service.int.test.ts` | 같은 requestId 재호출 | 이벤트 수가 그대로이고 출력이 같다 |
| `test/tasks-service.int.test.ts` | 자동 시작 | 설정 참이고 owner가 있으면 선행 완료 커밋에 `cause: "auto_start"` 변경이 함께 들어간다. owner가 null이면 들어가지 않는다 |
| `test/projection.int.test.ts` | 재생성 동일성 | 무작위 연산열 뒤 `expectProjectionsRebuildable`(eng.events.design §5.4)이 통과한다 |
| `test/reminder.test.ts` | 방치 알림 | `reminderTurns = 2`에서 변경 없이 2턴이 지나면 패치를 내고, 0이면 내지 않는다. 핸들러가 이벤트를 쓰지 않는다 |
| `test/plans-versions.int.test.ts` | 계획 버전 보관 | v1 수정 요청(피드백을 넣은 반려) 뒤 v2 제출 시 v1은 `rejected`로 남고 `versions`가 두 행을 돌려준다. 승인 대기 중 v2 제출은 `plan_pending` |
| `test/plans-decision.int.test.ts` | 승인·반려·수정 분기 | 가짜 승인의 `allow`, `deny`, `answer(revise)` 각각에서 투영 상태와 `submit` 재호출 출력이 대응표(§4.2.3)와 같다 |
| `test/plans-decision.int.test.ts` | 같은 레코드 형식 | `submit`이 만든 승인 요청이 kind `plan`이고 대상이 `PlanApprovalSubjectSchema`를 통과한다(`L2.dialog.plan`의 질문 테스트와 같은 payload 스키마 검사) |
| `test/plans-mode.test.ts` | 승인 전 실행 단계 진입 금지 | `requireApproval = true`에서 승인 전 `exitMode`는 `plan_not_approved`이고 `restore` 호출이 없다. 승인 뒤 `exitOnApprove`면 `restore` 한 번 |
| `test/plans-resume.fault.test.ts` | 승인 대기 중 재시작 복원 | `work.plan_submitted` 커밋 직후 강제 종료(고장 주입) → 재개 시 같은 키로 승인 요청이 한 번만 있다. 대기 중 재시작 뒤 응답하면 `submit` 재호출이 `decided`를 한 번 낸다 |
| `test/plans-artifact.test.ts` | 산출물 선택 의존 | 능력이 없으면 `artifact: null`, 등록 실패여도 제출은 성공. 등록 requestId가 `plan:<planId>:<planVersion>`이고, 등록 뒤 커밋 전 종료 후 재시도해도 등록 호출의 결과가 같다(가짜 registry의 멱등) |
| `test/goals-service.int.test.ts` | `set`·`status`·`clear`·`judge`, 보고 | 실제 SQLite와 세션 위에서 목표 기본값과 판정 상한 값, `goal_active`와 `replace`(종결 보고가 같은 커밋), `clear`의 보고와 `goal_closed`, 같은 `requestId`는 처음 결과와 같은 거부를 되풀이하고 이벤트를 쓰지 않음, 위임 판정(`goal_not_delegated`, 소유자만, `goal_turn_stale`, 같은 턴은 첫 판정, `met`·`limit_reached` 종결과 보고), `reports.build`(턴 사용량 합계, 남은 작업, 알 수 없는 대상) |
| `test/goals-gate.test.ts` | 완료 게이트 | 가짜 `xeon.agents.judge`로 `boundary.settle.before` 핸들러를 직접 부른다. `not_met`·`undecidable`은 지시 항목과 `continue: true`, 증거(최종 텍스트, 도구 호출, 작업, 직전 판정), `met`은 종결과 보고, `capped`는 판정 기록 없이 `limit_reached`와 안내 항목, 마지막 허용 실행의 미충족은 바로 종결, 판정 실패(`failed`, 던짐, `xeon.agents` 없음)는 `judge_failed`와 stop, 중단·오류 turn·위임 목표·판정 중 해제는 끼어들지 않음, 단계 id가 없으면 엔트리 없이 결정만, 같은 답이 다시 오면 이벤트가 늘지 않음 |
| `test/idempotency.conformance.test.ts` | 능력 적합성 | ADR-0015 §3.6, M3-REQ-88·89. 멱등 쓰기 아홉 개(`tasks.create`·`update`·`link`·`write`, `plans.submit`, `goals.set`·`clear`·`judge`, `reports.build`)를 같은 `requestId`로 저장소를 닫았다 다시 열고 두 번 부른다. 결과가 같고 이벤트 수와 `cap_work_` 표가 그대로다. 분류 값이 spec 표와 같고, 계획 결정(`approve`·`reject`·`revise`)은 `requestId`를 기억하지 않아 같은 키의 반복이 `plan_closed`임을 고정한다 |
| `test/defs.contract.test.ts` | 정의 검증 | 네 정의의 `validateCapability` 이슈 0건(W-3 확정 전에는 `tools: []` 관련 이슈만 허용 목록), `validateCapabilitySet`에서 도구 이름 충돌 없음 |
| `test/catalog.contract.test.ts` | 카탈로그 일치 | `WORK_EVENT_CATALOG`의 kind가 `parseEventKind`를 통과하고 `TYPE_PREFIX_OWNERS`의 `work.` 소유가 `cap.work`이며 스펙 §3.7 표와 집합이 같다 |

## 6. 완료 기준

spec §9 수용 기준과 테스트의 대응:

| spec §9 | 테스트 파일 · 이름 | 마일스톤 |
|---|---|---|
| 1 | `test/plans-decision.int.test.ts` · 같은 레코드 형식(`L2.dialog.plan` `test/ask-flow.test.ts` · 같은 레코드 형식과 공동) | M2 |
| 2 | `test/tasks-graph.test.ts` · 간선 순환 거부 | M2 |
| 3 | `test/goals-gate.test.ts` · 판정 상한과 완료 게이트 | M3 |
| 4 | `test/goals-gate.test.ts` · 재개 때 같은 판정 순번은 한 번만 기록 | M3 |
| 5 | `test/plans-mode.test.ts` · 승인 전 실행 단계 진입 금지 | M2 |
| 6 | `test/defs.contract.test.ts` · 정의 검증 | M2 |
| 7 | `test/projection.int.test.ts` · 재생성 동일성 | M2 |
| 8 | `test/tasks-service.int.test.ts` · 같은 requestId 재호출 | M2 |
| 9 | `test/plans-resume.fault.test.ts` · 승인 대기 중 재시작 복원 | M2 |
| 10 | `test/goals-service.int.test.ts` · 위임 판정자 | M3 |
| 11 | `test/goals-runner.test.ts` · 외부 투입 목표(루프 결합 부분은 `L2.schedule.plan` 루프 테스트와 공동) | M3 |

M2:

1. §5의 M2 테스트(작업, 계획, 정의, 카탈로그)가 통과한다. 위 표의 M2 행(spec §9-1, 2, 5, 6, 7, 8, 9)이 모두 포함된다.
2. 질문과 계획 승인이 같은 승인 요청 레코드로 남는 테스트가 통과한다(`product.scope.spec` §4.4 M2, `L2.dialog.plan`과 공동. 두 테스트가 L1.tools의 같은 `approval.requested` payload 스키마로 검사한다).
3. `cd xeon && just verify`가 종료코드 0이다.
4. `L2.work.spec` §10 W-1·W-2·W-4가 F·L1 문서와 합의되어 포트 파일의 [가정] 주석이 실제 이름으로 바뀌었다.

M3:

1. 목표 판정이 상한에서 멈춘다(`goals-limit`). 재개 후 같은 턴을 다시 판정하지 않는다(`goals-resume`). 위 표의 M3 행(spec §9-3, 4, 10, 11)이 통과한다.
2. 목표 종결 커밋에 완료 보고가 들어가고 `WorkReportSchema`를 통과한다.
3. `just verify` 종료코드 0.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 판정 모델 비용. 턴마다 모델 호출이 하나 더 생긴다 | 상한(`l1.agents.judge.maxRuns`, 기본 3)과 역할 라우팅(`l1.models.routing.judge`)으로 작은 모델을 쓴다. 증거 크기를 8,000자 텍스트 + 도구 50개 요약으로 묶는다. 판정 사용량을 보고에 따로 적어 보이게 한다 |
| 자가 판정 우회 요구(모델이 "끝났다"고 말하면 멈추게 해 달라는 요구) | 도구 `goal_complete`를 정의하지 않는다. 필요하면 delegated 판정자를 쓰는 그룹이나 플러그인으로 만든다. 계약을 바꾸는 요청은 스펙 개정으로만 받는다 |
| 계획 모드와 권한 모드의 소유 경계 혼선 | 쓰기 차단과 모드 상태는 L1.tools, 계획 객체와 승인 흐름은 work로 스펙 §4.2.1 표에 고정한다. L1.tools 작성자와 포트 시그니처(`PermissionModePort`, `ApprovalsPort`)를 T5 시작 전에 사전 합의한다 |
| 승인 프로토콜 인터페이스가 L1.tools 작성 중이라 바뀜 | 포트 한 곳(`src/ports/approvals.ts`)에 격리하고 가짜 포트로 테스트한다. 실제 이름이 정해지면 포트만 고친다 |
| 작업 이벤트 증가에 따른 투영 비용 | 작업 수 상한 500, `write` 연산 50개 상한. 투영은 행 단위 갱신만 한다. 재생성 비용은 `projection.int.test`에서 이벤트 10,000개 기준 시간을 기록해 둔다 |
| 판정과 사용자 턴의 경합 | 판정 중 새 턴이 시작되면 post를 생략한다. post 키를 `goal:<goalId>:<n>`으로 고정해 중복 투입을 막는다 |
| 도구 없는 능력이 F에서 거부됨(W-3) | `goal_status` 읽기 도구 하나를 두는 대안을 준비한다. 판정 결과를 쓰는 도구는 두지 않는다 |

## 8. M2 구현 기록

`m2-plan` 트랙 WK의 진행을 적는다. 작업 ID와 규모의 정본은 §3이다.

### 8.1 WK.1 (T2, T3): 작업 모델, `task_write`, 투영기

| 항목 | 상태 | 위치 |
|---|---|---|
| T2 전이 표, 막힘 계산 | 완료 | `src/tasks/model.ts` |
| T2 순환 검사(깊이 우선, 경로 반환) | 완료 | `src/tasks/graph.ts` |
| T2 `write` 연산 적용(임시 참조, 전부 또는 전무, 자동 시작) | 완료 | `src/tasks/write.ts` `planWrite` |
| T3 `work.tasks` 서비스(create, update, link, list, write), 스레드별 쓰기 큐 | 완료 | `src/tasks/service.ts`, `src/tasks/queue.ts` |
| T3 `task_write` 도구 등록(`risk: "read"`) | 완료 | `src/plugin.ts` |
| T3 투영기 `cap.work` 버전 1(작업 부분) | 완료 | `src/projection/*` |
| T3 방치 알림(`input.agent.before`) | 완료 | `src/tasks/reminder.ts`, `src/plugin.ts` |
| T8 설정 키 여섯 개 선언과 읽기 | 완료(선언은 여섯 개 모두, 읽는 곳은 `tasks.*` 둘) | `src/settings.ts` |

파일 배치는 §2와 두 곳이 다르다.

- 서비스 쓰기 경계의 오류 변환은 `src/errors.ts`, 규칙 거부 값은 `src/tasks/failure.ts`다. `src/service.ts` 조립은 `src/tasks/service.ts`에 있고 `src/plugin.ts`가 조립 루트다.
- 포트 파일은 `src/ports/session.ts` 하나다. `xeon.session`의 부분(`commit`, `feed`, `projectors`)과 `cap_work_*` 읽기 핸들(`xeon.store`의 `scoped("cap.work")`)을 이름 붙여 둔다. `PermissionModePort`, `ApprovalsPort`, `JudgePort`는 해당 작업(WK.2·WK.3, T10)이 추가한다.

시험은 `test/`에 있다. 실제 SQLite(`@xeon/platform-store/testing`) 위에 `core-persistence`의 세션 서비스를 올려 쓰고, 저장소를 배열로 흉내 내지 않는다.

| 파일 | 확인하는 것(§5 대응) |
|---|---|
| `tasks-graph.test.ts`, `tasks-graph.prop.test.ts` | 간선 순환 거부, 순환 없음 성질(고정 시드 8개 × 간선 1,000개) |
| `tasks-model.test.ts` | 전이 표 25칸, 막힘 계산 |
| `tasks-write.test.ts` | write 전부 또는 전무, 임시 참조, 자동 시작, 상한, 이벤트 payload가 카탈로그 스키마를 통과 |
| `tasks-service.int.test.ts` | 같은 requestId 재호출, 거부의 되풀이, `key_reused`, 효과 없는 호출, 직렬 큐, 스레드 분리 |
| `projection.int.test.ts` | 재생성 동일성(무작위 연산열 3개 시드), 투영 행과 계획 상태의 일치, `cap_work_meta` |
| `reminder.test.ts`, `plugin.test.ts` | 방치 알림(질의만, 이벤트를 쓰지 않음), 능력 제공, 도구 등록, 등록 거부 |
| `defs.contract.test.ts`, `catalog.contract.test.ts`, `settings.test.ts` | 정의·카탈로그·설정 선언 |

미충족과 통합 때 바꿀 것:

- **투영기 등록부.** WK.2·WK.3 통합 때 대역(`projecting-session.ts`)을 지우고 실제 `session.projectors`를 쓴다. 같은 커밋 트랜잭션 안의 투영과 커밋 리스너 알림이 실제 순서로 동작한다. 실제 등록부가 테이블 이름 규칙(접두 뒤 지역 이름에 밑줄 없음)을 검사해 `cap_work_task_edges`를 `cap_work_edges`로 바꿨다.
- **재생성 시간 기록.** 이벤트 10,000개 재생성 시간(§7)은 아직 재지 않았다. 실제 등록부로 바꿨으니 잴 수 있다.
- **W-5.** 되감기 뒤 활성 가지 재생성은 구현하지 않았다(spec §4.1.5).

### 8.2 WK.2 (T4, T5): 계획 객체와 버전, 모드 진입·이탈

| 항목 | 상태 | 위치 |
|---|---|---|
| T4 계획 상태, `work.plan_submitted`·`work.plan_withdrawn` 커밋, 투영 `cap_work_plans`(승인 요청·해결 반영), `versions` | 완료 | `src/plans/service.ts`, `src/plans/model.ts`, `src/plans/decision.ts`, `src/projection/projector.ts` |
| T5 `enterMode`·`exitMode`, `requireApproval` 검사, 대기 버전 철회 | 완료(F `ToolService.mode`·`setMode` 위. 시험은 core-tools의 실제 `ToolService`가 세션 설정 이벤트를 쓴다) | `src/ports/permission-mode.ts`, `src/plans/service.ts` |
| T5 권한 모드 추적(직전 모드, 진입 시점) | 완료(세션 범위 `settings.changed`에서 투영) | `src/projection/projector.ts` |

### 8.3 WK.3 (T6, T7, T8): 계획 제출·승인, 산출물, 설정·명령

| 항목 | 상태 | 남은 일 |
|---|---|---|
| T6 `submit_plan` → 승인(kind `plan`), `input_required`·`decided`, `approve`·`reject`·`revise`, 승인 해결 뒤 모드 복원 리스너, 재개 절차 | 완료: core-tools의 실제 `ApprovalService` 위에서 시험한다. 어댑터는 `planApprovalsOver`(W-15). 수정 요청은 `deny` + `{ feedback }`(W-2 (c)) | SIGKILL 재개는 HOST.4의 한 엔진 시험 |
| T7 계획 산출물 등록(선택 의존) | 부분: `PlanArtifactsPort`와 사용 가능·불가 두 경로를 시험했다 | `artifacts.registry` 정의가 F에 들어온 뒤 어댑터(L2.artifacts M3) |
| T8 설정 키 여섯 개 | 완료 | 없음 |
| T8 명령 `/plan`, `/tasks` | 부분: 등록 함수와 시험 완료 | `dialog.commands` 선택 의존 확정(W-10) 뒤 매니페스트 `optional`로 연결. `/goal`은 M3 |

대역은 `@xeon/cap-work/testing`에 `createFakeArtifacts`(산출물 등록)만 둔다. 승인과 권한 모드는 대역이 없다: 시험은 core-tools의 `testing` 서브패스 `realTools`로 실제 `ToolService`·`ApprovalService`를 같은 실제 세션 위에 세우고(`test/support/l1.ts`가 요청 목록, 호출 기록, 요청 커밋 장애 주입의 관찰 창을 더한다), 플러그인이 기본으로 만드는 `planApprovalsOver`·`toolsPermissionMode`를 그대로 쓴다.

시험 추가분:

| 파일 | 확인하는 것(§5 대응) |
|---|---|
| `plans-versions.int.test.ts` | 계획 버전 보관, `plan_pending`, 같은 requestId 재호출 |
| `plans-decision.int.test.ts` | 승인·반려(수정 요청 포함) 분기와 `submit` 재호출 출력, 계획 승인이 받지 않는 응답은 적용되지 않음, 같은 레코드 형식(E5, spec §9-1) |
| `plans-mode.test.ts` | 승인 전 실행 단계 진입 금지(spec §9-5), 승인 뒤 복원 한 번, 승인자가 고른 모드, 정책이 그 사이 막은 모드로의 복원 거부 |
| `plans-resume.fault.test.ts` | 승인 요청 전 강제 종료 뒤 복구에서 요청이 한 번만 생김, 재시작 뒤 응답이 `decided`를 한 번 냄(spec §9-9), L1.tools 서비스 재시작 뒤 빈 대기 목록을 이벤트에서 다시 채움 |
| `plans-artifact.test.ts` | 산출물 선택 의존, 등록 멱등 |
| `commands.test.ts`, `permission-mode.test.ts`, `plugin.test.ts` | 명령 등록, 권한 모드 어댑터, 플러그인 조립 |

통합 결과(WK.2·WK.3, 2026-10-24):

- `settings.changed` 대역은 지웠다. 권한 모드 쓰기는 실제 `sessionSettings.set`이다.
- `WorkPluginOptions.approvals`는 생략할 수 있다. 생략하면 `xeon.approvals` 포트를 `planApprovalsOver`로 감싼다(W-15).
- W-2 (c)는 수정 요청을 `deny` + `{ feedback }`로 옮겨 닫았다. 기록에서 반려와 구별되지 않으므로 `revision_requested`는 이 경로에서 만들어지지 않는다. 구별이 필요하면 F가 `DenyAnswer`에 필드를 더해야 한다.
- 실제 등록부가 드러낸 결함 둘을 고쳤다. 테이블 이름 `cap_work_task_edges`(밑줄 규칙 위반)와, 승인 해결 리스너가 커밋 리스너 안에서 모드를 커밋하다가 `store.nested_write`로 거부된 것(마이크로태스크로 미룬다).
