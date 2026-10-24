import { describe, expect, test } from "bun:test";
import { mapAnnotations } from "../src/client/annotations.ts";
import { buildApprovalRules, toolRuleKey } from "../src/servers/policy.ts";
import type { ServerDefinition } from "../src/types.ts";
import { buildWorld, startWorld } from "./support/world.ts";

describe("annotations", () => {
  test("maps hints when trusted", () => {
    const mapped = mapAnnotations(
      "t",
      "Title",
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        title: "Other",
      },
      true,
    );
    expect(mapped.hints).toEqual({
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
    });
    // title이 있으면 annotations.title보다 앞선다
    expect(mapped.label).toBe("Title");
    expect(mapAnnotations("t", undefined, { title: "From annotations" }, true).label).toBe(
      "From annotations",
    );
    expect(mapAnnotations("name", undefined, undefined, true).label).toBe("name");
  });

  test("defaults applied when absent", () => {
    expect(mapAnnotations("t", undefined, undefined, true).hints).toEqual({
      readOnly: false,
      destructive: true,
      idempotent: false,
      openWorld: true,
    });
    expect(mapAnnotations("t", undefined, { readOnlyHint: true }, true).hints).toEqual({
      readOnly: true,
      destructive: true,
      idempotent: false,
      openWorld: true,
    });
  });

  test("untrusted annotations not used for policy", () => {
    const mapped = mapAnnotations("t", undefined, { readOnlyHint: true }, false);
    expect(mapped.hints).toEqual({});
    expect(mapped.details).toEqual({ mcpAnnotations: { readOnlyHint: true } });
    expect(mapAnnotations("t", undefined, undefined, false).details).toBeUndefined();
  });

  test("readOnlyHint reaches the tool only when annotations are trusted", async () => {
    const annotated = { name: "peek", annotations: { readOnlyHint: true } };
    const trusted = buildWorld({
      servers: {
        stub: { stub: { era: "modern", tools: [annotated] }, def: { trustAnnotations: true } },
      },
    });
    await startWorld(trusted);
    await trusted.runtime.applyBoundary();
    expect(trusted.registrar.registered[0]?.hints.readOnly).toBe(true);
    await trusted.runtime.shutdown();

    const untrusted = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [annotated] } } },
    });
    await startWorld(untrusted);
    await untrusted.runtime.applyBoundary();
    expect(untrusted.registrar.registered[0]?.hints).toEqual({});
    expect(untrusted.registrar.registered[0]?.details).toEqual({
      mcpAnnotations: { readOnlyHint: true },
    });
    expect(untrusted.registrar.registered[0]?.replay).toBe("unsafe");
    await untrusted.runtime.shutdown();
  });

  test("approval rules keys", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: { era: "modern", tools: [{ name: "echo" }, { name: "wipe" }, { name: "hidden" }] },
          def: {
            tools: {
              approval: { echo: "auto", wipe: "deny", hidden: "auto", missing: "auto" },
              deny: ["hidden"],
            },
          },
        },
      },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    const rules = world.rules.at(-1) ?? [];
    expect(rules.find((rule) => rule.id === "mcp.default")).toMatchObject({
      effect: "ask",
      resource: { mcpServer: "*" },
    });
    expect(rules.find((rule) => rule.id === "mcp.stub.echo")).toMatchObject({
      effect: "allow",
      resource: { mcpServer: "stub", tool: "echo" },
      description: "mcp__stub__echo",
    });
    expect(rules.find((rule) => rule.id === "mcp.stub.wipe")?.effect).toBe("deny");
    // 숨긴 도구와 광고하지 않은 도구는 서버 전체에 걸리는 규칙을 만들지 않는다
    expect(rules.find((rule) => rule.id === "mcp.stub.hidden")).toBeUndefined();
    expect(rules.find((rule) => rule.id === "mcp.stub.missing")).toBeUndefined();
    expect(toolRuleKey("stub", "echo")).toBe("mcp__stub__echo");
    await world.runtime.shutdown();
  });

  test("a rule equal to the default is not repeated", () => {
    const server: ServerDefinition = {
      id: "stub",
      source: "settings:user",
      managed: false,
      requiresTrust: false,
      def: {
        transport: { type: "stdio", command: "x" },
        tools: { approval: { a: "prompt", b: "auto" } },
      },
    };
    const set = buildApprovalRules(
      [server],
      [
        { server: "stub", name: "a", machineName: "a" },
        { server: "stub", name: "b", machineName: "b" },
      ],
      "prompt",
    );
    expect(set.rules.map((rule) => rule.id)).toEqual(["mcp.default", "mcp.stub.b"]);
    expect(set.keys.get("mcp.stub.b")).toBe("mcp__stub__b");
  });
});
