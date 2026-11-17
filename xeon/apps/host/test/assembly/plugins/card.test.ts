import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { HOOKS, PluginCardSchema, type PluginCard } from "@fresnel/contracts/extensions";
import { buildPluginCard, type BuildCardInput } from "../../../src/assembly/plugins/card.ts";
import {
  readPluginFolder,
  type PluginFolder,
} from "../../../src/assembly/plugins/folder-reader.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §3.1, §4.5.5, §4.5.9: 카드는 폴더와 매니페스트에서 정적으로 계산한다. 코드는 실행하지 않는다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

function folderOf(name: string, files: Readonly<Record<string, string>>): PluginFolder {
  const parent = tempRoot("plugin-card-");
  roots.push(parent);
  const dir = join(parent, name);
  writeFiles(dir, files);
  const result = readPluginFolder(dir, { origin: "user" });
  if (!result.ok) throw new Error(`folder rejected: ${result.error.kind}`);
  return result.value;
}

const REVIEW: BuildCardInput["review"] = {
  state: "none",
  currentHash: null,
  pendingItemId: null,
  approvedAt: null,
};
const HEALTH: BuildCardInput["health"] = { state: "ok", lastActiveAt: null, lastError: null };

function cardOf(
  folder: PluginFolder,
  origin: BuildCardInput["origin"] = { kind: "user" },
): PluginCard {
  return buildPluginCard({ folder, origin, review: REVIEW, usedBy: [], health: HEALTH });
}

const SKILL = `---\nname: greeter\ndescription: "Say hello politely"\n---\nBody\n`;

test("스킬 폴더의 카드는 스키마를 만족하고 Inject 칸만 채운다", () => {
  const card = cardOf(folderOf("hello-skill", { "SKILL.md": SKILL }));
  expect(parse(PluginCardSchema, card).ok).toBe(true);
  expect(card.name).toBe("hello-skill");
  expect(card.purpose).toBe("Say hello politely");
  expect(card.does.hook).toBeNull();
  expect(card.does.drive).toBeNull();
  expect(card.enforcement).toBe("advisory");
  expect(card.runs).toEqual({ code: false, isolated: null });
  expect(card.does.inject?.instructions.skills).toEqual([
    { name: "greeter", path: "SKILL.md", descriptionChars: 18 },
  ]);
});

test("비용: 항상 싣는 지침의 글자 수 합과 도구 수, 나머지는 null이다", () => {
  const card = cardOf(
    folderOf("rules-kit", {
      "SKILL.md": SKILL,
      "instructions.md": "Keep it short.",
      "instructions/extra.md": "해요체.",
    }),
  );
  expect(card.cost).toEqual({
    always: "Keep it short.".length + "해요체.".length,
    drive: null,
    onDemand: null,
    toolCount: 0,
    basis: "declared",
  });
});

test("매니페스트 목적이 스킬 설명보다 우선한다. 둘 다 없으면 null이다", () => {
  const withManifest = cardOf(
    folderOf("manifest-purpose", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "manifest-purpose",
        version: "1.0.0",
        purpose: "Declared purpose",
      }),
      "SKILL.md": SKILL,
    }),
  );
  expect(withManifest.purpose).toBe("Declared purpose");

  const bare = cardOf(folderOf("no-purpose", { "instructions.md": "Plain." }));
  expect(bare.purpose).toBeNull();
});

test("코드와 드라이브 선언이 있으면 칸, 강제력, 격리 값이 선언에서 정해진다", () => {
  const files = {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "driver-kit",
      version: "1.0.0",
      purpose: "Drives the flow",
      entry: "./plugin.ts",
      plugins: [{ layer: "plugin", hooks: ["input.user.before"], drives: true }],
    }),
    "plugin.ts": "export {};",
  };
  const folder = folderOf("driver-kit", files);
  const card = cardOf(folder, { kind: "user" });
  expect(card.runs).toEqual({ code: true, isolated: true });
  expect(card.does.drive).toEqual({ start: true, commands: [] });
  expect(card.enforcement).toBe("enforced");
  expect(card.does.hook?.hooks).toEqual([
    {
      name: "input.user.before",
      fold: HOOKS["input.user.before"].fold,
      position: "boundary.input-received",
      powers: ["modify", "decide"],
    },
  ]);
  expect(parse(PluginCardSchema, card).ok).toBe(true);

  expect(cardOf(folder, { kind: "builtin" }).runs).toEqual({ code: true, isolated: false });
  expect(cardOf(folder, { kind: "managed" }).runs).toEqual({ code: true, isolated: true });
});

test("선언만 있는 도구, 명령, 대체는 Inject 칸에 들고 도구 수가 비용에 든다", () => {
  const card = cardOf(
    folderOf("tool-kit", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "tool-kit",
        version: "1.0.0",
        tools: [{ name: "note_save", description: "Save a note" }],
        commands: [{ name: "notes", description: "Open notes" }],
        plugins: [{ layer: "plugin", hooks: [], replaces: ["web_search"] }],
        entry: "./plugin.ts",
      }),
      "plugin.ts": "export {};",
    }),
  );
  expect(card.does.inject?.tools).toEqual([{ name: "note_save", description: "Save a note" }]);
  expect(card.does.inject?.commands).toEqual(["notes"]);
  expect(card.does.inject?.replaces).toEqual(["web_search"]);
  expect(card.cost.toolCount).toBe(1);
});

test("재료와 선언이 하나도 없는 코드 플러그인은 Inject 칸이 null이다", () => {
  const card = cardOf(
    folderOf("bare-code", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "bare-code",
        version: "1.0.0",
        entry: "./plugin.ts",
      }),
      "plugin.ts": "export {};",
    }),
  );
  expect(card.does.inject).toBeNull();
  expect(card.does.hook).toBeNull();
  expect(card.enforcement).toBe("advisory");
});

test("출처, 검토, 사용처, 건강 상태는 입력을 그대로 싣는다. 프로젝트 id가 없으면 키가 없다", () => {
  const folder = folderOf("passthrough", { "SKILL.md": SKILL });
  const usedBy = ["default", "common"];
  const projectCard = buildPluginCard({
    folder,
    origin: { kind: "project", projectId: "prj_one" },
    review: {
      state: "pending",
      currentHash: "sha256:abc",
      pendingItemId: "rvw_1",
      approvedAt: null,
    },
    usedBy,
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
  expect(projectCard.origin).toEqual({ kind: "project", projectId: "prj_one" });
  expect(projectCard.review.state).toBe("pending");
  expect(projectCard.usedBy).toEqual(usedBy);
  expect(projectCard.health.state).toBe("idle");

  const userCard = cardOf(folder);
  expect("projectId" in userCard.origin).toBe(false);
});
