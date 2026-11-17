import { expect, test } from "bun:test";
import type { InvocableEntry, InvocableKind } from "@fresnel/contracts/wire";
import { resolveSlashName } from "../../src/slash/resolve.ts";

const HASH = `sha256:${"0".repeat(64)}`;

function entry(plugin: string, name: string, kind: InvocableKind, title = ""): InvocableEntry {
  return { plugin, entry: name, kind, title, reviewedHash: HASH };
}

const IN_SET: ReadonlySet<string> = new Set(["helm", "common-tools"]);

test("an in-profile skill or command wins over an outside one with the same name", () => {
  const entries = [
    entry("outside", "review", "skill", "밖"),
    entry("helm", "review", "command", "안"),
  ];
  expect(resolveSlashName("/review src", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "helm", entry: "review", alreadyInProfile: true }],
    rest: "src",
  });
});

test("an outside skill or command wins over a whole-plugin entry with the same name", () => {
  const entries = [entry("outside", "lint", "skill"), entry("lint", "lint", "plugin")];
  expect(resolveSlashName("/lint", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "outside", entry: "lint", alreadyInProfile: false }],
    rest: "",
  });
});

test("a whole-plugin entry resolves only when no skill or command has the name", () => {
  const entries = [entry("hooks-only", "hooks-only", "plugin", "훅 전용")];
  expect(resolveSlashName("/hooks-only 다음 일을 해", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "hooks-only", alreadyInProfile: false }],
    rest: "다음 일을 해",
  });
});

test("two outside plugins in the same layer are ambiguous and nothing is picked", () => {
  const entries = [
    entry("alpha", "plan", "skill", "알파 계획"),
    entry("beta", "plan", "command", "베타 계획"),
    entry("helm", "plan", "skill", "프로필 안 계획"),
  ];
  // 프로필 층의 항목이 있으면 밖의 두 플러그인은 보지 않는다
  expect(resolveSlashName("/plan", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "helm", entry: "plan", alreadyInProfile: true }],
    rest: "",
  });
  const outsideOnly = entries.filter((candidate) => candidate.plugin !== "helm");
  expect(resolveSlashName("/plan 세워 줘", outsideOnly, IN_SET)).toEqual({
    kind: "ambiguous",
    name: "plan",
    candidates: [
      {
        plugin: "alpha",
        entry: "plan",
        kind: "skill",
        title: "알파 계획",
        alreadyInProfile: false,
      },
      {
        plugin: "beta",
        entry: "plan",
        kind: "command",
        title: "베타 계획",
        alreadyInProfile: false,
      },
    ],
  });
});

test("ambiguity inside the profile layer does not fall through to the outside layer", () => {
  const entries = [
    entry("helm", "note", "skill", "안 1"),
    entry("common-tools", "note", "command", "안 2"),
    entry("outside", "note", "skill", "밖"),
  ];
  expect(resolveSlashName("/note", entries, IN_SET)).toEqual({
    kind: "ambiguous",
    name: "note",
    candidates: [
      { plugin: "helm", entry: "note", kind: "skill", title: "안 1", alreadyInProfile: true },
      {
        plugin: "common-tools",
        entry: "note",
        kind: "command",
        title: "안 2",
        alreadyInProfile: true,
      },
    ],
  });
});

test("one plugin with a skill and a command of the same name resolves once", () => {
  const entries = [entry("solo", "ship", "skill"), entry("solo", "ship", "command")];
  expect(resolveSlashName("/ship", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "solo", entry: "ship", alreadyInProfile: false }],
    rest: "",
  });
});

test("a command named like its plugin wins over the whole-plugin entry", () => {
  const entries = [entry("helm", "helm", "command", "명령"), entry("helm", "helm", "plugin")];
  expect(resolveSlashName("/helm start", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "helm", entry: "helm", alreadyInProfile: true }],
    rest: "start",
  });
});

test("/plugin:<name> always means the whole plugin, even when a command has the same name", () => {
  const entries = [entry("helm", "helm", "command"), entry("helm", "helm", "plugin")];
  expect(resolveSlashName("/plugin:helm 시작", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "helm", alreadyInProfile: true }],
    rest: "시작",
  });
});

test("/plugin:<name> looks only at whole-plugin entries", () => {
  const entries = [entry("lint", "lint", "skill")];
  expect(resolveSlashName("/plugin:lint", entries, IN_SET)).toEqual({ kind: "none" });
});

test("/<plugin>:<item> picks that plugin's skill or command with the given name", () => {
  const entries = [
    entry("alpha", "plan", "skill"),
    entry("beta", "plan", "command"),
    entry("beta", "run", "command"),
  ];
  expect(resolveSlashName("/beta:plan 오늘치", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "beta", entry: "plan", alreadyInProfile: false }],
    rest: "오늘치",
  });
  expect(resolveSlashName("/beta:plan", entries.slice(0, 1), IN_SET)).toEqual({ kind: "none" });
});

test("/<plugin>:<item> does not pick drive entries or whole-plugin entries", () => {
  const entries = [entry("helm", "start", "drive"), entry("helm", "helm", "plugin")];
  expect(resolveSlashName("/helm:start", entries, IN_SET)).toEqual({ kind: "none" });
  expect(resolveSlashName("/helm:helm", entries, IN_SET)).toEqual({ kind: "none" });
});

test("drive entries are never picked by a bare name", () => {
  const entries = [entry("helm", "start", "drive")];
  expect(resolveSlashName("/start", entries, IN_SET)).toEqual({ kind: "none" });
});

test("input without a leading slash, a bare slash, or an empty qualifier resolves to none", () => {
  const entries = [entry("helm", "review", "skill"), entry("helm", "helm", "plugin")];
  expect(resolveSlashName("review src", entries, IN_SET)).toEqual({ kind: "none" });
  expect(resolveSlashName("hello /review", entries, IN_SET)).toEqual({ kind: "none" });
  expect(resolveSlashName("/", entries, IN_SET)).toEqual({ kind: "none" });
  expect(resolveSlashName("/plugin:", entries, IN_SET)).toEqual({ kind: "none" });
  expect(resolveSlashName("/:review", entries, IN_SET)).toEqual({ kind: "none" });
  expect(resolveSlashName("/helm:", entries, IN_SET)).toEqual({ kind: "none" });
});

test("an unknown name resolves to none", () => {
  expect(resolveSlashName("/nothing here", [], IN_SET)).toEqual({ kind: "none" });
});

test("rest is the trimmed text after the first token", () => {
  const entries = [entry("helm", "review", "skill")];
  expect(resolveSlashName("/review   src/  main  ", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "helm", entry: "review", alreadyInProfile: true }],
    rest: "src/  main",
  });
  expect(resolveSlashName("/review   ", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "helm", entry: "review", alreadyInProfile: true }],
    rest: "",
  });
});

test("alreadyInProfile follows the profile set for every form", () => {
  const entries = [
    entry("helm", "review", "skill"),
    entry("outside", "lint", "command"),
    entry("outside", "wholeish", "plugin"),
  ];
  const withOutside: ReadonlySet<string> = new Set(["helm", "outside"]);
  expect(resolveSlashName("/outside:lint", entries, withOutside)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "outside", entry: "lint", alreadyInProfile: true }],
    rest: "",
  });
  expect(resolveSlashName("/lint", entries, IN_SET)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "outside", entry: "lint", alreadyInProfile: false }],
    rest: "",
  });
  expect(resolveSlashName("/plugin:outside", entries, withOutside)).toEqual({
    kind: "resolved",
    overlay: [{ plugin: "outside", alreadyInProfile: true }],
    rest: "",
  });
});
