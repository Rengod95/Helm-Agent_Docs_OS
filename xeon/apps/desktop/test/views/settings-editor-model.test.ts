import { describe, expect, test } from "bun:test";
import type { FieldVM } from "@fresnel/client/settings";
import {
  dedicatedEditorOf,
  fieldControlOf,
  hasFooter,
  panelOwnedOf,
} from "../../src/views/pages/settings/settings-model.ts";
import { defOf, fieldIn, settingOf, viewOf } from "./settings-fixtures.ts";

// 전용 편집기를 고르는 규칙(L4.settings-ui §4.2.4): 편집기 힌트가 먼저이고 없으면 키 이름이다.
// 검색 순서는 도구와 웹 패널이 맡아 항목 목록에서 빠진다. 값은 `toEqual`로 비교한다.

function fieldOf(
  key: string,
  tab: Parameters<typeof defOf>[1],
  widget: Parameters<typeof defOf>[2],
  ui: Parameters<typeof defOf>[5] = {},
  value: unknown = [],
): FieldVM {
  const def = defOf(key, tab, widget, { type: "array" }, {}, ui);
  const view = viewOf([def], [settingOf(key, value)]);
  const field = fieldIn(view, key);
  if (field === undefined) throw new Error(`field ${key} must exist`);
  return field;
}

describe("dedicatedEditorOf", () => {
  test("the keys that P-11 owns get their editor by name", () => {
    expect(dedicatedEditorOf(fieldOf("l1.models.accounts", "providers", "table"))).toBe(
      "accountPool",
    );
    expect(dedicatedEditorOf(fieldOf("l1.models.rateLimit", "budgets", "table"))).toBe("rateLimit");
    expect(dedicatedEditorOf(fieldOf("l1.models.fallbackChains", "models", "table"))).toBe(
      "fallbackChain",
    );
  });

  test("an editor hint picks its kind, and a hint without a screen is no editor", () => {
    expect(
      dedicatedEditorOf(fieldOf("l1.models.roles", "models", "readonly", { editor: "modelRoles" })),
    ).toBe("modelRoles");
    expect(
      dedicatedEditorOf(
        fieldOf("l0.rules", "permissions", "readonly", { editor: "permissionRules" }),
      ),
    ).toBeNull();
    expect(
      dedicatedEditorOf(
        fieldOf("l0.sandbox.lists", "sandbox", "readonly", { editor: "sandboxLists" }),
      ),
    ).toBeNull();
  });

  test("an ordinary key has no dedicated editor", () => {
    expect(dedicatedEditorOf(fieldOf("l1.models.default", "models", "text", {}, "a/b"))).toBeNull();
  });
});

describe("fieldControlOf and hasFooter for dedicated editors", () => {
  test("a dedicated editor is an editor slot with a save and revert footer", () => {
    const accounts = fieldOf("l1.models.accounts", "providers", "table");
    expect(fieldControlOf(accounts)).toBe("editor");
    expect(hasFooter(accounts)).toBe(true);
  });

  test("a hint without a screen stays a summary with no footer", () => {
    const rules = fieldOf("l0.rules", "permissions", "readonly", { editor: "permissionRules" });
    expect(fieldControlOf(rules)).toBe("summary");
    expect(hasFooter(rules)).toBe(false);
  });
});

describe("the tools panel owns the search order", () => {
  test("the search order field is the panel's, by its hint or by its key", () => {
    const byHint = fieldOf("l2.web.search.order", "tools", "list", { editor: "searchOrder" });
    const byKey = fieldOf("l2.web.search.order", "tools", "list");
    expect(panelOwnedOf(byHint)).toBe(true);
    expect(panelOwnedOf(byKey)).toBe(true);
    expect(dedicatedEditorOf(byHint)).toBeNull();
  });

  test("an ordinary tools field is not the panel's", () => {
    expect(panelOwnedOf(fieldOf("l2.web.search.parallel", "tools", "number"))).toBe(false);
  });
});

describe("settingOf fixture", () => {
  test("a stored accounts value keeps its shape in the field", () => {
    const value = [{ provider: "anthropic", accountId: "work" }];
    expect(fieldOf("l1.models.accounts", "providers", "table", {}, value).value).toEqual(value);
  });
});
