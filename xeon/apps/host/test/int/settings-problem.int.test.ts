import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HS-80 (int): 사용자 파일의 기본 모델 id가 실제 카탈로그에 있는지에 따라 settings.get이 problem을 싣는다. 실제 엔진과 임시 홈 위의 시험이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const KEY = "l1.models.default";

interface Fixture {
  readonly home: EngineHome;
  readonly workspace: string;
  readonly connection: HostConnection;
  close(): Promise<void>;
}

async function start(userSettings: Readonly<Record<string, unknown>>): Promise<Fixture> {
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
    async close() {
      await connection.close();
      await host.close();
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    },
  };
}

describe("settings.get shows the problem of a saved default model", () => {
  realTest(
    "a model id the catalog lacks is shown with the unknownModel problem and its saved value",
    async () => {
      const fx = await start({ [KEY]: "anthropic/no-such-model-xyz" });
      const got = await fx.connection.request("settings.get", { keys: [KEY] });
      expect(got.settings[0]).toMatchObject({
        key: KEY,
        value: "anthropic/no-such-model-xyz",
        source: { scope: "user" },
        problem: { kind: "unknownModel", args: { id: "anthropic/no-such-model-xyz" } },
      });
      await fx.close();
    },
  );

  realTest("a catalog model id has no problem field at all", async () => {
    const fx = await start({ [KEY]: "anthropic/claude-sonnet-5-5" });
    const got = await fx.connection.request("settings.get", { keys: [KEY] });
    expect(got.settings[0]).toMatchObject({ key: KEY, value: "anthropic/claude-sonnet-5-5" });
    expect(got.settings[0]).not.toHaveProperty("problem");
    await fx.close();
  });
});
