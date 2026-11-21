---
id: L1.workspace.spec
layer: L1
domain: workspace
kind: spec
status: draft
depends_on: [F.capabilities.spec, L0.exec.spec, L0.sandbox.spec, L1.tools.spec, architecture.layers.spec, eng.dependency-rules.guide]
binds: [xeon/packages/core-workspace/**]
---

# L1 작업 폴더 서비스 (workspace)

패키지: `@fresnel/core-workspace` [제안] (`xeon/packages/core-workspace`). 층 L1, 도메인 `workspace`(`package.json`의 `fresnel`). 이 패키지는 기능 id를 내지 않는다. 기능 `workspace.files`, `workspace.shell`, `workspace.images`와 그 등록은 `@fresnel/cap-workspace`(`L2.workspace.spec`)가 한다.

## 1. 목적과 범위

### 1.1 정하는 것

- 파일·셸 서비스가 샌드박스와 경로 검사를 거치게 하는 코어 부분. 빠지면 블록의 보장(작업 폴더 밖 쓰기 막기, 샌드박스 래핑)이 깨지므로 코어에 둔다. 판단 기준과 목록은 `hooks-core-boundary` §6.1(결정 B, 2026-11-17 사용자 U4)이 정한다.
- 경로 해석과 탈출 검사: 허용 root 조회, 정규 경로 해석, 보호 경로 검사, 잘린 출력 사본 폴더의 읽기 root, 사본 복원(`roots.ts`).
- [결정: 2026-11-21, 사용자, AGE-63] '프로젝트 밖에 쓰기' 승인 카드를 지웠다. 막히면 도구 결과의 막힘 안내만 남는다.
- 셸 실행 본문: 작업 폴더 기준 실행, 샌드박스 래핑(`fresnel.sandbox`), 무인 제한 시간 상한, 시크릿 참조 전달, 읽기 전용 프로필, 쓰기 거부의 막힘 보고(`shell/run.ts`, `shell/unattended.ts`, `shell/upstream/bash.ts`).
- 파일 쓰기의 안전 장치: 같은 디렉터리 임시 파일에 쓰고 이름 바꾸기, 동시 변경 감지(`files/atomic.ts`), 같은 프로세스의 같은 파일 변경 줄세우기(`files/queue.ts`).
- 대화별 작업 폴더의 의존 맞춤과 환경(`scope.ts`, `env.ts`, `ports/threads.ts`).
- 서비스 실패의 표(`errors.ts`): 내부 실패(`WorkspaceFailure`)를 `CapabilityError`로 바꾸는 규칙과 `guarded` 경계.
- 셸 본문이 쓰는 포크 함수: 출력 버퍼와 절단 상수(`upstream/output.ts`), 경로 정규화(`files/upstream/path-utils.ts`), `Result` 위의 `getOrThrow`(`upstream/get-or-throw.ts`).

### 1.2 다루지 않는 것

| 대상 | 정하는 곳 |
|---|---|
| 모델 도구 `read`, `write`, `edit`, `grep`, `bash`의 정의, 인자 해석, 결과 렌더, 이미지 처리, 도구 등록 | `L2.workspace.spec`(`@fresnel/cap-workspace`) |
| 설정 키 `l2.workspace.*`(읽기·셸·검색·이미지 한도, 편집 방식) | `L2.workspace.spec` §6 |
| 기능 id `workspace.files`, `workspace.shell`, `workspace.images`와 플러그인 등록 | `L2.workspace.spec`, `cap-workspace/src/plugin.ts` |
| 샌드박스 정책 모양과 보호 경로 목록의 출처 | `L0.sandbox.spec` |
| 명령 실행, 프로세스 그룹 종료, 출력 절단 함수 원본 | `L0.exec.spec`(`platform-exec`) |
| 도구 파이프라인, 정책 규칙, 승인 프로토콜 | `L1.tools.spec` |
| 파일 변경 기록(`FileChange`)의 생산 | 변경 기록 트랙 [미결], `hooks-core-boundary` §4.7과 D-19 |

## 2. 용어

- 작업 폴더(root): 대화가 시작될 때의 cwd이거나 `thread.started.workspace`에 저장된 폴더. 읽기와 쓰기 root 하나가 된다.
- 보호 경로: 샌드박스가 정한 경로. Fresnel 데이터와 시크릿, 설정 `extra`의 경로는 읽기와 쓰기를, 자격 증명 폴더와 `.env`는 쓰기만 묻지 않고 막는다(L0.sandbox 3.3절).
- 무인 호출: `CallContext.interactive === false`인 호출. 묻지 않고, 셸 제한 시간에 상한을 받는다.

## 3. 인터페이스

공개 진입점은 `src/index.ts`다. 다른 패키지는 이 이름만 import한다(DR-05).

| 묶음 | 이름 | 쓰는 곳 |
|---|---|---|
| 실패 | `WorkspaceFailure`, `guarded` | cap-workspace의 도구 메서드 경계 |
| 의존 | `WorkspaceDeps<S>`, `WorkspaceShellSettings`, `RgResolver`, `scopedDeps`, `envAtCwd`, `WorkspaceEnv` | cap-workspace와 조립 루트 |
| 포트 | `BlobSink`, `ThreadWorkspaces` | cap-workspace, 조립 루트 |
| 경로 | `defaultRoots`, `resolveWorkspacePath`, `relativeToRoots`, `AllowedRoots`, `RootsDeps`, `PathAccess`, `ResolvedPath` | cap-workspace 파일 도구 |
| 쓰기 실행 | `atomicWrite`, `mutationKey`, `queueInCallOrder` | cap-workspace `write`, `edit` |
| 셸 | `createShellApi` | cap-workspace 기능 `workspace.shell` 등록 |
| 포크 함수 | `getOrThrow`, `characterEnd`, `utf8ByteLength` | cap-workspace 읽기 도구 |

`WorkspaceDeps<S>`의 `settings`는 `S`를 돌려준다. `S`는 `WorkspaceShellSettings`(`shell.maxLines`, `shell.maxBytes`, `shell.defaultTimeoutSec`)를 포함해야 한다. 설정 키의 소유자는 L2이므로 이 패키지는 셸이 읽는 값의 모양만 안다.

## 4. 동작 규칙

1. 셸 실행(`createShellApi`의 `run`): 작업 폴더를 맞춘 뒤 cwd를 검사한다(읽기 root 안이어야 하고 디렉터리여야 한다). 샌드박스 서비스가 없으면 격리 없이 돌리지 않고 `unavailable`로 거부한다(`sandbox_service_missing`). 정책은 쓰기 root를 그대로 써서 `fresnel.sandbox.wrapShell`로 감싸 한 번 실행한다.
2. 쓰기 거부: 샌드박스가 쓰기를 막으면 막힌 경로(`sandbox.write_blocked`)를 도구 결과의 막힘 안내에 싣는다(L1.tools.spec §4.12.3). 다시 묻거나 같은 명령을 다시 실행하지 않는다. 위반 보고가 비어도 출력의 거부 문구에서 경로를 찾지 않는다.
3. [결정: 2026-11-21, 사용자, AGE-63] '프로젝트 밖에 쓰기' 승인 카드를 지웠다. 막히면 도구 결과의 막힘 안내만 남는다.
4. 읽기 전용 프로필(`CallContext.sandbox === "read-only"`): 쓰기 root 없이 읽기 전용 정책으로 실행한다. 막힌 실행의 출력에는 읽기 전용 안내 한 줄을 붙인다.
5. 무인 호출의 제한 시간: 요청값이 없거나 0 이하이거나 상한보다 길면 상한을 쓴다(`unattendedTimeoutSec`). 상한 값은 호출마다 `unattendedTimeoutMs`에서 읽는다.
6. 시크릿: `secretEnv`의 값은 이 패키지를 지나지 않는다. 참조(`secret://`)만 `fresnel.exec`에 넘기고, 승인 증거는 `CallContext.approval`을 그대로 옮긴다. 증거가 없으면 `fresnel.secrets`가 거부한다.
7. 쓰기 원자성: `atomicWrite`는 같은 디렉터리의 임시 파일(`.<이름>.fresnel-tmp-<uuid>`)에 쓰고 `flushFile` 뒤 `renameFile`로 바꾼다. `expectedBefore`가 있으면 이름 바꾸기 직전에 내용을 다시 읽어 다르면 `edit_conflict`로 거부한다. 실패하면 임시 파일을 지운다.
8. 같은 파일 줄세우기: 같은 파일 시스템의 `write`·`edit`은 경로 해석을 호출 순서대로 하고, 같은 정규 경로의 변경은 한 번에 하나만 돈다. 다른 프로세스나 `bash`에는 효과가 없다(그쪽은 `expectedBefore`가 맡는다).

## 5. 실패와 경계 사례

- 실패는 `WorkspaceFailure`(내부)로 던지고 `guarded` 경계가 `CapabilityError`로 바꾼다. 표는 `FileErrorCode`와 `ExecutionErrorCode`를 공통 코드로 옮긴다(`errors.ts`). 샌드박스가 막은 것은 `denied`에 `detail.by`로 출처를 붙인다.
- 보호 경로는 허용 root 안에 있어도 `denied`(`protected_path`)다. 루트 밖 경로는 `denied`(`outside_root`)이고, 아직 없는 마디에 `..`가 있으면 `denied`(`parent_traversal`)다.
- 셸 제한 시간 초과는 `timeout`이고 그때까지의 출력을 `detail`에 싣는다. 시간 초과 종료 코드는 -1이다.

## 6. 설정 노출

이 패키지는 설정 키를 선언하지 않는다. `l2.workspace.*` 키와 화면은 `L2.workspace.spec` §6이 정한다. 셸은 `shell.maxLines`, `shell.maxBytes`, `shell.defaultTimeoutSec`을 호출마다 읽는다.

## 7. 훅

이 패키지는 훅을 내지도 받지도 않고, 승인 카드를 올리지 않는다(작업 폴더 밖 쓰기 승인 카드는 2026-11-21에 지웠다).

## 8. 다른 문서와의 인터페이스

- 요구: `F.capabilities.spec`(`WorkspaceShell` 정의, `CapabilityError`, `CallContext`), `L0.exec.spec`(`ExecService`의 `withCwd`, `exec`, `truncateHeadOf`, `secretEnv` 참조 전달), `L0.sandbox.spec`(`defaultPolicy`, `wrapShell`, `protectedPaths`), `L1.tools.spec`(승인 프로토콜과 `L2ApprovalsPort`).
- 제공: 위 §3의 이름. 기능 id와 등록은 제공하지 않는다.
- 층 규칙: 이 패키지는 `contracts`, `ext-host`(시험), `platform-exec`(시험)만 쓴다. `cap-*`를 import하지 않는다(L1은 L2를 import하지 않는다, `architecture.layers.spec`).

## 9. 수용 기준

- `just check packages/core-workspace`가 통과한다(lint, typecheck, test).
- 이동한 시험 다섯 개(`roots`, `errors`, `output`, `shell`, `fork-records`)가 통과한다(`just check packages/core-workspace`의 test 단계).
- `cap-workspace`의 기능 id `workspace.files`, `workspace.shell`, `workspace.images`와 `plugin.ts`의 등록 결과가 바뀌지 않는다(`plugin.test.ts`).
- `core-tools`의 기본 규칙은 기능 id `workspace.files`를 `WorkspaceFiles.id`(F 정의)로 참조한다. 문자열 하드코딩이 없다(D-32).

## 10. 미결 사항

- [미결] `FileChange` 생산: 새 코어 서비스가 파일 변경을 `FileChange`로 낼지, 그 기록의 소유자는 변경 기록 트랙이다(`hooks-core-boundary` §4.7, D-19). 이 이동은 생산 경로를 바꾸지 않았다.
- [미결] 패키지 이름 `core-workspace`는 [제안]이다. 사용자 확인 전까지 이 이름을 쓴다.
- [미결] 시험 대역의 사본: `memory-env.ts`(약 350줄)와 셸 시험 보조가 `cap-workspace/test/support`와 `core-workspace/test/support`에 같은 본문으로 있다. 공용 시험 대역을 하나로 모으는 방법은 DR-08 아래에서 따로 정한다.
- [미결] DR-07 허용 목록 항목 `DR-07/core-workspace-test-spawn`의 근거 승인: 같은 검사를 쓰는 `DR-07/workspace-test-spawn`의 승인 근거(`review.decisions-2` B-06)를 따른 것이다.
