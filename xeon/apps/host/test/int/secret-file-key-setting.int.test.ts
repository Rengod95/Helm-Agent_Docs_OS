import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { memorySecrets } from "@fresnel/platform-secrets/testing";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";

// 첫 키를 파일로 만든 직후 조립 루트가 사용자 범위 설정 `l0.secrets.ageKey.source`를 file로 저장한다(L0.secrets.spec §4.7 9번).
// 시크릿 서비스만 메모리 대역이다(sops와 키체인은 쓰지 않는다). 설정 파일은 임시 FRESNEL_HOME 안에 있다.

test("the callback that follows a first file key saves the age key source as file in the user settings", async () => {
  const home = useEngineHome();
  const captured: { onFileKeyCreated: (() => Promise<void>) | undefined } = {
    onFileKeyCreated: undefined,
  };
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    secretsRuntime: (deps) => {
      captured.onFileKeyCreated = deps.onFileKeyCreated;
      const secrets = memorySecrets({
        clock: deps.os.time.clock,
        scheduler: deps.os.time.scheduler,
        ids: deps.ids,
        secrets: [],
      });
      return { service: secrets, admin: secrets.admin };
    },
  });
  try {
    const callback = captured.onFileKeyCreated;
    if (callback === undefined) throw new Error("the host did not hand the callback over");
    await callback();
    const saved: unknown = JSON.parse(
      readFileSync(join(home.root, "config", "settings.json"), "utf8"),
    );
    expect(saved).toMatchObject({ "l0.secrets.ageKey.source": "file" });
  } finally {
    await host.close();
    home.dispose();
  }
});
