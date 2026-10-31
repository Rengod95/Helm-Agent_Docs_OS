# P-03 받은 요청 (p03-inbox)

- 실행: `MOCKUP=p03-inbox MOCKUP_PORT=<포트> mise exec -- bun run mockup` · 상태 `?state=S1`~`S9`, `?theme=dark`
- 상태: S1 기본(도구 승인 펼침) · S2 계획 카드 · S3 변경 검토 카드 · S4 보내는 중·원격·만료·실패(closed) · S5 빈 · S6 읽는 중 · S7 오류(knowledge 제안·알림 읽기 실패) · S8 오프라인 · S9 권한 필요(원격 build-box, allowRespond 꺼짐)

## 배치

- 무대 전체를 쓰는 읽기 열(46rem, P-02와 같은 폭). 머리 한 줄: 제목 · 종류 `SegmentedControl`(개수) · 대화·정렬 `Select`. 경로·키 표시 없음.
- 묶음(승인 · 제안 · 알림)은 제목과 간격으로만 나눔. "모두 읽음"은 알림 묶음 머리 끝, "제안 화면에서 보기"는 제안 묶음 머리 끝(기능이 속한 자리, DP-05).
- 행은 두 줄: 1줄 종류 · 요약(명령은 mono), 2줄 원인 대화 · **낸 쪽(코어 루프, plan 모드, review 도구, Helm 그룹 + lens, learning 그룹, knowledge 능력, 예약, ext:lint-bot)**. 행을 누르면 그 자리에서 카드로 펼침(트랜스크립트·well과 같은 카드).
- 이 화면이 곧 받은 요청이라 오른쪽 well은 닫아 둠(막대 아이콘만).

## caustic

`SegmentedControl`, `Select`, `ScrollArea`, `Alert`, `EmptyState`, `Skeleton`, `AgentRequest`(permission·기록), `ListDescription`, `Textarea`, `Button`, `Badge`, `IconButton`, 공용 `ToolApprovalCard`·`QuestionCard`.

## 직접 만든 부품

- `parts/inbox-row.tsx` — C-02 알림함 행(종류·출처·원인 대화·안 읽음). 공용 `NoticeList`와 같은 치수.
- `parts/request-card.tsx` — 계획·변경 검토 카드. `AgentRequest` proposal은 영어 "Proposal ·" 머리, review는 떠 있는 패널이라 `QuestionCard` 치수로 직접.

## 다르게 한 것

- 주 내비 배지(5)는 공용 고정값이라 이 화면 합계(10: 승인 5 + 제안 3 + 안 읽은 알림 2)와 다름.
- 계획·검토 버튼 순서는 caustic 규칙(거부 시작 쪽, 확정 끝 쪽).
