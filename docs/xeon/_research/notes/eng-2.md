---
id: xeon.research.eng-2
layer: meta
domain: research
kind: guide
status: draft
depends_on: []
binds: []
---

# 조사 노트 eng-2: TypeBox 1.4와 isolatedDeclarations

조사일 2026-10-21. 정본 아님. 엔지니어링 구속 문서(`eng.*`)와 F 계약 스펙을 쓸 때 근거로 인용한다.

## 1. 질문과 결론

질문: TypeBox 1.4(패키지 `typebox`)에서 `isolatedDeclarations`를 켠 상태로 `export const X = Type.Object({...})`가 컴파일되는가. 안 되면 명시 타입 주석 패턴과 팩토리 패턴 중 무엇이 현실적인가. 함께 import 경로, Static 추출 이름, Value.Parse·Check 오류 형태, 브랜드 타입 표현을 확인한다.

결론 요약:

- 근거: `isolatedDeclarations`를 켠 파일에서 `export const X = Type.Object({...})`는 컴파일 오류다. 오류 코드는 9010, 메시지는 "Variable must have an explicit type annotation with --isolatedDeclarations."이다. 근거는 TypeScript 5.9.3 소스의 추론 경로, TypeScript 7.0.2 네이티브 바이너리의 메시지 문자열, TypeScript 5.5 릴리스 노트다(§3-1).
- [제안] 명시 타입 주석 `export const X: TObject<{...}> = Type.Object({...})`이 현실적이다. 팩토리 함수도 명시 반환 타입이 필요하므로(코드 9007) 주석 부담이 같고 이득이 없다. `as` 단언은 오류를 피하지만 검사가 약하다(§3-3).
- [가정] 주석 부담은 optional, union, enum, 배열 속성에서 커진다. 주석에 쓸 타입 이름이 `TAddOptional`, `TUnion<[...]>`, `TEnum<[...]>`처럼 추론 결과와 정확히 맞아야 한다(§3-4).
- [제안] `isolatedDeclarations`는 d.ts를 외부 도구로 생성하는 공개 패키지에만 켠다. 내부 패키지는 주석 부담을 질 이유가 없다(§3-5).
- import 경로, `Static`, `Value.Parse`·`Check`·`Errors` 오류 형태는 1.4.2 소스로 확인했다(§4~§6). 브랜드 타입은 TypeBox에 기능이 없으므로 `Type.Unsafe`와 `Type.Refine`을 조합한다(§7).
- [미확인] 컴파일과 실행 검증은 하지 않았다. 내려받은 패키지를 실행하지 않는다는 제약에 따라 소스 독해와 공식 문서로만 확인했다. 모든 "컴파일된다" 판단은 소스 근거에 따른 추정이다.

## 2. 자료와 방법

| 자료 | 버전과 위치 | 확인한 내용 |
|---|---|---|
| TypeBox 패키지 | npm `typebox@1.4.2`(latest). tarball `https://registry.npmjs.org/typebox/-/typebox-1.4.2.tgz`, integrity `sha512-eSoZ...` | `package.json` exports, `build/**/*.d.mts`, `readme.md` |
| TypeBox 1.3.27 | npm `typebox@1.3.27`(pi 고정 버전) | 진입점 구조 비교(`build/index.d.mts`, exports 맵) |
| TypeBox GitHub readme | `https://raw.githubusercontent.com/sinclairzx81/typebox/main/readme.md` | npm readme와 파일 크기 19,291바이트로 같음 |
| TypeScript 5.9.3 | npm tarball, `package/lib/typescript.js` (JS 소스) | isolatedDeclarations 추론 경로와 메시지 정의 |
| TypeScript 7.0.2 | `@typescript/typescript-linux-x64@7.0.2`, `package/lib/tsc`(네이티브 바이너리) | 메시지 문자열 존재만 확인. 로직은 읽지 않음 |
| TypeScript 공식 문서 | `https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html` (Isolated Declarations 절), `https://www.typescriptlang.org/tsconfig/isolatedDeclarations.html` | 규칙 취지와 예외(타입 단언) |
| pi 소스 | `/home/user/projects/_ref/pi-src/` (읽기만) | TypeBox 사용 패턴. 이하 `pi-src/...`로 줄여 쓴다 |
| stack-status | `docs/xeon/_research/stack-status.md` §2, §8 | TS 7 프로그램 API 부재, TypeBox 미확인 항목 |

방법 제약: 내려받은 패키지는 tar로 풀어 읽기만 했다. `tsc`, `bun`, 샘플 빌드는 실행하지 않았다. 바이너리는 문자열 검색(`grep -a`)만 했다.

## 3. isolatedDeclarations와 스키마 export

### 3-1. 규칙 (TypeScript 소스)

- 옵션 전제: `isolatedDeclarations`는 `declaration` 또는 `composite`와 함께 써야 한다(TS 5.9.3 `lib/typescript.js:129098-129103`).
- 메시지 정의: 변수 9010(`lib/typescript.js:11062`), 함수 반환 타입 9007(`lib/typescript.js:11059`). TS 7.0.2 네이티브 바이너리에도 같은 메시지 문자열과 `..._9010` 키가 있다.
- 오류 발생 경로: 변수 선언의 타입은 다음 순서로 정한다(`typeFromVariable`, `lib/typescript.js:138177-138200`).
  1. 명시 타입 주석이 있으면 그 주석을 재사용한다.
  2. 주석이 없고 초기화식이 있으면 `typeFromExpression`으로 구문만 보고 타입을 만든다.
  3. 둘 다 실패하면 `inferTypeOfDeclaration`이 `reportInferenceFallback`을 호출한다(`lib/typescript.js:138264-138271`). `isolatedDeclarations`가 켜져 있으면 9010 오류를 낸다(`lib/typescript.js:118580-118588`). 변수 노드에는 `createVariableOrPropertyError`가 9010을 매핑한다(`lib/typescript.js:118436-118440`).
- 구문만으로 처리하는 초기화식(`typeFromExpression`, `lib/typescript.js:138321-138398`): 괄호식, `undefined`, `null`, 화살표·함수식, 단항 리터럴, 배열·객체 리터럴, 템플릿 문자열, 원시 리터럴, 그리고 `as T`와 `<T>x`(const 단언 제외).
- 구문으로 처리하지 못하는 식은 `failed`를 반환한다(`lib/typescript.js:137591-137593`). 호출식(`Type.Object(...)`)과 `satisfies` 식(SyntaxKind 239)이 여기에 해당한다. `satisfies`는 처리 목록에 없으므로 `satisfies`만으로는 주석을 대신할 수 없다(목록 부재에 따른 판단).
- 공식 문서 근거: TypeScript 5.5 릴리스 노트는 `export function z() { return Math.max(x, y()) as number; }`가 타입 단언 때문에 오류가 없다고 밝힌다. 단언이 없는 같은 호출은 오류다. 로컬 변수(공개되지 않은 선언)는 검사 대상이 아니다.
- 공개되지 않은 로컬 선언이라도 공개 타입이 `typeof`로 참조하면 d.ts에 포함되어 같은 검사를 받는다. [가정: 실행 미검증. 변수 선언 경로에서 같은 함수가 호출되므로 근거는 있다.]

판정: `export const X = Type.Object({...})`는 `isolatedDeclarations`를 켜면 9010 오류다(TS 5.9.3 소스 근거). TS 7.0.2는 메시지 문자열만 확인했고 로직은 [미확인]이다.

### 3-2. TypeBox 쪽 확인

- `Type.Object`는 `_Object_<Properties extends TProperties>(properties: Properties, options?): TObject<Properties>`로 선언되고 `Object`라는 이름으로 내보낸다(`typebox@1.4.2:build/type/types/object.d.mts`).
- 반환 타입은 인자 객체 리터럴에서 추론된 `Properties`에 의존한다. 이 추론은 타입 검사기가 해야 하므로 구문 경로로는 얻을 수 없다. 결과가 §3-1의 9010 오류다.

### 3-3. 패턴 비교

| 패턴 | 예 | isolatedDeclarations | 장점 | 단점 |
|---|---|---|---|---|
| 명시 타입 주석 | `export const User: TObject<{ id: TString }> = Type.Object({ id: Type.String() });` | 통과(주석 재사용) | 검사기가 주석과 값의 일치를 확인한다 | 속성마다 타입을 다시 적는다 |
| `as` 단언 | `export const User = Type.Object({...}) as TObject<{ id: TString }>;` | 통과(TS 5.5 예와 같은 형태) | 짧다 | 단언은 느슨한 대응만 검사한다. 불일치가 숨겨질 수 있다 |
| 팩토리 함수 | `export function userSchema(): TObject<{ id: TString }> { return Type.Object({...}); }` | 함수도 명시 반환 타입이 필요하다(9007) | 생성 시점을 늦출 수 있다 | 주석 부담이 같다. 이득이 없다 |
| `satisfies` | `export const User = Type.Object({...}) satisfies TObject<...>;` | 오류 9010(처리 목록에 없음) | 없음 | 쓸 수 없다 |
| 비공개 스키마와 `Static`만 내보내기 | `const User = Type.Object({...}); export type User = Static<typeof User>;` | 오류 가능성 높음(§3-1 마지막 항목) [가정] | 없음 | 쓸 수 없다 [가정] |

### 3-4. 주석 부담이 큰 곳 (TypeBox 1.4.2 시그니처)

- Optional: `Optional<Type>(type): TAddOptional<Type>`(`typebox@1.4.2:build/type/types/_optional.d.mts`). 주석은 `TAddOptional<TString>`처럼 적어야 한다. `TOptional<T>`는 `T & {'~optional': true}`로 선언이 다르므로 같은 타입으로 보면 안 된다(선언 비교, 호환성은 [미확인]). `TAddOptional`은 `type/action/index.d.mts:3`을 거쳐 최상위에서 내보내진다.
- Union: `Union<Types extends TSchema[]>(anyOf: [...Types]): TUnion<Types>`. 주석은 `TUnion<[TString, TNumber]>`처럼 튜플로 적는다.
- Enum: `Enum<Values extends TEnumValue[]>(values: readonly [...Values]): TEnum<Values>`. 주석은 `TEnum<["a", "b"]>`로 적는다. [미확인: 실제 추론 결과가 튜플 리터럴인지 컴파일로 확인하지 않음.]
- Literal, Array: `TLiteral<'x'>`, `TArray<TString>`처럼 적는다.
- 주석이 추론 결과와 다르면 `:` 주석 패턴에서는 TS2322 오류가 나므로 드러난다. `as` 패턴에서는 드러나지 않을 수 있다.

### 3-5. 현실적 결론

- [제안] 기본 패턴은 명시 타입 주석이다. 팩토리는 채택하지 않는다.
- [제안] `isolatedDeclarations`는 d.ts를 외부 도구로 만드는 공개 패키지에만 켠다. 근거는 다음과 같다.
  - foundation-plan §2는 내부 패키지가 TS 소스를 그대로 export한다고 정한다. 내부 패키지에는 d.ts가 필요 없다.
  - stack-status §2는 TypeScript 7.0에 프로그램 API가 없다고 정리한다. TS API에 기대는 d.ts 도구는 7.0 기준으로 쓰기 어렵고([가정]), `isolatedDeclarations`를 켜면 TS API 없이 d.ts를 만들 수 있다. 그 이득은 공개 패키지를 외부 도구로 빌드할 때 생긴다.
- [제안] foundation-plan §2의 표현 "isolatedDeclarations 덕분에 d.ts 생성에 TS API가 필요 없다"는 정정이 필요하다. 정정안은 "isolatedDeclarations를 켜면 TS API 없이 d.ts를 만들 수 있으나, 공개 export마다 명시 타입 주석이 필요하다"이다.
- [미결] F 계약 패키지(`contracts`)가 공개 패키지인지. 공개 릴리스 시점과 범위에 따라 달라진다(decisions-log 2026-10-19 "나중에 공개 릴리즈 예정").

## 4. import 경로 (typebox 1.4.2)

| 경로 | 내보내기 | 근거 |
|---|---|---|
| `typebox` | 이름 `Type`(네임스페이스, `export * as Type`), 기본 내보내기 동일, 최상위 타입 다수 | `build/index.d.mts`, `build/index.mjs`. exports `"."`는 `./build/index.mjs` |
| `typebox/value` | 이름 `Value`(네임스페이스), 기본 내보내기 동일 | `build/value/index.d.mts`, exports `./value` |
| `typebox/compile` | `Compile`, `Code`, `Validator`(이름), 기본 내보내기 `Compile` | `build/compile/index.d.mts`, exports `./compile` |
| `typebox/error` | `TLocalizedValidationError` 등 오류 타입 | `build/error/errors.d.mts`, exports `./error` |
| `typebox/schema` | readme 예시(`Schema.Compile(Type.Script(...))`)에 쓰이는 진입점 | exports `./schema`. 기능 범위는 [미확인] |

- 최상위 `typebox`에서 타입을 직접 가져올 수 있다. `Static`, `StaticDecode`, `StaticEncode`, `StaticParse`, `TObject`, `TString`, `TUnsafe`, `TAddOptional` 등이 해당한다(`build/type/types/index.d.mts:35`의 `export * from './static.mjs'`, `build/typebox.d.mts:59`, `build/type/types/index.d.mts`).
- pi 사용 예: `pi-src/packages/ai/src/utils/validation.ts:1-3`은 `typebox/compile`, `typebox/error`, `typebox/value`를 쓰고, `pi-src/packages/ai/src/index.ts:1-2`는 `Static`, `TSchema`, `Type`을 최상위에서 가져온다.
- 타입 전용 import는 `import type`으로 쓴다. foundation-plan의 `verbatimModuleSyntax`와 맞는다. pi 소스도 같은 관행을 쓴다(`pi-src/packages/agent/src/types.ts:17`).
- ESM 전용이다(readme "Versions" 절, `package.json` `"type": "module"`). Bun 1.4 환경과 맞는다.
- 버전 비교: 1.3.27(pi 고정, `pi-src/packages/ai/package.json:79`, `pi-src/packages/agent/package.json:27`)과 1.4.2의 진입점 구조는 같다(`index.d.mts`, exports 맵 비교). 세부 API 차이는 [미확인].

## 5. Static 타입 추출

- 이름은 `Static`이다. 최상위와 `Type.Static` 두 경로가 있다(`build/type/types/static.d.mts:45`, `build/typebox.d.mts:59`).
- 정의: `Static<Type, Context = {}, Result = StaticType<[], 'Encode', Context, {}, Type>>`. 기본 방향이 `'Encode'`다.
- 방향 변형: `StaticDecode`(Decode 방향), `StaticEncode`(Encode 방향), `StaticParse`(Parse 방향, 기본 Encode). 코덱이 없는 스키마에서는 방향이 결과에 영향을 주지 않는다([가정: `_codec.d.mts`의 분기 구조 근거]).
- pi 사용 패턴: `pi-src/packages/ai/src/providers/model-schema.ts:85-91`, `export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;`.
- 주의: `TObject`를 주석에 인자 없이 쓰면 `Properties`가 `TProperties` 기본값이 되어 정적 타입이 넓어진다(기본값 근거: `build/type/types/object.d.mts`, `TObject<Properties extends TProperties = TProperties>`).

## 6. Value.Parse, Check, Errors의 오류 형태

| 함수 | 시그니처 | 실패 시 동작 | 근거 |
|---|---|---|---|
| `Value.Check(type, value)` | `value is Static<Type>` (boolean 타입 가드) | `false` 반환. 던지지 않음 | `build/value/check/check.d.mts`, `check.mjs`(스키마 엔진 `SchemaCheck`에 위임) |
| `Value.Errors(type, value)` | `TLocalizedValidationError[]` | 빈 배열이면 통과 | `build/value/errors/errors.d.mts` |
| `Value.Parse(type, value)` | `StaticParse<Type>` | `ParseError` 던짐 | `build/value/parse/parse.mjs` |

- `ParseError`는 `AssertError`를 상속하고 `AssertError`는 `Error`를 상속한다(`build/value/assert/assert.mjs`). `error.message`는 고정 문자열 `'Parse'`다. 세부는 `error.cause`에 있다: `{ source: 'Parse', errors: TLocalizedValidationError[], value }`.
- 각 `TLocalizedValidationError`는 `keyword`, `schemaPath`, `instancePath`, `params`, `message`를 가진다(`build/error/errors.d.mts`).
- `Value.Parse` 파이프라인은 Clone, Default, Convert, Clean, Assert 순서다(`build/value/parse/parse.mjs`, `Parser`). 따라서 다음이 성립한다.
  - 입력을 복제하므로 원본은 바뀌지 않는다.
  - 기본값을 채우고 타입을 강제 변환한다(Convert).
  - 스키마에 없는 키를 지운다. `additionalProperties`가 `true`나 스키마가 아니면 `delete value[key]`가 실행된다(`build/value/clean/from_object.mjs`, `unknownCheck`). 이벤트 재생에서 알 수 없는 키가 조용히 사라진다는 뜻이다.
- `Value.Check`는 정리와 변환을 하지 않는다. 추가 키를 막을지는 `additionalProperties` 설정에 따른다. 미지정 시 JSON Schema 기본 의미를 따른다([가정: 실행 미검증]).
- 컴파일된 검증기: `Compile(type)`는 `Validator`를 준다. 메서드는 `Check`, `Parse`(실패 시 던짐), `Errors`, `Clean`, `Convert`, `Decode`, `Encode`다(`build/compile/validator.d.mts`). pi는 `Compile`, `Check`, `Errors`를 쓴다(`pi-src/packages/ai/src/utils/validation.ts:277, 320-343`).
- 정제(refinement)는 `Value.Check`에서도 실행된다. `value/check/check.mjs`가 스키마 엔진 `SchemaCheck`에 위임하고, 엔진에 `~refine` 처리기가 있다(`build/schema/engine/_refine.mjs`).

## 7. 브랜드 타입

- TypeBox 1.4.2에는 브랜드 기능이 없다. `build` 아래 `.d.mts` 전체에서 `brand` 문자열 검색 결과가 0건이다.
- `Type.Refine`은 검사만 추가하고 정적 타입을 바꾸지 않는다. `TRefineAdd<Type> = Type & {'~refine': ...}`이므로 `Static`은 그대로 `string`이다(`build/type/types/_refine.d.mts`). 따라서 `Refine`만으로는 브랜드가 되지 않는다.
- `Type.Unsafe<T>(schema)`는 `TUnsafe<T>`를 만들고 `StaticUnsafe<T> = T`다(`build/type/types/unsafe.d.mts`). 정적 타입을 임의로 지정할 수 있다. 런타임 검사는 감싼 스키마로 하므로 브랜드 자체는 검사하지 않는다.
- [제안] 브랜드는 세 조각으로 만든다. (1) `Type.Unsafe<Brand>`로 정적 타입을 지정한다. (2) `Type.Refine`으로 런타임 검사를 더한다. (3) 값을 받는 생성 함수 하나만 타입 단언을 쓴다.

```ts
// [미확인: 컴파일과 실행 검증 없음]
import { Type, type Static, type TUnsafe } from "typebox";
import { Value } from "typebox/value";

declare const userIdBrand: unique symbol;
export type UserId = string & { readonly [userIdBrand]: true };

export const UserIdSchema: TUnsafe<UserId> = Type.Unsafe<UserId>(
  Type.Refine(Type.String({ minLength: 1 }), (v) => v.startsWith("u_"), () => "invalid user id"),
);

export function toUserId(input: unknown): UserId {
  if (!Value.Check(UserIdSchema, input)) throw new Error("invalid user id");
  return input as UserId;
}
```

- `declare const ... : unique symbol`은 런타임 코드를 만들지 않으므로 `erasableSyntaxOnly`와 맞는다([가정: 일반 규칙]).

## 8. 명시 주석 패턴의 최소 예

```ts
// [미확인: 컴파일 검증 없음. 형태는 §3-1, §3-4 소스 근거에 따른다]
import { Type, type Static, type TObject, type TString } from "typebox";

export const UserSchema: TObject<{ id: TString; name: TString }> = Type.Object({
  id: Type.String(),
  name: Type.String(),
});
export type User = Static<typeof UserSchema>;
```

- 금지 형태: `export const UserSchema = Type.Object({ id: Type.String() });`는 9010 오류다.

## 9. stack-status.md 보완 제안

- §8 "1.0 breaking [미확인]": readme "Versions" 절에 따르면 1.x는 TS 6.0~7.0+를 대상으로 하고 ESM 전용이며 TS 7 네이티브 컴파일러를 기준으로 개발되었다. 0.x는 LTS로 ESM과 CJS를 모두 지원한다. 상세 이주 가이드는 찾지 못했으므로 [미확인]으로 남긴다.
- §8 "npm 최신 1.4.2 (publish 날짜 메타데이터 없음)": 레지스트리에서 1.4.2가 latest로 조회되고 서명 정보가 있다. 날짜는 여전히 없다.
- §2 "programmatic API: 7.0에는 API가 없다": 이 사실이 isolatedDeclarations 판단의 전제다(§3-5).

## 10. 미확인 항목

- [미확인] TypeScript 5.9와 7.0에서 `export const X = Type.Object(...)`의 실제 컴파일 결과. 실행 검증하지 않았다.
- [미확인] TS 7.0.2 Go 구현의 추론 로직이 5.9 JS와 같은지. 메시지 문자열만 확인했다.
- [미확인] `TAddOptional`, `TUnion`, `TEnum` 등 주석 타입과 추론 결과의 정확한 일치. 튜플 추론 형태 포함.
- [미확인] `Type.Unsafe`로 감싼 스키마의 `Check`와 `Compile` 호환. §7 샘플은 실행하지 않았다.
- [미확인] `typebox/schema` 진입점의 기능 범위와 `Compile`과의 관계.
- [미확인] 1.3.27과 1.4.2 사이 세부 API 차이. 진입점 구조만 비교했다.
- [미확인] `Value.Check`의 추가 키 처리 여부(JSON Schema 기본 의미를 따른다고 추정).
- [미확인] TypeBox 1.x 이주 가이드.

## 11. 미결 사항

- [미결] 스키마 패키지에 `isolatedDeclarations`를 적용할 범위: 공개 패키지만인지, 전체인지.
- [미결] pi가 고정한 TypeBox 1.3.27과 foundation-plan §2가 정한 1.4.2 중 무엇을 쓸지. 1.4.2로 올리면 pi 포크 코드의 호환을 따로 확인해야 한다.
- [미결] 이벤트 스키마에서 알 수 없는 키를 `Value.Parse`로 지울지, 보존할지. 전방 호환과 재생 규칙에 직접 영향을 준다(§6).
- [미결] foundation-plan §2의 "isolatedDeclarations 덕분에 d.ts 생성에 TS API가 필요 없다" 문구를 §3-5의 정정안으로 바꿀지.
