# O-02 셸 명령 확인 · O-03 명령 결과 · O-04 프로젝트 신뢰 카드 (o02-o04-chat)

셋 다 대화(P-02) 위에서 열리므로 한 목업의 상태로 둡니다. 바탕 대화는 p02-opus 치수를 따른 가벼운 복사본입니다(그 폴더 store에 묶이지 않게).

- S1 O-02: `Dialog kind="alert"` — "/deploy가 셸 명령을 실행해요", 설명에 명령 주인 `ext:release-kit`, 명령 블록, 위치·대상 `ListDescription`. 기본 초점 "취소".
- S2 O-03: `Sheet side="right"` — 머리에 결과를 낸 그룹(Helm 그룹 grp:helm), 한 줄 요약, 단계·드라이브 주도·렌즈(자식 에이전트)·발견 `ListDescription`, 결과 JSON 접기, 복사·닫기. 트랜스크립트에 결과 행(누르면 시트).
- S3 O-03 JSON 펼침.
- S4 O-04: 새 대화의 입력창 위 카드(`AgentRequest permission`, 대화 상자 아님). 불러올 자원을 종류별 한 목록으로 — **프로젝트 그룹 `groups/cache-guard`(on·post 훅)**, MCP 서버, 스킬, 설정. 버튼: 신뢰하지 않음(시작 쪽) · 이번 실행만 · ~/code 전체 · 이 폴더 신뢰.

명령 블록은 caustic에 코드 블록 부품이 없어(`MessageCode`는 인라인) `pre` + 토큰 클래스로 그렸습니다.
