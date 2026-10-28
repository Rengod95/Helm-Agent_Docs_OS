# 데스크톱 UI 상태 관리 라이브러리 비교

정본이 아닙니다. 조사 원자료이며 인용 형식은 `L4/desktop/_research/state-management.md §절`입니다. 이 조사 뒤 사용자가 React 19 + Zustand 5를 결정했습니다(adr.0010, 2026-10-24). 상태 구조의 정본은 `eng.frontend-state.guide`와 `L4.desktop.design`입니다. 아래 §1 마지막 항목의 스펙 갱신은 같은 날 `L4.desktop.spec` §4.12에 반영했습니다.

기준일: 2026-10-24. 대상: Xeon 데스크톱 앱 (Tauri 2, React 19, Bun 1.4, TypeScript 7 strict, `as`·`!`·`any` 금지).

## 1. 결론

- 1순위: **Zustand 5.0.16**. 가장 작고, 갱신이 명시적이며, 순수 reducer를 얹기 쉽습니다. 스케치는 타입 정의 기준으로 단언 없이 성립합니다 (§12). 단, 항목 수가 1,000개 안팎을 넘으면 델타마다 `items` 레코드를 복사하는 비용이 눈에 띕니다 (§7.2). 스트리밍 중인 항목을 별도 필드로 분리하는 변형을 함께 채택하는 것을 권합니다.
- 2순위: **XState Store** (`@xstate/store` 4.3.0 + `@xstate/store-react` 2.1.0). 전이(`on`)가 엔진 이벤트 로그와 가장 잘 맞습니다. `@xstate/store-react`가 `@xstate/store`를 의존성으로 가져오고 `createStore`도 다시 내보내므로 설치 대상은 사실상 한 패키지입니다. 5.0 alpha가 진행 중이라 메이저 전환 위험이 있습니다.
- 3순위: **TanStack Store** (0.11.2). 선택자 API는 단순하고 `compare` 옵션이 있습니다. 아직 0.x이며, 0.10.0과 0.11.0이 7일 간격으로 나왔습니다 (§3). 보수적인 대안이 필요하면 RTK가 이 자리와 바뀔 수 있습니다 (§10).
- 제외: **@preact/signals-react**. 예측 가능성 기준에서 제외합니다 (§8).
- 주의: `docs/xeon/L4/desktop/spec.md` §4.12의 [제안]은 Preact + `@preact/signals`입니다. 이 문서의 React 19 결정과 다릅니다. 스펙 갱신이 필요합니다. 이번 작업은 저장소를 수정하지 않았습니다.

## 2. 조사 방법과 근거 등급

- npm 레지스트리 (`registry.npmjs.org`): 버전, dist-tag, 릴리스 시각, peer 의존성, `peerDependenciesMeta`. 2026-10-24 조회.
- 레지스트리 tarball: 타입 정의(`.d.ts`)와 소스, README, CHANGELOG를 별도 디렉터리에 풀어 읽기만 했습니다. 설치와 실행은 하지 않았습니다.
- bundlephobia API: min·gzip 크기. 2026-10-24 재조회하여 아래 수치가 모두 일치했습니다.
- 공식 문서와 소스: WebFetch로 읽었습니다. 404나 리디렉션이 난 페이지는 리디렉션 대상을 다시 읽거나, 근거로 쓰지 않았습니다.
- GitHub 이슈 검색 (`gh search issues`): 각 저장소에서 "react compiler", "babel-plugin-react-compiler", "React Forget"를 검색했습니다.
- 복사 비용 측정: 패키지를 쓰지 않는 순수 JS 스크립트입니다 (§7.2).
- `bun test`, `just verify`, 패키지 설치와 실행은 하지 않았습니다 (§11).
- 근거 등급: **[검증]** 공식 문서, 소스, 타입 정의, CHANGELOG를 직접 읽음. **[2차]** 검색 요약, 제3자 자료, 제작자 블로그. **[구조]** API 형태에서 나온 추론. **[참고 측정]** 이 환경에서 돌린 마이크로벤치. **[미확인]** 찾지 못함.

## 3. 후보 버전과 릴리스 (npm, 2026-10-24, 전 항목 재조회)

| 패키지 | latest | 최근 릴리스 | 라이선스 | 메모 |
|---|---|---|---|---|
| zustand | 5.0.16 | 2026-10-22 | MIT | 5.0.15 08-13, 5.0.14 05-28, 5.0.13 05-05. 1~3개월 간격 |
| jotai | 3.0.1 | 2026-09-29 | MIT | 3.0.0은 2026-09-08. React 18+, TypeScript 5.5+, Node 22.12+ 요구, ESM 전용 [검증: 마이그레이션 가이드] |
| valtio | 2.3.2 | 2026-05-01 | MIT | 2026-01-01, 03-03, 05-01에 릴리스. 마지막 릴리스가 약 6개월 전 |
| mobx | 7.1.0 | 2026-10-20 | MIT | 7.0.4~7.0.6이 2026-09-22, 09-25, 10-02에 릴리스 |
| mobx-react-lite | 5.1.0 | 2026-09-24 | MIT | MobX 7 전용 (peer `mobx ^7`, `react ^18 \|\| ^19`) |
| @legendapp/state | 2.1.15 (stable) | 2024-08-30 | MIT | v3는 beta.48 (2026-07-12). stable이 2년 전 |
| @reduxjs/toolkit | 2.13.0 | 2026-09-29 | MIT | 2.12.0은 2026-05-15 |
| react-redux | 9.3.0 | 2026-05-15 | MIT | 9.4.0-alpha.2가 2026-09-29 |
| @tanstack/store | 0.11.2 | 2026-09-29 | MIT | 0.x. 0.10.0은 04-10, 0.11.0은 04-17. 1.0 미출시 |
| @tanstack/react-store | 0.11.2 | 2026-09-29 | MIT | 1.0.0-alpha.0은 2026-10-10 |
| @xstate/store | 4.3.0 | 2026-10-08 | MIT | 5.0.0-alpha.8 (2026-10-17). 4.3.0과 같은 날 5.0.0-alpha.6 |
| @xstate/store-react | 2.1.0 | 2026-10-08 | MIT | 의존성 `@xstate/store ^4.3.0`. 2.1.0-alpha.4가 10-14 |
| @preact/signals-react | 3.12.0 | 2026-08-04 | MIT | 제외 후보 |
| react | 19.3.1 | 2026-10-14 | MIT | |
| babel-plugin-react-compiler | 1.0.0 | 2025-10-07 | MIT | 1.0.0이 마지막 stable. 이후 experimental만 (최신 2026-05-08) |
| eslint-plugin-react-hooks | 7.1.1 | 2026-04-17 | MIT | Compiler 관련 린트 규칙 포함 [2차] |
| typescript | 7.0.2 | 2026-07-08 | Apache-2.0 | 7.1.0-beta가 2026-10-20 |
| bun | 1.4.4 | 2026-10-22 | MIT | |
| jotai-family | 1.1.0 | 2026-07-29 | | `atomFamily`의 이전 위치 |

## 4. 번들 크기 (bundlephobia, 2026-10-24, 전 항목 재조회 일치)

| 패키지 | min | gzip | 의존성 수 | peer |
|---|---|---|---|---|
| zustand 5.0.16 | 833 B | 490 B | 0 | react, @types/react, immer, use-sync-external-store. 모두 optional [검증: `peerDependenciesMeta`] |
| jotai 3.0.1 | 7,961 B | 3,329 B | 0 | react >=18, @types/react (optional) |
| valtio 2.3.2 | 6,140 B | 2,567 B | 1 (proxy-compare) | react >=18, @types/react (optional) |
| mobx 7.1.0 | 52,958 B | 15,049 B | 0 | |
| mobx-react-lite 5.1.0 | 4,861 B | 1,847 B | 0 | mobx ^7, react ^18·^19 |
| @legendapp/state 2.1.15 | 17,313 B | 6,732 B | 1 | react >=16.8 |
| @legendapp/state 3.0.0-beta.48 | 28,951 B | 10,874 B | 1 (자기 자신으로 표시됨) | beta. bundlephobia가 peer를 expo-sqlite로 표시 |
| @reduxjs/toolkit 2.13.0 | 39,950 B | 14,546 B | 6 | react, react-redux (peer). 의존성: immer, redux, reselect, redux-thunk 등 |
| react-redux 9.3.0 | 9,731 B | 3,771 B | 2 | react ^18·^19, redux ^5 |
| @tanstack/store 0.11.2 | 5,519 B | 2,095 B | 0 | |
| @tanstack/react-store 0.11.2 | 8,159 B | 3,069 B | 2 | react·react-dom ^16.8~^19 |
| @xstate/store 4.3.0 | 11,032 B | 4,122 B | 0 | xstate ^5 (optional) [검증: `peerDependenciesMeta`] |
| @xstate/store-react 2.1.0 | 12,377 B | 4,549 B | 1 | react ^18·^19 |
| @preact/signals-react 3.12.0 | 8,517 B | 3,073 B | 2 | |
| use-sync-external-store 1.7.0 | 320 B | 226 B | 0 | |
| React 19 내장 | 추가 0 | 추가 0 | | react 패키지를 이미 씀 |

- 어댑터 패키지의 수치는 의존성을 포함한 합계로 보입니다. 근거: `@xstate/store-react` 4,549 B는 `@xstate/store` 4,122 B보다 크고, 소스는 7 KB(주석 포함)에 그칩니다. `@tanstack/react-store`의 `dist/index.js`는 480 B이고 gzip 3,069 B는 `@tanstack/store` 2,095 B와 shim을 포함한 값으로 맞습니다 [구조]. bundlephobia API 문서로 "의존성 포함"을 직접 확인하지는 못했습니다 [미확인]. 따라서 TanStack Store 합계는 약 3.1 KB, XState Store 합계는 약 4.5 KB이고, 두 값을 더하지 않습니다. 이전 판의 "2.1 KB + 3.1 KB"는 이중 계산이었습니다.
- MobX와 mobx-react-lite는 의존성이 0이라 합산이 맞습니다 (약 16.9 KB). RTK는 14.5 KB에 immer·redux·reselect가 들어 있고, react-redux 3.8 KB를 더합니다.
- 수치는 `import *` 기준 메인 엔트리입니다. 앱 번들에서는 tree shaking으로 달라질 수 있습니다. Tauri는 로컬 자산이라 네트워크 전송 비용은 없고, 수 KB 차이는 선택을 좌우하지 않습니다.

## 5. 기준 1~5 비교

| 후보 | 1. 스트리밍 부분 갱신 | 2. React 19·Compiler | 3. 이벤트 주입·순서 로그 | 4. `bun test` (DOM 없음) | 5. TS 추론·단언 |
|---|---|---|---|---|---|
| Zustand | 훅이 `React.useSyncExternalStore`를 직접 호출하고 selector 결과를 `Object.is`로 비교 [검증: 소스, README "strict-equality (old === new) by default"]. 항목별 selector는 해당 항목 문자열이 바뀔 때만 재렌더. 대신 레코드 스프레드가 O(N) (§7.2) | peer `react >=18` (optional). React 19 전용 진술 없음. Compiler: 패키지 README 전체에 언급 없음 [검증], GitHub 이슈 검색 0건 [2차]. 공식 진술 없음 | `set((s) => applyEvent(s, ev))` [구조] | `zustand/vanilla`의 `createStore`가 `getState`·`setState`·`subscribe` 제공 [검증: d.ts] | `create<T>()(...)` curried 형태 [검증: d.ts 오버로드]. 스케치에 단언 없음 |
| Jotai 3.0.1 | 항목별 atom과 `useAtomValue`로 분리하면 해당 항목만 재렌더 [구조]. 항목 atom을 id별 레지스트리에 두면 델타 복사가 O(1). `splitAtom`은 문서에 재렌더 범위 설명이 없고 배열 전체를 다시 만드는 구조 [구조] | peer `react >=18` (optional). Compiler: README에 언급 없음 [검증], 이슈 검색 0건 | atom은 상태 그래프. 이벤트를 쓰기 atom으로 번역해야 함 | `jotai/vanilla`의 `createStore` 존재 [검증: 패키지 파일 목록] | TS 가이드 예제에 `as`·`!`·`any` 없음. 명시 제네릭 사용 (`atom<number \| null>(0)`) [검증]. TS 5.5+ 필요 [검증] |
| Valtio 2.3.2 | `useSnapshot`이 렌더 중 읽은 경로만 추적. 항목 프록시 단위로 구독하면 해당 항목만 재렌더 [검증: README]. 쓰기는 제자리 변경이라 복사 비용이 낮음 [구조]. 부모 스냅샷 재생성 비용은 [미확인] | peer `react >=18` (optional). README에 Compiler 언급 없음 [검증]. 제작자 블로그(2025-01-07): "Valtio v2 works perfectly with the React Compiler" [2차]. 같은 글에서 렌더 최적화가 Compiler와 개념상 충돌한다고 서술. `useTransition`과 함께 쓰면 "de-opt" [검증: README] | 직접 쓰기. 로그와 맞추려면 이벤트를 쓰기로 번역 | proxy는 DOM 없이 동작 [구조] | README 예제에 `as` 없음 [검증]. 스냅샷 타입이 깊은 readonly라 필요하면 모듈 보강 선언으로 완화 [검증] |
| MobX 7.1.0 + mobx-react-lite 5.1.0 | `observer`가 읽은 observable만 추적 [검증: 문서 "observables that are accessible by the component, but not actually read, won't ever cause a re-render"]. `item.text += delta`는 O(1). Proxy 전용 [검증: CHANGELOG 7.0.0] | peer `react ^18 \|\| ^19`. React 공식 문서의 `incompatible-library` 페이지: "MobX patterns like `observer` also break memoization assumptions, but the linter does not yet detect them", 필요하면 `"use no memo"` 지시어 사용 [검증]. mobx 이슈 #3874 open | action으로 감싼 쓰기. 로그 구조는 직접 작성 [구조] | DOM 없이 동작 [구조] | 문서 예제에 `as`·`!`·`any` 없음. TS의 private 필드는 `makeObservable<Class, "privateField">(...)` 제네릭 인자가 필요 [검증]. `#private` 필드는 미지원, `accessor` 데코레이터 권장 [검증] |
| Legend-State | stable은 2.1.15 (2024). v3 beta의 `useValue`가 접근한 observable만 추적하고 값이 바뀔 때만 재렌더 [검증: v3 react-api 페이지] | v3 소개 페이지에 "Works great with React Compiler" [검증: 벤더 문구]. 그러나 이슈 #477 (2025-02, open): `use$`가 Compiler에서 갱신되지 않음, hook 이름 검사 때문 [2차: 이슈 본문]. 이슈 #653 (2026-05, open): Compiler 활성 시 stale UI | 문서화된 이벤트 모델 없음 | [미확인] | v3 react-api 페이지 예제에 `createContext<...>(undefined as any)` 한 곳 [검증]. 그 외 `as`·`!` 없음 |
| Redux Toolkit 2.13.0 + react-redux 9.3.0 | `useSelector`는 기본 `===` 비교, 결과가 다를 때만 재렌더 [검증: redux.js.org]. Immer가 `entities` 객체를 얕게 복사하므로 델타마다 O(N) [구조]. 개발 빌드에서만 `immutableCheck`·`serializableCheck`가 상태 전체를 깊게 검사 [검증] | react-redux peer `react ^18.0 \|\| ^19`, redux ^5. Compiler 진술 없음 [검증: 패키지 README 두 곳에 언급 없음], 이슈 검색 0건 | action이 이벤트이고 reducer가 순수 함수. 단 "action type union을 피하라"는 공식 권고가 있어 이벤트 판별 유니온 설계와 어긋남 [검증: Redux TS 가이드] | reducer를 DOM 없이 시험 [구조] | `useSelector.withTypes<RootState>()` 문서화됨 (react-redux 9.1.0+) [검증]. `as`는 initialState가 과하게 좁혀질 때의 우회와 순환 타입 해소용으로만 나옴 [검증]. `!` 없음 |
| TanStack Store 0.11.2 + react-store 0.11.2 | `useSelector(source, selector?, { compare? })`. 기본 `compare`는 `===` [검증: 소스]. 내부는 `useSyncExternalStoreWithSelector` [검증: 소스]. 레코드 스프레드 O(N)은 Zustand와 같음 | react-store peer에 `^19` 포함 [검증]. Compiler 진술 없음 [검증: README 언급 없음], 이슈 검색 0건. 라이브러리 타입 시험은 TS 5.6~5.9만 [검증: `package.json` scripts], TS 7은 명시 없음 | `setState(updater: (prev: T) => T)`. 업데이터 함수만 받음 [검증: d.ts] | 프레임워크 무관 `Store`/`createStore` [검증: d.ts] | `new Store<T>(initial)` 또는 `createStore(initial)` [검증: d.ts]. 사용 측 API에 단언 불필요. 라이브러리 내부 소스에는 `as`가 있으나 사용자 코드와 무관. `useStore`는 `useSelector`의 deprecated alias [검증: d.ts] |
| XState Store 4.3.0 + store-react 2.1.0 | `useSelector(store, selector, compare?)`. 기본 비교는 `===` [검증: 소스] | store-react peer `react ^18 \|\| ^19` [검증]. Compiler 진술 없음 [검증: README 언급 없음], 이슈 검색 0건 (`@xstate/react`의 #5426은 별개 패키지) | `on` 전이와 `trigger.*` 타입 이벤트 [검증]. 이벤트 로그와 가장 맞음 | `createStore`는 React 없이 `getSnapshot`·`subscribe`·`trigger` 제공 [검증: d.ts]. peer `xstate`는 optional이며 메인 번들이 런타임에 import하지 않음 (`fromStore.d.ts`의 타입 import만 있음) [검증] | 스키마 기반 또는 `on` 핸들러 인자 기반 추론 [검증: d.ts]. `StoreContext = Record<string, any>` 제약이라 context는 `interface`가 아니라 `type` 별칭이어야 함 [구조]. 예제에 단언 없음 |
| React 19 내장 + 직접 작성 store | 직접 구현. `subscribe` 목록과 항목별 구독. `getSnapshot`은 불변 스냅샷을 반환해야 함 [검증] | React 19.3.1. Compiler 소개 페이지는 외부 가변 값 규칙을 다루지 않음 [검증: 없음] | 직접 작성 | 가장 쉬움. 순수 함수 | 단언 없이 가능 |
| @preact/signals-react | Babel transform 필요. 제외 (§8) | | | | |

React Compiler 요약:

- React 공식 문서가 이름을 든 비호환 사례는 MobX `observer`, react-hook-form `watch`, TanStack Table `useReactTable`입니다 [검증]. Zustand, Jotai, Valtio, Redux, TanStack Store, XState Store는 이 페이지에 나오지 않습니다 [검증: 없음].
- 위 6개 라이브러리 중 어느 것도 패키지 README에 Compiler 호환 진술이 없습니다. GitHub 이슈도 검색되지 않았습니다. "호환 확인"이 아니라 "비호환 보고 없음"입니다. 이 앱에서의 실제 재렌더는 컴파일 후 확인이 필요합니다 [미확인].
- 구조상 `useSyncExternalStore` 위에 불변 스냅샷을 얹는 Zustand, RTK, TanStack Store, XState Store는 React 규칙(렌더 중 비로컬 값 수정 금지)과 충돌할 요소가 적습니다 [구조]. 가변 상태와 프록시 추적을 쓰는 MobX, Valtio, Legend-State는 Compiler와의 상호작용 위험이 큽니다 [구조]. 근거는 MobX 공식 서술과 Legend-State 이슈입니다.

## 6. 기준 6~8 비교

| 후보 | gzip (의존성 포함 합계) | 유지보수 (npm) | 예측 가능성 (명시적 갱신 또는 암묵 추적) | 판정 |
|---|---|---|---|---|
| Zustand | 0.49 KB | 5.0.16, 2026-10-22. 활발 | 명시적 `set`. selector 비교 규칙이 문서화됨. devtools·persist 미들웨어 [검증] | 1순위 |
| XState Store | 4.5 KB (store-react, store 포함) | 4.3.0 (10-08). 5.0 alpha가 4.3.0과 같은 날 시작되어 10-17에 alpha.8 | 명시적 `on` 전이와 타입 이벤트 | 2순위 |
| TanStack Store | 3.1 KB (react-store, store 포함) | 0.11.2 (09-29). 0.10→0.11이 7일. react-store 1.0 alpha | 명시적 `setState`. 0.x라 API 변동 가능 | 3순위 |
| Jotai | 3.3 KB | 3.0.1 (09-29). 메이저 전환 직후 | atom 그래프 의존. 추적이 암묵적 | 보류 |
| Valtio | 2.6 KB (proxy-compare 포함 추정) | 2.3.2 (05-01). 릴리스 간격 김 | 직접 쓰기와 proxy 추적. 암묵적 | 보류 |
| MobX | 15.0 KB + 1.8 KB | 7.1.0 (10-20). 활발 | 자동 추적. 암묵적. Proxy 전용 [검증]. Compiler와 마찰 [검증] | 보류 |
| Legend-State | stable 6.7 KB, v3 beta 10.9 KB | stable이 2년 전. v3 beta. Compiler 이슈 open | `useValue`의 `get()` 추적. 암묵적 | 보류 (유지보수 위험) |
| RTK + react-redux | 14.5 KB + 3.8 KB | 2.13.0 (09-29). 활발. react-redux 9.4 alpha | action·reducer로 명시적. 가장 무겁고 가장 성숙 | 대안 |
| React 내장 | 0 KB | React 19.3.1 | 가장 명시적. 대신 직접 작성 | 대안 (직접 구현 비용) |
| @preact/signals-react | 3.1 KB | 3.12.0 (08-04) | 암묵 추적 + 빌드 변환 필요 | 제외 |

## 7. React 공식 진술, 이벤트 흐름, 스트리밍 비용

### 7.1 React 공식 진술과 이벤트 흐름

- `useSyncExternalStore` 공식 문서 [검증]: `getSnapshot`은 저장소가 바뀌지 않았으면 같은 값을 돌려줘야 합니다. 바뀌었으면 `Object.is` 기준으로 다른 값을 돌려줘야 합니다. 스냅샷은 불변이어야 하고, 가변 저장소는 마지막 스냅샷을 캐시해야 합니다. 매 호출마다 새 객체를 만들면 무한 루프 오류가 납니다. 따라서 이벤트마다 불변 갱신을 하는 store가 이 계약과 맞습니다.
- 같은 문서 [검증]: 외부 저장소의 변경은 Transition으로 표시할 수 없고 항상 블로킹 갱신입니다. Suspense로 외부 저장소 값을 기다리면 이미 그려진 내용이 fallback으로 바뀝니다. 스트리밍 델타가 `useTransition`으로 낮은 우선순위가 되지 않는다는 뜻이므로, 델타 처리 비용이 그대로 입력 반응성에 영향을 줍니다.
- React Compiler 소개 페이지 [검증]: "React Compiler is now stable and has been tested extensively in production." 그리고 "It works with plain JavaScript, and understands the Rules of React". 같은 페이지의 DeepDive: "React Compiler only memoizes React components and hooks, not every function". 지원 버전은 `target` 문서에서 17, 18, 19이며 React 19는 추가 런타임이 필요 없습니다 [검증].
- React Compiler 쪽에서 확인하지 못한 점: 외부 가변 객체를 render에서 읽는 경우의 규칙을 다루는 페이지를 찾지 못했습니다 [검증: 없음]. 다만 `incompatible-library` 린트 문서에 MobX `observer` 사례가 있습니다 (§5).
- Rules of React [검증]: 컴포넌트와 훅은 render 중에 로컬에서 만들지 않은 값을 수정하면 안 됩니다. 이 규칙은 외부 store의 쓰기를 render 안에 두지 말아야 한다는 뜻으로 읽을 수 있습니다.
- 이벤트 흐름 제안: 엔진 stdio 수신부 → `applyEvent(state, event)` (순수 함수) → store 갱신 → selector 구독. 델타가 초당 수십 번 올 수 있으므로 갱신을 animation frame 단위로 묶는 것을 권합니다. 델타 빈도가 프레임 속도(60 Hz)보다 낮으면 묶어도 복사 횟수가 줄지 않으므로, 이 묶기는 측정으로 정할 항목입니다.
- 순서 보장: 엔진 이벤트에 순번(seq)이 있으면 store가 마지막 순번을 기록하고 빈 순번을 감지해야 합니다. 재개 규칙(spec §4.6)과 맞춥니다.

### 7.2 델타 1건당 복사 비용 [참고 측정]

대상: 텍스트 200자짜리 항목 N개를 가진 레코드에서 마지막 항목의 `text`에 문자열을 덧붙이는 불변 갱신 한 번. 순수 JS, 패키지 미사용, Node 24.19.0 (V8), WSL2. 스크립트는 scratchpad의 `bench/bench.mjs`입니다.

| 항목 수 N | 레코드 스프레드 `{...items, [id]: next}` | Map 복사 `new Map(m)` | 제자리 변경 (MobX·Valtio 방식) |
|---|---|---|---|
| 100 | 0.7 µs | 4.7 µs | 0.05 µs |
| 1,000 | 283 µs | 55 µs | 0.03 µs |
| 10,000 | 3.5 ms | 1.2 ms | 0.02 µs |
| 50,000 | 37 ms | 8.5 ms | 0.02 µs |

- 초당 50회 델타를 가정하면 스프레드 비용은 N=1,000에서 약 14 ms/s, N=10,000에서 약 175 ms/s, N=50,000에서 약 1.9 s/s입니다 (측정값 × 50 계산). N=10,000부터 메인 스레드 점유가 눈에 띄고, 복사 후 버려지는 객체 때문에 GC 부담도 따릅니다 [구조].
- N이 100에서 1,000으로 10배 늘 때 비용이 약 400배 늘었습니다. 객체 내부 표현이 바뀌는 것으로 추정하지만 확인하지 않았습니다 [미확인].
- Map 복사는 스프레드보다 낮지만 O(N)이라는 점은 같습니다. 레코드를 Map으로 바꾸는 것은 근본 해결이 아닙니다.
- Zustand, TanStack Store, XState Store, RTK(Immer가 `entities`를 얕게 복사)는 모두 이 O(N) 복사를 합니다 [구조]. 라이브러리 선택으로 줄어드는 비용이 아니라 상태 모양으로 줄이는 비용입니다.
- Tauri의 웹뷰 엔진은 운영체제에 따라 다릅니다 (Linux WebKitGTK, macOS WKWebView는 JavaScriptCore 계열, Windows WebView2는 V8). 이 수치는 V8 한 곳의 값이고, Bun(JavaScriptCore)은 이 환경에서 실행할 수 없어 측정하지 못했습니다. 절대값이 아니라 증가 추세를 읽어야 합니다.
- 문자열 덧붙이기(`current.text + event.text`) 자체의 비용은 측정하지 않았습니다 [미확인].
- 완화 방법 (상태 모양, 라이브러리 무관) [구조]:
  1. 스트리밍 중인 항목을 `streaming: { itemId, text }` 필드로 분리하고, 델타는 이 필드만 교체합니다. `item.completed`에서 한 번만 `items`에 합칩니다. 델타당 비용이 O(1)이 되고 `items` 복사는 항목 완료당 1회로 줄어듭니다. 표시 컴포넌트는 `streaming.itemId`와 같으면 그 텍스트를 읽습니다.
  2. 스레드별로 `items`를 나눠 N을 활성 스레드의 항목 수로 제한합니다.
  3. 항목마다 작은 vanilla store를 레지스트리에 두고 항목 컴포넌트가 그것을 구독합니다 (Zustand의 `createStore`와 `useStore(api, selector)`로 가능 [검증: d.ts]). 대신 레지스트리 수명 관리가 필요합니다.

## 8. 제외 후보: @preact/signals-react (주장 검증)

주장: "signals는 React 내부를 패치한다." 검증 결과는 다음과 같습니다.

- 공식 README [검증]: 권장 통합은 Babel transform입니다. 대안은 `useSignals` 훅입니다. 내부 패치를 언급하지 않습니다. 경고는 다음과 같습니다. SSR에서는 signal을 추적하지 않습니다. render props 사용은 권장하지 않습니다. DOM 속성에 signal을 넘길 수 없습니다. getter·setter를 거치면 변환이 놓칠 수 있습니다. React 지원 버전은 명시하지 않습니다. Strict Mode와 concurrent 렌더링은 언급하지 않습니다.
- 공개 진입점 `packages/react/src/index.ts` [검증]: 재내보내기만 합니다.
- 실제 구현 `packages/react/runtime/src/index.ts` [검증]: 3.12.0 tarball에서 다시 확인했습니다. 소스에 `Internals`·`Dispatcher` 접근이 없고, 빌드 산출물(`runtime.mjs`, `signals.mjs`, `utils.mjs`)에서 `SECRET`, `CLIENT_INTERNALS`, `ReactCurrentDispatcher` 검색 결과가 0건입니다. 디스패처나 훅 객체를 교체하지 않습니다. 대신 다음을 합니다. `Signal.prototype`에 `$$typeof`를 설정해 React가 signal을 요소로 렌더하게 합니다. `Symbol.for("react.transitional.element")`(React 19) 또는 `"react.element"`를 버전에 따라 고릅니다. JSX 팩토리를 감싸 DOM 문자열 태그의 signal 속성을 `.value`로 바꿉니다. 구독은 `use-sync-external-store/shim`을 씁니다.
- 판정: "디스패처를 패치한다"는 과장입니다. 정확한 표현은 "React의 비공개 요소 표식을 흉내 내고 JSX 팩토리를 감싼다"입니다.
- 제외 이유는 예측 가능성입니다. 빌드 변환이 필수입니다. 변환이 일부 컴포넌트를 놓칠 수 있다고 README에 적혀 있습니다. 비공개 요소 형태에 기댑니다.

## 9. 후보별 메모

### 상위 3

- **Zustand (1순위)**: 기준 1은 selector가 문자열이나 `itemIds` 배열 참조를 반환해서 해결합니다. 델타가 `itemIdsByThread` 참조를 바꾸지 않는다는 점은 `applyEvent`의 `...state` 전개로 확인됩니다. 델타 때 마운트된 모든 `ItemText`의 selector가 한 번씩 실행되지만 각각 O(1) 조회입니다. 기준 2는 peer 범위에 React 19가 들어 있지만 Compiler 공식 진술은 없습니다. 기준 3은 순수 `applyEvent`를 `set`에 넘기는 방식입니다. 기준 4와 5는 §12 스케치에서 확인할 수 있습니다.
- **XState Store (2순위)**: 기준 3에서 가장 맞습니다. `on` 전이와 `trigger.*` 타입 이벤트가 로그 적용과 같은 모양입니다. 문서는 v4.x 기준입니다. peer `xstate`는 optional이고 런타임에 import되지 않으므로 별도 설치가 필요 없습니다 [검증]. 5.0 alpha로 메이저가 바뀔 수 있습니다.
- **TanStack Store (3순위)**: `useSelector`의 `compare` 옵션과 React 19 peer가 장점입니다. 0.x이고 react-store 1.0은 alpha입니다. 공식 문서 본문은 읽지 않았고 소스와 타입 정의로 대체했습니다.

### 나머지

- **Jotai**: 항목별 atom은 직관적입니다. v3가 `atomFamily`를 `jotai-family` 패키지로 옮기고 `loadable`을 뺐습니다 [검증: 마이그레이션 가이드]. 요구 사양은 React 18+, TS 5.5+, Node 22.12+, ESM 전용입니다. 이전 판의 "Node 20 지원 중단"은 릴리스 노트의 개발 의존성 항목을 잘못 옮긴 것이었습니다. 이벤트 로그와 맞지 않습니다.
- **Valtio**: 경로 단위 추적은 델타 비용이 낮습니다 [검증]. 다만 직접 쓰기 모델이라 예측 가능성이 낮습니다. `useTransition`과 함께 쓰면 de-opt가 생긴다는 README 경고가 있습니다 [검증]. 마지막 릴리스가 약 6개월 전입니다.
- **MobX**: `observer`의 자동 추적은 문서에 명시되어 있습니다 [검증]. 제자리 변경이라 델타 비용이 가장 낮은 편입니다. 반면 React 공식 문서가 `observer`를 memoization 가정을 깨는 사례로 지목합니다 [검증]. mobx-react-lite 5의 `useObserver` 등 제거 목록과 Proxy 전용 변경은 CHANGELOG에서 확인했습니다 [검증].
- **Legend-State**: v3가 beta입니다. stable 2.1.15는 2024년 릴리스입니다. "Works great with React Compiler"는 벤더 문구이고, Compiler 관련 open 이슈 두 건이 반대 사례를 보고합니다 (§5). v3 stable 출시 시점은 찾지 못했습니다 [미확인].
- **Redux Toolkit**: 이벤트와 순수 reducer 모델이 가장 자연스럽고 유지보수가 가장 안정적입니다. 번들은 14.5 KB gzip입니다. `withTypes`가 문서화되어 있어 타입 설정에 단언이 필요 없습니다 [검증]. `entities` 얕은 복사 O(N)과 개발 빌드의 깊은 검사 비용에 주의해야 합니다.
- **React 내장 + 직접 작성 store**: 의존성이 0입니다. 가장 명시적입니다. 대신 구독 목록, 항목별 구독, 선택자 비교를 직접 구현하고 시험해야 합니다. 상위 3위 안의 Zustand가 이 구현을 대신하는 셈입니다.

## 10. 권고

### 1순위: Zustand 5.0.16

근거는 기준별로 다음과 같습니다.

- 기준 1: 항목별 selector가 문자열을 반환합니다. 리스트는 `itemIdsByThread[thread]` 배열 참조만 구독합니다. 델타는 배열 참조를 바꾸지 않으므로 리스트가 재렌더되지 않습니다 [검증: 소스, 엄격 비교 기본값]. 복사 비용은 §7.2 변형으로 줄입니다.
- 기준 2: peer `react >=18`이라 React 19가 범위에 듭니다. Compiler 진술은 없고 비호환 이슈도 없습니다. 빌드 단계에서 `babel-plugin-react-compiler`와 `eslint-plugin-react-hooks`로 확인해야 합니다.
- 기준 3: 엔진 이벤트를 `applyEvent`에 넘기는 한 줄 호출입니다. 로그와 순번은 우리 타입으로 씁니다.
- 기준 4: 순수 함수와 vanilla store를 DOM 없이 `bun test`로 시험할 수 있습니다 [검증: vanilla API 존재, 시험 실행은 [구조]].
- 기준 5: curried `create<T>()` 형태에 단언이 없습니다 [검증: d.ts].
- 기준 6: 490 B gzip입니다. 후보 중 가장 작습니다.
- 기준 7: 5.0.16이 2026-10-22에 릴리스되었습니다. MIT입니다.
- 기준 8: `set`이 명시적입니다. 미들웨어로 devtools를 붙일 수 있습니다 [검증: README 예제].

### 이 선택으로 잃는 것

- 이벤트 타입과 로그 기능이 없습니다. XState의 `on`과 `trigger`처럼 라이브러리가 주는 기능을 우리가 직접 씁니다. 판별 유니온과 완전성 검사(TY-13, TY-14)로 보완합니다.
- 델타마다 `items` 레코드를 복사합니다. 이 환경의 측정으로 N=1,000에서 약 0.28 ms, N=10,000에서 약 3.5 ms입니다 (§7.2). 항목 수가 수천 개를 넘을 수 있으면 `streaming` 분리나 스레드별 분할을 처음부터 넣어야 합니다. 실제 웹뷰 엔진에서의 값은 측정하지 않았습니다.
- React Compiler 공식 보장이 없습니다. 빌드에서 확인해야 합니다.
- 승인 대기열처럼 상태 전이가 복잡해지면 XState의 표현력이 필요해질 수 있습니다. 그때는 상태 기계 도입 비용을 따로 따져야 합니다.

### 2순위: XState Store (`@xstate/store` 4.3.0 + `@xstate/store-react` 2.1.0)

- 기준 3에서 가장 맞습니다. 전이가 곧 이벤트 로그 적용입니다.
- 기준 4는 `createStore`가 React 없이 동작한다는 문서와 d.ts로 충족합니다 [검증].
- 기준 5는 `on` 핸들러 인자 기반 추론입니다. context는 `type` 별칭이어야 합니다.
- 채택 시 잃는 것: 5.0 전환 비용, 문서가 v4 기준이라 경로 혼선. 이전 판의 "패키지 두 개 관리"와 "peer `xstate` 확인"은 해소되었습니다 (store-react가 store를 의존성으로 가져오고, `xstate`는 optional peer이며 런타임 import가 없음).

### 3순위: TanStack Store (0.11.2)

- 선택자 `compare` 옵션과 깔끔한 API가 장점입니다. 생성자와 `setState` 형태는 d.ts로 확인했습니다.
- 채택 시 잃는 것: 0.x 안정성 (0.10→0.11이 1주), react-store 1.0 전환, 라이브러리 타입 시험이 TS 5.6~5.9까지만 명시된 점, 공식 문서 본문 미확인.
- 순위 민감도: 유지보수 안정성과 이벤트·reducer 적합성을 번들 크기보다 중시하면 RTK + react-redux가 이 자리에 맞습니다. 이 앱은 로컬 자산이라 14.5 KB가 결정적이지 않습니다. 다만 RTK도 `entities` 복사 O(N), 개발 빌드 검사 비용, "action union을 피하라"는 권고와의 충돌이 있습니다.

## 11. 미확인 항목과 실행하지 않은 검사

이번 판에서 해소한 항목:

- TS 단언 여부: Jotai, MobX, Legend-State, RTK, TanStack Store 모두 §5 표에 반영했습니다. 결과 요약: Jotai·MobX·TanStack Store는 일반 사용에 단언이 필요 없고, RTK는 특수 경우의 우회로만 `as`가 나오며, Legend-State 문서에는 Context 예제에 `undefined as any`가 한 곳 있습니다.
- RTK `withTypes` 패턴: 문서화됨 (react-redux 9.1.0+).
- TanStack Store 생성자: `new Store<T>(initial)`, `createStore(initial)`, `setState(updater)` 확인.
- `@xstate/store-react` 내보내기: `useSelector`, `useStore`, `useAtom`, `useAtomState`, `createStoreHook`와 `@xstate/store` 전체 재내보내기. 크기 12,377 B min, 4,549 B gzip.
- `@xstate/store`의 peer `xstate`: optional이며 런타임 import 없음.
- Compiler 진술: 각 라이브러리별로 §5에 정리했습니다. 공식 긍정 진술이 있는 곳은 없습니다.

남은 미확인 항목:

- 각 라이브러리의 컴파일 후 실제 재렌더 동작. 공식 진술이 없으므로 앱에서 직접 확인해야 합니다.
- 스케치는 d.ts를 읽고 성립을 판단했을 뿐 `tsc`로 컴파일하지 않았습니다. TypeScript 7.0.2에서의 검증도 없습니다.
- §7.2 측정은 V8 한 곳의 값입니다. JavaScriptCore(Bun, macOS·Linux 웹뷰)에서의 값, 문자열 덧붙이기 비용, N=100~1,000 구간에서 비용이 급증하는 원인은 미확인입니다.
- bundlephobia `size`가 의존성을 포함하는지 API 문서로 확인하지 못했습니다 (소스 크기와의 대조로 추정).
- Valtio에서 항목 변경 시 부모 스냅샷 재생성 비용, Jotai `splitAtom`의 재렌더 범위. 공식 문서에 설명이 없습니다.
- Legend-State v3 stable 출시 시점.
- TanStack Store 공식 문서 본문. 소스와 타입 정의로 대체했습니다.
- MobX 공식 플러그인(Compiler와 함께 쓰는 것)은 이슈 댓글에서만 확인했습니다 [2차].
- 서드파티 프리프린트의 "Compiler가 프록시 기반 라이브러리를 과다 메모이즈한다"는 주장은 검색 요약으로만 보았고 원문을 읽지 않았습니다 [2차, 미검증].
- 외부 가변 객체를 render에서 읽는 경우의 React 공식 규칙.

실행하지 않은 검사:

- `bun test`는 실행하지 않았습니다. 조정자 지시가 읽기와 레지스트리 조회로 한정되었습니다.
- `npm install`과 패키지 실행은 하지 않았습니다. tarball은 읽기 전용으로 풀기만 했습니다.
- `just verify`는 실행하지 않았습니다. 사용자 전역 지침은 작업을 끝내기 전에 `just verify`를 요구합니다. 그러나 이 레시피는 `setup`(설치)과 테스트를 포함합니다. 이번 지시 범위를 벗어나므로 실행을 보류했습니다. 사용자 확인 후 실행이 필요합니다.

## 12. TypeScript 스케치 (상위 3)

스케치는 `as`, `!`, `any`를 쓰지 않습니다. 식별자는 설명을 위해 `string`으로 두었습니다. 실제 코드는 TY-09 브랜드 타입을 씁니다. 상태 모양은 세 스케치가 같습니다. 세 스케치 모두 해당 패키지의 `.d.ts`를 읽고 성립을 검토했습니다 (`tsc` 미실행). `noUncheckedIndexedAccess`가 켜져 있다고 가정합니다. 꺼져 있어도 컴파일은 되지만 `=== undefined` 검사가 불필요한 조건으로 린트에 걸릴 수 있습니다.

### 공용 타입과 `item.delta` 적용 (Zustand 스케치와 공유, DOM 없음)

```ts
// engine-events.ts
export type ThreadId = string;
export type ItemId = string;

export type TextItem = {
  readonly id: ItemId;
  readonly kind: "text";
  readonly text: string;
  readonly done: boolean;
};
export type ToolItem = {
  readonly id: ItemId;
  readonly kind: "tool";
  readonly name: string;
  readonly done: boolean;
};
export type Item = TextItem | ToolItem;

// 스토어 모양: thread → item id 목록, item id → item
// XState Store의 context 제약(Record<string, any>) 때문에 interface가 아니라 type 별칭을 씁니다.
export type ChatState = {
  readonly itemIdsByThread: Readonly<Record<ThreadId, readonly ItemId[]>>;
  readonly items: Readonly<Record<ItemId, Item>>;
};

export type EngineEvent =
  | { readonly type: "item.started"; readonly threadId: ThreadId; readonly item: Item }
  | { readonly type: "item.delta"; readonly threadId: ThreadId; readonly itemId: ItemId; readonly text: string }
  | { readonly type: "item.completed"; readonly threadId: ThreadId; readonly itemId: ItemId };

function assertNever(value: never): never {
  throw new Error(`unhandled event: ${JSON.stringify(value)}`); // 실제 코드는 Bug로 던진다 (TY-24)
}

export function applyEvent(state: ChatState, event: EngineEvent): ChatState {
  switch (event.type) {
    case "item.started": {
      const ids = state.itemIdsByThread[event.threadId] ?? [];
      return {
        itemIdsByThread: { ...state.itemIdsByThread, [event.threadId]: [...ids, event.item.id] },
        items: { ...state.items, [event.item.id]: event.item },
      };
    }
    case "item.delta": {
      const current = state.items[event.itemId];
      if (current === undefined || current.kind !== "text") {
        return state; // 실제 코드는 오류 유니온으로 돌려준다 (TY-11)
      }
      return {
        ...state,
        items: { ...state.items, [event.itemId]: { ...current, text: current.text + event.text } },
      };
    }
    case "item.completed": {
      const current = state.items[event.itemId];
      if (current === undefined) {
        return state;
      }
      return {
        ...state,
        items: { ...state.items, [event.itemId]: { ...current, done: true } },
      };
    }
    default:
      return assertNever(event);
  }
}
```

검토 메모: `item.completed`의 `{ ...current, done: true }`는 `current`가 `Item` 유니온이어서 유니온별 전개 결과가 `Item`에 대입됩니다. 델타 비용은 `items` 스프레드의 O(N)입니다 (§7.2). 스트리밍 필드 분리 변형을 쓰면 `item.delta` 분기만 바뀝니다.

### 1순위 Zustand: 스토어와 구독 컴포넌트

```ts
// chat-store.ts
import { create } from "zustand";
import { applyEvent, type ChatState, type EngineEvent } from "./engine-events";

export type ChatStore = ChatState & {
  readonly apply: (event: EngineEvent) => void;
};

export const useChatStore = create<ChatStore>()((set) => ({
  itemIdsByThread: {},
  items: {},
  apply: (event) => set((state) => applyEvent(state, event)),
}));
```

검토 메모: `create<T>()(initializer)` 오버로드가 d.ts에 있습니다. `set`의 인자 `T | Partial<T> | ((state: T) => T | Partial<T>)`에 `applyEvent`의 반환값(`ChatState`)이 `Partial<ChatStore>`로 대입됩니다. `set`은 얕은 병합이라 `apply` 함수가 유지됩니다.

```ts
// engine-bridge.ts (React 밖, stdio 수신부)
import { useChatStore } from "./chat-store";
import type { EngineEvent } from "./engine-events";

export function onEngineEvent(event: EngineEvent): void {
  useChatStore.getState().apply(event);
}
```

```tsx
// item-text.tsx: 항목 하나의 텍스트만 구독한다
import { memo } from "react";
import { useChatStore } from "./chat-store";
import type { ItemId, ThreadId } from "./engine-events";

// React Compiler를 쓰지 않는 경우 memo로 감싼다. 리스트가 다시 렌더될 때(새 항목 추가) 기존 항목이 따라 렌더되는 것을 막는다.
export const ItemText = memo(function ItemText({ itemId }: { readonly itemId: ItemId }) {
  const text = useChatStore((s) => {
    const item = s.items[itemId];
    return item?.kind === "text" ? item.text : "";
  });
  return <span>{text}</span>;
});

// 리스트는 id 배열 참조만 구독한다. 델타는 이 참조를 바꾸지 않는다.
const NO_ITEMS: readonly ItemId[] = [];

export function ItemList({ threadId }: { readonly threadId: ThreadId }) {
  const ids = useChatStore((s) => s.itemIdsByThread[threadId] ?? NO_ITEMS);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <ItemText itemId={id} />
        </li>
      ))}
    </ul>
  );
}
```

### 2순위 XState Store: 전이와 구독

```ts
// xstate-chat-store.ts (@xstate/store 4.3.0 d.ts 기준)
import { createStore } from "@xstate/store-react"; // @xstate/store를 다시 내보냄. @xstate/store에서 직접 import해도 같음
import {
  applyEvent,
  type ChatState,
  type Item,
  type ItemId,
  type ThreadId,
} from "./engine-events";

const initial: ChatState = { itemIdsByThread: {}, items: {} };

export const chatStore = createStore({
  context: initial,
  on: {
    itemStarted: (context, event: { readonly threadId: ThreadId; readonly item: Item }) =>
      applyEvent(context, { type: "item.started", threadId: event.threadId, item: event.item }),
    itemDelta: (context, event: { readonly threadId: ThreadId; readonly itemId: ItemId; readonly text: string }) =>
      applyEvent(context, { type: "item.delta", threadId: event.threadId, itemId: event.itemId, text: event.text }),
    itemCompleted: (context, event: { readonly threadId: ThreadId; readonly itemId: ItemId }) =>
      applyEvent(context, { type: "item.completed", threadId: event.threadId, itemId: event.itemId }),
  },
});

// 엔진 수신부: chatStore.trigger.itemDelta({ threadId, itemId, text })
```

검토 메모: `createStore`의 첫 오버로드는 `on`의 핸들러 인자 타입에서 이벤트 페이로드 맵을 추론합니다 (`const TEventPayloadMap`). 핸들러는 `TContext | void`를 반환할 수 있고, `StoreContext = Record<string, any>` 제약에 `type` 별칭인 `ChatState`가 맞습니다. 핸들러의 `event` 인자는 `{ type: K } & Payload`의 상위 타입이라 대입됩니다. `applyEvent`를 재사용해 공용 reducer와 전이가 갈라지지 않게 했습니다.

```tsx
// item-text.tsx
import { useSelector } from "@xstate/store-react";
import type { ItemId } from "./engine-events";
import { chatStore } from "./xstate-chat-store";

export function ItemText({ itemId }: { readonly itemId: ItemId }) {
  const text = useSelector(chatStore, (snapshot) => {
    const item = snapshot.context.items[itemId];
    return item?.kind === "text" ? item.text : "";
  });
  return <span>{text}</span>;
}
```

검토 메모: `useSelector<TSnapshot, T>(store: Readable<TSnapshot>, selector, compare?)` 오버로드가 d.ts에 있고 기본 `compare`는 `===`입니다 (소스 확인).

### 3순위 TanStack Store: 스토어와 구독

```ts
// tanstack-chat-store.ts
import { Store } from "@tanstack/store";
import { applyEvent, type ChatState, type EngineEvent } from "./engine-events";

const initial: ChatState = { itemIdsByThread: {}, items: {} };

// createStore(initial)도 같은 Store<ChatState>를 돌려준다 (d.ts 확인).
export const chatStore = new Store<ChatState>(initial);

export function onEngineEvent(event: EngineEvent): void {
  chatStore.setState((state) => applyEvent(state, event));
}
```

검토 메모: `Store`의 생성자 오버로드는 (1) 함수를 받는 읽기 전용 파생값, (2) `initialValue: T`, (3) `initialValue`와 `actionsFactory`입니다. `ChatState`는 함수 타입이 아니므로 (2)가 선택됩니다. `setState(updater: (prev: T) => T)`는 업데이터 함수만 받습니다.

```tsx
// item-text.tsx
import { useSelector } from "@tanstack/react-store";
import type { ItemId } from "./engine-events";
import { chatStore } from "./tanstack-chat-store";

export function ItemText({ itemId }: { readonly itemId: ItemId }) {
  const text = useSelector(chatStore, (state) => {
    const item = state.items[itemId];
    return item?.kind === "text" ? item.text : "";
  });
  return <span>{text}</span>;
}
```

검토 메모: `useSelector<TSource, TSelected>(source: { get; subscribe }, selector?, options?)`에 `Store<ChatState>`가 구조적으로 대입됩니다 (`subscribe`의 인자 타입이 함수를 포함하는 유니온이라 반공변 검사 통과). 기본 `compare`는 `===`입니다.

## 13. 출처

- Preact: https://github.com/preactjs/signals/tree/main/packages/react (README), 3.12.0 tarball의 `runtime/src/index.ts`와 `runtime/dist`, `dist`, `utils/dist`
- React: https://react.dev/reference/react/useSyncExternalStore, https://react.dev/learn/react-compiler/introduction, https://react.dev/reference/react-compiler/target, https://react.dev/reference/rules/components-and-hooks-must-be-pure, https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library
- Zustand: 5.0.16 tarball의 `react.d.ts`, `vanilla.d.ts`, `esm/react.mjs`, README (https://github.com/pmndrs/zustand)
- Valtio: https://raw.githubusercontent.com/pmndrs/valtio/main/README.md, https://blog.axlight.com/posts/thoughts-on-state-management-libraries-in-the-react-compiler-era/ (제작자 글, 2025-01-07, [2차])
- Redux: https://redux.js.org/usage/usage-with-typescript, https://redux.js.org/react-redux/api/hooks, https://redux.js.org/toolkit/api/createEntityAdapter, https://redux.js.org/toolkit/api/getDefaultMiddleware
- Legend-State: https://legendapp.com/open-source/state/v3/intro/introduction/, https://legendapp.com/open-source/state/v3/react/react-api/, https://github.com/LegendApp/legend-state/issues/477, https://github.com/LegendApp/legend-state/issues/653
- XState Store: https://stately.ai/docs/xstate-store (v4.x 문서), `@xstate/store` 4.3.0과 `@xstate/store-react` 2.1.0 tarball의 `.d.ts`와 소스, https://github.com/statelyai/xstate/issues/5426 (`@xstate/react` 관련)
- TanStack Store: `@tanstack/store` 0.11.2, `@tanstack/react-store` 0.11.2 tarball의 `dist/*.d.ts`와 `src/*`
- Jotai: https://github.com/pmndrs/jotai/releases/tag/v3.0.0, https://raw.githubusercontent.com/pmndrs/jotai/main/docs/guides/migrating-to-v3.mdx, https://raw.githubusercontent.com/pmndrs/jotai/main/docs/guides/typescript.mdx, https://raw.githubusercontent.com/pmndrs/jotai/main/docs/utilities/split.mdx
- MobX: https://mobx.js.org/observable-state.html, https://mobx.js.org/react-integration.html, mobx 7.1.0 tarball의 CHANGELOG, https://github.com/mobxjs/mobx/issues/3874
- npm 레지스트리 (`registry.npmjs.org/<패키지>`): 버전, 릴리스 시각, peer 의존성, `peerDependenciesMeta`
- bundlephobia API (`bundlephobia.com/api/size?package=...`): 번들 크기
- 복사 비용 측정 스크립트: scratchpad의 `bench/bench.mjs` (`/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/bench/bench.mjs`)
