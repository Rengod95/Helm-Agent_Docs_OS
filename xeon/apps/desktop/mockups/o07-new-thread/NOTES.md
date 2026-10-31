# O-07 새 대화 (o07-new-thread)

- 상태: S1 최근 폴더 · S2 최근 없음(첫 실행) · S3 상대 경로 · S4 호스트 거절 · S5 만드는 중. 바탕은 대화를 고르지 않은 P-02(`quiet-page.tsx`, O-09·S-04도 씀).
- `Dialog`(sm) + `Field`/`Input`(절대 경로 검사 `checkWorkspaceInput` 규칙, 비우면 "폴더 없이 만들기") + 최근 폴더 `ListNavigation`. 폴더 고르기 버튼은 그려 두었지만 OS 대화 상자는 [gap:W-19].
- `new-thread-dialog.tsx`는 P-01 S10도 가져다 써요.
