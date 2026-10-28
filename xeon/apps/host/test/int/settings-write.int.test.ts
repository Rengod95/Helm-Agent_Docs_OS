import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { WireError, type HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.2 (int): settings.set, settings.reset의 실제 파일·세션 범위 쓰기와 프로젝트 신뢰. 실제 엔진과 임시 홈 위의 시험이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const KEY = "l1.loop.maxSteps";

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

interface Fixture {
  readonly home: EngineHome;
  readonly workspace: string;
  readonly connection: HostConnection;
  readonly userFile: string;
  close(): Promise<void>;
}

async function start(userSettings: Readonly<Record<string, unknown>> = {}): Promise<Fixture> {
  const home = useEngineHome();
  writeUserSettings(home, userSettings);
  const workspace = mkdtempSync(join(tmpdir(), "xh-ws-"));
  const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return {
    home,
    workspace,
    connection,
    userFile: join(home.root, "config", "settings.json"),
    async close() {
      await connection.close();
      await host.close();
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    },
  };
}

function fileValues(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}

describe("user scope", () => {
  realTest(
    "writes the user file, keeps keys it does not know, and settings.get follows",
    async () => {
      const fx = await start({ "ext.future.setting": { keep: true }, [KEY]: 3 });
      const set = await fx.connection.request("settings.set", {
        key: KEY,
        value: 7,
        scope: "user",
      });
      expect(set.setting).toMatchObject({ key: KEY, value: 7, source: { scope: "user" } });
      expect(fileValues(fx.userFile)).toEqual({ "ext.future.setting": { keep: true }, [KEY]: 7 });
      expect(statSync(fx.userFile).mode & 0o777).toBe(0o600);
      const got = await fx.connection.request("settings.get", { keys: [KEY] });
      expect(got.settings[0]).toMatchObject({ value: 7 });
      await fx.close();
    },
  );

  realTest("creates the file when there is none, and reset removes only that key", async () => {
    const fx = await start();
    rmSync(fx.userFile);
    await fx.connection.request("settings.set", { key: KEY, value: 9, scope: "user" });
    await fx.connection.request("settings.set", {
      key: "l4.host-service.maxReplayEvents",
      value: 5000,
      scope: "user",
    });
    const reset = await fx.connection.request("settings.reset", { key: KEY, scope: "user" });
    expect(reset.setting).toMatchObject({ key: KEY, source: { scope: "default" } });
    expect(fileValues(fx.userFile)).toEqual({ "l4.host-service.maxReplayEvents": 5000 });
    await fx.close();
  });

  realTest(
    "a user file that is not a JSON object is left alone and reported as a store error",
    async () => {
      const fx = await start();
      writeFileSync(fx.userFile, "[1, 2]");
      const error = await wireErrorOf(
        fx.connection.request("settings.set", { key: KEY, value: 7, scope: "user" }),
      );
      expect(error.code).toBe(5006);
      expect(error.data.details).toEqual({ code: "settings_file_invalid" });
      expect(readFileSync(fx.userFile, "utf8")).toBe("[1, 2]");
      await fx.close();
    },
  );

  realTest("two writes at once both land in the file", async () => {
    const fx = await start();
    await Promise.all([
      fx.connection.request("settings.set", { key: KEY, value: 4, scope: "user" }),
      fx.connection.request("settings.set", {
        key: "l4.host-service.maxReplayEvents",
        value: 6000,
        scope: "user",
      }),
    ]);
    expect(fileValues(fx.userFile)).toEqual({
      [KEY]: 4,
      "l4.host-service.maxReplayEvents": 6000,
    });
    await fx.close();
  });

  realTest("managed is read-only, and a scope the key does not allow is refused", async () => {
    const fx = await start();
    const managed = await wireErrorOf(
      fx.connection.request("settings.set", { key: KEY, value: 7, scope: "managed" }),
    );
    expect(managed.code).toBe(3103);
    expect(managed.data.details).toMatchObject({ reason: "managedReadOnly" });
    const project = await wireErrorOf(
      fx.connection.request("settings.set", {
        key: "l4.host-service.maxReplayEvents",
        value: 5000,
        scope: "project",
      }),
    );
    expect(project.code).toBe(3103);
    await fx.close();
  });
});

describe("session scope", () => {
  realTest(
    "is a settings.changed commit on a thread this host owns and shows in settings.get",
    async () => {
      const fx = await start();
      const created = await fx.connection.request("thread.create", {});
      const set = await fx.connection.request("settings.set", {
        key: KEY,
        value: 11,
        scope: "session",
        threadId: created.threadId,
      });
      expect(set.setting).toMatchObject({ value: 11, source: { scope: "session" } });
      const got = await fx.connection.request("settings.get", {
        keys: [KEY],
        threadId: created.threadId,
      });
      expect(got.settings[0]).toMatchObject({ value: 11 });
      // 다른 thread에는 보이지 않는다
      const other = await fx.connection.request("thread.create", {});
      const otherGot = await fx.connection.request("settings.get", {
        keys: [KEY],
        threadId: other.threadId,
      });
      expect(otherGot.settings[0]).toMatchObject({ source: { scope: "default" } });
      const reset = await fx.connection.request("settings.reset", {
        key: KEY,
        scope: "session",
        threadId: created.threadId,
      });
      expect(reset.setting).toMatchObject({ source: { scope: "default" } });
      await fx.close();
    },
  );

  realTest("needs a thread id and the write ownership", async () => {
    const fx = await start();
    const missing = await wireErrorOf(
      fx.connection.request("settings.set", { key: KEY, value: 11, scope: "session" }),
    );
    expect(missing.code).toBe(-32602);
    const created = await fx.connection.request("thread.create", {});
    await fx.connection.request("thread.close", { threadId: created.threadId });
    // 같은 호스트가 쥔 thread라 close 뒤에도 쓸 수 있다(서비스 모드가 아니면 잠금은 프로세스 끝까지 남는다)
    const still = await fx.connection.request("settings.set", {
      key: KEY,
      value: 12,
      scope: "session",
      threadId: created.threadId,
    });
    expect(still.setting).toMatchObject({ value: 12 });
    await fx.close();
  });
});

describe("project and local scope", () => {
  realTest("an untrusted project is refused (default policy ask, no prompter)", async () => {
    const fx = await start();
    const created = await fx.connection.request("thread.create", { workspace: fx.workspace });
    const error = await wireErrorOf(
      fx.connection.request("settings.set", {
        key: KEY,
        value: 5,
        scope: "project",
        threadId: created.threadId,
      }),
    );
    expect(error.code).toBe(3103);
    expect(error.data.details).toMatchObject({ reason: "untrustedProject" });
    await fx.close();
  });

  realTest("a thread without a workspace cannot take project settings", async () => {
    const fx = await start({ "x.loading-trust.defaultProjectTrust": "always" });
    const created = await fx.connection.request("thread.create", {});
    const error = await wireErrorOf(
      fx.connection.request("settings.set", {
        key: KEY,
        value: 5,
        scope: "project",
        threadId: created.threadId,
      }),
    );
    expect(error.data.details).toMatchObject({ reason: "workspaceRequired" });
    await fx.close();
  });

  realTest(
    "a trusted workspace gets .xeon/settings.json and settings.local.json, and local wins",
    async () => {
      const fx = await start({ "x.loading-trust.defaultProjectTrust": "always" });
      const created = await fx.connection.request("thread.create", { workspace: fx.workspace });
      const project = await fx.connection.request("settings.set", {
        key: KEY,
        value: 5,
        scope: "project",
        threadId: created.threadId,
      });
      expect(project.setting).toMatchObject({
        value: 5,
        source: { scope: "project", path: join(fx.workspace, ".xeon", "settings.json") },
      });
      const local = await fx.connection.request("settings.set", {
        key: KEY,
        value: 6,
        scope: "local",
        threadId: created.threadId,
      });
      expect(local.setting).toMatchObject({
        value: 6,
        source: { scope: "local" },
        shadowed: [{ scope: "project" }],
      });
      expect(fileValues(join(fx.workspace, ".xeon", "settings.json"))).toEqual({ [KEY]: 5 });
      expect(fileValues(join(fx.workspace, ".xeon", "settings.local.json"))).toEqual({ [KEY]: 6 });
      // 다른 작업 폴더의 thread에는 적용되지 않는다
      const elsewhere = await fx.connection.request("thread.create", {});
      const got = await fx.connection.request("settings.get", {
        keys: [KEY],
        threadId: elsewhere.threadId,
      });
      expect(got.settings[0]).toMatchObject({ source: { scope: "default" } });
      await fx.close();
    },
  );

  realTest(
    "project files written by hand apply when the workspace is trusted and are ignored when it is not",
    async () => {
      const trusted = await start({ "x.loading-trust.defaultProjectTrust": "always" });
      mkdirSync(join(trusted.workspace, ".xeon"));
      writeFileSync(
        join(trusted.workspace, ".xeon", "settings.json"),
        JSON.stringify({ [KEY]: 8 }),
      );
      const created = await trusted.connection.request("thread.create", {
        workspace: trusted.workspace,
      });
      const got = await trusted.connection.request("settings.get", {
        keys: [KEY],
        threadId: created.threadId,
      });
      expect(got.settings[0]).toMatchObject({ value: 8, source: { scope: "project" } });
      await trusted.close();

      const untrusted = await start();
      mkdirSync(join(untrusted.workspace, ".xeon"));
      writeFileSync(
        join(untrusted.workspace, ".xeon", "settings.json"),
        JSON.stringify({ [KEY]: 8 }),
      );
      const second = await untrusted.connection.request("thread.create", {
        workspace: untrusted.workspace,
      });
      const ignored = await untrusted.connection.request("settings.get", {
        keys: [KEY],
        threadId: second.threadId,
      });
      expect(ignored.settings[0]).toMatchObject({ source: { scope: "default" } });
      await untrusted.close();
    },
  );
});
