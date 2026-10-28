# platform-exec 포크 패치 기록

`src/upstream/`과 `test/upstream/`은 pi durable env의 포크다. 원본 저장소, 커밋, 복사 경로, 파일별 sha256은 `UPSTREAM.json`에 있다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// XEON-PATCH: <id>` 표지.
`test/fork-records.test.ts`가 이를 검사한다. 근거 문서는 `L0.exec.spec` §3.3, `L0.exec.plan` §4, `adr.0003` §3.4다.
고친 줄 위에 표지를 단다. 줄 번호는 원본(커밋 `cdaf6c2`, `packages/durable/`) 기준이다.

## 패치 표

| 패치 id | 파일:줄 | 바꾸는 점과 이유 | 확인 테스트 |
|---|---|---|---|
| P1 | `env/index.ts:1`, `env/node.ts:23`, `env/node-watch.ts:5`, `testing/env-conformance.ts:1` | Chord `import type { Context }`를 `import type { CancelScope as Context } from "@xeon/contracts/services"`로 바꾼다. 본문의 `context.abortSignal`과 `Context` 표기는 그대로다. Chord 제거(adr.0003 §3.1) | `tsc -b`(chord 미설치), `fork-records.test.ts`의 chord import 0건 검사 |
| P2 | `env/index.ts:3-17` | 자체 `Result`, `ok`, `err`를 지우고 F 루트(`@xeon/contracts`)에서 가져와 다시 export한다. `getOrThrow`, `getOrUndefined`, `toError`는 남긴다. 원본에 타입 인자를 직접 쓴 `ok<`, `err<` 호출은 없다 | 타입체크, 적합성 스위트 |
| P3 | `env/node.ts:76, 194, 224-258, 275, 805, 971`, `env/node-watch.ts:184, 294, 415, 512`, 시험 파일 | `process.platform` 분기 10곳을 `ExecPlatformProvider`(`src/provider.ts`) 질의로 바꾼다. `node.ts:226, 228, 278`의 `process.env` 읽기(Git Bash 후보, `SystemRoot`)와 `isLegacyWslBashPath`, `getBashShellConfig`, `killProcessTree`는 provider로 옮겼다. `NodeExecutionEnv` 생성 옵션에 필수 `platform`을 더하고 `NodeWatchOptions`에 `platform`을 더한다(생성자가 `watch`에서 `platform`을 빼고 받아 채운다). 같은 이유로 `resolvePath`, `runCommand`, `findBashOnPath`, `getShellConfig`는 `platform` 인자를 받고 `resolvePath(this.cwd, …)` 호출 줄(`node.ts:629, 645, 663, 897-1184`)과 `cleanup`(`:1222`)은 `this.platform`을 넘긴다. 시험 파일은 모든 `new NodeExecutionEnv({ … })`에 호스트 provider를 넘기고, `process.platform`을 가짜 `"win32"`로 바꾸던 두 시험(legacy WSL stdin 전송, taskkill spawn 오류)은 win32 provider를 주입한다 | `no-platform-branch.test.ts`, `providers.test.ts`, `select.test.ts`, 원본 시험 |
| P4 | `test/env-*.test.ts` 4파일, `test/env-truncate.test.ts` | `vitest`를 `bun:test`로 바꾼다. `vi.spyOn`은 `spyOn`, `vi.restoreAllMocks`는 `mock.restore`, `env-node-spill`의 `vi.hoisted` + `vi.mock("node:fs")`는 모듈 상단 상태 + `mock.module("node:fs", …)`로 옮기고 `afterAll`에서 원래 모듈로 되돌린다. Bun 차이 둘을 맞췄다: `fs/promises.access()`가 `undefined` 대신 `null`을 이행하므로 `toBeFalsy()`로 확인하고, `toMatchObject`가 비대칭 매처가 붙은 받은 객체의 속성을 매처로 바꾸므로 `spillPath`를 먼저 읽는다. 파일 이름을 TS-01 태그에 맞춰 `.int.test.ts`로 바꾼다 | 포팅한 4파일 통과 |
| P5 | `testing/env-conformance.ts:2, 14, 23, 462`, `test/env-node.test.ts:7`, `test/env-node-conformance.test.ts:5`, `test/env-node-spill.test.ts:5` | `BACKGROUND_CONTEXT`를 `{ abortSignal: undefined }` 상수로, `withAbortSignal(signal, ctx)`를 `{ abortSignal: signal }` 직접 조합으로 바꾼다 | 적합성 스위트 |
| P6 | `env/index.ts:34-74` | `FileError`, `ExecutionError` 클래스와 코드 유니온 선언을 지우고 F(`@xeon/contracts/services`)에서 다시 export한다. 같은 클래스여야 `instanceof`(`node.ts:119`, `node-watch.ts:271`)와 L2 도구 본문의 판정이 맞는다. 원본 인터페이스 선언(`index.ts:76-324`)은 지우지 않는다 | 타입체크, `exec-contract.contract.test.ts`, `env-node.int.test.ts` |
| P7 | (예약) | `L0.exec.plan` R-4의 쓰기 스트림 팩토리 후보 번호. Bun `mock.module`이 `node:fs`를 바꾸는 것을 확인해 쓰지 않았다 | |
| P8 | `env/line-scan.ts:35`, `env/node.ts:607-608`, `test/env-node.test.ts:626`, `test/env-line-scan.test.ts:91, 95` | 엄격 컴파일 옵션 호환. `isolatedDeclarations`가 요구하는 `endLine: number` 명시, `exactOptionalPropertyTypes`에서 대입이 막힌 두 필드를 `string \| undefined`, `NodeJS.ProcessEnv \| undefined`로 선언, 시험의 `{ env: undefined }` 옵션을 `undefined`로 바꾸고 `toBe(lines[i])`의 `string | undefined`를 `?? ""`로 좁힌다(Bun `toBe`의 엄격한 타입). 동작은 같다. 명세 패치 표(P1~P6)에 없던 변경이다 | `tsc -b` |
| P9 | `env/line-scan.ts:2` | `LineScan` 타입을 `./index.ts` 대신 F(`@xeon/contracts/services`)에서 가져온다. `index.ts`가 `LineScanner`를 다시 export하므로 `index.ts` ↔ `line-scan.ts` 순환이 생겨 dependency-cruiser `no-circular`(DR-06)가 실패한다. F의 `LineScan`은 같은 모양이다 | `exec-contract.contract.test.ts`, `depcruise` |
| P10 | `truncate.ts:46-83` | `utf8ByteLength`의 `globalThis.Buffer` 존재 검사, `RuntimeBuffer` 형변환, 순수 JS 대체 계산을 지우고 `Buffer.byteLength(content, "utf8")` 하나로 둔다. Bun만 대상이고 대체 계산은 형변환 단언(`as { Buffer?: RuntimeBuffer }`)과 제어 문자 정규식을 요구한다. 대체 계산을 시험하던 `env-truncate.test.ts`의 Buffer 없는 런타임 시험도 뺐다. 내부 함수라 export하지 않는다 | `test/upstream/truncate.test.ts` |
| P11 | `truncate.ts:151, 174` | `noUncheckedIndexedAccess`에 맞춰 `lines[0]`, `lines[i]`에 `?? ""`를 붙인다. 동작은 같다 | `test/upstream/truncate.test.ts` |
| P12 | `truncate.ts:11-12` | `isolatedDeclarations`가 요구하는 상수 타입 주석(`DEFAULT_MAX_LINES: number`)을 달고 export를 걷는다. 파일 안에서만 쓴다(knip). 한도 기본값은 `truncateHead` 결과의 `maxLines`·`maxBytes`로 노출된다 | `tsc -b`, `test/upstream/truncate.test.ts` |
| P13 | `truncate.ts:14-50` | `TruncationResult`, `TruncationOptions` 선언을 지우고 F(`@xeon/contracts/services`, `services/exec.ts`)에서 가져온다. F 선언은 같은 필드에 `readonly`를 더한 모양이라 L1·L2가 같은 타입으로 받는다 | `tsc -b`, `exec-contract.contract.test.ts` |
| P14 | `env/index.ts:18-45`, `env/node.ts`(`fileURLToPath`, `pathExists`, `runCommand`, `LineScanner` 생성, `close` 호출 12곳), `env/node-watch.ts`(`#deliver`, `lstat`·`statfs` 조회 5곳), `testing/assertions.ts:3-19`, 시험 파일(`env-node.int.test.ts`, `env-node-conformance.int.test.ts`, `env-node-spill.int.test.ts`) | `eng.typescript.guide` TY-06·TY-25 적용. 바인딩 없는 `catch {}`와 `.catch(() => undefined)`를 `attempt`/`attemptAsync`(F) 결과 값으로 바꾸고, 정리 단계의 `close`는 `closeBestEffort`, 조회 실패를 `undefined`로 보는 자리는 `valueOrUndefined`(둘 다 `env/index.ts`)로 모았다. `toFileError`의 `switch`에 `default`를 더하고, `ExpectLike`가 `ExpectResult`를 돌려주게 해 `as ExpectResult`를 지웠다. 시험의 `as` 단언은 타입 가드(`isFileHandle`, `errnoCodeOf`), `Object.defineProperty`, 결과 좁히기로 바꿨다. 동작은 같다 | `tsc -b`, `bun run lint`, 원본 시험 |
| P15 | `env/node.ts`(`abortResult`, `getShellConfig`, `waitForChildProcess`, `exec`, 읽기 도구 `NodeTextLineReader`·`NodeBinaryReader`·`NodeDirReader`, `readTextLines`, `listDir`, `createTempDir`, `absolutePath`, `joinPath`, `cleanup`), `env/node-watch.ts`(`#flush`, `#sync`, `#scan`, `anyUnreliable`, `fsWatch` 콜백), `env/line-scan.ts`(`push`, `#feed`), `env/index.ts`(`getOrThrow`), `testing/types.ts`(`run`), `testing/env-conformance.ts`, 시험 파일 3개(`env-node.int.test.ts`, `env-node-conformance.int.test.ts`, `env-node-spill.int.test.ts`) | `eng.typescript.guide` §1 포크 코드 절과 TY-22를 적용해 린트 억제 주석을 모두 걷는다. 포크 코드에 `oxlint-disable`이 남지 않는다. (1) `no-await-in-loop` 반복문(파일 조각 읽기, 디렉터리 항목 읽기, 감시 스냅샷, 셸 후보 확인)은 `@xeon/contracts`의 `repeatAsync`·`eachAsync`로 옮긴다. 반복 한 번이 `{ value }`로 끝을 알리고, 순차 await는 그 두 함수 안의 예외 한 곳에 모았다. (2) `abortResult<T>`는 `Result<never, FileError>`를 돌려주어 타입 인자를 지운다. (3) `async`인데 await가 없던 `absolutePath`, `joinPath`, `cleanup`은 `Promise.resolve`로 돌려준다. (4) `resolve` 이름 충돌은 `node:path`의 `resolve`를 `resolveAbsolute`로 바꾸고 Promise 매개변수를 `resolve`로 통일한다. `finishSpill`의 `Promise`는 `waitForStreamFinish`로 뺀다. (5) 매개변수 재대입(`chunk`, `from`, `report`, `prefix`)은 지역 변수로 받는다. (6) 비null 단언(`chunks[0]!`), `switch (nodeError.code)`의 `undefined`, `prefer-const`(`armTimeout`), `.then()` 반환(`onChildExit`), `??`가 불필요한 `osConstants.signals`(`signalNumber`)를 고친다. (7) 시험 지원 코드: `run`을 속성 시그니처로, `expectChange`·`absolute`도 같게 하고(`unbound-method`), `getOrThrow`의 오류 타입을 `Error`로 좁히며(`only-throw-error`), `execCollect`를 모듈 함수로 옮기고 `.sort()`를 `.toSorted()`로 바꾼다. (8) 시험에서 `await expect(...).resolves`는 값을 직접 await하고, `stream._write` 접근은 `Reflect.get`·`Object.defineProperty`로 하며(Node가 구현자에게 여는 훅), `mock.module`은 await한다. 동작은 같다 | `tsc -b`, `bun run lint`, 원본 시험과 적합성 스위트 |
| P16 | `env/index.ts`(`closeBestEffort`), `env/node.ts`(`NodeExecutionEnv` 생성 옵션 `logger`, `NodeTextLineReader`·`NodeBinaryReader`·`NodeDirReader` 생성자, `closeBestEffort` 호출 10곳), `env/node-watch.ts`(`NodeWatchOptions.logger`, `#deliver`) | `review.open-issues` N-10. 정리 단계 `close` 실패와 감시 콜백 예외를 값으로 받은 뒤 버리지 않고 Logger에 남긴다. 옵션 `logger`는 선택이고 없으면 기록하지 않는다. 남기는 사건은 `exec.close_failed`(warn)와 `exec.watch_callback_failed`(error)다. 감시 계속과 원래 결과 보존은 그대로다 | `test/close-logging.int.test.ts`, 원본 시험 |
| P17 | `env/node.ts`(`resolvePath`, `getShellConfig`) | `startBackground`(`src/background.ts`, `src/service.ts`)가 포크 `exec`와 같은 셸 선택과 `~` 경로 해석을 쓰도록 두 함수에 `export`만 더한다. 동작은 같다 | `test/background.int.test.ts` |
| P18 | `env/node.ts`(`exec`의 `waitForChildProcess` 연결), `env/node-watch.ts`(`#schedulePoll`, `#scheduleFlush`, `#scheduleSettle`, `#logFlushFailure`) | `eng.typescript.guide` TY-22와 스캔 `xeon/no-void-promise` 적용. `void <호출식>`으로 버리던 Promise를 `detach`(F)에 넘기고 실패는 Logger에 남긴다. 옵션 `logger`가 없으면 기록하지 않는다. 남기는 사건은 `exec.child_exit_failed`(error)와 `exec.watch_flush_failed`(error)다. `onChildExit`가 던지면 실행을 `spawn_error`로 정착시켜 호출자가 영영 기다리지 않게 한다. 정상 경로의 동작은 같다 | `tsc -b`, 원본 시험 |
| P19 | `env/node.ts`(`NodeExecutionEnv` 생성 옵션 `tempRoot`, `createTempDir`, `createTempFile`) | 임시 디렉터리와 spill 파일 위치. 옵션 `tempRoot`가 있으면 `createTempDir`이 그 디렉터리(없으면 0700으로 만든다) 아래에 `mkdtemp`하고, 없으면 원본대로 OS 임시 폴더를 쓴다. `createTempFile`은 파일을 0600으로 만든다. 평문 출력 spill이 OS 임시 폴더(다른 사용자가 읽을 수 있는 위치, 재부팅 정책에 맡김)에 남던 것을 상태 디렉터리 아래 소유자 전용으로 옮긴다 | `test/spill-dir.int.test.ts` |

## 서식

`bun run fmt-check`(oxfmt, 공백 2칸, 100열)가 `src`와 `test` 전체를 검사하므로 복사한 뒤 포크 파일도 같은 서식으로 다시 찍었다. 원본은 탭 들여쓰기라 줄 단위 diff가 크다.
패치만 보려면 원본도 같은 설정으로 포맷해서 비교한다. 예: 원본을 임시 디렉터리에 복사해 `oxfmt -c ../../.oxfmtrc.json <디렉터리>`를 돌린 뒤 `diff -u`한다.
EX-01의 '첫 커밋은 복사만 담는다' 규칙은 지키지 못했다. 이 작업 트리는 git 저장소가 아니라 커밋이 없고, 서식 변경과 패치가 한 번에 들어갔다. 원본 sha256은 `UPSTREAM.json`의 `originalSha256`에 있다.

## 복사 범위(패치가 아니라 선택)

- `src/testing/types.ts`: env 관련 선언만 둔다. `Storage`를 import하는 `StorageConformanceProvider`, `StorageConformanceOptions`, `StorageConformanceCase`를 뺐다. `StorageConformanceAssertions`는 env 적합성이 쓰는 단언 모양이라 남겼다.
- `src/testing/runner.ts`: `registerEnvConformance`만 둔다. `registerStorageConformance`와 그 import를 뺐다.
- 복사하지 않은 파일은 `UPSTREAM.json`의 `notCopied`가 정본이다.

## 린트 예외 주석

포크 코드에는 `oxlint-disable` 주석을 두지 않는다. `eng.typescript.guide` §1은 업스트림 병합 비용을 억제 주석의 사유로 인정하지 않는다. 린트가 걸리는 줄은 P15처럼 고쳐 쓰고 `XEON-PATCH` 표지를 단다.
고칠 수 없는 줄이 생기면 주석으로 넘기지 말고 `[미결] TY-NN <파일:줄> <이유>`로 `review.open-issues`에 적는다. `just check-ts-rules`의 `xeon/directive-format`이 "업스트림 모양"·"포크 모양"을 이유로 든 억제 주석을 실패시킨다.
업스트림을 갱신하면 새 원본에서 같은 린트 오류가 다시 생긴다. `bun run lint` 출력에 맞춰 P15를 다시 적용한다.

## 확인 기록

- 2026-10-21 원본 대조(R-7): `git ls-remote`는 브랜치·태그만 찾으므로 커밋 존재 확인에 쓰지 못했다. GitHub API로 `cdaf6c2…`가 존재하고 커밋 시각이 2026-10-11임을 확인했고, 복사한 13개 파일과 `LICENSE`의 내용을 `raw.githubusercontent.com`의 같은 커밋 파일과 sha256으로 대조해 모두 같았다. 로컬 사본(`~/projects/_ref/pi-src`) 줄 번호가 GitHub와 같다.
- 2026-10-21 EX-10 Bun 동작 스파이크(위험 R-1): Bun 1.4.3, Linux(WSL2)에서 `test/process-group.int.test.ts`가 통과했다. `spawn(detached: true)`와 `process.kill(-pid, "SIGKILL")`로 abort, 시간 초과, `cleanup` 모두 손자 `sleep`까지 끝났다(그룹 프로세스 0개). macOS는 확인하지 않았다(CI 필요).
- 2026-10-21 R-4: Bun `mock.module("node:fs", …)`가 `node.ts`의 `createWriteStream` named import를 실제로 바꾼다(시험이 `rejectedWrites > 0`을 단언한다). 파일 간 누수를 막으려고 `afterAll`에서 원래 모듈로 되돌린다. `bun test --isolate` 없이 패키지 전체 실행에서 통과했다.
- 환경 주의: 이 개발 환경(WSL2)은 벽시계(`Date.now()`)가 한 번에 수 초 앞뒤로 튄다. 원본 적합성의 watch 사례가 `Date.now()` 기준 3초 대기선을 쓰므로 가끔 `No change reported …`로 실패한다. 코드 결함이 아니라 환경 문제이고 재실행하면 통과한다.
