# P-06 제안 (p06-proposals)

- 상태: S1 기본(untrusted 경고, 범위 선택) · S2 충돌(ext:bun-kit의 test-runner) · S3 수정 중 · S4 거절 메모 · S5 적용됨·되돌리기 · S6 빈 · S7 읽는 중 · S8 오류(knowledge 못 읽음 + revision_mismatch) · S9 오프라인

## 배치

- 머리: 제목 · 상태 `SegmentedControl`(대기 3·적용됨·모두) · 종류·출처 `Select`.
- 무대 안 두 열(투명): 목록(listbox, 두 줄 행: 종류·대상 / **낸 쪽** · 근거나 충돌) · 상세(region). 좁은 폭은 상세만 보이고 돌아가기로 목록.
- 상세 순서: 제목(종류·대상·rev) → 경고 `Alert`(untrusted·충돌) → `ListDescription` 한 목록(낸 쪽 + id + Helm 발견 경유, 이유, 근거 "대화에서 보기", 범위 `RadioGroup`) → 읽기 전용 `CodeDiff` → 결정 줄(거절 시작 쪽, 수정·승인 끝 쪽, 승인 버튼에 고른 범위).

## caustic

`SegmentedControl`, `Select`, `ScrollArea`, `CodeDiff`(actions 끔)/`CodeDiffLine`, `ListDescription`, `RadioGroup`, `Textarea`, `Alert`, `Badge`, `Button`, `EmptyState`, `Skeleton`, `IconButton`.

## 빈틈

- 목록 행은 직접(`page.tsx` `Row`): caustic `List`는 표면(grouped)을 그려 투명 무대와 맞지 않고, `ListNavigationItem`은 한 줄.
- 충돌 스킬 나란히 보기는 없음(W-14 본문 읽기 wire, C-08 텍스트 비교). 경고 문장으로 대신.
