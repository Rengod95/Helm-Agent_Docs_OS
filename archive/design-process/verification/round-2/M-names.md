# M-names. 정본 이름 대조 기계 검사 (2차 검증)

- 대상: `docs/design/01`~`26` 전 문서. 읽기만 했다. 설계 문서는 고치지 않았다.
- 방법: 정본 이름 목록을 스크립트로 뽑고(09 §3.4, 10 §3.11, 19, 03, 02, 08, 14, 24), 01~26 전부에서 같은 형식의 토큰을 뽑아 대조했다. 표의 열 종류(이벤트·명령·메서드·코드 열)를 따로 확인했다. 예시 문장, 1판 대응 표, "쓰지 않는다" 설명, 원천 메모는 오탐으로 거르고 맥락을 한 건씩 확인했다.
- 제외: git 명령, `.helm/private/` 읽기, 다른 에이전트 호출.
- 심각도: **높음**은 정본에 없는 이름을 정의, 규칙, 지표식, 거부 코드처럼 쓴 경우다. **중간**은 정본과 표기나 형식이 다르거나 문서끼리 상충하는 경우다. **낮음**은 표기 형식, 설명 메모 안의 오기, 낡은 기술이다.

## 0. 정본 목록과 검사 범위

| 종류 | 정본 위치 | 정본 개수 | 비고 |
|---|---|---|---|
| 이벤트 | 09 §3.4 카탈로그 표 (+ §3.5 휘발 이벤트) | 279 (+8) | 표 첫 칸의 점 표기 이름. 09 §3.3.1 형식 위반은 0건 |
| 명령 | 10 §3.11 (명령 표, §3.11.1 2판 열, §3.11.11 2a 표, 통치 명령 규칙 문장, 19 명령 열) | 217 | 19 명령 열 94개 중 10에 없는 것은 `edits.scope` 1건(필드 경로) |
| 프로토콜 메서드·알림 | 19 §3.7 메서드 표, §3.8 알림, §3.13.2 등록 표, §3.6.4 스트림 | 메서드 127, 알림 6 | 10 §3.11.11 (2)(3)의 메서드 열 중 19에 없는 2개(`result.reopen`, `work.requestBrief`)는 10 본문이 "쓰지 않음·명령 아님"이라고 적어 불일치로 세지 않는다 |
| 오류 코드 | 10 §3.4.4 코드 목록, 19 §3.3.4 kind 열, 19 §3.3.5 대응 | 125 | 1판 코드(28)는 별도로 다룬다 |
| 화면 ID | 03 §3.6 표, §3.5.3 경로 표, §3.12 휴대폰 표 | SCR 36 (SCR-M-* 8 포함) | 와일드카드 `SCR-M-*`, `SCR-CONCERN-*`는 가족 표기로 허용 |
| 유즈케이스·기준 ID | 02 §3.1 표(UC-01~19), 02 본문의 `- AC-nn-nn` 항목 | UC 19, AC 145 | |
| 레코드 접두사 | 08 §3.2.2 표 | 60 | |
| ADR | 24 §3 색인, §8.x 전이 표, 제목 | 219 (두 자리 215) | 24 §2.1 `ADR-SS-NN` |
| 다이얼·설정 키 | 08 `DIAL_KEYS` 코드 블록(20), 14 §3.11.1 표(08과 일치 확인), 14 §3.13.2 `OrchestrationSettings` | 다이얼 20, 설정 27 | 14 §3.11.2 `DIAL_DEFS` 본문 항목은 확인 범위 밖이다(12장) |
| 1판 이름 | 09 부록 A, 08 §10.3, 10 §3.11.1·§3.4.6 | 1판 전용 159종 | 2판과 같은 이름은 제외 |

스캔 결과: 01~26의 점 표기 토큰 18,207건(고유 3,519종). 정본 네임스페이스에 속하는 토큰 중 정본에 없는 것은 코드 블록 속성 접근(약 180종)을 뺀 뒤 424종이다. 이 424종을 11장의 B1~B5로 나눴다. SCR 토큰 1,043건, UC 토큰 934건, AC 토큰 480건, ADR 토큰 1,010건도 함께 검사했다.

---

## 1. 이벤트 이름 (09 §3.4 기준)

| ID | 위치 | 사용된 이름 | 가장 비슷한 정본 이름 | 심각도 | 판정 근거 |
|---|---|---|---|---|---|
| E-01 | 16:1830 | `contest.opened` | `objection.filed` | 높음 | 지표 `ad.contest_rate_by_kind`의 분자로 정의된다. 1판 계열 이름이며 09 §3.4에 없다 |
| E-02 | 16:1832 | `contest.resolved` | `objection.resolved` | 높음 | 지표 `ad.reversal_rate`의 식으로 정의된다. 08 §10.3이 `contest.resolved`를 `objection.resolved`로 바꾸라고 적었다 |
| E-03 | 16:1830 | `autonomous_choice.recorded` | `choice.committed` (autonomy 필드 포함) | 높음 | 지표 분모로 쓰인다. 09 §3.4에 없다. 14:631의 `autonomous_choice`는 기록 종류 이름이며 이벤트 이름이 아니다 |
| E-04 | 06:1348, 23:818 | `result.accepted` | `acceptance.recorded` | 높음 | "관문 Concern에 `result.accepted`가 있으면 기록이 있다"는 판정 조건으로 쓰인다. 09 §3.4에 없다. 09:2751은 1판 대응 표 안의 `normative.result.accepted`다 |
| E-05 | 02:1217 | `agreement.cancelled` | `agreement.released`, `agreement.declined` | 높음 | 지표 `ca.agreement_bypass_rate`의 원천 이벤트다. 02 본문 자신이 "08·09에 없다"고 적었다. 정본 등재 또는 대체 판정이 필요하다 |
| E-06 | 10:1361 | `downgraded.interpretation_to_assumption` | `assumption.recorded` (origin 값) | 높음 | 10 명령 표의 이벤트 열(해석 강등 결과)이 정의하는 이벤트다. 09 §3.4와 08 §3.x 어디에도 없다 |
| E-07 | 08:3949 | `downgraded.assumption` (§4 E-03의 결과 코드) | `downgraded.interpretation_to_assumption` (10) | 높음 | 08 결과 코드와 10 이벤트 이름이 서로 다르다. 한 가지로 맞춰야 한다 |
| E-08 | 10:1697 | `run.end(reason cancelled)` (이벤트 열) | `run.ended` (09 §3.4.12) | 중간 | 09 정본은 `run.ended`다. 같은 문서의 명령 `run.end`와 혼용된다 |
| E-09 | 09:428–429, 10:1655, 19:1929 | `dial.set`, `dial.unset` | 명령·메서드와 이벤트 이름의 구분 (09 §3.3.7) | 중간 | 같은 문자열이 09에서는 이벤트, 10·19에서는 명령과 메서드다. 09 §3.3.7은 명령과 이벤트 이름이 다르다고 정한다. 설계 의도인지 판정이 필요하다 |
| E-10 | 09:1586 | `attention.state_changed`, `attention.budget_spent` | 정본 없음 | 낮음 | 09 주석이 14의 이벤트로 나열하지만 14 본문에는 해당 이름이 없다. 09 주석이 낡았다 |
| E-11 | 25:528 | `daemon.started` | `daemon.booted` | 낮음 | 25 §4 N-16은 17·12가 `daemon.started`를 쓴다고 적는다. 두 문서 본문에는 0건이다. 25 기술이 낡았다 |

검사 결과 요약: 02 §2.5의 이벤트 목록은 전부 09 §3.4 안에 있다(0건). 10 §3.11 이벤트 열의 지시 표기 `timer.schedule`, `timer.cancel`, `run.signal`은 이벤트가 아니라 지시 이름이므로 11장 B5 분류에 넣었다.

## 2. 명령 이름 (10 §3.11 기준)

| ID | 위치 | 사용된 이름 | 가장 비슷한 정본 이름 | 심각도 | 판정 근거 |
|---|---|---|---|---|---|
| C-01 | 17:1721 | `observer_run.record` (10 명령 이름으로 지정) | `observer.report.submit` (16 방식) | 중간 | 16:2415와 16:2519는 "`observer_run.record`라는 명령은 없다"고 적는다. 17이 이를 10의 명령으로 가정하는 것과 충돌한다 |
| C-02 | 04:1480 | `result.reopen` | `result.accept` (decision 값) | 낮음 | 10:1788과 19 §3.7은 1판 명령을 뺐다고 적는다(J-123). 04 결과 확인 행동 설명에 남은 1판 이름이다 |

명령 열 검사 결과: 19 §3.7.1 명령 열 94개 중 10에 없는 것은 `edits.scope` 1건이며 필드 경로다. 19 메서드와 10 명령이 같은 이름을 쓰는 경우는 대응 구조상 자연스러우므로 불일치로 세지 않았다.

## 3. 프로토콜 메서드·알림 (19 기준)

| ID | 위치 | 사용된 이름 | 가장 비슷한 정본 이름 | 심각도 | 판정 근거 |
|---|---|---|---|---|---|
| M-01 | 18:538 | `device.rotateToken` (19 메서드로 인용) | HTTP `POST /devices/self/rotate` (19 §3.2.5), 명령 `device.rotate_token` (10) | 중간 | 19:1254가 1판 메서드 `device.rotateToken`을 뺐다고 적는다. 18은 이를 현행 메서드로 인용하고 있다 |

검사 결과 요약: 04·05·11·15·19·21이 인용하는 `goal.*`, `concern.*`, `question.*`, `inquiry.*`, `observerProposal.*`, `presence.report` 등의 메서드 이름은 19 §3.7 목록에서 확인되었다. 메서드 형태(camelCase) 후보 중 목록에 없는 것은 B2(11장)와 M-01뿐이다. 알림 6종(점 표기)은 정본 밖 이름이 없다. 04:1475의 `Obligation.deferral`은 08 타입 이름을 괄호로 인용한 것이므로 메서드 불일치로 세지 않았다.

## 4. 오류 코드 (10 §3.4.4, 19 §3.3)

| ID | 위치 | 사용된 이름 | 가장 비슷한 정본 이름 | 심각도 | 판정 근거 |
|---|---|---|---|---|---|
| ERR-01 | 08:3947 (§4 E-01) | `conflict.id_exists` | `conflict.duplicate_id` (10 §3.4.4 코드 목록) | 높음 | 처리 열에서 거부 코드로 정의된다. 10·19·09 어디에도 없다 |
| ERR-02 | 08:3968 (E-22) | `policy.boundary_unchecked` | 정본 없음 (경계 항목 확인 명령의 거부 코드가 필요하다) | 높음 | 거부 코드로 정의된다. 10 §3.4.4에 없다 |
| ERR-03 | 08:3969 (E-23) | `policy.open_objections` | 정본 없음 (완료 차단 계열 `policy.obligations_open`이 의미상 가깝다, 판정 필요) | 높음 | 열린 이의에 따른 완료 거부로 정의된다. 10에 없다 |
| ERR-04 | 08:3972 (E-26) | `policy.duplicate_proposal` | 정본 없음 | 높음 | 기각된 제안의 재제안 거부로 정의된다. 10에 없다 |
| ERR-05 | 08:3973 (E-27) | `denied.device_revoked` | 정본 없음 (`denied.*` 자격 계열 확장이 필요하다) | 높음 | 폐기된 기기의 명령 거부로 정의된다. 10 `denied.*` 목록에 없다 |
| ERR-06 | 08:3979 | `invalid.cross_concern_supersede` | 정본 없음 | 높음 | 08 §4 처리 열에서 거부 코드로 쓰인다. 10에 없다 |
| ERR-07 | 08:3980 | `invalid.prediction_uncheckable` | 정본 없음 | 높음 | 같음 |
| ERR-08 | 08:3981 | `invalid.due_in_past` | 정본 없음 | 높음 | 같음 |
| ERR-09 | 08:3984 (E-38) | `invalid.dependency_order` | 정본 없음 | 높음 | 같음. 08 §3.21.3 종류 순서 위반이다 |
| ERR-10 | 12:364 | `runtime.thread_busy` | 정본 없음 | 높음 | `startRun` 거부 결과로 정의된다. 10 §3.4.4와 19 §3.3.4에 없다 |
| ERR-11 | 12:2255 (E-05) | `runtime.duplicate_tool_call_id` | `conflict.duplicate_id` (의미 근접) | 높음 | 차단 코드로 정의된다. 10 목록에 없다 |
| ERR-12 | 22:554 | `not_found.goal` (22가 "08 E-02의 `not_found.goal`"이라고 기술) | `invalid.goal_link` (10 §3.4.4) | 낮음 | 08 E-02 본문에는 이 코드가 없다. 22 기술이 낡았다 |
| ERR-13 | 08:2031 | `policy.completion_evidence_incomplete` (1판 실험 코드 설명 안) | `policy.criteria_incomplete` | 낮음 | 1판 코드 참조다. 정의로 쓰이지 않았다 |
| ERR-14 | 10:800 | `content.scope`, `content.forbidden*`, `content.stopConditions` (Agreement 필드 열) | 2판 필드 이름 (08 §3.11.1 정본 대조 필요) | 낮음 | 1판 접두사 `content.`가 필드 표기로 남았다 |

검사 결과 요약: 10 §3.4.6 1판 대응 표, 19 §3.3.5 v0.2 대응 표(`invalid.protocol_request` 등), 12의 1판 trace 대응 표(`toolcall.denied_by_path_policy`, `path.masked`), 08 §10 대응 표의 이름은 대응 설명이므로 불일치에서 뺐다. 09 부록 A의 1판 이름도 같다. 10 §3.11 명령 표의 주요 거부 열 코드는 10 §3.4.4 목록 안에 있다.

## 5. 화면 ID (03 §3.6, §3.12)

0건 불일치. 01~26의 SCR 토큰 1,043건 중 와일드카드 4건(`SCR-M-*`는 03:609·25:744, `SCR-CONCERN-*`는 03:698·21:118)을 뺀 나머지가 정본 36종 안에 있다. 와일드카드는 가족 표기로 허용했다.

참고(범위 밖): 02 §2.4가 쓰는 `RGN-*` 8종은 03 §3.4.1 표에 정의되어 있다. `OVL-CONTEST`(31건), `OVL-PALETTE`(6건), `OVL-SHORTCUTS`(4건)은 03 본문에서 쓰이지만 정의 표는 03에서 찾지 못했다. 정의 위치는 확인하지 않았다(확인 보류).

## 6. 유즈케이스·기준 ID (02)

0건 불일치. UC 토큰 934건이 UC-01~UC-19 안에 있다. AC 토큰 480건(22 시험 대본 215건 포함)이 02 본문에 정의된 145종 안에 있다. 정의되지 않은 번호 참조는 없다.

## 7. 레코드 접두사·ID (08 §3.2.2)

0건 불일치. `이름(`xx`)` 형식의 115건에서 대상 이름이 08 표와 맞는다(Goal `gl`, Concern `cn`, Choice `ch`, Question `qs` 등). 일반어 '레코드'·'목록'과 1판 접두사 3건은 대상 이름 검사에서 뺐다. ULID 형식 예시 검사에서 정의되지 않은 접두사는 나오지 않았다.

표에 없는 두 글자 토큰 중 레코드 접두사로 쓰인 것은 없다. `wa`, `rw`, `sb`는 1판 접두사이며 25:729가 "쓰지 않는 접두사"로 명시한다. 11:768, 11:1720, 08:4016, 08:4192, 08:4195, 25:150은 1판 레코드의 금지를 설명한다. `rx`(08:4071)는 채택되지 않은 대안이고, `dl`·`ol`(21), `ws`(06 `openclaw`)는 레코드 접두사가 아니다.

## 8. ADR 번호 (24)

| ID | 위치 | 사용된 이름 | 가장 비슷한 정본 이름 | 심각도 | 판정 근거 |
|---|---|---|---|---|---|
| A-01 | 02:437, 17:678, 17:1612 (`ADR-18-2`, 3건) | 한 자리 형식 | `ADR-18-02` | 낮음 | 24 §2.1은 NN을 두 자리로 정한다 |
| A-02 | 06:1217, 07:82, 12:606, 18:67, 18:584, 18:585 (`ADR-17-3`, 6건) | 한 자리 형식 | `ADR-17-03` | 낮음 | 같음 |
| A-03 | 18:104, 18:189, 18:995 (`ADR-17-5`, 3건) | 한 자리 형식 | `ADR-17-05` | 낮음 | 같음 |
| A-04 | 18:1200 (`ADR-26-3`, 1건) | 한 자리 형식 | `ADR-26-03` | 낮음 | 같음 |

검사 결과 요약: 24 색인과 §8 전이 표를 합친 정본 219종 중 두 자리 ID는 215종이다. 타 문서가 두 자리로 쓴 ADR 참조는 전부 24에 등재되어 있다(미등재 0건). 24 §8의 원 번호 열(`ADR-14-7`, `A09-6` 등)은 대응 설명이므로 정상이다. ADR-14-12(14 후보)와 ADR-00-53(브리프 결정 53)은 내용이 같고 24 행 116이 본문 참조를 적었으므로 불일치로 보지 않았다.

## 9. 설정·다이얼 키 (08 DIAL_KEYS, 14)

| ID | 위치 | 사용된 이름 | 가장 비슷한 정본 이름 | 심각도 | 판정 근거 |
|---|---|---|---|---|---|
| D-01 | 11:442 (11 다이얼 표 행) | `inquiry.source_range` | `inquiry.evidence_range` (08 `DIAL_KEYS`, 14 §3.11.1 #9) | 높음 | 값 "작업 대상 / 문서 / 웹"이 14의 `target / docs / web`과 같다. 정본 키 이름과 다르다 |
| D-02 | 04:2065, 04:2279, 05:84, 05:645, 05:1252, 11:647, 20:1320, 20:1321, 26:108 | `notifications.showContent`, `notifications.negotiated`, `notifications.hourlyCap`, `notifications.dndException`, `notifications.sound`, `notifications.enabled`, `notifications.observer` | 14 §3.13.2의 `notifications.resultReview`, `notifications.resultReviewDigestAt`만 있다. 의미 근접은 `attention.interruptsPerHour`(hourlyCap), `question.default_delivery`(negotiated) | 높음 | 설정 키로 쓰이지만 정본 설정 목록(14)에 정의가 없다. 14에 등재하거나 명칭을 맞추는 판정이 필요하다 |
| D-03 | 15:2293, 15:2294, 15:2295, 15:2811 | `budget.subcalls`, `budget.costUsd`, `budget.wallMinutes` | `inquiry.budget`의 값 필드 (14 §3.11.1 #11) | 중간 | 접두사가 `budget.`로 다르다. 정본 다이얼 키 `inquiry.budget` 아래 필드여야 한다 |
| D-04 | 17:1721, 23:1206 | `budget.monthlyUsd` | `budget.monthlyCapUsd` (06 정본) | 중간 | 17:1721 (8)이 같은 지적을 이미 적었다. 23도 같은 이름을 쓴다 |
| D-05 | 14:2284 | `perLoop.I.defaultDelivery` | `question.per_loop` (08 `DIAL_KEYS`) 하위 경로 | 낮음 | 경로 표기 규칙이 정본에 없다. 설명용 경로다 |

검사 결과 요약: 14 §3.11.1 표의 키 20개(#1~#16, 묶음 포함)는 08 `DIAL_KEYS` 20개와 완전히 같다. 08과 14 사이의 다이얼 키 불일치는 0건이다.

---

## 10. 1판 이름 잔존 (종류 횡단)

1판 전용 이름 159종이 243건 나타난다. 키워드 기준으로 221건은 1판→2판 대응 표, 원천 메모, "쓰지 않는다" 설명 안에 있다. 남은 22건을 포함해 엄격 기준(대응 표지어 없음)으로 다시 거르니 31건이 남았다. 그중 정의나 지표식으로 쓰인 것은 다음 3건이다.

- E-01, E-02: 16:1830–1832의 `contest.opened`, `contest.resolved` (지표식 정의)
- C-02: 04:1480의 `result.reopen` (UX 행동 설명)

나머지는 대응 표나 설명이다. 예: 09:2102–2103, 09:2518, 09:2711, 10:127, 10:1842, 12:2230, 14:3294, 22:1982, 25:898(N-14 정리 목록). 1판 이름 전수 확인은 하지 않았다(12장).

## 11. 오탐으로 거른 범주 (정본 밖 명명)

정본에 없는 점 표기 토큰 424종을 형식과 맥락으로 나눴다.

| 범주 | 고유 토큰 수 | 예 | 처리 |
|---|---|---|---|
| B1 필드 경로(3분절 이상, 또는 말단이 camelCase) | 99 | `daemon.booted.releaseId`, `question.delivered.channel`, `hello.challenge.serverId` | 이벤트·명령 이름의 필드 표기로 보고 제외 |
| B2 camelCase 두 분절(필드·설정·메서드 후보) | 61 | `device.publicKey`, `auth.allowedOrigins`, `budget.costUsd` | 정본 밖 필드·설정으로 보고 제외. 메서드 후보는 1장·3장에서 따로 봤다 |
| B3 잘린 토큰(`_`로 끝남) | 6 | `daemon.safe_mode_`, `gate.human_`, `pairing.code_` | 추출 과정의 잘림이므로 제외 |
| B4 UX 문구 키, 코드 API, 호스트, 설정 묶음 | 56 | `notice.mobile.reviewOnDesktop`(05 문구 키), `import.meta.env.MODE`, `push.apple.com`, `material.rim`(21 디자인 토큰), `tools.sandbox`(13 설정) | 정본 밖 |
| B5 맥락 검토 대상 | 202 | 아래 목록 | 맥락으로 분류. 불일치로 확정한 것은 1~9장에 넣었다 |

B5 202종에서 확정하지 않은 나머지는 다음과 같이 분류했다.

- 추적(trace) 종류: `inquiry.step_started`·`inquiry.step_completed`·`inquiry.step_failed`(08:4032, 12:1037, 12:2137, 15:493), `context.injected`, `context.compacted`, `run.stage`, `input.queued`, `steering.deferred`, `model.*`, `work.requested`·`work.admitted`·`work.deferred`(14:2697이 "실행 기록(trace)일 뿐"이라고 명시). 정본 이벤트가 아니다. 15:2683은 같은 어간의 이벤트 `inquiry.stage_completed`와 실행 기록 `inquiry.step_*`를 나누어 적는다. 의도된 분리지만 명명 혼동 소지가 있다(낮음 메모).
- 지시(directive) 종류: `run.signal`(10 §3.1 타입, 28건), `timer.schedule`, `timer.cancel`(10 이벤트 열), `projection.invalidate`(10 §3.1 타입). 10 본문에서 정의된다.
- 테스트 주입 지점과 장애 시점 라벨: `approval.after_consume`, `tool.during_execute`, `store.during_rebuild`, `clock.forward_jump`, `tool.after_result_commit`, `run.before_message_commit` 등(12·22).
- 판정 술어와 조건식: `agreement.active`, `dial.equals`, `situation.is`, `probe.allFold`, `probe.anyGrow`, `submission.exists`, `reflection.complete`, `inquiry.stopRuleMet`(14 전이·종료 조건).
- 지표 이름과 지표 필드: `entry.redefined_rate`, `device.phone_repairs_30d`, `concern.criteria_changed`(16:2718 지표 이름 목록). 지표식 안의 이벤트 참조는 E-01~E-05로 검사했다.
- 설명과 부정 기술: `device.pair`(19:1253, 메서드 없음), `connection.test`(19:1253, 앱 내부 동작), `command.submit`(19:2897, 기각한 대안), `hello.rejected`(19:526, 외부 제품 인용), `stream.text.v1`(19:591, 버전 표기), `daemon.started`(25:900, 1판 대응 표).
- 호스트·도구·기타: `server.tail7ad0b4.ts.net`(20:129, 26:120), `observer.cycle`(12·16 개념명), `tool.net_request`·`tool.binary_missing`(13 신호 kind 또는 사유 표기, 정본 밖).

## 12. 한계와 확인 보류

- 정본 목록이 없는 영역은 이름 대조 대상이 아니다. 여기에는 추적·지시 종류, 술어, UX 문구 키(`notice.*`, `question.reason.*`, `question.priority.*`), 지표 이름, 운영 설정 키(`budget.*`, `tools.*`, `secrets.*`, `push.*`, `auth.*`, `policy.files.*`), 13 중립 신호 kind가 있다. 이 영역은 정의 위치 확인이 따로 필요하다.
- 14 §3.11.2 `DIAL_DEFS` 본문 항목은 확인하지 못했다. D-02의 판정은 14 §3.13.2 `OrchestrationSettings`와 14 본문 검색(0건)에 기대었다.
- 1판 대응 판정은 키워드 기준이다. 대응 표 밖 본문에서 1판 이름이 정의로 쓰였는지 전수 확인하지 않았다.
- 10 §3.11 이벤트 열의 지시 이름 3종(`timer.schedule`, `timer.cancel`, `run.signal`)은 10 내부 표기 규칙에 기대어 지시 이름으로 분류했다.
- 03의 `OVL-*` 정의 위치는 확인하지 못했다.
- `just verify`는 실행하지 못했다. 작업 루트에 justfile이 없다(`just --list`: "no justfile found"). 환경 문제이므로 코드는 건드리지 않았다.

## 13. 집계

| 종류 | 항목 수 | 높음 | 중간 | 낮음 |
|---|---|---|---|---|
| 이벤트 이름 (1장) | 11 | 7 | 2 | 2 |
| 명령 이름 (2장) | 2 | 0 | 1 | 1 |
| 프로토콜 메서드·알림 (3장) | 1 | 0 | 1 | 0 |
| 오류 코드 (4장) | 14 | 11 | 0 | 3 |
| 화면 ID (5장) | 0 | 0 | 0 | 0 |
| 유즈케이스·기준 ID (6장) | 0 | 0 | 0 | 0 |
| 레코드 접두사·ID (7장) | 0 | 0 | 0 | 0 |
| ADR 번호 (8장) | 4 | 0 | 0 | 4 |
| 설정·다이얼 키 (9장) | 5 | 2 | 2 | 1 |
| **합계** | **37** | **20** | **6** | **11** |

참고: ADR 항목 A-01~A-04는 같은 원인(한 자리 표기)이므로 합계에서 한 건으로 세면 항목 수는 34, 낮음은 8이다. 위치 수로 세면 더 많다. 1판 잔존 정의 사용은 3건(E-01, E-02, C-02)이며 해당 항목에 포함되어 있다.
