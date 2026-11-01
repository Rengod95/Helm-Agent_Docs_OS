import { expect, test } from "bun:test";
import { CATEGORIES, renamePath, transform, type Category } from "./rename.ts";

function category(id: string): Category {
  const found = CATEGORIES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no category ${id}`);
  return found;
}

function apply(id: string, text: string, file = "xeon/packages/core-loop/src/a.ts"): string {
  return transform(text, category(id), file).text;
}

test("A renames the package scope and the package.json layer key", () => {
  expect(apply("A", 'import { x } from "@xeon/contracts/records";')).toBe(
    'import { x } from "@fresnel/contracts/records";',
  );
  expect(apply("A", '  "xeon": { "layer": "F" }', "xeon/packages/contracts/package.json")).toBe(
    '  "fresnel": { "layer": "F" }',
  );
  expect(apply("A", "xeon.layer와 xeon.domain")).toBe("fresnel.layer와 fresnel.domain");
});

test("B renames service names only, not file names such as xeon.db", () => {
  expect(apply("B", 'ctx.get("xeon.session"); "xeon.exec"; xeon.db; xeon.sock')).toBe(
    'ctx.get("fresnel.session"); "fresnel.exec"; xeon.db; xeon.sock',
  );
  expect(apply("B", "payload xeon.hook.v1 and xeon.model-tape.v1")).toBe(
    "payload fresnel.hook.v1 and fresnel.model-tape.v1",
  );
});

test("E renames lint rule ids and leaves repository paths", () => {
  expect(apply("E", "// xeon-disable-next-line xeon/switch-default-never -- reason")).toBe(
    "// xeon-disable-next-line fresnel/switch-default-never -- reason",
  );
  expect(apply("E", "see xeon/packages/core-loop and xeon/scripts/check-layers.ts")).toBe(
    "see xeon/packages/core-loop and xeon/scripts/check-layers.ts",
  );
  expect(apply("E", String.raw`/(xeon\/[a-z-]+)/ xeon/iso.dispose xeon/clientTime`)).toBe(
    String.raw`/(xeon\/[a-z-]+)/ fresnel/iso.dispose fresnel/clientTime`,
  );
});

test("F renames the exemption comment", () => {
  expect(apply("F", "// xeon-disable-next-line xeon/no-class -- x")).toBe(
    "// fresnel-disable-next-line xeon/no-class -- x",
  );
});

test("G renames environment variables and the fork marker", () => {
  expect(
    apply("G", "process.env.XEON_HOME ?? XEON_REMOTE_TOKEN // XEON-PATCH: p1 __XEON_CHECKS__"),
  ).toBe(
    "process.env.FRESNEL_HOME ?? FRESNEL_REMOTE_TOKEN // FRESNEL-PATCH: p1 __FRESNEL_CHECKS__",
  );
});

test("H and I rename project and plugin folders", () => {
  expect(apply("H", "`.xeon/settings.json` .xeon/mcp.json .xeon-plugin")).toBe(
    "`.fresnel/settings.json` .fresnel/mcp.json .xeon-plugin",
  );
  expect(apply("I", "`.xeon-plugin/plugin.json`")).toBe("`.fresnel-plugin/plugin.json`");
  expect(
    renamePath("xeon/packages/group-kit/templates/drive/.xeon-plugin/plugin.json", category("I")),
  ).toBe("xeon/packages/group-kit/templates/drive/.fresnel-plugin/plugin.json");
});

test("L renames the Tauri identifier", () => {
  expect(apply("L", '"identifier": "dev.helm.xeon"')).toBe('"identifier": "dev.fresnel.desktop"');
});

test("P renames workflow and skill files", () => {
  expect(renamePath(".github/workflows/xeon-ci.yml", category("P"))).toBe(
    ".github/workflows/fresnel-ci.yml",
  );
  expect(renamePath(".claude/skills/xeon-ts/SKILL.md", category("P"))).toBe(
    ".claude/skills/fresnel-ts/SKILL.md",
  );
  expect(renamePath("xeon/scripts/rename.ts", category("P"))).toBeUndefined();
});

test("W renames words but protects repository paths, the branch and the work folder", () => {
  const text = [
    "Xeon runs `xeon config`; XEON mode; runXeon; xeonRoot",
    "cd xeon && just setup; docs/xeon/F/README.md; xeon/packages/ext-host/src/a.ts",
    "branch xeon/foundation, worktree ~/xeon-wt/m4-rename, paths: 'xeon/**'",
    "data in ~/.config/xeon/settings.json and /tmp/xeon-1000 and $XDG_RUNTIME_DIR/xeon",
  ].join("\n");
  expect(apply("W", text)).toBe(
    [
      "Fresnel runs `fresnel config`; FRESNEL mode; runFresnel; fresnelRoot",
      "cd xeon && just setup; docs/xeon/F/README.md; xeon/packages/ext-host/src/a.ts",
      "branch xeon/foundation, worktree ~/xeon-wt/m4-rename, paths: 'xeon/**'",
      "data in ~/.config/fresnel/settings.json and /tmp/fresnel-1000 and $XDG_RUNTIME_DIR/fresnel",
    ].join("\n"),
  );
});

test("X renames the measurement word and not workbench", () => {
  const file = "xeon/scripts/bench.ts";
  expect(
    apply("X", "just bench; bench-gate; scripts/bench.ts; workbench; Workbench; benchmark", file),
  ).toBe("just benchmark; benchmark-gate; scripts/benchmark.ts; workbench; Workbench; benchmark");
  expect(renamePath("xeon/scripts/bench-gate.test.ts", category("X"))).toBe(
    "xeon/scripts/benchmark-gate.test.ts",
  );
});

test("transform reports the replacement count and sample lines", () => {
  const result = transform("a\n@xeon/a\n@xeon/b\n", category("A"), "xeon/packages/x/src/a.ts");
  expect(result.count).toBe(2);
  expect(result.samples[0]).toEqual({ line: 2, before: "@xeon/a", after: "@fresnel/a" });
});
