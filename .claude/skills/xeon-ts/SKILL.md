---
name: xeon-ts
description: xeon/ 워크스페이스의 TypeScript 코드를 쓰거나 고치거나 리뷰할 때 쓴다. as 단언, 비null 단언, any, ts 억제 주석, 예상 가능한 실패의 Bug throw, 오류를 삼키는 catch를 막는 구속 규칙을 따르게 한다.
---

# Xeon TypeScript 구속 규칙

정본은 `docs/xeon/engineering/typescript/guide.md`(eng.typescript.guide)다. 코드를 쓰기 전에 1.3절 체크리스트와 아래 규칙 본문을 읽는다. 판정이 애매하면 규칙 본문이 우선한다.

## 금지

1. `as` 단언: `x as T`, `x as unknown as T`, `<T>x`, `JSON.parse(s) as T`, `{} as T`. `as const`만 허용. 예외는 TY-06 허용 목록(A1 `parse` 구현, A2 브랜드 생성 함수, A3 타입 키 레지스트리 조회 [제안]) 위치뿐이다.
2. 비null 단언 `!` (TY-07). `undefined` 분기를 쓰고 없으면 `Result`로 돌려준다.
3. `any` (TY-02). 외부 `any`는 받는 즉시 `const v: unknown = ...`.
4. `@ts-ignore`, `@ts-nocheck`. `@ts-expect-error`는 테스트 파일의 타입 테스트에서만 이유를 달아 쓴다 (TY-08).
5. 반환 타입에만 나오는 타입 매개변수(`function load<T>(): T`), 판별자만 보고 전체 모양을 약속하는 손 타입 가드, `Function` 타입 (TY-23, AP-C-10).
6. 예상 가능한 실패를 `throw`하거나 `Bug`로 던지기 (TY-11, TY-24, AP-C-11).
7. 오류를 조용히 삼키는 `catch`: 빈 `catch`, 바인딩 없는 `catch`, `void caught`, `.catch(() => undefined)`, 실패를 기본값으로 바꾸는 반환 (TY-25, AP-C-02).
8. 검사를 끄거나 설정을 바꿔 통과시키기, `--no-verify` (TC-07).

## 대신 쓰는 것

- 경계 값(파일, DB, 와이어, 모델 출력, 확장 페이로드, 환경 변수): `unknown`으로 받아 `parse(Schema, value)`로 검증한다. 타입은 런타임에 지워지므로 타입 선언은 검증이 아니다 (TY-10, DT-05).
- 변형 고르기: 판별자 비교와 `switch` + `default: assertNever(x, "where")` (TY-13, TY-14).
- 리터럴 모양 확인: `satisfies`. 빈 컨테이너: 변수 타입 주석.
- `unknown` 오류에서 필드 하나: 그 필드만 검사하는 작은 타입 가드(`hasErrnoCode`).
- 브랜드 ID: `IdFactory.next(prefix)` 또는 `parse(XxxIdSchema, s)` (TY-09).
- 예상 가능한 실패(I/O, busy, disk_full, read_only, cancelled, not_found, 검증 실패, ownership_lost, timeout, 손상): `Result<T, E>`, `E`는 `kind` 판별 유니온 (TY-11, TY-12, TY-24). 하위 `Result` 실패는 그대로 또는 자기 유니온 변형으로 위로 돌려준다.
- `Bug`: 불변 조건 위반(도달 불가 분기, 닫힌 상태에서 호출, 계약 위반)에만. 판정 질문: "코드와 설정이 올바라도 일어날 수 있는가?" 그렇다면 `Bug`가 아니다.
- `catch`: 실패할 수 있는 호출 하나만 감싸고, (1) `cause`를 담은 오류 값으로 변환, (2) 근거 문서가 있는 자리에서만 주입된 Logger로 기록 후 계속, (3) `throw caught` 중 하나를 한다.
- 테스트: 예상 가능한 실패는 `result.error.kind`로 확인한다. `toThrow(Bug)`는 버그 경로에만.

## 예외 주석

- 형식: `// oxlint-disable-next-line <규칙> -- <이유> (<이슈 URL>)`. 미리 허용된 위치는 URL 대신 `(<문서 id> <규칙 ID>)`. 예: `// oxlint-disable-next-line typescript/consistent-type-assertions -- 허용 목록 A2 브랜드 생성 (eng.typescript.guide TY-06)`.
- 허용 목록 밖에서 단언이나 억제가 꼭 필요해 보이면 주석을 달지 말고 작업 보고에 `[미결] TY-NN <파일:줄> <이유>`로 적는다.

## 강제 수단

oxlint 규칙 목록은 eng.typescript.guide 3.1.1절, 스캔(`xeon/as-location`, `xeon/catch-swallow`, `xeon/bug-for-expected` 등)은 3.2절이다. 끝내기 전에 `just verify`를 통과시킨다.
