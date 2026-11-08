import { describe, expect, test } from "bun:test";
import {
  CapabilityError,
  WorkspaceShell,
  type SandboxBlock,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  sandboxBlockContent,
  sandboxBlockDetails,
  sandboxBlockLines,
  sandboxBlocksOf,
} from "../src/sandbox-blocks.ts";
import { callTool, createHarness, layer, registerWorkspace } from "./support/harness.ts";

// L1.tools.spec §4.12.3. 샌드박스가 막은 것 → 모델 글(영어 줄)과 화면용 details.code.

const NETWORK: SandboxBlock = { code: "sandbox.network_blocked", domain: "localhost" };
const WRITE: SandboxBlock = { code: "sandbox.write_blocked", path: "/etc/hosts" };
const READ: SandboxBlock = { code: "sandbox.read_blocked", path: "/Users/u/.npmrc" };

describe("sandboxBlocksOf", () => {
  test("reads the typed blocks and drops the entries that do not match the schema", () => {
    const structured: JsonValue = {
      exitCode: 7,
      sandboxBlocks: [
        { code: "sandbox.network_blocked", domain: "localhost" },
        { code: "sandbox.write_blocked", path: 3 },
        { code: "exit_nonzero", path: "/x" },
        { code: "sandbox.read_blocked", path: "/Users/u/.npmrc" },
      ],
    };
    expect(sandboxBlocksOf(structured)).toEqual([NETWORK, READ]);
  });

  test("a result without blocks, or a value that is not an object, has none", () => {
    expect(sandboxBlocksOf({ exitCode: 0 })).toEqual([]);
    expect(sandboxBlocksOf({ sandboxBlocks: "sandbox.network_blocked" })).toEqual([]);
    expect(sandboxBlocksOf(["sandbox.write_blocked"])).toEqual([]);
    expect(sandboxBlocksOf(undefined)).toEqual([]);
    expect(sandboxBlocksOf(null)).toEqual([]);
  });
});

describe("sandboxBlockLines", () => {
  test("one English line per kind, naming the domain or the path", () => {
    expect(sandboxBlockLines([NETWORK])).toEqual([
      "Blocked by network policy: localhost is in blockedDomains.",
    ]);
    expect(sandboxBlockLines([WRITE])).toEqual([
      "Blocked by sandbox: writing outside the workspace or to a protected path is not allowed: /etc/hosts",
    ]);
    expect(sandboxBlockLines([READ])).toEqual([
      "Blocked by sandbox: reading a protected path is not allowed: /Users/u/.npmrc",
    ]);
  });

  test("the same target is named once, several domains take 'are', and a long list is cut", () => {
    const domains: SandboxBlock[] = [
      { code: "sandbox.network_blocked", domain: "a.test" },
      { code: "sandbox.network_blocked", domain: "b.test" },
      { code: "sandbox.network_blocked", domain: "a.test" },
    ];
    expect(sandboxBlockLines(domains)).toEqual([
      "Blocked by network policy: a.test, b.test are in blockedDomains.",
    ]);
    const paths: SandboxBlock[] = Array.from({ length: 7 }, (_, i) => ({
      code: "sandbox.write_blocked",
      path: `/p/${i}`,
    }));
    expect(sandboxBlockLines(paths)).toEqual([
      "Blocked by sandbox: writing outside the workspace or to a protected path is not allowed: /p/0, /p/1, /p/2, /p/3, /p/4 (and 2 more)",
    ]);
  });

  test("no blocks means no lines and no content", () => {
    expect(sandboxBlockLines([])).toEqual([]);
    expect(sandboxBlockContent([])).toBeUndefined();
    expect(sandboxBlockContent([NETWORK])).toEqual({
      type: "text",
      text: "Blocked by network policy: localhost is in blockedDomains.",
    });
  });
});

describe("sandboxBlockDetails", () => {
  test("code and target come from the first block, and every block is listed", () => {
    expect(sandboxBlockDetails([WRITE, NETWORK])).toEqual({
      code: "sandbox.write_blocked",
      path: "/etc/hosts",
      blocks: [
        { code: "sandbox.write_blocked", path: "/etc/hosts" },
        { code: "sandbox.network_blocked", domain: "localhost" },
      ],
    });
    expect(sandboxBlockDetails([NETWORK])).toEqual({
      code: "sandbox.network_blocked",
      domain: "localhost",
      blocks: [{ code: "sandbox.network_blocked", domain: "localhost" }],
    });
  });

  test("no blocks means no details", () => {
    expect(sandboxBlockDetails([])).toBeUndefined();
  });
});

// 명령 실행 결과를 흉내 낸다. 기능 서비스 run만 바꾸고 나머지는 시험 하네스를 그대로 쓴다
async function bashWith(
  run: () => Promise<unknown>,
): Promise<Awaited<ReturnType<typeof callTool>>> {
  const h = await createHarness({
    layers: [
      layer("user", {
        "l1.tools.rules": [
          { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
        ],
      }),
    ],
  });
  registerWorkspace(h);
  h.apis.set(WorkspaceShell.id, { run });
  return callTool(h.runtime.tools, h.run({ caller: "main" }), {
    id: "c1",
    name: "bash",
    args: { command: "curl localhost" },
  });
}

describe("bash result path", () => {
  test("a failed command that the sandbox blocked gets the reason line and the block code", async () => {
    const blocks = [
      { code: "sandbox.network_blocked", domain: "localhost" },
      { code: "sandbox.write_blocked", path: "/etc/hosts" },
    ];
    const outcome = await bashWith(() =>
      Promise.reject(
        new CapabilityError({
          capability: WorkspaceShell.id,
          method: "run",
          code: "exit_nonzero",
          message: "exit code 7\ncurl: (7) Couldn't connect to server\n",
          retryable: false,
          detail: {
            exitCode: 7,
            output: "curl: (7) Couldn't connect to server\n",
            truncated: false,
            durationMs: 3,
            sandboxed: true,
            sandboxBlocks: blocks,
          },
        }),
      ),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.result?.content).toEqual([
      {
        type: "text",
        text: [
          "[exit_nonzero] exit code 7",
          "curl: (7) Couldn't connect to server",
          "",
          "Blocked by network policy: localhost is in blockedDomains.",
          "Blocked by sandbox: writing outside the workspace or to a protected path is not allowed: /etc/hosts",
        ].join("\n"),
      },
    ]);
    expect(outcome.result?.details).toMatchObject({
      code: "sandbox.network_blocked",
      domain: "localhost",
      capabilityCode: "exit_nonzero",
      blocks: [
        { code: "sandbox.network_blocked", domain: "localhost" },
        { code: "sandbox.write_blocked", path: "/etc/hosts" },
      ],
    });
  });

  test("a successful command with a blocked write keeps its output and adds the line", async () => {
    const outcome = await bashWith(() =>
      Promise.resolve({
        exitCode: 0,
        output: "done\n",
        truncated: false,
        durationMs: 3,
        sandboxed: true,
        sandboxBlocks: [{ code: "sandbox.write_blocked", path: "/etc/hosts" }],
      }),
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.result?.content).toEqual([
      { type: "text", text: "done\n" },
      {
        type: "text",
        text: "Blocked by sandbox: writing outside the workspace or to a protected path is not allowed: /etc/hosts",
      },
    ]);
    expect(outcome.result?.details).toEqual({
      code: "sandbox.write_blocked",
      path: "/etc/hosts",
      blocks: [{ code: "sandbox.write_blocked", path: "/etc/hosts" }],
    });
  });

  test("a command with no blocks keeps its plain result and no details", async () => {
    const outcome = await bashWith(() =>
      Promise.resolve({
        exitCode: 0,
        output: "ok\n",
        truncated: false,
        durationMs: 3,
        sandboxed: true,
      }),
    );
    expect(outcome.result?.content).toEqual([{ type: "text", text: "ok\n" }]);
    expect(outcome.result?.details).toBeNull();
  });
});
