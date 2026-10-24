# pi API 확인 자료 1: ai, agent, coding-agent, codemode, mcp, durable

- 작성: 2026-10-11, 0단계 에이전트 S3a(pi API 확인 1)
- 기준 소스: `~/projects/_ref/pi-src` 커밋 `cdaf6c2` (읽기 전용). 아래 경로는 따로 적지 않으면 `packages/` 아래 상대 경로다. 예: `agent/src/agent-loop.ts:245`는 `~/projects/_ref/pi-src/packages/agent/src/agent-loop.ts` 245행.
- 표기
  - [원문]: 소스·문서를 직접 읽어 확인함
  - [실험]: 코드를 실행해 확인함. 실험 코드와 출력은 `.helm-design-work/S3a/exp-a1-agent-core.mjs`, `exp-a2-tools-codemode.mjs`, `exp-a1.out.txt`, `exp-a2.out.txt`
  - [확인 불가]: 소스로 판정할 수 없음(npm 배포 이력, 외부 사례 등)
  - [후보]: 포크 판단 후보. 결정은 P4(07 문서)가 한다.
- 실험 환경: `experiments/pi-lab/node_modules`에 설치된 npm `@earendil-works/*` 1.1.0, Node 24.19.0, faux provider(API 키 없음). npm 1.1.0과 소스 `cdaf6c2` 사이에는 각 CHANGELOG의 `[Unreleased]` 항목만큼 차이가 있다(agent는 Unreleased 항목 없음, durable은 Breaking 5개). 실험 결과를 소스와 함께 적을 때는 이 차이를 고려했다.
- 짝 문서: `pi-api-facts-2.md`(tui, protocol, server, client, chord, env, evals, telemetry, 라이선스 전체, pi-lab 실험 재실행). 이 문서의 대조표(8장)에서 그 범위에 속하는 주장은 "범위 밖"으로 표시했다.

## 0. 설계에 영향이 큰 사실

1. **`beforeToolCall`의 `args`는 원본의 복사본이고, 그 객체가 그대로 `execute()`로 간다.** `validateToolArguments()`는 `structuredClone(toolCall.arguments)`를 검증·변환해 돌려주고(ai/src/utils/validation.ts:317-349), 루프는 이 값을 `beforeToolCall` 컨텍스트의 `args`와 `execute()` 인자로 함께 쓴다(agent/src/agent-loop.ts:726-769, 832-834). 훅에서 `args`를 고치면 실행에 반영되고 transcript의 `toolCall.arguments`는 원래 값으로 남는다 [원문][실험 A1]. agent-core 문서에는 이 동작이 계약으로 적혀 있지 않지만, coding-agent는 같은 동작을 `tool_call` 이벤트의 공식 계약("To modify arguments, mutate `event.input` in place")으로 쓴다(coding-agent/src/core/extensions/types.ts:1426-1428, coding-agent/src/core/agent-session.ts:658-681).
2. **루프는 `stopReason`이 `"toolUse"`가 아니어도 `toolCall` 블록을 실행한다.** 분기 조건은 `error`/`aborted`(즉시 종료), `length`(모든 호출을 실행하지 않고 오류 결과)뿐이다(agent/src/agent-loop.ts:245-272) [원문][실험 A1: 기본값 `stop`인 faux 응답의 도구가 실행됨].
3. **`prepareRequest`가 돌려준 `context.messages` 배열은 루프가 이후 직접 변경한다.** 루프는 교체된 `currentContext.messages`에 assistant 메시지와 도구 결과를 `push`한다(agent/src/agent-loop.ts:227-239, 418, 434, 274-277). `Agent.state.messages`는 이벤트로만 갱신되므로(agent/src/agent.ts:575-578) 교체 후에는 두 목록이 서로 다른 내용을 가진다 [원문][실험 A1 6번]. Helm이 로그에서 투영을 만들어 넘길 때는 요청마다 새 배열을 넘겨야 한다.
4. **도구 결과 메시지에는 `structuredContent`가 들어가지 않는다.** `createToolResultMessage()`는 `content`, `details`, `usage`, `isError`, `durationMs`만 옮긴다(agent/src/agent-loop.ts:930-944) [원문][실험 A1 1번]. 구조화 결과는 `afterToolCall` 컨텍스트의 `result.structuredContent`와 `runToolCall()` 반환값에서만 얻는다.
5. **coding-agent 내장 도구는 경로를 제한하지 않는다.** `resolveToCwd()`는 절대 경로와 `~`를 그대로 받는다(coding-agent/src/utils/paths.ts:76-107, coding-agent/src/core/tools/path-utils.ts:48-50) [실험 A2: `read`로 `/etc/hostname`을 읽음]. `bash`는 `cwd`만 정하고 명령 내용은 검사하지 않는다. pi에는 권한 시스템이 없다(pi-src `README.md:88-96`, coding-agent/docs/security.md:3). 범위 검사는 Helm이 훅에서 해야 한다.
6. **coding-agent 도구 파일은 TUI 렌더러를 import한다.** 각 `core/tools/*.ts`는 `./renderers/*.ts`를 가져오고, 렌더러는 `@earendil-works/pi-tui`와 `modes/interactive` 테마·컴포넌트를 가져온다(예: coding-agent/src/core/tools/bash.ts:18, coding-agent/src/core/tools/renderers/find.ts:9-11). 패키지에는 도구만 내보내는 하위 경로 export가 없다(coding-agent/package.json `exports`). 루트 import 한 번에 pi-tui, pi-codemode, pi-mcp, highlight.js, undici 등 33개 패키지가 로드된다 [실험 A2].
7. **grep/find는 `rg`/`fd`가 없으면 실행 중에 내려받는다.** `ensureTool()`(coding-agent/src/utils/tools-manager.ts:349-380), `PI_OFFLINE=1`이면 내려받지 않고 실패한다. `GrepOperations`를 바꿔도 `rg` 프로세스는 로컬에서 실행된다(coding-agent/src/core/tools/grep.ts:119-168) [원문].
8. **pi-durable의 도구 실행은 "의도 커밋 → 실행 → 결과 커밋"이다.** `call` 단계에서 `beforeTool` 뒤 최종 인자와 replay 정책을 담아 `execute` 단계로 커밋하고, 같은 핸들러가 실행·`afterTool`·결과 커밋을 한다. 재시작으로 `execute` 단계에서 다시 열리면, 저장된 정책과 현재 정책이 모두 `safe`일 때만 저장된 인자로 다시 실행하고 그 외에는 `interrupted` 오류 결과를 커밋한다(durable/docs/spec.md:3895-3911, durable/src/harness/tool.ts:182-195) [원문].
9. **pi-durable SQLite 백엔드는 Node 내장 `node:sqlite`(`DatabaseSync`)를 쓴다.** `journal_mode=WAL`, `synchronous=NORMAL`(durable/src/storage/sqlite/node.ts:3-4, 187-192). 브리프 결정 36의 `better-sqlite3`와 다르다. pi-durable은 참고용이므로(결정 29) 영향은 설계 참고 범위에 그친다.
10. **coding-agent 세션 파일은 첫 user/assistant 메시지 전에는 만들어지지 않는다.** 그 뒤 엔트리마다 `appendFileSync`, fsync·파일 락 없음(coding-agent/src/core/session-manager.ts:1166-1196) [원문].
11. **codemode 스크립트는 실행마다 새 worker 스레드와 새 QuickJS VM에서 돈다.** JS 변수는 한 번의 실행에서만 산다. `store`/`load` 값은 호출자가 `options.store`로 넘기고 `result.storeWrites`로 돌려받는다(codemode/src/runtime/host.ts:12-18, codemode/src/types.ts:82-98, 140-149) [실험 A2]. coding-agent는 이 쓰기를 세션의 `codemode-store` custom 엔트리로 남긴다(coding-agent/src/extensions/codemode/tool.ts:18-21, 53-58). 스크립트에서 채팅 모델은 실행할 수 없고 분류기·이미지 모델만 쓸 수 있다(coding-agent/docs/codemode.md:62).
12. **MCP 클라이언트는 `structuredContent`를 `outputSchema`로 검증하지 않는다.** 객체인지만 본다(mcp/src/client.ts:142-151). agent-core와 coding-agent도 출력 스키마 검증을 하지 않는다(`outputSchema`는 선언·렌더링용, agent/src/types.ts:474-478). 검증은 pi-durable의 `structuredOutputSchema`에만 있다(durable/README.md:182-198).
13. **`AgentTool.replay`는 타입에만 있다.** agent-core 소스에서 이 필드를 읽는 곳은 없다(agent/src/types.ts:489-490, grep 결과 이 한 곳) [원문].

## 1. 공통: 패키지 개요, 라이선스, 내부 의존

### 1.1 패키지 표

LOC는 `src/**/*.ts` 줄 수(`wc -l`, 주석·빈 줄 포함) [원문].

| 패키지(디렉터리) | npm 이름 | 버전 | LOC | engines | 런타임 의존(pi 내부) | 런타임 의존(외부) | author |
|---|---|---|---|---|---|---|---|
| `ai` | `@earendil-works/pi-ai` | 1.1.0 | 27,242 | node >=22.19.0 | pi-telemetry(타입만) | `@anthropic-ai/sdk` 0.129.0, `@aws-sdk/client-bedrock-runtime`, `@google/genai`, `openai` 7.19.0, `partial-json`, `typebox` 1.3.27, `http(s)-proxy-agent`, `@smithy/node-http-handler` | Mario Zechner |
| `agent` | `@earendil-works/pi-agent-core` | 1.1.0 | 2,519 | node >=22.19.0 | pi-ai | `typebox` 1.3.27 | Mario Zechner |
| `coding-agent` | `@earendil-works/pi-coding-agent` | 1.1.0 | 86,152 (experimental 제외 75,698) | node >=22.19.0 | chord, pi-agent-core, pi-ai, pi-codemode, pi-mcp, pi-tui | photon-node, cross-spawn, diff, highlight.js, jiti, minimatch, proper-lockfile, quickjs-wasi, undici, yaml 등 17개 | Mario Zechner |
| `codemode` | `@earendil-works/pi-codemode` | 1.1.0 | 2,597 | node >=22.19.0 | 없음 | `quickjs-wasi` 3.6.2 | Earendil Works |
| `mcp` | `@earendil-works/pi-mcp` | 1.1.0 | 3,244 | node >=22.19.0 | 없음 | `cross-spawn` 7.0.6 | Earendil Works |
| `durable` | `@earendil-works/pi-durable` | 1.1.0 | 22,842 | node >=22.19.0 | chord, pi-ai | `@silvia-odwyer/photon` 0.3.3, `diff`, `typebox` | Earendil Works |

모노레포 14개 패키지가 모두 1.1.0이다(`evals`만 `"private": true`) [원문 각 package.json].

exports [원문 package.json]:

| 패키지 | 하위 경로 |
|---|---|
| pi-ai | `.`, `./models`, `./compat`, `./providers/*`, `./api/*`, `./utils/*`, `./oauth`, `./bedrock-provider`, `./bun-oauth`. bin `pi-ai` |
| pi-agent-core | `.`, `./package.json` |
| pi-coding-agent | `.`, `./rpc-entry`, `./client`(source만), `./experimental/plugin`(source만). bin `pi`. `files`에서 `dist/client`, `dist/experimental`, `dist/cli/experimental` 제외 |
| pi-codemode | `.`, `./declarations`, `./source`, `./portable`, `./cloudflare`, `./worker` |
| pi-mcp | `.`, `./oauth`, `./testing`. `sideEffects: false` |
| pi-durable | `.`, `./env`, `./env/node`, `./tools`, `./images`, `./images/node`, `./images/cloudflare`, `./storage/memory`, `./storage/jsonl`, `./storage/jsonl/node`, `./storage/sqlite`, `./storage/sqlite/cloudflare`, `./storage/sqlite/node`, `./testing`. `sideEffects: false` |

pi-ai 루트 엔트리는 부작용이 없고 생성 카탈로그·provider 팩토리·OAuth 구현을 포함하지 않는다(ai/src/index.ts:4-8). provider는 `providers/<id>`, 전체는 `providers/all`, 옛 전역 API는 `compat`에서 가져온다.

### 1.2 라이선스

- 저장소 루트 `LICENSE`: MIT, "Copyright (c) 2025 Mario Zechner" [원문].
- 여섯 패키지 디렉터리에는 자체 `LICENSE` 파일이 없고 package.json `license: "MIT"`만 있다. ai·agent의 `files`에는 LICENSE가 없다 [원문].
- `mcp/LICENSES/modelcontextprotocol-typescript-sdk.txt`: MIT, "Copyright (c) 2024 Anthropic, PBC". pi-mcp `files`에 `LICENSES`가 포함된다. MCP TypeScript SDK에서 가져온 부분의 고지로 보인다 [원문]. 어느 파일이 해당하는지는 소스에 표시가 없어 [확인 불가].
- 포크 시 고지: 루트 MIT 고지(저작권자 Mario Zechner)를 가져온 파일 묶음에 넣고, pi-mcp를 가져오면 Anthropic MIT 고지도 함께 넣는다 [후보]. 라이선스 전체 정리는 `pi-api-facts-2.md` 담당.

### 1.3 내부 의존 그래프

package.json 의존과 실제 import를 함께 확인했다 [원문 grep `from "@earendil-works/...`].

```text
pi-telemetry ──(type only: ai/src/types.ts:1)──▶ pi-ai
pi-ai ──▶ pi-agent-core
pi-ai, pi-agent-core, pi-tui, pi-codemode, pi-mcp ──▶ pi-coding-agent (npm 배포 범위)
chord ──▶ pi-coding-agent (package.json 의존이지만 import는 src/experimental/* 에만 있음)
pi-durable, pi-server, pi-client, pi-protocol ──▶ pi-coding-agent/src/experimental, src/client (npm 제외 범위. pi-durable은 package.json 의존에도 없음, 나머지 셋은 devDependencies)
pi-ai, chord ──▶ pi-durable   (pi-agent-core를 import하지 않음)
pi-codemode, pi-mcp: pi 패키지 의존 없음
```

- coding-agent의 `@earendil-works/chord` import 위치: `src/experimental/` 아래 파일뿐이다(client-runtime.ts, server.ts, services/*, durable/* 등 26개 파일) [원문].
- durable의 pi 의존 import 수: chord 63곳, pi-ai 20곳. pi-agent-core 0곳 [원문].

### 1.4 변경 이력 규모

CHANGELOG의 `### Breaking Changes` 절 수 [원문]:

| 패키지 | Breaking 절 | 비고 |
|---|---|---|
| pi-ai | 27 | `[Unreleased]`에는 없음 |
| pi-agent-core | 13 | 1.0.0에서 하네스 제거(agent/CHANGELOG.md:21-25) |
| pi-coding-agent | 50 | `[Unreleased]` 1개 포함. 릴리스된 것만 49 |
| pi-durable | 4 | `[Unreleased]`(5개 항목) 포함. CHANGELOG는 1.0.0부터만 있음 |
| pi-codemode | 0 | |
| pi-mcp | 1 | |

agent CHANGELOG에서 1.1.0부터 0.74.0까지의 버전 헤더는 59개다(두 끝 포함). npm 배포 수(58)는 npm 기록이라 소스로는 [확인 불가]. 저장소 git 이력은 2026-10-06부터만 있는 얕은 클론이다 [원문 `git log`].

## 2. pi-ai (`@earendil-works/pi-ai`)

### 2.1 구조

| 디렉터리 | LOC | 내용 |
|---|---|---|
| `src/api/` | 13,186 | 와이어 프로토콜 구현(API) 10종 + 분류기·이미지 API. 각 모듈은 `stream`, `streamSimple`(선택적으로 `fetchDeferred`, `cancelDeferred`)을 export, `*.lazy.ts`는 지연 로딩 래퍼 |
| `src/providers/` | 3,676 (+ `data/` JSON 카탈로그) | provider 팩토리 42개, `*.models.ts` 카탈로그, `faux.ts`, `all.ts`, `model-schema.ts`, `compat-schema.ts` |
| `src/auth/` | 3,832 | `CredentialStore`, auth 해석, OAuth 구현(anthropic, github-copilot, openai-codex, xai 등) |
| `src/utils/` | 2,940 | 이벤트 스트림, 검증, transcript 도우미, frame 인코더, retry, overflow 판정 |
| 최상위 파일 | 3,563 | `types.ts`(893), `models.ts`(1,263), `compat.ts`, `env-api-keys.ts`, `cli.ts` 등 |

### 2.2 메시지·콘텐츠 블록 타입

```ts
// ai/src/types.ts:414-444
export interface TextContent { type: "text"; text: string; textSignature?: string; }
export interface ThinkingContent { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean; }
export interface ImageContent { type: "image"; data: string /* base64 */; mimeType: string; }
export interface ToolCall {
  type: "toolCall"; id: string; name: string; arguments: JsonObject;
  thoughtSignature?: string; // Google
  namespace?: string;        // OpenAI Responses
}

// ai/src/types.ts:541-563
export interface SystemMessage {
  role: "system";
  content: string | TextContent[];          // 선두: 기본 프롬프트, 이후: 추가 지시
  sections?: Record<string, string | null>; // 이름 붙은 절. 이후 메시지가 이름으로 교체, null은 삭제
  toolsAdded?: Tool[];
  toolsRemoved?: ToolReference[];
  timestamp: number;
}
export interface UserMessage { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number; }

// ai/src/types.ts:565-596
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api; provider: ProviderId; model: string;
  responseModel?: string; responseId?: string;
  providerThinkingLevel?: string;
  thinkingLevel?: ModelThinkingLevel; // 루프가 요청한 수준(agent-loop.ts:409)
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage; stopReason: StopReason; deferred?: DeferredHandle;
  errorMessage?: string; rawStopReason?: string; endTurn?: boolean;
  timestamp: number; durationMs?: number;
}

// ai/src/types.ts:620-639
export type ToolResultMessage<TDetails = JsonValue> = /* TDetails가 JSON 호환일 때 */ {
  role: "toolResult"; toolCallId: string; toolName: string;
  content: (TextContent | ImageContent)[];
  details?: JsonRepresentation<TDetails>;
  usage?: Usage;
  nestedCalls?: NestedToolCalls; // 다른 도구가 부른 호출 기록. 모델에는 보내지 않음
  isError: boolean; timestamp: number; durationMs?: number;
};
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

// ai/src/types.ts:469
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
```

- `ToolResultMessage`는 `TDetails`가 JSON으로 표현되지 않으면 `never`가 되는 조건부 타입이다(ai/src/types.ts:474-517, 620) [원문].
- `Context`(`systemPrompt?`, `messages`, `tools?`)는 공개 입력이고, provider 아래로는 `normalizeContext()`만 만들 수 있는 브랜드 타입 `TranscriptContext`(`messages`만 있음)가 간다(ai/src/types.ts:766-783, ai/src/utils/transcript.ts:30-34).

### 2.3 Model / Provider / Models

```ts
// ai/src/types.ts:61-73, 87-130
export type KnownApi = "openai-completions" | "mistral-conversations" | "openai-responses" | "azure-openai-responses"
  | "openai-codex-responses" | "anthropic-messages" | "bedrock-converse-stream" | "google-generative-ai"
  | "google-vertex" | "pi-messages";
export type Api = KnownApi | (string & {});
export type ProviderId = KnownProvider | string; // KnownProvider: 42개 문자열 리터럴

// ai/src/types.ts:820-867
export interface BaseModel<TApi extends string> {
  id: string; name: string; api: TApi; provider: ProviderId; baseUrl: string;
  input: ModelInputModality[]; inputLimits?: ModelInputLimits; cost: ModelCost; headers?: Record<string, string>;
}
export interface Model<TApi extends Api> extends BaseModel<TApi> {
  type?: "chat"; reasoning: boolean; thinkingLevelMap?: ThinkingLevelMap; promptCache?: ModelPromptCache;
  contextWindow: number; maxTokens: number;
  samplingParams?: SamplingParams; samplingParamsByThinkingLevel?: SamplingParamsByThinkingLevel;
  compat?: /* API별 호환 설정 */;
}
// ImageModel(type:"image"), ClassifierModel(type:"classifier")도 있다(ai/src/types.ts:870-893)

// ai/src/models.ts:150-242 (요약)
export interface Provider<TApi extends Api = Api> {
  readonly id: string; readonly name: string; readonly baseUrl?: string; readonly headers?: ProviderHeaders;
  readonly auth: ProviderAuth;                         // apiKey 또는 oauth 중 하나 이상 필수
  getModels(): readonly Model<TApi>[];                 // 동기. throw 금지
  getAllModels?(): readonly ProviderModel<TApi>[];
  refreshModels?(context: RefreshModelsContext): Promise<void>;   // 동적 provider
  filterModels?(models, credential): readonly Model<TApi>[];
  filterAllModels?(models, credential): readonly ProviderModel<TApi>[];
  stream<T extends TApi>(model: Model<T>, context: TranscriptContext, options?: ApiStreamOptions<T>): AssistantMessageEventStream;
  streamSimple(model: Model<TApi>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream;
  fetchDeferred?(...): AssistantMessageEventStream; cancelDeferred?(...): Promise<void>;
  generateImages?(...): Promise<AssistantImages>; classify?(...): Promise<ClassifierResult>;
}

// ai/src/models.ts:250-366 (요약)
export interface Models {
  getProviders(): readonly Provider[]; getProvider(id: string): Provider | undefined;
  getModels(provider?: string): readonly Model<Api>[];
  getModel(provider: string, id: string): Model<Api> | undefined;
  getModelsOfType<T extends ModelType>(type: T, provider?: string): readonly ModelTypeMap[T][];
  getModelOfType<T extends ModelType>(type: T, provider: string, id: string): ModelTypeMap[T] | undefined;
  getAllModels(provider?: string): readonly AnyModel[];
  refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
  checkAuth(providerId: string, options?): Promise<AuthCheck | undefined>;
  getAvailable(providerId?: string, options?): Promise<readonly Model<Api>[]>;
  getAvailableOfType(...); getAllAvailable(...);
  getAuth(providerId: string | AnyModel, overrides?): Promise<AuthResult | undefined>;
  login(providerId: string, type: AuthType, interaction: AuthInteraction, options?: LoginOptions): Promise<Credential>;
  logout(providerId: string, options?): Promise<void>;
  stream<TApi extends Api>(model: Model<TApi>, context: Context, options?: ModelsApiStreamOptions<TApi>): AssistantMessageEventStream;
  complete<TApi extends Api>(model: Model<TApi>, context: Context, options?): Promise<AssistantMessage>;
  streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): AssistantMessageEventStream;
  completeSimple(model: Model<Api>, context: Context, options?): Promise<AssistantMessage>;
  streamDeferred(...); fetchDeferred(...); cancelDeferred(...);
  generateImages(...): Promise<AssistantImages>;  // never rejects
  classify(...): Promise<ClassifierResult>;       // never rejects
}
export interface MutableModels extends Models { setProvider(p: Provider): void; deleteProvider(id: string): void; clearProviders(): void; }
export interface CreateModelsOptions { credentials?: CredentialStore; modelsStore?: ModelsStore; authContext?: AuthContext; }
export function createModels(options?: CreateModelsOptions): MutableModels;            // ai/src/models.ts:992
export function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi>; // :1041
// CreateProviderOptions: { id, name?, baseUrl?, headers?, auth, models, fetchModels?, filterModels?, filterAllModels?,
//   api?: ProviderStreams | Partial<Record<TApi, ProviderStreams>>, images?, classifiers? }   (:996-1031)
```

- `Models.stream()`/`streamSimple()`는 `normalizeContext()` 후 `lazyStream()`으로 auth를 해석하고 provider에 넘긴다. auth 실패는 throw하지 않고 스트림 오류로 나간다(ai/src/models.ts:877-907, ai/README.md:1102-1126) [원문].
- 기본 `CredentialStore`는 `InMemoryCredentialStore`(ai/src/models.ts:400) [원문].
- 모델 객체는 함수가 없는 직렬화 가능한 데이터다(ai/README.md:1603-1636) [원문].

### 2.4 provider 레지스트리와 지원 목록

- `builtinProviders()`는 42개 provider 팩토리를 새로 만들어 돌려주고, `builtinModels(options)`는 `createModels()`에 모두 등록한다(ai/src/providers/all.ts:136-189) [원문].
- 42개: amazon-bedrock, ant-ling, anthropic, azure, baseten, cerebras, cloudflare-ai-gateway, cloudflare-workers-ai, deepseek, fireworks, github-copilot, google, google-vertex, groq, huggingface, kimi-coding, meta, minimax, minimax-cn, mistral, moonshotai, moonshotai-cn, nvidia, openai, openai-codex, opencode, opencode-go, openrouter, qwen-token-plan, qwen-token-plan-cn, qwen-token-plan-individual, radius, together, typesafe, vercel-ai-gateway, xai, xiaomi, xiaomi-token-plan-ams, xiaomi-token-plan-cn, xiaomi-token-plan-sgp, zai, zai-coding-cn (ai/src/providers/all.ts:138-179). README "Supported Providers" 목록은 지역별 provider를 한 줄로 묶어 35줄이다(ai/README.md:61-97).
- 정적 카탈로그 읽기: `getBuiltinModel(provider, id)`, `getBuiltinModels()`, `getBuiltinProviders()`(ai/src/providers/all.ts:62-133). 옛 `getModel`은 `compat`에서 `getBuiltinModel`의 별칭이다(ai/src/compat.ts:65).
- 여러 provider가 하나의 API 구현을 공유한다. 예: xAI, Groq, Cerebras, OpenRouter 대부분은 `openai-completions`(ai/README.md:241).

### 2.5 stream / complete 계열과 이벤트

```ts
// ai/src/types.ts:801-817
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start" | "thinking_start" | "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta" | "thinking_delta" | "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end" | "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse" | "deferred"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// ai/src/utils/event-stream.ts:26-95, 97-131
export class EventStream<T, R = T> implements AsyncIterable<T> { push(e: T): void; end(result?: R): void; result(): Promise<R>; }
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {} // 최종 메시지에 durationMs 기록
export function createAssistantMessageEventStream(): AssistantMessageEventStream;

// ai/src/types.ts:212-262, 369-377 (주요 필드)
export interface StreamOptions extends ProviderRequestOptions {
  signal?: AbortSignal; apiKey?: string; fetch?: FetchFunction; env?: ProviderEnv;
  onPayload?; onResponse?; onProviderStreamEvent?; headers?; timeoutMs?; maxRetries?; maxRetryDelayMs?;
  temperature?: number; samplingParams?: Record<string, unknown>; maxTokens?: number;
  transport?: "sse" | "websocket" | "websocket-cached" | "auto";
  cacheRetention?: "none" | "short" | "long"; sessionId?: string; metadata?: Record<string, unknown>;
}
export interface SimpleStreamOptions extends StreamOptions {
  toolChoice?: "auto" | "none"; reasoning?: ThinkingLevel; deferred?: boolean | { window?: "15m" | "1h" | "24h" };
  thinkingBudgets?: ThinkingBudgets;
}
```

- 서로 다른 블록의 이벤트는 섞여 올 수 있고 `contentIndex`로 구분한다. `partial`은 진행 중 갱신되는 공유 객체라 시점 스냅숏으로 저장하면 안 된다(ai/types.ts:794-800, ai/README.md:705, 724) [원문].
- `complete*()`는 `stream*().result()`다(ai/src/models.ts:893-916) [원문].
- 스트림 계약: 스트림을 돌려준 뒤의 요청 실패는 throw하지 않고 `stopReason: "error" | "aborted"`와 `errorMessage`를 가진 최종 메시지로 끝난다. 직접 API 모듈의 `streamSimple()`은 인증이 없으면 동기 throw할 수 있다(ai/src/types.ts:379-394) [원문].

### 2.6 도구 정의와 검증

```ts
// ai/src/types.ts:739-758
export type ConstrainedSamplingConfig =
  | { type: "json_schema"; strict: "prefer" | "require" }
  | { type: "grammar"; variants: Partial<Record<"openai_lark" | "openai_regex", string>> };
export interface Tool<TParameters extends TSchema = TSchema> {
  name: string; description: string; parameters: TParameters; constrainedSampling?: false | ConstrainedSamplingConfig;
}
export interface ToolReference { name: string; }

// ai/src/utils/validation.ts:302, 317
export function validateToolCall(tools: Tool[], toolCall: ToolCall): any;      // 이름으로 찾은 뒤 아래 호출
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any;    // structuredClone → null 정규화 → Value.Convert → (TypeBox 아닌 JSON Schema면) 강제 변환 → Check. 실패 시 Error throw
export { Type, type Static, type TSchema } from "typebox";                     // ai/src/index.ts:1-2
export function StringEnum<T extends readonly string[]>(...);                  // ai/src/utils/typebox-helpers.ts:14
```

- 스키마는 TypeBox(1.3.27)다. TypeBox 스키마가 아닌 평범한 JSON Schema에는 원시 타입 강제 변환(문자열 "1" → 숫자 등)을 추가로 한다(ai/src/utils/validation.ts:59-120, 320-334) [원문].
- 검증 결과는 원본 인자의 복사본이다(0장 1번).

### 2.7 사용량과 비용

```ts
// ai/src/types.ts:446-467
export interface Usage {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  cacheWrite1h?: number;   // Anthropic만
  reasoning?: number;      // output의 부분집합
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}
// ai/src/models.ts:1200-1222
export function calculateCost(model: AnyModel, usage: Usage): Usage["cost"]; // 백만 토큰당 USD. 입력 토큰 기준 tier 선택, 1h 캐시 쓰기는 입력 단가 x2
```

모델 단가는 `ModelCost { input, output, cacheRead, cacheWrite, tiers? }`(USD/백만 토큰, ai/src/providers/model-schema.ts:25-46) [원문].

### 2.8 thinking / reasoning

- 수준: `ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`, `ThinkingLevel`은 `off` 제외(ai/src/providers/model-schema.ts:3-4) [원문].
- 모델별 `thinkingLevelMap`에서 `null`은 미지원, `xhigh`·`max`는 값이 있을 때만 지원(ai/src/models.ts:1224-1233). `clampThinkingLevel()`은 요청 수준이 없으면 위쪽, 그다음 아래쪽에서 가장 가까운 지원 수준을 고른다(:1235-1257) [원문].
- 토큰 예산형 provider 기본 예산: minimal 1024, low 2048, medium 8192, high 16384(ai/src/api/simple-options.ts:70-75) [원문].
- 추론 미지원 모델에 `reasoning`을 주면 무시된다(ai/README.md:995) [원문].

### 2.9 abort와 오류

- `signal`을 주면 중단된 응답은 `stopReason: "aborted"`, 부분 content와 usage를 가진다(ai/README.md:1128-1160) [원문].
- 재시도 도우미: `retryAssistantCall(produce, policy, signal, callbacks)`, `RetryPolicy { enabled, maxRetries, baseDelayMs, maxAgentDelayMs? }`, `isRetryableAssistantError()`(ai/src/utils/retry.ts:116-262). 루프(agent-core)는 이것을 자동으로 쓰지 않는다. coding-agent 컴팩션 요약이 사용한다(coding-agent/src/core/compaction/compaction.ts:619-640) [원문].
- 컨텍스트 초과 판정: `isContextOverflow(message, contextWindow?)`(ai/src/utils/overflow.ts:137) [원문].

### 2.10 faux provider

```ts
// ai/src/providers/faux.ts
export function fauxText(text: string): TextContent;                                         // :54
export function fauxThinking(thinking: string): ThinkingContent;                             // :58
export function fauxToolCall(name: string, args: ToolCall["arguments"], options?: { id?: string }): ToolCall; // :62
export function fauxAssistantMessage(content: string | FauxContentBlock | FauxContentBlock[],
  options?: { stopReason?: StopReason; deferred?: DeferredHandle; errorMessage?: string; responseId?: string; timestamp?: number }): AssistantMessage; // :78, 기본 stopReason "stop"
export type FauxResponseFactory = (context: TranscriptContext, options: SimpleStreamOptions | undefined,
  state: FauxProviderState, model: Model<string>) => AssistantMessage | Promise<AssistantMessage>; // :109
export interface RegisterFauxProviderOptions { api?: string; provider?: string; models?: FauxModelDefinition[];
  deferred?: { pendingFetches?: number; pollAfterMs?: number }; tokensPerSecond?: number; tokenSize?: { min?: number; max?: number } } // :118
export interface FauxProviderHandle { provider: Provider; api: string; models: [Model<string>, ...Model<string>[]];
  getModel(): Model<string>; getModel(id: string): Model<string> | undefined; state: FauxProviderState;
  setResponses(r: FauxResponseStep[]): void; appendResponses(r: FauxResponseStep[]): void; getPendingResponseCount(): number; } // :146
export function fauxProvider(options?: RegisterFauxProviderOptions): FauxProviderHandle;     // :704
```

- 응답 큐가 비면 `errorMessage: "No more faux responses queued"`인 오류 메시지를 낸다(ai/src/providers/faux.ts:532) [원문].
- 사용량은 글자 수/4로 추정하고, `sessionId`가 있고 `cacheRetention !== "none"`이면 캐시 읽기·쓰기를 흉내 낸다. cost는 항상 0(ai/src/providers/faux.ts:245-286) [원문].
- `api` 기본값은 `faux:<시각>:<난수>` 형식의 임의 문자열이다(ai/src/providers/faux.ts:455, 162-164) [원문]. 같은 provider/api/model인지로 thinking 보존을 판정하는 handoff 로직(2.11)을 시험할 때 고려한다.
- 도구 호출 실행에 `stopReason: "toolUse"`는 필요 없다(0장 2번) [실험 A1].

### 2.11 provider 사이 이어가기(handoff)

`transformMessages(messages, model, normalizeToolCallId?)`(ai/src/api/transform-messages.ts:64-235) [원문]:

1. 모델이 이미지를 받지 못하면 user·toolResult의 이미지를 자리표시 텍스트로 바꾼다(`(image omitted: model does not support images)`, :12-57). README의 "silently ignored"(ai/README.md:756)와 달리 텍스트가 남는다.
2. assistant 메시지가 같은 provider·api·model이 아니면: redacted thinking은 버리고, 일반 thinking은 태그 없는 text 블록으로 바꾸고, 빈 thinking은 버린다(:95-117). README는 `<thinking>` 태그로 감싼다고 적었지만(ai/README.md:1536) 코드에는 태그가 없다.
3. tool call ID를 대상 provider 규칙에 맞게 정규화하고 결과 메시지의 ID도 맞춘다(:60-63, 82-89).
4. `stopReason`이 `error`/`aborted`인 assistant 메시지는 통째로 뺀다(:191-200). README의 "aborted messages with partial content" 처리 문장(ai/README.md:1568)과 실제 동작은 "빼서 보내지 않음"이다.
5. 결과가 없는 tool call에는 `isError: true`, 텍스트 `"No result provided"`인 합성 결과를 넣는다(:155-180). 그 사이의 system 메시지는 결과 뒤로 미룬다.

### 2.12 시스템 메시지와 transcript 도우미

- 선두 system 메시지가 프롬프트이고, 이후 system 메시지가 `content` 추가, `sections` 교체·삭제, `toolsAdded`/`toolsRemoved`로 바꾼다. 재생 결과가 현재 프롬프트와 도구다(ai/src/types.ts:531-557) [원문].
- 중간 system 메시지를 지원하는 모델(`supportsMidConvoSystemMessages`)에는 제자리로 보내고, 나머지는 `collapseSystemMessages()`로 선두 하나로 합친다(ai/README.md:1601) [원문].
- 도우미(ai/src/utils/transcript.ts): `createInitialSystemMessage`(:10), `normalizeContext`(:30), `getCurrentTools`(:58), `getCurrentSystemMessage`(:73), `getCurrentSystemPrompt`(:99), `collapseSystemMessages`(:108), `toToolDeclaration`(:123), `getToolStateChanges`(:150), `resolveTranscriptTools`(:229) [원문].

### 2.13 인증과 API 키

```ts
// ai/src/auth/types.ts:17-37, 65-94, 170-199, 221-255
export interface ApiKeyCredential { type: "api_key"; key?: string; env?: ProviderEnv; }
export interface OAuthCredential { type: "oauth"; refresh: string; access: string; expires: number; [k: string]: unknown; }
export type Credential = ApiKeyCredential | OAuthCredential;
export interface CredentialStore {
  read(providerId: string, options?): Promise<Credential | undefined>;
  list(options?): Promise<readonly CredentialInfo[]>;       // 비밀 해석 금지
  modify(providerId: string, fn: (cur: Credential | undefined) => Promise<Credential | undefined>, options?): Promise<Credential | undefined>; // 유일한 쓰기 경로
  delete(providerId: string, options?): Promise<void>;
}
export interface ApiKeyAuth { name: string; login?(...): Promise<ApiKeyCredential>; check?(...); resolve(input: { ctx: AuthContext; credential?: ApiKeyCredential; signal: AbortSignal }): Promise<AuthResult | undefined>; }
export interface OAuthAuth { name: string; isSubscription?: boolean; loginLabel?: string; login(...): Promise<OAuthCredential>; refresh(c: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential>; toAuth(c: OAuthCredential): Promise<ModelAuth>; }
export interface ProviderAuth { apiKey?: ApiKeyAuth; oauth?: OAuthAuth; }
```

- 해석 순서: 저장된 credential이 있으면 그것이 provider를 소유하고 환경 변수는 저장된 것이 없을 때만 본다. OAuth 갱신은 `modify` 안에서 직렬화된다. 갱신 실패가 환경 변수 키로 넘어가지 않는다(ai/README.md:428-440) [원문].
- 헤더 병합 순서: provider auth 헤더 → `model.headers` → `options.headers` → `transformHeaders`(Models 전용) → `Provider.stream*()`(ai/README.md:404-426, ai/src/models.ts:860-874) [원문].
- 요청별 `apiKey`가 provider 해석보다 우선한다(ai/README.md:376-386) [원문].
- 예: Anthropic API 키 해석 순서는 저장된 키 → `ANTHROPIC_AUTH_TOKEN`(Bearer 헤더) → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → 워크로드 ID 연동 설정(ai/src/providers/anthropic.ts:19-60) [원문].

### 2.14 이미지 입력

- `UserMessage`와 `ToolResultMessage`의 content에 `ImageContent`(base64)를 넣는다. 모델 지원 여부는 `model.input.includes("image")`(ai/README.md:754-788) [원문].
- 모델별 `inputLimits.images`(`resize { maxWidth, maxHeight, maxBytes, jpegQuality }`, `maxPerMessage`, `maxPerRequest`)가 있다(ai/src/providers/model-schema.ts:48-84). 크기 조정 코드는 pi-ai에 없고 coding-agent(`utils/image-process.ts`)와 durable(`images/*`)에 있다 [원문].

### 2.15 부분 응답 영속화와 기타

- `AssistantMessageFrameEncoder`(ai/src/utils/assistant-message-frame.ts:139), `reduceAssistantMessageFrames()`(:372), `AssistantMessageFrame` 타입(:8-33). 시작 frame은 빈 content의 메타데이터, text·thinking은 글자를 한 번씩만 저장, 이미 진행된 tool call은 JSON checkpoint 한 번. `done`/`error`는 frame을 만들지 않으므로 최종 메시지는 따로 저장해야 한다(ai/README.md:726-752) [원문].
- deferred 응답: `SimpleStreamOptions.deferred`, `DeferredHandle`, `Models.streamDeferred/fetchDeferred/cancelDeferred`(ai/src/types.ts:519-529, ai/src/models.ts:330-340) [원문].
- 분류기(`classify`)와 이미지 생성(`generateImages`)은 채팅과 다른 모델 타입이다(ai/src/types.ts:641-723) [원문].
- 세션 자원 정리 훅: `registerSessionResourceCleanup`, `cleanupSessionResources`(ai/src/session-resources.ts:1-24) [원문].

## 3. pi-agent-core (`@earendil-works/pi-agent-core`)

### 3.1 구조

| 파일 | LOC | 내용 |
|---|---|---|
| `src/agent-loop.ts` | 949 | `agentLoop`, `agentLoopContinue`, `runAgentLoop`, `runAgentLoopContinue`, `runToolCall`, 내부 `runLoop`·도구 실행 |
| `src/agent.ts` | 613 | `Agent` 클래스, 큐, 상태 |
| `src/types.ts` | 539 | 공개 타입 전부 |
| `src/proxy.ts` | 393 | `streamProxy()`: 서버 경유 스트림 함수 |
| `src/stream-fn.ts` | 20 | `setDefaultStreamFn()` |
| `src/index.ts` | 5 | 위 다섯을 모두 re-export |

1.0.0에서 `AgentHarness`, 세션·세션 저장소, durable 런타임, 하네스 도구, 컴팩션, 스킬, 프롬프트 템플릿, 시스템 프롬프트 도우미, telemetry 스키마, `./node`·`./harness/*`·`./experimental/pico3` 하위 경로를 제거했다(agent/CHANGELOG.md:21-25) [원문]. 예제 `examples/mcp-codemode/{main.ts,tools.ts}`는 pi-mcp·pi-codemode를 `runToolCall()`로 연결한다(codemode/README.md:294) [원문].

### 3.2 공개 타입

```ts
// agent/src/types.ts:33-37
export type StreamFn = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions)
  => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
// 계약: 요청 실패로 throw/reject 하지 않는다. 실패는 stopReason "error"|"aborted" 최종 메시지로 표현(:27-31)

export type ToolExecutionMode = "sequential" | "parallel";          // :47
export type QueueMode = "all" | "one-at-a-time";                      // :55
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>; // :58

export interface BeforeToolCallResult { block?: boolean; reason?: string; terminate?: boolean; }   // :66-74
export interface AfterToolCallResult {                                                          // :92-104
  content?: (TextContent | ImageContent)[]; details?: unknown; structuredContent?: JsonValue;
  isError?: boolean; usage?: Usage; terminate?: boolean;
}
export interface BeforeToolCallContext { assistantMessage: AssistantMessage; toolCall: AgentToolCall; args: unknown; context: AgentContext; } // :107-116
export interface AfterToolCallContext { assistantMessage; toolCall; args: unknown; result: AgentToolResult<any>; isError: boolean; context: AgentContext; } // :119-132
export interface AgentTurnContext { message: AssistantMessage; toolResults: ToolResultMessage[]; context: AgentContext; newMessages: AgentMessage[]; } // :135-144
export type AgentTurnDecision = { action: "continue" } | { action: "end" };                    // :147
export type FinishTurn = (turn: AgentTurnContext, signal?: AbortSignal) => AgentTurnDecision | void | Promise<...>; // :155-158
export interface AgentLoopTurnUpdate { context?: AgentContext; messages?: AgentMessage[]; model?: Model<any>; thinkingLevel?: ThinkingLevel; } // :161-170
export interface PrepareRequestContext { context: AgentContext; model: Model<any>; thinkingLevel: ThinkingLevel; } // :173-177
export type AgentRequestUpdate = Omit<AgentLoopTurnUpdate, "messages">;                         // :180
export type PrepareRequest = (request: PrepareRequestContext, signal?: AbortSignal) => AgentRequestUpdate | void | Promise<...>; // :186-189

export interface AgentLoopConfig extends SimpleStreamOptions {                                   // :193-342
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;   // throw 금지
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>; // throw 금지
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  finishTurn?: FinishTurn;
  prepareRequest?: PrepareRequest;
  prepareNextTurn?: (context: PrepareNextTurnContext) => AgentLoopTurnUpdate | undefined | Promise<...>;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode;   // 기본 "parallel"
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";  // :349
export interface CustomAgentMessages {}                                                         // :365, declaration merging으로 확장
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];            // :374

export interface AgentState {                                                                   // :382-421
  readonly systemPrompt: string;        // transcript의 system 메시지 재생 결과. 읽기 전용
  model: Model<any>; thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];              // 대입 시 최상위 배열 복사
  messages: AgentMessage[];             // 대입 시 최상위 배열 복사
  readonly isStreaming: boolean; readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>; readonly errorMessage?: string;
}
export interface AgentToolResult<T = JsonValue | undefined> {                                   // :424-446
  content: (TextContent | ImageContent)[]; details: T; structuredContent?: JsonValue; usage?: Usage;
  isError?: boolean; terminate?: boolean;
}
export interface AgentToolCallOutcome { toolCall: AgentToolCall; result: AgentToolResult<any>; isError: boolean; durationMs?: number; } // :449-455
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;      // :463
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> { // :466-499
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;  // 스키마 검증 전 원시 인자 보정
  outputSchema?: TSchema;                                      // structuredContent의 스키마(검증 안 함)
  execute: (toolCallId: string, params: Static<TParameters>, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<TDetails>) => Promise<AgentToolResult<TDetails>>;
  replay?: "never" | "safe";                                   // 루프가 읽지 않음
  executionMode?: ToolExecutionMode;
}
export interface AgentContext { messages: AgentMessage[]; tools?: AgentTool<any>[]; }           // :502-507
export type AgentEvent = /* 3.6 */;                                                             // :516-539

// agent/src/agent-loop.ts
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;                       // :32
export function agentLoop(prompts: AgentMessage[], context: AgentContext, config: AgentLoopConfig,
  signal: AbortSignal | undefined, streamFn: StreamFn): EventStream<AgentEvent, AgentMessage[]>; // :38
export function agentLoopContinue(context: AgentContext, config: AgentLoopConfig, signal: AbortSignal | undefined,
  streamFn: StreamFn): EventStream<AgentEvent, AgentMessage[]>;                                   // :71
export async function runAgentLoop(prompts, context, config, emit: AgentEventSink, signal, streamFn): Promise<AgentMessage[]>; // :102
export async function runAgentLoopContinue(context, config, emit: AgentEventSink, signal, streamFn): Promise<AgentMessage[]>;   // :128
export type ToolCallHooks = Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall">;           // :684
export interface RunToolCallOptions extends ToolCallHooks { tools: readonly AgentTool<any>[]; assistantMessage: AssistantMessage;
  context: AgentContext; signal?: AbortSignal; onUpdate?: (r: AgentToolResult<any>) => Promise<void> | void; } // :791-800
export async function runToolCall(toolCall: AgentToolCall, options: RunToolCallOptions): Promise<AgentToolCallOutcome>; // :811

// agent/src/stream-fn.ts:11
export function setDefaultStreamFn(streamFn: StreamFn | undefined): void;
// agent/src/proxy.ts:107
export function streamProxy(model: Model<any>, context: TranscriptContext, options: ProxyStreamOptions): AssistantMessageEventStream;
```

### 3.3 `Agent` 클래스

```ts
// agent/src/agent.ts:78-80, 114-141
export type AgentInitialState = Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
export interface AgentOptions {
  initialState?: AgentInitialState;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>; // 기본: system/user/assistant/toolResult만 통과(:38-46)
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  onPayload?: SimpleStreamOptions["onPayload"]; onResponse?: SimpleStreamOptions["onResponse"];
  onProviderStreamEvent?: SimpleStreamOptions["onProviderStreamEvent"];
  beforeToolCall?: ...; afterToolCall?: ...;
  finishTurn?: FinishTurn; prepareRequest?: PrepareRequest;
  prepareNextTurn?: (signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  prepareNextTurnWithContext?: (context: PrepareNextTurnContext, signal?: AbortSignal) => ...;
  steeringMode?: QueueMode;  // 기본 "one-at-a-time"
  followUpMode?: QueueMode;  // 기본 "one-at-a-time"
  sessionId?: string; thinkingBudgets?: ThinkingBudgets; transport?: Transport /* 기본 "auto" */;
  maxRetryDelayMs?: number; toolExecution?: ToolExecutionMode /* 기본 "parallel" */;
}

// agent/src/agent.ts:188-613 (공개 멤버)
export class Agent {
  constructor(options: AgentOptions);
  // 훅·옵션은 모두 public 필드라 생성 후 교체할 수 있다(:194-228). coding-agent는 실제로 교체한다(3.10).
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void; // :266
  get state(): AgentState;                                           // :276
  steeringMode: QueueMode; followUpMode: QueueMode;                  // getter/setter :281-296
  steer(message: AgentMessage): void;                                // :299
  followUp(message: AgentMessage): void;                             // :304
  clearSteeringQueue(): void; clearFollowUpQueue(): void; clearAllQueues(): void; // :309-322
  hasQueuedMessages(): boolean;                                      // :325
  peekQueuedMessages(): AgentMessage[];                              // :330, steering이 있으면 steering, 없으면 follow-up
  get signal(): AbortSignal | undefined;                             // :336
  abort(): void;                                                     // :341
  waitForIdle(): Promise<void>;                                      // :350, agent_end 리스너가 끝나야 resolve
  reset(): void;                                                     // :355, 실행 중이면 throw. 선두 system 메시지만 남김
  prompt(message: AgentMessage | AgentMessage[]): Promise<void>;     // :371
  prompt(input: string, images?: ImageContent[]): Promise<void>;     // :372, 실행 중이면 throw
  continue(): Promise<void>;                                         // :384
}
```

- `initialState`의 `systemPrompt`와 `tools`는 `messages`가 system 메시지로 시작하지 않을 때만 선두 system 메시지가 된다(agent/src/agent.ts:77, 82-86) [원문].
- `continue()`: transcript 끝이 assistant면 steering 큐 한 묶음, 없으면 follow-up 큐 한 묶음으로 새 prompt를 시작하고, 둘 다 없으면 throw한다. 끝이 user/toolResult면 `runAgentLoopContinue`(agent/src/agent.ts:384-411) [원문].
- 동시 실행 금지: `prompt()`/`continue()`/`reset()`은 실행 중이면 throw한다(agent/src/agent.ts:356-358, 374-378, 385-387) [원문].

### 3.4 루프 알고리즘

`runAgentLoop`(prompt 시작)와 `runAgentLoopContinue`(이어가기)는 아래 `runLoop`를 공유한다(agent/src/agent-loop.ts:102-151, 163-321) [원문].

```text
runAgentLoop(prompts, context, config, emit, signal, streamFn):
  0. initialMessages = declareToolChanges(context, prompts)   // context.tools와 transcript 선언이 다르면 system 메시지(toolsAdded/toolsRemoved) 삽입
  1. emit agent_start, turn_start; 각 initial 메시지에 message_start, message_end
  2. runLoop(...)
runAgentLoopContinue: 마지막 메시지가 assistant면 throw. agent_start, turn_start 후 runLoop

runLoop:
  pending = await getSteeringMessages()                       // 시작 시 한 번 폴링
  loop (바깥, follow-up용):
    hasMoreToolCalls = true
    while (hasMoreToolCalls || pending 비어 있지 않음):
      if (직전 턴 있음):
        upd = await prepareNextTurn(lastTurn)                  // context/messages/model/thinkingLevel 교체 가능
        if (pending 비었음) pending = await getSteeringMessages()   // 준비가 오래 걸린 경우 다시 폴링
        emit turn_start
      prepared+pending 메시지를 declareToolChanges 후 message_start/end 발행, context에 push
      upd = await prepareRequest({context, model, thinkingLevel}, signal)   // 모든 요청 직전(첫 요청 포함). 큐 폴링 안 함
      message = await streamAssistantResponse(...)            // 3.11 변환 지점 거침
      if message.stopReason in {error, aborted}:
         await finishTurn(...)  // 결정은 무시
         emit turn_end, agent_end; return
      toolCalls = message.content 중 toolCall
      if toolCalls 있음:
         batch = stopReason == "length" ? 모두 오류 결과(실행 안 함) : executeToolCalls(...)
         결과를 context와 newMessages에 push
         hasMoreToolCalls = !batch.terminate
      decision = await finishTurn(lastTurn)
      emit turn_end
      if decision == end: emit agent_end; return
      explicitContinuation = (decision == continue)
      pending = await getSteeringMessages()
      if (hasMoreToolCalls || pending) explicitContinuation = false
    followUps = await getFollowUpMessages()                   // 멈출 지점에서만
    if followUps: pending = followUps; continue
    if explicitContinuation: 한 번 더(컨텍스트만으로 요청); continue
    break
  emit agent_end
```

- 도구 호출이 있으면 다음 요청이 자동으로 이어진다. 모든 도구 결과가 `terminate: true`일 때만 배치 후 멈춘다(agent/src/agent-loop.ts:690-692) [원문].
- `finishTurn`은 error/aborted 응답에도 호출되지만 그 결정은 무시된다(agent/src/agent-loop.ts:245-256) [원문].

### 3.5 훅 전부

| 이름(정확한 식별자) | 호출 시점 | 반환과 효과 | 출처 |
|---|---|---|---|
| `convertToLlm` | 매 요청, `transformContext` 다음 | `AgentMessage[]` → `Message[]`. throw 금지 | types.ts:197-222, agent-loop.ts:395 |
| `transformContext` | 매 요청, `convertToLlm` 전 | `AgentMessage[]` 교체(이번 요청용. context 자체는 바뀌지 않음). throw 금지 | types.ts:244, agent-loop.ts:389-392 |
| `getApiKey` | 매 요청 | provider별 키. `config.apiKey`보다 우선 | types.ts:254, agent-loop.ts:400-401 |
| `prepareRequest` | 모든 대화 요청 직전(첫 요청 포함), pending 메시지 발행 후 | `{context?, model?, thinkingLevel?}`가 이번과 이후 요청의 값을 교체 | types.ts:186-189, 266-271, agent-loop.ts:219-239 |
| `prepareNextTurn` (`Agent`에서는 `prepareNextTurn`/`prepareNextTurnWithContext`) | `turn_end` 뒤 다음 턴이 확정되었을 때, 다음 `turn_start` 전 | `{context?, messages?, model?, thinkingLevel?}`. messages는 정상 이벤트와 함께 추가 | types.ts:273-280, agent-loop.ts:185-208, agent.ts:484-492 |
| `beforeToolCall` | 인자 준비·스키마 검증 후, 실행 전 | `{block, reason, terminate}`. block이면 실행 안 하고 오류 결과. throw하면 그 메시지가 오류 결과(실험 A1) | types.ts:319-326, agent-loop.ts:708-777 |
| `afterToolCall` | 실행 후, `tool_execution_end`·결과 메시지 전 | 필드별 교체(`content`, `details`, `structuredContent`, `isError`, `usage`, `terminate`). content만 바꾸면 structuredContent 삭제. throw하면 오류 결과 | types.ts:76-104, 328-341, agent-loop.ts:859-910 |
| `finishTurn` | assistant와 모든 도구 결과 확정 후, `turn_end` 전 | `{action:"end"}`면 `turn_end` 뒤 종료. `{action:"continue"}`면 요청 한 번 보장 | types.ts:146-158, 256-264, agent-loop.ts:280-298 |
| `getSteeringMessages` | 루프 시작, 각 턴 끝(`finishTurn`이 end가 아닐 때), `prepareNextTurn` 후 | 메시지를 다음 요청 전에 추가. 현재 도구 호출은 건너뛰지 않음 | types.ts:282-293 |
| `getFollowUpMessages` | 도구 호출도 steering도 없어 멈출 지점 | 메시지를 추가하고 계속 | types.ts:295-306 |
| `onPayload` / `onResponse` / `onProviderStreamEvent` | provider 요청 직전 / 응답 헤더 / 파싱된 provider 이벤트 | pi-ai `StreamOptions`로 전달. payload 교체 가능 | agent.ts:120-122, ai/src/types.ts:174-223 |
| `subscribe` 리스너 | 모든 이벤트 | 등록 순서대로 await. 실행 정착(settlement)에 포함 | agent.ts:256-269, 605-611 |
| `AgentTool.prepareArguments` | 검증 전, 도구별 | 원시 인자 보정 | types.ts:469-473, agent-loop.ts:694-706 |

### 3.6 이벤트

```ts
// agent/src/types.ts:516-539
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }   // system, user, assistant, toolResult 모두
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent } // assistant 스트리밍만
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean; durationMs?: number };
```

이벤트 10종. 도구 한 번 쓰는 실행의 순서 [실험 A1 7번]:

```text
agent_start, turn_start, message_start(user), message_end(user),
message_start(assistant), [message_update...], message_end(assistant),
tool_execution_start, [tool_execution_update...], tool_execution_end,
message_start(toolResult), message_end(toolResult), turn_end,
turn_start, message_start(assistant), message_end(assistant), turn_end, agent_end
```

- `tool_execution_start/update/end`의 `args`는 검증 전 `toolCall.arguments`다(agent/src/agent-loop.ts:542-547, 779-788) [원문]. `beforeToolCall`이 고친 인자는 이벤트에 나오지 않는다.
- `Agent.subscribe` 리스너는 await되므로, assistant `message_end` 리스너가 끝난 뒤에 도구 준비가 시작된다 [실험 A1 2번: 80ms 지연 리스너 뒤 execute]. 저수준 `agentLoop()` 스트림은 소비자를 기다리지 않는다(agent/src/agent-loop.ts:47-58, agent/README.md:560) [원문].
- 실행 중 예외(예: `convertToLlm` throw)는 `Agent`가 잡아 `stopReason: "error"`(abort 중이면 `"aborted"`)인 빈 assistant 메시지로 `message_start`, `message_end`, `turn_end`, `agent_end`를 발행한다(agent/src/agent.ts:523-548) [원문].

### 3.7 상태 객체

- `Agent`는 `processEvents()`에서 이벤트를 받아 상태를 고친다: `message_start`/`message_update` → `streamingMessage`, `message_end` → `messages.push`, `tool_execution_start/end` → `pendingToolCalls`, `turn_end` → `errorMessage`(agent/src/agent.ts:565-603) [원문].
- 루프에 넘기는 컨텍스트는 실행 시작 시 `messages`와 `tools`의 얕은 복사본이다(agent/src/agent.ts:460-465). 실행 중 `state.tools`를 바꿔도 이번 실행에는 반영되지 않는다. 바꾸려면 `prepareRequest`/`prepareNextTurn`으로 `context`를 교체한다 [원문].
- `systemPrompt`는 `getCurrentSystemPrompt(messages)`로 계산하는 읽기 전용 값이다(agent/src/agent.ts:89-91) [원문].

### 3.8 도구 인터페이스와 실행

도구 하나의 처리 단계(`prepareToolCall` → `executePreparedToolCall` → `finalizeExecutedToolCall`, agent/src/agent-loop.ts:708-910) [원문]:

1. `tools`에서 이름으로 찾는다. 없으면 `Tool <name> not found` 오류 결과.
2. `prepareArguments`(있으면) → `validateToolArguments`(복사본 생성, 실패 시 오류 결과).
3. `beforeToolCall` → abort 확인 → block이면 `reason`(없으면 `"Tool execution was blocked"`) 오류 결과. `terminate`를 함께 주면 배치 조기 종료에 참여.
4. `execute(toolCallId, args, signal, onUpdate)`. 시간은 `performance.now()`로 잰다. throw는 오류 결과로 바뀐다. `onUpdate`는 execute가 끝난 뒤 호출되면 무시된다.
5. `afterToolCall`로 결과 필드 교체.
6. `tool_execution_end` 발행, `ToolResultMessage` 생성(`structuredContent` 제외)과 `message_start`/`message_end` 발행.

병렬과 순차(agent/src/agent-loop.ts:508-660) [원문][실험 A1 4번]:

- 기본 `parallel`. 준비(2~3단계)는 호출 순서대로 하나씩 하고, 허용된 호출의 실행만 동시에 한다.
- `tool_execution_end`는 완료 순서, 결과 메시지는 assistant 메시지 안의 원래 순서로 발행한다. 실험: `s60`, `s5` 순으로 시작해 `s5`가 먼저 끝났고 결과 메시지는 `s60`, `s5` 순.
- 배치 안에 `executionMode: "sequential"`인 도구가 하나라도 있으면 그 배치 전체를 순차 실행한다(agent/src/agent-loop.ts:516-521).
- `runToolCall()`은 같은 단계를 이벤트·메시지 없이 실행한다. 도구 안에서 다른 도구를 부를 때 훅을 거치게 하려는 용도다(agent/src/agent-loop.ts:802-819).

### 3.9 steering / follow-up 큐

- `PendingMessageQueue`(agent/src/agent.ts:143-174): `all`은 큐 전체, `one-at-a-time`은 가장 오래된 하나를 꺼낸다.
- steering은 각 턴의 도구 실행이 끝난 뒤(현재 도구 호출은 건너뛰지 않음) 다음 요청 전에 들어간다. follow-up은 에이전트가 멈출 지점에서만 들어간다(agent/src/types.ts:282-306) [원문]. 실험에서 도구 실행 중 `steer()`한 메시지는 두 번째 요청의 마지막 user 메시지로 들어갔다 [실험 A1 8번].
- `finishTurn`이 `{action:"end"}`를 돌려주면 큐는 그대로 남는다(agent/CHANGELOG.md:60) [원문].

### 3.10 오류·중단 처리

- `abort()`는 현재 실행의 `AbortController`를 abort한다(agent/src/agent.ts:341-343). 신호는 스트림 함수, `beforeToolCall`/`afterToolCall`, 도구 `execute`, 리스너에 전달된다 [원문].
- 응답이 `aborted`/`error`면 도구를 실행하지 않고 `turn_end`, `agent_end` 후 끝난다(agent/src/agent-loop.ts:245-256).
- 준비 중 abort가 감지되면 해당 호출은 `"Operation aborted"` 오류 결과가 된다. 순차 모드는 abort 후 남은 호출을 건너뛴다(결과 메시지 없음). 병렬 모드는 abort를 본 뒤 더 등록하지 않고, 이미 등록했지만 아직 시작하지 않은 호출에는 `"Operation aborted"` 결과를 만든다(agent/src/agent-loop.ts:575-577, 613-628, 641-643) [원문]. 순차 모드에서 결과가 없는 호출은 다음 요청 때 pi-ai `transformMessages`가 `"No result provided"`로 채운다(2.11).
- 재시도 정책은 없다. 실패한 응답은 transcript에 `stopReason: "error"`로 남는다 [원문].

### 3.11 컨텍스트 변환 지점

요청 하나가 provider에 가기까지(agent/src/agent-loop.ts:219-239, 381-407) [원문]:

```text
currentContext.messages (AgentMessage[])
  → prepareRequest가 context/model/thinkingLevel 교체 가능
  → transformContext(messages, signal)          // AgentMessage 수준. 이번 요청에만 적용
  → convertToLlm(messages)                       // Message[]
  → normalizeContext({messages})                 // TranscriptContext
  → getApiKey(provider) ?? config.apiKey
  → streamFn(model, llmContext, {...config, apiKey, signal})
       → (pi-ai) transformMessages: 이미지 강등, thinking 변환, 오류 응답 제외, 결과 없는 호출 채움
       → onPayload(payload)                      // provider payload 교체 가능
```

`currentContext`는 `prepareRequest`가 교체한 객체이고, 루프는 그 `messages` 배열에 응답과 도구 결과를 `push`한다(0장 3번).

## 4. pi-coding-agent (`@earendil-works/pi-coding-agent`)

### 4.1 구조

| 디렉터리 | LOC | 내용 |
|---|---|---|
| `src/core/` | 35,393 | `agent-session.ts`(4,398), `session-manager.ts`(2,013), `sdk.ts`(487), `system-prompt.ts`(229), 설정·모델 런타임·리소스 로더 등. 하위 `tools/`(4,619), `extensions/`(5,005), `compaction/`(1,671), `export-html/`(748) |
| `src/modes/` | 23,938 | interactive(TUI), print/json, rpc(`rpc-types.ts`, `rpc-mode.ts`, `rpc-client.ts`) |
| `src/experimental/` | 9,950 | durable 기반 실험 에이전트, server/client/coordinator, Chord 서비스. npm 제외 |
| `src/extensions/` | 7,456 | 내장 확장 `codemode`, `mcp`, `tool-search`, `llama` |
| `src/utils/` | 3,770 | 셸, 경로, 이미지 처리, rg/fd 관리 등 |
| `src/cli/` | 1,959 | 인자 파싱 등 |
| 최상위 파일 | 3,624 | `main.ts`, `config.ts`, `index.ts`(494) 등 |

루트 `index.ts`는 `main.ts`, `modes/index.ts`, `modes/interactive/components/index.ts`, 테마, SDK, 도구, 확장, 세션 관리자 등을 모두 re-export한다(coding-agent/src/index.ts) [원문].

### 4.2 내장 도구 목록

`ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls"`(coding-agent/src/core/tools/index.ts:95-105). 묶음 팩토리(:164-224) [원문]:

- `createCodingTools(cwd, options?)`: read, bash, edit, write
- `createReadOnlyTools(cwd, options?)`: read, grep, find, ls
- `createAllTools(cwd, options?)`: 8개 전부(이름 → 도구)
- 각각 `create<Name>Tool(cwd, options?): AgentTool`과 `create<Name>ToolDefinition(cwd, options?): ToolDefinition`(확장 API용, 렌더러 포함)

`create*Tool()`은 `wrapToolDefinition(definition)`이고 context 팩토리 없이 감싸므로 `execute`의 다섯 번째 인자 `ctx`가 없다(coding-agent/src/core/tools/tool-definition-wrapper.ts:8-30). 이때 도구는 생성 시 받은 `cwd`를 쓰고, bash는 `PI_*` 세션 환경 변수를 넣지 않는다 [원문][실험 A2: `$PI_SESSION_ID`가 빈 값].

| 도구 | 파일 | 입력 스키마 | 모델용 출력 | `details` | `structuredContent`(`outputSchema`) | 교체 가능한 Operations | constrainedSampling |
|---|---|---|---|---|---|---|---|
| read | `core/tools/read.ts` | `{ path: string; offset?: number /*1-based*/; limit?: number }` (:14-18) | 텍스트, 또는 `[text 메모, image]` | `{ truncation? }` | `string \| { type:"image", data, mimeType, note }` (:33-36) | `ReadOperations { readFile, access, detectImageMimeType? }` (:48-55) | json_schema prefer |
| write | `core/tools/write.ts` | `{ path: string; content: string }` (:11-14) | `"Successfully wrote to <path>"` | 없음 | 없음 | `WriteOperations { writeFile, mkdir }` (:27-32) | json_schema prefer |
| edit | `core/tools/edit.ts` | `{ path: string; edits: { oldText: string; newText: string }[] }` (:21-41) | `"Successfully replaced N block(s) in <path>."` | `{ diff, patch, firstChangedLine? }` (:70-77) | 없음 | `EditOperations { readFile, writeFile, access }` (:83-90) | json_schema prefer |
| bash | `core/tools/bash.ts` | `{ command: string; timeout?: number /*초*/ }` (:40-43) | 출력 꼬리 + 잘림 안내, 0 아닌 종료코드는 `isError` + `"Command exited with code N"` | `{ truncation?, fullOutputPath? }` | `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }` (:56-62, 최대 1MiB) | `BashOperations { exec(command, cwd, {onData, signal, timeout, env}) → {exitCode} }` (:75-94) | json_schema prefer |
| powershell | `core/tools/powershell.ts` | bash와 같음 | bash와 같음 | | | 같음. Windows 전용(utils/shell.ts:124-137) | |
| grep | `core/tools/grep.ts` | `{ pattern; path?; glob?; ignoreCase?; literal?; context?; limit? /*기본 100*/ }` (:21-33) | `파일:줄: 내용` 행, 줄당 500자 | `{ truncation?, matchLimitReached?, linesTruncated? }` | 없음 | `GrepOperations { isDirectory, readFile }` (:53-58) | |
| find | `core/tools/find.ts` | `{ pattern /*glob*/; path?; limit? /*기본 1000*/ }` (:26-32) | 검색 루트 기준 상대 경로 목록 | `{ truncation?, resultLimitReached? }` | 없음 | `FindOperations { exists, glob }` (:49-55) | |
| ls | `core/tools/ls.ts` | `{ path?; limit? /*기본 500*/ }` (:11-14) | 정렬된 항목, 디렉터리는 `/` 접미사, 점 파일 포함 | | 없음 | `LsOperations` (:34-) | |

동작 세부 [원문, 일부 실험]:

- read: 이미지(jpg/png/gif/webp/bmp)는 `processImage`로 크기 조정 후 image 블록으로 보낸다. 현재 모델이 이미지를 받지 못하면 메모 텍스트를 붙인다(read.ts:79-84, 133-152). 텍스트는 `offset`/`limit` 적용 뒤 `truncateHead`(2000줄/50KB)로 자르고 이어 읽기 안내(`Use offset=N to continue.`)를 붙인다(:154-204) [실험 A2: 2500줄 파일에서 `[Showing lines 1-2000 of 2500. Use offset=2001 to continue.]`]. 첫 줄 하나가 50KB를 넘으면 `sed`로 읽으라는 안내를 낸다(:179-183).
- write: 부모 디렉터리를 재귀 생성하고 덮어쓴다. 같은 파일에 대한 write/edit는 `withFileMutationQueue`(realpath 기준 키)로 직렬화한다(write.ts:65-89, file-mutation-queue.ts:28-61).
- edit: `prepareArguments`가 `edits`가 JSON 문자열이거나 단일 객체인 경우, 옛 `oldText`/`newText` 최상위 필드를 보정한다(edit.ts:103-134). BOM 제거, 줄끝 정규화 후 모든 `oldText`를 원본 기준으로 찾아 적용하고, 원래 줄끝·BOM으로 되돌려 쓴다(:185-198). 매칭 규칙(유일성, 겹침 금지, 퍼지 매칭)은 `edit-diff.ts`(`applyEditsToNormalizedContent` :300, `fuzzyFindText` :207). 일치하지 않으면 throw [실험 A2: `Could not find the exact text in a.txt...`].
- grep: `rg --json --line-number --color=never --hidden`으로 실행하고 `.gitignore`를 따른다(grep.ts:162-168).
- find: 기본 구현은 `fd --glob --color=never --hidden --max-results N`(find.ts:182-216). `FindOperations.glob`을 주면 fd 대신 그것을 쓴다.

### 4.3 bash 실행 방식

[원문 coding-agent/src/core/tools/bash.ts, coding-agent/src/utils/shell.ts]

1. 셸 선택 `getShellConfig(shellPath?)`(utils/shell.ts:67-119): 지정 경로 → (Windows) Git Bash → PATH의 bash.exe → (Unix) `/bin/bash` → PATH의 bash → `sh -c`. 인자는 `-c <command>`. 옛 WSL bash는 stdin으로 명령을 넘긴다(:20-22).
2. `commandPrefix`가 있으면 명령 앞에 줄바꿈으로 붙인다(bash.ts:268).
3. 환경: `getShellEnv()`(pi bin 디렉터리를 PATH에 추가)에서 `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`을 지운 뒤, `exposeSessionEnvironment`(기본 true)이고 ctx가 있으면 다시 채운다. `spawnHook`으로 command/cwd/env를 바꿀 수 있다(bash.ts:186-212).
4. `spawn(shell, args, { cwd, detached: (Windows 아님), env, stdio: [ignore, pipe, pipe] })`. stdout·stderr를 하나로 모은다. 작업 디렉터리가 없으면 오류(bash.ts:105-118, 139-140).
5. 타임아웃(초, 기본 없음)이나 abort 시 프로세스 트리를 죽이고 각각 `"Command timed out after N seconds"`, `"Command aborted"`를 throw한다(bash.ts:126-154, 371-381) [실험 A2]. 시그널 종료는 `128 + 시그널 번호`로 본다(:155-158).
6. 출력은 `OutputAccumulator`가 모으고, 잘리면 전체 출력을 임시 파일(`pi-bash` 접두사)에 남긴다. 진행 중 `onUpdate`는 `BASH_UPDATE_THROTTLE_MS` 간격으로 낸다(bash.ts:276-336).
7. 0이 아닌 종료코드는 throw하지 않고 `isError: true` 결과로 돌려준다(bash.ts:400-407) [실험 A2].

명령 내용 검사, 샌드박스, 쓰기 범위 제한은 없다 [원문].

### 4.4 잘림 규칙

`core/tools/truncate.ts` [원문]:

- `DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024`, `GREP_MAX_LINE_LENGTH = 500`(:11-13). 두 한도 중 먼저 걸리는 것으로 자른다.
- `truncateHead(content, opts)`(:78): 앞부분 유지, 부분 줄 없음. 첫 줄이 한도를 넘으면 빈 내용과 `firstLineExceedsLimit`. read가 쓴다.
- `truncateTail(content, opts)`(:168): 뒷부분 유지. 마지막 줄 하나가 한도를 넘는 경우만 부분 줄. bash가 쓴다.
- `truncateLine`(:268), `truncateMiddle(content, maxBytes)`(:292, MCP 텍스트 20KB 초과 시 사용, extensions/mcp/tools.ts:4-5).
- `TruncationResult { content, truncated, truncatedBy: "lines"|"bytes"|null, totalLines, totalBytes, outputLines, outputBytes, lastLinePartial, firstLineExceedsLimit, maxLines, maxBytes }`(:15-38).

### 4.5 경로 처리

- `resolveToCwd(path, cwd)` = `resolvePath(path, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true })`(core/tools/path-utils.ts:48-50). 앞의 `@` 제거, 유니코드 공백 정규화, `~`·`~/` 확장, `file://` URL 변환, Windows 경로 정규화 후 절대 경로면 그대로, 상대 경로면 cwd 기준으로 푼다(utils/paths.ts:76-107) [원문].
- read는 파일이 없을 때 macOS 스크린숏 이름 변형(AM/PM 앞 좁은 공백, NFD, 곱은 따옴표)을 차례로 시도한다(core/tools/path-utils.ts:86-118) [원문].
- cwd 밖 접근을 막는 코드는 없다 [원문][실험 A2]. `getCwdRelativePath()`(utils/paths.ts:109-118)는 표시용이다.
- 도구는 실행 시 `ctx?.cwd || cwd`를 쓴다. 세션에서는 ctx의 cwd가 우선한다(read.ts:124, bash.ts:271 등) [원문].

### 4.6 도구만 가져올 때의 의존 문제

- package.json에 도구 전용 하위 경로가 없다(1.1). 루트 import는 `main.ts`, interactive 컴포넌트까지 끌어온다 [원문].
- 도구 파일의 import(coding-agent/src/core/tools/*.ts) [원문]:
  - 모든 도구: `@earendil-works/pi-agent-core`(타입), `typebox`, `../extensions/types.ts`(타입), `./renderers/<name>.ts`, `./tool-definition-wrapper.ts`
  - 렌더러: `@earendil-works/pi-tui`, `modes/interactive/theme/theme.ts`, `modes/interactive/components/{diff,keybinding-hints,visual-truncate}.ts`, `config.ts`, `utils/paths.ts`
  - read: `utils/image-process.ts`(photon), `utils/mime.ts`
  - bash: `utils/shell.ts`(→ `config.ts`), `utils/child-process.ts`(cross-spawn), `output-accumulator.ts`
  - grep/find: `utils/tools-manager.ts`(rg/fd 다운로드, `config.ts`, `management-http.ts`)
  - edit: `edit-diff.ts`(`diff` 패키지), `utils/text.ts`
  - 의존 없는 파일: `truncate.ts`, `file-mutation-queue.ts`(node 내장만)
- 루트 import 실측: 634ms, 외부 패키지 33개 로드(pi-tui, pi-codemode, pi-mcp, pi-agent-core, pi-ai, highlight.js, marked, undici, yaml, proper-lockfile, grok-mermaid 등). chord와 photon은 로드되지 않았다(지연 로드) [실험 A2].

### 4.7 세션 저장 형식

[원문 coding-agent/docs/session-format.md, coding-agent/src/core/session-manager.ts]

- 위치: `~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl`. 헤더 줄 하나 뒤에 엔트리 줄. version 3(1, 2는 읽을 때 이전 판으로 변환).
- 엔트리는 `id`(보통 8자리 hex)·`parentId`로 트리를 이룬다. 현재 위치(leaf)에서 뿌리까지가 활성 경로다. 여러 뿌리도 가능(`resetLeaf()`, `branchWithSummary(null, ...)`).

```ts
// coding-agent/src/core/session-manager.ts:43-197
export interface SessionHeader { type: "session"; version?: number; id: string; timestamp: string; cwd: string; parentSession?: string; }
export interface SessionEntryBase { type: string; id: string; parentId: string | null; timestamp: string /* ISO */; }
export interface SessionMessageEntry extends SessionEntryBase { type: "message"; message: AgentMessage; }
export interface ThinkingLevelChangeEntry extends SessionEntryBase { type: "thinking_level_change"; thinkingLevel: string; }
export interface ModelChangeEntry extends SessionEntryBase { type: "model_change"; provider: string; modelId: string; }
export interface UsageEntry extends SessionEntryBase { type: "usage"; kind: string; provider: string; model: string; usage: Usage; note?: string; }
export interface CompactionEntry<T = unknown> extends SessionEntryBase { type: "compaction"; summary: string; firstKeptEntryId: string;
  tokensBefore: number; details?: T; usage?: Usage; fromHook?: boolean; systemMessage?: SystemMessage; }
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase { type: "branch_summary"; fromId: string; summary: string; details?: T; usage?: Usage; fromHook?: boolean; }
export interface CustomEntry<T = unknown> extends SessionEntryBase { type: "custom"; customType: string; data?: T; }          // 모델 컨텍스트에 안 들어감
export interface LabelEntry extends SessionEntryBase { type: "label"; targetId: string; label: string | undefined; }
export interface SessionInfoEntry extends SessionEntryBase { type: "session_info"; name?: string; }
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase { type: "custom_message"; customType: string;
  content: string | (TextContent | ImageContent)[]; details?: T; display: boolean; }                                            // 모델 컨텍스트에 들어감
export interface ContextEditEntry extends SessionEntryBase { type: "context_edit"; targetId: string;
  replacement: { content: ContextEditableContent } | null; }                                                                 // null = 모델 컨텍스트에서 생략
export type SessionEntry = SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry | UsageEntry | CompactionEntry
  | BranchSummaryEntry | CustomEntry | CustomMessageEntry | ContextEditEntry | LabelEntry | SessionInfoEntry;
```

- 시스템 프롬프트와 도구 선언은 별도 상태 없이 `message` 엔트리의 system 메시지(`sections`, `toolsAdded`/`toolsRemoved`)로 남는다(session-format.md "SessionMessageEntry").
- `context_edit`: 이전 엔트리 하나의 모델 컨텍스트 기여만 바꾼다. 원본 엔트리·UI·내보내기·사용량 집계는 그대로다. 같은 대상에 여러 edit가 있으면 활성 경로의 마지막 것이 이긴다. 브랜치 기준이라 edit 이전 지점으로 가면 원래 내용이 보인다(session-format.md "ContextEditEntry").
- 컨텍스트 구성: `buildContextEntries()`(leaf→root, 마지막 compaction 기준으로 잘라 냄, session-manager.ts:476) → `buildSessionProjection()`(context_edit 적용, :543) → `buildSessionContext()`(메시지 목록, 모델·thinking 설정, :576).
- 쓰기(session-manager.ts:1166-1196): `_appendEntry`가 메모리에 넣고 `_persist`를 부른다. 아직 파일을 만들지 않았고 user/assistant 메시지가 없으면 아무것도 쓰지 않는다. 있으면 `openSync(file, "wx")`로 만들고 지금까지의 엔트리를 모두 쓴 뒤, 이후에는 엔트리마다 `appendFileSync`. fsync와 파일 락은 없다.
- 무엇을 언제 쓰나: `AgentSession`은 `message_end` 이벤트에서 system/user/assistant/toolResult 메시지를 `appendMessage`로, custom 메시지를 `appendCustomMessageEntry`로 남긴다(agent-session.ts:1144-1163). 스트리밍 중간 상태와 실행 중인 도구 상태는 쓰지 않는다 [원문].
- fork/clone은 새 파일을 만들고 헤더에 `parentSession`을 둔다(`SessionManager.forkFrom`, session-manager.ts:1815-1870).
- `SessionManager` 생성자는 private이고 `create(cwd, sessionDir?, options?)`, `open(path, sessionDir?, cwdOverride?)`, `continueRecent(cwd, sessionDir?)`, `inMemory(cwd?, options?, entries?)`, `forkFrom(...)`, `findById`, `list`, `listAll` 정적 메서드를 쓴다(session-manager.ts:1000, 1755-1940) [원문].
- 주요 인스턴스 메서드: `appendMessage`, `appendThinkingLevelChange`, `appendModelChange`, `appendUsage`, `appendCompaction`(:1261), `appendCustomEntry`, `appendCustomMessageEntry`(:1339), `appendSessionInfo`, `appendContextEdit`(:1360), `appendLabelChange`, `getLeafId`, `getEntry`, `getChildren`, `getBranch`, `getTree`, `branch(id)`, `resetLeaf()`, `branchWithSummary`(:1600), `createBranchedSession(leafId)`, `buildSessionContext()` [원문].

### 4.8 컴팩션 알고리즘

[원문 coding-agent/docs/compaction.md, coding-agent/src/core/compaction/compaction.ts]

- 설정: `DEFAULT_COMPACTION_SETTINGS = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`(compaction.ts:126-130). 발동 조건 `contextTokens > contextWindow - reserveTokens`(`shouldCompact`, :267-270).
- 발동 지점: 다중 턴 실행 중 도구 결과가 붙은 뒤 다음 assistant 응답 전(`prepareNextTurnWithContext`, agent-session.ts:900-930), 새 user 프롬프트 전, 실행 종료 후 overflow 복구. `/compact [지시]`로 수동. provider 컨텍스트 초과 오류나 이른 `length` 종료는 한 번의 compact-and-retry를 일으킨다(compaction.md "When It Triggers").
- 절차:
  1. 투영된(context_edit 반영) 활성 경로를 뒤에서부터 걸으며 토큰을 추정(글자/4, 이미지 4800자로 계산, compaction.ts:276-298)해 `keepRecentTokens`에 이를 때까지 남길 범위를 정한다(`findCutPoint`, :446).
  2. 자르는 지점은 user, assistant, bashExecution, custom 메시지 엔트리만 가능하고 toolResult에서는 자르지 않는다. 한 user 메시지 구간이 예산보다 크면 구간 중간의 assistant에서 자르고(split turn) 앞부분을 따로 요약한다.
  3. 요약 범위는 직전 compaction의 `firstKeptEntryId`부터 자르는 지점까지다(남았던 메시지도 다시 요약에 들어간다).
  4. `serializeConversation()`(compaction/utils.ts:114)으로 `[User]:`, `[Assistant thinking]:`, `[Assistant]:`, `[Assistant tool calls]:`, `[Tool result]:` 텍스트로 바꾸고, 도구 결과는 2000자로 자른다(utils.ts:94, 149).
  5. 이전 요약이 있으면 갱신 프롬프트로, 정해진 형식(Goal, Constraints & Preferences, Progress, Key Decisions, Next Steps, Critical Context + `<read-files>`/`<modified-files>`)으로 요약을 만든다. 요약 요청은 `cacheRetention: "none"`과 별도 `sessionId`를 쓰고 `retryAssistantCall`로 재시도한다(compaction.ts:619-640).
  6. `CompactionEntry { summary, firstKeptEntryId, tokensBefore, details: { readFiles, modifiedFiles }, usage, systemMessage }`를 추가한다. `systemMessage`는 그 시점의 프롬프트·도구 전체 체크포인트다.
- 함수: `prepareCompaction(pathEntries, settings): CompactionPreparation | undefined`(:872), `compact(preparation, model, apiKey, headers?, customInstructions?, signal?, thinkingLevel?, streamFn?, env?, retry?, callbacks?, sessionId?): Promise<CompactionResult>`(:965), `generateSummary`(:645), `generateSummaryWithUsage`(:696), `estimateTokens`(:298), `findCutPoint`(:446). `CompactionPreparation { firstKeptEntryId, messagesToSummarize, turnPrefixMessages, isSplitTurn, tokensBefore, previousSummary?, fileOps, settings }`(:772-789).
- 컴팩션 모듈은 `session-manager.ts`(`buildSessionProjection`, `SessionEntry`)와 `@earendil-works/pi-ai/compat`의 `completeSimple`(streamFn이 없을 때)에 의존한다(compaction.ts:9-45, 632-635) [원문].
- 브랜치 요약: `/tree`로 다른 가지로 갈 때 공통 조상까지의 떠나는 가지를 요약해 `branch_summary`로 남긴다(compaction/branch-summarization.ts, compaction.md "Branch Summarization").
- 확장 훅: `session_before_compact`(취소 또는 직접 만든 요약 제공), `session_compact`, `session_compact_failed`, `session_before_tree`, `session_tree`.

### 4.9 확장(extension) API

[원문 coding-agent/src/core/extensions/types.ts(2,273줄), coding-agent/docs/extensions.md]

`ExtensionAPI`(types.ts:1564-1890)의 이벤트 구독 `on(event, handler)` 41종:

```text
project_trust, resources_discover,
session_start, session_info_changed, session_before_switch, session_before_fork,
session_before_compact, session_compact, session_compact_failed, session_shutdown,
mcp_servers_change, session_before_tree, session_tree,
context, context_with_system, cache_warming_decision,
before_provider_request, before_provider_headers, after_provider_response, provider_stream_event,
before_agent_start, agent_start, agent_end, agent_before_settle, agent_settled,
ui_prompt_start, ui_prompt_end,
turn_start, turn_end, message_start, message_update, message_end,
tool_execution_start, tool_execution_update, tool_execution_end,
model_select, thinking_level_select,
tool_call, tool_result, user_bash, input
```

그 밖의 메서드(types.ts:1640-1888): `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`/`getFlag`, `registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer`, `registerToolRenderer`, `sendMessage(msg, { triggerTurn?, deliverAs?: "steer"|"followUp"|"nextTurn" })`, `sendUserMessage(content, { deliverAs?, expandPromptTemplates? })`, `appendEntry(customType, data?)`, `setSessionName`/`getSessionName`, `setLabel`, `exec(command, args, options?)`, `getActiveTools`/`getAllTools`/`setActiveTools`, `getSettings`, `getCommands`, `setModel`, `getThinkingLevel`/`setThinkingLevel`, `registerProvider`/`unregisterProvider`, `registerMcpServer`/`unregisterMcpServer`/`getMcpServers`, `registerVirtualModel`/`unregisterVirtualModel`, `events: EventBus`.

```ts
// coding-agent/src/core/extensions/types.ts:574-654
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
  name: string; label: string; description: string;
  promptSnippet?: string; promptGuidelines?: string[];          // 시스템 프롬프트의 tools/rules 절에 들어감
  parameters: TParams; constrainedSampling?: false | ConstrainedSamplingConfig;
  renderShell?: "default" | "self";
  prepareArguments?: (args: unknown) => Static<TParams>;
  outputSchema?: TSchema;
  exposure?: ToolExposure;          // 기본 "direct"
  namespace?: ToolNamespace;        // 예: MCP 서버 하나의 도구 묶음
  annotations?: ToolAnnotations;    // readOnlyHint, destructiveHint, idempotentHint, openWorldHint (검증되지 않은 힌트)
  defaultActive?: boolean;
  prepareLoadout?: (loadout: ToolLoadout) => ToolLoadoutChanges | undefined;
  executionMode?: ToolExecutionMode;
  execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined, ctx: ExtensionToolContext): Promise<AgentToolResult<TDetails>>;
  renderCall?(args, theme, context): Component;       // pi-tui Component
  renderResult?(result, options, theme, context): Component;
}
// :516
export type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";
// direct: 활성일 때 모델에 선언, 다른 도구에서도 호출 가능 / model-only: 선언만, 다른 도구에서 호출 불가
// codemode: 등록되면 호출 가능, 명시 활성화 전에는 선언 안 함, codemode 도구 설명에 나열 / deferred: codemode와 같으나 나열 안 함(tool search로 찾음)
// hidden: 등록만, 도달 불가 (:500-515)

// :325-365, :383-395
export interface ExtensionContext {
  ui: ExtensionUIContext; mode: ExtensionMode; hasUI: boolean; cwd: string;
  sessionManager: ReadonlySessionManager; modelRegistry: ModelRegistry; model: Model<any> | undefined;
  scopedModels: readonly ScopedModel[]; thinkingLevel?: ThinkingLevel;
  isIdle(): boolean; isProjectTrusted(): boolean; signal: AbortSignal | undefined; abort(): void;
  hasPendingMessages(): boolean; shutdown(): void; getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void; getSystemPrompt(): string;
}
export interface ExtensionToolContext extends ExtensionContext {
  readonly tools: readonly AgentTool[];
  executeTool(name: string, args: unknown, options?: ExecuteToolOptions): Promise<AgentToolCallOutcome>; // id "<호출 id>/<n>", transcript에 안 남고 nestedCalls로 기록
}
// :1426-1461
export interface ToolCallEventResult { block?: boolean; reason?: string; terminate?: boolean; } // 인자 수정은 event.input을 직접 고친다
export interface ToolResultEventResult { content?; details?; structuredContent?; isError?; usage?; }
```

- `tool_call` 이벤트는 `{ type, toolName, toolCallId, parentToolCallId?, input }`이고 도구별로 `input` 타입이 좁혀진 union이다(types.ts:1228-1237) [원문].
- `MessageEndEventResult { message? }`로 확정 메시지를 같은 role 안에서 바꿀 수 있다(types.ts:1463-1466) [원문].
- 확장 로딩은 `jiti`로 TS 파일을 그대로 읽는다(core/extensions/loader.ts, jiti-loader.ts) [원문].

### 4.10 AgentSession이 agent-core 훅을 쓰는 방식

[원문 coding-agent/src/core/agent-session.ts, sdk.ts]

| agent-core 지점 | coding-agent 사용 |
|---|---|
| `beforeToolCall` | 확장 `tool_call` 실행. `input: args`로 넘기므로 핸들러가 고친 값이 실행 인자가 된다. 핸들러가 throw하면 그 오류로 block(agent-session.ts:653-681) |
| `afterToolCall` | 확장 `tool_result` 실행 후 결과 이미지 크기 정규화(:684-725) |
| `runToolCall` | `ctx.executeTool()`의 중첩 호출. 같은 훅을 `parentToolCallId`와 함께 적용(:731-764) |
| `prepareRequest` | 가상 모델 라우팅과 요청 직전 컴팩션 판정(:778-860) |
| `finishTurn` | 기존 값을 감싸 재시도·복구 처리(:887-) |
| `prepareNextTurnWithContext` | 턴 사이 컴팩션, 시스템 프롬프트·도구 선언 갱신 메시지 삽입(:900-930) |
| `transformContext` | 확장 `context` 이벤트(sdk.ts:436-440) |
| `convertToLlm` | `messages.ts`의 변환 + 이미지 차단 설정(sdk.ts:296-300, 419) |
| `streamFn` | `ModelRuntime.streamSimple` + 캐시 워머(sdk.ts:420-432) |
| `subscribe` | `message_end`에서 세션 파일 기록(4.7) |

### 4.11 SDK

```ts
// coding-agent/src/core/sdk.ts:48-116, 191
export interface CreateAgentSessionOptions {
  cwd?: string; agentDir?: string;                       // 기본 ~/.pi/agent
  modelRuntime?: ModelRuntime; model?: Model<any>; thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  noTools?: "all" | "builtin"; tools?: string[] /* 이름 목록 */; excludeTools?: string[];
  customTools?: ToolDefinition[];
  resourceLoader?: ResourceLoader; sessionManager?: SessionManager; settingsManager?: SettingsManager;
  sessionStartEvent?: SessionStartEvent;
}
export interface CreateAgentSessionResult { session: AgentSession; extensionsResult: LoadExtensionsResult; modelFallbackMessage?: string; }
export async function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
```

- `AgentSessionRuntime`(agent-session-runtime.ts:74): `switchSession`(:196), `newSession`(:226), `fork`(:262), `importFromJsonl`(:359). `createAgentSessionRuntime`(:420) [원문].
- `ModelRuntime.create({ modelsPath?: string | null, allowModelNetwork?, ... })`(model-runtime.ts:112-116, 216). `modelsPath: null`이면 `models.json`을 읽지 않는다 [원문].
- `SettingsManager.inMemory(settings?, options?)`(settings-manager.ts:357), `DefaultResourceLoader`의 `extensionFactories?: InlineExtension[]`(resource-loader.ts:285) [원문].
- 내장 확장은 SDK에서 `createCodemodeExtension()`, `createMcpExtension()`, `createToolSearchExtension()`을 `extensionFactories`에 넣어 켠다. CLI는 내장 확장으로 로드한다(extensions/codemode/index.ts:1-6, coding-agent/src/index.ts:407-411) [원문].

### 4.12 설정

- 파일: `~/.pi/agent/settings.json`(전역), `<project>/.pi/settings.json`(프로젝트)(coding-agent/docs/compaction.md "When It Triggers", docs/settings.md) [원문].
- 예: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`(기본 `"medium"`), `thinkingBudgets`, `steeringMode`/`followUpMode`(기본 `"one-at-a-time"`), `defaultTools`(기본 read, bash, edit, write), `codemode.mode`(`"on"`|`"only"`), `codemode.inlineBudget`(3000), `defaultProjectTrust`, `cacheWarming`(docs/settings.md:11-42). 표 항목 71개 [원문].
- 경로 상수: `CONFIG_DIR_NAME = ".pi"`, 환경 변수 `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`(config.ts:581-586) [원문].

### 4.13 시스템 프롬프트 구성

[원문 coding-agent/src/core/system-prompt.ts]

- `buildSystemPromptSections(input)`(:128-193)은 이름 붙은 절 레코드를 만든다. 순서: `preamble`(태그 없음) → `tools` → `rules` → `docs` → `addendum`(appendSystemPrompt) → `project_context`(AGENTS.md 등) → `skills` → `cwd` → 사용자 지정 절. `preamble` 외의 절은 `<name>...</name>`으로 감싼다.
- `customPrompt`가 있으면 `preamble`만 그것으로 바꾸고 tools/rules/docs 절은 만들지 않는다(:152-166).
- 이 절들은 transcript의 `SystemMessage.sections`가 되고, 바뀐 절만 `diffSystemPromptSections`로 패치한다(:213-229).
- 프로젝트 컨텍스트 파일 후보: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`. 전역 파일과 조상 디렉터리 파일을 모은다(resource-loader.ts:185, 239-273).
- 기본 preamble 문장: "You are an expert coding assistant operating inside pi, a coding agent harness..."(:155-156).

### 4.14 RPC 모드와 기타 모드

- 모드: interactive(TUI), print, `--mode json`, `--mode rpc` [원문 docs/rpc.md, docs/json.md].
- RPC 명령 33종(modes/rpc/rpc-types.ts): prompt, steer, follow_up, abort, clear_queue, new_session, get_state, set_model, cycle_model, get_available_models, set_thinking_level, cycle_thinking_level, get_available_thinking_levels, set_steering_mode, set_follow_up_mode, compact, set_auto_compaction, set_auto_retry, abort_retry, bash, abort_bash, get_session_stats, export_html, switch_session, fork, clone, get_fork_messages, get_entries, get_tree, get_last_assistant_text, set_session_name, get_messages, get_commands [원문].
- `RpcClient`, `RpcClientOptions`를 루트에서 export한다(coding-agent/src/index.ts:421-422) [원문].
- 확장 UI 중 dialog류는 RPC 하위 프로토콜로 전달되고 `custom()`은 `undefined`를 돌려준다(docs/rpc-extension-ui.md:14-25) [원문].

### 4.15 experimental (npm 제외)

- `src/experimental/durable/`: pi-durable Harness + `CodingTools` + pi 시스템 프롬프트 절 + pi TUI 컴포넌트로 만든 작은 코딩 에이전트. 세션당 `~/.pi/agent/experimental/durable-sessions/<cwd-hash>/<session>/session.sqlite`, 락(크래시로 남은 락은 10초 후 stale). subagent 도구, task graph 패널. 세션 목록·fork·트리 탐색·확장·프롬프트 템플릿·이미지·`/login`은 없다. `node --import .../source-resolver.ts`로만 실행(src/experimental/durable/README.md) [원문].
- server/client: `session-worker.ts`가 세션마다 pi-durable `Harness`를 연다(:15, 796-810). Chord 서비스 디렉터리 `src/experimental/services/`(agent-controller, transcript, models, slash-commands, sessions 등). Radius relay WebSocket 하위 프로토콜 `pi-session-relay.host.v1`/`client.v1`(radius-relay.ts:7-8). TODO: 트리 탐색, subagent 노출, transcript 페이징(services/README.md:38-45) [원문]. 세부는 `pi-api-facts-2.md`.

## 5. pi-codemode (`@earendil-works/pi-codemode`)

### 5.1 구조

| 파일 | LOC | 내용 |
|---|---|---|
| `src/runtime/execution.ts` | 436 | `CodemodeSandboxBase`: 공통 호스트 쪽(도구 표, 기한, abort, 결과 조립) |
| `src/runtime/host.ts` | 79 | `CodemodeSandbox`: 실행마다 worker 스레드 |
| `src/runtime/inline.ts` | 125 | `InlineCodemodeSandbox`: 호출 스레드에서 실행, interrupt 예산 |
| `src/runtime/remote.ts` | 272 | `RemoteCodemodeSandbox`, `serveCodemodeRemote`(Cloudflare DO 등 원격 VM) |
| `src/runtime/prelude-source.ts` | 512 | VM 안에서 평가하는 prelude(`tools`, `console`, `text`, `image`, `exit`, `store`, `load`) |
| `src/runtime/vm.ts`, `worker.ts`, `protocol.ts` | 307 | QuickJS VM 생성, worker 진입점, 메시지 형식 |
| `src/declarations.ts` | 355 | 도구 스키마 → TypeScript 선언 렌더링 |
| `src/source.ts` | 115 | `// @options:` 줄 파싱, Lark 문법 |
| `src/types.ts` | 149 | 공개 타입 |

pi 패키지 의존이 없다. 외부 의존은 `quickjs-wasi` 하나다 [원문 package.json].

### 5.2 공개 API

```ts
// codemode/src/types.ts:3-149
export interface CodemodeToolContext { signal: AbortSignal; } // 스크립트 종료(대기 안 한 호출 포함), 기한, 호출자 abort, close 때 abort
export type CodemodeJsonSchema = { [key: string]: unknown } | boolean;   // 선언 렌더링용. 값 검증 안 함
export interface CodemodeTool {
  name: string; description?: string; inputSchema?: CodemodeJsonSchema; outputSchema?: CodemodeJsonSchema;
  spread?: boolean;      // globals 전용
  signature?: string;    // globals 전용
  execute(args: unknown, context: CodemodeToolContext): Promise<unknown> | unknown; // args·반환값은 JSON 왕복
}
export type CodemodeOutputItem = { type: "text"; text: string; console?: true } | { type: "image"; data: string; mimeType: string };
export type CodemodeCallStatus = "ok" | "error" | "cancelled";
export interface CodemodeCall { name: string; status: CodemodeCallStatus; durationMs: number; }
export type CodemodeErrorKind = "script" | "timeout" | "aborted" | "sandbox";
export interface CodemodeError { kind: CodemodeErrorKind; name?: string; message: string; stack?: string; }
export interface CodemodeStoreWrites { set: Record<string, unknown>; delete: string[]; }
export type CodemodeResult =
  | { ok: true; value: unknown; output: CodemodeOutputItem[]; calls: CodemodeCall[]; storeWrites: CodemodeStoreWrites }
  | { ok: false; error: CodemodeError; output: CodemodeOutputItem[]; calls: CodemodeCall[] };
export interface CodemodeSandboxBaseOptions { tools?: CodemodeTool[]; globals?: CodemodeTool[]; timeoutMs?: number /* 기본 300000 */; memoryLimitBytes?: number; }
export interface CodemodeSandboxOptions extends CodemodeSandboxBaseOptions { wasm?: CodemodeWasmModule | Promise<CodemodeWasmModule>; workerUrl?: string | URL; }
export interface CodemodeExecuteOptions { signal?: AbortSignal; timeoutMs?: number; store?: Readonly<Record<string, unknown>>; }

// codemode/src/index.ts
export class CodemodeSandboxBase { execute(code: string, options?: CodemodeExecuteOptions): Promise<CodemodeResult>; close(): Promise<void>; } // runtime/execution.ts:363, 432
export class CodemodeSandbox extends CodemodeSandboxBase { constructor(options?: CodemodeSandboxOptions); }                               // runtime/host.ts:75
export class InlineCodemodeSandbox ...; export const DEFAULT_INTERRUPT_BUDGET;                                                          // runtime/inline.ts
export class RemoteCodemodeSandbox ...; export function serveCodemodeRemote(...);                                                       // runtime/remote.ts
export function renderDeclarations(options): string; export function schemaToType(...); export function toCodemodeIdentifier(name: string): string;
export function parseCodemodeSource(source: string): ParsedCodemodeSource; export const CODEMODE_SOURCE_GRAMMAR: string;
export const MAX_OUTPUT_CHARS /* 16Mi */, MAX_OUTPUT_ITEMS /* 100000 */, MAX_STORE_TOTAL_CHARS /* 1Mi */, MAX_STORE_VALUE_CHARS /* 256Ki */; // prelude-source.ts:32-41
export function loadQuickJSWasm(path?): Promise<CodemodeWasmModule>;
```

`execute()`는 스크립트 실패로 reject하지 않는다(codemode/README.md "Results") [원문].

### 5.3 샌드박스 구조와 신뢰 경계

- `CodemodeSandbox`는 `execute()`마다 worker 스레드를 새로 띄우고(약 20ms), 그 안에서 컴파일된 wasm 모듈로 새 QuickJS VM 인스턴스를 만든다. 런어웨이 스크립트는 `terminate()`로 죽이고, Bun을 위해 공유 interrupt 플래그도 세운다(codemode/src/runtime/host.ts:12-66, codemode/README.md "How it works") [원문].
- VM의 import는 WASI shim(시계, 난수, 버려지는 stdout/stderr)과 호스트 호출 진입점 하나뿐이다. 스크립트에서 쓸 수 있는 것은 `tools.<name>()`, `ALL_TOOLS`, `text()`, `image()`, `exit()`, `store()`/`load()`, `console.*`, 등록된 globals다. 타이머, `fetch`, `process`, `require`, 모듈, `WebAssembly`는 없다. `eval`/`Function`은 같은 VM 안의 코드만 만든다(codemode/README.md "Usage on Node and Bun", "How it works") [원문].
- 도구 호출 인자와 결과는 JSON 왕복한다. 호스트가 도구를 실행하고 결과를 돌려준다. 신뢰 경계는 VM과 호스트 사이이고, 도구 자체의 권한은 호스트가 정한다 [원문].
- `image()`는 base64 `data:` URL, `{ image_url }`, MCP `ImageContent`만 받고 원격 URL은 거부한다(README) [원문].
- 기한은 도구 시간을 포함한 전체 실행 기준(기본 300000ms, `Infinity` 가능). 메모리 상한은 `memoryLimitBytes`(기본 없음) [원문].

### 5.4 `store()`와 변수 수명

- JS 변수와 `globalThis` 값은 한 번의 `execute()`에서만 산다 [실험 A2: 첫 실행에서 `globalThis.kept = 42`, 두 번째 실행에서 `typeof globalThis.kept === "undefined"`].
- `store(key, value)`/`load(key)`는 동기 JSON 저장소다. 샌드박스는 아무것도 저장하지 않는다. 호출자가 `options.store`로 현재 값을 넘기고, 성공한 실행의 `result.storeWrites`(`{ set, delete }`)를 직접 반영해야 한다. 실패한 실행은 쓰기를 보고하지 않는다(codemode/README.md "Store") [원문][실험 A2: store를 넘기지 않은 두 번째 실행의 `load("n")`은 값 없음, 넘긴 세 번째 실행은 1].
- 값 하나 최대 256Ki자, 전체 1Mi자(JSON 기준). 넘으면 스크립트 안에서 `RangeError`(prelude-source.ts:32-33, 302-311) [원문].
- coding-agent의 `codemode` 도구는 활성 브랜치의 `codemode-store` custom 엔트리를 뿌리부터 적용해 `store`를 만들고, 성공한 스크립트의 쓰기를 같은 종류의 엔트리로 남긴다. 그래서 브랜치마다 자기 경로의 값을 본다(coding-agent/src/extensions/codemode/execute.ts:232-242, 492-506, tool.ts:18-21) [원문]. 세션 컨텍스트가 없으면(plain `Agent`) 도구 호출 불가, store는 빈 값으로 시작하고 쓰기는 버린다(execute.ts:410-414) [원문].

### 5.5 노출(exposure)과 도구 호출 경로 (coding-agent 통합)

- 스크립트가 부를 수 있는 도구는 `ctx.tools`(세션의 callable 도구) 중 `codemode` 자신을 뺀 것이다(coding-agent/src/extensions/codemode/tool.ts:179-181). callable 집합은 활성 `direct` 도구와 모든 `codemode`/`deferred` 도구다(tool.ts:7-8, ToolExposure 정의 4.9) [원문].
- 스크립트의 도구 호출은 `ctx.executeTool()` → `NestedToolCallRunner` → agent-core `runToolCall()`을 거쳐 같은 검증, `tool_call`/`tool_result` 훅을 적용받는다(execute.ts:465, agent-session.ts:731-764) [원문].
- 결과 전달: `outputSchema`가 있는 도구는 `structuredContent`, 없으면 텍스트 하나. 실패·차단·검증 오류는 스크립트 안에서 Error로 reject(tool.ts:12-17, execute.ts:403-408) [원문].
- `codemode` 도구 자신은 `exposure: "model-only"`라 다른 도구에서 부를 수 없다(tool.ts:393) [원문].
- coding-agent 설정: 메모리 상한 256MiB(execute.ts:56), 기한은 스크립트 첫 줄 `// @options: {"timeout_ms": ...}`가 없으면 무한(execute.ts:484) [원문].

### 5.6 하위 LLM 호출 가능 여부

- pi-codemode 자체에는 모델 개념이 없다. 호출자가 globals로 함수를 넣으면 무엇이든 부를 수 있다 [원문 types.ts:103-109].
- coding-agent `codemode` 도구가 넣는 `models.*` globals는 `getModelsOfType`, `getAvailableOfType`, `getModelOfType`, `classify`, `generateImages`다(coding-agent/src/extensions/codemode/execute.ts:623-733). 채팅 모델은 목록에 나오지만 스크립트에서 실행할 수 없다(coding-agent/docs/codemode.md:62) [원문]. 따라서 기본 구성에서 스크립트가 채팅 LLM 하위 호출을 할 수 없다. Helm이 REPL 탐구에 하위 LLM 호출을 원하면 globals에 직접 넣어야 한다 [후보].

## 6. pi-mcp (`@earendil-works/pi-mcp`)

### 6.1 구조

| 디렉터리/파일 | LOC | 내용 |
|---|---|---|
| `src/client.ts` | 615 | `McpClient` |
| `src/transports/` | 827 | `stdio.ts`(216), `streamable-http.ts`(505), `in-memory.ts`(51), `transport.ts`(55, 인터페이스) |
| `src/protocol/` | 361 | `jsonrpc.ts`, `types.ts`, `content.ts` |
| `src/oauth/` | 1,349 | MCP OAuth 클라이언트 부분집합(discovery, PKCE flow, callback 서버) |
| `src/auth-provider.ts` | 20 | `AuthProvider`, `McpFetch` |

공식 MCP SDK나 다른 pi 패키지에 의존하지 않는다(mcp/README.md:3) [원문].

### 6.2 클라이언트 API

```ts
// mcp/src/client.ts:47-58, 153-390
export interface McpClientOptions extends Implementation /* name, version */ {
  capabilities?: ClientCapabilities; protocolVersion?: SupportedProtocolVersion;
  requestTimeoutMs?: number; roots?: readonly Root[] | (() => readonly Root[] | Promise<readonly Root[]>);
}
export interface McpRequestOptions { signal?: AbortSignal; timeoutMs?: number; onProgress?: (p: ProgressNotification) => void; }
export class McpClient {
  constructor(options: McpClientOptions);
  get connectionState(); get serverInfo(); get serverCapabilities(); get instructions(); get protocolVersion();
  connect(transport: McpTransport): Promise<InitializeResult>;
  notify(method: string, params?): Promise<void>;
  setRequestHandler(method: string, handler): () => void;
  onNotification(method: string, listener): () => void; onError(listener): () => void; onClose(listener): () => void;
  ping(options?): Promise<void>;
  listTools(options?): Promise<Tool[]>;                  // 페이지를 모두 따라감(최대 페이지 수 제한)
  listResources(options?): Promise<Resource[]>; listResourcesPage(cursor?, options?);
  listResourceTemplates(options?); listResourceTemplatesPage(cursor?, options?);
  readResource(uri: string, options?): Promise<ReadResourceResult>;
  callTool(name: string, args?: Record<string, unknown>, options?: McpRequestOptions): Promise<CallToolResult>;
  close(): Promise<void>;
}
// mcp/src/protocol/types.ts:4-10, 76-85
export const LATEST_PROTOCOL_VERSION = "2025-11-25";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export interface Tool { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>; annotations?: ToolAnnotations; execution?: ToolExecution; _meta?: Record<string, unknown>; }
// mcp/src/protocol/content.ts:111-117
export function toLlmContent(result: Pick<CallToolResult, "content" | "structuredContent">): LlmContent[]; // text·image 통과, 임베디드 리소스 풀기, 오디오·링크·바이너리는 짧은 자리표시, content가 없고 structuredContent만 있으면 JSON 텍스트
```

### 6.3 전송

- `StdioTransport`(transports/stdio.ts): `cross-spawn`으로 서버 프로세스를 띄워 stdin/stdout JSON-RPC [원문].
- `StreamableHttpTransport`(transports/streamable-http.ts): `{ url, headers, fetch? }`. `McpAuthRequiredError`, `McpHttpError`, `McpSessionExpiredError`를 export(mcp/src/index.ts:59-65) [원문].
- `InMemoryTransport`(`./testing`) [원문].

### 6.4 outputSchema 처리

- `callTool()` 결과 검증은 `content`가 배열인지, `structuredContent`가 객체인지만 본다. `content`가 없으면 빈 배열로 채운다. `outputSchema` 대비 검증은 하지 않는다(mcp/src/client.ts:142-151, 376-384) [원문].
- MCP 도구 실패는 프로토콜 오류로 오지 않고 결과 안의 `isError` 플래그로 온다(mcp/README.md:55) [원문].

### 6.5 도구 변환

- 최소 변환 예(mcp/README.md:36-56): 이름 `mcp_<tool>`을 `[A-Za-z0-9_-]` 64자로 정리, `parameters: Type.Unsafe({...inputSchema, type: "object", properties: inputSchema.properties ?? {}})`, `execute`는 `callTool` 후 `{ content: toLlmContent(result), isError: result.isError === true }` [원문].
- coding-agent 내장 MCP 확장의 변환(coding-agent/src/extensions/mcp/tools.ts) [원문]:
  - 이름 `mcp__<server>__<tool>`, 허용 문자 외는 `_`, 길면 해시 접미사로 줄임(:79-90).
  - `outputSchema: createMcpResultSchema(tool.outputSchema)`: `CallToolResult` 모양 스키마이고 서버의 outputSchema는 그 안의 `structuredContent` 스키마가 된다(:104-114, 276).
  - 모델용 결과: 텍스트 20KB 초과 시 앞뒤를 남기고 가운데를 자르며 전체는 임시 파일에 저장, 이미지 외 바이너리 리소스도 임시 파일, 리소스 링크는 `read_mcp_resource` 도구를 안내(:1-10).
  - codemode 스크립트에는 `_meta`를 뺀 `CallToolResult` 전체를 잘라내지 않고 `structuredContent`로 준다(:6-10, 227).
  - 기본 exposure는 `"codemode"`(설정 `exposure`, 도구별 `toolExposure`로 바꿈, extensions/mcp/index.ts:9-16, 135-141).
  - 진행 알림은 `onUpdate`로 전달(:280-288).

## 7. pi-durable (`@earendil-works/pi-durable`)

### 7.1 구조와 상태

| 디렉터리 | LOC | 내용 |
|---|---|---|
| `src/harness/` | 8,212 | `Harness`, `scheduler.ts`(1,897), `tool.ts`(892), `generation.ts`(690), `compaction.ts`(453), `agent.ts`, `context.ts`, `view.ts`, `events.ts`, `task-graph.ts`, `live.ts`, `inbox.ts`, `usage.ts`, `provider.ts`, `registry.ts`, `define.ts`, `types.ts`(786) |
| `src/session/` | 2,513 | `session.ts`(1,081), `transaction.ts`(1,043), `observation.ts` |
| `src/storage/` | 3,224 | `memory.ts`(864), `sqlite/`(storage 934, migrations, node, cloudflare, database), `jsonl/` |
| `src/env/` | 2,250 | `ExecutionEnv`(`FileSystem` + `Shell`), `NodeExecutionEnv` |
| `src/tools/` | 1,562 | read, write, edit, bash(+powershell), `createCodingTools`, `CodingTools` |
| `src/images/` | 390 | Photon 기반 이미지 처리 |
| `src/testing/` | 2,811 | storage·env conformance, 벤치마크 |
| 최상위 | 1,880 | `types.ts`(1,154), `entries.ts`, `documents.ts`, `tasks.ts`, `errors.ts`, `index.ts` |

- README 첫 줄: "**Experimental.** The API changes without notice between releases."(durable/README.md:3) [원문].
- 의존: `@earendil-works/chord`, `@earendil-works/pi-ai`, `@silvia-odwyer/photon`, `diff`, `typebox`. pi-agent-core는 쓰지 않는다(1.3) [원문].
- 내장 도구는 `read`, `write`, `edit`, `bash`(+ `createPowerShellTool()`)이고 grep/find/ls는 없다. `createCodingTools()`는 아무도 자동 설치하지 않는 `coding-tools` 확장이다(durable/src/tools/index.ts:26-39) [원문].

### 7.2 `docs/spec.md` 요지 (5,123줄, 제목 "Pico5 specification")

핵심 규칙: "A Session atomically commits immutable entries, full task records, and Chord-tracked documents. Only committed state is observable."(spec.md:42-44) [원문].

| 절 | 행 | 요지 |
|---|---|---|
| 1 Terms and invariants | 46-79 | Session, conversation, entry, task, document, definition, source, turn, run 정의. 불변조건 8개: 커밋 원자성, 저장 성공 후 공개, 모든 보이는 진행은 내구적, 외부 효과는 트랜잭션 밖, 엔트리·ID 불변, draft는 콜백 종료 시 회수, mutation line 보유, 저장소 오류는 Session에 치명적 |
| 2 Core records | 80-256 | 숫자 브랜드 ID(`ConversationId`, `EntryId`, `TaskId<R>`, `SubmissionId`, `DocumentId`), 단조 증가 `Seq`, `ROOT_CONVERSATION_ID = 1`, conversation 소유(`ownerless` 또는 task), Pico는 system 메시지 `content`를 항상 `""`로 쓰고 모든 프롬프트를 sections로 |
| 2.1 Entries and context | 257-295 | 활성 transcript는 최신 `head`부터 끝까지. 컨텍스트 유도 10단계: head 찾기, edit(omit/replace) 적용, system 메시지 유지, 도구 결과를 호출 바로 뒤로 이동, 결과 없는 호출에 오류 결과 합성, 결과 없는 고아 결과 제거, aborted/error/deferred assistant 제외, user만 앞선 system 메시지를 맨 앞으로 |
| 2.2 Public Harness surface | 296-964 | `Harness`, `Conversation`, `Submission`, `Tx` 등 공개 API 전체 |
| 3 Documents | 965-1570 | 정의(scope: session/conversation/task, conversation은 history `latest`/`rewindable`과 fork `asOf`/`current`/`initial`), 레코드와 수명, 접근·생성, 변경 소유, base와 checkpoint, 버전·마이그레이션, fork |
| 4 Transactions and storage ownership | 1571-1638 | 한 mutation line, 문서 캐시(`documentRetentionMs` 기본 10분), 테이블 규칙(첫 테이블 쓰기 후 테이블 읽기 금지 `ReadAfterWrite`), 저장소 소유권(커밋 인자는 settle까지 빌림) |
| 5 Tasks | 1639-2244 | 5.1 정의(상태 pending/running/waiting/completing/terminal, 결과 completed/failed/aborted/orphaned/faulted, phase 핸들러, `TaskRuntime`, memo), 5.2 effect sandwich, 5.3 terminal 기록, 5.4 스케줄러·abort·소유, 5.5 structured concurrency(소유 트리, abort는 아래로, 소유 작업이 끝나야 소유자 terminal) |
| 6 Submissions and inbox | 2245-2375 | `pi.inbox` 문서(steer/followUp/write 항목), 입력 수용·배치·정산 표, `requestId` 중복 제거, turn boundary |
| 7 Extensions, hooks, tools, system prompt | 2376-3526 | 7.1 확장·registry·agent 해석, 7.2 hooks, 7.3 tools(세 채널 결과, 중첩 호출, replay), 7.4 system prompt와 동적 도구, 7.5 reload |
| 8 Built-in tasks | 3527-4157 | 8.1 내장 엔트리(`pi.user`, `pi.assistant`, `pi.system`, `pi.tool-result`, `pi.reset`, `pi.compaction`), 8.2 `pi.live`, 8.3 generation, 8.4 tool, 8.5 tool rounds, 8.6 usage, 8.7 compaction |
| 9 Document observation and Chord | 4158-4620 | 문서 상태, `watchDoc`, conversation view, agent events(experimental), task graph view |
| 10 Storage contract | 4621-4886 | cursor 기반 스캔, `StorageWrite` 종류, 실패 처리(10.1) |
| 11 Backends | 4887-4965 | Memory(기준 의미론), SQLite(한 SQL 트랜잭션 = 한 Session 커밋), JSONL(sidecar + main marker, `fsync` 옵션) |
| 12 API footguns | 4966-5108 | 계약 목록 |
| 13 Non-goals | 5109-5123 | 의미 이벤트 저널 없음, CRDT 병합 없음, JSONL 전역 compaction 없음, 협조하지 않는 확장 코드의 강제 종료 없음 등 |

### 7.3 5.2 실행 의도 → 실행 → 결과 기록 (effect sandwich)

spec.md:1917-1933 원문 요지 [원문]:

```text
commit intent phase
perform external effect
commit outcome or next phase
```

- 의도 단계에서 다시 열리면 효과가 이미 일어났을 수 있다. 핸들러는 안전하게 재시도하거나, 외부 핸들을 폴링하거나, 중단을 기록한다.
- deferred provider는 핸들과 다음 폴링 시각을 담은 내구 단계로 표현한다.
- memo는 task 레코드 안의 작은 first-writer-wins 값이다. 후보 삽입과 승자 읽기가 한 커밋이다. checkpoint를 넘어 살아남고 terminal 교체에서 사라진다. 대량 진행 상태는 문서에 둔다.
- 예시 코드(spec.md:1832-1846): `prepare` 단계가 멱등 키를 담은 `charge` 단계로 커밋 → `charge`가 외부 결제(키로 멱등) 후 결과 엔트리와 terminal을 한 커밋 → `abort` 핸들러가 취소 후 `aborted` terminal 커밋.

이것을 도구 호출에 적용한 것이 `pi.tool` task다(spec.md:3869-3927, durable/src/harness/tool.ts) [원문]:

```ts
// spec.md:3872-3878
type ToolTaskInput =
  | { kind: "model"; assistant: EntryId; callId: string }
  | { kind: "nested"; parent: TaskId; parentCallId: string; key: string; call: ToolCall; progress?: false };
type ToolTaskCheckpoint =
  | { phase: "call" }
  | { phase: "execute"; arguments: JsonObject; replay: "safe" | "unsafe" };
type ToolTaskResult = { kind: "model"; entryId: EntryId; control?: ToolControl } | { kind: "nested" };
```

```text
call 단계:
  1. assistant 엔트리에서 호출을 읽고(runtime.entry), 이번 단계 agent의 tools에서 도구를 찾는다
  2. pi-ai validateToolArguments → beforeTool 체인(첫 block 우선, 아니면 arguments 교체, throw는 block) → 다시 검증
  3. 도구 없음·인자 오류·block이면 의도 없이 해당 오류 결과를 커밋하고 끝
  4. [의도 커밋] { phase: "execute", arguments: 최종 인자, replay: 도구 정책 } + 슬롯 running
  5. HarnessOptions.env로 api.env를 만들고 execute()
  6. afterTool 체인(결과 교체)
  7. [결과 커밋] 내용 한도 적용, diagnostics 추가, pi.tool-result 엔트리 1개 추가, 슬롯 done, completed { entryId, control }
     execute()나 env 생성이 throw하면 tool_error 결과, task는 failed { entryId }
execute 단계 (복구로만 도달):
  저장된 정책과 현재 정책이 모두 safe → beforeTool 없이 저장된 인자로 다시 실행 후 call과 같이 정산
  그 외 → 슬롯의 내구 부분 출력·details·diagnostics로 interrupted 오류 결과 커밋, failed { entryId }
abort 핸들러:
  슬롯의 부분 출력으로 aborted 오류 결과 커밋, aborted { entryId }
```

- interrupted 결과 문구: `Tool <name> was interrupted and may have partially run`, 재시작 때는 `... interrupted by a restart and may have partially run`(durable/src/harness/tool.ts:182-195) [원문].
- `ToolRegistration.replay`는 `"safe" | "unsafe"`, 기본 `unsafe`(durable/src/harness/types.ts:289-290) [원문].
- 부분 응답과 도구 출력은 기본 최대 100ms마다 커밋한다. `settings.progress`로 조정(durable/README.md:382) [원문].

### 7.4 저장소 스키마

```ts
// durable/docs/spec.md:4621-4700 (요약)
type ScanOrder = "ascending" | "descending";
type StorageWrite =
  | { type: "conversation"; value: ConversationRecord } | { type: "entry"; value: EntryRecord }
  | { type: "task"; value: TaskRecord } | { type: "submission"; value: SubmissionRecord }
  | { type: "document.create"; record; content /* base */ } | /* document 변경·retire ... */;
type DocumentContent = { version: number; kind: "base"; value: JsonObject } | { version: number; kind: "delta"; ops: readonly Op[] };
```

SQLite DDL(durable/src/storage/sqlite/migrations.ts:9-85) [원문]:

```sql
CREATE TABLE durable_metadata (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), next_id TEXT NOT NULL, next_seq INTEGER NOT NULL) STRICT;
CREATE TABLE record_ids (id INTEGER PRIMARY KEY, record_type TEXT NOT NULL CHECK (record_type IN ('conversation','entry','task','submission','document'))) STRICT;
CREATE TABLE conversations (id INTEGER PRIMARY KEY, owner_conversation_id INTEGER, owner_task_id INTEGER, record TEXT NOT NULL CHECK (json_valid(record))) STRICT;
CREATE TABLE entries (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, head INTEGER, commit_seq INTEGER NOT NULL, record TEXT NOT NULL CHECK (json_valid(record))) STRICT;
CREATE TABLE tasks (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','waiting','completing','terminal')),
  abort_requested INTEGER NOT NULL CHECK (abort_requested IN (0,1)), background INTEGER NOT NULL CHECK (background IN (0,1)),
  record TEXT NOT NULL CHECK (json_valid(record))) STRICT;
CREATE TABLE submissions (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','placed','done','unanswered')), record TEXT NOT NULL CHECK (json_valid(record))) STRICT;
CREATE TABLE documents (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, family INTEGER NOT NULL CHECK (family IN (0,1)), key_value TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('session','conversation','task')), owner_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL, retired_at INTEGER, record TEXT NOT NULL CHECK (json_valid(record))) STRICT;
CREATE TABLE document_revisions (document_id INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('base','delta')),
  version INTEGER NOT NULL, content TEXT NOT NULL CHECK (json_valid(content)), PRIMARY KEY (document_id, seq)) STRICT;
-- 인덱스: conversations(owner_*), entries(conversation_id, id DESC) 와 head 부분 인덱스, tasks(status|conversation_id|kind|abort_requested|background, id),
--         submissions(conversation_id, request_id) 등, documents(주소, scope), document_revisions(document_id, kind, seq DESC)
-- 별도 durable_schema(version) 테이블로 마이그레이션 버전 관리 (:94-125)
```

- 레코드는 행별 JSON 텍스트 컬럼(`record`)에 저장하고, 조회용 컬럼만 따로 뽑는다. live task 전이는 행 하나를 교체한다(spec.md:4897-4912) [원문].
- Node 어댑터: `node:sqlite` `DatabaseSync`, `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `wal_autocheckpoint`, 닫을 때 `wal_checkpoint(TRUNCATE)`(durable/src/storage/sqlite/node.ts:3-4, 167, 187-192) [원문].
- 한 저장소는 한 프로세스만 소유하고 프로세스 간 락은 없다(durable/README.md:623) [원문]. 커스텀 저장소는 `registerStorageConformance`로 검증(`./testing`, README:637-640) [원문].
- JSONL: `main.jsonl`(커밋마다 marker), `doc-<id>.jsonl`, `task-<id>.jsonl`. sidecar를 먼저 쓰고 marker를 쓴 뒤 메모리 공개. `fsync` 기본 false(spec.md:4914-4965) [원문].

### 7.5 재개 알고리즘

[원문 spec.md:1898-1915(5.1 끝), 5.4, 5.5, 8.3, 8.4; README "Persist and Resume"]

```text
Harness.open(storage, options, context):
  registry에 내장 task 정의가 있는지 확인(없으면 throw, harness.ts:447-458)
  openTasks: running task를 pending으로 되돌림(checkpoint·abort mark 유지)
             waiting task는 유지, completing·waiting task는 재평가
harness.resume() 또는 submit/wait 호출 → 스케줄러 시작
스케줄러:
  pending(또는 재개 가능한 waiting) task를 예약 → running, 필요하면 migrate
  phase 핸들러 실행. 각 phase 전 step 규칙:
    terminal/completing/waiting → 중지; closing → 중지; abort mark → abort 호출로 전환
    처리 안 된 오류 → faulted; checkpoint 변경 → 다음 phase; checkpoint 불변 → faulted(진전 없음)
  정의가 없거나 오래되었거나 migrate 실패 → pending/waiting으로 막힌 채 대기(abort하면 orphaned)
도구 task가 execute 단계였으면 → 7.3의 replay 규칙
generation이 request 단계였으면 → pi.live에 커밋된 partial을 aborted pi.assistant 엔트리로 바꾸고,
  같은 커밋 메시지·고정 모델·thinking·stream 옵션으로 다시 요청(beforeRequest 재실행) (spec.md:3787-3796)
```

- `requestId`가 같은 제출은 기존 submission을 돌려준다(README "Persist and Resume") [원문].
- 크래시 후 재개 동작은 pi-layer-analysis 실험 exp4로 확인되었다고 적혀 있다. 이번 작업에서는 다시 돌리지 않았다(재실행은 `pi-api-facts-2.md` 담당).

### 7.6 공개 API 요약

```ts
// durable/src/harness/harness.ts:445-470, durable/src/harness/types.ts:552-571
export const Harness: { open<Tool extends ToolRegistration>(storage: Storage, options: HarnessOptions<Tool>, context: Context): Promise<Harness> };
export type HarnessOptions<Tool> = {
  readonly models: Models; readonly registry: RegistryReader<Tool>; readonly settings?: HarnessSettings;
  readonly env?: (target: EnvTarget, context: Context) => ExecutionEnv | undefined | Promise<ExecutionEnv | undefined>;
  readonly conversationCreated?: (tx: Tx, conversation: ConversationRecord) => void | Promise<void>;
  readonly now?: () => number; readonly onReport?: (error: unknown) => void;
};
// Harness: root(), conversation(id), createConversation(), resume(), inspect(), submission(id), abortSubmission(),
//          abortTask(), waitForTask(), waitForIdle(), usage(), taskGraph(), watchTaskGraph(), close()   (harness.ts:238-330, types.ts:690-716)
// Conversation: agent(), configure(), submit(), compact(), reset(), context(), entries(), fork(), abort(), waitForIdle(), viewState(), watch(), commit()  (harness.ts:86-166, types.ts:612-660)

// durable/src/harness/types.ts:285-320
export type ToolRegistration<TParameters extends TSchema = TSchema, TDetails extends JsonValue = JsonValue> = Tool<TParameters> & {
  readonly replay?: "safe" | "unsafe";
  readonly executionMode?: ToolExecutionMode;
  prepareArguments?(args: unknown): Static<TParameters>;   // 순수 함수여야 함
  readonly structuredOutputSchema?: TSchema;                // Harness가 검증
  readonly callers?: readonly ("model" | "tools")[];
  readonly outputLimits?: { readonly maxBytes?: number; readonly maxLines?: number; readonly retain?: "head" | "tail" };
  execute(args: Static<TParameters>, api: ToolExecutionApi<TDetails>, context: Context): Promise<ToolExecutionResult<TDetails>>;
};
// spec.md:2780-2789
type ToolExecutionResult<TDetails> = { output?; structuredOutput?; isError?; details?; diagnostics?; usage?; control?: { addTools?; terminate?; handoff? } };

// durable/src/harness/types.ts:731-786
export interface GenerationHooks {
  beforeRequest(request: { messages: readonly Message[] }, api: HookApi, context: Context): HookResult<{ messages: readonly Message[] }>;
  afterResponse(message: AssistantMessage, api: HookApi, context: Context): void | Promise<void>;
  onYield(answer: AssistantMessage, api: HookApi, context: Context): HookResult<{ continue: UserInput }>;
  afterTools(assistant: EntryId, results: readonly EntryId[], api: HookApi, context: Context): void | Promise<void>;
}
export interface ToolHooks {
  beforeTool(call: ToolHookCall, api: HookApi, context: Context): HookResult<{ arguments?: JsonObject; block?: string }>;
  afterTool(call: ToolHookCall, result: ToolExecutionResult, api: HookApi, context: Context): HookResult<ToolExecutionResult>;
}
export interface CompactionHooks { beforeCompact(compaction, api: HookApi, context: Context): HookResult<{ decline: true } | { summary: string }>; }
export interface HookApi extends DocumentReader { taskId; conversationId; models: Models; memo(...); } // 커밋된 읽기와 task memo만(:718-726)

// durable/src/index.ts:25 등
export { defineExtension, defineTool, hook, section, wrapSection, wrapTool, createRegistry, defineDoc, defineDocFamily, defineTask,
  createSession, MemoryStorage, ROOT_CONVERSATION_ID, UsageDoc, InboxDoc, ProviderDoc, watchEvents /* experimental */ };
```

- 확장은 `defineExtension({ name, tools, sections, hooks, wraps, tasks })`로 만들고 registry에 설치한다. 훅은 그 확장을 선택한 conversation에만 적용된다(durable/README.md:464-481) [원문]. conversation의 확장 선택은 `pi.agent` 문서에 이름으로 저장되고, 설치되지 않은 이름은 해석 때 건너뛴다. 이 사실을 검사하는 코드는 없다(spec.md:735-760) [원문].
- 관찰: `viewState()`는 커밋마다 갱신되는 읽기 전용 Chord 상태, `watch()`는 커밋별 Chord ops. 처리되지 않은 frame이 100개를 넘으면 최신 view 하나로 교체, 늦게 붙거나 재접속한 클라이언트는 현재 view부터 받는다(durable/src/session/observation.ts:16, 229, durable/README.md:354-380) [원문].
- 사람 승인 대기 상태(승인 요청 → 대기 → 재개)를 표현하는 내장 개념은 없다. spec의 승인 언급은 `beforeTool`에서 `{ block: "Needs approval" }`을 돌려주는 예시뿐이다(spec.md:2529-2532) [원문 grep].
- 하위 에이전트: 도구가 `api.commit()` 안에서 task 소유 conversation을 만들고 `api.conversation(id)`로 구동한다(durable/README.md:492-512) [원문].

## 8. 기존 자료의 pi 주장 대조

판정: **확인** / **불일치**(실제 내용을 적음) / **부분 일치**(일부만 맞거나 표현이 과함) / **확인 불가**(소스로 판정 불가) / **범위 밖**(`pi-api-facts-2.md`나 사례 자료가 확인할 항목). "행"은 원 문서의 행 번호다.

### 8.1 `docs/design/process/sources/pi-layer-analysis.md`

| 행 | 주장 | 판정 | 근거·실제 |
|---|---|---|---|
| 3 | 커밋 `cdaf6c2`, npm 1.1.0 | 확인(소스) / 확인 불가(npm) | `git log -1` = cdaf6c2, 모든 package.json 1.1.0 |
| 8 | 모두 lockstep 1.1.0 | 확인 | 14개 package.json |
| 12 | pi-ai 27,242줄, Models·카탈로그·auth·스트림·faux | 확인 | 1.1, 2장 |
| 13 | agent-core 2,519줄, 1.0.0에서 실험 하네스 제거 | 확인 | agent/CHANGELOG.md:21-25 |
| 14 | coding-agent 86,152줄, `src/experimental`·`src/client` npm 제외 | 확인 | package.json `files` |
| 15 | tui 19,505줄 | 확인(LOC만) | 나머지 범위 밖 |
| 16 | durable 22,842줄, Experimental | 확인 | durable/README.md:3 |
| 17 | chord 8,817줄, pi 의존 없음 | 확인 | chord/package.json 의존은 esbuild뿐. 세부 범위 밖 |
| 18-20 | protocol 869, client 1,135, server 1,958 | 확인(LOC만) | 세부 범위 밖 |
| 21 | codemode 2,597줄, QuickJS(WASM), 주입된 도구만 호출 | 확인 | 5장 |
| 22 | mcp 3,244줄, stdio·Streamable HTTP | 확인 | 6장 |
| 23-25 | env 2,073, telemetry 935, evals 1,446(private) | 확인(LOC, private) | 세부 범위 밖 |
| 27 | pi-web-ui·mom·pods가 현재 모노레포에 없음, Slack은 pi-chat 안내 | 확인 | `packages/` 목록, pi-src `README.md:86`. 0.74.0~0.75.3 배포 이력은 확인 불가 |
| 28 | npm 스코프가 0.74.0(2026-05-07)부터 `@earendil-works/*` | 확인 불가 | CHANGELOG 0.74.0 항목은 비어 있고(ai/CHANGELOG.md:1061) 스코프 변경 기록이 없다. 옛 스코프 언급은 남아 있음 |
| 34 | `createModels()` + `setProvider(xxxProvider())`, provider가 카탈로그·auth·stream 소유, API 구현 공유 | 확인 | ai/src/models.ts:150-242, 992; ai/README.md:239-241 |
| 34 | 내장 provider 약 35개 | **불일치** | `builtinProviders()`는 42개(ai/src/providers/all.ts:136-180). README 목록 줄 수는 35 |
| 34 | 커스텀은 `createProvider({id, auth, models, api})` | 확인 | ai/src/models.ts:996-1041 |
| 35 | `getModel`, `getModels`, `getAvailable`, `refresh()`, `getBuiltinModel()`(`providers/all`), 모델은 plain data, 옛 `getModel`은 compat | 확인 | ai/src/models.ts:250-359, providers/all.ts:62, compat.ts:65, README:1636 |
| 36 | `CredentialStore`(read/list/modify/delete), 기본 InMemory, OAuth refresh는 modify 안에서 직렬화, `transformHeaders` | 확인 | ai/src/auth/types.ts:65-94, models.ts:400, README:428-440, 404-426 |
| 37 | 스트리밍 이벤트 종류, `contentIndex`로 구분, `partial`은 살아 있는 객체 | 확인 | ai/src/types.ts:785-817, README:705, 724 |
| 38 | tool-call·결과 형식, `validateToolCall`, TypeBox, `strict: prefer/require` [types.ts:436] | 확인 | ai/src/types.ts:436-444, 620-637, 739-747, validation.ts:302. 결과에는 `details`, `usage`, `nestedCalls`, `timestamp`도 있음 |
| 39 | transcript 안 system 메시지(sections, toolsAdded/Removed), `getCurrentSystemPrompt/Tools`, 미지원 모델에는 합쳐서 보냄 | 확인 | ai/src/types.ts:531-557, utils/transcript.ts:58-108, README:1601 |
| 40 | `fauxProvider({provider, api, models, tokensPerSecond})`, `setResponses`, 블록 도우미, factory `(context, options, state, model)` | 확인 | ai/src/providers/faux.ts:54-146, 704 |
| 40 | 도구 호출을 실행시키려면 `fauxAssistantMessage(..., { stopReason: "toolUse" })` | **불일치**(agent-core 기준) | agent-core 루프는 stopReason이 `stop`이어도 toolCall을 실행한다(agent-loop.ts:245-272) [실험 A1]. pi-durable 쪽 동작은 이번에 확인하지 않음 |
| 41 | Context JSON 왕복으로 다른 provider로 이어가기 | 확인(원문) | ai/README.md:1603-1636. 실험 exp2는 재실행하지 않음 |
| 41 | thinking→텍스트 변환은 `transform-messages.ts` | 확인 | :95-117. 코드는 `<thinking>` 태그를 붙이지 않음(README:1536과 다름) |
| 41 | 결과 없는 tool call에 `"No result provided"` [원문 :158] | 확인(행 번호만 다름) | 문자열은 :175, 주석은 :155-159 |
| 42 | `AssistantMessageFrameEncoder`, `reduceAssistantMessageFrames()` | 확인 | ai/src/utils/assistant-message-frame.ts:139, 372 |
| 43 | Usage 필드, `AssistantMessage.durationMs`(1.1.0), faux cost 0 | 확인 | ai/src/types.ts:446-467, 595; ai/CHANGELOG.md 1.1.0; faux.ts:281 |
| 44 | stopReason 7종 | 확인 | ai/src/types.ts:469 |
| 50 | agent-core 파일별 줄 수와 의존(pi-ai, typebox) | 확인 | 3.1 |
| 51 | `Agent` 생성 옵션·메서드 목록, 저수준 함수, `runAgentLoopContinue` 5개 인자 | 확인 | agent/src/agent.ts:114-141, 266-384; agent-loop.ts:128-134. 목록에 빠진 옵션: `prepareNextTurn`, `prepareNextTurnWithContext`, `onPayload`, `onResponse`, `onProviderStreamEvent`, `thinkingBudgets`, `transport`, `maxRetryDelayMs` |
| 52 | 기본 parallel, preflight 순차·실행 동시·결과 원래 순서, 도구별 sequential, 단계 순서 [agent-loop.ts:720-860] | 확인 | agent-loop.ts:508-660, 694-910 [실험 A1]. 보충: sequential 도구가 하나라도 있으면 배치 전체가 순차(:516-521) |
| 53 | 이벤트 종류, subscribe 리스너 await, assistant `message_end` 처리 후 preflight, 저수준 스트림은 관찰만 | 확인 | agent/src/types.ts:516-539, agent.ts:605-611, README:560 [실험 A1] |
| 54 | 상태(messages, tools, model, thinkingLevel), 시스템 프롬프트는 system 메시지로 재생 | 확인 | agent/src/types.ts:382-421, agent.ts:89-91 |
| 55 | 영속화·세션·컴팩션 등 미제공, 1.0.0에서 제거, `replay`는 타입에만 | 확인 | agent/CHANGELOG.md:21-25; grep 결과 `replay`는 types.ts:490 한 곳 |
| 56 | block → `isError:true` + 사유, block 시 `afterToolCall` 미호출 | 확인 | [실험 A1 3번] |
| 56 | `state.messages` JSON 왕복 후 새 `Agent`에서 이어서 실행 | 확인(원문) / 실험 미재실행 | `initialState.messages`를 그대로 받음(agent.ts:82-86) |
| 56 | `prepareRequest`로 매 요청 직전 컨텍스트 재구성 | 확인 | agent-loop.ts:219-239 [실험 A1 6번]. 주의: 넘긴 배열을 루프가 이후 변경(0장 3번) |
| 56 | `beforeToolCall`의 `args`가 `execute`에 그대로 전달, mutate 반영, agent-core 문서 계약 아님 | 확인 | [실험 A1 1번]. 보충: `args`는 `structuredClone` 복사본이라 transcript의 인자는 그대로 남는다. coding-agent는 이 동작을 `tool_call`의 공식 계약으로 쓴다(extensions/types.ts:1427) |
| 62 | `createAgentSession({cwd, agentDir, model, modelRuntime, settingsManager, sessionManager, resourceLoader, tools, customTools})`, AgentSession 4,398줄, `AgentSessionRuntime`(newSession, switchSession, fork, importFromJsonl), `SessionManager.create/open/inMemory`, `SettingsManager.inMemory`, `DefaultResourceLoader`(extensionFactories), SessionManager 생성자 private | 확인 | sdk.ts:48-106; agent-session-runtime.ts:74-420; session-manager.ts:1000, 1755-1818; settings-manager.ts:357; resource-loader.ts:285. `tools`는 도구 이름 배열(`string[]`) |
| 63 | SDK 실험 exp3(faux, `ModelRuntime.create({credentials, modelsPath:null, allowModelNetwork:false})`, 인라인 확장으로 bash block·read 경로 수정, `agent_settled`에서 `appendEntry`, `SessionManager.open()` 재개) | 확인(API 존재) / 실험 미재실행 | model-runtime.ts:100-120(credentials, modelsPath, allowModelNetwork 옵션), 216 |
| 64 | `create*Tool(cwd)`가 순수 `AgentTool`, 세션 없이 agent-core와 조합 | 확인 | tools/index.ts, tool-definition-wrapper.ts:8-30 [실험 A2] |
| 64 | `*Operations`로 파일·프로세스 접근 교체 | 부분 일치 | read/write/edit/bash/find/ls는 교체 가능. grep은 `isDirectory`/`readFile`만 교체되고 `rg`는 항상 로컬 실행(grep.ts:53-58, 119-168) |
| 64 | 패키지 루트 import 시 coding-agent 전체(tui, chord, codemode, mcp, photon 등)가 의존성으로 따라옴 | 부분 일치 | 설치 의존으로는 맞다. 실제 로드는 pi-tui, codemode, mcp 등 33개이고 chord와 photon은 로드되지 않았다 [실험 A2] |
| 65 | 확장 API 메서드 목록, 이벤트 40여 개, 이벤트 이름들, `tool_call`(block 또는 `event.input` mutate), `ctx.ui`, `ctx.executeTool`, exposure 5종, types.ts 2,273줄 | 확인 | extensions/types.ts:1564-1890(이벤트 41종), 383-395, 500-516, 1426-1428 |
| 65 | `agent_before_settle`(entry 추가 후 `continue:true`) | 확인 | `BoundaryResult { entries?, continue? }`(types.ts:994-1002, 1420) |
| 66 | 모드 4종, RPC 명령 약 33개, `RpcClient` export, 확장 UI dialog는 RPC로 전달·커스텀 컴포넌트 미전달 | 확인 | rpc-types.ts(33종), index.ts:421, docs/rpc-extension-ui.md:14-25 |
| 66 | RPC는 프로세스 하나에 클라이언트 하나 | 확인 불가 | 그런 문장은 문서에 없다. stdin/stdout JSONL 한 쌍이라는 구조(docs/rpc.md:1-15)에서 나오는 추론이다 |
| 67 | CLI는 codemode·tool_search·MCP를 내장 확장으로, SDK는 `create*Extension()`을 `extensionFactories`에 | 확인 | extensions/codemode/index.ts:1-6, index.ts:407-411 |
| 67 | codemode 안의 도구 호출은 `ctx.executeTool`로 훅 적용, 기본 codemode에서 채팅 모델 하위 호출 불가, 변수는 스크립트 1회 수명 | 확인 | 5.4-5.6 [실험 A2] |
| 68 | 세션 파일 위치, version 3, id/parentId 트리, fork/clone 새 파일, 엔트리 종류 11개, `appendFileSync`·fsync/락 없음 [1170-1187], 스트리밍·실행 중 도구 미저장 | 확인 | 4.7. 실제 행은 1172-1189. 보충: 첫 user/assistant 메시지 전에는 파일을 만들지 않음 |
| 69 | experimental durable 설명(세션별 sqlite, 락 10초, subagent, task graph, 없는 기능 목록, source-resolver로만 실행) | 확인 | src/experimental/durable/README.md |
| 70 | `PI_EXPERIMENTAL=1 ./pi-test.sh server` / `client`, 세션마다 worker가 `session.sqlite`에 Harness, Chord 서비스 목록, Unix 소켓·Radius relay, TODO 3개, npm 제외 | 확인(coding-agent 쪽) | services/README.md:8-9, 14-24, 38-45; session-worker.ts:15, 796-810; radius-relay.ts:7-8. 서비스 이름 `SessionDirectory`, `SessionManagement`, `AgentController`, `Transcript`, `Models`, `SlashCommands` 모두 표에 있음. 프로토콜·소켓 세부는 범위 밖 |
| 76-78 | pi-tui 모델, coding-agent가 `AssistantMessageComponent` 등 export, 화면 조립 코드 미export | 범위 밖(일부 확인) | `AssistantMessageComponent`, `ToolExecutionComponent`는 index.ts:435, 464에서 export 확인 |
| 84 | durable은 agent-core 미사용, 의존 pi-ai·chord, generation 690·tool 892·scheduler 1,897줄, 내장 도구는 ExecutionEnv 위 read/write/edit/bash/powershell, grep/find/ls 없음 | 확인 | 1.3, 7.1. powershell은 `createPowerShellTool()`로 따로 추가 |
| 85 | `Harness.open(storage, {models, registry, settings, env})`, `root()`, 엔트리 kind, `defineDoc`, `defineTask`, `requestId` 멱등, inbox, 원자 커밋 라인 | 확인 | harness.ts:445-470, types.ts:552-571, spec.md:3557-3577(엔트리 kind에 `pi.reset`도 있음), 6장 |
| 86 | `defineExtension({name, tools, sections, hooks, wraps, tasks})`, `defineTool({parameters, execute(args, api, ctx), replay, callers, structuredOutputSchema})`, 훅 이름, wrapTool은 wraps | 확인 | harness/types.ts:285-320, 352-361, 731-786; README:200-207 |
| 86 | HookApi는 읽기 전용 | 부분 일치 | 커밋된 읽기 외에 task memo 후보 쓰기(`memo(name, candidate)`)가 있다(types.ts:718-726) |
| 87 | 스토리지 4종, SQLite WAL·`synchronous=NORMAL`, JSONL `fsync` 옵션, conformance, 한 프로세스 소유·락 없음 | 확인 | storage/sqlite/node.ts:187-192, spec.md:4914-4965, README:621-640 |
| 88 | 크래시 복구 실험 exp4와 `interrupted` 진단 문구 | 확인(문구) / 실험 미재실행 | harness/tool.ts:182-195 |
| 89 | `viewState()`/`watch()`, 100 frame 초과 시 전체 view, 늦은 클라이언트는 현재 view부터, `watchEvents()` experimental, 네트워크 transport 없음 | 확인 | session/observation.ts:16, 229; README:354-380, 446-453; src에 WebSocket·서버 코드 없음 |
| 90 | spec.md 5,123줄 "Pico5", 5.2 effect sandwich | 확인 | 7.2-7.3 |
| 91 | 2026-09-19 0.0.1, npm 14개 버전 | 확인 불가 | durable CHANGELOG는 1.0.0부터, git 이력은 2026-10-06부터 |
| 91 | "Experimental. The API changes without notice", Unreleased Breaking 5개와 내용, `pi.tool` v2 | 확인 | durable/CHANGELOG.md:3-12 |
| 107 | 모든 패키지 같은 버전, 1.0.0은 2026-10-01 | 확인 | agent/CHANGELOG.md:21 |
| 107 | 0.74.0~1.1.0 npm 58개 버전 | 확인 불가 | agent CHANGELOG 헤더는 두 끝 포함 59개 |
| 108 | `### Breaking Changes` 절, semver 보장 문구 없음 | 확인 | CHANGELOG들. "semver" 보장 문구 찾지 못함 |
| 108 | patch 릴리스에도 breaking: pi-ai 1.0.3 Azure 이름 변경, 1.1.0 stream 반환 타입, agent-core 0.87.0 `shouldStopAfterTurn` 제거 | **부분 불일치** | 세 항목 모두 Breaking 절에 있다(ai/CHANGELOG.md:51, 1.1.0 :11-13, agent/CHANGELOG.md:42-46). 그러나 patch 릴리스는 1.0.3뿐이고 1.1.0과 0.87.0은 minor 릴리스다 |
| 109 | Breaking 절 수 coding-agent 49, pi-ai 27, agent-core 13 | 확인 | coding-agent는 Unreleased 포함 50, 릴리스 49 |
| 115-119 | 선택지 표의 pi 기능 서술 | 확인 | 위 행들과 같은 근거. (e) "100ms partial 커밋, 실행 전 intent 커밋, interrupted, `replay:"safe"`"는 7.3 |
| 121-125 | (c) 커널 구성 예 4단계 | 확인 | [실험 A1 2, 3, 6번]. 3단계의 "block 기록은 toolResult에서 처리"도 맞다(block된 호출은 `afterToolCall` 없음) |
| 129-136 | 사례(OpenClaw, Happy Agent, Paseo, pi-web, Assembly Line, Absurd, pi-fabric, Cloudflare) | 범위 밖 | `pi-cases-notes.md` |
| 137 | pi에는 권한 시스템이 없음, README는 Gondolin VM·Docker·OpenShell 격리 안내 | 확인 | pi-src `README.md:88-96`, coding-agent/docs/security.md:3 |

### 8.2 `docs/v0.3/audit/pi-runtime-options.md`

8.1과 겹치는 주장은 같은 판정이다. pi 소스로 판정할 수 있는 주장만 적는다.

| 행 | 주장 | 판정 | 근거·실제 |
|---|---|---|---|
| 4 | 커밋 `cdaf6c2`, npm 1.1.0(2026-10-07) | 확인 | 1.1.0 날짜는 CHANGELOG 헤더 |
| 26-28 | pi에는 권한 시스템이 없고 README는 격리를 안내 | 확인 | pi-src `README.md:88-96` |
| 31 | OpenClaw·Happy Agent가 pi 런타임을 걷어냄 | 범위 밖 | 사례 자료 |
| 33 | 핵심 패키지 5개월 58개 버전(주당 약 2.7회) | 확인 불가 | npm 기록 |
| 34 | 1.0 이후 patch에도 breaking, Breaking 절 수 49/27/13 | 부분 일치 | 절 수는 확인. 1.0 이후 patch breaking 사례는 pi-ai 1.0.3 하나(8.1 행 108) |
| 35 | pi-durable, pi-server/client/protocol은 experimental | 확인(durable) / 범위 밖(나머지) | durable/README.md:3 |
| 43-54 | 패키지 지도 표 LOC·역할 | 확인 | 1.1. codemode·mcp는 pi 의존이 없어 독립 사용 가능 |
| 57 | pi-durable은 agent-core를 쓰지 않고 내장 도구는 read/write/edit/bash뿐, coding-agent 확장은 pi-durable 위에서 동작 안 함 | 부분 일치 | agent-core 미사용·확장 비호환은 확인. 내장 도구에 `createPowerShellTool()`도 있다(durable/src/tools/index.ts:26-39) |
| 58 | coding-agent 도구는 세션 없이 사용 가능, `*Operations`로 교체 가능 [실험], 루트 import 시 전체 의존성 | 부분 일치 | 8.1 행 64와 같음(grep의 rg는 교체 불가, 실제 로드는 33개 패키지) |
| 59 | agent-core만으로 커널 검사: block → 오류 결과, block 시 `afterToolCall` 없음, subscribe await로 커밋 후 도구 시작, `prepareRequest`로 컨텍스트 재구성 [실험] | 확인 | [실험 A1] |
| 60 | 세션 JSONL은 확정 메시지마다 append, fsync·락 없음, 스트리밍·실행 중 도구 상태 없음 | 확인 | 4.7 |
| 61 | `pi server`/`pi client`는 세션마다 worker가 pi-durable을 엶, npm 배포물에 없고 소스로만 | 확인 | 8.1 행 70 |
| 89-90 | 안 1: `tool_call` 검사, `registerTool`, `appendEntry` 기록, 세션 재열기 [실험] | 확인(API) / 실험 미재실행 | extensions/types.ts:1633, 1643, 1719 |
| 103 | AgentSession 4,398줄 | 확인 | |
| 114-118 | 안 3 부품: `createModels`, faux, `Agent`, `create*Tool`, `*Operations`, pi-tui 메시지 컴포넌트 | 확인(pi-tui 렌더링 실험은 범위 밖) | 2-4장 |
| 120-124 | 커널 끼우는 지점 4개 [실험] | 확인 | [실험 A1]. 보충은 0장 1-4번 |
| 128 | agent-core 2,519줄, Breaking 13회 | 확인 | |
| 131 | pi-durable 명세 5.2 "실행 의도 → 실행 → 결과" | 확인 | spec.md:1917-1933 |
| 143-146 | 안 4: `defineTool`, `hook(ToolTask, {beforeTool})`, `defineDoc`·사용자 entry를 같은 트랜잭션에, `requestId`, inbox, 하위 태스크, 컴팩션, `watch()`, 크래시 실험 | 확인(원문) / 실험 미재실행 | 7장 |
| 149 | Unreleased Breaking 5개 | 확인 | durable/CHANGELOG.md:5-12 |
| 150 | 저장소 하나에 프로세스 하나 | 확인 | durable/README.md:623 |
| 151 | coding-agent 도구·확장과 호환 안 됨, grep/find/ls 직접 만들어야 함 | 확인 | 도구 타입이 다름(`ToolRegistration` vs `AgentTool`/`ToolDefinition`) |
| 152 | 사람 승인 대기 상태가 없다 | 확인 | 7.6 |
| 153 | 늦게 붙은 클라이언트에 이력을 다시 보내 주지 않는다 | 확인 | durable/README.md:380 |
| 154 | 커널 확장을 기본 확장 목록에 고정하지 않으면 검사 없이 실행될 수 있다(명세에 명시된 사항) | **부분 불일치** | 명세에 그런 경고 문장은 없다. 명세는 훅이 확장을 선택한 conversation에만 적용되고(README:481), conversation이 확장 목록을 배열로 지정하면 정확히 그 목록만 쓰며, 설치되지 않은 이름은 조용히 건너뛴다고 적는다(spec.md:735-760). 주장의 위험 자체는 이 규칙에서 나오는 추론이다 |
| 164-166 | 안 5: pi CLI는 `--mode rpc` + 주입 확장의 `tool_call` | 확인(pi 쪽) | Claude Code·Codex 항목은 범위 밖 |
| 172 | RPC 스트림에 없는 정보(엔트리 id 등)는 주입 확장으로 따로 보내야 함 | 부분 일치 | RPC 이벤트는 agent 이벤트라 엔트리 id가 없다. 다만 `get_entries`, `get_fork_messages`(엔트리 id 포함, rpc-types.ts:207) 명령으로 조회할 수 있다 |
| 182 | 안 6: npm 배포물에 없고, 트리 탐색·하위 에이전트·transcript 페이징 TODO | 확인 | services/README.md:12, 38-45. 피어 인증은 범위 밖 |
| 226 | 남은 확인: 도구 팩토리용 하위 경로 export가 있는지 | 확인(없음) | package.json exports는 `.`, `./rpc-entry`, `./client`, `./experimental/plugin`뿐 |
| 227 | `beforeToolCall` 인자 수정은 문서화된 계약이 아님 | 확인(agent-core) | coding-agent 쪽에서는 문서화된 계약(extensions/types.ts:1427) |

불일치·부분 불일치로 판정한 주장 요약:

1. pi-layer-analysis 행 34: 내장 provider "약 35개" → 실제 42개.
2. pi-layer-analysis 행 40: faux로 도구를 실행하려면 `stopReason: "toolUse"` 필요 → agent-core는 stopReason과 무관하게 실행.
3. pi-layer-analysis 행 108(= pi-runtime-options 행 34): "patch 릴리스에도 breaking" 예 3개 중 patch는 pi-ai 1.0.3뿐, 1.1.0·0.87.0은 minor.
4. pi-runtime-options 행 154: "명세에 명시된 사항" → 명세에 그런 문장은 없고 확장 선택 규칙에서 나오는 추론.
5. 부분 일치(표현 보정): `*Operations`로 grep 교체(rg는 로컬 고정), 루트 import 시 로드 범위(chord·photon 미로드), HookApi 읽기 전용(memo 쓰기 있음), durable 내장 도구(powershell 추가 가능), RPC 엔트리 id(조회 명령 있음), "No result provided" 행 번호(158 → 175), 세션 `_persist` 행 번호(1170-1187 → 1172-1189).

## 9. Helm 포크 관점 메모 [후보]

결정은 P4(`07-pi-reuse-and-fork.md`)가 한다. 아래는 소스 확인에서 나온 후보와 이유다. "그대로"는 파일을 수정 없이 vendor하거나 정확한 버전으로 고정 의존하는 것, "고쳐 쓰기"는 가져와 수정하는 것, "참고"는 설계·알고리즘만 읽고 코드는 가져오지 않는 것이다.

### 9.1 패키지·파일별 후보

| 패키지 | 파일·영역 | 후보 | 이유 |
|---|---|---|---|
| pi-ai | `types.ts`, `models.ts`, `utils/{event-stream,validation,transcript,assistant-message-frame,retry,overflow,json-parse,typebox-helpers}.ts`, `api/transform-messages.ts`, `api/lazy.ts` | 그대로 | 메시지·스트림 계약이 agent-core와 durable 모두의 기반이다. Helm 고유 로직이 들어갈 자리가 아니다 |
| pi-ai | `api/*`(와이어 구현 13,186줄)와 사용할 provider 팩토리(`providers/anthropic.ts`, `openai.ts` 등) | 그대로(필요한 것만) | 양이 많고 provider 변경을 따라가야 하는 부분이다. `providers/all.ts`(42개 전부) 대신 필요한 팩토리만 등록 |
| pi-ai | `providers/faux.ts` | 고쳐 쓰기(작게) | 테스트 재생에 쓴다. `api` 기본값이 실행마다 임의 문자열(faux.ts:455)이라 같은 모델 판정·스냅숏 테스트가 흔들릴 수 있다. 고정 `api`를 넘기거나 기본값 수정 |
| pi-ai | `auth/credential-store.ts`, `auth/types.ts` | 고쳐 쓰기 | `CredentialStore`를 Helm 비밀 저장 방식(데몬 쪽)으로 구현해 주입 |
| pi-ai | `compat.ts`, OAuth 구현(`auth/oauth/*`), 이미지·분류기 API | 참고 | 옛 전역 API는 불필요. 구독형 OAuth와 분류기·이미지 생성은 필요할 때 다시 본다 |
| pi-agent-core | `agent-loop.ts`, `types.ts`, `agent.ts` | 고쳐 쓰기(결정 28) | 고칠 후보: (1) `prepareRequest`가 준 배열을 루프가 변경하는 동작을 복사로 바꾸거나 Helm 규약으로 명시(0장 3번), (2) `tool_execution_start`에 훅 이후 실제 실행 인자도 싣기(현재는 검증 전 인자, 3.6), (3) `structuredContent`를 결과 메시지나 이벤트에 보존(0장 4번), (4) `replay` 필드를 복구 경로에서 사용하거나 제거(0장 13번), (5) `beforeToolCall`의 인자 변경을 계약으로 명시(0장 1번) |
| pi-agent-core | `proxy.ts`, `stream-fn.ts`(전역 기본 streamFn) | 참고 또는 제거 | 데몬이 provider를 직접 부르므로 proxy가 필요 없을 수 있다. 전역 기본값은 테스트 간 상태 공유를 만든다 |
| coding-agent | `core/tools/{read,write,edit,bash,grep,find,ls}.ts`, `edit-diff.ts`, `truncate.ts`, `file-mutation-queue.ts`, `path-utils.ts`, `output-accumulator.ts` | 고쳐 쓰기 | 도구 동작(잘림, 이어 읽기 안내, 편집 매칭, 프로세스 트리 종료)은 재사용 가치가 크다. 렌더러·`ExtensionContext`·`config.ts` 의존을 끊어야 한다(9.2). 범위 검사 지점을 넣을 수 있도록 Operations 주입을 유지 |
| coding-agent | `utils/{shell,child-process,paths,mime}.ts`, `utils/image-process.ts` | 고쳐 쓰기(일부 함수만) | 도구가 쓰는 함수만 옮긴다. image-process는 photon WASM 의존 |
| coding-agent | `utils/tools-manager.ts` | 고쳐 쓰기 또는 제거 | 실행 중 rg/fd 자동 다운로드(0장 7번)는 데몬에서 원치 않을 수 있다. 설치 전제 + 없으면 명확한 오류 |
| coding-agent | `core/tools/powershell.ts` | 제외 | Helm은 WSL에서 실행(결정 20) |
| coding-agent | `core/session-manager.ts`, `docs/session-format.md` | 참고 | 트리, `context_edit`(원본 보존 + 모델 컨텍스트만 편집), compaction 체크포인트(`systemMessage`) 개념. 기준 원본은 Helm 로그(결정 29) |
| coding-agent | `core/compaction/*` | 참고(요약 프롬프트·serialize는 가져올 수 있음) | `session-manager.ts`와 `pi-ai/compat`에 묶여 있다. 자르는 지점 규칙, split turn, 파일 추적, 요약 형식은 Helm 컴팩션 설계 입력 |
| coding-agent | `core/system-prompt.ts` | 참고 | 이름 붙은 절과 diff 패치 방식은 Helm 투영의 시스템 프롬프트 구성 참고 |
| coding-agent | `core/extensions/types.ts`(`ToolExposure`, `ToolAnnotations`, `executeTool`), `core/agent-session.ts` 훅 배선 | 참고 | 노출 단계, 중첩 호출에 훅을 적용하는 방식(`runToolCall`)의 실제 예 |
| coding-agent | `modes/rpc/*`(`RpcClient`, `rpc-types.ts`) | 고정 의존 후보(어댑터 단계) | pi CLI 런타임 어댑터(결정 33·34)를 만들 때 프로토콜 정의로 쓴다 |
| coding-agent | `extensions/codemode/*`, `extensions/mcp/*` | 참고 | store를 세션 엔트리로 남기는 방식, MCP 이름 규칙·결과 스키마·큰 텍스트 처리 |
| pi-codemode | 패키지 전체 | 그대로 | pi 의존이 없고 외부 의존은 `quickjs-wasi` 하나다. Helm REPL 탐구는 globals로 확장(하위 LLM 호출 함수 등)할 수 있어 수정이 필요 없을 가능성이 크다. `store`는 Helm 이벤트 로그에 기록 |
| pi-mcp | 패키지 전체 | 그대로 | pi 의존 없음, 외부 의존 `cross-spawn` 하나. `LICENSES/` 고지 유지. `outputSchema` 검증이 필요하면 Helm 도구 래퍼에서 |
| pi-durable | `docs/spec.md` 2.1, 5.1-5.5, 6, 7.3, 8.3, 8.4, 10, 11 | 참고(결정 29·30) | 의도·실행·결과 기록, replay safe/unsafe, interrupted 결과, running→pending 재조정, `requestId` 멱등, 소유 트리와 abort 전파, 컨텍스트 유도 10단계, JSONL publication 순서 |
| pi-durable | `storage/sqlite/migrations.ts`, `storage/sqlite/node.ts` | 참고 | 레코드 JSON 컬럼 + 조회 컬럼 + revisions 테이블 구조, WAL·`synchronous=NORMAL`. Helm은 `better-sqlite3`(결정 36)라 어댑터는 다르다 |
| pi-durable | `tools/*`, `env/*`(`ExecutionEnv` = `FileSystem` + `Shell`) | 참고 | 도구가 파일·프로세스를 환경 객체로만 접근하는 구조는 격리(컨테이너·원격) 설계에 쓸 수 있다 |
| pi-durable | 나머지(`harness/*`, `session/*`) | 참고 | chord 의존이 깊고(63곳) experimental이다 |

### 9.2 포크 시 끊어야 할 내부 의존

| 가져오는 것 | 끊을 의존 | 위치 | 대체 후보 |
|---|---|---|---|
| pi-ai | `@earendil-works/pi-telemetry`(타입 `TelemetryContext`) | ai/src/types.ts:1, api/simple-options.ts | 로컬 타입 정의 또는 필드 제거 |
| pi-ai | `providers/all.ts`가 모든 provider와 생성 카탈로그를 import | ai/src/providers/all.ts:1-46 | 필요한 provider 팩토리만 직접 등록 |
| pi-agent-core | 없음(pi-ai만) | | |
| coding-agent 도구 | `./renderers/*` → `@earendil-works/pi-tui`, `modes/interactive/{theme,components}` | core/tools/*.ts의 `...xxxRenderers` 전개, renderers/*.ts:9-18 | 렌더러 전개 줄 삭제. TUI 렌더링은 Helm 클라이언트가 결과 JSON으로 |
| coding-agent 도구 | `../extensions/types.ts`(`ToolDefinition`, `ExtensionContext`) | 각 도구 파일 import | `AgentTool`을 직접 반환하고 ctx 대신 Helm 도구 컨텍스트(cwd, model, 범위 검사기) |
| coding-agent 도구 | `config.ts`(`getBinDir`, `APP_NAME`) | utils/shell.ts:4, utils/tools-manager.ts:7 | Helm 설정 경로 |
| coding-agent 도구 | `utils/tools-manager.ts`(다운로드) | grep.ts:7, find.ts:6 | 설치된 rg/fd 경로 해석만 |
| coding-agent 도구 | `PI_*` 환경 변수 주입 | bash.ts:186-212 | `exposeSessionEnvironment: false`로 끄거나 Helm 변수로 교체 |
| coding-agent 컴팩션 | `session-manager.ts`, `@earendil-works/pi-ai/compat`(`completeSimple`) | compaction.ts:9-45, 632-635 | Helm 로그 투영 타입, `Models.completeSimple` |
| pi-codemode | 없음 | | |
| pi-mcp | 없음 | | |
| pi-durable(코드 차용 시) | `@earendil-works/chord` 전반 | 63곳 | 차용하지 않고 설계만 참고 |

### 9.3 P4·P7·V6에 넘길 확인 사항

1. agent-core 포크에서 0장 1-4번의 동작을 유지할지 바꿀지. 커널은 "모델이 낸 인자"와 "실행된 인자"를 둘 다 기록해야 한다(transcript에는 원래 인자만 남는다).
2. 순차 모드 abort 시 결과 메시지가 없는 호출이 생긴다(3.10). 크래시 복구(결정 30)의 "중단됨" 정리와 같은 경로로 처리할지.
3. coding-agent 도구를 가져올 때 경로 범위 검사를 Operations 주입으로 할지, `beforeToolCall`에서 할지. bash는 명령 문자열이라 경로 검사로 범위를 지킬 수 없다(13 문서 과제).
4. pi-codemode store·출력을 Helm 이벤트 로그에 어떤 레코드로 남길지. 스크립트 안의 중첩 도구 호출에 커널 검사를 적용하려면 `runToolCall()` 경로를 써야 한다(5.5).
5. pi-ai provider 코드를 vendor할지 정확한 버전으로 고정 의존할지. CHANGELOG에 minor·patch에서도 Breaking 절이 있다(1.4, 8.1 행 108).

## 10. 실험 기록

모두 `.helm-design-work/S3a/`에 있다. `node_modules`는 `experiments/pi-lab/node_modules`(npm 1.1.0)로의 심볼릭 링크다.

| 실험 | 파일 | 확인한 것 |
|---|---|---|
| A1 | `exp-a1-agent-core.mjs`, 출력 `exp-a1.out.txt` | (1) `beforeToolCall` args 변경이 execute에 반영, transcript 인자는 원래 값, args는 `toolCall.arguments`와 다른 객체, 결과 메시지에 `structuredContent` 없음, 기본 stopReason `stop`에서도 도구 실행 (2) subscribe 리스너 await 후 도구 실행 (3) block 결과 텍스트, block·throw 시 `afterToolCall` 미호출, 훅 throw → 오류 결과 (4) 병렬 실행 순서 (5) `length` → 실행 안 함 (6) `prepareRequest` 교체 컨텍스트가 provider에 전달 (7) 이벤트 순서 (8) steer 메시지가 다음 요청에 포함 |
| A2 | `exp-a2-tools-codemode.mjs`, 출력 `exp-a2.out.txt` (`PI_OFFLINE=1`로 실행) | 루트 import 시 로드 패키지 33개와 시간(634ms), read 잘림 안내, cwd 밖 읽기 가능, bash 0 아닌 종료코드 → `isError` + structuredContent, 타임아웃 throw, ctx 없는 bash의 `PI_SESSION_ID` 빈 값, edit 성공 결과·patch, 매칭 실패 throw, codemode 변수 1회 수명과 호출자 관리 store |

## 11. 출처

- pi 저장소 `~/projects/_ref/pi-src` 커밋 `cdaf6c2`
  - 루트: `README.md`, `LICENSE`, `pi-test.sh`
  - `packages/ai/`: `package.json`, `README.md`, `CHANGELOG.md`, `src/index.ts`, `src/types.ts`, `src/models.ts`, `src/compat.ts`, `src/auth/types.ts`, `src/providers/{all,anthropic,faux,model-schema}.ts`, `src/api/{transform-messages,simple-options}.ts`, `src/utils/{event-stream,validation,transcript,assistant-message-frame,retry,overflow}.ts`
  - `packages/agent/`: `package.json`, `README.md`, `CHANGELOG.md`, `src/{index,types,agent,agent-loop,proxy,stream-fn}.ts`
  - `packages/coding-agent/`: `package.json`, `docs/{session-format,compaction,rpc,rpc-extension-ui,codemode,settings,security}.md`, `src/index.ts`, `src/config.ts`, `src/core/{agent-session,agent-session-runtime,sdk,session-manager,system-prompt,model-runtime,settings-manager,resource-loader}.ts`, `src/core/tools/*.ts`, `src/core/tools/renderers/*.ts`, `src/core/extensions/types.ts`, `src/core/compaction/{compaction,utils}.ts`, `src/utils/{paths,shell,tools-manager}.ts`, `src/extensions/codemode/{index,tool,execute}.ts`, `src/extensions/mcp/{index,tools}.ts`, `src/modes/rpc/rpc-types.ts`, `src/experimental/durable/README.md`, `src/experimental/services/README.md`, `src/experimental/{session-worker,radius-relay}.ts`
  - `packages/codemode/`: `package.json`, `README.md`, `src/index.ts`, `src/types.ts`, `src/runtime/{host,prelude-source}.ts`
  - `packages/mcp/`: `package.json`, `README.md`, `LICENSES/modelcontextprotocol-typescript-sdk.txt`, `src/index.ts`, `src/client.ts`, `src/protocol/{types,content}.ts`
  - `packages/durable/`: `package.json`, `README.md`, `CHANGELOG.md`, `docs/spec.md`, `src/index.ts`, `src/harness/{harness,types,tool,define}.ts`, `src/storage/sqlite/{migrations,node}.ts`, `src/session/observation.ts`, `src/tools/index.ts`
  - `packages/chord/package.json`(의존 확인만)
- 대조 대상: `docs/design/process/sources/pi-layer-analysis.md`, `docs/v0.3/audit/pi-runtime-options.md`
- 실험: `.helm-design-work/S3a/` (10장)

<!-- 0단계 완료 -->
