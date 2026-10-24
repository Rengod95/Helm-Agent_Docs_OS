import { Bug, type Result } from "@xeon/contracts";
import type { ToolName } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ScopeId, ToolRegisterError, ToolResourceDef } from "@xeon/contracts/extensions";
import type {
  ModeChangeResult,
  ToolMeta,
  ToolRegistration,
  ToolService,
  Unregister,
} from "@xeon/contracts/services";
import { createApprovalService, type ApprovalsInternal } from "./approvals/service.ts";
import { createCallTable } from "./calls.ts";
import type { ToolsDeps } from "./deps.ts";
import { entriesOf, resourceEntry, toToolMeta, type InputWaitResult } from "./entries.ts";
import { advertiseTools } from "./expose.ts";
import { createPipeline } from "./pipeline.ts";
import { readToolOutputEntry } from "./builtin/read-tool-output.ts";
import { toolSearchEntry } from "./builtin/tool-search.ts";
import { createCoreRules } from "./policy/core-rules.ts";
import { createRegistry } from "./registry.ts";
import { TOOLS_SETTING_KEYS } from "./settings.ts";

// ToolService(xeon.tools)와 ApprovalService(xeon.approvals) 조립(L1.tools.plan TL-8). Cordis는 쓰지 않는다.

/** 구현이 F `ToolService`에 더한 메서드. `suspendWhile`은 F 승격 요청이다(L1.tools.spec §8.3 F 요청 14) */
interface ToolServiceInternal extends ToolService {
  /** 슬롯을 쥔 호출이 다른 노드(자식 대화)를 기다리는 동안 `tools` 슬롯을 내려놓는다. 슬롯이 없으면 그냥 기다린다 */
  suspendWhile<T>(threadId: ThreadId, toolCallId: string, wait: Promise<T>): Promise<T>;
}

export interface ToolRuntime {
  readonly tools: ToolServiceInternal;
  readonly approvals: ApprovalsInternal;
}

export function createToolRuntime(base: ToolsDeps): ToolRuntime {
  // 코어가 registerRules로 넣은 default 티어 규칙을 설정에서 모은 규칙 뒤에 붙인다. 규칙 변경은 다음 평가부터 적용된다
  const coreRules = createCoreRules();
  const deps: ToolsDeps = {
    ...base,
    config: (threadId) => {
      const config = base.config(threadId);
      const extra = coreRules.all();
      return extra.length === 0 ? config : { ...config, rules: [...config.rules, ...extra] };
    },
  };
  const registry = createRegistry();
  const calls = createCallTable();
  const approvals = createApprovalService({
    session: deps.session,
    producer: deps.producer,
    ids: deps.ids,
    clock: deps.clock,
    ext: deps.ext,
    logger: deps.logger,
    callOf: (origin) => {
      if (origin.toolCallId === null) return undefined;
      const state = calls.get(origin.threadId, origin.toolCallId);
      return state === undefined
        ? undefined
        : { run: state.run, effectId: state.intent?.effectId ?? null };
    },
    modeOf: (threadId) => deps.config(threadId).mode,
    setMode: (threadId, mode) => tools.setMode(threadId, mode, "plan_approval"),
  });
  const pipeline = createPipeline(deps, registry, calls, approvals);
  // 내장 도구 `tool_search`, `read_tool_output`(순서 키 core.tools). 같은 파이프라인을 지난다
  registry.seed([
    toolSearchEntry({ session: deps.session, config: deps.config, entries: () => registry.all() }),
    readToolOutputEntry({ session: deps.session, store: deps.store, config: deps.config }),
  ]);

  /** 도구가 올린 승인의 해결을 기다린다. 턴 취소로 끊기면 그 승인을 닫는다(L1.tools.spec §4.7 8번) */
  async function waitInput(approvalId: string, signal: AbortSignal): Promise<InputWaitResult> {
    const waited = await approvals.wait(approvalId, signal);
    if (waited.ok) return "resolved";
    if (waited.error.kind === "unknown") return "unknown";
    await approvals.cancel(approvalId, "turn aborted");
    return "aborted";
  }

  function register(
    first: ToolRegistration | ScopeId,
    def?: ToolResourceDef,
  ): Result<Unregister, ToolRegisterError> {
    if (typeof first === "string") {
      if (def === undefined) throw new Bug("tools.register: a ToolResourceDef is required");
      return registry.add([resourceEntry(first, def)]);
    }
    return registry.add(entriesOf(first, deps.resolveCapability, waitInput));
  }

  const tools: ToolServiceInternal = {
    register,
    meta(name: ToolName): ToolMeta | undefined {
      const entry = registry.get(name);
      return entry === undefined ? undefined : toToolMeta(entry, deps.config(null).output);
    },
    async advertise(input) {
      const config = deps.config(input.run.threadId);
      return advertiseTools(registry.all(), input, {
        rules: config.rules,
        bypassAllowed: config.bypassAllowed,
        deferThreshold: config.deferThreshold,
      });
    },
    prepare: (call, assistant, run) => pipeline.prepare(call, assistant, run),
    execute: (call, onUpdate, run) => pipeline.execute(call, onUpdate, run),
    settleRejected: (toClose, reason, run) => pipeline.settleRejected(toClose, reason, run),
    rerun: (intent, run) => pipeline.rerun(intent, run),
    registerRules: (source, rules) => coreRules.register(source, rules),
    runUserShell: (request, run) => pipeline.runUserShell(request, run),
    suspendWhile: (threadId, toolCallId, wait) => pipeline.suspendWhile(threadId, toolCallId, wait),
    mode: (threadId) => deps.config(threadId).mode,
    setMode(threadId, mode) {
      // managed가 bypass를 금지했으면 모드를 바꾸지 않는다(L1.tools.spec §5 사례 11). 이미 세션 값이 bypass인 채 금지가 생기면 평가기가 default로 본다
      if (mode === "bypass" && !deps.config(threadId).bypassAllowed) {
        return Promise.resolve<ModeChangeResult>({
          ok: false,
          error: { kind: "tools.mode_forbidden", mode },
        });
      }
      // 모드를 되돌리는 변경도 정상이므로 호출마다 새 요청 키를 쓴다
      const written = deps.session.sessionSettings.set(
        threadId,
        TOOLS_SETTING_KEYS.permissionMode,
        mode,
        `mode:${threadId}:${deps.ids.next("evt")}`,
      );
      if (!written.ok) {
        return Promise.resolve<ModeChangeResult>({
          ok: false,
          error: { kind: "tools.commit_failed", store: written.error },
        });
      }
      return Promise.resolve<ModeChangeResult>({ ok: true, mode });
    },
  };

  return { tools, approvals };
}
