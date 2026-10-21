import { describe, expect, test } from "bun:test";
import {
  canonicalToolset,
  diffToolsets,
  orderTools,
  toolsetFingerprint,
  type AnyCapabilityDef,
} from "../../src/capabilities/index.ts";
import { makeDef, permutations } from "./helpers.ts";

const DEFS: readonly AnyCapabilityDef[] = [
  makeDef("web.search", ["web_search", "web_fetch"]),
  makeDef("workspace.files", ["read", "ls", "grep"]),
  makeDef("acme-notes.sync", ["notes_sync", "notes_push"]),
];

function patchedTool(
  def: AnyCapabilityDef,
  patch: Partial<AnyCapabilityDef["tools"][number]>,
): AnyCapabilityDef {
  return {
    ...def,
    tools: def.tools.map((tool, index) => (index === 0 ? { ...tool, ...patch } : tool)),
  };
}

describe("toolsetFingerprint", () => {
  test("format is sha256: plus 64 lowercase hex", async () => {
    expect(await toolsetFingerprint(orderTools(DEFS))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("same set, same fingerprint in any definition order", async () => {
    const expected = await toolsetFingerprint(orderTools(DEFS));
    const all = await Promise.all(
      permutations(DEFS).map((permutation) => toolsetFingerprint(orderTools(permutation))),
    );
    expect(all.length).toBe(6);
    for (const fingerprint of all) expect(fingerprint).toBe(expected);
  });

  test("label, hints and replay are not part of the fingerprint", async () => {
    const [first, ...rest] = DEFS;
    if (first === undefined) throw new Error("fixture");
    const changed = patchedTool(first, {
      label: "다른 제목",
      hints: { readOnly: true },
      replay: "safe",
    });
    expect(await toolsetFingerprint(orderTools([changed, ...rest]))).toBe(
      await toolsetFingerprint(orderTools(DEFS)),
    );
  });

  test("a one-character description change changes it", async () => {
    const [first, ...rest] = DEFS;
    if (first === undefined) throw new Error("fixture");
    const tool = first.tools[0];
    const changed = patchedTool(first, { description: `${tool?.description ?? ""}!` });
    expect(await toolsetFingerprint(orderTools([changed, ...rest]))).not.toBe(
      await toolsetFingerprint(orderTools(DEFS)),
    );
  });

  test("the canonical text is key-sorted JSON without whitespace", () => {
    const text = canonicalToolset(orderTools([makeDef("web.one", ["a"])]));
    expect(text.startsWith('[{"description":"tool a","name":"a","parameters":{')).toBe(true);
    // 키 사이 공백이 없다: 한 번 파싱해 다시 직렬화해도 같다
    expect(JSON.stringify(JSON.parse(text))).toBe(text);
  });
});

describe("diffToolsets", () => {
  const before = orderTools(DEFS);

  test("adding a tool puts only it in added, at its sorted position", () => {
    const extra = makeDef("web.zeta", ["zeta"]);
    const after = orderTools([...DEFS, extra]);
    const diff = diffToolsets(before, after);
    expect(diff.added.map((t) => t.name)).toEqual(["zeta"]);
    expect(diff.removed).toEqual([]);
    expect(diff.firstChangedIndex).toBe(after.findIndex((t) => t.name === "zeta"));
  });

  test("inserting in the middle reports the insertion index", () => {
    const after = orderTools([...DEFS, makeDef("web.aaa", ["first"])]);
    const diff = diffToolsets(before, after);
    expect(diff.firstChangedIndex).toBe(after.findIndex((t) => t.name === "first"));
    expect(diff.firstChangedIndex).toBeLessThan(after.length - 1);
  });

  test("removing a tool lists it in removed only", () => {
    const [first, ...rest] = DEFS;
    if (first === undefined) throw new Error("fixture");
    const slim: AnyCapabilityDef = { ...first, tools: first.tools.slice(1) };
    const diff = diffToolsets(before, orderTools([slim, ...rest]));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([{ name: "web_search" }]);
  });

  test("redefining a tool under the same name appears in added, not removed", () => {
    const [first, ...rest] = DEFS;
    if (first === undefined) throw new Error("fixture");
    const redefined = patchedTool(first, { description: "new text" });
    const diff = diffToolsets(before, orderTools([redefined, ...rest]));
    expect(diff.added.map((t) => t.description)).toEqual(["new text"]);
    expect(diff.removed).toEqual([]);
    expect(diff.firstChangedIndex).not.toBeNull();
  });

  test("identical sets have no difference", () => {
    expect(diffToolsets(before, before)).toEqual({
      added: [],
      removed: [],
      firstChangedIndex: null,
    });
  });
});
