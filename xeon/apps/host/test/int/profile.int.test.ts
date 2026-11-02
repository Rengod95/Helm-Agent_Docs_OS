import { mkdirSync, mkdtempSync, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ServerNotificationParams } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { settingReaderOf, startHost, stopHost } from "../../src/host-runtime.ts";
import { hostLimitsOf } from "../../src/assembly/settings-sources.ts";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// Y10(spec-deltas/t-wb.md §5): 프로필이 호스트에 저장되어 한 연결이 저장하면 다른 연결의 profile.list에 보이고 profile.changed가 두 연결에 온다.
// baseRev 충돌, 사용자 층 적용이 실제 설정에 쓰이는 것, 거절된 적용이 아무것도 쓰지 않는 것. 되돌리기(키 하나 실패)는 handlers/profile-test-run.test.ts가 쓰기 실패를 주입해 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const KEY = "l1.loop.maxSteps";

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- 알림이 올 때까지 폴링
    await Bun.sleep(5);
  }
  expect(condition()).toBe(true);
}

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

realTest(
  "a profile one connection saves is listed by the other, with profile.changed on both",
  async () => {
    const home = useEngineHome();
    const running = await startHost({ mode: "in-process", devChecks: true, defaultGroups: false });
    try {
      const attach = () => {
        const pair = createInProcessTransportFactory({ devChecks: true })();
        running.hub.serve(pair.server, {
          limits: hostLimitsOf(settingReaderOf(running.engine)),
          devChecks: true,
        });
        return createHostConnection(pair.client);
      };
      const first = attach();
      const second = attach();
      await first.request("host.hello", HELLO_PARAMS);
      await second.request("host.hello", HELLO_PARAMS);
      const seenFirst: ServerNotificationParams<"profile.changed">[] = [];
      const seenSecond: ServerNotificationParams<"profile.changed">[] = [];
      first.onNotification("profile.changed", (params) => {
        seenFirst.push(params);
      });
      second.onNotification("profile.changed", (params) => {
        seenSecond.push(params);
      });

      const profile = {
        id: "review",
        title: "Review",
        enable: [],
        disable: [],
        settings: [{ key: KEY, value: 5 }],
        driver: null,
      };
      expect(await second.request("profile.list", {})).toEqual({ profiles: [], rev: 0 });
      const created = await first.request("profile.put", { profile, baseRev: null });
      expect(created.profile.rev).toBe(1);
      await until(() => seenFirst.length === 1 && seenSecond.length === 1);
      expect(seenFirst).toEqual([{ rev: 1, ids: ["review"] }]);
      expect(seenSecond).toEqual([{ rev: 1, ids: ["review"] }]);
      const listed = await second.request("profile.list", {});
      expect(listed.profiles.map((item) => [item.id, item.rev, item.settings])).toEqual([
        ["review", 1, [{ key: KEY, value: 5 }]],
      ]);

      // 두 연결이 같은 개정에서 고치면 나중 쪽이 충돌한다
      await first.request("profile.put", {
        profile: { ...profile, title: "Review A" },
        baseRev: 1,
      });
      expect(
        await failureOf(
          second.request("profile.put", { profile: { ...profile, title: "Review B" }, baseRev: 1 }),
        ),
      ).toMatchObject({
        data: { kind: "profile.conflict", details: { id: "review", rev: 2, baseRev: 1 } },
      });
      expect((await second.request("profile.get", { id: "review" })).profile.title).toBe(
        "Review A",
      );

      await second.request("profile.delete", { id: "review" });
      await until(() => seenFirst.length === 3 && seenSecond.length === 3);
      expect(seenFirst.map((change) => change.ids)).toEqual([["review"], ["review"], ["review"]]);
      expect((await first.request("profile.list", {})).profiles).toEqual([]);
    } finally {
      await stopHost(running);
      home.dispose();
    }
  },
);

realTest(
  "apply writes the user layer of the real settings, and a refused or untrusted apply writes nothing",
  async () => {
    const home = useEngineHome();
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-prof-ws-")));
    mkdirSync(join(workspace, ".fresnel"));
    const running = await startHost({ mode: "in-process", devChecks: true, defaultGroups: false });
    try {
      const pair = createInProcessTransportFactory({ devChecks: true })();
      running.hub.serve(pair.server, {
        limits: hostLimitsOf(settingReaderOf(running.engine)),
        devChecks: true,
      });
      const connection = createHostConnection(pair.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const invalidated: ServerNotificationParams<"settings.invalidated">[] = [];
      connection.onNotification("settings.invalidated", (params) => {
        invalidated.push(params);
      });
      const base = { enable: [], disable: [], driver: null } as const;
      await connection.request("profile.put", {
        profile: { ...base, id: "ok", title: "Ok", settings: [{ key: KEY, value: 5 }] },
        baseRev: null,
      });
      await connection.request("profile.put", {
        profile: {
          ...base,
          id: "bad",
          title: "Bad",
          settings: [
            { key: KEY, value: 9 },
            { key: "l1.nope.missing", value: 1 },
          ],
        },
        baseRev: null,
      });
      const read = async (): Promise<unknown> =>
        (await connection.request("settings.get", { keys: [KEY] })).settings[0]?.value;
      expect(await read()).toBe(0);

      expect(await connection.request("profile.apply", { id: "ok" })).toEqual({
        written: [KEY],
        layer: "user",
        appliesAt: "now",
      });
      expect(await read()).toBe(5);
      await until(() => invalidated.length >= 1);
      expect(invalidated[0]).toEqual({ keys: [KEY], scopes: ["user"], threadId: null });

      expect(await failureOf(connection.request("profile.apply", { id: "bad" }))).toMatchObject({
        data: { kind: "settings.unknownKey", details: { key: "l1.nope.missing" } },
      });
      expect(await read()).toBe(5);

      // 신뢰하지 않은 작업 폴더의 project 층은 쓰지 않는다
      const created = await connection.request("thread.create", { workspace });
      expect(
        await failureOf(
          connection.request("profile.apply", {
            id: "ok",
            layer: "project",
            threadId: created.threadId,
          }),
        ),
      ).toMatchObject({ data: { kind: "profile.trustRequired", details: { workspace } } });
      expect(existsSync(join(workspace, ".fresnel", "settings.json"))).toBe(false);
    } finally {
      await stopHost(running);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
);
