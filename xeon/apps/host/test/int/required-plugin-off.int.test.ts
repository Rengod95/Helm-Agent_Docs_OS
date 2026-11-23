import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AGE-74 reqLock: 엔진이 꼭 필요로 하는 플러그인(`requiredByCore`)은 설정 쓰기로도 끌 수 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

for (const name of ["cap-workspace", "cap-dialog"]) {
  realTest(
    `settings.set ext.${name}.enabled=false is plugin.requiredByCore and the plugin stays on`,
    async () => {
      const home = useEngineHome();
      writeUserSettings(home, TAPE_SETTINGS);
      const host = await startInProcessHost({
        pluginHost: { disabled: true },
        devChecks: true,
        defaultPluginsDir: mkdtempSync(join(tmpdir(), "req-lock-bundles-")),
        extraPlugins: [],
        buildModels: answeringModels("req-lock", "done."),
      });
      const connection = createHostConnection(host.client);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        const opened = await connection.request("thread.create", {
          workspace: realpathSync(mkdtempSync(join(tmpdir(), "req-lock-ws-"))),
        });
        const attempt = await connection
          .request("settings.set", { key: `ext.${name}.enabled`, value: false, scope: "user" })
          .then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        const listed = await connection.request("ext.list", { threadId: opened.threadId });
        const entry = listed.extensions.find((item) => item.name === name);
        expect(attempt.ok).toBe(false);
        expect(attempt.ok ? null : attempt.error).toMatchObject({
          code: 3626,
          data: { kind: "plugin.requiredByCore", details: { plugin: name } },
        });
        expect(entry?.status).toBe("enabled");
        expect(entry?.plugins.map((plugin) => plugin.enabledSource)).toEqual(["core"]);
      } finally {
        await connection.close();
        await host.close();
        home.dispose();
      }
    },
    60_000,
  );
}
