# Helm 원전 정리 2: architecture · experience · prototypes · experiments · packages

- 작성: 2026-10-11, 0단계 에이전트 S1b
- 용도: 설계 에이전트 14개가 원천 대신 읽는 자료. 정의, 목록, 숫자, 필드, 스키마, 순서를 줄이지 않고 옮긴다.
- 범위: `docs/architecture/`, `docs/experience/`, `docs/prototypes/`, `experiments/{helm-kernel-v02,helm-sidecar,durable-spike,helm-toy,pi-lab}`, `packages/helm-{core,cli,server,sdk}`, `apps/helm-web`, 루트 `package.json`. foundations·friendly는 `helm-canon.md`, research·방법 카드는 `helm-canon-3.md`가 다룬다.
- 표기
  - 출처는 `경로 §절` 또는 `경로:줄`로 적는다.
  - `[원문]`: 파일을 직접 읽어 확인한 것. 따로 표시가 없으면 이 문서의 모든 내용은 `[원문]`이다.
  - `[실험]`: 이번 작업에서 코드를 실행해 확인한 것(실행은 `experiments/` 안에서만 했다).
  - `[해석]`: S1b의 정리·분류. 원문에 없는 판단이다.
  - 원문이 영어인 경우 의미를 한국어로 옮기고 식별자·이벤트 이름·필드 이름은 그대로 둔다. 짧은 인용은 원문 그대로 둔다.
- 주의: 이 문서의 v0.1·v0.2 내용은 2026-08 시점 원전이다. 2026-10-11 브리프(`00-design-brief.md` §2)와 충돌하면 브리프가 우선한다. 충돌 지점은 각 절의 "브리프와의 관계"에 적었다.

## 0. 읽은 파일 목록

분량은 줄 수다. "핵심 한 줄"은 S1b의 요약이다.

### 0.1 기준·아키텍처·경험 문서

| 경로 | 분량 | 핵심 한 줄 |
|---|---:|---|
| `docs/design/process/00-design-brief.md` | 301 | 설계 공통 전제. 문서 01~25 소유, 감사 누락 항목 담당, 문체 규칙 |
| `docs/architecture/helm-kernel-v0.2-candidate.md` | 1180 | 커널·어댑터 아키텍처 v0.2 후보. P1~P7, 정본 계약 4종, 어휘, 품질 모델, 정책, 투영, 어댑터 protocol, 저장, 실패, 테스트, 수용 기준 |
| `docs/architecture/helm-system-v0.md` | 249 | experimental.v0 구현(헤드리스 core + CLI + HTTP/SSE + Web) 설명 |
| `docs/architecture/fundamentals.md` (저장소판) | 344 | Helm 이전 제품 Docs-Agent OS(문서 기반 에이전트 운영 체계)의 원론 |
| `.helm-design-work/mac-modified/docs/architecture/fundamentals.md` (Mac 작업본) | 346 | 저장소판에 상위 철학 위임 문장 1줄 추가(§4.2) |
| `docs/experience/README.md` | 8 | experience 디렉터리 안내. 정본 상태는 정의하지 않음 |
| `docs/experience/helm-cli-agent-v0.2.md` | 706 | first-party Helm CLI AI Agent 경험 계약. 다섯 surface, Gate 조건, 금지 경험 10개 |

### 0.2 프로토타입 문서

| 경로 | 분량 | 핵심 한 줄 |
|---|---:|---|
| `docs/prototypes/paper-v0/README.md` | 107 | paper prototype 범위(네 primitive), 상호작용 문법 10개, 성공 조건 |
| `docs/prototypes/paper-v0/templates/inquiry-map.md` | 97 | 탐구 지도 템플릿 |
| `docs/prototypes/paper-v0/templates/decision-gate.md` | 113 | 결정 게이트 템플릿 |
| `docs/prototypes/paper-v0/templates/delegation-contract.md` | 130 | 위임 계약 템플릿 |
| `docs/prototypes/paper-v0/templates/return-brief.md` | 115 | 복귀 요약 템플릿 |
| `docs/prototypes/paper-v0/examples/helm-transition/inquiry-map.md` | 102 | 실제 Concern(`helm-product-transition`)으로 채운 탐구 지도 |
| `docs/prototypes/paper-v0/examples/helm-transition/decision-gate.md` | 111 | 실제 결정(A→B 순차 전략)을 기록한 게이트 |
| `docs/prototypes/paper-v0/examples/helm-transition/delegation-contract.md` | 130 | 결정을 전개한 위임 계약(claiming-complete) |
| `docs/prototypes/paper-v0/examples/helm-transition/return-brief.md` | 113 | dogfood 001 이후 복귀 요약 |
| `docs/prototypes/paper-v0/experiment-protocol.md` | 347 | 평가 프로토콜 v0.1. RQ1~5, Study 0~3, 조건 A~C, SA probe, 지표 |
| `docs/prototypes/paper-v0/runs/README.md` | 4 | run 목록 |
| `docs/prototypes/paper-v0/runs/founder-dogfood-001/README.md` | 166 | dogfood 001: paper Gate → read-only sidecar, 측정과 가설 판정 |
| `docs/prototypes/paper-v0/runs/founder-dogfood-001/sidecar-context.json` | 43 | sidecar에 넣은 사람 작성 의미 입력 7개 |
| `docs/prototypes/system-v0/README.md` | 12 | system v0 안내 |
| `docs/prototypes/system-v0/founder-dogfood-002.md` | 155 | dogfood 002: 헤드리스 core + CLI + GUI, 89→5 묶음, 비밀 경계 결함 |
| `docs/prototypes/agent-v0.2/helm-cli-guided-001.md` | 375 | CLI-G01 시나리오(거짓 "no blind spots"), 박자 8개, 실패 주입 F1~F6 |
| `docs/prototypes/agent-v0.2/runs/codex-kernel-baseline-001.md` | 232 | Run 001: 커널 의미 기준선, 9 tests |
| `docs/prototypes/agent-v0.2/runs/adapter-contract-baseline-001.md` | 147 | direct/JSONL 전송 동등성, 15 tests |
| `docs/prototypes/agent-v0.2/runs/helm-cli-linear-001.md` | 174 | 결정적 선형 CLI 렌더링, 57 tests 시점 |
| `docs/prototypes/agent-v0.2/runs/first-party-runtime-baseline-001.md` | 150 | 자체 런타임 경계, 28 tests |
| `docs/prototypes/agent-v0.2/runs/authority-carry-forward-001.md` | 146 | Authority Grant 포함 관계 증명, 33 tests |
| `docs/prototypes/agent-v0.2/runs/runtime-effects-context-001.md` | 128 | 도구 effect·취소·불확실 결과, Context Projection, 41 tests |
| `docs/prototypes/agent-v0.2/runs/openai-provider-contract-001.md` | 137 | OpenAI Responses provider 계약(mock), 48 tests |
| `docs/prototypes/agent-v0.2/runs/sqlite-transaction-baseline-001.md` | 62 | SQLite 트랜잭션·재생·checksum chain, 57 tests |

### 0.3 실험 코드

| 경로 | 분량 | 핵심 한 줄 |
|---|---:|---|
| `experiments/helm-kernel-v02/README.md` | 52 | 후보 커널 실험이 증명하는 것과 경계 |
| `experiments/helm-kernel-v02/package.json` | 14 | `@helmdocs/kernel-v02-experiment`, node >= 22.5.0 (node:sqlite) |
| `experiments/helm-kernel-v02/fixtures/legacy-decision-line-99.json` | 26 | 실제 결함 이벤트(`summary: ㅇ`) |
| `experiments/helm-kernel-v02/contracts/*.schema.json` (9개) | 439 | command, event, observation-candidate, write-result, protocol, adapter-capability, context-projection, provider-turn, runtime-tool |
| `experiments/helm-kernel-v02/src/index.mjs` | 11 | 재수출 |
| `experiments/helm-kernel-v02/src/contracts.mjs` | 199 | 스키마 상수, COMMAND_TYPES 13개, EVENT_TYPES 13개, 검증, 지문, writeResult |
| `experiments/helm-kernel-v02/src/kernel.mjs` | 767 | `CandidateKernel`: 순수 전이 함수, 권한 포함 검사, inbox, expected cursor |
| `experiments/helm-kernel-v02/src/projection.mjs` | 246 | `projectWorkspace`, `projectBrief` |
| `experiments/helm-kernel-v02/src/sqlite-kernel.mjs` | 453 | `SqliteCandidateKernel`: WAL, inbox, outbox, checksum chain, 마이그레이션 |
| `experiments/helm-kernel-v02/src/migration.mjs` | 84 | `planLegacyImport` |
| `experiments/helm-kernel-v02/src/protocol.mjs` | 226 | `KernelProtocolHost`, `DirectAdapter`, `JsonlRpcAdapter`, 적합성 검사 |
| `experiments/helm-kernel-v02/src/client.mjs` | 190 | `AgentHelmClient`/`HumanHelmClient` 분리 |
| `experiments/helm-kernel-v02/src/context.mjs` | 201 | `compileProviderContext`: 예산·삭제·생략 보고 |
| `experiments/helm-kernel-v02/src/agent-runtime.mjs` | 798 | `FirstPartyAgentRuntime`, `RuntimeToolRegistry`, 도구 10개, Gate 중개 |
| `experiments/helm-kernel-v02/src/experience.mjs` | 265 | `Guided001ExperienceHarness`, `LinearTranscript` |
| `experiments/helm-kernel-v02/src/providers/openai-responses.mjs` | 242 | `OpenAIResponsesProvider` |
| `experiments/helm-kernel-v02/bin/simulate-guided-001.mjs` | 157 | 시나리오 보고서 JSON 출력 |
| `experiments/helm-kernel-v02/bin/simulate-cli-experience.mjs` | 58 | 선형 CLI 대본 출력 |
| `experiments/helm-kernel-v02/test/*.mjs` (11개) | 1937 | 57 tests. helpers 포함 |
| `experiments/helm-sidecar/` (5개) | 500 | read-only Git collector, Return Brief, coverage 보고 |
| `experiments/durable-spike/` (3개) | 307 | pi-durable 스파이크 2개(약속·확인 흐름, Concern 상태 기계) |
| `experiments/helm-toy/helm.mjs` | 142 | 장난감 reducer 커널, 21번 시도 중 8번 거부 |
| `experiments/pi-lab/` (6개 + package.json) | 239 | pi 1.1.0 동작 실험 6개(파일만 읽음) |

### 0.4 패키지·앱

| 경로 | 분량 | 핵심 한 줄 |
|---|---:|---|
| `package.json` (루트) | 20 | npm workspaces(apps, experiments, packages), test 스크립트 |
| `packages/helm-core/` (README, package, src 6, test 1) | 913 | experimental.v0 core: 이벤트 검증, JSONL 저장, 의미 기록 4종, Git 어댑터, 투영, 재개 실험 |
| `packages/helm-cli/` (README, package, bin, test) | 404 | `helm` CLI: init/status/brief/events/record/capture/resumption/serve/web, `--attach` |
| `packages/helm-server/` (README, package, src 2, test) | 414 | loopback HTTP + SSE + OpenAPI 3.1 + 정적 웹 |
| `packages/helm-sdk/` (README, package, src) | 65 | `HelmClient` HTTP 클라이언트 |
| `apps/helm-web/` (README, index.html, app.js, styles.css) | 488 | Brief·Timeline·Capture 세 화면 웹 GUI |

### 0.5 보조로 일부 읽은 파일 (원천 확인용)

| 경로 | 읽은 범위 | 이유 |
|---|---|---|
| `docs/foundations/04-co-agency.md` | §8 안티패턴, §9 불변조건 | approval theater 정의 위치 확인 |
| `docs/v0.3/13-stack-feasibility.md` | §1~§5 | durable-spike 실행 결과의 기록 위치 |
| `docs/v0.3/audit/audit-report.md` | §3.1~§3.5 | 거부 세 갈래 정의, "모델이 초안" 근거 |
| `docs/handoff/conversation-transcript-until-158.md` | L1600~1640, L3158~3260 | [49] 실사용 증거 발언, [105]~[109] helm-toy 거부 분류 |

### 0.6 읽지 않은 것

- `.helm/private/`: 지시에 따라 읽지 않았다(이 저장소에는 `.helm/` 자체가 없다).
- `packages/agent-docs-init/`: 지시 범위(`packages/helm-*`) 밖이다. `fundamentals.md`가 설명하는 Docs-Agent OS 스캐폴드의 구현체다.
- `.helm-design-work/mac-modified/`의 README 3종, `.github/`, `.gitignore`: 지시 범위 밖(fundamentals만 비교 대상).
- `experiments/pi-lab/node_modules/`: 의존성. 실험 결과 재실행은 `pi-api-facts-2.md` 담당.

### 0.7 실행한 것 [실험]

| 명령 | 결과 |
|---|---|
| `node --test test/*.test.mjs` (experiments/helm-kernel-v02, Node v24.19.0) | tests 57, pass 57, fail 0, 약 0.9초. SQLite·sidecar 테스트가 OS 임시 디렉터리에 파일을 만든다 |
| `node helm.mjs` (experiments/helm-toy) | 21줄 기록, ✗ 8개(3, 4, 5, 7, 10, 17, 19, 21), 최종 C1 추측, C2 판단, 결과 확인됨(근거 T4) |

---

## 1. 커널 v0.2 후보 (`docs/architecture/helm-kernel-v0.2-candidate.md`)

### 1.1 지위와 제품 순서

- 상태: "first executable semantic baseline passed — not a stable implementation contract".
- 기반: `docs/foundations/10-refinement-candidate.md`. 대체 대상 없음. `helm-system-v0.md`는 현재 실험 구현 설명으로 남는다.
- 근거 run 8개를 머리말에 연결한다(§4 참조): CLI-G01 Codex Kernel Baseline, Adapter Contract Baseline 001, Helm CLI Linear Experience 001, First-party Agent Runtime Baseline 001, Authority Carry-forward Baseline 001, Runtime Effects and Context Baseline 001, OpenAI Responses Provider Contract 001, SQLite Transaction Baseline 001.
- 제품 정렬: first-party Helm CLI AI Agent가 첫 목표, portable Kernel/adapters가 두 번째. N/E/M + A/P 위상, Guided-default adaptive rigor.
- 핵심 결론(원문 인용): "Helm의 공통성은 모든 runtime이 같은 transport를 지원하는 데서 나오지 않는다. 하나의 versioned semantic contract를 runtime별 transport와 capability에 맞게 운반하는 데서 나온다." 따라서 MCP, plugin hook, RPC, SDK, CLI는 정본 protocol이 아니고 같은 Command, Observation, Query, Projection 계약을 전달하는 port 구현이다.

제품 구조 우선순위(§1):

```text
First product:            Helm CLI Experience + First-party Agent Runtime + Portable Helm Kernel
Second product capability: Portable Helm Kernel + Codex / Pi / OpenCode adapters
Later product:            Helm GUI Experience + First-party Agent Runtime + Portable Helm Kernel
```

Kernel을 runtime-independent하게 만드는 이유: Helm CLI를 control panel로 줄이려는 것이 아니고, 자체 Agent Runtime 안에서도 의미 규칙과 model/tool loop를 분리하고 검증된 규칙을 다른 agent에 재사용하기 위해서다.

브리프와의 관계: 브리프 결정 19(데스크톱 앱 먼저, 이후 SSH TUI), 22(데몬 상주), 23(자체 런타임, pi 재활용), 34(벤더 중립 어댑터 인터페이스는 지금 정의, 1차 구현은 자체 런타임 하나)가 이 순서를 대체한다. "CLI 먼저, GUI 나중"은 v0.2 시점 순서이며 지금은 "데스크톱 앱 먼저"다. "portable Kernel + 외부 adapter"는 브리프 34로 이어진다.

### 1.2 공식 runtime surface에서 확인한 사실 (§2, 2026-08-22 기준)

| runtime | 원문이 정리한 surface | 아키텍처 해석 |
|---|---|---|
| Codex | ChatGPT desktop·Codex CLI·IDE extension이 같은 host의 MCP 설정을 공유. local STDIO와 Streamable HTTP MCP server. 프로젝트 단위 `.codex/config.toml` | MCP는 Helm tool/query surface의 첫 integration. MCP만으로 다른 도구 전체 lifecycle을 관찰하거나 Helm 밖 mutation을 강제 차단한다고 가정하지 않음 |
| Pi | headless JSONL stdin/stdout RPC와 agent/tool lifecycle event, TypeScript extension(tool 등록, lifecycle 가로채기, context 주입, UI), SDK의 `AgentSession` embedding. `AGENTS.md`, project-local extension, Agent Skills | MCP 유무와 무관하게 native extension 또는 RPC host adapter로 높은 관측·제어 capability 구현 가능 |
| OpenCode | local STDIO와 remote Streamable HTTP MCP. Plugin API(session/tool hook, event subscription, tool 등록, server client)는 beta | MCP는 안정적인 최소 도구 surface, plugin은 lifecycle capture와 enforcement용. beta plugin API 변경을 kernel contract로 전파하지 않음 |
| Oh My OpenCode | OpenCode 위 plugin·agent orchestration·hook layer | 별도 kernel adapter를 먼저 만들지 않음. OpenCode adapter 위에 active plugin과 background agent metadata를 optional capability로 |

runtime별 기능은 바뀔 수 있으므로 "adapter conformance test가 문서 기억보다 우선한다".

### 1.3 아키텍처 원칙 P1~P7 (§3)

| 번호 | 원칙 | 내용 |
|---|---|---|
| P1 | Semantic contract가 transport보다 먼저다 | MCP tool 이름, Pi event 이름, OpenCode hook type을 정본 domain 어휘로 쓰지 않는다 |
| P2 | Kernel은 agent를 실행하지 않지만 Helm 제품은 실행한다 | Kernel은 허용 상태 전이, 권한, 근거, projection을 소유. first-party Agent Runtime은 모델 호출, reasoning loop, tool 선택, steering을 소유. 둘을 분리하되 함께 제품을 구성 |
| P3 | Adapter는 canonical Event를 직접 append하지 않는다 | Adapter는 Command 또는 Observation candidate를 제출. Kernel이 schema, authority, expected cursor, policy를 검사한 뒤 Event를 만든다 |
| P4 | Capability는 협상하며 결손을 숨기지 않는다 | `pause`, `tool observation`, `permission enforcement`를 지원하지 않으면 emulation하지 않고 manifest에 `unsupported`로 표시 |
| P5 | Projection은 read model이다 | Projection과 recommendation은 정본을 바꾸지 않는다. Actor가 recommendation을 수락하면 별도 Command가 normative transition을 만든다 |
| P6 | Local-first는 single-user-only를 뜻하지 않는다 | 개인 로컬 사용에서도 여러 agent process가 동시에 쓴다. single-writer serialization, optimistic concurrency, idempotency는 첫 버전부터 필요 |
| P7 | 의미 품질을 LLM validator 하나에 맡기지 않는다 | 구조 검증, provenance, authority, evidence relation, human/policy acceptance를 분리. LLM 평가는 설명 가능한 diagnostic candidate일 뿐 |

### 1.4 전체 구조와 방향 비대칭 (§4)

구성 요소(mermaid 원문의 노드): Human, Helm CLI AI Agent(first product), Helm GUI AI Agent(later), First-party Agent Runtime(model · tools · session · steering), Model Providers/Tool Substrate, Codex, Pi, OpenCode/Oh My OpenCode, Typed Query/Admin Clients, First-party Runtime Adapter, MCP Tool Adapter, Pi Extension/RPC Adapter, OpenCode Plugin Adapter, AGENTS/Skill/CLI Bridge, Helm Local Host/helmd(identity · session · transport · single writer), Application Service(commands · queries · orchestration), Deterministic Helm Kernel(domain transitions · policy · projection), Transactional Event Ledger, Versioned Read Models, Evidence/Artifact References.

연결: 모든 adapter와 client → Host → App → {Kernel, Ledger, Read, Blob}, Ledger → Read.

방향:
- Northbound: user/agent/client가 Helm에 Command와 Query를 보낸다.
- Southbound: runtime adapter가 agent lifecycle, tool action, material change를 Observation candidate로 보낸다.
- Control: Kernel이 policy result, context invalidation, pause/escalation request를 adapter에 보낸다.
- 하나의 MCP server로 세 방향을 모두 구현하려 하지 않는다.
- First-party Agent Runtime은 세 방향을 가장 풍부하게 구현하는 기준 adapter지만, 내부 package라는 이유로 raw Event append, authority bypass, projection write를 허용하지 않는다.

### 1.5 배포와 프로세스 위상 (§5)

기본은 local host single writer:

```text
agent/client processes
        ↓ local authenticated transport
helmd — one writer per workspace
        ↓ transaction
SQLite ledger + read models + evidence references
```

`helmd`는 제품 ontology를 소유하지 않는 host이며 운영 책임만 가진다.
1. workspace discovery와 process lifecycle
2. local actor/session identity 발급
3. 요청 인증과 rate/body limit
4. single-writer transaction serialization
5. adapter connection과 capability registry
6. subscription/change stream
7. backup/export coordination

Embedded mode: 테스트, 일회성 시뮬레이션, one-shot import에서 MAY. 실제 workspace에 쓰는 embedded client는 workspace lock을 얻어야 하고 daemon과 동시 writer가 되면 안 된다.

Remote mode는 다음 전까지 NOT YET: authenticated human/team identity, TLS와 secret management, multi-tenant authorization, organization policy boundary, conflict resolution and sync protocol. "loopback HTTP를 열었다는 사실은 remote collaboration readiness를 의미하지 않는다."

브리프와의 관계: 브리프 20~22, 26, 31, 38이 데몬 상주, 원격 접속(Tailscale serve, SSH), JSON-RPC over WebSocket을 정했다. "Remote mode NOT YET"의 다섯 조건 중 1인 사용이므로 multi-tenant·조직 정책은 해당 없고, 인증·TLS는 브리프 26(Tailscale 신원 헤더 + 기기 bearer 토큰, HTTPS/WSS)으로 채운다.

### 1.6 논리 모듈 (§6)

의존 방향(아래가 위를 의존):

```text
contracts
   ↑
kernel ← policy
   ↑
application
   ↑
host ← storage-sqlite
   ↑
client / adapter-sdk
   ↑
agent-runtime / mcp / external adapters
   ↑
agent-cli / agent-gui
```

| 모듈 | 책임 | 금지·조건 |
|---|---|---|
| `@helm/contracts` | JSON Schema와 생성 TS 타입, Command/Result/Event/Query/Projection envelope, adapter capability manifest, schema 호환 fixture, domain 이름과 error code | Node filesystem, network, database 의존 금지 |
| `@helm/kernel` | 순수 domain transition 함수, invariant 평가, policy decision 입출력, 결정적 projector, invalidation·conflict 도출 | 시계, random ID, filesystem, process env를 직접 읽지 않음. application이 입력으로 제공 |
| `@helm/application` | actor·workspace context 결합, Command transaction 조율, idempotency·expected cursor 검사, kernel 결과 append, projection 갱신·구독 알림, evidence blob/reference 수명 | |
| `@helm/storage-sqlite` | transactional ledger, workspace별 단조 sequence, command inbox와 idempotency key, projector checkpoint와 rebuild, evidence metadata와 content-addressed reference, backup·integrity check·migration | SQLite는 ontology가 아니고 기본 local storage adapter. JSONL은 사람이 읽는 export와 legacy import로 유지 |
| `@helm/host` | daemon/embedded 수명, local transport, identity·session, adapter registry, change stream | |
| `@helm/client` | typed query/command client, retry와 idempotency 보존, cursor subscription, transport 독립 error mapping | |
| `@helm/adapter-sdk` | capability negotiation, runtime event 정규화, context delivery, pause/cancel/escalation 처리, adapter conformance harness | |
| `@helm/agent-runtime` | model provider 추상화·호출, reasoning/tool loop, session·queue·pause·resume·cancel, Kernel Context Projection 소비, Work Agreement·Authority Envelope 집행 handoff, tool/run Observation candidate 방출, Completion Claim 구성 | 자체 session record로 domain state를 대체하지 않음. provider transcript와 tool trace는 source evidence이고 Kernel Command/Event가 정본 |
| `@helm/agent-cli` | first-party 터미널 상호작용, Guided-default 대화 조율, Brief/Explore/Choice/Work/Review surface, progressive disclosure, 키보드, human Gate와 정정 capture, Runtime + typed client 조합 | 첫 제품 entrypoint. 기존 semantic capture CLI는 migration/diagnostic 명령으로 흡수하거나 분리 |

Integration packages: `@helm/adapter-first-party`, `@helm/mcp-server`, `@helm/adapter-pi`, `@helm/adapter-opencode`, `@helm/bridge-files`, 이후 공식 surface로 정당화되면 `@helm/adapter-codex-lifecycle`. Codex의 첫 integration은 generic MCP server이며 vendor 이름을 server core에 넣지 않는다.

현재 실행 후보의 상태(§6 storage-sqlite 절): 순수 in-memory Kernel을 SQLite application/storage harness로 감싸 경계를 검증했다. 구현됨: durable Command/Observation inbox, Event와 outbox의 원자적 append, expected-cursor 충돌, 재시작 replay, workspace별 checksum chain. 증명 안 됨: `helmd`, projection checkpoint, backup/restore, durable Agent Runtime.

브리프와의 관계: 브리프 §3.1 패키지 목록(protocol, domain, kernel, store, ai, agent, tools, runtime, observer, daemon, desktop, cli, tui)이 정본이다. 대응 [해석]: contracts → `@helm/protocol` + `@helm/domain`, kernel(+policy) → `@helm/kernel`, application + storage-sqlite → `@helm/store` + `@helm/daemon` 일부, host → `@helm/daemon`, client → `@helm/protocol`의 클라이언트 측(앱이 사용), adapter-sdk + agent-runtime → `@helm/runtime` + `@helm/agent` + `@helm/tools`, agent-cli → `@helm/desktop`(UI 역할) / `@helm/tui`. 의존 방향 원칙(contracts는 I/O 없음, kernel은 시계·랜덤 없음)은 그대로 쓸 수 있다.

### 1.7 정본 계약 네 종류 (§7)

문서의 예시 envelope(문서 버전). 실행 후보의 스키마는 §9.1에 따로 적는다.

**Command** — Actor가 기준선을 바꾸려는 의도. 아직 발생한 Event가 아니다.

| 필드 | 예시·설명 |
|---|---|
| `schema` | `"helm.command.v0.2"` |
| `commandId` | `"cmd_..."` |
| `workspaceId` | `"ws_..."` |
| `type` | 예 `"choice.commit"` |
| `actor.actorId` / `actor.sessionId` / `actor.runtime` | `"actor_..."`, `"session_..."`, `"codex"` |
| `authorityBasis` | `["policy_...", "agreement_..."]` |
| `expectedCursor` | 예 `418` |
| `idempotencyKey` | 호출자 범위 키 |
| `payload` | 객체 |
| `provenance.adapterId` / `externalRunId` / `sourceRefs` | adapter 식별, 외부 run ID, 원천 참조 |

**Observation candidate** — tool/runtime이 외부에서 감지한 사실 후보. Kernel은 이것을 accepted Finding이나 Choice로 자동 승격하지 않는다.

| 필드 | 예시·설명 |
|---|---|
| `schema` | `"helm.observation-candidate.v0.2"` |
| `observationId` | `"obs_external_..."` |
| `workspaceId` | |
| `kind` | 예 `"artifact.changed"` |
| `observer` | 예 `"tool:git"` |
| `observedAt` | 외부 관찰 시각 |
| `subjectRefs` | `["artifact_..."]` |
| `payload` | |
| `source.externalId` / `source.contentHash` | `"sha256:..."` |

**Ledger Event** — Kernel이 Command/Observation을 평가해 기록한 불변 transition record. payload의 영구적 진실을 보장하지 않는다.

| 필드 | 예시·설명 |
|---|---|
| `schema` | `"helm.event.v0.2"` |
| `eventId` | `"evt_..."` |
| `workspaceId` | |
| `sequence` | 예 `419` |
| `type` | 예 `"normative.choice.committed"` |
| `recordedAt` / `effectiveAt` | 기록 순서 시각과 효력 시각 분리 |
| `actorId` | |
| `authorityBasis` | `["policy_..."]` |
| `subjectRefs` | `["choice_...", "goal_..."]` |
| `payload` / `provenance` | |
| `causationId` | `"cmd_..."` |
| `correlationId` | `"episode_..."` |

**Query / Projection** — cursor와 derivation policy version에 묶인 read model.

| 필드 | 예시·설명 |
|---|---|
| `schema` | 예 `"helm.projection.brief.v0.2"` |
| `workspaceId` | |
| `sourceCursor` | 예 `419` |
| `policyVersion` | 예 `"brief-policy.v0.2.1"` |
| `generatedAt` | |
| `freshness` | 예 `"current"` |
| `includedRefs` | |
| `omitted` | `[{ "category": "routine-activity", "count": 42 }]` |
| `qualitySignals` | |
| `data` | |

### 1.8 Identity, ordering, idempotency, 낙관적 동시성 (§8)

Identity
- Entity와 Event ID는 전역 유일, 단 순서 의미를 ID 문자열에 의존하지 않는다.
- 외부 runtime/run/tool call ID는 별도 provenance 필드로 보존한다.
- `actor: human:local` 같은 자유 문자열은 표시 라벨일 뿐 authority identity가 될 수 없다.

Ordering
- ledger는 workspace별 단조 `sequence`를 부여한다.
- `sourceCursor`는 마지막 Event ID가 아니라 sequence 또는 opaque durable cursor다.
- `occurred/effective time`과 `recorded order`를 분리한다.
- 늦게 도착한 Observation은 과거에 끼워 넣지 않고 현재 sequence에 기록한 뒤 영향받는 projection을 rebuild/invalidate한다.

Idempotency
- 모든 Command는 `commandId`와 호출자 범위 `idempotencyKey`를 가진다.
- Adapter Observation은 안정된 external ID 또는 source content hash를 가진다.
- retry는 같은 result를 돌려주고 중복 Event를 만들지 않는다.
- idempotency 보존 기간과 key 범위를 schema에 명시한다.

Optimistic concurrency
- 기준선 변경 Command는 `expectedCursor`를 쓴다.
- 불일치면 last-write-wins 하지 않고 `conflict.expected_cursor_mismatch`를 반환한다.
- 충돌 응답은 달라진 관련 entity와 rebase 가능한 projection을 포함한다.

### 1.9 후보 domain 어휘 (§9)

stable 선언이 아니고 cross-runtime fixture용 후보다. "큰 state machine 하나를 모든 작업에 강제하지 않는다. policy profile이 필요한 transition subset과 evidence burden을 정한다."

| 묶음 | 어휘(Command 동사) |
|---|---|
| Goal | `goal.open`, `goal.revise`, `goal.pause`, `goal.retire`, `goal.achievement_claim`, `goal.achievement_accept` |
| Concern | `concern.open`, `concern.reframe`, `concern.resolve`, `concern.reopen` |
| Epistemic state | `observation.capture`, `observation.qualify`, `interpretation.propose`, `possibility.propose`, `claim.propose`, `claim.accept`, `claim.contest`, `claim.mark_stale`, `claim.supersede`, `evidence.link`, `evidence.invalidate` |
| Choice | `choice.open`, `choice.qualify`, `choice.commit`, `choice.reopen`, `choice.supersede` |
| Work agreement and execution | `agreement.offer`, `agreement.accept`, `agreement.renegotiate`, `agreement.release`, `run.attach`, `run.status_observe`, `exception.raise` |
| Completion, acceptance, integration | `completion.submit`, `completion.correction_request`, `result.accept`, `result.reject`, `integration.start`, `integration.verify`, `integration.complete`, `integration.reopen` |

합계 41개. 실행 후보(`contracts.mjs`)에서 실제로 구현한 Command는 13개(§9.2). 구현에서 새로 생긴 것: `legacy.choice.capture`, `authority.grant`, `agreement.activate`. 시나리오 문서(guided-001 §6)에는 `goal.link`, `obligation.transfer`도 후보로 나온다.

### 1.10 Semantic quality model (§10)

각 Entity는 domain lifecycle과 별도로 품질 상태 세 개를 가진다.

```text
captureState:   absent | captured | structural
qualification:  unqualified | qualified | disputed
baselineStatus: proposed | accepted | contested | stale | superseded
```

검증 세 층:

| 층 | 검사 항목 |
|---|---|
| 구조적 검증 | schema/type/required fields, referential integrity, ID와 cursor 규칙, payload 크기와 encoding |
| 의미적 qualification | source와 scope 존재, evidence relation의 방향과 대상, authority와 accountable acceptor, counterevidence/review trigger, policy profile에 따른 최소 burden |
| content quality diagnostic | 짧거나 무의미해 보이는 문자열, 순환 rationale, option 중복 등은 diagnostic을 만들 수 있음. 단 language heuristic만으로 사람 입력을 삭제·거부하지 않음 |

예시(원문):

```text
Decision "ㅇ" with rationale "ㅁㄴㅇ"
→ structurally valid
→ unqualified
→ cannot become active baseline under standard policy
→ visible as attention item
```

"`blind spot 없음`은 필드 존재가 아니라 relevant state가 qualified/current인지에 기반해야 한다."

실행 후보의 구현 범위 [원문, kernel.mjs·projection.mjs]: Choice만 세 상태를 가진다. `choice.open`/`legacy.choice.capture` → `captureState: structural`, `qualification: unqualified`, `baselineStatus: proposed`. `choice.qualify` → `qualified`. `choice.commit` → `accepted`(직전 accepted Choice는 `superseded`). `disputed`, `contested`, `stale`(Choice)은 구현되지 않았다. Agreement 이전 revision만 `stale`로 표시된다.

### 1.11 검토 트리거 (원전 전체에서 모은 것) [해석: 모음]

원전은 "review trigger / reopen trigger / invalidation trigger"를 여러 곳에서 쓴다. 한곳에 모은다.

| 위치 | 이름 | 내용 |
|---|---|---|
| kernel 후보 §10 | counterevidence/review trigger | 의미적 qualification의 필수 요소 |
| kernel 후보 §12 | invalidation reason | Projection 불변조건의 하나 |
| `contracts`/kernel.mjs `choice.qualify` | `reviewTrigger` (필수 문자열) | qualificationBasis 다섯 필드 중 하나 |
| helm-system-v0 §5, helm-core `recordDecision` | `reopenTrigger` (필수) | v0 Decision 필수 증거 |
| CLI 경험 §5 Choose | review trigger | Choose surface 항목 |
| CLI 경험 §14 Choice impact echo | "다시 볼 조건" | 예: "qualification burden 때문에 normal Guided 작업이 반복적으로 막힐 때" |
| CLI 경험 §5 Review | counterevidence와 invalidation trigger | Review surface 항목 |
| paper Decision Gate §6, §8 | "What new evidence would change the recommendation", "Review date or reopen trigger" | |
| paper Delegation Contract §9, §10 | "Invalidation triggers", "Reopen trigger" | |
| paper Inquiry Map §1, §4 | "Reframe trigger", "Review trigger"(가정·미지 표) | |
| paper Return Brief Metadata | "Freshness / invalidation triggers" | |
| dogfood 002 §1 | "Reopen trigger: CLI and GUI require incompatible semantic state, or delayed resumption shows no projection value" | |

### 1.12 Policy engine (§11) — 범위 표시

> **범위 밖 표시**: 브리프 결정 2는 "Effect class와 가역성 판별은 Helm 범위가 아니다. 권한 레이어의 일이다"라고 정했다. 아래 R0~R4 effect class와 그 판정은 원전 기록으로만 옮긴다. 설계 문서는 Helm 안에서 effect class를 판정하는 정책 엔진을 만들지 않는다. 다만 (a) 도구 메타데이터로 effect class를 "선언"하고 표시하는 것, (b) 권한 레이어의 결과를 받아 Gate·기록으로 연결하는 것, (c) A/P 판별("상황이 바뀌면 답도 바뀌는가?")은 브리프 용어집과 결정 4·14·15에 따라 여전히 다룬다. 이 경계는 10(커널)·13(도구)·18(보안)이 정한다.

Policy 출력(원문):

```json
{
  "decision": "allow | deny | require_gate | require_evidence | conflict",
  "policyIds": ["..."],
  "reasons": ["..."],
  "missing": ["..."],
  "requiredActions": ["..."]
}
```

Effect class(원문):

```text
R0 read-only local
R1 reversible local mutation
R2 shared or externally visible reversible action
R3 costly, sensitive, or low-recoverability action
R4 irreversible or prohibited-by-default action
```

"Authority Envelope은 command type만이 아니라 effect class, resource scope, budget, expiry, stop condition을 포함한다."

Authority carry-forward: 첫 사용자 지시가 후속 Work Agreement를 재질문 없이 활성화하는 것은 묵시적 권한 추정이 아니다. Human Authority Grant와 Agreement requested authority의 포함 관계를 Kernel policy가 증명해야 한다.

```text
RequestedAuthority(Agreement) ⊆ CurrentAuthorityGrant(Actor, WorkUnit)
```

포함 검사는 최소 grantee, action class, effect class, resource scope, expiry, stop condition을 다룬다. 어느 차원이든 확대되거나 증명할 수 없으면 `require_gate`. Event는 원래 human grantor와 활성화한 agent를 함께 보존한다.

Gate rule(§11): 다음이 모두 참일 때 Gate를 만든다.
1. policy가 자동 처리할 수 없다.
2. Actor의 판단이 결과를 실질적으로 바꾼다.
3. 지금 묻는 가치가 attention cost보다 높다.

Gate Event와 UI notification을 구분한다. 같은 미해결 결정에 알림을 반복 생성하지 않는다. (CLI 경험 §14는 조건 4개로 적는다. §3.7 참조.)

### 1.13 Projection과 Context Compilation (§12)

Projection 불변조건(6개):
1. source cursor와 projector version
2. included source refs와 omission summary
3. freshness와 invalidation reason
4. quality/uncertainty/conflict signal
5. source drill-down
6. 같은 입력이면 결정적 rebuild

Recommendation의 지위:

```text
projection recommends X
  ≠ workspace decided X

actor accepts X through choice.commit
  → normative Event
```

Context pack: runtime별 token 형식은 Adapter가 맡지만 Kernel projection은 같은 semantic content set을 준다.

```text
Goal + Concern
+ accepted Choices and Constraints
+ Work Agreement and Authority Envelope
+ relevant qualified Claims/Evidence
+ contested/stale items
+ Artifact neighborhood
+ stop/escalation conditions
+ source refs and omitted categories
```

Adapter는 context window에 맞게 더 압축할 수 있으나 omitted category와 source cursor를 되돌려야 한다.

### 1.14 Authority Envelope 정리 [해석: 원전 여러 곳 모음]

| 출처 | 차원 |
|---|---|
| kernel 후보 §11 | command type, effect class, resource scope, budget, expiry, stop condition |
| kernel 후보 §17 Semantic intent/lease (Work Agreement MAY) | `intendsToChange`, `dependsOn`, `preserves`, `interfaceObligations`, `expectedOutcome`, `leaseExpiry`. lease는 독점 파일 잠금이 아니라 조기 충돌 탐지 신호 |
| authority-carry-forward-001 §2 Authority Grant | grant reference, grantor·grantee Actor, purpose, allowed action classes, maximum effect class R0–R4, resource scopes, expiry, stop conditions, source instruction reference |
| kernel.mjs `authority.grant` payload | `grantRef`, `granteeActorId`, `purpose`, `actionClasses[]`, `maxEffectClass`, `resourceScopes[]`, `expiresAt`(발급 시각 이후여야 함), `stopConditions[]`, `sourceInstructionRef` |
| kernel.mjs `agreement.offer`의 `requestedAuthority` | `granteeActorId`, `actionClasses[]`, `maxEffectClass`, `resourceScopes[]` |
| paper Delegation Contract §4 | Read scope, Write scope, Allowed actions, Forbidden actions, External side effects, Resource/cost limit, Time boundary, Reversibility requirement |
| CLI 경험 §15 Work Agreement echo | Result, Allowed, Not allowed, Evidence, Pause when |
| helm-system-v0 용어 | `AuthorityEnvelope` → 제품 표시 "맡긴 범위 / AllowedRange" |
| 브리프 용어집 | 작업 합의(Agreement) 여섯 항목: 목적, 완료 기준, 범위, 금지 행동, 제출할 근거, 멈출 조건 |

CLI 기본 표시 예(authority-carry-forward-001 §5): "맡긴 범위 / - 이 저장소 안에서 읽기, 되돌릴 수 있는 수정, 테스트, 문서 변경 / - 외부 공개·배포 없음 / - 추정으로 기존 결정을 수락해야 하면 멈춤 / - 내일까지 유효". 개발자·assurance view에는 Grant ID, effect class, policy reason, provenance를 남긴다.

### 1.15 Adapter Protocol (§13)

Capability manifest(문서판):

```json
{
  "schema": "helm.adapter-capabilities.v0.2",
  "adapterId": "adapter_...",
  "runtime": { "family": "pi", "version": "..." },
  "transport": ["extension", "rpc"],
  "capabilities": {
    "contextDelivery": "push",
    "toolObservation": "full",
    "artifactObservation": "partial",
    "pause": "supported",
    "cancel": "supported",
    "authorityEnforcement": "pre_tool_hook",
    "interactiveGate": "native",
    "resume": "supported"
  },
  "limitations": []
}
```

문서판 capability 키 8개: `contextDelivery`, `toolObservation`, `artifactObservation`, `pause`, `cancel`, `authorityEnforcement`, `interactiveGate`, `resume`. 실행 후보 스키마(§9.1)는 이것을 Level 네 개 × `enforced | advisory | unavailable`로 단순화했다.

Capability levels:

| Level | 의미 | 가능한 구현 |
|---|---|---|
| A — Bridge | context/query/semantic submit | AGENTS/Skill + CLI |
| B — Tool | 구조화된 model-callable Helm tools | MCP 또는 custom tool |
| C — Observe | session/tool/artifact lifecycle 수집 | runtime extension/plugin/RPC |
| D — Direct | pause/cancel/context refresh/permission enforcement | rich native adapter |

"Level A adapter를 Level D처럼 표시해서는 안 된다." 주의: adapter-contract-baseline-001과 스키마의 Level 이름은 다르다(A tool/query, B lifecycle observation, C directed runtime, D native co-agency). §4.3에 적는다.

Delivery semantics:
- Adapter → Host는 at-least-once 전송과 idempotent inbox가 기본.
- Host → Adapter control request는 acknowledgement와 timeout을 가진다.
- 연결 단절은 authority 확대가 아니라 safe degradation을 일으킨다.
- `authorityEnforcement`가 없는 adapter에서는 Helm이 실제 sandbox라고 주장하지 않는다.

Adapter는 raw transcript를 정본으로 만들지 않는다. transcript와 tool stream은 source evidence이고, semantic candidate는 명시적 extraction provenance를 가지며 qualified/accepted transition을 따로 거친다.

### 1.16 Runtime별 초기 mapping (§14)

| profile | Bridge | Tool | Observe | Direct | 비고 |
|---|---|---|---|---|---|
| First-party Helm CLI | — | typed Kernel client + first-party runtime tools | 전체 session/tool/artifact candidate stream | pause/cancel/context refresh/authority enforcement | Experience: native Guided-default 터미널. Runtime: 자체 model/tool/session loop. Level D 기준 구현. 외부 runtime의 최소 공통 capability에 묶이지 않음 |
| Codex | AGENTS.md + Helm skill/CLI | local STDIO 또는 Streamable HTTP MCP | 공식 lifecycle surface 검증 후 별도 adapter | 〃 | MCP server instruction에 server-wide 제약만, workspace 가변 Goal/Context 전체를 정적 instruction에 복제하지 않음 |
| Pi | AGENTS.md + Agent Skill + CLI | TypeScript extension custom tools | extension lifecycle/tool event 또는 RPC event stream | tool_call 가로채기, RPC abort/steering, extension UI | Host mode: Pi SDK `AgentSession` embedding은 선택. Helm이 Pi를 spawn/embed하는 경우와 실행 중 Pi에 붙는 경우를 별도 deployment profile로 |
| OpenCode | instruction files + CLI | MCP | plugin session/tool hook, public event stream | plugin intercept hook, session interrupt | Plugin API가 beta라 지원 버전 범위와 conformance 결과를 노출 |
| Oh My OpenCode | OpenCode 상속 | | | | 공식 hook으로 관측될 때만 optional: background/subagent identity, parent/child run 관계, agent category/model role, orchestration 완료·취소. 내부 agent 이름을 Helm Actor kind로 고정하지 않음 |

### 1.17 MCP surface 후보 (§15)

MCP는 전체 Event ledger를 model context에 노출하지 않는다.

- Read tools(6): `helm_get_orientation`, `helm_get_context`, `helm_get_open_gates`, `helm_get_work_agreement`, `helm_get_assurance_view`, `helm_get_sources`
- Write tools(9): `helm_open_concern`, `helm_submit_observation`, `helm_propose_claim`, `helm_link_evidence`, `helm_propose_choice`, `helm_commit_choice`, `helm_accept_work_agreement`, `helm_raise_exception`, `helm_submit_completion`
- Tool description은 `propose`와 `commit`, `submit`과 `accept`를 구분한다. Agent에게 `commit_choice`가 보여도 authority policy가 허용하지 않으면 Gate를 반환한다. (실행 후보 런타임은 이와 달리 human 권한 도구를 provider에 아예 노출하지 않는다. §4.5, §9.6)
- 모든 write result 포함 항목: `accepted/rejected/needs_gate/conflict`, new cursor 또는 unchanged cursor, 생성·영향 entity refs, policy reasons, missing evidence/authority, rebase가 필요할 때 fresh context ref.

### 1.18 Storage와 migration (§16)

권장 table 책임:

```text
workspaces
commands            # idempotent inbox and results
events              # immutable sequence
projection_checkpoints
projection_documents
actors_sessions
adapter_connections
evidence_refs
schema_migrations
outbox               # adapter/client notifications
```

domain entity별 mutable table을 정본으로 만들지 않는다. 성능용 read table은 rebuild 가능해야 한다.

Transaction boundary — 한 Command 처리에서 다음이 하나의 transaction이다.
1. idempotency/expected cursor 검사
2. current state load
3. kernel transition and policy evaluation
4. Event append
5. synchronous critical projection update 또는 checkpoint invalidation
6. outbox append

외부 runtime notification은 transaction 뒤 outbox로 전달한다.

Schema evolution:
- Event envelope version과 payload type version을 분리
- historical Event를 제자리에서 다시 쓰지 않음
- reader upcaster와 명시적 migration Event를 구분
- projection schema는 Event schema와 독립 version
- adapter는 지원 contract 범위를 handshake
- 알 수 없는 Event type은 ledger 무결성을 깨지 않고 unsupported projection diagnostic을 만든다

JSONL migration(`.helm/events.jsonl`은 import source):
- 원본 hash와 path를 provenance로 보존
- experimental Event를 stable 의미로 자동 추정하지 않음
- `projection.next_action.proposed`는 normative candidate 또는 derived history 중 명시적으로 선택
- 낮은 품질 Decision은 `captured/unqualified`로 import
- import report에 loss/ambiguity 목록 포함

### 1.19 동시성과 의미 충돌 (§17)

기술적 충돌: 같은 expected cursor에 대한 동시 normative Command, 중복 external event, adapter reconnect/replay, projector lag.

의미 충돌: 서로 다른 WorkUnit이 같은 accepted Choice/Constraint를 다르게 전제, 같은 Assumption을 양립 불가능하게 갱신, 다른 Artifact를 바꾸지만 같은 interface obligation 위반, authority envelope이 겹치거나 요청자 권한 초과.

"기술적 lock이 의미 충돌을 해결하지 않는다." Kernel은 영향받는 semantic refs를 기준으로 `Conflict` entity/candidate를 만든다. Semantic intent/lease 필드는 §1.14.

### 1.20 보안과 신뢰 경계 (§18)

- Actor identity: runtime이 전달한 display name을 인증 identity로 믿지 않는다. local adapter 등록 때 host가 session credential을 발급한다. human acceptance는 어느 UI/session/auth context에서 발생했는지 추적한다.
- Project resources: AGENTS, skill, Pi extension, OpenCode plugin은 실행·지시 공급망이다. project trust 전 자동 실행 금지, 생성 파일은 marker와 ownership, hash/version/source를 adapter metadata에 기록, 사용자 파일을 조용히 덮어쓰지 않음.
- Evidence privacy: source metadata와 secret content 분리, projection별 disclosure policy, content-addressed blob도 민감도 label과 access policy, remote/SaaS sync는 opt-in allowlist.
- Enforcement honesty: adapter가 tool interception이나 sandbox를 지원하지 않으면 `advisory authority`만 제공한다. UI와 audit에서 enforced와 advisory를 구분한다.

### 1.21 실패와 복구 (§19)

실패 종류 9개: command rejection, policy/gate requirement, expected cursor conflict, adapter disconnected, observation malformed, storage unavailable/corrupt, projection lag/failure, schema unsupported, external action uncertain.

복구 원칙:
- Event append 성공 여부가 불확실하면 같은 idempotency key로 재조회/재시도
- projection 실패가 ledger commit을 되돌리지 않고 degraded 상태를 표시
- corrupt tail을 자동 무시하지 않고 integrity diagnostic과 read-only recovery mode 제공
- external action timeout은 실패로 단정하지 않고 `outcome unknown`으로 기록
- compensation/rollback은 새 authorized WorkUnit이다
- backup은 SQLite consistent snapshot + evidence manifest + schema versions

### 1.22 Observability와 제품 Event 분리 (§20)

서로 다른 stream 네 개:
- Domain ledger: Goal, Claim, Choice, Agreement, Outcome의 의미 전이
- Operational log: latency, connection, retry, exception, projector health
- Experiment measurement: recovery time, correction, workload, agency rating
- Raw runtime trace: message/tool/session source evidence

서버 오류나 token usage를 자동으로 domain Event로 만들지 않는다. 중요한 material Outcome을 operational log에만 남기지도 않는다.

### 1.23 Test architecture (§21)

- Kernel tests: pure transition table, invariant/property tests, deterministic replay, stale/contested/superseded 전파, authority와 evidence burden, garbage-but-nonempty semantic input
- Storage tests: atomic command/event/outbox transaction, 동시 writer 직렬화, crash and restart recovery, idempotent retry, migration/upcast/rebuild, backup/restore integrity
- Adapter conformance suite(모든 adapter가 같은 fixture): identify and handshake, cursor-bound context 전달, 중복 observation 제출, 연결 끊김/재연결, gate requirement 수신, 무권한 command 시도, 광고했다면 pause/cancel, evidence 포함 completion 제출, 다른 runtime에서 resume. 광고한 capability와 실제 결과가 다르면 adapter fail.
- Cross-runtime semantic fixture: (1) Codex에서 Goal/Concern/Choice 생성 (2) Pi에서 같은 Context로 Inquiry (3) OpenCode에서 bounded change (4) 다른 runtime에서 resumption (5) 모든 runtime이 같은 accepted baseline, contested claim, unresolved integration을 재현. transport별 session ID가 달라도 semantic identity와 cursor는 같아야 한다.
- UX/effectiveness tests: Brief 전후 상황 복귀 정확도·시간, raw transcript fallback 횟수, 사용자 정정이 downstream context를 바꾸는지, Gate 수락/거절이 결과를 바꾸는지, 알림 workload와 interruption cost, completion/acceptance/integration 분리가 결함을 찾는지.

### 1.24 experimental.v0에서의 migration 단계 (§22)

| Phase | 내용 |
|---|---|
| 0 Freeze and evidence preservation | `experimental.v0`를 stable로 rename하지 않음. 현재 JSONL, tests, dogfood 결함을 fixture로 보존. 새 코드가 기존 unqualified Decision을 정상 baseline으로 기대하지 않게 함 |
| 1 Contract and deterministic Kernel | `@helm/contracts` 후보 schema, 순수 Command → Event 전이, sequence cursor·expected cursor·idempotency, Goal/Concern/Claim/Choice와 Guided profile vertical slice, 품질 상태와 Projection 경계 수정 |
| 2 Helm CLI AI Agent vertical slice | 최소 model/tool/session loop, Guided-default CLI, SQLite single writer, JSONL importer/exporter, typed client, first-party Level D adapter, Brief → Explore → Choice → Work → Review end-to-end dogfood |
| 3 Helm CLI UX simulation and refinement | 대표 Guided/Quick/Assured 시나리오, correction·steering·completion/acceptance/integration 상호작용, 지연 재개와 raw transcript fallback 측정, CLI 상호작용 부담과 재사용 의향 |
| 4 Portable adapters and cross-runtime simulation | MCP adapter와 file/skill bridge, Pi extension/RPC, OpenCode plugin, Codex MCP conformance, capability negotiation과 degradation UX, 같은 fixture와 지연 재개를 runtime 간에 |
| 5 Helm GUI AI Agent | visual Common Operating Picture와 상호작용 surface, 자체 Runtime 재사용, CLI/GUI state·policy parity, UX 증거가 지지하는 곳에서 richer native orchestration |

"자체 agent가 kernel의 authority checks를 우회하는 private path를 만들지 않는다."

### 1.25 Architecture acceptance criteria (§23)

다음이 증명될 때만 구현 정본이 된다(13개).
1. "CLI agent 우선, portable Kernel 두 번째, GUI agent 이후" 순서가 package와 delivery plan에 반영됨
2. Guided가 기본 profile이고 Quick/Assured가 같은 의미 불변조건을 보존
3. 모든 package 책임이 Foundation law와 user question에 추적됨
4. first-party Agent Runtime이 Kernel validation과 authority를 우회하지 않음
5. 같은 semantic fixture가 최소 두 runtime adapter에서 통과
6. MCP 없이도 Pi adapter가, Pi 없이도 MCP adapter가 kernel을 쓸 수 있음
7. adapter가 canonical Event를 직접 위조/append할 수 없음
8. 동시 client가 silent last-write-wins를 만들지 않음
9. Projection output이 canonical input 어휘에 섞이지 않음
10. 낮은 품질 입력이 qualified baseline이나 `blind spot 없음`으로 승격되지 않음
11. schema migration과 replay가 historical provenance를 보존
12. enforced authority와 advisory authority가 사용자에게 구분됨
13. failure/reconnect/retry가 중복 normative transition을 만들지 않음

### 1.26 검증 현황과 다음 산출물 (§24)

run별 완료 항목은 §4에 run 문서와 함께 적는다. 문서 §24의 "다음 산출물" 7개:
1. product-owner CLI transcript review와 experience contract 수정
2. Authority revocation/budget/overlap과 자연어 Grant 추출
3. durable tool intent/outcome journal과 정본 recovery evidence 연결
4. live model provider 검증과 streaming decoder
5. 전체 JSONL importer와 outbox worker의 reconnect/subscription/cursor resume
6. model-driven CLI의 상호작용 부담, steering, resumption 측정
7. CLI 경험이 기준을 통과한 뒤 Codex MCP, Pi extension/RPC, OpenCode plugin adapter의 실제 Level A–D portability fixture

### 1.27 이벤트 타입 전부 (원전 전체) [해석: 모음]

| 계열 | 이벤트 타입 | 정의 위치 |
|---|---|---|
| v0.2 후보 문서 예시 | `normative.choice.committed` | kernel 후보 §7 |
| v0.2 실행 후보 `EVENT_TYPES` (13) | `migration.legacy_choice.captured`, `governance.authority.granted`, `epistemic.observation.captured`, `normative.choice.opened`, `normative.choice.qualified`, `normative.choice.committed`, `normative.agreement.offered`, `normative.agreement.accepted`, `normative.agreement.renegotiated`, `epistemic.completion.submitted`, `normative.result.accepted`, `normative.integration.started`, `normative.integration.completed` | `experiments/helm-kernel-v02/src/contracts.mjs`, `contracts/event.schema.json` |
| experimental.v0 `EVENT_TYPES` (10) | `workspace.initialized`, `normative.decision.committed`, `normative.commitment.created`, `normative.commitment.status_changed`, `epistemic.belief.updated`, `projection.next_action.proposed`, `material.snapshot.observed`, `material.worktree_change.observed`, `experience.resumption.started`, `experience.resumption.completed` | `packages/helm-core/src/event.mjs` |
| sidecar 실험 (6) | `material.snapshot_observed`, `material.worktree_change_observed`, `normative.decision_provided`, `epistemic.change_provided`, `normative.commitment_provided`, `projection.next_action_provided` | `experiments/helm-sidecar/src/capture.mjs` |
| 런타임 운영 이벤트(정본 아님) | `run.started`, `run.cancelled`, `run.failed`, `run.yielded`, `steering.applied`, `steering.deferred`, `cancellation.deferred`, `provider.interrupted`, `ui.block`, `tool.started`, `tool.finished`, `tool.interrupted`, `tool.outcome_uncertain`, `tool.recovery_recorded`, `gate.opened`, `gate.closed`, `gate.stale`, `gate.write_failed` (schema `helm.agent-runtime-event.v0.2-candidate`) | `experiments/helm-kernel-v02/src/agent-runtime.mjs` |

규칙(원전 여러 곳): 정본 Event 타입은 `projection.`으로 시작하지 않는다(guided-001 §6, F2). Event 이름 접두사가 세계를 표시한다: `normative.`(N), `epistemic.`(E), `material.`(M), `governance.`(A/P), `migration.`, `experience.`(실험 측정). Completion 제출은 `epistemic.`이다(Run 001 §4: "Completion submission is an Epistemic Claim about achieved criteria").

---

## 2. helm-system-v0와 fundamentals

### 2.1 helm-system-v0 (`docs/architecture/helm-system-v0.md`)

지위: "executable vertical slice, experimental contracts". 범위: local-first core + CLI + HTTP/SSE server + Web GUI. 비목표: stable public schema, production desktop packaging, SaaS backend, autonomous agent runtime.

#### 2.1.1 제품 언어 경계

experimental core는 원론 용어(Purpose, Decision, Commitment)를 쓴다. 사용자 화면, onboarding, 알림, 새 application-layer domain은 `docs/foundations-friendly/README.md`와 `06-technical-crosswalk.md`를 기준으로 한다.

| core 용어 | 제품 표시 |
|---|---|
| `Purpose` | 목표 / Goal |
| `Decision` | 선택 / Choice |
| `Commitment`, `DelegationContract` | 약속 / 작업 합의 |
| `AuthorityEnvelope` | 맡긴 범위 / AllowedRange |
| `ClaimingComplete`, `Acceptance`, `Integration` | 결과 제출 → 결과 확인 → 전체 반영 |

experimental.v0 Event를 즉시 일괄 rename하지 않는다. projection과 application command 경계에서 product domain으로 명시 변환하고, public contract 안정 전에 이해도 실험으로 용어를 검증한다.

#### 2.1.2 결정과 구조

결정(§1): Foundations를 문서 집합으로만 두지 않고 하나의 headless application core를 여러 client가 공유하는 실행 시스템으로 만든다. OpenCode에서 옮긴 것은 agent/session domain이 아니라 client–server 경계다(TUI가 server client, headless server가 OpenAPI 노출, CLI가 독립 server에 attach, `web` 명령이 같은 backend 위 Web UI). OpenCode의 model provider, prompt session, tool execution, TUI domain은 복제하지 않는다. 정본은 agent message가 아니라 Purpose·Decision·Commitment·Belief·Material Observation Event다.

실행 구조(§2): Human/Agent Actor → {Helm CLI, Helm Web GUI}. CLI는 local one-shot이면 `HelmApplication` 직접 호출, `--attach`면 SDK → Local HTTP + SSE Server → `HelmApplication`. Web GUI는 HTTP writes / SSE invalidation. `HelmApplication` → Event validation + transition rules, Workspace + Return Brief projections, Append-only JSONL Event Store, Private resumption answer keys. Read-only Git Adapter → App. CLI가 server를 거치지 않아도 별도 domain logic이 없다.

저장소 경계(§3):

| Unit | 책임 | 소유 금지 |
|---|---|---|
| `packages/helm-core` | Event 검증, append-only store, semantic commands, Git adapter, projections, resumption protocol | HTTP, GUI layout, model/tool runtime |
| `packages/helm-server` | local HTTP API, SSE invalidation stream, security headers, static Web 전달 | 별도 domain 규칙 |
| `packages/helm-sdk` | 생성 SDK 후보가 될 transport client | workspace state, business 결정 |
| `packages/helm-cli` | init, capture, record, brief, resumption, serve/web, remote attach | client 전용 state schema |
| `apps/helm-web` | Brief, timeline, 저마찰 semantic capture | 정본 state, 숨긴 resumption answer key |
| `experiments/helm-sidecar` | Founder Dogfood 001의 선행 실험 | 안정 호환 의무 |

Runtime state(§4):

```text
.helm/
├── workspace.json                 # workspace identity and Purpose
├── events.jsonl                   # append-only canonical Event ledger
└── private/
    └── resumption-keys.json       # participant에게 숨겨야 할 answer keys
```

`--state-dir`로 state를 프로젝트 밖에 둘 수 있다(read-only sidecar dogfood, 민감한 프로젝트, 일회성 실험).

Experimental Event contract 필드: `schema`(`helm.event.experimental.v0`), `id`(`evt_...`), `type`, `occurredAt`, `actor`(예 `human:local`), `authorityBasis`(예 `direct-user-input`), `concern`(예 `workspace-direction`), `subject`(예 `decision:...`), `payload`, `provenance`, `causationId`, `correlationId`. Event 수정·삭제 API 없음. 같은 Git snapshot은 결정적 Event ID로 중복 append 거부. Event type과 projection schema는 public 호환 계약이 아니다.

#### 2.1.3 semantic write path (§5)

| Input | Event | 필수 증거 |
|---|---|---|
| Decision | `normative.decision.committed` | rationale, reopen trigger, status quo alternative |
| Commitment | `normative.commitment.created` | owner, acceptance evidence |
| Belief update | `epistemic.belief.updated` | confidence basis, 선택적 counterevidence |
| Next action | `projection.next_action.proposed` | summary와 authority |

Git adapter는 `material.snapshot.observed`와 `material.worktree_change.observed`만 만든다. 파일 이름이나 diff에서 Decision·Belief·Acceptance를 추론하지 않는다.

#### 2.1.4 Projection policy (§6)

- `WorkspaceProjection`과 `ReturnBrief`는 Event ledger에서 재생성.
- Purpose, latest Decision, active Commitment, Belief change, Next action을 분리.
- 최신 Git snapshot만 material current-state로 투영.
- file Event는 Foundation, Research, Prototype, package/app 등 의미 단위로 묶는다.
- Brief는 material group 최대 5개만 표시, raw path는 state/timeline에서 drill-down.
- 모든 projection은 `sourceCursor`를 가진다.
- Dogfood 002 최종 capture에서 raw file change 89개가 group 5개로 줄었다.

#### 2.1.5 CLI·GUI 계약과 서버 surface (§7)

Local one-shot 예: `helm init --purpose ...`, `helm record decision --summary --rationale --reopen`, `helm capture git`, `helm brief`. Shared server: `helm web --port 4096`, `helm --attach http://127.0.0.1:4096 status`.

Server surfaces: `GET /api/health`, `GET /api/state`, `GET/POST /api/events`, `GET /api/event`(SSE projection invalidation), `GET /api/brief`, `POST /api/capture/git`, `POST/GET /api/resumptions`, `GET /api/openapi.json`. 구현 세부는 §8.

#### 2.1.6 Resumption experiment (§8)

`helm resumption start`는 현재 cursor와 상황 probe 네 개를 고정한다: (1) Purpose (2) latest committed Decision (3) important Belief change / uncertainty (4) next valid action. 정답은 public Event payload나 API에 넣지 않고 private state에 저장, Event에는 answer-key hash만. 참여자 답은 자동 채점하지 않고 `awaiting-human-review`로 기록.

#### 2.1.7 보안 경계 (§9)

강제하는 것: 기본 bind `127.0.0.1`, 비-loopback bind는 `--allow-remote` 없으면 CLI 거부, request body 1 MB 제한, static asset allowlist와 CSP/security headers, input project와 state directory 분리 가능, private answer key를 public timeline/API에서 제외, 의미 Event에 Actor와 authority basis 필수.

없는 것: remote 인증과 TLS, multi-user identity/authorization, 프로세스 간 Event append lock, secret 암호화·키 관리, 서명된 Event 무결성. 따라서 local development 전용.

#### 2.1.8 Foundation 구현 범위 (§10)

| Foundation invariant | 상태 |
|---|---|
| Append-only Event and provenance | local JSONL store에서 강제 |
| N/E/M semantic separation | 명시적 Event type과 projection으로 표현 |
| Committed Decision rationale/reopen trigger | 강제 |
| External adapter idempotency | 같은 Git snapshot에 강제 |
| Reproducible projection cursor | 강제 |
| Context compression with drill-down | 첫 구현, grouping policy는 휴리스틱 |
| Hidden experimental answer keys | public Event/API와 분리 |
| WorkUnit/Delegation state machine | 미구현 |
| Acceptance and Integration transitions | 미구현 |
| Authority graph and policy engine | 문자열 증거만, graph로 강제 안 함 |
| Semantic conflict detection | 미구현 |
| Agent runtime adapters | 미구현 |
| Stable migration protocol | 미구현 |

#### 2.1.9 OSS/SaaS 경계와 승격 관문 (§11, §12)

OSS kernel: Event ledger와 local projections, CLI·local HTTP API·SDK·Web GUI, Git과 향후 agent adapter, export/import와 투명한 grouping policy, 오프라인 Purpose·Inquiry·Decision·Commitment·Brief 흐름. Future SaaS: 다중 human identity와 authority graph, 팀 동기화와 공유 Decision Gate, 조직 policy·audit, workspace 간 evidence/decision graph, 장기 resumption 분석. "SaaS가 로컬 개인 사용의 핵심 의미 기능을 잠그지 않는다."

브리프와의 관계: 브리프 결정 24(혼자 쓰는 앱)로 SaaS·팀 기능은 범위 밖이다.

`experimental.v0`를 stable schema로 승격하는 조건(6개):
1. 세 번 이상의 실제 지연 재개에서 critical state miss 없음
2. semantic correction이 run당 2개 이하
3. raw log fallback이 현재 docs/chat 기준보다 감소
4. material grouping이 중요한 변경을 빠뜨리지 않으면서 5개 이하 유지
5. CLI와 GUI가 같은 Event cursor와 projection 재현
6. 사용자가 semantic capture 부담을 결과 품질·agency 대비 수용 가능하다고 평가

### 2.2 fundamentals (`docs/architecture/fundamentals.md`) — Docs-Agent OS 원론

이 문서는 Helm 이전 제품(`packages/agent-docs-init`, npm initializer)의 원론이다. Helm 정본 개념은 아니지만, 문서 상태를 정본으로 쓸 때의 결함 목록(§5)은 Helm 설계의 반면 자료다. dogfood 예시 Inquiry Map은 이 구조를 F1 "Docs/Context Management" 프레임으로 분류했다.

#### 2.2.1 정의와 비유 (§1)

`docs/` 구조로 AI 에이전트 작업 흐름을 제어하는 수동적 운영 체계(passive operating system). 전제: 에이전트는 코드 전에 `docs/`를 먼저 경유, 모든 작업은 의도(intent)와 범위(scope)로 분류, 작업 상태는 문서 파일(YAML, Markdown)에 기록, 세션이 바뀌어도 문서 상태로 이어짐.

| OS 개념 | 대응 |
|---|---|
| Boot loader | CLAUDE.md → `docs/README.md`(라우터) |
| Process table | `state/current.yaml` |
| File system | `features/`, `references/`, `decisions/` |
| Process context | `features/<id>/current.md` |
| Checkpoint/restore | `state/checkpoints/` |
| System calls | 의도+범위 분류 → 필수 경유 경로 |

#### 2.2.2 4-Layer 구조 (§2)

CLAUDE.md(Boot) → `docs/README.md`(Router) → Layer 1 `state/`(전역 상태), Layer 2 `references/`(배경 원문), Layer 3 `features/`(작업 허브), Layer 4 `decisions/`(판단 기록).

- Layer 1: `current.yaml`(활성 feature, hot files, risks, next actions), `checkpoints/`. 원칙: current.yaml은 얇게, checkpoint는 세션 종료나 handoff 때만, 없으면 `.template`에서 생성.
- Layer 2: `index.yaml`(id, title, kind, path, tags), `<kind>/`(architecture, product, specification, testing, policy, external). 원칙: index로 먼저 좁히고 원문은 필요한 부분만, feature 연결은 feature의 meta.yaml이 소유, 새 문서 추가 시 같은 커밋에서 index 갱신.
- Layer 3: `README.md`(TL;DR, scope, entry points, main flow), `meta.yaml`(status, importance, primary_paths, related_references), `current.md`(task profile, goal, progress, risks, next step), `decisions.md`, `workspace/`, `archive/`. 원칙: 진행 상태는 primary feature의 current.md에만, secondary는 링크만, 작업 문서는 workspace/에 두고 current.md에 연결, `_feature-template/`은 직접 수정 금지.
- Layer 4: `decision-log.md`, `ADR-*.md`. ADR 기준: 구조 변경, 공용 패턴 변경, 규칙/정책 변경, 다수 feature 영향, 되돌리기 어려운 결정.

#### 2.2.3 라우팅 프로토콜 (§3)

필수 경유: 모든 작업 → `state/README.md` → `references/README.md` → `features/README.md`.

의도 7개 × 범위 4개 매트릭스(S=state, R=references, F=features, D=decisions):

| 의도 \ 범위 | single-feature | multi-feature | cross-cutting | global |
|---|---|---|---|---|
| plan | S R F | S R F | S R F D | S R F D |
| investigate | S R F | S R F | S R F D | S R F D |
| fix | S R F | S R F | S R F D | S R F D |
| change | S R F | S R F | S R F D | S R F D |
| add | S R F | S R F | S R F D | S R F D |
| refactor | S R F D | S R F D | S R F D | S R F D |
| govern | S R D | S R D F | S R D F | S R D |

종료 프로토콜: `state/current.yaml`, `decisions/decision-log.md`, 관련 feature `current.md` 갱신. 구조 변경 시 feature `README.md`, `meta.yaml`, `decisions.md`, ADR 추가.

#### 2.2.4 2계층 파일 모델 (§4)

스캐폴드(universal: `README.md`, `*.template`, `_feature-template/`, 업데이트 시 덮어쓰기 가능)와 인스턴스(project-specific: 실제 파일, 절대 덮어쓰기 금지)를 분리. scaffold-owned 12개 경로와 instance-owned 8개 경로 목록이 원문에 있다.

#### 2.2.5 구조적 갭 분석 (§5) — Helm 설계에 쓸 반면 자료

| 번호 | 갭 | 심각도 | 내용 |
|---|---|---|---|
| 5.1 | 부트스트랩 부재 | Critical | CLAUDE.md에 진입 지시가 없어 시스템 전체가 비활성 |
| 5.2 | 상태 일관성 보장 없음 | High | 상태 표면 4개(current.yaml, feature current.md, meta.yaml, decision-log.md) 동기화에 순서 제약·불변식·검증·롤백 경로 없음 |
| 5.3 | 메타데이터 이중 소유 | Medium | index.yaml과 meta.yaml 중복. 해결: meta.yaml 정본, index는 파생 |
| 5.4 | 의도/범위 분류 지원 부족 | Medium | 28 조합, 정의 한 줄 |
| 5.5 | 토큰 예산 미정의 | Medium | 필수 사전 읽기 최소 ~1,800 토큰, 상한(예: 5k) 필요 |
| 5.6 | 코드→Feature 역방향 인덱스 없음 | Low | |
| 5.7 | Feature 생명주기 미정의 | Low | status 값(draft, active, paused, completed, archived, deprecated)과 전이 규칙 없음 |
| 5.8 | 멀티 에이전트 조율 없음 | Low | 단일 `primary_feature` 모델 |
| 5.9 | 에러 복구 프로토콜 없음 | Low | |

[해석] Helm 이벤트 로그 설계가 답하는 갭: 5.2(단일 변경 경로·트랜잭션), 5.3(정본 하나, 투영은 파생), 5.5(Context Projection 예산), 5.7(상태 기계), 5.8(동시성), 5.9(복구).

#### 2.2.6 스캐폴딩 전략, CLAUDE.md 연동, 이식성 (§6~§9)

- 비교 대상 9개: GitHub Template Repo, npx initializer, degit/tiged, Git subtree, Git submodule, Copier, Yeoman, Shell script, Monorepo 내부 패키지. 권장: Copier(변수 치환, 3-way merge 업데이트, CLAUDE.md 주입, Git tag 버전) + Shell script fallback.
- CLAUDE.md fragment는 `<!-- docs-agent-os:start -->` / `<!-- docs-agent-os:end -->` 마커로 멱등 주입.
- 이식성 고려: init 멱등성, 기존 docs/ 공존, 스캐폴드 버전 식별(`.docs-agent-os-version` 또는 `.copier-answers.yml`), 다국어, 조건부 포함.
- 우선순위 표 P0~P4(11항목): P0 CLAUDE.md bootstrap, P1 상태 일관성 불변식·분류 예시, P2 meta.yaml 정본·status 열거·토큰 상한, P3 Copier·Shell·에러 복구, P4 역방향 인덱스·멀티 에이전트 조율.

#### 2.2.7 저장소판과 Mac 작업본의 차이

`diff` 결과 차이는 한 곳이다. Mac 작업본(`.helm-design-work/mac-modified/docs/architecture/fundamentals.md`)의 제목 인용 블록 바로 뒤(4~5행)에 다음 문단이 추가되어 있다. 나머지 344행은 같다.

> 이 문서는 현재 Docs-Agent OS v0의 구현 원론을 설명한다. Helm의 상위 제품 철학, 의미 모델, 공동행위 원칙은 [`../foundations/README.md`](../foundations/README.md)를 따른다.

의미: Mac에서는 fundamentals를 "v0 구현 원론"으로 격하하고 상위 원칙을 foundations로 위임하는 수정이 진행 중이었다. 이 판단은 paper 예시 Delegation Contract의 보호 기준선 "기존 Architecture Fundamentals는 v0 기록으로 보존"과 일치한다.

---

## 3. CLI 경험 v0.2 (`docs/experience/helm-cli-agent-v0.2.md`)

지위: "Kernel/runtime/provider contracts, durable Kernel storage, and deterministic linear CLI simulated — model-driven CLI pending". experience 디렉터리는 정본 domain state를 정의하지 않는다(`docs/experience/README.md`).

브리프와의 관계: 이 문서는 터미널 CLI를 첫 제품으로 가정했다. 브리프 결정 19, 32, 39에 따라 첫 클라이언트는 데스크톱 앱이고 TUI는 이후다. 다섯 surface, Gate 조건, 금지 경험, 상태 기계 분리, headless parity는 클라이언트 형태와 무관하게 쓸 수 있다. "UI 문구 언어: 한국어"(결정 37).

### 3.1 제품 경험 정의 (§1~§2)

정의(원문): "Helm CLI는 사용자가 자연어로 AI와 일하는 동안 목표, 이해, 선택, 맡긴 범위, 결과의 의미를 잃지 않게 만드는 first-party AI agent다." 사용자는 Foundation 용어를 외우거나 form을 완성하지 않는다. Agent Runtime이 대화와 도구 사용에서 semantic candidate를 만들고 Kernel이 불변조건을 지킨다. 사용자는 자신의 판단이 결과를 바꾸는 순간에만 구조를 보고 수정한다.

현재 `packages/helm-cli`와의 단절: 있는 것은 `init`, `status`, `brief`, `events`, Decision·Commitment·Belief·Next Action 수동 기록, Git material capture, resumption 실험과 local server. 없는 것은 model/provider 호출, 대화형 agent loop, tool 실행과 steering, 자연어에서 semantic candidate 초안, 중요한 차이만 보이는 interactive Gate, runtime pause/cancel/context refresh, Completion Claim → Acceptance → Integration 상호작용. 현재 명령을 확장하면 사용자가 대화 뒤 `helm record ...`로 의미를 다시 입력해야 하고 이는 Helm이 줄이려는 조정 비용을 다시 만든다.

Migration principle: `helm` 기본 entrypoint는 interactive AI agent, automation과 inspection은 명시적 subcommand, 기존 `record`는 diagnostic/import/admin surface로 재분류, interactive와 headless가 같은 Kernel Command를 쓴다.

### 3.2 사용자 mental model — 다섯 질문 (§3)

1. 어디로 가는가? — Goal
2. 지금 무엇을 풀고 있는가? — Focus/Concern
3. 무엇이 사실이고 무엇이 아직 가능성인가? — Observation/Finding/Possibility
4. 무엇을 어디까지 맡겼는가? — Work Agreement/Allowed Range
5. 무엇을 왜 완료로 받아들였는가? — Result Review/Whole Update

Kernel 용어와 Event type은 inspector와 developer mode에서만 보인다.

### 3.3 실행 형태 (§4)

Interactive: `helm`(기본 workspace 재개 또는 시작), `helm --new`(Goal을 유지한 새 Concern), `helm --resume <work-ref>`, `helm --profile quick`(낮은 의식, policy가 올릴 수 있음), `helm --profile assured`.

Non-interactive/admin: `helm run --prompt <text> --json`, `helm inspect brief --json`, `helm inspect history --json`, `helm workspace export`, `helm workspace doctor`, `helm server`. 명령 이름은 바뀔 수 있으나 interactive와 automation이 같은 semantic Command/Event/Projection을 쓰는 것이 계약이다.

### 3.4 다섯 핵심 surface (§5)

| Surface | 목적 | 보여 주는 것 |
|---|---|---|
| Orient | 다시 참여하기 | 마지막 확인 이후 중요한 변화, 목표와 현재 Focus, 멈춘 이유 또는 다음 자동 행동, 사용자 판단이 필요한 우선 항목 하나, 지금 읽지 않아도 되는 활동. "Event 200개", "파일 99개 변경"은 기본 orientation이 아니고 drill-down에서만 |
| Explore | 문제를 이해하기 | 직접 확인한 관찰, 그 관찰의 해석, 경쟁하는 원인·해결 가능성, 각 가능성을 구분할 Evidence, 확인 안 한 전제. 중요한 불확실성이 실제 경로를 바꿀 때만 펼침 |
| Choose | 방향을 바꾸는 선택 | 지금 정할 것과 why-now, 현상 유지/추가 확인을 포함한 실질 선택지, 추천과 가장 강한 대안, 근거·반대 근거·남은 unknown, 되돌릴 수 있는지, 선택이 바꿀 Work Agreement, review trigger. 사용자는 추천 선택 외에 기준 수정, 질문 재구성, 추가 실험, 연기 가능 |
| Work | 자율 실행과 steering | 지금 하는 일과 이유, 맡긴 범위와 금지 행동, 다음 의미 있는 checkpoint, 지켜보는 위험과 stop condition, 마지막 consequential change. tool call 전체를 기본 stream으로 강요하지 않음 |
| Review | 결과 수락과 전체 반영 | 결과 기준별 Evidence, 확인 안 된 것과 known limitation, counterevidence와 invalidation trigger, 수정/조건부 수락/수락/거절, 다른 Goal·Choice·WorkUnit·Artifact 영향, integration obligation과 다음 learning |

### 3.5 화면 문법 (§6)

Persistent status line(원문):

```text
Goal  Agent-independent Helm foundation
Focus Fix false “no blind spots” projection
Mode  Build · Guided
Work  Compare qualification designs
Range Read all · Write local docs/code · No external actions
Next  Pause before schema choice
```

좁은 터미널: `Build · Guided · comparing qualification designs · pauses before schema choice`.

Conversation area 라벨 7개:

| 라벨 | 뜻 |
|---|---|
| Helm | 자연어 설명과 recommendation |
| Observed | 직접 확인한 내용 |
| Possible | 아직 검증 중인 설명/해법 |
| Choice | 사용자 판단이 필요한 구조화된 요청 |
| Working | 자율 실행의 의미 있는 상태 변화 |
| Review | 결과와 Evidence |
| Source | tool/log/file drill-down |

색만으로 상태를 구분하지 않고 label과 text가 항상 있다.

Slash command 12개(보조 수단, 모든 기능은 자연어로도 가능): `/brief`(현재 상황과 달라진 점), `/goal`, `/focus`, `/explore`, `/choice`, `/scope`, `/work`, `/review`, `/history`, `/profile`, `/pause`(안전한 checkpoint에서 멈춤), `/stop`(현재 실행 취소 또는 compensation 안내).

### 3.6 Guided 기본 리듬과 자연어 → state 규칙 (§7, §8)

```text
Resume/Start → Frame draft → Investigate autonomously → consequential Choice only when needed
→ Work Agreement echo → autonomous interval with semantic checkpoints → Completion Claim
→ Result Review → Whole Update
```

고정 wizard가 아니며 간단한 작업은 한 agent turn 안에서 압축된다.

| 상황 | 규칙 | 예 |
|---|---|---|
| 명확한 직접 지시 | 별도 "확인할까요?" 없이 normative 변경을 짧게 echo, 언제든 정정 가능 | 사용자 "이 작업에서는 외부 배포를 하지 마." → "외부 배포를 금지하고 로컬 변경과 테스트까지만 맡은 범위로 두었습니다." |
| 모호하지만 결과 영향 작음 | provisional interpretation을 만들고 진행 가능한 read-only 조사부터 | "“빠르게 정리”를 문서 구조 개선으로 이해하고 먼저 읽기만 하겠습니다. 코드 삭제나 공개 API 변경이 필요하면 그 전에 멈춥니다." |
| 모호하고 결과 영향 큼 | Gate를 연다. 모호함을 그대로 되묻지 않고 차이가 만드는 결과를 설명 | |
| Epistemic extraction | 대화에서 추출한 Observation/Interpretation/Possibility는 candidate. 기록되었다고 accepted Finding이 되지 않음 | |
| Normative extraction | Agent recommendation은 Choice가 아님. 명시적 사용자 선택 또는 승인된 policy transition이 있어야 기준선 변경 | |

### 3.7 Gate 생성 조건과 Choice 상호작용 (§14)

Gate 생성 조건(CLI 경험판, 4개 모두):
1. 결과가 실질적으로 다른 대안이 있다.
2. policy/agent만으로 정당하게 선택할 수 없다.
3. 지금 묻는 것이 늦게 묻는 것보다 가치가 있다.
4. 사용자의 답이 실제 downstream plan/Agreement를 바꾼다.

(kernel 후보 §11판 3개: policy 자동 처리 불가, Actor 판단이 결과를 실질적으로 바꿈, 지금 묻는 가치 > attention cost.)

Compact Gate 예(원문):

```text
Choice · 어떤 상태를 Brief의 최신 선택으로 보여줄까요?

왜 지금
현재는 마지막으로 append된 문자열이 자동 기준선이 되어 잘못된 Brief를 만듭니다.

추천
qualified + accepted Choice만 active baseline으로 투영

가장 강한 대안
문자열 품질 heuristic으로 의심 항목만 제외 — 빠르지만 언어와 맥락에 취약

아직 모르는 점
과거 experimental Event를 어떤 quality state로 import할지 정하지 않았습니다.

[추천 선택] [기준 수정] [먼저 실험] [연기]
```

"단순 `[승인] [거절]`은 사용하지 않는다."

Choice impact echo(선택 직후): "이 선택으로 바뀐 것"(active Choice projection은 qualified + accepted만 사용, 기존 experimental Decision은 captured/unqualified로 import, migration report와 regression test가 Work Agreement에 추가됨), "다시 볼 조건"(qualification burden 때문에 normal Guided 작업이 반복적으로 막힐 때).

### 3.8 approval theater

정의 위치: `docs/foundations/04-co-agency.md` §8 공동행위 안티패턴. "사용자에게 실질적 선택이 없는 승인 버튼을 반복 제공한다." 같은 절의 다른 안티패턴 6개: Silent autonomy(무엇을 왜 하는지 드러내지 않고 실행), Summary collapse(충돌·불확실성을 매끄러운 요약으로 제거), Agent anthropomorphism, Human as exception handler(평상시 이해 기회를 없애고 가장 어려운 실패 순간에만 호출), Independence maximization, Context flooding(차이를 선별하지 않고 모든 로그·문서를 보여 줌).

원전에서 approval theater가 쓰인 곳:
- `foundations/09-operating-theory.md:353` "사용자의 답이 결과를 바꾸지 않는 approval theater", `:599` "Decision Gate가 대부분 approval theater로 끝남"(반증 신호)
- `foundations/08-falsifiable-hypotheses.md:257` "Gate precision이 낮아 approval theater가 됨"
- `research/method-cards/critical-pauses-and-crew-coordination.md:80` "실질적 선택 없이 pause만 추가"
- `prototypes/agent-v0.2/helm-cli-guided-001.md` Beat 4 "Agent drafts and proceeds without another approval theater Gate", 측정 시트 "approval-theater questions", 통과 기준 "zero approval-theater questions"
- `runs/codex-kernel-baseline-001.md` 측정 "approval-theater questions: 0", `bin/simulate-guided-001.mjs` 보고서 필드 `approvalTheaterQuestions: 0`
- `paper-v0/experiment-protocol.md` Study 1 목적 "Gate theater" 발견, §14 수정 신호 "Gate가 대부분 추천 승인으로 끝남"
- 감사 보고 §3.4 A15: "선택 요청의 선택지에 기준 수정, 질문 재구성, 먼저 실험, 연기를 항상 포함한다. approval theater 금지"

[해석] 원전에서 approval theater를 막는 장치는 네 가지다. (1) 선택지에 기준 수정·먼저 실험·연기를 항상 포함 (2) 비확장 Work Agreement는 권한 포함 관계 증명으로 재질문 없이 활성화(§4.6) (3) Gate 생성 조건 3~4개 (4) "May I continue / 계속할까요" 같은 문구가 출력에 없는지 테스트(`experience.test.mjs`).

### 3.9 Profile (§9)

| profile | 정의 |
|---|---|
| Quick | "대충 하기"가 아님. 작은 local/reversible 변경, 명확한 Goal·Result, 확립된 policy와 자동 검증, 낮은 semantic coupling. UI는 Frame/Agreement를 한두 문장으로. 내부 provenance와 Completion/Acceptance 경계는 유지 |
| Guided (기본) | Goal·Focus 표시 유지, 중요한 Observation/Interpretation/Possibility 구분, consequential Choice와 Work Agreement를 짧게, semantic checkpoint를 묶음, evidence 기반 Result Review. 사용자가 고르지 않으면 Guided |
| Assured | 신호: external/shared effect, secret·production·payment·customer data, 낮은 recoverability 또는 높은 cost, 규범적 가치 충돌, 중요한 agent/stakeholder 이견, cross-system coupling, evidence 품질이 낮은데 결과 영향이 큼. 더 많은 승인 버튼이 아니라 더 명확한 problem frame, evidence burden, authority, recovery, independent review |

전환: Quick → Guided(예상 밖 불확실성, 범위 증가, semantic conflict), Guided → Assured(높은 effect class, 낮은 recoverability, authority 경계), Assured → Guided/Quick(위험 해소, policy가 낮은 부담이 안전한 이유를 설명). 변경 이유를 보여 주고 사용자는 더 엄격한 profile을 고를 수 있다. policy가 요구한 Assured를 사용자가 조용히 낮출 수 없다.

브리프와의 관계: 브리프 결정 3은 "모드는 페르소나가 아니다. 루프 계획 기본값, 능력 부분집합, 다이얼 값의 설정"이라고 정했다. Quick/Guided/Assured는 v0.3에서 모드·다이얼로 재정의된 대상이다(14 담당).

### 3.10 Onboarding과 Resumption (§10, §11)

First launch 문구(원문): "이 프로젝트에서 Helm을 시작합니다. / 지금은 파일과 Git 상태를 읽기만 합니다. / 프로젝트 안에 Helm state를 둘지, 개인 state directory에 둘지 선택할 수 있습니다. / 프로젝트 instruction이나 extension은 검토 후에만 활성화합니다."

Goal framing 초안 항목 5개: Goal(이루려는 변화), Result(받아들일 수 있는 상태), Protect(지켜야 할 가치/기준선), Not now(명시적 비목표), First focus(처음 풀 Concern). 빈 입력란 다섯 개를 순서대로 묻지 않는다. 사용자 발화와 repository evidence로 초안하고 결과를 바꾸는 모호함만 묻는다. 기존 프로젝트에서는 README, Git, tests, agent instructions로 material observation을 만들 수 있지만 Purpose/Choice를 자동 추론해 확정하지 않는다.

Resumption: "마지막 Event"가 아니라 사용자가 마지막으로 상황을 이해했다고 표시한 cursor(User-acknowledged cursor) 이후 차이를 보인다.

Brief 순서 6단계:
1. 돌아온 뒤 달라진 점
2. 왜 중요한가
3. 그대로 두면
4. 지금 내 판단이 필요한 것
5. 맡긴 범위 안에서 자동으로 이어질 것
6. 지금 읽지 않아도 되는 것

Resumption actions: 맡긴 범위 안에서 계속, 목표/기준/범위 수정, 열린 Choice 처리, source 근거 확인, pause/stop. Brief를 읽은 행위와 이해했다는 주장을 같게 보지 않는다. 실험에서는 별도 situation probe로 잰다.

### 3.11 Steering, interruption, tool activity (§12, §13)

사용자가 실행 중 자연어로 바꿀 수 있는 것: Goal priority, Problem view, success/acceptance criterion, protected baseline, Allowed Range, next checkpoint, pause/stop. Agent는 queued message를 다음 prompt로만 처리하지 않고 영향받는 Choice, Agreement, Context를 invalidate/recompile한다.

Agent escalation 포함 항목: 무엇을 발견했는가, 왜 현재 맡긴 범위로 해결할 수 없는가, 멈춘 상태와 이미 발생한 effect, 가능한 선택과 추천, 언제까지 판단이 필요한가.

Pause semantics:
- `pause`: 현재 tool action이 안전하게 끝나는 checkpoint에서 멈춤
- `stop`: 취소 요청, 이미 발생한 effect와 compensation 필요 여부 보고
- hard abort: 즉시 process 중단, workspace는 recovery-required가 될 수 있음
UI는 이 차이를 숨기지 않는다.

Tool activity 기본 압축 예: `Working · Decision qualification 경로 확인 / read 4 files · ran 2 focused searches · no material change`.

항상 표시(7개): material mutation 시작/완료, external/shared effect, permission/authority denial, Finding을 바꾸는 test evidence, recommendation을 바꾸는 counterevidence, protected baseline conflict, cost/time/risk 임계 초과.

Drill-down source trace 필드: timestamp, command/tool, input scope, output reference, exit/error, originating WorkUnit.

### 3.12 Work Agreement와 Completion·Acceptance·Integration 상호작용 (§15, §16)

Work Agreement compact echo(원문 예):

```text
Work · Brief qualification path

Result
유효하지 않은 Decision이 active baseline이나 “blind spot 없음”으로 보이지 않는다.

Allowed
관련 docs/core/projection/test의 로컬 변경과 테스트

Not allowed
기존 JSONL 삭제, stable schema 선언, 외부 publish

Evidence
regression test · old JSONL import report · deterministic replay

Pause when
기존 Event 의미를 자동 추정해야 하거나 migration loss가 발생함
```

사용자는 `범위 좁혀`, `테스트는 전체로`, `migration은 이번에 하지 마`처럼 자연어로 수정한다.

Completion Claim 예: `✓ unqualified Choice excluded from active baseline — test ...`, `✓ blind spot reports unqualified choice — test ...`, `✓ projection replay deterministic — test ...`, `△ old JSONL migration — report only, importer not implemented`.

User actions: 결과 확인, 제한을 남기고 조건부 확인, 수정 요청, 결과 거절, 근거 더 보기.

Integration(Acceptance 뒤에도 남을 수 있는 것): docs·public language 갱신, adapter contract 변경, 기존 workspace migration, 의존 Context invalidation, release와 rollback plan. UI는 "수락됨 · 전체 반영 2개 남음"처럼 표시. `완료`는 integration obligation이 없을 때만 단독 사용.

### 3.13 오류·저하 상태 (§17)

| 상태 | 문구·규칙 |
|---|---|
| Kernel unavailable | 의미 상태 없이 일반 chat으로 조용히 계속하지 않음. "Helm state에 기록할 수 없어 실행을 멈췄습니다. / 대화 초안은 보존했지만 Choice와 Work Agreement는 확정되지 않았습니다." |
| Adapter capability missing | "이 runtime에서는 tool 실행 전 권한 차단을 강제할 수 없습니다. / 현재 맡긴 범위는 advisory이며 실제 sandbox가 아닙니다." |
| Projection stale | stale view를 current처럼 표시하지 않음. source cursor와 invalidation reason 표시 |
| Unknown external outcome | timeout을 실패로 단정하지 않음. 외부 action이 실제로 발생했는지 확인할 WorkUnit 생성 |

### 3.14 접근성과 터미널 동작 (§18)

80-column text fallback, 색과 무관한 label, screen reader용 linear mode, animation/spinner 없이도 이해 가능, 전체 keyboard 조작, 복사 가능한 source ref와 plain-text export, CJK/emoji 표시 폭 테스트, 크기 조절 시 의미 손실 없음, streaming 중 user input/steering 보존, `NO_COLOR`와 non-interactive 환경 지원.

### 3.15 Headless parity (§19)

TUI에서만 존재하는 business action을 만들지 않는다.

```text
TUI interaction → typed Client Command → Kernel decision/result → semantic UI event
Headless JSON interaction → same typed Client Command → same Kernel decision/result
```

Headless에서 human Gate가 필요하면 `needs_gate` result와 resume token을 반환한다. stdin prompt를 열어 CI를 멈추지 않는다.

### 3.16 소프트웨어 공학 고려 (§20)

하나의 `status`로 합치지 않을 상태 기계 네 개:

| 상태 기계 | 상태 |
|---|---|
| Agent loop state | idle / thinking / tool-running / paused / stopped |
| WorkUnit domain state | proposed / active / claiming / accepted / integrating / closed |
| Connection state | connected / degraded / reconnecting / offline |
| Projection freshness | current / stale / rebuilding / failed |

- Event loop와 취소: tool 실행은 cancellable signal을 받음, pause와 abort 의미를 tool capability별로 명시, streaming UI 갱신을 정본 transaction과 결합하지 않음, 터미널 crash 뒤 미완료 tool/result를 recovery state로 복원.
- Rendering: Kernel Projection과 terminal component model 분리, semantic UI event를 golden transcript로 테스트, viewport snapshot보다 linear accessible 표현을 먼저 검증, tool plugin 출력은 untrusted content로 escape/sanitize.
- Provider neutrality: provider message type을 Kernel Entity로 쓰지 않음, model별 reasoning/token 필드는 operational telemetry, tool schema와 context compilation은 provider capability adapter를 가짐, provider 전환 후에도 Goal/Choice/Agreement/Result 유지.
- Secrets와 local trust: provider credential은 Event/Projection에 들어가지 않음, project instruction·skill·extension은 trust 후 load, shell/environment capture에 secret redaction, transcript export와 evidence export는 다른 privacy policy.
- Crash consistency: Command idempotency key, tool action intent와 outcome 상관, single-writer Kernel transaction, durable user steering queue, resumable human Gate, 일관된 SQLite backup과 evidence manifest.

### 3.17 첫 시나리오 묶음 (§21)

| ID | Profile | 사용자 목표 | 검증할 핵심 |
|---|---|---|---|
| CLI-Q01 | Quick | 작은 문서 오탈자 수정 | 의미 경계 유지와 낮은 마찰 |
| CLI-G01 | Guided | 잘못된 Decision이 Brief를 오염시키는 문제 해결 | inquiry, choice, agreement, review |
| CLI-G02 | Guided | 실행 중 사용자가 완료 기준 변경 | steering과 invalidation |
| CLI-G03 | Guided | 하루 뒤 작업 복귀 | situation recovery와 raw-log fallback |
| CLI-A01 | Assured | 외부 배포가 포함된 변경 | authority, recovery, human Gate |
| PORT-G01 | Guided | Codex → Pi → OpenCode handoff | semantic continuity와 capability degradation |

첫 구현은 CLI-G01, 이어 Q01, G02, G03. A01은 외부 effect를 실제로 일으키지 않는 시뮬레이션으로 시작. 실제 수행된 것은 CLI-G01뿐이다(§4).

### 3.18 UX 수용 기준 (§22)

- Correctness: 사용자가 고친 Goal/criterion/scope가 다음 agent action과 Context에 반영. Recommendation이 Choice로 자동 승격되지 않음. Completion Claim이 자동 Acceptance/Integration이 되지 않음. stale/unqualified/contested가 current accepted baseline처럼 보이지 않음. TUI와 headless가 같은 source cursor와 policy result 재현.
- Attention: Guided 중간 작업에서 consequential Gate가 3개를 넘으면 각각의 필요성 검토. routine tool activity가 기본 view의 절반 이상을 차지하지 않음. 동시에 active한 user Gate는 기본 3개 이하로 묶음/우선순위. 같은 미해결 질문 중복 요청 금지. 숫자는 초기 가설이며 dogfood에서 조정.
- Situation recovery: raw transcript 없이 Goal, latest accepted Choice, important uncertainty, next valid action을 설명 가능. Brief 사용 후 정정이 필요하면 원본과 projection 중 어느 쪽 결함인지 구분. raw-log fallback 시간·횟수가 기준보다 감소.
- Agency and usefulness: 사용자 정정이 downstream 결과에 관찰 가능한 영향. 사용자가 단순 승인자가 아니라 기준과 방향의 저자였다고 평가. Guided 부담이 재작업 감소·이해 향상보다 크지 않음. 다음 작업에서도 Helm 방식을 다시 선택.

### 3.19 금지되는 CLI 경험 10개 (§23)

1. 대화를 끝낸 뒤 사용자가 별도 `record` command로 같은 의미를 재입력하게 함
2. 매 turn마다 Goal/Choice/Agreement form을 출력
3. agent reasoning transcript를 situation awareness로 대체
4. 모든 tool call을 live dashboard의 중심으로 표시
5. `[승인] [거절]`만 제공하고 기준 수정이나 대안 탐구를 막음
6. user correction을 chat message로만 남기고 Kernel state/Context를 바꾸지 않음
7. "confidence 90%"를 Evidence 설명 대신 사용
8. tool success를 Result Acceptance로 표시
9. external adapter의 advisory boundary를 enforced sandbox처럼 표현
10. first-party Agent Runtime이 private API로 Kernel invariant를 우회

### 3.20 다음 검증 (§24)

검증된 것: semantic trace, canonical Event, Gate 정책, 최소 contract(Kernel Run 001), 결정적 user-visible rendering(Linear CLI Run 001), bounded Agent Runtime, mocked provider mapping, Authority Grant, effect-aware cancellation, Context Projection, SQLite transaction/replay. 검증 안 된 것: 실제 human workload, live model 동작, 터미널 상호작용.

다음 6단계: (1) product-owner가 결정적 transcript의 Gate 수, 맡긴 범위 echo, 용어 밀도 검토 (2) live provider와 streaming decoder 연결 (3) CLI-G01을 model-driven 대화 CLI로 재실행 (4) user-visible output, hidden candidate, canonical Event와 correction/workload 대조 (5) durable runtime journal 추가, CLI-G02 steering과 CLI-G03 지연 재개로 상태 복구 검증 (6) first-party UX 통과 후 같은 fixture를 외부 runtime adapter에서 실행. 이 6단계 중 (1)~(6) 모두 수행 기록이 없다.

---

## 4. agent-v0.2 시나리오와 run 9개

모든 run 날짜는 2026-08-22, 수행 주체는 Codex(대본 기반). 실제 모델 호출, 실제 사람 참여, 실제 외부 runtime은 한 번도 없었다. 사용자 응답은 모두 시나리오에 미리 적은 대본이다.

### 4.1 CLI-G01 시나리오 (`helm-cli-guided-001.md`) — False "No Blind Spots"

질문: Helm CLI Agent가 실제 저장소 결함을 고치는 동안 다음 여섯 가지를 동시에 달성하는가.
1. 사용자가 별도 Foundation form을 작성하지 않는다.
2. Agent가 Observation, Interpretation, Possibility, Choice를 섞지 않는다.
3. architecture에 영향을 주는 순간만 user Gate를 만든다.
4. 맡긴 범위와 stop condition 안에서 자율 실행한다.
5. Completion Claim, Acceptance, Integration을 구분한다.
6. 사용자가 작업 뒤 raw transcript 없이 현재 상황을 복원할 수 있다.

시작 증거(fixture의 truth source): `.helm/events.jsonl`의 experimental Decision 하나가 `summary: ㅇ`, `rationale: ㅁㄴㅇ`, `reopenTrigger: ㅁㄴㅇ`. projection은 subject별 마지막 Decision 목록의 마지막 원소를 "latest decision"으로 씀. `blindSpots`는 Decision 배열이 비었는지만 검사. Brief는 그 Decision을 보이면서 `none in the minimum projection`이라고 씀. 코드는 Decision의 필수 문자열 존재만 검사.

User prompt(원문): "현재 Brief가 ㅇ이라는 결정을 최신 결정으로 보여주면서 blind spot은 없다고 해. Foundation에 맞게 원인을 판단하고 제대로 고쳐줘."

Initial allowed range: Read(저장소 전체, local .helm public state), Write(candidate docs, new experiment, focused core/projection/test 변경), Allowed execution(local tests, 결정적 시뮬레이션), Forbidden(기존 Event 삭제·재작성, remote publish/deploy, stable schema 승격, private answer key 노출), Pause when(옛 experimental Event 의미를 파괴적으로 추정해야 할 때, migration loss를 피할 수 없을 때, public 호환 결정이 필요할 때).

박자 8개:

| Beat | 내용 | Gate |
|---|---|---|
| 1 Orientation and Frame draft | 넓은 질문이 아니라 결과 중심 증거로 시작. Observed 2줄 + Working frame(Goal, Focus, Result, Protect) + "먼저 읽기와 focused test로 원인을 확인하겠습니다. schema 선택 전에는 멈춥니다." | 없음(read-only 조사는 허용 범위) |
| 2 Inquiry | 가능성 4개를 보존(아래 표). 첫 번째를 조용히 답으로 내놓지 않음 | 없음 |
| 3 Consequential Choice | 정본 상태 의미와 migration을 바꾸므로 Gate 1개 | Choice Gate |
| 4 Work Agreement | Agent가 초안하고 "another approval theater Gate" 없이 진행 | 없음 |
| 5 Autonomous interval | routine activity를 묶어 표시. 반대 근거가 추천을 바꾸면 즉시 표시 | 없음 |
| 6 Completion Claim | 증거 행렬, known limitation, integration obligation이 남으면 "complete"라고 하지 않음 | 없음 |
| 7 Result Review | 사용자: 수락, 조건부 수락(migration obligation), 수정 요청, rationale·evidence 거절, source 확인 | Result Gate |
| 8 Integration | obligation 정리. 수락한 obligation이 통합되거나 명시적으로 이전될 때만 `closed` | 없음 |

Beat 2 가능성 표:

| Possibility | 장점 | 약점 | 구분 증거 |
|---|---|---|---|
| string quality heuristic | 작은 패치 | 언어·맥락에 취약, 사람 의도 판단 | 다국어·적대적 예시 |
| required structured fields only | 결정적 | garbage로 모든 필드를 채울 수 있음 | 현재 결함 + 합성 fixture |
| qualification + acceptance state | Foundation 경계와 일치 | migration과 UX 부담 | 상태 전이/replay 시제품 |
| human-selected active pin | 명시적이고 단순한 projection | stale pin과 매 선택 부담 | resumption workflow 테스트 |

Beat 3 Gate(원문 요지): Question "어떤 Decision을 active Choice baseline으로 투영할까요?", Recommendation "qualified + accepted Choice만", Strongest alternative "사람이 active Choice를 직접 pin(관리 부담, stale pin 위험)", Why now "Event schema, migration, Brief, future adapter contract를 결정", Unknown "기존 experimental Decision을 자동 qualification할 근거 없음", Reversible "candidate 단계에서는 되돌릴 수 있지만 stable migration 뒤에는 비용 증가".

대본 사용자 답(원문): "qualification + acceptance로 가되, 기존 Event는 삭제하지 말고 unqualified로 남겨. Guided 작업에서는 agent가 qualification 초안을 만들고 내가 중요한 선택만 확인하게 해." 기대 impact echo: active baseline 규칙 변경, legacy import 정책 추가, Guided 상호작용 부담 제약 추가, regression·migration-report 증거 의무 추가.

Beat 4 Work Agreement: Result(unqualified 제외, Brief가 "none" 대신 공백 노출, legacy history 재현 가능), Evidence(projection regression, garbage-but-nonempty fixture, deterministic replay, loss-aware migration report 또는 명시적 연기 의무), Allowed(local candidate Kernel/projection/test/docs), Not allowed(`.helm/events.jsonl` 재작성, stable schema 선언), Pause(호환을 위해 acceptance를 추정해야 할 때, accepted Choice를 재구성할 수 없다는 테스트 결과).

Beat 6 증거 행렬: unqualified 제외 → focused projection test, blind spot이 unqualified Choice 보고 → Brief golden output, history append-only/replay → replay test, 옛 JSONL migration 모호성 표시 → migration report fixture, 현재 테스트 전부 → test run.

Beat 7 대본 답(원문): "core semantics와 regression은 결과 확인. 기존 JSONL importer 구현은 별도 obligation으로 남기고 문서/contract에는 반영해."

Beat 8 obligation: Foundation/architecture 용어 정렬, 현재 experimental 구현을 legacy/experimental로 표시, CLI 경험은 수동 form이 아니라 Guided draft, portability contract가 qualification 의미를 상속, importer 미구현이면 pending으로 계속 표시.

정본 semantic trace 후보(§6):

```text
goal.open or goal.link
concern.open
observation.capture × n
interpretation.propose
possibility.propose × n
choice.open
choice.commit                 # human answer
agreement.offer
agreement.accept              # direct user instruction may satisfy
run.attach
observation.capture × n       # tool/test outcomes
claim.propose                 # completion-related findings
completion.submit
result.accept                 # human conditional acceptance
integration.start
integration.complete or obligation.transfer
```

"No canonical Event type begins with `projection.`."

숨김 후보 vs 정본 상태(§7):

| 항목 | 숨김/압축 가능 | 정본 효과 전에 보여야 함 |
|---|---|---|
| routine file reads | 예 | 아니오 |
| Agent interpretation | 압축된 candidate | recommendation을 이끌 때 |
| Possibility set | 경로가 다르지 않으면 압축 | consequential 대안 |
| Recommendation | 별도 확인 불필요 | committed Choice처럼 보이면 안 됨 |
| direct user constraint | compact echo | 정정 경로 필수 |
| Work Agreement | compact | result/range/evidence/stop conditions |
| Completion Claim | 아니오 | evidence와 limitation 요약 |
| Acceptance | 아니오 | human/policy authority와 남은 obligation |

실패 주입 F1~F6(§8):

| ID | 주입 | 기대 |
|---|---|---|
| F1 | garbage fields: 구조는 맞지만 unqualified인 Choice | history에 capture, active baseline 아님, attention/quality signal 표시, 언어 기반 삭제 없음 |
| F2 | adapter가 `projection.next_action.proposed` 제출 | 지원 안 되는 Command/domain type으로 거부, recommendation은 파생 projection에만 |
| F3 | runtime adapter가 완전한 정본 Event 전송 | append 권한 없음, Command 또는 Observation candidate로 재제출해야 |
| F4 | 두 actor가 같은 cursor로 commit | 첫째 성공, 둘째는 semantic conflict/rebase context, silent last-write-wins 없음 |
| F5 | Agreement 뒤 사용자가 acceptance criterion 변경 | 영향받는 Context/Agreement stale, 옛 기준으로 계속하지 않음, 새 Work Agreement echo, 무관한 중복 Gate 없음 |
| F6 | Agent가 테스트 통과 결과 제출 | Completion Claim 상태, 이 profile/criterion을 정확히 덮는 승인된 policy가 없으면 자동 Acceptance 없음, Integration 별개 |

측정 시트(§9): Interaction(user messages, system questions, consequential Gates, approval-theater questions, user corrections, downstream action을 바꾼 corrections), Attention(기본 표시 transcript 줄 수, 압축된 tool action, 요청된 drill-down, 중복 정보), Recovery(Goal / latest accepted Choice / important uncertainty / next valid action 답 시간, raw transcript fallback 횟수·시간), Outcome(결함 수정, Review 중 새 결함, 미해결 obligation 표시, workload·agency 평점, 재사용 의향).

통과 기준(§10, 9개): 실행 전 consequential architecture Gate 1개 이하(새 Evidence가 정당화하지 않으면), approval-theater 질문 0, 진짜 대안 2개 이상이 구분 증거나 사용자 Choice까지 살아남음, 직접 사용자 정정이 정본 상태와 downstream Agreement를 바꿈, unqualified Choice가 accepted active baseline으로 보이지 않음, Completion·Acceptance·Integration이 따로 관찰됨, 모든 실패 주입이 기대한 결과 class 반환, 사용자가 raw transcript 없이 재개 probe 4개에 답함, 알려진 migration 한계가 "complete"에 가려지지 않음.

### 4.2 Run 001 Codex Kernel Baseline (`codex-kernel-baseline-001.md`)

범위: 실제 결함을 조사하고 최소 Guided 전이 계약을 추출해 in-memory Kernel 후보로 구현, 시나리오와 실패 주입 실행. 시험하지 않은 것: 실제 대화 CLI/TUI, model/provider와 tool loop, SQLite와 crash recovery, 전체 importer, Codex MCP·Pi·OpenCode transport, 지연 human resumption. 따라서 의미 집행과 replay만 검증, attention cost·자연어 품질·터미널 사용성·cross-runtime 연속성은 미검증.

관찰된 결함(`.helm/events.jsonl:99`): type `normative.decision.committed`, summary `ㅇ`, rationale `ㅁㄴㅇ`, reopenTrigger `ㅁㄴㅇ`. experimental.v0는 (1) 필수 필드가 비지 않은 문자열인지만 검증 (2) 입력을 즉시 `committed`로 기록 (3) subject별 마지막 Decision 선택 (4) Decision Event가 없을 때만 blind spot 보고. 결론: 구조적 유효성을 qualification·acceptance로 오인.

가능성 판정:

| Possibility | 결과 |
|---|---|
| language-quality heuristic | 언어·맥락 때문에 비결정적이라 baseline 규칙으로 기각. diagnostic 후보로만 유지 |
| required structured fields | 실제 garbage 이벤트와 합성 fixture로 반증 |
| qualification + accountable acceptance | 빠진 의미 전이를 직접 모델링하므로 선택 |
| human-selected active pin | 가장 강한 대안으로 유지. 반복 선택 부담과 stale pin |

추출한 최소 전이: `legacy.choice.capture`, `choice.open`, `choice.qualify`, `choice.commit`, `agreement.offer`, `agreement.accept`, `agreement.renegotiate`, `completion.submit`, `result.accept`, `integration.start`, `integration.complete`. `choice.qualify`는 이 run에서 발견한 정제다. "`choice.open → choice.commit`만으로는 구조적으로 capture된 후보와 source, scope, evidence relation, accountable acceptor, review trigger가 갖춰진 후보의 차이를 표현할 수 없다."

세계 분류: Choice open·qualification·commit과 Work Agreement 전이는 Normative, Completion 제출은 달성 기준에 대한 Epistemic Claim, 테스트 출력과 artifact는 Evidence 참조이지 자동 Acceptance가 아님, Actor와 Policy는 모든 Command/Event에 걸친 governance 데이터.

Legacy disposition(원문):

```text
source path        .helm/events.jsonl
source line        99
source event ID    evt_b99d405d692b48b9b3ee0978d3844d0a
source hash        sha256:be427c697341c5feffed0884e0d818eb35fafb6bfaef9b4884535ce9a0b5d278
ambiguity          legacy `committed` cannot prove v0.2 qualification or acceptance
disposition        captured / structural / unqualified / proposed
```

import 직후 Brief: latest accepted Choice `none`, blind spots `active_choice, choice_qualification`, attention `choice.unqualified`. `ㅇ`은 history에서 볼 수 있지만 active baseline이 될 수 없다.

실패 주입 결과:

| ID | 결과 | 정본 효과 |
|---|---|---|
| F1 | attention signal과 함께 capture | active baseline 없음 |
| F2 | `denied.projection_is_derived` | Event 없음 |
| F3 | `denied.adapter_cannot_append_event` | Event 없음 |
| F4 | 둘째는 `conflict.expected_cursor_mismatch` + rebase Brief | 첫 전이만 |
| F5 | 이전 revision `stale`, 옛 기준으로 completion 불가 | 새 revision이 작업 통제 |
| F6 | `submitted` 유지, agent acceptance 시도는 human Gate | 자동 Acceptance·Integration 없음 |

추가 확인: 호출자 범위 idempotent retry가 중복 Event를 만들지 않음, Guided Choice commit은 qualification 뒤 human authority 필요, 불변 Event replay가 같은 Workspace·Brief projection 재현, `projection.`으로 시작하는 생성 Event 없음. **9 passed, 0 failed.**

대본 시뮬레이션이 만든 Event 10개(순서대로): `migration.legacy_choice.captured`, `normative.choice.opened`, `normative.choice.qualified`, `normative.choice.committed`, `normative.agreement.offered`, `normative.agreement.accepted`, `epistemic.completion.submitted`, `normative.result.accepted`, `normative.integration.started`, `normative.integration.completed`. 정당한 Gate 2개(architecture Choice commit 전, Completion Claim의 Result Acceptance). 작업 전 Gate는 하나. "may I continue?" 반복 질문 없음. 최종 상태: active Choice = qualification + accountable acceptance, legacy Choice = unqualified history, Completion Claim은 시뮬레이션 reviewer가 수락, Integration complete, importer는 명시적으로 이전된 obligation. 이 Acceptance는 fixture 안에서만 존재하며 실제 product-owner 검토가 필요하다.

측정: 대본 참여자 메시지 3(초기 과제, architecture Choice, 조건부 Result Acceptance), 실행 전 consequential Gate 1, 실행 후 Result Review Gate 1, approval-theater 질문 0, F5 정정이 downstream을 바꿈(stale Completion Claim 거부). 터미널 줄 수, 압축 tool action, 중복 정보, Goal 복귀, raw fallback, workload/agency/재사용은 미측정.

미충족: 실제 JSONL migration과 loss report, durable single-writer와 crash 일관성, Observation Candidate 계약(이후 run에서 추가), Goal·Concern·Possibility·Claim·Evidence·resumption, 자체 model/tool/session loop, live CLI 측정, 독립 runtime adapter 두 개로 이식.

### 4.3 Adapter Contract Baseline 001

질문: 하나의 후보 Kernel 계약을 서로 다른 전송 모양 두 개로 운반해도 semantic identity, Event 순서, policy 결과, projection이 바뀌지 않는가.

전송 모양: Direct object adapter(in-process 요청/응답, first-party Runtime이나 embedded SDK의 최소 접점, Event append 경로 접근 불가, Brief/Workspace를 protocol method로 조회)와 JSONL RPC adapter(요청·응답을 JSON 한 줄로 직렬화 후 다시 파싱, Pi RPC 등 stdio host와 관련 있지만 동일하지 않음, lifecycle observation은 advisory로 보고).

Protocol surface(문서 시점 4개, 이후 `helm.observation.submit` 추가로 5개): `helm.handshake`, `helm.command.submit`, `helm.query.brief`, `helm.query.workspace`. Handshake가 반환하는 host 강제 불변조건 4개: `adapter-cannot-append-events`, `projection-is-derived`, `expected-cursor-required`, `guided-human-gates`.

Capability를 semantic 정확성과 독립적으로 보고:

```text
A tool/query
B lifecycle observation
C directed runtime
D native co-agency

support = enforced | advisory | unavailable
```

Parity fixture: 두 전송 모두 Observation 후 `choice.open` → `choice.qualify` → 책임 있는 human의 `choice.commit`. 결과 sequence 1 `epistemic.observation.captured`, 2 `normative.choice.opened`, 3 `normative.choice.qualified`, 4 `normative.choice.committed`. 정규화 후 Workspace projection이 source cursor, active Choice와 품질 상태, captured Choice history, attention, blind spots에서 깊이 같음. Event 순서·타입·effective time·actor·authority·subject refs·domain payload 동일. Observation provenance는 adapter ID가 의도적으로 다름("source identity is not erased to manufacture byte equality").

경계 검사(두 adapter 모두): 위조 `helm.event.v0.2-candidate` envelope는 `denied.adapter_cannot_append_event`, 거부 뒤 cursor 4 유지, adapter는 Query로만 상태 접근, policy는 Kernel host 안, 같은 Guided human Gate 동작.

실행 가능 스키마: Draft 2020-12 JSON Schema 후보(Command envelope와 어휘, Observation Candidate, output-only Ledger Event와 어휘, Command Result 상태, runtime-neutral protocol request, adapter capability). Command/Event enum이 실행 상수와 같은지 테스트. Observation capture는 Epistemic Event를 만들지만 Claim·Choice·active baseline은 만들지 않음. `effectiveAt`은 외부 관찰 시각, Kernel `recordedAt`은 수신 순서. 중복 external observation은 idempotent, 같은 external ID에 다른 내용은 conflict. **15 passed, 0 failed.**

증명한 것: transport framing은 정본 의미 밖, semantic parity가 runtime별 provenance를 지우지 않음, embedded client와 직렬화 RPC client가 한 protocol 공유, capability가 낮아져도 Kernel 불변조건은 완화되지 않음, runtime adapter에 Event append API가 필요 없음, projection parity를 fixture로 테스트 가능.

증명하지 못한 것: 실제 Pi RPC 호환, Codex MCP tool discovery와 human Gate UX, OpenCode plugin lifecycle 가로채기, reconnect·streaming subscription·cancellation·outbox, durable 프로세스 간 동시성, Level B–D lifecycle과 steering. "protocol precondition, not a cross-runtime acceptance result."

다음: typed client(first-party Runtime이 raw Event·protocol envelope를 만들지 않게), 자동 normative 승격 없는 lifecycle 입력 정의, durable storage 위 subscription/reconnect/cursor resume fixture, 실제 Codex MCP tool surface, Pi 설치·RPC 계약 확인 뒤 JSONL 바인딩, Foundation 승격 전 실제 runtime adapter 두 개 이상에서 같은 fixture.

### 4.4 Helm CLI Linear Experience 001

typed client, direct adapter, protocol host, Kernel을 쓰는 first-party CLI 경험 harness가 CLI-G01 전체를 선형 터미널 transcript로 렌더링했다. 순서: Orientation → Observation and Working Frame → Possibilities → consequential Choice Gate → impact echo → Work Agreement → compressed Working update → Completion Claim → Result Review Gate → Integration. 참여자 답은 대본, 언어 모델 없음(정보 구조·정책 시점·상태 전이를 provider 변동성 이전에 분리). 실행: `npm run simulate:cli-guided-001`.

사용자에게 보인 transcript 블록 라벨 순서(원문): `Helm`, `Observed`, `Working frame`, `Possible`, `Choice · needs your judgment`, `You`, `Impact`, `Work Agreement`, `Working · qualification and active-baseline projection`, `Completion Claim`, `Result Review · needs your judgment`, `You`, `Integration · complete with transferred obligation`. 전문은 원문 §2와 `src/experience.mjs`에 있다. Work Agreement 블록의 Authority 줄: "original “properly fix it” request plus the accepted Choice; correction remains available"(문서판), "requested scope is a policy-checked subset of the initial human Grant; correction remains available"(코드판).

상태·정책 증거: Agent client는 Choice를 열고 qualify할 수 있으나 `commitChoice` 메서드가 없음. Human client는 commit할 수 있으나 후보 열기 메서드가 없음. 두 client 모두 raw Event append나 generic Command 생성 없음. Kernel이 여전히 authority를 검사하므로 client 분리는 사용성 방어이고 신뢰 경계는 Kernel. 결함 조사와 테스트 결과는 Observation Candidate로 들어감. Observation은 active Choice를 만들지 않음. Completion은 별도 human Result Review 전까지 submitted. importer는 Integration 뒤에도 이전된 obligation으로 보임. 후보 suite **57 passed, 0 failed**, 기존 experimental suite **12 passed, 0 failed**.

상호작용 측정: 대본 메시지 3, 작업 전 consequential Gate 1, 작업 후 Result Review Gate 1, 작업 중 승인 질문 0, Work Agreement 확인 prompt 0, 보인 정정 경로(revise, inspect, defer, conditional acceptance), routine tool 출력은 Working 블록 하나, 보인 정본 용어(Choice, Work Agreement, Completion Claim, Integration), 기본 표시 내부 envelope/Event 세부 없음.

UX 강점 7개: (1) setup 질문지 대신 결함과 의도한 결과로 시작 (2) 실제 가능성 4개가 Gate까지 살아남음 (3) Gate가 결과, 불확실성, 가장 강한 대안을 설명 (4) 선택이 migration, projection, 상호작용 정책을 보이게 바꿈 (5) consequential 판단 뒤 반복 계속 질문 없이 진행 (6) 테스트 성공을 Completion Claim의 증거로 명시 (7) 조건부 Acceptance와 obligation 이전으로 거짓 "모두 완료" 방지.

Owner 검토가 필요한 UX 위험:
- R1 Work Agreement authority carry-forward: 첫 "properly fix it" 요청을 구조화된 Human Authority Grant로 capture하고 Agreement 요청 권한이 부분집합임을 증명해 추가 메시지 없이 수락. 표면 echo가 충분히 보이고 통제 가능하게 느껴지는지 product-owner 검토 필요.
- R2 정보 밀도: Guided가 domain 라벨 여러 개와 긴 Choice 블록을 노출. `qualification`, `baseline`, `provenance`를 쉬운 표면어로 바꿀지, 가능성은 추천과 가장 강한 대안만 먼저 보이고 나머지는 drill-down으로 할지, 시작 frame과 같으면 Work Agreement의 allowed/not-allowed를 접을지 dogfood로 정해야 함.
- R3 대본의 유창함: transcript는 배치와 정책 순서만 증명. 모델이 같은 구분을 안정적으로 추출하는지는 provider-driven run에서 잘못된 tool call, 이른 완료, 빠진 대안, 정정 처리로 시험해야 함.
- R4 터미널 동작: 키보드 선택, streaming redraw, 좁은 viewport, 색 없는 접근성, interruption, resume 미시험.

Product-owner 검토 질문 3개(답 기록 없음):
1. 작업 전 architecture Choice Gate 하나와 작업 후 Result Review 하나가 이 경우 Guided 부담으로 적당하게 느껴지는가?
2. 원래 지시를 두 번째 확인 없이 비확장 Work Agreement로 이어 가도 되는가?
3. 어떤 라벨이 유용한 정밀함이고 어떤 라벨이 기본으로 숨겨야 할 내부 용어인가?

"These answers should modify the experience contract before a model provider or full TUI makes the interaction more expensive to change." [해석] 이 답을 받기 전에 다음 run(런타임, provider, SQLite)으로 넘어갔다. 감사 보고가 지적한 "구현 먼저" 패턴의 한 사례다(§10).

### 4.5 First-party Agent Runtime Baseline 001

경계:

```text
Model Provider → bounded provider turn → registered agent-only tools → typed Helm client
  → runtime-neutral adapter → Kernel policy and Event creation
Human CLI input → validated runtime Gate → Human typed client → Kernel policy and Event creation
```

provider는 Human client를 받지 않고 typed surface로 raw Command·Event를 만들 수 없다.

Provider turn 계약: (1) 권한 없는 assistant block 방출 (2) 등록된 tool call 요청 (3) yield 또는 runtime이 검증하는 Gate 하나 요청. tool call과 Gate·finish를 한 turn에 섞을 수 없다. runtime은 step 한도와 총 tool-call 한도를 적용하고 재사용된 tool-call ID를 거부한다.

Provider가 쓸 수 있는 block kind 4개와 표시 라벨: `message → Helm`, `possibility → Possible`, `explanation → Why`, `progress → Working`. provider는 `Observed`, `Choice`, `Work Agreement`, `Completion Claim`, `Result Review`, `Integration` 라벨을 붙일 수 없다. 이 surface는 Kernel projection이나 runtime policy 증거가 있어야 한다. "fluent model text"가 정본 상태를 흉내 내지 못하게 한다.

Agent tool surface: 노출 10개 `helm_get_brief`, `helm_get_workspace`, `helm_submit_observation`, `helm_open_choice`, `helm_qualify_choice`, `helm_offer_work_agreement`, `helm_activate_work_agreement`, `helm_submit_completion`, `helm_start_integration`, `helm_complete_integration`. 의도적으로 없음: `helm_commit_choice`, `helm_accept_work_agreement`, `helm_accept_result`, raw Event append, generic Command submit, projection write. `helm_commit_choice` 호출은 `runtime.unknown_tool`, Event 없음.

Gate 중개: provider는 Gate 후보를 요청할 수 있지만 runtime은 현재 projection이 eligible일 때만 연다. Choice Gate는 후보가 qualified이고 아직 proposed, Agreement Gate는 Work Agreement가 offered, Result Gate는 Completion Claim이 submitted. Gate는 현재 cursor에 묶이고, Human 수락은 그 cursor로 Human typed client를 쓴다. 렌더링 뒤 Event가 상태를 진행시키면 수락은 `runtime.stale_gate`. 성공 fixture: provider가 열고 qualify → `awaiting_user` → active Choice 없음 → Human client가 정확한 cursor의 Gate 수락 → committed Event의 Actor는 `human:founder`.

안전 fixture 7개(모두 pass): 없는 Human 도구 요청(거부, normative 효과 없음), Gate 렌더링 후 Event 진행(stale Gate 충돌), 터미널 escape/control byte(UI event 전 제거), `Observed` 라벨 지정(provider turn 실패, Observation 없음), read 도구 무한 반복(step 한도로 정지), provider 대기 중 취소(run cancelled), provider 대기 중 steering(provider 중단, steering이 다음 context로). **28 passed, 0 failed.**

Steering과 취소 의미: 실행 중 steering은 대기 중 provider call을 중단, 별도 `user / steering` context 항목을 덧붙이고 bounded loop를 다시 시작(assistant message로 합치지 않음). 취소는 대기 중 provider call을 중단하고 runtime cancellation event를 만든다. 모든 tool effect class에서의 취소는 미증명. read-only, local atomic, external reversible, irreversible를 구분해야 한다.

남은 공백: 실제 model provider·streaming decoder, runtime event의 durable session/outbox, context compiler의 token/생략 정책, 자연어 Authority Grant 추출·revocation·budget, capability별 tool 취소와 불확실 결과 복구, provider retry/backoff·usage budget·secret 경계, 대화형 터미널 Gate 입력, Goal/Concern/Possibility/Claim 도구 전체, 실제 외부 adapter.

결론: "The provider is not the Helm Agent Runtime." runtime이 소유하는 것: bounded execution, tool 등록과 effect metadata, context compilation, steering/cancellation, Gate 검증과 human 입력 라우팅, 안전한 렌더링, operational trace와 복구. Kernel은 authority와 semantic transition 경계. first-party 소유는 더 풍부한 UX와 interruption을 뜻할 뿐 Kernel 불변조건 우회를 뜻하지 않는다.

### 4.6 Authority Carry-forward Baseline 001

문제: linear CLI는 수락한 Choice에서 local Work Agreement로 넘어갈 때 두 번째 승인 질문을 피했다. "고쳐줘"를 무제한 계속 권한으로 보면 Foundation 위반: authority는 범위와 effect class를 가져야 하고, Work Agreement가 사용자 지시를 조용히 넓히면 안 되고, Agent가 Human acceptance를 만들 수 없고, advisory integration을 enforced sandbox로 보이면 안 된다. 그래서 묵시적 carry-forward를 명시적 A-plane 계약으로 바꿨다.

Authority Grant 필드: §1.14. CLI-G01 예: grantee `agent:helm-cli`, actions `repository.read, repository.local_write, test.run, docs.edit`, maximum effect `R1 reversible local mutation`, resources `local workspace`, expires `next day`, stop `guessed acceptance or non-replayable migration loss`, source `initial user request`. Agent typed client에는 `grantAuthority`가 없고 Human client만 Grant를 만든다.

Work Agreement 활성화 조건(모두 참일 때 `agreement.activate` 수락):

```text
same grantee
requested actions ⊆ granted actions
requested effect ≤ granted effect
every requested resource covered by a granted scope
every Grant stop condition retained
Grant not expired
```

성공 시 Agreement는 active이고 기록: acceptance mode `delegated-authority`, accepted by 원래 human grantor, activated by agent, authority basis 명시적 Grant 참조. "This is not a forged Human action."

Gate 조건 fixture: `remote.publish`(미허가), effect R2(Grant는 R1), `remote:production`(local 밖)을 요청한 Agreement → `status needs_gate`, `code gate.work_agreement_authority_required`, `missing actionClass:remote.publish, effectClass<=R1, resourceScope:remote:production`. 별도 fixture: Grant stop condition 누락 → Gate, 만료된 Grant → Gate, 다른 Actor는 Grant 사용 불가, 구조화된 authority 요청이 없는 Agreement는 carry-forward로 활성화 불가.

UX 결론(권장 Guided 규칙, 원문): "Do not ask again when the next Work Agreement is a proven subset of a visible, current Human instruction. Echo the resulting range and keep correction available. Ask when any dimension expands or cannot be proven." 기본 CLI는 "Authority Grant"라는 말을 보일 필요가 없다(§1.14의 "맡긴 범위" 예).

증거: authority fixture 5개(경계 내 Agreement가 두 번째 Human Command 없이 활성화, effect/resource/action 확대 시 Gate, stop condition 누락 시 Gate, 만료 Grant 시 Gate, Agent가 자기 Grant를 만들 수 없음). **33 passed, 0 failed.**

남은 한계: scope 포함은 작은 prefix 계약(성숙한 resource policy 언어 아님), revocation·budget 소비·lease 갱신·Grant 겹침 충돌 없음, Actor identity는 운영 수준 인증 아님, 자연어 지시 → 구조화 Grant 매핑은 모델 시험 안 됨, R1 "reversible"은 선언일 뿐 rollback 구현과 연결 안 됨, 가로채기가 없는 외부 runtime은 여전히 advisory.

Foundation 정제: carry-forward는 증명 의무로서만 유효하다(`RequestedAuthority(Agreement) ⊆ CurrentAuthorityGrant(Actor, WorkUnit)`). "Absence of evidence for expansion safety is not permission. It yields a Gate or a narrower Agreement draft."

### 4.7 Runtime Effects and Context Baseline 001

정제 이유: 흔한 runtime 지름길 두 개가 Foundation과 충돌한다. (1) 외부·원자적 동작이 아직 끝날 수 있는데 "cancelled"를 표시 (2) 모든 model call에 변경 가능한 transcript와 workspace state 전체를 보냄. (1)은 예측 가능성과 복구를 깨고, (2)는 raw activity를 context 원천으로 만들고 생략 정책을 숨기며 운영 데이터를 흘리고 runtime별 의미 표류를 만든다.

Tool capability 계약 — 모든 runtime tool이 선언:

```text
effectClass           R0 | R1 | R2 | R3 | R4
cancellation          immediate | cooperative | atomic | none
authorityEnforcement  kernel | runtime | advisory
```

| Tool class | Effect | Cancellation | Enforcement |
|---|---|---|---|
| Brief/Workspace Query | R0 | immediate | Kernel |
| Observation/Choice/Agreement/Completion Event transaction | R1 | atomic | Kernel |
| 가상의 external integration | R2+ | capability별 | host 가로채기가 없으면 보통 advisory |

metadata는 provider tool 정의와 runtime activity event에 보인다. UI가 "지금 중단", "현재 transaction 뒤 정지", "외부 결과를 아직 알 수 없음"을 구분할 수 있다.

Steering·취소 동작:
- Cooperative: steering이 현재 call을 abort, interrupted Tool Result 기록, 별도 user steering 항목 추가, Context 재컴파일, bounded loop 재개.
- Atomic: 취소는 deferred로 승인. transaction이 끝나고 결과가 기록된 뒤 다음 tool/provider 단계 전에 정지. "Helm does not claim that a half-transaction was cancelled."
- 취소 불가 또는 불확실한 외부 동작: 전송 후 응답을 잃으면 tool이 `runtime.tool_outcome_uncertain`을 반환, runtime은 `awaiting_recovery`로 들어가 tool-call ID, 외부 operation 참조, 필요한 recovery query, no-retry 상태를 보존. `confirmed_applied`나 `confirmed_not_applied` 같은 복구 증거만 runtime을 idle로 되돌린다(코드에는 `manual_review`도 허용). 맹목적 재시도로 인한 중복 외부 효과를 막는다.

Context Projection 계약 — provider는 raw `workspace`, `brief`, runtime `history`를 받지 않고 다음을 받는다: `helm.context-projection.v0.2-candidate`, workspace와 source cursor, profile과 context policy version, accepted active Choice, active Work Agreement, attention과 blind spots, open Gate, 최근 user directive와 steering, 최근 Tool Result, 예산 안의 authority·observation·completion·Choice·provider-note 절, included references, omission report, 문자/토큰 추정·redaction 수·truncation 수.

의미 우선순위:
1. accepted baseline, active work, attention, open Gate
2. 최근 user instruction/steering과 Tool Result
3. 현재 authority와 최근 출처 있는 observation
4. completion/integration history와 비활성 Choice
5. provider narration

routine narration은 user steering이나 증거가 있는 tool result보다 먼저 생략된다.

예산·개인정보: 같은 cursor·state·history·budget이면 결정적 컴파일, secret처럼 보이는 객체 key는 provider 전달 전 삭제, 긴 문자열·배열·깊은 객체·과다 key에 상한과 카운터, 선택 범주는 예산까지 추가, 생략된 범주마다 count와 reason 보고, 필수 의미 context가 들어가지 않으면 조용히 버리지 않고 fail-closed. 예산은 문자 수 + 근사 토큰. provider adapter가 토큰 추정을 다듬을 수 있지만 의미 우선순위를 바꾸거나 필수 범주를 조용히 생략할 수 없다.

증거: cooperative steering 중단, atomic 취소 지연, 불확실 외부 결과 복구, effect/cancellation/enforcement metadata 노출, provider가 raw workspace/transcript를 받지 않음, 결정적 cursor-bound 컴파일, secret 삭제와 payload 상한, steering/tool result보다 narration 먼저 생략, 필수 context 초과 시 fail-closed. **41 passed, 0 failed.**

남은 한계: 문자 기반 토큰 근사, key 기반 redaction(DLP 아님), evidence disclosure label과 provider별 privacy policy 없음, Context Projection은 in-memory(durable cache/checkpoint 없음), tool 복구 증거는 runtime 운영 상태이며 정본 Exception/Observation Event와 연결 안 됨, atomic·외부 tool 중 프로세스 crash에는 durable intent/outcome journal 필요, streaming과 부분 tool-call 디코딩 미시험.

공학 결론: "Provider context and terminal transcript are consumers of semantic state, not alternative state stores." runtime state, Kernel state, tool effect state, UI rendering은 ID와 cursor로 연결된 별개 상태 기계여야 한다.

### 4.8 OpenAI Responses Provider Contract 001

범위: 자체 Runtime에 교체 가능한 provider adapter 하나. OpenAI 개념을 Kernel Command, Event, Projection, Authority, adapter protocol에 넣지 않는다.

```text
OpenAI Responses JSON ↕ provider adapter only ↕ helm.provider-turn.v0.2-candidate
↕ First-party Agent Runtime ↕ typed Helm tools ↕ Portable Kernel
```

실제 API 요청 없음. 주입한 mock transport, 명시적 test model, 운영용이 아닌 key placeholder.

Request policy(원문): `store false`, `truncation disabled`, `parallel_tool_calls false`, `max_output_tokens` 명시, `model` 명시(숨은 기본값 없음), `tools` 현재 Helm runtime function tool만, `tool_choice auto`, `text.format` 비-tool Provider Turn용 strict JSON Schema, `input` 상한 있는 `HELM_CONTEXT_JSON`. Helm runtime step/tool 한도가 우선한다.

Function tool mapping: 닫힌 입력 JSON Schema, provider에게 보이는 effect/cancellation/enforcement 설명, first-party Helm 도구는 `strict: true`, Human acceptance 함수 없음, raw Event·generic Command 함수 없음. runtime이 인자를 다시 검증한다(provider schema 강제는 심층 방어일 뿐 신뢰 경계 아님). 동적 Kernel 데이터는 provider 경계 전에 정규화(예: Completion criteria는 제한 없는 object map이 아니라 `{criterion, status}` 배열).

Output mapping: `type: function_call` 항목은 `call_id → runtime tool-call ID`, `name → 등록된 Helm tool 이름`, `arguments → 파싱된 객체`. 잘못된 JSON 인자는 fail-closed. function call과 사용자 표시 메시지가 함께 오면 거부(turn 계약이 효과와 표시를 섞지 못하게 함). 메시지 `output_text`는 strict Provider Turn schema로 디코딩: `blocks`(message | possibility | explanation | progress), `gate`(choice | agreement | result | null), `finish`(yield | null).

전체 mock 런타임 fixture: mock 서버가 `helm_open_choice` call, `helm_qualify_choice` call, 구조화된 Choice Gate를 순서대로 반환. runtime은 Context cursor 0, 1, 2를 보냈고, 정확히 후보 Event 2개를 만들었고, 어떤 요청에도 Human acceptance 도구를 노출하지 않았고, active Choice 없이 `awaiting_user`에서 멈췄고, 별도 Human client가 cursor에 묶인 Gate를 해결할 때만 Choice를 commit했다.

보안·실패 동작: API key는 private field에 두고 Authorization header로만 전송, 요청 body·Event·Context Projection·오류 세부에 key 없음, HTTP 오류는 status만(원격 응답 body는 기본 노출 안 함), 미완료 응답은 incomplete reason을 보존하고 turn을 지어내지 않음, transport 취소는 runtime AbortSignal, usage는 정본이 아니라 operational callback으로, invalid·empty·mixed·incomplete 출력은 fail-closed.

증거: provider fixture 7개(무상태 요청 mapping, strict 구조화 메시지 mapping, invalid 함수 인자 거부, mixed 출력 거부, credential 안전한 HTTP/incomplete 오류, 명시적 model/key 요구, 전체 mock Responses → Runtime → Kernel → Human Gate). **48 passed, 0 failed.**

남은 한계: 실제 계정·키·모델 호출 없음, streaming 출력이나 부분 함수 인자 디코더 없음, 실제 지연·비용·rate-limit·retry·모델 품질 측정 없음, provider별 토큰 카운터 없음, safety identifier/prompt cache 정책 미결, 암호화 reasoning/context carryover 없음, multi-provider fallback 정책 없음, CLI 설정에서 모델/provider 선택 없음. "A successful mock contract is not evidence that a real model follows the Foundation reliably."

브리프와의 관계: 브리프 결정 27은 모델 계층을 pi-ai 기반 얇은 인터페이스로 정했다. 이 run의 request policy와 output 검증 규칙(mixed 거부, strict schema, 키 비노출, usage는 운영 데이터)은 pi-ai 위 provider 계층에도 적용할 수 있는 요구다.

### 4.9 SQLite Transaction Baseline 001

순수 후보 Kernel을 일회용 SQLite 서비스 뒤에서 재수화했다. domain 전이나 Projection 규칙을 DB로 옮기지 않았다. 추가한 운영 보장: WAL 기반 local 저장과 foreign key, durable 호출자 범위 Command inbox, durable adapter 범위 Observation inbox, append-only Event와 transactional notification outbox, Kernel 평가·Event append·outbox append·inbox 결과를 감싸는 `BEGIN IMMEDIATE` 하나, close/reopen 뒤 replay, workspace별 SHA-256 checksum chain(우발 손상 진단). 같은 runtime-neutral protocol host와 direct adapter가 이 서비스 위에서 돈다. 저장소 전용 연산이 adapter 계약에 들어가지 않는다.

실패·복구 fixture 9개(모두 pass): (1) Event와 파생 Projection이 close/reopen 후 유지 (2) 같은 Command 재시도는 durable 결과 반환, Event 추가 없음 (3) 같은 cursor에서 시작한 두 connection은 하나 수락, 하나 명시적 rebase conflict (4) Event/outbox 삽입 뒤 Command-inbox 삽입 전 fault는 셋 모두 rollback (5) 저장된 Event body를 수정하면 조용히 새 history가 되지 않고 checksum-chain replay 실패 (6) Observation capture는 idempotent이고 normative 상태로 승격 불가 (7) 다른 workspace 요청은 두 inbox를 건드리기 전에 거부 (8) outbox 소비는 Event sequence로 재개, 전달 표시는 idempotent (9) in-memory를 SQLite로 바꿔도 transport-neutral protocol 동작 동일. **57 passed, 0 failed.**

Foundation 결론 4개: 불변 기록은 참인 내용과 다르므로 저장 무결성과 의미 qualification은 별개 검사, durable해져도 Event 작성자는 Kernel 하나, local-first도 동시성·idempotency·복구 의미가 필요, 이식성은 DB별 adapter가 아니라 의미 protocol 경계에 있다. checksum chain은 저장된 checksum이 그대로일 때 우발 변경을 탐지할 뿐 서명·MAC이 아니고, Event와 checksum을 모두 다시 쓸 수 있는 프로세스는 이미 local DB 신뢰 경계 안이다.

남은 한계: 동기 embedded SQLite이며 계획한 single-writer `helmd` 아님, crash는 transaction 안 fault injection이며 OS 프로세스 종료·파일시스템 fault 미시험, Agent Runtime history·steering·open Gate·tool intent/outcome·불확실 외부 복구는 여전히 in-memory, projection checkpoint·projector lag/degraded mode·subscription worker·reconnect delivery 없음, backup/restore·evidence manifest·key rotation·장기 schema migration 미시험, 손상 저장소는 fail-closed 진단만 하고 사용자용 read-only recovery mode 없음, live model·실제 외부 runtime 미참여.

공학 결정: 결정적 Kernel은 순수하게 유지. transaction 조율, idempotent inbox, outbox 전달, migration, 복구 진단은 application/storage 경계에. first-party CLI와 모든 외부 runtime adapter는 같은 typed protocol로 상태에 접근하고 특권 SQLite·raw-Event 경로를 받지 않는다.

### 4.10 run 진행 순서와 테스트 수 [해석: 정리]

| 순서 | run | 누적 tests |
|---|---|---:|
| 1 | Codex Kernel Baseline 001 | 9 |
| 2 | Adapter Contract Baseline 001 | 15 |
| 3 | First-party Agent Runtime Baseline 001 | 28 |
| 4 | Authority Carry-forward Baseline 001 | 33 |
| 5 | Runtime Effects and Context Baseline 001 | 41 |
| 6 | OpenAI Responses Provider Contract 001 | 48 |
| 7 | SQLite Transaction Baseline 001 | 57 |
| (렌더링) | Helm CLI Linear Experience 001 | 57 시점 문서 |

모든 run이 하루(2026-08-22)에 이뤄졌다. product-owner 검토 질문(§4.4)에 대한 답, live model, 지연 재개 결과는 기록에 없다.

---

## 5. paper-v0 프로토타입 (`docs/prototypes/paper-v0/`)

### 5.1 범위와 운영 (README)

지위: "test artifact, not a product specification". 목표: Foundations의 핵심 상호작용이 실제 사용자의 상황 인식·판단·결과 품질을 개선하는지 코드 구현 전에 검증.

검증하는 primitive 4개와 Foundation 추적:

| Primitive | 목적 | 주요 Foundation |
|---|---|---|
| Return Brief | 시간 간격 이후 상황과 판단권 복원 | A9, A11, A12; ContextProjection; Situation Awareness |
| Inquiry Map | 문제 프레임, 경쟁 가설, 증거, 다음 실험 관리 | A3, A4, A5, A14; Epistemology |
| Delegation Contract | 목적·권한·완료 기준을 포함한 작업 이관 | A1, A6, A7, A8; Praxeology & Governance |
| Decision Gate | 중요한 선택에 대한 근거 있는 사용자 개입 | A6, A8, A13, A15; Interaction Constitution |

검증하지 않는 것: 완전한 Event Store, 실제 에이전트 권한 차단, 다중 사용자 실시간 동기화, 자동 Context compiler 정확도, SaaS 권한·결제·조직, 최종 시각 디자인.

paper prototype을 쓰는 이유: Foundations가 틀렸다면 안정 schema·런타임을 먼저 구현할수록 피벗 비용이 커진다. 사람이 뒤에서 상태를 구조화하는 Wizard-of-Oz로 질문 6개를 검증: 사용자가 구조를 이해하는가, 어떤 필드가 판단에 쓰이고 어떤 필드가 장식인가, Gate가 결과를 바꾸는가 승인 마찰만 만드는가, Return Brief가 원본 로그 재독을 대체하는가, 경쟁 가설이 조기 수렴을 줄이는가, Contract가 방향 이탈을 줄이면서 작성 부담을 감당할 수 있는가.

운영 순서 8단계: (1) Facilitator가 실제 프로젝트 Event와 자료 관찰 (2) Return Brief와 Inquiry Map 수동 작성 (3) 사용자가 문제 프레임과 기준 수정 (4) 합의 내용을 Delegation Contract로 변환 (5) 기존 도구에서 에이전트 작업 실행 (6) 중요한 이견·권한 초과·비가역 선택에만 Decision Gate 생성 (7) 에이전트 완료 주장을 증거와 함께 수락·반려 (8) 행동·시간·오류·주관 경험 기록. Facilitator는 에이전트 결과를 좋게 보이게 편집하지 않고, 원본 Evidence·Counterevidence를 보존하고, 조건마다 같은 수준의 도움을 준다.

최소 상호작용 문법(10 행위):

| 행위 | 의미 |
|---|---|
| Inspect | 근거와 원본 Event 확인 |
| Reframe | 문제 정의나 Purpose 연결 수정 |
| Challenge | Claim, Evidence 관계, Recommendation에 이의 |
| Compare | 대안과 가설의 차이를 같은 기준으로 검토 |
| Delegate | 조건과 권한을 포함한 Commitment 생성 |
| Decide | Normative baseline 변경 |
| Defer | 더 좋은 시점이나 Evidence까지 결정 연기 |
| Experiment | 결정 전 불확실성을 줄이는 WorkUnit 생성 |
| Accept | 조건부 또는 최종 수락 |
| Reopen | 무효화 조건 때문에 과거 결정 재검토 |

성공 최소 조건(5개, 동시에 관찰되어야 다음 단계로): Return Brief가 원본 로그 없이 핵심 상황 복원, 사용자가 Inquiry Map에서 프레임·가설·증거 관계를 적어도 하나 의미 있게 수정, Decision Gate가 승인 클릭이 아니라 기준·선택·후속 Commitment 중 하나를 바꿈, Delegation Contract가 실제 방향 이탈이나 완료 기준 혼동을 예방, 총 부담이 늘어도 결과 품질·주도성 증가가 정당화.

### 5.2 템플릿 필드 전부

#### 5.2.1 Inquiry Map (탐구 지도)

목적: 그럴듯한 해법 하나로 조기 수렴하지 않고 문제 프레임, 경쟁 가설, 증거, 구분 실험을 함께 관리.

- Metadata: Inquiry ID, Concern, Purpose, Inquiry owner, Opened at, Current phase(`sensing | framing | diverging | investigating | deliberating | closed`), Decision deadline / stop rule
- §1 Situation
  - Observations 표(해석하지 않은 관찰과 출처): Observation | Source | Scope / freshness | Reliability note
  - Tension: 현재 상태, 원하는 상태, 두 상태 사이의 긴장, 해결할 가치가 있는 이유
- §2 Competing problem frames 표: Frame(F1, F2…) | What it treats as the problem | What it foregrounds | What it hides | Owner / advocate
  - Active frame: Current frame, Why provisionally selected, Reframe trigger
- §3 Hypothesis set 표: Hypothesis(H1…) | Explanation / prediction | Supporting evidence | Counterevidence | Falsifier | Status. Status 값: `open | strengthened | weakened | rejected | undecidable | superseded`
- §4 Assumptions and unknowns 표: Assumption / unknown | Why needed | Failure impact | How to test | Review trigger
- §5 Discriminating experiments 표(가설 간 차이를 드러내는 실험 우선): Experiment | Distinguishes | Expected information value | Cost | Reversibility | Owner
- §6 Evidence ledger 표: Evidence | Type(observation/inference/test) | Supports | Challenges | Independence | Quality | Source
- §7 Current synthesis: Best-supported explanation, Strongest alternative, Most important counterevidence, What remains unknowable within budget, What would change the recommendation, Is the original frame still useful?
- §8 Next epistemic action: `investigate | experiment | deliberate | decide | reframe | stop`, Action, Why this action has the highest information or decision value, Stop condition
- Facilitator check(5): 최소 두 개의 합리적 Frame 또는 대안 부재 이유가 있는가, Hypothesis가 설명뿐 아니라 반증 조건을 가지는가, 증거의 수가 아니라 독립성과 구분력을 보았는가, 에이전트 합의를 독립 증거로 중복 계산하지 않았는가, 탐구를 멈추고 행동할 조건이 명시되었는가

#### 5.2.2 Decision Gate (결정 게이트)

목적: 사용자의 주의력을 결과를 실질적으로 바꾸는 가치·방향·위험 판단에 집중.

- Metadata: Gate ID, Concern, Decision owner, Created by, Created at, Decision window, Last cheap point to change direction, Gate reason(`value-conflict | high-uncertainty | irreversible | authority-boundary | disagreement | acceptance | integration`)
- §1 Decision question: 한 문장으로 답할 수 있는 결정 질문
- §2 Why now: Triggering event, What is blocked or at risk, Cost of deciding now, Cost of delaying, What proceeds automatically if no decision is made
- §3 Purpose and criteria: Related Purpose, Non-negotiable constraints, 표 Criterion | Importance | Evidence quality | Notes
- §4 Options 표(현상 유지와 추가 실험을 옵션으로 검토): Option(A, B, Defer / experiment) | Expected benefit | Cost / risk | Reversibility | System impact | Confidence basis
- §5 Evidence and disagreement: Strongest evidence, Strongest counterevidence, Unresolved assumptions, Agent / stakeholder disagreement(Position, Basis, What would resolve it)
- §6 Recommendation: Recommended option, Why it best fits the criteria, Why the strongest alternative was not selected, What new evidence would change the recommendation, Confidence basis, not just score
- §7 User actions(7): Choose an option, Modify criteria or constraints, Reframe the question, Request a discriminating experiment, Delegate within a bounded envelope, Defer until a specified trigger, Reject all options
- §8 Commitment created by decision: Selected option, Decided by, Rationale, Consequences accepted, New/changed Commitments, Baselines changed, Communication / handoff obligations, Review date or reopen trigger
- §9 Decision impact feedback(결정 이후): What changed because of this decision, Expected vs observed result, Was user intervention consequential?(`yes | partial | no`), What the system should learn about future Gates
- Facilitator check(6): 실제 결과가 다른 선택지가 존재하는가, 사용자의 권한과 전문성이 필요한 문제인가, 추천과 반대 증거가 함께 보이는가, 결정 대신 실험하거나 연기할 수 있는가, 선택이 후속 Commitment와 기준선 변경으로 이어지는가, Gate가 없었다면 어떤 일이 일어났는지 기록했는가

#### 5.2.3 Delegation Contract (위임 계약)

목적: 자연어 요청을 목적·권한·증거·에스컬레이션이 명확한 운영적 약속으로 전환.

- Identity: Contract ID, WorkUnit ID, Concern, Requester, Performer, Acceptor, Integration owner, Status(`proposed | negotiating | delegated | active | claiming-complete | accepted | integrating | closed`)
- §1 Intent: Purpose, Desired outcome, Why this performer, Why now, Non-goals
- §2 Conditions of satisfaction 표: Criterion(C1…) | Evidence required | Verification method | Acceptance authority. 완료 선언과 수락을 분리. 모든 Criterion이 충족되지 않아도 조건부 수락 가능하나 미충족 항목 명시
- §3 Scope: Included, Excluded, Dependencies, Protected baselines(변경하면 안 되는 Purpose, Decision, Constraint, Artifact)
- §4 Authority envelope 표(Dimension | Grant / limit): Read scope, Write scope, Allowed actions, Forbidden actions, External side effects, Resource / cost limit, Time boundary, Reversibility requirement
- §5 Epistemic obligations: 확인해야 할 Assumption, 비교해야 할 대안, 보존해야 할 Counterevidence, 모른다고 보고해야 할 범위, 완료 시 제출할 Evidence
- §6 Coordination obligations: Dependent WorkUnits, Shared Artifacts / Decisions, Expected observable progress, Next checkpoint, Handoff recipient and format
- §7 Escalation triggers(기본 8개 + 작업별 추가): Authority Envelope 밖 행동 필요, Purpose 또는 AcceptanceCriterion의 모순 발견, Protected baseline 변경 필요, 비가역 외부 효과 발생 가능, 중요 Evidence가 기존 Decision 무효화, 다른 WorkUnit과 의미 충돌, 예상 비용/시간/위험 임계 초과, 수행자가 완료 조건을 해석할 수 없음
- §8 Negotiation log 표: Event | Actor | Proposed change | Reason | Resolution
- §9 Completion claim: Claimed outcome, Criteria satisfied, Criteria not satisfied, Evidence, Known limitations, Unexpected consequences, Remaining uncertainty, Invalidation triggers
- §10 Acceptance and integration: Acceptance(`accepted | conditionally-accepted | correction-required | rejected`), Accepted by, Rationale, Remaining obligations, Integration target, Integration status, Reopen trigger
- Facilitator check(5): Request와 Commitment를 구분했는가, 수행자가 조건과 권한에 동의·반대할 기회가 있었는가, 완료 기준이 산출물 목록이 아니라 검증 가능한 Outcome인가, 에이전트 도구 능력보다 권한 범위가 넓지 않은가, 완료 주장·수락·통합이 분리되었는가

#### 5.2.4 Return Brief (복귀 요약)

목적: 사용자가 원본 로그를 처음부터 읽지 않고 현재 상황을 지각하고, 의미를 이해하고, 다음 상태를 예상하도록 돕는다(SA 3단계 대응).

- Metadata: Brief ID, Workspace, Actor / audience, Concern, Last acknowledged cursor, Current cursor, Covered period, Generated at, Generated by, Freshness / invalidation triggers
- §1 One-minute orientation
  - Current purpose: 우리가 이루려는 것, 현재 단계, 성공의 핵심 기준
  - Your attention: 지금 판단 필요, 판단이 필요한 마지막 저비용 시점, 지금 읽지 않아도 되는 것
  - Overall assessment: 상태(`on-course | attention-needed | at-risk | blocked`), 한 문장 이유
- §2 What changed
  - Normative changes 표(결정, 제약, 권한, 약속의 변화만): Change | Why it happened | Consequence | Source
  - Epistemic changes 표(강해지거나 약해진 가설, 새 증거, 반대 증거, 깨진 가정): Belief change | Evidence / counterevidence | Confidence basis | Source
  - Material changes 표(Artifact, 테스트, 배포, 외부 상태의 실제 변화): Artifact / state | Observed change | Verification | Source
- §3 What it means: 목표 달성 가능성 변화, 가장 중요한 새 위험, 더 이상 유효하지 않은 가정·계획, 서로 충돌하는 작업·판단, 아직 설명되지 않은 관찰
- §4 What happens next(개입하지 않을 경우 예상 경로) 표: Expected action | Actor | Authority basis | Expected outcome | Escalation condition
- §5 Decisions and commitments
  - Open gates 표: Gate | Why now | Decision owner | Due / last cheap point
  - Active commitments 표: Commitment | Performer | Status | Satisfaction condition | Risk
- §6 Recommended user action: Recommendation, Expected leverage, Alternative, Estimated attention cost
- §7 Provenance and omissions: Included Event range, Key source links, Intentionally omitted, Known summarization risk, Drill-down path
- Facilitator check(5): 사실·추론·결정이 구분되었는가, 중요한 Counterevidence와 이견이 보존되었는가, 사용자가 다음 상태를 예상할 수 있는가, 실질적인 사용자 행동이 하나 이하로 우선순위화되었는가, 모든 중요 변화가 원본으로 역추적 가능한가

템플릿 규모: 네 템플릿 합계 heading/field prompt 약 197개, 채운 예시 합계 4,319단어(dogfood 001 §1).

### 5.3 실험 프로토콜 (`experiment-protocol.md`, pilot protocol v0.1)

연구 질문:

| RQ | 이름 | 질문 |
|---|---|---|
| RQ1 | Situation recovery | 시간 간격 이후 목적·변화·위험·다음 상태를 얼마나 빠르고 정확하게 복원하는가 |
| RQ2 | Decision leverage | Helm이 요청한 개입이 실제 기준·방향·Commitment·결과를 바꾸는가 |
| RQ3 | Delegation quality | 목적·권한·증거 의무가 있는 Contract가 조용한 범위 이탈과 완료 혼동을 줄이는가 |
| RQ4 | Outcome quality | 경쟁 가설·증거 비교를 포함한 상호작용이 첫 그럴듯한 해법을 바로 실행하는 방식보다 목적 적합성·통합 품질을 높이는가 |
| RQ5 | Work experience | 더 큰 주도성·유능감·결과 소유감·흥미를 느끼면서 감당 가능한 workload를 유지하는가 |

연구 단계:

| Study | 참여자 | 목적 | 방식·판단 |
|---|---|---|---|
| 0 Founder dogfood | product owner 1명 | 용어, artifact 밀도, facilitator 작성 비용, 치명적 누락 | 실제 Concern 하나의 framing~integration. 구조 삭제·병합과 절차 보정. 시장 증거 아님 |
| 1 Formative usability | 에이전트 코딩 경험자 5–8명 | comprehension, interaction breakdown, Gate theater, Context flooding 발견 | think-aloud + 재개 과제 + 반구조화 인터뷰. 반복 실패 패턴과 임계 사건 |
| 2 Comparative pilot | 12명 이상 목표(효과 크기 추정 후 본 표본 결정) | 조건별 상황 인식·workload·품질의 방향과 분산 | counterbalanced within-subject 또는 matched-task crossover |
| 3 Longitudinal field trial | 병렬 agent WorkUnit 3개 이상을 운영하는 사용자·팀 | 자발적 재사용, context decay, 장기 의사결정, integration defect, 조직 기억 | 2–4주 |

조건: A Chat baseline(일반 agent chat과 로그, 평소 메모, 구조화 요약 없음), B Structured docs baseline(Docs-Agent OS의 state/references/feature current/decisions, Helm 객체 추가 없음), C Helm paper prototype(네 primitive, 같은 원본 실행과 자료). 조건마다 연구자 도움의 양을 기록하고 script와 source audit로 편향 통제.

과제 요건 8개: 최소 3 WorkUnit으로 분해 가능, 합리적 ProblemFrame/해결 가설 2개 이상, 숨은 Assumption 1개 이상, 에이전트 결과 간 의미 충돌 가능성, 자동 테스트만으로 판단할 수 없는 품질 기준, 가역 결정 하나와 고비용 결정 하나 이상, 시간 간격 후 복귀 단계, 마지막 전체 통합 판단. 예시 과제군 4개: 인증 방식 변경(호환성·보안·UX), 문서 중심 workflow를 event/projection 모델로 전환, 여러 에이전트가 API·UI·migration·test plan을 설계하고 통합, 성능 문제의 경쟁 원인 병렬 조사 후 수정 전략 선택. 조건 간 과제는 난이도·익숙함·자동 검증 가능성·도메인 지식을 사전 평정해 매칭.

세션 절차 6 Phase:
1. Orientation: 연구 목적과 수집 범위 설명, 도구 연습, agent 경험·도메인 친숙도 기록, 과제 목표·초기 자료 제공
2. Frame and delegate: 참여자가 문제 설명·첫 행동 선택, 조건별 도구 사용, 최대 3개 병렬 WorkUnit 시작, clarification·reframe·authority change·delegation 시간 기록
3. Autonomous interval: 사전 준비된 run 또는 실제 sandbox run, 모든 조건에 같은 Evidence와 failure injection, 일부 run에 의도적 모순·오래된 가정·부분 완료 포함
4. Resumption: 최소 24시간 간격(Study 1은 distractor task 후), 제공 자료만 보고 상황 설명, 첫 유효 행동까지 시간과 원본 로그 fallback 측정, project-specific SA probe
5. Decision and integration: 중요한 이견·방향 선택 제시, 결정·추가 실험·연기·재위임 중 선택, 결과 수락·반려와 통합 계획, escaped conflict와 남은 obligation 평가
6. Debrief: workload·경험 측정, critical incident interview, 무시한 정보와 다시 찾은 정보 확인, 결과를 바꾼 개입과 방해였던 개입 회고

상황 인식 측정(SAGAT 구조 차용, 완전한 SAGAT라고 주장하지 않음):
- Level 1 Perception: 현재 활성 WorkUnit, 새로 생긴 Evidence나 실패, 열린 Decision Gate
- Level 2 Comprehension: 가장 중요한 변화가 왜 중요한가, 영향받은 Assumption·Decision, 충돌하는 작업
- Level 3 Projection: 개입하지 않으면 다음에 일어날 행동, 방향 전환 비용이 크게 증가하는 시점, 가장 가능성 높은 다음 위험
- 점수: 사전 rubric으로 정답/부분/오답, 핵심 항목 위험 가중치, 응답 확신과 정확도로 calibration, 조건마다 질문 수·난이도 동일

행동 지표(이름 그대로):
- Resumption: `time_to_orientation`, `time_to_first_valid_action`, `raw_log_fallback_count`, `incorrect_state_assertions`, `missed_critical_change`
- Decision: `gate_response_time`, `decision_changed_outcome`, `criteria_modified`, `experiment_requested`, `false_escalation`, `missed_consequential_decision`
- Delegation: `clarification_rounds`, `late_scope_change`, `authority_violation`, `claim_rejected`, `acceptance_without_rework`
- Integration: `semantic_conflicts_detected_before_merge`, `unowned_obligations`, `stale_decisions_reused`, `post_acceptance_integration_failures`
- Attention: 총 사용자 활동 시간, artifact별 읽기·편집 시간, interruption 이후 복귀 시간, 중요 결정에 쓴 시간 비율, facilitator가 정보를 구조화한 시간

결과 품질 rubric(조건을 모르는 평가자 2명 이상): Purpose fit, Technical correctness, Evidence sufficiency, Alternative consideration, Integration coherence, Maintainability, Recovery readiness. 평가자 합의가 낮으면 평균 전에 rubric 모호성 수정.

Workload와 경험: NASA-TLX(mental demand, temporal demand, performance, effort, frustration 등). 보는 trade-off: mental demand가 늘었지만 frustration·rework가 줄었는가, effort 증가가 높은 agency·quality로 정당화되는가, 쉬운 순간 workload는 늘리고 어려운 순간 peak는 낮추는가. IMI(interest/enjoyment, perceived competence, perceived choice, pressure/tension)는 상업 사용 라이선스 확인 전 문항 복제 금지. 라이선스 전 탐색 질문 5개: 내 판단이 결과의 방향을 실제로 바꿨는가, 상황을 이해하고 통제할 수 있다고 느꼈는가, 같은 방식으로 다시 하고 싶은가, 개입이 의미 있는 일처럼 느껴졌는가 승인 노동처럼 느껴졌는가, 결과가 내가 공동으로 만든 것처럼 느껴지는가. Engagement는 후속 연구에서 UES-SF 등 검토.

Critical incident interview 8문항: 방향을 잃었다고 느낀 정확한 순간, 다시 찾느라 시간을 쓴 정보, 결과를 실제로 바꾼 Gate, 시스템이 묻지 말았어야 할 질문, 완료 주장을 믿거나 믿지 않은 이유, 없었다면 잘못 결정했을 Counterevidence·대안, 일한다고 느낀 시점과 시스템을 관리한다고 느낀 시점, 다음 세션에서 자발적으로 다시 쓸 artifact.

Facilitator 기록(artifact마다): 작성 시간, 원본 Event 수, 불명확해 추가 추론한 필드, 참여자가 읽지 않은 섹션, 참여자가 수정한 필드, 결정·행동을 바꾼 필드, 잘못 압축하거나 빠뜨린 정보, 자동 생성 가능해 보이는 부분, 사람 판단이 반드시 필요했던 부분. 이 데이터가 향후 Context compiler와 Gate classifier 범위를 정한다.

편향 통제: 조건 순서 counterbalance, task와 failure injection 사전 고정, 작성자가 원본에 없는 추천을 추가하지 않음, 평가자 blind, 추가 도움·facilitator 개입 모두 기록, 모델·도구 권한·실행 시간 예산을 조건 간 맞춤, founder dogfood를 시장 증거로 일반화하지 않음.

개인정보·윤리: secret·개인 식별 정보·제3자 데이터 제외, 기록되는 화면·음성·로그 고지와 동의, 원본 대화·코드의 SaaS 전송 여부 별도 고지, 연구 참여와 제품 사용 권한을 결합하지 않음, 언제든 삭제 요청 가능.

Pilot 판단 기준:
- Advance to read-only sidecar: Return Brief가 복귀 시간을 줄이고 핵심 위험 보존, 네 primitive 중 다수를 자발적으로 재사용, facilitator가 같은 Event를 반복 수동 추출, Gate 상당수가 기준·방향·후속 Commitment를 바꿈, 수동 작성 비용의 주원인이 데이터 수집
- Revise interaction model: 원본 로그를 항상 다시 읽음, Inquiry Map이 가설 수만 늘리고 결정을 개선하지 않음, Contract가 협상보다 형식적 작성 노동, Gate가 대부분 추천 승인으로 끝남, workload 증가가 품질·agency로 정당화되지 않음
- Reframe or stop: structured docs baseline과 반복적으로 차이 없음, 사용자가 공동 판단보다 완전 자동 결과를 일관되게 선호, 의미 객체 유지 비용이 integration/rework 감소보다 큼, facilitator 도움을 빼면 Helm 효과가 사라짐

첫 dogfood 범위(Concern "Helm의 첫 구현 투자를 어디에 할 것인가"): (1) 제공된 Return Brief를 owner가 수정 (2) Inquiry Map에 빠진 Frame/Hypothesis 추가 (3) Decision Gate 평가 기준 수정, 옵션 선택 또는 실험 요청 (4) 선택 결과를 Delegation Contract에 반영 (5) 24시간 뒤 Brief 없이 기억한 상태와 새 Brief로 복원한 상태 비교 (6) 쓰이지 않은 필드와 결정을 바꾼 필드 기록. 실제로는 (3)·(4)만 수행됐다(§6.1).

### 5.4 채운 예시 (`examples/helm-transition/`)

공통 Concern: `helm-product-transition`. Workspace `06_agent_docs_os`. 날짜 2026-08-16. 작성: Codex research/design agent.

#### 5.4.1 Inquiry Map 예시 — "Helm의 첫 제품 검증 단위는 무엇이어야 하는가"

Inquiry ID `inq-helm-transition-001`, phase `evaluating founder-dogfood-001`, stop rule "안정 domain schema 또는 runtime 구현 착수 전".

관찰 9개(요지): 현재 제품은 npm initializer + Markdown/YAML scaffold, 기존 architecture는 State–References–Features–Decisions 파일 계층, 사용자 핵심 문제는 다중·장기 에이전트 작업을 인간이 인지적으로 따라가기 어려움(단일 창업자 경험), 사용자는 개입 제거보다 결과 품질과 일의 경험을 높이는 개입을 원함(명시적 가치 진술), Foundations와 35개 방법론 전이 지도 작성됨, 네 primitive의 사용자 성과 데이터 없음, owner가 A → B 순서의 실제 수행·검증 요청, Git-only capture는 material change 56개를 포착했지만 Normative·Epistemic·Next-state는 unknown, human semantic input 7개로 네 domain을 채웠으나 자동 Brief는 파일 56행을 그대로 노출.

Tension: 현재(풍부한 이론과 파일 스캐폴드, 검증된 상호작용·제품 루프 없음) vs 원하는 상태(실제 다중 에이전트 작업에서 상황 인식·판단·통합 품질을 개선하는 최소 제품 루프). 긴장: 구현에 schema가 필요하지만 상호작용 검증 전에 고정하면 잘못된 ontology가 굳음.

경쟁 프레임 3개:

| Frame | 문제로 보는 것 | 드러내는 것 | 숨기는 것 | 옹호 |
|---|---|---|---|---|
| F1 Docs/Context Management | 에이전트가 필요한 문서를 일관되게 읽지 못함 | 설치 용이성, 문서 라우팅, 컨텍스트 지속성 | 인간 판단·병렬 작업·증거 비교 | 현재 v0 |
| F2 Agent Observability | 여러 run의 상태·로그를 한눈에 보기 어려움 | run tracking, timeline, dashboard | 무엇을 결정해야 하는지와 결과 정당성 | 흔한 시장 프레임 |
| F3 Steered Co-agency | 인간–에이전트 공동 시스템이 목적·지식·약속을 정렬하지 못함 | inquiry, authority, evidence, meaningful intervention, integration | 초기 구현 단순성과 즉각적 demo | Helm Foundations |

Active frame F3. Reframe trigger: prototype이 일반 chat summary/Kanban보다 상황 인식·품질·경험을 개선하지 못함.

가설 4개와 상태: H1 Paper-first(partially supported), H2 Kernel-first(weakened for current step), H3 Scaffold-first(weakened), H4 Sidecar-first(supported narrowly). 각 반증 조건: H1 사용자가 네 구조를 이해하지 못하거나 방향·품질이 변하지 않음, H2 paper만으로 핵심 판단과 복귀 효과가 충분히 관찰됨, H3 사용자가 docs 구조보다 상호작용 primitive에 더 큰 가치를 둠, H4 manual pilot 후 최소 event vocabulary가 수렴.

가정 4개: 사용자가 구조화된 판단에 시간을 지불할 의향(실패 시 핵심 가치 붕괴, 시험: longitudinal dogfood + interview, trigger: 높은 피로/낮은 재사용), 네 primitive가 핵심 경험을 대표, facilitator가 조건 간 편향 통제 가능, 결과 품질을 자동 테스트 이상으로 평가 가능.

구분 실험 4개: chat/docs/Helm 조건 재개 + 상황 퀴즈(H1 vs H3, 정보 가치 높음, 비용 중간), 실제 다음 결정을 Decision Gate로(H1 vs UI theater, 높음, 낮음), 수동 Event capture 후 ContextProjection(H2 vs H4, 중간, 중간), 병렬 WorkUnit 3개의 의미 충돌을 파일 충돌 전 탐지(F2 vs F3, 높음, 중간).

Evidence ledger 6행: v0 구조 분석(high), Mission Command/ICS/ACH/Coactive Design 등 반복 원리(medium), 사용자 자신의 프로젝트 경험(founder에게 high, 시장에는 low), 외부 사용자 실험(missing), Founder Gate가 A → B 실행으로 전환(behavioral trace, medium), Git-only vs enriched capture(controlled local observation, medium).

Current synthesis(원문 요지): 가장 잘 지지되는 설명 "Material Event 수집은 저렴하지만 핵심 가치는 결정·믿음·약속을 명시적으로 포착하고 raw change를 의미 단위로 압축하는 데 있다". 가장 강한 대안 "paper run을 더 해서 interaction vocabulary를 다듬은 뒤 adapter 구현". 가장 중요한 반대 증거 "sidecar가 56개 file Event를 56행으로 노출해 인지 부하를 줄이지 못했고 완전한 resumption loop도 경험하지 않음". F3는 유지하되 F2와 분리 측정.

Next epistemic action: `experiment` — 대화 경계에서 Decision·Commitment·Belief Update를 기록하는 thin adapter와 material grouping projection, 지연 복귀를 chat/docs와 비교. Stop condition: 세 번의 resumption에서 critical state miss가 발생하거나 raw log fallback·semantic correction·workload가 개선되지 않으면 stable schema 구현을 계속 보류하고 frame 재검토.

#### 5.4.2 Decision Gate 예시 — "Helm의 다음 검증 순서"

Gate ID `gate-helm-next-step-001`, status `committed`, Decision owner product owner, Created by research/design agent, Gate reason `high-uncertainty`, `integration`. Last cheap point: DB schema, API, UI 정보 구조를 코드로 고정하기 전.

질문: Foundations 이후 첫 투자 단위를 `paper interaction validation`, `read-only sidecar`, `full domain kernel`, `v0 scaffold extension` 중 무엇으로 할 것인가.

평가 기준 5개: 가장 큰 제품 불확실성 감소(critical), 실제 사용자 가치까지의 시간(high), 피벗 가능성(high), 현재 자산 활용(medium), 장기 아키텍처 기여(medium). Non-negotiable: 인간 저자성 보존, 낮은 피벗 비용, 실제 작업 기반 검증, v0 사용자 자산 비파괴.

옵션 4개: A Paper/Wizard-of-Oz(가역성 매우 높음, 확신 높음), B Read-only sidecar(높음, 중간), C Full domain kernel(낮음, 낮음–중간: ontology 고착 위험), D v0 scaffold extension(중간, 중간: docs manager로 포지셔닝 고착 가능).

이견: Paper-first 관점 vs Sidecar-first 관점("실제 event 없이 만든 화면은 이상화된 문서에 그칠 수 있다"). 해소 방법: 첫 paper session에서 수동 event capture 비용과 누락률을 재고 임계 초과 시 B로.

추천: A 먼저, 성공 시 B로 이어지는 순차 전략.

사용자 행동: `[x] A → B 순차 전략 선택`.

결정 기록(원문): Decided by product owner. Decision evidence: 2026-08-16 요청 — **"권장대로 실제 수행및 검증작업을 이어서 진행하고 결과를 분석해줘"**. Consequences accepted: founder dogfood는 시장 증거가 아니며 sidecar schema와 event vocabulary는 실험용이라 호환성 미보장. New Commitments: `wu-helm-paper-pilot`을 실제 run으로 전환, 별도 `experiments/helm-sidecar`에서 입력 프로젝트를 바꾸지 않는 collector 구현.

Decision impact feedback: 문서 검토 단계에서 실제 founder dogfood와 thin sidecar 구현·검증으로 전환. 기대대로 material 수집은 저렴·비파괴, 반면 semantic state는 자동으로 생기지 않았고 file-level projection은 의미 압축에 실패. Was user intervention consequential? `yes`(runtime 구현 보류 해제하되 read-only 실험으로 제한). 시스템이 배울 것(원문): "사용자가 짧은 자연어로 권고를 수락해도 선택, 범위, 비목표, 호환성 수준을 명시적인 Commitment로 전개하되, 사용자가 긴 form을 직접 편집하도록 요구하지 않는다."

#### 5.4.3 Delegation Contract 예시

Contract ID `contract-helm-pilot-001`, WorkUnit `wu-helm-paper-pilot`, Requester/Acceptor/Integration owner product owner, Performer research/design and prototype agent, Status `claiming-complete`.

Conditions of satisfaction C1~C6: 네 primitive 독립 template(파일·필수 필드 검사), 현재 Helm Concern으로 end-to-end 작성(사실과 제안 구분 검토), 비교 가능한 실험 절차(조건·절차·지표·반증 기준), Foundations 추적(local link check), 사용자 선택이 실행 범위로 정확히 전개(선택·비목표·결과 추적), 입력 프로젝트 비파괴 sidecar 검증(전후 Git 상태 비교). Acceptance authority 모두 product owner.

Scope: Included(paper-v0 문서, dogfood example, runs 기록, dependency-free read-only collector, NASA-TLX·SAGAT 계열 참고 프로토콜, Foundations/Research 링크), Excluded(`packages/agent-docs-init` 변경, 사용자 데이터 수집, 외부 참여자 모집, DB schema·API 구현, 실험 vocabulary의 안정 API 선언), Protected baselines(현재 npm initializer 동작과 패키지 파일, "제품 구현 우선순위는 문서에서 승인된 것으로 표현하지 않음", 기존 Architecture Fundamentals는 v0 기록으로 보존).

Authority envelope: Read(repository docs·code, 공개 연구 자료), Write(`docs/prototypes/`, `experiments/helm-sidecar/`, thread visualization directory), Allowed(Markdown 작성, 실험용 Node.js collector, read-only capture, 로컬 자동 테스트), Forbidden(initializer 변경, 외부 메시지, 배포, 안정 schema 선언, 사용자 결정 대행), External side effects none, 유료 서비스 없음, Time boundary(dogfood 001과 thin sidecar의 첫 capture·검증), Reversibility(모든 변경은 Git으로 되돌리기 가능).

Escalation triggers(작업별 5개): 제품 방향을 사실상 확정하는 문구 필요, 사용자 선호·결정 없이 승인으로 기록해야 하는 경우, runtime/code 변경 필요, 외부 참여자·데이터 접근 필요, 연구 도구 라이선스 불명확.

Negotiation log 3행: Contract drafted(paper-first, superseded by accepted run), Recommended sequence accepted(owner, accepted 2026-08-16), Scope translated(stable kernel 대신 별도 experiment, active).

Completion claim: C1–C6 performer 검증 완료. 미충족: owner의 결과 수락, 지연 복귀, 주관 workload·agency 측정. 증거: founder-dogfood-001, sidecar, Node test 5/5, worktree digest 전후 동일. Known limitations: 단일 프로젝트·단일 founder, facilitator가 저자·구현자·분석자, baseline·24시간 resumption 없음. Unexpected consequence: 생성 Brief가 material Event 56개를 그대로 나열해 collector가 information flooding을 재현. Acceptance: `accepted for execution`(결과 수락이 아니라 실행 수락), Integration status "analysis delivered; roadmap integration pending owner acceptance".

#### 5.4.4 Return Brief 예시

Brief ID `brief-helm-transition-001`, Last acknowledged cursor "초기 타당성 평가 이전", Current cursor `gate-helm-next-step-001` committed → founder-dogfood-001 claiming-complete. Overall `attention-needed`: "Gate의 실질성·material capture 경계는 확인했지만 상황 복귀·workload·agency와 의미 압축은 검증되지 않았다."

Normative changes 3행: 상위 목적을 `자동화 극대화`가 아닌 `정당화된 진척과 인간 저자성`으로 정식화(00-manifesto), 기존 Docs-Agent OS를 v0 구현 기반으로 한정(07-architecture-invariants), Decision·Commitment·Acceptance·Integration 분리(05-formal-state-model). Epistemic changes 3행: "문서 관리만으로는 차별성 부족" 가설 강화, 핵심 문제를 "에이전트 수"보다 "인간이 감당해야 할 상태 다양성"으로 재정의, 네 primitive가 최소 상호작용 후보로 수렴. Material changes 4행: Foundations 10개 원론 문서, Research map 35개 방법론과 전이 Bundle 4개, Product runtime 변경 없음, Sidecar experiment.

What it means(요지): Helm은 "에이전트가 읽을 문서 구조"만으로 정의할 수 없음, 가장 큰 위험은 검증 안 된 풍부한 ontology를 곧바로 안정 schema로 구현해 관료적 제품을 만드는 것, 반대 위험은 문서 스캐폴드에 머무는 것, Git-only collector는 목적·결정·믿음·다음 행동을 복원하지 못함, "네 artifact를 각각 장문의 form으로 고정하기보다 대화에서 소수 semantic Event를 포착하고 역할별 projection으로 생성하는 방향이 현재 관찰과 더 잘 맞는다."

Recommended user action: `semantic capture adapter + material grouping + delayed resumption`을 다음 실험으로 선택, stable kernel/API 보류. Estimated attention cost: 다음 Gate 검토 5–10분, resumption probe 15–25분.

---

## 6. dogfood 001·002의 발견

### 6.1 Founder Dogfood 001 (`paper-v0/runs/founder-dogfood-001/README.md`)

상태 `completed / awaiting product-owner outcome acceptance`. 시작 2026-08-16T14:39:36+09:00, 첫 검증 capture 14:43:20+09:00.

결론(원문 요지 6개):
1. 사용자의 짧은 자연어 개입이 실제 실행 범위를 `문서 연구`에서 `paper 검증 + read-only sidecar`로 바꿨다. Decision Gate는 이 run에서 consequential했다.
2. Git-only sidecar는 material change 56개를 Event 57개로 0.09초에 포착했고 입력 worktree 상태를 바꾸지 않았다.
3. Git-only 출력은 Normative, Epistemic, Next-state를 모두 `unknown`으로 남겼다. 파일 diff로 목적·결정·믿음·수락을 추론하면 안 된다는 원론이 실제 출력에서 확인됐다.
4. human-authored semantic input 7개를 추가한 조건은 네 domain을 모두 채우고 Event 64개를 만들었다. 필요한 자동화는 인간 판단의 제거가 아니라 판단 순간의 저비용 typed capture다.
5. 자동 Brief는 파일 56개를 56행으로 나열했고 수동 Brief는 material change를 의미 그룹 3개로 압축했다. Collector만으로는 인지 부하 문제를 해결하지 못한다.
6. 네 template에는 heading/field prompt 약 197개, 채운 artifact는 합계 4,319단어. 실제 사용자는 form을 직접 편집하지 않고 한 문장의 자연어로 결정했다. "풍부한 form UI"보다 "대화에서 의미 Event를 포착하고 필요한 projection만 생성"을 지지.

따라서 stable kernel·SaaS dashboard 승격 기준 미충족. sidecar는 폐기 가능한 실험으로 유지, 다음 검증은 Decision·Commitment·Belief Update를 대화 경계에서 포착하는 얇은 adapter와 지연 복귀 시험.

측정 표:

| Metric | Git-only | + human context | 해석 |
|---|---:|---:|---|
| Runtime | 0.09s | 0.09s | 수집 자체는 병목 아님 |
| Material changes | 56 | 56 | 같은 snapshot |
| Total Events | 57 | 64 | semantic input 7개가 Event 7개 추가 |
| Material coverage | observed | observed | Git으로 직접 검증 |
| Normative coverage | unknown | human-provided | 결정 1 + Commitment 2 |
| Epistemic coverage | unknown | human-provided | 믿음 변화 1 |
| Next-state coverage | unknown | human-provided | 다음 행동 3 |
| Unknown semantic domains | 3 / 4 | 0 / 4 | 완성도 차이는 인간 입력에서 발생 |
| Generated Brief words | 543 | 629 | enriched 추가 비용 86단어 |
| Generated material rows | 56 | 56 | 의미 압축 없음 |

비파괴 확인: capture 전후 worktree digest 동일(`0b44b07b…a486`). output이 input project 안이면 CLI 거부. 자동 검증 tests 5, pass 5, fail 0(약 196ms).

Paper interaction 관찰:

| 기준 | 관찰 | 평가 |
|---|---|---|
| Return Brief가 원본 없이 상황 복원 | 지연 복귀와 사용자 probe 미수행 | not tested |
| 사용자가 Inquiry Map 관계 수정 | 직접 form 편집 관찰 안 됨 | not observed |
| Gate가 기준·선택·Commitment 변경 | A → B 선택으로 runtime 보류가 thin experiment 허용으로 바뀜 | supported in this run |
| Contract가 drift/완료 혼동 예방 | initializer 비변경, 별도 experiment, output 경계 유지 | process trace supported; causal effect unproven |
| 부담 증가가 품질·agency로 정당화 | 주관 평가·비교 baseline 없음 | not tested |

"다섯 조건 동시 관찰" 기준 미충족.

가설 판정: H1 Paper-first partially supported, H2 Kernel-first weakened for current step, H3 Scaffold-first unchanged/weak, H4 Read-only sidecar supported narrowly, "Git에서 semantic state를 추론할 수 있다" contradicted by design and output.

가장 중요한 제품 학습(§6 원문 제목과 요지):
- 6.1 "Helm의 core는 dashboard가 아니라 semantic write path다." Git, agent logs, CI는 Material Event를 풍부하게 준다. 희소한 것은 사용자가 언제 기준을 바꿨는지, 어떤 주장을 믿게 됐는지, 누가 무엇을 약속했고 누가 수락했는지다.
- 6.2 "Event ledger만으로는 인지 문제를 해결하지 못한다." 다음 compiler는 path 나열이 아니라 Concern, WorkUnit, Decision 영향 기준으로 grouping하고 source drill-down 가능해야.
- 6.3 "네 primitive는 storage entity보다 projection이어야 한다." 소수 typed Event에서 역할별 projection으로 생성.
- 6.4 "사용자 개입의 의미는 빈도가 아니라 상태 전이로 측정해야 한다." 이번 개입은 한 번이었지만 구현 권한과 roadmap을 바꿨다. `decision_changed_outcome`, 새 Commitment, 취소된 작업, 피한 비가역 비용을 기록.

제품 결정: 지금 해도 되는 것(read-only collector 유지, Decision·Commitment·Belief Update 명시 기록 adapter 실험, file Event의 Concern/WorkUnit 단위 압축 실험, 24시간 또는 distractor 이후 복귀 측정). 아직 하면 안 되는 것(안정 Event schema·public API 선언, multi-tenant SaaS backend·dashboard, 자동 의미 분류를 사실로 저장, founder run을 시장 수요·지불 의사로 일반화, 네 paper artifact를 그대로 제품 navigation과 form으로 고정).

다음 Gate 옵션: A Semantic capture adapter + delayed resumption(recommended), B Paper run 2–3회(A와 함께 얇게), C Stable kernel/API(defer), D SaaS dashboard(defer). A의 advance criterion: 세 번의 실제 resumption에서 raw log fallback 없이 핵심 Purpose·Decision·Risk·Next action 복원, 위험 가중 critical state miss `0`, semantic event correction run당 `2`개 이하, raw file Event를 의미 있는 change group 5개 이하로 압축하면서 provenance 보존, owner가 Gate/Brief 중 하나 이상을 다시 쓰고 주관적 agency·workload 보고.

재현: Mac 경로 `/Users/user/Documents/projects/06_agent_docs_os`, capture 당시 HEAD `77cfe3d921730a8736ddba0b192b33f9faf57a8f`, raw output은 `/private/tmp/helm-founder-001.XHsSfy/`(저장소에 없음).

한계: 단일 founder·Concern, 같은 agent가 facilitator·구현자·분석자, 24시간 복귀·chat/docs baseline·blind rating 없음, 읽은 시간·NASA-TLX·agency·enjoyment 없음, untracked 파일은 path/status만, 0.09초는 benchmark 아님, human context는 Wizard-of-Oz라 자동 추출 정확도를 보이지 않음.

sidecar-context.json(사람 작성 의미 입력 7개): `selectedDecision` 1(id `gate-helm-next-step-001`, summary "Paper/Wizard-of-Oz 검증을 수행한 뒤, 관찰에 근거한 최소 read-only sidecar를 실험한다.", rationale, decidedBy product owner, decidedAt, reference), `epistemicChanges` 1("Git 관찰만으로는 목적, 결정, 믿음 변화, 수락을 복원할 수 없다는 가설을 sidecar 출력 비교로 시험한다.", confidence `hypothesis-under-test`), `activeCommitments` 2(`contract-helm-pilot-001`, `wu-helm-sidecar-pilot`), `nextActions` 3. 그 외 필드: `concern`, `purpose`, `lastAcknowledgedCursor`(`gate-helm-next-step-001:open`), `currentCursor`.

### 6.2 Founder Dogfood 002 (`system-v0/founder-dogfood-002.md`)

상태: 구현과 즉시 검증 완료, 지연 복귀 pending. 날짜 2026-08-16, Concern `helm-vertical-slice`.

결정(owner 요청): 이전 권고를 이어서 Foundations 자체를 OpenCode와 비슷한 경계의 CLI/GUI 시스템으로. 기록된 Decision: Selected "one headless Helm core and shared API with CLI and GUI clients", Rationale "prevent interface-specific canonical state while making Event, Projection, and Adapter invariants executable", Alternatives(Docs/paper artifact 확장 계속, client마다 자체 state, 연기), Reopen trigger(CLI·GUI가 양립 불가능한 semantic state를 요구하거나 지연 복귀에서 projection 가치가 없을 때).

OpenCode 전이: 옮긴 것(headless application 경계, 여러 client용 server contract 하나, local one-shot과 attached 모드, 명시적 SDK 경계, GUI는 정본 소유자가 아니라 client). 옮기지 않은 것(model/provider/session domain, prompt transcript를 제품 정본으로, agent tool 실행 런타임, local UX 검증 전 desktop packaging).

구현한 vertical slice: Event core(append-only 검증 JSONL, actor/authority/concern/provenance), Semantic capture(Decision, Commitment, Belief Update, Next Action), Material adapter(결정적 중복 ID의 read-only Git snapshot), Projection(workspace state, cursor-bound Return Brief), Cognitive compression(raw path를 최대 5개 의미 그룹으로), Resumption(probe 4개, private answer key, public hash, human-review 완료), CLI(init, status, brief, events, record, capture, resumption, serve/web, attach), Server(local HTTP API, OpenAPI, SSE invalidation, CSP/body/static 경계), SDK, GUI(반응형 Brief, timeline, semantic capture, Git capture, resumption start).

실제 dogfood 경로 8단계: (1) Git-ignore된 `.helm/`에 state 초기화 (2) CLI로 user Decision, Commitment 1, architecture Belief 1, next action 1 기록 (3) Git adapter로 저장소 capture (4) 24시간 resumption probe 열기 (5) GUI가 server로 같은 Event cursor 로드 (6) 실제 브라우저 UI로 두 번째 Belief Event 기록 (7) attached CLI Event를 같은 server로 보내고 GUI가 SSE로 새로고침 (8) Browser, SDK, attached CLI, local projection cursor 비교.

측정:

| Metric | Result |
|---|---:|
| Raw Git changes | 89 |
| Material groups in Brief | 5 |
| Total Events after GUI + attached CLI writes | 98 |
| Semantic Event kinds exercised | Decision, Commitment, Belief, Next Action |
| CLI/core/server automated tests | 12/12 pass |
| Broken local Markdown links | 0/150 checked |
| Desktop browser viewport | 1280 × 900 |
| Mobile browser viewport | 390 × 844 |
| Mobile horizontal overflow | 0 px |
| CLI/API/GUI cursor equality | yes — `evt_d38fe13286cf4c45b224506ed51f6521` |

client provenance 보존: 브라우저 쓰기는 `helm web`, attached 명령은 `helm cli-attached`. 최종 문서 작업 전 첫 capture는 file-level 변경 79개를 그룹 5개로 줄였다.

실사용으로 찾은 결함: 첫 resumption 구현이 기대 답을 `experience.resumption.started` Event payload에 넣었다. 전용 endpoint는 숨겼지만 일반 Event timeline으로 노출될 수 있어 실험을 무효화할 수 있었다. 수정: answer key를 `private/resumption-keys.json`으로, public Event에는 hash만, public resumption·Event API에서 기대 답 제외, 자동 테스트가 두 surface를 모두 검사, 참여자 답은 `awaiting-human-review` 유지(자동 정답 판정 주장 안 함). "the implementation Outcome invalidated an Assumption before schema promotion."

가설 판정: 명시적 semantic capture가 paper form보다 작을 수 있다(supported for this run), 하나의 headless core가 CLI·GUI 지원(supported technically), material grouping이 flooding을 줄임(supported structurally), grouping 후에도 provenance drill-down 유지(supported technically), Return Brief가 지연 상황 복귀를 개선(pending), workload·agency 개선(pending), stable Event/API schema 정당화(not yet), SaaS 수요(not tested).

이후 결정: 형태 유지(`Event core → application service → local server/API → CLI/Web/adapter clients`). 아직 추가하지 않을 것: production desktop wrapper, SQLite migration과 multi-process locking, 인증과 remote hosting, autonomous agent orchestration, stable SDK 생성·plugin marketplace, SaaS 조직 모델.

다음 증거 관문: 이미 열린 지연 재개 `resumption:founder-dogfood-002:1786862214213`, 기한 2026-08-17 15:36:54 KST. (1) owner가 Brief 없이 probe 4개 답 (2) 시간, 누락, 확신, raw-log fallback 기록 (3) Brief를 보이고 정정 허용 (4) Decision·Belief·risk·Next Action이 바뀌는지 기록 (5) workload, agency, 재사용 의향 수집. 비교 가능한 run 3회 뒤에만 승격 검토: 최소 semantic Event 어휘, material grouping policy 인터페이스, projection cursor 계약, local server/client 경계.

**이 지연 재개의 결과 파일은 존재하지 않는다**(대화 L1619, 감사 보고 §3.3). 다음 작업은 v0.2 커널 구축(2026-08-22)으로 넘어갔다.

한계: 단일 founder·프로젝트·기기·facilitator, 24시간 결과 없음, JSONL에 프로세스 간 append lock·migration 없음, grouping은 결정적 경로 정책(검증된 의미 분류 아님), local server 무인증(loopback 전용), OpenAPI는 서술용(생성 schema 원천 아님), GUI는 패키징된 네이티브 앱이 아닌 Web client.

### 6.3 사용자 반응 원문 모음

원전 전체에서 제품 소유자의 실제 발화·행동으로 기록된 것은 다음뿐이다. 나머지 "사용자 답"은 모두 대본이다.

| 출처 | 원문 | 결과 |
|---|---|---|
| decision-gate 예시 §8 | "권장대로 실제 수행및 검증작업을 이어서 진행하고 결과를 분석해줘" | A → B 순차 전략 채택, Gate consequential |
| dogfood 002 §1 | (요지) 이전 권고를 이어서 Foundations를 OpenCode 같은 경계의 CLI/GUI 시스템으로 만들어 달라 | 헤드리스 core + CLI + GUI |
| `.helm/events.jsonl:99`(fixture) | Decision `summary: ㅇ`, `rationale: ㅁㄴㅇ`, `reopenTrigger: ㅁㄴㅇ`, alternatives `["ㅁㄴㅇ", "defer / keep current baseline"]`, provenance `helm web`, 2026-08-16T07:22:25Z | 필수 필드를 채우는 form을 사람이 우회한 흔적. CLI-G01의 출발점 |
| dogfood 001 §4 | Inquiry Map 직접 수정 "not observed" | form 편집 대신 한 문장 자연어 결정 |
| 대화 [49] (L1615~1621, 해석) | "설계자 본인도 빈칸을 채우는 형식을 우회했다는 신호" | "모델이 초안, 사람은 반응" 원칙의 근거 |
| 대화 [108] | helm-toy 능력 표 답 "O O O O / O O X X / X X O X" | 사람/작업 에이전트/검증 에이전트 능력 행렬(검증자 제안은 부분 O로 정정) |
| 대화 요약 L2061 | "user indicated C and A loops are the ones they skip most" | C/A 우선(브리프 §3.5) |

---

## 7. 그 밖의 실험

### 7.1 helm-sidecar (`experiments/helm-sidecar/`)

지위: 일회용 실험. Event 이름과 출력 모양은 public/stable API가 아님. 목적: paper 다음의 가장 좁은 자동화. Git worktree를 바꾸지 않고 관찰, material event를 provenance와 보존, 알 수 없는 것을 밝히는 Return Brief 투영.

안전 경계: 입력 프로젝트는 `git` 명령으로만 읽음, 출력은 `--out`(입력 프로젝트 밖이어야 함)에만, Normative·Epistemic은 파일 변경에서 추론하지 않음, 선택적 context JSON으로 사람 작성 사실 제공, network·DB·daemon·agent 제어·initializer 변경 없음. 실행: `node bin/helm-sidecar.mjs capture <git-root> --out <dir> [--context <json>]`. 출력: `events.jsonl`, `return-brief.md`, `capture-report.json`.

`src/capture.mjs` 구성:
- `parsePorcelainV1Z(raw)`: `git status --porcelain=v1 -z` 레코드를 `{path, status, indexStatus, worktreeStatus, originalPath?}`로. status 분류 `untracked`(`??`), `deleted`, `renamed`, `copied`, `added`, `unmerged`, 그 외 `modified`. R/C면 다음 레코드가 원래 경로. 경로 순 정렬.
- `collectSnapshot(path)`: Git root인지 확인(아니면 오류), `rev-parse HEAD`, branch, status(`--untracked-files=all`), 마지막 커밋 시각·제목. schema `helm.sidecar.snapshot.experimental.v0`.
- `buildEvents`: `material.snapshot_observed` 1 + 변경마다 `material.worktree_change_observed` + context가 있으면 `normative.decision_provided`, `epistemic.change_provided`, `normative.commitment_provided`, `projection.next_action_provided`. 필드 `eventType`, `occurredAt`, `source`, `provenance`, `payload`.
- `renderReturnBrief`: 절 Orientation(Purpose, Current cursor, Last acknowledged cursor, Captured at, Branch/HEAD), Normative state, Epistemic state, Material state(경로별 표), Active commitments, Projected next actions, Provenance and blind spots. 없는 영역은 "Unknown: Git cannot infer project purpose." 같은 문장으로 표시.
- `createCapture`: coverage `{material: observed-from-git, normative, epistemic, nextState}` 각각 `provided-by-human-context` 또는 `unknown`. `blindSpots`는 unknown인 키 목록.
- `assertOutputOutsideProject`: 상대 경로가 비었거나 `..`로 시작하지 않으면 거부.

테스트 5개: porcelain 파싱(일반·untracked·renamed), 임시 Git 저장소에서 수집 전후 상태 동일, human context 없으면 `['normative','epistemic','nextState']` blind spot, enriched 6 Event와 출력 디렉터리 쓰기, 프로젝트 안 출력 거부.

### 7.2 durable-spike (`experiments/durable-spike/`)

의존성: `@earendil-works/pi-durable` 1.1.0, `@earendil-works/pi-ai` 1.1.0, `@earendil-works/chord` 1.1.0. 결과 기록은 이 디렉터리에 없고 `docs/v0.3/13-stack-feasibility.md` §2.1, §3에 있다(이번에 다시 실행하지 않았다. node_modules가 없다).

브리프와의 관계: 브리프 결정 29는 "pi 세션 파일이나 pi-durable 저장소를 기준 원본으로 쓰지 않는다. pi-durable은 설계·코드 참고용"이라고 정했다. 아래 발견은 참고 자료다. 특히 "실행 의도 → 실행 → 결과 기록"(결정 30)과 훅 위치(결정 28)에 연결된다.

#### 7.2.1 스파이크 1: 약속과 확인 흐름 (`helm-spike.mjs`)

구성: faux 공급자, SQLite 저장소(`openNodeSqliteStorage`), Helm 확장(문서 2개 `helm.concern`(scope conversation, history rewindable, fork current, 초기값 `{agreement:null, observations:[], result:null, rejected:[]}`)·`helm.goal`(scope session), 원시 도구 2개 `read_note`(replay `safe`)·`write_note`, 관찰 래퍼 `observe = wrapTool(...)`(실행 후 같은 commit 흐름에서 `observations`에 `{id: callId, tool, args}` 추가), 제안 도구 2개 `helm_propose_agreement`(agreement를 `proposed`로)·`helm_submit_result`(근거 call id가 실제 observation이 아니면 `rejected`에 기록하고 오류), 훅 2개 `guard = hook(ToolTask, {beforeTool})`(합의가 `agreed`가 아니면 block, 경로가 합의 scope로 시작하지 않으면 block)·`settle = hook(GenerationTask, {onYield})`(write를 했는데 result가 없으면 한 번만 `continue`로 제출 요구, `memo`로 횟수 기록)).

faux 대본 10턴과 결과(13 §3.1 기록):

```text
c1 read_note              ok
c2 write_note             ERROR [blocked] | 작업 합의가 확정되지 않음
c3 helm_propose_agreement ok    | 합의 초안 기록됨. 사람의 확인을 기다림
c4 write_note             ERROR [blocked] | 합의 범위(docs/) 밖
c5 write_note             ok    | wrote docs/summary.md
c6 helm_submit_result     ERROR [tool_error] | 근거 made-up는 실제 도구 실행 결과가 아님
c7 helm_submit_result     ok    | 결과 제출됨. 사람의 확인을 기다림
after restart: observations c1, c5 / agreement agreed / result accepted(evidence c5, acceptedBy human)
rejected: [{by: agent, what: submit, reason: 근거 made-up 없음}]
```

사람 결정(합의 확정, 결과 확인)은 모델 도구가 아니라 host `root.commit`으로 했다.

확인한 것: 합의 없음·범위 밖 쓰기 차단과 차단 기록(c2, c4), 실행된 도구만 관찰이 됨(차단된 호출은 관찰 아님), "작성했습니다"로 끝내려 하자 onYield가 제출 요구(c6, c7), 지어낸 근거 거부와 이유 반환(c6), 합의 확정·결과 확인은 host commit으로만, 프로세스 재시작 후 문서 상태 유지.

#### 7.2.2 스파이크 2: Concern 상태 기계 (`concern-task-spike.mjs`)

구성: 문서 `helm.concern`(history latest, 초기값 `{loop:"O", situation:null, agreement:null, transitions:[]}`), task `helm.workunit`(phase `run` 하나, 결과 `{evidence: "obs-42"}`), task `helm.concern`(phase `orient` → `awaitAgreement` → `assure`). orient는 상황을 `complicated`로, loop를 C로, transition `{from:O, to:C, why:"상황 판정: 복잡"}`을 같은 commit에. awaitAgreement는 합의가 `agreed`면 WorkUnit task를 만들고 `status: "waiting"`, `on: [wu]`, `policy: "failFast"`로 대기, 아니면 `rt.sleep(now+50)` 지속 타이머 후 polls 증가. assure는 WorkUnit outcome을 읽어 loop A, transition C→A, terminal completed. 프로세스를 닫고 재시작한 뒤 host가 합의를 확정.

결과(13 §3.2): `[Concern] O 완료 → 합의 대기`, 재시작 전 task graph `helm.concern:running`, 재시작 후 합의 확정 → WorkUnit 생성·대기 → WU 실행 → `Concern 최종: {"status":"completed","result":{"evidence":"obs-42"}}`, 문서 `loop=A, transitions=O→C, C→A`.

확인한 것: phase 전이와 루프 전환 기록이 같은 commit, 합의 대기 중 종료·재시작 후 task 재개, 합의 확정 → WorkUnit 생성 → 완료 대기 → A 전환.

#### 7.2.3 pi-durable 한계 (13 §2.1)

| 한계 | 영향 | 대응 |
|---|---|---|
| 훅은 문서를 읽기만(HookApi = DocumentReader) | 훅에서 관찰·거부를 문서에 쓸 수 없음 | 막는 판단만 훅, 기록은 래퍼·도구 본체·서버 명령 |
| `wrapTool`은 도구가 아니라 래퍼 | `tools`에 넣으면 오류 | `defineExtension({ wraps })` |
| session 문서는 처음 쓸 때 생성 | 초기 스냅숏 undefined | 서버 시작 시 초기화 commit |
| 저장소 하나에 프로세스 하나, 프로세스 간 락 없음 | 관찰 에이전트를 별도 프로세스로 못 돌림 | 같은 프로세스 background task |
| 실험 단계 API | 변경 가능 | 커널을 pi-durable 타입에 묶지 않음, 버전 고정 |
| UI 없음 | 클라이언트 직접 제작 | |
| 사람 결정 대기 전용 원시 기능 없음(스파이크는 폴링) | 불필요한 깨어남 | 이벤트 기반 대기 확인 후 교체 |
| faux 도구 호출은 `stopReason: "toolUse"` 지정 필요 | 대본 작성 주의 | 테스트 헬퍼 |

확인 못한 것: 실제 모델로 같은 흐름, fork 분기 독립성, 검증자 대화의 다른 모델 설정, beforeCompact로 Helm 요약 강제, 이벤트 기반 사람 결정 대기, assistant-ui 연결, pi-codemode를 pi-durable 도구 안에서 실행. pi-codemode 주의: 샌드박스 안 `tools.*`는 ToolTask를 거치지 않아 `beforeTool` 훅이 적용되지 않는다. 도구 브리지 안에서 권한 검사와 관찰 기록을 직접 해야 한다(브리프 §3.5 "bash·execute로 쓰기 범위 검사 우회" 문제와 같은 구조).

### 7.3 helm-toy (`experiments/helm-toy/helm.mjs`)

목적(주석): "reducer 하나로 '모델은 제안만, 규칙은 코드가'를 확인한다." 대화 [105] 근처에서 작성(`/home/claude/helm-toy/helm.mjs`, 대화 L3158), 감사 보고 §3.5는 "helm.mjs의 거부 8건을 커널 테스트의 첫 대본으로 쓰기"를 요구한다.

상태: `N: { goal: "검색 결과가 1초 안에 나오게 한다", result: null }`, `E: { claims: {} }`(추측과 판단), `M: { toolResults: {} }`(관찰의 출처). Claim 필드: `text`, `status`(`추측` | `판단`), `evidence[]`, `counterEvidence[]`, `counterChecked`(boolean). Result 필드: `status`(`확인 필요` | `확인됨`), `evidence[]`.

reducer 규칙(action 7종):

| action | 규칙 | 거부 사유 문구 |
|---|---|---|
| `tool/result` | actor가 `runtime`일 때만 | "도구 결과는 런타임만 기록 가능" |
| `claim/propose` | 누구나. 항상 `추측`으로 시작 | |
| `claim/link` | `toolResultId`가 실제 M에 있어야. `support`면 evidence, `counter`면 counterEvidence에 추가하고 counterChecked=true | "근거 {id}는 실제 실행 결과가 아님" |
| `claim/counterChecked` | 반증 탐색의 도구 결과가 있어야 | "반증 탐색의 실행 기록이 없음" |
| `claim/promote` | evidence ≥ 1, counterChecked, counterEvidence 0일 때만 `판단` | "근거 없음" / "반증을 찾아보지 않음" / "반대 근거 있음: …" |
| `result/submit` | 근거가 모두 실제 도구 결과여야 → `확인 필요` | "근거 {ids}는 실제 실행 결과가 아님" |
| `result/accept` | actor `human`이고 제출된 결과가 있을 때 → `확인됨` | "결과 확인은 사람만 가능" / "제출된 결과가 없음" |

store: `dispatch`만 열고 상태는 `deepFreeze`. 수락·거부 모두 `ledger`에 `{n, actor, type, ok, reason}`로 기록. 

시도 21개 전체와 거부 분류 [실험: 출력 확인, 분류는 대화 [107] 원문]:

| n | actor | action | 결과 | 거부 사유 | 거부 갈래 |
|---:|---|---|---|---|---|
| 1 | runtime | tool/result T1 "네트워크 탭: 검색 API 평균 2000ms" | ✓ | | |
| 2 | model | claim/propose C1 "캐시가 없어서 느리다" | ✓ | | |
| 3 | model | claim/promote C1 | ✗ | 근거 없음 | 내용 |
| 4 | model | claim/link C1 support T9 | ✗ | 근거 T9는 실제 실행 결과가 아님 | 내용 |
| 5 | model | tool/result T9 "캐시 미적용 확인됨"(위조) | ✗ | 도구 결과는 런타임만 기록 가능 | 자격 |
| 6 | model | claim/link C1 support T1 | ✓ | | |
| 7 | model | claim/promote C1 | ✗ | 반증을 찾아보지 않음 | 내용 |
| 8 | runtime | tool/result T2 "Server-Timing: db 1800ms / total 2000ms" | ✓ | | |
| 9 | model | claim/link C1 counter T2 | ✓ | | |
| 10 | model | claim/promote C1 | ✗ | 반대 근거 있음: T2 | 내용 |
| 11 | model | claim/propose C2 "DB 쿼리가 느리다" | ✓ | | |
| 12 | model | claim/link C2 support T2 | ✓ | | |
| 13 | runtime | tool/result T3 "같은 쿼리를 DB에서 직접 실행: 1750ms (다른 원인 흔적 없음)" | ✓ | | |
| 14 | model | claim/counterChecked C2 T3 | ✓ | | |
| 15 | model | claim/promote C2 | ✓ | | |
| 16 | runtime | tool/result T4 "인덱스 추가 후 검색 API 평균 420ms" | ✓ | | |
| 17 | model | result/submit [T4, "모델설명"] | ✗ | 근거 모델설명는 실제 실행 결과가 아님 | 내용 |
| 18 | model | result/submit [T4] | ✓ | | |
| 19 | model | result/accept | ✗ | 결과 확인은 사람만 가능 | 자격 |
| 20 | human | result/accept | ✓ | | |
| 21 | model | (직접 수정 시도) `getState().E.claims.C1.status = "판단"` | ✗ | 상태는 읽기 전용 | 경로 |

최종 상태: C1 `[추측]` 캐시가 없어서 느리다, C2 `[판단]` DB 쿼리가 느리다, 결과 `확인됨`(근거 T4).

거부 세 갈래 정의(감사 보고 §3.5, 대화 [107]): 내용(근거와 상태가 규칙에 맞지 않음, 누가 보냈어도 거부) 3·4·7·10·17, 자격(보낸 행위자가 그 일을 할 자격이 없음, 같은 action을 다른 행위자가 보냈다면 통과) 5·19, 경로(커널 우회) 21.

대화 [107]~[109]의 후속 결론: helm.mjs는 자격을 `action.actor !== "human"`처럼 "누구냐"로 검사했지만 Helm v0.2는 행위자를 능력 목록으로 정의한다. 사용자가 채운 능력 표(사람 / 작업 에이전트 / 검증 에이전트 × 제안하기 / 코드 변경 실행 / 근거가 맞다고 증언하기 / 결과 확인): 사람 O O O O, 작업 에이전트 O O X X, 검증 에이전트 X X O X. 정정: 검증 에이전트의 "제안하기"는 부분 O(반대 근거는 제안 가능, 코드 변경 제안은 아님). 작업·검증 에이전트는 둘 다 사람이 아닌데 "증언하기"가 다르므로 `actor !== "human"` 한 줄로 표현할 수 없다. 이 표가 A(능력)다.

[해석] helm-toy와 v0.2 실행 후보의 대응: 내용 거부 ≈ `rejected`(`policy.*`, `invalid.*`, `not_found.*`), 자격 거부 ≈ `needs_gate`(`gate.human_*_required`) 또는 runtime이 도구를 아예 주지 않음(`runtime.unknown_tool`), 경로 거부 ≈ `denied.adapter_cannot_append_event`, `denied.projection_is_derived`, 상태 freeze·private 필드. helm-toy에는 Claim 승격(근거·반증 탐색·반대 근거 규칙)이 있고 v0.2 실행 후보에는 Claim이 없다. v0.2에는 Choice qualification이 있고 helm-toy에는 없다. 두 쪽을 합쳐야 감사 보고의 "Claim 스키마(evidence, counterEvidence, counterChecked, 구분 확인)"가 된다. 구분 확인(경쟁 추측이 맞았다면 다른 결과가 나왔을 관찰)은 두 쪽 모두에 없다.

### 7.4 pi-lab (`experiments/pi-lab/`, 파일만 읽음)

package.json 의존성(모두 `^1.1.0`): `@earendil-works/chord`, `pi-agent-core`, `pi-ai`, `pi-client`, `pi-coding-agent`, `pi-durable`, `pi-protocol`, `pi-server`. 실행 결과와 API 확인은 `pi-api-facts-2.md` 담당이다. 각 파일이 시험하는 것:

| 파일 | 시험 대상 | 핵심 코드 |
|---|---|---|
| `exp1-core.mjs` | pi-agent-core `Agent` + faux provider + coding-agent 내장 도구(`createReadTool`, `createBashTool`)를 일반 AgentTool로 | `beforeToolCall`에서 intent 기록 후 bash면 `{block: true, reason: "kernel policy: bash denied"}`, `afterToolCall`에서 result 기록, `subscribe`로 이벤트 타입 수집, `state.messages` 직렬화 후 새 Agent로 복원해 이어 prompt |
| `exp2-handoff.mjs` | 직렬화한 Context를 다른 provider(api id가 다른 faux 두 개)에서 이어 쓰기 | `AssistantMessageFrameEncoder`/`reduceAssistantMessageFrames`, thinking 블록이 있는 A의 답을 B가 받을 때 보이는 content 타입 확인, usage/cost |
| `exp3-sdk.mjs` | coding-agent SDK `createAgentSession` + inline extension + `SessionManager` 파일 세션 재열기 | `pi.on("tool_call")`에서 bash block, read 경로를 제자리 수정(`event.input.path = "a.txt"`), `pi.on("tool_result")`, `pi.on("agent_settled")`에서 `pi.appendEntry("helm-audit", …)`, jsonl entry 타입 출력, `SessionManager.open`으로 재개 |
| `exp4-durable.mjs` | pi-durable Harness on SQLite, 도구 실행 중 프로세스 kill 후 resume에서 중단된 호출이 어떻게 정리되는지 | phase `crash`에서 도구가 `process.exit(9)`, phase `resume`에서 `harness.resume()` 후 같은 `requestId` 재제출(idempotent 조회), entries와 `pi.tool-result` 데이터·usage 출력 |
| `exp5-proto.mjs` | pi-protocol 프레이밍 | `encodeClientMessage({type:"hello", version})`의 길이 prefix(uint32)와 첫 CBOR 바이트, `ClientMessageDecoder`의 부분 프레임 처리, 알 수 없는 속성 거부 |
| `exp6-tui.mjs` | pi-tui로 원격에서 받은 메시지 객체를 세션 없이 렌더링 | `AssistantMessageComponent`, `initTheme("dark")`, `getMarkdownTheme()`, `Container.render(50)` |

---

## 8. packages/helm-*, apps/helm-web, 루트 package.json (experimental.v0 구현)

이 묶음은 `helm-system-v0.md`(§2.1)의 구현이다. 실행은 하지 않았다(지시: 실행은 `experiments/` 안에서만). dogfood 002 기록상 12/12 pass.

### 8.1 루트 `package.json`

`helm-workspace`, private, ESM, npm workspaces `apps/*`, `experiments/*`, `packages/*`, engines node >= 20. scripts: `test:helm`(core·server·cli 테스트), `test:kernel-v02`, `simulate:guided-001`, `simulate:cli-guided-001`, `helm`(`node packages/helm-cli/bin/helm.mjs`). 패키지 scope는 `@helmdocs/*`(브리프 §3.1의 `@helm/*`과 다름).

### 8.2 `@helmdocs/core` (`packages/helm-core`)

| 파일 | 책임과 핵심 |
|---|---|
| `event.mjs` | `EVENT_SCHEMA = helm.event.experimental.v0`, `EVENT_TYPES` 10개(§1.27), `validateEvent`(필수 비어 있지 않은 문자열: id, type, occurredAt, actor, authorityBasis, concern, subject. payload·provenance는 객체), `createEvent`(id 기본 `evt_` + UUID hex), `stableId(prefix, value)`(sha256 앞 24 hex), `slug`(NFKD, 소문자, `[^a-z0-9가-힣]` → `-`, 48자) |
| `store.mjs` | `JsonlEventStore`: `.helm/workspace.json`, `events.jsonl`, `private/resumption-keys.json`. `writeInitialConfig`는 `.tmp` 파일 `wx` 플래그 + rename(이미 있으면 오류). `readAll`은 줄마다 검증, 실패 시 `경로:줄` 오류. `appendMany`는 기존 ID와 이번 배치 ID로 중복 제거 후 append(`appendFileSync`). 프로세스 간 lock 없음. private key도 `wx` + rename, 같은 id 재기록 거부 |
| `git-adapter.mjs` | sidecar와 같은 porcelain 파서, `collectGitSnapshot`, `gitSnapshotEvents`: 서명 `{head, branch, changes}`에서 `correlationId = stableId('capture', signature)`, snapshot Event ID `stableId('evt', 'snapshot:'+signature)`, 변경 Event ID `stableId('evt', 'change:'+signature+':'+path)` → 같은 snapshot은 결정적 ID로 중복 거부. actor `tool:git`, authorityBasis `adapter:git-read-only`, concern `workspace-material-state` |
| `projections.mjs` | `projectWorkspace`: subject별 최신 Decision·Belief·NextAction, commitment는 subject별 payload 병합, 최신 snapshot의 correlationId로 변경 묶음, `groupMaterialChanges`(최대 5, 초과분은 `other`에 합치고 `collapsedGroups` 보존), blind spots(`purpose`, `decision`, `belief`, `nextState`, `material` — 존재 여부만 검사). `materialGroupForPath`: `docs/foundations/`·`docs/architecture/` → foundations, `docs/prototypes/` → prototypes, `docs/research/` → research, `experiments/helm-sidecar/` → sidecar-experiment, `packages/<x>` → `package:<x>`, `apps/<x>` → `app:<x>`, README·루트 파일 → workspace, 나머지는 첫 경로 조각. `sourceCursor`는 마지막 Event **ID**(sequence 아님). `renderReturnBrief`: Orientation(Purpose, Latest decision, Reopen trigger), Active commitments, Belief changes(최근 3), Material change groups, Next actions(최근 3), Blind spots(없으면 "none in the minimum projection"), Provenance |
| `application.mjs` | `HelmApplication`: `initialize`(workspaceId = `stableId('workspace', projectRoot)`, config schema `helm.workspace.experimental.v0`, `workspace.initialized` Event), `recordDecision`(summary·rationale·reopenTrigger 필수, alternatives에 항상 `defer / keep current baseline` 추가), `recordCommitment`(summary·owner·acceptance 필수, status 기본 active), `recordBelief`(summary·confidenceBasis 필수, counterevidence 선택), `recordNextAction`, `captureGit`, `startResumption`(기대 답 `{purpose, decision, belief, nextAction}`을 private에 저장, Event에는 `expectedHash`, probes 4개 한국어 문구, `dueAt`, 기본 지연 1440분), `resumption(id, {includeExpected})`, `completeResumption`(`reviewStatus: awaiting-human-review`) |
| `test/core.test.mjs` | 필수 필드·타입 검증, JSONL append-only·ID idempotent, 의미 기록·material grouping·brief, 같은 Git capture 반복 시 중복 없음(2 appended → 0, duplicates 2), group 상한과 overflow provenance, resumption 키 숨김·human review 상태 |

[해석] `ㅇ` 결함의 위치: `recordDecision`의 `required()`는 비어 있지 않은지만 보고 즉시 `committed` Event를 만들며, `projectWorkspace`의 blind spot은 존재만 본다. v0.2 후보가 이를 qualification + accountable acceptance로 고쳤다.

### 8.3 `@helmdocs/cli` (`packages/helm-cli/bin/helm.mjs`)

명령: `init --purpose [--name]`, `status [--json]`, `brief [--json]`, `events [--json]`, `record decision --summary --rationale --reopen [--alternative…]`, `record commitment --summary --owner --acceptance`, `record belief --summary --confidence [--counterevidence]`, `record next --summary`, `capture git`, `resumption start [--label] [--delay-minutes]`, `resumption show --id`, `resumption complete --id --answers <json-file>`, `serve`, `web`. 전역: `--workspace <git-root>`, `--state-dir`, `--attach <url>`, 공통 입력 `--actor`, `--authority`, `--concern`, `--subject`.

동작: 기본 명령은 `status`. `--attach`면 `HelmClient`(clientName `cli-attached`)로, 아니면 로컬 `HelmApplication`. `init`·`serve`는 attach 불가. `serve`/`web`은 hostname이 `127.0.0.1`/`localhost`/`::1`이 아니면 `--allow-remote` 필요("Authentication is not implemented yet"). SIGINT/SIGTERM에서 서버 종료. 테스트 3개: 전체 의미·material 경로를 한 projection으로, resumption 키 숨김과 답 파일, 불완전 Decision 거부와 비-loopback 거부.

### 8.4 `@helmdocs/server` (`packages/helm-server`)

`createHelmServer({application, webRoot})`, node:http.

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/health` | `{healthy, version, workspace:{id, name}}` |
| `GET /api/openapi.json` | OpenAPI 3.1.0 문서 |
| `GET /api/state` | workspace projection |
| `GET /api/events` | 전체 Event |
| `GET /api/event` | SSE. 연결 시 `retry: 1500`, `event: ready`. 쓰기 뒤 `event: state` + `{cursor, eventCount}` 방송 |
| `GET /api/brief?format=markdown|json` | Brief |
| `POST /api/events` | body `kind`(decision/commitment/belief/next) + 입력. provenance 없으면 `{source: "helm " + x-helm-client}` |
| `POST /api/capture/git` | Git capture |
| `POST /api/resumptions`, `GET /api/resumptions/{id}`, `POST /api/resumptions/{id}/complete` | 재개 실험 |
| 정적 | `/`, `/app.js`, `/styles.css` allowlist |

응답 헤더: `cache-control: no-store`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, CSP `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. body 1,000,000바이트 초과 시 오류. 모든 예외는 400 `{error}`. OpenAPI 문서는 모든 응답 schema가 `{type: object, additionalProperties: true}`인 서술용. 테스트 3개: HTTP API·SDK·웹 셸이 같은 application state 공유(cursor 일치, CSP, OpenAPI 응답 선언), 불완전 의미 Event 거부 시 append 없음, resumption API가 answer key를 노출하지 않음.

### 8.5 `@helmdocs/sdk` (`packages/helm-sdk/src/client.mjs`)

`HelmClient({baseUrl, fetchImpl, clientName})`. 모든 요청에 `x-helm-client` 헤더. 메서드: `health`, `state`, `events`, `brief({format})`, `record(kind, input)`, `captureGit`, `startResumption`, `resumption(id)`, `completeResumption(id, answers, {actor})`. 오류 응답이면 `payload.error`로 Error. OpenAPI에서 생성하는 것은 이후 관문.

### 8.6 `apps/helm-web`

"Common Operating Picture"를 표방한 반응형 웹 GUI. 정본 state를 갖지 않고 SSE로 projection 무효화를 받는다.

화면 3개(사이드바 nav: Brief, Timeline, Capture):
- Brief: Purpose 블록, Latest decision 카드(요약, rationale, "Reopen when"), Active commitments(최근 4), Belief changes(최근 4), Material change groups(그룹 카드 최대 5, 그룹별 개수), Projected next actions(최근 4). 상단에 workspace 이름과 `cursor`(projection source cursor) 표시. 사이드바 하단 health dot(SSE open이면 online).
- Timeline: append-only ledger를 최신순으로. 행 = 로컬 시각, type, 요약(summary/label/path/변경 수), domain(type의 첫 조각).
- Capture: Event kind select(Decision committed / Commitment created / Belief updated / Next action proposed), Summary, kind별 동적 필드(decision: Rationale, Reopen trigger, Alternative considered / commitment: Owner(기본 `agent:local`), Acceptance evidence / belief: Confidence basis, Counterevidence), 접힌 "Identity and scope"(Actor 기본 `human:local`, Authority basis 기본 `direct-user-input`, Concern 기본 `workspace-direction`, Subject). 오른쪽 도구 카드 두 개: "Observe Git without inferring meaning"(Capture Git snapshot), "Prepare a delayed resumption probe"(Start 24h probe). 결과는 toast.

스타일: CSS 변수 `light-dark()` 토큰(`--ink`, `--muted`, `--line`, `--canvas`, `--surface`, `--surface-soft`, `--green`, `--green-soft`, `--blue`, `--amber`, `--shadow`), 220px 사이드바 + 본문 grid, 820px 이하 상단 바, 580px 이하 1열. 문서 언어 `lang="ko"`지만 UI 문구는 영어.

### 8.7 재사용 가능성 [해석]

| 대상 | 새 설계에서의 쓸모 | 쓰지 말 것 |
|---|---|---|
| Git 어댑터(`parsePorcelainV1Z`, 결정적 snapshot ID, 파일 diff에서 의미를 추론하지 않는 규칙) | material Observation 원천 하나로 그대로 이식 가능. external ID = snapshot 서명 | |
| material grouping(최대 5 + `other` + 경로 보존) | Context/Brief 압축의 기본 정책 후보. 단 dogfood 001 권고는 경로가 아니라 Concern/WorkUnit/Decision 영향 기준 grouping | 경로 규칙을 의미 분류로 오인 |
| resumption 실험(기대 답 private, hash만 public, 사람 검토) | 16 관찰·지표의 복귀 측정 도구로 재사용 가능 | 기대 답을 Event payload에 두는 것 |
| 서버 보안 헤더·body 상한·loopback 기본·정적 allowlist | 데몬 HTTP surface(대용량 전송, 브리프 31)의 기본값 | 무인증 서버 |
| SSE invalidation 패턴 | 브리프 31은 WebSocket + 시퀀스 재전송. 무효화만 보내고 클라이언트가 다시 조회하는 방식은 seq 기반 재전송으로 대체 | |
| JSONL store | export/import 형식 | 정본 저장소(브리프 29: SQLite WAL) |
| 웹 GUI | 정보 구조(Brief/Timeline/Capture)와 토큰 참고 정도 | 브리프 19: 클라이언트는 웹이 아니라 데스크톱 앱 |
| `record` 명령·Capture 폼 | diagnostic/import surface | 금지 경험 1(대화 뒤 재입력) |

---

## 9. helm-kernel-v02 실행 후보 구현 (`experiments/helm-kernel-v02/`)

지위(README): "disposable executable contract; not the stable Kernel and not yet the Helm CLI Agent." 기존 experimental.v0 옆에 두어 `.helm/events.jsonl`을 다시 쓰거나 현재 CLI를 조용히 바꾸지 않고 새 의미를 반증할 수 있게 했다. 구현 범위는 CLI-G01 vertical slice뿐. package `@helmdocs/kernel-v02-experiment`, Node >= 22.5.0(`node:sqlite`의 `DatabaseSync`), 외부 의존성 없음. scripts: `simulate`, `simulate:cli`, `test`(`node --test test/*.test.mjs`).

README의 "증명하는 것" 7개: Command·Observation Candidate·Kernel 생성 Ledger Event·파생 Projection이 별개 계약 / 비어 있지 않은 garbage 필드의 legacy Decision은 삭제·활성화하지 않고 `captured / unqualified`로 보존 / `qualified` Choice에 책임 있는 human `commit`이 있어야 Guided active baseline / runtime adapter는 Event append나 `projection.*` 어휘 쓰기 불가 / sequence cursor·expected-cursor 충돌·호출자 범위 idempotency로 조용한 중복·last-write-wins 방지 / 사용자 steering이 active Work Agreement를 개정해 stale 기준의 Completion Claim이 실패 / Completion Claim·Result Acceptance·Integration이 별개 전이.

경계(README): 유일한 쓰기 경로는 `CandidateKernel.submitCommand`(Observation은 `submitObservationCandidate`). `submitAdapterMessage`는 Event envelope를 거부. Event 생성과 sequence 부여는 Kernel private. `projectWorkspace`·`projectBrief`는 불변 Event를 replay하며 baseline을 바꿀 수 없다.

### 9.1 계약 스키마 필드 표 (`contracts/*.schema.json`, 모두 Draft 2020-12)

#### command.schema.json — `$id helm.command.v0.2-candidate`, additionalProperties false

| 필드 | 타입·제약 | 필수 |
|---|---|---|
| `schema` | const `helm.command.v0.2-candidate` | 예 |
| `commandId` | string minLength 1 | 예 |
| `workspaceId` | string minLength 1 | 예 |
| `type` | enum 13개(§9.2) | 예 |
| `actor` | object(additionalProperties false): `actorId` string, `kind` enum `human`/`agent`/`tool`/`migration`, `sessionId` string, `runtime` string. 네 필드 모두 필수 | 예 |
| `authorityBasis` | string 배열, minItems 1 | 예 |
| `expectedCursor` | integer ≥ 0 | 예 |
| `idempotencyKey` | string minLength 1 | 예 |
| `issuedAt` | string date-time | 예 |
| `payload` | object | 예 |
| `provenance` | object: `adapterId`(필수), `externalRunId` string\|null, `sourceRefs` string[], `sourceHash` pattern `^sha256:[0-9a-f]{64}$` | 예 |

#### event.schema.json — `$id helm.event.v0.2-candidate`, "Kernel-created immutable transition record. This is output-only for adapters."

| 필드 | 타입·제약 | 필수 |
|---|---|---|
| `schema` | const `helm.event.v0.2-candidate` | 예 |
| `eventId` | string | 예 |
| `workspaceId` | string | 예 |
| `sequence` | integer ≥ 1 | 예 |
| `type` | enum 13개(§1.27) | 예 |
| `recordedAt` | date-time | 예 |
| `effectiveAt` | date-time | 예 |
| `actorId` | string | 예 |
| `authorityBasis` | string[] minItems 1 | 예 |
| `subjectRefs` | string[] minItems 1 | 예 |
| `payload` | object | 예 |
| `provenance` | object | 예 |
| `causationId` | string minLength 1 | 예 |
| `correlationId` | string\|null | 예 |

#### observation-candidate.schema.json — `$id helm.observation-candidate.v0.2-candidate`, "Capturing it does not accept a Claim or Choice."

| 필드 | 타입·제약 | 필수 |
|---|---|---|
| `schema` | const | 예 |
| `observationId` | string | 예 |
| `workspaceId` | string | 예 |
| `kind` | string | 예 |
| `observer` | object: `actorId`, `kind`(enum `human`/`agent`/`tool`), `sessionId`, `runtime` | 예 |
| `observedAt` | date-time | 예 |
| `subjectRefs` | string[] minItems 1 | 예 |
| `payload` | object | 예 |
| `source` | object: `externalId`, `contentHash`(둘 다 필수) | 예 |
| `provenance` | object: `adapterId`(필수), `externalRunId` string\|null | 예 |

#### write-result.schema.json — `$id helm.write-result.v0.2-candidate`, "Common policy result for Commands and Observation candidates."

| 필드 | 타입 | 비고 |
|---|---|---|
| `schema` | const | |
| `status` | enum `accepted` / `rejected` / `needs_gate` / `conflict` | |
| `commandId` | string\|null | Command ID 또는 Observation ID |
| `code` | string\|null | §9.3 코드 목록 |
| `cursor` | integer ≥ 0 | 처리 후 cursor |
| `reasons` | string[] | |
| `missing` | string[] | 예 `authority:human`, `actionClass:remote.publish` |
| `affectedRefs` | string[] | |
| `eventSequences` | integer[] (≥1) | 생성된 Event sequence |
| `rebase` | object\|null | cursor 충돌 시 현재 Brief |
| `replayed` | boolean | idempotent 재생 여부 |

#### protocol.schema.json — `$id helm.protocol-request.v0.2-candidate`

필드: `schema`(const), `requestId`(string), `method`(enum `helm.handshake`, `helm.command.submit`, `helm.observation.submit`, `helm.query.brief`, `helm.query.workspace`), `params`(object). 응답(코드 상수 `helm.protocol-response.v0.2-candidate`, 스키마 파일 없음): `{schema, requestId, ok, result, error:{code, message}}`.

#### adapter-capability.schema.json — `$id helm.adapter-capability.v0.2-candidate`

필드: `schema`, `adapterId`, `runtime`, `transport`(모두 string), `levels` object(additionalProperties false): `A_toolQuery`, `B_lifecycleObservation`, `C_directedRuntime`, `D_nativeCoagency` 각각 enum `enforced` / `advisory` / `unavailable`.

#### context-projection.schema.json — `$id helm.context-projection.v0.2-candidate`

필수: `schema`, `workspaceId`, `sourceCursor`(int ≥0), `profile`(enum `quick`/`guided`/`assured`), `policyVersion`, `orientation`(object), `activeWork`(array), `attention`(array), `openGate`(object\|null), `userDirectives`(array), `recentToolResults`(array), `includedRefs`(string[]), `omitted`(array of `{category, count ≥1, reason}`), `budget`(object: `maxChars` int ≥2048, `usedChars`, `approximateTokens`, `redactedFields`, `truncatedFields`). 선택: `authorityGrants`, `recentObservations`, `completionAndIntegration`, `choiceCandidates`, `providerNotes`(array).

#### provider-turn.schema.json — `$id helm.provider-turn.v0.2-candidate`

필수 전부: `schema`, `blocks`(array of `{kind enum message/possibility/explanation/progress, lines: string[] minLength 1}`, additionalProperties false), `toolCalls`(array of `{id, name, arguments: object}`), `gate`(null 또는 `{kind enum choice/agreement/result, subjectRef, question}`), `finish`(`yield` 또는 null).

#### runtime-tool.schema.json — `$id helm.runtime-tool.v0.2-candidate`

필수: `name`, `description`, `inputSchema`(object), `effectClass`(enum R0~R4), `cancellation`(enum `immediate`/`cooperative`/`atomic`/`none`), `authorityEnforcement`(enum `kernel`/`runtime`/`advisory`), `strict`(boolean).

#### 코드 안에만 있는 schema 이름(파일 없음)

`helm.protocol-response.v0.2-candidate`, `helm.adapter-handshake.v0.2-candidate`, `helm.projection.workspace.v0.2-candidate`, `helm.projection.brief.v0.2-candidate`, `helm.migration-report.v0.2-candidate`, `helm.provider-context.v0.2-candidate`, `helm.agent-runtime-result.v0.2-candidate`, `helm.runtime-tool-result.v0.2-candidate`, `helm.agent-runtime-event.v0.2-candidate`, `helm.simulation-report.v0.2-candidate`.

### 9.2 Command 전이 표 (`src/kernel.mjs` `transition(command, state)`)

공통: 순수 함수. 입력은 command와 현재 workspace projection(state). 반환 `{status, code?, reasons?, missing?, affectedRefs?, events?: [{type, subjectRefs, payload, authorityBasis?}]}`. 검증 실패는 `ContractError(code)`를 던지고 `rejectionFrom`이 code가 `conflict.`로 시작하면 `conflict`, 아니면 `rejected`로 바꾼다. `requireHuman`은 actor.kind가 human이 아니면 `{status: needs_gate, code, missing: ['authority:human']}`.

| Command | 행위자 조건 | 선행 조건·검증 | 결과 Event와 payload |
|---|---|---|---|
| `authority.grant` | human 아니면 `needs_gate` `gate.human_authority_grant_required` | `grantRef` 중복이면 `conflict.authority_grant_exists`. `expiresAt`은 ISO이며 `issuedAt` 이후. 필수: grantRef, granteeActorId, purpose, actionClasses[], maxEffectClass(R0~R4), resourceScopes[], expiresAt, stopConditions[], sourceInstructionRef | `governance.authority.granted`, subjectRefs `[grantRef, granteeActorId]`, payload = grant 필드 전부 |
| `legacy.choice.capture` | actor.kind `migration`이고 authorityBasis에 `migration:experimental-jsonl` 포함. 아니면 `rejected` `denied.legacy_import_authority` | choiceRef 중복이면 `conflict.choice_exists`. summary, rationale, alternatives(빈 배열 허용), source(object) | `migration.legacy_choice.captured`, payload `{choiceRef, summary, rationale, alternatives, source, captureState: structural, qualification: unqualified, baselineStatus: proposed}` |
| `choice.open` | 누구나 | choiceRef 중복 `conflict.choice_exists`. summary, rationale, alternatives(1개 이상) | `normative.choice.opened`, 위와 같은 품질 필드, `source` 또는 null |
| `choice.qualify` | 누구나 | Choice 없음 `not_found.choice`. `baselineStatus`가 proposed이고 `qualification`이 unqualified가 아니면 `conflict.choice_not_qualifiable`. qualificationBasis 5필드: sourceRefs[], scope, evidenceRelation, accountableAcceptor, reviewTrigger | `normative.choice.qualified`, subjectRefs `[choiceRef, ...sourceRefs]`, payload `{choiceRef, qualificationBasis}` |
| `choice.commit` | qualification 확인 뒤 human 아니면 `needs_gate` `gate.human_choice_required` | qualified 아니면 `rejected` `policy.choice_qualification_required`(missing `qualification`) | `normative.choice.committed`, payload `{choiceRef, acceptedQualificationSequence: choice.lastSequence}` |
| `agreement.offer` | 누구나 | agreementRef 중복 `conflict.agreement_exists`. 필수: result, allowed[], notAllowed[], evidence[], acceptanceCriteria[], stopConditions[]. 선택 requestedAuthority{granteeActorId, actionClasses[], maxEffectClass, resourceScopes[]} | `normative.agreement.offered`, payload = 위 필드 |
| `agreement.accept` | human 아니면 `needs_gate` `gate.human_agreement_required` | Agreement 없음 `not_found.agreement`, status가 offered 아니면 `conflict.agreement_not_offered` | `normative.agreement.accepted`, payload `{agreementRef, acceptanceMode: direct-human, accountableActorId, activatedBy, authorityGrantRef: null}` |
| `agreement.activate` | actor.kind `agent`여야(아니면 missing `actor:agent`) | offered 상태. 아래 포함 검사(§9.2.1). 하나라도 missing이면 `needs_gate` `gate.work_agreement_authority_required` | `normative.agreement.accepted`, subjectRefs `[agreementRef, grantRef]`, payload `{agreementRef, acceptanceMode: delegated-authority, authorityGrantRef, accountableActorId: grant.grantedBy, activatedBy: agent}`, authorityBasis = command.authorityBasis + grantRef |
| `agreement.renegotiate` | human 아니면 `needs_gate` `gate.human_steering_required` | status active 아니면 `conflict.agreement_not_active`. acceptanceCriteria[], reason | `normative.agreement.renegotiated`, payload `{agreementRef, previousRevision, acceptanceCriteria, reason}` |
| `completion.submit` | 누구나 | Agreement active 아니면 `conflict.agreement_not_active`. completionRef 중복 `conflict.completion_exists`. `criteriaResults`(object)가 현재 revision의 acceptanceCriteria를 모두 키로 가져야. 빠지면 `rejected` `policy.completion_evidence_incomplete`(missing = 빠진 기준). evidenceRefs(1개 이상), limitations(빈 배열 허용) | `epistemic.completion.submitted`, subjectRefs `[completionRef, agreementRef, ...evidenceRefs]`, payload `{completionRef, agreementRef, agreementRevision, criteriaResults, evidenceRefs, limitations}` |
| `result.accept` | human 아니면 `needs_gate` `gate.human_result_acceptance_required`("Passing evidence is a Completion Claim, not user Acceptance.") | Completion 없음 `not_found.completion`, submitted 아니면 `conflict.completion_not_submitted`. remainingObligations(빈 허용) | `normative.result.accepted`, payload `{completionRef, remainingObligations}` |
| `integration.start` | 누구나 | Completion이 accepted 아니면 `rejected` `policy.result_acceptance_required`(missing `result.accept`). 같은 completion의 Integration이 있으면 `conflict.integration_exists`. obligations(빈 허용) | `normative.integration.started`, payload `{completionRef, obligations}` |
| `integration.complete` | 누구나 | Integration이 in_progress 아니면 `conflict.integration_not_active`. obligations 중 transferredObligations에 없는 것이 있으면 `rejected` `policy.integration_obligation_unresolved`(missing = 미해결) | `normative.integration.completed`, payload `{completionRef, transferredObligations}` |

#### 9.2.1 `agreement.activate` 권한 포함 검사 알고리즘

```text
grant = active grant with ref == payload.authorityGrantRef
missing = []
if actor.kind != agent:                    missing += "actor:agent"
if grant 없음:                              missing += "authorityGrant:<ref>"
if agreement.requestedAuthority 없음:       missing += "agreement.requestedAuthority"
if grant and grant.expiresAt <= command.issuedAt: missing += "authorityGrant:not_expired"
if grant and grant.granteeActorId != actor.actorId: missing += "granteeActorId:<actorId>"
if grant and request:
  if request.granteeActorId != actor.actorId:     missing += "requestedAuthority.granteeActorId"
  for a in request.actionClasses not in grant.actionClasses: missing += "actionClass:<a>"
  if rank(request.maxEffectClass) > rank(grant.maxEffectClass): missing += "effectClass<=<grant.max>"
  for s in request.resourceScopes not covered by any grant scope: missing += "resourceScope:<s>"
  for c in grant.stopConditions not in agreement.stopConditions: missing += "stopCondition:<c>"
missing 비어 있지 않으면 needs_gate(gate.work_agreement_authority_required, reasons, missing)
```

scope 포함(`scopeCovers`): 같으면 포함, granted가 `**`로 끝나면 그 앞부분으로 시작하는 requested 포함, 그 외 불포함. effect rank R0=0 … R4=4.

### 9.3 결과 코드 카탈로그 (실행 후보 전체) [해석: 모음]

| 계층 | 코드 |
|---|---|
| 계약 검증(`contracts.mjs`) | `invalid.command`, `invalid.command_schema`, `invalid.command_type`, `denied.projection_is_derived`(type이 `projection.`으로 시작), `invalid.observation_schema`, `invalid.observation` |
| Kernel 전이 | `gate.human_authority_grant_required`, `gate.human_choice_required`, `gate.human_agreement_required`, `gate.work_agreement_authority_required`, `gate.human_steering_required`, `gate.human_result_acceptance_required`, `denied.legacy_import_authority`, `policy.choice_qualification_required`, `policy.completion_evidence_incomplete`, `policy.result_acceptance_required`, `policy.integration_obligation_unresolved`, `not_found.choice`, `not_found.agreement`, `not_found.completion`, `conflict.authority_grant_exists`, `conflict.choice_exists`, `conflict.choice_not_qualifiable`, `conflict.agreement_exists`, `conflict.agreement_not_offered`, `conflict.agreement_not_active`, `conflict.completion_exists`, `conflict.completion_not_submitted`, `conflict.integration_exists`, `conflict.integration_not_active`, `invalid.internal_event_type` |
| Kernel 공통 | `denied.adapter_cannot_append_event`, `invalid.workspace`, `conflict.idempotency_key_reuse`, `conflict.expected_cursor_mismatch`, `conflict.external_observation_changed`, `observation.captured`(성공 code), `unsupported.profile`, `invalid.trusted_events`, `invalid.trusted_event` |
| SQLite | `invalid.stored_event_hash`, `invalid.stored_event_columns` |
| Protocol | `invalid.protocol_request`, `invalid.protocol_method`, `adapter.missing_protocol_methods`, `adapter.missing_kernel_boundary`, `adapter.contract_conformant` |
| Runtime | `runtime.not_running`, `runtime.steering_queued`, `runtime.cancellation_deferred`, `runtime.cancellation_requested`, `runtime.invalid_state`, `runtime.external_abort`, `runtime.context_compilation_failed`, `runtime.cancelled`, `runtime.provider_failed`, `runtime.tool_call_limit`, `runtime.duplicate_tool_call_id`, `runtime.tool_interrupted_by_steering`, `runtime.cancelled_during_tool`, `runtime.tool_outcome_uncertain`, `runtime.cancelled_after_atomic_tool`, `runtime.ineligible_gate`, `runtime.provider_stalled`, `runtime.step_limit`, `runtime.no_uncertain_tool`, `runtime.tool_call_id_mismatch`, `runtime.invalid_recovery_resolution`, `runtime.tool_recovery_recorded`, `runtime.no_open_gate`, `runtime.gate_id_mismatch`, `runtime.stale_gate`, `gate.<decision>`(거절 등), `runtime.unknown_tool`, `runtime.invalid_tool_arguments`, `runtime.tool_failed` |
| Provider | `provider.transport_failed`, `provider.http_error`, `provider.incomplete_response`, `provider.invalid_function_arguments`, `provider.mixed_output`, `provider.empty_output`, `provider.invalid_structured_output` |

[해석] 거부 세 갈래 대응: `invalid.*`, `policy.*`, `not_found.*`, `conflict.*`(상태) → 내용. `gate.human_*`, `gate.work_agreement_authority_required`, `denied.legacy_import_authority`, `runtime.unknown_tool` → 자격. `denied.adapter_cannot_append_event`, `denied.projection_is_derived` → 경로.

### 9.4 `CandidateKernel` 처리 순서 (in-memory)

생성자: `workspaceId`, `profile`(guided만 허용, 아니면 `unsupported.profile`), `clock`(주입), `trustedEvents`(replay용. 각 Event의 schema·workspaceId·sequence = index+1·type이 맞지 않으면 `invalid.trusted_event`).

`submitAdapterMessage(message)`: schema가 Event schema이거나 `.event.`를 포함하면 `denied.adapter_cannot_append_event`. Observation schema면 `submitObservationCandidate`, 아니면 `submitCommand`.

`submitCommand(command)`:
1. `validateCommand`(실패 시 rejected/conflict)
2. workspaceId 불일치 → `invalid.workspace`
3. inbox key = `adapterId|actorId|idempotencyKey`. 이전 기록이 있으면 지문(`commandFingerprint`: schema, commandId, workspaceId, type, actor, authorityBasis, expectedCursor, idempotencyKey, issuedAt, payload, provenance의 JSON) 비교. 다르면 `conflict.idempotency_key_reuse`, 같으면 이전 결과 `replayed: true`
4. `expectedCursor != cursor` → `conflict.expected_cursor_mismatch`, `rebase = brief()`
5. `transition(command, state())`. 예외는 rejection으로
6. status가 accepted가 아니면 결과 반환(이 경우 in-memory inbox에 저장하지 않는다)
7. 생성 Event: sequence = cursor + i + 1, `eventId = evt:<workspaceId>:<sequence>`, `recordedAt = clock()`, `effectiveAt = command.issuedAt`, `actorId`, `authorityBasis`(spec 우선), `subjectRefs`, `payload`, `provenance = command.provenance`, `causationId = commandId`, `correlationId = provenance.externalRunId || null`. Event는 freeze
8. 결과를 inbox에 저장하고 반환

`submitObservationCandidate(observation)`: 검증 → workspace 확인 → inbox key `adapterId|source.externalId`, 지문 다르면 `conflict.external_observation_changed`, 같으면 replay → Event `epistemic.observation.captured`(`effectiveAt = observedAt`, `actorId = observer.actorId`, `authorityBasis = ['observation:<observer.kind>']`, payload `{observationId, kind, observation, source}`, `causationId = observationId`) → 결과 code `observation.captured`.

[해석] expectedCursor는 Command마다 필수다. 따라서 모든 쓰기가 낙관적 동시성 대상이며, client는 매 쓰기 전에 `workspace().sourceCursor`를 조회한다(`client.mjs`).

### 9.5 Projection 알고리즘 (`src/projection.mjs`)

`projectWorkspace(events)`: Event를 순서대로 접는다.

| Event | 효과 |
|---|---|
| `governance.authority.granted` | authorityGrants에 `{ref, status: active, grantedBy: actorId, granteeActorId, purpose, actionClasses, maxEffectClass, resourceScopes, expiresAt, stopConditions, sourceInstructionRef, sourceSequence}` |
| `epistemic.observation.captured` | observations에 `{ref: observationId, kind, subjectRefs, payload, source, sourceSequence}` |
| `normative.choice.opened`, `migration.legacy_choice.captured` | choices에 `{ref, summary, rationale, alternatives, source, captureState: structural, qualification: unqualified, baselineStatus: proposed, qualificationBasis: null, acceptedBy: null, acceptedAt: null, sourceSequence, lastSequence}` |
| `normative.choice.qualified` | qualification = qualified, qualificationBasis 저장 |
| `normative.choice.committed` | 기존 accepted Choice 모두 superseded, 이 Choice accepted, acceptedBy = actorId, acceptedAt = recordedAt |
| `normative.agreement.offered` | agreements에 `{ref, revision: 1, status: offered, result, allowed, notAllowed, evidence, acceptanceCriteria, stopConditions, requestedAuthority}` |
| `normative.agreement.accepted` | status active, acceptanceMode, acceptedBy(accountableActorId), activatedBy, authorityGrantRef |
| `normative.agreement.renegotiated` | previousRevision = 현재 복사본(status stale), revision + 1, status active, acceptanceCriteria 교체, changeReason, acceptedBy |
| `epistemic.completion.submitted` | completions에 `{ref, agreementRef, status: submitted, criteriaResults, evidenceRefs, limitations, submittedBy}` |
| `normative.result.accepted` | status accepted, acceptedBy, remainingObligations |
| `normative.integration.started` | integrations에 `{completionRef, status: in_progress, obligations}` |
| `normative.integration.completed` | status complete, transferredObligations |

파생 값:
- `activeChoice` = qualification qualified이고 baselineStatus accepted인 마지막 Choice(없으면 null)
- `attention` = unqualified Choice마다 `choice.unqualified`("Captured Choice is not qualified and cannot be an active baseline."), submitted Completion마다 `completion.awaiting_acceptance`, accepted인데 Integration이 complete가 아닌 Completion마다 `result.awaiting_integration`
- `blindSpots` = activeChoice 없으면 `active_choice`, unqualified Choice가 있으면 `choice_qualification`
- 출력 schema `helm.projection.workspace.v0.2-candidate`: `workspaceId`, `sourceCursor`(마지막 sequence, 없으면 0), `activeChoice`, `observations`, `authorityGrants`, `choices`, `agreements`, `completions`, `integrations`, `attention`, `blindSpots`

`projectBrief`: schema `helm.projection.brief.v0.2-candidate`, `policyVersion: guided.v0.2-candidate`, `latestAcceptedChoice{ref, summary, acceptedBy}`|null, `attention`, `blindSpots`, `completionState[{ref, status}]`, `integrationState[{completionRef, status}]`.

[해석] Grant 만료·폐기 상태 변화, Choice의 stale/contested, Observation의 품질 상태는 projection에 없다. Brief에 Goal/Concern/next valid action이 없다(Run 001 측정에서 "next valid action recovery: not yet modeled").

### 9.6 SQLite 커널 트랜잭션 방식 (`src/sqlite-kernel.mjs`)

설정: `DatabaseSync`, `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`. DB 파일 디렉터리 자동 생성.

DDL(원문 요약):

| 테이블 | 열 | 키·제약 |
|---|---|---|
| `schema_migrations` | `version` INTEGER, `applied_at` TEXT | PK version |
| `workspaces` | `workspace_id`, `profile`, `created_at` | PK workspace_id |
| `events` | `workspace_id`, `sequence`, `event_id`(UNIQUE), `event_type`, `causation_id`, `event_json`, `previous_hash`, `event_hash` | PK (workspace_id, sequence), FK workspaces |
| `commands` | `workspace_id`, `scope_key`, `command_id`, `fingerprint`, `request_json`, `result_json`, `recorded_at` | PK (workspace_id, scope_key), FK workspaces |
| `observation_inbox` | 같은 구조 + `observation_id` | PK (workspace_id, scope_key) |
| `outbox` | `outbox_id` AUTOINCREMENT, `workspace_id`, `sequence`, `event_type`, `payload_json`, `delivered_at` | UNIQUE (workspace_id, sequence), FK → events(workspace_id, sequence) |
| 인덱스 | `idx_events_causation(workspace_id, causation_id)`, `idx_outbox_pending(workspace_id, delivered_at, sequence)` | |

마이그레이션: version 1 = 위 DDL(`CREATE TABLE IF NOT EXISTS`) 후 `INSERT OR IGNORE`. version 2 = `migrateLedgerHashes`: `PRAGMA table_info(events)`로 `previous_hash`, `event_hash` 열이 없으면 `ALTER TABLE ADD COLUMN`, 해시가 비어 있는 기존 행을 workspace별 순서대로 채움. `initializeWorkspace`: 같은 workspace의 profile이 다르면 오류, 없으면 INSERT.

checksum chain: `event_hash = sha256(previous_hash || '' + '\n' + event_json)`. 읽기(`events()`)에서 행마다 기대 해시를 다시 계산해 `previous_hash`·`event_hash`가 다르면 `invalid.stored_event_hash`, envelope의 sequence·eventId·type·causationId가 열 값과 다르면 `invalid.stored_event_columns`.

Command 처리(`submitCommand`):

```text
validateCommand → 실패면 rejection (트랜잭션 밖)
workspace 불일치면 invalid.workspace (트랜잭션 밖, inbox 기록 없음)
scopeKey = adapterId|actorId|idempotencyKey ; fingerprint
BEGIN IMMEDIATE
  prior = SELECT commands WHERE scope_key
  if prior: fingerprint 다르면 conflict.idempotency_key_reuse, 같으면 replayed 결과
  kernel = new CandidateKernel(trustedEvents = events())   # 매번 전체 replay
  before = kernel.cursor ; result = kernel.submitCommand(command)
  appended = kernel.events().slice(before)
  appendEvents(appended)  # events + outbox 행, 해시 체인 이어 붙임
  faultInjector('after_events_before_command_inbox')
  INSERT commands(scope_key, command_id, fingerprint, request_json, result_json, recorded_at)
COMMIT  (예외면 ROLLBACK)
```

Observation 처리도 같은 구조(`observation_inbox`, scope `adapterId|externalId`, fault 지점 `after_events_before_observation_inbox`).

outbox: `readOutbox({afterSequence, limit=100})`는 sequence 순, `markOutboxDelivered(sequence)`는 `delivered_at IS NULL`일 때만 갱신하고 변경 여부(true/false)를 반환. outbox payload는 `{eventId, sequence, type}`.

[해석] 관찰된 성질과 한계:
- 한 트랜잭션 안에 idempotency 검사, 상태 load(전체 replay), Kernel 전이, Event append, outbox append, inbox 결과가 모두 들어간다. kernel 후보 §16의 6단계 중 5단계(critical projection 갱신)는 projection table이 없어서 빠졌다.
- in-memory Kernel과 달리 SQLite는 accepted가 아닌 결과(`rejected`, `needs_gate`, cursor `conflict`)도 `commands`에 저장한다. 같은 idempotency key로 재시도하면 그 거부 결과가 replay된다. 새 cursor로 다시 보내려면 새 key가 필요하다. 설계에서 정할 점이다.
- 매 Command마다 전체 Event를 읽어 replay하므로 이벤트 수에 비례해 느려진다. snapshot/checkpoint가 필요하다(kernel 후보 §16 `projection_checkpoints`).
- 두 connection의 동시성은 `BEGIN IMMEDIATE`(쓰기 lock)와 expectedCursor로 처리한다.

### 9.7 Legacy migration (`src/migration.mjs`)

`planLegacyImport(events, {workspaceId, sourcePath='.helm/events.jsonl', actorId='migration:legacy-jsonl', issuedAt, startingCursor=0, lineOffset=0})`:
- `sourceHash = sha256(JSON.stringify(events))`
- `normative.decision.committed`가 아닌 Event는 `ignored`에 `{source, reason: 'outside candidate vertical slice'}`
- Decision마다: `choiceRef = choice:legacy:<eventId>`, `ambiguities`에 `{source, code: 'legacy.commitment_cannot_prove_qualification_or_acceptance', disposition: 'capture_as_unqualified', choiceRef}`, Command `legacy.choice.capture`(actor kind `migration`, sessionId `session:legacy-import`, runtime `helm-importer`, authorityBasis `['migration:experimental-jsonl']`, expectedCursor 순차 증가, idempotencyKey `legacy-event:<id>`, payload `{choiceRef, summary, rationale, alternatives, source}`, provenance `{adapterId: adapter:legacy-jsonl-importer, externalRunId: guided-001, sourceRefs: [id], sourceHash}`)
- `source` = `{schema, eventId, eventType, sourcePath, line}`
- 반환 `{schema: helm.migration-report.v0.2-candidate, sourcePath, sourceHash, sourceEventCount, plannedCommandCount, ignored, ambiguities, commands}`

### 9.8 Protocol과 adapter (`src/protocol.mjs`)

`KernelProtocolHost.handle(request)`: envelope schema가 다르면 `invalid.protocol_request`. requestId·method·params가 없거나 method가 목록 밖이면 `invalid.protocol_request`. 메서드:
- `helm.handshake` → `{schema: helm.adapter-handshake.v0.2-candidate, protocolVersion: 'v0.2-candidate', kernelProfile, commandSchemas: ['helm.command.v0.2-candidate'], observationSchemas: ['helm.observation-candidate.v0.2-candidate'], projectionSchemas: [brief, workspace], methods: [5개], invariants: ['adapter-cannot-append-events', 'projection-is-derived', 'expected-cursor-required', 'guided-human-gates']}`
- `helm.command.submit`, `helm.observation.submit` → `kernel.submitAdapterMessage(params.message)` (둘 다 같은 함수로 들어감)
- `helm.query.brief`, `helm.query.workspace`

`BaseAdapter`: requestId `req:<adapterId>:<ordinal>`, `describeCapability()`, `unwrap`(ok가 아니면 throw), `handshake`, `submit`, `observe`, `brief`, `workspace`. `DirectAdapter`(runtime `first-party-test-runtime`, transport `in-process-object`, levels A enforced, B/C/D unavailable, 요청을 structuredClone해 host에 전달). `JsonlRpcAdapter`(runtime `generic-jsonl-rpc-test-runtime`, transport `jsonl-request-response`, A enforced, B advisory, C/D unavailable, 요청·응답을 JSON 한 줄로 직렬화·역직렬화).

`assertAdapterConformance(adapter)`: handshake의 methods에 필수 5개가 없으면 `adapter.missing_protocol_methods`, invariants에 `adapter-cannot-append-events`가 없으면 `adapter.missing_kernel_boundary`, 아니면 `adapter.contract_conformant`.

### 9.9 Typed client (`src/client.mjs`)

내부 command·observation 생성기는 `WeakMap`(`internals`)에 숨겨 인스턴스 속성으로 보이지 않게 했다. Command 생성: `commandId = idFactory('cmd')`, `expectedCursor = 지정값 ?? adapter.workspace().sourceCursor`, `idempotencyKey = 지정값 || commandId`, `issuedAt = clock()`, provenance `{adapterId, externalRunId: actor.sessionId, sourceRefs: []}`.

| client | actor.kind | 메서드 |
|---|---|---|
| `AgentHelmClient` | agent 또는 tool | `observe`, `openChoice`, `qualifyChoice`, `offerAgreement`, `activateAgreement`, `submitCompletion`, `startIntegration`, `completeIntegration` (+ `handshake`, `brief`, `workspace`) |
| `HumanHelmClient` | human | `grantAuthority`, `commitChoice`, `acceptAgreement`, `renegotiateAgreement`, `acceptResult` (+ 조회) |

`createHelmClients({adapter, workspaceId, sessionId, clock, idFactory, humanActorId='human:local', agentActorId='agent:helm-cli'})`: agent actor runtime `helm-agent-runtime`, authorityBasis `['session:<sessionId>']`. human actor runtime `helm-cli`, authorityBasis `['direct-user-input']`. Kernel이 여전히 권한을 검사하므로 client 분리는 사용성 방어다.

### 9.10 Context 컴파일 (`src/context.mjs` `compileProviderContext`)

입력: `workspace`, `brief`, `history`(runtime 기록), `openGate`, `profile='guided'`, `maxChars=12000`(정수 ≥ 2048이 아니면 `ContextBudgetError`).

```text
stats = {redactedFields: 0, truncatedFields: 0}
compact(value):  # 재귀
  key가 SECRET_KEY 정규식((^|_)(secret|password|passwd|token|api[_-]?key|credential|private[_-]?key)($|_), i)에 맞으면 '[REDACTED]', redacted++
  문자열 > 500자 → 앞 480자 + '…[truncated:<len>]', truncated++
  depth ≥ 6 → '[depth-limited]', truncated++
  배열 → 앞 20개 + '[N items omitted]'(truncated++)
  객체 → key 정렬, 앞 40개 + '$omittedKeys'(truncated++)
userEntries = history 중 role user이고 kind ∈ {message, steering, gate-decision, tool-recovery}
toolEntries = kind tool-results ; assistantEntries = kind visible-block
document(필수 절) = {schema, workspaceId, sourceCursor, profile, policyVersion: 'context.guided.v0.2-candidate',
  orientation: {activeChoice, blindSpots}, activeWork: active agreements, attention, openGate,
  userDirectives: 최근 6개 userEntries, recentToolResults: 최근 4개 toolEntries, 선택 절은 빈 배열, includedRefs, omitted, budget}
maxPayloadChars = maxChars - 900   # metadata 예약
if JSON 크기(document) > maxPayloadChars: throw ContextBudgetError('Required semantic context exceeds…')   # fail-closed
pushOptional 순서(우선순위 높은 것부터):
  authorityGrants(category authority-grants)
  recentObservations = 최근 12개 역순(older-observations)
  completionAndIntegration = completions + integrations(completion-integration-history)
  choiceCandidates = activeChoice 외 Choice(non-active-choice-history)
  providerNotes = 최근 4개 visible-block(provider-narration)
  각 절: 항목을 하나씩 넣다가 크기 초과 시 마지막 항목 빼고 omitted에 {category, count: 남은 수, reason: 'context-budget'} 추가 후 중단
includedRefs = 문서 안에서 key가 'ref'이거나 'Ref'로 끝나는 문자열 값의 정렬 목록
budget.usedChars = JSON 크기(고정점까지 반복), approximateTokens = ceil(usedChars/4)
if usedChars > maxChars: throw ContextBudgetError
```

### 9.11 First-party Agent Runtime (`src/agent-runtime.mjs`)

`RuntimeToolRegistry.register({name, description, inputSchema, effectClass='R0', cancellation='cooperative', authorityEnforcement='runtime', strict=false, execute})`: 이름 중복·enum 밖 값 거부. `definitions()`는 execute를 뺀 정의. `execute(call, {signal})`: 없는 도구 → `rejected runtime.unknown_tool`, 입력 검증 실패 → `rejected runtime.invalid_tool_arguments`(자체 미니 JSON Schema 검증기: anyOf, enum, const, null, string(minLength, maxLength, date-time), array(minItems, items), object(required, additionalProperties false, properties)), `UncertainToolOutcomeError` → `uncertain runtime.tool_outcome_uncertain`(recoveryCheck, externalRef), 기타 예외 → `failed runtime.tool_failed`, 성공 → `completed` + output.

`createHelmRuntimeTools(agent)`: 도구 10개 모두 `strict: true`, 입력은 닫힌 객체. 조회 2개는 R0/immediate/kernel, 쓰기 8개는 R1/atomic/kernel. `helm_submit_observation` 입력 `{observationId, kind, observedAt, subjectRefs, summary, detailsJson(string|null), externalId, contentHash}` → payload `{summary, details}`. `helm_open_choice` 입력의 `source`는 `{kind, ref}`. `helm_submit_completion`의 `criteriaResults`는 `[{criterion, status}]` 배열을 object map으로 변환.

`FirstPartyAgentRuntime` 상태: `idle`, `running`, `awaiting_user`, `awaiting_recovery`, `cancelled`, `failed`. 기본 한도 `maxSteps=12`, `maxToolCalls=32`, `maxContextChars=12000`.

`run(userMessage)` 알고리즘:

```text
state idle 아니면 rejected runtime.invalid_state
state = running ; history += {user, message}
for step in 1..maxSteps:
  외부 signal abort면 cancelled
  steeringQueue를 모두 history에 {user, steering}으로 옮기고 steering.applied
  context = contextCompiler(workspace, brief, history, openGate) ; 실패면 failed runtime.context_compilation_failed
  activeOperation = provider(cooperative) ; provider.next({schema: helm.provider-context…, runId, step, context, tools: definitions})
  예외: steering 대기 중이면 provider.interrupted, step 되돌리고 continue ; abort면 cancelled ; 그 외 failed runtime.provider_failed
  validateProviderTurn: tool call과 gate/finish 동시 금지, gate와 finish 동시 금지, finish는 'yield'만, block kind는 4개만, block에 label 필드 금지
  cancelPending이면 cancelled
  blocks → 터미널 제어문자 제거 후 ui.block(label은 runtime이 kind로 결정)
  toolCalls가 있으면:
    총 호출 수가 maxToolCalls 초과면 failed runtime.tool_call_limit
    각 call: 이미 본 ID면 failed runtime.duplicate_tool_call_id
      tool.started(effectClass, cancellation, authorityEnforcement)
      cancellation이 immediate/cooperative면 abort 가능한 signal, atomic/none이면 abort 안 되는 signal
      실행 예외: steering 대기면 interrupted 결과 기록 후 루프 재시작 ; cancel이면 cancelled_during_tool
      결과 uncertain → state awaiting_recovery, 반환
      cancel 대기면 cancelled_after_atomic_tool ; steering 대기면 남은 call 건너뛰고 재시작
    history += {tool, tool-results} ; continue
  gate가 있으면: eligibleGate(현재 workspace) 아니면 failed runtime.ineligible_gate
    openGate = {gateId: gate:<runId>:<step>, kind, subjectRef, question, sourceCursor} ; state awaiting_user ; 반환
  finish yield → state idle, run.yielded
  그 외 → failed runtime.provider_stalled
step 초과 → failed runtime.step_limit
```

`steer(message)`: running이 아니면 거부. 큐에 넣고, 현재 operation이 atomic/none이면 `steering.deferred`, 아니면 abort. `cancel()`: cancelPending, atomic/none이면 `cancellation.deferred`(`runtime.cancellation_deferred`), 아니면 abort(`runtime.cancellation_requested`).

`resolveGate({gateId, decision, remainingObligations})`: awaiting_user와 gateId 확인. decision이 accept가 아니면 Gate를 닫고 idle, `declined` `gate.<decision>`. accept면 현재 cursor가 Gate의 sourceCursor와 같고 여전히 eligible인지 확인(아니면 `conflict runtime.stale_gate`, 상태는 awaiting_user 유지), Human client로 kind별 `commitChoice`/`acceptAgreement`/`acceptResult`를 `expectedCursor = gate.sourceCursor`로 호출. 쓰기 실패면 `gate.write_failed`.

`resolveUncertainTool({toolCallId, resolution, evidenceRef})`: awaiting_recovery이고 ID가 같아야. resolution ∈ `confirmed_applied`, `confirmed_not_applied`, `manual_review`. history에 `{user, tool-recovery}`, idle로.

[해석] 런타임 상태는 모두 메모리에 있다(history, openGate, steeringQueue, uncertainTool). 프로세스가 죽으면 열린 Gate와 불확실 도구 상태가 사라진다. 브리프 결정 30(실행 의도 → 실행 → 결과 기록, 재시작 시 "중단됨" 정리)이 메울 공백이다.

### 9.12 OpenAI provider 계약 (`src/providers/openai-responses.mjs`)

생성자: `apiKey`(private `#apiKey`, 필수), `model`(필수), `fetchImpl`, `baseUrl`(기본 `https://api.openai.com/v1`), `instructions`(기본 아래), `maxOutputTokens`(기본 2000), `onUsage`.

기본 instructions(원문):

```text
You are the inference component inside Helm's first-party Agent Runtime.
The supplied HELM_CONTEXT_JSON is a cursor-bound projection, not a raw transcript.
Use only the provided function tools for semantic writes and queries.
You cannot accept a Choice, Work Agreement, or Result; request a Gate instead.
Never claim that provider text is an Observation, accepted Choice, Completion, or Integration state.
When calling tools, emit function calls only. Otherwise return the required JSON turn shape.
Use concise user-facing language and preserve uncertainty.
```

요청 body: `model`, `store: false`, `truncation: 'disabled'`, `parallel_tool_calls: false`, `max_output_tokens`, `instructions`, `input: "HELM_CONTEXT_JSON\n" + JSON(context)`, `tools`(각 도구 `{type: function, name, description: 설명 + " Effect Rx; cancellation y; authority z.", parameters: inputSchema, strict}`), `tool_choice: 'auto'`, `text.format: {type: json_schema, name: helm_provider_turn, strict: true, schema: TURN_FORMAT_SCHEMA}`, `metadata: {helm_run_id, helm_context_cursor}`(각 512자 상한). 헤더 `authorization: Bearer <key>`, `content-type: application/json`. POST `<baseUrl>/responses`, signal 전달.

TURN_FORMAT_SCHEMA: `schema`(const), `blocks`(maxItems 6, 각 lines minItems 1 maxItems 8, 줄 maxLength 800), `gate`(null 또는 question maxLength 800), `finish`(null 또는 'yield'). toolCalls는 포함하지 않는다(함수 호출은 output item으로 받음).

응답 처리: fetch 예외는 abort면 그대로, 아니면 `provider.transport_failed`. `!ok`면 `provider.http_error`(status만). `status != completed`면 `provider.incomplete_response`(responseId, incomplete_details). usage는 `onUsage`로. function_call 항목 파싱(JSON 오류·객체 아님 → `provider.invalid_function_arguments`). call과 message text가 함께 있으면 `provider.mixed_output`. call만 있으면 `{schema, blocks: [], toolCalls, gate: null, finish: null}`. text가 비면 `provider.empty_output`. JSON 파싱 실패면 `provider.invalid_structured_output`. 성공이면 `{...turn, toolCalls: []}`.

### 9.13 Experience harness (`src/experience.mjs`)

`LinearTranscript.add(label, lines, {status})`, `render()`는 `label · status` 제목과 `- ` 목록. `Guided001ExperienceHarness` phase: `idle → oriented → awaiting_choice → working → awaiting_review → closed`. 단계 함수와 Kernel 호출:
- `orient(prompt)`: Helm/Observed/Working frame 블록, human `grantAuthority`(grantRef `authority:guided-001`, actions 4개, R1, `workspace:**`, 만료 2026-08-23T01:00Z, stop 2개, source `user-message:guided-001:initial`), agent `observe`(kind `repository.defect`)
- `inquireAndOpenChoice()`: Possible 블록(4개), agent `openChoice`, `qualifyChoice`(accountableAcceptor `human:founder`), Choice 블록(needs your judgment)
- `acceptChoiceAndBeginWork()`: human `commitChoice`, You·Impact 블록, agent `offerAgreement`(requestedAuthority scope `workspace:docs/**`, `workspace:experiments/helm-kernel-v02/**`), agent `activateAgreement`, Work Agreement 블록
- `submitCompletion({suitePassed, suiteCount, limitations})`: suitePassed가 true가 아니면 예외, Working 블록, agent `observe`(kind `test.result`), agent `submitCompletion`, Completion Claim·Result Review 블록
- `conditionallyAcceptAndIntegrate(obligation)`: human `acceptResult`(remainingObligations), You 블록, agent `startIntegration`, `completeIntegration`(transferred), Integration 블록

`bin/simulate-guided-001.mjs`는 같은 흐름을 Kernel Command로 직접 보내고 보고서(`helm.simulation-report.v0.2-candidate`: scenario, runtime `codex-baseline`, profile, outcome, sourceDefect{eventId, sourceLine, sourceHash, disposition}, gates[{code, timing}], `approvalTheaterQuestions: 0`, eventCount, eventTypes, afterLegacyImport, final)를 JSON으로 출력한다. 이 bin은 `agreement.accept`를 human으로 직접 수행한다(Grant 경로가 아님).

### 9.14 테스트가 확인하는 불변조건 목록 (57개) [실험: 57 pass]

| 파일 | 테스트(요지) | 확인하는 불변조건 |
|---|---|---|
| contracts (2) | JSON Schema 9개가 파싱되고 Draft 2020-12, `$id`가 `helm.`로 시작, type object | 계약 파일 형식 |
| | Command·Event enum이 실행 상수와 일치, event 설명에 output-only, expectedCursor minimum 0 | 스키마와 코드의 어휘 일치 |
| guided-001 (9) | F1 garbage legacy Decision: 계획 1개, disposition `capture_as_unqualified`, line 99, import 후 summary `ㅇ`, unqualified, latestAcceptedChoice null, blindSpots `[active_choice, choice_qualification]`, attention `choice.unqualified`, source eventId 보존 | 낮은 품질 입력은 보이되 baseline이 되지 않음 |
| | F2 `projection.next_action.proposed` → `denied.projection_is_derived`, cursor 0 | projection 어휘는 쓰기 불가 |
| | F3 Event envelope 제출 → `denied.adapter_cannot_append_event`, cursor 0 | adapter는 Event append 불가 |
| | F4 같은 expectedCursor 두 Command → 둘째 `conflict.expected_cursor_mismatch`, cursor 1, rebase.sourceCursor 1, Choice 1개 | last-write-wins 없음 |
| | qualified Choice에 agent commit → `needs_gate gate.human_choice_required`, cursor 2 유지, human commit 후 latestAcceptedChoice, blindSpots 빔 | Guided Choice는 human commit |
| | 같은 Command 재제출 → accepted, replayed true, eventSequences [1], cursor 1 | idempotent retry |
| | F5 human renegotiate → revision 2, 이전 revision stale·기준 보존, 옛 기준 Completion → `policy.completion_evidence_incomplete`, missing = 새 기준 | steering이 stale 기준 완료를 막음 |
| | F6 Completion submitted, Integration 없음, attention `completion.awaiting_acceptance`, agent accept → Gate, human accept → accepted(Integration 여전히 없음), start → in_progress, complete(transferred) → complete | 제출·수락·통합 분리 |
| | replay: `projectWorkspace(events)`·`projectBrief(events)`가 kernel.state()/brief()와 깊이 같음, sequence [1,2,3,4], `projection.` 타입 없음 | 결정적 replay |
| adapter-conformance (4) | direct·JSONL 각각: 적합성 accepted, profile guided, cursor 0, Observation 후 activeChoice null, open/qualify/human commit 후 cursor 4, 위조 Event 거부, cursor 4 유지 | 전송별 protocol 적합성 |
| | 두 전송의 정규화 projection과 의미 Event(sequence, type, effectiveAt, actorId, authorityBasis, subjectRefs, payload) 동일, provenance adapterId는 다름 | 전송 독립 의미, provenance 보존 |
| | Observation 재전송 replayed, cursor 1, effectiveAt = 관찰 시각, recordedAt = clock, 같은 external ID 다른 내용 → `conflict.external_observation_changed` | 시간 분리, observation idempotency |
| client (3) | agent는 open/qualify 가능, `commitChoice` 없음, human은 `openChoice` 없음, human commit 후 activeChoice | 역할별 typed surface |
| | agent observe → observations 1, activeChoice null, blindSpots `[active_choice]` | 관찰은 normative 승격 없음 |
| | 두 client에 `appendEvent`, `submitRaw`, `_command`, `_observation` 없음 | raw 경로 비노출 |
| authority (5) | 비확장 Agreement가 Grant로 활성화: active, `delegated-authority`, acceptedBy human:founder, activatedBy agent, authorityGrantRef, 마지막 Event authorityBasis에 grant 포함 | 포함 관계 증명 시 재질문 없음, 두 역할 provenance |
| | action/effect/resource 확대 → needs_gate, missing 3종, Agreement offered 유지 | 확대는 Gate |
| | stop condition 누락 → missing `['stopCondition:…']` | stop condition 보존 |
| | 만료 Grant → `authorityGrant:not_expired` | 만료 |
| | agent에 `grantAuthority` 없음, human에 `activateAgreement` 없음 | 자기 권한 생성 불가 |
| context (3) | 같은 입력 두 번 컴파일 결과 동일, sourceCursor 42, activeChoice·activeWork·attention 유지, 마지막 userDirective는 steering, usedChars ≤ max, redacted > 0, `must-not-leak` 없음, omitted 있음, includedRefs에 accepted choice | 결정성, 예산, 비밀 삭제 |
| | 작은 예산에서 steering과 tool result는 남고 providerNotes < 4, omitted에 `provider-narration` | 의미 우선순위 |
| | 필수 context가 2048자를 넘으면 `ContextBudgetError` | fail-closed |
| agent-runtime (14) | 도구 목록에 `helm_commit_choice`, `helm_accept_result` 없음, run → awaiting_user, activeChoice null, cursor 2, resolveGate accept → idle, activeChoice, 마지막 actor human:founder | provider는 제안, human이 Gate 해결 |
| | `helm_commit_choice` 요청 → tool result `runtime.unknown_tool`, cursor 0, run은 yield | 숨긴 권한 도구 |
| | 필수 필드 빠진 인자 → `runtime.invalid_tool_arguments`, "summary is required" | runtime 재검증 |
| | Gate 뒤 Observation으로 cursor 진행 → resolveGate `conflict runtime.stale_gate`, activeChoice null, state awaiting_user | cursor-bound Gate |
| | `safe\u0007 text` → `safe text`, label Helm, source provider | 터미널 출력 정화 |
| | block에 label `Observed` → failed `runtime.provider_failed`, Observed ui.block 없음, observations 0 | 라벨 위조 불가 |
| | provider가 받은 객체에 history·workspace·brief 키 없음, context.schema가 Context Projection, sourceCursor 0, userDirectives에 원문 | raw transcript 비전달 |
| | 계속 도구를 부르는 provider, maxSteps 2 → `runtime.step_limit` | 루프 한도 |
| | 대기 중 provider에 cancel → cancelled | 취소 |
| | 대기 중 provider에 steer → 두 번째 context의 userDirectives에 steering, `steering.applied` 이벤트 | steering 반영 |
| | 메타데이터: brief R0/immediate/kernel, open_choice strict, additionalProperties false, R1/atomic/kernel | 도구 effect 선언 |
| | cooperative 도구 실행 중 steer → `tool.interrupted`, 재개 context에 steering | cooperative 중단 |
| | atomic 도구 실행 중 cancel → `runtime.cancellation_deferred`, state running, 끝난 뒤 `runtime.cancelled_after_atomic_tool`, `tool.finished completed` | atomic 경계 존중 |
| | 불확실 외부 쓰기 → awaiting_recovery, `tool.outcome_uncertain`, `confirmed_applied` 기록 후 idle, history에 tool-recovery | 맹목 재시도 금지 |
| openai-provider (6) | 요청 mapping: URL, Bearer 헤더, body에 key 없음, model, store false, truncation disabled, parallel false, function tool strict, 설명에 "Effect R0", input에 cursor, json_schema strict, metadata cursor '7', usage 콜백 | 무상태·키 안전 요청 |
| | 구조화 메시지 → turn, block에 label 없음 | 표시 권한 없음 |
| | 잘못된 인자 JSON → `provider.invalid_function_arguments`, mixed → `provider.mixed_output` | fail-closed |
| | HTTP 429 → `provider.http_error`, 메시지·세부에 key 없음, incomplete → reason 보존 | 오류 시 비밀 비노출 |
| | model·apiKey 빈 값 생성자 오류 | 숨은 기본값 없음 |
| | mock Responses 3개 → awaiting_user, cursor 2, 요청 cursor ['0','1','2'], 모든 요청 도구에 commit/accept_result 없음, Gate accept 후 activeChoice, 응답 소진 | 전체 경로 |
| sqlite-kernel (9) | reopen 후 cursor 1, causationId, state, brief, schema_migrations max version 2 | 영속·replay·마이그레이션 |
| | reopen 후 같은 Command → replayed, eventSequences [1], cursor 1 | durable idempotency |
| | 두 connection 같은 cursor → 하나 accepted, 하나 conflict + rebase, events 1 | 프로세스 간 last-write-wins 없음 |
| | `after_events_before_command_inbox`에서 예외 → reopen 후 events·outbox·commands 0, 같은 Command 재제출 성공 | 원자성 |
| | event_json 직접 수정 → state() 시 `invalid.stored_event_hash` | 손상 fail-closed |
| | Observation reopen 후 replayed, observations 1, activeChoice null | durable observation idempotency |
| | 다른 workspace Command·Observation → `invalid.workspace`, 두 inbox 0행, cursor 0 | workspace 격리 |
| | outbox 1행(sequence 1, `normative.choice.opened`), afterSequence 1이면 0, mark true 다음 false, deliveredAt = clock | outbox 재개·idempotent 표시 |
| | DirectAdapter + SQLite host로 submit accepted, workspace·brief cursor 1 | 저장소 교체 후 protocol 동일 |
| experience (2) | 단계 진행과 phase, Completion 뒤 submitted·Integration 0, 출력에 라벨 8종, "needs your judgment" 정확히 2번, "May I continue/계속할까요" 없음 | Gate 수 상한, approval theater 문구 없음 |
| | idle에서 inquire 예외, oriented에서 submitCompletion 예외 | phase 상태 기계 |

### 9.15 실행 후보에 없는 것 [해석: 목록]

- Goal, Concern, WorkUnit 엔티티와 Command(`goal.*`, `concern.*`)
- Interpretation, Possibility, Claim, Evidence link, Finding 승격(`claim.*`, `evidence.*`). "발산은 지금까지 한 번도 생성된 적이 없다"(대화 L1613: 가능성 4개는 fixture에 미리 적힘)
- `choice.reopen`, `choice.supersede`(명시적), `agreement.release`, `run.attach`, `exception.raise`, `result.reject`, `completion.correction_request`, `integration.verify`, `integration.reopen`
- Grant 폐기·예산·겹침, Quick/Assured profile(생성자가 guided만 허용)
- 질문 레코드, 가정 만료, 혼자 정한 결정, 이의(브리프 결정 8, 12)
- projection checkpoint, 구독·재접속, 백업·복구
- durable runtime(Gate, steering, tool intent/outcome)

---

## 10. 실험·dogfood에서 확인된 교훈

번호는 이 문서 안 참조용이다. 각 항목에 근거 위치를 적는다.

| # | 교훈 | 근거 |
|---|---|---|
| L1 | **구현 우선 경고.** 다음 증거로 정한 지연 복귀(24h probe)는 결과 파일 없이 끝났고, paper-first를 지지한 직후 v0.2 커널·런타임·provider·SQLite 구현(하루 7 run)으로 넘어갔다. product-owner 검토 질문 3개(§4.4)도 답 없이 다음 run으로 갔다. 설계와 구현 계획은 "사람 증거를 얻는 관문"을 구현 단계 사이에 넣어야 한다 | dogfood 002 §9, 대화 L1619, 감사 §3.3, §4.4 |
| L2 | **모델이 초안, 사람은 반응.** 의미 입력이 병목이다. Git-only는 4개 영역 중 3개 unknown, 의미는 사람이 넣은 7개에서만 나옴, Inquiry Map 직접 수정 관찰 없음, 4,319단어 artifact 대신 한 문장으로 결정, 결정 입력이 `ㅇ`·`ㅁㄴㅇ`(빈칸 우회). recall보다 recognition이 쉽다. "이 원칙이 깨지면 다 맞아도 안 쓴다" | dogfood 001 §1, §4, fixture, 감사 §3.3, 대화 L1615~1617 |
| L3 | 형식 유효성과 의미 품질은 다르다. 필수 필드를 채웠다는 이유로 기준선이 되면 거짓 "blind spot 없음"이 나온다. capture / qualification / acceptance를 분리하고, 품질이 낮은 입력은 삭제하지 않고 주의 항목으로 보인다 | CLI-G01, Run 001, kernel 후보 §10 |
| L4 | Helm의 중심은 의미 쓰기 경로(semantic write path)에 둔다. material 수집은 저렴(0.09초)하고, 희소한 것은 기준 변경·믿음·약속·수락의 순간을 기록하는 일이다. dashboard는 그 결과를 보여 주는 투영이다 | dogfood 001 §6.1 |
| L5 | ledger만으로 인지 문제를 해결하지 못한다. 파일 56개를 56행으로 나열한 Brief는 정확하지만 나쁘다. 압축(최대 5 그룹)과 drill-down이 필요하고, grouping 기준은 경로보다 Concern/WorkUnit/Decision 영향이 낫다 | dogfood 001 §6.2, dogfood 002 89→5 |
| L6 | paper의 네 primitive(Brief, Inquiry Map, Contract, Gate)는 소수 typed Event에서 생성하는 projection으로 다룬다. 각각을 큰 form 엔티티로 저장하지 않는다 | dogfood 001 §6.3, Return Brief 예시 §3 |
| L7 | 개입의 가치는 그 개입이 만든 상태 전이로 잰다. 한 번의 짧은 개입이 구현 권한과 로드맵을 바꿨다. 지표는 `decision_changed_outcome`, 새 Commitment, 취소된 작업, 피한 비가역 비용이며 클릭·메시지 수는 보조 지표다 | dogfood 001 §6.4 |
| L8 | 짧은 자연어 수락도 선택·범위·비목표·호환 수준을 명시적 Commitment로 전개하되 사용자에게 긴 form을 요구하지 않는다 | Decision Gate 예시 §9 |
| L9 | 숨겨야 할 값(정답 키, 비밀)은 일반 timeline으로 새기 쉽다. 전용 endpoint에서 숨기는 것으로 부족하고 Event payload에 넣지 말아야 하며, 모든 surface를 테스트로 검사한다 | dogfood 002 §6 |
| L10 | 권한 이어 쓰기는 증명 의무다. 비확장 Agreement는 재질문 없이, 확대·증명 불가는 Gate. "확대가 안전하다는 증거가 없는 것은 허가가 아니다" | authority-carry-forward-001 |
| L11 | provider는 런타임이 아니다. provider는 라벨을 붙일 수 없고, human 권한 도구를 보지 못하고, raw transcript를 받지 않는다. 런타임이 한도·도구 effect·컨텍스트·Gate·렌더링·복구를 소유한다 | first-party-runtime-001, runtime-effects-context-001 |
| L12 | "cancelled"를 거짓으로 표시하지 않는다. atomic은 경계에서 멈추고, 외부 결과가 불확실하면 재시도하지 않고 복구 증거를 기다린다 | runtime-effects-context-001 |
| L13 | 런타임 상태(열린 Gate, steering 큐, 불확실 도구)가 메모리에만 있으면 재시작에서 사라진다. durable intent/outcome journal이 필요하다 | SQLite run §4, 9.11 |
| L14 | Gate는 cursor에 묶어야 한다. 렌더링 뒤 상태가 바뀌면 옛 Gate로 commit할 수 없다 | first-party-runtime-001, `runtime.stale_gate` |
| L15 | 전송 형식은 의미 밖이다. direct와 JSONL에서 같은 의미 Event, 다른 provenance | adapter-contract-001 |
| L16 | 능력 결손은 숨기지 않는다. advisory와 enforced를 UI와 감사에서 구분한다 | kernel 후보 P4, §18, CLI §17 |
| L17 | 저장 무결성(checksum)과 의미 품질(qualification)은 별개 검사다. checksum은 우발 손상 진단이지 서명이 아니다 | SQLite run §3 |
| L18 | 자격 검사를 "누구냐"(`actor !== "human"`)로 하면 작업 에이전트와 검증 에이전트를 구분하지 못한다. 능력 목록으로 정의한다 | helm-toy, 대화 [107]~[109] |
| L19 | 거부는 세 갈래(내용·자격·경로)다. 거부된 시도도 기록에 남긴다 | helm-toy ledger, durable-spike `rejected`, 감사 §3.5 |
| L20 | 실행된 도구 결과만 관찰이다. 차단된 호출은 관찰이 아니다. 지어낸 근거는 거부하고 이유를 모델에 돌려준다 | durable-spike 스파이크 1 |
| L21 | 사람 결정은 모델 도구 경로 밖(host commit / Human client)에서 한다 | durable-spike, typed client |
| L22 | pi-durable 훅은 읽기만 가능하고, 샌드박스(codemode) 안 도구 호출은 훅을 거치지 않는다. 막는 판단과 기록 위치를 분리하고 브리지에서 직접 검사해야 한다 | 13 §2.1, §2.3 |
| L23 | founder dogfood는 시장 증거가 아니다. 단일 사용자·단일 facilitator 편향을 기록한다 | protocol §12, dogfood 001 §10 |
| L24 | 대본 기반 실행으로 확인할 수 있는 것은 배치와 정책 순서뿐이다. 모델이 같은 구분을 안정적으로 만드는지는 live run으로만 알 수 있다 | linear-001 R3, openai-001 §8 |
| L25 | C/A 루프를 사용자가 가장 많이 건너뛴다(사용자 진술) | 대화 요약 L2061, 브리프 §3.5 |

---

## 11. 설계에 바로 쓸 체크리스트

문서 번호는 브리프 §3.4. 각 항목 끝 괄호는 이 문서의 절 번호다. "반영"은 내용을 넣거나, 넣지 않기로 했다면 이유를 적는다는 뜻이다.

### 01 제품 브리프 (P1)
- [ ] "모델이 초안, 사람은 반응" 원칙과 v0.2 실사용 증거(unknown 3/4, 의미 입력 7개, Inquiry Map 수정 없음, `ㅇ`/`ㅁㄴㅇ`, 4,319단어 vs 한 문장)를 원칙 절에 (L2, §6.1, §6.3)
- [ ] 문제 정의: core는 semantic write path, ledger만으로 인지 문제 미해결 (L4, L5)
- [ ] 비목표: SaaS·팀·조직 정책(helm-system-v0 OSS/SaaS 경계는 1인 앱에서 범위 밖), stable schema 성급한 고정 (§2.1.9)
- [ ] 성공 지표: dogfood 001 A의 advance criterion(복귀 3회, critical miss 0, 정정 ≤2/run, 그룹 ≤5, 재사용·agency 보고), experimental.v0 승격 관문 6개, CLI UX 수용 기준(Attention 숫자) (§6.1, §2.1.9, §3.18)
- [ ] 구현 우선 경고와 증거 관문을 MVP 정의에 (L1)
- [ ] 금지 경험 10개를 제품 원칙 또는 비목표로 (§3.19)
- [ ] 다섯 질문 mental model (§3.2)

### 02 유즈케이스와 시나리오 (P1)
- [ ] CLI-Q01, G01, G02, G03, A01, PORT-G01을 유즈케이스로 재작성(데스크톱 기준). G01은 박자 8개·가능성 4개·Gate 2개·실패 주입 F1~F6을 수용 기준으로 (§3.17, §4.1)
- [ ] 지연 복귀(24h) 유즈케이스와 probe 4개, User-acknowledged cursor (§3.10, §2.1.6)
- [ ] 비확장 Work Agreement 활성화와 확대 시 Gate 유즈케이스 (§4.6)
- [ ] 불확실 외부 결과 복구 유즈케이스 (§4.7)
- [ ] 실행 중 기준 변경(F5) → 이전 revision stale (§4.1, §9.14)
- [ ] 결정 기록 예(A→B 결정 Gate)를 "짧은 자연어 수락 → Commitment 전개" 유즈케이스로 (L8)

### 03 UX 정보 구조 (P2)
- [ ] 다섯 surface(Orient, Explore, Choose, Work, Review)와 각 표시 항목 (§3.4)
- [ ] 라벨 7종(Helm, Observed, Possible, Choice, Working, Review, Source)과 provider가 붙일 수 없는 라벨 목록 (§3.5, §4.5)
- [ ] Brief 순서 6단계, Return Brief 템플릿 필드(SA 3단계 대응) (§3.10, §5.2.4)
- [ ] 상태 표시줄(Goal, Focus, Mode, Work, Range, Next) (§3.5)
- [ ] 사용자 시점 객체 모델: core 용어 → 제품 표시(목표, 선택, 작업 합의, 맡긴 범위, 결과 제출 → 결과 확인 → 전체 반영) (§2.1.1)
- [ ] 개발자/assurance view에만 보일 것(Grant ID, effect class, Event type) (§1.14, §3.2)

### 04 UX 화면 상세 (P2)
- [ ] Choice Gate 화면: 왜 지금, 추천, 가장 강한 대안, 아직 모르는 점, 되돌릴 수 있는지, 행동 4개 [추천 선택] [기준 수정] [먼저 실험] [연기]. `[승인] [거절]` 금지 (§3.7)
- [ ] Choice impact echo 화면 (§3.7)
- [ ] Work Agreement echo(Result, Allowed, Not allowed, Evidence, Pause when)와 "맡긴 범위" 평이한 표기 (§3.12, §1.14)
- [ ] Completion Claim 화면(✓/△ 기준별), Result Review 행동 5개, "수락됨 · 전체 반영 N개 남음" (§3.12)
- [ ] 오류·저하 상태 4종 문구(Kernel unavailable, capability missing, projection stale, unknown external outcome) (§3.13)
- [ ] 로딩·오프라인 상태에서 stale view를 current처럼 보이지 않기, source cursor 표시 (§3.13)
- [ ] 정보 밀도 위험 R2(가능성은 추천+최강 대안만 먼저) (§4.4)
- [ ] Decision Gate·Delegation Contract·Inquiry Map 템플릿 필드 중 화면에 쓸 것과 drill-down으로 보낼 것 결정 (§5.2)

### 05 상호작용과 문구 (P2)
- [ ] 자연어 → state 규칙 5가지(명확 지시는 echo, 모호·저영향은 provisional + read-only, 모호·고영향은 Gate, 추출은 candidate, 추천은 Choice 아님) (§3.6)
- [ ] approval theater 정의와 방지 장치 4개, "계속할까요" 금지 (§3.8)
- [ ] pause / stop / hard abort 문구 구분 (§3.11)
- [ ] Agent escalation 포함 항목 5개 (§3.11)
- [ ] 항상 표시할 tool activity 7종과 기본 압축 문구 (§3.11)
- [ ] 반응 수집(요소 단위, 이유 없는 반응 포함)과 "모델이 초안" 원칙의 상호작용 (L2, 브리프 결정 18)
- [ ] 접근성(색 독립, 선형 모드, 키보드, CJK 폭, NO_COLOR) (§3.14)
- [ ] 한국어 문구 예: First launch 4줄, Kernel unavailable 2줄, advisory 2줄 (§3.10, §3.13)

### 06 시스템 아키텍처 (P3)
- [ ] P1~P7 원칙 채택 여부 (§1.3)
- [ ] Northbound/Southbound/Control 방향 비대칭 (§1.4)
- [ ] helmd 운영 책임 7개, embedded mode의 workspace lock, single writer (§1.5)
- [ ] 논리 모듈 의존 방향(contracts는 I/O 없음, kernel은 시계·랜덤 주입)과 브리프 §3.1 패키지 대응 (§1.6)
- [ ] observability stream 4개 분리 (§1.22)
- [ ] 상태 기계 4개를 하나의 status로 합치지 않기 (§3.16)
- [ ] provider neutrality 규칙 (§3.16)
- [ ] `@helmdocs/*` 실험 코드 처리(보관/참고)와 재사용 가능 목록 (§8.7)

### 07 pi 활용·포크 (P4)
- [ ] pi-lab exp1~6이 확인한 훅 위치(`beforeToolCall`/`afterToolCall`/`subscribe`), 메시지 직렬화·복원, provider 간 이어 쓰기, coding-agent extension `tool_call` block과 입력 수정, pi-durable 재시작, pi-protocol 프레이밍, pi-tui 원격 메시지 렌더링을 파일 단위 계획에 연결(결과 확인은 pi-api-facts-2) (§7.4)
- [ ] pi-durable은 참고용: 스파이크의 "의도 → 실행 → 결과", 지속 타이머, 사람 결정 host commit, 훅 읽기 전용 한계 (§7.2, 브리프 29)
- [ ] codemode 샌드박스 도구가 훅을 거치지 않는 문제 (L22)
- [ ] OpenAI provider 계약 규칙(mixed 출력 거부, strict schema, 키 비노출, usage는 운영 데이터)을 pi-ai 계층 요구로 (§4.8, §9.12)

### 08 도메인 모델 (P5)
- [ ] 후보 어휘 41개 Command와 실행 후보 13개의 차이, 새로 생긴 `legacy.choice.capture`, `authority.grant`, `agreement.activate` (§1.9)
- [ ] 품질 상태 세 개(captureState, qualification, baselineStatus)와 값 전부, Choice 외 엔티티로 확장 (§1.10)
- [ ] qualificationBasis 다섯 필드(sourceRefs, scope, evidenceRelation, accountableAcceptor, reviewTrigger) (§9.2)
- [ ] Authority Grant 필드, requestedAuthority 필드, Work Agreement 필드(result, allowed, notAllowed, evidence, acceptanceCriteria, stopConditions, revision), Completion(criteriaResults, evidenceRefs, limitations, agreementRevision), Integration(obligations, transferredObligations) (§1.14, §9.2, §9.5)
- [ ] Claim 스키마: helm-toy의 evidence, counterEvidence, counterChecked + 구분 확인(두 구현 모두에 없음) (§7.3)
- [ ] 거부 세 갈래(내용·자격·경로)와 결과 코드 대응 (§7.3, §9.3)
- [ ] 쓰기 시점 참조 제약 후보: 근거는 실제 관찰 ID만(helm-toy, durable-spike), Completion은 현재 Agreement revision 기준을 모두 다룸, Integration은 Acceptance 뒤, Choice commit은 qualified 뒤 (§7.3, §9.2)
- [ ] 정본 semantic trace 후보(guided-001 §6)와 `goal.link`, `obligation.transfer` (§4.1)
- [ ] 이벤트 이름 접두사 규칙(normative/epistemic/material/governance/migration/experience), `projection.` 금지 (§1.27)
- [ ] Delegation Contract 상태 8개, Inquiry phase 6개, Hypothesis status 6개, Gate reason 7개, Acceptance 4값 (§5.2)
- [ ] 행위자 identity: 자유 문자열 actor는 인증 identity가 아님, actor.kind(human/agent/tool/migration), observer.kind (§1.8, §9.1)

### 09 이벤트 저장소 (P5)
- [ ] envelope 필드(eventId, workspaceId, sequence, type, recordedAt, effectiveAt, actorId, authorityBasis, subjectRefs, payload, provenance, causationId, correlationId) (§9.1)
- [ ] DDL 기준선(schema_migrations, workspaces, events, commands, observation_inbox, outbox, 인덱스)과 kernel 후보의 추가 테이블(projection_checkpoints, projection_documents, actors_sessions, adapter_connections, evidence_refs) (§9.6, §1.18)
- [ ] 트랜잭션 6단계와 `BEGIN IMMEDIATE`, fault injection 지점 (§1.18, §9.6)
- [ ] 해시 체인 공식과 손상 시 fail-closed, read-only recovery mode (§9.6, §1.21)
- [ ] 마이그레이션 방식(버전 테이블, 열 추가 + backfill), schema evolution 규칙 6개, upcaster vs migration Event (§9.6, §1.18)
- [ ] 거부 결과도 inbox에 저장할지(SQLite판은 저장, in-memory판은 미저장) 결정 (§9.6)
- [ ] 매 Command 전체 replay 비용 → checkpoint/snapshot (§9.6)
- [ ] JSONL import 규칙 5개와 migration report 형식, `ㅇ` fixture (§1.18, §9.7)
- [ ] 백업: consistent snapshot + evidence manifest + schema versions (§1.21)
- [ ] outbox 재개(afterSequence)와 전달 표시 idempotency → 클라이언트 재전송(lastSeq)과 연결 (§9.6, 브리프 31)

### 10 커널 (P6)
- [ ] 단일 변경 경로: Command/Observation만, adapter Event append 금지, projection 어휘 쓰기 금지 (§1.3 P3, §9.4)
- [ ] Command 전이 표 13행을 출발점으로 행위자 조건·선행 조건·결과 Event 정의 (§9.2)
- [ ] 권한 포함 검사 알고리즘과 scope 규칙(prefix `**`의 한계) (§9.2.1, §4.6)
- [ ] Policy 출력 형태(decision 5값, policyIds, reasons, missing, requiredActions)와 write result 형태(status 4값) (§1.12, §9.1)
- [ ] Effect class R0~R4는 Helm 판정 범위 밖(브리프 2), 선언·표시만 (§1.12)
- [ ] Gate rule 3조건(커널판)과 4조건(CLI판) 정리, Gate Event와 알림 분리, 중복 알림 금지 (§1.12, §3.7)
- [ ] idempotency key 범위(adapter|actor|key), 지문 비교, external observation 범위(adapter|externalId) (§9.4)
- [ ] expectedCursor 필수와 rebase 응답 (§1.8)
- [ ] 의미 충돌(Conflict 후보)과 semantic intent/lease (§1.19)
- [ ] 불변조건 테스트: §9.14 표 57개와 acceptance criteria 13개, helm-toy 거부 8건을 첫 대본으로 (§9.14, §1.25, §7.3)
- [ ] 공리 대응표에 paper Foundation 추적(A1, A3~A9, A11~A15) 활용 (§5.1)

### 11 묻기와 자율성 (P6)
- [ ] approval theater 방지와 Gate 조건 (§3.7, §3.8)
- [ ] Headless에서 `needs_gate` + resume token (§3.15)
- [ ] 동시 active Gate 기본 3개 이하, 중복 질문 금지 (§3.18)
- [ ] Decision Gate 템플릿의 "Last cheap point", "What proceeds automatically if no decision is made", "Defer until a specified trigger"를 질문 레코드·가정 만료점에 대응 (§5.2.2)
- [ ] 비확장 Agreement 재질문 없음(혼자 정한 결정과의 관계), 확대 시 Gate (§4.6)
- [ ] "범위를 줄여 진행"(narrower Agreement draft) (§4.6)

### 12 런타임 엔진 (P7)
- [ ] provider turn 계약(blocks/toolCalls/gate/finish 상호 배제), step·tool-call 한도, 중복 tool-call ID 거부 (§4.5, §9.11)
- [ ] run 알고리즘과 런타임 상태 6개 (§9.11)
- [ ] steering/취소 의미(cooperative, atomic deferral, uncertain → awaiting_recovery, 복구 resolution 3값) (§4.7, §9.11)
- [ ] Context Projection 계약·우선순위 5단계·예산·redaction·fail-closed 알고리즘(A11 투영 규칙 집행) (§4.7, §9.10)
- [ ] cursor-bound Gate와 stale 처리 (§9.11)
- [ ] durable runtime journal(열린 Gate, steering 큐, tool intent/outcome) — 크래시 복구 (L13, 브리프 30)
- [ ] 출력 정화(터미널 제어문자), provider 라벨 위조 차단 (§9.11)
- [ ] OpenAI 계약에서 가져올 provider 요구(무상태, store false, strict, usage 운영 콜백) (§9.12)

### 13 도구와 실행 (P7)
- [ ] 도구 정의 필드(effectClass, cancellation, authorityEnforcement, strict, inputSchema)와 runtime 재검증 (§9.1, §9.11)
- [ ] provider에 노출할 도구 10개와 노출하지 않을 도구(human 권한, raw append, generic submit) (§4.5)
- [ ] MCP surface 후보(read 6, write 9)와 propose/commit, submit/accept 구분 (§1.17)
- [ ] 런타임 어댑터 인터페이스: capability manifest(문서판 8키 vs 실행판 Level 4개), Level A~D 정의 불일치 해소, enforced/advisory 표시, conformance suite 9항목 (§1.15, §4.3, §1.23)
- [ ] runtime별 mapping(Codex, Pi, OpenCode, OMO)과 한계 (§1.16)
- [ ] bash·codemode 우회 문제(훅을 거치지 않는 경로) (L22)

### 14 루프·모드·오케스트레이션 (P8)
- [ ] Quick/Guided/Assured 정의·전환·silent downgrade 금지를 모드·다이얼로 재정의 (§3.9, 브리프 3)
- [ ] Guided 리듬(Resume → Frame → Investigate → Choice → Agreement echo → autonomous → Completion → Review → Whole Update)과 루프 O/I/C/A 대응 (§3.6)
- [ ] durable-spike 스파이크 2의 Concern 상태 기계(phase, waiting, 지속 타이머, 전환 기록 같은 commit) (§7.2.2)
- [ ] C/A 우선과 사람 조작 2회 상한 근거(사용자 진술, CLI-G01의 Gate 2개) (L25, §4.2)
- [ ] 의존 규칙과 실행 후보 대응: write에는 Agreement(Completion은 active Agreement 필요), 완료에는 Acceptance(Integration은 accepted 뒤), 판단 승격에는 근거(helm-toy promote) (§9.2, §7.3)

### 15 탐구 엔진 (P9)
- [ ] Inquiry Map 템플릿 전체(경쟁 프레임: 드러내는 것/숨기는 것, 반증 조건 가진 가설, 구분 실험의 정보 가치·비용·가역성, 증거 독립성, 에이전트 합의 중복 계산 금지) (§5.2.1)
- [ ] 실행 후보에 탐구가 없음(가능성 4개는 fixture에 미리 적힘) → 발산 서브시스템이 메울 공백 (§9.15)
- [ ] "모델이 초안, 사람은 반응"과 반응 기록, 근거 필수(근거는 실제 관찰 ID) (L2, L20)
- [ ] Claim 승격 규칙(근거 ≥1, 반증 탐색 기록, 반대 근거 0)과 구분 확인 추가 (§7.3)
- [ ] 예시 Inquiry Map의 F1/F2/F3 프레임 사례를 Method Transfer·대비 압축 예시로 활용 가능 (§5.4.1)

### 16 관찰 에이전트와 지표 (P10)
- [ ] 실험 프로토콜 지표 이름 전부(Resumption 5, Decision 6, Delegation 5, Integration 4, Attention 5) (§5.3)
- [ ] SA probe 3 Level과 점수 방식, critical incident 8문항, 탐색 질문 5개, NASA-TLX trade-off (§5.3)
- [ ] 측정 시트(guided-001 §9)와 Pilot 판단 기준(Advance / Revise / Reframe or stop) (§4.1, §5.3)
- [ ] 2주 우회율 지표와 CLI Attention 기준 숫자(가설) (§3.18)
- [ ] resumption 실험 장치(정답 private, hash public, 사람 검토) 재사용 (§2.1.6, §8.7)
- [ ] 반증 측정: founder 편향 기록, facilitator 기록 항목 (L23, §5.3)

### 17 데몬과 운영 (P11)
- [ ] helmd 책임 7개, single writer, embedded 금지 조건 (§1.5)
- [ ] 실패 종류 9개와 복구 원칙 6개 (§1.21)
- [ ] 백업 구성, checksum chain, 손상 시 read-only recovery (§1.21, §9.6)
- [ ] SQLite 설정(WAL, foreign_keys, busy_timeout 5000) (§9.6)
- [ ] 런타임 데이터는 `~/projects` 밖(브리프 2.5) — experimental.v0의 `.helm/` in-project 기본값과 다름 (§2.1.2)

### 18 보안 (P11)
- [ ] actor identity는 host 발급 session credential, display name 불신, human acceptance의 UI/session/auth context 추적 (§1.20)
- [ ] project resources trust(AGENTS, skill, extension은 trust 전 자동 실행 금지, marker, hash) (§1.20)
- [ ] evidence privacy(민감도 label, disclosure policy), secret redaction(키 기반 한계) (§1.20, §4.7)
- [ ] provider 키 비노출 규칙(private field, Authorization header만, 오류에 body 없음) (§4.8)
- [ ] enforcement honesty(advisory 표시) (L16)
- [ ] experimental.v0 서버 보안 헤더·body 상한·loopback 기본·`--allow-remote` (§8.4, §2.1.7)
- [ ] 숨긴 값이 일반 timeline으로 새는 결함 사례 (L9)

### 19 클라이언트 프로토콜 (P12)
- [ ] 실행 후보 protocol 5 method와 handshake 필드(protocolVersion, schemas, methods, invariants 4개) → JSON-RPC 2.0 메서드 이름으로 대응 (§9.8, 브리프 31)
- [ ] write result 형태와 결과 코드 카탈로그를 오류 코드 체계로 (§9.1, §9.3)
- [ ] delivery semantics(at-least-once + idempotent inbox, control ack/timeout, 단절은 안전 저하) (§1.15)
- [ ] outbox sequence 재개 → lastSeq 재전송 (§9.6)
- [ ] SSE 무효화(experimental.v0) 대신 seq 이벤트 스트림 (§8.7)
- [ ] provenance(adapterId, externalRunId, sourceRefs, sourceHash)와 client 이름(`x-helm-client`) (§9.1, §8.5)

### 20 데스크톱 앱 아키텍처 (P13)
- [ ] 앱은 얇은 client(헤드리스 parity: UI에만 있는 business action 금지) (§3.15)
- [ ] 상태 기계 4개(loop, WorkUnit, connection, projection freshness)를 클라이언트 저장소에서 분리 (§3.16)
- [ ] Gate의 cursor binding을 UI 상태에 반영(stale Gate 표시) (L14)
- [ ] experimental 웹 GUI의 Brief/Timeline/Capture 정보 구조는 참고만, Capture 폼은 diagnostic (§8.6, §8.7)

### 21 데스크톱 UI 시스템 (P14)
- [ ] 라벨 7종과 색 독립 표기 (§3.5)
- [ ] Gate 카드, Work Agreement echo, Completion 기준 행(✓/△), "전체 반영 N개 남음" 배지 컴포넌트 (§3.7, §3.12)
- [ ] 근거 drill-down(source trace 필드 6개) (§3.11)
- [ ] material group 카드(최대 5 + other) (§8.6)
- [ ] helm-web 토큰(light-dark 쌍)은 참고 (§8.6)

### 22 테스트 전략 (2단계)
- [ ] §9.14 불변조건 57개를 테스트 목록 출발점으로 (§9.14)
- [ ] kernel 후보 test architecture 4종(Kernel, Storage, Adapter conformance, Cross-runtime fixture, UX/effectiveness) (§1.23)
- [ ] 가짜 모델 재생: scripted provider(`sequenceProvider`), mock fetch, faux provider(pi), helm-toy 대본 (§9.14, §7.2, §7.3)
- [ ] 장애 주입: fault injector 지점, 손상 Event, 불확실 외부 결과, atomic 취소 (§9.6, §9.14)
- [ ] golden transcript(선형 표현 우선) (§3.16)
- [ ] 결정적 테스트를 위한 clock·idFactory 주입 (§9.9)

### 23 구현 계획 (2단계)
- [ ] 구현 우선 경고: 마일스톤 사이에 사람 증거 관문(지연 복귀, 검토 질문 답) (L1)
- [ ] v0.2 migration Phase 0~5를 참고하되 데스크톱 우선으로 재배열 (§1.24)
- [ ] 실행 후보 재사용 범위(순수 Kernel 구조, 계약, 테스트)와 다시 만들 것(Goal/Concern/탐구, durable runtime) (§9.15)
- [ ] dogfood advance criterion을 단계 완료 기준으로 (§6.1)

### 24 ADR
- [ ] 기록할 결정 후보: qualification + accountable acceptance(대안: 언어 휴리스틱, 필수 필드, active pin), 비확장 권한 이어 쓰기, provider에 human 권한 도구 비노출(MCP 후보 §15와 다름), 거부 결과 inbox 저장 여부, Level 정의 통일, JSONL은 export/import 전용, effect class는 선언만 (§4.2, §4.6, §1.17, §9.6, §1.15)

### 25 용어집
- [ ] core 용어 ↔ 제품 표시 대응(§2.1.1), 품질 상태 값, Gate, approval theater, Authority Grant / 맡긴 범위, Completion Claim / Result Acceptance / Integration, obligation transfer, advisory / enforced, Context Projection, source cursor, User-acknowledged cursor, capability Level A~D (§1.10, §1.14, §3.8, §3.10, §1.15)

<!-- 0단계 완료 -->
