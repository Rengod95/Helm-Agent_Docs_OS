import { err, ok, parse } from "@fresnel/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@fresnel/contracts/conversation";
import { ToolsPortKey, type ToolResourceDef } from "@fresnel/contracts/extensions";
import {
  ApprovalServicePortKey,
  type ApprovalRequest,
  type ApprovalResolution,
  type ApprovalService,
  type DevkitService,
  type ValidationReport,
} from "@fresnel/contracts/services";
import { createTestHost, type TestHost } from "@fresnel/ext-host/testing";
import {
  AuthoringStateSchema,
  createAuthoringGroup,
  INITIAL_AUTHORING_STATE,
  KIND_CATALOG,
  type AuthoringDeps,
  type AuthoringState,
} from "../src/index.ts";

// 그룹 `authoring` 시험용 대역. 승인 서비스는 메모리 구현이고, devkit은 호출을 기록하는 대역이다.

interface FakeApprovals {
  readonly service: ApprovalService;
  readonly created: ApprovalRequest[];
}

function fakeApprovals(now: () => number): FakeApprovals {
  const byId = new Map<
    string,
    {
      request: ApprovalRequest;
      resolution: ApprovalResolution | null;
      waiters: Set<(r: ApprovalResolution) => void>;
    }
  >();
  const byKey = new Map<string, string>();
  const created: ApprovalRequest[] = [];
  const pendingOf = (threadId: ThreadId): ApprovalRequest[] =>
    [...byId.values()]
      .filter((entry) => entry.resolution === null && entry.request.origin.threadId === threadId)
      .map((entry) => entry.request);
  const service: ApprovalService = {
    async request(input, signal) {
      const opened = await service.open(input);
      if (!opened.ok) return opened;
      if (opened.value.resolution !== null) return ok(opened.value.resolution);
      const waited = await service.wait(opened.value.request.approvalId, signal);
      if (waited.ok) return waited;
      return ok({
        approvalId: opened.value.request.approvalId,
        decision: "deny",
        answer: null,
        remember: "once",
        requestedRemember: null,
        resolvedBy: "cancelled",
      });
    },
    async respond(approvalId, response) {
      const entry = byId.get(approvalId);
      if (entry === undefined) return { applied: false, reason: "unknown_approval" };
      if (entry.resolution !== null) return { applied: false, reason: "already_resolved" };
      const resolution: ApprovalResolution = {
        approvalId,
        decision: response.decision,
        answer: response.answer ?? null,
        remember: "once",
        requestedRemember: null,
        resolvedBy: "user",
      };
      entry.resolution = resolution;
      for (const wake of entry.waiters) wake(resolution);
      entry.waiters.clear();
      return { applied: true };
    },
    pending: pendingOf,
    async restore(threadId) {
      return ok(pendingOf(threadId));
    },
    async cancel() {
      return { applied: false };
    },
    async open(input) {
      const key = `${input.origin.threadId}|${input.requestKey}`;
      const known = byKey.get(key);
      const knownEntry = known === undefined ? undefined : byId.get(known);
      if (knownEntry !== undefined)
        return ok({ request: knownEntry.request, resolution: knownEntry.resolution });
      const request: ApprovalRequest = {
        ...input,
        approvalId: `appr_${String(created.length + 1)}`,
        surfaceThreadId: input.origin.threadId,
        requestedAt: now(),
      };
      byId.set(request.approvalId, { request, resolution: null, waiters: new Set() });
      byKey.set(key, request.approvalId);
      created.push(request);
      return ok({ request, resolution: null });
    },
    async wait(approvalId, signal) {
      const entry = byId.get(approvalId);
      if (entry === undefined) return err({ kind: "unknown" });
      if (entry.resolution !== null) return ok(entry.resolution);
      const { waiters } = entry;
      const resolution = await new Promise<ApprovalResolution | undefined>((resolve) => {
        if (signal.aborted) {
          resolve(undefined);
          return;
        }
        function onAnswer(answered: ApprovalResolution): void {
          signal.removeEventListener("abort", onAbort);
          resolve(answered);
        }
        function onAbort(): void {
          waiters.delete(onAnswer);
          resolve(undefined);
        }
        waiters.add(onAnswer);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return resolution === undefined ? err({ kind: "aborted" }) : ok(resolution);
    },
    get(approvalId) {
      const entry = byId.get(approvalId);
      return entry === undefined
        ? undefined
        : { request: entry.request, resolution: entry.resolution };
    },
  };
  return { service, created };
}

interface DevkitProbe {
  readonly devkit: DevkitService;
  /** 호출 기록 `이름:대상` */
  readonly calls: string[];
  validation: ValidationReport;
}

const OK_REPORT: ValidationReport = { ok: true, issues: [] };

function devkitProbe(): DevkitProbe {
  const calls: string[] = [];
  const probe: DevkitProbe = {
    calls,
    validation: OK_REPORT,
    devkit: {
      kinds: async () => KIND_CATALOG,
      scaffold: async (input) => {
        calls.push(`scaffold:${input.dir}`);
        return ok({ dir: input.dir, files: [".fresnel-plugin/plugin.json", "src/index.ts"] });
      },
      validate: async (dir) => {
        calls.push(`validate:${dir}`);
        return ok(probe.validation);
      },
      validateComposition: () => OK_REPORT,
      testRun: async (input) => {
        calls.push(`testRun:${input.target}`);
        return ok({ threadId: "thr_trial" });
      },
      replay: async (input) => {
        calls.push(`replay:${input.target}`);
        return ok({
          ok: true,
          commits: 2,
          passed: 2,
          firstDiff: null,
          cuts: [
            { commitIndex: 1, equal: true, firstDiff: null },
            { commitIndex: 2, equal: true, firstDiff: null },
          ],
          effects: { turn: 0, spawn: 0, delegate: 0, post: 0 },
          failure: null,
        });
      },
      pack: async (input) => {
        calls.push(`pack:${input.dir}`);
        return ok({ path: `${input.dir}/dist/package`, files: ["a"], sha256: "a".repeat(64) });
      },
      link: async (input) => {
        calls.push(`link:${input.source}`);
        return ok({ name: "demo", version: "0.1.0", location: "/ext/demo" });
      },
    },
  };
  return probe;
}

export interface GroupRig {
  readonly t: TestHost;
  readonly thread: ThreadId;
  /** 등록된 도구 이름 */
  toolNames(): string[];
  readonly approvals: FakeApprovals;
  readonly probe: DevkitProbe;
  /** 도구 호출. 결과는 JSON 값이다 */
  call(name: string, args: JsonValue): Promise<JsonValue>;
  /** 커밋된 마지막 상태 */
  state(): AuthoringState;
  /** 대기 중인 승인에 yes 또는 no로 답한다 */
  answer(selected: "yes" | "no"): Promise<void>;
  /** `tool.call.before`를 발화해 결정을 돌려준다 */
  guard(
    toolName: string,
    risk: "read" | "write" | "exec",
    input: Record<string, JsonValue>,
  ): Promise<unknown>;
}

let calls = 0;

export async function createGroupRig(options: Partial<AuthoringDeps> = {}): Promise<GroupRig> {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await t.host.registerPlatform({
    name: "test-approvals",
    setup(ctx) {
      ctx.providePort(ApprovalServicePortKey, approvals.service);
    },
  });
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "test-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  const probe = devkitProbe();
  const module = createAuthoringGroup({ devkit: probe.devkit, ...options });
  await t.host.install({
    manifest: module.manifest,
    entry: module.entry,
    loadIndex: 0,
    builtin: true,
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  // 기본이 꺼짐이므로 켠다. 켜기 요청은 유휴 경계에서 적용된다
  t.host.registration("authoring")?.enable();
  await t.boundary(thread).idle();
  await t.settled();

  const state = (): AuthoringState => {
    const committed = t.records
      .events(thread)
      .filter((event) => event.kind === "grp.authoring.state.committed")
      .map((event) => event.payload);
    const last: unknown = committed.at(-1);
    const wrapped = typeof last === "object" && last !== null && "doc" in last ? last.doc : last;
    const parsed = parse(AuthoringStateSchema, wrapped);
    return parsed.ok ? parsed.value : INITIAL_AUTHORING_STATE;
  };
  return {
    t,
    thread,
    approvals,
    probe,
    state,
    toolNames: () => [...tools.keys()].toSorted(),
    async call(name, args) {
      const def = tools.get(name);
      if (def === undefined) throw new Error(`tool ${name} is not registered`);
      calls += 1;
      const result = await def.execute(args, {
        threadId: thread,
        signal: new AbortController().signal,
        toolCallId: `call_${String(calls)}`,
        caller: { kind: "model", agent: "main" },
      });
      await t.settled();
      return toJsonValue(result) ?? null;
    },
    async answer(selected) {
      const open = approvals.service.pending(thread);
      const request = open[0];
      if (request === undefined) throw new Error("no pending approval");
      await approvals.service.respond(request.approvalId, {
        decision: "answer",
        answer: { confirm: { selected: [selected] } },
      });
      await t.settled();
      await t.boundary(thread).turnSettled();
      await t.settled();
    },
    async guard(toolName, risk, input) {
      const outcome = await t.host.dispatch(
        "tool.call.before",
        { toolCallId: `g_${String((calls += 1))}`, toolName, input, risk },
        { threadId: thread, dispatchKey: `g${String(calls)}` },
      );
      return outcome.decision;
    },
  };
}
