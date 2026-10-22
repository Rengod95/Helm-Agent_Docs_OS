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
| B-04 | 출력 절단 함수 위치가 문서마다 다르고 구현 사본이 3곳입니다. | L0.exec.spec §1, L2.workspace.plan, cap-workspace/src/truncate, apps/host/src/assembly/truncator.ts, core-tools `truncator` 옵션 | D-08대로 `platform-exec`에 둡니다. `ExecService.truncateHead`·`formatSize`를 L0.exec.spec에 적고 사본 삭제를 `L0.exec.plan` EX-21로 두었습니다(`review.decisions-2` B-04). | 이번 정리에서 처리(코드 후속) |
| B-05 | 모델 키를 `runtime-http`로 lease하는데 F 주석과 U-19가 서로 다른 단계를 가리킵니다. | core-models, contracts `SecretUseModeSchema`, L0.secrets.spec §8.3, decisions-2 U-19 | M1부터 모델 provider 키는 `runtime-http`, bash 도구는 `env`입니다. F 주석을 사용 모드 번호와 마일스톤으로 나눠 적고, L0.secrets §8.3 R6과 수용 기준 14번(`policy.test.ts`)을 더했습니다(`review.decisions-2` B-05). | 이번 정리에서 처리(시험 후속) |
| B-06 | 테스트가 `Bun.spawn`을 쓰는데 허용 결정이 없고 check-layers도 잡지 못합니다. | eng.dependency-rules DR-07, L4.desktop.plan R10, apps/cli/test, core-persistence·cap-workspace 시험 | DR-07에 테스트 한정 행, 허용 목록 `scope: "test"` 필드와 항목을 정했습니다. check-layers 검사는 구현 후속입니다(`review.decisions-2` B-06). | 이번 정리에서 처리(코드 후속) |
| B-07 | `xeon chat --continue`가 상태 파일 위치를 모릅니다. 지금은 `XEON_CLI_STATE_FILE`만 됩니다. | L4.cli.spec §10-1, apps/host, apps/cli/src/runtime.ts | `@xeon/host` `resolveHostStatePaths()`를 L4.host-service.spec §3.3.6에 두고 H21로 계획했습니다. 환경 변수는 테스트 덮어쓰기로만 남습니다(`review.decisions-2` B-07). | 이번 정리에서 처리(코드 후속) |

## 3. 문서 정정 (문서끼리 어긋남)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| D-01 | TypeBox 버전이 1.4.2와 1.3.27로 갈립니다. | F README, L0.exec.plan §4.2, L1.models.plan §4·§7, ADR-0001, eng.toolchain, eng.domain-types 외 plan의 의존 표 | 모두 1.3.27(U-24)로 고치고 버전 [미결]을 닫았습니다. | 이번 정리에서 처리 |
| D-02 | srt 버전이 0.0.81과 0.0.79로 갈립니다. | L0.sandbox.spec §1, L0.sandbox.plan §4·SB-01 | 0.0.79로 고쳤습니다. L0.secrets의 0.0.81 기능 조사 문장에는 고정 판에서 다시 확인하라고 적었습니다. | 이번 정리에서 처리 |
| D-03 | SENSITIVE_ENV_PATTERNS 위치가 문서마다 다릅니다. | L0.secrets.spec §4.5·§9, plan SC-11, F.capabilities §3.12, L0.exec | 모두 `@xeon/contracts/services`(services/exec.ts)로 통일합니다. | 열림 |
| D-04 | F 스펙이 코드와 다릅니다. | F.records.spec §3.9 표, L1.persistence §6.2, F.capabilities §3.3·§3.10, L2.readme §5.1 | §3.9 표를 U-09(LeaseToken)에 맞춥니다. §6.2의 records → settings import 문장을 지웁니다. `ToolSpecFor`는 메서드 문법, `SecretNameSchema`는 `TUnsafe<SecretName>`. L2.readme `defs/web`은 capabilities 인덱스 재노출로 바꿉니다. | 열림 |
| D-05 | 서비스 파일 사이 import 금지와 L1이 요구하는 공용 타입이 부딪칩니다. | F.capabilities §3.12 규칙 3·4, L1.tools·L1.agents | 규칙 4에 공용 값 타입의 허용 방향을 적고 L1 문서의 위치 요청을 고칩니다. | 열림 |
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
| V-01 | `as` 단언이 TY-06 허용 위치 밖에 있고 주석 형식도 다릅니다. 린트 규칙이 없습니다. | contracts validate.ts·kinds.ts·jsonschema.ts·defs/workspace.ts, platform-os binaries/resolve.ts, apps/host main.ts, secrets redactor.ts | 주석 형식을 맞추고 `.oxlintrc.json`에 `consistent-type-assertions`를 더합니다. `maskDeep` 예외는 TY-06에 적습니다. | 열림 |
| V-02 | 전역 시각과 sleep을 직접 씁니다. | apps/cli/src/runtime.ts:147, apps/cli/test/chat.scenario.test.ts:294 | 시계는 platform-os 값으로 받고, 테스트는 settle 알림을 기다립니다. | 열림 |
| V-03 | 예상 가능한 실패를 Bug로 던집니다. | core-persistence writer.ts, platform-os dirs.ts, core-tasks enqueue, F wire 오류 kind | StoreError `io`, DirsError `cancelled`, wire 오류 kind를 더합니다. | 열림 |
| V-04 | 오류를 삼키거나 취소 신호가 전달되지 않습니다. | platform-exec win32.ts:19, host handlers/events.ts:189, platform-secrets sops runner, ExtHost.install, InProcessHost.close | 실패 로그, 구독 종료 알림, 취소 신호 전달, close 시한 결과를 정합니다. | 열림 |
| V-05 | 낮은 등급 리뷰 지적이 남았습니다. | ext-host state.ts:301, core-loop commits.ts:59 대 core-tools effects.ts:34, core-persistence emitVolatile, core-tools pipeline.ts:296, core-loop agent-wrapper.ts:650 | toolResult 키 통일은 U-13 보완 1(F `commitKeyPart` 하나)로 문서를 정했습니다. 나머지(fingerprintSource, emitVolatile 검사, `itemId`, `committed`)는 열려 있습니다. | 일부 이번 정리에서 처리 |
| V-06 | 주석이 사물을 사람처럼 씁니다. | apps/cli commands/chat.ts:164 외 | 서술형으로 바꿔 씁니다. | 열림 |
| V-07 | F `describeSandboxStatus`가 spec과 다릅니다(disabled일 때 warn 대 critical). | contracts/src/services/sandbox.ts, L0.sandbox.spec §4.6·§9-6 | 코드를 spec대로 warn으로 고칩니다. | 열림 |
| V-08 | M1에 계획보다 많이 넣었거나 바꿨습니다. | p_approvals·p_blob_refs 투영, print 모드 approval deny, ToolRunDrafts, args 192 KiB | L1.persistence.plan, L4.cli.spec C11, F.capabilities, L1.tools §4.4에 반영합니다. | 열림 |
| V-09 | host가 X 로더를 쓰지 않고 `ExtHost.install`을 직접 부릅니다. | apps/host/src/assembly/extensions.ts, X.loading-trust | 로더 의존 순서 지원 또는 `reservedExtensionSettings` 공개, 동명 extraPlugin 규칙을 정합니다. | 열림 |
| V-10 | 복구 뒤 로그에 `loop.run_rejected`(tasks.scope_settled)가 남습니다. 결과는 정상입니다. | core-loop 재개 경로, apps/cli chat.scenario 시험 2 | N-03으로 옮겨 추적합니다. | 열림(N-03) |

## 5. 환경·도구 (코드를 고치지 않고 보고)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| E-01 | WSL2 벽시계가 튀어 platform-exec watch 적합성 시험이 40~50% 실패합니다. | platform-exec 적합성 시험 | 안정된 시계에서 재확인합니다. 그때까지 한 번 재실행으로 판단합니다. | 열림 |
| E-02 | bwrap, socat, macOS 실기가 없어 일부가 검증되지 않았습니다. | platform-sandbox, platform-store, platform-os, platform-exec, platform-secrets | `bubblewrap socat` 설치 뒤 int 시험, macOS는 CI나 실기로 확인합니다. | 열림 |
| E-03 | depcruise가 'TypeScript 7 미지원' 안내만 내는 때가 있습니다. | .dependency-cruiser.cjs | 순환을 일부러 만들어 잡히는지 확인합니다. | 열림 |
| E-04 | 전체 `just fmt`가 생성물을 다시 서식합니다. 자식 프로세스가 turbo를 멈춘 적이 있고 오래된 심볼릭 링크가 있습니다. | apps/host/schema/*.json, .oxfmtrc.json, platform-process test/fixtures/tree.ts, core-loop/node_modules | ignorePatterns, 자손 정리, 링크 정리를 합니다. | 열림 |
| E-05 | check-layers가 TS-NN 항목을 형식만 검증합니다. `node:fs` 모킹과 `Bun.spawn`을 잡지 못합니다. test-preload.ts와 bunfig가 없습니다. | scripts/check-layers.ts, dependency-allowlist.json | TS-NN 적용과 DR-07 검사를 더합니다. `Bun.spawn` 검사 범위는 B-06으로 정했습니다. | 열림 |

## 6. M2로 넘길 것

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| M-01 | 확장 레코드와 상태 쓰기가 안 됩니다. 그룹 drive가 `lease.released reason=error`로 끝납니다. | core-persistence ext.commit·queryRecords(PS-16), EventKindRegistry, `scopeLeaseEpoch` | PS-16과 kind 등록을 구현합니다. | 열림 |
| M-02 | 승인 응답 경로가 끝까지 이어지지 않았습니다. U-19 env 주입 경로의 승인 증거도 `null`입니다. | host H18 `approval.respond`, core-loop approvals 연결 시험 | H18에서 증거 전달까지 완성하고 A1 요청, SIGKILL, 재개, 응답을 한 엔진에서 시험합니다(`review.decisions-2` U-19). | 열림 |
| M-03 | host 메서드가 `notImplemented`입니다. | H9, H16, H17, H19, stdio 자식 프로세스 시험 | M2 계획대로 구현합니다. | 열림 |
| M-04 | 의존과 번들이 미연결입니다. | `age-encryption` 0.3.1, `@vscode/ripgrep`, binaries.lock.json, platform-store/testing | catalog 고정과 연결, `openTestStore` 교체를 합니다. | 열림 |
| M-05 | exec, process, secrets, group의 M1 스텁입니다. | startBackground, ProcessPort.run, spill 위치, sandbox allow-list, withBrowserInput, workspace.images, defineGroup | 각 M2 항목으로 구현합니다. spill 위치를 먼저 정합니다. | 열림 |
| M-06 | 작업 폴더가 `process.cwd()` 하나입니다. | cap-workspace root, ThreadStartedPayload.workspace, 허용 root 조회 API | thread.create의 workspace를 저장하고 root 계산에 씁니다. | 열림 |
| M-07 | 컨텍스트와 모델의 M1 고정값입니다. | core-context, core-models 토큰 예산, core-tasks limiter, BlobRef 생산자, detached 필드 | 설정 `l1.context.*`와 함께 구현합니다. | 열림 |
| M-08 | 컴파일 바이너리와 F 계약 확정이 남았습니다. | apps/host/src/main.ts 최상위 await, L4.cli.plan §4.3, ThreadSummary 등 | await를 없애고 측정값을 plan에 적습니다. F 계약 모양은 M2 시작 때 확정합니다. | 열림 |

## 7. 새 항목 (2026-10-22 추가)

| 번호 | 항목 | 어디 | 제안 처리 | 상태 |
|---|---|---|---|---|
| N-01 | 세션을 다시 열면 builtin scope에 `scope.changed{enabled}`가 다시 기록됩니다. `X.primitives.spec` §4.5.6은 `ExtThreadSnapshot.enabled`와 현재 켜짐이 다를 때만 첫 경계 기여에 넣는다고 적었습니다. | ext-host 시작 적용·스냅샷 비교, X.primitives §4.5.6 | 스냅샷 비교 결과가 같으면 기록하지 않게 고치고, 다시 열기 시험에서 `scope.changed` 수를 확인합니다. | 열림 |
| N-02 | Cordis provider가 재시작되면 scope를 곧바로 다시 적용합니다. 적용 시점은 단계 경계여야 합니다(U-01). | ext-host Cordis 연결, X.primitives §10 | U-01의 예외로 둘지, 재적용 요청만 기록하고 다음 경계에서 적용할지 정합니다. X.primitives §10의 같은 미결에 이 항목을 연결했습니다. | 열림 |
| N-03 | 복구 뒤 `loop.run_rejected`(tasks.scope_settled)가 로그에 남습니다(V-10). | core-loop 재개 경로 | 닫힌 turn을 다시 돌리는 호출을 찾아 막고 로그에서 사라지는지 확인합니다. 자체 루프 작업(ADR-0009)과 함께 봅니다. | 열림 |

## 8. 처리 순서 제안

1. `review.decisions-2` §5 구현 후속(U-05, U-12, U-13, B-04~B-07)을 처리합니다. 자체 루프(ADR-0009)와 겹치는 core-loop 변경은 그 작업과 순서를 맞춥니다.
2. 문서 정정 D-03~D-14를 처리합니다.
3. 편차 중 린트로 잡을 수 있는 것(V-01, V-02, V-06)은 규칙을 더한 뒤 고칩니다.
4. 환경 E-03(depcruise 동작)을 확인한 뒤 M2의 M-01(PS-16)부터 시작합니다.
