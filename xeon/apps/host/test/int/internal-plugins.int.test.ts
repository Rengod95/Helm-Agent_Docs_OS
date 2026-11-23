import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  BUILTIN_PLUGIN_NAMES,
  INTERNAL_PLUGIN_NAMES,
  internalPluginLayer,
} from "@fresnel/contracts/extensions";
import { TOOL_PLUGIN_NAMES, toolPluginRowsOn } from "../../src/assembly/tool-plugins.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AGE-33 (int, 실제 엔진): 엔진이 스스로 싣는 플러그인 가운데 `internal`이 참인 카드는 계약의 내부 부품 목록과 같다.
// 내장이어도 켜고 끌 수 있는 그룹(`authoring`, `guide`)은 내부 부품이 아니다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 이 컴퓨터의 OS에서 싣지 않는 도구 종류 플러그인인가 */
const THIS_OS = process.platform === "darwin" ? "darwin" : "linux";
const LOADED_TOOLS = new Set(toolPluginRowsOn(THIS_OS).map((row) => row.name));
function isOtherOsTool(name: string): boolean {
  return TOOL_PLUGIN_NAMES.includes(name) && !LOADED_TOOLS.has(name);
}
const expectedInternal = INTERNAL_PLUGIN_NAMES.filter((name) => !isOtherOsTool(name)).toSorted();

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
      ).toEqual(expectedInternal);
      // 층 값은 이름 표에서 끌어낸다(코어 7과 앱 핵심 도구, 기능 8과 기본 제공 도구, 브릿지 6)
      const layers = builtin
        .filter((card) => card.internal === true)
        .map((card) => `${card.internalLayer ?? "none"}:${card.name}`)
        .toSorted();
      const toolLayers = toolPluginRowsOn(process.platform === "darwin" ? "darwin" : "linux").map(
        (row) => internalPluginLayer(row.name),
      );
      expect(layers.filter((line) => line.startsWith("core:"))).toHaveLength(
        7 + toolLayers.filter((layer) => layer === "core").length,
      );
      expect(layers.filter((line) => line.startsWith("capability:"))).toHaveLength(
        8 + toolLayers.filter((layer) => layer === "capability").length,
      );
      expect(layers.filter((line) => line.startsWith("bridge:"))).toHaveLength(6);
      expect(layers.filter((line) => line.startsWith("none:"))).toEqual([]);
      expect(INTERNAL_PLUGIN_NAMES).toHaveLength(29);
      expect(
        builtin
          .filter((card) => card.internal === false)
          .map((card) => card.name)
          .toSorted(),
      ).toEqual(["authoring", "guide"]);
      expect(plugins.filter((card) => card.origin.kind !== "builtin")).toEqual([]);
      // AGE-31: 내장 카드는 모두 목적과 설명을 싣는다. 빈 칸이면 승인할 수 없으므로 그 이름이 여기서 실패한다
      expect(builtin.map((card) => card.name).toSorted()).toEqual(
        [...BUILTIN_PLUGIN_NAMES].filter((name) => !isOtherOsTool(name)).toSorted(),
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

realTest(
  "tool-type plugin cards carry the same check result as the first-run binary report, and cap-workspace depends on rg (hard) and git (soft)",
  async () => {
    const home = useEngineHome();
    const bundles = mkdtempSync(join(tmpdir(), "tool-plugins-bundles-"));
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      defaultPluginsDir: bundles,
      extraPlugins: [],
    });
    try {
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      // 첫 실행 화면이 쓰는 점검. 같은 점검이 카드의 상태를 채운다
      const status = await connection.request("host.status", { includeBinaries: true });
      const binaries = status.binaries?.items ?? [];
      const { plugins } = await connection.request("plugin.list", {});
      const tools = plugins.filter((card) => card.externalTool !== undefined);
      expect(tools.map((card) => card.name).toSorted()).toEqual([...LOADED_TOOLS].toSorted());
      for (const card of tools) {
        const declared = card.externalTool;
        const item = binaries.find((row) => row.name === declared?.binary);
        expect(item).toBeDefined();
        const kind = card.externalTool?.status?.kind;
        const expectedKind =
          item?.status.kind === "ok"
            ? item.status.source === "bundled"
              ? "bundled"
              : "ready"
            : item?.status.kind;
        expect(kind).toBe(expectedKind);
      }
      const workspace = plugins.find((card) => card.name === "cap-workspace");
      expect(workspace?.dependencies?.dependsOn.map((line) => [line.target, line.kind])).toEqual([
        ["tool-rg", "hard"],
        ["tool-git", "soft"],
      ]);
      // 앱 핵심 도구는 끌 수 없다. 기본 제공 도구는 이 거절 대상이 아니다
      const refused = await connection
        .request("settings.set", { key: "ext.tool-rg.enabled", value: false, scope: "user" })
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(refused).toMatchObject({ data: { kind: "plugin.requiredByCore" } });
      const rg = plugins.find((card) => card.name === "tool-rg");
      expect(rg?.dependencies?.dependents.map((line) => line.from)).toEqual(["cap-workspace"]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
