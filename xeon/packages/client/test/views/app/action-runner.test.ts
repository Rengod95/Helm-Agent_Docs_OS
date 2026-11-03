import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { BridgeRequestSchema } from "@fresnel/contracts/extensions";
import { createScreenLedger } from "../../../src/views/ledger.ts";
import {
  createActionRunner,
  decide,
  type BridgeBackend,
  type BridgePolicyContext,
  type ConfirmRequest,
  type RunnableAction,
} from "../../../src/views/app/index.ts";
import { confirmer, fakeBackend, ManualTime, policyContext } from "./support.ts";

// 선언형 화면과 프레임이 같이 쓰는 실행기: 판정을 통과한 동작만 받고, 확인 줄과 예산과 상한이 여기서 걸린다

function actionOf(op: string, args: unknown, context: BridgePolicyContext): RunnableAction {
  const parsed = parse(BridgeRequestSchema, { v: 1, id: 1, op, args });
  if (!parsed.ok) throw new Error("bad request");
  const decision = decide(parsed.value, context);
  if (!decision.ok || decision.action.op === "pong") throw new Error("not runnable");
  return decision.action;
}

function build(options: {
  context: () => BridgePolicyContext;
  backend?: BridgeBackend;
  answers?: ("allow" | "deny")[];
  recheck?: () => Promise<BridgePolicyContext | undefined>;
  cancelled?: ConfirmRequest[];
}) {
  const time = new ManualTime();
  const ledger = createScreenLedger();
  const fake = fakeBackend();
  const confirm = confirmer(options.answers ?? ["allow"]);
  const runner = createActionRunner({
    screenKey: "helm/status",
    context: options.context,
    backend: options.backend ?? fake.backend,
    ledger,
    clock: time,
    scheduler: time,
    confirm: confirm.confirm,
    ...(options.cancelled === undefined
      ? {}
      : { cancelConfirm: (line: ConfirmRequest) => options.cancelled?.push(line) }),
    ...(options.recheck === undefined ? {} : { recheck: options.recheck }),
    onDisabled: () => {},
  });
  return { runner, ledger, calls: fake.calls, confirm, time };
}

describe("action runner", () => {
  test("a declarative button's command asks the line with its args and counts a denial in the ledger", async () => {
    const context = policyContext({ ownCommands: new Set(["helm-start"]) });
    const { runner, ledger, calls, confirm } = build({ context: () => context, answers: ["deny"] });
    const result = await runner.run(
      actionOf("command", { name: "helm-start", args: "mode=fast" }, context),
    );
    expect(result).toEqual({ ok: false, error: { kind: "denied", detail: "not_confirmed" } });
    expect(confirm.asked.map((line) => [line.action, line.paramsSummary])).toEqual([
      ["/helm-start", 'args="mode=fast"'],
    ]);
    expect(calls.names).toEqual([]);
    expect(ledger.stateOf("helm/status")).toEqual({ state: "active", consecutive: 1 });
  });

  test("three denials in a row open the cooldown: the next command is refused without a line", async () => {
    const context = policyContext({ ownCommands: new Set(["helm-start"]) });
    const { runner, confirm } = build({
      context: () => context,
      answers: ["deny", "deny", "deny", "allow"],
    });
    const action = actionOf("command", { name: "helm-start", args: "" }, context);
    await runner.run(action);
    await runner.run(action);
    await runner.run(action);
    const fourth = await runner.run(action);
    expect(fourth).toEqual({ ok: false, error: { kind: "denied", detail: "confirm_cooldown" } });
    expect(confirm.asked.length).toBe(3);
  });

  test("the extension turned off after the line was allowed stops the command, even if the screen's context is stale", async () => {
    const stale = policyContext({ ownCommands: new Set(["helm-start"]) });
    const off = policyContext({ enabled: false, ownCommands: new Set(["helm-start"]) });
    const { runner, calls } = build({
      context: () => stale,
      recheck: () => Promise.resolve(off),
    });
    const result = await runner.run(actionOf("command", { name: "helm-start", args: "" }, stale));
    expect(result).toEqual({ ok: false, error: { kind: "extension_off" } });
    expect(calls.names).toEqual([]);
  });

  test("a context that cannot be read blocks the write instead of letting it through", async () => {
    const context = policyContext({ ownCommands: new Set(["helm-start"]) });
    const { runner, calls } = build({
      context: () => context,
      recheck: () => Promise.resolve(undefined),
    });
    const result = await runner.run(actionOf("command", { name: "helm-start", args: "" }, context));
    expect(result).toEqual({ ok: false, error: { kind: "failed", detail: "context_unavailable" } });
    expect(calls.names).toEqual([]);
  });

  test("events, settings and query that finish after the extension was turned off return no data", async () => {
    let enabled = true;
    const context = (): BridgePolicyContext => policyContext({ enabled });
    const secret = { phase: "secret" };
    const { backend } = fakeBackend();
    const turnsOff: BridgeBackend = {
      ...backend,
      events: () => {
        enabled = false;
        return Promise.resolve({ ok: true, value: [secret] });
      },
      settings: () => {
        enabled = false;
        return Promise.resolve({ ok: true, value: [] });
      },
      query: () => {
        enabled = false;
        return Promise.resolve({ ok: true, value: secret });
      },
    };
    const readWith = (op: string, args: unknown): Promise<unknown> => {
      enabled = true;
      const { runner } = build({ context, backend: turnsOff });
      return runner.run(actionOf(op, args, context()));
    };
    const results = [
      await readWith("events", { kinds: ["turn.started"] }),
      await readWith("settings", { keys: ["ext.helm.depth"] }),
      await readWith("query", { verb: "status" }),
    ];
    expect(results).toEqual([
      { ok: false, error: { kind: "extension_off" } },
      { ok: false, error: { kind: "extension_off" } },
      { ok: false, error: { kind: "extension_off" } },
    ]);
  });

  test("a read over the result limit is refused and counted", async () => {
    const context = policyContext();
    const { backend } = fakeBackend({ queryResult: { ok: true, value: "x".repeat(300_000) } });
    const { runner, ledger } = build({ context: () => context, backend });
    const result = await runner.run(actionOf("query", { verb: "status" }, context));
    expect(result).toEqual({ ok: false, error: { kind: "too_large" } });
    expect(ledger.stateOf("helm/status")).toEqual({ state: "active", consecutive: 1 });
  });
});
