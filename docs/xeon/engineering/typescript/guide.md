---
id: eng.typescript.guide
layer: eng
domain: typescript
kind: guide
status: draft
depends_on: [eng.toolchain.guide]
binds: [xeon/**/*.ts, xeon/**/*.tsx]
---

# TypeScript 작성 규칙

Xeon의 모든 TypeScript 코드에 적용하는 언어 차원 규칙이다. 금지 구문, 브랜드 ID, `Result`, 판별 유니온, unknown 경계, 비결정성 주입, Promise 처리를 정한다. 스키마·DTO·버전·확장 유니온 규칙은 짝 문서 `eng.domain-types.guide`가 소유한다.

## 1. 적용 범위

- 대상 코드: `xeon/` 아래 모든 `.ts`, `.tsx` 파일. `packages/*`, `apps/*`, `plugins/*`, `scripts/*`를 포함한다.
- 제외: `xeon/vendor/**`(Cordis 커밋 고정본, `.oxlintrc.json` `ignorePatterns`에 있다), 생성 산출물(`dist/**`).
- 포크 코드: pi durable 포크(`platform-exec`, `cap-workspace`의 `upstream/`)와 pi agent-core에서 가져온 코드도 이 규칙을 그대로 따른다. 업스트림 병합 비용은 단언·`!`·억제 주석의 예외 사유가 아니다. 지킬 수 없는 줄은 우회하지 않고 `[미결] TY-NN <위치> <이유>`로 보고한다. 에이전트 루프는 pi agent-core를 참고 자료로만 쓰고 Xeon 코드로 다시 쓴다(`adr.0009`).
- 테스트 코드: 규칙은 같다. 경로 단위로 완화한 항목은 4.3절 표에 적힌 것만 허용한다.
- 근거 자료:
  - 스택과 tsconfig 옵션: `_research/foundation-plan.md §2` 언어·타입 검사 행 [결정], `decisions/ADR-0001-stack.md`
  - 린트 규칙 존재 여부와 disable 주석 형식: `_research/notes/eng-1.md §2, §4, §7`
  - `isolatedDeclarations`와 TypeBox: `_research/notes/eng-2.md §3`
  - 기준 버전: TypeScript 7.0.2(`tsc` = tsgo), oxlint 1.89.0, oxlint-tsgolint 7.0.2004(`_research/notes/eng-1.md` 머리말)

### 1.1 용어

| 용어 | 뜻 |
|---|---|
| 경계 | 프로세스 밖이나 신뢰하지 않는 코드에서 값이 들어오는 지점. 파일·DB 읽기, 와이어 수신, 모델 도구 인자, 확장 페이로드, 환경 변수, 설정 파일 |
| 도메인 타입 | 경계 검증을 통과한 뒤의 타입. `Static<typeof XSchema>`나 브랜드 타입 |
| 예상 가능한 실패 | 코드와 설정이 올바라도 입력·환경 때문에 정상 운영 중에 일어나는 실패. I/O 오류, 잠금 경합(busy), 디스크 가득 참(disk_full), 읽기 전용(read_only), 취소, 찾지 못함, 검증 실패, 소유권 상실(lease·잠금을 잃음), 시간 초과, 외부 프로세스·네트워크 실패, 저장 데이터 손상. 목록은 TY-24가 정한다 |
| 버그 | 코드가 스스로 세운 불변 조건을 어긴 상태. 도달 불가 분기, 깨진 내부 상태, 호출 계약 위반(닫힌 저장소에 쓰기, 트랜잭션 중첩). 코드를 고쳐야만 사라진다 |
| 타입 소거 | TypeScript 타입은 컴파일 뒤 런타임에 남지 않는다. 타입 선언과 단언은 런타임 값을 검사하지 않는다 |
| 단언 허용 목록 | TY-06 표. `as` 단언이 허용되는 위치의 닫힌 목록이다. 표에 없는 위치의 단언은 예외 주석으로도 허용하지 않는다 |
| 스캔 | `scripts/check-ts-rules.ts` [제안]. oxlint와 tsc에 없는 규칙을 검사하는 저장소 자체 스크립트 |

### 1.2 공용 이름

아래 이름은 다른 문서가 이 철자로 인용한다. 정의 위치는 F 계약 패키지 `@xeon/contracts`의 루트 진입점이다 [제안]. 서브패스 배치와 의존 방향은 `eng.domain-types.guide` DT-12가 정한다.

```ts
// @xeon/contracts (루트 진입점 ".")
declare const brandTag: unique symbol;

/** 같은 원시 타입끼리 섞이지 않게 하는 이름표. 런타임 값은 원시 값 그대로다. */
export type Brand<T, Name extends string> = T & { readonly [brandTag]: Name };

/** 예상 가능한 실패를 값으로 돌려주는 결과 타입. E는 kind 판별 유니온이다. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** 버그를 나타내는 유일한 throw 대상. 예상 가능한 실패에는 쓰지 않는다. */
export class Bug extends Error {
  override readonly name: string = "Bug";
}

/** 판별 유니온의 남은 변형이 없음을 컴파일 시점에 확인한다. 런타임에 호출되면 버그다. */
export function assertNever(value: never, where: string): never {
  throw new Bug(`unreachable variant in ${where}`, { cause: value });
}

/** 현재 시각(Unix epoch ms). 테스트는 고정 시계를 주입한다. */
export interface Clock {
  now(): number;
}

export type TimerHandle = number;

/** 지연 실행. 운영 구현은 L0 platform-os, 테스트는 각 패키지 test/ 안의 manualClock이 Clock과 함께 구현한다(eng.testing.guide TS-03). */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** [0, 1) 균등 난수 공급원. 테스트는 각 패키지 test/ 안의 시드 고정 구현(seededRandom)을 주입한다. */
export type RandomSource = () => number;

/** 던진 값을 그대로 담은 오류. 호출자가 자기 오류 유니온으로 옮기거나 cause로 넘긴다. */
export type Thrown = { readonly kind: "threw"; readonly cause: unknown };
export type JsonParseError = { readonly kind: "parse_json"; readonly cause: unknown };

/** 던질 수 있는 호출 하나를 Result로 바꾼다(TY-25 변환). 외부 API가 계약상 던지는 자리에서 try를 직접 쓰지 않으려는 용도다. */
export function attempt<T>(fn: () => T): Result<T, Thrown>;
export function attemptAsync<T>(fn: () => PromiseLike<T>): Promise<Result<T, Thrown>>;
/** JSON 문자열을 unknown으로 읽는다. 값은 쓰기 전에 parse로 검증한다(TY-10). */
export function parseJson(text: string): Result<unknown, JsonParseError>;
/** 기다리지 않는 비동기 호출의 거부를 onFailure로 넘긴다. onFailure는 기록, 알림, 상태 표시 중 하나를 한다(TY-25). */
export function detach(work: PromiseLike<unknown>, onFailure: (cause: unknown) => void): void;
/** 받은 값을 그대로 다시 던진다(TY-25 3). 시험 대역의 detach 처리기로 쓴다. */
export function rethrow(cause: unknown): never;
```

- `attempt`, `attemptAsync`, `parseJson`, `detach`, `rethrow`는 `packages/contracts/src/base/attempt.ts`에 있다. `toJsonValue(value: unknown): JsonValue | undefined`는 `@xeon/contracts/conversation`에 있으며 JSON 값으로 좁히는 가드 대신 쓴다. 단언 대신 이 도구로 좁힌다(TY-23).

- `ThreadId`, `EventId`, `TurnId`, `ItemId`, `EffectId` 같은 브랜드 ID 타입과 `IdFactory`는 `F.conversation.spec` §3.2가 정의하고 `@xeon/contracts/conversation`에 둔다. `parse`, `ParseError`는 `eng.domain-types.guide` DT-05가 정의한다. 멱등 키(`requestId`, 커밋 키)에는 브랜드가 없다(DT-06).
- 구현 위치 [결정: review.decisions-2 U-03]: F에는 `Clock`·`Scheduler`·`RandomSource`·`IdFactory` 인터페이스만 둔다. `Clock`, `RandomSource`, `Scheduler`의 운영 구현과 `IdFactory` 구현 `createIdFactory(clock, random)`은 L0 `platform-os`에 두고 Cordis 서비스로 주입한다. `createIdFactory`는 주입받은 `Clock`·`RandomSource`로 ID를 만든다(TY-06 허용 목록 A2). F에는 `./testing` 서브패스가 없고, 테스트 대역(`manualClock`, `seededRandom`, `fixedIdFactory`)은 각 패키지 `test/` 안에 둔다(`F.readme` §1, `eng.domain-types.guide` DT-06).
- [제안] `Scheduler`, `TimerHandle`은 이 절이 정한다. `Clock`에 타이머를 넣지 않는 이유: 시각만 읽는 코드(투영 입력, envelope 도장)가 타이머 능력까지 받지 않게 한다.
- `CancelScope`(`{ readonly abortSignal: AbortSignal | undefined }`)는 F `services`(`@xeon/contracts/services`의 `services/exec.ts`)에 둔다(`L0.exec.spec` §3.2, `F.capabilities.spec` §3.12) [결정: review.decisions-2 D-04]. pi durable 포크 코드(`platform-exec`, L2 `cap-workspace`)와 그 직접 소비자만 쓴다. 그 밖의 API는 `AbortSignal`을 받는다. 다른 곳에서 이 이름을 새로 정의하지 않는다(TY-22).

### 1.3 구현자 체크리스트 (구속)

구현 에이전트와 사람 구현자는 코드를 쓰기 전과 `just verify` 전에 이 목록을 확인한다. 각 줄은 2절 규칙의 요약이고, 판정은 규칙 본문이 한다. `xeon/AGENTS.md`와 `.claude/skills/xeon-*/SKILL.md`는 이 목록을 가리킨다.

타입 단언과 우회 금지:

1. `as` 타입 단언을 쓰지 않는다. `as unknown as T`, `<T>value`, `JSON.parse(x) as T`도 같다. `as const`만 허용한다. 예외는 TY-06 허용 목록의 위치(A1~A6)뿐이다 (TY-06).
2. 비null 단언 `!`을 쓰지 않는다. `undefined` 분기를 쓰고, 없으면 `Result`로 돌려준다 (TY-07, TY-18).
3. `any`를 쓰지 않는다. 외부 `any`는 받는 즉시 `unknown`으로 주석한다 (TY-02).
4. `@ts-ignore`, `@ts-nocheck`를 쓰지 않는다. `@ts-expect-error`는 테스트 파일에서만, 이유를 달아 쓴다 (TY-08).
5. 단언 대신 타입 가드, `satisfies`, 브랜드 생성 함수, 판별 유니온과 `assertNever`로 좁힌다. 반환 타입에만 나오는 타입 매개변수(`function load<T>(): T`)는 숨은 단언이므로 쓰지 않는다 (TY-23).
6. 타입은 런타임에 지워진다. 경계 값(파일, DB, 와이어, 모델 출력, 확장 페이로드, 환경 변수)은 `unknown`으로 받아 TypeBox `parse`로 검증한다 (TY-10, `eng.domain-types.guide` DT-05).

실패 처리:

7. 예상 가능한 실패(I/O, busy, disk_full, read_only, cancelled, not_found, 검증 실패, 소유권 상실, timeout)는 `kind`가 있는 오류 값으로 `Result`에 담아 돌려준다. `throw`하지 않고, 특히 `Bug`로 던지지 않는다 (TY-11, TY-24).
8. `Bug`는 불변 조건 위반(프로그래머 오류)에만 쓴다. 판정 질문: "코드와 설정이 올바라도 이 실패가 일어날 수 있는가?" 그렇다면 `Bug`가 아니다 (TY-24).
9. `catch`는 오류를 조용히 삼키지 않는다. 받은 값을 `cause`로 담아 오류 값으로 바꾸거나, 주입된 Logger로 기록하고 문서가 정한 정책대로 계속하거나, 그대로 다시 던진다. 빈 `catch`, 바인딩 없는 `catch`, `.catch(() => undefined)`는 금지다. 던질 수 있는 호출 하나는 `attempt`/`attemptAsync`, 기다리지 않는 호출은 `detach`로 받는다 (TY-25, 1.2절).
10. 오류 유니온의 판별자는 `kind`다. `switch`는 `default`에서 `assertNever`를 부른다 (TY-12, TY-13, TY-14).

억제와 예외:

11. 린트·tsc 검사를 끄거나 설정을 바꿔 통과시키지 않는다. 줄 단위 예외는 4.1절 형식만 쓰고, 미리 허용된 위치는 이유와 `(<문서 id> <규칙 ID>)`를 단다. 예: `// oxlint-disable-next-line typescript/consistent-type-assertions -- 허용 목록 A2 브랜드 생성 (eng.typescript.guide TY-06)`.
12. 이 목록을 지킬 수 없는 줄이 있으면 우회하지 말고 작업 보고에 `[미결] TY-NN <위치> <이유>`로 적는다.

## 2. 규칙

각 규칙은 번호, 내용, 이유, 좋은 예, 나쁜 예를 가진다. 나쁜 예 옆 주석은 `just verify`에서 실패하는 검사 이름이다. 검사 이름이 "리뷰"뿐인 규칙은 5절 수용 기준의 예외 목록에 있다.

### TY-01 tsconfig 필수 옵션을 끄지 않는다

[결정] `xeon/tsconfig.base.json`은 아래 여섯 옵션을 켠다(`_research/foundation-plan.md §2`). 패키지 `tsconfig.json`은 base를 `extends`하고 이 옵션을 `false`로 덮어쓰지 않는다.

| 옵션 | 막는 실수 | 대표 오류 | 관련 규칙 |
|---|---|---|---|
| `strict` | 암시적 `any` 매개변수, `null`·`undefined` 미검사, 함수 매개변수 공변 대입 | TS7006, TS18047, TS18048 | TY-02 |
| `isolatedDeclarations` | 공개 export의 타입이 추론에만 의존해 d.ts가 구현 변경에 따라 조용히 바뀌는 것 | TS9007(함수 반환), TS9010(변수) | TY-20, DT-03 |
| `exactOptionalPropertyTypes` | "키 없음"과 "키는 있고 값이 `undefined`"를 섞는 것 | TS2375, TS2379 | TY-17 |
| `noUncheckedIndexedAccess` | 배열·레코드 인덱스 접근 결과를 항상 있는 값으로 다루는 것 | TS18048, TS2532 | TY-18 |
| `verbatimModuleSyntax` | 타입만 쓰는 import가 런타임 import로 남거나, 지워질지 불분명한 import | TS1484 | TY-19 |
| `erasableSyntaxOnly` | 타입을 지워도 런타임 코드가 남는 TS 전용 구문: `enum`, 값을 가진 `namespace`, 생성자 매개변수 프로퍼티, `import x = require()` | TS1294 | TY-03, TY-04, TY-16 |

이유:

- Bun은 TS 소스를 그대로 실행하고 내부 패키지는 TS 소스를 export한다(`_research/foundation-plan.md §2` 빌드 행). 타입 제거만으로 실행 가능한 코드여야 Bun 트랜스파일러와 tsgo의 해석이 같아진다. `erasableSyntaxOnly`가 그 조건을 컴파일 오류로 강제한다.
- `erasableSyntaxOnly` 때문에 `enum`, `namespace`, 매개변수 프로퍼티는 린트 이전에 tsc 단계에서 TS1294 오류다(`_research/notes/eng-1.md §3` 프로브). TY-03, TY-04, TY-16의 금지는 이 옵션의 결과를 규칙으로 옮긴 것이다.
- 나머지 다섯 옵션은 각 행의 실수가 런타임까지 남지 않게 한다. 예는 해당 규칙에 있다.

좋은 예:

```jsonc
// xeon/packages/core-loop/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src", "test"],
  "references": [{ "path": "../contracts" }]
}
```

나쁜 예:

```jsonc
// 스캔 xeon/tsconfig-flags 실패: 필수 옵션을 false로 덮어씀
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "exactOptionalPropertyTypes": false, "noUncheckedIndexedAccess": false }
}
```

### TY-02 `any`를 쓰지 않는다. `unknown`으로 받고 좁힌다

이유: `any`는 타입 검사를 그 지점부터 끊고, 오염이 호출 사슬을 따라 퍼진다. `unknown`은 좁히기 전에는 아무 연산도 허용하지 않으므로 검증 위치가 코드에 드러난다.

좋은 예:

```ts
import { parse } from "@xeon/contracts";
import { ToolIntendedSchema, type ToolIntended } from "@xeon/contracts/records";

export function readToolCall(raw: string): ToolIntended | undefined {
  const json: unknown = JSON.parse(raw);
  const result = parse(ToolIntendedSchema, json);
  return result.ok ? result.value : undefined;
}
```

나쁜 예:

```ts
// oxlint typescript/no-explicit-any, typescript/no-unsafe-member-access 실패
export function readToolCall(raw: string): string {
  const call: any = JSON.parse(raw);
  return call.toolName;
}
```

- `JSON.parse`의 반환값은 `any`다. 바로 `unknown` 변수에 담는다. 주석 없이 담으면 `typescript/no-unsafe-assignment`가 실패한다.
- 외부 라이브러리가 `any`를 돌려주면 받는 즉시 `unknown`으로 주석한다.

### TY-03 `enum`을 쓰지 않는다. `as const` 객체와 리터럴 유니온을 쓴다

이유:

- `enum`은 런타임 객체를 만드는 TS 전용 구문이라 `erasableSyntaxOnly`에서 TS1294다.
- 숫자 enum은 아무 숫자나 대입을 허용하고, 이벤트·와이어에 숫자로 저장되면 이름을 바꾸거나 순서를 바꿀 때 의미가 바뀐다.
- 리터럴 유니온은 JSON에 그대로 저장되고 TypeBox `Type.Literal` 유니온과 1:1로 대응한다.

스키마에서 나오는 열거(이벤트 `type`, 판별자)는 TypeBox 스키마에서 `Static`으로 얻는다(DT-02). 스키마가 없는 내부 상수만 아래 형태로 쓴다.

좋은 예:

```ts
// post 주입 시점. 이름과 값은 F.extensions.spec이 정한다 [가정: _research/ext-points.md §5 안 1의 when 값]
export const PostWhen = {
  steer: "steer",
  followUp: "followUp",
  next: "next",
} as const;
export type PostWhen = (typeof PostWhen)[keyof typeof PostWhen];

export function describeWhen(when: PostWhen): string {
  switch (when) {
    case "steer":
      return "다음 도구 라운드 뒤";
    case "followUp":
      return "정착 뒤";
    case "next":
      return "경계 뒤 한 요청";
    default:
      return assertNever(when, "PostWhen");
  }
}
```

나쁜 예:

```ts
// tsc TS1294 실패 (erasableSyntaxOnly)
export enum PostWhen {
  Steer,
  FollowUp,
  Next,
}

// oxlint oxc/no-const-enum 실패
export const enum Fold {
  Tap = "tap",
}

// 스캔 xeon/no-declare-enum 실패
declare enum Legacy {
  A,
}
```

- `PostWhen`처럼 값 이름과 타입 이름을 같게 두면 `PostWhen.steer`와 `PostWhen` 타입을 함께 쓸 수 있다. `isolatedDeclarations`에서 `as const` 객체 리터럴은 구문으로 타입을 정할 수 있다 [가정: `_research/notes/eng-2.md §3-1`의 객체 리터럴 경로. `as const` 처리는 컴파일 미검증].

### TY-04 `namespace`를 쓰지 않는다

이유: 값을 가진 `namespace`는 `erasableSyntaxOnly`에서 TS1294다. 타입만 가진 `namespace`도 ES 모듈과 이름 공간을 이중으로 만들어 트리 셰이킹과 `import type` 판정을 흐린다. 모듈 파일 하나가 이름 공간 하나다.

좋은 예:

```ts
// packages/contracts/src/records/thread-kinds.ts
export const THREAD_EVENT_KINDS = ["thread.started", "thread.closed"] as const;   // F.records.spec §3.3 카탈로그
export type ThreadEventKind = (typeof THREAD_EVENT_KINDS)[number];

// 소비 쪽
import { type ThreadEventKind } from "@xeon/contracts/records";
```

나쁜 예:

```ts
// tsc TS1294 실패, oxlint typescript/no-namespace 실패
export namespace ThreadEvents {
  export const started = "thread.started";
}

// oxlint typescript/no-namespace 실패 (allowDeclarations 기본값 false)
declare namespace Ambient {
  type X = string;
}
```

- 허용: 외부 모듈 보강 `declare module "pkg" { ... }`. `typescript/no-namespace`는 이 형태를 검출하지 않는다(`_research/notes/eng-1.md §2` 프로브).

### TY-05 default export를 쓰지 않는다. 이름 있는 export만 쓴다

이유:

- default export는 import하는 쪽이 이름을 마음대로 붙이므로 같은 대상이 파일마다 다른 이름으로 불린다. 이 문서들은 F가 정한 이름을 모든 층에서 같은 철자로 쓴다(`_templates/README.md` 문체 규칙).
- 이름 변경 리팩터링과 knip 미사용 검사가 이름 있는 export에서 정확하다.

좋은 예:

```ts
export function createToolRegistry(deps: ToolRegistryDeps): ToolRegistry {
  // ...
}
```

나쁜 예:

```ts
// oxlint import/no-default-export 실패
export default function (deps: ToolRegistryDeps): ToolRegistry {
  // ...
}
```

- 도구 설정 파일이 default export를 요구하면(예: `oxfmt.config.ts`) `.oxlintrc.json` `overrides`에 그 파일 경로만 넣는다. 현재 저장소는 JSON 설정만 쓰므로 해당 경로가 없다.

### TY-06 타입 단언 `as`는 허용 목록 위치에서만 쓴다

금지 형태: `value as T`, `value as unknown as T`(이중 단언), `<T>value`(꺾쇠 단언), `JSON.parse(text) as T`, `{} as T`(빈 객체를 채울 것처럼 단언), `as any`. 모두 `typescript/consistent-type-assertions`(`assertionStyle: "never"`)가 실패시킨다. `as const`는 단언으로 세지 않는다(oxlint 1.89에서 `assertionStyle: "never"`가 `as const`를 통과시킴을 프로브로 확인했다).

허용 목록(닫힌 목록. 행 ID로 인용한다):

| ID | 위치 | 허용하는 단언 | 조건 |
|---|---|---|---|
| A1 | `packages/contracts/src/base/parse.ts`의 `parse` 구현 | 검증을 통과한 값을 `Static<S>`로 | 검증기의 `Check`가 참을 돌려준 뒤에만. 검증기가 타입 가드를 돌려주면 단언을 지운다. 현재 구현은 타입 가드(`matches`)라 단언이 없고 행만 남아 있다 |
| A2 | 브랜드 생성 함수: `packages/platform-os/src/ids.ts`의 `createIdFactory`, 테스트 대역 `fixedIdFactory`(`test/`, `src/testing/` 안) | 새로 만든 문자열을 `IdByPrefix[P]`로 | 문자열을 그 함수 안에서 만들었을 때만. 받은 문자열에 브랜드를 붙이는 일은 `parse(XxxIdSchema, input)`으로 한다 |
| A3 | 타입 지움·복원 한 파일: `packages/ext-host/src/erase.ts` | 이종 레지스트리(핸들러, 포트, 능력, scope 정의, 확장 테이블 핸들)의 값을 지운 타입으로 보관하거나, `ServiceKey<T>`·`PortKey<T>`·테이블 정의 `D`에 실린 타입으로 되돌릴 때 | 등록 함수가 같은 키의 타입 매개변수로만 값을 받는다. ext-host의 단언은 모두 이 파일의 함수 하나씩이고 호출 쪽은 단언이 없다. 시험이 `PlatformContext` 대역을 만들 때는 `@xeon/ext-host/testing`의 `portAs`를 쓴다 |
| A4 | 모양을 유지하는 깊은 변환: `packages/platform-secrets/src/redactor.ts`의 `maskDeep`, 그 대역 `packages/core-tools/src/testing/fake-secrets.ts` | 문자열만 바꾼 값을 입력과 같은 타입 `T`로 | 키, 배열 길이, 비문자열 값을 그대로 둘 때만. F `Redactor.maskDeep<T>` 시그니처가 `T`를 요구한다 |
| A5 | 선언 함수의 키별 리터럴 복원: `packages/contracts/src/wire-settings/settings/define.ts`의 `defineSettings` | 입력 `D`에서 오는 키별 타입으로 만든 결과를 `SettingGroup<N, D>`로 | 위 루프가 모든 키를 채운 뒤에만(`F.readme` §1 예외 4). 새 `define*`가 같은 사유로 단언이 필요하면 행을 더하기 전에 `[미결]`로 보고한다 |
| A6 | 시험의 타입 어김 주입기: 패키지당 시험 지원 파일 하나(`packages/ext-host/test/primitives/fixtures/support.ts`, `apps/host/test/fixtures/unsafe.ts`) | 스키마·가드가 막는지 확인하려고 `unsafeInput`, `returning`, `partial`, `asFrame`이 값을 다른 타입으로 | 시험이 JS 호출자나 서버의 잘못된 값을 흉내 낼 때만. 시험 본문에는 단언을 쓰지 않고 이 함수를 거친다 |

- 표에 없는 위치의 단언은 disable 주석을 달아도 허용하지 않는다. 스캔 `xeon/as-location`(`scripts/check-ts-rules.ts`)이 실패시킨다. 스캔은 행 ID마다 허용 파일을 코드에 적어 두므로 표와 같이 고친다.
- 허용 위치의 단언은 줄마다 disable 주석을 단다. 좁히는 단언은 `typescript/no-unsafe-type-assertion`도 걸리므로 두 규칙을 쉼표로 함께 적는다. 형식: `// oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 <행 ID> <이유> (eng.typescript.guide TY-06)`. 경로 단위 `overrides`로 규칙을 끄지 않는다. 그래야 단언 개수가 4.2절 집계에 나온다.
- 2026-10-23 기준 허용 줄 수는 A2 6, A3 13, A4 2, A5 1, A6 4로 모두 26줄이다(적용 전에는 단언 자리가 64곳이었다).
- 허용 목록에 행을 더하려면 이 표를 먼저 고치고 리뷰어 승인을 받는다. 구현 작업 중에는 행을 더하지 않고 `[미결] TY-06 <위치> <이유>`로 보고한다. 목록은 줄어드는 방향으로만 관리한다.
- 허용 위치 밖에서는 단언 없이 `parse`, 브랜드 생성 함수, 타입 가드, `satisfies`를 쓴다(TY-23).

이유: `as`를 쓰면 컴파일러가 값을 검사하지 않고 타입만 바꾼다. 타입은 런타임에 지워지므로 단언은 런타임에도 아무것도 확인하지 않는다. 단언이 흩어지면 잘못된 데이터가 도메인 타입 이름을 달고 깊은 곳까지 들어간다. 단언을 닫힌 목록으로 모으면 리뷰 대상이 몇 파일로 줄어든다.

좋은 예:

```ts
// packages/platform-os/src/ids.ts: IdFactory 구현 (허용 목록 A2. 위치는 review.decisions-2 U-03)
export function createIdFactory(clock: Clock, random: RandomSource): IdFactory {
  return {
    next(prefix) {
      const ulid = encodeUlid(clock.now(), random);
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성 (eng.typescript.guide TY-06)
      return `${prefix}_${ulid}` as IdByPrefix[typeof prefix];
    },
  };
}

// 소비 쪽: 단언 없음
const threadId = ids.next("thr");
```

나쁜 예:

```ts
// oxlint typescript/consistent-type-assertions(assertionStyle: never) 실패
const threadId = request.params.threadId as ThreadId;

// 같은 규칙 실패: 이중 단언
const event = raw as unknown as DurableEventEnvelope;

// 같은 규칙 실패: JSON 결과 단언. 타입 소거 때문에 런타임 검사는 하나도 없다
const settings = JSON.parse(text) as SettingsFile;

// 같은 규칙 실패, 스캔 xeon/as-location 실패: 허용 목록 밖의 단언은 주석이 있어도 실패
// oxlint-disable-next-line typescript/consistent-type-assertions -- 타입이 맞음 (eng.typescript.guide TY-06)
return handler as unknown as HandlerEntry["fn"];
```

- 위 좋은 예의 disable 주석은 이슈 링크가 없다. 허용 목록 위치의 주석은 허용 목록 ID와 이유, `(eng.typescript.guide TY-06)`을 링크 대신 적는다(4.1절).

### TY-07 비null 단언 `!`을 쓰지 않는다

이유: `!`는 `null`·`undefined` 검사를 끄는 단언이다. `noUncheckedIndexedAccess`와 `strict`가 드러낸 빈 값 가능성을 같은 글자 하나로 지운다.

좋은 예:

```ts
const call = pendingCalls.get(toolCallId);
if (call === undefined) {
  return err({ kind: "unknown_tool_call", toolCallId });
}
call.abort.abort();
```

나쁜 예:

```ts
// oxlint typescript/no-non-null-assertion 실패
pendingCalls.get(toolCallId)!.abort.abort();

// oxlint typescript/no-non-null-asserted-optional-chain 실패
const name = session?.title!;
```

### TY-08 `@ts-ignore`, `@ts-nocheck`를 쓰지 않는다. `@ts-expect-error`는 테스트 파일에서만 이유를 달아 쓴다

규칙:

- 운영 코드(`src/**`, `scripts/**`의 테스트 아닌 파일)에서는 `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`를 모두 쓰지 않는다.
- 테스트 파일(`**/test/**`, `**/*.test.ts`)에서는 `@ts-expect-error`만 쓴다. 용도는 "이 코드는 타입 검사에서 거부되어야 한다"를 확인하는 타입 테스트다. 형식은 `// @ts-expect-error -- <이유> (<문서 id> <규칙·절>)` 또는 이슈 URL이다.
- 외부 라이브러리 타입이 틀려 운영 코드가 컴파일되지 않으면 억제 주석을 쓰지 않는다. 그 라이브러리를 감싸는 경계 어댑터에서 값을 `unknown`으로 받아 `parse`나 타입 가드로 좁힌다(TY-10, TY-23). 어댑터로도 풀리지 않으면 `[미결] TY-08 <위치> <이유>`로 보고한다.

이유: `@ts-ignore`는 오류가 사라진 뒤에도 남아 다음 줄의 새 오류까지 숨긴다. `@ts-expect-error`는 오류가 없어지면 그 자체가 오류(TS2578)가 되므로 낡은 억제가 남지 않지만, 운영 코드에서는 단언과 같은 결과를 낸다. 컴파일러가 확인하지 않은 값을 그대로 다음 줄에 넘긴다.

좋은 예:

```ts
// 테스트 파일: 잘못된 호출이 컴파일 오류인지 확인한다
// @ts-expect-error -- 레지스트리에 없는 메서드는 컴파일 오류다 (F.wire-settings.spec §9 A8)
client.call("turn.unknown", {});

// 운영 코드: 외부 타입이 틀리면 경계에서 unknown으로 받아 좁힌다
const raw: unknown = piStream.result();
const message = parse(AssistantMessageSchema, raw);
```

나쁜 예:

```ts
// oxlint typescript/ban-ts-comment 실패 (ts-ignore: true)
// @ts-ignore
stream(model, context, { signal: undefined });

// oxlint typescript/ban-ts-comment 실패 (운영 코드의 ts-expect-error: true)
// @ts-expect-error -- pi-ai 1.3.0 타입이 signal을 선택으로 두지 않음 (https://github.com/<owner>/<repo>/issues/12)
stream(model, context, { signal: undefined });

// 테스트 파일에서도 oxlint typescript/ban-ts-comment 실패 (allow-with-description: 설명 없음)
// @ts-expect-error
client.call("turn.unknown", {});
```

### TY-09 ID는 브랜드 타입으로 구분한다

이유: `ThreadId`, `EventId`, `TurnId`, `EffectId`는 런타임에 모두 문자열이다. 브랜드 없이 `string`으로 두면 함수 인자 순서를 바꿔 넘겨도 컴파일된다. 브랜드는 런타임 비용 없이 이 실수를 컴파일 오류로 만든다.

- 정의: `Brand<T, Name>`(1.2절). 브랜드 ID 타입과 스키마는 `F.conversation.spec` §3.2가 정하고, 쓰는 규칙은 `eng.domain-types.guide` DT-06이 정한다.
- 브랜드 값을 만드는 길은 둘뿐이다. 새 접두 ID는 `IdFactory.next(prefix)`, 경계에서 받은 값은 `parse(XxxIdSchema, input)`이다. 단언은 TY-06 허용 목록 A2에만 있다.
- 멱등 키는 브랜드가 없는 문자열이다. payload `requestId`는 1~64자(`F.conversation.spec` §3.5), 커밋 키는 먼저 커밋된 값에서 만드는 `CommitKey`다(`eng.transactions.design` 4.7·4.8절). 결정적으로 만들어야 하므로 `IdFactory.next`로 만들지 않는다.

좋은 예:

```ts
import { type EventId, type ThreadId } from "@xeon/contracts/conversation";

export function loadEvent(threadId: ThreadId, eventId: EventId): Promise<DurableEventEnvelope | undefined> {
  // ...
}

loadEvent(thread.id, event.id);
```

나쁜 예:

```ts
// tsc TS2345 실패: 인자 순서가 바뀜 (EventId는 ThreadId에 대입 불가)
loadEvent(event.id, thread.id);

// oxlint typescript/consistent-type-assertions 실패: 허용 목록 밖에서 브랜드 생성
const id = `thr_${crypto.randomUUID()}` as ThreadId;
```

### TY-10 경계 입력은 `unknown`으로 받아 검증한 뒤 도메인 타입으로 들인다

이유: 디스크·와이어·모델·확장에서 온 값은 타입 선언과 무관하게 어떤 모양이든 될 수 있다. TypeScript 타입은 컴파일 뒤 지워지므로 타입 선언, 제네릭 인자, 단언은 런타임 값을 하나도 확인하지 않는다. 런타임 검사는 TypeBox 검증뿐이다. 경계에서 한 번 검증하면 안쪽 코드는 방어 검사 없이 도메인 타입을 믿을 수 있다. 검증을 안쪽으로 미루면 같은 검사가 여러 곳에 흩어지고 일부는 빠진다.

- 경계 함수의 입력 매개변수 타입은 `unknown`이다. `string`, `Record<string, unknown>` 같은 부분 가정 타입으로 받지 않는다.
- 검증은 TypeBox 스키마와 `parse(schema, input): Result<Static<S>, ParseError>`로 한다(DT-05). 검증 실패는 `Result`의 `error`로 돌려준다(TY-11).
- 경계 목록과 변환 위치는 `eng.domain-types.guide` DT-04, DT-05가 정한다.
- 타입 매개변수로 경계 값의 타입을 정하지 않는다. `readJson<T>(path): T`, `call<R>(method): Promise<R>`처럼 호출자가 고른 `T`를 그대로 돌려주는 함수는 검증 없는 단언이다. 스키마를 인자로 받는다: `readJson(path, schema): Result<Static<S>, ReadJsonError>`(TY-23).

좋은 예:

```ts
// 확장 페이로드 경계 (X ext-host)
export function acceptPost(item: unknown): Result<PostItem, ParseError> {
  return parse(PostItemSchema, item);
}
```

나쁜 예:

```ts
// oxlint typescript/consistent-type-assertions 실패, 리뷰 TY-10 (입력 타입이 unknown이 아님)
export function acceptPost(item: Record<string, unknown>): PostItem {
  return { requestId: item["requestId"] as string, when: "next", payload: item["payload"] };
}
```

### TY-11 예상 가능한 실패는 `Result`나 오류 유니온으로 돌려주고, `throw`는 버그에만 쓴다

이유:

- `throw`는 함수 타입에 드러나지 않는다. 호출자는 어떤 실패를 처리해야 하는지 타입으로 알 수 없고, 처리하지 않아도 컴파일된다.
- `Result<T, E>`의 `E`가 `kind` 판별 유니온이면 호출자가 모든 실패 종류를 `switch`로 처리하고 `assertNever`로 누락을 검사할 수 있다(TY-13).
- 이벤트 재생과 재개에서 실패는 기록 대상이다. 값으로 돌려받아야 이벤트 payload로 남길 수 있다.

`throw`를 허용하는 경우:

1. 버그: 불변 조건 위반, 도달 불가 분기, 호출 계약 위반. `throw new Bug(...)` 또는 `assertNever(...)`. 판정은 TY-24가 한다.
2. 외부 API 계약: 라이브러리가 콜백에서 throw를 요구할 때. 받은 오류를 그대로 다시 던지거나(`throw caught`), 4절 예외 주석을 단다.

복구할 수 없는 상태(예: DB 파일 손상으로 시작 불가, 디스크 가득 참으로 세션 진행 불가)도 예상 가능한 실패다. `throw`하지 않고 `kind`가 있는 오류 값으로 돌려준다. 진입점(L4 `apps/*`)이 그 `kind`를 보고 세션을 멈추거나 종료 코드로 바꾼다. 어느 세션을 멈출지는 호출 사슬의 각 층이 값으로 보고 정한다(`eng.anti-patterns.guide` AP-S-06).

좋은 예:

```ts
export type ToolCallError =
  | { readonly kind: "tool_not_found"; readonly toolName: string }
  | { readonly kind: "invalid_input"; readonly issues: readonly ParseIssue[] }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "cancelled" };

export function resolveTool(registry: ToolRegistry, name: string): Result<ToolDef, ToolCallError> {
  const tool = registry.get(name);
  return tool === undefined ? err({ kind: "tool_not_found", toolName: name }) : ok(tool);
}
```

나쁜 예:

```ts
// 스캔 xeon/throw-only-bug 실패: Bug 외의 Error를 throw
export function resolveTool(registry: ToolRegistry, name: string): ToolDef {
  const tool = registry.get(name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool;
}
```

- `catch`로 받은 값은 `unknown`이다. 외부 라이브러리 오류는 `catch` 지점에서 오류 유니온 변형으로 바꾼다. 다시 던질 때는 받은 값을 그대로 던진다(`throw caught`). 스캔은 `throw <식별자>`를 허용하고 `throw new X(...)`에서 `X`가 `Bug`가 아니면 실패시킨다.
- `typescript/only-throw-error`, `no-throw-literal`, `unicorn/throw-new-error`가 문자열·객체 throw를 막는다(`xeon/.oxlintrc.json`).

### TY-12 오류 유니온의 판별 필드는 `kind`다

이유: 판별 필드 이름이 하나면 오류 처리 코드를 모든 패키지에서 같은 형태로 쓴다. 와이어·파트 같은 데이터 유니온의 판별자는 `type`이고(DT-07), 오류는 `kind`로 둔다. 이벤트 envelope의 `kind`(DT-07 예외, `F.records.spec` §3.1)는 payload 밖 필드라, 오류 객체가 이벤트 payload 안에 들어가도 판별자가 겹치지 않는다.

- 값은 `snake_case` 소문자 문자열이다 [제안]. 확장이 더하는 오류는 `x.<extId>.<name>` 또는 `grp.<groupId>.<name>` 형태다(DT-08).
- 오류 변형은 사람이 읽을 `message`를 필수로 두지 않는다. 표시 문구는 L4가 `kind`와 필드로 만든다 [제안].
- 사용자에게 보일 수 있는 오류도 같은 `kind` 유니온으로 둔다. `code`, `messageKey` 같은 별도 필드를 두지 않고, L4가 `kind`에서 메시지 키를 유도한다 [제안]. 유도 규칙은 6절 [미결]이다(`eng.best-practices.guide` BP-04).

좋은 예:

```ts
export type SessionOpenError =
  | { readonly kind: "session_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "session_locked"; readonly holderPid: number }
  | { readonly kind: "schema_too_new"; readonly found: number; readonly supported: number };
```

나쁜 예:

```ts
// 리뷰 TY-12, 스캔 xeon/error-discriminant 실패: 판별자 이름이 type, code로 섞임
export type SessionOpenError =
  | { readonly type: "not_found"; readonly threadId: ThreadId }
  | { readonly code: 409; readonly holderPid: number };
```

- 스캔 `xeon/error-discriminant`는 이름이 `Error`로 끝나는 export 타입 별칭이 유니온이면 모든 변형에 `kind` 리터럴 프로퍼티가 있는지 정규식 수준으로 검사한다 [제안]. 구현 방식은 6절 [미결] 항목이다.

### TY-13 판별 유니온은 완전성 검사로 처리한다

이유: 유니온에 변형이 늘면 처리 코드 전체가 갱신되어야 한다. `assertNever(value: never)`는 남은 변형이 있으면 컴파일 오류를 내므로 누락이 리뷰 전에 드러난다.

좋은 예:

```ts
export function describeToolError(error: ToolCallError): string {
  switch (error.kind) {
    case "tool_not_found":
      return `없는 도구: ${error.toolName}`;
    case "invalid_input":
      return `입력 오류 ${error.issues.length}건`;
    case "timeout":
      return `${error.afterMs}ms 초과`;
    case "cancelled":
      return "취소됨";
    default:
      return assertNever(error, "ToolCallError");
  }
}
```

나쁜 예:

```ts
// tsc TS2345 실패: "cancelled" 변형이 남아 never에 대입 불가
export function describeToolError(error: ToolCallError): string {
  switch (error.kind) {
    case "tool_not_found":
      return `없는 도구: ${error.toolName}`;
    case "invalid_input":
      return `입력 오류 ${error.issues.length}건`;
    case "timeout":
      return `${error.afterMs}ms 초과`;
    default:
      return assertNever(error, "ToolCallError");
  }
}
```

- `if` 사슬로 처리할 때도 마지막 `else`에서 `assertNever`를 호출한다.
- 확장 가능한 유니온(DT-08)은 알려진 변형을 모두 처리한 뒤 열린 변형을 통과시키고 마지막에 `assertNever`를 호출한다. 형태는 TY-14의 두 번째 좋은 예다.

### TY-14 모든 `switch`는 `default`를 두고 그 안에서 `assertNever`를 호출한다

이유:

- `default`가 없으면 런타임에 알 수 없는 값(버전이 다른 데이터, 단언으로 들어온 값)이 아무 처리 없이 지나간다.
- `default`에서 `assertNever`를 호출하면 컴파일 시점에는 누락 검사, 런타임에는 버그 보고가 된다.
- `default` 안에서 다른 처리를 하면 새 변형이 조용히 그 처리로 떨어진다. 그래서 `default`에는 `assertNever` 호출 또는 열린 변형 통과만 둔다.

좋은 예(닫힌 유니온): TY-13의 좋은 예.

좋은 예(확장 가능한 유니온, DT-08):

```ts
import { isOpenVariant, assertNever } from "@xeon/contracts";
import { type ToolOutcome } from "@xeon/contracts/capabilities";

export function outcomeLabel(outcome: ToolOutcome): string | undefined {
  switch (outcome.type) {
    case "completed":
      return "완료";
    case "failed":
      return `실패: ${outcome.error.kind}`;
    case "denied":
      return "거부됨";
    default:
      if (isOpenVariant(outcome)) return undefined; // 확장 변형은 표시하지 않고 통과
      return assertNever(outcome, "ToolOutcome");
  }
}
```

나쁜 예:

```ts
// oxlint default-case 실패
switch (outcome.type) {
  case "completed":
    return "완료";
  case "failed":
    return "실패";
}

// 리뷰 TY-14: default가 새 변형을 조용히 흡수함
switch (outcome.type) {
  case "completed":
    return "완료";
  default:
    return "기타";
}
```

- 예외: 외부에서 오는 열린 값(`process.platform`처럼 코드가 지원하는 목록보다 넓은 유니온)을 지원 목록으로 거르는 `switch`는 `default`에서 `assertNever` 대신 오류 변형을 `Result`로 돌려준다. 지원 목록 밖 값은 예상 가능한 실패이기 때문이다(TY-11). 그 `default` 줄에는 4.1절 형식으로 `// xeon-disable-next-line xeon/switch-default-never -- <이유> (eng.typescript.guide TY-14)`를 단다. 예: `eng.dependency-rules.guide` DR-13 좋은 예.
- 두 번째 나쁜 예는 `typescript/switch-exhaustiveness-check`의 `considerDefaultExhaustiveForUnions` 기본값(`false`)에서 누락 변형이 보고된다 [가정: 옵션 설명은 `xeon/node_modules/oxlint/configuration_schema.json`. tsgolint 동작은 미검증, 6절 [미결]].
- `noFallthroughCasesInSwitch`(tsconfig)가 `case` 사이 흘러내림을 막는다.

### TY-15 데이터는 불변으로 다룬다

이유: 이벤트 소싱에서 이벤트와 투영 입력은 기록 뒤 바뀌면 안 된다(`eng.domain-types.guide` DT-11). 공유 객체를 고치면 재생 결과가 실행 순서에 따라 달라진다. 타입 수준 `readonly`는 런타임 비용 없이 쓰기를 컴파일 오류로 만든다.

- 객체 타입 프로퍼티는 `readonly`, 배열은 `readonly T[]`, 맵은 `ReadonlyMap`, 집합은 `ReadonlySet`으로 받는다.
- 상수 표는 `as const`로 둔다.
- 갱신은 새 객체를 만든다(펼침 연산자). 로컬 변수 안의 성능상 변경은 함수 밖으로 나가기 전에 끝낸다.
- 스키마에서 얻은 `Static` 타입은 TypeBox가 `readonly`를 붙이지 않는다 [가정]. 함수 매개변수에서 `Readonly<T>`나 `readonly` 배열로 받아 변경을 막는다.

좋은 예:

```ts
export function appendNotice(state: SessionView, notice: Notice): SessionView {
  return { ...state, notices: [...state.notices, notice] };
}

export function countToolCalls(events: readonly DurableEventEnvelope[]): number {
  return events.filter((e) => e.kind === "effect.intent").length;
}
```

나쁜 예:

```ts
// 리뷰 TY-15: 입력 상태를 제자리에서 고침
export function appendNotice(state: SessionView, notice: Notice): SessionView {
  state.notices.push(notice);
  return state;
}

// tsc TS2339 실패: readonly 배열에 push 없음
export function dropFirst(events: readonly DurableEventEnvelope[]): void {
  events.shift();
}
```

- `no-param-reassign`(`xeon/.oxlintrc.json`)은 매개변수 재할당을 막는다. 매개변수 프로퍼티 변경 검출은 옵션 설정에 따른다 [미확인]. 자동 검사가 확인되기 전까지 첫 번째 나쁜 예는 리뷰 항목이다.

### TY-16 클래스보다 함수와 객체를 쓴다

이유:

- 생성자 매개변수 프로퍼티(`constructor(private readonly x: X)`)는 `erasableSyntaxOnly`에서 TS1294다.
- 클래스 인스턴스는 `this` 결합 문제(메서드를 콜백으로 넘길 때)와 구조 비교 불가(private 필드) 때문에 직렬화·재생 데이터에 맞지 않는다.
- 서비스는 의존을 받는 생성 함수가 인터페이스 타입의 객체를 돌려주는 형태로 쓴다. 테스트 대역은 같은 인터페이스의 객체 리터럴이다.

허용: `Bug`(1.2절)와 외부 오류를 감싸야 하는 `Error` 하위 클래스. Cordis 서비스 등록에 클래스 상속이 필요한지는 ext-host 래퍼 설계에 따른다(6절 [미결]).

좋은 예:

```ts
export interface SessionService {
  open(id: ThreadId, signal: AbortSignal): Promise<Result<SessionView, SessionOpenError>>;
}

export function createSessionService(deps: { readonly store: EventStore }): SessionService {
  return {
    async open(id, signal) {
      // deps.store.read: Promise<Result<readonly DurableEventEnvelope[], SessionOpenError>>
      const events = await deps.store.read(id, signal);
      if (!events.ok) return events;
      return ok(projectSession(events.value));
    },
  };
}
```

나쁜 예:

```ts
// tsc TS1294 실패 (매개변수 프로퍼티), 스캔 xeon/no-class 실패
export class SessionService {
  constructor(private readonly store: EventStore) {}
}

// oxlint typescript/no-extraneous-class 실패
export class Ids {
  static next(): string {
    return "x";
  }
}
```

### TY-17 선택 프로퍼티와 `undefined`를 구분한다

이유: `exactOptionalPropertyTypes`에서 `x?: T`는 "키가 없을 수 있다"는 뜻이고 `{ x: undefined }`는 대입할 수 없다. JSON 직렬화는 `undefined` 값의 키를 지우므로 "키 없음"과 "`undefined` 값"을 섞으면 저장 전후 객체가 달라지고 해시가 어긋난다(DT-14 정규화 JSON).

- 값이 없을 수 있으면 키를 생략한다. 객체를 만들 때 조건부 펼침을 쓴다.
- "명시적으로 비움"을 저장해야 하면 `T | null`로 둔다(DT-16).
- `x?: T | undefined`는 외부 라이브러리 타입에 맞출 때만 쓴다.

좋은 예:

```ts
export type ToolCallView = { readonly toolName: string; readonly label?: string };

export function toView(call: ToolIntended, label: string | undefined): ToolCallView {
  return { toolName: call.toolName, ...(label === undefined ? {} : { label }) };
}
```

나쁜 예:

```ts
// tsc TS2375 실패 (exactOptionalPropertyTypes)
export function toView(call: ToolIntended, label: string | undefined): ToolCallView {
  return { toolName: call.toolName, label };
}
```

### TY-18 배열·레코드 인덱스 접근 결과를 처리한다

이유: `noUncheckedIndexedAccess`에서 `xs[i]`와 `record[key]`의 타입은 `T | undefined`다. 범위 밖 접근은 런타임 오류 없이 `undefined`를 돌려주므로 처리하지 않으면 오류가 먼 곳에서 드러난다.

좋은 예:

```ts
export function lastAssistantMessage(messages: readonly Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m !== undefined && m.role === "assistant") return m;
  }
  return undefined;
}

const [first] = events; // first: DurableEventEnvelope | undefined
if (first === undefined) return err({ kind: "empty_session" });
```

나쁜 예:

```ts
// tsc TS18048 실패: 'events[0]' is possibly 'undefined'
const firstType = events[0].type;

// oxlint typescript/no-non-null-assertion 실패 (TY-07)
const firstType2 = events[0]!.type;
```

- 순회는 `for...of`, `map`, `filter`를 먼저 쓴다. 인덱스가 필요하면 `entries()`를 쓴다.

### TY-19 타입만 쓰는 import는 `import type` 또는 인라인 `type`으로 쓴다

이유: `verbatimModuleSyntax`에서 import 문은 쓴 그대로 런타임에 남는다. 타입만 가져오는 import를 일반 import로 쓰면 TS1484 오류다. 반대로 표시가 정확하면 Bun과 tsgo 모두 같은 import를 지우고, 타입 전용 순환 import가 런타임 순환이 되지 않는다.

- 형식은 인라인 `type` 수식어다: `import { parse, type Result } from "@xeon/contracts"`. `.oxlintrc.json`의 `typescript/consistent-type-imports` `fixStyle: "inline-type-imports"`와 맞춘다.
- 모든 이름이 타입이면 `import { type A, type B }` 대신 `import type { A, B }`를 써도 된다 [제안: 자동 수정 결과를 따른다].

좋은 예:

```ts
import { parse, type ParseError, type Result } from "@xeon/contracts";
import { type DurableEventEnvelope } from "@xeon/contracts/records";
```

나쁜 예:

```ts
// tsc TS1484 실패, oxlint typescript/consistent-type-imports 실패
import { Result, DurableEventEnvelope } from "@xeon/contracts/records";
```

### TY-20 공개 API는 반환 타입과 변수 타입을 명시한다

이유:

- `isolatedDeclarations`는 export된 함수·변수의 타입을 다른 파일을 보지 않고 정할 수 있어야 한다. 추론에 의존하면 TS9007(함수), TS9010(변수) 오류다.
- 명시 타입은 패키지 경계의 계약이다. 구현을 바꿔도 공개 타입이 바뀌지 않고, 바뀌면 그 줄에서 컴파일 오류가 난다.
- TypeBox 스키마 export의 주석 패턴은 `eng.domain-types.guide` DT-03이 정한다.

좋은 예:

```ts
export function projectSession(events: readonly DurableEventEnvelope[]): SessionView {
  return events.reduce(applyEvent, EMPTY_SESSION_VIEW);
}

export const EMPTY_SESSION_VIEW: SessionView = { messages: [], notices: [] };
```

나쁜 예:

```ts
// tsc TS9007 실패 (isolatedDeclarations), oxlint typescript/explicit-module-boundary-types 실패
export function projectSession(events: readonly DurableEventEnvelope[]) {
  return events.reduce(applyEvent, EMPTY_SESSION_VIEW);
}

// tsc TS9010 실패
export const EMPTY_SESSION_VIEW = createEmptyView();
```

- 모듈 안 비공개 함수는 반환 타입 추론을 허용한다. 비공개 선언이라도 공개 타입이 `typeof`로 참조하면 같은 검사를 받는다(`_research/notes/eng-2.md §3-1` 마지막 항목 [가정]).
- `isolatedDeclarations`를 공개 패키지에만 켤지는 `eng.domain-types.guide` 미결 사항이다. 범위가 줄어도 이 규칙은 모든 패키지의 export에 적용한다 [제안]. 그래야 패키지를 공개로 바꿀 때 수정이 없다.

### TY-21 시간, 난수, ID는 주입받는다

이유: 재생, 재개, 테이프 기반 테스트는 같은 입력에서 같은 결과를 요구한다(`eng.testing.guide`). `Date.now()`, `Math.random()`, `crypto.randomUUID()`를 직접 부르면 결과가 실행마다 달라지고 테스트는 시계를 가로채는 전역 대역에 의존한다.

- 시각은 `Clock.now()`(epoch ms 정수), 난수는 `RandomSource`, 지연 실행은 `Scheduler`, ID는 `IdFactory.next(prefix)`로 얻는다(1.2절, DT-06).
- `Clock`, `RandomSource`, `Scheduler`의 실제 구현은 L0 `platform-os`가 제공하고 Cordis 서비스로 주입한다 [제안]. 이 패키지만 전역 시각·난수 API 직접 호출을 허용한다(경로 예외, 4.3절). `IdFactory` 구현(`createIdFactory`)도 `platform-os`에 있고 주입받은 `Clock`·`RandomSource`로 ID를 만든다(1.2절, DT-06, [결정: review.decisions-2 U-03]).
- `performance.now()`도 `platform-os` 밖에서 쓰지 않는다. 경과 시간은 주입된 `Clock.now()` 두 값의 차이로 잰다 [제안].

좋은 예:

```ts
export function startToolCall(
  deps: { readonly clock: Clock; readonly ids: IdFactory },
  toolName: string,
): ToolCallStarted {
  return { effectId: deps.ids.next("efx"), toolName, startedAt: deps.clock.now() };
}
```

나쁜 예:

```ts
// oxlint no-restricted-properties 실패 (Date.now, crypto.randomUUID)
export function startToolCall(toolName: string): ToolCallStarted {
  return { effectId: parseEffectId(`efx_${crypto.randomUUID()}`), toolName, startedAt: Date.now() };
}

// 스캔 xeon/no-ambient-time 실패: 인자 없는 new Date()
const now = new Date();
```

### TY-22 Promise를 버리지 않고, 취소 신호를 전파한다

규칙:

1. 반환된 Promise는 `await`하거나, 반환하거나, `.then`/`.catch` 둘 다 처리한다. 의도적으로 기다리지 않는 작업은 L1 `core-tasks`의 태스크 API로 등록한다 [제안]. `void promise`로 버리지 않는다.
2. I/O나 대기를 포함하는 async 함수는 마지막 매개변수로 `signal: AbortSignal`을 받고, 내부의 모든 하위 호출(`fetch`, 모델 스트림, 하위 프로세스, 다른 서비스 메서드)에 그대로 넘긴다.
3. 취소는 오류 유니온의 `{ kind: "cancelled" }`로 돌려준다(TY-11). `AbortError`를 경계 밖으로 던지지 않는다.
4. `CancelScope`는 F `services`(`@xeon/contracts/services`)의 타입이다(`L0.exec.spec` §3.2). 포크 코드와 그 직접 소비자만 쓴다. 그 밖의 API는 `AbortSignal`을 받는다. 다른 패키지는 `CancelScope`라는 이름의 타입을 새로 만들지 않는다.

이유:

- 버린 Promise의 거부는 `unhandledrejection`으로 프로세스 수준에서만 보이고, 어떤 세션·요청의 실패인지 기록되지 않는다.
- drive 임대 반납, 단계 경계 비활성화, 사용자 중단은 모두 진행 중 작업의 취소를 요구한다(`_research/ext-points.md §5` 안 1 토글 보장). 신호가 한 곳에서 끊기면 그 아래 작업이 계속 돌며 비용과 부작용을 만든다.
- `ignoreVoid` 기본값이 `true`라서 `void`는 린트로 잡히지 않는다(`_research/notes/eng-1.md §2`). 그래서 규칙 1의 `void` 금지는 스캔으로 검사한다.

좋은 예:

```ts
export async function runTool(
  call: ToolIntended,
  tools: ToolRegistry,
  signal: AbortSignal,
): Promise<Result<ToolOutput, ToolCallError>> {
  const tool = resolveTool(tools, call.toolName);
  if (!tool.ok) return tool;
  if (signal.aborted) return err({ kind: "cancelled" });
  return tool.value.execute(call.args, signal);
}

// pi durable 포크 내부 (platform-exec): AbortSignal을 F CancelScope로 감싼다
import type { CancelScope } from "@xeon/contracts/services";
export function exec(command: ExecCommand, signal: AbortSignal): Promise<Result<ExecOutput, ExecError>> {
  const scope: CancelScope = { abortSignal: signal };
  return execInScope(command, scope);
}
```

나쁜 예:

```ts
// oxlint typescript/no-floating-promises 실패
export function onTurnEnd(session: SessionService, id: ThreadId, signal: AbortSignal): void {
  session.open(id, signal);
}

// 스캔 xeon/no-void-promise 실패
void session.open(id, signal);

// 리뷰 TY-22: signal을 받았으나 하위 호출에 넘기지 않음
export async function fetchPage(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url);
  return res.text();
}
```

- `typescript/no-misused-promises`는 Promise를 돌려주는 함수를 `void` 콜백 자리에 넘기는 실수를, `typescript/await-thenable`과 `typescript/require-await`는 의미 없는 `await`·`async`를 막는다(`xeon/.oxlintrc.json`).
- signal 미전파 검사는 자동화 수단이 없다. 리뷰 항목이다 [미결: 스캔 가능성].

### TY-23 단언 대신 좁히기 수단을 쓴다: 타입 가드, `satisfies`, 브랜드 생성 함수, 판별 유니온

단언(TY-06)이 필요해 보이는 자리는 아래 표에서 대체 수단을 고른다.

| 상황 | 쓰는 것 | 쓰지 않는 것 |
|---|---|---|
| 경계에서 받은 값 | `parse(Schema, value)` (TY-10, DT-05) | `value as T`, `JSON.parse(x) as T` |
| 이미 타입이 있는 값의 한 변형 고르기 | 판별자 비교(`if (x.type === "text")`), `switch` + `assertNever` (TY-13, TY-14) | `x as TextPart` |
| `unknown` 오류 값에서 필드 하나 읽기 | 작은 타입 가드(`isErrnoException`) | `(error as NodeJS.ErrnoException).code` |
| 객체 리터럴이 타입에 맞는지 확인하면서 리터럴 타입 유지 | `satisfies` | `{ ... } as T` |
| 빈 컨테이너 초기화 | 변수 타입 주석(`const out: Item[] = []`, `new Map<K, V>()`) | `[] as Item[]`, `{} as Record<K, V>` |
| 새 브랜드 값 | `IdFactory.next(prefix)`, `parse(XxxIdSchema, s)` (TY-09) | `` `thr_${x}` as ThreadId `` |
| 이종 레지스트리 조회 | TY-06 허용 목록 A3 조회 함수 | 호출 지점마다 `as Api` |
| 객체 키 순회 | 키 목록을 `as const` 튜플로 두고 순회, 또는 `Object.entries` 결과를 타입 가드로 거른다 | `Object.keys(o) as (keyof T)[]` |

타입 가드 규칙:

- 사용자 정의 타입 술어(`(v: unknown): v is T`)는 `T`의 판별자와 그 함수가 읽는 필드를 실제로 검사한다. 검사하지 않는 필드가 있으면 술어 타입을 그 필드만 가진 좁은 타입으로 둔다(`v is { readonly code: string }`).
- 경계 값 전체 모양을 확인하는 타입 가드를 손으로 쓰지 않는다. 그 자리는 스키마와 `parse`다(DT-02, DT-05).
- `asserts v is T` 함수는 실패 시 `Bug`를 던지는 불변 조건 확인에만 쓴다. 예상 가능한 실패에는 쓰지 않는다(TY-24).

제네릭 규칙:

- 타입 매개변수가 반환 타입에만 나오는 함수(`function load<T>(key: string): T`)는 쓰지 않는다. 호출자가 고른 타입을 검증 없이 돌려주는 숨은 단언이다. 스키마나 타입 키(`ServiceKey<T>`)를 인자로 받아 타입이 인자에서 오게 한다. `typescript/no-unnecessary-type-parameters`가 일부를 잡는다.
- `Function`, `Object`, `{}` 타입은 쓰지 않는다. 호출 모양을 적은 함수 타입, `Record<string, unknown>`, `unknown`을 쓴다.

이유: 단언·`any`·`!`는 컴파일러가 아는 사실을 지우고 쓴 사람의 믿음으로 바꾼다. 타입 가드와 판별자 비교는 런타임 검사와 타입 좁히기가 같은 코드라 둘이 어긋나지 않는다. `satisfies`는 값의 리터럴 타입을 지키면서 모양만 확인한다.

좋은 예:

```ts
// 작은 타입 가드: 읽는 필드만 검사하고, 술어 타입도 그 필드만 가진다
export function hasErrnoCode(value: unknown): value is { readonly code: string } {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "string";
}

// satisfies: 키 누락은 컴파일 오류, 값의 리터럴 타입은 유지
const RETRY_LIMITS = { model: 3, tool: 1 } satisfies Record<RetryTarget, number>;

// 빈 컨테이너는 주석으로 타입을 준다
const pending: Map<ToolCallId, PendingCall> = new Map();

// 타입 키: T가 인자에서 온다
export function getService<T>(key: ServiceKey<T>): Result<T, ServiceLookupError>;
```

나쁜 예:

```ts
// oxlint typescript/consistent-type-assertions 실패
const code = (error as NodeJS.ErrnoException).code;
const limits = { model: 3 } as Record<RetryTarget, number>; // tool 키 누락이 숨는다

// oxlint typescript/no-unnecessary-type-parameters 실패: T가 반환에만 나온다
export function readState<T>(raw: string): T {
  const json: unknown = JSON.parse(raw);
  return json; // 리뷰 TY-23: 이 줄을 통과시키려면 단언이 필요하다
}

// 리뷰 TY-23: 타입 가드가 판별자만 보고 전체 모양을 약속한다
export function isToolCall(v: unknown): v is ToolCall {
  return typeof v === "object" && v !== null && "type" in v && v.type === "toolCall";
}
```

### TY-24 `Bug`는 불변 조건 위반에만 쓴다. 예상 가능한 실패를 `Bug`로 던지지 않는다

판정 질문: "코드와 설정이 모두 올바라도 이 실패가 일어날 수 있는가?" 그렇다면 예상 가능한 실패이고, `kind`가 있는 오류 값으로 돌려준다(TY-11, TY-12). 일어날 수 없으면 버그이고 `throw new Bug(...)`를 쓴다.

예상 가능한 실패 목록(이 `kind` 이름은 [제안]이다. 실제 이름은 각 F 오류 유니온이 정한다):

| 범주 | 예 (`kind`) | Bug가 아닌 이유 |
|---|---|---|
| I/O | `io`, `not_found`, `permission_denied` | 파일·네트워크·프로세스는 코드 밖 상태다 |
| 자원 | `busy`(SQLITE_BUSY, 잠금 경합), `disk_full`, `read_only` | 다른 프로세스와 디스크 상태에 달렸다 |
| 시간과 취소 | `timeout`, `cancelled` | 사용자 동작과 외부 지연에 달렸다 |
| 입력 | `parse`(검증 실패), `invalid_args`, `schema_too_new` | 외부·과거 버전·확장이 만든 값이다 |
| 소유 | `ownership_lost`(lease·잠금 상실), `duplicate`(멱등 재제출) | 경합과 재시작에서 정상적으로 생긴다 |
| 저장 데이터 | `corrupt`, `row_invalid` | 손상·수동 편집·이전 버전이 만든다 |
| 외부 서비스 | `provider_error`, `rate_limited`, `unavailable` | 모델 provider, MCP 서버, 웹은 코드 밖이다 |

`Bug`인 경우: 도달 불가 분기(`assertNever`), 같은 모듈이 세운 상태 기계 위반(닫힌 저장소에 쓰기, 쓰기 트랜잭션 중첩, 동기 콜백 자리에 async 함수), 등록 시점 계약 위반(F에 없는 이벤트 kind를 생산자가 씀), 자기 코드가 만든 값의 불변 조건 위반(직렬화 대상에 `NaN`).

규칙:

- `Bug` 메시지에 오류 종류를 문자열로 넣어 `kind` 대신 쓰지 않는다(`new Bug("store.io: ...")`). 호출자는 메시지 문자열로 분기할 수 없다.
- 외부 라이브러리·OS가 던진 오류를 `Bug`로 감싸지 않는다. 경계 어댑터의 `catch`에서 오류 값으로 바꾼다(TY-25).
- 하위 함수가 `Result`로 돌려준 실패를 상위 함수가 `Bug`로 바꾸지 않는다. 처리할 수 없으면 자기 오류 유니온에 변형을 더해 위로 돌려준다.
- 테스트는 예상 가능한 실패를 `expect(...).toThrow()`로 확인하지 않는다. 돌려받은 `Result`의 `error.kind`를 확인한다. `toThrow(Bug)`는 버그 경로 테스트에만 쓴다.

이유: `Bug`는 "코드를 고쳐야 사라지는 상태"라는 신호다. 예상 가능한 실패를 `Bug`로 던지면 호출자는 재시도·세션 정지·사용자 안내를 고를 수 없고, 확장 지점 fold는 실패를 거부로 환산하며, 로그와 경보가 실제 버그와 운영 실패를 구분하지 못한다. 디스크 가득 참 하나로 런타임 전체가 버그 경로를 탄다(`eng.anti-patterns.guide` AP-S-06).

좋은 예:

```ts
export type AppendError =
  | { readonly kind: "io"; readonly code: string; readonly cause: unknown }
  | { readonly kind: "disk_full" }
  | { readonly kind: "busy"; readonly retryAfterMs: number }
  | { readonly kind: "ownership_lost"; readonly threadId: ThreadId };

export function append(store: SessionStore, draft: EventDraft): Result<EventId, AppendError> {
  const written = store.write(draft);       // L0가 Result로 돌려준다
  if (!written.ok) return written;          // 그대로 위로. Bug로 바꾸지 않는다
  return ok(written.value.id);
}

// 불변 조건 위반만 Bug
if (state.phase === "closed") throw new Bug("SessionStore.write after close");
```

나쁜 예:

```ts
// 스캔 xeon/bug-for-expected 실패 [제안]: Bug 메시지에 예상 가능한 실패 종류가 있다
if (!written.ok && written.error.kind === "io") throw new Bug(`store.io: ${written.error.code}`);

// 리뷰 TY-24: SQLITE_BUSY는 다른 프로세스 때문에 생긴다
if (code === "SQLITE_BUSY") throw new Bug("store.busy");

// 리뷰 TY-24: 예상 가능한 실패를 toThrow로 확인
expect(() => append(store, draft)).toThrow(Bug);
```

- 스캔 `xeon/bug-for-expected`는 `new Bug(` 첫 문자열 인자에 위 표의 `kind` 단어(`io`, `busy`, `disk_full`, `read_only`, `timeout`, `cancelled`, `not_found`, `corrupt`, `ownership_lost`, `lease_lost`)가 낱말로 있으면 실패시킨다(`timeoutMs` 같은 이름은 낱말이 아니다). 오탐은 4.1절 형식의 예외 주석으로 넘기고 이유를 적는다.

### TY-25 `catch`는 오류를 조용히 삼키지 않는다

`catch` 블록과 `.catch()` 콜백은 아래 셋 중 하나를 한다.

1. 변환: 받은 값을 `cause` 필드에 담아 `kind`가 있는 오류 값으로 돌려준다(`return err({ kind: "io", cause: caught })`).
2. 기록 후 계속: 문서가 "실패해도 계속"을 정한 자리(확장 지점 `tap` fold, 정리 단계 dispose, 최선 노력 캐시)에서만 쓴다. 주입된 `Logger`로 고정 메시지와 구조화 필드(`cause`, 관련 ID)를 남긴다(`eng.best-practices.guide` BP-12). 그 자리의 근거 문서와 절을 주석에 적는다.
3. 다시 던지기: 받은 값을 그대로 던진다(`throw caught`). 감싸야 하면 `new Bug(msg, { cause: caught })`이고, 이 경우는 버그일 때뿐이다(TY-24).

금지:

- 빈 `catch {}`, 바인딩 없는 `catch { return fallback; }`, 받은 값을 `void caught`로 버리기.
- `.catch(() => undefined)`, `.catch(() => {})`, `.catch(noop)`.
- 기본값 반환으로 실패를 성공처럼 바꾸기(`catch { return []; }`). 빈 결과가 정상 값이라면 실패와 구분되는 변형을 돌려준다.
- 함수 본문 전체를 감싸는 광역 `try`. `try`는 실패할 수 있는 호출 하나를 감싼다(`eng.anti-patterns.guide` AP-C-02).
- `console`로 찍고 계속하기(L0·L1, BP-12).

이유: 삼킨 오류는 호출자에게도 로그에도 남지 않는다. 저장소 쓰기 실패를 삼키면 커밋 여부를 모른 채 진행하고, 확장 지점 `first` 핸들러에서 삼키면 fail-closed가 fail-open이 된다(`eng.anti-patterns.guide` AP-C-02).

좋은 예:

```ts
export function readSettingsFile(path: string, fs: FsPort): Result<unknown, SettingsReadError> {
  let text: string;
  try {
    text = fs.readText(path);
  } catch (caught) {
    if (hasErrnoCode(caught) && caught.code === "ENOENT") return err({ kind: "not_found", path });
    return err({ kind: "io", path, cause: caught });
  }
  try {
    const json: unknown = JSON.parse(text);
    return ok(json);
  } catch (caught) {
    return err({ kind: "parse_json", path, cause: caught });
  }
}

// 기록 후 계속: tap fold는 핸들러 실패를 기록하고 계속한다 (ADR-0007 §3.2)
try {
  handler(payload);
} catch (caught) {
  log.warn("ext.tap_failed", { extId, point, cause: caught });
}
```

나쁜 예:

```ts
// oxlint no-empty, preserve-caught-error(requireCatchParameter) 실패
try { fs.unlink(tmp); } catch {}

// oxlint preserve-caught-error 실패: 감싼 오류에 cause가 없다
try { db.exec(sql); } catch (caught) { throw new Bug("exec failed"); }

// 스캔 xeon/catch-swallow 실패: 받은 값을 버리고 기본값 반환
try { return parseTools(raw); } catch (caught) { void caught; return []; }

// 스캔 xeon/catch-swallow 실패
void flush().catch(() => undefined);
```

- `preserve-caught-error`의 `requireCatchParameter: true`는 바인딩 없는 `catch`를 실패시킨다. 바인딩한 값을 쓰지 않으면 `no-unused-vars`(correctness, `caughtErrors` 기본값)가 실패시킨다. 둘이 함께 "받아서 쓴다"를 강제한다(oxlint 1.89 프로브로 확인).
- `void caught`와 빈 화살표 `.catch` 콜백은 위 린트를 통과한다(프로브로 확인). 스캔 `xeon/catch-swallow`가 `void <식별자>`와 `.catch(() => undefined)`, `.catch(() => {})`, `.catch(noop)`를 실패시킨다.
- 도구: 던질 수 있는 호출 하나는 `attempt`/`attemptAsync`(1.2절)로 받아 `ok`를 본다. 호출 쪽에 `try`가 남지 않고 받은 값이 `cause`로 남는다. 기다리지 않는 비동기 호출은 `detach(work, onFailure)`로 두고 `onFailure`가 기록, 알림, 상태 표시를 한다. 정리 단계의 `close`처럼 실패를 버리는 자리는 결과를 받아 버린다고 주석에 쓴다(Logger가 없는 포크 코드는 `[미결]`, 6절).

## 3. 강제 수단

### 3.1 규칙별 강제 수단

oxlint 규칙 이름은 `.oxlintrc.json`의 `rules` 키 표기다. 존재 여부는 oxlint 1.89.0 규칙 목록 871개로 확인했다(`_research/notes/eng-1.md §2`, 같은 조사의 규칙 목록 JSON). "추가"는 `xeon/.oxlintrc.json`에 아직 없는 규칙이고 "적용"은 2026-10-23에 넣은 규칙이다. 스캔은 `scripts/check-ts-rules.ts`이고 `just check-ts-rules`로 부르며 `just verify`에 들어 있다. 구현한 스캔 규칙은 `xeon/as-location`, `xeon/bug-for-expected`, `xeon/catch-swallow`, `xeon/directive-format` 네 가지이고 표의 나머지 스캔 규칙은 [제안]이다.

| 규칙 | tsconfig | oxlint | 스캔 | 리뷰 |
|---|---|---|---|---|
| TY-01 필수 옵션 | 여섯 옵션 | — | `xeon/tsconfig-flags`: 패키지 tsconfig가 여섯 옵션을 `false`로 덮어쓰면 실패 | tsconfig 변경 PR |
| TY-02 any 금지 | `strict`(noImplicitAny) | `typescript/no-explicit-any`, `typescript/no-unsafe-argument`, `typescript/no-unsafe-assignment`, `typescript/no-unsafe-call`, `typescript/no-unsafe-member-access`, `typescript/no-unsafe-return` | — | 외부 any를 받는 즉시 unknown 주석 |
| TY-03 enum 금지 | `erasableSyntaxOnly`(TS1294) | `oxc/no-const-enum`(적용) | `xeon/no-declare-enum`: `declare enum`, `const enum` 선언 검출 | — |
| TY-04 namespace 금지 | `erasableSyntaxOnly`(값 있는 namespace) | `typescript/no-namespace`(적용) | — | — |
| TY-05 default export 금지 | — | `import/no-default-export` | — | — |
| TY-06 as 제한 | — | `typescript/consistent-type-assertions` `{ "assertionStyle": "never" }`(적용), `typescript/no-unnecessary-type-assertion`, `typescript/no-unsafe-type-assertion`(적용) | `xeon/as-location`(구현): `consistent-type-assertions`·`no-unsafe-type-assertion` disable 주석이 TY-06 허용 목록 경로 밖에 있거나 허용 목록 ID가 없으면 실패 | 허용 목록 위치의 단언, 허용 목록 변경 |
| TY-07 `!` 금지 | `strict` | `typescript/no-non-null-assertion`, `typescript/no-non-null-asserted-optional-chain`, `typescript/no-non-null-asserted-nullish-coalescing`(적용) | — | — |
| TY-08 ts 주석 | — | `typescript/ban-ts-comment` 기본 `{ "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false }`(적용), 테스트 overrides `{ "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true, "ts-check": false, "minimumDescriptionLength": 10 }`(적용) | `xeon/directive-format`(구현, 4.1절) | 테스트의 `@ts-expect-error`가 타입 테스트인가 |
| TY-09 브랜드 ID | `strict` | TY-06 규칙 | — | 새 ID 타입이 `Brand`를 쓰는가 |
| TY-10 unknown 경계 | `strict` | TY-02의 `no-unsafe-*` | — | 경계 함수 입력이 `unknown`인가 |
| TY-11 Result와 throw | — | `typescript/only-throw-error`, `no-throw-literal`, `unicorn/throw-new-error` | `xeon/throw-only-bug`: `throw new X(...)`에서 `X`가 `Bug`가 아니면 실패 | 외부 API 계약 throw의 정당성 |
| TY-12 오류 kind | — | — | `xeon/error-discriminant` | 판별자 이름 |
| TY-13 완전성 | `strict` | `typescript/switch-exhaustiveness-check` | — | — |
| TY-14 switch default | `noFallthroughCasesInSwitch` | `default-case`(적용), `typescript/switch-exhaustiveness-check` | `xeon/switch-default-never`: `default` 블록에 `assertNever` 호출이 없으면 실패 | default의 처리 내용 |
| TY-15 불변 | — | `no-param-reassign`, `typescript/prefer-readonly`(추가, 클래스 멤버 한정) | — | 입력 변경 여부 |
| TY-16 함수와 객체 | `erasableSyntaxOnly`(매개변수 프로퍼티) | `typescript/no-extraneous-class`, `unicorn/no-static-only-class`(추가) | `xeon/no-class`: `extends Error` 밖의 `class` 선언 검출 | — |
| TY-17 선택 프로퍼티 | `exactOptionalPropertyTypes` | — | — | — |
| TY-18 인덱스 접근 | `noUncheckedIndexedAccess` | TY-07 규칙 | — | — |
| TY-19 import type | `verbatimModuleSyntax` | `typescript/consistent-type-imports`, `typescript/no-import-type-side-effects` | — | — |
| TY-20 명시 반환 타입 | `isolatedDeclarations` | `typescript/explicit-module-boundary-types`(추가) | — | — |
| TY-21 시간·난수·ID 주입 | — | `no-restricted-properties`(추가): `Date.now`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `performance.now` | `xeon/no-ambient-time`: 인자 없는 `new Date()` | — |
| TY-22 Promise | — | `typescript/no-floating-promises`, `typescript/no-misused-promises`, `typescript/await-thenable`, `typescript/require-await` | `xeon/no-void-promise`: `void <호출식>` 검출 | signal 전파 |
| TY-23 좁히기 수단 | `strict` | TY-06 규칙, `typescript/no-unnecessary-type-parameters`(적용), `typescript/no-unsafe-function-type`(적용), `typescript/no-wrapper-object-types`(correctness 범주로 켜져 있음) | — | 타입 가드가 술어 타입의 필드를 실제로 검사하는가 |
| TY-24 Bug 범위 | — | — | `xeon/bug-for-expected`(구현): `new Bug(` 메시지에 예상 가능한 실패 단어 | 이 Bug는 코드와 설정이 올바라도 생길 수 있는가 |
| TY-25 catch 처리 | — | `no-empty` `{ "allowEmptyCatch": false }`(적용), `preserve-caught-error` `{ "requireCatchParameter": true }`(적용), `no-useless-catch`(correctness 범주로 켜져 있음), `no-unused-vars`(correctness), `typescript/use-unknown-in-catch-callback-variable`(적용) | `xeon/catch-swallow`(구현): `void <식별자>`, `.catch(() => undefined)`, `.catch(() => {})`, `.catch(noop)` | 기록 후 계속하는 catch에 근거 문서가 있는가 |

`.oxlintrc.json`에 넣을 항목. 아래 항목 가운데 `typescript/explicit-module-boundary-types`, `typescript/prefer-readonly`, `unicorn/no-static-only-class`, `no-restricted-properties`(TY-21)는 아직 넣지 않았다(코드 정리가 먼저다, 6절). 나머지는 2026-10-23에 `xeon/.oxlintrc.json`에 넣었고 위반은 모두 고쳤다. 설정 파일은 `eng.toolchain.guide`가 소유한다.

```jsonc
{
  "rules": {
    "typescript/no-namespace": "error",
    "oxc/no-const-enum": "error",
    "default-case": "error",
    "typescript/consistent-type-assertions": ["error", { "assertionStyle": "never" }],
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-non-null-asserted-nullish-coalescing": "error",
    "typescript/no-unnecessary-type-parameters": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "typescript/ban-ts-comment": [
      "error",
      { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false }
    ],
    "no-empty": ["error", { "allowEmptyCatch": false }],
    "preserve-caught-error": ["error", { "requireCatchParameter": true }],
    "typescript/explicit-module-boundary-types": "error",
    "typescript/prefer-readonly": "error",
    "unicorn/no-static-only-class": "error",
    "no-restricted-properties": [
      "error",
      { "object": "Date", "property": "now", "message": "Inject Clock (eng.typescript.guide TY-21)." },
      { "object": "Math", "property": "random", "message": "Inject RandomSource (TY-21)." },
      { "object": "crypto", "property": "randomUUID", "message": "Use IdFactory (TY-21)." },
      { "object": "crypto", "property": "getRandomValues", "message": "Inject RandomSource (TY-21)." },
      { "object": "performance", "property": "now", "message": "Inject Clock (TY-21)." }
    ]
  },
  "overrides": [
    { "files": ["packages/platform-os/**"], "rules": { "no-restricted-properties": "off" } },
    {
      // 기존 테스트 override 항목에 더한다. 테스트에서는 타입 테스트용 @ts-expect-error만 설명과 함께 허용한다 (TY-08)
      "files": ["**/test/**", "**/*.test.ts", "scripts/**/*.test.ts"],
      "rules": {
        "typescript/ban-ts-comment": [
          "error",
          { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true, "ts-check": false, "minimumDescriptionLength": 10 }
        ]
      }
    }
  ]
}
```

- `typescript/consistent-type-assertions`는 테스트 overrides에서 끄지 않는다. 테스트 픽스처도 `satisfies`, 타입 주석, `parse`, A2 테스트 대역으로 만든다.
- `typescript/ban-ts-comment`는 현재 `xeon/.oxlintrc.json` 기본 설정에 `"ts-expect-error": "allow-with-description"`으로 있다. 위 항목은 기본 설정을 바꾸고 테스트 경로에 완화를 옮긴다.

#### 3.1.1 TY-02·06·07·08·23·24·25 lint 규칙 목록 (구현 대상)

typed programming 안티패턴을 막는 규칙 전체다. `xeon/.oxlintrc.json`에 이 목록이 모두 있어야 한다. 규칙 존재와 범주는 oxlint 1.89.0 `--rules` 목록으로 확인했다. "TA"는 type-aware(oxlint-tsgolint) 규칙이다.

| 규칙 | 설정 | 상태 | 막는 것 |
|---|---|---|---|
| `typescript/consistent-type-assertions` | `["error", { "assertionStyle": "never" }]` | 적용 | `as T`, `as unknown as T`, `<T>x`. `as const`는 통과(프로브 확인) |
| `typescript/no-unsafe-type-assertion` (TA) | `"error"` | 적용 | 허용 목록 안 단언 중 넓은 타입을 좁히는 단언 표시 |
| `typescript/no-unnecessary-type-assertion` (TA) | `"error"` | 있음 | 필요 없는 단언 |
| `typescript/no-explicit-any` | `"error"` | 있음 | `any` |
| `typescript/no-unsafe-argument`, `-assignment`, `-call`, `-member-access`, `-return` (TA) | `"error"` | 있음 | 외부 `any` 전파 |
| `typescript/no-unsafe-function-type` | `"error"` | 적용 | `Function` 타입 |
| `typescript/no-wrapper-object-types` | correctness 범주 | 있음 | `Object`, `String` 같은 래퍼 타입 |
| `typescript/no-non-null-assertion` | `"error"` | 있음 | `x!` |
| `typescript/no-non-null-asserted-optional-chain` | `"error"` | 있음 | `a?.b!` |
| `typescript/no-non-null-asserted-nullish-coalescing` | `"error"` | 적용 | `x! ?? y` |
| `typescript/ban-ts-comment` | 기본: `{ "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false }`. 테스트 overrides: `{ "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true, "ts-check": false, "minimumDescriptionLength": 10 }` | 적용 | 운영 코드의 모든 ts 억제, 테스트의 설명 없는 억제 |
| `typescript/no-unnecessary-type-parameters` (TA) | `"error"` | 적용 | 반환에만 나오는 타입 매개변수(숨은 단언) |
| `typescript/only-throw-error` (TA), `no-throw-literal`, `unicorn/throw-new-error` | `"error"` | 있음 | 문자열·객체 throw |
| `typescript/use-unknown-in-catch-callback-variable` (TA) | `"error"` | 적용 | `.catch((e: any) => ...)` |
| `no-empty` | `["error", { "allowEmptyCatch": false }]` | 적용 | 빈 `catch {}` |
| `preserve-caught-error` | `["error", { "requireCatchParameter": true }]` | 적용 | 바인딩 없는 `catch`, `cause` 없이 감싼 throw |
| `no-useless-catch` | correctness 범주 | 있음 | 받아서 그대로 던지기만 하는 `try` |
| `no-unused-vars` | correctness 범주 | 있음 | 받고 쓰지 않은 `catch (caught)` |
| `typescript/switch-exhaustiveness-check` (TA) | `"error"` | 있음 | 판별 유니온 누락 |

- 규칙을 더한 뒤 위반이 나오면 규칙을 끄지 않고 코드를 고친다. 위반 위치가 TY-06 허용 목록에 해당하면 4.1절 주석을 단다.
- `preserve-caught-error`, `no-empty`, `consistent-type-assertions`, `no-non-null-asserted-nullish-coalescing`, `ban-ts-comment`의 동작은 oxlint 1.89.0 프로브로 확인했다. oxlint-tsgolint 7.0.2004에서 `no-unsafe-type-assertion`, `no-unnecessary-type-parameters`, `use-unknown-in-catch-callback-variable`, `no-unsafe-*`, `no-unnecessary-type-assertion`이 실제로 검출함을 이 저장소의 위반 수정으로 확인했다(2026-10-23, 6절).

- 같은 규칙에 경로별 `overrides`를 더하면 override 목록이 기본 목록을 대체한다고 보고 쓴다(`eng.dependency-rules.guide` 3.2절 [가정]). 그래서 `no-restricted-properties`를 다시 설정하는 override(예: `eng.domain-types.guide` 3.1절의 contracts 항목)는 위 TY-21 다섯 항목을 같은 목록에 함께 적는다.
- `no-restricted-properties`의 옵션 형식은 ESLint 규칙과 같은 `{ object, property, message }` 배열로 가정한다 [미확인: 규칙 존재만 확인. 옵션 스키마는 프로브하지 않음].
- `consistent-type-assertions`의 `assertionStyle: "never"`는 `as const`를 허용한다(oxlint 1.89.0 프로브로 확인).
- `default-case`는 TS 완전성과 별개로 `default` 존재만 검사한다. `default`가 `assertNever`를 부르는지는 스캔 `xeon/switch-default-never`가 검사한다.

### 3.2 스캔 스크립트

`scripts/check-ts-rules.ts`가 있다(2026-10-23). 시험은 `scripts/check-ts-rules.test.ts`다.

- 실행: `just check-ts-rules`(= `bun scripts/check-ts-rules.ts [--exceptions] [루트]`). `just verify`에 포함한다. `--exceptions`는 예외 주석 전체를 표로 찍는다. 실행할 때마다 예외 개수를 종류와 규칙별로 한 줄씩 찍는다.
- 구현한 규칙: `xeon/as-location`(허용 행마다 허용 파일을 코드에 적었다), `xeon/bug-for-expected`(시험 파일 제외), `xeon/catch-swallow`, `xeon/directive-format`(블록 disable, 이유와 `(<이슈 또는 문서 id>)`가 없는 disable, `ts-ignore`, `ts-nocheck`, 운영 코드의 `ts-expect-error`). 스캔 자신의 파일(`check-ts-rules*.ts`)은 대상에서 뺀다. 규칙 이름과 정규식을 파일에 적기 때문이다.
- 대상: `packages/**`, `apps/**`, `plugins/**`, `scripts/**`의 `.ts`, `.tsx`. `vendor/**`, `dist/**`, `node_modules/**` 제외.
- 파서: TS 7.0에는 안정 programmatic API가 없다(`_research/stack-status.md §2`). 줄 단위 정규식 검출로 시작했고 `new Bug(` 인자만 괄호 짝을 센다. 오탐이 문제가 되면 별도 파서로 바꾼다 [미결].
- 별도 파일로 둔다. 층 검사(`check-layers.ts`)와 구문 검사는 실패 원인이 다르다.
- 규칙 이름은 `xeon/<이름>` 형식이다. 3.1절 표의 스캔 열이 전체 목록이다.
- 종료 코드: 위반 1건 이상이면 1. 설정 파일을 읽지 못하면 2(`~/.claude/CLAUDE.md`의 종료 코드 규약).

### 3.3 리뷰 항목

PR 리뷰에서 확인한다. 자동 검사가 없는 항목만 적는다.

- [ ] 경계 함수(파일·DB·와이어·모델·확장 입력)의 입력 타입이 `unknown`이고 `parse`로 검증하는가 (TY-10)
- [ ] 새 `throw`가 버그인가. 예상 가능한 실패(I/O, busy, disk_full, read_only, cancelled, not_found, 검증 실패, 소유권 상실, timeout)는 `kind`가 있는 `Result`인가 (TY-11, TY-24)
- [ ] 새 `Bug`가 "코드와 설정이 올바라도 생길 수 있는가" 질문에 "아니다"인가 (TY-24)
- [ ] 새 `catch`가 변환, 근거 있는 기록 후 계속, 다시 던지기 중 하나인가 (TY-25)
- [ ] 새 타입 가드가 술어 타입의 필드를 실제로 검사하는가. 경계 값 전체를 손 가드로 검사하지 않는가 (TY-23)
- [ ] 새 disable 주석이 TY-06 허용 목록 위치이거나 이슈가 있는 예외인가. 허용 목록 행이 늘었으면 리뷰어가 따로 승인했는가 (TY-06)
- [ ] `switch`의 `default`가 새 변형을 조용히 흡수하지 않는가 (TY-14)
- [ ] 함수가 입력 객체·배열을 제자리에서 바꾸지 않는가 (TY-15)
- [ ] `AbortSignal`을 받은 함수가 모든 하위 I/O 호출에 넘기는가 (TY-22)
- [ ] 새 disable 주석의 이유가 구체적이고 이슈가 열려 있는가 (4절)

## 4. 예외와 승인 절차

### 4.1 줄 단위 예외 형식

예외는 줄 단위 주석으로만 허용한다. 블록 단위(`/* oxlint-disable */ ... /* oxlint-enable */`)와 파일 단위 disable은 쓰지 않는다 [제안].

| 대상 | 형식 |
|---|---|
| oxlint 규칙 | `// oxlint-disable-next-line <규칙> -- <이유> (<이슈 URL>)` |
| 같은 줄 끝 | `<코드> // oxlint-disable-line <규칙> -- <이유> (<이슈 URL>)` |
| tsc 오류 | `// @ts-expect-error -- <이유> (<이슈 URL>)` |
| 스캔 규칙 | `// xeon-disable-next-line xeon/<규칙> -- <이유> (<이슈 URL>)` |

- 이슈 URL 정규식: `https://github\.com/[^/\s]+/[^/\s]+/issues/\d+` [제안].
- 구속 문서가 미리 허용한 위치·경우의 예외(TY-06 허용 목록 A1~A3, TY-14 열린 외부 값, 각 guide가 허용한 항목)는 이슈 URL 대신 `(<문서 id> <규칙 ID>)`를 쓴다. 예: `(eng.typescript.guide TY-06)`, `(eng.anti-patterns.guide AP-C-05)`.
- 이 형식이 저장소의 유일한 disable 주석 형식이다. `eng.toolchain.guide` TC-07, `eng.anti-patterns.guide` 4.1절, `eng.best-practices.guide` 4절, `eng.readme` 4·5절은 이 절을 따른다.
- `-- <이유>` 표기는 oxlint 1.89에서 억제가 적용되고 오류가 나지 않음을 프로브로 확인했다. 공식 문서 근거는 없다(`_research/notes/eng-1.md §4` [미확인]). 그래서 형식 검사는 oxlint에 맡기지 않고 스캔 `xeon/directive-format`이 한다.
- 쓰이지 않은 oxlint disable 주석은 `options.reportUnusedDisableDirectives: "error"`가 실패시킨다(`xeon/.oxlintrc.json` `options`). `@ts-expect-error`는 오류가 없으면 TS2578로 실패한다. 스캔 disable 주석은 스캔이 해당 줄에서 위반을 찾지 못하면 실패시킨다 [제안].

좋은 예:

```ts
// oxlint-disable-next-line typescript/no-floating-promises -- Cordis dispose 콜백은 동기 반환만 받음 (https://github.com/<owner>/<repo>/issues/31)
ctx.on("dispose", () => { flushLater(); });
```

나쁜 예:

```ts
// 스캔 xeon/directive-format 실패: 이유와 링크 없음
// oxlint-disable-next-line typescript/no-floating-promises
flushLater();

// 스캔 xeon/directive-format 실패: 블록 disable
/* oxlint-disable typescript/no-explicit-any */
```

### 4.2 예외 목록 집계

[제안]

- `bun scripts/check-ts-rules.ts --exceptions`는 모든 예외 주석을 표로 출력한다. 열: 파일, 줄, 종류(oxlint, ts, 스캔), 규칙, 이유, 이슈 URL.
- `just verify`는 예외 개수를 규칙별로 한 줄씩 출력한다. 개수 자체로는 실패하지 않는다.
- CI(`.github/workflows/xeon-ci.yml`)는 기준 브랜치와 PR의 예외 표를 비교해 늘어난 행을 PR 요약에 적는다.
- 늘어난 예외는 리뷰어 한 명의 명시 승인이 필요하다. 이슈가 닫히면 해당 주석을 지우는 것이 이슈 완료 조건이다.
- 집계 결과는 커밋하지 않는다. 매번 소스에서 다시 계산한다.

### 4.3 경로 단위 예외

경로 단위 완화는 아래 표에 있는 것만 허용한다. 표에 없는 `overrides`를 `.oxlintrc.json`에 더하려면 이 표를 먼저 고친다.

| 경로 | 완화 규칙 | 이유 | 출처 |
|---|---|---|---|
| `packages/ext-host/**` | `no-restricted-imports` | Cordis import를 허용하는 유일한 패키지 | `xeon/.oxlintrc.json` overrides, `foundation-plan.md §2` DI 행 |
| `scripts/**`, `apps/cli/**`, `apps/host/**` | `no-console` | 진입점의 표준 출력 | `xeon/.oxlintrc.json` overrides |
| `**/test/**`, `**/*.test.ts` | `typescript/no-non-null-assertion`, `typescript/no-unsafe-assignment`, `typescript/no-unsafe-member-access`, `typescript/require-await`, `no-shadow` | 테스트 단언과 픽스처 작성 | `xeon/.oxlintrc.json` overrides |
| `**/test/**`, `**/*.test.ts` | `typescript/ban-ts-comment`를 `"ts-expect-error": "allow-with-description"`, `minimumDescriptionLength: 10`으로 완화 | 컴파일 오류를 확인하는 타입 테스트 | TY-08 |
| `packages/platform-os/**` | `no-restricted-properties` | `Clock`, `RandomSource`, `Scheduler`의 실제 구현 | TY-21 [제안] |
| `**/test/**`, `**/*.test.ts`, `packages/*/src/testing/**` | 스캔 `xeon/throw-only-bug`, `xeon/no-class`: `Bug`를 상속한 테스트 인프라 오류 클래스(`TapeMismatchError`, `TapeLeftoverError`)의 선언과 throw만 | 테스트 가짜가 계약 위반을 그 자리에서 실패로 알린다 | `eng.testing.guide` TS-04 [제안] |

- 테스트의 `!` 허용은 현재 설정을 그대로 기록한 것이다. 테스트에서도 TY-07을 지킬지는 [미결]이다.

## 5. 수용 기준

- 2절의 나쁜 예 각각을 `xeon/scripts/fixtures/ts-rules/bad/TY-NN-<이름>.ts`로 두고, 같은 규칙의 좋은 예를 `good/`에 둔다 [제안]. 픽스처 디렉터리는 일반 `tsc -b`와 lint 대상에서 제외하고 테스트에서만 검사한다. 지금은 oxlint 프로브(2026-10-23)와 `scripts/check-ts-rules.test.ts`의 문자열 시험이 이 자리를 맡는다. 픽스처 파일은 아직 없다 [미결].
- `scripts/check-ts-rules.test.ts`가 스캔 네 규칙의 통과와 실패, 예외 주석 면제, 예외 개수 요약을 시험한다. 이 테스트는 `just test`(`bun test scripts`)에 포함되므로 `just verify`가 실패를 보고한다.
- 자동 검사 수단이 "리뷰"뿐인 나쁜 예는 이 기준에서 빠진다. 해당 규칙: TY-14 두 번째 나쁜 예(조건부, tsgolint 확인 전), TY-15 첫 번째 나쁜 예, TY-22 세 번째 나쁜 예, TY-23 세 번째 나쁜 예(손 타입 가드). 이 목록이 줄어드는 방향으로 스캔을 늘린다. TY-24 나쁜 예는 `xeon/bug-for-expected`가 맡는다.
- 4.1절 형식에 맞지 않는 disable 주석이 하나라도 있으면 `just verify`가 실패한다(`xeon/directive-format`).
- `bun scripts/check-ts-rules.ts --exceptions`가 저장소의 모든 예외 주석을 출력한다.
- 3.1.1절 목록의 규칙이 `xeon/.oxlintrc.json`에 모두 있고, `consistent-type-assertions` disable 주석이 TY-06 허용 목록 경로 밖에 하나도 없다(`xeon/as-location`). 둘 다 2026-10-23에 충족한다.
- 운영 코드(`src/**`)에 `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`가 없다(`xeon/directive-format`).

## 6. 미결 사항

- [해결 2026-10-23] oxlint-tsgolint 7.0.2004의 type-aware 규칙 검출: `no-unsafe-type-assertion`, `no-unnecessary-type-parameters`, `use-unknown-in-catch-callback-variable`, `no-unsafe-*`, `no-unnecessary-type-assertion`, `no-unnecessary-condition`이 검출한다. `prefer-readonly`, `explicit-module-boundary-types`는 아직 켜지 않아 확인하지 않았다.
- [미결] `typescript/explicit-module-boundary-types`, `typescript/prefer-readonly`, `unicorn/no-static-only-class`와 TY-21의 `no-restricted-properties`를 `.oxlintrc.json`에 넣는 일. 위반 수를 먼저 세고(`review.open-issues` V-02가 `Date.now`, `setTimeout` 직접 사용을 이미 짚었다) 고친 뒤 켠다.
- [미결] `no-restricted-properties` 옵션 형식. `consistent-type-assertions` `assertionStyle: "never"`의 `as const` 허용은 프로브로 확인했다.
- [해결 2026-10-23] TY-06 허용 목록 A3 채택: `packages/ext-host/src/erase.ts` 한 파일로 정했다. 래퍼가 함수형 등록 API만 쓰므로 키와 클로저로 다시 짜지 않는다.
- [해결 2026-10-23] TY-24 적용 전 코드의 `Bug` 정리: `core-persistence/src/writer.ts`의 `store.io`는 `StoreError{io}`, `platform-store/src/db.ts`의 `store.corrupt`는 `StoreWriteError{io, code: SQLITE_CORRUPT*}`로 돌려준다. 같은 방식으로 `DirsError{cancelled}`, `ExtensionTableError{io}`, `EnqueueError`(입력 큐), `ModeChangeResult{tools.commit_failed}`, `SecretError{cancelled}`, wire `store.busy`·`store.diskFull`·`store.readOnly`·`store.io`로 옮겼다.
- [미결] TY-24 남은 곳. (1) 읽기 API가 값을 바로 돌려주는 자리: `core-persistence`의 `store.read_failed`(read.ts, subscribe.ts), `store.row_invalid`(views.ts, rows.ts, requests.ts 외), `platform-store`의 `store.row_invalid`. 읽기 연결의 `busy`와 손상 행이 `Bug`로 올라간다. 읽기 API를 `Result`로 바꾸는 설계가 필요하다. (2) `ext-host`의 `ext_storage.row_corrupt`(`ExtTableReader`가 행을 바로 돌려준다). (3) 플랫폼 모듈 시작 실패: `platformOsPlugin`의 `platform-os failed to start`와 `core-persistence`의 `could not start`가 `PlatformModule.setup`의 던지는 계약 때문에 `Bug`다. `setup`이 `Result`를 돌려주도록 `X.primitives.spec`의 `registerPlatform`을 고쳐야 한다.
- [미결] TY-25 포크 코드의 정리 단계 `close` 실패(`platform-exec/src/upstream/env/node.ts`의 `closeBestEffort`)와 감시 콜백 예외(`node-watch.ts`의 `#deliver`)는 결과를 받아 버린다. 포크 환경에 Logger를 넣어 기록해야 한다(`PATCHES.md` P14).
- [미결] TY-24 `kind` 이름 표(`io`, `busy`, `disk_full`, `read_only`, `ownership_lost` 등)를 F 공용 오류 변형으로 둘지, 각 오류 유니온이 따로 정할지. 지금은 각 오류 유니온이 따로 둔다.
- [미결] `declare enum`, `const enum`에 대한 `erasableSyntaxOnly` 동작(`_research/notes/eng-1.md §3`). `oxc/no-const-enum`은 적용했다. `declare enum`은 스캔 `xeon/no-declare-enum`으로 보완한다.
- [미결] 스캔 스크립트의 파서 선택(정규식, 별도 파서). `check-layers.ts`와는 합치지 않는다.
- [미결] 타입 수준 항등 검사 `Equal<A, B>`(`packages/contracts/test/types/expect.ts`)는 `no-unnecessary-type-parameters`가 걸려 줄 단위 예외를 쓴다. 이슈 링크 대신 이 절을 근거로 한다.
- [미결] Cordis 서비스 등록에 클래스 상속이 필요한 경우 TY-16 예외 범위. ext-host 래퍼가 함수형 등록 API만 노출하면 예외가 없다(`X.primitives.spec`).
- [미결] 테스트 코드의 `!` 허용 유지 여부(4.3절).
- [미결] signal 미전파(TY-22)와 판별자 이름(TY-12)의 자동 검사 가능성.
- [미결] L4가 오류 `kind`에서 메시지 키를 유도하는 규칙(TY-12). `L4.settings-ui.spec`의 메시지 키 체계와 함께 정한다. 확장 오류(`x.<extId>.<name>`, `grp.<groupId>.<name>`)의 메시지 키를 누가 제공하는지도 같이 정한다.
