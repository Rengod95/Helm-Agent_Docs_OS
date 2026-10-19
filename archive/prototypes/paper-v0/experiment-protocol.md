# Paper Prototype Evaluation Protocol

> Status: pilot protocol v0.1  
> Purpose: Helm의 상호작용이 일반 chat 또는 현재 structured docs 방식보다 상황 인식, 판단, 결과 품질, 사용자 경험을 개선하는지 검증

## 1. 연구 질문

### RQ1 — Situation recovery

시간 간격 이후 사용자가 현재 목적·변화·위험·다음 상태를 얼마나 빠르고 정확하게 복원하는가?

### RQ2 — Decision leverage

Helm이 요청한 사용자 개입은 실제 기준, 방향, Commitment, 결과를 바꾸는가?

### RQ3 — Delegation quality

목적·권한·증거 의무가 있는 Delegation Contract는 조용한 범위 이탈과 완료 혼동을 줄이는가?

### RQ4 — Outcome quality

경쟁 가설과 증거 비교를 포함한 상호작용이 첫 번째 그럴듯한 해법을 바로 실행하는 방식보다 결과의 목적 적합성과 통합 품질을 높이는가?

### RQ5 — Work experience

사용자는 Helm 조건에서 더 큰 주도성·유능감·결과 소유감·흥미를 느끼면서 감당 가능한 workload를 유지하는가?

## 2. 연구 단계

한 번의 실험으로 모든 가설을 검증하지 않는다.

### Study 0 — Founder dogfood

- 참여자: product owner 1명
- 목적: 용어, artifact 밀도, facilitator 작성 비용, 치명적 누락 발견
- 기간: 실제 Concern 하나의 framing부터 integration까지
- 판단: 구조 삭제·병합과 실험 절차 보정. 시장 증거로 사용하지 않음.

### Study 1 — Formative usability

- 참여자: 에이전트 코딩 경험이 있는 5–8명
- 목적: comprehension, interaction breakdown, Gate theater, Context flooding 발견
- 방식: think-aloud + 재개 과제 + 반구조화 인터뷰
- 판단: 통계적 우월성보다 반복되는 실패 패턴과 임계 사건을 찾음

### Study 2 — Comparative pilot

- 참여자: 12명 이상을 목표로 하되 효과 크기 추정 후 본 실험 표본을 결정
- 목적: 조건별 상황 인식·workload·품질의 방향성과 분산 추정
- 방식: counterbalanced within-subject 또는 matched-task crossover

### Study 3 — Longitudinal field trial

- 참여자: 실제로 3개 이상 병렬 agent WorkUnit을 운영하는 사용자·팀
- 기간: 2–4주
- 목적: 자발적 재사용, context decay, 장기 의사결정, integration defect, 조직 기억 검증

## 3. 실험 조건

### Condition A — Chat baseline

- 일반 agent chat과 실행 로그
- 사용자가 평소 사용하는 최소 메모
- 연구자가 별도 구조화 요약을 제공하지 않음

### Condition B — Structured docs baseline

- 현재 Docs-Agent OS의 state, references, feature current, decisions 사용
- 현재 템플릿 이상의 Helm semantic object를 추가하지 않음

### Condition C — Helm paper prototype

- Return Brief
- Inquiry Map
- Delegation Contract
- Decision Gate
- 같은 원본 agent 실행과 source material 사용

연구자 도움의 양을 조건마다 기록한다. Helm 조건만 더 숙련된 facilitator가 사실상 문제를 해결해 주지 않도록 script와 source audit를 사용한다.

## 4. 과제 설계

과제는 단순 생성이 아니라 다음 특징을 포함해야 한다.

- 최소 3개 WorkUnit으로 분해 가능
- 두 개 이상의 합리적 ProblemFrame 또는 해결 가설
- 하나 이상의 숨겨진 Assumption
- 에이전트 결과 간 의미 충돌 가능성
- 자동 테스트만으로 판단할 수 없는 품질 기준
- 최소 하나의 가역적 결정과 하나의 고비용 결정
- 시간 간격 이후 복귀 단계
- 마지막에 전체 통합 판단 필요

### 예시 과제군

- 기존 서비스 인증 방식을 변경하면서 호환성·보안·UX를 함께 판단
- 문서 중심 agent workflow를 event/projection 모델로 전환
- 여러 에이전트가 각각 API, UI, migration, test plan을 설계하고 통합
- 성능 문제의 경쟁 원인을 병렬 조사하고 수정 전략 선택

조건 간 과제는 난이도, 익숙함, 자동 검증 가능성, 도메인 지식을 사전 평정하여 매칭한다.

## 5. 세션 절차

### Phase 1 — Orientation

1. 연구 목적과 데이터 수집 범위를 설명한다.
2. 도구 기능을 짧게 연습한다.
3. 참여자의 agent 경험과 도메인 친숙도를 기록한다.
4. 과제 목표와 초기 자료를 제공한다.

### Phase 2 — Frame and delegate

1. 참여자가 문제를 설명하고 첫 행동을 선택한다.
2. 조건에 따라 chat/docs/Helm artifact를 사용한다.
3. 최대 3개 병렬 WorkUnit을 시작한다.
4. clarification, reframe, authority change, delegation 시간을 기록한다.

### Phase 3 — Autonomous interval

1. 사전에 준비된 agent run 또는 실제 sandbox run을 진행한다.
2. 모든 조건에 동일한 Evidence와 failure injection을 제공한다.
3. 일부 run에는 의도적 모순, 오래된 가정, 부분 완료를 포함한다.

### Phase 4 — Resumption

1. 최소 24시간 간격을 두거나 Study 1에서는 distractor task 후 재개한다.
2. 사용자가 제공된 상태 자료만 보고 현재 상황을 설명한다.
3. 첫 유효 행동까지의 시간과 원본 로그 fallback을 측정한다.
4. project-specific situation-awareness probe를 수행한다.

### Phase 5 — Decision and integration

1. 중요한 이견 또는 방향 선택을 제시한다.
2. 사용자가 결정·추가 실험·연기·재위임 중 하나를 선택한다.
3. 결과를 수락 또는 반려하고 통합 계획을 만든다.
4. escaped conflict와 남은 obligation을 평가한다.

### Phase 6 — Debrief

1. workload와 경험 측정
2. critical incident interview
3. 사용자가 무시한 정보와 다시 찾은 정보를 확인
4. 어떤 개입이 결과를 바꾸고 어떤 개입이 방해였는지 회고

## 6. 상황 인식 측정

SAGAT는 동적 작업을 잠시 멈추고 실제 상태와 참여자의 인식을 비교하는 방식이다. Helm 초기 실험에서는 완전한 SAGAT 구현을 주장하지 않고 그 구조를 차용한 project-specific probe를 사용한다. [NASA 상황 인식 측정 검토](https://human-factors.arc.nasa.gov/publications/NASA_TM20210021987.pdf), [NASA NTRS SAGAT 자료](https://ntrs.nasa.gov/citations/19950007634)

### Level 1 — Perception

- 현재 활성 WorkUnit은 무엇인가?
- 새로 생성된 Evidence 또는 실패는 무엇인가?
- 어떤 Decision Gate가 열려 있는가?

### Level 2 — Comprehension

- 가장 중요한 변화는 왜 중요한가?
- 어느 Assumption 또는 Decision이 영향을 받았는가?
- 어떤 작업들이 서로 충돌하는가?

### Level 3 — Projection

- 개입하지 않으면 다음으로 어떤 행동이 일어나는가?
- 어느 시점 이후 방향 전환 비용이 크게 증가하는가?
- 가장 가능성 높은 다음 위험은 무엇인가?

### 점수

- 정답/부분 정답/오답을 사전 rubric으로 평가
- 핵심 항목에는 위험 가중치 적용
- 응답 확신과 실제 정확도를 함께 기록하여 calibration 측정
- 질문 수와 난이도는 조건마다 동일하게 유지

## 7. 행동 지표

### Resumption

- `time_to_orientation`
- `time_to_first_valid_action`
- `raw_log_fallback_count`
- `incorrect_state_assertions`
- `missed_critical_change`

### Decision

- `gate_response_time`
- `decision_changed_outcome`
- `criteria_modified`
- `experiment_requested`
- `false_escalation`
- `missed_consequential_decision`

### Delegation

- `clarification_rounds`
- `late_scope_change`
- `authority_violation`
- `claim_rejected`
- `acceptance_without_rework`

### Integration

- `semantic_conflicts_detected_before_merge`
- `unowned_obligations`
- `stale_decisions_reused`
- `post_acceptance_integration_failures`

### Attention

- 총 사용자 활동 시간
- artifact별 읽기·편집 시간
- interruption 이후 복귀 시간
- 중요 결정에 사용된 시간 비율
- facilitator가 정보를 구조화한 시간

## 8. 결과 품질 평가

조건을 모르는 두 명 이상의 평가자가 다음 rubric으로 결과를 평가한다.

| Dimension | 질문 |
|---|---|
| Purpose fit | 결과가 명시된 목적과 비목표를 만족하는가? |
| Technical correctness | 기능·논리·안전 기준이 충족되는가? |
| Evidence sufficiency | 수락 주장을 지지할 근거가 충분한가? |
| Alternative consideration | 중요한 대안과 반대 증거를 다뤘는가? |
| Integration coherence | 다른 결정·Artifact·사용자 경험과 정합적인가? |
| Maintainability | 가정·결정·제약이 후속 작업에 이해 가능한가? |
| Recovery readiness | 실패·변경 시 되돌리거나 재검토할 수 있는가? |

평가자 간 합의가 낮으면 점수를 평균하기 전에 rubric의 모호성을 수정한다.

## 9. Workload와 경험 측정

### NASA-TLX

NASA-TLX의 mental demand, temporal demand, performance, effort, frustration 등 다차원 workload 평가를 사용한다. 공식 NASA 자료와 지침을 따른다. [NASA Task Load Index](https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/)

각 condition 종료 직후 측정하고 전체 점수뿐 아니라 다음 trade-off를 본다.

- mental demand가 증가했지만 frustration과 rework가 감소했는가?
- 더 많은 effort가 높은 agency·quality로 정당화되는가?
- Helm이 쉬운 순간의 workload는 늘리지만 어려운 순간의 peak를 낮추는가?

### Motivation and agency

Intrinsic Motivation Inventory는 interest/enjoyment, perceived competence, perceived choice, pressure/tension 등의 하위 척도를 제공한다. 상업적 사용에는 공식 사이트의 라이선스 조건을 확인해야 하므로 문항을 이 저장소에 복제하지 않는다. [IMI 공식 자료](https://selfdeterminationtheory.org/intrinsic-motivation-inventory/), [설문 사용 조건](https://selfdeterminationtheory.org/questionnaires/)

라이선스를 확보하기 전 formative research에서는 검증 척도라고 주장하지 않는 탐색 질문을 사용한다.

- 내 판단이 결과의 방향을 실제로 바꿨는가?
- 현재 상황을 이해하고 통제할 수 있다고 느꼈는가?
- 이 작업을 다시 같은 방식으로 수행하고 싶은가?
- 개입이 의미 있는 일처럼 느껴졌는가, 승인 노동처럼 느껴졌는가?
- 결과가 내가 공동으로 만든 것처럼 느껴지는가?

### Engagement

후속 정량 연구에서는 User Engagement Scale Short Form 등 검증된 도구의 적합성과 사용 조건을 검토한다. 초기 pilot에서는 자체 질문을 표준화된 engagement score로 표현하지 않는다. [UES-SF 연구 자료](https://oro.open.ac.uk/68806/)

## 10. Critical incident interview

일반적인 만족도 대신 구체적 사건을 묻는다.

1. 방향을 잃었다고 느낀 정확한 순간은 언제였는가?
2. 어떤 정보를 다시 찾느라 시간을 썼는가?
3. 어느 Gate가 결과를 실제로 바꿨는가?
4. 어느 질문은 시스템이 묻지 말았어야 하는가?
5. 무엇 때문에 에이전트의 완료 주장을 믿거나 믿지 않았는가?
6. 어떤 Counterevidence 또는 대안이 없었다면 잘못 결정했을 것 같은가?
7. 어느 시점에 내가 일하고 있다고 느꼈고, 어느 시점에 시스템을 관리한다고 느꼈는가?
8. 다음 세션에서 어떤 artifact를 자발적으로 다시 사용하겠는가?

## 11. Facilitator 기록

각 artifact마다 다음을 기록한다.

- 작성 시간
- 원본 Event 수
- 불명확해 추가 추론한 필드
- 참여자가 읽지 않은 섹션
- 참여자가 수정한 필드
- 결정 또는 행동을 바꾼 필드
- 잘못 압축하거나 누락한 정보
- 자동 생성 가능해 보이는 부분
- 인간 판단이 반드시 필요했던 부분

이 데이터는 향후 Context compiler와 Gate classifier 범위를 결정한다.

## 12. 편향 통제

- 조건 순서를 counterbalance한다.
- task와 failure injection을 사전 고정한다.
- Helm artifact 작성자는 원본에 없는 추천을 임의 추가하지 않는다.
- 결과 평가자는 condition을 모르게 한다.
- 사용자가 요청한 추가 도움과 facilitator 개입을 모두 기록한다.
- 에이전트 모델, 도구 권한, 실행 시간 예산을 조건 간 맞춘다.
- founder dogfood 결과를 외부 시장 증거로 일반화하지 않는다.

## 13. 개인정보와 연구 윤리

- 실제 프로젝트 사용 시 secret, 개인 식별 정보, 제3자 데이터를 수집 대상에서 제외한다.
- 참여자에게 기록되는 화면·음성·로그를 명시하고 동의를 받는다.
- 원본 대화와 코드가 SaaS로 전송되는지 별도로 알린다.
- 연구 참여와 제품 사용 권한을 결합하지 않는다.
- 불편하거나 민감한 내용을 언제든 삭제 요청할 수 있게 한다.

## 14. Pilot 판단 기준

### Advance to read-only sidecar

다음 신호가 반복되면 최소 Event collector를 구현한다.

- Return Brief가 상황 복귀 시간을 줄이고 핵심 위험을 보존함
- 사용자가 네 primitive 중 다수를 자발적으로 다시 사용함
- facilitator가 반복적으로 같은 Event를 수동 추출함
- Gate의 상당수가 기준·방향·후속 Commitment를 실제로 바꿈
- 수동 artifact 작성 비용의 주된 원인이 데이터 수집임

### Revise interaction model

- 사용자가 원본 로그를 항상 다시 읽음
- Inquiry Map이 가설 수만 늘리고 결정을 개선하지 않음
- Contract가 실행 전 협상보다 형식적 작성 노동이 됨
- Gate가 대부분 추천 승인으로 끝남
- workload 증가가 품질·agency 증가로 정당화되지 않음

### Reframe or stop

- structured docs baseline과 반복적으로 차이가 없음
- 사용자가 공동 판단보다 완전 자동 결과를 일관되게 선호함
- 의미 객체 유지 비용이 integration/rework 감소보다 큼
- facilitator 도움을 제거하면 Helm 효과가 사라짐

## 15. 첫 dogfood session의 구체적 범위

Concern: `Helm의 첫 구현 투자를 어디에 할 것인가`

1. 제공된 [`Return Brief`](examples/helm-transition/return-brief.md)를 product owner가 수정한다.
2. [`Inquiry Map`](examples/helm-transition/inquiry-map.md)에서 누락된 Frame/Hypothesis를 추가한다.
3. [`Decision Gate`](examples/helm-transition/decision-gate.md)의 평가 기준을 수정하고 옵션을 선택하거나 실험을 요청한다.
4. 선택 결과를 [`Delegation Contract`](examples/helm-transition/delegation-contract.md)에 반영한다.
5. 24시간 이후 Brief 없이 기억한 상태와 새 Brief로 복원한 상태를 비교한다.
6. 사용되지 않은 필드와 실제 결정을 바꾼 필드를 기록한다.

이 첫 세션은 제품 방향을 자동 확정하지 않는다. 다음 구현 단위를 정할 Evidence를 생성한다.

