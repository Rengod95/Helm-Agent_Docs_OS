# L2-e 작업과 상호작용 능력 조사 (r2)

조사일 2026-10-21. 설계 조사이며 구현은 하지 않는다. 우리 계획의 L2-e "작업과 상호작용" 하위 층이 약하다는 평가를 보강하는 것이 목적이다.

## 0. 조사 범위와 표기

- 대상 16개 항목: Claude Code, Codex, opencode, oh-my-pi(omp), pi(coding-agent), Gemini CLI, Goose, Cursor, Amp, Cline, Devin, Hermes, OpenHands, Letta, Zed, Warp.
- 방법: 로컬 소스 네 곳(opencode, omp, Hermes, pi)은 읽기와 grep만 했고 실행하지 않았다. Claude Code는 기존 보고서 refs/claude-code.md와 공식 docs 번들을 직접 확인했다. 나머지 11곳은 공식 문서와 변경 로그를 WebFetch와 WebSearch로 우선 확인했다. 웹 조사의 개별 사실은 조사 기재를 인용했고 이 문서에서 다시 확인하지 않았다.
- 기존 자료: item-catalog.md(188항목), items-from-others.md, items-from-refs.md, refs/*.md. 중복은 2절에서 행 이름으로 표시한다.
- 표기: [원문] 공식 문서나 소스 경로로 확인된 사실. [2차] 블로그, 검색 스니펫, 변경 로그 제목만 확인한 사실. [추측] 근거가 없는 추정. 서비스 API와 도구 이름은 우리 제안이므로 표기 대상이 아니다.
- 필수도: 필수는 빠지면 다른 층의 계약이 깨지는 항목이다. 권장은 있으면 체감이 큰 항목이다. 선택은 목적이 좁거나 상주나 외부 서비스가 필요한 항목이다.

## 1. 요약

1. 16개 대상 대부분이 작업 목록, 질문 도구, 실행 중 입력 큐, 되감기, 세션 검색을 가진다. 흔한 능력이므로 필수도는 "있는가"보다 "층 경계를 어디에 긋는가"로 정한다.
2. 완료 판정(/goal류)은 판정자 구조가 갈린다. 모델 자가 판정(omp, Letta), 별도 판정 모델(Claude Code, OpenHands SDK, Hermes), 증거 확인 후 턴 경계에서 계속(Codex)이다. 판정자 분리 여부를 L2-e 계약에 명시해야 한다.
3. 계획 승인을 상태로 다루는 곳은 드물다. 대부분 쓰기 차단 모드와 계획 파일에 그친다. 제출과 승인을 도구와 검토 화면으로 분리한 곳은 omp 정도다.
4. 의존 간선이 있는 작업 목록은 Hermes 칸반, Cline Kanban, Claude Code 작업 도구(dependencies 필드) 정도다. 나머지는 평면 목록이다.
5. 상주가 필요한 능력은 예약 실행, 백그라운드 세션 분리, 원격 제어, 메신저 연동, 웨이크워드, 칸반 디스패치다. 질문, 큐, 되감기, 계획, 목표, 루프는 앱 실행 중의 세션 프로세스만으로 돈다(6절).
6. 원격 제어는 세 갈래다. 상주 서버에 클라이언트를 붙이는 방식(opencode, Hermes, OpenHands, Goose), 클라우드가 루프를 돌리고 로컬이 도구를 실행하는 방식(Cursor), 종단 간 암호화 릴레이(omp collab)다.
7. 호스팅형 공유는 서버에 의존한다. opencode는 공유를 중단했고 Amp는 클라우드 공유를 쓴다. 개인 용도에서는 내보내기 파일로 충분하고 공유 링크는 선택으로 둔다.
8. 제안: L2-e를 네 묶음(작업 관리, 사용자 대화, 산출물과 세션, 예약과 백그라운드)으로 나눈다(5절). 중복 항목 상당수는 새 행을 만들지 않고 기존 L0, L1 항목의 노출 계약으로 처리한다.

## 2. 기존 카탈로그와의 중복

| ID | 조사 항목 | 기존 항목(층) | 판정 |
|---|---|---|---|
| A1 | 작업 목록 | 작업 목록(todo)과 계획 객체 (L2) | 중복 |
| A2 | 계획 모드 | 모드(계획, 읽기 전용)는 L1-d 권한 모드로 병합됨 | 부분 중복. 소유는 L1-d |
| A2b | 계획 제출과 승인 | 계획 객체의 절반, 승인 프롬프트 프로토콜 (L1-d) | 부분 중복. 제출과 승인 흐름은 신규 |
| A3 | 작업 보드 | 칸반식 병렬 에이전트 (L1, 보류) | 중복(보류 항목) |
| A4 | 외부 트래커 | 없음 | 신규 |
| A5 | 목표 지속 | 완료 게이트 (L1-b) | 부분 중복. 목표 명령과 판정자 계약은 신규 |
| A6 | 완료 보고 | 결과 반환 (L1 서브에이전트 보고) | 부분 중복. 사용자 보고 형식은 신규 |
| A7 | 작업 의존 간선 | 없음 | 신규 |
| B1 | 사용자 질문 도구 | 승인 프롬프트 프로토콜 (L1-d), MCP 서버 주도 요청 (L2 필수) | 부분 중복. 모델 도구로서의 질문은 신규 |
| B2 | 큐와 steering | 단계 사이 입력 큐, 전달 모드 구분 (L1-a) | 중복. 소유는 L1-a |
| B3 | 체크포인트와 되감기 | 되감기 (L1-f), 단계 체크포인트 (L1-f) | 중복. 소유는 L1-f. UI는 신규 |
| B4 | 알림과 푸시 | 사용자 알림 훅 (L0) | 부분 중복. 입력 필요 상태 분류와 푸시는 신규 |
| B5 | 진행 표시와 상태줄 | 없음 | 신규 |
| B6 | 리뷰와 diff 승인 | 없음. 승인 결과 캐시는 다른 개념 | 신규 |
| B7 | 음성 입력 | 없음 | 신규(선택) |
| B8 | 첨부와 드래그 앤 드롭 | 이미지와 첨부 처리 (L2 권장) | 중복 |
| B9 | 출력 스타일과 페르소나 | 없음 | 신규 |
| B10 | 곁가지 질문 | 전달 모드 aside (L1-a) | 부분 중복. 사용자가 여는 별도 대화는 신규 |
| C1 | 산출물 | 이미지와 첨부 처리의 블롭 저장소 | 부분 중복. 산출물 등록과 미리보기는 신규 |
| C2 | 내보내기와 공유 | 세션 JSONL 내보내기 (L1-f), 공유 가능한 스레드 (L2 선택) | 부분 중복 |
| C3 | 세션 간 핸드오프 | 핸드오프와 에이전트-as-도구 구분 (L1) | 부분 중복. 세션 단위 핸드오프는 신규 |
| C4 | 세션 제목과 메타 | 세션 제목과 메타 엔트리 (L2 선택) | 중복 |
| C5 | 챕터와 목차 | 없음 | 신규 |
| D1 | 예약 실행 | 크론과 스케줄 (L2 권장, L2-e 목록에서 보류) | 중복 |
| D2 | 루프와 웨이크업 | 크론과 스케줄, 완료 게이트 (L1-b) | 부분 중복. 자기 예약 도구와 종료 조건은 신규 |
| D3 | 백그라운드 에이전트와 모니터 | 백그라운드 프로세스 레지스트리 (L0), 백그라운드 위임 (L1) | 부분 중복. 상태 분류와 감시 도구는 신규 |
| D4 | 다중 세션과 워크스페이스 | 작업 트리 격리 (L0), 추가 워크스페이스 루트 (L1) | 부분 중복. 세션 목록 관리는 신규 |
| D5 | 사용자 정의 명령과 템플릿 | 슬래시 명령과 프롬프트 템플릿 (L2 권장) | 중복 |
| D6 | 원격 제어 | 원격 실행 백엔드와 워크스페이스 추상 (L0), 공유 상태 리비전 토큰 (L1, 보류) | 부분 중복 |

## 3. 능력 표

열 설명: 서비스 API는 플러그인 코드가 호출하는 면이고, 도구는 모델이 호출하는 면이다. L4 UI는 클라이언트 화면이 필요한지 여부다. L3 예는 탐구 그룹(Helm)이 이 능력을 쓰는 방식이다.

### 3.1 작업 관리 (A)

| 항목 | 역할 | 해결하는 문제 | 참고 구현 | 필수도 | 서비스 API / 모델 도구 | L4 UI | L3 그룹 사용 예 |
|---|---|---|---|---|---|---|---|
| A1 작업 목록 | 턴 사이에 유지되는 작업 항목(내용, 상태). | 긴 작업에서 단계를 잊거나 완료 표시를 빠뜨림. | Claude Code(TaskCreate/Update/Get/List) [원문], omp(todo, 상태 5종) [원문], Gemini(write_todos) [원문], Hermes(todo_list) [원문], opencode(실험 플래그) [원문] | 권장 | API: tasks.create/update/list. 도구: task_write(목록 연산) | 필요 | 탐구 단계를 목록으로 만들고 단계마다 관점 점검 항목을 붙임 |
| A2 계획 모드 | 쓰기 도구를 막고 계획만 세우는 모드. | 큰 변경 전에 쓰기가 섞여 들어가는 일을 막음. | Gemini(도구 허용 목록으로 강제) [원문], Claude Code(EnterPlanMode/ExitPlanMode) [원문], omp(쓰기 가드) [원문], Cursor(Shift+Tab) [원문], Warp(/plan) [원문] | 권장(L1-d 권한 모드와 결합) | API: session.mode 전환. 도구: enter_plan_mode, exit_plan_mode(제안) | 필요 | 탐구 결과를 계획 초안으로 만들고 쓰기 전에 plan 모드로 둠 |
| A2b 계획 제출과 승인 | 계획을 구조화된 산출물로 제출하고 승인, 수정, 반려를 받으며 버전을 보관. | 승인 없이 계획이 실행되거나 계획이 대화 속에만 남음. | omp(계획 제출 도구와 검토 오버레이) [원문], Gemini(계획 파일 승인, 외부 편집기 수정) [원문], Warp(버전 비교와 복원) [원문], Cursor(계획 편집 후 승인) [원문] | 권장 | API: plans.submit/approve/reject, 버전 목록. 도구: submit_plan(제안) | 필요 | 탐구 결과를 계획으로 묶어 승인받은 뒤에만 다음 탐구 단계로 진행 |
| A3 작업 보드 | 작업 카드를 상태 열로 보고 카드마다 워크트리를 붙임. | 병렬 작업 상태를 한눈에 보고 옮김. | Cline Kanban(research preview) [원문], Hermes /kanban(의존 그래프) [원문] | 선택(데이터는 A1, A7 재사용) | API: 없음(A1 저장소를 읽음). 도구: 없음 | 필요 | 탐구 가지를 카드로 펼쳐 병렬 상태를 봄. 보드 자체는 L4 |
| A4 외부 트래커 연동 | 이슈 조회, 할당, 댓글, 상태 갱신을 외부 시스템과 맞춤. | 작업의 출처가 사용자 머리 밖(Linear, Jira, GitHub)에 있음. | Devin(Linear, Jira 할당과 멘션) [원문], Amp(Linear 할당, GitHub PR 댓글) [원문], omp(GitHub 도구, 쓰기 없음) [원문], Cursor(Automations 트리거) [원문] | 선택(X 플러그인으로 구현) | API: 트래커 provider 등록. 도구: 플러그인이 제공하는 트래커 도구 세트 | 불필요(설정 화면 정도) | 탐구 질문을 이슈로 만들어 추적. 트래커 쓰기는 승인 뒤에만 |
| A5 목표 지속 | 완료 조건을 주고 턴이 끝날 때마다 판정해, 미충족이면 다음 턴을 자동 시작. | 긴 작업을 사람이 매 단계 재촉하지 않아도 됨. | Codex(증거 확인 후 판정, 예산) [원문], OpenHands SDK(run_goal, 별도 judge LLM, 상한 10회) [원문], Hermes(보조 모델 판정자, 실패 시 계속) [원문], Claude Code(별도 evaluator) [원문], omp(모델 자가 판정) [원문], Letta(완료 도구 자가 호출) [원문] | 권장(판정자 분리 방식을 계약에 명시) | API: goals.set/status/clear, 판정자 주입. 도구: goal_complete(자가 판정일 때만, 제안) | 필요 | 탐구 종료 기준(예: 대안 3개 비교 완료)을 목표로 걸고 판정자는 Helm의 기준 검사기로 둠 |
| A6 완료 보고 | 작업 끝에 결과 요약, 사용한 자원, 남은 항목을 정해진 형식으로 보고. | 긴 작업 뒤에 무엇이 바뀌었는지 사용자가 찾아야 함. | omp(goal 완료 보고에 토큰과 시간) [원문], Devin(완료 시 이슈 댓글) [원문] | 권장 | API: run.report(요약, 산출물 참조). 도구: 없음(턴 결과 형식) | 필요 | 탐구 종료 시 발견 목록, 근거 출처, 미해결 질문을 한 보고로 묶음 |
| A7 작업 의존 간선 | 작업 사이의 선행 관계. 막힘 표시와 자동 시작. | 순서가 있는 작업을 잘못된 순서로 시작하는 일을 막음. | Claude Code(TaskUpdate의 dependencies) [원문], Hermes 칸반(의존 그래프) [원문], Cline(카드 의존 자동 시작) [원문], Cursor(자동 to-do의 의존) [2차] | 선택 | API: tasks.link(from, to). 도구: task_write 안의 link 연산 | 선택(그래프 표시) | 수집이 끝나야 비교를 시작하는 탐구 단계를 간선으로 표시 |

### 3.2 사용자 대화 (B)

| 항목 | 역할 | 해결하는 문제 | 참고 구현 | 필수도 | 서비스 API / 모델 도구 | L4 UI | L3 그룹 사용 예 |
|---|---|---|---|---|---|---|---|
| B1 사용자 질문 도구 | 모델이 선택지나 자유 입력을 요청하고 답이 올 때까지 대기. | 모호한 요구를 추측으로 채우는 일을 막음. | Claude Code(AskUserQuestion, 시간 제한 옵션) [원문], Gemini(ask_user) [원문], omp(ask, 추천 항목, 시간 초과 시 자동 선택) [원문], opencode(question, 다중 선택) [원문], Hermes(clarify) [원문] | 필수(승인 프로토콜과 통합) | API: prompts.ask(spec) → 답 Promise, 취소. 도구: ask_user(questions[]) | 필요 | 모르는 분야 용어를 선택지로 확인하고 답에 따라 탐구 방향을 바꿈 |
| B2 큐와 steering | 실행 중 입력을 전달 모드(steer, followUp, queue, aside)에 따라 안전 지점에 넣음. | 도구 실행 중 사용자 말이 사라지거나 턴을 끊음. L1-a 소유. | opencode(inbox steer/queue) [원문], omp(steer, followUp, 큐 모드) [원문], Hermes(/queue, /steer) [원문], Zed(Steer, Send Now) [원문], pi(steer, followUp API) [원문], Amp(Steer, Don't Queue) [2차] | 필수(L1-a 소유, L2-e는 노출만) | API: session.enqueue(input, mode). 도구: 없음 | 필요 | 탐구 중 "그 가설은 빼" 같은 수정을 다음 안전 지점에 넣음 |
| B3 체크포인트와 되감기 | 대화 지점으로 되돌리기, 파일 상태 복원, 분기. | 잘못된 편집과 버려진 가지가 계속 남음. L1-f 소유. | Claude Code(/rewind, Esc Esc, 파일 복원) [원문], Zed(Restore Checkpoint) [원문], opencode(revert stage, clear, commit) [원문], Hermes(/undo, /rollback) [원문], Cline(파일과 작업 복원) [원문] | 필수(L1-f 소유) | API: session.checkpoint(), session.rewind(to, files), branch. 도구: 없음(모델에 되감기 권한을 주지 않는 것을 권장) | 필요 | 탐구 가지를 분기해 두 관점을 비교한 뒤 채택하지 않은 가지를 되감음 |
| B4 알림과 입력 필요 상태 | 완료, 승인 대기, 질문 대기, 오류를 상태별로 나눠 알림. | 자리를 비운 사이 입력 대기가 멈춘 채 방치됨. | Claude Code(Notification 훅, 채널 권한 중계) [원문], Warp(Request 이벤트 분류) [원문], Zed(대기 시 알림 설정) [원문], Amp(모바일 완료 알림) [원문], Cursor(모바일 푸시, 클라우드) [원문] | 권장(L0 알림 훅과 통합, 푸시는 상주 필요) | API: notify.emit(kind, payload), 구독 필터. 도구: 없음 | 필요(설정) | 탐구 루프가 사용자 판단을 기다릴 때 "질문 대기"로 알림 |
| B5 진행 표시와 상태줄 | 턴 상태, 도구 활동, 사용량을 상태줄이나 패널로 표시. 사용자 정의 세그먼트. | 긴 작업의 현재 단계를 알 수 없음. | Claude Code(/statusline) [원문], omp(statusLine 세그먼트 설정) [원문], pi(setStatus, setFooter 예제) [원문], Letta(/statusline) [원문], Devin(Progress 탭) [원문] | 권장(표시 항목 등록 API) | API: status.setItem(id, text). 도구: 없음 | 필요 | 탐구 단계 번호와 남은 가설 수를 상태줄에 표시 |
| B6 리뷰와 diff 승인 | 변경을 hunk 단위로 보여 주고 승인, 거절, 줄 코멘트를 받아 에이전트에 되돌림. | 편집이 승인 없이 쌓이거나 재작업이 흩어짐. | Cline Kanban(diff와 줄 코멘트) [원문], Devin Review(인라인 코멘트) [원문], Zed(개별과 전체 수락, 거부) [원문], Cursor(/agent-review) [원문], omp(hunk 단위 stage, discard) [원문] | 권장 | API: reviews.open(changes), 항목별 approve, reject, comment. 도구: review_request(제안) | 필요 | 탐구가 제안한 코드 변경을 항목별로 승인 |
| B7 음성 입력 | 마이크 입력을 텍스트나 실시간 세션으로 받음. | 키보드 입력이 어려운 상황. | omp(live 음성 모드) [원문], Cursor(Voice Mode) [원문], Hermes(/voice, /wake) [원문], opencode(실시간 음성 API, 실험) [원문], Amp(받아쓰기) [2차] | 선택(L4 입력 어댑터) | API: input.voice(stream) 어댑터. 도구: 없음 | 필요 | 탐구 중 말로 질문을 던짐. 웨이크워드는 상주가 필요 |
| B8 첨부와 드래그 앤 드롭 | 이미지, 파일, 경로, URL을 입력에 첨부. 클립보드 이미지 포함. | 스크린샷과 문서가 세션 파일을 키움. | omp(붙여넣기 이벤트로 이미지 첨부) [원문], Hermes(/paste, /image) [원문], Zed(@-멘션, 드래그) [원문], Cline(드래그앤드롭) [원문], OpenHands(업로드 API) [원문] | 권장(기존 행, 블롭 저장소 공유) | API: attachments.add(blob). 도구: 없음(모델은 첨부 참조를 받음) | 필요 | 참고 논문 PDF를 드롭해 탐구 원자료로 넣음 |
| B9 출력 스타일과 페르소나 | 응답의 역할, 톤, 형식을 세션 단위로 바꾸는 설정. | 같은 지시를 매 프롬프트마다 되풀이함. | Claude Code(출력 스타일 4종과 사용자 정의) [원문], Hermes(/personality, SOUL.md) [원문], Letta(/personality, /system) [원문] | 선택 | API: styles.register(id, 프롬프트 조각). 도구: 없음 | 필요 | Helm이 탐구 페르소나(비판적 검토자, 초보 설명자)를 스타일로 등록 |
| B10 곁가지 질문 | 본류 세션을 바꾸지 않고 별도 질문에 답함. | 용어나 배경 질문이 작업 맥락을 흐림. L1-a aside와 부분 중복. | Claude Code(/btw) [원문], Codex(/side) [원문], Letta(/btw) [원문], Devin(읽기 전용 사이드 챗) [원문], Hermes(/btw) [원문] | 권장 | API: sidechat.ask(질문), 본류 컨텍스트 읽기 전용. 도구: 없음 | 필요 | 모르는 용어를 곁가지로 묻고 본류 탐구 경로는 유지 |

### 3.3 산출물과 세션 (C)

| 항목 | 역할 | 해결하는 문제 | 참고 구현 | 필수도 | 서비스 API / 모델 도구 | L4 UI | L3 그룹 사용 예 |
|---|---|---|---|---|---|---|---|
| C1 산출물 등록과 미리보기 | 작업 결과 파일, 문서, 표를 산출물로 등록하고 종류별로 미리본다. | 결과물이 대화 속에 흩어져 찾기 어려움. | Warp(계획을 Plans 폴더에 저장) [원문], omp(artifact:// 저장소) [원문], opencode(미리보기 분류) [원문], Zed(변경 파일 목록) [원문], OpenHands(Files 탭) [원문] | 권장(레지스트리는 L2, 미리보기는 L4) | API: artifacts.register(kind, blob_ref, meta), list. 도구: artifact_create, artifact_update | 필요 | 탐구 노트, 비교표, 출처 목록을 산출물로 등록 |
| C2 내보내기와 공유 | 세션을 Markdown, JSONL, HTML로 내보내고 필요하면 공유 링크를 만듦. | 세션을 다른 도구로 읽거나 남에게 보여 줄 때 막힘. | omp(/export, /share 암호화 링크) [원문], Claude Code(JSONL 기록) [원문], Letta(/export) [원문], Goose(레시피 캡처 공유) [원문], Amp(공개 범위 설정) [원문], opencode(공유 중단, 내보내기만) [원문] | 권장(내보내기), 선택(공유 링크) | API: sessions.export(format), sessions.share(scope). 도구: 없음 | 필요 | 탐구 과정을 기록 파일로 내보내 검토자에게 전달 |
| C3 세션 간 핸드오프 | 한 세션의 맥락(요약, 계획, 산출물)을 새 세션이나 다른 기기로 넘김. | 맥락이 큰 세션을 그대로 이어 쓰기 어려움. | omp(/handoff, 요약 후 압축) [원문], Zed(요약으로 새 스레드) [원문], Warp(로컬과 클라우드 간 핸드오프) [원문], Hermes(/handoff로 메신저에 넘김) [원문], Claude Code(SendMessage) [원문], opencode(session_move) [원문] | 선택 | API: sessions.handoff(summary, target). 도구: handoff(제안) | 선택 | 탐구 1차 결과를 요약해 새 세션에서 2차 탐구 시작 |
| C4 세션 제목과 메타 | 제목 자동 생성과 편집, 라벨, 검색. | 세션 목록에서 찾기 어려움. | Claude Code(sessionTitle) [원문], omp(/rename, 퍼지 검색) [원문], opencode(자동 제목, session_rename) [원문], Amp(라벨) [원문], Letta(/rename, /search) [원문] | 선택 | API: sessions.setMeta(title, labels). 도구: session_rename(제안) | 필요 | 탐구 세션에 주제 라벨을 달아 나중에 검색 |
| C5 챕터와 목차 | 긴 세션이나 계획 문서를 헤딩 단위로 나눠 목차로 이동. | 긴 출력에서 위치를 찾기 어려움. | omp(계획 목차 오버레이) [원문] | 선택 | API: 없음(헤딩 이벤트에서 파생). 도구: 없음 | 필요 | 탐구 노트의 단계별 장을 목차로 이동 |

### 3.4 예약과 백그라운드 (D)

| 항목 | 역할 | 해결하는 문제 | 참고 구현 | 필수도 | 서비스 API / 모델 도구 | L4 UI | L3 그룹 사용 예 |
|---|---|---|---|---|---|---|---|
| D1 예약 실행 | 시각이나 주기로 프롬프트나 작업을 실행하고 결과를 저장하고 전달. | 주기 점검과 요약을 사람이 켜 두지 않아도 됨. 기존 크론 행과 중복. | Claude Code(CronCreate 세션 범위, 클라우드와 데스크톱 예약) [원문], Hermes(60초 틱) [원문], Cline(cline schedule, 허브) [원문], Devin(예약 세션) [원문], Goose(schedule, 스케줄러 플래그) [원문], Warp(oz schedule) [원문] | 권장(보류 해제는 6절 결정과 함께) | API: schedules.create(cron 또는 at, job). 도구: schedule_create, schedule_list, schedule_cancel | 필요 | 관심 분야 최신 문헌을 매주 점검해 탐구 큐에 넣음 |
| D2 루프와 웨이크업 | 같은 세션에서 작업을 반복. 종료 조건(횟수, 시간, 셸 종료코드, 모델 선언)을 두고 자기 간격으로 깨어남. | 폴링과 재시도를 에이전트가 스스로 이어 감. | Claude Code(/loop, ScheduleWakeup, 7일 만료) [원문], omp(/loop, --until 셸 조건, 한도) [원문], Hermes(/loop의 LOOP_COMPLETE, /heartbeat) [원문], Letta(채팅으로 예약 생성) [원문], Amp(예약 시 메시지로 깨움) [원문] | 권장 | API: loops.start(prompt, 조건, 한도). 도구: schedule_wakeup(delay, prompt), loop_done(제안) | 필요 | "제2 관점 재검토" 루프를 횟수 상한과 종료 판정으로 실행 |
| D3 백그라운드 에이전트와 모니터 | 긴 작업을 분리 실행하고 상태(작업 중, 입력 필요, 완료, 중지)를 추적. 외부 이벤트 감시. | 빌드와 탐구가 턴을 막음. 프로세스 레지스트리(L0)와 중복. 상태 분류와 감시는 신규. | Claude Code(agent view 상태 분류, Monitor 도구) [원문], omp(task, /tan, /jobs, 긴 bash 자동 백그라운드) [원문], Hermes(delegate_task background, 모니터 도크) [원문], opencode(서브에이전트 백그라운드) [원문], Devin(클라우드 백그라운드) [원문] | 필수(L0 레지스트리 소유, L2-e는 상태 분류와 감시를 노출) | API: jobs.spawn, list, status, stop. watch(source, filter). 도구: job_spawn, job_status, monitor_start(제안) | 필요 | 여러 관점을 서브 작업으로 병렬 탐구하고 완료를 감시 |
| D4 다중 세션과 워크스페이스 | 여러 세션을 목록으로 관리하고 세션마다 워크트리나 작업 디렉터리를 격리. | 병렬 작업이 같은 파일을 덮어씀. L0 격리와 부분 중복. | Claude Code(agent view, 워크트리) [원문], Zed(병렬 스레드, worktree 격리) [원문], Cline(Kanban 카드별 워크트리) [원문], omp(/pane, /wt) [원문], Hermes(/branch, /worktree) [원문], opencode(worktree 도구) [원문] | 권장(격리 자체는 L0) | API: sessions.list, sessions.create(workspace). 도구: worktree_create, worktree_list, worktree_remove | 필요 | 탐구 가지마다 별도 워크트리에서 실험하고 채택된 가지만 병합 |
| D5 사용자 정의 명령과 템플릿 | 자주 쓰는 지시를 /이름으로 호출하고 인자를 치환. 파일로 공유. | 반복 지시를 매번 다시 입력함. 기존 행과 중복. | Gemini(TOML, {{args}}, 셸 주입 전 확인) [원문], pi($1, $@ 치환) [원문], omp({{args}}) [원문], opencode($ARGUMENTS) [원문], Letta($ARGUMENTS, $1) [원문], Goose(레시피 파라미터) [원문] | 권장 | API: commands.register(name, template, args_schema). 도구: 명령 목록 광고(모델은 명령을 호출하지 않음) | 필요(자동완성) | Helm 시작 명령 /discover <주제>를 등록해 탐구 루프를 엶 |
| D6 원격 제어 | 다른 기기(폰, 웹, 다른 컴퓨터)에서 세션을 보고 입력하고 승인함. | 자리를 떠난 동안 승인이나 질문에 답하지 못함. | Claude Code(Remote Control, 채널 권한 중계) [원문], Cursor(/remote-control, 로컬 머신 필요) [원문], OpenHands(Tailscale, ngrok 접속) [원문], Cline(원격 접속, 내장 인증 없음) [원문], omp(collab 종단 간 암호화 릴레이) [원문], Hermes(메신저 게이트웨이) [원문], Amp(러너 등록) [원문] | 선택(상주 필수, 인증 계층 필요) | API: remote.serve(auth), 클라이언트 프로토콜. 도구: 없음 | 필요 | 탐구 중 승인 요청을 폰으로 받아 응답 |

## 4. 대상별 보유 현황

있음과 부분을 모두 적었다. 부분은 괄호 없이 적고, 예제 확장 수준이거나 2차 근거만 있는 항목은 제품 이름 뒤에 [예제]나 [2차]를 붙였다.

| 대상 | A 작업 | B 대화 | C 산출물·세션 | D 예약·백그라운드 |
|---|---|---|---|---|
| Claude Code | A1 A2 A5 A7 | B1 B2 B3 B4 B5 B8 B9 B10 | C3 C4 | D1 D2 D3 D4 D5 D6 |
| Codex | A1 A2 A2b A5 | B1 B2 B3 B4 B5 B6 B8 B10 | C2 C3 C4 | D1 D3 D4 D5 D6 |
| opencode | A1 A2 | B1 B2 B3 B4 B5 B6 B7 B8 | C1 C2 C4 | D3 D4 D5 D6 |
| omp | A1 A2 A2b A4 A5 A6 | B1 B2 B3 B4 B5 B6 B7 B8 | C1 C2 C3 C4 C5 | D2 D3 D4 D5 D6 |
| pi [예제] | A1 A2 | B1 B2 B3 B4 B5 B8 B9 | C2 C3 C4 | D3 D4 D5 D6 |
| Gemini CLI | A1 A2 A2b | B1 B3 B4 B8 | 없음 | D3 D5 |
| Goose | 없음 | B6 | C2 C4 | D1 D3 D5 D6 |
| Cursor | A1 A2 A4 A7 [2차] | B1 B2 B3 B4 B6 B7 B8 | C1 C3 C4 | D1 D3 D4 D5 D6 |
| Amp | A4 | B2 B3 B4 B6 B7 B8 | C2 C3 C4 | D1 D2 D3 D4 D6 |
| Cline | A1 A2 A3 A4 A7 | B1 B3 B4 B6 B8 | C3 | D1 D3 D4 D5 D6 |
| Devin | A1 A2 A4 A6 | B1 B4 B5 B6 B10 | C3 | D1 D3 D5 D6 |
| Hermes | A1 A2 A3 A4 A5 A7 | B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 | C1 C2 C3 C4 | D1 D2 D3 D4 D5 D6 |
| OpenHands | A4 A5 | B2 B3 B4 B5 B6 B8 | C1 C2 C4 | D1 D4 D5 D6 |
| Letta | A5 | B3 B5 B9 B10 | C2 C3 C4 | D1 D2 D3 D4 D5 D6 |
| Zed | 없음 | B2 B3 B4 B5 B6 B8 | C1 C2 C3 C4 | D3 D4 |
| Warp | A1 A2 A3 A4 | B1 B2 B4 B5 B6 B8 | C1 C3 C4 | D1 D3 D4 |

요약: 의존 간선(A7)과 판정 지속(A5)을 함께 가진 곳은 Claude Code와 Hermes 두 곳이다. 대화 영역(B)은 Goose를 제외한 15곳이 세 개 이상을 가진다. Goose는 B 영역에서 B6 하나만 확인되었다. 산출물(C)과 원격 제어(D6)는 제품마다 차이가 크다.

## 5. L2-e 하위 묶음 재분할 제안

현재 L2-e는 네 항목(작업 목록과 계획, 슬래시 명령과 템플릿, 세션 제목과 메타, 크론과 스케줄)뿐이다. 조사 결과 29개 능력이 필요하고 그중 상당수가 L0, L1에 이미 있으므로, 아래 네 묶음을 제안한다.

| 묶음 | 항목 | 경계 기준(무엇을 소유하는가) | 의존 방향 |
|---|---|---|---|
| L2-e1 작업 관리 | A1, A2, A2b, A3, A4, A5, A6, A7 | 작업과 계획의 상태, 완료 판정 | L1-b(완료 게이트 훅), L1-d(계획 모드 권한) |
| L2-e2 사용자 대화 | B1, B2(노출), B4, B5, B7, B8, B9, B10, D5 | 사용자 입출력 채널과 표시 항목 | L1-a(입력 큐), L1-d(승인 프로토콜), 블롭 저장소 |
| L2-e3 산출물과 세션 | B3(노출), B6, C1, C2, C3, C4, C5 | 세션의 결과물과 세션 자체 | L1-f(체크포인트, 되감기), 블롭 저장소 |
| L2-e4 예약과 백그라운드 | D1, D2, D3, D4, D6 | 시간과 프로세스의 소유 | L0(프로세스 레지스트리, 격리), L1-g(백그라운드 위임), 상주 결정 |

묶음 사이 규칙:
- 묶음 간 호출은 서비스 API로만 한다. 묶음이 다른 묶음의 저장소를 직접 읽지 않는다.
- 의존 방향은 L2-e4 → L2-e1(루프 종료 판정이 목표 판정을 씀), L2-e2 → L2-e1(계획 승인 질문), L2-e3 → L1-f(되감기)다. 역방향은 두지 않는다.
- 묶음마다 서비스 API와 모델 도구를 함께 등록한다. 모델 도구가 없는 항목(B2, B3, B9, B10, C5, D5)은 등록 목록에서 빈 칸으로 둔다.
- L2-e4의 D1(크론)은 보류를 풀 조건으로 6절의 상주 결정이 필요하다. 나머지 세 묶음은 상주 결정과 무관하게 진행할 수 있다.

## 6. 상주 서비스가 필요한 항목

상주 수준은 세 단계로 나눈다. 0은 요청 처리 중 메모리만 쓴다. 1은 앱(세션 프로세스)이 살아 있어야 한다. 2는 앱을 닫아도 독립 프로세스가 살아 있어야 한다. 사용자 메모리에 적힌 "helm-server 내장과 상주 두 모드" 논점은 이 표의 2 항목이 두 모드를 가르는 기준이 된다.

| 항목 | 상주 수준 | 이유 | 근거(제품 예) |
|---|---|---|---|
| D1 예약 실행 | 2 | 타이머가 앱 밖에서 돌아야 함 | Goose(스케줄러가 서버 프로세스에 붙고 기본 꺼짐) [원문], Cline(허브) [원문], Hermes(60초 틱) [원문]. Claude Code 세션 범위 예약은 1 [원문] |
| D2 루프와 웨이크업 | 1(앱 종료 후 깨우기는 2) | 세션이 열려 있어야 함 | Claude Code(/loop는 세션이 열려 있어야 함) [원문] |
| D3 백그라운드 분리 실행 | 2 | 앱을 닫아도 작업이 계속 돌아야 함 | Claude Code(supervisor 프로세스가 백그라운드 세션을 실행) [원문] |
| D4 다중 세션 관제 | 1(공유 관제는 2) | 목록은 앱 안에서 가능하고 여럿이 보려면 서버 필요 | Codex(/agents, 공유 서버 필요) [원문] |
| D6 원격 제어 | 2 | 다른 기기가 붙을 서버나 릴레이가 필요함 | opencode(serve와 터널) [원문], omp(collab 릴레이) [원문], Cursor(로컬 머신이 깨어 있어야 함) [원문] |
| B4 푸시 알림 | 1(OS 알림), 2(모바일 푸시) | 모바일 푸시는 외부 서비스나 상주 중계가 필요함 | Claude Code(채널이 권한 요청을 중계) [원문], Cursor(클라우드 모바일 푸시) [원문] |
| B7 웨이크워드 | 2 | 항상 듣는 리스너가 필요함 | Hermes(/wake) [원문] |
| C3 메신저 핸드오프 | 2 | 메신저 게이트웨이가 필요함 | Hermes(/handoff) [원문] |
| A3 칸반 디스패치 | 2 | 배정과 실행 감시를 서버가 맡음 | Hermes(kanban dispatch) [원문], Cline(허브) [원문] |
| A4 트래커 웹훅 | 2 | 외부 이벤트를 받을 수신 엔드포인트가 필요함 | Devin [원문], Cursor Automations [원문] |
| C2 공유 링크 | 2 | 호스팅 공유 서버가 필요함. 개인 용도에서는 범위 밖 가능 | omp(/share, 공유 서버) [원문], opencode(공유 중단) [원문] |

나머지 항목(A1, A2, A2b, A5, A6, A7, B1, B2, B3, B5, B6, B8, B9, B10, C1, C4, C5, D5)은 0 또는 1이다. 상주 2가 필요한 항목은 D1, D3, D6, B7, C3, A3, A4 웹훅, C2 공유 링크 여덟 개 남짓이다. 이 목록을 "상주 모드 전용 기능"으로 묶고, 나머지는 앱 프로세스 안에서 완결되도록 설계하면 두 모드 논쟁의 범위가 줄어든다.

## 7. 설계 힌트(대상에만 있는 능력)

- Zed의 "Follow the agent": 에이전트가 건드린 파일을 따라가는 추적 상태를 두면 탐구 화면이 에이전트를 자동으로 따른다. 쓰기 권한과 분리된 읽기 추적으로 설계한다.
- Amp의 Thread Map과 커밋 트레일러(Amp-Thread-ID): 세션과 커밋을 양방향으로 잇는다. 산출물 추적(C1)과 함께 검토할 가치가 있다.
- omp의 /pause: 메인과 서브에이전트, 어드바이저를 한꺼번에 얼린다. 작업 상태 계약에 "일시 정지"를 전역 상태로 넣을 근거다.
- Gemini CLI의 외부 편집기 계획 수정: 계획 파일을 편집기에서 재정렬하고 주석을 달 수 있다. 계획 승인(A2b)을 파일 기반으로 두면 얻는 이점이다.
- Warp의 Request 이벤트: 명령 승인, 권한 요청, 유휴 프롬프트를 "입력 필요"라는 한 상태로 묶는다. B4의 상태 분류 설계에 그대로 참고할 만하다.
- Codex app-server: 턴 조종(steer, interrupt)과 승인, 질문 요청을 같은 JSON-RPC 채널에 둔다. 실행 엔진과 클라이언트를 프로토콜로 분리하는 설계의 직접 참고가 된다.

## 8. 한계와 확인 필요 항목

- 웹 조사 결과 대부분은 공식 문서나 변경 로그의 제목, 검색 스니펫에 근거한다. 표의 [2차] 표기가 붙은 항목은 확인이 필요하다.
- Gemini CLI: 여러 공식 페이지가 2026-06 무렵 "Antigravity CLI로 대체"를 밝힌 것으로 보고되었다. 제품 지속성을 먼저 확인해야 하며, 이 조사의 Gemini 항목은 참고용이다.
- Codex: /goal의 기능 플래그 여부와 update_plan 옵트인 시기는 출처끼리 충돌한다. 확인 전까지 [추측]으로 둔다.
- Amp: TODO 기능과 계획 모드가 2026년 초에 제거되었다는 내용은 2차 블로그 근거다.
- Warp: 리뷰 페이지가 404로 응답하여 검색 스니펫 기준이다.
- 로컬 소스 네 곳은 grep 기반 조사이며 실행하지 않았다. 도구 이름과 노출 방식은 일부만 확인되었다. 대부분의 pi 항목은 코어가 아니라 examples/ 아래 예제 확장이다.
- Claude Code: 공식 docs 번들과 기존 보고서로 확인했다. 질문 도구의 선택지 UI 세부는 문서 범위를 넘는다.
- 열린 결정: 상주 모드 채택 여부(6절), 판정자 분리 방식(A5), 승인 프로토콜을 B1과 A2b에서 하나로 합칠지 여부는 사용자 결정이 필요하다.

## 부록. 참고 경로와 URL

- Claude Code: scratchpad/ext/claude-code/docs(tools-reference.md, agent-view.md, goal.md, scheduled-tasks.md, channels-reference.md, output-styles.md, checkpointing.md, commands.md), 기존 보고서 scratchpad/research/refs/claude-code.md.
- Codex: learn.chatgpt.com/docs/developer-commands.md?surface=cli, learn.chatgpt.com/docs/app-server, developers.openai.com/cookbook/examples/codex/using_goals_in_codex, developers.openai.com/codex/app/automations(스니펫).
- Gemini CLI: geminicli.com/docs/cli/plan-mode, /docs/cli/checkpointing, /docs/cli/tutorials/task-planning, /docs/hooks/, /docs/cli/custom-commands.
- Goose: goose-docs.ai/docs/guides/goose-cli-commands, /docs/guides/recipes/, /docs/guides/recipes/subrecipes, goose-docs.ai/llms.txt.
- Cline: docs.cline.bot/core-workflows/plan-and-act, /core-workflows/checkpoints, /usage/kanban, /cli/scheduling.
- Cursor: cursor.com/docs/agent/plan-mode, /docs/cloud-agent/automations, /docs/cloud-agent/mobile, /docs/agent/agent-review.
- Amp: ampcode.com/manual, ampcode.com/news, ampcode.com/docs/markdown/threads, ampcode.com/docs/markdown/orbs/automations.
- Devin: docs.devin.ai/integrations/linear, /integrations/jira, /product-guides/scheduled-sessions, /work-with-devin/ask-devin.
- OpenHands: docs.openhands.dev/openhands/usage/agent-canvas/conversations, /overview/skills, /sdk/guides/convo-goal, /openhands/usage/automations/overview.
- Letta: docs.letta.com/letta-code/goal, /platform/cli/slash-commands/index.md, /configuration/schedules/index.md, /platform/computers/teleportation/index.md.
- Zed: zed.dev/docs/ai/agent-panel, /ai/tool-permissions, /ai/parallel-agents, /ai/zed-agent.
- Warp: docs.warp.dev/agents/capabilities/planning/, /agents/capabilities/task-lists/, /platform/triggers/scheduled-agents/, /agents/capabilities/agent-notifications/.
- opencode(로컬): scratchpad/ext/opencode/repo의 packages/core/src/tool/plugin/question.ts, packages/core/src/plugin/plan.ts, packages/core/src/session/inbox.ts, packages/cli/src/commands/commands.ts. 기존 보고서 scratchpad/research/refs/opencode.md.
- omp(로컬): scratchpad/ext/omp/repo의 packages/coding-agent/src/goals/runtime.ts, tools/ask.ts, tools/todo.ts, modes/interactive-mode.ts. 기존 보고서 scratchpad/research/refs/oh-my-pi.md.
- Hermes(로컬): scratchpad/ext/hermes/repo의 hermes_cli/commands.py, hermes_cli/goals.py, hermes_cli/loops.py, tools/clarify_tool.py. 기존 보고서 scratchpad/research/refs/hermes.md.
- pi(로컬): /home/user/projects/_ref/pi-src/packages/coding-agent의 src/core/slash-commands.ts, src/core/prompt-templates.ts, examples/extensions/. 기존 보고서 scratchpad/research/refs/pi.md.
