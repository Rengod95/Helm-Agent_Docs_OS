---
id: eng.domain-types.guide
layer: eng
domain: domain-types
kind: guide
status: draft
depends_on: [eng.typescript.guide]
binds: [xeon/packages/contracts/**]
---

# 도메인 타입과 스키마 규칙

F 계약 패키지(`xeon/packages/contracts`)의 스키마, 와이어 DTO, 도메인 타입, 버전, 확장 가능한 유니온을 정한다. 언어 차원 규칙(브랜드, `Result`, 판별 유니온 처리, unknown 경계, 금지 구문)은 짝 문서 `eng.typescript.guide`가 소유하고, 이 문서는 그 규칙을 스키마에 적용하는 방법을 정한다.

## 1. 적용 범위

- 대상 코드: `xeon/packages/contracts/**`. 다른 층에서 TypeBox 스키마를 정의하거나 와이어·저장 형식을 변환하는 코드에도 같은 규칙을 적용한다(F 계약을 소비하는 코드).
- 대상 작업: 스키마 추가·변경, 이벤트 payload 버전 올리기, 확장 유니온 변형 추가, 설정 키 추가, 와이어 DTO 변환 작성.
- 이 문서가 다루지 않는 것:
  - 이벤트 envelope 필드 목록, 이벤트 카탈로그, 투영 규칙: `eng.events.design`. 이 문서는 형식 규칙을 시연할 때 envelope 필드를 인용만 한다.
  - 트랜잭션, 멱등, outbox: `eng.transactions.design`.
  - 각 F 도메인의 구체 타입: `F.conversation.spec`, `F.records.spec`, `F.capabilities.spec`, `F.extensions.spec`, `F.wire-settings.spec`.
- 근거 자료:
  - [결정] 스키마는 TypeBox 1.4, pi-ai와 같은 계열(`_research/foundation-plan.md §2` 스키마 행). 계약 정본은 F `xeon/packages/contracts`이고 서브패스는 conversation, records, capabilities, extensions, wire, settings다(`_research/foundation-plan.md §3`).
  - TypeBox 1.4.2 API, `isolatedDeclarations` 충돌: `_research/notes/eng-2.md`
  - F 구성요소 판정: `_research/packages.md §4.1`(F3 도구 스키마 "그대로", F4 열거형 확장 예약)
  - 단일 원천 스키마와 CI diff 검사 패턴: `_research/ref-synthesis.md` F 계약 절(Hermes)
  - 기존 설계의 envelope·업캐스터·ID 규약: `docs/design/09-event-store.md §3.2, §3.13.3`, `docs/design/08-domain-model.md §3.2, §3.4.1, §3.4.7`(참고용, 커널·데몬 전제는 따르지 않는다)
  - 기준 버전: `typebox` 1.4.2(`xeon/package.json` catalog)

### 1.1 용어

| 용어 | 뜻 |
|---|---|
| 스키마 | TypeBox로 만든 JSON Schema 값. 런타임 검증과 정적 타입의 원천 |
| 도메인 타입 | `Static<typeof XSchema>`로 얻은 타입. 층 안쪽 코드가 쓰는 타입 |
| 와이어 DTO | 프로세스 밖으로 나가는 형식(L4 클라이언트 프로토콜, 엔진 사이드카 JSON-RPC). F `wire` 서브패스가 정의 |
| 저장 형식 | SQLite 행과 그 안의 JSON 열. 이벤트 envelope과 payload |
| 닫힌 유니온 | 변형 목록이 F에서 끝나는 유니온 |
| 열린 유니온 | 확장이 `x.`·`grp.` 접두 변형을 더할 수 있는 유니온(DT-08) |
| 업캐스터 | 저장된 옛 버전 payload를 다음 버전 형식으로 바꾸는 순수 함수 |

### 1.2 이 문서가 정하는 공용 이름

`eng.typescript.guide` 1.2절의 `Brand`, `Result`, `ok`, `err`, `Bug`, `assertNever`, `Clock`, `RandomSource`, `Scheduler`와 함께 `@xeon/contracts` 루트 진입점에 둔다 [제안].

| 이름 | 종류 | 정의 |
|---|---|---|
| `parse` | 함수 | DT-05 |
| `ParseError`, `ParseIssue` | 타입 | DT-05 |
| `OpenVariantType`, `isOpenVariant`, `OPEN_VARIANT_PATTERN` | 타입·함수·상수 | DT-08 |
| `Nullable` | 스키마 생성 함수 | DT-16 |
| `EpochMsSchema` | 스키마 | DT-14 |
| `Upcaster` | 타입 | DT-11 |
| `canonicalJson` | 함수 | DT-14 |
| 스키마 상수 이름 `<Name>Schema`, 타입 이름 `<Name>` | 명명 규약 | DT-02 |

- 브랜드 ID(`ThreadId`, `TurnId`, `StepId`, `ItemId`, `PartId`, `EventId`, `EffectId`, `CheckpointId`), 그 스키마, `IdPrefix`, `IdByPrefix`, `ULID_PATTERN`, `idPattern`, `isId`, `IdFactory`는 `F.conversation.spec` §3.2가 정의하고 서브패스 `@xeon/contracts/conversation`에 둔다(DT-06). 루트 진입점에는 두지 않는다(`F.readme` §3).
- 이 문서의 이전 판에 있던 `SessionId`·`TaskId`·`MessageId`·`InputId`·`ApprovalId`·`RequestId`·`ToolCallId`·`ScopeId` 브랜드, `ID_PREFIXES`, `REQUEST_ID_PATTERN`, `deriveRequestId`는 두지 않는다. `createIdFactory`는 F에 두지 않는다(DT-06, [결정(잠정): review.decisions-2 U-03]).

## 2. 규칙

각 규칙은 번호, 내용, 이유, 좋은 예, 나쁜 예를 가진다. 코드는 TypeBox 1.4.2 시그니처(`_research/notes/eng-2.md §3-4, §4~§7`)를 따른다. 컴파일과 실행은 검증하지 않았다 [가정: 조사 2가 내려받은 패키지를 실행하지 않았다]. 첫 구현 작업(M0 `contracts`)에서 이 문서의 예를 타입 테스트로 옮겨 확인한다.

### DT-01 스키마는 TypeBox 1.4(`typebox` 패키지)로 정의한다

[결정] 스키마 라이브러리는 TypeBox 1.4다(`_research/foundation-plan.md §2`).

| import 경로 | 쓰는 것 | 허용 위치 |
|---|---|---|
| `typebox` | `Type`, 타입 `Static`, `TSchema`, `TObject`, `TString`, `TInteger`, `TLiteral`, `TUnion`, `TUnsafe`, `TNull`, `TUnknown`, `TArray`, `TAddOptional` | 모든 패키지 |
| `typebox/compile` | `Compile`(검증기) | `packages/contracts/src/base/**`, pi 포크 [제안] |
| `typebox/value` | `Value.Check`, `Value.Errors` | `packages/contracts/src/base/**`, pi 포크 [제안] |
| `typebox/error` | `TLocalizedValidationError` 타입 | `packages/contracts/src/base/**` [제안] |

이유:

- pi-ai가 도구 매개변수를 TypeBox 스키마로 받는다(`_research/packages.md §4.1` F3 도구 스키마 "그대로"). 같은 라이브러리를 쓰면 F의 도구 스키마를 pi-ai에 변환 없이 넘긴다.
- TypeBox 스키마는 JSON Schema 값이라 런타임 검증, 정적 타입, 모델 도구 정의, 와이어 문서가 한 원천에서 나온다.
- 검증 진입점을 `parse` 하나로 모으려고(DT-05) `typebox/compile`과 `typebox/value`의 직접 import를 contracts base로 제한한다.

좋은 예:

```ts
import { Type, type Static, type TObject, type TString } from "typebox";
```

나쁜 예:

```ts
// oxlint no-restricted-imports 실패 ("Use typebox 1.x (package 'typebox').")
import { Type } from "@sinclair/typebox";

// oxlint no-restricted-imports 실패 (contracts base 밖에서 검증기 직접 사용) [제안 규칙]
import { Value } from "typebox/value";
const valid = Value.Check(ThreadIdSchema, input);
```

- [미결] pi-ai·pi-agent-core가 고정한 TypeBox 1.3.27과 Xeon catalog의 1.4.2가 한 트리에 함께 있을 때 스키마 값 호환(`Compile`이 다른 버전 스키마를 받는지). 1.4.2로 통일하면 pi 포크 코드의 호환을 따로 확인해야 한다(`_research/notes/eng-2.md §11`).

### DT-02 스키마가 단일 진실 원천이다. 타입을 따로 손으로 쓰지 않는다

규칙:

- 데이터 모양은 스키마 상수로 한 번만 정의하고, 정적 타입은 `Static<typeof XSchema>`로 얻는다.
- 명명: 스키마 상수는 `<Name>Schema`, 타입은 `<Name>`이다 [제안]. pi-ai의 `ThinkingLevelSchema`/`ThinkingLevel` 관행과 같다(`~/projects/_ref/pi-src/packages/ai/src/providers/model-schema.ts`).
- 소비 층은 F의 타입 이름을 그대로 import해 쓴다. 같은 모양을 다른 이름으로 다시 선언하거나 별칭을 만들지 않는다 [제안]. 근거는 `_templates/README.md` 문체 규칙("코드 식별자, 타입, 패키지 이름은 문서 사이에서 같은 문자열로 쓴다. 이름은 F 문서가 정한 것을 따른다")이다.
- 손으로 쓴 타입이 허용되는 곳: 브랜드 타입 선언(`Brand<string, "ThreadId">`, DT-06), 스키마로 표현할 수 없는 함수 타입(`Upcaster`), 테스트의 기대 타입(4절 타입 테스트).

이유: 타입과 스키마를 따로 쓰면 한쪽만 고치는 일이 생기고, 그 차이는 런타임 검증을 통과한 값이 타입과 다른 모양이 되는 버그로 나타난다. 원천이 하나면 불일치가 생길 자리가 없다.

좋은 예:

```ts
export const ToolNameSchema: TString = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" });
export type ToolName = Static<typeof ToolNameSchema>;
```

나쁜 예:

```ts
// 리뷰 DT-02, 타입 테스트 실패(스키마와 손으로 쓴 타입이 다름)
export const MemoSavedSchema: TObject<{ title: TString }> = Type.Object({ title: Type.String() });
export interface MemoSaved {
  title: string;
  pinned: boolean; // 스키마에 없는 필드
}
```

### DT-03 export하는 스키마는 명시 타입 주석을 단다 (`isolatedDeclarations` 대응)

[제안] `export const XSchema: <TypeBox 타입> = Type.Xxx(...)` 형태로 쓴다. 팩토리 함수 패턴, `as` 단언 패턴, `satisfies` 패턴은 쓰지 않는다.

이유(`_research/notes/eng-2.md §3`):

- `isolatedDeclarations`에서 `export const X = Type.Object({...})`는 TS9010 오류다. 호출식의 반환 타입은 타입 검사기만 계산할 수 있어 구문만으로 d.ts를 만들 수 없기 때문이다(TS 5.9.3 소스 근거. TS 7.0.2는 메시지 문자열만 확인).
- 명시 주석은 검사기가 주석과 값의 일치를 확인한다. 불일치는 TS2322로 드러난다.
- 팩토리 함수도 명시 반환 타입이 필요하므로(TS9007) 주석 부담이 같고 이득이 없다.
- `as` 단언을 쓰면 TS9010은 사라지지만, 컴파일러가 값과 주석의 느슨한 대응만 검사하므로 불일치가 오류로 드러나지 않는다. TY-06도 금지한다.
- `satisfies`는 `isolatedDeclarations`의 구문 처리 목록에 없어 TS9010이 그대로 난다.

주석 작성 요령:

| 스키마 생성 | 주석 타입 |
|---|---|
| `Type.String(...)` | `TString` |
| `Type.Integer(...)` | `TInteger` |
| `Type.Literal("x")` | `TLiteral<"x">` |
| `Type.Optional(T)` | `TAddOptional<T>` [가정: `TOptional<T>`와의 호환 미확인, eng-2 §3-4] |
| `Type.Union([A, B])` | `TUnion<[A, B]>` |
| `Type.Array(T)` | `TArray<T>` |
| `Type.Object({...})` | `TObject<{ 키: 주석 타입; ... }>` |
| `Type.Unsafe<B>(...)` | `TUnsafe<B>` |
| 다른 export 스키마 재사용 | `typeof OtherSchema` |

- 주석이 길어지면 변형마다 별도 export 상수로 나누고 상위 스키마는 `typeof`로 참조한다(DT-08 좋은 예).
- `TObject`를 인자 없이 쓰지 않는다. `Properties`가 기본값 `TProperties`로 넓어져 정적 타입이 무너진다(eng-2 §5).
- 비공개 스키마라도 공개 타입이 `typeof`로 참조하면 같은 검사를 받는다 [가정: eng-2 §3-1]. 그래서 contracts의 스키마는 모두 export하고 모두 주석한다.

좋은 예:

```ts
import { Type, type Static, type TObject, type TString, type TUnknown } from "typebox";

export const ToolCallDraftSchema: TObject<{ toolName: TString; input: TUnknown }> = Type.Object(
  { toolName: ToolNameSchema, input: Type.Unknown() },
  { additionalProperties: false },
);
export type ToolCallDraft = Static<typeof ToolCallDraftSchema>;
```

나쁜 예:

```ts
// tsc TS9010 실패 (isolatedDeclarations)
export const ToolCallDraftSchema = Type.Object({ toolName: Type.String(), input: Type.Unknown() });

// oxlint typescript/consistent-type-assertions 실패 (TY-06)
export const ToolCallDraftSchema2 = Type.Object({ toolName: Type.String() }) as TObject<{ toolName: TString }>;

// tsc TS9007 실패: 팩토리도 반환 타입 주석 필요
export function toolCallDraftSchema() {
  return Type.Object({ toolName: Type.String() });
}
```

- [미결] `isolatedDeclarations`를 모든 패키지에 둘지, d.ts를 외부 도구로 만드는 공개 패키지에만 둘지(eng-2 §3-5의 제안은 공개 패키지만). 현재 `xeon/tsconfig.base.json`은 전체에 켜 둔다. 이 규칙은 범위와 관계없이 contracts에 적용한다. contracts가 공개 패키지가 될 가능성이 있기 때문이다(`_research/decisions-log.md` 2026-10-19 "나중에 공개 릴리즈 예정").
- [제안] `_research/foundation-plan.md §2`의 "isolatedDeclarations 덕분에 d.ts 생성에 TS API가 필요 없다"는 "isolatedDeclarations를 켜면 TS API 없이 d.ts를 만들 수 있으나, 공개 export마다 명시 타입 주석이 필요하다"로 정정한다(eng-2 §3-5).

### DT-04 와이어 DTO와 도메인 타입을 구분하고, 변환은 경계 층에 둔다

[제안]

- 도메인 타입과 저장 형식은 F `conversation`, `records`, `capabilities`, `extensions`, `settings` 서브패스가 정의한다.
- 와이어 DTO는 F `wire` 서브패스가 정의한다. 클라이언트 프로토콜과 엔진 사이드카 JSON-RPC 메시지가 여기에 속한다.
- 와이어 DTO가 도메인 타입과 같은 모양이면 별도 DTO를 만들지 않고 도메인 스키마를 그대로 참조한다. 모양이 다를 때만 DTO를 만든다. 다른 경우의 예: 민감 필드 제거, 클라이언트용 요약, 버전 협상 필드 추가.
- 변환 함수 위치:

| 경계 | 변환 방향 | 위치 |
|---|---|---|
| SQLite 행 ↔ `DurableEventEnvelope` | 저장 형식 → 도메인 | L0 `platform-store` |
| 와이어 메시지 ↔ 도메인 | DTO ↔ 도메인 | L4 `apps/host`의 전송 계층(in-process, stdio, service) |
| 확장 페이로드 → 도메인 | unknown → 도메인 | X `ext-host` |
| 모델 도구 인자 → 도메인 | unknown → 도메인 | L1 `core-tools` |
| 설정 파일 → 설정 값 | unknown → 도메인 | L1 또는 L4의 설정 로더(`F.wire-settings.spec`이 정한다) |

- 변환 함수 이름: `to<Wire이름>(domain)`, `from<Wire이름>(dto): Result<Domain, ParseError | ...>` [제안]. `from*`은 입력을 `unknown`으로 받는다(DT-05).
- F `wire`는 도메인 서브패스를 import할 수 있고 반대는 금지다(DT-12). 그래서 변환 함수는 F 안에 둘 수 없는 경우(I/O 필요)에 경계 층에 둔다. 순수 변환은 F `wire`에 둘 수 있다.

이유: 와이어 형식은 클라이언트 버전 협상 때문에 도메인보다 느리게 바뀌어야 하고, 도메인은 내부 리팩터링으로 자주 바뀐다. 두 타입을 한 이름으로 묶으면 도메인 변경이 곧 프로토콜 변경이 된다. 변환을 경계 층 한 곳에 두면 버전 차이를 그 한 곳에서 흡수한다.

좋은 예:

```ts
// packages/contracts/src/wire-settings/wire/thread-summary.ts (가상의 예. 실제 와이어 모양은 F.wire-settings.spec)
export const ThreadSummaryDtoSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  title: TString;
  updatedAt: typeof EpochMsSchema;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    title: Type.String({ minLength: 0, maxLength: 200 }),
    updatedAt: EpochMsSchema,
  },
  { additionalProperties: false },
);
export type ThreadSummaryDto = Static<typeof ThreadSummaryDtoSchema>;

export function toThreadSummaryDto(view: ThreadView): ThreadSummaryDto {
  return { threadId: view.threadId, title: view.title, updatedAt: view.updatedAt };
}
```

나쁜 예:

```ts
// 리뷰 DT-04: 도메인 투영 상태(내부 캐시, 민감 필드 포함)를 와이어로 그대로 보냄
transport.send({ type: "thread.summary", body: threadView });

// check-layers 실패: F records가 F wire를 import (DT-12 방향 위반) [제안 규칙]
import { type ThreadSummaryDto } from "../wire-settings/wire/thread-summary.ts";
```

### DT-05 외부 입력, 저장소에서 읽은 JSON, 확장 페이로드는 항상 `unknown`에서 `parse`로 검증한다

[제안] 검증 진입 함수는 하나다.

```ts
// @xeon/contracts (루트 진입점), 구현 위치 packages/contracts/src/base/parse.ts
import { type Static, type TSchema } from "typebox";

export type ParseIssue = {
  readonly path: string;     // JSON Pointer (instancePath)
  readonly keyword: string;  // JSON Schema 키워드 (required, pattern, maxLength, ...)
  readonly message: string;
};

export type ParseError = {
  readonly kind: "parse";
  readonly schemaId: string | undefined; // 스키마의 $id. 없으면 undefined
  readonly issues: readonly ParseIssue[]; // 최대 20개
};

export function parse<S extends TSchema>(schema: S, input: unknown): Result<Static<S>, ParseError>;
```

- 구현은 `typebox/compile`의 `Compile(schema)`로 검증기를 만들어 스키마 객체 단위로 캐시하고(`WeakMap<TSchema, ...>`), `Check`가 실패하면 `Errors`로 이슈를 만든다. pi-ai `utils/validation.ts`의 캐시 방식과 같다.
- `Value.Parse`는 쓰지 않는다. `Value.Parse`는 입력을 복제한 뒤 기본값 채우기, 타입 변환(Convert), 모르는 키 삭제(Clean)를 거쳐 실패 시 `ParseError`를 던진다(eng-2 §6). 저장된 이벤트를 조용히 고치는 동작은 DT-11의 "저장된 데이터는 제자리에서 고치지 않는다"와 충돌하고, throw는 TY-11과 충돌한다.
- `parse`는 입력을 바꾸지 않는다. 기본값이 필요한 곳(설정 병합)은 `parse` 뒤에 명시적인 순수 함수로 채운다.
- 모델 도구 인자처럼 느슨한 변환이 필요한 경계(pi-ai `validateToolArguments`의 `Value.Convert`)는 그 경계 함수 안에서 변환한 사본을 `parse`에 넘긴다.

검증 대상 경계: 파일 읽기, SQLite JSON 열, 와이어 수신, 모델 도구 인자, 확장이 `post`·`on` 반환값·`scope` 상태로 넘기는 값, 환경 변수와 설정 파일, 하위 프로세스 출력의 JSON.

이유: 저장소는 이 프로세스가 쓴 데이터라도 이전 버전 앱, 손상, 수동 편집 때문에 현재 스키마와 다를 수 있다. 확장 페이로드는 신뢰하지 않는 코드의 출력이다. 경계마다 같은 `parse`를 쓰면 실패 형태(`ParseError`)가 하나로 모여 로그·이벤트·화면이 같은 방식으로 다룬다.

좋은 예:

```ts
// L0 platform-store
export function readEnvelope(row: { readonly envelope: string }): Result<DurableEventEnvelope, ParseError | StoreDecodeError> {
  let json: unknown;
  try {
    json = JSON.parse(row.envelope);
  } catch {
    return err({ kind: "store_decode", reason: "invalid_json" });
  }
  return parse(DurableEventEnvelopeSchema, json);
}
```

나쁜 예:

```ts
// oxlint typescript/consistent-type-assertions 실패 (TY-06), 리뷰 DT-05
export function readEnvelope(row: { readonly envelope: string }): DurableEventEnvelope {
  return JSON.parse(row.envelope) as DurableEventEnvelope;
}

// oxlint no-restricted-properties 실패 (contracts 전용 규칙, 4.1절): Value.Parse는 키를 지우고 throw함
const ev = Value.Parse(DurableEventEnvelopeSchema, json);
```

- [가정] `Compile(schema).Check(value)`의 반환 타입이 `value is Static<S>` 타입 가드다. 가드가 아니면 `parse` 구현 안에서만 단언을 쓴다(TY-06 허용 위치 1).
- [미결] 모르는 키의 처리. 닫힌 객체(DT-17)는 모르는 키가 있으면 `parse`가 실패한다. 이벤트 재생에서 모르는 키를 보존하고 통과시킬지, 실패시킬지 정해야 한다(eng-2 §11). 이 문서의 현재 규칙은 "실패"이고, DT-10 규칙 6에 따라 높은 버전 데이터는 열기 전에 거부되므로 정상 운영에서는 생기지 않는다.

### DT-06 브랜드 ID는 F 접두 규약을 따르고, 발급은 주입된 `IdFactory`로 한다

ID 접두, 브랜드 타입, ID 스키마, `IdFactory` 인터페이스의 정본은 `F.conversation.spec` §3.2다(`F.records.spec` §3.1.2 정본 표, `F.readme` §4). 이 규칙은 그 정의를 쓰는 방법만 정한다.

- 형식: `<prefix>_<ULID>` 30자(`ID_LENGTH`). `prefix`는 소문자 세 글자이고 F `IdPrefix`의 여덟 개(`thr`, `trn`, `stp`, `itm`, `prt`, `evt`, `efx`, `ckp`)만 쓴다. 접두를 더하는 일은 F 문서 변경이다.
- `ULID`: Crockford base32 26자, 첫 글자 0~7. 대문자로 저장하고 비교한다(`ULID_PATTERN`).
- ID 문자열의 시각 부분으로 순서를 판단하지 않는다. 순서는 이벤트 `seq`다(`eng.events.design` 4.6절).
- 외부 시스템이 발급한 ID(모델 provider의 도구 호출 id, MCP 요청 id)는 접두 규약 대상이 아니다. F는 이 값을 브랜드 없는 `string`으로 둔다(예: `EffectIntent.toolCallId`, `F.records.spec` §3.5).
- 멱등 키에는 브랜드가 없다. payload의 `requestId`는 1~64자 문자열이고(`F.conversation.spec` §3.5, `F.readme` §4), 저장소의 커밋 키는 `CommitKey` 문자열이다(`eng.transactions.design` 4.7절, `COMMIT_KEY_PATTERN`). 이 문서의 이전 판에 있던 `RequestId` 브랜드, `RequestIdSchema`, `REQUEST_ID_PATTERN`, `deriveRequestId`는 두지 않는다.
- 브랜드 대상: 세션 기록, F 서비스 인터페이스, 와이어에 들어가는 F 접두 ID. 운영 테이블의 값(`sys_leases.holder_id`)과 이름 문자열(생산자 id, 소비자 이름, 확장 이름, scope id)은 브랜드 없이 각자의 패턴만 검사한다.

브랜드 ID 표(`F.conversation.spec` §3.2):

| 타입 | 접두 | 쓰는 곳 |
|---|---|---|
| `ThreadId` | `thr` | 대화 하나. 이전 판의 `SessionId`(`ss`) |
| `TurnId` | `trn` | turn |
| `StepId` | `stp` | step |
| `ItemId` | `itm` | item. 이전 판의 `MessageId`(`ms`) |
| `PartId` | `prt` | 파트 |
| `EventId` | `evt` | 이벤트 envelope `id`. 이전 판의 `ev` |
| `EffectId` | `efx` | 효과 |
| `CheckpointId` | `ckp` | 단계 체크포인트 |

F 접두 여덟 개에 없는 이전 판의 이름:

| 이전 이름 | 처리 |
|---|---|
| `SessionId`, `MessageId` | `ThreadId`, `ItemId`로 바꾼다 |
| `RequestId` | 브랜드를 두지 않는다. payload는 `requestId: string`, 커밋 키는 `CommitKey` |
| `TaskId`(`tk`), `InputId`(`in`), `ApprovalId`(`ap`) | F 접두 여덟 개에 없다. 필요한 문서가 `EventId` 등을 재사용한다(예: `L1.persistence.spec` §3.2 `InputView.inputId`, `ApprovalView.approvalId`는 그 이벤트의 `EventId`) |
| `ToolCallId` | provider가 발급하는 `string`이다 |
| `ScopeId` | `F.extensions.spec` §3.2의 `ScopeId`(브랜드 없는 `string`)를 쓴다 |
| 상수 `ID_PREFIXES` | 없다. 접두 목록은 타입 `IdPrefix`와 `IdByPrefix`의 키다 |

정의(`F.conversation.spec` §3.2를 옮겨 적음. 다르면 F를 따른다):

```ts
// packages/contracts/src/conversation/ids.ts
export type ThreadId = Brand<string, "ThreadId">;         // thr_<ULID>
export type TurnId = Brand<string, "TurnId">;             // trn_<ULID>
export type StepId = Brand<string, "StepId">;             // stp_<ULID>
export type ItemId = Brand<string, "ItemId">;             // itm_<ULID>
export type PartId = Brand<string, "PartId">;             // prt_<ULID>
export type EventId = Brand<string, "EventId">;           // evt_<ULID>
export type EffectId = Brand<string, "EffectId">;         // efx_<ULID>
export type CheckpointId = Brand<string, "CheckpointId">; // ckp_<ULID>

export type IdPrefix = "thr" | "trn" | "stp" | "itm" | "prt" | "evt" | "efx" | "ckp";
export interface IdByPrefix {
  thr: ThreadId; trn: TurnId; stp: StepId; itm: ItemId; prt: PartId;
  evt: EventId; efx: EffectId; ckp: CheckpointId;
}

export const ULID_PATTERN: string = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
export const ID_LENGTH: number = 30;

export function idPattern(prefix: IdPrefix): string;          // `^${prefix}_${ULID_PATTERN}$`
export function isId<P extends IdPrefix>(prefix: P, value: unknown): value is IdByPrefix[P];

export const ThreadIdSchema: TUnsafe<ThreadId>;
export const EventIdSchema: TUnsafe<EventId>;
// … 여덟 개 모두. 구현 예: Type.Unsafe<ThreadId>(Type.String({ pattern: idPattern("thr"), minLength: 30, maxLength: 30 }))

/** 발급은 F 밖에서 한다. 구현은 L0(시계·난수)과 L1(주입)이 맡는다. */
export interface IdFactory {
  next<P extends IdPrefix>(prefix: P): IdByPrefix[P];
}
```

- 서브패스: ID 이름과 `IdFactory`는 `@xeon/contracts/conversation`에서 import한다. 루트 `@xeon/contracts`에는 두지 않는다(`F.readme` §3). `@xeon/contracts/records`가 `EventId`, `EffectId`, `CheckpointId`를 같은 심볼로 다시 export한다.
- 경계에서 받은 ID는 `parse(ThreadIdSchema, input)`로만 얻는다. 별도 `parseThreadId` 함수를 만들지 않는다 [제안: 검증 진입점을 하나로 유지].
- 새 접두 ID는 `IdFactory.next(prefix)`로만 만든다. 브랜드 단언은 `IdFactory` 구현 안에만 있다(TY-06 허용 위치 2).
- [결정(잠정): review.decisions-2 U-03] `IdFactory` 구현의 위치. F에는 `Clock`·`RandomSource`·`IdFactory` 인터페이스와 순수 함수만 둔다. `createIdFactory(clock, random)` 같은 발급기 구현은 `platform-os`에 두고, 조립 루트가 주입한다. F에는 `./testing` 서브패스를 두지 않는다. 테스트 대역(`manualClock`, `seededRandom`, `fixedIdFactory`)은 각 패키지 `test/` 안에 둔다(`eng.testing.guide` 1.2절). 이 문서의 이전 판에 있던 스키마 생성 도우미 `brandedId`는 두지 않고, 각 ID 스키마는 위 구현 예처럼 `Type.Unsafe`로 직접 만든다.
- `Type.Unsafe`는 감싼 스키마의 패턴만 검사하고 브랜드 자체는 런타임에 없다(eng-2 §7). 브랜드는 정적 타입 전용이다.
- 타입 테스트(3.3절)가 `keyof IdByPrefix`와 `IdPrefix`의 일치를 검사한다.

이유: 접두사는 로그·DB·와이어에서 ID 종류를 사람이 바로 알아보게 하고, 패턴 검사는 다른 종류 ID가 잘못 들어온 것을 경계에서 잡는다. 브랜드는 같은 실수를 컴파일 시점에 잡는다(TY-09). 멱등 키는 재시도와 재개에서 같은 값이 나와야 하므로 무작위 ID로 만들 수 없다(`eng.transactions.design` 4.7절). 이름을 F 하나로 두면 문서와 코드가 다른 접두를 쓰는 일이 없다.

좋은 예:

```ts
const threadId = ids.next("thr"); // ThreadId
const parsed = parse(EventIdSchema, input); // Result<EventId, ParseError>
const key = `resp:${turnId}:${stepIndex}`; // 커밋 키(CommitKey). 먼저 커밋된 값에서 만든다
```

나쁜 예:

```ts
// 리뷰 DT-06, 타입 테스트 실패: ID 스키마가 브랜드 없이 string
export const ThreadIdSchema: TString = Type.String();

// oxlint typescript/consistent-type-assertions 실패 (TY-06)
const threadId = `thr_${ulid()}` as ThreadId;

// 리뷰 DT-06: 멱등 키를 무작위 ID로 만든다. 재시도마다 키가 달라진다
const key = `rq_${ulid()}`;
```

### DT-07 판별 유니온은 판별자 하나만 쓴다: 데이터는 `type`, 오류는 `kind`

[제안] 오류 판별자 `kind`는 `eng.typescript.guide` TY-12를 따른다. 이벤트 envelope은 예외다. envelope의 종류 필드는 `kind`이고 내구·휘발 판별자는 `durable`이다([결정] `F.records.spec` §3.1).

- 와이어 메시지, 대화 파트, 도구 결과처럼 저장·전송되는 데이터 유니온의 판별자는 `type`이다. 이벤트 envelope만 위 예외를 따른다.
- 오류 유니온(`Result`의 `E`)의 판별자는 `kind`다(TY-12).
- 한 유니온은 판별자 하나만 쓴다. 변형마다 판별자 프로퍼티는 `Type.Literal`이고 필수다.
- `tag`, `_tag`, `variant`, `code` 같은 다른 이름은 쓰지 않는다. 숫자 판별자는 쓰지 않는다.
- 판별자 값의 명명: 이벤트 `kind`는 `F.records.spec` §3.2의 kind 이름 규칙을 따른다. 그 밖의 `type`과 `kind` 값은 소문자 `snake_case`다 [제안].

이유: 판별자 이름이 고정되면 `switch` 완전성 검사, 열린 변형 판정(`isOpenVariant`), 스키마 호환성 검사(4.3절)를 유니온마다 따로 짜지 않는다.

좋은 예: DT-08의 `ToolOutcomeSchema`.

나쁜 예:

```ts
// 스캔 xeon/contracts-discriminant 실패 [제안]: 판별자 이름이 변형마다 다름
export const NoticeSchema: TUnion<[typeof InfoNoticeSchema, typeof WarnNoticeSchema]> = Type.Union([
  InfoNoticeSchema, // { level: "info", ... }
  WarnNoticeSchema, // { severity: "warn", ... }
]);
```

### DT-08 확장 가능한 유니온은 알려진 변형과 `x.`·`grp.` 접두 변형으로 연다

[제안]

- 확장이 변형을 더할 수 있는 유니온(열린 유니온)은 F가 정한 알려진 변형 목록에 열린 변형 하나를 더해 정의한다.
- 열린 변형의 판별자 값 형식은 플러그인 `x.<extId>.<name>`, 의도 그룹 `grp.<groupId>.<name>`이다(`F.records.spec` §3.2, `F.extensions.spec` §4.9). 예: `kind: "grp.helm.phase.changed"`(이벤트), `kind: "grp.helm.lens_missing"`(오류), `type: "x.mermaid.diagram"`(데이터).
  - `extId`·`groupId`는 확장 매니페스트의 이름이고 `ExtensionName`(`^[a-z][a-z0-9-]{1,31}$`, 소문자·숫자·하이픈, 밑줄 금지)이다(`F.extensions.spec` §3.1, [결정(잠정): review.decisions-2 U-18]). 생산자 id는 `ext.<확장 이름>`, 확장 테이블 접두는 `x_<확장 이름의 '-'를 '_'로>_`이고 지역 테이블 이름에는 밑줄을 쓰지 않는다(`eng.context-map.design` 5.1·5.2절, `X.operations.spec` §4.4.2).
  - 패턴: `^(?:x|grp)\.[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9_.]{0,63}$`
  - `_` 접두 값은 코어 열거형 확장 예약으로만 남는다(`F.extensions.spec` §4.9). 이 문서의 이전 판에 있던 `_ext.` 접두는 쓰지 않는다.
- 열린 변형의 나머지 내용은 `data: unknown` 하나로 둔다. 내용 검증은 그 확장이 자기 스키마로 한다.
- 열린 변형의 정적 타입은 템플릿 리터럴 `` `x.${string}` | `grp.${string}` ``이다. 그래야 알려진 리터럴과 겹치지 않아 `switch`가 좁히기를 유지한다. `Type.String({ pattern })`만 쓰면 정적 타입이 `string`이 되어 알려진 변형과 겹친다.
- 소비자는 알려진 변형을 모두 처리하고, 열린 변형은 오류 없이 통과(전달·저장)하거나 무시한다. `default`에서 `isOpenVariant`로 열린 변형을 걸러낸 뒤 `assertNever`를 호출한다(TY-14 두 번째 좋은 예).
- 알려진 목록에 없고 `x.`·`grp.` 접두도 없는 값은 `parse`가 거부한다. 이 경우는 버전 불일치이고 DT-10이 다룬다.
- 닫힌 유니온으로 둘 것과 열린 유니온으로 둘 것은 F 스펙이 유니온마다 정한다. 판단 기준: L3 그룹이나 플러그인이 새 변형을 만들 필요가 있는가.

이유:

- Helm과 학습 그룹은 L3 기본 그룹이고, 사용자는 그룹과 플러그인을 추가·교체한다(`_research/decisions-log.md` 2026-10-21 배포 단위 정정). F 유니온이 닫혀 있으면 새 그룹마다 F 수정이 필요하다.
- 접두 문자열 규약은 런타임에 확장 변형을 한 번의 문자열 검사로 구분한다. pi agent-core는 선언 병합으로 타입을 확장하지만(`_research/packages.md §4.1` F4 열거형 확장 예약) 선언 병합은 런타임 검증 스키마를 바꾸지 못한다. 접두 규약은 정적 타입과 런타임 검사를 같은 방식으로 다룬다.
- 소비자가 모르는 확장 변형에서 실패하면 그 확장을 끈 세션이나 그 확장이 없는 클라이언트가 열리지 않는다. 통과 규칙은 확장을 켜고 끄는 일(`scope` 토글)이 저장된 데이터의 읽기 가능성에 영향을 주지 않게 한다.

정의와 완결 예:

```ts
// packages/contracts/src/base/open-variant.ts
import { Type, type TUnsafe } from "typebox";

export const OPEN_VARIANT_PATTERN = "^(?:x|grp)\\.[a-z][a-z0-9-]{1,31}\\.[a-z][a-z0-9_.]{0,63}$";
export type OpenVariantType = `x.${string}` | `grp.${string}`;

export const OpenVariantTypeSchema: TUnsafe<OpenVariantType> = Type.Unsafe<OpenVariantType>(
  Type.String({ pattern: OPEN_VARIANT_PATTERN }),
);

export function isOpenVariant<V extends { readonly type: string } | { readonly kind: string }>(
  value: V,
): value is Extract<V, { readonly type: OpenVariantType } | { readonly kind: OpenVariantType }> {
  const tag = "type" in value ? value.type : value.kind;
  return tag.startsWith("x.") || tag.startsWith("grp.");
}
```

```ts
// packages/contracts/src/capabilities/tool-outcome.ts
import { Type, type Static, type TLiteral, type TObject, type TString, type TUnion, type TUnknown } from "typebox";
import { OpenVariantTypeSchema } from "../base/open-variant.ts";

export const ToolCompletedSchema: TObject<{ type: TLiteral<"completed">; output: TUnknown }> = Type.Object(
  { type: Type.Literal("completed"), output: Type.Unknown() },
  { additionalProperties: false },
);

export const ToolFailedSchema: TObject<{
  type: TLiteral<"failed">;
  error: TObject<{ kind: TString; detail: TString }>;
}> = Type.Object(
  {
    type: Type.Literal("failed"),
    error: Type.Object(
      { kind: Type.String({ minLength: 1, maxLength: 128 }), detail: Type.String({ maxLength: 4000 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ToolDeniedSchema: TObject<{ type: TLiteral<"denied">; reason: TString }> = Type.Object(
  { type: Type.Literal("denied"), reason: Type.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
);

export const ToolOutcomeExtSchema: TObject<{ type: typeof OpenVariantTypeSchema; data: TUnknown }> = Type.Object(
  { type: OpenVariantTypeSchema, data: Type.Unknown() },
  { additionalProperties: false },
);

export const ToolOutcomeSchema: TUnion<
  [typeof ToolCompletedSchema, typeof ToolFailedSchema, typeof ToolDeniedSchema, typeof ToolOutcomeExtSchema]
> = Type.Union([ToolCompletedSchema, ToolFailedSchema, ToolDeniedSchema, ToolOutcomeExtSchema]);

export type ToolOutcome = Static<typeof ToolOutcomeSchema>;
```

소비 쪽 좋은 예:

```ts
export function recordOutcome(outcome: ToolOutcome, sink: OutcomeSink): void {
  switch (outcome.type) {
    case "completed":
      sink.completed(outcome.output);
      return;
    case "failed":
      sink.failed(outcome.error.kind);
      return;
    case "denied":
      sink.denied(outcome.reason);
      return;
    default:
      if (isOpenVariant(outcome)) {
        sink.passThrough(outcome); // 저장·전달은 하고 해석은 하지 않는다
        return;
      }
      assertNever(outcome, "ToolOutcome");
  }
}
```

나쁜 예:

```ts
// 리뷰 DT-08, 수용 테스트 실패: 확장 변형에서 버그 throw
export function recordOutcome(outcome: ToolOutcome, sink: OutcomeSink): void {
  switch (outcome.type) {
    case "completed":
      sink.completed(outcome.output);
      return;
    case "failed":
      sink.failed(outcome.error.kind);
      return;
    case "denied":
      sink.denied(outcome.reason);
      return;
    default:
      throw new Bug(`unknown outcome ${outcome.type}`);
  }
}

// 리뷰 DT-08: 열린 변형을 접두사 없는 string으로 정의해 알려진 변형과 겹침
export const ToolOutcomeLooseSchema: TObject<{ type: TString; data: TUnknown }> = Type.Object({
  type: Type.String(),
  data: Type.Unknown(),
});
```

- 첫 번째 나쁜 예는 `default`에서 `outcome`이 열린 변형 타입이라 `assertNever`를 쓰지 않아도 컴파일된다. 그래서 자동 검사는 TY-14 스캔(`xeon/switch-default-never`: `default`에 `assertNever`가 없으면 실패)이 한다.
- `isOpenVariant`의 `Extract` 좁히기는 [가정]이다. 컴파일 확인은 M0 타입 테스트에서 한다.

### DT-09 필드 추가는 선택 필드로만 한다. 필드 삭제와 의미 변경은 새 버전 변형으로 한다

[제안]

| 변경 | 같은 버전에서 허용 | 처리 |
|---|---|---|
| 선택 필드 추가 | 허용 | `Type.Optional`. 기존 데이터는 키가 없으므로 그대로 통과 |
| 필수 필드 추가 | 금지 | `version`을 올리고 업캐스터가 기본값을 채운다(DT-11) |
| 필드 삭제 | 금지 | `version`을 올린다. 업캐스터가 필드를 지운다 |
| 필드 이름 변경 | 금지 | 삭제 + 추가와 같다 |
| 필드 타입·단위·의미 변경 | 금지 | `version`을 올린다 |
| 문자열 제약 강화(`maxLength` 감소, `pattern` 추가) | 금지 | 기존 데이터가 실패할 수 있다. `version`을 올린다 |
| 문자열 제약 완화 | 허용 | |
| 닫힌 유니온 변형 추가 | 금지 | 기존 소비자의 `assertNever`가 런타임에 실패한다. `version`을 올린다 |
| 열린 유니온의 알려진 변형(`x.`·`grp.` 접두 없음) 추가 | 금지(잠정) | 아래 [미결] 항목이 정해질 때까지 `version`을 올린다 |
| 리터럴 유니온 값 추가 | 금지 | 닫힌 유니온 변형 추가와 같다 |
| 리터럴 유니온 값 삭제 | 금지 | `version`을 올린다 |

- [미결] 열린 유니온에 F가 새 알려진 변형(접두사 없음)을 더하는 경우. 옛 소비자는 이 값을 알려진 목록에도 `x.`·`grp.` 접두에도 맞지 않는 값으로 보고 `parse`에서 거부한다. 저장 데이터는 DT-10 규칙 6으로 막히지만 와이어(새 엔진, 옛 클라이언트)는 버전 협상(`F.wire-settings.spec`)에 맡긴다. 와이어 협상 방식이 정해지기 전까지 이 행은 "금지, `version` 올림"으로 다룬다.
- "같은 버전"은 이벤트 payload의 `version`, 와이어 메시지의 프로토콜 버전, 설정 스키마 버전을 말한다.

이유: 하위 호환(새 코드가 옛 데이터를 읽는 것)은 이벤트 소싱의 전제다. 옛 이벤트는 지워지지 않고 영원히 재생된다. 선택 필드 추가만 이 전제를 깨지 않는다. 나머지는 옛 데이터를 새 형식으로 옮기는 명시적 단계(업캐스터)가 있어야 한다.

좋은 예:

```ts
// 가상의 확장 kind x.notes.memo.saved payload(DT-11). version 2 그대로, 선택 필드 추가
export const MemoSavedSchema: TObject<{
  itemId: typeof ItemIdSchema;
  title: TString;
  body: TUnknown;
  pinned: TBoolean;
  color: TAddOptional<TString>; // 추가: 선택 필드
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.Unknown(),
    pinned: Type.Boolean(),
    color: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
  },
  { additionalProperties: false },
);
```

나쁜 예:

```ts
// 스키마 호환성 검사 실패 (3.4절): version 2 그대로 필수 필드 추가
color: Type.String({ minLength: 1, maxLength: 16 }),
```

### DT-10 payload 버전은 kind마다 두고, envelope 모양 변경은 DB 마이그레이션으로 한다

`docs/design/09-event-store.md §3.13.3`의 버전 규칙 여섯 개를 Xeon에 옮긴다. envelope 필드 이름과 카탈로그의 정본은 `F.records.spec` §3.1·§3.3이고, 운용은 `eng.events.design`이 정한다. 여기서는 규칙만 정한다.

1. payload 버전은 이벤트 `kind`마다 따로 올리는 정수 `version`이다(1부터, 09의 `typeVersion`). envelope 형식 버전 필드(09의 `v`)는 두지 않는다. envelope 모양을 바꾸면 DB 마이그레이션으로 처리한다(`F.records.spec` §3.1.1 `v` 행, §3.7 규칙 1).
2. 저장된 이벤트를 제자리에서 고쳐 쓰지 않는다(DT-11).
3. 형식 변환은 업캐스터로, 데이터 정정은 새 이벤트로 한다. 둘을 섞지 않는다. 업캐스터 안에서 값의 옳고 그름을 판단해 고치지 않는다.
4. 투영 스키마(SQLite 투영 테이블)는 이벤트 스키마와 독립된 버전을 가진다. 투영은 버전이 바뀌면 이벤트에서 다시 만든다(`eng.events.design`).
5. 프로세스 밖 상대(L4 클라이언트, 엔진 사이드카, 공유 서비스 모드의 다른 클라이언트)는 연결할 때 지원하는 와이어 프로토콜 버전 범위를 서로 알린다(`F.wire-settings.spec`). 09의 handshake 규칙을 Xeon 전송 계층에 옮긴 것이다.
6. 저장소에 이 앱이 모르는 코어 `kind`나 이 앱보다 높은 `version`이 있으면 엔진은 그 thread를 쓰기 모드로 열지 않는다. 읽기 전용 내보내기는 허용한다. 예외: 확장 접두(`x.`, `grp.`, DT-08) kind는 모르는 kind로 세지 않는다. 그 확장이 설치되지 않았거나 꺼진 상태에서도 코어 투영은 이 이벤트를 건너뛰고 thread를 연다 [제안: Xeon에서 더한 예외. 확장 on/off가 thread 열기를 막지 않게 한다. `F.records.spec` §10 미결 5].

이유: envelope 형식(seq, id, 시각 필드)은 저장소와 재생 코드 전체가 의존하므로 거의 바뀌지 않아야 하고, payload는 이벤트 종류마다 독립적으로 바뀐다. 한 버전 번호로 묶으면 payload 하나의 변경이 전체 envelope 버전을 올리게 된다. 규칙 6은 다운그레이드한 앱이 모르는 데이터를 건너뛰고 투영해 틀린 상태 위에 쓰기를 받는 것을 막는다(09 §3.13.3 규칙 6의 이유).

envelope 표기 시연(`F.records.spec` §3.1의 내구 envelope을 TypeBox 1.4로 적은 형식. 필드 목록과 뜻의 정본은 F이고, 아래는 DT-03 주석, DT-06 브랜드 ID 스키마, DT-08 확장 kind 접두를 적용한 모양이다):

```ts
// packages/contracts/src/records/envelope.ts
import {
  Type,
  type Static,
  type TAddOptional,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { Nullable } from "../base/nullable.ts";
import { EpochMsSchema } from "../base/time.ts";
import { EventIdSchema, StepIdSchema, ThreadIdSchema, TurnIdSchema } from "../conversation/ids.ts";
import { DetachedFieldSchema } from "./blob.ts";
import { EventKindSchema } from "./kinds.ts";

export const DurableEventEnvelopeSchema: TObject<{
  durable: TLiteral<true>;
  id: typeof EventIdSchema;
  kind: typeof EventKindSchema;
  version: TInteger;
  threadId: typeof ThreadIdSchema;
  turnId: TUnion<[typeof TurnIdSchema, TNull]>;
  stepId: TUnion<[typeof StepIdSchema, TNull]>;
  seq: TInteger;
  parentId: TUnion<[typeof EventIdSchema, TNull]>;
  recordedAt: typeof EpochMsSchema;
  causationId: TUnion<[typeof EventIdSchema, TNull]>;
  correlationId: TUnion<[TString, TNull]>;
  detached: TAddOptional<TArray<typeof DetachedFieldSchema>>;
  payload: TUnknown;
}> = Type.Object(
  {
    durable: Type.Literal(true),
    id: EventIdSchema,
    kind: EventKindSchema, // 코어 <영역>.<이름>, 확장 x.<extId>.… / grp.<groupId>.… (F.records.spec §3.2)
    version: Type.Integer({ minimum: 1, maximum: 1000 }),
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    seq: Type.Integer({ minimum: 1 }),
    parentId: Nullable(EventIdSchema),
    recordedAt: EpochMsSchema,
    causationId: Nullable(EventIdSchema),
    correlationId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    detached: Type.Optional(Type.Array(DetachedFieldSchema, { maxItems: 256 })), // [가정] 상한 값은 F.records.plan이 정한다
    payload: Type.Unknown(), // kind·version별 스키마로 2차 검증 (DT-05)
  },
  { additionalProperties: false },
);
export type DurableEventEnvelope = Static<typeof DurableEventEnvelopeSchema>;
```

- ID 필드는 브랜드 ID 스키마를 직접 쓴다. `Type.Unsafe`의 런타임 검사는 패턴 그대로이므로 저장 형식 검사는 문자열 검사와 같고, `parse` 결과가 바로 브랜드 타입이 되어 별도 변환과 단언이 없어진다(TY-06).
- envelope에는 `v`, `type`, `typeVersion`, `sessionId`, `producer`, `requestId`, `category`가 없다(`F.records.spec` §3.1.1). 커밋 키는 저장 열 `events.request_id`, 생산자 id는 커밋 초안(`StampedDraft.producer`)에 둔다(`eng.events.design` 4.1절).
- 휘발 envelope(`durable: false`, `n`, `afterSeq`)과 판별 유니온 `EventEnvelopeSchema`도 같은 방식으로 적는다(`F.records.spec` §3.1).
- payload를 `Type.Unknown()`으로 두고 kind별로 2차 검증하는 방식은 09가 `Type.Record(Type.String(), Type.Unknown())`로 둔 것을 바꾼 것이다(`eng.events.design` 4.1절과 같음).
- `AuthorityBasis` 같은 패턴 문자열 필드는 Xeon envelope에 없다. 패턴 필드를 둘 때는 09의 `AUTHORITY_PATTERN`처럼 길이 상한을 패턴 안에 둔다(`{1,200}`, DT-15).

### DT-11 저장된 데이터는 제자리에서 고치지 않는다. 형식 변환은 업캐스터 순수 함수로 한다

[제안]

```ts
// @xeon/contracts (루트 진입점)
/** version n의 payload를 n+1 형식으로 바꾼다. 순수 함수: I/O, 시계, 난수, 전역 상태를 쓰지 않는다. */
export type Upcaster = (payload: unknown) => Result<unknown, ParseError>;
```

- 업캐스터는 이벤트 `kind`마다 `n → n+1` 한 단계씩 둔다. 여러 단계는 차례로 적용한다. 등록 표와 적용 함수(`upcastEvent`)의 정본은 `F.records.spec` §3.7이다.
- 업캐스터는 입력을 옛 버전 스키마로 `parse`한 뒤 새 객체를 만든다. 마지막 단계의 결과는 현재 스키마로 다시 `parse`한다.
- 업캐스터는 읽을 때 메모리 사본에만 적용한다. DB 행을 고쳐 쓰지 않는다. 해시 체인을 둔다면 해시는 저장된 원본으로 계산한다.
- 옛 버전 스키마는 지우지 않고 `<Name>V<n>Schema` 이름으로 contracts에 남긴다. 현재 버전은 접미사 없는 `<Name>Schema`다.
- [미결] F `Upcaster`는 `(payload: unknown) => unknown`이다(`F.records.spec` §3.7). 위 `Result` 반환 모양과 어느 쪽으로 맞출지는 F와 함께 정한다.

이유: 이벤트 소싱에서 저장된 이벤트는 과거 사실의 기록이다. 제자리 수정은 재생 결과, 해시, 다른 기기의 사본을 서로 다르게 만든다. 업캐스터를 순수 함수로 두면 같은 옛 이벤트가 언제 읽어도 같은 새 형식이 되고, 단위 테스트로 모든 단계를 확인할 수 있다.

버전 업 완결 예(가상의 확장 kind `x.notes.memo.saved` 1 → 2. 확장 `notes`가 자기 패키지에 두는 payload 스키마다):

```ts
// notes 확장의 memo-saved.ts
import {
  Type,
  type Static,
  type TAddOptional,
  type TBoolean,
  type TObject,
  type TString,
  type TUnknown,
} from "typebox";
import { ok, parse, type Upcaster } from "@xeon/contracts";
import { ItemIdSchema } from "@xeon/contracts/conversation";

/** version 1: name 필드, pinned 없음 */
export const MemoSavedV1Schema: TObject<{
  itemId: typeof ItemIdSchema;
  name: TString;
  body: TUnknown;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type MemoSavedV1 = Static<typeof MemoSavedV1Schema>;

/** version 2: name → title, 필수 필드 pinned 추가 (DT-09에 따라 버전 올림) */
export const MEMO_SAVED_VERSION: 2 = 2;

export const MemoSavedSchema: TObject<{
  itemId: typeof ItemIdSchema;
  title: TString;
  body: TUnknown;
  pinned: TBoolean;
  color: TAddOptional<TString>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.Unknown(),
    pinned: Type.Boolean(),
    color: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
  },
  { additionalProperties: false },
);
export type MemoSaved = Static<typeof MemoSavedSchema>;

/** 1 → 2. v1에는 고정 여부가 없었으므로 고정하지 않은 쪽인 false로 채운다. */
export const upcastMemoSaved1to2: Upcaster = (payload) => {
  const v1 = parse(MemoSavedV1Schema, payload);
  if (!v1.ok) return v1;
  const { name, ...rest } = v1.value;
  return ok({ ...rest, title: name, pinned: false });
};
```

```ts
// notes 확장의 memo-saved.test.ts
import { expect, test } from "bun:test";

test("upcastMemoSaved1to2: name을 title로 옮기고 pinned를 false로 채운다", () => {
  const v1 = { itemId: "itm_01JA2Z7Q8M3XK4V9TB6N0PRWES", name: "todo", body: { text: "a" } };
  const up = upcastMemoSaved1to2(v1);
  expect(up.ok).toBe(true);
  if (!up.ok) return;
  const current = parse(MemoSavedSchema, up.value);
  expect(current.ok).toBe(true);
  expect(v1).toEqual({ itemId: "itm_01JA2Z7Q8M3XK4V9TB6N0PRWES", name: "todo", body: { text: "a" } }); // 입력 불변
});
```

나쁜 예:

```ts
// 리뷰 DT-11: 저장된 행을 제자리에서 고침
db.run("UPDATE events SET envelope = json_set(envelope, '$.payload.title', json_extract(envelope, '$.payload.name')) WHERE kind = 'x.notes.memo.saved'");

// 리뷰 DT-11, 스캔 xeon/no-ambient-time 실패: 업캐스터가 시계를 읽고 값을 판단해 고침 (형식 변환과 데이터 정정을 섞음)
export const badUpcaster: Upcaster = (payload) => ok({ ...(payload as object), migratedAt: new Date().getTime() });
```

### DT-12 F 서브패스 사이 의존은 한 방향이고 순환을 두지 않는다

[제안] `@xeon/contracts` 안의 의존 순서는 `F.readme` §3의 도메인 사이 import 표(base 0 < conversation 1 < capabilities 2 = records 2 < extensions 3 < settings 4 = services 4 < wire 5)를 따른다. 각 소스 디렉터리는 자기보다 순서가 낮은 것만 import하고, 순서가 같은 것끼리(capabilities와 records, settings와 services)는 import하지 않는다. `services`는 L0·L1 서비스 인터페이스, X 포트를 확장하는 `McpService`(L2)와 `GroupService`(L3), 서비스 이름 상수 `SERVICE_NAMES`(15개)를 모은 서브패스다([결정(잠정): review.decisions-2 D-04], `F.capabilities.spec` §3.12). 서비스 인터페이스가 extensions(순서 3)의 포트(`LoopPort`, `InputQueuePort`, `ToolsPort`, `ModelsPort`, `ProcessPort`, `McpPort`, `LeaseArbiterPort`)를 확장하므로 `services`는 순서 4이고, base·conversation·records·capabilities·extensions를 `import type`으로만 가져온다. 같은 순서인 settings는 import하지 않으므로 `GroupService`의 설정 범위는 `SettingScope`와 같은 모양의 리터럴 유니언으로 적는다. wire(순서 5)는 `services`를 import하지 않는다(`F.readme` §3). `import type`도 같은 방향을 지킨다. `check-layers.ts`의 서브패스 순서 검사는 그 표를 그대로 쓴다.

- 서브패스는 `packages/contracts/package.json` `exports`에 `F.readme` §3의 모양으로 둔다. 소비 층은 서브패스 진입점으로만 import한다(`no-restricted-imports`의 `@xeon/*/src` 금지).
- `import/no-cycle`의 `ignoreTypes` 기본값이 `true`라 타입 순환은 린트가 잡지 않으므로(`_research/notes/eng-1.md §2`) `check-layers.ts`가 서브패스 순서를 검사한다 [제안].

이유: F는 모든 층이 의존하는 바닥이다. F 안의 순환은 import 순서에 따라 `undefined` 스키마를 만들고(모듈 초기화 순서), 서브패스 하나를 바꿔도 F 전체가 다시 검사·빌드된다. 순서를 고정하면 서브패스별 변경 영향 범위가 표로 정해진다.

좋은 예:

```ts
// packages/contracts/src/records/effects.ts (순서 2)
import { ReplayPolicySchema } from "../conversation/tool-result.ts"; // 순서 1: 허용
```

나쁜 예:

```ts
// packages/contracts/src/capabilities/tool-outcome.ts (순서 2)
// check-layers 실패 [제안 규칙]: 같은 순서 2(records)를 import
import { DurableEventEnvelopeSchema } from "../records/envelope.ts";
```

### DT-13 설정 스키마 키는 점 구분 이름 공간을 쓴다

[제안] 최종 키 목록과 범위(전역, 프로젝트, 세션)는 `F.wire-settings.spec`이 정한다. 이 규칙은 키 이름 형식만 정한다.

- 형식: `<영역>.<이름>` 또는 `<영역>.<하위>.<이름>`. 각 세그먼트는 `lowerCamelCase`, 영문 소문자로 시작한다. 패턴: `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$`.
- 코어 영역 이름은 층 도메인 이름을 쓴다. 예: `models.defaultModel`, `models.thinkingBudget`, `tools.bash.timeoutMs`, `web.search.provider`.
- 확장 설정은 `ext.<extId>.<이름>`이다. 예: `ext.helm.explorationDepth`. `extId`는 DT-08과 같은 값(`ExtensionName`)이다. 기록 kind 접두(`x.`·`grp.`)와 설정 키 접두(`ext.`)가 다른 이유는 `F.readme` §4다. 확장은 자기 `ext.<id>.` 아래 키만 정의한다.
- 단위가 있는 수치는 키 이름 끝에 단위를 붙인다: `Ms`, `Bytes`, `Tokens`, `Usd`.
- 불리언은 `enabled`, `allow<무엇>` 형태다. 부정형(`disable…`, `no…`)은 쓰지 않는다.
- 비밀 값은 설정에 직접 두지 않고 비밀 참조 문자열로 둔다(L0 `platform-secrets`, `L0.secrets.spec`).

이유: 설정은 L4 설정 화면, 설정 파일, 명령줄이 같은 키로 다룬다(`_research/decisions-log.md` 2026-10-21 "L4 클라이언트 설정 화면에서 조작 가능"). 키 형식이 고정되면 화면 그룹화, 검색, 확장별 설정 분리가 키 문자열만으로 된다.

좋은 예:

```ts
export const SETTING_KEY_PATTERN = "^[a-z][a-zA-Z0-9]*(\\.[a-z][a-zA-Z0-9]*){1,3}$";
// 키 예: "tools.bash.timeoutMs", "ext.helm.explorationDepth"
```

나쁜 예:

```ts
// 설정 스키마 검사 실패 (SETTING_KEY_PATTERN): 대문자 시작, 밑줄, 부정형, 단위 없음
"Tools.bash_timeout", "helm.noExplore", "tools.bash.timeout"
```

### DT-14 직렬화는 정규화 JSON 하나로 하고, 시각은 정수 ms로 통일한다

[제안]

- 저장(이벤트 envelope 열), 해시, 멱등 지문은 정규화 JSON(RFC 8785 JCS)으로 계산한다. 함수는 `canonicalJson(value: unknown): string`이다(09 §3.2.1의 규칙을 옮김: 키 정렬, 공백 없음, NaN·Infinity 금지, `undefined` 값 키 제거, 배열 안 `undefined`는 오류).
- 시각은 모든 곳(도메인, 저장, 와이어)에서 Unix epoch 밀리초 정수다. 스키마는 `EpochMsSchema`다.

```ts
// packages/contracts/src/base/time.ts
import { Type, type TInteger } from "typebox";

/** Unix epoch 밀리초. 2001-09-09 이후, 9999-12-31 이전 */
export const EpochMsSchema: TInteger = Type.Integer({ minimum: 1_000_000_000_000, maximum: 253_402_300_799_999 });
```

- 기간은 `…Ms` 정수다. 날짜 문자열(ISO 8601) 변환은 L4 표시 코드에서만 한다.
- 스키마에 `Date` 객체, `bigint`, `Map`, `Set`, `undefined`, 함수, 클래스 인스턴스를 두지 않는다. 모두 JSON 표현이 없거나 하나로 정해지지 않는다.
- 이진 데이터는 blob 참조로 둔다(DT-15, `eng.events.design`).

이유: ISO 문자열과 정수 ms를 섞으면 비교·정렬·해시가 표현마다 달라진다. 정수 ms는 SQLite 정수 열에 그대로 들어가고 정렬과 범위 질의가 단순하며, 09 필드 규칙 7(payload 시각은 ms 정수)과 같다. 와이어까지 같은 표현을 쓰면 DT-04의 DTO 변환에서 시각 변환이 사라진다.

좋은 예:

```ts
startedAt: EpochMsSchema,
timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 3_600_000 })),
```

나쁜 예:

```ts
// 리뷰 DT-14, 스캔 xeon/contracts-no-date 실패 [제안]: Date 객체와 ISO 문자열을 섞음
startedAt: Type.Unsafe<Date>(Type.String({ format: "date-time" })),
```

- [미결] 와이어 직렬화에서 `Date`와 `bigint`가 필요한 경우(외부 프로토콜이 ISO 문자열을 요구하는 MCP 등, 큰 정수 토큰 수). 현재 규칙은 와이어도 정수 ms이고, `Number.MAX_SAFE_INTEGER`를 넘는 정수는 10진 문자열로 둔다는 것을 [제안]한다.

### DT-15 문자열·배열·payload 크기에 상한을 둔다

[제안] 기본값:

| 대상 | 기본 제약 | 근거 |
|---|---|---|
| 모든 `Type.String` | `maxLength` 또는 길이가 정해지는 `pattern` 필수 | 무한 문자열 거부 |
| 식별자성 문자열(이름, 키, 판별자) | `minLength: 1`, `maxLength: 32`(확장 id), `128`(type 이름), `pattern` 필수 | DT-06, DT-08, DT-13 |
| 한 줄 표시 문자열(제목, 레이블) | `maxLength: 200` | 08 §3.4.1 `Title` |
| 짧은 서술(이유, 요약) | `maxLength: 500` | 08 §3.4.1 `ShortText` |
| 긴 서술 | `maxLength: 4000`. 넘으면 blob | 08 §3.4.1 `Text` |
| 배열 | `maxItems` 필수. 기본 `1024` | |
| 빈 문자열 | 의미가 없으면 `minLength: 1` | 08 §3.4.1 |
| envelope 정규화 JSON 크기 | 256 KiB 이하. 넘는 내용은 blob 참조 | 09 §3.2 필드 규칙 6 |
| 패턴 문자열 | 패턴 안에 길이 상한을 둔다(`{1,200}`) | 09 §3.2 `AUTHORITY_PATTERN` |

- 모델 메시지 본문, 도구 출력 전문, 이미지처럼 상한을 정할 수 없는 내용은 blob에 두고 스키마에는 blob 참조만 둔다. blob 참조 스키마 이름과 필드는 `eng.events.design`과 `F.records.spec`이 정한다(08 §3.4.7 `BlobRef`가 출발점).
- 크기 상한 초과는 쓰기 측 버그로 보고 쓰기를 거부한다(`Result`의 오류). 사람 입력처럼 거부하면 데이터가 사라지는 경로는 받는 쪽이 검증 전에 blob으로 옮긴다(08 §3.4.1 방식).

이유: 상한 없는 문자열은 이벤트 하나로 DB와 메모리, 와이어 프레임, 모델 컨텍스트를 채운다. 스키마 단계에서 상한을 강제하면 쓰기 전에 실패가 드러나고, 확장이 보낸 페이로드 크기도 같은 방식으로 제한한다.

좋은 예:

```ts
reason: Type.String({ minLength: 1, maxLength: 500 }),
tags: Type.Array(TagSchema, { maxItems: 32 }),
```

나쁜 예:

```ts
// 스캔 xeon/contracts-bounded-string 실패 [제안]: 상한 없는 문자열과 배열
reason: Type.String(),
tags: Type.Array(TagSchema),
```

- [미결] blob 참조로 옮기는 기준 크기와 `BlobRef` 모양. `eng.events.design`과 맞춘다.

### DT-16 "값 없음"은 키 생략, "명시적 비움"은 `null`로 표현한다

[제안]

- 선택 필드는 `Type.Optional(T)`다. `exactOptionalPropertyTypes`에서 키 생략만 허용된다(TY-17).
- 저장할 의미가 있는 "비어 있음"(예: 인과 이벤트 없음)은 필수 필드에 `Nullable(T)`로 둔다.
- 한 필드에 `Type.Optional(Nullable(T))`를 쓰지 않는다. 표현이 셋(생략, null, 값)이 되어 소비자 분기가 늘어난다.

```ts
// packages/contracts/src/base/nullable.ts
import { Type, type TNull, type TSchema, type TUnion } from "typebox";

export function Nullable<T extends TSchema>(schema: T): TUnion<[T, TNull]> {
  return Type.Union([schema, Type.Null()]);
}
```

이유: JSON에는 `undefined`가 없으므로 "키 없음"과 "`null`"만 저장된다. 두 표현에 각각 한 가지 뜻을 주면 저장 전후로 의미가 바뀌지 않는다.

좋은 예:

```ts
causationId: Nullable(EventIdSchema),               // 필수, 원인이 없으면 null
label: Type.Optional(Type.String({ maxLength: 200 })), // 선택, 없으면 키 생략
```

나쁜 예:

```ts
// 리뷰 DT-16: 생략과 null이 한 필드에 섞임
label: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
```

### DT-17 객체 스키마는 닫는다

[제안] `Type.Object(..., { additionalProperties: false })`를 기본으로 한다. 열린 내용은 이름 있는 `Type.Unknown()` 필드(`data`, `payload`, `input`) 하나로 모은다.

이유: 열린 객체는 오타 필드를 조용히 통과시키고, 정규화 JSON 해시에 스키마가 모르는 키를 넣는다. 닫힌 객체에서 확장 지점은 DT-08의 `data` 필드 하나로 정해진다.

좋은 예: DT-08, DT-11의 스키마.

나쁜 예:

```ts
// 스캔 xeon/contracts-closed-object 실패 [제안]: additionalProperties 미지정
export const NoticeSchema: TObject<{ text: TString }> = Type.Object({ text: Type.String({ maxLength: 500 }) });
```

- [가정] `additionalProperties`를 지정하지 않은 `Value.Check`는 JSON Schema 기본 의미(추가 키 허용)를 따른다(eng-2 §6).

## 3. 강제 수단

### 3.1 contracts 전용 oxlint 설정

[제안] `.oxlintrc.json` `overrides`에 contracts 항목을 더한다. 설정 파일 소유는 `eng.toolchain.guide`다.

```jsonc
{
  "overrides": [
    {
      "files": ["packages/contracts/**"],
      "rules": {
        "no-restricted-properties": [
          "error",
          { "object": "Date", "property": "now", "message": "Inject Clock (eng.typescript.guide TY-21)." },
          { "object": "Math", "property": "random", "message": "Inject RandomSource (TY-21)." },
          { "object": "crypto", "property": "randomUUID", "message": "Use IdFactory (TY-21)." },
          { "object": "crypto", "property": "getRandomValues", "message": "Inject RandomSource (TY-21)." },
          { "object": "performance", "property": "now", "message": "Inject Clock (TY-21)." },
          { "object": "Value", "property": "Parse", "message": "Use parse() from @xeon/contracts (DT-05)." },
          { "object": "Value", "property": "Clean", "message": "Stored data is not modified (DT-11)." },
          { "object": "Value", "property": "Default", "message": "Fill defaults in an explicit pure function (DT-05)." }
        ]
      }
    }
  ]
}
```

- 같은 규칙의 override는 기본 목록을 대체한다고 보고 쓴다(`eng.dependency-rules.guide` 3.2절 [가정]). 그래서 contracts override는 `eng.typescript.guide` TY-21의 다섯 항목(`Date.now`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `performance.now`)을 DT 항목과 한 목록으로 합쳐 둔다. TY-21 목록을 바꾸면 이 목록도 같은 커밋에서 고친다.
- 모든 패키지: `no-restricted-imports`의 `patterns`에 `typebox/value`, `typebox/compile`을 더하고 contracts base와 pi 포크 경로만 `overrides`로 허용한다(DT-01).
- `no-restricted-properties`의 옵션 형식은 [미확인]이다(`eng.typescript.guide` 6절).
- oxlint에 `no-restricted-syntax`가 없으므로(`_research/notes/eng-1.md §2`) 구문 수준 검사는 스캔으로 한다.

### 3.2 스캔 규칙 (contracts 대상)

`eng.typescript.guide` 3.2절의 `scripts/check-ts-rules.ts`에 contracts 대상 규칙을 더한다 [제안].

| 규칙 | 검사 | 관련 |
|---|---|---|
| `xeon/contracts-annotated-schema` | `export const <이름> = Type.` 형태(주석 없음) 검출. tsc TS9010과 같은 대상이며 `isolatedDeclarations` 범위가 줄어도 남는다 | DT-03 |
| `xeon/contracts-bounded-string` | `Type.String(` 인자에 `maxLength`나 `pattern`이 없으면 실패. `Type.Array(` 인자에 `maxItems`가 없으면 실패 | DT-15 |
| `xeon/contracts-closed-object` | `Type.Object(` 두 번째 인자에 `additionalProperties`가 없으면 실패 | DT-17 |
| `xeon/contracts-no-date` | `Type.Date`, `Type.BigInt`, `Unsafe<Date>`, `format: "date-time"` 검출 | DT-14 |
| `xeon/contracts-discriminant` | 유니온 변형의 판별자 이름이 `type`·`kind` 밖이거나 변형마다 다르면 실패 | DT-07 |
| 서브패스 순서 | `check-layers.ts`가 `packages/contracts/src/<소스 디렉터리>/` 사이 import를 `F.readme` §3 순서 표로 검사 | DT-12 |

- 정규식 스캔은 여러 줄 호출에서 오탐·누락이 있다. 파서 선택은 `eng.typescript.guide` 6절 [미결]과 같다.

### 3.3 스키마-타입 일치 타입 테스트

[제안] `packages/contracts/test/types/*.test.ts`에 컴파일 시점 검사를 둔다. `tsc -b`가 테스트 파일도 검사하므로(`include: ["src", "test"]`) 불일치는 `just typecheck`에서 실패한다.

```ts
// packages/contracts/test/types/expect.ts
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export type Expect<T extends true> = T;
```

```ts
// packages/contracts/test/types/effect-exec.test.ts
import { test } from "bun:test";
import { type Equal, type Expect } from "./expect.ts";
import { type EffectExec } from "../../src/records/effects.ts";
import { type EffectId, type IdByPrefix, type IdPrefix } from "../../src/conversation/ids.ts";

type _EffectExec = Expect<
  Equal<
    EffectExec,
    {
      effectId: EffectId;
      startedAt: number;
    }
  >
>;
type _Prefixes = Expect<Equal<keyof IdByPrefix, IdPrefix>>;

test("type assertions compile", () => {});
```

- 타입 테스트가 확인하는 것: 공개 스키마마다 `Static` 결과가 F 스펙에 적힌 모양과 같다, 브랜드 ID가 `string`으로 넓어지지 않았다, `IdByPrefix`의 키와 `IdPrefix`가 일치한다, 열린 유니온의 `switch`가 좁히기를 유지한다(TY-14 예를 그대로 컴파일).
- `_` 접두 타입 별칭이 `noUnusedLocals`에 걸리는지는 [미확인]이다. 걸리면 `export type`으로 바꾼다.
- `TypeBox`가 붙이는 `readonly` 여부에 따라 기대 타입의 `readonly`를 맞춘다 [가정: 붙이지 않음].

### 3.4 공개 스키마 스냅샷과 호환성 검사

[제안]

- `packages/contracts/schema-snapshot/<서브패스>/<SchemaName>.json`: 공개 스키마마다 JSON Schema 직렬화 결과를 커밋한다. 생성은 `bun scripts/schema-snapshot.ts`(F plan의 작업)다.
- `scripts/check-schema-compat.ts`: 기준 브랜치(merge-base)의 스냅샷과 작업 트리의 스냅샷을 비교해 DT-09 표에 따라 판정한다.
  - 통과: 선택 필드 추가, 문자열 제약 완화, 새 스키마 추가, 새 `version` 스키마 추가(옛 버전 스키마 유지).
  - 실패: 같은 스키마에서 필수 필드 추가, 필드 삭제, 필드 타입 변경, `required` 목록 확대, 리터럴 값 삭제·추가(닫힌 유니온), 문자열 제약 강화, 옛 버전 스키마(`V<n>Schema`) 삭제·변경.
  - 판정 결과는 스키마 이름과 JSON Pointer 경로, 사유를 출력한다. 실패면 종료 코드 1.
- 스냅샷이 소스와 다르면(재생성 누락) 검사는 실패하고 `bun scripts/schema-snapshot.ts` 실행을 안내한다.
- `just verify`에 포함한다. 레시피 추가는 `eng.toolchain.guide`가 정한다.
- 의도적인 호환 깨짐(M0 이전 초기 설계 단계)은 PR 설명에 사유를 적고 `scripts/check-schema-compat.ts --accept <SchemaName>`으로 스냅샷을 갱신한다. M1 이후에는 이 옵션 사용에 리뷰어 승인이 필요하다.

### 3.5 PR 체크리스트 (스키마 변경)

- [ ] 새 스키마 export에 명시 타입 주석이 있다 (DT-03)
- [ ] 타입을 손으로 다시 쓰지 않고 `Static`으로 얻었다 (DT-02)
- [ ] 같은 버전에서 필드를 선택 필드로만 추가했다. 그 밖의 변경은 `version`을 올리고 업캐스터와 테스트를 더했다 (DT-09, DT-11)
- [ ] 옛 버전 스키마를 지우지 않았다 (DT-11)
- [ ] 새 유니온은 닫힘·열림을 정했고, 열린 유니온은 `x.`·`grp.` 접두 변형을 가진다 (DT-08)
- [ ] 판별자는 `type`(데이터) 또는 `kind`(오류) 하나다 (DT-07)
- [ ] 모든 문자열·배열에 상한이 있다 (DT-15)
- [ ] 시각은 `EpochMsSchema`다 (DT-14)
- [ ] 서브패스 import 방향이 `F.readme` §3 순서 표를 따른다 (DT-12)
- [ ] 스냅샷을 다시 만들었고 호환성 검사가 통과한다 (3.4절)
- [ ] 타입 테스트에 새 스키마의 기대 모양을 더했다 (3.3절)
- [ ] 와이어 DTO를 바꿨다면 프로토콜 버전 영향을 `F.wire-settings.spec` 기준으로 적었다 (DT-04, DT-10 규칙 5)

## 4. 예외와 승인 절차

- 줄 단위 예외 형식과 예외 목록 집계는 `eng.typescript.guide` 4.1절, 4.2절을 그대로 따른다.
- 스키마 호환성 검사의 `--accept`는 3.4절의 승인 절차를 따른다.
- pi-ai에서 그대로 가져오는 타입(`Message`, `AssistantMessageEvent`, `AgentToolResult`, `_research/packages.md §4.1` "그대로" 판정)은 DT-02의 "스키마 단일 원천" 예외다. F는 이 타입을 별칭 재수출하고 정확 버전으로 고정한다. 이 타입이 저장 형식에 들어가면 F가 같은 모양의 TypeBox 스키마를 두고 타입 테스트로 pi-ai 타입과의 일치를 검사한다 [제안].
- DT-17(닫힌 객체)의 예외: pi-ai 도구 매개변수 스키마처럼 외부 규약이 열린 객체를 요구하는 곳. 해당 줄에 예외 주석을 단다.

## 5. 수용 기준

- 스키마 변경 PR은 `scripts/check-schema-compat.ts`를 거친다. 테스트 `scripts/check-schema-compat.test.ts` [제안]가 아래 픽스처로 판정을 확인한다.
  - 선택 필드 추가: 통과
  - 필수 필드 추가: 실패
  - 필드 삭제: 실패
  - 필드 타입 변경(`TString` → `TInteger`): 실패
  - 닫힌 리터럴 유니온 값 추가: 실패
  - 문자열 `maxLength` 감소: 실패
  - 같은 kind의 새 `version` 스키마 추가(옛 스키마 유지): 통과
  - 옛 버전 스키마 삭제: 실패
- 2절의 나쁜 예 중 자동 검사가 적힌 것은 `eng.typescript.guide` 5절의 픽스처 방식으로 `xeon/scripts/fixtures/ts-rules/bad/DT-NN-<이름>.ts`에 두고 `just verify`에서 실패를 확인한다. 리뷰 전용 나쁜 예: DT-02, DT-04 첫 번째, DT-08 두 번째, DT-11, DT-16.
- 업캐스터마다 단위 테스트가 있다: 옛 버전 픽스처 입력이 현재 스키마로 `parse` 통과, 입력 객체 불변.
- `parse`는 실패할 때 throw하지 않고 `{ ok: false, error: { kind: "parse", ... } }`를 돌려준다. 입력 객체를 바꾸지 않는다(모르는 키가 있는 입력에 대해 확인).
- 열린 유니온 픽스처: `x.test.thing` 변형과 `grp.test.thing` 변형이 `parse`를 통과하고, 소비 함수(DT-08 좋은 예)가 throw 없이 `passThrough`를 부른다. `x.`·`grp.` 접두가 없는 모르는 값과 이전 판의 `_ext.test.thing`은 `parse`가 실패한다.

## 6. 미결 사항

- [미결] `isolatedDeclarations` 적용 범위: 공개 패키지만인지 전체인지. contracts가 공개 패키지인지에 달려 있다(DT-03, eng-2 §11).
- [미결] TypeBox 버전: pi가 고정한 1.3.27과 catalog의 1.4.2 중 무엇으로 통일할지, 두 버전 공존 시 스키마 값 호환(DT-01).
- [미결] 모르는 키의 처리: 닫힌 객체에서 실패시킬지, 이벤트 재생에서 보존·통과할지(DT-05, eng-2 §11).
- [미결] 와이어 직렬화에서 `Date`와 `bigint` 처리. 현재 제안은 정수 ms와 큰 정수의 10진 문자열(DT-14).
- [미결] 큰 payload의 blob 참조 기준 크기. `BlobRef` 모양은 `F.records.spec` §3.4(`{ type: "blob", sha256, size, mediaType }`)로 정해졌고, 기준 크기는 `eng.events.design` EV-04와 일치시킨다(DT-15).
- [미결] 열린 유니온에 F가 새 알려진 변형을 더할 때 와이어의 옛 클라이언트 처리. 버전 협상 방식(`F.wire-settings.spec`)이 정해지기 전까지 "금지, `version` 올림"(DT-09).
- [결정(잠정): review.decisions-2 U-03] `IdFactory` 구현(`createIdFactory`)은 F에 두지 않고 `platform-os`에 둔다. 스키마 도우미 `brandedId`는 두지 않는다(DT-06). ID 접두 표와 `requestId`의 브랜드 여부는 F 정본(`F.conversation.spec` §3.2, §3.5)으로 정리했다.
- 닫은 항목: F 서브패스 의존 순서(DT-12)는 `F.readme` §3 표로 정리했다.
- [미결] 설정 키 형식(DT-13)의 최종 확정. `F.wire-settings.spec`이 정한다.
- [미결] `Type.Optional`의 주석 타입 `TAddOptional`, `Type.Unsafe` 감싼 스키마의 `Compile` 호환, `isOpenVariant`의 `Extract` 좁히기 등 이 문서 예의 컴파일 확인. M0 contracts 타입 테스트로 확인한다.
- [미결] `_research/foundation-plan.md §2`의 `isolatedDeclarations` 문구 정정(DT-03).
