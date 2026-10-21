# cap-workspace 포크 패치 기록

`src/**/upstream/`과 `src/upstream/`은 pi의 포크다(durable 도구 5개와 출력 한도 함수, coding-agent `ls`). 원본 저장소, 커밋, 복사 경로, 파일별 sha256은 `UPSTREAM.json`에 있다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// XEON-PATCH: <id>` 표지.
`test/fork-records.test.ts`가 이를 검사한다. 근거 문서는 `L2.workspace.plan` §2, `adr.0003` §3.4다.
고친 줄 위에 표지를 단다. 줄 번호는 원본(커밋 `cdaf6c2`, `packages/durable/` 또는 `packages/coding-agent/`) 기준이다.

## 패치 표

| 패치 id | 파일:줄 | 바꾸는 점과 이유 | 확인 테스트 |
|---|---|---|---|
| P1 | `tools/read.ts:1`, `tools/path-utils.ts:1`, `tools/bash.ts:1` | Chord `import type { Context }`를 `import type { CancelScope as Context } from "@xeon/contracts/services"`로 바꾼다. 본문의 `context.abortSignal`과 `Context` 표기는 그대로다. Chord 제거(adr.0003 §3.1) | `tsc -b`(chord 미설치), `fork-records.test.ts`의 chord import 0건 검사 |
| P2 | `tools/read.ts:3-22`, `tools/path-utils.ts:2`, `tools/bash.ts:3-6`, `ls.ts`(가져오기 줄), `harness/output.ts:1-2` | 구현 패키지와 durable 내부 모듈을 가리키던 import를 이 패키지 안의 같은 동작으로 바꾼다. `getOrThrow`는 `src/upstream/get-or-throw.ts`(F `Result` 위), 절단 함수는 `src/truncate/upstream/truncate.ts`, `ShellOutputSkip`은 F, `characterEnd`·`OutputBuffer`는 `src/upstream/output.ts`. `platform-exec`를 import하지 않는다(DR-02) | `tsc -b`, `depcruise` |
| P3 | `truncate.ts:46-83` | `utf8ByteLength`의 `globalThis.Buffer` 존재 검사와 순수 JS 대체 계산을 지우고 `Buffer.byteLength(content, "utf8")` 하나로 둔다. Bun만 대상이고 대체 계산은 형변환 단언과 제어 문자 정규식을 요구한다 | `output.test.ts`(`truncateHead` 사례) |
| P4 | `truncate.ts:151`, `truncate.ts:174`, `harness/output.ts:194`, `harness/output.ts:208`, `harness/output.ts:250` | `noUncheckedIndexedAccess`와 비null 단언 금지에 맞춘다: `lines[0]`, `lines[i]`는 `?? ""`, `this.#chunks[0]!`는 undefined 검사, 함수 `lines`는 지역 변수 `lines`를 가리지 않도록 `lineTotal`로 이름을 바꾼다(`no-shadow`). 동작은 같다 | `output.test.ts` |
| P5 | `tools/read.ts` 전체 | `createReadTool`의 `execute`에서 도구 껍데기(`defineTool`, `ToolExecutionApi`, `requireEnv`, 진단 메시지, 이미지 분기)를 걷어 내 `readFileText(env, absolutePath, offset, limit, limits, context)`로 만든다. 한도는 상수가 아니라 설정에서 받는다. 결과는 `ReadSlice`(텍스트, 줄 번호, 전체 줄 수, 한도에 걸린 쪽)이고 `ReadOutput`으로 바꾸는 일은 `truncate/paging.ts`가 한다. 앞 8KB에 NUL이 있으면 `binary`를 돌려준다(spec §5 2번). offset 오류는 던지지 않고 `beyond_end`로 돌려준다. 전체 줄 수는 빈 파일 0, 끝 줄바꿈은 줄을 더하지 않는 값이다. offset·limit은 1 이상 정수라서 음수·소수 처리를 지웠다. 파일이 읽는 동안 두 번 바뀌면 `Error` 대신 `WorkspaceFailure("unavailable")`다. 이미지 분기는 M2(`workspace.images`, W7)에서 더한다 | `read.test.ts`, `paging.test.ts` |
| P6 | `tools/bash.ts` 전체 | `createBashTool`/`runCommand`에서 도구 껍데기(`defineTool`, `ToolExecutionApi`, `commandPrefix`, `prepare`, PowerShell, 진단)를 걷어 내 `runBashCommand(shell, run, limits, context)`로 만든다. `api.output()`/`retainedOutput()`/`outputWindow` 자리에는 같은 `OutputBuffer`(꼬리 보관)와 같은 window(`minIntervalMs` 100, 100KiB/s)를 직접 쓴다. 성공과 실패를 `Result`로 돌려주고 실패에도 그때까지의 출력을 싣는다. 타임아웃 오류 문구는 서비스 경계(`shell/run.ts`)가 만든다. 샌드박스 래핑은 호출자가 `Shell`에 입힌다. 시간 초과·취소를 `Error`로 바꾸던 부분은 지웠다 | `shell.test.ts` |
| P7 | `ls.ts` 전체 | `createLsToolDefinition`에서 도구 껍데기(`ToolDefinition`, 렌더러, `LsOperations`)와 `node:fs` 직접 호출을 걷어 내 `listDirectory(env, absolutePath, limit, context)`로 만든다. `ExecutionEnv.listDir`를 쓰고 종류는 `FileInfo.kind`(심볼릭 링크는 `symlink`)다. 정렬은 `localeCompare`(대소문자 무시)가 아니라 UTF-8 바이트 순이다(plan §2). 항목 수 한도 뒤 바이트 한도(50KB)를 적용하고 어느 쪽이 걸렸는지 돌려준다. 빈 디렉터리 문구와 안내 문장은 서비스 출력(`ListOutput`)과 `renderList`가 맡는다 | `list.test.ts` |
| P8 | `tools/path-utils.ts:7`, `tools/path-utils.ts:12` | `normalizeToolPath`를 export하고(`src/roots.ts`가 `..` 마디 검사에 쓴다), 함수가 받는 env를 `Pick<ExecutionEnv, "absolutePath" \| "exists">`로 좁힌다. 탈출 검사는 넣지 않는다(plan §2 표) | `roots.test.ts` |
| P9 | `truncate.ts:11-12`, `harness/output.ts:261` | `isolatedDeclarations`가 요구하는 export 상수 타입 주석을 단다(`DEFAULT_MAX_LINES: number` 등) | `tsc -b` |

## W2와의 차이

`L2.workspace.plan` W2는 `harness/types.ts`·`define.ts`에서 도구 타입(`ToolRegistration`, `ToolExecutionApi`, `ToolExecutionResult`, `ToolDiagnostic`)을 `src/upstream/tool-types.ts`로 뽑는다고 적었다.
이 패키지는 포크 본문을 도구 껍데기가 없는 평범한 함수로 바꿨고(P5~P7) 결과는 데이터로 돌려주므로 추출할 도구 타입이 없다. 그래서 `tool-types.ts`를 만들지 않았다.
Harness 확장 객체(`defineTool`)에 기대는 쪽이 원본 병합이 쉬워지는 장점은 있으나, durable 하네스 타입이 공용 계약처럼 보인다는 plan §2 마지막 문단의 우려와 맞바꿨다.

## 복사 범위(패치가 아니라 선택)

- `harness/output.ts`: `OutputBuffer`, `boundOutput`, `sanitizeOutput`, `characterEnd`와 그 의존만 둔다. `Progress`(진행 커밋 지연기, `Date.now()`와 타이머를 쓴다)는 뺐다. `PROGRESS_BYTES_PER_SECOND` 상수는 window 옵션에 필요해 남겼다.
- `env/decode.ts`: `rangeDecoder`, `startsWithBom`만 `src/files/upstream/decode.ts`에 둔다. `StreamDecoder`는 쓰지 않는다. `platform-exec`가 같은 파일을 포크로 갖고 있으나 구현 패키지를 import하지 않는 규칙(DR-02)에 따라 따로 복사했다.
- `truncate.ts`: `formatSize`는 M1이 쓰지 않아 뺐다(`noUnusedLocals`, knip). 쓰는 도구가 들어오는 M3(grep·find)에서 다시 가져온다. 이 줄 밖에서 `DEFAULT_MAX_LINES`는 export를 걷었다(안에서만 쓴다).
- `truncate.ts` 위치: 결정은 [미결]이다. `review.decisions-2` D-08은 `platform-exec`에 두라고 하지만 `platform-exec`에는 이 파일이 없고(`UPSTREAM.json`의 `notCopied`), F `ExecService`에도 절단 메서드가 없다. `L2.workspace.plan` §7 대체 위치 문장대로 여기에 두고, `platform-exec`가 소유하면 그때 한 번 옮긴다(복사본 두 개를 동시에 두지 않는다).

## 서식

`bun run fmt-check`(oxfmt, 공백 2칸, 100열)가 `src`와 `test` 전체를 검사하므로 복사한 뒤 포크 파일도 같은 서식으로 다시 찍었다. 원본은 탭 들여쓰기라 줄 단위 diff가 크다.
패치만 보려면 원본도 같은 설정으로 포맷해서 비교한다. 예: 원본을 임시 디렉터리에 복사해 `oxfmt -c ../../.oxfmtrc.json <디렉터리>`를 돌린 뒤 `diff -u`한다.

## 린트 예외 주석

포크 코드는 `.oxlintrc.json`의 규칙 일부(`no-await-in-loop`, `no-control-regex`)를 지킬 수 없다. 규칙을 끄지 않고 줄 단위 주석으로 표시한다.
형식: `// oxlint-disable-next-line <규칙> -- <이유> (eng.typescript.guide §1 포크 코드)`. 패치가 아니므로 `XEON-PATCH` 표지는 달지 않는다.
업스트림을 갱신할 때는 이 주석을 `oxlint` 출력에 맞춰 다시 만든다(`bun run lint`가 쓰이지 않은 주석도 실패시킨다).

## 확인 기록

- 2026-10-22 원본 대조: 로컬 사본(`~/projects/_ref/pi-src`)의 `HEAD`가 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`이고 복사한 7개 파일과 `LICENSE`의 sha256을 `UPSTREAM.json`에 적었다. 원격 대조는 하지 않았다(`platform-exec/PATCHES.md`의 2026-10-21 원격 대조는 같은 커밋이다).
- 이 작업 트리는 git 저장소가 아니라 커밋이 없다. `EX-01`의 '첫 커밋은 복사만 담는다' 규칙은 지키지 못했다.
