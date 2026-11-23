import { describe, expect, test } from "bun:test";
import { createCssAdopter } from "../../src/lib/adopt-css.ts";

function setup(): {
  readonly host: { adoptedStyleSheets: string[] };
  readonly adopter: ReturnType<typeof createCssAdopter<string>>;
  readonly made: string[];
} {
  const host = { adoptedStyleSheets: ["page-sheet"] };
  const made: string[] = [];
  const adopter = createCssAdopter(host, (text) => {
    made.push(text);
    return `sheet:${text}`;
  });
  return { host, adopter, made };
}

describe("createCssAdopter", () => {
  test("adds a sheet after the existing ones and removes exactly it when released", () => {
    const { host, adopter } = setup();
    const release = adopter.adopt("a{}");
    expect(host.adoptedStyleSheets).toEqual(["page-sheet", "sheet:a{}"]);
    release();
    expect(host.adoptedStyleSheets).toEqual(["page-sheet"]);
  });

  test("the same text shares one sheet until every user lets go, and a double release counts once", () => {
    const { host, adopter, made } = setup();
    const first = adopter.adopt("b{}");
    const second = adopter.adopt("b{}");
    expect(made).toEqual(["b{}"]);
    expect(host.adoptedStyleSheets).toEqual(["page-sheet", "sheet:b{}"]);
    first();
    first();
    expect(host.adoptedStyleSheets).toEqual(["page-sheet", "sheet:b{}"]);
    second();
    expect(host.adoptedStyleSheets).toEqual(["page-sheet"]);
  });

  test("different texts are separate sheets, and a text adopted again after release is made again", () => {
    const { host, adopter, made } = setup();
    const one = adopter.adopt("c{}");
    const two = adopter.adopt("d{}");
    expect(host.adoptedStyleSheets).toEqual(["page-sheet", "sheet:c{}", "sheet:d{}"]);
    one();
    expect(host.adoptedStyleSheets).toEqual(["page-sheet", "sheet:d{}"]);
    adopter.adopt("c{}");
    expect(made).toEqual(["c{}", "d{}", "c{}"]);
    two();
  });
});
