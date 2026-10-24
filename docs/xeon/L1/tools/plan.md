---
id: L1.tools.plan
layer: L1
domain: tools
kind: plan
status: draft
depends_on: [L1.tools.spec, L1.persistence.spec, L1.tasks.plan, L1.persistence.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/core-tools/**]
---

# L1 도구 실행과 권한 (tools) 구현 계획

패키지: `xeon/packages/core-tools` (현재 스캐폴드: `package.json`, `src/index.ts`, `xeon.layer = "L1"`, `xeon.domain = "tools"`)

## 1. 목표와 마일스톤 배치

목표: L1.tools.spec의 `xeon.tools`, `xeon.approvals`를 구현한다. M1 스모크에서 bash 호출 한 건이 `effect.intent` → `effect.exec` → `effect.result` 3단으로 기록되고, 강제 종료 뒤 재개가 그 기록으로 이어져야 한다.

마일스톤 정의는 `product.scope.spec` §4.3을 따른다. M1은 걸어 다니는 골격(`_research/foundation-plan.md` §5 P4), M2는 L2 능력과 Helm(승인 프로토콜 통합 포함), M3는 첫 공개 릴리즈 후보(학습 그룹, 공유 서비스 모드, 목표 판정 등)다. 그 문서의 M2·M3 정의는 [제안]이고 확정은 [미결]이다. 계획 JSON의 "2차"는 M3 이후에 둔다 [제안].

| 단계 | 범위 | 근거 |
|---|---|---|
| M0 | core-tools 코드 없음. 선행 조건만: contracts에 L1.tools.spec §8.3 F 요청 1·4·6의 타입이 들어가야 한다(F.capabilities.plan, F.extensions.plan, `@xeon/contracts/services`). 요청 3의 `approval.*` kind는 F.records 카탈로그에 있다 | `_research/foundation-plan.md` §5 P4 M0 범위 |
| M1 | 어댑터와 파이프라인(agent-core 훅 연결), tool 범위 노드와 키 큐 연결(잠금 키 산출 포함), 2계층 비밀 마스킹, 의도·실행·결과 커밋, 최소 정책(티어 default·user, resource는 `tool` glob과 `args` 패턴만), 내장 규칙(read·ls allow, bash ask), 권한 모드 `default`만, 결과 경계화(`xeon.exec` 절단 + blob), 최소 승인 대기(kind `tool`만, CLI 한 곳에서 응답), 대기 내구화와 재개 복원 | `_research/foundation-plan.md` §5 P4 M1(도구 read, ls, bash), product.scope.spec M1 종료 조건(승인과 명령 패턴을 갖춘 bash 호출) |
| M2 | 정책 티어 4종 전체와 resource 전 필드, 코어 규칙 등록(`registerRules`), `tools` 풀 슬롯(C3 순서), 모드 4종(`acceptEdits`, `plan`, `bypass`, managed 금지), 승인·질문·계획 승인 통합 프로토콜(`kind: plan`, `question`, wire `approval.respond`), 도구 지연 노출(`tool_search`), `read_tool_output`, 서브에이전트 ceiling 연결 | product.scope.spec M2 종료 조건 "질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록된다", L1.agents.plan M2 |
| M3 | 서비스 모드의 승인 대기 처리(runtime-flow §7 [미결] 결정 뒤), 원격 클라이언트 응답 | product.scope.spec M3 |
| 2차(M3 이후) | 항상 허용 캐시(`core_tools_approvals`), 셸 명령 접두 규칙, 인자 변경용 별도 chain 지점(`tool_call`은 인자 변경 없음, review.decisions-2 U-06), 확장 티어 규칙 등록 | `_research/layer-plan-v2.json` L1-d 2차 행 |
| 보류 | 자동 분류 모드, 자동 승인 리뷰어와 연속 거부 서킷브레이커, 모델 자가 위험도 | `_research/item-catalog.md` L1-d "보류" 행 |

- [제안] M1 정책의 resource에 `args` 패턴을 넣는다. product.scope.spec M1이 "승인과 명령 패턴을 갖춘 bash 호출"을 종료 조건으로 두었기 때문이다. 나머지 필드(`capability`, `mcpServer`, `classes`, `risk`, `caller`, `minDepth`, `mode`)는 M2다.
- M1 승인 대기는 `ApprovalService`의 `tool` 종류만 구현하되 `ApprovalRequest` 형식과 `approval.*` 이벤트는 M2와 같은 것을 쓴다. M2에서 형식을 바꾸지 않기 위해서다.

## 2. 패키지와 파일 배치

```
xeon/packages/core-tools/
  package.json                 # dependencies: @xeon/contracts, @xeon/ext-host(플러그인 등록 API), typebox. @earendil-works/pi-agent-core는 넣지 않는다(adr.0009, 타입은 F `conversation/agent.ts`)
  src/
    index.ts                   # plugin만 export. 다른 L1은 이 패키지를 import하지 않는다
    plugin.ts                  # ext-host 플러그인 정의: xeon.tools, xeon.approvals 제공, 설정 등록 (TL-8)
    runtime.ts                 # ToolService·ApprovalService 조립: meta, mode (TL-8)
    registry.ts                # 등록 표, 이름 충돌(name_conflict) (TL-8)
    expose.ts                  # advertise: orderTools, 전역 deny 제거, 지연 분리, 상한 128 (TL-7)
    entries.ts                 # ToolSpec·DirectToolRegistration → 도구 항목(ToolEntry)과 실행 함수 (TL-1)
    pipeline.ts                # prepare·execute·settleRejected 단계 계약(adr.0009 §3.4), 의도 표 확인, effect.exec, rerun (TL-2, TL-9, TL-14, TL-15)
    validate.ts                # 인자 검증: pi-ai validateToolArguments TypeBox 경로를 옮김 (TL-2)
    calls.ts                   # 진행 중 호출 표(의도 표) (TL-2)
    tasks.ts                   # tool 범위 노드, 잠금 키 산출(mutationKey·canonical 이전), locks.run → tools 슬롯 (TL-17)
    secrets.ts                 # 2계층 마스킹(Redactor.maskDeep), secret.masked, needs_approval 연결 (TL-18)
    bound.ts                   # 결과 경계화: 텍스트 결합, xeon.exec 절단 호출, putBlob, 안내 문장 (TL-6)
    effects.ts                 # effect.intent/exec/result 초안과 커밋 요청, requestId 규칙 (TL-2)
    policy/
      engine.ts                # evaluatePolicy, ruleMatches, stricter (순수) (TL-3)
      rules.ts                 # validateRules, glob·정규식 컴파일 캐시, 내장 기본 규칙, registerRules (TL-3)
      tiers.ts                 # 설정 범위 층 → TieredRule, 확장·core 규칙 출처 (TL-3, TL-8)
      modes.ts                 # 모드 기본값 표, 위험 등급 유도, bypass 금지 처리 (TL-4)
    approvals/
      service.ts               # ApprovalService 구현, 메모리 대기 목록 (TL-5)
      protocol.ts              # kind별 응답 검사, remember 처리, 거부 문장 (TL-5)
      pending.ts               # 대기 내구화(checkpoint 초안), restore, 세션 허용 목록 재구성 (TL-5)
    builtin/
      tool-search.ts           # tool_search 도구 (M2, TL-10)
      read-tool-output.ts      # read_tool_output 도구 (M2, TL-11)
    settings.ts                # defineSettings("l1.tools", …) (TL-8)
    testing/
      index.ts                 # fakeSession(커밋 기록), fakeExtDispatch, fakeStore(putBlob) — 다른 패키지 테스트용
  test/
    *.test.ts, *.fault.test.ts, *.contract.test.ts
```

- `bound.ts`, `effects.ts`, `tasks.ts`, `secrets.ts`, `builtin/`, `testing/`은 이 계획이 나눈 파일이다 [제안]. durable `truncate.ts` 포크는 core-tools에 두지 않는다. 포크는 L0 `platform-exec`에 있고 `bound.ts`가 F 서비스 `xeon.exec`로 부른다 [결정: review.decisions-2 D-08].
- Cordis는 import하지 않는다. 서비스 등록은 ext-host가 주는 플러그인 API로 한다(`eng.dependency-rules.guide` DR-11, `L1.readme` §4.2, X.primitives.spec) [가정: API 이름은 X.primitives.spec이 정한다].
- `@earendil-works/pi-agent-core`는 import하지 않는다. `AgentTool`, `AgentToolCall`, `AgentToolResult`는 `@xeon/contracts/conversation`의 F 정의를 쓴다(L1.tools.spec §3 머리말). 도구 한 호출의 `prepare`·`execute`·`settleRejected`는 core-tools가, 배치 스케줄은 core-loop가 한다(adr.0009).
- 공용 타입(`ToolService`, `PolicyRule` 등)은 contracts에 둔다(L1.tools.spec §8.3 F 요청 6). core-tools는 그 타입을 구현한다.

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| TL-0 | 선행 확인: contracts의 F.capabilities 타입(`ToolSpec`, `orderTools`, 요청 1·6·8), F.conversation 에이전트 타입 `AgentTool`·`AgentToolCall`(F 정의, adr.0009), F.records `approval.*` kind(요청 3), core-persistence 커밋 API(`xeon.session` `commit`), platform-store `putBlob`, platform-sandbox 인터페이스(bash 실행용, L2.workspace 경유) | — | S | M1 |
| TL-1 | 어댑터: `ToolSpec` → 도구 항목(`ToolEntry`) 5단계 환원과 `CapabilityError` → `isError` 변환(F.capabilities.spec §4.2), `replay` 대응, `outputSchema` 검증, `DirectToolRegistration` 감싸기, 의도 표 확인과 `effect.exec` 커밋 | TL-0 | M | M1 |
| TL-2 | 파이프라인과 단계 계약(adr.0009 §3.4, 이전 판의 훅 연결을 L1.loop.plan LP18이 대체): `prepare`(`tool_execution_start` → 이름 해석 → 인자 검증 → `tool_call` 지점 → 정책 → 승인 → `effect.intent`), `execute`(`effect.exec` → 실행 → `tool_result` chain → 경계화 → `effect.result`+item 한 커밋 → `tool_execution_end`), 차단 결과의 toolResult item 기록, requestId 규칙(`tool:<id>:intent|exec|result`) | TL-1, TL-3, TL-9 | L | M1 |
| TL-3 | 정책 평가기(순수): `evaluatePolicy` 7단계, `ruleMatches`(glob, JSON Pointer, 정규식), `stricter`, `validateRules`, 내장 기본 규칙. 코어 규칙 등록 `registerRules`(같은 출처 교체, `issues`, `dispose`)는 M2. M1은 티어 default·user와 `tool`·`args`만 (완료 2026-10-24: 티어 4종 순위 시험, `registerRules`는 `policy/core-rules.ts`, 확장 티어 규칙을 넣는 경로는 2차) | TL-0 | M | M1(부분), M2(전체) |
| TL-4 | 권한 모드: 모드 표, 위험 등급 유도(`risk` → `hints.readOnly` → `exec`), `setMode`(세션 범위 설정 쓰기), managed `bypassAllowed`. M1은 `default`만 (완료 2026-10-24: 모드 4종, managed 금지 때 `tools.mode_forbidden`) | TL-3 | S | M1(default), M2 |
| TL-5 | 승인 대기와 재개 복원: `ApprovalService`(`request`, `respond`, `pending`, `restore`, `cancel`), `approval.requested`+`checkpoint.step`(`next: "await_input"`) 한 커밋, `approval.resolved`, 기억 범위(`thread`, `always` → `thread`), 비대화형 처리. 재개 때 대기 호출은 core-loop가 `runTurn({ kind: "tools", awaitInput: true })`로 `prepare`를 다시 거쳐 같은 승인 요청을 이어 기다린다(L1.loop.spec §4.5) (M2 완료 2026-10-24: kind 셋의 요청·응답 검사, 비대화형 감사 기록, 비차단 `open`·`wait`·`get`, 키 함수는 `approvals/keys.ts`) | TL-2 | L | M1(tool), M2(plan, question) |
| TL-6 | 경계화와 blob 연결: `bound.ts`(한도 설정, `xeon.exec` 절단 호출, 원문 putBlob, 50 MiB 상한, 안내 문장, `"self"` 도구 처리). 절단 함수 포크는 L0.exec.plan 몫 | TL-0, L0.exec.plan의 절단 메서드 | S | M1 |
| TL-7 | 노출 목록: `advertise`(orderTools 부분 수열, 전역 deny 제거, 지연 분리, 128 상한, `tools.too_many`, fingerprint), 활성화 집합 재계산 (M2 완료 2026-10-24: 임계 지연, 활성화, `planExposure`) | TL-3 | M | M1(정렬·deny·상한), M2(지연) |
| TL-8 | 서비스·설정 등록: `plugin.ts`, `service.ts`(등록 표, 이름 충돌), `settings.ts`(L1.tools.spec §6 키 6개), 범위별 규칙 수집(`tiers.ts`) | TL-1, TL-3 | M | M1 |
| TL-9 | `tool_call` fail-closed: ext-host first 디스패치 결과 처리, 핸들러 예외·디스패처 예외·결정 스키마 위반을 모두 거부로, 거부 사유 문장 고정 | TL-0 | S | M1 |
| TL-10 | `tool_search` 내장 도구와 지연 노출 (완료 2026-10-24: `builtin/tool-search.ts`, `builtin/activation.ts`) | TL-7 | M | M2 |
| TL-11 | `read_tool_output` 내장 도구 (완료 2026-10-24: `builtin/read-tool-output.ts`) | TL-6 | S | M2 |
| TL-12 | 질문·계획 승인 통합: `kind: plan`(`setMode` 연결), `kind: question`(`QuestionAnswer` 검사), 활성 호출 표로 L2 요청의 체크포인트 초안 생성, wire `approval.respond` 연결 확인(L4.host-service와 함께) (완료 2026-10-24: `plan_approval`이 모드를 바꾸고, `input_required { approvalId }` 변형은 어댑터가 승인 해결을 기다려 재호출, 시험용 `L2ApprovalsPort` 어댑터는 `testing/l2-port.ts`. MCP 변형은 L1F에서 `mcp-input.ts`로 완료: 질문 승인을 올리고 `continuation`으로 재호출. 동적 MCP 도구(`DirectToolRegistration`)의 재호출은 F 변경 뒤) | TL-5 | M | M2 |
| TL-13 | 서브에이전트 ceiling 연결: `ToolRunContext.ceiling`이 있으면 5b 결정을 `stricter(childDecision(…), evaluatePolicy(…))`로 낸다(L1.tools.spec §4.5 ceiling 단계), 비대화형 ask → deny, 자식 광고 목록(`allow`, `keepParentList`), `registerRules("core:agents")` 수용 (완료 2026-10-24: `stricter`·`childDecision`은 F 것을 쓰고 core-tools 사본은 없앴다. 자식 광고는 `allow`·`keepParentList`·부모 관점 deny) | TL-3, TL-7, F `policy.ts`의 `childDecision`(F 요청 9), L1.agents.plan AG-3 | S | M2 |
| TL-14 | `rerun`: 저장된 `intent.args`로 단계 7a~11 실행(키 잠금·슬롯 재획득 포함), `tool_call`·정책 생략 | TL-2, TL-17 | S | M1 |
| TL-15 | `settleRejected`: 중단으로 실행하지 않는 호출을 `not_executed`로, `length` 절단 응답의 호출을 `truncated`로 닫기(adr.0009 §3.4, 이전 이름 `closeUnexecuted`) | TL-2 | S | M1 |
| TL-16 | `runUserShell`: 사용자 셸 경로(L1.loop.spec `runUserBash`가 부름), caller `main` 대화형 평가 (완료 2026-10-24: `pipeline.ts` `runUserShell`. loop의 `runUserBash`는 L1F에서 완료, 실행 전에 닫힌 호출의 레코드는 `details.code: "not_executed"`) | TL-2, TL-4 | S | M2 |
| TL-17 | 태스크 엔진 연결: tool 범위 노드(`find("turn")`, `openScope` kind `tool`, `track`), 잠금 키 산출(`ToolSpec.locks` → `xeon.exec.canonicalPath` → `${env.id}\0${realpath}`, shared·exclusive), `locks.run` 획득(M1), `limiter("tools")` 슬롯과 C3 순서, 자식 대기 때 `suspendWhile`(M2), 대기 중 취소 처리 | TL-1, L1.tasks.plan TK-1·TK-3(M1)·TK-4(M2), L0.exec `canonicalPath` (M2 완료 2026-10-24: `limiter("tools")` 슬롯을 키 잠금 뒤에 얻고, `ToolServiceInternal.suspendWhile`은 F 요청 14) | M | M1(노드·키 큐), M2(풀) |
| TL-18 | 비밀 경계(L1.tools.spec §4.12): 2계층 마스킹(`Redactor.maskDeep`, 8단계 뒤·9단계 전, 휘발 갱신 전, 경계화·blob 전), `secret.masked` 기록, `findForeignSecretSyntax` 호출, `check`의 `needs_approval` → 승인 요청 연결 (M2 완료 2026-10-24: `secret-gate.ts`, 증거는 L1F에서 `CallContext.approval`로 도구 구현에 전달) | TL-2, L0.secrets 서비스 인터페이스 | S | M1(마스킹), M2(승인 연결) |

선행 관계 요약: TL-0 → {TL-1, TL-3, TL-6, TL-9} → TL-2 → {TL-5, TL-14, TL-15} → TL-12. TL-1 → TL-17 → TL-14. TL-2 → TL-18. TL-2·TL-4 → TL-16. TL-3 → {TL-4, TL-7, TL-8}. TL-7 → TL-10.

외부 선행:

- contracts: F.capabilities(`ToolSpec`, `orderTools`, `toolsetFingerprint`, `MAX_TOOLS_PER_REQUEST`, 요청 1·2·6), F.records(`EffectIntent` 등, 요청 3), F.extensions(`FIRST_DENY`, `CHAIN_RULES`, 요청 4), F.wire-settings(`defineSettings`, 요청 5).
- core-tasks: `TaskService.find`, `openScope`, `TaskScope.track`, `locks`(M1, L1.tasks.plan TK-1·TK-3), `limiter("tools")`·`Slot.suspendWhile`(M2, TK-4).
- core-persistence: `xeon.session` 커밋 API(requestId 멱등, 장애 주입 `FaultInjector`), 재개 절차의 `restore` 호출 자리(L1.persistence.plan).
- platform-exec: `canonicalPath`(L0.exec.plan). platform-secrets: `Redactor`, `check`, `findForeignSecretSyntax`(L0.secrets.plan).
- platform-store: `xeon.store.putBlob`, `readBlob`(L0.store.plan).
- platform-sandbox: bash 실행 인터페이스. core-tools는 직접 부르지 않고 L2.workspace의 bash 도구가 쓴다. M1 스모크의 선행으로만 둔다.
- core-loop: `ToolRunContext` 생성과 `drafts`, 배치 스케줄(순차·병렬, 중단, `terminate`, `length`)과 `prepare`·`execute`·`settleRejected` 호출, 재개 때 `runTurn({ kind: "tools" })`로 대기 호출 재실행(L1.loop.spec §3.3, §4.5).
- ext-host: tool 지점 디스패치(first·chain 규칙, 핸들러 스냅샷)(X.primitives.plan).

## 4. 채택 코드

| 대상 | 방식 | 버전·원본 | 바꿀 점 |
|---|---|---|---|
| `@earendil-works/pi-agent-core` | 의존하지 않음(adr.0009). 설계 참고만 | 1.3.0. 소스는 1.1.0과 바이트 동일(`_research/notes/L1-1.md` §2) | 파이프라인 순서는 `agent-loop.ts:684-949`를 참고해 `prepare`·`execute`·`settleRejected`로 나눴다. `AgentTool`·`AgentToolCall`은 F `conversation/agent.ts` 정의를 쓴다 |
| `@earendil-works/pi-ai` `validateToolArguments` | 옮겨 씀(core-tools `validate.ts`). core-tools는 pi-ai를 import하지 않는다(DR-07) | 1.3.0 `utils/validation.ts`. `argumentsError` 검사(318-320)를 포함한 TypeBox 경로 | 순수 JSON Schema(MCP)의 `coerceWithJsonSchema` 경로는 옮기지 않았다. M2 cap-mcp에서 `ModelService` 감싸기 메서드로 더한다(adr.0009 §7) |
| durable `truncate.ts` | L0 `platform-exec` 포크를 `xeon.exec`로 사용(core-tools에는 사본을 두지 않는다, review.decisions-2 D-08) | `~/projects/_ref/pi-src/packages/durable/src/truncate.ts`, pi 커밋 `cdaf6c2`, 205줄, import 없음 | core-tools 쪽 바꿀 점 없음. 한도 설정은 `bound.ts`가 `TruncationOptions`로 넘긴다 |
| typebox | 그대로 | catalog 값(F.capabilities.spec §10 TypeBox 버전 [미결]을 따른다) | 없음 |
| Gemini CLI 정책 엔진 | 설계 참고만 | `policy-engine.ts`(TOML 규칙, 우선순위 0~999, 티어, 서브에이전트 조건) | 코드를 가져오지 않는다. [가정] 결합도는 확인하지 않았다(`_research/packages.md` §4.3 "둘 다 import 불가"는 조사 판정이다) |
| opencode `permission.ts` | 설계 참고만 | Effect 결합 | `findLast` 평가, 저장된 승인, `registry.snapshot` 노출 제거를 참고한다(`_research/refs/opencode.md` 157-161행) |
| omp approval-cache | 설계 참고만(2차) | `approval-cache.db` | 2차 항상 허용 캐시 테이블 설계에 참고 |

비교: coding-agent `core/tools/truncate.ts`(314줄)를 채택하지 않는 이유.

1. 전역 Node `Buffer`에 직접 의존한다(`Buffer.byteLength` 82·104·128·145·172·201·210·226행, `Buffer.from` 248·293행). durable 판은 `Buffer`가 없으면 직접 세는 `utf8ByteLength`로 대체한다(durable `truncate.ts:46-79`). 엔진은 Bun에서 돌지만 F·L0 경계에서 런타임 가정을 줄이는 쪽이 낫다.
2. 추가된 함수(`truncateTail`, `truncateLine`과 `GREP_MAX_LINE_LENGTH`, `truncateMiddle`)는 coding-agent의 bash·grep·find·ls 도구와 렌더러가 쓰는 것이다(`core/tools/bash.ts`, `grep.ts`, `find.ts`, `ls.ts`, `output-accumulator.ts`, `renderers/*`). 이 도구들은 L2.workspace 몫이다. L1 디스패치 경계화에는 앞부분 보존 하나면 된다.
3. durable 판에는 스트리밍 접두로 같은 결과를 내는 `truncateHeadOf`가 있다(durable `truncate.ts:116-121`). 큰 출력을 다 받기 전에 미리보기를 정할 때 쓸 수 있다.
4. adr.0003이 포크 대상으로 지정한 파일이 durable 판이다(adr.0003 §3 표, `_research/durable-and-search-facts.md` §A-3).

대신 꼬리 보존(`truncateTail`)이 없다. L1.tools.spec §4.8 7번과 §10 [미결]로 남긴다.

## 5. 단위 테스트 목록

모델은 테이프(`@xeon/core-models/testing`, eng.testing.guide TS-04), 커밋은 `testing/fakeSession` 또는 core-persistence 테스트 대역, 시계·ID는 주입한다(TS-03).

[결정: review.m2-plan WK·DG 통합] 다른 패키지의 통합 시험은 `testing/real-runtime.ts`의 `realTools({ session, ... })`로 실제 `ToolService`·`ApprovalService`를 caller가 준 세션(`fakeSession` 또는 core-persistence의 실제 세션) 위에 세운다. 같은 세션 위에서 서비스를 다시 세워 재시작을 흉내 낼 때는 처음 조립이 돌려준 `producer`를 넘긴다(세션 서비스 하나에서 `core.tools` 생산자는 한 번만 받을 수 있다).

| 테스트 | 확인할 동작 | 작업 |
|---|---|---|
| `exposure_removes_denied_tools` | 인자·모드 조건 없는 deny 규칙의 도구가 `tools`에 없고 `removed`에 규칙 id와 함께 있다. 인자 조건 deny 도구는 남는다 | TL-7 |
| `exposure_order_deterministic` | 등록 순서를 바꾼 순열 10개에서 `tools` 순서와 `fingerprint`가 같다 | TL-7 |
| `exposure_caps_at_128` | always 129개면 `tools.too_many`, auto가 섞이면 뒤쪽 auto가 지연 도구가 되어 128개 이하 | TL-7 |
| `validation_error_returned_as_tool_result` | 스키마 위반 인자는 `isError: true` 결과이고 예외가 run을 끝내지 않는다. 효과 이벤트 0건 | TL-2 |
| `tool_call_hook_throw_denies` | `tool_call` 핸들러 예외, 디스패처 예외, 결정 스키마 위반이 모두 거부 결과이고 `effect.intent`가 없다 | TL-9 |
| `intent_committed_before_execute` | 의도 커밋을 장애 주입으로 실패시키면 provider 호출 0회. 의도 표에 없는 id로 어댑터 `execute`를 부르면 provider 호출 0회 | TL-1, TL-2 |
| `exec_committed_separately` | `effect.intent`와 `effect.exec`가 다른 커밋(다른 requestId)이다 | TL-1 |
| `result_and_tool_result_item_same_commit` | `effect.result`와 toolResult `item.recorded`가 같은 requestId 커밋 안 연속 seq다 | TL-2 |
| `capability_error_to_is_error` | `CapabilityError{ code: "rate_limited" }`가 `isError: true`, `"[rate_limited] …"`, `details`에 오류 데이터로 바뀐다. `aborted`는 `effect.result.status: "interrupted"` | TL-1 |
| `policy_higher_tier_deny_wins` | managed deny + user allow → deny. user allow + default ask → allow | TL-3 |
| `policy_same_tier_priority` | 같은 티어에서 priority 600 allow와 500 ask → allow. 같은 priority면 ask | TL-3 |
| `policy_noninteractive_ask_becomes_deny` | `interactive: false`이고 ask 결과면 deny, `reason: "noninteractive"` | TL-3 |
| `policy_evaluator_pure` | 동결한 입력·규칙으로 두 번 평가해 같은 결과, 예외 없음 | TL-3 |
| `policy_invalid_regex_skipped` | 잘못된 정규식 규칙은 적재에서 빠지고 진단 1건, 다른 규칙은 평가된다 | TL-3 |
| `plan_mode_blocks_write_tools` | 모드 `plan`에서 risk write·exec는 deny, read는 allow. 광고 목록은 `default` 모드와 같다 | TL-4, TL-7 |
| `undeclared_risk_is_exec` | 등급과 `hints.readOnly`가 없는 도구는 `exec`로 평가되고 replay는 `unsafe` | TL-4 |
| `bypass_forbidden_by_managed` | `bypassAllowed: false`면 `setMode("bypass")`가 `tools.mode_forbidden`, 평가는 default로 | TL-4 |
| `approval_pending_restored_after_restart` | 승인 대기 중 강제 종료(fault 테스트) 뒤 `restore` → `pending`에 같은 `approvalId` 하나, core-loop 대역이 같은 `prepare`·`execute`로 다시 돌린 뒤 새 `approval.requested` 0건 | TL-5 |
| `approval_respond_twice_not_applied` | 두 번째 `respond`는 `applied: false`이고 이벤트가 늘지 않는다 | TL-5 |
| `approval_remember_thread_skips_next_ask` | `remember: "thread"` 뒤 같은 도구 ask가 승인 없이 allow. 재개 뒤에도 같다 | TL-5 |
| `approval_turn_abort_cancels_pending` | 턴 취소가 대기 요청을 `resolvedBy: "cancelled"`로 닫고 도구는 실행되지 않는다 | TL-5 |
| `question_and_plan_approval_share_request_shape` | 질문 요청과 계획 요청이 모두 `approval.requested`이고 `ApprovalRequestSchema`를 통과하며 `body.kind`만 다르다 | TL-12 |
| `tool_search_activates_for_next_step` (core-tools) | 지연 도구를 찾으면 활성화가 기록되고 다음 `advertise`가 그 도구를 싣는다. 재시작 뒤에도 같다 | TL-10 |
| `read_tool_output_pages_blob` (core-tools) | 줄 범위로 원문을 돌려주고 모르는 해시·도구 출력이 아닌 blob은 오류 결과다 | TL-11 |
| `tools_pool_cap_waits_after_lock` (core-tools) | 슬롯 1개면 두 번째 실행이 첫 실행의 반납 뒤 시작하고 키 잠금 → 슬롯 순서다 | TL-17 |
| `ask_user_waits_for_the_answer` | `input_required`를 낸 도구가 승인 해결까지 `effect.result` 없이 기다리고, 해결 뒤 같은 `requestId`로 다시 불려 결과를 한 번 기록한다 | TL-12 |
| `ask_user_after_restart` | 재시작 뒤 `restore`와 `rerun`이 같은 승인 요청을 이어 받고 새 `approval.requested`가 없다 | TL-12 |
| `mcp_input_retried_with_continuation` | `approvalId`가 없는 `input_required`가 질문 승인(대기 체크포인트와 같은 커밋)이 되고, 답이 `inputResponses`로 `continuation`에 실려 같은 `requestId`로 재호출된다 | TL-12 |
| `mcp_input_declined`, `mcp_input_non_interactive` | 거부와 비대화형은 모든 입력 요청에 `decline`으로 답하고 서버가 마무리한다. 비대화형은 요청과 거부 해결이 한 커밋이다 | TL-12 |
| `mcp_input_cancelled_with_the_turn`, `mcp_input_second_round`, `mcp_input_malformed` | turn 취소는 승인을 닫고 재호출하지 않는다. 라운드마다 다른 요청이고 라운드 번호가 늘어난다. 모양이 틀린 변형은 오류 결과다 | TL-12 |
| `secret_use_evidence_from_the_bash_approval` | `check`가 `needs_approval`인 `secretEnv` 호출이 정책 승인 하나로 증거를 얻고, 규칙이 허용한 호출은 `secret.use` 요청을 따로 올린다 | TL-18 |
| `plan_approval_switches_mode` | 계획 승인 `answer: { mode: "acceptEdits" }`가 `settings.changed`(session 범위)를 남긴다 | TL-12 |
| `truncate_spills_full_output_to_blob` | 60,000바이트 출력 → `putBlob` 1회, `effect.result.blobRef.sha256`가 원문 해시, 모델 내용은 51,200바이트 이하 미리보기 + 안내 문장 | TL-6 |
| `bound_uses_exec_truncation` | `bound.ts`가 절단을 `xeon.exec` 대역으로 부르고 `truncateHead` 결과를 그대로 미리보기로 쓴다(core-tools 소스에 `truncate.ts`가 없다) | TL-6 |
| `self_bounded_tool_skips_bounding` | `outputLimits: "self"` 도구의 `details.blobRef`가 `effect.result.blobRef`로 옮겨지고 다시 자르지 않는다 | TL-6 |
| `rerun_skips_tool_call_hook` | `rerun`은 `tool_call` 핸들러와 정책을 부르지 않고 저장 인자로 실행, 결과 requestId는 처음과 같다 | TL-14 |
| `tool_result_handler_throw_skipped` | `tool_result` 핸들러 하나가 던져도 다른 핸들러 패치는 적용되고 결과가 오류로 바뀌지 않는다 | TL-2 |
| `close_unexecuted_marks_not_executed` | 병렬 배치 중단 뒤 남은 호출이 `not_executed` 결과로 닫히고, 의도가 있던 호출은 `effect.result{ status: "abandoned" }`와 같은 커밋이다 | TL-15 |
| `tool_search_activates_for_next_step` | `tool_search` 결과의 `activated`가 다음 `advertise`에 들어가고 재개 뒤 재계산해도 같다 | TL-10 |
| `read_tool_output_pages_blob` | `read_tool_output{ sha256, offset, limit }`가 blob 원문의 해당 구간을 돌려주고 risk `read`로 평가된다. 없는 해시는 `isError: true` 결과 | TL-11 |
| `child_ceiling_uses_stricter_decision` | `ceiling`이 있는 호출에서 부모 관점 deny면 자식 관점 allow여도 deny, 자식 결과 ask이고 `interactive: false`면 deny, 정의 `allow` 밖 도구는 `agent.<이름>.tools` deny | TL-13 |
| `child_advertise_respects_allow_and_keep_parent_list` | 자식 `advertise`에서 `allow` 밖 도구와 자식·부모 관점 전역 deny 도구가 빠진다. `keepParentList`면 부모 목록과 같고 실행 시점에 거부된다 | TL-13 |
| `register_rules_replaces_same_source` | 같은 `core:agents` 출처 두 번째 등록이 첫 집합을 대체하고, 잘못된 규칙은 `issues`로 돌아와 적재되지 않으며, `dispose` 뒤 평가에서 빠진다 | TL-3 |
| `run_user_shell_evaluates_as_main_interactive` | `runUserShell`이 caller `main`, `interactive: true`로 평가되고 효과 3단을 남긴다. deny 규칙이면 실행 0회 | TL-16 |
| `settings_defs_pass_checks` | `l1.tools.*` 6키가 `checkSettingDef`·`buildCatalog`를 통과하고 키·기본값·범위가 L1.tools.spec §6 표와 같다 | TL-8 |
| `tool_scope_opened_under_turn` | 실행마다 tool 노드가 turn 노드 아래 열리고 10단계 커밋 뒤 정착한다. turn 취소가 실행 중 도구의 신호를 켠다 | TL-17 |
| `same_realpath_writes_serialized` | 상대 경로와 심볼릭 링크로 같은 파일을 쓰는 두 호출의 실행 구간이 겹치지 않고, 다른 파일이면 겹친다. 읽기 둘은 겹친다 | TL-17 |
| `lock_wait_abort_leaves_no_exec` | 잠금 대기 중 turn 취소면 그 호출에 `effect.exec`가 없고 중단 결과다 | TL-17 |
| `tools_pool_cap_waits_after_lock` | `limits.tools = 1`이면 두 번째 실행이 첫 실행의 반납 뒤 시작하고, 기록된 순서가 키 잠금 → 슬롯이다(C3) | TL-17 |
| `tool_result_masked_before_commit_and_points` | 가짜 `Redactor`에 등록한 값이 `effect.result`, toolResult item, blob, `tool_result`·`tool_execution_update` 페이로드에 없고 `secret.masked` 1건이 남는다 | TL-18 |

## 6. 완료 기준

- 위 단위 테스트가 패키지 단위 `bun test`로 통과한다(M1 범위 테스트는 M1에, 나머지는 해당 단계에).
- M1 스모크(eng.testing.guide TS-01 `scenario`, 저장소 전체 1개): 모델 테이프로 `xeon chat` 한 턴에서 bash 호출 한 건이 `effect.intent`, `effect.exec`, `effect.result` 3단으로 기록된다. 스모크 설정은 사용자 범위 규칙으로 해당 bash 명령 패턴을 allow하거나 테이프에 승인 응답을 넣는다. 강제 종료 뒤 재개하면 같은 기록에서 이어진다.
- 출력 한도를 넘는 bash 출력이 스모크 테이프 하나에 들어 있고 blob과 미리보기로 기록된다.
- `just verify`가 종료코드 0이다(oxfmt, oxlint type-aware, tsc -b, check-layers, depcruise, knip, 영향 범위 테스트).
- check-layers: core-tools가 다른 `core-*`, `cap-*`, `group-*` 패키지와 `cordis`, `@earendil-works/*`를 import하지 않는다. contracts의 capabilities 소스도 `@earendil-works/pi-agent-core`를 import하지 않는다(DR-07, L1.tools.spec §9-21).
- M1 비밀 종료 조건(`product.scope.spec` §4.4 M1 행)의 L1.tools 몫은 `tool_result_masked_before_commit_and_points`와 bash 명령 패턴 규칙(`args` 패턴, 승인)이다. 주입과 lease는 L0.exec.plan·L0.secrets.plan이 맡고, 세 몫을 함께 확인하는 것은 `apps/cli` M1 스모크 시나리오다(L1.tools.spec §4.12).
- M1 키 큐 사용(`L1.tasks.plan` M1의 "도구 병렬과 파일 직렬화")의 구현 주체는 이 계획의 TL-17이고 확인 테스트는 `same_realpath_writes_serialized`다.
- M2 완료: product.scope.spec M2 종료 조건 중 "질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록된다"를 `question_and_plan_approval_share_request_shape`와 L2.dialog·L2.work 통합 테스트 훅으로 확인한다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 정책 규칙 언어 과설계 | M1은 allow·ask·deny, 도구명 glob, 인자 패턴만 둔다(§1). 티어 4종과 나머지 resource 필드는 M2. 셸 접두 규칙은 2차 |
| 승인 대기 중 서비스 유휴 종료 정책 미정(architecture.runtime-flow.design §7) | M2까지 [미결]로 두고 테스트에서 대기 세션을 live로 취급한다. M3 서비스 모드 작업 전에 사용자 결정을 받는다 |
| 인자 재작성 지점 없음(pi-agent-core 1.3.0 `BeforeToolCallResult`에도 없었다) | `tool_call`에서는 인자 변경을 지원하지 않는다 [결정: review.decisions-2 U-06]. 2차에 별도 chain 지점을 더할 때 다룬다. 도입 방법은 아래 |
| 병렬 배치에서 승인 대기가 다른 호출 준비를 막음 | 한 배치의 승인은 차례로 낸다(L1.tools.spec §4.2). 체감 문제가 확인되면 L4 화면이 `pending()`으로 묶어 보인다 |
| `tool_result` 처리 예외가 결과를 오류로 덮음(원본 `afterToolCall` 래퍼, agent-loop.ts:897-900) | `execute`의 마감에서 핸들러 하나의 실패는 그 패치만 버리고, 디스패처 자체가 실패하면 경고를 남기고 원래 결과를 쓴다. 테스트 `tool_result_handler_throw_skipped` |
| 질문 도구가 실행 중 대기하므로 재개 때 `unsafe`면 결과 불명으로 닫힘 | 질문·계획 도구에 `replay: "safe"` 선언을 L2에 요청한다(L1.tools.spec §8.4). 선언이 없으면 등록 때 경고 진단 |
| 범위별 규칙 수집이 F 설정 규칙(키 단위 교체)과 어긋남 | F 요청 5가 닫히기 전에는 core-tools가 범위 층을 직접 읽는다. 거절되면 범위별 키로 나눈다(L1.tools.spec §10) |
| F 에이전트 타입(`agent.ts`) 반영이 늦음 | 반영됐다(adr.0009 이행 LP16). core-tools에 `@earendil-works/pi-agent-core` 의존을 넣지 않는다 |
| 절단 함수가 `platform-exec`로 옮겨지는 adr.0003·L0.exec 수정이 늦음 | TL-6은 `xeon.exec` 절단 메서드의 F 시그니처만 전제하고 테스트는 대역으로 한다. core-tools에 임시 사본을 두지 않는다(review.decisions-2 D-08) |

인자 재작성 도입 방법 [제안]:

- 루프가 자체 코드라(adr.0009) 포크가 필요 없다. 2차 chain 지점의 결과로 인자를 바꾸면 `prepare` 안에서 core-tools `validate.ts`로 다시 검증하고 `PreparedCall.args`와 `effect.intent.args`에 같은 값을 넣는다(L1.tools.spec §4.10).
- 이전 판의 포크 비용 추정(npm `dist` 패치 또는 agent `src` 포크)은 pi-agent-core 의존을 전제로 했으므로 지웠다.
