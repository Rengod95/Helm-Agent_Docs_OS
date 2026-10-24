# core-loop 포크 패치 기록

`src/loop/`의 `run-turn.ts`, `stream-response.ts`, `tool-batch.ts`는 pi-agent-core 1.3.0(MIT) `agent-loop.ts`의 함수를 옮겨 Xeon 루프로 다시 설계한 것이다(`adr.0009`).
원본 패키지, 판, tarball sha1, 복사 범위는 `UPSTREAM.json`에 있다. 라이선스 원문은 `LICENSE.pi`다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// XEON-PATCH: <id>` 표지. `test/fork-records.test.ts`가 이를 검사한다.
처음부터 Xeon 설계로 쓴 파일(`open-step.ts`, `commit-response.ts`, `step-end.ts`, `before-start.ts`, `prepare-request.ts`, `finish-turn.ts`, `turn-run.ts`, `sink.ts`, `types.ts`)에는 표지를 달지 않는다.
원본 줄 번호는 `agent-loop.ts` 1.3.0 기준이다. 새 판은 따라가지 않는다(`adr.0009` §3.7).

## 패치 표

| 패치 id             | 위치                                                | 바꾸는 점과 이유                                                                                                                         | 확인 테스트                                      |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `entry-points`      | `run-turn.ts` (원본 `runAgentLoop`, `runAgentLoopContinue`) | 새 프롬프트·이어가기 두 진입점을 재개 판별자 네 가지(`fresh`, `request`, `tools`, `turn_end`)로 바꾼다. 재개 경로가 주 경로의 단계 함수를 그대로 쓴다 | `resume.test.ts`, `loop/run-turn.test.ts`        |
| `no-outer-loop`     | `run-turn.ts` (원본 `runLoop` 바깥 반복, 255-278)    | follow-up 바깥 반복을 없앤다. followUp은 새 turn이다(`F.extensions.spec` §4.4)                                                           | `turn.test.ts`                                   |
| `step-functions`    | `run-turn.ts`                                       | 단계 경계마다 커밋 지점(S1, C3, C5)과 확장 지점을 명시 단계 함수가 부른다. 콜백 훅(`finishTurn`, `prepareRequest`, `getSteeringMessages`)이 없다 | `loop.contract.test.ts`, `checkpoint.test.ts`    |
| `no-context-array`  | `stream-response.ts` (원본 381-476)                  | 컨텍스트 배열에 push하지 않는다. 요청마다 `xeon.context`가 커밋된 이벤트로 다시 만든다                                                    | `loop/stream-response.test.ts`                   |
| `no-api-key`        | `stream-response.ts` (원본 `getApiKey`, `apiKey`)    | 키 해석을 없앤다. `xeon.models`가 키를 임대하고 값은 모델 컨텍스트에 들어오지 않는다                                                      | `core-models` 시험                               |
| `model-slot`        | `stream-response.ts`                                | streamFn을 `modelCalls` 슬롯(`L1.tasks.spec` §4.5 C1)으로 감싼다                                                                          | `loop/stream-response.test.ts`                   |
| `batch-cancel`      | `tool-batch.ts` (원본 575-577, 613-615, 641-643)     | 취소되면 남은 호출을 `break`로 두지 않고 같은 배치 안에서 `tools.settleRejected(…, "not_executed")`로 닫는다                              | `loop/tool-batch.test.ts`                        |
| `batch-length`      | `tool-batch.ts` (원본 478-506)                       | `stopReason: "length"`면 호출을 실행하지 않고 `tools.settleRejected(…, "truncated")`로 닫는다. 결과 기록은 core-tools가 한다             | `loop/tool-batch.test.ts`                        |
| `batch-record`      | `tool-batch.ts` (원본 `prepareToolCall`, `finalizeExecutedToolCall` 호출부) | 한 호출의 준비·실행·결과 기록을 `xeon.tools`의 `prepare`·`execute`로 넘긴다. 루프는 돌려받은 `ToolCallOutcome`을 이벤트로 낸다 | `loop/tool-batch.test.ts`, `core-tools` 시험     |

## 복사하지 않은 것

`UPSTREAM.json`의 `notCopied`가 정본이다. `Agent` 클래스, 프록시, 전역 기본 streamFn, `EventStream` 포장, 도구 선언 차이 계산(`declareToolChanges`)은 가져오지 않았다.
