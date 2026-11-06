import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import {
  BRIDGE_CAPABILITIES,
  BridgeRequestSchema,
  UI_LIMITS,
  type BridgeCapability,
} from "@fresnel/contracts/extensions";
import { createScreenLedger } from "../../../src/views/ledger.ts";
import {
  createActionRunner,
  decide,
  secretNameOf,
  type BridgePolicyContext,
  type Decision,
  type RunnableAction,
} from "../../../src/views/app/index.ts";
import {
  confirmer,
  fakeBackend,
  ManualTime,
  policyContext,
  type FakeBackendOptions,
} from "./support.ts";

// 셸 기능 op 여섯(ADR-0021 §3.4.3): 판정(선언 없음, 꺼짐, 안전 모드, 다른 확장 접두)과 실행(확인 거절, 속도 초과, 값 비노출)

function decision(op: string, args: unknown, context: BridgePolicyContext): Decision {
  const parsed = parse(BridgeRequestSchema, { v: 1, id: 1, op, args });
  if (!parsed.ok) throw new Error("bad request");
  return decide(parsed.value, context);
}

function actionOf(op: string, args: unknown, context: BridgePolicyContext): RunnableAction {
  const result = decision(op, args, context);
  if (!result.ok || result.action.op === "pong") throw new Error("not runnable");
  return result.action;
}

function build(
  context: BridgePolicyContext,
  answers: ("allow" | "deny")[] = ["allow"],
  backend: FakeBackendOptions = {},
) {
  const time = new ManualTime();
  const fake = fakeBackend(backend);
  const confirm = confirmer(answers);
  const runner = createActionRunner({
    screenKey: "helm/status",
    context: () => context,
    backend: fake.backend,
    ledger: createScreenLedger(),
    clock: time,
    scheduler: time,
    confirm: confirm.confirm,
    onDisabled: () => {},
  });
  return { runner, calls: fake.calls, confirm, time };
}

const CASES: readonly { op: string; args: unknown; capability: string }[] = [
  { op: "pickFile", args: {}, capability: "files" },
  { op: "pickFolder", args: {}, capability: "files" },
  { op: "saveFile", args: { suggestedName: "a.md", content: "x" }, capability: "files" },
  { op: "notify", args: { title: "done" }, capability: "notify" },
  { op: "writeSetting", args: { key: "ext.helm.depth", value: 3 }, capability: "settingsWrite" },
  { op: "registerSecret", args: { name: "token", value: "s3cret" }, capability: "secrets" },
];

const write = (key: string): Decision =>
  decision("writeSetting", { key, value: "v" }, policyContext());

describe("shell ops: decide", () => {
  for (const { op, args, capability } of CASES) {
    test(`${op} is allowed when declared`, () => {
      expect(decision(op, args, policyContext()).ok).toBe(true);
    });
    test(`${op} without the ${capability} declaration is not_declared`, () => {
      const without: ReadonlySet<BridgeCapability> = new Set(
        BRIDGE_CAPABILITIES.filter((name) => name !== capability),
      );
      const result = decision(op, args, policyContext({ capabilities: without }));
      expect(result).toEqual({ ok: false, error: { kind: "not_declared", detail: "capability" } });
    });
    test(`${op} on an extension that is off or in safe mode is refused`, () => {
      expect(decision(op, args, policyContext({ enabled: false }))).toEqual({
        ok: false,
        error: { kind: "extension_off" },
      });
      expect(decision(op, args, policyContext({ safeMode: true }))).toEqual({
        ok: false,
        error: { kind: "safe_mode" },
      });
    });
  }

  test("writeSetting refuses another extension's prefix, an undeclared key and a sensitive key", () => {
    expect(write("ext.other.depth")).toEqual({
      ok: false,
      error: { kind: "not_declared", detail: "setting_key" },
    });
    // 접두는 맞지만 매니페스트가 선언하지 않았다
    expect(write("ext.helm.unlisted").ok).toBe(false);
    // 선언은 했지만 비밀이라 쓰기 목록에 없다(`ext.helm.token`)
    expect(write("ext.helm.token")).toEqual({
      ok: false,
      error: { kind: "not_declared", detail: "setting_key" },
    });
  });

  test("registerSecret builds ext--<extension>--<name> and refuses a double hyphen in the name", () => {
    const ok = decision("registerSecret", { name: "api-key", value: "v" }, policyContext());
    expect(ok).toEqual({
      ok: true,
      action: { op: "registerSecret", secretName: "ext--helm--api-key", value: "v" },
    });
    expect(secretNameOf("a", "b-c")).not.toBe(secretNameOf("a-b", "c"));
    const bad = decision("registerSecret", { name: "a--b", value: "v" }, policyContext());
    expect(bad).toEqual({
      ok: false,
      error: { kind: "args_invalid", detail: "/name double_hyphen" },
    });
  });

  test("saveFile over the byte limit and notify with a blank title are refused", () => {
    const big = "가".repeat(Math.floor(UI_LIMITS.fileBytes / 3) + 1);
    expect(decision("saveFile", { suggestedName: "a", content: big }, policyContext())).toEqual({
      ok: false,
      error: { kind: "too_large" },
    });
    expect(decision("notify", { title: "  " }, policyContext()).ok).toBe(false);
  });
});

describe("shell ops: run", () => {
  test("pickFile returns name and content only, and a second dialog inside 5 seconds is rate limited", async () => {
    const context = policyContext();
    const { runner, calls, time } = build(context);
    const first = await runner.run(actionOf("pickFile", {}, context));
    expect(first).toEqual({ ok: true, value: { name: "a.txt", content: "hello" } });
    const second = await runner.run(actionOf("pickFolder", {}, context));
    expect(second).toEqual({ ok: false, error: { kind: "rate_limited" } });
    time.advance(5000);
    expect(await runner.run(actionOf("pickFolder", {}, context))).toEqual({
      ok: true,
      value: { name: "docs" },
    });
    expect(calls.names).toEqual(["pickFile", "pickFolder"]);
  });

  test("saveFile passes only the suggested name and content", async () => {
    const context = policyContext();
    const { runner, calls } = build(context);
    const result = await runner.run(
      actionOf("saveFile", { suggestedName: "../a.md", content: "body" }, context),
    );
    expect(result).toEqual({ ok: true, value: { saved: true } });
    expect(calls.names).toEqual(["saveFile:../a.md:body"]);
  });

  test("notify carries the extension name in the title and stops after the per-minute limit", async () => {
    const context = policyContext();
    const { runner, calls, time } = build(context);
    for (let i = 0; i < UI_LIMITS.notifyPerMinute; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 순서대로 부른다 (ADR-0021 §3.4.3)
      const sent = await runner.run(actionOf("notify", { title: "t", body: "b" }, context));
      expect(sent.ok).toBe(true);
    }
    expect(calls.names[0]).toBe("notify:helm · t:b");
    const over = await runner.run(actionOf("notify", { title: "t" }, context));
    expect(over).toEqual({ ok: false, error: { kind: "rate_limited" } });
    time.advance(60000);
    expect((await runner.run(actionOf("notify", { title: "t" }, context))).ok).toBe(true);
  });

  test("writeSetting reaches the backend with the declared key and stops after the per-minute limit", async () => {
    const context = policyContext();
    const { runner, calls } = build(context);
    const action = actionOf("writeSetting", { key: "ext.helm.depth", value: 3 }, context);
    expect(await runner.run(action)).toEqual({ ok: true, value: null });
    expect(calls.names).toEqual(["writeSetting:ext.helm.depth:3"]);
    for (let i = 1; i < UI_LIMITS.settingWritesPerMinute; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 순서대로 부른다 (ADR-0021 §3.4.3)
      await runner.run(action);
    }
    expect(await runner.run(action)).toEqual({ ok: false, error: { kind: "rate_limited" } });
  });

  test("registerSecret asks every time, names the key, never shows the value, and says overwrite when the key exists", async () => {
    const context = policyContext();
    const { runner, calls, confirm } = build(context, ["allow"], { secretExists: true });
    const result = await runner.run(
      actionOf("registerSecret", { name: "token", value: "s3cret-value" }, context),
    );
    expect(result).toEqual({ ok: true, value: null });
    expect(
      confirm.asked.map((line) => [line.kind, line.action, line.overwrite, line.paramsSummary]),
    ).toEqual([["secret", "ext--helm--token", true, ""]]);
    expect(JSON.stringify(confirm.asked)).not.toContain("s3cret-value");
    expect(calls.names).toEqual([
      "secretExists:ext--helm--token",
      "registerSecret:ext--helm--token:12:true",
    ]);
  });

  test("registerSecret for a new key is not an overwrite, a denial stops it, and a second try inside 5 seconds is rate limited", async () => {
    const context = policyContext();
    const { runner, calls, confirm } = build(context, ["deny", "allow"]);
    const action = actionOf("registerSecret", { name: "token", value: "v" }, context);
    expect(await runner.run(action)).toEqual({
      ok: false,
      error: { kind: "denied", detail: "not_confirmed" },
    });
    expect(calls.names).toEqual(["secretExists:ext--helm--token"]);
    expect(await runner.run(action)).toEqual({ ok: false, error: { kind: "rate_limited" } });
    expect(confirm.asked.map((line) => line.overwrite)).toEqual([undefined]);
  });
});
