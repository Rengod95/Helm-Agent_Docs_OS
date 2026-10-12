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
