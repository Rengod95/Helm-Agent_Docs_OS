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
| `selected` | 고른 확장 이름. 지도와 순서가 같이 읽고 `select`로 씀 | T-CANVAS, 선택 패널 |
| `detail` | 자세히 보기로 열린 확장. 있으면 캔버스 전체가 그 확장 하나 | `openDetail`/`closeDetail` |
| `layer` | 층 패널이 열린 층(`L1`·`L2`·`L3`·`external`) | 지도의 고리, `openLayer` |
| `query`, `kinds` | 찾기와 "구성 요소" 필터 | 도구 막대 |
| `pending` | 끄기·켜기 요청이 반영되길 기다리는 이름 → 목표 값 | `markPending`, 목록이 반영하면 자동으로 걷음 |

목록이 들어오면(`listLoaded`) 사라진 확장을 가리키던 `selected`·`detail`이 풀립니다.

## 읽기 함수

- `visibleRows(state)`: 찾기로 거른 확장 행(`ExtRowVM`: 표시 이름, 층, 종류 `group|plugin|core`, 등급, 상태, 잠금, 실패, 대기 목표).
- `layerGroups(state)`: 층별 묶음(L1 → L2 → L3 → 그 밖). 지도 고리와 층 패널의 재료.
- `countsOf`, `selectedEntry`, `versionRows(ext.versions)`(버전 탭, 지금 판은 되돌리기 불가, 상태 스키마가 높으면 `needsClearState`).
- 구성 요소 필터(`kinds`)는 매니페스트(`ext.get`)가 있어야 걸 수 있어서 `visibleRows`는 걸지 않습니다. 지도·순서가 자기 데이터로 겁니다.

## 앱 쪽

`apps/desktop/src/state/workbench/`가 스토어(`useWorkbench(selector)`, `useWorkbenchActions()`)와 읽기·쓰기 명령(`ext.list`, `settings.set`)을 가집니다.
