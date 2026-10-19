# R2 재확인 B: V2-12 ~ V2-21 해결 여부

- 대상: `summary.md` §3의 V2-12 ~ V2-21(10건)
- 기준: 각 행의 '문서·절'과 '수정 제안', 판정 J-241 ~ J-256(`process/rulings-stage2a.md` §11)
- 방법: 지적 위치를 grep으로 찾고 해당 범위만 읽었다. 줄 번호는 현재 파일 기준이다. summary의 줄 번호는 수정 전 기준이라 어긋난다(예: 18 §3.4.3 L283은 현재 L284).
- 집계: 해결 5(V2-14, 15, 17, 20, 21), 부분 5(V2-12, 13, 16, 18, 19), 미해결 0.

## 1. 판정 표

| V2 번호 | 판정 | 근거 | 남은 문제 |
|---|---|---|---|
| V2-12 | 부분 | 정본 선언: 18 §3.4.6 L336("`/m/*` 정적 응답의 헤더·캐시·쿠키 조건은 이 절이 정본이고, 19 §3.2.5와 26 §3.3.2는 이 값을 인용한다"), 값 표 L340–344. 인용: 19 §3.2.5 L289·L303이 18 §3.4.6을 정본으로 적는다. 19 §3.11.2 L2156(J-252). 26 §3.3.2 L317·L326·L336이 18을 인용한다. | 17 §3.5.1 L686이 "경로 표와 응답 헤더는 26 §3.3.2 … 정본이다"라고 적는다. 18·19·26과 달리 응답 헤더의 정본을 26으로 둔다. 같은 문장에 "HTTP 경로 표는 19 §3.2.5가 정본"도 있어 경로 표 정본이 둘이다. 고침: L686을 "보안 헤더·캐시·쿠키는 18 §3.4.6, 경로 표는 19 §3.2.5, 배치는 17"로 바꾼다. 경미: 26 §3.3.2 L328–333에 CSP 값 사본이 있다. 현재 값은 18 L340과 같지만(호스트 자리만 다름), 한쪽만 바뀌면 어긋난다. |
| V2-13 | 부분 | 제안 종류 타입: 14 §3.5.3 `ContractProposalKind`(L439–457)에 `situation_summary`·`watch_sample`이 없다. 단계 표: 14 §3.3.2 L203의 Sense 행은 `frame_packet`만 든다. "없앰" 표기: 14 §3.5.6 L623(`situation_summary`), L646(`watch_sample`). 13 §3.7.2 L950과 10 §3.11.11 L1860이 두 종류를 뺐다고 적는다. | 14 §3.3.1 L190 Assure 행의 "WorkUnit 목적" 열에 `watch_sample`이 남는다. 같은 이름이 작업 단위 목적으로 살아 있다: 14 §3.5.1 L278(`WorkUnitPurpose`), L976·L1284·L2492(WorkUnit 생성·대기), 25 L262. 그런데 10 L1860("`watch_sample`은 없앴다")과 14 L646("(없앰)")은 제안 종류라는 한정이 없어 전체에서 없어진 것으로 읽힌다. R-V1 NC-3이 요구한 "제안 종류와 작업 단위의 이름을 나눈다"는 조치가 문장으로 없다. 고침: 14 L646과 10 L1860에 "제안 종류 `watch_sample`만 없앰. 작업 단위 목적 `watch_sample`은 남음"을 적는다. |
| V2-14 | 해결 | 18 §3.4.3 쿠키 갈래 업그레이드 검사 L284: `req.headers.origin ∉ cfg.auth.allowedOrigins`(목록 전체). `originExact` L290: `∈`. 규칙 4 L305: 목록으로 적는다. 설계 문서 전체에서 `allowedOrigins[` 0건, 18·19·17·26·06에서 "첫 항목" 0건. | 경미: 26 §3.3.3 L350·L351과 ADR-26-03 본문 L1339가 "Origin이 모바일 출처와 정확히 같아야 한다"처럼 단수로 적는다. 기본값 `[publicOrigin]` 하나에서는 같지만, 목록에 둘을 넣으면 첫 항목만 보는 것으로 읽힌다. "`auth.allowedOrigins` 목록의 값과 같아야 한다"로 맞춘다. |
| V2-15 | 해결 | 18 §3.4.4 L315–316: 정식 데몬은 `helm-bearer.` 값을 무시하고, SP-15가 실패해도 대체를 쓰지 않으며 사용자 결정으로 올린다(J-241). 같은 내용이 26 §2.1 L104, §2.5 AS-M2 L170, §7.2 MQ-04 L1277과 23 §3.7.1 SP-15 L955의 대체 문장에 있다. 설계 문서 전체에서 쿠키 실패 시 대체 문구는 없다. | 경미: 23 §3.7.1 L955 SP-15 행의 첫 칸이 여전히 "하위 프로토콜 헤더를 넘기지 않거나"를 점검 항목으로 든다. 18 §3.4.4와 어긋나는 잔여 표현이다(새 모순 3). |
| V2-16 | 부분 | 정본 선언: 09 §3.14.2 L2159("승인 만료 복원(7b, `approval.expired{restored}`)의 정본은 이 절이다", J-246). 7b 절차는 09 L2151. 17 §3.9.4 L1136이 "미소진 승인은 09 §3.14.2 7b에 따라 approval.expired{reason: "restored"}로 닫는다"라고 참조한다. 12 §3.7.3 L1562 주석이 "정본은 09 §3.14.2다"라고 적는다. | 12 §3.7.3 L1562 `if startReason == 'restored': submit approval.expire`가 같은 닫기를 런타임 복구 3단계에서 한 번 더 실행한다. 명령은 10 §3.11.7 L1553(R·sys:runtime)에 있다. 09 7b(리스너 열기 전, 부팅 10단계 직후)와 실행 주체·시점이 둘이다. 순서상 7b가 먼저 돌아 3단계는 실질적으로 할 일이 없을 것으로 보이나, 문서는 그렇게 적지 않는다. 고침: 12 L1562를 "09 §3.14.2 7b에서 닫힌다. 여기서는 남은 승인이 없는지만 확인한다"로 줄이거나 삭제한다. |
| V2-17 | 해결 | 09 §3.8.2 L1676: 승인 만료 → `not_executed(approval_expired)`, 승인 기록 없음 → `not_executed(restart)`(J-193). 12 §3.7.3 L1552–1553이 같은 구분을 적는다. 08 §3.22.14 L3789–3791: 승인 대기 호출은 `approval_expired`로 닫힌다. 08 L1891과 L3049 주석도 같다. `restart`는 승인 기록이 없는 호출(12 L1553, 09 L1676)과 메시지만 커밋된 호출(12 §6 L2445 T-CR-03)에만 남는다. | 없음. |
| V2-18 | 부분 | 12 §3.7.4 L1619: "그대로 두기"(`leaveAsIs`)는 run 수준 복구 항목만 닫고 호출의 `toolcall.recover`는 내지 않는다. 12 §3.12.4 L1998이 이 정의를 §3.7.4 정본으로 인용한다. 19 §3.7.9 L1936: `leaveAsIs` → "복구 항목만 닫는다(`toolcall.recover`를 내지 않는다, 12 §3.7.4)". 12와 19의 불일치는 해소되었다. | 10 §3.11.11 L1821(`recovery.resolve`(WorkUnit 대상) 행)이 `leaveAsIs → 남은 outcome_uncertain 호출마다 toolcall.recover(manual_review)`라고 적어 12·19와 반대다. `manual_review`는 12 §3.7.4 L1616에서 호출 수준 선택지("직접 확인 작업 만들기")다. 고침: L1821의 leaveAsIs 부분을 12 L1619 문장으로 바꾸고, `manual_review`는 createCheckTask 쪽에만 둔다. |
| V2-19 | 부분 | 여섯 이름 가운데 다섯은 정의 자리에서 없어졌다. `contest.opened`·`autonomous_choice.recorded`·`agreement.cancelled`는 0건이다. 16 §3.22.3 L1676·L1678은 사실 키를 09 이벤트 열로 옮기고, 16 §3.23.5 L1830·L1832는 `objection.filed`·`objection.resolved`를 쓴다. 16 L1785는 `agreement.declined`를 쓴다. `result.accepted`는 06·23에서 0건이고, 09 L2753은 1판 대응표다. `contest.resolved`는 08 §10.3 L4214의 1판 대응표뿐이다. E-07: `downgraded.assumption`은 결과 코드로 4건 모두 일치한다(08 L3949, 10 L660·L717·L1361). 10 L1361에서 `assumption.recorded`(origin `downgraded_interpretation`) 쌍이 정해졌다(J-244). | 02 §3.24 L1175 "강등 알림: … `downgraded.interpretation_to_assumption`(AC-02-01)"에 정본 밖 이름이 1건 남는다. 10 L660·L717이 쓰는 결과 코드 `downgraded.assumption`으로 바꾼다. 경미: 16 L1676·L1678·L1830의 사실 키 `autonomous_choice/recorded`·`contest/opened`는 점 표기 이벤트가 아니지만 1판 어간이 남는다. 16 §3.22.3 머리말이 "이벤트 이름은 09 카탈로그"라 한 만큼, 사실 키라고 한 번 적거나 이름을 바꾼다. |
| V2-20 | 해결 | 10 §3.4.4(L568 시작) 등재: `conflict.duplicate_id`(L613), `conflict.id_exists`(L614), `denied.device_revoked`(L645), `policy.boundary_unchecked`(L646), `policy.open_objections`(L647), `policy.duplicate_proposal`(L648), `invalid.cross_concern_supersede`(L649), `invalid.prediction_uncheckable`(L650), `invalid.due_in_past`(L651), `invalid.dependency_order`(L652), `conflict.thread_busy`(L653). 12 §3.2.2 L364은 `conflict.thread_busy`(J-250), 12 §4 L2256은 `conflict.duplicate_id`(J-243)를 쓴다. 08 §4 E-01·E-22·E-23·E-26·E-27·E-33·E-34·E-35·E-38이 같은 이름을 쓴다. | 없음. 다만 J-250 개명으로 생긴 19 §3.3.5 L488 매핑 누락과 10 L613·L614의 중복 구분은 새 모순 1·2에 적었다. |
| V2-21 | 해결 | 11 §3.3.3 L442: `inquiry.evidence_range`(근거 범위). 08 DIAL_KEYS L2494에 `inquiry.evidence_range`가 있다. 14 L2148, 15 §3.3.3 L732, 25 L282도 같은 키다. `inquiry.source_range`는 설계 문서 전체에서 0건이다. | 없음. |

## 2. V2-19·V2-20 이름별 grep 집계

설계 문서 01–26(`docs/design/[0-9]*.md`) 기준이다. `process/` 아래 판정·검증 문서는 집계에서 뺐다.

| 이름 | 출현 | 판정 |
|---|---|---|
| E-01 `contest.opened` | 0 | 제거됨 |
| E-02 `contest.resolved` | 1 (08 L4214, §10.3 1판 대응표) | 허용 |
| E-03 `autonomous_choice.recorded` | 0 (16의 사실 키 `autonomous_choice/recorded`는 점 표기가 아님) | 제거됨 |
| E-04 `result.accepted` | 1 (09 L2753 `normative.result.accepted`, 1판 대응표). 06·23은 0건 | 허용 |
| E-05 `agreement.cancelled` | 0 | 제거됨 |
| E-06 `downgraded.interpretation_to_assumption` | 1 (02 L1175) | 잔존 1건 |
| E-07 `downgraded.assumption` | 4 (08 L3949, 10 L660·L717·L1361, 결과 코드) | 일치 |
| ERR-01 `conflict.id_exists` | 2 (10 L614, 08 L3947) | 10 §3.4.4 등재 |
| ERR-02 `policy.boundary_unchecked` | 2 | 10 L646 등재 |
| ERR-03 `policy.open_objections` | 2 | 10 L647 등재 |
| ERR-04 `policy.duplicate_proposal` | 2 | 10 L648 등재 |
| ERR-05 `denied.device_revoked` | 2 | 10 L645 등재 |
| ERR-06 `invalid.cross_concern_supersede` | 2 | 10 L649 등재 |
| ERR-07 `invalid.prediction_uncheckable` | 2 | 10 L650 등재 |
| ERR-08 `invalid.due_in_past` | 2 | 10 L651 등재 |
| ERR-09 `invalid.dependency_order` | 2 | 10 L652 등재 |
| ERR-10 `runtime.thread_busy` | 0 | `conflict.thread_busy`(12 L364, 10 L653) |
| ERR-11 `runtime.duplicate_tool_call_id` | 0 | `conflict.duplicate_id`(12 L2256) |

정본 밖 이름의 잔존은 E-06 1건(02 L1175)이다. ERR-01~11은 잔존 0건이다.

## 3. 새 모순

수정 과정에서 생겼거나 수정 문장 옆에서 새로 확인된 모순이다. 수정 전 원문과 대조하지 않았으므로 '새로 생김'은 원인 추정이다.

1. `conflict.thread_busy` 매핑 누락. 10 §3.4.4 L653은 `conflict.thread_busy`를 content·rejected로 둔다(J-250 개명). 19 §3.3.5 L488의 content 열거 목록에는 `conflict.invalid_transition`·`duplicate_id`·`id_exists`·`agreement_revision_stale`만 있고 이 코드가 없다. 프로토콜 결과가 정해지지 않는다. 고침: L488 목록에 `conflict.thread_busy`를 넣는다.
2. 중복 ID 코드 둘. 10 §3.4.4 L613 `conflict.duplicate_id`("이미 있는 ID로 생성")와 L614 `conflict.id_exists`("저장 단계에서 같은 ID가 두 번 생성됨")는 같은 사건에 둘 다 맞을 수 있다. 표에 구분 기준이 없다(J-243 등재로 생김). 고침: 발생 단계(검증 대 저장)를 표에 한 문장으로 적거나 하나로 합친다. 판정이 필요하다.
3. SP-15 잔여 표현. 23 §3.7.1 L955 SP-15 행의 첫 칸 "모바일 쿠키·Origin·하위 프로토콜 헤더를 넘기지 않거나"는 18 §3.4.4 L315(정식 데몬은 하위 프로토콜 토큰을 쓰지 않는다)와 맞지 않는 점검 항목이다. J-241 수정 때 첫 칸이 고쳐지지 않았다. 고침: 첫 칸에서 하위 프로토콜 항목을 뺀다.

수정 문장 주변에서 확인된 기존 잔여 대조 불일치다. 각 행의 '남은 문제'에도 적었다.

4. 응답 헤더 정본 둘: 17 §3.5.1 L686 ↔ 18 §3.4.6 L336 (V2-12).
5. `watch_sample` 제안 종류 없앰 대 작업 단위 목적 유지: 10 L1860, 13 L950, 14 L646 ↔ 14 L190·L278·L976·L1284·L2492, 25 L262 (V2-13).
6. 승인 만료 복원 닫기의 실행 둘: 12 §3.7.3 L1562 ↔ 09 §3.14.2 L2151 (V2-16).
7. `leaveAsIs` 효과: 10 §3.11.11 L1821 ↔ 12 §3.7.4 L1619, §3.12.4 L1998, 19 §3.7.9 L1936 (V2-18).
8. 강등 결과 코드: 02 L1175(`downgraded.interpretation_to_assumption`) ↔ 10 L660·L717·L1361, 08 L3949(`downgraded.assumption`) (V2-19).

## 4. 확인 범위와 한계

- 설계 문서와 판정 문서는 읽기만 했다. 본문 전체는 읽지 않았고, 지적 범위와 grep 결과만 읽었다. 수정하지 않았다.
- `.helm/private/`은 열지 않았다. git 명령은 쓰지 않았다. 다른 에이전트는 부르지 않았다.
- `just verify`는 실행하지 못했다. 프로젝트에 justfile이 없다. `just --list`와 `just verify`가 모두 "no justfile found"를 냈다. 환경 문제로 보고하며 코드는 고치지 않았다.
- E-02·E-04의 1판 대응표 출현은 허용으로 보았다. 1판 이름을 왼쪽에, 09 이름을 오른쪽에 둔 표이기 때문이다.
