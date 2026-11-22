import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { createMaterialPort } from "../../../src/assembly/plugins/material-port.ts";
import {
  readPluginFolder,
  type FolderRejection,
} from "../../../src/assembly/plugins/folder-reader.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.5.10: 재료는 대화의 켜짐 집합에 든 플러그인에서만 나온다. 읽지 못한 플러그인은 알린다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

function threadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

test("켜짐 집합의 플러그인 재료만 낸다. 폴더가 없는 이름은 건너뛴다", () => {
  const root = tempRoot("plugin-material-");
  roots.push(root);
  // 폴더 이름은 플러그인 이름 규칙(2자 이상)을 따른다. 켜짐 집합의 이름은 키로만 쓴다
  const dirA = join(root, "kit-a");
  const dirB = join(root, "kit-b");
  writeFiles(dirA, {
    "SKILL.md": "---\ndescription: Skill A\n---\nbody",
    "instructions.md": "Rule A",
    "agents/helper.md": "Helper",
    "commands/run.md": "Run it",
  });
  writeFiles(dirB, {
    "mcp.json": JSON.stringify({ mcpServers: { srv: { command: "node" } } }),
  });
  const dirs = new Map<string, string>([
    ["a", dirA],
    ["b", dirB],
  ]);
  const port = createMaterialPort({
    pluginSet: () => ["a", "b", "not-installed"],
    treeOf: (name) => dirs.get(name) ?? null,
    read: (dir) => readPluginFolder(dir, { origin: "user" }),
    report: () => {
      throw new Error("no plugin should fail in this case");
    },
  });
  const id = threadId();

  expect(port.instructions(id)).toEqual([{ key: "plugin:a:instructions.md", text: "Rule A" }]);
  expect(port.skillRoots(id)).toEqual([{ plugin: "a", dir: dirA }]);
  expect(port.agentDefinitions(id)).toEqual([{ key: "plugin:a:agents/helper.md", text: "Helper" }]);
  expect(port.commands(id)).toEqual([{ key: "plugin:a:commands/run.md", text: "Run it" }]);
  expect(port.mcpServers(id)).toEqual([{ plugin: "b", name: "srv", config: { command: "node" } }]);
});

test("읽지 못한 플러그인은 재료 없이 알리고, 같은 폴더는 한 번만 읽고 한 번만 알린다", () => {
  const root = tempRoot("plugin-material-");
  roots.push(root);
  const bad = join(root, "bad");
  writeFiles(bad, { "README.md": "no plugin signal here" });

  const reads: string[] = [];
  const reports: { readonly name: string; readonly rejection: FolderRejection }[] = [];
  const port = createMaterialPort({
    pluginSet: () => ["bad"],
    treeOf: (name) => (name === "bad" ? bad : null),
    read: (dir) => {
      reads.push(dir);
      return readPluginFolder(dir, { origin: "user" });
    },
    report: (name, rejection) => reports.push({ name, rejection }),
  });
  const id = threadId();

  expect(port.instructions(id)).toEqual([]);
  expect(port.mcpServers(id)).toEqual([]);
  expect(port.instructions(id)).toEqual([]);
  expect(reads).toEqual([bad]);
  expect(reports.map((item) => [item.name, item.rejection.kind])).toEqual([["bad", "no_signal"]]);
});

test("같은 폴더 경로는 여러 번 불러도 한 번만 읽는다", () => {
  const root = tempRoot("plugin-material-");
  roots.push(root);
  const dir = join(root, "cached");
  writeFiles(dir, { "instructions.md": "Once" });

  let reads = 0;
  const port = createMaterialPort({
    pluginSet: () => ["cached"],
    treeOf: () => dir,
    read: (folder) => {
      reads += 1;
      return readPluginFolder(folder, { origin: "user" });
    },
    report: () => {
      throw new Error("the folder is readable");
    },
  });
  const id = threadId();
  expect(port.instructions(id)).toEqual([{ key: "plugin:cached:instructions.md", text: "Once" }]);
  expect(port.instructions(id)).toEqual([{ key: "plugin:cached:instructions.md", text: "Once" }]);
  expect(reads).toBe(1);
});

test("스킬만 든 검토본(폴더 이름이 tree)의 스킬 이름은 폴더 이름이 아니라 플러그인 이름이다", () => {
  const root = tempRoot("plugin-material-");
  roots.push(root);
  const tree = join(root, "tree");
  writeFiles(tree, { "SKILL.md": "---\ndescription: Notes skill\n---\nbody" });

  const port = createMaterialPort({
    pluginSet: () => ["notes-kit"],
    treeOf: () => tree,
    read: (dir, name) => readPluginFolder(dir, { origin: "user", name }),
    report: () => {
      throw new Error("the folder is readable");
    },
  });
  expect(port.skillRoots(threadId())).toEqual([{ plugin: "notes-kit", dir: tree }]);
  const folder = readPluginFolder(tree, { origin: "user", name: "notes-kit" });
  expect(folder.ok && folder.value.name).toBe("notes-kit");
});
