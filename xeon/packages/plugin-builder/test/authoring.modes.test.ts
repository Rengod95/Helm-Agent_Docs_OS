import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { pluginDeclsOf } from "@fresnel/contracts/extensions";
import type { PluginMode } from "@fresnel/contracts/services";
import { scanDriveSource } from "@fresnel/orchestration-sdk/testing";
import { scaffoldExtension, validateExtensionDir } from "@fresnel/core-authoring";
import { readManifest, readRecord, tempRoot, templateDirs } from "./support.ts";

// 세 방식(M5c §4.9.4)의 뼈대: 템플릿으로 만들고, 검사를 통과하고, 매니페스트의 값(훅, 지침, 구동, 그룹)을 본다.
// 검사는 원본 파일 검사와 구동 규율 검사(`scanDriveSource`)를 모두 돌린다. 경고는 허용하고 오류는 없어야 한다.

const root = tempRoot();
const templates = templateDirs();

interface Expected {
  readonly hooks: readonly string[];
  readonly drives: boolean;
  readonly instructions: readonly string[];
  readonly group: boolean;
  readonly entry: boolean;
}

const EXPECTED: Readonly<Record<PluginMode, Expected>> = {
  hook: {
    hooks: ["boundary.settle.after"],
    drives: false,
    instructions: [],
    group: false,
    entry: true,
  },
  inject: {
    hooks: [],
    drives: false,
    instructions: ["instructions.md"],
    group: false,
    entry: false,
  },
  drive: { hooks: [], drives: true, instructions: [], group: true, entry: true },
};

for (const mode of ["hook", "inject", "drive"] as const) {
  test(`authoring.modes.${mode}: the ${mode} scaffold has the manifest fields of its mode, and validates with the replay discipline scan`, async () => {
    const name = `mode-${mode}`;
    const dir = root.path(name);
    const made = await scaffoldExtension({ kind: "single-plugin", name, dir, mode }, { templates });
    if (!made.ok) throw new Error(made.error.message);

    // 매니페스트의 값을 비교한다(글자 그대로가 아니라 값)
    const manifest = readRecord(join(dir, ".fresnel-plugin", "plugin.json"));
    const plugins = pluginDeclsOf(readManifest(dir));
    expect(plugins).toHaveLength(1);
    const [root0] = plugins;
    const actual: Expected = {
      hooks: root0?.hooks ?? [],
      drives: root0?.drives === true,
      instructions: readManifest(dir).components?.instructions ?? [],
      group: readManifest(dir).orchestration !== undefined,
      entry: manifest["entry"] !== undefined,
    };
    expect(actual).toEqual(EXPECTED[mode]);
    expect(existsSync(join(dir, "instructions.md"))).toBe(mode === "inject");
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(mode !== "inject");

    // 검사: 오류가 없어야 한다. 구동 방식은 재생 규율 검사를 돌려 위반이 없어야 한다
    const checked = await validateExtensionDir(dir, { scanDrive: scanDriveSource });
    if (!checked.ok) throw new Error(checked.error.message);
    expect(checked.value.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(checked.value.ok).toBe(true);
  });
}

test("authoring.modes.default: a scaffold without a mode is the hook mode, byte for byte the old single plugin", async () => {
  const dir = root.path("mode-default");
  const made = await scaffoldExtension(
    { kind: "single-plugin", name: "mode-default", dir },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  const source = readFileSync(join(templates.single, ".fresnel-plugin", "plugin.json"), "utf8");
  expect(readFileSync(join(dir, ".fresnel-plugin", "plugin.json"), "utf8")).toBe(
    source
      .replaceAll("__ID__", "mode-default")
      .replaceAll("__TITLE__", "mode-default")
      .replaceAll("__VERSION__", "0.1.0"),
  );
});

test("authoring.modes.drive-source: the drive scaffold's step is an ordinary drive with a turn and a done, nothing unreplayable", () => {
  const source = readFileSync(join(templates.drive, "src", "index.ts"), "utf8");
  expect(scanDriveSource(source, { fileName: "src/index.ts" })).toEqual([]);
  expect(source).toContain("g.drive(");
});
