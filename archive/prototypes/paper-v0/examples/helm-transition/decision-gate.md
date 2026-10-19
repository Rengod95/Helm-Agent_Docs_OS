# Decision Gate — Helm의 다음 검증 순서

> Example status: `committed`. 2026-08-16 product owner가 권고된 A → B 순차 전략의 실제 수행을 요청했다.

## Metadata

- Gate ID: `gate-helm-next-step-001`
- Concern: `helm-product-transition`
- Decision owner: product owner
- Created by: research/design agent
- Created at: 2026-08-16
- Decision window: 안정 domain schema 또는 runtime 구현 착수 전
- Last cheap point to change direction: DB schema, API, UI information architecture를 코드로 고정하기 전
- Gate reason: `high-uncertainty`, `integration`

## 1. Decision question

Helm Foundations 이후 첫 투자 단위를 `paper interaction validation`, `read-only sidecar`, `full domain kernel`, `v0 scaffold extension` 중 무엇으로 선택할 것인가?

## 2. Why now

- Triggering event: Foundations와 35개 방법론 전이 지도가 구체적인 domain model을 제안함
- What is blocked or at risk: 어떤 Entity와 interaction이 실제 가치가 있는지 검증되지 않아 안정 구현 범위를 결정할 수 없음
- Cost of deciding now: pilot 설계와 수동 운영에 시간을 쓰며 즉각적인 demo가 늦어짐
- Cost of delaying: 문서와 코드가 서로 다른 제품 정의로 계속 확장되거나 잘못된 ontology가 고착됨
- What proceeds automatically if no decision is made: 문서 연구는 확장될 수 있으나 검증 데이터와 제품 루프는 생기지 않음

## 3. Purpose and criteria

- Related Purpose: 인간의 적극적이고 의미 있는 개입으로 일반 하네스보다 높은 품질과 더 나은 일의 경험을 만든다.
- Non-negotiable constraints: 인간 저자성 보존, 낮은 피벗 비용, 실제 작업 기반 검증, v0 사용자 자산 비파괴

| Criterion | Importance | Evidence quality | Notes |
|---|---|---|---|
| 가장 큰 제품 불확실성 감소 | critical | 현재 이론만 존재 | interaction value가 가장 큰 unknown |
| 실제 사용자 가치까지의 시간 | high | 조건별 추정 | demo 속도와 가치 검증을 구분 |
| 피벗 가능성 | high | architecture inference | schema 고정 비용 고려 |
| 현재 자산 활용 | medium | repository observation | v0 scaffold와 docs 보존 |
| 장기 아키텍처 기여 | medium | Foundations hypothesis | 조기 과설계 위험 포함 |

## 4. Options

| Option | Expected benefit | Cost / risk | Reversibility | System impact | Confidence basis |
|---|---|---|---|---|---|
| A. Paper/Wizard-of-Oz validation | 가장 큰 UX·가치 불확실성을 빠르게 검증 | facilitator 노동, 실제 자동화와 차이 | 매우 높음 | schema 결정 전 핵심 primitive 선별 | 높음: 현재 unknown과 직접 연결 |
| B. Read-only sidecar | 실제 run 데이터와 Return Brief를 자동 생성 | event vocabulary와 adapter 설계 필요 | 높음 | 기존 workflow 비파괴, architecture 학습 | 중간: paper 후 범위가 더 명확해질 수 있음 |
| C. Full domain kernel | 세 graph와 Event ledger를 실제 제품으로 구현 | 가장 큰 비용과 ontology 고착 위험 | 낮음 | 장기 코어를 빠르게 확보할 가능성 | 낮음–중간: interaction validation 없음 |
| D. v0 scaffold extension | 기존 npm 자산으로 가장 빠른 배포 | docs manager로 포지셔닝 고착 가능 | 중간 | 단기 사용자 획득 가능, 핵심 차별성 약화 | 중간: 구현은 명확하나 전략 적합성 불확실 |

## 5. Evidence and disagreement

### Strongest evidence

- 현재 저장소는 scaffold를 제공하지만 인간의 판단·가설·약속 상태를 실행 루프로 연결하지 않는다.
- Foundations의 10개 제품 가설 대부분은 UI보다 상호작용 행동을 먼저 검증해야 한다.
- Paper prototype은 코드 없이도 사용자가 어떤 필드를 실제로 조작하고 어떤 Gate가 결과를 바꾸는지 관찰할 수 있다.

### Strongest counterevidence

- paper artifact는 수동 작성 품질에 크게 의존하며 실제 다중 에이전트 속도와 상태량을 충분히 재현하지 못할 수 있다.
- sidecar를 먼저 만들면 실제 run event를 확보해 더 현실적인 Return Brief를 검증할 수 있다.

### Unresolved assumptions

- product owner가 첫 pilot에 직접 참여할 수 있음
- 수동 prototype이 최소한 3개 병렬 WorkUnit을 감당할 수 있음
- 결과 품질을 blind rubric 또는 재작업 지표로 평가할 수 있음

### Agent / stakeholder disagreement

- Paper-first 관점: 상호작용 가치가 가장 큰 위험이므로 코드보다 먼저 검증해야 한다.
- Sidecar-first 관점: 실제 event 없이 만든 화면은 이상화된 문서에 그칠 수 있다.
- Resolve by: 첫 paper session에서 수동 event capture 비용과 누락률을 측정하고, 임계치를 넘으면 B로 이동한다.

## 6. Recommendation

- Recommended option: **A를 먼저 수행하고, 성공 시 B로 이어지는 순차 전략**
- Why it best fits the criteria: 가장 큰 제품 위험을 낮은 비용으로 직접 검증하면서 sidecar가 수집해야 할 최소 Event vocabulary를 경험적으로 도출한다.
- Why the strongest alternative was not selected: B는 유망하지만 어떤 Event가 실제 사용자 판단에 필요한지 정하기 전에 adapter와 schema를 만들 위험이 있다.
- What new evidence would change the recommendation: 수동 artifact 생성이 session당 과도한 시간을 요구하거나 실제 상태 변화의 상당 부분을 일관되게 포착하지 못함
- Confidence basis: 이론과 architecture risk에 대한 중간 수준 확신. 사용자 행동 데이터는 없음.

## 7. User actions

- [x] A → B 순차 전략 선택
- [ ] B sidecar-first 선택
- [ ] C full-kernel 선택
- [ ] D scaffold extension 선택
- [ ] 평가 기준 수정
- [ ] 다른 ProblemFrame 제안
- [ ] 결정 전 추가 실험 요청
- [ ] 지정된 시점까지 연기

## 8. Commitment created by decision

- Selected option: A. Paper/Wizard-of-Oz validation을 실제 수행하고, 관찰 결과를 사용해 B. read-only sidecar의 최소 범위를 구현·검증한다.
- Decided by: product owner
- Decision evidence: 2026-08-16 요청 — “권장대로 실제 수행및 검증작업을 이어서 진행하고 결과를 분석해줘”
- Rationale: 가장 큰 interaction risk를 먼저 드러내되, 실제 Git event를 수집하는 얇은 sidecar로 수동 추출 한계도 함께 검증한다.
- Consequences accepted: founder dogfood는 시장 증거가 아니며, sidecar schema와 event vocabulary는 실험용이라 호환성을 보장하지 않는다.
- New/changed Commitments: `wu-helm-paper-pilot`을 실제 run으로 전환하고, 별도 `experiments/helm-sidecar`에서 입력 프로젝트를 변경하지 않는 collector를 구현한다.
- Baselines changed: product validation roadmap
- Communication / handoff obligations: 실행 로그, 측정값, 반증, 다음 Gate를 저장소에 남긴다.
- Review date or reopen trigger: 첫 pilot 결과 또는 수동 artifact 생성 비용 임계치 초과

## 9. Decision impact feedback

- What changed because of this decision: 문서 검토 단계에서 실제 founder dogfood와 thin sidecar 구현·검증 단계로 전환됐다.
- Expected vs observed result: 예상대로 material Event 수집은 저렴하고 비파괴적이었다. 반면 semantic state는 자동으로 생기지 않았고 file-level projection은 의미 압축에 실패했다. 상세 결과는 [`founder-dogfood-001`](../../runs/founder-dogfood-001/)에 기록했다.
- Was user intervention consequential?: `yes` — runtime 구현 보류 상태를 해제하되 안정 kernel이 아닌 read-only 실험으로 범위를 제한했다.
- What the system should learn about future Gates: 사용자가 짧은 자연어로 권고를 수락해도 선택, 범위, 비목표, 호환성 수준을 명시적인 Commitment로 전개하되, 사용자가 긴 form을 직접 편집하도록 요구하지 않는다.
