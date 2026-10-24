# Founder Dogfood 001 — Paper Gate에서 Read-only Sidecar까지

> Run status: `completed / awaiting product-owner outcome acceptance`  
> Concern: `helm-product-transition`  
> Started: 2026-08-16T14:39:36+09:00  
> First verified capture: 2026-08-16T14:43:20+09:00

## 1. 결론

이번 run은 Helm의 방향을 지지하면서도 현재 paper-v0 형태를 그대로 제품화하면 안 된다는 반증을 만들었다.

- 사용자의 짧은 자연어 개입은 실제 실행 범위를 `문서 연구`에서 `paper 검증 + read-only sidecar`로 바꿨다. Decision Gate는 이 run에서 consequential했다.
- Git-only sidecar는 56개 material change를 57개 Event로 0.09초에 포착했고 입력 worktree 상태를 바꾸지 않았다.
- 그러나 Git-only 출력은 Normative, Epistemic, Next-state를 모두 `unknown`으로 남겼다. 파일 diff로 목적·결정·믿음·수락을 추론해서는 안 된다는 원론이 실제 출력에서 확인됐다.
- 7개의 human-authored semantic input을 추가한 조건은 네 domain을 모두 채우고 64개 Event를 만들었다. 필요한 자동화 대상은 인간 판단의 제거가 아니라 판단 순간의 저비용 typed capture다.
- 자동 Brief는 56개 파일을 56행으로 나열한 반면 수동 Brief는 material change를 3개 의미 그룹으로 압축했다. Collector만으로는 사용자의 인지 부하 문제를 해결하지 못한다.
- paper-v0의 네 template에는 약 197개의 heading/field prompt가 있고 filled artifacts는 합계 4,319단어다. 실제 사용자는 form을 직접 편집하지 않고 한 문장의 자연어로 결정했다. 이 run은 “풍부한 form UI”보다 “대화에서 의미 Event를 포착하고 필요한 projection만 생성”하는 방향을 지지한다.

따라서 stable kernel 또는 SaaS dashboard로의 승격 기준은 충족되지 않았다. `experiments/helm-sidecar`는 폐기 가능한 실험으로 유지하고, 다음 검증은 Decision·Commitment·Belief Update를 대화 경계에서 포착하는 얇은 adapter와 지연 복귀 시험이어야 한다.

## 2. 실제 수행 범위

### Step A — Paper/Wizard-of-Oz

1. product owner의 요청을 [`Decision Gate`](../../examples/helm-transition/decision-gate.md)의 A → B 선택으로 기록했다.
2. 선택을 [`Delegation Contract`](../../examples/helm-transition/delegation-contract.md)의 권한·범위·비목표로 전개했다.
3. 기존 `packages/agent-docs-init`는 보호 baseline으로 유지했다.
4. 안정 schema가 아닌 별도 experiment만 허용했다.

### Step B — Read-only sidecar

1. dependency-free Node.js collector를 [`experiments/helm-sidecar`](../../../../../experiments/helm-sidecar/README.md)에 구현했다.
2. 같은 worktree를 Git-only 조건과 [`sidecar-context.json`](sidecar-context.json) 보강 조건으로 각각 capture했다.
3. 각 capture 전후 `git status --porcelain=v1 -z`의 SHA-256을 비교했다.
4. parser, 비파괴 capture, semantic unknown 보존, enriched projection, output 경계에 자동 검사를 수행했다.

## 3. 측정 결과

| Metric | Git-only | + human context | 해석 |
|---|---:|---:|---|
| Runtime | 0.09s | 0.09s | 수집 자체는 병목이 아님 |
| Material changes | 56 | 56 | 같은 worktree snapshot |
| Total Events | 57 | 64 | semantic input 7개가 Event 7개를 추가 |
| Material coverage | observed | observed | Git으로 직접 검증 가능 |
| Normative coverage | unknown | human-provided | 결정 1 + Commitment 2 |
| Epistemic coverage | unknown | human-provided | 믿음 변화 1 |
| Next-state coverage | unknown | human-provided | 다음 행동 3 |
| Unknown semantic domains | 3 / 4 | 0 / 4 | 완성도 차이는 인간 입력에서 발생 |
| Generated Brief words | 543 | 629 | enriched context의 추가 비용은 86단어 |
| Generated material rows | 56 | 56 | 의미 압축은 일어나지 않음 |

### Non-mutation check

- Before capture worktree digest: `0b44b07b222afcbb0c96a5a391c0a64f711ece1e0e8c6e95b658a040e202a486`
- After both captures: `0b44b07b222afcbb0c96a5a391c0a64f711ece1e0e8c6e95b658a040e202a486`
- Result: 동일. CLI는 output이 input project 내부이면 거부하도록 별도 검사도 추가했다.

### Automated verification

```text
tests 5
pass 5
fail 0
duration 195.698875ms
```

검증 대상은 porcelain status parsing, 실제 임시 Git 저장소의 전후 상태 동일성, semantic unknown 보존, human context projection, input 내부 output 거부다.

## 4. Paper interaction 관찰

| Protocol criterion | Observation | Assessment |
|---|---|---|
| Return Brief가 원본 로그 없이 상황 복원 | 지연 복귀와 사용자 probe를 아직 수행하지 않음 | not tested |
| 사용자가 Inquiry Map 관계를 수정 | 직접 form 편집은 관찰되지 않음 | not observed |
| Gate가 기준·선택·Commitment를 변경 | A → B 선택으로 runtime 보류가 thin experiment 허용으로 바뀜 | supported in this run |
| Contract가 drift/완료 혼동 예방 | initializer 비변경, 별도 experiment, output 경계를 구현에 유지 | process trace supported; causal effect unproven |
| 부담 증가가 품질·agency로 정당화 | 주관 평가와 비교 baseline 없음 | not tested |

paper-v0의 “다섯 조건 동시 관찰” 기준은 충족되지 않았다. 특히 Return Brief 복귀 효과, 자발적 재사용, workload, ownership은 사용자 측 측정 없이는 주장할 수 없다.

## 5. 가설 판정

| Hypothesis | Result | Evidence | 남은 반증 가능성 |
|---|---|---|---|
| H1 Paper-first가 불필요한 schema를 찾는다 | partially supported | Gate가 scope를 제한했고 form 밀도와 natural-language path 차이를 드러냄 | 실제 복귀·품질 효과 미측정 |
| H2 Kernel-first가 필수다 | weakened for current step | stable kernel 없이 material capture와 semantic blind spot 검증 가능 | 장기·병렬 run에서는 kernel이 필요할 수 있음 |
| H3 Scaffold-first가 최선이다 | unchanged / weak | initializer를 건드리지 않고 핵심 가설을 더 직접 시험함 | OSS 배포·획득 경로의 가치는 미검증 |
| H4 Read-only sidecar가 실제 Event를 준다 | supported narrowly | 56개 변경과 provenance를 비파괴 포착 | semantic capture와 압축 없이 사용자 가치는 부족 |
| Git에서 semantic state를 추론할 수 있다 | contradicted by design and output | 3개 domain이 명시적으로 unknown | 다른 agent adapter source는 더 많은 의미를 제공할 수 있음 |

## 6. 가장 중요한 제품 학습

### 6.1 Helm의 core는 dashboard가 아니라 semantic write path다

Git, agent logs, CI는 Material Event를 풍부하게 제공한다. 희소한 것은 사용자가 언제 기준을 바꿨는지, 어떤 주장을 믿게 됐는지, 누가 무엇을 약속했고 누가 수락했는지다. Helm의 다음 wedge는 모든 것을 보는 화면보다 이 네 종류의 순간을 대화 흐름에서 낮은 비용으로 기록하는 adapter다.

### 6.2 Event ledger만으로는 인지 문제를 해결하지 못한다

56개 파일 Event를 충실히 나열한 projection은 정확하지만 좋지 않은 Return Brief다. 다음 compiler는 path 나열이 아니라 Concern, WorkUnit, Decision 영향 기준으로 grouping하고, source로 drill-down할 수 있어야 한다.

### 6.3 네 primitive는 storage entity보다 projection이어야 한다

이번 사용자는 4,319단어의 filled artifacts를 직접 편집하는 대신 짧은 자연어로 consequential decision을 만들었다. 따라서 Gate, Contract, Inquiry Map, Return Brief를 각각 거대한 form으로 저장하기보다 소수 typed Event에서 역할별 projection으로 생성하는 편이 현재 증거와 맞는다.

### 6.4 사용자 개입의 의미는 빈도가 아니라 상태 전이로 측정해야 한다

이번 개입은 한 번이었지만 구현 권한과 roadmap을 바꿨다. 클릭 수나 메시지 수보다 `decision_changed_outcome`, 새 Commitment, 취소된 작업, 피한 비가역 비용을 기록해야 한다.

## 7. 제품 결정

### 지금 진행해도 되는 것

- 실험용 read-only collector 유지
- user/agent interaction에서 Decision, Commitment, Belief Update를 명시적으로 기록하는 adapter 실험
- file Event를 Concern/WorkUnit 단위로 압축하는 projection 실험
- 24시간 또는 distractor 이후 Return Brief 복귀 측정

### 아직 진행하면 안 되는 것

- 안정 Event schema와 public API 선언
- multi-tenant SaaS backend와 dashboard 구현
- 자동 의미 분류를 사실로 저장
- founder run을 시장 수요·지불 의사 증거로 일반화
- 네 paper artifact를 그대로 제품 navigation과 form으로 고정

## 8. 다음 Gate

질문: 다음 한 단위 투자를 어디에 둘 것인가?

| Option | Information gain | Risk | Recommendation |
|---|---|---|---|
| A. Semantic capture adapter + delayed resumption | 의미 Event의 입력 비용과 Return Brief 복귀 효과를 함께 검증 | adapter별 integration 필요 | **recommended** |
| B. Paper run 2–3회 반복 | interaction 용어와 workload 보정 | 실제 event source 현실성이 낮음 | A와 함께 얇게 수행 |
| C. Stable kernel/API | 장기 구조를 실제화 | 현재 evidence보다 ontology commitment가 큼 | defer |
| D. SaaS dashboard | demo와 배포 학습 | 핵심 가치 미검증 상태에서 UI 고착 | defer |

### A의 advance criterion

- 세 번의 실제 resumption에서 raw log fallback 없이 핵심 Purpose·Decision·Risk·Next action을 복원
- 위험 가중 critical state miss `0`
- semantic event correction이 run당 `2`개 이하
- raw file Event를 5개 이하의 meaningful change group으로 압축하면서 provenance 보존
- product owner가 Gate/Brief 중 적어도 하나를 다시 사용하고 주관적 agency·workload를 보고

## 9. 재현

```bash
/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test

/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  experiments/helm-sidecar/bin/helm-sidecar.mjs capture \
  /Users/user/Documents/projects/06_agent_docs_os \
  --out /private/tmp/helm-sidecar-capture \
  --context docs/prototypes/paper-v0/runs/founder-dogfood-001/sidecar-context.json
```

첫 run의 raw output은 `/private/tmp/helm-founder-001.XHsSfy/`에 생성했으며 제품 저장소에는 측정값과 재현 절차만 보존한다. capture 당시 HEAD는 `77cfe3d921730a8736ddba0b192b33f9faf57a8f`다.

## 10. 한계

- 단일 founder, 단일 Concern, 동일 agent가 facilitator·구현자·분석자 역할을 수행했다.
- 24시간 지연 복귀, chat/docs baseline, blind outcome rating을 수행하지 않았다.
- 사용자가 artifact를 실제로 읽은 시간, NASA-TLX, agency, enjoyment 데이터가 없다.
- dirty worktree의 untracked file은 diff content가 아니라 path/status만 관찰했다.
- 0.09초 runtime은 이 저장소·기기에서의 단일 관찰이며 성능 benchmark가 아니다.
- human context는 Wizard-of-Oz로 작성했으므로 자동 semantic extraction 정확도를 보여주지 않는다.
