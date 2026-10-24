# Method Card: Structured Handoff and SBAR

- Domain: healthcare teamwork and patient safety
- Evidence status: operational communication framework established; Helm transfer exploratory
- Primary Helm bundle: Situation Recovery
- Candidate primitives: `ReturnBrief`, `Handoff`, `CheckBack`, `ResponsibilityTransfer`

## 1. Original problem

의료 인수인계에서는 환자에 대한 자료가 존재해도 현재 위험, 임상적 해석, 다음 요청, 책임이 명확히 전달되지 않으면 오류가 발생한다. 특히 근무 교대나 부서 이동은 정보와 책임의 연속성이 끊어지는 위험한 경계다.

SBAR는 Situation, Background, Assessment, Recommendation/Request로 중요한 정보를 구조화한다. TeamSTEPPS는 handoff, check-back, closed-loop communication, brief, huddle, debrief 같은 보완 도구를 함께 제공한다.

## 2. Environmental assumptions

- 보내는 사람과 받는 사람의 맥락과 전문성이 다를 수 있다.
- 모든 정보를 전달할 시간은 없지만 중요한 누락의 비용이 크다.
- 정보뿐 아니라 책임이 이동한다.
- 수신자가 질문하고 이해를 확인할 수 있어야 한다.
- 현재 상태와 해석, 요청이 분리되어야 한다.

## 3. Domain-invariant mechanisms

### Structured compression

정보량을 줄이되 현재 상황, 관련 배경, 해석, 필요한 행동을 보존한다.

### Responsibility transfer

handoff는 보고서 전달이 아니라 누가 다음 행동을 책임지는지 바꾸는 사건이다.

### Closed-loop confirmation

수신자가 이해한 내용을 확인하고 오해를 바로잡는다.

### Contingency communication

정상 다음 단계뿐 아니라 악화·예외 시 무엇을 해야 하는지 포함한다.

## 4. Helm problem explained

세션 checkpoint가 “한 일, 남은 일, 다음 단계”만 포함하면 사용자는 다음을 잃을 수 있다.

- 왜 현재 상태가 중요한가
- 보고자의 평가와 확신 근거
- 가장 위험한 미해결 문제
- 누가 다음 행동을 맡는가
- 어떤 조건에서 계획을 바꿔야 하는가

## 5. Transfer to Helm

| Handoff mechanism | Helm implementation |
|---|---|
| Situation | current Purpose, status, urgent Gate |
| Background | relevant Decision, Assumption, prior Outcome |
| Assessment | meaning, risk, hypothesis change |
| Recommendation/Request | next consequential action and owner |
| Check-back | user correction/acknowledgment Event |
| Contingency | escalation and reopen trigger |

## 6. Transfer rules

1. Return Brief는 상태와 평가를 명시적으로 분리한다.
2. 수신자가 수정하거나 반박할 수 있는 check-back 단계가 있어야 한다.
3. handoff가 누구의 Commitment와 Authority를 변경하는지 기록한다.
4. Background는 전체 역사 대신 현재 판단에 영향을 주는 항목만 포함한다.
5. Recommendation은 단순 next task가 아니라 왜 지금 필요한지와 대안을 포함한다.
6. 수신자가 없는 checkpoint는 책임 이전이 아니라 snapshot으로 분류한다.

## 7. What must not be copied

- 모든 작업 보고를 SBAR 네 칸에 억지로 맞추기
- 임상적 긴급성을 일반 제품 개발에 그대로 적용하기
- 형식이 채워졌다는 사실을 이해 확인으로 대체하기
- 송신자 관점의 평가를 객관적 사실처럼 표현하기

## 8. Failure modes

- **Data dump handoff**: 원본 링크만 전달하고 의미를 재구성하지 않음
- **Ownership ambiguity**: next step은 있지만 책임 주체와 권한이 없음
- **One-way handoff**: 수신자가 질문·수정할 기회가 없음
- **Assessment masking**: 추론을 사실처럼 전달
- **Missing contingency**: 정상 경로만 있고 예외 처리 없음

## 9. Falsifiable Helm hypotheses

### HO-H1

Situation–Change–Assessment–Projection–Recommendation 구조는 done/open/next checkpoint보다 위험과 다음 행동 회상 정확도를 높일 것이다.

### HO-H2

check-back을 포함한 Return Brief는 일방향 요약보다 잘못된 상황 모델을 더 빨리 발견할 것이다.

### HO-H3

responsibility transfer를 명시하면 handoff 이후 unowned obligation이 감소할 것이다.

## 10. Prototype

- 같은 agent session을 현재 checkpoint template과 Return Brief template으로 작성한다.
- 다른 사용자가 다음 날 두 조건 중 하나로 작업을 이어간다.
- 이해한 Purpose, risk, next action, owner를 말하게 한다.
- 첫 행동 전 check-back이 발견한 오류를 기록한다.

## 11. Metrics

- handoff preparation time
- receiver orientation time
- ownership accuracy
- missed risk and obligation
- check-back correction count
- wrong-next-action rate
- raw-history consultation rate

## 12. Sources

- [AHRQ: SBAR](https://www.ahrq.gov/teamstepps-program/curriculum/communication/tools/sbar.html)
- [AHRQ: TeamSTEPPS Tools](https://www.ahrq.gov/teamstepps-program/resources/modules/index.html)
- [AHRQ PSNet: Handoffs](https://psnet.ahrq.gov/primer/handoffs)

## 13. Open questions

- 비동기 agent handoff에서 closed-loop confirmation을 언제 강제해야 하는가?
- Return Brief의 생성자가 agent일 때 Assessment 편향을 어떻게 드러낼 것인가?
- 책임 이전과 단순 정보 공유를 UI에서 어떻게 구분할 것인가?

