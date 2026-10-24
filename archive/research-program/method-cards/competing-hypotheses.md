# Method Card: Analysis of Competing Hypotheses

- Domain: intelligence analysis, structured analytic techniques
- Evidence status: established analytic method; Helm transfer exploratory
- Primary Helm bundle: Deliberative Inquiry
- Candidate primitives: `HypothesisSet`, `EvidenceMatrix`, `Counterevidence`, `Dissent`

## 1. Original problem

정보분석은 불완전하고 모순된 자료, 기만 가능성, 시간 압력 아래에서 판단한다. 분석가는 이미 선호하는 설명을 지지하는 증거를 모으고 반대 증거를 무시하기 쉽다.

Analysis of Competing Hypotheses는 합리적인 가설들을 명시하고, 각 Evidence가 어느 가설과 일치하지 않는지 비교하며, 가장 증거가 많은 설명보다 중요한 불일치가 적은 설명을 검토하도록 돕는다.

## 2. Environmental assumptions

- 직접적이고 완전한 정보가 부족하다.
- 복수 가설이 같은 관찰을 설명할 수 있다.
- Evidence의 신뢰도와 진단적 가치가 다르다.
- 분석가에게 확증편향과 조기 수렴 위험이 있다.
- 판단 근거와 변경 이력을 사후 감사할 필요가 있다.

## 3. Domain-invariant mechanisms

### Explicit alternatives

암묵적 단일 모델 대신 최소한의 합리적 경쟁 가설을 표면화한다.

### Diagnostic evidence

모든 가설과 양립하는 Evidence보다 가설을 구분하거나 반박하는 Evidence를 중시한다.

### Inconsistency focus

지지 수를 세기보다 어느 가설이 중요한 Evidence와 충돌하는지 본다.

### Sensitivity and audit

핵심 Evidence의 신뢰도가 바뀌면 결론이 어떻게 변하는지 추적한다.

## 4. Helm problem explained

다중 에이전트는 서로 다른 답을 만들 수 있지만 최종 오케스트레이터가 하나의 매끄러운 결론으로 합치면 이견의 정보 가치가 사라진다. 또한 에이전트가 같은 문서와 모델을 사용하면 다수 의견은 독립 Evidence가 아니다.

## 5. Transfer to Helm

| ACH mechanism | Helm primitive |
|---|---|
| Reasonable hypotheses | `HypothesisSet` |
| Evidence rows | qualified `Evidence` |
| Consistency matrix | supports/challenges relations |
| Diagnosticity | discriminating power |
| Analyst disagreement | `Dissent` object |
| Sensitivity | Decision reopen trigger |
| Audit trail | immutable Event/provenance |

## 6. Transfer rules

1. 가설별 별도 보고서를 나열하지 않고 같은 Evidence 기준으로 비교한다.
2. Evidence의 수보다 독립성, 신뢰도, 진단적 가치를 평가한다.
3. 결론에 불리한 Evidence를 Decision Gate에 우선 노출한다.
4. 다수 agent agreement와 Evidence agreement를 분리한다.
5. 시간 예산에 따라 light matrix와 deep analysis를 구분한다.
6. 분석 결과를 Decision으로 자동 승격하지 않고 권한 있는 Actor의 Commitment를 요구한다.

## 7. What must not be copied

- 모든 제품 선택을 정보기관 수준 분석으로 무겁게 만들기
- matrix score를 객관적 확률로 해석하기
- 가설 목록이 완전하다고 가정하기
- Evidence 평가자의 공통 편향을 무시하기
- 수치 불일치가 적다는 이유만으로 가장 가치 있는 옵션을 선택하기

## 8. Failure modes

- **Matrix theater**: 형식은 채웠지만 Evidence 평가가 피상적
- **Missing hypothesis**: 실제 설명이 후보 집합 밖에 있음
- **Correlated evidence**: 같은 원천을 여러 행으로 중복 계산
- **Consensus laundering**: agent 합의를 객관적 지지로 표현
- **Analysis paralysis**: 낮은 위험 결정에도 깊은 ACH 수행

## 9. Falsifiable Helm hypotheses

### ACH-H1

Evidence–Hypothesis matrix는 독립 agent summary 투표보다 중요한 Counterevidence 발견률을 높일 것이다.

### ACH-H2

가설별 inconsistency를 우선 검토하면 단순 support count보다 잘못된 원인 선택을 줄일 것이다.

### ACH-H3

light/deep analysis를 위험에 따라 선택하면 품질 개선을 유지하면서 attention cost를 줄일 것이다.

## 10. Prototype

- 동일한 조사 결과를 agent-vote view와 ACH-lite matrix로 제시한다.
- 사용자에게 최종 가설과 추가 실험을 선택하게 한다.
- 핵심 Evidence 하나의 reliability를 변경하고 Decision이 적절히 다시 열리는지 본다.

## 11. Metrics

- counterevidence surfaced
- diagnostic evidence ratio
- correlated evidence detected
- wrong-hypothesis selection
- sensitivity to evidence invalidation
- analysis time
- user comprehension of disagreement

## 12. Sources

- [CIA: Psychology of Intelligence Analysis](https://www.cia.gov/resources/csi/static/Pyschology-of-Intelligence-Analysis.pdf)
- [CIA: A Tradecraft Primer](https://www.cia.gov/resources/csi/books-monographs/a-tradecraft-primer/)

## 13. Open questions

- LLM이 자동으로 consistency를 평가할 때 그 판단을 별도 Evidence로 검증해야 하는가?
- 가설·Evidence matrix가 사용자의 탐구 감각을 높이는지 스프레드시트 노동으로 느껴지는지 어떻게 측정할 것인가?
- high-risk threshold를 어떤 WorkUnit metadata에서 계산할 것인가?

