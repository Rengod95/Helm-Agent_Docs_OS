import { expect, test } from "bun:test";
import type { ProfileCostFigures } from "@fresnel/contracts/wire";
import {
  pluginCostOf,
  toolsChangedOf,
  totalCostOf,
  UNKNOWN_COST,
  type DeclaredInventory,
} from "../../src/assembly/m4/profile-cost.ts";

// M5c §4.2.8 정적 비용과 §3.4 도구 변화. 파일 읽기는 시험이 맵으로 넣는다(디스크를 건드리지 않는다).

const NONE: DeclaredInventory = {
  code: false,
  root: "/ext/p",
  tools: [],
  instructions: [],
  skills: [],
};

function filesOf(entries: Record<string, string>): (path: string) => Promise<string | undefined> {
  const map = new Map(Object.entries(entries));
  return (path) => Promise.resolve(map.get(path));
}

const NO_FILES = filesOf({});

/** 선언된 재료가 있는 플러그인의 비용 값 */
function declared(always: number, onDemand: number, toolCount: number): ProfileCostFigures {
  return { always, drive: null, onDemand, toolCount, basis: "declared" };
}

test("a plugin with declared tools costs the name and description of each tool, with the assembler's estimate", async () => {
  // "ping\nabcdefgh"는 13글자라 4토큰, "run\nx"는 5글자라 2토큰이다
  const cost = await pluginCostOf(
    {
      ...NONE,
      code: true,
      tools: [
        { name: "ping", description: "abcdefgh" },
        { name: "run", description: "x" },
      ],
    },
    NO_FILES,
  );
  expect(cost).toEqual({ always: 6, drive: null, onDemand: 0, toolCount: 2, basis: "declared" });
});

test("instruction files are read under the extension root and cost their text, not their bytes", async () => {
  const cost = await pluginCostOf(
    { ...NONE, instructions: ["AGENTS.md", "docs/more.md"] },
    filesOf({ "/ext/p/AGENTS.md": "12345678", "/ext/p/docs/more.md": "1234" }),
  );
  // 8글자는 2토큰, 4글자는 1토큰
  expect(cost).toEqual({ always: 3, drive: null, onDemand: 0, toolCount: 0, basis: "declared" });
});

test("a skill directory reads its SKILL.md, a .md skill is the file itself; the index line and the body are costed apart", async () => {
  const cost = await pluginCostOf(
    { ...NONE, skills: ["skills/a", "skills/b.md"] },
    filesOf({
      // 설명 "abcd"는 1토큰, 본문 "body12345"는 3토큰
      "/ext/p/skills/a/SKILL.md": "---\ndescription: abcd\n---\nbody12345",
      // 설명 "wxyzwxyz"는 2토큰, 본문 "tail"은 1토큰
      "/ext/p/skills/b.md": "---\ndescription: wxyzwxyz\n---\ntail",
    }),
  );
  expect(cost).toEqual({ always: 0, drive: null, onDemand: 7, toolCount: 0, basis: "declared" });
});

test("a skill without a description, or one that is not readable, makes the plugin unknown", async () => {
  const noDescription = await pluginCostOf(
    { ...NONE, skills: ["skills/a"] },
    filesOf({ "/ext/p/skills/a/SKILL.md": "---\nname: a\n---\nbody" }),
  );
  expect(noDescription).toEqual(UNKNOWN_COST);
  const missing = await pluginCostOf({ ...NONE, skills: ["skills/a"] }, NO_FILES);
  expect(missing).toEqual(UNKNOWN_COST);
});

test("a declared path that leaves the extension root is not read and makes the plugin unknown", async () => {
  const cost = await pluginCostOf(
    { ...NONE, instructions: ["../secret.md"] },
    filesOf({ "/ext/secret.md": "1234" }),
  );
  expect(cost).toEqual(UNKNOWN_COST);
});

test("an extension without a folder on disk (a built-in unit) cannot read declared files, so its files are unknown", async () => {
  const cost = await pluginCostOf(
    { ...NONE, root: "builtin", instructions: ["AGENTS.md"] },
    filesOf({ "builtin/AGENTS.md": "1234" }),
  );
  expect(cost).toEqual(UNKNOWN_COST);
});

test("a code plugin that declares no tools cannot be costed; a non-code plugin that declares nothing costs zero", async () => {
  expect(await pluginCostOf({ ...NONE, code: true }, NO_FILES)).toEqual(UNKNOWN_COST);
  expect(await pluginCostOf(NONE, NO_FILES)).toEqual({
    always: 0,
    drive: null,
    onDemand: 0,
    toolCount: 0,
    basis: "declared",
  });
});

test("the total sums the declared plugins, and any unknown plugin makes the total unknown", () => {
  expect(
    totalCostOf([
      { plugin: "a", cost: declared(4, 0, 1) },
      { plugin: "b", cost: declared(2, 4, 0) },
    ]),
  ).toEqual({ always: 6, drive: null, onDemand: 4, toolCount: 1, basis: "declared" });
  expect(
    totalCostOf([
      { plugin: "a", cost: declared(4, 0, 1) },
      { plugin: "c", cost: UNKNOWN_COST },
    ]),
  ).toEqual(UNKNOWN_COST);
  expect(totalCostOf([])).toEqual({
    always: 0,
    drive: null,
    onDemand: 0,
    toolCount: 0,
    basis: "declared",
  });
});

test("toolsChangedOf lists the names that appear and disappear, sorted, and is undefined when nothing changed", () => {
  expect(toolsChangedOf(new Set(["zeta", "run"]), new Set(["alpha", "run"]))).toEqual({
    added: ["alpha"],
    removed: ["zeta"],
  });
  expect(toolsChangedOf(new Set(["b", "a"]), new Set(["c"]))).toEqual({
    added: ["c"],
    removed: ["a", "b"],
  });
  expect(toolsChangedOf(new Set(["a"]), new Set(["a"]))).toBeUndefined();
});
