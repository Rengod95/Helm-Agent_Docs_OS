# 14. 대안 구조 검토: assistant-ui + pi coding agent + Helm 자체 저장소

> 검토일: 2026-10-11
> 확인한 자료: assistant-ui 공식 문서(런타임, Interactables, 생성형 UI, 요소 6종, 상태 훅, Cloud, 설치, OpenCode 런타임), `@earendil-works/pi-coding-agent` 1.1.0 문서(RPC, SDK, RPC 확장 UI, JSON 이벤트)와 타입 정의
> 관계: [13](13-stack-feasibility.md)의 pi-durable 경로에 대한 대안. 13 §2.4의 assistant-ui 판단은 이 문서 §5로 갱신한다.
>
> **갱신**: 2026-10-11 결정(데스크톱 앱 우선, 제품 소유자의 개인 WSL 서버에서 도는 Helm 데몬, 클라이언트가 연결되지 않아도 작업 계속, 관찰 에이전트가 pi 세션 파일을 읽음)에 따라 다음 부분은 다시 검토 중이다. 클라이언트 부분(§2 구조도 위쪽, §5), 그리고 pi 세션을 메모리에서만 돌리는 방식(§3.2 (b), §3.4)이다. §7의 주 경로 권고도 15 기획 문서에서 프로세스 배치를 정할 때까지 보류한다.

## 1. 질문과 결론

**질문**: pi-durable 대신 pi coding agent를 런타임으로 쓰고, Helm의 영속성 저장소는 직접 만들어 확장으로 연결하는 구조는 어떤가.

**결론**: 가능하며, Helm의 원래 목표에는 이 구조가 더 잘 맞는다.

- 처음 목표는 "어떤 런타임을 쓰든 같은 하네스"였다. 이를 위해서는 Helm의 상태가 런타임 바깥, Helm이 소유한 스키마에 있어야 한다.
- pi-durable 경로에서는 Helm 상태가 pi-durable 저장소 형식(문서, task) 안에 들어간다. 런타임을 바꾸면 상태 저장 방식도 바뀐다.
- 이 구조에서는 Helm 저장소가 독립되어 있고, pi coding agent는 교체 가능한 실행기가 된다.

이 구조의 대가는 pi-durable이 해 주던 지속 실행 기능(재시작 재개, task 상태 기계, 하위 작업 대기, 타이머)을 직접 만들어야 한다는 점이다. 개인용, 단일 서버 전제에서는 감당할 만한 양이다(§4).

## 2. 구조

```text
┌─────────────── helm-web (React 18, assistant-ui) ───────────────┐
│ 대화 패널 (ExternalStoreRuntime) · 승인·결과 카드 · 타임라인     │
│ 상태 화면 (홈, Concern 트리, 질문함, 결정 피드, 근거 체인, 다이얼) │
└───────────────▲───────────────────────────────┬──────────────────┘
                │ WebSocket (상태 스트림)        │ HTTP (명령)
┌───────────────┴──────────── helm-server (Node 22) ───────────────┐
│ helm-kernel (순수 규칙)                                           │
│ Helm 저장소 (SQLite, Helm 소유 스키마): 레코드 · 이벤트 · 대화 기록 │
│ 스케줄러: 타이머, 재시작 재개, 하위 작업 대기                      │
│ 세션 호스트: Concern·WorkUnit마다 pi SDK 세션                      │
│   createAgentSession({ sessionManager: inMemory(복원된 항목),       │
│                        resourceLoader: Helm 확장 포함 })            │
│ (선택) 격리가 필요한 WorkUnit은 pi RPC 자식 프로세스               │
└───────────────────────────────────────────────────────────────────┘
```

| 구성요소 | 역할 |
|---|---|
| helm-kernel | [12 §5](12-implementation-architecture.md)와 같음. 런타임과 무관 |
| Helm 저장소 | 정본. Helm 레코드와 대화 기록을 같은 SQLite에 보관 |
| 스케줄러 | Concern 상태 기계 구동, 타이머, 재시작 후 재개 |
| 세션 호스트 | pi SDK로 세션을 만들고, Helm 확장을 붙이고, 이벤트를 저장소에 기록 |
| pi coding agent | 에이전트 루프, 도구(read, write, edit, bash, codemode, MCP), 컴팩션, 공급자 인증 |
| assistant-ui | 대화 패널과 일부 화면 요소 (§5) |

## 3. 영속성 경계 [제안]

### 3.1 문제: 이중 기록

pi coding agent는 자기 세션 기록(JSONL 파일)을 가진다. Helm 저장소도 기록을 가진다. 둘을 따로 쓰면 한쪽만 기록되고 다른 쪽은 빠지는 경우가 생긴다. pi-durable 경로에서는 대화 항목과 문서를 같은 commit에 기록했기 때문에 이 문제가 생기지 않았다.

### 3.2 선택지

| 선택지 | 방법 | 판단 |
|---|---|---|
| (a) 둘 다 유지하고 대조 | pi 세션 파일과 Helm 저장소를 각각 쓰고, 시작할 때 서로 맞춰 봄 | 대조 로직이 복잡하고 어긋남이 남음 |
| (b) Helm 저장소가 대화 기록까지 보관 | pi 세션은 메모리에서만 돌리고(`SessionManager.inMemory`), 모든 항목을 Helm 저장소에 기록. 재시작 시 저장소에서 항목을 읽어 `inMemory(cwd, options, entries)`로 복원 | **권장.** 저장소가 하나라 SQLite 트랜잭션으로 원자성 확보 |
| (c) SessionManager를 Helm 저장소 기반으로 교체 | 저장 방식만 바꾸기 | 불가. 생성자가 private이고 파일과 메모리 방식만 제공 (타입 정의로 확인) |

### 3.3 (b) 방식의 동작

```text
pi 세션 이벤트 / 확장 이벤트
  message_end ─────────────┐
  tool_execution_end ──────┤→ 세션 호스트 → 한 SQLite 트랜잭션:
  확장의 tool_result 처리 ─┘     ① 대화 항목 추가
                                  ② 관찰 레코드 추가 (tool call id 출처)
                                  ③ kernel.apply로 Helm 상태 갱신
                                  ④ 이벤트 로그 추가
```

- pi coding agent의 확장 핸들러는 일반 코드라서 저장소에 직접 쓸 수 있다. pi-durable의 훅이 문서를 읽기만 할 수 있던 것과 다르다.
- 재시작 시: 저장소에서 Concern별 항목을 읽어 세션을 복원한다. 진행 중이던 턴은 잃는다.
- 도구 실행 도중에 프로세스가 죽은 경우: 도구 결과 항목이 없다. 복원할 때 "중단됨" 도구 결과를 넣어 모델에게 알린다. 다시 실행해도 안전한 도구만 재실행한다. pi-durable의 `replay: "safe"` 규칙을 직접 구현하는 것이다.

### 3.4 남는 한계

- pi의 터미널 UI로 같은 세션을 열어 볼 수 없다. 세션이 pi 파일이 아니라 Helm 저장소에 있기 때문이다. 필요하면 내보내기 기능을 만든다.
- pi 내부 상태 중 이벤트로 나오지 않는 것(예: 일부 설정 변경)은 복원 시 다시 적용해야 한다.

## 4. 직접 만들어야 하는 것

| 기능 | pi-durable에서 | 이 구조에서 | 난이도 |
|---|---|---|---|
| 원자적 기록 | 같은 commit | Helm 저장소 하나 + SQLite 트랜잭션 | 낮음 |
| 첫 기록 우선 결정 | memo | UNIQUE 제약 | 낮음 |
| 타이머 | `runtime.sleep` | 만료 시각 테이블 + 시작 시 재등록 + setTimeout | 낮음 |
| 분기 | fork | pi의 fork 또는 같은 항목에서 새 세션 생성 | 낮음 |
| 여러 클라이언트에 상태 전달 | watch | 서버 이벤트 팬아웃 | 낮음 |
| Concern 상태 기계 | defineTask phase | kernel의 순수 상태 기계 + 상태 테이블 + 스케줄러 루프 | 중간 |
| 하위 작업 대기, 취소 전파 | 소유 트리 | WorkUnit 테이블의 부모 링크 + 세션 abort 연쇄 | 중간 |
| 재시작 후 재개 | resume | 열린 Concern 스캔 → 상태별 재진입 → 중단된 턴 처리 | 중간 |
| 재실행 안전성 | `replay` 선언 | 도구별 안전 표시 + 복원 정책 | 중간 |

반대로 이 구조가 pi-durable 경로보다 나은 점도 있다.

| 항목 | 이 구조 | pi-durable 경로 |
|---|---|---|
| 여러 프로세스 접근 | SQLite WAL로 가능 (관찰 에이전트를 별도 프로세스로 둘 수 있음) | 저장소 하나에 프로세스 하나 |
| 훅에서 기록 | 가능 | 불가 (읽기만) |
| 도구와 기능 | edit, bash, codemode, MCP, 스킬, 프롬프트 템플릿, 컴팩션이 이미 다듬어져 있음 | read, write, edit, bash 정도 |
| 성숙도 | 사용 중인 1.x 앱 | 실험 단계 |
| 스키마 소유 | Helm | pi-durable |

## 5. assistant-ui 적합성 (조사 결과)

### 5.1 기능별 판단

| 기능 | 내용 | Helm에서의 판단 |
|---|---|---|
| ExternalStoreRuntime | 메시지와 영속성은 우리가 소유. 콜백으로 입력, 중단, 도구 결과, **도구 승인(`onRespondToToolApproval`)** 처리 | 대화 패널에 적합 |
| OpenCode 런타임 | 코딩 에이전트 서버(OpenCode)를 ExternalStoreRuntime + RemoteThreadList로 연결. 세션을 스레드로, 이벤트 스트림을 메시지로 투영, 하위 에이전트 대화를 도구 호출 안에 표시. 실험 단계 | pi 연결의 참고 구현. 같은 방식으로 Concern 세션 → 스레드, WorkUnit 세션 → 도구 호출 안의 하위 대화 |
| 요소: Approval card | 독립 사용 가능(상태와 콜백을 우리가 소유). 런타임 사용 시 승인 게이트와 연결 | 합의 카드, 권리 게이트 질문에 적합. 버튼은 `/decisions`로 |
| 요소: Timeline | 독립 사용 가능. `events` 배열(과거/현재/미래) | 루프 이력, 전환 기록에 적합 |
| 요소: Flow graph | 독립 사용 가능. `nodes`(열·행·상태), `edges` | Concern 트리, 루프 조합 표시에 적합 |
| 요소: Background runs | 독립 사용 가능. `runs`(running/ready/failed) + `onCollect` | 진행 중인 WorkUnit, 결과 확인 대기 목록에 적합 |
| 요소: Canvas split | 독립 사용 가능. 문서를 스레드 옆에 크게 표시. 편집 API는 없음 | 산출물(초안) 표시에 적합. 편집은 직접 구현 |
| 생성형 UI | 모델이 미리 정한 컴포넌트 목록으로 화면 조립. 버튼 동작은 **우리 앱 함수로 처리 가능**(action registry). 다만 문서 예시가 AI SDK 런타임과 컴파일러 플러그인(Vite용 `aui()`)을 전제로 하고, 패키지 버전이 `^0.0.1` | 가능성 비교, 대비 압축 화면에 매력적. 초기 단계라 시제품에서만 시험 |
| Interactables | 사람과 모델이 같은 상태를 편집. `unstable_` 접두사. 모델 편집을 **적용 전에 가로채는 지점이 문서에 없음**. 저장된 상태를 불러올 때 검증하지 않음 | **Helm 규칙과 충돌.** 모델 편집이 커널을 거치지 않고 바로 적용됨. 쓰지 않거나 표시 전용으로만 |
| 상태 훅 (`useAui`, `useAuiState`, `useAuiEvent`) | 스레드 밖 컴포넌트에서 스레드 상태 읽기 | 헤더, 사이드바에서 실행 상태 표시 |
| Assistant Cloud | 호스팅 백엔드(영속성, 인증, 분석). 선택 사항 | 쓰지 않음. Helm 저장소가 영속성을 맡음 |
| 설치·라이선스 | npm 패키지 + 컴포넌트 소스 복사(shadcn 방식). MIT | 요소가 우리 코드가 되므로 고쳐 쓰기 쉬움 |
| 프레임워크 | 문서가 Next.js 위주. ExternalStoreRuntime과 요소는 React 18 SPA에서도 사용 가능 | Vite + React 18 CSR로 진행 가능 |
| 안정성 | 0.x. 도구 UI 등록 API가 최근 바뀜 | 버전 고정, 얇은 래퍼 |

### 5.2 Helm 화면 매핑 (갱신)

| Helm 화면 | 사용할 것 |
|---|---|
| Concern 대화 | ExternalStoreRuntime + Thread |
| 합의 카드, 권리 게이트 질문 | Approval card (독립 모드) |
| 결과 확인 카드 | Approval card 변형 또는 직접 구현 |
| 루프 이력 | Timeline |
| Concern 트리, 루프 조합 | Flow graph |
| 진행 중인 WorkUnit, 확인 대기 | Background runs |
| 산출물 | Canvas split |
| 가능성 비교, 대비 압축 | 생성형 UI (시험) 또는 직접 구현 |
| 원함 탐구 자극판 | 직접 구현 (요소 단위 반응이 필요하고, Interactables는 규칙과 충돌) |
| 홈, 근거 체인, 다이얼, 결정 피드 | 직접 구현 (디자인 부품 사용) |

13번 문서에서 "assistant-ui는 대화 패널 전용"이라고 한 판단은 이 표로 대체한다.

### 5.3 지켜야 할 규칙

assistant-ui의 요소를 쓰더라도 Helm 규칙은 유지한다.

- 사람이 누른 버튼은 서버의 `/decisions` 명령으로 보낸다. 도구 결과나 Interactable 상태 변경으로 보내지 않는다.
- 모델이 화면 상태를 바꾸는 기능(Interactables, Component Tools)은 쓰지 않는다. 모델이 바꾸려는 것은 helm_* 제안 도구로 커널에 보내고, 받아들여진 것만 스트림으로 화면에 돌아온다.

## 6. 두 경로 비교

| 기준 | pi-durable 경로 (12, 13) | 이 구조 |
|---|---|---|
| 벤더 중립 (상태가 런타임 밖) | 약함. Helm 상태가 pi-durable 형식 안에 있음 | 강함. Helm 저장소가 독립 |
| 지속 실행 보장 | pi-durable이 제공 | 직접 구현 (§4) |
| 런타임 성숙도 | 실험 단계 | 사용 중인 1.x |
| 도구와 기능 | 기본 도구 정도 | 풍부함 |
| 훅에서 기록 | 불가 | 가능 |
| 여러 프로세스 | 불가 | 가능 |
| 초기 구현량 | 적음 | 많음 (스케줄러, 재개 로직) |
| 실제 모델 없이 테스트 | faux 공급자로 확인됨 | 확인 필요 (§8) |
| 런타임 교체 | 어댑터 교체 + 저장소 이전 | 세션 호스트만 교체 |

## 7. 권고

**이 구조(assistant-ui + pi coding agent + Helm 자체 저장소)를 주 경로로 권한다.** 이유는 다음과 같다.

1. 처음 목표인 벤더 중립과 맞다. 상태를 Helm이 소유하므로 런타임을 바꿔도 저장소와 커널은 그대로다.
2. pi coding agent는 이미 매일 쓰는 도구라 도구와 기능이 다듬어져 있고, 실험 단계 패키지에 의존하지 않는다.
3. 직접 만들어야 하는 지속 실행 기능은 개인용 단일 서버 전제에서 감당할 수 있는 양이다. 그리고 그 대부분(상태 기계, 재진입 규칙)은 어차피 Helm 커널의 일이다.

pi-durable은 버리지 않는다. 커널이 순수 모듈이므로 나중에 pi-durable을 두 번째 실행 어댑터로 붙일 수 있다. 이미 만든 스파이크 두 개는 그때의 참고 자료가 된다.

12번 문서의 패키지 구조와 단계 계획은 대부분 그대로 쓰고, 다음만 바꾼다.

| 12번 항목 | 변경 |
|---|---|
| helm-durable 패키지 | helm-pi (세션 호스트, Helm 확장, 이벤트 기록) + helm-store (SQLite 스키마, 트랜잭션) + helm-scheduler |
| §4 데이터 매핑 | pi-durable 문서·task 대신 Helm 저장소 테이블 |
| §6 Concern task | kernel 상태 기계 + 스케줄러 |
| M2 완료 기준 | "재시작 후 열린 Concern이 이어서 진행됨"을 추가 |

## 8. 확인할 것 (다음 스파이크)

| 항목 | 방법 |
|---|---|
| pi SDK를 실제 모델 없이 시험할 수 있는가 | 사용자 정의 공급자로 pi-ai faux 공급자를 연결해 `createAgentSession` 실행 |
| inline 확장에서 `tool_call` 차단, `tool_result` 기록이 SDK 세션에서도 동작하는가 | `DefaultResourceLoader`의 inline 확장으로 Helm 확장을 붙여 스파이크 1과 같은 대본 실행 |
| `inMemory(cwd, options, entries)`로 복원한 세션이 이어서 동작하는가 | 저장소에 기록한 항목으로 세션을 다시 만들고 다음 턴 실행 |
| 이벤트 → SQLite 트랜잭션 기록의 원자성 | 도구 실행 중 프로세스 강제 종료 후 복원 |
| assistant-ui ExternalStoreRuntime + 요소의 Vite 동작 | 최소 화면: Thread + Approval card + Timeline |

## 9. 출처

- [assistant-ui: ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [assistant-ui: Custom backend overview](https://www.assistant-ui.com/docs/runtimes/custom/overview.md)
- [assistant-ui: Interactables](https://www.assistant-ui.com/docs/tools/interactables.md)
- [assistant-ui: Generative UI](https://www.assistant-ui.com/docs/tools/generative-ui.md)
- [assistant-ui: Approval card](https://www.assistant-ui.com/elements/approval-card.md)
- [assistant-ui: Timeline](https://www.assistant-ui.com/elements/timeline.md)
- [assistant-ui: Flow graph](https://www.assistant-ui.com/elements/flow-graph.md)
- [assistant-ui: Background runs](https://www.assistant-ui.com/elements/background-inbox.md)
- [assistant-ui: Canvas split](https://www.assistant-ui.com/elements/canvas-split.md)
- [assistant-ui: Reading state outside the thread](https://www.assistant-ui.com/docs/guides/state-outside-the-thread.md)
- [assistant-ui: Assistant Cloud](https://www.assistant-ui.com/docs/cloud.md)
- [assistant-ui: Installation](https://www.assistant-ui.com/docs/installation.md)
- [assistant-ui: OpenCode runtime](https://www.assistant-ui.com/docs/runtimes/opencode/overview.md)
- [assistant-ui 문서 색인](https://www.assistant-ui.com/llms.txt)
- `@earendil-works/pi-coding-agent` 1.1.0: `docs/rpc.md`, `docs/sdk.md`, `docs/rpc-extension-ui.md`, `docs/json.md`, `dist/core/session-manager.d.ts`
