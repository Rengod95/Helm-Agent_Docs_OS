import { afterEach, describe, expect, test } from "bun:test";
import { McpClient } from "@xeon/contracts/capabilities";
import { openMcpStore, releaseStores } from "./support/store.ts";
import { fixedClock } from "./support/time.ts";
import { buildWorld, startWorld } from "./support/world.ts";

// M3-REQ-88·89, ADR-0015 §3.6: readOnly 메서드는 서버 상태 행과 서버 쪽 호출 어디에도 효과를 남기지 않는다.
// mcp.client는 멱등 쓰기가 없다. 선언 없는 메서드(connect, reconnect, disable, callTool)는 replay unsafe다.

afterEach(releaseStores);

const READ_ONLY_METHODS = [
  "listServers",
  "status",
  "listTools",
  "listPrompts",
  "getPrompt",
  "listResources",
  "readResource",
] as const;

describe("mcp.client readOnly conformance", () => {
  test("the declared readOnly methods are exactly the reads", () => {
    const declared = Object.entries(McpClient.service.methods)
      .filter(([, method]) => method.readOnly === true)
      .map(([name]) => name);
    expect(declared).toEqual([...READ_ONLY_METHODS]);
    const undeclared = Object.entries(McpClient.service.methods)
      .filter(([, method]) => method.readOnly !== true && method.idempotent !== true)
      .map(([name, method]) => `${name}:${method.replay ?? "unsafe"}`);
    expect(undeclared).toEqual([
      "connect:unsafe",
      "reconnect:unsafe",
      "disable:unsafe",
      "callTool:unsafe",
    ]);
  });

  test("calling every read leaves every table and the server side untouched", async () => {
    const clock = fixedClock();
    const store = await openMcpStore(clock);
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [{ name: "echo" }],
            prompts: [{ name: "hello", handle: () => [] }],
            resources: [{ uri: "file:///a.txt", name: "a", text: "alpha" }],
          },
        },
      },
      overrides: { store: store.service },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    // 모든 표의 내용이 그대로여야 한다. 파생 데이터를 쓰는 표가 없으므로 허용 목록이 비어 있다
    const before = await store.rowDigests();
    const stub = world.stubs["stub"];
    const requestsBefore = stub?.requests.length ?? 0;

    const client = world.runtime.service.client;
    await client.listServers({});
    await client.status({ server: "stub" });
    await client.listTools({ server: "stub" });
    await client.listPrompts({ server: "stub" });
    await client.getPrompt({ server: "stub", name: "hello" });
    await client.listResources({ server: "stub" });
    await client.readResource({ server: "stub", uri: "file:///a.txt" });

    expect(await store.rowDigests()).toEqual(before);
    const added = (stub?.requests ?? []).slice(requestsBefore).map((request) => request.method);
    const writes = added.filter(
      (method) => method === "tools/call" || method.startsWith("notifications/"),
    );
    expect(writes).toEqual([]);
    await world.runtime.shutdown();
  });
});
