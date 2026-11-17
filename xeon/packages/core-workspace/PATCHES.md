# core-workspace 포크 패치 기록

`src/files/upstream/path-utils.ts`, `src/shell/upstream/bash.ts`, `src/upstream/output.ts`는 pi의 포크다(경로 해석 함수, 셸 실행 본문, 출력 버퍼와 절단 상수). 이 패키지는 샌드박스를 거치는 파일·셸 서비스의 코어 부분을 맡는다(`L1.workspace.spec`, D-27). 원본 저장소, 커밋, 복사 경로, 파일별 sha256은 `UPSTREAM.json`에 있다.
이 패키지의 세 기록(이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// FRESNEL-PATCH: <id>` 표지)의 패치 id 집합이 같아야 한다.
`test/fork-records.test.ts`가 이를 검사한다. 근거 문서는 `L2.workspace.plan` §2, `adr.0003` §3.4다(복사 분할 결정은 `L1.workspace.plan` §2).
고친 줄 위에 표지를 단다. 줄 번호는 원본(커밋 `cdaf6c2`, `packages/durable/` 또는 `packages/coding-agent/`) 기준이다.

## 패치 표

| 패치 id | 파일:줄 | 바꾸는 점과 이유 | 확인 테스트 |
|---|---|---|---|
| P1 | `tools/path-utils.ts:1`, `tools/bash.ts:1` | Chord `import type { Context }`를 `import type { CancelScope as Context } from "@fresnel/contracts/services"`로 바꾼다. 본문의 `context.abortSignal`과 `Context` 표기는 그대로다. Chord 제거(adr.0003 §3.1) | `tsc -b`(chord 미설치), `fork-records.test.ts`의 chord import 0건 검사 |
| P2 | `tools/path-utils.ts:2`, `tools/bash.ts:3-6`, `harness/output.ts:1-2` | 구현 패키지와 durable 내부 모듈을 가리키던 import를 이 패키지 안의 같은 동작으로 바꾼다. `getOrThrow`는 `src/upstream/get-or-throw.ts`(F `Result` 위), `utf8ByteLength`는 `src/upstream/output.ts`(P3), 절단 함수는 platform-exec의 `fresnel.exec`(`ExecService.truncateHeadOf`)로 부른다, `ShellOutputSkip`은 F, `characterEnd`·`OutputBuffer`는 `src/upstream/output.ts`. `platform-exec`를 import하지 않는다(DR-02) | `tsc -b`, `depcruise` |
| P3 | `harness/output.ts:2` | `utf8ByteLength`를 `truncate.ts`에서 가져오던 import를 `src/upstream/output.ts` 안의 함수로 바꾼다. 본문은 `Buffer.byteLength(content, "utf8")` 하나이고, `globalThis.Buffer` 존재 검사와 순수 JS 대체 계산(형변환 단언과 제어 문자 정규식을 요구)은 두지 않는다. `truncate.ts` 자체는 platform-exec로 옮겼다(B-04). `read.ts`도 이 함수를 쓴다 | `output.test.ts` |
| P4 | `harness/output.ts:194`, `harness/output.ts:208`, `harness/output.ts:250` | `noUncheckedIndexedAccess`와 비null 단언 금지에 맞춘다: `this.#chunks[0]!`는 undefined 검사, 함수 `lines`는 지역 변수 `lines`를 가리지 않도록 `lineTotal`로 이름을 바꾼다(`no-shadow`). 동작은 같다 | `output.test.ts` |
| P6 | `tools/bash.ts` 전체 | `createBashTool`/`runCommand`에서 도구 껍데기(`defineTool`, `ToolExecutionApi`, `commandPrefix`, `prepare`, PowerShell, 진단)를 걷어 내 `runBashCommand(shell, run, limits, context)`로 만든다. `api.output()`/`retainedOutput()`/`outputWindow` 자리에는 같은 `OutputBuffer`(꼬리 보관)와 같은 window(`minIntervalMs` 100, 100KiB/s)를 직접 쓴다. 성공과 실패를 `Result`로 돌려주고 실패에도 그때까지의 출력을 싣는다. 타임아웃 오류 문구는 서비스 경계(`shell/run.ts`)가 만든다. 샌드박스 래핑은 호출자가 `Shell`에 입힌다. 시간 초과·취소를 `Error`로 바꾸던 부분은 지웠다 | `shell.test.ts` |
| P8 | `tools/path-utils.ts:7`, `tools/path-utils.ts:12` | `normalizeToolPath`를 export하고(`src/roots.ts`가 `..` 마디 검사에 쓴다), 함수가 받는 env를 `Pick<ExecutionEnv, "absolutePath" \| "exists">`로 좁힌다. 탈출 검사는 넣지 않는다(plan §2 표) | `roots.test.ts` |
| P9 | `harness/output.ts:261` | `isolatedDeclarations`가 요구하는 export 상수 타입 주석을 단다 | `tsc -b` |
| P10 | `files/upstream/path-utils.ts`(`resolveReadToolPath`), `upstream/output.ts`(`sanitizeOutput`) | `eng.typescript.guide` §1 포크 코드 절과 TY-22를 적용해 린트 억제 주석을 걷는다. 읽기 경로 후보 확인의 `no-await-in-loop` 반복문은 `@fresnel/contracts`의 `eachAsync`로 옮긴다. `no-control-regex`가 걸린 `INVALID_OUTPUT` 정규식은 UTF-16 코드 단위를 검사하는 `isInvalidOutputUnit`으로 바꾼다. 검사 범위는 같다: U+0000..U+0008, U+000B..U+001F, U+FFF9..U+FFFB. 동작은 같다 | `tsc -b`, `bun run lint`, `test/output.test.ts`, `test/roots.test.ts` |

## 복사 범위(패치가 아니라 선택)

- `harness/output.ts`: `OutputBuffer`, `boundOutput`, `sanitizeOutput`, `characterEnd`와 그 의존만 둔다. `Progress`(진행 커밋 지연기, `Date.now()`와 타이머를 쓴다)는 뺐다. `PROGRESS_BYTES_PER_SECOND` 상수는 window 옵션에 필요해 남겼다.
- `tools/path-utils.ts`: `normalizeToolPath`, `resolveToolPath`, `resolveReadToolPath`를 옮겼다. 경로 탈출 검사(`src/roots.ts`)가 쓴다.
- `tools/bash.ts`: 본문(`runBashCommand`)만 옮겼다. 샌드박스 래핑과 권한은 `src/shell/run.ts`가 맡는다.
- `truncate.ts`: 이 패키지에 두지 않는다. 구현은 `platform-exec`의 포크(`src/upstream/truncate.ts`)이고 `ExecService.truncateHeadOf`·`truncateHead`·`formatSize`로 부른다(`review.decisions-2` D-08, B-04).

## 서식

`bun run fmt-check`(oxfmt, 공백 2칸, 100열)가 `src`와 `test` 전체를 검사하므로 복사한 뒤 포크 파일도 같은 서식으로 다시 찍었다. 원본은 탭 들여쓰기라 줄 단위 diff가 크다.
패치만 보려면 원본도 같은 설정으로 포맷해서 비교한다. 예: 원본을 임시 디렉터리에 복사해 `oxfmt -c ../../.oxfmtrc.json <디렉터리>`를 돌린 뒤 `diff -u`한다.

## 린트 예외 주석

포크 코드에는 `oxlint-disable` 주석을 두지 않는다. `eng.typescript.guide` §1은 업스트림 병합 비용을 억제 주석의 사유로 인정하지 않는다. 린트가 걸리는 줄은 P10처럼 고쳐 쓰고 `FRESNEL-PATCH` 표지를 단다.
고칠 수 없는 줄이 생기면 주석으로 넘기지 말고 `[미결] TY-NN <파일:줄> <이유>`로 `review.open-issues`에 적는다. 업스트림을 갱신하면 새 원본에서 같은 린트 오류가 다시 생기므로 `bun run lint` 출력에 맞춰 P10을 다시 적용한다.
