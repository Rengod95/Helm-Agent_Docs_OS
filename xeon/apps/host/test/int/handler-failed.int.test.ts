import { expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import type { StreamChunkParams } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-35(HS-92) (int): 확장 핸들러가 던지면 그 thread를 연 연결이 `scope.handler_failed` 휘발 이벤트를 `stream.chunk`로 받는다.
// 실패는 thread의 이름 바꾸기가 낸 `session.info.after` 지점에서 난다. 이 지점은 분리(detached)라 실패가 호출 뒤에 알려진다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const EXTENSION = "handler-failer";

const extension: ExtensionEntry = ({ manifest: loaded, scope }) => {
  scope(loaded.name, {}, (g) => {
    g.on("session.info.after", () => {
      throw new Error("probe failed on purpose");
    });
  });
};

function failingExtension(): HostPluginModule {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: EXTENSION,
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: ["session.info.after"],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  return { manifest, extension };
}

realTest(
  "a throwing extension handler sends scope.handler_failed as stream.chunk to the connection that opened the thread",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [failingExtension()],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const arrived = Promise.withResolvers<StreamChunkParams>();
    connection.onNotification("stream.chunk", (params) => {
      arrived.resolve(params);
    });
    const created = await connection.request("thread.create", {});
    await connection.request("thread.rename", { threadId: created.threadId, title: "새 제목" });

    const { event } = await arrived.promise;
    expect(event).toMatchObject({
      kind: "scope.handler_failed",
      version: 1,
      threadId: created.threadId,
      turnId: null,
      stepId: null,
      durable: false,
      n: 0,
    });
    expect(event.payload).toEqual({
      owner: `ext:${EXTENSION}`,
      point: "session.info.after",
      result: "threw",
      message: "probe failed on purpose",
      consecutive: 1,
    });
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
