# Cordis 시그니처 대조 (arch-1)

- 작성일: 2026-10-21
- 대상: `xeon/vendor/cordis/src`(커밋 df4431e, `UPSTREAM.json` 기준, 표기 rc.11). 비교 대상은 npm `cordis@4.0.0-rc.11` 타르볼(`lib/`)과 upstream `packages/core/src`(df4431e).
- 목적: ADR-0002와 X 문서가 가정한 Cordis 형태(서비스 등록, 이벤트 emit·parallel·serial·bail·waterfall, dispose 정리)를 1차 소스로 대조한다.
- 원칙: 소스를 읽기만 했다. 내려받은 코드는 실행하지 않았다. 판정은 소스 읽기에 근거하며 테스트로 확인하지 않았다.
- 인용 표기: 파일명은 `xeon/vendor/cordis/src/` 기준으로 줄여 쓴다(예: `events.ts:104-107`). npm 판본은 `npm:lib/…`로 적는다.

## 0. 결론

- 맞는 부분: 서비스 등록(`provide`), 의존 선언(`inject`), 이벤트 5개 디스패치(`emit`·`parallel`·`serial`·`bail`·`waterfall`), 플러그인 dispose와 effect 정리는 소스에 존재하고 조사 문서(`ext-points.md §4.3`, `packages.md X-a~X-c`)의 기술과 맞는다. 이벤트 시그니처는 npm 판본과 vendored 판본이 같다.
- 맞지 않거나 주의가 필요한 부분은 다섯이다.
  - (a) `emit`에는 리스너 오류 격리가 없다.
  - (b) `bail`은 동기 전용이다. 0·빈 문자열·NaN도 결정으로 취급한다.
  - (c) 최상위 effect 정리는 순서 보장이 없다. 역순은 시작 순서일 뿐이다.
  - (d) 일반 `emit`은 격리되지 않는다. 모든 리스너가 받는다.
  - (e) `UPSTREAM.json`의 "4.0.0-rc.11"은 npm 배포본이 아니다. 같은 표기의 npm 타르볼과 소스가 다르다.
- ADR-0002와 X 문서 원문은 이 체크아웃에도 git 히스토리에도 없다. 따라서 "ADR이 가정한 시그니처"와의 직접 대조는 [미확인]이다. 대신 작업 지시가 명시한 형태와 조사 문서의 기술을 기준으로 대조했다.

## 1. 확인 범위와 방법

- 1차 소스: `xeon/vendor/cordis/src/*.ts` 9개 파일(커밋 df4431e).
- 교차 검증 1: upstream `packages/core/src` 9개 파일을 `gh api`로 같은 커밋에서 받아 비교했다. 9개 모두 바이트 단위로 같다. 이 확인으로 vendored 사본이 df4431e와 일치한다고 판정한다.
- 교차 검증 2: npm `cordis@4.0.0-rc.11` 타르볼의 `lib/*.d.ts`와 `lib/index.js`를 비교했다. 빌드 산출물이라 줄 번호는 `lib` 기준이다.
- 버전 흐름: `npm view cordis time`으로 rc.11 게시 시각(2026-10-14T04:20:22Z)을 확인했다. `gh api compare df4431e...main`에서 main이 df4431e보다 3커밋 앞이고 `packages/core/src` 변경은 `logger.ts` 1개뿐임을 확인했다.
- 저장소 확인: `docs/xeon/decisions/`와 `docs/xeon/X/`는 없다. `git log --all`에도 해당 경로가 없다. `xeon/packages/ext-host/src/index.ts`는 `export {}` 스텁이고, `xeon/packages`에는 Cordis를 import하는 코드가 없다.

## 2. 대조표

| 항목 | 기술 (출처) | Cordis 실제 (df4431e) | 판정 |
|---|---|---|---|
| Context 생성 | 조사 문서: 루트 Context가 "DI 루트로 보임 [미확인]" (`durable-and-search-facts.md §A-4`) | `constructor()`는 인자를 받지 않는다. 생성자가 Proxy 루트를 돌려준다 (`context.ts:36-49`). 파생은 `extend`(55), `isolate`(65), `intercept`(73). | 형태 확인. 루트에 설정 인자 없음 |
| 서비스 등록 | `provide` (`ext-points §4.3`, `service.ts:35`, `reflect.ts:202-237`) | `ctx.provide(name, value, check?)`가 effect 안에서 등록하고 disposer를 돌려준다 (`reflect.ts:202-238`). 클래스형은 `Service` 생성자가 `reflect.provide`를 호출한다 (`service.ts:20-36`). | 일치 |
| 등록 제약 | 기술 없음 | 같은 isolation에서 같은 이름을 두 번 등록하면 throw한다 (`reflect.ts:214-216`). 세 번째 인자 `check`는 소비 측 fiber마다 `_checkImpl`에서 평가되어 false면 그 fiber의 공급을 무효화한다 (`fiber.ts:369-381`). | 제약 추가 |
| 이름 규칙 | 기술 없음 | `_` 접두, 숫자 문자열, `then`, `prototype`은 프로퍼티 접근 경로에서 Proxy 검사를 건너뛴다 (`reflect.ts:27-38`, `94-97`). | 제약 추가 |
| 의존 선언·접근 | `inject` (`registry.ts:11`, `189-191`) | 플러그인이 `inject`에 선언한 이름만 `ctx.<name>`으로 접근된다. 선언하지 않고 접근하면 `cannot get property "x" without inject`가 던져진다 (`reflect.ts:103`, `105-120`). 루트 ctx는 검사 없이 통과한다 (`reflect.ts:113`). | 일치 |
| 공급자 교체 | X-c 토글 (`packages.md:286`) | 공급자가 사라지면 소비자 fiber의 epoch가 바뀌어 unload 후 reload된다 (`fiber.ts:383-412`, `reflect.ts:240-259`). 핫 스왑이 기본으로 제공된다. | 일치 |
| on·once | 등록과 자동 해제 (`ext-points §4.3`) | `on`은 `internal/listener` bail 훅을 거친 뒤 effect로 등록한다 (`events.ts:162-175`). disposer는 fiber unload 때 자동 실행된다. dispose 뒤 `on`은 `INACTIVE_EFFECT`를 던진다 (`fiber.ts:218-221`, `events.ts:168`). | 일치 |
| emit | 관찰 `tap` (`ext-points §5 안 1`) | 동기 호출. 리스너를 순서대로 실행한다. 리스너가 던지면 emit 호출자까지 전파되고 뒤 리스너는 실행되지 않는다 (`events.ts:104-107`). 반환된 Promise는 기다리지 않는다. | 불일치: 오류 격리 없음 |
| parallel | `tap`의 오류 격리 후보 | `Promise.allSettled`로 전원 실행한 뒤 실패가 있으면 `AggregateError`를 던진다 (`events.ts:95-102`). 호출자가 잡지 않으면 호출 지점까지 올라온다. | 부분 일치: 전원 실행은 보장, 격리는 호출자 책임 |
| serial | `first` (비동기) | 순차 `await`하고 첫 bail 값을 돌려준다 (`events.ts:109-115`). 리스너 오류는 호출자에게 전파된다. | 일치. 비동기 `first`에 쓸 내장 모드는 이것뿐이다 |
| bail | `first` (동기) | 동기 호출하고 첫 bail 값을 돌려준다 (`events.ts:117-123`). 리스너가 Promise를 돌려주면 그 Promise가 bail 값이 되고 기다리지 않는다. | 동기 전용. 비동기 리스너를 쓰면 안 된다 |
| bail 판정 규칙 | "반환 `{deny: reason}`" (`ext-points §5 안 1`) | `isBailed`는 `null`, `false`, `undefined`만 통과시킨다 (`events.ts:6-8`). 따라서 `0`, `''`, `NaN`도 결정으로 취급된다. | 주의 규칙 필요 |
| waterfall | `chain` (Koa형 next) | 마지막 인자가 terminal이다 (`events.ts:127`, `130`). 리스너는 `(...args, next)`를 받는다. `next`를 두 번 부르면 throw한다 (`events.ts:131-135`). 부르지 않으면 체인이 조용히 끊기고 검사가 없다. 동기 함수다. | 일치. 부르지 않는 실수는 런타임 검사가 없다 |
| thisArg·격리 | 기술 없음 | 첫 인자가 객체나 함수면 thisArg다 (`events.ts:77`). thisArg에 `symbols.filter`가 있으면 그 필터로 리스너를 고른다 (`events.ts:82-84`). 일반 `ctx.emit(name)`에는 thisArg가 없어 필터가 없다. 전역 전달이다. | 제약 추가 (§3) |
| 관찰 훅 | 기술 없음 | `internal/dispatch`는 리스너가 있을 때 모든 비내부 이벤트를 알린다 (`events.ts:79-81`). X의 추적 지점으로 쓸 수 있다. | 추가 가능 |
| 없는 모드 | `drive`(배타 임대), `post`(큐) | `DispatchMode`는 5개뿐이다 (`events.ts:14`). 배타와 큐 모드는 없다. `packages.md:99`의 "queue·exclusive만 자체"와 일치한다. | 자체 구현 |
| 플러그인 = fiber | `ext-points §4.3` | `ctx.plugin`과 `ctx.inject`는 fiber를 만들고 부모 effect에 등록한다 (`fiber.ts:164-171`, `193`, `registry.ts:189-213`). 부모 해제가 자식을 해제한다. `await fiber`는 로드 실패 시 throw한다 (`fiber.ts:481-487`, `registry.ts:209-211`). | 일치 |
| 정리 순서 1 | "dispose 정리" | `_unload`는 먼저 dependents가 모두 내려갈 때까지 대기한다 (`fiber.ts:449-451`). 그다음 해제 목록을 역순으로 꺼내 시작하고 (`fiber.ts:453-463`, `utils.ts:27-31`), 마지막에 committed를 해제한다 (`fiber.ts:465-469`). | 일치 (LIFO 시작) |
| 정리 순서 2 | 기술 없음 | 역순은 시작 순서다. 각 항목은 `await Promise.resolve()` 뒤에 시작하고 서로 기다리지 않는다 (`Promise.all`, `fiber.ts:453-463`). 한 `effect()` 안의 해제는 순차다 (`fiber.ts:278-292`). | 주의. 순서가 필요한 자원은 한 effect로 묶는다 |
| provide 해제 | 기술 없음 | disposer는 dependents가 0이 될 때까지 기다린 뒤 provision을 지운다 (`reflect.ts:222-236`). 공급자는 소비자보다 늦게 해제된다. | 일치 |
| 재시작·갱신 | X-c 토글 (`packages.md:286`) | `restart()`는 revision을 올려 reload한다 (`fiber.ts:489-495`). `update(config)`는 `internal/update` waterfall이고 리스너가 next를 부르지 않으면 재시작이 거부된다 (`fiber.ts:497-517`, `events.ts:62-69`). | 원시 연산으로 쓸 수 있다. 턴 경계 게이팅은 없다 |
| 설정 검증 | F5 설정 스키마 | `Config`는 Standard Schema여야 한다. 검증은 동기만 허용되고 비동기 결과는 TypeError다 (`fiber.ts:34-46`, `registry.ts:71`). | TypeBox 1.4 호환은 [미확인] |
| 타입 표기 | 기술 없음 | `provide`는 `() => void`로 선언되지만 실제로는 Promise를 돌려준다 (`reflect.ts:12-13` 대 `reflect.ts:202-237`, `fiber.ts:320-324`). `on`은 `() => boolean`으로 선언되지만 실제로는 undefined를 돌려준다 (`events.ts:29` 대 `events.ts:162-175`). | 타입 불일치 (§6) |

## 3. 격리 범위

- 일반 `emit`은 격리되지 않는다 (`events.ts:77`, `82-84`). 그룹마다 같은 이벤트 이름을 쓰면 모든 그룹이 받는다.
- 서비스는 `ctx.isolate(name)`으로 격리된다 (`context.ts:65-69`, `reflect.ts:211-212`). 다른 isolation에서는 같은 이름을 다시 provide할 수 있다. 같은 isolation에서는 하나만 가능하다.
- [제안] 그룹 간 협력은 서비스 호출로만 한다. 이벤트 이름에는 그룹 접두사를 붙인다. 격리가 필요한 지점은 thisArg 객체로 필터를 건다.
- [미결] 제2의 Helm이 같은 서비스 이름을 쓰면 충돌한다. 격리 정책(이벤트, 서비스 이름)을 X 문서가 정할지 결정이 필요하다.

## 4. 버전과 고정

- `UPSTREAM.json`: version "4.0.0-rc.11", commit df4431e(2026-10-16T07:37:19Z).
- npm rc.11 게시 시각은 2026-10-14T04:20:22Z다. 같은 표기가 게시본보다 뒤의 커밋에 붙어 있다.
- npm 타르볼과 vendored 소스의 차이:
  - Context 루트: `npm:lib/context.d.ts:12`의 `root: this` 대 `context.ts:10`의 `[symbols.root]: this`. 커밋 9aa1415("move ctx.root to ctx[Context.root]", 2026-10-14T14:11Z)에서 바뀌었다.
  - Service 설정 심볼: `npm:lib/service.d.ts`의 `symbols.config`, `resolveConfig` 대 `service.ts:53-70`의 `metadata`, `mergeIntercept`, `resolveIntercept`.
  - AggregateError: `npm:lib/index.js:738`은 메시지 없이 만든다. `events.ts:101`은 메시지를 붙인다.
- 이벤트 5모드, `provide`·`get`·`set`·`inject`·`plugin`·`effect`·`dispose`·`restart` 시그니처는 두 판본이 같다 (`npm:lib/events.d.ts`, `fiber.d.ts`, `reflect.d.ts`, `registry.d.ts`와 대조).
- main은 df4431e보다 3커밋 앞이다. `packages/core/src` 변경은 `logger.ts` 1개다.
- [제안] `UPSTREAM.json`의 version을 커밋 기준으로 고친다. 예: "4.0.0-rc.11 (df4431e, npm 게시 이후 커밋)". `AGENTS.md`는 vendor 코드 수정을 금지하지만 `UPSTREAM.json` 갱신은 허용한다.
- [결정] DI는 Cordis 하나로 한다 (`decisions-log.md` 2026-10-21 3차, `foundation-plan.md §1`). 고정 방식(커밋 vendoring)도 `foundation-plan.md §2`에서 정해져 있다.
- [미결] npm rc.11 배포본을 쓸지, df4431e를 계속 쓸지 정해야 한다. 두 판본의 차이 때문에 §2의 판정은 df4431e 기준이다. 판본을 바꾸면 이 표를 다시 확인해야 한다.
- [미확인] rc.0~rc.10의 시그니처는 조사하지 않았다.
- [미확인] `@cordisjs/plugin-loader`(npm peerDependency, rc.8 기준)는 vendored에 없다(`UPSTREAM.json`의 `notCopied`). X-a "그대로" 판정의 범위는 vendored 밖에 있다.

## 5. ADR-0002와 X 문서 대조 상태

- ADR-0002 원문은 확인하지 못했다. `docs/xeon/decisions/`가 없고 git 히스토리에도 없다. 저장소에서 확인되는 것은 `docs/xeon/_routing/routes.yaml:87`의 `adr.0002 # DI는 Cordis 하나` 한 줄뿐이다. 따라서 ADR이 가정한 정확한 형태는 [미확인]이다. ADR-0002의 [가정] 표지는 이 노트로 갱신할 수 있는지 작성자가 확인해야 한다.
- X 문서 원문도 없다(`docs/xeon/X/` 부재). 대조 기준은 다음과 같다.
  - 작업 지시가 명시한 형태: 서비스 등록, 이벤트 emit·parallel·serial·bail·waterfall, dispose 정리.
  - `_research/ext-points.md §4.3`, `§5 안 1`.
  - `_research/packages.md`의 X-a~X-c, L1-a, L3-a 행.
  - `_research/foundation-plan.md §2`, `§3`, `§7`.
- 확장 연산과 Cordis 대응:

| 확장 연산 | Cordis 대응 | 주의 |
|---|---|---|
| on tap | `emit` 또는 `parallel` | `emit`은 격리가 없다. `parallel`은 전원 실행 뒤 집계해 throw한다 |
| on first (동기) | `bail` | 비동기 리스너 금지. `isBailed` 규칙 적용 |
| on first (비동기) | `serial` | 순차 실행. 첫 bail 값을 돌려준다 |
| on chain | `waterfall` | 동기. next 누락 검사가 없다. 비동기는 리스너가 await한다 |
| post | 없음 | 자체 큐 (`packages.md:143`과 일치) |
| drive | 없음 | 배타 임대 모드 없음 (`events.ts:14`). 자체 구현 |
| scope | `Fiber.effect`와 fiber dispose (`fiber.ts:273-338`) | 일치. 정리 순서는 §2 "정리 순서 2" 참조 |

- [제안] ext-host는 Cordis의 `emit`과 `bail`을 직접 노출하지 않고 래퍼로 감싼다.
  - `tap`: 리스너마다 try/catch를 두고 실패를 기록한다.
  - `first`: 동기 리스너면 `bail`, 비동기면 `serial`을 쓴다.
  - `chain`: next 호출 횟수 검사를 래퍼가 맡는다.
- [제안] 0·빈 문자열·NaN 결정 규칙을 F4 계약에 명시하거나, 래퍼가 `{deny}` 객체만 결정으로 취급한다.

## 6. 타입 표기 주의

- `provide`의 반환 disposer는 선언이 `() => void`이지만 실제로는 Promise다. `await dispose()`를 쓰려면 래퍼에서 타입을 고쳐야 한다.
- `on`의 반환 disposer는 선언이 `() => boolean`이지만 실제로는 undefined다.
- 두 항목은 ext-host 래퍼 뒤에 숨기는 것이 맞다. `foundation-plan.md §7`의 "ext-host 뒤에 숨긴다"와 일치한다.

## 7. 미확인 목록

- [미확인] ADR-0002 본문과 X 문서의 "가정한 형태". 저장소에 원문이 없다.
- [미확인] TypeBox 1.4가 Standard Schema의 `~standard` 속성을 구현하는지. `Config` 검증에 필요하다.
- [미확인] rc.0~rc.10의 시그니처. df4431e 이후 main의 3커밋 중 `logger.ts` 변경의 내용은 읽지 않았다.
- [미확인] 커밋 5dac695("settle disposed fibers to DISPOSED", #133)와 bc9a344("stop service lookup at isolation boundaries", #209)의 내용. 제목만 확인했고 npm 판본과의 차이를 소스로 대조하지 않았다.
- [미확인] 실행 동작. 정리 순서와 오류 전파는 테스트로 확인하지 않았다. 판정은 소스 읽기다. [제안] ext-host 테스트에 이 항목을 넣는다.
- [미확인] `@cordisjs/plugin-loader`의 동작과 채택 여부.

## 8. 미결 사항

- [미결] vendor 고정 기준을 df4431e로 둘지, npm rc.11로 바꿀지.
- [미결] 그룹 간 이벤트 격리 정책. 전역 전달로 둘지, 그룹 필터를 기본으로 둘지.
- [미결] ADR-0002의 [가정] 표지를 "df4431e에서 확인"으로 바꿀지, ADR 본문을 이 노트 기준으로 다시 쓸지. ADR 원문이 저장소에 없으므로 작성자 확인이 필요하다.
- [미결] `Config` 검증에 쓸 스키마 라이브러리(TypeBox 1.4)가 Standard Schema를 구현하는지 확인한 뒤 F5 설정 스키마 방식을 확정할지.
