import { expect, test } from "bun:test";
import { err } from "@fresnel/contracts";
import type { McpSpawnSpec } from "../src/ports/process.ts";
import type { McpStartDefinition, McpStartGate } from "../src/ports/start-gate.ts";
import type { ServerDefinition } from "../src/types.ts";
import { createTransportFactory } from "../src/transport/factory.ts";
import { fixedClock, manualScheduler } from "./support/time.ts";

// 결정 2026-11-04 A3. 신뢰한 프로젝트의 새 `.mcp.json` 명령은 시크릿이 없어도 기동 승인을 받고, 승인 전에는 spawn하지 않는다.

function setup(verdict: "pending" | "denied") {
  const asked: McpStartDefinition[] = [];
  const spawned: McpSpawnSpec[] = [];
  const gate: McpStartGate = {
    check(definition) {
      asked.push(definition);
      return Promise.resolve(
        verdict === "pending" ? { kind: "pending" } : { kind: "denied", reason: "no" },
      );
    },
    onResolved: () => () => undefined,
  };
  const factory = createTransportFactory({
    process: {
      spawn(spec) {
        spawned.push(spec);
        return Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT", message: "stub" }));
      },
    },
    secrets: undefined,
    scheduler: manualScheduler(fixedClock()),
    stdioGraceMs: 10,
    fetch: undefined,
    startGate: gate,
  });
  return { asked, spawned, factory };
}

function definition(source: string, requiresTrust: boolean, command: string): ServerDefinition {
  return {
    id: "proj",
    source,
    managed: false,
    requiresTrust,
    def: { transport: { type: "stdio", command, args: ["--x"], env: { LOG: "1" } } },
  };
}

const signal = new AbortController().signal;

test("a project-origin command without secrets waits for approval and is not spawned", async () => {
  const { asked, spawned, factory } = setup("pending");
  const opened = await factory.open(definition("mcpjson:project", true, "node-srv"), signal);
  expect(opened.ok).toBe(false);
  if (opened.ok) return;
  expect(opened.error.code).toBe("approval_required");
  expect(spawned).toEqual([]);
  expect(asked).toEqual([
    {
      server: "proj",
      source: "mcpjson:project",
      command: "node-srv",
      args: ["--x"],
      cwd: null,
      env: { LOG: "1" },
      secretEnv: {},
    },
  ]);
});

test("a denied project command is not spawned either", async () => {
  const { spawned, factory } = setup("denied");
  const opened = await factory.open(definition("mcpjson:fresnel", true, "node-srv"), signal);
  expect(opened.ok ? "ok" : opened.error.code).toBe("secret_denied");
  expect(spawned).toEqual([]);
});

test("a user-settings command without secrets never asks", async () => {
  const { asked, spawned, factory } = setup("pending");
  await factory.open(definition("settings:user", false, "node-srv"), signal);
  expect(asked).toEqual([]);
  expect(spawned).toHaveLength(1);
});
