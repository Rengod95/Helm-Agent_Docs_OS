import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// 안내 스킬(플러그인 제작 참조)에 화면 문서가 있고, 옛 자리 이름 `well`이 남지 않았는지 본다.

const SKILLS = join(import.meta.dir, "..", "skills");
const AUTHORING = join(SKILLS, "fresnel-plugin-authoring");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test("the authoring guide has a plugin screen reference, and the skill lists it", () => {
  const uiPath = join(AUTHORING, "references", "ui.md");
  expect(existsSync(uiPath)).toBe(true);
  const skill = readFileSync(join(AUTHORING, "SKILL.md"), "utf8");
  expect(skill).toContain("`references/ui.md`");
});

test("the screen reference names the six current slots and the choice rule", () => {
  const ui = readFileSync(join(AUTHORING, "references", "ui.md"), "utf8");
  for (const slot of ["`page`", "`panel`", "`card`", "`status`", "`command`", "`settings`"]) {
    expect(ui).toContain(slot);
  }
  expect(ui).toContain("ADR-0021");
  expect(ui).toContain("## Choosing the mode");
  expect(ui).toContain("## Bridge protocol");
  expect(ui).toContain("## Confirmation lines");
});

test("no guide file still uses the old slot name well", () => {
  const stale = filesUnder(SKILLS)
    .filter((path) => /\bwell\b/.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(SKILLS.length + 1));
  expect(stale).toEqual([]);
});
