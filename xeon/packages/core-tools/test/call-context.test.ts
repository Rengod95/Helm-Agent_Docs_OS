import { expect, test } from "bun:test";
import {
  defineCapability,
  serviceKey,
  type CallContext,
  type CallOptions,
} from "@xeon/contracts/capabilities";
import { approvalCallerOf } from "@xeon/contracts/services";
import { Type } from "typebox";
import { callTool, createHarness, layer } from "./support/harness.ts";

// M2 마감 G1-09. 호출 문맥의 호출자는 `approvalCallerOf` 하나로 승인 origin의 caller가 된다.
// 서브에이전트 정의 이름이 `agentName`으로 실려야 `subagent:<이름>`이 되고, 이름이 버려지면 `subagent:unknown`이 된다.

const ALLOW = [
  layer("user", {
    "l1.tools.rules": [
      { id: "u.probe", action: "tool.call", resource: { tool: "probe" }, effect: "allow" },
    ],
  }),
];

const ProbeInput = Type.Object({ value: Type.String() });
const Probe = defineCapability({
  id: "test.call-context",
  version: "1.0.0",
  description: "records the call context",
  service: {
    methods: {
      run: { description: "run", input: ProbeInput, output: Type.Object({ ok: Type.Boolean() }) },
    },
  },
  tools: [
    { name: "probe", label: "probe", description: "probe", method: "run", parameters: ProbeInput },
  ],
});

async function contextOf(
  caller: "main" | `subagent:${string}`,
  via: "capability" | "direct",
): Promise<CallContext | undefined> {
  const h = await createHarness({ layers: ALLOW });
  let seen: CallContext | undefined;
  if (via === "capability") {
    h.apis.set(Probe.id, {
      run: (_input: unknown, options?: CallOptions) => {
        seen = options?.context;
        return Promise.resolve({ ok: true });
      },
    });
    h.runtime.tools.register({
      kind: "capability",
      def: Probe,
      key: serviceKey(Probe),
      policy: { probe: { risk: "read" } },
    });
  } else {
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "ext.test",
      tool: {
        name: "probe",
        label: "probe",
        description: "probe",
        parameters: ProbeInput,
        execute: () => Promise.reject(new Error("the continuation path must be used")),
      },
      policy: { risk: "read" },
      executeWithContinuation: (call) => {
        seen = call.context;
        return Promise.resolve({
          content: [{ type: "text", text: "ok" }],
          details: null,
          isError: false,
          status: "complete",
        });
      },
    });
  }
  const out = await callTool(h.runtime.tools, h.run({ caller }), {
    id: "ctx_1",
    name: "probe",
    args: { value: "x" },
  });
  expect(out.blocked).toBeUndefined();
  return seen;
}

for (const via of ["capability", "direct"] as const) {
  test(`${via}_tool_main_caller_gives_approval_caller_main`, async () => {
    const context = await contextOf("main", via);
    expect(context?.caller).toEqual({ kind: "model", agent: "main" });
    expect(context && approvalCallerOf(context.caller)).toBe("main");
  });

  test(`${via}_tool_subagent_name_reaches_the_approval_caller`, async () => {
    const context = await contextOf("subagent:explorer", via);
    // 이름은 agentName에 실린다. extension은 확장 호출자의 이름이라 비어 있다
    expect(context?.caller).toEqual({ kind: "model", agent: "subagent", agentName: "explorer" });
    expect(context && approvalCallerOf(context.caller)).toBe("subagent:explorer");
  });
}
