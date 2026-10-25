---
id: eng.testing.guide
layer: eng
domain: testing
kind: guide
status: draft
depends_on: [eng.toolchain.guide, eng.events.design]
binds: [xeon/**/*.test.ts, xeon/**/test/**, xeon/packages/*/src/testing/**]
---

# 테스트 가이드

Xeon 코드의 테스트를 어떻게 쓰고, 어디에 두고, 어떻게 돌리는지 정한다. 규칙마다 ID(`TS-NN`)를 붙인다. 테스트 실행기와 `just verify` 순서는 `eng.toolchain.guide`가, 테스트 전용 모듈의 import 규칙은 `eng.dependency-rules.guide` DR-08이 정한다. 이벤트·투영·재생의 의미는 `eng.events.design`, 트랜잭션 단계는 `eng.transactions.design`이 소유한다. 이 문서는 그 규칙을 시험하는 방법만 정한다.

## 1. 적용 범위

- 대상: `xeon/packages/*`, `xeon/apps/*`, `xeon/plugins/*`, `xeon/scripts/`의 모든 테스트 파일(`*.test.ts`, `test/**`)과 패키지의 `testing` 서브패스(`src/testing/**`).
- 대상 작업: 테스트 작성, 가짜 구현 작성, 모델 테이프 작성·녹화, 커버리지 임계 변경, CI 테스트 job 변경.

### 1.1 기본 방침

[결정] `_research/foundation-plan.md §2` 테스트 행, §5 P3·P4, §4 문서 구조의 testing 항목.

- 단위 테스트를 먼저 쓴다. 각 패키지는 자기 단위 테스트를 함께 둔다.
- 통합 테스트는 최소로 둔다. 여러 패키지를 함께 띄우는 통합 테스트는 모델 테이프 기반 스모크 1개만 둔다.
- 모델은 테이프 가짜로 대신한다. 테스트는 실제 모델과 네트워크를 쓰지 않는다.
- 테스트 실행기는 `bun test`다. 패키지마다 따로 돈다. CI는 층별 job으로 돈다.
- 로컬 실행은 `just test`다. `xeon/scripts/test-capped.sh`가 패키지를 하나씩 저장소 루트 `scripts/guard.sh run`의 메모리 상한 아래에서 돌려, 메모리를 과하게 쓰는 테스트는 그 패키지 실행만 끝낸다. 끝 줄에 건너뛴 시험 수를 적는다. 한 패키지만 돌릴 때는 `just test packages/<이름>`을 쓴다(`eng.toolchain.guide` 3.1절 8행).
- Vitest는 쓰지 않는다. Vitest는 Node 위에서 돌아 `bun:sqlite`를 쓰는 테스트를 실행하지 못한다.

### 1.2 패키지별 테스트 도우미

[제안] 공용 가짜와 도우미는 그 인터페이스를 구현한 L0 이상 패키지의 `testing` 서브패스가 제공한다. 순위 규칙(DR-01)은 `testing` 서브패스에도 적용된다.

[결정: review.decisions-2 U-03] F(`contracts`)에는 `testing` 서브패스가 없다. F 인터페이스(`Clock`, `Scheduler`, `RandomSource`, `IdFactory`)의 테스트 대역 `manualClock`, `seededRandom`, `fixedIdFactory`는 각 패키지 `test/support/` 안에 둔다. 시그니처는 TS-03의 코드 블록을 따르고, 같은 시그니처를 쓰는 패키지끼리 동작이 같은지는 `L0.os.spec`의 Clock·Scheduler 계약 테스트 묶음으로 확인한다.

| 서브패스 | 층 | 제공하는 것 | 근거 규칙 |
|---|---|---|---|
| 각 패키지 `test/support/` | 전 층 | `manualClock`, `fixedIdFactory`, `seededRandom`. 런타임 중립(`node:*`, `bun:*` 없음) | TS-03, TS-09 |
| `@xeon/contracts/records` | F | 고장 주입 타입 `FaultPoint`, `FaultInjector`(운영 타입, 정본은 `eng.transactions.design` 4.2절) | TS-07, TS-08 |
| `@xeon/platform-os/testing` | L0 | `tempDir`, `withIsolatedEnv` | TS-03 |
| `@xeon/platform-exec/testing` | L0 | `fakeExec`(명령별 응답 표) | TS-05 |
| `@xeon/platform-secrets/testing` | L0 | `memorySecrets`(가짜 값 저장소) | TS-05 |
| `@xeon/platform-store/testing` | L0 | `openTestStore`(실제 `bun:sqlite`, `:memory:` 또는 임시 파일), 고장 주입 옵션(F `FaultInjector`를 받는다) | TS-07, TS-08 |
| `@xeon/core-persistence/testing` | L1 | `normalizeEvents`, `eventDigest`, `expectProjectionsRebuildable` [제안]. L1 아래 층 테스트는 같은 함수를 자기 `test/support/`에 둔다 | TS-02, TS-08 |
| `@xeon/core-models/testing` | L1 | 모델 테이프 형식, `loadTape`, `tape`, `tapePlayer`, `contextHash`, `t` | TS-04 |
| `@xeon/ext-host/testing` | X | 테스트용 확장 호스트(on/post/drive/scope 최소형). L0를 import하지 않는다 | `X.primitives.spec`이 정한다 |

- 다른 컨텍스트 패키지의 `testing` 서브패스는 테스트 파일(`src/**/*.test.ts`, `test/**`)에서만 import한다. 패키지의 `src/testing/**` 소스는 다른 패키지의 `testing` 서브패스를 import하지 않는다(`eng.dependency-rules.guide` DR-08, DR-14 예외 3, [결정: review.decisions-2 U-17]).
- F와 X 패키지의 테스트는 L0 `testing`을 쓸 수 없다(DR-01). F 테스트는 임시 디렉터리가 필요 없게 순수 함수로 쓴다. X 테스트가 파일 시스템을 쓰면 `node:os`의 `tmpdir()`를 직접 쓰되 정리를 `afterEach`에 둔다.
- [결정: review.decisions-2 D-05] X 테스트는 L0를 import하지 않는다. 저장 대역(`ScopedStorePort` 등)은 X `test/` 안에 F 인터페이스로 만든다.
- 이름과 시그니처의 정본은 각 패키지의 spec이다. 이 문서의 시그니처는 그 spec이 정하기 전까지의 기준이다.

## 2. 규칙

### TS-01 테스트 계층과 태그

[제안] `docs/design/22-testing-strategy.md §3.1.1`의 15개 계층을 Xeon에 필요한 7개로 줄인다. 한 테스트 파일은 태그 하나를 가진다. 태그는 파일 이름 접미사로 정한다. `unit`은 아래 여섯 접미사(`.prop`, `.contract`, `.int`, `.fault`, `.scenario`, `.e2e`) 중 어느 것도 `.test.ts` 앞에 붙지 않은 파일이다.

| 태그 | 파일 이름 | 확인하는 것 | 격리 | 모델 | 결정성 | `just verify` |
|---|---|---|---|---|---|---|
| `unit` | 접미사 없는 `*.test.ts` | 함수·모듈 하나의 입력과 출력, 규칙 하나의 통과·실패 | 같은 프로세스, I/O 없음 또는 임시 디렉터리 | 없음 | D0 | 넣는다 |
| `prop` | `*.prop.test.ts` | 무작위 입력열에서 항상 성립해야 하는 성질 | 같은 프로세스 | 없음 | D0(고정 시드) | 넣는다 |
| `contract` | `*.contract.test.ts` | 외부 코드(pi-ai 1.3.0, Cordis vendored, durable env 포크, 자체 루프의 pi-agent-core 루프 포크)와 F 스키마·확장 지점 선언의 약속 | 같은 프로세스 | 테이프 | D0 | 넣는다 |
| `int` | `*.int.test.ts` | 한 패키지 안에서 실제 SQLite 파일, 실제 자식 프로세스, 실제 파일 시스템을 쓰는 동작 | 임시 디렉터리 | 테이프 | D0/D1 | 넣는다(파일당 10초 이하) |
| `fault` | `*.fault.test.ts` | 트랜잭션 고장 주입 지점, 강제 종료 뒤 재개, 손상 파일 | 같은 프로세스 또는 자식 프로세스 | 테이프 | D0/D1 | 넣는다 |
| `scenario` | `*.scenario.test.ts` | 모델 테이프로 `xeon chat` 한 턴 + 강제 종료 뒤 재개(스모크). 저장소 전체에 1개 | `apps/cli`의 자식 프로세스 | 테이프 | D1 | 넣는다(M1부터) |
| `e2e` | `*.e2e.test.ts` | 데스크톱 앱(Tauri 셸 + 엔진 사이드카) | 앱 프로세스 | 테이프 | D1 | 넣지 않는다(데스크톱 이후) |

버린 계층과 이유:

| 22의 계층 | 처리 | 이유 |
|---|---|---|
| `conf` 적합성 | `contract`로 합친다 | 세 리스너 동등성 같은 다중 구현 비교가 Xeon M0·M1에 없다. 전송 교체(in-process, stdio, service)의 동등성은 `L4.host-service.spec`이 `contract` 테스트로 정한다 |
| `sec` 보안·격리 | `int`로 합친다 | 샌드박스와 비밀 마스킹은 L0 패키지(`platform-sandbox`, `platform-secrets`)의 `int` 테스트다. 별도 레시피가 필요 없다 |
| `ui` 부품 | 보류 | 데스크톱 UI는 M2 이후다. `L4.desktop.spec`이 다시 정한다 |
| `visual` 시각 회귀 | 보류 | 같은 이유 |
| `perf` 성능 | 버린다(verify 밖) | D2 등급이라 verify에 넣을 수 없다. 측정이 필요하면 해당 plan이 별도 레시피로 둔다 |
| `sys` 시스템 | 버린다 | systemd 단위와 홈서버 데몬 전제가 없다. 서비스 모드는 1차이고 `int`·`scenario`로 확인한다. 서비스 모드 OS 등록만 2차다(`_research/foundation-plan.md §1` 결정 2) |
| `eval` 모델 품질 | 버린다(verify 밖) | 실제 모델이 필요하다. 테이프 녹화(TS-04)만 남긴다 |
| `manual` 수동 확인 | 버린다 | 기록만 하는 항목이라 테스트 계층으로 두지 않는다. 필요한 수동 확인은 각 plan의 완료 기준에 적는다 |

좋은 예:

```text
packages/platform-store/src/seq.test.ts                 unit
packages/platform-store/test/append.int.test.ts         int
packages/platform-store/test/commit.fault.test.ts       fault
packages/core-models/test/pi-ai.contract.test.ts        contract
apps/cli/test/chat.scenario.test.ts                     scenario (저장소에 1개)
```

나쁜 예:

```text
packages/core-loop/test/turn-with-real-db.test.ts       # TS-01: 실제 SQLite 파일을 쓰면 int 태그
tests/integration/loop-and-web.test.ts                  # TS-01: 패키지 밖 통합 테스트. 스모크 1개만 허용
```

### TS-02 결정성 등급

[제안] `docs/design/22-testing-strategy.md §3.1.2`를 그대로 쓴다.

| 등급 | 뜻 | 비교 방법 | verify |
|---|---|---|---|
| D0 바이트 동일 | 주입한 시계·ID·난수·테이프가 같으면 출력이 바이트 단위로 같다 | 골든 비교, 정규화 JSON 해시(`eventDigest`) 비교 | 넣는다 |
| D1 의미 동일 | 프로세스 경계나 실행 경로가 달라 ID·시각이 달라도 의미 필드가 같다 | `normalizeEvents(events, "semantic")` 뒤 비교 | 넣는다 |
| D2 통계·사람 판정 | 시간 측정, 실제 모델, 사람 평가 | 목표 수치 | 넣지 않는다 |

- `unit`, `prop`, `contract`는 D0이어야 한다. D0을 지킬 수 없으면 주입하지 않은 비결정 요소가 남아 있다는 뜻이다(TS-03).
- 의미 필드 목록(어떤 필드를 D1 비교에서 빼는지)은 `eng.events.design`이 이벤트 타입마다 정한다.

좋은 예:

```ts
import { expect, test } from "bun:test";
import { eventDigest } from "@xeon/core-persistence/testing";

test("same input events give the same projection digest", () => {
  const a = runFixture(seedEvents);
  const b = runFixture(seedEvents);
  expect(eventDigest(a)).toBe(eventDigest(b));   // D0
});
```

나쁜 예:

```ts
test("projection looks right", () => {
  const out = runFixture(seedEvents);
  expect(out.updatedAt).toBeGreaterThan(Date.now() - 1000);   // TS-02: 실제 시각에 기대는 비교
});
```

### TS-03 비결정 요소는 주입하고, 테스트 안에서 실제 시간을 기다리지 않는다

[제안] `docs/design/22-testing-strategy.md §3.5.1`의 주입 대상을 Xeon 패키지로 옮긴다.

| 대상 | 운영 | 테스트 | 제공 |
|---|---|---|---|
| 현재 시각 | F `Clock` 구현(L0 `platform-os`) | `manualClock(start)`. 기본 시작값 `2026-01-05T00:00:00Z`(1767571200000) | 각 패키지 `test/support/` |
| 타이머 | F `Scheduler` 구현(L0 `platform-os`, `eng.typescript.guide` 1.2절) | 같은 `ManualClock`의 가짜 타이머. `advance(ms)`가 만기 타이머를 만기 순서로 실행한다 | 같음 |
| ID 생성기 | F `IdFactory` 구현(인터페이스는 `F.conversation.spec` §3.2, 구현 `createIdFactory`는 L0 `platform-os`) | `fixedIdFactory(clock, seed)` | 같음 |
| 난수 | F `RandomSource` 구현(L0 `platform-os`) | `seededRandom(seed)` | 같음 |
| 임시 디렉터리 | 데이터 디렉터리(`platform-os`) | `tempDir()`. 테스트가 끝나면 지운다 | `@xeon/platform-os/testing` |
| 환경 변수 | 프로세스 환경 | `withIsolatedEnv(fn)`: `HOME`, `XDG_*`, `TMPDIR`를 임시 디렉터리로 바꾸고 `*_API_KEY`, `ANTHROPIC_*`, `OPENAI_*`, `SOPS_AGE_KEY*`, `SSH_AUTH_SOCK`을 지운다 | 같음 |
| 시간대·로케일 | 기기 값 | `TZ=UTC`, `LANG=C.UTF-8` | 테스트 preload |
| 네트워크 | 모델 API, 웹 | 루프백 밖 주소로 가는 `fetch`와 `WebSocket`은 예외를 던진다 | 테스트 preload |

```ts
// <패키지>/test/support/clock.ts  (런타임 중립. F에 testing 서브패스를 두지 않는다, U-03)
import type { Clock, RandomSource, Scheduler, TimerHandle } from "@xeon/contracts";   // eng.typescript.guide 1.2절
import type { IdFactory } from "@xeon/contracts/conversation";                       // F.conversation.spec §3.2. 루트에 두지 않는다(F.readme §3)

/** 운영 코드가 받는 Clock과 Scheduler를 한 객체로 구현한다 */
export interface ManualClock extends Clock, Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** ms만큼 진행하며 그 사이 만기 타이머를 만기 시각 순서로 실행한다. 같은 시각이면 등록 순서 */
  advance(ms: number): Promise<void>;
  /** 절대 시각으로 이동한다. 과거로 가는 것도 허용한다(시계 점프 시험) */
  set(at: number): Promise<void>;
  pendingTimers(): readonly { readonly at: number; readonly label?: string }[];
}
export declare function manualClock(start?: number): ManualClock;
export declare function fixedIdFactory(clock: Pick<ManualClock, "now">, seed?: string): IdFactory;
/** 같은 seed는 같은 열을 낸다. [0, 1) 균등 */
export declare function seededRandom(seed: number): RandomSource;
```

```ts
// @xeon/platform-os/testing  (L0)
export interface TempDir {
  readonly path: string;
  join(...parts: readonly string[]): string;
  [Symbol.asyncDispose](): Promise<void>;
}
export declare function tempDir(opts?: { readonly prefix?: string; readonly keepOnFail?: boolean }): Promise<TempDir>;
export declare function withIsolatedEnv<T>(
  fn: (dir: TempDir) => Promise<T>,
  extra?: Readonly<Record<string, string>>,
): Promise<T>;
```

- 금지: 테스트 안의 실제 `sleep`(`Bun.sleep`, `await new Promise((r) => setTimeout(r, n))`)로 결과를 기다리기. 실제 시간이 필요한 곳은 자식 프로세스를 쓰는 `int`·`fault`·`scenario`뿐이고, 그때도 고정 지연 대신 조건 대기(폴링 + 상한)를 쓴다.
- 우리 코드는 `ManualClock`을 주입받아 시험한다. Bun의 가짜 시계는 다음 경우에만 쓴다(`_research/notes/eng-3.md §3`).
  - `setSystemTime(date)`: `Date.now()`와 `new Date()`를 직접 읽는 경계 코드(L0의 `Clock` 구현 자신)를 시험할 때. `afterEach`에서 인자 없이 `setSystemTime()`을 불러 되돌린다.
  - `jest.useFakeTimers()`와 `jest.advanceTimersByTime(ms)`: 주입을 받지 않는 외부 코드(예: pi-ai의 재시도 대기)가 `setTimeout`을 쓸 때. `afterEach`에서 `jest.useRealTimers()`를 부른다. `useFakeTimers`만으로 `Date`가 바뀌는지는 확인하지 않았다 [가정: 바뀌지 않는다고 보고 `setSystemTime`을 함께 쓴다].
- 테스트 preload: [제안] 각 패키지의 `bunfig.toml`이 `[test] preload = ["../../scripts/test-preload.ts"]`를 둔다. `xeon/scripts/test-preload.ts`는 `TZ`, `LANG`을 고정하고, 비밀 환경 변수를 지우고, `globalThis.fetch`와 `globalThis.WebSocket`을 루프백 외 주소에서 예외를 던지는 함수로 바꾼다. 소켓 수준(`Bun.connect`, `node:net`)은 막지 못한다 [가정]. 그 구멍은 리뷰로 막고, 보완 수단은 6절 [미결]이다.

좋은 예:

```ts
import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { manualClock } from "./support/clock.ts";
import { createRetry } from "../src/retry.ts";

test("retry waits 2s before the second attempt", async () => {
  const clock = manualClock();
  const calls: number[] = [];
  // createRetry(deps: { clock: Clock; scheduler: Scheduler; delaysMs }) — ManualClock이 둘을 함께 구현한다
  const retry = createRetry({ clock, scheduler: clock, delaysMs: [2000] });
  const done = retry(async () => {
    calls.push(clock.now());
    return calls.length === 1 ? err({ kind: "transient" }) : ok("ok");   // 예상 가능한 실패는 Result (TY-11)
  });
  await clock.advance(2000);
  expect(await done).toEqual(ok("ok"));
  expect(calls).toEqual([1767571200000, 1767571202000]);
});
```

```ts
import { afterEach, expect, jest, setSystemTime, test } from "bun:test";

afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

test("third-party backoff fires after 1s", () => {
  jest.useFakeTimers();
  let fired = 0;
  setTimeout(() => { fired += 1; }, 1000);
  jest.advanceTimersByTime(999);
  expect(fired).toBe(0);
  jest.advanceTimersByTime(1);
  expect(fired).toBe(1);
});
```

나쁜 예:

```ts
test("retry waits", async () => {
  const retry = createRetry({ delaysMs: [2000] });     // 실제 시계
  const done = retry(flaky);
  await Bun.sleep(2100);                               // TS-03: 실제 대기
  expect(await done).toBe("ok");
});
```

### TS-04 모델은 테이프로 대신한다

[제안] `docs/design/22-testing-strategy.md §3.5.4`를 pi-ai 1.3.0 스트림 이벤트(`AssistantMessageEvent` 12종: `start`, `text_start`, `text_delta`, `text_end`, `thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`, `_research/notes/F-2.md §5.1`) 기준으로 옮긴다. 테이프 모듈은 pi-ai를 소유한 `core-models`의 `testing` 서브패스에 둔다(DR-07).

형식 `xeon.model-tape.v1`: JSONL, 한 줄에 객체 하나. 첫 줄은 헤더다. 파일 이름은 `*.tape.jsonl`이고 패키지의 `test/tapes/` 아래에 둔다.

```ts
// @xeon/core-models/testing  (packages/core-models/src/testing/tape.ts)
import type {
  AssistantMessageEvent,
  Context,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";   // 이름은 pi-ai 1.3.0 types.ts 기준 [가정: TextContent, ThinkingContent, ToolCall의 정확한 export 이름]
import { Bug, type Clock, type Scheduler } from "@xeon/contracts";

export type TapeContent = TextContent | ThinkingContent | ToolCall;

export interface ModelTapeHeader {
  readonly kind: "header";
  readonly format: "xeon.model-tape.v1";
  readonly tapeId: string;                       // 예: "core-loop/two-tool-calls"
  readonly origin: "authored" | "recorded";
  readonly matching: "role-queue" | "context-hash";
  readonly allowLeftover?: boolean;              // 기본 false
  readonly recordedFrom?: {                       // origin = "recorded"일 때 필수
    readonly provider: string;
    readonly model: string;
    readonly piAi: string;                       // 예: "1.3.0"
    readonly at: string;                         // ISO 8601
  };
}

export type TapeResponse =
  | {
      readonly type: "message";
      readonly content: readonly TapeContent[];
      readonly stopReason: "stop" | "length" | "toolUse";
      readonly usage?: Partial<Usage>;
    }
  | { readonly type: "events"; readonly events: readonly AssistantMessageEvent[] }   // 녹화한 스트림 그대로
  | {
      readonly type: "error";
      readonly reason: "error" | "aborted";
      readonly errorMessage: string;
      readonly afterContent?: readonly TapeContent[];   // 콘텐츠를 일부 낸 뒤 오류
    }
  | { readonly type: "stall" };                          // signal이 abort될 때까지 응답 없음

export interface ModelTapeTurn {
  readonly kind: "turn";
  readonly n: number;                            // 1부터
  readonly role: string;                         // 모델 용도 이름. L1.models.spec이 정한다 [가정]
  readonly match?: { readonly contextHash?: string };   // matching = "context-hash"일 때 필수
  readonly response: TapeResponse;
  readonly label?: string;                       // 사람용 설명. 비교하지 않는다
}

export type ModelTapeLine = ModelTapeHeader | ModelTapeTurn;
export interface ModelTape {
  readonly header: ModelTapeHeader;
  readonly turns: readonly ModelTapeTurn[];
}

/** 테이프 재생기가 받는 시계. 운영 Clock·Scheduler와 같은 인터페이스다(eng.typescript.guide 1.2절) */
export type TapeClock = Clock & Scheduler;

export interface TapeRequest {
  readonly role: string;
  readonly context: Context;
  readonly signal?: AbortSignal;
}

export interface TapePlayer {
  /** 차례의 응답을 pi-ai AssistantMessageEvent 열로 낸다. 짝이 없으면 TapeMismatchError */
  stream(req: TapeRequest): AsyncIterable<AssistantMessageEvent>;
  remaining(): number;
  consumed(): readonly ModelTapeTurn[];
  /** 남은 응답이 있으면 TapeLeftoverError. allowLeftover면 통과 */
  assertExhausted(): void;
}

/** 테스트 인프라 오류. Bug를 상속하고 testing 경로에서만 선언·throw한다(eng.typescript.guide 4.3절) */
export declare class TapeMismatchError extends Bug {}
export declare class TapeLeftoverError extends Bug {}

/** systemPrompt, messages, tools(name, description, parameters)의 정규화 JSON sha256 hex */
export declare function contextHash(context: Context): string;
export declare function loadTape(path: string): Promise<ModelTape>;
export declare function tape(
  id: string,
  turns: readonly Omit<ModelTapeTurn, "kind" | "n">[],
  opts?: Partial<Pick<ModelTapeHeader, "matching" | "allowLeftover">>,
): ModelTape;
export declare function tapePlayer(t: ModelTape, opts: { readonly clock: TapeClock }): TapePlayer;
/** 테이프 작성 도우미 */
export declare const t: {
  text(s: string): TextContent;
  thinking(s: string): ThinkingContent;
  toolCall(name: string, args: Readonly<Record<string, unknown>>, id: string): ToolCall;
};
```

재생 규칙:

1. `message` 응답은 `start` → 블록마다 `*_start`·`*_delta`(블록당 1개)·`*_end` → `done`(`reason` = `stopReason`) 순서의 이벤트로 바뀐다. `error` 응답은 `afterContent` 블록을 낸 뒤 `error` 이벤트로 끝난다. `events` 응답은 적힌 이벤트를 그대로 낸다.
2. `role-queue`: 역할별 대기열에서 순서대로 꺼낸다. 요청 역할의 대기열이 비면 `TapeMismatchError`를 던져 테스트를 실패시킨다. 모델 오류 응답으로 바꾸지 않는다. 오류 응답으로 바꾸면 런타임이 모델 오류 처리 경로로 계속 진행해 실패 원인을 가린다(22 §3.5.4 재생 규칙 2).
3. `context-hash`: 차례가 온 응답의 `match.contextHash`와 `contextHash(req.context)`가 다르면 `TapeMismatchError`를 던지고 두 해시와 메시지 수를 출력한다. 녹화 테이프에 쓴다. 컨텍스트 조립 규칙을 바꾸면 녹화 테이프가 실패한다. 다시 녹화하거나 `role-queue` 손 테이프로 바꾼다.
4. 남은 응답: 테스트 끝에서 `assertExhausted()`를 부른다. 남은 응답은 기본으로 허용하지 않는다(`allowLeftover: false`). 의도한 모델 호출 수를 확인하는 효과가 있다.
5. `stall`: `req.signal`이 abort될 때까지 이벤트를 내지 않는다. 시간 초과는 `ManualClock`을 진행해 일으킨다.
6. 도구 호출 ID: `t.toolCall(name, args, id)`의 `id`가 pi-ai `ToolCall`의 ID가 된다.
7. 사용량: `usage`가 없으면 0으로 채운다.

녹화(`origin: "recorded"`):

- 녹화는 실제 모델과 네트워크를 쓰므로 `just verify`와 CI에서 돌지 않는다. 레시피 `just tape-record <scenario>`(`xeon/scripts/tape-record.ts`)는 `--yes` 없이는 계획만 보이고 종료코드 3으로 끝난다. 사람이 확인한 뒤 `--yes`로 다시 부르면 `packages/core-models/scripts/record-tape.ts <scenario> <out>`을 부르고, 결과는 `packages/core-models/test/tapes/recorded/<scenario>.tape.jsonl`이다. 녹화기는 pi-ai 요청 옵션 `fetch`로 주입해 원본 SSE 덩어리를 차례의 `wire` 필드에 남기고(요청 헤더 없음, 응답 헤더 허용 목록, 비밀 치환과 쓰기 전 재검사), 재생은 `tapeFetch`가 한다. 규칙과 필드는 `L1.models.plan` M-15에 있다. 키는 환경 변수 `ANTHROPIC_API_KEY`에서만 읽고 없으면 종료코드 2다. M2 마감 전에 한 번 녹화한다(`review.m2-plan` §9 D-e).
- 저장소에 넣기 전에 gitleaks로 비밀 패턴을 검사하고, 홈 디렉터리 절대 경로와 실제 사용자 이름이 없는지 확인한다. 하나라도 있으면 넣지 않는다.
- 헤더의 `recordedFrom.piAi`로 pi-ai 판을 남긴다. pi-ai를 올리면 녹화 테이프를 재생해 스키마 실패가 없는지 본다.
- 테이프에 모델 문장의 품질 기대를 두지 않는다. 기대값은 이벤트 저장 결과(타입과 핵심 필드)다.

좋은 예:

```ts
import { expect, test } from "bun:test";
import { manualClock } from "./support/clock.ts";
import { t, tape, tapePlayer } from "@xeon/core-models/testing";

test("one tool call then a final answer", async () => {
  const clock = manualClock();
  const player = tapePlayer(
    tape("core-loop/read-then-answer", [
      { role: "work", response: { type: "message", content: [t.toolCall("read", { path: "a.txt" }, "call_1")], stopReason: "toolUse" } },
      { role: "work", response: { type: "message", content: [t.text("done")], stopReason: "stop" } },
    ]),
    { clock },
  );
  const result = await runTurnWith(player, clock);
  expect(result.toolCalls).toEqual(["read"]);
  player.assertExhausted();
});
```

나쁜 예:

```ts
test("answers", async () => {
  const result = await runTurnWith(realAnthropicModel());   // TS-04: 실제 모델·네트워크
  expect(result.text.length).toBeGreaterThan(0);
});
```

### TS-05 외부 경계의 가짜는 L0 인터페이스 구현으로 제공하고, `mock.module`로 내부 모듈을 바꾸지 않는다

[제안]

- 가짜가 필요한 외부 경계(프로세스 실행, 비밀, 파일 시스템, OS 정보, 저장)는 L0 인터페이스(F 정의)를 구현한 가짜를 `testing` 서브패스로 제공한다(1.2 표). 테스트는 그 가짜를 생성자나 Cordis 서비스로 주입한다.
- `mock.module()`로 `@xeon/*` 패키지나 같은 패키지의 상대 경로 모듈을 바꾸지 않는다.
  - 이유 1: 주입 지점이 없는 설계를 가린다. 주입 지점이 없으면 운영 코드도 교체할 수 없다.
  - 이유 2: `bun test` 기본 실행에서 `mock.module`은 파일 사이에 새어 다른 테스트 파일을 깨뜨린다. `--isolate`나 `--parallel`에서만 막힌다(`_research/notes/eng-3.md §3.2`). `mock.restore()`는 `mock.module`을 되돌리지 않는다.
- 외부 npm 모듈을 `mock.module`로 바꿔야 하는 예외는 `eng.dependency-rules.guide` 4절 허용 목록에 `TS-05/<이름>`으로 기록하고, 그 패키지의 `test` 스크립트를 `bun test --isolate`로 둔다.
- 함수 단위 기록(`mock(fn)`, `spyOn`)은 허용한다.

좋은 예:

```ts
import { expect, test } from "bun:test";
import { fakeExec } from "@xeon/platform-exec/testing";
import { createGitStatus } from "../src/git-status.ts";

test("parses porcelain output", async () => {
  const exec = fakeExec({
    "git status --porcelain": { exitCode: 0, stdout: " M a.ts\n", stderr: "" },
  });
  const status = createGitStatus({ exec });
  expect(await status.changed()).toEqual(["a.ts"]);
});
```

나쁜 예:

```ts
import { mock } from "bun:test";
mock.module("@xeon/platform-exec", () => ({ run: async () => ({ stdout: " M a.ts\n" }) }));   // TS-05
```

### TS-06 테스트는 패키지 안에 두고, 공용 가짜는 `testing` 서브패스로 낸다

[제안]

- 위치: 패키지의 `src/**/*.test.ts`(소스 옆 단위 테스트) 또는 `test/**`(나머지). 패키지 밖에 테스트 디렉터리를 두지 않는다. 예외는 `xeon/scripts/*.test.ts`와 스모크 1개(`apps/cli/test/`)다.
- 공용 가짜: 패키지의 `src/testing/index.ts`를 `exports`의 `"./testing"`으로 연다. 다른 패키지는 `devDependencies`로 선언하고 테스트 파일에서만 import한다(DR-08).
- 테스트 데이터: `test/fixtures/`, 모델 테이프는 `test/tapes/`.
- 경로: 테스트 안의 파일 경로는 `import.meta.dir` 기준으로 만든다. 실행 위치(cwd)에 기대지 않는다.
- `knip.json`의 패키지 `entry`에 `src/**/*.test.ts`와 `test/**/*.test.ts`를 둔다. 현재는 `test/**/*.test.ts`만 있다.

이유: 패키지를 교체하거나 지울 때 테스트가 함께 움직인다. 패키지별 `bun test`(TS-10)와 turbo `--affected`가 패키지 디렉터리를 단위로 돈다.

좋은 예:

```json
// packages/platform-secrets/package.json
"exports": { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" }
```

```ts
// packages/core-tools/test/fixtures.ts
import { join } from "node:path";
export const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);
```

나쁜 예:

```ts
// packages/core-tools/test/read.test.ts
const text = await Bun.file("packages/core-tools/test/fixtures/a.txt").text();   // TS-06: cwd에 기댄 경로
```

### TS-07 이벤트 저장 테스트는 실제 SQLite를 쓴다

[제안] 세션 저장은 SQLite 이벤트 소싱 + 투영, 단일 DB다([결정] `_research/decisions-log.md` 2026-10-21 결정 2차, adr.0004).

- 이벤트·투영·체크포인트·잠금을 건드리는 테스트는 `bun:sqlite`의 `:memory:` 또는 `tempDir()` 안 임시 파일로 실제 SQLite를 연다. `@xeon/platform-store/testing`의 `openTestStore()`를 쓴다.
- 저장소 가짜(배열이나 `Map`으로 흉내 낸 저장소)를 만들지 않는다. SQL 제약, 트랜잭션 롤백, `SQLITE_BUSY` 같은 동작은 실제 SQLite에서만 확인된다.
- WAL, 잠금, `busy_timeout`, 파일 손상 시험은 임시 파일을 쓴다. `:memory:`는 WAL과 다른 연결을 시험하지 못한다.
- 연결은 `PRAGMA busy_timeout = 5000`을 명시한다(`eng.toolchain.guide` TC-11). 잠금 경합 테스트는 실제 대기 대신 `busy_timeout = 0`과 `SQLITE_BUSY` 오류 코드로 확인한다.
- 오류 판정은 `SQLiteError`의 `code`(예: `SQLITE_CONSTRAINT_UNIQUE`)로 한다. 메시지 문자열로 판정하지 않는다(`_research/notes/eng-3.md §2.2`).

```ts
// @xeon/platform-store/testing  (L0)
import type { Clock } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
// FaultPoint(10개 지점)와 FaultInjector의 정본은 eng.transactions.design 4.2절. 여기서 다시 정의하지 않는다
import type { FaultInjector } from "@xeon/contracts/records";

export interface TestStoreOptions {
  /** 생략하면 ":memory:" */
  readonly path?: string;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** 쓰기 경로가 지점마다 hit(point)를 부른다. 예외를 던지면 커밋 전 지점의 트랜잭션은 롤백되어야 한다 */
  readonly faults?: FaultInjector;
}
export declare function openTestStore(opts: TestStoreOptions): Promise<TestStore>;
/** 실제 저장소 핸들 + 시험용 조회. TestStore의 운영 쪽 타입은 L0.store.spec이 정한다 */
export interface TestStore extends AsyncDisposable {
  readonly path: string;
  rowCounts(): Promise<Readonly<Record<string, number>>>;
}
```

좋은 예:

```ts
import { expect, test } from "bun:test";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { openTestStore } from "@xeon/platform-store/testing";

// 같은 requestId 재제출은 replayed 결과를 돌려준다(eng.transactions.design 4.7절, TS-08).
// 제약 위반은 같은 (session_id, seq) 행을 직접 두 번 넣는 저수준 경로로 확인한다(eng.events.design 4.6절).
test("a second row with the same (session_id, seq) is rejected by the unique index", async () => {
  const clock = manualClock();
  await using store = await openTestStore({ clock, ids: fixedIdFactory(clock, "s1") });
  await insertRawEvent(store, { seq: 1 });
  await expect(insertRawEvent(store, { seq: 1 })).rejects.toMatchObject({
    code: "SQLITE_CONSTRAINT_UNIQUE",
  });
});
```

나쁜 예:

```ts
class FakeEventStore { events: unknown[] = []; append(e: unknown) { this.events.push(e); } }   // TS-07: 저장소 가짜
```

### TS-08 재생과 고장 주입 테스트

[제안] `docs/design/22-testing-strategy.md §3.9`와 `docs/design/09-event-store.md §3.8.4`(고장 주입 지점)를 옮긴다. 이벤트·투영·재생의 정의는 `eng.events.design`, 트랜잭션 단계는 `eng.transactions.design`이 소유한다.

1. 재생 결정성: 같은 입력 이벤트열을 빈 DB에 두 번 적용하면 투영이 같다(D0, `eventDigest` 비교). 증분으로 갱신한 투영과 처음부터 재구성한 투영도 같다.
2. 트랜잭션 고장 주입: `eng.transactions.design` 4.2절 `FaultPoint`의 10개 지점(`after_begin`, `after_lease_check`, `after_request_check`, `after_event_insert:<n>`, `after_projection:<n>`, `after_ext_projection:<n>`, `before_checkpoint`, `before_request_insert`, `before_commit`, `after_commit`)마다 `FaultInjector.hit`에서 예외를 던지고 그 문서 4.6절의 불변식을 확인한다.
   - 커밋 전 9개 지점: `events`, `p_*`, `cap_*`, `x_*`(확장 테이블, review.decisions-2 U-18), `requests`, `step_checkpoints`의 행 수와 내용이 주입 전과 같다(부분 커밋 없음). seq에 빈칸이 없다. 같은 `requestId`로 다시 제출하면 처음 시도와 같은 결과로 성공한다.
   - `after_commit`: 모든 행이 남는다. 같은 `requestId`로 다시 제출하면 `replayed: true`이고 이벤트 수가 늘지 않는다.
3. 강제 종료 뒤 재개: 자식 프로세스로 엔진을 띄우고 이름 붙은 종료 지점에서 `SIGKILL`한 뒤 같은 데이터 디렉터리로 다시 띄운다. 기대값은 불변식 성립이다. 특정 이벤트열을 비교하지 않는다(D1). [제안] 종료 지점은 환경 변수 `XEON_TEST_KILLPOINT=<이름>[:<n>]`로 고르고, `XEON_TEST_HOOKS=1`이며 데이터 디렉터리가 임시 디렉터리일 때만 켜진다. 지점 이름 목록은 `L1.persistence.spec`이 정한다.
4. 장애 뒤 공통 검사: 수락된 요청이 모두 저장되어 있다, seq 빈칸 없음, 도구 실행 의도마다 종결 기록이 하나, 증분 투영 = 재구성 투영. 정확한 목록은 `eng.events.design`의 불변식을 따른다.

좋은 예:

```ts
import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { type FaultInjector, type FaultPoint } from "@xeon/contracts/records";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { openTestStore } from "@xeon/platform-store/testing";

// 커밋 전 지점. after_commit은 기대 결과가 달라 아래 테스트로 따로 본다
const BEFORE_COMMIT: readonly FaultPoint[] = [
  "after_begin", "after_lease_check", "after_request_check",
  "after_event_insert:0", "after_projection:0", "after_ext_projection:0",
  "before_checkpoint", "before_request_insert", "before_commit",
];
const KEY = "in:01JA2Z7Q8M3XK4V9TB6N0PRWES";

function faultAt(point: FaultPoint): { armed: boolean; readonly injector: FaultInjector } {
  const state = { armed: true, injector: { hit: (p: FaultPoint): void => { if (state.armed && p === point) throw new Bug(`fault:${p}`); } } };
  return state;
}

describe("commit rolls back at every pre-commit fault point", () => {
  for (const point of BEFORE_COMMIT) {
    test(point, async () => {
      const clock = manualClock();
      const fault = faultAt(point);
      await using store = await openTestStore({ clock, ids: fixedIdFactory(clock, point), faults: fault.injector });
      const before = await store.rowCounts();
      await expect(appendUserTurn(store, { requestId: KEY })).rejects.toThrow(`fault:${point}`);
      expect(await store.rowCounts()).toEqual(before);
      fault.armed = false;
      await appendUserTurn(store, { requestId: KEY });   // 재제출 성공
    });
  }
});

test("after_commit keeps rows and the retry is replayed", async () => {
  const clock = manualClock();
  const fault = faultAt("after_commit");
  await using store = await openTestStore({ clock, ids: fixedIdFactory(clock, "after_commit"), faults: fault.injector });
  await expect(appendUserTurn(store, { requestId: KEY })).rejects.toThrow("fault:after_commit");
  const after = await store.rowCounts();
  fault.armed = false;
  expect((await appendUserTurn(store, { requestId: KEY })).replayed).toBe(true);
  expect(await store.rowCounts()).toEqual(after);
});
```

나쁜 예:

```ts
test("rollback works", async () => {
  // TS-08: 지점 하나만, 불변식 확인 없이 예외 발생만 본다
  await expect(appendWithBrokenProjection()).rejects.toThrow();
});
```

### TS-09 속성 테스트는 고정 시드로 돈다

[제안] `docs/design/22-testing-strategy.md §3.7.2`를 줄여 옮긴다.

- `just verify`에서 도는 속성 테스트는 고정 시드 목록(`test/property/seeds.json`)만 쓴다. 시각 기반 새 시드는 쓰지 않는다.
- 실패하면 시드와 줄인 입력을 출력한다. 원인을 고친 뒤 그 입력을 `test/regressions/<이름>-<시드>.json`으로 커밋하고, 회귀 파일은 매번 재생한다.
- 새 시드 탐색은 별도 레시피(`just test-deep` [제안])에서만 돈다.
- 속성 테스트 라이브러리: fast-check는 1.1 스택 표에 없다. 들이려면 `eng.toolchain.guide` TC-04 절차를 밟는다 [미결]. 그 전까지는 `seededRandom`으로 입력을 만든다.

좋은 예:

```ts
import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Bug, parse } from "@xeon/contracts";
import { seededRandom } from "./support/clock.ts";
import seedsJson from "./property/seeds.json" with { type: "json" };

const SeedsSchema = Type.Array(Type.Integer({ minimum: 0, maximum: 2 ** 32 - 1 }), { maxItems: 1024 });
const seeds = parse(SeedsSchema, seedsJson);   // 단언 대신 스키마 검증 (TY-06, TY-10)
if (!seeds.ok) throw new Bug("property/seeds.json does not match SeedsSchema", { cause: seeds.error });

for (const seed of seeds.value) {
  test(`fold is order independent for tap points (seed ${seed})`, () => {
    const rand = seededRandom(seed);
    const handlers = Array.from({ length: 1 + Math.floor(rand() * 20) }, (_, i) => i);
    expect(runTap(shuffle(handlers, rand))).toEqual(runTap(handlers));
  });
}
```

나쁜 예:

```ts
test("fold is order independent", () => {
  const handlers = shuffle(range(20), Math.random);   // TS-09: 재현할 수 없는 시드
  expect(runTap(handlers)).toEqual(runTap(range(20)));
});
```

### TS-10 층별 CI와 커버리지

[결정] 패키지별 `bun test`, 층별 CI job(`_research/foundation-plan.md §5` P3, §6).

- 패키지는 `cd <패키지> && bun test`로 단독 실행된다. 다른 패키지의 빌드나 루트 cwd에 기대지 않는다.
- CI 층 job(`just ci-layer <층> true`)은 그 층의 패키지 가운데 turbo `--affected`가 고른 것만 돈다. `main`에서는 그 층 전체를 돈다(`eng.toolchain.guide` 3.4절).
- 커버리지: `bun test --coverage`. 임계는 패키지 `bunfig.toml`의 `[test] coverageThreshold = { lines = <값>, functions = <값> }`에 둔다. 패키지 cwd 실행은 루트 `bunfig.toml`을 읽지 않으므로 패키지마다 둔다(`_research/notes/eng-3.md §3.2`). `statements`는 강제되지 않으므로 쓰지 않는다.
- [제안] 임계값:

| 층 | lines | functions |
|---|---|---|
| F, L0 | 0.9 | 0.9 |
| X, L1 | 0.8 | 0.8 |
| L2, L3 | 0.7 | 0.7 |
| L4 | 0.5 | 0.5 |

- 임계 미달은 메시지 없이 종료코드 1로 끝난다. CI 스텝 이름에 임계를 적어 원인을 찾게 한다.
- 테스트가 import하지 않은 파일은 커버리지 집계에서 빠진다. 각 패키지에 `src/index.ts`를 import하는 테스트를 하나 둔다. 진입점에서 import되지 않는 파일은 knip이 미사용 파일로 보고한다.

좋은 예:

```toml
# packages/platform-store/bunfig.toml
[test]
preload = ["../../scripts/test-preload.ts"]
coverageSkipTestFiles = true
coverageThreshold = { lines = 0.9, functions = 0.9 }
```

나쁜 예:

```json
// packages/core-loop/package.json
"scripts": { "test": "cd ../.. && bun test packages/core-loop" }   // TS-10: 루트 cwd에 기댄 실행
```

## 3. 강제 수단

| 규칙 | 강제 수단 |
|---|---|
| TS-01 계층·태그 | 리뷰. [제안] `check-layers.ts`: 패키지 밖 테스트 파일, `*.scenario.test.ts`가 둘 이상이면 실패 |
| TS-02 결정성 | 같은 테스트를 CI 층 job과 `just verify`에서 두 번 돌린다. 결과가 다르면 D0 위반으로 본다 |
| TS-03 주입·실제 대기 금지 | [제안] `check-layers.ts` 패턴 스캔: 테스트 파일의 `Bun.sleep(`, `setTimeout(` 뒤 `await`, `Math.random(`, 인자 없는 `Date.now()`. oxlint `no-restricted-globals`는 1.89에 있으나 파일 단위 override가 기본 패턴을 대체하는 문제(`eng.dependency-rules.guide` 3.2절)가 있어 2차 수단으로 둔다 |
| TS-04 테이프 | preload의 네트워크 차단, `assertExhausted()` 리뷰, DR-07(pi-ai 소유) |
| TS-05 `mock.module` 금지 | [제안] `check-layers.ts` 패턴 스캔: `mock.module(` 인자가 `@xeon/` 또는 `.`으로 시작하면 실패. 허용 목록 `TS-05/<이름>` |
| TS-06 위치 | knip `entry`, DR-08(check-layers) |
| TS-07 실제 SQLite | 리뷰, DR-07(`bun:sqlite`는 `platform-store`만이므로 다른 패키지는 `openTestStore`를 쓸 수밖에 없다) |
| TS-08 재생·고장 주입 | `core-persistence`·`platform-store`의 `fault` 테스트가 `FaultPoint` 10개 지점(`eng.transactions.design` 4.2절)을 모두 돈다. 지점 목록과 테스트 목록을 대조하는 테스트를 둔다 |
| TS-09 고정 시드 | 리뷰, TS-03 패턴(`Math.random`) |
| TS-10 층별 CI·커버리지 | `.github/workflows/xeon-ci.yml` 층 matrix, 패키지 `bunfig.toml` 임계 |

## 4. 예외와 승인 절차

- `mock.module` 예외: `eng.dependency-rules.guide` 4절 허용 목록에 `TS-05/<이름>`으로 기록하고 그 패키지 테스트를 `--isolate`로 돌린다.
- 실제 시간 대기가 필요한 테스트: `int`·`fault`·`scenario` 태그에서 조건 대기(폴링 + 상한)로만 쓴다. 고정 지연은 예외 없이 금지한다.
- 커버리지 임계를 낮추는 변경: 사람 확인을 받고 이 문서의 표를 같은 커밋에서 고친다.
- 통합 테스트(스모크 외)를 더하는 변경: 해당 plan에 이유를 적고 사람 확인을 받는다.
- 테이프 재녹화: `just tape-record ... --yes`(사람 확인, 종료코드 3).

## 5. 수용 기준

- 어떤 패키지든 `cd xeon/packages/<이름> && bun test`로 단독 실행되어 통과한다. 루트 cwd, 다른 패키지의 빌드 산출물, 미리 띄운 프로세스가 필요 없다.
- 테스트 실행 중 루프백 밖 네트워크 요청과 실제 모델 호출이 0이다. preload가 차단하고, 시도하면 테스트가 실패한다.
- `fault` 테스트가 `FaultPoint` 10개 지점마다 `eng.transactions.design` 4.6절 불변식을 확인한다. 커밋 전 9개 지점은 부분 커밋 없음과 재제출 성공, `after_commit`은 행 유지와 재제출 `replayed: true`다.
- 같은 테스트를 두 번 돌리면 결과가 같다(D0 테스트).
- `apps/cli/test/chat.scenario.test.ts` 스모크 1개가 테이프로 한 턴을 돌고, 강제 종료 뒤 재개해 이벤트가 이어지는지 확인한다(M1, `_research/foundation-plan.md §6` M1 스모크).

## 6. 미결 사항

- [미결] `bun test`의 워크스페이스 projects 지원 여부. `bun test`에는 workspace나 projects 설정이 없고 `--filter`도 없다(`_research/notes/eng-3.md §3.1`, `_research/stack-status.md §3-C`). 이 문서는 turbo가 패키지마다 cwd를 바꿔 `bun test`를 부르는 방식(현재 `turbo run test`)으로 대신한다. 이 방식은 패키지마다 `bunfig.toml`(preload, 임계)이 필요하다. 루트에서 경로 인자(`bun test packages/<이름>`)로 돌려 루트 `bunfig.toml` 하나로 줄이는 안과 비교해 정한다(`_research/notes/eng-3.md §6` M-2).
- [미결] 속성 테스트 라이브러리(fast-check) 도입 여부. 도입하면 TC-04 절차로 ADR을 쓴다.
- [미결] 모델 용도 이름(`role`)과 테이프 재생기를 L1 모델 서비스에 연결하는 방식. `L1.models.spec`이 정한다.
- [미결] preload가 소켓 수준 네트워크(`Bun.connect`, `node:net`)를 막지 못하는 문제의 보완.
- `ManualClock`이 구현할 F `Clock`·`Scheduler`는 F 루트 base, `IdFactory`는 `@xeon/contracts/conversation`이다(`F.readme` §3, `eng.typescript.guide` 1.2절). 대역은 각 패키지 `test/support/`에 둔다([결정: review.decisions-2 U-03]).
