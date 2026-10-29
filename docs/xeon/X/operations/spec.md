---
id: X.operations.spec
layer: X
domain: operations
kind: spec
status: draft
depends_on: [F.extensions.spec, F.records.spec, F.wire-settings.spec, F.capabilities.spec, X.primitives.spec, X.loading-trust.spec, eng.transactions.design, eng.events.design, eng.context-map.design, eng.typescript.guide, adr.0004, adr.0007]
binds: [xeon/packages/ext-host/src/operations/**]
---

# X 운영 규칙 (operations)

코드 위치: `xeon/packages/ext-host/src/operations/`. 공개 진입점은 `@xeon/ext-host`다. 루트가 다시 내보내는 이름의 목록은 `X.primitives.spec` §3.1 표(이 문서 행 포함)가 정본이고, 이 문서는 그 행에 들어갈 이름의 시그니처를 정한다.

## 1. 목적과 범위

확장 운영 규칙 여섯 가지의 정책값과 인터페이스를 정한다. 근거는 층 구성 계획 v2의 X-c 행이다(`_research/layer-plan-v2.json` X-c, `_research/item-catalog.md` X절, `_research/packages.md` §4.5 X-c).

| # | 규칙 | 계획 v2 단계 | 이 문서 절 |
|---|---|---|---|
| 1 | 실행 순서와 tier | 1차 | §3.1, §4.1 |
| 2 | 실패 격리와 핸들러 시간 예산 | 1차 | §3.2~§3.3, §4.2~§4.3 |
| 3 | 확장 전용 저장 영역 | 1차 | §3.4, §4.4 |
| 4 | 이름 충돌 규칙 | 2차 | §3.5, §4.5 |
| 5 | 안전 모드 | 2차. M3에 넣는다 [결정: review.m3-design-inputs D-M3-11 c] | §3.6, §4.6 |
| 6 | 외부 훅 프로토콜 | M4로 옮김. M3 밖이다 [결정: 2026-10-28 사용자]. 근거는 D-M3-11 c안 원문("로더·안전 모드만")과 §10 21 | §3.7, §4.7 |

정하는 것:

- tier 집합과 순위, tier 부여 규칙, `DispatchPolicy`에 넣는 정렬 키 함수
- 지점 종류별 핸들러 시간 예산, 사용자 응답 대기의 예산 제외, 예산 초과 처리
- 확장 단위 실패 집계, 자동 끄기와 다시 켜기 규칙
- 확장 전용 테이블 API `ExtStorage`와 접두 밖 접근 차단 방식
- 도구·명령·단축키·플래그의 네임스페이스와 충돌 해소
- 안전 모드와 시작 시 개별 확장 끄기
- 외부 훅의 설정 형식, 입출력 JSON, 종료 코드, 출력 상한, 환경 정리
- 설정 키 `x.operations.*`

다루지 않는 것:

- 지점 이름, fold, 페이로드 타입, `FIRST_DENY`, `CHAIN_RULES`: `F.extensions.spec`(정본). 이 문서는 이름으로 인용하고 재정의하지 않는다.
- 디스패처, post 큐, drive 임대 중재, scope 토글 적용, 리소스 등록 API, `DispatchPolicy` 인터페이스 자체: `X.primitives.spec`
- 확장 탐색, 로드 순서, 매니페스트 검증 흐름, 신뢰 판정, 프로세스 격리, SDK 가상 모듈: `X.loading-trust.spec`
- 세션 커밋 경로와 투영기 실행: `L1.persistence.spec`, `eng.transactions.design`
- 테이블 DDL 실행과 연결 관리: `L0.store.spec`

### 1.1 소유 경계 조정

[제안] `F.extensions.spec` §1 "다루지 않는 것"과 §4.2는 핸들러 시간 예산과 실행 순서 tier를 `X.primitives.spec` 몫으로 적었다. 이 문서는 그 둘을 operations 소유로 옮긴다. 근거는 둘이다.

- 계획 v2가 "실행 순서와 tier", "실패 격리와 핸들러 시간 예산"을 X-c 운영 규칙에 두었다(`_research/layer-plan-v2.json` X-c comps 1·2행).
- `eng.transactions.design` §8이 "핸들러 시간 예산은 `X.operations.spec`이 정한다"고 적었다.

나누는 방식: `X.primitives.spec`은 `DispatchPolicy` 인터페이스(정렬 키 함수, 예산 실행기, 결과 보고 자리)를 정의하고 기본 구현을 두지 않는다. 값과 정책은 이 문서가 정하고 `createOperationsPolicy`가 구현을 만든다(§3.8). F 문구 수정 요청은 §10 미결 1이다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| tier | 핸들러 실행 순서의 첫째 키. 확장의 출처와 신뢰 등급으로 X가 부여한다. 확장이 고르지 않는다 |
| 바깥 tier | 순위 숫자가 작은 tier. 한 디스패치에서 먼저 실행된다 |
| 보안 가드 | 권한 판정과 샌드박스 강제를 맡는 내장 핸들러. `guard` tier에만 있다 |
| 핸들러 시간 예산 | 핸들러 호출 한 번이 쓸 수 있는 실행 시간(ms). 사용자 응답 대기 시간은 빼고 잰다 |
| 예산 게이트 (`BudgetGate`) | 핸들러가 사용자 응답을 기다리는 동안 예산 시계를 멈추는 장치. omp `HandlerTimeoutBudget`의 pause/resume과 같은 뜻 |
| 실패 | 핸들러 예외, 예산 초과, 결과 스키마 위반, 외부 훅의 비정상 종료나 출력 위반. 외부 신호(사용자 중단, 세션 종료)로 끊긴 호출은 실패가 아니다 |
| 실패 장부 (`FailureLedger`) | 확장(또는 외부 훅) 단위로 연속 실패 수와 최근 호출 창의 실패율을 세는 메모리 구조 |
| 자동 끄기 | 실패 기준을 넘은 확장의 scope를 다음 단계 경계에서 끄는 동작 |
| 확장 전용 테이블 | 세션 DB 파일 안의 `x_<확장>_<지역 이름>` 테이블. 확장의 부가 데이터를 둔다 |
| 지역 이름 | 확장 전용 테이블 이름에서 접두를 뺀 부분 |
| 정식 이름 (qualified name) | `<확장 이름>:<이름>` 형식의 리소스 이름. 모델 도구는 `<확장 이름>__<이름>` |
| 짧은 이름 | 접두 없는 리소스 이름. 충돌이 없고 예약되지 않았을 때만 노출한다 |
| 안전 모드 | 외부 확장(`user`·`project` tier), 외부 훅, L3 내장 그룹([결정: review.m3-design-inputs D-M3-07 a], §4.6.2)을 싣지 않고 시작하는 모드 |
| 외부 훅 | 설정에 적은 외부 명령. on 지점 하나에 stdin/stdout JSON으로 참여한다 |

## 3. 인터페이스

공통 import(아래 코드 블록에서 생략한다):

```ts
import { Type, type Static, type TObject, type TSchema } from "typebox";
import type { Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, EventKind } from "@xeon/contracts/records";
import type {
  ExtensionManifest, ExtensionName, Fold, PointDecl, PointName, PointSignatures, ScopeApi, ScopeId,
} from "@xeon/contracts/extensions";
// 호스트 포트는 F가 정본이다(F.extensions.spec §3.2.1 ports.ts). 이 문서는 정의하지 않는다
import type {
  PortLookup, ProjectorRegistryPort, ScopedStorePort, HookProcessPort, HookRunSpec, HookRawRun,
} from "@xeon/contracts/extensions";
// 같은 패키지의 다른 도메인(X.primitives.spec §3.1, X.loading-trust.spec §3.1~§3.4)
import type {
  DispatchPolicy, HandlerEntryInfo, HandlerFailure, HandlerFailureReason, HandlerGate, HandlerRunOutcome,
  ResourceKind, ResourcePolicy, ResourceRecord,
} from "../primitives/index.ts";
import type { InstallSource, TrustLevel, LoadedExtensionInfo } from "../loading-trust/index.ts";
```

- 시계와 타이머는 `ExtHostDeps`와 같은 모양(`now`, `setTimer`)으로 받는다(X.primitives.spec §3.2). 테스트는 패키지 `test/` 안의 `ManualClock`(F `Clock` 인터페이스, `eng.testing.guide`)으로 두 함수를 만든다([결정: review.decisions-2 U-03]).

### 3.1 tier와 정렬 키 (`tier.ts`)

```ts
export type Tier = "guard" | "user" | "project" | "builtin" | "core";

/** 바깥에서 안쪽 순서. 인덱스가 순위다 */
export const TIERS: readonly ["guard", "user", "project", "builtin", "core"] =
  ["guard", "user", "project", "builtin", "core"];
export const TierSchema: TSchema;   // Type.Union(TIERS의 Literal)

// TrustLevel("builtin" | "user" | "project" | "untrusted")과 InstallSource("builtin" | "managed" | "user" | "project")는
// X.loading-trust.spec §3.1이 정본이다. 이 문서는 재정의하지 않는다.

export type HookId = string;   // §3.7 HOOK_ID_PATTERN

/** 핸들러를 등록한 주체 */
export type HandlerOwner =
  | { readonly type: "extension"; readonly name: ExtensionName; readonly scopeId: ScopeId }
  | { readonly type: "hook"; readonly hookId: HookId };

/** 실패 장부와 진단의 키. "ext:<확장 이름>" 또는 "hook:<훅 id>" */
export type HandlerOwnerKey = `ext:${string}` | `hook:${string}`;
export function ownerKey(owner: HandlerOwner): HandlerOwnerKey;

/** primitives 레지스트리가 on 등록 때 채운다 */
export interface HandlerOrigin {
  readonly owner: HandlerOwner;
  readonly tier: Tier;
  /** 확장 로드 순서(X.loading-trust.spec). 외부 훅은 모든 확장 뒤에 설정 파일 순서로 이어 붙인다 */
  readonly loadIndex: number;
  /** 같은 주체 안의 on 호출 순서. 0부터 */
  readonly registrationIndex: number;
}

/** 전체 정렬 키. 디스패처는 (DispatchPolicy.tierOf(entry), entry.loadIndex, entry.seq)로 같은 키를 만든다 */
export type HandlerOrderKey = readonly [tierRank: number, loadIndex: number, registrationIndex: number];

/** tier 순위 함수. X.primitives.spec §3.4 DispatchPolicy.tierOf 자리에 그대로 들어간다 */
export type TierOfFn = (entry: HandlerEntryInfo) => number;

/** 순수 함수. HandlerOrigin에서 전체 키를 만든다. 문서·테스트용 기준 구현 */
export function orderKeyOf(origin: HandlerOrigin): HandlerOrderKey;

/** 사전식 비교. 음수면 a가 먼저 */
export function compareOrderKey(a: HandlerOrderKey, b: HandlerOrderKey): number;

export interface TierInput {
  readonly name: ExtensionName;
  readonly source: InstallSource;
  /** X.loading-trust.spec §4.6.1의 유효 등급 */
  readonly trust: TrustLevel;
  readonly layer: ExtensionManifest["layer"];
}

export type TierError =
  | { readonly kind: "untrusted"; readonly name: ExtensionName }            // 같은 프로세스에 싣지 않는다
  | { readonly kind: "source_trust_mismatch"; readonly name: ExtensionName }; // 예: source가 project인데 trust가 builtin

/** 확장 이름 → tier 표. 로더가 확장을 실을 때 채우고 tierOf가 읽는다 */
export interface TierTable {
  set(name: ExtensionName, tier: Tier): void;
  get(name: ExtensionName): Tier | undefined;
  delete(name: ExtensionName): void;
}
export function createTierTable(): TierTable;

/** tierOf 구현. 표에 없는 확장(로드 경로 밖에서 등록된 핸들러)은 가장 안쪽 순위 밖(TIERS.length)으로 둔다 */
export function tierOfFrom(table: TierTable): TierOfFn;

/** 보안 가드 허용 목록. 이 목록의 내장 패키지만 guard tier를 받는다 */
export const GUARD_EXTENSIONS: ReadonlySet<ExtensionName>;

/** 순수 함수. §4.1.2 표를 구현한다 */
export function assignTier(input: TierInput, guards?: ReadonlySet<ExtensionName>): Result<Tier, TierError>;
```

- `GUARD_EXTENSIONS`의 첫 값 [제안]: `core-tools`(권한 판정 핸들러). 이름은 해당 패키지의 매니페스트 `name`이고 `L1.tools.spec`이 확정한다 [가정]. L0 패키지(`platform-sandbox` 포함)는 on을 쓰지 않으므로 이 목록에 넣지 않는다(§4.1.2, §10 미결 20).
- `HandlerEntryInfo`(X.primitives.spec §3.4)에는 tier가 없다. 그래서 operations는 확장 이름 → tier 표(`TierTable`)를 두고, 로더가 `LoadedExtensionInfo`(source, trust)로 `assignTier`를 부른 결과를 실을 때 넣는다. `tierOf`는 `entry.extension`으로 표를 읽는다.
- 외부 훅의 tier는 훅이 적힌 설정 범위로 정한다(§4.7.6).

### 3.2 핸들러 시간 예산 (`budget.ts`)

```ts
export type BudgetClass = "first" | "chain" | "tap" | "streamTap" | "shutdown" | "setup" | "hook";

export type BudgetTable = { readonly [C in BudgetClass]: number };   // ms

/** §4.2.2 표의 기본값. 설정 키 x.operations.budget.*의 default와 같다(§6) */
export const DEFAULT_BUDGETS_MS: BudgetTable;
// = { first: 30_000, chain: 10_000, tap: 5_000, streamTap: 1_000, shutdown: 2_000, setup: 10_000, hook: 30_000 }

/** 고빈도 관찰 지점. streamTap 예산을 쓴다 */
export const STREAM_TAP_POINTS: readonly PointName[];
// = ["boundary.message.update", "request.stream", "tool.execution.update"]

/** 순수 함수. setup(X.primitives.spec §4.5.3, 값은 OperationsPolicy.setupBudgetMs)과 외부 훅은 이 함수를 쓰지 않는다 */
export function budgetClassOf(point: PointDecl): Exclude<BudgetClass, "setup" | "hook">;

/** DispatchPolicy.budgetMs 구현. 지점 등급과 유효 설정 값으로 정한다 */
export function budgetMsFrom(budgets: () => BudgetTable): (entry: HandlerEntryInfo) => number | null;

/** 핸들러가 사용자 응답을 기다리는 동안 예산 시계를 멈춘다. 중첩 호출을 센다. X.primitives.spec §3.4 HandlerGate를 넓힌다 */
export interface BudgetGate extends HandlerGate {
  /** 남은 예산(ms). 멈춘 동안에는 줄지 않는다 */
  readonly remainingMs: number;
}

/** X.primitives.spec §3.4 HandlerRunOutcome과 같은 타입. DispatchPolicy.run의 반환형이다 */
export type BudgetOutcome<T> = HandlerRunOutcome<T>;

/** ExtHostDeps(X.primitives.spec §3.2)의 now·setTimer와 같은 함수를 받는다 */
export interface BudgetDeps {
  readonly now: () => number;
  /** 반환값은 취소 함수 */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
}

/**
 * work를 예산 안에서 실행한다. 예산을 넘으면 work에 준 signal을 TimeoutError DOMException으로 abort하고
 * 곧바로 timeout을 돌려준다. 그 뒤에 work가 낸 값과 예외는 버린다. outer가 abort되면 aborted다.
 * budgetMs가 null이면 예산 없이 실행한다(drive 등 시간 예산 밖 호출용).
 */
export function runWithBudget<T>(
  work: (signal: AbortSignal, gate: BudgetGate) => T | Promise<T>,
  budgetMs: number | null,
  deps: BudgetDeps,
  outer?: AbortSignal,
): Promise<BudgetOutcome<T>>;

/** wait 동안 gate를 멈춘다. ctx.ui 대화상자와 승인 대기를 감싸는 데 쓴다 */
export function awaitUser<T>(gate: BudgetGate, wait: () => Promise<T>): Promise<T>;
```

### 3.3 실패 집계와 자동 끄기 (`failure.ts`, `auto-disable.ts`)

```ts
// failure.ts
/** primitives의 HandlerFailureReason에서 value_from_tap을 뺀 것 + 외부 훅·격리 실패 */
export type FailureKind =
  | Exclude<HandlerFailureReason, "value_from_tap">      // "threw" | "timeout" | "result_invalid" | "merge_rejected"
  | "hook_exit" | "hook_output" | "hook_spawn"
  | "isolation_exited";
export type HandlerResultKind = "ok" | "aborted" | "value_from_tap" | FailureKind;

/** primitives HandlerFailure → 장부 기록. value_from_tap은 기록만 하고 실패로 세지 않는다 */
export function fromHandlerFailure(failure: HandlerFailure, tier: Tier, at: number): HandlerOutcomeRecord;

export interface HandlerOutcomeRecord {
  readonly owner: HandlerOwner;
  readonly tier: Tier;
  readonly point: PointName;
  readonly fold: Fold;
  /** 그 지점 선언의 실패 정책. `POINTS[point].failure`를 읽는다(F.extensions.spec §3.3, adr.0017) */
  readonly failure: FailurePolicy;
  readonly result: HandlerResultKind;
  /** 멈춘 시간을 뺀 실행 시간 */
  readonly activeMs: number;
  /** deps.now() */
  readonly at: number;
  /** 오류 메시지 앞 500자. 비밀 마스킹은 L0.secrets.spec의 출력 마스킹을 거친다 */
  readonly message?: string;
}

/** F.extensions.spec FailurePolicy(`closed`, `open`, `skip`)를 쓴다. 재정의하지 않고 POINTS[point].failure를 읽는다 */

export interface FailureStats {
  readonly consecutive: number;
  readonly windowCalls: number;
  readonly windowFailures: number;
  readonly totalCalls: number;
  readonly totalFailures: number;
  readonly lastFailure?: HandlerOutcomeRecord;
}

export interface FailureLedger {
  /** aborted는 창에 넣지 않고 연속 수도 바꾸지 않는다 */
  record(outcome: HandlerOutcomeRecord): FailureStats;
  stats(key: HandlerOwnerKey): FailureStats;
  reset(key: HandlerOwnerKey): void;
  snapshot(): ReadonlyMap<HandlerOwnerKey, FailureStats>;
}

export function createFailureLedger(options: { readonly windowSize: number }): FailureLedger;
```

```ts
// auto-disable.ts
export interface AutoDisablePolicy {
  readonly enabled: boolean;
  /** 연속 실패 기준 */
  readonly consecutive: number;
  /** 최근 호출 창 크기 */
  readonly windowSize: number;
  /** 실패율 기준을 적용하는 최소 실패 수 */
  readonly minFailures: number;
  /** 0~1 */
  readonly failureRate: number;
}
export const DEFAULT_AUTO_DISABLE: AutoDisablePolicy;
// = { enabled: true, consecutive: 5, windowSize: 50, minFailures: 10, failureRate: 0.5 }

/** 자동 끄기 대상에서 빼는 tier. LoadedExtensionInfo.essential이 참인 확장도 뺀다(X.loading-trust.spec §4.3.2) */
export const AUTO_DISABLE_EXEMPT_TIERS: readonly Tier[];   // = ["guard", "core"]

export type AutoDisableVerdict =
  | { readonly disable: false }
  | { readonly disable: true; readonly rule: "consecutive" | "rate"; readonly stats: FailureStats };

/** 순수 함수. exempt가 참이면 항상 disable:false */
export function judgeAutoDisable(stats: FailureStats, policy: AutoDisablePolicy, exempt: boolean): AutoDisableVerdict;

/** scope 끄기 요청 사유. F.records ScopeChangedPayload.reason의 값 정본(F.records.spec §3.3) */
export type ScopeChangeReason = "request" | "auto_disable" | "safe_mode" | "startup_disable";

/**
 * scope 제어 포트. ExtHost.scope(id)의 ScopeHandle.enable/disable과 ExtHost.scopes()(X.primitives.spec §3.2)를 감싼다.
 * ScopeHandle에는 사유 인자가 없으므로 사유를 scope.changed에 싣는 경로는 primitives 추가 요청이다(§10 미결 4)
 */
export interface ScopeControl {
  requestDisable(scopeId: ScopeId, reason: ScopeChangeReason): void;
  requestEnable(scopeId: ScopeId, reason: ScopeChangeReason): void;
  scopesOf(extension: ExtensionName): readonly ScopeId[];
}

/** 사용자 알림 포트. 구현은 휘발 이벤트 발신(§4.3.4) */
export interface OperationsNotifier {
  handlerFailed(outcome: HandlerOutcomeRecord, stats: FailureStats): void;
  autoDisabled(key: HandlerOwnerKey, verdict: Extract<AutoDisableVerdict, { disable: true }>): void;
}

/** 휘발 발신 포트. 발신과 운영 로그는 조립 루트가 넘긴다(§4.3.4) */
export interface VolatileNotifierDeps {
  readonly emit: (payload: ScopeHandlerFailedPayload) => void;
  readonly log: (line: string) => void;
}

/** 실패마다 `scope.handler_failed`를 발신하고 운영 로그를 남긴다. 발신이 던지면 로그만 남긴다 */
export function createVolatileNotifier(deps: VolatileNotifierDeps): OperationsNotifier;

export interface AutoDisabler {
  /** 장부에 기록하고 판정한다. 기준을 넘으면 ScopeControl.requestDisable(…, "auto_disable")을 부른다 */
  onOutcome(outcome: HandlerOutcomeRecord): void;
  /** 사용자가 다시 켤 때. 장부를 비우고 requestEnable을 부른다 */
  reenable(key: HandlerOwnerKey): void;
  /** 기준과 무관하게 바로 끈다. 격리 확장의 재시작 한도 초과(X.loading-trust.spec §4.9.7)에서 쓴다 */
  disableNow(key: HandlerOwnerKey, cause: "isolation_restart_limit" | "projection_failed"): void;
  /** 이번 프로세스에서 자동으로 꺼진 주체 */
  disabled(): readonly HandlerOwnerKey[];
}

export function createAutoDisabler(deps: {
  readonly ledger: FailureLedger;
  readonly policy: () => AutoDisablePolicy;      // 설정 live 반영
  readonly scopes: ScopeControl;
  readonly hooks: { disable(id: HookId): void; enable(id: HookId): void };
  readonly notifier: OperationsNotifier;
}): AutoDisabler;
```

### 3.4 확장 전용 저장 영역 (`storage/*.ts`)

```ts
// storage/tables.ts
/** 지역 이름. 밑줄을 금지해 테이블 이름에서 소유 확장을 한 가지로 읽는다(§4.4.2) */
export const EXT_TABLE_LOCAL_PATTERN = "^[a-z][a-z0-9]{0,31}$";
export const EXT_COLUMN_PATTERN = "^[a-z][a-z0-9_]{0,62}$";
/** X가 쓰는 지역 이름. 확장이 정의할 수 없다 */
export const RESERVED_LOCAL_TABLES: readonly string[];   // = ["state", "meta"]
/** perThread 테이블에 X가 붙이는 열 */
export const THREAD_COLUMN = "thread_id";

export interface ExtTableDef<R extends TObject = TObject> {
  /** 행 스키마. 속성 이름이 열 이름이다 */
  readonly row: R;
  /** 기본 키 열 */
  readonly key: readonly [keyof Static<R> & string, ...(keyof Static<R> & string)[]];
  readonly indexes?: readonly (readonly [keyof Static<R> & string, ...(keyof Static<R> & string)[]])[];
  /** 참이면 thread_id 열을 붙이고 기본 키 앞에 둔다. 세션 삭제 때 그 행을 지운다 */
  readonly perThread: boolean;
}
export type ExtTableDefs = Readonly<Record<string, ExtTableDef>>;

/** "x_" + 하이픈을 밑줄로 바꾼 확장 이름 + "_" */
export function extTablePrefix(name: ExtensionName): string;
export function extTableName(name: ExtensionName, local: string): string;
/** 접두 규칙의 역함수. 형식이 맞지 않으면 undefined */
export function parseExtTableName(table: string): { readonly extension: ExtensionName; readonly local: string } | undefined;

export type SqlColumnType = "TEXT" | "INTEGER" | "REAL" | "BLOB";
/** 열 타입 대응(§4.4.3). 대응할 수 없는 스키마면 undefined */
export function columnTypeOf(schema: TSchema): { readonly sql: SqlColumnType; readonly json: boolean; readonly nullable: boolean } | undefined;

/** 순수 함수. CREATE TABLE·CREATE INDEX 문장. 식별자는 모두 큰따옴표로 감싼다 */
export function tableDdl(name: ExtensionName, local: string, def: ExtTableDef): Result<readonly string[], ExtStorageError>;
```

```ts
// storage/ext-storage.ts
type RowOf<D extends ExtTableDef> = Static<D["row"]>;

export interface ExtQuery<R> {
  /** 열 값 같음 조건의 AND. 범위 조건은 2차(§10 미결 9) */
  readonly where?: Partial<R>;
  readonly orderBy?: readonly { readonly column: keyof R & string; readonly dir?: "asc" | "desc" }[];
  /** 기본 100, 최대 1000 */
  readonly limit?: number;
  readonly offset?: number;
}

export interface ExtTableReader<R> {
  /** key 열을 모두 준다. 저장된 행이 선언한 스키마와 다르면 row_corrupt다 */
  get(key: Partial<R>): Result<R | undefined, ExtRowError>;
  /** 저장된 행 하나라도 선언한 스키마와 다르면 row_corrupt다 */
  list(query?: ExtQuery<R>): Result<readonly R[], ExtRowError>;
  count(where?: Partial<R>): number;
}

export interface ExtTableWriter<R> extends ExtTableReader<R> {
  /** 넘긴 행이 선언한 스키마와 다르면 row_invalid이고 아무것도 쓰지 않는다 */
  insert(row: R): Result<void, ExtRowError>;
  upsert(row: R): Result<void, ExtRowError>;
  update(key: Partial<R>, patch: Partial<R>): number;
  delete(key: Partial<R>): number;
}

/**
 * 행 값이 선언과 다른 경우는 데이터 문제이므로 값으로 돌려준다(eng.typescript.guide TY-24, review.open-issues N-08).
 * 존재하지 않는 열 이름 같은 호출 계약 위반(타입으로 막힌 입력)은 Bug다
 */
export type ExtRowError =
  /** 쓰려는 행이 ExtTableDef.row와 다르다(범위, 패턴 같은 형 검사 밖의 제약 포함) */
  | { readonly kind: "row_invalid"; readonly table: string }
  /** 저장된 행이 ExtTableDef.row와 다르다(손상, 수동 편집, 이전 버전, JSON이 아닌 JSON 열) */
  | { readonly kind: "row_corrupt"; readonly table: string };

export type ExtReaders<D extends ExtTableDefs> = { readonly [K in keyof D]: ExtTableReader<RowOf<D[K]>> };
export type ExtWriters<D extends ExtTableDefs> = { readonly [K in keyof D]: ExtTableWriter<RowOf<D[K]>> };

/** 확장의 투영. 코어 커밋 트랜잭션 안에서 동기로 실행된다(eng.events.design §5.1 규칙 1·2) */
export interface ExtProjection<D extends ExtTableDefs> {
  /** 올리면 그 확장의 테이블을 지우고 이벤트에서 다시 만든다 */
  readonly version: number;
  /** 관심 kind. 자기 접두 kind(x.<name>.…, grp.<name>.…)와 코어 kind만 쓸 수 있다 */
  readonly kinds: readonly EventKind[];
  /**
   * 순수 함수. 시계·난수·입출력을 쓰지 않는다. 쓰기 오류(ExtRowError)는 그대로 돌려준다.
   * 오류를 돌려주거나 예외를 던지면 코어 커밋 전체가 롤백되고 투영기 실패로 보고된다
   */
  apply(event: DurableEventEnvelope, tables: ExtWriters<D>): Result<void, ExtRowError>;
}

export interface ExtTables<D extends ExtTableDefs> {
  /** 실제 테이블 이름. 진단·삭제 확인 화면용 */
  readonly names: { readonly [K in keyof D]: string };
  /** 읽기 연결의 BEGIN DEFERRED. 트랜잭션 밖 핸들러에서 부른다 */
  read<T>(fn: (tables: ExtReaders<D>) => T): Result<T, ExtStorageError>;
}

export type ExtStorageError =
  | { readonly kind: "identifier_invalid"; readonly name: string }
  | { readonly kind: "reserved_table"; readonly local: string }
  | { readonly kind: "table_owned"; readonly table: string; readonly owner: ExtensionName }
  /** dropExtension이 넘긴 이름을 store가 그 확장 소유로 판정하지 않음(L0.store.spec table_not_owned, §4.4.7) */
  | { readonly kind: "table_not_owned"; readonly table: string }
  | { readonly kind: "column_type_unsupported"; readonly table: string; readonly column: string }
  | { readonly kind: "kind_not_owned"; readonly eventKind: string }
  | { readonly kind: "already_defined" }
  | { readonly kind: "isolated" }
  | { readonly kind: "busy" }
  /** 투영기 등록·접두 테이블 포트를 얻지 못함(§3.4 아래 경로) */
  | { readonly kind: "port_unavailable"; readonly port: string };

export interface ExtStorage {
  readonly extension: ExtensionName;
  /** extTablePrefix(extension) */
  readonly prefix: string;
  /** 확장마다 한 번. 투영기를 등록하고 테이블을 소유 장부에 올린다 */
  defineTables<const D extends ExtTableDefs>(defs: D, projection: ExtProjection<D>): Result<ExtTables<D>, ExtStorageError>;
}

/**
 * 확장 코드가 자기 저장 영역을 얻는 함수 [제안]. hostOf(g)(X.primitives.spec §3.8)와 같은 방식으로 setup이 받은 g를 받는다.
 * ext-host가 만든 g가 아니면 PrimitiveError("no_context"). 신뢰 등급의 저장 권한이 "none"이거나 격리 확장이면
 * defineTables가 isolated 오류를 낸다(X.loading-trust.spec §3.1 TRUST_MATRIX.storage, §4.9.6)
 */
export function storageOf(g: ScopeApi<unknown>): ExtStorage;
```

```ts
// storage/guard.ts
export type GuardViolation =
  | { readonly kind: "foreign_table"; readonly table: string }
  | { readonly kind: "forbidden_statement"; readonly keyword: string }
  | { readonly kind: "multiple_statements" };

/** 생성된 SQL 한 문장의 방어 검사. 테스트·디버그 빌드에서만 켠다(§4.4.4) */
export function checkStatement(sql: string, prefix: string): readonly GuardViolation[];
```

```ts
// storage/ext-storage.ts (계속) 호스트 쪽 관리 API. 확장에게 주지 않는다
export interface ExtTableRecord {
  readonly table: string;
  readonly extension: ExtensionName;
  readonly local: string;
  readonly projectionVersion: number;
  readonly createdAt: number;
}

export interface ExtStorageAdmin {
  tablesOf(extension: ExtensionName): Result<readonly ExtTableRecord[], ExtStorageError>;
  /** 소유 장부에 오른 테이블만 DROP한다. confirmed가 참이 아니면 아무것도 하지 않고 대상 목록만 돌려준다 */
  dropExtension(extension: ExtensionName, confirmed: boolean):
    Result<{ readonly dropped: readonly string[]; readonly pending: readonly string[] }, ExtStorageError>;
}
```

- 포트 경로: operations는 `OperationsDeps.ports`(`PortLookup`, X.primitives.spec §3.6)에서 포트를 꺼낸다. Cordis를 쓰지 않는다.
- 투영기 등록 경로: X는 `ExtProjection`을 F `Projector`(F.records.spec §3.9 `projector.ts`, `name: "ext.<확장 이름>"`, `version`, `tables`, `ddl`, `kinds`, `apply`)로 바꾸어 `ProjectorRegistryPortKey`(`xeon.session`의 `projectors` 속성, `core-persistence`)의 `register(projector)`로 등록한다. `ProjectorRegistryPort`는 `Pick<ProjectorRegistry, "register" | "onFailure">`이고(F.extensions.spec §3.2.1), `register`는 `Result<{ dispose(): void }, ProjectorRegisterError>`를 돌려준다(L1.persistence.spec §3.4). 오류면 `defineTables`가 실패한다. 받은 `dispose`는 확장 제거 때 투영기 해제(§4.4.7)에 쓴다. 투영기 apply 예외 통지는 같은 포트의 `onFailure`로 받아 자동 끄기(`projection_failed`, §5 6번)에 쓴다.
- 읽기 경로: `ScopedStorePortKey`(`xeon.store`)의 `scoped(owner).read`(`eng.transactions.design` §4.2)를 쓴다. `ScopedStorePort`는 `Pick<StoreService, "scoped">`이고 인자는 소유자 id다. 확장 테이블은 `scoped("ext.<확장 이름>")`이다(L0.store.spec §4.5 소유자 표).
- `storageOf(g)`는 g를 만든 `ExtHost`를 패키지 내부 함수(`hostInternalsOf`, X.primitives.spec §3.1)로 찾고, 그 `ExtHostDeps.policy`인 `OperationsPolicy`의 저장 관리자를 쓴다. 두 포트 중 하나라도 없으면 `defineTables`는 `port_unavailable`이다.
- 소유 장부 테이블은 `xh_ext_tables`다(`eng.context-map.design` §5.2 `xh_` 접두, extension-host 소유). 소유자 id `xh`로 `scoped("xh")`를 불러 쓴다(L0.store.spec §4.5 소유자 표).

### 3.5 이름 충돌 (`naming.ts`, 2차)

```ts
/** 이름 규칙을 적용하는 리소스. primitives ResourceKind의 나머지(provider, mcp_server, message_renderer)는 충돌 시 거부한다 */
export type NamedResourceKind = Extract<ResourceKind, "tool" | "command" | "shortcut" | "flag">;

export interface ResourceClaim {
  readonly kind: NamedResourceKind;
  readonly owner: ExtensionName;
  /** 등록 요청 이름(접두 없음) */
  readonly name: string;
  /** 내장 패키지(trust builtin)의 등록이면 참 */
  readonly builtin: boolean;
}

export interface ResolvedName {
  readonly claim: ResourceClaim;
  /** 항상 있는 정식 이름 */
  readonly qualified: string;
  /** 사용자·모델에 보이는 이름. 짧은 이름을 받지 못하면 qualified와 같다 */
  readonly exposed: string;
  readonly reason?: "reserved" | "conflict" | "too_long";
}

/** tool: "<owner>__<name>", 그 밖: "<owner>:<name>" */
export function qualifiedName(kind: NamedResourceKind, owner: ExtensionName, name: string): string;

/** 내장 예약 이름. 내장 패키지의 등록과 이 목록의 이름은 외부 확장이 짧은 이름으로 쓸 수 없다 */
export interface ReservedNames {
  readonly tool: ReadonlySet<string>;
  readonly command: ReadonlySet<string>;
  readonly shortcut: ReadonlySet<string>;
  readonly flag: ReadonlySet<string>;
}

/** 순수 함수. 결과는 입력 순서와 무관하다(§4.5) */
export function resolveNames(claims: readonly ResourceClaim[], reserved: ReservedNames): readonly ResolvedName[];

/**
 * X.primitives.spec §3.9 ResourcePolicy 구현. 집합 판정 exposeAll이 레지스트리가 쓰는 주 경로다. 같은 kind의 전체 레코드로
 * resolveNames를 부르고 레코드마다 노출 이름과 사유를 돌려준다. 그래서 먼저 등록된 쪽도 나중에 정식 이름으로 바뀐다(§4.5 규칙 3).
 * 쌍 판정 resolve는 집합 판정을 못 쓰는 호출자를 위해 들어오는 쪽만 정식 이름으로 바꾼다(rename). 같은 확장의 중복이나
 * 규칙 밖 kind는 reject다
 */
export function createResourcePolicy(reserved: ReservedNames): ResourcePolicy;

/** 예약 이름이 없는 값. 내장 패키지의 등록만 짧은 이름을 지킨다 */
export const NO_RESERVED_NAMES: ReservedNames;
```

### 3.6 안전 모드 (`safe-mode.ts`)

```ts
export type SafeModeSource = "flag" | "env" | "setting" | "command";

export interface StartupOptions {
  readonly safeMode: { readonly active: boolean; readonly source?: SafeModeSource };
  /** --disable-ext로 받은 이름. 이번 시작에만 적용한다 */
  readonly disabled: readonly ExtensionName[];
}

export interface LoadCandidate {
  readonly name: ExtensionName;
  readonly tier: Tier;
  readonly layer: ExtensionManifest["layer"];
}

export type SkipReason = "safe_mode" | "disabled_flag";

/** 순수 함수 */
export function startupFilter(candidates: readonly LoadCandidate[], options: StartupOptions): {
  readonly load: readonly LoadCandidate[];
  readonly skipped: readonly { readonly name: ExtensionName; readonly reason: SkipReason }[];
};

/** 안전 모드에서도 싣는 대상인지 */
export function allowedInSafeMode(candidate: LoadCandidate): boolean;

/** 연속 시작 실패 기록 포트. 구현과 파일 위치는 L4.host-service.spec [가정] */
export interface StartupHealthStore {
  /** 이번 시작을 "진행 중"으로 표시하고 직전까지의 연속 실패 수를 돌려준다 */
  beginStartup(): number;
  /** 첫 사용자 입력을 받을 준비가 되면 부른다. 연속 실패 수를 0으로 */
  markStarted(): void;
}

/** 순수 함수 */
export function shouldSuggestSafeMode(consecutiveFailures: number, threshold: number): boolean;
```

### 3.7 외부 훅 (`hooks/*.ts`, M4)

```ts
// hooks/config.ts
export const HOOK_ID_PATTERN = "^[a-z][a-z0-9-]{1,63}$";

/** 외부 훅이 참여할 수 있는 지점 */
export const HOOK_POINTS: readonly [
  "input.user.before", "input.bash.before", "tool.call.before", "tool.result",
  "session.start", "session.compact.before", "boundary.settle.after", "session.shutdown",
];
export type HookPointName = (typeof HOOK_POINTS)[number];

export const HookDefSchema = Type.Object({
  id: Type.String({ pattern: HOOK_ID_PATTERN }),
  point: Type.Union(/* HOOK_POINTS의 Literal */),
  /** 도구 지점(tool_call, tool_result)에서만. 정확 일치 목록. 생략하면 모든 도구 */
  tools: Type.Optional(Type.Array(Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }), { minItems: 1, maxItems: 64 })),
  /** argv. 셸을 거치지 않고 실행한다. 첫 원소는 실행 파일 */
  command: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 64 }),
  cwd: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("home")])),   // 기본 project
  timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 600_000 })),
  /** 부모 환경에서 넘길 변수 이름. 허용 목록(§4.7.5)과의 교집합만 넘긴다 */
  env: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Z_][A-Z0-9_]{0,63}$" }), { maxItems: 32 })),
});
export type HookDef = Static<typeof HookDefSchema>;

/** 설정 키 x.operations.hookDefs의 값 */
export const HookDefListSchema = Type.Array(HookDefSchema, { maxItems: 128 });

export type HookSource = "managed" | "user" | "project" | "local";
export interface LoadedHook {
  readonly def: HookDef;
  readonly source: HookSource;
  readonly tier: Tier;
  /** 외부 훅 순서. HandlerOrigin.loadIndex의 재료 */
  readonly index: number;
}
```

```ts
// hooks/protocol.ts
export const HOOK_SCHEMA_VERSION = "xeon.hook.v1";
export const HOOK_OUTPUT_MAX_CHARS = 10_000;
export const HOOK_STDERR_MAX_CHARS = 10_000;
export const HOOK_EXIT_DENY = 2;

/** stdin으로 보내는 한 줄 JSON */
export interface HookInput<N extends HookPointName = HookPointName> {
  readonly schemaVersion: typeof HOOK_SCHEMA_VERSION;
  readonly hookId: HookId;
  readonly point: N;
  readonly fold: PointSignatures[N]["fold"];
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly payload: PointSignatures[N]["payload"];
  /** chain 지점에서만. 앞 핸들러까지 누적된 값 */
  readonly current?: PointSignatures[N] extends { readonly value: infer V } ? V : never;
}

/** stdout JSON. 빈 출력은 {}와 같다 */
export const HookOutputSchema = Type.Object({
  /** first 지점. 지점의 결정 스키마(POINTS[point].result)로 다시 검사한다 */
  decision: Type.Optional(Type.Unknown()),
  /** chain 지점. 지점의 패치 스키마로 다시 검사한다 */
  patch: Type.Optional(Type.Unknown()),
  /** 진단용. 모델이나 대화에 넣지 않는다 */
  message: Type.Optional(Type.String({ maxLength: 2000 })),
}, { additionalProperties: false });
export type HookOutput = Static<typeof HookOutputSchema>;

/** 훅 실행 결과(HookRawRun)는 F 타입이다(F.extensions.spec §3.2.1). 여기서는 다시 export만 한다 */
export type { HookRawRun } from "@xeon/contracts/extensions";

export type HookVerdict =
  | { readonly kind: "pass" }
  | { readonly kind: "decision"; readonly decision: unknown }
  | { readonly kind: "patch"; readonly patch: unknown }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "failure"; readonly failure: Extract<FailureKind, `hook_${string}` | "timeout" | "result_invalid">; readonly detail: string };

/** 순수 함수. §4.7.3 종료 코드 표를 구현한다 */
export function interpretHookRun(point: PointDecl, run: HookRawRun): HookVerdict;
```

```ts
// hooks/run.ts
/**
 * 훅 실행 포트 HookProcessPort.run(spec: HookRunSpec): Promise<HookRawRun>은 F가 정본이다(F.extensions.spec §3.2.1).
 * ProcessPort(xeon.process, ProcessService extends ProcessPort, 구현 platform-process)의 부분형이다. 여기서는 다시 export만 한다
 */
export type { HookProcessPort, HookRunSpec } from "@xeon/contracts/extensions";

export const BASE_ENV_ALLOW: readonly string[];
// = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TERM", "SHELL"]

/** 이름에 이 단어가 있으면 허용 목록에 있어도 넘기지 않는다 */
export const SECRET_ENV_PATTERN: RegExp;   // /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i

/** 순수 함수 */
export function hookEnv(
  parent: Readonly<Record<string, string | undefined>>,
  def: HookDef,
  extraAllow: readonly string[],
  injected: { readonly hookId: HookId; readonly point: HookPointName; readonly threadId: ThreadId; readonly projectDir: string },
): Readonly<Record<string, string>>;
```

### 3.8 DispatchPolicy 연결 (`index.ts`)

`DispatchPolicy`의 정의는 `X.primitives.spec` §3.4가 소유한다. 모양은 필수 `tierOf(entry)`, `budgetMs(entry)`, `onHandlerFailure(failure)`와 선택 `onHandlerSettled(entry, activeMs)`, `run(entry, work, outer)`다. 선택 두 메서드는 이 문서의 요청(성공 보고, 사용자 응답 대기 제외)을 primitives가 받아들인 것이다 [제안]. `OperationsPolicy`는 다섯 자리를 모두 채운다.

```ts
export interface OperationsDeps {
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** x.operations.* 유효 값 읽기. 조립 루트(L4 host)가 설정 서비스에 연결해 넘긴다(PrimitivesSettingsSource와 같은 방식) */
  readonly settings: OperationsSettingsSource;
  readonly scopes: ScopeControl;
  readonly notifier: OperationsNotifier;
  readonly hooks: { disable(id: HookId): void; enable(id: HookId): void };
  /**
   * 포트 조회(X.primitives.spec §3.6). 저장 영역은 ProjectorRegistryPortKey·ScopedStorePortKey, 외부 훅은 ProcessPortKey를 꺼낸다.
   * 정책이 ExtHost보다 먼저 만들어지므로 조립 루트가 ExtHost.ports를 가리키는 늦은 연결로 넘긴다(ScopeControl과 같은 방식)
   */
  readonly ports: PortLookup;
}

export interface OperationsSettingsSource {
  budgets(): BudgetTable;                 // x.operations.budget.*
  autoDisable(): AutoDisablePolicy;       // x.operations.autoDisable.*
}

export interface OperationsPolicy extends DispatchPolicy {
  /** 성공 보고. 연속 실패 수를 0으로 돌리고 창에 넣는다(§4.3.2) */
  onHandlerSettled(entry: HandlerEntryInfo, activeMs: number): void;
  /** runWithBudget으로 핸들러를 실행한다. gate는 핸들러 UI 포트 래퍼에 넘어가 사용자 응답 대기를 뺀다(§4.2.3) */
  run<T>(
    entry: HandlerEntryInfo,
    work: (signal: AbortSignal, gate: BudgetGate) => T | Promise<T>,
    outer: AbortSignal | undefined,
  ): Promise<BudgetOutcome<T>>;
  readonly tiers: TierTable;
  readonly ledger: FailureLedger;
  readonly autoDisabler: AutoDisabler;
  /** 리소스 이름 충돌 판정(`createResourcePolicy(deps.reservedNames ?? NO_RESERVED_NAMES)`). 조립 루트가 ExtHostDeps.resourcePolicy에 넘긴다 */
  readonly resources: ResourcePolicy;
  /** 로더가 확장을 설치하기 전(X.loading-trust.spec §4.3.1 6a단계)에 부른다. assignTier 결과를 표에 넣고 면제 여부(essential)를 기억한다 */
  admit(info: Pick<LoadedExtensionInfo, "name" | "source" | "trust" | "essential">, layer: ExtensionManifest["layer"]): Result<Tier, TierError>;
  /** 확장 제거나 설치 실패 때 표와 장부에서 뺀다 */
  forget(name: ExtensionName): void;
  /** x.operations.budget.setupMs 유효 값. 조립 루트가 ExtHostDeps.setupBudgetMs에 넘긴다 */
  setupBudgetMs(): number;
  /**
   * 로더 5a단계가 부른다(2차). 후보마다 assignTier로 tier를 구한 뒤 §3.6 startupFilter를 적용한다.
   * 로더는 tier 계산 함수를 import하지 않고 이 메서드로 받는다
   */
  startupFilter(candidates: readonly TierInput[], options: StartupOptions): {
    readonly load: readonly ExtensionName[];
    readonly skipped: readonly { readonly name: ExtensionName; readonly reason: SkipReason }[];
  };
}

/** ExtHostDeps.policy에 넘긴다(X.primitives.spec §3.2) */
export function createOperationsPolicy(deps: OperationsDeps): OperationsPolicy;
```

- 조립 순서 [제안]: L4 host가 `createOperationsPolicy`를 먼저 만들고, 그 결과를 `ExtHostDeps.policy`, `ExtHostDeps.setupBudgetMs`(`() => policy.setupBudgetMs()`), `ExtHostDeps.resourcePolicy`(`policy.resources`)에 넣어 `createExtHost`를 부른다. 이어 `OperationsDeps.ports`와 `ScopeControl`의 늦은 연결을 그 `ExtHost`에 잇고, `createExtensionLoader({ host, policy, … })`로 로더를 만들어 `loadAll`을 부른다(`X.loading-trust.spec` §3.5). 로더는 확장마다 6a단계(설치 전)에서 `admit`을 부른다.
- `admit`이 `TierError`를 내면 로더는 그 확장을 설치하지 않는다(`tier_rejected`). 로더의 신뢰 판정(4단계)이 이미 같은 경우를 걸러내므로 이 오류는 방어 검사다.

## 4. 동작 규칙

### 4.1 실행 순서와 tier

#### 4.1.1 정렬

- [제안] 한 지점의 핸들러 순서는 `(tier 순위, loadIndex, registrationIndex)`의 사전식 오름차순이다. `F.extensions.spec` §4.2의 사전식 순서를 그대로 쓰고 첫째 키의 값 집합을 `TIERS`로 확정한다. 디스패처 쪽 표현은 `(DispatchPolicy.tierOf(entry), entry.loadIndex, entry.seq)`다(X.primitives.spec §3.4). `loadIndex`는 X.loading-trust.spec §3.3의 로드 순서다.
- tier 순위: `guard`(0) → `user`(1) → `project`(2) → `builtin`(3) → `core`(4). 바깥에서 안쪽 순서다.
- Claude Code mods의 tier 순서(① 내장 가드 `sec-default` + 조직 prepend, ② 사용자 설치, ③ 조직 append, ④ 기타 내장, ⑤ core)를 따른다(`_research/refs/claude-code.md` mods "순서" 항목). 다른 점은 둘이다.
  - 조직 append tier는 두지 않는다. 관리(managed) 범위 확장은 2차이고, 들어오면 `guard`에 둔다 [제안].
  - 사용자 tier와 내장 tier 사이에 `project`를 둔다. 프로젝트 폴더 확장은 사용자가 직접 설치한 확장보다 신뢰가 낮으므로 사용자 확장 안쪽에 둔다.
- 정렬 키는 디스패치 시작 때 스냅샷한 핸들러 목록에 한 번 적용한다(`F.extensions.spec` §4.2 스냅샷 규칙).

#### 4.1.2 tier 부여

tier는 X가 부여한다. 매니페스트에 tier 필드는 없고 두지 않는다 [제안].

| 설치 위치(`InstallSource`) | 유효 신뢰(`TrustLevel`) | 조건 | tier |
|---|---|---|---|
| `builtin` | `builtin` | 이름이 `GUARD_EXTENSIONS`에 있음 | `guard` |
| `builtin` | `builtin` | `layer`가 `L1` | `core` |
| `builtin` | `builtin` | `layer`가 `L2`, `L3`, `plugin` | `builtin` |
| `managed` | `builtin` 또는 `user` | 2차 | `guard` |
| `user` | `user` | | `user` |
| `project` | `project` | 프로젝트 신뢰 `allow` 뒤(X.loading-trust.spec §4.6.1) | `project` |
| 아무 출처 | `untrusted` | | 싣지 않음(`TierError.untrusted`). 로더도 import하지 않는다(`X.loading-trust.spec` §4.6.3) |
| `user`·`project`·`managed` | `builtin` | 로더가 먼저 `trust_exceeds_source`로 거부한다 | `TierError.source_trust_mismatch`(방어 검사) |

- 신뢰 등급과의 연결: tier는 신뢰 등급을 실행 순서로 옮긴 값이다. 신뢰가 높은 출처일수록 바깥에 있고, 바깥 tier의 결정은 안쪽 tier가 뒤집지 못한다(§4.1.3). 신뢰 판정 자체는 `X.loading-trust.spec`이다.
- L0 패키지는 on을 쓰지 않는다(`architecture.layers.spec` §4.3.3 2번). L0는 `ExtHost.registerPlatform`으로 포트만 제공하고(X.primitives.spec §3.2) tier를 받지 않는다. 그래서 `TierInput.layer`(`ExtensionManifest["layer"]`)에 L0가 없어도 빠지는 경우가 없다. 샌드박스 강제를 on 핸들러로 둘 필요가 생기면 `xeon.sandbox` 포트를 쓰는 L1 내장 확장이 맡고 그 확장을 `GUARD_EXTENSIONS`에 넣는다 [가정: `L0.sandbox.spec`은 강제를 실행 경로(`xeon.exec`)에서 하고 on 핸들러를 두지 않는다]. §10 미결 20.

#### 4.1.3 fold별 결과

| fold | tier 순서가 결과에 주는 영향 |
|---|---|
| `tap` | 실행 순서만 바뀐다. 결과는 없다 |
| `first` | 바깥 tier의 결정이 우선한다. 바깥 핸들러가 `undefined`가 아닌 값을 내면 안쪽 핸들러는 실행되지 않는다 |
| `chain` | 바깥에서 안쪽으로 적용한다. 안쪽 핸들러는 바깥 핸들러들이 만든 `current`를 받는다. 교체 규칙의 지점에서는 안쪽 패치가 바깥 패치를 덮어쓸 수 있다 |

예 1 (`first`, `tool.call.before`): `guard`의 권한 핸들러, `user` 확장 A, `builtin`의 Helm이 모두 `tool.call.before`에 걸려 있다. 권한 핸들러가 `{ block: true, reason: "denied by rule" }`을 내면 A와 Helm은 실행되지 않는다. 권한 핸들러가 `undefined`를 내고 A가 거부를 내면 Helm은 실행되지 않는다. `ToolCallDecision`에는 허용 변형이 없으므로(`F.extensions.spec` §3.5) 안쪽 확장이 바깥의 거부를 허용으로 바꾸는 경로가 없다.

예 2 (`first`, `session.trust.before`): 결정에 "신뢰함"이 있는 지점이다. 사용자 확장이 가드보다 바깥에 있으면 그 확장의 "신뢰함"이 가드를 건너뛴다. 그래서 가드는 가장 바깥 tier여야 한다.

예 3 (`chain`, `input.agent.before`): `guard`가 시스템 프롬프트에 안전 문구를 더하고, `user` 확장이 시스템 프롬프트를 교체하면 안전 문구는 사라진다. chain은 안쪽 핸들러가 값을 고칠 수 있는 fold다. 그래서 [제안] 보안 불변식은 chain 지점에 두지 않는다. 보안 판정은 first 지점(`tool.call.before`, `input.bash.before`, `session.trust.before`, `session_before_*`)과 L1의 최종 검증(`F.extensions.spec` §4.1 `finalize`, `L1.tools.spec`의 권한 판정)에 둔다. 가드 tier의 chain 핸들러는 기본값 제공 용도로만 쓴다.

예 4 (`chain`, `tool.result`): `user` 확장 A가 `content`를 요약으로 바꾸고, `builtin`의 학습 그룹이 `details`만 바꾼다. `CHAIN_RULES.tool_result`는 필드별 병합이라 두 변경이 모두 남는다. 순서가 바뀌어도 결과가 같다.

#### 4.1.4 샌드박스 강제 위치와 `tool_call` 처리 순서 [결정: M3-REQ-32]

샌드박스는 on 핸들러가 아니라 L0 실행 경로에서 강제합니다. X는 샌드박스를 알지 못하고, `GUARD_EXTENSIONS`에는 L1 권한 판정 핸들러(`core-tools`)만 있습니다(§10 미결 20 닫음).

| 구분 | 위치 | 하는 일 |
|---|---|---|
| 강제 | 도구 실행(`L1.tools.spec` §4.2 단계 8)이 부르는 `xeon.exec`의 `Shell`. 셸 도구는 `xeon.sandbox`의 `wrapShell(shell, policy)`로 감싼 `Shell`을 쓴다(`L0.sandbox.spec` §4.2) | 감싸기·거부·감싸지 않고 실행의 판정은 `decideExecution`(`L0.sandbox.spec` §4.5)이다. 결과의 `sandbox.unsandboxedBy`가 있으면 L1이 감사 이벤트 `tool.sandbox_bypassed`를 남긴다(`L1.tools.spec` §4.12) |
| 가장자리 | stdio MCP 서버 프로세스 | 출처별로 켬·끔을 정한다(`L0.sandbox.spec` §4.8, `L2.mcp.spec` §4.3) |
| 해당 없음 | 파일 도구, 웹 도구, 확장 코드 | 샌드박스로 감싸지 않는다. 파일 도구는 보호 경로 검사를 L1·L2가 한다 |

한 도구 호출이 지나는 순서는 아래와 같고 앞 단계의 거부가 뒤 단계를 실행하지 않습니다.

| 순서 | 단계 | 지점 또는 위치 | 거부하는 쪽 |
|---|---|---|---|
| 1 | 스키마 검증 | `prepare` 단계 4 | `core-tools` |
| 2 | `tool.call.before`(first), tier 순서 `guard` → `user` → `project` → `builtin` → `core` | 단계 5a | Helm 쓰기 거부는 기본 플러그인(`user` tier)의 first 핸들러라 여기서 나온다. 샌드박스를 부르기 전이다 [제안] |
| 3 | 정책 평가와 승인 | 단계 5b, 5c | `core-tools` 권한 판정 |
| 4 | `guard.tool.before`(first) | 단계 5c2 | 가드 핸들러 |
| 5 | 의도 커밋, 잠금, 슬롯 | 단계 6, 7 | — |
| 6 | 도구 실행. 셸 도구는 여기서 샌드박스를 거친다 | 단계 8 | `xeon.sandbox`(`sandbox_unavailable`, 쓰기·네트워크 위반) |
| 7 | `tool.result`(chain)와 결과 기록 | 단계 9, 10 | — |

- Helm 쓰기 거부가 샌드박스보다 먼저인 이유: 거부된 호출은 실행하지 않으므로 샌드박스의 허용·거부 판정이 필요 없고, 승인 대기와 감사 이벤트도 남기지 않습니다. 샌드박스는 허용된 호출의 마지막 방어선입니다.
- 샌드박스를 쓸 수 없을 때(`disable_execute`, `ask`)의 결과는 거부 오류이고, `run_unsandboxed`이면 실행한 뒤 `tool.sandbox_bypassed`가 남습니다.
- 확장이 `tool.call.before`에서 샌드박스를 우회하게 하는 경로는 없습니다. 이 지점의 결정에는 허용 변형이 없고(`ToolCallDecision`), `allowEscape`는 호출자(도구 구현)만 정하며 항상 승인 대상입니다(`L0.sandbox.spec` §4.2).

### 4.2 핸들러 시간 예산

#### 4.2.1 선례 비교

| 출처 | 기본 예산 | UI 대기 | 초과 시 | 근거 |
|---|---|---|---|---|
| omp | 모든 핸들러 30초, `session.shutdown` 2초 | 대화상자·승인 동안 정지(`HandlerTimeoutBudget` pause/resume) | `tool.call.before`은 차단, 나머지는 건너뜀 | omp `runner.ts:133-200`(상수, `handlerTimeoutForEvent`, `createHandlerUIContext`), `:300-375`(`raceHandlerWithTimeout`), `_research/refs/oh-my-pi.md` 125·274행 |
| Claude Code mods | 핸들러 10초(`prompt.edit` 50ms), `.catch` 1초 | `$.ui.ask` 대기 미산입 | 건너뜀(fail-open), `.catch`로 fail-closed 선택 | `_research/refs/claude-code.md` mods "실패 격리" 항목 |
| Claude Code 설정 훅 | command 600초(일부 30초·10초), SessionEnd 1.5초 | 해당 없음 | 비차단(`onFailure:"block"`으로 차단 선택) | `_research/refs/claude-code.md` hooks 항목 |
| Hermes | 핫패스 훅과 `pre_tool_call` 30초 | 확인 안 함 | `pre_tool_call`은 차단, 나머지 건너뜀 | `_research/refs/hermes.md` 304행 |
| pi | 없음 | 해당 없음 | 해당 없음 | pi `runner.ts`(예산 코드 없음, 오류는 `emitError`) |

#### 4.2.2 기본값

[제안] 지점 종류와 fold로 예산 등급을 정한다(`budgetClassOf`).

| 등급 | 대상 | 기본(ms) | 이유 |
|---|---|---|---|
| `first` | fold가 `first`인 지점 10개(guard 3개 포함) | 30,000 | 정책 판정이 외부 정책 파일이나 판정 모델을 볼 수 있다. omp·Hermes와 같은 값 |
| `chain` | fold가 `chain`인 지점 10개와 `collect`인 지점 2개 | 10,000 | 모델 요청마다(`request.context.before`, `request.provider.before`) 또는 커밋 직전(`boundary.step.after`, `boundary.settle.before`)에 실행되어 지연이 사용자에게 바로 보인다. Claude Code mods와 같은 값 |
| `tap` | `await` tap 중 아래 둘을 뺀 것 | 5,000 | 결과가 없으므로 기다릴 이유가 적다 |
| `streamTap` | `STREAM_TAP_POINTS` 3개 | 1,000 | 토큰·진행 조각마다 실행된다 |
| `shutdown` | `session.shutdown` | 2,000 | 종료를 붙잡지 않는다(omp issue #2600 주석) |
| `setup` | 엔트리 본문과 scope setup 실행(`ExtHost.install`, X.primitives.spec §4.5.3, §4.5.6) | 10,000 | 시작 시간을 붙잡지 않는다. 넘으면 primitives가 그 scope의 fiber를 해제해 등록을 되돌리고, 로더가 `setup_timeout` 진단을 남긴다(X.loading-trust.spec §4.4.3) |
| `hook` | 외부 훅(§4.7) | 30,000 | 프로세스 시작 비용을 포함한다. 훅 정의의 `timeoutMs`가 우선한다(최대 600,000) |

- `dispatch: "detached"` tap(5개)도 예산을 받는다. 디스패처는 그 핸들러의 완료를 대기하지 않고 진행하지만, 예산을 넘으면 signal을 abort하고 실패로 센다.
- 예산은 핸들러 호출 한 번 단위다. 한 지점 전체의 합계 상한은 두지 않는다 [제안]. 합계는 §4.2.6의 지연 계산과 느린 지점 진단으로 다룬다.

#### 4.2.3 사용자 응답 대기 제외

- 핸들러가 사용자 응답을 기다리는 동안 예산 시계를 멈춘다. 대상은 `ctx.ui`의 대화상자(확인, 선택, 입력)와 승인 요청(`xeon.approvals`) 대기다.
- 방식은 omp와 같다. X가 핸들러에 주는 UI 포트를 감싸서 대기 앞뒤로 `BudgetGate.pause()`·`resume()`을 부른다(`awaitUser`). 중첩 대기는 깊이를 세고 0이 될 때 다시 잰다.
- 디스패처는 `DispatchPolicy.run`이 있으면 자기 타이머 대신 그 함수로 핸들러를 실행한다(X.primitives.spec §3.4, §4.2). `OperationsPolicy.run`은 `runWithBudget`으로 실행하고, 그 `gate`를 핸들러의 UI 포트 래퍼에 넘긴다.
- 멈춘 동안에도 `outer` 중단 신호와 대화상자 자체의 signal은 살아 있다. 예산 signal은 대화상자 signal과 `AbortSignal.any`로 합친다(omp `attachHandlerSignal`과 같은 방식).
- 비대화 실행(CLI print 모드)에서는 대화상자가 바로 기본값으로 끝나므로 멈춤 시간이 0이다.
- [결정: review.decisions-2 U-07] `HandlerContext.ui`는 두지 않는다. 핸들러용 UI 포트는 X 공개 API의 별도 함수로 연결한다(F 타입에는 넣지 않는다)(M2, O-07). 핸들러(와 그 핸들러가 부르는 UI·승인 포트 래퍼)는 `hostOf(g).awaitUser(wait, { signal? })`로 사용자 응답 대기를 감싼다. 이 함수는 호출한 핸들러의 `gate`와 취소 신호를 비동기 맥락에서 찾아(X.primitives.spec §4.2 `withAmbient`) `gate.pause()`·`resume()`으로 예산 시계를 멈추고, `wait`에는 핸들러 신호와 호출자의 신호를 `AbortSignal.any`로 합쳐 넘긴다. 핸들러 밖(drive 함수, setup)에서는 예산이 없으므로 그대로 실행한다. 승인 대기(`xeon.approvals`)를 부르는 L2 포트 래퍼도 같은 함수를 쓴다. 게이트 쪽 함수 `awaitUser(gate, wait)`는 패키지 안에서 `hostOf(g).awaitUser`가 쓴다.

#### 4.2.4 예산 초과 처리

1. 예산이 끝나면 핸들러 signal(`HandlerContext.signal`)을 `DOMException("…", "TimeoutError")`로 abort한다.
2. 디스패처는 그 핸들러의 완료를 대기하지 않고 다음 핸들러로 진행한다. 늦게 온 반환값과 예외는 버린다.
3. fold별 처리는 `F.extensions.spec` §4.1 세 줄을 그대로 적용한다. 예산 초과는 예외와 같다.
   - `tap`: 기록하고 계속한다.
   - `first`: `FIRST_DENY[point]`를 결정으로 쓴다. 예: `tool.call.before`은 `{ block: true, reason: "extension handler failed", terminate: false }`. `session.trust.before`는 불신, `session_before_*`는 취소다.
   - `chain`: 그 핸들러의 패치를 버리고 `current`를 다음 핸들러에 넘긴다.
4. 실패 장부에 `timeout`으로 기록한다(§4.3).

#### 4.2.5 시간 예산 밖

- drive: drive 함수와 `loop.turn`·`loop.spawn` 대기는 시간 예산을 받지 않는다. 제한은 drive 임대 상한(`DriveLimits`, `x.primitives.driveLimits`)뿐이다([결정] `_research/decisions-log.md` 2026-10-21 계획 v2 "예산은 pi 방식", adr.0007 §3.5). `runWithBudget`을 `budgetMs: null`로 부른다.
- 이 문서의 "예산"은 핸들러 실행 시간이다. 모델 비용·단계 수 상한과는 다른 대상이고, 그런 상한은 두지 않는다는 [결정]과 충돌하지 않는다.
- 리소스 등록 함수(도구 실행 함수 등)의 실행 시간은 도구 실행 규칙(`L1.tools.spec`)이 다룬다.

#### 4.2.6 트랜잭션 지연과의 관계

- 확장 기여(`first`, `chain` 결과)는 커밋 전에 트랜잭션 밖에서 계산하고 결과만 커밋에 넣는다(`eng.transactions.design` §4.1, TX-01). 그래서 핸들러 예산은 DB 쓰기 잠금 시간에 들어가지 않는다. 늘어나는 것은 커밋 시점까지의 지연이다.
- 커밋 지점별 최악 지연은 그 지점 핸들러 예산의 합이다. 예: `boundary.step.after`(C5·C6 앞)에 chain 핸들러가 3개면 최대 30초 늦게 커밋된다. `tool.call.before`(C3 앞)에 first 핸들러가 2개면 최대 60초다.
- [제안] 한 지점의 핸들러 실행 시간 합이 1초를 넘으면 느린 지점 진단(운영 로그, `xeon doctor` 출력 후보)을 남긴다. 사용자 알림은 하지 않는다.
- 예산 초과로 커밋에 들어가는 값: first는 거부값, chain은 그때까지의 `current`다. 둘 다 결정적이므로 재생 규칙(`F.extensions.spec` §4.3)과 충돌하지 않는다.

### 4.3 실패 격리와 자동 끄기

#### 4.3.1 실패 분류

| 결과 | 분류 | 장부 |
|---|---|---|
| 정상 반환(`undefined` 포함) | `ok` | 연속 수 0으로 |
| 예외 | `threw` | 실패 |
| 예산 초과 | `timeout` | 실패 |
| first 결정·chain 패치의 스키마 위반 | `result_invalid` | 실패 |
| chain 병합 함수 예외(예: `boundary.message.after` role 불일치) | `merge_rejected` | 실패 |
| tap 핸들러가 값을 반환 | `value_from_tap` | 기록만, 실패 아님 |
| 격리 확장 프로세스의 비정상 종료로 끝난 호출 | `isolation_exited` | 실패 |
| 외부 훅의 비정상 종료·출력 위반·시작 실패 | `hook_exit`, `hook_output`, `hook_spawn` | 실패 |
| `outer` 중단(사용자 중단, 세션 종료, 임대 회수)으로 끝남 | `aborted` | 넣지 않음 |

- 외부 훅의 exit 2는 의도한 거부이므로 실패가 아니다(§4.7.3).
- 확장의 로드 실패(setup 예외, 매니페스트 오류)는 `X.loading-trust.spec`이 다루고 이 장부에 넣지 않는다. 프로세스가 시작 중에 죽는 경우는 §4.6.4가 센다.

#### 4.3.2 확장 단위 집계

- 장부 키는 확장 이름(`ext:<name>`)이다. 한 확장의 모든 scope와 지점을 합쳐 센다. 외부 훅은 훅 id(`hook:<id>`)로 따로 센다.
- 연속 실패 수: 실패마다 1을 더하고 `ok`가 오면 0으로 돌린다. `ok`는 `DispatchPolicy.onHandlerSettled` 보고로 안다(X.primitives.spec §3.4).
- 최근 호출 창: 최근 `windowSize`번의 호출(`aborted` 제외)에서 실패 수를 센다.
- 장부는 프로세스 메모리에만 있다. 재시작하면 비어 있다 [제안]. 영속 기록이 필요한 정보(자동 끄기 사실)는 이벤트로 남긴다(§4.3.4).

#### 4.3.3 자동 끄기

[제안] 다음 중 하나를 만족하면 그 확장을 자동으로 끈다(`judgeAutoDisable`).

1. 연속 실패 수 ≥ `consecutive`(기본 5)
2. 창 실패 수 ≥ `minFailures`(기본 10)이고 창 실패율 ≥ `failureRate`(기본 0.5). 창 크기 기본 50

적용 규칙:

- 끄기는 `ScopeControl.requestDisable(scopeId, "auto_disable")`로 그 확장의 모든 scope에 요청한다. 적용은 다음 단계 경계다(`F.extensions.spec` §4.5). 실행 중인 디스패치와 step은 끊지 않는다.
- 요청 뒤 적용 전까지의 호출도 실패 처리 규칙은 그대로 적용한다. 그 사이의 실패는 장부에 넣지만 두 번째 요청을 만들지 않는다.
- drive 임대를 가진 그룹이 꺼지면 임대 반납 순서는 `F.extensions.spec` §4.5 비활성화 적용 순서를 따른다(`lease.released`의 `reason: "disabled"`).
- 예외: `AUTO_DISABLE_EXEMPT_TIERS`(`guard`, `core`)와 `essential: true` 확장(X.loading-trust.spec §4.3.2)은 끄지 않는다. 이 tier의 실패는 fold 규칙대로 처리하고(가드의 first는 거부로 남아 fail-closed가 유지된다) 알림만 보낸다. 사용자가 이 tier를 끌 수 없는 이유는 보안 가드와 코어 기본 동작이 빠지면 안전과 기본 기능이 함께 빠지기 때문이다.
- 외부 훅은 같은 기준으로 그 훅만 끈다. 훅 끄기는 다음 디스패치부터 적용한다(훅은 scope가 없다).
- 자동 끄기 상태는 설정 파일에 쓰지 않는다 [제안]. `ext.<name>.enabled` 값은 바뀌지 않고, 다음 시작에서 다시 실린다. 반복되는 경우는 §10 미결 7이다.

#### 4.3.4 알림과 기록

- 실패마다 휘발 이벤트를 보낸다. kind `scope.handler_failed`(코어 영역 `scope`, 휘발)이며 F.records 코어 카탈로그(`ScopeHandlerFailedPayloadSchema`)에 있다(§10 미결 4). payload는 `{ owner: HandlerOwnerKey, point, result, message, consecutive }`다. `message`는 `outcome.message ?? ""`를 4000자로 자른 값이고, `consecutive`는 1 이상이다. L4는 같은 확장의 알림을 묶어 보인다.
- 구현은 `createVolatileNotifier`(`operations/auto-disable.ts`)다. `handlerFailed`는 `createLogNotifier`와 같은 운영 로그 줄을 남기고 `emit`으로 페이로드를 보낸다. `autoDisabled`는 운영 로그 줄만 남긴다. 자동 끄기 사실은 아래 `scope.changed`가 이미 적는다.
- `emit`이 던지면 호출자에게 던지지 않고 `scope.handler_failed not emitted: <owner> <point> (<원인 메시지>)` 줄을 운영 로그에 남긴다.
- 조립 루트(`apps/host`)가 이 구현을 `createOperationsPolicy`의 `notifier`로 넘긴다. `emit`은 열린 thread마다 휘발 이벤트를 보내고(`L4.host-service` HS-80), `log`는 운영 로그다. `notifier`를 생략한 조립(시험 등)은 `createLogNotifier`를 쓴다.
- 자동 끄기가 적용되면 `scope.changed`(내구, `F.records.spec` §3.3)를 `status: "disabled"`로 남긴다. 사유는 payload의 `reason` 필드(`ScopeChangeReason`, `F.records.spec` §3.3)로 구분한다. 사유를 primitives에 넘기는 인자는 §10 미결 4의 남은 일이다.
- 사용자 알림 문구 예: "확장 acme-notes가 연속 5번 실패해 꺼졌다. 다시 켜기: xeon ext enable acme-notes". 문구와 위치는 `L4.cli.spec`, `L4.settings-ui.spec`이 정한다.

#### 4.3.5 다시 켜기

- 사용자가 명령(`xeon ext enable <name>`과 대화 중 같은 이름의 슬래시 명령 [제안], X.primitives.spec §6의 명령 가정과 같은 이름, 소유 `L4.cli.spec`)이나 설정 화면 토글로 다시 켠다. `AutoDisabler.reenable`이 장부를 비우고 `requestEnable(…, "request")`를 부른다.
- 자동으로 다시 켜지 않는다. 재시작하면 장부가 비어 다시 실린다(§4.3.3).
- 다시 켠 뒤 같은 기준으로 다시 꺼질 수 있다. 시간 간격 조건(쿨다운)은 두지 않는다 [제안].

### 4.4 확장 전용 저장 영역

#### 4.4.1 위치와 원칙

- [결정] DB 파일은 하나이고 확장 기록은 확장별 접두 테이블에 둔다. 확장을 지울 때 접두 테이블만 지운다(adr.0004 §3.1, §3.3).
- [결정] outbox는 별도 프로세스로 격리한 확장에만 쓴다(adr.0004 §3.3). 격리 확장에서 `defineTables`는 `isolated` 오류다. 격리 확장의 기록 경로는 `X.loading-trust.spec`과 `eng.transactions.design` §7 표의 격리 행을 따른다.
- [제안] 확장에게 원시 SQL을 열지 않는다. 확장은 `ExtStorage`의 타입 있는 API로만 자기 테이블을 정의하고 읽고 쓴다. 테이블 이름 접두는 API가 붙인다.

#### 4.4.2 테이블 이름

- 형식: `x_<확장 이름의 하이픈을 밑줄로 바꾼 값>_<지역 이름>`. 예: 확장 `acme-notes`, 지역 이름 `pins` → `x_acme_notes_pins`.
- [결정: review.decisions-2 U-18] 확장 이름(`ExtensionName`)은 `^[a-z][a-z0-9-]{1,31}$`(소문자, 숫자, 하이픈)이고 밑줄을 쓰지 않는다. 테이블 접두는 `x_<확장 이름의 하이픈을 밑줄로>_`이고 지역 이름에는 밑줄을 쓰지 않는다. adr.0004 §3.3의 `[a-z0-9_]` 제한은 이 규칙으로 바뀐다.
- 지역 이름은 `^[a-z][a-z0-9]{0,31}$`이고 밑줄을 쓰지 않는다. 확장 이름에는 밑줄이 없으므로, 테이블 이름의 마지막 밑줄 뒤가 지역 이름이고 `x_`와 마지막 밑줄 사이가 확장 이름(밑줄 → 하이픈)이다. 그래서 확장 `a`의 지역 이름 `bc`(`x_a_bc`)와 확장 `a-b`의 지역 이름 `c`(`x_a_b_c`)가 겹치지 않는다(`parseExtTableName`).
- 인덱스 이름은 `<테이블 이름>__i<번호>`다. 확장은 인덱스 이름을 지정하지 않는다.
- `RESERVED_LOCAL_TABLES`(`state`, `meta`)는 X가 쓴다. `state`는 X.primitives.spec §4.6.1의 scope 상태 투영 테이블 `x_<name>_state`다. `meta`는 예비다.
- 열 이름은 `^[a-z][a-z0-9_]{0,62}$`이고 `thread_id`는 `perThread` 테이블에서 X가 붙이므로 확장이 정의할 수 없다.
- 같은 정규식을 `F.extensions.spec` `EXTENSION_NAME_PATTERN`, `eng.context-map.design` §5.2·CM-07 `EXT_ID_PATTERN`, `eng.domain-types.guide` DT-08, `eng.events.design` §4.5, `L0.store.spec`이 쓴다(§10 3번, 해소).

#### 4.4.3 정의와 DDL

- `defineTables(defs, projection)`은 확장마다 한 번 부른다. 두 번째 호출은 `already_defined`다.
- 열 타입 대응(`columnTypeOf`) [제안]:

  | TypeBox 스키마 | SQL 열 | 저장 |
  |---|---|---|
  | `Type.String` | `TEXT` | 그대로 |
  | `Type.Integer` | `INTEGER` | 그대로 |
  | `Type.Number` | `REAL` | 그대로 |
  | `Type.Boolean` | `INTEGER` | 0·1 |
  | `Type.Uint8Array` [가정: TypeBox 1.3.27에 있는 이름] | `BLOB` | 그대로 |
  | `Type.Object`, `Type.Array`, 그 밖 | `TEXT` | `JSON.stringify`, 읽을 때 행 스키마로 검사 |
  | `Type.Optional(…)`, `null` 포함 유니온 | 위 대응 + `NULL` 허용 | |

- DDL은 `CREATE TABLE IF NOT EXISTS "x_…" (…) STRICT`와 `CREATE INDEX IF NOT EXISTS`만 만든다. 식별자는 모두 검사한 뒤 큰따옴표로 감싼다. 값은 항상 바인딩 인자로 넘긴다.
- DDL은 `ExtProjection`과 함께 `Projector.ddl`로 세션 저장소에 넘긴다. 테이블 생성과 다시 만들기는 투영기 수명 규칙(`eng.events.design` §5.1 규칙 4)을 따른다.
- 소유 장부 `xh_ext_tables`에 `(table, extension, local, projectionVersion, createdAt)`를 쓴다. 이미 다른 확장이 소유한 이름이면 `table_owned`다.

#### 4.4.4 쓰기와 같은 트랜잭션

- [제안] 확장 테이블 쓰기는 확장 투영(`ExtProjection.apply`)으로만 한다. 투영기는 코어 커밋 트랜잭션 안에서 이벤트마다 실행되므로(`eng.transactions.design` §4.3 "cap·ext 투영", §4.4 4단계), 확장 쓰기는 코어 커밋과 같은 트랜잭션에 들어간다. 코어 커밋이 롤백되면 확장 쓰기도 롤백된다.
- 확장이 커밋에 이벤트를 넣는 경로는 기존 셋이다. boundary chain 결과의 `entries`, `ScopeApi.commit`(scope 상태), `ScopeApi.record`(그룹 레코드)(`F.extensions.spec` §3.2, §3.5). 확장 투영은 이 이벤트를 받아 자기 테이블을 고친다.
- L0 트랜잭션 핸들은 X가 직접 쥐지 않는다. X는 투영기를 `xeon.session`에 등록하고, `SessionWriter.commit`이 트랜잭션 안에서 `ProjectionTx`를 투영기에 넘긴다. X는 그 `ProjectionTx`를 `ExtWriters`로 감싼다. 이것이 "L0.store 트랜잭션 핸들을 SessionWriter 경유로 받는 방식"이고, `F.records.spec` §3.8의 [제안](확장 테이블 쓰기를 같은 트랜잭션에 넣는 방법은 `L0.store.spec`과 X가 정한다)에 대한 X 쪽 답이다.
- `apply`는 동기 순수 함수다. 시계, 난수, 네트워크, 파일을 쓰지 않는다(`eng.events.design` §5.1 규칙 1, TX-01). 쓰기 메서드가 돌려준 `ExtRowError`는 `apply`의 반환값으로 올린다(`return tables.pins.upsert(…)`). `apply`가 오류를 돌려주면 X가 투영기 `apply` 안에서 `ProjectionRollback`을 던져 커밋 전체를 롤백하고, 저장소는 `ProjectorFailure`로 알린다(`F.records.spec` §3.9). `apply`가 예외를 던져도 같다. 이 실패는 핸들러 실패 장부에 넣지 않는다(커밋 경로의 문제이고 `projection_failed`로 자동 끄기에 쓴다).
- `kinds`에는 자기 접두 kind와 코어 kind만 둘 수 있다. 다른 확장의 kind를 넣으면 `kind_not_owned`다. 다른 그룹의 공개 정보는 `ScopeApi.readRecords`로 읽는다(`F.extensions.spec` §4.8).
- 재생: 투영 테이블은 이벤트에서 다시 만들 수 있다. `ExtProjection.version`을 올리면 그 확장 테이블만 지우고 이벤트 전체를 재생해 다시 만든다. 이것이 1차의 스키마 마이그레이션 방식이다.
- 이벤트에서 다시 만들 수 없는 부가 데이터(캐시, 외부에서 가져온 자료)를 둘 테이블과 그 마이그레이션(열 추가 등)은 2차다(§10 미결 8).

#### 4.4.5 읽기

- `ExtTables.read(fn)`은 읽기 연결의 트랜잭션에서 동기로 실행한다. `fn`이 `get`·`list`로 얻은 `Result`는 `read`의 결과 안에 그대로 담긴다(`Result<Result<행, ExtRowError>, ExtStorageError>`). 연결이 바쁜 오류(`busy`)와 행 오류(`row_corrupt`)가 층으로 나뉜다. 핸들러, drive 함수, 리소스(도구) 실행 함수에서 부를 수 있다. 투영 `apply` 안에서는 `ExtWriters`의 읽기 메서드를 쓴다(같은 트랜잭션의 쓰기 결과가 보인다).
- `list`의 `limit` 기본값은 100, 최대 1000이다. 더 큰 값은 1000으로 줄인다.

#### 4.4.6 접두 밖 접근 차단

| 방식 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 쿼리 래퍼 | 확장은 타입 있는 API만 쓰고 SQL은 X가 만든다. 식별자는 정규식 검사 후 인용, 값은 바인딩 | 우회 경로가 API 표면에 없다. 운영 빌드에서도 비용이 작다 | 표현력이 API로 제한된다(조인, 집계 없음) |
| B. 문장 검사 | 확장이 SQL을 쓰고, 실행 전에 문장에서 테이블 이름을 뽑아 접두와 대조한다 | 표현력이 크다 | 정규식 추출은 CTE, 하위 쿼리, `sqlite_master`, `ATTACH`, 주석 속 이름에서 오탐·누락이 생긴다. SQLite 파서 없이 완전한 검사가 어렵다 |
| C. SQLite authorizer | `sqlite3_set_authorizer`로 엔진이 테이블 접근을 판정한다 | 가장 강하다 | `bun:sqlite`가 authorizer를 노출하는지 확인하지 않았다 [가정: 노출하지 않음] |

- [제안] A를 쓴다. B는 방어 검사로 겹쳐 둔다. A가 만든 SQL 문장을 `checkStatement`로 다시 검사해 접두 밖 테이블, 금지 키워드(`ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`, `sqlite_`), 여러 문장을 거부한다. 이 검사는 테스트·디버그 빌드에서만 켠다. L0의 `ProjectionTx`·`StoreService.scoped` 소유 테이블 검사(`eng.events.design` §5.1, `eng.transactions.design` §4.2)와 같은 위치다.
- C는 `bun:sqlite`가 지원하는지 확인한 뒤 2차 강화 후보로 둔다(§10 미결 9).
- 같은 프로세스의 확장 코드는 메모리상 다른 객체에 접근할 수 있다. 이 차단은 실수와 우연한 침범을 막는 장치다. 악의적 코드에 대한 경계는 프로세스 격리(`X.loading-trust.spec`, 2차)다.

#### 4.4.7 삭제

- 확장을 제거할 때 `X.loading-trust.spec` §4.4.5의 제거 흐름이 `ExtStorageAdmin.dropExtension(name, confirmed)`를 부른다.
- 먼저 `ExtensionLoader.previewRemoval`이 `confirmed: false`로 대상 테이블 목록을 받아 사용자에게 보인다. 사용자가 확인하면 `ExtensionLoader.remove(name, { dropTables: true })`가 `confirmed: true`로 다시 부른다. 확인 화면은 L4가 만든다.
- 지우는 대상은 `xh_ext_tables`에 그 확장 이름으로 오른 테이블뿐이다. `LIKE 'x_…%'` 같은 접두 패턴 삭제는 하지 않는다. 확장 `a`를 지울 때 확장 `a-b`의 테이블이 지워지지 않게 하기 위해서다.
- 목록 전달: `dropExtension(name, true)`는 소유 장부에서 그 확장 이름의 테이블 이름 목록을 읽어 `xeon.store`의 `extensions.drop(name, tables)`(`L0.store.spec`)에 정확한 이름 목록으로 넘긴다. store는 목록의 모든 이름이 `name`의 소유인지 먼저 확인하고, 하나라도 아니면 아무것도 지우지 않고 `table_not_owned`를 돌려준다. 이때 `dropExtension`은 `ExtStorageError`로 바꾸어 돌려주고 소유 장부를 고치지 않는다. 성공하면 지운 테이블의 장부 행을 지운다.
- 이벤트(`x.<name>.*`, `grp.<name>.*`)는 남긴다(`eng.context-map.design` §5.2 마지막 항목). 같은 확장을 다시 설치하면 투영 재생으로 테이블이 다시 만들어진다.
- 사용자가 확인하지 않고 제거하면 테이블은 남고 투영기만 해제된다. 남은 테이블은 "주인 없는 확장 테이블"로 `xeon doctor` 진단에 나온다 [제안].

#### 4.4.8 scope 상태 문서와의 관계

- scope 상태 문서(`ScopeApi.commit`)는 확장의 정본 상태다. 이벤트 kind로 커밋되고 kind 이름과 형식은 `X.primitives.spec`이 정한다.
- 접두 테이블은 확장의 부가 데이터다. 상태 문서보다 크거나 질의가 필요한 자료(목록, 색인, 집계)를 둔다. 접두 테이블의 내용은 이벤트(상태 커밋, 그룹 레코드, boundary entries)에서 투영으로 만든다.
- 상태 문서는 다른 그룹이 읽지 않는다. 접두 테이블도 다른 확장이 읽지 않는다. 공개할 정보는 그룹 레코드로 낸다(`F.extensions.spec` §3.6).
- 확장 kind 접두는 F 규칙(`x.`/`grp.`, `F.records.spec` §3.2)이다. `eng.transactions.design`·`eng.events.design`도 같은 접두로 고쳤다([결정: review.decisions-2 T-21]).

### 4.5 이름 충돌 (2차)

[제안] 도구, 명령, 단축키, 플래그 네 종류에 같은 규칙을 쓴다. 근거는 Claude Code의 `플러그인:이름` 네임스페이스(`_research/refs/claude-code.md` 101행, 310행)다.

1. 모든 리소스는 정식 이름을 가진다. 명령·단축키·플래그는 `<확장 이름>:<이름>`, 모델 도구는 `<확장 이름>__<이름>`이다. 도구 이름 허용 문자(`^[a-zA-Z0-9_-]{1,64}$`, `F.capabilities.spec` §3.1)에 `:`가 없기 때문이다. 확장 이름에는 밑줄이 없으므로 첫 `__`가 경계다.
2. 내장 이름 예약: 내장 패키지(trust `builtin`)가 등록한 이름과 `ReservedNames` 목록은 외부 확장이 짧은 이름으로 쓸 수 없다. 외부 확장의 그 등록은 정식 이름으로만 노출한다(`reason: "reserved"`).
3. 외부 확장 둘 이상이 같은 짧은 이름을 요청하면 아무도 짧은 이름을 받지 않고 모두 정식 이름으로 노출한다(`reason: "conflict"`). 로드 순서와 관계없이 규칙으로 정한다. 확장 하나를 끄거나 지우면 다음 해소에서 남은 확장이 짧은 이름을 받는다.
4. 정식 이름이 64자를 넘는 도구는 등록을 거부한다(`reason: "too_long"`, 진단).
5. 해소는 리소스 집합이 바뀔 때(확장 켜기·끄기 적용 시점, 단계 경계) 다시 한다. 도구 목록이 바뀌면 프롬프트 캐시 접두가 바뀐다. 도구 순서는 `F.capabilities.spec` §4.5의 순서 키(확장 도구는 `ext.<확장 이름>`)를 따르므로 해소 결과와 무관하게 결정적이다.
6. 같은 확장 안의 중복 등록은 리소스 등록 단계의 오류다(`X.primitives.spec`).
7. 단축키는 충돌하면 어느 쪽도 짧은 키를 받지 않는다. 사용자가 키 바인딩 설정으로 직접 지정한다. 키 바인딩 파일은 `L4.cli.spec`, `L4.desktop.spec` 소유다.
8. 플래그(확장이 등록하는 CLI 플래그)는 정식 형식 `--<확장 이름>:<이름>`을 항상 받고, 충돌이 없으면 `--<이름>`도 받는다. CLI 파서는 확장 로드 뒤에 확장 플래그를 해석한다(`L4.cli.spec` [가정]).
9. primitives `ResourceKind`의 나머지 셋(`provider`, `mcp_server`, `message_renderer`)은 이 규칙 밖이다. 같은 이름이면 `reject`다. provider 이름 충돌의 선택 규칙은 `x.primitives.capabilityProviders`와 `L1.models.spec`이 정한다.

primitives 연결: `ResourcePolicy`(X.primitives.spec §3.9)에 집합 판정 `exposeAll`을 더했다(M2). 리소스 레지스트리는 같은 kind(도구, 명령, 단축키, 플래그)의 리소스가 등록되거나 해제될 때마다 그 kind 전체 레코드로 `exposeAll`을 불러 노출 이름을 다시 계산한다. 노출 이름이 바뀐 기존 레코드는 새 이름으로 다시 등록한다(도구는 `ToolsPort`에서 등록을 해제하고 새 이름으로 다시 등록한다). 들어오는 레코드의 노출 이름이 `too_long`이면 기존 레코드를 건드리지 않고 등록을 거부한다(`resource_name_invalid`). 그래서 규칙 3(로드 순서 무관)이 지켜지고, 확장 하나를 끄면 남은 확장이 짧은 이름을 되찾는다. 쌍 판정 `resolve`는 `exposeAll`이 없는 정책을 위해 남겼고 들어오는 쪽에 `{ action: "rename", name: <정식 이름> }`을 돌려준다.

외부 확장의 내장 도구 교체:

- 외부 확장이 내장 도구와 같은 이름(`read`, `bash` 등)을 등록해도 규칙 2에 따라 내장 이름은 바뀌지 않고, 그 확장의 도구는 정식 이름으로 노출된다. 내장 도구 교체 허용 여부는 §10 미결 10이다.
- `F.capabilities.spec` §10의 도구 이름 네임스페이스 [미결] 후보 가운데 이 문서는 (b) `<확장>__<이름>`과 (c) 충돌한 쪽만 접두의 결합을 제안한다.

### 4.6 안전 모드

#### 4.6.1 켜는 방법

| 방법 | 이름 [제안] | 적용 |
|---|---|---|
| 시작 옵션 | `xeon --safe-mode`, `xeon chat --safe-mode` | 이번 시작 |
| 환경 변수 | `XEON_SAFE_MODE=1` | 이번 시작. 데스크톱 사이드카 재시작용 |
| 설정 | `x.operations.safeMode.default`(§6) | 시작할 때마다. 관리·사용자 범위만 |
| 명령 | `/safe-mode` | 실행 중 요청. 단계 경계에서 외부 확장과 L3 내장 그룹([제안], §4.6.2)을 끄고(`reason: "safe_mode"`) 외부 훅을 멈춘다. 이미 실린 모듈은 프로세스에 남으므로 화면에 "다시 시작 권장"을 보인다 |

- 개별 끄기: `--disable-ext <이름>`(여러 번 쓸 수 있다)는 이번 시작에서 그 확장만 싣지 않는다. `ext.<name>.enabled` 설정 값은 바꾸지 않는다.
- 안전 모드인지는 호스트 상태로 클라이언트에 알린다. wire에 싣는 방법은 `F.wire-settings.spec` 소유이므로 추가를 요청한다(§10 미결 11).

#### 4.6.2 꺼지는 대상과 켜져 있는 대상

| 대상 | 안전 모드 |
|---|---|
| `guard` tier(권한·샌드박스 내장 가드) | 켜짐 |
| `core` tier(L1 코어) | 켜짐 |
| `builtin` tier 중 L0~L2 내장 패키지(`platform-*`, `cap-*`) | 켜짐 |
| `builtin` tier 중 L3 내장 그룹(학습 그룹) | 꺼짐 [결정: review.m3-design-inputs D-M3-07 a] |
| `user`, `project` tier 확장(외부 plugin, 외부 group). 기본 플러그인 Helm은 사용자 확장 위치에 설치되므로 여기에 든다([결정: review.m3-design-inputs D-M3-01 c]) | 꺼짐 |
| 외부 훅 전체 | 꺼짐 |
| 관리(managed) 범위 확장(2차) | 켜짐(`guard`) |

- 기준: `allowedInSafeMode`는 tier가 `guard`·`core`이거나, tier가 `builtin`이고 `layer`가 `L1`·`L2`이면 참이다. 내장 L0 패키지는 on을 쓰지 않으므로 이 판정과 별개로 항상 실린다.
- [결정: review.m3-design-inputs D-M3-07 a] L3 내장 그룹을 끈다. 이유: drive를 쓰는 그룹은 루프 진행을 바꾸므로, 복구 목적의 시작에서는 기본 루프만 남긴다. 안전 모드는 계획 v2의 "모든 확장을 끈 채 시작"(`_research/layer-plan-v2.json` X-c 안전 모드 행)을 내장 L0~L2와 보안 가드를 남기는 범위로 읽는다. Helm은 L3 기본 그룹([결정] `_research/decisions-log.md` 2026-10-21 계획 v2)이므로 안전 모드에서 기본 그룹이 빠지는 제품 동작이 된다. 사용자 확인 전이다(§10 미결 19). 확인 결과 L3 내장 그룹을 남기기로 하면 이 행과 `allowedInSafeMode`, §9 수용 기준 21을 함께 고친다.

#### 4.6.3 동작

- `startupFilter`가 로드 후보에서 꺼지는 대상을 빼고 사유(`safe_mode`, `disabled_flag`)를 남긴다. 로더(`X.loading-trust.spec` §4.3.1 5a단계)는 빠진 확장을 `disabled` 상태와 같은 이름의 진단(`safe_mode`, `disabled_flag`)으로 둔다. 외부 확장은 엔트리 모듈을 import하지 않는다. 내장 확장은 조립 루트가 모듈을 이미 import했으므로(`X.loading-trust.spec` §4.4.2) 엔트리 호출(`ExtHost.install`)만 생략한다.
- 빠진 확장의 설정 키는 카탈로그에 남는다(값 편집 가능, 적용 안 함). 빠진 확장의 이벤트 kind는 등록되지 않으므로 그 kind 이벤트의 투영은 `F.records.spec` §10 미결 5의 규칙을 따른다.
- 안전 모드에서 시작한 세션은 drive 임대를 갖지 않는다.

#### 4.6.4 연속 시작 실패 후 제안

- L4 호스트는 시작할 때 `StartupHealthStore.beginStartup()`으로 직전까지의 연속 시작 실패 수를 받고, 첫 입력을 받을 준비가 되면 `markStarted()`를 부른다. 시작 도중 프로세스가 죽으면 표시가 남아 다음 시작에서 1이 늘어난다.
- 연속 실패 수가 `x.operations.safeMode.suggestAfter`(기본 3) 이상이면 시작 화면에 안전 모드 제안을 띄운다. 비대화 실행에서는 stderr에 `--safe-mode` 안내를 한 줄 쓴다. 자동으로 안전 모드에 들어가지 않는다 [제안].
- 기록 파일 위치는 DB 밖(사용자 상태 디렉터리)이다. DB를 여는 단계에서 실패할 수 있기 때문이다. 경로는 `L4.host-service.spec`이 정한다 [가정].

#### 4.6.5 L4 노출

- 설정 화면 "플러그인과 그룹" 탭(`SettingsTab` `plugins`)에 안전 모드 항목을 둔다. 내용: 현재 상태, 원인(옵션·설정·명령), "안전 모드로 다시 시작" 버튼, `x.operations.safeMode.default` 토글.
- 같은 탭의 확장 목록에 자동으로 꺼진 확장과 안전 모드로 빠진 확장을 사유와 함께 보인다.
- 안전 모드 키는 `x.operations.safeMode.*`다. `L4.settings-ui.spec` §4.1 "plugins" 탭 행도 안전 모드를 `x.operations.*` 아래로 적는다(§10 12번, 해소).

### 4.7 외부 훅 프로토콜 (M4)

#### 4.7.1 설정 위치와 형식

- [제안] 외부 훅은 설정 키 `x.operations.hookDefs`(값 `HookDef[]`)에 적는다. 별도 파일을 두지 않고 설정 단일 원천(`F.wire-settings.spec` §3.8)을 쓴다. 그래서 위치는 설정 범위별 파일(관리, 사용자, 프로젝트, 로컬)이고 경로는 `L4.host-service.spec`이 정한다.
- 범위별 목록은 덮어쓰지 않고 이어 붙인다. 순서는 관리 → 사용자 → 프로젝트 → 로컬이다. 같은 `id`가 두 범위에 있으면 바깥 범위의 것만 쓰고 진단을 남긴다 [제안]. 설정 해석 규칙(배열 병합)은 `F.wire-settings.spec` §4.7 우선순위와 다르므로 확인이 필요하다(§10 미결 13).
- 확장 패키지가 훅을 함께 내는 경로(매니페스트 필드)는 F 추가 요청이다(§10 미결 2).

예:

```json
{
  "x.operations.hookDefs": [
    { "id": "no-rm-rf", "point": "tool.call.before", "tools": ["bash"], "command": ["./.xeon/hooks/check-bash.sh"], "timeoutMs": 5000 },
    { "id": "log-start", "point": "session.start", "command": ["/usr/local/bin/xeon-log", "start"] }
  ]
}
```

#### 4.7.2 매칭

- 지점: `HOOK_POINTS` 8개만 허용한다. 고빈도 지점(스트림 tap), 모델 요청 직전 chain(`request.context.before`, `request.provider.before`), boundary chain(`boundary.step.after` 등, 확장 kind 초안이 필요함)은 외부 프로세스 비용과 형식 때문에 뺀다.

  | 지점 | fold | Claude Code 대응 |
  |---|---|---|
  | `input.user.before` | chain | UserPromptSubmit |
  | `input.bash.before` | first | (없음) |
  | `tool.call.before` | first | PreToolUse |
  | `tool.result` | chain | PostToolUse |
  | `session.start` | tap | SessionStart |
  | `session.compact.before` | first | PreCompact |
  | `boundary.settle.after` | tap | Stop(차단 불가) |
  | `session.shutdown` | tap | SessionEnd |

- 도구 필터: `tools`는 도구 이름 정확 일치 목록이다. 정규식은 받지 않는다 [제안]. Claude Code 매처는 정규식을 받지만 "강한 차단은 권한 시스템으로 하라"고 경고한다(`_research/refs/claude-code.md` hooks 매처 항목).

#### 4.7.3 입력, 출력, 종료 코드

- 입력: stdin에 `HookInput` JSON 한 줄과 개행을 쓰고 닫는다. `schemaVersion`은 `"xeon.hook.v1"`이다(Hermes `hermes.observer.v1` 방식, `_research/item-catalog.md` X절 훅 페이로드 스키마 버전 행). payload 형식이 바뀌면 이 값을 올린다.
- 출력: stdout 전체를 JSON 하나로 읽는다. 빈 출력은 `{}`다. first 지점은 `decision`, chain 지점은 `patch`만 읽고, 지점의 결정·패치 스키마(`POINTS[point].result`)로 검사한다. tap 지점은 stdout을 읽지 않는다.
- 종료 코드(`interpretHookRun`):

  | 결과 | tap | first | chain |
  |---|---|---|---|
  | 0, 출력 `{}` | `pass` | `pass`(결정 없음) | `pass`(패치 없음) |
  | 0, 유효한 `decision`/`patch` | `pass` | `decision` | `patch` |
  | 0, JSON 아님·스키마 위반 | `pass` | 실패(`hook_output`) → 거부 | 실패(`hook_output`) → 패치 버림 |
  | 2 | 기록, 실패 아님 | `deny`. 사유는 stderr 앞 500자. stdout은 읽지 않는다 | 패치 버림, 실패 아님 |
  | 그 밖의 0 아닌 코드, 신호 종료 | 실패(`hook_exit`) → 기록 | 실패(`hook_exit`) → 거부 | 실패(`hook_exit`) → 패치 버림 |
  | 시작 실패(실행 파일 없음 등) | 실패(`hook_spawn`) | 실패(`hook_spawn`) → 거부 | 실패(`hook_spawn`) → 패치 버림 |
  | 예산 초과 | 실패(`timeout`) | 실패(`timeout`) → 거부 | 실패(`timeout`) → 패치 버림 |
  | stdout 10,000자 초과 | 실패(`hook_output`) | 실패(`hook_output`) → 거부 | 실패(`hook_output`) → 패치 버림 |

- 거부는 그 지점의 `FIRST_DENY` 형식으로 만든다. exit 2의 거부는 `reason`만 stderr 내용으로 바꾼다.
- 주의 사항 [제안]: Claude Code에서 exit 1은 비차단 오류이고 PreToolUse 시간 초과도 기본은 비차단이다(`_research/refs/claude-code.md` hooks 종료 코드 항목, `D:hooks:880`). Xeon은 first 지점에서 0과 2 밖의 모든 비정상 종료를 거부로 환산한다(`F.extensions.spec` §4.1 fail-closed). 그래서 Claude Code용으로 쓴 훅 스크립트가 exit 1로 "경고만" 하던 경우 Xeon에서는 도구 호출이 막힌다. 이 차이를 사용자 문서와 `xeon doctor` 훅 점검에 적는다.
- 출력 상한: stdout과 stderr 각각 10,000자다(Claude Code와 같은 값). 넘는 부분은 읽지 않고 잘라낸다. stdout이 잘리면 위 표대로 실패다. stderr가 잘리는 것은 실패가 아니고 로그에 잘림 표시를 남긴다.

#### 4.7.4 실행

- 프로세스 실행은 `xeon.process` 서비스(`ProcessService`, `platform-process`)를 Cordis로 주입받아 한다(`eng.context-map.design` §5.3, `architecture.layers.spec` §4.3.3 1번). X는 L0를 import하지 않는다. 주입받은 서비스가 없으면 외부 훅을 끄고 시작 진단을 남긴다.
- 셸을 거치지 않는다. `command`는 argv 그대로 실행한다. 셸 기능이 필요하면 사용자가 `["sh", "-c", "…"]`로 적는다.
- 작업 폴더: `cwd: "project"`(기본)는 프로젝트 루트, `"home"`은 사용자 홈이다.
- 예산: 훅 정의의 `timeoutMs`, 없으면 `x.operations.budget.hookMs`. 예산이 끝나면 signal을 abort하고 `ProcessService`가 프로세스 그룹을 종료한다(종료 방식은 `L0.process.spec`).
- 같은 지점의 훅은 순서대로 하나씩 실행한다. 정렬은 §4.1의 정렬 키를 따른다.
- 디스패처 등록 [제안]: primitives 레지스트리는 확장·scope 단위로 핸들러를 받는다. 그래서 operations는 설정 범위마다 내부 내장 확장 단위 하나(`xeon-hooks-managed`, `xeon-hooks-user`, `xeon-hooks-project`, `xeon-hooks-local`)를 만들어 `ExtHost.install`로 싣고, 그 scope에서 훅마다 on 핸들러 하나를 등록한다. 이 단위들은 모든 확장 뒤의 `loadIndex`를 받고, `TierTable`에는 §4.7.6 표의 tier로 들어간다. 실패 장부 키는 단위 이름이 아닌 `hook:<id>`이고, operations가 (단위, 등록 순번) → 훅 id 표로 바꾼다.
- 재생: 훅도 on 핸들러이므로 "다시 실행해도 되는 질의" 계약을 따른다(`F.extensions.spec` §4.3). 크래시 뒤 같은 페이로드로 다시 실행될 수 있다. 사용자 문서에 적는다.

#### 4.7.5 환경 변수 정리

- 자식 프로세스 환경은 비우고 다음만 넣는다(`hookEnv`).
  1. `BASE_ENV_ALLOW`의 이름 중 부모 환경에 있는 것
  2. 훅 정의 `env`의 이름 중 `x.operations.hookEnvAllow`(관리·사용자 범위)에도 있는 것
  3. Xeon이 넣는 값: `XEON_HOOK_ID`, `XEON_HOOK_POINT`, `XEON_THREAD_ID`, `XEON_PROJECT_DIR`
- 1·2의 이름이 `SECRET_ENV_PATTERN`에 맞으면 넘기지 않는다. 비밀 참조(`secret://`)는 풀지 않는다([결정] 에이전트는 값을 모른 채 참조로 사용, `_research/decisions-log.md` 2026-10-21 2차).
- 프로젝트 범위 설정은 `x.operations.hookEnvAllow`를 바꿀 수 없다. 저장소에 든 설정이 비밀 변수를 꺼내지 못하게 하기 위해서다.

#### 4.7.6 신뢰와 tier

| 훅이 적힌 범위 | tier | 실행 조건 |
|---|---|---|
| 관리 | `guard` | 항상 |
| 사용자 | `user` | 항상 |
| 로컬 | `project` | 프로젝트 신뢰 승인 뒤 |
| 프로젝트 | `project` | 프로젝트 신뢰 승인 뒤(`X.loading-trust.spec`). 승인 전에는 목록만 읽고 실행하지 않는다 |

- 안전 모드에서는 모든 범위의 외부 훅이 꺼진다(§4.6.2).

#### 4.7.7 격리 확장과의 차이

| 항목 | 외부 훅 | 격리 확장(`X.loading-trust.spec`, 2차) |
|---|---|---|
| 수명 | 디스패치마다 프로세스 하나 | 세션 동안 상주 |
| 통신 | stdin JSON 한 번, stdout JSON 한 번, 종료 코드 | JSON-RPC(stdio) |
| 쓸 수 있는 연산 | on 하나(허용 지점 8개) | on, post, drive, scope 전체 |
| 상태 | 없음 | 정본은 세션 DB의 이벤트(`x.<name>.state.committed` 등). `commit`·`record`·`post`는 호스트 대리인(`OutboxAgent`)을 거쳐 세션 커밋 경로로 들어간다. 확장은 개인 보관소(`XEON_EXT_DATA`)에 자기 사본과 마지막 처리 `seq` 커서만 둔다 |
| 이벤트 kind·저장 영역 | 없음 | 자기 접두 kind. 확장 전용 테이블은 쓰지 않고(`defineTables`는 `isolated`), 읽기는 대리인이 `readsRecordKinds`로 거른 이벤트를 `seq` 순서로 받는다 |
| 실패 단위 | 훅 id | 확장 이름 |

## 5. 실패와 경계 사례

1. 핸들러가 signal을 무시하고 계속 실행됨: 디스패처는 예산이 끝난 시점에 진행한다. 그 핸들러의 프로미스와 부수 효과(타이머, 네트워크)는 프로세스에 남는다. 같은 프로세스 안에서는 강제로 멈출 수 없다(adr.0007 §6 미결 "비협조적인 확장 코드의 강제 종료"). 반복되면 자동 끄기로 다음 경계부터 호출을 멈추고, 강제 종료가 필요한 확장은 프로세스 격리로 옮긴다.
2. 예산이 끝난 뒤 핸들러가 값을 반환함: 버린다. 장부에는 `timeout`만 남는다.
3. 대화상자를 연 채로 사용자가 응답하지 않음: 예산은 멈춰 있다. 사용자 중단(`outer` abort)이나 대화상자 자체 시간 제한이 끝낸다. 이 경우는 `aborted`이고 실패가 아니다.
4. 가드 핸들러가 계속 실패함: 자동 끄기 대상이 아니다. first 지점은 거부가 계속되어 도구 호출이 막힌다. 알림이 계속 나가므로 사용자가 원인을 고친다. 가드를 끄는 설정은 두지 않는다.
5. 자동 끄기 요청 뒤 경계 전에 같은 확장이 drive 임대를 받으려 함: 끄기 요청이 있는 scope에는 임대를 주지 않는다 [제안]. 중재는 `X.primitives.spec`이다.
6. 확장 투영 `apply`가 오류를 돌려주거나 예외를 던짐: 코어 커밋 전체가 롤백되고 투영기 실패로 보고된다. 쓰려는 행이 선언과 다르면(`row_invalid`) `apply`가 그 오류를 돌려준다. 같은 이벤트로 다시 커밋해도 같은 결과이므로 세션 진행이 막힌다. [제안] X는 그 확장 투영기를 해제하고 확장을 끈 뒤(`reason: "auto_disable"`) 커밋을 다시 시도하는 복구 경로를 둔다. 세부는 `L1.persistence.spec`과 정한다(§10 미결 6).
7. 두 확장의 변환 이름이 같은 테이블 이름을 만듦: §4.4.2 규칙상 생기지 않는다. 소유 장부가 마지막 방어로 `table_owned`를 낸다.
8. `xh_ext_tables`에 없는 `x_` 테이블이 DB에 있음: 이전 버전이나 수동 생성의 흔적이다. 건드리지 않고 진단에 보인다.
9. 안전 모드에서 사용자가 외부 확장을 켬: 설정 값은 저장하되 이번 실행에는 적용하지 않고 "안전 모드라 다음 정상 시작에 적용"을 알린다.
10. 외부 훅이 stdout에 JSON 앞뒤로 다른 글을 씀: JSON 하나로 파싱되지 않으면 `hook_output` 실패다.
11. 외부 훅 실행 파일이 프로젝트 폴더 안에 있고 프로젝트 신뢰가 철회됨: 다음 디스패치부터 실행하지 않는다.
12. 이름 충돌로 짧은 이름을 잃은 도구를 모델이 짧은 이름으로 부름: 도구 목록에 없는 이름이므로 L1 도구 디스패치의 "알 수 없는 도구" 처리가 적용된다(`L1.tools.spec`).

## 6. 설정 노출

[제안] `F.wire-settings.spec` §6의 열로 적는다. 모든 키의 `layer`는 `"X"`, `since`는 `"0.1.0"`, `secret`은 없음(false)이다. 소유는 이 문서다.

선언은 `operationsSettings = defineSettings("x.operations", { … })`(`settings-keys.ts`)다. `x.*` 설정 그룹(`primitivesSettings`, `loadingTrustSettings`, `operationsSettings`)은 조립 루트(L4 host)가 코어 그룹, `LoadReport.settingGroups`와 함께 `buildCatalog`에 넣는다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab | 단계 |
|---|---|---|---|---|---|---|---|
| `x.operations.budget.firstMs` | integer | 30000 | 100~600000 | live | managed, user, local, session | plugins | 1차 |
| `x.operations.budget.chainMs` | integer | 10000 | 100~600000 | live | managed, user, local, session | plugins | 1차 |
| `x.operations.budget.tapMs` | integer | 5000 | 100~600000 | live | managed, user, local, session | plugins | 1차 |
| `x.operations.budget.streamTapMs` | integer | 1000 | 50~60000 | live | managed, user, local, session | plugins | 1차 |
| `x.operations.budget.shutdownMs` | integer | 2000 | 100~30000 | live | managed, user, local | plugins | 1차 |
| `x.operations.budget.setupMs` | integer | 10000 | 100~600000 | restart | managed, user, local | plugins | 1차 |
| `x.operations.autoDisable.enabled` | boolean | true | | live | managed, user, local | plugins | 1차 |
| `x.operations.autoDisable.consecutive` | integer | 5 | 1~1000 | live | managed, user, local | plugins | 1차 |
| `x.operations.autoDisable.windowSize` | integer | 50 | 5~10000 | live | managed, user, local | plugins | 1차 |
| `x.operations.autoDisable.minFailures` | integer | 10 | 1~10000 | live | managed, user, local | plugins | 1차 |
| `x.operations.autoDisable.failureRate` | number | 0.5 | 0.05~1 | live | managed, user, local | plugins | 1차 |
| `x.operations.safeMode.default` | boolean | false | | restart | managed, user | plugins | 1차 |
| `x.operations.safeMode.suggestAfter` | integer | 3 | 1~100 | restart | managed, user | plugins | 1차 |
| `x.operations.budget.hookMs` | integer | 30000 | 100~600000 | live | managed, user, local, session | plugins | 2차 |
| `x.operations.hookDefs` | `HookDefListSchema` | `[]` | | live | managed, user, project, local | plugins(widget `table`) | 2차 |
| `x.operations.hookEnvAllow` | string[] | `[]` | | live | managed, user | plugins(widget `list`) | 2차 |

- 예산과 자동 끄기 키는 `project` 범위를 받지 않는다 [제안]. 저장소에 든 설정이 예산을 늘려 루프를 오래 붙잡거나 자동 끄기를 꺼서 실패 확장을 남기지 못하게 한다.
- `ui` 항목의 `label`과 `order`는 `L4.settings-ui.spec`이 정한다. 위젯은 boolean → `toggle`, integer·number → `number`다. 예산 키 단위는 `ms`다.
- L4 노출:
  - 화면: 설정 화면 "플러그인과 그룹" 탭. 묶음은 "핸들러 시간 예산", "실패와 자동 끄기", "안전 모드", "외부 훅" 네 개 [제안]. 확장 목록에 실패 수, 자동 끄기 상태, 다시 켜기 버튼을 보인다.
  - 명령: `xeon config get|set x.operations.…`(`L4.cli.spec`), `xeon ext list`, `xeon ext enable <name>`, `xeon ext disable <name>`(X.primitives.spec §6과 같은 이름), `/safe-mode`, `xeon --safe-mode`, `xeon --disable-ext <name>`, `xeon doctor`의 훅·확장 점검 [제안: 명령 이름은 `L4.cli.spec`이 확정].
  - 파일: 범위별 설정 파일의 같은 키(`F.wire-settings.spec` §3.9, 경로는 `L4.host-service.spec`).
- 확장 공통 키 `ext.<name>.enabled`, `ext.<name>.isolation`은 `X.loading-trust.spec`, `x.primitives.driveDefaultLimits`·`x.primitives.driveLimits`는 `X.primitives.spec` 소유다. 이 문서는 정의하지 않는다.

## 7. 확장 지점

- 이 문서는 지점을 선언하지 않는다. 지점 선언은 `F.extensions.spec` §3.4가 정본이다.
- on: 모든 on 디스패치에 정렬 키(§4.1), 시간 예산(§4.2), 실패 처리(§4.3)를 적용한다. 외부 훅은 on 핸들러의 한 종류로 같은 디스패치에 들어간다(§4.7).
- post: 이 문서의 규칙이 적용되지 않는다. post는 커밋 단위 기록이고 시간 예산이 없다. 안전 모드에서 빠진 확장은 post를 쓸 수 없다(실리지 않으므로).
- drive: 시간 예산 밖이다(§4.2.5). 자동 끄기가 drive 그룹에 적용되면 임대 반납이 함께 일어난다(§4.3.3).
- scope: 자동 끄기와 안전 모드 끄기는 scope 끄기 경로(`ScopeControl`)를 쓴다. 토글 적용 시점은 `X.primitives.spec`과 `F.extensions.spec` §4.5를 따른다.
- 확장 투영(`ExtProjection`)은 커밋 경로의 투영기이며 지점 선언 대상이 아니다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `Tier`, `TIERS`, `HandlerOrigin`, `HandlerOrderKey`, `orderKeyOf`, `compareOrderKey`, `assignTier`, `TierTable`, `tierOfFrom` | X.primitives.spec(`DispatchPolicy.tierOf`), X.loading-trust.spec(tier 부여 시점) |
| `createOperationsPolicy`, `OperationsPolicy`(`admit`, `forget`, `setupBudgetMs`, `startupFilter`, `onHandlerSettled`, `run`), `createResourcePolicy` | L4.host-service.spec(조립), X.primitives.spec(`ExtHostDeps.policy`·`setupBudgetMs`), X.loading-trust.spec(`LoaderDeps.policy`) |
| `BudgetGate`, `BudgetOutcome`, `runWithBudget`, `awaitUser`, `DEFAULT_BUDGETS_MS` | X.primitives.spec(디스패처, UI 포트 래핑) |
| `HandlerOutcomeRecord`, `FailureLedger`, `AutoDisabler`, `ScopeChangeReason` | X.primitives.spec, L4.settings-ui.spec(상태 표시) |
| `ExtStorage`, `ExtTables`, `ExtProjection`, `ExtTableDef`, `storageOf`, `extTablePrefix`, `parseExtTableName` | L3.group-kit.spec, L3.helm.spec, L3.learning.spec, 외부 확장 |
| `ExtStorageAdmin` | X.loading-trust.spec §4.4.5(제거 흐름, `LoaderDeps.storageAdmin`), L4(확인 화면) |
| `resolveNames`, `qualifiedName`, `ResourceClaim`, `createResourcePolicy` | X.primitives.spec(리소스 등록), X.loading-trust.spec(외부 확장 로더) |
| `startupFilter`, `StartupOptions`, `allowedInSafeMode`, `StartupHealthStore`, `shouldSuggestSafeMode` | X.loading-trust.spec(`LoadOptions.startup`, 5a단계), L4.host-service.spec, L4.cli.spec |
| `HookDef`, `HookInput`, `HookOutput`, `HOOK_SCHEMA_VERSION`, `interpretHookRun` | 외부 훅 작성자 문서, L4.settings-ui.spec |
| 설정 키 `x.operations.*`, `operationsSettings` | L4.settings-ui.spec, L4.cli.spec, L4.host-service.spec(카탈로그 조립) |

요구:

| 이름 | 출처 |
|---|---|
| `PointName`, `PointDecl`, `POINTS`, `FIRST_DENY`, `CHAIN_RULES`, `Fold`, `ExtensionName`, `ExtensionManifest`, `ScopeId`, `HandlerContext` | F.extensions.spec |
| `PortLookup`, `ProjectorRegistryPort`(`register`, `onFailure`), `ScopedStorePort`(`scoped(owner)`), `HookProcessPort`, `HookRunSpec`, `HookRawRun`과 키 | F.extensions.spec §3.2.1 `ports.ts` |
| `Projector`, `ProjectorRegistry`, `StoreService` | F.records.spec §3.9 |
| `DurableEventEnvelope`, `EventKind`, `parseEventKind`, `ScopeChangedPayload` | F.records.spec |
| `SettingDef`, `defineSettings`, 키 문법, 범위 | F.wire-settings.spec |
| 도구 이름 허용 문자, 도구 순서 키 | F.capabilities.spec |
| `DispatchPolicy`(`onHandlerSettled`·`run` 포함, §3.4), `HandlerGate`, `HandlerRunOutcome`, `ExtHost.scope`·`scopes`·`install`·`ports`(ScopeControl과 포트의 바탕), `ExtHostDeps.now`·`setTimer`·`setupBudgetMs`, `HandlerEntryInfo`, `HandlerFailure`, `ResourcePolicy`, `ResourceRecord`, `hostOf`, `ExtHost.ports`로 꺼내는 포트 키(F 이름 재export), UI 포트 | X.primitives.spec §3.2~§3.9 |
| `TrustLevel`, `InstallSource`, `LoadedExtensionInfo`(`essential`, `loadIndex`), `TRUST_MATRIX.storage`, 로드 파이프라인 5a·6a·7단계, 프로젝트 신뢰, 제거 흐름, 격리 확장의 outbox | X.loading-trust.spec §3.1~§3.5, §4.3, §4.4.5, §4.6, §4.7, §4.9 |
| `Projector`, `ProjectionTx`, 투영 규칙 | eng.events.design §5.1 |
| 커밋 순서, `SessionWriter`, `StoreService.scoped`, outbox 표 | eng.transactions.design §4, §7 |
| 테이블·type 접두 소유표, 서비스 이름(`xeon.session`, `xeon.store`, `xeon.process`) | eng.context-map.design §5 |
| `ProjectorRegistry.register`의 반환(`Result<{ dispose }, ProjectorRegisterError>`)과 `onFailure` 통지 | L1.persistence.spec §3.4 |
| `ProcessService`의 훅 실행 구현과 종료 방식 | L0.process.spec |
| 설정 파일 경로, 시작 상태 파일 경로 | L4.host-service.spec |

## 9. 수용 기준

1. `guard` tier 핸들러는 로드·등록 순서와 관계없이 같은 지점의 다른 tier 핸들러보다 먼저 실행된다. 사용자 확장을 먼저 싣고 먼저 등록해도 같다.
2. `tool.call.before`에서 `guard` 핸들러가 거부하면 `user`·`builtin` 핸들러는 호출되지 않고 결정은 가드의 거부다.
3. `orderKeyOf`·`tierOfFrom`으로 정렬한 결과는 tier가 같으면 `loadIndex`, 그것도 같으면 `registrationIndex` 오름차순이다.
4. `assignTier`는 `GUARD_EXTENSIONS`에 없는 확장에 `guard`를 주지 않는다. `project` 설치 위치에 `builtin` 신뢰가 오면 `source_trust_mismatch`다.
5. 가짜 시계에서 `first` 지점 핸들러가 30,000ms까지 끝나지 않으면 결정은 `FIRST_DENY[point]`이고 핸들러 signal은 `TimeoutError`로 abort된다. 29,999ms에 끝나면 그 값을 쓴다.
6. `chain` 지점 핸들러가 예산을 넘으면 그 패치만 버려지고 다음 핸들러는 이전 `current`를 받는다.
7. 핸들러가 `hostOf(g).awaitUser`로 60,000ms 동안 대화상자를 기다리고 그 앞뒤로 20,000ms씩 실행하면(`first`, 예산 30,000ms) 예산 초과가 아니다. 대기 없이 같은 40,000ms를 실행하면 예산 초과다.
8. 예산 초과 뒤 핸들러가 값을 반환해도 결정·패치에 반영되지 않는다.
9. `session.shutdown` 핸들러는 2,000ms에서 끊긴다.
10. drive 함수는 가짜 시계로 600,000ms가 지나도 시간 예산으로 abort되지 않는다.
11. 한 확장의 핸들러가 연속 5번 실패하면 끄기 요청이 기록되고, 다음 단계 경계에서 `scope.changed{status:"disabled"}`가 커밋된다. 요청과 경계 사이에 실행 중인 디스패치는 끊기지 않는다.
12. `guard`, `core` tier 확장은 실패가 기준을 넘어도 자동으로 꺼지지 않는다.
13. 자동으로 꺼진 확장을 `reenable`하면 장부가 비고 켜기 요청이 기록된다.
14. `aborted`로 끝난 호출은 연속 실패 수와 창 실패 수를 바꾸지 않는다.
15. `ExtStorage.defineTables`가 만든 모든 DDL 문장의 테이블·인덱스 이름은 `extTablePrefix(확장 이름)`으로 시작한다. 지역 이름·열 이름 규칙을 어긴 정의는 `identifier_invalid`다.
16. 접두 우회 시도 문자열(`notes; DROP TABLE events`, `notes"--`, `main.events`, `sqlite_master`, `../x`, 대문자·유니코드 유사 문자, 빈 문자열)을 지역 이름이나 열 이름으로 주면 모두 거부되고 DB에 새 테이블이 생기지 않는다. `ExtTables`·`ExtWriters` API로는 접두 밖 테이블을 읽거나 쓸 방법이 없다(타입 테스트와 `checkStatement` 테스트).
17. 장애 주입으로 `after_ext_projection:0` 지점에서 코어 커밋이 롤백되면 확장 테이블의 행 수와 행 해시는 시도 전과 같다.
18. 확장 `a`의 `bc`와 확장 `a-b`의 `c`는 다른 테이블이 되고 `parseExtTableName`이 각각의 소유 확장을 돌려준다. `dropExtension("a", true)`는 `x_a_b_c`를 지우지 않는다.
19. `dropExtension(name, false)`는 아무것도 지우지 않고 대상 목록만 돌려준다. `true`로 부른 뒤에도 그 확장의 이벤트 행 수는 같다.
20. 외부 확장 둘이 같은 도구 이름 `search`를 등록하면 둘 다 `<확장>__search`로 노출되고 `search`는 노출되지 않는다. 입력 순서를 바꿔도 결과가 같다. 내장 도구 이름 `read`를 외부 확장이 등록하면 `<확장>__read`로만 노출된다. 한 확장을 끄면 남은 확장이 짧은 이름을 되찾고 도구 포트에는 해제 뒤 새 이름으로 다시 등록된다(집합 판정 `exposeAll`).
21. 안전 모드로 시작하면 `user`·`project` tier 확장(기본 플러그인 Helm 포함), L3 내장 그룹, 외부 훅이 실리지 않고 `guard`·`core`·L0~L2 내장 패키지는 실린다.
22. `--disable-ext acme-notes`로 시작하면 그 확장만 실리지 않고 `ext.acme-notes.enabled` 설정 값은 바뀌지 않는다.
23. 연속 시작 실패 수가 3이면 `shouldSuggestSafeMode`가 참이다.
24. `tool.call.before` 외부 훅이 exit 2로 끝나면 결정은 거부이고 `reason`은 stderr 앞 500자다. 장부에는 실패로 남지 않는다.
25. `tool.call.before` 외부 훅이 exit 1로 끝나면 결정은 거부이고 실패(`hook_exit`)로 남는다. `tool.result` 외부 훅이 exit 1로 끝나면 패치를 버리고 다음 핸들러로 간다.
26. 외부 훅 stdout이 10,000자를 넘으면 10,000자에서 잘리고 실패(`hook_output`)로 처리된다(`first`면 거부).
27. 외부 훅 stdin JSON에는 `schemaVersion: "xeon.hook.v1"`, `point`, `fold`, `payload`가 있다.
28. `hookEnv`는 허용 목록 밖 변수와 `SECRET_ENV_PATTERN`에 맞는 변수를 넘기지 않는다. 프로젝트 범위 `x.operations.hookEnvAllow` 값은 무시된다.
29. 프로젝트 범위 외부 훅은 프로젝트 신뢰 승인 전에 실행되지 않는다.
30. §6 표의 키는 `defineSettings("x.operations", …)`와 `buildCatalog`를 통과하고, 기본값은 `DEFAULT_BUDGETS_MS`, `DEFAULT_AUTO_DISABLE`와 같다.

## 10. 미결 사항

1. tier와 핸들러 시간 예산의 소유(F 부분 해소). `F.extensions.spec` §1 "다루지 않는 것"과 §4.2는 이미 `X.operations.spec`을 가리킨다(§1.1). 남은 곳은 `L3.readme`의 L3가 정하지 않는 것 표(4연산 실행 행, 핸들러 순서 행)로, tier 소유를 아직 `X.primitives.spec`으로 적는다(L3 문서 소관).
2. [결정: review.decisions-2 U-07] F 매니페스트 필드 `storage`·`hooks`는 M1에 넣지 않는다. M1은 필드 없이 동작한다(테이블 선언의 정본은 코드의 `defineTables`). M2 이후 다시 요청할 후보는 다음과 같다(`F.extensions.spec` §3.1).
   - 확장 전용 테이블 선언: `storage?: { tables: string[] }`(지역 이름 목록). 설치 전 검토, 제거 확인 화면, `validateUsage` 대조(`storage_undeclared`)에 쓴다.
   - 확장이 함께 내는 외부 훅: `hooks?: HookDef[]`(2차).
   - M2 전에 설치 전 검토가 필요하면 확장 루트의 `.xeon-plugin/operations.json`에 같은 내용을 두고 X가 읽는다 [제안].
3. 이름 정리(해소).
   - extId 형식: [결정: review.decisions-2 U-18] `^[a-z][a-z0-9-]{1,31}$`, 테이블 접두 `x_<하이픈을 밑줄로>_`(§4.4.2). `F.extensions.spec` `EXTENSION_NAME_PATTERN`, `eng.context-map.design` §5.2·CM-07, `eng.domain-types.guide` DT-08, `eng.events.design` §4.5, `L0.store.spec`, adr.0004 §3.3이 모두 이 정규식과 `x_` 접두로 고쳐졌다. `L3.readme`의 그룹 이름 제안(`^[a-z][a-z0-9]{1,31}$`)은 부분 집합이라 충돌하지 않는다.
   - 확장 kind 접두: `x.`/`grp.`(`F.records.spec` §3.2). 옛 밑줄 접두 표기는 쓰지 않는다([결정: review.decisions-2 T-21]). scope 상태 커밋 kind 이름은 `X.primitives.spec`이 정한다.
   - 세션 열 이름: `eng.context-map.design` §5.2는 `session_id`, 이 문서는 F 용어(`ThreadId`)를 따라 `thread_id`를 쓴다.
4. F.records 추가 요청(F 부분 해소).
   - `ScopeChangedPayload.reason?`(`"request" | "auto_disable" | "safe_mode" | "startup_disable"`)은 `F.records.spec` §3.3에 들어갔다. 값 정본은 이 문서의 `ScopeChangeReason`이다.
   - 휘발 kind `scope.handler_failed`는 `F.records.spec` §3.3 코어 카탈로그에 코어 영역 `scope`로 들어갔다(`ScopeHandlerFailedPayloadSchema`).
   - [미결] 남은 일: `ScopeHandle.enable`/`disable`에 사유 인자가 없어 `ScopeControl`의 사유를 `scope.changed`에 싣는 경로가 없다. `X.primitives.spec` §3.2에 사유 인자 추가를 요청한다.
5. (해소, M2 O-07) [결정: review.decisions-2 U-07] `HandlerContext.ui`는 두지 않고 X 공개 API의 별도 함수 `hostOf(g).awaitUser`로 연결했다(§4.2.3). 핸들러에 UI 포트 자체를 주는 일은 L2.dialog가 정한다.
6. [미결] 확장 투영 `apply` 예외의 복구 경로(§5 6번). 투영기 해제와 확장 끄기 뒤 커밋을 다시 시도할지, 세션을 읽기 전용으로 열지. `L1.persistence.spec`, `eng.events.design` 투영 실패 규칙과 정한다.
7. [미결] 자동 끄기의 영속 여부. 현재 [제안]은 프로세스 단위(재시작하면 다시 실림)다. 여러 번의 시작에서 반복해 꺼지는 확장을 `ext.<name>.enabled=false`로 기록할지, 사용자 확인을 받을지.
8. [미결] 이벤트에서 다시 만들 수 없는 부가 데이터 테이블(보존 테이블)을 허용할지. 허용하면 `eng.context-map.design` §5.2의 "`x_`는 확장 투영기만 쓴다, 재생 가능"을 바꾸고, 직접 쓰기 경로(커밋 계획에 데이터 연산 목록을 싣는 F `CommitPlan` 확장)와 열 추가 마이그레이션(`storage/migrate.ts`)이 필요하다.
9. [미결] `ExtQuery`의 범위 조건(`gt`, `lt`, `in`, 접두 일치)과 집계. 그리고 SQLite authorizer(§4.4.6 C안)를 `bun:sqlite`에서 쓸 수 있는지 확인.
10. (닫힘) pi 어댑터를 만들지 않으므로 대상이 없다 [결정: review.m3-design-inputs D-M3-11 c]. 외부 확장의 내장 도구 교체는 규칙 2대로 허용하지 않는다. 이전 질문: pi 어댑터 확장의 내장 도구 교체 허용 여부. pi는 같은 이름 등록으로 내장 도구를 바꾼다. 허용하면 사용자 설정(예: `ext.<name>.overrideTools`)으로 명시 허용하는 방식을 제안한다.
11. [미결] 안전 모드 상태를 클라이언트에 알리는 wire 필드(`F.wire-settings.spec` 호스트 정보 메서드).
12. 안전 모드 키 위치(해소). `L4.settings-ui.spec` "plugins" 탭 행이 안전 모드를 `x.operations.*` 아래로 적어 이 문서의 `x.operations.safeMode.*`와 같다.
13. [미결] 외부 훅 목록의 범위 병합 규칙(이어 붙이기)이 `F.wire-settings.spec` §4.7 우선순위(높은 범위가 값을 덮어씀)와 다르다. 배열 키의 병합 규칙을 F에 둘지, 이 키만 예외로 둘지.
14. [미결] 기본 예산 값(30초·10초·5초·1초·2초)과 자동 끄기 기준(연속 5회, 창 50회 중 10회 이상이고 50% 이상)은 실측 전 값이다. M1 스모크와 pi 예제 확장 이식 뒤 조정한다.
15. [결정: adr.0017] 실패 정책은 지점 선언이 정한다. `session_before_*`, `session.trust.before`, 가드레일 지점은 fail-closed이고 `session.compact.before`만 fail-open 예외다 [제안]. §4.2.4의 예산 초과 처리와 §4.7.3 표의 first 열은 지점 선언의 실패 정책 값을 따르게 고친다(`review.m3-lower-requirements` M3-REQ-108).
16. (해소) X.primitives.spec `DispatchPolicy`(§3.4)에 선택 메서드 `onHandlerSettled(entry, activeMs)`와 `run(entry, work, outer)`를 넣었다 [제안]. 이 문서의 `DispatchPolicyExtension`은 지웠고 `OperationsPolicy`가 두 메서드를 구현한다(§3.8, §4.2.3, §4.3.2).
17. (해소, M2 O-19) `ResourcePolicy.exposeAll`(집합 판정)을 X.primitives.spec §3.9에 더했고 `createResourcePolicy`가 구현한다(§4.5).
18. (해소) setup 시간 예산 키는 `x.operations.budget.setupMs`다. X.loading-trust.spec §4.3.1도 같은 이름을 쓴다. 값은 `OperationsPolicy.setupBudgetMs` → `ExtHostDeps.setupBudgetMs` 경로로 primitives의 scope setup에 걸린다.
19. [결정: review.m3-design-inputs D-M3-07 a] 안전 모드에서 L3 내장 그룹을 끈다(§4.6.2). Helm은 기본 플러그인(D-M3-01 c)이라 `user` tier로 실리고 같이 꺼진다.
20. (해소, M3-REQ-32) 샌드박스 강제는 L0 실행 경로에서 하고 on 핸들러는 두지 않는다(§4.1.4). on 핸들러가 필요해지면 L1 내장 확장이 맡고 `GUARD_EXTENSIONS`에 더한다.
21. [결정: 2026-10-28 사용자] 외부 훅(§3.7, §4.7)은 M3 밖이고 M4로 옮긴다. D-M3-11 c안 원문("로더·안전 모드만")과 같은 판단이다. 이 항목은 닫았다.
