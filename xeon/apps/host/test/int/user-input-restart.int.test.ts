import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { defineManifest, type StepResult } from "@fresnel/contracts/extensions";
import { LeaseUserInputPayloadSchema } from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { ExtHostPortKey, hostOf, type ExtHost } from "@fresnel/ext-host";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle } from "../fixtures/wire-client.ts";

// AGE-26: Drive 중에 받은 사용자 메시지는 재시작 뒤에도 플러그인에 전달된다. 실제 엔진(SQLite)에 같은 저장소를 두 번 올린다.
// 메시지는 코어 루프의 입력 큐에 들어가지 않고 주도 프레임이 가로채므로 `lease.user_input`(held, settled)이 그 기록이다.
// 최소 한 번 전달: 단계에 전달됐으나 정착 전에 죽었으면 같은 메시지가 같은 `last.requestId`로 다시 전달된다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const BASE_SETTINGS = { ...TAPE_SETTINGS, "x.primitives.driveRequiresGroup": false };

interface Call {
  readonly last: StepResult | null;
}

/** 시험이 정하는 플러그인 동작. 호스트를 다시 올릴 때 새 스크립트를 준다 */
interface Script {
  readonly calls: Call[];
  /** hold-first: 첫 단계가 끝나지 않는다(메시지가 와도 전달 전). hold-user: 메시지를 받고 단계가 끝나지 않는다. run: 메시지를 turn으로 처리한다 */
  readonly mode: "hold-first" | "hold-user" | "run";
  readonly userSeen: PromiseWithResolvers<void>;
}

function driveModule(script: Script, ext: { current: ExtHost | undefined }): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name: "ui-restart",
      version: "0.1.0",
      displayName: "ui-restart",
      description: "User message restart test plugin.",
      defaultEnabled: true,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [], drives: true }],
      trust: { level: "builtin" },
    }),
    extension: ({ register }) => {
      register("ui-restart", {}, (g) => {
        ext.current = hostOf(g).port(ExtHostPortKey);
        g.drive(async ({ last }) => {
          script.calls.push({ last });
          if (last === null) {
            if (script.mode === "hold-first") return await new Promise<never>(() => {});
            return { do: "yield" };
          }
          if (last.kind === "user") {
            script.userSeen.resolve();
            if (script.mode === "hold-user") return await new Promise<never>(() => {});
            return { do: "turn", input: last.message };
          }
          return { do: "done" };
        });
      });
    },
  };
}

function oneAnswer() {
  return tapePlayer(
    tape("ui-restart", [
      {
        role: "main" as const,
        label: "answer",
        response: {
          type: "message" as const,
          content: [t.text("ok")],
          stopReason: "stop" as const,
        },
      },
    ]),
    { clock: realTapeClock() },
  );
}

async function startHost(script: Script, ext: { current: ExtHost | undefined }) {
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [driveModule(script, ext)],
    buildModels: tapeBuildModels(tapeProvider(oneAnswer())),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return { host, connection, collector };
}

function userInputsOf(events: readonly EventWire[]) {
  return events.flatMap((event) => {
    if (event.kind !== "lease.user_input") return [];
    const parsed = parse(LeaseUserInputPayloadSchema, event.payload);
    return parsed.ok ? [parsed.value] : [];
  });
}

function newScript(mode: Script["mode"]): Script {
  return { calls: [], mode, userSeen: Promise.withResolvers<void>() };
}

function userCalls(script: Script) {
  return script.calls.flatMap((call) =>
    call.last !== null && call.last.kind === "user" ? [call.last] : [],
  );
}

realTest(
  "a user message that was held before delivery (the first step never returned) is delivered after a restart",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    const firstExt: { current: ExtHost | undefined } = { current: undefined };
    const one = await startHost(newScript("hold-first"), firstExt);
    const created = await one.connection.request("thread.create", {});
    expect(firstExt.current?.startDrive(created.threadId, "ui-restart").ok).toBe(true);
    await one.collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
    const sent = await startInputWhenIdle(one.connection, {
      threadId: created.threadId,
      input: "hello after restart",
    });
    expect(sent).toEqual({ delivered: true });
    const held = await one.collector.waitFor((event) => event.kind === "lease.user_input", 30_000);
    const [heldPayload] = userInputsOf([held]);
    expect(heldPayload?.status).toBe("held");
    const heldId = heldPayload?.requestId;
    if (heldId === undefined) throw new Error("the held record has no request id");
    expect(heldPayload?.input).toEqual({ kind: "user", content: "hello after restart" });
    await one.connection.close();
    await one.host.close();

    const second = newScript("run");
    const secondExt: { current: ExtHost | undefined } = { current: undefined };
    const two = await startHost(second, secondExt);
    await two.connection.request("thread.open", { threadId: created.threadId, mode: "write" });
    await two.collector.waitFor(
      (event) => event.kind === "turn.completed" && event.threadId === created.threadId,
      30_000,
    );
    await two.collector.waitFor(
      (event) => userInputsOf([event]).some((entry) => entry.status === "settled"),
      30_000,
    );
    // 같은 메시지가 같은 식별자로 한 번 전달되고 turn 하나가 그것을 처리한다
    expect(userCalls(second)).toEqual([
      {
        kind: "user",
        message: { kind: "user", content: "hello after restart" },
        requestId: heldId,
      },
    ]);
    expect(two.collector.events.filter((event) => event.kind === "turn.started")).toHaveLength(1);
    expect(userInputsOf(two.collector.events)).toEqual([
      { requestId: heldId, scopeId: "ui-restart", status: "settled" },
    ]);
    await two.connection.close();
    await two.host.close();
    home.dispose();
  },
  90_000,
);

realTest(
  "a user message delivered to a step that never settled is delivered again with the same request id after a restart",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    const firstScript = newScript("hold-user");
    const firstExt: { current: ExtHost | undefined } = { current: undefined };
    const one = await startHost(firstScript, firstExt);
    const created = await one.connection.request("thread.create", {});
    expect(firstExt.current?.startDrive(created.threadId, "ui-restart").ok).toBe(true);
    await one.collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
    const sent = await startInputWhenIdle(one.connection, {
      threadId: created.threadId,
      input: "taken but unfinished",
    });
    expect(sent).toEqual({ delivered: true });
    await firstScript.userSeen.promise;
    const [first] = userCalls(firstScript);
    // 단계가 끝나지 않아 settled는 없다
    expect(userInputsOf(one.collector.events).map((entry) => entry.status)).toEqual(["held"]);
    await one.connection.close();
    await one.host.close();

    const second = newScript("run");
    const secondExt: { current: ExtHost | undefined } = { current: undefined };
    const two = await startHost(second, secondExt);
    await two.connection.request("thread.open", { threadId: created.threadId, mode: "write" });
    await two.collector.waitFor(
      (event) => userInputsOf([event]).some((entry) => entry.status === "settled"),
      30_000,
    );
    const firstId = first?.requestId;
    if (firstId === undefined) throw new Error("the first delivery has no request id");
    expect(userCalls(second)).toEqual([
      {
        kind: "user",
        message: { kind: "user", content: "taken but unfinished" },
        requestId: firstId,
      },
    ]);
    expect(two.collector.events.filter((event) => event.kind === "turn.started")).toHaveLength(1);
    await two.connection.close();
    await two.host.close();
    home.dispose();
  },
  90_000,
);

realTest(
  "a secret inside a claimed user message stays raw in the payload and the wire event carries leaf marks for it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, BASE_SETTINGS);
    // "ghp_" 뒤 36자는 호스트의 깃허브 토큰 패턴에 걸린다. 실제 값이 아니다
    const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    const script = newScript("hold-user");
    const ext: { current: ExtHost | undefined } = { current: undefined };
    const run = await startHost(script, ext);
    const created = await run.connection.request("thread.create", {});
    expect(ext.current?.startDrive(created.threadId, "ui-restart").ok).toBe(true);
    await run.collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
    await startInputWhenIdle(run.connection, {
      threadId: created.threadId,
      input: `use ${TOKEN} now`,
    });
    const held = await run.collector.waitFor((event) => event.kind === "lease.user_input", 30_000);
    expect(held.payload).toMatchObject({ input: { content: `use ${TOKEN} now` } });
    expect(held.mask?.map((leaf) => leaf.pointer)).toEqual(["/input/content"]);
    expect(JSON.stringify(held.mask)).not.toContain(TOKEN);
    await run.connection.close();
    await run.host.close();
    home.dispose();
  },
  90_000,
);
