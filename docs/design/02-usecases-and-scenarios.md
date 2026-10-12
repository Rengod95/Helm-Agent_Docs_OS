# 02. 유즈케이스와 단계 흐름

- 작성: P1 기획, 2026-10-11 (1단계 초안)
- 상태: 설계 초안. 유즈케이스 ID는 이 문서가 확정한다. 화면 이름은 03, 이벤트 이름은 09, 명령 이름은 10, 프로토콜 메서드는 19가 최종 소유한다.
- 함께 읽을 문서: [01 제품 브리프](01-product-brief.md)(원칙 PR, 사람 조작 셈법 R-OP, 진입 규칙 EC, MVP 범위, 비기능 요구 NFR)
- 기준 결정 범위: 브리프 결정 1~51.
- 표시 규칙: 브리프 §5.2(판정 J-144). 제품 사용 사례는 "유즈케이스", 그 단계별 진행은 "유즈케이스 단계 흐름"(줄여 "단계 흐름")이라 쓴다. "시나리오"는 결과 탐구의 시나리오(v0.3 04 §5.2)와 테스트 시나리오(22)에만 쓴다.

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

1. 유즈케이스 목록과 ID(UC-01~UC-19), 각 유즈케이스의 단계(MVP, 2단계, 3단계, 이후)
2. 유즈케이스별 단계 흐름: 단계마다 사용자 행동, 화면, 데몬·런타임 동작, 생기는 레코드·이벤트, 사람 조작 횟수
3. 대안 흐름과 예외 흐름
4. 수용 기준: 테스트 시나리오로 옮길 수 있는 조건(AC-xx-nn)
5. 유즈케이스와 화면·설계 문서의 대응
6. 원전과 대화의 사용 사례(CLI-Q01 등)와 이 문서 유즈케이스의 대응

### 1.2 다루지 않는 것

- 화면 레이아웃, 문구, 상호작용 세부: 03·04·05. 이 문서는 화면 이름만 쓴다.
- 레코드 스키마와 상태 기계: 08·09. 이 문서는 생기는 레코드의 종류와 이벤트 이름 후보만 쓴다.
- 명령·검증 규칙: 10·11. 이 문서는 커널이 무엇을 받아들이거나 거부해야 하는지만 수용 기준으로 적는다.
- 테스트 하네스, 가짜 모델 재생의 구현: 22. 이 문서는 대본 형식의 요구만 적는다(§3.24).

## 2. 전제와 결정

### 2.1 기대는 결정

결정 1(원함 발견), 2(가역성 범위 밖), 5(루프 조합), 8(혼자 정한 결정), 12(묻기 재설계), 14(커널 원칙), 15(의존 규칙), 17(불변조건), 18(고르기 거부), 19~24(데스크톱 앱, WSL 서버, 외부 접속, 클라이언트 없이 계속, 자체 런타임, 혼자 쓰는 앱), 25(유즈케이스), 33·39(TUI는 이후), 35(관찰 입력), 38(데스크톱 앱 SSH 접속), 41(React 19), 42(휴대폰에서 답하기), 47~49(모바일 PWA와 Web Push, 휴대폰 알림 강도, iOS 26). 조정자 기본값 26(Tailscale), 29(이벤트 로그가 기준 원본), 30(크래시 복구), 31(JSON-RPC over WebSocket, 재전송), 34(어댑터는 이후)는 `[제안: 결정 n 기본값]`으로 인용한다. 01의 원칙과 셈법을 그대로 따른다.

### 2.2 행위자

브리프 §3.3을 따른다.

| 행위자 | 표기 | 이 문서에서 하는 일 |
|---|---|---|
| 사람(소유자) | `human` | 요청, 반응, 결정 조작, 이의. 기기 id(`dv_`)가 함께 기록된다 |
| 작업 에이전트 | `agent:work` | 초안·제안·도구 실행 |
| 라우터 | `agent:router` | 진입 판정 신호 선언, 모드 선택 |
| 검증 에이전트 | `agent:verifier` | 반대 근거 제안, 증언(2단계) |
| 중재자 | `agent:mediator` | 질문 전달 시점·묶음 결정(2단계) |
| 관찰 에이전트 | `agent:observer` | 반복 패턴 제안(2단계) |
| 런타임 | `runtime` | 도구 실행 결과를 관찰로 기록, 루프 진행 |
| 커널 | `kernel` | 검증, 상태 전이, 정책 적용 |
| 스케줄러 | `scheduler` | 가정 만료, 기한, 예측 확인 시각 |
| 외부 | `external:<name>` | 외부 응답(2단계) |

라우터와 작업 에이전트의 경계(같은 모델 호출인지 별도인지)는 14가 정한다. 이 문서는 역할만 구분한다.

### 2.3 표 칸의 정의

| 칸 | 뜻 |
|---|---|
| # | 단계 번호 |
| 사용자 행동 | 사람이 하는 것. 없으면 "—" |
| 화면 | 사용자가 보는 화면 이름(§2.4). 사용자가 없으면 "—" |
| 데몬·런타임 동작 | 데몬 안에서 일어나는 일(커널, 런타임, 스케줄러) |
| 레코드·이벤트 | 생기는 레코드 종류와 이벤트 이름 후보(§2.5) |
| 조작 | 사람 조작 수. `D`는 결정 조작, `I`는 입력(01 §3.5.2). 예: `D1`, `I3`, `—` |

### 2.4 화면 이름

03(§3.4 영역, §3.6 화면 목록)이 정한 화면 ID를 쓴다. 03에 없는 것은 이 문서가 임시 키를 둔다.

| 화면 ID(03) | 화면 이름 | 이 문서에서 보는 것 |
|---|---|---|
| `SCR-HOME` | 홈 | Goal 목록, Concern 트리, 주의 카드, 진행 중 |
| `SCR-BRIEF` | 복귀 요약 | 마지막 확인 이후 바뀐 것과 지금 할 일 |
| `RGN-COMPOSER` | 입력창 | 새 요청("새 일"), 현재 범위에 귀속되는 자연어 입력, 진입 판정 결과 표시 |
| `SCR-CONCERN-OVERVIEW` | Concern 개요 | 지금 하는 일, 다음 예정, 사용 중인 가정, 하위 Concern |
| `SCR-WORK` | 작업 | 진행 작업, 작업 합의, 탐침 |
| `SCR-AGREE` | 작업 합의 | 합의 초안·echo·확정 |
| `SCR-INQUIRY` | 탐구 | 사실·가능성·결과 탐구의 현재 상태 |
| `SCR-STIM` | 자극 보드 | 원함 탐구의 자극, 요소 단위 반응, 기준 후보 |
| `SCR-REVIEW` | 결과 확인 | 기준별 근거, 확인 못한 범위, 반대 근거, 반영 항목, 결과 확인 행동 |
| `SCR-INBOX`, `SCR-QUESTION` | 질문함, 질문 | 사람 행동 요청 목록과 질문 하나 |
| `SCR-AUTO` | 에이전트가 정한 것 | 종류별 목록, 이의 |
| `OVL-CONTEST` | 이의 걸기 | 객체 하나에 이의 |
| `SCR-EVIDENCE` | 근거 체인 | 근거를 원본까지 따라가기 |
| `SCR-GOAL` | Goal 상세 | 현재 내용, 버전 이력, 수정 제안, 선호 모델 |
| `SCR-DIALS` | 다이얼·모드 | 현재 모드와 다이얼 값, 값의 층 |
| `SCR-CONNECT` | 연결·기기 | 접속 방식, 페어링, 기기 목록, 데몬 상태 |
| `SCR-SETTINGS` | 설정 | 권한·연결 절(허용 폴더, 모델 제공자 상태) |
| `SCR-ONBOARD` | 처음 연결 | 첫 실행 연결 |
| `SCR-RECOVERY` | 복구 | 중단된 작업과 결과를 모르는 외부 행동 |
| `SCR-OBSERVER` | 관찰 제안 | 관찰 에이전트의 제안(2단계) |
| `SCR-RECORD` | 변화 기록 | 원본 이벤트(감사 깊이). 열람은 원본 로그 열람으로 센다 |
| `RGN-TOPBAR` | 위쪽 상태 막대 | 연결 상태(연결됨, 다시 연결하는 중, 연결 안 됨 등 04 §3.0.4), 기준 시각 |
| `RGN-BANNER` | 배너 | 즉시 전달 질문, 연결 끊김, 복구 필요 |
| `RGN-RUNS` | 진행 중 서랍 | 진행 중 작업, 가벼운 작업 카드(간단한 결과 확인) |
| `SCR-M-*` | 휴대폰 화면(2단계) | `SCR-M-INBOX`, `SCR-M-QUESTION`, `SCR-M-BRIEF` 등(03 §3.12, 26) |
| `os.notify` | OS 알림(화면 ID 없음, 규칙 05 §3.7, 트레이는 `SCR-TRAY`) | 전달된 질문의 OS 알림. 기본은 내용을 숨겨 제목 "Helm", 본문 "확인할 일이 n건 있습니다."만 보인다. 협상 전달은 기본으로 OS 알림을 띄우지 않는다 |

### 2.5 이벤트 이름

이벤트 이름은 09 §3.4 카탈로그를 쓴다(조정자 판정 §1). 1판 이름과의 대응은 08 §10.3이 정본이다. 이 문서가 자주 쓰는 이벤트:

| 묶음 | 09 이벤트 |
|---|---|
| Goal | `goal.proposed`, `goal.activated`, `goal.revision_proposed`, `goal.revised`, `goal.revision_rejected` |
| Concern·구조 | `concern.opened`, `concern.reopened`, `concern.held`, `concern.completed`, `concern.closed`(강등 포함), `structure.changed`(분해·병합·재조합), `boundary_item.recorded` |
| 진입·상황·루프 | `entry.evaluated`, `situation.assessed`, `loop_plan.adopted`, `loop.transitioned`, `mode.assigned`, `dial.set` |
| 관찰·전제 | `observation.recorded`(08 관찰 종류: 사람 발화 `utterance`, 반응, 도구 결과, 응답 없음 등), `observation.retracted`, `assumption.recorded` |
| 추측·판단 | `interpretation.proposed`, `possibility.proposed`(원함 탐구의 기준 후보 포함), `check.declared`, `check.observed`, `claim.evidence_linked`, `claim.counter_searched`, `finding.promoted`, `finding.confirmed`, `record.staled`, `record.superseded` |
| 원함 탐구 | `inquiry.opened`, `inquiry.anchored`, `inquiry.round_started`, `inquiry.round_ended`, `inquiry.stop_rule_met`, `inquiry.stopped`, `stimulus.created`, `stimulus.presented`, `contrast.presented`, `preference_model.created`, `preference_model.versioned`, `preference.criterion_confirmed`, `preference.divergence_noted`, `preference.divergence_shown` |
| 질문 | `question.recorded`, `question.delivered`, `question.seen`, `question.deferred`, `question.escalated`, `question.answered`, `question.assumed`, `question.withdrawn`, `question.expired`, `approval.issued`, `approval.consumed` |
| 선택·이의 | `choice.committed`(혼자 정한 것은 `autonomy` 포함), `objection.filed`, `objection.resolved`, `decision.confirmed`, `autonomous.seen` |
| 합의 | `agreement.proposed`, `agreement.revised`, `agreement.confirmed`(활성 방식 `human`·`direct_instruction`), `agreement.activated_by_grant`(Grant, 화면 이름 "맡겨 둔 권한", 판정 J-116), R-OP-2(a)의 선택 범위 활성(08 `choice_scope`, 09·10에 이벤트·경로 추가 요구), `agreement.activated_by_rule`, `agreement.declined`, `agreement.renegotiated`, `agreement.stop_condition_met`, `agreement.violation_detected`, `agreement.fulfilled` |
| WorkUnit·실행 | `workunit.started`, `workunit.paused`, `workunit.resumed`, `workunit.scope_exceeded`, `run.started`(`attempt`), `run.steered`(사람의 실행 중 지시), `directive.applied`(런타임이 턴 경계에서 반영), `run.interrupted`, `run.ended`, `budget.exhausted` |
| 도구 | `toolcall.requested`, `toolcall.blocked`, `toolcall.approval_requested`, `toolcall.started`, `toolcall.completed`, `toolcall.interrupted`, `toolcall.not_executed`, `toolcall.outcome_uncertain`, `toolcall.recovered`, `workspace.unlinked_change_observed`, `rollback_point.registered` |
| 거부 | `command.rejected`(status rejected·needs_gate·conflict, 사유 코드는 10 §3.4.4) |
| 결과·반영 | `result.submitted`, `attestation.recorded`, `acceptance.recorded`(결정 값 08 `AcceptanceDecision`), `obligation.added`, `obligation.resolved`, `obligation.deferred`, `obligation.transferred`, `integration.completed`, `reflection.recorded` |
| 복귀 | `brief.acknowledged`, `brief.corrected`, `resumption_check.opened`·`answered`·`scored` |
| 기기·운영 | `pairing.code_created`, `pairing.code_consumed`, `pairing.code_failed`, `device.paired`, `device.revoked`, `device.connected`, `auth.denied`, `daemon.booted` |
| 2단계 이후 | `expectation.created`, `expectation.timed_out`, `prediction.recorded`, `prediction.checked`, `probe.planned`, `probe.concluded`, `watch.*`, `policy_proposal.submitted`, `policy_proposal.accepted`, `policy_proposal.dismissed`, `policy_proposal.effect_measured` |

### 2.6 사람 조작 셈법

01 §3.5.2를 따른다. 요약:

- `D`(결정 조작): Helm이 제시한 요청(합의 초안, 결과 제출, 질문, 기준 후보, Goal 수정 제안, Concern 열기 제안, 에이전트가 정한 것, 관찰 제안)에 대한 결정 입력 1건. 초안을 고쳐서 확정해도 한 번의 제출이면 1건. 질문 여러 개를 한 화면에서 답하면 질문 수만큼.
- `I`(입력): 사람이 먼저 시작한 입력(새 요청, 실행 중 지시, 다이얼 변경)과 원함 탐구의 반응.
- 보기(화면 열기, 펼치기, 근거 보기, 복귀 요약 읽음 표시)는 세지 않는다.
- 변경 WorkUnit 정상 경로의 `D`는 2 이하(R-OP-1). 정상 경로 밖 `D`는 사유(`scope_expansion`, `rights_gate`, `correction_cycle`, `reinquiry`, `goal_change`, `contest`, `promotion`)를 함께 적는다. 셈법 세 가지(묶어 답하기, 반영 항목 처리, 고쳐서 확정)는 01 §3.5.2 "셈법" 표를 따른다.

### 2.7 공통 전제 상태

여러 유즈케이스가 같은 출발 상태를 쓴다. 테스트 fixture 이름으로도 쓴다 [제안].

| fixture | 내용 |
|---|---|
| `F-base` | 데몬 실행 중. 기기 두 대(Mac `dv_mac`, Windows `dv_win`) 페어링됨. 프로젝트 `blog`(`~/projects/blog/`)와 `shop`(`~/projects/shop/code/shop`, React 18 앱)이 허용 폴더로 등록됨. 각 프로젝트에 확정된 Goal 1개 |
| `F-blog-goal` | `blog`의 Goal v1: "개인 블로그를 꾸준히 운영한다" |
| `F-shop-goal` | `shop`의 Goal v1: "개인 쇼핑몰 데모를 포트폴리오로 쓸 만한 품질로 만든다" |
| `F-model-faux` | 가짜 모델(정해진 순서로 제안을 내는 대본 재생). 커널 테스트에 쓴다 |
| `F-model-live` | 실제 모델. 실사용 기록(01 §3.8.3 항목 2)에 쓴다 |

## 3. 명세 본문

### 3.1 유즈케이스 목록

| ID | 이름 | 단계 | 진입 | 주 루프 | 주 원칙(01) | 가설(01 §3.10) |
|---|---|---|---|---|---|---|
| UC-01 | 취향형 작업의 원함 탐구 | MVP | E1 | O, I.want, C.commit, A.confirm | PR-01, PR-02, PR-03 | V1, V9, H8 |
| UC-02 | 원인 조사 | MVP | E1 | O, I.fact, C.commit, A.confirm | PR-07, PR-09 | H3, H4 |
| UC-03 | 여러 날 걸리는 작업(클라이언트 없이 진행 후 복귀) | MVP | E1 | C.commit, A.confirm, O | PR-04, PR-06 | H2, V2 |
| UC-04 | 외부에서 접속해 질문에 답하기(Tailscale, SSH, 2단계부터 휴대폰) | MVP(데스크톱), 2단계(휴대폰) | — | — | PR-06 | H4, V2 |
| UC-05 | 혼자 정한 결정 확인과 이의 | MVP | — | 해당 루프 | PR-05 | V5 |
| UC-06 | 복귀 요약 | MVP | — | O | PR-08, PR-09 | H1 |
| UC-07 | 되돌리기 비싼 선택(작업 합의 C와 결과 확인 A) | MVP | E1, E3 | C.commit, A.confirm, A.reflect | PR-04, PR-07, PR-12 | H2, H10, V8 |
| UC-08 | 반복 마찰을 관찰 에이전트가 찾아 제안 | 2단계 | E2(관찰) | A.reflect | PR-06, PR-10 | 16에서 정의 |
| UC-09 | Goal 정제 | MVP | — | I → N | PR-01, PR-07 | H8 |
| UC-10 | 데몬 재시작·연결 끊김 중 작업 | MVP | — | — | — | NFR-A, NFR-D |
| UC-11 | 처음 설치·기기 페어링 | MVP | — | — | PR-01 | — |
| UC-12 | 실행 중 방향·기준 바꾸기 | MVP | — | C | PR-07 | H5 |
| UC-13 | 새 근거로 판단·선택 다시 열기 | MVP | — | A → I | PR-09 | H6, H9 |
| UC-14 | Method Transfer로 가능성 넓히기 | 2단계 | E1 | I.possibility, C.probe | PR-03 | V6 |
| UC-15 | 가벼운 작업과 Concern 승격·강등 | MVP | E1, E2, E3 | (가벼운 작업) | PR-10 | V7 |
| UC-16 | 외부 응답 기다리기 | 2단계 | — | C, O | PR-06 | V2 |
| UC-17 | 다른 기기·클라이언트·런타임에서 이어 하기 | MVP(기기), 2단계(휴대폰), 3단계(TUI), 이후(어댑터) | — | — | PR-08, PR-12 | — |
| UC-18 | 비상 대응(비상 합의) | 3단계 | E1 | C.emergency, O, A.reflect | PR-12 | V3 |
| UC-19 | Concern 나누기와 합치기 | 3단계 | — | S.split, S.recombine | — | V4 |

### 3.2 ID 대응 표

초기 목록(조정자 공통 지시의 UC-01~UC-09)의 번호와 이름을 유지했다. 이름을 조금 고친 것과 새로 더한 것은 다음과 같다.

| 초기 ID·이름 | 확정 ID·이름 | 바뀐 점 |
|---|---|---|
| UC-01 취향형 작업(글의 톤, 기획 방향, 디자인)의 원함 탐구 | UC-01 취향형 작업의 원함 탐구 | 이름만 줄임. 세 종류는 대안 흐름으로 다룸 |
| UC-02 원인 조사(증상은 있는데 원인 불명) | UC-02 원인 조사 | 같음 |
| UC-03 여러 날 걸리는 작업(클라이언트 없이 진행) | UC-03 여러 날 걸리는 작업 | 같음 |
| UC-04 외부에서 접속해 질문에 답하기(Tailscale 또는 SSH) | UC-04 | 같음. 두 경로를 각각 기본 흐름과 대안 흐름으로 |
| UC-05 에이전트가 혼자 정한 결정 확인과 이의 | UC-05 | 같음 |
| UC-06 복귀 요약 | UC-06 | 같음 |
| UC-07 되돌리기 비싼 선택(작업 합의 C와 결과 확인 A) | UC-07 | 같음. "되돌리기 비싼"은 사용자의 판단이며 Helm이 계산하지 않는다(결정 2, §3.10 참고) |
| UC-08 반복 마찰을 관찰 에이전트가 찾아 개선 제안 | UC-08 | 같음. 2단계 |
| UC-09 Goal 정제 | UC-09 | 같음 |
| — | UC-10 데몬 재시작·연결 끊김 중 작업 | 새로 더함(브리프 지시 항목) |
| — | UC-11 처음 설치·기기 페어링 | 새로 더함(브리프 지시 항목) |
| — | UC-12 실행 중 방향·기준 바꾸기 | 새로 더함(v0.2 CLI-G02, CLI-G01 실패 주입 F5, canon-3 체크리스트 "실행 중 재정의") |
| — | UC-13 새 근거로 판단·선택 다시 열기 | 새로 더함(canon-3 체크리스트 "결정 재개", 공리 A13) |
| — | UC-14 Method Transfer로 가능성 넓히기 | 새로 더함(canon-3 체크리스트, v0.3 04 §4.3) |
| — | UC-15 가벼운 작업과 Concern 승격·강등 | 새로 더함(01 §3.6, v0.2 CLI-Q01) |
| — | UC-16 외부 응답 기다리기 | 새로 더함(결정 9, v0.3 03 §7) |
| — | UC-17 다른 기기·클라이언트·런타임에서 이어 하기 | 새로 더함(foundations/10 §9, v0.2 PORT-G01) |
| — | UC-18 비상 대응 | 새로 더함(v0.3 03 §9.2) |
| — | UC-19 Concern 나누기와 합치기 | 새로 더함(v0.3 03 §4, §9.1) |

### 3.3 원전·대화 사용 사례와의 대응

| 원전·대화 사용 사례 | 대응 유즈케이스 | 처리 |
|---|---|---|
| v0.2 CLI-Q01 작은 문서 오탈자 수정(Quick) | UC-15 기본 흐름 | 가벼운 작업으로 재작성 |
| v0.2 CLI-G01 잘못된 Decision이 Brief를 오염(Guided) | UC-02 + UC-07 | 박자 8개를 O → I.fact → 선택 → C → A로 나눠 씀. 가능성 4개 보존, Gate 2개(선택, 결과 확인), 실패 주입 F1~F6을 UC-07·UC-12의 수용 기준으로(§3.10, §3.15) |
| v0.2 CLI-G02 실행 중 완료 기준 변경 | UC-12 | 데스크톱 기준으로 재작성 |
| v0.2 CLI-G03 하루 뒤 작업 복귀 | UC-06 | 복귀 점검 질문 4개(UC-06 A1)를 수용 기준과 01 G1-1 측정으로 |
| v0.2 CLI-A01 외부 배포가 포함된 변경(Assured) | UC-07 대안 흐름 A4(권리 게이트), UC-18 | send는 항상 권리 게이트 |
| v0.2 PORT-G01 Codex → Pi → OpenCode 이어 하기 | UC-17 이후 단계 변형 | 런타임 어댑터 단계로 미룸. MVP에서는 기기 전환으로 연속성 확인 |
| foundations/10 §9 Cross-runtime 이어서 일하기 10단계 | UC-17 | "클라이언트를 바꿔도, 자리를 비워도 이어진다"로 바꿔 씀 |
| foundations-friendly 07 결제 흐름 예시 9단계 | UC-02·UC-07·UC-06 묶음의 서술 틀 | 1인 사용으로 바꿈(팀, 사람 책임자 칸 삭제) |
| foundations-friendly 02 8단계 흐름 | 모든 MVP 유즈케이스의 단계 순서 | 돌아오기(UC-06) → 목표와 초점(UC-01·09) → 가능성(UC-02) → 선택(UC-02) → 합의(UC-07) → 자율 진행과 방향 수정(UC-03·12) → 결과 확인(UC-07) → 반영과 배움(UC-07·08) |
| foundations/08 §4 질적 연구의 일곱 순간 | UC-06(복귀), UC-13(결과 충돌), UC-05(권고 거부), UC-07(완료 주장 신뢰·의심), UC-09(재정의), UC-07 반영(여러 결과 수용), UC-01 FX(몰입·피로) | 각 유즈케이스의 관찰 항목으로 둠 |
| v0.2 authority-carry-forward-001(비확장 합의 활성, 확대 시 Gate) | UC-07 기본 흐름 단계 3의 R-OP-2 변형, 대안 흐름 A2 | |
| v0.2 runtime-effects-context-001(불확실 외부 결과 복구) | UC-10 대안 흐름 B3 | |
| v0.2 decision-gate 예시 §9(짧은 자연어 수락 → Commitment 전개) | UC-07 기본 흐름 단계 1~3 | |
| 대화 L2304–2316 한 턴의 흐름(pi 안의 Helm) | UC-07 기본 흐름 | 가짜 모델 대본의 출발점(§3.24) |
| 대화 L2426–2441 "첫 화면이 느리다" 탐구 흐름 | UC-02 | |
| v0.3 03 §9.1 블로그 글 방향 잡기 | UC-01(MVP), UC-19(분해 변형, 3단계) | MVP에서는 C.probe 없이 |
| v0.3 03 §9.2 배포 후 장애 | UC-18 | |
| v0.3 06 §6 밤 11시 예시(Q-14, Q-15) | UC-03 단계 6~10, UC-04 | |
| v0.3 04 §4.3 Method Transfer 예(주문표 레일) | UC-14 | |
| 대화 L4388 사용 장면 4~5개(아침 복귀, 작업 중 질문, 취향 탐구, 자리 비운 동안 계속, 다른 런타임에서 이어 하기) | UC-06, UC-04, UC-01, UC-03, UC-17 | |

### 3.4 UC-01 취향형 작업의 원함 탐구

| 항목 | 내용 |
|---|---|
| 목표 | 사용자가 말로 정하지 못한 글의 기준을 자극과 반응으로 찾고, 그 기준으로 만든 초안을 확인한다 |
| 단계 | MVP |
| 출발 | 진입 E1. 조건 EC-1(목표가 흐림), EC-3(취향) |
| 상황 유형 | 복합 |
| 루프 계획 | MVP: O → I.want → C.commit → A.confirm → A.reflect. 2단계부터 v0.3 05 §6 기본 조합(I.want ⇄ C.probe → A.watch)을 쓴다 |
| 모드 | 취향 탐색(v0.3 07 §4). 다이얼 기본값: 첫 라운드 자극 8개, 근거 범위 "웹까지(읽기)", 전달 방식 "라운드 경계에 예약" |
| 사전 조건 | `F-base`, `F-blog-goal`. 사용자가 Mac 앱으로 연결되어 있음 |
| 사후 조건 | 선호 모델(기준 2개 이상 확정, `stated_vs_revealed` 기록)이 Goal에 연결됨. 초안이 결과 확인됨 |
| 관련 문서 | 15(원함 탐구 절차), 05(반응 상호작용), 04(자극판), 11(기준 확인 질문), 14(정지 규칙, 루프 계획) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | 새 일에 "Helm 개발기 첫 글을 블로그에 쓰고 싶어. 짧고 담백하게." 입력 | `RGN-COMPOSER` | 요청을 사람 발화 관찰로 기록. 라우터가 진입 신호 EC-1(다룰 범위가 정해지지 않아 완료 기준을 한 문장으로 쓸 수 없음), EC-3(톤·방향이 취향)을 근거(요청 관찰 id)와 함께 선언. 커널이 진입 규칙(01 §3.6.3) 적용 | `observation.recorded`(obsKind `utterance`), `entry.evaluated`(decision `enter`, 판정 근거와 autonomy 포함), `concern.opened`(origin `human_start`) | I1 |
| 2 | — | `SCR-CONCERN-OVERVIEW` | O: 상황 판정 질문에 근거와 함께 답("정답이 취향에 달려 있는가: 예", "분석하면 정답에 가까운 답이 나오는가: 아니오") → 복합. 루프 계획 제안, 모드 "취향 탐색" 선택 | `situation.assessed`, `loop_plan.adopted`, `mode.assigned`(각각 혼자 정한 결정의 `autonomy` 포함) | — |
| 3 | — | — | I.want 1단계: 표현된 요구("짧고 담백하게")를 기록. 앵커링: 확실한 것(블로그, 첫 글, 주제 Helm), 모호한 것("짧다", "담백하다"의 뜻, 독자), 암묵 가정(독자는 개발자)을 나눠 기록. 이 Goal에 선호 모델이 없으므로 탐구 엔진이 빈 Goal 층 선호 모델을 만든다(15 §3.6.2, §3.7.2) | `inquiry.opened`, `preference_model.created`(scope Goal `blog`), `inquiry.anchored`(확실한 것·모호한 것), `assumption.recorded`(암묵 가정) | — |
| 4 | — | — | 2단계: 서로 결과를 보지 않는 하위 호출로 도입부 자극 8개 생성. 방향이 다른 것(장면 묘사, 문제 제기, 회고 일지, 기술 요약), 다른 분야 형식(요리 칼럼, 등산기), 극단(한 줄 도입, 긴 서사)을 포함. 참고 글 몇 개를 웹에서 읽어 근거로 둠. 순서를 섞음 | `inquiry.round_started`, `stimulus.created` × 8(출처 참조), `stimulus.presented`, `observation.recorded`(도구 결과, 웹 읽기) | — |
| 5 | 자극판을 열고 반응: 문장 구간을 골라 "이 톤 좋음", 강도 선택, "이유는 모르겠는데 이건 아님", "이거랑 비슷한데 더 짧게". 다 본 뒤 "라운드 마치기" | `SCR-STIM` | 반응마다 관찰로 기록(자극 id, 구간, 강도, 이유 유무, 고쳐 말하기 문장). 라운드는 사람이 "라운드 마치기"를 눌러 닫는다(05 §3.2.5, 판정 J-34). 닫는 계기의 전체 목록은 15가 정한다 | `observation.recorded`(kind `reaction`) × 9, `inquiry.round_ended` | I9 |
| 6 | — | `SCR-STIM`(기준 후보 영역) | 4단계: 모델이 기준 후보를 낸다. C1 "도입부는 구체적인 장면으로 시작"(근거: 반응 3건), C2 "기술 설명보다 경험담"(근거 2건, 반대 근거 1건), C3 "길이보다 톤이 중요"(근거 1건). 말한 기준 "짧게"와 반응(긴 서사 도입을 두 번 좋아함)의 차이를 `stated_vs_revealed`로 남김 | `possibility.proposed`(기준 후보) × 3, `preference.divergence_noted` | — |
| 7 | — | — | 5단계: 가장 불확실한 기준(C3)을 확인할 다음 자극을 코드가 고른다. 모델은 자극 후보마다 "C3가 맞다면 / 아니라면 예상 반응"을 선언하고, 커널 정책이 두 예상 반응의 차이가 큰 것을 고름. 같은 톤·다른 길이, 같은 길이·다른 톤 쌍과 세 개 비교("둘은 비슷하고 하나는 다른데 무엇 때문인가") 1건 | `inquiry.round_started`, `contrast.presented`, `stimulus.presented`(2라운드) | — |
| 8 | 2라운드 반응, 세 개 비교에 짧게 답하고 "라운드 마치기" | `SCR-STIM` | 관찰 기록. 기준 후보의 근거·반대 근거 갱신 | `observation.recorded` × 5, `inquiry.round_ended` | I5 |
| 9 | — | `SCR-STIM`(기준 후보 패널), `SCR-INBOX` | 라운드 경계. 기준 확인 질문(QuestionKind `criterion_confirm`) 기록: "C1, C2를 선호 모델에 올릴지 정해야 합니다. 근거는 반응 다섯 건입니다. 지금 정하지 않으면 초안을 쓰기 전까지 두 기준을 임시로 적용합니다."(05 §3.10.6 형식) 정보 게이트, 임시 가정 "두 기준을 임시로 적용", 만료점 "초안 작성 시작 전", 전달은 예약(라운드 경계). 사용자가 앱을 쓰고 있으므로 OS 알림 없이 질문함 묶음과 자극 보드 패널에 보인다 | `question.recorded`, `question.delivered` | — |
| 10 | 질문함에서 C1은 그대로, C2는 "경험담 위주, 짧은 코드 하나는 괜찮음"으로 고쳐 함께 확정. C3는 보류 | `SCR-QUESTION` | 커널이 기준 확정. 선호 모델 갱신(C1, C2' 확정, C3는 답 값 `keep`으로 후보 유지, 15 §3.6.7). 한 명령의 기준 변경이므로 모델 버전은 1회 오른다 | `question.answered`, `preference.criterion_confirmed` × 2, `preference_model.versioned` | D1 |
| 11 | 3라운드 자극 4개에 반응하고 "라운드 마치기" | `SCR-STIM` | 3라운드의 계획 지문이 2라운드와 같고 남은 질문도 계획을 바꾸지 않음(15 `planStable` 둘째 조건, §3.6.8) → 정지 규칙 충족. C.commit으로 전환 | `stimulus.presented`, `observation.recorded` × 4, `inquiry.round_ended`, `inquiry.stop_rule_met`, `loop.transitioned`(I.want → C.commit, autonomous, 이유 "정지 규칙") | I4 |
| 12 | — | `SCR-AGREE` | 작업 합의 초안: 목적(첫 글 초안), 완료 기준(C1, C2', 분량 "2,000자 안팎" — 말한 "짧게"와 반응의 차이를 함께 표시), 범위(`~/projects/blog/drafts/**` 쓰기), 금지(발행, push), 제출할 근거(기준별 해당 문단 표시), 멈출 조건(기준끼리 충돌할 때). 새 경로 쓰기는 요청에 없던 범위이므로 R-OP-2 대상이 아님 → 확정 요청 | `agreement.proposed` | — |
| 13 | 합의 카드에서 분량을 "1,500자 안팎"으로 고쳐 확정 | `SCR-AGREE` | 커널이 합의 확정, WorkUnit 시작 | `agreement.confirmed`, `workunit.started` | D1 (정상 경로 1) |
| 14 | — | `SCR-CONCERN-OVERVIEW`(지금 하는 일) | 초안 작성(write), 글자 수 확인(execute). 마무리 직전 검사: 제출이 없으면 한 번 더 진행 요청. 결과 제출: 기준별 근거(C1 → 첫 문단 구간과 write 도구 호출 id, 분량 → 글자 수 도구 결과 id). "선호 모델과 맞는가"는 사람 판단이므로 "확인 못함(사람 판단 필요)"으로 표시 | `toolcall.requested/started/completed`, `observation.recorded`, `result.submitted` | — |
| 15 | 결과 확인 화면에서 초안을 읽고, 취향 기준 행(C1, C2')마다 "맞음 / 아님 / 모르겠음" 중 판정을 남긴 뒤(빈 칸은 "모르겠음") "결과 확인". "확인 못함" 기준이 남아 있으면 화면의 주 버튼은 [조건 붙여 확인]이다(04 §3.12). 반영 처리 방침은 기본값 "에이전트가 모두 진행"(반영 항목: "다음 글 기본 합의에 C1·C2' 넣기") | `SCR-REVIEW` | 커널이 결과 확인 기록. 반영 항목 생성, 사람이 고른 처리 방침(에이전트 처리 위임)을 기록 | `acceptance.recorded`(accepted), `obligation.added` | D1 (정상 경로 2) |
| 16 | — | `SCR-GOAL` | 확정된 기준은 Goal 층 선호 모델(15 §3.7.2, `scope.goalId = blog`)에 이미 들어 있으므로 Goal 개정은 없다. 반영 WorkUnit은 다음 글 기본 합의 템플릿에 기준을 더하고, 그 항목은 근거 관찰이 붙으면 커널이 닫는다(10 R-21). Concern을 닫을 수 있는 상태가 됨 | `obligation.resolved`, `integration.completed`, `concern.completed` | — |
| 17 | (선택) 돌아보기 한 줄 "다음 글도 장면 도입으로 시작" | `SCR-REVIEW` | 기록 | `reflection.recorded` | I1 |

합계: D3(기준 확정 1, C/A 2), I20. C/A 구간의 정상 경로 결정 조작 2.

#### 대안 흐름

- A1 기획 방향: "다음 분기 개인 프로젝트 방향을 잡고 싶다". 자극은 서로 다른 기획 한 장 요약(다른 분야 사례 포함: 출판 기획, 게임 로드맵). 같은 절차. 결과물은 문서 초안이고 C/A는 같다.
- A2 디자인 톤(이미지 자극): 자극은 사용자가 고른 폴더의 레퍼런스 이미지와 웹에서 읽은 레퍼런스. 이미지는 HTTP로 받는다(결정 31). 요소 단위 반응은 이미지 영역을 골라 단다. 이미지 생성은 2단계 후보(01 OQ-13).
- A3 "이거다": 사용자가 한 자극에 "이거다"라고 하고 이유를 말하면 그 이유를 기준 후보로 바꿔 기준 확인 질문을 하고, 확인되면 단계 11의 정지 규칙을 바로 충족한다(v0.3 04 §3.3 둘째 조건, 15 §3.6.8).
- A4 예산 다 씀: 원함 탐구 예산(다이얼)이 다 되면 묻지 않고 원함 탐구를 끝내고, 열린 기준 후보와 질문을 넘긴 채 루프 계획의 다음 단계로 간다(14 T22, `budget_exhausted`). Concern 개요와 복귀 요약에 "예산 다 씀 · 확정된 기준 n개, 넘긴 후보 m개"를 보인다. 사용자는 예산을 늘려 원함 탐구로 돌아갈 수 있다(I).
- A5 "오늘은 여기까지": 사용자가 멈춤을 입력하면 I.want를 멈추고(`workunit.paused`) 다음 라운드를 다음 복귀 요약에 예약한다(01 FX-05).
- A6 수정 요청: 단계 15에서 "셋째 문단 기술 설명이 길다"로 수정 요청(D, `correction_cycle`). 합의는 그대로, 진행 중으로 돌아가 재제출 → 결과 확인 다시(D, `correction_cycle`).
- A7 기준이 틀림: 결과가 기준에는 맞는데 사용자가 "뭔가 아니다"라고 하면(PS-5) 결과 확인에서 "기준이 틀림"(`criteria_wrong`, `reopenTo` I, D1 `reinquiry`)을 고른다 → I.want로 돌아가 새 자극. 이때 확정된 기준에 반대 근거가 붙는다.
- A8 사용자가 "그냥 하나 골라서 써 줘": 사용자 지시로 기록하고 따른다(01 FX-07). 원함 탐구는 멈추고 고른 결과도 반응 관찰로 남는다.
- A9 (2단계) 탐침: 기준 확인용 짧은 초안 3개를 탐침형 C로 동시에 쓰고, 키울 조건("사용자가 이어 쓰고 싶다고 함")·접을 조건을 둔다. 지속 관찰형 A로 발행 뒤 반응을 지켜본다.
- A10 (3단계) 분해: 반응을 보니 "주제"와 "형식"의 선호가 따로 움직이면 하위 Concern 둘로 나눈다(UC-19, v0.3 03 §9.1).

#### 예외 흐름

- E1 자극 생성 하위 호출 일부 실패: 남은 자극으로 진행하고 실패 수를 표시한다. 남은 자극이 최소 수(기본 4) 미만이면 한 번 다시 시도하고, 그래도 부족하면 그 상태로 보이며 사용자가 진행 여부를 정한다(정보 게이트 질문).
- E2 웹 읽기 실패: 해당 자극은 "근거 없음"으로 표시하고 근거 있는 자극과 구분해 보인다(v0.3 04 §4.4).
- E3 반응끼리 모순: 모순은 지우지 않고 기준 후보의 반대 근거로 남긴다. 다음 자극은 모순되는 두 반응 중 어느 쪽이 맞는지 확인할 수 있는 것을 먼저 고른다.
- E4 사용자가 반응하지 않음: 자극판은 열린 채로 두고 예약 전달로 다음 복귀 요약에 올린다. 기준 확인 질문이 만료점(초안 작성 시작 전)에 이르면 즉시로 승격하고, 그래도 답이 없으면 정보 게이트이므로 임시 가정을 확정하고 에이전트가 정한 것으로 남긴다. 가정 확정으로는 기준이 확정되지 않으므로(15 §3.6.7), 확정 기준이 0개면 합의 초안의 완료 기준은 임시 적용 후보를 "추측" 표시와 함께 쓴다(15 §3.6.9에 요구). 합의 확정(단계 13)은 사람이 해야 하므로 그 전에는 초안을 쓰지 않는다.

#### 수용 기준

- AC-01-01 Given `F-base`, 가짜 모델이 EC-1·EC-3 신호를 근거 id와 함께 선언 / When 커널이 판정 / Then `entry.evaluated`(decision `enter`, 혼자 정한 결정의 autonomy 포함)와 `concern.opened`(origin `human_start`)가 같은 트랜잭션에 기록된다. 진입 판정은 `entry.evaluated`로 남고 이의 대상이 된다. 이의를 걸 대상 형식(레코드 또는 이벤트 seq 대상)은 08·09가 정한다(§5.2).
- AC-01-02 상황 판정 제안에 판정 질문의 답이나 근거가 없으면 커널은 내용 거부로 거절하고 거부 이벤트를 남긴다(v0.3 05 §3.2 규칙 5).
- AC-01-03 모든 라운드의 자극 묶음은 최소 4개다(판정 J-06). 첫 라운드에는 다른 분야 또는 극단으로 분류된 자극(15 데이터)이 1개 이상 있다. 자극의 출처 링크는 반응 전에도 보이지만 "다른 분야"·"극단" 라벨은 라운드를 마친 뒤에 보인다. 제시 순서는 생성 순서와 다르다(섞임 표시가 있다).
- AC-01-04 자극 생성 하위 호출 각각의 입력 컨텍스트에는 다른 하위 호출의 결과가 들어 있지 않다(런타임이 하위 호출 입력의 참조 목록을 기록하고 테스트가 이를 검사).
- AC-01-05 반응 네 형태(요소 단위, 강도, 이유 없음, 고쳐 말하기)가 각각 `observation.recorded(kind=reaction)`로 기록되고, 자극 id와 구간(또는 이미지 영역)을 가진다.
- AC-01-06 라운드의 반응이 "하나 고르기"뿐이면 정지 규칙을 충족한 것으로 보지 않고, 다음 라운드에 세 개 비교 자극이 포함된다.
- AC-01-07 `possibility.proposed`(기준 후보)가 반응 관찰 id를 하나도 참조하지 않으면 거부된다.
- AC-01-08 작업 에이전트가 기준 확정을 시도하면 자격 거부로 거절된다. 기준 확정은 사람 명령으로만 생긴다.
- AC-01-09 같은 선언(예상 반응)과 같은 기준 상태에서 다음 자극 선택 결과가 같다(결정성).
- AC-01-10 기준과 무게가 두 라운드 연속 바뀌지 않으면 `loop.transitioned(I.want → C.commit, autonomous=true)`가 이유와 함께 기록된다. 예산을 다 쓰면 정지 규칙 충족으로 보지 않고 `loop.transitioned`가 이유 `budget_exhausted`와 함께 기록되며 열린 후보가 넘겨진다. 예산 질문은 만들지 않는다.
- AC-01-11 말한 기준과 반응이 다르면 선호 모델의 `stated_vs_revealed`에 기록되고 합의 초안에 두 값이 함께 보인다.
- AC-01-12 확정된 합의가 없는 상태에서 `drafts/` 쓰기 도구 호출은 `toolcall.blocked`(code `denied.agreement_required`)로 막힌다.
- AC-01-13 단계 12~16에서 16 `human_op` 계산의 `normalPath=true`인 결정 조작은 정확히 2건이다(01 §3.5.2 셈법).
- AC-01-14 결과 확인 전 Concern 상태는 "반영 완료"가 아니다. 반영 항목이 모두 닫히거나 명시적으로 미뤄진 뒤에만 Concern을 닫을 수 있다.
- AC-01-15 확정 기준은 처음부터 Goal `blog`의 Goal 층 선호 모델(15 §3.7.2)에 있고 Goal 버전은 오르지 않는다. 결과 확인 뒤 다음 글의 합의 초안 완료 기준에 그 기준이 쓰인다. 반영 처리는 전역 방침(R-OP-3)으로 고르고 항목별로 고르지 않는다.
- AC-01-16 (화면 검사, 04·21) 자극판에 "하나 고르기"만 있는 상태가 없고, 요소 단위 반응과 이유 없음 입력이 항상 보인다.
- AC-01-17 (관찰 항목, 15 §3.15.2 E0) 실사용 기록에도 E0과 같은 형식(보기 전·본 뒤 목표와 완료 기준, 변화 정도, 피로)을 남긴다. 16이 V1·H-I1 판정에 쓴다.

### 3.5 UC-02 원인 조사

| 항목 | 내용 |
|---|---|
| 목표 | 증상은 있는데 원인이 불분명한 문제에서, 경쟁하는 원인 후보를 구분 확인으로 가려 판단을 세우고 수정 방향을 정한다 |
| 단계 | MVP |
| 출발 | 진입 E1. 조건 EC-1(무엇이 "빠름"인지 기준이 없음), EC-2(원인 후보가 여럿) |
| 상황 유형 | 복잡 |
| 루프 계획 | O → I.fact → (선택) → C.commit → A.confirm. 2단계부터 선택 전 I.outcome(사전 부검)을 넣을 수 있다 |
| 모드 | 원인 조사(v0.3 07 §4) |
| 사전 조건 | `F-base`, `F-shop-goal`. `shop`은 Git 저장소 |
| 사후 조건 | 판단 1건 승격(근거, 구분 확인, 반대 근거 탐색 기록 포함), 사람이 고른 선택 1건, 그 선택에 따른 변경이 결과 확인됨 |
| 관련 문서 | 15(사실 탐구), 10(판단 승격), 11(선택 요청), 04(사실 탐구 화면, 근거 체인) |

예시는 대화 L2426–2441의 "첫 화면이 느리다" 탐구 흐름과 v0.3 09 §4.7의 근거 체인 예를 쓴다.

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | "shop 데모를 본 사람들이 첫 화면이 느리다고 계속 말해. 원인 찾아서 고쳐 줘." 입력 | `RGN-COMPOSER` | 진입 판정: EC-1, EC-2 → enter | `observation.recorded`, `entry.evaluated`(decision `enter`), `concern.opened` | I1 |
| 2 | — | `SCR-CONCERN-OVERVIEW` | O: 상황 판정 복잡("분석하면 정답에 가까운 답이 나오는가: 예"). 루프 계획, 모드 "원인 조사" | `situation.assessed`, `loop_plan.adopted`, `mode.assigned` | — |
| 3 | — | — | 앵커링: 확실한 것(느리다는 말이 반복됨), 모호한 것("첫 화면"이 어느 화면인지, "느리다"의 기준), 가정(모바일 사용자). 기준 질문 기록: "느리다의 기준을 정해야 합니다. 추천은 모바일 LCP 2.5초입니다. 지금 정하지 않으면 수정 방향을 정하기 전까지 2.5초로 진행합니다."(05 §3.10.6 형식) 정보 게이트, 막힘 아님, 임시 가정 "LCP 2.5초", 만료점 "수정 방향 선택 전", 전달 협상 | `interpretation.proposed`(anchor, assumption), `question.recorded`, `question.delivered` | — |
| 4 | 홈 주의 카드에서 [가정대로 진행] | `SCR-HOME`(또는 `SCR-QUESTION`) | 답이 임시 가정과 같음 → 그대로 진행. 완료 기준 후보에 반영 | `question.answered` | D1 |
| 5 | — | `SCR-INQUIRY` | 가능성 4개 제안: P1 첫 렌더 전 API 4개 순차 호출, P2 번들 크기, P3 이미지 최적화 없음, P4 서버 응답 지연. 모델이 확인 후보마다 가능성별 예상 결과와 비용을 선언. 커널 정책이 "결과가 서로 달라지는 가능성 수 ÷ 비용"으로 확인 순서를 정함(대화 L2439, 15 §3.5.3 코드 계산. 순서 자체는 레코드가 없고 구분 확인 선언에서 다시 계산된다) | `possibility.proposed` × 4, `check.declared` × n | — |
| 6 | — | `SCR-INQUIRY` | 확인 실행(read, 읽기 목적 execute). 탐구용 빌드·측정은 프로젝트 밖 임시 작업 공간에서 실행 [가정: 13이 정함]. 결과가 관찰이 됨: O-2 "첫 렌더 전 API 4개가 순차 호출", O-5 "모바일 조건 LCP 4.1초", O-8 "3번째 요청을 빼면 LCP 4.1 → 2.9초"(구분 확인: P1이 맞으면 줄고 P2·P3면 그대로일 결과) | `toolcall.*`, `observation.recorded` × n, `interpretation.proposed`(관찰 id 참조) | — |
| 7 | — | — | 반대 근거 탐색: 번들 크기 확인(P2 약화), 데스크톱 LCP 1.9초인데 불만이 적음(CE-1, 열린 질문으로 남김). 판단 승격 제안 "첫 화면 지연의 주원인은 순차 요청"(근거 O-2, O-8 / 반대 근거 탐색 기록 / 남은 반대 근거 없음) | `observation.recorded`, `claim.counter_searched` | — |
| 8 | — | `SCR-HOME` 주의 카드, `SCR-EVIDENCE`(판단 확인, 03 §3.2.4) | 커널 승격 검사 통과(10 §3.9). 이 판단은 다음 선택에 쓰이므로 판단 확인 질문 기록(정보 게이트, 막지 않음. 사람이 이 판단을 근거로 선택하면 판단도 확인된다, 10 §3.9.3) | `finding.promoted`(kernel), `question.recorded`(QuestionKind `finding_confirm`), `question.delivered` | — |
| 9 | 근거 체인을 펼쳐 O-8을 봄 | `SCR-EVIDENCE` | — | — | — |
| 10 | — | — | 1순위 가능성이 두 라운드 연속 유지 → 정지 규칙(v0.3 04 §2.3). 선택 요청 기록(권리 게이트, 판정 J-131): 지금 정할 것(수정 방향), 왜 지금, 추천(요청 병렬화. 선택지는 구조화된 범위 `src/pages/home/**`, `src/api/**` 쓰기를 가지며 화면은 그 범위를 커널 값 그대로 보인다), 가장 강한 다른 선택(서버 렌더링 도입: 범위가 큼), 아직 모르는 점(모바일 실기기 측정 없음), 미뤘을 때의 영향, 다시 볼 조건(병렬화 뒤 LCP가 2.5초를 넘으면). 행동: 추천대로 정하기 / 가장 강한 다른 선택으로 정하기 / 고쳐서 정하기, 그 밖에 기준 고치기 · 질문 다시 쓰기 · 먼저 탐구 · 맡기기(사람이 명시적으로 고를 때만, 판정 J-131. 질문 상태 `delegated`, 화면 라벨 "에이전트에게 맡김", 판정 J-114) · 조건까지 미루기 · 이의(04 §3.4, 05 IX-02). 권리 게이트이므로 임시 가정과 만료점이 없다 | `inquiry.stop_rule_met`, `inquiry.stopped`(then `decide_now`), `loop.transitioned`(I.fact → C.commit, 14), `question.recorded`(kind `choice_request`, gate `rights`). 순서는 탐구 멈춤 → 루프 전환 → 선택 질문(08 R-23, 15 §3.1.5) | — |
| 11 | "추천대로 정하기" | `SCR-QUESTION` 또는 `SCR-CONCERN-OVERVIEW` | 사람 선택 기록(선택지의 구조화된 범위 포함). 다시 볼 조건 포함. O-8 판단을 근거로 골랐으므로 판단 확인 질문도 함께 답한 것으로 닫힌다 | `question.answered`, `choice.committed`(decided_by human), `finding.confirmed`(via choice_commit) | D1 |
| 12 | — | `SCR-AGREE` | 커널이 합의 범위 ⊆ 11에서 사람이 직접 고른 선택지의 범위를 검사해 통과(R-OP-2 (a), 판정 J-133) → 확정 질문 없이 활성. echo만 보임: 결과(API 요청 병렬화), 범위(`src/pages/home/**`, `src/api/**` 읽기·쓰기), 금지(push, 의존성 추가), 근거(측정 재실행, 테스트), 멈출 조건(API 응답 형식 변경이 필요할 때) | `agreement.proposed`, 선택 범위 활성 이벤트(활성 방식 `choice_scope`, authority basis: 11의 choice id. 이벤트 이름은 J-90에 따라 09가 더함, 이 문서는 `agreement.activated_by_choice`로 적는다 [제안]) | — (정상 경로 0) |
| 13 | — | `SCR-CONCERN-OVERVIEW` | 변경 WorkUnit 실행, 측정 재실행, 테스트. 결과 제출(기준별 근거: LCP 2.6초 → "미충족", 테스트 통과 → 충족) | `workunit.started`, `toolcall.*`, `observation.recorded`, `result.submitted` | — |
| 14 | 결과 확인 화면에서 "LCP 2.6초, 기준 2.5초 미충족"을 보고 조건부 확인을 고르고, 반영 항목(남은 0.1초를 다시 볼 조건으로 등록, README 성능 메모)을 지금 처리로 둠 | `SCR-REVIEW` | 결과 확인 기록, 반영 항목 처리. 선택 CH의 다시 볼 조건이 활성 상태로 남음. 나중에 조건이 발화해 사람이 정한 선택이 낡으면 재결정 질문이 생긴다(판정 J-138, UC-13) | `acceptance.recorded`(conditional), `obligation.added/resolved` | D1 (정상 경로 1) |

합계: D3(기준 질문 1, 선택 1, 결과 확인 1), I1. C/A 구간 정상 경로 결정 조작 1.

#### 대안 흐름

- A1 기준 질문에 답이 없음: 만료점("수정 방향 선택 전")에 이르면 즉시로 승격해 알림. 그래도 답이 없으면 정보 게이트이므로 임시 가정(LCP 2.5초)을 확정하고 에이전트가 정한 것으로 남긴다(`question.assumed`, `choice.committed`(choiceKind `assumption_confirmed`)).
- A2 반대 근거 발견: 승격 제안 시점에 추측과 맞지 않는 관찰이 있으면 커널이 내용 거부로 거절한다. 가능성으로 남고 다음 구분 확인을 고른다. 거부도 기록된다.
- A3 판단 확인 거절: 사용자가 판단 확인을 거절하거나 이의를 걸면(D, `contest`) 판단은 가능성으로 돌아가고 무엇이 부족한지 묻는 질문 또는 추가 확인이 생긴다.
- A4 자동 검증 가능한 선택: 병렬화 방식(`Promise.all` 직접 작성 대 기존 데이터 패칭 라이브러리 기능) 둘 다 테스트와 측정으로 바로 확인할 수 있으면 에이전트가 정하고 `why_not_asked = "자동 검증 가능한 선택"`으로 남긴다(대화 L3403 정책 예).
- A5 상황 재판정: 사실 탐구가 예산을 다 써도 1순위가 안정되지 않으면 복잡 → 복합을 의심하고 O로 돌아가 재판정한다(v0.3 05 §4.2). 재판정도 에이전트가 정한 것이다.
- A6 (2단계) 선택 전 결과 탐구: 추천안에 사전 부검("병렬화 뒤에도 불만이 줄지 않았다면 왜?")을 하고 예측 레코드에 확인 날짜를 붙인다.

#### 예외 흐름

- E1 측정 도구 실패: 실패도 관찰로 남기고(공리 A14) 같은 확인을 다시 시도한다. 세 번 실패하면 확인 방법을 바꾸거나 사람에게 묻는다.
- E2 탐구 중 프로젝트 쓰기 시도: 활성 합의가 없으므로 막힌다(`denied.agreement_required`). 탐구 단계에서는 읽기와 임시 작업 공간 실행만 한다.
- E3 근거 범위 밖 자료 필요: 근거 범위 다이얼이 "작업 대상만"이면 웹 읽기는 막히고, 범위를 넓힐지 질문(정보 게이트)을 기록한다.

#### 수용 기준

- AC-02-01 관찰 id를 하나도 참조하지 않는 해석 제안은 전제(assumption)로 기록된다(대화 L2229–2234).
- AC-02-02 같은 선언(가능성별 예상 결과와 비용)에서 확인 순서가 같다(결정성, 15 §3.5.3의 코드 계산). 순서는 구분 확인 선언과 함께 기록되어 근거를 따라갈 수 있다.
- AC-02-03 판단 승격은 10 §3.9 규칙을 모두 만족할 때만 받아들여진다: 근거가 실제 도구 실행 관찰이다, 근거 중 하나 이상이 사후가 아닌 구분 확인이다, 반대 근거 탐색 기록(`counterChecked`)이 있다, 맞지 않는 관찰이 없다, 지지 근거의 출처가 둘 이상 독립이다(같은 모델·같은 루트 실행의 일치는 세지 않는다, 판정 J-18). 하나라도 빠지면 `policy.promotion_requirements`와 빠진 항목 목록으로 거절된다. `experiments/helm-toy/helm.mjs`의 거부 8건 대본이 커널 테스트에서 같은 결과(내용 5, 자격 2, 경로 1)를 낸다.
- AC-02-04 결정에 쓰이는 판단은 승격과 함께 판단 확인 질문(정보 게이트, 막지 않음)이 생긴다. 사람이 그 판단을 근거로 선택하면 판단도 확인된 것으로 기록된다. 증명 부담이 "엄격"이면 확인 전의 판단은 선택의 근거로 쓰이지 않는다(10 §3.9.3).
- AC-02-05 선택 요청에는 지금 정할 것, 왜 지금, 추천, 가장 강한 다른 선택, 아직 모르는 점, 미뤘을 때의 영향, 다시 볼 조건이 있고, 행동에 기준 고치기·질문 다시 쓰기·먼저 탐구·미루기가 항상 있다(04 §3.4, 05 IX-02). `[승인] [거절]`만 있는 선택 요청은 커널이 거부한다(공리 A15).
- AC-02-06 추천은 선택이 아니다. 사람의 답 전에는 사람이 정한 `choice.committed`(autonomy `HumanDecision`)가 없다.
- AC-02-07 진짜 가능성 2개 이상이 구분 확인이나 사람의 선택까지 남아 있다(v0.2 CLI-G01 통과 기준).
- AC-02-08 사람이 직접 고른 선택지의 구조화된 범위 안인 합의는 활성 방식 `choice_scope`(선택 id)로 확정 질문 없이 활성된다(판정 J-133, 10의 합의 범위 ⊆ 선택 범위 검사). 범위를 넘는 차원이 하나라도 있거나, 선택이 가정 확정·맡기기로 생긴 것이면 `agreement.proposed` 뒤 확정 질문이 생긴다.
- AC-02-09 자동 검증 가능한 선택은 에이전트가 정하고 `choice.committed`(choiceKind `auto_verified`, `whyNotAsked.kind = auto_verifiable`, 08 §3.4.5)가 남는다.
- AC-02-10 (관찰 항목, 15 §3.15.2 E0) 실사용 기록에 보기 전·본 뒤 문제 정의와 완료 기준을 남긴다.

### 3.6 UC-03 여러 날 걸리는 작업

| 항목 | 내용 |
|---|---|
| 목표 | 저녁에 맡긴 일이 클라이언트 없이 밤새 진행되고, 사람이 없을 때 생긴 질문은 게이트와 전달 방식에 따라 처리되며, 다음 날 돌아와 판단할 것만 처리한다 |
| 단계 | MVP |
| 출발 | 진입 E1. 조건 EC-4(여러 세션·여러 날), EC-5(테스트·빌드·배포 설정과 얽힘) |
| 상황 유형 | 복잡 |
| 루프 계획 | O → I.fact(현재 설정 조사, 짧게) → C.commit(단계 4개) → A.confirm |
| 모드 | 실행(v0.3 07 §4) |
| 사전 조건 | `F-base`, `F-shop-goal`. 1일 차 21:00, 사용자는 외부(카페)에서 Mac 앱으로 Tailscale 경로 연결 |
| 사후 조건 | 마이그레이션 결과 확인됨. 밤에 생긴 정보 게이트 질문 1건은 가정 확정되어 에이전트가 정한 것으로 남음. 권리 게이트 질문 1건은 다음 날 사람이 허락 |
| 관련 문서 | 11(전달 방식, 가정 만료), 12(스케줄러, 데몬 상주), 14(작업 합의의 단계, §3.17 클라이언트 없이 진행할 때의 규칙 표), 04(복귀 요약) |

이 유즈케이스는 v0.3 06 §6의 "밤 11시" 예시를 개발 작업으로 옮긴 것이다.

#### 기본 흐름

| # | 시각 | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|---|
| 1 | 1일 21:00 | "shop을 CRA에서 Vite로 옮겨 줘. 오늘 밤 돌려 두고 내일 아침에 볼게." 입력 | `RGN-COMPOSER` | 진입 판정 EC-4, EC-5 → enter. 상황 판정 복잡, 루프 계획, 모드 "실행" | `entry.evaluated`(decision `enter`), `concern.opened`, `situation.assessed`, `loop_plan.adopted`, `mode.assigned` | I1 |
| 2 | 21:01 | — | `SCR-CONCERN-OVERVIEW` | I.fact: `package.json`, 설정 파일, 테스트 설정을 읽어 관찰로 남김. 질문 없이 진행 | `observation.recorded` × n, `interpretation.proposed` | — |
| 3 | 21:05 | — | `SCR-AGREE` | 작업 합의 초안(단계 4개): S1 Vite 설정과 개발 서버 기동, S2 환경변수 이름 변경(`REACT_APP_` → `VITE_`), S3 테스트 설정 정리(Jest 유지), S4 빌드 결과 비교. 완료 기준: 개발 서버 기동, 빌드 성공, 테스트 전부 통과, 번들 크기 차이 10% 이내. 범위: 프로젝트 쓰기(`.github/**` 제외), 의존성 추가 허용(`vite`, `@vitejs/plugin-react`), 네트워크 `net:<origin>`(패키지 설치와 push), 보낼 곳(send 대상) 작업 브랜치 `vite-migration` → `origin`. send는 범위 안이어도 실행마다 권리 게이트를 거친다(판정 J-91, J-140). 금지: 기본 브랜치 push, 배포. 예산: 시간 5시간, 비용(모델 추정값, 사람이 고칠 수 있음). C.commit에서는 합의의 예산이 루프 기본 예산보다 먼저다(14에 요구). 근거: 단계별 명령 결과. 멈출 조건: 테스트 러너 교체가 필요할 때, 번들 차이 10% 초과. 의존성 추가는 요청에 없던 범위 → 확정 요청 | `agreement.proposed` | — |
| 4 | 21:07 | 합의 카드를 보고 확정, 앱을 닫음 | `SCR-AGREE` | 합의 확정, WorkUnit 시작. 클라이언트 연결이 끊겨도 데몬은 계속 | `agreement.confirmed`, `workunit.started` | D1 (정상 경로 1) |
| 5 | 21:40 | — | — | S1, S2 완료. 단계마다 명령 결과를 관찰로 남기고 합의의 진행 지점(08 `checkpoint`)과 대조한다. 결과 제출은 하지 않는다. 사람 확인은 합의 단위로 마지막에 한 번 | `observation.recorded` × n | — |
| 6 | 23:02 | — | — | S3: CRA의 Babel 설정이 없어 Jest가 깨짐. 멈출 조건("테스트 러너 교체가 필요할 때")에 해당하는지 확인: Jest를 유지하고 Babel 설정을 직접 두면 교체 없이 해결 가능. 합의 범위 안의 해법이므로 에이전트가 진행하되, 사용자가 Vitest 전환을 원할 수 있어 질문 Q-A 기록. 정보 게이트, 막힘 아님, 임시 가정 "Jest 유지", 만료점 "A.confirm으로 넘어가기 전"(작업 경계 `loop_transition`), 사용자 부재 → 예약(다음 복귀 요약). 결정은 만료 때 한 번만 기록한다 | `question.recorded`(Q-A), `assumption.recorded`("Jest 유지, Babel 설정 추가") | — |
| 7 | 23:40 | — | — | S4 진행 중, 에이전트가 CI 빌드로도 확인하려고 작업 브랜치 push를 원함. push는 합의의 send 대상이지만 send는 언제나 권리 게이트(J-91) → 질문 Q-B "작업 브랜치 `vite-migration`을 원격에 push할지 정해야 합니다. 허락하면 CI 빌드로도 확인합니다. 정하지 않으면 push 없이 진행하고 결과에 'CI 미확인'이 남습니다."(05 §3.10.6 형식). 그 호출만 승인 대기(`toolcall.approval_requested`)로 두고 run은 계속한다(12 §3.13.1에 요구). 즉시 전달 대상이지만 연결된 기기가 없어 다음 복귀 요약으로 예약된다(05 §3.1.2). 다음 연결 때 "지금 선택이 필요함" 맨 위에 보인다. push에 기대는 일만 멈추고 나머지는 계속 | `question.recorded`(Q-B, gate `rights`), `toolcall.approval_requested` | — |
| 8 | 2일 01:25 | — | — | S3·S4가 끝나 A.confirm으로 넘어가기 직전 Q-A 만료점 도달 → 즉시로 승격. 연결된 기기 없음. 만료점을 넘기면 되돌리는 비용이 커지므로 임시 가정을 확정하고 에이전트가 정한 것으로 남김 | `question.escalated`, `question.assumed`, `choice.committed`(autonomous, from_question Q-A) | — |
| 9 | 01:30 | — | — | S3·S4 완료(테스트 통과, 번들 +4%). 결과 제출: 기준별 근거. "CI 빌드 확인"은 Q-B 대기로 "확인 못함" | `result.submitted`(scope `agreement`) | — |
| 10 | 2일 08:40 | Mac 앱을 엶 | `SCR-BRIEF` | 재접속(저장한 위치 `{storeId, seq}` 다음부터 재전송, 19 §3.5). 복귀 요약: 지금 선택이 필요함 1(Q-B, 권리 게이트), 결과 확인 필요 1(마이그레이션), 에이전트가 정한 것 6(접힘, 가정 확정 1 포함), 진행 중 작업 없음, 다음 예정 "Q-B 허락 시 push와 CI 확인" | `brief.acknowledged`(사용자가 읽음 표시) | — |
| 11 | 08:42 | Q-B 허락 | `SCR-QUESTION` | 권리 게이트 답 기록. 대기 중인 run이 없으므로 14가 같은 thread의 새 run을 요청하고, 승인된 호출을 같은 tcId로 실행한다(판정 J-96, J-40). CI 결과를 읽어 관찰로 기록. WorkUnit은 이미 제출 상태이므로 이 관찰은 제출 뒤 관찰로 결과 확인 화면의 "CI 빌드 확인" 기준 옆에 붙는다(규칙은 10·08에 요구) | `question.answered`, `toolcall.approved`, `approval.consumed`, `toolcall.started`·`completed`(send), `observation.recorded` | D1 (정상 경로 밖, `rights_gate`) |
| 12 | 08:50 | 결과 확인 화면에서 "결과 확인". 반영 처리 방침은 기본값 "에이전트가 모두 진행"(반영 항목: README 실행 방법 갱신, 열린 Concern "번들 크기 측정"의 전제("CRA 빌드") 무효화, 배포 설정 변경) | `SCR-REVIEW` | 결과 확인 기록. 반영 WorkUnit 실행 | `acceptance.recorded`(accepted), `obligation.added/resolved` | D1 (정상 경로 2) |
| 12a | 08:51 | 펼쳐진 전체 반영 단계에서 배포 설정 변경을 [미루기] | `SCR-REVIEW` | 미룬 항목은 다음 복귀 요약 맨 위에 남음 | `obligation.deferred` | — (선택 조작, 정상 경로 수에 넣지 않음) |
| 13 | 08:52 | 에이전트가 정한 것을 펼쳐 "Jest 유지(가정 확정)"를 확인. 이의 없음 | `SCR-AUTO` | — | — | — |

합계: D3(정상 경로 2, `rights_gate` 1), I1.

#### 대안 흐름

- A1 밤에 Q-A에 답함: 사용자가 깨어 있어 Mac에서 "Vitest로 바꿔"라고 답하면, 테스트 러너 교체는 합의의 멈출 조건에 해당하므로 범위 확대 질문(권리 게이트, `gate.scope_expansion_required`)이 생긴다. 사용자가 허락하면 합의가 새 개정판으로 바뀐다(`agreement.renegotiated`). 범위 확대는 R-OP-2의 포함 증명 대상이 아니므로 확정이 따로 필요하다(Q-A 답 D1 + 범위 허락 D1, 둘 다 `scope_expansion`, 01 §3.8.5).
- A2 push 거절: Q-B를 거절하면 CI 확인은 하지 않고 결과 제출의 한계에 "CI 미확인"이 남는다. 결과 확인 화면에서 이 한계가 보인다.
- A3 예산 다 씀: 밤중에 합의 예산(없으면 C.commit 기본 예산)이 다 되면 현재 단계를 마치고 멈추고 예산 질문(`budget_extension`, 정보 게이트, 막힘)을 남긴다(05 §3.6.4). 복귀 요약에 "예산을 다 써서 S3에서 멈췄습니다"와 [예산 늘리기] [여기까지 결과로 제출받기] [범위 줄여 계속]이 보인다(01 FX-09). 세 버튼과 질문 선택지 값의 대응, 진행 요약 형식은 14가 정본이고 문구 키는 05가 정한다.
- A4 밤중 데몬 재시작: Windows Update로 호스트가 재부팅되면 UC-10의 B2 흐름을 따른다. 재시작 동안 지난 만료점은 재시작 직후 처리되고, 처리 시각이 늦었다는 사실이 기록된다.
- A5 다른 기기로 아침에 봄: 같은 아침 집의 Windows 호스트에서 앱을 열면 같은 복귀 요약이 보인다(UC-17).

#### 예외 흐름

- E1 결과 제출의 근거가 실재하지 않음: 커널이 그 기준을 "확인 못함"으로 강등하고 제출은 받아들인다(거부하지 않는다). 결과 확인 화면에 강등 수가 보인다(CA-3).
- E2 멈출 조건 충족: 번들 차이가 10%를 넘으면 에이전트는 그 단계에서 멈추고 선택 요청을 기록한다. 멈춘 상태가 복귀 요약의 "지금 선택이 필요함"에 들어간다.
- E3 즉시 전달 대상 기기 없음: 알림을 보낼 기기가 없으면 질문은 다음 복귀 요약으로 예약되고(05 §3.1.2), 첫 연결 때 "지금 선택이 필요함" 맨 위에 보인다. 같은 질문을 기기마다 반복해 알리지 않는다.

#### 수용 기준

- AC-03-01 단계 4 뒤 모든 클라이언트 연결이 끊긴 상태에서도 WorkUnit이 진행되고 이벤트가 계속 기록된다.
- AC-03-02 단계 진행은 관찰로만 남고 사람 확인을 요구하지 않는다. 결과 제출과 Concern의 "결과 확인 대기"는 합의 단위로 한 번(단계 9)이다.
- AC-03-03 멈출 조건에 해당하는 상황에서 에이전트가 합의 밖 행동을 계속하면 커널이 막는다. 합의 안의 다른 해법을 쓰면 `why_not_asked`가 있는 에이전트가 정한 것이 남는다.
- AC-03-04 권리 게이트 질문(Q-B)은 사용자가 없으면 만료나 가정 확정으로 넘어가지 않는다. 그 질문에 기대는 행동(push)만 막히고 다른 단계는 진행된다.
- AC-03-05 정보 게이트 질문(Q-A)은 기록 때 `assumption.recorded`만 남기고 결정은 남기지 않는다. 만료점에서 `question.escalated` → (답 없음) → `question.assumed`와 `choice.committed`(choiceKind `assumption_confirmed`, `whyNotAsked.kind = assumption_expired`, questionId Q-A) 순서로 한 번 기록된다.
- AC-03-06 만료 처리는 연결된 클라이언트가 없어도 스케줄러가 한다.
- AC-03-07 같은 질문에 대해 기기별 알림은 한 번만 간다(X-11). 승격은 다시 알릴 수 있는 유일한 경우이며 한 번만 다시 알린다.
- AC-03-08 다음 날 복귀 요약에서 권리 게이트 질문이 "지금 선택이 필요함"의 첫 항목으로 보이고, 가정 확정 건은 "에이전트가 정한 것"의 개수에 포함된다.
- AC-03-09 합의 범위에 `net:<origin>`과 send 대상이 있어도 push 호출은 권리 게이트 질문 없이 실행되지 않는다(판정 J-91, J-140). 답 전에는 그 호출만 `toolcall.approval_requested`로 대기하고, 허락 뒤 같은 tcId로 실행되며 `approval.consumed`가 Q-B의 승인을 가리킨다.
- AC-03-10 이 흐름에서 16 계산의 `normalPath=true` 결정 조작은 2건이고, 정상 경로 밖 조작 1건의 사유(`opReason`)는 `rights_gate`다.

### 3.7 UC-04 외부에서 접속해 질문에 답하기

| 항목 | 내용 |
|---|---|
| 목표 | 집 밖에서 노트북으로 서버에 붙어, 쌓인 질문에 답하고 그 영향을 확인한다. 접속 경로는 Tailscale serve 경유 WSS(기본 흐름)와 SSH 경유(대안 흐름 B) 두 가지다 |
| 단계 | MVP |
| 상황 | 다른 유즈케이스(UC-01 단계 9, UC-02 단계 3, UC-03 단계 7)에서 생긴 질문에 답하는 공통 흐름 |
| 사전 조건 | `F-base`. Mac이 tailnet에 로그인되어 있음. 앱에 접속 프로필 두 개가 있음: "Tailscale"(`wss://<서버>.<tailnet>.ts.net:8448` → 데몬 `tailnet` 리스너 127.0.0.1:7840), "SSH"(서버의 tailnet 이름, 22번, 사용자, 키. `ssh -W`로 데몬 `loopback` 리스너 127.0.0.1:7841에 붙음, 조정자 판정 §2). 기기 토큰은 OS 키체인에 있음 |
| 사후 조건 | 답이 커널에 기록되고, 런타임이 반영했으며(단계 6), 사용자가 영향을 확인했다 |
| 관련 문서 | 17·18(접속, 인증), 19(재전송, 멱등), 20(알림, 키체인, 오프라인), 11(전달 방식), 05(질문 카드) |

접속 방식은 정해졌다. Tailscale 경로는 `wss://<서버>.<tailnet>.ts.net:8448/rpc` → `tailscale serve` → 데몬 `tailnet` 리스너 127.0.0.1:7840이다. SSH 경로는 앱이 시스템 OpenSSH로 `ssh -W 127.0.0.1:7841 <서버>`를 띄워 `loopback` 리스너에 붙고, 그 위에서 같은 HTTP + WebSocket을 쓴다(19 P-02, §3.2.3). 두 경로 모두 기기 토큰으로 인증한다(19 P-03, 18 ADR-18-2). 이 유즈케이스는 두 경로에서 같은 결과가 나와야 한다는 것을 정한다.

#### 기본 흐름 (Tailscale 경로)

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | — | 질문 기록. 협상 전달이므로 질문함과 홈 주의 카드에만 올리고 OS 알림은 기본으로 띄우지 않는다(05 §3.1.2) | `question.recorded`, `question.delivered` | — |
| 2 | (노트북이 잠자기에서 깨어남) | `RGN-TOPBAR`(다시 연결하는 중) | 앱이 Tailscale 경로로 WSS 연결. `tailscale serve`가 127.0.0.1의 데몬으로 넘김. 데몬이 Tailscale 신원 헤더와 기기 토큰을 확인. 앱이 저장한 위치 `{storeId, seq}` 다음부터 재전송(19 §3.5) | 운영 기록: 연결(기기 id, 리스너 `tailnet`). 09가 도메인 로그에 둘지 정함 | — |
| 3 | 홈 주의 카드(또는 질문함)에서 질문을 엶. 협상 알림을 켜 두었다면 OS 알림(기본: 제목 "Helm", 본문 "확인할 일이 1건 있습니다.")을 눌러 연다 | `SCR-HOME` 또는 `os.notify` → `SCR-QUESTION` | 재전송으로 받은 전달은 묶어 한 번만 알린다(19 §3.8.3) | — | — |
| 4 | 질문 카드를 읽음: 지금 정할 것, 왜 지금, 임시 가정, 만료점, 근거. 근거 하나를 펼쳐 봄 | `SCR-QUESTION`, `SCR-EVIDENCE` | — | — | — |
| 5 | 답함 | `SCR-QUESTION` | 앱이 멱등 키와 화면 기준 seq(`basisSeq`)를 붙여 `question.answer`를 보냄. 화면을 연 뒤 질문이 바뀌었으면 `3004 command.revisionConflict`(10 `conflict.version_mismatch`)로 거부되고 쓰던 답은 남는다(19 §3.9.3, 04 §3.0.5). 앱은 "보내는 중"을 표시하고, 커널 수락 뒤에만 상태를 바꿔 보인다 | `question.answered`(device `dv_mac`, listener `tailnet`) | D1 |
| 6 | — | `SCR-CONCERN-OVERVIEW` | 실행 중인 run이 있으면 다음 턴 경계의 투영 갱신(delta)으로 답을 넣고 `directive.applied`(출처 `question.answered`)를 남긴다. 사람을 기다리던 run이면 12의 이어가기(`ended(handed_off)` 뒤 같은 thread 새 run, 판정 J-38)를 따른다(12에 요구). 답이 임시 가정과 다르면 그 가정에 기대어 한 일을 표시하고, 합의 범위 안이면 고쳐 진행, 범위 밖이면 선택 요청 | `directive.applied` 또는 `agreement.scope_change_requested` + `question.recorded`(scope_change) | — |
| 7 | 답의 영향(바뀐 계획, 다시 하는 일)을 확인 | `SCR-CONCERN-OVERVIEW` | 영향 표시(X-14) | — | — |

합계: D1.

#### 대안 흐름

- B SSH 경로: 단계 2에서 앱이 "SSH" 프로필로 서버의 WSL OpenSSH(22번, tailnet 안에서만 열림, 키 인증)에 `ssh -W 127.0.0.1:7841`로 접속해 데몬 `loopback` 리스너에 붙고, 기기 토큰으로 인증한다(19 P-02·P-03). 단계 3~7은 같다. 사용하는 경우: Windows 호스트의 `tailscale serve` 설정이 깨졌을 때, 사용자가 SSH 키 접속을 선호할 때.
- C 오프라인에서 답하려 함: 비행기 안에서 앱의 마지막 상태로 질문을 볼 수는 있지만 답은 보낼 수 없다. 답 칸에 쓴 내용은 기기에 초안으로 남고 "연결되면 보낼 수 있음"이 보인다. 연결되면 사용자가 최신 질문 상태를 보고 직접 보낸다(자동 전송 없음, 조정자 판정 J-02). 그 사이 질문이 가정 확정됐으면 보낸 답은 `3008`로 거부된다. 응답에는 확정된 값(`assumedValue`)과 다음 행동 "이의로 보내기"가 실린다. 앱은 "답이 없어 01:10에 임시 가정대로 정해졌습니다."를 보이고, 쓰던 답을 그 결정에 대한 이의 초안으로 넘긴다(판정 J-120, 04 §3.0.5, UC-05). 답을 보낸 직후 응답 전에 연결이 끊긴 경우에만 앱이 같은 멱등 키로 다시 보낸다.
- D 두 기기에서 동시에 답함: 먼저 받아들여진 답만 남고 나중 답은 "이미 답함"으로 거부된다(01 FX-11).
- E 권리 게이트의 즉시 전달: 연결된 모든 기기에 알림이 가고, 어느 기기에서 답해도 된다. 이미 띄운 OS 알림은 지울 수 없으므로, 다른 기기에서 그 알림을 눌러 열면 "이 질문은 09:12에 답했습니다(다른 기기)."를 보인다(05 §3.1.8, 04 §3.0.5).
- F 묶어 답하기: 비슷한 시점에 생긴 질문 여러 개를 질문함에서 한 화면으로 답한다. 결정 조작은 답한 질문 수만큼 센다(사람의 화면 조작은 한 번이어도 결정은 질문마다 따로 기록된다).
- G "가정대로 진행": 답 대신 임시 가정을 그대로 받아들이는 행동. 임시 가정과 같은 답으로 기록된다(D1).
- H Windows 호스트의 앱: 서버와 같은 PC의 Windows에서 실행하는 앱도 두 경로 중 하나로 붙는다. 같은 기기 안 직접 연결(127.0.0.1)을 따로 허용할지는 17·18이 정한다(§7 UQ-07).
- M 휴대폰(2단계, 결정 42·47·48): 휴대폰 클라이언트는 데몬이 서빙하는 홈 화면 웹 앱(PWA)이고 알림은 Web Push다. 휴대폰 푸시는 알림 강도 `interrupt`·`notice` 질문에만 간다. 단계는 26 §3.4.8·§3.7.1을 따른다.
  1. 잠금 화면의 "Helm · 확인할 일이 1건 있습니다."(기본 내용 숨김, 판정 J-03)를 누른다(보기).
  2. 웹 앱이 `/m/q/<질문 id>`로 열리고 캐시된 질문 카드를 읽기 전용으로 먼저 보인다. 머리에 "연결하는 중"(`SCR-M-QUESTION`, 03 §3.12).
  3. 연결이 준비되면 결정 버튼이 활성된다. 주 버튼을 누른다(D1). 이후 커널 쪽 흐름(단계 5~7)은 같다.
  - 웹 앱이 백그라운드로 가면 연결을 닫고, 다시 앞으로 오면 저장한 위치부터 재전송받는다(19 §3.17, 26 §3.3.5).
  - 조작은 보기 1 + D1로 데스크톱(단계 3·5)과 같다. 휴대폰에서 다루기 어려운 질문 형식과 큰 산출물·취향형 결과 확인은 데스크톱 전용이고 휴대폰에서는 미루기만 둔다(판정 J-37, J-139). 휴대폰 결과 확인은 산출물을 연 뒤에만 받는다(판정 J-139).

#### 예외 흐름

- E1 Mac의 Tailscale이 꺼져 있음: 두 경로 모두 tailnet을 거치므로 연결되지 않는다. 앱은 마지막 상태를 읽기 전용으로 보이고 "서버에 연결할 수 없습니다. 이 기기의 네트워크와 Tailscale(또는 SSH) 연결을 확인하세요. 쓰던 답은 저장해 두었습니다."(`err.connection.offline`, 05 §3.11)를 보인다.
- E2 기기 토큰이 폐기됨: 인증 실패. 앱은 다시 페어링하라는 안내를 보인다(UC-11). 실패는 18이 정한 감사 기록에 남는다.
- E3 `tailscale serve` 경로만 실패: 앱이 SSH 프로필로 바꿔 붙을 수 있음을 안내한다(대안 흐름 B).
- E4 프로토콜 버전 불일치: 서버 연결을 맺지 않는다(19 `1003`). 앱은 기기에 저장한 마지막 화면을 읽기 전용으로 보이고 앱 또는 서버 갱신을 안내한다(01 FX-16, 19 F-05).
- E5 데몬이 내려가 있음: 01 FX-10.

#### 수용 기준

- AC-04-01 OS 알림은 기본으로 내용을 숨겨 05의 숨김 문구 키(`notif.hidden.*`: 제목 "Helm", 본문 "확인할 일이 n건 있습니다.")만 보인다. 협상 전달은 기본으로 OS 알림을 띄우지 않는다. "알림에 내용 보이기"를 켜면 제목 "<할 일> · <마감 효과>", 본문 "<Concern 이름> · 질문 n"을 보이고, 질문 문장 전체는 넣지 않는다(판정 J-03, 05 §3.7.5·§3.7.6).
- AC-04-02 알림(OS 알림, 홈 주의 카드, 질문함 행 중 하나)을 누른 뒤 그 질문에 답하기까지 결정 조작은 1회다(01 NFR-U-7).
- AC-04-03 기기 토큰이 없거나 폐기된 연결은 Tailscale 경로와 SSH 경로 모두에서 거부된다.
- AC-04-04 같은 대본을 Tailscale 경로와 SSH 경로로 실행하면 `hello` 응답의 연결 정보(`connection.listener`, `tailscaleLogin`)를 빼면 프로토콜 메시지의 순서와 내용이 같고(19 §3.16.4), 이벤트 로그는 연결 경로 표시를 빼면 같다(결정 38).
- AC-04-05 재접속 뒤 앱은 저장한 위치 `{storeId, seq}` 다음 이벤트를 빠짐없이, 순서대로, 한 번씩 받는다. `storeId`가 다르거나 재전송 범위를 넘으면(19 `2001`) 스냅샷 경로로 화면을 새로 받고 생략 사실을 보인다(19 §3.5.5).
- AC-04-06 연결이 없을 때는 답을 보낼 수 없고 입력은 기기에 초안으로 남는다. 재연결 뒤 초안은 자동으로 보내지지 않는다. 응답 전에 끊긴 명령만 같은 멱등 키로 다시 보내져 한 번만 적용된다(J-02). 가정 확정 뒤 도착한 답은 `3008`로 거부되고 응답에 `assumedValue`가 실리며, 앱은 쓰던 답을 이의 초안으로 넘긴다(판정 J-120). `question.assumed`의 bumpsRevision 값은 09가 명시한다.
- AC-04-07 답이 임시 가정과 다르면 런타임은 다음 턴 경계 전까지 그 가정에 기대던 작업을 표시하고, 합의 범위 안에서 고치거나 선택 요청을 만든다. 임시 가정으로 한 일을 조용히 그대로 두지 않는다.
- AC-04-08 사람의 답 이벤트에는 기기 id와 연결 리스너(`tailnet`/`loopback`/`local`, 19 `ListenerKind`)가 남고, 이 값은 서버가 연결 정보로 채운다.
- AC-04-09 (2단계) 휴대폰에서 낸 답도 같은 사람 명령으로 처리되어 데스크톱에서 낸 답과 같은 이벤트를 남긴다. 다른 것은 `via.deviceId`뿐이고 `listener`는 `tailnet`이다. 휴대폰에서 비활성인 응답(데스크톱 전용 형식)은 명령을 보내지 않는다(화면 `SCR-M-*`는 03 §3.12, 세부 기준은 26).

### 3.8 UC-05 혼자 정한 결정 확인과 이의

| 항목 | 내용 |
|---|---|
| 목표 | 에이전트가 묻지 않고 정한 결정을 나중에 모아 보고, 동의하지 않는 것에 이의를 걸어 다시 열고, 그 결과가 작업에 반영되게 한다 |
| 단계 | MVP |
| 사전 조건 | UC-02가 단계 13까지 진행됨(결과 제출, 아직 결과 확인 전). 그 과정에서 에이전트가 정한 것 7건: 진입 판정 1, 상황 판정 1, 루프 계획·전환 2, 모드 1, 가정 확정 0, 일반 선택 2(그중 하나 CH-22 "병렬화는 `Promise.all`로 직접 작성", why_not_asked "자동 검증 가능한 선택") |
| 사후 조건 | CH-22는 contested를 거쳐 재결정 질문의 답(사람의 선택)으로 대체됨. 기존 합의 아래 재작업 WorkUnit이 고쳐 다시 제출함. 이의 기록이 묻기 정책 조정의 자료로 남음 |
| 관련 문서 | 11(혼자 정한 결정, 이의 흐름), 10(contested 전이), 04(에이전트가 정한 것 화면), 16(이의 지표) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | 홈을 엶 | `SCR-BRIEF` | 복귀 요약의 "에이전트가 정한 것 7"이 접혀 있고 종류별 개수만 보임 | — | — |
| 2 | 펼침 | `SCR-AUTO` | 항목마다 무엇을 정했나, 고려한 대안, 이유, 묻지 않은 이유, 이 결정에 기대는 작업, 시각 | — | — |
| 3 | CH-22에 이의를 걸고 이유를 적음: "이미 쓰는 데이터 패칭 라이브러리로 해" | `SCR-AUTO` → `OVL-CONTEST` | 커널: 이의 기록, CH-22 contested, 관련 Concern 다시 열림, 같은 결정점의 재결정 질문(선택 요청, 막힘)을 추천 없이 만든다(커널은 모델을 부르지 않는다). 이어서 14가 재결정 run을 요청하고, 그 run이 이유 문장을 반영한 추천("데이터 패칭 라이브러리의 병렬 조회 사용")을 질문에 더한다(11 §3.10.2에 요구). 루프 전환이 필요하면 14가 R 채널로 낸다(11 §3.10.1 reopenLoop 표를 14로 합침). 이의 창의 영향 표시에 "다시 정할 질문: 질문 1 [지금 정하기]"가 보인다 | `objection.filed`, `concern.reopened`, `question.recorded`, `question.updated`(추천 추가) | D1 (`contest`), I1(이유 입력) |
| 3a | 영향 표시의 [지금 정하기]로 질문을 열고 "추천대로 정하기" | `SCR-QUESTION` | CH-31 기록, CH-22 대체, 이의 upheld | `question.answered`, `choice.committed`(CH-31, decided_by human), `record.superseded`(CH-22), `objection.resolved` | D1 (`contest`) |
| 4 | — | `SCR-CONCERN-OVERVIEW` | 고칠 작업이 기존 합의 범위(`src/pages/home/**`, `src/api/**`) 안이므로 14가 같은 합의 아래 재작업 WorkUnit을 연다(11 §3.10.3, `reworkOf` cause `ct`). 이전 WorkUnit의 제출은 대체된다(08 전이 submitted → superseded와 합의 승계 규칙은 08·10에 요구) | `workunit.started`(reworkOf), `toolcall.*`, `result.submitted`, 이전 제출의 `record.superseded` | — |
| 5 | 결과 확인 | `SCR-REVIEW` | 결과 확인 기록 | `acceptance.recorded` | D1 (`correction_cycle`, 정상 경로 밖. 11의 재작업 셈과 같다) |
| 6 | — | — | 이의 기록을 종류("구현 방식 선택")별로 집계. 2단계부터 같은 종류 이의가 반복되면 "이 종류는 다음부터 묻기" 정책 수정 제안이 생긴다(v0.3 06 §4.4) | (집계는 16) | — |

합계: D3(이의 1, 재결정 답 1, 재작업 결과 확인 1, 모두 정상 경로 밖), I1.

#### 대안 흐름

- A1 이유 없이 이의: 이유는 선택 입력이다(판정 J-20). 이유가 없어도 같은 재결정 질문이 생기고, 질문에 원래 고려한 대안과 "무엇이 맞지 않았는지" 묻는 칸이 함께 보인다.
- A2 루프 전환에 이의: "원함 탐구를 너무 일찍 끝냈다"(UC-01 단계 11)에 이의를 걸면 14가 C.commit을 멈추고 I.want로 돌아가는 전환을 낸다. 이미 확정된 합의는 대기 상태가 된다.
- A3 가정 확정에 이의: UC-03의 "Jest 유지"에 이의를 걸면, 그 가정에 기대어 한 작업을 표시하고, 바꾸는 일이 합의 범위 밖(테스트 러너 교체)이므로 합의 개정 선택 요청을 만든다.
- A4 진입 판정에 이의: UC-15 대안 흐름.
- A5 상황 판정에 이의: O로 돌아가 재판정하고 루프 계획을 다시 낸다.
- A6 밖으로 나간 효과가 있는 결정에 이의: 이미 send된 것은 되돌리지 않는다. 그 사실을 이의 기록에 남기고, 보정이 필요하면 새 Concern 열기를 제안한다.
- A7 (2단계) 정책 조정 제안: 같은 종류 이의가 반복되면 관찰 에이전트(또는 커널 집계)가 "이 종류의 결정은 협상으로 묻기" 제안을 만들고 사람이 확인한다(D).

#### 예외 흐름

- E1 이미 대체된 결정에 이의: 커널이 `3009`로 거부한다(08 R-16, 11 §3.10.1). 앱은 현재 유효한 결정을 함께 보이고, 그 결정에 이의를 걸 수 있게 한다.
- E2 원자적 도구 실행 중 이의: 실행이 끝난 뒤 다음 턴 경계에서 반영한다.

#### 수용 기준

- AC-05-01 v0.3 06 §4.2의 종류(정보 게이트를 통과하지 못해 정한 것, 가정 확정, 루프 계획·전환, 상황 판정, 분해·병합, 모드 라우팅)와 진입 판정이 모두 "에이전트가 정한 것"에 나타난다(확인 순서는 코드 계산이라 레코드가 없고 AC-02-02로 확인한다). 혼자 정한 결정(Choice와 루프 계획·상황 판정·모드 등 autonomy를 가진 레코드)에 `whyNotAsked`가 없으면 커널이 `invalid.why_not_asked`로 거부한다.
- AC-05-02 이의는 `objection.filed`와 `concern.reopened`를 같은 트랜잭션에 남긴다.
- AC-05-03 모든 이의는 끝 상태(바뀜 `upheld` / 유지됨 `dismissed`(사람만) / 철회함 `withdrawn`, 05 §3.3.2. 기록만 남기는 이의는 `noted`, 08)에 이른다. 끝 상태 없이 남은 이의 수를 지표로 잴 수 있다(v0.3 09 §5, 목표 0).
- AC-05-04 다음 턴 경계 이후 런타임은 contested 결정에 기대는 새 행동을 하지 않는다.
- AC-05-05 이의 조작과 그에 따른 재결정 답은 16 계산에서 사유(`opReason`)가 `contest`가 된다.
- AC-05-06 복귀 요약에서 에이전트가 정한 것은 기본으로 접혀 있고 종류별 개수가 보인다.

### 3.9 UC-06 복귀 요약

| 항목 | 내용 |
|---|---|
| 목표 | 하루 이상 자리를 비운 뒤 5분 안에 목표, 바뀐 것, 위험, 지금 판단할 것을 원본 로그 없이 파악한다 |
| 단계 | MVP |
| 사전 조건 | `F-base`. 사용자가 30시간 전에 마지막으로 복귀 요약을 확인(cursor). 그 사이 UC-03의 밤 작업이 끝났고, UC-01의 원함 탐구는 "오늘은 여기까지"로 멈춰 있고, UC-02는 결과 확인 대기 |
| 사후 조건 | 사용자가 새 cursor를 확인했고, "지금 선택이 필요함" 항목을 처리하거나 미뤘다 |
| 관련 문서 | 04(복귀 요약 화면), 12(투영 생성, 결정적 부분), 16(H1 측정, 복귀 점검), 09(cursor) |

복귀 요약의 내용 요구(배치와 문구는 04가 정한다). canon-3 §7.3 I4의 기본안을 출발점으로 한다 [제안].

| 순서 | 내용 | 출처 |
|---|---|---|
| 1 | Goal과 바뀐 기준 | canon-3 §6.6.1 Purpose pulse |
| 2 | 돌아온 뒤 달라진 점: 방향(N), 이해(E), 실제(M) 변화를 의미 묶음으로. Concern마다 묶음 5개 이하 | 사용자 확인 cursor 이후, dogfood 002 |
| 3 | 왜 중요한가: 깨진 가정, 약한 신호, 이견, 반대 근거 | SA Level 2 |
| 4 | 지금 선택이 필요함: 권리 게이트 우선, 결과 확인 대기 포함 | v0.3 09 §4.1 |
| 5 | 확인하면 좋은 것: 임시 가정으로 진행 중인 질문과 만료점 | v0.3 06 §6 |
| 6 | 진행 중 작업: 지금 하는 일, 다음 예정, 멈출 조건 | 상용 UX 조사 Active work |
| 7 | 그대로 두면: 다음에 일어날 일과 가까운 만료점 | SA Level 3, friendly 02 |
| 8 | 에이전트가 정한 것(접힘, 종류별 개수) | 결정 8 |
| 9 | 지금 읽지 않아도 됨(접힘): 일상 도구 활동, 끝난 단계 | v0.2 Brief 순서 6 |
| (앞) | 0 미룬 반영 항목, 복구(있을 때만 1절 위) | 04 SC-01·§3.2 |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | 집의 Windows 호스트에서 앱을 엶 | `RGN-TOPBAR`, `SCR-BRIEF`(30시간이 지나 자동으로 열림, 04 §3.2) | 재접속과 재전송. 데몬이 사람의 마지막 확인 cursor 이후 이벤트로 복귀 요약 투영을 만든다. 결정적 부분(개수, 목록, 근거 참조)을 먼저 보내고 모델이 쓰는 요약 문장은 나중에 채운다 | (투영. 정본에 쓰지 않음) | — |
| 2 | 위에서부터 읽음 | `SCR-BRIEF` | 표의 1~9 순서로 보임. 각 항목에 근거 참조(이벤트 범위, 관찰 id) | — | — |
| 3 | "번들 크기 측정 Concern의 전제가 무효화됨" 항목을 펼쳐 근거를 봄 | `SCR-EVIDENCE` | 근거로 내려가기. 원본 이벤트 타임라인까지 내려간 경우 "원본 로그 열람"으로 운영 기록(H1 지표) | 운영 기록 | — |
| 4 | "여기까지 봤음" | `SCR-BRIEF` | 사람의 확인 cursor를 현재 시퀀스로 옮김. 열기만으로는 옮기지 않음 | `brief.acknowledged` | — |
| 5 | 지금 선택이 필요함 항목 처리: UC-03 Q-B 허락(UC-04 흐름), UC-02 결과 확인(UC-07 흐름), UC-01은 "그대로 두기" | `SCR-QUESTION`, `SCR-REVIEW` | 각 유즈케이스 흐름 | 각 유즈케이스 이벤트 | 각 유즈케이스의 D |

#### 대안 흐름

- A1 복귀 점검(G1 기간에 켬): 복귀 요약을 열기 전에 네 질문(지금 Goal, 최근 확인된 선택, 중요한 불확실성, 다음 유효 행동)에 짧게 답한다. 답과 걸린 시간을 실험 관찰로 남기고, 요약을 본 뒤 다시 답하게 한다. 답의 정오는 자동 판정하지 않고 사람이 본다(dogfood 002의 비공개 정답 키 결함을 되풀이하지 않기 위해 정답을 이벤트에 넣지 않는다, canon-2 §10 L9). 기본값은 꺼짐 [제안].
- A2 요약 정정: 사용자가 항목의 "정정"을 누르면(`brief.correct`, 04 §3.2) 정정 피드백을 관찰로 남기고, 원본 기록의 결함인지 투영(요약)의 결함인지 구분해 기록한다(canon-2 §3.18).
- A3 짧은 부재(1시간 미만): 바뀐 것만 짧게 보인다. 바뀐 것이 없으면 "바뀐 것 없음"과 다음 예정만 보인다.
- A4 여러 프로젝트: 홈에서 프로젝트 필터를 쓴다. 기본은 모든 프로젝트를 한 요약에 담고 사람이 필요한 것부터 보인다.
- A5 투영을 다시 만드는 중: "다시 만드는 중"과 기준 cursor를 표시하고, 낡은 요약을 최신처럼 보이지 않는다.

#### 예외 흐름

- E1 모델 요약 문장 생성 실패: 결정적 부분만 보이고 실패를 표시한다.
- E2 바뀐 것이 너무 많음: 묶음을 늘리지 않고 "지금 읽지 않아도 됨"으로 접는다. 반대 근거와 이견은 접지 않는다.

#### 수용 기준

- AC-06-01 확인 cursor는 사람 단위로 하나다(기기마다 따로 두지 않는다). 앱을 여는 것만으로는 바뀌지 않고 `brief.acknowledged`로만 바뀐다. (2단계) 휴대폰 요약판에서 누른 확인은 `compact: true`를 싣고, 휴대폰에서 줄여 본 반대 근거·이견 항목은 다음 데스크톱 요약에 "휴대폰에서 줄여 본 항목"으로 남는다(판정 J-137).
- AC-06-02 이벤트 1,000개 fixture에서 복귀 요약의 결정적 부분이 1초 안에 나온다(01 NFR-P-5).
- AC-06-03 요약의 모든 항목은 근거 참조(이벤트 id 또는 범위)를 가지며 근거 체인으로 내려갈 수 있다.
- AC-06-04 실제 변경은 Concern·WorkUnit·결정의 영향 기준으로 묶이고, Concern당 기본 5묶음 이하다. 묶음마다 원래 항목 수와 근거 경로가 있다.
- AC-06-05 기간 안에 생긴 반대 근거, contested, stale 항목 중 현재 유효한 판단·선택에 영향을 주는 것은 모두 "왜 중요한가"에 나온다(공리 A9). 테스트는 fixture의 해당 항목이 요약에서 빠지지 않았는지 검사한다. 휴대폰 요약판의 확인(`compact: true`) 뒤에도 그 항목은 데스크톱 요약에서 빠지지 않는다(판정 J-137).
- AC-06-06 권리 게이트 질문은 "지금 선택이 필요함"의 맨 위에 나온다.
- AC-06-07 형식은 맞지만 품질 상태가 qualified가 아닌 선택(예: 요지 `ㅇ`)은 현재 기준선으로 보이지 않고 주의 항목으로 보인다. 그런 항목이 있으면 요약은 "확인할 것 없음"을 보이지 않는다(v0.2 CLI-G01, F1).
- AC-06-08 복귀 점검을 켜면 점검 답, 걸린 시간, 원본 로그 열람 횟수가 기록되고, 정답은 이벤트 로그에 들어가지 않는다.
- AC-06-09 다시 만드는 중인 요약은 기준 cursor와 함께 낡음 표시가 붙는다.

### 3.10 UC-07 되돌리기 비싼 선택: 작업 합의(C)와 결과 확인(A)

| 항목 | 내용 |
|---|---|
| 목표 | 이미 정한 방향의 변경을 맡길 때, 무엇을 어디까지 맡겼는지(작업 합의)와 결과를 무엇으로 받아들였는지(결과 확인)를 빠짐없이 남기되 사람의 결정 조작은 2회로 끝낸다 |
| 단계 | MVP |
| 출발 | 진입 E3(사용자가 직접 Concern으로 지정). E1로도 들어올 수 있다(EC-4, EC-5) |
| "되돌리기 비싼"의 뜻 | 사용자의 판단이다. 사용자가 "되돌리기 비싸다"고 말하면 사람 발화 관찰로 남고 직접 지정의 근거가 된다. Helm은 행동의 가역성을 계산하지 않는다(결정 2). 대신 합의 활성 때 되돌릴 지점(시작 커밋 등 실제 참조)을 기록하고, 질문에는 가정 만료점을 쓴다. 권한 레이어가 행동에 위험 표시를 주면 출처와 함께 보인다(01 PR-12) |
| 상황 유형 | 복잡 |
| 루프 계획 | O → C.commit → A.confirm → A.reflect. 방향은 이미 사람이 정했으므로 I를 건너뛰고, 건너뛴 사실과 이유를 루프 계획에 남긴다(v0.3 10 §1 비판 1) |
| 모드 | 실행 |
| 사전 조건 | `F-base`, `F-shop-goal`. `shop`은 Git 저장소이고 작업 트리가 깨끗함 |
| 사후 조건 | 변경이 결과 확인됨(조건부). 반영 항목 4개 중 1개 닫힘, 1개 다른 Concern으로 넘김, 2개(조건 항목, 아키텍처 그림) 명시적으로 미룸. Concern 닫힘(미룬 항목은 다음 복귀 요약 맨 위) |
| 관련 문서 | 10(의존 규칙, 범위 검사, 거부 분류), 11(R-OP-2 범위 포함 증명), 12(마무리 직전 검사), 13(bash 쓰기 범위 검사), 14(C/A 상태 기계), 04(작업 합의 카드, 결과 확인 화면) |

대화 L2304–2316의 "한 턴의 흐름"을 데스크톱·데몬 구조로 옮기고 v0.2 CLI-G01의 박자 4~8을 합쳤다.

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | "상태 관리를 Context에서 Zustand로 옮겨 줘. 되돌리기 비싸니까 Concern으로 열어서 해. 테스트는 다 통과해야 하고 `src/api`는 건드리지 마." 입력 | `RGN-COMPOSER` | 직접 지정 → Concern 열림. "되돌리기 비싸다"는 사람 발화 관찰로 남음 | `observation.recorded`, `concern.opened`(origin `human_designated`, 진입 판정 없음) | I1 |
| 2 | — | `SCR-CONCERN-OVERVIEW` | O: 상황 판정 복잡. 루프 계획 O → C.commit → A.confirm(I 건너뜀, 이유 "방향은 사람이 이미 정함") | `situation.assessed`, `loop_plan.adopted`(건너뛴 루프 I와 이유), `mode.assigned`, `loop.transitioned`(∅ → O), `concern.activated` | — |
| 3 | — | — | 코드 읽기(관찰). 모델이 바로 편집을 시도 → 활성 합의 없음 → 커널이 막고 "작업 합의 먼저"를 모델에 돌려줌 | `observation.recorded` × n, `toolcall.requested`, `toolcall.blocked`(code `denied.agreement_required`) | — |
| 4 | — | `SCR-AGREE` | 모델이 합의 초안 제안: 목적(전역 상태를 Zustand로 이전), 완료 기준(c1 테스트 전부 통과, c2 주요 화면 3개 동작 동일(사람 확인 목록), c3 Context Provider 제거, c4 번들 증가 5KB 이하), 범위(`src/state/**`, `src/components/**`, `src/pages/**` 쓰기, `package.json`에 `zustand` 추가), 금지(`src/api/**` 쓰기, push, 다른 의존성 추가), 제출할 근거(테스트 결과, 번들 분석, 변경 파일 목록), 멈출 조건(API 레이어 변경이 필요할 때, 같은 테스트 3회 연속 실패, 범위 밖 파일 변경 필요), 되돌릴 지점(활성 뒤 첫 쓰기 전 커밋). 의존성 추가는 지시에 없던 범위 → 확정 요청(R-OP-2 대상 아님) | `loop.transitioned`(O → C.commit), `workunit.proposed`, `agreement.proposed`, `question.recorded`(agreement_confirm, rights) | — |
| 5 | 합의 카드에서 c4를 "3KB 이하"로 고쳐 확정 | `SCR-AGREE` | 앱이 구조화된 고침과 함께 `agreement.confirm`(`edits`, 10 `Partial<AgreementContent>`)을 한 번 보낸다(판정 J-124, 01 §3.5.2 셈법 "고쳐서 확정"). 합의 확정, run과 WorkUnit 시작 | `agreement.confirmed`(revision에 고침 반영), `question.answered`, `run.started`, `workunit.started` | D1 (정상 경로 1) |
| 6 | (자리를 비움) | `SCR-CONCERN-OVERVIEW`(지금 하는 일, 다음 예정, 맡긴 범위) | 합의가 활성된 뒤 첫 쓰기 전에 13이 되돌릴 지점(현재 커밋 해시)을 만들고 런타임이 등록한다(13 §3.7.8에 요구). 편집(write/edit), 테스트(execute). 모델이 `src/api/client.ts` 편집을 시도 → 합의의 금지 행동이라 거부됨 → 모델이 API 레이어를 고치지 않는 방법으로 바꿈. bash 실행 뒤 작업 공간 비교로 범위 밖 쓰기가 없는지 확인 | `rollback_point.registered`(`agreementId`, git 커밋 참조), `toolcall.requested`, `toolcall.started`, `toolcall.completed`, `toolcall.blocked`(`policy.forbidden_resource`, 판정 J-92), `observation.recorded` | — |
| 7 | — | — | 모델이 제출 없이 끝내려 함 → 마무리 직전 검사: 합의 아래 파일이 바뀌었는데 제출이 없음 → "결과 제출이 없습니다. 기준별 근거와 함께 제출하세요"로 한 번 더 진행 요청(대화 L2136) | 운영 기록(진행 요청) | — |
| 8 | — | `SCR-HOME` 주의 카드(검토 창에 전달) | 결과 제출: c1 충족(테스트 실행 관찰 id), c3 충족(검색 결과 id), c4 충족 +2.1KB(번들 분석 id), c2는 모델이 "동작 동일 확인함"이라는 문장만 근거로 냄 → 실제 관찰이 아니므로 커널이 "확인 못함"으로 강등. 알려진 한계: E2E 테스트 없음. 반영 항목 후보: (i) README의 상태 관리 절, (ii) 열린 Concern "장바구니 동기화"의 전제("Context 사용") 무효화, (iii) 아키텍처 그림. 결과 확인은 사람의 권리 게이트지만 작업을 막지 않으므로 기록은 즉시, 전달은 다음 작업 경계 또는 검토 창에 한다(판정 J-132) | `result.submitted`(c2 강등 표시), `question.recorded`(result_review), `loop.transitioned`(C.commit → A.confirm) | — |
| 9 | 앱 밖에서 화면 3개를 직접 눌러 봄. 결과 확인 화면에서 기준별 표(✓ / △), 확인 못한 범위, 한계, 반영 항목을 보고 "조건부 확인: c2는 주요 화면 3개만 직접 확인, 장바구니 화면은 다음에". 반영 처리 방침은 기본값 "에이전트가 모두 진행" | `SCR-REVIEW` | 결과 확인 기록(조건 포함). 반영 항목 (i)~(iii)과 조건 항목 (iv)(`acceptance_condition`)을 만든다. (iv)는 같은 트랜잭션에서 미룬 상태가 되고 다시 볼 조건은 조건 문장이다(판정 J-125) | `acceptance.recorded`(conditional, 조건 문장), `question.answered`, `integration.opened`, `obligation.added` × 4, `obligation.deferred`(iv) | D1 (정상 경로 2) |
| 9a | 펼쳐진 전체 반영 단계에서 (iii)을 [미루기] | `SCR-REVIEW` | (iii) 미룸 | `obligation.deferred`(iii) | — (선택 조작, 정상 경로 수에 넣지 않음) |
| 10 | — | `SCR-CONCERN-OVERVIEW` | 반영 WorkUnit: README 갱신, "장바구니 동기화" Concern(열려 있음)의 해당 판단을 낡음으로 표시하고 (ii)를 그 Concern으로 넘긴다. 넘겨받는 Concern이 이미 닫혀 있을 때만 다시 연다(10에 요구). README 항목(`docs_tests`)은 근거 관찰로 커널이 닫는다(10 R-21). 전제 무효화(`broken_premise`)는 사람만 닫는 종류이므로 넘겨받은 Concern에서 사람이 닫는다 | `obligation.resolved`, `obligation.transferred`, `record.staled` | — |
| 11 | — | `SCR-HOME` | 남은 반영 항목이 모두 닫히거나 넘겨지거나 명시적으로 미뤄짐 → 이 Concern을 반영 완료로 닫음(화면 라벨 "반영 완료", 03). 미룬 항목은 다음 복귀 요약 맨 위로 넘김. 돌아보기는 선택(R-OP-5)이므로 닫힘이 돌아보기를 기다리지 않는다. `concern.completed`는 런타임이 낸다(09 B.1·14에 요구) | `integration.completed`, `concern.completed` | — |
| 12 | (선택) 돌아보기 "다음 합의엔 E2E 확인을 완료 기준에 넣기" | `SCR-REVIEW` | 기록. 관찰 에이전트(2단계)가 합의 템플릿을 고칠 재료 | `reflection.recorded` | I1 |

합계: D2(정상 경로), I2.

#### 대안 흐름

- A1 범위 포함이 증명되는 합의: UC-02 단계 11처럼 사람이 직접 고른 선택지(구조화된 범위 `scope`를 가짐)에서 바로 이어지는 합의는 커널이 합의 범위 ⊆ 선택 범위를 검사한 뒤 확정 질문 없이 echo로 활성된다(R-OP-2 (a), 판정 J-133). 이때 정상 경로 결정 조작은 1회(결과 확인)다.
- A2 범위 확대: 단계 6에서 API 레이어를 고쳐야만 한다는 것이 확인되면 멈출 조건에 따라 멈추고 범위 질문(`scope_change`)을 만든다. 행동과 기록: 범위 넓히기 → `workunit.scope_resolved`(expanded) + `agreement.renegotiated`(새 내용 전체) / 범위를 줄여 진행 → `agreement.narrowed` / 그대로(넓히지 않음) → `workunit.scope_resolved`(kept) / 기준 수정 → `workunit.scope_resolved`(renegotiate) 뒤 합의 재협상. 답과 결정 값의 대응표와 `workunit.scope_exceeded`의 구조화된 요청 범위는 10·11이 정한다(§5.2). 사용자가 고르면 D1(`scope_expansion`).
- A3 수정 요청: 단계 9에서 "장바구니 화면 상태 초기화가 빠졌다"로 수정 요청(D1, `correction_cycle`). 합의는 그대로 두고 진행 중으로 돌아간다. 재제출 뒤 결과 확인(D1, `correction_cycle`).
- A4 권리 게이트(v0.2 CLI-A01): 에이전트가 PR을 열려고 push를 원하면 send이므로 권리 게이트 질문(D1, `rights_gate`). 허락 전에는 push가 막힌다.
- A5 결과 거절(해결 안 됨): 결과 확인 화면의 "결과 거절" 행 안에 다시 열 루프 칸이 있다. 직전 I가 있으면 앱이 그 값을 `reopenTo` 기본값으로 채워 보낸다. 이 Concern처럼 I를 건너뛰어(단계 2) 직전 I가 없으면 같은 행 안에서 "새 합의 초안" / "사실 탐구"를 함께 골라 한 번에 보낸다(D1). 커널은 `reopenTo`가 있는지만 검사한다(판정 J-04, J-24, J-123의 `result.accept`(decision rejected, reopenTo)). 합의는 끝나고(`agreement.released`) Concern이 그 루프로 다시 열린다.
- A6 기준이 틀림: "결과는 기준대로인데 상태 관리를 이렇게 바꾼 게 맞나 모르겠다" → 결과 확인에서 "기준이 틀림"(`criteria_wrong`)을 고르고 I.fact 또는 I.want로 돌아간다(D1, `reinquiry`).
- A7 되돌리기 요청: 사용자가 결과를 거절하고 되돌리기를 원하면, 기록된 되돌릴 지점(커밋)으로 돌리는 일이 새 작업 합의로 제안된다(쓰기이므로 의존 규칙 (1)). 되돌릴 수 있는지 판단은 Helm이 하지 않으며 실제 결과를 관찰로 남긴다.
- A8 (2단계) 독립 검증: 결과 확인 전에 검증 에이전트가 새 컨텍스트(가능하면 다른 모델)에서 합의, 완료 기준, 근거 id만 받아 반대 근거를 제안하고 근거를 증언한다. 결과 확인 화면에 함께 보인다. 결과를 만든 행위자는 그 결과를 증언할 수 없다(v0.3 02 §7.1의 P 규칙).
- A9 (2단계) 결과 탐구: 합의 전에 사전 부검을 하고 "2주 안에 상태 관련 버그 0건" 같은 예측에 확인 날짜를 붙인다.
- A10 실행 중 기준 변경: UC-12.
- A11 실행 중 데몬 중단: UC-10.

#### 예외 흐름

- E1 마무리 직전 검사가 반복됨: 진행 요청은 최대 2회 [제안]. 그래도 제출이 없으면 14가 WorkUnit을 멈추고(`workunit.paused`, 사유 `submission_missing`) 사람에게 질문을 남긴다(무한 반복 방지. 08 PauseReason 값과 14·12의 처리 순서를 요구).
- E2 근거 id가 실재하지 않음: 제출은 받고 해당 기준을 "확인 못함"으로 강등한다(감사 보고 §3.6).
- E3 모델이 결과 확인을 만들려 함: 자격 거부. 모델 도구 목록에 결과 확인 계열 도구가 없다.
- E4 bash로 이벤트 로그나 데몬 데이터(`/srv/volumes/helm`)를 고치려 함: 경로 거부. 우회가 일어났다면 해시 체인 검사로 다음 기동 때 감지한다(09, 18).
- E5 bash 실행이 범위 밖 파일을 바꿈: 실행 뒤 작업 공간 비교로 감지해 관찰로 남기고 선택 요청을 만든다. 자동으로 되돌릴지는 13이 정한다.

#### 수용 기준

- AC-07-01 활성 합의가 없을 때 write·send 도구 호출은 `toolcall.blocked`(code `denied.agreement_required`)로 막힌다(의존 규칙 (1)). 도구 호출 밖의 명령 거부는 `command.rejected`로 남는다(09).
- AC-07-02 합의의 금지 행동은 `toolcall.blocked`(`policy.forbidden_resource`, 판정 J-92)로 거부되고, 금지는 아니지만 범위 밖인 쓰기는 `toolcall.blocked`(`gate.scope_expansion_required`) + `workunit.scope_exceeded` + 범위 질문(`scope_change`)으로 기록된다(10 §3.4.4, 09 B.1). bash 실행이 범위 밖 파일을 바꾸면 실행 뒤 비교로 감지되어 관찰과 선택 요청이 생긴다.
- AC-07-03 합의 아래 실제 변경이 있는데 제출 없이 끝내려 하면 진행 요청이 한 번 생기고, 최대 횟수를 넘으면 `workunit.paused`(사유 `submission_missing`)와 질문이 생겨 사람에게 보인다.
- AC-07-04 결과 제출의 각 기준은 충족 / 미충족 / 확인 못함 중 하나와 근거 참조를 가진다. 실제 관찰이 아닌 근거는 해당 기준을 "확인 못함"으로 강등한다.
- AC-07-05 결과 확인은 사람 명령 경로로만 생기고 기기 id를 가진다. 에이전트의 시도는 자격 거부로 기록된다.
- AC-07-06 결과 확인 행동은 결과 확인, 조건부 확인, 수정 요청, 결과 거절(해결 안 됨), 기준이 틀림 다섯 가지다(04 §3.12, 05 §3.4.1. 명령 값과의 대응은 08 §10, 판정 J-35)(08 §3.12 `AcceptanceDecision`의 accepted, conditional, revision_requested, rejected, criteria_wrong에 대응). 조건부 확인은 조건 문장이 없으면 받아들이지 않는다.
- AC-07-07 결과 확인 때 반영 항목이 생긴다: 관련 문서·테스트, 깨진 이전 선택이나 전제, 다른 열린 Concern과의 충돌. 항목이 모두 닫히거나 명시적으로 미뤄지기 전에는 Concern 상태는 "결과 확인됨"에 머물고 "반영 완료"가 되지 않는다(공리 A10).
- AC-07-08 미룬 반영 항목은 다음 복귀 요약의 맨 위에 나온다.
- AC-07-09 기본 흐름의 16 계산 `normalPath=true` 결정 조작은 2건, 대안 흐름 A1은 1건이다. 조건부 확인의 조건 항목은 결과 확인과 같은 트랜잭션에서 미뤄지므로 조작을 더하지 않는다([판정 J-125]).
- AC-07-10 커널이 닫을 수 있는 반영 항목(`docs_tests`·`boundary_check`·`recombine`)은 근거 관찰이 있을 때만 커널이 닫는다. 사람만 닫는 항목(`broken_premise`·`concern_conflict`·`acceptance_condition`·`goal_revision_check`)은 사람이 닫거나(`obligation.resolved`) 면제하거나(`obligation.waived`) 다른 Concern으로 넘기거나(`obligation.transferred`) 미룬다. 조건부 확인의 조건 항목은 결과 확인과 같은 트랜잭션에서 미뤄진다(판정 J-125). 정상 경로의 결정 조작은 늘지 않는다(10 R-21, R-OP-3. 08 §3.12 규칙 6의 목록을 10 R-21에 맞추기를 요구).
- AC-07-11 (v0.2 F6) 테스트 통과 결과가 제출돼도 자동으로 결과 확인이 되지 않고, 반영은 별도로 관찰된다.
- AC-07-12 (v0.2 F2·F3) 모델이나 어댑터가 정본 이벤트를 직접 추가하거나 투영 종류의 명령(`projection.*`)을 내면 경로 거부된다.
- AC-07-13 (v0.2 F4) 사람 명령은 자신이 본 화면의 `basisSeq`를 싣고, 커널은 대상 레코드의 `revisionSeq`와 비교한다(10 §3.3.4. 전역 cursor 일치는 요구하지 않는다). 대상이 그 사이 바뀌었으면 `conflict.version_mismatch`, 이미 처리됐으면 `conflict.already_resolved`, 대체됐으면 `conflict.superseded`로 거부되고 최신 상태를 받는다. 마지막 쓰기가 조용히 이기지 않는다.
- AC-07-14 (v0.2 F1) 완료 기준이 비었거나 의미 없는 글자(예: `ㅇ`)뿐인 합의는 활성되지 않고 주의 항목으로 보인다.
- AC-07-15 합의가 활성된 뒤 첫 쓰기 도구 호출보다 먼저, 그 합의를 가리키는 되돌릴 지점(08 `RollbackPoint`, `agreementId`, 실제 git 참조)이 `rollback_point.registered`로 기록된다(13 §3.7.8에 계기 추가 요구).
- AC-07-16 화면과 이벤트 어디에도 Helm이 계산한 "되돌릴 수 있음" 값이 없다. 위험 표시는 권한 레이어 출처와 함께만 나온다.
- AC-07-17 결과 확인 화면에는 기준별 판정과 함께 남은 전제(활성 가정), 아직 모르는 점, 결과를 무효로 만들 조건(`invalidIf`)이 보인다. 결과 확인 뒤 반영 단계에서 "어떤 가정이 확인되거나 깨졌는가"가 기록된다(canon Integration Review, 04 §3.12에 요구).

### 3.11 UC-08 반복 마찰을 관찰 에이전트가 찾아 제안

| 항목 | 내용 |
|---|---|
| 목표 | 사용자가 한 작업에 몰두한 동안, 별도 관찰 에이전트가 Helm 기록과 허용된 외부 세션 로그에서 반복 패턴을 찾아 스크립트·스킬·정책 수정안을 제안한다. 사람이 채택한 것만 반영된다 |
| 단계 | 2단계(모델 판정과 제안). 결정적 수집·탐지·외부 세션 지표는 MVP에서 켠다(01 §3.8.2) |
| 출처 | 사용자 아이디어(대화 L246), 사용자 동의(L298), 결정 35 |
| 루프 | A.reflect의 일부. 채택된 제안은 새 Concern(UC-07 흐름) 또는 정책 변경이 된다 |
| 사전 조건 | `F-base`. 관찰 에이전트 활성(G1 통과). 허용 폴더: `~/projects/shop/` 아래 pi·Claude Code 세션 로그(위치는 16이 정함). 지난 2주 동안 사용자가 pi와 Helm에서 `pnpm i && pnpm -r build && pnpm test`를 12번(세션 5개) 직접 다시 실행함 |
| 사후 조건 | 제안 1건 채택 → "반복 마찰: 검증 명령 반복" Concern이 열리고 결과 확인됨. 제안 1건 기각 → 같은 서명의 제안은 16의 재제출 규칙대로만 다시 올라옴 |
| 관련 문서 | 16(관찰 에이전트 전체), 18(로그는 신뢰하지 않는 데이터, 비밀 마스킹), 12(스케줄러), 04(관찰 제안함) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | — | 스케줄러가 정해진 조건(매일 18:00, 세션 파일이 마지막으로 바뀐 지 10분, 세션 종료)에 관찰 에이전트 실행을 시작. 시작 여부는 코드가 정한다(대화 L301–310) | 운영 기록 | — |
| 2 | — | — | 관찰 에이전트(별도 프로세스, 쓰기 권한 없음)가 Helm 이벤트 로그를 읽기 전용으로, 허용 폴더의 외부 세션 로그를 지난번 오프셋부터 읽는다. 자기 세션은 뺀다. 공통 형식(사용자 메시지, 도구 호출, 결과, 토큰, 정정)으로 정규화하고 비밀을 가린다 | — | — |
| 3 | — | — | 결정적 마이닝(LLM 없음): 반복 도구 호출 순서, 같은 bash 명령 조합, 같은 파일 반복 읽기, 실패 → 재시도 반복, 사용자 정정("아니 그거 말고"), Helm 쪽 신호(종류별 이의, 반복 범위 확대, 같은 종류 질문) | — | — |
| 4 | — | — | 후보 묶음만 더 싼 모델에 넣어 분류: 스킬 / 스크립트(CLI·just 레시피) / 훅(강제 규칙) / 정책 수정(묻기·합의 템플릿) / 우연. 출력은 고정 스키마, 수치는 마이닝 결과 그대로 | — | — |
| 5 | — | — | 제안 기록: "검증 명령 세 개를 12번(세션 5개) 반복 → `just check` 레시피로 묶기(스크립트)", 근거(세션 id, 빈도, 추정 절감 시간), 초안. 이전에 기각된 서명과 같으면 기록하지 않는다 | `policy_proposal.submitted` | — |
| 6 | — | `SCR-BRIEF`, `SCR-OBSERVER` | 전달은 예약: 다음 복귀 요약의 "관찰 에이전트" 절에 "관찰 제안 2건"과 관찰 제안함 링크. Concern의 대화나 세션에는 넣지 않는다(대화 L319, 16) | — | — |
| 7 | 제안을 읽고 채택 | `SCR-OBSERVER` | 채택 기록. 스크립트 제안은 적용 Concern을 연다: 제안의 구조화된 범위(대상: `justfile`, 쓰기만, send 없음)로 Concern "반복 마찰: 검증 명령 반복"을 열고 합의 초안을 만든다(정책·다이얼 제안이면 채택 즉시 커널이 적용하고 별도 질문을 만들지 않는다, 16). 사람이 채택한 구조화된 범위 안이므로 R-OP-2(a)로 echo 활성 | `policy_proposal.accepted`, `policy_proposal.application_opened`, `concern.opened`, `agreement.activated_by_grant`(채택한 제안의 범위를 사람이 정한 범위로 봄) | D1 |
| 8 | — | — | UC-07 흐름으로 레시피 추가, 실행 확인, 결과 제출 | UC-07 이벤트 | — |
| 9 | 결과 확인 | `SCR-REVIEW` | 결과 확인 | `acceptance.recorded` | D1 |
| 10 | 두 번째 제안("Claude Code 세션에서 같은 파일을 반복해서 읽음 → 스킬로")을 이유와 함께 기각 | `SCR-OBSERVER` | 기각 기록(사유 선택, 선택으로 "다시 보지 않기"), 패턴 서명 저장 | `policy_proposal.dismissed` | D1 |
| 11 | — | — | 채택 뒤 7·14·28일에 같은 패턴을 다시 마이닝해 효과를 잰다. 빈도가 줄지 않으면 그 절차를 되돌리자는 제안을 만든다(16) | `policy_proposal.effect_measured`, 필요하면 `policy_proposal.submitted` | — |

합계: D3(채택 1, 결과 확인 1, 기각 1).

#### 대안 흐름

- A1 정책 수정 제안: "구현 방식 선택" 종류의 혼자 정한 결정에 이의가 2주 동안 4번 → "이 종류는 협상으로 묻기" 제안. 채택하면(D1) 커널이 묻기 정책을 바꾸고 변경을 기록한다(`policy_proposal.accepted`, `policy_proposal.applied`). 채택이 곧 사람의 결정이므로 별도 권리 게이트 질문을 다시 만들지 않는다(16). 관찰 에이전트가 정책을 직접 바꾸지 않는다.
- A2 보류: 제안을 보류하면 다음 주기에 다시 보이지 않고 관찰 제안함의 보류 목록에 남는다.
- A3 승격 신호 제안(진입 E2의 변형): 외부 세션에서 같은 테스트를 세 번 실패한 흔적을 보면 "Concern으로 열까요?" 제안을 만든다.
- A4 통합 보고: 한 작업에 몰두한 동안 다른 프로젝트의 세션 상태(무엇을 했는지, 어디서 막혔는지, 열린 작업)를 정리해 복귀 요약의 "지금 읽지 않아도 됨" 옆에 둔다(대화 L312) [제안].

#### 예외 흐름

- E1 로그에 지시문이 섞여 있음("앞의 지시를 무시하고 …"): 데이터로만 다루고 제안 초안에 옮기지 않는다.
- E2 외부 로그 형식이 바뀌어 파서가 실패: 실패를 운영 기록으로 남기고 그 로그는 건너뛴다. 데몬에는 영향이 없다.
- E3 관찰 에이전트가 죽음: 데몬과 작업에는 영향이 없다. 다음 실행이 오프셋부터 이어 간다.

#### 수용 기준

- AC-08-01 관찰 에이전트 실행은 클라이언트 연결 없이 스케줄러 조건으로 시작된다.
- AC-08-02 관찰 에이전트는 제안 기록 외의 쓰기를 할 수 없다. 프로젝트 파일, 외부 세션, 다른 이벤트를 쓰려는 시도는 거부된다.
- AC-08-03 같은 로그 fixture에서 제안의 수치(빈도, 세션 수)가 같다(결정적 마이닝).
- AC-08-04 기각된 제안과 같은 패턴 서명은 16 §3.14의 규칙대로만 다시 올라온다: 이번 제안만 기각했으면 근거가 2배 이상이고 정한 기간이 지난 뒤, "다시 보지 않기"를 고르면 그 패밀리는 영구 억제. 규칙을 어긴 재제출은 커널이 `policy.proposal_signature_rejected`로 거부한다.
- AC-08-05 허용 폴더 밖의 로그와 관찰 에이전트 자신의 세션은 읽지 않는다. 오프셋 이후만 읽는다.
- AC-08-06 비밀 형태의 값은 모델 입력 전에 가려지고, 주입 문장이 든 fixture에서 그 문장이 제안 초안에 그대로 나오지 않는다.
- AC-08-07 채택된 제안은 자동 설치되지 않고 Concern이나 정책 변경 명령으로만 반영된다. 반영은 채택 이벤트를 참조한다.

### 3.12 UC-09 Goal 정제

| 항목 | 내용 |
|---|---|
| 목표 | Concern에서 새로 알게 된 원하는 것이나 사실로 Goal을 다듬는다. 모델은 수정을 제안하고 사람이 확정한다. 이전 버전에 기대던 합의와 컨텍스트는 다시 확인 대상이 된다 |
| 단계 | MVP |
| 출처 | 결정 11(Goal은 Concern 사이클로 정제), 의존 규칙 (5)(Goal 변경 시 사람 확인, [제안]), v0.3 02 §3.3 |
| 사전 조건 | UC-01이 끝남. Goal `blog` v1 "개인 블로그를 꾸준히 운영한다"에 선호 모델 PM-1이 연결됨. 두 번째 글 Concern에서 원함 탐구 중. 사용자가 "이 블로그는 사실 Helm 만드는 기록용이야"라고 말했고, 반응이 개발자 대상 글에 일관되게 좋음 |
| 사후 조건 | Goal v2 확정. 이전 버전 보존. 영향받는 합의 1건이 echo로 갱신됨 |
| 관련 문서 | 08(Goal 버전), 10(의존 규칙 5), 11(권리 게이트: Goal 변경), 04(Goal 이력) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | — | 에이전트가 Goal 수정 제안: v2 "에이전트 도구를 만드는 과정을 개발자 동료와 나누는 글을 꾸준히 쓴다". 근거(사용자 발화 관찰, 반응 관찰, PM-1 기준), v1과의 차이, 바뀌는 성공 조건, 지켜야 할 것 | `goal.revision_proposed` | — |
| 2 | — | `SCR-HOME` 주의 카드 | Goal 변경은 사람이 정할 권리(v0.3 06 §3.2) → 권리 게이트 질문. 작업을 막지 않으므로 기록은 즉시, 전달은 다음 작업 경계 또는 검토 창에 한다. 가정 확정은 하지 않는다(판정 J-132) | `question.recorded`(gate `rights`, kind `goal_revision`), `question.delivered` | — |
| 3 | Goal 수정 카드에서 v1·v2 차이, 근거와 반대 근거(접지 않음), 다시 확인할 대상(진행 중인 "두 번째 글" 합의, PM-1의 적용 범위)을 봄. "개발자 동료"를 "에이전트를 쓰는 개발자"로 고쳐 확정 | `SCR-GOAL` | Goal v2 생성(v1 보존). 이전 버전을 참조하던 합의와 컨텍스트에 "다시 확인" 표시 | `question.answered`, `goal.revised`(v2, 원인: 제안과 근거) | D1 (`goal_change`) |
| 4 | — | `SCR-CONCERN-OVERVIEW` | 런타임이 다음 턴 경계에서 컨텍스트 투영을 v2로 다시 만든다. "두 번째 글" 합의는 범위와 완료 기준이 그대로이므로 바꾸지 않고 유지한다. 목적 문구까지 고쳐야 하면 사람의 합의 재협상(`agreement.renegotiated`)이 필요하므로 그때만 묻는다 [제안]. "다시 확인" 표시는 컨텍스트가 v2로 다시 투영되면 커널이 지우고, 합의는 사람이 유지를 확인하거나 재협상하면 지운다 | `run.context_projected` | — |
| 5 | Goal 이력을 엶 | `SCR-GOAL` | 버전별 변경, 계기(어느 Concern의 어느 관찰), 다시 확인 대상과 처리 상태(대상별 상태와 남은 수, 04 GoalView에 요구) | — | — |

합계: D1.

#### 대안 흐름

- A1 거절: 사용자가 거절하면(D1, `goal_change`) 이유와 함께 기록한다. 같은 차이의 제안은 새 근거가 없으면 다시 하지 않는다.
- A2 나중에: 권리 게이트이므로 가정 확정되지 않는다. 사용자가 답할 때까지 v1이 유효하고, 제안은 복귀 요약의 "지금 선택이 필요함"에 남는다.
- A3 작은 문구 다듬기: 뜻이 같은 문구 수정이 여럿 생기면 작업 경계에 모아 한 질문으로 묻는다. v0.3 03 §5는 의존 규칙 (5)가 작은 정제에 너무 엄격할 수 있다고 적었다. MVP는 모든 변경에 사람 확인을 받고, G1에서 빈도를 보고 다시 정한다 [제안].
- A4 사람이 직접 고침: 사용자가 Goal을 직접 고치면 사람이 먼저 시작한 입력(I)이고 바로 새 버전이 된다.
- A5 합의 범위에 영향: Goal 변경으로 진행 중 합의의 범위나 완료 기준이 넓어져야 하면 echo로 처리하지 않고 합의 확정 질문을 만든다(D1, `scope_expansion`).
- A6 (3단계) Goal 나누기: 하위 Goal로 나누는 것은 구조 루프의 일이다(UC-19).

#### 수용 기준

- AC-09-01 에이전트는 Goal을 직접 바꿀 수 없다. `goal.revised`는 사람 명령 경로에서만 생긴다.
- AC-09-02 Goal 수정 제안은 근거(관찰 id 또는 Concern id)와 이전 버전과의 차이를 가져야 받아들여진다.
- AC-09-03 수정 확정 뒤 이전 버전은 남고, 새 버전은 원인 이벤트를 가리키며, 이전 버전을 참조하던 합의·컨텍스트 목록이 "다시 확인"으로 표시된다. 표시는 단계 4의 조건(컨텍스트 재투영, 합의의 사람 확인·재협상)에서만 지워진다. Goal 수정 카드는 반대 근거를 접지 않는다.
- AC-09-04 범위가 넓어지지 않는 합의 갱신은 echo로 처리되고 결정 조작을 더하지 않는다.
- AC-09-05 거절된 제안과 같은 차이의 제안은 새 근거 없이 다시 기록되지 않는다.
- AC-09-06 Goal 수정 질문은 만료·가정 확정 상태로 가지 않는다(권리 게이트).

### 3.13 UC-10 데몬 재시작·연결 끊김 중 작업

| 항목 | 내용 |
|---|---|
| 목표 | 클라이언트 연결이 끊기거나, 데몬이 비정상 종료되거나, 서버가 재부팅돼도 확인된 기록을 잃지 않고, 중단된 작업을 정리해 다시 진행하며, 사용자에게 무엇이 중단·재개됐는지 보인다 |
| 단계 | MVP |
| 출처 | 결정 22, 29, 30, 31. v0.2 runtime-effects-context-001(불확실 외부 결과), canon-2 §10 L12·L13 |
| 사전 조건 | UC-07 단계 6(변경 WorkUnit 실행 중) |
| 관련 문서 | 12(크래시 복구, 스케줄러), 13(도구의 재실행 안전성 선언), 17(systemd, keepalive, 백업·복원), 09(WAL, 해시 체인), 19(재전송, 멱등), 20(오프라인 표시, 오프라인 초안) |

이 유즈케이스는 변형마다 짧은 흐름으로 적는다.

#### 변형 A: 클라이언트 연결 끊김

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | (Mac Wi-Fi가 끊김) | `RGN-TOPBAR`("연결 안 됨", 기준 시각) | 데몬은 아무 영향 없이 작업을 계속한다 | 작업 이벤트 계속 | — |
| 2 | 오프라인 상태에서 자극에 반응 2건, 질문 답 1건을 쓰려 함 | `SCR-STIM`, `SCR-QUESTION`(오프라인 초안) | — (보내지 않고 기기에 초안으로 보존, J-02) | — | — |
| 3 | 다시 연결된 뒤 초안을 최신 상태와 비교하고 보냄 | `RGN-TOPBAR`, `SCR-STIM`, `SCR-QUESTION` | 앱이 저장한 위치 `{storeId, seq}` 다음부터 재전송받는다. 초안은 자동으로 보내지 않는다. 사용자가 보낸 명령을 커널이 순서대로 처리 | 해당 이벤트 | I2, D1 |

#### 변형 B1: 데몬 비정상 종료

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | — | 도구 실행이 시작된 뒤 데몬 프로세스가 죽음 | `toolcall.requested`, `toolcall.started`(결과 없음) | — |
| 2 | — | `RGN-TOPBAR`(다시 연결하는 중) | systemd가 다시 시작한다(17 `RestartSec=5s`). 로그를 열고 해시 체인을 검사 | `daemon.booted` | — |
| 3 | — | — | 복구: 의도만 있고 결과가 없는 도구 호출을 "중단됨"으로 정리. 재실행 안전으로 선언된 도구(읽기 등)만 다시 실행. 로컬 쓰기 도구는 실제 파일 상태를 관찰로 남기고 다시 실행하지 않음. 실행 중이던 루프는 마지막 체크포인트에서 컨텍스트를 다시 만들어 재개. 대기 중이던 질문과 타이머를 다시 건다 | `toolcall.interrupted`, `run.interrupted`, `observation.recorded`(실제 상태), `run.started`(attempt 2) | — |
| 4 | 앱이 다시 연결됨 | `RGN-TOPBAR`, `SCR-BRIEF`(복구 절) | "중단됨 1건, 자동 재개 1건". 판단이 필요한 항목이 없으므로 복구 화면과 복구 내비게이션 항목은 보이지 않는다(04 §3.20, 03 §3.5.2) | — | — |

#### 변형 B2: 서버(Windows 호스트) 재부팅

Windows Update로 03:00에 재부팅되고, 로그온 뒤 WSL keepalive와 systemd로 데몬이 다시 뜬다(브리프 §2.5, backend-oss §5.2). B1의 복구를 한 뒤, 중단 동안 지난 가정 만료점·기한을 처리한다. 처리 이벤트에는 원래 시각과 실제 처리 시각이 함께 남는다. 복귀 요약에 "서버가 07:10에 다시 시작되었습니다."(`notice.daemon.restarted`)와 중단 기간 03:00~07:10이 보인다(화면 문구는 "데몬" 대신 "서버", 04 §3.0.4). 로그인 전 자동 시작은 보장하지 않는다(01 NFR-A-3).

#### 변형 B3: 결과가 불확실한 외부 행동

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | — | 사람이 허락한 push(UC-03 Q-B) 실행 중 데몬이 죽음 | `toolcall.started`(send) | — |
| 2 | — | — | 재시작 뒤 이 호출은 재실행 안전이 아니므로 다시 실행하지 않는다. 결과 불확실로 정리하고, 외부 효과가 있는 호출이므로 복구 질문(권리 게이트, 판정 J-05·J-44)을 바로 만든다. 이어서 12의 확인 조회 절차(13이 도구에 선언한 확인 조회를 읽기 전용 하위 실행으로 돌림)가 원격 브랜치 상태를 읽는다(12 §3.7.4에 요구) | `toolcall.outcome_uncertain`(recoveryCheck, externalRef), `question.recorded`(recovery, rights), 확인 조회의 `toolcall.*`(read) | — |
| 3a | — | `SCR-BRIEF`(복구 절) | 원격에 커밋이 있음 → 확인 조회 결과를 근거로 "보냄"으로 정리하고, 질문은 철회한다 | `observation.recorded`, `toolcall.recovered`(근거 관찰), `question.withdrawn` | — |
| 3b | 확인 조회로 판단할 수 없으면 질문이 남는다. 복구 화면에서 [push됐는지 확인하는 작업 만들기] / [push된 것으로 기록] / [push되지 않은 것으로 기록] / [그대로 두기] 중 고름. 선택지 집합의 정본은 12이고 04·19·이 문서가 따른다 | `SCR-RECOVERY` | 사람의 답을 근거 관찰(발화)로 남기고 대상 호출(`toolCallId`)을 정리(19 `recovery.resolve` → 10 `toolcall.recover`) | `question.answered`, `observation.recorded`(utterance), `toolcall.recovered` | D1 (`rights_gate`) |

#### 변형 B4: 모델 공급자 장애

모델 호출이 실패하면 12가 정한 재시도를 하고, 계속 실패하면 run은 `failed`(`model_unreachable`)로 끝난다. 도메인 관찰은 만들지 않고 trace와 17의 상태 확인에 남으며, 앱은 그 상태를 연결·상태 화면에서 보인다. 질문은 만들지 않는다. 사람 명령(질문 답, 결과 확인, 이의)은 계속 받는다. 공급자가 회복되면 14가 같은 일을 다시 요청한다(판정 J-109, 01 NFR-O-3. 회복 신호 입력은 12·14에 요구).

#### 변형 B5: 기록 검사 실패

기동 때 해시 체인 검사가 실패하면 데몬은 읽기 전용 상태(17 `read_only`, 19 `readOnly`)로 뜬다(판정 J-67). 새 이벤트를 쓰지 않고, 앱의 위쪽 상태 막대에 "읽기 전용", 배너에 사유별 문장(예: "서버가 기록을 점검하는 중이라 읽기만 할 수 있습니다. 점검 결과: …", `err.daemon.readOnly`, 05 §3.11)을 보인다(판정 J-115). 복원은 관리 CLI로 백업에서 한다(17).

#### 수용 기준

- AC-10-01 장애 주입(각 단계에서 데몬 강제 종료)에서 수락 응답을 받은 명령과 그 이벤트는 재시작 뒤에도 모두 있다(01 NFR-D-1).
- AC-10-02 재시작 뒤 의도만 있고 결과가 없는 도구 호출은 모두 `toolcall.interrupted` 또는 `toolcall.outcome_uncertain`으로 정리된다. 정리되지 않고 남는 호출이 없다.
- AC-10-03 재실행 안전으로 선언된 도구만 자동으로 다시 실행된다.
- AC-10-04 결과가 불확실한 외부 행동은 다시 실행되지 않는다. 확인 조회나 사람의 답으로 "보냄 / 보내지 않음"이 기록된 뒤에만 그 흐름이 진행된다.
- AC-10-05 중단 동안 지난 타이머는 재시작 뒤 처리되고, 원래 예정 시각과 실제 처리 시각이 함께 기록된다.
- AC-10-06 재연결 뒤 앱은 빠진 이벤트를 순서대로 한 번씩 받는다. 오프라인 초안은 자동으로 보내지지 않고, 응답 전에 끊긴 명령만 같은 멱등 키로 다시 보내져 한 번만 적용된다(J-02).
- AC-10-07 재시작부터 복구 완료까지 30초 이내이고(01 NFR-A-1), 복구 요약은 복귀 요약 복구 절에 보이고, 사람 판단이 필요한 항목만 복구 화면에 나온다.
- AC-10-08 모델 공급자가 응답하지 않는 동안에도 사람 명령은 01 NFR-P-1 안에서 처리된다. run은 `model_unreachable`로 끝나고 "모델 연결 끊김" 같은 도메인 관찰이나 질문은 생기지 않는다(판정 J-109).
- AC-10-09 기록 검사가 실패하면 새 이벤트가 하나도 추가되지 않는다.

### 3.14 UC-11 처음 설치·기기 페어링

| 항목 | 내용 |
|---|---|
| 목표 | 서버에 데몬을 설치하고, Mac과 Windows의 앱을 페어링하고, 첫 프로젝트와 첫 Goal을 등록한다 |
| 단계 | MVP |
| 사전 조건 | 서버: WSL2 Ubuntu 24.04, systemd, Node.js 24(결정 44), Helm 저장소 checkout, SOPS 비밀 체계(브리프 §2.5). Mac에 Tailscale 로그인 |
| 사후 조건 | 데몬 상주, 기기 2대 페어링, 허용 폴더 1개, Goal 1개 확정 |
| 관련 문서 | 17(설치 레시피, systemd, keepalive, 저장 위치), 18(페어링, 토큰, 허용 폴더), 20(키체인, 서명 없는 앱 실행), 06·23(justfile 레시피) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | 서버에서 설치 레시피 실행(예: `just setup`, `just daemon-install`. 이름은 06·23) | 터미널 | `/srv/volumes/helm` 생성, systemd 유닛 설치·활성화, 데몬은 127.0.0.1:7840(`tailnet`), 127.0.0.1:7841(`loopback`), Unix 소켓(`local`)에만 연다. 필요한 비밀 키 이름을 확인하고 없으면 이름만 알림(값은 출력하지 않음) | `daemon.booted` | I1 |
| 2 | 없는 비밀이 있으면 `secrets edit prod`로 값을 넣음(상주 데몬은 prod 범위를 읽는다, 17 §3.8). 첫 설치 뒤 값을 바꾸면 `helm ops reload-secrets`로 다시 읽는다 | 터미널 | — | — | I1 |
| 3 | 홈랩 `serve.table`에 `8448 http://127.0.0.1:7840 helm` 한 줄을 더하고 `just serve-apply`로 반영한다(관리자 권한 불필요). 읽기 전용 확인 스크립트로 Windows 쪽 상태를 확인한다(17 §3.7, 홈랩 규칙, 브리프 §2.5). 설치 점검표는 17이 둔다 | 터미널 | — | — | I1 |
| 4 | Mac에 앱을 설치하고 처음 실행(서명·공증 없음. 첫 실행 허용 절차는 20) | `SCR-ONBOARD` | — | — | — |
| 5 | 접속 방식(Tailscale 또는 SSH)과 서버 주소를 입력 | `SCR-ONBOARD` | — | — | I1 |
| 6 | 서버에서 페어링 코드 발급 명령 실행(예: `helm pair --name MacBook`), 코드를 앱에 입력 | 터미널, `SCR-ONBOARD` | 1회용 코드(유효 10분) 확인, Tailscale 신원 확인, 기기 토큰 발급. 앱은 토큰을 OS 키체인에 저장(세부 절차는 18·19) | `pairing.code_created`, `pairing.code_consumed`, `device.paired`(dv_mac) | I2 |
| 7 | — | `SCR-CONNECT` | 연결 성공. 연결 경로, 데몬 상태, 기기 목록 표시 | — | — |
| 8 | 처음 연결의 폴더 추가 단계에서 서버의 `~/projects/shop/code/shop`을 허용 폴더로 지정(이후 추가는 `SCR-SETTINGS` 권한·연결 절). 연결된 모델 공급자 상태(시험 호출 결과)도 본다 | `SCR-ONBOARD`(폴더 추가 단계) | 허용 폴더 등록(쓰기 범위의 바깥 경계)과 프로젝트 생성. 등록 절차의 보안 요구는 18 | `setting.changed`(판정 J-94), 프로젝트 생성 이벤트(09) | I1 |
| 9 | — | `SCR-GOAL`(Goal 초안 카드) | 에이전트가 `PRODUCT.md`, README, 저장소 상태를 읽어 Goal 초안을 만든다(빈 칸 폼 없음, PR-01). Goal은 `proposed` 상태로 보이고 카드에 [이 Goal로 시작] [고쳐서 시작] [나중에]가 있다 | `observation.recorded`, `goal.proposed` | — |
| 10 | [고쳐서 시작]으로 초안을 고쳐 확정 | `SCR-GOAL` | Goal v1 활성 | `goal.activated` | D1 |
| 11 | Windows 호스트 앱도 같은 방식으로 페어링 | `SCR-ONBOARD` | `device.paired`(dv_win) | `device.paired` | I3 |

#### 대안 흐름

- A1 SSH 경로로 페어링: 단계 5에서 SSH를 고르면 앱이 `ssh <서버> helm device issue --name <이름> …`을 실행해 기기 토큰을 받는다(관리 CLI가 `local` 리스너에서 `admin.issueDevice` 호출, 18 흐름 B). 페어링 코드는 쓰지 않고, 이후 SSH 경로도 기기 토큰으로 인증한다(19 P-03).
- A2 기기 분실·폐기: 다른 기기의 권한·연결 화면 또는 서버의 관리 CLI(예: `helm device revoke dv_mac`)로 폐기한다. 폐기된 기기의 연결은 즉시 끊기고, 이후 연결은 거부된다.
- A3 Goal 없이 시작: 단계 10에서 [나중에]를 고르면 프로젝트는 자리표시 Goal("이름 없는 Goal", 03 IA-03)로 시작하고, 첫 Concern에서 Goal 초안을 다시 제안한다(01 FX-13). 자리표시 Goal 아래에서도 작업은 진행되며, 08 E-02의 거부 규칙과 이름은 FX-13에 맞춘다(08에 요구).
- A4 사용자가 먼저 Goal을 말함: 단계 9 전에 입력창에 Goal을 말하면 그 문장을 출발점으로 같은 초안 카드가 나온다. 입력 범위 이름과 경로는 04 §3.16이 하나로 정한다.
- A5 (2단계) 휴대폰 페어링: 데스크톱 `SCR-CONNECT`에서 새 기기 페어링 → 휴대폰을 고르면 QR과 코드가 보인다. 휴대폰에서 Tailscale을 켜고 QR을 읽어 Safari로 연 뒤 홈 화면에 추가하고, 홈 화면의 Helm에서 코드를 넣어 연결한 다음 [알림 켜기] [시험 알림 보내기]를 한다(26 §3.6.3, §3.3.4). 사전에 서버의 `secrets edit prod`에 VAPID 개인 키를 넣어 둔다. 기기 토큰은 쿠키로 나른다(26 §3.3.3).

#### 예외 흐름

- E1 코드가 틀리거나 만료됨: 거부하고 "코드가 틀렸거나 만료됐습니다"를 보인다. 사유를 구분하지 않는다(판정 J-81, 문구 키는 05). 시도 상한을 넘으면 코드를 무효로 한다.
- E2 `tailscale serve`가 설정되지 않음: 앱이 연결하지 못하고 04 §3.19의 연결 점검 단계 문구(05 `err.connection.*`)와 SSH 경로 안내를 보인다.
- E3 모델 키 없음: 데몬은 뜨지만 실행을 시작하지 않고, 앱과 관리 CLI가 없는 키 이름을 보인다.

#### 수용 기준

- AC-11-01 설치 레시피를 두 번 실행해도 기존 데이터가 지워지지 않는다(멱등).
- AC-11-02 데몬은 TCP 127.0.0.1:7840(`tailnet`, serve 대상), 127.0.0.1:7841(`loopback`, SSH 경로), Unix 소켓 `/run/user/<uid>/helm/rpc.sock`(`local`, 0600)에서만 듣는다. 다른 주소에서 듣지 않음을 시험한다(19 §3.2.1, 18).
- AC-11-03 페어링 코드는 1회용이고 유효 시간이 지나면 거부되며(`pairing.code_expired`) 시도 횟수에 상한이 있다(`pairing.code_failed`).
- AC-11-04 기기 토큰은 OS 키체인에만 저장되고 파일, 로그, 이벤트에 나오지 않는다.
- AC-11-05 폐기된 기기의 열린 연결은 즉시 끊기고 이후 인증이 거부된다.
- AC-11-06 비밀이 없을 때 보이는 것은 키 이름뿐이고 값은 어디에도 출력되지 않는다.
- AC-11-07 런타임 데이터는 `~/projects` 밖(`/srv/volumes/helm`)에 있다.
- AC-11-08 첫 Goal은 모델 초안에서 시작하고 사람이 확정한다. 사람이 빈 칸을 처음부터 채우는 폼이 없다.

### 3.15 UC-12 실행 중 방향·기준 바꾸기

| 항목 | 내용 |
|---|---|
| 목표 | 에이전트가 일하는 중에 완료 기준, 범위, 우선순위, 다이얼을 바꾸면 다음 턴 경계부터 반영되고, 옛 기준으로 한 일은 낡음으로 표시되며, 불필요한 질문이 생기지 않는다 |
| 단계 | MVP |
| 출처 | v0.2 CLI-G02, CLI-G01 실패 주입 F5, canon-2 §3.11(steering), 상용 UX 조사 P3(실행 중 재정의 lineage), OPD+C의 Directability |
| 사전 조건 | UC-07 단계 6 이후 실행 중(합의 revision 1, c4 "번들 증가 3KB 이하"). 번들 측정 관찰 +2.1KB가 이미 있음 |
| 관련 문서 | 12(턴 경계 반영, 원자적 도구), 10(합의 개정), 14(다이얼 층), 04(작업 합의 카드, 다이얼 패널) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | Concern 개요에서 지금 하는 일을 봄 | `SCR-CONCERN-OVERVIEW` | — | — | — |
| 2 | 진행 작업 카드의 [기준 바꾸기]로 c4를 "1KB 이하"로 바꾸고 c2에 "장바구니 화면도 확인"을 더함(또는 입력창에 말하고 의미 미리보기에서 [그렇게 기록]. [그렇게 기록]은 사람 채널 명령 `agreement.renegotiate`를 보낸다. 12의 "초안 화면으로 안내만" 문장은 이 경우에 맞게 고치기를 요구) | `SCR-WORK`(또는 `RGN-COMPOSER`) | 사람이 먼저 시작한 재협상이므로 확정 질문 없이 합의 revision 2로 기록. 옛 기준으로 확인한 결과(번들 +2.1KB 확인)는 낡음으로 표시. 옛 합의로 만든 컨텍스트를 무효화 | `run.steered`, `agreement.renegotiated`(rev 2, 사람), `record.staled`(agreement_renegotiated) | I1 |
| 3 | — | `SCR-CONCERN-OVERVIEW` | 원자적 도구 실행 중이면 끝난 뒤, 아니면 다음 턴 경계에서 새 합의로 컨텍스트를 다시 만든다. 에이전트가 echo: "c4가 1KB 이하로 바뀌었습니다. 지금 +2.1KB라 줄이는 작업을 더합니다." 범위가 넓어지지 않으므로 질문하지 않음 | `directive.applied` | — |
| 4 | 다이얼 패널에서 질문 빈도를 "적게"로 바꿈 | `SCR-DIALS` | 현재 Concern 층의 값으로 기록(v0.3 07 §6의 5층). 다음 턴 경계부터 적용 | `dial.set` | I1 |

#### 대안 흐름

- A1 새 기준이 범위 밖 행동을 요구: c4를 맞추려면 의존성을 바꿔야 하면 멈출 조건에 따라 선택 요청(D1, `scope_expansion`).
- A2 안전하게 멈추기: 하던 도구 실행이 끝나는 지점에서 멈춘다. 멈춘 상태와 이미 일어난 효과를 보인다(`workunit.paused`, 문구는 05 §3.6.1).
- A3 작업 중단: 실행을 취소하고 이미 일어난 효과와 되돌릴 필요가 있는지 보고한다. 결과는 제출되지 않으며 합의는 유지된다.
- A4 즉시 끊기: 작업 중단 확인 창 안에서 고르거나 관리 CLI로 한다. 프로세스를 바로 끊고, 하던 도구 실행의 결과를 알 수 없게 될 수 있으며 작업은 복구 선택이 필요한 상태가 된다(판정 J-115). UC-10 B1과 같은 정리를 한다. 세 가지(안전하게 멈추기, 작업 중단, 즉시 끊기)의 차이를 화면이 숨기지 않는다(canon-2 §3.11, 05 §3.6.1).
- A5 목표 변경: Goal을 바꾸면 UC-09.

#### 수용 기준

- AC-12-01 (v0.2 F5) 합의 뒤 완료 기준을 바꾸면 그 기준에 기대던 결과와 컨텍스트가 낡음으로 표시되고, 런타임은 옛 기준으로 계속하지 않으며, 새 합의 echo가 보이고, 관련 없는 질문이 생기지 않는다.
- AC-12-02 사람이 시작한 기준·범위 축소 변경은 확정 질문을 만들지 않는다(입력 I로 센다).
- AC-12-03 변경은 다음 턴 경계에서 반영된다. 원자적 도구 실행 중이면 그 실행이 끝난 직후 반영되고, "반쯤 취소됨"을 표시하지 않는다(canon-2 §10 L12).
- AC-12-04 다이얼 변경은 어느 층의 값인지와 함께 기록되고 다음 턴 경계부터 적용된다.
- AC-12-05 안전하게 멈추기, 작업 중단, 즉시 끊기는 서로 다른 이벤트와 화면 상태를 가진다.

### 3.16 UC-13 새 근거로 판단·선택 다시 열기

| 항목 | 내용 |
|---|---|
| 목표 | 판단의 근거가 된 실제가 바뀌거나 선택의 다시 볼 조건이 충족되면, 그 판단·선택이 조용히 재사용되지 않고 다시 열려 사람에게 보인다 |
| 단계 | MVP |
| 출처 | 공리 A13, v0.3 02 §9, canon-3 체크리스트 "결정 재개", foundations/08 H9 |
| 사전 조건 | UC-02가 끝남. 판단 FD-1 "주원인은 순차 요청"(근거 O-2, O-8, 측정 시점 커밋 참조). 선택 CH-31(다시 볼 조건 "모바일 LCP가 2.5초를 넘으면") |
| 관련 문서 | 08(품질 상태 stale·contested, Trigger), 09(근거의 실제 참조와 해시), 10(재진입 규칙, 재결정 질문), 04(복귀 요약의 "왜 중요한가") |
| 범위 | 재결정 질문 규칙(사람이 정한 선택이 다시 볼 조건으로 낡으면 질문)은 MVP다. 측정 Trigger 자동 판정은 2단계다(판정 J-138) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | — | 다른 Concern의 WorkUnit이 `src/api/**`를 바꿈. FD-1의 근거 O-2가 참조한 파일 해시가 바뀜 → 근거 낡음 → FD-1 낡음(자동) | `record.staled` | — |
| 2 | 다른 작업에서 측정한 모바일 LCP 3.4초 관찰을 보고, CH-31 카드에서 "다시 볼 조건 충족"을 표시 | `SCR-EVIDENCE` | 사람의 표시로 CH-31이 낡음이 된다. 사람이 정한 선택이 다시 볼 조건으로 낡았으므로 커널이 같은 결정점의 재결정 질문(선택 요청, 권리 게이트)을 만들고 관련 Concern을 다시 연다(판정 J-138) | `observation.recorded`, `record.staled`(review_trigger_fired), `question.recorded`(choice_request), `concern.reopened` | I1 |
| 3 | 복귀 요약에서 "왜 중요한가: FD-1 근거 낡음, CH-31 다시 볼 조건 충족(LCP 3.4초)"을 봄 | `SCR-BRIEF` | — | — | — |
| 4 | 다시 열린 선택 요청에서 근거를 펼쳐 보고 "먼저 탐구"를 고름 | `SCR-EVIDENCE`, `SCR-QUESTION` | I.fact를 다시 시작. 이전 가능성들과 새 관찰을 출발점으로 | `loop.transitioned`(→ I.fact), `acceptance.recorded`는 없음 | D1 (`reinquiry`) |

#### 대안 흐름

- A1 유지: 사용자가 이유와 함께 "유지"를 고르면 선택은 유지되고 다시 볼 조건을 고친다(D1).
- A2 검증 에이전트의 반대 근거(2단계): 반대 근거 제안이 판단과 맞지 않으면 판단은 contested가 되고 같은 흐름을 탄다.
- A3 (2단계) 예측 확인: 결과 탐구의 예측 확인 날짜가 오면 A 루프가 예측과 실제를 비교해 기록하고, 틀렸으면 관련 선택을 다시 연다.
- A4 (2단계) 측정 Trigger 자동 판정: 주간 측정 WorkUnit(사용자가 정한 반복 작업)이 모바일 LCP를 관찰하면 커널이 CH-31의 다시 볼 조건(08 측정 Trigger)을 관찰과 비교한다(조건 판정은 코드, 관찰이 조건과 맞는지의 해석이 필요하면 모델 제안을 거침). 충족되면 단계 2와 같은 재결정 질문이 생긴다.

#### 수용 기준

- AC-13-01 근거가 참조한 실제(파일 해시, 커밋)가 바뀌면 그 근거와 그 근거에 기대는 판단이 자동으로 낡음이 된다.
- AC-13-02 사람이 정한 선택이 다시 볼 조건으로 낡으면 `record.staled`(review_trigger_fired), 재결정 질문(`question.recorded`)과 `concern.reopened`가 같은 트랜잭션에 기록된다(MVP, 판정 J-138). (2단계) 측정 Trigger 자동 판정은 같은 관찰에서 같은 결과를 낸다.
- AC-13-03 낡거나 다시 열린 판단·선택은 복귀 요약의 "왜 중요한가"에 나오고, 현재 기준선처럼 보이지 않는다.
- AC-13-04 낡은 판단을 근거로 하는 새 선택 요청이나 판단 승격은 커널이 거부한다(내용 거부).
- AC-13-05 다시 열린 선택은 사람이 다시 정하기 전까지 자동으로 바뀌지 않는다.

### 3.17 UC-14 Method Transfer로 가능성 넓히기

| 항목 | 내용 |
|---|---|
| 목표 | 같은 분야 안의 평균적인 해법을 넘어, 같은 구조의 문제를 겪은 다른 분야의 원리를 옮겨 와 가능성을 만들고, 반응과 탐침 결과를 본 뒤 사람이 정한다 |
| 단계 | 2단계 |
| 출처 | 결정 7, 13, v0.3 04 §4.2·§4.3, 사용자 진술(대화 L3550, L3741) |
| 예시 | v0.3 04 §4.3: "개인 하네스의 여러 세션에서 무엇이 진행 중인지 놓친다" |
| 루프 | O → I.possibility(Method Transfer 렌즈 포함) → C.probe → I.want 또는 선택 → C.commit |
| 관련 문서 | 15(가능성 탐구, 렌즈 라이브러리, 대비 압축), 04(가능성 비교 화면) |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | 요청 입력 | `RGN-COMPOSER` | 진입(EC-1, EC-4), 상황 판정 복합 | `entry.evaluated`, `concern.opened`, `situation.assessed` | I1 |
| 2 | — | — | 발산 표(관점 × 바꾸는 대상) 생성. 관점 행 중 하나 이상은 렌즈. 빈 칸마다 하위 호출(같은 시점 기록에서 시작, 서로 결과를 보지 않음) | `possibility.proposed` × n | — |
| 3 | — | — | 렌즈 절차 7단계: (1) 분야 용어를 뺀 구조 서술 "제한된 주의를 가진 한 사람이 동시에 진행되는 여러 흐름의 상태를 놓치지 않아야 한다" (2) 같은 구조의 분야(병원 인수인계, 항공 관제, 주방 주문 관리) (3) 환경 가정 (4) 원리(주문표 레일: 진행 중인 것을 한곳에 늘어놓고 끝나면 치움) (5) 복사하면 안 되는 것(소리치기, 짧은 주기 가정) (6) 번역(진행 중 Concern을 한 줄씩 늘어놓는 상태 화면) (7) 반증 조건(일주일 사용 후 "무엇이 진행 중인지 다시 찾는 시간"이 줄지 않으면 틀림) | `possibility.proposed`(lens, 단계별 기록) | — |
| 4 | 가능성 비교 화면에서 결과를 바꾸는 차이가 있는 것이 앞에 놓인 목록을 봄. 접힌 것도 펼쳐 봄. 가능성마다 요소 단위 반응 | `SCR-INQUIRY` | 대비 압축은 순서만 정하고 개수를 줄이지 않음. 근거 없는 가능성은 따로 표시 | `observation.recorded`(reaction) | I5 |
| 5 | — | — | 반응이 좋은 가능성 2개를 탐침형 C로 작게 시도(키울 조건, 접을 조건) | `probe.planned` × 2 | — |
| 6 | 탐침 결과가 담긴 선택 요청(권리 게이트, 판정 J-131)에서 "추천대로 정하기" | `SCR-QUESTION` | 키울 조건을 충족한 가능성을 추천으로, 가장 강한 다른 선택과 현상 유지를 함께 보이는 선택 요청. 선택지마다 구조화된 범위를 가진다 | `question.recorded`(choice_request), `question.answered`, `choice.committed`(decided_by human) | D1 |
| 6a | — | `SCR-AGREE` | 고른 선택지의 범위 안인 약속형 C 합의를 echo로 활성(R-OP-2 (a), 판정 J-133) | `loop.transitioned`(C.probe → C.commit), `agreement.proposed`, 선택 범위 활성 이벤트(`choice_scope`) | — |
| 7 | — | — | 렌즈별 채택·거절 기록(V6) | 운영 집계 | — |

#### 수용 기준

- AC-14-01 발산 표의 관점 행 중 하나 이상이 렌즈에서 나온다. 빈 칸은 채워지거나 "해당 없음"과 이유가 적혀야 닫힌다.
- AC-14-02 렌즈 가능성에는 1단계(분야 용어를 뺀 구조)와 5단계(복사하면 안 되는 것)가 비어 있으면 받아들여지지 않는다.
- AC-14-03 하위 호출의 입력에 다른 하위 호출의 결과가 없다.
- AC-14-04 대비 압축 뒤에도 모든 가능성이 남아 있고 펼쳐 반응할 수 있다. 반대 근거와 이견은 접히지 않는다.
- AC-14-05 렌즈별로 채택·거절 수가 집계된다.

### 3.18 UC-15 가벼운 작업과 Concern 승격·강등

| 항목 | 내용 |
|---|---|
| 목표 | 범주 밖 요청은 새 Concern 없이 프로젝트별 "가벼운 작업" 보관 Concern(08 `light_work`) 아래 WorkUnit으로 짧게 처리하고(압축된 C/A, 판정 J-01), 진행 중 신호가 나오면 새 Concern으로 올리며, Concern이 단순하다고 확인되면 내린다 |
| 단계 | MVP |
| 출처 | 01 §3.6, v0.2 CLI-Q01, 대화 L2458–2524 |
| 관련 문서 | 14(진입 판정, 강등), 12(승격 신호 감지), 10(압축된 C의 조건), 04(가벼운 작업 표시) |

#### 기본 흐름 (가벼운 작업)

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | "shop README의 설치 명령 오타 고쳐 줘"를 입력. 입력하는 동안 미리보기가 진입 예비 판정(가벼운 작업)과 echo("README.md 한 파일만 고칩니다. push하지 않습니다.")를 보이고, 보내기 버튼 문구에 echo가 들어간다. 보냄 | `RGN-COMPOSER` | 미리보기는 19 `composer.preview`가 진입 예비 판정과 echo를 함께 돌려준다(12 §3.5.10, 19, 04 §3.6.1에 요구). 보낸 뒤 진입 판정: 참 신호 없음, 제외 규칙 해당(해 보고 보는 비용이 작음) → 가벼운 작업. 프로젝트 Goal에 연결 | `entry.evaluated`(decision `skip`) | I1 |
| 2 | — | `RGN-COMPOSER`(진행 표시) | 보내기 전에 echo를 보였으므로 사람이 지시를 보낸 것이 합의 확정을 겸한다(R-OP-2(b): 지시에 이름이 나온 대상만, send 없음. 10 §3.6.7의 사람 채널 `agreement.propose`+`confirmNow`). echo 범위는 코드가 지시에서 경로 토큰을 뽑아 만들고 커널이 "지시 관찰의 경로 ⊇ 합의 경로"를 검사한다. 미리보기 없이 보냈거나 보낸 뒤 판정이 미리보기와 다르면 확정 질문으로 돌린다(01 §3.5.2) | `agreement.proposed`, `agreement.confirmed`(활성 방식 `direct_instruction`) | — |
| 3 | — | — | 수정, diff 관찰, 결과 제출 | `toolcall.*`, `result.submitted` | — |
| 4 | 진행 중 서랍의 가벼운 작업 카드에서 diff와 근거 한 줄을 보고 [결과 확인] | `RGN-RUNS`(가벼운 작업 카드, 04 §3.6.1) | 결과 확인 질문은 막지 않는 권리 게이트이므로 기록은 즉시, 전달은 다음 작업 경계 또는 검토 창이고 주의 비용이 낮다. 홈에서는 접고 개수를 보인다(판정 J-132). 결과 확인. 반영 항목 없음 → 작업이 끝남(가벼운 작업은 보관 Concern 아래 WorkUnit이므로 Concern 상태는 바뀌지 않음) | `acceptance.recorded` | D1 |

합계: D1, I1.

#### 대안 흐름

- A1 승격: "이 테스트가 왜 깨지는지 보고 고쳐 줘"로 가벼운 작업을 시작했는데 같은 테스트가 세 번 실패하고(PS-1) 원인 후보가 둘 보인다(PS-2). 커널이 Concern 열기 제안 질문을 기록(정보 게이트, 협상). 사용자가 수락하면(D1) 가벼운 작업의 관찰과 시도를 가진 채 Concern이 열리고 UC-02로 이어진다.
- A2 승격 제안 거절: 거절하면(D1) 가벼운 작업으로 계속하고, 같은 작업에서 다시 제안하지 않는다.
- A3 강등: UC-02에서 첫 관찰이 스택 트레이스로 원인을 바로 가리키면 에이전트가 Concern을 가벼운 작업으로 내린다(`structure.changed`(close, 결과 not_completed) + `concern.closed`, autonomous, why_not_asked "범주 밖으로 확인됨". 14 §3.14.5는 이를 `S.close`(not_completed)로 닫고 같은 요청을 이어 가는 것으로 구현한다). 사람이 직접 연 Concern은 내리지 않는다. 사용자는 이의를 걸 수 있다.
- A4 진입 판정에 이의: 가벼운 작업으로 판정된 것에 사용자가 이의를 걸면 Concern으로 연다(직접 지정과 같음). 반대 방향도 같다. CT-3에 집계된다.
- A5 범위가 커짐: 가벼운 작업 중 지시에 없던 파일을 바꿔야 하면 작은 범위를 벗어나므로 echo로 활성하지 않고 확정 질문(D1, `scope_expansion`)을 만들며, 승격 신호 PS-3도 함께 생긴다.
- A6 가벼운 작업 결과 묶어 확인: 하루에 오타 수정 같은 가벼운 작업 결과가 여럿 쌓이면 한 화면에서 묶어 확인한다(판정 J-132). 결정 조작은 결과 수만큼 센다(01 §3.5.2 셈법). 알림은 묶음 하나로 한 번만 간다.

#### 수용 기준

- AC-15-01 가벼운 작업에서도 write 전에 활성 합의가 있다. 직접 지시로 확정된 합의는 활성 방식 `direct_instruction`과 사람의 지시 관찰 id를 가진다. 사람 확인 없이 정책만으로 합의가 생기는 경로는 없다(10 §5.3).
- AC-15-02 가벼운 작업의 정상 경로 결정 조작은 1회(결과 확인)다.
- AC-15-03 가벼운 작업도 Goal(또는 자리표시 Goal)에 연결된다.
- AC-15-04 승격 신호 하나로 Concern 열기 제안(QuestionKind `entry_suggestion`)이 정확히 1건 기록되고, 거절 뒤에는 같은 가벼운 작업 안에서 다시 기록되지 않는다(01 §3.6.5, 14 §3.14.4).
- AC-15-05 승격으로 열린 Concern은 가벼운 작업의 관찰과 도구 호출 기록을 참조한다(처음부터 다시 하지 않는다).
- AC-15-06 강등은 `why_not_asked`가 있는 에이전트가 정한 것으로 남고 이의를 걸 수 있다.
- AC-15-07 진입 판정 결과와 이의 기록으로 CT-1~CT-3을 계산할 수 있다.

### 3.19 UC-16 외부 응답 기다리기

| 항목 | 내용 |
|---|---|
| 목표 | 다른 사람에게 요청을 보낸 뒤 응답이 오면 관찰로, 오지 않으면 기한이 지난 시점에 "응답 없음" 관찰로 기록해 다음 판단에 쓴다 |
| 단계 | 2단계(기대 레코드). MVP의 send는 git push만이고, 메일 같은 외부 발송 도구는 이후 단계다(01 §3.8.2). 2단계에서는 사람이 Helm 밖에서 보낸 요청을 기대 레코드로 등록하는 것으로 시작하고, 단계 1~2의 발송 흐름은 발송 도구가 생긴 뒤의 모습이다 |
| 출처 | 결정 9, v0.3 03 §7 |
| 사전 조건 | UC-01 A1의 기획 초안을 지인 리뷰어에게 보내 의견을 받기로 함 |

#### 기본 흐름

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | — | `os.notify` | 메일 발송은 send → 권리 게이트 질문. 발송을 막는 질문이므로 즉시 전달(판정 J-132) | `question.recorded`(rights) | — |
| 2 | 허락 | `SCR-QUESTION` | 발송, 기대 레코드(대상, 무엇, 기한 2일, 기한이 지나면 "응답 없음" 관찰) | `question.answered`, `toolcall.*`(send), `expectation.created` | D1 (`rights_gate`) |
| 3a | — | — | 답장이 옴 → "리뷰어가 ~라고 말했다"를 외부 출처 관찰로 기록(내용 자체는 관찰이 아님, v0.3 02 §2.3) | `observation.recorded`(source `external:reviewer`) | — |
| 3b | — | `SCR-BRIEF` | 기한이 지남 → 스케줄러가 "응답 없음" 관찰 생성 → O 또는 I로 전환. "응답 없음"은 복귀 요약의 "돌아온 뒤 달라진 점"과 "그대로 두면"에 나온다 | `expectation.timed_out`, `observation.recorded`(no_response) | — |
| 3c | 답장이 Helm이 보지 못하는 경로(전화, 다른 메일 계정)로 옴. 기대 카드의 [응답 받음 기록]으로 받은 내용을 적음 | `SCR-WORK`(기대 카드, 04 §3.10에 요구) | 사람이 기록한 외부 출처 관찰로 남기고 기대를 닫음 | `observation.recorded`(source `external:reviewer`, 기록자 human) | I1 |

#### 수용 기준

- AC-16-01 외부 발송은 권리 게이트 허락 없이 실행되지 않는다.
- AC-16-02 외부 응답은 "누가 그렇게 말했다"는 관찰로 기록되고, 그 내용은 추측으로 따로 다뤄진다.
- AC-16-03 기한이 지나면 클라이언트 연결 없이도 "응답 없음" 관찰이 생긴다.

### 3.20 UC-17 다른 기기·클라이언트·런타임에서 이어 하기

| 항목 | 내용 |
|---|---|
| 목표 | 기기를 바꾸거나(MVP), 클라이언트를 바꾸거나(3단계 TUI), 실행 런타임을 바꿔도(이후 어댑터) 같은 Goal, 선택, 작업 합의, 남은 위험이 그대로 이어진다 |
| 단계 | MVP(기기 전환), 3단계(TUI), 이후(런타임 어댑터) |
| 출처 | foundations/10 §9 cross-runtime 사용 사례, v0.2 PORT-G01, 결정 33·34·38 |

#### 기본 흐름 (MVP: 기기 전환)

| # | 사용자 행동 | 화면 | 데몬·런타임 동작 | 레코드·이벤트 | 조작 |
|---|---|---|---|---|---|
| 1 | 카페에서 Mac으로 UC-01 자극에 반응하다 앱을 닫음. 마지막 반응은 연결이 끊긴 뒤 썼으므로 초안으로 남음 | `SCR-STIM` | — | — | I3 |
| 2 | 집에서 Windows 호스트 앱을 엶 | `SCR-HOME` | 같은 상태. 복귀 확인 cursor는 사람 단위라 Mac에서 확인한 지점부터 이어짐 | — | — |
| 3 | Mac을 다시 켜고 초안을 보냄 | `RGN-TOPBAR`, `SCR-STIM` | 사용자가 보낸 반응이 적용되고 Windows 앱에도 스트림으로 보인다 | `observation.recorded`(reaction) | I1 |

#### 대안 흐름

- A0 (2단계) 휴대폰: 외출 중 휴대폰으로 질문에 답하고, 집에서 데스크톱 앱을 열면 같은 상태가 보인다. 화면은 `SCR-M-*`(03 §3.12)이고, 휴대폰에서 할 수 있는 일의 범위는 26 §1.2·§1.3이 정한다. 다른 기기에서 활동 중이면 휴대폰 푸시를 늦춘다(26 §3.7.3). 휴대폰의 초안도 그 기기에만 있다(A3).
- A1 (3단계) TUI: SSH로 WSL에 들어가 Helm TUI(pi-tui)를 실행한다. 같은 프로토콜로 같은 질문에 답하고 같은 결과 확인을 할 수 있다. 원함 탐구의 요소 단위 반응은 줄 번호나 구간을 지정하는 명령으로 받는다(감사 보고 §1.1). 이미지 자극을 TUI에서 어떻게 보일지는 v0.3 10 §4.3-12의 열린 질문이며 3단계에서 정한다.
- A2 (이후) 런타임 어댑터: Claude Code나 pi CLI 세션이 어댑터로 Helm에 붙어 같은 작업 합의 아래에서 WorkUnit을 실행한다. 그 런타임이 도구 호출 전 차단을 지원하지 않으면 범위 검사는 "권고"로 표시되고, 실행 뒤 작업 공간 비교로 보장 수준을 낮춰 검사한다(대화 L2789, 결정 34).
- A3 기기별 초안: 초안은 기기 로컬이라 다른 기기는 Mac의 초안을 모른다. 다른 기기에서 같은 질문에 먼저 답하면 Mac 초안은 다시 연결될 때 "이미 처리됨"(04 §3.0.5)으로 보인다. 보내지 않은 초안 수를 presence 보고에 실어 다른 기기의 질문 카드에 "다른 기기에 보내지 않은 답 있음"을 보이는 안을 19·20·26에 검토 요청한다 [제안].

#### 수용 기준

- AC-17-01 같은 cursor에서 두 기기의 홈과 복귀 요약 투영이 같다.
- AC-17-02 한 기기에서 한 복귀 확인은 다른 기기에도 적용된다.
- AC-17-03 (3단계) 어떤 클라이언트에만 있는 업무 동작이 없다. 데스크톱 앱과 TUI는 같은 사람 명령을 쓴다(canon-2 §3.15 headless parity).
- AC-17-04 (이후) 같은 가짜 모델 대본을 자체 런타임과 어댑터로 실행하면 이벤트 로그의 의미 이벤트가 같고, 다른 것은 출처(provenance)와 보장 수준 표시뿐이다(어댑터 적합성 테스트, 06·13).

### 3.21 UC-18 비상 대응

| 항목 | 내용 |
|---|---|
| 목표 | 혼돈 상황(예: 개인 서비스 배포 뒤 장애)에서 사람이 미리 확정해 둔 비상 합의(맡겨 둔 권한 Grant 중 비상용, 화면 이름 "비상 합의", 판정 J-116) 범위 안의 안정화 행동은 묻지 않고 하고, 안정된 뒤 재판정과 사후 검토를 한다 |
| 단계 | 3단계 |
| 출처 | v0.3 03 §3.3(비상 합의), §9.2 |
| 사전 조건 | 평상시 사람이 확정해 둔 비상 합의: "shop 데모 배포 뒤 오류율이 급증하면 직전 배포로 롤백하는 것까지 묻지 않고 해도 된다" |

흐름: C.emergency(롤백, 비상 합의를 권한 근거로 기록) → O(혼돈 → 복잡 재판정) → I.fact(원인) → (2단계 이후) I.outcome(재배포 사전 부검) → C.commit(수정, 재배포는 권리 게이트) → A.confirm → A.reflect(비상 합의와 배포 절차 수정 제안).

수용 기준:
- AC-18-01 비상 합의 범위 안의 행동은 질문 없이 실행되고, 권한 근거로 비상 합의를 가리킨다.
- AC-18-02 비상 합의 범위를 넘는 행동은 여전히 선택 요청이나 권리 게이트 대상이다.
- AC-18-03 비상 합의에 따른 실행은 안정된 뒤 사후 검토 항목으로 복귀 요약에 나온다.

### 3.22 UC-19 Concern 나누기와 합치기

| 항목 | 내용 |
|---|---|
| 목표 | 하나의 Concern 안에 서로 다르게 움직이는 문제가 섞여 있으면 하위 Concern으로 나누고, 모두 반영된 뒤 다시 합쳐 상위를 닫는다 |
| 단계 | 3단계 |
| 출처 | 사용자 제안(대화 L4020), v0.3 03 §4, §9.1 |
| 예시 | UC-01 A10: 반응을 보니 "글 주제"와 "글 형식"의 선호가 따로 움직임 |

흐름: S.split(하위 Concern 둘, 경계 항목 기록, 각자 Goal 연결 유지, 분해는 에이전트가 정한 것) → 하위마다 I.want → C.commit → A.confirm → S.recombine(두 결과를 합쳐 상위 확인) → 상위 A.confirm.

수용 기준:
- AC-19-01 하위 Concern은 상위와 Goal 연결을 가진다.
- AC-19-02 하위가 모두 반영되기 전에는 상위를 닫을 수 없다(의존 규칙 (4), [제안]). 사람이 명시적으로 닫는 경우는 예외로 기록된다.
- AC-19-03 하위 Concern의 수와 깊이에 상한이 있다(수치는 14).
- AC-19-04 분해·병합은 에이전트가 정한 것으로 남고 이의를 걸 수 있다.

### 3.23 유즈케이스와 화면·문서 대응

| UC | 단계 | 화면(§2.4 키) | 주 설계 문서 | 함께 보는 문서 | 테스트 계층(22) |
|---|---|---|---|---|---|
| UC-01 | MVP | `RGN-COMPOSER`, `SCR-CONCERN-OVERVIEW`, `SCR-STIM`, `SCR-INBOX`, `SCR-QUESTION`, `SCR-AGREE`, `SCR-REVIEW`, `SCR-GOAL` | 15, 05 | 04, 11, 14, 21 | 커널(가짜 모델), 실사용 기록 |
| UC-02 | MVP | `RGN-COMPOSER`, `SCR-HOME`, `SCR-CONCERN-OVERVIEW`, `SCR-INQUIRY`, `SCR-EVIDENCE`, `SCR-QUESTION`, `SCR-AGREE`, `SCR-REVIEW` | 15, 10 | 11, 04 | 커널, 실사용 기록 |
| UC-03 | MVP | `RGN-COMPOSER`, `SCR-AGREE`, `SCR-BRIEF`, `SCR-QUESTION`, `SCR-REVIEW`, `SCR-AUTO` | 11, 12, 14 | 04, 17 | 커널 + 스케줄러(가짜 시계) |
| UC-04 | MVP(2단계 휴대폰) | `SCR-HOME`, `os.notify`, `SCR-QUESTION`, `SCR-EVIDENCE`, `SCR-CONCERN-OVERVIEW`, `RGN-TOPBAR`, `SCR-M-INBOX`·`SCR-M-QUESTION`(2단계) | 19, 20 | 17, 18, 11 | E2E(두 경로), 프로토콜 |
| UC-05 | MVP | `SCR-BRIEF`, `SCR-AUTO`, `OVL-CONTEST`, `SCR-QUESTION`, `SCR-CONCERN-OVERVIEW`, `SCR-REVIEW` | 11, 10 | 04, 16 | 커널 |
| UC-06 | MVP | `SCR-HOME`, `SCR-BRIEF`, `SCR-EVIDENCE` | 04, 12 | 09, 16 | 투영(fixture), 성능 |
| UC-07 | MVP | `RGN-COMPOSER`, `SCR-CONCERN-OVERVIEW`, `SCR-AGREE`, `SCR-HOME`, `SCR-REVIEW` | 10, 14 | 11, 12, 13, 04 | 커널, 장애 주입, 실사용 기록 |
| UC-08 | 2단계 | `SCR-BRIEF`, `SCR-OBSERVER` | 16 | 18, 12 | 관찰 에이전트(로그 fixture) |
| UC-09 | MVP | `SCR-HOME`, `SCR-GOAL`, `SCR-CONCERN-OVERVIEW` | 08, 10 | 11, 04 | 커널 |
| UC-10 | MVP | `RGN-TOPBAR`, `SCR-RECOVERY`, `SCR-BRIEF` | 12, 17 | 09, 13, 19, 20 | 장애 주입, E2E |
| UC-11 | MVP | `SCR-ONBOARD`, `SCR-CONNECT`, `SCR-SETTINGS`, `SCR-GOAL` | 17, 18 | 20, 06, 23 | 설치 시험(서버), E2E |
| UC-12 | MVP | `SCR-CONCERN-OVERVIEW`, `SCR-WORK`, `RGN-COMPOSER`, `SCR-DIALS` | 12, 14 | 10, 04 | 커널, 런타임 |
| UC-13 | MVP | `SCR-BRIEF`, `SCR-EVIDENCE`, `SCR-QUESTION`, `SCR-CONCERN-OVERVIEW` | 08, 10 | 09, 04 | 커널 |
| UC-14 | 2단계 | `SCR-INQUIRY`, `SCR-QUESTION`, `SCR-AGREE`, `SCR-CONCERN-OVERVIEW` | 15 | 04, 16 | 커널, 탐구 엔진 |
| UC-15 | MVP | `RGN-COMPOSER`, `RGN-RUNS`, `SCR-QUESTION` | 14, 12 | 10, 04 | 커널, 런타임 |
| UC-16 | 2단계 | `os.notify`, `SCR-QUESTION`, `SCR-BRIEF`, `SCR-WORK` | 11, 12 | 08 | 커널 + 스케줄러 |
| UC-17 | MVP·3단계·이후 | `SCR-HOME`, `SCR-BRIEF`, `RGN-TOPBAR` | 19, 20 | 13(어댑터), 06 | E2E, 어댑터 적합성 |
| UC-18 | 3단계 | `SCR-CONCERN-OVERVIEW`, `SCR-BRIEF` | 14 | 11, 13 | 커널 |
| UC-19 | 3단계 | `SCR-CONCERN-OVERVIEW`, `SCR-HOME` | 14 | 08, 10 | 커널 |

화면 쪽에서 본 대응(어느 화면이 어느 유즈케이스에 쓰이는지)은 03이 이 표를 뒤집어 만든다.

### 3.24 테스트 시나리오로 옮기는 방법 [제안]

수용 기준은 가짜 모델 대본으로 재생할 수 있어야 한다(브리프 §3.4의 22, 대화 L2811). 대본 형식의 정본은 22 §3.8.1 `ScenarioScript` v1이다. 아래는 이 문서가 요구한 최소 형태이며, 22와 다르면 22를 따른다. 명령 이름은 10, 이벤트 이름은 09가 확정하면 그 이름으로 바꾼다.

```ts
/** 유즈케이스 하나의 흐름(기본·대안·예외 중 하나)을 재생하는 대본. */
interface ScenarioScript {
  id: string;                  // 예: "UC-07/basic", "UC-07/A2", "UC-10/B3"
  fixtures: string[];          // §2.7의 fixture 이름. 예: ["F-base", "F-shop-goal", "F-model-faux"]
  steps: ScriptStep[];
  /** 대본 전체에 대한 검사. 예: 정상 경로 결정 조작 수 */
  expectAtEnd?: Expectation;
}

type ScriptStep =
  | { kind: "human"; device: "dv_mac" | "dv_win"; listener: "tailnet" | "loopback";
      command: string; args: Record<string, unknown>; expect?: Expectation }
  | { kind: "model"; role: "work" | "router" | "verifier"; output: unknown; expect?: Expectation }
  | { kind: "tool_result"; toolCallRef: string; result: unknown; expect?: Expectation }
  | { kind: "clock"; advanceMs: number; expect?: Expectation }
  | { kind: "client"; device: string; action: "disconnect" | "reconnect" | "send_draft" /* 사람이 초안을 확인하고 보냄 */ | "resend_pending" /* 응답 전에 끊긴 명령을 같은 멱등 키로 */; expect?: Expectation }
  | { kind: "fault"; action: "kill_daemon" | "restart_daemon" | "model_unavailable" | "corrupt_log";
      expect?: Expectation };

interface Expectation {
  /** 이 단계 뒤 새로 기록된 이벤트 종류가 이 순서를 부분열로 포함한다 */
  events?: string[];
  /** 이 단계가 거부되어야 한다면 거부 갈래와 사유 코드 */
  rejected?: { class: "content" | "authority" | "path"; code: string };
  /** 사람 결정 조작 수(대본 시작부터 누적) */
  humanOps?: { normalPath?: number; extra?: Partial<Record<string, number>> };
  /** 투영 검사(복귀 요약 등). 키는 04·12가 정한 투영 필드 */
  projection?: Record<string, unknown>;
}
```

- 거부 사유 코드는 10 §3.4.4를 쓴다. 이 문서의 수용 기준이 기대하는 코드: `denied.agreement_required`(AC-01-12, AC-07-01), `denied.forbidden_action`·`gate.scope_expansion_required`(AC-07-02), `denied.capability` 또는 `denied.channel`(사람만 하는 결정을 모델이 시도, AC-01-08, AC-07-05), `policy.promotion_requirements`(`missing`에 08 `PromotionMissing` 값)(AC-02-03, AC-13-04), `invalid.why_not_asked`(AC-05-01), `invalid.agreement_content`(AC-07-14), `conflict.already_resolved`(이미 답한 질문, AC-04-06), `path.adapter_cannot_append_event`·`path.projection_is_derived`(AC-07-12), `invalid.question_shape`(AC-02-05). 강등 알림: `downgraded.criterion_unverified`(AC-07-04), `downgraded.interpretation_to_assumption`(AC-02-01).
- 대본의 출발점: UC-07 기본 흐름은 대화 L2304–2316의 한 턴 흐름, UC-02 AC-02-03은 `experiments/helm-toy/helm.mjs`의 21단계 대본(거부 8건).

## 4. 실패·예외·경계 사례 (유즈케이스 공통)

각 유즈케이스의 예외 흐름에 없는 공통 사례다.

| ID | 상황 | 처리 | 관련 |
|---|---|---|---|
| CX-01 | 사용자가 오래된 질문 카드에 답함(질문의 근거가 그 사이 바뀜) | 답 명령은 사람이 본 화면의 `basisSeq`를 싣는다. 질문이 그 뒤에 바뀌었으면 커널이 `conflict.version_mismatch`로 거부하고(이미 답했으면 `conflict.already_resolved`) 앱이 갱신된 질문을 보인다(10 §3.3.4, canon-2 §10 L14) | UC-04, 10, 19 |
| CX-02 | 빈 답이나 의미 없는 한두 글자(예: `ㅇ`)로 확정 | 결정 자체(확정·거절)는 받는다. 다만 자유 입력 칸에 의미 없는 글자만 있으면 그 칸은 비운 것으로 다루고, 필수 의미(예: 조건부 확인의 조건)가 비면 받지 않는다(EV-5 재발 방지) | UC-07 AC-07-06·14 |
| CX-03 | 같은 시각에 Concern 여러 개가 질문을 냄 | 질문함에 묶어 보이고 권리 게이트를 위로 올린다. 펼쳐 보이는 기본 개수는 3(01 §3.7) | UC-03, UC-04 |
| CX-04 | 몇 주 동안 열린 Concern | 복귀 요약은 확인 cursor 이후만 다룬다. Concern 개요의 루프 이력은 의미 단위로 접는다 | UC-06 |
| CX-05 | 시간대 | 저장은 epoch ms, 표시는 사용자 기기 시간대(브리프 §3.3). Mac과 Windows의 시간대가 다르면 각 기기 시간대로 보인다 | 전체 |
| CX-06 | 사용자가 앱을 두 기기에서 동시에 열고 같은 합의 카드를 고침 | 먼저 받아들여진 개정만 남고 다른 쪽은 충돌로 거부되며 새 revision을 받아 다시 고칠 수 있다(UC-07 AC-07-13) | 10, 19 |
| CX-07 | 실행 중인 WorkUnit 수가 상한(기본 3)에 이름 | 새 WorkUnit은 대기열에 들어가고 Concern 개요에 "대기 중(앞에 n개)"이 보인다(01 NFR-U-2) | 12 |
| CX-08 | 사용자가 Helm 밖에서 같은 프로젝트 파일을 고침 | 01 FX-12 | UC-13 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

- 유즈케이스 ID UC-01~UC-19와 단계, 초기 목록과의 대응(§3.1, §3.2)
- 유즈케이스별 단계 흐름, 대안·예외 흐름, 수용 기준 AC-01-01 ~ AC-19-04
- 화면 키(§2.4), 이벤트 이름 후보(§2.5), 공통 fixture(§2.7), 대본 형식 요구(§3.24), 거부 사유 코드 후보
- 원전·대화 사용 사례와의 대응(§3.3)

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 03 | §3.7 유즈케이스–화면 표를 UC-01~UC-19와 이 문서 §3.23으로 갱신(UC-04의 SSH 경로는 데스크톱 앱 `ssh -W`, TUI는 3단계). "기준당 1회"를 "질문 하나에 담긴 기준들은 결정 1회"로(판정 J-23). 질문 상태 `delegated` 라벨 "에이전트에게 맡김"(J-114), Grant "맡겨 둔 권한"·"비상 합의"(J-116), "복구 선택"·"읽기 전용"(J-115). 결과 확인 행동 다섯 가지(05 §3.4.1 이름) |
| 04 | 결과 거절 행 안에서 `reopenTo`를 고르는 칸(직전 I가 없으면 "새 합의 초안 / 사실 탐구", 판정 J-04·J-24). "확인 못함" 기준이 있으면 주 버튼을 [조건 붙여 확인]으로, 취향 기준 행마다 판정 칸(빈 칸 = 모르겠음). 결과 확인 화면에 남은 전제·아직 모르는 점·`invalidIf`(AC-07-17). 이의 창의 영향 표시에 "다시 정할 질문 [지금 정하기]"(UC-05). Goal 초안 카드 [이 Goal로 시작] [고쳐서 시작] [나중에]와 `proposed`·자리표시 상태(UC-11). GoalView의 다시 확인 대상별 상태와 반대 근거(UC-09). 기대 카드 [응답 받음 기록](UC-16). 입력창 미리보기에 진입 예비 판정과 echo(UC-15). 홈 접기 규칙은 01 §3.7(J-132) |
| 05 | §3.4.1 "02는 C"를 `reopenTo`로. "조건부 확인"/"조건 붙여 확인", "먼저 알아보기"/"먼저 탐구"를 문구 키 하나씩으로. 숨김 알림 문구 키 `notif.hidden.*`. 페어링 실패 문구 키 하나("코드가 틀렸거나 만료됐습니다", J-81). 예산 질문 세 버튼의 문구 키(UC-03 A3). "명확한 직접 지시" 행은 범위를 줄이는 지시에만(UC-12) |
| 08 | 진입 판정을 이의 대상으로 쓸 형식(AC-01-01, AC-05-01). 선택지의 구조화된 `scope`(J-133). 재작업 전이 submitted → superseded와 합의 승계(UC-05). `PauseReason` `submission_missing`(UC-07 E1). 08 §3.12 규칙 6을 10 R-21 목록으로(AC-07-10). 질문 종류 `recovery`/`tool_outcome_unknown` 하나로. `question.answered` 효과에 recovery 행과 사람 답의 근거 관찰(UC-10 B3). 측정 Trigger(2단계, J-138). 한 명령의 기준 변경은 모델 버전 1회(UC-01 단계 10). E-02를 01 FX-13에 맞춤 |
| 09 | `question.assumed`·`escalated`·`delivered`의 bumpsRevision(J-120). 선택 범위 활성 이벤트(J-90, 이 문서는 `agreement.activated_by_choice`로 적음). 부록 B.1을 UC-07 기본 흐름대로(I.fact 없음, `rollback_point.registered`·`loop.transitioned` 포함, `concern.completed` 행위자 runtime). `preference_model.created` 행위자에 runtime |
| 10 | 금지 자원 `policy.forbidden_resource`(J-92). R-OP-2 (a) 검사(J-133). 재결정 질문 규칙(J-138). 조건 항목 미룸(J-125). `scope_change` 답과 `workunit.scope_resolved` 대응표, `workunit.scope_exceeded`의 구조화된 요청 범위(UC-07 A2). 넘겨받는 Concern이 닫혀 있을 때만 다시 열기(UC-07 단계 10). 제출 뒤 관찰을 결과에 붙이는 규칙(UC-03 단계 11) |
| 11 | 재결정 질문은 커널이 추천 없이 만들고 14가 `question.updated`로 추천을 더함(UC-05). 이의 뒤 루프 전환표를 14로. 재작업은 11 방식(정본). 대체된 결정에 대한 이의는 거부(3009). `entry_confirm` → `entry_suggestion`, `rework` → `correction_cycle`. 협상 전달의 OS 알림 기본 끔(AC-04-01, 11 §3.5.6 surface). 막지 않는 권리 게이트의 전달(J-132) |
| 12 | 승인 대기는 그 호출만 두고 run은 계속, 대기 run이 없으면 14가 새 run 요청(J-96, UC-03). running run에 온 질문 답을 다음 투영 delta로 넣고 `directive.applied`(UC-04 단계 6). 확인 조회 절차와 `report_unknown`의 `recoveryCheck`·`externalRef`(UC-10 B3). 복구 선택지 집합의 정본. `composer.preview`의 진입 예비 판정과 echo(UC-15). [그렇게 기록]은 `agreement.renegotiate`(UC-12). `model_unreachable` 회복 신호(J-109) |
| 13 | 탐구용 실행의 임시 작업 공간(UQ-06). 합의가 활성된 뒤 첫 쓰기 전에 되돌릴 지점(13 §3.7.8, AC-07-15). 확인 조회 도구 선언 |
| 14 | 직전 I가 없을 때 `reopenTo`(J-24). 재결정 run 요청과 이의 뒤 루프 전환(R 채널). 합의 예산 우선과 `wallMinutes` 셈법(UC-03). `budget_extension` 진행 요약 형식의 정본. 제출 없음 처리(UC-07 E1). `concern.completed` 순서. MVP 복합 상황의 기본 조합에서 C.probe·A.watch 생략(UQ-08). §3.13.7의 옛 이름 `agreement.accepted(delegated_grant)` |
| 15 | E0 기록 형식을 실사용 기록에도 쓰게 함(AC-01-17, AC-02-10). 라운드를 닫는 계기 목록(UC-01 단계 5). 확정 기준 0개일 때 "추측" 표시 초안(UC-01 E4) |
| 16 | UC-08의 7·14·28일 효과 보고와 기각 서명 규칙(AC-08-04), 복귀 점검(UC-06 A1). `human_op` 사실 `normalPath`·`opReason`이 이 문서의 조작 칸과 맞음(재작업 결과 확인 = `correction_cycle`). `ca.agreement_bypass_rate`의 `agreement.cancelled`는 08·09에 없음 |
| 17·18·19·20 | UC-04 두 경로의 같은 메시지(AC-04-04), 페어링 이벤트(UC-11). 19 `RecoveryResolveParams`를 10 `toolcall.recover` payload에 맞춤. `AgreementConfirmParams.edits`(J-124, UC-07 단계 5). 기기별 초안 수를 presence에 싣는 안 검토(UC-17 A3) |
| 26 | `listener` 값 `tailnet`(이 문서 AC-04-08·09) |
| 22·23 | §3.24 대본 형식 정본은 22 §3.8.1. 수용 기준 추적표는 22 §3.8.5. AC-07-17·AC-13-02(MVP 재결정 질문) 추가분 반영 |

### 5.3 다른 문서가 이 문서에 요구한 것과 처리

| 요구한 문서 | 요구 | 처리 |
|---|---|---|
| 03 | 화면 키를 03 ID로, 자리표시 Goal 이름 "이름 없는 Goal", Concern에 "완료" 대신 "반영 완료"·"닫힘", 멈춤 문구를 05 §3.6.1로, 오프라인 자동 전송 없앰 | 모두 반영(§2.4, UC-11 A3, UC-07 단계 11, UC-12 A2~A4, J-02) |
| 03·04·05 (교차 검토) | 화면 경로를 04 동작에 맞춤, 알림 기본값과 협상 알림 끔, 복귀 요약 절 이름, 결과 확인·선택 요청 행동 이름, 이의 흐름(재결정은 질문의 답으로만), 반영 처리 방침 두 가지, 예산 소진 처리, 화면 문구 키 | §2.4, UC-01 단계 9·A3·A4·AC-01-03·10, UC-02 단계 4·8·9·10·11, UC-03 단계 7·12·A1·A3, UC-04 전체, UC-05 단계 3·3a·AC-05-03, UC-06 표·단계 1·A2, UC-07 단계 9·9a·10·AC-07-06, UC-10 B1·B3·B5, UC-11 단계 7·8·E2, UC-12 단계 2, UC-13 단계 4, UC-15 단계 4 |
| 05 | 알림 기본 내용 숨김 | AC-04-01(J-03, 05 §3.7.6 기본 문구) |
| 19 | 접속 방식(`ssh -W`, 리스너 셋, `/rpc`), 재전송 위치 `{storeId, seq}`, `basisSeq`와 `3004`, 리스너 값, 버전 불일치 `1003` | §3.7 머리 문단, UC-04 단계 2·5·B·E4, AC-04-04·05·08, AC-11-02, UC-11 A1, §3.24 |
| 06 | 유즈케이스 ID 확정 | §3.1 |
| 08·09 | 1판 이벤트 이름을 09 카탈로그로, RollbackPoint `agreementId`, 관찰 종류 대응(`utterance`, `resumption_check.*`, `brief.corrected`) | §2.5와 본문 전체, UC-07 단계 5·AC-07-15, §2.5 관찰 행 |
| 10 | 거부 사유 코드, 반영 항목 닫기, 질문 묶임, 동시 명령 충돌 | §3.24(10 §3.4.4 2판 코드), ADR P1-7을 10 R-21에 맞춤, CX-01과 AC-07-13을 `basisSeq`·`revisionSeq`와 `conflict.*`로 |
| 11 | 기준 확인·Concern 열기 제안·Goal 수정 권리 게이트·결과 확인 전달·승격과 가정 확정 순서 | UC-01 단계 9(`criterion_confirm`), UC-15 A1(`entry_suggestion`), UC-09, UQ-09(D-1), UC-03 AC-03-05 |
| 14 | UC-01·02·07이 §3.19와 맞는지, UC-03 수용 기준에 §3.17 | 맞음을 확인. UC-03 관련 문서에 §3.17 추가 |
| 15 | UC-01 자극 라운드·반응·기준 확인·`stated_vs_revealed`, Method Transfer 유즈케이스, E0를 관찰 항목으로 | UC-01(이미 있음, 이벤트를 09 이름으로), UC-14, AC-01-17·AC-02-10 |
| 15 | `workunit.paused`, `preference_model.created`를 라운드 0으로, 정지 근거 `planStable`, "보류" = `keep`, AC-01-15 | UC-01 단계 3·10·11, AC-01-15 |
| 16·22 | 조작 검사 필드 `normalPath`·사유, 재작업 셈, §3.24 정본, 추적표 위치, UC-10 B4 | AC-01-13·03-10·05-05·07-09, UC-05 단계 5, §3.24, §6, UC-10 B4 |
| 17 | UC-11 단계 3(홈랩 `serve.table` 한 줄 + `just serve-apply`) | UC-11 단계 3 |
| 19·26 | 휴대폰 경로 단계, 백그라운드 연결 닫기, 리스너 값, 휴대폰 페어링, 초안 한계, 숨김 문구 키, `compact` | UC-04 M, AC-04-01·08·09, UC-11 A5, UC-17 A0·A3, AC-06-01·05 |
| 16 | UC-08 흐름(복귀 요약의 관찰 에이전트 절, 채택 1회, 정책 즉시 적용 또는 적용 Concern, 7·14·28일 효과), `policy_proposal.*` 이름, 직접 쓰기 경로 없음, 서명 재제출 규칙 | UC-08 단계 6·7·11, A1, AC-08-02·04 |

## 6. 구현 단위와 완료 기준

| 단위 | 위치(제안, 22가 확정) | 완료 기준 |
|---|---|---|
| 유즈케이스 대본 | `tests/scenarios/uc-XX-<흐름>.ts` | MVP 유즈케이스(UC-01~07, 09~13, 15, 17 기기 전환)의 기본 흐름과 대안·예외 흐름 각각에 대본이 있고 가짜 모델로 통과한다 |
| 수용 기준 추적표 | 22 §3.8.5 | AC마다 검사하는 테스트 이름이 있다. 빠진 AC가 없다 |
| 장애 주입 | 22 | UC-10의 AC가 데몬 강제 종료 지점별로 통과한다 |
| E2E | 22, 20 | UC-04(두 경로), UC-10 A, UC-11을 실제 앱과 데몬으로 통과한다(macOS, Windows 각 1회 이상) |
| 실사용 기록 | 01 §3.8.3 | UC-01, UC-02, UC-07을 실제 모델로 끝까지 수행한 이벤트 로그가 있다 |
| 사람 조작 검사 | 16 | 모든 MVP 대본에서 16 계산의 `normalPath` 결정 조작이 01 R-OP-1을 지킨다 |

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| UQ-01 | 작업 합의 하나에 단계를 여러 개 두고 결과 확인을 합의 단위로 한 번 하는가(UC-03) | (a) 합의 단위 한 번 (b) 단계마다 | (a). 단계별 결과는 관찰로만 남기고 결과 제출은 합의 단위로 한 번. 단계마다 확인하면 R-OP-1을 넘는다. 08에 단계 필드를 두지 않고 `checkpoint`를 쓴다 |
| UQ-02 | 반영 항목을 누가 닫는가(integrate 능력은 사람만, v0.3 07 §2.4) | (해소) 10 R-21, 판정 J-125 | 관찰로 확인되는 종류는 근거가 붙으면 커널이 닫는다. 사람만 닫는 종류는 사람이 닫거나 면제하거나 다른 Concern으로 넘기거나 미룬다. 조건부 확인의 조건 항목은 결과 확인과 같은 트랜잭션에서 미뤄진다. 결과 확인 화면은 전역 방침만 묻고 항목마다 따로 묻지 않는다 |
| UQ-03 | Goal 변경 뒤 범위가 넓어지지 않는 합의 갱신을 echo로 하는가(UC-09 단계 4) | echo / 확정 질문 | echo |
| UQ-04 | 마무리 직전 검사의 최대 반복 | 1 / 2 / 3 | 2 |
| UQ-05 | 복귀 점검(UC-06 A1)의 기본값 | 켜짐 / 꺼짐 | 꺼짐. G1 기간에만 켬 |
| UQ-06 | 탐구 단계의 실행(빌드, 측정)이 프로젝트에 파일을 쓰는 문제 | (a) 임시 작업 공간(복사본·worktree)에서 실행 (b) 탐구에도 압축된 합의 | (a). 13이 방식을 정함 |
| UQ-07 | 서버와 같은 PC의 Windows 앱이 127.0.0.1로 직접 붙는 것을 허용하는가 | 허용 / 두 경로만 | 두 경로만(결정 38의 두 방식). 17·18이 다르게 정하면 따름 |
| UQ-08 | MVP의 복합 상황 기본 조합에서 C.probe·A.watch를 빼는가 | 뺌 / 넣음 | 뺌. 2단계에서 넣음(01 §3.8.2) |
| UQ-09 | 결과 확인 질문의 전달 방식 | (해소) 판정 J-132 | 권리 게이트지만 작업을 막지 않으므로 기록은 즉시, 전달은 다음 작업 경계 또는 검토 창. 가정 확정은 하지 않고 홈에서는 접고 개수를 보인다 |
| UQ-10 | 원함 탐구 첫 라운드 자극 수와 최소 수 | 다이얼 | 첫 라운드 8, 최소 4. 15가 확정 |
| UQ-11 | 기준 확인 질문에서 여러 기준을 한 번에 확정할 때 조작 수 | 질문 하나에 기준 여럿 = 1 / 기준마다 1 | (해소) 판정 J-23. 질문 하나에 담긴 기준들은 1회. 질문이 여럿이면 질문 수만큼(UC-04 대안 F, 01 §3.5.2 셈법) |

## 8. 출처

- 브리프 `process/00-design-brief.md`, [01 제품 브리프](01-product-brief.md)
- v0.3: `01`~`07`, `09`, `10`(특히 03 §5·§6·§7·§9, 04 §2~§5·§8, 05 §4·§6, 06 §3~§6, 07 §2·§4·§6, 09 §4)
- 원전 요약: `helm-canon.md` §6.6, §8.10, §14.4, §14.7, §16.10, §17.3, §17.5, §17.8, §21-02; `helm-canon-2.md` §3.6, §3.10~§3.17, §4.1, §4.6, §4.7, §6, §10, §11-02; `helm-canon-3.md` §3.6.2, §5.1.9, §5.2.9, §6.6, §6.14, §7.3 I4, §8-02
- 대화 발췌: `conversation-extracts-1.md` §6(관찰 에이전트), `-3.md` §2·§4.3·§6·§9.6·§10, `-4.md` §2·§5·§6·§8·§9·§17~§19
- 대화 원문 행: L246, L298–319(관찰 에이전트), L2016–2170(C/A), L2229–2234(생성·승격 규칙), L2304–2316(한 턴의 흐름), L2426–2531(탐구 흐름, 범주), L3161–3224(helm-toy 거부), L3403(자동 검증 가능 선택), L3741–3921(원함 탐구, 질문 레코드, 기대 레코드), L4020–4086(S 루프), L4388(사용 장면), L4409
- 실험: `experiments/helm-toy/helm.mjs`(거부 8건), `experiments/durable-spike/`(합의·제출 흐름 차단, 재시작 후 재개)

## ADR 후보

### ADR 후보 P1-6: 작업 합의는 단계를 가질 수 있고 결과 확인은 합의 단위로 한 번 한다

- 상태: 제안
- 맥락: 여러 날 걸리는 작업(UC-03)은 WorkUnit 여러 개로 나뉜다. WorkUnit마다 사람이 결과를 확인하면 사람 조작 2회 상한(01 R-OP-1)을 넘는다.
- 결정: 작업 합의의 진행 지점(08 `checkpoint`)에 단계를 적을 수 있다. 단계별 결과는 관찰로만 남고, 결과 제출과 사람의 결과 확인은 합의 단위로 한 번 한다. 단계별 관찰은 결과 확인 화면에 기준과 함께 보인다.
- 근거: C/A 우선과 조작 상한을 함께 지킨다. "완료"에는 A가 필요하다는 의존 규칙 (2)는 합의 단위의 완료에 적용된다.
- 기각한 대안: 단계마다 결과 확인(상한 위반), 단계를 별도 합의로(합의 확정이 단계 수만큼 늘어남).
- 결과: 08에 새 필드는 필요 없다. 12가 단계별 관찰 기록을, 04가 단계별 결과 표시를 정한다.

### ADR 후보 P1-7: 반영 항목의 처리는 결과 확인 한 번 안에서 정한다

- 상태: 제안(10 R-21, 판정 J-125와 맞춤)
- 맥락: v0.3 07 §2.4의 능력표에서 integrate는 사람만 가진다. 반영 항목마다 사람이 닫으면 조작이 늘어난다.
- 결정: 결과 확인 한 번에 반영 처리의 전역 방침(두 값)을 고른다. 관찰로 확인되는 종류(`docs_tests`·`boundary_check`·`recombine`)는 반영 WorkUnit이 낸 근거 관찰이 있을 때 커널이 닫는다. 사람만 닫는 종류(`broken_premise`·`concern_conflict`·`acceptance_condition`·`goal_revision_check`)는 사람이 닫거나 면제하거나 다른 Concern으로 넘기거나 미룬다. 조건부 확인의 조건 항목은 결과 확인과 같은 트랜잭션에서 미룬다(다시 볼 조건 = 조건 문장). 항목 하나를 따로 미루는 것은 선택 조작이다.
- 근거: 사람의 integrate 능력을 그대로 두면서 조작 상한(R-OP-1·R-OP-3)을 지킨다.
- 기각한 대안: 에이전트에 integrate 능력 부여(능력표 위반), 항목마다 사람 확인(상한 위반).
- 결과: 10 R-21, 11 §3.15(반영 항목 방침 묶음), 04 결과 확인 화면이 같은 규칙을 쓴다.

### ADR 후보 P1-8: 복귀 확인 cursor는 사람 단위로 하나 둔다

- 상태: 제안
- 맥락: 사용자는 Mac과 Windows 두 기기를 쓴다. 기기마다 cursor를 두면 이미 본 변화가 다른 기기에서 다시 "바뀐 것"으로 보인다.
- 결정: 복귀 확인 cursor는 사람 하나에 하나다. 확인한 기기 id는 기록한다.
- 근거: 1인 제품(결정 24). 복귀 요약의 목적은 사람의 상황 인식이지 기기의 동기화 상태가 아니다. 기기의 동기화 상태는 저장한 위치 `{storeId, seq}`(19 §3.5)로 따로 관리한다(결정 31).
- 기각한 대안: 기기별 cursor.
- 결과: 09·12·20이 반영한다.

## 부록 B. 원천 체크리스트 반영 표 (02 해당 항목)

| 원천 항목 | 반영 위치 또는 반영하지 않은 이유 |
|---|---|
| canon §21-02: P07 결제 흐름 9단계를 서술 틀로, 1인 사용으로 | §3.3. UC-02·07·06의 흐름이 같은 순서를 따른다. 결제 예시 자체는 팀 전제라 그대로 쓰지 않음 |
| canon §21-02: P02 8단계 흐름과 단계별 경험·가치 | §3.3 |
| canon §21-02: F10 cross-runtime 10단계 → "클라이언트를 바꿔도·자리를 비워도 이어진다" | UC-17, UC-03 |
| canon §21-02: 다시 열림 상황 6, 결과 확인 4 행동, 실패와 복구 5 요소 | 다시 열림: UC-05·07·12·13의 대안 흐름. 결과 확인 행동: UC-07 AC-07-06(원전 4개에 "거절"을 더한 5개, 대화 L2137의 수용 옵션과 합침). 실패와 복구: UC-10 |
| canon §21-02: F08 질적 연구 일곱 순간을 유즈케이스 후보로 | §3.3 마지막에서 두 번째 행. 기존 유즈케이스의 관찰 항목으로 둔다(별도 유즈케이스 없음) |
| canon §21-02: 수용 기준에 초기 성공 기준 5, 인식적 완료 조건 6 | 초기 성공 기준은 01 §3.10.3(SC). 인식적 완료 조건 6(만족 주장 조건, 연결된 근거, 검증 못한 범위, 남은 가정·불확실성, 알려진 반대 근거, 무효화 조건)은 UC-07 AC-07-04·06과 결과 확인 화면 요구(§5.2의 04 행)에 들어 있다 |
| canon-2 §11-02: CLI-Q01, G01, G02, G03, A01, PORT-G01 재작성, G01의 박자 8·가능성 4·Gate 2·실패 주입 F1~F6 | §3.3, UC-15(Q01), UC-02+07(G01: AC-02-07 가능성 보존, F1~F6은 AC-07-11~14와 AC-12-01), UC-12(G02), UC-06(G03), UC-07 A4·UC-18(A01), UC-17(PORT-G01) |
| canon-2 §11-02: 지연 복귀(24h) 유즈케이스와 probe 4개, User-acknowledged cursor | UC-06(A1 복귀 점검, AC-06-01) |
| canon-2 §11-02: 비확장 Work Agreement 활성화와 확대 시 Gate | UC-02 단계 12, UC-07 A1·A2, AC-02-08 |
| canon-2 §11-02: 불확실 외부 결과 복구 | UC-10 B3 |
| canon-2 §11-02: 실행 중 기준 변경(F5) → 이전 revision stale | UC-12 AC-12-01 |
| canon-2 §11-02: 짧은 자연어 수락 → Commitment 전개 | UC-07 단계 1~5, UC-02 단계 11~12 |
| canon-3 §8-02: 24시간 뒤 복귀, 실행 중 재정의, 완료 주장 반려, 결정 재개, 권리 게이트 대기 | UC-06, UC-12, UC-07 A3·E2, UC-13, UC-03 단계 7 |
| canon-3 §8-02: 결정적 사건 14개와 UX 임계 사건 6개를 관찰 항목으로 | 16이 측정. 이 문서에서는 대응 유즈케이스: Brief를 읽고 새 질문(UC-06), 프레임 수정(UC-01·09), 구분 실험 선택(UC-02), 반대 근거로 추천 변경(UC-02 A2, UC-13), 결정 뒤 함께 바뀔 맥락 발견(UC-09 AC-09-03), 완료 주장과 확인 사이 결함(UC-07 AC-07-04), 읽히지 않는 필드(16의 화면 로그), counteroffer·clarification(UC-07 A2), 세부 수행법 대신 기준 수정(UC-12), 불필요한 상향·조용한 경계 넘기(UC-07 AC-07-02), last-cheap-point 전 예외(UC-03 AC-03-05), Integration에서 의미 충돌(UC-07 단계 10), near miss·dissent가 다음 합의를 바꿈(UC-07 단계 12, UC-08) |
| canon-3 §8-02: Method Transfer 유즈케이스(런타임 7단계, 주문표 레일) | UC-14 |
| 발췌 3 (d) Q1 C/A 상태 기계에 빠진 전이(범위 확인 중 수정·취소, 멈출 조건, 합의 종료, 조건부 확인의 조건) | 상태 기계는 14·08 소유. 이 문서는 흐름으로 요구: 합의 카드에서 고쳐 확정(UC-07 단계 5), 멈출 조건(UC-03 E2, UC-07 A2), 조건부 확인의 조건 문장 필수(AC-07-06) |
| 발췌 3 (d) Q2 반영 항목 미루기의 기록과 재노출 | UC-07 단계 9·11, AC-07-08 |
| 발췌 3 (d) Q7 도구·명령 이름 | 10 소유. 이 문서는 이벤트 후보만 |
| 발췌 4 (a) a2 혼자 정한 결정 확인 | UC-05 |
| 발췌 4 (a) a15 외부 응답 = 관찰 | UC-16 |
| 발췌 4 (a) a26 "유즈케이스" 용어 | 전체 |
| 발췌 4 (b) b20 사용 장면 4~5개 | §3.3 마지막 행 |
| 발췌 4 (d) d9 integrate 소유 | UQ-02, ADR 후보 P1-7 |
| 발췌 4 (d) d19 기대 레코드 기한 | UC-16(기한 예 2일). 기본값은 08·12 |
| 발췌 4 (d) d22 데몬이 꺼졌을 때 외부 어댑터 처리 | 이후 단계(UC-17 A2). 13 소유 |
| 발췌 1 (d) Q6 관찰 결과 전달 채널 | UC-08 단계 6(복귀 요약과 관찰 제안함, 세션에 넣지 않음) |
| 감사 보고 §1.1 TUI에서 요소 단위 반응 | UC-17 A1 |
| 감사 보고 §2 A 루프를 사람이 하는 두 이유, 교차 점검 | 01 §3.5.1, UC-07 단계 9~10(결과 확인과 반영의 구분) |
| 브리프 §3.5 "C/A … 사람 조작 2회 상한"(P1 몫, 02) | 모든 MVP 유즈케이스의 조작 칸과 AC-01-13, AC-03-10, AC-07-09, AC-15-02 |
