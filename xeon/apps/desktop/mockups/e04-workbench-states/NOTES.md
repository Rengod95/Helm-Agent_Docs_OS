# e04 크래프트 상태와 결과 없음 (N-47, N-48)

## 공통 규칙
- 읽는 중: 실제 행과 같은 높이·열의 Skeleton(5행). 자리가 튀지 않습니다. 화면 머리 둘째 줄은 "읽는 중…", 쓰기 버튼은 잠금.
- 읽기 실패: 그 목록 자리에 `Alert tone="danger"` 하나와 "다시 읽기"(DP-28). 원인은 wire 메서드와 짧은 사유(`ext.list 시간 초과(5초)`).
- 오프라인: 머리 아래 `Alert warning inline` "엔진에 연결되면 바꿀 수 있어요 · 마지막 값 14:03", 읽은 값은 그대로, 쓰기 잠금(§6.0).
- 빈: 무엇이 없는지 한 문장 + 다음 동작 하나. 사용자 확장이 없는 P-13은 "내장 6개는 그대로 돌아요"를 같이 말해 빈 화면을 고장으로 읽지 않게 합니다.
- 결과 없음(N-48): 찾은 말과 거르기를 그대로 되풀이("\"lint\" · 층 L3와 맞는 것이 없어요") + "거르기 지우기" 하나. 다른 곳에 있을 법하면 둘째 동작 하나(팔레트: "버전 되돌리기는 크래프트 확장 상세의 버전 탭에", P-06: "지난 제안까지 찾기", P-09: 비슷한 키).
- 50개 넘는 목록(P-20): 머리 둘째 줄 "확장 64 · 위 50개만 그리고 스크롤하면 이어서", 찾기 칸이 표 위에 나타나고, 표 머리는 붙박이(sticky), 끝에 "14개 더 읽는 중…"(가상 목록 `[gap:C-04]`).

## 화면별
- P-13: `ext-list`, `ext-loading`, `ext-empty`, `ext-filter-empty`, `ext-error`.
- P-17: 탭은 caustic `Tabs`(underline) 여덟. 탭마다 상태: `detail-loading`(훅 표 Skeleton), `detail-offline`(마지막 값 + 끄기 잠금), `detail-empty`(화면 탭 "기여한 화면이 없어요"; 기록·버전·주도 탭 문장도 정해 둠), `detail-error`(주도 탭 "ext.get 거부(권한 없음)").
- P-20: `metrics-loading`, `metrics-many`, `metrics-empty`(기간), `metrics-off`(계측 꺼짐: neutral Alert + "계측 켜기").
- 팔레트(`palette-empty`, `palette-empty-wb`): 왼쪽 패널 찾기 칸은 팔레트를 여는 것이라 "왼쪽 패널 찾기 결과 없음" = 팔레트 결과 없음입니다. 셸에 `paletteQuery`, `paletteEmpty`(선택 prop)를 더했습니다.
- P-06(`proposals-empty`), P-09 키 찾기(`settings-empty`, 탭 열은 찾은 수 0으로 모두 연함).

## caustic 부품
`Alert`, `Button`, `EmptyState`(icon `SearchX`), `Input`, `ListDescription`, `Progress`, `SegmentedControl`, `Select`, `Skeleton`, `Tabs`, 셸 `Palette`(Combobox `defaultInputValue`, `emptyMessage`).

## 직접 만든 것과 빈틈
- `parts/ext-table.tsx`: P-13 표(열 최소·최대 폭 격자, 긴 라벨 말줄임, 읽기 전용·잠금 이유·행 메뉴 선택 prop). e01·e05도 씁니다. caustic Table은 열 폭을 내용 길이로 늘려 영어 라벨에서 가로 스크롤이 생깁니다(빈틈 제안: 열 `minWidth`·`maxWidth`·`truncate`).
- 가상 목록은 caustic에 없어(`[gap:C-04]`) 50행 + "더 읽는 중" 줄로 흉내 냈습니다.

## 웹·좁은 폭
- 700: P-13은 등급·버전 열, P-20은 주도 시간·실패 열을 뺍니다. 390: 크래프트는 읽기 전용 목록(e05 `m-workbench`).
