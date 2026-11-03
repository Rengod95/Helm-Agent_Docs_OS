# 크래프트 공유 상태 (`@fresnel/client/workbench`)

크래프트(LightCraft, 코드 id `workbench`)의 상태와 행 모델입니다. 순수 함수만 있고 스토어는 앱의 `state/workbench/`가 이 함수로 감쌉니다. 정본은 `docs/xeon/L4/desktop-ux/spec.md` §6.21~§6.24입니다. 소유는 T-BENCH이고, T-CANVAS(`canvas/`)는 이 값을 읽습니다.

## 규칙

- 전역만 다룹니다. 범위(이 대화·프로젝트)와 맥락 칸이 없습니다. 켜기·끄기는 `settings.set { key: "ext.<이름>.enabled", scope: "user" }` 하나입니다(`toggleRequestOf`).
- 그룹은 스위치 하나입니다(15-1). 구성원을 따로 끄지 않습니다.
- 면제 tier(`guard`, `core`), 안전 모드 제외, managed 켜짐은 스위치가 잠깁니다(`ExtRowVM.lock`).

## 상태 `WorkbenchState`

| 필드 | 뜻 | 누가 씀 |
|---|---|---|
| `list`, `entries` | `ext.list` 읽기 상태와 결과 | 앱이 `listLoading`/`listLoaded`/`listFailed`로 |
| `view` | `orbit`(기본), `strata`, `link` | 도구 막대 `setView`. 바꾸면 자세히 보기가 닫힘 |
| `sel`, `panel` | 캔버스 선택(`Sel`: 에이전트, 층, 플러그인, 그룹, 훅 줄, 내장 슬롯)과 선택 패널이 열렸나. 처음은 `clearSel()` 값 | `pickPlugin`·`pickGroup`·`pickSel`·`clearPick`, 지도·순서·선택 패널 |
| `detail` | 자세히 보기로 열린 플러그인·그룹 id(루트는 확장 이름). 있으면 캔버스 전체가 그 하나로 바뀜. 선택은 바꾸지 않음 | `openDetail`/`closeDetail` |
| `query`, `kind`, `contrib` | 찾기, 플러그인 종류 거르기(`KindFilter`), 넣어 주는 것 거르기(`Contrib[]`, 토글) | 도구 막대 |
| `details` | `ext.get` 캐시: 확장 이름 → 결과(매니페스트·훅·기능 엣지) | `detailsLoaded` |
| `health` | `ext.health` 캐시: 등록 id(`registrationId`) → 실패 장부 | `healthLoaded`(전체를 바꿈) |
| `order` | 훅 → 적용 중인 등록 id 순서 | `ordersLoaded` |
| `pending` | 끄기·켜기 요청이 반영되길 기다리는 이름 → 목표 값 | `markPending`, 목록이 반영하면 자동으로 걷음 |
| `builder` | 빌더 화면을 열라는 요청(15-3) | `requestBuilder`/`closeBuilder` |

등록 id는 루트 플러그인이면 확장 이름, 구성원이면 `<확장>/<id>`입니다. `extOf(id)`가 확장 이름을 돌려줍니다.

목록이 들어오면(`listLoaded`) 사라진 확장을 가리키던 `sel`(플러그인·그룹일 때)·`detail`·`details`가 풀립니다. 선택을 풀면 `panel`도 닫힙니다.

## 읽기 함수

- `visibleRows(state)`: 찾기로 거른 확장 행(`ExtRowVM`: 표시 이름, 층, 종류 `group|plugin|core`, 등급, 상태, 잠금, 실패, 대기 목표).
- `layerGroups(state)`: 층별 묶음(L1 → L2 → L3 → 그 밖). 지도 고리와 층 패널의 재료.
- `countsOf`, `versionRows(ext.versions)`(버전 탭, 지금 판은 되돌리기 불가, 상태 스키마가 높으면 `needsClearState`).
- `selectedEntry(state)`: 자세히 보기가 있으면 그 확장, 없으면 고른 플러그인·그룹의 확장. `selectedName(state)`는 고른 것만 본다(자세히 보기는 안 봄). `openLayerOf(state)`는 층 선택이면 그 층.
- 구성 요소 거르기(`contrib`)는 매니페스트(`ext.get`)가 있어야 걸 수 있어서 `visibleRows`는 걸지 않습니다. 지도·순서가 `snapshotOf`로 자기 데이터로 겁니다.

## 캔버스 스냅샷 (`snapshot.ts`)

`snapshotOf(state)`는 `entries`·`details`·`health` 캐시를 캔버스의 `CanvasSnapshot`으로 옮깁니다(`canvas/types.ts`). 매니페스트는 `validateManifest`를 통과한 것만 씁니다. 엔진이 준 값이 없는 칸(역할, 그룹, 실패 훅과 기준 등)은 비워 두고 지어내지 않습니다. `ext.health`에는 훅과 기준이 없어서 `CanvasHealth.hook`·`limit`은 비워집니다.

## 앱 쪽

`apps/desktop/src/state/workbench/`가 스토어(`useWorkbench(selector)`, `useWorkbenchActions()`)와 읽기·쓰기 명령(`ext.list`, `settings.set`)을 가집니다.

## 앱 쪽 구현 (T-BENCH)

`apps/desktop/src/state/workbench/`(스토어와 훅), `src/app/workbench-commands.ts`(`commands.workbench`: `list`, `get`, `toggle`, `reenable`, `versions`, `rollback`), `src/views/workbench/`(화면).

### T-CANVAS가 보기를 채우는 법

`views/desktop-registry.tsx`의 `createDesktopRegistry()`에서 `slots`를 만들어 `registerWorkbench(registry, store, slots)`에 넘깁니다. 지도·순서·링크는 같은 곳에서 등록합니다.

```ts
slots.register("orbit", () => <OrbitView />);   // "strata", "link"도 같은 방식. 두 번 등록하면 Bug
```

보기는 props 없이 `useWorkbench(selector)`로 상태를, `useWorkbenchActions()`로 `pickPlugin`·`pickGroup`·`pickSel`·`clearPick`·`openDetail`·`toggleContrib`·`requestBuilder(hook)`를 씁니다. 지도가 쓰는 `ext.get`·`ext.health`·`hooks.order.get` 결과는 `detailsLoaded`·`healthLoaded`·`ordersLoaded`로 넣습니다. 켜기·끄기는 상태를 직접 바꾸지 않고 선택 패널·층 목록이 쓰는 컨트롤러(`views/workbench/controller.ts`의 `useWorkbenchController().toggle`)를 부르거나, 행 부품 `ExtSwitch`(`views/workbench/ext-row.tsx`)를 그대로 씁니다. 슬롯이 비어 있으면 개요는 층별 목록(`LayerList`)을 보입니다. 선택 패널과 자세히 보기(`ExtDetail`)는 이 화면이 그리고, 훅 줄의 `추가`(15-3)는 `requestBuilder(hook)`로 요청만 남깁니다(빌더 화면은 T-AUTH).

### 스펙에 반영할 것 (`L4.desktop-ux` §6.22.0·§6.23·§6.24 [결정: 2026-11-04 사용자])

스펙 본문은 `m4/spec` 브랜치에 있어 이 브랜치에서 고치지 않았습니다. 병합할 때 다음을 적습니다.

- 크래프트 내비는 §4.9.3의 여섯 항목 그대로입니다: 개요(`overview`)가 지도·순서·링크를 담은 캔버스, 확장(`extensions`)이 같은 `ext.list`의 층별 목록, 엔진(`engine`)이 P-15입니다.
- 켜기·끄기는 `settings.set { key: "ext.<이름>.enabled", scope: "user" }` 하나이고 잠기는 행은 면제 tier(`guard`, `core`), 안전 모드 제외, managed 켜짐입니다.
- O-10은 "처음 켜는" 기록이 없어서 꺼져 있던 `user`·`project` 위치 확장을 켤 때마다 묻습니다 [제안: 기본값].
- 버전 탭은 §6.24.1 전체 단계(`ext.versions`, `ext.rollback`, O-11)입니다. 되돌린 판이 `restart`에 적용되면 토스트가 그 사실을 알립니다.
