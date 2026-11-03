import { Bug, ok, type Result } from "@fresnel/contracts";
import type { ToolName } from "@fresnel/contracts/capabilities";
import type {
  RegistrationId,
  ToolRegisterError,
  ToolResourceDef,
} from "@fresnel/contracts/extensions";
import type {
  ModeChangeResult,
  ToolMeta,
  ToolRegistration,
  ToolService,
  Unregister,
} from "@fresnel/contracts/services";
import { createApprovalService, type ApprovalsInternal } from "./approvals/service.ts";
import { systemScheduler } from "./approvals/timer.ts";
import { createCallTable } from "./calls.ts";
import type { ToolsDeps } from "./deps.ts";
import { entriesOf, resourceEntry, toToolMeta } from "./entries.ts";
import type { InputBridge, InputWaitResult } from "./mcp-input.ts";
import { advertiseTools } from "./expose.ts";
import { createPipeline } from "./pipeline.ts";
import { readToolOutputEntry } from "./builtin/read-tool-output.ts";
import { toolSearchEntry } from "./builtin/tool-search.ts";
import { createCoreRules } from "./policy/core-rules.ts";
import { createRegistry } from "./registry.ts";
import { createToolReplaceGate } from "./replace-gate.ts";
import { TOOLS_SETTING_KEYS } from "./settings.ts";

// ToolService(fresnel.tools)와 ApprovalService(fresnel.approvals) 조립(L1.tools.plan TL-8). Cordis는 쓰지 않는다.

export interface ToolRuntime {
  readonly tools: ToolService;
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
    // 주입된 스케줄러가 없어도 만료 타이머는 있어야 한다: 없으면 `expire` 정책의 무인 turn이 영원히 기다린다
    scheduler: deps.scheduler ?? systemScheduler(),
    unattended: (threadId) => deps.config(threadId).unattended,
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

  const replaceGate = createToolReplaceGate({
    approvals,
    registry,
    logger: deps.logger,
  });

  /** 도구가 올린 승인의 해결을 기다린다. 턴 취소로 끊기면 그 승인을 닫는다(L1.tools.spec §4.7 8번) */
  async function waitInput(approvalId: string, signal: AbortSignal): Promise<InputWaitResult> {
    const waited = await approvals.wait(approvalId, signal);
    if (waited.ok) return "resolved";
    if (waited.error.kind === "unknown") return "unknown";
    await approvals.cancel(approvalId, "turn aborted");
    return "aborted";
  }

  const bridge: InputBridge = {
    wait: waitInput,
    open: (input) => approvals.open(input),
    get: (approvalId) => approvals.get(approvalId),
  };

  function register(
    first: ToolRegistration | RegistrationId,
    def?: ToolResourceDef,
  ): Result<Unregister, ToolRegisterError> {
    if (typeof first === "string") {
      if (def === undefined) throw new Bug("tools.register: a ToolResourceDef is required");
      if (def.replaces === undefined) return registry.add([resourceEntry(first, def)]);
      // 내장 도구 대체(§4.13): 후보로만 두고 사용자가 승인하기 전까지 표는 바뀌지 않는다
      const added = registry.addReplacement(first, resourceEntry(first, def), def.replaces);
      if (!added.ok) return added;
      const remove = added.value;
      return ok(() => {
        const open = registry
          .replacements()
          .find((state) => state.owner === first && state.toolName === def.name);
        remove();
        if (
          open?.approvalId !== null &&
          open?.approvalId !== undefined &&
          open.status === "pending"
        ) {
          replaceGate.cancel(open.approvalId);
        }
      });
    }
    return registry.add(entriesOf(first, deps.resolveCapability, bridge));
  }

  const tools: ToolService = {
    register,
    meta(name: ToolName): ToolMeta | undefined {
      const entry = registry.get(name);
      return entry === undefined ? undefined : toToolMeta(entry, deps.config(null).output);
    },
    replacements: () => registry.replacements(),
    async advertise(input) {
      // 승인 전인 대체가 있으면 이 대화에 승인 요청을 올린다. 승인되면 다음 광고부터 대체 도구가 보인다
      await replaceGate.requestPending(input.run.threadId);
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
        if (written.error.kind === "key_reused") {
          // 요청 키를 이 호출이 새로 만들었으므로 재사용은 코드 결함이다
          // fresnel-disable-next-line fresnel/bug-for-expected -- 호출마다 새 키를 만드는 자리라 키 재사용은 불변 조건 위반이다 (eng.typescript.guide TY-24)
          throw new Bug("tools.mode_key_reused: a fresh settings request key was already used");
        }
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
