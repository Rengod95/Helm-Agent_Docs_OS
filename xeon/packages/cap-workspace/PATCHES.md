# cap-workspace 포크 패치 기록

`src/**/upstream/`과 `src/upstream/`은 pi의 포크다(durable 도구 5개와 출력 한도 함수, 이미지 형식 판별 2개, 편집 일치 함수 1개(`edit-diff`), coding-agent `ls`). 원본 저장소, 커밋, 복사 경로, 파일별 sha256은 `UPSTREAM.json`에 있다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// XEON-PATCH: <id>` 표지.
`test/fork-records.test.ts`가 이를 검사한다. 근거 문서는 `L2.workspace.plan` §2, `adr.0003` §3.4다.
고친 줄 위에 표지를 단다. 줄 번호는 원본(커밋 `cdaf6c2`, `packages/durable/` 또는 `packages/coding-agent/`) 기준이다.

## 패치 표

| 패치 id | 파일:줄 | 바꾸는 점과 이유 | 확인 테스트 |
|---|---|---|---|
| P1 | `tools/read.ts:1`, `tools/path-utils.ts:1`, `tools/bash.ts:1` | Chord `import type { Context }`를 `import type { CancelScope as Context } from "@xeon/contracts/services"`로 바꾼다. 본문의 `context.abortSignal`과 `Context` 표기는 그대로다. Chord 제거(adr.0003 §3.1) | `tsc -b`(chord 미설치), `fork-records.test.ts`의 chord import 0건 검사 |
| P2 | `tools/read.ts:3-22`, `tools/path-utils.ts:2`, `tools/bash.ts:3-6`, `ls.ts`(가져오기 줄), `harness/output.ts:1-2` | 구현 패키지와 durable 내부 모듈을 가리키던 import를 이 패키지 안의 같은 동작으로 바꾼다. `getOrThrow`는 `src/upstream/get-or-throw.ts`(F `Result` 위), `utf8ByteLength`는 `src/upstream/output.ts`(P3), 절단 함수는 platform-exec의 `xeon.exec`(`ExecService.truncateHeadOf`)로 부른다, `ShellOutputSkip`은 F, `characterEnd`·`OutputBuffer`는 `src/upstream/output.ts`. `platform-exec`를 import하지 않는다(DR-02) | `tsc -b`, `depcruise` |
| P3 | `harness/output.ts:2` | `utf8ByteLength`를 `truncate.ts`에서 가져오던 import를 `src/upstream/output.ts` 안의 함수로 바꾼다. 본문은 `Buffer.byteLength(content, "utf8")` 하나이고, `globalThis.Buffer` 존재 검사와 순수 JS 대체 계산(형변환 단언과 제어 문자 정규식을 요구)은 두지 않는다. `truncate.ts` 자체는 platform-exec로 옮겼다(B-04). `read.ts`, `ls.ts`도 이 함수를 쓴다 | `output.test.ts` |
| P4 | `harness/output.ts:194`, `harness/output.ts:208`, `harness/output.ts:250` | `noUncheckedIndexedAccess`와 비null 단언 금지에 맞춘다: `this.#chunks[0]!`는 undefined 검사, 함수 `lines`는 지역 변수 `lines`를 가리지 않도록 `lineTotal`로 이름을 바꾼다(`no-shadow`). 동작은 같다 | `output.test.ts` |
| P5 | `tools/read.ts` 전체 | `createReadTool`의 `execute`에서 도구 껍데기(`defineTool`, `ToolExecutionApi`, `requireEnv`, 진단 메시지, 이미지 분기)를 걷어 내 `readFileText(env, absolutePath, offset, limit, limits, context)`로 만든다. 한도는 상수가 아니라 설정에서 받는다. 결과는 `ReadSlice`(텍스트, 줄 번호, 전체 줄 수, 한도에 걸린 쪽)이고 `ReadOutput`으로 바꾸는 일은 `truncate/paging.ts`가 한다. 앞 8KB에 NUL이 있으면 `binary`를 돌려준다(spec §5 2번). offset 오류는 던지지 않고 `beyond_end`로 돌려준다. 전체 줄 수는 빈 파일 0, 끝 줄바꿈은 줄을 더하지 않는 값이다. offset·limit은 1 이상 정수라서 음수·소수 처리를 지웠다. 파일이 읽는 동안 두 번 바뀌면 `Error` 대신 `WorkspaceFailure("unavailable")`다. 이미지 분기는 M2(`workspace.images`, W7)에서 더한다 | `read.test.ts`, `paging.test.ts` |
| P6 | `tools/bash.ts` 전체 | `createBashTool`/`runCommand`에서 도구 껍데기(`defineTool`, `ToolExecutionApi`, `commandPrefix`, `prepare`, PowerShell, 진단)를 걷어 내 `runBashCommand(shell, run, limits, context)`로 만든다. `api.output()`/`retainedOutput()`/`outputWindow` 자리에는 같은 `OutputBuffer`(꼬리 보관)와 같은 window(`minIntervalMs` 100, 100KiB/s)를 직접 쓴다. 성공과 실패를 `Result`로 돌려주고 실패에도 그때까지의 출력을 싣는다. 타임아웃 오류 문구는 서비스 경계(`shell/run.ts`)가 만든다. 샌드박스 래핑은 호출자가 `Shell`에 입힌다. 시간 초과·취소를 `Error`로 바꾸던 부분은 지웠다 | `shell.test.ts` |
| P7 | `ls.ts` 전체 | `createLsToolDefinition`에서 도구 껍데기(`ToolDefinition`, 렌더러, `LsOperations`)와 `node:fs` 직접 호출을 걷어 내 `listDirectory(env, absolutePath, limit, context)`로 만든다. `ExecutionEnv.listDir`를 쓰고 종류는 `FileInfo.kind`(심볼릭 링크는 `symlink`)다. 정렬은 `localeCompare`(대소문자 무시)가 아니라 UTF-8 바이트 순이다(plan §2). 항목 수 한도 뒤 바이트 한도(50KB, `truncate.ts`의 `DEFAULT_MAX_BYTES`를 쓰던 자리라 파일 안 상수 `DEFAULT_MAX_BYTES: number`로 둔다)를 적용하고 어느 쪽이 걸렸는지 돌려준다. 빈 디렉터리 문구와 안내 문장은 서비스 출력(`ListOutput`)과 `renderList`가 맡는다 | `list.test.ts` |
| P8 | `tools/path-utils.ts:7`, `tools/path-utils.ts:12` | `normalizeToolPath`를 export하고(`src/roots.ts`가 `..` 마디 검사에 쓴다), 함수가 받는 env를 `Pick<ExecutionEnv, "absolutePath" \| "exists">`로 좁힌다. 탈출 검사는 넣지 않는다(plan §2 표) | `roots.test.ts` |
| P9 | `harness/output.ts:261` | `isolatedDeclarations`가 요구하는 export 상수 타입 주석을 단다 | `tsc -b` |
| P10 | `files/upstream/path-utils.ts`(`resolveReadToolPath`), `files/upstream/read.ts`(`readHead`, `readFileText`), `upstream/output.ts`(`sanitizeOutput`) | `eng.typescript.guide` §1 포크 코드 절과 TY-22를 적용해 린트 억제 주석을 모두 걷는다. `no-await-in-loop` 반복문 세 곳(읽기 경로 후보 확인, 머리 조각 읽기, 읽는 동안 파일이 바뀌었는지 보는 재시도)은 `@xeon/contracts`의 `eachAsync`·`repeatAsync`로 옮긴다. `no-control-regex`가 걸린 `INVALID_OUTPUT` 정규식은 UTF-16 코드 단위를 검사하는 `isInvalidOutputUnit`으로 바꾼다. 검사 범위는 같다: U+0000..U+0008, U+000B..U+001F, U+FFF9..U+FFFB. 동작은 같다 | `tsc -b`, `bun run lint`, `test/output.test.ts`, `test/read.test.ts` |
| P11 | `tools/image.ts` 전체 | `eng.typescript.guide` TY-22와 비null 단언 금지에 맞춘다. `isAnimatedPngOf`의 `no-await-in-loop` 반복문을 `@xeon/contracts`의 `repeatAsync`로 옮긴다(조각 검사 순서와 반환값은 같다). `imageDimensions`의 JPEG 조각 표지 읽기 `bytes[offset + 1]!`를 `?? 0`으로 바꾸고, `imageDimensions`의 문자열 `switch`를 `if` 연쇄로 바꾼다(`oxlint default-case`는 `default`를 요구하고 `check-ts-rules` TY-14는 `default`가 `assertNever`를 부르길 요구하는데, 이 `switch`는 열린 문자열이라 `assertNever`를 부를 수 없다. 분기 내용과 순서는 같다). 표지 바이트가 0이면 SOF 범위(0xC0..0xCF) 밖이라 다음 조각으로 넘어가는 동작은 같다. 나머지는 원본 그대로다: `detectSupportedImageMimeType`, `detectSupportedImageMimeTypeOf`, `imageDimensions`, `ByteSource` | `images.test.ts`, `tsc -b` |
| P12 | `tools/image-processor.ts` 전체 | 처리기 없는 최소형(plan W7 M2)에 필요한 것만 남긴다: `INLINE_IMAGE_TYPES`, `base64Length`. 한도 기본값은 설정 키(`l2.workspace.images.*`)가 갖고 `ImageLimits`는 F `@xeon/contracts/capabilities`의 것을 쓰므로 `DEFAULT_IMAGE_LIMITS`도 뺀다. `ImageProcessor`, `PreparedImage`, `toBase64`는 처리기가 들어오는 2차에 가져온다(쓰는 곳이 없으면 knip이 막는다) | `images.test.ts` |
| P13 | `tools/edit-diff.ts:5`, `:365-500` | `import * as Diff from "diff"`를 뺀다. `generateUnifiedPatch`, `generateDiffString`을 지운다. 새 의존을 더하지 않는다. diff 생성은 `src/files/diff.ts`(새 원본, 아래 절)가 한다 | `package.json`에 `diff`를 넣지 않는다(의존 추가 금지), `fork-records.test.ts`(패치 표지 집합) |
| P14 | `tools/edit-diff.ts:192-195`, `:254-290`, `:301-363`, `:347-349` | 실패를 던지지 않고 값으로 돌려준다. `applyEditsToNormalizedContent`를 `applyEdits(content, edits, { fuzzy })`로 바꾸고 `Result<AppliedEdits, EditFailure>`를 준다. `EditFailure.kind`는 `empty_old_text`, `not_found`, `ambiguous`, `overlap`, `no_change`다. 오류 문구는 원본을 따르되 ` in ${path}` 조각은 뺐다(함수가 경로를 받지 않는다). `overlap`의 `editIndex`는 앞 편집 번호, `no_change`는 0이다. `AppliedEdits`에 `matchMode`를 더했다(`AppliedEditsResult` 대체) | `edit-diff.test.ts`(E12~E16과 E1·E2 왕복) |
| P15 | `tools/edit-diff.ts:92-94`, `:100-102`, `:135-137` | 불변 조건 위반(바깥 구간, 줄 수 불일치, 줄 번호 범위 밖)은 `Result`가 아니라 `Bug`로 던진다(TY-24). 입력이 잘못돼도 생기지 않으므로 예상 가능한 실패가 아니다. `lineAt`을 더해 줄 범위 밖 접근을 `Bug`로 막는다 | `edit-diff.test.ts`(E10이 `applyReplacementsPreservingUnchangedLines`를 지난다. Bug 경로는 올바른 입력으로 닿지 않는다), `just check-ts-rules` |
| P16 | `tools/edit-diff.ts:203-241`, `:248-252` | 설정 `l2.workspace.edit.fuzzy`(E17)를 옵션 `fuzzy`로 받는다. `fuzzy: false`면 퍼지 공간을 만들지 않고 정확 일치만 본다. 정확 일치 실패는 `not_found`에 `fuzzyDisabled: true`를 붙인다. 중복 검사도 정확 공간에서 센다(같은 공간에서 찾은 자리를 세야 하므로). `fuzzy: true`일 때는 원본처럼 퍼지 공간에서 센다 | `edit fuzzy can be disabled` |
| P17 | `tools/edit-diff.ts:85-88`, `:107-116`, `:139-158`, `:311-351` | `noUncheckedIndexedAccess`와 비null 단언 금지에 맞춘다. `lines[i]` 검색은 `findIndex`, `replacements[i]` 역순 순회는 `toReversed()`, `groups[len-1]`은 `at(-1)`, `baseLines[i]`는 `lineAt`, `matchedEdits[i-1]` 비교는 다음 편집 undefined 검사로 바꾼다. 순서와 결과는 같다 | `oxlint --type-aware`(이 파일들), `tsc -b` |
| P18 | `tools/edit-diff.ts:30`, `:128`, `:171`, `:203` | 내보내기를 줄인다. `normalizeForFuzzyMatch`, `applyReplacementsPreservingUnchangedLines`, `FuzzyMatchResult`, `fuzzyFindText`는 이 파일 안에서만 쓰므로 내보내지 않는다(knip이 미사용 내보내기를 막는다). 내보내는 것은 `detectLineEnding`, `normalizeToLF`, `restoreLineEndings`, `stripBom`, `Edit`, `applyEdits`, `AppliedEdits`, `EditFailure`다 | `just knip` |

## W2와의 차이

`L2.workspace.plan` W2는 `harness/types.ts`·`define.ts`에서 도구 타입(`ToolRegistration`, `ToolExecutionApi`, `ToolExecutionResult`, `ToolDiagnostic`)을 `src/upstream/tool-types.ts`로 뽑는다고 적었다.
이 패키지는 포크 본문을 도구 껍데기가 없는 평범한 함수로 바꿨고(P5~P7) 결과는 데이터로 돌려주므로 추출할 도구 타입이 없다. 그래서 `tool-types.ts`를 만들지 않았다.
Harness 확장 객체(`defineTool`)에 기대는 쪽이 원본 병합이 쉬워지는 장점은 있으나, durable 하네스 타입이 공용 계약처럼 보인다는 plan §2 마지막 문단의 우려와 맞바꿨다.

## 복사 범위(패치가 아니라 선택)

- `harness/output.ts`: `OutputBuffer`, `boundOutput`, `sanitizeOutput`, `characterEnd`와 그 의존만 둔다. `Progress`(진행 커밋 지연기, `Date.now()`와 타이머를 쓴다)는 뺐다. `PROGRESS_BYTES_PER_SECOND` 상수는 window 옵션에 필요해 남겼다.
- `env/decode.ts`: `rangeDecoder`, `startsWithBom`만 `src/files/upstream/decode.ts`에 둔다. `StreamDecoder`는 쓰지 않는다. `platform-exec`가 같은 파일을 포크로 갖고 있으나 구현 패키지를 import하지 않는 규칙(DR-02)에 따라 따로 복사했다.
- `truncate.ts`: 이 패키지에 두지 않는다. 구현은 `platform-exec`의 포크(`src/upstream/truncate.ts`)이고 `ExecService.truncateHeadOf`·`truncateHead`·`formatSize`로 부른다(`review.decisions-2` D-08, B-04). `read.ts`가 앞부분과 전체 합계로 `truncateHeadOf`를 부른다. 이 패키지의 사본(`src/truncate/upstream/`)은 지웠다.

## 새 원본(포크 아님)

`src/files/diff.ts`는 pi 원본이 아니라 이 패키지의 새 코드다(`UPSTREAM.json`에 없다). `buildFileChange`가 `FileChange`(F `@xeon/contracts/capabilities`)를 만든다.
L2.workspace.spec §4.4의 결정대로 외부 라이브러리를 쓰지 않는다. 알고리즘은 다음과 같다.

- 앞뒤 공통 줄을 먼저 떼고 가운데만 LCS로 비교한다.
- 가운데 칸 수(삭제 줄 × 추가 줄)가 4,000,000을 넘으면 LCS를 만들지 않고 삭제 한 덩어리와 추가 한 덩어리로 낸다.
- 문맥은 3줄이다. 사이에 낀 같은 줄이 6줄 이하인 변경은 한 덩어리(hunk)로 합친다.
- 한 줄짜리 구간은 `,1`을 생략하고(통합 diff 관례), 줄바꿈이 없는 끝 줄은 `\ No newline at end of file`를 붙인다.
- `firstChangedLine`은 새 파일 기준이다. 삭제만 있으면 삭제 자리 바로 뒤 줄 번호다(파일 끝이면 줄 수 + 1).

## 서식

`bun run fmt-check`(oxfmt, 공백 2칸, 100열)가 `src`와 `test` 전체를 검사하므로 복사한 뒤 포크 파일도 같은 서식으로 다시 찍었다. 원본은 탭 들여쓰기라 줄 단위 diff가 크다.
패치만 보려면 원본도 같은 설정으로 포맷해서 비교한다. 예: 원본을 임시 디렉터리에 복사해 `oxfmt -c ../../.oxfmtrc.json <디렉터리>`를 돌린 뒤 `diff -u`한다.

## 린트 예외 주석

포크 코드에는 `oxlint-disable` 주석을 두지 않는다. `eng.typescript.guide` §1은 업스트림 병합 비용을 억제 주석의 사유로 인정하지 않는다. 린트가 걸리는 줄은 P10처럼 고쳐 쓰고 `XEON-PATCH` 표지를 단다.
고칠 수 없는 줄이 생기면 주석으로 넘기지 말고 `[미결] TY-NN <파일:줄> <이유>`로 `review.open-issues`에 적는다. 업스트림을 갱신하면 새 원본에서 같은 린트 오류가 다시 생기므로 `bun run lint` 출력에 맞춰 P10을 다시 적용한다.

## 확인 기록

- 2026-10-22 원본 대조: 로컬 사본(`~/projects/_ref/pi-src`)의 `HEAD`가 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`이고 복사한 7개 파일과 `LICENSE`의 sha256을 `UPSTREAM.json`에 적었다. 원격 대조는 하지 않았다(`platform-exec/PATCHES.md`의 2026-10-21 원격 대조는 같은 커밋이다).
- 이 작업 트리는 git 저장소가 아니라 커밋이 없다. `EX-01`의 '첫 커밋은 복사만 담는다' 규칙은 지키지 못했다.
