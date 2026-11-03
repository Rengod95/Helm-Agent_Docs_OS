import { describe, expect, test } from "bun:test";
import type { StubOutcome } from "../src/testing/stub-server.ts";
import { rejection } from "./support/rejection.ts";
import { buildWorld, startWorld } from "./support/world.ts";

// L2.mcp.spec §4.4: 승인 모드 `deny`는 호출 거부다. 그룹 코드가 부르는 직접 경로(`mcp.client.callTool`)도 같다.
// 승인 규칙은 L1.tools 도구 경로에만 걸리므로 서비스가 직접 막는다. 거부된 호출은 전송에 닿지 않는다.

const done = (): StubOutcome => ({
  kind: "complete",
  content: [{ type: "text", text: "done" }],
});

const echo = { name: "echo", handle: done };
const wipe = { name: "wipe", handle: done };

function toolCallsOf(requests: readonly { readonly method: string }[]): string[] {
  return requests.map((request) => request.method).filter((method) => method === "tools/call");
}

describe("approval mode deny on the direct call path", () => {
  test("a tool whose own approval mode is deny is refused and never forwarded", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: { era: "modern", tools: [echo, wipe] },
          def: { tools: { approval: { wipe: "deny" } } },
        },
      },
    });
    await startWorld(world);
    const failure = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "wipe", arguments: {} }),
    );
    expect(failure).toMatchObject({ data: { code: "denied", method: "callTool" } });
    expect(toolCallsOf(world.stubs["stub"]?.requests ?? [])).toEqual([]);
    await world.runtime.shutdown();
  });

  test("a tool with no entry inherits a server-wide deny mode and is refused", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [echo, wipe] } } },
      user: { approvalMode: "deny" },
    });
    await startWorld(world);
    const failure = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "echo", arguments: {} }),
    );
    expect(failure).toMatchObject({ data: { code: "denied" } });
    expect(toolCallsOf(world.stubs["stub"]?.requests ?? [])).toEqual([]);
    await world.runtime.shutdown();
  });

  test("a tool named like an Object prototype member still takes the server-wide deny mode", async () => {
    const constructor = { name: "constructor", handle: done };
    const world = buildWorld({
      servers: {
        stub: {
          stub: { era: "modern", tools: [echo, constructor] },
          def: { tools: { approval: { echo: "auto" } } },
        },
      },
      user: { approvalMode: "deny" },
    });
    await startWorld(world);
    const failure = await rejection(
      world.runtime.service.client.callTool({
        server: "stub",
        tool: "constructor",
        arguments: {},
      }),
    );
    expect(failure).toMatchObject({ data: { code: "denied" } });
    expect(toolCallsOf(world.stubs["stub"]?.requests ?? [])).toEqual([]);
    await world.runtime.shutdown();
  });

  test("a tool set to auto under a server-wide deny mode is still forwarded", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: { era: "modern", tools: [echo, wipe] },
          def: { tools: { approval: { echo: "auto" } } },
        },
      },
      user: { approvalMode: "deny" },
    });
    await startWorld(world);
    const output = await world.runtime.service.client.callTool({
      server: "stub",
      tool: "echo",
      arguments: {},
    });
    expect(output).toMatchObject({ status: "complete" });
    expect(toolCallsOf(world.stubs["stub"]?.requests ?? [])).toEqual(["tools/call"]);
    await world.runtime.shutdown();
  });
});
