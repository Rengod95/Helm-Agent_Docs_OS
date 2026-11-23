import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerNotificationParams } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { hostLimitsOf } from "../../src/assembly/settings-sources.ts";
import { settingReaderOf, startHost, stopHost } from "../../src/host-runtime.ts";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4, §4.7: 사용자 폴더에 플러그인을 만들고 `plugin.scan`을 부르면 `pluginReview.changed`(대기)가 오고,
// 승인하면 `pluginReview.changed`(승인)와 `plugin.changed`가 온다. 실제 엔진이 필요해 게이트가 막히면 건너뛴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 알림 하나를 기다린다. 등록은 호출한 순간에 한다 */
function nextNotification<M extends "pluginReview.changed" | "plugin.changed">(
  connection: ReturnType<typeof createHostConnection>,
  method: M,
): Promise<ServerNotificationParams<M>> {
  return new Promise((resolve) => {
    connection.onNotification(method, (params) => {
      resolve(params);
    });
  });
}

realTest(
  "plugin.scan announces a pending review item, and approving it announces the approval and plugin.changed",
  async () => {
    const home = useEngineHome();
    const running = await startHost({ mode: "in-process", devChecks: true, defaultGroups: false });
    try {
      const pair = createInProcessTransportFactory({ devChecks: true })();
      running.hub.serve(pair.server, {
        limits: hostLimitsOf(settingReaderOf(running.engine)),
        devChecks: true,
      });
      const connection = createHostConnection(pair.client);
      await connection.request("host.hello", HELLO_PARAMS);

      const pending = nextNotification(connection, "pluginReview.changed");
      const folder = join(home.root, "config", "plugins", "int-kit", ".fresnel-plugin");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "plugin.json"),
        JSON.stringify({
          schemaVersion: 2,
          name: "int-kit",
          version: "1.0.0",
          purpose: "Integration",
          description: "Integration (test fixture).",
        }),
      );
      const scanned = await connection.request("plugin.scan", {});
      expect(scanned.queued.length).toBe(1);
      const [queuedId] = scanned.queued;
      if (queuedId === undefined) throw new Error("expected one queued item");
      const announced = await pending;
      expect(announced.itemId).toBe(queuedId);
      expect(announced.state).toBe("pending");

      const approved = nextNotification(connection, "pluginReview.changed");
      const reloaded = nextNotification(connection, "plugin.changed");
      const decided = await connection.request("pluginReview.decide", {
        itemId: announced.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect(decided.item.state).toBe("approved");
      expect(decided.appliedTo).toEqual([]);
      expect(await approved).toEqual({ itemId: announced.itemId, state: "approved" });
      expect(await reloaded).toEqual({ name: "int-kit" });
    } finally {
      await stopHost(running);
      home.dispose();
    }
  },
);
