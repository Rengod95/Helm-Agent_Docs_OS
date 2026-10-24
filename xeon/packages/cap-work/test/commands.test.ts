import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type {
  CommandActionContext,
  CommandActionDecl,
  CommandActionHandler,
  CommandActionRegistry,
  CommandActionResult,
} from "@xeon/contracts/capabilities";
import { registerWorkCommands, WORK_COMMAND_ORIGIN } from "../src/commands.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { PlanId } from "./support/plans.ts";

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

interface FakeRegistry extends CommandActionRegistry {
  readonly decls: CommandActionDecl[];
  readonly removed: string[];
  run(name: string, args: readonly string[]): Promise<CommandActionResult>;
}

function fakeRegistry(h: Harness): FakeRegistry {
  const handlers = new Map<string, CommandActionHandler>();
  const decls: CommandActionDecl[] = [];
  const removed: string[] = [];
  let counter = 0;
  return {
    decls,
    removed,
    registerAction(decl, handler) {
      decls.push(decl);
      handlers.set(decl.name, handler);
      return () => {
        removed.push(decl.name);
      };
    },
    run(name, args) {
      const handler = handlers.get(name);
      if (handler === undefined) throw new Bug(`no command ${name}`);
      counter += 1;
      const ctx: CommandActionContext = {
        threadId: h.threadId,
        requestId: `in:cmd${counter}`,
        signal: new AbortController().signal,
      };
      return handler(args, ctx);
    },
  };
}

async function boot() {
  opened = await openHarness();
  const registry = fakeRegistry(opened);
  const unregister = registerWorkCommands(registry, {
    plans: opened.plans,
    tasks: opened.api,
    runtime: opened.runtime,
  });
  return { h: opened, registry, unregister };
}

describe("work commands", () => {
  test("/plan and /tasks are registered with the cap-work origin and removed together", async () => {
    const { registry, unregister } = await boot();
    expect(registry.decls.map((d) => `${d.name}:${d.origin}`)).toEqual([
      `plan:${WORK_COMMAND_ORIGIN}`,
      `tasks:${WORK_COMMAND_ORIGIN}`,
    ]);
    unregister();
    expect(registry.removed).toEqual(["plan", "tasks"]);
  });

  test("/plan enters plan mode and /plan exit leaves it after an approval", async () => {
    const { h, registry } = await boot();
    expect((await registry.run("plan", [])).message).toContain("계획 모드를 시작");
    expect(h.mode.current(h.threadId)).toBe("plan");
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect((await registry.run("plan", ["approve", "looks", "good"])).message).toContain(
      "승인했습니다",
    );
    await h.settle();
    expect(h.mode.current(h.threadId)).toBe("default");
  });

  test("/plan reject and /plan revise answer the pending plan", async () => {
    const { h, registry } = await boot();
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect((await registry.run("plan", ["revise"])).message).toContain("피드백이 필요");
    expect((await registry.run("plan", ["revise", "add", "tests"])).message).toContain(
      "수정을 요청",
    );
    await h.plans.submit({ title: "t", body: "b2" }, h.opts("c2"));
    expect((await registry.run("plan", ["reject", "no", "thanks"])).message).toContain(
      "반려했습니다",
    );
    const versions = await h.plans.versions({ planId: PlanId("p1") }, h.opts());
    expect(versions.versions[0]).toMatchObject({
      status: "revision_requested",
      feedback: "add tests",
    });
  });

  test("without a pending plan the decide commands say so", async () => {
    const { registry } = await boot();
    expect((await registry.run("plan", ["approve"])).message).toBe(
      "승인 대기 중인 계획이 없습니다.",
    );
    expect((await registry.run("plan", ["unknown"])).message).toContain("사용법");
  });

  test("a service refusal reaches the user as one line instead of an exception", async () => {
    const { registry } = await boot();
    const result = await registry.run("plan", ["exit"]);
    expect(result.message).toBe("[plan_mode_inactive] Plan mode is not active.");
  });

  test("/tasks prints the checklist", async () => {
    const { h, registry } = await boot();
    expect((await registry.run("tasks", [])).message).toBe("(작업 없음)");
    await h.api.write(
      {
        ops: [
          {
            op: "create",
            content: "write spec",
            status: "in_progress",
            activeForm: "writing the spec",
          },
        ],
      },
      h.opts(),
    );
    expect((await registry.run("tasks", [])).message).toBe("[>] t1 writing the spec");
  });
});
