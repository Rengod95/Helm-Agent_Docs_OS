# 11. 참고 자료

출처마다 이번 개정 작업 중 무엇을 확인했는지 표시한다.

- **원문 확인**: 원문을 읽고 내용을 확인함. 설치한 패키지의 README와 타입 정의를 읽은 것도 여기에 넣는다
- **초록 확인**: 초록이나 요약 페이지를 읽고 확인함
- **출처 위치 확인**: 출처의 위치(URL)는 확인했으나 내용은 기존 지식에 기반함
- **기존 지식**: 원문을 다시 확인하지 않음. 인용 전 확인이 필요함
- **Helm 내부 자료**: Helm 저장소의 자료(방법 카드, Method Transfer 지도 등)에 수록됨

## 1. Helm 내부 자료

| 문서 | 이 개정에서 쓰인 곳 |
|---|---|
| `docs/foundations/00-manifesto.md` | 공리 A1~A15, 10단계 사이클 |
| `docs/foundations/09-operating-theory.md` | 네 루프, 다섯 상태 공간, 개입 계산, OPD+C, 성숙도 모델 |
| `docs/foundations/10-refinement-candidate.md` | N/E/M + A/P, Concern/WorkUnit, Quick/Guided/Assured, 불변조건, C7(Goal), D1~D3 |
| `docs/architecture/helm-kernel-v0.2-candidate.md` | Effect class R0~R4, Gate rule, Authority carry-forward, 투영 불변조건 |
| `docs/foundations-friendly/01-shared-language.md`, `02-how-work-flows.md` | 쉬운 말 용어, 선택 요청 항목, 8단계 흐름 |
| `docs/experience/helm-cli-agent-v0.2.md` | Orient / Explore / Choose / Work / Review 화면 |
| `docs/research/README.md` | Method Transfer 절차, Method Card 형식, 전이 평가 질문 |
| `docs/research/method-transfer-map.md` | 35개 방법의 Method Transfer 지도, 우선 전이 묶음 A~D |
| `docs/research/method-cards/` | 20개 방법 카드 |

## 2. 묻기와 끼어들기

| 출처 | 확인 | 쓰인 곳 |
|---|---|---|
| McFarlane, D. (2002). Comparison of four primary methods for coordinating the interruption of people in human-computer interaction. *Human-Computer Interaction*, 17(1). [PDF](https://www.interruptions.net/literature/McFarlane-HCI02_2.pdf) | 원문 확인 | [06 §2.4](06-asking-and-interruption.md) |
| Horvitz, E. (1999). Principles of Mixed-Initiative User Interfaces. *CHI 1999*. [PDF](https://erichorvitz.com/chi99horvitz.pdf) | 출처 위치 확인 | [06 §2.2](06-asking-and-interruption.md) |
| Parasuraman, R., Sheridan, T. B., & Wickens, C. D. (2000). A model for types and levels of human interaction with automation. *IEEE Transactions on Systems, Man, and Cybernetics — Part A*, 30(3). [요약 페이지](https://andrewclark.super.site/all-media/a-model-for-types-and-levels-of-human-interaction-with-automation) | 출처 위치 확인 | [06 §2.3](06-asking-and-interruption.md), [10 §1.1](10-critique-and-open-questions.md) |
| Learning to Ask: When LLM Agents Meet Unclear Instruction (Ask-when-Needed). [arXiv 2409.00557](https://arxiv.org/html/2409.00557v3) | 초록 확인 | [06 §2.6](06-asking-and-interruption.md) |
| Edwards, N., & Schuster, S. Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents. [arXiv 2603.26233](https://www.alphaxiv.org/abs/2603.26233) | 초록 확인 | [06 §2.6](06-asking-and-interruption.md) |
| Iqbal, S. T., & Bailey, B. P. 작업 경계와 인터럽션 비용에 관한 연구들 | 기존 지식 | [06 §2.5](06-asking-and-interruption.md) |
| Howard, R. A. (1966). Information Value Theory. | 기존 지식 | [06 §2.1](06-asking-and-interruption.md) |

## 3. 상황 유형과 의사결정

| 출처 | 확인 | 쓰인 곳 |
|---|---|---|
| Snowden, D. J., & Boone, M. E. (2007). A Leader's Framework for Decision Making. *Harvard Business Review*. | 기존 지식 | [05](05-situation-types.md) |
| Boyd, J. OODA loop 관련 브리핑 | 기존 지식 | [10 §1](10-critique-and-open-questions.md) |
| Klein, G. (1998). *Sources of Power* (Recognition-Primed Decision) | 기존 지식 | [10 §1](10-critique-and-open-questions.md) |
| Klein, G. (2007). Performing a Project Premortem. *Harvard Business Review*. | 기존 지식 | [04 §5](04-inquiry-types.md) |

## 4. 원함 발견과 선호

| 출처 | 확인 | 쓰인 곳 |
|---|---|---|
| Lichtenstein, S., & Slovic, P. (Eds.) (2006). *The Construction of Preference*. | 기존 지식 | [01 §1.4](01-scope-and-motivation.md), [04 §3](04-inquiry-types.md) |
| Dow, S. P. et al. (2010). Parallel Prototyping Leads to Better Design Results, More Divergence, and Increased Self-Efficacy. *ACM TOCHI*. | 기존 지식 | [01 §1.4](01-scope-and-motivation.md) |
| Tohidi, M. et al. (2006). Getting the Right Design and the Design Right. *CHI 2006*. | 기존 지식 | [01 §1.4](01-scope-and-motivation.md) |
| Kelly, G. A. (1955). *The Psychology of Personal Constructs* (레퍼토리 그리드) | 기존 지식 | [04 §3](04-inquiry-types.md) |
| Chen, L., & Pu, P. (2012). Critiquing-based recommenders: survey and emerging trends. | 기존 지식 | [04 §3](04-inquiry-types.md) |
| 컨조인트 분석 일반 | 기존 지식 | [04 §3](04-inquiry-types.md) |

## 5. 가능성과 결과

| 출처 | 확인 | 쓰인 곳 |
|---|---|---|
| Zwicky, F. 형태 분석 (morphological analysis) | 기존 지식 | [04 §4.2](04-inquiry-types.md) |
| Altshuller, G. TRIZ | 기존 지식 | [04 §4.2](04-inquiry-types.md) |
| 시나리오 계획 일반 | 기존 지식 | [04 §5](04-inquiry-types.md) |
| STPA (Leveson) | Helm 내부 자료 (방법 카드) | [04 §5](04-inquiry-types.md) |

## 6. 구조 루프

| 출처 | 확인 | 쓰인 곳 |
|---|---|---|
| Viable System Model (Beer) | Helm 내부 자료 (Method Transfer 지도 #32) | [03 §4](03-loops-and-transitions.md) |
| Incident Command System (FEMA) | Helm 내부 자료 (Method Transfer 지도 #18) | [03 §4](03-loops-and-transitions.md) |
| NASA Systems Engineering Handbook | Helm 내부 자료 (Method Transfer 지도 #23) | [03 §4](03-loops-and-transitions.md) |

## 7. 런타임

| 출처 | 확인 | 쓰인 곳 |
|---|---|---|
| `@earendil-works/pi-durable` 1.1.0 README와 타입 정의 | 원문 확인 (설치한 패키지의 README·타입 정의) | [08 §11](08-runtime-architecture.md) |
| `@earendil-works/pi-coding-agent` 1.1.0 확장 타입 정의 | 원문 확인 (설치한 패키지의 타입 정의) | [08 §11](08-runtime-architecture.md) |
| Zhang, Kraska, Khattab. Recursive Language Models. arXiv 2512.24601 | v0.3 이전 논의에서 확인 | [04 §9](04-inquiry-types.md) |
