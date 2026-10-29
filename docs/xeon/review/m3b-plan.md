---
id: review.m3b-plan
layer: meta
domain: review
kind: review
status: accepted
depends_on: [review.m3-plan, product.scope.spec, review.m3-lower-requirements]
binds: []
---

# M3b 구현 계획 (M3 2단계: 서비스·원격·예약·알림, 설정 비시각 부분, cap 확장, i18n, 릴리즈)

- 기준: `xeon/foundation`(M3a 마감, `61f137b..HEAD` 129커밋). 원천은 `review.m3-plan`, `product.scope.spec` §4.3·§4.4, `review.m3-lower-requirements`, M3a 계획의 "M3b로 넘기는 것", M3a 이월 목록(carryover)입니다.
- 에이전트: 계획 Opus medium. 트랙마다 Sonnet medium 리드가 서브 오케스트레이터로 일을 나누고 누락·보완 검증을 맡습니다. 실구현은 Haiku 5.5 xhigh가 주로 하고, 리드는 상태 기계 같은 어려운 핵심만 직접 씁니다. 동시 트랙은 4개 이하입니다(§3.4, 2026-10-29 개정).
- 공통 규칙은 M3a와 같습니다: 한 커밋 한 층, 문서 같은 커밋, contracts는 F 트랙만, `as`·`!`·`any`·`Reflect.get` 금지, 값 비교 시험, 명시적 `git add`, 워크트리는 `~/xeon-wt/<트랙>`.
- 검증: 트랙마다 `just check <pkg>`, 병합마다 빠른 `just verify`, `just verify-full`은 B6 마감에서 한 번만 돌립니다.

## 1. 범위 요약

### 1.1 종료 조건 번호 (X4~X11)

`product.scope.spec` §4.4 M3b 행에는 번호가 없습니다. M3a가 X1~X3을 쓰므로 M3b 행의 문장을 순서대로 X4~X11로 붙입니다. B0-LED가 spec과 `scripts/exit-tests.txt`에 적습니다 [결정: 오케스트레이터 기본값].

| 번호 | 조건(요약) | M3b 처리 | 담당 |
|---|---|---|---|
| X4 | 서비스 모드에서 클라이언트가 모두 끊겨도 예약 실행 이벤트가 기록되고, 연결 0·live task 0·대기 예약 0일 때만 유예 뒤 종료(UC-4) | 그대로 | SVC, SCH |
| X5 | SSH 터널로 서비스 소켓에 붙은 다른 기기 클라이언트가 세션 목록을 보고 입력을 위임, 비루프백 리스너 없음(UC-5) | 그대로. 실기 원격 확인은 사용자 묶음 | RMT |
| X6 | 목표 판정이 `l1.agents.judge.maxRuns`에서 멈춤 | 그대로. 구현은 M3a, 실제 core-loop 경로 시험을 더함 | NTF |
| X7 | 설정 화면에서 레이트 리밋·계정 회전을 바꾸면 F5 설정 파일에 같은 키로 저장(I14) | 재범위: `packages/client` 모델 계정 view-model과 `settings.writeFile`로 확인. 화면은 M4 | MDL |
| X8 | 비밀 탭이 재인증 뒤 값을 보임(UC-6) | 재범위: 비밀 view-model이 재인증 결과를 받아 값 상태로 바뀌는지 시험. 탭 화면은 M4 | SET, SBX |
| X9 | "도구와 웹" 탭과 `xeon doctor`가 검색 provider 상태, 키 플러그인 권장(Exa, Brave)을 보임 | 분할: `xeon doctor` 부분은 그대로, 탭 부분은 view-model 시험으로. 화면은 M4. SearXNG 항목은 M3b 계획에서 뺍니다 [결정: 2026-10-29 사용자 지시]. M2에 있는 SearXNG provider 코드는 그대로 둡니다 | WEB |
| X10 | 설정 화면 항목·설정 파일 키·설정 명령이 같은 F5 스키마에서 생성(키 집합 = 항목 집합) | 재범위: view-model 항목 집합과 CLI 설정 명령 키 집합이 스키마 키 집합과 같은지 시험. 화면 렌더는 M4 | SET |
| X11 | macOS와 Linux 릴리즈 빌드가 같은 스모크 통과 | 그대로. Linux는 CI, macOS는 GitHub macOS job. 서명·공증과 Mac 실기는 사용자 묶음 | REL |

- 재범위 근거는 2026-10-28 사용자 지시("ui 코드 구현은 m4에서")다. spec §4.4 M3b 행에 `[결정: 2026-10-28 사용자 지시]`로 적습니다.

### 1.2 M4로 옮기는 것

- 화면 컴포넌트 전부: 설정 화면(M3-new-06 시각 부분), 비밀 탭, 승인·제안 목록 화면, 모델 계정 화면, 검색 provider 드래그앤드롭(M3-12 UI 부분), 게이지, 첫 실행 권장 화면. caustic 디자인 시스템과 함께 M4에서 만듭니다.
- 접근성(M3-39의 a11y 부분). i18n은 M3b에 남습니다.
- 외부 훅(셸 JSON 프로토콜), 웹 클라이언트. 이미 결정된 이월입니다.
- M3-40 원격 점검 Phase 2(Victauri PoC). 데스크톱 화면 점검 도구라 화면과 함께 옮깁니다 [결정: 오케스트레이터 기본값].
- M3b에 남는 데스크톱 일: view-model, wire, 상태 논리, 입력 라우팅, 사이드카, 패키징입니다.

## 2. 차수와 트랙

크기: S(1~3커밋), M(4~8커밋), L(9커밋 이상). "끝 시험"은 트랙 완료를 증명하는 시험입니다.

### B0 준비 (병렬 4)

**B0-F F 계약 M3b 묶음** · Sonnet medium · `contracts`만 · M
- 요구: M3-REQ-05(Unknown 페이로드 정밀화), 14(artifact·schedule 레코드), 15(`settings.readFile`·`writeFile`, range 병합, `SettingsTab`, `SettingUi`, 관리 잠금), 16(`status.list`, `attachments.add`, `notify.list`, 알림 전달), 17(`SecretEntryOffer` 메타, `secret.test` 확장, 열람 경로), 19(서비스 인증, `host.authFailed`, 재접속용 목록), 20(pi 메시지 깊은 검증, M3-new-15), 21(라벨을 메시지 키로, wire 오류 kind+인자).
- 작업: M3-19, M3-20, M3-m2c-02 계약(모델 목록 또는 유효성 필드), 이월 `InputDraft.origin`(input.queued가 origin을 실음).
- 커밋 순서: 05·20 → 14 → 15·17·m2c-02 → 16·19 → 21. 21은 라벨 생성 방식을 바꾸므로 마지막입니다.
- 끝 시험: 새 스키마 왕복 값 비교 시험, `points.doc.test.ts`·wire 문서 시험이 spec 표와 일치.

**B0-OS platform-os** · Sonnet medium · `platform-os` · M
- 요구: 48(워크트리 연산, 감시 root 완화), 49(설정 파일 외부 변경 감시), 50(`NotifierProvider` macOS·Linux, WSL 토스트 없음), 51(`fileLock`), 52(로그 수준 잔여, 로그 회전, `traceparent`, 진단 배열 상한), 53(번들 바이너리 경로 탐색), 54(제품 이름 상수 한 곳), 61(감사 파일 정리 잠금).
- 작업: M3-07, M3-23 L0 부분, M3-32 L0 부분.
- 감시 구현은 `@parcel/watcher`가 새 의존이라 승인 전에는 포트 뒤 `fs.watch` 구현으로 갑니다. 어댑터는 승인 뒤 1커밋입니다 [결정: 오케스트레이터 기본값].
- 끝 시험: 두 프로세스 `fileLock` 경합 int 시험, 감시 통지 int 시험, Linux notifier는 `notify-send` 가짜 바이너리로 인자 값 비교.

**B0-SBX 샌드박스·실행·비밀** · Sonnet medium · `platform-sandbox`, `platform-exec`, `platform-secrets` · M
- 요구: 46(무인 경로 명령 시간 상한), 55(네트워크 차단 도메인, 자격 파일 읽기 옵션), 56(브라우저용 중첩 네임스페이스), 57(MCP stdio 출처별 샌드박스 적용), 58(비밀 env MCP 기동 승인 증거, 정의 해시), 59(비밀 사후 가림 적용 지점), 60(헤더 비밀 치환 공개).
- 작업: M3-14, M3-m2c-01(macOS os-auth, 코드와 시험 가짜까지), M3-m2c-04 (b)(c)(d), 원격 호스트 age 키 파일 폴백(Secret Service 먼저, 없으면 0600 파일).
- 끝 시험: bwrap int 시험에서 차단 도메인 거부, age 키 파일 권한이 0600이 아니면 거부, 사후 가림 값 비교. macOS os-auth는 가짜 provider 시험만 하고 실기는 사용자 묶음입니다.

**B0-LED 요구 장부와 종료 조건 번호** · Haiku xhigh · 문서·`scripts` · S
- `review.m3-lower-requirements`에 상태 칸(M3a 완료 / M3b 트랙 id / M4)을 더합니다. M3a 완료로 보이지만 커밋 근거가 없는 행(03, 25, 30, 33, 68, 76)은 코드 grep으로 확인하고, 미완이면 아래 L1M·GRP 트랙 몫으로 적습니다.
- X4~X11 번호와 재범위를 spec §4.4에, 빈 줄 자리를 `exit-tests.txt` 주석에 적습니다(시험 파일이 생길 때 각 트랙이 줄을 켭니다).
- 장부 검사 스크립트 `scripts/req-ledger.ts`: 표의 모든 M3-REQ 행에 상태가 있고, "M3b 트랙" 행은 트랙 id가 비어 있지 않은지 봅니다. 차수마다 검증 담당이 돌립니다(§3.3).
- 끝 시험: `req-ledger.test.ts`, 미배정 행 0.

### B1 서비스·예약·알림·작업 공간 (B0-F 병합 뒤, 병렬 4)

**B1-SVC 공유 서비스 모드** · Sonnet medium · `platform-process`(L0) → `ext-host`(X) → `core-persistence`(L1) → `apps/host`·`apps/cli`(L4) · L
- 요구: 42(등록 파일, `ensure`, 이중 기동 방지, 유휴 판정, 감독), 43(Unix 소켓 0600, TCP일 때만 토큰), 45(`withCwd` 서비스 시험), 38(서비스 모드 프로젝트 확장 단위와 신뢰 프롬프트 경로), 80(`autoResume` 기본 거짓, 서비스에서 켬, `replayFrom`), 81(재개 때 모델 요청 재전송 정책).
- 작업: M3-new-04, 이월 "프로젝트 확장 미적재", 이월 "안전 모드 켜는 CLI·설정".
- 의존: B0-F(19), B0-OS(51).
- 끝 시험: X4 앞 절반. host int `service-idle.int.test.ts`에서 승인 대기 세션이 있으면 종료하지 않고, 연결 0·live 0·대기 예약 0이면 유예 뒤 종료.

**B1-SCH cap-schedule** · Sonnet medium · `cap-schedule`(L2) → `apps/host`·`apps/cli`(L4) · M
- 요구: 93(타이머, 파일 감시, 원격, 루프, 놓친 실행 1회 따라잡기와 300초 최소 간격, cron 세션 종류).
- 작업: M3-new-12, M3-08 print 모드 사전 허용 규칙과 전체 자동 승인 옵션(73은 M3a 완료), M3-10 루프를 `ActivitySnapshot`에, M3-16 무인 시간 상한 연결.
- 의존: B0-F(14), B0-OS(48), B0-SBX(46). host 조립은 B1-SVC 뒤에 rebase합니다.
- 끝 시험: X4 뒤 절반. 서비스 모드 host int에서 클라이언트를 모두 끊은 뒤 타이머 예약이 실행 이벤트를 기록.

**B1-NTF 알림·상태 wire·목표 판정 확인** · Sonnet medium · `ext-host`(X) → `cap-dialog`·`cap-work`(L2) → `apps/host`·`apps/cli`(L4) · M
- 요구: 92(`dialog.notify` 구현, OS 알림 provider 연결, `status.list`·첨부, 매니페스트 명령 등록), 35(`scope.handler_failed` 발신).
- 작업: M3-11, M3-22(호스트가 `OperationsNotifier`를 넘기고 CLI가 그림), M3-19 사용량·알림 wire 처리기, M3-20 host 처리기.
- 이월: `judgeMaxRuns`를 `apps/host` agentsSource에 넘김, `l2.work.goal.onJudgeError` 키 삭제, 목표 판정 게이트를 실제 core-loop로 돌리는 시험, 명령 출력(handler void), 명령 abort signal.
- 끝 시험: X6. host int `goal-judge.int.test.ts`가 실제 core-loop에서 `maxRuns` 도달 뒤 turn 종료와 알림 1건을 값으로 확인. 알림은 연결 클라이언트 2개 모두 수신.

**B1-WS cap-workspace 쓰기 도구** · Sonnet medium · `cap-workspace`(L2) → `apps/host`(L4) · M
- 요구: 94(`write`, `edit`, `grep`, `find`, 원자적 쓰기, 동시 변경 감지, rg 엔진).
- 작업: M3-new-10.
- 의존: B0-OS(53 rg 경로).
- 끝 시험: cap-workspace int에서 동시 변경 감지 시 `edit` 거부, 원자적 쓰기 중 SIGKILL 뒤 원본 보존. 샌드박스 밖 쓰기 거부 회귀.

### B2 원격·산출물·모델·웹 (B1 병합 뒤, 병렬 4)

**B2-RMT 원격 사용** · Sonnet medium · `platform-process`(L0) → `client`(L4) → `apps/cli`·`apps/desktop`(L4) · M
- 요구: 44(`connectServiceTransport`, SSH 터널·사설망, PR-20 중계 시험).
- 작업: M3-new-05, 소켓 클라이언트를 `packages/client`에(전송 인터페이스 뒤, 브라우저용 분리 유지), 데스크톱 사이드카가 원격 소켓에 붙는 설정 경로(화면 없이 설정 키와 CLI 플래그).
- 의존: B1-SVC.
- 끝 시험: X5. `socat` 중계로 만든 가짜 터널 int 시험에서 세션 목록 조회와 입력 위임, 서비스 리스너 주소가 모두 루프백 또는 Unix 소켓임을 값으로 확인.

**B2-ART cap-artifacts** · Sonnet medium · `cap-artifacts`(L2) → `core-loop`(L1, 가드 발화 1커밋) → `apps/host`·`apps/cli`(L4) · M
- 요구: 95(리뷰·diff 승인, 제목·라벨, 레코드 카탈로그).
- 작업: M3-new-11, M3-09 L2 부분.
- 이월: `guard.output.before` 대상 `execution` 발화, 리뷰 답 `submit:false`와 리뷰 단위 주석 의미, CLI 검토 승인 카드의 `ReviewAnswer` 흐름(지금 allow가 거부됨).
- 의존: B1-WS(같은 `apps/host` 도구 조립).
- 끝 시험: host int에서 diff 리뷰 승인 → 적용, 거부 → 파일 변경 0. CLI 테이프 스모크에 리뷰 카드.

**B2-MDL 모델 계정** · Sonnet medium · `core-models`(L1) → 기본 플러그인 2개(L3 위치는 Helm과 같음) → `client`·`apps/host`·`apps/desktop`(L4) · L
- 요구: 85(계정 풀, 레이트 리밋, 회전, 기본 꺼짐과 첫 사용 고지).
- 작업: M3-new-07, M3-new-23(위장 provider·계정 회전 플러그인, 둘 다 기본 꺼짐), M3-m2c-02 host와 데스크톱 시작 시 점검(비시각), 모델 계정 view-model.
- 플러그인 위치는 Helm 기본 플러그인 패키징을 따릅니다 [결정: 오케스트레이터 기본값].
- 끝 시험: X7. view-model에서 레이트 리밋·회전 값을 바꾸면 `settings.writeFile` 뒤 F5 파일에 같은 키가 저장(값 비교). 429 테이프에서 계정 회전.

**B2-WEB 검색 provider와 브라우즈** · Sonnet medium · `ext-host`(X) → `cap-web`(L2) → `client`·`apps/host`·`apps/cli`(L4) · M
- 요구: 37(검색 provider 등록 API), 96(`web.browse` provider, 플러그인 provider와 헤더 비밀, 가격표, 자동 선택 순서).
- 작업: M3-12(첫 사용 고지, 동시 질의, robots.txt 기본 무시 + 옵션), M3-new-13.
- Stagehand는 새 의존입니다. 승인 전에는 MCP stdio provider 경로와 가짜 브라우저 provider로 구현하고, Stagehand 패키지 추가는 사용자 묶음입니다 [결정: 오케스트레이터 기본값].
- 의존: B0-SBX(56, 60).
- SearXNG 관련 작업(주소 표시, 감지, 권장)은 하지 않습니다 [결정: 2026-10-29 사용자 지시].
- 끝 시험: X9. `xeon doctor` 출력 테이프 시험(provider 상태, Exa·Brave 권장)과 "도구와 웹" view-model 값 비교.

### B3 보안·설정·데이터·L1 잔여 (B2 병합 뒤, 병렬 4)

**B3-SEC MCP와 외부 확장 보안** · Sonnet medium · `ext-host`(X) → `core-tools`(L1) → `cap-mcp`(L2) → `apps/host`(L4) · M
- 요구: 31(외부 능력 `idempotent` 신뢰 조건, `trust.level`), 32(샌드박스 강제 위치와 `tool_call` 순서 문서화), 75(MCP 비밀 env 승인 레코드에 정의 해시), 97(평문 env 허용과 비밀 이름 패턴 거부, sampling 미지원, 출처별 샌드박스 키).
- 작업: M3-05, M3-33 중 MCP 마찰·샌드박스 호출 비격리 감사(`tool.sandbox_bypassed`)·비샌드박스 실행. 이월 afterUntrusted 메모리 재시작 유지([제안] L1.tools §4.3).
- 끝 시험: host int에서 비밀 env MCP 서버가 승인 1회 뒤 기동, 정의를 바꾸면 다시 승인 요구.

**B3-SET 설정 비시각 부분과 데스크톱 입력 라우팅** · Sonnet medium · `core-persistence`(L1) → `client`(L4) → `apps/host`·`apps/cli`·`apps/desktop`(L4) · L
- 요구: 82(`settings.json` 프로세스 간 잠금).
- 작업: M3-new-06 비시각 부분(탭·항목 view-model, 관리 잠금 사유, 첫 실행 권장 상태), M3-new-08 외부 변경 통지, M3-23, M3-34 동작 없는 키 정리, M3-18 L4 제안 목록 view-model, 비밀 view-model(17 열람 경로, 재인증 상태), tokenBudget·모델 위젯 재검토(view-model만).
- 이월: 데스크톱 슬래시 입력을 `command.run`으로 보내고 `command.list`를 view-model로 제공. 지금은 `/helm`, `/learning`이 채팅으로 갑니다.
- 끝 시험: X8(비밀 view-model이 가짜 재인증 성공 뒤 값 상태, 실패 뒤 값 없음), X10(스키마 키 집합 = view-model 항목 집합 = CLI 설정 명령 키 집합). 데스크톱 단위 시험에서 `/helm start`가 `command.run` 1회.

**B3-DATA 데이터·운영** · Sonnet medium · `platform-store`(L0) → `ext-host`(X) → `core-persistence`(L1) → `apps/host`·`apps/cli`(L4) · L
- 요구: 47(spill 보관과 디스크 상한), 62(`pinBlob`, 블롭 GC, 보존 기본 지우지 않음), 63(DB 내보내기, `future_version` 읽기 전용), 84(보관 정리·GC 연결), 83(자동 제목, fork 원본 history 연속성), 36(필수 투영기 예외 격리).
- 작업: M3-24, M3-25 코드 부분, M3-31, M3-32 L4 부분, M3-36, M3-37.
- 끝 시험: 참조 없는 블롭만 지워짐(값 비교), 투영기 예외 주입 시험, `xeon db export` 왕복.

**B3-L1M L1·X 잔여** · Sonnet medium · `ext-host`(X) → `core-loop`·`core-agents`·`core-context`(L1) · M
- 요구: 67(위임 caller 표기, 풀 공유, 상한 귀속), 70(검토 포크 사용량 귀속, 캐시 접두 조건), 86(최근 파일 재주입, 컴팩션 뒤 재주입), B0-LED가 미완으로 판정한 68·76·25.
- 작업: M3-new-18, M3-new-14 문안(87의 문안 부분), M3-21 잔여 확인.
- 이월: toolCallId를 turn id로 염(제공자 id 재사용 충돌), `JudgeInput` run·stepId, 재시작 뒤 `cancel({ownerScopeId})`, 큐 입력 우선(77 [제안]), `input.agent.before` systemPrompt 덮어쓰기, `loop.spawn` leaseEpoch 펜싱, X가 자식 대화에 drive 임대를 주는 문제, core-agents `draftQueued` origin `"delegation"`·core-tasks `"other"`, `completeStructured` 위치와 `L1.models.spec` 정렬, `L1/loop/spec.md` §4.4b 순서.
- 끝 시험: 같은 toolCallId를 두 turn에 쓰는 테이프에서 학습 제안 id 충돌 0, 재시작 뒤 owner 단위 취소가 저장된 자식에 닿음.

### B4 그룹·i18n·데스크톱 정리 (B3 병합 뒤, 병렬 3)

**B4-GRP 그룹 계측과 그룹 도구** · Sonnet medium · `ext-host`(X) → `group-kit`·`group-helm`·`group-learning`(L3) → `apps/cli`(L4) · M
- 요구: 39(내구 이벤트 접두 조회, 도구 소유 scope 조회), B0-LED가 미완으로 판정한 33.
- 작업: M3-new-09(G-17, G-18), M3-17(`xeon group new`, 템플릿), LR-17 `GroupMetrics` 쓰기 API.
- 이월: group-kit 시험 틈(재생 하네스 thread id 동일, `capabilityWrite` 계수 구현 또는 삭제, abort 때 `callContext`, scan-drive 위치, `delegateStatus`·`cancelDelegates` 교차 scope), 저장 상태 스키마 위반 재설정 경로, SIGKILL 자식 장애 시험, `inquiry.finished` 중복 제거, Helm 삭제 뒤 재설치 표지, depcruise group-kit 예외 정리.
- 끝 시험: `xeon group new` 생성물이 `core-diff-check`로 0줄, 승격 보고 값 비교.

**B4-I18N i18n 이전** · Sonnet medium(설계) + Haiku xhigh(문자열 이전) · `client`(L4) → `apps/host` → `apps/cli` → `apps/desktop`(층마다 1커밋 이상) · L
- 요구: 112(하위 층 문장 금지, kind+인자), 21의 소비처.
- 작업: M3-new-21, M3-39 i18n 부분. ko·en 카탈로그는 `packages/client`.
- FormatJS가 의존 허용 목록에 없습니다. 승인 전에는 `Intl` 내장과 작은 포맷 포트로 구현하고, FormatJS 어댑터는 승인 뒤 1커밋입니다 [결정: 오케스트레이터 기본값].
- 순서: Sonnet이 포트·카탈로그 생성·검사를 만들고, Haiku가 앱별 문자열을 옮깁니다(앱 하나씩 순차).
- 끝 시험: 하드코딩 한국어 문자열 검사(테스트·카탈로그 제외)가 0, `ui.locale=en` CLI 테이프 스모크.

**B4-DSK 데스크톱 비시각 정리** · Sonnet medium · `apps/desktop`(L4, Rust 포함) · S
- 작업: M3-38(`closeBehavior`, `EngineConfig::from_values` 호출처), M3-m2c-04 (a) Finder PATH와 (e) 디버그 로그 0바이트, verify가 낡은 사이드카를 다시 빌드하게(이월, `scripts` 1커밋).
- 끝 시험: 사이드카 e2e(E2·E3) 회귀, 원본보다 오래된 바이너리면 재빌드하는 스크립트 시험.

### B5 릴리즈·성능·정리 (B4 병합 뒤, 병렬 4)

**B5-REL 릴리즈 빌드** · Sonnet medium · `scripts`, `.github/workflows`, `apps/desktop` 번들 설정, 새 문서 `L4/release/spec.md` · L
- 요구: 53 소비처(앱 자원 디렉터리 탐색 검증), 54 값 사용 확인.
- 작업: M3-26(macOS sops·age·rg 번들, Linux bwrap·socat 시스템 요구와 doctor 안내), M3-27(단일 파일 릴리즈, 업데이트, 공급망·고지 문서), M3-new-22 번들 위치, `@swc/core` 데스크톱 번들 미포함 확인, M3-30 SHA 고정 회귀 확인.
- 서명·공증은 스크립트와 CI 단계까지 만들고 비밀이 없으면 건너뛰게 둡니다. 비밀 등록은 사용자 묶음입니다.
- 끝 시험: X11. 릴리즈 스모크 스크립트 하나를 Linux x86_64 CI와 GitHub macOS arm64 job이 같은 입력으로 돌림.

**B5-PERF 측정과 조정** · Sonnet medium · `bench`, 각 소유 설정 기본값 · M
- 요구: 40(X 예산 기본값), 41(탐구 없는 turn 임대 비용, 문제 없으면 행 닫음), 87(게이트 상한·반복 감지 임계 테이프 조정), 98(인덱스 예산), 64는 서버 측정 부분만.
- 작업: M3-29 서버 측정과 게이트 골격(예산 수치는 사용자 결정 대기 칸으로), M3-new-16 서버 몫.
- 끝 시험: `just bench` 결과가 `eng.performance.guide` 표에 기록되고 게이트 스크립트 시험 통과.

**B5-CLN 기계적 정리** · Haiku xhigh · 시험 파일 여러 패키지, 문서 · M
- 작업: 남은 `Reflect.get` 85곳(M3-41 잔여), `X/operations/plan.md` "pi 어댑터" 문구, M3-new-17 잔여(open-issues E-01~E-05, N-07, V-05, 린트 항목), M3-35(`kit`·`group-kit`, `host`·`host-service` 이름 맞춤), 학습 superseded 커밋 처리 확인.
- 패키지마다 1커밋입니다. 다른 트랙과 겹치지 않게 B5에 둡니다.
- 끝 시험: `check-ts-rules`에서 `Reflect.get` 0, `docs-route` 통과.
- 학습 superseded 커밋(확인 2026-10-29): `ecbc1f9a`와 `608713e0`은 `xeon/foundation` 이력에 없고 어떤 ref에도 닿지 않습니다. `608713e0`은 `m3a/learning` 리베이스의 reflog에만 남습니다. 같은 작업은 foundation의 `0d07cbe9`(group-learning)와 `dc920ae3`(host 학습 내장)으로 들어가 있어 이력을 고치지 않습니다(squash 없음) [결정: 오케스트레이터 기본값]

**B5-DOC 운영 문서** · Haiku xhigh · `docs/xeon` · S
- 작업: M3-28(운영·진단 런북, 용어집, 구현 상태 지도, 데이터·개인정보, 비기능 요구 절), M3-25 복구 런북.
- 끝 시험: `docs-route`와 문서 검사 통과.

### 추가 트랙 (M3b 중 선언, B6 마감에서 기록)

차수 계획에 없던 트랙입니다. 병합을 마친 뒤 B5-DOC이 선언 누락을 지적해 기록합니다. 트랙 id는 `req-ledger`가 보는 굵은 제목입니다.

**B1-SCH2 예약 wire·CLI** · Sonnet medium · `contracts` → `cap-schedule`(L2) → `apps/host`·`apps/cli`(L4) · M
- 작업: `schedule.entries` 능력과 `schedule.create/list/cancel/fire` wire 메서드, `xeon schedule add|list|cancel|run`, 손상된 상태 파일 위에 쓰지 않는 보호, 예약 실행 thread 생성 키.
- 끝 시험: X4 끝 시험 `service-schedule-wire.int.test.ts`.

**B3-FIX cap 수정** · Sonnet medium · `cap-workspace`·`cap-knowledge`·`cap-web`·`group-kit` · S
- 작업: 블롭 고정(pin) 틈과 이미지 블롭을 고정하지 않는 근거의 시험·문서, 사용량 게이지 틈.

**B3-SEC2 MCP stdio 샌드박스 연결** · Sonnet medium · `apps/host`(L4) · S
- 작업: stdio MCP 서버의 샌드박스 요청을 `xeon.sandbox` `wrapArgv`에 잇고 실제 bwrap으로 밖 읽기·밖 쓰기 거부를 확인.

**B5-FIX2 S-15·반복 감지 설정** · Sonnet medium · `core-persistence`·`apps/host`·문서 · S
- 작업: 자리표시 참조를 `p_blob_refs`에 모아 GC가 지우지 않게 하고(S-15), `l1.loop.repeat.*` 설정을 루프 설정 원천에 잇고 성능 지침에 맞춥니다.

### B6 마감 (순차)

1. 검증 담당이 M3b 전체를 다시 봅니다: X4~X11 항목별 충족, `req-ledger` 미배정 0, 이월 목록 처리 여부.
2. `just verify-full`(M3 전체 한 번), `just exit-tests`(X4~X11 줄 켬, 건너뜀 0), GitHub macOS job 1회.
3. `review.m3-plan`에 M3b 판정표와 M4 이월 표, PR 생성. 그 뒤 §4 사용자 묶음을 한 번에 요청합니다.

## 3. 충돌과 병렬

### 3.1 같은 파일을 만지는 트랙

- `apps/host` 조립과 설정 스키마 JSON: B1 네 트랙, B2 RMT 밖 셋, B3 넷이 모두 만집니다. 각 트랙은 host 커밋을 마지막에 두고, 병합 순서는 SVC → SCH → NTF → WS(B1), WS 뒤 ART입니다. 설정 스키마 JSON은 병합 때 오케스트레이터가 재생성합니다(이월 18).
- `apps/cli` 렌더와 `main.ts`: SVC(service 명령), SCH(print 모드), NTF(알림 렌더), ART(리뷰 카드). 명령 파일을 나누고 렌더 표는 kind별 파일에 둡니다.
- `packages/client`: RMT(전송), MDL·SET(view-model), I18N(카탈로그). 하위 폴더를 나누고 I18N은 B4로 미뤘습니다.
- `ext-host`: SVC(38), NTF(35), WEB(37), SEC(31), DATA(36), L1M(자식 임대), GRP(39). 같은 차수에서는 폴더가 다릅니다(loading-trust, operations, primitives). B3에서 SEC·DATA·L1M이 겹치면 X 커밋을 먼저 병합하고 나머지가 rebase합니다.
- `cap-mcp`: WEB(B2) 뒤 SEC(B3) 순서입니다.
- `core-tools`: SEC(75, afterUntrusted)와 L1M. 파일이 다릅니다(approvals와 pipeline). 겹치면 SEC가 먼저입니다.
- `apps/desktop`: RMT, MDL, SET, I18N, DSK, REL. DSK는 I18N과 같은 차수라 DSK를 먼저 병합합니다.
- 시험 파일 전체: B5-CLN. 다른 구현 트랙과 차수를 나눴습니다.

### 3.2 병렬도

- 동시 구현은 차수마다 4명 이하입니다(B4는 3명). Haiku 트랙도 1명으로 셉니다.
- B0-F가 늦으면 B0-OS·SBX를 먼저 병합하고 B1은 B0-F 병합을 기다립니다.

### 3.3 차수마다 미배정 하위 요구 점검

- 검증 담당은 차수 끝마다 `bun scripts/req-ledger.ts`를 돌립니다. 상태가 빈 행, "M3b"인데 트랙 id가 없는 행, 이번 차수 트랙에 배정됐는데 끝 시험이 없는 행을 결함으로 냅니다.
- 이월 목록(carryover)의 항목도 장부 끝 표에 트랙 id를 적어 같은 검사를 받습니다.
- 현재 배정에서 빠진 하위 요구는 없습니다. B0-LED가 03·25·30·33·68·76의 M3a 완료 여부를 확인하고 미완이면 L1M·GRP에 넣습니다.

### 3.4 실행 방식 (2026-10-29 개정)

차수 경계를 없애고 선행 트랙만 기다리는 대기열로 돌립니다. 위 B1~B5 제목의 "(X 병합 뒤)"는 아래 선행 칸으로 바꿔 읽습니다 [결정: 2026-10-29 사용자 지시].

- 동시 트랙은 4개 이하입니다. 트랙 안에서는 Haiku 구현자를 한 번에 1명만 돌리고, 리드는 그동안 시험을 돌리지 않습니다. 시험을 돌리는 에이전트가 4명을 넘지 않습니다.
- 트랙 리드(Sonnet medium)의 일:
  1. 요구 행, 이월 항목, 끝 시험을 작업 목록으로 나눕니다.
  2. 어려운 핵심만 직접 씁니다. 나머지는 Haiku에게 작업 단위로 맡깁니다.
  3. Haiku 결과를 요구 행과 대조해 누락·보완 항목을 찾고 다시 Haiku에게 돌립니다.
  4. 끝 시험, `req-ledger`, 문서 동기화를 확인하고 오케스트레이터에게 보고합니다.
- 오케스트레이터는 마지막 diff 검토, rebase와 `--ff-only` 병합, 병합마다 빠른 `just verify`를 맡습니다. `apps/host` 충돌은 먼저 끝난 트랙이 먼저 병합하고 뒤 트랙이 rebase합니다.

| 트랙 | 선행 | 리드가 직접 쓰는 부분 | Haiku 몫 |
|---|---|---|---|
| B1-SCH | 없음 | 예약 상태 기계(따라잡기 1회, 300초 간격) | print 모드 허용 규칙, `ActivitySnapshot` 루프, host·CLI 조립, 시험 |
| B1-NTF | 없음 | 없음(검토만) | `dialog.notify`, provider 연결, `status.list`, 이월 5건, `goal-judge.int.test.ts` |
| B1-WS | 없음 | 원자적 쓰기, 동시 변경 감지 | `grep`·`find`(rg), host 조립, 시험 |
| B2-RMT | 없음 | 전송, 터널 시험 | CLI 플래그, 설정 키, 문서 |
| B2-WEB | 없음 | browse provider 자동 선택 | provider 등록 API 배관, doctor 출력, view-model, 시험 |
| B2-MDL | 없음 | 계정 풀, 레이트 리밋, 회전 | 플러그인 2개 패키징, view-model, 시작 점검 |
| B3-L1M | 없음 | 대부분(L1 미묘한 수정) | 문안, 문서, 시험 보강 |
| B3-DATA | 없음 | `pinBlob`, 블롭 GC | `db export`, 자동 제목, 투영기 예외 시험 |
| B4-DSK | 없음 | 없음(검토만) | 전부 |
| B2-ART | B1-WS | 리뷰 승인 흐름 | 레코드 카탈로그, CLI 리뷰 카드 |
| B3-SET | B2-MDL | `settings.json` 잠금, 슬래시 명령 라우팅 | 탭·항목 view-model, 키 정리 |
| B3-SEC | B2-WEB | 대부분(보안 경로) | 감사 이벤트, 시험 |
| B4-GRP | B3-L1M | 내구 이벤트 접두 조회 | G-17·G-18, `xeon group new` 템플릿 |
| B4-I18N | 모든 L4 구현 트랙 | 포트, 카탈로그 생성, 검사 | 앱별 문자열 이전 |
| B5-CLN | B4-I18N | 없음 | 전부 |
| B5-REL·PERF | B4-I18N | 릴리즈 스크립트, 측정 게이트 | 문서, CI 단계 |
| B5-DOC | 나머지 전부 | 없음 | 전부 |
| B1-SCH2 | B1-SCH | 없음(검토만) | 전부(wire, CLI, 시험) |
| B3-FIX | B3-DATA | 없음 | 전부 |
| B3-SEC2 | B3-SEC | 샌드박스 연결 | 시험 |
| B5-FIX2 | B3-DATA, B4-GRP | 없음 | 전부 |

- 시작 순서: 뒤 트랙을 여는 트랙을 먼저 띄웁니다. 첫 4개는 B1-WS, B2-WEB, B2-MDL, B1-SCH, 다음은 B3-L1M, B1-NTF, B2-RMT, B3-DATA, B4-DSK 순입니다.

## 4. 사용자 확인 묶음 (B6 뒤 한 번에)

1. Mac 실기: os-auth Touch ID 열람 재인증(M3-m2c-01, X8 실기), `composer.tsx` IME, 데스크톱 슬래시 명령 라우팅, macOS 알림, X11 Mac 앱 스모크, 64(`fullfsync`, `processStartFingerprint`), M3-new-16 Mac 몫.
2. 성능 예산 수치 결정(M3-29, macOS 기준선 뒤).
3. 비밀 등록: Apple Developer ID 서명·공증 비밀(`just secret-add`), CI 서명 비밀.
4. 새 외부 의존 승인: `@parcel/watcher`(48), FormatJS(ADR-0016), Stagehand(96). 승인되면 각 어댑터 1커밋.
5. 실제 원격 확인: 자체 호스트 서버에서 `xeon service`를 켜고 다른 기기에서 SSH 터널로 접속(`ws on`), 키체인 없는 서버의 Secret Service 키 마련(m2c-04 b).
6. `L4/README.md`의 낡은 설정 경로(사용자가 README 수정을 막아 둠).
7. `[결정: 오케스트레이터 기본값]` 검토: X4~X11 번호, M3-40 M4 이월, 새 의존 승인 전 대체 구현 3건, 위장·회전 플러그인 위치.

## 5. 위험

- 재범위 판정: X7·X8·X10은 화면 없이 view-model로 확인합니다. M4 화면이 view-model을 그대로 쓰지 않으면 확인이 무의미해집니다. view-model 공개 API를 `packages/client` 문서에 고정합니다.
- 의존 승인 대기: 대체 구현 3건이 승인 뒤 다시 바뀝니다. 포트 경계를 좁게 두어 어댑터 교체를 1커밋으로 제한합니다.
- `apps/host` 병합 충돌: B1~B3 거의 모든 트랙이 host를 만집니다. host 커밋을 마지막에 두고 병합 순서를 고정합니다.
- 서비스 모드는 상태 기계가 큽니다(유휴, 감독, 재개, 인증). SVC를 B1 첫 병합으로 두고 RMT·SCH가 그 위에 쌓습니다. 늦어지면 B2 전체가 밀립니다.
- X11 macOS job은 서명 비밀 없이 미서명 빌드만 확인합니다. 공증 실패는 사용자 묶음 뒤에야 드러납니다.
- i18n 이전은 L4 문자열 전체를 만집니다. 다른 L4 트랙이 B4 뒤에 문자열을 더하면 검사가 막습니다. B5 트랙은 카탈로그 키로만 문자열을 더합니다.
- M3a 완료로 본 행 중 근거 없는 행(03, 25, 30, 33, 68, 76)이 미완이면 L1M·GRP 크기가 커집니다.
- 테스트 메모리: 서비스·원격 int 시험이 자식 프로세스를 띄웁니다. cgroup 상한 아래 패키지별 실행을 지킵니다.
- 타입 잔여(REQ-05, REQ-21): REQ-05의 정적 페이로드 타입은 `unknown`으로 두고 런타임 깊은 검사로 확인합니다. REQ-21은 `label`·`help`를 `labelKey`·`helpKey` 옆에 남깁니다. `label`·`help` 제거는 M4 이월 항목입니다.
