# 2a단계 조정자 판정

- 작성: 2026-10-12, 조정자. 1단계 보고 14건의 "다른 문서에 대한 요구"와 "브리프에 대한 이의"를 모아 판정했다.
- 2a단계 모든 에이전트는 이 문서를 읽고 따른다. 판정과 다르게 하려면 근거를 적어 보고한다.
- 사용자 결정 41~43과 조정자 판정 44~46은 브리프 §2.4b에 있다.

## 1. 이름과 소유 (정본)

| 대상 | 정본 문서 | 판정 |
|---|---|---|
| 이벤트 이름·payload | 09 §3.4 카탈로그(271개) | 모든 문서가 09 이름으로 바꾼다. 1판 이름 대응은 08 §10.3, 12 §3.16, 10 §3.4.6 |
| 레코드 종류·필드·질문 종류(QuestionKind)·ID 접두사 | 08 | 접두사 목록 정본은 08 §3.2(57개). 브리프 §3.2는 초기값일 뿐이다 |
| 명령 이름 | 10 §3.11 | 04·19의 명령 의도 이름은 10 명령과 대응표로 묶는다. 없는 명령(04 §5.2: `question.defer`, `question.delegate`, `inquiry.stop`, `expectation.revise`, `dial.unset`, 사람의 모드 지정 등)은 10이 추가한다 |
| 프로토콜 메서드·오류 코드 | 19 | |
| 화면 ID(`SCR-*`, `RGN-*`, `OVL-*`) | 03 | 21은 화면 키를 `SCR-*`로 바꾼다 |
| 유즈케이스 ID(UC-01~19) | 02 | |
| 패키지 경계 | 06 | §2 참고 |
| 거부 갈래 이름 | 10 | `content` / `authority` / `path`. 다른 이름(`qualification`, `eligibility`)은 쓰지 않는다 |
| 범위 밖 쓰기 거부 | 10 ADR-K8 | 자격 갈래 `gate.scope_expansion_required`. 금지 자원은 내용 갈래 `policy.forbidden_resource` (08이 이미 따름) |

## 2. 패키지와 포트

- 패키지: 06의 목록에 `@helm/engine`, `@helm/testkit`, `@helm/vendor-pi-agent-core`, `@helm/vendor-pi-tools`, `@helm/vendor-pi-image`(07), `@helm/ui-language`(05 A9, I/O 없음), `@helm/client`를 둔다.
  - **클라이언트 코어는 `@helm/client`(별도 패키지, `@helm/protocol`에만 의존)로 정한다.** 06이 접은 것을 되살린다. 19·20이 이미 이 이름을 쓰고, 프로토콜 타입(서버도 씀)과 연결·재전송 로직(클라이언트만 씀)을 나누는 편이 의존 규칙상 깔끔하다. 데스크톱·모바일·TUI가 함께 쓴다. `credentials`는 선택 인자.
  - `observer`는 클라이언트 프로토콜을 쓰지 않고 16의 IPC로 제출한다. `observer → client` 의존은 없다.
- 리스너 포트: `tailnet` 127.0.0.1:7840(serve 외부 8448), `loopback` 127.0.0.1:7841(`ssh -W`), `local` Unix 소켓 `/run/user/1000/helm/rpc.sock`. 06·13의 7801은 고친다.
- `/healthz` 응답 형식은 17이 정하고 19가 따른다.
- 설정 파일은 TOML(`helmd.toml` + `helmd.local.toml`, 06 ADR-06-11). 17은 이름을 바꾼다.
- 데이터: `/srv/volumes/helm/data/helm.sqlite`. 잠금: `data/helmd.lock`의 `BEGIN EXCLUSIVE`(17). 09 D09-7의 소켓 bind 잠금은 이것으로 바꾼다.

## 3. 충돌 판정

| 번호 | 쟁점 | 판정 | 고칠 문서 |
|---|---|---|---|
| J-01 | Concern 밖 작업에 의존 규칙 (1)(2) 적용 (01 OQ-14 대 14) | 적용한다. 01의 "가벼운 작업" 압축형(echo 합의, 한 화면 확인, 승인된 정책)으로 지키고, 위치는 14의 프로젝트별 "가벼운 작업" 보관 Concern 아래다 | 01, 14, 10 |
| J-02 | 연결이 없을 때 결정 입력 (01 NFR-O-2 자동 전송 대 04·20 막음) | 막고 초안으로 보존한다. 응답 전에 끊긴 명령만 같은 멱등 키로 다시 보낸다 | 01, 02 |
| J-03 | 알림 내용 노출 (02 AC-04-01 대 05) | 기본은 내용 숨김, 설정으로 켠다 | 02 |
| J-04 | 결과 확인 거절 뒤 다음 루프 (02 C 대 14 직전 I) | 14 U-26: `reopenTo`, 기본은 직전 I | 02 |
| J-05 | 도구 결과 불명 질문의 게이트 (04 권리 대 10 정보) | 외부 효과가 있을 수 있는 호출(send, 네트워크)은 권리 게이트, 그 밖은 정보 게이트. 질문은 외부 효과가 있을 때만 만든다(12) | 04, 10, 11 |
| J-06 | 첫 라운드 자극 수 (15·01: 8, 14: 6) | 8(최소 4) | 14 |
| J-07 | 관찰 에이전트 단계 | 결정적 수집·탐지·지표는 MVP, 모델 판정·제안은 2단계(01·16 일치) | 확인만 |
| J-08 | 외부 세션 로그 범위(결정 35) | "세션 cwd가 허용 폴더(프로젝트 rootPaths) 아래인 세션". 로그 경로는 런타임별 홈 폴더. Mac에서 연 세션은 대상 밖(한계로 기록) | 08, 16 |
| J-09 | 가설 번호 | foundations H1~H10 그대로, v0.3 10 §3은 V1~V7, 새 가설 V8·V9(01) | 25 |
| J-10 | 원전의 SA probe·resumption probe | "복귀 점검". "탐침"은 C.probe 전용 | 25 |
| J-11 | 증거 관문 G1·G2와 "한 번에 구현" | 한 번에 구현하되 2단계 기능은 G1 기록 전까지 기본 꺼짐(ADR P1-5) | 23 |
| J-12 | Quick/Guided/Assured | 증명 부담 다이얼(`proofBurden`) 값 가볍게/보통/엄격, 기본 보통 | 확인만 |
| J-13 | 14와 12의 스케줄러 경계 | 14 = 논리 배분(우선순위, 주의 예산, 활성 Concern), 12 = 물리 상한과 타이머 | 12, 14 |
| J-14 | 결정 28 문구 | "이벤트 싱크(`subscribe` 또는 저수준 루프의 `emit`)의 `message_end`" | 24 |
| J-15 | macOS 자체 서명 인증서 | 배포 서명이 아니므로 결정 24 범위 안(ADR-20-08) | 확인만 |
| J-16 | 컨텍스트 투영 ID 접두사 | `cp`(`cx`는 연결 ID) | 12 |
| J-17 | `HELM_*` 환경 변수 금지(18 R-2)와 13의 `HELM_RUN_ID` 주입 | 도구 환경에는 `HELM_RUN_ID`처럼 비밀이 아닌 허용 목록 변수만 넣는다. 18이 허용 목록을 정한다 | 13, 18 |
| J-18 | 판단 승격의 출처 독립성 | 10 §3.9 규칙(08 `promotionMissing` + 출처 독립성 + 사후 선언 제외)이 정본 | 08, 15 |
| J-19 | 숫자 confidence | 저장도 표시도 하지 않는다. 15의 질적 지지 등급(`untested`/`weak`/`consistent`/`confirmed`/`contested`)과 14의 질적 확신 등급 | 08, 21 |
| J-20 | 이의 사유 | 선택 입력 | 11, 05 |
| J-21 | Goal·Concern 화면 이름 | 영어 그대로(03 A1). 2주 사용 뒤 재검토 | 25 |
| J-22 | 월 모델 비용 상한 | 설치 때 묻고, 답이 없으면 USD 50 [가정, 사용자 확인 대기] | 01, 12 |

## 4. 사용자 결정 41~43의 반영 담당

| 결정 | 반영 |
|---|---|
| 41 React 19, 부품 직접, 글래스모피즘 | 21(전면 개정: Caustic React 부품 미사용, Radix 등 헤드리스 + 자체 부품, 글래스모피즘 시각 언어, 최근 에이전트 클라이언트 참고 [검색]), 20(React 19, 의존 버전), 06(스택), 24(ADR) |
| 42 휴대폰에서 답하기 | 새 문서 26(P15), 01(범위·단계), 02(UC-04 모바일 경로), 03(화면 범위), 05(알림), 06(배치), 18(모바일 기기 인증), 19(모바일 클라이언트·푸시), 20(공유 코드) |
| 43 Caustic 토큰 복사, neutral 단계 축소 | 21(토큰을 `apps/desktop`(또는 공유 UI 패키지)에 복사, 의존 없음, neutral 단계 재정의 표, NOTICE에 출처) |

## 5. 사람 작업과 홈랩 변경 요청 (사용자 보고 대상)

- 홈랩: H-1 `serve.table`에 `8448 http://127.0.0.1:7840 helm`, H-2 restic이 `/srv/volumes/helm/backups`를 넣도록, H-3 제외 목록, H-4 `ctx-lint`, H-5 Caddy 관리 API(127.0.0.1:2019)가 인증 없이 Windows 프로세스에도 응답함(보안 정리 필요).
- 사람: `~/projects/helm/PRODUCT.md`와 `secrets init`, `secrets edit prod`(모델 키, `HELM_LEDGER_HMAC_KEY`), `sudo apt install bubblewrap`.
- 확인 필요: dotfiles `.stignore-dev`에 Cargo `target` 제외 추가 여부(20은 `CARGO_TARGET_DIR`로 우회).

## 6. 2a 중 추가 판정

| 번호 | 쟁점 | 판정 | 고칠 문서 |
|---|---|---|---|
| J-23 | 질문 하나에 담긴 여러 기준의 결정 조작 수 (02 UQ-11 대 03 §3.7 "기준당 1회") | 02 쪽: 질문 하나에 담긴 기준들은 결정 1회 | 03 |
| J-24 | UC-07 A5에서 I를 건너뛴 Concern의 거절 | 직전 I가 없으면 사용자가 C 또는 I를 고른다 | 14 U-26 |
| J-25 | 충돌·게이트 결과의 기록 (10: 결과만 저장, 09: `command.rejected`도 남김) | 09: 거부·충돌·게이트 모두 `command.rejected` 이벤트로 남긴다(A14) | 10 |
| J-26 | 11의 질문 종류·레코드 이름(`wa`, `rw`, ApprovalToken, Contest) | 08 §10.2 대응대로 통일 | 11 |
| J-27 | 10 EventDraft의 구조화 authorityBasis | 09 envelope의 `<kind>:<ref>` 문자열로 저장 | 10 |
| J-28 | presence `locked` | 모바일 클라이언트만 보낸다(26이 확인) | 20, 26 |
| J-29 | 예측 결과 이름 | 08 `indeterminate` | 10 |
| J-30 | 이의 이벤트 이름 | 09 `objection.filed`(`contest.filed` 쓰지 않음) | 04, 19 |
| J-31 | 알림 문구 저장 형식 (11 문구 키 대 20 완성 문장) | 문구 키로 저장, 앱이 `@helm/ui-language`로 문장을 만든다 | 20 |
| J-32 | Run 진행 단계(stage) 위치 | 09 trace 유지(같은 트랜잭션, 도메인 상태는 이벤트만으로 재구성) | 12 |
| J-33 | 1판 이벤트 이름 잔존 | 09 §5.2·08 §10.3 대응표대로 10·11·12·13·14·19가 일괄 교체 | 10, 11, 12, 13, 14, 19 |
| J-34 | 고르기만 한 라운드를 닫을 수 있는가 (21 대 15) | 15: 사람이 명시하면 닫히고 다음 라운드에 세 개 비교를 넣는다 | 21 |
| J-35 | 결과 확인 값 표기 (08 기록 값 대 10 명령 값) | 둘 다 유지, 08 §10에 대응 한 줄 | 08 |
| J-36 | 이의 대상 형식 (19 `criterionVerdict` 대 08 `itemKey`) | 08 형식(`record` + `itemKey`, `link`) | 19 |
| J-37 | 휴대폰에서 결과 확인 범위 | 03 §3.12 안(결과 확인·수정 요청만). 26이 다르게 정하면 26을 따르고 03을 맞춘다 | 26 |
| J-38 | 사람 대기 뒤 이어가기 | 12 방식(`ended(handed_off)` + 같은 thread 새 run). 08은 `run.resumed`·awaiting 재진입 제거 | 08 |
| J-39 | 부팅 때 `awaiting_*` run | 그대로 둔다(늦은 답 수용). 09 `runsToInterrupt`에서 제외, 08 전이 출발 상태 수정 | 08, 09 |
| J-40 | 승인된 행동 실행 | 같은 tcId(`toolcall.approved` → started, `approval.consumed`) | 12 |
| J-41 | replay 시점 | 재개 때 커널 재검사를 통과한 뒤 `toolcall.replay_started` | 09 |
| J-42 | 판정 결과에 따른 trace | 09 commit이 traces 콜백 허용 | 09 |
| J-43 | 제안 도구 호출 기록 | primitive=null 도구는 requested·started·completed를 한 트랜잭션에, 관찰 없음. `toolcall.completed.observationId` Nullable | 08, 09, 12, 13 |
| J-44 | 로컬 쓰기 결과 불명 | 08 §3.22.14 구분(interrupted는 질문 없음, outcome_uncertain은 recovery 질문) | 12 |
| J-45 | 격리 가림 목록 | `/srv/volumes/helm/data` 명시(S1b는 InaccessiblePaths) | 13 |

12·13 ↔ 08·09 상세 대조표: `.helm-design-work/coordinator/align-12-13-vs-08-09.md` (A: 08·09 반영 21건, B: 12·13 이름 수정 43건).
| J-46 | presence 기록 | 09: 상태가 바뀔 때만 영속 `presence.changed`. 11 ADR-A7 뒤집음 | 10, 11 |
| J-47 | 사람의 질문 조작 | 08·09 이벤트(`question.deferred`·`delegated`·`reframe_requested`·`seen`). 11 AnswerValue에서 delegate·reframe 제거 | 11 |
| J-48 | 승인 토큰 | 08 `Question.approval` + 09 `approval.*`. 11의 24시간은 `approval.expiresAt` | 11 |
| J-49 | 권리 질문 시간 만료 | 없음(11, 브리프 C10). 08·09의 deadline은 "사람이 정한 경우만" | 08, 09 |
| J-50 | 질문 병합 | 09 `question.updated` | 11 |
| J-51 | 묶음 전달 이벤트 | 09: `delivery.planned`와 질문별 이벤트 모두 | 11 |
| J-52 | `question.delivered` 값 | urgency는 11의 `interrupt`/`notice`/`digest`. 09의 전달 경로 필드는 `channel`, 11의 표시 방식 배열은 `surface`. 문구는 키(J-31) | 09, 11, 20, 26 |
| J-53 | Objection 바라는 처리 | 08 `desiredEffect: reopen|ask_next_time|note_only`. revert는 reopen + 재작업 | 10, 11 |
| J-54 | reworkOf | 08 형식(cause `ct|qs|ac`, 가정 무효는 qs) + 선택 필드 `steps` 추가 | 08, 11 |
| J-55 | 질문 종류 `goal_achievement` | 08에 추가 | 08, 10 |

10·11 ↔ 08·09 상세 대조표: `.helm-design-work/coordinator/align-10-11-vs-08-09.md`.
| J-56 | `tools`가 `@helm/agent`를 import하는 문제 | `tools`는 `@helm/vendor-pi-tools`의 타입 재export를 쓰고, REPL의 `runToolCall`은 12가 주입. 06 의존 표 유지 | 13 |
| J-57 | 모델 키 읽기(12 §3.3.4) | 결정 45: `CredentialStore`가 데몬 `SecretStore`를 읽는다. 환경 변수 방식은 일회성 레시피·테스트만 | 12 |
| J-58 | 실행 전 거부 reason | 09 `toolcall.not_executed.reason`에 `unknown_tool`, `invalid_args`, `truncated_response` 추가(J-40 대조표 A와 같음) | 09 |
| J-59 | `refreshing` 중 결정 허용 (04 허용 대 21 막음) | 04: 허용. 경합은 3004 거부로 처리 | 21 |
| J-60 | 21 `ConnectionUiState`와 04 사용자 상태 | 21에 `safe_mode` 추가. 키체인·SSH·다른 서버 사유는 배너 문구로 구분 | 21 |
| J-61 | 모바일 PWA 인증과 APP-D02 | 데스크톱은 그대로. 모바일 인증은 18·19·26이 정한다 | 18, 19, 26 |
| J-62 | 19 `TransportFailure`의 SSH 차단 사유 | `blocked` 종류 추가(자동 재시도 중단) | 19 |
| J-63 | 작업 경계 enum | 일곱 값(round_end, workunit_end, loop_transition, concern_waiting, user_return, review_window, daily_rollover) | 09 |
| J-64 | presence (14 C14-2 재제기) | J-46 유지: 상태가 바뀔 때만 영속 `presence.changed`(전달 판정 재현 가능). 14·11·19는 J-46에 맞춘다 | 11, 14, 19 |
| J-65 | 모델의 루프 전환 | 선언 도구 방식(ADR-14-11). 1차 런타임은 M 채널 `loop.transition` 도구를 노출하지 않는다 | 10, 13 |
| J-66 | 진입 문턱·`dial.set` R 행 | 진입 문턱은 01의 고정 2. 10의 `dial.set` R 행 삭제 | 10 |
| J-67 | 부팅 무결성 실패 시 모드 | 17의 `read_only`(이벤트 없음). 안전 모드(`safeMode`)는 크래시 루프 전용 | 09 |
| J-68 | 단위·관리 명령 이름 | `helmd.service`, `helm ops verify`, `helm export` (06 §3.16) | 09 |
| J-69 | `secrets.required` 기본값 | `HELM_LEDGER_HMAC_KEY` 필수 | 06 |
| J-70 | 관찰 자식 격리 | 16 fork 방식 기본. 격리를 켤 때만 일회성 서비스 단위 + 표준 입출력 IPC | 16 |
| J-71 | 푸시 토큰 원문 | 08·09·26이 소유하는 운영 테이블에 원문(도메인 이벤트 밖), Device에는 해시 | 08, 09, 26 |
| J-72 | sshd `PermitOpen` 축소 | 하지 않는다(사용자 다른 포워딩 영향) | — |
| J-73 | bubblewrap | 구현 시작 전 사용자에게 설치 요청(사람 작업 목록에 이미 있음) | 23 |
| J-74 | 정책 제안마다 권리 질문 (10) | 만들지 않는다. 채택 명령 자체가 사람의 결정 | 10 |
| J-75 | 정책 제안 기각 이름 | 08·09 `policy_proposal.dismissed`, 범위 `family_forever` | 10 |
| J-76 | 08 `HumanOpMeta.onNormalPath`의 뜻 충돌 | 01의 정상 경로는 이벤트 종류로 계산. 08 필드는 `followedRecommendation` 등 뜻에 맞는 이름으로 바꾼다 | 08, 16 |
| J-77 | 09 `source_cursors` 위치 | 관찰 캐시(observer.db)에 둔다. 정본 DB에서 제거 | 09, 16 |
| J-78 | 복귀 점검 메서드 이름 | `resumptionCheck.*` (J-10) | 19 |
| J-79 | 낡음 검사 위치 | 09: 커널이 decide 안에서 `basisSeq`와 대상 `revisionSeq`를 비교. 10 `CommandEnvelope`에 `basisSeq` 추가 | 10 |
| J-80 | presence (19 재제기) | J-46·J-64 유지 | — |
| J-81 | 페어링 실패 사유 표시 | 18: 구분하지 않는다("코드가 틀렸거나 만료됐습니다") | 04, 05 |
| J-82 | 브라우저 전송의 토큰(`helm-bearer.` 하위 프로토콜) | 18이 수용 여부를 정한다. 데스크톱(Rust 전송)과 네이티브 모바일은 헤더 | 18, 26 |
| J-83 | 20의 1단계 연결 이름 | 20은 19의 `HelmClient` 사건 이름으로 맞춘다 | 20 |
| J-84 | 감사 깊이 열람 표시 | `presence.report.depth` 필드("#audit" 접미 쓰지 않음) | 16, 20 |
| J-85 | UI 부품 패키지 분리 시점 | 21: 처음부터 `@helm/ui-tokens`·`@helm/ui`(플랫폼 중립). 셸만 `apps/desktop` | 06, 20 |
| J-86 | shadcn 소스 복사 | 결정 41의 "부품 직접 제작"에 포함된다고 본다(복사 후 Helm 소유 코드) [제안, 사용자 보고] | — |
| J-87 | macOS 웹뷰 기준 Safari 18 | 유지. 실제 Mac 버전은 확인 대기(Mac 잠듦, 사용자 보고) | 20 |
| J-88 | Caustic 라이선스 표시 | Helm NOTICE에 출처 기록. Caustic 저장소 LICENSE 추가는 사용자 판단 [사용자 보고] | — |
| J-89 | 가벼운 작업의 결과 확인 (10 V-POL-01 대 J-01) | MVP는 한 화면 확인만. 정책으로 결과 확인을 닫는 것은 2단계 이후 검토(01 OQ-15 (a)) | 01, 10 |
| J-90 | R-OP-2(a) 사람이 고른 선택 범위 안 echo 활성 | 10에 활성 경로, 09에 이벤트 추가 | 09, 10 |
| J-91 | 08 `sendTargets`의 권리 게이트 우회 | MVP에서 send는 언제나 권리 게이트(01 NFR-S-7) | 08, 10, 14 |
| J-92 | 금지 자원 거부 갈래 (P1이 `denied.forbidden_action` 재제기) | §1 유지: 내용 갈래 `policy.forbidden_resource` | 10 |
| J-93 | 경계 명령 이름 | `runtime.boundary` (10 정본). 12의 `boundary.reach`, 14의 혼용을 고친다 | 12, 14 |
| J-94 | 설정 변경 기록 | 09에 `setting.changed`(governance 범주) 추가 | 09 |
| J-95 | 사람의 확인 순서 고정 | 09 `check.pinned`, 08 구분 확인에 `pinned` 필드 | 08, 09 |
| J-96 | 승인 뒤 실행 run | 승인된 도구 호출은 같은 tcId로 새 run(같은 thread)에서 실행한다(J-38 + J-40). 12 §3.13에 명시 | 12 |
| J-97 | 탐구 엔진 단계 run 종류 | 08·12 `RunKind`에 `inquiry` 추가(work run 자동 재개·투영 규칙 미적용) | 08, 12 |
| J-98 | REPL 작업 공간 | 15: 파일 작업 공간(비정본), 전역 이름 `helm.wsGet`/`wsPut`/`wsList`/`wsDel`. pi `store`는 쓰지 않는다 | 13 |
| J-99 | 라운드가 닫힌 뒤 도착한 반응 | 기록하되 그 라운드 마감 판정에는 쓰지 않는다(08 R-38) | 05 |
| J-100 | 21 "near만 있으면 마치기 비활성" | J-34와 같음: 버튼은 열고 05 §3.2.5 확인 단계를 거친다 | 21(반영됨 확인) |
| J-101 | 인스턴스 잠금 함수 위치 | `@helm/store/admin`(SQLite 드라이버 import는 store 하나, R6) | 17 |
| J-102 | 설정 리스너 키 | `loopback`(`ssh` 아님). 환경 변수 이름은 유지 가능 | 17 |
| J-103 | 문구 사전 위치 | `@helm/ui-language`(21 앱 안 `copy/` 철회) | 21 |
| J-104 | 루프가 바로 거부한 호출의 기록 | 10 `toolcall.skip`이 `core`와 함께 받아 `requested`·`not_executed`를 같이 남긴다 | 10 |
| J-105 | 제안 종류 대응 표 차이(10 §3.11.11(3) 대 14 §3.5.6: situation_summary, watch_sample, perspective, consequence) | 14를 따르고 10 표를 고친다. 13은 10 표로 생성 | 10, 13 |
| J-106 | write·edit replay 기본값 | 해시 guard가 있을 때만 `safe`(13안) | 07 |
| J-107 | 사고(thinking) 스트림 | 기본으로 보내지 않는다. 개발 화면 설정으로만 | 19 |
| J-108 | 초안·검증 작업 트리와 S1b의 `/srv/volumes` 가림 | 초안·검증 실행은 S1(bwrap)에서만. 18에 예외 기록 | 18 |
| J-109 | 모델 연결 끊김 | 도메인 관찰로 만들지 않는다. trace와 17 상태 확인, run은 `model_unreachable`로 끝나고 회복 뒤 14가 다시 요청 | 01 |
| J-110 | `presence.update` 발신 | 19·17의 연결 계층. 12는 읽기만 | — |
| J-111 | 이의 메서드 이름 | `objection.file`(`contest.file` 쓰지 않음) | 19 |
| J-112 | OPD+C 의무 ID와 관찰 지표 ID 충돌(`obs.*`) | 14 쪽을 `opdc.*`로 | 14 |
| J-113 | 접두사 `or` | 08에 추가 | 08 |
| J-114 | 질문 상태 `delegated` 화면 라벨 | "에이전트에게 맡김" | 03, 05 |
| J-115 | "복구 판단"/"복구 모드" | "복구 선택" / "읽기 전용"("판단"은 Finding 전용) | 02, 03, 04, 05, 20, 21 |
| J-116 | Grant 화면 이름 | "맡겨 둔 권한", 비상 Grant는 "비상 합의" | 03, 05 |
| J-117 | 고쳐서 허락(`approve_edited`)한 호출 | 새 toolCallId(원 호출 참조)가 승인을 1회 소진. 그대로 허락은 같은 tcId(J-40) | 11, 12 |
| J-118 | 모바일 결정 반영(결정 47~49) | 18·19는 26을 따른다(쿠키 토큰, Web Push, `locked` 미전송) | 18, 19, 11 |

## 7. 검증 1차 뒤 판정 (4단계, 2026-10-12)

검증 1차 지적 가운데 검증자끼리 수정 방향이 다르거나, 결정 해석이나 문서 사이 설계 선택이 필요한 것을 판정한다. 선택지와 근거는 `.helm-design-work/coordinator/stage4/rulings-needed.md`의 K 번호 항목에 있다. 표의 "K"는 그 번호다.

| 번호 | K | 쟁점 | 판정 | 고칠 문서 |
|---|---|---|---|---|
| J-119 | K-01 | presence 값 체계 | 09 값(active/idle/hidden/offline)을 저장 값으로 둔다. 부재(away)는 14 §3.13.8 파생 함수로 계산하고, 기기 종류별 문턱(휴대폰 active 2분, 데스크톱 5분)을 그 함수의 입력으로 적는다. `urgencyOf`, 푸시 계획, 복귀 판정은 모두 이 함수를 쓴다. `locked`는 뺀다(J-118) | 09, 10, 11, 14, 19, 26 |
| J-120 | K-02 | 가정 확정 뒤 도착한 답 | 3008로 거부한다. 응답에 확정된 값(`assumedValue`)과 다음 행동 "이의로 보내기"를 싣는다. 화면은 쓰던 답을 이의 초안으로 넘긴다. 08 전이와 11 §3.6.4의 늦은 답 처리를 지운다. 09 EVENT_META에 `question.assumed`의 bumpsRevision을 명시한다 | 08, 09, 10, 11, 19, 02, 04, 26 |
| J-121 | K-03 | `approve_edited`의 toolCallId | J-117을 유지한다. 새 tcId는 원 tcId와 질문 id에서 결정적으로 만든다. 원 호출을 `denied(edited_by_human)`로 닫는 일과 새 호출의 intend를 한 트랜잭션에 둔다. 새 호출에 `editedFrom`을 둔다 | 08, 10, 11, 12 |
| J-122 | K-04 | 부팅 복구에서 결과 불명 run | 커널이 run을 이미 awaiting_recovery로 옮겼으면 run.end를 내지 않는다. 같은 배치의 REPLAY 대상은 report_unknown으로 함께 닫는다. R-43 예외에 이전 epoch run의 `run.awaiting`·`question.recorded`를 넣는다. 정상 종료 이름은 17의 `daemon_shutdown` 하나로 한다 | 08, 09, 10, 12, 17 |
| J-123 | K-05 | `result.reopen` | 쓰지 않는다. 결과 확인 전 거절·기준 틀림은 `result.accept`(decision: rejected·criteria_wrong, reopenTo)로 한다. 확인 뒤 되돌리기는 `objection.file`로 한다 | 19, 10, 04 |
| J-124 | K-06 | 합의 확정·결과 확인 경로 | 19 전용 메서드(`agreement.confirm`, `result.accept`)를 정본으로 한다. 두 질문 종류로 오는 `question.answer`는 `policy.answer_option_not_allowed`로 거부한다. `bundled`는 19 params에 더한다 | 08, 10, 11, 19 |
| J-125 | K-07 | 조건부 확인 조건 항목 | 결과 확인 조작이 같은 트랜잭션에서 조건 항목을 deferred(revisitTrigger = 조건 문장)로 둔다. 조작 2회 상한(AC-07-09)을 유지한다 | 01, 02, 08, 10 |
| J-126 | K-08 | 반영 범위 합의 | `result.accept`에 `integrationAgreement?`를 둔다(결과 제출 때 에이전트 초안, 결과 확인 화면에 구조 값으로 보임). accepted·conditional이면 같은 트랜잭션에서 `agreement.confirmed`(via 결과 확인)를 낸다. 04는 반영 범위를 접지 않는다 | 04, 08, 10, 14, 19 |
| J-127 | K-09 | 런타임의 정본 읽기 | 06에 `RuntimeStorePort`(조회, 커널 스냅숏, trace, blob, 커서, 운영 테이블 upsert)를 둔다. 타입은 domain, 구현은 engine이 맡아 주입한다. runtime → store import 금지를 유지한다 | 06, 12, 23 |
| J-128 | K-10 | 오케스트레이션 순수 코어 위치 | `@helm/kernel/orchestration`에 둔다. 대상은 15의 순수부(planRound, roundClosable, 탐구 투영)와 14 순수 코어다. 06에 "I/O 없는 함수만"을 적는다 | 06, 14, 15, 23 |
| J-129 | K-11 | 투영 갱신 실패 | 롤백한다(09 D09-5). 반복되면 17이 읽기 전용(사유 `projection_fault`)으로 바꾸고 사람이 rebuild한다. 10의 degraded 유지 문장을 지운다 | 09, 10, 17 |
| J-130 | K-12 | Goal retired 뒤 합의 | V-POL-02에 Goal 상태 조건과 `policy.goal_not_active`를 더한다. 화면은 접힌 Goal 아래 합의를 주의 항목으로 보인다. 22 AX-01(b) 기대 코드도 이것이다 | 10, 19, 04, 22 |
| J-131 | K-13 | 사실 탐구 뒤 방향 선택 질문 | 권리 게이트로 한다. 맡기기는 사람이 명시적으로 고르면 허용한다 | 01, 03, 04, 10 |
| J-132 | K-14 | 막지 않는 권리 게이트 전달 | 기록은 즉시 한다. 전달은 다음 작업 경계 또는 검토 창에 한다. 가정 확정은 하지 않는다. 가벼운 작업 결과는 묶어 확인하고 주의 비용을 낮춘다. 홈에서는 접고 개수를 보인다(01). 막는 권리 게이트는 즉시 전달한다. 휴대폰 푸시는 결정 48(`interrupt`와 `notice`)을 따른다 | 01, 03, 04, 10, 11, 14, 26 |
| J-133 | K-15 | R-OP-2(a) 선택 범위 안 echo 활성 | J-90을 유지하고 V4 조건을 붙인다. 선택지에 구조화 `scope: Scope`를 둔다. 근거는 사람이 직접 고른 선택만이다(가정 확정·맡기기 제외). 질문 화면은 그 Scope를 커널 값으로 보인다. 커널은 합의 범위 ⊆ 선택 범위를 검사한다 | 01, 08, 09, 10, 14, 04 |
| J-134 | K-16 | 네트워크 허용 실행 격리 | 1차부터 네트워크 네임스페이스를 분리하고 데몬 쪽 CONNECT 프록시를 둔다(루프백·사설·CGNAT·tailnet 차단). 23에 스파이크를 두고, 실패하면 네트워크 허용 실행을 실행마다 사람 승인 + 홈랩 H-5 선행으로 한다 | 13, 18, 23 |
| J-135 | K-17 | 같은 uid localAdmin의 사람 결정 | local 리스너의 사람 결정은 TUI 또는 TTY CLI에서 확인 문자열을 넣은 경우만 받는다. 비대화 localAdmin은 읽기와 관리만 한다. 의도적 공격은 막지 못한다는 한계를 18에 적는다 | 18, 19, 17 |
| J-136 | K-18 | 다이얼 층 | 08 `DialLayer`는 저장 층으로 둔다. 14의 해석 순서는 `DialPrecedence`로 이름을 바꾸고 대응을 적는다. Goal 범위 다이얼은 두지 않는다(19·03·20에서 지운다) | 08, 14, 19, 03, 20 |
| J-137 | K-19 | 휴대폰 요약 확인 | 휴대폰 확인에 `compact: true`를 싣는다. 줄여 본 반대 근거·이견 항목은 다음 데스크톱 요약에 "휴대폰에서 줄여 본 항목"으로 남긴다 | 26, 04, 19 |
| J-138 | K-20 | UC-13 범위 | 재결정 질문 규칙(사람이 정한 선택이 review_trigger로 낡으면 질문)은 MVP에 넣는다. 측정 Trigger 자동 판정은 2단계로 둔다 | 01, 02, 08, 10 |
| J-139 | K-21 | 휴대폰 결과 확인 | 산출물(본문·이미지·변경 요약)을 연 뒤에만 accept를 받는다. 큰 산출물과 취향형은 데스크톱 전용으로 하고, 휴대폰에서는 미루기를 둔다 | 26, 04, 05 |
| J-140 | K-22 | UC-03 push | 02 유즈케이스를 고친다. 작업 브랜치 push는 묻고 실행한다(send 권리 게이트, J-91). 범위에 `net:<origin>`과 send 대상을 둔다 | 02 |
| J-141 | K-23 | 원함 탐구 질문의 고르기 금지 | I.want에서 답이 자극·가능성 id를 가리키는 질문은 V-Q-03에서 거부한다. 15 E18-2 검사를 더하고 05 예시를 바꾼다 | 10, 15, 05, 21 |
| J-142 | K-24 | 데몬 정지 중 지난 가정 만료 | 정지 시간이 만료 여유보다 길면 만료를 "복귀 + 30분"으로 미룬다. 기본은 켬이고 다이얼로 끌 수 있다. 막지 않는 질문만 대상이다 | 10, 11, 12, 14 |
| J-143 | K-25 | 루프별 전달 기본값 | D-10·D-11을 14 resolveDials 유효값 하나로 판정한다. A 루프 층 1의 기본값은 협상(대화 [125] 사용자 동의)으로 한다 | 11, 14 |
| J-144 | K-26 | [결정] 표시 | [결정]은 사용자 결정 번호에만 쓴다. 조정자 기본값은 `[제안: 결정 n 기본값]`, 조정자 판정은 `[판정 n]`(브리프 결정 44~46) 또는 `[판정 J-nn]`으로 적는다. 19:79의 재정의를 지운다. 브리프 §5.2에 표기를 더한다 | 모든 문서 |
| J-145 | K-27 | Choice 근거 범위 | E 레코드 전반을 근거로 허용한다. 해석·전제만 근거인 선택은 품질 `structural`로 표시한다. 이유를 ADR로 남긴다 | 08, 10, 24 |
| J-146 | K-28 | 오프사이트 백업 공백 | H-2 전까지 daily 스냅샷을 `/mnt/d/backup/helm/`에 복사하는 레시피를 두고, doctor가 경고한다. 같은 NVMe라는 한계를 18 T-B1에 적는다. H-2는 사용자에게 다시 보고한다 | 17, 18 |
| J-147 | K-29 | 체인 안 인라인 비밀 | 1차는 입력 단계 마스킹(사람 명령 payload 포함)과 가림 절차(스냅샷 재생성, restic rewrite)로 대응한다. 민감 필드를 체인 밖에 두는 안은 24에 ADR 후보로 남긴다 | 18, 09, 10, 24 |
| J-148 | — (V6-002) | 단일 변경 경로 트랜잭션 | store가 동기 대화형 쓰기 트랜잭션(`store.transaction(fn)`, better-sqlite3 transaction 위)을 제공한다. `commitBatch`는 그 위의 편의 함수로 둔다. 같은 트랜잭션 안에서 KernelState는 명령마다 덧씌운 사본으로 갱신하고, 롤백하면 버린다. 13 제안 도구 경로의 뒤 제출은 앞 제출의 결과를 본다 | 06, 09, 10, 12, 13 |
| J-149 | — (T3 이의, V1-032) | OPD+C 의무 ID 형식 | J-112를 보완한다. 14 의무 ID는 `opdc:<기준>.<이름>`(쌍점 구분)으로 쓴다. 16 지표 ID `opdc.o.*`는 그대로 둔다. 22가 두 레지스트리에 같은 문자열이 없는지 검사한다 | 14, 16, 22, 25 |
| J-150 | — (V7-027, N-53) | 모델 API를 내는 쪽 이름 | 본문 "제공자", 화면 "모델 제공자", 코드 `provider`(25가 정본) | 04, 06, 07, 12, 18, 19, 22, 23, 26 |
| J-151 | — (V7-048) | 24·25 문서 구성 | 24(ADR)와 25(용어집)는 브리프 §5.3 여덟 절 대신 자기 구성을 쓰고, 여덟 절과의 대응 표를 둔다 | 24, 25, 브리프 |
| J-152 | — (V3-003, Q22-12) | 복원 뒤 부팅과 "복원 지점 이후 기록 없음" 표시 | 17이 복원을 마칠 때 복원 표지 이벤트를 남긴다(이름은 09가 정한다). 그 표지 뒤 첫 부팅은 안전 모드다(12: run 자동 재개·에이전트 타이머·관찰 실행 없음, 소진되지 않은 승인은 만료). 표시는 04가 소유하고 표지 이벤트를 읽는다 | 09, 17, 12, 04, 22 |
| J-153 | — (P5·P11 이름 차이) | 안전 모드 해제 CLI | `helm ops safe-mode off`(17이 CLI 정본). `helm ops resume`은 run 재개와 뜻이 겹쳐 쓰지 않는다 | 09, 17, 22, 26 |
| J-154 | — (06·17·26 설정 키) | 공개 주소와 허용 Origin | `publicOrigin`은 데몬의 공개 주소 하나다. `auth.allowedOrigins`는 받는 Origin 목록이고 기본값은 `[publicOrigin]`이다. `mobile.origin`은 쓰지 않는다 | 06, 17, 18, 26 |

## 8. 4b 교차 요구 충돌 판정 (2026-10-12)

4단계에서 담당들이 서로 다른 시점에 끝나 문서 사이 요구가 엇갈렸다. 서로 반대인 요구를 정본 소유 규칙에 따라 판정한다. 근거는 `.helm-design-work/coordinator/stage4b/leftover-*.md`의 "서로 반대인 요구" 절이다.

| 번호 | 쟁점 | 판정 | 고칠 문서 |
|---|---|---|---|
| J-155 | 지표 소비자 위치 | `packages/runtime/src/consumers/metrics.ts`(06 정본) | 23 |
| J-156 | 24 ADR 번호 | ADR-18-05 = 쿠키 인증(합침 → ADR-26-03), ADR-18-06 = J-134 네트워크 격리, ADR-18-07 = J-147 후보. ADR-13-06은 "합침 → ADR-18-06". ADR-08-07 행은 "합침 → ADR-10-09"(J-145) | 24, 18, 13, 08 |
| J-157 | 탐구 멈춤 | `inquiry.stop`의 `then: 'proceed' \| 'handoff' \| 'decide_now'`(10 정본). 08·09에 같은 필드를 두고 14는 이 값으로 계산한다. `decideNow` 불리언은 쓰지 않는다 | 08, 09, 14 |
| J-158 | 재작업과 합의 | 재작업 WorkUnit은 기존 합의 범위 안이면 그 합의를 다시 쓰고, 범위 밖이면 `gate.scope_expansion_required`다(11·02 방식). 08 "이어받지 않는다"를 고치고 10에 규칙을 둔다 | 08, 10 |
| J-159 | 페어링 출처 필드 | `pairedFrom`(08 정본). 09 최상위 `pairedVia` 객체와 18 `pairedBy`를 고친다. 09 `device_presence`에 `last_auth_at` 열을 더한다 | 09, 18 |
| J-160 | `toolcall.interrupted.cause` | `crash`(`run.interrupted.code`와 같음) | 09, 12 |
| J-161 | 기기 만료 타이머 | 절대 만료는 `p_timers`의 `device_expiry`. 하루 한 번 도는 유휴 만료 점검은 `runtime_timers`의 별도 목적 | 17, 18 |
| J-162 | 푸시 타이머 목적 | 26의 셋을 따른다 | 23 |
| J-163 | `plan.deviated` | 이벤트로 기록하지 않는다. 16이 `loop.transitioned`에서 계산한다. 09 카탈로그에서 지운다 | 09, 16 |
| J-164 | 안전 모드 사유 | 09의 `crash_loop`·`restored`만 쓴다. 백업으로 되돌린 경우도 `restored`다. `rollback` 사유를 두지 않는다 | 12, 14 |
| J-165 | 안전 모드 해제 | 주체는 19(`decideMobile` 기기, 대화형 `localAdmin`). 해제 이벤트는 09 `daemon.safe_mode_exited`. CLI는 J-153. 19의 수동 진입 `admin.safeMode`는 지운다 | 12, 14, 19 |
| J-166 | 방해 금지 | 의미 설정이다(`settings.update`의 `attention.snoozeUntil`, 14·19). 데몬 설정에 두지 않는다 | 11, 17 |
| J-167 | MCP 설정 이름 | 13(도구 설정 스키마 소유)의 `tools.mcp[].env`, `headersFromSecrets`, `sandbox.netHosts` | 17, 18 |
| J-168 | 쿠키 판정 함수 | `cookieAuth`(19 정본) | 26 |
| J-169 | 가짜 모델 api 값 | `faux:helm`(22) | 07 |
| J-170 | 결과 거절 버튼 | "거절(해결 안 됨)"(05가 문구 소유) | 21, 25 |
| J-171 | 시간당 알림 상한 | 사람 기준 하나, `attention.interruptsPerHour`(14 기본값), 모든 기기 합. 기기별 상한(26 `push.hourlyCap`, 20 `notifications.hourlyCap`)은 두지 않는다 | 11, 17, 20, 26 |
| J-172 | notice 푸시 조건 | 데스크톱 기기가 모두 부재(14 `isAway`, J-119)이고 휴대폰이 active가 아닐 때. "연결 기기 없음" 조건은 쓰지 않는다 | 11, 26 |
| J-173 | 휴대폰 active와 복귀 | 휴대폰이 active가 되는 것은 `user_return`이 아니다(11·14) | 26 |
| J-174 | 휴대폰 결과 확인 필드 | `mobileReviewable`(04 뷰 정본) | 21 |
| J-175 | 문구 키 타입 | `CopyKey` | 04, 05 |
| J-176 | 연결 상태 문구 키 | 접두어 `label.connection.`(05), 값 집합은 04 §3.0.4 | 21 |
| J-177 | `question.delegate` 문구 | "에이전트가 정하게 두기" | 26 |
| J-178 | 읽기 전용 사유 `recovery_failed` | 17 정본 값이다. 19 `ModeReason`, 04, 20에 더한다 | 04, 19, 20 |
| J-179 | 복원 표시 블록 | `restored{backupId, upToSeq}`(09·17·04). 12의 `restore{…}` 형식을 고친다 | 12 |
| J-180 | 수정 요청과 재작업 | 결과 확인의 수정 요청은 같은 WorkUnit을 `in_progress`로 되돌린다(08 전이). 이의로 인한 재작업은 새 WorkUnit(`reworkOf`)이다. 둘을 구분해 적는다 | 11, 16, 08 |
| J-181 | `FeatureKey` 정본 | 23 §3.5.4 표. `asking.rollbackPoints`는 뺀다 | 06, 01, 23 |
| J-182 | 파생 ID 입력 | 멱등 키에서 파생한다(10 현행) | 06 |
| J-183 | 라운드 끝 경계 제출자 | 14 오케스트레이터가 `inquiry.round_ended`에서 제출한다(작업 경계는 14만 제출) | 15, 12 |
| J-184 | 반응 "둘 다 아님" | 08 형식 `comparison{kind:'neither', pair}`(2단계 기능) | 15, 19 |
| J-185 | presence 타입 이름 | `PresenceSnapshot`(11) | 26 |
| J-186 | 정상 경로 밖 사유 코드 | 01 R-OP-4의 `correction_cycle` | 10 |
| J-187 | 23의 새 용어 | "난이도 등급", "메인 오케스트레이터", "하위 조정자", "실작업자"를 25에 등록하고, 런타임 "오케스트레이터"와의 구분을 혼동 주의 칸에 적는다 | 25 |

## 9. 사용자 결정 53·56의 세부 규격 (2026-10-14)

| 번호 | 대상 | 판정 | 고칠 문서 |
|---|---|---|---|
| J-188 | 결정 53 루프 계획 혼합 | (1) 다이얼 `planAuthoring: 'computed' \| 'hybrid' \| 'model'`, 기본 `hybrid`, 층은 user·concern(08 `DialLayer`). (2) `PlanFlags`에 `outOfPattern: Flag`(여섯 표시로 이 상황을 나타낼 수 없음, 근거 필수)를 더한다. (3) `hybrid`에서 `outOfPattern`이 참이거나 `buildPlan`에 맞는 규칙이 없으면, 모델이 계획 전체 초안(제안 종류 `loop_plan_draft`의 `steps` 형식)을 낸다. `model`이면 언제나 모델이 초안을 낸다. `computed`면 모델 초안을 받지 않는다. (4) 코드 `validatePlan`이 의존 규칙(활성 합의 전 쓰기 금지, 결과 뒤 결과 확인, 성숙도 관문 등)을 검사한다. 위반이면 사유와 함께 모델에 한 번 돌려주고, 두 번째도 위반이면 코드 계산 계획을 쓰고 그 사실을 기록한다. (5) `LoopPlanRecord`에 `authoredBy: 'code' \| 'model' \| 'human'`을 더한다. `decidedBy`, 기록과 이의(결정 8)는 그대로다. (6) 화면은 모델이 설계한 계획에 그 사실을 표시한다. (7) 16은 계획 이의 비율을 `authoredBy`별로 잰다. ADR-14-12를 이 혼합안으로 고친다 | 14, 08, 09, 10, 16, 19, 04, 05, 24, 25, 22 |
| J-189 | 결정 56 결과 확인 알림 | (1) 의미 설정 `notifications.resultReview: 'none' \| 'daily_digest' \| 'immediate'`, 기본 `none`(J-132와 같은 동작). (2) `daily_digest`: 설정 시각(`notifications.resultReviewDigestAt`, 기본 "19:00", 서버 시간대)에 확인 대기 결과가 하나 이상이면 묶음 푸시 1개(강도 notice)를 보낸다. 타이머 목적 `result_review_digest`(`runtime_timers`). (3) `immediate`: 결과 확인 질문이 생길 때마다 notice 강도로 푸시한다. (4) 두 경우 모두 방해 금지(J-166)와 시간당 상한(J-171)을 따르고, 휴대폰 확인 범위는 J-139 그대로다. (5) 설정 변경은 `settings.update`(19), 기록은 `setting.changed`(09) | 11, 14, 19, 26, 04, 05, 09, 17, 16, 22 |
| J-190 | 결정 55 도구 단계와 계약 | 근거는 `.helm-design-work/coordinator/stage4c/research-ohmypi.md`, `research-browser.md`. (1) 단계: MVP는 `web_fetch`(데몬 직접 구현, 변환은 네트워크 없는 작업자, linkedom + readability + turndown), `web_search`(Helm 함수 도구, 제공자 인터페이스, 기본 Brave·예비 Tavily, 설정 `tools.webSearch`), `grep` 확장(페이지 `skip`, 파일당 상한, 파일 간 라운드로빈, 일치 중심 줄 자르기, `paths[]`, 실행은 샌드박스 안 `rg`), 해시라인 편집(설계만 참고해 직접 구현, `RunSpec.editMode: 'replace' \| 'hashline'` 모델별 선택, 기본 `replace`, 짧은 태그는 모델용 별칭이고 실제 guard는 sha256, 낡은 태그 자동 복구 없음). MVP 후반은 `browser_*`(`helm-browserd`: Node + playwright-core, S1 + 프록시 네임스페이스, CDP 파이프, 비밀 없음; 읽기 전용 먼저, 다음에 클릭·입력과 요청 가로채기). 이후 1차는 `computer_*`(실행마다 새 Xvfb, 세션 단위 승인, `externalEffect: uncertain`), `ast_grep`/`ast_edit`, LSP. 하지 않음: Windows 호스트 조작. Stagehand와 oh-my-pi는 의존성으로 쓰지 않는다(Stagehand는 Helm 모델 어댑터를 거칠 수 있을 때만 선택 확장). (2) 네트워크: 08 `ResourceScope.net`에 `net:public`(공개 인터넷 전체, 루프백·사설·CGNAT·tailnet 제외)을 더한다. 외부 탐색은 막지 않는다(결정 55). (3) 외부 효과: 브라우저의 비-GET 요청·업로드·합의 밖 호스트 이동은 browserd 요청 가로채기에서 잡아 send(권리 게이트)로 올린다. 웹 내용을 본 run은 `taint.web`을 달고, 이후 send는 언제나 사람에게 묻는다(J-91과 같은 방향). (4) 투영: 웹·브라우저 출력은 신뢰 불가 표식으로 감싸고, 스크린샷은 최근 3장만 남긴다. (5) Anthropic 서버 측 web_search·web_fetch 도구와 툴셋 판 이름(`browser_toolset_*`, `computer_toolset_*`)은 [검색] 수준이라 구현 전에 확인한다. 서버 측 도구는 MVP에서 쓰지 않는다. (6) 사람 작업: `bubblewrap`(필수), `fonts-noto-cjk`(권고), 컴퓨터 사용 단계의 `xdotool`·`openbox`·`x11-utils`·`scrot`, 비밀 `BRAVE_SEARCH_API_KEY`(필수)·`TAVILY_API_KEY`(선택). (7) 23에 스파이크: S1 안 Chrome, netshim 경유 성능, 요청 가로채기 누락(sendBeacon·keepalive·서비스 워커), Brave 약관의 결과 저장 조항, 변환 품질(한글), Chrome 실제 메모리, 해시라인 대 replace A/B | 01, 06, 07, 12, 13, 18, 22, 23, 24, 그리고 08·09·10·17·04·05·16·19·25(5차 소규모) |

## 10. 4c 묶음 보고의 판정 (2026-10-14)

근거는 `.helm-design-work/coordinator/stage4c/group-*.md`, `done/*.md`, `pending-rulings.md`다.

| 번호 | 쟁점 | 판정 | 고칠 문서 |
|---|---|---|---|
| J-191 | 14 §4.3 진입 조건 거짓의 거부 코드 | `policy.loop_entry_condition`(10에 더한다) | 10, 14 |
| J-192 | `planAuthoring` 노출 시점 | MVP 설정 화면에서 고른다(결정 53 "설정으로 고를 수 있다"). 01 MVP 다이얼 목록에 더한다 | 01, 03, 04, 14, 21 |
| J-193 | 승인 대기 호출의 만료 | `awaiting_approval → not_executed(approval_expired)`를 08 전이로 둔다 | 08, 10, 12 |
| J-194 | `[결정 n]` 표시 범위(J-144 보완) | 사용자 결정은 브리프 결정 가운데 조정자 기본값(26~32·34·36·37)과 조정자 판정(44~46)을 뺀 나머지다. 결정 1~25, 33, 35, 38~43, 47~57의 `[결정 n]`은 그대로 둔다 | 모든 문서 |
| J-195 | 조용한 시간 키 | `attention.quietHours`(14 의미 설정, J-166의 `attention.snoozeUntil`과 같은 묶음). `notifications.*`는 알림 경로 설정(`resultReview` 등)만 | 04, 14, 19, 20, 26 |
| J-196 | 연결 상태 값과 문구 키(J-176 보완) | 값 집합과 표기는 04 §3.0.4(camelCase). 21 `ConnectionUiState`도 같은 값. 문구 키 접두어는 `label.connection.` | 05, 20, 21 |
| J-197 | 데몬 정지 중 가정 만료 미루기(J-142)를 끄는 장치 | 다이얼 `assumptionDeferOnDowntime`(14 resolveDials) | 11, 14, 19 |
| J-198 | 시간당 상한을 넘은 알림의 묶음 | 데몬이 만든다(14 §3.13.5). 앱은 받은 묶음을 그대로 보인다 | 05, 20 |
| J-199 | 트레이의 방해 금지 표시 | 19 `TrayView.dnd{on, until}`. 20은 이 형식을 쓴다 | 20 |
| J-200 | 탐구 렌즈 고정 명령 | 10이 정한 명령 이름을 15·19가 따른다 | 15, 19 |
| J-201 | `question.delegate`의 대상(J-131 보완) | 정보 게이트, 그리고 사실 탐구 뒤 방향 선택 권리 게이트(J-131)에서 사람이 명시적으로 고를 때만. send·범위 확장·결과 확인 권리 게이트는 맡길 수 없다 | 10, 19, 04, 05 |
| J-202 | 안전 모드 비정상 종료 정보 | 17 `safeMode.recentUncleanBoots`(목록)가 정본. 19는 이 목록을 싣는다(개수는 화면이 계산) | 19 |
| J-203 | 휴대폰에서 결과 확인 불가 거부 | 10에 `policy.mobile_review_not_allowed`를 둔다. 19는 이를 결과 코드에 대응시킨다 | 10, 19 |
| J-204 | `authoredBy: human` 화면 이름 | "직접 고친 계획". 모델 설계는 "에이전트가 설계한 계획", 코드 계산은 표시하지 않는다 | 04, 05 |
| J-205 | 합의에 웹 부여가 없는 run의 외부 탐색 | `net:public` 읽기(`web_search`, `web_fetch`, 브라우저 읽기)는 합의 부여 없이 기본 허용한다(결정 55). 외부 효과(send)는 권리 게이트 그대로 | 08, 10, 13, 18, 01 |
| J-206 | `externalEffect` 값 | `boolean \| 'uncertain'`. `uncertain`은 send와 같이 권리 게이트를 거친다(컴퓨터 사용) | 08, 10, 13 |
| J-207 | 검색 질의 전송 | send로 보지 않는다(읽기). 질의는 비밀 가림(`queryMasked`)을 거치고, `taint.web`과 무관하게 허용한다 | 13, 18 |
| J-208 | 브라우저 1단계의 비-GET | 읽기 단계는 거부(`policy.forbidden_resource`), 조작 단계는 요청 가로채기에서 send로 올린다 | 13, 01 |
| J-209 | 합의 밖 이동으로 보는 질의 문자열 길이 | 2 KiB(18 정본) | 13, 18 |
| J-210 | 네트워크 중계 이름 | 네임스페이스 안 중계 `helm-netshim`, 데몬 쪽 프록시 `helm-egress-proxy`. `helm-netbridge`는 쓰지 않는다 | 12, 13, 17, 18 |
| J-211 | `ActionDescriptor.network` | `'none' \| 'proxy'`. 네트워크는 언제나 프록시를 거친다. `any`는 쓰지 않는다 | 12, 13, 18 |
| J-212 | MCP 설정 이름 | J-167 그대로(13 이름). 17·18이 고친다 | 17, 18 |
| J-213 | 송신 승인 대기와 브라우저 세션 수명 | 브라우저 행동이 승인을 기다리면 세션 유휴 타이머를 멈추되 최대 30분. 넘으면 그 승인 요청은 `approval_expired`로 닫히고 다시 해야 한다 | 11, 12, 13 |
| J-214 | 배치 중단 사유 | 08 `NotExecutedReason`에 `batch_stopped`를 더한다 | 08, 12 |
| J-215 | `taint.web` 범위 | run 단위에 더해, 같은 thread로 넘긴 새 run과 하위 run이 물려받는다(12 방식) | 08, 09, 10, 12 |
| J-216 | `helm-browserd` 위치 | 별도 패키지 `packages/browserd`(별도 프로세스, playwright-core 의존을 도구 패키지에서 떼어 둔다) | 06, 23 |
| J-217 | 생성물 방식 | 06 방식(커밋 후 `--check`). 26이 맞춘다 | 26 |
| J-218 | 모델 메시지 내용 타입 | `TextContent`·`ImageContent`는 `@helm/domain/model`(08)에서 받는다. Rust 크레이트 고지는 `just licenses` | 07, 13, 20 |
| J-219 | 새 이름 | 4c 보고의 "새 이름 요구"는 기존 이름과 겹치지 않으면 받아들인다. 오류 코드는 10·19, 이벤트·타이머 목적은 09, 레코드 필드는 08에 정본으로 등록하고 25에 올린다 | 08, 09, 10, 19, 25 |
| J-220 | 22 SG 시험과 13 safeGit | 22 SG 시험은 13 §3.5.7이 실제로 부르는 git 명령으로 판정한다(13이 쓰지 않는 `status`·`add -A`는 시험 대상에서 뺀다) | 22 |

## 11. 4d~W5 하위 조정자 판정 (2026-10-14)

근거는 `.helm-design-work/coordinator/stage4d/done/*.md`의 "판정 필요"다. 이름·참조·정본 소유로 정해지는 것만 판정했고, 제품 동작을 바꾸는 것은 `stage4d/user-questions.md`에 모았다.

| 번호 | 쟁점 | 판정 | 고칠 문서 |
|---|---|---|---|
| J-221 | 다이얼 키 형식과 개수 | `planAuthoring`(J-188)과 `assumptionDeferOnDowntime`(J-197)은 이름을 그대로 쓰고 점 표기 예외로 25에 적는다. 08 `DIAL_KEYS`가 정본이며 `assumptionDeferOnDowntime`을 더해 20개다. 14·25·11의 다이얼 개수 문구("열다섯" 등)를 08에 맞춘다 | 08, 11, 14, 25 |
| J-222 | 규칙 번호 R-16 충돌 | 08 R-16(`objection.filed`)을 유지한다. 10의 "결과 제출 뒤 관찰" 규칙은 10 안에서 쓰지 않은 다음 번호로 바꾸고, 이를 인용한 문서도 맞춘다 | 10, 08 |
| J-223 | `ManualClock` 정본 | 22 §3.5.2(06 §3.4.14 testkit 공개 API)를 정본으로 한다. 12 §6은 자체 정의를 두지 않고 22를 인용하며, `Clock` 인터페이스는 12가 유지한다 | 12, 22 |
| J-224 | `toolcall.denied`의 `cancel` | 08 §3.22.14를 따른다. 합의 취소는 `toolcall.not_executed(cancel)`이고 `toolcall.denied`에서 `cancel`을 뺀다 | 09 |
| J-225 | `mobileReviewable`의 원천 | 결과 제출 시점에 런타임이 26 §3.5.4 기준으로 정해 `ResultSubmissionCore.mobileReviewable`에 싣는다. 04 §3.12의 뷰는 이 값을 그대로 보인다. 재작업으로 새 제출이 생기면 그 제출에서 다시 정한다. 08에 필드를 등록한다 | 08, 10, 04, 12, 25 |
| J-226 | 계획 레코드 이름 | 08의 `LoopPlanCore`(필드 `authoredBy`)가 정본이다. J-188의 `LoopPlanRecord.authoredBy`는 이를 가리킨다. 문서의 표기를 `LoopPlanCore.authoredBy`로 맞춘다(09 페이로드 `loop_plan.adopted.authoredBy`는 그대로) | 14, 16, 24, 25 |
| J-227 | 휴대폰의 `attention.quietHours` | 14 §3.13.8과 26이 설계한 대로 휴대폰도 `settings.update`로 `attention.quietHours`를 바꿀 수 있다. 19 §3.7.1의 M 열을 이에 맞춘다 | 19, 26 |
| J-228 | 연결 상태의 프로토콜 오류와 값 집합 | 20의 `protocolError`(닫힘 1002·1003)는 내부 원인이고 사용자용 상태가 아니다. 사용자용 상태는 "다시 연결하는 중"으로 보이며, 같은 오류가 연속 3회면 "버전 불일치"(04 §3.0.4)로 바꾼다. 20 `UserConnKind`와 21 `ConnectionUiState`는 04 §3.0.4의 값 열여섯을 쓰고, `viewStale`·`restarted`는 20이 이 값으로 대응시킨다 | 20, 21, 04 |
| J-229 | 브라우저 비-GET·업로드·합의 밖 이동의 처리 | 조작 단계에서 요청 가로채기로 잡아 send(권리 게이트)로 올린다(J-190 (3), J-208). 읽기 단계는 거부한다. 18 §3.11.6 행과 Q18-14는 이에 맞춘다. 13 §3.10.1과 같은 범위(오염 여부와 무관하게 이 세 가지)로 쓴다 | 18, 13 |
| J-230 | `helm-browserd` 명령·응답 타입 | 타입은 `packages/browserd`가 정의하고 `packages/tools`가 type-only로 가져온다. browserd는 tools를 가져오지 않는다. 06 §3.4.1 의존 표에 browserd 행을 둔다. 06 본문의 `src/browser/` 표기는 J-216에 맞춘다 | 06, 13, 23 |
| J-231 | `gen-push-fallback` 레시피의 행 | 23 M17-02에 둔다(푸시 대체 문구와 같은 행). `_verify-steps`의 `--check` 단계도 M17-02에서 만든다 | 23 |
| J-232 | `tools.mcp[]` 설정 위치 | `config.json`의 `tools.mcp[]`로 둔다. 항목 스키마의 정본은 13 §3.9.1이고, 17 §3.3.2 스키마에는 이 키와 13 인용을 등록한다 | 17, 13 |
| J-233 | 렌즈 고정 `pinned` | 08 `LensCore`에 `pinned: boolean`(기본 false)을 더한다. 09 `lens.updated`는 `Partial(LensCore)`로 자동 포함한다. 15 §3.9.2에 필드를 적는다 | 08, 09, 15 |
| J-234 | `triad` 질문의 답 선택지 | 두 대안 각각과 "둘 다 아님"(`neither`)의 세 값이다. `pointsToAlternative`는 앞 두 값에만 참이다 | 15 |
| J-235 | 피로 멈춤의 `then` | `decide_now`로 한다(초안 쪽 답으로 멈추면 사람의 결정으로 넘어간다) | 15, 09 |
| J-236 | ArgsView·ScopeDiff 단위 | 21 §6.2의 U4에서 U3(L1)으로 옮긴다 | 21, 23 |
| J-237 | `notifications.*` 범위 | `dndException`과 `showContent`는 알림 경로 설정이므로 `notifications.*`에 둔다(J-195 해석) | 변경 없음 |
| J-238 | 결과 확인 즉시 푸시의 cause 값 | `result_review_immediate`, 묶음은 `result_review_digest`(J-189 타이머 목적과 같은 이름). 11 §3.5.3 notify 지시에 `cause` 필드를 더하고 25에 등록한다 | 11, 26, 25 |
| J-239 | 판정 범위 머리말 | 각 문서 머리말의 판정 범위는 "J-01~J-240"로 맞춘다(J-190 이후 반영분 포함) | 모든 문서 |
| J-240 | 수용 | 13 §3.3.6과 17 §3.16 이중 참조, 24의 J-207 반영, 03의 상태 라벨 "거절됨(해결 안 됨)", 05의 파생 문구 키는 그대로 둔다 | 변경 없음 |
