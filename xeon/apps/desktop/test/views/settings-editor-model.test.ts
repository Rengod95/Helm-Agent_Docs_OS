import { describe, expect, test } from "bun:test";
import type { FieldVM } from "@fresnel/client/settings";
import type { SettingKey, SettingUi, SettingWidget } from "@fresnel/contracts/settings";
import {
  dedicatedEditorOf,
  fieldControlOf,
  foldableOf,
  hasFooter,
  panelOwnedOf,
} from "../../src/views/pages/settings/settings-model.ts";
import { defOf, fieldIn, settingOf, viewOf } from "./settings-fixtures.ts";

// 전용 편집기를 고르는 규칙(L4.settings-ui §4.2.4): 편집기 힌트가 먼저이고, 없으면 키 이름이고, 그다음은 위젯 종류다.
// 검색 순서는 도구와 웹 패널이 맡아 항목 목록에서 빠진다. 값은 `toEqual`로 비교한다.

/** 정의의 값 모양을 그대로 넣어 항목 하나를 만든다. 모양이 맞지 않으면 클라이언트가 읽기 전용으로 그린다 */
function fieldWith(
  key: SettingKey,
  tab: Parameters<typeof defOf>[1],
  widget: SettingWidget,
  type: Readonly<Record<string, unknown>>,
  ui: Partial<SettingUi> = {},
  value: unknown = [],
  extra: Parameters<typeof defOf>[4] = {},
): FieldVM {
  const def = defOf(key, tab, widget, type, extra, ui);
  const view = viewOf([def], [settingOf(key, value)]);
  const field = fieldIn(view, key);
  if (field === undefined) throw new Error(`field ${key} must exist`);
  return field;
}

const LIST = { type: "array", items: { type: "string" } };
const ROWS = {
  type: "array",
  items: {
    type: "object",
    properties: { id: { type: "string" }, resource: { type: "object" } },
    required: ["id"],
  },
};
const FIXED = {
  type: "object",
  properties: { low: { type: "integer" }, high: { type: "integer" } },
  required: ["low", "high"],
  additionalProperties: false,
};

/** 편집기 힌트만 있는 항목. 모양은 목록 하나면 된다 */
function fieldOf(
  key: SettingKey,
  tab: Parameters<typeof defOf>[1],
  widget: SettingWidget,
  ui: Partial<SettingUi> = {},
  value: unknown = [],
): FieldVM {
  return fieldWith(key, tab, widget, LIST, ui, value);
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

  test("an editor hint picks its kind", () => {
    expect(
      dedicatedEditorOf(fieldOf("l1.models.roles", "models", "readonly", { editor: "modelRoles" })),
    ).toBe("modelRoles");
    expect(
      dedicatedEditorOf(
        fieldOf("l1.tools.rules", "permissions", "table", { editor: "permissionRules" }),
      ),
    ).toBe("permissionRules");
    expect(
      dedicatedEditorOf(
        fieldOf("l0.sandbox.lists", "permissions", "list", { editor: "sandboxLists" }),
      ),
    ).toBe("sandboxLists");
  });

  test("the rules and the two sandbox lists get their editor by key", () => {
    expect(dedicatedEditorOf(fieldOf("l1.tools.rules", "permissions", "table"))).toBe(
      "permissionRules",
    );
    expect(dedicatedEditorOf(fieldOf("l0.sandbox.writeRoots.extra", "permissions", "list"))).toBe(
      "sandboxLists",
    );
    expect(
      dedicatedEditorOf(fieldOf("l0.sandbox.network.blockedDomains", "permissions", "list")),
    ).toBe("sandboxLists");
    expect(
      dedicatedEditorOf(fieldOf("l0.sandbox.protectedPaths.extra", "permissions", "list")),
    ).toBeNull();
  });

  test("a table and a secret without a key or hint get their editor by widget", () => {
    const fixed = fieldWith("l1.models.thinkingBudgets", "models", "table", FIXED);
    expect(dedicatedEditorOf(fixed)).toBe("table");
    const secret = fieldWith(
      "l0.secrets.token",
      "secrets",
      "secret",
      { type: "string" },
      {},
      null,
      {
        secret: true,
      },
    );
    expect(dedicatedEditorOf(secret)).toBe("secretRef");
  });

  test("a readonly value without a hint has no dedicated editor", () => {
    expect(dedicatedEditorOf(fieldOf("l1.models.default", "models", "readonly"))).toBeNull();
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

  test("the rules, the sandbox lists, a table and a secret are editor slots", () => {
    expect(fieldControlOf(fieldOf("l1.tools.rules", "permissions", "table"))).toBe("editor");
    expect(
      fieldControlOf(fieldOf("l0.sandbox.network.blockedDomains", "permissions", "list")),
    ).toBe("editor");
    expect(fieldControlOf(fieldWith("l1.models.thinkingBudgets", "models", "table", FIXED))).toBe(
      "editor",
    );
    const secret = fieldWith(
      "l0.secrets.token",
      "secrets",
      "secret",
      { type: "string" },
      {},
      null,
      {
        secret: true,
      },
    );
    expect(fieldControlOf(secret)).toBe("editor");
  });

  test("a readonly value stays a summary with no footer", () => {
    const value = fieldOf("l1.models.roles", "models", "readonly", {}, { main: "a/b" });
    expect(fieldControlOf(value)).toBe("summary");
    expect(hasFooter(value)).toBe(false);
  });

  test("a hint without a screen stays a summary with no footer", () => {
    const order = fieldOf("l1.models.roles", "models", "readonly", { editor: "searchOrder" });
    expect(fieldControlOf(order)).toBe("summary");
    expect(hasFooter(order)).toBe(false);
  });
});

describe("foldableOf", () => {
  test("objects and arrays fold, primitives and null do not", () => {
    expect(foldableOf({ main: "a/b" })).toBe(true);
    expect(foldableOf(["a"])).toBe(true);
    expect(foldableOf("a/b")).toBe(false);
    expect(foldableOf(3)).toBe(false);
    expect(foldableOf(null)).toBe(false);
    expect(foldableOf(undefined)).toBe(false);
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

  test("a stored rules value keeps its shape in the field", () => {
    const value = [{ id: "r1", action: "tool.call", resource: { tool: "bash" }, effect: "allow" }];
    expect(fieldWith("l1.tools.rules", "permissions", "table", ROWS, {}, value).value).toEqual(
      value,
    );
  });
});

describe("dedicatedEditorOf for external hooks", () => {
  test("x.operations.hookDefs gets the external hook editor by key, not the plain table", () => {
    const field = fieldWith("x.operations.hookDefs", "plugins", "table", ROWS);
    expect(dedicatedEditorOf(field)).toBe("hookDefs");
  });
});
