---
id: adr.0010
layer: adr
domain: desktop-frontend-state
kind: adr
status: accepted
depends_on: [adr.0008, adr.0001]
binds: [xeon/apps/desktop/**]
---

# ADR-0010 데스크톱 프런트엔드: React 19와 Zustand 5

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-24
- [결정] 데스크톱 WebView UI는 React 19와 Zustand 5로 만든다(사용자 지시 2026-10-24, "zustand 채택"). React 19는 같은 날의 상태 관리 조사가 전제로 둔 결정이다(`L4/desktop/_research/state-management.md §1`).
- [결정] `@preact/signals-react`(Preact + signals 계열)는 예측 가능성 기준으로 제외한다(같은 조사 §8).
- 이 ADR은 `L4.desktop.spec` §4.12의 [제안](Preact + `@preact/signals`)을 대체하고 §10 미결 11을 닫는다.

## 2. 맥락

- UI는 엔진이 보내는 순서 있는 이벤트 열을 화면에 옮긴다. 내구 이벤트는 `events.batch`(seq 있음), 토큰 델타는 `stream.chunk`(휘발, 조각 번호 `n`)로 온다(`F.wire-settings.spec` §3.3.2, §3.4). 모델 문장 하나가 작은 델타 수백 개로 나뉘어 item 하나에 쌓인다.
- 화면 영역은 스레드 목록, 트랜스크립트, 입력창, 상태 표시줄, 승인 대기열, 설정이다(`L4.desktop.spec` §4.13).
- 코드 규칙: TypeScript 7(tsgo) strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `as`·`!`·`any` 금지(`eng.typescript.guide` TY-02, TY-06, TY-07), 경계 값은 TypeBox로 검증(TY-10), 시험은 `bun test`이고 DOM 없이 돈다(`eng.testing.guide` TS-01).
- 조사 결과(`L4/desktop/_research/state-management.md`):
  - Zustand 5.0.16은 gzip 490 B이고 의존성이 없다. 훅은 `useSyncExternalStore` 위에 선택자 결과를 `Object.is`로 비교한다(§4, §5).
  - 항목별 선택자는 그 항목 문자열이 바뀔 때만 재렌더한다. 대신 델타마다 `items` 레코드를 불변 복사하면 O(N)이다. V8에서 N=1,000이면 0.28 ms, N=10,000이면 3.5 ms다(§7.2).
  - React Compiler에 대한 Zustand의 공식 진술은 없고 비호환 보고도 없다(§5).
  - `useSyncExternalStore` 갱신은 Transition으로 표시할 수 없다(§7.1).
- 2026-10-24 스파이크(저장소 밖, `L4.desktop.design` §12 코드 골격): Zustand 5.0.16 타입 정의와 `@types/react` 19.3.0으로 거울 스토어, 파이프라인, 훅, 컴포넌트를 tsgo 7.0.2와 저장소 oxlint 설정으로 검사해 오류 0건을 확인했다. Bun 1.4.3(JavaScriptCore)에서 스트리밍 슬롯 방식의 델타 1건 비용은 transcript item 1,000~50,000개에서 0.5~1.3 µs로 N과 무관했고, 같은 환경에서 레코드 복사 방식은 N=10,000에서 585 µs였다 [참고 측정].

## 3. 결정

### 3.1 라이브러리와 버전

1. [결정] UI 프레임워크는 React 19다. 착수 시점 버전은 `react` 19.3.1이다(조사 §3).
2. [결정] 전역 상태 라이브러리는 Zustand 5다. 착수 시점 버전은 `zustand` 5.0.16이다(조사 §3).
3. [제안] 세 패키지(`react`, `react-dom`, `zustand`)는 `xeon/package.json` catalog에 정확 버전으로 고정한다(`eng.toolchain.guide`의 버전 고정 규칙). 타입은 `@types/react`, `@types/react-dom`을 같은 방식으로 고정한다.
4. [제안] 빌드는 `bun build`(JSX 내장 변환)를 유지한다. 새 빌드 도구를 들이지 않는다.
5. [제안] React Compiler는 M2에 넣지 않는다. 컴파일러는 Babel 플러그인(`babel-plugin-react-compiler` 1.0.0)이라 `bun build`만으로는 적용되지 않는다(조사 §3). 코드는 Rules of React를 지켜 나중에 켤 수 있게 둔다(`eng.frontend-state.guide` FS-20).

### 3.2 상태 구조

[제안] 전역 상태의 구조와 규칙은 `eng.frontend-state.guide`(구속)와 `L4.desktop.design`(데스크톱 상태 모델)이 정한다. 요점은 다음과 같다.

1. 전역 스토어는 엔진 거울(engine mirror) 하나와 UI 로컬 스토어로 한정한다.
2. 엔진 거울의 변경은 순수 함수 `reduceMirror` 하나에서만 일어나고, 입력은 연결 컨트롤러가 넣는 `MirrorInput`뿐이다.
3. 쓰기 경로의 미들웨어는 reducer를 감싸는 단계 세 개(journal → guard → invariants)다. Zustand 미들웨어(devtools, persist, immer, subscribeWithSelector)는 쓰지 않는다.
4. 토큰 델타는 확정 item과 분리된 스트리밍 슬롯에 쌓고 프레임마다 한 번 커밋한다. 확정 기록(`item.recorded`)이 오면 그 item의 슬롯을 지운다.

### 3.3 의존 소유

[제안] `react`, `react-dom`, `zustand`는 `apps/desktop`만 import한다. `eng.dependency-rules.guide` DR-07 표에 행을 더한다. 앱 안에서 `zustand`를 import할 수 있는 파일은 `eng.frontend-state.guide` FS-06이 더 좁힌다.

## 4. 결과

### 4.1 좋은 점

- 상태 라이브러리 자체가 작다(490 B gzip). 쓰기는 `setState` 한 곳으로 모이고 갱신 규칙이 명시적이다.
- 상태 논리가 순수 reducer에 있어 `bun test`로 DOM 없이 시험한다. 같은 이벤트 열을 다시 넣으면 같은 상태가 나온다.
- React 19의 생태계(가상 스크롤, 접근성 부품, 개발 도구)를 쓸 수 있다.
- 타입 정의 기준으로 거울 스토어와 훅에 `as`가 필요 없다. 공식 미들웨어 예제가 기대는 단언(`as unknown as`, `selector!`)을 쓰지 않는 구조다(`eng.frontend-state.guide` §1.3).

### 4.2 감수할 점

- 런타임이 Preact보다 크다. [가정] `react` + `react-dom` 19의 클라이언트 번들은 gzip 수십 KB 규모다. 로컬 자산이라 전송 비용은 없지만 WebView 메모리 예산(`L4.desktop.spec` §4.10 B1)에 들어가므로 S5 측정에서 확인한다.
- 델타마다 레코드를 복사하는 단순한 상태 모양은 항목 수에 비례해 느려진다. 스트리밍 슬롯 분리(§3.2 4)를 처음부터 넣어야 한다.
- React Compiler에 대한 공식 보장이 없다. 켜려면 빌드 경로를 바꾸고 재렌더를 측정해야 한다.
- 외부 스토어 갱신은 Transition이 되지 않는다. 델타 빈도는 스토어 입력 쪽(프레임 단위 커밋)에서 줄인다.
- Zustand에는 이벤트 타입, 로그, 재생 기능이 없다. 판별 유니온, `assertNever`, 링 버퍼 기록을 직접 쓴다.
- Redux DevTools 연동을 쓰지 않는다. 대신 journal과 진단 내보내기, WebView 개발자 도구를 쓴다(`eng.frontend-state.guide` FS-11).

## 5. 대안

| 대안 | 판정 | 이유 |
|---|---|---|
| Preact + `@preact/signals` | 제외 | 빌드 변환이 필수이고, 변환이 일부 부품을 놓칠 수 있다고 README가 적는다. React의 비공개 요소 표식(`$$typeof`)을 흉내 내고 JSX 팩토리를 감싼다(조사 §8). 갱신 경로가 암묵적이라 예측 가능성 기준에 맞지 않는다 |
| XState Store 4.3 | 2순위, 채택 안 함 | `on` 전이와 타입 이벤트가 이벤트 로그와 가장 잘 맞는다. 5.0 alpha가 4.3.0과 같은 날 시작되어 메이저 전환 위험이 있다(조사 §3, §10). 전이 모양은 순수 reducer와 판별 유니온으로 얻는다 |
| Redux Toolkit 2.13 + react-redux 9.3 | 채택 안 함 | 가장 성숙하다. 14.5 KB + 3.8 KB gzip이고, "action type union을 피하라"는 공식 권고가 판별 유니온 입력 설계와 어긋난다. 개발 빌드의 깊은 검사와 Immer 복사 비용이 있다(조사 §5, §9) |
| TanStack Store 0.11 | 채택 안 함 | API는 단순하다. 0.x이고 0.10.0과 0.11.0이 7일 간격으로 나왔다. 라이브러리 타입 시험이 TS 5.6~5.9만 명시한다(조사 §3, §10) |
| MobX 7 + mobx-react-lite 5 | 제외 | React 공식 문서가 `observer`를 memoization 가정을 깨는 사례로 든다(`incompatible-library` 린트 문서). 자동 추적이라 갱신 경로가 암묵적이다(조사 §5) |
| Legend-State 3 beta | 제외 | stable이 2024년 2.1.15이고 v3는 beta다. Compiler 관련 open 이슈 #477, #653이 갱신 누락을 보고한다(조사 §5) |
| Jotai 3, Valtio 2 | 보류 | atom 그래프나 프록시 추적이 엔진 이벤트 열을 순서대로 적용하는 모델과 맞지 않는다. Valtio는 `useTransition`과 함께 쓸 때 de-opt 경고가 있다(조사 §9) |
| React 내장 + 직접 작성 스토어 | 채택 안 함 | 의존성이 0이다. 구독 목록, 선택자 비교, 시험을 직접 써야 하고 Zustand가 같은 일을 490 B로 한다(조사 §9) |

## 6. 미결 사항

- [미결] React Compiler 도입 시점과 빌드 경로(Babel을 거치는 번들러가 필요한지).
- [미결] WebKitGTK(Linux)와 WKWebView(macOS)에서 프레임 커밋 1회 비용과 메모리. 스파이크 수치는 Bun의 JavaScriptCore 값이고 WebView 값이 아니다. S5 측정 항목으로 넘긴다.
- [가정] `react` + `react-dom` 번들 크기는 재지 않았다.
- [미결] 상태 구조가 F에 요구하는 메서드(열린 thread 스냅샷, 대기 승인 목록)는 `L4.desktop.design` §14에 모았다.
