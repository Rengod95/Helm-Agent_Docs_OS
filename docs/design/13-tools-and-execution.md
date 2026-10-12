# 13. 도구와 실행

- 작성: P7 런타임, 2026-10-11 (1단계 초안)
- 상태: 설계 초안. 2단계 통합에서 06·07·10·12·14·15·18과 이름을 맞춘다.
- 함께 읽을 문서: `process/00-design-brief.md`(이하 "브리프"), [12 런타임 엔진](12-runtime-engine.md), [10 커널](10-kernel.md), [14 루프·모드·오케스트레이션](14-loops-modes-orchestration.md), [15 탐구 엔진](15-inquiry-engine.md), [06 시스템 아키텍처](06-system-architecture.md)
- 표시 규칙과 출처 줄임말은 12의 머리말과 같다. `P7/`은 `.helm-design-work/P7/`(이 문서의 실험)이다.

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

구현자가 이 문서와 12만 보고 `@helm/tools`와 `@helm/runtime/adapter`를 만들 수 있게 하는 것이 목적이다.

1. 도구 모델(`HelmToolSpec`): 원시 행동, replay, 취소 등급, 노출, 경로 접근 선언 (§3.1)
2. 도구 등록과 노출(도구 묶음): 루프·WorkUnit별로 모델에게 줄 도구를 정하는 규칙 (§3.2)
3. 기본 도구: coding-agent 도구 포크(`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`)의 입력 스키마, 출력, 잘림, replay, 경로 정책 (§3.3)
4. 자원 URI 문법과 경로 정책: 정규화, 심볼릭 링크, 가림 목록 (§3.4) — 10 §3.6.6이 이 문서에 맡긴 것
5. 쓰기 범위 검사와 bash·execute 우회 방지: 위협, 방법 비교와 선택, 변경 감지 (§3.5)
6. 격리: WSL에서 쓸 수 있는 방법, 선택, 네트워크 제한, 비밀 노출 방지 (§3.6)
7. Helm 제안 도구(모델이 커널에 제안을 내는 typed 도구) (§3.7)
8. 하위 호출 도구와 REPL(codemode) 교정 (§3.8)
9. MCP 도구 연결 (§3.9)
10. 권한 레이어 호출 지점 (§3.10)
11. 런타임 어댑터 인터페이스: 능력 목록, 보장 수준, 중립 이벤트 어휘, 런타임별 한계, 낮춰 동작하는 규칙, 적합성 시험 (§3.11)

### 1.2 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 루프 훅에서 도구를 부르는 순서, 의도·결과 기록, 크래시 복구 판정 | 12 |
| 명령 페이로드 스키마, 범위 판정 함수 `covers`, 거부 코드 | 10 |
| 권한 레이어의 판정 규칙(가역성·권리 범주 분류) 자체 | 18 (결정 2). 이 문서는 호출 지점과 1차 기본 규칙만 제안한다(§3.10) |
| 위협 모델 전체, 비밀 저장, 기기 인증 | 18 |
| 루프별 제안 종류·능력 부분집합 | 14 |
| REPL 방식 탐구의 의미(무엇을 스크립트로 하는가) | 15 |
| pi 소스를 vendor할지, 파일 단위 포크 계획 | 07 |
| `bwrap` 설치·데몬 환경 준비 | 17 |

### 1.3 용어

| 용어 | 뜻 |
|---|---|
| 원시 행동 | read, write, execute, send, spawn, ask (결정 4, 10 §3.6.2 `PrimitiveAction`) |
| 도구 묶음(loadout) | 한 run의 한 요청에서 모델에게 선언하는 도구 집합 |
| 쓰기 가능 루트 | 샌드박스 안에서 bash가 쓸 수 있는 디렉터리. 합의 범위에서 계산한다(§3.5.3) |
| 샌드박스 수준 | S0(격리 없음), S1(bubblewrap 마운트 격리), S2(오버레이 스테이징, 이후 단계) (§3.6) |
| 보장 수준 | `enforced`(실행 전 차단), `detected`(실행 뒤 감지), `advisory`(지시문뿐), `unavailable` (10 §3.18의 `pre` / `post_hoc` / `advisory`와 대응) |

## 2. 전제와 결정

### 2.1 브리프 결정과 이 문서의 귀결

| 결정 | 내용 | 귀결 |
|---|---|---|
| 2 | effect class와 가역성 판별은 Helm 범위가 아니다(권한 레이어) | 도구는 원시 행동과 대상만 선언한다. 위험 등급은 권한 레이어 판정(`PermissionVerdict`, 10 §3.6.5)으로 받는다 |
| 4 | 능력 = 원시 행동 + 기록 능력 | 도구마다 원시 행동 하나. Helm 제안 도구는 기록 능력 `propose`(원시 행동 없음) |
| 14 | 모델은 제안하고 커널이 상태를 바꾼다 | 모델용 도구에 사람 권한 명령(결과 확인, 합의 확정, 선택 확정, 답, 이의, 정책 변경)은 없다(§3.7.4) |
| 15(1) | write·send에는 작업 합의 필요 | 쓰기 범위는 합의의 `ScopeSpec`에서 계산하고 실행 전에 강제한다(§3.5) |
| 23, 28 | 자체 런타임, coding-agent 도구 활용 | coding-agent 도구 파일을 포크해 렌더러·확장 의존을 끊고 `Operations` 주입을 유지한다(§3.3) |
| 34 | 런타임 어댑터 인터페이스를 지금 정의, 훅·권한 콜백의 한계 포함 | §3.11 |
| §2.5 | WSL2 Ubuntu 24.04, 비밀은 SOPS → 데몬 환경 | 도구 자식 프로세스에 비밀을 넘기지 않는다(§3.6.4) |

### 2.2 원천에서 가져온 사실

| 사실 | 확인 | 이 문서에서 |
|---|---|---|
| coding-agent 내장 도구는 경로를 제한하지 않는다. `resolveToCwd()`는 절대 경로와 `~`를 그대로 받는다 | [원문] `pi-src/packages/coding-agent/src/utils/paths.ts:76-107`, `core/tools/path-utils.ts:48-50`; [실험] pi-facts-1 A2(`read`로 `/etc/hostname`) | 경로 정책을 Helm이 둔다(§3.4) |
| `bash`는 cwd만 정하고 명령을 검사하지 않는다. pi에는 권한 시스템이 없다 | [원문] `core/tools/bash.ts`, `pi-src/README.md:88-96`, `coding-agent/docs/security.md:3` | §3.5, §3.6 |
| 도구 파일은 TUI 렌더러를 import하고, 도구 전용 하위 경로 export가 없다. 루트 import 한 번에 33개 패키지가 로드된다 | [원문] `core/tools/bash.ts:18`, `renderers/*.ts`, `coding-agent/package.json`; [실험] pi-facts-1 A2 | 파일 포크로 의존을 끊는다(§3.3.1, 07) |
| grep/find는 `rg`/`fd`가 없으면 실행 중 내려받는다 | [원문] `utils/tools-manager.ts:349-380` | 내려받지 않는다. 설치 전제 + 없으면 오류(§3.3.6) |
| 도구별 `*Operations` 인터페이스로 파일·프로세스 접근을 바꿀 수 있다. grep은 `rg`를 항상 로컬 실행 | [원문] `core/tools/{read,write,edit,bash,find,ls}.ts`, `grep.ts:53-58, 119-168` | 샌드박스 실행은 Operations 주입으로(pi-chat의 Gondolin 예, cases §10.2) |
| 잘림 상수 `DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024`, `GREP_MAX_LINE_LENGTH = 500` | [원문] `core/tools/truncate.ts:11-13` | §3.3.2 |
| `bash`의 0 아닌 종료코드는 `isError` 결과(throw 아님), 타임아웃·abort는 프로세스 트리를 죽이고 throw | [원문] `bash.ts:126-158, 371-381, 400-407`; [실험] A2 | §3.3.5 |
| `bash` 결과의 `structuredContent`는 `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }` | [원문] `bash.ts:56-62` | §3.3.5 |
| 같은 파일의 write/edit는 realpath 키로 직렬화 | [원문] `core/tools/file-mutation-queue.ts:28-61` | 작업 공간 단위 배타로 포함(12 §3.9.1) |
| codemode 스크립트는 실행마다 새 worker와 QuickJS VM. 변수는 한 번의 실행에서만 산다. `store`/`load`는 호출자가 넘기고 돌려받는다. 스크립트에서 채팅 모델을 부를 수 없다 | [원문] `pi-src/packages/codemode/src/runtime/host.ts:12-18`, `types.ts:82-98, 140-149`, `coding-agent/docs/codemode.md:62`; [실험] A2 | §3.8 |
| codemode 스크립트 안 도구 호출은 `ctx.executeTool` → `runToolCall()`로 같은 훅을 거친다 | [원문] `coding-agent/src/extensions/codemode/execute.ts:465`, `agent/src/agent-loop.ts` `runToolCall` | §3.8.3 |
| MCP 클라이언트는 `structuredContent`를 `outputSchema`로 검증하지 않는다 | [원문] `pi-src/packages/mcp/src/client.ts:142-151` | §3.9 |
| bash로 파일에 접근하면 Read/Edit 훅과 경로 규칙이 무력화된다 | [검색] extracts-1 E1-060 (u1f992 메모) | §3.5.1 |
| 같은 프로세스·파일 시스템에서는 모델이 bash로 Helm 기록을 고칠 수 있고, bash 명령 패턴 검사는 완전하지 않다 | extracts-3 X3-4-14, X3-5-06 | §3.5, §3.6 |
| 실행 전 가로채기가 없는 런타임은 격리된 작업 공간에서 실행하고 끝난 뒤 diff로 범위를 검사해 보장 수준을 낮춘다 | extracts-3 X3-8-22, v0.3 08 §8 | §3.11.6 |
| 이 서버에서 unprivileged user namespace, mount namespace, overlayfs(userns 안), Landlock(ABI 7)이 동작한다. bubblewrap 0.9.0은 apt 후보이며 setuid 없이 동작한다 | [실험] `P7/exp-bwrap.sh`, `P7/exp-bwrap-minroot.sh`, `P7/exp-bwrap.out.txt`, `P7/exp-bwrap-minroot.out.txt` (2026-10-11, WSL 커널 6.18.33.2) | §3.6 |
| bubblewrap 실행 비용은 한 번에 약 16ms(20회 0.32초) | [실험] `P7/exp-bwrap.out.txt` | §3.6.6 |
| Codex app-server는 `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput` 요청을 클라이언트에 보낸다. Claude Agent SDK는 `canUseTool` 콜백과 `PreToolUse` 훅을 받는다. ACP 클라이언트는 `requestPermission`, `writeTextFile`, `createTerminal`을 구현한다 | [원문] `~/projects/_ref/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts:3949-3955`, `claude/agent.ts:3417`, `claude/hooks.test.ts:6-33`, `acp-agent.ts:2556, 2706, 2712` (존재 확인. 의미 세부는 [지식]) | §3.11.4 |

### 2.3 이 문서의 주요 설계 선택 [제안]

| 번호 | 선택 | 이유 |
|---|---|---|
| TL-1 | 기본 도구는 coding-agent의 7개(`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`)를 포크하고, 전용 도구는 승격 기준 세 가지(런타임이 인자를 보고 개입해야 하는가, 호출 간 상태가 필요한가, 출력 구조가 정확성에 결정적인가)를 만족할 때만 더한다 | extracts-1 E1-063. 겹치는 도구를 늘리지 않는다(E1-057) |
| TL-2 | bash의 쓰기 범위는 명령 문자열 검사로 지키지 않는다. bubblewrap 마운트 격리로 쓰기 가능한 디렉터리만 쓰기 가능하게 만들어 커널이 강제하게 한다(S1). 실행 전후 변경 감지를 함께 둔다 | 명령 문자열만으로는 의도를 알 수 없다(E1-059). 실험으로 동작을 확인했다 |
| TL-3 | 샌드박스는 "필요한 것만 보이는" 최소 루트로 만든다: 시스템 디렉터리, 도구 체인, 작업 공간, 부여된 읽기 루트. 홈과 다른 프로젝트, 비밀 디렉터리, Helm 데이터는 보이지 않는다 | 다른 프로젝트의 `.env` 같은 복호화된 비밀을 목록으로 가리기 어렵다. 허용 목록이 안전하다 |
| TL-4 | 파일 도구(`write`, `edit`)는 데몬 프로세스에서 경로 정책과 커널 범위 검사를 거쳐 실행한다. 글롭 단위 범위는 파일 도구로만 쓸 수 있고, bash는 하위 트리 전체가 부여된 디렉터리만 쓴다 | 마운트로 글롭을 표현할 수 없다. 이렇게 나누면 bash의 대상이 실행 전에 알려진다(`targetsKnown: true`) |
| TL-5 | Helm 제안 도구는 14의 `ProposalKind`마다 하나(`helm_<kind>`)이고, 입력 스키마는 10의 명령 페이로드 스키마에서 런타임이 채우는 필드(ID 등)를 뺀 것이다. 실행은 제출과 결과 기록을 한 트랜잭션으로 한다 | 스키마를 두 곳에서 관리하지 않는다. 원자적이라 복구가 단순하다 |
| TL-6 | 하위 LLM 호출은 별도 도구 `helm_subcall`로 둔다. REPL(pi-codemode) 안에서는 `helm.subcall` 전역으로 같은 경로를 쓴다. REPL 변수는 한 번의 실행에서만 산다 | 교정된 전제(extracts-2 X2-1-24, X2-2-06~08, 15 §2.3) |
| TL-7 | 런타임 어댑터는 능력 목록으로 자신을 설명하고, Helm은 보장 성질별로 `enforced` / `detected` / `advisory`를 계산해 화면에 보인다. 없는 능력은 숨기지 않고 보장 수준을 낮춘다 | 결정 34, canon-2 §1.15, extracts-1 E1-009 |

## 3. 명세 본문

### 3.1 도구 모델 [제안]

```ts
// packages/tools/src/spec.ts
import type { AgentTool, AgentToolResult } from '@helm/agent';
import type { TSchema, Static } from '@helm/ai';     // TypeBox (pi-ai 재수출, 결정 36)

export type ToolKind = 'basic' | 'helm' | 'subcall' | 'repl' | 'mcp' | 'subrun_submit';
export type Cancellation = 'immediate' | 'cooperative' | 'atomic' | 'none';   // canon-2 §4.7
export type Exposure = 'direct' | 'deferred' | 'hidden';

export interface HelmToolSpec<P extends TSchema = TSchema, D = unknown> {
  name: string;                         // 모델에게 보이는 이름. [a-z0-9_]{1,64}
  version: string;                      // semver. 메이저가 바뀌면 재시작 replay 금지 (12 §3.7.2)
  kind: ToolKind;
  label: string;                        // 화면용 한국어 이름
  description: string;                  // 모델용 설명(영어, §3.7.5)
  promptSnippet?: string;               // 시스템 도구 지침 절에 들어갈 한 줄 (12 §3.5.2 S2)
  parameters: P;                        // 닫힌 객체(additionalProperties: false)
  outputSchema?: TSchema;               // structuredContent 스키마. 있으면 런타임이 검증한다
  constrainedSampling?: false | { type: 'json_schema'; strict: 'prefer' | 'require' };   // pi-ai Tool 필드
  primitive: PrimitiveAction | null;    // helm 제안 도구는 null(기록 능력 propose)
  replay: 'never' | 'safe';             // pi-agent-core AgentTool.replay와 같은 값. 기본 'never'
  safeForRecoveryTurn: boolean;         // 재시작 재개 첫 turn에 허용 (12 §3.7.5). replay=safe인 읽기 도구와 helm 도구만 true
  cancellation: Cancellation;
  executionMode: 'parallel' | 'sequential';   // 쓰기·실행·helm은 sequential (pi 규칙: 하나라도 sequential이면 배치 전체 순차)
  exposure: Exposure;
  externalEffect: boolean;              // 작업 공간 밖에 효과(발송, 원격 API 쓰기)
  /** 실행 준비: 파일을 바꾸지 않는다. 경로 정규화, 대상 계산, 샌드박스 사양, 사전 해시 */
  prepare(args: Static<P>, ctx: ToolContext): Promise<PreparedCall>;
  /** 실행. ctx.signal은 cancellation이 immediate/cooperative일 때만 abort된다 */
  execute(callId: string, args: Static<P>, ctx: ToolExecContext): Promise<AgentToolResult<D>>;
  /** 결과 후처리: 모델용 잘림, 전체 출력 blob, 비밀 마스킹, 변경 감지, materialRefs */
  postprocess(result: AgentToolResult<D>, isError: boolean, ctx: ToolExecContext): Promise<PostProcessed>;
}

export interface ToolContext {
  runId: RunId; toolCallId: ToolCallId; concernId: ConcernId;
  workspaceRoot: string;                // realpath
  cwd: string;                          // realpath, workspaceRoot 안
  scope: EffectiveScope;                // §3.5.3: 합의 ScopeSpec에서 계산한 쓰기 가능 루트, 파일 패턴, 네트워크
  readRoots: readonly string[];         // §3.4.3
  sandboxLevel: 'S0' | 'S1b' | 'S1';    // §3.6.1. 이 데몬에서 쓸 수 있는 최고 수준
  model?: { supportsImages: boolean };
}
export interface ToolExecContext extends ToolContext {
  signal: AbortSignal;
  onUpdate?: (partial: AgentToolResult<D>) => void;   // 휘발 스트림 (12 §3.4.4)
  prepared: PreparedCall;
}

export interface PreparedCall {
  executedArgs: unknown;                // 실행에 넘길 인자(정규화한 절대 경로 등). 12가 기록 (F-2)
  targets: ResourceUri[];               // §3.4.1 문법. 권한 판정·커널 범위 검사 입력
  targetsKnown: boolean;
  sandbox?: SandboxSpec;                // §3.6.2 (bash, grep, find)
  snapshotRef?: string;                 // 실행 전 변경 감지 스냅숏 blob (§3.5.4). 크래시 복구에 쓴다
  replayGuard?: { kind: 'file_hash'; path: string; before: string | 'absent'; after: string };
  pathDenials: PathDenial[];            // 비어 있지 않으면 12가 실행하지 않고 차단
}

export interface PostProcessed {
  modelContent: (TextContent | ImageContent)[];   // 모델이 보는 내용(잘림·마스킹 후)
  details?: unknown;                               // 화면용
  structured?: unknown;                            // outputSchema 검증을 통과한 structuredContent
  truncation?: TruncationInfo;
  blobRefs: string[];                              // 전체 출력 등 (sha256)
  changes?: ChangeSet;                             // §3.5.4
  materialRefs: MaterialRef[];                     // 'file:<path>@sha256:…' (A13 낡음 판정, 10 ObservationView)
  enforcement: 'pre' | 'post_hoc' | 'advisory';
  uncertain?: { externalRef?: string; reason: string };   // 외부 결과를 모름 → 12 awaiting_recovery
}
```

루프용 감싸기(`toAgentTool(spec)`):

- `AgentTool.execute`는 `spec.execute`를 부른다. `cancellation`이 `atomic` 또는 `none`이면 루프가 준 `signal` 대신 abort되지 않는 신호를 넘긴다(루프를 바꾸지 않고 취소 의미를 구현, 12 §3.4.1).
- `AgentTool.replay` = `spec.replay`, `executionMode` = `spec.executionMode`.
- `prepareArguments`는 coding-agent 도구가 가진 호환 보정(예: `edit`의 옛 `oldText`/`newText` 최상위 필드)을 그대로 둔다 [원문 `core/tools/edit.ts:103-134`].
- 화면 렌더러는 도구에 붙이지 않는다. 화면은 결과 JSON(`details`, `structured`)으로 그린다(21).

### 3.2 등록과 도구 묶음 [제안]

#### 3.2.1 레지스트리

`ToolRegistry`는 데몬 시작 때 만든다: 기본 도구 7개(§3.3), Helm 제안 도구(§3.7, 14의 `ProposalKind` 목록에서 생성), `helm_query`, `helm_subcall`, `helm_submit_subrun_result`(12 §3.14.5, 하위 실행에만), REPL 도구 `helm_code`(이후 단계, §3.8), 설정된 MCP 도구(§3.9). 이름 충돌은 시작 실패다(fail-closed, OpenClaw의 동명 도구 처리와 같은 원칙 S4/openclaw-runtime §2.3).

#### 3.2.2 묶음 계산

```text
toolsFor(run, kernelState):
  tpl = run.spec                                    # 14 WorkUnitTemplate에서 온 primitives, proposalKinds
  basic = { read, grep, find, ls }                  if 'read' ∈ tpl.primitives
        ∪ { write, edit }                           if 'write' ∈ tpl.primitives
        ∪ { bash }                                  if 'execute' ∈ tpl.primitives
        ∪ mcpTools(primitive ∈ tpl.primitives)      # §3.9
  helm  = { helm_<k> | k ∈ tpl.proposalKinds } ∩ toolsOfCommands(allowedCommands(kernelState, actor(run), corr))   # 10 §3.1.5
        ∪ { helm_query }                            # 항상 (조회)
  extra = { helm_subcall } if 'spawn' ∈ tpl.primitives
        ∪ evidenceToolset(run)                      # 15 EvidenceToolset (§3.2.3)
  if run.restrictToSafe: 전체에서 safeForRecoveryTurn인 것만 (12 §3.7.5)
  return sortByName(basic ∪ helm ∪ extra), exposure = direct만 선언
```

- 커널이 지금 이 행위자에게 의미 없는 명령의 도구는 주지 않는다(10 `allowedCommands`). 예: 합의가 이미 활성이면 `helm_agreement_draft`는 빠질 수 있다.
- 사람 권한 명령의 도구는 어떤 묶음에도 없다(§3.7.4).
- 묶음은 run 시작 때 정하고 루프 전환 때만 바꾼다(캐시, 12 §3.5.3). 같은 run 안에서 커널 상태 변화로 `allowedCommands`가 바뀌어도 묶음은 유지하고, 제출은 커널이 판정한다.
- `deferred`(목록에 없지만 찾아 쓰는 도구)는 1차에서 쓰지 않는다. MCP 도구가 많아지면 쓴다(§3.9.3).

#### 3.2.3 근거 범위 도구 묶음 (15 `EvidenceToolset`)

| 값 | 도구 | 읽기 루트 |
|---|---|---|
| `read_target` | `read`, `grep`, `find`, `ls`, `helm_query` | 작업 공간 |
| `read_docs` | 위 + 같은 도구 | 작업 공간 + 설정의 문서 루트(예: `~/projects/<제품>/docs`, `~/vault` 중 사용자가 허용한 곳) |
| `read_web` | 위 + `web_fetch`, `web_search` (이후 단계) | 위 + 네트워크(권한 레이어 판정) |

`read_web`의 도구는 1차 범위 밖이다(§7 O-13-05). 요청되면 런타임은 `read_docs`로 낮추고 그 사실을 결과에 표시한다.

### 3.3 기본 도구 (coding-agent 포크)

#### 3.3.1 포크 공통 변경 [제안, 07과 맞춤]

원본은 `pi-src/packages/coding-agent/src/core/tools/{read,write,edit,bash,grep,find,ls}.ts`와 `edit-diff.ts`, `truncate.ts`, `file-mutation-queue.ts`, `path-utils.ts`, `output-accumulator.ts`, `utils/{shell,child-process,paths,mime,image-process}.ts` 중 필요한 함수다(pi-facts-1 §9.1).

| 변경 | 내용 |
|---|---|
| 렌더러 제거 | `./renderers/*` import와 `...xxxRenderers` 전개를 지운다. `@earendil-works/pi-tui`, `modes/interactive/*` 의존이 사라진다 |
| 정의 타입 | `ToolDefinition`·`ExtensionContext`(coding-agent 확장 타입) 대신 §3.1 `HelmToolSpec`을 쓴다 |
| 경로 해석 | `resolveToCwd`를 §3.4.2 `canonicalize`로 바꾼다. macOS 스크린숏 이름 변형 재시도(`path-utils.ts:86-118`)는 남긴다(읽기만) |
| 도구 내려받기 | `utils/tools-manager.ts`의 `ensureTool`(실행 중 다운로드)을 지운다. `rg`·`fd` 경로는 설정 또는 PATH에서 찾고, 없으면 `tool.binary_missing` 오류(§3.3.6) |
| 세션 환경 변수 | bash의 `PI_*` 변수 주입을 끈다(`exposeSessionEnvironment: false`, `bash.ts:186-212`). 대신 `HELM_RUN_ID`, `HELM_TOOL_CALL_ID`만 넣는다 |
| 실행 환경 | `ReadOperations`·`WriteOperations`·`EditOperations`는 데몬 파일 시스템 구현(§3.4의 검사 포함). `BashOperations.exec`는 샌드박스 실행기(§3.6.2). `GrepOperations`·`FindOperations`는 샌드박스 안에서 `rg`·`fd`를 실행하는 구현으로 바꾼다(pi-chat의 Operations 주입 방식, cases §10.2) |
| 설정 | `config.ts`의 `getBinDir`·`APP_NAME` 대신 Helm 설정 경로 |
| 기본 타임아웃 | bash 기본 300초, 최대 3,600초(원본은 기본 없음) |
| 결과 해시 | `read`와 쓰기 도구의 `structuredContent`에 `sha256`을 더한다(A13: 근거는 파일@해시로 낡음 판정, extracts-3 X3-8-11) |

#### 3.3.2 공통 잘림 규칙

원본 `truncate.ts` 그대로다 [원문 `core/tools/truncate.ts:11-38, 78, 168, 268, 292`].

| 규칙 | 값 | 쓰는 도구 |
|---|---|---|
| 줄 상한 / 바이트 상한 (먼저 걸리는 쪽) | 2,000줄 / 50 KiB | read(앞부분 유지 `truncateHead`), bash(뒷부분 유지 `truncateTail`) |
| grep 줄당 | 500자 | grep |
| 가운데 자르기 | 20 KiB 넘는 MCP 텍스트 | MCP (§3.9) |
| 전체 출력 | 잘리면 전체를 blob으로 저장하고 결과에 `fullOutputRef`(blob ID)를 넣는다. 원본은 임시 파일(`pi-bash` 접두사)에 남기지만 Helm은 데몬 blob 저장소(09·17)에 둔다. 상한 50 MiB, 넘으면 앞뒤 25 MiB씩 |
| 이어 읽기 안내 | 원문 문구 유지: `[Showing lines 1-2000 of N. Use offset=2001 to continue.]` |

#### 3.3.3 도구별 명세

| 도구 | 입력 스키마 (원본 행) | 모델용 출력 | `structuredContent` | 원시 행동 | replay | 취소 | 실행 위치 | 경로 정책 |
|---|---|---|---|---|---|---|---|---|
| `read` | `{ path: string; offset?: number /*1부터*/; limit?: number }` (`read.ts:14-18`) | 텍스트(잘림 + 이어 읽기 안내), 이미지면 `[메모, image]`. 모델이 이미지를 못 받으면 메모만 (`read.ts:79-84, 133-204`) | `{ path, totalLines, startLine, endLine, truncated, sha256, mime }` 또는 이미지 `{ type:'image', mime, sha256 }` | read | safe | immediate | 데몬 | 읽기 루트 안, 가림 목록 밖 (§3.4.3) |
| `write` | `{ path: string; content: string }` (`write.ts:11-14`) | `Successfully wrote <n> bytes to <path>` | `{ path, bytes, created, beforeSha256 \| null, afterSha256 }` | write | safe + `file_hash` guard | atomic | 데몬 | 쓰기 대상 = `file:<canonical>`. 부모 디렉터리 생성도 범위 안이어야 함 |
| `edit` | `{ path: string; edits: { oldText: string; newText: string }[] }` (`edit.ts:21-41`) | `Successfully replaced N block(s) in <path>.` + 짧은 diff | `{ path, replaced, beforeSha256, afterSha256, firstChangedLine }` (원본 details의 `diff`, `patch`는 `details`) | write | safe + `file_hash` guard | atomic | 데몬 | 같음. 매칭 규칙(유일성, 겹침 금지, 퍼지 매칭)은 원본 `edit-diff.ts` |
| `bash` | `{ command: string; timeout?: number /*초*/ }` (`bash.ts:40-43`) | 출력 꼬리 + 잘림 안내. 0 아닌 종료코드는 `isError` + `Command exited with code N` | `{ output, truncated, fullOutputRef?, exitCode, wallTimeSeconds, sandbox: 'S0'\|'S1b'\|'S1', writableRoots, network: boolean, changes: ChangeSet요약 }` | execute | never | cooperative | 샌드박스 (§3.6) | 쓰기 가능 루트는 §3.5.3. 대상 = 루트들 |
| `grep` | `{ pattern; path?; glob?; ignoreCase?; literal?; context?; limit? }` (`grep.ts:21-33`, limit 기본 100) | `파일:줄: 내용` | `{ matches, truncated, matchLimitReached }` | read | safe | immediate | 샌드박스 읽기 전용(가림 목록 적용) | `path`는 읽기 루트 안 |
| `find` | `{ pattern /*glob*/; path?; limit? }` (`find.ts:26-32`, 기본 1,000) | 상대 경로 목록 | `{ paths, truncated }` | read | safe | immediate | 샌드박스 읽기 전용 | 같음 |
| `ls` | `{ path?; limit? }` (`ls.ts:11-14`, 기본 500) | 정렬된 항목, 디렉터리는 `/` 접미사 | `{ entries, truncated }` | read | safe | immediate | 데몬 | 같음. 가림 대상은 목록에서 뺀다 |

`powershell` 도구는 가져오지 않는다(결정 20: WSL에서 실행).

#### 3.3.4 쓰기 도구의 실행 절차

```text
write/edit prepare(args, ctx):
  p = canonicalize(args.path, ctx)                  # §3.4.2. 실패면 pathDenials
  if not inWorkspace(p) or masked(p): deny
  stat = lstat(p) (없으면 absent)
  if stat.isSymbolicLink: p = realpath(p) → 다시 정책 검사 (링크 대상이 범위 밖이면 deny)
  if stat 존재 and not regular file: deny('not_regular_file')
  if stat.nlink > 1: deny('hardlinked_file')        # 다른 위치의 같은 inode를 바꾸는 것을 막는다
  before = sha256(파일) | 'absent'
  after  = write: sha256(args.content)
           edit:  applyEditsToNormalizedContent(현재 내용, edits) 의 sha256 (매칭 실패면 prepare 단계에서 오류 결과)
  return { executedArgs: { ...args, path: p }, targets: ['file:'+p] (+ 생성할 부모 디렉터리들), targetsKnown: true,
           replayGuard: { kind:'file_hash', path: p, before, after } }

write/edit execute(args, ctx):                      # 작업 공간 쓰기 배타 락 안 (12 §3.9.1)
  mkdir -p 부모 (각 단계 realpath가 범위 안인지 확인)
  fd = open(p, O_WRONLY|O_CREAT|O_NOFOLLOW)          # 마지막 구성요소 링크 거부
  real = readlink('/proc/self/fd/'+fd)               # 실제로 연 파일
  if real != p: close; deny('path_changed')          # 검사와 쓰기 사이 바꿔치기 감지
  if edit: 현재 sha256 != before → 오류 'file_changed_since_prepare' (모델이 다시 읽게)
  쓰기(원본처럼 BOM·줄끝 복원), fsync, close
```

#### 3.3.5 bash 실행 절차

```text
bash prepare(args, ctx):
  roots = ctx.scope.writableRoots                    # §3.5.3. 합의가 없으면 []
  net   = ctx.scope.network                          # 'none' | 'any'
  spec  = sandboxSpec(ctx, roots, net)                # §3.6.2
  snap  = changeDetector.snapshot(roots)             # §3.5.4. 트랜잭션 밖에서
  targets = roots.map(r => 'file:'+r+'/**') ∪ (net=='any' ? ['net:*'] : [])
  return { executedArgs: { command: args.command, timeout: clamp(args.timeout ?? 300, 1, 3600), cwd: ctx.cwd },
           sandbox: spec, snapshotRef: snap.ref, targets,
           targetsKnown: ctx.sandboxLevel in ['S1', 'S1b'],   # 마운트 격리면 쓰기 가능 영역이 실행 전에 확정
           pathDenials: [] }

bash execute: BashOperations.exec = sandboxRunner.exec(spec, command)   # 원본 OutputAccumulator, onUpdate 스로틀 유지
bash postprocess:
  changes = changeDetector.diff(snapshotRef, roots)
  출력·전체 출력에 비밀 대조 마스킹 (§3.6.4)
  enforcement = (S1 or S1b) ? 'pre' : (changes.measured ? 'post_hoc' : 'advisory')
```

- 백그라운드 프로세스(`cmd &`)는 명령이 끝나면 pid 네임스페이스와 함께 종료된다. 결과 본문에 이 사실을 알리는 설명을 도구 설명(`description`)에 둔다. 오래 도는 프로세스 도구는 이후 단계다(§7 O-13-04).
- 대화형 명령(입력 대기)은 stdin이 닫혀 있어 바로 끝난다(원본 `stdio: [ignore, pipe, pipe]`).

#### 3.3.6 외부 바이너리

- `rg`, `fd`, `bash`, `git`은 데몬 설치 단계(17 `just setup`)가 확인한다. 이 서버는 mise로 설치된 `rg 15.2.0`, `fd 10.5.0`, `/usr/bin/git`이 있다 [실험 `which`, 2026-10-11].
- 없으면 도구 결과 `tool.binary_missing: rg`(isError)로 끝내고 실행 중 내려받지 않는다.
- 샌드박스 안 PATH에는 설정된 도구 체인 경로만 넣는다(§3.6.2).

### 3.4 자원 URI와 경로 정책

#### 3.4.1 자원 URI 문법 [제안, 10 §3.6.6이 이 문서에 맡김]

```text
ResourceUri     = scheme ":" body
scheme          = "file" | "net" | "mcp" | "blob"
file:<abs>      정규화한 절대 경로(§3.4.2). 예 file:/home/user/projects/helm/code/helm/src/a.ts
net:<host>[:<port>] | net:*      바깥 네트워크 연결 대상. host는 소문자 DNS 이름 또는 IP
mcp:<server>/<tool>               MCP 도구 호출 (§3.9)
blob:sha256:<hex>                 데몬 blob 저장소 항목(읽기)

ResourcePattern = 같은 형식 + 경로·호스트 자리의 '*'(구분자 '/' 또는 '.' 제외 0자 이상)와 '**'(구분자 포함 0자 이상)
                  정규식 금지. 대소문자 구분(ext4)
```

- 패턴 판정 함수(`match`)는 10 §3.6.6을 따른다. 이 문서는 대상 URI를 만드는 쪽이다.
- `file:` 패턴은 작업 공간 루트 밖을 가리킬 수 있지만(읽기 루트), 쓰기 부여는 작업 공간 안만 받는다. 작업 공간 밖 쓰기 부여가 있는 합의는 커널이 `content.schema_invalid`로 거부하도록 10에 요구한다.
- `/mnt/[a-z]/…`(Windows 드라이브, drvfs)는 대소문자 구분과 권한 의미가 달라 패턴 판정을 믿을 수 없다. 이 경로의 작업 공간은 보장 수준 `advisory`로만 다룬다 [제안].

#### 3.4.2 정규화

```text
canonicalize(input, ctx):                                  # 모든 경로 인자에 적용
  s = input
  s = 앞의 '@' 제거, 유니코드 공백 정규화, file:// URL 변환        # 원본 resolvePath 동작 유지 (utils/paths.ts:76-107)
  if s 가 '~' 또는 '~/'로 시작: s = HOME 기준 확장            # 확장은 하되 아래 정책으로 판정
  if s 가 상대 경로: s = join(ctx.cwd, s)
  s = 어휘 정규화('.', '..', 중복 '/' 제거)
  # 존재하는 가장 깊은 조상까지 realpath, 나머지는 붙임 (새 파일 경로 지원)
  (anc, rest) = 가장 깊은 존재 조상
  c = realpath(anc) + rest
  if rest 비어 있지 않음 and rest 에 '..' 남음: 오류('unresolvable')
  return c                                                  # 심볼릭 링크가 해석된 정규 경로
```

- 심볼릭 링크는 해석한 뒤의 경로로 판정한다. 작업 공간 안의 링크가 밖을 가리키면 밖으로 판정한다.
- 읽기 도구도 같은 정규화를 거친다. 모델이 낸 원래 경로는 `modelArgs`에, 정규화한 경로는 `executedArgs`에 남는다(12 §3.4.5).

#### 3.4.3 읽기 루트와 가림 목록 [제안]

읽기 가능 루트(데몬 쪽 `read`·`ls`와 샌드박스 읽기 바인드 모두 같은 목록):

1. 작업 공간 루트(Concern의 `workspaceRoot`)
2. 합의 범위나 근거 범위 다이얼로 부여된 추가 읽기 루트(예: `read_docs` 문서 루트)
3. 샌드박스 안에서만: 시스템 디렉터리와 도구 체인(§3.6.2)

가림 목록(보호 경로)의 정본은 18 §3.11.5다. 이 문서는 그 목록을 두 곳에 적용한다: 데몬 안 파일 도구는 정규화한 경로(§3.4.2)로 거부하고, 샌드박스에서는 보이지 않게 한다(최소 루트에 없으면 바인드하지 않고, 바인드한 루트 안의 항목은 빈 파일·빈 tmpfs로 덮음). 18 목록에 더해 이 문서가 넣는 항목:

| 패턴 | 이유 |
|---|---|
| `**/.helm/private/**` | 이전 Helm의 재개 키(브리프 §4) |
| `$XDG_RUNTIME_DIR/helm/**`(데몬 소켓, 17 D17-08), 클라이언트 자격 파일 | 모델이 사람 명령을 보내지 못하게 한다(19 §3.2 보안 전제) |
| `/run/WSL/**`과 환경 변수 `WSL_INTEROP` | 샌드박스 안에서 Windows 실행 파일을 실행해 밖으로 나가는 것(WSL interop)을 막는다(18 T-M2). 최소 루트 샌드박스는 `/run`과 `/mnt`를 바인드하지 않는다 |

읽기 금지와 쓰기 금지를 나눈 항목(예: `~/.local/share/mise/**`는 읽기·실행 허용, 쓰기 금지; `**/.git/hooks/**` 쓰기 금지)은 18 표를 따른다. 샌드박스에서 쓰기 금지 항목은 읽기 전용 바인드로, 파일 도구에서는 쓰기 대상 거부로 적용한다.
가림 목록은 설정으로 늘릴 수 있고 줄일 수 없다(기본 항목 제거 금지).

#### 3.4.4 검사와 쓰기 사이 경쟁

- 쓰기 도구와 쓰기 가능한 bash는 같은 작업 공간에서 동시에 돌지 않는다(12 §3.9.1). 모델이 bash로 링크를 바꿔치기하는 동안 파일 도구가 쓰는 경쟁을 없앤다.
- 파일을 연 뒤 `/proc/self/fd/<n>`으로 실제 경로를 다시 확인한다(§3.3.4).
- 사용자나 Syncthing(`~/projects`는 Mac과 양방향 동기화, 브리프 §2.5) 같은 외부 쓰기는 막을 수 없다. 변경 감지 결과에 "외부 쓰기 가능성"을 표시한다(§3.5.4).

### 3.5 쓰기 범위 검사와 bash·execute 우회 방지

#### 3.5.1 위협

| 번호 | 위협 | 예 | 출처 |
|---|---|---|---|
| W-1 | 파일 도구 훅을 bash로 우회 | `bash -c "python - <<EOF … open('docs/x','w') …"`. 경로 훅은 bash 명령 문자열에서 대상을 알 수 없다 | extracts-1 E1-059~060 |
| W-2 | 심볼릭 링크로 범위 밖 쓰기 | 범위 안에 `ln -s ../other src/link` 후 `write src/link/x` | 실험 `P7/exp-bwrap.sh` 7번 |
| W-3 | Helm 기록 직접 수정 | bash로 SQLite 파일이나 데몬 소켓 조작 | extracts-3 X3-4-14, 10 §3.2 |
| W-4 | 비밀 유출 | 환경 변수, `/proc/<데몬>/environ`, `.env`, `~/.ssh`, 네트워크 전송 | 18, §3.6.4 |
| W-5 | 허용 범위 안이지만 잘못된 때·맥락의 행동 ("Allowed but unsafe") | 범위 안 파일을 지워 다른 작업의 전제를 깸 | canon-3 §4.19, 13 체크리스트 |
| W-6 | 스크립트·하위 호출 안의 중첩 도구 호출이 훅을 건너뜀 | codemode `tools.*`가 훅 없이 실행(pi-durable에서 확인된 구조) | canon-2 §7.2.3 L22 |
| W-7 | 외부 런타임 어댑터의 훅 한계 | 런타임이 사전 가로채기를 제공하지 않음 | 결정 34, §3.11 |

W-5는 범위 검사로 막을 수 없다. 커널의 의미 충돌 검사(10 P-11), 결과 확인과 전체 반영(A 루프), 변경 감지 기록으로 사람에게 보이게 한다.

#### 3.5.2 방법 비교와 선택

| 방법 | 사전 차단 | 세밀도 | 비용 | WSL에서 | 비밀 가림 | 네트워크 | 판정 |
|---|---|---|---|---|---|---|---|
| (a) 파일 도구 경로 검사 | 예(파일 도구만) | 파일·글롭 | 낮음 | 됨 | 해당 없음 | 해당 없음 | 채택(파일 도구) |
| (b) bash 명령 문자열 분석·허용 목록 | 부분(우회 쉬움) | 명령 | 낮음 | 됨 | 아니오 | 아니오 | 기각. 보조 신호로도 쓰지 않음(거짓 안심) |
| (c) 실행 전후 파일 시스템 비교(스냅숏·diff) | 아니오(사후 감지) | 파일 | 중간(큰 트리) | 됨 | 아니오 | 아니오 | 채택(감지·기록용, S0 대체 수단) |
| (d) git worktree 격리 후 diff 검토·반영 | 반영 전 차단 | 파일 | 중간 | 됨 | 아니오 | 아니오 | 외부 런타임 어댑터의 낮춘 수준(§3.11.6) |
| (e) 마운트 네임스페이스(bubblewrap): 쓰기 가능 루트만 rw 바인드 | 예(커널 EROFS) | 디렉터리 | 낮음(약 16ms) | 됨 [실험] | 예(최소 루트, 빈 파일·tmpfs 가림) | 예(`--unshare-net`) | **채택(기본, S1)** |
| (f) 오버레이 스테이징(userns 안 overlayfs) | 예(반영 전 검토) | 파일 | 중간(반영 절차 복잡: 화이트아웃, 이름 바꾸기) | 됨 [실험] | 예(e와 함께) | e와 같음 | 이후 단계 S2 |
| (g) Landlock(ABI 7) | 예 | 디렉터리(허용 목록) | 낮음 | 됨 [실험: ABI 7] | 아니오(빼기 불가, 허용 목록만) | TCP 포트 단위 | 보조 후보. 1차 미채택(헬퍼 바이너리 필요) |
| (h) 컨테이너(Docker, 서버에 29.8.2 있음) | 예 | 디렉터리 | 높음(시작 시간, 도구 체인 이미지) | 됨 | 예 | 예 | 기각(1인 개발 도구 체인을 이미지로 관리하는 부담) |
| (i) VM(Gondolin 등) | 예 | - | 높음 | 불확실 | 예 | 예 | 기각 |

선택: (a) + (e) + (c). 파일 도구는 데몬에서 경로·범위를 검사하고, bash·grep·find는 bubblewrap 샌드박스에서 실행해 쓰기 가능 루트 밖 쓰기를 커널이 막고, 실행 전후 변경을 감지해 관찰·복구·사후 검사에 쓴다. bubblewrap이 없는 환경은 18이 정한 2순위 `systemd-run --user` 격리(S1b)로 낮춘다(§3.6.1).

실험 결과 [실험 `P7/exp-bwrap.out.txt`, `P7/exp-bwrap-minroot.out.txt`]:

| 확인 | 결과 |
|---|---|
| 쓰기 가능 루트 안 쓰기 | 성공 |
| 루트 안의 특정 파일만 읽기 전용(`--ro-bind` 덧씌움) | `Read-only file system` |
| 루트 밖 쓰기, `.helm` 쓰기, 작업 공간 루트 바로 아래 새 파일 | `Read-only file system` |
| 루트 안 심볼릭 링크로 밖에 쓰기(W-2) | `Read-only file system` |
| 가린 비밀 디렉터리 읽기 | 없음 |
| DNS·네트워크 | 이름 해석 실패 |
| `--clearenv` 뒤 비밀 환경 변수 | 비어 있음 |
| pid 네임스페이스에서 보이는 프로세스 | 샌드박스 안의 것만(6개) |
| 최소 루트에서 `node`, `git status`, `rg` | 동작 |
| 다른 프로젝트 디렉터리 | 보이지 않음 |
| `.git`을 읽기 전용으로 둔 채 `git commit` | 실패 |
| `.env`를 `/dev/null`로 가림 | 내용은 가려지지만 `git status`가 `M .env`를 보이고 `cat`은 `Permission denied`. 빈 일반 파일로 가리는 것이 낫다 |

#### 3.5.3 합의 범위에서 실행 범위 계산 [제안]

10 §3.6.6의 `ScopeSpec`(`allow: ScopeGrant[]`, `allowUnscopedExecute`)과 `ForbiddenAction`을 입력으로 한다.

```ts
export interface EffectiveScope {
  writableRoots: string[];      // bash가 쓸 수 있는 디렉터리(정규 경로)
  filePatterns: ResourcePattern[];   // write·edit가 쓸 수 있는 패턴 (커널이 최종 판정)
  readOnlyOverlays: string[];   // 쓰기 가능 루트 안에서 읽기 전용으로 덧씌울 경로
  network: 'none' | 'any';
  env: string[];                // 샌드박스에 넘길 추가 환경 변수 이름 (값은 데몬 설정에서, 비밀 금지)
}
```

```text
effectiveScope(agreement | none, ws):
  if 활성 합의 없음: return { writableRoots: [], filePatterns: [], readOnlyOverlays: [], network: 'none', env: [] }
  s = agreement.narrowedScope ?? agreement.scope
  roots = []
  for g in s.allow where 'write' ∈ g.primitives and 'execute' ∈ g.primitives:
     for p in g.resources where scheme(p) == 'file':
        if p 가 'file:<D>/**' 꼴이고 <D>에 '*'가 없음 and D ⊆ ws: roots += realpath(D)
        # 그 밖의 패턴(파일 단위, 중간 글롭)은 bash 쓰기 루트가 되지 않는다. write·edit로만 쓸 수 있다 (TL-4)
  roots = 중첩 제거(상위 루트만 남김)
  overlays = [ root/.git for root in roots if 'file:<ws>/.git/**' write 부여 없음 ]
           ∪ [ 금지 행동(ForbiddenAction)의 file: 자원 중 존재하는 구체 경로 ]
           ∪ [ 가림 목록에 걸리는 경로 ]        # 가림은 별도(빈 파일/tmpfs)로 처리
  network = s.allow 에 ('execute' 또는 'send', 'net:*' 또는 'net:<host>') 부여가 있으면 'any' else 'none'
           # 호스트 단위 허용 목록은 1차에서 구현하지 않는다(§7 O-13-02). 호스트를 적은 부여도 'any'로 실행하되
           # 권한 판정 targets에는 적힌 호스트를 넣고, 커널이 그 부여를 확인한다
  filePatterns = s.allow 중 'write' 부여의 file: 패턴 전부
```

- bash의 권한 판정 `targets`는 `file:<root>/**`들과(네트워크면) `net:*`이다. 커널은 이것이 합의의 `execute` 부여로 덮이는지 본다(`covers`). 루트가 하위 트리 전체 부여에서만 나오므로 덮인다.
- 합의가 없으면 bash는 쓰기 가능 루트 없이, 네트워크 없이 돈다(읽기 전용 실행). 이때 `targets: []`, `targetsKnown: true`이므로 의존 규칙 1(write·send에 합의 필요)에 걸리지 않는다. 14가 요구한 "합의 없는 실행은 작업 대상을 바꾸지 않는다"(14 §3 O 루프 표)를 샌드박스로 보장한다.
- 쓰기 가능 루트가 필요한데 합의가 파일 단위 부여만 가진 경우, 모델은 파일 도구로 쓰거나 범위 확대를 요청해야 한다(`qualification.out_of_scope` 질문). 이 사실을 bash 도구 설명과 차단 사유에 적는다.

#### 3.5.4 변경 감지 [제안]

```ts
export interface ChangeSet {
  measured: boolean;
  method: 'git' | 'scan' | 'none';
  roots: string[];
  changes: { path: string; kind: 'created' | 'modified' | 'deleted' | 'mode_changed';
             beforeSha256?: string; afterSha256?: string }[];
  truncated: boolean;            // 1,000건 넘으면 앞 1,000건만
  ignoredNotMeasured: boolean;   // git 방식에서 .gitignore 대상은 보지 않음
  concurrentWritersPossible: boolean;   // 실행 시간 동안 Syncthing·사용자 쓰기를 구분할 수 없음
}
```

```text
snapshot(roots):                                # 실행 전, 트랜잭션 밖
  for r in roots:
    if r 이 git 작업 트리 안:
       st = git -C r status --porcelain=v2 -z --untracked-files=all -- .     # 추적·미추적, 무시 파일 제외
       dirty = st의 경로들; hashes = { p: sha256(p) for p in dirty }
       record { r, method: 'git', head: rev-parse HEAD, dirty, hashes }
    else:
       walk(r) 최대 50,000 항목: (상대 경로, 크기, mtimeNs, inode, mode)
       넘으면 { r, method: 'none' }
  ref = blob.put(gzip(json(record)))            # 크래시 복구 때 다시 비교 (12 §3.7.3)
diff(ref, roots):                                # 실행 뒤
  git: 이전·이후 dirty 합집합의 각 경로를 이전 해시(없으면 HEAD 내용 해시)와 현재 해시로 비교, HEAD가 바뀌었으면 커밋 diff 경로 추가
  scan: 같은 walk 결과를 비교, 크기·mtime·inode가 다른 파일만 해시
```

- 변경 감지는 S1에서 정보다(관찰, 근거의 파일@해시, 복구 안내). S0에서는 사후 범위 검사 입력이다: `toolcall.complete`의 `observedChanges`를 커널이 범위와 비교하고(10 §3.6.5의 `allowUnscopedExecute` 경로), 범위 밖 변경이면 질문을 만든다.
- 범위 밖 변경을 자동으로 되돌리지 않는다(§7 O-13-03). 기록하고 사람에게 묻는다.
- `node_modules` 같은 무시 경로의 쓰기는 git 방식에서 보지 않는다(`ignoredNotMeasured`). S1에서는 쓰기 가능 루트 밖이면 어차피 막힌다.

#### 3.5.5 원전의 권한 차원과의 대응

원전 Authority Envelope의 아홉 차원(canon §9.5)과 통치 불변조건(canon §9.10)을 이 설계에 다음처럼 둔다. 가역성 판별은 Helm 범위 밖이다(결정 2).

| 원전 | 이 설계 |
|---|---|
| Scope, Action class | 10 `ScopeSpec`(원시 행동 × 자원 패턴)과 `ForbiddenAction`. 실행은 §3.5.3으로 강제 |
| Temporal boundary | 합의·부여의 만료(10), 타이머(12) |
| Reversibility, Blast radius, Uncertainty, Value sensitivity | 권한 레이어 판정(`PermissionVerdict.reversibility`, `rightsCategories`, `externalEffect`)과 14 다이얼 입력. Helm이 계산하지 않는다 |
| Observability, Testability | 변경 감지(§3.5.4), 결과 제출의 근거 의무(10), 검증 격리(§3.7.9) |
| 통치 불변 1 "자율 실행은 유효한 권한 범위를 가진다" | 합의 없는 실행은 쓰기 가능 루트 없음(§3.5.3) |
| 통치 불변 2 "권한 범위는 도구 능력보다 좁거나 같다" | 샌드박스가 도구 능력을 합의 범위로 줄인다. 도구 능력이 범위보다 넓은 S0은 운영자 설정 때만 |
| 통치 불변 5 "비가역 외부 행위는 명시 권한" | 권리 범주 → 권리 게이트 + 인자 지문 승인(10 P-2·P-3, 11 §3.14) |
| 보안 MUST "프롬프트 내용과 실행 권한 분리" | 권한은 합의 레코드와 샌드박스 사양에서만 온다. 모델 텍스트는 권한을 바꾸지 않는다 |
| 보안 SHOULD "dry-run과 영향 미리보기" | 승인 질문의 `argsPreview`(§3.10), 쓰기 도구의 `replayGuard.after`(예상 결과 해시), edit의 diff |
| 보안 SHOULD "정책 위반은 Governance Event" | `submission.rejected`·`scope.violation_detected`(10) |

#### 3.5.6 중첩 도구 호출 (W-6)

- REPL(`helm_code`)과 하위 실행의 도구 호출은 모두 pi-agent-core `runToolCall()`로 실행하고 같은 `beforeToolCall`/`afterToolCall`을 건다 [원문 `agent-loop.ts` `runToolCall`: "Tools that call other tools use this so the hooks (for example permission checks) apply to those calls too"]. 각 중첩 호출은 자기 `tc_`와 `parentToolCallId`를 가진 도구 호출 기록이 된다(12 CR-3 적용).
- REPL 스크립트 자체(QuickJS)는 파일·네트워크·프로세스 접근이 없다 [원문 `pi-src/packages/codemode/README.md` "How it works"]. 바깥으로 나가는 길은 등록된 도구뿐이다.

### 3.6 격리

#### 3.6.1 샌드박스 수준 [제안]

| 수준 | 방법 | 쓰기 강제 | 비밀 가림 | 네트워크 | 보장 수준 표시 |
|---|---|---|---|---|---|
| S0 | 격리 없음. 정리된 환경 변수, cwd, 프로세스 그룹. 운영자가 데몬 설정 `tools.sandbox = "off"`로 명시할 때만(18 §3.11.2) | 없음(사후 감지) | 환경 변수만 | 제한 없음 | `post_hoc`(감지됨) 또는 `advisory`(감지 못함) |
| S1b | `systemd-run --user` 일회성 단위(18 §3.11.2 2순위): `PrivateUsers`, `ProtectSystem=strict`, `ProtectHome=read-only`, `ReadWritePaths`=쓰기 가능 루트, `InaccessiblePaths`=보호 경로, `PrivateNetwork`, `env -i` | 커널(읽기 전용 마운트) | `InaccessiblePaths`, 환경 비움. 같은 uid 프로세스에 신호는 보낼 수 있음(pid 네임스페이스 없음) | `PrivateNetwork` 또는 공유 | `pre` |
| S1 | bubblewrap: 사용자·마운트·pid·네트워크 등 네임스페이스, 최소 읽기 루트, 쓰기 가능 루트만 rw | 커널(EROFS) | 최소 루트 + 가림 | `none` 또는 `any` | `pre` |
| S2 (이후) | S1 + 쓰기 가능 루트를 오버레이로: 끝난 뒤 변경을 검토·반영 | 커널 + 반영 전 검토 | S1과 같음 | S1과 같음 | `pre` |

기본은 S1이다. 데몬은 시작 때 `bwrap --version`(0.9 이상)과 `bwrap --unshare-user --ro-bind / / true` 성공으로 S1 가능 여부를 정한다. 안 되면 S1b(`systemd-run --user`, 이 서버에서 바로 동작 [실험: 18 §3.11.2])로 낮춘다. S1b도 안 되면 `execute` 도구를 끈다(fail closed, 18 D18-05). S0은 운영자 설정으로만 켜고, 합의 플래그(`allowUnscopedExecute`)만으로는 켤 수 없다. S0의 bash는 데몬 소켓에 붙어 합의 범위 밖의 사람 결정을 보낼 수 있기 때문이다(18 §3.11.2). 상태 확인(17)과 화면(21)에 현재 수준을 보인다. 설치는 `apt install bubblewrap`(Ubuntu 24.04 후보 0.9.0, [실험 `apt-cache policy`])이고 17의 설치 레시피가 맡는다.

#### 3.6.2 샌드박스 사양과 bwrap 인자 [제안]

```ts
export interface SandboxSpec {
  level: 'S1';
  workspaceRoot: string; cwd: string;
  writableRoots: string[]; readOnlyOverlays: string[];
  extraReadRoots: string[];                  // 근거 범위 문서 루트 등
  maskedFiles: string[];                     // 빈 파일로 덮을 파일 (작업 공간 안 .env 등, 시작 때 찾음)
  maskedDirs: string[];                      // 빈 tmpfs로 덮을 디렉터리
  toolchainRoots: string[];                  // 설정: 기본 ['~/.local/share/mise', '~/.local/bin']
  home: string;                              // /srv/volumes/helm/sandbox/<workspaceId>/home (작업 공간별 영속 캐시 홈)
  network: 'none' | 'any';
  env: Record<string, string>;               // 허용 목록으로 만든 값
  limits: { timeoutSec: number; memoryMax?: string; tasksMax?: number; cpuQuota?: string };
}
```

```text
bwrap
  --unshare-all                           # user, ipc, pid, net, uts, cgroup
  [--share-net]                           # network == 'any' 일 때만
  --die-with-parent --new-session
  --clearenv  (--setenv K V)…             # §3.6.4 허용 목록
  --ro-bind /usr /usr  --symlink usr/bin /bin  --symlink usr/lib /lib  --symlink usr/lib64 /lib64  --symlink usr/sbin /sbin
  --ro-bind /etc/alternatives … --ro-bind /etc/ssl … --ro-bind /etc/passwd … --ro-bind /etc/group …
  --ro-bind-try /etc/ld.so.cache … --ro-bind-try /etc/localtime …
  [--ro-bind /etc/resolv.conf … --ro-bind /etc/hosts …]   # network == 'any'
  --dev /dev  --proc /proc  --tmpfs /tmp
  --ro-bind <toolchainRoot> <toolchainRoot> …
  --bind <home> <home>
  --ro-bind <workspaceRoot> <workspaceRoot>
  --ro-bind <extraReadRoot> <extraReadRoot> …
  --bind <writableRoot> <writableRoot> …
  --ro-bind <overlay> <overlay> …          # .git, 금지 경로 (쓰기 가능 루트 위에 덧씌움)
  --ro-bind <emptyFile> <maskedFile> …     # /srv/volumes/helm/sandbox/empty (빈 일반 파일)
  --tmpfs <maskedDir> …
  --chdir <cwd>
  -- /usr/bin/bash --noprofile --norc -c <command>
```

- `--unshare-pid`로 데몬 프로세스와 그 `/proc/<pid>/environ`이 보이지 않는다(W-4). `--die-with-parent`로 데몬이 죽으면 함께 죽는다.
- 네트워크 네임스페이스를 분리하면 추상 Unix 소켓도 분리된다 [지식]. `--share-net`일 때 샌드박스는 루프백의 데몬 TCP 리스너(06 §3.1.1의 127.0.0.1:7801)에 연결할 수 있다. 데몬 리스너는 루프백 연결도 기기 토큰을 요구해야 한다(루프백 자동 승인 금지, cases §12.2-8). 18·19에 요구한다.
- 도구 체인은 mise 설치 경로(`~/.local/share/mise/installs/...`)를 읽기 전용으로 바인드한다. 이 경로에는 sops·age 실행 파일도 있지만 키 파일(`~/.config/sops`)은 보이지 않으므로 복호화할 수 없다.
- 홈은 작업 공간별 영속 디렉터리다(npm·pnpm 캐시가 여기에 쌓인다). 실제 사용자 홈은 보이지 않는다.
- 자원 상한: `systemd-run --user --scope --slice=helm-tools.slice`로 감싼다(17 §3.13의 단위별 `MemoryMax`·`TasksMax`·`RuntimeMaxSec`, 슬라이스 합계 한도. 18 §3.11.2). 사용자 systemd가 없으면 타임아웃만 쓴다.
- 타임아웃·취소: bwrap 프로세스(pid 네임스페이스의 init)에 SIGTERM, 5초 뒤 SIGKILL. 네임스페이스와 함께 모든 자식이 끝난다(원본 bash의 프로세스 트리 종료를 대신함).

`grep`·`find`도 같은 사양으로 실행하되 `writableRoots: []`, `network: 'none'`이다. 가림 파일이 검색에서 빠진다.

#### 3.6.3 네트워크 제한 [제안]

- 기본은 `none`이다(합의가 없거나 네트워크 부여가 없으면).
- `any`는 합의에 네트워크 부여(`net:*` 또는 호스트)가 있을 때만이다. 권한 레이어는 네트워크가 있는 실행을 `externalEffect: true`로 판정하고, 정보가 밖으로 나가는 행동(`disclose_data`)인지는 18의 규칙이 정한다.
- 호스트 단위 허용 목록(패키지 레지스트리만 등)은 사용자 공간 네트워킹(pasta/slirp4netns)이나 필터링 프록시가 필요해 1차에서 구현하지 않는다(§7 O-13-02).
- `git push`, 패키지 배포는 bash 안에서 네트워크와 `.git` 쓰기가 모두 부여된 경우에만 가능하다. 이런 행동은 권리 게이트(발송)로 다루도록 18에 규칙을 요구한다.

#### 3.6.4 비밀 노출 방지 [제안]

| 경로 | 조치 |
|---|---|
| 데몬 환경 변수(API 키) | 자식에 `--clearenv` 후 허용 목록만: `PATH`(도구 체인), `HOME`(샌드박스 홈), `LANG=C.UTF-8`, `LC_ALL`, `TZ`, `TERM=dumb`, `NO_COLOR=1`, `CI=1`, `HELM_RUN_ID`, `HELM_TOOL_CALL_ID`, 합의가 부여한 이름(비밀 패턴 이름은 부여 불가). `SSH_AUTH_SOCK`, `*_TOKEN`, `*_KEY`, `*_SECRET`, `SOPS_*`, `AWS_*`는 항상 제외. S0에서도 같은 허용 목록 |
| `/proc/<데몬 pid>/environ` | pid 네임스페이스(S1). S0에서는 막을 수 없으므로 데몬이 시작 때 키를 메모리로 옮기고 `process.env`에서 지운다(12 §3.3.4). 시작 환경 블록은 남으므로 S0은 비밀 보호 수준이 낮다고 표시한다 |
| 파일(`.env`, 키, 자격) | 최소 읽기 루트 + 가림 목록(§3.4.3) |
| 도구 출력에 섞인 비밀 | 데몬이 아는 비밀 값(시작 때 환경에서 읽은 키들)의 정확한 일치와 18의 패턴(16 §3.8 MK 목록과 공유)을 모델용 본문, `structuredContent`, 전체 출력 blob에서 `[REDACTED:<이름>]`으로 바꾼다. 마스킹 수는 결과 `details.redactions`에 남긴다 |
| 네트워크 유출 | 기본 `none`. 네트워크가 있는 실행은 권한 레이어 판정 대상 |
| MCP 서버 비밀 | 서버별로 설정에 적힌 환경 변수 이름만 그 서버 프로세스에 넘긴다(§3.9.2) |

#### 3.6.5 낮은 수준에서의 동작

- S1b: §3.6.2의 사양을 18 §3.11.2의 `systemd-run` 명령으로 옮긴다(`ReadWritePaths` = 쓰기 가능 루트, `InaccessiblePaths` = 보호 경로와 작업 공간 밖 홈, 네트워크가 없으면 `PrivateNetwork=yes`). 마운트 단위 강제라 쓰기 범위는 `pre`로 표시한다. pid가 분리되지 않으므로 화면에 "신호 격리 없음"을 보인다. 단위 기동 비용은 약 70ms다(18).
- S0(운영자 설정 때만): bash·grep·find는 `child_process.spawn(bash, ['-c', cmd], { cwd, env: 허용 목록, detached: true })`로 실행하고 프로세스 그룹을 죽여 끝낸다(원본 동작).
- 쓰기는 막지 못한다. `targetsKnown: false`, 변경 감지로 사후 검사(`post_hoc`). 감지할 수 없으면 `advisory`.
- 화면과 복귀 요약에 이 run의 보장 수준을 표시한다(21). "강제되지 않는 범위를 강제된 것처럼 표시"하지 않는다(01 PR-12, canon-2 L16).

#### 3.6.6 비용

bwrap 시작은 약 16ms다 [실험]. 변경 감지는 git 저장소에서 `git status` 두 번(수십 ms), 비 git 큰 트리는 최대 50,000 항목 walk다. 도구 호출당 수십~수백 ms가 더해진다. 읽기 도구(`read`, `ls`)는 데몬에서 바로 실행해 이 비용을 피한다.

### 3.7 Helm 제안 도구

#### 3.7.1 생성 규칙 [제안]

- 모델 채널(`M`)이나 보조 에이전트 채널(`X`)을 허용하는 10 §3.11의 명령마다 도구 하나를 만든다. 이름은 `helm_` + 명령 이름의 `.`을 `_`로 바꾼 것이다(예: `possibility.propose` → `helm_possibility_propose`).
- 입력 스키마는 10 `CommandSpec.payloadSchema`(TypeBox)에서 제출자가 새로 만드는 ID 필드(예: 새 가능성의 `possibilityId`)와 런타임이 채우는 필드(`contextRef`, 행위자, 상관 ID)를 뺀 닫힌 객체다. 10이 그런 필드에 `x-helm-generated: true` 주석을 달아 주기를 요구한다. 런타임이 ULID를 만들어 채운다. 모델이 ID를 지어내지 않게 한다.
- 근거 필드(`EvidenceRef`, 관찰 ID 목록)에는 `ob_…`, `tc_…`, 또는 제공자 도구 호출 ID(모델이 대화에서 보는 값)를 쓸 수 있다. 런타임이 같은 thread의 기록으로 관찰 ID로 바꾼 뒤 제출한다. 바꿀 수 없으면 그대로 넘겨 커널이 `content.ref_not_found`로 거부한다.
- 도구 결과 본문 끝에 `[helm] observation ob_… recorded for this result`를 붙인다(기본 도구의 결과에 12가 붙임). 모델이 근거로 인용할 ID를 알 수 있게 한다.
- `constrainedSampling: { type: 'json_schema', strict: 'prefer' }`를 쓴다(coding-agent 도구와 같음 [원문 pi-facts-1 §4.2 표]).
- 원시 행동은 없다(`primitive: null`). `replay`는 쓰지 않는다(원자적). `cancellation: 'atomic'`, `executionMode: 'sequential'`, `safeForRecoveryTurn: true`.

#### 3.7.2 제안 종류(14)와 도구 대응 [제안, 14·10과 맞출 것]

| 14 `ProposalKind` | 도구(10 명령) |
|---|---|
| `situation_answers` | `helm_situation_assess` |
| `frame_packet` | `helm_concern_reframe` |
| `loop_plan_draft` | `helm_loop_plan_set` |
| `transition_request` | `helm_loop_transition` |
| `split_hint`, `structure_op`, `boundary_item`, `recombine_summary` | `helm_concern_split`, `helm_concern_merge`, `helm_concern_detach`, `helm_concern_relocate`, `helm_concern_hold`, `helm_concern_recombine` |
| `question` | `helm_question_raise`, `helm_question_withdraw` |
| `goal_revise` | `helm_goal_revision_propose` |
| `autonomous_choice` | `helm_choice_decide` |
| `possibility`, `divergence_cell`, `choice_candidate` | `helm_possibility_propose` |
| `interpretation`, `reaction_interpretation` | `helm_interpretation_propose`, `helm_assumption_record` |
| `evidence_link` | `helm_claim_link_evidence`, `helm_claim_resolve_counter` |
| `counter_check` | `helm_claim_record_counter_search`, `helm_claim_declare_discrimination`, `helm_claim_bind_discrimination` |
| `promote_request` | `helm_finding_promote` |
| `prediction` | `helm_prediction_propose`, `helm_prediction_resolve` |
| `stimulus` | `helm_stimulus_present` |
| `criterion_candidate` | `helm_preference_criterion_propose` |
| `agreement_draft` | `helm_agreement_propose`, `helm_agreement_revise`, `helm_agreement_activate`, `helm_agreement_change_propose`, `helm_agreement_narrow`, `helm_agreement_restore`, `helm_agreement_cancel` |
| `probe_definition`, `probe_verdict` | `helm_probe_start`, `helm_probe_resolve` |
| `result_submission` | `helm_result_submit`, `helm_workunit_complete`(탐구 WorkUnit) |
| `counter_evidence` | `helm_claim_link_evidence`(counter), `helm_finding_contest`, `helm_result_report_verification` |
| `attest` | `helm_result_attest` |
| `obligation_resolution` | `helm_integration_obligation_resolve`, `helm_integration_obligation_transfer`, `helm_integration_obligation_propose` |
| `reflection` | `helm_reflection_record` |
| (항상, 해당 루프에서) | `helm_expectation_register`(외부로 보낼 때), `helm_concern_open`(승격 제안), `helm_rework_plan`, `helm_rework_complete`, `helm_contest_resolve`, `helm_goal_achievement_claim` |
| 중재자 | `helm_delivery_plan` |
| 대응 명령 미정 | `situation_summary`, `stabilization_report`, `obligation_deferral`(사람 전용 명령뿐), `watch_spec`, `watch_sample`, `watch_verdict`, `change_proposal` — 14·10이 명령을 정하면 같은 규칙으로 생성 |

#### 3.7.3 실행

```text
helm tool execute(tcId, params, ctx):                      # beforeToolCall은 펜싱·묶음 확인만 (12 §3.4.5)
  payload = fillGenerated(params)                          # 새 ID, 근거 ID 정규화
  tx:
    fence(h)
    d = tx.submit({ type: command, channel: role == 'work' or role == 'verifier' ? 'model_tool' : 'aux_agent',
                    actor: { kind: 'agent', role, runId, model }, contextRef: h.contextRefOf(requestId),
                    idempotencyKey: `tool:${tcId}`, correlation, payload })
    trace toolcall.state { tcId, state: 'completed', decisionRef: d.submissionId }
    trace toolcall.result { tcId, modelContent: render(d), structuredContent: toResult(d) }
  if d.status == 'needs_gate' and d.gate.blocking: h.pendingGates.add(d.gate.questionId)   # 12 §3.13
  return { content: [render(d)], structuredContent: toResult(d) }
```

```ts
export interface ProposalToolResult {
  status: 'accepted' | 'rejected' | 'needs_gate' | 'conflict' | 'error';
  command: string;
  createdRefs: string[];
  notices: { code: string; message: string }[];
  rejection?: { branch: 'content' | 'qualification' | 'path'; code: string; message: string;
                missing: string[]; next: { command: string; hint: string }[] };   // 10 §3.4.2에서 모델에게 주는 네 필드
  gate?: { questionId: QuestionId; blocking: boolean };
  cursor: number;
}
```

모델용 본문 형식(한두 줄): `accepted helm_possibility_propose: created ps_… (cursor 1234)` / `rejected [content.ref_not_found]: <10의 한국어 문장> | missing: … | next: helm_… — <힌트>` / `needs_gate: question qs_… raised (blocking). Stop and wait for the answer.`

제출과 결과 기록이 한 트랜잭션이므로 "의도만 있고 결과 없는" 상태가 없다. 크래시가 트랜잭션 전이면 아무것도 남지 않고(모델 호출은 다음 재개에서 재요청), 뒤면 결과가 있다. 멱등 키가 `tool:<tcId>`이므로 같은 호출을 두 번 제출해도 결과는 하나다.

#### 3.7.4 모델에게 주지 않는 명령

사람 채널(`H`)만 허용하는 명령은 도구가 없다: `goal.accept`, `goal.revision.accept/reject`, `goal.pause/resume/supersede/retire`, `goal.achievement.accept`, `finding.confirm/reject`, `preference.criterion.confirm/reject`, `choice.commit`, `decision.confirm`, `decision.contest`, `authority.grant/revoke`, `agreement.accept`, `agreement.renegotiate`, `agreement.suspend/resume`, `result.accept`, `integration.obligation.defer`, `question.answer`, `question.seen`, `situation.acknowledge`, `dial.set`, `policy.change.accept/reject`, `policy.set/retire`, 그리고 런타임·스케줄러 시스템 명령 전부. v0.2 실행 후보의 원칙(사람 권한 도구를 제공자에 아예 노출하지 않음, canon-2 §4.5)과 같다. 모델이 이런 이름의 도구를 부르면 루프가 `Tool … not found`로 끝낸다.

#### 3.7.5 도구 설명 지침 [제안]

- 모델용 설명은 영어로 짧게 쓴다(기본 도구와 같은 언어). 첫 문장은 "무엇을 제안하는가", 둘째 문장은 "커널이 무엇을 확인하는가"(예: "The kernel rejects evidence that is not a recorded observation.").
- 사용자에게 보일 텍스트 필드(서술, 질문 문장)는 한국어로 쓰라고 필드 설명에 적는다.
- propose와 commit, submit과 accept를 이름과 설명에서 구분한다(canon-2 §1.17).
- 설명은 1,024자 안에 둔다. 외부 런타임에 MCP로 노출할 때 가장 엄격한 런타임 제약(예: Codex 스킬 설명 1,024자 잘림)에 걸리지 않게 한다(extracts-1 E1-032, E1-047, Q15).

#### 3.7.6 조회 도구 `helm_query`

```ts
const HelmQueryParams = Type.Union([
  Type.Object({ op: Type.Literal('get'), ids: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) }),
  Type.Object({ op: Type.Literal('list'), type: StringEnum(RECORD_TYPES),
                filter: Type.Optional(Type.Object({ quality: Type.Optional(Type.String()), since: Type.Optional(Type.Number()) })),
                limit: Type.Optional(Type.Number({ maximum: 50 })), cursor: Type.Optional(Type.String()) }),
  Type.Object({ op: Type.Literal('tool_result'), toolCallId: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }),
  Type.Object({ op: Type.Literal('evidence_chain'), id: Type.String(), depth: Type.Optional(Type.Number({ maximum: 3 })) }),
]);
```

- 범위: run의 Concern 트리와 Goal 공용 레코드(10 V-FORM-07과 같은 범위). 형제 발산 가지의 기록은 보이지 않는다(12 §3.14.4). 검증 run은 작업 run의 대화 기록(실행 기록의 메시지)을 조회할 수 없다.
- 결과는 12 §3.5.4 렌더러의 한 줄 형식 + `structuredContent`로 레코드 JSON. 잘림 규칙은 `read`와 같다.
- `tool_result`는 생략된 이전 도구 결과(12 §3.5.7)를 다시 읽는 길이다.
- 원시 행동 `read`, `replay: 'safe'`.

#### 3.7.7 인자 지문 `fingerprintArgs` (11 §3.14의 요구)

```ts
// @helm/domain/fingerprint.ts — 커널(10)과 런타임이 같은 함수를 쓴다
export function fingerprintArgs(tool: string, executedArgs: unknown): `sha256:${string}` {
  // 1. executedArgs는 13 prepare가 정규화한 값(경로는 정규 절대 경로, 기본값 채움)
  // 2. JSON Canonicalization Scheme(RFC 8785)로 직렬화: 키 정렬, 숫자 표기 고정, 공백 없음
  // 3. sha256(`${tool}\n${jcs}`)
}
```

- 같은 행동이면 같은 지문이다. 모델이 경로를 상대·절대로 다르게 써도 정규화 뒤 같다.
- `approve_edited`(사람이 인자를 고침)는 고친 인자를 같은 `prepare` 정규화에 통과시킨 뒤 지문을 만든다(11).

#### 3.7.8 되돌릴 지점 생성 (11 §3.12의 요구) [제안]

활성 임시 가정이 있는 WorkUnit에서 첫 쓰기 의도 전에 런타임이 만든다(커널이 `content.rollback_point_required`로 알려 주거나, 런타임이 미리 조회).

| 작업 공간 | mechanism | 방법 | limitations |
|---|---|---|---|
| git 저장소 | `git_commit` | 작업 트리와 인덱스를 건드리지 않고 스냅숏 커밋을 만든다: 임시 인덱스(`GIT_INDEX_FILE=<tmp>`)에 `git add -A` → `git write-tree` → `git commit-tree` → `git update-ref refs/helm/rollback/<rb_id> <sha>` | `.gitignore` 대상은 포함 안 됨 |
| git 아님 | `file_snapshot` | 합의 쓰기 범위에 맞는 파일을 tar로 묶어 blob(최대 200 MB) | 범위 밖 파일, 200 MB 초과분 |

- 데몬이 직접 실행한다(모델 도구 아님). `refs/helm/*`은 데몬만 쓴다. 샌드박스에서는 `.git`이 읽기 전용이다.
- 등록: `rollback.register { mechanism, ref, coversTargets, limitations }`(10).
- 되돌리기는 `purpose: 'rollback'`인 도구 호출(파일 도구 또는 `git restore --source refs/helm/rollback/<id>`를 bash로)이고 일반 범위 검사를 받는다(11 §3.12).

#### 3.7.9 범위 프리셋 `draft_only`와 검증 격리 (11 §3.11·§3.13의 요구) [제안]

- `draft_only`: 쓰기 부여 = 초안 영역 `file:/srv/volumes/helm/drafts/<concernId>/**` 하나, 발송 없음, 실행은 네트워크 없이 쓰기 가능 루트 = 초안 영역. 초안 영역은 작업 공간 밖이므로 읽기 루트에도 더한다. 초안을 작업 공간에 반영하는 것은 새 합의가 필요하다.
- 자동 검증 실행(11 §3.13, `purpose: 'verification'`): git 작업 공간이면 후보마다 `git worktree add /srv/volumes/helm/worktrees/<runId>/<n> HEAD`로 격리 작업 트리를 만들고 그 트리를 쓰기 가능 루트로 한다. 결과는 원래 작업 공간에 반영하지 않는다. git이 아니면 `cp --reflink=auto`로 복사(500 MB 상한, 넘으면 검증 불가 알림). 작업이 끝나면 지운다.

### 3.8 하위 호출 도구와 REPL

#### 3.8.1 교정된 전제 [원문·실험]

| 이전 가정 | 사실 | 출처 |
|---|---|---|
| codemode 변수는 여러 턴에 걸쳐 남는다 | 실행마다 새 worker와 QuickJS VM. 변수와 `globalThis`는 한 번의 실행에서만 산다 | `pi-src/packages/codemode/src/runtime/host.ts:12-18`, pi-facts-1 §5.4 [실험 A2] |
| 스크립트에서 채팅 모델을 하위 호출할 수 있다(`llm_query`) | coding-agent `codemode`의 `models.*`는 목록 조회·분류기·이미지 생성뿐. 채팅 모델은 실행할 수 없다 | `coding-agent/src/extensions/codemode/execute.ts:623-733`, `docs/codemode.md:62` |
| 스크립트 상태가 자동 보존된다 | `store`/`load`는 호출자가 넘기고 `storeWrites`로 돌려받는다. 실패한 실행의 쓰기는 버려진다. 값당 256Ki자, 전체 1Mi자 | `codemode/src/types.ts:82-98, 140-149`, `prelude-source.ts:32-33` |
| 스크립트가 실패하면 효과도 없다 | 출력은 실패 지점까지 남고, 이미 실행된 도구 호출은 되돌려지지 않으며, store 쓰기만 버려진다 | extracts-1 E1-189 [실험 D] |

#### 3.8.2 `helm_subcall` [제안]

```ts
const HelmSubcallParams = Type.Object({
  prompt: Type.String({ maxLength: 20000, description: 'Task for a fresh model call with no tools and no conversation history.' }),
  inputs: Type.Optional(Type.Object({
    refs: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),      // 레코드·도구 결과 ID. 렌더링해 붙인다
    files: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),      // 작업 공간 경로. read 경로 정책, 합계 200 KB
  })),
  outputSchema: Type.Optional(Type.Unknown({ description: 'JSON Schema for a structured answer' })),
  maxOutputTokens: Type.Optional(Type.Number({ maximum: 4000 })),
});
```

| 항목 | 값 |
|---|---|
| 원시 행동 | spawn |
| 실행 | 12 §3.14.6 역할 호출(`subcall` 역할). 새 컨텍스트, 도구 없음, 부모 대화 기록 없음 |
| 결과 | 텍스트 또는 검증된 JSON(`structuredContent`). 출력은 관찰이 아니다(15 R5). 결과 본문 머리에 `[subcall output — model text, not an observation]` |
| 예산 | run 계정의 `subcalls` 차원과 비용 |
| 깊이 | 1. 하위 호출 안에서 도구·하위 호출 없음 |
| 동시성 | `executionMode: 'parallel'`. 한 배치에서 최대 4개(넘는 것은 다음 배치로 미루라는 오류) |
| replay | `safe`(외부 효과 없음). 메모 키 `subcall:<tcId>`로 크래시 뒤 재사용 |
| 취소 | immediate |

#### 3.8.3 REPL(`ReplPort`, 15 §3.12) [제안]

15 D15-7은 REPL 방식 탐구에 pi-codemode 샌드박스를 그대로 쓰고 전역 `helm.subcall`, `helm.ws`, `helm.emit`을 넣기로 했다. 이 문서는 그 등록과 격리를 정한다.

```ts
export interface ReplPort {
  run(req: ReplRequest): Promise<ReplResult>;
}
export interface ReplRequest {
  script: string;                       // async 함수 본문 (pi-codemode 규칙)
  owner: { runId: RunId; toolCallId?: ToolCallId; inquiryId?: string; stepId?: string };
  tools: readonly string[];             // 스크립트에서 부를 수 있는 도구. 기본: read, grep, find, ls, helm_query
  wsKey: string;                        // 실행 사이 값을 두는 비정본 작업 공간 키 (예: inquiryId)
  timeoutMs: number;                    // 기본 120,000, 최대 600,000 (pi 기본 300,000)
  memoryLimitBytes: number;             // 256 MiB (coding-agent 설정과 같음, execute.ts:56)
  lease: BudgetLease;
  signal?: AbortSignal;
}
export interface ReplResult {
  ok: boolean; value?: unknown;
  output: { type: 'text' | 'image'; text?: string }[];   // 모델로 갈 출력. 10,000 토큰 상한, 넘으면 앞뒤 + blob
  calls: { toolCallId: ToolCallId; name: string; status: 'ok' | 'error' | 'cancelled' }[];
  emitted: KernelCommandDraft[];        // helm.emit 버퍼. ok일 때만 dispatch
  wsWrites?: { set: Record<string, unknown>; delete: string[] };
  error?: { kind: 'script' | 'timeout' | 'aborted' | 'sandbox'; message: string };
  usage: UsageRecord;
}
```

| 전역 | 구현 | 규칙 |
|---|---|---|
| `tools.<name>(args)` | `CodemodeTool.execute` → pi-agent-core `runToolCall(call, { tools, beforeToolCall, afterToolCall, … })` | 중첩 호출마다 자기 `tc_`(부모 `toolCallId`를 `parentToolCallId`로)와 의도·결과 기록. 커널 검사를 똑같이 받는다(§3.5.6). 결과는 `outputSchema`가 있으면 `structuredContent`, 없으면 텍스트(coding-agent 방식, `codemode/tool.ts:12-17`) |
| `helm.subcall(prompt, opts)` | §3.8.2와 같은 역할 호출 | 메모 키 `repl:<owner>:<sha256(prompt+opts)>`로 같은 스크립트를 다시 실행해도 비용을 다시 쓰지 않는다(15 §3.12.9). 스크립트당 동시 4개 |
| `helm.ws.get/set/delete` | pi-codemode `store`/`load`(호출자가 넘기고 `storeWrites`로 받음) | 성공한 실행의 쓰기만 실행 기록 `repl.workspace_written { wsKey, set, delete }`로 남긴다. 다음 실행에 같은 키의 값을 재생해 넘긴다. 값당 256Ki자, 전체 1Mi자. 비정본이며 근거로 인용할 수 없다(15 R12) |
| `helm.emit(command, payload)` | 메모리 버퍼 | 스크립트가 성공했을 때만 순서대로 제출한다(15). 실패면 버린다 |
| `console.*`, `text()`, `image()`, `exit()` | pi-codemode 기본 | 출력 상한 적용 |

- 타이머, `fetch`, `process`, 모듈은 없다(QuickJS) [원문 codemode README]. 바깥 효과는 등록된 도구로만 일어난다.
- 스크립트 실행 자체는 `replay: 'never'`다. 중첩 호출은 각자의 replay로 복구한다(12 §3.7.2). 스크립트 중간에 부수효과가 있는 도구를 두지 말라는 규칙(E1-210)을 도구 설명에 적는다.
- 모델용 도구 `helm_code { script: string; timeout_ms?: number }`는 이후 단계다(§7 O-13-06). 1차에서 REPL은 15의 실행기만 `ReplPort`로 쓴다.
- 의존: `pi-codemode`는 pi 의존이 없고 외부 의존은 `quickjs-wasi` 하나다(pi-facts-1 §5.1). 가져오는 방식은 07.

### 3.9 MCP 도구 연결 [제안]

#### 3.9.1 설정

```ts
// 데몬 설정의 tools.mcp (06 §3.10이 파일 위치 소유)
export interface McpServerConfig {
  name: string;                                   // [a-z0-9-]{1,32}
  enabled: boolean;
  transport: { kind: 'stdio'; command: string[]; cwd?: string } | { kind: 'http'; url: string };
  env?: string[];                                 // 서버 프로세스에 넘길 환경 변수 이름(값은 데몬 환경, SOPS)
  headersFromEnv?: Record<string, string>;        // HTTP 헤더 이름 → 환경 변수 이름
  defaultPrimitive: PrimitiveAction;              // 기본: stdio = 'execute', http = 'send'
  tools?: Record<string, { primitive?: PrimitiveAction; replay?: 'never' | 'safe'; externalEffect?: boolean;
                           rights?: RightsCategory[]; exposure?: 'direct' | 'deferred' | 'hidden' }>;
  sandbox?: { writableRoots?: string[]; network: 'none' | 'any' };   // stdio 서버의 S1 사양
  exposure: 'direct' | 'deferred';                // 기본 'direct'. 도구가 많으면 'deferred'(§3.9.3)
}
```

#### 3.9.2 연결과 변환

- 클라이언트는 pi-mcp `McpClient`, 전송은 `StdioTransport` / `StreamableHttpTransport`다 [원문 `pi-src/packages/mcp/src/client.ts`, `transports/*`]. 서버는 처음 쓸 때 연결하고 데몬이 끝날 때 닫는다. stdio 서버 프로세스는 S1 샌드박스에서 띄운다(서버별 `sandbox`). 프로세스가 죽으면 지수 백오프로 다시 띄우고 상태 확인(17)에 보인다.
- 도구 이름: `mcp__<server>__<tool>`. 허용 문자 외는 `_`, 64자를 넘으면 해시 접미사(coding-agent 규칙 [원문 `coding-agent/src/extensions/mcp/tools.ts:79-90`]).
- 입력 스키마: `Type.Unsafe({ ...inputSchema, type: 'object' })` [원문 `mcp/README.md:36-56`]. TypeBox가 아닌 JSON Schema라 pi-ai 검증이 원시 타입 강제 변환을 한다(pi-facts-1 §2.6).
- 결과: `toLlmContent(result)`로 모델용 내용을 만든다 [원문 `mcp/src/protocol/content.ts:111-117`]. 텍스트 20 KiB 초과는 가운데를 자르고 전체를 blob에 둔다. `structuredContent`는 Helm 래퍼가 도구의 `outputSchema`로 검증한다(pi-mcp는 검증하지 않는다 [원문 `client.ts:142-151`]). 실패하면 `structuredContent`를 버리고 notice를 남긴다.
- MCP 도구 실패는 결과의 `isError`로 온다 [원문 `mcp/README.md:55`].
- 서버가 주는 `annotations`(readOnlyHint 등)는 검증되지 않은 힌트다 [원문 pi-facts-1 §4.9]. 원시 행동·replay·외부 효과는 설정으로만 정한다. 설정이 없으면 보수적 기본값(`defaultPrimitive`, `replay: 'never'`, http는 `externalEffect: true`).
- 권한 판정 대상: `mcp:<server>/<tool>` + 설정이 알려 주는 자원(있으면).
- 비밀: 서버 설정의 `env`·`headersFromEnv`에 적힌 이름만 넘긴다. MCP 서버 출력도 §3.6.4 마스킹을 거친다.

#### 3.9.3 노출

- 1차 기본은 `direct`다. 한 run의 MCP 도구가 20개를 넘으면 그 서버들을 `deferred`로 두고 검색 도구 `helm_tool_search { query }`(이름·설명 BM25, 상위 8개)로 찾게 한다. 찾은 도구는 다음 루프 전환 때 묶음에 들어간다(같은 run 안에서 묶음을 바꾸지 않음, 캐시 유지). 이 구조는 coding-agent의 `exposure`·tool search와 같은 방향이다(extracts-1 E1-202~205) [제안, §7 O-13-07].

### 3.10 권한 레이어 호출 지점 [결정 2 / 제안: 형식과 1차 규칙]

```ts
// packages/tools/src/permission.ts — 판정 규칙의 소유는 18
export interface PermissionLayer {
  readonly version: string;
  classify(action: ActionDescriptor): PermissionVerdict;          // 10 §3.6.5 타입. 동기, 순수
  argsPreview(action: ActionDescriptor): Record<string, unknown>; // 사람에게 보일 인자(11 §3.2), 비밀 가림
}
export interface ActionDescriptor {
  primitive: PrimitiveAction; tool: string; toolKind: ToolKind;
  executedArgs: unknown; targets: ResourceUri[]; targetsKnown: boolean;
  sandbox: 'S0' | 'S1b' | 'S1' | null; network: 'none' | 'any';
  mcp?: { server: string; tool: string; annotations?: Record<string, unknown> };
  workspaceRoot: string; concernId: ConcernId;
}
```

1차 기본 규칙(18이 확정하기 전 구현 기본값. 18 §3.11.6의 고정 기준선과 다르면 18이 우선한다):

| 행동 | targets | rightsCategories | reversibility | externalEffect | enforcement |
|---|---|---|---|---|---|
| 읽기 도구 | 읽은 경로 | [] | reversible | false | pre |
| write·edit | 대상 파일 | [] | git이 추적하는 깨끗한 파일이면 reversible, 아니면 unknown | false | pre |
| bash S1, 네트워크 없음 | 쓰기 가능 루트 | [] | unknown | false | pre |
| bash S1, 네트워크 있음 | 루트 + `net:*` | []. 단 명령에 `git push`, `npm publish`, `curl -X POST|PUT|DELETE`, `scp`, `rsync … :`, `ssh` 형태가 보이면 `speak_for_user`(질문을 더 하게 할 뿐 안전 장치로 쓰지 않음) | unknown | true | pre |
| bash S0 | [] | 위 패턴 동일 | unknown | 알 수 없음 → true | post_hoc |
| MCP | `mcp:<server>/<tool>` + 설정 자원 | 설정값. send 기본 `speak_for_user` | 설정값, 기본 unknown | 설정값 | pre(데몬이 호출 전에 막음) |
| `helm_subcall` | [] | [] | reversible | false | pre |

명령 패턴은 질문을 늘리는 쪽으로만 쓴다. 패턴이 없다고 안전하다고 보지 않는다(§3.5.2 (b) 기각 이유).

### 3.11 런타임 어댑터 인터페이스

#### 3.11.1 위치와 원칙 [결정 34 / 제안: 형식]

- 계약은 `@helm/runtime/adapter`에 둔다(06 §3.3). 1차 구현은 Helm 자체 런타임(12의 RunEngine) 하나다. Claude Code, Codex, pi CLI(RPC), ACP 어댑터는 이후 단계다.
- 어댑터는 자기 런타임의 훅·권한 콜백에서 Helm 제출을 만들고(10 §3.18.1), 결과를 런타임 방식(차단, 오류 결과, 계속)으로 돌려준다. 런타임 이벤트 이름을 도메인 어휘로 쓰지 않는다(06 P1).
- 어댑터는 능력 목록으로 자신을 설명한다. Helm은 보장 성질마다 수준을 계산하고 화면에 보인다. 능력이 없으면 멈추지 않고 보장 수준을 낮춘다(extracts-1 E1-009 "깨지지 않고 약해지기만", extracts-3 X3-8-22).

#### 3.11.2 타입

```ts
// packages/runtime/src/adapter/contract.ts
export interface RuntimeAdapter {
  readonly id: string;                              // 'helm' | 'claude-code' | 'codex' | 'pi-rpc' | 'acp:<agent>'
  readonly displayName: string;
  probe(): Promise<AdapterProbe>;                   // 설치·버전·실제 능력 확인
  startRun(spec: AdapterRunSpec, gate: KernelGate, sink: NeutralEventSink): Promise<AdapterRun>;
  resumeRun?(ref: AdapterSessionRef, spec: AdapterRunSpec, gate: KernelGate, sink: NeutralEventSink): Promise<AdapterRun>;
}
export interface AdapterProbe { available: boolean; version?: string; manifest: CapabilityManifest; problems: string[] }

export interface AdapterRunSpec {
  runId: RunId; threadId: ThreadId; concernId: ConcernId; workUnitId?: WorkUnitId;
  role: AgentRole; workspaceRoot: string; cwd: string;
  delivery: ContextDelivery;                        // 어댑터 능력에 맞게 12가 만든 투영
  tools: { basic: readonly string[]; helm: readonly string[] };   // §3.2 묶음. 어댑터가 자기 도구 이름으로 매핑
  scope: EffectiveScope;                            // §3.5.3
  budget: RunBudget;
}
export type ContextDelivery =
  | { mode: 'per_request'; build: (cursor: number) => Promise<ProjectedContext> }      // Helm, pi RPC(context 훅)
  | { mode: 'append'; initial: string; deltas: AsyncIterable<string> }                  // 처음 지시 + 주입 메시지
  | { mode: 'instructions_only'; text: string };                                        // 지시 파일만

export interface AdapterRun {
  readonly sessionRef: AdapterSessionRef;           // { runtime, nativeSessionId, path? } — 16의 adapterSessionRef와 같음
  send(input: RunInput): Promise<'delivered' | 'queued' | 'unsupported'>;
  interrupt(): Promise<void>;
  cancel(): Promise<void>;
  readonly done: Promise<{ reason: RunEndReason; detail?: string }>;
}

/** 어댑터가 체크포인트마다 부르는 Helm 쪽 함수. 자체 런타임에서는 12의 훅 구현과 같다 */
export interface KernelGate {
  beforeTool(call: NeutralToolCall): Promise<GateDecision>;          // 의도 커밋 포함
  afterTool(result: NeutralToolResult): Promise<void>;               // 결과 커밋, 관찰
  turnBoundary(info: { turn: number; hadToolCalls: boolean }): Promise<{ action: 'continue' | 'end' | 'default'; inject?: string }>;
  usage(u: UsageRecord): Promise<void>;
}
export type GateDecision =
  | { allow: true; executedArgs?: unknown }                          // argRewrite 능력이 없으면 executedArgs는 무시되고 원래 인자와 다르면 block
  | { allow: false; reason: string; terminate?: boolean };

export interface NeutralToolCall {
  callId: string; idSource: 'runtime' | 'adapter_assigned';
  toolName: string;                                 // 런타임 이름
  helmTool?: string;                                // 어댑터가 Helm 기본 도구 의미로 매핑한 이름(read/write/edit/bash…)
  primitive: PrimitiveAction | null;
  input: unknown; targets?: ResourceUri[]; targetsKnown: boolean;
}
export interface NeutralToolResult { callId: string; ok: boolean; content: string; structured?: unknown;
  changes?: ChangeSet; durationMs?: number; observedBy: 'runtime_event' | 'adapter_inferred' }
```

#### 3.11.3 능력 목록과 중립 이벤트 어휘

```ts
export interface CapabilityManifest {
  schema: 'helm.adapter-capabilities.v1';
  runtime: { family: 'helm' | 'claude-code' | 'codex' | 'pi' | 'acp'; version: string };
  transport: readonly ('in_process' | 'sdk' | 'stdio_jsonrpc' | 'rpc_jsonl' | 'acp')[];
  capabilities: {
    contextDelivery: 'per_request' | 'append' | 'instructions_only';
    preToolInterception: 'blocking' | 'advisory' | 'none';
    argRewrite: boolean;
    toolObservation: 'full' | 'partial' | 'none';
    toolCallIds: 'stable' | 'synthetic';
    shellSandbox: 'helm_bwrap' | 'runtime_native' | 'none';
    fileWriteMediation: 'helm_tools' | 'client_fs' | 'none';
    turnBoundaryControl: boolean;
    steering: 'native' | 'queue' | 'none';
    cancel: 'cooperative' | 'process_kill' | 'none';
    resume: 'durable' | 'session_file' | 'none';
    newContext: boolean;
    structuredToolOutput: boolean;
    usageReporting: 'per_request' | 'per_run' | 'none';
    interactiveGate: 'native' | 'tool_based' | 'none';
  };
  limitations: readonly string[];
}
```

원전의 Level A~D는 두 정의가 서로 달랐다(canon-2 §1.15 문서판과 실행 후보판). 이 문서는 능력 목록에서 Level을 계산하는 한 가지 정의로 맞춘다 [제안].

| Level | 조건 |
|---|---|
| A Bridge | `contextDelivery = instructions_only`, Helm 도구는 CLI·MCP로만 |
| B Observe | A + `toolObservation = full` |
| C Directed | B + `preToolInterception = blocking` + `cancel ≠ none` + `contextDelivery ≠ instructions_only` |
| D Native | C + `contextDelivery = per_request` + `turnBoundaryControl` + `steering ≠ none` + `resume ≠ none` + `newContext` |

중립 이벤트 어휘(어댑터 → Helm, 06 §3.13.3과 맞춤):

| 이벤트 | 내용 | Helm 처리 |
|---|---|---|
| `session.started` | `nativeSessionId` | `run.start` 제출(`adapterSessionRef`, 16 요구) |
| `turn.started` / `turn.ended` | turn 번호 | 경계, `turnBoundary` |
| `message.delta` | 텍스트 조각 | 휘발 스트림 |
| `message.completed` | 역할, 텍스트, 도구 호출 목록 | 실행 기록 `message.committed` |
| `tool.requested` | `NeutralToolCall` | `beforeTool` (가로채기가 없으면 사후 기록만) |
| `tool.started` / `tool.output` | 진행 | 휘발 |
| `tool.completed` | `NeutralToolResult` | `afterTool` |
| `usage.reported` | 사용량 | 예산 |
| `question.raised` | 런타임 자체 UI의 질문(선택, 확인, 입력) | Helm 질문으로 바꿈(11). 답을 런타임에 돌려줌 |
| `run.ended` | 사유 | `run.end` |
| `error` | 오류 | 운영 로그, 필요하면 `run.end failed` |

#### 3.11.4 런타임별 능력과 한계 [제안. 표의 런타임 사실은 아래 표시]

| 항목 | Helm 자체(1차) | Claude Code (Agent SDK) | Codex (app-server) | pi CLI (`--mode rpc` + 주입 확장) | ACP 일반 |
|---|---|---|---|---|---|
| 가로채기 | `beforeToolCall` 차단·인자 교체 [원문 12] | `canUseTool` 콜백(허용·거부, 입력 교체), `PreToolUse` 훅 [원문 존재: paseo `claude/agent.ts:3417`, `claude/hooks.test.ts`; 의미는 지식] | 명령 실행·파일 변경마다 승인 요청(`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) [원문 존재: paseo `codex-app-server-agent.ts:3949-3952`; 승인 정책 `untrusted`일 때 모든 명령 지식] | 주입 확장의 `tool_call` 차단, `event.input` 제자리 수정 [원문 `coding-agent/src/core/extensions/types.ts:1426-1428`] | `session/request_permission`: 에이전트가 묻기로 한 호출만 [원문 존재: paseo `acp-agent.ts:2556`; 범위는 지식] |
| 인자 교체 | 예 | 예(입력 교체) [지식] | 아니오(승인·거부만) [지식] | 예 | 아니오 |
| bash 범위 | S1 bwrap (helm_bwrap) | 명령 문자열만 보임. Claude Code 자체 샌드박스 설정 [지식, 확인 필요] → runtime_native 또는 none | Codex 샌드박스 `workspace-write` + writable roots(Linux는 Landlock·seccomp) [지식] → runtime_native | bash 도구를 확장에서 Helm 샌드박스 Operations로 바꿔 등록(pi-chat 방식 [원문 cases §10.2]) → helm_bwrap | 에이전트가 `terminal/create`를 쓸 때만 클라이언트가 실행 [원문 존재: paseo `acp-agent.ts:2712`] → 대개 none |
| 파일 쓰기 매개 | Helm 도구 | 없음(자체 도구) | 파일 변경 승인에 패치가 실림 [지식] | 확장에서 write·edit를 Helm 도구로 교체 가능 | `fs/write_text_file`은 에이전트 선택 [지식] |
| 컨텍스트 전달 | per_request | append(시스템 프롬프트 덧붙임 + 사용자 메시지) | append | per_request 가능(`context` 확장 이벤트 [원문 pi-facts-1 §4.9 이벤트 목록]) | instructions_only~append |
| 도구 ID·결과 | stable, full | stable(tool_use id) [지식] | stable(item id) [지식] | stable(`toolCallId`) [원문 RPC 이벤트] | stable(toolCallId) [지식] |
| turn 경계 제어 | 예(`finishTurn`) | 부분(Stop 훅) [지식] | 부분 | 예(`agent_before_settle`) [원문 extensions types:994-1002] | 아니오 |
| steering | 예 | 예(스트리밍 입력) [지식] | 예(`turn/steer` 계열) [지식, 확인 필요] | 예(RPC `steer`, `follow_up`) [원문 `rpc-types.ts`] | 아니오(cancel 뒤 새 prompt) |
| 재개 | durable(12 §3.7) | session_file(세션 ID로 resume) [지식] | session_file(thread rollout) [지식] | session_file(`--session <file>`) [원문 S4/paseo §2] | `session/load` 선택 [지식] |
| 새 컨텍스트 | 예 | 예(새 세션) | 예 | 예 | 예 |
| 도달 Level | D | C(가로채기·취소 있음, 컨텍스트 append) | C | D에 가까움(재개만 session_file) | A~B |

#### 3.11.5 보장 성질과 수준 계산

| 성질 | `enforced` 조건 | `detected` 조건 | 그 밖 |
|---|---|---|---|
| G1 파일 쓰기 범위 | `preToolInterception = blocking`이고 쓰기 도구가 Helm 도구이거나 인자로 대상을 알 수 있음 | 실행 뒤 변경 감지 가능(§3.5.4) | advisory |
| G2 bash·실행 쓰기 범위 | `shellSandbox = helm_bwrap` | `runtime_native`(런타임 샌드박스에 Helm이 계산한 쓰기 가능 루트를 설정) 또는 변경 감지 | advisory |
| G3 실행 의도 선기록 | `preToolInterception = blocking` | - | unavailable(결과만 기록) |
| G4 관찰 출처 = 도구 호출 | `toolObservation = full`, `toolCallIds = stable` | `partial` 또는 `synthetic`(관찰에 `sourceConfidence: 'adapter_assigned'`, 10 §3.18.3) | unavailable |
| G5 컨텍스트 = 투영 (A11) | `contextDelivery = per_request` | `append`(처음 snapshot + delta) | advisory(`instructions_only`) |
| G6 크래시 복구 | `resume = durable` | `session_file`(런타임이 재개, Helm은 결과 불명 정리만) | unavailable(run 손실, 새 run) |
| G7 사람 결정 경로 분리 | 사람 권한 도구를 런타임에 노출하지 않을 수 있음 | - | 런타임이 자체 승인 UI를 가지면 그 승인은 Helm 질문으로만 응답(어댑터가 자동 응답 금지) |
| G8 독립 검증 컨텍스트 | `newContext` | 별도 프로세스 | - |

run마다 계산한 수준을 `run.start` 페이로드와 이벤트의 `enforcement`에 넣고(10 §3.18.3), 화면에 성질별 배지로 보인다(21). advisory로 실행된 쓰기는 커널이 반영 항목 "사후 범위 확인"을 만든다(10 §3.18.3).

#### 3.11.6 능력이 없을 때 낮춰 동작하는 규칙 [제안]

| 없는 능력 | 동작 |
|---|---|
| 가로채기(blocking) | 쓰기가 있는 run은 격리 작업 트리(`git worktree`, `/srv/volumes/helm/worktrees/<runId>`)에서 실행한다. 끝난 뒤 변경 목록을 범위와 비교하고, 범위 안이면 반영(merge)을 사람에게 묻고, 밖이면 반영하지 않는다(extracts-3 X3-8-22, v0.3 08 §8). git이 아닌 작업 공간은 이 런타임으로 쓰기 run을 하지 않는다 |
| 인자 교체 | `GateDecision.executedArgs`가 원래 인자와 다르면 허용 대신 차단하고 이유에 정규 인자를 적는다(모델이 다시 내게) |
| 도구 ID | 어댑터가 `adapter_assigned` ID를 만든다. 관찰의 출처 신뢰도를 낮게 표시 |
| turn 경계 제어 | 실행 단위를 작게(한 WorkUnit 단계씩) 나눠 매번 새 run으로 실행. 막는 질문이 열려 있으면 다음 run을 시작하지 않는다(10 §3.18.3) |
| steering | 입력은 `queued`로 받고 다음 run에 넣는다 |
| 재개 | 크래시 뒤 run을 `interrupted`로 닫고 요약을 주입한 새 run을 시작한다 |
| 새 컨텍스트 | 검증·중재는 Helm 자체 런타임으로 돌린다 |
| Helm 도구 등록 | Helm 제안 도구를 데몬의 MCP 서버(로컬, 기기 토큰 인증)로 노출한다. 이 경로의 제출도 `model_tool` 채널과 run 등록을 거친다 |
| 데몬 연결 끊김(어댑터가 데몬 밖에서 도는 경우) | 쓰기·실행·발송 도구는 차단(fail-closed), 읽기만 허용. 결과·이벤트는 멱등 키와 함께 로컬에 쌓았다가 재연결 때 보낸다(extracts-4 17-7의 미결을 이렇게 정함) |

#### 3.11.7 어댑터 적합성 시험

모든 어댑터가 같은 대본(가짜 모델 또는 런타임별 녹화 응답)으로 다음을 통과해야 한다. 광고한 능력과 결과가 다르면 실패다(canon-2 §1.23, 10 §3.18.4).

| 번호 | 시험 | 확인 |
|---|---|---|
| AC-01 | probe | `manifest`가 실제 동작과 같다(아래 시험으로 교차 확인) |
| AC-02 | 차단 준수 | `beforeTool`이 거부한 쓰기가 실행되지 않는다(파일 해시 불변) |
| AC-03 | 인자 교체 | 광고했으면 교체 인자로 실행된다 |
| AC-04 | 의도 선기록 | 실행 시작 전에 의도가 커밋되어 있다(가로채기 광고 시) |
| AC-05 | 결과·ID | 모든 실행 호출의 결과가 같은 ID로 돌아온다 |
| AC-06 | 범위 밖 쓰기 | 쓰기 가능 루트 밖 쓰기가 막히거나(enforced) 감지된다(detected) |
| AC-07 | 중복 이벤트 | 같은 이벤트를 두 번 보내도 기록이 하나다 |
| AC-08 | 연결 끊김 | 끊긴 동안 쓰기 도구가 차단되고 재연결 뒤 쌓인 기록이 들어온다 |
| AC-09 | 질문 | 런타임 자체 질문이 Helm 질문이 되고 답이 런타임에 돌아간다 |
| AC-10 | 취소·steering | 광고했으면 동작 |
| AC-11 | 재개 | 광고했으면 크래시 뒤 이어서 실행되고 결과 불명 처리가 12 §3.7과 같다 |
| AC-12 | 같은 도메인 결과 | 10 §3.17.4 커널 대본을 돌려 도메인 이벤트 열(타입, 행위자 종류, 대상, 핵심 페이로드)이 자체 런타임과 같다 |

## 4. 실패·예외·경계 사례

| 번호 | 사례 | 처리 | 근거 |
|---|---|---|---|
| T-E01 | 모델이 `~/.ssh/id_ed25519`를 `read` | 경로 정책 거부(`path.masked`), 실행 기록 `toolcall.denied_by_path_policy` | §3.4.3 |
| T-E02 | 작업 공간 안 심볼릭 링크가 밖을 가리킴 | 정규화 뒤 밖으로 판정 → 쓰기 거부. bash는 마운트로 막힘(EROFS) | §3.4.2, 실험 7번 |
| T-E03 | 하드링크된 파일에 쓰기 | `hardlinked_file` 거부 | §3.3.4 |
| T-E04 | prepare와 쓰기 사이에 파일이 바뀜 | `edit`: `file_changed_since_prepare` 오류 결과(모델이 다시 읽음). `write`: 쓰기 전 해시 재확인 실패 시 같은 오류 | §3.3.4 |
| T-E05 | `/proc/self/fd`로 확인한 실제 경로가 다름 | 쓰지 않고 `path_changed` | §3.3.4 |
| T-E06 | 합의 없음 상태의 bash가 파일을 쓰려 함 | 읽기 전용 샌드박스라 EROFS. 모델에게는 명령 출력 그대로 + 도구 설명의 규칙 | §3.5.3 |
| T-E07 | 합의가 파일 단위 부여뿐인데 bash로 쓰려 함 | 쓰기 가능 루트 없음 → EROFS. 모델은 파일 도구를 쓰거나 범위 확대 요청 | TL-4 |
| T-E08 | bwrap 없음 | S1b(`systemd-run --user`)로 낮춤. 그것도 안 되면 `execute` 도구를 끔. S0은 운영자 설정 때만 | §3.6.1, 18 §3.11.2 |
| T-E09 | userns가 꺼진 커널 | bwrap 실패 → S1b 시도 → 실패면 `execute` 끔 | §3.6.1 |
| T-E10 | 작업 공간이 `/mnt/c/...` | 보장 수준 advisory, 화면 경고 | §3.4.1 |
| T-E11 | `rg` 없음 | `tool.binary_missing` 오류 결과. 내려받지 않음 | §3.3.6 |
| T-E12 | bash 출력이 50 MiB 넘음 | 앞뒤 25 MiB만 blob, 모델용은 꼬리 50 KiB | §3.3.2 |
| T-E13 | bash가 백그라운드 프로세스를 남김 | 명령이 끝나면 pid 네임스페이스와 함께 종료 | §3.3.5 |
| T-E14 | 타임아웃 | bwrap에 SIGTERM, 5초 뒤 SIGKILL. `Command timed out after N seconds` | §3.6.2 |
| T-E15 | 비밀이 출력에 섞임 | `[REDACTED:<이름>]`, 마스킹 수 기록 | §3.6.4 |
| T-E16 | 네트워크 없는 샌드박스에서 `pnpm install` | 이름 해석 실패 오류. 모델은 범위 확대(네트워크) 요청 | §3.6.3 |
| T-E17 | 네트워크 있는 샌드박스에서 데몬 루프백 포트에 접속 | 기기 토큰이 없어 거부(18·19 요구) | §3.6.2 |
| T-E18 | 변경 감지가 50,000 항목 초과 | `measured: false`. S1에서는 정보 손실만, S0에서는 `advisory` | §3.5.4 |
| T-E19 | Syncthing이 실행 중 파일을 바꿈 | 변경 목록에 섞일 수 있음. `concurrentWritersPossible` 표시 | §3.4.4 |
| T-E20 | 모델이 사람 전용 명령 이름의 도구를 부름 | 도구 없음(`Tool … not found`) | §3.7.4 |
| T-E21 | 모델이 근거에 제공자 호출 ID를 씀 | 런타임이 관찰 ID로 바꿈. 바꿀 수 없으면 커널 거부 | §3.7.1 |
| T-E22 | Helm 제안 도구 트랜잭션 실패 | 아무것도 남지 않음. 도구는 오류 결과(`journal_unavailable`)를 돌려주고 run은 12 E-02처럼 실패 예약 | §3.7.3 |
| T-E23 | REPL 스크립트가 중간에 throw | 출력은 그 지점까지, 실행된 중첩 호출은 기록·유지, `helm.ws` 쓰기와 `helm.emit`은 버림 | §3.8.1, §3.8.3 |
| T-E24 | REPL 무한 대기 promise | pi-codemode가 즉시 실패시킴 [실험 C: extracts-1 E1-184] | §3.8.3 |
| T-E25 | MCP 서버 크래시 | 진행 중 호출은 오류 결과, 서버 재시작(백오프), 상태 확인에 표시 | §3.9.2 |
| T-E26 | MCP `structuredContent`가 `outputSchema`와 다름 | `structuredContent` 버리고 notice | §3.9.2 |
| T-E27 | MCP 서버 annotations가 readOnly라고 주장 | 무시. 설정값만 사용 | §3.9.2 |
| T-E28 | 외부 어댑터가 광고와 다르게 차단을 무시 | 적합성 시험 실패로 어댑터 비활성. 운영 중 발견되면 run 중지와 `scope.violation_detected` | §3.11.7 |
| T-E29 | 어댑터와 데몬 연결 끊김 | 쓰기 차단, 기록 버퍼 | §3.11.6 |
| T-E30 | 되돌릴 지점 생성 실패(git 오류, 200 MB 초과) | 쓰기 의도를 내지 않고 질문(정보 게이트)으로 사람에게 알림. 커널은 지점이 없으면 거부(11 V-AS-03) | §3.7.8 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 대상 | 제공 |
|---|---|
| 10 | 자원 URI 문법(§3.4.1), `PermissionVerdict`를 채우는 방법(§3.10), `fingerprintArgs`(§3.7.7), bash의 `targets`·`targetsKnown`(§3.5.3), `observedChanges`(ChangeSet), Helm 제안 도구 생성 규칙(§3.7.1) |
| 11 | 되돌릴 지점 생성(§3.7.8), `draft_only` 프리셋과 검증 격리(§3.7.9), `argsPreview` 가림(§3.10) |
| 12 | `HelmToolSpec`의 `prepare`·`postprocess`·`replay`·`replayGuard`·`safeForRecoveryTurn`·`cancellation`, 변경 감지 `snapshot`/`diff`, 샌드박스 수준 |
| 14 | `ProposalKind` → 도구 대응(§3.7.2), 원시 행동 → 기본 도구 대응(§3.2.2) |
| 15 | `ReplPort`(§3.8.3), `EvidenceToolset` → 도구 묶음(§3.2.3), `helm_subcall` |
| 16 | `adapterSessionRef`(§3.11.2), 경로 정책 거부·변경 감지·마스킹 기록 |
| 17 | `bwrap` 요구 버전, 샌드박스 홈·초안·작업 트리 경로(`/srv/volumes/helm/{sandbox,drafts,worktrees}`), `rg`·`fd`·`git` 확인 항목 |
| 18 | 1차 권한 규칙 표(§3.10), 샌드박스·가림·환경 허용 목록(§3.6) |
| 21 | 성질별 보장 수준(§3.11.5), 샌드박스 수준 표시 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 07 | coding-agent 도구 파일 포크 범위(§3.3.1). `pi-codemode`, `pi-mcp` 가져오기 방식. 이미지 처리 모듈 |
| 08 | `ResourceUri`/`ResourcePattern` 타입을 `@helm/domain`에. Concern·WorkUnit의 `workspaceRoot`. 관찰 출처 신뢰도(`sourceConfidence`) 필드 |
| 10 | 명령 페이로드 스키마에 `x-helm-generated` 주석(§3.7.1). 작업 공간 밖 쓰기 부여 거부. 대응 명령이 없는 제안 종류(§3.7.2 마지막 행)의 명령. `ScopeSpec`에 네트워크 부여 표현(`net:` 자원) |
| 11 | `approve_edited`의 고친 인자 본문을 답 payload로(12 §3.13.2와 함께) |
| 14 | `ProposalKind`가 위 대응과 맞는지. `EvidenceToolset`의 문서 루트 설정 위치 |
| 15 | `ReplPort` 요청·결과 형식 확정. `helm.subcall` 메모 키 규칙 |
| 17 | `bubblewrap` 설치·확인, 사용자 systemd(`systemd-run --user`) 사용 가능 여부, 샌드박스 홈 정리 정책, 데몬 리스너의 루프백 인증 |
| 18 | 권한 레이어 규칙 확정(§3.10 표 대체), 비밀 마스킹 패턴 목록 공유(16 MK와 같은 소스), 네트워크가 있는 실행의 권리 범주 |
| 19 | 데몬 소켓·자격 파일 경로를 가림 목록에 넣을 수 있게 고정 경로로 |
| 21 | 보장 수준 배지, "격리 없음" 경고 |

## 6. 구현 단위와 완료 기준

| 단위 | 파일 | 완료 기준 (테스트) |
|---|---|---|
| U-TL-1 도구 모델 | `packages/tools/src/spec.ts`, `wrap.ts` | T-TL-01 `toAgentTool`이 atomic 도구에 abort를 전달하지 않음. T-TL-02 이름 충돌 시 시작 실패 |
| U-TL-2 경로 정책 | `path/canonicalize.ts`, `path/policy.ts` | T-PA-01 `@`, `~`, `file://`, 상대, `..`, 유니코드 공백 정규화 표 시험. T-PA-02 링크가 밖을 가리키면 밖. T-PA-03 가림 목록 전 항목 거부. T-PA-04 새 파일 경로(존재하지 않는 부모) 처리. T-PA-05 `/mnt/c` 판정 |
| U-TL-3 기본 도구 | `basic/{read,write,edit,bash,grep,find,ls}.ts` | T-BT-01 원본 테스트 중 렌더러 무관한 것 이식(잘림 안내 문구, edit 매칭 실패 메시지, bash 종료코드). T-BT-02 `write`/`edit`의 `replayGuard` before/after가 실제 결과 해시와 같다. T-BT-03 `/proc/self/fd` 경로 변경 감지. T-BT-04 rg/fd 없음 → `tool.binary_missing`, 다운로드 0회 |
| U-TL-4 샌드박스 | `sandbox/bwrap.ts`, `sandbox/env.ts` | T-SB-01 `P7/exp-bwrap.sh`의 9개 확인을 Vitest로(쓰기 루트, 덧씌움, 루트 밖, `.helm`, 링크, 비밀 가림, 네트워크, env, pid). T-SB-02 최소 루트에서 node·git·rg 동작(`exp-bwrap-minroot.sh`). T-SB-03 타임아웃 시 자식 프로세스 0개 남음. T-SB-04 bwrap 없을 때 S1b 강등(18 §3.11.4의 여섯 확인 통과)과 표시, S1b도 없을 때 `execute` 도구 제외 |
| U-TL-5 범위 계산 | `scope/effective.ts` | T-SC-01 `ScopeSpec` → 쓰기 가능 루트 표 시험(하위 트리 전체만 루트, 중첩 제거, `.git` 덧씌움). T-SC-02 합의 없음 → 루트 없음, 네트워크 없음. T-SC-03 bash `targets`가 커널 `covers`를 통과 |
| U-TL-6 변경 감지 | `changes/detector.ts` | T-CD-01 git 방식: 생성·수정·삭제·모드, HEAD 이동. T-CD-02 scan 방식과 50,000 상한. T-CD-03 스냅숏 blob으로 재시작 뒤 `diffSince` |
| U-TL-7 비밀 마스킹 | `secrets/redact.ts` | T-RD-01 환경 비밀 값 정확 일치, 패턴 일치, blob 포함 |
| U-TL-8 Helm 제안 도구 | `helm/generate.ts`, `helm/execute.ts`, `helm/query.ts` | T-HT-01 10 명령 스펙에서 생성한 도구 스키마 스냅숏(생성 필드 제거). T-HT-02 근거 ID 정규화. T-HT-03 제출과 결과가 한 트랜잭션(중간 실패 주입 시 둘 다 없음). T-HT-04 사람 전용 명령 도구가 없음. T-HT-05 `helm_query` 범위(형제 가지, 다른 Concern 트리 차단) |
| U-TL-9 지문 | `@helm/domain/fingerprint.ts` | T-FP-01 JCS 정규화 표 시험, 상대·절대 경로가 같은 지문 |
| U-TL-10 되돌릴 지점 | `rollback/*` | T-RB-01 git 스냅숏이 작업 트리·인덱스를 바꾸지 않음. T-RB-02 tar 스냅숏과 상한. T-RB-03 복원 |
| U-TL-11 하위 호출·REPL | `subcall.ts`, `repl/*` | T-RP-01 중첩 도구 호출마다 의도·결과 기록과 커널 검사. T-RP-02 실패 시 `ws`·`emit` 폐기. T-RP-03 `helm.subcall` 메모 재사용. T-RP-04 변수 수명(두 번째 실행에서 `globalThis` 값 없음) |
| U-TL-12 MCP | `mcp/*` | T-MC-01 이름 규칙. T-MC-02 `outputSchema` 검증 실패 처리. T-MC-03 stdio 서버 샌드박스 실행. T-MC-04 env 허용 목록 |
| U-TL-13 권한 레이어 | `permission.ts` | T-PL-01 §3.10 표의 각 행 |
| U-AD-1 어댑터 계약 | `runtime/src/adapter/contract.ts`, `helm-adapter.ts` | T-AD-01 자체 런타임이 AC-01~AC-12 통과(Level D). T-AD-02 능력 목록에서 Level·성질별 수준 계산 표 시험 |

## 7. 미결 사항

| 번호 | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| O-13-01 | 기본 격리 | S1 bwrap / S1b systemd-run / S0 / 컨테이너 | S1 bwrap(설치 필요, 17), 없으면 S1b, 둘 다 없으면 `execute` 끔(18과 같음) |
| O-13-02 | 네트워크 호스트 허용 목록 | 없음(none/any) / 필터링 프록시 + pasta / Landlock TCP 포트 | 1차 none/any. 사용 빈도를 보고 2차에 프록시 |
| O-13-03 | 범위 밖 변경 자동 되돌리기 | 안 함 / 되돌릴 지점이 있으면 제안 / 자동 | 안 함. 질문에 되돌리기 선택지(11) |
| O-13-04 | 오래 도는 프로세스(개발 서버) 도구 | 없음 / `helm_process_start/stop/logs` | 1차 없음 |
| O-13-05 | 웹 도구(`web_fetch`, `web_search`) | 1차 제외 / 포함 | 제외. `read_web`은 `read_docs`로 낮춤 |
| O-13-06 | 모델용 `helm_code` 도구 | 1차 제외(15 실행기만 REPL) / 포함 | 제외 |
| O-13-07 | MCP 노출 기본 | direct / deferred + 검색 | direct, 20개 초과 시 deferred |
| O-13-08 | `.git` 쓰기 | 항상 읽기 전용 / 합의가 `.git/**` 부여 시 허용 | 부여 시 허용. 커밋·푸시는 권리 게이트 후보(18) |
| O-13-09 | `/dev/null` 대신 빈 파일 가림 | 빈 파일 / tmpfs 디렉터리 단위 | 빈 파일(실험에서 `/dev/null`은 git이 변경으로 보임) |
| O-13-10 | 샌드박스 홈을 작업 공간별로 둘지 전역 하나로 둘지 | 작업 공간별 / 전역 | 작업 공간별(캐시가 섞이지 않음) |
| O-13-11 | Landlock을 bwrap 안에 겹쳐 적용 | 안 함 / 적용 | 1차 안 함 |
| O-13-12 | 외부 런타임 어댑터 순서 | pi RPC → Claude Code → Codex → ACP / 다른 순서 | pi RPC 먼저(도달 Level이 가장 높고 사용자가 이미 씀). 23이 정함 |

## 8. 출처

- 브리프: 결정 2, 4, 14, 15, 23, 28, 34, §2.5, §3.5(bash 우회, REPL 교정, 벤더 중립).
- pi 소스(`~/projects/_ref/pi-src`, `cdaf6c2`) [원문]: `packages/coding-agent/src/core/tools/{read,write,edit,bash,grep,find,ls,truncate,file-mutation-queue,path-utils,edit-diff}.ts`, `src/utils/{paths,shell,tools-manager}.ts`, `src/core/extensions/types.ts`(1426-1428, 994-1002), `src/extensions/codemode/{tool,execute}.ts`, `src/extensions/mcp/tools.ts`, `docs/codemode.md`, `docs/security.md`; `packages/codemode/src/{types,runtime/host,runtime/prelude-source}.ts`, `README.md`; `packages/mcp/src/{client,protocol/content}.ts`, `README.md`; `packages/agent/src/{agent-loop,types}.ts`(`runToolCall`, `AgentTool.replay`).
- 사례 저장소(읽기 전용) [원문 존재 확인]: `~/projects/_ref/paseo/packages/server/src/server/agent/providers/{codex-app-server-agent.ts:3949-3955, claude/agent.ts:3417, claude/hooks.test.ts, acp-agent.ts:2556,2706,2712}`.
- 0단계 정리: `pi-api-facts-1.md`(0장 5~7·11·12, §4.2~4.6, §5, §6, §9), `pi-api-facts-2.md`(§8 pi-env), `pi-cases-notes.md`(§10 pi-chat, §12.1-10), `conversation-extracts-1.md`(E1-053~064, E1-180~210), `conversation-extracts-2.md`(X2-1-20~25, X2-2-06~14), `conversation-extracts-3.md`(X3-4-14, X3-5-06, X3-8-21~22), `conversation-extracts-4.md`(17-7), `helm-canon.md`(§9.3, §9.5, §9.10, §13.12, §16.8~16.9, §20.3 #9·#29, §21 13항), `helm-canon-2.md`(§1.15~1.17, §1.20, §1.23, §4.5, §7.2.3, §9.11, §11 13항), `helm-canon-3.md`(§7.2 G13, §21 13항).
- 사례 메모: `.helm-design-work/S4/{paseo,pi-fabric,openclaw-runtime}.md`.
- 실험(이 문서): `.helm-design-work/P7/exp-bwrap.sh`, `exp-bwrap.out.txt`, `exp-bwrap-minroot.sh`, `exp-bwrap-minroot.out.txt` (bubblewrap 0.9.0을 `apt-get download`로 받아 setuid 없이 실행, WSL 커널 6.18.33.2, 2026-10-11). userns·overlayfs·Landlock ABI 확인 명령은 이 문서 작성 중 실행했다.
- v0.3: `08-runtime-architecture.md`(§8), `12-implementation-architecture.md`(§7, §10), `14-alternative-structure.md`, `04-inquiry-types.md`(§9), `07-modes-and-capabilities.md`(§2).
- 다른 설계 문서(초안 시점): `06`(§3.2~3.3), `10`(§3.6.2, §3.6.5~3.6.6, §3.11, §3.18), `11`(§3.6, §3.11~3.14), `14`(ProposalKind, ContextSection, WorkUnitTemplate), `15`(§2.3, §3.1.2, D15-7), `16`(adapterSessionRef), `19`(§3.2 보안 전제).

## ADR 후보

### ADR-13-01 bash·execute의 쓰기 범위는 bubblewrap 마운트 격리로 강제한다

- 상태: 제안
- 맥락: 파일 도구 훅은 bash로 우회된다(E1-060). 명령 문자열로는 대상을 알 수 없다. 결정 15(1)은 쓰기에 합의를 요구한다.
- 결정: bash·grep·find를 bubblewrap 샌드박스(사용자·마운트·pid·네트워크 네임스페이스, 최소 읽기 루트)에서 실행하고, 합의의 하위 트리 전체 부여에서 계산한 디렉터리만 쓰기 가능하게 바인드한다. 실행 전후 변경 감지를 함께 둔다. bubblewrap이 없으면 `systemd-run --user` 격리(S1b)로 낮추고, 그것도 없으면 `execute`를 끈다. 수준은 화면에 보인다.
- 근거: 커널이 쓰기를 막는다(EROFS). 이 서버에서 setuid 없이 동작함을 실험했다. 비용은 호출당 약 16ms. 비밀 가림·네트워크 차단·pid 분리를 함께 얻는다.
- 기각한 대안: 명령 문자열 분석(우회 쉬움), 사후 diff만(막지 못함), Docker(도구 체인 이미지 부담), Landlock 단독(빼기 불가·헬퍼 필요), 오버레이 스테이징(1차에는 반영 절차가 복잡, 이후 S2).
- 결과: 글롭 단위 범위는 파일 도구로만 쓸 수 있다. bubblewrap 설치가 데몬 요구 사항이 된다(17). 합의 범위를 디렉터리 단위로 쓰는 편이 bash 작업에 유리하다는 것을 합의 초안 지시에 적는다(14).

### ADR-13-02 Helm 제안 도구는 커널 명령마다 하나를 명령 스키마에서 생성하고 제출과 결과를 한 트랜잭션으로 실행한다

- 상태: 제안
- 맥락: 제안 종류가 30개를 넘는다(14). 스키마를 커널과 도구에 두 번 쓰면 어긋난다. 모델이 ID를 지어내면 안 된다.
- 결정: 모델·보조 채널을 허용하는 10의 명령마다 `helm_<command>` 도구를 생성한다. 생성 필드는 빼고 런타임이 채운다. 묶음은 WorkUnit의 제안 종류와 `allowedCommands`로 줄인다. 실행은 원자적이다.
- 근거: 단일 스키마 원천, 실행 의도와 결과 사이의 불명 상태가 없음, 겹치는 도구 없음(묶음을 줄임).
- 기각한 대안: 범용 `helm_propose({ kind, payload })` 하나 — 큰 합집합 스키마는 제약 샘플링과 설명이 어렵고 모델 실수가 늘어난다. v0.2의 손으로 쓴 10개 도구 — 커널 명령과 따로 관리해야 한다.
- 결과: 10의 명령 스키마에 필드 설명과 생성 표시가 필요하다. 루프 전환 때 도구 묶음이 바뀌어 캐시가 한 번 깨진다.

### ADR-13-03 하위 LLM 호출은 별도 도구로 두고 REPL 변수는 실행 한 번의 수명이다

- 상태: 제안
- 맥락: 대화의 RLM·codemode 전제 두 가지가 틀렸다(변수 수명, 채팅 모델 하위 호출). 15가 REPL 방식 탐구를 pi-codemode로 하기로 했다.
- 결정: 하위 호출은 `helm_subcall`(모델 도구)과 REPL 전역 `helm.subcall`로 같은 역할 호출 경로를 쓴다. REPL 상태는 `helm.ws`(pi-codemode store, 비정본, 1 MiB)로만 넘긴다. 스크립트 안 도구 호출은 `runToolCall`로 같은 훅과 기록을 거친다.
- 근거: pi 소스와 실험 결과, 예산·메모·복구를 한 경로로 집행.
- 기각한 대안: 지속 Python/Node REPL(실행 메모리가 run 사이에 살아 복구·감사가 어렵고 Node `vm`은 보안 경계가 아님, extracts-2 X2-2-09 주의), 스크립트에 채팅 모델 직접 노출(예산·기록 우회).
- 결과: RLM의 "턴을 넘는 변수"는 `helm.ws`나 파일로 바꿔 써야 한다(15).

### ADR-13-04 런타임 어댑터는 능력 목록으로 자신을 설명하고 Helm이 성질별 보장 수준을 계산한다

- 상태: 제안
- 맥락: 결정 34. 런타임마다 훅·권한 콜백의 범위가 다르다. 원전의 Level A~D 정의가 둘이었다.
- 결정: `CapabilityManifest`의 능력 값에서 Level과 성질(G1~G8)별 `enforced`/`detected`/`advisory`를 계산한다. 없는 능력은 §3.11.6 규칙으로 낮춰 동작한다. 적합성 시험 AC-01~AC-12를 통과해야 활성화한다.
- 근거: 결손을 숨기지 않는다(canon-2 L16), 런타임을 바꿔도 커널 의미가 같다(10 §3.18).
- 기각한 대안: 최소 공통 능력에 맞추기(Helm 자체 런타임의 강점을 잃음, extracts-1 E1-017), Level 하나로만 표시(성질별 차이를 숨김).
- 결과: 어댑터마다 시험 대본과 녹화 응답이 필요하다(22).
