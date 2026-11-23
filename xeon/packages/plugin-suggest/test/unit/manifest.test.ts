import { describe, expect, test } from "bun:test";
import { KnowledgeLedger } from "@fresnel/contracts/capabilities";
import { ProposalListResultSchema } from "@fresnel/contracts/wire";
import {
  manifestTextGaps,
  validateManifest,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import { Compile } from "typebox/compile";
import { suggestManifest } from "../../src/manifest.ts";
import {
  SuggestCountResultSchema,
  SuggestListParamsSchema,
  suggestMethodDecls,
} from "../../src/methods.ts";
import { extension } from "../../src/index.ts";

// 매니페스트의 값과 권한 선언 시험. 권한은 `knowledge.ledger` 하나이고 두 메서드는 읽기 전용이다. 도구, 훅, 저장소 쓰기는 없다.

/** 매니페스트를 JSON으로 옮긴 값(번들이 `plugin.json`에 쓰는 모양)으로 검사한다 */
function jsonOf(manifest: ExtensionManifest): unknown {
  return JSON.parse(JSON.stringify(manifest));
}

function methodOf(verb: string): (typeof suggestMethodDecls)[number] {
  const found = suggestMethodDecls.find((decl) => decl.verb === verb);
  if (found === undefined) throw new Error(`no method ${verb}`);
  return found;
}

describe("suggest manifest", () => {
  test("passes the manifest validator with no errors", () => {
    const result = validateManifest(jsonOf(suggestManifest));
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.manifest?.name).toBe("suggest");
  });

  test("is a default plugin that is on by default and trusted at the user level", () => {
    expect(suggestManifest.name).toBe("suggest");
    expect(suggestManifest.displayName).toBe("제안");
    expect(suggestManifest.defaultEnabled).toBe(true);
    expect(suggestManifest.trust).toEqual({ level: "user" });
    expect(suggestManifest.orchestration).toBeUndefined();
    expect(suggestManifest.components).toBeUndefined();
  });

  test("has a purpose and a description, both non-empty", () => {
    expect(manifestTextGaps(suggestManifest)).toEqual([]);
  });

  test("declares exactly one root plugin with no hooks, requiring only the knowledge ledger", () => {
    expect(suggestManifest.plugins).toEqual([
      {
        layer: "L3",
        hooks: [],
        requires: [{ id: KnowledgeLedger.id, range: `^${KnowledgeLedger.version}` }],
      },
    ]);
    expect(suggestManifest.plugins?.[0]?.requires).toEqual([
      { id: "knowledge.ledger", range: "^1.0.0" },
    ]);
  });

  test("has no model tools, commands, scripts, or state of its own", () => {
    expect(suggestManifest.tools).toBeUndefined();
    expect(suggestManifest.commands).toBeUndefined();
    expect(suggestManifest.scripts).toBeUndefined();
    expect(suggestManifest.plugins?.[0]?.recordKinds).toBeUndefined();
  });

  test("declares list and count as read-only methods and no write method", () => {
    expect(suggestMethodDecls.map((decl) => decl.verb)).toEqual(["list", "count"]);
    for (const decl of suggestMethodDecls) {
      expect(decl.readOnly).toBe(true);
      expect(decl.approval).toBeUndefined();
      expect(decl.ownDataOnly).toBeUndefined();
    }
  });

  test("shows one native page whose tree file exists in the package", async () => {
    expect(suggestManifest.ui?.items).toEqual([
      {
        id: "suggest",
        placement: "page",
        mode: "native",
        title: "suggest.page.title",
        file: "./ui/suggest.view.json",
      },
    ]);
    expect(await Bun.file(new URL("../../ui/suggest.view.json", import.meta.url)).exists()).toBe(
      true,
    );
  });

  test("the entry export is a plugin entry", () => {
    expect(typeof extension).toBe("function");
  });
});

describe("suggest method schemas", () => {
  test("the list params take status, limit and cursor and refuse the source field", () => {
    const check = Compile(SuggestListParamsSchema);
    expect(check.Check({})).toBe(true);
    expect(check.Check({ status: ["pending"], limit: 20, cursor: "abc" })).toBe(true);
    expect(check.Check({ source: "knowledge" })).toBe(false);
    expect(check.Check({ limit: 0 })).toBe(false);
    expect(check.Check({ status: [] })).toBe(false);
  });

  test("the list result schema is the wire list result, so a row list and an unavailable answer both pass", () => {
    expect(JSON.parse(JSON.stringify(methodOf("list").result))).toEqual(
      JSON.parse(JSON.stringify(ProposalListResultSchema)),
    );
    const check = Compile(ProposalListResultSchema);
    expect(check.Check({ proposals: [], nextCursor: null, unavailable: ["knowledge"] })).toBe(true);
    expect(check.Check({ proposals: [], nextCursor: null })).toBe(false);
  });

  test("the count result schema takes a count or an unavailable reason", () => {
    const check = Compile(SuggestCountResultSchema);
    expect(check.Check({ ok: true, count: 3, capped: false })).toBe(true);
    expect(check.Check({ ok: false, reason: "unavailable" })).toBe(true);
    expect(check.Check({ ok: true, count: 201, capped: true })).toBe(false);
  });
});
