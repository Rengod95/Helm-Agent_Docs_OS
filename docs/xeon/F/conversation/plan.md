---
id: F.conversation.plan
layer: F
domain: conversation
kind: plan
status: draft
depends_on: [F.conversation.spec, adr.0009]
binds: [xeon/packages/contracts/src/conversation/**]
---

# F1 대화 모델 구현 계획

대상 스펙: `F.conversation.spec`. 패키지: `@xeon/contracts`, 서브패스 `./conversation`.

## 1. 목표와 마일스톤 배치

[결정] M0 범위에는 `contracts`(F 전 도메인의 TypeBox 타입)가 들어간다(`_research/foundation-plan.md` §5 P4 M0 범위). conversation은 다른 F 도메인(records, capabilities, extensions, wire-settings)이 ID와 메시지 타입을 가져다 쓰므로 F 안에서 가장 먼저 끝낸다.

| 마일스톤 | 범위 | 작업 |
|---|---|---|
| M0 | ID 8종과 `IdFactory`, pi 타입 re-export, 런타임 스키마 래퍼, `PartRecord`·`PartDelta`·`assignPartIds`, 계층 상태 enum과 전이표, 수명주기 알림 유니온과 payload 스키마, `AgentEventMapper` 타입, 도구 결과 3채널(`ToolResultRecord`)과 재생 정책(`ReplayPolicy`, `toReplayPolicy`), 인덱스와 exports | C1~C8 |
| M1 | L1-b(`L1.loop.spec`)가 `CreateAgentEventMapper`를 구현할 때 드러난 타입 결함만 고친다 | — |
| 자체 루프 이행(adr.0009) | pi-agent-core 재노출과 선언 병합 제거, 에이전트 루프 타입 `agent.ts` 정의(스펙 §3.1.1), `AgentToolHooks` 제거, `package.json`에서 pi-agent-core 제거 | C9 (`L1.loop.plan` LP16) |
| M2 이후 | `ResultStatus`의 `input_required` 실제 사용(MCP 서버 주도 요청, `L2.mcp.spec`), `PartKind`·`ItemKind` 열거형 확장 예약(`F.extensions.spec` 규칙 확정 뒤) | C7 후속 |

- `ResultStatus` 타입과 `status?` 필드 자체는 M0에 둔다. 선택 필드라 M2에서 값을 쓰기 시작해도 기존 기록이 바뀌지 않는다.

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/
  package.json                     # exports "./conversation", 의존성 고정
  src/conversation/
    ids.ts                         # 8개 ID 타입·스키마, idPattern, isId, IdFactory (Brand는 루트에서 import)
    pi.ts                          # pi-ai 타입 re-export만 (export type), F StreamFn·AssistantMessageEventStream 소비 계약
    agent.ts                       # 에이전트 루프 타입 (스펙 §3.1.1, adr.0009). 타입만
    message-schema.ts              # Type.Unsafe 래핑 런타임 스키마 (스펙 §3.3)
    parts.ts                       # PartKind, PartRecord, PartDelta, assignPartIds, partIdAt
    hierarchy.ts                   # 상태 enum, 전이표, canTransition, ItemRecord, XeonCustomMessage
    lifecycle.ts                   # LifecycleScope, 알림 유니온, payload 스키마, AgentEventMapper 타입
    tool-result.ts                 # ResultStatus, InputRequiredInfo, ToolResultRecord, 변환 함수, ReplayPolicy, toReplayPolicy
    index.ts
  test/conversation/
    ids.test.ts
    message-schema.test.ts
    pi-types.type-test.ts
    parts.test.ts
    lifecycle.test.ts
    tool-result.test.ts
    discriminants.test.ts
    no-pi-value-import.test.ts
    fixtures/pi-messages.ts        # satisfies Message 로 컴파일 검사되는 픽스처
```

- [제안] 스펙이 정한 파일 목록에 `message-schema.ts`를 더한다. `pi.ts`를 타입 전용으로 두어 값 import 검사를 파일 단위로 단순하게 하려는 선택이다.
- `isolatedDeclarations`가 켜져 있다(`_research/foundation-plan.md` §2). 모든 export 상수·함수에 명시 타입 주석을 단다. 이 규칙은 모든 작업의 완료 조건에 들어간다.
  - Xeon 소유 스키마: `export const PartRecordSchema: TObject<{ partId: TUnsafe<PartId>; ... }> = Type.Object({...})`, 타입은 `export type PartRecord = Static<typeof PartRecordSchema>`(스펙 §3 머리말, `_research/notes/eng-2.md` §3-4의 `TAddOptional`, `TUnion<[...]>`, `TLiteral<...>` 주석 형식).
  - 브랜드 ID와 pi 래핑: `export const ThreadIdSchema: TUnsafe<ThreadId> = Type.Unsafe<ThreadId>(Type.String({...}))`.
  - 전이표 상수: `Readonly<Record<S, readonly S[]>>`.
- `Brand`, `Result`, `Bug`는 `@xeon/contracts` 루트 진입점의 것을 쓴다(`eng.typescript.guide` §1.2). 정의는 `src/base/`에 있고 루트 `src/index.ts`는 이 공용 기반 이름만 다시 export한다(`F.readme` §3). 루트 파일을 만드는 작업이 C1보다 먼저 끝나 있어야 한다. 끝나 있지 않으면 C1이 `src/base/`에 `Brand`만 먼저 둔다.
- `verbatimModuleSyntax` 때문에 타입은 `import type`/`export type`으로만 가져오고 내보낸다. `index.ts`의 `pi.ts` 재수출은 `export type *`이다.
- `package.json` 변경:

```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./conversation": "./src/conversation/index.ts"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "1.3.0",
    "typebox": "catalog:"          // 워크스페이스 catalog 1.3.27
  },
  "xeon": { "layer": "F", "domain": "contracts" }
}
```

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| C1 | ID 스키마: 루트 `Brand` 사용, 8개 ID 타입, `ULID_PATTERN`, `idPattern`, `isId`, 8개 `XIdSchema`, `IdFactory`, `IdByPrefix` | — | S |
| C2 | pi re-export와 버전 고정: `pi.ts`, `package.json` 의존성 `@earendil-works/pi-ai` 1.3.0 정확 고정(pi-agent-core는 C9에서 제거), typebox catalog 참조, 설치 뒤 `bun.lock`에 pi-ai integrity가 `_research/notes/F-2.md` §1 값과 같은지 확인 | — | S |
| C3 | 런타임 스키마 래퍼: `message-schema.ts`의 `StopReasonSchema`, `UsageSchema`, 블록 4종 스키마, role별 메시지 스키마 4종, `MessageSchema`, `AgentMessageSchema`, `AssistantMessageEventSchema`. 첫 테스트로 `Value.Check`가 `Type.Unsafe` 감싼 객체를 검사하는지 확인 | C2 | M |
| C4 | `PartRecord`: `PartKind`, `PartRecord`, `PartDelta`, `PartAssignment`, 스키마 3종, `assignPartIds`, `partIdAt` | C1, C3 | M |
| C5 | 계층과 알림 유니온: `hierarchy.ts`(상태 enum, 전이표, `canTransition`, `ItemRecord`, `ToolCallItem`, `XeonCustomMessage`. 이전 판의 `CustomAgentMessages` 병합은 C9에서 제거), `lifecycle.ts`(알림 12종, payload 스키마 11종. `item.completed`는 카탈로그 kind가 아니라 기록 검증 스키마를 두지 않는다, 스펙 §3.5.3) | C1, C3, C4 | M |
| C6 | `AgentEvent` 대응 함수 시그니처: `AgentEventMapInit`, `AgentEventMapper`, `CreateAgentEventMapper` 타입만. 구현은 L1-b(`L1.loop.spec`) | C5 | S |
| C7 | 도구 결과와 재생 정책: `ResultStatus`, `InputRequiredInfo`, `ToolResultRecord`, 스키마, `resultStatusOf`, `toToolResultRecord`, `ReplayPolicy`, `ReplayPolicySchema`, `toReplayPolicy`. records(R4)와 capabilities(P2)가 이 작업에 의존한다 | C2, C3 | S |
| C8 | 인덱스와 exports: `index.ts`, `package.json` `./conversation`, pi 값 import 검사 테스트, 판별 값 목록 테스트 | C1~C7 | S |
| C9 | 에이전트 루프 타입(adr.0009): `agent.ts`에 `AgentMessage`(닫힌 유니온), `AgentEvent`(10종, `any` 없음), `AgentTool`, `AgentToolResult`, `AgentToolCall`, `AgentToolUpdateCallback`, `ToolExecutionMode`, `AgentContext`. `pi.ts`의 agent-core 재노출과 `AgentToolHooks`, `hierarchy.ts`의 `declare module` 제거, `index.ts`에 `export type * from "./agent.ts"`, `package.json`·catalog에서 pi-agent-core 제거. 소비처(`services/tools.ts`, `services/context.ts`, `capabilities/*`, `lifecycle.ts`, `tool-result.ts`, `message-schema.ts`)의 import 경로를 `agent.ts`로 바꾼다 | C8 | M |

규모 기준: S는 반나절 이내, M은 하루 안팎, L은 이틀 이상.

## 4. 채택 코드

| 대상 | 방식 | 정확 버전 | 바꿀 점 |
|---|---|---|---|
| `@earendil-works/pi-ai` | 그대로, 타입만 사용 | 1.3.0 (integrity `sha512-KaBI8x7q…3acw==`, `_research/notes/F-2.md` §1) | 없음. `ThinkingLevel`, `AssistantMessageFrame`, `Context`는 재노출하지 않음 |
| `@earendil-works/pi-agent-core` | 의존하지 않음(adr.0009) | 1.3.0 `types.ts`를 설계 참고로만 인용 | `agent.ts`가 이름과 필드를 따르고 `any`를 없앤다. 코드는 복사하지 않는다(타입 선언을 새로 쓴다) |
| `typebox` | 그대로 | catalog 1.3.27(review.decisions-2 U-24) | 없음 |
| `@modelcontextprotocol/client` | 이 도메인은 의존하지 않는다 | (2.3.1은 L2-b) | `InputRequiredInfo` 모양만 [가정]으로 따른다 |

- 포크 없음. pi 소스를 복사하지 않는다. 루프 포크는 core-loop 몫이다(`L1.loop.plan` §4).
- 설계 근거: Codex app-server의 thread/turn/item과 시작·갱신·완료 알림 모델(`_research/item-catalog.md` F절 "thread/turn/item 3계층"). 코드는 가져오지 않고 모양만 참고한다.
- 근거 판정: `_research/packages.md` §4.1 F1(메시지·스트림·도구 결과 그대로, 파트 ID 자체, 3계층 설계).

## 5. 단위 테스트 목록

모두 `bun test`로 돈다. 모델 호출이 없으므로 테이프 기반 모델 가짜는 이 층에서 쓰지 않는다.

| 테스트 | 확인할 동작 |
|---|---|
| `ids.test.ts` › 접두 | 8개 스키마가 자기 접두만 통과시키고 다른 7개 접두, 접두 없음, 대문자 접두를 거부한다 |
| `ids.test.ts` › 길이·문자 | 길이 29·31, 소문자 ULID, `I`·`L`·`O`·`U` 포함, 첫 글자 `8` 이상을 거부한다. 길이 30 정상값을 통과시킨다 |
| `ids.test.ts` › isId | `isId("thr", x)`가 스키마 결과와 같다. 문자열이 아닌 값은 `false` |
| `message-schema.test.ts` › Unsafe 검사 | `Value.Check(MessageSchema, {role:"user"})`가 `false`다(C3 전제 확인) |
| `message-schema.test.ts` › 픽스처 왕복 | `fixtures/pi-messages.ts`의 모든 픽스처를 `JSON.parse(JSON.stringify(x))` 한 뒤 `MessageSchema`를 통과한다 |
| `message-schema.test.ts` › 판별 | role을 `"assistant2"`로 바꾸면 실패한다. assistant에 `stopReason:"deferred"`는 통과, `"unknown"`은 실패한다 |
| `message-schema.test.ts` › 선택 필드 관용 | 픽스처에 미지 필드를 더해도 통과한다 |
| `pi-types.type-test.ts` | `expectTypeOf<import("@xeon/contracts/conversation").Message>().toEqualTypeOf<import("@earendil-works/pi-ai").Message>()` 형식으로 pi-ai re-export 16종 항등. pi-ai `AssistantMessageEventStream` 클래스가 F 인터페이스에 대입된다. `bun test`에서 실행되고 `tsc -b`가 타입을 판정한다 |
| `agent-types.type-test.ts` | `AgentMessage`가 `Message \| XeonCustomMessage`와 `Equal`이다. `AgentEvent["type"]`이 10종 목록과 같다. `AgentTool`·`AgentToolResult`·`AgentEvent`에 `any`가 없다(`IsAny` 검사) |
| `no-pi-agent-core.test.ts` | `src/**/*.ts`와 `package.json`에 `@earendil-works/pi-agent-core` 문자열이 0건이다(타입 import 포함) |
| `parts.test.ts` › 결정성 | 같은 입력으로 `assignPartIds`를 두 번 부를 때 두 번째 호출에 첫 결과를 `existing`으로 주면 같은 id, `issued:false`, 생성기 호출 0회 |
| `parts.test.ts` › 재생 | `partIdAt(records, itemId, i)`가 반복 호출에서 같은 값, 없는 index는 `undefined` |
| `parts.test.ts` › toolCall 보존 | toolCall 파트의 `toolCallId`가 입력 `toolCallIds[i]`와 같고 text·thinking은 `null` |
| `parts.test.ts` › 결함 입력 | 길이 불일치, kind 충돌에 예외 |
| `lifecycle.test.ts` › 전이 | 네 전이표의 모든 (from, to) 쌍에 대해 `canTransition`이 스펙 §3.5.1 표와 같다. 종결 상태에서 나가는 전이는 `false` |
| `lifecycle.test.ts` › payload 왕복 | payload 스키마 11종이 대표 픽스처 JSON 왕복 뒤 통과한다 |
| `tool-result.test.ts` | `resultStatusOf({})`는 `"complete"`. `toToolResultRecord`가 `details: undefined`를 `null`로, `terminate` 없음을 `false`로 바꾼다. 결과가 `ToolResultRecordSchema`를 통과한다 |
| `tool-result.test.ts` › replay 매핑 | `toReplayPolicy("never")`·`toReplayPolicy(undefined)` → `"unsafe"`, `toReplayPolicy("safe")` → `"safe"`. `ReplayPolicySchema`는 두 값만 통과시킨다 |
| `discriminants.test.ts` | pi 래핑 스키마의 판별 값 목록 상수(`MESSAGE_ROLES`, `CONTENT_BLOCK_TYPES`, `STOP_REASONS`, `ASSISTANT_EVENT_TYPES`)가 pi 유니온과 완전히 같다(`Exclude<Union, typeof LIST[number]>`가 `never`인지 타입 검사). 각 값이 스키마를 통과하고 목록 밖 값은 실패한다 |
| `no-pi-value-import.test.ts` | `src/**/*.ts`를 읽어 `@earendil-works/pi-` 모듈 지정자를 가진 문장이 모두 `import type` 또는 `export type`인지 확인한다 |

## 6. 완료 기준

1. `tsc -b`가 `isolatedDeclarations`를 켠 상태로 오류 0건이다.
2. `just verify`의 check-layers 단계가 통과한다. F 패키지는 어떤 `@xeon/*` 패키지도 import하지 않는다.
3. 소스의 pi-ai 값 import가 0건이고(`no-pi-value-import.test.ts`), pi-agent-core 참조가 0건이다(`no-pi-agent-core.test.ts`). oxlint `no-restricted-imports`에 `allowTypeImports` 설정이 가능하면 같은 규칙을 린트에도 건다 [가정: oxlint가 이 옵션을 지원한다].
4. 스펙 §9 수용 기준 9개가 모두 §5 테스트 하나 이상에 대응한다.

   | 수용 기준 | 테스트 |
   |---|---|
   | 1 ID 접두 | `ids.test.ts` |
   | 2 픽스처 왕복 | `message-schema.test.ts` |
   | 3 PartId 재생 | `parts.test.ts` |
   | 4 pi 값 import 0 | `no-pi-value-import.test.ts` |
   | 5 전이 | `lifecycle.test.ts` |
   | 6 판별 값 목록 | `discriminants.test.ts` |
   | 7 결과 상태 기본값 | `tool-result.test.ts` |
   | 8 re-export 항등 | `pi-types.type-test.ts` |
   | 9 replay 매핑 | `tool-result.test.ts` › replay 매핑 |
   | 11 에이전트 루프 타입 | `agent-types.type-test.ts`, `no-pi-agent-core.test.ts` |

5. oxfmt, oxlint(type-aware), knip이 통과한다.
6. `@xeon/contracts/conversation`에서 스펙 §3에 적힌 이름이 모두 export된다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| pi-ai minor마다 breaking이 있다(`_research/packages.md` §4.1) | 1.3.0 정확 고정. 소비 층은 `@xeon/contracts/conversation` 별칭 re-export만 쓴다. 버전을 올릴 때는 `pi.ts`, `message-schema.ts`, 픽스처만 고치고 `pi-types.type-test.ts`로 변경점을 드러낸다 |
| TS 인터페이스에 런타임 스키마가 없다 | `Type.Unsafe` 얕은 검증 + 픽스처 왕복 + 판별 값 목록 테스트. 깊은 필드 오류는 저장 경로에서 잡히지 않는다는 한계를 스펙 §3.3에 적었다. 깊은 검증 요구가 생기면 스펙 §10 미결 2로 다시 정한다 |
| step/turn 용어 혼선 | 스펙 §2.1 표를 기준으로 쓴다. `lifecycle.ts`의 `StepStarted`, `StepCompleted` 문서 주석에 "pi turn_start/turn_end"를 적는다. 매핑은 [결정: review.decisions-2 U-01]이고 사용자가 다르게 답하면 스펙 §2.1과 이 주석을 함께 고친다 |
| TypeBox 두 벌 설치 | 해소했다. catalog를 pi와 같은 1.3.27로 고정했다(review.decisions-2 U-24). C2에서 `bun.lock`에 사본이 하나인지 확인한다 |
| `Value.Check`가 `Unsafe` 래핑 스키마를 기대대로 검사하지 않음 | C3 첫 테스트로 확인한다. 실패하면 내부 객체 스키마를 별도 export하고 명시 타입 주석으로 선언한 뒤, `Type.Unsafe`는 정적 타입 부여에만 쓴다 |
| 명시 타입 주석이 길어진다(`ItemRecord` 유니온, 알림 payload) | `_research/notes/eng-2.md` §3-4 형식을 따른다. 주석과 값이 어긋나면 TS2322로 드러나므로 별도 키 집합 테스트를 두지 않는다 |
| 이전 판의 `CustomAgentMessages` 선언 병합에 기대던 코드가 남는다 | C9에서 병합을 지우면 `AgentMessage`가 닫힌 유니온이 되어 남은 사용처는 `tsc -b`에서 드러난다. `agent-types.type-test.ts`가 유니온 모양을 고정한다 |
