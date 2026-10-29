---
id: review.m3-lower-requirements
layer: meta
domain: review
kind: review
status: draft
depends_on: [review.m3-design-inputs, review.m3-plan, adr.0015, product.scope.spec, L3.helm.spec, L3.learning.spec, L3.group-kit.spec]
binds: []
---

# M3가 하위 층에 요구하는 변경

## 1. 목적과 읽는 법

- M3 설계 단계(2026-10-25 사용자 결정)의 세 번째 단계 산출물 중 하위 층 몫이다. M3 작업(L3 Helm, 학습 그룹, `review.m3-plan`의 서비스·원격, 능력 확장, 보안, 설정·UI, 데이터·운영, 릴리즈)이 F, X, L0, L1, L2에 요구하는 변경을 한 행씩 적는다.
- 이 문서는 M3 구현 계획(/plan)의 입력이다. F·X·L* 문서 본문은 2026-10-26 사용자 결정으로 닫힌 [미결] 표기만 고쳤다. 각 행은 소유 문서를 고치는 작업 하나로 옮긴다.
- 입력: `review.m3-design-inputs` §3(D-M3-01~32), §4.4(REQ-F·X·L1·L2), §5, ADR-0015, `review.m3-plan` M3-01~40, 범위별 수집 네 벌. L3 문서는 이 작업과 같은 변경 묶음의 `L3.helm.spec`, `L3.learning.spec`, `L3.group-kit.spec`이다. 이 세 문서는 절 번호와 항목 이름으로 인용한다. 본문이 바뀌면 §5 대응표의 "L3 근거" 칸을 다시 대조한다.
- 번호: 요구는 `M3-REQ-NN`이다. `review.m3-design-inputs`의 `REQ-<층>-NN`은 §5에서 이 번호로 옮긴다. 원천 칸의 `A-NN`, `KN-NN`, `U-NN`, `C-NNN` 등은 수집 ID이고, `D-M3-NN`은 사용자 결정 묶음 번호다.
- 상태 칸(§3 표의 마지막 칸): `M3a`는 M3a에서 끝난 행, `M3b`는 M3b에서 끝난 행(B6 마감 판정, §10), `M3b:<트랙 id>`는 `review.m3b-plan` §2의 그 트랙이 맡는 행, `M4`는 M4로 옮긴 행이다. 트랙 요구 목록에 없는 행은 `M3a`다. 그 가운데 03·25·30·33·68·76은 코드와 문서에서 근거를 확인했다(2026-10-28). 근거가 없었다면 `M3b:B3-L1M`(33은 `M3b:B4-GRP`)으로 옮겼을 행이다. 이 판에는 행 전체가 M4인 요구가 없다. 화면과 외부 훅 부분은 해당 행 본문에 M4로 적었다. 검사는 `just req-ledger`가 한다. `M3b:<트랙 id>`의 트랙 id와 §9 이월 표의 트랙 id는 `review.m3b-plan` §2의 굵은 제목(`**B<n>-<ID>`)에 선언된 id여야 하며, 선언되지 않은 id(예: `B9-X`)는 검사에서 실패한다.
- 이미 정한 것:
  - [결정: adr.0015] 재실행되는 확장 코드의 효과 목록은 C안(선언형 허용)이다. `g.delegate`·`loop.spawn`은 코어가 멱등을 보장한다. 능력 메서드는 F 정의가 `idempotent: true`를 선언하고 `requestId`를 받을 때만 허용한다. 읽기 메서드는 drive에서 허용한다. 선언 없는 쓰기는 요청 레코드와 워커를 거친다. 시험은 "재생 2회, 효과 1회"다.
  - [결정: 사용자 2026-10-26] `review.m3-design-inputs` §3의 D-M3-01~32에 모두 답이 왔다. 조건부였던 행은 결정대로 고쳤고, 결정이 새로 만든 하위 층 작업은 M3-REQ-105~112로 더했다(§6).
  - [결정: 사용자 2026-10-25] `product.scope.spec` §10 미결 4는 "M2 마감 직후, M3 설계 단계 첫 트랙. 선행 M3-03"으로 닫는다. 문서 반영은 M2 마감 작업이 한다.

### 1.1 순서 칸의 뜻

| 단계 | 내용 | 시작 조건 |
|---|---|---|
| 0 | F 계약: 타입, 필드, 이름, 오류 코드, wire 메서드. 층 공통 배치 규칙 | 선행 없음 또는 같은 단계의 문서 행 |
| 1 | X 메커니즘과 L0 서비스 | 같은 행이 쓰는 F 행(단계 0) |
| 2 | L1 코어 서비스 | 같은 행이 쓰는 F·X·L0 행 |
| 3 | L2 능력 | 같은 행이 쓰는 F·L1 행 |
| 4 | 측정 뒤 조정 | M3-29 성능 기준선, 실기 확인(M3-new-16) |

- 순서 칸 표기: `1 ← M3-REQ-01`은 "단계 1, M3-REQ-01 반영 뒤 시작"이다. 사용자 결정 대기 표기(`· D-M3-NN`)는 2026-10-26 답으로 모두 지웠다.
- 단계는 문서 반영과 구현의 선후다. 같은 단계 안 행끼리는 선행 표기가 없으면 병렬로 진행한다.

## 2. 의존 순서 요약

### 2.1 단계별 행 수

| 단계 | F | X | L0 | L1 | L2 | 공통 | 합계 |
|---|---|---|---|---|---|---|---|
| 0 | 27 | | | | | 1 | 28 |
| 1 | | 18 | 21 | | | 1 | 40 |
| 2 | | 3 | 1 | 24 | | | 28 |
| 3 | | | | | 11 | | 11 |
| 4 | | 2 | 1 | 1 | 1 | | 5 |
| 합계 | 27 | 23 | 23 | 25 | 12 | 2 | 112 |

- 단계 2의 X 세 행(M3-REQ-34, 39, 110)과 L0 한 행(M3-REQ-45)은 같은 층의 단계 1·2 행을 선행으로 둔다.
- M3-REQ-99~104는 학습 §8.1과 Helm §4.13에서 나온 행이다. F 3행(99, 100, 101), X 1행(102), L1 1행(103), L2 1행(104)이다.
- M3-REQ-105~112는 사용자 결정(D-M3-01, 10, 11, 26, 27, 30)이 새로 만든 행이다. F 3행(105, 106, 107), X 2행(108, 110), L1 1행(109), 공통 2행(111, 112)이다. 공통은 한 층에 속하지 않는 배치 규칙과 여러 층에 걸친 문자열 규칙이다(§3.7).

### 2.2 트랙별 첫 경로

| 트랙 | 먼저 끝낼 행(순서대로) | 이 경로가 여는 M3 작업 |
|---|---|---|
| Helm | M3-REQ-01 → 02 → 04·05 → 22 → 23·24·25 → 69 → 71 → 88 → 90, 거부 통지 106 → 101 → 99, 기본 플러그인 설치 34 → 110 | M3-01(Helm 본체), M3-02, M3-04 |
| 학습 | M3-REQ-01 → 02 → 06·11·100·101 → 22 → 26·102 → 69 → 65·66·68·70·103 → 77 → 88·89·91·104 | M3-new-03(학습 그룹 1차), M3-13, M3-18 |
| ADR-0015 공통 | M3-REQ-01·02·03 → 22·27 → 69·76 → 88·89 | M3-new-01 |
| 확장 계약(ADR-0017) | M3-REQ-106 → 12·105·107·101 → 108 → 109 | M3-15, 가드레일 지점, 수명주기 지점 |
| 클라이언트·다국어(ADR-0020, ADR-0016) | M3-REQ-111 → 21 → 112 | M3-39, M3-new-06 |
| 서비스·원격 | M3-REQ-19 → 42·43 → 44·45 → 80 → 38 | M3-new-04, M3-new-05 |
| 무인 실행 | M3-REQ-72 → 73 → 93, M3-REQ-46·48 → 93 | M3-06, M3-08, M3-new-12 |
| 보안 | M3-REQ-55 → 56·57, M3-REQ-58 → 75 → 97, M3-REQ-59 | M3-05, M3-14, M3-33 |

- 확장 계약 트랙의 M3-REQ-106(지점 이름 정리)은 M3 F 첫 작업이다 [결정: adr.0017]. 지점 이름을 인용하는 다른 행(04, 05, 12, 100, 101, 105, 107)은 새 이름표가 나온 뒤 이름만 바꿔 적는다.
- Helm은 기본 플러그인이다 [결정: review.m3-design-inputs D-M3-01 c]. 그래서 Helm 경로에 외부 확장 로더(34)와 기본 플러그인 설치(110)가 들어온다.

## 3. 요구 표

### 3.1 F (계약)

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-01 | F | `F.capabilities.spec` §3.2, §3.6, §4.6, §9 | `MethodDef.idempotent?: true`와 `readOnly?: true`를 더한다. `validateCapability` 코드 `idempotent_replay_unsafe`, `read_only_replay_unsafe`, `effect_class_conflict`(error), `effect_class_missing`(warning)과 공통 오류 `effect_not_allowed`, 수용 기준을 적는다. [제안] 읽기 표지는 `ToolHints.readOnly`와 같은 이름의 `readOnly`로 둔다(ADR-0015 §6 미결의 답) | ADR-0015 §3.3·§4.3, REQ-F-01, C-127, G-IN-07 | 0 | M3a |
| M3-REQ-02 | F | `F.extensions.spec` §3.2, §3.4, §4.3, §4.6 | on 핸들러와 drive 함수의 효과 목록을 ADR-0015 §3.2 표로 바꾼다. `LoopHandle` "유일한 통로" 주석을 고친다. `requestId` 결정성 규칙(ADR-0015 §3.4)과 `TurnInput.requestId` 순번 문구를 적는다. on 핸들러의 읽기 메서드 호출 불허를 적는다 [결정: review.m3-design-inputs D-M3-31 행 8] | ADR-0015 §3.2·§3.4, REQ-F-02, A-47, B-06, C-128 | 0 ← M3-REQ-01 | M3a |
| M3-REQ-03 | F | `F.records.spec` §10 4, `F.capabilities.spec` §3.2 | `ReplayPolicy` 값 이름은 `safe\|unsafe`를 유지한다 [결정: review.m3-design-inputs D-M3-31 행 1]. `F.records.spec` §10 미결 4에 닫음 표기만 더하고 ADR-0015와 다른 문서는 고치지 않는다 | `review.m3-design-inputs` D-M3-31 행 1, A-04, L1R-09, REQ-F-03 | 0 | M3a |
| M3-REQ-04 | F | `F.records.spec` 도구 이벤트, `F.extensions.spec` 지점 페이로드 | `ToolCallPayload`에 `risk`, `hints`(`ToolHints`), `caller`를 싣는다. `ToolExecutionEndPayload`에 `input`과 `stepId`를 싣는다. `ToolSpec.locks` 자리를 둔다 | M3-02, B-04, TL-06, U-22, U-24, REQ-F-04. Helm §4.6 쓰기 판정과 §10 8·14, 학습 §4.2 step 중복 방지 [가정] | 0 | M3a |
| M3-REQ-05 | F | `F.extensions.spec` 지점 페이로드 | `before_agent_start` 페이로드 필드를 확정한다. M1 밖 지점 페이로드의 `Type.Unknown` 필드를 정확한 스키마로 바꾼다 | U-24, B-17, REQ-F-05. Helm §4.4 주입, §10 14 | 0 | M3b |
| M3-REQ-06 | F | `F.extensions.spec` 지점 페이로드, `F.records.spec` turn 레코드 | `AgentStartPayload`와 turn 레코드에 입력 출처 필드를 더한다. [제안] 이름 `origin`, 값 `"user" \| "scheduled" \| "remote" \| "review"` | M3-13, KN-19, REQ-F-06. 학습 §4.2 입력 출처 판정 [가정] | 0 | M3a |
| M3-REQ-07 | F | `F.capabilities.spec` §4.4 | 도구 없는 능력(`tools: []`)을 허용한다 | §3.8 A-03, X-01, REQ-F-07. L2 다섯 능력 정의 | 0 | M3a |
| M3-REQ-08 | F | `F.records.spec` §3.3, `eng.context-map.design` §5.1 | `LeaseAcquiredPayload.leaseEpoch`를 더한다. 임대 이벤트 이름은 `lease.acquired`·`lease.released`가 정본이고 context-map의 `drive.leased` 표기를 고친다 | A-45, U-28, G-IN-06, REQ-F-08 | 0 | M3a |
| M3-REQ-09 | F | `F.records.spec` 승인 이벤트, F `services/approvals` | 승인 kind `review`를 더한다(M3-09). 질문 도구와 계획 승인을 L1-d 승인 프로토콜 하나로 통합한다 [결정: adr.0018]. 질문·계획·도구·검토 승인을 같은 승인 이벤트와 해결자로 표현하는 종류 판별 필드를 F에 둔다 [제안] | M3-09, D-M3-31 행 7, B-15, AR-01, REQ-F-09. 학습 L-IN-13 | 0 | M3a |
| M3-REQ-10 | F | `F.records.spec` `SpawnOrigin`·`ThreadCreateInput`, F `services/agents` | 자식 생성 때 부모 쓰기 토큰과 부모 초안을 받는 자리, `ChildTurnRequest.tools.deny`를 더한다 | AG-03, AG-04, A-113, REQ-F-10. 학습 L-IN-12 | 0 | M3a |
| M3-REQ-11 | F | F `services/agents`(`F.capabilities.spec` §3.12), `F.records.spec` | 백그라운드 위임의 완료 통지 수단(완료 이벤트 kind 또는 `DelegateReceipt` 상태 조회 메서드), 취소 메서드(`cancel(requestId)` [제안]), `DelegateRequest.report` 선택 필드화를 F 타입에 둔다. 보고는 부모 모델 입력에 넣지 않고 [결정: review.m3-design-inputs D-M3-03 a], 그룹을 끄면 진행 중 위임을 즉시 취소한다 [결정: review.m3-design-inputs D-M3-04 b] | 학습 §4.3 완료 통지 [가정], D-M3-03, D-M3-04, REQ-L1-02, REQ-L1-05 | 0 | M3a |
| M3-REQ-12 | F | `F.extensions.spec` §3.4 지점 선언 | 지점 선언에 실패 정책 필드를 두고 지점별 실패 정책 표를 적는다 [결정: adr.0017]. 권한·차단 지점(`tool_call`, `user_bash`, `project_trust`, `session_before_*`, 가드레일 지점)은 fail-closed, 관찰·추가 지점(`tap`, `collect`)은 fail-open, 변형 지점(`chain`)은 그 핸들러만 건너뛴다. `session_before_compact`는 fail-open 예외로 적는다 [제안] | §3.8 A-24, PS-04, D-M3-10 | 0 ← M3-REQ-106 | M3a |
| M3-REQ-13 | F | `F.capabilities.spec` §3.1, `F.extensions.spec` §3.2 | 서비스 키는 A안이다. F는 `ServiceKey<Api>`만 두고 Cordis 선언 병합에 묶이지 않는다. `ScopeApi.provide`는 F에 두지 않고 X `hostOf(g).provide`로 둔다 [제안] | §3.8 A-01, A-44, U-05, REQ-X-09. Helm §10 C1, 학습 §10 11 | 0 | M3a |
| M3-REQ-14 | F | `F.records.spec` 레코드 카탈로그 | artifact·schedule 레코드 카탈로그를 더한다 | B-07, M3-new-11, M3-new-12 | 0 | M3b |
| M3-REQ-15 | F | `F.wire-settings.spec` 설정 wire | `settings.readFile`·`writeFile`, `settings.list`의 range 병합(또는 F 공통 병합 함수), `SettingsTab`(`sandbox` 포함)과 `SettingUi` 편집기 힌트, `EffectiveSetting`의 관리 잠금 사유, 사용량 wire를 더한다 | M3-19, B-01, U-50, U-88, U-89, U-91, U-92, A-70, M3-new-06 | 0 | M3b |
| M3-REQ-16 | F | `F.wire-settings.spec` 명령·알림 wire | `status.list`, `attachments.add`, `notify.list`와 알림 전달 메서드를 더한다. 알림은 연결된 클라이언트 모두에 보내고, 클라이언트 창이 앞에 있어도 기본으로 보내며, 설정으로 조정한다 [결정: review.m3-design-inputs D-M3-17]. 웹·모바일 푸시 알림은 후순위다 | M3-20, M3-11, B-02, DG-04, D-M3-17 | 0 | M3b |
| M3-REQ-17 | F | `F.wire-settings.spec` 비밀 wire | `SecretEntryOffer`의 add용 메타, `secret.test` 결과 확장(길이, 해시 앞 8자), 값 열람 경로를 정한다 | B-03, B-19, U-51, U-52, M-17, M3-new-06 | 0 | M4 |
| M3-REQ-18 | F | `F.wire-settings.spec` 지식 wire | 지식 제안 대기열의 목록·결정 wire를 더한다. 대기열은 둘(학습 그룹 `x_learning_proposals`, L2.knowledge 쓰기 승인 대기열)이고, 이 wire는 두 출처를 한 목록으로 보이는 조회와 결정이다 [결정: review.m3-design-inputs D-M3-32 a](학습 §8.1 REQ-LN-10) | M3-18, KN-05, REQ-L2-02, REQ-LN-10 | 0 | M3a |
| M3-REQ-19 | F | `F.wire-settings.spec` §3.3.1, §3.5.2, §10 4 | 서비스 인증: 로컬 Unix 소켓은 파일 권한, TCP로 열 때만 `host.hello` `auth` 필수와 `host.authFailed` [결정: review.m3-design-inputs D-M3-16 c]. 재접속용 `approval.list`, `thread.open` 결과의 item 목록과 `asOfSeq`, 안전 모드 표시 필드를 더한다 | D-M3-16, A-16, U-45, U-75, U-76, A-34, M3-new-04, M3-new-05 | 0 | M4 |
| M3-REQ-20 | F | `F.conversation.spec` | pi 메시지 스키마를 TypeBox로 다시 정의해 깊은 검증을 한다 | A-12, M3-new-15, `product.scope.spec` §4.3 | 0 | M4 |
| M3-REQ-21 | F | `F.wire-settings.spec` `SettingUi` | `ui.label`·`ui.description`을 메시지 키(생성 TS id)로 바꾼다. ko·en 카탈로그(JSON)는 `xeon/packages/client`에 둔다 [제안]. wire 오류는 `kind`와 인자를 싣고 문장은 클라이언트가 만든다. 모델용 도구 설명은 영어 원문을 유지한다 [결정: adr.0016] | D-M3-27, U-87, WS-08, M3-39 | 0 ← M3-REQ-111 | M4 |
| M3-REQ-105 | F | `F.extensions.spec` §3.2, §3.4, §4.1 | 4번째 fold `collect`를 더한다 [결정: adr.0017]. 모든 핸들러의 반환값을 등록 순서대로 모으고, 예외를 낸 핸들러는 그 기여만 빼고 계속한다(fail-open). `Fold` 타입, `Handler` 시그니처, 지점 선언 표의 fold 배정을 고친다. 배정 후보는 `resources_discover`, `before_agent_start`의 message 수집, boundary 엔트리 추가다 [제안] | D-M3-10, A-21, A-23, `F.extensions.spec` §10 boundary fold 항목 | 0 ← M3-REQ-106 | M3a |
| M3-REQ-106 | F | `F.extensions.spec` §3.4, §4.10, `xeon/packages/contracts/src/extensions/points/*`. 지점 이름을 인용하는 `L1.loop.spec`, `L1.tools.spec`, `X.primitives.spec`, L3 문서 | 지점 이름을 자체 규칙으로 정리한다. M3 F 첫 작업이다 [결정: adr.0017]. pi snake_case 정본 제약을 없애고, 규칙과 새 이름표(옛 pi 이름 대응 열 포함)를 `F.extensions.spec` §3.4에 둔다. 별칭은 두지 않는다 [제안]. 코드 `POINTS`와 문서 대조 스크립트(F.extensions.plan E9)를 함께 고친다 | D-M3-10, D-M3-11 c, `F.extensions.spec` §4.10 | 0 | M3a |
| M3-REQ-107 | F | `F.extensions.spec` §3.4, §3.5 | 가드레일 지점 셋을 선언한다: 모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전 [결정: adr.0017]. fold는 `first`, 실패 정책은 fail-closed, 결정은 통과·차단만이고 값을 바꾸지 않는다 [제안]. 내장 검사는 두지 않는다 [결정: review.m3-design-inputs D-M3-30 행 1]. 이름은 M3-REQ-106의 규칙을 따른다 | D-M3-30 행 1, D-M3-10, G-IN-17 | 0 ← M3-REQ-106 | M3a |

### 3.2 X (확장 메커니즘)

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-22 | X | `X.primitives.spec` §4.4.3, §4.4.4, §4.6, §9 | 능력 래퍼(`g.capability`)가 ambient 문맥으로 on·drive 호출을 구별해 ADR-0015 §3.2 표대로 거부한다. 기본 `requestId`는 `loop.turn`·`loop.spawn`에만 준다(`${leaseId}:${순번}`). drive 안 능력 읽기는 `requestId`를 생략해도 되고, drive 안 `idempotent` 쓰기와 on 문맥의 `g.delegate`·능력 쓰기는 scope id로 시작하는 명시 키만 받는다. `leaseId`가 재시작·재활성화 뒤 바뀌면 기본 키가 달라져 멱등이 깨지므로, 유지 규칙(M3-REQ-25, REQ-X-04)이 닫힌 뒤에 쓰기에도 기본 키를 줄지 다시 본다(ADR-0015 §3.4 3번). `effects` 계수 규칙과 래퍼 시험을 적는다 | ADR-0015 §3.1·§3.4·§3.6, REQ-X-01, G-IN-01. Helm §4.5 `gatherContext`·`linkWork`, 학습 §4.3 | 1 ← M3-REQ-01, 02 | M3a |
| M3-REQ-23 | X | `X.primitives.spec` §4.6.1 | `expectStateRev` CAS와 `state_conflict`는 이미 정의돼 있다. 남은 것은 같은 프로세스 안에서 같은 scope의 커밋 직렬화(또는 재시도 규칙)다. [제안] scope별 직렬 큐를 X가 둔다. 정해지면 Helm `updateState` 큐를 지운다 | U-20, H-IN-09, REQ-X-02. Helm §10 6 | 1 | M3a |
| M3-REQ-24 | X | `X.primitives.spec` §4.6.1, §4.6.4 | `record`와 상태 `commit`을 한 트랜잭션으로 묶는 API를 둔다. [제안] `commit(next, { records })` 형태 | U-23, H-IN-10, REQ-X-03. Helm §4.8, §10 10 | 1 ← M3-REQ-23 | M3a |
| M3-REQ-25 | X | `X.primitives.spec` §4.4.1, §4.4.4 | 재시작·재활성화 뒤 `leaseId` 유지 규칙과 기본 `requestId`의 재개 안전성을 적는다. `leaseEpoch`(M3-REQ-08)로 같은 임대의 이어짐을 판정한다 | U-21, H-IN-11, REQ-X-04. Helm §4.5, §10 7 | 1 ← M3-REQ-08 | M3a |
| M3-REQ-26 | X | `X.primitives.spec` §4.6.4, `decisions/ADR-0007-ext-points.md` §6 | 그룹 사이 이벤트 격리를 정한다. 기본은 그룹 접두 필터다 | A-29, U-03, L-IN-06, REQ-X-05. 학습 §4.2 | 1 | M3a |
| M3-REQ-27 | X | `X.primitives.spec`(새 절) | 요청 레코드 워커의 소유, 실행 위치, `started`·결과 커밋 순서, 결과 통지를 정한다. [제안] X가 scope마다 효과 워커를 둔다(요청 레코드와 래퍼 검사가 X에 있다) | ADR-0015 §3.5·§6, C-129, G-IN-07, REQ-X-07 | 1 ← M3-REQ-22 | M3a |
| M3-REQ-28 | X | `X.primitives.spec` §4.4.1, §4.5.5 | 임대 충돌 때 대기 기본과 대기 상한(넘으면 거부) [결정: review.m3-design-inputs D-M3-05 a], 유휴 중 임대를 받은 그룹의 자율 turn 허용(임대 상한 안) [결정: review.m3-design-inputs D-M3-06 a]을 반영한다. `DriveArbiter`(정책)와 X(메커니즘)의 분담을 적는다 | D-M3-05, D-M3-06, U-06, U-07, G-IN-04, H-IN-14, REQ-X-08 | 1 | M3a |
| M3-REQ-29 | X | `X.operations.spec` 안전 모드 | 안전 모드에서 L3 내장 그룹(학습)을 싣지 않는다 [결정: review.m3-design-inputs D-M3-07 a]. Helm은 사용자 확장 위치에 설치되는 기본 플러그인이라(D-M3-01 c) `user` 등급 외부 확장과 함께 실리지 않는다 | D-M3-07, A-27, REQ-X-08 | 1 | M3a |
| M3-REQ-30 | X | `X.primitives.spec`, `X.operations.spec` | 서비스 키 A안 래퍼(타입 복원)와 `hostOf(g).provide`를 둔다 | A-01, A-44, G-IN-09, REQ-X-09 | 1 ← M3-REQ-13 | M3a |
| M3-REQ-31 | X | `X.loading-trust.spec` | 외부 확장이 공급하는 능력의 `idempotent` 선언을 믿는 조건(신뢰 등급, 적합성 시험 강제 방법)과 `trust.level` 값 집합, 외부 그룹 신뢰 등급을 정한다 | ADR-0015 §4.2·§6, C-130, A-48, U-35, G-IN-16, REQ-X-10 | 1 ← M3-REQ-01 | M3b |
| M3-REQ-32 | X | `X.operations.spec` | 샌드박스 강제 위치(L0 실행 경로)와 `tool_call` 지점 처리 순서를 적는다. Helm 쓰기 거부(`first`)가 샌드박스 검사보다 먼저 돈다 [제안] | A-26, H-IN-16, REQ-X-11 | 1 | M3b |
| M3-REQ-33 | X | `X.primitives.spec` | Cordis dispose와 `onDispose`의 정리 순서를 적는다(그룹 끄기 때 위임 취소 M3-REQ-65와 같은 순서표) | A-25, G-IN-08, REQ-X-12 | 1 | M3a |
| M3-REQ-34 | X | `X.loading-trust.spec`, `X.operations.spec` | 외부 확장 로더(자체 확장 API만)와 안전 모드를 정한다 [결정: review.m3-design-inputs D-M3-11 c]. pi 어댑터, pi 가상 모듈, `x.loading-trust.piCompat`, pi 확장 디렉터리는 두지 않는다. 외부 훅은 M3 밖이고 M4로 옮겼다 [결정: 2026-10-28 사용자]. `ExtHost.install` 취소 신호, 등록부 payload 검사, 확장 서브에이전트 정의 위치를 포함한다. 비협조 확장 코드는 같은 프로세스의 한계를 받아들이고 격리는 M4다 [가정: D-M3-11 행 5는 답이 없어 권고를 적용] | M3-15, D-M3-11, B-13, A-58, A-116, U-97, AG-08, DG-11 | 2 ← M3-REQ-31 | M3a |
| M3-REQ-35 | X | `X.operations.spec` | 자동 끄기 알림 `scope.handler_failed`를 발신한다. 자동 끄기는 프로세스 단위이고 설정 파일에는 사용자 조작만 쓴다 | M3-22, §3.8 A-30 | 1 | M3b |
| M3-REQ-36 | X | `X.operations.spec`, `L1.persistence.spec` | 필수 투영기 예외 격리 경로와 예외 주입 시험을 정한다 | M3-31, A-37, PS-08 | 1 | M3b |
| M3-REQ-37 | X | `X.primitives.spec` | 웹 검색 플러그인 provider 등록 API를 둔다 | M3-12, WB-19 | 1 | M3b |
| M3-REQ-38 | X | `X.loading-trust.spec` | 서비스 모드에서 프로젝트 확장 단위, 신뢰 프롬프트를 보낼 클라이언트, thread 없는 신뢰 발화 경로를 정한다 | A-60, M-12, M3-15 | 1 ← M3-REQ-19 | M3b |
| M3-REQ-39 | X | `X.primitives.spec` | 계측·승격 집계용 내구 이벤트 조회(kind 접두 필터)와 도구 소유 scope 조회를 둔다 | `L3.group-kit.spec` §3.13 5번, G-IN-11, U-30, M3-new-09 | 2 ← M3-REQ-26 | M3b |
| M3-REQ-40 | X | `X.operations.spec` | 기본 예산 값(30·10·5·1·2초)과 자동 끄기 기준을 실측으로 조정한다 | A-36, M3-29 | 4 | M4 |
| M3-REQ-41 | X | `X.primitives.spec` §4.4.1 | 탐구가 없는 turn마다 임대 부여·`idle` 반납이 생기는 비용이 측정으로 문제가 되면 후보 제외 조건을 둔다. 문제가 없으면 행을 닫는다 | H-IN-15, U-25. Helm §10 13 | 4 | M3b |
| M3-REQ-108 | X | `X.primitives.spec` 디스패치 절 | `collect` fold 합성, 지점 선언의 실패 정책 적용(선언값 우선, 없으면 fold별 기본), 가드레일 지점의 fail-closed 디스패치, 수명주기 지점 디스패치(디스패치 키는 이벤트 id)를 구현 규칙으로 적는다 | adr.0017, D-M3-10, D-M3-30 행 1 | 1 ← M3-REQ-12, 101, 105, 107 | M3a |
| M3-REQ-110 | X | `X.loading-trust.spec` §4.2, §4.4 | 자체 확장 SDK 모듈(`@xeon/contracts`, `@xeon/group-kit`, `typebox`)을 X 로더가 가상 모듈로 등록해 플러그인 번들이 호스트와 같은 인스턴스를 쓰게 한다 [제안]. 릴리즈에 든 기본 플러그인(Helm)을 첫 실행 때 사용자 확장 위치(`<userDir>/extensions/helm/`)에 설치하는 경로와 앱 갱신 때 교체 규칙을 적는다 [제안]. 설치 위치가 `user`라 신뢰 상한은 `user`이고 안전 모드에서 실리지 않는다 | D-M3-01 c, D-M3-11 c, D-M3-07 a | 2 ← M3-REQ-34 | M3a |

### 3.3 L0 (플랫폼)

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-42 | L0 | `L0.process.spec` 서비스 모드 | 등록 파일, `ensure`, 이중 기동 방지, 유휴 판정, 감독을 구현 범위로 확정한다. 유휴 판정에서 승인 대기 세션은 live다 [결정: review.m3-design-inputs D-M3-13 행 2] | M3-new-04, D-M3-13 행 2, A-95, TL-01, U-46 | 1 | M3b |
| M3-REQ-43 | L0 | `L0.process.spec` 인증 | Unix 소켓은 파일 권한(0600)으로 막고, TCP로 열 때만 토큰을 검사한다. TCP 열기 옵션과 토큰 회전을 적는다 | D-M3-16, A-16 | 1 ← M3-REQ-19 | M3b |
| M3-REQ-44 | L0 | `L0.process.spec` 전송 | `connectServiceTransport`로 SSH 터널·사설망 접속을 지원하고 PR-20 중계 시험을 둔다. 원격 형태는 둘이다: (1) 자체 호스트 서버에서 켜 둔 호스트에 다른 기기의 데스크톱·CLI가 접속, (2) 자기 컴퓨터에서 데스크톱·CLI가 호스트를 켜서 실행 [결정: review.m3-design-inputs D-M3-17]. 웹 클라이언트는 M3에 넣지 않는다. 웹 UI는 M4다 [결정: 2026-10-28 사용자] | M3-new-05, B-11, D-M3-17 행 1, `review.decisions-2` U-11 | 1 ← M3-REQ-42, 43 | M3b |
| M3-REQ-45 | L0 | `L0.exec.spec` | `ExecService.withCwd`의 세션별 cwd를 서비스 모드 시험으로 확인한다 | A-100, M3-new-04 | 2 ← M3-REQ-42 | M3b |
| M3-REQ-46 | L0 | `L0.exec.spec` §10 6 | 무인 경로(예약, 루프)의 명령 실행 안전 시간 상한을 둔다. 일반 대화의 `l0.exec.defaultTimeoutMs`는 0(제한 없음)을 유지하고 무인 경로 값은 호출자가 넘긴다 | M3-16, A-103 | 1 | M3b |
| M3-REQ-47 | L0 | `L0.exec.spec` | spill 파일의 삭제 시점, 보관 정리, 디스크 상한을 정한다. 보존 기본값은 지우지 않음이다 [결정: review.m3-design-inputs D-M3-21 a] | A-98, M3-24, D-M3-21 | 1 | M3b |
| M3-REQ-48 | L0 | `L0.os.spec` | 워크트리 연산(`create`, `list`, `remove`)과 파일 감시 root 완화를 정한다. 감시 책임은 작업 공간 exec, 앱 설정·스킬·플러그인 디렉터리 os다. `@parcel/watcher` 정확한 버전을 적는다 | M3-07, SC-01, §3.8 A-72, A-80 | 1 | M3b |
| M3-REQ-49 | L0 | `L0.os.spec` | 설정 파일 외부 변경을 `OsService.watch`로 감시해 통지한다 | M3-new-08, M-16 | 1 ← M3-REQ-48 | M3b |
| M3-REQ-50 | L0 | `L0.os.spec` `Notifier` | `NotifierProvider` 1차(macOS, Linux)를 구현 범위로 확정한다. 클라이언트 창이 앞에 있어도 기본으로 보내고, 설정으로 끌 수 있게 한다 [결정: review.m3-design-inputs D-M3-17]. WSL 토스트는 쓰지 않는다 | M3-11, B-12, D-M3-17 행 2·3, §3.8 A-74 | 1 | M3b |
| M3-REQ-51 | L0 | `L0.os.spec` | `OsService.fileLock`을 더한다. 대상은 `settings.json`과 지식 파일이다 | M3-23, A-82, KN-16 | 1 | M4 |
| M3-REQ-52 | L0 | `L0.os.spec` | `l0.os.log.level` 적용 잔여, 로그 회전, `traceparent`·telemetry 설정, 확장 진단 배열 상한을 정한다 | M3-22, M3-24, M3-32, A-80 | 1 | M4 |
| M3-REQ-53 | L0 | `L0.os.spec` | 번들 외부 바이너리(macOS의 sops, age, rg) 경로를 앱 자원 디렉터리에서 찾는다. Linux의 bwrap, socat은 시스템 패키지로 요구하고 doctor가 안내한다 [결정: review.m3-design-inputs D-M3-25 행 5]. 대상은 macOS 14 이상 arm64, Linux x86_64·arm64이고 Intel macOS는 빌드하지 않는다(D-M3-25 행 2·3). 읽기 전용 자원 디렉터리 위치를 정한다 | M3-26, D-M3-25 행 5, U-96, WS-04 | 1 | M4 |
| M3-REQ-54 | L0 | `L0.os.spec`, `F.wire-settings.spec` | 제품 이름에 묶인 값(앱 디렉터리 이름, 설정 파일 이름, 사용자 대행 UA)을 상수 한 곳에서 읽게 한다. M3 값은 `xeon`이고 M4 전에 바꾼다 [결정: review.m3-design-inputs D-M3-24 b] | D-M3-24, C-001, C-011, WB-16, ADR-0014 §3.3 | 1 | M4 |
| M3-REQ-55 | L0 | `L0.sandbox.spec` | 네트워크는 기본 허용하고 차단 도메인 목록(`l0.sandbox.network.blockedDomains` [제안])을 관리한다. 자격 파일(`~/.npmrc`, `~/.config/gh` 등) 읽기는 기본 허용하고 설정(`l0.sandbox.credentialFiles` [제안])으로 거부할 수 있다. `escapeRetry`는 기본 끔이고 켜도 매번 승인한다 [결정: review.m3-design-inputs D-M3-18]. `tool.sandbox_bypassed` 감사 이벤트 소유를 적는다 | M3-14, D-M3-18, A-63, A-64, A-66, A-69 | 1 · CI bwrap 시험과 macOS Seatbelt 결과(`review.m3-plan` §6) | M3b |
| M3-REQ-56 | L0 | `L0.sandbox.spec` | 브라우저 provider(Stagehand 기본, D-M3-23) 실행용 중첩 사용자 네임스페이스 허용을 정한다 | A-68, M3-new-13 | 1 ← M3-REQ-55 | M3b |
| M3-REQ-57 | L0 | `L0.sandbox.spec`, `L0.process.spec` | MCP stdio 서버의 출처별 샌드박스 기본값(프로젝트 출처 켬, 사용자 출처 끔)과 서버별 설정을 실행 경로에 적용한다 [결정: review.m3-design-inputs D-M3-19 행 1] | D-M3-19 행 1, A-65, MC-04, ADR-0011 §3.7 | 1 ← M3-REQ-55 | M3b |
| M3-REQ-58 | L0 | `L0.process.spec`, `L0.secrets.spec` | 비밀 env를 쓰는 MCP stdio 서버의 기동 승인 증거를 서버 정의 해시 단위로 한 번 받는다. 정의가 바뀌면 다시 받는다. D-M3-19 행 2는 명시 답이 없어 권고를 적용했다 [가정] | M3-05, A-96, MC-11, D-M3-19 행 2 | 1 | M3b |
| M3-REQ-59 | L0 | `L0.secrets.spec` §3.5 | 이미 기록된 이벤트의 비밀 사후 가림: 표시·내보내기·모델 입력 단계에 `Redactor` 적용 지점을 두고 원본 행은 그대로 둔다. 키 회전 안내 문구를 둔다 [결정: review.m3-design-inputs D-M3-20 b] | D-M3-20, A-87, M3-33, `architecture.security.spec` | 1 | M4 |
| M3-REQ-60 | L0 | `L0.secrets.spec` | 헤더 비밀 치환(`withHttp`, 전송 직전 읽기)을 웹 검색 플러그인 provider 경로에 공개한다 | M3-12, WB-18 | 1 | M3b |
| M3-REQ-61 | L0 | `L0.secrets.spec` | 감사 파일의 프로세스 간 정리 잠금과 세션 밖 관리 레코드 저장 위치를 정한다 | B-18, A-83 | 1 ← M3-REQ-51 | M3b |
| M3-REQ-62 | L0 | `L0.store.spec` | 범위 핸들 소유자(`cap.*`, `ext.*`)의 `pinBlob`, 참조 없는 블롭 GC, 보존 기본값(지우지 않음, 설정 화면에서 기간 지정)을 정한다 [결정: review.m3-design-inputs D-M3-21 a] | M3-24, A-105, A-109, D-M3-21 | 1 | M3b |
| M3-REQ-63 | L0 | `L0.store.spec` | DB 내보내기, `future_version` DB 읽기 전용 열기, 복구 런북 근거를 정한다 | M3-25, B-08, B-09 | 1 | M3b |
| M3-REQ-64 | L0 | `L0.store.spec`, `L0.os.spec` | macOS `fullfsync` 기본값, 접두 밖 문장 거부의 운영 빌드 적용, `processStartFingerprint` macOS 수단을 실측으로 정한다 | A-106, A-107, A-81, M3-29, M3-new-16 | 4 | M4 |

### 3.4 L1 (코어)

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-65 | L1 | `L1.agents.spec` §3.3, §4.7 | 백그라운드 위임(`delegate`)의 스텁을 해소하고, 완료 통지(M3-REQ-11), 취소, 부모 대화 삭제 때 보고 처리를 정한다. 그룹 끄기 때 진행 중 위임은 즉시 취소한다 [결정: review.m3-design-inputs D-M3-04 b] | CD-01, AG-10, D-M3-04, REQ-L1-02, M3-new-02. 학습 §4.3, §10 7 | 2 ← M3-REQ-11, 69 | M3a |
| M3-REQ-66 | L1 | `L1.agents.spec` §3.2 `ReportDelivery`, §4.6 | 보고는 부모 모델 입력에 넣지 않고 그룹이 완료 통지로 읽는다. `DelegateRequest.report`는 선택 필드다 [결정: review.m3-design-inputs D-M3-03 a] | U-10, REQ-L1-05. 학습 §4.3 완료 보고, §10 4 | 2 ← M3-REQ-11 | M3a |
| M3-REQ-67 | L1 | `L1.agents.spec`, `L1.tasks.spec` | 그룹 위임의 caller 표기, 포그라운드·백그라운드 자식의 subagents 풀 공유, 임대 밖 위임의 상한 귀속을 정한다 | AG-13, AG-02, U-08, L-IN-07, REQ-L1-03 | 2 | M3b |
| M3-REQ-68 | L1 | `L1.agents.spec` §4.1, §4.3 | 자식 대화에서 지점이 발화하는지와 그룹 핸들러 적용 범위를 정한다. Helm explorer의 쓰기 거부와 학습 검토 포크의 집계 제외가 이 규칙에 기댄다 | U-02, L-IN-05, REQ-L1-04. Helm §4.6 [가정], 학습 §4.2 [가정] | 2 ← M3-REQ-26 | M3a |
| M3-REQ-69 | L1 | `L1.agents.spec` §4.5, §4.7, `L1.loop.spec` §4.8 | `delegate`와 `loop.spawn`의 (thread, `requestId`) 멱등을 세션 DB에 커밋해 재시작 뒤에도 유지한다. 지금은 프로세스 메모리 64개다. "재생 2회, 효과 1회" 시험을 둔다 | ADR-0015 §3.2·§4.3, REQ-L1-01, LP-01, SC-04 | 2 ← M3-REQ-02 | M3a |
| M3-REQ-70 | L1 | `L1.agents.spec` §4.3 | 검토 포크의 사용량 부모 귀속, 캐시 접두 공유 조건(모델, 도구 배열, 시스템 프롬프트, 메시지 접두 유지), `tools.keepParentList` 실행 시점 거르기를 확정한다 | 학습 §4.3 포크 실행 속성 [가정] | 2 | M4 |
| M3-REQ-71 | L1 | `L1.tools.spec` §3.6, §4.2 | `ToolCallPayload`에 `risk`·`hints`·`caller`를 채우고 `tool_execution_end`에 `input`을 싣는다. `ToolSpec.locks`를 구현한다 | M3-02, TL-06, H-IN-07 | 2 ← M3-REQ-04 | M3a |
| M3-REQ-72 | L1 | `L1.tools.spec` §3.6 | 승인 만료(`expiresAt`, `expired` 해결자)를 구현한다. 만료 기본값을 정한다 | M3-06, B-05, DG-12 | 2 | M3a |
| M3-REQ-73 | L1 | `L1.tools.spec` §3.5, §3.6 | 무인 승인 정책: 예약 실행 세션은 대기하고 승인 만료 뒤 거부로 끝내는 것이 기본이고, 설정(`l1.tools.unattended.approval` [제안])으로 대기·거부·만료 뒤 거부 가운데 고른다 [결정: review.m3-design-inputs D-M3-12]. print 모드는 사전 허용 규칙만 적용하고 나머지는 거부하며, 전체 자동 승인 플래그를 옵션으로 둔다 [결정: review.m3-design-inputs D-M3-14]. 승인 origin 구현을 정리한다 | D-M3-12, D-M3-14, M3-08, M3-21, SC-03, U-54 | 2 ← M3-REQ-72 | M3a |
| M3-REQ-74 | L1 | `L1.tools.spec` §3.6 | 승인 kind `review`와 질문·계획 승인 단일 프로토콜(adr.0018)을 구현한다 | M3-09, C-123, AR-01 | 2 ← M3-REQ-09 | M3a |
| M3-REQ-75 | L1 | `L1.tools.spec` | MCP 비밀 env 서버의 승인 레코드에 정의 해시를 싣는다 | M3-05, MC-11 | 2 ← M3-REQ-58 | M3b |
| M3-REQ-76 | L1 | `L1.tools.spec`, `L1.persistence.spec` | 재실행 시도 횟수(`MAX_REPLAY_ATTEMPTS`) 기록을 맞춘다. `ReplayPolicy` 값 이름은 `safe\|unsafe` 그대로다(D-M3-31 행 1) | L1R-09, REQ-F-03 | 2 ← M3-REQ-03 | M3a |
| M3-REQ-77 | L1 | `L1.loop.spec` §4.1, §4.4 | 입력 출처를 `AgentStartPayload`와 turn 레코드에 채운다. 큐 입력과 drive turn 요청이 함께 기다리면 큐 입력이 먼저다 [제안] | M3-13, LP-06, REQ-F-06. 학습 §4.2 | 2 ← M3-REQ-06 | M3a |
| M3-REQ-78 | L1 | `L1.agents.spec`, `L1.tools.spec` | 서브에이전트 `tools.deny` 거부와 확장 티어 규칙 등록 경로를 둔다. 검토 포크 도구 정책 `tools.allow`·`keepParentList`의 실행 시점 거부와 `denyHint`, 확장 도구 티어에서 `learning_propose`가 허용 목록에 들어갈 수 있는 경로를 포함한다 | AG-04, M3-33, REQ-F-10, L-IN-12, REQ-LN-11 | 2 ← M3-REQ-10 | M3a |
| M3-REQ-79 | L1 | `L1.loop.spec` §4.9, `L1.agents.spec` §3.4·§4.8, `L1.models.spec` | 목표 판정: `completeStructured`, `agent_before_settle` 연결, `agent.judged` 자기 커밋, 판정 호출 실패 때 `stop`, `l1.agents.judge.maxRuns` 도달 때 turn 종료와 알림 [결정: review.m3-design-inputs D-M3-15] | M3-new-02, D-M3-15, LP-11, MD-09, AG-05 | 2 | M3a |
| M3-REQ-80 | L1 | `L1.persistence.spec` | `l1.persistence.autoResume` 기본 거짓(서비스 모드에서 켬), `replayFrom` 의미, 보관 정리 때 `oldestReplayableSeq` 올림을 정한다 [결정: review.m3-design-inputs D-M3-13 행 1] | D-M3-13 행 1, LP-02, PS-10, PS-09 | 2 ← M3-REQ-42 | M3b |
| M3-REQ-81 | L1 | `L1.persistence.spec`, `L1.loop.spec` | 재개 때 모델 요청 재전송 정책(체크포인트 재전송 또는 요청별 멱등 키)을 정한다 | A-06, M3-33 | 2 | M3b |
| M3-REQ-82 | L1 | `L1.persistence.spec` | `settings.json` 쓰기에 프로세스 간 잠금을 적용한다 | M3-23 | 2 ← M3-REQ-51 | M3b |
| M3-REQ-83 | L1 | `L1.persistence.spec` | 대화 자동 제목(모델 호출)과 fork thread의 원본 history 연속성을 구현한다 | M3-36, M3-37, B-10, M-14 | 2 | M3b |
| M3-REQ-84 | L1 | `L1.persistence.spec` | 보관 정리와 블롭 GC를 L0 규칙에 연결한다 | M3-24, D-M3-21 | 2 ← M3-REQ-62 | M3b |
| M3-REQ-85 | L1 | `L1.models.spec` | 계정 풀과 레이트 리밋을 정한다. 회전 대상은 API 키 계정과 구독 계정 모두이고 기본 꺼짐과 첫 사용 고지(약관 위험)를 둔다 [결정: review.m3-design-inputs D-M3-22 행 2]. 위장 provider는 기본 꺼짐과 첫 사용 고지를 단 별도 플러그인이다(D-M3-22 행 1). 그룹이 새 모델 역할을 등록하지 않는다는 규칙을 [제안]으로 적는다(Helm 렌즈는 기존 역할과 그룹 설정의 모델 지정) | MD-08, D-M3-22, MD-04, REQ-L1-06, M3-new-07. Helm H-IN-03 | 2 | M3b |
| M3-REQ-86 | L1 | `L1.context.spec` | 최근 읽은 파일 재주입, 메모리 스냅샷·스킬 인덱스 위치와 컴팩션 뒤 재주입을 정한다 | CX-09, KN-09, L-IN-15, REQ-L2-03 | 2 | M3b |
| M3-REQ-87 | L1 | `L1.loop.spec` | 기본 프롬프트 문안(응답 언어, 도구 사용 규칙)을 쓰고 게이트 상한·반복 감지 임계를 테이프 시험으로 조정한다 | LP-10, LP-07, M3-new-14 | 4 | M4 |
| M3-REQ-109 | L1 | `L1.loop.spec`, `L1.tools.spec` | 가드레일 지점의 발화 위치를 정한다. 모델 요청 직전(요청 변형 chain 뒤 [제안]), 도구 호출 직전(정책·승인 판정 뒤, 실행 직전 [제안]), 출력 표시·실행 직전(최종 어시스턴트 메시지 커밋 전과 산출물 적용 전 [제안])이다. 차단 사유는 대화 기록에 남긴다. 수명주기 지점(위임 정착, 임대 거부)은 해당 이벤트 커밋 뒤에 발화한다 | adr.0017, D-M3-30 행 1, REQ-LN-02 | 2 ← M3-REQ-107, 108 | M3a |

### 3.5 L2 (능력)

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-88 | L2 | `L2.knowledge.spec`, `L2.work.spec`, `L2.web.spec`, `L2.dialog.spec`, `L2.artifacts.spec`, `L2.schedule.spec`, `L2.mcp.spec`, `L2.workspace.spec` | 메서드마다 `readOnly`·`idempotent`·선언 없음을 분류하고 멱등 쓰기의 내구 기록 근거를 적는다. 공급자 패키지마다 적합성 시험("재생 2회, 효과 1회", 저장소를 닫았다 다시 열기)을 둔다. Helm이 쓰는 `knowledge.search.query`, `knowledge.memory.read`, `web.search`는 `readOnly`, `work.tasks.create`는 `idempotent`, `jobs.spawn`은 `idempotent`다 | ADR-0015 §3.6·§4.3, REQ-L2-01, H-IN-12, SC-04. Helm §4.5·§4.7·§4.8 | 3 ← M3-REQ-01 | M3a |
| M3-REQ-89 | L2 | `L2.knowledge.spec` | 쓰기 메서드의 내구 멱등(`CallOptions.requestId = idempotencyKey`)을 적합성 시험으로 확인한다 | ADR-0015 §6 [가정], L-IN-17. 학습 §3.6 | 3 ← M3-REQ-88 | M3a |
| M3-REQ-90 | L2 | `L2.work.spec` | `work.goals`와 `work.reports`(완료 보고, `/goal`)를 M3에 정한다 [결정: review.m3-design-inputs D-M3-30 행 2]. `work.tasks.create`의 `idempotent: true` 선언을 M3-REQ-88과 함께 적는다 | WK-11, D-M3-30 행 2, H-IN-12 | 3 ← M3-REQ-79, 88 | M3a |
| M3-REQ-91 | L2 | `L2.knowledge.spec`, `eng.context-map.design` §4.1 | 제안 대기열은 둘을 유지한다 [결정: review.m3-design-inputs D-M3-32 a]. L2.knowledge 대기열은 그대로 두고 L4 합침이 쓰는 조회 API만 둔다. 메모리 정본은 마크다운 파일이고 DB는 색인·원장·제안 대기열이다 [결정: review.m3-design-inputs D-M3-08 a]. 프로젝트 스킬은 모델 도구 경로에서 쓰지 못하고 학습 제안 승인 화면에서 사용자가 프로젝트 범위를 고를 때만 쓴다 [결정: review.m3-design-inputs D-M3-09 c]. 이 밖에 쓰기 도구 승인 이중화 방지, 확장의 `decide` 호스트 전용 경로, 원장 `afterUntrusted`를 정한다 | KN-05, KN-07, KN-14, KN-10, KN-20, KN-19, D-M3-08, D-M3-09, REQ-L2-02, REQ-L2-03, M3-18, M3-21. 학습 §10 "설계 질문" 8 | 3 | M3a |
| M3-REQ-92 | L2 | `L2.dialog.spec` | 알림 소유와 `dialog.notify` 구현(분류, emit, list, OS 알림 provider 연결), `status.list`·첨부, 확장 매니페스트 명령 등록을 정한다 | M3-11, M3-20, DG-10, DG-04, DG-11 | 3 ← M3-REQ-16, 50 | M4 |
| M3-REQ-93 | L2 | `L2.schedule.spec` | `cap-schedule`(타이머, 파일 감시, 원격, 루프)을 정한다. 놓친 실행은 1회 따라잡기(`once`)와 최소 간격 300초, 기존 세션 대상 예약은 1차에서 뺀다 [결정: review.m3-design-inputs D-M3-13 행 3·4]. cron 세션 종류, 무인 명령 시간 상한 전달, 루프의 `ActivitySnapshot` 카운터를 적는다 | SC-08, D-M3-13 행 3·4, KN-21, M3-16, M3-10, M-15, M3-new-12 | 3 ← M3-REQ-46, 48, 73 | M3b |
| M3-REQ-94 | L2 | `L2.workspace.spec` | `write`·`edit`·`grep`·`find`, 원자적 쓰기와 동시 변경 감지, `find` 엔진(rg)을 정한다 | WS-10, WS-02, WS-04, M3-new-10 | 3 ← M3-REQ-53 | M3b |
| M3-REQ-95 | L2 | `L2.artifacts.spec` | 리뷰·diff 승인(승인 kind `review`), 제목·라벨 메타, 레코드 카탈로그를 정한다 | AR-08, B-07, M3-new-11 | 3 ← M3-REQ-14, 74 | M3b |
| M3-REQ-96 | L2 | `L2.web.spec` | `web.browse`의 브라우저 provider(Stagehand 기본 포함, Playwright MCP 후보, Aside·Ego Lite는 공식 API가 생기면 어댑터), 플러그인 provider와 헤더 비밀, 플러그인 가격표, 자동 선택 순서(설정 화면 드래그앤드롭, 기본 웹 검색 도구 포함, 플러그인 기본 후순위)와 여러 provider 동시 질의, 키 플러그인 첫 사용 고지, robots.txt 기본 무시와 준수 옵션을 정한다. Parallel·Jina는 넣지 않는다 [결정: review.m3-design-inputs D-M3-23] | WB-17, WB-18, WB-19, WB-20, M3-12, D-M3-23, M3-new-13 | 3 ← M3-REQ-37, 56, 60 | M4 |
| M3-REQ-97 | L2 | `L2.mcp.spec` | 정의 `env`·`headers` 평문 허용과 비밀 이름 패턴(`KEY`, `TOKEN`, `SECRET` 등) 거부, sampling 미지원(2026-07-28 MCP 명세 개정에서 Deprecated, SEP-2577), 출처별 샌드박스 설정 키(프로젝트 출처 켬, 사용자 출처 끔), 기동 승인 단위(정의 해시마다 1회)를 정한다 [결정: review.m3-design-inputs D-M3-19]. 행 2·3은 명시 답이 없어 권고를 적용했다 [가정] | D-M3-19, MC-04, MC-05, MC-07, MC-11 | 3 ← M3-REQ-57, 75 | M3b |
| M3-REQ-98 | L2 | `L2.knowledge.spec` | 인덱스 예산(8,000자), 설명 자르기(160자), 2글자 질의 LIKE 탐색 범위를 측정으로 조정한다 | KN-11, KN-13, M3-29 | 4 | M3b |


### 3.6 그룹 트랙 추가 요구 (학습 §8.1, Helm §4.13)

학습 §8.1의 요구 가운데 앞 표에 없던 것과 Helm 대기 거부 통지에서 나온 요구다. 같은 ID의 다른 쪽 행과 겹치는 부분은 이유 칸에 적었다.

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-99 | F | `F.records.spec` 이벤트, F `services/groups.ts`(`F.capabilities.spec` §3.12), `X.primitives.spec` | 내구 이벤트 `lease.rejected`(페이로드 `groupId`, `reason`, 거부된 요청의 `requestSeq`) [제안]와 화면용 `GroupStatus.drive`의 `"rejected"` 값을 더한다. X는 대기 상한 거부 때 이벤트를 커밋하고 group-kit이 `GroupStatus`를 채운다(group-kit plan G-30). Helm 핸들러는 수명주기 지점(M3-REQ-101)으로만 읽는다. 대기 기본과 상한 뒤 거부는 [결정: review.m3-design-inputs D-M3-05 a]다 | Helm §4.13 D-M3-05, REQ-X-08, M3-REQ-28 | 0 ← M3-REQ-08, 101 | M3a |
| M3-REQ-100 | F | `F.extensions.spec` §3.4 지점 페이로드 | 학습 REQ-LN-01: `AgentSettledPayload`에 `origin`, `status`, `hasFinalAnswer`, `lastItemId`를 더한다. `origin` 이름과 값은 M3-REQ-06과 같다. 도구 실행 문맥의 `caller.afterUntrusted`를 확장 도구 `execute`에도 넘긴다 | 학습 §8.1 REQ-LN-01, §4.2, §4.3. 학습 plan §3 선행 조건 | 0 ← M3-REQ-06 | M3a |
| M3-REQ-101 | F | `F.extensions.spec`, `X.primitives.spec` | 학습 REQ-LN-02: 그룹이 코어 내구 이벤트(`agent.settled`, `lease.rejected`)를 받는 수단은 수명주기 지점이다 [결정: adr.0017]. 첫 목록은 L3 요구분(위임 정착, 임대 거부)이고 fold는 `tap`(fail-open)이다 [제안]. 핸들러는 재실행되는 코드이고 입력은 이벤트 페이로드뿐이다. 디스패치 키는 이벤트 id. 위임 주체가 그 scope인 이벤트만 넘긴다 | 학습 §8.1 REQ-LN-02, §10 "설계 질문" 10, D-M3-10. 학습 plan §3 선행 조건 | 0 ← M3-REQ-106 | M3a |
| M3-REQ-102 | X | `X.primitives.spec` §4.6.5, §4.6.6 | 학습 REQ-LN-03·04: 구독 핸들러의 디스패치 구현. `recordPrivate`·`record`·`commit`을 확장 도구 `execute`와 명령 처리기에서 부를 때의 ambient(디스패치 키는 도구 호출 id 또는 명령 호출 id). 위임 자식 대화에서 실행된 도구의 기록은 도구가 실행된 대화에 쓴다 [제안] | 학습 §8.1 REQ-LN-03, REQ-LN-04, §3.5, §3.7 | 1 ← M3-REQ-101 | M3a |
| M3-REQ-103 | L1 | `L1.agents.spec` §3.3, §3.5 | 학습 REQ-LN-06·07: `agent.settled` payload에 `requestId`, 위임 주체(`origin.owner`), `status`, 상한 종료 표지(`limitHit`), `usage`를 싣는다. 주체 단위 취소(`CancelTarget{ ownerScopeId }`)로 취소된 자식도 `agent.settled{ aborted }`를 남긴다 | 학습 §8.1 REQ-LN-06, REQ-LN-07, §3.4 `ReviewSettled`. M3-REQ-65와 같은 서비스 변경 | 2 ← M3-REQ-11, 69 | M3a |
| M3-REQ-104 | L2 | `L2.knowledge.spec` §3.2·§3.3·§3.5·§4.5·§4.9 | 학습 REQ-LN-09: 내장 그룹 증거 source `learning.queue`를 믿는 기본 규칙(승인 결정 D-11의 L3 설정 채우기)과, 스킬 쓰기 입력의 `scope: "project"`는 사용자 승인 증거가 있을 때만 받는 규칙을 정한다 [결정: review.m3-design-inputs D-M3-09 c] | 학습 §8.1 REQ-LN-09, §4.5 규칙 3·6·8, D-M3-09 | 3 ← M3-REQ-88 | M3a |


### 3.7 층 공통 (ADR-0020, ADR-0016)

한 층에 속하지 않는 배치 규칙과 여러 층에 걸친 문자열 규칙이다.

| ID | 층 | 소유 문서 | 바꿀 내용 | 이유(원천) | 순서 | 상태 |
|---|---|---|---|---|---|---|
| M3-REQ-111 | 공통 | `architecture.layers.spec` §3.2·§4.1·§4.2, `eng.dependency-rules.guide` 4절, `xeon/scripts/check-layers.ts`, `xeon/scripts/dependency-allowlist.json` | 새 패키지 `xeon/packages/client`(`@xeon/client`, 층 L4, F만 import)를 층 표와 검사에 넣는다. 같은 층 예외 `DR-10/cli-client`, `DR-10/desktop-client`를 허용 목록에 더한다. 연결 코드(`createHostConnection`), 설정 view-model, CLI·데스크톱 공유 로직, i18n 카탈로그를 이 패키지로 옮긴다. F는 순수 계약으로 둔다 [결정: adr.0020] | D-M3-26, U-41, U-56 | 0 | M3a |
| M3-REQ-112 | 공통 | `F.wire-settings.spec` 오류 형식, `L0.os.spec`·`L0.secrets.spec`의 안내 문구, `L1.tools.spec`, L2 각 spec의 사용자 표시 문자열 | 하위 층은 사용자에게 보일 문장을 만들지 않고 오류·안내를 `kind`와 인자로 넘긴다. 시각은 UTC로 저장하고 날짜·숫자 표시는 클라이언트의 `Intl`이 한다 [결정: adr.0016]. 호스트·CLI의 하드코딩 한국어 문자열 이전은 M3의 L4 작업이다 | D-M3-27, M3-39, U-87 | 1 ← M3-REQ-21 | M4 |

## 4. 트랙별 색인

| 트랙 | 요구 행 |
|---|---|
| L3 Helm(M3-01, M3-02, M3-04) | F 01, 02, 04, 05, 13, 99, 101 · X 22, 23, 24, 25, 28, 29, 30, 32, 34, 41, 110 · L1 68, 69, 71, 85 · L2 88, 90 |
| L3 학습(M3-new-03, M3-13, M3-18) | F 01, 02, 04, 06, 09, 10, 11, 13, 18, 100, 101 · X 22, 26, 27, 29, 30, 33, 39, 102 · L1 65, 66, 67, 68, 69, 70, 74, 77, 78, 86, 103 · L2 88, 89, 91, 104 |
| ADR-0015 구현(M3-new-01) | F 01, 02, 03 · X 22, 27, 31 · L1 69, 76 · L2 88, 89 |
| 확장 계약 개정(ADR-0017, 가드레일 지점) | F 12, 101, 105, 106, 107 · X 108 · L1 109 |
| 그룹 공통(group-kit, M3-new-09, M3-17) | F 08, 12 · X 28, 33, 39 |
| 서비스 모드(M3-new-04) | F 19 · X 38 · L0 42, 43, 45 · L1 80, 81 |
| 원격·알림(M3-new-05, M3-11) | F 16, 19 · L0 44, 50 · L2 92 |
| 무인 실행(M3-06, M3-08, M3-16, M3-new-12) | L0 46 · L1 72, 73, 79 · L2 90, 93 |
| 능력 확장(M3-new-10, 11, 13, M3-09, M3-12) | F 07, 14 · X 37 · L0 56, 60 · L1 74 · L2 94, 95, 96 |
| 외부 확장(M3-15) | F 12, 106 · X 31, 34, 35, 38, 110 |
| 보안(M3-05, M3-14, M3-33) | X 32 · L0 55, 56, 57, 58, 59, 61 · L1 75, 78, 81 · L2 97 |
| 설정·UI·다국어(M3-19, M3-20, M3-new-06, M3-new-08, M3-39) | F 15, 16, 17, 21 · L0 49, 51 · L1 82 · 공통 111, 112 |
| 데이터·운영(M3-22~25, M3-31, M3-32, M3-36, M3-37) | X 35, 36 · L0 47, 52, 61, 62, 63 · L1 80, 83, 84 |
| 릴리즈(M3-26, M3-27) | L0 53, 54 |
| 모델(M3-new-07, M3-new-02) | L1 79, 85 |
| 성능·실측(M3-29, M3-new-16) | X 40, 41 · L0 64 · L1 87 · L2 98 |
| 기타(M3-new-15) | F 20 |

## 5. `review.m3-design-inputs` §4.4 대응

| 입력 요구 | 이 문서 | L3 근거(절 번호와 항목 이름) |
|---|---|---|
| REQ-F-01 | M3-REQ-01 | Helm §4.5 능력 호출, 학습 §4.3 |
| REQ-F-02 | M3-REQ-02 | Helm §4.5, group-kit §3.4 |
| REQ-F-03 | M3-REQ-03, 76(D-M3-31 행 1: `safe\|unsafe` 유지) | Helm §8 요구 표 |
| REQ-F-04 | M3-REQ-04, 71 | Helm §4.6, §10 (닫힘) 쓰기 판정 메타 출처 |
| REQ-F-05 | M3-REQ-05 | Helm §8 요구 표 |
| REQ-F-06 | M3-REQ-06, 77 | 학습 §4.2 |
| REQ-F-07 | M3-REQ-07 | — |
| REQ-F-08 | M3-REQ-08 | group-kit §10 "임대 이벤트 이름" 항목 |
| REQ-F-09 | M3-REQ-09, 74(통합은 adr.0018) | — |
| REQ-F-10 | M3-REQ-10, 78 | 학습 §4.3 도구 허용 |
| REQ-X-01 | M3-REQ-22 | Helm §4.5, 학습 §4.3 |
| REQ-X-02 | M3-REQ-23(직렬화만 남음) | Helm §4.1, §8 요구 표 |
| REQ-X-03 | M3-REQ-24 | Helm §4.8, §8 요구 표 |
| REQ-X-04 | M3-REQ-25 | Helm §4.5, §10 (닫힘) `leaseId` 유지 항목 |
| REQ-X-05 | M3-REQ-26 | group-kit §3.7 |
| REQ-X-06 | 행 없음(이미 반영) | `X.primitives.spec` §4.6.5와 `xeon/packages/ext-host/src/primitives/state.ts`에 `recordPrivate`가 있다. Helm §8 요구 표도 "확정"이다. `review.m3-design-inputs`의 REQ-X-06·L-IN-14도 같은 취지로 고쳤다 |
| REQ-X-07 | M3-REQ-27 | — |
| REQ-X-08 | M3-REQ-28, 29, 99 | group-kit §10 "대기 vs 거부"와 "유휴 중 임대 부여" 항목, Helm §4.13 |
| REQ-X-09 | M3-REQ-13, 30 | Helm §10 (닫힘) C1, 학습 §10 (닫힘) 서비스 키 항목 |
| REQ-X-10 | M3-REQ-31 | — |
| REQ-X-11 | M3-REQ-32 | — |
| REQ-X-12 | M3-REQ-33 | — |
| REQ-L1-01 | M3-REQ-69 | 학습 §4.3, §4.10, §9 5 |
| REQ-L1-02 | M3-REQ-11, 65, 103 | 학습 §5 사례 5, §10 "사용자 결정" 3 |
| REQ-L1-03 | M3-REQ-67 | group-kit §3.4 상한 |
| REQ-L1-04 | M3-REQ-68 | 학습 §10 (닫힘) 자식 대화 발화 항목, Helm §4.6 |
| REQ-L1-05 | M3-REQ-11, 66 | 학습 §10 "사용자 결정" 2 |
| REQ-L1-06 | M3-REQ-85 | — |
| REQ-L2-01 | M3-REQ-88 | Helm §4.7·§4.8 |
| REQ-L2-02 | M3-REQ-18, 91(D-M3-32 a: 대기열 둘) | 학습 §10 "설계 질문" 8 |
| REQ-L2-03 | M3-REQ-86, 91 | — |

- 입력 요구 31건 중 30건은 이 문서의 39행으로 옮겼고, REQ-X-06은 이미 반영돼 행을 만들지 않았다. §3.6의 6행(M3-REQ-99~104)은 아래 학습 REQ-LN 대응과 Helm 대기 거부 통지에서 왔다. 나머지 59행은 `review.m3-plan` M3-NN, `review.m3-design-inputs` §5.2 M3-new-NN, 수집 표의 M3 구현 행에서 왔다. M3-REQ-105~112의 8행은 2026-10-26 사용자 결정에서 왔다(§6).

### 5.1 학습 §8.1 REQ-LN 대응

| 학습 요구 | 이 문서 | 비고 |
|---|---|---|
| REQ-LN-01 | M3-REQ-06, 100 | `AgentSettledPayload`의 `origin`, `status`, `hasFinalAnswer`, `lastItemId`. 없으면 검토 포크가 시작되지 않는다(학습 plan §3 선행 조건) |
| REQ-LN-02 | M3-REQ-101, 108, 109 | `agent.settled` 수명주기 지점(adr.0017). 없으면 검토가 한 번만 돈다(학습 §5 사례 15) |
| REQ-LN-03, 04 | M3-REQ-102 | 도구 `execute`·명령 처리기의 ambient, 위임 자식 대화의 기록 위치 |
| REQ-LN-05 | M3-REQ-69 | 위임 멱등의 세션 DB 기록 |
| REQ-LN-06 | M3-REQ-11, 65, 103 | 주체 단위 취소 |
| REQ-LN-07 | M3-REQ-103 | `agent.settled` payload 필드 |
| REQ-LN-08 | M3-REQ-11, 66 | `DelegateSpec.report` 선택화, `delegateStatus`, `cancelDelegates`(group-kit plan G-28, G-29) |
| REQ-LN-09 | M3-REQ-88, 89, 104 | `idempotent` 선언, `learning.queue` 증거, 프로젝트 범위 |
| REQ-LN-10 | M3-REQ-18 | D-M3-32 a. 승인 화면이 두 대기열을 한 목록으로 합친다 |
| REQ-LN-11 | M3-REQ-70, 78 | 검토 포크 도구 정책 |

## 6. 사용자 결정 반영 기록

2026-10-26 사용자 답(`review.m3-design-inputs` §3)을 반영한 행이다. 결정 대기 표기는 모두 지웠다.

| 결정 | 답 | 반영한 행 |
|---|---|---|
| D-M3-01 | c. Helm은 기본 플러그인 | 29, 110 |
| D-M3-03 | a. 보고를 부모 모델 입력에 넣지 않음 | 11, 66 |
| D-M3-04 | b. 그룹 끄기 때 즉시 취소 | 11, 65, 103 |
| D-M3-05, D-M3-06 | a, a. 대기 후 상한 거부, 유휴 자율 turn 허용 | 28, 99 |
| D-M3-07 | a. 안전 모드에서 L3 그룹 끔 | 29, 110 |
| D-M3-08, D-M3-09 | a, c | 91, 104 |
| D-M3-32 | a. 대기열 둘, L4가 합쳐 보임 | 18, 91 |
| D-M3-10 | 권고 확장안(adr.0017) | 12, 101, 105, 106, 107, 108, 109 |
| D-M3-11 | c. 자체 확장 API만, pi 어댑터 없음 | 34, 106, 110 |
| D-M3-12, D-M3-14 | 12 c 기본 + 설정 선택, 14 c 기본 + 전체 자동 승인 옵션 | 73 |
| D-M3-13 | 권고대로 | 42, 80, 93 |
| D-M3-15 | 권고대로 | 79 |
| D-M3-16 | c | 19, 43 |
| D-M3-17 | 원격 두 형태, 알림 기본 보냄 | 16, 44, 50 |
| D-M3-18 | 네트워크 기본 허용 + 차단 목록, 자격 파일 기본 허용 + 옵션 | 55 |
| D-M3-19 | 행 1 출처별, 행 4 sampling 미지원. 행 2·3은 권고 적용 [가정] | 57, 58, 97 |
| D-M3-20 | b | 59 |
| D-M3-21 | a | 47, 62 |
| D-M3-22 | 위장 provider 별도 플러그인, 회전은 API 키·구독 계정 | 85 |
| D-M3-23 | 드래그앤드롭 순서, 동시 질의, robots 기본 무시, Stagehand | 56, 96 |
| D-M3-24 | b. M3는 `xeon` | 54 |
| D-M3-25 | macOS 14 이상 arm64, arm64 Linux, Intel macOS 없음 | 53 |
| D-M3-26 | b 변형(adr.0020) | 111 |
| D-M3-27 | FormatJS(adr.0016) | 21, 112 |
| D-M3-30 | 행 1 가드레일 지점, 행 2 `work.reports` M3 | 90, 107, 109 |
| D-M3-31 | 모두 권고대로. 행 7은 adr.0018 | 02, 03, 09, 74, 76 |

- D-M3-02(학습 기본 켬)는 매니페스트 `defaultEnabled` 값이라 하위 층 행이 없다. D-M3-28(성능 수치), 29(개발 운영)도 하위 층 계약을 바꾸지 않는다. D-M3-31 행 2~6은 해당 spec 문서 작업(설정 우선순위, 신뢰 범위, 위협 모델, M4 이후, ADR-0019 승격)에 걸린다.

## 7. 이 문서가 고치지 않은 다른 문서

| 문서 | 고칠 내용 |
|---|---|
| `review/m3-plan.md` | §1에 이 문서를 M3 계획 입력으로 적는다. M3-01 선행에 M3-REQ-22~25, 69, 88을, M3-02 받는 문서에 M3-REQ-04·71을 더한다 |
| `decisions/ADR-0015-replay-effects.md` | D-M3-31 행 1(`safe\|unsafe` 유지)과 행 8(on 핸들러 읽기 불허)로 §6 미결 둘이 닫힌다. ADR 묶음 작업이 고친다. §6 첫 미결(읽기 표지 이름)은 M3-REQ-01의 [제안] `readOnly`로 닫을 수 있다 |
| `L3/helm/spec.md`, `L3/learning/spec.md`, `L3/group-kit/spec.md` | §8 요구 표의 [가정]·[미결] 칸에 해당 M3-REQ 번호를 단다(Helm: 04, 05, 22~25, 68, 99; 학습: 06, 11, 65, 66, 68, 70, 100~104; group-kit: 11, 28, 39, 99). 요구 번호가 확정된 뒤 L3 문서 개정에서 반영한다 |
| `L3/README.md` | §10.2 미결 2(on 핸들러 효과)를 ADR-0015로 닫는다. 이 작업의 범위 밖 파일이라 고치지 않았다 |

## 8. 미결 사항

- [미결] 백그라운드 위임의 완료를 그룹이 아는 수단: 완료 이벤트 kind를 그룹 on 지점으로 보낼지, `DelegateReceipt` 상태 조회 메서드만 둘지(M3-REQ-11, 65). `L1.agents.spec`과 `F.capabilities.spec` §3.12 작업에서 정한다. 학습 §4.3의 [가정]이 이 답을 기다린다.
- [미결] 입력 출처 필드 이름과 값 집합(M3-REQ-06의 [제안] `origin`). `L1.loop.spec`의 기존 입력 출처 표기가 있으면 그 이름을 따른다.
- [미결] 제품 이름에 묶인 상수의 소유 문서(M3-REQ-54). M3 값은 `xeon`이다(D-M3-24 b). L0.os가 앱 디렉터리 이름을 정하고 F가 서버 이름을 정하는 지금 배치를 유지할지, 한 곳으로 모을지 M4 전 개명 작업 전에 정한다.
- [제안] 요청 레코드 워커는 X가 소유한다(M3-REQ-27). ADR-0015 §6 미결의 답 후보이고 `X.primitives.spec` 작업에서 확정한다.
- [제안] 읽기 표지 이름은 `readOnly`다(M3-REQ-01). ADR-0015 §6 미결의 답 후보이고 `F.capabilities.spec` 작업에서 확정한다.
- 닫음: 사용자 답을 기다리던 조건부 행(M3-REQ-03, 09, 18, 76, 91, 99)은 2026-10-26 답으로 고쳤다(§6).
- 닫음: 외부 훅은 M3 밖이고 M4로 옮겼다(M3-REQ-34) [결정: 2026-10-28 사용자].
- [미결] 지점 이름 규칙과 새 이름표(M3-REQ-106). 가드레일 지점·수명주기 지점의 이름도 이 표에서 정한다. 정하기 전에는 다른 행이 옛 pi 이름을 쓴다.
- [미결] 가드레일 지점의 정확한 발화 위치(M3-REQ-109의 [제안] 세 곳). 특히 "출력 표시·실행 직전"이 스트리밍 중 부분 출력에도 걸리는지 `L1.loop.spec` 작업에서 정한다.
- [가정] 플러그인 번들이 가상 모듈로 받은 `@xeon/group-kit`이 호스트 쪽 인스턴스와 같다(M3-REQ-110). `Bun.plugin` 모듈 등록의 프로세스 전역 동작에 기댄다. 스파이크로 확인한다.
- [가정] D-M3-11 행 5, D-M3-19 행 2·3은 명시 답이 없어 권고를 적용했다(M3-REQ-34, 58, 97).
- [가정] 절 번호는 2026-10-26 작업 트리 기준이다. L3 세 문서는 절 번호와 항목 이름으로 인용한다. 본문이 바뀌면 §5 "L3 근거" 칸을 다시 대조한다.

## 9. 이월 항목의 트랙 배정

M3a 이월 목록(carryover)에서 m3b-plan §2가 트랙에 배정한 항목이다. 장부 검사(`just req-ledger`)가 트랙 id 칸을 본다. 배정이 없는 이월 항목은 이 표에 넣지 않는다.

| 이월 항목 | 트랙 id |
|---|---|
| InputDraft.origin을 더해 input.queued가 origin을 싣는다 | B0-F |
| judgeMaxRuns를 apps/host agentsSource에 넘긴다 | B1-NTF |
| l2.work.goal.onJudgeError 설정 키를 지운다 | B1-NTF |
| 목표 판정 게이트를 실제 core-loop로 돌리는 시험(A5 통합) | B1-NTF |
| 명령 출력(handler void)과 명령 abort signal | B1-NTF |
| 안전 모드를 켜는 CLI·설정 | B1-SVC |
| 서비스 모드의 프로젝트 확장 미적재 | B1-SVC |
| CLI 검토 승인 카드의 ReviewAnswer 흐름(지금 allow가 거부됨) | B2-ART |
| guard.output.before 대상 execution 발화 | B2-ART |
| 리뷰 답 submit:false와 리뷰 단위 주석 의미 | B2-ART |
| afterUntrusted 메모리의 재시작 유지([제안] L1.tools §4.3) | B3-SEC |
| 데스크톱 슬래시 입력을 command.run으로 보내고 command.list 제공 | B3-SET |
| tokenBudget·모델 위젯 재검토(view-model만) | B3-SET |
| toolCallId를 turn id로 염(제공자 id 재사용 충돌) | B3-L1M |
| JudgeInput에 run·stepId 추가(재개 판별) | B3-L1M |
| 재시작 뒤 cancel({ ownerScopeId })가 살아 있는 자식에만 닿음 | B3-L1M |
| 큐 입력 우선과 drive 요청 순서(REQ-77 [제안]) | B3-L1M |
| input.agent.before의 systemPrompt를 둘이 서로 덮음 | B3-L1M |
| loop.spawn leaseEpoch 펜싱 | B3-L1M |
| X가 자식 대화에도 drive 임대를 주는 문제 | B3-L1M |
| core-agents draftQueued origin "delegation", core-tasks enqueuePost "other" | B3-L1M |
| completeStructured 위치와 L1.models.spec §4.10 정렬 | B3-L1M |
| L1/loop/spec.md §4.4b 순서 | B3-L1M |
| REQ-70 검토 포크 사용량 귀속(T-L1a) | B3-L1M |
| 저장 상태 스키마 위반 시 재설정 경로 | B4-GRP |
| SIGKILL 자식 프로세스 장애 시험 | B4-GRP |
| inquiry.finished 중복 제거(leaseId 바뀐 재시작 뒤) | B4-GRP |
| Helm 삭제 뒤 기본 플러그인 재설치 표지 | B4-GRP |
| group-kit 시험 틈(재생 하네스 thread id, capabilityWrite, callContext, scan-drive, 교차 scope) | B4-GRP |
| depcruise group-kit 예외 정리 | B4-GRP |
| LR-17 GroupMetrics 쓰기 API | B4-GRP |
| 기본 플러그인 번들 위치(M3-27) | B5-REL |
| @swc/core 데스크톱 번들 미포함 확인 | B5-REL |
| verify가 낡은 사이드카를 다시 빌드 | B4-DSK |
| 남은 Reflect.get 85곳 | B5-CLN |
| X/operations/plan.md의 "pi 어댑터" 문구 | B5-CLN |
| 학습 superseded 커밋 처리 확인 | B5-CLN |

## 10. M3b 마감 판정 (2026-10-29)

M3b 마감 때 `M3b:<트랙 id>` 행 60개를 코드 grep으로 하나씩 확인했습니다(구현 파일과 시험 파일 확인). 끝난 행은 `M3b`로, 끝나지 않은 행은 `M4`로 바꿨습니다. `[미결]`로 남긴 행은 없습니다. `M4` 행의 사유는 아래와 같고 같은 내용이 `review.m3-plan` §9.3 이월 표에 있습니다.

| 행 | M4로 옮긴 사유 |
|---|---|
| 요구 17 | beginEntry add가 meta를 무시하고 기본 메타만 씁니다(apps/host/src/handlers/secret.ts:135) |
| 요구 19 | thread.open 처리기가 includeItems를 무시하고 items·hasMore·asOfSeq를 돌려주지 않습니다(apps/host/src/handlers/thread.ts:40-62) |
| 요구 20 | toolDecl.parameters가 Type.Unknown이라 깊은 검증이 빠집니다(contracts/src/conversation/message-schema.ts:166) |
| 요구 21 | labelKey는 앱 3곳만 쓰고 하위 층 settings.ts에 평문 label 약 214줄이 남습니다(M3-REQ-112와 함께) |
| 요구 40 | X 예산 기본값은 측정 뒤 조정이 사용자 결정 대기입니다(packages/ext-host/src/operations/budget.ts:15) |
| 요구 51 | cap-knowledge가 OsService.fileLock이 아니라 프로세스 내부 mutex를 씁니다(cap-knowledge/src/fs/node-fs.ts:73) |
| 요구 52 | 회전 로그 sink에 호출처가 없고 apps/host는 append 전용 sink를 씁니다(assembly/log-sink.ts:16). traceparent 처리 없음 |
| 요구 53 | apps/desktop/sidecar.json이 Intel macOS·Windows 대상을 빌드하고 최소 macOS 14 확인이 없습니다(번들 패키징은 M4) |
| 요구 54 | UA 리터럴(cap-web/src/runtime.ts:109)과 settings.json 리터럴이 PRODUCT 상수를 쓰지 않습니다 |
| 요구 59 | createPostHocRedaction에 운영 호출처가 없고 표시·내보내기·모델 입력 단계가 쓰지 않습니다(platform-secrets/src/post-redact.ts:45) |
| 요구 64 | 값은 정했지만 측정에 근거한 결정은 macOS 측정 뒤입니다(L0.store S-8) |
| 요구 70 | 캐시 접두 조건 3이 미충족이고 spec이 [미결]로 둡니다(core-agents/src/service.ts:638) |
| 요구 87 | 기본 프롬프트에 응답 언어·도구 규칙이 없고 반복 감지 임계의 테이프 조정이 없습니다(core-loop/src/plugin.ts:65) |
| 요구 92 | 확장 매니페스트 components.commands 등록 코드가 없습니다(contracts/src/extensions/manifest.ts:119) |
| 요구 96 | Stagehand 기본 브라우저 provider는 의존 승인 대기입니다. MCP provider 경로만 있습니다 |
| 요구 112 | 하위 층 사용자 문장과 label 약 214줄이 남았습니다(cap-dialog classify, cap-work commands, platform-os binaries 등) |

- `M3b`로 닫은 행 중 단서가 있는 것: 요구 48(`@parcel/watcher` 어댑터는 의존 승인 뒤, 지금은 `fs.watch` 포트 구현 [결정: 오케스트레이터 기본값]), 요구 41(문서에서 닫음, `nfr.md:53`이 아직 사용자 결정 대기로 적음), 요구 57·58·81(규칙은 구현됐으나 이름 붙은 도우미 `decideMcpStdioSandbox`·`createMcpStartApprovals`·`modelRequestResendOf`에 운영 호출처가 없고 같은 규칙이 다른 위치에 인라인으로 있음).
