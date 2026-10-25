---
id: adr.0002
layer: adr
domain: di
kind: adr
status: accepted
depends_on: [adr.0001]
binds: [xeon/vendor/cordis/**, xeon/packages/ext-host/**]
---

# ADR-0002 단일 DI: Cordis 하나, ext-host 뒤에 둔다

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] "DI는 Cordis 하나"(`_research/decisions-log.md` 2026-10-21 결정(3차), `_research/foundation-plan.md §1` 표 1번). 고정 방식은 `_research/foundation-plan.md §2` DI·플러그인 행("Cordis 4.0.0-rc.x를 `xeon/vendor/cordis`에 커밋 고정")이다.
- 개정: 2026-10-21 `review.decisions-2` U-01(§3 6번 적용 시점을 단계 경계로 읽음), U-17(§3 4번 하위 층의 `@xeon/ext-host` import 범위). 보충이라 같은 ADR 안에서 고쳤다(`adr.readme` §1.4). 두 항목은 사용자 확인을 거친 [결정]이다(2026-10-22).
- 개정: 2026-10-25 마일스톤 재점검 G5-03(§4 감수할 점 [가정]의 TypeBox 판 표기를 1.4에서 1.3.27로 정정). 값 정정이라 같은 ADR 안에서 고쳤다.

## 2. 맥락

- 2026-10-19에 확장 호스트 후보로 Cordis core가 제시됐다. 조건은 npm 4.0.0-rc.11, API 불안정, 커밋 고정 vendoring 전제다(`_research/decisions-log.md` 2026-10-19).
- 런타임에는 서비스 등록·주입과 플러그인 수명(켜기·끄기·정리)이 필요하다. 층 사이 협력도 서비스로 한다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 1·5).
- 재사용 후보 코드가 각자 다른 DI를 쓴다.
  - pi durable은 Chord를 쓴다. Chord는 플러그인·서비스·복제 상태·Context를 제공하며 Cordis와 같은 계층이라 기능이 겹친다(`_research/packages.md §1.1` chord 행). pi durable을 그대로 가져오면 DI가 둘이 된다(`_research/packages.md §3` B안).
  - opencode v2의 이벤트 소싱·투영은 Effect/Layer에 묶여 있다. `session/projector.ts`만 `Effect.` 호출이 77회이고 `bus.ts`는 105회다(`_research/packages.md §2.4`). import할 수 없다.
- pi durable의 env·tools 범위가 쓰는 Chord `Context`는 `{ readonly abortSignal }` 하나를 담는 취소 토큰이다. durable 소스에서 Chord의 service/inject/provide/facet API 사용은 0건이다(`_research/durable-and-search-facts.md §A-2`). 그래서 이 범위는 Chord 없이 포크할 수 있다(ADR-0003).
- 이 결정 시점에 저장소 안에는 Cordis 의존이나 채택 결정이 없었다. Cordis를 DI로 전제한 곳은 조사 문서뿐이었다(`_research/durable-and-search-facts.md §A-5`).
- 그 뒤 P0에서 `xeon/vendor/cordis`가 들어왔다. `UPSTREAM.json`은 커밋 `df4431e`, 표기 "4.0.0-rc.11", 수정 없음(`"modifications": "none"`), 사용처 `xeon/packages/ext-host only`를 기록한다. vendored 9개 파일은 upstream `packages/core/src`(df4431e)와 바이트 단위로 같다(`_research/notes/arch-1.md §1`).

## 3. 결정

1. [결정] 서비스 등록, 주입, 플러그인 수명(dispose)은 Cordis 하나로 통일한다. 다른 DI 컨테이너(Chord, Effect Layer, 자체 컨테이너)를 들이지 않는다(`_research/decisions-log.md` 3차).
2. [결정] Cordis는 `xeon/vendor/cordis`에 4.0.0-rc.x 커밋 고정으로 둔다. 현재 고정 커밋은 `df4431eb43086bd1f8263a0e8c03e9b7c5233b68`이다. vendored 소스는 고치지 않고, 갱신은 새 upstream 커밋에서 다시 복사하고 `UPSTREAM.json`에 기록하는 방식으로만 한다(`xeon/vendor/cordis/UPSTREAM.json`, `_research/foundation-plan.md §2`, `§7`).
3. [결정] Cordis는 ext-host(X 층) 뒤에 숨긴다(`_research/foundation-plan.md §7` "vendored로 고정하고 ext-host 뒤에 숨긴다").
4. [제안] `cordis`를 직접 import할 수 있는 패키지는 `xeon/packages/ext-host` 하나다. 다른 패키지는 ext-host가 노출하는 얇은 서비스·플러그인 API와 on·post·drive·scope 4연산(ADR-0007)만 쓴다. 이 API의 이름과 시그니처는 `X.primitives.spec`, `X.loading-trust.spec`이 정한다.
   - 강제 수단 [제안]: oxlint `no-restricted-imports`로 `cordis`와 `cordis/*`를 금지하고 ext-host만 예외로 둔다. dependency-cruiser에도 같은 규칙을 둔다. 세부는 `eng.dependency-rules.guide`가 정한다.

     ```ts
     // 좋은 예: L2 패키지 (ext-host가 다시 내보낸 API만 사용)
     import type { ScopeHandle } from "@xeon/ext-host";
     // 나쁜 예: L2 패키지가 Cordis를 직접 사용
     import { Context } from "cordis";
     ```

     위 예의 `@xeon/ext-host` 패키지 이름과 `ScopeHandle` 타입 이름은 설명용이다. 실제 이름은 X 스펙이 정한다.
   - [결정: review.decisions-2 U-17] X보다 위 층의 구현 패키지(L0~L2)가 `@xeon/ext-host`를 import하는 것은 `eng.dependency-rules.guide` DR-14의 예외로 허용한다. 범위는 서비스 등록·주입 API뿐이다. 4연산 API는 L3 `group-kit`이 쓴다. 다른 구현 패키지의 import는 계속 금지다.
5. [결정] 층 사이 협력은 F 정의 + Cordis 서비스로만 한다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 1, `_research/foundation-plan.md §3` 패키지 의존 규칙). 같은 층 패키지끼리 import하지 않는다.
6. [결정] 켜기·끄기는 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에서 적용하고 정리는 Cordis dispose로 실행한다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 5. 원문 표기 "턴 경계"를 단계 경계로 읽는 것은 [결정: review.decisions-2 U-01], ADR-0007 §3.6).
7. [결정] 연동 규칙: pi durable의 `Context`는 DI 기능이 없는 취소 토큰(`abortSignal` 전달)이다. 포크할 때 로컬 타입 `CancelScope`로 치환한다. Cordis의 `Context`(DI 루트)와 이름이 겹치므로 포크 코드에 Cordis `Context`를 들이지 않는다(`_research/durable-and-search-facts.md §A-4` 이름 충돌 주의). 정의와 위치는 ADR-0003이 정한다.

### 3.1 Cordis 원시 연산과 4연산의 대응

df4431e 소스 읽기로 확인한 대응이다(`_research/notes/arch-1.md §2`, `§5`). 실행 테스트는 하지 않았다.

| 확장 연산(ADR-0007) | Cordis 대응 | 주의 |
|---|---|---|
| on tap | `emit` 또는 `parallel` | `emit`은 리스너 오류를 격리하지 않는다(`events.ts:104-107`). `parallel`은 전원 실행 뒤 `AggregateError`를 던진다 |
| on first(동기) | `bail` | 동기 전용이다. `isBailed`는 `null`·`false`·`undefined`만 통과시키므로 `0`·`''`·`NaN`도 결정으로 취급된다(`events.ts:6-8`, `117-123`) |
| on first(비동기) | `serial` | 순차 `await`, 첫 bail 값 반환(`events.ts:109-115`) |
| on chain | `waterfall` | 동기. `next` 두 번 호출은 throw, 호출 누락은 검사하지 않는다(`events.ts:127-135`) |
| post | 없음 | 자체 큐로 구현한다(`_research/packages.md §2.5`) |
| drive | 없음 | `DispatchMode`는 5개뿐이다(`events.ts:14`). 배타 임대는 자체 구현한다 |
| scope | fiber `effect`와 dispose(`fiber.ts:273-338`) | 최상위 effect 해제는 역순으로 시작하지만 서로 기다리지 않는다(`fiber.ts:453-463`). 순서가 필요한 자원은 한 effect로 묶는다 |

- [제안] 위 주의점은 ext-host 래퍼가 흡수한다. tap은 리스너마다 오류를 잡아 기록하고, first는 명시적 결정 객체만 결정으로 취급하고, chain은 `next` 호출 횟수를 검사한다. 확정은 `X.primitives.spec`과 `F.extensions.spec`이 한다.

## 4. 결과

### 4.1 좋은 점

- DI가 하나다. 서비스 조회, 의존 선언, 수명 정리가 한 모델로 설명된다.
- 플러그인 수명과 scope 정리가 Cordis dispose와 직결된다. `on`으로 등록한 리스너와 `provide`로 등록한 서비스는 fiber effect로 추적되어 플러그인 dispose 때 자동 해제된다(`_research/ext-points.md §4.3`, `_research/notes/arch-1.md §2` on·once, provide 해제 행). 공급자는 소비자가 모두 내려간 뒤 해제된다(`reflect.ts:222-236`).
- on의 fold 3종(tap/first/chain)이 Cordis 디스패치 `emit`·`parallel`, `serial`·`bail`, `waterfall`에 대응한다(`_research/ext-points.md §4.3`). 새로 구현할 것은 post 큐와 drive 임대뿐이다.
- 의존 선언이 접근 권한 검사를 겸한다. `inject`에 선언하지 않은 서비스에 접근하면 오류가 난다(`reflect.ts:103-120`). 그룹 사이 숨은 결합을 실행 시점에 드러낸다.
- 공급자가 사라지면 소비자 fiber가 내려갔다 다시 올라온다(`fiber.ts:383-412`). provider 교체(핫 스왑)를 따로 만들지 않는다.
- Cordis 의존은 2개(cosmokit, `@standard-schema/spec`)이고 코어는 약 1.9k줄이다(`_research/packages.md §1.2`). vendored 유지 범위가 작다.

### 4.2 감수할 점

- rc 버전이다. README가 "API is not yet stable"이라고 적는다(`_research/packages.md §1.2`). upstream API가 바뀌면 vendored 사본을 손으로 갱신하고 ext-host 래퍼를 맞춰야 한다.
- 버전 표기가 어긋난다. `UPSTREAM.json`의 "4.0.0-rc.11"은 npm rc.11 게시(2026-10-14T04:20:22Z)보다 뒤의 커밋(df4431e, 2026-10-16)이다. Context 루트 표기(`root` 대 `[symbols.root]`), Service 설정 심볼, `AggregateError` 메시지가 npm 판본과 다르다. 이벤트 5모드와 `provide`·`inject`·`plugin`·`effect`·`dispose`·`restart` 시그니처는 두 판본이 같다(`_research/notes/arch-1.md §4`).
- 선언 타입과 실제 동작이 다른 곳이 있다. `provide`의 disposer는 `() => void`로 선언되지만 Promise를 돌려주고, `on`의 disposer는 `() => boolean`으로 선언되지만 undefined를 돌려준다(`_research/notes/arch-1.md §6`). 래퍼에서 타입을 바로잡는다.
- 일반 `emit`은 전역으로 전달된다. 그룹마다 같은 이벤트 이름을 쓰면 모든 그룹이 받는다(`_research/notes/arch-1.md §3`). 이벤트 이름 규칙이나 필터가 필요하다.
- [가정] `provide`·`inject`·이벤트 디스패치·dispose의 JS 시그니처와 정리 순서는 df4431e 소스 읽기로 확인했고 실행으로 확인하지 않았다(`_research/notes/arch-1.md §7`). ext-host 단위 테스트에서 확인한다.
- [가정] `Config` 검증은 Standard Schema를 요구한다(`fiber.ts:34-46`). TypeBox 1.3.27(ADR-0001 §3, `review.decisions-2` U-24)이 `~standard` 속성을 구현하는지는 확인하지 않았다(`_research/notes/arch-1.md §7`).
- Effect·Chord 기반 코드를 그대로 재사용할 수 없다. opencode v2 투영은 표 모양과 리듀서 논리만 읽기 자료로 쓰고(`_research/packages.md §2.4`), pi durable의 Harness·Session·scheduler는 포크하지 않는다(ADR-0003).
- `@cordisjs/plugin-loader`는 vendored에 없다(`UPSTREAM.json` `notCopied`). 설정 파일 기반 플러그인 로딩은 ext-host가 직접 구현하거나 따로 들여야 한다(`X.loading-trust.spec`).

## 5. 대안

| 대안 | 내용 | 채택하지 않은 이유 |
|---|---|---|
| Chord 채택 | pi durable 전체를 포크하고 Chord를 DI로 쓴다 | 사용자 결정(Cordis 하나)과 맞지 않는다. Cordis 확장 호스트와 함께 쓰면 이중 DI가 된다. Chord 8.8k줄과 durable 23k줄 유지 부담이 붙는다(`_research/packages.md §3` B안) |
| Effect/Layer | opencode v2 방식의 서비스·효과 시스템 | projector 843줄에 `Effect.` 77회, bus 914줄에 105회로 결합이 깊어 포크 부담이 크다. Cordis와 이중 DI가 된다(`_research/packages.md §2.4`) |
| 자체 경량 DI 컨테이너 | 맵 기반 등록·조회 + 수동 정리 | 플러그인 수명, 의존 기반 재시작, effect 해제 트리를 다시 만들어야 한다. Cordis가 이미 제공한다(`_research/packages.md §2.5` 범위 트리 행) |
| 수동 생성자 주입 | 조립 코드가 모든 의존을 생성자로 넘긴다 | 런타임 중 플러그인·그룹 켜기·끄기와 provider 교체를 표현할 수 없다. 사용자가 층별 플러그인을 추가·교체하는 요구(`_research/decisions-log.md` 2026-10-21 배포 단위 정정)와 맞지 않는다 |
| npm `cordis@4.0.0-rc.11` 의존 | vendoring 대신 npm 정확 고정 | rc 사이 API 변경을 lockfile만으로 통제하기 어렵고, 소스를 저장소에서 읽을 수 없다. vendoring은 고정 커밋 소스를 저장소에 두어 리뷰와 대조가 가능하다. 다만 현재 vendored 커밋이 npm rc.11과 다르다는 점은 §6 미결로 남긴다 |

## 6. 미결 사항

- [미결] Cordis rc API 변경 대응, 곧 고정 커밋 갱신 정책. 갱신 주기(정기 대 필요할 때), 갱신 조건(보안 수정, 필요한 기능), 갱신 절차(재복사 → `UPSTREAM.json` 기록 → ext-host 테스트 → 시그니처 대조표 재확인)를 정해야 한다. [제안] 필요할 때만 갱신하고, 갱신마다 `_research/notes/arch-1.md §2` 대조표를 다시 확인한다.
- [미결] vendor 고정 기준을 df4431e로 유지할지, npm rc.11 배포본 소스로 바꿀지(`_research/notes/arch-1.md §8`). [제안] df4431e를 유지하고 `UPSTREAM.json`의 version 표기를 "4.0.0-rc.11 이후 커밋(df4431e)"처럼 고친다.
- [미결] 그룹 간 이벤트·서비스 이름 격리 정책. 전역 전달을 그대로 둘지, 그룹 접두사나 thisArg 필터를 기본으로 둘지, `ctx.isolate`를 그룹 단위로 쓸지(`_research/notes/arch-1.md §3`). `X.primitives.spec`에서 정한다.
- [미결] F5 설정 스키마(TypeBox 1.3.27)를 Cordis `Config`(Standard Schema) 검증에 바로 쓸 수 있는지. 안 되면 ext-host가 변환 어댑터를 둔다.
- [미결] 설정 파일 기반 플러그인 로딩에 `@cordisjs/plugin-loader`를 들일지, ext-host가 자체 구현할지.
