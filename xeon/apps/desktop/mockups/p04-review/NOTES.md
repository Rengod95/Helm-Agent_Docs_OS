# P-04 변경 검토 (p04-review)

- 상태: S1 기본(결정 중, 제출 잠김) · S2 줄 의견 쓰는 중 · S3 제출 결과(되돌림·충돌, deliverAs) · S4 바이너리·본문 읽기 실패 · S5 라운드 2(지난 의견 "전달됨") · S6 읽는 중 · S7 빈(no_changes) · S8 오프라인

## 배치

- 머리 한 줄: 돌아가기(받은 요청) · 제목 · 라운드 · 원인 대화. 낸 쪽과 전체 +/−는 내지 않음. 경로 없음(DP-05).
- 무대 안 두 열: 파일 열(caustic `ListNavigation` sessions — 상태 글자, 경로, 결정 수 `2/4`, 의견 묶음) · diff 열. 좁은 폭(≤720)은 파일 열 대신 파일 `Select`.
- 파일 머리: 경로 · +/− · 파일 거절/승인. 그 아래 hunk 카드.
- 제출 줄: 대기·승인·거절 집계, 막힌 이유("대기 hunk 4개를 먼저 정해요"), 남은 것 모두 승인, 검토 닫기, 제출. 선 없이 간격만.
- 결정은 승인·거절 버튼의 눌림으로만 보인다(hunk 배지 없음, 파일 단위 칸만 배지). 거절한 hunk는 줄을 흐리게.

## caustic

`CodeDiffLine`, `codeDiffVariants`, `ListNavigation*`, `ScrollArea`, `Badge`, `Button`(aria-pressed), `Checkbox`, `Textarea`, `Alert`, `ListDescription`, `EmptyState`, `Skeleton`, `Select`, `IconButton`.

## 직접 만든 부품 — C-08

`parts/hunk-review.tsx`: hunk 머리(헤더 줄, 승인·거절·의견) + 줄 의견 칸. 줄과 카드 겉모양은 caustic 것을 그대로 쓰고, 의견 자리에서 `<pre>`를 나눔.
caustic 제안 API: `<CodeDiff>` 안 `<CodeDiffHunk header decision onDecide actions>`와 줄 뒤 `<CodeDiffComment>` 슬롯, `CodeDiffLine`의 `onComment`(줄 번호 hover +).
