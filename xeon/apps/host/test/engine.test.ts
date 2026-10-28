import { afterAll, describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { SecretNameSchema } from "@xeon/contracts/capabilities";
import { defineManifest } from "@xeon/contracts/extensions";
import { defineSettings } from "@xeon/contracts/settings";
import { WireError } from "@xeon/contracts/wire";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { AssembleError, assemble } from "../src/assemble.ts";
import { createHostConnection } from "../src/client.ts";
import { startInProcessHost, startStdioHost } from "../src/main.ts";
import { useEngineHome } from "./fixtures/engine-home.ts";
import { realEngineGate } from "./fixtures/real-engine.ts";
import { stdioStreams } from "./fixtures/stdio-pair.ts";
import { testGroup } from "./fixtures/test-group.ts";
import { writeUserSettings } from "./fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "./fixtures/wire-client.ts";
import { createStdioTransport } from "../src/transport/stdio.ts";

// 모든 하위 패키지를 실제로 올린 엔진 위의 시험. 엔진이 서지 못하는 동안은 건너뛴다(fixtures/real-engine.ts).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

describe("real engine", () => {
  realTest("assemble opens the store, serves the services and closes cleanly", async () => {
    const engine = await assemble({ mode: "in-process", devChecks: true });
    expect(engine.storeId.startsWith("sto_")).toBe(true);
    expect(engine.catalog.has("l4.host-service.maxReplayEvents")).toBe(true);
    const head = engine.ports.feed.headSeq();
    expect(head.ok && head.value).toBeGreaterThanOrEqual(0);
    await engine.close();
    // 두 번 닫아도 된다
    await engine.close();
  });

  realTest(
    "a thread is created through the host, its events replay from zero and survive a restart",
    async () => {
      const first = await startInProcessHost({ devChecks: true });
      const connection = createHostConnection(first.client);
      const hello = await connection.request("host.hello", HELLO_PARAMS);
      const created = await connection.request("thread.create", { title: "persisted" });
      expect(created.position.storeId).toBe(hello.storeId);
      expect(created.position.seq).toBeGreaterThan(0);
      await connection.close();
      await first.close();

      // 같은 DB를 다시 연다: 저장소 정체와 이벤트가 이어진다
      const second = await startInProcessHost({ devChecks: true });
      const again = createHostConnection(second.client);
      const hello2 = await again.request("host.hello", HELLO_PARAMS);
      expect(hello2.storeId).toBe(hello.storeId);
      const collector = collectEvents(again);
      const subscribed = await again.request("events.subscribe", {
        from: { storeId: hello2.storeId, seq: 0 },
      });
      expect(subscribed.mode).toBe("replaying");
      const started = await collector.waitFor(
        (event) => event.kind === "thread.started" && event.threadId === created.threadId,
      );
      expect(started.seq).toBe(1);
      expect(subscribed.headSeq).toBeGreaterThanOrEqual(created.position.seq);
      await again.close();
      await second.close();
    },
  );

  realTest(
    "turn.start submits the input to the loop and the turn's events are published",
    async () => {
      const host = await startInProcessHost({ devChecks: true });
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const started = await connection.request("turn.start", {
        threadId: created.threadId,
        input: "hello",
        requestId: "first",
      });
      const event = await collector.waitFor((candidate) => candidate.kind === "turn.started");
      expect(event.turnId).toBe(started.turnId);
      expect(collector.events.map((candidate) => candidate.kind)).toContain("input.queued");
      // 같은 requestId의 재제출은 처음 turnId를 돌려준다
      const again = await connection.request("turn.start", {
        threadId: created.threadId,
        input: "hello",
        requestId: "first",
      });
      expect(again.turnId).toBe(started.turnId);
      await connection.close();
      await host.close();
    },
  );

  realTest("settings.get reads the user settings file and the limits follow it", async () => {
    writeUserSettings(home, { "l4.host-service.maxSubscriptionsPerConnection": 2 });
    const host = await startInProcessHost({ devChecks: true });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const result = await connection.request("settings.get", {
      keys: ["l4.host-service.maxSubscriptionsPerConnection"],
    });
    expect(result.settings[0]).toMatchObject({ value: 2, source: { scope: "user" } });
    await connection.request("events.subscribe", { from: "head" });
    await connection.request("events.subscribe", { from: "head" });
    const refused = await connection.request("events.subscribe", { from: "head" }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(refused).toBeInstanceOf(WireError);
    if (refused instanceof WireError) {
      expect(refused.code).toBe(2003);
      expect(refused.data.details).toEqual({ max: 2 });
    }
    await connection.close();
    await host.close();
    writeUserSettings(home, {});
  });

  realTest(
    "secret.* run on the real secret admin: an empty list, and a reveal offer through secretOutOfBand is consumed once",
    async () => {
      const host = await startInProcessHost({ devChecks: true });
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      expect(await connection.request("secret.list", { meta: true })).toEqual({ secrets: [] });
      const name = parse(SecretNameSchema, "exa-key");
      if (!name.ok) throw new Error("test name must be valid");
      // 맡긴 수단이 없으면 시작하지 않는다
      expect(await connection.request("secret.beginReveal", { name: name.value })).toEqual({
        started: false,
      });
      // 통로는 처리기가 읽는 저장소와 같다: 맡긴 수단은 꺼내져 쓰이고(없는 비밀이라 오류), 다시 꺼낼 수 없다
      host.secretOutOfBand.offerReveal({
        name: name.value,
        reauth: { method: "tty-confirm", verifiedAt: Date.now() },
        show: () => Promise.resolve(),
      });
      const failed = await connection.request("secret.beginReveal", { name: name.value }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(failed).toBeInstanceOf(WireError);
      if (failed instanceof WireError) {
        expect(failed.data.kind).toBe("secret.notFound");
        expect(failed.data.details).toEqual({ where: "meta" });
      }
      expect(await connection.request("secret.beginReveal", { name: name.value })).toEqual({
        started: false,
      });
      await connection.close();
      await host.close();
    },
  );

  realTest(
    "the stdio host answers on the stream pair and exits 0 with eof when the input ends",
    async () => {
      const streams = stdioStreams();
      const exit = startStdioHost({
        readable: streams.clientToServer.readable,
        writable: streams.serverToClient.writable,
        assemble: { devChecks: true },
        handleSignals: false,
      });
      const client = createStdioTransport({
        readable: streams.serverToClient.readable,
        writable: streams.clientToServer.writable,
      });
      const connection = createHostConnection(client);
      const hello = await connection.request("host.hello", HELLO_PARAMS);
      expect(hello.transport).toBe("stdio");
      await connection.close();
      expect(await exit).toEqual({ code: 0, reason: "eof" });
    },
  );

  realTest(
    "the stdio host refuses to start on a broken catalog: exit 1 with the reason",
    async () => {
      const streams = stdioStreams();
      const duplicate = defineSettings("l4.host-service", {
        maxReplayEvents: {
          type: Type.Integer(),
          default: 5000,
          runtimeChange: "live",
          allowedScopes: ["user"],
          since: "0.1.0",
        },
      });
      const exit = await startStdioHost({
        readable: streams.clientToServer.readable,
        writable: streams.serverToClient.writable,
        assemble: { settingGroups: [duplicate] },
        handleSignals: false,
      });
      expect(exit.code).toBe(1);
      expect(exit.reason).toBe("startup");
      expect(exit.message).toContain("duplicateKey");
    },
  );

  realTest(
    "extraPlugins installs the test group, which then takes part in the engine",
    async () => {
      const group = testGroup(fixedIdFactory(9));
      const engine = await assemble({ mode: "in-process", extraPlugins: [group.module] });
      expect(engine.storeId.startsWith("sto_")).toBe(true);
      await engine.close();
    },
  );

  realTest("assemble reports a plugin that fails to install as AssembleError plugin", async () => {
    const manifest = defineManifest({
      schemaVersion: 1,
      name: "broken-plugin",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./src/index.ts",
      points: [],
      usesDrive: false,
      trust: { level: "builtin" },
    });
    const caught = await assemble({
      mode: "in-process",
      extraPlugins: [
        {
          manifest,
          extension: () => {
            throw new Error("entry refused to start");
          },
        },
      ],
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(AssembleError);
    if (caught instanceof AssembleError) {
      expect(caught.issues[0]).toMatchObject({ code: "plugin", plugin: "broken-plugin" });
      expect(caught.message).toContain("entry refused to start");
    }
  });
});
