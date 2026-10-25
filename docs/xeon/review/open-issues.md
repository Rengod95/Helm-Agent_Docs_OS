---
id: review.open-issues
layer: meta
domain: review
kind: review
status: draft
depends_on: [review.decisions-2]
binds: []
---

# M0·M1 구현 미결 목록

## 1. 목적과 표기

- M0·M1 구현(커밋 bcd77b4) 뒤 남은 미결을 한곳에 모읍니다. 원본은 2026-10-21 구현 보고의 미결 정리 44건입니다.
- 상태 열 표기는 다음과 같습니다.
  - `해결`: 커밋 5c59450..0da6f94에서 처리했습니다. 커밋을 함께 적습니다.
  - `이번 정리에서 처리`: 2026-10-22 결정 반영(`review.decisions-2` §2·§4) 때 문서를 고쳤습니다. 코드 변경이 남으면 `review.decisions-2` §5에 적었습니다.
  - `열림`: 아직 처리하지 않았습니다.
- 항목 번호는 이 문서 안에서만 씁니다. 차단은 B, 문서 정정은 D, 편차는 V, 환경·도구는 E, M2 이관은 M, 새 항목은 N입니다.

## 2. 차단 (다음 작업 착수 전에 풀어야 함)

| 번호 | 항목 | 어디 | 처리 | 상태 |
|---|---|---|---|---|
| B-01 | typebox를 import하는데 package.json에 선언이 없습니다. 설정 선언을 못 만든 패키지도 있습니다. | platform-process, platform-sandbox, core-loop, core-tasks의 package.json. 설정 선언은 platform-store, platform-exec, platform-secrets, core-persistence, core-tools, core-context, core-agents, platform-os | `typebox: catalog:` 선언, `defineSettings` 선언과 호스트 카탈로그 반영. core-agents에 `yaml` 2.9.0과 `./testing` export | 해결(5c59450, 0da6f94) |
| B-02 | pi 의존이 연결되지 않았고 F가 pi 타입을 복사해 둡니다. | contracts/src/conversation/pi.ts, core-loop, core-models | 5c59450에서 `export type` 재노출과 항등 타입 테스트로 처리했습니다. 이후 사용자 결정으로 pi-agent-core 의존 자체를 없애고 자체 루프로 바꿉니다(`review.decisions-2` B-02, ADR-0009). 그 작업은 다른 정리가 맡습니다. | 해결(5c59450), 후속은 ADR-0009 |
| B-03 | 서비스 PortKey 상수가 F에 없어 패키지마다 따로 만듭니다. | platform-exec, platform-os, core-context, core-models, core-persistence, core-tools, core-tasks | contracts/services로 모으고 지역 정의를 지웠습니다. | 해결(5c59450, 0da6f94) |
| B-04 | 출력 절단 함수 위치가 문서마다 다르고 구현 사본이 3곳입니다. | L0.exec.spec §1, L2.workspace.plan, cap-workspace/src/truncate, apps/host/src/assembly/truncator.ts, core-tools `truncator` 옵션 | D-08대로 `platform-exec`에 둡니다. `ExecService.truncateHead`·`formatSize`를 L0.exec.spec에 적고 사본 삭제를 `L0.exec.plan` EX-21로 두었습니다(`review.decisions-2` B-04). | 해결(1ef0764) |
| B-05 | 모델 키를 `runtime-http`로 lease하는데 F 주석과 U-19가 서로 다른 단계를 가리킵니다. | core-models, contracts `SecretUseModeSchema`, L0.secrets.spec §8.3, decisions-2 U-19 | M1부터 모델 provider 키는 `runtime-http`, bash 도구는 `env`입니다. F 주석을 사용 모드 번호와 마일스톤으로 나눠 적고, L0.secrets §8.3 R6과 수용 기준 14번(`policy.test.ts`)을 더했습니다(`review.decisions-2` B-05). 코드 쪽 주석과 정책 시험(`policy.test.ts`, `service.test.ts`)을 더했습니다. | 해결(1ef0764) |
| B-06 | 테스트가 `Bun.spawn`을 쓰는데 허용 결정이 없고 check-layers도 잡지 못합니다. | eng.dependency-rules DR-07, L4.desktop.plan R10, apps/cli/test, core-persistence·cap-workspace 시험 | DR-07에 테스트 한정 행, 허용 목록 `scope: "test"` 필드와 항목을 정했습니다. check-layers가 `Bun.spawn`, `Bun.spawnSync`, `node:child_process`를 검사하고 허용 목록 네 항목을 적용합니다(`review.decisions-2` B-06). | 해결(1ef0764) |
| B-07 | `xeon chat --continue`가 상태 파일 위치를 모릅니다. 지금은 `XEON_CLI_STATE_FILE`만 됩니다. | L4.cli.spec §10-1, apps/host, apps/cli/src/runtime.ts | `@xeon/host` `resolveHostStatePaths()`를 L4.host-service.spec §3.3.6에 두고 H21로 계획했습니다. 환경 변수는 테스트 덮어쓰기로만 남습니다(`review.decisions-2` B-07). 구현은 `platform-os` `resolveOsDirs`와 `apps/host/src/state-paths.ts`입니다. | 해결(1ef0764) |

## 3. 문서 정정 (문서끼리 어긋남)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| D-01 | TypeBox 버전이 1.4.2와 1.3.27로 갈립니다. | F README, L0.exec.plan §4.2, L1.models.plan §4·§7, ADR-0001, eng.toolchain, eng.domain-types 외 plan의 의존 표 | 모두 1.3.27(U-24)로 고치고 버전 [미결]을 닫았습니다. | 이번 정리에서 처리 |
| D-02 | srt 버전이 0.0.81과 0.0.79로 갈립니다. | L0.sandbox.spec §1, L0.sandbox.plan §4·SB-01 | 0.0.79로 고쳤습니다. L0.secrets의 0.0.81 기능 조사 문장에는 고정 판에서 다시 확인하라고 적었습니다. | 이번 정리에서 처리 |
| D-03 | SENSITIVE_ENV_PATTERNS 위치가 문서마다 다릅니다. | L0.secrets.spec §4.5·§9, plan SC-11, F.capabilities §3.12, L0.exec | 모두 `@xeon/contracts/services`(services/exec.ts)로 통일합니다. F 쪽은 F.capabilities §3.12 규칙 10으로 위치를 못박았습니다(m2/f F.7). L0.secrets.spec §4.5 1번과 §9 1번의 `@xeon/contracts/capabilities`도 `@xeon/contracts/services`로 고쳤습니다(4af35ee). | 해결(m2/f, M2F_HASH) |
| D-04 | F 스펙이 코드와 다릅니다. | F.records.spec §3.9 표, L1.persistence §6.2, F.capabilities §3.3·§3.10, L2.readme §5.1 | §3.9 표를 U-09(LeaseToken)에 맞춥니다. §6.2의 records → settings import 문장을 지웁니다. `ToolSpecFor`는 메서드 문법, `SecretNameSchema`는 `TUnsafe<SecretName>`. L2.readme `defs/web`은 capabilities 인덱스 재노출로 바꿉니다. F 쪽(F.records §3.9 표, F.capabilities §3.3·§3.10·§3.9)은 m2/f F.7에서 고쳤습니다. 남은 것: L1.persistence §6.2(L1B 레인), L2.readme §5.1·§5.6의 `defs/web` 깊은 경로 예시(`@xeon/contracts/capabilities`로 바꿉니다, L2 문서 소유자). | 일부 해결(F 쪽, m2/f) |
| D-05 | 서비스 파일 사이 import 금지와 L1이 요구하는 공용 타입이 부딪칩니다. | F.capabilities §3.12 규칙 3·4, L1.tools·L1.agents | 규칙 4에 공용 값 타입의 허용 방향을 적고 L1 문서의 위치 요청을 고칩니다. F.capabilities §3.12 규칙 4에 허용 방향 표를 적었습니다(m2/f F.7). 남은 것: L1.tools.spec §3.1·§8.3 6번, L1.agents.spec §8.3이 `capabilities/tools.ts`·`policy.ts`·`approvals.ts`로 적은 위치 요청을 `services/`로 고치는 일(L1 레인). | 일부 해결(F 쪽, m2/f) |
| D-06 | 승인 대기 체크포인트의 `next` 값이 다릅니다. | L1.persistence §4.2(`tools`), L1.tools §4.7·L1.loop §4.5(`await_input`) | `await_input`으로 통일하고 `isApprovalWait`를 하나로 줄입니다. | 열림 |
| D-07 | 소유 문서가 코드와 다릅니다. | `turn.abort_requested` 생산자, eng.context-map §4.1·§5.2 | tasks 문서를 core.loop 기준으로 고치고 context-map에 `thread_creation_keys`를 더합니다. | 열림 |
| D-08 | domain과 규칙 ID가 어긋납니다. | guide DR-03·1.2절, routes.yaml, vendor/cordis, group-kit plan G-02 | routes.yaml과 G-02를 `kit`, `host`에 맞추고 DR-10 행을 더합니다. | 열림 |
| D-09 | 테스트 헬퍼 시그니처와 위치가 어긋납니다. | eng.testing TS-03, L0.os.spec §3.5 | TS-03을 spec 시그니처로 고치고 platform-store 헬퍼 위치를 정합니다. | 열림 |
| D-10 | 확장 문서끼리 어긋납니다. | F.extensions.plan 테스트 표, X.primitives §4.2·§3.1, X.operations O-test-9 | `schema`를 `name_invalid`로, 타임아웃 뒤 오류 처리를 한 곳으로, §3.1 표에 공개 이름과 `ExtDiagnostic`을 더합니다. | 열림 |
| D-11 | 숫자와 이름이 틀립니다. | L0.process.plan, L0.sandbox SB-11, L0.exec.spec §3.5, PATCHES, taskkill 경로, architecture.layers.spec 325행 | 키 개수, `*` 위치 규칙, P8·P9, taskkill 전체 경로, `xeon.exec` 이름을 고칩니다. | 열림 |
| D-12 | host 문서에 코드가 더한 것이 없고 순서 규칙이 서로 충돌합니다. | L4.host-service.spec §3.3.3, HS-21·AH-07 대 F wire §3.4.3, HS-18 대 F.records §4.3, plan §5 | ConnectionHub, AssembleIssue, EnginePorts를 적고 순서 규칙을 한쪽으로 정합니다. | 열림 |
| D-13 | L1 spec 미결이 코드에서 임시 해석으로 남아 있습니다. | L1.persistence §4.1, L1.context §4.1·§4.5, L1.tasks §4.1·§4.8, L1.tools §4.4, eng.transactions §4.8, cap-workspace §4.1·§4.2 | 해석을 정본으로 각 spec에 적습니다. 백그라운드 부모 기록 방식은 결정이 필요합니다. | 열림 |
| D-14 | AGENTS.md와 .env.example이 실제와 다릅니다. | xeon/AGENTS.md, xeon/justfile, xeon/.env.example | `just verify` 위치와 `.env.example` 주석을 고칩니다. | 열림 |

## 4. 편차 (구현이 문서보다 앞서거나 벗어남)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| V-01 | `as` 단언이 TY-06 허용 위치 밖에 있고 주석 형식도 다릅니다. 린트 규칙이 없습니다. | contracts validate.ts·kinds.ts·jsonschema.ts·defs/workspace.ts, platform-os binaries/resolve.ts, apps/host main.ts, secrets redactor.ts | `.oxlintrc.json`에 `consistent-type-assertions`(never), `no-unsafe-type-assertion` 외 3.1.1절 규칙 전부를 넣고 위반 64곳을 고쳤습니다. 남은 단언 26줄은 TY-06 허용 목록 A2~A6 위치뿐이고 스캔 `xeon/as-location`이 검사합니다. `maskDeep`은 A4입니다. | 해결(9ae5807) |
| V-02 | 전역 시각과 sleep을 직접 씁니다. | apps/cli/src/runtime.ts:147, apps/cli/test/chat.scenario.test.ts:294 | 시계는 platform-os 값으로 받고, 테스트는 settle 알림을 기다립니다. | 열림 |
| V-03 | 예상 가능한 실패를 Bug로 던집니다. | core-persistence writer.ts, platform-os dirs.ts, core-tasks enqueue, F wire 오류 kind | `StoreError{io}`, `DirsError{cancelled}`, `ExtensionTableError{io}`, `EnqueueError`, `ModeChangeResult{tools.commit_failed}`, `SecretError{cancelled}`, wire `store.busy`·`store.diskFull`·`store.readOnly`·`store.io`(5003~5006)를 더하고 해당 `Bug`를 오류 값으로 바꿨습니다. platform-store의 손상(`SQLITE_CORRUPT*`)은 `io`로 돌려줍니다. 읽기 API와 플랫폼 시작 실패는 N-08, N-09에서 처리했고 확장 테이블 API는 93dad8d에서 `Result`로 바꿨습니다. | 해결(9ae5807, 93dad8d) |
| V-04 | 오류를 삼키거나 취소 신호가 전달되지 않습니다. | platform-exec win32.ts:19, host handlers/events.ts:189, platform-secrets sops runner, ExtHost.install, InProcessHost.close | win32 `taskkill` 실행 실패를 Logger로 기록하고, 재전송 실패 때 `events.ended` 알림을 보내며, sops 호출과 바이너리 해석이 서비스 수명 신호를 받고(`SecretError{cancelled}`), `ExtHost.install(unit, { signal })`이 엔트리 대기를 중단하고, `InProcessHost.close()`가 `"clean" \| "deadline"`을 돌려줍니다. 남은 `.catch(() => undefined)` 35곳은 `attempt`/`detach`로 바꿨고 스캔 `xeon/catch-swallow`가 막습니다. 포크 코드의 정리 단계는 N-10입니다. | 해결(9ae5807) |
| V-05 | 낮은 등급 리뷰 지적이 남았습니다. | ext-host state.ts:301, core-loop commits.ts:59 대 core-tools effects.ts:34, core-persistence emitVolatile, core-tools pipeline.ts:296, core-loop agent-wrapper.ts:650(ADR-0009 이행으로 이 파일은 없어졌습니다) | toolResult 키 통일은 U-13 보완 1(F `commitKeyPart` 하나)로 문서를 정했습니다. toolResult 키 통일은 `commitKeyPart` 구현으로 닫았습니다(1ef0764). 나머지(fingerprintSource, emitVolatile 검사, `itemId`, `committed`)는 열려 있습니다. | 일부 해결(1ef0764) |
| V-06 | 주석이 사물을 사람처럼 씁니다. | apps/cli commands/chat.ts:164 외 | 서술형으로 바꿨습니다(chat.ts 외 17곳. 코드나 자료에 "스스로", "모른다", "알려 준다" 같은 서술을 쓰던 주석). | 해결(9ae5807) |
| V-07 | F `describeSandboxStatus`가 spec과 다릅니다(disabled일 때 warn 대 critical). | contracts/src/services/sandbox.ts, L0.sandbox.spec §4.6·§9-6 | 코드를 spec대로 warn으로 고쳤습니다. 설정으로 끈 상태는 `onUnavailable`과 무관하게 warn입니다. | 해결(1ef0764) |
| V-08 | M1에 계획보다 많이 넣었거나 바꿨습니다. | p_approvals·p_blob_refs 투영, print 모드 approval deny, ToolRunDrafts, args 192 KiB | L1.persistence.plan, L4.cli.spec C11, F.capabilities, L1.tools §4.4에 반영합니다. F.capabilities §3.12 `services/tools.ts` 행에 `ToolRunDrafts`와 192 KiB blob 한도의 위치(core-tools 상수, F는 `BlobRef` 허용만)를 적었습니다(m2/f F.7). 남은 것: L1.persistence.plan, L4.cli.spec C11, L1.tools §4.4. | 일부 해결(F 쪽, m2/f) |
| V-09 | host가 X 로더를 쓰지 않고 `ExtHost.install`을 직접 부릅니다. | apps/host/src/assembly/extensions.ts, X.loading-trust | 로더 의존 순서 지원 또는 `reservedExtensionSettings` 공개, 동명 extraPlugin 규칙을 정합니다. | 열림 |
| V-10 | 복구 뒤 로그에 `loop.run_rejected`(tasks.scope_settled)가 남습니다. 결과는 정상입니다. | core-loop 재개 경로, apps/cli chat.scenario 시험 2 | N-03으로 옮겨 추적합니다. | 열림(N-03) |

## 5. 환경·도구 (코드를 고치지 않고 보고)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| E-01 | WSL2 벽시계가 튀어 platform-exec watch 적합성 시험이 40~50% 실패합니다. | platform-exec 적합성 시험 | 안정된 시계에서 재확인합니다. 그때까지 한 번 재실행으로 판단합니다. | 열림 |
| E-02 | bwrap, socat, macOS 실기가 없어 일부가 검증되지 않았습니다. | platform-sandbox, platform-store, platform-os, platform-exec, platform-secrets | `bubblewrap socat` 설치 뒤 int 시험, macOS는 CI나 실기로 확인합니다. | 열림 |
| E-03 | depcruise가 'TypeScript 7 미지원' 안내만 내는 때가 있습니다. | .dependency-cruiser.cjs | 순환을 일부러 만들어 잡히는지 확인합니다. | 열림 |
| E-04 | 전체 `just fmt`가 생성물을 다시 서식합니다. 자식 프로세스가 turbo를 멈춘 적이 있고 오래된 심볼릭 링크가 있습니다. | apps/host/schema/*.json, .oxfmtrc.json, platform-process test/fixtures/tree.ts, core-loop/node_modules | ignorePatterns, 자손 정리, 링크 정리를 합니다. | 열림 |
| E-05 | check-layers가 TS-NN 항목을 형식만 검증합니다. `node:fs` 모킹과 `Bun.spawn`을 잡지 못합니다. test-preload.ts와 bunfig가 없습니다. | scripts/check-layers.ts, dependency-allowlist.json | `Bun.spawn` 검사는 B-06으로 구현했습니다(1ef0764). TS-NN 적용과 `node:fs` 모킹 검사, test-preload.ts와 bunfig는 남았습니다. | 일부 해결(1ef0764) |

## 6. M2로 넘길 것

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| M-01 | 확장 레코드와 상태 쓰기가 안 됩니다. 그룹 drive가 `lease.released reason=error`로 끝납니다. | core-persistence ext.commit·queryRecords(PS-16), EventKindRegistry, `scopeLeaseEpoch` | PS-16과 kind 등록을 구현합니다. | 열림 |
| M-02 | 승인 응답 경로가 끝까지 이어지지 않았습니다. U-19 env 주입 경로의 승인 증거도 `null`입니다. | host H18 `approval.respond`, core-loop approvals 연결 시험 | H18에서 증거 전달까지 완성하고 A1 요청, SIGKILL, 재개, 응답을 한 엔진에서 시험합니다(`review.decisions-2` U-19). | 열림 |
| M-03 | host 메서드가 `notImplemented`입니다. | H9, H16, H17, H19, stdio 자식 프로세스 시험 | M2 계획대로 구현합니다. | 열림 |
| M-04 | 의존과 번들이 미연결입니다. | `age-encryption` 0.3.1, `@vscode/ripgrep`, binaries.lock.json, platform-store/testing | catalog 고정과 연결, `openTestStore` 교체를 합니다. | 열림 |
| M-05 | exec, process, secrets, group의 M1 스텁입니다. | startBackground, ProcessPort.run, spill 위치, sandbox allow-list, withBrowserInput, workspace.images, defineGroup | 각 M2 항목으로 구현합니다. spill 위치를 먼저 정합니다. | 열림 |
| M-06 | 작업 폴더가 `process.cwd()` 하나입니다. | cap-workspace root, ThreadStartedPayload.workspace, 허용 root 조회 API | thread.create의 workspace를 저장하고 root 계산에 씁니다. F 계약은 m2/f F.6에서 끝났습니다: `thread.started` payload의 선택 필드 `workspace`(옛 행은 필드 없음 = null, version 1 유지)와 wire `ThreadSummary.workspace`. 남은 것: core-persistence가 `thread.create`의 값을 payload에 싣는 일(L1B)과 cap-workspace의 root 계산(DG.4). | 일부 해결(F 계약, m2/f) |
| M-07 | 컨텍스트와 모델의 M1 고정값입니다. | core-context, core-models 토큰 예산, core-tasks limiter, BlobRef 생산자, detached 필드 | 설정 `l1.context.*`와 함께 구현합니다. | 열림 |
| M-08 | 컴파일 바이너리와 F 계약 확정이 남았습니다. | apps/host/src/main.ts 최상위 await, L4.cli.plan §4.3, ThreadSummary 등 | await를 없애고 측정값을 plan에 적습니다. F 계약 모양은 M2 시작 때 확정합니다. F 계약은 m2/f F.6에서 확정했습니다: `ThreadSummary`(`resumable` 포함)와 thread 오류 kind 3종(`thread.hasForks` 3004, `thread.invalidTarget` 3005, `thread.cancelledByExtension` 3006), 변환 함수 `threadSummaryOf`. 남은 것: main.ts await 제거와 측정값 기록(HOST.5). | 일부 해결(F 계약, m2/f) |

## 7. 새 항목 (2026-10-22 추가)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| N-01 | 세션을 다시 열면 builtin scope에 `scope.changed{enabled}`가 다시 기록됩니다. `X.primitives.spec` §4.5.6은 `ExtThreadSnapshot.enabled`와 현재 켜짐이 다를 때만 첫 경계 기여에 넣는다고 적었습니다. | ext-host 시작 적용·스냅샷 비교, X.primitives §4.5.6 | 스냅샷 비교 결과가 같으면 기록하지 않게 고치고, 다시 열기 시험에서 `scope.changed` 수를 확인합니다. 8981bc8에서 `openThread`가 저장된 켜짐 기록과 비교하게 했고, 이번 F 변경으로 `ExtThreadSnapshot.disabled`·`scopeTransitions`가 생겨 끈 기본 켜짐 scope도 다시 열 때 꺼진 채 두며 재시작 뒤 커밋 키도 겹치지 않습니다(`thread-scope.test.ts`, `scope.test.ts`). | 해결(8981bc8, 4af35ee) |
| N-02 | Cordis provider가 재시작되면 scope를 곧바로 다시 적용합니다. 적용 시점은 단계 경계여야 합니다(U-01). | ext-host Cordis 연결, X.primitives §10 | U-01의 예외로 둘지, 재적용 요청만 기록하고 다음 경계에서 적용할지 정합니다. X.primitives §10의 같은 미결에 이 항목을 연결했습니다. [결정: review.m2-plan §8 D8] (b)대로 재적용 요청만 기록하고 다음 단계 경계에서 새 세대로 적용합니다(`provider-restart.test.ts`). | 해결(8981bc8) |
| N-03 | 복구 뒤 `loop.run_rejected`(tasks.scope_settled)가 로그에 남습니다(V-10). | core-loop 재개 경로 | 닫힌 turn을 다시 돌리는 호출을 찾아 막고 로그에서 사라지는지 확인합니다. 자체 루프 작업(ADR-0009)과 함께 봅니다. | 열림 |
| N-04 | DR-07 소유 표의 `Bun.spawn` 소유 패키지는 다섯 곳(platform-exec, process, sandbox, secrets, os)인데 `platform-store`의 테스트 보조 파일(`test/support/child.ts`, `spawn.ts`)도 자식 프로세스를 띄웁니다. | eng.dependency-rules DR-07 표와 4절 | 문서 4절 문장("platform-* 패키지는 원래 소유자")을 따라 `check-layers`는 모든 `platform-*`의 테스트 파일을 허용합니다. 표와 문장을 하나로 맞춥니다. | 열림 |
| N-05 | `InputQueuePort.enqueue`에 오류 통로가 없어 닫힌 thread 같은 예상 가능한 거부를 `Bug`로 던집니다(TY-24). | core-tasks `enqueuePost`, contracts `extensions/ports.ts` | 포트가 `Result<EnqueueResult, EnqueueError>`를 돌려주게 하고 ext-host `post`가 그 오류를 `TypeError`·`PrimitiveError`로 옮깁니다(`X.primitives.spec` §4.7). | 해결(9ae5807) |
| N-06 | `l3.helm.*` 가운데 `driveLimits`만 선언했습니다. `autoStart`, `maxLenses`, `writeGuard`는 Helm 구현(L3.helm.plan)에서 더합니다. | group-helm/src/settings.ts, L3.helm.spec §6 | Helm 탐구 구현 작업에서 나머지 세 키와 `HelmSettings` 읽기 타입을 더합니다. | 열림 |
| N-07 | 승인 요청의 커밋 키(`requestKeyFor`, `requestCommitKey`)가 toolCallId 원문을 그대로 넣어 알파벳 밖 문자에서 커밋 키 형식을 어겼습니다. 서비스 호출 멱등 키(`requestIdFor`)는 toolCallId를 따로 줄입니다. | core-tools approvals/protocol.ts, entries.ts | 승인 요청 커밋 키는 `commitKeyPart`(U-13)를 거치도록 고쳤고 알파벳 밖 toolCallId 시험을 더했습니다. `requestIdFor`는 커밋 키에 들어가지 않는 호출 id(1~64자)라 변환 대상에서 뺐습니다. 두 키의 길이 한도(48자, 64자)가 달라 함수를 나눠 둡니다. 한 함수로 합칠지는 M2 승인 프로토콜 작업(H18)에서 정합니다. 요청 키 쪽은 통합 검토 L6에서 `requestKeyFor`와 상한 `APPROVAL_REQUEST_KEY_MAX`를 F `records/commit.ts` 하나로 올렸습니다(core-tools의 소비 교체는 끝났고, cap-dialog `approvalKeyOf`, cap-work `approvalRequestId`, cap-knowledge `approvalRequestKey`는 `requestKeyFor`로 바꿔 지웠습니다. host의 자체 함수 교체는 host 층 커밋 몫). 커밋 키 함수(`requestCommitKey`)는 한도가 달라 core-tools에 남습니다. | 일부 해결 |
| N-08 | 확장 테이블 읽기·쓰기 API가 값을 바로 돌려줘 손상된 행과 선언과 다른 행이 `Bug`로 올라갑니다(TY-24). core-persistence의 읽기 API, platform-store의 `sys_leases` 읽기는 `Result`로 바꿨습니다. | ext-host `ext_storage.row_corrupt`, `ext_storage.row_invalid`(ext-storage.ts, `xeon/bug-for-expected` 예외 주석 3줄) | `ExtTableReader`·`ExtTableWriter`·`ExtProjection.apply`를 `Result<_, ExtRowError>`로 바꾸고 손상 JSON 열도 `row_corrupt`로 돌려줍니다. 다른 패키지의 호출처는 없었습니다(`X.operations.spec` §3.4·§4.4). | 해결(93dad8d) |
| N-09 | 플랫폼 모듈 시작 실패(`platform-os failed to start`, `core-persistence could not start`)가 `PlatformModule.setup`의 던지는 계약 때문에 `Bug`였습니다. | platform-os `platformOsPlugin`, core-persistence plugin.ts, X.primitives.spec `registerPlatform` | `setup`이 `err(SetupRefusal)`을 돌려주게 했습니다. `registerPlatform`은 `PlatformSetupError`를, `install`은 `setups[].failure`를 돌려주고 조립 루트가 `AssembleError`로 옮깁니다. | 해결 |
| N-10 | 포크 코드의 정리 단계 `close` 실패와 감시 콜백 예외가 Logger 없이 결과만 받고 버려집니다(TY-25). | platform-exec `src/upstream/env/node.ts`(`closeBestEffort`), `node-watch.ts`(`#deliver`), PATCHES.md P14 | 포크 환경 옵션에 Logger를 더해 기록합니다. | 열림 |
| N-11 | `.oxlintrc.json`에 아직 넣지 않은 TY 규칙입니다: `typescript/explicit-module-boundary-types`, `typescript/prefer-readonly`, `unicorn/no-static-only-class`, TY-21의 `no-restricted-properties`. | eng.typescript.guide 3.1절 | 위반 수를 세고 고친 뒤 켭니다. V-02(전역 시각, sleep)가 TY-21 위반의 일부입니다. | 열림 |

## 8. 처리 순서 제안

1. `review.decisions-2` §5 구현 후속(U-05, U-12, U-13, B-04~B-07)은 1ef0764에서 처리했습니다(U-19는 M2 H18). 자체 루프(ADR-0009)와 겹치는 core-loop 변경은 그 작업과 순서를 맞춥니다.
2. 문서 정정 D-03~D-14를 처리합니다.
3. 편차 중 린트로 잡을 수 있는 것은 규칙을 더한 뒤 고칩니다. V-01, V-06은 끝났고 V-02는 N-11(TY-21 규칙)과 함께 남았습니다.
4. 환경 E-03(depcruise 동작)을 확인한 뒤 M2의 M-01(PS-16)부터 시작합니다.

## 9. M2 계획 결정 반영 (2026-10-23~24)

- `review.m2-plan` §8의 사용자 결정 가운데 이 목록의 항목과 이어지는 것을 적습니다. 결정 본문은 `review.m2-plan` §8이 정본입니다.

| 결정 | 이어지는 항목 | 반영 | 상태 |
|---|---|---|---|
| D1 Tauri 빌드 환경 | E-02(macOS 실기 없음) | 이 WSL에 rustc·cargo 1.99.1(rustup 사용자 영역)과 `libwebkit2gtk-4.1`·Tauri 시스템 패키지를 설치했습니다. macOS는 CI `desktop-macos` job(`workflow_dispatch`나 PR 라벨 `ci:macos`)으로만 확인합니다. Linux `desktop-build` job은 Z.1입니다. E-02의 macOS 부분은 그대로 열려 있습니다 | 결정됨 |
| D2 데스크톱 프런트엔드 | L4.desktop.spec §10 미결 11 | React 19로 정했습니다. 상태 관리 라이브러리는 조사 중입니다 | 일부 결정(상태 관리 열림) |
| D3 데스크톱 서명 | L4.desktop.plan D10 | M2는 ad hoc 서명, Developer ID 서명과 공증은 M3 릴리즈 후보입니다 | 결정됨 |
| D4 `web.browse` | L2.web.plan B10 | M3 초입으로 옮겼습니다 | 결정됨 |
| D5 MCP `input_required` | L2.mcp.spec §10 미결 2 | L1.tools가 kind `question` 승인을 올리고 `continuation`으로 재호출합니다 | 결정됨 |
| D6 MCP stdio 서버 실행 권한 | E-02(bwrap 없음), L2.mcp.spec §10 미결 5 | M2는 사용자 권한 실행입니다. `.mcp.json`(루트와 `.xeon/mcp.json`)은 프로젝트 신뢰 뒤에만 읽습니다. 샌드박스는 bwrap 시험 환경이 생긴 뒤 정합니다 | 일부 결정(샌드박스 열림) |
| D7 `post.when = next`와 `aside` | L1.tasks.spec §4.9, FR-T4 | B안 + 1안입니다. F `PostWhen`은 바꾸지 않고 FR-T4는 철회합니다 | 결정됨 |
| D8 Cordis 재시작 재적용 시점 | N-02 | (b) 다음 단계 경계에 적용합니다. X.3에서 구현했습니다 | 결정됨, 해결(8981bc8) |
| D9 X 외부 확장 탐색·로더·훅·안전 모드 | V-09, X.loading-trust.plan L-13·L-14·L-18·L-28·L-29 | M3로 옮겼습니다. 프로젝트 신뢰(X.4)만 M2입니다. V-09(host의 X 로더 사용)도 M3에서 봅니다 | 결정됨 |
| D10 pi-tui | L4.cli.spec §10 미결 6 | M2에 스파이크를 돌리고 한글 IME·CJK 폭 확인을 통과할 때만 1.3.0을 채택합니다. 종료 조건이 아닙니다 | 결정됨(스파이크 열림) |
| D11 사람 확인 측정 | 없음 | 실제 키 검색 래퍼 측정(약 20회)과 개발자 세션 DB 사본 FTS 측정은 WEB.6, KN.4 뒤 각각 사용자 승인을 한 번 받습니다 | 결정됨 |
| `@vscode/ripgrep` 소유 | M-04, DR-07 대 L2.workspace.plan 어긋남 | `platform-os`가 바이너리 경로를 제공하고 `cap-workspace`가 실행합니다. 두 문서를 맞췄습니다 | 결정됨 |
| knip catalog 예외 | M-04 | `xeon/knip.json`의 catalog 예외를 Z.1까지 둡니다 | 결정됨 |
| pi 메시지 스키마 깊은 검증 | F.conversation.spec §10 미결 2 | M3로 옮겼습니다. M2는 얕은 검증입니다 | 결정됨 |
| `getOrThrow` | 없음 | 테스트 전용 도우미로 둡니다 | 결정됨 |
| env-node-spill 스트림 훅 교체 | N-10과 같은 포크 파일 | `Reflect.get`을 쓰는 현재 방식을 유지합니다 | 결정됨 |
| 테스트 실행 | E-01, E-04 | `just test`(`xeon/scripts/test-capped.sh`)가 cgroup 메모리 상한 아래에서 패키지 하나씩 돌립니다 | 결정됨 |
