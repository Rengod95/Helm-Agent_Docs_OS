---
id: L1.agents.plan
layer: L1
domain: agents
kind: plan
status: draft
depends_on: [L1.agents.spec, L1.tasks.plan, L1.tools.plan, L1.loop.plan, L1.models.plan, L1.persistence.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/core-agents/**]
---

# L1 서브에이전트 (agents) 구현 계획

패키지: `xeon/packages/core-agents` (현재 스캐폴드: `package.json`, `src/index.ts`, `xeon.layer = "L1"`, `xeon.domain = "agents"`)

## 1. 목표와 마일스톤 배치

목표: L1.agents.spec의 `xeon.agents`를 구현한다. M2에서 Helm의 렌즈 N개 탐구(UC-2)가 서브에이전트 N개를 돌려 결과를 커밋하고, M3에서 학습 그룹의 검토 포크(UC-3)가 백그라운드 위임으로 돈다.

| 단계 | 범위 | 근거 |
|---|---|---|
| M0 | core-agents 코드 없음 | `_research/foundation-plan.md` §5 P4 M0 |
| M1 | core-agents 코드 없음. 걸어 다니는 골격 범위 밖이다. 단, contracts M1에서 `LoopHandle.spawn`, `SpawnSpec`, `SpawnOutcome` 타입 자리를 확보한다(F.extensions.spec §3.2, 이미 F에 있음). M1 테스트 그룹의 drive는 `loop.spawn`을 부르지 않는다. [제안] X가 `xeon.agents`가 없을 때 `spawn`을 `{ status: "error", answer: "agents.unavailable" }`로 돌려주는지만 확인한다 | `_research/foundation-plan.md` §5 P4 M1 범위, `product.scope.spec` §4.3 M1 행 |
| M2 | 자식 대화 생성과 부모 연결, 포그라운드 `spawn`(모델 도구 `agent`, drive `loop.spawn`), 권한 상한과 차단 목록, 깊이·동시 상한, 결과 반환(길이 상한, 모방 검사, 격리 블록), requestId 파생과 재개 중복 방지, 확장 정의(매니페스트 `components.agents`)와 코드 등록 `define` | product.scope.spec M2 종료 조건 "렌즈 N개 탐구에서 서브에이전트 N개 결과 커밋 뒤 적용 턴을 한 번 실행"(UC-2) |
| M3 | 백그라운드 위임(`delegate`, 완료 보고 post, 직접 취소), 목표 판정(`judge`, 상한, `agent.judged`) | product.scope.spec M3 종료 조건 UC-3, "목표 판정이 실행 횟수 상한에서 멈춘다" |
| 2차(M3 이후) | 프로젝트·사용자 디렉터리 정의 파일 로더와 위치 우선순위, 새 스레드 handoff, 판정 B안(제한된 자식 세션) 검토 | `_research/layer-plan-v2.json` L1-g 2차 행 |

- [제안] 확장 정의 읽기를 M2로 당긴다. Helm이 M2에 `explorer` 정의를 매니페스트로 싣기 때문이다(L1.agents.spec §4.9). 파서는 40줄 포크라 비용이 작다.
- M2의 Helm 탐구는 포그라운드 `loop.spawn`을 병렬로 부른다(L3.helm.spec §4.5). 백그라운드 경로는 M3에 들어오므로 M2 테스트는 포그라운드만 다룬다.

## 2. 패키지와 파일 배치

```
xeon/packages/core-agents/
  package.json                 # dependencies: @xeon/contracts, @xeon/ext-host(플러그인 API), yaml 2.9.0
  src/
    index.ts                   # plugin만 export
    plugin.ts                  # ext-host 플러그인: xeon.agents 제공, 내장 도구 agent와 차단 규칙 등록, 설정 등록 (AG-10)
    service.ts                 # AgentService 구현: spawn, delegate, cancel, status, define (AG-1, AG-6, AG-7)
    child-session.ts           # 자식 thread 생성(thread.started + agent.spawned 한 커밋), xeon.loop 열기, 정착 처리 (AG-1, AG-2)
    permission-ceiling.ts      # childDecision(순수), 자식 모드 계산, 자식 광고 입력 (AG-3)
    denylist.ts                # subagent.* 차단 규칙 생성(깊이 설정 반영) (AG-4)
    result-guard.ts            # 최종 보고 추출, 길이 상한, 모방 검사, 격리 블록 (AG-5)
    request-id.ts              # <ownerRequestId>:spawn:<n> 파생, 64자 해시 규칙 (AG-6)
    background.ts              # 위임 접수, 완료 보고 post, 경계 취소 (AG-7)
    judge.ts                   # 판정 호출, 상한 집계, agent.judged 초안 (AG-8)
    definitions/
      loader.ts                # 매니페스트 components.agents 읽기(M2), 디렉터리 탐색·우선순위(2차) (AG-9)
      frontmatter.ts           # pi utils/frontmatter.ts 포크 (AG-9)
    tool.ts                    # 모델 도구 agent 정의(파라미터, 실행 → spawn/delegate) (AG-10)
    settings.ts                # defineSettings("l1.agents", …) (AG-10)
    testing/
      index.ts                 # spawnRecorder, settleAll 훅(UC-2 통합 테스트용), fakeLoop(자식 대화 실행 대역)
  test/
```

- `denylist.ts`, `request-id.ts`, `tool.ts`, `testing/`은 이 계획이 나눈 파일이다 [제안].
- core-agents는 core-loop·core-tasks·core-tools를 import하지 않는다. 협력은 `xeon.loop`, `xeon.tasks`, `xeon.tools`, `xeon.session` 서비스와 F 타입으로 한다(`eng.dependency-rules.guide` DR-02, `L1.readme` §4.2).
- `childDecision`은 F `policy.ts`로 옮기도록 요청했다(L1.agents.spec §8.3 F 요청 5). 옮겨지면 `permission-ceiling.ts`는 자식 모드와 광고 입력 계산만 남는다.

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| AG-0 | 선행 확인: core-tasks 소유 트리·`subagents` 풀·입력 큐 초안 `draftQueued`(L1.tasks.plan), core-tools 정책 엔진·`registerRules`와 `ToolRunContext.ceiling`(L1.tools.plan TL-3·TL-13), core-persistence 커밋 API와 자식 연결 kind(F 요청 3, F.records 카탈로그에 있음), `TxView.agentByRequestId`·`p_agents`(L1.persistence.plan PS-23), core-loop `runChildTurn`(L1.loop.plan LP15) | — | S | M2 |
| AG-1 | 자식 thread 생성과 부모 연결 기록: `thread.started`(fork면 `forkedFrom`) + 부모 `agent.spawned` 한 커밋 | AG-0 | M | M2 |
| AG-2 | 자식 실행 단위 수명과 취소 연결: `xeon.loop.runChildTurn`(L1.loop.spec §3.1·§4.13, L1.loop.plan LP15)으로 자식 turn 실행, 소유 노드 등록(`openScope` kind `subagent`), 부모 취소 전파와 하향 정착 순서, `agent.settled` 커밋 | AG-1 | L | M2 |
| AG-3 | 권한 교집합 계산: `childDecision`(부모 관점·자식 관점·정의 제한의 `stricter`), 자식 모드, 자식 광고 입력(`allow`, `keepParentList`), core-tools 정책 엔진 호출 | AG-0 | M | M2 |
| AG-4 | 차단 목록: `subagent.no-spawn`(minDepth = maxDepth), `no-user-interaction`, `no-shared-write`, `no-external-send`를 `ToolService.registerRules("core:agents", …)`(L1.tools.plan TL-3)로 default 티어 deny 등록, `maxDepth` 변경 시 같은 출처로 다시 등록 | AG-3 | S | M2 |
| AG-5 | 결과 길이 제한과 모방 검사: 최종 보고 추출, `resultMaxChars` 절단, flag 5종 검사, 격리 블록과 이스케이프, 경고 문장 | — | S | M2 |
| AG-6 | requestId 파생과 재개 중복 방지: `<ownerRequestId>:spawn:<n>`, 64자 해시, 커밋 안 조회(`TxView.agentByRequestId`, L1.persistence.plan PS-23)로 기존 자식 재사용(정착·진행·끊김 세 경우), 재개 때 `ResumePlan.openChildren` 처리 | AG-1 | M | M2 |
| AG-7 | 백그라운드 위임과 inbox 합성 입력: `delegate` 접수, 경계 소유 노드, 정착 뒤 `PostItem{ kind: "context" }` post(`<requestId>:report`), 직접 취소, 세션 `{ background: true }` 취소 연결 | AG-2, AG-6 | M | M3 |
| AG-8 | 판정 호출과 횟수 상한: `xeon.models` 역할 `judge` 단발 호출, 구조화 출력 검증, `(threadId, goalRef)` 실행 수 집계, `capped`·`recorded`·`failed`, 응답 직후 `agent.judged` 자기 커밋 | AG-0 | M | M3 |
| AG-9 | 정의 파일 로더: frontmatter 포크, `AgentDefinitionSchema` 검증, 매니페스트 `components.agents` 읽기(M2), 디렉터리 탐색과 우선순위(2차), 진단 | — | S(M2) + M(2차) | M2, 2차 |
| AG-10 | 서비스·도구·설정 등록: `plugin.ts`, 내장 도구 `agent`(`xeon.tools` 등록, classes `["spawn"]`, replay safe), `settings.ts`(키 4개) | AG-3, AG-4 | S | M2 |
| AG-11 | 동시 상한: 전체 풀 `limiter("subagents")`(크기 `l1.tasks.limits.subagents`) + 소유 트리 루트별 상한 `l1.agents.maxConcurrent`, 대기 상태 `queued`, 대기 중 취소, 자식을 기다리는 도구의 `slot.suspendWhile` | AG-2 | S | M2 |
| AG-12 | UC-2 통합 테스트 훅: `testing/spawnRecorder`(agent.spawned·settled seq 기록), `settleAll(parentThreadId, requestIds)` | AG-2 | S | M2 |

선행 관계 요약: AG-0 → {AG-1, AG-3, AG-8} → AG-6 → AG-2 → {AG-7, AG-11, AG-12}. AG-3 → AG-4 → AG-10. AG-5, AG-9는 독립.

외부 선행:

- core-tasks: 소유 트리 노드 API, 백그라운드 경계, 취소 의도 커밋과 전파, `subagents` 풀, 입력 큐 초안 `draftQueued`(L1.tasks.plan). 이름은 L1.agents.spec에서 [가정]으로 두었다.
- core-tools: `evaluatePolicy`, `stricter`, 코어 규칙 등록 `registerRules`(default 티어 출처 `core:agents`), `ToolRunContext.ceiling` 처리(ceiling 단계), 도구 등록(L1.tools.plan TL-3·TL-8·TL-13).
- core-persistence: 커밋 API, 자식 대화 재개, 자식 연결 kind(`agent.*`, F 요청 3 반영), `p_agents` 투영과 `TxView.agentByRequestId`, `ResumePlan.openChildren`(L1.persistence.plan PS-23).
- core-loop: `runChildTurn` 진입점(L1.loop.plan LP15), 완료 게이트(`agent_before_settle`)에서 L2.work 핸들러가 `judge`를 부르는 경로(L1.loop.plan).
- core-models: 역할 `judge`, `subagent` 라우팅과 구조화 출력, 테이프(L1.models.plan).
- ext-host: `loop.spawn` → `xeon.agents.spawn` 연결, 그룹 위임 래퍼에 서비스 주입(X.primitives.plan, L3.group-kit.plan).

## 4. 채택 코드

| 대상 | 방식 | 버전·원본 | 바꿀 점 |
|---|---|---|---|
| `@earendil-works/pi-agent-core` | 그대로(정확 고정), core-loop 경유 | 1.3.0. 판정 원문은 `Agent` 클래스(`agent/src/agent.ts:188`)를 자식마다 생성 | core-agents는 어느 패키지도 import하지 않는 pi-agent-core를 쓰지 않는다(adr.0009). L1.loop.spec §3.2가 `Agent` 클래스 대신 turn마다 자체 루프 `runTurn`을 쓰므로 자식도 같은 루프로 돈다(L1.agents.spec §4.1 5번, [미결]) |
| pi `utils/frontmatter.ts` | 포크 | `~/projects/_ref/pi-src/packages/coding-agent/src/utils/frontmatter.ts`, pi 커밋 `cdaf6c2`, 40줄 | (1) `import { stripBom } from "./text.ts"`를 지우고 BOM 제거를 파일 안 한 줄로 옮긴다(`text.ts:7`의 `stripBom`). 원본은 pi 세션 타입에 결합되어 있지 않다. 결합은 이 import 하나뿐이다. (2) `yaml.parse` 예외를 잡아 `Result`로 돌려준다(eng.typescript.guide TY-11). (3) 반환 타입의 `frontmatter`를 `unknown`으로 두고 `AgentDefinitionSchema`로 검증한다. (4) `stripFrontmatter`는 쓰지 않으면 지운다(knip) |
| `yaml` | 그대로(정확 고정) | 2.9.0(pi coding-agent `package.json`과 같은 값) | 없음 |
| typebox | 그대로 | catalog 값 | 없음 |

검토용 읽기 자료(코드는 가져오지 않는다):

- opencode `session/subagent-job.ts`, `subagent-completion.ts`: 포그라운드·백그라운드 Job과 완료 알림 흐름(`_research/refs/opencode.md` 64·124행, `_research/packages.md` §4.3 L1-g "백그라운드 위임"). 확인할 점: 완료 알림의 중복 방지, 부모 인터럽트 시 자식 처리.
- omp task 도구(`task/executor.ts`, `task/spawn-policy.ts`, `structured-subagent.ts`): 같은 스레드 자식 세션, `spawns` 제한, 깊이 한도, 자식 승인 모드(`_research/refs/oh-my-pi.md` 209-219행). 확인할 점: omp는 자식 승인 모드를 yolo로 고정하고 부모의 task 승인을 경계로 본다. Xeon은 자식 ask를 부모 사용자에게 올리므로 다르다.
- pi durable `test/examples/22-subagent-foreground.ts`, `23-subagent-background.ts`, `vacation.ts:60-133`: 소유 대화와 reporter task의 requestId 파생(`_research/refs/pi-durable.md` §3.9).

## 5. 단위 테스트 목록

모델은 테이프, 자식 대화 실행은 `testing/fakeLoop` 또는 core-loop 테스트 대역, 시계·ID는 주입한다(eng.testing.guide TS-03·TS-04).

| 테스트 | 확인할 동작 | 작업 |
|---|---|---|
| `child_cannot_use_tool_denied_to_parent` | 부모 관점 deny(`caller: "main"` 조건 포함) 도구는 자식에서 거부되고, 정의 규칙의 allow가 있어도 거부된다 | AG-3 |
| `child_mode_never_looser_than_parent` | 부모 `plan` + 정의 `acceptEdits` → 자식 `plan`. 부모 `acceptEdits` + 정의 `plan` → `plan` | AG-3 |
| `child_denylist_blocks_recursive_spawn` | 깊이 한도의 자식 광고 목록에 `agent`가 없고, 직접 호출은 `subagent.no-spawn` 거부다 | AG-4 |
| `child_denylist_blocks_user_interaction` | `classes: ["user_interaction"]` 도구는 자식에서 거부, 자식의 일반 도구 ask는 부모 대화의 승인 요청이 된다 | AG-4 |
| `depth_one_rejects_nested_spawn` | `maxDepth = 1`에서 자식의 `spawn`은 `agents.depth_exceeded`, `maxDepth = 2`면 손자 생성 성공 | AG-4, AG-6 |
| `concurrency_cap_queues_extra_spawns` | `l1.agents.maxConcurrent = 2`에서 세 번째는 `queued`, 앞의 하나가 정착한 뒤 실행. 전체 풀 상한 1에서도 같은 순서로 모두 정착 | AG-11 |
| `background_child_survives_parent_abort` | 부모 turn 취소 뒤에도 백그라운드 자식이 `completed`로 정착하고 보고 post가 들어간다 | AG-7 |
| `background_child_direct_cancel` | `cancel({ childThreadId })`가 취소 의도를 커밋하고 자식이 `aborted`로 정착, 보고 post 1건 | AG-7 |
| `foreground_child_settles_before_parent_end` | 부모 취소 시 포그라운드 자식 모두의 `agent.settled`가 부모 `turn.completed`보다 앞 seq | AG-2 |
| `spawn_request_id_idempotent_after_resume` | 생성 커밋 뒤 강제 종료, 재개 뒤 같은 requestId 호출 → `agent.spawned`·자식 `thread.started` 각 1건, 결과 `reused: true` | AG-6 |
| `spawn_request_id_derivation` | `tool:<id>`에서 `tool:<id>:spawn:0`, 두 번째는 `:spawn:1`, 64자 초과는 `spawn:` + 해시 40자 | AG-6 |
| `result_guard_truncates_and_flags_instruction_mimicry` | 30,000자 보고 → 24,000자 + 안내, `truncated: true`. `System:`·"ignore previous instructions"·`</subagent_report` → flag 3종, 이스케이프 뒤 블록 하나 | AG-5 |
| `result_guard_wraps_clean_report` | 표지 없는 보고도 격리 블록으로 감싸고 경고 문장은 없다 | AG-5 |
| `judge_stops_at_max_runs` | `maxRuns = 3`에서 네 번째 호출은 테이프를 소비하지 않고 `capped` | AG-8 |
| `judge_result_not_rerun_on_resume` | `agent.judged` 커밋 뒤 재개, 같은 `(goalRef, run)` 호출은 `recorded`이고 모델 호출 0회 | AG-8 |
| `judge_schema_violation_is_undecidable` | 스키마를 어긴 판정 응답은 다시 묻지 않고 `undecidable`, 실행 수 1 증가 | AG-8 |
| `definition_file_frontmatter_parse_errors` | YAML 오류, 필수 필드 누락, 잘못된 이름 형식이 각각 진단 1건이고 다른 정의 적재는 계속된다 | AG-9 |
| `definition_priority_project_over_user` (2차) | 같은 이름이면 프로젝트 > 사용자 > 확장 > 내장 | AG-9 |
| `usage_attributed_once` | 자식 사용량은 `agent.settled.usage`에만 있고 부모 `turn.completed` 사용량에 들어가지 않는다 | AG-2 |
| `background_report_single_custom_item_after_resume` | 백그라운드 위임 완료 보고가 부모 대화에 `custom` item 하나로 들어가고, 정착 직후 강제 종료·재개 뒤 같은 보고 post는 `duplicate: true`이며 item이 늘지 않는다(spec §9-10) | AG-7 |
| `settings_defs_pass_checks` | `l1.agents.*` 4키(`maxDepth`, `maxConcurrent`, `resultMaxChars`, `judge.maxRuns`)가 `checkSettingDef`·`buildCatalog`를 통과하고 키·기본값·범위가 spec §6 표와 같다. 탭은 models다(review.decisions-2 S-14) | AG-9, AG-10 |

## 6. 완료 기준

- 위 단위 테스트가 패키지 단위 `bun test`로 통과한다(단계별 범위).
- M2: UC-2 수용 기준(서브에이전트 N개 결과 커밋 뒤 적용 턴 1회)을 통합 테스트로 확인할 수 있는 훅을 제공한다. `@xeon/core-agents/testing`의 `spawnRecorder`가 `agent.spawned`·`agent.settled`의 seq를 기록하고, `settleAll(parentThreadId, requestIds)`가 N개 정착을 기다린다. L3.helm.plan의 통합 테스트가 "N개 `agent.settled` seq < 적용 turn의 `turn.started` seq, 적용 turn 1회"를 이 훅으로 검사한다.
- M3: UC-3 경로(학습 그룹 `g.delegate` → `delegate` → 보고 post)가 Helm drive 임대 중에도 동작하는 테스트가 L3.learning.plan 쪽에 있고 이 패키지의 훅으로 돈다.
- `just verify`가 종료코드 0이다.
- check-layers: core-agents가 다른 `core-*`, `cap-*`, `group-*` 패키지와 `cordis`를 import하지 않는다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 지시문 모방 검사의 오탐·미탐 | 격리 블록과 길이 상한을 기본 방어로 둔다. 검사는 보조이고 결과를 버리지 않으며 flag와 경고 문장만 남긴다(L1.agents.spec §4.6 5번). 오탐·미탐 사례는 테스트 표본에 계속 더한다 |
| 판정 모델 비용 | 횟수 상한(`l1.agents.judge.maxRuns`)과 역할 라우팅(`judge`를 작은 모델로)으로 제어한다. 무도구 단발 호출이라 한 번의 비용이 정해진다 |
| F 카탈로그의 `agent.*` 코드 반영이 늦음 | contracts 코드에 `agent.*` 카탈로그 항목이 들어오기 전에는 AG-1을 시작하지 않는다. core-agents 소유 확장 kind는 쓸 수 없으므로(코어는 `x.` 접두를 쓰지 않는다) M2 시작 선행으로 둔다 |
| core-loop의 자식 turn 진입점 구현이 늦음 | L1.loop.spec §3.1·§4.13에 `runChildTurn`이 정의되었고 구현은 L1.loop.plan LP15(M2)다. LP15가 끝나기 전에는 `testing/fakeLoop`로 core-agents를 먼저 구현·테스트한다 |
| 백그라운드 자식이 동시 풀을 독점 | M3에서 풀 공유를 측정하고 [미결](L1.agents.spec §10) 결정에 따라 백그라운드 몫을 나눈다 |
| 그룹 위임 래퍼(group-kit)와 필드 불일치 | L1.agents.spec §3.2 대응표를 L3.group-kit.spec에 수정 요청으로 냈다. M3 착수 전에 두 문서의 필드를 대조한다 |
| 재개 때 끊긴 자식의 재실행이 중복 효과를 냄 | 자식 대화의 도구 효과는 자식 대화의 3단 기록과 `decideEffectRecovery`로 닫힌다(L1.persistence.spec). core-agents는 자식을 새로 만들지 않고 같은 대화를 재개한다(AG-6) |
