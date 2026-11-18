import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { defineManifest, type StepResult } from "@fresnel/contracts/extensions";
import {
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  LeaseRequestedPayloadSchema,
} from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import { ExtHostPortKey, hostOf, type ExtHost } from "@fresnel/ext-host";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AGE-26: 재시작 뒤에도 맡기기와 대기 중이던 시작 요청이 이어진다. 실제 엔진(SQLite)에 같은 저장소를 두 번 올려 본다.
// 첫 호스트는 맡기기 도중(맡은 쪽이 일을 붙들고 있는 중)에 닫히고, 둘째 호스트가 같은 저장소의 대화를 열면 맡은 쪽이 맡긴 입력으로 이어 하고
// 끝나면 맡긴 쪽이 결과를 받는다. 상한을 넘는 입력은 거절되고 이유가 돌아온다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Call {
  readonly plugin: string;
  readonly last: StepResult | null;
  readonly calledBy: string | null;
  readonly input: JsonValue | null;
}

/** 시험이 정하는 두 플러그인의 동작. 호스트를 다시 올릴 때 새 스크립트를 준다 */
interface Script {
  readonly calls: Call[];
  /** 맡긴 쪽(hr-a)이 첫 단계에서 낼 맡기기 입력. null이면 맡기지 않는다 */
  readonly handoffInput: JsonValue | null;
  /** 맡은 쪽(hr-b)이 일을 끝내는가. 거짓이면 단계가 끝나지 않고 붙들린다 */
  readonly bFinishes: boolean;
  /** 맡긴 쪽(hr-a)이 첫 단계에서 일을 붙들고 있는가(맡기지 않고 기다린다) */
  readonly aHolds: boolean;
  /** 맡은 쪽(hr-b)의 단계가 불렸다 */
  readonly bCalled: PromiseWithResolvers<void>;
}

function driveModule(name: string, script: Script, ext: { current: ExtHost | undefined }) {
  const module: HostPluginModule = {
    manifest: defineManifest({
      schemaVersion: 2,
      name,
      version: "0.1.0",
      displayName: name,
      description: "Handoff restart test plugin.",
      defaultEnabled: true,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [], drives: true }],
      trust: { level: "builtin" },
    }),
    extension: ({ register }) => {
      register(name, {}, (g) => {
        ext.current = hostOf(g).port(ExtHostPortKey);
        g.drive(async ({ last, frame }) => {
          script.calls.push({ plugin: name, last, calledBy: frame.calledBy, input: frame.input });
          if (name === "hr-a") {
            if (last === null && script.aHolds) return await new Promise<never>(() => {});
            if (last === null && script.handoffInput !== null) {
              return { do: "handoff", to: "hr-b", input: script.handoffInput };
            }
            return { do: "done", result: last === null ? "none" : "got" };
          }
          script.bCalled.resolve();
          if (!script.bFinishes) return await new Promise<never>(() => {});
          return { do: "done", result: { echo: frame.input, by: frame.calledBy } };
        });
      });
    },
  };
  return module;
}

async function startHost(script: Script, ext: { current: ExtHost | undefined }) {
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [driveModule("hr-a", script, ext), driveModule("hr-b", script, ext)],
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return { host, connection, collector };
}

function acquiredOf(events: readonly EventWire[]) {
  return events.flatMap((event) => {
    if (event.kind !== "lease.acquired") return [];
    const parsed = parse(LeaseAcquiredPayloadSchema, event.payload);
    return parsed.ok ? [parsed.value] : [];
  });
}

function releasedOf(events: readonly EventWire[]) {
  return events.flatMap((event) => {
    if (event.kind !== "lease.released") return [];
    const parsed = parse(LeaseReleasedPayloadSchema, event.payload);
    return parsed.ok ? [parsed.value] : [];
  });
}

function requestedOf(events: readonly EventWire[]) {
  return events.flatMap((event) => {
    if (event.kind !== "lease.requested") return [];
    const parsed = parse(LeaseRequestedPayloadSchema, event.payload);
    return parsed.ok ? [parsed.value] : [];
  });
}

// 엔진의 입력 상한(200,000바이트, X.primitives.spec §10)을 한 글자 넘는 입력
const OVER_LIMIT = "x".repeat(200_001);

const BASE_SETTINGS = { "x.primitives.driveRequiresGroup": false };

realTest(
  "a restart in the middle of a handoff: the handed-off plugin continues with the recorded input and its caller receives the result",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    const task: JsonValue = { task: "collect", n: 3 };
    // ── 첫 호스트: A가 B에게 맡기고 B는 일을 붙들고 있다 ──
    const first: Script = {
      calls: [],
      handoffInput: task,
      bFinishes: false,
      aHolds: false,
      bCalled: Promise.withResolvers<void>(),
    };
    const firstExt: { current: ExtHost | undefined } = { current: undefined };
    const one = await startHost(first, firstExt);
    const created = await one.connection.request("thread.create", {});
    const started = firstExt.current?.startDrive(created.threadId, "hr-a");
    expect(started?.ok).toBe(true);
    await one.collector.waitFor(
      (event) =>
        event.kind === "lease.acquired" && acquiredOf([event]).some((a) => a.scopeId === "hr-b"),
      30_000,
    );
    await first.bCalled.promise;
    const seenInFirst = one.collector.events.filter((event) => event.kind.startsWith("lease."));
    const grantedB = acquiredOf(seenInFirst).find((entry) => entry.scopeId === "hr-b");
    expect(grantedB?.input).toEqual(task);
    expect(requestedOf(seenInFirst).map((entry) => [entry.scopeId, entry.trigger])).toEqual([
      ["hr-a", "user"],
      ["hr-b", "handoff"],
    ]);
    expect(first.calls.map((call) => call.plugin)).toEqual(["hr-a", "hr-b"]);
    await one.connection.close();
    await one.host.close();

    // ── 둘째 호스트: 같은 저장소. B가 이번에는 끝낸다 ──
    const second: Script = {
      calls: [],
      handoffInput: task,
      bFinishes: true,
      aHolds: false,
      bCalled: Promise.withResolvers<void>(),
    };
    const secondExt: { current: ExtHost | undefined } = { current: undefined };
    const two = await startHost(second, secondExt);
    await two.connection.request("thread.open", { threadId: created.threadId, mode: "write" });
    await two.collector.waitFor(
      (event) =>
        event.kind === "lease.released" &&
        releasedOf([event]).some((released) => released.scopeId === "hr-a"),
      30_000,
    );
    // 맨 위 B만 다시 불리고 맡긴 입력을 받는다. 끝나면 A가 결과를 받는다
    expect(second.calls).toEqual([
      { plugin: "hr-b", last: null, calledBy: "hr-a", input: task },
      {
        plugin: "hr-a",
        last: { kind: "handoff", status: "done", result: { echo: task, by: "hr-a" } },
        calledBy: null,
        input: null,
      },
    ]);
    const released = releasedOf(two.collector.events);
    expect(released.find((entry) => entry.scopeId === "hr-b")?.result).toEqual({
      echo: task,
      by: "hr-a",
    });
    await two.connection.close();
    await two.host.close();
    home.dispose();
  },
  90_000,
);

realTest(
  "a start request that was waiting for a busy stack survives a restart and is granted afterwards with its input",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    const first: Script = {
      calls: [],
      handoffInput: null,
      bFinishes: false,
      aHolds: true,
      bCalled: Promise.withResolvers<void>(),
    };
    const firstExt: { current: ExtHost | undefined } = { current: undefined };
    const one = await startHost(first, firstExt);
    const created = await one.connection.request("thread.create", {});
    expect(firstExt.current?.startDrive(created.threadId, "hr-a").ok).toBe(true);
    await one.collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
    // A가 단계를 붙들고 있는 동안 사용자 명령이 hr-b를 요청한다. 전환은 단계가 끝난 뒤라 요청은 큐에서 기다린다
    expect(
      firstExt.current?.startDrive(created.threadId, "hr-b", { input: { from: "user" } }).ok,
    ).toBe(true);
    await one.collector.waitFor(
      (event) =>
        event.kind === "lease.requested" && requestedOf([event]).some((r) => r.scopeId === "hr-b"),
      30_000,
    );
    expect(acquiredOf(one.collector.events).map((entry) => entry.scopeId)).toEqual(["hr-a"]);
    await one.connection.close();
    await one.host.close();

    const second: Script = {
      calls: [],
      handoffInput: null,
      bFinishes: true,
      aHolds: false,
      bCalled: Promise.withResolvers<void>(),
    };
    const secondExt: { current: ExtHost | undefined } = { current: undefined };
    const two = await startHost(second, secondExt);
    await two.connection.request("thread.open", { threadId: created.threadId, mode: "write" });
    await two.collector.waitFor(
      (event) =>
        event.kind === "lease.acquired" && acquiredOf([event]).some((a) => a.scopeId === "hr-b"),
      30_000,
    );
    const grantedB = acquiredOf(two.collector.events).find((entry) => entry.scopeId === "hr-b");
    expect(grantedB?.input).toEqual({ from: "user" });
    expect(grantedB?.requestId).toBeDefined();
    await two.collector.waitFor(
      (event) =>
        event.kind === "lease.released" &&
        releasedOf([event]).some((released) => released.scopeId === "hr-b"),
      30_000,
    );
    expect(second.calls.find((call) => call.plugin === "hr-b")?.input).toEqual({ from: "user" });
    await two.connection.close();
    await two.host.close();
    home.dispose();
  },
  90_000,
);

realTest(
  "an input over the limit is refused with a reason for both a handoff and a user start, and nothing is recorded for it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    const big = OVER_LIMIT;
    const script: Script = {
      calls: [],
      handoffInput: big,
      bFinishes: true,
      aHolds: false,
      bCalled: Promise.withResolvers<void>(),
    };
    const ext: { current: ExtHost | undefined } = { current: undefined };
    const run = await startHost(script, ext);
    const created = await run.connection.request("thread.create", {});
    // 사용자 명령의 입력
    expect(ext.current?.startDrive(created.threadId, "hr-b", { input: big })).toEqual({
      ok: false,
      error: { kind: "input_too_large" },
    });
    // 맡기기 입력: 맡긴 쪽이 거절 이유를 결과로 받는다
    expect(ext.current?.startDrive(created.threadId, "hr-a").ok).toBe(true);
    await run.collector.waitFor(
      (event) =>
        event.kind === "lease.released" &&
        releasedOf([event]).some((released) => released.scopeId === "hr-a"),
      30_000,
    );
    expect(script.calls.map((call) => [call.plugin, call.last])).toEqual([
      ["hr-a", null],
      ["hr-a", { kind: "refused", code: "input_too_large" }],
    ]);
    expect(acquiredOf(run.collector.events).map((entry) => entry.scopeId)).toEqual(["hr-a"]);
    expect(requestedOf(run.collector.events).map((entry) => entry.scopeId)).toEqual(["hr-a"]);
    await run.connection.close();
    await run.host.close();
    home.dispose();
  },
  90_000,
);

realTest(
  "a secret inside a handed-off input and result stays raw in the payload and the wire event carries leaf marks for it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    // "ghp_" 뒤 36자는 호스트의 깃허브 토큰 패턴에 걸린다. 실제 값이 아니다
    const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    const task: JsonValue = { note: `use ${TOKEN} now` };
    const script: Script = {
      calls: [],
      handoffInput: task,
      bFinishes: true,
      aHolds: false,
      bCalled: Promise.withResolvers<void>(),
    };
    const ext: { current: ExtHost | undefined } = { current: undefined };
    const run = await startHost(script, ext);
    const created = await run.connection.request("thread.create", {});
    expect(ext.current?.startDrive(created.threadId, "hr-a").ok).toBe(true);
    await run.collector.waitFor(
      (event) =>
        event.kind === "lease.released" &&
        releasedOf([event]).some((released) => released.scopeId === "hr-b"),
      30_000,
    );
    const marked = (kind: string, scope: string) =>
      run.collector.events.find(
        (event) =>
          event.kind === kind &&
          (kind === "lease.released" ? releasedOf([event]) : acquiredOf([event])).some(
            (entry) => entry.scopeId === scope,
          ),
      );
    const granted = marked("lease.acquired", "hr-b");
    expect(granted?.payload).toMatchObject({ input: task });
    expect(granted?.mask).toEqual([
      { pointer: "/input/note", len: 48, ranges: [{ start: 4, end: 44, label: "github_token" }] },
    ]);
    const finished = marked("lease.released", "hr-b");
    expect(finished?.mask?.map((leaf) => leaf.pointer)).toEqual(["/result/echo/note"]);
    // 표식은 구간과 길이, 표지 이름만 든다. 값은 없다
    expect(JSON.stringify([granted?.mask, finished?.mask])).not.toContain(TOKEN);
    await run.connection.close();
    await run.host.close();
    home.dispose();
  },
  90_000,
);
