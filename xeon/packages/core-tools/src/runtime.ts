import { Bug } from "@xeon/contracts";
import type { ToolName } from "@xeon/contracts/capabilities";
import type { ScopeId, ToolResourceDef } from "@xeon/contracts/extensions";
import type {
  ApprovalService,
  ModeChangeResult,
  ToolMeta,
  ToolRegistration,
  ToolService,
  Unregister,
} from "@xeon/contracts/services";
import { createApprovalService } from "./approvals/service.ts";
import { createCallTable } from "./calls.ts";
import type { ToolsDeps } from "./deps.ts";
import { entriesOf, resourceEntry, toToolMeta } from "./entries.ts";
import { advertiseTools } from "./expose.ts";
import { createPipeline } from "./pipeline.ts";
import { createRegistry } from "./registry.ts";
import { TOOLS_SETTING_KEYS } from "./settings.ts";

// ToolService(xeon.tools)와 ApprovalService(xeon.approvals) 조립(L1.tools.plan TL-8). Cordis는 쓰지 않는다.

export interface ToolRuntime {
  readonly tools: ToolService;
  readonly approvals: ApprovalService;
}

export function createToolRuntime(deps: ToolsDeps): ToolRuntime {
  const registry = createRegistry();
  const calls = createCallTable();
  const approvals = createApprovalService({
    session: deps.session,
    producer: deps.producer,
    ids: deps.ids,
    clock: deps.clock,
    ext: deps.ext,
    logger: deps.logger,
    runOf: (origin) =>
      origin.toolCallId === null ? undefined : calls.get(origin.threadId, origin.toolCallId)?.run,
  });
  const pipeline = createPipeline(deps, registry, calls, approvals);

  function register(first: ToolRegistration | ScopeId, def?: ToolResourceDef): Unregister {
    if (typeof first === "string") {
      if (def === undefined) throw new Bug("tools.register: a ToolResourceDef is required");
      return registry.add([resourceEntry(first, def)]);
    }
    return registry.add(entriesOf(first, deps.resolveCapability));
  }

  const tools: ToolService = {
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
      });
    },
    prepare: (call, assistant, run) => pipeline.prepare(call, assistant, run),
    execute: (call, onUpdate, run) => pipeline.execute(call, onUpdate, run),
    settleRejected: (toClose, reason, run) => pipeline.settleRejected(toClose, reason, run),
    rerun: (intent, run) => pipeline.rerun(intent, run),
    registerRules() {
      throw new Bug("tools.registerRules arrives in M2 (L1.tools.plan TL-3)");
    },
    runUserShell() {
      throw new Bug("tools.runUserShell arrives in M2 (L1.tools.plan TL-16)");
    },
    mode: (threadId) => deps.config(threadId).mode,
    setMode(threadId, mode) {
      // M1은 default 모드만 쓴다(L1.tools.plan §1 M1). 다른 모드는 M2(TL-4)에서 연다
      if (mode !== "default") {
        return Promise.resolve<ModeChangeResult>({
          ok: false,
          error: { kind: "tools.mode_forbidden", mode },
        });
      }
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
