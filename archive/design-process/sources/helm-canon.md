# Helm 원전 정리 1: foundations · foundations-friendly · README.ko

- 작성: 2026-10-11, 0단계 에이전트 S1a
- 용도: 설계 에이전트(P1~P14)가 `docs/foundations/`, `docs/foundations-friendly/`, `README.ko.md`(Mac 수정본 포함) 원문 대신 읽는 정리본이다. 원문의 정의·목록·숫자·공식·표·스키마·순서를 줄이지 않고 옮겼다.
- 범위 밖: `docs/architecture/`, `docs/experience/`, `docs/prototypes/`, `docs/research/`, `docs/v0.3/`은 `helm-canon-2.md`, `helm-canon-3.md`와 v0.3 문서가 다룬다. 이 문서는 그 자료를 읽지 않았다. `.helm/private/`는 읽지 않았다.

## 0. 표기

- `「…」`와 인용 블록(`>`)은 원문 그대로다. 코드 블록 안의 공식·스키마·상태 기계도 원문 그대로다.
- 원문이 영어 용어·식별자를 쓰면 그대로 둔다.
- `[정리]`는 이 문서 작성자가 여러 원문을 모아 표로 만들거나 대응시킨 것이다. 원문에 그 형태로 있지 않다.
- 출처 약칭. 각 절 머리에 파일 경로와 제목을 함께 적는다.

| 약칭 | 경로 | 제목 |
|---|---|---|
| B | `docs/design/process/00-design-brief.md` | Helm 설계 브리프 (모든 설계·검증 에이전트 공통) |
| FR | `docs/foundations/README.md` | Helm Foundations |
| F00 | `docs/foundations/00-manifesto.md` | Helm Manifesto |
| F01 | `docs/foundations/01-ontology.md` | Ontology: Helm에서 무엇이 존재하는가 |
| F02 | `docs/foundations/02-epistemology.md` | Epistemology: Helm은 무엇을 어떻게 안다고 말하는가 |
| F03 | `docs/foundations/03-praxeology-and-governance.md` | Praxeology and Governance: 누가 무엇을 어떻게 행하는가 |
| F04 | `docs/foundations/04-co-agency.md` | Co-agency: 인간과 에이전트가 함께 일한다는 것 |
| F05 | `docs/foundations/05-formal-state-model.md` | Formal State Model |
| F06 | `docs/foundations/06-interaction-constitution.md` | Interaction Constitution |
| F07 | `docs/foundations/07-architecture-invariants.md` | Architecture Invariants |
| F08 | `docs/foundations/08-falsifiable-hypotheses.md` | Falsifiable Product Hypotheses |
| F09 | `docs/foundations/09-operating-theory.md` | Helm Operating Theory |
| F10 | `docs/foundations/10-refinement-candidate.md` | Helm Foundation v0.2 정제 후보 |
| PR | `docs/foundations-friendly/README.md` | 쉬운 Helm Foundations |
| P00 | `docs/foundations-friendly/00-helm-in-plain-language.md` | Helm을 쉬운 말로 설명하면 |
| P01 | `docs/foundations-friendly/01-shared-language.md` | Helm의 공통 제품 언어 |
| P02 | `docs/foundations-friendly/02-how-work-flows.md` | Helm에서 일은 어떻게 흐르는가 |
| P03 | `docs/foundations-friendly/03-working-with-agents.md` | 사람과 Agent가 함께 일하는 방법 |
| P04 | `docs/foundations-friendly/04-trust-control-and-completion.md` | 신뢰, 통제, 결과 확인 |
| P05 | `docs/foundations-friendly/05-ux-writing-guide.md` | Helm UX Writing Guide |
| P06 | `docs/foundations-friendly/06-technical-crosswalk.md` | Product Language와 기술 모델의 연결 |
| P07 | `docs/foundations-friendly/07-example-lifecycle.md` | 예시로 보는 Helm 전체 Lifecycle |
| PY | `docs/foundations-friendly/product-language.yaml` | (schema `helm.product-language.v0`) |
| RK | `README.ko.md` | Helm (저장소 판) |
| RKm | `.helm-design-work/mac-modified/README.ko.md` | Helm (Mac에서 수정 중이던 판) |

## 1. 읽은 파일 목록

모두 처음부터 끝까지 읽었다. 분량은 `wc -l` 줄 수와 바이트 수다.

| 경로 | 제목 | 분량 | 핵심 내용 한 줄 |
|---|---|---|---|
| `docs/design/process/00-design-brief.md` | Helm 설계 브리프 | 280줄 | 설계 목표, 확정 결정 37개, 공통 계약, 문서 01~25 목록과 소유, 감사 누락 항목 담당, 문체 규칙 |
| `docs/foundations/README.md` | Helm Foundations | 61줄, 5.1KB | v0.1 원론의 지위, 문서 순서, 규범 키워드 MUST/SHOULD/MAY, 핵심 문장 |
| `docs/foundations/00-manifesto.md` | Helm Manifesto | 159줄, 7.9KB | 출발점, 최상위 목적, 10단계 순환, justified_progress 공식, 공리 A1~A15, 비대칭 표, 비목표, 제품 약속 8 |
| `docs/foundations/01-ontology.md` | Ontology | 234줄, 8.2KB | 세 세계 N/E/M, 행위자 4종, 핵심 엔터티 16종, 관계, 동일성·시간, 기억, 존재론 불변조건 8 |
| `docs/foundations/02-epistemology.md` | Epistemology | 171줄, 8.3KB | 인식적 종류 6, 증거 품질 8차원, 주장–논증–증거, 경쟁 가설, 불확실성 6종, 증명 부담, Claim/Evidence 상태, 인식적 UI 원칙, 인식적 완료 조건 |
| `docs/foundations/03-praxeology-and-governance.md` | Praxeology and Governance | 184줄, 7.9KB | Conversation for Action 상태 기계, DelegationContract 스키마, 권한·책임 5구분, Authority Envelope 9차원, 개입 필요도, 보충성, Decision 상태와 보존 항목, 통치 불변조건 8 |
| `docs/foundations/04-co-agency.md` | Co-agency | 166줄, 8.2KB | Joint Cognitive System, 공동행위 조건 6, OPD+C, labor/work/action, SDT, 참여 리듬, 자동화 역설 MUST 5, 안티패턴 7, Co-agency 불변조건 7 |
| `docs/foundations/05-formal-state-model.md` | Formal State Model | 294줄, 9.3KB | W(t) 5요소, fold, Event 스키마·불변, WorkUnit·Decision·Claim·Evidence·Commitment·ContextProjection·Integration 상태 기계, 파생 뷰 5, 전역 불변조건 I1~I12, 충돌, 저장 형식 독립 |
| `docs/foundations/06-interaction-constitution.md` | Interaction Constitution | 228줄, 9.2KB | 사용자 권리 7, Gate 허용·비허용 조건, Decision Gate 13필드, Return Brief 계약, Inquiry·Delegation·Integration 상호작용, 운영 모드 5, attention_policy, 즐거움, 금지 상호작용 10 |
| `docs/foundations/07-architecture-invariants.md` | Architecture Invariants | 262줄, 11.4KB | 아키텍처 요구 8, 논리 계층 7, Event Ledger MUST/SHOULD, Projection 필수 8, Governance Engine, Adapter 책임, OSS/SaaS, Docs-Agent OS 매핑, Context Compilation, 의미적 동시성, 보안, 기술 비목표, 평가 질문 8 |
| `docs/foundations/08-falsifiable-hypotheses.md` | Falsifiable Product Hypotheses | 274줄, 9.8KB | 비교 기준선 3, 가설 H1~H10(예측·지표·반증), 질적 연구, 실험 Phase A~D, 중단·피벗 기준, 초기 성공 기준 5 |
| `docs/foundations/09-operating-theory.md` | Helm Operating Theory | 620줄, 20.6KB | 중심 명제, 철학 5, 다섯 상태 공간, 네 루프 O/I/C/A, 결합, episode, 비대칭, 개입 산법, OPD+C, 경험, 아키텍처 도출, 성숙도 L0~L5, 첫 제품 경계, OSS/SaaS, Harness 비교, 12 법칙, 반증 조건 |
| `docs/foundations/10-refinement-candidate.md` | Helm Foundation v0.2 정제 후보 | 479줄, 24.0KB | 모순 C1~C8, 정본 후보 정의, 제품 목표 순서, Kernel 경계, N/E/M + A/P, Concern/WorkUnit, Quick/Guided/Assured, 최소 법칙 12, adapter protocol·Level A~D, 대표 시나리오, UX 4 질문, D1~D3, 수락 기준 |
| `docs/foundations-friendly/README.md` | 쉬운 Helm Foundations | 62줄, 4.1KB | 두 Foundations의 역할과 충돌 규칙, 읽는 순서, 일곱 약속, 한 문장 정의 |
| `docs/foundations-friendly/00-helm-in-plain-language.md` | Helm을 쉬운 말로 설명하면 | 104줄, 4.3KB | 해결하려는 문제 7, 10단계 사용자 흐름, 쉬운 원칙 10, Helm이 아닌 것 7, 좋은 사용 경험 6 |
| `docs/foundations-friendly/01-shared-language.md` | Helm의 공통 제품 언어 | 168줄, 8.4KB | 언어 원칙 5, 관찰→해석→가능성→판단→선택, 제출→확인→반영, 제품 용어 표 4개, 화면에서 쓰지 않을 말 16, 상태 이름, 세 묶음 |
| `docs/foundations-friendly/02-how-work-flows.md` | Helm에서 일은 어떻게 흐르는가 | 140줄, 4.5KB | 8단계 흐름과 단계별 사용자 경험·가치, 다시 열리는 상황 6 |
| `docs/foundations-friendly/03-working-with-agents.md` | 사람과 Agent가 함께 일하는 방법 | 108줄, 3.5KB | 역할 분담, 네 권리(OPD+C), 리듬, 선택 요청을 만들지 않을 때 6, 피해야 할 공동 작업 6 |
| `docs/foundations-friendly/04-trust-control-and-completion.md` | 신뢰, 통제, 결과 확인 | 120줄, 4.3KB | 맡긴 범위 8항목, 선택 요청 깊이 3, 근거 질문 7, 결과 확인 트리와 4 행동, 전체 반영 5, 재확인 조건 6, 실패와 복구 |
| `docs/foundations-friendly/05-ux-writing-guide.md` | Helm UX Writing Guide | 148줄, 4.6KB | 목소리 5, 문장 순서, 화면별 고정 표현, 버튼 표, 상태 문장 예시, 불확실성 표현, Agent 표현, 알림, 언어 |
| `docs/foundations-friendly/06-technical-crosswalk.md` | Product Language와 기술 모델의 연결 | 173줄, 7.6KB | MUST/SHOULD/MUST NOT, 원론↔Product Domain↔UI↔API 대응표 2개, JSON 예시, projection 경계, IA 이름, 도입 순서 6 |
| `docs/foundations-friendly/07-example-lifecycle.md` | 예시로 보는 Helm 전체 Lifecycle | 140줄, 4.8KB | 결제 흐름 출시 예시 9단계 |
| `docs/foundations-friendly/product-language.yaml` | `helm.product-language.v0` | 266줄, 7.8KB | authority 규칙, terms 32개, navigation 6, work_statuses 14, choice_statuses 7, fixed_sections 4, avoid_as_default_ui_labels 16 |
| `.helm-design-work/mac-modified/README.ko.md` | Helm (Mac 수정본) | 205줄, 10.0KB | Agent Docs OS 설명 + Helm 차세대 모델 연구 소개 + Helm System v0 실험 단계 절 |
| `README.ko.md` | Helm (저장소 판) | 178줄, 8.0KB | Agent Docs OS 설명(Helm 연구·System v0 절 없음) |

합계: 원전 24개 + 브리프 1개 = 25개. 읽지 못한 파일은 없다.

## 2. 원전의 지위와 우선순위

출처: FR(`docs/foundations/README.md`, Helm Foundations), PR(`docs/foundations-friendly/README.md`, 쉬운 Helm Foundations), PY, F10 머리말, B 머리말.

### 2.1 v0.1 Foundations의 지위 (FR)

- 상태: 「working draft v0.1」. 역할: 「Helm의 제품·데이터·상호작용·기술 아키텍처가 따라야 하는 상위 원론」.
- FR이 답하려는 질문 6개(원문):
  1. Helm에서 일과 진척은 무엇인가?
  2. 인간, 에이전트, 도구는 각각 어떤 종류의 행위자인가?
  3. 사실, 추론, 가설, 결정, 약속은 어떻게 구분되는가?
  4. 무엇을 위임할 수 있고 언제 인간에게 되돌아와야 하는가?
  5. 적극적인 사용자 개입이 방해가 아니라 품질과 즐거움의 원천이 되려면 무엇이 필요한가?
  6. 이 전제들이 상태 모델, UX, 저장 구조, 에이전트 어댑터로 어떻게 이어지는가?
- 기존 아키텍처 문서(`docs/architecture/fundamentals.md`, 「Docs-Agent OS v0의 구현 원론」)와의 관계(원문):
  - Foundations는 Helm이 다루는 현실의 의미와 불변조건을 정의한다.
  - Architecture Fundamentals는 그 의미를 현재 파일 구조에 직렬화한 구현을 설명한다.
  - 두 문서가 충돌할 경우 현재 동작은 Architecture Fundamentals가 설명하지만, 차세대 설계 방향은 Foundations를 따른다.
  - 기존 구조의 변경은 실험을 통해 Foundations의 가설이 지지된 이후 ADR로 수락한다.
  - 「`docs/`, YAML, Markdown, 데이터베이스는 Helm의 존재론이 아니다. 이들은 Helm의 의미 모델을 저장하고 투영하는 교체 가능한 표현 방식이다.」
- 문서 순서(원문): 00 manifesto(목적, 공리, 비목표) → 01 ontology(존재하는 객체와 세 세계 모델) → 02 epistemology(지식, 증거, 불확실성, 수락) → 03 praxeology-and-governance(행위, 위임, 권한, 책임) → 04 co-agency(인간–에이전트 공동행위와 경험) → 05 formal-state-model(상태, 사건, 전이, 형식 불변조건) → 06 interaction-constitution(사용자 개입과 인터페이스의 헌법) → 07 architecture-invariants(제품·기술 아키텍처의 불변조건) → 08 falsifiable-hypotheses(반증 가능한 제품 가설과 실험) → 09 operating-theory(네 운영 루프와 전체 제품·기술 아키텍처의 통합 이론).
- 10-refinement-candidate의 지위(원문): 「현재 실행 증거에서 드러난 모순과 v0.2 정제안을 모은 **비규범적 후보 문서**다. 제품 소유자의 Decision Gate 수락과 cross-runtime 검증 전에는 00–09의 정본 지위를 대체하지 않는다.」
- 관련 자료 위치(원문 언급): 연구 근거 `docs/research/README.md`, 첫 검증 아티팩트 `docs/prototypes/paper-v0/README.md`(Return Brief, Inquiry Map, Delegation Contract, Decision Gate의 사용자 가치 검증), 실행 vertical slice `docs/architecture/helm-system-v0.md`(「headless core, CLI, HTTP/SSE server, Web GUI가 같은 Event ledger와 projection을 사용하지만 contract는 아직 experimental」).
- 규범 키워드(원문):
  - **MUST**: 위반하면 Helm의 원론적 정체성이 깨지는 불변조건
  - **SHOULD**: 특별한 근거가 없다면 따라야 하는 기본 원칙
  - **MAY**: 환경에 따라 선택할 수 있는 구현 전략
- 핵심 문장(원문):

> Helm은 더 많은 일을 인간 대신 처리하는 시스템이 아니라, 인간의 제한된 주의력을 가장 중요한 판단에 배치하여 인간과 에이전트가 함께 더 정당하고 일관된 변화를 만드는 시스템이다.

### 2.2 두 Foundations의 역할과 충돌 규칙 (PR)

- 상태: 「product-language foundation v0.1」. 역할: 「Helm의 사용자 경험, 제품 도메인, UX writing, onboarding이 따라야 하는 기본 언어」. Source: 「`../foundations/README.md`의 원칙을 의미 손실 없이 쉬운 말로 투영」.
- 다시 쓰는 기준 5(원문): 처음 보는 사람도 한 번에 이해할 수 있는가? / 화면의 제목과 버튼으로 바로 사용할 수 있는가? / 사용자가 자신의 목표·판단·권한을 스스로 바꿀 수 있게 하는가? / 기술 용어를 몰라도 서로 다른 상태를 혼동하지 않게 하는가? / 제품·디자인·개발·지원팀이 같은 단어를 사용할 수 있는가?

| 구분 | 어려운 원론 Foundations | 쉬운 Product Foundations |
|---|---|---|
| 주 독자 | 연구자, 시스템 설계자, core 개발자 | 사용자, product, design, application 개발자, support |
| 책임 | 의미·책임·상태 전이의 정확성 | 제품 언어·화면 구조·상호작용의 이해 가능성 |
| 대표 표현 | Purpose, Concern, Claim, Commitment | 목표, 초점, 판단, 약속 |
| 사용 위치 | 내부 불변조건, 연구, formal model | UI label, public API, onboarding, 도움말, 알림 |

충돌 규칙(원문):
1. **의미와 안전 규칙**은 원론 Foundations가 우선한다.
2. **사용자에게 보이는 이름과 설명**은 쉬운 Product Foundations가 우선한다.
3. 쉬운 표현으로 중요한 구분을 보존할 수 없으면 새 표현을 찾는다. 어려운 용어를 그대로 노출하는 것은 마지막 수단이다.
4. 내부 저장 schema는 즉시 이름을 바꾸지 않아도 되지만, 새 public domain과 UI는 `06-technical-crosswalk.md`의 제품 용어를 기준으로 한다.

PY의 authority 블록(원문): `semantic_source: ../foundations/README.md`, `product_language_source: README.md`, rule: 「의미와 안전 규칙은 semantic_source를 따르고, 사용자에게 보이는 이름과 application-layer domain은 이 vocabulary를 따른다.」 구현과 copy test의 기계 판독 기준은 PY다(PR, P06 §6).

### 2.3 이 설계 작업에서의 우선순위 [정리]

- B 머리말: 「이 문서와 다른 자료가 충돌하면 이 문서가 우선한다.」 따라서 원전(v0.1·v0.2)과 브리프가 다르면 브리프가 이긴다. 차이 목록은 §20.3.
- B §2.1의 Helm 이론 결정은 「v0.3에서 결정」된 것이다. 이 문서가 다룬 v0.1·v0.2 원전은 v0.3의 앞 단계다.

## 3. Helm의 정의와 justified progress

### 3.1 Helm의 정의 (판본별 원문)

| 출처 | 정의 원문 |
|---|---|
| FR (v0.1) | 「Helm은 여러 에이전트의 작업을 표시하는 대시보드가 아니다. Helm은 인간이 목적과 판단의 저자성을 유지하면서 에이전트와 함께 문제를 정의하고, 가설을 검증하고, 결정을 약속으로 만들고, 산출물을 전체 시스템에 통합하는 **지향적 공동행위 시스템(steered co-agency system)** 이다.」 |
| F00 §2 | 「Helm은 인간, 에이전트, 도구, 문서, 실행 환경을 하나의 공동 인지·행위 시스템으로 다룬다.」 |
| F09 §1 (Working name: **Steered Co-agency — 지향적 공동행위론**, Status: grand synthesis v0.1) | 「Helm은 agent task manager가 아니다.」 / 「**Helm은 제한된 인간 주의력 아래에서 인간·에이전트·도구가 공동 목적을 향해 지식, 약속, 실행, 결과를 계속 정렬하도록 만드는 지향적 공동행위 시스템이다.**」 |
| F10 §3 정본 후보 (v0.2) | 「**Helm은 인간이 방향과 판단의 주인으로 남으면서 AI와 함께 탐구하고 실행하고 결과를 통합하게 하는 local-first AI agent system이다. 첫 제품은 자체 CLI AI agent이며, 그 경험을 지탱하는 Foundation과 Kernel은 다른 agent runtime에도 이식할 수 있어야 한다.**」 |
| F10 §3 한 줄 사용자 약속 | 「Helm CLI에서 깊고 일관된 방식으로 AI와 일하고, 자리를 비웠다가 돌아오거나 다른 agent로 옮겨도 같은 방향·맡긴 범위·결과 기준으로 이어간다.」 |
| PR 한 문장 | 「Helm은 agent를 더 많이 돌리는 앱이 아니라, 사람이 방향을 잃지 않고 중요한 선택에 집중하면서 agent와 함께 믿을 만한 결과를 만드는 작업 공간이다.」 |
| P00 §1 | 「중요한 차이는 보여주고, 반복적인 실행은 조용히 맡기며, 사용자가 방향과 결과의 주인으로 남게 한다.」 |
| RKm | 「Helm은 여러 에이전트가 일하는 동안 사용자가 방향을 잃지 않고 중요한 선택과 결과의 주인으로 남게 하는 시스템을 목표로 합니다.」 |
| F09 §15 | 「Helm은 harness를 대체하지 않는다. Harness를 실행 substrate로 사용하면서 그 위에 공동행위와 인간 판단의 control plane을 제공한다.」 |
| F10 §3 Kernel 경계 | 「Kernel은 제품 내부의 "control plane" 역할을 하지만 Helm 제품 전체를 control panel로 정의하지 않는다. First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다.」 / D1: `Kernel ≠ Agent Runtime`, `Helm Product = Kernel + Agent Runtime + Experience` |

### 3.2 최상위 목적 (F00 §1, `docs/foundations/00-manifesto.md`)

> **인간의 주의력과 판단권을 보존하면서, 상호작용을 통해 결과의 정당성·품질·일관성을 높인다.**

출발점(원문): 「에이전트의 실행 속도와 병렬성은 인간이 작업을 이해하고 감독할 수 있는 속도보다 빠르게 증가한다. 이때 병목은 코드 생성 능력이 아니라 다음 능력이다.」
- 지금 무엇이 진행 중인지 파악하는 능력
- 서로 다른 작업이 같은 목적을 향하는지 판단하는 능력
- 중요한 선택과 사소한 선택을 구분하는 능력
- 에이전트의 주장을 검증할 증거를 찾는 능력
- 시간 간격과 세션 경계를 넘어 의도와 결정의 연속성을 유지하는 능력
- 지역적으로 완료된 결과를 전체 시스템에 통합하는 능력

「일반적인 에이전트 하네스는 프롬프트 한 번으로 결과를 완성할 확률, 속도, 비용을 최적화한다. Helm은 그 목표를 부정하지 않지만 최상위 목적으로 두지 않는다.」

### 3.3 justified progress (정당화된 진전)

F00 §3 최적화 목표(원문 공식):

```text
justified_progress
  = validated_change
  + reduced_relevant_uncertainty
  + increased_system_coherence
  + retained_human_agency
```

F00 §3 해설(원문): 「단순한 완료 수, 에이전트 가동률, 프롬프트당 산출량은 보조 지표다. 인간의 개입 횟수 역시 목표가 아니다. 중요한 것은 **한 번의 인간 개입이 결과와 이해에 미치는 의미 있는 영향**이다.」

F09 §1(원문): 일반 harness가 「프롬프트에서 결과까지의 자율 실행」을 최적화한다면 Helm은 다음을 최적화한다.

```text
justified progress under bounded human attention
```

「여기서 justified progress는 다음 네 조건을 동시에 요구한다.」
1. 실제 세계 또는 Artifact가 가치 있는 방향으로 변했다.
2. 그 변화가 목적에 부합한다고 믿을 충분한 Evidence가 있다.
3. 누가 어떤 trade-off와 책임을 수락했는지 명확하다.
4. 지역 변화가 전체 시스템과 통합되고 다음 변화에 대응할 능력이 남아 있다.

[정리] 공식 항과 네 조건의 대응: `validated_change` ↔ 조건 1·2(M 변화 + E 근거), `reduced_relevant_uncertainty` ↔ 조건 2, `increased_system_coherence` ↔ 조건 4(통합), `retained_human_agency` ↔ 조건 3(누가 수락했는가)과 조건 4 후반(다음 변화에 대응할 능력). 공리 A2가 같은 내용을 공리로 둔다.

관련 원문:
- F01 §2: 「작업의 완료는 세 세계의 정렬을 요구한다. 물질적 변경이 존재해도 그것이 목적에 부합한다는 정당한 믿음과 규범적 수락이 없다면 완료가 아니다.」
- F09 §2.1: `Task identity alone does not explain work.` / `Work = authorized transformation of a shared situation.`
- F09 §15 표: Harness의 최적화 대상 `prompt-to-result completion` / Helm `justified progress under attention`. progress: Harness `activity/completion` / Helm `alignment, uncertainty reduction, integration`.
- P00 §3 원칙 2: 「파일 수, message 수, agent 실행 시간보다 실제로 무엇이 좋아졌고 그것을 왜 믿는지가 중요하다.」

## 4. 출발점, 비대칭, 비목표, 제품 약속

### 4.1 인간과 에이전트의 비대칭성 (F00 §5)

「Helm은 인간과 에이전트를 완전히 동일한 행위자로 취급하지 않는다.」

| 능력 | 인간 | 에이전트 |
|---|---|---|
| 가치와 목적의 정당성 부여 | 최종 저자 | 제안·비판 가능 |
| 대규모 탐색과 생성 | 제한적 | 강점 |
| 상황적 실천 판단 | 주도 | 보조·모사 |
| 반복 실행 | 감독 비용 큼 | 강점 |
| 책임과 사회적 약속 | 보유 | 운영적 약속만 표현 |
| 증거 수집·정리 | 방향 설정 | 대규모 수행 |
| 결과 수락 | 인간 또는 승인된 정책 | 수락 근거 제안 |

「이 비대칭은 인간 우월성의 선언이 아니라 제품의 책임 구조다. Helm은 에이전트의 능력이 발전해도 누가 목적과 위험을 승인했는지 추적할 수 있어야 한다.」

F09 §7 규범적 비대칭(원문 목록):
- 인간의 중심 역할: Purpose와 가치 정당화 / ProblemFrame contestation / 중요한 Criterion 선택 / 비가역적·규범적 trade-off 수락 / 책임 있는 Commitment와 Acceptance / 전체 결과의 사회적·조직적 의미 판단
- 에이전트의 중심 역할: 넓은 탐색과 Hypothesis 생성 / Evidence 수집·정리·비교 / bounded WorkUnit 실행 / test, simulation, draft, analysis 생성 / Conflict, Exception, Counterevidence 탐지 / ContextProjection과 Decision 초안 생성
- 정책과 도구의 역할: 반복 Decision의 안전한 자동화 / permission과 resource boundary 집행 / Event와 Evidence의 신뢰 가능한 생성 / 정상 범위의 압축과 예외 신호
- 「이 분담은 능력의 영구 경계가 아니다. 에이전트 능력이 변해도 누가 Purpose와 위험을 수락했는지의 책임 구조는 명시적으로 남는다.」

P03 §1 쉬운 판(원문 목록):
- 사람: 목표와 지켜야 할 가치를 정한다 / 중요한 문제 관점과 완료 기준을 바꾼다 / 되돌리기 어렵거나 큰 영향을 주는 선택을 받아들인다 / 결과를 확인하고 전체에 반영할지 정한다.
- Agent: 넓게 조사하고 여러 가능성을 만든다 / 근거를 수집하고 비교한다 / 맡긴 범위 안에서 반복 실행과 초안을 수행한다 / 반대 근거, 충돌, 맡긴 범위 밖의 문제를 알린다 / 결과와 확인 근거를 함께 제출한다.
- 도구와 자동화 규칙: 테스트, Git, CI, 배포처럼 신뢰 가능한 관찰을 만든다 / 반복되는 선택을 정해진 범위 안에서 처리한다 / 권한과 resource boundary를 실제로 집행한다.
- 「Agent가 유능해져도 누가 목표와 위험을 받아들였는지는 남아야 한다.」

### 4.2 제품 비목표

F00 §6(원문, 8개): 「Helm은 다음을 최상위 목표로 삼지 않는다.」
1. 모든 프로젝트를 하나의 고정 워크플로우에 맞추기
2. 가능한 한 인간을 완전히 제거하기
3. 에이전트 실행 로그를 더 화려하게 시각화하기
4. 모든 결정을 승인 모달로 바꾸기
5. 채팅 기록 전체를 장기 메모리라고 부르기
6. 프로젝트 관리, IDE, 에이전트 런타임을 모두 직접 대체하기
7. 게임화로 피상적인 참여 시간을 늘리기
8. 테스트 통과를 목적 충족과 동일시하기

F10 §3 「여전히 비목표인 것」(원문, 5개):
1. 모든 model provider의 자체 inference 구현
2. 범용 IDE와 프로젝트 관리 전 기능 대체
3. 모든 채팅 transcript를 정본 장기 기억으로 취급
4. 특정 vendor의 session ontology를 Helm ontology로 채택
5. 이식성을 위해 Helm CLI 경험을 가장 약한 runtime 수준으로 제한

P00 §4 「Helm이 아닌 것」(원문, 7개): 모든 일을 agent에게 넘기기 / 모든 실행을 실시간으로 감시하기 / 모든 선택에 승인 버튼 누르기 / 채팅 기록 전체를 장기 기억이라고 부르기 / agent를 사람처럼 꾸며 신뢰를 유도하기 / 프로젝트 관리 도구, IDE, agent runtime을 모두 대체하기 / 테스트 통과를 올바른 결과와 같다고 보기.

기술 비목표(F07 §13)는 §13.13에 있다.

### 4.3 제품 약속

F00 §7(원문): 「Helm을 사용하는 사람은 언제든 다음 질문에 답할 수 있어야 한다.」
1. 우리는 무엇을 이루려 하고 있는가?
2. 현재 가장 중요한 문제와 불확실성은 무엇인가?
3. 어떤 가설들이 검증되고 있으며 무엇이 이들을 지지하거나 반박하는가?
4. 누가 무엇을 어떤 권한과 제약 아래 수행하고 있는가?
5. 내가 없는 동안 우리의 믿음, 약속, 산출물 중 무엇이 바뀌었는가?
6. 지금 내가 판단해야 하는 것은 무엇이며 왜 지금인가?
7. 어떤 결과를 왜 받아들였고 언제 다시 검토해야 하는가?
8. 지역적 결과가 전체 시스템과 어떻게 통합되었는가?

PR 「제품이 지켜야 할 일곱 약속」(원문): 「Helm 사용자는 언제든 다음을 이해하고 바꿀 수 있어야 한다.」
1. **목표:** 우리가 이루려는 것은 무엇인가?
2. **현재 상황:** 돌아온 뒤 무엇이 달라졌고 왜 중요한가?
3. **가능성:** 어떤 설명과 해법을 검토하고 있으며 근거는 무엇인가?
4. **맡긴 일:** 누가 무엇을 어디까지 하고 있는가?
5. **다음 흐름:** 그대로 두면 다음에 무엇이 일어나는가?
6. **내 선택:** 지금 내가 정해야 하는 것은 무엇이며 다른 선택은 무엇인가?
7. **결과:** 무엇을 확인했고 전체에 어떻게 반영했는가?

F10 §10 UX 4 질문(원문): 「사용자 경험의 중심 화면은 agent 목록이나 task board가 아니라 다음 네 질문이어야 한다.」
1. **어디로 가고 있는가?** — Goal, success condition, constraint
2. **무엇이 달라졌고 무엇을 믿는가?** — observation, finding, uncertainty, dissent
3. **내 판단이 필요한 차이는 무엇인가?** — choice gate와 consequence
4. **무엇을 어디까지 맡겼고 결과를 믿어도 되는가?** — work agreement, evidence, acceptance, integration

「상세 activity와 transcript는 drill-down source이지 기본 화면이 아니다.」

[정리] 세 목록의 대응: F00 약속 1 ↔ PR 1 ↔ F10 질문 1 / F00 2·5 ↔ PR 2 ↔ F10 2 / F00 3 ↔ PR 3 ↔ F10 2 / F00 4 ↔ PR 4 ↔ F10 4 / F00 6 ↔ PR 6 ↔ F10 3 / F00 7·8 ↔ PR 7 ↔ F10 4. PR 5(다음 흐름)는 F06 Return Brief의 Projection 절과 대응한다.

### 4.4 P00이 말하는 문제와 좋은 경험 (`docs/foundations-friendly/00-helm-in-plain-language.md`)

문제(원문): 「Agent는 사람보다 빠르게 많은 일을 동시에 수행할 수 있다. 문제는 일이 많아질수록 사람이 다음을 놓치기 쉽다는 것이다.」 왜 이 일을 시작했는지 / 지금 무엇이 사실이고 무엇이 추측인지 / agent가 어디까지 해도 되는지 / 어떤 선택이 전체 방향을 바꾸는지 / 끝났다는 말이 정말 믿을 만한지 / 여러 결과가 서로 맞는지 / 하루 뒤 돌아왔을 때 어디서 다시 시작해야 하는지. 「Helm은 이 문제를 더 긴 채팅 기록이나 더 많은 알림으로 해결하지 않는다.」

좋은 사용 경험(원문, P00 §5): 흩어진 상황이 이해 가능한 모습으로 정리된다 / 내가 바꾼 기준이 여러 agent의 방향을 실제로 바꾼다 / 반복 작업을 보지 않아도 중요한 위험은 놓치지 않는다 / 결과를 단순 승인한 것이 아니라 함께 만들었다고 느낀다 / 시간이 지나도 다시 시작하는 비용이 낮다 / 쓸수록 나의 위임 방식과 판단 규칙이 좋아진다.

## 5. 공리 A1~A15

출처: F00 §4 (`docs/foundations/00-manifesto.md`, Helm Manifesto). 제목과 본문은 원문 그대로다. "관련 원문"은 같은 원리를 다른 문서가 구체화한 곳이다([정리]). "쉬운 원칙"은 P00 §3의 열 가지 쉬운 원칙 가운데 대응하는 것이다.

### A1. 목적은 태스크보다 먼저 존재한다

> 모든 작업은 상위 목적, 성공 조건, 보존해야 할 가치와 연결되어야 한다.

- 관련 원문: F01 §8 존재론 불변 1(「WorkUnit은 최소 하나의 Purpose 또는 Concern과 연결되어야 한다」), F05 WorkUnit `Proposed` 진입 조건 「Purpose 또는 Concern 연결」, F09 §16 법칙 1(「Purpose 없는 WorkUnit은 실행하지 않는다」), F10 §6 최소 법칙 1(「모든 material mutation은 Goal/Concern과 권한 근거에 연결한다」), F06 §2 「목적을 알 권리」, F10 C7(Goal은 versioned normative entity).
- 쉬운 원칙 1: 「할 일보다 목표를 먼저 본다 — 모든 작업은 "무엇을 할 것인가"뿐 아니라 "왜 필요한가"와 연결된다.」

### A2. 진척은 활동량이 아니라 정당화된 상태 변화다

> 에이전트가 많은 파일을 변경했거나 긴 보고서를 작성한 것은 그 자체로 진척이 아니다.

- 관련 원문: F00 §3 justified_progress 공식, F09 §1 네 조건, F01 §2 세 세계 정렬.
- 쉬운 원칙 2: 「많이 움직인 것이 진척은 아니다」.

### A3. 문제 정의는 입력값이 아니라 작업 결과의 일부다

> 실행 중 발견된 증거가 처음의 문제 프레임을 바꿀 수 있어야 한다.

- 관련 원문: F02 §1(Dewey: 「문제와 해결은 처음부터 완성된 입력으로 주어지는 것이 아니라 탐구 과정에서 함께 형성된다」), F09 §16 법칙 2(「Initial prompt를 완성된 ProblemFrame으로 취급하지 않는다」), F02 §5 보고 항목 「기존 ProblemFrame이 잘못되었는가」, F06 §6 ProblemFrame 분기·합치기.
- 쉬운 원칙 3: 「처음 요청이 완성된 문제 정의는 아니다」.

### A4. 병렬성은 작업량보다 가설 다양성에 우선 사용한다

> 같은 가정을 복제한 여러 실행보다 서로 다른 설명과 해법을 반증 가능하게 비교하는 것이 먼저다.

- 관련 원문: F02 §5 경쟁 가설(ACH), F09 §16 법칙 4(「병렬성은 같은 답의 복제보다 경쟁 가설과 전문 관점에 먼저 사용한다」), F08 H3.
- 쉬운 원칙: 직접 대응 없음(원칙 4와 P02 3단계가 가까움).

### A5. 사실, 추론, 가설, 결정, 약속은 서로 다른 상태다

> 하나의 자연어 요약 안에서 이들을 혼합해서는 안 된다.

- 관련 원문: F02 §2 인식적 종류, F01 §8 불변 3, F09 §16 법칙 3, F10 C5와 최소 법칙 3(「Observation, Interpretation, Possibility, Finding, Choice를 서로 자동 승격하지 않는다」), P06 MUST NOT(「`관찰`, `해석`, `가능성`, `판단`, `선택`을 하나의 text field에 저장하지 않는다」).
- 쉬운 원칙 4: 「본 것, 해석한 것, 가능한 설명, 선택을 구분한다 — 직접 확인한 사실과 agent의 해석을 같은 문장에 섞지 않는다.」

### A6. 에이전트는 제안과 제한된 실행의 주체이며 인간은 가치와 최종 약속의 저자다

> 에이전트가 운영적 결정을 수행할 수 있지만, 그 권한과 수락 기준에 대한 규범적 책임은 인간 또는 인간이 승인한 정책에 남는다.

- 관련 원문: F00 §5 비대칭 표, F01 §3 AgentActor(「법적·도덕적 책임의 최종 주체로 간주하지 않는다」), F05 I4(「Accepted has an authorized acceptor」), F09 §7.
- 쉬운 원칙 5: 「Agent에게는 일을 맡기고 사람은 방향을 정한다」.

### A7. 자율성은 이진값이 아니라 위험 적응적 권한 범위다

> 같은 에이전트도 작업 단계, 가역성, 파급 범위, 관측 가능성에 따라 다른 권한을 가진다.

- 관련 원문: F03 §5 Authority Envelope 9차원, F09 §16 법칙 6(「자율성은 agent 속성이 아니라 WorkUnit의 Authority Envelope다」), F10 최소 법칙 5, F10 authority 포함 관계 공식, F10 Quick/Guided/Assured.
- 쉬운 원칙 6: 「자율성은 agent의 등급이 아니라 맡긴 범위다 — 같은 agent도 작업과 위험에 따라 읽기만 하거나, 로컬 변경을 하거나, 외부 행동 전에 멈출 수 있다.」

### A8. 결정은 가장 낮은 유능한 수준에서 이루어지고 예외만 상향된다

> 모든 세부 선택을 인간에게 묻지 않으며, 가치 충돌·비가역성·높은 불확실성·큰 파급 효과를 중심으로 개입을 요청한다.

- 관련 원문: F03 §7 보충성 및 예외 관리, F06 §3 개입 요청 허용 조건, F09 §8 개입 산법, F09 §16 법칙 7(「Decision은 가능한 가장 낮은 유능한 수준에 두고 상향 이유를 설명한다」).
- 쉬운 원칙 7: 「사소한 것은 묻지 않고 중요한 차이만 묻는다 — 쉽게 되돌릴 수 있고 자동 확인 가능한 선택은 맡긴다. 가치 충돌, 큰 영향, 낮은 복구 가능성이 있을 때만 사람을 부른다.」

### A9. 요약은 결정에 필요한 차이를 보존해야 한다

> 충돌, 반대 증거, 소수 가설, 실패 징후는 평균적인 요약에 의해 사라져서는 안 된다.

- 관련 원문: F02 §9 인식적 UI 원칙 3, F04 §8 안티패턴 Summary collapse, F06 §12 금지 3, F07 §10 Context compiler 제약, F09 §16 법칙 8(「정상 반복은 압축하고 Decision을 바꿀 수 있는 차이는 보존한다」).
- 쉬운 원칙 9: 「요약은 중요한 이견을 지우면 안 된다」.

### A10. 작업은 주장된 완료, 수락, 통합을 구분한다

> 에이전트의 완료 선언은 검증 대상이며, 수락된 결과도 전체 시스템과 정합될 때까지 닫히지 않는다.

- 관련 원문: F03 §2 CfA, F05 §4 WorkUnit 상태(ClaimingComplete / Accepted / Integrated), F05 I3·I4·I5, F09 §16 법칙 5·11, F10 최소 법칙 6, P01 §2 「제출 → 결과 확인 → 전체 반영」, P06 MUST NOT 1.
- 쉬운 원칙 8: 「끝냈다는 말과 결과 확인은 다르다」.

### A11. 컨텍스트는 원본 데이터가 아니라 행위자를 위한 시점별 투영이다

> 모든 컨텍스트는 대상, 관심사, 출처, 생성 시각, 무효화 조건을 가져야 한다.

- 관련 원문: F01 §4 ContextProjection(`Context(actor, concern, t) = project(W(t), actor, concern)`), F05 §9 ContextProjection 메타데이터, F05 I7·I10, F07 §5 Projection 불변, F07 §10 Context Compilation, F10 최소 법칙 7.
- [정리] A11의 다섯 속성과 F05 §9 메타데이터 필드 대응: 대상 ↔ `actor`, 관심사 ↔ `concern`(+ `purpose`), 출처 ↔ `source_state_version`, `included_entities`, 생성 시각 ↔ `generated_at`, 무효화 조건 ↔ `invalidation_triggers`, `expires_at`.
- B §3.5는 「A11 투영 규칙」을 P6(10)·P7(12) 담당으로 둔다.

### A12. 자동화가 인간의 이해와 주도성을 지속적으로 낮춘다면 실패다

> 더 빠른 산출이 인간을 수동적인 예외 처리자로 만들거나 복귀 능력을 약화시키면 Helm의 목적에 반한다.

- 관련 원문: F04 §7 자동화 역설 방지 MUST 5, F04 §8 Human as exception handler, F10 최소 법칙 11(「자동화가 사용자의 복귀 능력·예측 가능성·방향 수정 능력을 낮추면 실패로 측정한다」).
- 쉬운 원칙 10: 「자동화가 사람을 더 무력하게 만들면 실패다 — 사용자는 항상 현재 흐름을 이해하고, 예상하고, 바꾸고, 이의를 제기할 수 있어야 한다.」

### A13. 결정과 증거는 시간에 따라 낡는다

> 수락된 사실과 결정에도 유효 범위, 재검토 조건, 대체 관계가 필요하다.

- 관련 원문: F02 §8 시간성과 재검토, F05 Claim 평가 필드(`valid_from`, `review_at`, `invalidation_triggers`), F05 I6·I8·I11, F01 §6 `supersedes`/`invalidates`/`reopens`/`derived_from`, F08 H9, P04 §6.
- 쉬운 원칙: 직접 대응 없음(P04 §6 「시간이 지나면 다시 확인한다」).

### A14. 실패와 이견은 제거할 잡음이 아니라 학습 신호다

> 시스템은 실패 전조와 상충하는 관점을 숨기지 않고 탐구 대상으로 승격해야 한다.

- 관련 원문: F02 §9 원칙 6(「모름을 실패 상태로 숨기지 않고 명시적인 탐구 상태로 표현한다」), F04 §5 Relatedness(「이견과 실패를 비난이 아니라 조정 대상으로 다룬다」), F05 §13 `ConflictDetected` → 별도 Concern, F10 최소 법칙 8(「`unknown`, dissent, counterevidence는 오류 없이 존재할 수 있는 일급 상태다」), P02 §3 「다시 열리는 것은 정상이다」, P05 §6 「`모름`은 실패가 아니라 다음 확인 방법이 있는 정상 상태다」.
- 쉬운 원칙: 직접 대응 없음(원칙 9가 가까움).

### A15. 상호작용은 승인 마찰이 아니라 공동 저작이어야 한다

> 사용자는 단순히 계속/취소를 누르는 사람이 아니라 문제 프레임, 평가 기준, 제약, 대안을 바꾸는 참여자여야 한다.

- 관련 원문: F04 §8 Approval theater, F06 §4 「"진행할까요?" 또는 "A와 B 중 무엇을 원하나요?"만 있는 Gate는 유효하지 않다」, F06 §12 금지 1, F09 §10 Craft and authorship, P05 §4 버튼 표, P07 §3(사용자가 추천 종료 기준 5%를 3%로 바꿔 선택).
- B §3.5는 「A15 선택지」를 P6(10) 담당으로 둔다. B §2.1 #18(「대안 2~3개를 던지고 고르게 하는 상호작용은 거부」, recognition over recall)이 A15의 v0.3 해석이다.

### 5.1 공리와 쉬운 원칙 대응 [정리]

| 쉬운 원칙(P00 §3) | 공리 |
|---|---|
| 1 할 일보다 목표를 먼저 본다 | A1 |
| 2 많이 움직인 것이 진척은 아니다 | A2 |
| 3 처음 요청이 완성된 문제 정의는 아니다 | A3 |
| 4 본 것, 해석한 것, 가능한 설명, 선택을 구분한다 | A5 |
| 5 Agent에게는 일을 맡기고 사람은 방향을 정한다 | A6 |
| 6 자율성은 agent의 등급이 아니라 맡긴 범위다 | A7 |
| 7 사소한 것은 묻지 않고 중요한 차이만 묻는다 | A8 |
| 8 끝냈다는 말과 결과 확인은 다르다 | A10 |
| 9 요약은 중요한 이견을 지우면 안 된다 | A9 (+A14) |
| 10 자동화가 사람을 더 무력하게 만들면 실패다 | A12 |
| (대응 없음) | A4, A11, A13, A15 |

## 6. 10단계 사이클과 작업 흐름

### 6.1 원문 (F00 §2, `docs/foundations/00-manifesto.md`)

「이 시스템은 다음 순환을 반복한다.」

```text
Sense → Frame → Diverge → Investigate → Deliberate
      → Commit → Execute → Assure → Integrate → Reflect
```

- **Sense**: 현재 상황과 변화를 감지한다.
- **Frame**: 무엇이 문제인지, 무엇을 보존해야 하는지 정의한다.
- **Diverge**: 가능한 설명과 해결 방향을 복수로 만든다.
- **Investigate**: 가설을 병렬로 검증하고 반대 증거를 찾는다.
- **Deliberate**: 대안, 기준, 불확실성, 파급 효과를 비교한다.
- **Commit**: 선택을 책임 있는 결정과 위임으로 바꾼다.
- **Execute**: 권한 범위 안에서 현실을 변경한다.
- **Assure**: 결과에 대한 주장과 증거가 충분한지 검토한다.
- **Integrate**: 지역적 결과를 전체 목적과 시스템에 정합시킨다.
- **Reflect**: 경험을 다음 탐구와 통치 규칙에 반영한다.

「이 순환은 일방향 워터폴이 아니다. 새로운 증거는 문제 프레임과 결정을 다시 열 수 있다.」

### 6.2 단계별 입력·출력·조건 [정리]

F00은 각 단계의 한 줄 정의만 준다. 입력·출력·조건은 원전의 다른 절에서 모았다. 괄호 안이 출처다.

| 단계 | 입력 | 출력 | 진입·완료 조건과 규칙 | 루프(F09) |
|---|---|---|---|---|
| 1 Sense | Events, 외부 변화, 도구 출력, 사용자 관찰, 마지막 확인 cursor (F05 §2, F06 §5) | SituationModel, Surprise, WeakSignal, 열린 Concern, Return Brief / Common Operating Picture (F09 §4 O, F05 §11) | 「Events → Situation projection → Perception → Comprehension → Projection」(F09 O). SituationModel은 「사실 그 자체가 아니라 증거를 바탕으로 구성한 해석이므로 출처와 불확실성을 가진다」(F01). episode 시작 「Disturbance or aspiration → Concern opened」(F09 §6) | O |
| 2 Frame | Concern, Purpose, SituationModel | ProblemFrame(복수 경쟁 가능), 성공 기준, 보존 가치, 비목표, 결정 질문 (F01 Purpose·ProblemFrame) | A3: initial prompt를 완성된 ProblemFrame으로 취급하지 않는다(법칙 2). Decision `Open → Framed`: 「결정 질문, 소유자, why-now가 있어야 한다」(F05 §5) | I |
| 3 Diverge | ProblemFrame | HypothesisSet: 가설별 예측, 반증 관찰, 지지·반대 증거, 증거 독립성, 설명 못 한 사실, 다음 실험 (F02 §5) | A4: 병렬성은 가설 다양성에 먼저 쓴다. Hypothesis는 「반증 가능 조건을 포함해야 한다」(F02 §2) | I |
| 4 Investigate | HypothesisSet, Experiment | Evidence(8 품질 차원), Counterevidence, EvidenceLink(`supports`/`challenges`/`qualifies`/`invalidates`), 강화·약화 보고 (F02 §3, §5) | 에이전트는 결론만 보고하지 않고 「어떤 가설을 강화했는가 / 약화했는가 / 구분할 수 없었는가 / 새로운 가설이 필요한가 / 기존 ProblemFrame이 잘못되었는가」 중 하나를 명시(F02 §5). Evidence는 출처·획득 시점이 없으면 검증 증거로 승격 불가(F01 불변 4) | I |
| 5 Deliberate | 대안(현상 유지 포함), 평가 기준, 증거, 불확실성 | Decision Gate(13필드) 또는 정책에 의한 처리, Decision `Deliberating` (F06 §4) | `Framed → AlternativesIdentified`: 「최소 하나의 대안과 현상 유지 대안」, `AlternativesIdentified → Deliberating`: 「평가 기준과 관련 Evidence」(F05 §5). Gate는 F06 §3 조건 하나 이상이 참이고 사용자 입력이 결과를 실질적으로 바꿀 수 있을 때만 생성. 「Decision Gate는 불확실성이 높다는 사실만으로 생성되지 않는다」(F02 §6) | I |
| 6 Commit | 선택, 권한 있는 Actor | Decision `Committed`, DelegationContract, Commitment, WorkUnit `Delegated` (F03 §2~§3, F05 §4·§5·§8) | `Deliberating → Committed`: 「권한 있는 Actor, 선택, 근거, 결과, 재검토 조건이 필요하다」. `Committed → Implementing`: 「하나 이상의 Commitment로 분해」. I1, I2, I6. 흐름 「Decision → Request → Negotiation → Commitment → Authority Envelope → Interdependent execution → Exception/repair」(F09 C) | C |
| 7 Execute | DelegationContract, Authority Envelope, ContextProjection | Material change(Artifact, Run, Test), ExecutionTrace, 도구 Event, Escalation Event (F03, F07 §7) | WorkUnit `InProgress`: 「수행자가 시작 Event 생성」. I9: 「Material mutation links to an authorized WorkUnit or emergency policy.」 통치 불변 1·2·5·6. 권한 밖이면 Inquiry 또는 Decision Gate로 돌아간다(F09 §5) | C |
| 8 Assure | 완료 주장, Evidence obligation | ClaimingComplete, Acceptance(또는 조건부 수락·수정 요청), Assurance View (F05 §4, F02 §10) | I3: 「ClaimingComplete has evidence for every required criterion.」 I4: 「Accepted has an authorized acceptor.」 증명 부담 표(F02 §7). 인식적 완료 조건 6(F02 §10). 통치 불변 4(고위험에서 완료 선언자와 수락자 독립). 같은 주체가 주장과 검증을 하면 독립성 수준 표시(F05 §4) | A |
| 9 Integrate | Accepted Outcome, 통합 대상 | Integration `Pending → ImpactMapped → ConflictsIdentified → Reconciled → Verified → BaselineUpdated`, WorkUnit `Integrated`, 무효화된 Assumption·Context (F05 §10) | I5: 「Integrated has a verified integration target.」 검사 대상 7(F05 §10). I10, I11. 「local completion은 system Integration 전까지 닫히지 않는다」(법칙 11) | A |
| 10 Reflect | Outcome, 실패, 이견, Gate 이력 | Reflection: ProblemFrame, 정책, 자율성 범위, 완료 기준, 컨텍스트 라우팅 규칙 변경 (F01 Reflection) | 「Reflection은 다음 Context, Contract, Policy를 실제로 바꿔야 한다」(법칙 12). 「Reflection이 Gate policy와 Authority Envelope의 미래 기본값을 바꾼다」(F09 §5). WorkUnit `Closed`: 「후속 약속이 없고 회고 가능 / 미해결 obligation 없음」 | A |

[정리] 10단계와 F09 네 루프의 대응: O = Sense, I = Frame~Deliberate, C = Commit~Execute, A(Assurance and Adaptation) = Assure~Reflect. F09는 이 대응을 직접 적지 않았다. F09 §6 episode의 10개 항목과 위 10단계는 순서가 같다(§6.3).

### 6.3 공동행위 episode (F09 §6)

「Helm에서 일의 최소 단위는 Task가 아니라 **Concern을 중심으로 한 공동행위 episode**다.」

```text
Disturbance or aspiration
  → Concern opened
  → Situation oriented
  → Problem framed
  → Hypotheses investigated
  → Decision committed
  → Work delegated
  → Outcome claimed
  → Result accepted
  → System integrated
  → Practice reflected
```

「Task는 episode 안의 실행 수단이다. 하나의 Concern은 여러 WorkUnit을 만들 수 있고, 하나의 WorkUnit은 여러 Concern에 영향을 줄 수 있다.」

### 6.4 쉬운 말 흐름

P00 §2 10단계 사용자 흐름(원문):

```text
현재 상황 이해
  → 목표와 초점 정하기
  → 가능한 설명·해법 비교
  → 중요한 선택하기
  → 할 일과 맡긴 범위 합의
  → agent가 자율적으로 진행
  → 필요한 순간에만 방향 수정
  → 결과와 근거 확인
  → 전체 작업에 반영
  → 다음 작업을 더 잘하도록 학습
```

「이 흐름은 고정된 단계가 아니다. 새 근거가 나오면 문제를 보는 방식이나 이전 선택을 다시 열 수 있다.」

P02 §1 8단계 흐름(원문):

```text
1. 돌아오기
2. 목표와 초점 정하기
3. 문제 관점과 가능성 살펴보기
4. 중요한 선택하기
5. 작업과 맡긴 범위 합의하기
6. 자율 진행과 필요한 방향 수정
7. 결과와 근거 확인하기
8. 전체에 반영하고 다음을 배우기
```

「모든 작업이 여덟 단계를 무겁게 거칠 필요는 없다. 간단하고 되돌리기 쉬운 작업은 여러 단계를 자동으로 압축한다. 중요한 위험과 이견이 있는 작업만 깊게 보여준다.」 P02 단계별 상세는 §17.3.

[정리] 대응:

| F00 10단계 | P00 10단계 | P02 8단계 |
|---|---|---|
| Sense | 현재 상황 이해 | 1 돌아오기 |
| Frame | 목표와 초점 정하기 | 2 목표와 초점 정하기 |
| Diverge + Investigate | 가능한 설명·해법 비교 | 3 문제 관점과 가능성 살펴보기 |
| Deliberate | 중요한 선택하기 | 4 중요한 선택하기 |
| Commit | 할 일과 맡긴 범위 합의 | 5 작업과 맡긴 범위 합의하기 |
| Execute | agent가 자율적으로 진행 + 필요한 순간에만 방향 수정 | 6 자율 진행과 필요한 방향 수정 |
| Assure | 결과와 근거 확인 | 7 결과와 근거 확인하기 |
| Integrate + Reflect | 전체 작업에 반영 + 다음 작업을 더 잘하도록 학습 | 8 전체에 반영하고 다음을 배우기 |

### 6.5 참여 리듬 (네 판본)

| 출처 | 원문 |
|---|---|
| F04 §6 참여의 리듬 | `Briefing → Framing/Delegation → Autonomous interval → Scheduled or exception checkpoint → Evidence review and decision → Autonomous interval → Integration review → Debrief and learning` |
| F06 §9 기본 운영 주기 | `Brief → Delegate → Autonomous interval → Checkpoint/Gate → Continue → Acceptance → Integration → Debrief` |
| F09 §10 기본 리듬 | `Orient → Frame together → Delegate → Autonomous interval → Meaningful checkpoint → Decide/redirect → Accept → Integrate → Reflect` |
| P03 §3 함께 일하는 리듬 | `상황 이해 → 목표·초점 함께 정리 → 작업 합의 → 자율 진행 → 예정된 확인 또는 중요한 예외 → 선택·방향 수정 → 결과 확인 → 전체 반영과 돌아보기` |

F04 §6(원문): 「Helm의 기본 리듬은 지속적인 방해가 아니라 **집중된 공동 작업과 자율 구간의 교대**다.」 사용자가 참여하는 고레버리지 지점(F04 §6 원문): 문제와 목적이 합의되지 않았을 때 / 서로 다른 가설이 결과 방향을 크게 바꿀 때 / 평가 기준이 기술적으로 환원되지 않을 때 / 큰 비용이나 비가역적 효과가 예상될 때 / 에이전트 간 이견이 중요한 정보를 포함할 때 / 결과를 전체 시스템에 받아들일지 판단할 때.

P03 §3 레버리지 큰 순간(원문): 목표와 문제 관점에 따라 경로가 크게 달라질 때 / 무엇이 좋은 결과인지 기술적으로만 정할 수 없을 때 / 비용이나 외부 영향이 크고 되돌리기 어려울 때 / 중요한 이견이나 반대 근거가 있을 때 / agent가 맡긴 범위를 벗어나야 할 때 / 결과와 전체 영향을 받아들일 때.

F06 §9: 「WHO의 수술 체크리스트처럼 Helm은 모든 순간이 아니라 오류 비용이 높은 단계 경계에서 구조화된 pause를 만든다.」 F09 §16 법칙 9: 「중요한 단계 경계에서만 공동 pause를 만든다.」

### 6.6 다시 열림

- F00 §2: 「새로운 증거는 문제 프레임과 결정을 다시 열 수 있다.」
- F09 §5 상호 재진입(원문 6개): Orientation에서 새 Surprise를 발견하면 Inquiry가 열린다 / Inquiry가 Purpose 충돌을 발견하면 Normative baseline을 다시 연다 / Commitment 수행 중 Authority 밖의 문제가 나타나면 Inquiry 또는 Decision Gate로 돌아간다 / Assurance에서 Evidence가 부족하면 새 Experiment WorkUnit을 만든다 / Integration이 shared Assumption 충돌을 발견하면 관련 Decision과 Context를 invalidate한다 / Reflection이 Gate policy와 Authority Envelope의 미래 기본값을 바꾼다.
- P02 §3 「다시 열리는 것은 정상이다」(원문 6개): 새 관찰이 현재 문제 관점과 맞지 않는다 / 중요한 전제가 틀렸음이 확인된다 / 사용자의 목표나 완료 기준이 바뀐다 / agent가 맡긴 범위 밖의 문제를 발견한다 / 결과 확인 중 근거가 부족하다 / 전체 반영 중 다른 작업과 충돌한다. 「Helm은 이 흐름을 실패로 숨기지 않고 `다시 열림`으로 기록한다.」
- F02 §8 재개 조건 6과 P04 §6 재확인 조건 6은 §8.8.

## 7. 존재론 (Ontology)

출처: F01(`docs/foundations/01-ontology.md`, Ontology: Helm에서 무엇이 존재하는가), F05 §2, F09 §3, F10 §4~§5, P06.

### 7.1 존재론적 선택 (F01 §1)

「Helm은 파일, 채팅, 태스크를 세계의 기본 단위로 보지 않는다.」
- 파일은 상태를 표현하는 매체다.
- 채팅은 행위가 발생하는 채널이다.
- 태스크는 더 큰 목적과 약속을 수행하기 위한 한시적 단위다.

「Helm의 기본 단위는 **행위자, 상태, 주장, 약속, 변화, 관계**다.」

F09 §2(철학적 입장, 원문 제목과 요지):
- 2.1 실체보다 관계와 전이: 「Helm의 핵심 객체는 고립된 Task, File, Agent가 아니다. 이들이 Purpose, Evidence, Authority, Commitment, Outcome과 맺는 관계와 시간에 따른 전이가 핵심이다.」
- 2.2 표상보다 실천: 「Context는 세계의 복사본이 아니라 특정 Actor가 특정 Concern에서 올바르게 참여할 수 있게 하는 시점별 projection이다.」
- 2.3 기술보다 실천적 지혜: 「어떤 목적과 위험을 받아들일지, 구체적 상황에서 무엇이 가치 있는지, 언제 충분히 탐구했고 행동해야 하는지는 실천적 판단을 요구한다. Helm은 인간에게 에이전트가 못 하는 잔여 작업을 남기지 않는다. 인간이 실천적 지혜와 저자성을 행사할 **고레버리지 순간**을 설계한다.」
- 2.4 독립성보다 공동행위: 분석 단위 `Human + Agents + Tools + Shared representations + Policies + Environment`.
- 2.5 확실성보다 반증 가능한 정당화: 「Claim, Hypothesis, Decision은 영구 진실이 아니다. 출처, 범위, 불확실성, Counterevidence, reopen trigger를 가진다. 좋은 시스템은 확실해 보이는 결론보다 어떤 조건에서 결론이 바뀌어야 하는지 안다.」

### 7.2 세계 모델의 세 판본

| 판본 | 공식(원문) | 출처 |
|---|---|---|
| 세 세계 | `W(t) = <N(t), E(t), M(t)>` | F01 §2 |
| 다섯 상태 공간 | `W(t) = <N(t), E(t), M(t), A(t), P(t)>` | F05 §2, F09 §3 |
| 세 의미 세계 + 두 통치 평면 (v0.2, D2 수락) | `WorkspaceState(t) = <N(t), E(t), M(t) \| A(t), P(t)>` | F10 C2, §4 |

F10 C2 해설(원문):

```text
N/E/M = 무엇이 현재 성립하는가
A     = 누가 그것을 관찰·주장·수락·변경할 수 있는가
P     = 어떤 전이와 증명 부담이 허용되는가
```

### 7.3 세 세계의 구성원 (판본별 원문 목록)

| 세계 | F01 §2 (v0.1 존재론) | F09 §3 (v0.1 운영 이론) | F10 §4.1 (v0.2) |
|---|---|---|---|
| N — Normative | Purpose, Principle, Policy, Constraint, Authority, Responsibility, Commitment, Decision, AcceptanceCriterion | Purpose, Principle and Constraint, Authority and Responsibility, Decision, Commitment, AcceptanceCriterion | Goal과 success condition, Constraint와 priority, Choice와 review trigger, Work Agreement·authority·responsibility, Result acceptance와 integration obligation |
| E — Epistemic | SituationModel, ProblemFrame, Question, Hypothesis, Claim, Evidence, Counterevidence, Assumption, Uncertainty, ConfidenceAssessment | SituationModel, Observation, ProblemFrame, Hypothesis, Claim, Evidence and Counterevidence, Assumption and Uncertainty | Observation과 source, Interpretation과 Assumption, Possibility/Hypothesis, Finding/Claim, Evidence와 challenging evidence, uncertainty·confidence basis·invalidation trigger |
| M — Material | Artifact, CodeChange, Document, Design, TestResult, Deployment, ExternalState, ExecutionTrace | Artifact, Code and Document, Test and Deployment, ExecutionTrace, ExternalState, Outcome | Artifact와 external state, run·tool action·test·deployment, change와 Outcome, interface·dependency·recovery path |
| A — Actors | (§3 행위자) | HumanActor, AgentActor, ToolActor, CollectiveActor, competence and dependency relations | 통치 평면. 능력: observe, propose, decide within scope, execute action classes, attest evidence, accept result, integrate baseline |
| P — Policies | (N 안의 Policy) | Authority policy, Gate policy, Evidence burden, Context routing, Invalidation and recovery rules | 통치 평면: authority envelope, evidence burden, escalation and pause rule, freshness and invalidation, concurrency and conflict, privacy and disclosure, recovery and compensation |

세계 정의 문장(원문):
- N: 「무엇을 해야 하고, 무엇이 허용되며, 무엇을 받아들이기로 했는가에 관한 세계다.」(F01) / 「무엇을 해야 하고 누가 무엇을 수락했는가.」(F09) / 「해야 하는 것과 수락된 약속」(F10)
- E: 「무엇이 문제이며 무엇을 안다고 믿는가에 관한 세계다.」(F01) / 「알고 있다고 주장하는 것과 아직 모르는 것」(F10)
- M: 「실제로 무엇이 존재하고 어떤 변화가 일어났는가에 관한 세계다.」(F01) / 「실제로 존재하거나 변한 것」(F10)
- A: 「누가 어떤 능력·역할·의존성을 가지는가.」(F09) / 「Actor는 사람, agent, tool, team일 수 있다. 동일한 인격으로 취급하지 않고 다음 능력을 명시한다.」(F10)
- P: 「어떤 상태 전이와 권한·에스컬레이션이 허용되는가.」(F09) / 「Policy는 누가 어떤 조건에서 위 능력을 행사할 수 있는지 평가한다.」(F10)
- F05 §2 요약: `N`: normative graph — 목적, 권한, 결정, 약속 / `E`: epistemic graph — 문제, 가설, 주장, 증거, 불확실성 / `M`: material graph — 산출물, 실행, 테스트, 외부 상태 / `A`: actor graph — 인간, 에이전트, 도구, 팀과 능력 / `P`: policy set — 전이 규칙, 자동 승인, 에스컬레이션 정책.
- F09 §3 끝: 「Helm은 `M`의 task progress만 관리하지 않는다. `N–E–M`의 정렬, `A`의 공동행위, `P`의 적응을 관리한다.」

세 세계 사이 관계(F10 §4.1 원문): 「세 세계는 분리되지만 관계 없이 독립적이지 않다.」

```text
E justifies N        Evidence와 판단이 Choice를 정당화한다.
N authorizes M       Choice와 Work Agreement가 변경을 허가한다.
M updates E          실행 결과가 믿음과 가설을 바꾼다.
M fulfills N         Outcome이 Goal과 약속을 만족시킨다.
```

### 7.4 행위자 (F01 §3)

- **HumanActor**: 「가치, 목적, 책임, 수락의 최종 주체가 될 수 있다. 한 인간이 모든 결정을 직접 해야 한다는 뜻은 아니며, 팀·조직·정책에 권한을 위임할 수 있다.」
- **AgentActor**: 「모델과 도구를 이용하여 탐색, 추론, 제안, 실행, 검증을 수행한다. AgentActor의 운영적 약속은 시스템이 추적할 수 있지만 법적·도덕적 책임의 최종 주체로 간주하지 않는다.」
- **ToolActor**: 「CI, Git, 배포 시스템, 정적 분석기처럼 규칙에 따라 사건과 증거를 생성한다. 목적을 스스로 정하지 않으며 권한이 부여된 호출을 실행한다.」
- **CollectiveActor**: 「팀, 위원회, 정책 엔진처럼 복수 행위자를 하나의 결정 주체로 표현한다. CollectiveActor는 구성원, 의사결정 규칙, 정족수 또는 위임 정책을 명시해야 한다.」

v0.2 A 평면 능력 7(F10 §4.2): observe / propose / decide within scope / execute action classes / attest evidence / accept result / integrate baseline.

### 7.5 핵심 엔터티 (F01 §4, 원문 정의)

- **Concern**: 「주의와 행위가 필요한 가장 일반적인 관심 단위다. Feature보다 넓으며 장애, 연구 질문, 정책 변화, 통합 위험도 Concern이 될 수 있다.」 필수 속성: `id`, `title`, `why_it_matters`, `owner`, `status`, `related_purposes`.
- **Purpose**: 「추구하는 가치 있는 미래 상태다. 단순 목표 문구가 아니라 성공 기준, 비목표, 보존해야 할 가치, 종료 또는 재검토 조건을 가진다.」
- **SituationModel**: 「현재 상태에 대한 시점별 모델이다. 사실 그 자체가 아니라 증거를 바탕으로 구성한 해석이므로 출처와 불확실성을 가진다.」
- **ProblemFrame**: 「현재 상황과 목적 사이에서 해결할 가치가 있다고 선택한 긴장을 정의한다. 동일한 Situation에서도 여러 ProblemFrame이 경쟁할 수 있다.」
- **Hypothesis**: 「문제의 원인, 가능한 미래, 해결책 효과에 대한 반증 가능한 설명이다.」
- **Claim**: 「참으로 받아들이기를 제안하는 명시적 진술이다. Claim은 Evidence와 Argument를 통해 지지되고 Counterevidence로 도전받는다.」
- **Evidence**: 「Claim의 신뢰도를 바꿀 수 있는 관찰 또는 산출물이다. Evidence는 출처, 획득 방법, 시점, 범위, 품질, 관련 Claim을 가진다.」
- **Decision**: 「대안들 중 하나를 선택하여 이후 행위의 규범적 기준선을 변경하는 사건과 그 결과다. Decision은 선택되지 않은 대안, 기준, 근거, 불확실성, 파급 효과, 재검토 조건을 보존한다.」
- **Commitment**: 「행위자가 미래의 조건을 만족시키겠다고 운영적으로 맡은 약속이다. 요청이나 계획과 다르며, 약속 주체·수혜자·만족 조건·기한·철회 규칙을 가진다.」
- **DelegationContract**: 「하나 이상의 Commitment를 권한과 제약에 연결하는 위임 계약이다.」

```text
DelegationContract = {
  requester,
  performer,
  purpose,
  conditions_of_satisfaction,
  authority_envelope,
  evidence_obligations,
  escalation_triggers,
  acceptor,
  integration_target
}
```

- **WorkUnit**: 「DelegationContract를 수행하기 위한 일시적 실행 단위다. Task와 달리 협상, 위임, 완료 주장, 수락, 통합 상태를 구분한다.」
- **Event**: 「누가 언제 무엇을 어떤 근거와 권한으로 변경했는지를 기록하는 불변 사실이다. 현재 상태는 Event의 투영이며, 과거 Event를 조용히 덮어쓰지 않는다.」 (v0.2 C3에서 「불변 기록」으로 고침. §16.2)
- **Outcome**: 「실행 이후 관찰된 실제 변화다. 의도한 산출물뿐 아니라 예상하지 못한 영향과 학습을 포함한다.」
- **ContextProjection**: 「특정 행위자가 특정 Concern에 관해 다음으로 유효한 행동을 하기 위해 필요한 상태의 시점별 투영이다.」 `Context(actor, concern, t) = project(W(t), actor, concern)`. 「ContextProjection은 정본이 아니며 원본 Entity와 Event로 역추적할 수 있어야 한다.」
- **Integration**: 「지역적 Outcome을 더 넓은 목적, 결정 기준선, 산출물 그래프에 정합시키는 과정과 그 결과다.」
- **Reflection**: 「경험을 통해 ProblemFrame, 정책, 자율성 범위, 완료 기준, 컨텍스트 라우팅 규칙을 변경하는 학습 사건이다.」

### 7.6 v0.2의 단위와 새 개념 (F10)

- **Goal**(C7): 「Goal은 workspace 이름표가 아니라 versioned normative entity다.」 상위 Goal과 하위 Goal을 연결할 수 있다 / success condition과 preservation constraint를 가진다 / 수정, 중단, 대체, 달성 주장을 Event로 남긴다 / Goal 변경은 영향받는 Context와 Work Agreement를 invalidate할 수 있다.
- **Concern**(§5): 「사람과 agent의 주의와 판단이 필요한 중요한 상황이다. 문제, 기회, 위험, 불확실성일 수 있다.」
- **WorkUnit**(§5): 「Concern 또는 Goal을 바꾸기 위해 제한된 권한 아래 실행하는 구체적 작업이다.」

```text
Goal
  └─ Concern
       ├─ Inquiry WorkUnit
       ├─ Change WorkUnit
       └─ Integration WorkUnit
```

- 두 단위를 둔 이유(원문): 「`Concern episode` 하나만을 모든 규모에 강제하면 작은 수정에 과도한 형식을 부과한다. 반대로 Task만 사용하면 목적과 판단의 연속성이 사라진다. 따라서 두 단위를 구분한다.」
- 최소 인식 구분(C5, 원문):

```text
Observation — 직접 확인되거나 도구가 측정한 것
Interpretation — Observation의 의미에 대한 추론
Possibility — 아직 비교·검증 중인 설명이나 해법
Finding — 현재 범위에서 수락된 Claim
EvidenceLink — 무엇이 어떤 Claim을 어떻게 지지·반박하는지
Choice — 앞으로의 기준선을 바꾸는 규범적 선택
```

- **LedgerEvent**(C3): 「상태 전이에 대한 관찰·주장·수락의 불변 기록」.
- Kernel이 의미를 가진 엔티티(§3): 「Goal, Concern, Claim, Choice, Work Agreement, Result의 의미」.

### 7.7 F09 루프 primitive와 friendly 확장 개념

F09 §4가 primitive로 쓰지만 F01 §4에 정의가 없는 개념: CommonOperatingPicture, ReturnBrief, Handoff, WeakSignal, HypothesisSet, Experiment, DecisionGate, Request, AuthorityEnvelope, Exception, EscalationTrigger, ClaimingComplete, AssuranceView, Acceptance, Interface, RecoveryPath. P06 확장 대응표가 이 가운데 일부(Handoff, Interface, Conflict, Exception, Surprise, WeakSignal, RecoveryPath)에 제품 이름을 준다(§17.7).

### 7.8 핵심 관계 (F01 §5)

```text
Purpose      --frames-->            Concern
Concern      --is_interpreted_as--> ProblemFrame
ProblemFrame --generates-->         Hypothesis
Hypothesis   --predicts-->          Claim
Evidence     --supports/challenges-> Claim
Claim        --informs-->           Decision
Decision     --authorizes-->        DelegationContract
Actor        --undertakes-->        Commitment
Commitment   --is_executed_by-->    WorkUnit
WorkUnit     --changes-->            Artifact
Outcome      --satisfies/fails-->    Commitment
Integration  --aligns-->             Outcome + Purpose + System
Reflection   --revises-->            Frame/Policy/Model
```

「관계는 단순 링크가 아니라 종류, 생성자, 시점, 근거를 가져야 한다.」

다른 곳의 관계 어휘(원문):
- Evidence–Claim: `supports`, `challenges`, `qualifies`, `invalidates` (F02 §3). 「같은 Evidence가 한 Claim을 지지하고 다른 Claim을 약화할 수 있다.」
- 시간 관계: `supersedes`, `invalidates`, `reopens`, `derived_from` (F01 §6).
- F07 §4 관계 일급 관리 질문: Decision이 어느 Claim과 Evidence에 의존하는가 / WorkUnit이 어느 Purpose와 Commitment를 수행하는가 / Material change가 어느 Authority Envelope에서 발생했는가 / Evidence가 어느 실행·Artifact에서 파생되었는가 / Outcome이 어느 Assumption을 무효화하는가. 「단순 URL이나 문서 경로 링크만으로 관계 의미를 대체하지 않는다.」
- F10 §4.1 세계 간 관계: E justifies N / N authorizes M / M updates E / M fulfills N.

### 7.9 동일성과 시간 (F01 §6)

「Helm의 객체는 이름이나 파일 경로로만 식별되지 않는다.」
- 모든 장기 객체는 안정적인 ID를 가진다.
- 제목, 경로, 설명이 바뀌어도 동일 객체로 추적할 수 있다.
- 과거 상태는 수정하지 않고 후속 Event로 대체 또는 무효화한다.
- `supersedes`, `invalidates`, `reopens`, `derived_from` 관계를 명시한다.
- 삭제는 기본적으로 의미적 폐기이며 감사와 학습에 필요한 이력은 보존한다.

### 7.10 Context와 Memory (F01 §7)

「Raw conversation은 증거 또는 출처가 될 수 있지만 그 자체가 장기 기억은 아니다.」 장기 기억의 구성(원문):
- 수락된 Purpose와 Decision
- 현재 유효한 Constraint와 Policy
- 근거가 연결된 Claim
- 기각되거나 대체된 Hypothesis와 그 이유
- 이행 중인 Commitment
- 검증된 Outcome과 실패
- 재검토 조건과 무효화 사건

「대화와 실행 로그는 이 의미 객체를 생성하는 원자료이며, 의미 객체를 대신하지 않는다.」 F09 §15 표: memory는 Harness `conversation/run history`, Helm `valid Decisions, Evidence, Commitments, Outcomes`.

### 7.11 존재론적 불변조건 (F01 §8, 원문)

1. WorkUnit은 최소 하나의 Purpose 또는 Concern과 연결되어야 한다.
2. Decision은 선택자, 대안, 근거, 시점, 재검토 조건을 가져야 한다.
3. Claim은 Observation, Inference, Hypothesis 중 자신의 인식적 종류를 밝혀야 한다.
4. Evidence는 출처와 획득 시점이 없는 경우 검증 증거로 승격될 수 없다.
5. Commitment는 책임 주체와 만족 조건이 없으면 생성될 수 없다.
6. Outcome은 의도와 분리하여 실제 관찰된 결과를 기록해야 한다.
7. ContextProjection은 정본 Entity와 Event로 역추적 가능해야 한다.
8. Feature, 파일 경로, 에이전트 세션은 핵심 객체의 정체성을 결정하지 않는다.

### 7.12 엔티티 총목록 [정리]

원전에 나오는 모든 개념과 제품 이름(P06·PY)의 대응. "정의 위치"는 정의 문장이 있는 곳이다.

| 원론 개념 | 세계/평면 | 정의 위치 | Product Domain (P06) | 한국어 UI |
|---|---|---|---|---|
| Purpose (v0.2 Goal) | N | F01 §4, F10 C7 | Goal | 목표 |
| Principle | N | F01 §2 목록 | GuidingRule | 기본 원칙 |
| Policy | N(F01) / P(F05·F09·F10) | F10 §4.2 | AutomationRule | 자동화 규칙 |
| Constraint | N | F01 §2 목록 | Boundary | 지켜야 할 조건 |
| Authority | N / A | F03 §4 | DecisionRight | 결정 권한 |
| Responsibility | N | F03 §4 | Responsibility | 책임 |
| Accountability | N | F03 §4 | (P01: 사람 책임자) | 사람 책임자 |
| Commitment | N | F01 §4 | Promise | 약속 |
| Decision (v0.2 Choice) | N | F01 §4, F02 §2, F10 C5 | Choice | 선택 |
| DecisionGate | (Gate) | F06 §4 | ChoiceRequest | 선택 요청 |
| AcceptanceCriterion | N | F01 §2 목록 | ResultCondition | 완료 기준 |
| ReopenTrigger | N | F06 §4 | ReviewTrigger | 다시 볼 조건 |
| EscalationTrigger | N | F03 §3 | HelpTrigger | 도움 요청 조건 |
| DelegationContract (v0.2 Work Agreement) | N | F01 §4, F03 §3 | WorkAgreement | 작업 합의 |
| AuthorityEnvelope | N / P | F03 §5 | AllowedRange | 맡긴 범위 |
| SituationModel | E | F01 §4 | CurrentPicture | 현재 상황 |
| ProblemFrame | E | F01 §4 | ProblemView | 문제 관점 |
| Question | E | F01 §2 목록 | OpenQuestion | 아직 모르는 점 |
| Observation | E | F02 §2, F10 C5 | Observation | 관찰 |
| Inference (v0.2 Interpretation) | E | F02 §2, F10 C5 | Interpretation | 해석 |
| Hypothesis (v0.2 Possibility) | E | F01 §4, F02 §2 | Possibility | 가능성 |
| HypothesisSet | E | F02 §5 | PossibilityComparison | (가능성 비교) |
| Claim (v0.2 Finding = 수락된 Claim) | E | F01 §4, F10 C5 | Finding | 판단 |
| Evidence | E | F01 §4, F02 §3 | Evidence | 근거 |
| EvidenceLink | E | F10 C5 | — | — |
| Counterevidence | E | F01 §2 목록 | ChallengingEvidence | 반대 근거 |
| Assumption | E | F02 §2 | Assumption | 전제 |
| Uncertainty | E | F02 §6 | OpenQuestion | 아직 모르는 점 |
| ConfidenceAssessment | E | F01 §2 목록 | — | — |
| NormativeJudgment | (E 안의 규범 판단) | F02 §2 | — | — |
| Artifact | M | F01 §2 목록 | WorkOutput | 결과물 |
| CodeChange | M | F01 §2 | CodeChange | 코드 변경 |
| Document | M | F01 §2 | Document | 문서 |
| Design | M | F01 §2 | Design | 설계 |
| TestResult | M | F01 §2 | TestResult | 테스트 결과 |
| Deployment | M | F01 §2 | Release | 배포 |
| ExternalState | M | F01 §2 | ExternalState | 외부 상태 |
| ExecutionTrace | M | F01 §2 | RunRecord | 실행 기록 |
| Outcome | M (F09) | F01 §4 | Result | 실제 결과 |
| Interface | M | F09 §4 A, F10 §4.1 | ConnectionPoint | 연결 지점 |
| RecoveryPath | M | F09 §4 A | RecoveryPlan | 복구 방법 |
| HumanActor | A | F01 §3 | Person / HumanOwner | 사람 / 사람 책임자 |
| AgentActor | A | F01 §3 | Agent / AgentDelegate | Agent / Agent 담당 |
| ToolActor | A | F01 §3 | Tool | 도구 |
| CollectiveActor | A | F01 §3 | Team / ReviewGroup | 팀 |
| Acceptor | A | F01 §4 DelegationContract 필드 | Reviewer | 결과 확인자 |
| Concern | (단위) | F01 §4, F10 §5 | Focus | 초점 |
| WorkUnit | (단위) | F01 §4, F10 §5 | Work | 진행 작업 |
| Event (v0.2 LedgerEvent) | (기록) | F01 §4, F05 §3, F10 C3 | ChangeRecord | 변화 기록 |
| ContextProjection | (투영) | F01 §4, F05 §9 | ContextView | 맞춤 상황 |
| ReturnBrief | (투영) | F05 §11, F06 §5 | Brief / SinceLastVisit | 복귀 요약 |
| CommonOperatingPicture | (투영) | F05 §11 | Overview | 전체 상황 |
| InquiryMap | (투영) | F05 §11 | ExploreView | 가능성 비교 |
| Decision Queue, Integration Map, Context Pack, Delegation Board, Assurance View | (투영) | F05 §11, F07 §5 | — | — |
| CompletionClaim / ClaimingComplete | (전이) | F05 §4 | ResultSubmission | 결과 제출 |
| Acceptance / Assurance | (전이) | F09 §4 A | ResultReview | 결과 확인 |
| Integration | (전이) | F01 §4, F05 §10 | WholeUpdate | 전체 반영 |
| Reflection | (전이) | F01 §4 | LearningReview | 돌아보기 |
| Handoff | — | F09 §4 O | Handoff | 이어받기 |
| Conflict | — | F05 §13 | Conflict | 충돌 |
| Exception | — | F09 §4 C | OutsideRange | 맡긴 범위 밖 상황 |
| Surprise | — | F09 §4 I | UnexpectedChange | 예상 밖 변화 |
| WeakSignal | — | F09 §4 O | EarlyWarning | 작은 경고 |
| Request | — | F03 §2, F09 §4 C | — | — |
| Experiment | — | F09 §4 I | — | — |

## 8. 인식론 (Epistemology)

출처: F02(`docs/foundations/02-epistemology.md`, Epistemology: Helm은 무엇을 어떻게 안다고 말하는가), F10 C3·C5·C6, P01 §2, P04 §3.

### 8.1 기본 입장 (F02 §1)

「Helm은 지식을 모델이나 사용자의 머릿속에 저장된 확정적 사실로 취급하지 않는다. 지식은 특정 상황에서 행위를 가능하게 할 정도로 정당화되었지만, 새로운 증거에 의해 수정될 수 있는 잠정적 상태다.」

근거: John Dewey의 실용주의. 「탐구는 불확정한 상황을 더 결정 가능하고 통합된 상황으로 변화시키는 활동이다. 문제와 해결은 처음부터 완성된 입력으로 주어지는 것이 아니라 탐구 과정에서 함께 형성된다.」 [Stanford Encyclopedia of Philosophy: Pragmatism]

Epistemic Engine이 지원하는 것(원문): 무엇이 관찰되었는지 분리한다 / 가능한 설명을 복수로 유지한다 / 어떤 증거가 어느 주장을 지지하거나 반박하는지 연결한다 / 불확실성과 무지를 숨기지 않는다 / 행동하기에 충분한 정당성이 언제 생겼는지 판단한다 / 새로운 증거가 들어오면 이전 결정을 다시 열 수 있게 한다.

### 8.2 인식적 종류 (F02 §2)

「모든 진술은 최소 하나의 종류를 가져야 한다.」

- **Observation**: 「도구 출력, 사용자 관찰, 파일 상태처럼 특정 방식으로 관측된 내용이다. Observation도 측정 오류, 범위, 시점에 제한된다.」
- **Inference**: 「Observation과 다른 Claim에서 논리적·통계적·경험적으로 도출한 해석이다. 추론 방법과 전제를 명시해야 한다.」
- **Hypothesis**: 「현재 증거를 설명하거나 미래 결과를 예측하는 잠정적 모델이다. 반증 가능 조건을 포함해야 한다.」
- **Assumption**: 「현재 검증하지 않았지만 작업을 진행하기 위해 임시로 참으로 취급한 전제다. Assumption은 숨겨진 사실이 아니라 부채이며, 실패 영향과 검증 트리거를 가진다.」
- **NormativeJudgment**: 「무엇이 바람직하거나 수락 가능한지에 대한 판단이다. 사실 주장으로 위장해서는 안 되며 권한 있는 Actor와 가치 기준에 연결한다.」
- **Decision**: 「지식 상태를 서술하는 것이 아니라 이후 행동의 기준선을 정하는 규범적 약속이다. 가장 가능성이 높은 가설을 선택하는 것과 그 가설을 기반으로 행동하기로 결정하는 것은 다르다.」

v0.2 최소 구분(F10 C5)은 Observation / Interpretation / Possibility / Finding / EvidenceLink / Choice 여섯이다(§7.6). P01 §2의 쉬운 판:

| 쉬운 용어 | 뜻 | 예시 |
|---|---|---|
| **관찰** | 직접 보거나 도구로 확인한 것 | 「최근 세 번의 실행에서 같은 오류가 발생했다.」 |
| **해석** | 관찰이 무엇을 뜻하는지 설명한 것 | 「배포 환경의 설정 차이에서 생긴 오류로 보인다.」 |
| **가능성** | 아직 확인 중인 설명 또는 해법 | 「캐시된 이전 설정이 원인일 수 있다.」 |
| **판단** | 현재 근거 안에서 참으로 받아들이는 내용 | 「이 오류는 새 코드보다 환경 설정과 관련이 있다.」 |
| **선택** | 앞으로 무엇을 할지 정한 것 | 「설정 검증을 먼저 추가하고 배포를 다시 진행한다.」 |

「이 구분이 없으면 agent의 그럴듯한 해석이 사실처럼 보이거나, 가장 가능성 높은 설명이 자동으로 행동 결정이 된다.」

### 8.3 증거 모델 (F02 §3)

「Evidence는 파일 첨부나 링크가 아니다. 다음 품질 차원을 가진다.」

| 차원 | 질문 |
|---|---|
| Provenance | 누가 어떤 방법으로 생성했는가? |
| Relevance | 어느 Claim과 결정에 실제로 관련되는가? |
| Directness | 직접 관찰인가, 여러 추론을 거친 간접 자료인가? |
| Reliability | 생성 도구·절차·출처를 얼마나 신뢰할 수 있는가? |
| Freshness | 현재 상태에도 여전히 유효한가? |
| Coverage | 주장 전체를 검증하는가, 일부 조건만 검증하는가? |
| Independence | 다른 증거와 독립적인가, 같은 원천을 반복한 것인가? |
| Falsifiability | 어떤 결과가 이 주장을 틀렸다고 만들 수 있는가? |

「Evidence는 `supports`, `challenges`, `qualifies`, `invalidates` 관계로 Claim에 연결한다. 같은 Evidence가 한 Claim을 지지하고 다른 Claim을 약화할 수 있다.」

P04 §3 쉬운 판(원문 7 질문): 누가 어떤 방법으로 만들었는가? / 어느 판단과 실제로 관련되는가? / 직접 확인한 것인가, 여러 해석을 거친 것인가? / 지금도 최신인가? / 판단 전체를 확인하는가, 일부만 확인하는가? / 다른 근거와 독립적인가? / 어떤 결과가 이 판단을 틀렸다고 만들 수 있는가? 「따라서 Helm은 근거 다섯 개를 근거 하나보다 자동으로 강하다고 표시하지 않는다.」 (Reliability 차원은 P04 목록에 없다.)

### 8.4 주장–논증–증거 (F02 §4)

「테스트 통과는 증거지만 결론 전체는 아니다. Helm은 보증 사례의 구조를 일반화한다.」

```text
Claim: 이 결과는 목적 P의 기준 C를 만족한다.
Argument: C를 하위 조건 C1, C2, C3로 분해했고 각각의 실패 모드를 검토했다.
Evidence: 테스트, 리뷰, 실행 관찰, 사용자 평가가 각 조건을 지지한다.
Counterevidence: 알려진 제한과 실패 사례가 남아 있다.
Conclusion: 범위 R과 기간 T 안에서 수락 가능하다.
```

근거: OMG Structured Assurance Case Metamodel(SACM). 「모든 작업에 형식 보증 사례를 요구하지는 않는다. 증거 구조의 깊이는 위험과 비가역성에 비례해야 한다.」

### 8.5 경쟁 가설 (F02 §5)

「에이전트 병렬 실행의 기본 목적은 단일 결론을 빨리 반복 생성하는 것이 아니라 가설 공간을 넓히는 것이다.」 근거: CIA Analysis of Competing Hypotheses(「합리적인 대안 가설을 명시하고, 각 증거가 어느 가설과 일치하지 않는지 비교하여 확증편향을 줄인다」).

Hypothesis Set이 가지는 것(원문):
- 가설별 예측
- 가설을 반증할 수 있는 관찰
- 현재 지지·반대 증거
- 증거의 독립성
- 아직 설명하지 못한 사실
- 가설을 구분하는 데 정보 가치가 가장 큰 다음 실험

「에이전트는 결론만 보고하지 않고 다음 중 하나를 명시해야 한다.」
- 어떤 가설을 강화했는가
- 어떤 가설을 약화했는가
- 구분할 수 없었는가
- 새로운 가설이 필요한가
- 기존 ProblemFrame이 잘못되었는가

### 8.6 불확실성 (F02 §6)

「Helm은 단일 백분율을 보편적 신뢰도로 사용하지 않는다. 다음 종류를 구분한다.」
- **Aleatory**: 환경의 본질적 변동성
- **Epistemic**: 정보 부족 때문에 줄일 수 있는 불확실성
- **Model**: 문제 프레임이나 인과 모델이 틀릴 가능성
- **Normative**: 이해관계자 가치와 성공 기준의 불일치
- **Execution**: 계획대로 수행되지 않을 가능성
- **Integration**: 지역적 성공이 전체에서 실패할 가능성

「Decision Gate는 불확실성이 높다는 사실만으로 생성되지 않는다. 추가 인간 판단이나 실험이 결과를 바꿀 수 있을 때 생성한다.」

### 8.7 수락 기준과 증명 부담 (F02 §7)

「모든 Claim이 같은 수준의 증명을 요구하지 않는다.」

| 위험 | 기본 증명 부담 |
|---|---|
| 낮고 가역적 | 자동 검사 또는 단일 리뷰 |
| 중간 | 독립 증거 둘 이상 또는 명시적 인간 수락 |
| 높고 파급 범위 큼 | 경쟁 대안, 반대 증거, 실패 모드, 인간 결정 |
| 비가역적·규범적 | 권한 있는 인간/집단의 숙의와 명시적 Commitment |

「증명 부담은 작업 종류가 아니라 실패 비용, 가역성, 관측 가능성, 테스트 가능성에 따라 정한다.」

[정리] 이 표는 F10의 Quick/Guided/Assured와 P04 §2 선택 요청 깊이(가볍게 확인 / 일반적인 선택 / 깊은 검토)에 대응한다. 원문은 이 대응을 명시하지 않는다.

### 8.8 시간성과 재검토 (F02 §8)

```text
Claim:
Proposed → Supported ↔ Contested → Accepted → Stale/Superseded/Rejected

Evidence:
Observed → Qualified → Linked → Revalidated/Stale/Invalidated
```

(F05 §6·§7의 상태 기계는 이와 다르다. §11, §20.2.)

「수락은 영원한 참 선언이 아니다. 다음 조건이 발생하면 Decision 또는 Claim을 다시 연다.」
- 핵심 Assumption이 무효화됨
- 더 직접적이고 신뢰도 높은 반대 증거가 생성됨
- 적용 환경 또는 Artifact가 변경됨
- 목적이나 수락 기준이 변경됨
- 유효 기간이 만료됨
- 통합 과정에서 예상하지 못한 충돌이 발견됨

P04 §6 쉬운 판(원문): 「판단과 근거는 영원히 유효하지 않다. 다음 상황에서 `재확인 필요` 또는 `다시 열림`으로 바뀐다.」 핵심 전제가 틀린 것으로 확인됨 / 더 직접적인 반대 근거가 생김 / 적용 환경이나 결과물이 바뀜 / 목표 또는 완료 기준이 바뀜 / 정한 유효 기간이 끝남 / 전체 반영 중 예상하지 못한 충돌이 발견됨.

### 8.9 인식적 UI 원칙 (F02 §9, 원문)

1. 사실과 해석을 시각적으로 구분한다.
2. 확신도보다 불확실성의 원인과 감소 방법을 먼저 보여준다.
3. 다수 의견 요약에서 소수의 반대 증거를 제거하지 않는다.
4. 추천에는 선택되지 않은 강한 대안과 추천이 바뀌는 조건을 포함한다.
5. 사용자가 출처, 원본 Event, 실행 산출물로 역추적할 수 있어야 한다.
6. 모름을 실패 상태로 숨기지 않고 명시적인 탐구 상태로 표현한다.
7. 에이전트 간 합의는 독립 증거가 아니라 동일 모델·컨텍스트에서 발생한 상관된 판단일 수 있음을 표시한다.

### 8.10 인식적 완료 조건 (F02 §10)

「WorkUnit의 인식적 완료에는 최소한 다음이 필요하다.」
- 만족시켰다고 주장하는 조건
- 그 조건과 연결된 Evidence
- 검증하지 못한 범위
- 남은 Assumption과 Uncertainty
- 알려진 Counterevidence
- 결과가 무효화되는 조건

「에이전트가 "문제가 없습니다"라고 보고하는 것은 이 구조를 만족하지 못한다.」

### 8.11 판단 승격 규칙 [정리]

원전에서 "무엇이 무엇으로 올라가는가"를 정하는 규칙을 모았다.

1. 자동 승격 금지: 「Observation, Interpretation, Possibility, Finding, Choice를 서로 자동 승격하지 않는다.」(F10 최소 법칙 3) Quick profile에서도 「Observation을 Choice로 자동 승격하거나 완료를 수락과 동일시하는 것은 Quick에서도 금지한다.」(F10 §5)
2. 증거 승격 조건: 「Evidence는 출처와 획득 시점이 없는 경우 검증 증거로 승격될 수 없다.」(F01 불변 4) Evidence 상태 `Captured(원본과 출처 확보) → Qualified(방법, 범위, 신뢰도 평가) → Linked(특정 Claim과 관계 설정) → Revalidated(환경 변경 이후에도 유효성 확인)`(F05 §7).
3. Finding의 정의: 「현재 범위에서 수락된 Claim」(F10 C5). P01 판단: 「현재 근거 안에서 참으로 받아들이는 내용」.
4. Claim 상태 진행: `Proposed → UnderInvestigation → Supported / Contested → Accepted / Rejected / Undetermined → Stale / Superseded / Reopened`(F05 §6). 「Claim은 참/거짓 Boolean만 갖지 않는다.」 평가 필드 `support_level`, `scope`, `confidence_basis`, `unresolved_counterevidence`, `valid_from`, `review_at`, `invalidation_triggers`.
5. 증명 부담: 위험 수준에 따른 §8.7 표.
6. 가설 선택과 행동 결정의 분리: 「가장 가능성이 높은 가설을 선택하는 것과 그 가설을 기반으로 행동하기로 결정하는 것은 다르다.」(F02 §2)
7. 의미 품질 상태(F10 C6, 원문):

```text
absent       — 기록 없음
captured     — 원시 입력 존재
structural   — schema와 타입 충족
qualified    — 출처·범위·근거·책임이 평가됨
accepted     — 권한 있는 주체 또는 정책이 기준선으로 수락
contested    — 중요한 반대 근거 또는 이견 존재
stale        — 시간·환경 변화로 재검토 필요
superseded   — 더 새로운 기준선이 명시적으로 대체
```

   「Projection은 `unknown`, `unqualified`, `contested`, `stale`을 blind spot과 risk로 보여야 한다. 낮은 품질의 입력을 조용히 최신 기준선으로 승격해서는 안 된다.」 근거 사례(원문): 로컬 dogfood에서 `summary: ㅇ`, `rationale: ㅁㄴㅇ`, `reopen trigger: ㅁㄴㅇ`인 Decision이 최신 Decision으로 투영되었는데 Brief가 `blind spots: none`을 표시했다. 「필드 존재 여부는 상황 복원 가능성이나 정당화된 상태를 증명하지 않는다.」
8. 기록과 진실의 분리(F10 C3, 원문):

```text
immutable record != true content
observed != interpreted != accepted
accepted != permanently valid
```

9. 에이전트 간 합의는 독립 증거로 세지 않는다(F02 §9 원칙 7). 근거 개수로 강도를 자동 표시하지 않는다(P04 §3).
10. B §2.1 #15(v0.3 결정): 「판단 승격에는 I의 근거 필요」. B §6 용어집: 「판단 (Finding): 근거, 반증 탐색, 구분 확인을 거쳐 승격된 E 레코드」. B §3.5: Claim 스키마(evidence, counterEvidence, counterChecked, 구분 확인).

## 9. 실천론과 거버넌스 (Praxeology and Governance)

출처: F03(`docs/foundations/03-praxeology-and-governance.md`, Praxeology and Governance: 누가 무엇을 어떻게 행하는가), F10 §4.2·§6, P04 §1.

### 9.1 행위의 기본 단위 (F03 §1)

「Helm에서 실행의 기본 단위는 명령이 아니라 **정당한 권한 아래 생성된 Commitment**다.」 「프롬프트는 요청, 질문, 제안, 경고, 수락, 거부 중 무엇인지 불분명할 수 있다. 언어행위론의 관점에서 협업은 정보 교환보다 이런 발화가 만드는 약속과 의무의 상태 변화로 성립한다.」 근거: Terry Winograd, Language/Action Perspective(conversation for action).

### 9.2 Conversation for Action (F03 §2)

```text
Request
  ├─ Reject ───────────────────────────────→ Closed
  ├─ Clarify/Counter ─→ Negotiate ─────────┐
  └─ Accept ───────────────────────────────┤
                                           ↓
                                       Committed
                                           ↓
                                       Performing
                                           ↓
                                  Claiming Satisfaction
                                      ├─ Reject/Correct → Performing
                                      └─ Accept         → Accepted
                                                             ↓
                                                         Integrated
                                                             ↓
                                                           Closed
```

「이 상태기계의 목적은 관료적 절차가 아니라 다음 혼동을 방지하는 것이다.」
- 요청을 합의로 착각
- 계획을 약속으로 착각
- 실행 종료를 완료로 착각
- 완료 주장을 검증된 완료로 착각
- 지역적 수락을 전체 통합으로 착각

### 9.3 Delegation Contract (F03 §3)

「모든 자율 실행은 명시적 또는 정책으로 파생된 Delegation Contract 안에서 수행한다.」

```yaml
delegation_contract:
  requester: human-or-collective-id
  performer: agent-id
  purpose: purpose-id
  work_unit: work-unit-id
  conditions_of_satisfaction:
    - criterion-id
  authority_envelope:
    scopes: []
    allowed_actions: []
    forbidden_actions: []
    resource_limits: {}
    external_side_effects: false
  evidence_obligations: []
  escalation_triggers: []
  acceptor: actor-or-policy-id
  integration_target: concern-or-artifact-id
  review_at: timestamp-or-condition
```

「Contract는 모든 필드를 사람이 직접 입력해야 한다는 뜻이 아니다. Helm이 Purpose, 정책, 과거 결정에서 초안을 생성하고 사용자는 중요한 차이만 확인할 수 있다.」

P06 §3 작업 합의 JSON 예시(원문):

```json
{
  "goal": "새 결제 흐름을 안전하게 출시한다",
  "focus": "모바일 복구 경로",
  "delegate": "agent:mobile-review",
  "humanOwner": "human:product-owner",
  "resultConditions": [],
  "allowedRange": {
    "can": ["read", "test", "local-change"],
    "cannot": ["deploy", "contact-customer"]
  },
  "evidenceNeeded": [],
  "helpTriggers": [],
  "nextCheckpoint": "재현 테스트가 끝날 때"
}
```

v0.2 Work Agreement 관련(원문): Guided profile은 「Work Agreement와 맡긴 범위」를 요구한다. B 용어집의 작업 합의(Agreement): 「목적, 완료 기준, 범위, 금지 행동, 제출할 근거, 멈출 조건」.

### 9.4 권한과 책임의 다섯 구분 (F03 §4)

- **Capability**: 실제로 무엇을 할 수 있는가
- **Permission**: 무엇을 하도록 허용되었는가
- **Authority**: 어떤 범위에서 다른 상태를 규범적으로 변경할 수 있는가
- **Responsibility**: 무엇을 수행하거나 감시할 의무가 있는가
- **Accountability**: 결과에 대해 설명하고 받아들일 최종 책임이 누구에게 있는가

「에이전트가 기술적으로 파일을 삭제할 수 있어도 삭제 권한이 있다는 뜻은 아니다. 사용자가 "알아서 해"라고 말했어도 비가역적 외부 변경까지 포괄적으로 승인한 것으로 확장해서는 안 된다.」 P04 §1: 「Prompt에 "알아서 해"라고 적는 것과 실제 권한을 넓히는 것은 별개다.」

### 9.5 Authority Envelope (F03 §5)

「자율성은 에이전트의 고정 등급이 아니라 WorkUnit별 권한 범위다.」 차원(원문):
- **Scope**: 어떤 Concern, Artifact, 환경에 적용되는가
- **Action class**: 읽기, 제안, 로컬 변경, 배포, 외부 메시지 등
- **Reversibility**: 쉽게 되돌릴 수 있는가
- **Blast radius**: 다른 작업·사용자·시스템에 미치는 범위
- **Observability**: 실행과 결과를 충분히 볼 수 있는가
- **Testability**: 성공과 실패를 자동으로 검증할 수 있는가
- **Uncertainty**: 환경과 결과에 대한 무지가 얼마나 큰가
- **Value sensitivity**: 기술적 기준 외 인간 가치 판단이 필요한가
- **Temporal boundary**: 언제까지 또는 어떤 사건 전까지 유효한가

P04 §1 쉬운 판 「맡긴 범위」(원문 8항목): **대상**(어떤 초점, 파일, 서비스, 환경에서 일하는가?) / **가능한 행동**(읽기, 제안, 로컬 변경, 외부 메시지, 배포 중 무엇이 가능한가?) / **금지된 행동**(무엇은 절대 하지 않는가?) / **되돌리기**(변경을 얼마나 쉽게 원래대로 돌릴 수 있는가?) / **영향 범위**(다른 사용자와 시스템에 어디까지 영향을 주는가?) / **확인 방법**(성공과 실패를 자동으로 확인할 수 있는가?) / **아직 모르는 점**(환경과 결과를 얼마나 알고 있는가?) / **유효 기간**(이 범위는 언제까지 유효한가?). (Value sensitivity는 P04 목록에 없고, 금지된 행동은 F03 §5 차원에 없고 F03 §3 `forbidden_actions`에 있다.)

v0.2 authority 포함 관계(F10 §6, 원문):

```text
RequestedAuthority(next action or Work Agreement)
  ⊆ CurrentAuthorityGrant(actor, WorkUnit)
```

「따라서 "이미 한 번 맡겼다"는 사실만으로 권한이 이어지지 않는다. action/effect/resource/expiry/stop condition 중 하나라도 확대되거나 불명확하면 더 좁은 Agreement를 만들거나 Gate를 연다.」

### 9.6 사용자 개입 필요도 (F03 §6)

「초기 버전에서는 정밀 점수보다 설명 가능한 휴리스틱을 사용한다.」

```text
need_for_human_deliberation increases with:
  stakes
  + irreversibility
  + uncertainty
  + cross-system coupling
  + normative disagreement
  + agent disagreement

need_for_human_deliberation decreases with:
  reversibility
  + observability
  + testability
  + proven policy coverage
```

「이 값은 자동 승인 여부를 결정하는 단일 숫자가 아니라 Gate 생성의 근거다.」 (F09 §8의 판본은 §15.7.)

### 9.7 보충성 및 예외 관리 (F03 §7)

「결정은 가능한 한 문제와 전문성에 가까운 가장 낮은 유능한 수준에서 이루어진다. 상위 사용자는 다음 경우에 개입한다.」
- 하위 권한 범위를 초과함
- 목적 또는 가치가 충돌함
- 여러 Concern의 기준선을 함께 변경함
- 가역성이 낮음
- Evidence가 서로 모순됨
- 정책이 적용되지 않는 새로운 상황임
- 실패의 파급 범위가 임계치를 넘음

근거: 미군 Mission Command(상위 의도와 제약을 명확히 하면서 세부 행동을 분산), FEMA Incident Command System(공통 상황도·목표 관리·통제 범위). 「Helm은 군사적 위계가 아니라 **중앙의 목적 일관성과 지역의 판단 자율성**을 차용한다.」

### 9.8 Decision의 상태와 보존 항목 (F03 §8)

```text
Open
  → Framed
  → AlternativesIdentified
  → Deliberating
  → Committed
  → Implementing
  → Validated
  → Integrated
  → Superseded/Reopened
```

Decision이 보존하는 것(원문 13): decision question / why now / decision owner / alternatives / evaluation criteria / supporting and counterevidence / assumptions and uncertainty / reversibility and blast radius / selected option / consequences / dissent / implementation commitments / review and reopen triggers.

### 9.9 실패·철회·재협상 (F03 §9)

「Commitment는 지켜지거나 실패하는 두 상태만 갖지 않는다.」
- 조건이 불명확하면 재협상할 수 있다.
- 환경이 바뀌면 범위와 기한을 수정할 수 있다.
- 권한 밖의 문제가 발견되면 상향할 수 있다.
- 수행자가 능력 부족을 발견하면 이관할 수 있다.
- 요청자는 가치가 사라지면 철회할 수 있다.
- 부분 결과가 가치 있으면 조건부 수락할 수 있다.

「중요한 것은 변경을 조용히 덮어쓰지 않고 누가 무엇을 왜 바꿨는지 Event로 남기는 것이다.」

### 9.10 통치 불변조건 (F03 §10, 원문)

1. 어떤 자율 실행도 유효한 Authority Envelope를 가져야 한다.
2. 권한 범위는 도구 능력보다 좁거나 같아야 한다.
3. 규범적 판단을 사실 추론으로 위장해서는 안 된다.
4. 완료 선언자와 수락자는 고위험 작업에서 독립적이어야 한다.
5. 비가역적 외부 행위는 명시적 권한 또는 충분히 구체적인 승인 정책을 요구한다.
6. 에이전트는 불확실성이나 권한 초과를 숨기기보다 Escalation Event를 생성해야 한다.
7. Decision의 변경은 기존 결정을 수정하는 대신 supersede/reopen 관계로 남겨야 한다.
8. 인간은 언제든 ProblemFrame, Purpose, Constraint를 재검토할 수 있지만 그 변경의 파급 효과를 확인해야 한다.

### 9.11 v0.2 통치 평면 (F10 §4.2)

- A 능력 7: observe / propose / decide within scope / execute action classes / attest evidence / accept result / integrate baseline.
- P 평가 대상 7: authority envelope / evidence burden / escalation and pause rule / freshness and invalidation / concurrency and conflict / privacy and disclosure / recovery and compensation.
- [정리] B §2.1 #4의 v0.3 능력 정의(원시 행동 read, write, execute, send, spawn, ask + 기록 능력 observe, propose, attest, accept, integrate)는 v0.2 A 능력 7 가운데 observe, propose, attest, accept, integrate를 기록 능력으로 이어받고 `decide within scope`, `execute action classes`를 원시 행동과 정책으로 나눈 형태다.

## 10. 공동 행위 (Co-agency)

출처: F04(`docs/foundations/04-co-agency.md`, Co-agency: 인간과 에이전트가 함께 일한다는 것), F09 §9~§10, P03.

### 10.1 분석 단위 (F04 §1)

「Helm은 인간과 에이전트 중 어느 한쪽을 독립적으로 최적화하지 않는다. 분석 단위는 다음으로 구성된 **Joint Cognitive System**이다.」

```text
Human actors
+ Agent actors
+ Tools and interfaces
+ Shared representations
+ Organizational rules
+ Material environment
```

근거: Hutchins, How a Cockpit Remembers Its Speeds(분산인지). 「그러므로 "에이전트 정확도"가 높아져도 인간이 상태를 이해하지 못하거나 방향을 바꿀 수 없다면 공동 시스템은 개선되지 않은 것이다.」

### 10.2 공동행위의 조건 (F04 §2)

근거: Stanford Encyclopedia of Philosophy, Collective Intentionality. 「Helm의 공동행위는 다음을 요구한다.」
- Shared Purpose: 공동 목적과 성공 기준
- Meshing Plans: 충돌하지 않도록 맞물린 하위 계획
- Mutual Responsiveness: 상황 변화에 서로 반응할 수 있음
- Common Ground: 현재 사실·의도·역할에 대한 충분한 공통 기반
- Repair Capability: 오해와 실패를 탐지하고 복구할 수 있음
- Explicit Commitments: 누가 무엇을 맡았는지 추적 가능함

### 10.3 OPD+C (F04 §3, F09 §9, P03 §2)

근거: Coactive Design(TU Delft) — 「사람과 기계의 독립성을 최대화하기보다 공동 작업에서의 상호의존성을 먼저 분석해야 한다」.

| 기준 | F04 §3 정의(원문) | F09 §9 정의(원문) | P03 §2 쉬운 판(원문) |
|---|---|---|---|
| Observability | 각 참여자가 자신의 다음 행동에 필요한 상대의 상태·의도·변화를 볼 수 있는가? | 다음 판단에 필요한 상태, 의도, Evidence, Exception을 볼 수 있는가? | **볼 수 있다** — 내 다음 판단에 필요한 상태, 근거, 예외를 볼 수 있다. |
| Predictability | 상대의 다음 행동과 그 조건을 충분히 예상할 수 있는가? | 다음 행동과 조건, 예상 Outcome을 충분히 예상할 수 있는가? | **예상할 수 있다** — Agent가 다음에 무엇을 하고 어떤 조건에서 멈출지 알 수 있다. |
| Directability | 상황이 바뀌었을 때 상대의 방향, 우선순위, 권한을 낮은 비용으로 수정할 수 있는가? | 낮은 비용으로 Purpose, Constraint, Criterion, priority를 바꿀 수 있는가? | **바로잡을 수 있다** — 낮은 비용으로 목표, 기준, 우선순위, 맡긴 범위를 바꿀 수 있다. |
| Contestability (Helm 추가) | 상대의 문제 프레임, 주장, 권고, 결정에 이의를 제기하고 근거를 검토하거나 다시 열 수 있는가? | ProblemFrame, Claim, Recommendation, Decision에 이의를 제기하고 Evidence를 다시 열 수 있는가? | **이의를 제기할 수 있다** — Agent의 문제 관점, 판단, 추천에 반대하고 다른 근거나 확인을 요청할 수 있다. |

- F04 §3: 「설명 가능성은 과거 행동의 이유를 보여준다. Contestability는 그 이유와 전제를 바꿀 실질적 권한을 제공한다.」
- F09 §9: 「모든 WorkUnit와 interface는 다음을 평가한다.」 「OPD+C는 persona, 채팅 자연스러움, agent 독립 실행률보다 우선하는 공동행위 평가 기준이다.」
- P03 §2: 「기술 문서의 OPD+C는 사용자 화면에서 다음 네 권리로 표현한다.」 「설명만 볼 수 있고 방향을 바꿀 수 없다면 충분한 통제가 아니다.」

### 10.4 인간 경험: labor, work, action (F04 §4)

근거: Hannah Arendt.
- **Labor**: 반복되고 소비되는 활동. 에이전트 자동화가 우선된다.
- **Work**: 지속되는 산출물을 만드는 활동. 인간과 에이전트가 공동으로 형성한다.
- **Action**: 다른 주체들과 방향·관계·약속을 만드는 활동. 인간 참여가 중심이 된다.

「Helm은 인간에게 단순 반복을 남겨 "일하는 느낌"을 만들지 않는다. 인간이 문제를 다시 보고, 기준을 세우고, 대안을 비교하고, 중요한 형상을 직접 바꾸는 경험을 제공한다.」

### 10.5 좋은 참여 경험 (F04 §5)

근거: Self-Determination Theory. 「즐거운 상호작용은 알림의 수나 게임화로 만들지 않는다.」
- **Autonomy**: 사용자가 문제 프레임과 기준을 바꿀 수 있다 / 시스템 권고를 거부하거나 추가 실험을 요청할 수 있다 / 개입의 타이밍과 깊이를 조절할 수 있다.
- **Competence**: 복잡한 상황이 이해 가능한 구조로 나타난다 / 사용자의 판단이 결과를 어떻게 바꿨는지 피드백된다 / 회고를 통해 사용자의 도메인 지식과 위임 규칙이 축적된다.
- **Relatedness**: 에이전트는 무명 프로세스가 아니라 역할·능력·약속이 있는 협력자로 표현된다 / 인간과 에이전트가 공통 목적과 상황도를 공유한다 / 이견과 실패를 비난이 아니라 조정 대상으로 다룬다.

F09 §10 「좋은 "일하는 경험"의 구조」(원문 6): **Orientation pleasure**(복잡하고 흩어진 상황이 이해 가능한 형태로 정리되는 만족감) / **Inquiry pleasure**(그럴듯한 가설들이 Evidence에 의해 강화·반박되는 탐구의 긴장) / **Leverage**(사용자의 한 번의 좋은 질문과 Criterion 변경이 여러 agent의 방향을 바꾸는 감각) / **Craft and authorship**(완성품을 단순 승인하는 것이 아니라 목적, 형상, trade-off를 공동으로 만든다는 감각) / **Closure**(지역 결과가 전체에 통합되고 남은 위험과 다음 상태가 명확해지는 완결감) / **Growing competence**(반복할수록 사용자의 도메인 이해, 위임 방식, 판단 policy가 실제로 개선되는 감각).

### 10.6 참여의 리듬 (F04 §6)

§6.5에 원문 전체가 있다.

### 10.7 자동화 역설 방지 (F04 §7)

근거: Bainbridge, Ironies of Automation(「자동화가 정상 작업을 제거하면서 인간에게 가장 어렵고 비정상적인 예외만 남길 수 있음」), Endsley와 Kiris, The Out-of-the-Loop Performance Problem(「수동적 감시자로 밀려난 사용자가 상황 인식과 실패 시 복구 능력을 잃을 수 있음」).

「Helm은 이를 방지하기 위해 다음을 MUST로 둔다.」
1. 자율 작업 중에도 사용자가 현재 의도와 예상 경로를 볼 수 있어야 한다.
2. 복귀 시 상태 나열뿐 아니라 의미와 향후 예측을 제공해야 한다.
3. 중요한 방향 선택에 사용자를 참여시켜 능동적 상황 모델을 유지해야 한다.
4. 실패 시 처음부터 로그를 재구성하지 않고 결정·증거·약속의 경로를 따라 복구할 수 있어야 한다.
5. 자동화는 쉬운 시점에서만 편하고 어려운 시점에 추가 인지 부담을 만드는 clumsy automation이 되어서는 안 된다.

### 10.8 공동행위 안티패턴 (F04 §8, P03 §5)

| F04 §8 (원문 이름: 정의) | P03 §5 쉬운 판 (원문) |
|---|---|
| **Silent autonomy**: 무엇을 왜 하고 있는지 드러내지 않은 채 실행한다. | **조용한 자율 실행**: 무엇을 왜 하는지, 다음에 무엇을 할지 알 수 없다. |
| **Approval theater**: 사용자에게 실질적 선택이 없는 승인 버튼을 반복 제공한다. | **보여주기식 승인**: 실질적인 선택 없이 계속/취소만 반복한다. |
| **Summary collapse**: 충돌과 불확실성을 하나의 매끄러운 진행 요약으로 제거한다. | **매끄러운 요약**: 불확실성과 이견을 지워 모든 것이 잘 진행되는 것처럼 보인다. |
| **Agent anthropomorphism**: 에이전트의 운영적 상태를 인간의 책임·감정·도덕성처럼 표현한다. | **사람처럼 꾸민 Agent**: 감정, 책임, 의식을 암시해 capability보다 persona로 신뢰를 얻는다. |
| **Human as exception handler**: 평상시 이해 기회를 제거하고 가장 어려운 실패 순간에만 인간을 호출한다. | **가장 어려울 때만 사람 부르기**: 평소에는 상황을 알 수 없고 실패 순간에만 복잡한 log를 넘긴다. |
| **Independence maximization**: 상호의존성 지원 없이 에이전트가 인간 도움 없이 할 수 있는 범위만 늘린다. | (대응 없음) |
| **Context flooding**: 중요한 차이를 선별하지 않고 모든 로그와 문서를 보여준다. | **정보 전부 보여주기**: 중요도를 구분하지 않고 모든 message와 tool call을 화면에 쏟아낸다. |

### 10.9 Co-agency 불변조건 (F04 §9, 원문)

1. 모든 공동 작업은 공유 Purpose와 역할을 가져야 한다.
2. 각 Actor는 자신의 다음 행동에 필요한 상대의 상태를 관측할 수 있어야 한다.
3. 자율 실행은 예상 경로와 예외 조건을 노출해야 한다.
4. 방향 수정 비용은 작업 진행과 함께 비선형적으로 증가하지 않아야 한다.
5. 사용자는 에이전트의 프레임과 주장을 반박할 수 있어야 한다.
6. 인간 참여는 사소한 승인보다 목적·프레임·대안·수락에 집중해야 한다.
7. 시스템 성능은 인간과 에이전트를 포함한 공동 시스템 수준에서 평가해야 한다.

## 11. 형식 상태 모델 (Formal State Model)

출처: F05(`docs/foundations/05-formal-state-model.md`, Formal State Model). 상태 기계·스키마·불변조건은 원문 그대로다.

### 11.1 목적과 범위 (F05 §1)

「이 문서는 Helm의 개념을 구현 언어와 저장소에 독립적인 상태 모델로 표현한다. 완전한 수학적 명세가 아니라 다음을 가능하게 하는 준형식 모델이다.」
- 객체와 상태의 의미를 구현마다 동일하게 유지
- 유효하지 않은 상태 전이를 검증
- 이벤트 로그에서 현재 상황도를 재생성
- Markdown/YAML, 로컬 데이터베이스, SaaS 저장소 간 이식
- 에이전트가 제안한 변경과 사용자가 수락한 변경을 분리

### 11.2 전체 상태 (F05 §2)

```text
W(t) = <N(t), E(t), M(t), A(t), P(t)>
```

- `N`: normative graph — 목적, 권한, 결정, 약속
- `E`: epistemic graph — 문제, 가설, 주장, 증거, 불확실성
- `M`: material graph — 산출물, 실행, 테스트, 외부 상태
- `A`: actor graph — 인간, 에이전트, 도구, 팀과 능력
- `P`: policy set — 전이 규칙, 자동 승인, 에스컬레이션 정책

「현재 상태는 Event sequence를 투영한 결과다.」

```text
W(t_n) = fold(apply, W(t_0), Events[0..n])
```

v0.2 판: `WorkspaceState(t) = <N(t), E(t), M(t) | A(t), P(t)>` (F10 C2, D2 수락).

### 11.3 Event (F05 §3)

「Event는 이미 발생한 사실이며 수정하지 않는다.」 (v0.2 C3: 「`LedgerEvent`는 상태 전이에 대한 관찰·주장·수락의 불변 기록」으로 고침.)

```yaml
event:
  id: evt_...
  type: claim.proposed
  occurred_at: 2026-01-01T00:00:00Z
  actor: actor_...
  authority_basis: policy_or_decision_id
  concern: concern_...
  subject: claim_...
  payload: {}
  provenance:
    source: run_or_human_input_id
    tool: optional_tool_id
  causation_id: evt_...
  correlation_id: workflow_...
```

Event 불변조건(원문):
1. `id`, `type`, `occurred_at`, `actor`, `subject`는 필수다.
2. 상태를 변경하는 Event는 권한 근거를 가져야 한다.
3. 파생 Event는 원인 또는 상관관계 ID를 가져야 한다.
4. Event는 삭제·수정하지 않고 보정 Event를 추가한다.
5. 외부 도구 결과는 원본 식별자 또는 내용 해시를 보존한다.

원전에 나오는 Event type 이름(원문 그대로): `claim.proposed`(F05 §3 예), `ConflictDetected`(F05 §13), `projection.next_action.proposed`(F10 C4, 현재 코어가 정본 Event로 append하는 문제 사례), `normative.action.proposed`(F10 C4 정제 방향), `epistemic.belief.updated`(F10 C5, 현재 코어가 인식 구분을 압축한 사례), `workspace.initialized`(F10 C7, Purpose가 한 번 저장되는 payload), `normative.decision.committed`(P06 §4 예). 또한 Escalation Event(F03 통치 불변 6), Governance Event(F07 §12).

### 11.4 WorkUnit 상태 기계 (F05 §4)

```text
Proposed
  → Negotiating
  → Delegated
  → InProgress
  → ClaimingComplete
  → Accepted
  → Integrating
  → Integrated
  → Closed
```

보조 전이:

```text
Proposed/Negotiating → Refused
Delegated/InProgress → Blocked
Delegated/InProgress → Suspended
ClaimingComplete     → CorrectionRequired → InProgress
Accepted/Integrating → Reopened
Any non-final        → Cancelled
Any                  → Superseded
```

| 상태 | 의미 | 진입 조건 |
|---|---|---|
| Proposed | 요청 초안 | Purpose 또는 Concern 연결 |
| Negotiating | 조건·범위·권한 협상 중 | 수행자 또는 요청자의 질문/반대 |
| Delegated | 수행 약속 성립 | Delegation Contract 유효 |
| InProgress | 허용 범위 안에서 실행 중 | 수행자가 시작 Event 생성 |
| ClaimingComplete | 만족 조건을 충족했다고 주장 | Evidence obligation 제출 |
| Accepted | 수락 주체가 주장을 승인 | 증명 부담 및 AcceptanceCriterion 충족 |
| Integrating | 전체 기준선과 정합화 중 | 통합 대상과 영향 분석 존재 |
| Integrated | 통합 검증 완료 | 충돌 해결 및 통합 증거 존재 |
| Closed | 후속 약속이 없고 회고 가능 | 미해결 obligation 없음 |

「`ClaimingComplete → Accepted`를 자동화할 수는 있지만 같은 판단 주체가 주장과 검증을 모두 수행한 경우 독립성 수준을 표시해야 한다.」

UI 상태 이름(P01 §5, PY `work_statuses`): proposed 준비 중 / negotiating 범위 확인 중 / delegated 맡김 완료 / in_progress 진행 중 / claiming_complete 결과 확인 필요 / accepted 결과 확인됨 / integrating 전체에 반영 중 / integrated 완료 / blocked 막힘 / correction_required 수정 필요 / suspended 잠시 멈춤 / reopened 다시 열림 / cancelled 취소됨 / superseded 다른 작업으로 대체됨. (Refused, Closed는 UI 이름이 없다.)

### 11.5 Decision 상태 기계 (F05 §5)

```text
Open
  → Framed
  → AlternativesIdentified
  → Deliberating
  → Committed
  → Implementing
  → Validated
  → Integrated
```

예외 전이:

```text
Open..Deliberating → Deferred/Cancelled
Committed..Integrated → Reopened
Any accepted state → Superseded
```

Decision 전이 규칙(원문):
- `Open → Framed`: 결정 질문, 소유자, why-now가 있어야 한다.
- `Framed → AlternativesIdentified`: 최소 하나의 대안과 현상 유지 대안을 포함한다.
- `AlternativesIdentified → Deliberating`: 평가 기준과 관련 Evidence가 있어야 한다.
- `Deliberating → Committed`: 권한 있는 Actor, 선택, 근거, 결과, 재검토 조건이 필요하다.
- `Committed → Implementing`: 하나 이상의 Commitment로 분해되어야 한다.
- `Implementing → Validated`: 선택 결과에 대한 Outcome과 Evidence가 필요하다.
- `Validated → Integrated`: 상위 Purpose 및 인접 Decision과 정합성이 확인되어야 한다.

UI 상태 이름(P01 §5, PY `choice_statuses`): framing 질문 정리 중 / reviewing_options 선택지 검토 중 / choice_needed 선택 필요 / chosen 선택됨 / applying 적용 중 / result_checked 결과 확인됨 / integrated 전체 반영됨.

[정리] Decision 상태와 choice_statuses 대응(원문에 대응표 없음): Open·Framed ↔ framing, AlternativesIdentified ↔ reviewing_options, Deliberating ↔ choice_needed, Committed ↔ chosen, Implementing ↔ applying, Validated ↔ result_checked, Integrated ↔ integrated. Deferred, Cancelled, Reopened, Superseded는 UI 이름이 없다.

### 11.6 Claim 상태 기계 (F05 §6)

```text
Proposed
  → UnderInvestigation
  → Supported / Contested
  → Accepted / Rejected / Undetermined
  → Stale / Superseded / Reopened
```

「Claim은 참/거짓 Boolean만 갖지 않는다. 다음 평가를 별도로 가진다.」 `support_level` / `scope` / `confidence_basis` / `unresolved_counterevidence` / `valid_from` / `review_at` / `invalidation_triggers`.

### 11.7 Evidence 상태 기계 (F05 §7)

```text
Captured → Qualified → Linked → Revalidated
                         ├─ Stale
                         ├─ Invalidated
                         └─ Superseded
```

- Captured: 원본과 출처 확보
- Qualified: 방법, 범위, 신뢰도 평가
- Linked: 특정 Claim과 관계 설정
- Revalidated: 환경 변경 이후에도 유효성 확인

### 11.8 Commitment 상태 기계 (F05 §8)

```text
Draft → Offered → Accepted → Active
                         ├─ Fulfilled
                         ├─ Breached
                         ├─ Renegotiating → Active
                         ├─ Released
                         └─ Transferred
```

「Commitment의 `Fulfilled`는 WorkUnit의 `Integrated`와 동일하지 않다. 수행자가 약속한 산출물을 제공했어도 상위 시스템 통합은 별도 책임일 수 있다.」

### 11.9 ContextProjection 상태 기계 (F05 §9)

```text
Requested → Materialized → Delivered
                       ├─ Refreshed
                       ├─ Invalidated
                       └─ Expired
```

필수 메타데이터:

```yaml
context_projection:
  id: ctx_...
  actor: actor_...
  concern: concern_...
  purpose: resumption | execution | deliberation | review | handoff
  generated_at: timestamp
  source_state_version: event_cursor
  included_entities: []
  omitted_categories: []
  invalidation_triggers: []
  expires_at: optional_timestamp
```

### 11.10 Integration 상태 (F05 §10)

「Integration은 단순 merge가 아니다.」

```text
Pending
  → ImpactMapped
  → ConflictsIdentified
  → Reconciled
  → Verified
  → BaselineUpdated
```

검사 대상(원문): Purpose 및 AcceptanceCriterion 충족 / 인접 Decision과 정책 충돌 / Artifact 의존성과 인터페이스 / 다른 WorkUnit의 Assumption 무효화 / ContextProjection과 문서의 갱신 필요 / 관측되지 않은 외부 효과 / 롤백 및 복구 가능성.

### 11.11 핵심 파생 뷰 (F05 §11)

- **Common Operating Picture**: 현재 Purpose, 열린 Concern, 활성 Commitment, 위험, 이견, 다음 Gate를 보여준다.
- **Return Brief**: 특정 cursor 이후 Normative/Epistemic/Material 변화와 그 의미를 요약한다.
- **Inquiry Map**: ProblemFrame, Hypothesis, Claim, Evidence, 실험을 연결한다.
- **Decision Queue**: 인간 판단의 기대 가치와 긴급도에 따라 열린 Gate를 정렬한다.
- **Integration Map**: 지역 Outcome이 상위 Purpose, Decision, Artifact에 미치는 영향을 표시한다.

### 11.12 전역 불변조건 (F05 §12)

「아래 조건을 위반하는 Event는 거부하거나 명시적 예외 Decision을 요구한다.」

```text
I1  Active WorkUnit has valid DelegationContract.
I2  DelegationContract authority is within requester's authority.
I3  ClaimingComplete has evidence for every required criterion.
I4  Accepted has an authorized acceptor.
I5  Integrated has a verified integration target.
I6  Committed Decision has alternatives, rationale, and reopen trigger.
I7  ContextProjection references a reproducible source state.
I8  Superseding entity links to the entity it replaces.
I9  Material mutation links to an authorized WorkUnit or emergency policy.
I10 Normative baseline changes invalidate affected projections.
I11 Evidence invalidation re-evaluates dependent Claims and Decisions.
I12 Closed WorkUnit has no unresolved obligations hidden beneath it.
```

### 11.13 충돌과 동시성 (F05 §13)

「복수 에이전트 환경에서 파일 충돌보다 의미 충돌을 먼저 다룬다.」
- 같은 Artifact를 변경하지만 목적과 계약이 양립하면 조정 가능한 실행 충돌이다.
- 다른 Artifact를 변경해도 같은 Assumption이나 Decision을 상반되게 바꾸면 규범·인식 충돌이다.
- 동일 기준선에 대한 동시 변경은 조용히 last-write-wins 하지 않는다.
- 충돌은 `ConflictDetected` Event와 별도 Concern을 생성한다.
- 해결은 `Decision` 또는 명시된 정책으로만 기준선을 갱신한다.

### 11.14 저장 형식 독립성 (F05 §14)

「이 상태 모델은 다음 표현 모두에 매핑될 수 있어야 한다.」 Markdown/YAML local-first workspace / SQLite 또는 embedded graph / 서버 이벤트 로그와 관계형 projection / Git 기반 변경 이력 / 외부 agent runtime의 session/run metadata. 「표현 방식이 상태 의미와 전이 규칙을 바꾸어서는 안 된다.」

## 12. 상호작용 헌법 (Interaction Constitution)

출처: F06(`docs/foundations/06-interaction-constitution.md`, Interaction Constitution).

### 12.1 목적 (F06 §1)

「이 문서는 Helm이 사용자에게 언제, 왜, 어떤 형태로 개입을 요청할 수 있는지 정의한다. UI 컴포넌트 목록이 아니라 인간의 주의력과 저자성을 보호하는 헌법이다.」

### 12.2 기본 권리 (F06 §2, 원문 7)

- **목적을 알 권리**: 모든 실행은 어떤 Purpose와 Concern에 기여하는지 설명할 수 있어야 한다.
- **상태를 복원할 권리**: 시간이 지난 뒤에도 원본 로그를 처음부터 읽지 않고 현재 상황, 의미, 향후 경로를 이해할 수 있어야 한다.
- **전제를 볼 권리**: 추천과 결정에 사용된 핵심 Assumption, Evidence, Counterevidence를 볼 수 있어야 한다.
- **방향을 바꿀 권리**: 진행 중인 작업의 ProblemFrame, 우선순위, Constraint, Authority Envelope를 수정할 수 있어야 한다.
- **이의를 제기할 권리**: 에이전트의 Claim과 Recommendation을 반박하고 대안 가설 또는 추가 실험을 요청할 수 있어야 한다.
- **침묵할 권리**: 시스템은 사소하고 가역적이며 검증 가능한 선택으로 사용자를 방해하지 않아야 한다.
- **근거 있는 수락을 할 권리**: 결과를 승인할 때 무엇을 수락하며 무엇이 여전히 불확실한지 알 수 있어야 한다.

### 12.3 개입 요청의 허용 조건 (F06 §3)

「Helm은 다음 중 하나 이상이 참이고, 사용자의 입력이 결과를 실질적으로 바꿀 수 있을 때만 능동 Gate를 생성해야 한다.」
1. 가치 또는 목적이 충돌한다.
2. 문제 프레임에 따라 이후 경로가 크게 갈린다.
3. 비가역적이거나 외부 파급 효과가 큰 행동이다.
4. 현재 Authority Envelope를 벗어난다.
5. 에이전트·증거·이해관계자 사이에 중요한 이견이 있다.
6. 추가 정보의 가치보다 바로 결정할 가치가 높다.
7. 결과 수락 또는 전체 통합을 위한 규범적 약속이 필요하다.
8. 재검토 조건이 충족되어 기존 Decision을 다시 열어야 한다.

「다음 경우에는 기본적으로 Gate를 생성하지 않는다.」
1. 되돌리기 쉽고 자동 검증 가능한 로컬 구현 선택
2. 이미 승인된 정책과 패턴이 명확히 적용되는 경우
3. 사용자가 선택해도 결과가 사실상 달라지지 않는 경우
4. 단순 진행 보고
5. 에이전트가 스스로 해결할 수 있는 정보 부족

P03 §4 「선택 요청을 만들지 않을 때」(원문 6): 쉽게 되돌릴 수 있는 로컬 선택 / 자동 확인이 가능한 반복 행동 / 이미 합의된 규칙이 정확히 적용되는 경우 / 사용자의 답이 결과를 바꾸지 않는 질문 / agent가 스스로 조사해 해결할 수 있는 정보 부족 / 단순 진행 보고.

### 12.4 Decision Gate 계약 (F06 §4)

「모든 Decision Gate는 다음 필드를 MUST로 제공한다.」

```text
Question          지금 무엇을 결정해야 하는가?
Why now           왜 지금 결정이 필요한가?
Purpose           어떤 상위 목적과 연결되는가?
Options           현상 유지를 포함한 실질적 선택지는 무엇인가?
Criteria          무엇을 기준으로 비교하는가?
Evidence          각 선택을 지지·반박하는 증거는 무엇인가?
Uncertainty       무엇을 아직 모르며 결정에 어떤 영향을 주는가?
Consequences      지역 및 전체 시스템 영향은 무엇인가?
Reversibility     되돌릴 수 있는가? 비용은 얼마인가?
Recommendation    시스템은 무엇을 왜 권하는가?
Alternative       결정 대신 어떤 실험·위임·연기가 가능한가?
Commitment        선택 시 누가 무엇을 맡게 되는가?
Reopen trigger    언제 이 결정을 다시 검토하는가?
```

「"진행할까요?" 또는 "A와 B 중 무엇을 원하나요?"만 있는 Gate는 유효하지 않다.」

[정리] Gate 13필드와 P05 선택 요청 고정 표현 8(지금 정할 것 / 왜 지금인가 / 추천 / 다른 선택 / 핵심 근거 / 아직 모르는 점 / 되돌릴 수 있나 / 다시 볼 조건)의 대응: Question↔지금 정할 것, Why now↔왜 지금인가, Recommendation↔추천, Options·Alternative↔다른 선택, Evidence·Criteria↔핵심 근거, Uncertainty↔아직 모르는 점, Reversibility↔되돌릴 수 있나, Reopen trigger↔다시 볼 조건. Purpose, Consequences, Commitment는 고정 표현에 없다(P02 §2-4에는 「미뤘을 때의 영향」이 있다). P06 §3 선택 요청 JSON 키: `goal`, `focus`, `question`, `whyNow`, `options`, `recommendation`, `evidence`, `challengingEvidence`, `openQuestions`, `reversibility`, `reviewTrigger`.

### 12.5 Return Brief 계약 (F06 §5)

「Return Brief는 사용자의 마지막 확인 cursor 이후 변화만 보여주되, 의미를 재구성할 충분한 배경을 포함한다.」
- **Situation**: 현재 최상위 목적과 작업 단계 / 긴급한 위험과 막힘 / 사용자의 판단을 기다리는 항목
- **Changes**: Normative(Decision, Constraint, Commitment의 변화) / Epistemic(강화·약화된 Hypothesis, 새 Evidence와 이견) / Material(변경된 Artifact, 테스트, 배포, 외부 상태)
- **Assessment**: 변화가 왜 중요한가 / 어떤 기존 가정이 깨졌는가 / 목표 달성 가능성과 위험이 어떻게 달라졌는가
- **Projection**: 개입하지 않을 경우 예상되는 다음 행동 / 가까운 시점의 결정과 통합 위험 / 방향을 바꿀 수 있는 마지막 저비용 지점
- **Recommendation**: 사용자가 지금 해야 할 가장 가치 있는 행동 / 지금 읽지 않아도 되는 항목

근거: AHRQ SBAR. 「Return Brief는 단순 로그 요약이 아니라 책임과 상황 모델의 이전을 지원한다.」 P05 고정 표현: 돌아온 뒤 달라진 점 / 왜 중요한가 / 그대로 두면 / 지금 선택이 필요함 / 지금 읽지 않아도 됨.

### 12.6 Inquiry Interaction (F06 §6)

「사용자는 Inquiry Map에서 다음 행위를 할 수 있어야 한다.」 ProblemFrame을 분기하거나 합치기 / 새 Hypothesis를 제안하기 / Evidence 관계에 이의를 제기하기 / 숨겨진 Assumption을 승격하기 / 구분력이 높은 다음 실험을 선택하기 / 불확실성이 충분히 줄지 않아도 행동하기로 결정하기 / 탐구 중단 비용과 기대 정보 가치를 비교하기. 「에이전트가 생성한 가설 수를 늘리는 것보다 사용자가 가설 간 핵심 차이를 이해하고 조작할 수 있는지가 중요하다.」

### 12.7 Delegation Interaction (F06 §7)

「위임 화면은 수행 목록보다 다음을 우선한다.」 intent and purpose / conditions of satisfaction / scope and exclusions / allowed and forbidden actions / evidence obligations / escalation triggers / expected next checkpoint / current confidence and blockers. 「사용자는 자연어로 위임하더라도 Helm이 추출한 Contract의 중요한 모호성만 확인한다. 모든 필드를 수동 폼으로 채우게 해서는 안 된다.」

### 12.8 Integration Review (F06 §8)

「Integration Review는 코드 diff만 검토하지 않는다.」 어떤 Purpose와 Decision을 구현했는가 / 어떤 Assumption이 실제 결과로 검증되거나 깨졌는가 / 다른 WorkUnit의 전제를 무효화했는가 / 정책·문서·테스트·운영 상태가 함께 갱신되었는가 / 지역 최적화가 전체 품질을 떨어뜨리는가 / 수락 이후 남는 Known Limitation은 무엇인가.

### 12.9 상호작용 리듬과 운영 모드 (F06 §9)

기본 운영 주기: §6.5. 「사용자가 선택할 수 있는 운영 모드」(원문):
- **Explore**: 가설 다양성과 학습 우선
- **Build**: 수락된 방향의 구현과 증거 생성 우선
- **Stabilize**: 위험, 회귀, 통합, 복구 가능성 우선
- **Incident**: 짧은 통제 범위와 빈번한 상황 갱신 우선
- **Reflect**: 결과보다 모델·정책·학습 갱신 우선

「모드는 고정 워크플로우가 아니라 Gate 임계치와 ContextProjection을 조정한다.」 (B §2.1 #3의 v0.3 모드 정의와 다르다. §20.3.)

### 12.10 주의력 예산 (F06 §10)

「Workspace와 사용자는 명시적 또는 추론된 Attention Budget을 가질 수 있다.」

```yaml
attention_policy:
  preferred_review_windows: []
  maximum_active_gates: 3
  interrupt_only_for:
    - authority_violation
    - irreversible_action
    - critical_risk
  batch_low_urgency_until: timestamp
  detail_preference: concise | balanced | deep
```

「Gate 우선순위는 단순 긴급도가 아니라 다음을 고려한다.」 결정 지연 비용 / 인간 입력이 결과를 개선할 기대 가치 / 남은 저비용 방향 전환 시간 / 다른 WorkUnit이 이 결정에 의존하는 정도 / 사용자가 맥락을 재구성하는 비용.

### 12.11 즐거움의 설계 (F06 §11)

「Helm은 생산성을 게임화하지 않는다. 다음 경험을 통해 즐거움을 만든다.」 복잡한 상황이 이해 가능한 구조로 정리되는 만족감 / 직접 세운 기준이 결과에 반영되는 저자성 / 좋은 질문과 판단이 여러 에이전트의 방향을 바꾸는 레버리지 / 가설이 증거로 강화·반박되는 탐구의 긴장 / 지역적 결과가 하나의 전체로 통합되는 완결감 / 반복할수록 자신의 위임 방식과 전문성이 개선되는 유능감. 「사용자의 행동이 결과에 미친 영향을 사후에 명확히 보여줘야 한다.」

### 12.12 금지되는 상호작용 (F06 §12, 원문)

1. 실질적 선택이 없는 승인 요청
2. 모든 진행 Event를 실시간 알림으로 전환
3. 추천만 강조하고 반대 증거를 숨김
4. 사용자가 보지 않은 상태 변경을 이미 합의된 것으로 표현
5. Confidence 숫자로 근거의 품질을 대체
6. Context 부족을 긴 원문 덤프로 해결
7. 사용자 개입 이후 그 영향과 후속 Commitment를 보여주지 않음
8. 동일 질문을 여러 에이전트가 중복 요청
9. 에이전트의 감정·의식·책임을 암시하여 신뢰를 유도
10. 사용자의 침묵을 고위험 결정의 암묵적 승인으로 해석

### 12.13 선택 요청의 깊이 (P04 §2)

- **가볍게 확인**: 작고 되돌리기 쉽고 자동 확인 가능한 작업. 항목: 무엇을 할지 / 예상 결과 / 되돌리는 방법.
- **일반적인 선택**: 방향이나 결과 품질에 의미 있는 차이가 있을 때. 항목: 지금 정할 것과 왜 지금인지 / 추천과 다른 선택 / 기준과 핵심 근거 / 아직 모르는 점 / 다시 볼 조건.
- **깊은 검토**: 큰 비용, 외부 영향, 낮은 복구 가능성, 가치 충돌이 있을 때. 항목: 경쟁하는 선택과 현상 유지 / 지지·반대 근거 / 실패 방식과 영향 범위 / 이해관계자와 결정 권한 / 복구 방법과 명시적 수락.
- 「위험하다는 이유만으로 모든 정보를 보여주지 않는다. 사용자의 판단을 바꿀 수 있는 차이를 우선한다.」

## 13. 아키텍처 불변조건 (Architecture Invariants)

출처: F07(`docs/foundations/07-architecture-invariants.md`, Architecture Invariants).

### 13.1 아키텍처의 역할 (F07 §1)

「Helm의 기술 아키텍처는 Foundations의 의미를 보존하는 수단이다. 특정 데이터베이스, UI 프레임워크, 에이전트 SDK가 제품 존재론을 결정해서는 안 된다.」 동시에 만족해야 할 요구(원문 8): 로컬 프로젝트에서 단독 사용 가능 / 여러 에이전트와 실행기를 교체 가능하게 연결 / 시간 간격과 세션 경계를 넘어 상태 복원 / 인간의 결정과 에이전트 주장을 구분 / 원본 Event와 근거까지 추적 / 역할과 Concern별로 다른 ContextProjection 생성 / 팀·조직 수준의 협업과 감사로 확장 / Markdown/YAML 기반 현재 사용자 경험과 점진적 호환.

### 13.2 논리 계층 (F07 §2)

```text
┌────────────────────────────────────────────┐
│ Experience Layer                           │
│ Brief · Inquiry · Decision · Integration   │
├────────────────────────────────────────────┤
│ Attention & Governance Engine              │
│ Gate · Authority · Escalation · Policy     │
├────────────────────────────────────────────┤
│ Normative Domain                           │
│ Purpose · Decision · Commitment            │
├────────────────────────────────────────────┤
│ Epistemic Domain                           │
│ Problem · Hypothesis · Claim · Evidence    │
├────────────────────────────────────────────┤
│ Material Domain                            │
│ Artifact · Run · Test · External State     │
├────────────────────────────────────────────┤
│ Event Ledger & Projection Runtime          │
│ Identity · Provenance · Time · Derivation  │
├────────────────────────────────────────────┤
│ Agent / Tool / Storage Adapters            │
│ Codex · Claude · Git · CI · Markdown       │
└────────────────────────────────────────────┘
```

「계층은 배포 단위가 아니라 의미 경계다. 초기 구현은 하나의 로컬 프로세스여도 된다.」

### 13.3 Event Ledger (F07 §3)

MUST(원문):
- 중요한 상태 변화는 append-only Event로 기록한다.
- Event는 Actor, 시점, 주체, 권한 근거, 출처를 가진다.
- 보정과 취소는 기존 Event 수정 대신 새로운 Event로 표현한다.
- 현재 상태와 UI는 Event에서 재구성 가능한 projection이어야 한다.
- 외부 시스템 Event의 중복 수집은 idempotent해야 한다.

SHOULD(원문):
- 로컬 환경에서 사람이 읽을 수 있는 export를 제공한다.
- Git commit, agent run, CI job 등 외부 식별자를 보존한다.
- Event schema version과 migration 경로를 제공한다.

### 13.4 Domain Graphs (F07 §4)

「Normative, Epistemic, Material graph는 논리적으로 분리하되 관계를 일급으로 관리한다.」 질문 5개는 §7.8. 「단순 URL이나 문서 경로 링크만으로 관계 의미를 대체하지 않는다.」

### 13.5 Projection Engine (F07 §5)

「Projection은 정본 상태를 특정 소비 목적에 맞게 압축한다.」

필수 projection(원문 8): Common Operating Picture / Return Brief / Context Pack / Inquiry Map / Decision Queue / Delegation Board / Assurance View / Integration Map.

불변조건(원문):
- 각 projection은 생성에 사용한 Event cursor를 가진다.
- 중요 원본으로 drill-down할 수 있다.
- 누락 기준과 압축 정책을 설명할 수 있다.
- 관련 Normative baseline이 바뀌면 stale 또는 invalidated 상태가 된다.
- projection 간 데이터 불일치는 정본 충돌이 아니라 projection bug로 취급한다.

### 13.6 Attention & Governance Engine (F07 §6)

「이 계층은 알림 시스템이 아니다. 다음을 수행한다.」 Authority Envelope 검증 / Decision Gate 필요성 평가 / 유사 Gate 병합 / 주의력 예산에 따른 배치와 인터럽트 / 정책 기반 자동 승인과 인간 에스컬레이션 / 재검토 조건 감시 / 중요한 이견과 반대 증거 보존. 「Gate 결정 근거는 사용자가 검토할 수 있어야 한다. 초기에는 학습된 불투명 점수보다 규칙과 설명 가능한 휴리스틱을 우선한다.」

### 13.7 Agent Runtime Adapter (F07 §7)

「Helm은 특정 에이전트 런타임을 제품 코어와 결합하지 않는다.」

Adapter의 책임(원문): Delegation Contract를 에이전트별 지시 형식으로 변환 / 실행 수명주기와 도구 호출 Event 수집 / Artifact change와 Evidence 연결 / 권한 밖의 요청 차단 또는 에스컬레이션 / 에이전트 결과를 ClaimingComplete로 변환 / 취소, 일시중지, 방향 수정 지원.

Adapter가 수행하지 않는 책임(원문): Purpose의 정당성 결정 / Evidence 없이 완료 수락 / 전역 Decision 기준선의 임의 변경 / 다른 Adapter의 상태를 정본으로 덮어쓰기.

v0.2의 adapter protocol과 지원 수준은 §16.9.

### 13.8 Storage Strategy (F07 §8)

OSS kernel(원문): 「초기 오픈소스 커널은 local-first를 기본으로 한다.」 embedded database 또는 event file / 사람이 읽을 수 있는 Markdown/YAML export / Git과 함께 사용할 수 있으나 Git을 유일한 상태 저장소로 강제하지 않음 / 오프라인에서도 핵심 탐구·위임·결정 기능 사용 가능 / 공개 schema와 adapter protocol.

SaaS layer(원문): 「SaaS는 로컬 커널이 제공하기 어려운 협업·조직 기억을 담당한다.」 복수 사용자 권한과 책임 / 팀 Common Operating Picture / 실시간 Gate와 handoff / 조직 정책 및 승인 규칙 / 장기 Evidence·Decision graph / 감사, 분석, 비교 실험 / 여러 workspace를 가로지르는 학습. 「오픈소스를 기능 제한된 데모로 만들지 않는다. 개인 사용의 핵심 가치는 OSS에 남고, SaaS는 협업과 거버넌스에서 가치가 커져야 한다.」

### 13.9 현재 Docs-Agent OS와의 매핑 (F07 §9)

| v0 구조 | 유지할 가치 | 차세대 해석 |
|---|---|---|
| `state/current.yaml` | 빠른 복귀와 전역 상황 | Common Operating Picture projection |
| `state/checkpoints/` | 세션 간 handoff | Return Brief의 export |
| `references/` | 배경 자료와 제약 | Source/Evidence registry |
| `features/` | 코드·제품 영역별 작업 허브 | Concern/Artifact scope의 한 종류 |
| `features/*/current.md` | 지역 작업 상태 | WorkUnit/Concern projection |
| `decisions/` | 판단 근거 보존 | Normative graph의 human-readable view |
| agent fragments | 진입 프로토콜 | Runtime adapter bootstrap |
| scaffold/instance 분리 | 사용자 데이터 보호 | schema/template과 workspace state 분리 |

변경 원칙(원문):
1. 기존 파일을 즉시 정본 데이터베이스로 마이그레이션하지 않는다.
2. 새 모델을 sidecar Event와 projection으로 실험한다.
3. v0 파일을 읽는 importer와 새 상태를 Markdown으로 내보내는 exporter를 분리한다.
4. 실험에서 가치가 확인된 Entity와 Event만 안정 schema로 승격한다.
5. 사용자 소유 문서는 자동 덮어쓰지 않는다.

### 13.10 Context Compilation (F07 §10)

「에이전트에게 전체 문서 트리를 읽게 하지 않고 WorkUnit별 ContextProjection을 컴파일한다.」

```text
Inputs:
  Purpose + Concern + DelegationContract
  + active Decisions/Constraints
  + relevant Claims/Evidence
  + Artifact neighborhood
  + current risks and open conflicts

Output:
  minimal sufficient context
  + source links
  + omitted categories
  + invalidation triggers
```

「Context compiler는 토큰 최소화만 최적화하지 않는다. 의사결정에 중요한 차이와 반대 증거의 보존을 제약 조건으로 둔다.」

### 13.11 의미적 동시성 제어 (F07 §11)

「Git merge conflict만으로 다중 에이전트 충돌을 탐지할 수 없다.」 추적할 의미적 lease 또는 변경 의도(원문): 변경하려는 Decision/Constraint / 의존하는 Assumption / 변경 대상 Artifact와 인터페이스 / 예상하는 Outcome / 현재 Authority Envelope. 「두 작업이 다른 파일을 수정해도 같은 Decision을 상반되게 해석하면 충돌이다. 반대로 같은 파일을 수정해도 목적과 변경이 양립하며 검증 가능하면 조정할 수 있다.」

### 13.12 보안과 안전 (F07 §12)

MUST(원문):
- 최소 권한을 WorkUnit 단위로 적용한다.
- 외부 부작용과 데이터 공개는 별도 Action class로 다룬다.
- Prompt 내용과 실행 권한을 분리한다.
- 민감한 원본 Evidence가 projection과 SaaS로 유출되지 않도록 정책을 적용한다.
- 감사 Event 자체의 무결성과 Actor identity를 보호한다.

SHOULD(원문):
- 샌드박스·승인·롤백 메커니즘을 Adapter capability로 표준화한다.
- 위험한 Action은 dry-run과 영향 미리보기를 제공한다.
- 정책 위반을 에이전트 실패가 아니라 Governance Event로 기록한다.

### 13.13 기술 비목표 (F07 §13, 원문)

- 처음부터 완전한 분산 이벤트 소싱 플랫폼 구축
- 모든 문서를 지식 그래프로 자동 변환
- 범용 프로젝트 관리 데이터 모델 복제
- 특정 모델 공급자의 세션 구조를 Domain model로 채택
- 의미적 판단을 모두 LLM 분류에 의존
- 모든 상태를 실시간 동기화해야만 동작하도록 설계

### 13.14 아키텍처 결정 평가 질문 (F07 §14, 원문)

「새 기능이나 기술을 도입하기 전에 다음을 묻는다.」
1. 어느 Foundation 공리에서 필요한가?
2. Normative/Epistemic/Material 중 어떤 상태를 다루는가?
3. 정본인가 projection인가 adapter인가?
4. 어떤 Event와 불변조건이 필요한가?
5. 인간의 상황 인식과 directability를 높이는가?
6. 사용자의 주의력을 어디서 절약하고 어디에 더 쓰게 하는가?
7. 실패했을 때 원본 근거와 상태를 복구할 수 있는가?
8. 특정 모델·도구 없이도 의미가 유지되는가?

### 13.15 실행 중인 vertical slice (F07 §15)

`docs/architecture/helm-system-v0.md`에 기록. 패키지(원문): `packages/helm-core`(Event ledger, 의미 명령, projection, Git adapter) / `packages/helm-server`(local HTTP/SSE transport) / `packages/helm-sdk`(attached client contract) / `packages/helm-cli`(local/attached CLI와 server launcher) / `apps/helm-web`(같은 core projection을 사용하는 GUI). 「이 구현은 Foundations의 완성이나 stable schema 선언이 아니다. 구현 coverage와 미구현 invariant를 architecture 문서에 함께 기록하고, resumption dogfood의 promotion gate를 통과한 Event만 안정 계약 후보로 삼는다.」

## 14. 반증 가능 가설 (Falsifiable Hypotheses)

출처: F08(`docs/foundations/08-falsifiable-hypotheses.md`, Falsifiable Product Hypotheses).

주의: 원문에는 가설이 **H1~H10 열 개** 있다. B §3.4(16번 문서)는 「H1~H8」이라고 적었다. 설계에서는 열 개 모두를 다룬다(§20.3).

### 14.1 목적 (F08 §1)

「Foundations는 철학적 선언만으로 정당화되지 않는다. 각 핵심 원리는 실제 사용에서 관찰 가능한 가설로 번역되어야 한다. 결과가 가설을 지지하지 않으면 기능을 미세 조정하는 데 그치지 않고 원론과 제품 정의를 수정한다.」

### 14.2 비교 기준선 (F08 §2)

「초기 실험은 최소한 다음 세 조건을 비교한다.」
- **Chat baseline**: 일반 에이전트 채팅과 실행 로그만 사용
- **Structured docs baseline**: 현재 Docs-Agent OS 스캐폴드 사용
- **Helm prototype**: 의미 객체, Return Brief, Gate, Delegation Contract 사용

「가능하면 같은 사용자, 유사 난이도 작업, 동일 에이전트 모델을 사용한다.」

### 14.3 가설 H1~H10 (F08 §3, 원문)

**H1. Return Brief는 복귀 비용을 줄이고 상황 인식을 높인다**
- 예측: 24시간 이상 지난 뒤 현재 목적·위험·진행 이유를 파악하는 시간이 감소한다 / 사용자가 다음 행동과 예상 결과를 더 정확히 설명한다 / 원본 로그를 다시 읽는 비율이 감소한다.
- 지표: `time-to-situational-awareness` / `goal/risk/next-state recall accuracy` / `raw-log fallback rate` / `incorrect intervention rate`
- 반증: 요약을 읽어도 사용자가 원본 로그를 거의 항상 다시 읽는다 / 빠르게 복귀하지만 중요한 이견이나 위험을 더 자주 놓친다.

**H2. Delegation Contract는 조용한 방향 이탈과 허위 완료를 줄인다**
- 예측: scope와 완료 기준의 재협상 시점이 빨라진다 / 에이전트의 완료 주장 이후 대규모 재작업 비율이 감소한다 / 권한 밖 행동과 숨겨진 Assumption이 더 일찍 드러난다.
- 지표: `late scope correction rate` / `claimed-complete rejection rate` / `unauthorized action rate` / `acceptance-without-rework rate`
- 반증: Contract 작성 비용이 절약된 재작업 시간보다 크다 / 사용자가 대부분의 필드를 형식적으로 승인한다.

**H3. 경쟁 가설 구조는 조기 수렴을 줄이고 결과 품질을 높인다**
- 예측: 첫 번째 그럴듯한 해법의 무비판적 구현이 감소한다 / 핵심 Assumption과 Counterevidence 발견률이 높아진다 / 고복잡도 작업에서 최종 결과의 설계 결함이 감소한다.
- 지표: `hypothesis diversity` / `discriminating experiment count` / `counterevidence coverage` / `post-integration design defect rate`
- 반증: 가설 수만 늘고 최종 판단 품질이나 시간 대비 가치가 개선되지 않는다.

**H4. 위험 적응적 Gate는 고정 승인보다 주의력 효율이 높다**
- 예측: 중요한 결정의 인간 개입률은 유지 또는 증가한다 / 사소한 승인 요청은 감소한다 / 결정당 인간 시간 대비 결과 품질이 높아진다.
- 지표: `gate precision and recall` / `false escalation rate` / `missed consequential decision rate` / `human minutes per consequential decision` / `interruption recovery time`
- 반증: 사용자가 Gate를 무시하거나 일괄 승인한다 / 중요한 문제가 Gate 없이 지나가는 비율이 허용 수준을 넘는다.

**H5. Observability–Predictability–Directability–Contestability는 신뢰 보정보다 유용하다**
- 예측: 사용자는 에이전트 정확도를 과신하거나 과소 사용하지 않고 상황별로 더 적절히 의존한다 / 방향 수정 비용과 자동화 surprise가 감소한다 / 설명을 읽는 것보다 실제 이의 제기와 수정 행동이 증가한다.
- 지표: `prediction accuracy of agent next action` / `redirection latency and cost` / `automation surprise count` / `contested-and-improved outcome rate` / `trust calibration`
- 반증: 상태 노출이 정보 과부하만 증가시키거나 사용자의 행동을 바꾸지 않는다.

**H6. 세 세계 모델은 통합 누락을 줄인다**
- 예측: 코드가 완료됐지만 목적·결정·문서가 갱신되지 않은 상태를 더 잘 탐지한다 / 새로운 Evidence가 기존 Decision을 무효화하는 상황을 더 빨리 발견한다 / 서로 다른 파일에서 발생한 의미 충돌을 Git 충돌 전에 발견한다.
- 지표: `normative/material drift incidents` / `stale decision detection time` / `semantic conflict detection rate` / `escaped integration defect rate`
- 반증: 세 그래프의 유지 비용이 높지만 기존 체크리스트보다 탐지력이 개선되지 않는다.

**H7. ContextProjection은 전체 문서 읽기보다 효율적이고 안전하다**
- 예측: 에이전트 입력 토큰과 탐색 시간이 감소한다 / 중요 Constraint 누락과 오래된 정보 사용이 감소한다 / 역할별로 더 적절한 정보 밀도를 제공한다.
- 지표: `context token cost` / `relevant-context precision/recall` / `stale-context failure rate` / `task reorientation time`
- 반증: 압축 과정에서 중요한 반대 증거가 반복적으로 누락된다 / 사용자가 안전을 위해 항상 전체 문서 읽기를 강제한다.

**H8. 의미 있는 인간 참여는 산출물 품질과 경험을 함께 높인다**
- 예측: 사용자 개입이 있는 작업의 목적 적합성과 수락률이 높다 / 사용자는 더 많은 시간을 쓰지 않으면서 결과 소유감과 유능감을 더 크게 느낀다 / 장기 사용에서 에이전트 작업을 이해하지 못한다는 불안이 감소한다.
- 지표: `outcome fitness score` / `user-rated agency, competence, ownership` / `accepted-without-rework` / `total human attention time` / `continued voluntary use`
- 반증: 품질 상승 없이 사용자 시간과 피로만 증가한다 / 사용자가 공동 작업보다 결과만 받기를 지속적으로 선호한다.

**H9. Decision과 Evidence의 재검토 트리거는 장기 맥락 부패를 줄인다**
- 예측: 변경된 환경에서 오래된 결정이 조용히 재사용되는 비율이 감소한다 / 근거가 사라진 정책과 컨텍스트를 더 빨리 무효화한다.
- 지표: `stale decision reuse rate` / `time-to-reopen after invalidating event` / `obsolete constraint incidents`
- 반증: 트리거가 과도한 재검토와 알림을 만들지만 실제 결정을 바꾸지 않는다.

**H10. 통합을 별도 상태로 두면 지역 최적화가 감소한다**
- 예측: WorkUnit별 성공 이후 발견되는 시스템 수준 충돌이 감소한다 / 통합 책임과 기준이 명확해진다.
- 지표: `post-acceptance integration failure rate` / `unowned integration obligation count` / `time from accepted to integrated`
- 반증: Accepted와 Integrated의 구분이 단순 상태 관료주의로 남는다.

[정리] 가설별 측정에 필요한 원천 기록(원문에 없음, 16 문서 작성 참고): H1 = 복귀 시각, Brief 열람, 원본 로그 drill-down, 개입 정정 / H2 = scope 변경 시점, ClaimingComplete 후 CorrectionRequired, 권한 밖 시도 / H3 = HypothesisSet 크기, 실험 수, Counterevidence 링크 수, 통합 후 결함 / H4 = Gate 생성·응답·결과 변경 여부, Gate 없이 지난 중요 결정 / H5 = 다음 행동 예측 질문 결과, 방향 수정 지연, surprise 기록, 이의 후 개선 / H6 = N/M 불일치 탐지, stale Decision 탐지 시간, 의미 충돌 탐지 / H7 = 컨텍스트 토큰, 누락 Constraint, stale context 실패 / H8 = 사용자 평가, 사람 시간, 자발적 재사용 / H9 = stale Decision 재사용, 무효화 후 reopen 시간 / H10 = Accepted→Integrated 시간, 소유자 없는 통합 obligation.

### 14.4 질적 연구 (F08 §4)

「수치 지표만으로 "일하는 경험"을 판단하지 않는다. 다음 순간을 관찰하고 인터뷰한다.」 하루 이상 지난 뒤 작업으로 돌아오는 순간 / 에이전트 결과가 서로 충돌하는 순간 / 사용자가 에이전트 권고를 거부하는 순간 / 완료 주장을 신뢰하거나 의심하는 순간 / 문제를 재정의하는 순간 / 여러 결과를 전체 프로젝트에 받아들이는 순간 / 사용자가 깊이 몰입하거나 피로해지는 순간.

인터뷰 질문(「선호보다 실제 사건을 중심으로 한다」): 마지막으로 방향을 잃었다고 느낀 정확한 순간은 언제였는가? / 어떤 정보를 다시 찾느라 시간을 썼는가? / 어느 결정에 더 일찍 참여했다면 결과가 달라졌을까? / 어느 질문은 시스템이 묻지 말았어야 했는가? / 어떤 에이전트 주장을 무엇 때문에 믿거나 믿지 않았는가?

### 14.5 실험 순서 (F08 §5)

- **Phase A — Paper/Wizard-of-Oz**: 실제 에이전트 런타임을 바꾸지 않고 사람이 Return Brief, Inquiry Map, Decision Gate를 수동 생성한다. UI 가치와 정보 구조를 먼저 검증한다.
- **Phase B — Sidecar prototype**: 기존 agent run과 Git/CI Event를 수집하여 Helm projection을 생성한다. 실행 권한은 건드리지 않는다.
- **Phase C — Delegation adapter**: Delegation Contract를 에이전트 프롬프트와 권한 정책으로 변환하고 ClaimingComplete를 수집한다.
- **Phase D — Closed-loop governance**: 위험 적응적 Gate, 자동 승인, 재검토 트리거, 통합 상태를 활성화한다.

### 14.6 중단 및 피벗 기준 (F08 §6)

「다음이 반복되면 현재 제품 정의를 좁히거나 수정한다.」 일반 Kanban + chat summary가 상황 인식에서 동등한 성능을 보임 / 사용자가 의미 객체 대신 원본 대화만 지속적으로 선호함 / Gate precision이 낮아 approval theater가 됨 / ContextProjection이 재작업이나 토큰 비용을 유의미하게 줄이지 못함 / 경쟁 가설 절차가 복잡도만 늘리고 설계 결함을 줄이지 못함 / 세 세계 모델 유지 비용이 통합 오류 감소보다 큼 / 사용자 참여가 품질 향상 없이 피로만 증가시킴.

### 14.7 초기 성공 기준 (F08 §7)

「첫 번째 프로토타입이 성공하려면 최소한 다음을 보여야 한다.」
1. 사용자가 하루 뒤 5분 이내에 목표·위험·다음 결정을 정확히 복원한다.
2. 중요한 Gate의 다수가 실제 방향 또는 기준을 바꾼다.
3. 에이전트 완료 주장과 인간 수락 사이의 결함이 구조적으로 드러난다.
4. ContextProjection이 전체 문서 읽기보다 적은 비용으로 중요 제약을 보존한다.
5. 사용자가 결과 소유감과 상황 이해가 이전 방식보다 높다고 평가한다.

「수치는 파일럿 이후 기준선을 측정하여 보정한다. 검증 전에 임의의 절대 목표를 제품 성공의 증거로 사용하지 않는다.」

## 15. 운영 이론 (Operating Theory)

출처: F09(`docs/foundations/09-operating-theory.md`, Helm Operating Theory). Working name 「Steered Co-agency — 지향적 공동행위론」, Status 「grand synthesis v0.1」, Purpose 「철학, 인지, 통치, 상호작용, 시스템 아키텍처를 하나의 제품 운영 이론으로 연결」.

### 15.1 중심 명제와 철학적 입장

§3.1, §3.3, §7.1에 원문이 있다(F09 §1, §2).

### 15.2 다섯 상태 공간 (F09 §3)

`W(t) = <N(t), E(t), M(t), A(t), P(t)>`. 구성원 목록은 §7.3 표의 F09 열. 「Helm은 `M`의 task progress만 관리하지 않는다. `N–E–M`의 정렬, `A`의 공동행위, `P`의 적응을 관리한다.」 v0.2에서 A·P를 통치 평면으로 분리했다(C2, D2).

### 15.3 네 운영 루프 (F09 §4)

| 루프 | 목표(원문) | 흐름(원문) | 핵심 primitive(원문) | 핵심 질문(원문) | 연구 근거 |
|---|---|---|---|---|---|
| **O — Orientation** | 행위자가 현재 상황에 다시 참여할 수 있는 인식 상태를 만든다. | `Events → Situation projection → Perception → Comprehension → Projection` | CommonOperatingPicture, ReturnBrief, ContextProjection, Handoff, WeakSignal | 무엇이 변했는가? / 왜 중요한가? / 개입하지 않으면 무엇이 일어나는가? / 누가 무엇을 맡고 있는가? | `../research/bundles/situation-recovery-and-deliberative-inquiry.md` |
| **I — Inquiry** | 불확정 상황을 행동 가능한 문제와 정당화된 선택으로 변환한다. | `Surprise → Problem frames → Hypotheses → Evidence → Discriminating experiment → Deliberation → Decision` | Concern, ProblemFrame, HypothesisSet, Evidence, Claim, Experiment, DecisionGate | 우리는 무엇을 문제로 보고 있는가? / 어떤 합리적 대안 설명이 있는가? / 어느 Evidence가 가설을 실제로 구분하는가? / 추가 정보와 지금 행동 중 어느 쪽 가치가 큰가? | (같은 묶음) |
| **C — Commitment** | 선택을 유효한 약속과 제한된 자율 실행으로 변환한다. | `Decision → Request → Negotiation → Commitment → Authority Envelope → Interdependent execution → Exception/repair` | Request, DelegationContract, Commitment, AuthorityEnvelope, WorkUnit, Exception, EscalationTrigger | 누가 무엇을 왜 맡았는가? / 무엇을 스스로 결정할 수 있는가? / 완료는 어떤 Evidence로 주장해야 하는가? / 어떤 조건에서 방향을 바꾸거나 상향해야 하는가? | `../research/bundles/delegated-action-and-integration.md` |
| **A — Assurance and Adaptation** | 지역 결과를 책임 있게 수락·통합하고 다음 변화에 대응할 능력을 높인다. | `Completion Claim → Evidence/Argument → Acceptance → Integration → Outcome → Monitor/Learn/Anticipate → Reopen or policy update` | ClaimingComplete, AssuranceView, Acceptance, Interface, Integration, RecoveryPath, Reflection | 왜 이 결과를 받아들여도 되는가? / 명세대로 만들었는가와 올바른 것을 만들었는가를 모두 확인했는가? / 다른 작업의 전제와 기준선을 깨뜨렸는가? / 환경이 바뀌면 어떻게 복구하고 결정을 다시 열 것인가? | (같은 묶음) |

O 루프 흐름의 Perception → Comprehension → Projection은 상황 인식의 세 수준이다[정리, 원문은 근거 문서 링크만 둠].

### 15.4 네 루프의 결합 (F09 §5)

「네 루프는 순차 pipeline이 아니다.」

```text
                   ┌───────────────┐
              ┌───→│ O: Orientation│───┐
              │    └───────────────┘   │
              │                         ↓
        Outcome/Event             ┌────────────┐
              ↑                   │ I: Inquiry │
              │                   └────────────┘
              │                         ↓
     ┌───────────────────┐      ┌───────────────┐
     │ A: Assurance &    │←─────│ C: Commitment │
     │    Adaptation     │      └───────────────┘
     └───────────────────┘
```

상호 재진입 예 6개는 §6.6.

### 15.5 작업의 최소 단위

§6.3 episode.

### 15.6 규범적 비대칭

§4.1.

### 15.7 개입 산법 (intervention calculus, F09 §8)

「Helm은 개입 횟수를 최대화하거나 최소화하지 않는다. 인간 입력의 기대 가치가 attention cost보다 클 때 개입한다.」

```text
Deliberation pressure increases with:
  normative conflict
  + stakes
  + irreversibility
  + uncertainty reducible by human judgment
  + cross-system coupling
  + meaningful dissent
  + low recoverability

Deliberation pressure decreases with:
  clear policy coverage
  + reversibility
  + observability
  + testability
  + proven local competence
```

「이는 안정 수식이 아니라 설명 가능한 Gate rationale이다. 실제 weight는 pilot 전 확정하지 않는다.」

개입해야 하는 순간(원문 8): Purpose와 가치가 충돌함 / ProblemFrame에 따라 전체 경로가 갈림 / 핵심 가설을 구분할 실험을 선택함 / 비가역적 외부 행동 직전 / Authority Envelope를 초과함 / 중요한 dissent 또는 weak signal이 존재함 / Completion Claim을 수락함 / 지역 결과를 전체 baseline에 통합함.

개입하지 말아야 하는 순간(원문 5): 되돌리기 쉽고 자동 검증 가능한 local choice / 정책이 명확히 다루는 반복 행동 / 실질적 선택이 없는 진행 확인 / agent가 스스로 해결할 수 있는 정보 부족 / 사용자의 답이 결과를 바꾸지 않는 approval theater.

[정리] F03 §6 판과 비교: F09 판은 `uncertainty`를 `uncertainty reducible by human judgment`로 좁히고, `normative disagreement`·`agent disagreement`를 `normative conflict`·`meaningful dissent`로 바꾸고, `low recoverability`를 더했다. 감소 요인에 `proven local competence`를 더하고 `proven policy coverage`를 `clear policy coverage`로 바꿨다.

### 15.8 OPD+C (F09 §9)

§10.3 표.

### 15.9 좋은 일하는 경험과 기본 리듬 (F09 §10)

§10.5와 §6.5.

### 15.10 아키텍처의 필연적 도출 (F09 §11)

| 계층 | 왜 필요한가(원문) |
|---|---|
| 11.1 Event Ledger | 상태 덮어쓰기보다 시간적 전이와 책임을 보존 / Decision, Commitment, Evidence의 provenance 제공 / projection 재생성과 invalidation 지원 |
| 11.2 Normative Graph | Purpose, Authority, Decision, Commitment, Acceptance 연결 / agent가 어느 기준선과 권한으로 행동했는지 추적 |
| 11.3 Epistemic Graph | ProblemFrame, Hypothesis, Claim, Evidence, Counterevidence 연결 / 요약에서 사라지는 불확실성과 dissent 보존 |
| 11.4 Material and Interface Graph | Artifact, run, test, deployment, external state와 실제 Outcome 추적 / local completion과 system integration 구분 |
| 11.5 Projection Runtime | 같은 정본 상태에서 역할·Concern·시점별 Context 생성 / Return Brief, Common Operating Picture, Inquiry Map, Assurance View 제공 |
| 11.6 Attention and Governance Engine | Authority 검증 / normal variation 감쇠와 consequential difference 증폭 / Gate 병합·우선순위·attention budget 관리 / Decision reopen과 Evidence invalidation 감시 |
| 11.7 Agent and Tool Adapters | 특정 모델의 session 구조를 product ontology와 분리 / DelegationContract를 실행 지시와 permission으로 변환 / run 결과를 Claim과 Evidence로 수집 |

### 15.11 제품 성숙도 모델 (F09 §12)

| Level | 이름 | 구성(원문) | 가치(원문) |
|---|---|---|---|
| 0 | Passive Docs Scaffold | 문서 라우팅과 checkpoint, 현재 Docs-Agent OS | context continuity (한계: semantic state와 interaction loop 부재) |
| 1 | Situation Recovery | Event capture, Return Brief, role-specific ContextProjection | 시간 간격 이후 orientation |
| 2 | Deliberative Inquiry | ProblemFrame, Hypothesis, Evidence, Decision Gate | 조기 수렴 감소와 근거 있는 사용자 판단 |
| 3 | Bounded Delegation | Commitment, DelegationContract, AuthorityEnvelope, Exception | 목적 일관성과 자율 실행의 결합 |
| 4 | Assured Integration | Claim–Evidence acceptance, semantic interface, Integration state | local completion을 전체 결과로 변환 |
| 5 | Adaptive Institution | Reflection, policy revision, cross-workspace learning, organizational memory | 작업할수록 공동 시스템 자체가 개선 |

「각 Level은 앞 Level의 사용자 가치를 검증한 뒤 진행한다. 기술 기반을 먼저 완성했다고 상위 성숙도가 달성되는 것은 아니다.」 (B §3.5의 「성숙도 L1~L5」는 이 모델 또는 v0.3의 루프 성숙도를 가리킨다. 원전의 모델은 Level 0~5다.)

### 15.12 첫 제품 경계 (F09 §13)

「첫 실제 제품은 Level 1과 Level 2에 집중한다.」
- MUST: 기존 agent workflow의 read-only Event 수집 또는 수동 입력 / Return Brief / ContextProjection with provenance/freshness / Inquiry Map / Decision Gate / 최소 Decision/Evidence/Commitment log
- SHOULD: paper prototype에서 검증된 필드만 자동 생성 / 사용자가 Frame, Criterion, Recommendation을 수정 가능 / 중요 source까지 drill-down / Gate impact feedback
- NOT YET: 전체 조직 governance / 자동 권한 확대 / formal assurance case everywhere / graph database dependency / 모든 agent tool 통합 / fully autonomous orchestration

### 15.13 OSS와 SaaS의 철학적 경계 (F09 §14)

- OSS kernel: 「개인이 자신의 작업 현실과 결정 기록을 소유하고 검토할 수 있어야 한다.」 local-first Event and Entity model / human-readable export / adapter protocol / Return Brief, Inquiry, Decision의 핵심 가치 / offline and tool-independent operation.
- SaaS: 「복수 사람과 workspace 사이의 공동 상황, 권한, 조직 기억에서 가치가 커진다.」 team Common Operating Picture / shared Decision and Gate / organizational policy and expertise routing / long-term Evidence/Decision graph / audit, analytics, cross-project learning.
- 「SaaS는 개인의 핵심 판단 도구를 인질로 삼지 않고 협업의 복잡성을 해결해야 한다.」

### 15.14 Harness와 Helm의 차이 (F09 §15)

| 질문 | Harness | Helm |
|---|---|---|
| 최적화 대상 | prompt-to-result completion | justified progress under attention |
| 기본 단위 | task/run | Concern episode and Commitment |
| 인간 역할 | requester/reviewer/exception handler | normative author and co-inquirer |
| agent 역할 | autonomous executor | bounded epistemic/material actor |
| context | model input | role-specific projection of shared state |
| progress | activity/completion | alignment, uncertainty reduction, integration |
| decision | internal reasoning or approval | explicit normative baseline transition |
| completion | agent result/test pass | Claim → Acceptance → Integration |
| memory | conversation/run history | valid Decisions, Evidence, Commitments, Outcomes |
| failure | task error | breakdown of inquiry, authority, coordination, assurance |

### 15.15 원론의 열두 법칙 (F09 §16, 원문)

1. Purpose 없는 WorkUnit은 실행하지 않는다.
2. Initial prompt를 완성된 ProblemFrame으로 취급하지 않는다.
3. Observation, Inference, Hypothesis, Decision을 혼합하지 않는다.
4. 병렬성은 같은 답의 복제보다 경쟁 가설과 전문 관점에 먼저 사용한다.
5. Request, Commitment, Completion Claim, Acceptance를 구분한다.
6. 자율성은 agent 속성이 아니라 WorkUnit의 Authority Envelope다.
7. Decision은 가능한 가장 낮은 유능한 수준에 두고 상향 이유를 설명한다.
8. 정상 반복은 압축하고 Decision을 바꿀 수 있는 차이는 보존한다.
9. 중요한 단계 경계에서만 공동 pause를 만든다.
10. 수락은 Evidence, 한계, reopen trigger를 가진다.
11. local completion은 system Integration 전까지 닫히지 않는다.
12. Reflection은 다음 Context, Contract, Policy를 실제로 바꿔야 한다.

### 15.16 반증 조건 (F09 §17)

「이 운영 이론은 다음이 반복되면 수정하거나 폐기해야 한다.」
1. Return Brief가 원본 로그 재독을 줄이지 못함
2. Inquiry Map이 조기 수렴이나 결과 결함을 줄이지 못함
3. Decision Gate가 대부분 approval theater로 끝남
4. DelegationContract의 비용이 방향 이탈·재작업 감소보다 큼
5. OPD+C가 teamwork failure를 예측하지 못함
6. Claim/Acceptance/Integration 분리가 실제 숨은 작업을 드러내지 못함
7. 사용자 참여가 품질·저자성 증가 없이 workload만 높임
8. structured docs baseline과 반복적으로 차이가 없음
9. facilitator 도움을 제거하면 효과가 사라짐

[정리] 대응: 1↔H1, 2↔H3, 3↔H4, 4↔H2, 5↔H5, 6↔H10(+H2), 7↔H8, 8↔F08 비교 기준선, 9는 대응 가설 없음.

### 15.17 현재 가장 중요한 다음 Evidence (F09 §18)

「더 많은 Entity를 설계하는 것이 아니다. 다음 사건을 실제 사용에서 관찰하는 것이다.」
1. Return Brief가 사용자의 상황 모델을 실제로 복원하는가?
2. 사용자가 ProblemFrame이나 Criterion을 의미 있게 바꾸는가?
3. Counterevidence 때문에 Recommendation 또는 Decision이 바뀌는가?
4. DelegationContract가 실제 scope/authority 오해를 예방하는가?
5. Completion Claim과 Acceptance 사이에서 새로운 결함이 드러나는가?
6. Acceptance와 Integration 분리가 미해결 obligation을 발견하는가?
7. 사용자가 이 방식으로 다시 일하고 싶어 하는가?

「이 Evidence가 다음 안정 schema와 코드 아키텍처의 정당한 출발점이다.」

## 16. 정제 후보 v0.2 (Refinement Candidate)

출처: F10(`docs/foundations/10-refinement-candidate.md`, Helm Foundation v0.2 정제 후보).

### 16.1 머리말 (원문)

- Status: 「product direction aligned — first semantic validation passed, broader validation pending」
- Role: 「기존 v0.1의 모순과 실행 증거를 정리하고, 합의된 제품 순서·세계 모델·강제 수준을 다음 정본 후보로 제안한다.」
- Alignment: 「2026-08-22에 D1은 "자체 CLI agent 우선, portable Kernel 두 번째"로 수정 수락했고, D2는 수락했으며, D3는 "Guided 기본값의 위험 적응형 강제"로 수정 수락했다.」
- Promotion: 「대표 CLI 및 cross-runtime 시나리오 검증 전에는 기존 문서를 대체하지 않는다.」
- First evidence: `../prototypes/agent-v0.2/runs/codex-kernel-baseline-001.md` (CLI-G01 Codex Kernel Baseline)

§1 겹쳐 있는 세 시스템(원문):
1. **Docs-Agent OS** — Markdown/YAML을 에이전트 진입 프로토콜로 사용하는 수동 문서 스캐폴드
2. **Helm Foundations v0.1** — 지향적 공동행위에 대한 철학·의미·통치 모델
3. **Helm System experimental.v0** — JSONL Event ledger, projection, CLI, server, Web client로 만든 실행 vertical slice

「이 셋은 진화 관계지만 현재 README와 코드에서는 하나의 제품처럼 동시에 노출된다. 그 결과 사용자는 Helm이 문서 템플릿인지, 에이전트 관리자지, 공동행위 제어면인지 한 문장으로 판단하기 어렵다.」

명확히 할 것(원문): Helm의 본질과 제품 경계 / 세계 모델과 행위자·정책의 관계 / 기록, 진실, 상태, projection의 차이 / 의미 품질과 `unknown`의 취급 / 자체 Helm Agent Runtime과 이식 가능한 Kernel의 경계 / 합의된 Decision과 검증해야 할 가설.

### 16.2 모순 C1~C8 (F10 §2)

| ID | 제목(원문) | 문제(원문 요지) | 정제 방향(원문) |
|---|---|---|---|
| C1 | 제품 정체성의 이중성 | 루트 README가 Docs-Agent OS initializer와 Helm System v0를 함께 소개. 「전자는 문서 기반 에이전트 라우터이고 후자는 의미 상태를 다루는 제어면이다.」 영향: 「사용자 약속, 설치 경로, 핵심 성공 지표가 서로 달라진다.」 | Docs-Agent OS는 `legacy scaffold / compatibility profile`로 재분류하고, Helm의 정본 정의에서 분리한다. |
| C2 | 세 세계와 다섯 상태 공간의 불일치 | Actor와 Policy를 같은 종류의 세계로 취급하면 모호해지는 질문: 「Actor는 현실의 내용인가, 상태를 주장하고 바꾸는 참여자인가?」 「Policy는 현재 상황인가, 허용되는 전이를 평가하는 메타 규칙인가?」 | 세 세계는 작업 현실의 의미 차원으로 유지하고, Actor와 Policy는 모든 세계를 가로지르는 통치 평면으로 둔다. `WorkspaceState(t) = <N(t), E(t), M(t) \| A(t), P(t)>` |
| C3 | Event와 진실의 혼동 | 「ledger가 실제로 보장하는 것은 어떤 Actor나 Tool이 특정 내용을 기록했다는 사실이지 payload의 진실이 아니다.」 영향: 「agent의 주장, 도구의 관찰, 인간의 선택이 append되었다는 이유만으로 같은 인식적 지위를 얻을 수 있다.」 | `LedgerEvent`는 **상태 전이에 대한 관찰·주장·수락의 불변 기록**이다. 기록 무결성과 내용 타당성을 분리한다. (`immutable record != true content` / `observed != interpreted != accepted` / `accepted != permanently valid`) |
| C4 | Canonical state와 Projection의 경계 침범 | 「현재 `projection.next_action.proposed`는 정본 Event로 append된다.」 「`projection.*`이 domain write vocabulary가 되면 경계가 뒤집힌다.」 | Actor가 행동을 제안했다면 `normative.action.proposed` 또는 WorkUnit/Commitment domain에 기록한다 / 단순 추천이라면 projection 생성 결과로만 존재하며 source cursor와 derivation을 가진다 / 사용자가 추천을 수락할 때만 별도 normative transition을 기록한다. |
| C5 | Foundation의 인식적 구분이 실행 코어에서 소실됨 | 현재 코어는 구분을 `epistemic.belief.updated`와 `confidenceBasis` 문자열로 압축. 영향: 「그럴듯한 해석이 관찰처럼 보이고, Evidence가 Claim과 독립적으로 재검토될 수 없으며, 반대 근거가 어떤 판단을 약화시키는지 계산할 수 없다.」 | 최소 구분 Observation / Interpretation / Possibility / Finding / EvidenceLink / Choice를 코어 계약에서 잃지 않는다(§7.6). |
| C6 | 구조적 유효성과 의미 품질의 혼동 | 「현재 Decision validation은 필수 문자열이 비어 있지 않은지만 확인한다.」 dogfood: `summary: ㅇ`, `rationale: ㅁㄴㅇ`, `reopen trigger: ㅁㄴㅇ`인데 Brief는 `blind spots: none`. | 품질 상태 8개(absent, captured, structural, qualified, accepted, contested, stale, superseded) 분리. Projection은 `unknown`, `unqualified`, `contested`, `stale`을 blind spot과 risk로 표시(§8.11). |
| C7 | Goal-first 원칙과 단일 초기화 Purpose의 충돌 | 「현재 Purpose는 `workspace.initialized` payload에 한 번 저장되며 변경·분기·상위 연결·재검토 전이가 없다.」 | Goal은 versioned normative entity(§7.6). |
| C8 | 다중 client와 다중 agent portability의 혼동 | 「CLI와 Web이 같은 application service를 사용한다는 테스트는 다중 client 경계를 입증한다. 하지만 Pi, Codex, OpenCode가 같은 의미 계약으로 실행·중단·재개·결과 제출할 수 있다는 것은 아직 검증하지 않았다.」 | `client contract`와 `agent adapter protocol`을 분리하고 각각 독립적인 acceptance test를 둔다. |

### 16.3 합의된 제품 정의 (F10 §3)

정본 후보와 한 줄 사용자 약속은 §3.1.

제품 목표의 순서(원문):
1. **첫 번째 목표 — Helm CLI AI Agent:** Foundation을 기본 행동 방식으로 내장한 완결된 first-party agent experience를 만든다.
2. **두 번째 목표 — Portable Foundation & Kernel:** 같은 관점, workflow, semantic contract를 Codex, Pi, OpenCode, Oh My OpenCode에 이식한다.
3. **세 번째 목표 — Helm GUI AI Agent:** 검증된 Kernel과 Agent Runtime 위에 시각적이고 더 넓은 co-agency experience를 만든다.

「두 번째 목표는 첫 번째 목표를 약화시키는 "최소 공통분모"가 아니다. 먼저 Helm CLI에서 원하는 경험을 충분히 강하게 구현하고, Kernel의 의미 계약을 훼손하지 않는 adapter를 다른 runtime에 제공한다.」

제품과 Kernel의 경계(원문):
- Helm **제품**은 Agent Runtime을 포함한다: model/provider invocation / reasoning and tool loop / session, steering, pause, resume / CLI interaction and rendering / Foundation workflow orchestration.
- Helm **Kernel**은 runtime과 분리된다: Goal, Concern, Claim, Choice, Work Agreement, Result의 의미 / 권한, evidence burden, state transition, conflict / Event ledger, projection, invalidation, provenance / runtime-independent adapter contract.
- 「Kernel은 제품 내부의 "control plane" 역할을 하지만 Helm 제품 전체를 control panel로 정의하지 않는다. First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다.」

비목표 5는 §4.2.

### 16.4 정제된 세계 모델 (F10 §4)

§7.2~§7.4, §9.11.

### 16.5 작업의 두 단위 (F10 §5)

Concern / WorkUnit 정의와 트리는 §7.6. 「작고 가역적이며 정책으로 충분히 덮이는 작업은 더 가벼운 profile로 처리할 수 있다. 그러나 기본값은 최소 기록이 아니라 사용자가 방향과 근거를 실제로 이해할 수 있는 `Guided` profile이다. 형식의 양은 고정 workflow가 아니라 위험·불확실성·결합도에 따라 증가해야 한다.」

### 16.6 위험 적응형 강제 수준 Quick / Guided / Assured (F10 §5)

| Profile | 대상 | 요구 항목(원문) | 부가 규칙(원문) |
|---|---|---|---|
| **Quick** | 낮은 위험의 짧은 작업 | Goal 또는 active Concern 연결 / 기대하는 Result와 보존해야 할 Constraint / material mutation의 provenance / 완료 주장과 자동 검증 Evidence | 「사용자에게 매번 form을 요구하지 않지만 agent가 이 의미를 내부적으로 유지해야 한다. Observation을 Choice로 자동 승격하거나 완료를 수락과 동일시하는 것은 Quick에서도 금지한다.」 |
| **Guided** | 기본값 | 명시적 Goal과 현재 Concern / Observation, Interpretation, Possibility의 구분 / 중요한 Choice의 실질적 대안과 rationale/review trigger / Work Agreement와 맡긴 범위 / Completion Claim, Evidence, Acceptance의 구분 / 중요한 uncertainty, dissent, integration obligation 표시 | 「사용자가 자연어로 대화하면 Agent가 구조를 초안하고, 사용자는 결과를 바꿀 수 있는 핵심 차이만 확인·수정한다. 제품의 "조금 더 강하지만 과도하게 엄격하지 않은" 기본 경험이다.」 |
| **Assured** | 높은 위험·높은 결합도 | 명시적 Problem Frame과 competing possibilities / Evidence/Counterevidence와 acceptance burden / effect class별 강제된 Authority Envelope / 독립적이거나 명시적으로 동일 주체임을 밝힌 result review / integration impact, rollback/recovery, reopen trigger / consequential action 전 human Gate | — |

Profile이 바꾸지 못하는 불변조건(원문): 「Profile은 입력 형식과 증명 부담의 양을 조절한다. 다음 의미 경계는 어떤 profile에서도 축소하지 않는다.」
- 기록과 진실은 다르다.
- Observation, Interpretation, Possibility, Finding, Choice는 다르다.
- Projection은 정본을 쓰지 않는다.
- Authority는 scope와 effect class를 가진다.
- Completion Claim, Acceptance, Integration은 다르다.
- unknown, dissent, stale state는 숨기지 않는다.

### 16.7 코어의 최소 법칙 후보 (F10 §6, 원문)

1. **모든 material mutation은 Goal/Concern과 권한 근거에 연결한다.**
2. **기록의 존재와 내용의 진실·품질·수락을 구분한다.**
3. **Observation, Interpretation, Possibility, Finding, Choice를 서로 자동 승격하지 않는다.**
4. **Choice는 대안, 근거, 권한 주체, review trigger를 가진다.**
5. **Authority는 agent의 고정 등급이 아니라 WorkUnit과 action class별 범위다.**
6. **결과 제출, 결과 수락, 전체 반영을 별도 전이로 둔다.**
7. **Projection은 정본을 변경하지 않으며 cursor, 포함·누락 정책, freshness를 가진다.**
8. **`unknown`, dissent, counterevidence는 오류 없이 존재할 수 있는 일급 상태다.**
9. **semantic conflict를 file conflict와 별도로 탐지·표현한다.**
10. **특정 agent/runtime/session 없이도 의미 상태를 읽고 내보낼 수 있어야 한다.**
11. **자동화가 사용자의 복귀 능력·예측 가능성·방향 수정 능력을 낮추면 실패로 측정한다.**
12. **모든 안정 schema는 실제 cross-runtime scenario의 증거를 통과한 뒤 승격한다.**

authority 포함 관계 공식은 §9.5.

[정리] 최소 법칙 12와 F09 열두 법칙의 대응: 최소 1↔F09 1, 최소 3↔F09 3, 최소 5↔F09 6, 최소 6↔F09 5·11, 최소 4↔F09 10(+I6), 최소 2·7·8·9·10·11·12는 F09 법칙에 직접 대응 없음(각각 C3·C4·A14·F05 §13·F07 기술 비목표·A12·F07 §9 변경 원칙 4와 이어짐).

### 16.8 코어와 주변부의 경계 후보 (F10 §7)

| 소유자 | 소유하는 것(원문) |
|---|---|
| **Helm Kernel** | stable identity와 versioned schema / Command validation과 domain transition / append-only ledger와 correction/supersession semantics / N/E/M 관계 projection / authority/evidence/freshness policy evaluation / conflict와 invalidation 신호 / adapter capability contract / deterministic export/import와 provenance |
| **Runtime Adapter** | Helm Work Agreement를 agent별 instruction/context로 변환 / agent session/run lifecycle 관찰 / tool action과 artifact change 수집 / runtime의 permission·pause·cancel 기능 매핑 / 결과를 Completion Claim과 Evidence 후보로 제출 / 지원할 수 없는 capability를 명시적으로 보고 |
| **Client** | CLI, TUI, GUI, IDE surface / Brief, Explore, Choice, Review의 상호작용 표현 / 접근성, progressive disclosure, 알림 채널. 「Client는 domain validation이나 정본 state를 별도로 소유하지 않는다.」 |
| **Agent Runtime** | model invocation과 reasoning loop / tool selection과 실행 substrate / provider/session management / agent-specific context window strategy |

### 16.9 Agent-independent Adapter Protocol의 최소 요구 (F10 §8)

「모든 runtime이 같은 기능을 제공한다고 가정하지 않는다. Adapter는 capability negotiation을 해야 한다.」

```text
identify_actor
start_or_attach_run
deliver_context
declare_authority_envelope
observe_lifecycle
observe_tool_action
observe_artifact_change
request_pause_or_cancel
receive_completion_claim
link_evidence
```

지원 수준(원문):
- **Level A — File/CLI bridge:** instructions file + deterministic CLI/JSON 입출력
- **Level B — Lifecycle hooks:** run start/end, tool action, artifact event 수집
- **Level C — Directed runtime:** pause/cancel, context refresh, authority enforcement
- **Level D — Native co-agency:** live steering, gate, semantic conflict, resumption round-trip

「Codex, Pi, OpenCode는 먼저 자신이 지원하는 capability로 설명되어야 한다. vendor별 이름을 코어 schema에 넣지 않는다.」

### 16.10 첫 대표 시나리오 후보: Cross-runtime 이어서 일하기 (F10 §9, 원문)

1. 사용자가 Codex에서 Goal과 Concern을 연다.
2. Codex가 현재 관찰과 두 개 이상의 가능성을 구조화하되 Choice를 자동 확정하지 않는다.
3. 사용자가 한 방향을 선택하고 조사 범위와 중단 조건을 정한다.
4. Pi가 같은 Work Agreement와 Context Projection으로 조사를 수행한다.
5. Pi의 Finding과 Evidence가 Helm에 들어오며 기존 Assumption 하나를 약화시킨다.
6. 사용자가 돌아왔을 때 Brief는 raw activity가 아니라 달라진 판단·위험·다음 선택을 보여준다.
7. OpenCode가 수락된 Choice와 제한된 authority로 구현한다.
8. 구현 완료 주장은 test evidence와 함께 제출되지만 자동으로 전체 완료가 되지 않는다.
9. Codex 또는 사용자가 결과를 확인하고 인접 작업의 Assumption까지 통합한다.
10. 다른 runtime에서 열어도 동일한 Goal, Choice, Work Agreement, unresolved risk가 재현된다.

「이 시나리오는 다중 client가 아니라 **의미의 cross-runtime continuity**를 검증한다.」

### 16.11 첫 UX 명제 후보 (F10 §10)

§4.3의 네 질문.

### 16.12 제품 소유자 Decision 정렬 결과 D1~D3 (F10 §11)

- **D1. Helm의 제품 경계 — 수정 수락.** 결정: 「Helm의 첫 목표는 자체 CLI AI agent다. Portable Kernel과 다른 runtime adapter는 두 번째 목표이며, GUI agent가 그 다음이다.」 정제: 「Kernel은 runtime-independent control plane이지만 Helm 제품은 first-party Agent Runtime과 experience를 포함한다.」 아키텍처 결과: `Kernel ≠ Agent Runtime`, 그러나 `Helm Product = Kernel + Agent Runtime + Experience`.
- **D2. 세계 모델의 위상 — 수락.** 결정: 「N/E/M은 의미 세계, A/P는 가로지르는 통치 평면이다.」 결과: 「Event schema와 projection은 이 위상을 기준으로 설계한다.」
- **D3. 의미 모델의 깊이 — 수정 수락.** 결정: 「최소 의미 계약만으로 약화하지 않는다. `Guided`를 기본값으로 하고 Quick/Assured profile이 위험에 따라 부담을 조절한다.」 결과: 「핵심 의미 경계는 항상 강제하되, 모든 작업에 전체 Inquiry/Delegation/Assurance form을 요구하지 않는다.」 재검토 조건: 「Guided profile이 사용자 판단을 개선하지 못하고 workload만 증가하거나, Quick profile이 반복적으로 방향 이탈·허위 완료를 허용할 때 강도를 조정한다.」

### 16.13 v0.2 Foundation의 수락 기준 (F10 §12, 원문)

「다음 조건 전에는 이 후보를 정본으로 승격하지 않는다.」
1. Helm을 처음 접한 사용자가 제품과 agent runtime의 차이를 설명할 수 있다.
2. 사용자가 Helm 제품과 portable Kernel의 차이를 "자체 agent 우선, 외부 이식 두 번째"로 이해할 수 있다.
3. Quick/Guided/Assured가 같은 의미 불변조건을 보존하면서 interaction burden만 다르게 만든다.
4. 모든 안정 core Entity가 하나 이상의 사용자 질문과 불변조건에 연결된다.
5. Event, Entity state, Projection, Policy의 경계가 예제로 모순 없이 설명된다.
6. 형식적 품질 검사를 통과한 쓰레기 입력이 `blind spot 없음`으로 승격되지 않는다.
7. Codex, Pi, OpenCode 중 최소 두 runtime에서 같은 cross-runtime scenario를 재현한다.
8. 결과 제출, 수락, 통합 중 하나를 생략했을 때 무엇이 손실되는지 실제 사례로 확인한다.
9. 사용자가 raw transcript를 다시 읽는 양과 방향 수정 비용이 baseline보다 감소한다.

### 16.14 다음 작업 (F10 §13, 원문)

1. 수락된 내용을 v0.2의 짧은 canonical foundation과 상세 rationale로 분리한다.
2. 기존 00–09 문서에서 중복 법칙과 충돌하는 정의를 migration map으로 정리한다.
3. `Helm Agent & Kernel Architecture v0.2 후보`(`../architecture/helm-kernel-v0.2-candidate.md`)를 first-party CLI Agent 우선 구조로 유지한다.
4. `Guided Simulation 001`(`../prototypes/agent-v0.2/helm-cli-guided-001.md`)의 Kernel baseline 결과를 product-owner 관점에서 검토한다.
5. `Helm CLI AI Agent Experience`(`../experience/helm-cli-agent-v0.2.md`)를 thin conversational CLI에서 검증한다.
6. 현재 `experimental.v0` 코어를 stable 후보로 승격하지 말고 검증된 contract를 새 Kernel과 Agent Runtime boundary로 구현한다.
7. Helm CLI live simulation 뒤 Codex/Pi/OpenCode portability simulation에서 interaction burden, semantic correction, resumption quality를 비교한다.

## 17. friendly 문서 (쉬운 Product Foundations)

출처: `docs/foundations-friendly/` 전체. README(PR)의 지위·충돌 규칙은 §2.2, 일곱 약속과 한 문장은 §3.1·§4.3.

### 17.1 쉬운 말 정의 (P00, `00-helm-in-plain-language.md`, Helm을 쉬운 말로 설명하면)

- 문제와 한 문장: §4.4, §3.1.
- 제공하는 것(원문): 「Helm은 사람, agent, 도구, 문서, 실제 결과를 하나의 작업 공간에서 연결한다.」 10단계 사용자 흐름: §6.4.
- 열 가지 쉬운 원칙: §5와 §5.1 표(제목과 본문은 §5 각 공리 아래 "쉬운 원칙"에 원문으로 있다). 원칙 1~10 제목(원문): 1 할 일보다 목표를 먼저 본다 / 2 많이 움직인 것이 진척은 아니다 / 3 처음 요청이 완성된 문제 정의는 아니다 / 4 본 것, 해석한 것, 가능한 설명, 선택을 구분한다 / 5 Agent에게는 일을 맡기고 사람은 방향을 정한다 / 6 자율성은 agent의 등급이 아니라 맡긴 범위다 / 7 사소한 것은 묻지 않고 중요한 차이만 묻는다 / 8 끝냈다는 말과 결과 확인은 다르다 / 9 요약은 중요한 이견을 지우면 안 된다 / 10 자동화가 사람을 더 무력하게 만들면 실패다.
  - 원칙 2 본문: 「파일 수, message 수, agent 실행 시간보다 실제로 무엇이 좋아졌고 그것을 왜 믿는지가 중요하다.」
  - 원칙 3 본문: 「조사 중 새로운 사실이 나오면 문제를 보는 방식과 성공 기준을 바꿀 수 있다.」
  - 원칙 5 본문: 「반복 실행과 넓은 탐색은 agent에게 맡긴다. 목표, 중요한 기준, 큰 위험의 수락은 사람이 주도한다.」
  - 원칙 8 본문: 「Agent가 결과를 제출하면 조건과 근거를 확인한다. 확인된 결과도 전체 작업에 반영되기 전에는 완전히 닫히지 않는다.」
  - 원칙 9 본문: 「반대 근거, 아직 모르는 점, 실패 징후는 짧게 만들기 위해 삭제하지 않는다.」
- Helm이 아닌 것 7, 좋은 사용 경험 6: §4.2, §4.4.

### 17.2 공유 언어 (P01, `01-shared-language.md`, Helm의 공통 제품 언어) — 용어집 전체

언어 원칙(원문):
1. 일상적인 단어를 먼저 사용한다.
2. 비슷해 보이지만 책임이 다른 상태는 반드시 구분한다.
3. 명사보다 사용자가 답할 수 있는 질문과 행동을 함께 보여준다.
4. 영어 technical term은 도움말과 개발 문서의 대응표에서만 우선 사용한다.
5. 같은 개념을 화면마다 다른 말로 바꾸지 않는다.

가장 중요한 다섯 가지 구분: 「관찰 → 해석 → 가능성 → 판단 → 선택」(표는 §8.2)과 「제출 → 결과 확인 → 전체 반영」:

| 쉬운 용어 | 뜻 |
|---|---|
| **결과 제출** | 일을 맡은 쪽이 완료 조건을 만족했다고 알림 |
| **결과 확인** | 권한 있는 사람이 근거와 남은 제한을 보고 받아들임 |
| **전체 반영** | 다른 작업·규칙·문서·실제 환경까지 맞게 갱신함 |

「사용자 화면에서 `완료`는 전체 반영까지 끝났을 때만 단독으로 사용한다.」

방향을 정하는 말:

| 제품 용어 | 사용자가 답할 질문 | 원론 용어 |
|---|---|---|
| **목표** (`Goal`) | 우리가 이루려는 것은 무엇인가? | Purpose |
| **초점** (`Focus`) | 지금 함께 풀고 있는 중요한 상황은 무엇인가? | Concern |
| **완료 기준** (`Result condition`) | 어떤 상태가 되면 결과를 받아들일 수 있는가? | AcceptanceCriterion |
| **선택** (`Choice`) | 앞으로 무엇을 하기로 정했는가? | Decision |
| **다시 볼 조건** (`Review trigger`) | 어떤 변화가 생기면 이 선택을 다시 검토할까? | ReopenTrigger |
| **약속** (`Promise`) | 누가 무엇을 맡았는가? | Commitment |

이해를 만드는 말:

| 제품 용어 | 사용자가 답할 질문 | 원론 용어 |
|---|---|---|
| **현재 상황** (`Current picture`) | 지금 실제로 어떤 상태인가? | SituationModel |
| **문제 관점** (`Problem view`) | 이 상황에서 무엇을 문제로 보고 있는가? | ProblemFrame |
| **관찰** (`Observation`) | 무엇을 직접 확인했는가? | Observation |
| **해석** (`Interpretation`) | 관찰을 어떻게 이해하고 있는가? | Inference |
| **가능성** (`Possibility`) | 어떤 설명이나 해법을 확인 중인가? | Hypothesis |
| **판단** (`Finding`) | 지금 무엇을 참으로 받아들이는가? | Claim |
| **근거** (`Evidence`) | 무엇이 이 판단을 지지하거나 약화하는가? | Evidence |
| **반대 근거** (`Challenging evidence`) | 무엇이 이 판단과 맞지 않는가? | Counterevidence |
| **전제** (`Assumption`) | 아직 확인하지 않고 임시로 믿는 것은 무엇인가? | Assumption |
| **아직 모르는 점** (`Open question`) | 무엇을 알면 선택이 달라질 수 있는가? | Uncertainty / Question |

일을 맡기고 결과를 만드는 말:

| 제품 용어 | 사용자가 답할 질문 | 원론 용어 |
|---|---|---|
| **작업 합의** (`Work agreement`) | 무엇을 왜, 어디까지, 어떤 조건으로 맡겼는가? | DelegationContract |
| **맡긴 범위** (`Allowed range`) | 무엇을 스스로 해도 되고 언제 멈춰야 하는가? | AuthorityEnvelope |
| **진행 작업** (`Work`) | 지금 실행 중인 구체적인 일은 무엇인가? | WorkUnit |
| **실제 결과** (`Result`) | 실행 뒤 현실에서 무엇이 달라졌는가? | Outcome |
| **결과 확인** (`Result review`) | 제출된 결과를 받아들여도 되는가? | Acceptance / Assurance |
| **전체 반영** (`Whole update`) | 다른 작업과 기준까지 일관되게 갱신했는가? | Integration |
| **돌아보기** (`Learning review`) | 다음에는 무엇을 다르게 할 것인가? | Reflection |

상황을 보여주는 말:

| 제품 용어 | 화면 역할 | 원론 용어 |
|---|---|---|
| **전체 상황** (`Overview`) | 열린 초점, 진행 작업, 위험, 선택 요청 | CommonOperatingPicture |
| **복귀 요약** (`Brief`) | 사용자가 자리를 비운 뒤 달라진 점과 다음 흐름 | ReturnBrief / ContextProjection |
| **가능성 비교** (`Explore`) | 문제 관점, 가능성, 근거, 다음 확인 방법 | InquiryMap |
| **선택 요청** (`Choice request`) | 사람의 선택이 결과를 바꾸는 순간 | DecisionGate |
| **변화 기록** (`History`) | 누가 언제 무엇을 바꿨는지 남긴 기록 | Event ledger |

참여자와 운영을 말하는 법:

| 제품 용어 | 뜻 | 원론 용어 |
|---|---|---|
| **사람 책임자** (`Human owner`) | 목표와 결과에 대한 책임을 계속 가진 사람 | HumanActor / Accountability |
| **Agent 담당** (`Agent delegate`) | 맡긴 범위 안에서 실제 일을 수행하는 agent | AgentActor / Performer |
| **결과 확인자** (`Reviewer`) | 제출된 결과를 받아들일 권한이 있는 사람 또는 규칙 | Acceptor |
| **도구** (`Tool`) | 테스트, Git, CI처럼 관찰이나 실행을 만드는 시스템 | ToolActor |
| **팀** (`Team`) | 여러 사람과 규칙이 함께 선택하는 단위 | CollectiveActor |
| **자동화 규칙** (`Automation rule`) | 반복 행동, 권한, 선택 요청 조건을 정한 규칙 | Policy |
| **지켜야 할 조건** (`Boundary`) | 실행 중 바뀌거나 위반되어서는 안 되는 조건 | Constraint |
| **결정 권한** (`Decision right`) | 어떤 선택을 확정하거나 결과를 확인할 수 있는 범위 | Authority |
| **이어받기** (`Handoff`) | 다음 참여자가 상태와 남은 책임을 확인하고 맡는 과정 | Handoff |
| **복구 방법** (`Recovery plan`) | 실패 뒤 안전하게 재개하거나 되돌리는 경로 | RecoveryPath |

화면에서 쓰지 않을 말(원문): 「다음 원론 용어는 일반 사용자 화면의 기본 label로 사용하지 않는다.」

| 피할 표현 | 기본 표현 |
|---|---|
| Normative state | 방향 |
| Epistemic state | 이해 |
| Material state | 실제 변화 |
| Concern | 초점 |
| Problem Frame | 문제 관점 |
| Hypothesis | 가능성 |
| Claim | 판단 |
| Commitment | 약속 |
| Delegation Contract | 작업 합의 |
| Authority Envelope | 맡긴 범위 |
| WorkUnit | 진행 작업 |
| Acceptance | 결과 확인 |
| Integration | 전체 반영 |
| Assurance | 근거 검토 |
| Escalation | 도움 요청 / 선택 필요 |
| Context Projection | 맞춤 상황 / 복귀 요약 |

「관리자·개발자용 세부 정보에서는 쉬운 표현 뒤에 원론 용어를 보조 표기할 수 있다.」

상태 이름(원문):

```text
진행 작업:
준비 중
→ 범위 확인 중
→ 맡김 완료
→ 진행 중
→ 결과 확인 필요
→ 결과 확인됨
→ 전체에 반영 중
→ 완료

예외 상태:
막힘 · 수정 필요 · 잠시 멈춤 · 다시 열림 · 취소됨 · 다른 작업으로 대체됨

선택:
질문 정리 중
→ 선택지 검토 중
→ 선택 필요
→ 선택됨
→ 적용 중
→ 결과 확인됨
→ 전체 반영됨
```

세 묶음으로 보여주기(원문): 「사용자에게 원론의 세 세계를 설명해야 할 때는 다음 표현을 사용한다.」
- **방향:** 목표, 기준, 선택, 약속, 맡긴 범위
- **이해:** 관찰, 해석, 가능성, 판단, 근거, 아직 모르는 점
- **실제 변화:** 파일, 문서, 실행, 배포, 외부 상태, 실제 결과

「제품은 세 묶음을 서로 다른 database처럼 분리해 보이게 하기보다, 하나의 초점 안에서 어떻게 연결되는지 보여준다.」

### 17.3 작업 흐름 (P02, `02-how-work-flows.md`, Helm에서 일은 어떻게 흐르는가)

「Helm의 일은 task가 `할 일 → 진행 중 → 완료`로 이동하는 것보다 넓다.」 8단계 목록은 §6.4. 단계별 사용자 경험(원문):

| 단계 | 사용자에게 보이는 것 | 가치(원문) |
|---|---|---|
| 1 돌아오기 | raw log가 아니라 **복귀 요약**: 돌아온 뒤 달라진 점 / 왜 중요한지 / 그대로 두면 다음에 일어날 일 / 지금 선택이 필요한 항목 / 지금 읽지 않아도 되는 항목 | 과거를 다시 읽는 시간이 아니라 앞으로 올바르게 참여할 준비를 한다. |
| 2 목표와 초점 정하기 | 사용자는 자연어로 원하는 변화를 말한다. Helm이 짧게 정리: 목표 / 지금 풀 초점 / 완료 기준 / 지켜야 할 것 / 하지 않을 것. 「의미 있는 모호성이 있을 때만 확인한다.」 | 처음 prompt가 잘못되었더라도 실행 전에 방향을 맞춘다. |
| 3 문제 관점과 가능성 살펴보기 | Agent는 하나의 답만 내지 않고 중요한 가능성을 비교: 현재 문제 관점 / 다른 문제 관점 / 가능한 원인이나 해법 / 각 가능성을 지지·약화하는 근거 / 가장 적은 비용으로 가능성을 구분할 다음 확인 | 첫 번째 그럴듯한 답에 너무 빨리 수렴하지 않는다. |
| 4 중요한 선택하기 | 사람의 판단이 실제 경로를 바꿀 때만 **선택 요청**: 지금 정할 것 / 왜 지금 정해야 하는지 / 선택지와 추천 / 가장 강한 다른 선택 / 아직 모르는 점 / 되돌릴 수 있는지 / 미뤘을 때의 영향 / 다시 볼 조건 | 승인 노동이 아니라 결과의 방향을 만드는 선택을 한다. |
| 5 작업과 맡긴 범위 합의하기 | 선택을 agent가 실행할 수 있는 **작업 합의**로: 왜 하는 일인지 / 어떤 결과를 내야 하는지 / 어디까지 스스로 해도 되는지 / 금지된 행동은 무엇인지 / 어떤 근거를 함께 제출해야 하는지 / 언제 멈추고 도움을 요청해야 하는지 / 다음 확인 시점은 언제인지 | 자세히 간섭하지 않으면서도 조용한 방향 이탈을 줄인다. |
| 6 자율 진행과 필요한 방향 수정 | 사용자는 모든 tool call을 보지 않는다. 각 진행 작업이 보여주는 것: 지금 하는 일 / 그 일을 하는 이유 / 다음 단계 / 맡긴 범위 / 지켜보는 위험 / 마지막 중요한 변화. 「사용자는 언제든 목표, 기준, 우선순위, 맡긴 범위를 바꾸거나 안전하게 멈출 수 있다.」 | 감시하지 않아도 예측하고 방향을 바꿀 수 있다. |
| 7 결과와 근거 확인하기 | Agent가 결과를 제출하면 Helm은 완료 기준별 근거를 모은다: 확인된 것 / 확인하지 못한 것 / 반대 근거와 남은 제한 / 결과가 무효가 되는 조건 / 수정, 조건부 확인, 결과 확인 중 가능한 행동 | "문제없습니다"라는 말보다 구체적인 근거로 결과를 받아들인다. |
| 8 전체에 반영하고 다음을 배우기 | 결과가 다른 작업에 미치는 영향 확인: 이전 선택이나 전제가 깨졌는지 / 문서, 규칙, 테스트, 실제 환경을 함께 갱신했는지 / 다른 진행 작업과 충돌하는지 / 되돌리거나 복구하는 방법이 있는지 / 다음 작업 합의와 자동화 규칙을 무엇을 바꿀지 | 지역적인 성공을 전체적인 진척으로 바꾼다. |

다시 열리는 상황 6: §6.6.

### 17.4 에이전트와 일하기 (P03, `03-working-with-agents.md`, 사람과 Agent가 함께 일하는 방법)

- 역할: §4.1(P03 §1 원문).
- 네 조건(볼 수 있다 / 예상할 수 있다 / 바로잡을 수 있다 / 이의를 제기할 수 있다): §10.3.
- 리듬과 레버리지 큰 순간: §6.5.
- 선택 요청을 만들지 않을 때 6: §12.3.
- 피해야 할 공동 작업 6: §10.8.

### 17.5 신뢰, 통제, 완료 (P04, `04-trust-control-and-completion.md`, 신뢰, 통제, 결과 확인)

- §1 「Agent를 믿는 대신 맡긴 범위를 안다」: 「Helm은 "이 agent는 자율성이 높다"라고 말하지 않는다. 각 진행 작업마다 **맡긴 범위**를 보여준다.」 8항목은 §9.5.
- §2 선택 요청의 깊이: §12.13.
- §3 근거를 이해하는 법: §8.3.
- §4 결과 확인(원문):

```text
완료 기준
  ├─ 확인된 기준과 연결된 근거
  ├─ 확인하지 못한 범위
  ├─ 남은 전제와 아직 모르는 점
  ├─ 반대 근거와 알려진 제한
  └─ 결과가 무효가 되는 조건
```

  사용자가 고를 수 있는 행동(원문):
  - **수정 요청:** 기준을 충족하지 못했거나 근거가 부족함
  - **조건부 확인:** 범위와 제한을 명시하고 일부만 받아들임
  - **결과 확인:** 현재 범위에서 받아들임
  - **다시 조사:** 문제 관점이나 핵심 가능성을 다시 엶
- §5 전체 반영(원문): 「결과 확인은 끝이 아니다.」 목표와 이전 선택에 맞는가? / 다른 진행 작업의 전제를 깨뜨렸는가? / 관련 문서, 규칙, 테스트, 외부 상태도 갱신했는가? / 지역적인 개선이 전체 품질을 낮추지 않는가? / 실패하면 어떻게 되돌리거나 복구하는가? 「이 과정이 끝나야 사용자 화면에서 작업을 `완료`로 표시한다.」
- §6 시간이 지나면 다시 확인한다: §8.8.
- §7 실패와 복구(원문): 「실패한 진행 작업은 처음부터 다시 시작하게 하지 않는다.」 마지막으로 확인된 지점 / 실패한 행동과 실제 영향 / 다시 실행해도 안전한지 / 이미 실행된 외부 행동 / 가능한 수정, 이전 지점부터 재개, 다른 agent로 이관, 되돌리기. 「복구 뒤에는 다음 작업 합의나 자동화 규칙이 실제로 달라져야 한다.」

### 17.6 UX 문구 지침 (P05, `05-ux-writing-guide.md`, Helm UX Writing Guide) — 규칙 전부

§1 기본 목소리(원문): 「Helm의 문장은 차분하고 구체적이며 책임을 숨기지 않는다.」
1. 사실을 단정하기 전에 무엇을 직접 확인했는지 말한다.
2. 사용자가 왜 지금 읽어야 하는지 먼저 말한다.
3. system이나 agent를 사람처럼 과장하지 않는다.
4. 불확실성을 겁주거나 숨기지 않고 다음 행동과 연결한다.
5. 사용자의 선택이 무엇을 바꿀지 바로 보여준다.

§2 문장 순서(원문):

```text
무엇이 달라졌는가
→ 왜 중요한가
→ 그대로 두면 무엇이 일어나는가
→ 사용자가 무엇을 할 수 있는가
```

§3 화면별 고정 표현(원문):
- 복귀 요약: **돌아온 뒤 달라진 점** / **왜 중요한가** / **그대로 두면** / **지금 선택이 필요함** / **지금 읽지 않아도 됨**
- 선택 요청: **지금 정할 것** / **왜 지금인가** / **추천** / **다른 선택** / **핵심 근거** / **아직 모르는 점** / **되돌릴 수 있나** / **다시 볼 조건**
- 진행 작업: **지금 하는 일** / **이 일을 하는 이유** / **다음 단계** / **맡긴 범위** / **도움이 필요한 조건** / **마지막 중요한 변화**
- 결과 확인: **확인된 것** / **확인하지 못한 것** / **남은 제한** / **반대 근거** / **전체 영향** / **다시 확인할 조건**

§4 버튼은 결과를 말한다(원문):

| 피할 표현 | 권장 표현 |
|---|---|
| 확인 | 이 선택으로 진행 |
| 승인 | 결과 확인 |
| 거절 | 수정 요청 |
| 계속 | 맡긴 범위 안에서 계속 |
| 취소 | 작업 중단 |
| 자세히 | 근거 보기 / 전체 영향 보기 |
| Retry | 마지막 확인 지점부터 다시 실행 |
| Escalate | 내 선택이 필요함 / 담당자에게 도움 요청 |

「위험한 행동에서는 대상과 효과를 버튼에 포함한다.」 `나쁜 예: 승인` / `좋은 예: 고객 128명에게 이메일 보내기`.

§5 상태 문장 예시(원문):

| 상태 | 나쁜 예 | 좋은 예 |
|---|---|---|
| 진행 중 | Agent is working… | 결제 실패 원인 세 가지를 로그와 비교하고 있습니다. 다음에는 재현 테스트를 실행합니다. |
| 막힘 | 작업이 실패했습니다. | 운영 로그를 읽을 권한이 없어 원인 비교를 멈췄습니다. 로그 읽기만 허용하거나, 익명화한 로그를 제공할 수 있습니다. |
| 선택 요청 | A와 B 중 무엇을 원하시나요? | 데이터 이전 전에 호환 모드를 유지할지 정해야 합니다. 지금 선택하지 않으면 내일 배포 일정이 하루 밀립니다. |
| 결과 제출 | 모든 작업이 성공적으로 완료되었습니다. | 세 완료 기준 중 두 가지는 테스트로 확인했습니다. 모바일 환경의 복구 경로는 아직 확인하지 못했습니다. |

§6 불확실성 표현(원문): 「단일 confidence 숫자를 기본값으로 사용하지 않는다.」 `피할 표현: 신뢰도 82%` / `권장 표현: 운영 로그와 같은 패턴이지만 모바일 환경은 확인하지 못했습니다. 모바일 재현 테스트가 통과하면 이 판단을 강화할 수 있습니다.` 「`모름`은 실패가 아니라 다음 확인 방법이 있는 정상 상태다.」

§7 Agent 표현(원문):
- agent 이름보다 역할과 맡긴 일을 먼저 표시한다.
- `생각`, `느낌`, `믿음`처럼 의식을 암시하는 표현을 피한다.
- `agent가 결정했습니다` 대신 `승인된 규칙에 따라 선택했습니다` 또는 `agent가 추천했습니다`를 사용한다.
- 법적·조직적 책임과 실행 주체를 혼동하지 않는다.

§8 알림 기준(원문): 「알림 제목은 사용자가 해야 할 일과 마감 효과를 말한다.」 `피할 표현: Helm notification` / `권장 표현: 배포 전 선택 필요 · 35분 뒤 자동 작업이 멈춥니다`. 「단순 진행 Event는 알림으로 보내지 않는다. 낮은 우선순위 변화는 다음 복귀 요약에 묶는다.」

§9 언어와 번역(원문):
- 사용자 화면의 기본 한국어는 이 문서의 용어를 따른다.
- 영어 UI에서도 Product Domain 이름을 사용한다: Goal, Focus, Problem view, Possibility, Finding, Choice, Work agreement, Allowed range, Result review, Whole update.
- 원론 용어는 개발자 inspector 또는 glossary에서만 괄호로 보조한다.
- 한 화면 안에서 `선택/Decision`, `초점/Concern`을 혼용하지 않는다.

### 17.7 기술 대응표 (P06, `06-technical-crosswalk.md`, Product Language와 기술 모델의 연결)

「이 문서는 쉬운 언어가 copy에만 머물지 않고 application domain에도 일관되게 반영되도록 한다.」

MUST(원문):
- 사용자 화면, 알림, onboarding, help 문서는 Product/UI 용어를 사용한다.
- 새 public API와 application-layer type은 Product Domain 이름을 우선한다.
- 원론 개념과의 관계를 `foundationRef` 또는 개발 문서에서 추적할 수 있어야 한다.
- 제품 용어로 바꾸어도 원론의 상태 전이와 책임 구분을 보존한다.

SHOULD(원문):
- core 내부의 기존 experimental Event 이름은 즉시 일괄 rename하지 않는다.
- projection 경계에서 core term을 Product Domain term으로 변환한다.
- migration 없이 UI copy만 바꾸는 임시 상태를 오래 유지하지 않는다.

MUST NOT(원문):
- 쉬워 보이게 만들기 위해 `결과 제출`, `결과 확인`, `전체 반영`을 하나의 `완료`로 합치지 않는다.
- `관찰`, `해석`, `가능성`, `판단`, `선택`을 하나의 text field에 저장하지 않는다.
- agent persona 이름을 owner, delegate, authority 정보 대신 사용하지 않는다.

전체 대응표(원문):

| 원론 개념 | Product Domain | 한국어 UI | 권장 component/API 이름 |
|---|---|---|---|
| Purpose | Goal | 목표 | `Goal`, `GoalSummary` |
| Concern | Focus | 초점 | `Focus`, `FocusRoom` |
| SituationModel | CurrentPicture | 현재 상황 | `CurrentPicture` |
| ProblemFrame | ProblemView | 문제 관점 | `ProblemView` |
| Observation | Observation | 관찰 | `Observation` |
| Inference | Interpretation | 해석 | `Interpretation` |
| Hypothesis | Possibility | 가능성 | `Possibility`, `PossibilityComparison` |
| Claim | Finding | 판단 | `Finding` |
| Evidence | Evidence | 근거 | `Evidence`, `EvidenceView` |
| Counterevidence | ChallengingEvidence | 반대 근거 | `ChallengingEvidence` |
| Assumption | Assumption | 전제 | `Assumption` |
| Uncertainty / Question | OpenQuestion | 아직 모르는 점 | `OpenQuestion` |
| Decision | Choice | 선택 | `Choice`, `ChoiceRecord` |
| DecisionGate | ChoiceRequest | 선택 요청 | `ChoiceRequest` |
| AcceptanceCriterion | ResultCondition | 완료 기준 | `ResultCondition` |
| Commitment | Promise | 약속 | `Promise` |
| DelegationContract | WorkAgreement | 작업 합의 | `WorkAgreement` |
| AuthorityEnvelope | AllowedRange | 맡긴 범위 | `AllowedRange` |
| WorkUnit | Work | 진행 작업 | `Work`, `ActiveWorkCard` |
| CompletionClaim | ResultSubmission | 결과 제출 | `ResultSubmission` |
| Acceptance / Assurance | ResultReview | 결과 확인 | `ResultReview` |
| Outcome | Result | 실제 결과 | `Result` |
| Integration | WholeUpdate | 전체 반영 | `WholeUpdate` |
| Reflection | LearningReview | 돌아보기 | `LearningReview` |
| ContextProjection | ContextView | 맞춤 상황 | `ContextView` |
| ReturnBrief | Brief | 복귀 요약 | `Brief`, `SinceLastVisit` |
| CommonOperatingPicture | Overview | 전체 상황 | `Overview` |
| InquiryMap | ExploreView | 가능성 비교 | `ExploreView` |
| Event | ChangeRecord | 변화 기록 | `ChangeRecord` |
| ReopenTrigger | ReviewTrigger | 다시 볼 조건 | `ReviewTrigger` |
| EscalationTrigger | HelpTrigger | 도움 요청 조건 | `HelpTrigger` |

참여자, 운영, 실제 변화의 확장 대응(원문):

| 원론 개념 | Product Domain | 한국어 UI | 권장 component/API 이름 |
|---|---|---|---|
| HumanActor | Person | 사람 | `Person`, `HumanOwner` |
| AgentActor | Agent | Agent | `Agent`, `AgentDelegate` |
| ToolActor | Tool | 도구 | `Tool` |
| CollectiveActor | Team | 팀 | `Team`, `ReviewGroup` |
| Principle | GuidingRule | 기본 원칙 | `GuidingRule` |
| Policy | AutomationRule | 자동화 규칙 | `AutomationRule` |
| Constraint | Boundary | 지켜야 할 조건 | `Boundary` |
| Authority | DecisionRight | 결정 권한 | `DecisionRight` |
| Responsibility | Responsibility | 책임 | `Responsibility` |
| Artifact | WorkOutput | 결과물 | `WorkOutput` |
| CodeChange | CodeChange | 코드 변경 | `CodeChange` |
| Document | Document | 문서 | `Document` |
| Design | Design | 설계 | `Design` |
| TestResult | TestResult | 테스트 결과 | `TestResult` |
| Deployment | Release | 배포 | `Release` |
| ExternalState | ExternalState | 외부 상태 | `ExternalState` |
| ExecutionTrace | RunRecord | 실행 기록 | `RunRecord` |
| Handoff | Handoff | 이어받기 | `Handoff` |
| Interface | ConnectionPoint | 연결 지점 | `ConnectionPoint` |
| Conflict | Conflict | 충돌 | `Conflict` |
| Exception | OutsideRange | 맡긴 범위 밖 상황 | `OutsideRange` |
| Surprise | UnexpectedChange | 예상 밖 변화 | `UnexpectedChange` |
| WeakSignal | EarlyWarning | 작은 경고 | `EarlyWarning` |
| RecoveryPath | RecoveryPlan | 복구 방법 | `RecoveryPlan` |

Product Domain object 예시: 선택 요청 JSON(키 목록은 §12.4), 작업 합의 JSON(§9.3). 선택 요청 JSON 원문 값: `goal: "새 결제 흐름을 안전하게 출시한다"`, `focus: "기존 고객의 결제 호환성"`, `question: "호환 모드를 한 달 유지할 것인가?"`, `whyNow: "데이터 이전을 시작하기 전에 정해야 한다"`, `options: []`, `recommendation: {}`, `evidence: []`, `challengingEvidence: []`, `openQuestions: []`, `reversibility: {}`, `reviewTrigger: "구버전 사용자가 5% 아래로 내려갈 때"`.

기존 core와 projection 경계(원문): 「현재 experimental core가 `Purpose`, `Decision`, `Commitment`, `Belief`, `Material Event`를 사용하더라도 UI는 다음처럼 투영한다.」

```text
Core Event / Entity
  → semantic validation
  → Product Domain projection
  → role- and time-specific ContextView
  → 쉬운 한국어 UX copy
```

예: `normative.decision.committed → ChoiceRecord → "호환 모드를 한 달 유지하기로 선택함"`.

Information architecture 이름(원문):

| 이전 연구 표현 | 사용자 기본 label | 설명 |
|---|---|---|
| Today | 오늘 | 돌아온 뒤 달라진 점과 지금 할 일 |
| Concerns | 초점 | 함께 풀고 있는 중요한 상황 |
| Work | 진행 작업 | 사람과 agent가 맡은 일 |
| Decisions | 선택 | 열린 선택 요청과 선택 기록 |
| Evidence | 근거 | 판단과 결과를 지지·약화하는 자료 |
| Policies | 자동화 규칙 | 맡길 범위, 알림, 연결, 보관 기준 |

「`Agent`, `Timeline`, `Artifact`는 기본 top-level navigation이 아니라 초점과 진행 작업을 설명하는 보조 view로 둔다.」

도입 순서(원문):
1. UI copy와 component 이름에 Product Language 적용
2. fixture, example, test description을 쉬운 용어로 갱신
3. application-layer DTO와 command 이름 전환
4. adapter에서 core Event와 Product Domain 사이의 명시적 mapping 제공
5. pilot에서 용어 이해도와 잘못된 상태 해석 측정
6. 의미가 안정된 뒤에만 core schema rename 또는 migration 검토

「구현에서 label과 상태를 중복 선언하지 않도록 `product-language.yaml`을 copy test와 fixture의 기준으로 사용한다.」

### 17.8 예시 생애주기 (P07, `07-example-lifecycle.md`, 예시로 보는 Helm 전체 Lifecycle)

Scenario(원문): 「한 팀이 기존 고객을 보호하면서 새로운 결제 흐름을 출시하려 한다.」

1. **사용자가 목표를 말한다.** 사용자: 「다음 달까지 새 결제 흐름을 출시하고 싶어. 기존 고객이 결제하지 못하는 일은 없어야 해.」 Helm 정리: **목표** 다음 달까지 새 결제 흐름을 안전하게 출시 / **초점** 기존 고객의 결제 호환성 / **완료 기준** 기존 결제 성공률 유지, 복구 경로 확인, 되돌리기 가능 / **지켜야 할 것** 기존 고객 데이터와 결제 연속성 / **하지 않을 것** 사용자 동의 없는 결제 정보 변경. 「사용자는 중요한 차이만 수정하고 목표를 확정한다.」
2. **가능성을 비교한다.**

| 가능성 | 지지 근거 | 반대 근거 | 다음 확인 |
|---|---|---|---|
| 새 API가 구버전 앱과 맞지 않음 | staging에서 구버전 요청 실패 | 운영 traffic의 일부만 구버전 | 구버전별 재현 테스트 |
| 데이터 이전 순서가 문제 | 실패가 이전된 계정에 집중 | 모든 실패가 이전 계정은 아님 | 계정 cohort 비교 |
| 캐시된 설정이 문제 | 설정 초기화 뒤 일부 회복 | 모바일에서 재현 안 됨 | 모바일 cold-start 테스트 |

   「Helm은 한 가지 결론으로 합치지 않고 경로를 실제로 바꿀 차이를 보존한다.」
3. **중요한 선택을 요청한다.** 지금 정할 것: 호환 모드를 한 달 유지할까요? / 왜 지금인가: 데이터 이전을 시작한 뒤에는 되돌리는 비용이 크게 늘어납니다. / 추천: 한 달 유지하고 구버전 사용자가 5% 아래로 내려가면 종료합니다. / 다른 선택: 즉시 전환하면 구현은 단순하지만 구버전 실패 위험이 커집니다. / 아직 모르는 점: 모바일 cold-start 환경의 복구 경로를 확인하지 못했습니다. 「사용자는 추천을 그대로 승인하는 대신 종료 기준을 3%로 바꾸고 선택한다.」
4. **작업을 합의하고 맡긴다.** 진행 작업: 모바일 복구 경로 확인 / 사람 책임자: 제품 책임자 / Agent 담당: 모바일 검증 agent / 완료 기준: 세 구버전에서 실패 재현, 복구 뒤 결제 성공 확인, 자동 회귀 테스트 추가 / 맡긴 범위: 코드와 로그 읽기, 로컬 테스트와 로컬 변경, 운영 배포와 고객 연락은 금지 / 도움 요청 조건: 운영 로그가 필요함, 결제 데이터 변경이 필요함, 예상과 다른 실패 유형 발견.
5. **사용자가 자리를 비운 동안 진행된다.** 「Helm은 모든 command 대신 의미 있는 변화를 기록한다.」 모바일 cold-start에서만 실패가 재현됨 / 캐시 가능성이 강화됨 / 구버전 API 불일치 가능성은 약화됨 / 로컬 수정과 회귀 테스트가 준비됨 / 운영 배포 전 선택이 필요해 멈춤.
6. **사용자가 돌아온다.** 복귀 요약: 돌아온 뒤 달라진 점 「모바일 cold-start 실패를 재현했고 캐시된 설정이 원인이라는 판단이 강해졌습니다.」 / 왜 중요한가 「호환 모드만으로는 모바일 실패를 막지 못합니다.」 / 그대로 두면 「Agent는 로컬 검증을 마친 상태로 멈춰 있습니다. 운영에는 변화가 없습니다.」 / 지금 할 일 「캐시 초기화 변경을 canary 환경에 배포할지 선택하세요.」 「사용자는 raw log를 처음부터 읽지 않고도 다음 판단을 할 수 있다.」
7. **결과를 확인한다.** 결과 제출: 세 구버전 재현 확인됨 / 복구 뒤 결제 성공 확인됨 / 회귀 테스트 확인됨 / 실제 운영 traffic 아직 확인하지 못함 / 알려진 제한 canary에서만 확인 가능. 「사용자는 `canary 범위에서 조건부 확인`을 선택한다.」
8. **전체에 반영한다.** 배포 계획에 canary 단계 추가 / 호환 모드 종료 선택의 다시 볼 조건 유지 / 모바일 운영 문서 갱신 / 다른 agent의 "호환 모드만으로 충분하다"는 전제 무효화 / 실패 시 설정 rollback 경로 기록. 「canary 관찰까지 끝나면 결과를 전체에 반영하고 작업을 완료한다.」
9. **다음 작업이 더 나아진다.** 돌아보기에서 추가한 기본 규칙: 모바일 설정 변경에는 cold-start 테스트를 기본 완료 기준으로 포함 / 운영 배포는 canary 결과가 없으면 자동으로 선택 요청 생성 / 같은 유형의 복구 작업에는 검증된 작업 합의를 재사용. 「Helm의 장기 가치는 기록을 많이 남기는 것이 아니라, 다음 Context와 작업 합의와 자동화 규칙이 실제로 좋아지는 데 있다.」

참고: 6단계 복귀 요약은 P05 고정 표현 「지금 선택이 필요함」 대신 「지금 할 일」을 쓴다. 또 예시는 「한 팀」을 전제한다(B #24 1인 사용과 다름).

## 18. product-language.yaml 전체 항목

출처: PY(`docs/foundations-friendly/product-language.yaml`). 머리: `schema: helm.product-language.v0`, `locale: ko-KR`, `status: working-draft`. authority 블록은 §2.2.

### 18.1 terms (32개, 원문 순서)

| key | domain | label | foundation | question |
|---|---|---|---|---|
| goal | Goal | 목표 | Purpose | 우리가 이루려는 것은 무엇인가? |
| focus | Focus | 초점 | Concern | 지금 함께 풀고 있는 중요한 상황은 무엇인가? |
| current_picture | CurrentPicture | 현재 상황 | SituationModel | 지금 실제로 어떤 상태인가? |
| problem_view | ProblemView | 문제 관점 | ProblemFrame | 이 상황에서 무엇을 문제로 보고 있는가? |
| observation | Observation | 관찰 | Observation | 무엇을 직접 확인했는가? |
| interpretation | Interpretation | 해석 | Inference | 관찰을 어떻게 이해하고 있는가? |
| possibility | Possibility | 가능성 | Hypothesis | 어떤 설명이나 해법을 확인 중인가? |
| finding | Finding | 판단 | Claim | 지금 무엇을 참으로 받아들이는가? |
| evidence | Evidence | 근거 | Evidence | 무엇이 이 판단을 지지하거나 약화하는가? |
| challenging_evidence | ChallengingEvidence | 반대 근거 | Counterevidence | 무엇이 이 판단과 맞지 않는가? |
| assumption | Assumption | 전제 | Assumption | 아직 확인하지 않고 임시로 믿는 것은 무엇인가? |
| open_question | OpenQuestion | 아직 모르는 점 | Uncertainty | 무엇을 알면 선택이 달라질 수 있는가? |
| choice | Choice | 선택 | Decision | 앞으로 무엇을 하기로 정했는가? |
| result_condition | ResultCondition | 완료 기준 | AcceptanceCriterion | 어떤 상태가 되면 결과를 받아들일 수 있는가? |
| review_trigger | ReviewTrigger | 다시 볼 조건 | ReopenTrigger | 어떤 변화가 생기면 이 선택을 다시 검토할까? |
| promise | Promise | 약속 | Commitment | 누가 무엇을 맡았는가? |
| work_agreement | WorkAgreement | 작업 합의 | DelegationContract | 무엇을 왜 어디까지 어떤 조건으로 맡겼는가? |
| allowed_range | AllowedRange | 맡긴 범위 | AuthorityEnvelope | 무엇을 스스로 해도 되고 언제 멈춰야 하는가? |
| work | Work | 진행 작업 | WorkUnit | 지금 실행 중인 구체적인 일은 무엇인가? |
| result_submission | ResultSubmission | 결과 제출 | CompletionClaim | 일을 맡은 쪽이 무엇을 끝냈다고 말하는가? |
| result_review | ResultReview | 결과 확인 | Acceptance | 제출된 결과를 현재 범위에서 받아들여도 되는가? |
| result | Result | 실제 결과 | Outcome | 실행 뒤 현실에서 무엇이 달라졌는가? |
| whole_update | WholeUpdate | 전체 반영 | Integration | 다른 작업과 기준까지 일관되게 갱신했는가? |
| learning_review | LearningReview | 돌아보기 | Reflection | 다음에는 무엇을 다르게 할 것인가? |
| brief | Brief | 복귀 요약 | ReturnBrief | 돌아온 뒤 무엇이 달라졌고 지금 무엇을 해야 하는가? |
| choice_request | ChoiceRequest | 선택 요청 | DecisionGate | 사람의 선택이 지금 결과를 어떻게 바꾸는가? |
| change_record | ChangeRecord | 변화 기록 | Event | 누가 언제 무엇을 왜 바꿨는가? |
| automation_rule | AutomationRule | 자동화 규칙 | Policy | 무엇을 자동 처리하고 언제 사람에게 물을 것인가? |
| boundary | Boundary | 지켜야 할 조건 | Constraint | 실행 중 무엇을 바꾸거나 위반하면 안 되는가? |
| human_owner | HumanOwner | 사람 책임자 | HumanActor | 목표와 결과에 대한 책임을 계속 가진 사람은 누구인가? |
| agent_delegate | AgentDelegate | Agent 담당 | AgentActor | 맡긴 범위 안에서 실제 일을 수행하는 agent는 누구인가? |
| reviewer | Reviewer | 결과 확인자 | Acceptor | 결과를 받아들일 권한이 있는 사람 또는 규칙은 무엇인가? |

PY에 없고 P01·P06에만 있는 용어: Overview(전체 상황), ExploreView(가능성 비교), ContextView(맞춤 상황), Tool(도구), Team(팀), DecisionRight(결정 권한), Responsibility, Handoff(이어받기), RecoveryPlan(복구 방법), HelpTrigger(도움 요청 조건), GuidingRule, WorkOutput 등 확장 대응 전체.

### 18.2 navigation (6, 원문)

| id | label | purpose |
|---|---|---|
| today | 오늘 | 돌아온 뒤 달라진 점과 지금 할 일 |
| focuses | 초점 | 함께 풀고 있는 중요한 상황 |
| work | 진행 작업 | 사람과 agent가 맡은 일 |
| choices | 선택 | 열린 선택 요청과 선택 기록 |
| evidence | 근거 | 판단과 결과를 지지하거나 약화하는 자료 |
| automation_rules | 자동화 규칙 | 맡긴 범위, 알림, 연결, 보관 기준 |

### 18.3 work_statuses (14, 원문)

`proposed: 준비 중` / `negotiating: 범위 확인 중` / `delegated: 맡김 완료` / `in_progress: 진행 중` / `claiming_complete: 결과 확인 필요` / `accepted: 결과 확인됨` / `integrating: 전체에 반영 중` / `integrated: 완료` / `blocked: 막힘` / `correction_required: 수정 필요` / `suspended: 잠시 멈춤` / `reopened: 다시 열림` / `cancelled: 취소됨` / `superseded: 다른 작업으로 대체됨`

### 18.4 choice_statuses (7, 원문)

`framing: 질문 정리 중` / `reviewing_options: 선택지 검토 중` / `choice_needed: 선택 필요` / `chosen: 선택됨` / `applying: 적용 중` / `result_checked: 결과 확인됨` / `integrated: 전체 반영됨`

### 18.5 fixed_sections (4, 원문)

- `brief`: 돌아온 뒤 달라진 점 / 왜 중요한가 / 그대로 두면 / 지금 선택이 필요함 / 지금 읽지 않아도 됨
- `choice_request`: 지금 정할 것 / 왜 지금인가 / 추천 / 다른 선택 / 핵심 근거 / 아직 모르는 점 / 되돌릴 수 있나 / 다시 볼 조건
- `active_work`: 지금 하는 일 / 이 일을 하는 이유 / 다음 단계 / 맡긴 범위 / 도움이 필요한 조건 / 마지막 중요한 변화
- `result_review`: 확인된 것 / 확인하지 못한 것 / 남은 제한 / 반대 근거 / 전체 영향 / 다시 확인할 조건

### 18.6 avoid_as_default_ui_labels (16, 원문)

`Normative: 방향` / `Epistemic: 이해` / `Material: 실제 변화` / `Concern: 초점` / `ProblemFrame: 문제 관점` / `Hypothesis: 가능성` / `Claim: 판단` / `Commitment: 약속` / `DelegationContract: 작업 합의` / `AuthorityEnvelope: 맡긴 범위` / `WorkUnit: 진행 작업` / `Acceptance: 결과 확인` / `Integration: 전체 반영` / `Assurance: 근거 검토` / `Escalation: 도움 요청` / `ContextProjection: 맞춤 상황`

### 18.7 PY와 마크다운 문서의 차이 [정리]

| 항목 | PY | 마크다운 |
|---|---|---|
| result_review foundation | Acceptance | P01·P06: Acceptance / Assurance |
| open_question foundation | Uncertainty | P01·P06: Uncertainty / Question |
| brief foundation | ReturnBrief | P01: ReturnBrief / ContextProjection |
| Escalation 기본 표현 | 도움 요청 | P01: 도움 요청 / 선택 필요 |
| ContextProjection 기본 표현 | 맞춤 상황 | P01: 맞춤 상황 / 복귀 요약 |
| ProblemFrame 키 | `ProblemFrame` | P01: `Problem Frame` |
| human_owner domain | HumanOwner | P06: Person (API `Person`, `HumanOwner`) |
| agent_delegate domain | AgentDelegate | P06: Agent (API `Agent`, `AgentDelegate`) |
| navigation id | `focuses`, `choices`, `automation_rules` | P06 IA: Concerns, Decisions, Policies |
| 결과 확인 label 충돌 | work `accepted` = 결과 확인됨, choice `result_checked` = 결과 확인됨 | 같은 라벨이 두 상태 집합에 쓰인다 |

## 19. README.ko의 제품 설명

출처: RK(`README.ko.md`), RKm(`.helm-design-work/mac-modified/README.ko.md`).

### 19.1 공통 내용 (두 판 모두)

- 배지: npm `@helmdocs/init`, GitHub `Rengod95/agent-docs-os`, MIT.
- 표어(원문): 「문서로 에이전트를 조종하라. AI 코딩 에이전트를 위한 문서 기반 운영 체계.」
- 정의(원문): 「Agent Docs OS는 AI 에이전트가 프로젝트에서 작업하는 방식을 제어하는 디렉터리 구조입니다. 에이전트는 코드를 수정하기 **전에** 문서를 먼저 읽으며, 모든 작업은 Markdown과 YAML 파일을 통해 라우팅, 분류, 추적, 핸드오프됩니다.」
- OS 비유 표(원문):

| OS 개념 | Agent Docs OS |
|---|---|
| 부트 로더 | `CLAUDE.md` → `docs/README.md` (라우터) |
| 프로세스 테이블 | `state/current.yaml` (전역 상태판) |
| 파일 시스템 | `features/`, `references/`, `decisions/` |
| 프로세스 컨텍스트 | `features/<id>/current.md` (작업 허브) |
| 체크포인트/복원 | `state/checkpoints/` |
| 시스템 콜 | 의도+범위 분류 → 필수 경유 경로 |

- 아키텍처: 에이전트 설정 파일(Boot) → `docs/README.md`(Router: 의도+범위 분류, 필수 경유 경로 결정) → Layer 1 State(전역 상태판 `current.yaml` + 세션 핸드오프 체크포인트) / Layer 2 References(kind/tags로 색인된 배경 문서, 결정의 "이유") / Layer 3 Features(작업 허브, `current.md`) / Layer 4 Decisions(전역 판단 기록 + ADR).
- 빠른 시작: `npx @helmdocs/init`(대화형: 문서 디렉터리 이름 기본 `agent_docs`, AI agent tool 선택, bootstrap 주입 여부, Scaffold version v1.0.0), 비대화형 `npx @helmdocs/init --yes --dir=agent_docs --agent="Claude Code"`, Shell 폴백 `bash <(curl -sL https://raw.githubusercontent.com/Rengod95/agent-docs-os/main/packages/@helmdocs/init/bin/init.sh)`.
- 지원 에이전트: Claude Code(`CLAUDE.md`, Append 멱등 마커) / Codex CLI(`AGENTS.md`, Append) / Cursor(`.cursor/rules/agent-docs.mdc`, Create frontmatter) / Windsurf(`.windsurf/rules/agent-docs.md`, Create trigger) / GitHub Copilot(`.github/copilot-instructions.md`, Append) / Cline(`.clinerules/agent-docs.md`, Create) / Aider(`CONVENTIONS.md`, Create + `.aider.conf.yml` 안내) / Custom(사용자 지정 경로, Append).
- 생성 구조: `agent_docs/` 아래 `README.md`, `.scaffold-version`, `state/`(README, `current.yaml.template`, `checkpoints/checkpoint.md.template`), `references/`(README, `index.yaml.template`), `features/`(README, `index.yaml.template`, `_feature-template/`의 README·meta.yaml·current.md·decisions.md 템플릿과 `workspace/`, `archive/`), `decisions/`(README, `decision-log.md.template`, `ADR.md.template`). 스캐폴드 파일(범용)과 인스턴스 파일(프로젝트별) 구분.
- CLI 옵션: `--yes`/`-y`(false), `--dir=NAME`(agent_docs), `--agent=NAME`(Claude Code), `--no-inject`(false).
- 동작 원리: 작업 시작 프로토콜 `state/ 읽기 → references/ 읽기 → features/ 읽기 → 관련 feature 식별` / 작업 분류: 의도(`plan`, `investigate`, `fix`, `change`, `add`, `refactor`, `govern`) × 범위(`single-feature`, `multi-feature`, `cross-cutting`, `global`) / 작업 종료 프로토콜 `state/current.yaml 갱신 → decisions/decision-log.md 갱신 → feature의 current.md 갱신`.
- 라이선스 MIT.

### 19.2 Mac 수정본에만 있는 것 (`diff` 결과)

1. 「이게 뭔가요?」 절 끝에 추가된 문단(원문): 「이 저장소는 동시에 Helm의 차세대 제품 모델을 연구하고 있습니다. Helm은 여러 에이전트가 일하는 동안 사용자가 방향을 잃지 않고 중요한 선택과 결과의 주인으로 남게 하는 시스템을 목표로 합니다. 사용자·제품 언어는 [쉬운 Helm Foundations](docs/foundations-friendly/README.md), 정밀한 의미 모델과 불변조건은 [Helm Foundations](docs/foundations/README.md)에 있습니다.」
2. 새 절 「Helm System v0 — 실험 단계」(원문): 「Foundations를 실제로 실행하는 vertical slice가 추가되었습니다. 하나의 local-first Event core를 CLI, loopback HTTP/SSE server, SDK, 반응형 Web GUI가 공유합니다. Decision·Commitment·Belief update·다음 행동·read-only Git 관찰을 기록하고, Event cursor에 묶인 Return Brief를 재생성합니다.」 「현재 source checkout 실행에는 Node.js 20 이상이 필요합니다.」 명령 예:

```bash
# 로컬 Helm state 초기화
node packages/helm-cli/bin/helm.mjs init \
  --purpose "에이전트 작업에서 인간의 판단권을 보존한다"

# 중요한 결정과 material state 기록
node packages/helm-cli/bin/helm.mjs record decision \
  --summary "하나의 공유 headless core를 구축한다" \
  --rationale "CLI와 GUI가 같은 상태 모델을 사용해야 한다" \
  --reopen "client가 양립할 수 없는 의미 규칙을 요구할 때"
node packages/helm-cli/bin/helm.mjs capture git

# projection 확인 또는 로컬 GUI 실행
node packages/helm-cli/bin/helm.mjs brief
node packages/helm-cli/bin/helm.mjs web --port 4096
```

   「이 contract는 의도적으로 `experimental.v0`이며 기존 npm initializer의 stable 기능이 아닙니다.」 참고 링크: `docs/architecture/helm-system-v0.md`, `docs/prototypes/system-v0/founder-dogfood-002.md`.
3. OS 비유 표 아래 안내 문구: 저장소 판 「아키텍처 이론에 대한 상세 설명은 [Architecture Fundamentals]를 참고하세요.」 → Mac 판 「현재 스캐폴드 아키텍처는 [Architecture Fundamentals](docs/architecture/fundamentals.md), 차세대 제품 원론은 [Helm Foundations](docs/foundations/README.md)를 참고하세요.」
4. 기여 3단계: 저장소 판 「`packages/@helmdocs/init/` 에서 변경」 → Mac 판 「`packages/agent-docs-init/` 또는 관련 Helm system package에서 변경」.

[정리] README의 현재 상태는 F10 C1(제품 정체성의 이중성)에 적힌 문제와 같다. 루트 README에서 Docs-Agent OS는 주 제품이고 Helm은 「연구」와 「실험 단계」다. 새 설계(B)에서 Docs-Agent OS는 범위 밖이며, C1 정제 방향(legacy scaffold / compatibility profile)을 따른다고 보는 것이 맞다. 다만 B는 이 점을 명시하지 않았다(§20.3).

## 20. 원전 사이의 모순과 변경 이력

### 20.1 v0.1 → v0.2에서 바뀐 것 (F10)

| 주제 | v0.1 (F00~F09) | v0.2 후보 (F10) | 근거 |
|---|---|---|---|
| 제품 정의 | 「지향적 공동행위 시스템(steered co-agency system)」, harness 위의 control plane | 「local-first AI agent system」, 첫 제품은 자체 CLI AI agent | §3, D1 |
| 제품 경계 | Harness를 실행 substrate로 사용(F09 §15). 첫 제품은 L1·L2, read-only Event 수집(F09 §13) | `Helm Product = Kernel + Agent Runtime + Experience`, `Kernel ≠ Agent Runtime`. 목표 순서 CLI agent → Portable Kernel → GUI agent | D1 |
| Docs-Agent OS | Level 0, 점진적 호환 대상(F07 §9) | `legacy scaffold / compatibility profile`로 재분류, 정본 정의에서 분리 | C1 |
| 세계 모델 | 세 세계(F01) 또는 다섯 상태 공간(F05, F09) | `<N, E, M \| A, P>` 세 의미 세계 + 두 통치 평면 | C2, D2 |
| Event의 지위 | 「이미 발생한 사실」(F05), 「불변 사실」(F01) | `LedgerEvent` = 상태 전이에 대한 관찰·주장·수락의 불변 기록. 기록 무결성 ≠ 내용 타당성 | C3 |
| Projection | 정본에서 파생(F07) — 그러나 구현이 `projection.next_action.proposed`를 정본 Event로 append | `projection.*`은 domain write vocabulary가 될 수 없다. 제안은 `normative.action.proposed` 등 domain에 기록 | C4 |
| 인식 구분 | Observation, Inference, Hypothesis, Assumption, NormativeJudgment, Decision (F02) / Claim·Evidence 엔티티(F01). 구현은 `epistemic.belief.updated` + `confidenceBasis` 문자열 | Observation, Interpretation, Possibility, Finding, EvidenceLink, Choice | C5 |
| 품질 | 필수 필드 존재 검사 | absent, captured, structural, qualified, accepted, contested, stale, superseded. unknown·unqualified·contested·stale을 blind spot으로 표시 | C6 |
| 목적 | Purpose(F01), 구현은 `workspace.initialized` payload 하나 | Goal = versioned normative entity, 상위·하위 Goal, 수정·중단·대체·달성 Event | C7 |
| 이식성 | Agent Runtime Adapter(F07 §7) | client contract와 agent adapter protocol 분리, 독립 acceptance test. Adapter protocol 10 동작, Level A~D | C8, §8 |
| 작업 단위 | Concern episode가 최소 단위(F09 §6), WorkUnit은 DelegationContract 실행 단위(F01) | Goal ⊃ Concern ⊃ WorkUnit(Inquiry / Change / Integration) 두 단위 | §5 |
| 강제 수준 | 증명 부담이 위험에 비례(F02 §7), 첫 제품 L1·L2 | Quick / Guided(기본) / Assured profile, profile이 바꾸지 못하는 불변 6 | §5, D3 |
| 법칙 | 원론의 열두 법칙(F09 §16) | 코어의 최소 법칙 후보 12(F10 §6) + authority 포함 관계 공식 | §6 |
| 용어 | Purpose, Decision, DelegationContract, Hypothesis, Claim, Inference, CompletionClaim | Goal, Choice, Work Agreement, Possibility, Finding, Interpretation, Completion Claim / Result | 전반 |
| 행위자 능력 | Capability / Permission / Authority / Responsibility / Accountability(F03 §4) | A 평면 능력 7: observe, propose, decide within scope, execute action classes, attest evidence, accept result, integrate baseline | §4.2 |
| Policy | N 세계의 구성원(F01) | P 통치 평면, 평가 대상 7(privacy and disclosure, recovery and compensation 추가) | §4.2 |

v0.2의 지위: 「비규범적 후보 문서」(FR). D1~D3는 2026-08-22 수락. 「대표 CLI 및 cross-runtime 시나리오 검증 전에는 기존 문서를 대체하지 않는다.」 v0.2 수락 기준 9(§16.13)는 아직 충족되지 않은 상태로 적혀 있다.

### 20.2 원전 내부의 불일치 (v0.1 문서끼리, friendly 포함)

1. **세계 모델 원소 수**: F01 세 세계 vs F05·F09 다섯 상태 공간. v0.2 C2에서 다룬다.
2. **세계 구성원 목록**: §7.3 표. Policy가 F01에서는 N, F05·F09에서는 P. Observation과 Outcome은 F01 세계 목록에 없고 F09 목록에 있다. Question, ConfidenceAssessment는 F01에만 있다.
3. **Event의 진실성**: F05 「이미 발생한 사실」, F01 「불변 사실」. C3에서 수정.
4. **Claim 상태 기계**: F02 §8 `Proposed → Supported ↔ Contested → Accepted → Stale/Superseded/Rejected` vs F05 §6 `Proposed → UnderInvestigation → Supported / Contested → Accepted / Rejected / Undetermined → Stale / Superseded / Reopened`. F05 판이 UnderInvestigation, Undetermined, Reopened를 더 갖고 Rejected 위치가 다르다.
5. **Evidence 상태 기계**: F02 §8 `Observed → Qualified → Linked → Revalidated/Stale/Invalidated` vs F05 §7 `Captured → Qualified → Linked → Revalidated (+ Stale, Invalidated, Superseded)`. 첫 상태 이름(Observed/Captured)과 Superseded 유무가 다르다.
6. **Decision 상태 기계**: F03 §8은 Integrated 뒤에 `Superseded/Reopened`를 직선으로 둔다. F05 §5는 Integrated에서 끝나고 예외 전이(`Open..Deliberating → Deferred/Cancelled`, `Committed..Integrated → Reopened`, `Any accepted state → Superseded`)를 둔다.
7. **위임 상태 기계**: F03 §2 CfA(Request / Reject / Clarify/Counter / Negotiate / Accept / Committed / Performing / Claiming Satisfaction / Reject/Correct / Accepted / Integrated / Closed) vs F05 §4 WorkUnit(Proposed / Negotiating / Delegated / InProgress / ClaimingComplete / Accepted / Integrating / Integrated / Closed + Refused, Blocked, Suspended, CorrectionRequired, Reopened, Cancelled, Superseded). [정리] 대응: Request↔Proposed, Negotiate↔Negotiating, Committed↔Delegated, Performing↔InProgress, Claiming Satisfaction↔ClaimingComplete, Reject/Correct↔CorrectionRequired, Reject→Closed↔Refused. F05에만 Integrating이 있다.
8. **인식적 종류**: F02 §2 여섯(Observation, Inference, Hypothesis, Assumption, NormativeJudgment, Decision) vs F01 불변 3(「Claim은 Observation, Inference, Hypothesis 중 자신의 인식적 종류를 밝혀야 한다」 — Claim이 인식적 종류를 가진다는 구조) vs F09 법칙 3(Observation, Inference, Hypothesis, Decision) vs F10 C5 여섯. Claim이 종류인지 엔티티인지가 문서마다 다르다.
9. **개입 필요도 공식**: F03 §6과 F09 §8의 항목이 다르다(§15.7 끝).
10. **DelegationContract 필드**: F01 §4 아홉 필드 vs F03 §3 YAML(work_unit, review_at 추가, authority_envelope 하위 scopes / allowed_actions / forbidden_actions / resource_limits / external_side_effects).
11. **필수 projection**: F05 §11 파생 뷰 다섯(Common Operating Picture, Return Brief, Inquiry Map, Decision Queue, Integration Map) vs F07 §5 필수 여덟(+ Context Pack, Delegation Board, Assurance View).
12. **리듬**: F04 §6, F06 §9, F09 §10, P03 §3 네 판본(§6.5).
13. **가설 목록과 반증 조건**: F08 H1~H10 vs F09 §17 반증 9개(대응은 §15.16). F09 §17 9번(facilitator 제거)은 F08 가설에 없다.
14. **판단(Finding)의 뜻**: P01·PY는 판단 = Claim(원론), 뜻은 「현재 근거 안에서 참으로 받아들이는 내용」. F01 Claim은 「참으로 받아들이기를 제안하는 명시적 진술」. F10 Finding은 「현재 범위에서 수락된 Claim」. 즉 friendly의 판단은 F10 Finding과 같고 F01 Claim 전체와는 다르다. B §6은 「"판단"은 Finding만 가리킨다」로 정했다.
15. **결과 확인의 원론 대응**: P01·P06 `Acceptance / Assurance`, PY `Acceptance`, P01·PY 피할 표현에서 Assurance → 「근거 검토」. Assurance가 「결과 확인」인지 「근거 검토」인지 두 판이 있다.
16. **복귀 요약의 원론 대응**: P01 `ReturnBrief / ContextProjection` vs P06 ContextProjection → ContextView(맞춤 상황), ReturnBrief → Brief.
17. **Escalation 표현**: P01 「도움 요청 / 선택 필요」, PY 「도움 요청」, P05 버튼 「내 선택이 필요함 / 담당자에게 도움 요청」.
18. **완료 라벨과 Closed**: PY `integrated: 완료`. F05의 Closed(후속 약속 없음, 회고 가능)는 UI 이름이 없다. P01 「`완료`는 전체 반영까지 끝났을 때만 단독으로 사용」, P04 §5 「이 과정이 끝나야 … `완료`로 표시」. Integrated와 Closed 가운데 어느 것을 「완료」로 볼지 원전이 정하지 않았다.
19. **같은 라벨의 중복**: 「결과 확인됨」이 work_statuses `accepted`와 choice_statuses `result_checked`에 함께 쓰인다.
20. **복귀 요약 고정 표현**: P05·PY 「지금 선택이 필요함」 vs P07 예시 「지금 할 일」.
21. **맡긴 범위 항목**: F03 §5 아홉 차원(Value sensitivity 포함, forbidden 없음) vs P04 §1 여덟 항목(금지된 행동 포함, Value sensitivity 없음).
22. **근거 질문**: F02 §3 여덟 차원 vs P04 §3 일곱 질문(Reliability 없음).
23. **CollectiveActor / 팀**: 원전 전반(F01, F07 §8 SaaS, F09 §14, P01 팀, P07 「한 팀」)이 다중 사용자를 전제한다.

### 20.3 원전과 설계 브리프(2026-10-11)의 차이

B가 우선한다(B 머리말). 설계 문서는 아래 차이를 알고 원전 내용을 가져와야 한다.

| # | 주제 | 원전 | 브리프 | 담당 문서 |
|---|---|---|---|---|
| 1 | 첫 클라이언트 | v0.2 D1: 자체 CLI AI agent 우선, GUI는 세 번째 목표 | #19: 데스크톱 앱 먼저, 이후 SSH TUI. 웹 아님 | 01, 06, 20, 24 |
| 2 | 실행 위치·상주 | local-first, 오프라인 동작(F07 §8, F09 §14) | #20~22: 개인 WSL2 서버에서 실행, 외부 접속, 데몬 상주, 클라이언트 없이 작업 계속 | 06, 17, 18, 19 |
| 3 | 런타임 | v0.1: harness를 substrate로 쓰는 control plane(F09 §15), 첫 제품은 read-only 수집(F09 §13). v0.2: first-party Agent Runtime 포함 | #23: 자체 런타임, pi 패키지 재활용·포크 | 07, 12, 13 |
| 4 | 저장소 | experimental.v0 JSONL Event ledger(F10 §1). 저장 형식 독립(F05 §14) | #29: SQLite WAL 이벤트 로그가 기준 원본 | 09 |
| 5 | 사용자 수 | 팀·CollectiveActor·SaaS·다중 사용자 권한(F01, F07 §8, F09 §14) | #24: 혼자 쓰는 앱 | 01, 08, 18, 24 |
| 6 | 루프 | 네 루프 O / I / C / A(A = Assurance and Adaptation) | #5: 다섯 루프 O, I, C, A, S. 루프 식별자 I.fact, I.want, I.possibility, I.outcome, C.commit, C.probe, C.emergency, A.confirm, A.watch, A.reflect, S.* (B §6) | 14 |
| 7 | 모드 | F06 §9: Explore / Build / Stabilize / Incident / Reflect, 「Gate 임계치와 ContextProjection을 조정」 | #3: 모드 = 루프 계획 기본값 + 능력 부분집합 + 다이얼 값. 페르소나 아님 | 14 |
| 8 | 강제 수준 | v0.2 Quick / Guided / Assured, Guided 기본(D3) | 브리프에 profile 언급 없음. 모드·다이얼과의 관계 미정 | 10, 14 (미결 사항으로) |
| 9 | Effect class·가역성 | F03 Action class·Reversibility 차원, v0.2 Assured 「effect class별 강제된 Authority Envelope」, profile 불변 「Authority는 scope와 effect class를 가진다」 | #2: Effect class와 가역성 판별은 Helm 범위 밖, 권한 레이어의 일 | 10, 11, 13 |
| 10 | 능력 | F03 다섯 구분, v0.2 A 능력 7 | #4: 원시 행동 read, write, execute, send, spawn, ask + 기록 능력 observe, propose, attest, accept, integrate | 08, 10, 13 |
| 11 | 대안 제시 | F06 §4 Gate의 Options·Recommendation·Alternative, P02 「선택지와 추천」, P07 추천 + 다른 선택 | #18: 대안 2~3개를 던지고 고르게 하는 상호작용 거부. 원함 탐구는 반응(요소 단위, 이유 없는 반응 포함) 기록. 「모델이 초안을 쓰고 사람은 반응·수정한다」(recognition over recall) | 05, 11, 15 |
| 12 | 출발 동기 | 주의력·판단권 보존, 정당화된 진전(F00) | #1: 원함 발견. 취향이 정답인 작업(글의 톤, 기획 방향, 디자인)에서 출발. 발산은 그 방법 | 01, 15 |
| 13 | Concern 정의 | F01 「가장 일반적인 관심 단위」, F10 「문제, 기회, 위험, 불확실성」 | #11, B §6: 「10단계 과정을 돌릴 후보가 되는 상황 그 자체(문제, 기회, 위험, 불확실성, 취향 결정)」 | 08, 25 |
| 14 | Goal 정의 | F10 C7 versioned normative entity, 상위·하위 Goal | #11: 프로젝트 단위 궁극 목표, Concern 사이클을 거치며 정제. Goal 변경 시 사람 확인 [제안] | 08, 10 |
| 15 | WorkUnit 종류 | F10: Inquiry / Change / Integration | B §6: 탐구, 탐침, 변경, 반영 | 08, 14 |
| 16 | 탐구 | 경쟁 가설 ACH, HypothesisSet(F02) | #7: 탐구 네 종류(사실, 원함, 가능성, 결과), Method Transfer(#13) | 15 |
| 17 | 질문·개입 | Decision Gate 13필드, 개입 허용 조건, attention_policy `maximum_active_gates: 3` | #12: 질문 레코드, 기록과 전달 분리, 권리 게이트/정보 게이트, 전달 방식(즉시·협상·중재·예약), 가정 만료점, 다이얼 [제안]. #16: 질문 조건 AND 기본 + 조건별 문턱 | 11 |
| 18 | 혼자 정한 결정 | F06 §12 금지 4(「사용자가 보지 않은 상태 변경을 이미 합의된 것으로 표현」), F05 독립성 표시 | #8: 혼자 정한 결정을 기록하고 나중에 확인·이의(불변조건 7). 화면 이름 「에이전트가 정한 것」, `why_not_asked` | 11 |
| 19 | 불변조건 집합 | F05 I1~I12, F01 존재론 8, F03 통치 8, F04 co-agency 7, F05 Event 5, F10 최소 법칙 12, F10 profile 불변 6 | #17: v0.3 불변조건 1~7(`docs/v0.3/00-README.md` §2.4)이 어떤 모드·다이얼에서도 바뀌지 않는다 | 10 (원전 불변과 v0.3 불변 1~7의 대응표 필요) |
| 20 | 의존 규칙 | F05 I1·I3·I4·I5, F10 최소 법칙 6 | #15: (1) write·send에는 C 필요 (2) 「완료」에는 A 필요 (3) 판단 승격에는 I 근거 필요 [결정], (4) 하위 Concern 재조합 후 닫힘 (5) Goal 변경 시 사람 확인 [제안] | 10, 14 |
| 21 | 가설 수 | H1~H10 | §3.4 16번: 「H1~H8」 | 16 (열 개 모두 다루고 차이를 보고) |
| 22 | 성숙도 | 제품 성숙도 Level 0~5(F09 §12) | §3.5: 「성숙도 L1~L5」(루프 관련 맥락) | 14 |
| 23 | 커널 원칙 | v0.2 「First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다」, Kernel이 Command validation과 domain transition 소유 | #14: 모델은 제안하고 커널이 상태를 바꾼다. 「모델이 구조화된 값을 선언할 수 있으면 결정은 코드가 한다」 | 10 (일치) |
| 24 | 투영 | ContextProjection, Projection은 정본을 쓰지 않음 | #13, B §6: 투영 = 정본을 읽어 만든 화면이나 모델 컨텍스트 | 12 (일치) |
| 25 | 사용자 언어 | friendly: Concern→초점(Focus), Claim→판단(Finding), UI 한국어 기본 | #37: UI 문구 한국어. B §6 용어집은 Concern·WorkUnit 등 원론 이름을 그대로 쓰고 「초점」을 쓰지 않는다. 화면 이름 「에이전트가 정한 것」 | 05, 21, 25 (제품 용어 확정 필요) |
| 26 | 관찰 정의 | F02 Observation: 도구 출력, 사용자 관찰, 파일 상태 / P01 「직접 보거나 도구로 확인한 것」 | B §6: 「실제 실행 기록(도구 결과, 외부 응답)을 출처로 갖는 E 레코드」. 외부 응답도 관찰(#9) | 08, 15 |
| 27 | 런타임 언어·버전 | RKm: Node.js 20 이상(experimental.v0) | #36: Node.js 22 LTS, TypeScript strict, pnpm, Vitest, TypeBox, better-sqlite3 | 06 |
| 28 | Docs-Agent OS | README 주 제품, F10 C1은 legacy로 재분류 제안 | 언급 없음 | 00, 01 (범위 밖 명시 권장) |
| 29 | 어댑터 | v0.2 adapter protocol 10 동작, Level A~D, Codex·Pi·OpenCode 이식이 두 번째 목표 | #34: 어댑터 인터페이스를 지금 정의, 1차 구현은 자체 런타임 하나. Claude Code, Codex, pi CLI(RPC), ACP 어댑터는 이후 | 06, 13 |
| 30 | 클라이언트 프로토콜 | v0.1 vertical slice HTTP/SSE(F07 §15) | #31: JSON-RPC 2.0 over WebSocket, 단조 시퀀스, `lastSeq` 재전송, 큰 데이터는 HTTP | 19 |

## 21. 설계에 바로 쓸 체크리스트

문서 번호와 소유는 B §3.4. 각 문서가 원전에서 반드시 가져갈 항목이다. 괄호 안은 이 정리본의 절 번호다. 브리프와 다른 원전 내용은 §20.3을 함께 본다.

### 00 `00-README.md` (조정자)
- 원전 지위와 우선순위: 의미·안전은 원론, 사용자 이름은 friendly, v0.2는 비규범 후보, 브리프가 최우선(§2).
- 원전 대비 바뀐 결정 목록(§20.3) 요약: CLI→데스크톱, 로컬→WSL 데몬, 팀→1인, 4루프→5루프, 모드 정의 변경, effect class 범위 밖, H1~H10.
- Docs-Agent OS를 범위 밖 또는 legacy로 둔다는 사실(§19.2 끝, C1).

### 01 `01-product-brief.md` (P1)
- Helm 정의 판본과 최종 문장(§3.1). 최상위 목적(§3.2). justified progress 공식과 네 조건(§3.3).
- 공리 A1~A15 요약과 쉬운 원칙 10(§5).
- 비대칭 표, 인간·에이전트·도구 역할(§4.1).
- 비목표 세 목록(F00 8, F10 5, P00 7)과 기술 비목표 6(§4.2, §13.13). 혼자 쓰는 앱이므로 CollectiveActor·SaaS·팀 기능을 범위 밖으로 명시(§20.3 #5).
- 제품 약속 8 + 일곱 약속 + UX 4 질문(§4.3).
- 좋은 경험 6(F09 §10), 즐거움 6(F06 §11), SDT(§10.5). 게임화 금지.
- Harness vs Helm 표(§15.14).
- 성공 지표: 초기 성공 기준 5(「하루 뒤 5분 이내」 포함), H1~H10 지표, 피벗 기준 7, 반증 조건 9(§14, §15.16).
- 성숙도 L0~L5와 첫 제품 경계 MUST/SHOULD/NOT YET을 브리프 범위와 대조(§15.11~§15.12).
- Quick/Guided/Assured와 Guided 기본값(D3)의 채택 여부(§16.6).
- v0.2 수락 기준 9 가운데 아직 의미 있는 것(§16.13).

### 02 `02-usecases-and-scenarios.md` (P1)
- P07 결제 흐름 예시 9단계를 유즈케이스 서술 틀로 쓸 수 있다(§17.8). 1인 사용으로 바꿔 적는다.
- P02 8단계 흐름과 단계별 사용자 경험·가치(§17.3).
- F10 cross-runtime 대표 시나리오 10단계(§16.10). 브리프에서는 런타임 어댑터가 이후 단계이므로 「클라이언트를 바꿔도·자리를 비워도 이어진다」로 바꿔 쓸 수 있다.
- 다시 열림 상황 6(§6.6), 결과 확인 4 행동(수정 요청 / 조건부 확인 / 결과 확인 / 다시 조사, §17.5), 실패와 복구 5 요소(§17.5).
- F08 질적 연구의 일곱 순간(§14.4)을 유즈케이스 후보로 검토.
- 수용 기준: 초기 성공 기준 5(§14.7), 인식적 완료 조건 6(§8.10).

### 03 `03-ux-information-architecture.md` (P2)
- navigation 6(오늘 / 초점 / 진행 작업 / 선택 / 근거 / 자동화 규칙). Agent·Timeline·Artifact는 보조 view(§17.7, §18.2).
- F10 UX 4 질문, 「상세 activity와 transcript는 drill-down source」(§4.3).
- 세 묶음(방향 / 이해 / 실제 변화)을 하나의 초점 안에서 연결해 보여주기(§17.2).
- 파생 뷰 5와 필수 projection 8을 화면으로 대응(§11.11, §13.5).
- 사용자 시점 객체 모델 = crosswalk 대응표(§17.7)와 엔티티 총목록(§7.12).
- B #10 상태 중심 UI(OPD+C 관찰·제어 공간)와 F07 Experience Layer(Brief · Inquiry · Decision · Integration).

### 04 `04-ux-screens.md` (P2)
- fixed_sections 4(복귀 요약, 선택 요청, 진행 작업, 결과 확인)(§18.5).
- Return Brief 계약 5절(§12.5), Decision Gate 13필드와 고정 표현 대응(§12.4), 선택 요청 깊이 3(§12.13).
- 맡긴 범위 8항목(§9.5), 결과 확인 트리(§17.5), 전체 반영 체크 5(§17.5), Integration Review 6(§12.8), Delegation Interaction 8(§12.7), Inquiry Interaction 7(§12.6).
- 상태 라벨 work 14, choice 7(§18.3~§18.4). Closed·Refused·Deferred 등 라벨 없는 상태 처리(§20.2 #18).
- 인식적 UI 원칙 7(§8.9). 「모름」 상태를 정상 상태로 표시. 빈 상태·오류 상태에 이 원칙 적용.
- Evidence 품질 질문 7(§8.3), 근거 개수로 강도 표시 금지.
- 자동화 역설 MUST 5(§10.7): 자율 중에도 현재 의도와 예상 경로 표시.

### 05 `05-ux-interaction-and-copy.md` (P2)
- UX writing 규칙 전부: 목소리 5, 문장 순서, 고정 표현, 버튼 표 8과 위험 행동 버튼 규칙, 상태 문장 예시 4, 불확실성 표현, Agent 표현 4, 알림 기준, 언어 규칙 4(§17.6).
- 화면에서 쓰지 않을 말 16(§17.2, §18.6)과 PY 차이(§18.7).
- 금지 상호작용 10(§12.12), 안티패턴 7(§10.8).
- 개입 허용 조건 8과 비생성 5(§12.3), 침묵할 권리(§12.2).
- attention_policy와 Gate 우선순위 5요소(§12.10). 알림: 단순 진행 Event는 보내지 않고 복귀 요약에 묶는다.
- Contestability: 이의 걸기 흐름(§10.3, §12.2 이의를 제기할 권리).
- 브리프 #18: 대안 나열형 선택 대신 초안 + 반응. 원전의 Options/Recommendation 필드와 조정(§20.3 #11).

### 06 `06-system-architecture.md` (P3)
- 아키텍처 요구 8, 논리 계층 7(「계층은 배포 단위가 아니라 의미 경계」)(§13.1~§13.2).
- `Helm Product = Kernel + Agent Runtime + Experience`, `Kernel ≠ Agent Runtime`, 소유 경계 표(Kernel / Runtime Adapter / Client / Agent Runtime)(§16.3, §16.8).
- 「Client는 domain validation이나 정본 state를 별도로 소유하지 않는다」, 「First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다」.
- C8: client contract와 agent adapter protocol 분리, 각각 독립 acceptance test(§16.2).
- 아키텍처 결정 평가 질문 8을 ADR 양식에 넣는다(§13.14).
- 기술 비목표 6(§13.13), 저장 형식 독립(§11.14), 최소 법칙 10(특정 runtime 없이 읽고 내보내기).
- 보안 MUST 5(§13.12)를 18과 나눔.

### 07 `07-pi-reuse-and-fork.md` (P4)
- 「특정 모델 공급자의 세션 구조를 Domain model로 채택」 금지(F07 §13), 「특정 vendor의 session ontology를 Helm ontology로 채택」 금지(F10 비목표), 「vendor별 이름을 코어 schema에 넣지 않는다」(F10 §8).
- Adapter 책임 6과 비책임 4(§13.7). pi 세션 트리나 pi-durable 저장소를 정본으로 쓰지 않는 근거(브리프 #29와 일치).
- Adapter protocol 10 동작과 Level A~D로 pi 각 층의 능력을 기술(§16.9).

### 08 `08-domain-model.md` (P5)
- 엔티티 총목록과 제품 이름(§7.12), F01 핵심 엔터티 정의 16(§7.5), v0.2 새 개념(Goal, Concern/WorkUnit, 인식 6 구분, LedgerEvent)(§7.6).
- 세계·평면 소속 `<N, E, M | A, P>`(§7.2~§7.3), 세 세계 사이 관계 4(§7.3).
- 필수 속성: Concern 6필드, DelegationContract 필드(F01 9 / F03 YAML), Decision 보존 13, Claim 평가 7, Evidence 품질 8차원과 관계 4, ContextProjection 메타데이터(§7.5, §9.3, §9.8, §11.6, §8.3, §11.9).
- 관계 13 + 관계 메타(종류·생성자·시점·근거) + `supersedes`/`invalidates`/`reopens`/`derived_from`(§7.8~§7.9). 쓰기 시점 참조 제약의 원천: 존재론 불변 8(§7.11).
- 상태 기계 7개: WorkUnit, Decision, Claim, Evidence, Commitment, ContextProjection, Integration(§11.4~§11.10). 문서 간 불일치 해소(§20.2 #4~#7).
- 의미 품질 상태 8(§8.11 7번).
- 행위자 4종과 능력(§7.4), 브리프 #4 능력 정의와의 대응(§9.11).
- 「판단」= Finding만(B §6)과 friendly 판단 정의 정렬(§20.2 #14).
- ID와 이름: crosswalk의 Product Domain 이름을 public 타입명으로 쓸지 결정(P06 MUST 「새 public API와 application-layer type은 Product Domain 이름을 우선」, `foundationRef` 추적)(§17.7).

### 09 `09-event-store.md` (P5)
- Event 스키마(id, type, occurred_at, actor, authority_basis, concern, subject, payload, provenance{source, tool}, causation_id, correlation_id)와 Event 불변 5(§11.3).
- Ledger MUST 5, SHOULD 3(§13.3): append-only, 보정은 새 Event, idempotent 외부 수집, 외부 식별자 보존, schema version과 migration, human-readable export.
- `W(t_n) = fold(apply, W(t_0), Events[0..n])`(§11.2).
- C3: 기록 무결성과 내용 타당성 분리. C4: `projection.*`은 정본 Event 어휘가 될 수 없다(§16.2).
- 외부 도구 결과는 원본 식별자 또는 내용 해시 보존. 감사 Event 무결성과 Actor identity 보호(§13.12).
- projection의 Event cursor, stale/invalidated 처리, projection 간 불일치 = projection bug(§13.5).
- 삭제 = 의미적 폐기, 이력 보존(§7.9). deterministic export/import와 provenance(§16.8 Kernel).

### 10 `10-kernel.md` (P6)
- 공리 A1~A15 전체 대응(분류, 집행 지점, 보장 수준, 위반 테스트)(§5). A11 투영 규칙, A15 선택지.
- 불변조건 집합 전부: 전역 I1~I12(§11.12), 존재론 8(§7.11), 통치 8(§9.10), co-agency 7(§10.9), Event 5(§11.3), 최소 법칙 12(§16.7), profile 불변 6(§16.6), 열두 법칙(§15.15). v0.3 불변 1~7과의 대응표(§20.3 #19).
- Decision 전이 규칙 7(§11.5), WorkUnit 진입 조건(§11.4), Claim·Evidence 승격 규칙(§8.11).
- authority 포함 관계 `RequestedAuthority ⊆ CurrentAuthorityGrant`, 「이미 한 번 맡겼다」로 권한이 이어지지 않음(§9.5).
- 자동 승격 금지, 쓰레기 입력이 blind spot 없음으로 승격되지 않음(C6), 독립성 수준 표시(§11.4).
- 충돌: `ConflictDetected` Event + 별도 Concern, last-write-wins 금지, 해결은 Decision 또는 정책으로만(§11.13). 의미적 lease 5항목(§13.11).
- 「위반하는 Event는 거부하거나 명시적 예외 Decision을 요구한다」 → 거부 분류(내용·자격·경로)와 연결.
- Quick/Guided/Assured와 모드·다이얼의 관계를 미결 사항으로(§20.3 #8).

### 11 `11-asking-and-autonomy.md` (P6)
- 개입 허용 조건 8, 비생성 5, P03 비생성 6(§12.3). Gate 생성 조건 「추가 인간 판단이나 실험이 결과를 바꿀 수 있을 때」(§8.6).
- 개입 필요도 두 판(F03 §6, F09 §8)과 개입해야/말아야 순간(§9.6, §15.7). 「안정 수식이 아니라 설명 가능한 Gate rationale」, weight는 pilot 전 확정하지 않음.
- 보충성 7 경우(§9.7), 선택 요청 깊이 3(§12.13).
- Decision Gate 13필드, 특히 Alternative(실험·위임·연기)와 Reopen trigger(§12.4).
- 금지 상호작용 8(중복 질문)과 10(침묵을 승인으로 해석), 4(보지 않은 변경을 합의로 표현)(§12.12).
- attention_policy(`maximum_active_gates: 3`, `interrupt_only_for` 3종, `batch_low_urgency_until`, `detail_preference`)와 Gate 우선순위 5요소(§12.10). Governance Engine의 유사 Gate 병합(§13.6).
- 「알아서 해」를 비가역 외부 변경까지 확장하지 않음(§9.4). Escalation Event(통치 불변 6).
- 혼자 정한 결정과 독립성 표시(§11.4)를 브리프 #8과 연결.

### 12 `12-runtime-engine.md` (P7)
- Context Compilation 입력·출력과 「반대 증거 보존을 제약 조건으로」(§13.10).
- ContextProjection 메타데이터와 상태 기계(Requested → Materialized → Delivered / Refreshed / Invalidated / Expired), purpose 5종(resumption, execution, deliberation, review, handoff)(§11.9). A11(§5). I7, I10.
- Context flooding 금지, 긴 원문 덤프 금지(§10.8, §12.12 #6). H7 지표(§14.3).
- 실패와 복구: 마지막 확인 지점, 다시 실행해도 안전한지, 이미 실행된 외부 행동(§17.5). 「실패 시 처음부터 로그를 재구성하지 않고 결정·증거·약속의 경로를 따라 복구」(§10.7).
- Commitment 실패·철회·재협상 6(§9.9).

### 13 `13-tools-and-execution.md` (P7)
- Authority Envelope 9차원과 action class(읽기, 제안, 로컬 변경, 배포, 외부 메시지)(§9.5). DelegationContract `authority_envelope` 하위 필드(§9.3).
- 통치 불변 1·2·5(권한 ≤ 도구 능력, 비가역 외부 행위의 명시 권한)(§9.10). I9.
- 보안 MUST: 최소 권한 WorkUnit 단위, 외부 부작용·데이터 공개는 별도 Action class, Prompt와 실행 권한 분리. SHOULD: 샌드박스·승인·롤백을 Adapter capability로 표준화, dry-run과 영향 미리보기, 정책 위반 = Governance Event(§13.12).
- Adapter protocol 10 동작, Level A~D, capability negotiation, 「지원할 수 없는 capability를 명시적으로 보고」(§16.8~§16.9).
- 브리프 #2(effect class 판별은 권한 레이어)와 원전의 Action class 차원 정렬(§20.3 #9).

### 14 `14-loops-modes-orchestration.md` (P8)
- 10단계 사이클과 단계별 입력·출력·조건(§6.1~§6.2), episode(§6.3), 리듬 4판(§6.5).
- 네 루프 O/I/C/A의 목표·흐름·primitive·핵심 질문(§15.3), 결합 그림과 재진입 6(§15.4, §6.6). 브리프 다섯 루프와의 대응(§20.3 #6).
- 모드 5(F06 §9)와 브리프 모드 정의의 차이(§12.9, §20.3 #7).
- 성숙도 L0~L5(§15.11). 주의력 예산(§12.10). OPD+C(§10.3).
- Quick/Guided/Assured profile과 모드·다이얼의 관계(§16.6).
- OICA = 흐름, NEMAP = 상태, OPD+C = 평가(B §3.5): 원전의 N/E/M + A/P(§7.2)와 OPD+C(§10.3)를 근거로 쓴다.

### 15 `15-inquiry-engine.md` (P9)
- 인식론 전체(§8): 인식적 종류, 증거 8차원과 관계 4, 주장–논증–증거, 경쟁 가설(Hypothesis Set 6, 보고 5), 불확실성 6종, 증명 부담 표, 재개 조건 6, 인식적 UI 원칙 7, 인식적 완료 조건 6.
- A4(가설 다양성), A3(문제 정의는 결과의 일부), 법칙 2·4(§5, §15.15).
- Inquiry Interaction 7(탐구 중단 비용 vs 기대 정보 가치 포함)(§12.6). Inquiry Map(§11.11).
- H3 지표(hypothesis diversity, discriminating experiment count, counterevidence coverage, post-integration design defect rate)(§14.3).
- 에이전트 간 합의를 독립 증거로 보지 않음(§8.9 #7). 근거 규칙 = 판단 승격 규칙(§8.11).
- P07 가능성 비교 표 형식(지지 근거 / 반대 근거 / 다음 확인)(§17.8).

### 16 `16-observer-and-metrics.md` (P10)
- 가설 H1~H10 전체의 예측·지표·반증(§14.3). 브리프의 「H1~H8」과 차이 보고.
- 비교 기준선 3(§14.2), 질적 연구 순간 7과 인터뷰 질문 5(§14.4), 실험 Phase A~D(§14.5), 피벗 기준 7(§14.6), 초기 성공 기준 5(§14.7).
- 운영 이론 반증 조건 9(§15.16), 다음 Evidence 7(§15.17), v0.2 수락 기준 9(§16.13).
- 최소 법칙 11(「자동화가 복귀 능력·예측 가능성·방향 수정 능력을 낮추면 실패로 측정」), A12, 법칙 12(Reflection이 실제로 Context·Contract·Policy를 바꿔야 함).
- OPD+C를 공동행위 평가 기준으로(§10.3). 관찰 에이전트의 제안은 Reflection 사건(§7.5)으로 이어진다.

### 17 `17-daemon-and-operations.md` (P11)
- 「시간 간격과 세션 경계를 넘어 상태 복원」(§13.1), 오프라인에서도 핵심 기능(§13.8)을 데몬·원격 구조에서 어떻게 지킬지.
- 사람이 읽을 수 있는 export, 이력 보존(삭제 = 의미적 폐기), schema version과 migration(§13.3, §7.9).
- 「모든 상태를 실시간 동기화해야만 동작하도록 설계」 금지(§13.13).

### 18 `18-security.md` (P11)
- 보안 MUST 5, SHOULD 3(§13.12). 특히 「민감한 원본 Evidence가 projection과 SaaS로 유출되지 않도록」(1인 앱에서는 projection·원격 클라이언트로 읽기), 「감사 Event 자체의 무결성과 Actor identity를 보호」.
- P 평면의 privacy and disclosure 정책(§9.11).
- 「Prompt 내용과 실행 권한을 분리」(프롬프트 주입이 권한을 넓히지 못함).

### 19 `19-client-protocol.md` (P12)
- C8: client contract와 adapter protocol 분리, 독립 acceptance test(§16.2).
- Return Brief는 「마지막 확인 cursor 이후」(§12.5), projection은 Event cursor를 가진다(§13.5). 사용자별 마지막 확인 cursor를 프로토콜에 둔다.
- 「Client는 domain validation이나 정본 state를 별도로 소유하지 않는다」(§16.8).
- public API 이름은 Product Domain 이름 우선(P06 MUST)(§17.7).
- 예외·막힘 상태 문구에 필요한 데이터(권한 부족 사유, 가능한 다음 행동)(§17.6 상태 문장 예시).

### 20 `20-desktop-app-architecture.md` (P13)
- Client 소유 범위: surface, Brief/Explore/Choice/Review 상호작용 표현, 접근성, progressive disclosure, 알림 채널(§16.8).
- 알림 기준: 할 일과 마감 효과, 단순 진행 Event 금지, 낮은 우선순위는 복귀 요약에 묶음(§17.6). attention_policy의 `preferred_review_windows`, `batch_low_urgency_until`(§12.10).
- 금지 상호작용 2(모든 진행 Event를 실시간 알림으로)(§12.12).

### 21 `21-desktop-ui-system.md` (P14)
- 권장 component 이름(`GoalSummary`, `FocusRoom`, `PossibilityComparison`, `EvidenceView`, `ChoiceRecord`, `ActiveWorkCard`, `SinceLastVisit`, `ReviewGroup` 등)(§17.7).
- 시각화: Inquiry Map(근거 체인), Integration Map, Decision Queue, Common Operating Picture(§11.11). P07 가능성 비교 표.
- 사실과 해석의 시각적 구분, 불확실성 원인 우선, confidence 숫자 금지, 소수 반대 증거 유지(§8.9, §17.6).
- 위험 버튼에 대상·효과 표시(§17.6). 상태 라벨 집합(§18.3~§18.4).
- Agent 표현: 이름보다 역할과 맡긴 일, 의인화 금지(§17.6 §7, §10.8).

### 22 `22-testing-strategy.md` (2단계)
- copy test와 fixture의 기준 = product-language.yaml(§17.7 끝, §18).
- 불변조건 위반 테스트: I1~I12와 각 불변 집합(§11.12 등). 상태 기계 전이 테스트(§11.4~§11.10).
- C6 사례(`summary: ㅇ`, `rationale: ㅁㄴㅇ`)를 회귀 테스트로: 형식 검사를 통과한 쓰레기 입력이 blind spot 없음으로 승격되지 않는다(§8.11).
- 최소 법칙 12(「모든 안정 schema는 실제 cross-runtime scenario의 증거를 통과한 뒤 승격」), F07 §9 변경 원칙 4, client·adapter acceptance test 분리(§16.2).
- F08 Phase A~D와 비교 기준선을 사용성 검증 계획에 반영(§14.2, §14.5).

### 23 `23-implementation-plan.md` (2단계)
- 성숙도 순서: 「각 Level은 앞 Level의 사용자 가치를 검증한 뒤 진행한다」(§15.11). 첫 제품 경계(§15.12).
- crosswalk 도입 순서 6(§17.7). F07 §9 변경 원칙 5(§13.9).
- v0.2 다음 작업 7과 수락 기준 9 가운데 브리프 범위에서 유효한 것(§16.13~§16.14).

### 24 `24-adr.md` (P3 시작, 전원 추가)
- D1~D3(§16.12)와 C1~C8 정제 방향(§16.2)을 이전 결정으로 기록.
- 브리프 결정이 원전을 바꾼 항목(§20.3) 각각을 ADR로: 데스크톱 우선(#1), WSL 데몬(#2), 자체 런타임(#3), SQLite(#4), 1인(#5), 5루프(#6), 모드 재정의(#7), effect class 범위 밖(#9), 대안 나열 거부(#11).
- 원전 내부 불일치 해소 결정(§20.2): Claim·Evidence·Decision 상태 기계 판본 선택, 세계 모델 판본, 「완료」 = Integrated 또는 Closed.
- ADR에 F07 §14 평가 질문 8을 넣는다.

### 25 `25-glossary.md` (2단계)
- P01 용어 표 전부와 화면에서 쓰지 않을 말(§17.2), P06 대응표 두 개(§17.7), PY terms 32·navigation·상태·고정 표현·피할 라벨(§18).
- 원론 영어 이름, Product Domain 이름, 한국어 UI 이름의 세 열 유지. 브리프 §6 용어집 초안과 friendly 이름이 다른 항목(Concern/초점, 판단 = Finding, 관찰 정의, 결과 확인/근거 검토, 복귀 요약/맞춤 상황, 도움 요청/선택 필요) 확정(§18.7, §20.2 #14~#17, §20.3 #25~#26).
- 규범 키워드 MUST/SHOULD/MAY(§2.1).

<!-- 0단계 완료 -->
