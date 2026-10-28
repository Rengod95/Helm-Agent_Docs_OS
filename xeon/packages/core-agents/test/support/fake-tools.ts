// core-tools의 ToolService 부분 대역(DR-02). 규칙 등록, 도구 등록, 권한 모드만 기록한다.
import { ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ScopeId, ToolRegisterError, ToolResourceDef } from "@xeon/contracts/extensions";
import type {
  DirectToolRegistration,
  PermissionMode,
  PolicyRule,
  ToolRegistration,
  Unregister,
} from "@xeon/contracts/services";
import type { AgentsTools } from "../../src/index.ts";

export interface FakeTools extends AgentsTools {
  readonly rules: Map<string, readonly PolicyRule[]>;
  readonly registered: ToolRegistration[];
  readonly modeChanges: { readonly threadId: ThreadId; readonly mode: PermissionMode }[];
  setParentMode(threadId: ThreadId, mode: PermissionMode): void;
  /** `suspendWhile` 호출 기록 */
  readonly suspensions: { readonly threadId: ThreadId; readonly toolCallId: string }[];
  /** 지금 `suspendWhile` 안에서 기다리는 호출 수(슬롯을 내려놓은 호출) */
  suspended(): number;
  /** 등록된 direct 도구 하나 */
  directTool(name: string): DirectToolRegistration | undefined;
}

export function fakeTools(): FakeTools {
  const modes = new Map<ThreadId, PermissionMode>();
  const rules = new Map<string, readonly PolicyRule[]>();
  const registered: ToolRegistration[] = [];
  const modeChanges: { readonly threadId: ThreadId; readonly mode: PermissionMode }[] = [];
  const suspensions: { readonly threadId: ThreadId; readonly toolCallId: string }[] = [];
  let suspendedNow = 0;
  function register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
  function register(owner: ScopeId, def: ToolResourceDef): Result<Unregister, ToolRegisterError>;
  function register(
    first: ToolRegistration | ScopeId,
    _def?: ToolResourceDef,
  ): Result<Unregister, ToolRegisterError> {
    if (typeof first === "string") return ok(() => {});
    registered.push(first);
    return ok(() => {
      const index = registered.indexOf(first);
      if (index >= 0) registered.splice(index, 1);
    });
  }
  return {
    rules,
    registered,
    modeChanges,
    suspensions,
    suspended: () => suspendedNow,
    async suspendWhile(threadId, toolCallId, wait) {
      suspensions.push({ threadId, toolCallId });
      suspendedNow += 1;
      try {
        return await wait;
      } finally {
        suspendedNow -= 1;
      }
    },
    setParentMode(threadId, mode) {
      modes.set(threadId, mode);
    },
    directTool(name) {
      for (const entry of registered) {
        if (entry.kind === "direct" && entry.tool.name === name) return entry;
      }
      return undefined;
    },
    mode: (threadId) => modes.get(threadId) ?? "default",
    setMode(threadId, mode) {
      modes.set(threadId, mode);
      modeChanges.push({ threadId, mode });
      return Promise.resolve({ ok: true, mode });
    },
    advertise: () =>
      Promise.resolve(
        ok({
          tools: [],
          deferred: [],
          removed: [],
          fingerprint: "sha256:0",
        }),
      ),
    register: register,
    registerRules(source, next) {
      rules.set(source, next);
      return {
        issues: [],
        dispose: () => {
          rules.delete(source);
        },
      };
    },
  };
}
