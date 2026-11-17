---
id: L1.workspace.plan
layer: L1
domain: workspace
kind: plan
status: draft
depends_on: [L1.workspace.spec, L2.workspace.spec, L2.workspace.plan, L0.exec.plan, L0.sandbox.spec, adr.0003]
binds: [xeon/packages/core-workspace/**]
---

# L1 작업 폴더 서비스 구현 계획

대상 스펙: `L1.workspace.spec`. 패키지: `@fresnel/core-workspace` [제안](`xeon/packages/core-workspace`). 근거: `hooks-core-boundary` §6.1 행 `cap-workspace`, §8 D-27·D-32, §9 6단계(재수출 이동).

## 1. 목표와 마일스톤 배치

| 항목 | 내용 | 근거 |
|---|---|---|
| 목표 | `cap-workspace`(L2)의 서비스 부분을 L1 패키지로 옮긴다. 모델 도구는 L2에 남고 옮긴 서비스를 쓴다. 기능 id와 등록은 그대로다 | `hooks-core-boundary` §6.1, 결정 B(2026-11-17 사용자 U4) |
| 배치 | 9절 6단계(재수출 이동)의 한 변경. 복사, 가져다 쓰는 곳 전환, 옛 파일 삭제를 한 번에 한다 | `hooks-core-boundary` §9 6단계, D-28(`core-tools/src/ask/`)과 같은 방식 |
| 선행 | 없음. 층 D1(`ask/`)은 이미 병합되어 있다 | `hooks-core-boundary` §8 D-28 |
| 뒤 | `FileChange` 생산(D-19 사용 시작, 4.7절)은 변경 기록 트랙이 맡는다 | [미결] |

## 2. 패키지와 파일 배치

`xeon/packages/core-workspace/` (L1, 도메인 `workspace`). 줄 수는 `wc -l`이다.

```
src/
  index.ts                    26   공개 진입점
  deps.ts                     53   WorkspaceDeps<S>, WorkspaceShellSettings, RgResolver (제네릭으로 바꿈)
  env.ts                      58   WorkspaceEnv, envAtCwd
  errors.ts                  169   WorkspaceFailure, guarded, 공통 코드 대응
  roots.ts                   215   허용 root, 경로 해석과 탈출 검사
  scope.ts                    28   scopedDeps (대화별 작업 폴더)
  write-access.ts            245   쓰기 루트 후보, 승인 요청, askOutsideWrite
  write-access-adapter.ts     86   L2ApprovalsPort 어댑터, writeAccessTitle
  ports/blobs.ts              10   BlobSink
  ports/threads.ts            13   ThreadWorkspaces
  ports/write-access.ts       36   WriteAccessPort
  shell/run.ts               277   createShellApi (샌드박스 래핑과 쓰기 허용 재실행)
  shell/unattended.ts         17   무인 제한 시간 상한
  shell/upstream/bash.ts     126   runBashCommand (pi 포크 본문)
  files/atomic.ts             92   atomicWrite (임시 파일과 이름 바꾸기)
  files/queue.ts              60   queueInCallOrder, mutationKey
  files/upstream/path-utils.ts 47  normalizeToolPath, resolveToolPath (pi 포크)
  upstream/get-or-throw.ts    10   getOrThrow
  upstream/output.ts         303   OutputBuffer, boundOutput, characterEnd (pi 포크)
test/
  roots.test.ts, errors.test.ts, output.test.ts, shell.test.ts, write-access.test.ts, fork-records.test.ts
  support/memory-env.ts, fakes.ts, assertions.ts, adapter.ts   (이 패키지 전용 사본)
PATCHES.md, UPSTREAM.json, LICENSE.pi   (이 패키지의 포크 기록)
```

- src 합계 1,845줄(`index.ts` 제외). 시험과 시험 대역 1,841줄.
- `cap-workspace`에 남은 것: 모델 도구 `read`, `write`, `edit`, `grep`, `bash`의 정의와 인자 해석(`files/read.ts`, `write.ts`, `edit.ts`, `grep.ts`, `rg.ts`, `api.ts`), 이미지(`images/` 전체), 차이와 렌더, `truncate/paging.ts`, `settings.ts`, `manifest.ts`, `plugin.ts`(등록), `service.ts`(조립), `deps.ts`(서비스 의존에 l2 설정 모양을 입힌 별칭). 합계 src 2,609줄(기존 4,428줄).
- 셸 쪽에 남은 모델 측 파일은 없다. `bash`의 정의와 렌더는 F(`contracts/capabilities/defs/workspace.ts`)에 있고, 등록은 `plugin.ts`가 한다.
- `shell/env.ts`는 없다. 샌드박스 래핑은 `shell/run.ts`(`execute`)에 있고, 환경 모양은 `env.ts`(`WorkspaceEnv`)가 맡는다.

## 3. 작업 분해

| 번호 | 내용 | 선행 | 규모 |
|---|---|---|---|
| W1 | 서비스 파일과 포크 파일을 `core-workspace/src`로 옮긴다. 디렉터리 구조를 그대로 둬서 옮긴 파일끼리의 상대 import는 바꾸지 않는다 | 없음 | S |
| W2 | `deps.ts`를 제네릭(`WorkspaceDeps<S extends WorkspaceShellSettings>`)으로 바꾼다. L2 설정 파일을 import하지 않게 하려는 것이다. `scopedDeps`도 제네릭으로 바꾼다 | W1 | S |
| W3 | 포크 기록을 나눈다. `PATCHES.md` 표 행과 `UPSTREAM.json`의 `copiedPaths`, `originalSha256`, `partialCopies`, `modifications`를 두 패키지에 맞춘다(7절) | W1 | M |
| W4 | `cap-workspace`가 `@fresnel/core-workspace`를 가져다 쓴다. 파일 도구, 이미지, 플러그인, 조립의 import를 바꾼다. `deps.ts`는 `WorkspaceDeps<WorkspaceSettings>` 별칭이 된다 | W1, W2 | M |
| W5 | 시험을 옮긴다. 셸, 경로, 오류, 출력, 쓰기 허용(셸 부분)은 `core-workspace/test`로 가고, 파일 도구의 쓰기 허용 시험은 `cap-workspace/test/write-access-files.test.ts`로 나눈다. 시험 대역은 두 패키지가 각자 둔다(DR-08) | W1 | M |
| W6 | 호스트 import를 바꾼다. `writeAccessTitle`은 `@fresnel/core-workspace`에서 가져온다. `apps/host`의 `package.json`과 `tsconfig.json`에 의존을 더한다 | W4 | S |
| W7 | 설정 파일을 갱신한다. 루트 `tsconfig.json`, `knip.json`, `bun.lock`(`bun install`, 작업 공간 항목만 더해짐), 라우팅 `routes.yaml`의 L1 `domains`(`workspace`), DR-07 허용 목록(`DR-07/core-workspace-test-spawn`) | W1~W6 | S |
| W8 | `core-tools/src/policy/rules.ts`의 `"workspace.files"`를 `WorkspaceFiles.id`로 바꾼다(D-32) | 없음 | S |
| W9 | 문서: `L1.workspace.spec`(이 문서의 짝), `L1/README.md` 도메인 표, `L2.workspace.spec`과 `L2.workspace.plan`의 파일 위치, `hooks-core-boundary` §6.1, §8 D-27·D-32, §9 6단계 | W1~W8 | M |

## 4. 채택 코드

pi(`earendil-works/pi`, 커밋 `cdaf6c2`, `packages/durable`)의 포크 세 개가 이 패키지로 간다. 원본 sha256과 복사 범위는 `UPSTREAM.json`에 있다.

| 원본 | 복사본 | 바꾼 점(PATCHES.md) |
|---|---|---|
| `src/tools/path-utils.ts` | `src/files/upstream/path-utils.ts` | P1, P2, P8, P10: Chord 치환, F 서비스 import, `normalizeToolPath` 내보내기, 린트 억제 제거 |
| `src/tools/bash.ts` | `src/shell/upstream/bash.ts` | P1, P2, P6: 도구 껍데기를 걷고 `runBashCommand(shell, run, limits, context)`로 만듦. 샌드박스 래핑은 호출자가 한다 |
| `src/harness/output.ts` | `src/upstream/output.ts` | P2, P3, P4, P9, P10: `OutputBuffer`, `boundOutput`, `sanitizeOutput`, `characterEnd`와 상수만. `Progress`는 뺀다 |

`cap-workspace`에 남은 포크는 `read.ts`(P1, P2, P5, P10), `edit-diff.ts`(P13–P18), `image.ts`·`image-processor.ts`(P11, P12)다. 같은 패치 id가 두 패키지에 걸치는 것은 P1, P2, P10뿐이고, 행마다 파일이 다르다.

## 5. 단위 테스트 목록

| 파일 | 확인하는 것 |
|---|---|
| `roots.test.ts` | 작업 폴더 안의 해석(아직 없는 파일 포함), `..`·심볼릭 링크 탈출 거부, 마디 단위 포함 검사, 보호 경로 거부, `protectedPaths`에 허용 root 전달, 잘린 출력 사본의 읽기 root와 복원 |
| `errors.test.ts` | 공통 코드 표(`FileErrorCode`, `ExecutionErrorCode`), `CapabilityError` 만들기, 버그와 완성된 오류 유지, 모르는 실패의 `internal` 변환 |
| `output.test.ts` | 출력 버퍼의 꼬리 보관, 줄과 바이트 한도, 제어 문자 정리, 문자 경계 |
| `shell.test.ts` | 셸 결과와 종료 코드, 샌드박스 거부와 서비스 없음 거부, 샌드박스 차단 보고, 제한 시간(기본, 무인 상한, 요청이 짧을 때), 시크릿 참조 전달과 승인 증거, cwd 검사, 출력 꼬리 절단과 spill |
| `write-access.test.ts` | 쓰기 루트 후보(`grantRootFor`), 계획(`planWriteAccess`), 출력의 거부 문구 경로(`pathsFromDenialOutput`), 셸 쓰기 질문 세 선택지, 무인 호출과 보호 경로 거부, 읽기 전용 프로필, 홈 폴더 후보 |
| `fork-records.test.ts` | `PATCHES.md` 표, `UPSTREAM.json` `modifications`, 소스 표지의 id 집합이 같다. 복사 경로가 있다. Chord와 pi-durable import가 없다. 소스에 `node:fs`, `Bun.file`, `Bun.spawn`, `process.platform`이 없다(DR-13) |

파일 도구의 쓰기 허용 시험(`cap-workspace/test/write-access-files.test.ts`)과 쓰기 어댑터 통합 시험(`cap-workspace/test/write-access-adapter.int.test.ts`, `core-tools` 대역을 쓴다)은 L2에 남는다. 원자 쓰기(`atomic.ts`)와 줄세우기(`queue.ts`)에는 따로 단위 시험이 없다. 그 동작은 L2의 `write-edit.test.ts`, `write-edit.int.test.ts`(SIGKILL 시험 포함)가 본다.

## 6. 완료 기준

- `just check packages/core-workspace`, `just check packages/cap-workspace`, `just check packages/core-tools`, `just check apps/host`가 통과한다.
- `just check-layers`가 38개 패키지에서 위반 0이다. `just check-ts-rules`가 위반 0이다.
- `just depcruise`, `just knip`, `just docs-route --check`(오류 0), `just terms check`가 통과한다.
- `bun install --frozen-lockfile`이 통과한다(lock 변경은 작업 공간 항목 16줄뿐이다).
- 병합 직전의 `just verify`와 CI는 메인 작업자가 돌린다. 이 계획의 작업자는 돌리지 않는다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 포크 기록의 불일치: 표지, 표, `modifications`가 패키지마다 맞아야 한다 | 두 패키지 모두 `fork-records.test.ts`가 검사한다. 복사한 시험이 같은 규칙을 본다 |
| 시험 대역이 두 벌이다(`memory-env.ts` 약 350줄). `src/testing`으로 내보내면 DR-08(테스트 전용 모듈은 테스트 파일에서만)을 어긴다 | 사본을 각 패키지 `test/`에 둔다. 공용화는 DR-08 아래에서 따로 정한다 [미결] |
| `core-workspace`가 `platform-exec`를 시험에서 쓴다(`fakeExec`, 메모리 env의 절단) | `devDependencies`에 둔다(DR-08, DR-01) |
| 절단 함수 사본이 생기는 일 | 사본은 없다. `truncateHeadOf`는 `fresnel.exec`가 맡고, `core-workspace`는 그것을 부르지 않고 `output.ts`의 `OutputBuffer`로만 꼬리를 잡는다(셸 본문) |
| 설정 키를 L1이 읽게 되는 일 | `WorkspaceShellSettings`로 모양만 받는다. 값과 키의 소유자는 L2다 |
