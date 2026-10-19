# Method Card: NASA Decision Analysis and Trade Studies

- Domain: systems engineering, aerospace program management
- Evidence status: official engineering process; Helm tailoring exploratory
- Primary Helm bundle: Deliberative Inquiry
- Candidate primitives: `Decision`, `Alternative`, `Criterion`, `TradeStudy`, `Baseline`

## 1. Original problem

복잡한 시스템 설계에서는 여러 대안이 성능, 비용, 일정, 안전, 인터페이스에서 서로 다른 trade-off를 가진다. 결정의 근거와 가정이 보존되지 않으면 이후 요구 변경과 통합 과정에서 왜 현재 설계를 선택했는지 알 수 없다.

NASA Systems Engineering은 의사결정을 임무와 시스템 맥락에서 정의하고, 대안·기준·평가 방법을 선택하며, 불확실성과 추가 정보의 가치를 고려하고, 결정 결과를 configuration baseline에 반영한다.

## 2. Environmental assumptions

- 시스템 수명과 변경 비용이 크다.
- 서로 다른 전문 영역의 기준이 충돌한다.
- 모든 대안을 완전하게 시험할 수 없다.
- 초기 결정이 많은 하위 설계에 파급된다.
- 결정 근거가 장기간 유지되어야 한다.

## 3. Domain-invariant mechanisms

### Decision framing in system context

선택 질문을 지역 편의가 아니라 상위 임무·목적과 연결한다.

### Explicit alternatives and criteria

대안과 평가 기준을 결정 전에 명시한다.

### Tailored evaluation

분석 깊이와 방법을 결정 복잡도·위험에 비례시킨다.

### Uncertainty and value of information

추가 조사로 줄일 수 있는 불확실성과 그 결정 가치를 비교한다.

### Baseline and rationale preservation

수락된 선택을 이후 실행 기준선으로 만들고 근거·가정·대체 관계를 보존한다.

## 4. Helm problem explained

에이전트는 architecture option을 제안하고 사용자는 chat에서 선택하지만, 선택 기준과 버린 대안이 남지 않아 이후 agent가 같은 결정을 다시 열거나 반대로 오래된 결정을 맹목적으로 따른다.

Decision이 단순 log entry가 아니라 Normative baseline transition이어야 하는 이유다.

## 5. Transfer to Helm

| Decision analysis mechanism | Helm primitive |
|---|---|
| Mission context | `Purpose` and affected Concerns |
| Alternatives | `Option`, including status quo |
| Criteria | weighted/ordered `Criterion` with owner |
| Evaluation | Evidence-linked comparison |
| Uncertainty | uncertainty type and information value |
| Selection | `Decision.committed` Event |
| Baseline | affected Decision/Constraint/Artifact graph |
| Reconsideration | reopen/supersede trigger |

## 6. Transfer rules

1. Decision question, why-now, owner를 분석 전에 정의한다.
2. 현상 유지와 추가 실험을 실제 Option으로 포함한다.
3. Criterion의 중요도뿐 아니라 누가 그 기준을 정당화하는지 기록한다.
4. 숫자 score가 가치 판단을 숨기지 않도록 원본 Evidence와 trade-off를 보여준다.
5. 결정 후 후속 Commitment와 변경 기준선을 자동 제안한다.
6. 분석 깊이는 stakes, reversibility, coupling에 맞춘다.
7. 핵심 Assumption 무효화 시 Decision을 재평가한다.

## 7. What must not be copied

- 모든 작은 구현 선택에 formal trade study 요구
- 서로 비교 불가능한 가치를 임의 숫자로 환산
- 최적 score를 인간 Decision과 동일시
- aerospace 수준 documentation burden을 초기 제품에 적용
- 과거 rationale 보존을 Decision 불변성으로 오해

## 8. Failure modes

- **Criteria laundering**: 선택 편향을 정당화하도록 기준을 사후 설정
- **False precision**: 불확실한 추정을 정밀 score로 표현
- **Baseline drift**: 결정은 바뀌었지만 하위 Contract와 Context가 갱신되지 않음
- **Decision amnesia**: 같은 trade-off를 반복 분석
- **Irreversible overprocess**: 가역적 선택까지 긴 승인 절차

## 9. Falsifiable Helm hypotheses

### DA-H1

Decision Gate가 대안·기준·가정·reopen trigger를 보존하면 동일 결정의 재분석과 기준선 drift가 감소할 것이다.

### DA-H2

reversibility에 맞춘 analysis depth는 고정 절차보다 같은 품질에서 결정 시간을 줄일 것이다.

### DA-H3

결정 후 영향을 받는 Commitment와 Context를 자동 표시하면 stale-context 오류가 감소할 것이다.

## 10. Prototype

- 실제 Helm next-step Gate를 unstructured choice와 structured Decision Gate로 비교한다.
- Criterion 변경 시 Recommendation이 어떻게 바뀌는지 사용자가 관찰한다.
- Decision을 commit한 뒤 영향 받는 Contract, docs, prototype을 찾게 한다.

## 11. Metrics

- decision time
- criteria modification rate
- repeat-analysis rate
- baseline propagation completeness
- stale dependent context
- reopen appropriateness
- user recall of rationale and trade-offs

## 12. Sources

- [NASA Systems Engineering Handbook](https://www.nasa.gov/reference/systems-engineering-handbook/)
- [NASA: Crosscutting Technical Management](https://www.nasa.gov/reference/6-0-crosscutting-technical-management/)
- [NASA: System Design Processes](https://www.nasa.gov/reference/4-0-system-design-processes/)

## 13. Open questions

- 자연어 Criterion을 비교 가능한 구조로 만들면서 가치의 맥락을 잃지 않으려면 어떻게 해야 하는가?
- agent Recommendation이 사용자의 Criterion을 역으로 편향하지 않게 할 UI 순서는 무엇인가?
- Decision baseline propagation을 어디까지 자동화하고 어디서 인간 확인을 요구할 것인가?

