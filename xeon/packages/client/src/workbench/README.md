# 크래프트 공유 상태 (`@fresnel/client/workbench`)

크래프트(LightCraft, 코드 id `workbench`)의 상태와 행 모델입니다. 순수 함수만 있고 스토어는 앱의 `state/workbench/`가 이 함수로 감쌉니다. 정본은 `docs/xeon/L4/desktop-ux/spec.md` §6.21~§6.24입니다. 소유는 T-BENCH이고, T-CANVAS(`canvas/`)는 이 값을 읽습니다.

## 규칙

- 전역만 다룹니다. 범위(이 대화·프로젝트)와 맥락 칸이 없습니다. 켜기·끄기는 `settings.set { key: "ext.<이름>.enabled", scope: "user" }` 하나입니다(`toggleRequestOf`).
- 그룹은 스위치 하나입니다(15-1). 구성원을 따로 끄지 않습니다.
- 면제 tier(`guard`, `core`), 안전 모드 제외, managed 켜짐은 스위치가 잠깁니다(`ExtRowVM.lock`). 이유 글(`lockText`)은 앱이 스위치를 감싼 `Tooltip`과 `aria-description`으로 보입니다.

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
- `countsOf`, `versionsViewOf(entry, load)`(버전 탭 그림, §6.24.1). 기록이 있으면 `history`(행: 지금 판은 되돌리기 불가, 상태 스키마가 높으면 `needsClearState`), 기록이 없거나 `unsupported`면 `fallback`(설치본, 기본 플러그인만 앱에 든 번들 버전), 읽기 실패는 `error`.
- `selectedEntry(state)`: 자세히 보기가 있으면 그 확장, 없으면 고른 플러그인·그룹의 확장. `selectedName(state)`는 고른 것만 본다(자세히 보기는 안 봄). `openLayerOf(state)`는 층 선택이면 그 층.
- 구성 요소 거르기(`contrib`)는 매니페스트(`ext.get`)가 있어야 걸 수 있어서 `visibleRows`는 걸지 않습니다. 지도·순서·링크·층 패널이 `snapshotOf`의 자기 데이터로 `keepsContrib`를 써서 맞지 않는 플러그인을 숨깁니다. 매니페스트를 못 읽은 플러그인(`unread`)은 넣어 주는 것을 모르므로 숨기지 않습니다.

## 캔버스 스냅샷 (`snapshot.ts`)

`snapshotOf(state)`는 `entries`·`details`·`health` 캐시를 캔버스의 `CanvasSnapshot`으로 옮깁니다(`canvas/types.ts`). 매니페스트는 `validateManifest`를 통과한 것만 씁니다. 엔진이 준 값이 없는 칸(역할, 그룹, 실패 훅과 기준 등)은 비워 두고 지어내지 않습니다. `ext.health`에는 훅과 기준이 없어서 `CanvasHealth.hook`·`limit`은 비워집니다.

## 앱 쪽

`apps/desktop/src/state/workbench/`가 스토어(`useWorkbench(selector)`, `useWorkbenchActions()`)와 읽기·쓰기 명령(`ext.list`, `settings.set`)을 가집니다.

## 앱 쪽 구현 (T-BENCH)

`apps/desktop/src/state/workbench/`(스토어와 훅), `src/app/workbench-commands.ts`(`commands.workbench`: `list`, `get`, `toggle`, `reenable`, `versions`, `rollback`, `onChanged`), `src/views/workbench/`(화면).

### 목록을 다시 읽는 때

`ext.list`, `ext.get`, `ext.health`, 훅 순서는 컨트롤러(`views/workbench/controller.ts`의 `reload`)가 스토어에 넣습니다. 다시 읽는 때는 다음과 같습니다.

- 화면을 열 때와 엔진이 연결된(live) 때.
- 자기 켜기·끄기(`toggle`)와 다시 켜기(`reenable`)가 성공한 뒤.
- `onChanged`(`settings.invalidated`에 `ext.` 키가 있거나 키 목록이 빈 것, 또는 내구 이벤트 묶음의 `scope.changed`)를 받을 때. 다른 창의 설정 변경과 백그라운드 자동 끄기가 여기에 든다. 구독은 연결이 살아 있는 동안 유지된다.

자동 꺼짐 띠, 개수, 캔버스의 점과 `autoOff` 표시는 스토어에서 읽으므로, 다시 읽은 값은 화면을 다시 마운트하지 않고 그대로 보인다.

### 개요 캔버스가 이 값을 읽는 법

`views/desktop-registry.tsx`의 `createDesktopRegistry()`는 `registerWorkbench(registry, store)`만 부릅니다. 개요(`overview`)는 `views/workbench/craft-screen.tsx`가 목록 띠를 올린 뒤 `views/craft`의 캔버스(지도·순서·링크)를 그립니다. 캔버스는 `useCraft()`로 스토어 값을 읽고 `dispatch`로 바꾸며, 원천(`CraftSource`)은 `useCraftSource`가 `snapshotOf`와 `detailsLoaded`·`healthLoaded`·`ordersLoaded` 캐시로 만듭니다. 켜기·끄기는 상태를 직접 바꾸지 않고 컨트롤러(`views/workbench/controller.ts`의 `useWorkbenchController().toggle`, 확인 대화 상자는 `useToggleRequest`)를 거칩니다. 훅 줄의 `추가`(15-3)는 `requestBuilder(hook)`로 요청만 남깁니다(빌더 화면은 T-AUTH).

확장 화면(`extensions`)은 같은 목록을 층마다 caustic `Table` 하나로 그리고(열: 이름, 층, 종류, 등급, 상태, 버전, 켜짐; §6.23), 고른 확장의 선택 패널(`SelectionPanel`)과 자세히 보기(`ExtDetail`, 버전 탭과 되돌리기 포함)를 그립니다. 행을 고르는 것은 Table의 `selectionMode="single"`과 `onRowActivate`가 맡고, 고른 행은 `aria-selected`로 보입니다. `sel`과 `detail`은 두 화면이 같이 씁니다.
