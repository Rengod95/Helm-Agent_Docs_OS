import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { WireError } from "@fresnel/contracts/wire";
import { rejectionOf } from "../fixtures/rejection.ts";

// W-29 실제 엔진 시험. 설치는 검토 흐름으로 옮겨졌고(M5c §7.7) 이 시험은 설치 없이 할 수 있는 것만 본다:
// 개발 모드가 꺼졌을 때 replay가 와이어에서 거절되고 기록되지 않는 것. 설치한 확장을 쓰는 시험은 검토 흐름이 들어온 뒤 다시 쓴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "demo-plugin";

async function startReal(home: EngineHome, settings: Readonly<Record<string, unknown>>) {
  writeUserSettings(home, settings);
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "ext-test-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("ext-test", "done."),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

realTest(
  "with dev mode off a replay is refused at the wire, and nothing is recorded",
  async () => {
    const home = useEngineHome();
    const session = await startReal(home, TAPE_SETTINGS);
    try {
      const refused = await wireErrorOf(
        session.connection.request("ext.test.run", { kind: "replay", target: NAME }),
      );
      expect(refused.data).toMatchObject({
        kind: "jsonrpc.invalidParams",
        details: {
          issues: [
            { path: "/target", message: "dev_mode_required: replay runs only in development mode" },
          ],
        },
      });
      expect(await session.connection.request("ext.test.list", {})).toEqual({ tests: [] });
    } finally {
      await session.connection.close();
      await session.host.close();
      home.dispose();
    }
  },
  120_000,
);
