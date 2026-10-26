---
id: review.m3-design-inputs
layer: meta
domain: review
kind: review
status: draft
depends_on: [review.m3-plan, review.unresolved, review.m2-plan, product.scope.spec, adr.0013, adr.0014, adr.0015]
binds: []
---

# M3 설계 입력: 미결 수집과 사용자 결정 묶음

## 1. 목적과 읽는 법

- M3 설계 단계(2026-10-25 사용자 결정)의 첫 두 단계 산출물이다. 순서는 미결 모으기, 사용자 결정 묶음, L3 세부 설계(Helm, 학습)와 F·X·L1 요구, M3 구현 계획이다.
- 입력은 범위별 수집 네 벌이다: F·X·L0, L1·L2, L3·L4, 교차 문서(product, architecture, engineering, decisions, review). 수집 표 원본은 저장소 밖 작업 파일이고, 이 문서가 그 결과의 정본이다. 수집 ID를 저장소 안에서 추적할 수 있게, 사용자 결정과 요구의 원천 칸에는 원천 문서 경로나 절을 함께 적었다.
- 이미 정한 것:
  - [결정: adr.0015] M3-03 효과 목록은 C안(선언형 허용)이다. `g.delegate`·`loop.spawn`은 코어가 멱등을 보장한다. 능력 메서드는 F 정의에 `idempotent: true`를 선언하고 `requestId`를 받을 때만 허용한다. 읽기 메서드는 drive에서 허용한다. 선언 없는 쓰기는 요청 레코드와 워커를 거친다. 시험은 "재생 2회, 효과 1회"다.
  - [결정: 사용자 2026-10-25] `product.scope.spec` §10 미결 4(Helm 설계 착수 시점)는 "M2 마감 직후, M3 설계 단계 첫 트랙. 선행은 M3-03(ADR-0015)"으로 닫는다. 문서 반영은 2026-10-26 결정 반영 작업에서 했다.
  - [결정 2026-10-26] §3의 D-M3-01~D-M3-32는 모두 답을 받았다(두 차례, 둘째 답이 첫째 답을 덮는다). 각 결정 아래 "[결정 2026-10-26]" 줄이 채택안이다. 선택지 표와 권고는 기록으로 남긴다. 반영 문서: ADR-0016~0020, `review.m3-plan`, `review.m3-lower-requirements`, L3 Helm·학습·group-kit·slots, `product.scope.spec`.
- 번호: 사용자 결정은 `D-M3-NN`, 이 문서에서 새로 만든 M3 작업은 `M3-new-NN`, F·X·L1·L2 요구는 `REQ-<층>-NN`이다. 요구를 구현 계획 단위로 옮긴 번호는 `M3-REQ-NN`(`review.m3-lower-requirements`)이다. 수집 ID(`A-NN`, `KN-NN`, `U-NN`, 교차 행 번호 `C-NNN` 등)는 원천 추적용이다.
- 원천 경로는 `docs/xeon/` 기준이다. `xeon/`으로 시작하면 코드 경로다. L3 Helm·학습·group-kit 문서는 이 작업과 함께 고쳐졌으므로 줄 번호 대신 절 번호와 항목 이름으로 인용한다. 번호가 붙은 §10 목록은 목록 이름과 번호를 함께 적는다(예: Helm §10 "사용자 결정 대기" 1).

## 2. 요약

### 2.1 원시 표지 수

수집 시점(2026-10-26, L3 개정 전)의 `just docs-route --unresolved` 기준 문서의 `[미결` 표지는 1,013개(115개 문서)였다. 코드 주석의 표지는 21개다(수집 기준: F·X·L0 6, L1·L2 6, L3·L4 9). 같은 명령을 이 문서를 포함한 현재 작업 트리에서 다시 돌린 값은 1,044개(117개 문서)다. 늘어난 31개는 L3 Helm·학습 개정의 사용자 결정 대기 표지(L3 +24)와 `review`의 새 문서 두 개(+7, 문서 +2)다.

| 위치 | 수집 때 | 현재 | 위치 | 수집 때 | 현재 |
|---|---|---|---|---|---|
| F | 54 | 54 | L4 | 121 | 121 |
| X | 64 | 64 | architecture | 26 | 26 |
| L0 | 108 | 108 | decisions | 84 | 84 |
| L1 | 128 | 128 | engineering | 101 | 101 |
| L2 | 190 | 190 | product | 15 | 15 |
| L3 | 93 | 117 | review | 27 | 34 |
| `_routing`, `_templates` | 2 | 2 | 합계 | 1,013 | 1,044 |

### 2.2 병합 결과

수집마다 같은 질문을 다루는 표지를 한 행으로 묶었다. 표지가 없는 M3 언급, 계획 표의 M3 작업, open-issues 열린 항목도 행으로 넣었다.

| 범위 | 원시 표지 | 병합 행 | 사용자 결정 | 설계로 해결 | M3 구현 | M4 이후 | stale |
|---|---|---|---|---|---|---|---|
| F·X·L0 | 232 | 141 | 36 | 60 | 33 | 4 | 8 |
| L1·L2 | 321 | 195 | 26 | 110 | 40 | 17 | 2 |
| L3·L4 | 221 | 124 | 23 | 57 | 31 | 4 | 9 |
| 교차 문서 | 254 | 216 | 41 | 80 | 77 | 3 | 15 |
| 합계 | 1,028 | 676 | 126 | 307 | 181 | 28 | 34 |

- 합계 1,028은 수집 네 벌이 센 표지의 합이다. §2.1의 문서 표지 1,013과 코드 주석 21을 더한 1,034와 6건 차이가 난다. 수집마다 경계 문서를 센 방식이 달랐기 때문으로 보며 원인은 따로 추적하지 않았다 [가정].
- 교차 문서의 묶음 행 4개를 풀면 279건이다(M3 구현 91, stale 64).
- L3 Helm·학습 설계를 막는 행: F·X·L0 12(확인 필요 11), L1·L2 27, L3·L4 23(Helm 14, 학습 7, 둘 다 2), 교차 18(간접 11).

### 2.3 사용자 결정 후보 126행의 처리

| 처리 | 행 | 내용 |
|---|---|---|
| 사용자 결정 묶음(§3) | 84 | 같은 질문을 합쳐 `D-M3-01`~`D-M3-30` 30건 |
| 사용자 결정 묶음에 추가(§3.1 D-M3-32, §3.9 D-M3-31) | 이동 15 | 설계로 닫았던 행 가운데 정책·범위·ADR 승격 성격이라 사용자 확인이 필요한 수집 ID 15개(A-04, L1R-09, C-024, A-08, C-105, A-14, A-52, A-53, PS-03, U-59, U-64, C-121, C-122, C-123, C-125)와 C-128, 그리고 제안 대기열 소유 질문을 `D-M3-31`·`D-M3-32`로 올렸다 |
| 설계로 닫음(§3.8) | 33에서 이동분을 뺀 나머지 | 내부 API 모양, 이름, 문서 정정이라 작성자가 정한다 |
| 이미 결정됨 또는 M2 소관(§6) | 9 | ADR-0013·0014, M2 결정 D-d·D10·DG.3·D-e로 닫혔거나 M2 마감 작업이다 |

## 3. 사용자 결정 묶음

- 각 결정에 선택지와 권고를 단다. 권고를 받으면 "권고대로"로 답하면 된다. 묶음 결정은 행마다 따로 답할 수 있다.
- 2026-10-26 답을 받았다. 결정마다 첫 줄 "[결정 2026-10-26]"이 채택안이고, 권고와 다르면 그 줄에 적었다.
- "L3 차단"은 L3 Helm·학습 세부 설계가 이 답을 기다린다는 뜻이다. 차단 항목을 먼저 받는다.

### 3.1 그룹, Helm, 학습 (L3 차단)

#### D-M3-01 Helm의 형태와 기본 켬

- [결정 2026-10-26] c. Helm은 기본 플러그인이다. 별도 패키지(`@xeon/group-helm`)를 플러그인 산출물로 릴리즈에 넣고 첫 실행 때 사용자 확장 위치에 설치한다 [제안: 설치 경로]. 설치되어 있으면 켠다(`defaultEnabled: true`). 자체 확장 API로 X 로더가 싣고 pi 어댑터는 거치지 않는다(D-M3-11 c). 권고(a, 내장 그룹)와 다르다. 반영: `L3.helm.spec` §3.1, `L3.helm.plan` H-22.

- 원천: `L3/helm/spec.md` §10 "사용자 결정 대기" 1, `product/vision/spec.md` §10 4번(교차 C-004), 수집 U-14. L3 차단: Helm.

| 안 | 내용 |
|---|---|
| a | 내장 그룹, 기본 켬 |
| b | 내장 그룹, 기본 끔(첫 실행 안내에서 켬) |
| c | 기본 플러그인(별도 패키지로 설치, 설치하면 켬) |

- 권고: a. UC-2가 제품의 첫 차별 기능이고, M3-04의 `l3.helm.autoStart`·`writeGuard`와 `ext.helm.enabled`로 언제든 끌 수 있다.

#### D-M3-02 학습 그룹 기본 켬

- [결정 2026-10-26] a. 학습 그룹은 내장 그룹이고 기본 켬이다. 스킬 변경은 승인을 거친다.

- 원천: `L3/learning/spec.md` §3.1(`defaultEnabled`)과 §10 "사용자 결정" 1, 수집 U-13. L3 차단: 학습(매니페스트 기본값).

| 안 | 내용 |
|---|---|
| a | 기본 켬. 스킬 변경은 승인을 거친다 |
| b | 기본 끔. 첫 실행 안내에서 고른다 |

- 권고: a. 승인 기본 켬이라 사용자 확인 없이 스킬이 바뀌지 않고, 검토 1회 약 3만 토큰은 `l3.learning.review.*` 상한(`review.decisions-2` U-22)으로 묶인다.

#### D-M3-03 학습 검토 결과의 전달

- [결정 2026-10-26] a. 검토 결과는 부모 대화의 모델 입력에 넣지 않는다. 제안 대기열과 알림으로만 보인다. `DelegateSpec.report`는 선택 필드다.

- 원천: `L3/learning/spec.md` §4.3 "완료 통지"와 §10 "사용자 결정" 2, `L3/group-kit/spec.md` §3.4 "완료 보고"와 §10 "완료 보고가 새 turn을 시작하는지" 항목, 수집 U-10. L3 차단: 학습.
- 전제: [결정: adr.0013] 확장 `post`의 `next`는 turn을 시작하지 않는다.

| 안 | 내용 |
|---|---|
| a | 부모 대화의 모델 입력에 넣지 않는다. 제안 대기열과 알림으로만 보인다 |
| b | `kind: "context"`, `display: false` 항목으로 넣고 turn은 열지 않는다(현 제안) |
| c | 새 turn을 연다 |

- 권고: a. 검토 결과는 사용자가 승인할 제안이고, 부모 입력에 넣으면 프롬프트 캐시가 깨지고 토큰이 는다. a를 고르면 group-kit `DelegateSpec.report`를 선택 필드로 바꾼다(REQ-L1-05).

#### D-M3-04 그룹을 끌 때 진행 중 위임과 검토 포크

- [결정 2026-10-26] b. 그룹을 끄면 진행 중 위임과 검토 포크를 즉시 취소한다.

- 원천: `L3/learning/spec.md` §5 사례 5와 §10 "사용자 결정" 3, `L3/group-kit/spec.md` §4.10 "위임 규칙"과 §10 "완료 보고가 새 turn을 시작하는지" 항목, 수집 U-09. L3 차단: 학습.

| 안 | 내용 |
|---|---|
| a | 완료까지 두고 보고를 그대로 넣는다(group-kit 제안) |
| b | 즉시 취소한다 |
| c | 완료까지 두고 결과는 버린다 |

- 권고: b. 사용자가 그룹을 끄는 이유는 대개 비용이나 오작동이라, 끈 뒤에도 토큰을 쓰고 결과가 들어오면 기대와 어긋난다. 백그라운드 위임 취소 수단이 필요하다(REQ-L1-02).

#### D-M3-05 drive 임대 충돌 때 기본 동작

- [결정 2026-10-26] a. 대기한다. 앞 임대가 풀리면 다음 단계 경계에서 넘기고, 대기 상한을 넘으면 거부한다.

- 원천: `product/vision/spec.md:97`(§10 3번, 교차 C-005), `L3/README.md` §7 "제3의 drive 그룹" 행과 §10.2 미결 5, `L3/group-kit/spec.md` §10 "대기 vs 거부" 항목. L3 차단: Helm.

| 안 | 내용 |
|---|---|
| a | 대기. 앞 임대가 풀리면 다음 단계 경계에서 넘긴다. 대기 상한을 넘으면 거부한다 |
| b | 즉시 거부 |

- 권고: a. 그룹 요청이 말없이 사라지지 않고, 대기 시간은 임대 상한(`x.primitives.driveDefaultLimits`)으로 묶인다.

#### D-M3-06 유휴 중 임대를 받은 그룹의 자율 turn

- [결정 2026-10-26] a. 유휴 중 임대를 받은 그룹은 임대 상한 안에서 turn을 연다.

- 원천: `L3/group-kit/spec.md` §10 "유휴 중 임대 부여로 자율 turn" 항목, `L3/README.md` §10.2 미결 6, `X/primitives/spec.md` §4.5.5, 수집 U-07. L3 차단: Helm.

| 안 | 내용 |
|---|---|
| a | 허용. 임대 상한(`maxTurns`, `maxSpawns`, `maxTokens`) 안에서 turn을 연다(X 제안) |
| b | 금지. drive는 사용자 turn이 도는 동안만 turn을 연다 |
| c | 허용하되 그룹 설정 기본값을 끔으로 둔다 |

- 권고: a. Helm의 탐구·수렴 단계는 사용자 turn이 끝난 뒤에도 이어져야 하고, 비용은 `review.decisions-2` U-12의 기본 상한이 묶는다.

#### D-M3-07 안전 모드에서 L3 내장 그룹

- [결정 2026-10-26] a. 안전 모드에서 L3 그룹을 싣지 않는다. Helm은 사용자 등급 플러그인이라 안전 모드에서 같은 결과다.

- 원천: `X/operations/spec.md:1338`(§10 19), `X/README.md:138`, 수집 A-27. L3 차단: 둘 다(기본 그룹 정책).

| 안 | 내용 |
|---|---|
| a | 끈다(X 제안) |
| b | 남긴다 |
| c | drive 그룹만 임대 없이 싣는다 |

- 권고: a. 안전 모드는 문제 원인을 분리하는 수단이라 내장 그룹도 확장 코드로 다루는 편이 진단이 단순하다.

#### D-M3-08 메모리 정본 위치

- [결정 2026-10-26] a. 메모리 정본은 마크다운 파일이고 DB는 색인·원장·제안 대기열이다.

- 원천: `L2/knowledge/spec.md:1371`(§10 1), 수집 KN-07. L3 차단: 학습(쓰기 대상).

| 안 | 내용 |
|---|---|
| a | 정본은 마크다운 파일, DB는 색인·원장·제안 대기열(제안) |
| b | 정본은 DB, 파일은 내보내기 |

- 권고: a. 사용자가 편집기로 고치고 git이나 백업으로 옮기기 쉽다. `eng.context-map.design` §4.1 "메모리" 열을 이에 맞춘다.

#### D-M3-09 프로젝트 스킬에 대한 에이전트 쓰기

- [결정 2026-10-26] c. 모델 도구 경로는 프로젝트 스킬 쓰기를 금지하고, 학습 제안 승인 화면에서 사용자가 프로젝트 범위를 고를 때만 쓴다.

- 원천: `L2/knowledge/spec.md:1383`(§10 13), 수집 KN-14. L3 차단: 학습(제안 대상 범위).

| 안 | 내용 |
|---|---|
| a | 모델 도구 경로에서 금지. 학습 제안은 사용자 범위에만 쓴다(제안) |
| b | 승인 뒤 허용 |
| c | 모델 도구 경로는 금지하고, 학습 제안 승인 화면에서 사용자가 프로젝트 범위를 고를 때만 쓴다 |

- 권고: c. 프로젝트 스킬은 저장소를 거쳐 다른 사람에게 퍼지므로 모델 경로는 막고, 사용자가 명시로 고른 경우만 연다.

#### D-M3-32 제안 대기열 소유

- [결정 2026-10-26] a. 대기열 둘을 유지하고 L4가 한 목록으로 합쳐 보인다.

- 원천: `L3/learning/spec.md` §10 "설계 질문" 8과 §3.7.1(REQ-LN-10), `L3/learning/plan.md` §7, `L2/knowledge/spec.md:1373`(§10 미결 3·22), 수집 KN-05, U-12, REQ-L2-02. L3 차단: 학습(대기열 투영과 승인 화면).
- 배경: 학습 그룹 설계는 학습 그룹이 대기열을 소유하고 L4가 L2.knowledge의 쓰기 승인 대기열과 한 목록으로 합쳐 보이는 안으로 쓰였다. 이 문서의 `REQ-L2-02` 초안은 `cap_knowledge_proposals` 하나로 합치는 안이었다. 두 안이 문서마다 달라 사용자 확인으로 올린다.

| 안 | 내용 |
|---|---|
| a | 대기열 둘을 유지한다. 학습 그룹 소유(`x_learning_proposals`)와 L2.knowledge 소유를 L4가 한 목록으로 합쳐 보인다(L3 학습 spec 현행 설계) |
| b | `cap_knowledge_proposals` 하나로 합친다. 학습 그룹은 생산자이고 승인·적용은 L2.knowledge가 맡는다 |

- 권고: a. 학습 spec §3.6·§4.5와 plan LR-08~LR-11이 이 안으로 쓰여 있고 L2.knowledge 변경이 없다. 합침은 L4 목록 병합으로 끝난다. b를 고르면 `M3-REQ-18`, `M3-REQ-91`이 확정되고 학습 §3.6 대기열 투영 설계를 다시 쓴다. 답이 오기 전 `M3-REQ-18`, `M3-REQ-91`의 대기열 부분은 조건부다.

### 3.2 확장 계약

#### D-M3-10 확장 지점 표의 합의

- [결정 2026-10-26] 권고 확장안. a를 바탕으로 4번째 fold `collect`, 지점 선언이 정하는 지점별 실패 정책 표, 수명주기 지점(L3 요구분부터), 자체 이름 규칙(M3 F 첫 작업)을 더한다. ADR-0007을 개정하고(ADR-0017이 부분 대체) M3-15에서 pi 어댑터를 지운다. 권고(a, 현행 표 승인)와 다르다. 이 답으로 §3.8 A-22는 수명주기 지점으로, A-24는 지점별 실패 정책 표로 바뀐다.

- 원천: `decisions/ADR-0007-ext-points.md:246`(교차 C-029), `:243`, `F/extensions/spec.md:1306`, `:1310`, `X/README.md:127`, `:132`, 수집 A-21, A-23. L3 차단: 간접(지점 이름은 L3 문서가 이미 씀).
- 상태: 연산 4개와 fold 3종(`tap`, `first`, `chain`)은 사용자 결정이다. 지점 종류 5개(`input`, `request`, `tool`, `boundary`, `session`), 지점 이름, 지점별 fold 배정은 합의 전이다.

| 안 | 내용 |
|---|---|
| a | 현행 표를 승인한다. 이름은 pi snake_case가 정본이고 점 표기 별칭은 두지 않는다. boundary 지점은 `chain` 교체와 `finalize` 표지로 다룬다 |
| b | a에 4번째 fold `collect`를 더한다 |
| c | a에 지점별 fail-open 예외 표를 더한다 |

- 권고: a. 정해 둔 fold 3종을 바꾸지 않고, M2 코드와 L3 문서가 이미 이 표를 쓴다. pi `session_before_compact` 같은 예외는 지점 선언의 실패 정책 필드로 작성자가 정한다(§3.8).

#### D-M3-11 외부 확장의 M3 범위

- [결정 2026-10-26] c. pi 호환 없이 자체 확장 API만 둔다. 행 1은 로더·안전 모드, 행 2~4는 pi 어댑터가 없어 해당 없음이다. 행 5는 답이 없어 권고(같은 프로세스 한계 수용, 격리 M4)를 적용한다 [가정]. 외부 훅의 M3 포함 여부는 c안 원문이 빼므로 확인이 필요하다([미결], ADR-0017 §6). 권고(b, pi 어댑터 최소형)와 다르다.

- 원천: `review/m3-plan.md` M3-15(교차 C-190), `X/README.md:129`(교차 C-028), `X/loading-trust/spec.md:1276`, `X/operations/spec.md:1329`, `X/primitives/spec.md:1430`, 수집 A-28, A-33, A-42, A-59. L3 차단: 아니오(M3-15 종료 조건).

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | M3에 넣을 범위 | a 로더·훅·안전 모드·pi 어댑터 전체 / b 로더·훅·안전 모드 + pi 어댑터 최소형(도구, 명령, `on` 지점) / c 로더·안전 모드만 | b |
| 2 | pi-agent-core 가상 모듈 | 제공 / 제공하지 않음 | 제공하지 않음(ADR-0009로 의존을 없앴다) |
| 3 | pi 확장의 내장 도구 교체(`overrideTools`) | 허용 / 불허 | 불허(M4에서 재검토) |
| 4 | pi 세션 제어(`newSession` 등)와 `registerVirtualModel` | 지원 / 미지원 | 미지원 |
| 5 | 비협조 확장 코드 | 같은 프로세스의 한계를 받아들이고 자동 끄기로 보완 / 그룹별 격리를 1차에 넣음 | 한계를 받아들임, 격리는 M4 |

- 권고 이유: pi 확장 대부분은 도구와 명령 등록이라 최소형으로 쓸모를 얻고, 프로세스 격리는 M3 일정에 비해 비용이 크다.

### 3.3 무인 실행

#### D-M3-12 예약 실행 세션의 승인 정책

- [결정 2026-10-26] c를 기본으로 하고 설정으로 a·b·c를 고른다. 예약 실행 세션은 대기하고 승인 만료 뒤 거부로 끝낸다.

- 원천: `L2/schedule/spec.md:1539`(§10 6), `review/m3-plan.md` M3-08, 수집 SC-03. L3 차단: 학습(출처별 동작).

| 안 | 내용 |
|---|---|
| a | 대기. 알림과 원격으로 답한다(제안) |
| b | 거부(Hermes cron 방식) |
| c | 대기하고, 승인 만료(M3-06 `expiresAt`) 뒤 거부로 끝낸다 |

- 권고: c. 사용자가 알림을 늦게 봐도 실행이 무기한 묶이지 않는다. 만료 시간 기본값은 L1.tools가 정한다.

#### D-M3-13 무인 실행 기본값 묶음

- [결정 2026-10-26] 권고대로. 행 1 자동 재개 꺼짐(서비스 모드에서 `l1.persistence.autoResume`으로 켬), 행 2 승인 대기 세션은 live, 행 3 `once`·최소 간격 300초, 행 4 기존 세션 대상 예약 제외, 행 5 단계 1.5 생략을 [결정]으로 올림(ADR-0006 개정).

- 원천: 아래 행마다 적는다.

| 행 | 질문 | 원천 | 선택지 | 권고 |
|---|---|---|---|---|
| 1 | 자동 재개 기본값 | `L1/loop/spec.md:784`, `L0/process/spec.md:774`, `decisions/ADR-0006-process-service-mode.md:152`(수집 LP-02, A-94, C-020) | 꺼짐 / 서비스 모드에서 켬 / 항상 켬 | 꺼짐. 서비스 모드에서 `l1.persistence.autoResume`으로 켠다. 모델 요청 재전송 정책(A-06)과 효과 재생 시험이 M3에서 생긴 뒤 다시 본다 |
| 2 | 유휴 종료 때 승인 대기 세션 | `L1/tools/spec.md:1106`, `L4/host-service/spec.md:1153`, ADR-0006 §6(수집 TL-01, U-46, C-022) | live로 본다 / 종료한다 | live. 승인 대기 중 엔진이 내려가면 원격 응답을 받을 수 없다 |
| 3 | 놓친 예약 실행 | `L2/schedule/spec.md:1543`, `product/usecases/spec.md:170`(수집 SC-05, C-006) | 1회 따라잡기(`once`) / 건너뛰기 / 놓친 만큼 | `once`, 최소 간격 300초 |
| 4 | 기존 세션을 대상으로 하는 예약 | `L2/schedule/spec.md:1545`(수집 SC-07) | 1차 포함 / 제외 | 제외. 새 세션 예약으로 UC-4를 채운다 |
| 5 | 단계 1.5(세션별 워커) 생략 | `decisions/ADR-0006-process-service-mode.md:148`(교차 C-023) | [결정]으로 올림 / 열어 둠 | [결정]으로 올림. 서비스 모드 설계가 이 전제로 쓰였다 |

#### D-M3-14 print 모드의 비대화 자동 승인

- [결정 2026-10-26] c를 기본으로 한다(L1.tools 사전 허용 규칙만 적용, 나머지 거부). 옵션으로 b(전체 자동 승인 플래그, 모두 허용 포함)도 둔다. 권고(c만)와 다르다.

- 원천: `L4/cli/spec.md:799`(§10 8), 수집 U-54. M2는 승인 요청을 거부로 답하고 stderr에 알린다.

| 안 | 내용 |
|---|---|
| a | 플래그를 두지 않는다(M2 동작 유지) |
| b | 전체 자동 승인 플래그를 둔다 |
| c | 플래그 없이 L1.tools 사전 허용 규칙만 적용하고 나머지는 거부한다 |

- 권고: c. 무인 예약(D-M3-12)과 같은 규칙을 쓰고, 전체 허용 플래그의 위험을 피한다.

#### D-M3-15 목표 판정 실패와 판정 상한

- [결정 2026-10-26] 권고대로. 판정 실패는 `stop`, `maxRuns` 도달 뒤 turn 종료와 알림.

- 원천: `L2/work/spec.md:1360`(W-7), `L1/agents/spec.md:582`, 수집 WK-03, AG-07.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | 판정 호출이 실패했을 때 | `stop` / `continue` | `stop`(제안). 판정 없이 계속 돌면 비용 상한만 남는다 |
| 2 | `l1.agents.judge.maxRuns`에 이른 뒤 | turn 종료 / 사용자 알림 / 사용자 연장 | turn 종료와 알림. 연장은 사용자가 `/goal`로 다시 건다 |

### 3.4 서비스, 원격, 알림

#### D-M3-16 서비스 소켓 인증

- [결정 2026-10-26] c. 로컬 Unix 소켓은 파일 권한, TCP로 열 때만 토큰 필수.

- 원천: `F/wire-settings/spec.md:1365`(§10 4), `L4/host-service/spec.md:1157`, `L0/process/spec.md:777`, 수집 A-16, U-45.

| 안 | 내용 |
|---|---|
| a | 소켓 파일 권한만 |
| b | 토큰 필수(`host.hello` `auth`) |
| c | 로컬 Unix 소켓은 파일 권한, TCP로 열 때만 토큰 필수 |

- 권고: c. 원격은 SSH 터널이나 사설망으로 소켓을 잇는 방식(`review.decisions-2` U-11)이라 SSH 터널은 SSH 인증을 쓰고, 사설망에 TCP로 열 때만 토큰이 필요하다.

#### D-M3-17 원격 클라이언트와 알림의 M3 범위

- [결정 2026-10-26] 원격 형태는 둘이다. (1) 자체 호스트 서버에서 `xeon` 호스트를 켜 두고 다른 기기의 데스크톱 앱·CLI가 접속해 개발한다. (2) 자기 컴퓨터에서 데스크톱·CLI가 호스트를 켜서 쓴다. 웹 클라이언트 범위는 M3 /plan에서 정한다(후순위로 확정하지 않음). 웹·모바일 알림은 후순위다. 알림은 연결된 클라이언트 전달과 OS 알림이고, 클라이언트 창이 앞에 있어도 기본으로 보내며 설정으로 조정한다. 권고(행 3 보내지 않음)와 다르다.

- 원천: `product/usecases/spec.md:202`(교차 C-007), `review/m3-plan.md` M3-11(교차 C-189), `L2/dialog/spec.md:1078`, `L2/README.md:376`, 수집 NT-01.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | M3 원격 클라이언트 | 기존 CLI·데스크톱이 터널로 접속 / 웹 클라이언트 추가 / 전용 모바일 앱 | 기존 CLI·데스크톱. 웹·모바일은 M4 |
| 2 | M3 종료 조건의 알림 | OS 알림 + 연결된 클라이언트로 전달 / 모바일 푸시(외부 릴레이)까지 | OS 알림과 연결된 클라이언트 전달. 모바일 푸시는 M4 |
| 3 | 클라이언트 창이 앞에 있을 때 OS 알림 | 보낸다 / 보내지 않는다 | 보내지 않는다 |

- 권고 이유: 새 클라이언트와 릴레이 서버 운영은 M3 범위를 크게 늘린다. UC-5 주 흐름 5번은 터널 접속 클라이언트로 채운다.

### 3.5 보안과 데이터

#### D-M3-18 샌드박스 기본 정책

- [결정 2026-10-26] 행 1 네트워크는 기본 허용하고 차단 도메인 목록을 관리한다. 행 2 자격 파일 읽기는 기본 허용하고 옵션으로 막는다. 행 3 권고대로(두되 기본 끔, 켜도 매번 승인). 행 1·2는 권고와 다르다.

- 원천: `L0/sandbox/spec.md:510`, `:513`, `:516`, `review/m3-plan.md` M3-14, 수집 A-63, A-66, A-69. 착수 조건은 M3-14와 같다(CI bwrap 시험, macOS Seatbelt 결과).

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | 네트워크 | 전부 차단 / 차단 + `l0.sandbox.network.allowedDomains`를 1차에 엶 / 차단 + 첫 차단 때 승인 질문 | 차단 + `allowedDomains` 1차 개방. 기본 목록은 비우고, 차단 오류에 키 안내를 싣는다 |
| 2 | 자격 파일(`~/.npmrc`, `~/.config/gh` 등) 읽기 | 거부 / 허용 | 거부. 필요한 도구는 비밀 env 주입(`L0.exec.spec` §3.6)으로 쓴다 |
| 3 | 샌드박스 밖 재시도(`l0.sandbox.escapeRetry`) | 둔다 / 두지 않는다 | 두되 기본 끔, 켜도 매번 승인 |

#### D-M3-19 MCP 서버 정책

- [결정 2026-10-26] 행 1 권고대로 출처별 기본값(프로젝트 출처 켬, 사용자 출처 끔) + 서버별 설정. 행 4 sampling 미지원(2026-07-28 MCP 명세 개정에서 Deprecated, SEP-2577). 행 2·3은 명시 답이 없어 권고를 적용한다 [가정].

- 원천: `L0/sandbox/spec.md:512`, `decisions/ADR-0011-mcp-stdio-unsandboxed.md:68`, `:69`, `L2/mcp/spec.md:743`, `:745`, `:753`, 수집 A-65, MC-04, MC-05, MC-07, MC-11, C-067, C-210. M3-05, M3-14, M3-33과 연결된다.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | stdio 서버 샌드박스 | 모두 넣음 / 모두 사용자 권한(M2) / 출처별 기본값 + 서버별 설정 | 출처별. 프로젝트 출처 서버는 기본 켬, 사용자 출처 서버는 기본 끔 |
| 2 | 비밀 env 서버의 기동 승인 단위 | 서버 정의마다 1회(정의가 바뀌면 다시) / 기동마다 / 세션마다 | 정의마다 1회. 승인 레코드에 정의 해시를 싣는다 |
| 3 | 정의 `env`·`headers`의 평문 값 | `secret://`만(현행) / 평문 허용 / 평문 허용하되 비밀 이름 패턴(`KEY`, `TOKEN`, `SECRET` 등)은 거부 | 평문 허용 + 비밀 이름 패턴 거부. `.mcp.json` 호환을 넓히고 흔한 실수는 막는다 |
| 4 | sampling | M3 지원 / M3 거부, 2차 | M3 거부. 명세에서 deprecated다 |

- 행 1 권고 이유: 프로젝트 출처 정의는 저장소가 가져온 것이라 신뢰가 낮고, 사용자 출처 서버는 파일·네트워크 접근이 흔히 필요하다.

#### D-M3-20 이미 기록된 이벤트의 비밀 사후 가림

- [결정 2026-10-26] b. 표시·내보내기·모델 입력 단계에서 가리고 키 회전을 안내한다. 원본 행은 그대로 둔다.

- 원천: `L0/secrets/spec.md:776`(§10 9), `architecture/security/spec.md:128`(교차 C-018), 수집 A-87. M3-33.

| 안 | 내용 |
|---|---|
| a | 지원하지 않는다. 키 회전만 안내한다 |
| b | 표시·내보내기·모델 입력 단계에서 가림 필터를 적용하고 키 회전을 안내한다. 원본 행은 그대로 둔다 |
| c | b에 더해 원본 이벤트 행을 재작성하는 명시 명령을 둔다 |

- 권고: b. 이벤트 원장을 바꾸지 않아 재생 규칙이 유지되고, 노출 경로는 막는다.

#### D-M3-21 기록 보존 기간

- [결정 2026-10-26] a. 기본은 지우지 않고 설정 화면에서 기간을 정한다. 참조 없는 blob만 GC한다.

- 원천: `L2/knowledge/spec.md:1376`, `decisions/ADR-0004-session-storage.md:161`, 수집 KN-04, C-054. M3-24.

| 안 | 내용 |
|---|---|
| a | 기본은 지우지 않는다. 설정 화면에서 기간을 정할 수 있다. 참조 없는 blob만 GC한다 |
| b | 기본 보존 기간을 둔다(예: 이벤트 1년, 원장 180일) |

- 권고: a. 로컬 단일 사용자 앱이고, 되감기·학습·검색이 과거 기록을 쓴다. 디스크 상한 알림은 M3-24가 맡는다.

### 3.6 모델과 웹

#### D-M3-22 위장 provider 플러그인과 구독 계정 회전

- [결정 2026-10-26] 행 1 위장 provider를 별도 플러그인으로 지원한다. 행 2 계정 회전은 API 키 계정과 구독 계정 모두 지원한다. 둘 다 기본 꺼짐이고 첫 사용 때 약관 위험을 고지한다. 권고(본인 사용만, API 키 계정만)와 다르다.

- 원천: `product/scope/spec.md:80`(§10 3), `product/vision/spec.md:90`, `L1/models/spec.md:895`, `:900`, 수집 MD-02, MD-07, C-002.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | 위장 provider 플러그인 배포 | 본인 사용만 / 별도 플러그인 공개(기본 꺼짐) / 기본 포함 | 본인 사용만 |
| 2 | 계정 풀 회전 대상 | API 키 계정만 / 구독 계정 포함 | API 키 계정만 |

- 권고 이유: 두 행 모두 provider 약관 위반 위험이 있고, 공개 배포는 되돌리기 어렵다.

#### D-M3-23 웹 검색 기본값 묶음

- [결정 2026-10-26] 행 1 자동 선택 순서는 설정 화면에서 드래그앤드롭으로 정한다(등록된 검색 도구 목록, 기본 웹 검색 도구 포함, 플러그인은 기본 후순위). 여러 provider 동시 질의를 기본 기능으로 둔다. 행 2 Parallel은 넣지 않는다. 행 3 Jina는 넣지 않는다. 행 4 robots.txt는 기본 무시하고 옵션으로 지킨다. 행 5 첫 사용 고지. 브라우저 범주는 Stagehand(Browserbase, MIT, TS 라이브러리 + MCP)를 기본으로 넣고 Playwright MCP는 후보다. Aside·Ego Lite는 공식 API가 생기면 어댑터를 둔다. 크롤링 자동화는 사용자 프로그램·플러그인 영역이다. 행 1·4는 권고와 다르다.

- 원천: `decisions/ADR-0005-web-search-default.md:98`, `:179`, `:186`, `L2/web/spec.md:1307`, `:1752`, `architecture/security/spec.md:127`, 수집 WB-01, WB-06, WB-12, C-017, C-055, C-056, C-060. M3-12.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | 자동 선택 순서 | 키 플러그인 먼저 / 설정한 SearXNG 먼저 | 키 플러그인 먼저(제안). 명시 선택 키가 있으면 그것을 쓴다 |
| 2 | Parallel을 첫 실행 권장 목록에 | 넣음 / 넣지 않음 | 넣지 않음. 검색 provider는 2차다 |
| 3 | Jina 키 정책 | 키 없이 차단 / 키는 상위 한도용 | 원문 확인 뒤 작성자가 정한다. 확인 전에는 키 없는 호출을 기본 경로에 넣지 않는다 |
| 4 | robots.txt | 모든 fetch / 자동 수집에만 | 자동 수집에만. 공개 릴리즈 전에 다시 본다 |
| 5 | 키 플러그인 첫 사용 고지(T-08) | 고지 / 생략 | 고지. 검색어가 새 수신자에게 나간다 |

### 3.7 릴리즈, UI, 운영

#### D-M3-24 제품 이름

- [결정 2026-10-26] b. M3는 `xeon`으로 내고 M4 전에 바꾼다. 이름 후보는 미결로 남는다. 권고(a)와 다르다.

- 원천: `product/scope/spec.md` §10 2, `product/vision/spec.md:25`, `decisions/ADR-0014-single-xeon-binary.md:54`, `architecture/overview/spec.md:248`, `xeon/packages/cap-web/src/deps.ts:21`, 교차 C-001, C-011, 수집 WB-16.

| 안 | 내용 |
|---|---|
| a | M3 릴리즈 후보(M3-27) 전에 정한다 |
| b | M3는 `xeon`으로 내고 M4 전에 바꾼다 |

- 권고: a. 바이너리, 상태 디렉터리, 설정 키 접두, npm 스코프, 사용자 대행 UA의 URL이 한 번에 바뀌므로 공개 전에 한 번만 옮긴다(ADR-0014 §3.3). 이름 후보는 사용자가 낸다.

#### D-M3-25 릴리즈 준비 묶음

- [결정 2026-10-26] 행 1 Tauri 내장 서명 + Developer ID 공증(Apple 계정은 곧 확보). 행 2 Intel macOS는 지원하지 않고 빌드하지 않는다. arm64 Linux는 지원(빌드)한다. 행 3 최소 macOS 14, arm64만(Tauri 2 기본 최소는 10.13, WKWebView `isInspectable`은 13.3 필요). WebKitGTK 4.1은 [가정]으로 둔다. 행 4·5 권고대로. 행 6 npm 공개 없음. 행 2·3은 권고와 다르다.

- 원천: `L4/desktop/plan.md:405`, `:389`, `L4/desktop/spec.md:472`, `L4/cli/spec.md:798`, `L0/os/spec.md:753`, `decisions/ADR-0001-stack.md:127`, 수집 U-44, U-58, U-63, U-65, A-73, C-033. M3-26, M3-27.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | macOS 서명 | Tauri 내장 서명 / 수동 파이프라인 | Tauri 내장 서명 + Developer ID와 공증. 계정 보유 여부를 사용자가 확인한다 |
| 2 | CI 러너(Intel macOS, arm64 Linux) | 호스티드 러너 / 자체 러너 / 빌드 생략 | 호스티드 러너로 빌드만, 실기 확인은 하지 않는다(ADR-0014 §6 [가정]) |
| 3 | 최소 macOS와 WebKitGTK | 사용자 지정 | macOS 13 이상, WebKitGTK 4.1 [가정]. 실측 뒤 확정한다 |
| 4 | 릴리즈 형태 | 단일 파일 / 바이너리 + native 사이드카 디렉터리 | 단일 파일(ADR-0014). native 모듈이 꼭 필요하면 옆 디렉터리를 쓴다 |
| 5 | 외부 바이너리(sops, age, rg, bwrap, socat) | 모두 번들 / 시스템 설치 요구 / 섞음 | 섞음. macOS는 sops·age·rg를 번들·서명하고, Linux는 bwrap·socat을 시스템 패키지로 요구하고 doctor가 안내한다 |
| 6 | npm 공개 라이브러리 | M3 공개 / 공개 없음 | 공개 없음 |

#### D-M3-26 L4 공유 코드 위치와 DR-10 예외

- [결정 2026-10-26] b 변형. 새 패키지 `xeon/packages/client`(F에만 의존, L4)로 연결 코드와 CLI·데스크톱 공유 로직(설정 view-model 포함)을 옮기고 F는 순수 계약으로 둔다(ADR-0020). 권고(a)와 다르다.

- 원천: `L4/host-service/spec.md:1152`, `L4/cli/spec.md:801`, `L4/settings-ui/spec.md:950`, 수집 U-41, U-56.

| 안 | 내용 |
|---|---|
| a | 데스크톱 TS가 `@xeon/host/client`를 import하는 DR-10 예외를 연다. 설정 view-model도 같은 서브패스에 둔다 |
| b | 연결 코드와 view-model을 새 공유 패키지로 옮긴다 |
| c | `createHostConnection`을 F로 옮긴다(F에 런타임 로직이 생긴다) |

- 권고: a. 같은 성격의 `DR-10/cli-host` 예외가 이미 있고(`review.decisions-2` U-15), `client` 서브패스는 엔진 코드를 담지 않는다. 의존 규칙 예외라 사용자 승인이 필요하다.

#### D-M3-27 언어 방침

- [결정 2026-10-26] 한국어·영어 기본 지원. FormatJS(`@formatjs/intl` + `react-intl`), ICU MessageFormat, ko·en 카탈로그, `ui.locale` 기본 auto(OS)·en 폴백, Intl 날짜·숫자, UTC 저장, 오류는 kind+인자로 보내고 클라이언트가 문장화, 모델용 도구 설명은 영어(ADR-0016). CLI·호스트의 하드코딩 한국어 문자열 이전은 M3 작업이다.

- 원천: `L4/settings-ui/spec.md:947`, `L2/workspace/spec.md:761`, 수집 U-87, WS-08. M3-39.

| 행 | 질문 | 선택지 | 권고 |
|---|---|---|---|
| 1 | UI 문자열 | 한국어 직접 / 메시지 키 카탈로그(한국어 기본) | 카탈로그. 영어 추가가 문자열 교체로 끝난다 |
| 2 | 모델용 도구 설명 | pi 원문 영어 유지 / 한국어 번역 | 영어 유지. 모델 동작이 원문으로 검증됐고 포크 diff가 작다 |

#### D-M3-28 성능·메모리 예산 수치

- [결정 2026-10-26] a. M3-29 기준선 측정 뒤 수치 표를 받아 정한다.

- 원천: `engineering/performance/guide.md:23`~`:25`, `decisions/ADR-0012-speed-over-size.md:56`, `L4/desktop/spec.md:604`, 수집 U-60, C-098. M3-29.

| 안 | 내용 |
|---|---|
| a | M3-29 기준선 측정 뒤 수치 표를 받아 정한다 |
| b | 지금 잠정 수치를 정한다 |

- 권고: a. 측정 없는 수치는 게이트를 흔든다. 앱 크기 상한 500MB(ADR-0012)는 그대로 둔다.

#### D-M3-29 개발 운영 정책

- [결정 2026-10-26] 행 1 현재 버전 고정 + 점진 업데이트를 운영 정책으로 둔다(보안·버그 수정 때 갱신, 분기마다 상류 diff). 행 2~5 권고대로(Cordis `df4431e`, fast-check 도입, anti-patterns 승인자 사용자, ADR `superseded` 상태 추가).

- 원천: `decisions/ADR-0003-pi-durable-fork.md:149`, `decisions/ADR-0002-di-cordis.md:103`, `:104`, `L0/exec/spec.md:705`, `engineering/testing/guide.md:701`, `engineering/anti-patterns/guide.md:1068`, `decisions/README.md:193`, 수집 A-101, C-042, C-043, C-095, C-102, C-120.

| 행 | 질문 | 권고 |
|---|---|---|
| 1 | 포크 갱신(pi, Cordis, 실행 포크) | 보안·버그 수정 때 갱신하고, 분기마다 상류 diff를 한 번 본다 |
| 2 | Cordis 고정 기준 | `df4431e` 유지(작성자 제안) |
| 3 | 속성 테스트(fast-check) | 도입. 순수 함수(F 검증, 커밋 키, 병합 규칙)부터 쓰고 TC-04 절차로 ADR을 남긴다 |
| 4 | anti-patterns 항목 추가 승인자 | 사용자 |
| 5 | ADR `superseded` 상태 | 템플릿 status 값에 더한다 |

#### D-M3-30 M3 범위 확인 묶음

- [결정 2026-10-26] 행 1 가드레일은 내장 검사를 두지 않고 fail-closed 지점 셋(모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전)을 제공한다(ADR-0017 §3.6). 행 2 `work.reports`는 M3. 행 3 TUI 설정 화면은 지금 만들지 않되 나중에 만들 수 있게 막지 않는다. 행 1은 권고(보류 확정)와 다르다.

| 행 | 질문 | 원천 | 권고 |
|---|---|---|---|
| 1 | 입출력 가드레일 보류 | `L3/slots/spec.md` §10 "입출력 가드레일 보류 해제 조건" 항목, `decisions/README.md` §4 승격 표(수집 U-34, C-124) | 보류를 확정하고 M4에서 다시 본다 |
| 2 | `work.reports` 배치 | `L2/work/spec.md:1362`(수집 WK-01) | M3. 목표 판정과 같은 묶음이다 |
| 3 | TUI 설정 화면 | `L4/cli/spec.md:653`(수집 U-55) | 만들지 않는다. `xeon config` 명령과 데스크톱 화면으로 충분하다 |

### 3.8 설계로 닫은 사용자 결정 후보

내부 API 모양, 이름, 문서 정정이라 작성자가 정한다. 각 행은 해당 문서를 고치는 작업에서 `[제안]`으로 반영하고, 사용자 확인 없이 진행한다. 정책, 범위, 위협 모델, ADR 승격에 걸리는 항목은 이 목록에서 빼서 §3.9 `D-M3-31`로 올렸다.

| 원천 ID | 질문 | 정한 답 | 이유 |
|---|---|---|---|
| A-01 | Cordis 선언 병합 위치(`F/capabilities/spec.md:352`) | A안: F는 `ServiceKey<Api>`만 두고 X 래퍼가 타입을 복원한다 | F가 Cordis rc API에 묶이지 않는다. L3 C1·학습 11도 이 답으로 닫는다 |
| A-02 | 능력·도구 이름 네임스페이스 | `<확장>__<이름>` 접두, 내장 능력 이름 예약 목록, 충돌은 `tool_name_conflict`로 거부 | 현 코드(`validate.ts:73`)와 같다 |
| A-03, X-01 | 도구 없는 능력(`tools: []`) | 허용 | L2 다섯 능력 정의가 이 답을 기다린다 |
| A-17 | wire 폐기 기간 | 다음 주 버전까지 | 클라이언트와 엔진을 같이 배포한다 |
| A-18 | 확장의 wire 메서드 추가 | M3 불허. 명령 등록(`dialog.commands`)으로 대신한다 | wire 버전 협상 범위가 커진다 |
| A-22 | 지점 5종 밖 Xeon 고유 이벤트 | (D-M3-10 답으로 바뀜) 수명주기 지점(`lifecycle`)으로 연다. 첫 목록은 L3 요구분(`agent.settled`, `lease.rejected`)이다(ADR-0017 §3.5) | 옛 답(내구 이벤트 구독)은 D-M3-10 a안을 전제로 했다 |
| A-24, PS-04 | `session_before_*`, `project_trust`의 first fail-closed | 적용한다. pi `session_before_compact`는 지점 선언에 fail-open 예외로 적는다. D-M3-10 답의 지점별 실패 정책 표(ADR-0017 §3.4)가 이 규칙을 담는다 | 안전 쪽 기본값이다 |
| A-30 | 자동 끄기 영속 | 프로세스 단위. 설정 기록은 사용자 조작만 쓴다 | 일시 오류로 확장이 영구히 꺼지지 않는다 |
| A-31 | 재생 불가 보존 테이블 | 불허 | `x_` 테이블은 재생 가능 투영이라는 규칙을 지킨다 |
| A-35 | 외부 훅 목록 범위 병합 | 이어 붙이기 | 사용자·프로젝트 훅이 함께 돈다(Claude Code 방식) |
| A-72 | 파일 감시 책임 | 작업 공간은 exec, 앱 설정·스킬·플러그인 디렉터리는 os | 수집 요약대로이고 M3-07·M3-new-08에서 반영한다 |
| A-74 | WSL 토스트(powershell.exe) | 쓰지 않는다 | WSL은 개발 전용이다(`review.m2-plan` D-d) |
| A-75 | macOS 설정 위치 충돌 | 첫 실행 때 옛 위치를 읽어 옮기고 원본은 남긴다 | 되돌리기 쉽다 |
| A-108 | bun:ffi 문제 때 none provider 기본 | 측정 뒤 문제일 때만 바꾼다 | 아직 실패 보고가 없다 |
| MD-04 | 그룹이 새 모델 역할 등록 | 불허. Helm 렌즈는 기존 역할과 그룹 설정의 모델 지정으로 쓴다 | 역할 표가 설정 화면과 테이프 재생에 묶여 있다 |
| CX-08 | 도구 변경 미지원 provider의 추가 도구 지연 | 제안대로 다음 컴팩션까지 미룬다 | 캐시와 provider 제약을 지킨다 |
| C-010, C-009 | 하위 층 수 불일치, layer-plan-v2 표기 | JSON 실측으로 정정한다 | 사실 정정이다 |
| C-052 | macOS FTS5 dylib 경로 | 번들 SQLite를 쓰고 설정 키를 두지 않는다 | DESK.5 번들 규칙과 같다 |
| C-166 | L1 spec 임시 해석 정본화, 백그라운드 부모 기록 | L1 작성자가 임시 해석을 [제안]으로 적는다 | 문서 정정이다 |

### 3.9 정책·범위 확인 묶음

#### D-M3-31 설계로 닫았던 정책·범위 항목의 확인

- [결정 2026-10-26] 8행 모두 권고대로. 단 행 5의 PS-03(pi JSONL 가져오기)은 M4로 미루지 않고 지운다. 행 6은 ADR-0019, 행 7은 ADR-0018이다.

- 배경: §3.8에 작성자가 닫았던 행 가운데 정책, 범위, 위협 모델, ADR 승격(`decisions/README.md` §4 "승격은 사용자 확인 뒤에 한다"), 값 이름(`F.records.spec` §10 미결 4가 "사용자 확인 대상"이라고 적음)에 걸리는 항목이다. 아래 권고는 행 1을 빼고 §3.8에서 닫았던 답과 같다. 답이 오기 전에는 해당 문서 반영(M3-REQ-03, 09, 76, 88 등)을 조건부 [제안]으로 둔다. 행마다 따로 답할 수 있다.

| 행 | 질문 | 원천 | 선택지 | 권고 |
|---|---|---|---|---|
| 1 | `ReplayPolicy` 값 이름 | A-04, L1R-09, C-024, `F/records/spec.md` §10 4, `F/conversation/spec.md` §3.6, `F/capabilities/spec.md` §3.2, `L1/tools/spec.md` §3.6 | `safe\|unsafe`(F 문서와 ADR-0015 현행) / `never\|safe`(pi-agent-core `AgentTool.replay`와 같은 이름) | `safe\|unsafe` 유지. F.records·F.conversation·F.capabilities·L1.tools와 ADR-0015 §3.5가 이미 이 표기를 쓰고 `"never"`·미선언은 `toReplayPolicy`가 `"unsafe"`로 옮긴다. 바꾸면 위 문서와 ADR-0015를 함께 고친다 |
| 2 | 설정 우선순위와 관리 기본값 | A-14, `F/wire-settings/spec.md` | 관리 > 세션 > 로컬 > 프로젝트 > 사용자 > 기본값, 관리 범위는 잠금 전용 / 다른 순서 | 앞의 순서. Claude Code 규칙과 같고 사용자 혼란이 적다 |
| 3 | 신뢰 범위 | A-52, A-53, `X/loading-trust/spec.md` | (가) '이번 세션만'의 범위: 호스트 수명 / thread / 클라이언트. (나) 신뢰 전 프로젝트 설정: `ext.*`·`x.loading-trust.*` 밖 키도 신뢰 뒤에만 적용 / 그 두 접두만 | (가) 호스트 수명. (나) 신뢰 뒤에만. 서비스 모드에서 thread·클라이언트 단위는 혼란을 주고, 프로젝트 설정이 도구 정책을 바꿀 수 있다 |
| 4 | 해시 체인·HMAC 체크포인트 | A-08, C-105, `architecture/security/spec.md` | 두지 않는다 / 둔다 | 두지 않는다. 단일 사용자 로컬 앱이라 위변조 위협 모델이 없다. 위협 모델 판단이라 확인을 받는다 |
| 5 | M4 이후로 미룸 | PS-03(pi JSONL 가져오기), U-59(Windows 엔진 잔존), U-64(Windows 서명 인증서) | M4 이후 / M3 포함 | M4 이후. M3 범위에 쓰임이 없고 첫 지원 OS는 macOS와 Linux다 |
| 6 | ADR 승격 | C-121(SOPS 기본값), C-122(목표 판정), C-125(예산 결정), `decisions/README.md` §4 | 승격 / 각 spec의 [결정]으로 둠 | SOPS 기본값만 승격한다(§4 승격 기준: 여러 층과 비밀 참조 형식이 F에 걸린다). 목표 판정과 예산 결정은 기준 밖이라 승격하지 않는다 |
| 7 | 질문 도구와 계획 승인의 통합 | C-123, `decisions/README.md` §4, `L1/tools/spec.md` | ADR로 승격하며 L1-d 승인 프로토콜 하나로 통합 / ADR 없이 spec에서만 통합 / 통합하지 않음 | ADR로 승격하며 통합. §4 승격 기준(L1·L2·L4)에 들고, Helm·학습 승인 흐름과 M3-09 `review` kind가 같은 프로토콜을 쓴다. M3-REQ-09가 이 답을 기다린다 |
| 8 | on 핸들러의 읽기 메서드 호출 | C-128, ADR-0015 §3.2·§6 | 불허 / 허용 | 불허(ADR-0015 [제안] 유지). on 핸들러는 fold 합성 중에 돌고 읽기는 drive에서 한다. `L3/helm/spec.md` §4.11과 `L3/learning/spec.md` §4.2·§4.10이 불허를 전제로 쓰였다. 허용으로 정해지면 두 문서의 해당 문장과 학습의 `/learning` 명령 지연 정리(§4.5 규칙 7)를 다시 본다 |

## 4. L3 설계 입력

L3 Helm·학습 세부 설계가 답해야 할 항목이다. "정하는 곳"이 F·X·L1·L2면 그 요구를 §4.4 표에 모은다.

### 4.1 Helm

| ID | 질문 | 원천 | 정하는 곳·선행 | 요구 |
|---|---|---|---|---|
| H-IN-01 | 형태와 기본 켬 | `L3/helm/spec.md` §10 "사용자 결정 대기" 1 | D-M3-01 | — |
| H-IN-02 | 단계·신호 식별자와 전이표 확정 | `L3/helm/spec.md` §3.2·§4.2(이번 개정에서 고정), `L3/README.md` §10.2 미결 9 | L3 Helm 설계(완료) | — |
| H-IN-03 | 렌즈 목록, 선택 규칙, 렌즈 제안 경로 | `L3/helm/spec.md` §3.6, §10 "남은 내부 설계" 6 | L3 Helm 설계. 렌즈용 모델은 기존 역할(§3.8 MD-04) | REQ-L1-06 |
| H-IN-04 | 종료 판정과 다회 라운드 | `L3/helm/spec.md` §4.2, §10 "남은 내부 설계" 7 | L3 Helm 설계(제안: 적용 1회) | — |
| H-IN-05 | 부분 결과 허용 | `L3/helm/spec.md` §4.2, §10 (닫힘) 부분 결과 항목 | L3 Helm 설계(제안: 허용) | — |
| H-IN-06 | 신호 임계와 판정 세부, 설정 노출 | `L3/helm/spec.md` §3.5, §10 "남은 내부 설계" 8 | L3 Helm 설계 + M3-04 키 | — |
| H-IN-07 | 쓰기 판정용 도구 메타 출처 | `L3/helm/spec.md` §4.6, §10 (닫힘) 쓰기 판정 메타 출처 항목, `L1/tools/spec.md:999` | M3-02 | REQ-F-04 |
| H-IN-08 | `before_agent_start`, `tool_execution_end` 페이로드(`input`) | `L3/helm/spec.md` §8 요구 표(REQ-F-05) | F.extensions | REQ-F-05 |
| H-IN-09 | `ScopeApi.commit` 동시 커밋(CAS, 직렬화) | `L3/helm/spec.md` §4.1, §8 요구 표(REQ-X-02) | X.primitives | REQ-X-02 |
| H-IN-10 | `record`와 `commit` 원자 묶음 | `L3/helm/spec.md` §4.8, §8 요구 표(REQ-X-03) | X.primitives, F.extensions | REQ-X-03 |
| H-IN-11 | 재시작·재활성화 뒤 `leaseId`와 기본 `requestId` 재개 안전성 | `L3/helm/spec.md` §4.5, §10 (닫힘) `leaseId` 유지 항목 | X.primitives, ADR-0015 | REQ-X-01, REQ-X-04 |
| H-IN-12 | drive 안 능력 호출: `gatherContext`는 읽기, `linkWork`는 멱등 쓰기(C2 닫힘) | `L3/helm/spec.md` §4.5, §4.11, §10 (닫힘) C2, ADR-0015 §4.3 | L2 work·knowledge 분류 | REQ-F-01, REQ-L2-01 |
| H-IN-13 | 서비스 키 체계(C1) | `L3/helm/spec.md` §3.8, §10 (닫힘) C1 | §3.8 A-01 | REQ-X-09 |
| H-IN-14 | 유휴 자율 turn, 임대 충돌, 안전 모드 | `L3/group-kit/spec.md` §10 "대기 vs 거부"와 "유휴 중 임대 부여" 항목, `X/operations/spec.md` §10 19 | D-M3-05, 06, 07 | REQ-X-08 |
| H-IN-15 | 탐구가 없을 때 turn마다 임대 부여·반납 비용 | `L3/helm/spec.md` §3.3, §10 "남은 내부 설계" 10 | L3 Helm 설계. 문제가 되면 X 후보 제외 조건 | — |
| H-IN-16 | Helm 쓰기 거부와 샌드박스 강제 위치가 `tool_call` 지점에서 겹치는지 | `X/operations/spec.md:1339`, `X/README.md:139` | X.operations | REQ-X-11 |
| H-IN-17 | `xeon.domain` 불일치(C3) | `L3/helm/spec.md` §10 (닫힘) C3 | M3-35 | — |

### 4.2 학습 그룹

| ID | 질문 | 원천 | 정하는 곳·선행 | 요구 |
|---|---|---|---|---|
| L-IN-01 | 기본 켬 | `L3/learning/spec.md` §10 "사용자 결정" 1 | D-M3-02 | — |
| L-IN-02 | 검토 포크 시작 규칙(on 핸들러의 `g.delegate`) | `L3/learning/spec.md` §4.3, §10 (닫힘) adr.0015 항목 | [결정: adr.0015] 허용. 학습 spec §4.3·§10에 반영했다(대체안 문단 삭제) | REQ-L1-01 |
| L-IN-03 | 검토 결과 전달 | `L3/learning/spec.md` §10 "사용자 결정" 2 | D-M3-03 | REQ-L1-05 |
| L-IN-04 | 그룹 끄기 때 검토 포크 | `L3/learning/spec.md` §10 "사용자 결정" 3 | D-M3-04 | REQ-L1-02 |
| L-IN-05 | 자식 대화(검토 포크)에서 그룹 핸들러 발화 범위 | `L3/learning/spec.md` §10 (닫힘) 자식 대화 발화 항목, `L3/group-kit/spec.md` §7 "delegate" 문단 | L1.agents, X | REQ-L1-04 |
| L-IN-06 | 그룹 간 이벤트 격리 | `L3/group-kit/spec.md` §3.7, `X/README.md:130`, `decisions/ADR-0007-ext-points.md:250` | X.primitives | REQ-X-05 |
| L-IN-07 | 검토 포크 spawn 상한 귀속(임대 밖 위임) | `L3/README.md` §10.2 미결 7, `L3/group-kit/spec.md` §3.4 "상한" | L1.agents | REQ-L1-03 |
| L-IN-08 | 기존 스킬과 충돌하는 후보 병합 규칙 | `L3/learning/spec.md` §10 (닫힘) 병합 규칙 항목, `product/usecases/spec.md` §10 4 | L3 학습 설계 | — |
| L-IN-09 | 제안 대기열 소유(L2 knowledge 대 L3 learning) | `L3/learning/spec.md` §10 "설계 질문" 8, `L2/knowledge/spec.md:1373` | [결정: D-M3-32 a] 대기열 둘, L4가 합쳐 보임. M3-18 | REQ-L2-02 |
| L-IN-10 | 메모리 정본과 프로젝트 스킬 쓰기 | `L2/knowledge/spec.md:1371`, `:1383` | D-M3-08, 09 | — |
| L-IN-11 | 입력 출처(사용자, 예약, 원격)를 아는 지점 페이로드, 원장 `afterUntrusted` | `review/m3-plan.md` M3-13, `L2/knowledge/spec.md:1391` | F.extensions, L1.loop | REQ-F-06 |
| L-IN-12 | 검토 포크의 도구 제한(`tools.deny`)과 확장 티어 | `L1/agents/spec.md:350`, `F/README.md:255` | L1.agents, M3-33 | REQ-F-10 |
| L-IN-13 | 검토 승인 kind `review`와 승인 프로토콜 통합 | `L2/artifacts/spec.md:1207`, `decisions/README.md:161` | M3-09, [결정: adr.0018] | REQ-F-09 |
| L-IN-14 | 비공개 기록 `ScopeApi.recordPrivate` X 반영 | `review/consistency-1.md:111`, `X/primitives/spec.md` §4.6.5 | 이미 반영됨. 정리할 것은 `eng.events.design`·`eng.context-map.design`의 옛 접두 예제뿐이다 | — |
| L-IN-15 | 메모리 스냅샷·스킬 인덱스 위치와 컴팩션 뒤 재주입 | `L2/knowledge/spec.md:1374` | L2.knowledge, L1.context | REQ-L2-03 |
| L-IN-16 | 쓰기 도구 승인 이중화, 확장의 제안 결정(`decide` 호스트 전용) | `L2/knowledge/spec.md:1375`, `:1392` | L2.knowledge, L1.tools | REQ-L2-03 |
| L-IN-17 | knowledge 쓰기의 내구 멱등([가정]) | `decisions/ADR-0015-replay-effects.md` §7 | L2.knowledge 적합성 시험 | REQ-L2-01 |
| L-IN-18 | 큐레이터 트리거 | `L3/learning/spec.md` §10 (닫힘) 큐레이터 항목 | M4 이후(2차) | — |
| L-IN-19 | 학습 테스트의 scenario 계층 제한 | `L3/learning/plan.md` §5.2 "계층" 불릿 | L3 학습 계획 | — |

### 4.3 group-kit과 slots

| ID | 질문 | 원천 | 정하는 곳·선행 | 요구 |
|---|---|---|---|---|
| G-IN-01 | 공통 모순 2(on 핸들러 효과) 반영 | `L3/group-kit/spec.md` §3.4·§10 공통 모순 2, `L3/README.md` §10.2 미결 2 | [결정: adr.0015]. group-kit §3.4·§3.10과 plan G-20·G-28~G-30은 이 작업에서 고쳤고 L3.readme만 남았다 | REQ-X-01 |
| G-IN-02 | `replayDrive`의 효과 계수(모든 커밋 지점에서 끊고 두 번 실행) | ADR-0015 §4.3, `L3/group-kit/plan.md` G-20 | group-kit | — |
| G-IN-03 | 위임 래퍼와 L1.agents §3.2 필드 대조, delegate 스텁 해소 | `L1/agents/plan.md:172`, `xeon/packages/core-agents/src/service.ts:185` | L1.agents, M3-new-02 | REQ-L1-03 |
| G-IN-04 | `DriveArbiter`(정책)와 X(메커니즘)의 분담 | `L3/README.md` §10.2 미결 5 | X.primitives, D-M3-05 | REQ-X-08 |
| G-IN-05 | `GroupService`의 thread별 상태 노출 | `L3/group-kit/spec.md` §10 "`GroupService`가 thread별 상태를 보이는 방식" 항목 | L3 group-kit | — |
| G-IN-06 | 임대 이벤트 이름(`lease.*` 대 `drive.leased`) | `L3/group-kit/spec.md` §10 "임대 이벤트 이름" 항목 | F 이름(`lease.*`)을 정본으로, context-map 정정 | REQ-F-08 |
| G-IN-07 | 요청 레코드 워커 소유, `readOnly` 표지 이름, 외부 확장 `idempotent` 신뢰 조건 | ADR-0015 §6 | F·X 계약 트랙 | REQ-F-01, REQ-X-07, REQ-X-10 |
| G-IN-08 | Cordis dispose와 `onDispose`의 관계(그룹 비활성화 정리) | `F/extensions/spec.md:1316` | X.primitives | REQ-X-12 |
| G-IN-09 | `ScopeApi.provide` 위치 | `X/primitives/spec.md:1420` | X.primitives | REQ-X-09 |
| G-IN-10 | 조립 루트 포트 연결(`GroupSettingsSourceKey`, `DriveHolderSettingsPort`, `GroupCatalogPort`) | `L3/group-kit/spec.md` §10 "M2 구현이 남긴 연결" 항목 | L4 host, M3 구현 | — |
| G-IN-11 | 2차 조회(계측·승격 집계용) | `L3/group-kit/spec.md` §3.13 5번 | M3-new-09 | — |
| G-IN-12 | `scanDriveSource`의 `@swc/core` import와 DR-07 행 | `L3/group-kit/spec.md` §3.11 파서 문단과 §10 `scanDriveSource` 항목 | eng.dependency-rules | — |
| G-IN-13 | `xeon.domain` `kit` 대 `group-kit` | `L3/README.md` §3 `xeon.domain` 불릿, `L3/group-kit/spec.md` §10 공통 모순 3 | M3-35. 제안대로 `group-kit`으로 맞춘다 | — |
| G-IN-14 | L3.readme 표의 옛 tier·예산 소유 표기 | `X/README.md:125` | L3.readme 정정 | — |
| G-IN-15 | 템플릿 위치, 정책 플러그인 kind 기준, `xeon group new` 소유 | `L3/README.md` §10.2 미결 11·12, `L3/slots/spec.md` §10 "템플릿 파일 위치" 항목 | M3-17. 제안대로 `group-kit/templates/` | — |
| G-IN-16 | 외부 그룹 신뢰 등급 값 집합 | `L3/slots/spec.md` §10 "외부 그룹의 신뢰 등급" 항목, `X/primitives/spec.md:1434` | X.loading-trust, M3-15 | — |
| G-IN-17 | 입출력 가드레일 | `L3/README.md` §10.2 미결 13 | [결정: D-M3-30 행 1] 내장 검사 없음, fail-closed 지점 셋(ADR-0017 §3.6) | REQ-F·X(가드 지점) |

### 4.4 F·X·L1·L2 요구

| ID | 받는 문서 | 요구 | 원천 |
|---|---|---|---|
| REQ-F-01 | `F.capabilities.spec` §3.2, §3.6, §4.6, §9 | `MethodDef.idempotent?: true`와 읽기 표지(`readOnly` 또는 `effect` 열거 하나), `validateCapability` 코드 4개, 공통 오류 `effect_not_allowed`, 수용 기준 | ADR-0015 §4.3·§6, C-127 |
| REQ-F-02 | `F.extensions.spec` §3.2, §3.4, §4.3, §4.6 | 효과 목록을 ADR-0015 표로 바꾸고 `LoopHandle` 주석을 고친다. `requestId` 결정성 규칙과 `TurnInput.requestId` 순번 문구 | ADR-0015, A-47, B-06 |
| REQ-F-03 | `F.records.spec` §10 4, `L1.tools.spec`, `L1.persistence.spec` | `ReplayPolicy` 값 이름은 `safe\|unsafe`로 확정한다 [결정: D-M3-31 행 1]. `F.records.spec` §10 4의 미결 표기만 닫는다 | A-04, L1R-09, D-M3-31 행 1 |
| REQ-F-04 | `F.records.spec`, `L1.tools.plan` | `ToolCallPayload`에 `risk`·`hints`·`caller`, `tool_execution_end`에 `input`, `ToolSpec.locks` | M3-02, B-04, TL-06 |
| REQ-F-05 | `F.extensions.spec` | `before_agent_start` 페이로드 필드 확정 | U-24 |
| REQ-F-06 | `F.extensions.spec`, `L1.loop.spec` | 지점 페이로드에 입력 출처(사용자, 예약, 원격) | M3-13, KN-19 |
| REQ-F-07 | `F.capabilities.spec` §4.4 | `tools: []` 허용 | A-03, X-01 |
| REQ-F-08 | `F.records.spec`, `eng.context-map.design` §5.1 | `LeaseAcquiredPayload.leaseEpoch`, 임대 이벤트 이름 `lease.*` 정본 | A-45, U-28 |
| REQ-F-09 | `F.records.spec`, `L1.tools.spec` | 승인 kind `review`(M3-09). 질문·계획 승인 단일 프로토콜은 ADR-0018로 정했다 | M3-09, C-123, adr.0018 |
| REQ-F-10 | `F.records.spec`, `L1.agents.spec` | `SpawnOrigin`·`ThreadCreateInput`의 부모 토큰과 초안, `ChildTurnRequest.tools.deny` | AG-03, AG-04, A-113 |
| REQ-X-01 | `X.primitives.spec` §4.4.3, §4.4.4, §4.6, §9 | 능력 래퍼의 문맥 검사, drive의 `idempotent` 쓰기는 명시 `requestId`만 받는다(기본 키는 `loop.turn`·`loop.spawn`에만. `leaseId` 유지 규칙 REQ-X-04가 닫히기 전까지. ADR-0015 §3.4 3번), `effects` 계수 규칙 | ADR-0015 §4.3 |
| REQ-X-02 | `X.primitives.spec` | `commit`의 `expectStateRev` CAS와 `state_conflict`는 `X.primitives.spec` §4.6.1에 이미 있다. 남은 요구는 같은 프로세스 안에서 같은 scope의 커밋 직렬화(또는 재시도 규칙)다 | U-20 |
| REQ-X-03 | `X.primitives.spec` | `record`와 `commit`의 원자 묶음 | U-23 |
| REQ-X-04 | `X.primitives.spec` | 재시작·재활성화 뒤 `leaseId` 유지 규칙 | U-21 |
| REQ-X-05 | `X.primitives.spec`, ADR-0007 §6 | 그룹 간 이벤트 격리(그룹 접두 필터 기본) | A-29, C-014 |
| REQ-X-06 | `X.primitives.spec` | 이미 반영됨(`X.primitives.spec` §4.6.5, `xeon/packages/ext-host/src/primitives/state.ts`). 요구가 아니다. `eng.events.design`·`eng.context-map.design`의 옛 밑줄 접두 예제 정정만 남는다 | T-21, C-119 |
| REQ-X-07 | `X.primitives.spec` | 요청 레코드 워커 소유. [제안] X 효과 워커(요청 레코드와 래퍼 검사가 X에 있다)와 결과 통지 방법 | C-129 |
| REQ-X-08 | `X.primitives.spec` §4.5.5, `X.operations.spec` | D-M3-05·06·07 반영: 대기 기본과 대기 상한, 유휴 자율 turn, 안전 모드의 내장 그룹 | U-06, U-07, A-27 |
| REQ-X-09 | `X.primitives.spec`, `F.extensions.spec` | 서비스 키 A안 래퍼, `ScopeApi.provide` 위치 | A-01, A-44, U-05 |
| REQ-X-10 | `X.loading-trust.spec` | 외부 확장 능력의 `idempotent` 선언을 믿는 조건(신뢰 등급, 적합성 시험) | C-130 |
| REQ-X-11 | `X.operations.spec` | 샌드박스 강제 위치(L0 실행 경로)와 `tool_call` 지점 처리 순서 | A-26 |
| REQ-X-12 | `X.primitives.spec` | Cordis dispose와 `onDispose` 정리 순서 | A-25 |
| REQ-L1-01 | `L1.agents.spec`, `L1.loop.spec` §4.8 | `delegate`·`loop.spawn`의 (thread, `requestId`) 멱등을 세션 DB에 남겨 재시작 뒤에도 유지(현재 프로세스 메모리 64개) | ADR-0015, LP-01, SC-04 |
| REQ-L1-02 | `L1.agents.spec` | 백그라운드 위임 취소 API, 부모 대화 삭제 때 보고 처리 | D-M3-04, AG-10 |
| REQ-L1-03 | `L1.agents.spec`, `L1.tasks.spec` | 그룹 위임의 caller 표기, 포그라운드·백그라운드 풀 공유, 임대 밖 위임 상한 | AG-13, AG-02, U-08 |
| REQ-L1-04 | `L1.agents.spec` | 자식 대화의 지점 발화와 그룹 핸들러 적용 범위 | U-02 |
| REQ-L1-05 | `L1.agents.spec`, `L3.group-kit.spec` | D-M3-03 반영: `DelegateSpec.report` 선택화와 보고 경로 | U-10 |
| REQ-L1-06 | `L1.models.spec` | 그룹 정의 역할을 두지 않음을 [제안]으로 적는다 | MD-04 |
| REQ-L2-01 | L2 각 spec(`work`, `knowledge`, `web`, `dialog`, `artifacts`, `schedule`, `mcp`, `workspace`) | 메서드마다 읽기·멱등·선언 없음 분류, 멱등 쓰기의 내구 기록 근거. `web.search`는 읽기이고 결과는 그룹이 커밋한다. `jobs.spawn`은 멱등 선언 | ADR-0015 §4.3, SC-04 |
| REQ-L2-02 | `L2.knowledge.spec`, `L3.learning.spec`, `eng.context-map.design` §4.1 | [결정: D-M3-32 a] 대기열 둘을 유지하고 L4가 합쳐 보인다. M3-18 wire는 두 출처를 각각 조회한다 | KN-05, U-12, D-M3-32 |
| REQ-L2-03 | `L2.knowledge.spec` | 메모리 스냅샷 위치, 승인 이중화 방지, 확장 `decide` 경로 | KN-09, KN-10, KN-20 |

## 5. M3 구현 후보

### 5.1 기존 번호에 붙는 수집 항목

| M3-NN | 받는 수집 항목 | 비고 |
|---|---|---|
| M3-01 | M-04(H-02~H-15, UC-2, H-16, H-18), U-26 | 선행 §4.1 설계 |
| M3-02 | B-04, TL-06, U-22, U-24 | REQ-F-04 |
| M3-03 | B-06, U-01, C-127~C-130 | [결정: adr.0015]. 구현은 M3-new-01 |
| M3-04 | U-19, C-183 | |
| M3-05 | A-96, MC-11, M-13, C-067, FK-13 | D-M3-19 행 2 |
| M3-06 | B-05, DG-12, C-184 | |
| M3-07 | SC-01, A-72, A-80(@parcel/watcher) | |
| M3-08 | SC-03, TL-01 | D-M3-12, D-M3-13 |
| M3-09 | AR-01, B-15 | REQ-F-09 |
| M3-10 | SC-06, M-15 | |
| M3-11 | NT-01, DG-10, B-12, M-03 | D-M3-17 |
| M3-12 | WB-01, WB-18, WB-19, WB-20, C-055~C-063 | D-M3-23 |
| M3-13 | KN-19, AG-13 | REQ-F-06 |
| M3-14 | A-63~A-66, MC-04, WB-05, C-148, C-173 | D-M3-18, D-M3-19 |
| M3-15 | B-13, A-58, AG-08, DG-11, M-12, U-97, C-171, A-116 | D-M3-11 c: pi 어댑터 없음, 로더·안전 모드 |
| M3-16 | A-103, SC-02 | |
| M3-17 | U-32, U-36, M-09 | |
| M3-18 | KN-05 | REQ-L2-02, D-M3-32 a |
| M3-19 | B-01, B-03, DG-04, U-91, U-92 | |
| M3-20 | B-02, DG-04 | |
| M3-21 | KN-10 | |
| M3-22 | A-30 | |
| M3-23 | A-82, KN-16 | |
| M3-24 | A-98, A-105, A-109, PS-02, PS-09, B-18, KN-04 | D-M3-21 |
| M3-25 | B-08, B-09, A-110 | A-110은 M2 마감 G2-06 소관인지 확인 |
| M3-26 | A-73, WS-04, U-95, U-96, C-050 | D-M3-25 행 5 |
| M3-27 | U-63, U-94, M-11, U-67, C-011, C-033 | D-M3-24, D-M3-25 |
| M3-29 | A-36, A-106, A-107, KN-13, U-68, C-034, C-065, C-098, C-099, C-109 | D-M3-28 |
| M3-30 | C-091, C-113 | |
| M3-31 | A-37, PS-08 | |
| M3-32 | A-80(pi-telemetry), A-83 | |
| M3-33 | A-06, A-87, A-113, AG-04, MC-07, C-018, C-042 | D-M3-19, D-M3-20, D-M3-29 |
| M3-34 | A-15 | |
| M3-35 | A-50, U-04, U-48, C-012, C-013 | U-48(host 대 host-service)도 함께 본다 |
| M3-36 | M-14 | |
| M3-37 | B-10, PS-05 | |
| M3-38 | C-015, C-039~C-041 | |
| M3-39 | U-87, WS-08 | D-M3-27 |
| M3-40 | (수집 항목 없음) | |

### 5.2 새 작업 후보

M2 마감 때 `review.m3-plan`에 더한다. `product.scope.spec` §4.3에 이미 있는 범위도 M3 계획의 작업 단위가 필요해 번호를 준다.

| # | 항목 | 수집 항목 | 근거 |
|---|---|---|---|
| M3-new-01 | ADR-0015 구현: F `MethodDef` 필드와 검증, X 능력 래퍼 문맥 검사와 기본 `requestId`, 코어 멱등의 내구 기록, L2 메서드 분류, `replayDrive` 효과 계수, provider 적합성 시험 | B-06, M-08, LP-01, SC-04 | ADR-0015 §4.3 |
| M3-new-02 | 백그라운드 위임과 목표 판정: core-agents 스텁 해소, `completeStructured`, `agent_before_settle` 연결, `agent.judged` | CD-01, AG-05, AG-14, LP-11, MD-09, WK-11 | scope §4.3 목표 판정 |
| M3-new-03 | 학습 그룹 1차(LR-01~LR-18, UC-3 스모크)와 L4 연계 | M-05, KN-22 | scope §4.3 |
| M3-new-04 | 공유 서비스 모드: `xeon service`, 소켓, ensure, 유휴 종료, 자동 재개, 리플레이 커서, `ExecService.withCwd` | M-01, M-18, PS-10, U-73, A-100 | scope §4.3 |
| M3-new-05 | 원격 사용: 서비스 소켓의 SSH 터널·사설망 연결, PR-20 중계 시험 | M-02, B-11 | `review.decisions-2` U-11 |
| M3-new-06 | 설정 화면 M3: 비밀 탭과 값 열람, 전용 편집기, 게이지, 첫 실행 권장, 관리 잠금 사유, `SettingsTab` | M-10, M-17, B-19, U-88, U-89, U-86 | `review.decisions-2` U-20, U-21 |
| M3-new-07 | 모델 계정 풀과 레이트 리밋. 계정 회전은 API 키·구독 계정 모두, 기본 꺼짐 + 첫 사용 고지(D-M3-22) | MD-08 | `review.decisions-2` U-21, D-M3-22 |
| M3-new-08 | 설정 파일 외부 변경 감시와 통지 | M-16, A-72 | M3-07과 같은 감시 수단 |
| M3-new-09 | 그룹 계측과 승격 보고(G-17, G-18) | M-07, U-30 | L3.group-kit.plan |
| M3-new-10 | `cap-workspace` `write`·`edit`·`grep`·`find`와 원자적 쓰기 | WS-10, WS-02 | scope §4.3 |
| M3-new-11 | `cap-artifacts`(리뷰·diff 승인, 제목·라벨, 레코드 카탈로그) | AR-08, B-07 | scope §4.3 |
| M3-new-12 | `cap-schedule`(타이머, 파일 감시, 원격, 루프, cron 세션 종류) | SC-08, KN-21, B-07 | scope §4.3 |
| M3-new-13 | `web.browse`(B10). 기본 브라우저 provider는 Stagehand, Playwright MCP는 후보(D-M3-23) | WB-17, WB-04, A-68, C-036 | `review.m2-plan` D4 |
| M3-new-14 | 기본 프롬프트 문안(응답 언어, 도구 사용 규칙) | LP-10 | L1.loop.spec |
| M3-new-15 | pi 메시지 스키마 깊은 검증 | A-12 | scope §4.3 |
| M3-new-16 | 실기 확인 묶음: fake-only FK-01~FK-18 중 M3 몫, Mac 실측(processStartFingerprint, NFD, IME, 키체인) | A-81, C-148~C-161 | `review.fake-only`, `review.macos-checklist` |
| M3-new-17 | 검사·도구 정리 묶음: open-issues E-01~E-05, N-07, V-05, eng 린트·스캔 항목, [가정] 확인 | C-077, C-079, C-080, C-082, C-087, C-092, C-097, C-101, C-104, C-131, C-147, C-169, C-172, C-174~C-176, C-178 | `review.open-issues` |
| M3-new-18 | L1 소항목: 최근 파일 재주입, 게이트 상한 조정, 청크 재생성 기준, 지시문 모방 검사 목록, post.accepted 동봉 코드 삭제, 인덱스 예산 | CX-09, LP-07, PS-07, AG-09, TK-07, KN-11 | 각 L1·L2 spec |

## 6. stale 표지

결정이나 구현으로 이미 닫혔는데 문서에 `[미결]`이나 닫힘 표기가 남은 곳이다. 정리는 소유 문서 작업에서 한다.

| 항목 | 닫은 근거 | 정리할 위치 |
|---|---|---|
| `post.when = next` 시작 여부 | adr.0013 | `X/README.md:126`, `X/primitives/spec.md:1190`~`:1192`, `:1414`~`:1416`, `X/loading-trust/spec.md:1071`, `L1/README.md:362`, `L1/loop/spec.md:777`, `:778`, `L1/tasks/plan.md:74`, `:147`, `architecture/runtime-flow/design.md:131`, `:299`, `product/usecases/spec.md:35`, `:67`, `:82`, `product/vision/spec.md:53`, `decisions/ADR-0007-ext-points.md:53`, `:247`, `xeon/packages/contracts/src/records/catalog/input.ts:90` |
| on 핸들러 효과 목록(G1-06) | adr.0015 | `L3/README.md` §10.2 미결 2, `F/README.md:277`(효과 목록 항목). L3 group-kit·Helm·학습·slots는 이 개정에서 닫았다 |
| Helm 설계 착수 시점 | 사용자 2026-10-25 | `review/m3-plan.md:93`, `product/scope/spec.md` §10 4, `product/vision/spec.md` §10 5 |
| 엔진 바이너리 구성 | adr.0014 | `L4/desktop/spec.md:597`, `L4/host-service/spec.md:1149`, `:1150`, `L4/cli/spec.md:792` |
| Linux·WSL 데스크톱 지원 수준 | `review.m2-plan` D-d | `L4/desktop/spec.md:461`, `:528`, `:605` |
| pi-tui 채택 | `review.m2-plan` D10(스파이크 조건부) | `L4/cli/plan.md:320`, `:330`. 스파이크 결과를 적고 표지를 뗀다 |
| `workspace.images` 최소형 M2 배치 | `review.m2-plan` DG.3 | `L2/README.md:371` |
| 데스크톱 상태 관리 라이브러리 | adr.0010 | `review/m2-plan.md:277`, `L4/desktop/plan.md:534` |
| M2·M3 정의 확정 문구 | 사용자 2026-10-22 | `L1/README.md:250`, `L1/tools/plan.md:19` |
| 구조화 출력 최소형 M3 배치 | `L1/models/plan.md:29` | `L1/README.md:364` |
| ULID 단조성 소유 | 결정 G5-03 | `F/conversation/spec.md:233`, `xeon/packages/platform-os/src/ids.ts:69` |
| TypeBox 버전 | `review.decisions-2` U-24 | `F/capabilities/plan.md:92`, `:154`, `review/open-issues.md:39` |
| ext-host index.ts 스텁 메모 | 구현 완료 | `X/primitives/spec.md:1435` |
| DT-12 F 쪽 답 | F 표에 있음 | `F/README.md:99` |
| ResourcePolicy 집합 판정 | M2 O-19 | `X/README.md:133` |
| adr.0003 §6 원문 확인, R-9 spill | L0.exec spec §10 4 | `L0/exec/plan.md:145`, `:254` |
| 닫힘 표기가 남은 항목 12건 | 각 행 본문 | `X/README.md:134`, `X/operations/spec.md:1311`, `:1316`, `:1320`, `:1324`, `:1331`, `:1335`~`:1337`, `X/loading-trust/spec.md:1261`, `:1273`, `F/records/spec.md:1200` |
| open-issues 참조 주석(N-02, N-05, N-08) | 코드 반영 | `xeon/packages/contracts/src/extensions/ports.ts:101`, `xeon/packages/ext-host/src/operations/storage/errors.ts:18`, `xeon/packages/ext-host/src/primitives/scope.ts:236`, `xeon/packages/contracts/src/wire-settings/wire/methods.ts:339` |
| L3 §10의 닫힘 항목 | 각 행 본문 | L3 Helm·학습·group-kit §10은 이 개정에서 (닫힘) 표기를 달았다. 남은 정리 대상은 `L3/README.md` §10.2 |
| L4 §10·§8의 닫힘 항목 | 각 행 본문 | `L4/host-service/spec.md:1155`, `:1156`, `:1159`, `:1162`, `:1164`, `:1166`, `:1168`~`:1173`, `L4/desktop/spec.md:598`, `:599`, `:607`, `L4/settings-ui/spec.md:941`, `:952`, `L4/README.md:162`, `:166`, `:169`, `:171`~`:173`, `:175`, `:178`, `:180`, `:182`, `:183`, `:187`, `:189`, `:202` |
| `secret.references`가 wire에 없다는 문구 | `F/wire-settings/spec.md:328` | `L4/cli/spec.md:805` |
| 교차 문서의 닫힘 문장·정정 잔여 | `review.decisions-2` §2 등 | `architecture/layers/spec.md:308`, `engineering/anti-patterns/guide.md:508`, `engineering/typescript/guide.md:1434`, `:1156`, `:1438`, `decisions/README.md:164`, `:165`, `review/consistency-1.md:54`, `:63`, `:64`, `:70`, `:72`, `:75`, `:83`, `:128`, `:135` |
| M2 마감 소관 | M2 마감 작업 | 실제 SearXNG 스모크(`review/fake-only.md:50`), Mac 확인 시간(`review/macos-checklist.md:51`), 테이프 녹화 FK-08(`review.m2-plan` D-e) |

## 7. 이 문서가 고치지 않은 다른 문서

처음 작성 때 M2 마감 작업이 쓰는 문서라 여기서 고치지 않았다. 2026-10-26 결정 반영에서 `review/m3-plan.md`와 `product/scope/spec.md`는 M2 마감 작업이 더 고치지 않게 되어 이 작업이 고쳤다(두 행의 "반영" 표기). 나머지 행은 그대로 남는다.

| 문서 | 고칠 내용 |
|---|---|
| `review/m3-plan.md` | §2 M3-03을 "결정됨: adr.0015(2026-10-25 C안)"로, §6 둘째 불릿을 결정 받음으로, §7 둘째 미결을 닫음으로 고친다. M3-03 원천에 L1R-09·LP-01·SC-04, M3-33 원천에 MC-07·AG-04를 더한다. §5.2의 M3-new-01~18을 번호를 매겨 더한다. M3-35에 U-48(`host` 대 `host-service`)을 더한다. §1에 이 문서를 입력으로 적는다. 반영: 2026-10-26 결정 반영 작업 |
| `product/scope/spec.md` | §10 4번을 "M2 마감 직후, M3 설계 단계 첫 트랙. 선행은 M3-03(adr.0015)"으로 닫는다. 반영: 2026-10-26 결정 반영 작업(§10 2·3번과 §4.7 지원 플랫폼도 함께) |
| `product/vision/spec.md`, `product/usecases/spec.md` | vision §10 5번(착수 시점)과 53행, usecases §10 6번과 35·67·82행의 `next`를 adr.0013 근거로 닫는다 |
| `review/m2-plan.md` | 277행 D2 상태 관리를 adr.0010으로 닫음 표기. M2 마감 기록에 M3-03 결정을 적는다. U-71(F가 더한 wire 3건의 호스트 처리)과 A-110(`migration_snapshot_failed`)이 M2 잔여인지 확인한다 |
| `review/unresolved.md` | 57행, 73행의 G1-06을 adr.0015로 닫는다. §4 승격 후보는 D-M3-31 행 6·7의 사용자 답에 따라 더한다 |

## 8. 미결 사항

- 닫음: §3의 D-M3-01~D-M3-32 사용자 답(2026-10-26, 두 차례).
- [미결] 결정이 새로 만든 확인 항목:
  - 외부 훅을 M3에 넣는지(D-M3-11 c안 원문은 "로더·안전 모드만", ADR-0017 §6).
  - D-M3-19 행 2·3과 D-M3-11 행 5는 명시 답이 없어 권고를 적용했다 [가정]. 사용자가 다르게 보면 다시 받는다.
  - Helm 설정 키 이름공간: 플러그인이 된 Helm이 코어 이름공간 `l3.helm.*`을 계속 쓸지 `ext.helm.*`로 옮길지(`L3.helm.spec` §10).
  - 웹 클라이언트의 M3 범위(D-M3-17). M3 /plan에서 정한다.
  - 자체 지점 이름 표(ADR-0017 §3.2). M3 F 첫 작업에서 정한다.
  - 제품 이름 후보(D-M3-24는 시점만 정했다).
- [가정] L3 밖 문서의 줄 번호 인용은 수집 시점(2026-10-26 작업 트리)의 값이다. L3 Helm·학습·group-kit 문서는 이 작업이 함께 고쳐 줄 번호가 달라졌으므로 모든 인용을 절 번호와 항목 이름으로 바꿨다. 이전에 적었던 표본 대조(13건)는 L3 줄 번호 인용이 바뀌기 전의 결과라 근거로 쓰지 않는다. L3 밖 줄 번호는 다시 대조하지 않았다.
- [제안] §3.8의 작성자 결정은 해당 문서를 고칠 때 `[제안]`으로 적고, 사용자가 반대하면 D-M3 번호를 새로 받아 되돌린다.
