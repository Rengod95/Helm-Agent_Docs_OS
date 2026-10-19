# Falsifiable Product Hypotheses

## 1. 목적

Foundations는 철학적 선언만으로 정당화되지 않는다. 각 핵심 원리는 실제 사용에서 관찰 가능한 가설로 번역되어야 한다. 결과가 가설을 지지하지 않으면 기능을 미세 조정하는 데 그치지 않고 원론과 제품 정의를 수정한다.

## 2. 비교 기준선

초기 실험은 최소한 다음 세 조건을 비교한다.

- **Chat baseline**: 일반 에이전트 채팅과 실행 로그만 사용
- **Structured docs baseline**: 현재 Docs-Agent OS 스캐폴드 사용
- **Helm prototype**: 의미 객체, Return Brief, Gate, Delegation Contract 사용

가능하면 같은 사용자, 유사 난이도 작업, 동일 에이전트 모델을 사용한다.

## 3. 핵심 가설

### H1. Return Brief는 복귀 비용을 줄이고 상황 인식을 높인다

**예측**

- 24시간 이상 지난 뒤 현재 목적·위험·진행 이유를 파악하는 시간이 감소한다.
- 사용자가 다음 행동과 예상 결과를 더 정확히 설명한다.
- 원본 로그를 다시 읽는 비율이 감소한다.

**지표**

- time-to-situational-awareness
- goal/risk/next-state recall accuracy
- raw-log fallback rate
- incorrect intervention rate

**반증**

- 요약을 읽어도 사용자가 원본 로그를 거의 항상 다시 읽는다.
- 빠르게 복귀하지만 중요한 이견이나 위험을 더 자주 놓친다.

### H2. Delegation Contract는 조용한 방향 이탈과 허위 완료를 줄인다

**예측**

- scope와 완료 기준의 재협상 시점이 빨라진다.
- 에이전트의 완료 주장 이후 대규모 재작업 비율이 감소한다.
- 권한 밖 행동과 숨겨진 Assumption이 더 일찍 드러난다.

**지표**

- late scope correction rate
- claimed-complete rejection rate
- unauthorized action rate
- acceptance-without-rework rate

**반증**

- Contract 작성 비용이 절약된 재작업 시간보다 크다.
- 사용자가 대부분의 필드를 형식적으로 승인한다.

### H3. 경쟁 가설 구조는 조기 수렴을 줄이고 결과 품질을 높인다

**예측**

- 첫 번째 그럴듯한 해법의 무비판적 구현이 감소한다.
- 핵심 Assumption과 Counterevidence 발견률이 높아진다.
- 고복잡도 작업에서 최종 결과의 설계 결함이 감소한다.

**지표**

- hypothesis diversity
- discriminating experiment count
- counterevidence coverage
- post-integration design defect rate

**반증**

- 가설 수만 늘고 최종 판단 품질이나 시간 대비 가치가 개선되지 않는다.

### H4. 위험 적응적 Gate는 고정 승인보다 주의력 효율이 높다

**예측**

- 중요한 결정의 인간 개입률은 유지 또는 증가한다.
- 사소한 승인 요청은 감소한다.
- 결정당 인간 시간 대비 결과 품질이 높아진다.

**지표**

- gate precision and recall
- false escalation rate
- missed consequential decision rate
- human minutes per consequential decision
- interruption recovery time

**반증**

- 사용자가 Gate를 무시하거나 일괄 승인한다.
- 중요한 문제가 Gate 없이 지나가는 비율이 허용 수준을 넘는다.

### H5. Observability–Predictability–Directability–Contestability는 신뢰 보정보다 유용하다

**예측**

- 사용자는 에이전트 정확도를 과신하거나 과소 사용하지 않고 상황별로 더 적절히 의존한다.
- 방향 수정 비용과 자동화 surprise가 감소한다.
- 설명을 읽는 것보다 실제 이의 제기와 수정 행동이 증가한다.

**지표**

- prediction accuracy of agent next action
- redirection latency and cost
- automation surprise count
- contested-and-improved outcome rate
- trust calibration

**반증**

- 상태 노출이 정보 과부하만 증가시키거나 사용자의 행동을 바꾸지 않는다.

### H6. 세 세계 모델은 통합 누락을 줄인다

**예측**

- 코드가 완료됐지만 목적·결정·문서가 갱신되지 않은 상태를 더 잘 탐지한다.
- 새로운 Evidence가 기존 Decision을 무효화하는 상황을 더 빨리 발견한다.
- 서로 다른 파일에서 발생한 의미 충돌을 Git 충돌 전에 발견한다.

**지표**

- normative/material drift incidents
- stale decision detection time
- semantic conflict detection rate
- escaped integration defect rate

**반증**

- 세 그래프의 유지 비용이 높지만 기존 체크리스트보다 탐지력이 개선되지 않는다.

### H7. ContextProjection은 전체 문서 읽기보다 효율적이고 안전하다

**예측**

- 에이전트 입력 토큰과 탐색 시간이 감소한다.
- 중요 Constraint 누락과 오래된 정보 사용이 감소한다.
- 역할별로 더 적절한 정보 밀도를 제공한다.

**지표**

- context token cost
- relevant-context precision/recall
- stale-context failure rate
- task reorientation time

**반증**

- 압축 과정에서 중요한 반대 증거가 반복적으로 누락된다.
- 사용자가 안전을 위해 항상 전체 문서 읽기를 강제한다.

### H8. 의미 있는 인간 참여는 산출물 품질과 경험을 함께 높인다

**예측**

- 사용자 개입이 있는 작업의 목적 적합성과 수락률이 높다.
- 사용자는 더 많은 시간을 쓰지 않으면서 결과 소유감과 유능감을 더 크게 느낀다.
- 장기 사용에서 에이전트 작업을 이해하지 못한다는 불안이 감소한다.

**지표**

- outcome fitness score
- user-rated agency, competence, ownership
- accepted-without-rework
- total human attention time
- continued voluntary use

**반증**

- 품질 상승 없이 사용자 시간과 피로만 증가한다.
- 사용자가 공동 작업보다 결과만 받기를 지속적으로 선호한다.

### H9. Decision과 Evidence의 재검토 트리거는 장기 맥락 부패를 줄인다

**예측**

- 변경된 환경에서 오래된 결정이 조용히 재사용되는 비율이 감소한다.
- 근거가 사라진 정책과 컨텍스트를 더 빨리 무효화한다.

**지표**

- stale decision reuse rate
- time-to-reopen after invalidating event
- obsolete constraint incidents

**반증**

- 트리거가 과도한 재검토와 알림을 만들지만 실제 결정을 바꾸지 않는다.

### H10. 통합을 별도 상태로 두면 지역 최적화가 감소한다

**예측**

- WorkUnit별 성공 이후 발견되는 시스템 수준 충돌이 감소한다.
- 통합 책임과 기준이 명확해진다.

**지표**

- post-acceptance integration failure rate
- unowned integration obligation count
- time from accepted to integrated

**반증**

- Accepted와 Integrated의 구분이 단순 상태 관료주의로 남는다.

## 4. 질적 연구

수치 지표만으로 “일하는 경험”을 판단하지 않는다. 다음 순간을 관찰하고 인터뷰한다.

- 하루 이상 지난 뒤 작업으로 돌아오는 순간
- 에이전트 결과가 서로 충돌하는 순간
- 사용자가 에이전트 권고를 거부하는 순간
- 완료 주장을 신뢰하거나 의심하는 순간
- 문제를 재정의하는 순간
- 여러 결과를 전체 프로젝트에 받아들이는 순간
- 사용자가 깊이 몰입하거나 피로해지는 순간

인터뷰 질문은 선호보다 실제 사건을 중심으로 한다.

- 마지막으로 방향을 잃었다고 느낀 정확한 순간은 언제였는가?
- 어떤 정보를 다시 찾느라 시간을 썼는가?
- 어느 결정에 더 일찍 참여했다면 결과가 달라졌을까?
- 어느 질문은 시스템이 묻지 말았어야 했는가?
- 어떤 에이전트 주장을 무엇 때문에 믿거나 믿지 않았는가?

## 5. 실험 순서

### Phase A — Paper/Wizard-of-Oz

실제 에이전트 런타임을 바꾸지 않고 사람이 Return Brief, Inquiry Map, Decision Gate를 수동 생성한다. UI 가치와 정보 구조를 먼저 검증한다.

### Phase B — Sidecar prototype

기존 agent run과 Git/CI Event를 수집하여 Helm projection을 생성한다. 실행 권한은 건드리지 않는다.

### Phase C — Delegation adapter

Delegation Contract를 에이전트 프롬프트와 권한 정책으로 변환하고 ClaimingComplete를 수집한다.

### Phase D — Closed-loop governance

위험 적응적 Gate, 자동 승인, 재검토 트리거, 통합 상태를 활성화한다.

## 6. 중단 및 피벗 기준

다음이 반복되면 현재 제품 정의를 좁히거나 수정한다.

- 일반 Kanban + chat summary가 상황 인식에서 동등한 성능을 보임
- 사용자가 의미 객체 대신 원본 대화만 지속적으로 선호함
- Gate precision이 낮아 approval theater가 됨
- ContextProjection이 재작업이나 토큰 비용을 유의미하게 줄이지 못함
- 경쟁 가설 절차가 복잡도만 늘리고 설계 결함을 줄이지 못함
- 세 세계 모델 유지 비용이 통합 오류 감소보다 큼
- 사용자 참여가 품질 향상 없이 피로만 증가시킴

## 7. 초기 성공 기준

첫 번째 프로토타입이 성공하려면 최소한 다음을 보여야 한다.

1. 사용자가 하루 뒤 5분 이내에 목표·위험·다음 결정을 정확히 복원한다.
2. 중요한 Gate의 다수가 실제 방향 또는 기준을 바꾼다.
3. 에이전트 완료 주장과 인간 수락 사이의 결함이 구조적으로 드러난다.
4. ContextProjection이 전체 문서 읽기보다 적은 비용으로 중요 제약을 보존한다.
5. 사용자가 결과 소유감과 상황 이해가 이전 방식보다 높다고 평가한다.

수치는 파일럿 이후 기준선을 측정하여 보정한다. 검증 전에 임의의 절대 목표를 제품 성공의 증거로 사용하지 않는다.

