# e04 크래프트 상태와 결과 없음 (N-47, N-48)

redesign의 화면 구성과 내용을 옛 언어(옛 팔레트·글자 크기·그림자·반지름, caustic 기본 변형)로 옮겼습니다. 표와 지표 칸은 `_shell`의 선 격자(`LineGrid`·`LineGridBlock`·`LineGridMetric`, 십자 표식과 빗금 칸)를 씁니다.

## 공통 규칙
- 읽는 중: 실제 칸과 같은 자리의 Skeleton(선 격자 안 5행). 머리 설명 줄은 두지 않고 쓰기 버튼만 잠급니다.
- 읽기 실패: 그 목록 자리에 soft `Alert tone="danger"` 한 줄과 "다시 읽기"(DP-28). wire 메서드·사유 코드는 진단 화면 몫이라 넣지 않습니다.
- 오프라인: 머리 아래 soft warning 한 줄 "오프라인이라 바꿀 수 없어요", 읽은 값은 그대로, 쓰기 잠금(§6.0).
- 빈: `EmptyState` 제목 한 줄 + 동작 하나. 그림(아이콘)은 결과 없음 한 곳에만.
- 결과 없음(N-48): `NoMatch`(parts/screens.tsx) 한 곳. 찾은 말을 되풀이하고 "거르기 지우기" 하나, 다른 곳에 있을 법하면 둘째 동작(ghost) 하나.
- 50개 넘는 목록(P-20): 찾기 칸 + 선 격자, 페이지가 스크롤합니다. 가상 목록은 caustic에 없어(`[gap:C-04]`) 50행으로 흉내 냅니다.
- 상태 점은 실패 있음(warning)과 자동 꺼짐(danger)에만. 켜짐·꺼짐은 글자만입니다(`LineGridDot`에 success 점이 없어 디자인 언어 §3과 맞습니다).

## 화면별
- P-13: `ext-list`, `ext-loading`, `ext-empty`, `ext-filter-empty`, `ext-error`. 표는 `parts/ext-list.tsx`(선 격자, 층이 바뀌는 경계에 표식, 층은 사람 말).
- P-17: 탭은 caustic `Tabs`(underline) 여덟. 탭마다 상태: `detail-loading`(훅 표 Skeleton), `detail-offline`(마지막 값 + 끄기 잠금), `detail-empty`(화면 탭 "기여한 화면이 없어요"), `detail-error`(주도 탭 "이 탭을 읽지 못했어요"). 훅 표는 `LineGrid`(훅·시간 예산·실패), 측정 탭은 `LineGridBlock` + `LineGridMetric` 세 칸.
- P-20: `metrics-loading`, `metrics-many`, `metrics-empty`(기간), `metrics-off`(계측 꺼짐: EmptyState + "계측 켜기" outline). 위에 합계 `LineGridMetric` 세 칸, 아래 `LineGrid`(확장·토큰·비용·실패). 합계는 행을 더해 그립니다.
- 팔레트(`palette-empty`, `palette-empty-wb`): 결과 없음 한 줄. 셸에 `paletteQuery`, `paletteEmpty`를 씁니다.
- P-06(`proposals-empty`), P-09 키 찾기(`settings-empty`): `NoMatch`를 그대로 씁니다.

## 옛 언어로 옮기며 정한 것
- 글자와 색은 옛 caustic 토큰만 씁니다(`text-title-3`·`text-ui-xs`·옛 warning·danger 그래픽).
- `parts/ext-table.tsx`는 `_wb-c/ext-table`을 다시 내보내는 감싸개입니다. e01·e05가 이 경로에서 `ExtTable`을 가져갑니다. 표 본체와 `statusOf`·`trustLabel`은 `_wb-c/ext-table.tsx`에 있습니다.
- redesign에서 줄인 문장을 따랐습니다: 팔레트 빈 상태의 둘째 줄("버전 되돌리기는…"), 설정 키 찾기의 "결과 0" 머리 글, 확장 목록 실패의 원인 사유.
- 오프라인 칸의 설명 한 줄은 남겼습니다. `_shell`의 상태 칸은 `description`을 필수로 그려서 빼면 팝오버가 빕니다.

## 빈틈
- 선 격자 머리 글(`Head`, `text-title-3`)은 옛 caustic에서 600이라 행 이름과 머리 글이 같은 무게로 무거워 보입니다(`_shell/line-grid.tsx`).
- 화면 머리 줄을 표 위에 붙박이로 둘 수 없습니다(옛 `Table maxHeight`의 붙박이 머리에 해당하는 것이 선 격자에 없습니다).
- 훅 이름은 redesign대로 평문입니다. DP-39의 mono 기계 값 규칙과는 다릅니다.

## 웹·좁은 폭
- 700 미만(compact): P-13은 신뢰 수준 열을 뺍니다. P-20은 열을 줄이지 않습니다. 390: 크래프트는 읽기 전용 목록(e05 `m-workbench`).
