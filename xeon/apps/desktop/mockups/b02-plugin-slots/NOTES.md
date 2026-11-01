# B02 대화 영역의 플러그인 기여 — 메모

## 범위

coverage-v2 N-21(well), N-22(card), N-23(status), N-24(command). 대화 "캐시 무효화 조사" 하나에서 켜진 확장(Helm, 작업 흐름, 검토, 학습, Exa 웹 검색, Acme 노트, 턴 비용, 집중 시간)의 기여를 그립니다.

## 레이아웃 결정

- well: 막대의 플러그인 탭은 6개까지(`MAX_PLUGIN_TABS`)이고 넘치면 막대 끝 "더 보기"(`Ellipsis`) 메뉴로 갑니다. 메뉴 행은 표시 이름 + 회색 mono id입니다. 고른 탭이 메뉴 안이면 "더 보기" 칸이 켜진 모양입니다.
- 자체 코드 well은 기본 폭 400, 넓은 폭에서만 왼쪽 끝 `ResizeHandle`(320~480, 8px 단위)을 둡니다. 폭은 탭마다 기억합니다. 1100px 이하에서는 well이 내용 위에 뜨는 시트라 손잡이가 없습니다(폭 352 고정).
- card: 셸 틀은 `Card`(outline, sm) 하나, 머리는 확장 아이콘 · 표시 이름 · 회색 id(연한 글자). 높이 320을 넘으면 아래를 흐리게 하고 "더 보기" 하나(같은 확장 well, 없으면 page). 카드 동작("탐구 화면 열기")은 트리 안에 둡니다.
- card 실패: 카드 대신 일반 항목 한 줄(kind mono + 요약)과 연한 둘째 줄(사유), 동작은 "기록" 하나(DP-19).
- status: 공용 상태 칸 모양(`Button xs ghost` + `Popover`)을 그대로 쓰고 확장 아이콘을 앞에 둡니다. 글은 24자에서 말줄임, 전체 글은 Popover 첫 줄. tone은 점 하나(neutral이면 점 없음, DP-29). 넓은 폭은 전부, 중간 폭은 진행권 그룹의 칸 하나만, compact는 없음 [제안: spec은 compact만 정함].
- 대화 머리 런타임 줄은 진행 그룹의 status 글을 그대로 씁니다(§6.30).
- command: 팔레트 "플러그인" 묶음, 아이콘 `Package`, 확장 id는 연한 mono 설명. 꺼진 확장 명령은 목록에서 빠집니다. 시안은 이 묶음을 맨 위에 두었습니다(스크린숏용). 실제 순서는 §4.5를 따릅니다.

## caustic

`Card`, `Composer`, `Message`, `ToolCall`, `EmptyState`, `ListDescription`, `Badge`, `Button`, `Stepper`, `Tooltip`, `Menu`, `ResizeHandle`, `Popover`(상태 칸), `Combobox`(팔레트), `Toaster`.

## `_shell` 변경(일반적인 것만)

- `right-panel.tsx`(앞 실행에서 옴): `RightTab.width`, `RightTab.resizable`, `MAX_PLUGIN_TABS`와 "더 보기" 메뉴.
- `parts/status-bar.tsx`: `StatusCell.content`(Popover 설명 아래 더 그릴 내용).
- `palette.tsx`: "플러그인" 묶음 아이콘(`Package`), 설명을 mono로.

## 빈틈

- caustic에 높이 상한 + 흐림 + "더 보기"를 가진 카드 틀이 없습니다(`parts/cards.tsx`).
- 헤드리스 스크린숏에서 메뉴·Popover를 펴려고 `useAutoOpen`이 트리거에 pointerdown/click을 보냅니다. 목업 전용입니다.
