# 13. 스택 타당성 검토: assistant-ui + pi + pi-durable

> 검토일: 2026-10-11
> 확인한 버전: `@earendil-works/pi-durable` 1.1.0, `@earendil-works/pi-ai` 1.1.0, `@earendil-works/pi-coding-agent` 1.1.0, `@assistant-ui/react` 0.15.27
> 방법: 패키지 설치 후 타입 정의와 README 확인, pi-durable 스파이크 두 개 실행, assistant-ui 공식 문서 확인
>
> **갱신**: §1 표의 pi coding agent 행, §2.2(pi coding agent 판단), §2.4(assistant-ui 판단), §5(주 경로 권고)는 [14](14-alternative-structure.md)로 갱신되었다. 14는 pi coding agent + Helm 자체 저장소 구조를 검토했으며, 주 경로 권고는 프로세스 배치와 클라이언트 형태가 정해질 때까지 보류한다.
>
> **클라이언트 결정 (2026-10-11)**: 클라이언트는 웹이 아니다. 데스크톱 앱을 먼저 만들고, 이후 SSH + pi + 커스텀 TUI 경로를 더한다. 이 문서에서 assistant-ui를 클라이언트로 전제한 서술(§1, §2.4, §3.3, §4, §5-3)은 데스크톱 앱을 웹뷰로 만들 때만 다시 쓸 수 있고, TUI 경로에서는 쓸 수 없다. 클라이언트와 프로세스 배치는 15 기획 문서에서 다시 정한다.

## 1. 결론

**구현 가능하다.** 다만 세 구성요소의 역할을 다음처럼 나눠야 한다.

| 구성요소 | 역할 | 판정 |
|---|---|---|
| pi-durable | Helm 런타임의 바탕. 문서, task 상태 기계, 훅, 분기, 하위 대화, 타이머, 재시작 | 적합. 스파이크로 12가지 확인 (§2.1 표) |
| pi-ai | 모델 공급자, faux 공급자(테스트) | 적합 |
| pi coding agent | 주 경로에는 넣지 않음. 나중에 두 번째 어댑터나 개발용 TUI로 | 주 경로로는 부적합 (pi-durable과 별개 런타임) |
| pi-codemode | 탐구의 REPL 실행 | 조건부 적합. 내부 도구 호출이 pi-durable 훅을 거치지 않음 |
| assistant-ui | Concern 대화 패널과 helm_* 도구 카드 | 적합. 단 상태 중심 화면은 직접 만들어야 함 |

## 2. 구성요소별 검토

### 2.1 pi-durable

#### Helm에 필요한 것과 pi-durable의 대응

| Helm 요구 | pi-durable 기능 | 확인 |
|---|---|---|
| 기록과 대화가 어긋나지 않음 | 항목·문서·task를 같은 commit에 기록 | 스파이크 1 |
| Concern 상태 기계 | `defineTask`의 phase, checkpoint, waiting, outcome | 스파이크 2 |
| 재시작 후 재개 | SQLite 저장소 + `harness.resume()` | 스파이크 1, 2 |
| 합의 없는 쓰기 차단 | `ToolTask.beforeTool`에서 문서를 읽고 `block` | 스파이크 1 |
| 관찰 자동 기록 | `wrapTool`로 원시 도구를 감싸고 `api.commit` | 스파이크 1 |
| 거부된 시도 기록 | 차단된 호출이 `blocked` 진단을 가진 tool-result 항목으로 남음 | 스파이크 1 |
| 제출 없이 끝내기 방지 | `GenerationTask.onYield`의 `continue` | 스파이크 1 |
| 사람 결정은 모델 경로 밖 | host에서 `conversation.commit` | 스파이크 1, 2 |
| 지어낸 근거 거부 | 도구에서 오류를 던지면 모델이 오류 결과를 받음 | 스파이크 1 |
| WorkUnit 대기 | 하위 task 생성 후 `status: "waiting"` | 스파이크 2 |
| 지속 타이머 | `runtime.sleep(until)` (재시작을 넘겨 동작) | 스파이크 2 |
| UI 스트림 | `watchEvents`(실험), `viewState`, `watch`, `watchDoc`, `taskGraph` | 스파이크 1 (watchEvents) |
| 발산 분기 | `fork` (복사 없이 같은 항목에서 분기) | README 확인 |
| 검증자 | task가 소유한 새 대화, 대화별 모델·도구 설정 | README 확인 (예제 22, 28) |
| 요약 제어 | `CompactionTask.beforeCompact` | README 확인 |
| 시점별 상태 조회 | 문서 `history: "rewindable"` + `snapshotAsOf` | README 확인 |
| 첫 기록 우선 결정 | `memo` | 타입 확인, 스파이크 1에서 사용 |

#### 한계와 대응

| 한계 | 영향 | 대응 |
|---|---|---|
| 훅은 문서를 읽기만 할 수 있음 (HookApi = DocumentReader) | 훅에서 관찰이나 거부를 문서에 쓸 수 없음 | 막는 판단만 훅에서. 기록은 도구 래퍼, 도구 본체, 서버 명령에서 |
| `wrapTool`은 도구가 아니라 래퍼 | `tools`에 넣으면 오류 | `defineExtension({ wraps: [...] })`에 넣음 |
| session 문서는 처음 쓸 때 생성됨 | 초기 스냅숏이 undefined | 서버 시작 시 초기화 commit |
| 저장소 하나에 프로세스 하나, 프로세스 간 락 없음 | 관찰 에이전트를 별도 프로세스로 못 돌림 | 같은 프로세스 안의 background task로 |
| 실험 단계 (README의 Agent Events 절도 Experimental) | API 변경 가능 | 커널을 pi-durable 타입에 묶지 않음, 버전 고정, 어댑터 얇게 |
| UI 없음 | 클라이언트를 직접 만들어야 함 | assistant-ui + 직접 만든 상태 화면 |
| 사람 결정 대기에 전용 원시 기능이 없음 (스파이크는 폴링) | 불필요한 깨어남 | 이벤트 기반 대기 방식 확인 후 교체 ([12 §6.2](12-implementation-architecture.md)) |
| faux 도구 호출 메시지는 `stopReason: "toolUse"`를 지정해야 도구가 실행됨 | 테스트 대본 작성 시 주의 | 테스트 헬퍼에서 처리 |

### 2.2 pi coding agent

pi coding agent 1.1.0은 pi-agent-core 위에 만들어졌고 pi-durable에 의존하지 않는다(설치된 package.json으로 확인). 확장 API(`pi.on(...)`)도 pi-durable의 `defineExtension`과 다르다.

| 쓰임 | 판단 |
|---|---|
| Helm 주 런타임 | 부적합. pi-durable과 섞으면 런타임이 둘이 됨 |
| 두 번째 어댑터 | 적합. 커널이 런타임과 무관하다는 것을 확인하는 데 쓸 수 있음 (M8) |
| 개발 중 TUI | 가능. 커널을 pi 확장으로 붙여 터미널에서 시험 |

"pi"를 pi 생태계 전체로 본다면, Helm이 실제로 쓰는 것은 pi-durable, pi-ai, pi-durable/tools(read, write, edit, bash), pi-codemode, 필요하면 pi-mcp다.

### 2.3 pi-codemode (REPL 탐구)

v0.3 이전 논의에서 `CodemodeSandbox`를 pi coding agent 없이 단독으로 실행해 확인했다. 따라서 pi-durable 도구 하나(`helm_repl`) 안에서 샌드박스를 띄워 탐구를 코드로 수행할 수 있다.

주의할 점: 샌드박스 안에서 부르는 `tools.*`는 pi-durable의 ToolTask를 거치지 않으므로 `beforeTool` 훅이 적용되지 않는다. 그래서 샌드박스에 넘기는 도구 브리지 안에서 권한 검사와 관찰 기록을 직접 해야 한다. REPL 변수는 작업 메모이고, 기록은 브리지가 커널을 거쳐 남긴다.

### 2.4 assistant-ui

#### 적합한 부분

| 요구 | assistant-ui 기능 |
|---|---|
| 서버가 정본인 대화 표시 | `useExternalStoreRuntime`: 메시지와 영속성은 우리가 소유하고, 런타임은 표시와 사용자 행동 콜백만 담당 |
| 메시지 스트리밍 | 스토어의 메시지를 제자리에서 갱신하고 `isRunning`을 유지 |
| 입력, 중단 | `onNew`, `onCancel` |
| 실행 중 입력 | `queue` (pi-durable의 steer/followUp과 연결) |
| helm_* 도구 카드 | 도구별 렌더러 (`Toolkit` / `Tools()` 방식) |
| React 18 | peerDependencies `react ^18 || ^19` |

#### 맞지 않는 부분

| 항목 | 이유 | 대응 |
|---|---|---|
| 상태 중심 화면 | assistant-ui는 대화 스레드 중심 | 홈, Concern 상세, 질문함, 결정 피드, 탐구 보드, 다이얼은 직접 구현. assistant-ui는 대화 패널에만 |
| 사람 결정을 tool result로 보내는 패턴 | Helm에서는 사람 결정이 모델 도구 경로를 거치면 안 됨 | 도구 카드의 버튼은 `/decisions` 명령을 보냄. `onAddToolResult`는 쓰지 않음 |
| AssistantTransport 런타임 | 상태 연산 스트림 방식이라 pi-durable과 잘 맞아 보이지만, 재개(resume)에 필요한 sync server가 enterprise 플랜 전용이고 wire 형식이 SSE로 바뀔 예정 | 쓰지 않음. pi-durable이 늦은 합류를 지원하므로 자체 WebSocket으로 충분 |
| API 변동 | 도구 UI 등록이 `makeAssistantToolUI`에서 `Toolkit`/`Tools()`로 바뀜. 0.x 버전 | 버전 고정, 도구 카드를 얇은 래퍼 뒤에 둠 |

#### 대안 비교

| 대안 | 판단 |
|---|---|
| assistant-ui 없이 대화 패널도 직접 구현 | 가능. 대화 패널이 Helm의 주 화면이 아니므로 비용이 크지 않음. assistant-ui가 맞지 않으면 언제든 전환 |
| assistant-ui의 OpenCode 런타임 | 실험 단계이며 OpenCode 서버 전용 |
| assistant-ui의 AG-UI 런타임 | 서버를 AG-UI 프로토콜로 맞추면 가능. 지금은 이득이 적음 |

## 3. 스파이크 결과

### 3.1 스파이크 1: 약속과 확인 흐름

`experiments/durable-spike/helm-spike.mjs`. faux 공급자, SQLite 저장소, Helm 확장(문서 1개, 원시 도구 2개 + 래퍼, 제안 도구 2개, 훅 2개).

```text
run1: done
  agreement: {"status":"proposed","scope":"docs/","criteria":["README의 세 절을 모두 다룸"],"proposedBy":"agent"}
human: agreement agreed
run2: done

tool results:
  c1 read_note              ok    | # Proj ...
  c2 write_note             ERROR [blocked] | Tool call blocked: 작업 합의가 확정되지 않음
  c3 helm_propose_agreement ok    | 합의 초안 기록됨. 사람의 확인을 기다림
  c4 write_note             ERROR [blocked] | Tool call blocked: 합의 범위(docs/) 밖
  c5 write_note             ok    | wrote docs/summary.md
  c6 helm_submit_result     ERROR [tool_error] | 근거 made-up는 실제 도구 실행 결과가 아님
  c7 helm_submit_result     ok    | 결과 제출됨. 사람의 확인을 기다림
event types: {"message_start":21,"message_end":21,"submission":4,"run_start":2,"turn_start":10,
              "usage_changed":10,"tool_execution_start":5,"tool_execution_end":7,"turn_end":10,"run_end":2}

after restart:
  observations: c1:read_note, c5:write_note
  agreement: agreed | result: {"status":"accepted","evidence":["c5"],"acceptedBy":"human"}
  rejected: [{"by":"agent","what":"submit","reason":"근거 made-up 없음"}]
```

확인된 것:
- 합의가 없을 때와 범위 밖일 때 쓰기가 차단되고, 차단도 기록에 남는다 (c2, c4).
- 실행된 도구만 관찰이 된다 (c1, c5). 차단된 호출은 관찰이 아니다.
- 모델이 "작성했습니다"로 끝내려 하자 onYield가 제출을 요구했고, 모델이 c6, c7을 이어서 실행했다.
- 지어낸 근거는 거부되고 이유가 모델에게 돌아갔다 (c6).
- 합의 확정과 결과 확인은 host commit으로만 이뤄졌다.
- 프로세스를 닫고 다시 열어도 문서 상태가 그대로 남았다.

### 3.2 스파이크 2: Concern 상태 기계

`experiments/durable-spike/concern-task-spike.mjs`. Concern task(orient → awaitAgreement → assure)와 WorkUnit task.

```text
[Concern] O 완료 → 합의 대기
task graph(재시작 전): helm.concern:running
── 프로세스 종료 후 재시작 ──
사람: 합의 확정 (host commit)
[Concern] 합의 확인됨 → WorkUnit 생성, 대기(waiting)
  [WU 9] 실행: docs/summary.md 작성
Concern 최종: {"status":"completed","result":{"evidence":"obs-42"}}
[Concern] A: WorkUnit 결과 completed, 근거 obs-42 → 완료
문서: loop=A, transitions=O→C, C→A
```

확인된 것:
- phase 전이와 루프 전환 기록이 같은 commit에 들어간다.
- 합의 대기 중 프로세스를 종료하고 다시 열어도 task가 이어서 돈다.
- 사람이 합의를 확정하면 WorkUnit task를 만들고, 그 task가 끝날 때까지 대기한 뒤 결과를 받아 A로 넘어간다.

### 3.3 확인하지 못한 것

| 항목 | 다음에 확인할 방법 |
|---|---|
| 실제 모델(공급자)로 같은 흐름 | 공급자 키를 넣고 스파이크 1 재실행 |
| fork 기반 발산 분기의 독립성 | 같은 항목에서 분기 3개를 만들고 서로의 항목이 보이지 않는지 확인 |
| 검증자 대화의 다른 모델 설정 | 예제 28(reviewer) 방식으로 구현 |
| beforeCompact로 Helm 요약 강제 | 긴 대화로 컴팩션을 유발해 확인 |
| 이벤트 기반 사람 결정 대기 | DocumentObserver API 확인 |
| assistant-ui와 서버 스트림 연결 | M3에서 최소 화면으로 확인 |
| pi-codemode를 pi-durable 도구 안에서 실행 | `helm_repl` 시제품 |

## 4. 위험

| 위험 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| pi-durable API 변경 | 중간 | 중간 | 커널을 순수 모듈로 분리, 어댑터 얇게, 버전 고정, 통합 테스트로 변경 감지 |
| assistant-ui API 변경 | 중간 | 낮음 | 대화 패널만 쓰므로 교체 비용이 작음 |
| watchEvents 실험 API | 중간 | 낮음 | 같은 정보를 viewState·watch에서도 얻을 수 있음 |
| 개인 개발 범위 대비 클라이언트 작업량 | 높음 | 중간 | M3에서 최소 화면부터, 상태 화면은 단계적으로 |
| 단일 프로세스 구조 | 낮음 | 중간 | 개인용 전제에서는 문제 아님. 여러 기기는 서버 하나에 여러 클라이언트로 |

## 5. 권고

1. **주 런타임은 pi-durable로 정한다.** Helm의 결정성 요구(원자적 기록, 상태 기계, 재시작, 소유 구조)를 직접 지원하는 것은 pi-durable 쪽이다.
2. **pi coding agent는 주 경로에서 뺀다.** 커널이 안정된 뒤 두 번째 어댑터로 붙여 벤더 중립성을 확인하는 데 쓴다.
3. **assistant-ui는 대화 패널 전용으로 쓴다.** ExternalStoreRuntime + 자체 WebSocket. AssistantTransport는 쓰지 않는다.
4. **커널을 먼저 만든다.** M1(커널)과 M2(C/A 어댑터)는 UI 없이 faux 대본 테스트로 진행할 수 있다. 스파이크 두 개가 첫 통합 테스트가 된다.

## 6. 출처

- [assistant-ui: ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store) — 원문 확인
- [assistant-ui: Picking a Runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime) — 원문 확인
- [assistant-ui: AssistantTransport](https://www.assistant-ui.com/docs/runtimes/assistant-transport) — 원문 확인
- [assistant-ui: Tools 가이드](https://www.assistant-ui.com/docs/guides/tools) — 원문 확인
- `@earendil-works/pi-durable` 1.1.0 README와 타입 정의 — 설치 후 확인
- `@earendil-works/pi-ai` 1.1.0 faux 공급자 타입 — 설치 후 확인
- `@earendil-works/pi-coding-agent` 1.1.0 package.json — 설치 후 확인
