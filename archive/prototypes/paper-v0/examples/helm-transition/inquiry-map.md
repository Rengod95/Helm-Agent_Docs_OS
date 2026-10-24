# Inquiry Map — Helm의 첫 제품 검증 단위는 무엇이어야 하는가

## Metadata

- Inquiry ID: `inq-helm-transition-001`
- Concern: `helm-product-transition`
- Purpose: 사용자 개입이 결과 품질과 일하는 경험을 함께 높이는 제품 메커니즘을 검증
- Inquiry owner: product owner; research facilitation by Codex
- Opened at: 2026-08-16
- Current phase: `evaluating founder-dogfood-001`
- Decision deadline / stop rule: 안정 domain schema 또는 runtime 구현 착수 전

## 1. Situation

### Observations

| Observation | Source | Scope / freshness | Reliability note |
|---|---|---|---|
| 현재 제품은 npm initializer와 Markdown/YAML scaffold를 제공한다 | repository code and README | current workspace | 직접 관찰 |
| 기존 architecture는 State–References–Features–Decisions를 파일 계층으로 모델링한다 | [`fundamentals.md`](../../../../architecture/fundamentals.md) | current v0 | 직접 관찰 |
| 사용자의 핵심 문제는 다중·장기 에이전트 작업을 인간이 인지적으로 따라가기 어렵다는 것 | product owner problem statement | initial research context | 단일 창업자 경험, 외부 사용자 검증 전 |
| 사용자는 인간 개입을 제거하기보다 결과 품질과 일의 경험을 높이는 개입을 원한다 | product owner goal | current | 명시적 가치 진술 |
| Foundations와 35개 방법론 전이 지도가 작성됐다 | repository docs | current | 직접 관찰 |
| Return Brief·Inquiry Map·Contract·Gate가 실제 사용자 성과를 높인다는 관찰 데이터는 없다 | experiment state | current | 직접 관찰 |
| product owner가 권고된 A → B 순서의 실제 수행·검증을 요청했다 | product owner decision | 2026-08-16 | 명시적 자연어 결정 |
| Git-only capture는 56개 material change를 포착했지만 Normative·Epistemic·Next-state를 모두 unknown으로 남겼다 | [`founder-dogfood-001`](../../runs/founder-dogfood-001/) | first verified capture | 자동 검사와 실제 worktree 관찰 |
| 7개 human semantic input으로 네 domain을 채웠으나 자동 Brief는 56개 파일 행을 그대로 노출했다 | [`founder-dogfood-001`](../../runs/founder-dogfood-001/) | first verified capture | 같은 snapshot 조건 비교 |

### Tension

- 현재 상태: 풍부한 이론과 파일 스캐폴드는 있지만 검증된 상호작용과 제품 루프는 없다.
- 원하는 상태: 실제 다중 에이전트 작업에서 상황 인식·판단·통합 품질을 개선하는 최소 제품 루프가 있다.
- 두 상태 사이의 긴장: 구현을 시작하려면 schema가 필요하지만 사용자 상호작용을 검증하기 전에 schema를 고정하면 잘못된 ontology를 제품에 굳힐 수 있다.
- 해결할 가치가 있는 이유: 이 선택이 이후 OSS kernel과 SaaS 아키텍처의 중심을 결정한다.

## 2. Competing problem frames

| Frame | What it treats as the problem | What it foregrounds | What it hides | Owner / advocate |
|---|---|---|---|---|
| F1 Docs/Context Management | 에이전트가 필요한 문서를 일관되게 읽지 못함 | 설치 용이성, 문서 라우팅, 컨텍스트 지속성 | 인간의 판단·병렬 작업·증거 비교 | current v0 architecture |
| F2 Agent Observability | 여러 에이전트 run의 상태와 로그를 한눈에 보기 어려움 | run tracking, timeline, dashboard | 무엇을 결정해야 하는지와 결과 정당성 | common market framing |
| F3 Steered Co-agency | 인간–에이전트 공동 시스템이 목적·지식·약속을 정렬하지 못함 | inquiry, authority, evidence, meaningful intervention, integration | 초기 구현 단순성과 즉각적 demo | Helm Foundations |

### Active frame

- Current frame: F3 Steered Co-agency
- Why provisionally selected: 세 사용자 페인포인트를 하나의 원인 구조로 설명하고 v0의 문서 자산을 하위 호환 계층으로 보존할 수 있다.
- Reframe trigger: Helm prototype이 일반 chat summary/Kanban보다 상황 인식·품질·경험을 개선하지 못함

## 3. Hypothesis set

| Hypothesis | Explanation / prediction | Supporting evidence | Counterevidence | Falsifier | Status |
|---|---|---|---|---|---|
| H1 Paper-first | 네 primitive를 수동 운영하면 구현 전에도 핵심 가치와 불필요한 필드를 식별할 수 있다 | Wizard-of-Oz의 낮은 피벗 비용; Gate가 실제 범위를 바꾸고 form 과밀을 노출 | facilitator 노동과 편향; 복귀·품질·agency 효과 미측정 | 사용자가 네 구조를 이해하지 못하거나 방향·품질이 변하지 않음 | partially supported |
| H2 Kernel-first | Event ledger와 세 graph를 먼저 구현해야 실제 가치를 검증할 수 있다 | 장기·병렬 상태는 수동 문서로 재현하기 어려움 | stable kernel 없이 핵심 blind spot과 capture 경계를 시험함 | paper prototype만으로 핵심 판단과 복귀 효과가 충분히 관찰됨 | weakened for current step |
| H3 Scaffold-first | 기존 docs initializer를 확장하는 것이 가장 빠른 시장 진입로다 | 이미 구현·배포 가능한 자산, 낮은 도입 마찰 | 제품 차별성이 context template에 머물 수 있음 | 사용자가 docs 구조보다 상호작용 primitive에 더 큰 가치를 둠 | weakened |
| H4 Sidecar-first | 기존 agent workflow에 read-only event collector와 projections를 붙이면 실행 위험 없이 실제 데이터를 얻는다 | 56개 material change와 provenance를 worktree 변경 없이 포착 | semantic state와 의미 압축은 human context 없이는 실패 | manual pilot 후 최소 event vocabulary가 수렴함 | supported narrowly |

## 4. Assumptions and unknowns

| Assumption / unknown | Why needed | Failure impact | How to test | Review trigger |
|---|---|---|---|---|
| 사용자가 구조화된 판단을 위해 일부 시간을 지불할 의향이 있음 | 적극적 개입 제품의 전제 | 제품 핵심 가치 붕괴 | longitudinal dogfood + interview | 높은 피로/낮은 자발적 재사용 |
| 네 primitive가 핵심 경험을 충분히 대표함 | prototype 범위 제한 | 중요한 상호작용 누락 | critical incident 관찰 | 반복적으로 다른 도구/화면 필요 |
| facilitator가 조건 간 편향을 통제할 수 있음 | Wizard-of-Oz 신뢰성 | Helm 조건만 과도하게 도움 | counterbalanced script, source audit | 결과가 facilitator별로 크게 변함 |
| 결과 품질을 단일 자동 테스트 이상으로 평가 가능 | 핵심 가설 측정 | 품질 주장 불가능 | blind rubric + rework/integration defects | 평가자 합의가 낮음 |

## 5. Discriminating experiments

| Experiment | Distinguishes | Expected information value | Cost | Reversibility | Owner |
|---|---|---:|---:|---|---|
| 같은 작업을 chat/docs/Helm 조건으로 재개하고 상황 퀴즈 수행 | H1 vs H3 | 높음 | 중간 | 높음 | research facilitator |
| Helm 프로젝트의 실제 다음 결정을 Decision Gate로 수행 | H1 vs UI theater | 높음 | 낮음 | 높음 | product owner |
| 수동 Event capture 후 ContextProjection 생성 | H2 vs H4 | 중간 | 중간 | 높음 | prototype engineer |
| 3개 병렬 WorkUnit의 의미 충돌을 파일 충돌 전 탐지 | F2 vs F3 | 높음 | 중간 | 높음 | research facilitator |

## 6. Evidence ledger

| Evidence | Type | Supports | Challenges | Independence | Quality | Source |
|---|---|---|---|---|---|---|
| 현재 v0 데이터 구조 분석 | observation | H3의 구현 가능성, F1 존재 | F1의 충분성 | 직접 저장소 관찰 | high | repository |
| Mission Command/ICS/ACH/Coactive Design 등 반복 원리 | literature synthesis | F3, H1/H4 | 단일 분야 직접 적용 | 서로 다른 분야지만 이론 전이 | medium | [`method-transfer-map.md`](../../../../research/method-transfer-map.md) |
| 사용자 자신의 프로젝트 경험 | qualitative observation | F3의 문제 적합성 | 시장 일반화 | 단일 출처 | high for founder, low for market | product statement |
| 외부 사용자 실험 | missing | — | 모든 제품 가설 | — | none | not yet collected |
| Founder Gate가 A → B 실행으로 전환 | behavioral trace | H1, consequential intervention | Gate 일반 효과 | 단일 결정 | medium | [`decision-gate.md`](decision-gate.md) |
| Git-only vs enriched capture | controlled local observation | H4, explicit semantic capture | 완전 자동 semantic inference | 동일 worktree, 자동 report | medium | [`founder-dogfood-001`](../../runs/founder-dogfood-001/) |

## 7. Current synthesis

- Best-supported explanation: Material Event 수집은 저렴하지만 Helm의 핵심 가치는 결정·믿음·약속을 명시적으로 포착하고 raw change를 의미 단위로 압축하는 데 있다.
- Strongest alternative: 더 많은 paper run으로 interaction vocabulary를 다듬은 뒤 adapter를 구현한다.
- Most important counterevidence: 현재 sidecar는 56개 file Event를 56개 행으로 노출해 사용자의 인지 부하를 줄이지 못했고, 완전한 resumption loop도 경험하지 않았다.
- What remains unknowable within current evidence: 장기 자발적 사용, 팀 협업 가치, 지불 의사.
- What would change the recommendation: 수동 작성 비용이 너무 높아 facilitator가 일관된 artifact를 만들 수 없거나 사용자가 이를 읽지 않는 경우.
- Is the original frame still useful?: F3는 유지하되 paper pilot에서 F2 observability 문제와 분리 측정해야 한다.

## 8. Next epistemic action

- Action: `experiment`
- 구체적 행동: 대화 경계에서 Decision·Commitment·Belief Update를 기록하는 thin adapter와 material grouping projection을 만들고, 지연 복귀를 chat/docs baseline과 비교
- Why: 첫 run이 드러낸 두 병목인 semantic input과 cognitive compression을 직접 검증
- Stop condition: 세 번의 resumption에서 critical state miss가 발생하거나 raw log fallback·semantic correction·workload가 baseline보다 개선되지 않으면 stable schema 구현을 계속 보류하고 frame을 재검토
