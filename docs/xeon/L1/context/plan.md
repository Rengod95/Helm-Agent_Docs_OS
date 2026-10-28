---
id: L1.context.plan
layer: L1
domain: context
kind: plan
status: draft
depends_on: [L1.context.spec, L1.models.plan, L1.persistence.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/core-context/**]
---

# L1 컨텍스트와 컴팩션 (context) 구현 계획

패키지: `xeon/packages/core-context` (현재 스캐폴드: `package.json`, `src/index.ts`, `test/smoke.test.ts`, `xeon.layer = "L1"`, `xeon.domain = "context"`). 이 문서는 계획만 둔다. 코드는 수정하지 않는다.

## 1. 목표와 마일스톤 배치

목표: `L1.context.spec`의 `xeon.context`를 구현한다. 같은 가지와 도구 집합이면 접두 바이트가 같고, 컴팩션은 원본 이벤트를 지우지 않으며, 오버플로우 복구는 단계당 한 번이어야 한다.

마일스톤 정의는 `product.scope.spec` §4.3을 따른다. M1은 걸어 다니는 골격(`_research/foundation-plan.md` §5 P4), M2는 L2 능력과 Helm, M3는 첫 공개 릴리즈 후보다. 그 문서의 M2·M3 정의는 [제안]이다. 계획 JSON의 "2차"는 M3 이후에 둔다 [제안].

| 단계 | 범위 | 근거 |
|---|---|---|
| M0 | 코드 없음. 선행: contracts에 `L1.context.spec` §3.1 F 요청 타입(`ContextServiceName`, `ContextService`, `AssembleOptions`, `AssembledContext`)과 `L1.models.spec`의 `CachePolicy`, `ModelBinding`, `ContextUsageEstimate`가 있어야 한다 | `_research/foundation-plan.md` §5 P4 M0 |
| M1 | 최소 조립: 고정 접두(기본 프롬프트 + 대화 메시지 + `orderTools` 정렬 도구 목록), 접두 system item 기록, `convertToLlm`, 지점 `context`. 오버플로우는 `recoverOverflow`가 `fail(disabled)`를 돌려주고 core-loop가 명확한 오류로 턴을 끝낸다 | `_research/foundation-plan.md` §5 P4 M1, `L1.context.spec` §4.7 6번 |
| M2 | 컴팩션 포크(컷 포인트, 요약, 임계, 비파괴 엔트리), 오버플로우 복구, 캐시 표식, 도구 변경 `SystemMessage`, 절 갱신, 모델 전환 경고, 지점 나머지 5개(`cache_warming_decision`은 선언만), 떠난 가지 요약 초안, 설정 `l1.context.*` | 계획 v2 L1-e 1차 행 |
| M3 | 없음(M2 결과를 Helm·학습 그룹 테이프로 다듬기만 한다) | — |
| 2차(M3 이후) | 도구 결과 선제 제거, 컴팩션 후 재주입, 추가 워크스페이스 루트, 캐시 워밍 | 계획 v2 L1-e 2차 행 |

## 2. 패키지와 파일 배치

```
xeon/packages/core-context/
  package.json                 # dependencies: @xeon/contracts, typebox(catalog). pi-ai는 import하지 않는다(DR-07)
  src/
    index.ts                   # plugin만 export
    plugin.ts                  # 플러그인 정의: xeon.context 제공, inject [xeon.models, xeon.session, xeon.ext], 설정 등록 (C-1)
    service.ts                 # ContextService 구현: assemble, compact, shouldCompact, estimate, convertToLlm, recoverOverflow, summarizeBranch
    assemble.ts                # 가지 읽기 → 컴팩션 머리 → 메시지 변환 → context·context_with_system 지점 → volatile (C-1, C-9)
    prefix.ts                  # 고정 접두 생성·정규화 JSON·prefixHash, 기록된 접두 찾기, 절 갱신 (C-1)
    toolset-diff.ts            # 직전 광고 목록 재구성, diffToolsets 연결, append/defer/readvertise 결정 (C-2)
    cache-marks.ts             # CachePolicy.sites → CacheMarks, 상한 처리 (C-3)
    convert.ts                 # ItemRecord → Message, custom·요약 메시지 변환, convertToLlm (C-1)
    compaction/
      cut-point.ts             # CutCandidate, findCutPoint, 분할 턴 판정 (C-4)
      threshold.ts             # CompactionSettings, shouldCompactTokens (C-6)
      prompts.ts               # pi 프롬프트 상수 5종 복사 (C-5)
      summarize.ts             # SummarizeDeps 어댑터(xeon.models summary 역할), 롤링 갱신, 턴 접두 요약 (C-5)
      compact.ts               # prepareCompaction, 지점 3개, thread.compacted + 새 접두 커밋 (C-7, C-9)
      branch-summary.ts        # summarizeBranch 초안 (C-7)
    overflow.ts                # recoverOverflow, 단계당 1회 판정(details.xeon.stepId) (C-8)
    prune.ts                   # 2차: 도구 결과 선제 제거 (C-10)
    reinject.ts                # 2차: 최근 파일 재주입 (C-11). 블록 재주입은 branch.ts의 effectiveMessages가 한다
    settings.ts                # defineSettings("l1.context", …)
  test/
    *.test.ts
    fixtures/branches/*.json   # 컷 포인트 골든 입력(이벤트 가지)
    tapes/*.tape.jsonl         # 요약 응답 테이프
```

## 3. 작업 분해

규모: 소(하루 이하), 중(2~3일), 대(4일 이상) [가정: Sonnet·Haiku 구현자 기준].

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| C-0 | contracts 선행 확인: §1 M0 타입, `ItemRecord`, `CompactedPayload`, `OrderedTool`, `diffToolsets`. 없으면 F 트랙에 요청한다 | contracts | 소 | M0 |
| C-1 | 조립기와 접두 고정: `assemble` 최소형, `prefix.ts`(정규화 JSON, sha256 hex), `convert.ts`, `pendingItems`(prefix), `convertToLlm` | C-0, core-persistence 커밋·가지 읽기(`L1.persistence.plan`), core-models 서비스(`L1.models.plan` M-1) | 중 | M1 |
| C-2 | toolset diff 연동: 직전 광고 목록 재구성(접두 + 도구 변경 item 적용), `append`/`defer`/`readvertise` 규칙, 경고 | C-1 | 중 | M2 |
| C-3 | 캐시 표식 위치: `CachePolicy.sites` → `CacheMarks`, `summary`·`tail` 인덱스, 상한 | C-1, `L1.models.plan` M-5 | 소 | M2 |
| C-4 | 컷 포인트 포크와 타입 치환: `compaction.ts`의 `findValidCutPoints`, `findCutPoint`, `isCutPointMessage`, `estimateTokens` 사용부를 `CutCandidate`로 바꾼다. 턴 시작 판정은 `turnId` 비교. 토큰 추정은 `xeon.models.tokens`로 주입 | C-0 | 중 | M2 |
| C-5 | 요약 호출과 롤링 갱신: 프롬프트 상수 복사(`SUMMARIZATION_PROMPT`, `UPDATE_SUMMARIZATION_INSTRUCTIONS`, `UPDATE_SUMMARIZATION_PROMPT`, `TURN_PREFIX_SUMMARIZATION_PROMPT`, `SUMMARIZATION_SYSTEM_PROMPT`), `serializeConversation`(도구 결과 2000자 절단), `SummarizeDeps` 어댑터, 응답 검사(error·length·도구 호출) | C-4, `L1.models.plan` M-1 | 중 | M2 |
| C-6 | 임계 계산: `shouldCompactTokens`(`>` 비교), 카탈로그 `contextWindow` 연결, 기본값 한 곳(`settings.ts`) | C-0 | 소 | M2 |
| C-7 | `thread.compacted` 생성과 조립 반영: 한 커밋에 `thread.compacted` + 새 접두 system item, `details.xeon`, 조립 때 머리 적용, `summarizeBranch` 초안 | C-1, C-5 | 중 | M2 |
| C-8 | 오버플로우 복구: `recoverOverflow`, 같은 단계 판정, M1의 `fail(disabled)` 경로 | C-7, `L1.models.plan` M-1(`classify`) | 소 | M1(disabled 경로) → M2 |
| C-9 | 지점 발화 6개: `context`(M1), `context_with_system`, `session_before_compact`, `session_compact`, `session_compact_failed`, `cache_warming_decision`(선언과 발화 자리만, 실제 발화는 2차 워밍) | C-1, C-7, X 디스패치 | 중 | M1 → M2 |
| C-10 | 도구 결과 선제 제거 | C-7 | 소 | 2차 |
| C-11 | 컴팩션 후 재주입. 스킬 색인·메모리 스냅샷 블록(`knowledge.context`, `knowledge.index-delta`)은 M2 마감에 구현(spec §4.9a). 최근 파일·스킬 본문은 2차 | C-7 | 중 | M2 마감(블록), 2차(파일) |

- 선행 외부 작업: contracts(F 요청 타입), core-models 서비스(`xeon.models`의 `complete`, `tokens`, `classify`, `CachePolicy`), core-persistence 커밋(`xeon.session`의 `commit`, `readBranch`, `loadCheckpoint`. `threads.moveLeaf`의 `summary` 옵션은 M2).

## 4. 채택 코드

| 대상 | 방식 | 원본 | 바꿀 점 |
|---|---|---|---|
| pi 컴팩션 | 포크 | `~/projects/_ref/pi-src/packages/coding-agent/src/core/compaction/compaction.ts`(pi 커밋 `cdaf6c2`, 1119줄) | session-manager 엔트리 타입(`SessionEntry`, `CompactionEntry`, `ProjectedSessionEntry`)을 F `ItemRecord`·`thread.compacted`와 내부 `CutCandidate`로, agent·ai/compat 타입 import(`AgentMessage`, `ThinkingLevel`, `AssistantMessage`, `Usage`, `SystemMessage`)를 F 재노출 타입(`ModelThinkingLevel` 포함)으로, `completeSimple`·`retryAssistantCall`·`normalizeContext` 직접 호출을 `xeon.models` 주입으로, `uuidv7`을 `IdFactory`로 바꾼다. 복구 생략 분기(831-856)는 지운다 |
| 요약 프롬프트 | 복사 | 같은 파일 507-579(본문 요약 3종), 942-955(턴 접두), `utils.ts:161-163`(시스템 프롬프트). 별도 프롬프트 파일은 pi에 없다(`_research/notes/L1-3.md` §6) | 문구는 그대로 둔다. `prompts.ts` 상수로 분리 |
| 직렬화·파일 추적 | 포크 | `utils.ts`(163줄) `serializeConversation`, 파일 추적(30-87) | 입력을 F `Message`와 `ItemRecord`로. codemode 중첩 호출 추적(30-33)은 [미결] |
| 떠난 가지 요약 | 포크 | `branch-summarization.ts`(382줄), `BRANCH_SUMMARY_PROMPT`(258) | 같은 치환. 커밋하지 않고 초안만 낸다 |
| 컴팩션 적용(투영) | 재작성 | `session-manager.ts:439-588`(150줄) | 조립 §4.1이 맡는다 |
| 오버플로우 감지, 토큰 추정 | 그대로(위임) | pi-ai `utils/overflow.ts:137` `isContextOverflow`, `utils/estimate.ts` | core-context는 pi-ai를 import하지 않는다(DR-07). `xeon.models.classify`, `xeon.models.tokens`로 쓴다 |

비교: durable `harness/compaction.ts`(453줄)는 채택하지 않는다. 이유는 셋이다.

1. task 결합: 1-29행이 `@earendil-works/chord`의 `Context`, `Draft`, `defineTask`, `Tx`를 import하고 컴팩션을 durable task로 실행한다. Chord는 Cordis와 같은 계층이라 DI가 둘이 된다(ADR-0002, `_research/notes/L1-3.md` §10).
2. 턴 분할 개념이 없다(`split`, `turnPrefix`, `isTurnStart` 검색 0건). 이 문서는 pi 방식(분할 턴 요약)을 쓴다(`L1.context.spec` §10 미결 3).
3. 요약 프롬프트가 하나다(UPDATE 프롬프트 없음). 롤링 갱신 규칙은 pi가 더 명시적이다.

- durable에서 참고만 하는 것: `ContextView`(`harness/types.ts:603-613`)의 head·entries 구조, range selection 테스트 9개(`durable/test/harness-compaction.test.ts:229-332`)의 경계 사례.

## 5. 단위 테스트 목록

| 테스트 | 위치 | 종류 | 확인할 동작 | 단계 |
|---|---|---|---|---|
| `prefix_bytes_stable_for_same_inputs` | `test/prefix.test.ts` | unit | 같은 가지·도구·절로 두 번 조립하면 `messages[0]` 정규화 JSON과 `prefixHash`가 같다. 도구 입력 배열 순서를 섞어도 같다 | M1 |
| `prefix_recorded_once_and_reused` | 같음 | unit | 첫 조립만 `pendingItems`에 prefix를 내고, 기록 뒤 조립은 기록된 item을 쓴다(재개 모사) | M1 |
| `convert_custom_and_summary_messages` | `test/convert.test.ts` | unit | `custom` item은 `details` 없이 user 메시지로, `thread.compacted`는 요약 메시지 하나로 | M1 |
| `tool_added_midconversation_keeps_prefix` | `test/toolset-diff.test.ts` | unit | `midConversationToolChanges: true`에서 도구 추가 시 `messages[0]` 불변, `toolsAdded`만 담은 SystemMessage 하나 추가, 결정 `append` | M2 |
| `tool_change_deferred_without_provider_support` | 같음 | unit | 지원하지 않으면 `defer`와 `tools_deferred` 경고, 광고 목록 불변 | M2 |
| `cache_marks_respect_policy_cap` | `test/cache-marks.test.ts` | unit | 기본 sites 4개, 요약이 없으면 3개, 상한 2면 `system`·`tools`만 | M2 |
| `cut_point_golden_cases` | `test/cut-point.test.ts` | unit | pi `coding-agent/test/compaction.test.ts`의 `findCutPoint` describe 6개(298 "actual token differences", 318 "no valid cut points", 324 "all messages fit", 336 "split turn at assistant", 358 "context-visible custom", 378 "oversized trailing tool results")와 durable range selection 중 "cuts at a user entry"(242), "never at a tool result"(252), "does not cut at a user entry that a result of the preceding call still follows"(300)를 F 용어 픽스처로 이식. 토큰 추정이 3.5자/토큰이라 기대 인덱스는 다시 계산한다 | M2 |
| `threshold_uses_catalog_window_minus_reserve` | `test/threshold.test.ts` | unit | `contextWindow - reserveTokens`와 같으면 거짓, 1 크면 참. `autoCompact: false`면 항상 거짓 | M2 |
| `compaction_is_non_destructive` | `test/compact.test.ts` | unit | 컴팩션 전후 기존 이벤트 수와 정규화 JSON이 같고, 새 이벤트는 `thread.compacted`와 접두 item 둘. leaf를 앞으로 옮기면 원문이 다시 조립됨 | M2 |
| `rolling_summary_updates_previous` | 같음 | unit | 두 번째 컴팩션이 `UPDATE_SUMMARIZATION_PROMPT`와 이전 요약을 쓰고, 이전 머리 뒤 항목만 요약 입력에 넣음(테이프 요청 기록으로 확인) | M2 |
| `summary_call_uses_summary_role_no_cache` | 같음 | unit | 요약 요청이 역할 `summary`, `cacheRetention: "none"` | M2 |
| `overflow_recovers_once_per_step` | `test/overflow.test.ts` | unit | 같은 `stepId` 첫 오버플로우는 `retry`와 컴팩션 1건 | M2 |
| `overflow_second_failure_surfaces_error` | 같음 | unit | 두 번째는 `fail(second_overflow)`, 컴팩션 추가 없음. 첫 컴팩션 뒤 서비스를 새로 만들어도 같은 판정 | M2 |
| `overflow_disabled_in_m1` | 같음 | unit | M1 설정에서는 `fail(disabled)`, 요약 호출 0건 | M1 |
| `session_before_compact_denial_blocks` | `test/compact-points.test.ts` | unit | `{ cancel: true }` 결정이나 핸들러 예외면 `cancelled`, 커밋 0건, 요약 호출 0건 | M2 |
| `compaction_failure_emits_session_compact_failed` | 같음 | unit | 테이프 `error`면 `session_compact_failed` 한 번, 커밋 0건 | M2 |
| `extension_summary_skips_model_call` | 같음 | unit | `session_before_compact`가 요약을 주면 모델 호출 0건, `fromExtension`에 확장 이름 | M2 |
| `model_switch_warning` | `test/assemble.test.ts` | unit | 이전 단계 바인딩과 provider가 다르면 `cache_reset_model_switch`, 레벨만 다르면 경고 없음 | M2 |
| `settings_defs_pass_checks` | `test/settings.test.ts` | unit | `l1.context.*` 정의가 `checkSettingDef`·`buildCatalog` 통과 | M2 |
| `context_point_chain_replaces_messages` | `test/assemble.test.ts` | unit | `context`(chain) 핸들러가 낸 `messages`가 조립 결과를 바꾸고, 시스템 메시지는 핸들러에 넘어가지 않으며, 핸들러 예외면 그 패치만 버린다(C-9) | M1 |
| `branch_summary_draft_not_committed` | `test/branch-summary.test.ts` | unit | `summarizeBranch`가 `BRANCH_SUMMARY_PROMPT`로 요약 초안(`BranchSummaryDraft`)을 돌려주고 커밋 0건이다. 요약 역할은 `summary`(C-7) | M2 |
| `cache_warming_decision_declared_not_fired` | `test/compact-points.test.ts` | unit | 지점 `cache_warming_decision`이 선언 목록에 있고 M2 빌드에서는 발화 0회다. 실제 발화는 2차 캐시 워밍에서 시험한다(C-9) | M2 |
| `reinjection_after_compaction` | `test/reinject.test.ts` | unit | 접힌 범위의 `knowledge.context`와 `knowledge.index-delta`가 요약 바로 뒤에 가지 순서로 한 번 나오고, 허용 목록 밖의 custom은 나오지 않으며, 남은 범위의 메모는 중복되지 않는다. 허용 목록이 비면 재주입하지 않고, 컴팩션이 없으면 기록된 자리에 그대로다 (M2 마감 G2-01) |

- [구현: M2] core-context는 core-models를 import하지 못하므로(같은 층, DR-14) 요약 모델은 `test/support/fake-models.ts`의 대역이다. 요약 응답을 차례로 준비하고 호출 기록(역할 `summary`, `cacheRetention: "none"`, 시스템·사용자 프롬프트)을 확인한다. 저장소는 `test/support/log.ts`의 메모리 가지(`commit`, `producer` 포함)다. 이 대역의 `producer(id).draft`는 실제 저장소(`core-persistence/src/producers.ts`)와 같은 소유 규칙을 건다: kind 접두 소유자만 초안을 낼 수 있고, `item.recorded`는 접두 소유자(`core.loop`)와 컴팩션 접두 item의 `core.context`만 낸다. 규칙을 느슨하게 두면 `core.context`의 소유권 오류가 가려진다(`9b0300b`, M2 마감 재검토 병합 2). `test/memory-log.test.ts`가 허용과 거절을 값으로 견준다.
- 모델은 `@xeon/core-models/testing`의 테이프 가짜로 대신한다(`eng.testing.guide` TS-04). 테이프 `role`은 `summary`다.
- 저장은 `xeon.session`의 테스트 대역(메모리 가지)을 쓴다 [가정: `L1.persistence.plan`이 `testing` 서브패스로 제공].

## 6. 완료 기준

1. §5의 해당 단계 테스트가 모두 통과한다.
2. 모델 테이프로 컴팩션 한 번을 재생한다(요약 응답 테이프 1개). 재생 뒤 thread의 원본 이벤트 수가 컴팩션 전과 같다.
3. M1 스모크 한 턴에서 접두 system item이 한 번 기록되고, 강제 종료 뒤 재개한 조립의 `prefixHash`가 같다.
4. core-context의 import 목록에 `cordis`, `@earendil-works/*`, 다른 `@xeon/core-*`가 없다(check-layers, DR-07, DR-14).
5. `cd xeon && just verify` 종료코드 0.

## 7. 위험과 대응

| # | 위험 | 대응 |
|---|---|---|
| 1 | pi 컴팩션 코드의 타입 결합이 예상보다 크다 | research 3번 결과(`_research/notes/L1-3.md`)로 포크 범위를 정했다: 그대로 174줄, 치환 318줄, 재작성 427줄(상한 919줄, 턴 분할을 빼면 약 630줄). M2 일정은 C-4(중)·C-5(중)·C-7(중)으로 잡고, 턴 분할 경로(약 139줄)는 [미결]이 durable 방식으로 정해지면 빼서 줄인다 |
| 2 | 요약 품질이 모델에 따라 다르다 | 요약 지침을 설정(`l1.context.compactionInstructions`)으로 열고, 골든 테스트는 컷 포인트에 한정한다. 요약 문장은 테이프 고정 값으로만 확인한다 |
| 3 | 캐시 표식 위치가 provider마다 다르다 | `xeon.models`의 캐시 정책 객체가 provider 차이(`maxBreakpoints`, `midConversation*`)를 흡수한다. core-context는 정책을 읽고 위치만 계산한다 |
| 4 | 토큰 추정 방식 차이(pi 컴팩션 4자/토큰, pi-ai 3.5자/토큰)로 pi 테스트 기대값이 맞지 않는다 | 골든 픽스처의 기대 인덱스를 3.5자 기준으로 다시 계산하고, 원래 값과 차이를 픽스처 주석에 남긴다 |
| 5 | `context`·`context_with_system` 핸들러가 결정적이지 않으면 접두 바이트 고정이 깨진다 | 계약으로 둔다(`F.extensions.spec` §4.3). 디버그 빌드에서 같은 입력 두 번 디스패치 결과를 비교해 다르면 경고를 남기는 검사를 [제안]한다 |
| 6 | 컴팩션 지점 발화 주체를 context로 옮기는 F 수정이 늦어진다 | F 수정 전에도 core-context가 발화한다. `F.extensions.spec` §7 표 수정은 P2 정합성 검토 항목으로 올린다 |

## 8. 구현 상태 (M2, m2/l1c)

- C-2(도구 변경 비교와 `append`·`defer`), C-3(캐시 표식 위치), C-4(컷 포인트), C-5(요약 호출과 롤링 갱신), C-6(임계), C-7(`thread.compacted`와 새 접두를 한 커밋으로, 떠난 가지 요약 초안), C-8(오버플로우 복구), C-9(지점 발화)를 구현했다. `cache_warming_decision`은 선언만 있고 발화하지 않는다.
- 설정은 `contextSettingsOf`가 조립 루트의 `ContextSettingsSource`를 대신하고, 확장은 `createContextExtension({ settings, ids })`다. 기본 `extension`은 id 발급이 없어 컴팩션이 꺼져 있다. 호스트 조립이 `createContextExtension`에 설정과 `ids`를 넘겨야 컴팩션이 켜진다(HOST 트랙 요청).
- M1 고정값(컴팩션 꺼짐, 임계·유지 토큰 상수)은 설정 `l1.context.autoCompact`, `reserveTokens`, `keepRecentTokens`, `compactionInstructions`를 읽는 코드로 바꿨다(`review.open-issues` M-07의 core-context 몫). 같은 항목의 core-tasks limiter, BlobRef 생산자(core-tools), detached 필드(core-persistence 쓰기 경로)는 이 패키지 밖이다.
- 섹션 갱신 item, 모델 전환 경고, `near_window` 경고, `context_with_system`, volatile 계층도 이 단계에서 구현했다.
