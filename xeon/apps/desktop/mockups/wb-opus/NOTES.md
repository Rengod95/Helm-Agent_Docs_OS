# 작업대 1차 시안 W1–W5 (wb-opus)

스펙 `docs/xeon/L4/desktop-ux/spec.md` §4.9, §13(DP-01~39), §14, P-16·P-13·P-17·P-18·§6.30, ADR-0021을 따른 시안입니다.

- 개발 서버: `MOCKUP=wb-opus MOCKUP_PORT=8851 mise exec -- bun run mockup`
- 정적 빌드: `MOCKUP=wb-opus MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태 `?state=S1`~`S11`(기본 S1), 테마 `?theme=dark`.

## 폴더 방식

앱 하나(`wb-opus/`)에 다섯 화면을 둡니다. 화면 바꾸기는 셸의 영역 바꾸기와 작업대 내비(목업 안 로컬 상태)이고, `?state=`는 첫 화면과 조건만 정합니다. 화면 사이 흐름(런타임 탭 → 확장 상세, well "크게" → Helm 탐구, "대화로" → 런타임·탐구 well)이 이 시안의 요점이라 한 앱이 더 잘 보입니다.

| 상태 | 화면 | 보이는 것 |
|---|---|---|
| S1 | W1 개요 | 이 대화 한 줄, 층 × 확장 지도(helm drive, review 자동 꺼짐, acme-notes 실패 2), 주의, 최근 시험, 승격 후보 |
| S2 | W1 안전 모드 | 머리 아래 `Alert warning` + "보통 모드로 다시 시작", L3·plugin 행 연함("빠짐"), drive·확장 실패 칸 없음 |
| S3 | W2 확장 목록 | 거르기, 표, core-loop `Switch` 잠김 + `Tooltip`, 표 위 자동 꺼짐 `Alert danger`, 안전 모드·drive 그룹 |
| S4 | W2 오프라인 | 머리 `Alert` "엔진에 연결되면 바꿀 수 있어요", 모든 `Switch`·쓰기 동작 잠김, 상태 표시줄 "연결 끊김" |
| S5 | W3 helm 연결 지점 | 지점 표(fold, 예산, p50, p95, 예산 대비 막대, 실패). boundary.settle.after 24%라 tone 없음 |
| S6 | W3 review 기록 | 탭 위 `Alert danger` + 다시 켜기, scope.changed 자동 꺼짐 행, scope.handler_failed 다섯 줄과 `file:line` |
| S7 | W4 Helm 탐구 | 셸 머리(제목, helm · user · 0.1.0, "대화로") 아래 helm 트리: 주제·신호·멈춤, 단계, 렌즈 트리(실패 사례 펼침), 발견, 임대·토큰, 지난 탐구 |
| S8 | W4 확장 꺼짐 | 셸 자리표시 "Helm이 꺼져 있어요" + "확장 상세 열기", 트리 없음, 왼쪽 목록 "꺼짐" |
| S9 | W4 화면 오류 | 트리 안 한 노드만 자리표시 "이 앱 버전에서 못 그리는 부품(Sparkline)" + 진단 한 줄, 나머지 그림 |
| S10 | W5 런타임 탭 | P-02 위 런타임 well: drive 임대(helm, 턴·spawn·토큰), 대기 review·거부 work, 켜진 그룹과 확장(펼치면 지점), 전환 기록, 실패, "작업대에서 보기". 머리 런타임 줄, 한 줄 런타임 행, Helm card |
| S11 | W5 drive 없음 | 임대 구역 "지금 drive를 쥔 그룹이 없어요", 전환 기록에 임대 놓음 |

## 상호작용(로컬)

영역 바꾸기(⌘E, ⌥⌘1/2), 작업대 내비, 대화 맥락 칸(전체 ↔ 대화), 오른쪽 탭(영역마다 기억), 지도 칸·표 이름·런타임 탭 확장 행 → W3, 지도 화살표 키, `Switch` → "다음 단계 경계에 적용" 1초 뒤 바뀜 + 토스트, "다시 켜기", 거르기, W3 탭, 렌즈 펼치기·접기, 발견 작업 링크(토스트), well "크게" → W4, W4 "대화로" → 대화 영역 + Helm well, "작업대에서 보기" → W1. W6–W9 내비는 자리표시입니다.

## `_shell`에 더한 것(커밋 `xeon(desktop): 작업대 영역 셸`, 따로 cherry-pick 가능)

- 상태: `area`(chat·workbench), `contextThreadId`, 영역마다 오른쪽 탭 기억, `openEnd(tab, area?)`, `initialArea`·`initialWorkbenchTab`·`initialEndOpen`.
- 왼쪽 패널: 찾기 아래 `SegmentedControl`(대화·작업대), 작업대면 맥락 칸(`Select` + "대화로 가기" 같은 높이 `IconButton`), 작업대 내비 일곱(배지 `!1`, `1*`), "플러그인 화면" 목록(행 meta에 확장 id, 꺼지면 "꺼짐").
- 오른쪽: `chatRightTabs`(받은 요청, 런타임, 작업, 플러그인 well), `workbenchRightTabs`(받은 요청, 기록, 대화), 탭의 `ext`·`expand`(well 머리 확장 이름 + "크게").
- 상태 표시줄 `runtime` 칸(drive, 확장 실패), 0인 개수 칸 숨김(DP-27). 대화 내비 "연결" 삭제(작업대 엔진). 팔레트 "작업대" 묶음, 명령 아이콘 `Play`(DP-32).
- `WorkbenchHead`, `WB_WIDTH`, §14.5 고정 데이터(`workbench-fixtures.ts`), `RuntimeLog`, `ThreadTail`, `ToneIcon`.

## 쓴 caustic 부품

`SegmentedControl`, `Select`, `Input`, `ListNavigation*`, `SidePanel`, `FloatingBar*`, `Card`(well, outline), `Chip`(outline, icon, count), `Table`(ghost, xs, sortable, rowActions), `Switch`, `Tooltip`, `Tabs`(soft, xs, count), `ListDescription`, `Alert`(danger, warning), `Button`, `IconButton`, `Menu`, `Badge`, `Progress`, `Stepper`(ghost), `ActivityTree`(ghost, worker), `CardStat`(ghost, trend), `NumberField`, `EmptyState`, `Message`, `ToolCall`, `Composer`, `Toast`/`Toaster`. 아이콘은 `@caustic/react/icons`(Solar)만.

## 직접 만든 부품(`parts/`, 토큰만)

| 파일 | 빈틈 |
|---|---|
| `layer-map.tsx` | C-16 층 지도 배치(층 행 × 칩, 화살표 키 이동) |
| `ext-bits.tsx` | 상태 점 + 글(V-16 확장 행 조각), 층 mono 열, 라벨 + id, 구역 제목, `PLAIN_TABLE`(Table에 선 없는 변형이 없음) |
| `lens-tree.tsx` | `ActivityTree`에 단계 접기·펴기가 없음. 렌즈 행은 직접, 펼친 렌즈의 도구 호출은 `ActivityTree` |
| `view-host.tsx` | P-18 셸 틀(머리 첫 줄, 상태 자리표시, 오류 경계), 모르는 위젯 자리표시 |
| `_shell/parts/tone-icon.tsx` | DP-29 tone 아이콘 면 |

게이지(C-05 `Meter`)는 `Progress`로 대신했습니다. `Sparkline`(C-17)은 caustic `CardStat trend`에 이미 작은 추이 선이 있어 W3 측정 탭에 썼습니다.

## 하지 않은 것

wire, 렌더러(W4는 caustic 부품으로 직접 그리고 블록마다 `widget:` 주석), 라우팅, axe 실행(초점 고리·키보드 경로는 caustic 부품 그대로).

## 스크린숏

`shots/S1.png`~`S11.png`(1280px 라이트). 다크·1000·700은 `_notes/mock-shots/pages/wb-opus/`.
