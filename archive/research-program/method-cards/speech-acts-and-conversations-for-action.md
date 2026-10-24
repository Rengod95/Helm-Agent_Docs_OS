# Method Card: Speech Acts and Conversations for Action

- Domain: philosophy of language, organizational coordination, cooperative work
- Evidence status: foundational theory and historical system design; Helm transfer exploratory
- Primary Helm bundle: Delegated Joint Action
- Candidate primitives: `Request`, `Offer`, `Commitment`, `ClaimingComplete`, `Acceptance`, `ConversationState`

## 1. Original problem

조직의 언어를 정보 전달로만 보면 요청, 약속, 수락, 거부처럼 말 자체가 관계와 의무를 바꾸는 행위를 설명하기 어렵다. Speech Act Theory는 발화가 사실을 기술할 뿐 아니라 약속, 경고, 명령, 선언 같은 행위를 수행한다고 본다.

Winograd와 Flores의 Language/Action 접근은 공동 작업을 요청–약속–수행–완료 주장–수락이 이어지는 conversation for action으로 모델링했다. 핵심은 문장 내용보다 참여자 사이의 Commitment 상태 변화다.

## 2. Environmental assumptions

- 복수 행위자가 언어로 행동을 조정한다.
- 요청과 약속은 동일하지 않다.
- 누가 어떤 발화를 수행할 권한이 있는지가 중요하다.
- 완료 선언과 수락은 서로 다른 행위다.
- 오해, 반대 제안, 철회, 위반, 재협상이 정상적으로 발생한다.

## 3. Domain-invariant mechanisms

### Performative state transition

일부 발화는 정보를 추가하는 것이 아니라 권리, 책임, 기대를 변경한다.

### Commitment lifecycle

요청은 수락·거부·반대 제안을 거쳐 Commitment가 되고, 수행 결과가 주장된 뒤 수혜자가 만족 여부를 판단한다.

### Conditions of satisfaction

약속의 이행 여부는 미래에 관찰 가능한 조건과 연결된다.

### Repair and renegotiation

환경 변화와 오해에 따라 약속을 수정·이관·철회할 수 있다.

## 4. Helm problem explained

일반 agent chat에서는 “해줘”, “진행하겠습니다”, “완료했습니다”, “좋아”가 기록되지만 각각이 실제로 어떤 상태를 바꿨는지 불명확하다. 프롬프트는 요청일 수 있고, 에이전트의 응답은 단순 이해 보고일 수 있으며, 사용자의 침묵은 수락이 아니다.

## 5. Transfer to Helm

| Language/action concept | Helm primitive |
|---|---|
| Request | proposed WorkUnit |
| Offer/counteroffer | proposed DelegationContract change |
| Promise/commitment | accepted Commitment |
| Assert satisfaction | `ClaimingComplete` |
| Declare acceptance | `Accepted` |
| Renege/breach | `CommitmentBreached` Event |
| Withdraw/release | explicit cancellation/release |
| Conversation history | immutable state-transition Events |

## 6. Transfer rules

1. 자연어 message와 그것이 제안하는 상태 전이를 분리한다.
2. 사용자에게 모든 발화를 분류시키지 않고 시스템이 초안을 만들되 규범적 효과를 명시한다.
3. Request를 Commitment로 자동 해석하지 않는다.
4. 완료 주장과 수락, 수락과 통합을 분리한다.
5. Conditions of satisfaction가 없는 약속은 협상 상태로 남긴다.
6. 침묵을 고위험 약속의 수락으로 해석하지 않는다.
7. 재협상은 실패 은폐가 아니라 정상 상태 전이로 지원한다.

## 7. What must not be copied

- 자연어 대화를 rigid workflow form으로 대체
- 모든 메시지를 하나의 speech-act label로 강제 분류
- 에이전트의 운영적 Commitment를 인간의 도덕적 약속과 동일시
- 맥락과 권한을 무시한 형식적 발화만으로 상태 변경

## 8. Failure modes

- **Request–commitment collapse**: 에이전트가 이해하지 못한 요청을 바로 실행
- **Completion declaration bias**: 보고자의 완료 주장을 검증 없이 수락
- **Silent acceptance**: 사용자 무응답을 승인으로 처리
- **Workflow rigidity**: 예외와 재협상이 비정상 오류로 취급
- **Performative ambiguity**: 같은 “좋아”가 이해, 선호, 승인 중 무엇인지 불명확

## 9. Falsifiable Helm hypotheses

### SA-CFA-H1

Request–Commitment–Claim–Acceptance 상태를 분리하면 일반 chat보다 scope misunderstanding과 false completion이 감소할 것이다.

### SA-CFA-H2

Conditions of satisfaction를 협상하게 하면 late acceptance rejection이 감소할 것이다.

### SA-CFA-H3

명시적 renegotiation path는 rigid task state보다 blocker 은폐와 무단 scope change를 줄일 것이다.

## 10. Prototype

- 동일한 자연어 위임을 chat-only와 Conversation State view로 수행한다.
- 요청 후 수행자가 이해한 조건을 counteroffer할 수 있게 한다.
- 부분 완료와 환경 변경을 주입해 재협상·수락 경로를 관찰한다.

## 11. Metrics

- request-to-commitment clarification rounds
- scope misunderstanding
- late completion rejection
- silent acceptance incidents
- renegotiation time
- unrecorded obligation
- user comprehension of current commitment state

## 12. Sources

- [Stanford Encyclopedia of Philosophy: Speech Acts](https://plato.stanford.edu/archives/sum2023/entries/speech-acts/)
- [Winograd, A Language/Action Perspective on Cooperative Work](https://www.lri.fr/~mbl/ENS/CSCW/2017/papers/Winograd-CSCW86.pdf)

## 13. Open questions

- 자연어의 다의성을 유지하면서 어떤 speech act만 안정 상태로 승격할 것인가?
- agent가 실제 수행 능력을 잘못 판단해 Commitment를 수락하는 문제를 어떻게 탐지할 것인가?
- 팀에서 Acceptance authority가 분산될 때 한 conversation을 어떻게 닫을 것인가?

