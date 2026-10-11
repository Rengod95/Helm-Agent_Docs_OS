# 대화 설계 발췌 3 (L2018–3201, [57]~[105])

- 작성: 2026-10-11, 0단계 에이전트 S2c
- 원문: `docs/handoff/conversation-transcript-until-158.md` 2018~3201행, 메시지 [57]~[105]. 범위 바로 앞(2010~2017행, Claude의 확인 질문)과 바로 뒤(3202~3206행, 사용자 [106])를 함께 읽었다.
- 2021~2097행의 컴팩션 요약(이전 대화 요약본)은 전부 읽었다. 앞 대화(1~2017행)에서 같은 내용을 찾지 못한 것만 `[요약본]`으로 표시해 1절에 옮겼다. 앞 대화에 이미 있는 내용은 발췌 1·2가 다루므로 1절에서는 위치만 적었다.
- 이 발췌는 설계 에이전트가 대화 원문 대신 읽는다. 원문의 목록·표·숫자·이름·코드는 가능한 한 그대로 옮겼다. 원문 인용은 원문 표현을 고치지 않았다(원문에 '축' 같은 표현이 있으면 그대로 둔다).

## 0. 읽는 법

### 0.1 표기

| 표기 | 뜻 |
|---|---|
| `L<n>` | 원문 행 번호. 범위는 `L2119–2125`처럼 쓴다 |
| `[사용자]` | 제품 소유자의 진술·요구 |
| `[사용자 동의]` | Claude 제안에 사용자가 명시적으로 동의한 것 |
| `[Claude]` | Claude의 설명·제안·분석. 사용자 답이 없으면 결정이 아니다 |
| `[요약본]` | 컴팩션 요약(L2021–2097)에만 있고 앞 대화 1~2017행에서 찾지 못한 내용 |
| `[정정]` | 앞선 내용을 고친 것. 무엇을 고쳤는지 함께 적는다 |
| `[이후 변경 가능: 브리프 결정 n]` | `docs/design/process/00-design-brief.md` 2장의 확정 결정 n과 다른 내용. 설계는 브리프를 따른다 |
| `[실험]` `[원문]` `[검색]` `[지식]` | 기술 사실의 확인 수준(브리프 §5.2). 따로 적지 않으면 대화 당시 Claude가 한 확인이며 이 발췌 작성 중에 다시 확인하지 않았다 |

항목 ID는 `X3-<절>-<번호>` 형식이다.

### 0.2 메시지 위치

| 메시지 | 행 | 화자 | 내용 |
|---|---|---|---|
| [57] | L2018–2097 | 사용자 | "C와 A" (L2019). 이어서 컴팩션 요약 L2021–2097 |
| [58] | L2099–2170 | Claude | C/A 설계: 합의 항목, 차단, 제출 형식, 수용 옵션, 반영 목록, 상태 기계, 사람 조작 2회 상한, 2주 지표 |
| [59] | L2172–2173 | 사용자 | 세계 모델·일의 단위·운영 루프·이해의 단계를 런타임으로 구현하고 싶다 |
| [60]~[61] | L2175–2263 | Claude | 위젯 `helm_runtime_four_layer_architecture`. 평면, 단위, 루프 세 크기, 10단계 표, 이해 단계, RLM 적용 지점, 어려운 점, 순서 |
| [62] | L2265–2266 | 사용자 | Helm을 별도 엔진 없이 pi 런타임 안에서 구현할 수 있나 |
| [63] | L2268–2349 | Claude | 한 프로세스 두 코드, `.helm/ledger.jsonl`, pi 기능 대응표, 한 턴 흐름, 폴더 구조, 한계 |
| [64] | L2351–2352 | 사용자 | 피처 작업 흐름 미리보기 시각화, pi durable·서브에이전트·확장으로 공리를 더 결정적으로 |
| [65]~[67] | L2354–2420 | Claude | 위젯 2개(`helm_feature_flow_url_filter_sync_preview`, `helm_on_pi_durable_ownership_tree`), 소유 규칙, 공리별 장치 표, 한계, 순서 |
| [68] | L2422–2423 | 사용자 | 피처 해결보다 문제 해결 방안을 찾아가는 과정에 초점 |
| [69]~[71] | L2425–2533 | Claude | 위젯 `helm_inquiry_flow_slow_first_screen_preview`. 코드가 정하는 네 결정, 범주 한정 Helm, 진입 조건, 흐린 작업 다섯 유형, 승격 신호, 지표 |
| [72] | L2535–2536 | 사용자 | 작업 유형별 mode처럼 적용하고 싶다. OICA·NEMAP·OPDC 워크플로우는 세부적으로 어떻게 되어 있나 |
| [73] | L2538–2670 | Claude | OICA=흐름, NEMAP=상태, OPD+C=평가. 문서 세부, 모드 정의, 다섯 모드, 불변조건 6개, 문서의 빈 곳 |
| [74] | L2672–2673 | 사용자 | 벤더와 무관하게 순수하게 Helm을 구현하는 방법론과 아키텍처 |
| [75]~[77] | L2675–2830 | Claude | 위젯 `helm_kernel_single_change_path`. 단일 변경 경로, 쓰기 시점 제약, 이벤트 로그, 품질 상태, 능력 행렬, profile, 계층 상태 기계, 모드 계약, 거시 스케줄러, OPD+C 의무, 내부 루프 계약, 방법론 6단계, 피할 것 |
| [78]~[79] | L2832–2899 | 사용자 | "이해하기 너무 어렵다". learn 스킬 호출 |
| [80]~[98] | L2901–3149 | Claude·사용자 | 학습 문답: Redux 대응, N/E/M 분류, 관찰과 추측, 근거·반대 근거·구분 확인, 루프, 위험한 칸, reducer 규칙 |
| [99]~[102] | L3151–3183 | 사용자·Claude | "둘다". 장난감 커널 `helm.mjs` 작성·실행(21회 중 8회 거부) |
| [103]~[105] | L3185–3200 | 사용자·Claude | 시각화 요청, 위젯 `helm_toy_reducer_dispatch_stepper`, 거부 분류 질문 |

### 0.3 위젯과 용어에 관한 주의

- 위젯 6개(L2176, L2355, L2358, L2431, L2692, L3189)는 원문에 이름만 있고 내용이 없다. 위젯에 있던 내용은 앞뒤 본문에 언급된 만큼만 알 수 있다.
- [67]은 "## 3. 공리별 구현과 결정성 수준"(L2368)부터 시작한다. 1~2절은 위젯 [65]·[66]에 있었던 것으로 보인다. [67]의 L2415는 미리보기의 "6~9단계(합의, 실행 중 차단, 재시작 후 재개, 검증자의 반대 근거, 반영 대기)"를 언급한다.
- 이 범위의 Claude 답은 Helm 용어를 쉬운 말로 옮겨 쓴다. 초점 = Concern, 진행 작업 = WorkUnit, 선택 요청 = Gate/DecisionGate, 복귀 요약 = ReturnBrief, 맡긴 범위 = 권한 부여(AuthorityEnvelope), 관찰 에이전트 C = 세션 로그를 읽는 관찰 에이전트(브리프 용어집의 "관찰 에이전트").
- 도구 이름이 메시지마다 다르다. [58]은 `agreement.propose`, `result.submit`, [63]은 `helm_propose_agreement`, `helm_submit_result`, 요약본(L2094)은 `completion.submit`이다. 설계 단계에서 하나로 정해야 한다.

## 1. 컴팩션 요약 (L2021–2097)

### 1.1 요약본의 성격

- **X3-1-01** L2021–2024 [Claude] 이전 대화가 컨텍스트를 넘어 이어지는 세션이다. 요약은 영어로 쓰였고 9개 절(Primary Request, Key Technical Concepts, Files and Code Sections, Errors and fixes, Problem Solving, All user messages, Pending Tasks, Current Work, Optional Next Step)로 되어 있다.
- **X3-1-02** L2096–2097 [요약본] 원 대화 기록 위치: `/root/.claude/projects/-home-claude/60aa9ab4-6098-5e4b-89bb-feba07cf0614.jsonl`. 지시: 사용자에게 더 묻지 말고 요약을 언급하지 않고 바로 이어 갈 것.

### 1.2 요약에만 있는 내용 [요약본]

- **X3-1-03** L2026 [요약본] 사용자 정보: "Korean frontend developer, React 18 CSR senior, no SSR prod experience". SSR 실무 경험이 없다는 진술은 앞 대화에서 찾지 못했다. 개인용(일반 사용자 대상 아님)이라는 점은 앞 대화 L1586에 있다.
- **X3-1-04** L2028 [요약본] 문체 선호가 저장되어 있다: '축', '박다', '가른다', 의인화 비유("연구가 이 질문에 닿았다", "증거가 말한다") 싫어함. 위에서 아래로(큰 그림 먼저) 설명 선호. "Tutor-mode answers in Korean 합니다체." (튜터 모드 답은 합니다체라는 점은 요약에만 있다.)
- **X3-1-05** L2033 [요약본 일부] pi 1.x 확장 API 목록. 앞 대화에서 찾지 못한 이름: `context_with_system`, `provider_stream_event`, `cache_warming_decision`, `pi.registerVirtualModel`. 요약의 전체 목록:
  - 이벤트: `session_start`, `session_shutdown`, `before_agent_start`, `agent_end`, `turn_end`, `agent_before_settle`(append entries + request one continuation), `agent_settled`(now with `aborted`), `tool_call`(mutate/block), `tool_result`, `context`, `context_with_system`, `provider_stream_event`, `user_bash`, `cache_warming_decision`
  - API: `pi.registerTool`(exposure direct/model-only/codemode/deferred/hidden, `outputSchema`/`structuredContent`, `ctx.executeTool`), `pi.appendEntry`, `pi.sendMessage`, `pi.setActiveTools`, `pi.registerMcpServer`, `pi.registerVirtualModel`, `ctx.ui`
  - 세션 JSONL 경로 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`, 모드 print/json/rpc/SDK, `RpcClient`
  - Pi Durable(experimental): storage-backed harness, checkpointed tasks, `replay: "safe"`, forks, background tasks, documents, hooks with memo
- **X3-1-06** L2034 [요약본 일부] codemode: 호출마다 QuickJS 샌드박스(새 worker+VM, 끝나면 닫음), `tools.*`, `store/load`는 `codemode-store` 세션 엔트리로 저장되어 분기마다 재생, `max_output_tokens` 10000, inline budget 3000, **256MB VM**(앞 대화에서 찾지 못함), 타이머·fetch 없음.
- **X3-1-07** L2048–2049 [요약본 일부] 코드 읽기 세부. 앞 대화에서 찾지 못한 것: rlm-minimal `rlm_repl.py`의 `max_iterations=20`, `utils/utils.py`의 100k자 잘라내기와 "variable names only", `codemode/tool.js`의 `DEFAULT_CODEMODE_INLINE_BUDGET = 3000`, `selectCatalog`, `prepareCodemodeLoadout`, codemode 도구 exposure `"model-only"`, `execute.js`에서 `sandbox.close()`를 finally에서 호출하고 성공 시 `options.appendEntry(CODEMODE_STORE_ENTRY_TYPE, {set, delete})`.
- **X3-1-08** L2050 [요약본] 이전 Helm 저장소 반입 방식: `/mnt/user-data/uploads/06_agent_docs_os/`에 151개 파일(8월 16일·21일 수정분)을 올렸고 `.helm/private/`와 `.helm/events.jsonl`은 제외했다. (151개라는 수는 앞 대화 L1599에도 있다.)
- **X3-1-09** L2050 [요약본] 앞 대화에서 찾지 못한 Helm 문서 세부(파일별로 읽은 핵심):
  - `10-refinement-candidate.md`: C1–C8 contradictions, product definition, N/E/M + A/P, Concern/WorkUnit, Quick/Guided/Assured, 12 core laws, adapter levels A–D, D1–D3 decisions
  - `09-operating-theory.md`: 4 loops, 5 state spaces(v0.1), intervention calculus, OPD+C, **maturity levels 0–5**, 12 laws, falsification
  - `docs/prototypes/paper-v0/templates/inquiry-map.md`, `examples/helm-transition/inquiry-map.md`: F1–F3 frames, H1–H4
  - `docs/research/bundles/situation-recovery-and-deliberative-inquiry.md`: M1–M8
  - `docs/experience/helm-cli-agent-v0.2.md`: Orient/Explore/Choose/Work/Review surfaces, gate conditions, forbidden CLI experiences
  - `docs/architecture/helm-kernel-v0.2-candidate.md`: P1–P7, domain vocabulary, quality model, policy engine R0–R4, projection invariants, adapter capability manifest
  - `docs/prototypes/agent-v0.2/helm-cli-guided-001.md`: possibilities scripted in fixture(가능성이 fixture에 미리 적혀 있었음)
  - 주의: 요약은 성숙도를 "levels 0–5"로, [73](L2562–2565)은 L1~L5로 적는다. 원문 확인이 필요하다.
- **X3-1-10** L2053–2056 [요약본] 오류와 해결:
  - `@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js` import에서 `ERR_PACKAGE_PATH_NOT_EXPORTED` → sed로 상대 경로 `./node_modules/...`로 고침
  - `device_stage_files`가 기기 scratch의 tarball을 거부(연결 폴더 밖) → 연결 폴더에서 50개 이하씩 세 번에 나눠 올림
  - WebFetch 404(wikidocs), 503(GitHub extensions.md) → pi.dev 문서 등 다른 출처 사용
- **X3-1-11** L2057–2058 [요약본 일부] 자기 정정 두 건: pi에 네이티브 MCP가 없다고 했던 것을 정정(0.99/1.0부터 내장), "목표 공간은 사용자만 안다"는 구분을 사용자 피드백에 따라 정정(목표는 결과를 보면서 구성된다). 두 정정 모두 앞 대화(L330, L1593)에 있다. 문체 피드백: "증거가 말해준다" 같은 표현을 피할 것.
- **X3-1-12** L2086–2087 [요약본 일부] 제안했으나 수락되지 않은 일:
  - 최소 Helm 엔진 상태 기계(저장소 + Concern 상태 기계)와 pi 확장 뼈대를 작성하고 작은 작업 하나를 Orient → Integration까지 돌리기
  - 발산 서브시스템 ①~③을 pi 확장으로 시제품화
  - 흐린 작업 5개 실험(앞 대화 L1662–1671)
  - 다음 튜터 장: "subagent as loop-running tool: ypi process spawn vs Pi Durable owned conversations" (이 장 제목은 요약에만 있다)
- **X3-1-13** L2088 [요약본] 보안·취급 제약: `.helm/private/`는 올리거나 읽지 않는다("contains resumption-keys.json"). 연결 폴더 `/Users/user/Documents/projects/06_agent_docs_os` 안에서만 작업한다. 연결 폴더의 삭제는 기본적으로 허용되지 않는다(권한 요청 필요).
- **X3-1-14** L2093–2094 [요약본 일부] 다음 단계 지시: "C와 A"에 답하면서 C(작업 합의·맡긴 범위·멈출 조건)와 A(결과 제출 → 결과 확인 → 전체 반영, 돌아보기)가 코드로 가장 잘 강제되는 부분(A6, A7, A10, A13)임을 말하고, 엔진을 C+A부터 시작하자고 제안할 것. 장치 예: 변경 도구 전에 작업 합의를 요구하는 `tool_call` 권한 검사(effect class 포함), 근거 링크가 필수인 `completion.submit` 도구(`outputSchema`), 미제출·미확인 결과가 있으면 settle을 막는 `agent_before_settle`, `ctx.ui` 리뷰 게이트(확인 / 조건부 확인 / 수정 요청 / 거절), 복귀 요약에 보이는 반영 의무 목록. 이 지시는 [58]에서 그대로 실행되었다. 도구 이름 `completion.submit`만 [58]의 `result.submit`과 다르다.

### 1.3 요약에 있으나 앞 대화에도 있는 내용 (위치만)

- **X3-1-15** L2031 중립 하네스 층 (A)(B)(C), `ak` CLI, `AgentDriver`, 능력 행렬과 graceful degradation → 앞 대화 L1–80 부근(발췌 1).
- **X3-1-16** L2032 에이전트 루프 기초(while 루프, 메시지 배열, 훅, 스킬, 서브에이전트, Agent Teams) → 발췌 2 [35]~[37].
- **X3-1-17** L2035 RLM(arXiv 2512.24601), `llm_query`, `FINAL`/`FINAL_VAR`, depth 1 → 발췌 1·2.
- **X3-1-18** L2036 관찰 에이전트 C 파이프라인: trace normalization → deterministic mining → LLM classification(skill/CLI/hook/noise) → inbox → human approval → sync → effect measurement. 트리거는 모델이 아니라 코드(cron/이벤트) → 앞 대화 L277–357 부근.
- **X3-1-19** L2037 Helm 이론 목록(정의, justified progress 4조건, `<N, E, M | A, P>`, Goal > Concern > WorkUnit, O/I/C/A, 10단계, A1–A15, 12 laws, 인식 사슬 관찰→해석→가능성→판단→선택, 결과 제출→결과 확인→전체 반영, 품질 상태 absent/captured/structural/qualified/accepted/contested/stale/superseded, R0–R4, `RequestedAuthority ⊆ CurrentAuthorityGrant`, gate rule 3조건, deliberation pressure, Quick/Guided(default)/Assured, OPD+C, 반증 조건, v0.2 D1~D3) → 앞 대화 L1847–2016(발췌 2). `RequestedAuthority ⊆ CurrentAuthorityGrant` 표기는 앞 대화에 없고 [58] L2128에 나온다.
- **X3-1-20** L2038 공리 대응(코드 강제 A1, A5, A6, A7, A9, A10, A11, A13 / 모델+코드 검사 A2, A3, A4, A8, A14 / UI 설계 A15 / 측정만 A12), 구조(런타임 밖 저장소 → 결정적 엔진(Concern 상태 기계가 내부 루프의 "mode"인 도구·프롬프트·권한을 정함) → pi 세션 내부 루프, 관찰자 프로세스는 바깥), 규칙 "관찰은 tool-call id를 출처로 참조해야 하고 아니면 해석으로 기록" → 앞 대화 L1676–1775.
- **X3-1-21** L2039 발산 서브시스템(앵커링 → 방향별 RLM식 발산: 위 목적 사다리, 아래 분해, 옆 다른 모델로 대안, 반전 실패·부작용, 렌즈 방법 카드 → 외부 근거 필수 → 대비 압축 2~3 프레임 + 질문 1개 → 반응을 N 평면 전이(`goal.revise`, `concern.reframe`, `choice.commit`)와 개인 선호 이력으로 → 정지 규칙) → 앞 대화 L1636–1671. "대비 2~3개"는 [이후 변경 가능: 브리프 결정 18].
- **X3-1-22** L2042–2047, L2051 실험 파일(`toy-rlm.mjs`, `codemode-lab.mjs`, `codemode-lab2.mjs`, `mini-harness.mjs`, `storage-lab.mjs`, `decomp-lab.mjs`)과 수치, 위젯 3개 → 발췌 1·2.
- **X3-1-23** L2061 문제 해결 요약(이론에는 발산이 있고 구현은 통치 쪽으로 기울었음, dogfood의 의미 입력 병목, `ㅇ`/`ㅁㄴㅇ` 결정 증거, 24시간 resumption probe 결과 파일 없음) → 앞 대화 L1599–1623, L1945.
- **X3-1-24** L2063–2082 사용자 메시지 전체 → 앞 대화에 원문으로 있다. 마지막 항목 L2082는 "C와 A"(L2019)다.

## 2. 사용자의 "C와 A" 답과 C/A 설계 ([57]~[58])

### 2.1 사용자 답

- **X3-2-01** L2016 [Claude] 확인 질문: "최근에 실제로 했던 작업 하나를 떠올려 보세요. 그 작업을 Concern 하나로 놓았을 때, 네 루프(O, I, C, A) 중 어느 루프를 가장 대충 지나갔거나 건너뛰었다고 생각하시나요? 답에 따라 엔진에서 어느 루프부터 강제할지 정하는 데 참고할 수 있습니다."
- **X3-2-02** L2019 [사용자] "C와 A". 사용자가 가장 많이 건너뛰거나 대충 지나가는 루프는 C(Commitment)와 A(Assurance & Adaptation)다. 브리프 §3.5의 "C/A를 가장 많이 건너뛴다는 진술"의 출처다. 이 범위의 이후 제안(구현 순서 X3-3-16, X3-5-08, X3-8-27)은 모두 이 답을 근거로 C·A를 먼저 둔다.

### 2.2 C와 A를 먼저 만드는 이유

- **X3-2-03** L2100 [Claude] O와 I는 모델의 판단이 많이 필요해서 코드로 강제하기 어렵다. C와 A는 대부분 상태 기록과 검사라서 코드로 강제하기 가장 쉽다. 그래서 C와 A부터 만드는 것을 제안한다.
- **X3-2-04** L2104–2109 [Claude] 일반 채팅 런타임에서 하나로 합쳐지는 것:

  | Helm이 구분하는 것 | 채팅 런타임에서 실제로 일어나는 일 |
  |---|---|
  | 지시 / 작업 합의 | 처음 보낸 지시문이 그대로 합의 역할을 함. 맡긴 범위, 멈출 조건, 제출할 근거가 비어 있음 |
  | 결과 제출 / 결과 확인 / 전체 반영 | 모델이 "완료했습니다"라고 쓰면 세 단계가 한꺼번에 끝난 것처럼 됨 |

- **X3-2-05** L2111 [Claude] C를 건너뛰면 A에서 확인할 기준도 없다. 완료 기준이 처음부터 없으니 결과 확인도 "대충 되는 것 같다"로 끝난다. 두 루프는 따로 빠진다기보다 같이 빠지는 경우가 많다.
- **X3-2-06** L2115 [Claude] C와 A에 해당하는 공리(A6, A7, A10, A13 등)는 모두 코드로 검사할 수 있는 항목이었다.

### 2.3 C: 작업 합의

- **X3-2-07** L2119 [Claude] 합의 기록의 항목: 목적, 완료 기준 목록, 맡긴 범위(허용하는 최대 effect class, 수정 가능한 경로), 금지 행동, 함께 제출할 근거, 멈출 조건. (브리프 용어집의 작업 합의 정의와 같다.)
- **X3-2-08** L2120–2125 [Claude] 강제 지점은 `tool_call` 이벤트다. 도구 호출마다 effect class를 분류한다. [이후 변경 가능: 브리프 결정 2 — effect class와 가역성 판별은 Helm 범위가 아니라 권한 레이어의 일]
  - read, grep, ls → R0
  - edit, write → 로컬에서 되돌릴 수 있는 변경
  - git push, publish, 외부 POST → 외부 행동
  - rm -rf, force push, 배포 → 되돌리기 어려운 외부 행동
  - 분류할 수 없는 bash 명령은 보수적으로 로컬 변경 이상으로 본다.
- **X3-2-09** L2126–2128 [Claude] 차단 규칙 두 가지:
  1. 활성 합의가 없는데 R0보다 높은 호출이 오면 차단하고 "작업 합의 먼저"를 반환한다.
  2. 합의 범위를 넘는 호출이 오면 차단하고 선택 요청을 연다. 이것이 `RequestedAuthority ⊆ CurrentAuthorityGrant` 검사다.
- **X3-2-10** L2129 [Claude] 합의를 만드는 방법: 모델이 `agreement.propose` 도구로 지시문에서 초안을 채운다. 사람은 `ctx.ui.select`로 확인, 수정, 취소 중 하나만 고른다. 읽기만 하는 작업은 합의 없이 진행한다. (읽기 작업 합의 면제는 브리프 결정 15(1) "write·send에는 작업 합의 필요"와 맞는다. UI가 pi `ctx.ui`라는 점은 [이후 변경 가능: 브리프 결정 19, 32])

### 2.4 A: 결과 제출 → 결과 확인 → 전체 반영

- **X3-2-11** L2133–2135 [Claude] `result.submit` 도구(`outputSchema` 사용) — 제출 형식:
  - 완료 기준마다 충족, 미충족, 확인 못함 중 하나와 근거를 적는다. 근거는 tool call id여야 한다.
  - 엔진은 그 id가 세션에 실제로 있는 도구 결과인지 확인한다. 근거가 모델이 쓴 문장뿐이면 해당 기준은 "확인 못함"으로 기록한다.
  - 앞서 정한 "관찰은 tool call id를 출처로 가져야 한다" 규칙과 같은 내용이다.
- **X3-2-12** L2136 [Claude] 제출 전 정리(`agent_before_settle`): 합의 아래에서 파일이 바뀌었는데 제출이 없으면 항목을 추가하고 한 번 더 실행을 요청한다. 문구: "결과 제출이 없습니다. 기준별 근거와 함께 제출하세요."
- **X3-2-13** L2137–2139 [Claude] 결과 확인은 사람만 한다. 모델에게는 accept 도구를 주지 않는다. 제출이 오면 `ctx.ui.select`로 수용 옵션 네 가지 중 하나를 고르게 한다: 확인, 조건부 확인, 수정 요청, 거절.
  - 수정 요청이면 합의는 그대로 두고 진행 중 상태로 돌아간다.
  - 완료 기준 자체가 틀렸다면 I 루프로 다시 연다.
- **X3-2-14** L2140 [Claude] 전체 반영 목록(통합 목록): 결과를 확인하면 엔진이 반영할 항목을 만든다.
  - 들어가는 것: 바뀐 파일과 관련된 문서와 테스트, 이 결과가 깨뜨린 이전 선택이나 전제, 다른 열린 초점과의 충돌.
  - 목록을 모두 처리하거나 명시적으로 미루기 전까지 상태는 "완료"가 아니라 "결과 확인됨"이다.
  - 남은 항목은 다음 `session_start`의 복귀 요약 맨 위에 보인다.
- **X3-2-15** L2141 [Claude] 돌아보기: 마지막에 "다음 합의에서 바꿀 것" 한 줄을 받는다. 선택 사항이다. 이 기록은 나중에 관찰 에이전트 C가 합의 템플릿을 고칠 때 재료로 쓴다.

### 2.5 C/A 상태 기계

- **X3-2-16** L2145–2152 [Claude] 원문:

  ```text
  (합의 없음) ─propose→ 범위 확인 중 ─사람 확인→ 맡김 완료 ─첫 변경 호출→ 진행 중
  진행 중 ─범위 초과→ 선택 필요 ─사람 선택→ 진행 중 | 범위 확인 중
  진행 중 ─result.submit→ 결과 확인 필요
  결과 확인 필요 ─확인/조건부 확인→ 결과 확인됨 ─반영 목록 처리→ 완료
  결과 확인 필요 ─수정 요청→ 진행 중
  결과 확인 필요 ─거절 / 기준이 틀림→ 다시 열림 (C 또는 I로)
  ```

  표로 옮기면 다음과 같다(내용은 원문 그대로, 표 형식만 바꿈).

  | 상태 | 이벤트 | 다음 상태 | 행위자 |
  |---|---|---|---|
  | 합의 없음 | `agreement.propose` | 범위 확인 중 | 모델 |
  | 범위 확인 중 | 사람 확인 | 맡김 완료 | 사람 |
  | 맡김 완료 | 첫 변경 호출 | 진행 중 | 모델(도구 호출) |
  | 진행 중 | 범위 초과 | 선택 필요 | 엔진(차단) |
  | 선택 필요 | 사람 선택 | 진행 중 또는 범위 확인 중 | 사람 |
  | 진행 중 | `result.submit` | 결과 확인 필요 | 모델 |
  | 결과 확인 필요 | 확인 / 조건부 확인 | 결과 확인됨 | 사람 |
  | 결과 확인됨 | 반영 목록 처리 | 완료 | 엔진(목록 처리 또는 명시적 미룸) |
  | 결과 확인 필요 | 수정 요청 | 진행 중 | 사람 |
  | 결과 확인 필요 | 거절 / 기준이 틀림 | 다시 열림(C 또는 I로) | 사람 |

  원문에 없는 전이: 범위 확인 중에서 "수정", "취소"(X3-2-10의 선택지)가 어디로 가는지, 합의가 끝나는 조건, 멈출 조건 충족 시의 전이.
- **X3-2-17** L2154 [Claude] 상태 전이는 엔진만 실행한다. 모델은 도구로 후보만 제출하고 저장소를 직접 쓰지 못한다. (브리프 결정 14 커널 원칙과 같다.)

### 2.6 가장 큰 위험과 대응

- **X3-2-18** L2158 [Claude] 가장 큰 위험은 이 장치 자체를 건너뛰게 되는 것이다. C와 A를 건너뛴 이유가 "귀찮아서"라면, 엔진이 묻는 횟수가 많아질수록 또 우회하게 된다.
- **X3-2-19** L2160 [Claude] 사람 조작 2회 상한: "사람이 하는 일은 고르기 두 번이 상한입니다. 합의 확인 한 번, 결과 확인 한 번입니다. 나머지는 모델이 초안을 채우고 엔진이 검사합니다." (브리프 §3.5 "사람 조작 2회 상한"의 출처)
- **X3-2-20** L2161–2168 [Claude] 2주 지표. 2주 동안 다음 값을 기록한다.
  1. 합의를 우회하거나 취소한 비율
  2. 범위 초과로 차단된 횟수
  3. 근거 없이 제출된 기준의 수
  4. 결과 확인까지 걸린 시간
  5. 열린 채 남은 반영 항목의 수

  우회 비율이 높으면 엔진이 무겁다는 뜻이다. "이것이 Helm의 반증 조건을 개인 엔진에 맞게 줄인 형태입니다." (브리프 §3.5 "2주 우회율 지표"의 출처)
- **X3-2-21** L2170 [Claude] 제안(답 없음): 상태 기계와 pi 확장 뼈대(`tool_call` 차단, `agreement.propose`, `result.submit`, `agent_before_settle`, 결과 확인 UI)를 작성하고, 가짜 모델로 작은 작업 하나를 합의부터 완료까지 돌려 각 지점의 차단과 기록을 보여 주겠다. 사용자는 이 제안에 답하지 않고 다음 질문([59])으로 넘어갔다.

## 3. 세계 모델·단위·루프의 런타임 ([59]~[61])

- **X3-3-01** L2173 [사용자] 요구: "HELM의 세계 모델, 일의 단위와 세부개념 운영 루프 구조(세부 및 거시 버전 둘다), 이해의 단계 개념은 에이전트 런타임으로서 구현하고싶은데 어떻게 생각함? pi 나 기존에 얘기했던 RLM 등의 개념을 사용해서 런타임 구조적으로 helm 세계를 구현해보고싶은데"
- **X3-3-02** L2176, L2179 [Claude] 위젯 `helm_runtime_four_layer_architecture`(내용 없음). 본문 설명: "보라색 두 층(저장소, 엔진)이 Helm 자체이고, 청록색 두 층은 pi 대신 다른 런타임으로 바꿀 수 있는 부분입니다." 처음 말한 벤더 중립 하네스 구조와 같은 방향이다. 청록색 두 층의 이름은 원문에 없다(요약본 L2038의 구조로 보면 내부 루프 런타임 쪽이다). [이후 변경 가능: 브리프 결정 23, 28 — 자체 런타임, pi-agent-core 포크]

### 3.1 평면

- **X3-3-03** L2183–2189 [Claude] 세계 모델 N/E/M | A/P의 런타임 위치:

  | 평면 | 런타임에서의 위치 | 바꿀 수 있는 주체 |
  |---|---|---|
  | N 방향 | 저장소 레코드: 목표, 초점, 완료 기준, 선택, 작업 합의 | 사람, 또는 사람이 확인한 제안 |
  | E 이해 | 저장소 레코드: 관찰, 해석, 가능성, 판단과 각각의 품질 상태 | 모델은 제출만 할 수 있고, 승격은 엔진만 함 |
  | M 실제 | 저장하지 않음. git sha, 파일 경로, 실행 결과 같은 참조만 둠 | 도구 실행 |
  | A 참여자 | 엔진 설정: 사람, 에이전트 세션, 검증자, 도구, 그리고 합의별 권한 부여 | 사람 |
  | P 정책 | 설정 파일: effect class 분류, 선택 요청 조건, Quick/Guided/Assured 프로필 | 사람 (관찰 에이전트 C가 수정안을 제안) |

- **X3-3-04** L2191 [Claude] M을 저장소에 복사하지 않고 참조만 두는 것이 "기록은 진실이 아니다"를 구조로 옮긴 부분이다. 기록과 실제가 어긋나면 기록 쪽을 stale로 표시한다.

### 3.2 일의 단위와 수명

- **X3-3-05** L2195–2200 [Claude]

  | 단위 | 런타임 대응 | 수명 |
  |---|---|---|
  | 목표 | 루프 없음. N 레코드만 있음 | 몇 주에서 몇 달 |
  | 초점(Concern) | 엔진 상태 기계 인스턴스 하나 | 며칠, 여러 세션에 걸침 |
  | 진행 작업(WorkUnit) | 작업 합의 하나에 묶인 pi 세션 실행 1회 (또는 Pi Durable task) | 몇 분에서 몇 시간 |
  | 하위 호출 | 진행 작업 안의 RLM 호출이나 서브에이전트 | 몇 초에서 몇 분 |

- **X3-3-06** L2202 [Claude] pi의 세션 트리(branch, fork)와 codemode store는 세션 단위라서 Helm의 정본 저장소로 쓰면 안 된다. 정본은 엔진 저장소에 두고 pi 세션 transcript는 "이 진행 작업의 실행 기록"으로 M 쪽에서 참조한다. 근거: 앞선 실험에서 branch A와 branch B의 codemode store가 서로 다르게 나왔다. (브리프 결정 29와 같은 방향)

### 3.3 루프 세 크기

- **X3-3-07** L2206–2208 [Claude]
  - **세부 루프(10단계)**: 초점 상태 기계의 세부 상태. 단계마다 내부 루프의 모드(쓸 수 있는 도구, 프롬프트, 권한)가 바뀐다.
  - **중간 루프(O/I/C/A)**: 초점 상태 기계의 큰 상태. 다시 열림(re-entry)은 이 수준에서 일어난다.
  - **거시 루프**: 여러 초점 사이의 일. 복귀 요약, 사람의 주의를 어디에 쓸지, 다시 볼 조건 감시. "제한된 사람의 주의 아래에서의 정당한 진척"이 실제로 다뤄지는 곳이다.

### 3.4 10단계 계약

- **X3-3-08** L2212–2223 [Claude] 10단계를 모드로 옮긴 표(원문 그대로):

  | 단계 | 루프 | 쓸 수 있는 도구 | 모델이 제출하는 것 | 엔진이 검사하는 것 |
  |---|---|---|---|---|
  | Sense | O | 읽기, `helm.query` | 상황 요약 후보 | 요약의 각 문장이 레코드를 참조하는가 |
  | Frame | O | 읽기 | 문제 관점 후보 | 목표와 연결되는가 |
  | Diverge | I | RLM 하위 호출 | 가능성 여러 개 | 각 가능성에 구분할 다음 확인이 있는가 |
  | Investigate | I | 읽기, 실행(R0) | 해석 | 관찰 id를 참조하는가 |
  | Deliberate | I→C | 없음 | 판단 후보, 선택지 | 승격 규칙, 선택 요청 조건 |
  | Commit | C | `agreement.propose` | 합의 초안 | 사람 확인 |
  | Execute | C→A | 합의가 허용한 변경 도구 | 없음 | 요청한 권한이 부여된 권한 안에 있는가 |
  | Assure | A | `result.submit`, 독립 검증자 | 기준별 근거 | 근거 id가 실재하는가 |
  | Integrate | A | 읽기, 영향 범위 탐색 | 반영 목록 | 목록을 처리했는가 |
  | Reflect | A | 없음 | 한 줄 | 없음 (관찰 에이전트 C가 나중에 수집) |

- **X3-3-09** L2225 [Claude] Quick 프로필에서는 R0~R1 작업일 때 O와 I를 한 번의 호출로 압축한다. Assured 프로필에서는 모든 단계를 통과해야 한다. [이후 변경 가능: 브리프 결정 3 — 모드·다이얼 체계. Quick/Guided/Assured는 v0.2 profile 이름]

### 3.5 이해의 단계 (관찰 → 해석 → 가능성 → 판단 → 선택)

- **X3-3-10** L2229–2234 [Claude] 생성·승격 규칙:
  - **관찰**: 모델이 만들 수 없다. `tool_result`가 올 때 어댑터가 tool call id, 명령, 출력 참조로 자동 생성한다. 사람의 발화도 출처가 사람인 관찰로 기록한다.
  - **해석**: 모델이 제출하고 관찰 id를 하나 이상 참조해야 한다. 참조가 없으면 해석이 아니라 "전제"로 기록한다.
  - **가능성**: 모델이 제출한다. 지지 근거, 약화 근거, 구분할 다음 확인을 칸으로 둔다.
  - **판단**: 가능성을 판단으로 올리는 것은 엔진 이벤트로만 할 수 있다. 조건 세 가지: 지지 근거가 관찰을 참조할 것, 반대 근거를 검토한 기록이 있을 것, 영향이 낮아 정책이 허용하는 경우가 아니라면 사람이 확인할 것.
  - **선택**: 판단에서 자동으로 나오지 않는다. 사람이 하거나 맡긴 범위 안에서 정책이 한다.
  - **다시 열림**: 새 관찰이 기존 판단의 근거와 맞지 않으면 그 판단은 contested가 되고 초점이 다시 열린다. "맞지 않는다"를 알아보는 것은 모델(검증자 하위 호출)의 일이고, 상태를 바꾸고 기록하는 것은 엔진의 일이다.

### 3.6 RLM과 codemode 적용 지점

- **X3-3-11** L2238–2245 [Claude] RLM의 핵심("컨텍스트를 메시지 배열이 아니라 바깥 변수에 두고, 루트 모델은 질의만 한다")에서 Helm 저장소가 바깥 변수 역할을 한다. RLM이 쓰이는 네 곳:
  1. **복귀 요약(O)**: 저장소 전체를 프롬프트에 넣지 않는다. 루트 모델은 투영된 요약만 보고 필요하면 `helm.query`와 하위 호출로 내려가 확인한다. 앞선 실험에서 데이터 약 99k 토큰에 루트 컨텍스트 96 토큰이었던 구조와 같다.
  2. **발산(I)**: 목적 사다리, 분해, 대안, 실패와 부작용, 렌즈마다 하위 호출을 하나씩 돌린다. 결과는 판단이 아니라 가능성 후보로만 저장소에 들어간다.
  3. **검증(A)**: 작업한 모델의 추론을 보지 않는 새 컨텍스트 하위 호출. 합의, 완료 기준, 근거 id만 받는다.
  4. **반영(A)**: 저장소와 저장소의 영향 범위를 탐색한다.

  codemode는 하위 호출들을 병렬로 묶는 데 적합하다(실험: 순차 1758ms → Promise.all 275ms). 다만 codemode store는 정본으로 쓰지 않는다.

### 3.7 어려운 점

- **X3-3-12** L2249 [Claude] 개념 수: Helm 문서에는 개념이 40개 넘게 있다. 처음부터 전부 만들면 이전 구현처럼 구조가 무거워진다. 레코드 타입 10개 정도로 시작한다: 목표, 초점, 관찰, 해석, 가능성, 판단, 선택, 합의, 결과, 반영 항목.
- **X3-3-13** L2250 [Claude] 사람 입력 병목: dogfood 기록에서 "ㅇ" 같은 짧은 입력이 결정 근거로 남아 있었다. 구조화된 칸을 사람이 채우게 하면 같은 일이 반복된다. "모델이 초안을 쓰고 사람은 고르기만 하는 방식이어야 합니다." [이후 변경 가능: 브리프 결정 18 — 핵심 원칙은 "모델이 초안을 쓰고 사람은 반응·수정한다"이고, 대안 2~3개를 고르게 하는 상호작용은 거부되었다]
- **X3-3-14** L2251 [Claude] 보장 범위: 관찰과 해석을 섞는 것은 구조로 막을 수 있다. 해석의 질, 가능성 목록의 다양성, 다시 열 시점을 알아차리는지는 모델 성능에 달려 있다. 엔진이 보장하는 것은 "잘못된 승격이 일어나지 않는다"까지다.
- **X3-3-15** L2252 [Claude] 비용과 지연: 단계마다 호출이 늘어난다. 프로필로 압축하지 않으면 작은 작업에서 우회하게 된다.

### 3.8 만드는 순서

- **X3-3-16** L2256–2261 [Claude] C와 A를 가장 많이 건너뛴다는 답에 따라 그 부분을 바닥으로 깔고 위로 올라가는 순서:
  1. 저장소, 관찰 자동 기록, C/A 상태 기계 (나머지 모든 단계가 관찰 레코드와 합의에 의존하므로 먼저)
  2. O: RLM 방식의 복귀 요약
  3. I: 발산 서브시스템과 승격 규칙
  4. 거시 루프: 여러 초점, 주의 예산, 다시 볼 조건 감시
- **X3-3-17** L2263 [Claude] 제안(답 없음): 1단계(저장소 스키마, 엔진 상태 기계, pi 확장 어댑터)를 작성하고 가짜 모델로 작은 작업 하나를 Orient부터 Integrate까지 돌려 기록과 차단 결과를 보여 주겠다.

## 4. pi 안의 Helm ([62]~[63])

- **X3-4-01** L2266 [사용자] 질문: "helm을 별도 엔진으로 두지 않고, pi 런타임 내에서 구현하는 방식으로 아키텍쳐를 디자인 가능할까?"
- **X3-4-02** L2269–2272 [Claude] 가능하며 개인용이라면 출발점으로 더 낫다고 본다. "별도 엔진 없이"를 둘로 나눈다.
  - **프로세스로서의 엔진을 없애는 것**: 엔진 로직을 pi 확장 안에서 돌린다. 문제없이 가능하고 별도 프로세스와 통신 비용이 사라진다.
  - **저장소까지 pi 세션 안에 두는 것**: `appendEntry`만으로 모든 상태를 관리한다. 초점이 세션 하나 안에서 끝나면 되지만, Helm의 초점은 며칠에 걸쳐 여러 세션을 넘나들어 세션 엔트리만으로는 부족하다.
- **X3-4-03** L2274 [Claude] 권하는 형태는 "프로세스는 하나, 코드는 둘"이다. 엔진은 pi 확장 안에서 돌고, 정본 기록은 확장이 관리하는 프로젝트 파일(`.helm/ledger.jsonl`)에 둔다. 엔진 로직은 pi를 import하지 않는 순수 모듈로 따로 둔다. 다른 런타임으로 옮길 때 어댑터만 다시 쓴다. [이후 변경 가능: 브리프 결정 23(자체 런타임), 29(정본은 SQLite 이벤트 로그), 22(데몬 상주)] 순수 모듈 분리는 브리프 §3.1의 `@helm/kernel`(I/O 없음)과 같은 방향이다.

### 4.1 원장

- **X3-4-04** L2282 [Claude] 정본 기록(N/E, M 참조)은 확장이 여는 `.helm/ledger.jsonl` + 메모리 투영. append-only 이벤트. 세션에는 `appendEntry("helm-event")`로 사본만 남겨 세션 트리의 어느 시점에 어떤 상태였는지 추적한다.
- **X3-4-05** L2326, L2343 [Claude] ledger는 append-only 기록에 해시 체인을 둔다. 엔진을 거치지 않은 변경(예: 모델이 bash로 ledger를 고침)을 다음 로드 때 감지하기 위해서다.
- **X3-4-06** L2344 [Claude] pi 프로세스 여러 개가 같은 ledger를 동시에 쓰므로 파일 락을 두고 한 번에 한 줄만 추가하는 규칙이 필요하다.

### 4.2 기능 대응

- **X3-4-07** L2276 [Claude] 대응표는 "설치된 pi 1.1.0의 확장 타입 정의에서 확인한 기능으로" 만들었다. [원문: 대화 당시 설치 패키지의 타입 정의]
- **X3-4-08** L2280–2295 [Claude] Helm 요소와 pi 기능 대응(원문 그대로):

  | Helm 요소 | pi 기능 | 하는 일 |
  |---|---|---|
  | 정본 기록 (N/E, M 참조) | 확장이 여는 `.helm/ledger.jsonl` + 메모리 투영 | append-only 이벤트. 세션에는 `appendEntry("helm-event")`로 사본만 남겨, 세션 트리의 어느 시점에 어떤 상태였는지 추적 |
  | 관찰 자동 생성 | `tool_result`, `user_bash` | tool call id를 출처로 관찰 레코드 생성. `parentToolCallId`가 있어 codemode 안에서 일어난 중첩 호출도 관찰로 잡힘 |
  | 사람 발화 | `input` 이벤트 | 출처가 사람인 관찰로 기록. `transform`으로 현재 초점 정보를 붙일 수도 있음 |
  | 루프·단계 모드 | `before_agent_start`, `context`, `pi.setActiveTools` | 단계마다 지시문, 현재 투영, 쓸 수 있는 도구를 바꿈 |
  | 모델의 후보 제출 | `registerTool` + `outputSchema` | `helm_frame`, `helm_possibility`, `helm_interpret`, `helm_propose_agreement`, `helm_submit_result` |
  | 권한 검사 | `tool_call`의 `block` | 합의 없는 변경, 범위를 넘는 호출, `.helm/` 직접 쓰기를 차단 |
  | 루프 종료 조건 | `agent_before_settle` (`entries`, `continue`) | 제출 없이 끝나려 하면 한 번 더 실행을 요청 |
  | 선택 요청, 결과 확인 | `ctx.ui.select / confirm / input` | 확인, 조건부 확인, 수정 요청, 거절 |
  | 진행 상황 상시 표시 | `ctx.ui.setStatus`, `setWidget` | 현재 초점, 단계, 맡긴 범위, 지켜보는 위험 |
  | 사람이 직접 하는 조작 | `registerCommand` | `/focus`, `/brief`, `/agree`, `/accept`, `/reopen` |
  | 복귀 요약 | `session_start` → `sendMessage` | 열린 초점, 남은 반영 항목, 선택 필요 항목 |
  | 요약이 이견을 지우지 않게 | `session_before_compact` → 직접 만든 `compaction` | 컴팩션할 때 목표, 합의, 열린 판단, 반대 근거를 그대로 남김 |
  | RLM 하위 호출 | `ctx.model` + `ctx.modelRegistry.getApiKeyAndHeaders` → pi-ai 직접 호출 | 세션 없이 한 번만 하는 호출이 RLM의 `llm_query`에 해당. codemode에 노출하면 Promise.all로 축별 병렬 실행 가능 |
  | 독립 검증자 | 명령 컨텍스트의 `ctx.newSession`, 또는 `pi -p` 자식 프로세스 | 작업자의 추론을 보지 않는 새 컨텍스트 |

- **X3-4-09** L2297–2299 [Claude] pi 안에 넣을 때 유리한 점 1: `session_before_compact`. 별도 엔진 방식에서는 컴팩션이 런타임 안에서 일어나 Helm이 손댈 수 없었다. pi 안에서는 컴팩션 결과를 Helm 투영으로 바꿀 수 있다. "요약은 중요한 이견을 지우면 안 된다"는 원칙(A9)을 코드로 보장한다.
- **X3-4-10** L2300 [Claude] 유리한 점 2: 세션 트리(fork, tree)를 가능성 탐색 공간으로 쓴다. 가설마다 브랜치를 하나씩 열어 확인하고, 그 브랜치에서 나온 레코드에는 branch id를 붙인다. 채택된 브랜치의 결과만 판단으로 승격한다. `session_before_fork`와 `session_tree` 이벤트로 이 연결을 기록한다.

### 4.3 한 턴의 흐름

- **X3-4-11** L2304–2316 [Claude] 원문:

  ```text
  사용자 입력        → input: 사람 출처 관찰 H-3 기록
  before_agent_start → 초점 F-1, 단계 Investigate: 읽기 도구만 활성화, 투영 주입
  모델: read 호출     → tool_call: R0 허용 → tool_result: 관찰 O-12 생성
  모델: helm_interpret(refs: [O-12]) → 엔진: 참조 확인 후 해석 I-4 기록
  모델: edit 호출     → tool_call: 활성 합의 없음 → 차단 "작업 합의 먼저"
  모델: helm_propose_agreement → ctx.ui.select [확인 / 수정 / 취소] → 확인
                      → 단계 Execute, 변경 도구 활성화
  모델: edit, bash test → 관찰 O-13, O-14
  agent_before_settle → 결과 제출 없음 → continue: true
  모델: helm_submit_result(기준별 근거: O-14) → 결과 확인 UI → 확인
                      → 반영 목록 생성, 상태 "결과 확인됨", setWidget 갱신
  ```

  이 흐름은 테스트 시나리오(가짜 모델 재생)로 그대로 쓸 수 있는 순서다.

### 4.4 폴더 구조

- **X3-4-12** L2320–2338 [Claude] 원문:

  ```text
  helm-pi/
    core/            pi import 없음. 다른 런타임에서도 재사용
      schema.ts      레코드 타입 약 10개
      ledger.ts      append-only 기록, 해시 체인
      machine.ts     초점 상태 기계 (O/I/C/A, 10단계)
      promote.ts     관찰→해석→가능성→판단 승격 규칙
      policy.ts      effect class 분류, 선택 요청 조건, 프로필
      project.ts     복귀 요약과 컴팩션용 투영
    pi/              얇은 어댑터
      index.ts       이벤트 연결
      tools.ts       helm_* 도구
      commands.ts    /focus /brief /agree /accept /reopen
      ui.ts          select, widget
      subcall.ts     pi-ai 직접 호출, 검증자 세션
  <프로젝트>/.helm/
    ledger.jsonl
    policy.yaml
  ```

  [이후 변경 가능: 브리프 §3.1 저장소 구조와 결정 29] 브리프는 패키지를 `@helm/kernel`, `@helm/store` 등으로 나누고 정본을 SQLite에 둔다.

### 4.5 한계

- **X3-4-13** L2342 [Claude] 한계 1: 세션이 열려 있을 때만 동작한다. 거시 루프의 "다시 볼 조건 감시"나 관찰 에이전트 C처럼 사람이 없을 때 돌아야 하는 것은 확장만으로 할 수 없다. 스케줄로 `pi -p`를 실행해 보완한다(이것도 pi로 돌리는 것이라 "pi 안" 원칙은 유지). Pi Durable의 백그라운드 task도 후보지만 아직 실험 단계다. [이후 변경 가능: 브리프 결정 22 — 데몬 상주로 해결]
- **X3-4-14** L2343 [Claude] 한계 2: 모델과 엔진이 같은 프로세스, 같은 파일 시스템을 쓴다. 모델이 bash로 `.helm/ledger.jsonl`을 직접 고칠 수 있다. edit와 write는 `tool_call`에서 경로로 막을 수 있지만 bash 명령은 패턴 검사가 완전하지 않다. ledger 해시 체인으로 엔진을 거치지 않은 변경을 다음 로드 때 감지한다. (브리프 §3.5 "bash·execute로 쓰기 범위 검사 우회 문제")
- **X3-4-15** L2344 [Claude] 한계 3: pi 프로세스 여러 개가 같은 ledger를 동시에 쓴다. 파일 락과 한 번에 한 줄 추가 규칙이 필요하다.
- **X3-4-16** L2345 [Claude] 한계 4: pi 1.x API는 빠르게 바뀐다. core와 pi를 나눠 두는 이유가 여기에도 있다.
- **X3-4-17** L2347 [Claude] 별도 프로세스가 꼭 필요한 경우는 두 가지뿐이다: 사람이 없을 때 감시를 돌려야 할 때, 여러 런타임을 동시에 쓸 때. 지금 조건(개인용, pi 하나)이라면 pi 안에 넣고 core만 분리해 두는 것으로 충분하다. [이후 변경 가능: 브리프 결정 22, 23, 34 — 데몬 상주, 자체 런타임, 런타임 어댑터]
- **X3-4-18** L2349 [Claude] 제안(답 없음): 이 구조로 1단계(core의 ledger, 상태 기계, 승격 규칙 + pi 어댑터의 관찰 자동 기록, 합의 차단, 결과 제출, 결과 확인 UI)를 만들고 pi 확장 테스트 하네스에서 한 턴 흐름을 재현하겠다.

## 5. 피처 흐름 미리보기와 pi-durable 위의 공리 장치 ([64]~[67])

- **X3-5-01** L2352 [사용자] 요구: "실제 특정 프로젝트 개발 피쳐 작업을 하나 진행한다고 했을때, 어떤 흐름으로 작업이 진행되는지를 프리뷰 비쥬얼라이제이션 해줘. 그리고 pi durable이나 서브에이전트, 익스텐션 등을 사용해 HELM의 공리를 더 정확하고 결정성있게 구현할 수 있는 방안으로 고도화해봐."
- **X3-5-02** L2355, L2358 [Claude] 위젯 `helm_feature_flow_url_filter_sync_preview`(이름으로 보아 URL 필터 동기화 피처를 예로 든 흐름), `helm_on_pi_durable_ownership_tree`(pi-durable 소유 트리). 내용은 원문에 없다. L2415에 따르면 미리보기에는 적어도 6~9단계로 "합의, 실행 중 차단, 재시작 후 재개, 검증자의 반대 근거, 반영 대기"가 있었다. [이후 변경 가능: 브리프 결정 29 — pi-durable은 설계·코드 참고용이며 기준 원본이 아니다]

### 5.1 소유 규칙

- **X3-5-03** L2361–2366 [Claude] pi-durable의 소유 규칙을 Helm에서 그대로 활용한다.
  - **취소는 아래에서 위로 전파된다.** 초점을 취소하면 그 초점이 소유한 분기, 작업, 검증자가 먼저 취소되고, 각자 자기 효과를 정리한 뒤 초점이 끝난다.
  - **소유한 작업이 남아 있으면 끝나지 않는다.** 결과가 정해진 task라도 소유한 일이 남아 있으면 `completing` 상태로 머문다. Helm의 "결과 확인됨이지만 반영 전이라 완료 아님"을 런타임 기본 동작으로 처리한다.
  - **감시만 `background: true`로 분리한다.** 다시 볼 조건 감시는 초점 취소나 대기의 영향을 받지 않아야 한다.
  - **검증자는 fork가 아니라 새 대화다.** fork는 부모의 기록을 분기 시점까지 그대로 보기 때문에 작업자의 추론을 보지 않는다는 조건이 깨진다.

### 5.2 공리 장치 표

- **X3-5-04** L2370–2385 [Claude] 공리별 구현과 결정성 수준(원문 그대로):

  | 공리 | pi-durable 장치 | 보장 수준 |
  |---|---|---|
  | A1 목적 먼저 | Concern task의 `initial(input)`이 목표 id와 완료 기준을 요구. orient phase에서는 변경 도구가 `configure({tools})`에 아예 없음 | 코드 보장 |
  | A5 상태 구분 | 관찰은 `afterTool` 훅만 생성. 해석 도구는 참조한 관찰 id를 같은 commit 안에서 검증. 판단 승격은 task phase만 수행 | 코드 보장 (해석의 질은 모델 몫) |
  | A6 제안과 약속 | 선택과 결과 확인은 host가 쓰는 `write` 항목으로만 생김. 모델 도구 목록에 accept 계열 없음. `memo` 첫 기록 우선이라 조용히 덮어쓸 수 없음 | 코드 보장 |
  | A7 위험 적응 권한 | `beforeTool`에서 effect class 판정 후 `helm.agreement` 문서와 비교해 block. R0 도구만 `replay: "safe"` | 코드 보장 (bash 명령 분류는 휴리스틱) |
  | A10 제출·확인·반영 | WorkUnit phase(진행→제출→확인), 반영 항목은 하위 task, `completing` 상태 | 코드 보장 |
  | A11 시점별 투영 | projection은 `section`으로 렌더되고, 섹션 변경은 transcript에 위치를 가진 시스템 항목으로 남음. 모델이 어떤 판단을 내렸을 때 어떤 투영을 보고 있었는지 사후에 확인 가능 | 코드 보장 |
  | A13 낡음 | 근거마다 파일@sha 기록. 파일 해시가 바뀌면 근거가 자동으로 stale. 문서 `history: "rewindable"`과 `snapshotAsOf`로 특정 시점 상태 조회. 감시는 `sleep(until)` | 코드 보장 (조건 판정 일부는 모델) |
  | A9 차이 보존 요약 | `CompactionTask`의 `beforeCompact` 훅에서 Helm 요약으로 교체. 열린 반대 근거 id가 모두 들어갔는지 코드로 검사 | 누락은 코드로 검사, 요약 문장의 질은 모델 몫 |
  | A4 가설 다양성 | 같은 항목에서 fork하고 축마다 다른 지시문을 줌. 분기끼리는 서로 결과를 볼 수 없음 | 독립성은 구조로 보장, 다양성은 모델 몫 |
  | A3 문제 재정의 | frame 문서는 rewindable. 반대 근거가 생기면 Concern이 orient로 돌아감 | 전이와 기록은 보장, 충돌 판단은 모델 몫 |
  | A8 낮은 수준 결정 | 선택 요청 조건을 정책 함수로 둠. 초점마다 질문 수 예산 | 규칙은 보장, 조건 입력값은 모델 추정 |
  | A14 실패는 신호 | 차단, 중단(`interrupted`), 실패한 tool 결과가 자동으로 관찰이 됨. 저장소는 이전 항목을 지우지 않음 | 코드 보장 |
  | A15 공동 저작 | 확인/취소 대신 기준·초점 수정 선택지를 줌. 실행 중 수정은 `whenBusy: "steer"`로 넣고 N 평면 이벤트로 기록 | UI 설계 |
  | A2, A12 | `pi.usage`(활동량)와 정당화된 전이 수를 함께 측정. 사람이 직접 바꾼 기준과 재정의 비율을 주간 집계 | 측정만 |

  이 표에 없는 공리: 없음(A1~A15 모두 있음). 앞 대화의 분류(X3-1-20)와 비교하면 A4·A3·A8·A14가 "모델+코드 검사"에서 일부 구조 보장으로 올라갔다. 브리프 §3.5 "공리 A1~A15 전체 대응(분류, 집행 지점, 보장 수준, 위반 테스트)"의 재료다.
- **X3-5-05** L2387–2390 [Claude] 코드 보장 범위가 넓어지는 근거 두 가지:
  1. **원자적 commit**: 이전 설계에서는 Helm 기록(`.helm/ledger.jsonl`)과 pi 세션 기록이 따로 쓰여 어긋날 수 있었다. pi-durable에서는 tool 결과 항목, 관찰 문서, task checkpoint가 commit 하나로 함께 들어가거나 함께 실패한다.
  2. **도구 목록 자체를 phase로 제어**: 이전에는 차단에 의존했다. 이제는 그 단계에서 쓰면 안 되는 도구를 아예 제공하지 않을 수 있다.

### 5.3 결정적으로 만들 수 없는 것

- **X3-5-06** L2394–2399 [Claude]
  - 해석과 가능성의 질, 발산 결과가 실제로 서로 다른지
  - 새 관찰이 기존 판단과 "맞지 않는다"는 판정
  - 선택 요청 조건의 입력값. 특히 "사람의 답이 결과를 바꾸는가"는 모델이 추정한다.
  - bash 명령의 effect class 분류. 명령 문자열로 판정해 우회 여지가 남는다. 보완책 두 가지: pi-durable의 `env`로 대화마다 별도 실행 환경(작업 디렉터리나 컨테이너)을 주는 것, 저장소를 그 환경 밖에 두는 것.

  엔진이 보장하는 것은 "모델이 틀려도 잘못된 승격, 범위 밖 실행, 확인 없는 완료가 일어나지 않는다"까지다. 모델이 맞게 판단하는지는 측정으로만 확인한다.

### 5.4 비용과 위험

- **X3-5-07** L2403–2406 [Claude]
  - **UI를 직접 만들어야 한다.** pi-durable에는 TUI가 없다. pi-tui 패키지와 `watchEvents`(실험적), `viewState`로 터미널 클라이언트를 만들어야 하고 이 작업이 가장 크다. 예제 `26-coding-agent`, `27-plan-mode`, `28-reviewer`가 출발점이다.
  - **실험 단계 패키지다.** 1.1.0이고 README의 Agent Events 절도 Experimental로 표시되어 있다. core를 pi-durable 타입에 직접 묶지 않는다.
  - **저장소 하나에 프로세스 하나다.** 프로세스 간 락이 없다. 관찰 에이전트를 별도 프로세스로 돌리려면 같은 프로세스 안에서 ownerless 대화로 돌리거나 저장소 사본을 읽어야 한다.
  - **pi coding agent 확장 생태계를 재사용할 수 없다.** codemode는 pi coding agent 쪽 기능이라 pi-durable에서는 같은 방식으로 붙지 않는다. RLM식 병렬 하위 호출은 subagent 도구로 대신한다.

### 5.5 권하는 순서

- **X3-5-08** L2410–2413 [Claude]
  1. **core 순수 모듈**: 스키마, 상태 기계, 승격 규칙, 정책. 런타임과 무관하게 작성한다.
  2. **pi-durable 어댑터**: Concern과 WorkUnit task, helm 문서, `beforeTool`/`afterTool` 훅, 검증자 subagent. 이번에는 C와 A 루프만 만든다.
  3. **최소 터미널 클라이언트**: 입력, 진행 표시, 선택 요청과 결과 확인 UI.
  4. **그다음 확장**: O의 복귀 요약과 `beforeCompact`, I의 fork 발산, 거시 루프의 background 감시를 차례로 붙인다.
- **X3-5-09** L2415 [Claude] 제안(답 없음): 1, 2단계를 pi-durable의 faux provider로 작성해 미리보기 6~9단계(합의, 실행 중 차단, 재시작 후 재개, 검증자의 반대 근거, 반영 대기)를 재현하겠다.
- **X3-5-10** L2417–2420 [Claude] 출처: `@earendil-works/pi-durable 1.1.0 README (npm 패키지로 설치해 확인)` (github.com/earendil-works/pi/tree/main/packages/durable), withone.ai 블로그 "We killed a Pi Durable agent after a Gmail write", besthub.dev "Pi 1.0 & Pi Durable: Unkillable Agent Harness".

## 6. 문제 해결 방안을 찾는 탐구 흐름과 범주 한정 Helm ([68]~[71])

- **X3-6-01** L2423 [사용자] 요구: "뭔가 특정 피쳐 해결 보다, 어떤 문제를 해결하기 위한 여러 방안을 찾아가는 과정에 초점을 두고 싶은데". (브리프 결정 1 원함 발견·발산 동기와 이어지는 사용자 요구)
- **X3-6-02** L2426–2428 [Claude] O와 I 루프 중심으로 다시 그렸다. 예시 문제는 "첫 화면이 느리다는 얘기가 계속 나온다"처럼 막연한 상태에서 출발한다. 화면의 수치는 모두 예시다. 단계마다 "누가 정하나" 줄을 추가했다. "결정성을 높인다는 것은 결국 이 줄에서 코드가 맡는 부분을 늘리는 일"이다. 위젯 `helm_inquiry_flow_slow_first_screen_preview`(L2431, 내용 없음).

### 6.1 코드로 정하는 탐구의 네 결정

- **X3-6-03** L2436 [Claude] 발산의 내용은 모델이 만들고, 발산의 방향·순서·멈춤은 코드로 정한다.
- **X3-6-04** L2438 [Claude] 1. 어디로 발산할지: "관점 × 바꾸는 대상" 표에서 빈 칸을 코드가 찾고 칸마다 fork를 하나씩 만든다. RLM에서는 분해를 모델이 정했지만 여기서는 분해를 코드가 정하고 각 칸의 내용만 모델이 채운다. 모델이 익숙한 방향(평균값)으로만 발산하는 것을 구조로 막는 장치다. ("바꾸는 대상" 열의 구체적 범주는 위젯에 있었고 원문에는 없다.)
- **X3-6-05** L2439 [Claude] 2. 어떤 확인을 먼저 할지: 모델은 "각 관점이 이 확인 결과를 어떻게 예측하는지"와 비용만 선언한다. 순서는 코드가 "갈리는 관점 수 ÷ 비용"으로 계산한다.
- **X3-6-06** L2440 [Claude] 3. 무엇을 물을지: 모델이 질문 후보를 여러 개 낸다. 코드는 "답에 따라 1순위 해법이 바뀌는가"를 기준으로 하나만 고른다.
- **X3-6-07** L2441 [Claude] 4. 언제 멈출지: 1순위가 두 라운드 연속 유지되고 남은 질문이 결과를 바꾸지 않으면 멈춘다. 예산이 먼저 소진되면 그 시점에 멈추고 열린 질문을 그대로 넘긴다.
- **X3-6-08** L2443 [Claude] 한계: 모델이 선언한 예측과 비용이 틀리면 계산도 틀린다. 선언 내용이 기록에 남아 어디서 틀렸는지 추적할 수 있다. 표의 열(바꾸는 대상 범주)을 고정하면 그 자체가 편향이 될 수 있으므로 관찰 에이전트가 범주 수정안을 제안하도록 열어 둔다.

### 6.2 범용 Helm과 범주 한정 Helm

- **X3-6-09** L2447 [Claude] 특정 범주에만 적용하는 쪽이 낫다. 범주는 "프론트엔드 성능" 같은 업무 분야가 아니라 문제의 모양으로 정한다. (브리프 §3.5 "범주 한정 이유"의 출처) [이후 변경 가능: 브리프 결정 1 — 브리프는 첫 출발점을 취향이 정답인 작업(글의 톤, 기획 방향, 디자인)으로 정했다. 이 범주 목록에는 취향 작업이 따로 없다]
- **X3-6-10** L2451–2454 [Claude] 이유 네 가지:
  1. **비용이 이득을 넘는 작업이 대부분이다.** Helm은 라운드, 질문, 기록, 확인이라는 비용을 낸다. 이 비용은 문제 정의가 불확실하거나 잘못 고르면 되돌리기 비쌀 때만 회수된다. 스택 트레이스가 원인을 가리키는 버그나 스펙이 정해진 폼 구현에서는 마찰만 남는다.
  2. **C와 A를 건너뛰게 된 이유와 같다.** 마찰이 있으면 우회한다. 모든 작업에 걸면 우회 습관이 Helm이 필요한 작업까지 번진다. A12(자동화가 사람의 주도성을 낮추면 실패)에 정면으로 걸린다.
  3. **기록이 쌓이는 곳이 일정해야 학습된다.** 선호 기록, 제외 사유 패턴, 합의 템플릿 개선은 비슷한 모양의 문제가 반복될 때 의미가 생긴다. 모든 작업을 기록하면 노이즈가 대부분이 된다.
  4. **Quick 프로필로는 부족하다.** "전부 적용하되 가벼운 건 압축한다"는 결국 입구에서 분류를 해야 한다는 뜻이다. 그렇다면 처음부터 입구 분류를 명시적으로 두는 편이 단순하다.

### 6.3 진입 경로

- **X3-6-11** L2458–2465 [Claude] 원문:

  ```text
  평소: 일반 pi로 작업
    │
    ├─ 시작 시 진입 조건 충족 → Helm 초점으로 시작
    ├─ 작업 중 신호 감지     → "초점으로 열까요?" 제안 (승격)
    └─ /focus               → 사람이 직접 지정
  Helm 안에서 문제가 단순하다고 밝혀짐 → Quick으로 압축하거나 일반 작업으로 내림
  ```

  진입 경로 세 가지: 시작 시 조건 충족, 작업 중 신호로 승격 제안, 사람의 직접 지정. 반대 방향(내림)도 있다. (브리프 §3.5 "진입 경로 세 가지(시작, 작업 중 제안, 직접 지정)"의 출처)
- **X3-6-12** L2467 [Claude] 진입 판단도 같은 원칙을 따른다. 모델은 신호가 있는지만 표시하고, "몇 개 이상이면 진입" 같은 규칙은 코드가 적용한다.

### 6.4 진입 조건

- **X3-6-13** L2469–2477 [Claude] 진입 조건(두 개 이상이면 진입):

  | 조건 | 확인하는 질문 |
  |---|---|
  | 목표가 흐림 | 완료 기준을 한 문장으로 쓸 수 없는가 |
  | 관점이나 해법이 갈림 | 원인이나 해법 후보가 둘 이상인데 아직 가르지 못했는가 |
  | 되돌리기 비쌈 | 잘못 고르면 하루 이상의 작업이나 구조 변경이 버려지는가 |
  | 오래 걸림 | 여러 세션이나 여러 날에 걸치는가 |
  | 다른 것과 얽힘 | 다른 결정, 다른 작업, 다른 사람의 일에 영향을 주는가 |

- **X3-6-14** L2479 [Claude] 제외 조건: 그냥 해 보고 되돌리는 비용이 탐구 비용보다 작으면 Helm을 쓰지 않는다.

### 6.5 흐린 작업 다섯 유형과 예

- **X3-6-15** L2483–2488 [Claude] 1. 증상은 있는데 원인이 불분명한 것:
  - "첫 화면이 느리다는 얘기가 계속 나온다"
  - "가끔 상태가 꼬이는데 재현이 안 된다"
  - "CI 테스트가 간헐적으로 실패한다"
  - "빌드 시간이 어느 순간부터 두 배가 됐다"
  - "에이전트가 이 저장소에서 자꾸 같은 실수를 한다"
- **X3-6-16** L2490–2494 [Claude] 2. 여러 방향 중 골라야 하고 되돌리기 비싼 것:
  - "상태 관리 구조를 바꿔야 할까"
  - "React 19나 Next.js로 옮겨야 할까"
  - "디자인 시스템을 직접 만들지, 라이브러리를 쓸지"
  - "개인 하네스를 pi coding agent 위에 만들지, pi-durable 위에 만들지"
- **X3-6-17** L2496–2500 [Claude] 3. 목표 자체가 흐린 것:
  - "에이전트를 더 잘 쓰고 싶다"
  - "코드 리뷰가 늘 늦어진다"
  - "프론트엔드 품질을 올리고 싶다"
  - "어떤 런타임에서도 같은 환경을 쓰고 싶다" (이 대화가 시작된 질문도 이 유형)
- **X3-6-18** L2502–2505 [Claude] 4. 오래 걸리고 다른 일과 얽히는 것:
  - CRA에서 Vite로, React 18에서 19로 옮기는 마이그레이션
  - 레거시 모듈 단계적 리팩터링
  - 여러 저장소에 공통 설정 도입
- **X3-6-19** L2507–2510 [Claude] 5. 반복되는 마찰:
  - "PR마다 같은 지적이 나온다"
  - "매번 같은 설정을 다시 한다"
  - 관찰 에이전트가 세션 로그에서 찾아낸 반복 패턴도 여기로 들어온다.
- **X3-6-20** L2483–2510 [Claude] 이 예들은 유즈케이스 후보로 쓸 수 있다(브리프 결정 25). 모두 개발 작업이다.

### 6.6 범주 밖과 승격 신호

- **X3-6-21** L2512–2516 [Claude] 범주 밖으로 두는 것:
  - 스택 트레이스가 원인을 가리키는 버그
  - 스펙이나 디자인이 정해진 구현("이 API 스키마대로 폼 만들어줘")
  - 리네임, 타입 수정, 테스트 추가, 문서 오타
- **X3-6-22** L2518–2524 [Claude] 범주 밖 작업도 진행 중에 신호가 나오면 승격 대상이다. 신호의 예:
  - 같은 테스트가 세 번 실패한다
  - 모델이 서로 다른 해법을 두 개 이상 꺼낸다
  - 수정 범위가 예상보다 커진다
  - 사람이 "잘 모르겠는데"라고 말한다

  감지 지점: `turn_end`나 `agent_before_settle`.

### 6.7 범주 지표

- **X3-6-23** L2528–2531 [Claude] 2~4주 뒤 두 값을 본다.
  - **Helm으로 들어간 작업 중 실제로 목표나 관점이 바뀐 비율**: 거의 0이면 범주가 너무 넓다(정의가 이미 명확한 작업까지 들어온다).
  - **일반 작업으로 처리했다가 나중에 방향을 다시 잡은 비율**: 높으면 범주가 너무 좁거나 승격 신호가 약하다.
- **X3-6-24** L2533 [Claude] 제안(답 없음): 진입 판단 규칙과 승격 신호 감지기를 Inquiry 작업과 함께 pi-durable 위에서 작성하고, 예시 요청 몇 개로 Helm 진입 여부를 확인하겠다.

## 7. 모드: OICA, NEMAP, OPD+C의 세부 ([72]~[73])

- **X3-7-01** L2536 [사용자] 요구와 질문: "그 뭐랄까 뭔가 mode? 처럼, 작업 유형에 따라 현재 HELM에 있는 개념을 적용했으면 싶은데 OICA NEMAP OPDC 각각에 대한 워크플로우가 세부적으로 어떻게 존재하고 있는거지? HELM에 대한 질문이야." (작업 유형에 따라 모드처럼 적용하고 싶다는 사용자 요구. 브리프 결정 3 모드 정의의 배경)
- **X3-7-02** L2539 [Claude] Helm 문서를 다시 확인했다: 00-manifesto, 09-operating-theory, 10-refinement-candidate. [원문: 대화 당시 이전 Helm 저장소 문서]

### 7.1 세 묶음의 종류

- **X3-7-03** L2543–2549 [Claude] "OICA, NEMAP, OPD+C는 나란히 놓인 세 개의 워크플로우가 아닙니다. 각각 다른 축입니다." (원문 표현)

  | 묶음 | 축 | 답하는 질문 | 문서에서의 형태 |
  |---|---|---|---|
  | OICA | 시간 (흐름) | 지금 어떤 일을 하고 있는가 | 루프마다 목표, 흐름, 핵심 요소, 핵심 질문. 재진입 규칙 |
  | NEMAP | 상태 (기록) | 무엇이 기록되고, 누가 그것을 바꿀 수 있는가 | 평면마다 담는 것의 목록. N/E/M 사이 관계 4개 |
  | OPD+C | 평가 (품질) | 사람이 이 일을 제대로 따라가고 바꿀 수 있는가 | 기준 4개와 질문 하나씩 |

  (브리프 §3.5 "OICA = 흐름, NEMAP = 상태, OPD+C = 평가의 역할"의 출처)
- **X3-7-04** L2551–2554 [Claude] 문서에는 조절 장치가 두 개 더 있다.
  - Quick / Guided / Assured: 형식과 증명 부담을 얼마나 요구할지
  - 개입 계산: 언제 사람에게 물을지(deliberation pressure)
- **X3-7-05** L2556 [Claude] 워크플로우라고 부를 수 있는 것은 OICA뿐이다. OICA도 문서에는 흐름을 한 줄로 쓴 수준까지만 있다. 단계별 진입 조건, 종료 조건, 입력, 출력은 정의되어 있지 않다. "모드"에 해당하는 개념도 문서에는 없다. 가장 가까운 것은 profile(형식의 양)과 성숙도 레벨이다. 성숙도 레벨은 루프와 거의 1:1로 대응한다.

### 7.2 OICA 세부

- **X3-7-06** L2560–2565 [Claude] 문서에 있는 OICA 세부(원문 그대로):

  | 루프 | 목표 | 문서의 흐름 | 핵심 요소 | 10단계 | 성숙도 레벨 |
  |---|---|---|---|---|---|
  | O | 상황에 다시 참여할 수 있는 이해 상태 만들기 | Events → Situation projection → Perception → Comprehension → Projection | CommonOperatingPicture, ReturnBrief, ContextProjection, Handoff, WeakSignal | Sense, Frame | L1 Situation Recovery |
  | I | 불확정 상황을 행동 가능한 문제와 정당화된 선택으로 바꾸기 | Surprise → Problem frames → Hypotheses → Evidence → Discriminating experiment → Deliberation → Decision | Concern, ProblemFrame, HypothesisSet, Evidence, Claim, Experiment, DecisionGate | Diverge, Investigate, Deliberate | L2 Deliberative Inquiry |
  | C | 선택을 약속과 제한된 자율 실행으로 바꾸기 | Decision → Request → Negotiation → Commitment → Authority Envelope → Interdependent execution → Exception/repair | Request, DelegationContract, Commitment, AuthorityEnvelope, WorkUnit, Exception, EscalationTrigger | Commit, Execute | L3 Bounded Delegation |
  | A | 결과를 수락·통합하고 다음 변화에 대응할 능력 높이기 | Completion Claim → Evidence/Argument → Acceptance → Integration → Outcome → Monitor/Learn/Anticipate → Reopen or policy update | ClaimingComplete, AssuranceView, Acceptance, Interface, Integration, RecoveryPath, Reflection | Assure, Integrate, Reflect | L4 Assured Integration, L5 Adaptive Institution |

  성숙도 L1~L5는 브리프 §3.5 "성숙도 L1~L5"의 출처다. 요약본은 "maturity levels 0–5"로 적었다(X3-1-09).
- **X3-7-07** L2567–2572 [Claude] 루프별 핵심 질문:
  - **O**: 무엇이 변했나 / 왜 중요한가 / 개입하지 않으면 무엇이 일어나나 / 누가 무엇을 맡고 있나
  - **I**: 무엇을 문제로 보고 있나 / 어떤 대안 설명이 있나 / 어떤 근거가 가설을 실제로 구분하나 / 정보를 더 모으는 것과 지금 행동하는 것 중 어느 쪽 가치가 큰가
  - **C**: 누가 무엇을 왜 맡았나 / 무엇을 스스로 결정할 수 있나 / 완료를 어떤 근거로 주장해야 하나 / 어떤 조건에서 방향을 바꾸거나 위로 올려야 하나
  - **A**: 왜 이 결과를 받아들여도 되나 / 명세대로 만들었는지와 올바른 것을 만들었는지를 모두 확인했나 / 다른 작업의 전제를 깨뜨렸나 / 환경이 바뀌면 어떻게 복구하고 결정을 다시 여나
- **X3-7-08** L2574–2581 [Claude] 재진입 규칙(문서 §5, 6개):
  1. O에서 새로운 놀라운 사실 → I가 열림
  2. I에서 목적 충돌 발견 → N 기준선이 다시 열림
  3. C 수행 중 권한 밖 문제 → I 또는 선택 요청으로
  4. A에서 근거 부족 → 새 실험 WorkUnit
  5. 통합 중 공유 전제 충돌 → 관련 결정과 컨텍스트 무효화
  6. 돌아보기 → 이후 선택 요청 정책과 맡긴 범위의 기본값 변경
- **X3-7-09** L2583–2591 [Claude] 같은 흐름을 일렬로 펼친 버전이 문서에 네 가지 있다(선형화). 서로 모순되지는 않지만 단계를 나누는 위치가 조금씩 다르다.
  - manifesto의 10단계 사이클
  - operating theory §6의 Concern episode
  - §10의 기본 리듬(Orient → Frame together → Delegate → … → Reflect)
  - 쉬운 말 문서의 8단계

### 7.3 NEMAP 세부 (v0.2 기준)

- **X3-7-10** L2596–2600 [Claude]
  - **N 방향**: 해야 하는 것과 수락된 약속. Goal과 성공 조건, 제약과 우선순위, Choice와 다시 볼 조건, 작업 합의·권한·책임, 결과 확인과 반영 의무.
  - **E 이해**: 안다고 주장하는 것과 모르는 것. 관찰과 출처, 해석과 전제, 가능성, 판단, 근거와 반대 근거, 불확실성·확신 근거·무효화 조건.
  - **M 실제**: 실제로 존재하거나 변한 것. 산출물과 외부 상태, 실행·도구 행동·테스트·배포, 변경과 결과, 인터페이스·의존성·복구 경로.
- **X3-7-11** L2602–2609 [Claude] N, E, M 사이 관계 4개(NEMAP에서 흐름에 해당하는 유일한 부분):

  ```text
  E justifies N   근거와 판단이 선택을 정당화한다
  N authorizes M  선택과 작업 합의가 변경을 허가한다
  M updates E     실행 결과가 믿음과 가설을 바꾼다
  M fulfills N    결과가 목표와 약속을 충족한다
  ```

- **X3-7-12** L2611 [Claude] A 참여자는 사람을 하나의 인격으로 보지 않고 능력 7개로 나눈다: observe, propose, decide within scope, execute action classes, attest evidence, accept result, integrate baseline. [이후 변경 가능: 브리프 결정 4 — 능력은 원시 행동(read, write, execute, send, spawn, ask)과 기록 능력(observe, propose, attest, accept, integrate)으로 정의]
- **X3-7-13** L2613 [Claude] P 정책은 그 능력을 누가 어떤 조건에서 쓸 수 있는지 정한다: 맡긴 범위, 근거 부담, 상향·멈춤 규칙, 신선도와 무효화, 동시성과 충돌, 공개 범위, 복구와 보상.
- **X3-7-14** L2615–2622 [Claude] 루프 × 평면 표. 문서에는 "각 루프가 어느 평면을 읽고 쓰는가"가 없고, 재진입 규칙과 관계식을 조합해 Claude가 만든 표다.

  | | N | E | M | A의 능력 | P |
  |---|---|---|---|---|---|
  | O | 읽기 | 읽기 | 읽기 | observe | 컨텍스트 라우팅 |
  | I | 선택 제안, 목표 재개방 | 쓰기 (관점, 가능성, 근거, 판단) | 읽기, 실험 실행 | propose | 근거 부담, 선택 요청 조건 |
  | C | 쓰기 (합의, 권한) | 읽기 | 쓰기 (권한 안에서) | decide within scope, execute | 맡긴 범위, 상향 규칙 |
  | A | 쓰기 (확인, 반영 의무, 재개방) | 쓰기 (근거, stale) | 읽기 (결과) | attest, accept, integrate | 돌아보기로 정책 수정 |

  (브리프 §3.5 "루프 × 평면"의 출처)

### 7.4 OPD+C 세부

- **X3-7-15** L2624–2633 [Claude]

  | 기준 | 질문 |
  |---|---|
  | Observability | 다음 판단에 필요한 상태, 의도, 근거, 예외를 볼 수 있는가 |
  | Predictability | 다음 행동, 조건, 예상 결과를 충분히 예상할 수 있는가 |
  | Directability | 낮은 비용으로 목적, 제약, 기준, 우선순위를 바꿀 수 있는가 |
  | Contestability | 관점, 판단, 추천, 결정에 이의를 제기하고 근거를 다시 열 수 있는가 |

  문서에는 "모든 WorkUnit와 interface가 이 기준으로 평가된다"는 문장만 있고 측정 방법이나 통과 조건은 없다.

### 7.5 모드 정의와 다섯 모드

- **X3-7-16** L2637–2641 [Claude] 모드 정의: "모드 = 지금 중심이 되는 루프 + 그 루프가 쓰는 평면 + 사람에게 우선 보장할 OPD+C 기준 + profile 기본값". 재진입 규칙이 곧 모드 전환 규칙이 된다. 새로운 개념을 만드는 것이 아니라 Concern이 지금 어느 루프에 무게를 두고 있는지 명시하는 것에 가깝다. [이후 변경 가능: 브리프 결정 3 — 모드 = 루프 계획 기본값 + 능력 부분집합 + 다이얼 값, 페르소나 아님]
- **X3-7-17** L2643–2649 [Claude] 다섯 모드(원문 그대로):

  | 모드 | 중심 루프 | 맞는 작업 유형 | 쓰는 평면 | 우선 보장할 기준 | 기본 profile |
  |---|---|---|---|---|---|
  | 복귀 | O | 며칠 만에 돌아옴, 남이 하던 일 이어받기 | 읽기만 (투영) | O, P | Quick |
  | 탐구 | I | 원인 불명 증상, 흐린 목표, 방향 선택 | E 쓰기, N 제안 | C, D | Guided |
  | 위임 | C | 해법이 정해졌고 맡기는 작업 | N 합의, 권한 안 M | P, D | Guided |
  | 확인·반영 | A (Assure, Integrate) | 결과 검토, 마이그레이션 마무리, 여러 작업 합치기 | N 확인, E 근거 | O, C | Assured |
  | 돌아보기 | A (Reflect) | 반복되는 마찰, 같은 실수 | P 수정안 | D | Guided |

- **X3-7-18** L2651–2660 [Claude] 어느 모드에서도 바뀌지 않는 v0.2 불변조건 6개:
  1. 기록과 진실은 다르다
  2. 관찰, 해석, 가능성, 판단, 선택은 다르다
  3. 투영은 정본을 쓰지 않는다
  4. 권한은 범위와 effect class를 가진다
  5. 완료 주장, 결과 확인, 전체 반영은 다르다
  6. 모르는 것, 이견, 낡은 상태는 숨기지 않는다

  모드는 흐름과 형식의 양만 바꾸고 이 경계는 건드리지 않는다. (브리프 결정 17은 v0.3 불변조건 1~7을 기준으로 한다. v0.3에서 7번 "혼자 정한 결정 기록"이 더해졌다 — 브리프 결정 8)

### 7.6 문서의 빈 곳

- **X3-7-19** L2664–2668 [Claude] 모드로 구현하려면 새로 정의해야 할 세 가지:
  1. **루프별 진입·종료 조건**: 문서에는 흐름과 질문만 있다. "언제 I에서 C로 넘어가는가"는 앞에서 설계한 멈춤 규칙(X3-6-07) 같은 형태로 새로 정한다.
  2. **레코드 종류별 상태 전이**: 문서에 있는 것은 v0.2 kernel 후보의 품질 상태(absent, captured, … superseded)와 관계식 4개뿐이다.
  3. **모드별 OPD+C 검사 방법**: 예를 들어 탐구 모드의 Contestability를 "사람이 관점이나 판단에 이의를 걸 수 있는 명령이 있고, 그 이의가 재개방 이벤트로 기록되는가"처럼 검사 가능한 형태로 바꾼다.
- **X3-7-20** L2670 [Claude] 제안(답 없음): 다섯 모드 각각의 진입 조건, 종료 조건, 활성 도구, 생성 레코드, OPD+C 검사를 한 장의 명세로 정리하겠다.

## 8. 순수 Helm 런타임 ([74]~[77])

- **X3-8-01** L2673 [사용자] 요구: "각각에 대한 다른 축을 에이전트 런타임으로 녹여내리려면 어떤 방법론과 아키텍쳐를 구축해야할까, pi나 다른 벤더 등과 관계없이 순수하게 HELM을 어떻게 구현할 수 있을지의 방식에 대한 질문이야". (벤더와 무관한 순수 Helm 구현 요구. 브리프 결정 23·34의 배경)
- **X3-8-02** L2676 [Claude] Helm을 런타임으로 만든다는 것은 LLM 에이전트 루프를 "제안만 하는 하위 프로세스"로 두고 그 바깥에 Helm의 의미를 집행하는 커널을 두는 일이다. OS 비유: 모델은 사용자 모드에서 돌고, 상태를 바꾸려면 반드시 커널의 시스템 콜(타입이 정해진 제안)을 거친다. (브리프 결정 14와 같다)

### 8.1 Helm 개념별 런타임 역할

- **X3-8-03** L2680–2687 [Claude]

  | Helm 축 | 런타임에서의 역할 | 구현 형태 |
  |---|---|---|
  | N, E, M | 무엇이 존재할 수 있는가 | 타입이 정해진 레코드, 이벤트 로그, 레코드 사이 참조 제약 |
  | A, P | 누가 무엇을 바꿀 수 있는가 | 능력(capability) 검사와 정책 엔진 |
  | O, I, C, A 루프 | 지금 무엇을 하는가 | Concern 상태 기계와 모드 계약 |
  | OPD+C | 사람이 따라가고 바꿀 수 있는가 | 상호작용 계약(화면과 명령)과 감시 지표 |
  | Quick/Guided/Assured | 얼마나 증명해야 하는가 | 정책의 파라미터 |
  | 개입 계산 | 언제 묻는가 | 선택 요청을 열지 정하는 함수 |

### 8.2 단일 변경 경로

- **X3-8-04** L2689, L2692 [Claude] 이것들은 단계로 나열되지 않는다. 모든 변화가 지나는 경로 하나 위에서 각 개념이 서로 다른 지점에 걸린다. 위젯 `helm_kernel_single_change_path`(내용 없음).
- **X3-8-05** L2695–2700 [Claude] 모델이 할 수 있는 일은 경로 맨 위 왼쪽 상자에 제안을 넣는 것뿐이다. 경로 위 위치:
  - NEMAP → 형식 검사, 세계 모델 갱신
  - A/P와 profile → 권한 검사
  - OICA → 규칙 평가, 다음 단계 구성
  - OPD+C → 투영, 감시

  본문에서 알 수 있는 경로 상자: 제안(입력) → 형식 검사 → 권한 검사 → 규칙 평가 → 세계 모델 갱신 → 다음 단계 구성, 그리고 투영·감시. 상자의 정확한 순서와 분기는 위젯에 있었고 원문에는 없다. (Claude는 L2915에서 이 경로를 Redux의 "dispatch → middleware → reducer → selector" 흐름으로 다시 설명한다. X3-9-04)
- **X3-8-06** L2702 [Claude] 거부된 제안도 관찰로 기록한다(A14).

### 8.3 N, E, M: 레코드와 쓰기 시점 제약

- **X3-8-07** L2708–2711 [Claude] 레코드 종류를 평면별로 고정한다.
  - N: Goal, Constraint, Choice, Agreement, Acceptance, IntegrationObligation
  - E: Observation, Interpretation, Possibility, Finding, Evidence, Assumption, OpenQuestion
  - M: 산출물 참조, 실행 기록, Outcome
- **X3-8-08** L2712–2719 [Claude] v0.2 관계식 4개를 쓰기 시점의 참조 제약으로 바꾼다(관계 = 쓰기 시점 제약):

  | 관계식 | 쓰기 시점 제약 |
  |---|---|
  | E justifies N | Choice는 Finding이나 Possibility를 하나 이상 참조해야 생성된다 |
  | N authorizes M | M 변경 이벤트는 유효한 Agreement를 참조해야 기록된다 |
  | M updates E | Observation은 실행 기록(tool call id 등)을 참조해야 생성된다 |
  | M fulfills N | Acceptance는 완료 기준과 그 기준을 충족한 Outcome·Evidence를 참조해야 생성된다 |

  (브리프 §3.5 "관계의 쓰기 시점 참조 제약"의 출처)
- **X3-8-09** L2721 [Claude] 정본은 이벤트 로그다. 레코드의 현재 상태는 로그를 재생해서 얻는다. 그러면 "그 시점에 무엇을 알고 있었나"를 조회할 수 있고(A11, A13) 기록과 진실의 구분도 유지된다. (브리프 결정 29와 같다)
- **X3-8-10** L2722 [Claude] 레코드마다 품질 상태 기계를 둔다: absent → captured → structural → qualified → accepted, 그리고 contested, stale, superseded. 상태는 덮어쓰지 않고 전이 이벤트로만 바뀐다. (어느 상태에서 contested·stale·superseded로 가는지의 전이표는 원문에 없다)
- **X3-8-11** L2723 [Claude] M은 복사하지 않고 참조한다(파일@해시, 커밋, 실행 id). 참조 대상의 해시가 바뀌면 그것을 근거로 쓴 Evidence는 자동으로 stale이 된다.

### 8.4 A, P: 능력 행렬과 정책

- **X3-8-12** L2727 [Claude] A는 v0.2의 능력 7개 × 레코드 종류 행렬로 정의한다(행렬). 예: 에이전트는 Possibility를 propose할 수 있지만 Acceptance를 생성할 수 없다. 사람은 둘 다 할 수 있다. 검증자 에이전트는 Evidence에 대해 attest만 할 수 있다. [이후 변경 가능: 브리프 결정 4]
- **X3-8-13** L2728 [Claude] P는 이 행렬 위에 조건을 얹는 함수다: 맡긴 범위(effect class와 경로), 근거 부담, 상향·멈춤 규칙, 신선도, 동시성 충돌.
- **X3-8-14** L2729–2737 [Claude] profile은 P의 파라미터다.

  | 파라미터 | Quick | Guided | Assured |
  |---|---|---|---|
  | 근거 부담 | 자동 검증 결과 | 기준별 근거 | 기준별 근거 + 반대 근거 탐색 + 독립 검토 |
  | 선택 요청 문턱 | 높음 | 중간 | 낮음 |
  | 압축 가능한 단계 | O, I 대부분 | 일부 | 없음 |

  profile은 위험 요인(effect class, 되돌릴 수 있는지, 다른 것과의 결합도)으로 계산한다. 올리는 것은 자동, 위험이 요구하는 수준보다 내리는 것은 사람만 할 수 있다. [이후 변경 가능: 브리프 결정 2(effect class·가역성 판별은 권한 레이어), 3(다이얼)]
- **X3-8-15** L2738 [Claude] 개입 계산은 선택 요청을 열지 정하는 함수 하나다. 문서의 deliberation pressure 요인을 입력으로 받아 "자동 처리 / 기록 후 진행 / 선택 요청"을 반환한다. 입력값 일부는 모델이 추정하지만 판정은 코드가 하고 판정 근거를 기록에 남긴다. (브리프 결정 12·16의 질문 조건·게이트와 연결)

### 8.5 OICA: 계층 상태 기계와 데이터로서의 모드 계약

- **X3-8-16** L2742 [Claude] Concern 하나가 계층 상태 기계 하나다. 상위 상태는 O, I, C, A, 하위 상태는 10단계다. [이후 변경 가능: 브리프 결정 5 — 루프(O, I, C, A, S)는 필요에 따라 조합하고 언제든 전환하며 커널이 강제하는 것은 의존 규칙뿐]
- **X3-8-17** L2743–2755 [Claude] 모드는 상태마다 붙는 계약이며 코드가 아니라 데이터로 둔다(데이터로서의 계약). 원문:

  ```text
  mode:
    entry      진입 조건 (이벤트 + 가드)
    exit       종료 조건 (예: 멈춤 규칙, 합의 확정, 반영 완료)
    proposals  허용되는 제안 종류
    effects    허용되는 effect class 상한
    context    내부 루프에 줄 투영 명세
    human      반드시 사람이 개입하는 지점
    opdc       이 모드가 보장해야 하는 화면과 명령
    budget     라운드, 하위 호출, 시간 상한
  ```

  (브리프 §3.4의 14 문서 "루프 계약(데이터)"의 출처)
- **X3-8-18** L2757 [Claude] 문서 §5의 재진입 규칙 6개는 "이벤트 → 가드 → 전이" 규칙표가 된다. 예: "Finding의 근거와 충돌하는 Observation이 기록됨 → Finding은 contested → Concern은 I로". 충돌 판정에는 모델이 필요하지만 그 판정도 제안으로 들어오므로 같은 경로를 지난다. (재진입 가드: 브리프 §3.5)
- **X3-8-19** L2758–2764 [Claude] 거시 루프는 Concern들 위의 스케줄러다(거시 스케줄러). 하는 일:
  - 사람의 주의 예산을 배분한다.
  - 여러 선택 요청을 병합하고 순서를 정한다.
  - 다시 볼 조건 타이머를 관리한다.
  - 복귀 요약을 생성한다.

  관찰 에이전트도 이 층에서 P 수정안을 제안하는 행위자로 들어온다. (주의 예산: 브리프 §3.5. 배분 알고리즘은 원문에 없다)

### 8.6 OPD+C: 상호작용 계약과 감시

- **X3-8-20** L2768–2777 [Claude] OPD+C는 단계가 아니라 모든 모드가 지켜야 하는 인터페이스 의무와 그 의무가 지켜지는지 재는 지표다.

  | 기준 | 인터페이스 의무 | 감시 지표 |
  |---|---|---|
  | Observability | 모든 모드는 현재 모드, 의도, 다음 단계, 근거, 예외를 담은 상태 투영을 낸다 | Agreement나 의도에 연결되지 않은 M 변경 수 (목표 0) |
  | Predictability | WorkUnit 실행 전 계획과 예상 결과를 선언한다 | 선언과 실제 결과의 차이. 차이가 나면 관찰로 기록 |
  | Directability | 목표, 제약, 기준, 우선순위 변경 명령이 모든 모드에 있고, 다음 턴 경계에서 반영된다 | 명령부터 행동 변화까지의 턴 수, 기준 하나를 바꾸는 데 필요한 조작 수 |
  | Contestability | 모든 E·N 레코드에 이의 명령이 있고, 이의를 걸면 contested 전이와 재개방 이벤트가 생긴다 | 처리되지 않고 사라진 이의 수 (목표 0) |

  이 의무를 모드 계약의 `opdc` 칸에 적어 두면 커널은 "이 모드에서 이 화면과 명령이 제공되는가"를 테스트로 검사할 수 있다. (브리프 결정 10, 16 문서 지표의 재료)

### 8.7 내부 루프 계약 (어떤 런타임에도 붙이기)

- **X3-8-21** L2781–2787 [Claude] 커널이 하위 에이전트 런타임에 요구하는 능력 다섯 개:
  1. 주어진 지시, 도구, 컨텍스트로 루프를 실행한다
  2. 도구 호출을 실행 전에 가로챈다
  3. 도구 결과를 id와 함께 돌려준다
  4. 턴 경계에서 멈추거나 계속하게 한다
  5. 새 컨텍스트(독립 검증자, 분기)를 만든다
- **X3-8-22** L2789 [Claude] 어떤 런타임에 2번이 없으면 권한을 사전에 집행할 수 없다. 이때는 격리된 작업 공간에서 실행하게 하고, 끝난 뒤 diff로 범위를 검사해 반영 여부를 정하는 방식으로 낮춘다. 런타임마다 다섯 능력의 보유 여부를 표로 두고, 없는 능력에 맞춰 보장 수준을 낮추고 그 사실을 사용자에게 표시한다. 처음 이야기한 벤더 중립 하네스의 능력 표와 같은 방식이다. (브리프 결정 34와 §3.5 "능력이 없으면 보장 수준을 낮춰 동작"의 출처)

### 8.8 방법론: 이론을 코드로 옮기는 절차

- **X3-8-23** L2793–2799 [Claude] 1. 결정마다 주체를 분류한다. Helm의 공리와 법칙에 나오는 결정을 하나씩 꺼내 네 가지 중 하나로 표시한다(결정 주체 분류 네 가지):
  - 코드가 정함
  - 모델이 구조화된 값을 선언하고 코드가 계산함
  - 사람이 정함
  - 측정만 함

  원칙: "모델이 구조화된 값을 선언할 수 있으면 결정 자체는 코드로 내린다". 앞의 빈 칸 찾기, 확인 순서, 질문 선택, 멈춤 규칙(X3-6-04~07)이 이 방식의 예다. (브리프 결정 14의 출처. 분류 표의 각 행은 [제안])
- **X3-8-24** L2801–2807 [Claude] 2. 공리마다 네 가지를 쓴다: 불변조건, 집행 지점(경로의 어느 상자인가), 위반 테스트, 운영 지표. 예 A10:
  - 불변조건: Acceptance 없는 Concern은 완료 상태가 될 수 없다
  - 집행 지점: 규칙 평가
  - 위반 테스트: 에이전트 행위자로 Acceptance 생성을 시도하면 거부되는가
  - 운영 지표: 완료까지 남은 반영 항목 수

  (브리프 §3.5 "공리 A1~A15 전체 대응(분류, 집행 지점, 보장 수준, 위반 테스트)"의 출처)
- **X3-8-25** L2809 [Claude] 3. 명세를 실행 가능한 데이터로 둔다. 레코드 스키마, 능력 행렬, 정책, 모드 계약, 재진입 규칙표를 JSON Schema나 YAML로 둔다. 커널은 이것을 읽어 동작한다. 이론을 바꾸면 데이터가 바뀌고 테스트가 그 변화를 잡는다. (스키마 표기는 브리프 결정 36의 TypeBox를 따른다. TypeBox는 JSON Schema를 만든다 [지식])
- **X3-8-26** L2811 [Claude] 4. 가짜 모델로 재생해서 테스트한다. 정해진 제안 순서를 내는 가짜 모델로 시나리오를 돌린다. 커널은 결정적이어야 하므로 같은 입력에서 같은 이벤트 로그가 나와야 한다. 불변조건은 무작위 제안 순서를 넣는 속성 기반 테스트로 검사한다. (브리프 §3.4의 22 문서 "가짜 모델 재생, 속성 테스트"의 출처)
- **X3-8-27** L2813 [Claude] 5. 모델 품질은 따로 평가한다. 관점이 다양한지, 예측이 맞았는지, 요약에서 빠진 것이 있는지는 커널 테스트가 아니라 별도 평가로 본다. 커널이 보장하는 범위와 모델 성능에 달린 범위를 섞지 않기 위해서다.
- **X3-8-28** L2815–2821 [Claude] 6. 성숙도 순서대로 만들고 단계마다 반증 지표로 확인한다. Helm 문서 스스로 "앞 레벨의 사용자 가치를 검증한 뒤 다음 레벨로 간다"고 정했다. C와 A를 가장 많이 건너뛴다는 답에 따라 구현 순서:
  1. 레코드·로그·권한
  2. C와 A 모드
  3. O 모드
  4. I 모드
  5. 거시 스케줄러
  6. P 적응(돌아보기)

### 8.9 이전 Helm 구현에서 피해야 할 것

- **X3-8-29** L2825–2828 [Claude]
  - **문서를 상태로 쓰지 않는다.** 상태는 이벤트 로그와 레코드에만 있고 문서는 투영 중 하나다.
  - **온톨로지를 먼저 완성하지 않는다.** 레코드 종류는 지금 만드는 모드가 실제로 쓰는 것만 추가한다.
  - **투영이 정본을 쓰지 않는다.** 요약, 브리프, 화면은 읽기 전용이다.
  - **모델에게 전이 권한을 주지 않는다.** 모델이 "이제 C로 넘어갑니다"라고 말해도 그것은 전이 제안일 뿐이고 종료 조건 판정은 커널이 한다.
- **X3-8-30** L2830 [Claude] 제안(답 없음): Helm 런타임 명세 문서로 정리하겠다(레코드 스키마, 능력 행렬, 모드 계약 5개, 재진입 규칙표, 공리별 네 항목 표). 사용자는 다음 메시지에서 "이해하기 너무 어렵다"고 답했다.

## 9. 이해를 위한 학습 문답 ([78]~[98])

이 절의 사용자 답은 Helm 규칙에 대한 사용자의 직관을 보여 준다. 설계 근거와 UX(설명 방식) 근거로 쓸 수 있다.

### 9.1 어려움의 표명과 접근

- **X3-9-01** L2833 [사용자] "이해하기 너무 어렵다 내가 이해하려면 어디서 접근해야할까" — [73]~[77]의 런타임 설명(L2899 인자의 표현으로 "커널, 제안 경로, NEMAP/OICA/OPD+C 축 매핑")이 너무 어렵다는 진술.
- **X3-9-02** L2836–2899 [Claude] learn 스킬을 불러왔다. 인자(L2899): "사용자가 Helm 런타임 아키텍처 설명(커널, 제안 경로, NEMAP/OICA/OPD+C 축 매핑)이 너무 어렵다며 어디서부터 접근해야 이해할 수 있을지 묻고 있음. 사용자는 React 18 CSR 시니어 프론트엔드 개발자. 한국어 합니다체, AI 말투('축','박다','가른다', 의인화) 싫어함, 위에서 아래로(큰 그림 먼저) 설명 선호."
- **X3-9-03** L2902–2913 [Claude] 이미 아는 구조에서 출발한다. Helm 커널은 구조로 보면 Redux와 거의 같다.

  | React / Redux | Helm 런타임 |
  |---|---|
  | 컴포넌트가 dispatch하는 action | 모델의 제안, 사람의 명령 |
  | middleware (로깅, 권한 검사) | 형식 검사, 권한 검사 (A/P) |
  | reducer (순수 함수) | 커널의 상태 전이 |
  | store의 state 모양 | N, E, M 레코드 |
  | action 기록과 devtools 시간 여행 | 이벤트 로그, 특정 시점 상태 조회 |
  | XState 같은 상태 기계 | Concern의 O → I → C → A |
  | selector로 만든 화면 | 복귀 요약, 선택 요청 같은 투영 |
  | 그 화면이 쓰기 좋은지 보는 UX 기준 | OPD+C |

- **X3-9-04** L2915 [Claude] LLM 에이전트는 action을 dispatch하는 컴포넌트 중 하나일 뿐이고, 무엇을 dispatch할지 예측할 수 없는 컴포넌트다. "모든 변화가 지나는 경로" 그림은 dispatch → middleware → reducer → selector 흐름을 다시 그린 것이다.
- **X3-9-05** L2922 [사용자] "둘 다 어려워 지금" (런타임 구조와 Helm 개념 모두 어렵다).
- **X3-9-06** L2927–2932 [Claude] 학습 순서: 1. 일하면서 적는 것들을 세 칸으로 나누기(N, E, M) 2. E 칸 안에서 "본 것"과 "추측한 것" 구분 3. 네 루프가 세 칸을 어떻게 오가는지 4. 마지막에 런타임.

### 9.2 N, E, M 나누기

- **X3-9-07** L2936–2940 [Claude] "로그인 버튼이 안 눌린다" 예:

  | 칸 | 뜻 | 예 |
  |---|---|---|
  | N (방향) | 하기로 한 것, 지켜야 할 것 | "오늘 배포 전까지 로그인이 되게 한다" |
  | E (이해) | 알고 있거나 안다고 생각하는 것 | "콘솔에 TypeError가 뜬다", "onClick에 함수가 안 넘어가는 것 같다" |
  | M (실제) | 실제로 바뀌었거나 존재하는 것 | "Button.tsx를 고쳐서 커밋했다" |

- **X3-9-08** L2946–2949, L2954 [사용자] 분류 연습. 문장: a) 네트워크 탭을 보니 검색 API 응답이 평균 2초 걸린다 b) 이번 주 안에 검색 결과가 1초 안에 나오게 한다 c) useSearch.ts에 캐시를 추가해서 머지했다 d) 캐시가 없어서 느린 것 같다. 사용자 답: "a: m b :n c:m d:e".
- **X3-9-09** L2957–2973 [Claude] [정정: 사용자의 a=M 답을 E로 고침] b, c, d는 맞다. d를 E로 고른 것이 중요하다("느린 것 같다"는 생각). a는 M이 아니라 E다.
  - M은 세상 그 자체다(API 서버가 실제로 응답하는 시간, useSearch.ts 파일의 실제 내용).
  - E는 그것에 대해 내가 알게 된 것이다("네트워크 탭에서 보니 2초였다"는 내가 본 기록).
  - 둘을 나누는 이유는 둘이 어긋날 수 있기 때문이다. 2초는 내 컴퓨터 네트워크 탓일 수도 있다. c처럼 캐시를 추가해 M이 바뀌면 a의 "2초"는 더 이상 맞지 않는 옛날 정보가 된다("M updates E").

  ```text
  M: API가 실제로 느림 (세상)
        │  내가 네트워크 탭으로 봄
        ▼
  E: "평균 2초 걸린다" (내가 본 기록)
  ```

  브리프 용어집 "관찰은 E에 속한다"의 근거다. 사용자의 첫 직관(관찰 = M)이 틀리기 쉬운 지점이라는 UX 근거이기도 하다.

### 9.3 관찰과 추측, 근거·반대 근거·구분 확인

- **X3-9-10** L2978 [사용자] E 칸을 나누는 기준: "추측과 관찰".
- **X3-9-11** L2981 [Claude] a는 관찰, d는 추측이다. Helm 문서는 추측을 "해석"과 "가능성"으로 더 잘게 나눈다. (브리프 용어집 "추측 = 해석 + 가능성 묶음 이름"과 같다)
- **X3-9-12** L2985–2987 [Claude] 규칙: "추측은 저절로 사실이 되지 않는다." 사람 사이에서도 "캐시가 없어서 느린 것 같다"가 회의를 거치며 "캐시가 없어서 느리다"로 바뀐다. 에이전트는 이 일을 더 빠르고 자주 저지른다. 자기가 쓴 추측을 다음 턴에 사실처럼 읽기 때문이다.
- **X3-9-13** L2991–2997 [Claude] E 안의 단계: 관찰 → 추측 → 판단(사실로 받아들인 것). 추측이 판단으로 올라가려면 그것을 뒷받침하는 관찰(근거)이 필요하다.
- **X3-9-14** L3002 [사용자] d를 판단으로 올리려면: "캐시 히트가 있는지, 애초에 캐시 코드가 구현이 되어있는지를 먼저 관찰하지만, 반대로 반드시 캐시때문에 그렇다는 다른 반증을 찾는것도 필요". (사용자가 반대 근거 탐색이 필요하다고 스스로 말했다)
- **X3-9-15** L3007–3010 [Claude] Helm 용어: **근거**(추측을 뒷받침하는 관찰), **반대 근거**(추측과 맞지 않는 관찰을 일부러 찾는 것). 반대 근거를 일부러 찾는 습관은 A14(이견과 실패는 지울 잡음이 아니라 신호다)와 같은 이야기다.
- **X3-9-16** L3012 [Claude] [정정: 사용자가 든 "캐시 코드 존재 여부" 관찰의 효용을 다듬음] "캐시 코드가 없다"는 관찰은 d를 뒷받침하는 것처럼 보이지만 원인이 DB 쿼리여도 캐시 코드는 똑같이 없다. 어느 쪽이 맞든 같은 결과가 나와 추측을 가려 주지 못한다. "서버 응답 2초 중 DB 쿼리가 1.8초"처럼 원인에 따라 결과가 달라지는 관찰이 쓸모 있는 확인이며, Helm에서는 이것을 **구분 확인**이라고 부른다.
- **X3-9-17** L3016–3020 [Claude]

  ```text
  E 칸: 관찰 → 추측 → 판단
                ↑
       근거 + 반대 근거 + 구분 확인
  ```

  추측을 세우고 확인 방법을 고른 일이 I 루프(Inquiry, 탐구)다.

### 9.4 루프

- **X3-9-18** L3027 [사용자] I 앞뒤에 오는 일: "문제상황이 무엇이고 탐구를 통해 문제를 인식하고 정의했는지, 이게 진짜 해결해야 하는 문제라고 정의했다면 어떻게 해결할건지".
- **X3-9-19** L3032–3038 [Claude]

  | 하신 말씀 | Helm 루프 | 이 루프가 답하는 질문 |
  |---|---|---|
  | 문제 상황이 무엇인지 | O (Orientation, 상황 파악) | 지금 무엇이 변했고 왜 중요한가 |
  | 탐구로 문제를 인식하고 정의 | I (Inquiry, 탐구) | 무엇이 진짜 문제이고 어떤 가능성이 있는가 |
  | 진짜 문제라면 어떻게 해결할지 | C (Commitment, 약속과 실행) | 무엇을, 어디까지, 어떤 조건으로 하기로 했는가 |

  "문제를 정의한다"는 O와 I의 경계에 있다. 10단계에서도 Frame이 Sense 바로 다음, Diverge 바로 앞에 있다.
- **X3-9-20** L3045 [사용자] 머지 다음에 할 일: "정말 문제가 해결되었는지 확인해야하고, 해당 문제정의에서의 해결이 다른 프레임에서는 해결이 맞는지를 교차점검".
- **X3-9-21** L3050–3053 [Claude] 그 두 가지가 A 루프(Assurance, 확인과 반영)다.
  - "정말 해결됐는지 확인" → 결과 확인. 머지한 사실이 아니라 검색이 실제로 1초 안에 나오는지 근거로 확인한다.
  - "다른 프레임에서도 해결이 맞는지 교차 점검" → 전체 반영. 캐시 때문에 오래된 검색 결과가 보이지 않는지, 다른 화면이나 다른 사람의 작업과 충돌하지 않는지 본다. 문서 표현: "명세대로 만들었는가와 올바른 것을 만들었는가를 모두 확인했는가".
  - A 루프에는 돌아보기(다음에 비슷한 문제를 만나면 무엇을 다르게 할지 남기기)가 하나 더 있다.
- **X3-9-22** L3057–3064 [Claude]

  | 루프 | 하는 일 | 다루는 칸 |
  |---|---|---|
  | O 상황 파악 | 지금 무슨 일이 있는지 본다 | N, E, M을 읽기만 함 |
  | I 탐구 | 문제를 정의하고, 추측을 세우고, 확인한다 | E에 쓴다 |
  | C 약속과 실행 | 해결 방법을 정하고 실행한다 | N에 쓰고, M을 바꾼다 |
  | A 확인과 반영 | 해결됐는지 확인하고, 전체와 맞추고, 돌아본다 | M을 N과 비교하고, E를 갱신한다 |

  A에서 "해결이 안 됐다"가 나오면 다시 I로 돌아간다. 네 루프는 한 방향으로만 흐르지 않는다.

### 9.5 에이전트에게 맡기기 가장 위험한 칸

- **X3-9-23** L3069 [사용자] "A 책임소재를 질 대상이 없음, 확인과 반영이라는 것 또한 LLM이 진행하면 불확정성이 반드시 따라올 수 밖에 없기때문". (A 루프를 에이전트에게 혼자 맡기는 것이 가장 위험하다는 사용자 판단)
- **X3-9-24** L3074–3075 [Claude] 두 이유 모두 Helm이 A 루프를 다루는 이유와 같다.
  - 책임질 주체가 없다 → A6 "에이전트는 제안과 제한된 실행의 주체이고, 사람이 최종 약속의 저자다." 결과를 받아들이는 행위는 책임을 지는 행위라서 사람이 해야 한다.
  - LLM이 확인하면 불확실성이 따라온다 → 작업한 모델이 자기 결과를 확인하면 같은 착각을 같은 방식으로 한 번 더 하게 된다. 스스로 채점하는 구조다.

### 9.6 reducer 규칙 두 개

- **X3-9-25** L3079–3093 [Claude] 원문:

  ```ts
  function helmReducer(state, action) {
    switch (action.type) {
      case "result/submit": // 에이전트도 할 수 있음
        // 근거는 모델이 쓴 문장이 아니라 실제 도구 실행 결과여야 함
        if (!action.evidence.every((id) => state.toolResults[id]))
          return reject("근거가 실제 실행 결과가 아님");
        return { ...state, result: { status: "확인 필요", evidence: action.evidence } };

      case "result/accept": // 사람만 할 수 있음
        if (action.actor !== "human") return reject("결과 확인은 사람만 가능");
        return { ...state, result: { ...state.result, status: "확인됨" } };
    }
  }
  ```

- **X3-9-26** L3095–3098 [Claude] 조건이 프롬프트("확인은 사람에게 맡기세요")가 아니라 코드에 있으므로 모델이 무슨 말을 하든 결과가 "확인됨"으로 바뀌지 않는다. 커널, 제안 경로는 결국 이것이다: 모델은 action을 dispatch만 할 수 있고, reducer가 Helm 규칙으로 받을지 말지를 정한다.
- **X3-9-27** L3103 [사용자] "모르겠으" (판단 승격 action과 조건을 묻는 질문에). L3108–3116 [Claude] 절반을 채운 `claim/promote` 틀을 주고 `???` 조건을 묻는다.
- **X3-9-28** L3119 [사용자] 판단 승격 조건: "반증 조건이 없고 증거가 명확히 확인된것'".
- **X3-9-29** L3124–3133 [Claude] 원문:

  ```ts
  case "claim/promote":
    const c = state[action.id];
    const hasEvidence = c.evidence.length > 0 &&
      c.evidence.every((id) => state.toolResults[id]);      // 증거가 실제로 확인된 것
    const checkedAgainst = c.counterChecked === true &&
      c.counterEvidence.length === 0;                          // 반증을 찾아봤는데 없었음
    if (!hasEvidence || !checkedAgainst) return reject("판단으로 올릴 수 없음");
    return { ...state, [action.id]: { ...c, status: "판단" } };
  ```

- **X3-9-30** L3135 [Claude] [정정: 사용자의 "반증 조건이 없고"를 고침] "반증이 없다"를 "반증을 찾아봤는데 없었다"로 바꿨다. 찾아보지 않아서 없는 것과 찾아봤는데 없는 것은 다르기 때문이다. 그래서 `counterChecked` 칸을 따로 둔다. (브리프 §3.5 Claim 스키마 `evidence`, `counterEvidence`, `counterChecked`의 출처. "구분 확인"은 이 코드에 아직 필드가 없다)
- **X3-9-31** L3139–3144 [Claude] 네 단계 정리:
  1. N, E, M: 방향, 이해, 실제. 관찰은 M이 아니라 M에 대해 알게 된 E다.
  2. 관찰과 추측: 추측은 근거, 반대 근거, 구분 확인 없이 판단이 되지 않는다.
  3. O, I, C, A: 상황 파악 → 탐구 → 약속과 실행 → 확인과 반영. 확인에서 실패하면 탐구로 돌아간다.
  4. 런타임: 위험한 지점(결과 확인, 판단으로 올리기)에서 모델의 action을 reducer 조건으로 막는다.

  "커널", "제안 경로", "축별 매핑"은 모두 4번을 규칙 수만큼 늘린 것이다.
- **X3-9-32** L3146–3149, L3152 [Claude 제안 → 사용자 선택] 다음 두 방향(개념 쪽: A/P와 OPD+C를 같은 방식으로 채우기, 코드 쪽: reducer를 실제로 돌아가는 작은 파일로 만들고 가짜 모델이 규칙을 어기려 할 때 막히는 것 보기) 중 사용자는 "둘다"를 골랐다.

## 10. 장난감 커널 `helm.mjs` ([99]~[105])

- **X3-10-01** L3155 [Claude] 코드부터 만들고 그 코드 안에서 A/P 개념으로 이어 간다.
- **X3-10-02** L3158 [Claude] `/home/claude/helm-toy/helm.mjs`를 작성했다. 이 파일은 현재 저장소 `experiments/helm-toy/helm.mjs`에 있다(브리프 §4 "장난감 커널(거부 8건 시나리오)").
- **X3-10-03** L3161–3177 [Claude] 실행 결과: 21번의 시도 중 8번이 거부되었다. [실험: 대화 당시 실행. 2026-10-11 이 발췌 작성 중 `node experiments/helm-toy/helm.mjs`로 다시 실행해 같은 출력을 확인했다]

  ```text
   3 ✗ model   claim/promote      근거 없음
   4 ✗ model   claim/link         근거 T9는 실제 실행 결과가 아님
   5 ✗ model   tool/result        도구 결과는 런타임만 기록 가능
   7 ✗ model   claim/promote      반증을 찾아보지 않음
  10 ✗ model   claim/promote      반대 근거 있음: T2
  17 ✗ model   result/submit      근거 모델설명는 실제 실행 결과가 아님
  19 ✗ model   result/accept      결과 확인은 사람만 가능
  21 ✗ model   (직접 수정 시도)     상태는 읽기 전용

  최종 상태
    C1 [추측] 캐시가 없어서 느리다     ← 반대 근거 T2 때문에 추측에 머묾
    C2 [판단] DB 쿼리가 느리다         ← 근거 + 반증 탐색을 거쳐 올라감
    결과: 확인됨 (근거 T4)            ← 사람이 확인
  ```

- **X3-10-04** L3179 [Claude] "캐시가 없어서 느리다"는 모델이 다섯 번 밀어붙였지만 끝까지 추측으로 남았고, 실제 원인인 DB 쿼리 쪽만 판단이 되었다. 거부된 시도도 기록에서 지워지지 않고 남는다.
- **X3-10-05** (파일 직접 확인, 원문 범위 밖) [원문: `experiments/helm-toy/helm.mjs`] action 목록과 검사:

  | action | 허용 행위자 | 검사 | 결과 |
  |---|---|---|---|
  | `tool/result` | `runtime`만 | 행위자 | M.toolResults에 추가 |
  | `claim/propose` | 누구나 | 없음 | 상태 "추측", evidence·counterEvidence 빈 배열, counterChecked false |
  | `claim/link` | 누구나 | `toolResultId`가 실제 도구 결과인가 | kind `support` → evidence 추가, kind `counter` → counterEvidence 추가 + counterChecked true |
  | `claim/counterChecked` | 누구나 | 반증 탐색의 도구 결과가 있는가 | counterChecked true |
  | `claim/promote` | 누구나 | evidence 1개 이상, counterChecked, counterEvidence 없음 | 상태 "판단" |
  | `result/submit` | 누구나 | 근거가 모두 실제 도구 결과인가 | N.result 상태 "확인 필요" |
  | `result/accept` | `human`만 | 행위자, 제출된 결과("확인 필요")가 있는가 | 상태 "확인됨" |
  | 그 밖 | - | - | "알 수 없는 action" 거부 |

  store는 `dispatch`만 열고 상태를 `deepFreeze`한다. ledger에는 받아들여진 시도와 거부된 시도를 모두 남긴다. 차이: L3124–3133의 코드는 promote 시점에 evidence id가 도구 결과인지 다시 확인하지만, 파일은 link 시점에만 확인하고 promote에서는 개수만 본다.
- **X3-10-06** L3181–3183 [Claude] A/P로 넘어가는 질문: 거부 8개는 크게 두 종류다. 힌트: 5번과 19번은 같은 action을 다른 사람이 했다면 통과했을 시도이고, 나머지는 누가 했어도 거부되었을 시도다.
- **X3-10-07** L3186 [사용자] "엄 시각화 해서 보여줘".
- **X3-10-08** L3189–3198 [Claude] 위젯 `helm_toy_reducer_dispatch_stepper`: `helm.mjs`의 21개 dispatch를 한 단계씩 재생한다. 왼쪽 위 = 들어온 action과 행위자(runtime, model, human), 왼쪽 아래 = reducer 검사와 걸린 곳, 오른쪽 = 받아들여진 경우에만 N, E, M 상태가 바뀌고 바뀐 줄이 강조됨. 거부된 단계(✗)에서는 오른쪽 상태가 바뀌지 않고 아래 기록에만 남는다.
- **X3-10-09** L3200 [Claude] 질문(답 없음): ✗ 8개 단계(3, 4, 5, 7, 10, 17, 19, 21)의 "reducer 검사" 칸을 비교해, 걸린 검사가 action을 보낸 쪽을 보는 경우와 action에 담긴 내용을 보는 경우로 나눠 달라. 21번은 둘 중 어디에도 딱 맞지 않을 수 있으니 따로 빼도 된다. 다음 메시지 L3203에서 사용자는 이 질문에 답하지 않고 "이제 이해됐어. NEM 세계와 OICA는 이해됐어"라고 했다.
- **X3-10-10** L3183, L3200 [Claude] 이 질문에 담긴 분류: 행위자를 보는 거부(5, 19) / 내용을 보는 거부(3, 4, 7, 10, 17) / 어느 쪽도 아닌 경로 위반(21, dispatch를 거치지 않은 직접 수정). 브리프 §3.5 "거부 세 갈래(내용·자격·경로)"와 같은 구분이다.

## 11. 목록

### 11.1 (a) 사용자 결정·동의

이 범위에서 사용자가 Claude의 설계 제안에 명시적으로 동의한 경우는 없다. 아래는 사용자의 답, 요구, 선택, 판단이다.

| ID | 행 | 내용 | 성격 |
|---|---|---|---|
| X3-2-02 | L2019 | 가장 많이 건너뛰는 루프는 "C와 A" | 사용자 진술. C·A 우선 구현의 근거 |
| X3-3-01 | L2173 | 세계 모델, 일의 단위, 운영 루프(세부·거시), 이해의 단계를 에이전트 런타임으로 구현하고 싶다 | 요구 |
| X3-4-01 | L2266 | 별도 엔진 없이 pi 안에서 구현할 수 있나 | 질문(결정 아님). 이후 브리프 결정 23으로 자체 런타임이 정해졌다 |
| X3-5-01 | L2352 | 피처 흐름 미리보기, pi durable·서브에이전트·확장으로 공리를 더 결정적으로 | 요구 |
| X3-6-01 | L2423 | 피처 해결보다 문제 해결 방안을 여러 개 찾아가는 과정에 초점 | 요구 |
| X3-7-01 | L2536 | 작업 유형에 따라 mode처럼 Helm 개념을 적용하고 싶다 | 요구 |
| X3-8-01 | L2673 | pi나 다른 벤더와 관계없이 순수하게 Helm을 구현하는 방법론과 아키텍처 | 요구 |
| X3-9-01, X3-9-05 | L2833, L2922 | 런타임 설명과 Helm 개념 모두 이해하기 어렵다 | 진술. 설명 방식(UX·문서) 근거 |
| X3-9-08 | L2954 | 관찰을 M으로 분류함(정정됨) | 진술 |
| X3-9-10 | L2978 | E를 "추측과 관찰"로 나눈다 | 진술 |
| X3-9-14 | L3002 | 근거 관찰과 함께 반증 탐색이 필요하다 | 진술 |
| X3-9-20 | L3045 | A = 실제 해결 확인 + 다른 프레임에서의 교차 점검 | 진술 |
| X3-9-23 | L3069 | 에이전트에게 맡기기 가장 위험한 것은 A: 책임질 대상이 없고 LLM 확인은 불확정적이다 | 판단. A6·결과 확인은 사람만 한다는 규칙의 사용자 측 근거 |
| X3-9-28 | L3119 | 판단 승격 조건 = 반증이 없고 증거가 명확히 확인된 것 | 진술(Claude가 "찾아봤는데 없었다"로 정정) |
| X3-9-32 | L3152 | 개념 쪽과 코드 쪽 "둘다" | 선택(학습 진행 방식) |
| X3-10-07 | L3186 | 시각화해서 보여 달라 | 요청 |

### 11.2 (b) 답 없는 제안

명시적 제안(작성·실행 제안)으로 사용자가 답하지 않은 것:

| ID | 행 | 제안 |
|---|---|---|
| X3-1-12 | L2086–2087 | [요약본] 최소 엔진 상태 기계 + pi 확장 뼈대, 발산 ①~③ 시제품, 흐린 작업 5개 실험, 다음 튜터 장(ypi vs Pi Durable owned conversations) |
| X3-2-21 | L2170 | C/A 상태 기계와 pi 확장 뼈대 작성, 가짜 모델로 합의~완료 재현 |
| X3-3-17 | L2263 | 저장소 스키마, 엔진 상태 기계, pi 확장 어댑터 작성 후 Orient~Integrate 재현 |
| X3-4-18 | L2349 | pi 안 구조로 core + pi 어댑터 작성, 한 턴 흐름 재현 |
| X3-5-09 | L2415 | pi-durable faux provider로 미리보기 6~9단계 재현 |
| X3-6-24 | L2533 | 진입 판단 규칙과 승격 신호 감지기 작성, 예시 요청으로 확인 |
| X3-7-20 | L2670 | 다섯 모드의 진입·종료 조건, 활성 도구, 생성 레코드, OPD+C 검사 명세 |
| X3-8-30 | L2830 | Helm 런타임 명세 문서(레코드 스키마, 능력 행렬, 모드 계약 5개, 재진입 규칙표, 공리별 네 항목 표) |

설계 내용으로서 사용자 확인 없이 남은 Claude 제안(모두 [제안] 수준):

- C/A: 합의 항목 6개(X3-2-07), 차단 규칙 2개(X3-2-09), 제출 형식(X3-2-11), 제출 전 정리(X3-2-12), 수용 옵션 4개(X3-2-13), 반영 목록(X3-2-14), 돌아보기 한 줄(X3-2-15), C/A 상태 기계(X3-2-16), 사람 조작 2회 상한(X3-2-19), 2주 지표 5개(X3-2-20)
- 평면 배치와 M 참조만 두기(X3-3-03~04), 일의 단위·수명(X3-3-05), 루프 세 크기(X3-3-07), 10단계 계약 표(X3-3-08), 생성·승격 규칙(X3-3-10), RLM 적용 네 곳(X3-3-11), 레코드 타입 10개로 시작(X3-3-12)
- pi 안 구조: 한 프로세스 두 코드, `.helm/ledger.jsonl`, 해시 체인, 파일 락, 기능 대응표, 폴더 구조(X3-4-03~12)
- pi-durable 위 공리 장치 표와 보장 수준(X3-5-04), 소유 규칙 활용(X3-5-03)
- 탐구의 네 결정(빈 칸 fork, 갈리는 관점 수 ÷ 비용, 1순위 해법을 바꾸는 질문 하나, 두 라운드 유지 멈춤)(X3-6-04~07)
- 범주 한정 Helm, 진입 경로 세 가지, 진입 조건 5개 중 2개 이상, 제외 조건, 승격 신호, 2~4주 범주 지표(X3-6-09~23)
- 모드 정의와 다섯 모드(X3-7-16~17), 루프 × 평면 표(X3-7-14)
- 순수 런타임: 단일 변경 경로(X3-8-04~06), 평면별 레코드 종류(X3-8-07), 쓰기 시점 제약 4개(X3-8-08), 이벤트 로그 정본(X3-8-09), 품질 상태 기계(X3-8-10), 해시 기반 stale(X3-8-11), 능력 행렬(X3-8-12), profile 표와 자동 상향·사람만 하향(X3-8-14), 개입 계산 함수(X3-8-15), 계층 상태 기계(X3-8-16), 데이터로서의 모드 계약 8칸(X3-8-17), 재진입 규칙표(X3-8-18), 거시 스케줄러(X3-8-19), OPD+C 의무·지표(X3-8-20), 내부 루프 계약 5능력과 보장 수준 낮추기(X3-8-21~22), 방법론 6단계(X3-8-23~28), 피할 것 4개(X3-8-29)

### 11.3 (c) 검증된 기술 사실

| ID | 행 | 사실 | 검증 방법 |
|---|---|---|---|
| X3-10-03 | L3161–3177 | `helm.mjs`는 21번 시도 중 8번(3, 4, 5, 7, 10, 17, 19, 21)을 거부하고 최종 상태는 C1 추측, C2 판단, 결과 확인됨(근거 T4) | [실험] 대화 당시 실행. 2026-10-11 저장소의 `experiments/helm-toy/helm.mjs`를 다시 실행해 같은 출력 확인 |
| X3-10-05 | - | `helm.mjs`의 action 목록과 검사, deepFreeze, 거부 포함 ledger | [원문] 파일 직접 읽음 |
| X3-4-07~08 | L2276–2295 | pi 1.1.0 확장 기능: `tool_result`, `user_bash`, `parentToolCallId`, `input`(`transform`), `before_agent_start`, `context`, `pi.setActiveTools`, `registerTool`+`outputSchema`, `tool_call`의 `block`, `agent_before_settle`(`entries`, `continue`), `ctx.ui.select/confirm/input`, `ctx.ui.setStatus`, `setWidget`, `registerCommand`, `session_start`→`sendMessage`, `session_before_compact`→`compaction`, `ctx.model`, `ctx.modelRegistry.getApiKeyAndHeaders`, `ctx.newSession`(명령 컨텍스트), `pi -p` | [원문] 대화 당시 설치된 pi 1.1.0 확장 타입 정의에서 확인했다고 Claude가 진술. 이 발췌 작성 중 재확인 안 함 |
| X3-4-10 | L2300 | `session_before_fork`, `session_tree` 이벤트가 있다 | 위와 같음 |
| X3-5-03 | L2361–2366 | pi-durable: 취소는 아래에서 위로 전파, 소유한 작업이 남으면 `completing`, `background: true`, fork는 부모 기록을 분기 시점까지 봄 | [원문] 대화 당시 npm으로 설치한 pi-durable 1.1.0 README(L2418). 재확인 안 함 |
| X3-5-04 | L2370–2385 | pi-durable 장치 이름: `initial(input)`, `configure({tools})`, `afterTool`, `beforeTool`, `write` 항목, `memo` 첫 기록 우선, `replay: "safe"`, `completing`, `section`, `history: "rewindable"`, `snapshotAsOf`, `sleep(until)`, `CompactionTask`의 `beforeCompact`, `interrupted`, `whenBusy: "steer"`, `pi.usage` | 위와 같음. 각 장치의 Helm 적용 방식은 Claude의 제안이다 |
| X3-5-07 | L2403–2406 | pi-durable에는 TUI가 없다. `watchEvents`는 실험적이고 `viewState`가 있다. 예제 `26-coding-agent`, `27-plan-mode`, `28-reviewer`. README Agent Events 절은 Experimental. 프로세스 간 락이 없다. codemode는 pi coding agent 쪽 기능이라 pi-durable에 같은 방식으로 붙지 않는다 | 위와 같음 |
| X3-5-06 | L2397 | pi-durable `env`로 대화마다 별도 실행 환경을 줄 수 있다 | 위와 같음 |
| X3-3-06 | L2202 | codemode store는 branch마다 다르다(branch A `{"a":2,"b":9}`, branch B `{}`) | [실험] 앞 대화의 `storage-lab.mjs`(요약본 L2046) |
| X3-3-11 | L2240, L2245 | RLM 구조에서 데이터 약 99k 토큰에 루트 컨텍스트 96 토큰, codemode 순차 1758ms → Promise.all 275ms | [실험] 앞 대화의 `toy-rlm.mjs`, `codemode-lab2.mjs`(요약본 L2042, L2044) |
| X3-1-05~07 | L2033–2049 | pi 1.x 이벤트·API 목록, codemode 제한값(10000, 3000, 256MB), rlm-minimal `max_iterations=20` 등 | [요약본] 대화 당시 코드·문서 읽기와 실험. 재확인 안 함. 브리프는 설계에 쓰는 pi API를 `~/projects/_ref/pi-src`로 확인하도록 한다 |
| X3-1-10 | L2053–2056 | `@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js`는 패키지 exports로 import할 수 없다(`ERR_PACKAGE_PATH_NOT_EXPORTED`) | [실험] [요약본] 대화 당시 오류 |
| X3-7-05~15 | L2539–2633 | 이전 Helm 문서(00-manifesto, 09-operating-theory, 10-refinement-candidate)의 OICA 표, 핵심 질문, 재진입 규칙 6개, 선형화 네 가지, NEMAP 내용, 관계 4개, 능력 7개, P 항목, OPD+C 기준. 문서에 모드·단계별 진입·종료 조건·OPD+C 측정 방법이 없다 | [원문] 대화 당시 Claude가 이전 Helm 문서를 다시 확인했다고 진술(L2539). 이 발췌 작성 중 재확인 안 함. `helm-canon*.md`와 대조 필요 |

### 11.4 (d) 열린 질문

| 번호 | 관련 항목 | 질문 |
|---|---|---|
| Q1 | X3-2-16 | C/A 상태 기계에 빠진 전이: 범위 확인 중의 "수정"·"취소", 멈출 조건 충족, 합의 종료·만료, "조건부 확인"의 조건을 어디에 기록하고 언제 해소하는가 |
| Q2 | X3-2-14 | 반영 목록 항목을 "명시적으로 미루기"하는 방법과 기록 형식, 미룬 항목의 재노출 시점 |
| Q3 | X3-2-19, X3-6-10 | 사람 조작 2회 상한과 범주 한정을 수치·규칙으로 정할지, 실제 사용 후 정할지 |
| Q4 | X3-2-20, X3-6-23 | 2주 지표와 2~4주 범주 지표의 수집 위치(커널, 관찰 에이전트)와 판정 문턱 |
| Q5 | X3-2-08, X3-8-14 | effect class 분류와 위험 기반 profile 계산을 Helm이 할지 권한 레이어에 맡길지(브리프 결정 2와 충돌) |
| Q6 | X3-4-14, X3-5-06 | bash 명령으로 쓰기 범위 검사를 우회하는 문제: 해시 체인 감지, 별도 실행 환경, 저장소를 실행 환경 밖에 두기 중 무엇을 기본으로 할지 |
| Q7 | 0.3, X3-4-08 | 모델 제출 도구 이름(`agreement.propose`/`helm_propose_agreement`, `result.submit`/`helm_submit_result`/`completion.submit`)과 사람 명령(`/focus`, `/brief`, `/agree`, `/accept`, `/reopen`)의 최종 이름 |
| Q8 | X3-6-04 | "관점 × 바꾸는 대상" 표의 열(바꾸는 대상 범주) 목록. 원문에 없다(위젯에만 있었음) |
| Q9 | X3-6-05~07 | 확인 순서 점수("갈리는 관점 수 ÷ 비용")의 단위, 질문 선택에서 "1순위 해법이 바뀌는가"의 판정 입력, 멈춤 규칙의 라운드 정의와 예산 단위 |
| Q10 | X3-6-13 | 진입 조건 5개의 신호를 모델이 어떤 형식으로 표시하는가, "2개 이상" 문턱을 다이얼로 둘지 |
| Q11 | X3-6-09 | 범주 한정 목록이 개발 작업 위주다. 브리프 결정 1의 취향 작업(글의 톤, 기획 방향, 디자인)을 어느 유형에 넣을지 |
| Q12 | X3-7-16 | 대화의 모드 정의(중심 루프 + 평면 + OPD+C 기준 + profile)와 브리프 결정 3(루프 계획 기본값 + 능력 부분집합 + 다이얼)의 대응 |
| Q13 | X3-7-12, X3-8-12 | v0.2 능력 7개 × 레코드 행렬과 브리프 결정 4의 능력 목록(원시 행동 6 + 기록 능력 5)의 대응 |
| Q14 | X3-8-10 | 품질 상태 기계의 전이표(어느 상태에서 contested·stale·superseded로 가는지, 되돌아오는지) |
| Q15 | X3-8-16 | Concern을 O→I→C→A 계층 상태 기계로 둘지, 브리프 결정 5처럼 루프 조합 + 의존 규칙만 강제할지. S 루프의 위치 |
| Q16 | X3-8-19 | 주의 예산의 단위와 배분 알고리즘, 선택 요청 병합 규칙 |
| Q17 | X3-8-05 | 단일 변경 경로 상자의 정확한 순서와 분기(위젯에만 있었음) |
| Q18 | X3-1-09, X3-7-06 | 성숙도 레벨이 0–5인지 L1–L5인지(이전 Helm 문서 확인 필요) |
| Q19 | X3-9-30 | Claim 스키마에 "구분 확인" 기록을 어떻게 둘지(`helm.mjs`에는 필드가 없다) |
| Q20 | X3-10-09 | 거부 분류 질문(행위자 / 내용 / 경로)에 사용자는 답하지 않았다. 거부 사유 분류 체계는 설계에서 정한다 |
| Q21 | X3-4-13 | 사람이 없을 때 도는 감시·관찰 에이전트의 실행 주체. 대화는 `pi -p` 스케줄을 제안했고 브리프는 데몬 상주(결정 22)로 정했다. 데몬 안의 스케줄러로 옮길 때의 세부 |

<!-- 0단계 완료 -->
