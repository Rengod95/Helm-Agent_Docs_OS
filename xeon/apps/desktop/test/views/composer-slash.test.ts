import { describe, expect, test } from "bun:test";
import type { CommandRowVM } from "@fresnel/client/settings";
import {
  appSlashOf,
  slashFillOf,
  slashMenuOf,
  slashMoveOf,
  unknownSlashOf,
} from "../../src/views/composer-slash.ts";

// 입력창 슬래시 목록과 `/compact [지침]`, 모르는 `/명령` 판정. 값으로 비교한다.

function row(name: string, description = ""): CommandRowVM {
  return {
    name,
    label: `/${name}`,
    description,
    hint: null,
    kind: "action",
    origin: "helm",
    needsShellConfirm: false,
    firstChoices: [],
  };
}

const ENGINE = [row("helm", "탐구"), row("learning"), row("plan")];

describe("slash menu", () => {
  test("a lone slash lists the app command first and then the engine commands", () => {
    expect(slashMenuOf("/", ENGINE).map((r) => r.label)).toEqual([
      "/compact",
      "/helm",
      "/learning",
      "/plan",
    ]);
  });

  test("the typed name narrows the list by prefix", () => {
    expect(slashMenuOf("/he", ENGINE).map((r) => r.label)).toEqual(["/helm"]);
    expect(slashMenuOf("/co", ENGINE).map((r) => r.label)).toEqual(["/compact"]);
    expect(slashMenuOf("/zz", ENGINE)).toEqual([]);
  });

  test("the compact row carries its description and argument hint", () => {
    const [compact] = slashMenuOf("/comp", []);
    expect(compact).toEqual({
      name: "compact",
      label: "/compact",
      description: "대화를 요약해 문맥을 줄여요",
      hint: "[지침]",
    });
  });

  test("an engine command with the same name as an app command does not appear twice", () => {
    expect(slashMenuOf("/compact", [row("compact")]).map((r) => r.label)).toEqual(["/compact"]);
  });

  test("no list for plain text, after a space, or on a later line", () => {
    expect(slashMenuOf("hello", ENGINE)).toEqual([]);
    expect(slashMenuOf("/helm ", ENGINE)).toEqual([]);
    expect(slashMenuOf("/helm\nx", ENGINE)).toEqual([]);
    expect(slashMenuOf("", ENGINE)).toEqual([]);
  });

  test("picking a row fills its name and a trailing space", () => {
    const [helm] = slashMenuOf("/he", ENGINE);
    expect(helm === undefined ? null : slashFillOf(helm)).toBe("/helm ");
  });

  test("the highlight wraps at both ends", () => {
    expect(slashMoveOf(0, 3, 1)).toBe(1);
    expect(slashMoveOf(2, 3, 1)).toBe(0);
    expect(slashMoveOf(0, 3, -1)).toBe(2);
    expect(slashMoveOf(0, 0, 1)).toBe(0);
  });
});

describe("app slash command", () => {
  test("/compact alone has no instructions", () => {
    expect(appSlashOf("/compact")).toEqual({ kind: "compact", instructions: null });
    expect(appSlashOf("/compact   ")).toEqual({ kind: "compact", instructions: null });
  });

  test("text after /compact is the instruction, trimmed, with later lines kept", () => {
    expect(appSlashOf("/compact 결정만 남겨 줘")).toEqual({
      kind: "compact",
      instructions: "결정만 남겨 줘",
    });
    expect(appSlashOf("/compact 첫 줄\n둘째 줄")).toEqual({
      kind: "compact",
      instructions: "첫 줄\n둘째 줄",
    });
  });

  test("other lines are not app commands, including a longer name that starts with compact", () => {
    expect(appSlashOf("hello")).toBeNull();
    expect(appSlashOf("/helm start")).toBeNull();
    expect(appSlashOf("/compacts")).toBeNull();
  });
});

describe("unknown slash command", () => {
  test("a name that is neither an app nor an engine command is reported", () => {
    expect(unknownSlashOf("/nope arg", ENGINE)).toBe("nope");
  });

  test("known names, app names, plain text and path-like lines are not", () => {
    expect(unknownSlashOf("/helm start", ENGINE)).toBeNull();
    expect(unknownSlashOf("/compact x", [])).toBeNull();
    expect(unknownSlashOf("hello", ENGINE)).toBeNull();
    expect(unknownSlashOf("/usr/bin/env", ENGINE)).toBeNull();
  });

  test("an unread command list never blocks sending", () => {
    expect(unknownSlashOf("/nope", null)).toBeNull();
  });
});
