# d01 대화 영역 빈칸 (N-42~N-46, O-06, 계획에 없음 6)

## 레이아웃 결정
- 무대는 p02·묶음 A와 같은 `_chat-rt` 머리·트랜스크립트·입력창입니다. "새 메시지 N"을 위해 `ChatStage`를 이 폴더의 `Stage`로 다시 짰습니다(위로 올려 읽는 동안 바닥 따라가기를 멈추고 알약을 스크롤 영역 아래 가운데에 띄움).
- 띠는 입력창 바로 위 한 자리만 씁니다: 이어서 실행(warning, 동작 둘), 앱 재시작 직후(neutral). turn 실패는 트랜스크립트 끝 `Alert danger`입니다(§6.6 F, 다음 턴 시작 때 지움).
- 이어서 실행 결과 셋은 띠를 걷고 트랜스크립트 런타임 행 한 줄로 남깁니다(DP-19). 실패 성격인 `closed`만 warning 아이콘 면입니다.
- 긴 도구 결과는 펼치면 400자까지, "전체 보기 · n자 더"로 나머지. 결과 상자는 최대 높이 뒤 스크롤합니다.
- 승인 카드 네 종류는 `parts/approval-card.tsx`의 `ApprovalCard` 하나로 트랜스크립트·well·P-03 무대에 같은 머리 규칙(종류 · 출처 · 시각, 받은 요청이면 앞에 대화 이름)을 씁니다. 도구 카드만 제목이 도구 이름이라 둘째 줄 앞에 "도구 실행"을 둡니다. well 안에서는 테두리 없는 flat 변형(DP-20). P-03 무대가 열리면 well은 닫습니다(DP-34).
- 대화 행 메뉴는 왼쪽 목록 행 hover·초점·메뉴 열림일 때 보이는 ⋯ 버튼과 대화 머리 ⋯ 두 곳에서 같은 항목입니다. 항목: 이름 바꾸기, 분기, 대화 요약, 내보내기…, (예약 대화면) 예약 지우기…, 닫기, 지우기…(danger).
- O-06 대화 변형은 지워지는 것(메시지·첨부)과 남는 것(분기한 대화·예약)을 `ListDescription` 한 목록으로 보입니다. 실행 중인 대화는 지우지 않고 이유와 "닫기"만 둡니다.
- 내보내기: Markdown(읽기)·JSON(항목 원형). 시크릿 값은 어떤 형식에도 없고 핸들만 남깁니다. 파일 고르기는 OS 저장 대화 상자로 넘기므로 버튼이 "저장…"입니다.
- 목록 상태(셸 `ThreadListProps` 새 선택 항목): `listState`(loading·error), `onRetry`, `more`, `dimmed`, `rowMenu`, `menuOpenId`. 주지 않으면 예전과 같습니다.

## caustic 부품
`Alert`, `Button`, `Card`, `Checkbox`, `Dialog`(alert), `EmptyState`, `IconButton`, `Input`, `ListDescription`, `ListNavigation`, `Menu`·`MenuItem`·`MenuSeparator`, `Progress`, `RadioGroup`, `ScrollArea`, `Select`, `Skeleton`, `Toaster`·`toast`, `ToolCall`, `AgentRequest`, 공용 `ToolApprovalCard`·`QuestionCard`.

## 직접 만든 것과 빈틈
- caustic `ListNavigationItem`에 행 동작 자리가 없습니다. 행 안 버튼 안에 버튼을 둘 수 없어서 행 바로 뒤에 높이 0인 `li`를 두고 ⋯ 버튼을 겹쳤습니다(`_shell/start-panel.tsx` `RowMenu`, `shell.css [data-row-menu]`). caustic에 `actions` 자리를 제안합니다.
- 계획·변경 검토 카드는 `AgentRequest`에 맞는 kind가 없어 p03 `RequestCard` 치수로 다시 짰습니다(flat 변형 더함).
- 가상 목록이 caustic에 없습니다(C-04). "새 메시지 N"은 일반 스크롤로 흉내 냈습니다.

## 웹·좁은 폭
- 700px: 왼쪽 패널이 시트라 행 메뉴는 시트 안에서 같은 ⋯로 엽니다. 머리 ⋯도 그대로 있습니다.
- 웹: 내보내기는 브라우저 내려받기라 "저장…" 대신 "내려받기"가 됩니다(파일 위치 고르기 없음). 나머지는 같습니다.
