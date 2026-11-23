import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { BUILTIN_PLUGIN_NAMES, INTERNAL_PLUGIN_NAMES } from "@fresnel/contracts/extensions";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AGE-33 (int, 실제 엔진): 엔진이 스스로 싣는 플러그인 가운데 `internal`이 참인 카드는 계약의 내부 부품 목록과 같다.
// 내장이어도 켜고 끌 수 있는 그룹(`authoring`, `guide`)은 내부 부품이 아니다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "plugin.list marks exactly the contract's internal parts as internal and leaves toggleable builtin groups out",
  async () => {
    const home = useEngineHome();
    const bundles = mkdtempSync(join(tmpdir(), "internal-plugins-bundles-"));
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      defaultPluginsDir: bundles,
      extraPlugins: [],
    });
    try {
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const { plugins } = await connection.request("plugin.list", {});
      const builtin = plugins.filter((card) => card.origin.kind === "builtin");
      expect(
        builtin
          .filter((card) => card.internal === true)
          .map((card) => card.name)
          .toSorted(),
      ).toEqual([...INTERNAL_PLUGIN_NAMES].toSorted());
      // 층 값은 이름 표에서 끌어낸다(코어 7, 기능 8, 브릿지 6)
      const layers = builtin
        .filter((card) => card.internal === true)
        .map((card) => `${card.internalLayer ?? "none"}:${card.name}`)
        .toSorted();
      expect(layers.filter((line) => line.startsWith("core:"))).toHaveLength(7);
      expect(layers.filter((line) => line.startsWith("capability:"))).toHaveLength(8);
      expect(layers.filter((line) => line.startsWith("bridge:"))).toHaveLength(6);
      expect(layers.filter((line) => line.startsWith("none:"))).toEqual([]);
      expect(INTERNAL_PLUGIN_NAMES).toHaveLength(21);
      expect(
        builtin
          .filter((card) => card.internal === false)
          .map((card) => card.name)
          .toSorted(),
      ).toEqual(["authoring", "guide"]);
      expect(plugins.filter((card) => card.origin.kind !== "builtin")).toEqual([]);
      // AGE-31: 내장 카드는 모두 목적과 설명을 싣는다. 빈 칸이면 승인할 수 없으므로 그 이름이 여기서 실패한다
      expect(builtin.map((card) => card.name).toSorted()).toEqual(
        [...BUILTIN_PLUGIN_NAMES].toSorted(),
      );
      expect(
        builtin
          .filter(
            (card) => (card.purpose ?? "").trim() === "" || (card.description ?? "").trim() === "",
          )
          .map((card) => card.name),
      ).toEqual([]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
